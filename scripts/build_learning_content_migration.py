#!/usr/bin/env python3
"""Build a reviewable, unpublished SQL migration from approved candidates only."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from content_pipeline_common import json_sql, load_jsonl, sql_literal


def insert_reading(row: dict, published: bool) -> str:
    content = row["content"]
    values = [
        row["candidate_id"],
        row["language"],
        row["level"],
        content["title"],
        content["body"],
    ]
    return f"""insert into public.reading_passages (id, language, level, title, body, questions, sort_order, is_published)
values ({", ".join(sql_literal(value) for value in values)}, {json_sql(content["questions"])}, 0, {str(published).lower()})
on conflict (id) do update set title=excluded.title, body=excluded.body, questions=excluded.questions, is_published=excluded.is_published, updated_at=now();"""


def insert_quick(row: dict, published: bool) -> str:
    content, first = row["content"], row["content"]["questions"][0]
    values = [
        row["candidate_id"],
        row["language"],
        row["level"],
        content["title"],
        content["body"],
        first["prompt"],
    ]
    return f"""insert into public.quick_lessons (id, language, level, title, body, question, options, answer_index, questions, sort_order, is_published)
values ({", ".join(sql_literal(value) for value in values)}, {json_sql(first["options"])}, {first["answer_index"]}, {json_sql(content["questions"])}, 0, {str(published).lower()})
on conflict (id) do update set title=excluded.title, body=excluded.body, question=excluded.question, options=excluded.options, answer_index=excluded.answer_index, questions=excluded.questions, is_published=excluded.is_published, updated_at=now();"""


def insert_grammar(row: dict, published: bool) -> str:
    content, topic_id = row["content"], row["candidate_id"]
    parts = [
        f"""insert into public.grammar_topics (id, language, level, title, overview_pt_br, formation_pt_br, use_cases, common_mistakes, notes_pt_br, sort_order, is_published)
values ({sql_literal(topic_id)}, {sql_literal(row["language"])}, {sql_literal(row["level"])}, {sql_literal(content["title"])}, {sql_literal(content["overview_pt_br"])}, {sql_literal(content["formation_pt_br"])}, {json_sql(content["use_cases"])}, {json_sql(content["common_mistakes"])}, {json_sql(content["notes_pt_br"])}, 0, {str(published).lower()})
on conflict (id) do update set title=excluded.title, overview_pt_br=excluded.overview_pt_br, formation_pt_br=excluded.formation_pt_br, use_cases=excluded.use_cases, common_mistakes=excluded.common_mistakes, notes_pt_br=excluded.notes_pt_br, is_published=excluded.is_published, updated_at=now();"""
    ]
    for index, exercise in enumerate(content["exercises"], 1):
        exercise_id = f"{topic_id}-exercise-{index:02d}"
        parts.append(f"""insert into public.grammar_exercises (id, language, level, title, explanation, example, question, options, answer_index, sort_order, is_published, topic_id)
values ({sql_literal(exercise_id)}, {sql_literal(row["language"])}, {sql_literal(row["level"])}, {sql_literal(exercise["title"])}, {sql_literal(exercise["explanation"])}, {sql_literal(exercise["example"])}, {sql_literal(exercise["question"])}, {json_sql(exercise["options"])}, {exercise["answer_index"]}, {index}, {str(published).lower()}, {sql_literal(topic_id)})
on conflict (id) do update set title=excluded.title, explanation=excluded.explanation, example=excluded.example, question=excluded.question, options=excluded.options, answer_index=excluded.answer_index, is_published=excluded.is_published, topic_id=excluded.topic_id, updated_at=now();""")
    return "\n\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(".local/content-research/validated-candidates.jsonl"),
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish immediately; default is safe unpublished staging",
    )
    args = parser.parse_args()
    approved = []
    for row in load_jsonl(args.input):
        validation = row.get("validation")
        if row.get("status") != "approved":
            continue
        if not isinstance(validation, dict) or validation.get("errors") != []:
            raise SystemExit(
                f"candidate claims approval without clean validation: {row.get('candidate_id')}"
            )
        if row.get("schema_version") != 1 or row.get("content_type") not in {
            "reading",
            "quick_lesson",
            "grammar",
        }:
            raise SystemExit(
                f"unsupported approved candidate contract: {row.get('candidate_id')}"
            )
        approved.append(row)
    if not approved:
        raise SystemExit("no approved candidates; no migration was created")
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    output = args.output or Path(
        f".local/content-research/migrations/{timestamp}_generated_learning_content.sql"
    )
    builders = {
        "reading": insert_reading,
        "quick_lesson": insert_quick,
        "grammar": insert_grammar,
    }
    statements = [builders[row["content_type"]](row, args.publish) for row in approved]
    header = "-- GENERATED FILE: review source provenance and content before applying.\n-- Content is unpublished unless --publish was explicitly used.\n\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(header + "\n\n".join(statements) + "\n", encoding="utf-8")
    manifest = output.with_suffix(".manifest.json")
    manifest.write_text(
        json.dumps(
            {
                "migration": str(output),
                "candidate_ids": [row["candidate_id"] for row in approved],
                "published": args.publish,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "included": len(approved),
                "output": str(output),
                "manifest": str(manifest),
                "published": args.publish,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
