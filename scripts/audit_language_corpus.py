#!/usr/bin/env python3
"""Audit collected sources before they may be used by a content generator."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path

from content_pipeline_common import (
    CATEGORY_TERMS,
    LEVEL_INDEX,
    detect_language,
    estimate_cefr,
    now_iso,
    stable_id,
    words,
    write_jsonl,
)

DEFAULT_DB = Path(".local/content-research/sources.sqlite3")
DEFAULT_OUTPUT = Path(".local/content-research/audit.jsonl")


def quality_score(text: str) -> tuple[float, dict[str, float]]:
    tokens = words(text)
    unique_ratio = len(set(tokens)) / max(1, len(tokens))
    alpha_ratio = sum(char.isalpha() or char.isspace() for char in text) / max(
        1, len(text)
    )
    length_score = min(1.0, len(tokens) / 500)
    score = (
        0.45 * length_score + 0.25 * min(1.0, unique_ratio / 0.35) + 0.3 * alpha_ratio
    )
    return round(score, 4), {
        "word_count": len(tokens),
        "unique_word_ratio": round(unique_ratio, 4),
        "alphabetic_ratio": round(alpha_ratio, 4),
    }


def relevance_score(title: str, description: str, text: str, category: str) -> float:
    haystack = f"{title} {title} {description} {text[:5000]}".casefold()
    matches = sum(
        haystack.count(term.casefold()) for term in CATEGORY_TERMS.get(category, ())
    )
    general = sum(
        haystack.count(term)
        for term in (
            "learn",
            "level",
            "language",
            "grammar",
            "comprensión",
            "compréhension",
        )
    )
    return round(min(1.0, matches / 3 + general / 20), 4)


def audit(
    database: Path, minimum_quality: float, minimum_relevance: float
) -> list[dict]:
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """
        select d.url, d.language, d.level_hint, d.category, d.query,
               s.title, s.description, s.extracted_text, s.excerpt, s.license,
               s.usage_policy, s.fetch_status, s.attribution_url, s.content_sha256
        from source_discoveries d join research_sources s on s.url = d.url
        order by d.language, d.level_hint, d.category, d.url
        """
    ).fetchall()
    connection.close()
    results = []
    for row in rows:
        text = row["extracted_text"] or row["excerpt"] or ""
        detected, language_confidence, language_scores = detect_language(text)
        estimated, level_confidence, level_metrics = estimate_cefr(text)
        quality, quality_metrics = quality_score(text)
        relevance = relevance_score(
            row["title"], row["description"], text, row["category"]
        )
        reasons = []
        warnings = []
        if row["usage_policy"] != "open_research_with_attribution":
            reasons.append("usage_policy_not_approved")
        if row["fetch_status"] != "fetched":
            reasons.append("source_not_fetched")
        if detected != row["language"] or language_confidence < 0.45:
            reasons.append("language_mismatch_or_low_confidence")
        if quality < minimum_quality:
            reasons.append("quality_below_threshold")
        if relevance < minimum_relevance:
            reasons.append("relevance_below_threshold")
        level_distance = abs(
            LEVEL_INDEX.get(estimated, 0) - LEVEL_INDEX.get(row["level_hint"], 0)
        )
        if level_distance > 1:
            # Source complexity is metadata, not a publication constraint. A B1/B2
            # source may safely ground a wholly original A1 candidate. The final
            # candidate validator is responsible for enforcing the requested CEFR.
            warnings.append("source_cefr_far_from_requested_generation_level")
        results.append(
            {
                "schema_version": 1,
                "audit_id": stable_id(
                    row["url"],
                    row["language"],
                    row["level_hint"],
                    row["category"],
                    prefix="audit-",
                ),
                "url": row["url"],
                "attribution_url": row["attribution_url"],
                "requested_language": row["language"],
                "requested_level": row["level_hint"],
                "category": row["category"],
                "query": row["query"],
                "title": row["title"],
                "license": row["license"],
                "usage_policy": row["usage_policy"],
                "content_sha256": row["content_sha256"],
                "detected_language": detected,
                "language_confidence": language_confidence,
                "language_scores": language_scores,
                "estimated_level": estimated,
                "level_confidence": level_confidence,
                "level_metrics": level_metrics,
                "relevance_score": relevance,
                "quality_score": quality,
                "quality_metrics": quality_metrics,
                "approved": not reasons,
                "rejection_reasons": reasons,
                "audit_warnings": warnings,
                "audited_at": now_iso(),
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--summary", type=Path, default=DEFAULT_OUTPUT.with_name("audit-summary.json")
    )
    parser.add_argument("--minimum-quality", type=float, default=0.55)
    parser.add_argument("--minimum-relevance", type=float, default=0.35)
    args = parser.parse_args()
    records = audit(args.database, args.minimum_quality, args.minimum_relevance)
    write_jsonl(args.output, records)
    counts = Counter("approved" if row["approved"] else "rejected" for row in records)
    coverage = Counter(
        f"{row['requested_language']}/{row['requested_level']}/{row['category']}"
        for row in records
        if row["approved"]
    )
    rejection_reasons = Counter(
        reason for row in records for reason in row["rejection_reasons"]
    )
    warning_reasons = Counter(
        warning for row in records for warning in row["audit_warnings"]
    )
    summary = {
        "total": len(records),
        **counts,
        "approved_coverage": dict(sorted(coverage.items())),
        "rejection_reasons": dict(rejection_reasons.most_common()),
        "warning_reasons": dict(warning_reasons.most_common()),
        "output": str(args.output),
        "generated_at": now_iso(),
    }
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
