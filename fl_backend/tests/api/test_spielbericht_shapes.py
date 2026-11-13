from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spielberichte.schemas import FLSpielberichtBericht, FLSpielberichtBerichtPayload
from app.api.spielberichte.services import (
    BerichtContext,
    bericht_state_of,
    compose_bericht_update,
    compose_new_bericht,
    find_cancelled_refusal,
    find_not_in_kader_refusal,
    find_not_played_refusal,
    find_not_refereed_refusal,
    judge_bericht,
    kader_is_open,
    newly_named,
    takes_a_bericht,
)
from app.core import clock
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.schemas.literals import FLSpielSide
from tests.documents import bericht_document

TEAM1 = ObjectId("650000000000000000000201")
TEAM2 = ObjectId("650000000000000000000202")
SCHIEDSRICHTER = ObjectId("650000000000000000000203")
LIVE1 = ObjectId("650000000000000000000211")
DEREGISTERED_1 = ObjectId("650000000000000000000212")
LIVE2 = ObjectId("650000000000000000000221")
SPIEL_ID = ObjectId("650000000000000000000209")

TODAY = "2027-05-14"
NOW = datetime(2027, 5, 14, 20, tzinfo=UTC)


def tor(side: str, spieler_id: ObjectId | None = None, *, eigentor: bool = False, minute: str = "10") -> dict[str, Any]:
    return {"side": side, "spieler_id": spieler_id, "minute": minute, "eigentor": eigentor}


def payload(scorers: list[dict[str, Any]], *, elfmeterschiessen: Any = None, sonderereignis: str | None = None) -> dict[str, Any]:
    return {
        "ergebnis_vorschlag": {"elfmeterschiessen": elfmeterschiessen, "sonderereignis": sonderereignis},
        "scorers": scorers,
        "cards": [],
        "remarks": None,
    }


def spiel(**fields: Any) -> dict[str, Any]:
    return {
        "_id": SPIEL_ID,
        "saison_id": "2027",
        "saison_phase": "gruppenphase",
        "date": TODAY,
        "time": "18:00:00",
        "team1": {"team_id": TEAM1, "tore": None},
        "team2": {"team_id": TEAM2, "tore": None},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER},
        "sonderereignis": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        **fields,
    }


def context(*, saison_status: str = "active", **spiel_fields: Any) -> BerichtContext:
    return BerichtContext(
        saison_status=saison_status,
        spiel=spiel(**spiel_fields),
        kader=[
            {"spieler_id": LIVE1, "team_id": TEAM1, "first_name": "Lina", "last_name": "Krause", "nummer": "7", "inactive_since": None},
            {
                "spieler_id": DEREGISTERED_1,
                "team_id": TEAM1,
                "first_name": "Ole",
                "last_name": "Brettschneider",
                "nummer": None,
                "inactive_since": "2027-04-01",
            },
            {"spieler_id": LIVE2, "team_id": TEAM2, "first_name": "Mia", "last_name": "Westphal", "nummer": "9", "inactive_since": None},
        ],
    )


def refused_with(code: str, refusal: Any) -> bool:
    return refusal is not None and refusal.error_code == code


def proposed(body: dict[str, Any]) -> tuple[int | None, int | None]:
    vorschlag = FLSpielberichtBerichtPayload.model_validate(body).proposed()

    return vorschlag.team1_tore, vorschlag.team2_tore


CARD = {"side": "team1", "spieler_id": None, "minute": "10", "colour": "gelb"}


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({**payload([{**tor("team1"), "reason": "x"}])}, id="a goal"),
        pytest.param({**payload([]), "cards": [{**CARD, "reason": "foulspiel"}]}, id="a card"),
        pytest.param(payload([tor("team1"), tor("team2")], elfmeterschiessen={"team1": 4, "team2": 3, "reason": "x"}), id="a shoot-out"),
    ],
)
def test_an_entry_carrying_a_key_it_does_not_declare_is_refused(body: dict[str, Any]):
    """Accepted, the key would be dropped in silence: a client still sending a card's reason would be told it was saved."""

    with pytest.raises(ValidationError) as raised:
        FLSpielberichtBerichtPayload.model_validate(body)

    assert [error["type"] for error in raised.value.errors()] == ["extra_forbidden"]


