from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("collect_language_sources.py")
SPEC = importlib.util.spec_from_file_location("collect_language_sources", SCRIPT_PATH)
assert SPEC and SPEC.loader
collector = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = collector
SPEC.loader.exec_module(collector)


def test_query_matrix_contains_every_a1_language_and_category() -> None:
    queries = list(collector.build_queries(["en", "es", "fr", "it"], ["A1"]))
    assert len(queries) == 16
    assert {language for language, _, _, _ in queries} == {"en", "es", "fr", "it"}
    assert {category for _, _, category, _ in queries} == {
        "explanation",
        "exercise",
        "news",
        "text",
    }


def test_canonical_url_removes_tracking_and_fragment() -> None:
    assert collector.canonical_url("https://Example.com/path?utm_source=x&id=2#part") == (
        "https://example.com/path?id=2"
    )


def test_source_policy_only_allows_full_text_for_open_sources() -> None:
    assert collector.source_policy("https://en.wikibooks.org/wiki/English")["allow_full_text"]
    assert not collector.source_policy(
        "https://learnenglish.britishcouncil.org/free-resources/reading/a1"
    )["allow_full_text"]
    assert not collector.source_policy("https://unknown.example/article")["allow_full_text"]


def test_html_extraction_limits_reference_only_source_to_excerpt() -> None:
    class Headers:
        @staticmethod
        def get_content_type() -> str:
            return "text/html"

        @staticmethod
        def get_content_charset() -> str:
            return "utf-8"

    payload = b"""
        <html><head><title>A1 lesson</title><meta name="description" content="Short summary"></head>
        <body><main><p>
        This is a sufficiently long paragraph for extraction and testing.
        </p></main></body></html>
    """
    page = collector.extract_page(payload, Headers(), allow_full_text=False)
    assert page.title == "A1 lesson"
    assert page.excerpt == "Short summary"
    assert page.text is None


def test_database_is_local_and_deduplicates_by_url(tmp_path: Path) -> None:
    database = tmp_path / "research.sqlite3"
    connection = collector.connect_database(database)
    hit = collector.SearchHit(
        url="https://en.wikibooks.org/wiki/English",
        title="English",
        description="Open lesson",
        language="en",
        level="A1",
        category="explanation",
        query="learn English A1 grammar explanation",
        discovery_provider="test",
    )
    collector.upsert_source(connection, hit, page=None, status="discovered", error=None)
    collector.upsert_source(connection, hit, page=None, status="discovered", error=None)
    connection.commit()
    count = connection.execute("SELECT count(*) FROM research_sources").fetchone()[0]
    assert count == 1
    second_level_hit = collector.SearchHit(
        **{**collector.asdict(hit), "level": "B2", "query": "English B2 grammar explanation"}
    )
    collector.upsert_source(
        connection,
        second_level_hit,
        page=None,
        status="discovered",
        error=None,
    )
    connection.commit()
    discoveries = connection.execute("SELECT count(*) FROM source_discoveries").fetchone()[0]
    assert discoveries == 2
    assert isinstance(connection, sqlite3.Connection)
    connection.close()
