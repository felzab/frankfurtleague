from datetime import UTC, datetime
from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError

from app.api.spielberichte.schemas import (
    FLSpielberichtBericht,
    FLSpielberichtBerichtPayload,
    FLSpielberichtKarte,
    FLSpielberichtSeite,
    FLSpielberichtVonSchiedsrichter,
)
from app.api.spielberichte.services import (
    BerichtLage,
    bericht_zustand_of,
    compose_ansicht,
    compose_bericht_update,
    compose_neuer_bericht,
    find_abgesagt_refusal,
    find_grund_fehlt_refusal,
    find_nicht_geleitet_refusal,
    find_nicht_gespielt_refusal,
    find_nicht_im_kader_refusal,
    judge_bericht,
    kader_ist_offen,
    neu_genannt,
)
from app.core.codes import Code
from app.core.exceptions import APIError
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


def karte(farbe: str, grund: str | None, *, minute: str = "12", spieler_id: ObjectId = LIVE1) -> dict[str, Any]:
    return {"seite": "team1", "spieler_id": spieler_id, "minute": minute, "farbe": farbe, "grund": grund}


def mit_karten(*karten: dict[str, Any]) -> FLSpielberichtBerichtPayload:
    return FLSpielberichtBerichtPayload.model_validate(payload(0, 0, [], karten=list(karten)))


class TestOnlyANewCautionOwesItsReason:
    """A season's end strips every card's reason, and a correction after it resends the cautions it stripped."""

    @pytest.mark.parametrize("farbe", ["gelb", "gelb_rot"])
    def test_a_caution_without_a_reason_is_refused_at_its_box(self, farbe: str):
        refusal = find_grund_fehlt_refusal(payload=mit_karten(karte("rot", None), karte(farbe, None)), gespeichert=None)

        assert refused_with(Code.BERICHT_GRUND_FEHLT, refusal)
        assert refusal is not None and refusal.fields == (("bericht", "karten"),)

    def test_a_red_card_may_stand_without_one(self):
        assert find_grund_fehlt_refusal(payload=mit_karten(karte("rot", None)), gespeichert=None) is None

    @pytest.mark.parametrize("minute", ["12", "14"], ids=["resent-as-stored", "its-minute-corrected"])
    def test_a_caution_stored_stripped_is_resent_without_one(self, minute: str):
        stripped = {"karten": [karte("gelb", None)]}

        assert find_grund_fehlt_refusal(payload=mit_karten(karte("gelb", None, minute=minute)), gespeichert=stripped) is None

    @pytest.mark.parametrize(
        "neu",
        [
            pytest.param(karte("gelb_rot", None), id="another-colour"),
            pytest.param(karte("gelb", None, spieler_id=AUSGETRAGEN1), id="another-pupil"),
        ],
    )
    def test_any_other_caution_is_refused(self, neu: dict[str, Any]):
        stripped = {"karten": [karte("gelb", None)]}

        assert refused_with(Code.BERICHT_GRUND_FEHLT, find_grund_fehlt_refusal(payload=mit_karten(neu), gespeichert=stripped))

    def test_each_stripped_card_excuses_one_caution(self):
        stripped = {"karten": [karte("gelb", None)]}

        refusal = find_grund_fehlt_refusal(payload=mit_karten(karte("gelb", None), karte("gelb", None, minute="80")), gespeichert=stripped)

        assert refused_with(Code.BERICHT_GRUND_FEHLT, refusal)

    def test_a_stored_caution_reads_without_one(self):
        """A season's end strips every card's reason, and the reads serve the report after it."""

        karte = FLSpielberichtKarte.model_validate({"seite": "team1", "spieler_id": LIVE1, "minute": "12", "farbe": "gelb", "grund": None})

        assert karte.grund is None