class TestTheProposalsCountsAreItsEntries:
    def test_each_side_is_credited_its_entries_and_an_own_goal_counts_for_the_other_side(self):
        """`side: team2, eigentor` credits team 1 and `side: team1, eigentor` team 2: the cases a count by `side` alone gets wrong."""

        assert proposed(payload([tor("team1"), tor("team2", LIVE2, eigentor=True), tor("team2")])) == (2, 1)
        assert proposed(payload([tor("team1", LIVE1, eigentor=True)])) == (0, 1)

    def test_a_no_show_proposes_the_event_alone(self):
        assert proposed(payload([], sonderereignis="nichtantreten_team2")) == (None, None)

        with pytest.raises(ValidationError) as with_a_shoot_out:
            FLSpielberichtBerichtPayload.model_validate(
                payload([], sonderereignis="nichtantreten_team2", elfmeterschiessen={"team1": 4, "team2": 3})
            )
        with pytest.raises(ValidationError) as with_a_scorer:
            FLSpielberichtBerichtPayload.model_validate(payload([tor("team1")], sonderereignis="nichtantreten_team2"))

        assert [error["type"] for error in with_a_shoot_out.value.errors()] == ["nichtantreten_with_elfmeterschiessen"]
        assert [error["type"] for error in with_a_scorer.value.errors()] == ["nichtantreten_with_scorers"]

    def test_a_shoot_out_follows_a_draw_alone(self):
        shoot_out = {"team1": 4, "team2": 3}

        assert FLSpielberichtBerichtPayload.model_validate(payload([tor("team1"), tor("team2")], elfmeterschiessen=shoot_out))

        with pytest.raises(ValidationError) as raised:
            FLSpielberichtBerichtPayload.model_validate(payload([tor("team1"), tor("team1"), tor("team2")], elfmeterschiessen=shoot_out))

        assert [error["type"] for error in raised.value.errors()] == ["elfmeterschiessen_without_draw"]


# `spiel`'s kick-off, 18:00 in Berlin on a summer day.
KICK_OFF = datetime(2027, 5, 14, 16, tzinfo=UTC)
# The first instant of `TODAY` in Berlin, the day before in UTC.
TODAYS_FIRST_MINUTE = datetime(2027, 5, 13, 22, tzinfo=UTC)


class TestAReportFollowsTheKickOff:
    """Played from the kick-off on Germany's clock, never from the morning of its day; from its day where no time is set."""

    @pytest.mark.parametrize(
        ("date", "time", "now"),
        [
            pytest.param(None, None, NOW, id="undated"),
            pytest.param("2027-05-15", None, NOW, id="an untimed day to come"),
            pytest.param(TODAY, "18:00:00", KICK_OFF - timedelta(minutes=1), id="before the kick-off on its day"),
        ],
    )
    def test_a_spiel_not_yet_played_is_refused(self, date: str | None, time: str | None, now: datetime):
        assert refused_with(Code.BERICHT_NOT_PLAYED, find_not_played_refusal(date=date, time=time, now=now))

    @pytest.mark.parametrize(
        ("date", "time", "now"),
        [
            pytest.param(TODAY, "18:00:00", KICK_OFF, id="from the kick-off"),
            pytest.param(TODAY, None, TODAYS_FIRST_MINUTE, id="an untimed spiel from its day"),
            # The night summer time ends: a 02:30 kick-off is the first 02:30 (00:30 UTC), and `now` is read in Berlin as a
            # request reads it, at 02:15 in the repeated hour, so both carry one zone and only the instants order them.
            pytest.param(
                "2026-10-25",
                "02:30:00",
                datetime(2026, 10, 25, 1, 15, tzinfo=UTC).astimezone(clock.GERMANY),
                id="from the kick-off when the clock goes back",
            ),
        ],
    )
    def test_a_spiel_played_is_taken(self, date: str, time: str | None, now: datetime):
        assert find_not_played_refusal(date=date, time=time, now=now) is None

    def test_each_caller_hands_the_rule_the_fixtures_kick_off(self):
        """The write's judgement and the reads' flag alike: given the day alone, either would take a report all morning."""

        report = FLSpielberichtBerichtPayload.model_validate(payload([]))
        none_new: dict[FLSpielSide, set[ObjectId]] = {"team1": set(), "team2": set()}
        early = KICK_OFF - timedelta(minutes=1)

        with pytest.raises(APIError) as refused:
            judge_bericht(context=context(), payload=report, new=none_new, now=early)
        judge_bericht(context=context(), payload=report, new=none_new, now=KICK_OFF)

        assert refused.value.error_code == Code.BERICHT_NOT_PLAYED
        assert (takes_a_bericht(spiel(), now=early), takes_a_bericht(spiel(), now=KICK_OFF)) == (False, True)


class TestACalledOffSpielTakesNoReport:
    @pytest.mark.parametrize("sonderereignis", ["ausgefallen"])
    def test_a_spiel_that_took_no_place_is_refused(self, sonderereignis: str):
        assert refused_with(Code.BERICHT_CANCELLED, find_cancelled_refusal(sonderereignis=sonderereignis))

    def test_its_form_serves_no_squads(self):
        """The referee's page reads this rather than the refusal, so the pupils' names stay off a fixture that takes no report.

        Played before `NOW` in a running season, so the call-off alone decides.
        """

        assert kader_is_open(context(sonderereignis="ausgefallen"), now=NOW) is False


