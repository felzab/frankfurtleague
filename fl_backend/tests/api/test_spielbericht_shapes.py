from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtVonSchiedsrichter,
)
from app.api.spielberichte.services import (
    BerichtLage,
    bericht_zustand_of,
    compose_bericht_update,
    compose_neuer_bericht,
    find_abgesagt_refusal,
    find_nicht_gespielt_refusal,
    find_nicht_im_kader_refusal,
    judge_bericht,
    kader_ist_offen,
    neu_genannt,
)
from app.core.codes import Code
from app.core.exceptions import APIError
from app.shared.schemas.literals import FLSpielSeite
from tests.documents import bericht_document

TEAM1 = ObjectId("650000000000000000000201")
TEAM2 = ObjectId("650000000000000000000202")
SCHIEDSRICHTER = ObjectId("650000000000000000000203")
LIVE1 = ObjectId("650000000000000000000211")
AUSGETRAGEN1 = ObjectId("650000000000000000000212")
LIVE2 = ObjectId("650000000000000000000221")
SPIEL_ID = ObjectId("650000000000000000000209")

TODAY = "2027-05-14"
NOW = datetime(2027, 5, 14, 20, tzinfo=UTC)


def tor(seite: str, spieler_id: ObjectId | None = None, *, eigentor: bool = False, minute: str = "10") -> dict[str, Any]:
    return {"seite": seite, "spieler_id": spieler_id, "minute": minute, "eigentor": eigentor}


def payload(team1_tore: int | None, team2_tore: int | None, torschuetzen: list[dict[str, Any]], **fields: Any) -> dict[str, Any]:
    return {
        "ergebnis_vorschlag": {"team1_tore": team1_tore, "team2_tore": team2_tore, "elfmeterschiessen": None, "sonderereignis": None},
        "torschuetzen": torschuetzen,
        "karten": [],
        "bemerkungen": None,
        **fields,
    }


def spiel(**fields: Any) -> dict[str, Any]:
    return {
        "_id": SPIEL_ID,
        "saison_id": "2027",
        "saison_phase": "gruppenphase",
        "datum": TODAY,
        "uhrzeit": "18:00:00",
        "team1": {"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": None},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": "Otto Gruber"},
        "sonderereignis": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        **fields,
    }


def lage(*, saison_status: str = "active", **spiel_fields: Any) -> BerichtLage:
    return BerichtLage(
        saison_status=saison_status,
        spiel=spiel(**spiel_fields),
        kader=[
            {"spieler_id": LIVE1, "team_id": TEAM1, "vorname": "Lina", "nachname": "Krause", "nummer": "7", "inactive_since": None},
            {
                "spieler_id": AUSGETRAGEN1,
                "team_id": TEAM1,
                "vorname": "Ole",
                "nachname": "Brettschneider",
                "nummer": None,
                "inactive_since": "2027-04-01",
            },
            {"spieler_id": LIVE2, "team_id": TEAM2, "vorname": "Mia", "nachname": "Westphal", "nummer": "9", "inactive_since": None},
        ],
    )


def refused_with(code: str, refusal: Any) -> bool:
    return refusal is not None and refusal.error_code == code


class TestEveryGoalHasAnEntry:
    def test_a_goal_without_an_entry_is_refused(self):
        with pytest.raises(ValidationError, match="type=torschuetzen_not_matching_tore,"):
            FLSpielberichtBerichtPayload.model_validate(payload(3, 1, [tor("team1"), tor("team2")]))

    def test_an_own_goal_counts_for_the_other_side(self):
        """`seite: team2, eigentor` credits team 1: the case a count by `seite` alone gets wrong both ways."""

        assert FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team2", LIVE2, eigentor=True)]))

        with pytest.raises(ValidationError, match="type=torschuetzen_not_matching_tore,"):
            FLSpielberichtBerichtPayload.model_validate(payload(0, 1, [tor("team2", LIVE2, eigentor=True)]))

    def test_a_no_show_proposes_the_event_alone(self):
        no_show = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None, "sonderereignis": "nichtantreten_team2"}

        assert FLSpielberichtBerichtPayload.model_validate({**payload(None, None, []), "ergebnis_vorschlag": no_show})

        with pytest.raises(ValidationError, match="type=nichtantreten_with_tore,"):
            FLSpielberichtBerichtPayload.model_validate(
                {**payload(3, 0, []), "ergebnis_vorschlag": {**no_show, "team1_tore": 3, "team2_tore": 0}}
            )
        with pytest.raises(ValidationError, match="type=nichtantreten_with_torschuetzen,"):
            FLSpielberichtBerichtPayload.model_validate({**payload(None, None, [tor("team1")]), "ergebnis_vorschlag": no_show})

    def test_a_played_match_proposes_both_counts(self):
        with pytest.raises(ValidationError, match="type=ergebnis_missing_tore,"):
            FLSpielberichtBerichtPayload.model_validate(payload(1, None, [tor("team1")]))

    def test_a_shoot_out_follows_a_draw_alone(self):
        level = payload(1, 1, [tor("team1"), tor("team2")])
        level["ergebnis_vorschlag"]["elfmeterschiessen"] = {"team1": 4, "team2": 3}

        assert FLSpielberichtBerichtPayload.model_validate(level)

        with pytest.raises(ValidationError, match="type=elfmeterschiessen_without_draw,"):
            FLSpielberichtBerichtPayload.model_validate({**level, "ergebnis_vorschlag": {**level["ergebnis_vorschlag"], "team1_tore": 2}})


