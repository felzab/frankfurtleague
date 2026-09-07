import argparse
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final

from app.main import create_app
from tests.config import build_test_config

DOCUMENT_PATH: Final = Path(__file__).resolve().parents[1] / "openapi.json"

# `uv run` rather than a bare `python`: outside an activated virtualenv the interpreter has neither
# FastAPI nor this package, so the command fails as a broken import.
# `scripts/tests/test_regenerate_spelling.py` holds every other site to this exact string.
REGENERATE: Final = "cd fl_backend && uv run python -m tests.openapi_document --write"

# Both repairs, because the rewrite alone is the wrong one for a narrowing nobody asked for: it
# accepts whatever moved, and the document then agrees with the models about a change no one meant.
DRIFT_REPAIR: Final = (
    f"A change nobody meant is repaired in the models, never here.\nRefresh the document for an intended one with:  {REGENERATE}"
)

# Each value is printed through a window opening `VALUE_LEAD` characters before the first character
# the two disagree on: truncating at a fixed offset instead prints two identical-looking values
# under a heading saying they differ.
VALUE_CHARS: Final = 200
VALUE_LEAD: Final = 40

# Every leaf that moved is named, so a drift with two causes takes one run rather than two. The cap
# keeps a wholesale regeneration from printing thousands of them.
DIFFERENCE_CAP: Final = 20


def build_document() -> dict[str, Any]:
    return create_app(build_test_config()).openapi()


def read_document() -> dict[str, Any]:
    """Parsed, never compared as bytes: prettier owns this file's formatting."""
    return json.loads(DOCUMENT_PATH.read_text(encoding="utf-8"))


def serialize(document: dict[str, Any]) -> str:
    """`ensure_ascii=False` so the German prose in the endpoint summaries stays readable in a diff."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _render_key(path: str, key: str | int) -> str:
    step = f".{key}" if isinstance(key, str) and key.isidentifier() else f"[{key!r}]"
    return f"{path}{step}" if path else step.removeprefix(".")


def _render_window(text: str, at: int) -> str:
    """One value through the window, an ellipsis marking each side the window cut away."""
    start = max(0, at - VALUE_LEAD)
    end = min(len(text), start + VALUE_CHARS)
    return f"{'...' if start else ''}{text[start:end]}{'...' if end < len(text) else ''}"


def _render_pair(committed: Any, built: Any) -> str:
    """Both values around the character they first disagree on, which is the whole reason two of them are printed."""
    mine = json.dumps(committed, ensure_ascii=False, sort_keys=True)
    theirs = json.dumps(built, ensure_ascii=False, sort_keys=True)
    at = next((index for index, (left, right) in enumerate(zip(mine, theirs, strict=False)) if left != right), min(len(mine), len(theirs)))
    return f"    committed: {_render_window(mine, at)}\n    built:     {_render_window(theirs, at)}"


def _differences(committed: Any, built: Any, path: str = "") -> Iterator[str]:
    """Every leaf the two documents disagree on, in the committed document's own key order."""
    if isinstance(committed, dict) and isinstance(built, dict):
        for key in committed:
            here = _render_key(path, key)
            if key not in built:
                yield f"  {here}\n    is only in the committed document"
            else:
                yield from _differences(committed[key], built[key], here)
        for key in built:
            if key not in committed:
                yield f"  {_render_key(path, key)}\n    is only in the models"
        return

    if isinstance(committed, list) and isinstance(built, list):
        for index, (mine, theirs) in enumerate(zip(committed, built, strict=False)):
            yield from _differences(mine, theirs, _render_key(path, index))
        # Length last: a shorter list whose surviving entries all differ is reported at those
        # entries, where the changed values are visible, rather than as a count standing for them.
        if len(committed) != len(built):
            yield f"  {path}\n    committed: {len(committed)} entries\n    built:     {len(built)} entries"
        return

    if committed != built:
        yield f"  {path}\n{_render_pair(committed, built)}"


def describe_drift(committed: dict[str, Any], built: dict[str, Any]) -> str:
    """Name every field that moved, so the failure is actionable without diffing the whole document by eye."""
    found = list(_differences(committed, built))
    shown = found[:DIFFERENCE_CAP]
    if len(found) > DIFFERENCE_CAP:
        shown.append(f"  ... and {len(found) - DIFFERENCE_CAP} more differences")
    return "\n".join(shown)


def _main() -> int:
    parser = argparse.ArgumentParser(
        prog=REGENERATE.removesuffix(" --write"),
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
