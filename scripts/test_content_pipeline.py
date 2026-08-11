#!/usr/bin/env python3
"""Offline unit tests for content pipeline invariants."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from content_pipeline_common import detect_language, estimate_cefr
from generate_learning_candidates import mock_content, parse_model_json, select_sources
from validate_learning_candidates import (
    ngram_containment,
    validate_questions,
)


class ContentPipelineTests(unittest.TestCase):
    def test_detects_supported_languages(self) -> None:
        samples = {
            "en": "The student is in the classroom and the teacher is with the group.",
            "es": "El estudiante está en la clase y la profesora está con el grupo.",
            "fr": "Le professeur est dans la classe et les élèves sont avec le groupe.",
            "it": "Il professore è nella classe e gli studenti sono con il gruppo.",
        }
        for expected, text in samples.items():
            self.assertEqual(detect_language(text)[0], expected)

    def test_cefr_estimator_returns_supported_level(self) -> None:
        self.assertIn(
            estimate_cefr("I live here. I like tea. This is my friend.")[0],
            {"A1", "A2", "B1", "B2"},
        )

    def test_question_validator_rejects_duplicate_options(self) -> None:
        errors: list[str] = []
        validate_questions(
            [
                {
                    "prompt": "P?",
                    "options": ["x", "x"],
                    "answer_index": 0,
                    "explanation_pt_br": "E",
                }
            ],
            1,
            errors,
        )
        self.assertTrue(any("not_distinct" in error for error in errors))

    def test_similarity_detects_copy(self) -> None:
        text = "one two three four five six seven eight nine ten"
        self.assertGreater(ngram_containment(text, text), 0.99)

    def test_mock_readings_follow_database_question_counts(self) -> None:
        expected = {"A1": 3, "A2": 4, "B1": 6, "B2": 8}
        for level, count in expected.items():
            self.assertEqual(
                len(mock_content("reading", "en", level, "x")["questions"]), count
            )

    def test_source_selection_falls_back_to_nearby_level(self) -> None:
        records = [
            {
                "approved": True,
                "requested_language": "it",
                "requested_level": "A2",
                "category": "explanation",
                "url": "https://example.test/italiano-l2",
                "relevance_score": 0.9,
                "quality_score": 0.8,
            }
        ]
        selected = select_sources(records, "it", "A1", {"explanation"}, 4)
        self.assertEqual(selected, records)

    def test_grammar_mock_uses_database_question_field(self) -> None:
        content = mock_content("grammar", "it", "A1", "it.a1.example")
        self.assertTrue(
            all(exercise.get("question") for exercise in content["exercises"])
        )

    def test_grammar_canonicalizer_wraps_singular_notes(self) -> None:
        from content_pipeline_common import canonicalize_content

        content = canonicalize_content(
            "grammar", {"notes_pt_br": "Uma observação.", "exercises": []}
        )
        self.assertEqual(content["notes_pt_br"], ["Uma observação."])

    def test_reading_canonicalizer_unwraps_mixed_model_response(self) -> None:
        from content_pipeline_common import canonicalize_content

        reading = {"title": "A trip", "body": "A useful text.", "questions": []}
        content = canonicalize_content(
            "reading", {"content_type": "reading", "grammar": {}, "reading": reading}
        )
        self.assertEqual(content, reading)

    def test_repair_completeness_prefers_populated_reading(self) -> None:
        from content_pipeline_common import content_completeness_score

        complete = {
            "reading": {
                "title": "A trip",
                "body": "A useful text.",
                "questions": [{"prompt": "Where?"}],
            }
        }
        self.assertGreater(
            content_completeness_score("reading", complete),
            content_completeness_score("reading", {"title": "A trip"}),
        )

    def test_grammar_repair_prompt_does_not_require_question_count(self) -> None:
        from repair_learning_candidates import repair_prompt

        candidate = {
            "language": "en",
            "level": "A2",
            "content_type": "grammar",
            "curriculum_concept_ids": ["en.a2.example"],
            "validation": {"errors": [], "warnings": []},
            "content": {"title": "Example"},
        }
        curriculum = {
            "common": {"levels": {"A2": {"content_limits": {}}}}
        }
        self.assertIn("grammar fields", repair_prompt(candidate, curriculum))

    def test_model_json_parser_accepts_markdown_fence(self) -> None:
        self.assertEqual(parse_model_json('```json\n{"ok": true}\n```'), {"ok": True})

    def test_model_json_parser_rejects_empty_content(self) -> None:
        with self.assertRaisesRegex(ValueError, "empty"):
            parse_model_json("")


if __name__ == "__main__":
    unittest.main()
