import inspect

import pytest
from pytest import HIDDEN_PARAM

from app.api.spiele.schemas import FLPatchSpielDataResponse
from app.api.system.schemas import CheckIsLiveResponse, CheckIsReadyResponse, SystemInfoResponse
from app.shared.schemas.responses import BaseAPIResponse

RESPONSE_MODULES = [
    "app.api.saisons.schemas",
    "app.api.schiedsrichter.schemas",
    "app.api.spiele.schemas",
    "app.api.spieler.schemas",
    "app.api.spielorte.schemas",
    "app.api.spieltage.schemas",
    "app.api.teams.schemas",
    "app.api.system.schemas",
]


def _response_models():
    import importlib

    for module_path in RESPONSE_MODULES:
        module = importlib.import_module(module_path)
        for name, obj in vars(module).items():
            if inspect.isclass(obj) and name.endswith("Response") and obj is not BaseAPIResponse:
                if obj.__module__ == module_path:
                    yield f"{module_path}.{name}", obj


RESPONSE_MODELS = list(_response_models())

# `empty_parameter_set_mark` defaults to skip, so renaming the modules above would turn this whole
# guarantee into one silent skip. The floor makes that a hard failure instead.
MINIMUM_EXPECTED_RESPONSE_MODELS = 20
assert len(RESPONSE_MODELS) >= MINIMUM_EXPECTED_RESPONSE_MODELS, (
    f"discovered only {len(RESPONSE_MODELS)} response models across {len(RESPONSE_MODULES)} modules; "
    f"expected at least {MINIMUM_EXPECTED_RESPONSE_MODELS}. Did a module move or a naming convention change?"
)


@pytest.mark.parametrize("name,model", RESPONSE_MODELS, ids=lambda v: v if isinstance(v, str) else HIDDEN_PARAM)
def test_every_response_model_carries_the_envelope(name, model):
    """Discovered rather than listed: any `*Response` added to the API is covered without editing this file."""
    assert issubclass(model, BaseAPIResponse), f"{name} does not extend BaseAPIResponse"
    assert model.model_fields["acknowledged"].default == 1


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
