from __future__ import annotations

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MATRIX_PATH = PROJECT_ROOT / "curriculum" / "cefr_matrix.json"


def load_matrix() -> dict:
    return json.loads(MATRIX_PATH.read_text(encoding="utf-8"))


def test_matrix_covers_every_supported_language_and_level() -> None:
    matrix = load_matrix()
    assert matrix["languages"] == ["en", "es", "fr", "it"]
    assert matrix["levels"] == ["A1", "A2", "B1", "B2"]
    assert set(matrix["common"]["levels"]) == set(matrix["levels"])
    for language in matrix["languages"]:
        assert set(matrix["language_curricula"][language]) == set(matrix["levels"])


def test_every_language_level_has_substantial_unique_grammar_curriculum() -> None:
    matrix = load_matrix()
    all_concepts: list[str] = []
    for language in matrix["languages"]:
        for level in matrix["levels"]:
            curriculum = matrix["language_curricula"][language][level]
            assert len(curriculum["grammar"]) >= 10
            assert len(curriculum["pronunciation"]) >= 5
            expected_prefix = f"{language}.{level.lower()}."
            assert all(concept.startswith(expected_prefix) for concept in curriculum["grammar"])
            all_concepts.extend(curriculum["grammar"])
    assert len(all_concepts) == len(set(all_concepts))


def test_content_complexity_progresses_by_level() -> None:
    matrix = load_matrix()
    common = matrix["common"]["levels"]
    previous_words = 0
    previous_questions = 0
    for level in matrix["levels"]:
        limits = common[level]["content_limits"]
        assert limits["reading_words_min"] > previous_words
        assert limits["questions_min"] >= previous_questions
        assert limits["reading_words_min"] < limits["reading_words_max"]
        assert limits["writing_words_min"] < limits["writing_words_max"]
        previous_words = limits["reading_words_min"]
        previous_questions = limits["questions_min"]


def test_mastery_requires_multiple_sessions_and_productive_evidence() -> None:
    policy = load_matrix()["mastery_policy"]
    assert policy["minimum_correct_evidence"] >= 3
    assert policy["minimum_distinct_sessions"] >= 2
    assert policy["requires_productive_evidence"] is True
    assert policy["requires_delayed_retention_check"] is True
