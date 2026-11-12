"""
API · an account press's two judgements: which labels it may name, and which choices its journal line says it withdrew

A choice it moves onto a grant names its current wording, and nothing else does. The payloads take any label their kind
cites, so this sequence is the one place the rule binds. Every kind's records cite their current labels alone until a
rewording adds one, so no request can carry a replaced label yet, and the database tier never reaches these cases: the
labels are constructed past validation.
"""

import asyncio
from collections.abc import Mapping
from typing import Any, Final

import pytest

from app.api.account.crud import press_einwilligung
from app.api.account.services import withdrawal_line
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.einwilligung_evidence import FLEinwilligungChoice, evidence_state_of
from app.shared.schemas.einwilligung import FLSpielerTextVersions, PressTextVersions

STALE: Final = "2026-10-replaced-1"
TODAY: Final = "2026-11-04"
# Old enough for the media consent, so its age rule never decides a case here.
ADULT: Final = "2000-01-01"


async def _may_grant() -> bool:
    return True


def _replaced(kind: type[FLSpielerTextVersions], *choices: FLEinwilligungChoice) -> PressTextVersions:
    labels = {**kind.current, **dict.fromkeys(choices, STALE)}
    return kind.model_construct(scope=labels["scope"], media=labels["media"])


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
PUPIL_WITHHELD: Final[Mapping[str, Any]] = {"scope": "internal", "media": False}


def _as_stored(block: Mapping[str, Any], **moved: Any) -> dict[FLEinwilligungChoice, Any]:
    return {"scope": moved.get("scope", block["scope"]), "media": moved.get("media", block["media"])}


class TestAGrantThePressMovesNamesItsCurrentWording:
    @pytest.mark.parametrize(("choice", "giving"), [("scope", "kader_public"), ("media", True)])
    def test_a_choice_moved_onto_a_grant_under_a_replaced_label_is_refused(self, choice: FLEinwilligungChoice, giving: Any):
        with pytest.raises(APIError) as refused:
            _press([PUPIL_WITHHELD], _as_stored(PUPIL_WITHHELD, **{choice: giving}), _replaced(FLSpielerTextVersions, choice))

        assert (refused.value.error_code, refused.value.status_code, refused.value.fields) == (
            Code.GRANT_WORDING_STALE,
            409,
            (("text_versions", choice),),
        )


class TestTheJournalNamesWhatThePressWithdrew:
    def test_it_names_the_choice_moved_off_a_grant_and_never_the_grant_kept_beside_it(self):
        """A restore replays this line: a kept choice named on it takes a consent back from a person who gave it."""

        assert withdrawal_line(blocks=[{"scope": "kader_public", "media": True}], chosen={"scope": "kader_public", "media": False}) == (
            "media",
        )
