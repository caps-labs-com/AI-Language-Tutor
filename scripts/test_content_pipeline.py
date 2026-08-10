#!/usr/bin/env python3
"""Offline unit tests for content pipeline invariants."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from content_pipeline_common import detect_language, estimate_cefr
from generate_learning_candidates import mock_content
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


if __name__ == "__main__":
    unittest.main()
