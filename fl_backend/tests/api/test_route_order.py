from typing import Any, Iterator

import pytest
from fastapi.routing import APIRoute

from app.core.config import API_VERSION
from app.main import create_app
from tests.config import build_test_config


def _api_routes(router: Any) -> Iterator[APIRoute]:
    """Every endpoint reachable from `router`, in the order a request is matched against them.

    Depth-first: FastAPI wraps an included router rather than splicing its endpoints into the
    parent's list, and matching descends into that wrapper in place.
    """

    for route in router.routes:
        included = getattr(route, "original_router", None)
        if included is not None:
            yield from _api_routes(included)
        elif isinstance(route, APIRoute):
            yield route


ROUTES = list(_api_routes(create_app(build_test_config()).router))

CURRENT_SAISON_PATH = f"/api/v{API_VERSION}/saisons/current"


def _shadowing_pairs() -> list[tuple[str, int, str, int]]:
    """Each literal path paired with a parameterised one whose regex would also take it, on a method they share.

    A method they do NOT share is not a pair: a mismatch matches partially, and a partial is used
    only once nothing has matched fully.
    """

    pairs: list[tuple[str, int, str, int]] = []
    for literal_index, literal in enumerate(ROUTES):
        if literal.param_convertors:
            continue
        # `or set()`: `methods` is optional on the Starlette base a route inherits from.
        literal_methods = literal.methods or set()
        for parameterised_index, parameterised in enumerate(ROUTES):
            if not parameterised.param_convertors or not (parameterised.methods or set()) & literal_methods:
                continue
            if parameterised.path_regex.match(literal.path):
                pairs.append((literal.path, literal_index, parameterised.path, parameterised_index))

    return pairs


SHADOWING_PAIRS = _shadowing_pairs()
SHADOWING_IDS = [f"{literal} before {parameterised}" for literal, _, parameterised, _ in SHADOWING_PAIRS]

# The pair `docs/backend/spec.md :: I37` names. Asserted PRESENT, so a sweep that stopped recognising
# the shape fails here rather than passing over an empty parameter set.
assert any(literal == CURRENT_SAISON_PATH for literal, _, _, _ in SHADOWING_PAIRS), (
    f"{CURRENT_SAISON_PATH} is no longer paired with a parameterised sibling; the detector, not the routes, is the likely cause"
)


@pytest.mark.parametrize("literal,literal_index,parameterised,parameterised_index", SHADOWING_PAIRS, ids=SHADOWING_IDS)
def test_a_literal_route_is_declared_before_the_parameterised_one_that_would_answer_it(
    literal: str, literal_index: int, parameterised: str, parameterised_index: int
):
    """Declaration order is the whole enforcement -- the `objectid` convertor cannot help where the parameter is a plain string."""
    assert literal_index < parameterised_index, (
        f"{literal} is declared after {parameterised}, which matches it first -- so the literal segment arrives as an id"
    )
