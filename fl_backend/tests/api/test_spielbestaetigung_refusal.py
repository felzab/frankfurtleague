from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from bson import ObjectId

from app.api.spielbestaetigungen.crud import ANSICHT_SPIEL_FIELDS, verein_fields
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
    ansicht_snapshot_of,
    beteiligte_namen,
    compose_ansetzung,
    find_name_in_begruendung_refusal,
    find_spent_link_refusal,
    find_unknown_link_refusal,
    find_vorschlag_vergangen_refusal,
    grund_to_close,
    proposal_payload,
    seat_adresse,
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
AFTER_THE_DAY = "2027-05-15"

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
            # What the close would shut the row for, ahead of the deadline, as the view ranks them.
            pytest.param({}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, "2027-05-08", ANSETZUNG_GEAENDERT, id="moved-ahead-of-late"),
            pytest.param({}, {"spiel_overrides": {"ergebnis": "2:1"}}, "2027-05-08", ANSETZUNG_ENTSCHIEDEN, id="decided-ahead-of-late"),
            # The close's own order: a decided fixture is owed no notice that it moved.
            pytest.param(
                {}, {"spiel_overrides": {"uhrzeit": "19:00:00", "ergebnis": "2:1"}}, TODAY, ANSETZUNG_ENTSCHIEDEN, id="decided-ahead-of-moved"
            ),
            # Its day gone by unplayed, the close's last reason, is a deadline gone by too and answers as one.
            pytest.param({}, {}, AFTER_THE_DAY, ANSETZUNG_FRIST_VORBEI, id="the-day-passed"),
            pytest.param({}, {"spiel_overrides": {"ergebnis": "2:1"}}, AFTER_THE_DAY, ANSETZUNG_ENTSCHIEDEN, id="decided-ahead-of-the-day"),
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
    """The view's states in their order: the ban first, then a moved stand, then the answer, then a lapse."""

    OTHER = FLSpielbestaetigungTermin(datum="2027-05-20", uhrzeit="18:00:00")

    @pytest.mark.parametrize(
        ("row", "situation", "today", "gesperrt", "vorschlag", "zustand"),
        [
            pytest.param({"antwort": ANSWERED}, {}, TODAY, True, None, "gesperrt", id="barred-ahead-of-answered"),
            # The move's notice called every link of the row void, the answering seat's sibling links included.
            pytest.param(
                {"antwort": ANSWERED}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, TODAY, False, None, "ungueltig", id="answered-then-moved"
            ),
            pytest.param(
                {"antwort": ANSWERED, "geschlossen": {"am": TODAY, "grund": "ansetzung_geaendert"}},
                {"spiel_overrides": {"uhrzeit": "19:00:00"}},
                TODAY,
                False,
                None,
                "ungueltig",
                id="answered-and-closed-for-the-move",
            ),
            pytest.param(
                {"antwort": ANSWERED}, {"spiel_overrides": {"ergebnis": "2:1"}}, TODAY, False, None, "zugesagt", id="answered-then-decided"
            ),
            pytest.param(
                {"antwort": ANSWERED, "geschlossen": {"am": AFTER_THE_DAY, "grund": "spiel_vergangen"}},
                {},
                AFTER_THE_DAY,
                False,
                None,
                "zugesagt",
                id="answered-and-closed-past-its-day",
            ),
            pytest.param({"antwort": {**ANSWERED, "art": "abgelehnt"}}, {}, TODAY, False, None, "abgelehnt", id="declined"),
            pytest.param({}, {"spiel_overrides": {"uhrzeit": "19:00:00"}}, "2027-05-08", False, None, "ungueltig", id="moved-ahead-of-late"),
            pytest.param(
                {}, {"spiel_overrides": {"uhrzeit": "19:00:00", "ergebnis": "2:1"}}, TODAY, False, None, "abgelaufen", id="decided-and-moved"
            ),
            pytest.param({}, {"austritt": DATUM}, TODAY, False, None, "abgelaufen", id="a-club-left-by-the-day"),
            pytest.param(
                {"geschlossen": {"am": TODAY, "grund": "schiedsrichter_gewechselt"}}, {}, TODAY, False, None, "ungueltig", id="referee-changed"
            ),
            pytest.param({"geschlossen": {"am": TODAY, "grund": "verworfen"}}, {}, TODAY, False, None, "abgelaufen", id="closed-otherwise"),
            pytest.param(
                {"geschlossen": {"am": AFTER_THE_DAY, "grund": "spiel_vergangen"}},
                {},
                AFTER_THE_DAY,
                False,
                None,
                "abgelaufen",
                id="day-passed",
            ),
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


class Recorded(Mapping[str, Any]):
    """A stored document noting every dotted path read off it, a key it lacks included."""

    def __init__(self, document: Mapping[str, Any], seen: set[str], prefix: str = "") -> None:
        self._document, self._seen, self._prefix = document, seen, prefix

    def __getitem__(self, key: str) -> Any:
        path = f"{self._prefix}.{key}" if self._prefix else key
        self._seen.add(path)
        value = self._document[key]
        return Recorded(value, self._seen, path) if isinstance(value, Mapping) else value

    def __iter__(self) -> Iterator[str]:
        return iter(self._document)

    def __len__(self) -> int:
        return len(self._document)


def loaded_by(projection: Mapping[str, Any], path: str) -> bool:
    """Whether a read through this projection holds the path, or the block a projected path sits under."""

    return any(path == key or path.startswith(f"{key}.") or key.startswith(f"{path}.") for key, kept in projection.items() if kept != 0)


class TestTheProjectionsHoldEverythingTheJudgesRead:
    """The other half of the db sheet's `TestWhatAnAnonymousReadLoads`: a path a judge reads that a projection drops reads as null.

    So a decided fixture would show `gueltig`, or a seat's address read as empty pass the ban, with nothing failing.
    """

    def test_the_view_reads_nothing_its_projections_leave_out(self):
        spiel_seen: set[str] = set()
        vereine_seen: set[str] = set()
        # Undecided, unmoved and open, so every judge reads to its end; the exit after the fixture's day, so its date is read.
        situation = AnsetzungLage(
            spiel=Recorded(spiel(), spiel_seen),
            vereine=[Recorded(verein(TEAM1, austritt="2027-06-01"), vereine_seen), Recorded(verein(TEAM2), vereine_seen)],
        )

        assert zustand_of(spielbestaetigung_raw=zeile(), lage=situation, today=TODAY, gesperrt=False, vorschlag_offen=None) == "gueltig"
        ansicht_ansetzung_of(spielbestaetigung_raw=zeile(), lage=situation)
        seat_adresse(lage=situation, spielbestaetigung_raw=zeile(), seat="trainer")

        # The premise: `entscheidung_of` read the fixture to its last test.
        assert {"ergebnis", "elfmeterschiessen", "sonderereignis", "team2.tore", "austritt.datum"} <= spiel_seen | vereine_seen
        assert [path for path in sorted(spiel_seen) if not loaded_by(ANSICHT_SPIEL_FIELDS, path)] == []
        projection = verein_fields(team_id=TEAM1, seat="trainer", namen=False)
        assert [path for path in sorted(vereine_seen) if not loaded_by(projection, path)] == []

    def test_the_answer_reads_nothing_of_the_clubs_its_projection_leaves_out(self):
        """The fixture it reads whole, a proposal being judged as the stored fixture on a new date."""

        vereine_seen: set[str] = set()
        situation = AnsetzungLage(
            spiel=spiel(), vereine=[Recorded(verein(TEAM1, austritt="2027-06-01"), vereine_seen), Recorded(verein(TEAM2), vereine_seen)]
        )

        assert find_spent_link_refusal(spielbestaetigung_raw=zeile(), lage=situation, today=TODAY) is None
        beteiligte_namen(lage=situation)
        seat_adresse(lage=situation, spielbestaetigung_raw=zeile(), seat="trainer")

        assert {"austritt.datum", "kontakte.stellvertretung.nachname", "kontakte.trainer.email"} <= vereine_seen
        projection = verein_fields(team_id=TEAM1, seat="trainer", namen=True)
        assert [path for path in sorted(vereine_seen) if not loaded_by(projection, path)] == []


# Open rows in every situation a link meets, each keyed by what the close would shut it for.
SITUATIONS = [
    pytest.param({}, TODAY, id="open"),
    pytest.param({}, "2027-05-08", id="late"),
    pytest.param({"spiel_overrides": {"uhrzeit": "19:00:00"}}, TODAY, id="moved"),
    pytest.param({"spiel_overrides": {"uhrzeit": "19:00:00"}}, "2027-05-08", id="moved-and-late"),
    pytest.param({"spiel_overrides": {"team2": None}}, TODAY, id="a-side-gone"),
    pytest.param({"spiel_overrides": {"ergebnis": "2:1"}}, TODAY, id="a-result"),
    pytest.param({"spiel_overrides": {"elfmeterschiessen": {"team1": 4, "team2": 3}}}, TODAY, id="a-lone-shoot-out"),
    pytest.param({"spiel_overrides": {"sonderereignis": "ausgefallen"}}, TODAY, id="called-off"),
    pytest.param({"austritt": DATUM}, TODAY, id="a-club-left-by-the-day"),
    pytest.param({"spiel_overrides": {"uhrzeit": "19:00:00", "ergebnis": "2:1"}}, "2027-05-08", id="moved-decided-and-late"),
    pytest.param({}, DATUM, id="on-the-day"),
    pytest.param({}, AFTER_THE_DAY, id="the-day-passed"),
]

# The page a refused answer's code sends the reader to (`fl_frontend/src/features/spielbestaetigungen/utils.ts`).
STATE_OF_CODE = {None: "gueltig", ANSETZUNG_GEAENDERT: "ungueltig", ANSETZUNG_ENTSCHIEDEN: "abgelaufen", ANSETZUNG_FRIST_VORBEI: "abgelaufen"}


class TestTheLinkAndTheCloseReadOneVerdict:
    """The view, the answer and the pass's close judge an open row alike: a link shows and refuses only what the close would record."""

    @pytest.mark.parametrize(("situation", "today"), SITUATIONS)
    def test_the_view_shows_the_state_the_answer_refuses_with(self, situation: dict[str, Any], today: str):
        refusal = find_spent_link_refusal(spielbestaetigung_raw=zeile(), lage=lage(**situation), today=today)
        shown = zustand_of(spielbestaetigung_raw=zeile(), lage=lage(**situation), today=today, gesperrt=False, vorschlag_offen=None)

        assert shown == STATE_OF_CODE[None if refusal is None else refusal.error_code]

    @pytest.mark.parametrize("antwort", [None, ANSWERED], ids=["unanswered", "answered"])
    @pytest.mark.parametrize(("situation", "today"), SITUATIONS)
    def test_a_row_shows_the_same_state_before_the_close_and_after_it(
        self, situation: dict[str, Any], today: str, antwort: dict[str, Any] | None
    ):
        """Closed for the reason `grund_to_close` gives, the row reads as it did open: the next pass changes no page under its reader.

        The close reaches an answered row too, so a move outranks its answer before the close as after it.
        """

        situated = lage(**situation)
        austritte = {} if "austritt" not in situation else {TEAM1: situation["austritt"]}
        grund = grund_to_close(row=zeile(antwort=antwort), spiel=situated.spiel, austritte=austritte, today=today)
        closed = zeile(antwort=antwort, geschlossen=None if grund is None else {"am": today, "grund": grund})

        before = zustand_of(spielbestaetigung_raw=zeile(antwort=antwort), lage=situated, today=today, gesperrt=False, vorschlag_offen=None)
        after = zustand_of(spielbestaetigung_raw=closed, lage=situated, today=today, gesperrt=False, vorschlag_offen=None)

        assert before == after


class TestWhatTheViewStatesOfTheFixture:
    def test_a_fixture_that_lost_its_day_is_stated_as_the_row_asked_about_it_and_never_half_of_each(self):
        """The new hour beside the old day would describe an Ansetzung that never stood; the side gone is named off its season row."""

        moved = lage(spiel_overrides={"datum": None, "uhrzeit": "20:00:00", "team2": None})
        ansetzung = ansicht_snapshot_of(spielbestaetigung_raw=zeile(), lage=moved, spielort=None)

        assert (ansetzung.team1_name, ansetzung.team2_name, ansetzung.datum, ansetzung.uhrzeit) == ("Adler", "Biber", DATUM, "18:30:00")

    def test_a_club_replaced_since_is_stated_nameless_rather_than_answering_500(self):
        """Its season row went to the incoming club, which a replacement also seats in the fixture: no read names the club that left."""

        replaced = AnsetzungLage(
            spiel=spiel(team2={"team_id": ObjectId(), "name": "Dachs", "shorthand": "DA", "tore": None}), vereine=[verein(TEAM1)]
        )
        ansetzung = ansicht_snapshot_of(spielbestaetigung_raw=zeile(), lage=replaced, spielort=None)

        assert (ansetzung.team1_name, ansetzung.team2_name) == ("Adler", "")


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
        # Against the stored sides, spelled out: the exit judge weighs exactly the clubs the fixture already fields.
        sides = [None if side is None else (side.team_id, side.tore) for side in (proposed.team1, proposed.team2)]
        assert (sides, proposed.sonderereignis) == ([(TEAM1, None), (TEAM2, None)], None)


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