class TestAReportFollowsTheMatchDay:
    @pytest.mark.parametrize("datum", [None, "2027-05-15"], ids=["undated", "tomorrow"])
    def test_an_undated_or_coming_fixture_is_refused(self, datum: str | None):
        assert refused_with(Code.BERICHT_NOT_PLAYED, find_nicht_gespielt_refusal(datum=datum, today=TODAY))


class TestACalledOffFixtureTakesNoReport:
    @pytest.mark.parametrize("sonderereignis", ["ausgefallen", "annulliert"])
    def test_a_fixture_that_took_no_place_is_refused(self, sonderereignis: str):
        assert refused_with(Code.BERICHT_ABGESAGT, find_abgesagt_refusal(sonderereignis=sonderereignis))

    def test_its_form_serves_no_squads(self):
        """The referee's page reads this rather than the refusal, so the pupils' names stay off a fixture that takes no report.

        Played today in a running season, so the call-off alone decides.
        """

        assert kader_ist_offen(lage(sonderereignis="ausgefallen"), today=TODAY) is False


class TestANewlyNamedPupilIsInTheSquad:
    def test_a_pupil_outside_the_second_sides_live_squad_is_refused(self):
        """Each side is judged against its own squad, the second as the first: a goal must never be stored under a pupil nobody fielded."""

        new = neu_genannt(FLSpielberichtBerichtPayload.model_validate(payload(0, 1, [tor("team2", ObjectId())])), None, spiel())

        assert refused_with(Code.BERICHT_NOT_IN_KADER, find_nicht_im_kader_refusal(lage=lage(), new=new))


# The clubs `spiel` fields, as the report's last write found them.
SEITEN: dict[FLSpielSeite, ObjectId | None] = {"team1": TEAM1, "team2": TEAM2}


def saved(**fields: Any) -> FLSpielberichtBericht:
    return FLSpielberichtBericht.model_validate(bericht_document(**{"seiten": SEITEN, **fields}))


def gespielt(team1: int, team2: int, **fields: Any) -> dict[str, Any]:
    return spiel(
        team1={"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": team1},
        team2={"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": team2},
        ergebnis=f"{team1}:{team2}",
        **fields,
    )


ADOPTED = {"adopted_at": NOW, "adopted_by": {"art": "admin"}, "adopted_version": 1}


class TestTheAdoptedStateIsDerivedFromThree:
    """The adoption, the block's version and the stored result; the 1:0 proposal of `bericht_document` throughout."""

    def test_adopted_unchanged_and_matching_reads_uebernommen(self):
        assert bericht_zustand_of(saved(**ADOPTED), gespielt(1, 0)) == "adopted"

    def test_a_scorer_corrected_after_the_adoption_reads_abweichend_though_the_goals_still_match(self):
        """The case the version exists for: a result-only comparison reads it adopted."""

        assert bericht_zustand_of(saved(**ADOPTED, version=2), gespielt(1, 0)) == "differing"

    def test_the_sides_swapped_read_abweichend(self):
        assert bericht_zustand_of(saved(**ADOPTED), gespielt(0, 1)) == "differing"

    def test_a_result_the_administrator_typed_without_adopting_reads_abweichend(self):
        assert bericht_zustand_of(saved(), gespielt(1, 0)) == "differing"

    def test_a_fixture_holding_no_result_reads_vorgeschlagen_however_it_was_stamped(self):
        assert bericht_zustand_of(saved(), spiel()) == "vorgeschlagen"
        assert bericht_zustand_of(saved(**ADOPTED), spiel()) == "vorgeschlagen"

    def test_a_no_show_matches_on_its_event_whatever_goals_the_forfeit_composed(self):
        no_show = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None, "sonderereignis": "nichtantreten_team2"}
        bericht = saved(**ADOPTED, ergebnis_vorschlag=no_show, torschuetzen=[])

        assert bericht_zustand_of(bericht, gespielt(3, 0, sonderereignis="nichtantreten_team2")) == "adopted"
        assert bericht_zustand_of(bericht, gespielt(0, 3, sonderereignis="nichtantreten_team1")) == "differing"

    @pytest.mark.parametrize("sonderereignis", ["ausgefallen", "annulliert"])
    def test_a_fixture_called_off_since_the_report_reads_abgesagt(self, sonderereignis: str):
        """Read-only and awaiting nobody: no write can adopt a report on a match that took no place."""

        assert bericht_zustand_of(saved(), spiel(sonderereignis=sonderereignis)) == "abgesagt"
        assert bericht_zustand_of(saved(**ADOPTED), spiel(sonderereignis=sonderereignis)) == "abgesagt"

    def test_an_abandonment_saved_without_its_result_reads_vorgeschlagen(self):
        """It still owes a result, so nothing stands to differ from."""

        assert bericht_zustand_of(saved(), spiel(sonderereignis="abgebrochen")) == "vorgeschlagen"