class TestEveryGoalHasAnEntry:
    def test_a_goal_without_an_entry_is_refused(self):
        with pytest.raises(ValidationError, match="genau einen Eintrag"):
            FLSpielberichtBerichtPayload.model_validate(payload(3, 1, [tor("team1"), tor("team2")]))

    def test_a_scorer_nobody_named_is_an_entry(self):
        bericht = FLSpielberichtBerichtPayload.model_validate(payload(3, 1, [tor("team1", LIVE1), tor("team1"), tor("team1"), tor("team2")]))

        assert [entry.spieler_id for entry in bericht.torschuetzen] == [LIVE1, None, None, None]

    def test_an_own_goal_counts_for_the_other_side(self):
        """`seite: team2, eigentor` credits team 1: the case a count by `seite` alone gets wrong both ways."""

        assert FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team2", LIVE2, eigentor=True)]))

        with pytest.raises(ValidationError, match="genau einen Eintrag"):
            FLSpielberichtBerichtPayload.model_validate(payload(0, 1, [tor("team2", LIVE2, eigentor=True)]))

    def test_a_no_show_proposes_the_event_alone(self):
        no_show = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None, "sonderereignis": "nichtantreten_team2"}

        assert FLSpielberichtBerichtPayload.model_validate({**payload(None, None, []), "ergebnis_vorschlag": no_show})

        with pytest.raises(ValidationError, match="keine Tore"):
            FLSpielberichtBerichtPayload.model_validate(
                {**payload(3, 0, []), "ergebnis_vorschlag": {**no_show, "team1_tore": 3, "team2_tore": 0}}
            )
        with pytest.raises(ValidationError, match="keine Torschützen"):
            FLSpielberichtBerichtPayload.model_validate({**payload(None, None, [tor("team1")]), "ergebnis_vorschlag": no_show})

    def test_a_played_match_proposes_both_counts(self):
        with pytest.raises(ValidationError, match="beider Teams"):
            FLSpielberichtBerichtPayload.model_validate(payload(1, None, [tor("team1")]))

    def test_a_shoot_out_follows_a_draw_alone(self):
        level = payload(1, 1, [tor("team1"), tor("team2")])
        level["ergebnis_vorschlag"]["elfmeterschiessen"] = {"team1": 4, "team2": 3}

        assert FLSpielberichtBerichtPayload.model_validate(level)

        with pytest.raises(ValidationError, match="Unentschieden"):
            FLSpielberichtBerichtPayload.model_validate({**level, "ergebnis_vorschlag": {**level["ergebnis_vorschlag"], "team1_tore": 2}})

    @pytest.mark.parametrize("minute", ["45 +2", "", "90+", "1000"])
    def test_a_minute_outside_the_report_s_vocabulary_is_refused(self, minute: str):
        with pytest.raises(ValidationError):
            FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team1", minute=minute)]))


class TestAReportFollowsTheMatchDay:
    @pytest.mark.parametrize("datum", [TODAY, "2027-05-13"], ids=["the day itself", "a day after"])
    def test_a_played_day_is_reported_on(self, datum: str):
        assert find_nicht_gespielt_refusal(datum=datum, today=TODAY) is None

    @pytest.mark.parametrize("datum", [None, "2027-05-15"], ids=["undated", "tomorrow"])
    def test_an_undated_or_coming_fixture_is_refused(self, datum: str | None):
        assert refused_with(Code.BERICHT_NICHT_GESPIELT, find_nicht_gespielt_refusal(datum=datum, today=TODAY))


class TestACalledOffFixtureTakesNoReport:
    @pytest.mark.parametrize("sonderereignis", ["ausgefallen", "annulliert"])
    def test_a_fixture_that_took_no_place_is_refused(self, sonderereignis: str):
        assert refused_with(Code.BERICHT_ABGESAGT, find_abgesagt_refusal(sonderereignis=sonderereignis))

    @pytest.mark.parametrize("sonderereignis", [None, "abgebrochen", "nichtantreten_team1"])
    def test_one_that_took_place_is_reported_on(self, sonderereignis: str | None):
        assert find_abgesagt_refusal(sonderereignis=sonderereignis) is None

    def test_its_form_serves_no_squads(self):
        """The referee's page reads this rather than the refusal, so the pupils' names stay off a fixture that takes no report.

        Played today in a running season, so the call-off alone decides.
        """

        assert kader_ist_offen(lage(sonderereignis="ausgefallen"), today=TODAY) is False


class TestOnlyTheBookedRefereeReports:
    def test_the_booked_referee_is_admitted_from_any_of_their_records(self):
        """A person may hold several referee records, read in no set order: the booked one need not come first."""

        assert find_nicht_geleitet_refusal(spiel_raw=spiel(), schiedsrichter_ids=[ObjectId("650000000000000000000204"), SCHIEDSRICHTER]) is None


