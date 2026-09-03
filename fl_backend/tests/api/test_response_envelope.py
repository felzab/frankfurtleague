import importlib
import inspect
from pathlib import Path

import pytest
from pytest import HIDDEN_PARAM

from app.api.spiele.schemas import FLPatchSpielDataResponse
from app.api.system.schemas import CheckIsLiveResponse, CheckIsReadyResponse, SystemInfoResponse
from app.shared.schemas.responses import BaseAPIResponse

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Globbed rather than listed, so a slice added later is swept without an edit here.
SCHEMA_PATHS = sorted(BACKEND_ROOT.glob("app/api/*/schemas.py")) + sorted(BACKEND_ROOT.glob("app/shared/schemas/*.py"))


def _response_models():
    for path in SCHEMA_PATHS:
        module_name = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts)
        module = importlib.import_module(module_name)
        for name, obj in vars(module).items():
            if inspect.isclass(obj) and name.endswith("Response") and obj is not BaseAPIResponse:
                if obj.__module__ == module_name:
                    yield f"{module_name}.{name}", obj


RESPONSE_MODELS = list(_response_models())

# A floor rather than the exact count: a model added is swept by the parametrisation below without
# editing this file, so pinning the number would ask for a bump and prove nothing.

# Eight under the population: fewer than either of the two largest slices contributes, so one
# leaving the glob lands below the floor.
MINIMUM_EXPECTED_RESPONSE_MODELS = 50


@pytest.mark.parametrize("name,model", RESPONSE_MODELS, ids=lambda v: v if isinstance(v, str) else HIDDEN_PARAM)
def test_every_response_model_carries_the_envelope(name, model):
    """Every `*Response` the globbed schema modules define. One declared outside them, in a router or a service, is swept by nothing."""
    assert issubclass(model, BaseAPIResponse), f"{name} does not extend BaseAPIResponse"
    assert model.model_fields["acknowledged"].default == 1


def test_the_response_model_inventory_clears_its_floor():
    """The partial loss `pyproject.toml :: empty_parameter_set_mark` cannot reach.

    That setting refuses a discovery that found NOTHING; one that found a single slice parametrises,
    and every case it runs passes.
    """
    assert len(RESPONSE_MODELS) >= MINIMUM_EXPECTED_RESPONSE_MODELS, (
        f"discovered only {len(RESPONSE_MODELS)} response models across {len(SCHEMA_PATHS)} schema modules; "
        f"expected at least {MINIMUM_EXPECTED_RESPONSE_MODELS}. Did a slice's schemas leave the glob, or was a model removed?"
    )


@pytest.mark.parametrize(
    "model,expected",
    [
        (CheckIsLiveResponse, {"acknowledged": 1, "status": "ok"}),
        (CheckIsReadyResponse, {"acknowledged": 1, "status": "ok"}),
        # Every list defaults empty: an edit resolving no bracket slot is the ordinary answer for a
        # group fixture, an undecided placing is nobody's problem, and displacing no team releases none.
        (FLPatchSpielDataResponse, {"acknowledged": 1, "advanced_to": [], "released_sides": [], "bracket_faults": []}),
    ],
)
def test_declares_the_envelope_on_every_untyped_route(model, expected):
    """A route whose body is small enough to hand-build: its shape is declared, not implied."""
    assert model().model_dump() == expected


def test_system_info_reports_the_api_version_as_a_number():
    """Zero matters specifically: it is the current version and it is falsy, so a non-empty string mirror could never match."""
    dumped = SystemInfoResponse(api_version=0).model_dump()

    assert dumped == {"acknowledged": 1, "api_version": 0}
    assert isinstance(dumped["api_version"], int)