class TestAReportAboutOtherClubsReadsItsOwnState:
    """A knockout correction fields another club on a side the report credits goals and entries to."""

    @pytest.mark.parametrize("seite", ["team1", "team2"])
    def test_a_side_fielding_another_club_reads_teams_geaendert_whatever_the_result(self, seite: str):
        """Adopted and matching, or holding no result: the proposal still names the clubs that left."""

        bericht = saved(**ADOPTED, seiten={**SEITEN, seite: ObjectId()})

        assert bericht_zustand_of(bericht, gespielt(1, 0)) == "teams_changed"
        assert bericht_zustand_of(bericht, spiel()) == "teams_changed"

    def test_a_slot_filled_since_an_open_one_was_reported_reads_teams_geaendert(self):
        assert bericht_zustand_of(saved(seiten={**SEITEN, "team2": None}), spiel()) == "teams_changed"

    def test_a_fixture_called_off_reads_abgesagt_first(self):
        assert bericht_zustand_of(saved(seiten={**SEITEN, "team1": ObjectId()}), spiel(sonderereignis="ausgefallen")) == "abgesagt"


def level(team1: int, team2: int, elfmeterschiessen: dict[str, int] | None) -> FLSpielberichtBericht:
    """An adopted 1:1 proposal, with or without a shoot-out."""

    vorschlag = {"team1_tore": team1, "team2_tore": team2, "elfmeterschiessen": elfmeterschiessen, "sonderereignis": None}
    return saved(**ADOPTED, ergebnis_vorschlag=vorschlag)


class TestAShootOutIsComparedWhereTheFixtureKeepsOne:
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
        fixture = gespielt(1, 1, saison_phase="achtelfinale", elfmeterschiessen=stored)

        assert bericht_zustand_of(level(1, 1, {"team1": 4, "team2": 3}), fixture) == state

    def test_a_level_knockout_proposing_none_differs_from_one_saved_with_one(self):
        fixture = gespielt(1, 1, saison_phase="achtelfinale", elfmeterschiessen={"team1": 4, "team2": 3})

        assert bericht_zustand_of(level(1, 1, None), fixture) == "differing"


class TestAGroupFixtureTakesNoShootOut:
    def test_a_group_draw_proposing_one_is_refused(self):
        vorschlag = FLSpielberichtBerichtPayload.model_validate(
            payload(
                0,
                0,
                [],
                ergebnis_vorschlag={"team1_tore": 0, "team2_tore": 0, "elfmeterschiessen": {"team1": 4, "team2": 3}, "sonderereignis": None},
            )
        )

        keine: dict[FLSpielSeite, set[ObjectId]] = {"team1": set(), "team2": set()}

        # Through the judgement the write asks twice, so the rule is held where it is called as well as where it is written.
        with pytest.raises(APIError) as refused:
            judge_bericht(lage=lage(), payload=vorschlag, new=keine, today=TODAY)
        judge_bericht(lage=lage(saison_phase="achtelfinale"), payload=vorschlag, new=keine, today=TODAY)

        assert refused.value.error_code == Code.BERICHT_ELFMETER_IN_THE_GRUPPE


class TestALaterWriteRaisesTheVersionAndKeepsTheAdoption:
    def test_the_first_write_is_version_one_and_unadopted(self):
        block = compose_neuer_bericht(
            FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team1", LIVE1)])),
            by=FLSpielberichtVonSchiedsrichter(art="schiedsrichter", schiedsrichter_id=SCHIEDSRICHTER),
            seiten=SEITEN,
            now=NOW,
        )

        assert (block["version"], block["adopted_version"], block["submitted_at"], block["changed_at"]) == (1, None, NOW, NOW)
        assert block["seiten"] == SEITEN
        assert block["submitted_by"] == {"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}

    def test_a_correction_touches_neither_who_first_wrote_it_nor_the_adoption(self):
        update = compose_bericht_update(
            FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team1", LIVE1)])), seiten=SEITEN, now=NOW
        )

        assert update["$inc"] == {"bericht.version": 1}
        assert set(update["$set"]) == {
            "bericht.ergebnis_vorschlag",
            "bericht.torschuetzen",
            "bericht.karten",
            "bericht.bemerkungen",
            # Re-stamped by every write, so a report the referee sends again about the clubs playing now reads adoptable.
            "bericht.seiten",
            "bericht.changed_at",
        }
        # Stored as ObjectIds, which every lookup by id matches.
        assert update["$set"]["bericht.torschuetzen"][0]["spieler_id"] == LIVE1