class TestAFixtureAClubLeftTakesNoReportFromItsReferee:
    """The pass told the referee they no longer referee it: still taken, their report would stand on a match the club left."""

    @pytest.mark.parametrize(
        ("austritt", "refused"),
        [
            pytest.param(TODAY, True, id="the club gone by the match's day"),
            pytest.param("2027-05-15", False, id="the club gone after it"),
        ],
    )
    def test_the_booked_referee(self, austritt: str, refused: bool):
        left = spiel(team1={"team_id": TEAM1, "tore": None, "austritt": {"date": austritt}})

        assert (
            refused_with(Code.BERICHT_NOT_OFFICIATED, find_not_refereed_refusal(spiel_raw=left, schiedsrichter_ids=[SCHIEDSRICHTER])) is refused
        )


class TestANewlyNamedPupilIsInTheSquad:
    def test_a_pupil_outside_the_second_sides_live_squad_is_refused(self):
        """Each side is judged against its own squad, the second as the first: a goal must never be stored under a pupil nobody fielded."""

        new = newly_named(FLSpielberichtBerichtPayload.model_validate(payload([tor("team2", ObjectId())])), None, spiel())

        assert refused_with(Code.SPIELER_NOT_IN_KADER, find_not_in_kader_refusal(context=context(), new=new))

    def test_a_live_pupil_of_the_other_side_is_refused(self):
        """The second side's pupil credited to the first: a squad of the two sides together would take them."""

        new = newly_named(FLSpielberichtBerichtPayload.model_validate(payload([tor("team1", LIVE2)])), None, spiel())

        assert refused_with(Code.SPIELER_NOT_IN_KADER, find_not_in_kader_refusal(context=context(), new=new))


# The clubs `spiel` fields, as the report's last write found them.
SIDES: dict[FLSpielSide, ObjectId | None] = {"team1": TEAM1, "team2": TEAM2}


def saved(**fields: Any) -> FLSpielberichtBericht:
    return FLSpielberichtBericht.model_validate(bericht_document(**{"sides": SIDES, **fields}))


def played(team1: int, team2: int, **fields: Any) -> dict[str, Any]:
    return spiel(
        team1={"team_id": TEAM1, "tore": team1},
        team2={"team_id": TEAM2, "tore": team2},
        ergebnis=f"{team1}:{team2}",
        **fields,
    )


class TestTheAdoptedStateIsDerivedFromTwo:
    """The adoption and the stored result; the 1:0 proposal of `bericht_document` throughout."""

    def test_adopted_and_matching_reads_adopted(self):
        assert bericht_state_of(saved(adopted=True), played(1, 0)) == "adopted"

    def test_the_sides_swapped_read_differing(self):
        assert bericht_state_of(saved(adopted=True), played(0, 1)) == "differing"

    def test_a_result_matching_a_report_nobody_adopted_reads_proposed_and_one_not_matching_differing(self):
        """A result the administrator typed, or a report its referee corrected since its adoption: the goals may still match.

        Read as differing where they match, the report could never be adopted: the editor's fields already hold it.
        """

        assert bericht_state_of(saved(), played(1, 0)) == "proposed"
        assert bericht_state_of(saved(), played(2, 0)) == "differing"

    def test_a_spiel_holding_no_result_reads_proposed_however_it_was_stamped(self):
        assert bericht_state_of(saved(), spiel()) == "proposed"
        assert bericht_state_of(saved(adopted=True), spiel()) == "proposed"

    def test_a_no_show_matches_on_its_event_whatever_goals_the_forfeit_composed(self):
        no_show = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None, "sonderereignis": "nichtantreten_team2"}
        bericht = saved(adopted=True, ergebnis_vorschlag=no_show, scorers=[])

        assert bericht_state_of(bericht, played(3, 0, sonderereignis="nichtantreten_team2")) == "adopted"
        assert bericht_state_of(bericht, played(0, 3, sonderereignis="nichtantreten_team1")) == "differing"

    @pytest.mark.parametrize("sonderereignis", ["ausgefallen"])
    def test_a_spiel_called_off_since_the_report_reads_cancelled(self, sonderereignis: str):
        """Read-only and awaiting nobody: no write can adopt a report on a match that took no place."""

        assert bericht_state_of(saved(), spiel(sonderereignis=sonderereignis)) == "cancelled"
        assert bericht_state_of(saved(adopted=True), spiel(sonderereignis=sonderereignis)) == "cancelled"

    def test_an_abandonment_saved_without_its_result_reads_proposed(self):
        """It still owes a result, so nothing stands to differ from."""

        assert bericht_state_of(saved(), spiel(sonderereignis="abgebrochen")) == "proposed"


