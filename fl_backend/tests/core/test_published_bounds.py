import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

PUBLISHED = Path(__file__).resolve().parents[2] / "openapi.json"


def _exclusive_bounds(node: Any, where: str = "") -> Iterator[tuple[str, Any]]:
    if isinstance(node, dict):
        if "exclusiveMinimum" in node or "exclusiveMaximum" in node:
            yield where, node.get("type")
        for key, child in node.items():
            yield from _exclusive_bounds(child, f"{where}/{key}")
    elif isinstance(node, list):
        for index, child in enumerate(node):
            yield from _exclusive_bounds(child, f"{where}/{index}")


def test_every_exclusive_bound_is_an_integers():
    # `fl_frontend/src/core/zodGerman.ts` names an exclusive bound as the figure one step inward,
    # which is right only for an integer: a decimal's would print a value the rule refuses.
    document = json.loads(PUBLISHED.read_text(encoding="utf-8"))

    assert [(where, kind) for where, kind in _exclusive_bounds(document) if kind != "integer"] == []
