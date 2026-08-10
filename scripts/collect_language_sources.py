#!/usr/bin/env python3
"""Collect licensed language-learning research sources into a local SQLite corpus.

The collector separates discovery from publication. Search results and extracted
pages are untrusted research material and must never be copied directly into the
learner-facing catalog without review, attribution and license checks.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import ipaddress
import json
import os
import re
import socket
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

USER_AGENT = "LumeTutorResearchBot/1.0 (+https://caps-labs.com; educational-research)"
DEFAULT_OUTPUT = Path(".local/content-research/sources.sqlite3")
MAX_RESPONSE_BYTES = 2_000_000
MAX_EXTRACTED_CHARS = 60_000
MAX_EXCERPT_CHARS = 700

LANGUAGE_CONFIG = {
    "en": {
        "name": "English",
        "country": "us",
        "search_lang": "en",
        "queries": {
            "explanation": "learn English {level} grammar explanation",
            "exercise": "English {level} grammar exercises",
            "news": "English {level} easy news",
            "text": "English {level} reading texts",
        },
        "wiki_queries": {
            "explanation": "English grammar {level}",
            "exercise": "English exercises {level}",
            "news": "education language learning",
            "text": "English reading {level}",
        },
    },
    "es": {
        "name": "español",
        "country": "es",
        "search_lang": "es",
        "queries": {
            "explanation": "aprender español {level} explicación gramática",
            "exercise": "español {level} ejercicios de gramática",
            "news": "noticias en español fácil nivel {level}",
            "text": "textos en español nivel {level} comprensión lectora",
        },
        "wiki_queries": {
            "explanation": "español para extranjeros gramática {level}",
            "exercise": "español para extranjeros ejercicios {level}",
            "news": "educación idiomas",
            "text": "español para extranjeros lectura {level}",
        },
    },
    "fr": {
        "name": "français",
        "country": "fr",
        "search_lang": "fr",
        "queries": {
            "explanation": "apprendre le français {level} explication grammaire",
            "exercise": "français {level} exercices de grammaire",
            "news": "actualités français facile niveau {level}",
            "text": "textes français niveau {level} compréhension écrite",
        },
        "wiki_queries": {
            "explanation": "français langue étrangère grammaire {level}",
            "exercise": "français langue étrangère exercices {level}",
            "news": "éducation langues",
            "text": "français langue étrangère lecture {level}",
        },
    },
    "it": {
        "name": "italiano",
        "country": "it",
        "search_lang": "it",
        "queries": {
            "explanation": "imparare italiano {level} spiegazione grammatica",
            "exercise": "italiano {level} esercizi di grammatica",
            "news": "notizie italiano facile livello {level}",
            "text": "testi italiano livello {level} comprensione scritta",
        },
        "wiki_queries": {
            "explanation": "italiano per stranieri grammatica {level}",
            "exercise": "italiano per stranieri esercizi {level}",
            "news": "istruzione lingue",
            "text": "italiano per stranieri lettura {level}",
        },
    },
}

OPEN_SOURCE_POLICIES = {
    "wikibooks.org": {
        "license": "CC BY-SA (verify the specific page footer)",
        "usage_policy": "open_research_with_attribution",
        "allow_full_text": True,
    },
    "wikinews.org": {
        "license": "CC BY 2.5 (verify the specific page footer)",
        "usage_policy": "open_research_with_attribution",
        "allow_full_text": True,
    },
    "wikiversity.org": {
        "license": "CC BY-SA (verify the specific page footer)",
        "usage_policy": "open_research_with_attribution",
        "allow_full_text": True,
    },
}

REFERENCE_ONLY_DOMAINS = {
    "britishcouncil.org",
    "cambridgeenglish.org",
    "tv5monde.com",
    "lingolia.com",
    "cervantes.es",
    "rai.it",
    "rae.es",
    "rfi.fr",
    "treccani.it",
}

CURATED_REFERENCE_SOURCES = (
    ("en", "A1", "text", "https://learnenglish.britishcouncil.org/free-resources/reading/a1"),
    (
        "en",
        "A1",
        "exercise",
        "https://www.cambridgeenglish.org/learning-english/activities-for-learners/"
        "?level=basic&skill=grammar%2Creading",
    ),
    (
        "en",
        "A1",
        "exercise",
        "https://americanenglish.state.gov/resources/voa-articles-activities",
    ),
    ("fr", "A1", "exercise", "https://apprendre.tv5monde.com/"),
    ("fr", "A1", "news", "https://francaisfacile.rfi.fr/fr/"),
    (
        "es",
        "A1",
        "explanation",
        "https://cvc.cervantes.es/Ensenanza/biblioteca_ele/plan_curricular/"
        "niveles/02_gramatica_inventario_a1-a2.htm",
    ),
    (
        "es",
        "A1",
        "exercise",
        "https://controlcalidad.examenes.cervantes.es/es/dele/como-son-los-examenes/a1",
    ),
    ("it", "A1", "explanation", "https://www.raiscuola.rai.it/percorsi/livelloa1"),
    ("it", "A1", "exercise", "https://www.italianonline.it/esercizi.html"),
)


@dataclass(frozen=True)
class SearchHit:
    url: str
    title: str
    description: str
    language: str
    level: str
    category: str
    query: str
    discovery_provider: str


@dataclass(frozen=True)
class ExtractedPage:
    title: str
    description: str
    excerpt: str
    text: str | None
    content_type: str


class ResearchHTMLParser(HTMLParser):
    """Small dependency-free extractor for title, description and readable blocks."""

    BLOCK_TAGS = {"article", "h1", "h2", "h3", "li", "main", "p"}
    SKIP_TAGS = {"canvas", "footer", "form", "nav", "noscript", "script", "style", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.description = ""
        self.blocks: list[str] = []
        self._current: list[str] = []
        self._in_title = False
        self._block_depth = 0
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized = tag.lower()
        if normalized in self.SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if normalized == "title":
            self._in_title = True
        if normalized == "meta":
            values = {key.lower(): value or "" for key, value in attrs}
            if (
                values.get("name", "").lower() == "description"
                or values.get("property", "").lower() == "og:description"
            ):
                self.description = self.description or values.get("content", "")
        if normalized in self.BLOCK_TAGS:
            if self._block_depth == 0:
                self._current = []
            self._block_depth += 1

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in self.SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if normalized == "title":
            self._in_title = False
        if normalized in self.BLOCK_TAGS and self._block_depth:
            self._block_depth -= 1
            if self._block_depth == 0:
                block = normalize_space(" ".join(self._current))
                if len(block) >= 25:
                    self.blocks.append(block)
                self._current = []

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        cleaned = normalize_space(data)
        if not cleaned:
            return
        if self._in_title:
            self.title_parts.append(cleaned)
        if self._block_depth:
            self._current.append(cleaned)


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        validate_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if scheme not in {"http", "https"} or not hostname:
        raise ValueError("only absolute HTTP(S) URLs are accepted")
    port = parsed.port
    netloc = hostname
    if port and not (scheme == "http" and port == 80) and not (scheme == "https" and port == 443):
        netloc = f"{hostname}:{port}"
    path = parsed.path or "/"
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(key, val) for key, val in query if not key.lower().startswith("utm_")]
    return urllib.parse.urlunsplit((scheme, netloc, path, urllib.parse.urlencode(query), ""))


def validate_public_url(value: str) -> None:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("invalid external URL")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".local"):
        raise ValueError("local addresses are not allowed")
    for result in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(result[4][0])
        if not address.is_global:
            raise ValueError(f"non-public address rejected: {address}")


def domain_matches(hostname: str, expected: str) -> bool:
    return hostname == expected or hostname.endswith(f".{expected}")


def source_policy(url: str) -> dict[str, Any]:
    hostname = (urllib.parse.urlsplit(url).hostname or "").lower()
    for domain, policy in OPEN_SOURCE_POLICIES.items():
        if domain_matches(hostname, domain):
            return dict(policy)
    for domain in REFERENCE_ONLY_DOMAINS:
        if domain_matches(hostname, domain):
            return {
                "license": "copyrighted/reference-only; verify terms manually",
                "usage_policy": "metadata_and_short_excerpt_only",
                "allow_full_text": False,
            }
    return {
        "license": "unknown; manual review required",
        "usage_policy": "metadata_and_short_excerpt_only",
        "allow_full_text": False,
    }


def http_get(url: str, *, timeout: float, max_bytes: int = MAX_RESPONSE_BYTES) -> tuple[bytes, Any]:
    validate_public_url(url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.1"},
    )
    opener = urllib.request.build_opener(SafeRedirectHandler())
    with opener.open(request, timeout=timeout) as response:
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise ValueError(f"response exceeded {max_bytes} bytes")
        return payload, response.headers


def robots_allows(
    url: str, *, timeout: float, cache: dict[str, urllib.robotparser.RobotFileParser]
) -> bool:
    parsed = urllib.parse.urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in cache:
        parser = urllib.robotparser.RobotFileParser()
        parser.set_url(f"{origin}/robots.txt")
        try:
            payload, _ = http_get(parser.url, timeout=timeout, max_bytes=500_000)
            parser.parse(payload.decode("utf-8", errors="replace").splitlines())
        except (OSError, ValueError, urllib.error.URLError):
            # Fail closed: inability to verify crawling permission means no page fetch.
            parser.parse(["User-agent: *", "Disallow: /"])
        cache[origin] = parser
    return cache[origin].can_fetch(USER_AGENT, url)


def extract_page(payload: bytes, headers: Any, *, allow_full_text: bool) -> ExtractedPage:
    content_type = (
        headers.get_content_type() if hasattr(headers, "get_content_type") else "text/html"
    )
    charset = headers.get_content_charset() if hasattr(headers, "get_content_charset") else None
    decoded = payload.decode(charset or "utf-8", errors="replace")
    if content_type not in {"text/html", "application/xhtml+xml"}:
        raise ValueError(f"unsupported content type: {content_type}")
    parser = ResearchHTMLParser()
    parser.feed(decoded)
    blocks = list(dict.fromkeys(parser.blocks))
    extracted = "\n\n".join(blocks)[:MAX_EXTRACTED_CHARS]
    description = normalize_space(parser.description)
    excerpt_source = description or extracted
    return ExtractedPage(
        title=normalize_space(" ".join(parser.title_parts)),
        description=description[:MAX_EXCERPT_CHARS],
        excerpt=excerpt_source[:MAX_EXCERPT_CHARS],
        text=extracted if allow_full_text and extracted else None,
        content_type=content_type,
    )


def brave_search(
    query: str, *, language: str, level: str, category: str, count: int
) -> list[SearchHit]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    if not api_key:
        return []
    config = LANGUAGE_CONFIG[language]
    params = urllib.parse.urlencode(
        {
            "q": query,
            "count": min(max(count, 1), 20),
            "country": config["country"],
            "search_lang": config["search_lang"],
            "safesearch": "strict",
        }
    )
    url = f"https://api.search.brave.com/res/v1/web/search?{params}"
    validate_public_url(url)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
            "X-Subscription-Token": api_key,
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - validated HTTPS API
        data = json.load(response)
    hits = []
    for item in data.get("web", {}).get("results", []):
        try:
            url_value = canonical_url(str(item.get("url", "")))
        except ValueError:
            continue
        hits.append(
            SearchHit(
                url=url_value,
                title=normalize_space(str(item.get("title", ""))),
                description=normalize_space(str(item.get("description", ""))),
                language=language,
                level=level,
                category=category,
                query=query,
                discovery_provider="brave",
            )
        )
    return hits


def mediawiki_search(
    query: str,
    *,
    language: str,
    level: str,
    category: str,
    count: int,
    timeout: float,
    project: str,
) -> list[SearchHit]:
    host = f"{language}.{project}.org"
    params = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "list": "search",
            "srsearch": query,
            "srlimit": min(max(count, 1), 20),
            "srnamespace": "0",
            "utf8": "1",
        }
    )
    api_url = f"https://{host}/w/api.php?{params}"
    try:
        payload, _ = http_get(api_url, timeout=timeout)
        data = json.loads(payload)
    except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError):
        return []
    hits = []
    for item in data.get("query", {}).get("search", []):
        title = normalize_space(str(item.get("title", "")))
        if not title:
            continue
        page_url = f"https://{host}/wiki/{urllib.parse.quote(title.replace(' ', '_'), safe='/:')}"
        snippet = normalize_space(re.sub(r"<[^>]+>", " ", str(item.get("snippet", ""))))
        hits.append(
            SearchHit(
                url=page_url,
                title=title,
                description=snippet,
                language=language,
                level=level,
                category=category,
                query=query,
                discovery_provider="mediawiki",
            )
        )
    return hits


def build_queries(
    languages: Sequence[str], levels: Sequence[str]
) -> Iterator[tuple[str, str, str, str]]:
    for language in languages:
        for level in levels:
            for category, template in LANGUAGE_CONFIG[language]["queries"].items():
                yield language, level, category, template.format(level=level)


def curated_hits(languages: Sequence[str], levels: Sequence[str]) -> Iterator[SearchHit]:
    selected_languages = set(languages)
    selected_levels = set(levels)
    for language, level, category, url in CURATED_REFERENCE_SOURCES:
        if language not in selected_languages or level not in selected_levels:
            continue
        yield SearchHit(
            url=url,
            title="",
            description="",
            language=language,
            level=level,
            category=category,
            query=f"curated {LANGUAGE_CONFIG[language]['name']} {level} {category}",
            discovery_provider="curated",
        )


def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS collection_runs (
            id INTEGER PRIMARY KEY,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            languages TEXT NOT NULL,
            levels TEXT NOT NULL,
            query_count INTEGER NOT NULL DEFAULT 0,
            discovered_count INTEGER NOT NULL DEFAULT 0,
            fetched_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS research_sources (
            url TEXT PRIMARY KEY,
            language TEXT NOT NULL,
            level_hint TEXT NOT NULL,
            category TEXT NOT NULL,
            query TEXT NOT NULL,
            discovery_provider TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            excerpt TEXT NOT NULL DEFAULT '',
            extracted_text TEXT,
            license TEXT NOT NULL,
            usage_policy TEXT NOT NULL,
            attribution_url TEXT NOT NULL,
            content_type TEXT,
            content_sha256 TEXT,
            fetch_status TEXT NOT NULL,
            error TEXT,
            discovered_at TEXT NOT NULL,
            retrieved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS research_sources_language_level_idx
            ON research_sources(language, level_hint, category);
        CREATE INDEX IF NOT EXISTS research_sources_policy_idx
            ON research_sources(usage_policy, fetch_status);
        CREATE TABLE IF NOT EXISTS source_discoveries (
            url TEXT NOT NULL REFERENCES research_sources(url) ON DELETE CASCADE,
            language TEXT NOT NULL,
            level_hint TEXT NOT NULL,
            category TEXT NOT NULL,
            query TEXT NOT NULL,
            discovery_provider TEXT NOT NULL,
            discovered_at TEXT NOT NULL,
            PRIMARY KEY (
                url, language, level_hint, category, query, discovery_provider
            )
        );
        CREATE INDEX IF NOT EXISTS source_discoveries_language_level_idx
            ON source_discoveries(language, level_hint, category);
        INSERT OR IGNORE INTO source_discoveries (
            url, language, level_hint, category, query, discovery_provider, discovered_at
        )
        SELECT
            url, language, level_hint, category, query, discovery_provider, discovered_at
        FROM research_sources;
        """
    )
    return connection