class TestAReportAboutOtherClubsReadsItsOwnState:
    """A knockout correction fields another club on a side the report credits goals and entries to."""

    @pytest.mark.parametrize("side", ["team1", "team2"])
    def test_a_side_fielding_another_club_reads_sides_changed_whatever_the_result(self, side: str):
        """Adopted and matching, or holding no result: the proposal still names the clubs that left."""

        bericht = saved(adopted=True, sides={**SIDES, side: ObjectId()})

        assert bericht_state_of(bericht, played(1, 0)) == "sides_changed"
        assert bericht_state_of(bericht, spiel()) == "sides_changed"

    def test_a_slot_filled_since_an_open_one_was_reported_reads_sides_changed(self):
        assert bericht_state_of(saved(sides={**SIDES, "team2": None}), spiel()) == "sides_changed"

    def test_a_spiel_called_off_reads_cancelled_first(self):
        assert bericht_state_of(saved(sides={**SIDES, "team1": ObjectId()}), spiel(sonderereignis="ausgefallen")) == "cancelled"


def level(team1: int, team2: int, elfmeterschiessen: dict[str, int] | None) -> FLSpielberichtBericht:
    """An adopted 1:1 proposal, with or without a shoot-out."""

    vorschlag = {"team1_tore": team1, "team2_tore": team2, "elfmeterschiessen": elfmeterschiessen, "sonderereignis": None}
    return saved(adopted=True, ergebnis_vorschlag=vorschlag)


class TestAShootOutIsComparedWhereTheSpielKeepsOne:
    """`apply_payload_to_spiel` keeps a shoot-out on a level knockout and discards it everywhere else."""

    @pytest.mark.parametrize(
        ("stored", "state"),
        [
            pytest.param({"team1": 4, "team2": 3}, "adopted", id="the-same-shoot-out"),
            pytest.param({"team1": 3, "team2": 4}, "differing", id="the-other-winner"),
            pytest.param(None, "differing", id="saved-without-one"),
        ],
    )
    def test_a_level_knockout_matches_on_its_shoot_out(self, stored: dict[str, int] | None, state: str):
        spiel = played(1, 1, saison_phase="achtelfinale", elfmeterschiessen=stored)

        assert bericht_state_of(level(1, 1, {"team1": 4, "team2": 3}), spiel) == state

    def test_a_level_knockout_proposing_none_differs_from_one_saved_with_one(self):
        spiel = played(1, 1, saison_phase="achtelfinale", elfmeterschiessen={"team1": 4, "team2": 3})

        assert bericht_state_of(level(1, 1, None), spiel) == "differing"


class TestAGroupSpielTakesNoShootOut:
    def test_a_group_draw_proposing_one_is_refused(self):
        vorschlag = FLSpielberichtBerichtPayload.model_validate(payload([], elfmeterschiessen={"team1": 4, "team2": 3}))

        none_new: dict[FLSpielSide, set[ObjectId]] = {"team1": set(), "team2": set()}

        # Through the judgement the write asks twice, so the rule is held where it is called as well as where it is written.
        with pytest.raises(APIError) as refused:
            judge_bericht(context=context(), payload=vorschlag, new=none_new, now=NOW)
        judge_bericht(context=context(saison_phase="achtelfinale"), payload=vorschlag, new=none_new, now=NOW)

        assert refused.value.error_code == Code.BERICHT_ELFMETER_IN_THE_GRUPPE


class TestALaterWriteClearsTheAdoption:
    def test_the_first_write_stores_the_counts_its_entries_credit_and_is_unadopted(self):
        block = compose_new_bericht(FLSpielberichtBerichtPayload.model_validate(payload([tor("team1", LIVE1)])), sides=SIDES, now=NOW)

        assert (block["adopted"], block["submitted_at"], block["sides"]) == (False, NOW, SIDES)
        assert block["ergebnis_vorschlag"] == {"team1_tore": 1, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None}

    def test_a_correction_clears_the_adoption_and_keeps_when_the_report_was_first_sent(self):
        update = compose_bericht_update(FLSpielberichtBerichtPayload.model_validate(payload([tor("team1", LIVE1)])), sides=SIDES)

        assert set(update) == {"$set"}
        assert set(update["$set"]) == {
            "bericht.ergebnis_vorschlag",
            "bericht.scorers",
            "bericht.cards",
            "bericht.remarks",
            # Re-stamped by every write, so a report the referee sends again about the clubs playing now reads adoptable.
            "bericht.sides",
            "bericht.adopted",
        }
        assert update["$set"]["bericht.adopted"] is False
        # Stored as ObjectIds, which every lookup by id matches.
        assert update["$set"]["bericht.scorers"][0]["spieler_id"] == LIVE1