class TestANewlyNamedPupilIsInTheSquad:
    def test_a_pupil_outside_the_second_sides_live_squad_is_refused(self):
        """Each side is judged against its own squad, the second as the first: a goal must never be stored under a pupil nobody fielded."""

        neu = neu_genannt(FLSpielberichtBerichtPayload.model_validate(payload(0, 1, [tor("team2", ObjectId())])), None, spiel())

        assert refused_with(Code.BERICHT_NICHT_IM_KADER, find_nicht_im_kader_refusal(lage=lage(), neu=neu))


# The clubs `spiel` fields, as the report's last write found them.
SEITEN: dict[FLSpielberichtSeite, ObjectId | None] = {"team1": TEAM1, "team2": TEAM2}


def gespeichert(**fields: Any) -> FLSpielberichtBericht:
    return FLSpielberichtBericht.model_validate(bericht_document(**{"seiten": SEITEN, **fields}))


def gespielt(team1: int, team2: int, **fields: Any) -> dict[str, Any]:
    return spiel(
        team1={"team_id": TEAM1, "name": "Adler", "shorthand": "ADX", "tore": team1},
        team2={"team_id": TEAM2, "name": "Biber", "shorthand": "BIX", "tore": team2},
        ergebnis=f"{team1}:{team2}",
        **fields,
    )


ADOPTED = {"uebernommen_am": NOW, "uebernommen_von": {"art": "admin"}, "uebernommene_version": 1}


class TestTheAdoptedStateIsDerivedFromThree:
    """The adoption, the block's version and the stored result; the 1:0 proposal of `bericht_document` throughout."""

    def test_adopted_unchanged_and_matching_reads_uebernommen(self):
        assert bericht_zustand_of(gespeichert(**ADOPTED), gespielt(1, 0)) == "uebernommen"

    def test_a_scorer_corrected_after_the_adoption_reads_abweichend_though_the_goals_still_match(self):
        """The case the version exists for: a result-only comparison reads it adopted."""

        assert bericht_zustand_of(gespeichert(**ADOPTED, version=2), gespielt(1, 0)) == "abweichend"

    def test_the_sides_swapped_read_abweichend(self):
        assert bericht_zustand_of(gespeichert(**ADOPTED), gespielt(0, 1)) == "abweichend"

    def test_a_result_the_administrator_typed_without_adopting_reads_abweichend(self):
        assert bericht_zustand_of(gespeichert(), gespielt(1, 0)) == "abweichend"

    def test_a_fixture_holding_no_result_reads_vorgeschlagen_however_it_was_stamped(self):
        assert bericht_zustand_of(gespeichert(), spiel()) == "vorgeschlagen"
        assert bericht_zustand_of(gespeichert(**ADOPTED), spiel()) == "vorgeschlagen"

    def test_a_no_show_matches_on_its_event_whatever_goals_the_forfeit_composed(self):
        no_show = {"team1_tore": None, "team2_tore": None, "elfmeterschiessen": None, "sonderereignis": "nichtantreten_team2"}
        bericht = gespeichert(**ADOPTED, ergebnis_vorschlag=no_show, torschuetzen=[])

        assert bericht_zustand_of(bericht, gespielt(3, 0, sonderereignis="nichtantreten_team2")) == "uebernommen"
        assert bericht_zustand_of(bericht, gespielt(0, 3, sonderereignis="nichtantreten_team1")) == "abweichend"

    @pytest.mark.parametrize("sonderereignis", ["ausgefallen", "annulliert"])
    def test_a_fixture_called_off_since_the_report_reads_abgesagt(self, sonderereignis: str):
        """Read-only and awaiting nobody: no write can adopt a report on a match that took no place."""

        assert bericht_zustand_of(gespeichert(), spiel(sonderereignis=sonderereignis)) == "abgesagt"
        assert bericht_zustand_of(gespeichert(**ADOPTED), spiel(sonderereignis=sonderereignis)) == "abgesagt"

    def test_an_abandonment_saved_without_its_result_reads_vorgeschlagen(self):
        """It still owes a result, so nothing stands to differ from."""

        assert bericht_zustand_of(gespeichert(), spiel(sonderereignis="abgebrochen")) == "vorgeschlagen"


