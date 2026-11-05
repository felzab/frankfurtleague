"""
API · which labels an account press may name: a choice it moves onto a grant names its current wording, and nothing else does

The payloads take any label their kind cites, so this sequence is the one place the rule binds. Every kind's records
cite their current labels alone until a rewording adds one, so no request can carry a replaced label yet, and the
database tier never reaches these cases: the labels are constructed past validation.
"""

import asyncio
from collections.abc import Mapping
from typing import Any, Final

import pytest

from app.api.account.crud import press_einwilligung
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.einwilligung_evidence import FLEinwilligungChoice, evidence_state_of
from app.shared.schemas.einwilligung import FLSpielerTextVersions, PressTextVersions

STALE: Final = "2026-10-ersetzt-1"
TODAY: Final = "2026-11-04"
# Old enough for the media consent, so its age rule never decides a case here.
ADULT: Final = "2000-01-01"


async def _may_grant() -> bool:
    return True


def _replaced(kind: type[FLSpielerTextVersions], *choices: FLEinwilligungChoice) -> PressTextVersions:
    labels = {**kind.current, **dict.fromkeys(choices, STALE)}
    return kind.model_construct(umfang=labels["umfang"], media=labels["media"])


def _press(blocks: list[Mapping[str, Any]], chosen: Mapping[FLEinwilligungChoice, Any], text_versions: PressTextVersions) -> None:
    asyncio.run(
        press_einwilligung(
            blocks=blocks,
            birth_dates=[ADULT] * len(blocks),
            chosen=chosen,
            evidence_state=evidence_state_of(blocks=blocks),
            text_versions=text_versions,
            may_give=_may_grant,
            today=TODAY,
        )
    )


# A stored block, and the press sending each choice back as stored.
PUPIL_WITHHELD: Final[Mapping[str, Any]] = {"umfang": "intern", "media": False}
PUPIL_GRANTED: Final[Mapping[str, Any]] = {"umfang": "kader_oeffentlich", "media": True}


def _as_stored(block: Mapping[str, Any], **moved: Any) -> dict[FLEinwilligungChoice, Any]:
    return {"umfang": moved.get("umfang", block["umfang"]), "media": moved.get("media", block["media"])}


class TestAGrantThePressMovesNamesItsCurrentWording:
    @pytest.mark.parametrize(("choice", "giving"), [("umfang", "kader_oeffentlich"), ("media", True)])
    def test_a_choice_moved_onto_a_grant_under_a_replaced_label_is_refused(self, choice: FLEinwilligungChoice, giving: Any):
        with pytest.raises(APIError) as refused:
            _press([PUPIL_WITHHELD], _as_stored(PUPIL_WITHHELD, **{choice: giving}), _replaced(FLSpielerTextVersions, choice))

        assert (refused.value.error_code, refused.value.status_code, refused.value.fields) == (
            Code.GRANT_WORDING_STALE,
            409,
            (("text_versions", choice),),
        )

    def test_a_grant_under_the_current_label_is_taken(self):
        """The floor for the refusal above: without it, a sequence refusing every grant passes it."""

        _press([PUPIL_WITHHELD], _as_stored(PUPIL_GRANTED), _replaced(FLSpielerTextVersions))
