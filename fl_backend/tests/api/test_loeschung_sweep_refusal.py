"""
API · the season-after rule decided from the statuses and rows handed in, and the share one call takes

Each case judges arguments alone, so the default tier holds it; the run against a real mongod is
`tests/api/test_loeschung_sweep.py`'s.
"""

from typing import Any

import pytest

from app.api.identitaet import sweep_router
from app.api.identitaet.services import (
    abgeschlossene_saison_id,
    behaltene_saison_ids,
    geschlossen_durch,
    loeschung_faellig,
    offene_adressen,
    ohne_passende_adresse,
    registrierbare_saison_ids,
    statuses_after_activating,
)
from app.api.saisons.schemas import FLSaisonStatus
from app.core.middlewares import REQUEST_DEADLINE_S

LEAGUE: dict[str, FLSaisonStatus] = {"2023": "past", "2024": "past", "2025": "past", "2026": "active", "2027": "future"}
ADDRESS = "thessaly.okonkwo@beispielschule.de"


def faellig(
    kader: list[str], *, statuses: dict[str, FLSaisonStatus] = LEAGUE, offene: frozenset[str] = frozenset(), email: Any = ADDRESS
) -> bool:
    return loeschung_faellig(email=email, kader_saison_ids=kader, offene=offene, behalten=behaltene_saison_ids(statuses))


class TestTheKeptSeasons:
    def test_the_latest_ended_season_and_every_one_not_ended_are_kept(self):
        assert behaltene_saison_ids(LEAGUE) == {"2025", "2026", "2027"}

    def test_the_latest_ended_season_is_the_greatest_id_whatever_order_the_seasons_are_read_in(self):
        assert abgeschlossene_saison_id({"2025": "past", "2026": "active", "2023": "past"}) == "2025"

    def test_while_no_season_has_ended_nobody_is_due(self):
        """Even a pupil holding no squad row at all: the rule counts from a season's end, and none has come."""

        statuses: dict[str, FLSaisonStatus] = {"2026": "active", "2027": "future"}

        assert (behaltene_saison_ids(statuses), abgeschlossene_saison_id(statuses)) == (None, None)
        assert not faellig([], statuses=statuses)

    def test_a_planned_season_below_the_one_just_ended_keeps_nobody(self):
        """Never activated, it stays planned for good, and a status rule would keep its pupils for ever."""

        statuses: dict[str, FLSaisonStatus] = {"2023": "past", "2024": "future", "2025": "past", "2026": "active"}

        assert behaltene_saison_ids(statuses) == {"2025", "2026"}
        assert faellig(["2024"], statuses=statuses)

    def test_a_running_season_below_the_one_just_ended_still_keeps_its_pupils(self):
        """Activation refuses no lower id, so the running season is kept by its status whatever its id."""

        statuses: dict[str, FLSaisonStatus] = {"2024": "active", "2025": "past", "2026": "future"}

        assert behaltene_saison_ids(statuses) == {"2024", "2025", "2026"}
        assert not faellig(["2024"], statuses=statuses)

    def test_every_season_a_registration_can_arrive_in_is_anchored(self):
        """The ones not `past`, as the window judges: a registration for one conflicts with the pupil's transaction."""

        assert registrierbare_saison_ids(LEAGUE) == {"2026", "2027"}


class TestTheDueJudgement:
    @pytest.mark.parametrize(
        ("kader", "due"),
        [
            pytest.param(["2023", "2024"], True, id="rows only in seasons ended before the latest"),
            pytest.param([], True, id="no squad row at all"),
            # The plan's own rule, keyed on the running season alone, deletes this pupil a season early.
            pytest.param(["2024", "2025"], False, id="a row in the season just ended"),
            pytest.param(["2026"], False, id="a row in the running season"),
            pytest.param(["2027"], False, id="a row in a planned season"),
        ],
    )
    def test_a_row_in_a_kept_season_keeps_its_pupil(self, kader: list[str], due: bool):
        assert faellig(kader) is due

    def test_a_pending_registration_keeps_its_pupil_however_its_address_was_typed(self):
        """A registration stores its address unfolded, and the pupil's row the fold."""

        offene = offene_adressen([{"status": "eingereicht", "email": "Thessaly.Okonkwo@beispielschule.de"}])

        assert offene == {ADDRESS}
        assert not faellig([], offene=offene)

    def test_a_declined_registration_keeps_nobody(self):
        assert offene_adressen([{"status": "abgelehnt", "email": ADDRESS}]) == frozenset()

    def test_a_pupil_holding_no_address_is_never_due(self):
        """The registry erases by address, and nothing else may erase by a name."""

        assert not faellig([], email=None)

    @pytest.mark.parametrize(
        "email",
        [
            pytest.param("Thessaly.Okonkwo@beispielschule.de", id="unfolded"),
            pytest.param("", id="empty"),
            pytest.param("thessaly.okonkwo", id="refused by the address rule"),
        ],
    )
    def test_a_stored_address_no_request_matches_is_never_due_and_is_named(self, email: str):
        """A hand correction leaves such a spelling, and the erasure would remove nobody by it."""

        assert not faellig([], email=email)
        assert ohne_passende_adresse([{"_id": 1, "email": email}, {"_id": 2, "email": ADDRESS}]) == [1]


class TestTheStatusesAnActivationLeaves:
    def test_the_running_season_ends_and_the_target_runs(self):
        assert statuses_after_activating(LEAGUE, "2027") == {**LEAGUE, "2026": "past", "2027": "active"}
        assert geschlossen_durch(LEAGUE, "2027") == "2026"

    def test_activating_the_running_season_again_ends_nothing(self):
        assert statuses_after_activating(LEAGUE, "2026") == LEAGUE
        assert geschlossen_durch(LEAGUE, "2026") is None

    def test_a_league_with_no_running_season_closes_none(self):
        statuses: dict[str, FLSaisonStatus] = {"2025": "past", "2026": "future"}

        assert geschlossen_durch(statuses, "2026") is None
        assert behaltene_saison_ids(statuses_after_activating(statuses, "2026")) == {"2025", "2026"}


# One pupil's commands on the wire, pinned by
# `fl_backend/tests/api/test_loeschung_sweep.py :: TestOnePupilCostsTheCommandsItsShareIsSizedAt`.
COMMANDS_A_PERSON = 24

# The call's other commands, four on the wire and one for the pending registrations' read past the
# driver's first batch, the page being one document; the per-command cost the largest of two windows
# timing whole calls locally, 2026-10-16.
OTHER_COMMANDS = 4 + 1
PER_COMMAND_S = 0.00203

# The round trip `sweep_router.LOESCHUNGEN_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case counting its own pupils, and times out a whole call in production."""

    assert (sweep_router.LOESCHUNGEN_PER_PASS * COMMANDS_A_PERSON + OTHER_COMMANDS) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S
