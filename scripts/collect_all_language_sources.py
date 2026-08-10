#!/usr/bin/env python3
"""Run the language source collector for every supported language and CEFR level."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

LANGUAGES = ("en", "es", "fr", "it")
LEVELS = ("A1", "A2", "B1", "B2")
MAX_RESULTS_PER_QUERY = 20
PROJECT_ROOT = Path(__file__).resolve().parent.parent
COLLECTOR = PROJECT_ROOT / "scripts" / "collect_language_sources.py"
DEFAULT_OUTPUT = PROJECT_ROOT / ".local" / "content-research" / "sources.sqlite3"
DEFAULT_JSONL = PROJECT_ROOT / ".local" / "content-research" / "sources.jsonl"
DEFAULT_LOG_DIR = PROJECT_ROOT / ".local" / "content-research" / "logs"


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--export-jsonl", type=Path, default=DEFAULT_JSONL)
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--retry-delay", type=float, default=5.0)
    parser.add_argument("--skip-brave", action="store_true")
    parser.add_argument("--skip-mediawiki", action="store_true")
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def build_command(args: argparse.Namespace, language: str, level: str) -> list[str]:
    command = [
        sys.executable,
        str(COLLECTOR),
        "--languages",
        language,
        "--levels",
        level,
        "--results-per-query",
        str(MAX_RESULTS_PER_QUERY),
        "--delay",
        str(args.delay),
        "--timeout",
        str(args.timeout),
        "--output",
        str(args.output.resolve()),
    ]
    if args.skip_brave:
        command.append("--skip-brave")
    if args.skip_mediawiki:
        command.append("--skip-mediawiki")
    if args.metadata_only:
        command.append("--metadata-only")
    return command


def export_jsonl(database: Path, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
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
    count = 0
    with destination.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(dict(row), ensure_ascii=False) + "\n")
            count += 1
    connection.close()
    return count


def corpus_summary(database: Path) -> list[tuple[str, str, int]]:
    connection = sqlite3.connect(database)
    rows = connection.execute(
        """
        SELECT language, level_hint, count(DISTINCT url)
        FROM source_discoveries
        GROUP BY language, level_hint
        ORDER BY language, level_hint
        """
    ).fetchall()
    connection.close()
    return [(str(language), str(level), int(count)) for language, level, count in rows]


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.delay < 0.5:
        raise SystemExit("--delay must be at least 0.5 seconds")
    if args.retries < 0 or args.retries > 10:
        raise SystemExit("--retries must be between 0 and 10")
    if args.retry_delay < 0:
        raise SystemExit("--retry-delay cannot be negative")

    args.output = args.output.resolve()
    args.export_jsonl = args.export_jsonl.resolve()
    args.log_dir = args.log_dir.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.log_dir.mkdir(parents=True, exist_ok=True)

    has_brave_key = bool(os.getenv("BRAVE_SEARCH_API_KEY", "").strip())
    if not args.skip_brave and not has_brave_key:
        print(
            "BRAVE_SEARCH_API_KEY is not configured; continuing with curated and Wikimedia "
            "sources only.",
            file=sys.stderr,
        )

    failures: list[str] = []
    total = len(LANGUAGES) * len(LEVELS)
    position = 0
    for language in LANGUAGES:
        for level in LEVELS:
            position += 1
            label = f"{language}-{level.lower()}"
            command = build_command(args, language, level)
            print(f"[{position}/{total}] collecting {language}/{level}")
            if args.dry_run:
                print(" ".join(command))
                continue

            completed = False
            for attempt in range(1, args.retries + 2):
                started = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
                log_path = args.log_dir / f"{started}-{label}-attempt-{attempt}.log"
                with log_path.open("w", encoding="utf-8") as log:
                    result = subprocess.run(  # noqa: S603 - fixed local script and validated arguments
                        command,
                        cwd=PROJECT_ROOT,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                        check=False,
                        env=os.environ.copy(),
                    )
                if result.returncode == 0:
                    completed = True
                    print(f"  completed; log: {log_path}")
                    break
                print(
                    f"  attempt {attempt} failed with exit code {result.returncode}; "
                    f"log: {log_path}",
                    file=sys.stderr,
                )
                if attempt <= args.retries:
                    time.sleep(args.retry_delay * attempt)
            if not completed:
                failures.append(f"{language}/{level}")

    if args.dry_run:
        return 0
    if not args.output.exists():
        print("No SQLite corpus was created.", file=sys.stderr)
        return 1

    exported = export_jsonl(args.output, args.export_jsonl)
    print(f"\nCorpus: {args.output}")
    print(f"JSONL: {args.export_jsonl} ({exported} records)")
    for language, level, count in corpus_summary(args.output):
        print(f"  {language}/{level}: {count}")

    if failures:
        print(f"Failed combinations: {', '.join(failures)}", file=sys.stderr)
        return 1
    print("All language/level combinations completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
