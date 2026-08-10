#!/usr/bin/env python3
"""Validate generated candidates for schema, CEFR, correctness and originality."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from content_pipeline_common import (
    QUICK_QUESTION_COUNTS,
    READING_QUESTION_COUNTS,
    detect_language,
    estimate_cefr,
    load_curriculum,
    load_jsonl,
    normalized_text,
    now_iso,
    paragraphs,
    words,
    write_jsonl,
)


def add_length(
    errors: list[str], value: Any, name: str, minimum: int, maximum: int
) -> None:
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        errors.append(f"{name}_length_must_be_{minimum}_to_{maximum}")


def validate_questions(
    value: Any, expected: int, errors: list[str], prefix: str = "questions"
) -> None:
    if not isinstance(value, list) or len(value) != expected:
        errors.append(f"{prefix}_must_have_exactly_{expected}_items")
        return
    for index, question in enumerate(value):
        key = f"{prefix}[{index}]"
        if not isinstance(question, dict):
            errors.append(f"{key}_must_be_object")
            continue
        options = question.get("options")
        answer = question.get("answer_index")
        if (
            not isinstance(question.get("prompt"), str)
            or not question["prompt"].strip()
        ):
            errors.append(f"{key}_prompt_required")
        if (
            not isinstance(options, list)
            or not 2 <= len(options) <= 6
            or any(not isinstance(item, str) or not item.strip() for item in options)
        ):
            errors.append(f"{key}_options_invalid")
        elif len({normalized_text(item) for item in options}) != len(options):
            errors.append(f"{key}_options_not_distinct")
        if (
            not isinstance(answer, int)
            or not isinstance(options, list)
            or not 0 <= answer < len(options)
        ):
            errors.append(f"{key}_answer_index_invalid")
        if (
            not isinstance(question.get("explanation_pt_br"), str)
            or not question["explanation_pt_br"].strip()
        ):
            errors.append(f"{key}_explanation_required")


def ngram_containment(candidate: str, source: str, size: int = 8) -> float:
    left, right = words(normalized_text(candidate)), words(normalized_text(source))
    if len(left) < size or len(right) < size:
        return 0.0
    candidate_ngrams = {
        tuple(left[index : index + size]) for index in range(len(left) - size + 1)
    }
    source_ngrams = {
        tuple(right[index : index + size]) for index in range(len(right) - size + 1)
    }
    return len(candidate_ngrams & source_ngrams) / max(1, len(candidate_ngrams))


def candidate_text(content: dict[str, Any]) -> str:
    chunks: list[str] = []
    for key in ("title", "body", "overview_pt_br", "formation_pt_br"):
        if isinstance(content.get(key), str):
            chunks.append(content[key])
    for key in (
        "use_cases",
        "common_mistakes",
        "notes_pt_br",
        "questions",
        "exercises",
    ):
        if key in content:
            chunks.append(json.dumps(content[key], ensure_ascii=False))
    return "\n".join(chunks)


def validate(
    candidate: dict[str, Any],
    curriculum: dict,
    approved: dict[str, dict],
    source_text: dict[str, str],
    similarity_limit: float,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    language, level, kind = (
        candidate.get("language"),
        candidate.get("level"),
        candidate.get("content_type"),
    )
    content = candidate.get("content")
    supported = language in curriculum["languages"] and level in curriculum["levels"]
    if not supported:
        errors.append("unsupported_language_or_level")
    if kind not in {"reading", "grammar", "quick_lesson"} or not isinstance(
        content, dict
    ):
        errors.append("invalid_content_type_or_content")
        content = {}
    allowed_concepts = (
        set(curriculum["language_curricula"][language][level]["grammar"])
        if supported
        else set()
    )
    if (
        not candidate.get("curriculum_concept_ids")
        or not set(candidate["curriculum_concept_ids"]) <= allowed_concepts
    ):
        errors.append("curriculum_concept_not_allowed")
    source_ids = candidate.get("source_ids", [])
    if not isinstance(source_ids, list) or not source_ids:
        errors.append("source_ids_must_be_non_empty_array")
        source_ids = []
    elif any(
        not isinstance(source_id, str) or source_id not in approved
        for source_id in source_ids
    ):
        errors.append("source_not_approved")
    add_length(errors, content.get("title"), "title", 1, 160)
    target_text = str(
        content.get("body")
        or " ".join(
            str(item.get("example", ""))
            for item in content.get("exercises", [])
            if isinstance(item, dict)
        )
    )
    detected, language_confidence, _ = detect_language(target_text)
    if detected != language or language_confidence < 0.4:
        errors.append("generated_target_language_mismatch")
    estimated, level_confidence, level_metrics = estimate_cefr(target_text)
    if estimated != level:
        warnings.append(f"heuristic_cefr_estimate_is_{estimated}")
    if kind in {"reading", "quick_lesson"} and supported:
        add_length(
            errors,
            content.get("body"),
            "body",
            1,
            20_000 if kind == "reading" else 10_000,
        )
        count = (
            READING_QUESTION_COUNTS if kind == "reading" else QUICK_QUESTION_COUNTS
        )[level]
        validate_questions(content.get("questions"), count, errors)
        if isinstance(content.get("questions"), list):
            body_normalized = normalized_text(str(content.get("body", "")))
            for index, question in enumerate(content["questions"]):
                if not isinstance(question, dict):
                    continue
                options, answer = question.get("options"), question.get("answer_index")
                if (
                    isinstance(options, list)
                    and isinstance(answer, int)
                    and 0 <= answer < len(options)
                ):
                    correct = normalized_text(str(options[answer]))
                    if correct and correct not in body_normalized:
                        warnings.append(
                            f"questions[{index}]_answer_not_verbatim_in_body_review_semantics"
                        )
        if kind == "reading":
            limits = curriculum["common"]["levels"][level]["content_limits"]
            word_count = len(words(str(content.get("body", ""))))
            if (
                not limits["reading_words_min"]
                <= word_count
                <= limits["reading_words_max"]
            ):
                errors.append("reading_word_count_outside_curriculum")
            if (
                not limits["paragraphs_min"]
                <= len(paragraphs(str(content.get("body", ""))))
                <= limits["paragraphs_max"]
            ):
                errors.append("reading_paragraph_count_outside_curriculum")
    elif kind == "grammar" and supported:
        add_length(errors, content.get("overview_pt_br"), "overview_pt_br", 80, 5000)
        add_length(errors, content.get("formation_pt_br"), "formation_pt_br", 40, 3000)
        for key, minimum in (
            ("use_cases", 2),
            ("common_mistakes", 2),
            ("notes_pt_br", 1),
        ):
            value = content.get(key)
            if (
                not isinstance(value, list)
                or not minimum <= len(value) <= 8
                or any(not isinstance(item, str) or not item.strip() for item in value)
            ):
                errors.append(f"{key}_invalid")
        exercises = content.get("exercises")
        if not isinstance(exercises, list) or len(exercises) != 5:
            errors.append("grammar_must_have_exactly_5_exercises")
        else:
            validate_questions(
                [
                    {**item, "explanation_pt_br": item.get("explanation", "")}
                    for item in exercises
                    if isinstance(item, dict)
                ],
                5,
                errors,
                "exercises",
            )
            for index, item in enumerate(exercises):
                if isinstance(item, dict):
                    add_length(
                        errors,
                        item.get("example"),
                        f"exercises[{index}]_example",
                        1,
                        1000,
                    )
    text = target_text
    similarities = {
        source_id: round(
            ngram_containment(text, source_text.get(approved[source_id]["url"], "")), 4
        )
        for source_id in source_ids
        if source_id in approved
    }
    maximum_similarity = max(similarities.values(), default=0.0)
    if maximum_similarity > similarity_limit:
        errors.append("source_similarity_above_limit")
    result = dict(candidate)
    result["status"] = "approved" if not errors else "rejected"
    result["validation"] = {
        "validated_at": now_iso(),
        "errors": errors,
        "warnings": warnings,
        "detected_language": detected,
        "language_confidence": language_confidence,
        "estimated_level": estimated,
        "level_confidence": level_confidence,
        "level_metrics": level_metrics,
        "source_8gram_containment": similarities,
        "maximum_similarity": maximum_similarity,
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, default=Path(".local/content-research/candidates.jsonl")
    )
    parser.add_argument(
        "--audit", type=Path, default=Path(".local/content-research/audit.jsonl")
    )
    parser.add_argument(
        "--database", type=Path, default=Path(".local/content-research/sources.sqlite3")
    )
    parser.add_argument(
        "--curriculum", type=Path, default=Path("curriculum/cefr_matrix.json")
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".local/content-research/validated-candidates.jsonl"),
    )
    parser.add_argument("--similarity-limit", type=float, default=0.12)
    args = parser.parse_args()
    approved = {
        row["audit_id"]: row
        for row in load_jsonl(args.audit)
        if row.get("approved") is True
    }
    connection = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    source_text = dict(
        connection.execute(
            "select url, coalesce(extracted_text, '') from research_sources"
        )
    )
    connection.close()
    curriculum = load_curriculum(args.curriculum)
    records = [
        validate(row, curriculum, approved, source_text, args.similarity_limit)
        for row in load_jsonl(args.input)
    ]
    write_jsonl(args.output, records)
    counts = Counter(row["status"] for row in records)
    print(json.dumps({"total": len(records), **counts, "output": str(args.output)}))
    return 1 if counts.get("rejected") else 0


if __name__ == "__main__":
    raise SystemExit(main())
