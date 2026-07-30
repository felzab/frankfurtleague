"""
The API envelope.

Every response model extends BaseAPIResponse, and the frontend's BaseAPIResponseSchema requires
`acknowledged` on every one of its response schemas. These tests pin the contract from the backend side
so a future model added without the envelope fails here rather than at a browser.

The models in `test_declares_the_envelope_on_every_untyped_route` were bare `JSONResponse`
bodies until Wave 4 — their `{"acknowledged": 1}` shape was real but undeclared, so the frontend
schemas for them were guesses.
"""

import inspect

import pytest
from pytest import HIDDEN_PARAM

from app.api.admin.schemas import FLPatchSpielDataResponse
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
    "app.api.admin.schemas",
]


def _response_models():
    """Every class in the API whose name ends in Response, except the base itself."""
    import importlib

    for module_path in RESPONSE_MODULES:
        module = importlib.import_module(module_path)
        for name, obj in vars(module).items():
            if inspect.isclass(obj) and name.endswith("Response") and obj is not BaseAPIResponse:
                if obj.__module__ == module_path:
                    yield f"{module_path}.{name}", obj


RESPONSE_MODELS = list(_response_models())

# parametrize over an EMPTY list does not fail -- pytest's default empty_parameter_set_mark is
# "skip", so a rename of the modules above or of the "...Response" convention would turn this whole
# guarantee into one silent skip, and every response model added afterwards could drop the envelope
# with the suite green. The floor makes that a hard failure instead.
MINIMUM_EXPECTED_RESPONSE_MODELS = 20
assert len(RESPONSE_MODELS) >= MINIMUM_EXPECTED_RESPONSE_MODELS, (
    f"discovered only {len(RESPONSE_MODELS)} response models across {len(RESPONSE_MODULES)} modules; "
    f"expected at least {MINIMUM_EXPECTED_RESPONSE_MODELS}. Did a module move or a naming convention change?"
)


@pytest.mark.parametrize("name,model", RESPONSE_MODELS, ids=lambda v: v if isinstance(v, str) else HIDDEN_PARAM)
def test_every_response_model_carries_the_envelope(name, model):
    assert issubclass(model, BaseAPIResponse), f"{name} does not extend BaseAPIResponse"
    assert model.model_fields["acknowledged"].default == 1


@pytest.mark.parametrize(
    "model,expected",
    [
        (CheckIsLiveResponse, {"acknowledged": 1, "status": "ok"}),
        (CheckIsReadyResponse, {"acknowledged": 1, "status": "ok"}),
        (FLPatchSpielDataResponse, {"acknowledged": 1}),
    ],
)
def test_declares_the_envelope_on_every_untyped_route(model, expected):
    assert model().model_dump() == expected


def test_system_info_reports_the_api_version_as_a_number():
    # The frontend schema was z.string().nonempty() against an int, so getSystemInfo could never
    # have succeeded. It is z.int().nonnegative() now -- nonnegative because the version is 0.
    dumped = SystemInfoResponse(api_version=0).model_dump()

    assert dumped == {"acknowledged": 1, "api_version": 0}
    assert isinstance(dumped["api_version"], int)