class TestAReportAboutOtherClubsReadsItsOwnState:
    """A knockout correction fields another club on a side the report credits goals and entries to."""

    @pytest.mark.parametrize("seite", ["team1", "team2"])
    def test_a_side_fielding_another_club_reads_teams_geaendert_whatever_the_result(self, seite: str):
        """Adopted and matching, or holding no result: the proposal still names the clubs that left."""

        bericht = gespeichert(**ADOPTED, seiten={**SEITEN, seite: ObjectId()})

        assert bericht_zustand_of(bericht, gespielt(1, 0)) == "teams_geaendert"
        assert bericht_zustand_of(bericht, spiel()) == "teams_geaendert"

    def test_a_slot_filled_since_an_open_one_was_reported_reads_teams_geaendert(self):
        assert bericht_zustand_of(gespeichert(seiten={**SEITEN, "team2": None}), spiel()) == "teams_geaendert"

    def test_a_fixture_called_off_reads_abgesagt_first(self):
        assert bericht_zustand_of(gespeichert(seiten={**SEITEN, "team1": ObjectId()}), spiel(sonderereignis="ausgefallen")) == "abgesagt"

    def test_both_forms_are_served_the_sides_that_moved(self):
        """The referee's read carries no `zustand`, so this is what its form marks a moved side's entries by."""

        dokument = {"bericht": bericht_document(seiten={**SEITEN, "team2": ObjectId()})}

        assert compose_ansicht(lage(), kader_offen=True, genannt=[], dokument=dokument)["seiten_geaendert"] == ["team2"]
        assert compose_ansicht(lage(), kader_offen=True, genannt=[], dokument=None)["seiten_geaendert"] == []


def level(team1: int, team2: int, elfmeterschiessen: dict[str, int] | None) -> FLSpielberichtBericht:
    """An adopted 1:1 proposal, with or without a shoot-out."""

    vorschlag = {"team1_tore": team1, "team2_tore": team2, "elfmeterschiessen": elfmeterschiessen, "sonderereignis": None}
    return gespeichert(**ADOPTED, ergebnis_vorschlag=vorschlag)


class TestAShootOutIsComparedWhereTheFixtureKeepsOne:
    """`apply_payload_to_spiel` keeps a shoot-out on a level knockout and discards it everywhere else."""

    @pytest.mark.parametrize(
        ("stored", "zustand"),
        [
            pytest.param({"team1": 4, "team2": 3}, "uebernommen", id="the-same-shoot-out"),
            pytest.param({"team1": 3, "team2": 4}, "abweichend", id="the-other-winner"),
            pytest.param(None, "abweichend", id="saved-without-one"),
        ],
    )
    def test_a_level_knockout_matches_on_its_shoot_out(self, stored: dict[str, int] | None, zustand: str):
        fixture = gespielt(1, 1, saison_phase="achtelfinale", elfmeterschiessen=stored)

        assert bericht_zustand_of(level(1, 1, {"team1": 4, "team2": 3}), fixture) == zustand

    def test_a_level_knockout_proposing_none_differs_from_one_saved_with_one(self):
        fixture = gespielt(1, 1, saison_phase="achtelfinale", elfmeterschiessen={"team1": 4, "team2": 3})

        assert bericht_zustand_of(level(1, 1, None), fixture) == "abweichend"


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

        keine: dict[FLSpielberichtSeite, set[ObjectId]] = {"team1": set(), "team2": set()}

        # Through the judgement both writes ask, so the rule is held where it is called as well as where it is written.
        with pytest.raises(APIError) as refused:
            judge_bericht(lage=lage(), payload=vorschlag, gespeichert=None, neu=keine, today=TODAY)
        judge_bericht(lage=lage(saison_phase="achtelfinale"), payload=vorschlag, gespeichert=None, neu=keine, today=TODAY)

        assert refused.value.error_code == Code.BERICHT_ELFMETER_IN_DER_GRUPPE


class TestALaterWriteRaisesTheVersionAndKeepsTheAdoption:
    def test_the_first_write_is_version_one_and_unadopted(self):
        block = compose_neuer_bericht(
            FLSpielberichtBerichtPayload.model_validate(payload(1, 0, [tor("team1", LIVE1)])),
            von=FLSpielberichtVonSchiedsrichter(art="schiedsrichter", schiedsrichter_id=SCHIEDSRICHTER),
            seiten=SEITEN,
            now=NOW,
        )

        assert (block["version"], block["uebernommene_version"], block["eingereicht_am"], block["geaendert_am"]) == (1, None, NOW, NOW)
        assert block["seiten"] == SEITEN
        assert block["eingereicht_von"] == {"art": "schiedsrichter", "schiedsrichter_id": SCHIEDSRICHTER}

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
            "bericht.geaendert_am",
        }
        # Stored as ObjectIds, which the validator requires.
        assert update["$set"]["bericht.torschuetzen"][0]["spieler_id"] == LIVE1
