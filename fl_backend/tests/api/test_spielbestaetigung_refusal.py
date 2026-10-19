from typing import Any

import pytest
from bson import ObjectId

from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungTermin
from app.api.spielbestaetigungen.services import (
    ANSETZUNG_BEANTWORTET,
    ANSETZUNG_ENTSCHIEDEN,
    ANSETZUNG_FRIST_VORBEI,
    ANSETZUNG_GEAENDERT,
    ANSETZUNG_GESCHLOSSEN,
    ANSETZUNG_NAME_IN_BEGRUENDUNG,
    ANSETZUNG_TOKEN_UNKNOWN,
    ANSETZUNG_VORSCHLAG_VERGANGEN,
    AnsetzungLage,
    ansicht_ansetzung_of,
    beteiligte_namen,
    compose_ansetzung,
    find_name_in_begruendung_refusal,
    find_spent_link_refusal,
    find_unknown_link_refusal,
    find_vorschlag_vergangen_refusal,
    proposal_payload,
    zustand_of,
)
from app.api.spiele.schemas import FLSpiel
from app.api.teams.schemas import KONTAKT_ROLLEN

TEAM1 = ObjectId("650000000000000000000101")
TEAM2 = ObjectId("650000000000000000000102")
SPIELORT = ObjectId("650000000000000000000103")
SCHIEDSRICHTER = ObjectId("650000000000000000000104")
SPIELTAG = ObjectId("650000000000000000000105")

TODAY = "2027-05-01"
FRIST = "2027-05-07"
DATUM = "2027-05-14"

SEATS = {
    TEAM1: {"trainer": ("Ida", "Albers"), "ansprechperson": ("Jonas", "Brandt"), "stellvertretung": ("Klara", "Cordes")},
    TEAM2: {"trainer": ("Lea", "Dietz"), "ansprechperson": ("Mats", "Ernst"), "stellvertretung": ("Nora", "Funke")},
}
REFEREE = "Otto Gruber"


def spiel(**overrides: Any) -> dict[str, Any]:
    """A raw fixture as the collection stores it: dated, both sides, a ground and a referee."""

    return {
        "_id": ObjectId("650000000000000000000109"),
        "spiel_nr": 7,
        "saison_id": "2027",
        "saison_phase": "gruppenphase",
        "spieltag_id": SPIELTAG,
        "datum": DATUM,
        "uhrzeit": "18:30:00",
        "ort": {"spielort_id": SPIELORT, "name": "Halle Ost", "maps_link": "Halle Ost, Frankfurt", "mietpreis": 40},
        "schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": REFEREE, "payment": 20},
        "team1": {"team_id": TEAM1, "name": "Adler", "shorthand": "AD", "tore": None},
        "team2": {"team_id": TEAM2, "name": "Biber", "shorthand": "BI", "tore": None},
        "team1_quelle": None,
        "team2_quelle": None,
        "ergebnis": None,
        "elfmeterschiessen": None,
        "sonderereignis": None,
        "notiz": "Flutlicht",
        **overrides,
    }


def verein(team_id: ObjectId, *, austritt: str | None = None) -> dict[str, Any]:
    kontakte = {
        seat: {"vorname": vorname, "nachname": nachname, "email": f"{vorname.lower()}@example.com"}
        for seat, (vorname, nachname) in SEATS[team_id].items()
    }

    return {
        "team_id": team_id,
        "name": "Adler" if team_id == TEAM1 else "Biber",
        "austritt": None if austritt is None else {"datum": austritt},
        "kontakte": kontakte,
    }


def lage(*, spiel_overrides: dict[str, Any] | None = None, austritt: str | None = None) -> AnsetzungLage:
    return AnsetzungLage(spiel=spiel(**(spiel_overrides or {})), vereine=[verein(TEAM1, austritt=austritt), verein(TEAM2)])


def zeile(**overrides: Any) -> dict[str, Any]:
    """An open row of TEAM1's about `spiel()`'s Ansetzung."""

    return {
        "_id": ObjectId("650000000000000000000110"),
        "saison_id": "2027",
        "spiel_id": spiel()["_id"],
        "partei": {"art": "team", "team_id": TEAM1},
        "ansetzung": compose_ansetzung(spiel()),
        "frist": FRIST,
        "antwort": None,
        "geschlossen": None,
        **overrides,
    }


ANSWERED = {"art": "zugesagt", "am": TODAY, "von": {"art": "kontakt", "rolle": "trainer"}, "vorschlag": None, "begruendung": None}


class TestATokenNoSeatHolds:
    def test_a_token_resolving_to_no_seat_is_refused_and_one_resolving_is_not(self):
        refusal = find_unknown_link_refusal(seat=None)

        assert refusal is not None and refusal.error_code == ANSETZUNG_TOKEN_UNKNOWN
        assert find_unknown_link_refusal(seat="trainer") is None


