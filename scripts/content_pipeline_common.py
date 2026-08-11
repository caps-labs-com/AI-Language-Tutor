#!/usr/bin/env python3
"""Shared, dependency-free primitives for the research-to-content pipeline."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LANGUAGES = ("en", "es", "fr", "it")
LEVELS = ("A1", "A2", "B1", "B2")
LEVEL_INDEX = {level: index for index, level in enumerate(LEVELS)}
READING_QUESTION_COUNTS = {"A1": 3, "A2": 4, "B1": 6, "B2": 8}
QUICK_QUESTION_COUNTS = {"A1": 2, "A2": 3, "B1": 4, "B2": 5}
STOPWORDS = {
    "en": [
        "the",
        "and",
        "is",
        "are",
        "to",
        "of",
        "in",
        "that",
        "for",
        "with",
        "this",
        "you",
        "a",
        "an",
        "from",
        "on",
        "it",
        "as",
        "be",
        "have",
    ],
    "es": [
        "el",
        "la",
        "los",
        "las",
        "y",
        "es",
        "son",
        "de",
        "en",
        "que",
        "para",
        "con",
        "este",
        "esta",
        "un",
        "una",
        "por",
        "como",
        "tiene",
    ],
    "fr": [
        "le",
        "la",
        "les",
        "et",
        "est",
        "sont",
        "de",
        "des",
        "en",
        "que",
        "pour",
        "avec",
        "ce",
        "cette",
        "un",
        "une",
        "dans",
        "comme",
    ],
    "it": [
        "il",
        "lo",
        "la",
        "i",
        "gli",
        "le",
        "e",
        "è",
        "sono",
        "di",
        "del",
        "in",
        "che",
        "per",
        "con",
        "questo",
        "questa",
        "un",
        "una",
        "come",
    ],
}
CATEGORY_TERMS = {
    "explanation": (
        "grammar",
        "gramática",
        "grammaire",
        "grammatica",
        "lesson",
        "curso",
    ),
    "exercise": (
        "exercise",
        "exercises",
        "ejercicio",
        "ejercicios",
        "exercice",
        "exercices",
        "esercizio",
        "esercizi",
    ),
    "news": (
        "news",
        "noticia",
        "noticias",
        "actualité",
        "actualités",
        "notizia",
        "notizie",
    ),
    "text": (
        "text",
        "reading",
        "texto",
        "lectura",
        "texte",
        "lecture",
        "testo",
        "lettura",
    ),
}


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def words(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)?", text.casefold(), re.UNICODE)


def paragraphs(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]


def detect_language(text: str) -> tuple[str, float, dict[str, float]]:
    tokens = words(text[:30_000])
    counts = {
        code: sum(token in stop for token in tokens) for code, stop in STOPWORDS.items()
    }
    total = sum(counts.values())
    detected = max(counts, key=counts.get) if total else "unknown"
    confidence = counts.get(detected, 0) / total if total else 0.0
    return (
        detected,
        round(confidence, 4),
        {
            key: round(value / total, 4) if total else 0.0
            for key, value in counts.items()
        },
    )


def estimate_cefr(text: str) -> tuple[str, float, dict[str, float]]:
    tokens = words(text)
    sentences = [item for item in re.split(r"[.!?]+", text) if words(item)]
    average_sentence = len(tokens) / max(1, len(sentences))
    average_word = sum(len(token) for token in tokens) / max(1, len(tokens))
    long_ratio = sum(len(token) >= 8 for token in tokens) / max(1, len(tokens))
    score = average_sentence * 0.38 + average_word * 0.8 + long_ratio * 12
    level = (
        "A1" if score < 8.3 else "A2" if score < 10.8 else "B1" if score < 14 else "B2"
    )
    boundary_distance = min(abs(score - point) for point in (8.3, 10.8, 14.0))
    confidence = min(0.95, 0.45 + boundary_distance / 8)
    return (
        level,
        round(confidence, 4),
        {
            "score": round(score, 3),
            "average_sentence_words": round(average_sentence, 3),
            "average_word_chars": round(average_word, 3),
            "long_word_ratio": round(long_ratio, 4),
        },
    )


def normalized_text(text: str) -> str:
    value = unicodedata.normalize("NFKD", text.casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return " ".join(words(value))


def stable_id(*parts: str, prefix: str = "") -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:12]
    slug = re.sub(r"[^a-z0-9]+", "-", "-".join(parts[:3]).casefold()).strip("-")[:45]
    return f"{prefix}{slug}-{digest}"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    records = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise TypeError(f"{path}:{line_number}: expected a JSON object")
        records.append(value)
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        "".join(
            json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
            for record in records
        ),
        encoding="utf-8",
    )
    temporary.replace(path)


def load_curriculum(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError("curriculum must be a JSON object")
    return value


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def json_sql(value: Any) -> str:
    return (
        sql_literal(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        + "::jsonb"
    )


def canonicalize_content(content_type: str, value: dict[str, Any]) -> dict[str, Any]:
    """Normalize common model response variants into the database contract."""
    content = dict(value)

    wrapper_keys = {
        "reading": ("reading", "reading_passage", "passage", "content"),
        "quick_lesson": ("quick_lesson", "lesson", "content"),
        "grammar": ("grammar", "grammar_topic", "topic", "content"),
    }
    for key in wrapper_keys.get(content_type, ("content",)):
        if isinstance(content.get(key), dict):
            content = dict(content[key])
            break

    if content_type in {"reading", "quick_lesson"}:
        content["questions"] = _deduplicate_question_options(content.get("questions"))
        return content
    if content_type != "grammar":
        return content
    for key in ("use_cases", "common_mistakes", "notes_pt_br"):
        if isinstance(content.get(key), str) and content[key].strip():
            content[key] = [content[key].strip()]
    exercises = content.get("exercises")
    if not isinstance(exercises, list):
        return content
    normalized = []
    for index, raw in enumerate(exercises, 1):
        if not isinstance(raw, dict):
            normalized.append(raw)
            continue
        exercise = dict(raw)
        exercise.setdefault("title", f"Exercício {index}")
        if "question" not in exercise and isinstance(exercise.get("prompt"), str):
            exercise["question"] = exercise["prompt"]
        if "explanation" not in exercise and isinstance(
            exercise.get("explanation_pt_br"), str
        ):
            exercise["explanation"] = exercise["explanation_pt_br"]
        if "example" not in exercise:
            question = exercise.get("question")
            options = exercise.get("options")
            answer = exercise.get("answer_index")
            if (
                isinstance(question, str)
                and isinstance(options, list)
                and isinstance(answer, int)
                and 0 <= answer < len(options)
            ):
                exercise["example"] = question.replace("___", str(options[answer]))
        normalized.append(_deduplicate_options(exercise))
    content["exercises"] = normalized
    return content


def _deduplicate_question_options(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    return [
        _deduplicate_options(item) if isinstance(item, dict) else item for item in value
    ]


def _deduplicate_options(question: dict[str, Any]) -> dict[str, Any]:
    """Remove normalized duplicate options while preserving the correct answer."""
    options = question.get("options")
    answer = question.get("answer_index")
    if not isinstance(options, list) or not isinstance(answer, int):
        return question
    if not 0 <= answer < len(options) or any(not isinstance(item, str) for item in options):
        return question

    unique: list[str] = []
    index_by_value: dict[str, int] = {}
    old_to_new: list[int] = []
    for option in options:
        key = normalized_text(option)
        if not key or key not in index_by_value:
            index_by_value[key] = len(unique)
            unique.append(option)
        old_to_new.append(index_by_value[key])
    if len(unique) == len(options):
        return question
    normalized = dict(question)
    normalized["options"] = unique
    normalized["answer_index"] = old_to_new[answer]
    return normalized


def content_completeness_score(content_type: str, value: dict[str, Any]) -> int:
    """Score structural completeness so a model repair cannot erase valid content."""
    content = canonicalize_content(content_type, value)
    score = sum(
        isinstance(content.get(key), str) and bool(content[key].strip())
        for key in ("title", "body", "overview_pt_br", "formation_pt_br")
    )
    list_keys = (
        ("questions",)
        if content_type in {"reading", "quick_lesson"}
        else ("use_cases", "common_mistakes", "notes_pt_br", "exercises")
    )
    for key in list_keys:
        items = content.get(key)
        if isinstance(items, list):
            score += 1 + len(items)
    return score