def upsert_source(
    connection: sqlite3.Connection,
    hit: SearchHit,
    *,
    page: ExtractedPage | None,
    status: str,
    error: str | None,
) -> None:
    policy = source_policy(hit.url)
    now = datetime.now(UTC).isoformat()
    title = page.title if page and page.title else hit.title
    description = page.description if page and page.description else hit.description
    excerpt = page.excerpt if page else hit.description[:MAX_EXCERPT_CHARS]
    text = page.text if page else None
    checksum = hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None
    connection.execute(
        """
        INSERT INTO research_sources (
            url, language, level_hint, category, query, discovery_provider,
            title, description, excerpt, extracted_text, license, usage_policy,
            attribution_url, content_type, content_sha256, fetch_status, error,
            discovered_at, retrieved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            title = CASE WHEN excluded.title <> ''
                THEN excluded.title ELSE research_sources.title END,
            description = CASE WHEN excluded.description <> ''
                THEN excluded.description ELSE research_sources.description END,
            excerpt = CASE WHEN excluded.excerpt <> ''
                THEN excluded.excerpt ELSE research_sources.excerpt END,
            extracted_text = COALESCE(excluded.extracted_text, research_sources.extracted_text),
            license = excluded.license,
            usage_policy = excluded.usage_policy,
            content_type = COALESCE(excluded.content_type, research_sources.content_type),
            content_sha256 = COALESCE(excluded.content_sha256, research_sources.content_sha256),
            fetch_status = excluded.fetch_status,
            error = excluded.error,
            retrieved_at = COALESCE(excluded.retrieved_at, research_sources.retrieved_at)
        """,
        (
            hit.url,
            hit.language,
            hit.level,
            hit.category,
            hit.query,
            hit.discovery_provider,
            title,
            description,
            excerpt,
            text,
            policy["license"],
            policy["usage_policy"],
            hit.url,
            page.content_type if page else None,
            checksum,
            status,
            error,
            now,
            now if page else None,
        ),
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO source_discoveries (
            url, language, level_hint, category, query, discovery_provider, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            hit.url,
            hit.language,
            hit.level,
            hit.category,
            hit.query,
            hit.discovery_provider,
            now,
        ),
    )


