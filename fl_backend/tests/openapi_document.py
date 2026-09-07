import argparse
import json
from pathlib import Path
from typing import Any

from app.main import create_app
from tests.config import build_test_config

DOCUMENT_PATH = Path(__file__).resolve().parents[1] / "openapi.json"

REGENERATE = "cd fl_backend && python -m tests.openapi_document --write"

# Both repairs, because the rewrite alone is the wrong one for a narrowing nobody asked for: it
# accepts whatever moved, and the document then agrees with the models about a change no one meant.
DRIFT_REPAIR = f"A change nobody meant is repaired in the models, never here.\nRefresh the document for an intended one with:  {REGENERATE}"

# Long enough to tell one pattern or enum from another; the document itself carries the whole value,
# and the key path printed above it is what finds it.
VALUE_CHARS = 200


def build_document() -> dict[str, Any]:
    return create_app(build_test_config()).openapi()


def read_document() -> dict[str, Any]:
    """Parsed, never compared as bytes: prettier owns this file's formatting."""
    return json.loads(DOCUMENT_PATH.read_text(encoding="utf-8"))


def serialize(document: dict[str, Any]) -> str:
    """`ensure_ascii=False` so the German prose in the endpoint summaries stays readable in a diff."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _section_keys(document: dict[str, Any], section: str) -> set[str]:
    inner = document.get(section, {})
    return set(inner.get("schemas", {}) if section == "components" else inner)


def _render_key(path: str, key: str | int) -> str:
    step = f".{key}" if isinstance(key, str) and key.isidentifier() else f"[{key!r}]"
    return f"{path}{step}" if path else step.removeprefix(".")


def _render_value(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= VALUE_CHARS else f"{text[:VALUE_CHARS]}..."


def _first_difference(committed: Any, built: Any, path: str = "") -> str | None:
    if isinstance(committed, dict) and isinstance(built, dict):
        for key in committed:
            if key not in built:
                return f"  {_render_key(path, key)}\n    is only in the committed document"
            if (found := _first_difference(committed[key], built[key], _render_key(path, key))) is not None:
                return found
        for key in built:
            if key not in committed:
                return f"  {_render_key(path, key)}\n    is only in the models"
        return None

    if isinstance(committed, list) and isinstance(built, list):
        for index, (mine, theirs) in enumerate(zip(committed, built, strict=False)):
            if (found := _first_difference(mine, theirs, _render_key(path, index))) is not None:
                return found
        # Length last: a shorter list whose surviving entries all differ is better reported at the
        # first entry, where the changed value is visible, than as a count.
        if len(committed) != len(built):
            return f"  {path}\n    committed: {len(committed)} entries\n    built:     {len(built)} entries"
        return None

    if committed == built:
        return None

    return f"  {path}\n    committed: {_render_value(committed)}\n    built:     {_render_value(built)}"


def describe_drift(committed: dict[str, Any], built: dict[str, Any]) -> str:
    """Name what moved, so the failure is actionable without diffing the whole document by eye."""
    lines: list[str] = []

    for section in ("paths", "components"):
        committed_keys = _section_keys(committed, section)
        built_keys = _section_keys(built, section)
        if added := sorted(built_keys - committed_keys):
            lines.append(f"  Only in the models: {added}")
        if removed := sorted(committed_keys - built_keys):
            lines.append(f"  Only in the committed document: {removed}")

    # A narrowed `pattern` moves no key, so the set differences above report nothing: without the
    # walk the reader is told that a field changed and left to find which one.
    if (moved := _first_difference(committed, built)) is not None:
        lines.append(moved)

    return "\n".join(lines)


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m tests.openapi_document",
        description="Write or check fl_backend/openapi.json, the published API surface.",
    )
    parser.add_argument("--write", action="store_true", help="rewrite the document from the current models")
    parser.add_argument("--check", action="store_true", help="report whether the committed document is stale; writes nothing")
    arguments = parser.parse_args()

    if arguments.check == arguments.write:
        parser.error("pass exactly one of --write or --check")

    built = build_document()

    if arguments.write:
        # newline="\n" so a Windows run and a Linux run write the same bytes: without it Python
        # translates to CRLF and git normalises on the way in, reporting a whitespace change nobody made.
        DOCUMENT_PATH.write_text(serialize(built), encoding="utf-8", newline="\n")
        paths = len(built["paths"])
        schemas = len(built.get("components", {}).get("schemas", {}))
        print(f"Wrote {DOCUMENT_PATH.name}: {paths} paths, {schemas} component schemas.")
        return 0

    if not DOCUMENT_PATH.exists():
        print(f"{DOCUMENT_PATH.name} does not exist. Create it with:  {REGENERATE}")
        return 1

    committed = read_document()

    if committed == built:
        print(f"{DOCUMENT_PATH.name} matches the current models.")
        return 0

    print(f"{DOCUMENT_PATH.name} is stale.\n{describe_drift(committed, built)}\n{DRIFT_REPAIR}")
    return 1


if __name__ == "__main__":
    raise SystemExit(_main())
