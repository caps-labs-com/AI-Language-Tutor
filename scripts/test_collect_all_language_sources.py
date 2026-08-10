from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("collect_all_language_sources.py")
SPEC = importlib.util.spec_from_file_location("collect_all_language_sources", SCRIPT_PATH)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def test_runner_covers_all_language_level_combinations() -> None:
    combinations = {(language, level) for language in runner.LANGUAGES for level in runner.LEVELS}
    assert len(combinations) == 16
    assert ("en", "A1") in combinations
    assert ("it", "B2") in combinations


def test_command_uses_maximum_results_and_shared_database(tmp_path: Path) -> None:
    args = runner.parse_args(
        [
            "--output",
            str(tmp_path / "sources.sqlite3"),
            "--skip-brave",
            "--metadata-only",
        ]
    )
    command = runner.build_command(args, "fr", "B1")
    assert command[command.index("--results-per-query") + 1] == "20"
    assert command[command.index("--languages") + 1] == "fr"
    assert command[command.index("--levels") + 1] == "B1"
    assert "--skip-brave" in command
    assert "--metadata-only" in command