def export_jsonl(connection: sqlite3.Connection, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        SELECT
            discovery.language,
            discovery.level_hint,
            discovery.category,
            discovery.query,
            discovery.discovery_provider,
            discovery.discovered_at,
            source.url,
            source.title,
            source.description,
            source.excerpt,
            source.extracted_text,
            source.license,
            source.usage_policy,
            source.attribution_url,
            source.content_type,
            source.content_sha256,
            source.fetch_status,
            source.error,
            source.retrieved_at
        FROM source_discoveries AS discovery
        JOIN research_sources AS source ON source.url = discovery.url
        ORDER BY discovery.language, discovery.level_hint, discovery.category, source.url
        """
    )
    with destination.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(dict(row), ensure_ascii=False) + "\n")


def deduplicate(hits: Iterable[SearchHit]) -> list[SearchHit]:
    unique: dict[str, SearchHit] = {}
    for hit in hits:
        try:
            normalized = canonical_url(hit.url)
        except ValueError:
            continue
        unique.setdefault(normalized, SearchHit(**{**asdict(hit), "url": normalized}))
    return list(unique.values())


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--languages", nargs="+", choices=sorted(LANGUAGE_CONFIG), default=["en", "es", "fr", "it"]
    )
    parser.add_argument("--levels", nargs="+", choices=["A1", "A2", "B1", "B2"], default=["A1"])
    parser.add_argument("--results-per-query", type=int, default=5)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--export-jsonl", type=Path)
    parser.add_argument(
        "--delay", type=float, default=1.0, help="Minimum delay between page fetches"
    )
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument(
        "--metadata-only", action="store_true", help="Discover sources without fetching pages"
    )
    parser.add_argument("--skip-mediawiki", action="store_true")
    parser.add_argument("--skip-brave", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.results_per_query < 1 or args.results_per_query > 20:
        raise SystemExit("--results-per-query must be between 1 and 20")
    if args.delay < 0.5:
        raise SystemExit("--delay must be at least 0.5 seconds")

    connection = connect_database(args.output)
    started_at = datetime.now(UTC).isoformat()
    cursor = connection.execute(
        "INSERT INTO collection_runs(started_at, languages, levels) VALUES (?, ?, ?)",
        (started_at, json.dumps(args.languages), json.dumps(args.levels)),
    )
    run_id = int(cursor.lastrowid or 0)
    all_hits: list[SearchHit] = []
    all_hits.extend(curated_hits(args.languages, args.levels))
    query_count = 0
    errors = 0

    for language, level, category, query in build_queries(args.languages, args.levels):
        query_count += 1
        print(f"discover [{language}/{level}/{category}] {query}")
        if not args.skip_mediawiki:
            wiki_query = str(LANGUAGE_CONFIG[language]["wiki_queries"][category]).format(
                level=level
            )
            projects = ["wikinews"] if category == "news" else ["wikibooks", "wikiversity"]
            for project in projects:
                all_hits.extend(
                    mediawiki_search(
                        wiki_query,
                        language=language,
                        level=level,
                        category=category,
                        count=args.results_per_query,
                        timeout=args.timeout,
                        project=project,
                    )
                )
        if not args.skip_brave:
            try:
                all_hits.extend(
                    brave_search(
                        query,
                        language=language,
                        level=level,
                        category=category,
                        count=args.results_per_query,
                    )
                )
            except (OSError, ValueError, urllib.error.URLError) as exc:
                errors += 1
                print(f"warning: Brave search failed: {exc}", file=sys.stderr)

    hits = deduplicate(all_hits)
    fetched = 0
    robots_cache: dict[str, urllib.robotparser.RobotFileParser] = {}
    for index, hit in enumerate(hits, start=1):
        policy = source_policy(hit.url)
        if args.metadata_only:
            upsert_source(connection, hit, page=None, status="discovered", error=None)
            continue
        try:
            if not robots_allows(hit.url, timeout=args.timeout, cache=robots_cache):
                upsert_source(connection, hit, page=None, status="robots_denied", error=None)
                continue
            payload, headers = http_get(hit.url, timeout=args.timeout)
            page = extract_page(payload, headers, allow_full_text=bool(policy["allow_full_text"]))
            upsert_source(connection, hit, page=page, status="fetched", error=None)
            fetched += 1
        except (OSError, ValueError, urllib.error.URLError) as exc:
            errors += 1
            upsert_source(connection, hit, page=None, status="fetch_error", error=str(exc)[:500])
        connection.commit()
        if index < len(hits):
            time.sleep(args.delay)

    finished_at = datetime.now(UTC).isoformat()
    connection.execute(
        """
        UPDATE collection_runs
        SET finished_at = ?, query_count = ?, discovered_count = ?,
            fetched_count = ?, error_count = ?
        WHERE id = ?
        """,
        (finished_at, query_count, len(hits), fetched, errors, run_id),
    )
    connection.commit()
    if args.export_jsonl:
        export_jsonl(connection, args.export_jsonl)
    print(f"saved {len(hits)} sources ({fetched} fetched, {errors} errors) to {args.output}")
    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