class TestASpentLinkMeetsTheCodeThatNamesWhy:
    """Each code alone, then every pair in the order the answer meets them: a row both answered and moved is `-002`."""

    @pytest.mark.parametrize(
        ("row", "situation", "today", "code"),
        [
            pytest.param({"antwort": ANSWERED}, {}, TODAY, ANSETZUNG_BEANTWORTET, id="answered"),
            pytest.param({}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, TODAY, ANSETZUNG_GEAENDERT, id="moved"),
            pytest.param({}, {"spiel_overrides": {"ergebnis": "2:1"}}, TODAY, ANSETZUNG_ENTSCHIEDEN, id="a-result"),
            pytest.param({}, {"spiel_overrides": {"sonderereignis": "ausgefallen"}}, TODAY, ANSETZUNG_ENTSCHIEDEN, id="called-off"),
            pytest.param(
                {"antwort": ANSWERED, "geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}},
                {"spiel_overrides": {"uhrzeit": "19:00:00"}},
                "2027-05-08",
                ANSETZUNG_BEANTWORTET,
                id="answered-ahead-of-closed-late-and-moved",
            ),
            pytest.param(
                {"geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}},
                {"spiel_overrides": {"uhrzeit": "19:00:00"}},
                "2027-05-08",
                ANSETZUNG_GESCHLOSSEN,
                id="closed-ahead-of-late-and-moved",
            ),
            pytest.param(
                {},
                {"spiel_overrides": {"uhrzeit": "19:00:00", "ergebnis": "2:1"}},
                "2027-05-08",
                ANSETZUNG_FRIST_VORBEI,
                id="late-ahead-of-moved",
            ),
            pytest.param(
                {}, {"spiel_overrides": {"uhrzeit": "19:00:00", "ergebnis": "2:1"}}, TODAY, ANSETZUNG_GEAENDERT, id="moved-ahead-of-decided"
            ),
        ],
    )
    def test_the_first_reason_in_order_answers(self, row: dict[str, Any], situation: dict[str, Any], today: str, code: str):
        refusal = find_spent_link_refusal(spielbestaetigung_raw=zeile(**row), lage=lage(**situation), today=today)

        assert refusal is not None and refusal.error_code == code

    def test_a_closed_row_a_lapsed_one_and_one_a_club_left_each_answer_their_own_code(self):
        def code_of(row: dict[str, Any], situation: dict[str, Any], today: str = TODAY) -> str | None:
            refusal = find_spent_link_refusal(spielbestaetigung_raw=zeile(**row), lage=lage(**situation), today=today)
            return None if refusal is None else refusal.error_code

        assert code_of({"geschlossen": {"am": TODAY, "grund": "verworfen"}}, {}) == ANSETZUNG_GESCHLOSSEN
        assert code_of({}, {}, today="2027-05-08") == ANSETZUNG_FRIST_VORBEI
        assert code_of({}, {"austritt": DATUM}) == ANSETZUNG_ENTSCHIEDEN

    def test_an_open_row_about_the_fixture_as_it_stands_answers_on_its_deadline_day(self):
        """The deadline's own day still answers, and a club leaving AFTER the fixture's day decides nothing about it."""

        assert find_spent_link_refusal(spielbestaetigung_raw=zeile(), lage=lage(austritt="2027-05-15"), today=FRIST) is None


class TestWhatAReopenedLinkShows:
    """The view's states in their order: the ban first, then the answer, then a moved stand before a lapse."""

    OTHER = FLSpielbestaetigungTermin(datum="2027-05-20", uhrzeit="18:00:00")

    @pytest.mark.parametrize(
        ("row", "situation", "today", "gesperrt", "vorschlag", "zustand"),
        [
            pytest.param({"antwort": ANSWERED}, {}, TODAY, True, None, "gesperrt", id="barred-ahead-of-answered"),
            pytest.param(
                {"antwort": ANSWERED}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, TODAY, False, None, "zugesagt", id="answered-then-moved"
            ),
            pytest.param({"antwort": {**ANSWERED, "art": "abgelehnt"}}, {}, TODAY, False, None, "abgelehnt", id="declined"),
            pytest.param({}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, "2027-05-08", False, None, "ungueltig", id="moved-ahead-of-late"),
            pytest.param(
                {"geschlossen": {"am": TODAY, "grund": "schiedsrichter_gewechselt"}}, {}, TODAY, False, None, "ungueltig", id="referee-changed"
            ),
            pytest.param({"geschlossen": {"am": TODAY, "grund": "verworfen"}}, {}, TODAY, False, None, "abgelaufen", id="closed-otherwise"),
            pytest.param({}, {"spiel_overrides": {"ergebnis": "2:1"}}, TODAY, False, None, "abgelaufen", id="decided"),
            pytest.param({}, {}, "2027-05-08", False, OTHER, "abgelaufen", id="late-ahead-of-a-proposal"),
            pytest.param({}, {}, TODAY, False, OTHER, "vorschlag", id="the-other-club-proposes"),
            pytest.param({}, {}, TODAY, False, None, "gueltig", id="open"),
        ],
    )
    def test_the_first_matching_state_wins(
        self,
        row: dict[str, Any],
        situation: dict[str, Any],
        today: str,
        gesperrt: bool,
        vorschlag: FLSpielbestaetigungTermin | None,
        zustand: str,
    ):
        assert (
            zustand_of(spielbestaetigung_raw=zeile(**row), lage=lage(**situation), today=today, gesperrt=gesperrt, vorschlag_offen=vorschlag)
            == zustand
        )


class TestWhatTheViewStatesOfTheFixture:
    def test_a_fixture_that_lost_its_day_and_a_side_is_stated_as_the_row_asked_about_it(self):
        """Only a spent link meets such a fixture; the required fields still fill rather than answering 500."""

        moved = lage(spiel_overrides={"datum": None, "uhrzeit": None, "team2": None, "ort": None})
        ansetzung = ansicht_ansetzung_of(spielbestaetigung_raw=zeile(), lage=moved)

        assert (ansetzung.team1_name, ansetzung.team2_name, ansetzung.datum, ansetzung.uhrzeit, ansetzung.spielort) == (
            "Adler",
            "Biber",
            DATUM,
            "18:30:00",
            None,
        )


class TestAProposalBeforeToday:
    def test_yesterday_is_refused_and_today_is_not(self):
        refusal = find_vorschlag_vergangen_refusal(vorschlag=FLSpielbestaetigungTermin(datum="2027-04-30", uhrzeit="18:00:00"), today=TODAY)

        assert refusal is not None and refusal.error_code == ANSETZUNG_VORSCHLAG_VERGANGEN
        assert find_vorschlag_vergangen_refusal(vorschlag=FLSpielbestaetigungTermin(datum=TODAY, uhrzeit="18:00:00"), today=TODAY) is None


class TestTheProposalIsTheFixtureOnItsNewDate:
    def test_only_the_day_and_the_hour_move(self):
        """Every reference and the event kept, so the judges weigh the claims a moved date makes and nothing else."""

        stored = FLSpiel.model_validate(spiel())
        proposed = proposal_payload(stored, FLSpielbestaetigungTermin(datum="2027-05-15", uhrzeit="17:00:00"))

        assert (proposed.datum, proposed.uhrzeit) == ("2027-05-15", "17:00:00")
        assert proposed.ort is not None and stored.ort is not None and proposed.ort.spielort_id == stored.ort.spielort_id
        assert proposed.schiedsrichter is not None and proposed.schiedsrichter.schiedsrichter_id == SCHIEDSRICHTER
        assert (proposed.team1, proposed.team2, proposed.sonderereignis) == (
            proposal_payload(stored, FLSpielbestaetigungTermin(datum=DATUM, uhrzeit="18:30:00")).team1,
            proposal_payload(stored, FLSpielbestaetigungTermin(datum=DATUM, uhrzeit="18:30:00")).team2,
            None,
        )
        assert proposed.team1 is not None and proposed.team1.team_id == TEAM1


class TestANameInTheBegruendung:
    """Every name of the Ansetzung's people refused, each seat of each club and the referee; a word naming nobody passes."""

    @pytest.mark.parametrize(
        "name",
        [
            *(
                pytest.param(name, id=f"{team}-{seat}-{part}")
                for team, seats in (("team1", SEATS[TEAM1]), ("team2", SEATS[TEAM2]))
                for seat, pair in seats.items()
                for part, name in zip(("vorname", "nachname"), pair, strict=True)
            ),
            pytest.param("Otto", id="referee-first-word"),
            pytest.param("Gruber", id="referee-last-word"),
        ],
    )
    def test_a_name_of_anybody_on_the_fixture_is_refused(self, name: str):
        refusal = find_name_in_begruendung_refusal(begruendung=f"Leider hat {name} an dem Tag Prüfungen", names=beteiligte_namen(lage=lage()))

        assert refusal is not None and refusal.error_code == ANSETZUNG_NAME_IN_BEGRUENDUNG
        assert refusal.fields == (("begruendung",),)

    def test_a_reason_naming_nobody_is_taken(self):
        assert find_name_in_begruendung_refusal(begruendung="Die Halle ist an dem Abend belegt", names=beteiligte_namen(lage=lage())) is None

    def test_the_ghost_referee_names_nobody(self):
        """An erased referee's fixture keeps a null name, which must refuse no reason at all."""

        names = beteiligte_namen(
            lage=lage(spiel_overrides={"schiedsrichter": {"schiedsrichter_id": SCHIEDSRICHTER, "name": None, "payment": 0}})
        )

        assert "" not in names and "Gruber" not in names

    def test_every_seat_of_both_clubs_is_read(self):
        """The seat set is `KONTAKT_ROLLEN` whole, so a seat added there is a seat whose holder is refused too."""

        names = beteiligte_namen(lage=lage())

        assert {SEATS[team][seat][0] for team in (TEAM1, TEAM2) for seat in KONTAKT_ROLLEN} <= names
