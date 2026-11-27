"""
TESTS · the made-up league: a league nobody plays in, for daily work and the end-to-end journeys

Three seasons, ten clubs, five venues, the referees the fixtures book and the journeys' own people, an owner and the
administrators, every one of them invented, so no machine needs production's personal data to show a page in each of its
states. The states are the ones the Spielplan, the sign-in, the match editor, the Spielorte table, the applications, teams
and players pages and the access pages draw:

- a finished season: every fixture played, the match for third place among them, the final decided on penalties;
- the running season: a played matchday holding a forfeit, today's matchday holding a played, an open and a cancelled
  fixture and one tomorrow, next week's matchday holding a stored line-up and owed ones, and a knockout round drawn, its
  fixtures undated and not yet decided; its registration links open past the window's end, two squads at their cap, one
  beside a nominee and a retired nominee, and a departed club with an open fixture and a live link;
- a planned season: its application window open today, one group full and the others with room, and applications whose
  seats stand in every state;
- venues with and without rent, one retired and one with a name long enough to test a row's width; referees, every one
  with the address both referee payloads require, one retired and one unanswered;
- one club's confirmed Trainer, whose decline proposes another day for next week's fixture, standing on the Übersicht for
  „Übernehmen“ and „Verwerfen“;
- the signed-in areas: a seat whose club holds a stored line-up, a locked one, an agreed date and several registrations,
  and Birke's Trainer holding a declined date and, until tomorrow's match 7 kicks off, an expired one beside a club with no
  registration; referees with a booking to answer, one agreed until its kick-off today, a report owed and one adopted; a
  captain and a Co-Kapitän; a pupil with a finished season beside the running one; and a person granted no page, one
  unconfirmed and one waiting on the club;
- an owner and administrators in effect, an addition and a handover waiting, since a wait cannot be slept through;
- a ban, a running change of a person's address and of a holder's, and a log row of each who;
- a retired club, and clubs still in the league the planned season has not entered.

Every journey that writes signs in as a person no other journey signs in as, since one journey's writes would change what
another reads (https://playwright.dev/docs/auth). Every season, person, club, fixture and link a journey types stands in
`made_up_people.json` beside this file: the seed writes each person from it, and writes nothing where a fixture, a club
or a link it names is not the one the scenario sets up for that journey.

`SEED_LANDING` in the environment sets the landing's state, the seed as written by default (`LANDING_STATES`); any other
name is refused, exit 2, before the database is reached.

It exits 0 when the league is written, 1 when an insert is refused, 2 when it refuses to run, its settings could not be
loaded or it could not write the database, and 3 when the seed itself failed.

Run by `./scripts/ops/local.sh --e2e`, `--e2e --landing=<state>` and `--seed-made-up`, and by the journeys' CI job, as
`python -m tests.made_up_seed` inside the stack's backend container, copied there beside the tests' builders: it reads the
settings the backend reads, and refuses, exit 2, before any client exists unless they name the local stack's own server
(`LOCAL_SERVER`), which the end-to-end stack starts as well and production lacks. No image holds it, the tests being kept out of
every build. The backend has booted first, so every index is in place; the frontend starts, or with `--landing` restarts,
only once the seed has passed.

Invariants:
- Every date is relative to today in Germany, so "today's matchday" is today whenever it runs.
- Every document is composed by the backend's own composers and the tests' builders, and read through its record model
  before anything is written.
- It empties every collection of the application database first and never touches `auth`, the sign-in store the frontend
  keeps beside it.
- Every link a seat, a registration or an invitation holds opens at `?token=made-up-<label>`, `link_hash`'s label, so a
  drive reads each state of a link page. The token is no secret: its hash stands in this made-up stack alone.
"""

import asyncio
import copy
import json
import os
import sys
import traceback
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Final, NoReturn

from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.errors import BulkWriteError, PyMongoError
from pymongo.uri_parser import parse_uri

from app.api.address_change.services import compose_record
from app.api.bewerbungen.services import compose_confirmation as compose_bewerbung_confirmation
from app.api.bewerbungen.services import compose_confirmation_update as compose_seat_confirmation_update
from app.api.bewerbungen.services import compose_einwilligung as compose_seat_einwilligung
from app.api.outbox.schemas import FLBewerbungReceivedData, FLOutboxReference
from app.api.outbox.services import final_update
from app.api.saisons.schemas import FLSaisonRules
from app.api.saisons.spielplan import EnteredTeam, draw_spielplan
from app.api.schiedsrichter.services import compose_confirmation as compose_schiedsrichter_confirmation
from app.api.schiedsrichter.services import compose_confirmation_update as compose_schiedsrichter_confirmation_update
from app.api.schiedsrichter.services import compose_mint_update
from app.api.spielbestaetigungen.schemas import FLSpielbestaetigungAppointment
from app.api.spielbestaetigungen.services import compose_answer_update, compose_schiedsrichter_answer_update, compose_spielbestaetigung
from app.api.spielorte.services import compose_maps_query
from app.api.teams.services import compose_kontakt_confirmation
from app.core import clock
from app.core.collections import Collection
from app.core.config import EnvironmentValidationError, get_config
from app.core.crud import ANCHOR_FIELD, Anchored
from app.core.db import new_client
from app.readback import CRASHED, RECORD_MODELS, REFUSED, UNJUDGED
from app.shared.einwilligung_evidence import compose_initial
from app.shared.schemas.addresses import FLAddress
from app.shared.schemas.bounds import CONFIRMATION_DEADLINE_DAYS
from app.shared.schemas.literals import FLAddressChangeWay
from app.shared.tokens import hash_token
from tests.documents import (
    SCHIEDSRICHTER_TEXT_VERSIONS,
    SEAT_TEXT_VERSIONS,
    SPIELER_TEXT_VERSIONS,
    action_log_document,
    aufstellung_document,
    ban_document,
    bericht_document,
    bewerbung_document,
    grant_document,
    invitation_document,
    mailbox_anchor_document,
    outbox_document,
    read_back_document,
    registrierung_confirmed,
    registrierung_document,
    rules_document,
    saison_document,
    saison_spieler_document,
    saison_team_document,
    schiedsrichter_document,
    spiel_document,
    spielbericht_document,
    spielbericht_sides,
    spieler_document,
    spielort_document,
    spieltag_document,
    team_document,
)

# The seasons, people, clubs, fixtures and links the journeys type, read by them too.
# Its `team` and `kaderPupil` keys are the journeys' option names, so they follow the frontend's names.
PEOPLE: Final[Mapping[str, Any]] = json.loads(Path(__file__).with_name("made_up_people.json").read_text(encoding="utf-8"))
PROJECTS: Final[Sequence[Mapping[str, Any]]] = (PEOPLE["projects"]["desktop"], PEOPLE["projects"]["phone"])
FINISHED: Final[str] = PEOPLE["seasons"]["finished"]
RUNNING: Final[str] = PEOPLE["seasons"]["running"]
PLANNED: Final[str] = PEOPLE["seasons"]["planned"]

# The collections whose record model declares the count an anchor advances, each first document carrying it, as a
# document of the league's soon does.
ANCHORED: Final[frozenset[Collection]] = frozenset(collection for collection, model in RECORD_MODELS.items() if issubclass(model, Anchored))


def _crashed(error: BaseException) -> NoReturn:
    """The crash by its type and where it was raised: a message, or a traceback's locals, can carry a secret's value."""

    frames = traceback.extract_tb(error.__traceback__)
    where = f" at {frames[-1].filename}:{frames[-1].lineno}" if frames else ""
    print(f"The made-up seed crashed ({type(error).__name__}{where}).", file=sys.stderr)
    raise SystemExit(CRASHED) from None


# The landing's state the seed as written stands in.
AS_WRITTEN: Final = "running"


def link_hash(label: str) -> str:
    """The hash of the link `?token=made-up-<label>` opens."""

    return hash_token(f"made-up-{label}")


def full_name(person: Mapping[str, str]) -> str:
    return f"{person['first_name']} {person['last_name']}"


def address(street: str, house_number: str, postcode: str, district: str) -> dict[str, str]:
    return {"street": street, "house_number": house_number, "postcode": postcode, "district": district, "city": "Frankfurt am Main"}


def school(name: str, index: int) -> dict[str, Any]:
    """A school's own fields, a club's or one an application names, by its place in the scenario."""

    return {
        "full_name": f"{name}-Gymnasium",
        "website_url": None,
        "address": address("Schulweg", str(index + 1), f"6031{index}", "Nordend"),
        "schulform": "gymnasium_g9" if index % 2 == 0 else "gesamtschule",
    }


def applied(document: Mapping[str, Any], update: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """`document` once the composed `update` has run on it, along dotted paths as the server applies them.

    In memory rather than on the server, so a document is read through its model before it is written; only the
    operators the composers replayed here emit.
    """

    result = copy.deepcopy(dict(document))
    for operator, fields in update.items():
        for path, value in fields.items():
            *parents, key = path.split(".")
            node = result
            for parent in parents:
                node = node.setdefault(parent, {})
            if operator == "$set":
                node[key] = value
            elif operator == "$unset":
                node.pop(key, None)
            elif operator == "$min":
                node[key] = value if key not in node else min(node[key], value)
            else:
                raise ValueError(f"{operator} is no operator this seed applies")

    return result


# One per row of a season, a colour being one team's.
SEASON_COLOURS: Final = ("blau", "gruen", "rot", "gelb", "orange", "weiss", "schwarz", "grau")

# Pappel joined through its application for the planned season. Buche left the league and stands in no season, the
# retired filter being the one way back to it.
TEAM_NAMES: Final = ("Ahorn", "Birke", "Eiche", "Linde", "Ulme", "Esche", "Kastanie", "Weide", "Pappel", "Buche")

# The finished season. Both groups play one pattern of scores, each fixture's taken by its place in its group's round:
# group A ends Ahorn 7, Birke 6, Eiche 4, Linde 0 points and group B Ulme, Esche, Kastanie, Weide alike, which is who the
# knockout holds. The match for third place was won outright and the final went to penalties.
FINISHED_MATCHDAYS: Final = (-280, -266, -252, -210, -196)
GROUP_SCORES: Final = ((3, 0), (2, 1), (1, 1), (0, 2), (2, 1), (1, 0))
KNOCKOUT_SCORES: Final[Mapping[int, Mapping[str, Any]]] = {
    13: {"tore": (2, 0)},
    14: {"tore": (1, 2)},
    15: {"tore": (3, 1)},
    16: {"tore": (1, 1), "elfmeterschiessen": {"team1": 4, "team2": 3}},
}

POSITIONS: Final = ("Tor", "Abwehr", "Mittelfeld", "Angriff")

# With Mia and Jonas, Ahorn's squad fills the rules' `max_kader_size`, so a full squad and a nominee outside its count
# stand together (`CAPPED_KADER_ROW`), and the retired nominee's reactivation passes the cap.
AHORN_KADER: Final = (
    ("Noah", "Adler"),
    ("Lea", "Bauer"),
    ("Finn", "Claus"),
    ("Emma", "Dietz"),
    ("Paul", "Ebert"),
    ("Lina", "Fuchs"),
    ("Luca", "Graf"),
    ("Nora", "Hein"),
    ("Tom", "Igel"),
    ("Ida", "Jung"),
    ("Max", "Kern"),
    ("Ella", "Lang"),
    ("Leo", "Merz"),
    ("Zoe", "Nagel"),
    ("Jan", "Ott"),
    ("Amy", "Peters"),
)

# Ulme's squad, the phone's contact seat's line-up to enter, at the cap as Ahorn's is; and Kastanie's beside Lena, the
# club's line-up for match 10. No name holds either `kaderPupil` pupil's, whom the administration's journey opens by a link
# whose name holds theirs.
ULME_KADER: Final = (
    ("Anton", "Umbach"),
    ("Clara", "Unger"),
    ("David", "Uhl"),
    ("Emilia", "Urban"),
    ("Fabian", "Ufer"),
    ("Greta", "Ulmer"),
    ("Henri", "Utz"),
    ("Ines", "Unruh"),
    ("Jakob", "Ullmann"),
    ("Klara", "Uhland"),
    ("Lukas", "Urbach"),
    ("Marie", "Usler"),
    ("Niklas", "Uhde"),
    ("Olivia", "Ursin"),
    ("Romy", "Uebel"),
    ("Simon", "Utzmann"),
    ("Tilda", "Umlauf"),
    ("Vincent", "Unland"),
)
KASTANIE_KADER: Final = (
    ("Mila", "Kolbe"),
    ("Jonte", "Kramer"),
    ("Smilla", "Kurz"),
    ("Theo", "Kessel"),
    ("Frida", "Kiefer"),
    ("Mats", "Kordes"),
)


@dataclass
class Season:
    """One season's documents, numbered as the draw numbers them."""

    saison: dict[str, Any]
    rows: list[dict[str, Any]]
    spieltage: list[dict[str, Any]]
    spiele: list[dict[str, Any]]

    def spiel(self, nr: int) -> dict[str, Any]:
        return next(row for row in self.spiele if row["spiel_nr"] == nr)

    def row(self, name: str) -> dict[str, Any]:
        return next(row for row in self.rows if row["name"] == name)

    def number_of(self, fixture: str) -> int | None:
        """The number of the fixture a journey names as „<team1> vs. <team2>“, `None` where the season draws none."""

        team1, _, team2 = fixture.partition(" vs. ")
        ids = {row["name"]: row["team_id"] for row in self.rows}
        found = [
            row["spiel_nr"]
            for row in self.spiele
            if row["team1"] is not None
            and row["team2"] is not None
            and (row["team1"]["team_id"], row["team2"]["team_id"]) == (ids.get(team1), ids.get(team2))
        ]
        return found[0] if len(found) == 1 else None


@dataclass
class Mail:
    """The links one record's seats were mailed: their labels' head, the day, and whether a reminder may follow."""

    owner: str
    sent_on: int
    reminded: bool
    label: str = ""


# A seat's state: the pair of its person and its entry, built from the mail the seat was sent.
type SeatState = Callable[[Mail], tuple[dict[str, Any] | None, dict[str, Any] | None]]


@dataclass
class MadeUpLeague:
    """Every document of the league, built in the scenario's order from the German day `now` falls on.

    `first_year` builds the league before its first season: the clubs, venues, referees, grants and the planned season,
    and nothing a season played would have left. It is the one league with no season running, since the rollover, the one
    write of a status, activates a season as it retires another.
    """

    now: datetime
    first_year: bool = False
    today: str = field(init=False)
    seated_people: int = field(default=0, init=False)

    def __post_init__(self) -> None:
        self.today = clock.german_day(self.now)
        self._teams()
        self._venues_and_referees()
        self._grants()
        self.played: list[Season] = []
        self.spielbestaetigungen: list[dict[str, Any]] = []
        self.spieler: list[dict[str, Any]] = []
        self.kader_rows: list[dict[str, Any]] = []
        self.invitations: dict[str, dict[str, Any]] = {}
        self.registrierungen: list[dict[str, Any]] = []
        self.spielberichte: list[dict[str, Any]] = []
        self.aufstellungen: list[dict[str, Any]] = []
        if not self.first_year:
            self._seasons()
            self.played = [self.finished, self.running]
            self._seats()
            self._requests()
            self._kader_rows()
            self._registrations()
        self._planned_season()
        self._access()

    def day(self, offset: int) -> str:
        """The German calendar day `offset` days from today, as every stored date spells one."""

        return (date.fromisoformat(self.today) + timedelta(days=offset)).isoformat()

    def stamp(self, offset: int) -> str:
        """The instant a person's evidence is stamped with, on the day `offset` days from today."""

        return clock.utc_stamp(datetime.fromisoformat(f"{self.day(offset)}T10:00:00").replace(tzinfo=UTC))

    # --- The clubs ------------------------------------------------------------------------------------------------

    def _teams(self) -> None:
        self.teams = [
            team_document(ObjectId(), name, name[:3].upper(), description="", **school(name, index)) for index, name in enumerate(TEAM_NAMES)
        ]
        self.team_by_name = {row["name"]: row for row in self.teams}
        self.team_by_name["Buche"]["inactive_since"] = self.day(-400)

    # --- Venues and referees --------------------------------------------------------------------------------------

    def _venues_and_referees(self) -> None:
        def venue(name: str, rent: int, at: dict[str, str], inactive_since: str | None) -> dict[str, Any]:
            return spielort_document(
                ObjectId(),
                name,
                default_mietpreis=rent,
                address=at,
                maps_query=compose_maps_query(name, FLAddress(**at)),
                inactive_since=inactive_since,
            )

        self.venues = [
            venue("Sportplatz Ahornweg", 0, address("Ahornweg", "2", "60316", "Nordend"), None),
            venue(PEOPLE["venues"]["edited"], 40, address("Birkenallee", "14a", "60489", "Rödelheim"), None),
            venue("Kunstrasen Eichenhain", 25, address("Eichenhain", "7", "60599", "Sachsenhausen"), None),
            venue("Bolzplatz Lindenstraße", 0, address("Lindenstraße", "30", "60325", "Westend"), self.day(-120)),
            # Last, so no fixture's booking (`booked`, by index) changes: a name as long as a real ground's can be.
            venue(
                PEOPLE["venues"]["longest"],
                30,
                address("Deuil-la-Barre-Straße", "100", "60437", "Nieder-Eschbach"),
                None,
            ),
        ]

        # Every person's consent as their own confirmation wrote it, on one day, each choice evidenced under its kind's
        # wording.
        self.consented = -60

        def confirmed(name: str, schule: str | None, payment: int, email: str, inactive_since: str | None = None) -> dict[str, Any]:
            """A referee as their own confirmation leaves the row, in its one write: the birthdate and the consent.

            The name kept off the public pages and no media, and no deletion date. Every referee a fixture books is one, as
            the booking refuses any other (`booking_unconfirmed_schiedsrichter`).
            """

            answer = compose_schiedsrichter_confirmation_update(
                birth_date=self.day(-20 * 365),
                scope="internal",
                media=False,
                text_versions=SCHIEDSRICHTER_TEXT_VERSIONS,
                today=self.day(self.consented),
                at=self.stamp(self.consented),
            )
            return schiedsrichter_document(
                ObjectId(),
                email=email,
                name=name,
                default_payment=payment,
                schule=schule,
                kontakt={"phone": None, "email": email},
                inactive_since=inactive_since,
                confirmation=compose_schiedsrichter_confirmation(today=self.day(-62)),
                **answer["$set"],
            )

        def unanswered(name: str, schule: str, payment: int, email: str) -> dict[str, Any]:
            """A referee entered three days ago who has not answered: the create's link and the deletion date it sets."""

            return schiedsrichter_document(
                ObjectId(),
                email=email,
                name=name,
                default_payment=payment,
                schule=schule,
                kontakt={"phone": None, "email": email},
                einwilligung=None,
                **compose_mint_update(today=self.day(-3)),
            )

        def person(entry: Mapping[str, str], payment: int = 20) -> dict[str, Any]:
            """A journey's person: a confirmed referee no fixture books.

            A referee row is its person's own only once confirmed (`is_own_schiedsrichter`), so an address change or an
            erasure moves nothing of a row without one.
            """

            return confirmed(full_name(entry), None, payment, entry["address"])

        others, first_pass = PEOPLE["others"], PEOPLE["firstPass"]
        # The booked referees' journey (each project's `booked`): a confirmed referee whose played fixture owes its report
        # and whose coming one asks an answer.
        self.booked_referees = [person(project["booked"]["referee"]) for project in PROJECTS]
        self.referees = [
            confirmed(full_name(others["referee"]), "Ahorn-Gymnasium", 20, others["referee"]["address"]),
            confirmed(full_name(first_pass["referee"]), None, 25, first_pass["referee"]["address"]),
            confirmed(full_name(others["newcomer"]), "Ulme-Gymnasium", 20, others["newcomer"]["address"]),
            confirmed("Dieter Dorn", None, 15, "dieter.dorn@example.com", self.day(-90)),
            # After the four the seasons book by a fixture's number (`booked`), so none of those bookings changes.
            unanswered("Elif Engin", "Weide-Gymnasium", 20, "elif.engin@example.com"),
            *self.booked_referees,
            # The journeys' own: each project's account acts, in their order (the person signed in on a second device, the
            # one whose address changes, the one who deletes the account), then the access journeys' (the person banned, the
            # one whose address the administrator's change starts on, the one erased, and the one whose change stands on the
            # list).
            *(person(project[role]) for project in PROJECTS for role in ("twoDevices", "mover", "leaver")),
            *(person(PEOPLE["access"][role]) for role in ("banned", "mover", "erased", "changing")),
        ]

    # --- Grants ---------------------------------------------------------------------------------------------------

    def _grants(self) -> None:
        # Each row as `grant_in_session` leaves it, the one owner and the administrators in effect a day ago, so every
        # session signed in since holds its grant, and one addition still waiting. The handover's wait outlasts any run, or
        # the scheduler's first pass would take the owner's role from under the owner's journey.
        self.in_effect = self.now - timedelta(hours=24)
        self.waiting = self.now + timedelta(hours=12)
        handover_waiting = self.now + timedelta(days=6)
        administrators = PEOPLE["administrators"]
        self.grants = [
            grant_document(PEOPLE["owner"], "owner", effective_from=self.in_effect),
            *(grant_document(project["administrator"], "administration", effective_from=self.in_effect) for project in PROJECTS),
            grant_document(administrators["editor"], "administration", effective_from=self.in_effect),
            grant_document(administrators["setup"], "administration", effective_from=self.in_effect),
            grant_document(administrators["waiting"], "administration", effective_from=self.waiting),
            grant_document(administrators["successor"], "administration", effective_from=self.in_effect, owner_from=handover_waiting),
            # The holder whose own address change waits (`holder_change`).
            grant_document(administrators["moving"], "administration", effective_from=self.in_effect),
            grant_document(administrators["banning"], "administration", effective_from=self.in_effect),
            grant_document(administrators["seat"], "administration", effective_from=self.in_effect),
            grant_document(administrators["access"], "administration", effective_from=self.in_effect),
        ]

    # --- Seasons --------------------------------------------------------------------------------------------------

    def booked(self, venue_index: int, schiedsrichter: Mapping[str, Any]) -> dict[str, Any]:
        spielort = self.venues[venue_index]
        return {
            "spielort": {"spielort_id": spielort["_id"], "mietpreis": spielort["default_mietpreis"]},
            "schiedsrichter": {"schiedsrichter_id": schiedsrichter["_id"], "payment": schiedsrichter["default_payment"]},
        }

    def season(
        self,
        *,
        saison_id: str,
        status: str,
        start: str,
        end: str,
        drawn: str,
        groups: Mapping[str, Sequence[str]],
        dates: Sequence[tuple[str | None, str | None]],
        play: Callable[[int], Mapping[str, Any]],
        knockout: Mapping[int, tuple[str, str]] | None = None,
    ) -> Season:
        """One season drawn by the backend's draw over `groups`, each club in draw order.

        `dates` names each matchday's span, `play` what happened in the fixture of a number, and `knockout` who stands in
        each knockout fixture, where anybody does yet.
        """

        rules = rules_document(number_of_gruppen=len(groups))
        entries = [(gruppe, name) for gruppe, names in groups.items() for name in names]
        rows = [
            saison_team_document(
                saison_id,
                self.team_by_name[name]["_id"],
                name,
                self.team_by_name[name]["shorthand"],
                _id=ObjectId(),
                gruppe=gruppe,
                trikot_farbe=SEASON_COLOURS[index],
            )
            for index, (gruppe, name) in enumerate(entries)
        ]
        spielplan = draw_spielplan(
            saison_id=saison_id,
            rules=FLSaisonRules.model_validate(rules),
            entered=[
                EnteredTeam(row_id=row["_id"], team_id=row["team_id"], gruppe=row["gruppe"], name=row["name"], shorthand=row["shorthand"])
                for row in rows
            ],
        )
        spieltage = [
            spieltag_document(
                drawn_day["_id"], saison_id, drawn_day["position"], saison_phase=drawn_day["saison_phase"], start=span[0], end=span[1]
            )
            for drawn_day, span in zip(spielplan.spieltage, dates, strict=True)
        ]

        def side(name: str, tore: int | None) -> dict[str, Any]:
            return {"team_id": self.team_by_name[name]["_id"], "tore": tore}

        spiele = []
        for drawn_spiel in spielplan.spiele:
            nr = drawn_spiel["spiel_nr"]
            happened = play(nr)
            tore1, tore2 = happened.get("tore") or (None, None)
            sides = {"team1": drawn_spiel["team1"], "team2": drawn_spiel["team2"]}
            if knockout is not None and nr in knockout:
                sides = {"team1": side(knockout[nr][0], None), "team2": side(knockout[nr][1], None)}
            for key, tore in (("team1", tore1), ("team2", tore2)):
                if sides[key] is not None:
                    sides[key] = {**sides[key], "tore": tore}
            spiele.append(
                spiel_document(
                    spiel_id=drawn_spiel["_id"],
                    saison_id=saison_id,
                    spiel_nr=nr,
                    spieltag_id=drawn_spiel["spieltag_id"],
                    saison_phase=drawn_spiel["saison_phase"],
                    team1_quelle=drawn_spiel["team1_quelle"],
                    team2_quelle=drawn_spiel["team2_quelle"],
                    **sides,
                    date=happened.get("date"),
                    time=happened.get("time"),
                    **happened.get("booking", {"spielort": None, "schiedsrichter": None}),
                    ergebnis=None if tore1 is None else f"{tore1}:{tore2}",
                    elfmeterschiessen=happened.get("elfmeterschiessen"),
                    sonderereignis=happened.get("sonderereignis"),
                )
            )

        saison = saison_document(saison_id, status, start_date=start, end_date=end, rules=rules, spielplan={"generated_at": drawn})
        return Season(saison=saison, rows=rows, spieltage=spieltage, spiele=spiele)

    def _seasons(self) -> None:
        def finished_play(nr: int) -> Mapping[str, Any]:
            # Four fixtures a group matchday, two a semi-final day, two the Finale's.
            matchday = (nr + 3) // 4 if nr <= 12 else 4 if nr <= 14 else 5
            # Every venue and referee, the two retired since among them: a retired row still stands on the fixtures it
            # served. The match for third place, 15, kicks off ahead of the final.
            played = {
                "date": self.day(FINISHED_MATCHDAYS[matchday - 1]),
                "time": "13:00:00" if nr == 15 else "15:00:00",
                "booking": self.booked(nr % 4, self.referees[nr % 4]),
            }
            # Within a group matchday group A's two pairs come first, then group B's in the same order.
            if nr <= 12:
                return {**played, "tore": GROUP_SCORES[(matchday - 1) * 2 + (nr - 1) % 2]}
            return {**played, **KNOCKOUT_SCORES[nr]}

        self.finished = self.season(
            saison_id=FINISHED,
            status="past",
            start=self.day(-300),
            end=self.day(-150),
            drawn=self.day(-310),
            groups={"A": ("Ahorn", "Birke", "Eiche", "Linde"), "B": ("Ulme", "Esche", "Kastanie", "Weide")},
            dates=[(self.day(offset), self.day(offset + 4 if index < 3 else offset)) for index, offset in enumerate(FINISHED_MATCHDAYS)],
            play=finished_play,
            knockout={13: ("Ahorn", "Esche"), 14: ("Ulme", "Birke"), 15: ("Esche", "Ulme"), 16: ("Ahorn", "Birke")},
        )

        desktop, phone = self.booked_referees

        def running_play(nr: int) -> Mapping[str, Any]:
            booking = self.booked(nr % 3, self.referees[nr % 3])
            match nr:
                # Matchday 1, two weeks ago.
                case 1:
                    return {"date": self.day(-14), "time": "15:00:00", "booking": booking, "tore": (2, 1)}
                case 2:
                    # The desktop's booked referee's report to write, as match 5 is the phone's.
                    return {"date": self.day(-14), "time": "15:00:00", "booking": self.booked(2, desktop), "tore": (0, 0)}
                case 3:
                    # The away side never turned up: the season's award, as the editor composes it.
                    return {
                        "date": self.day(-13),
                        "time": "16:30:00",
                        "booking": booking,
                        "tore": (3, 0),
                        "sonderereignis": "nichtantreten_team2",
                    }
                case 4:
                    return {"date": self.day(-13), "time": "16:30:00", "booking": booking, "tore": (1, 3)}
                # Matchday 2, running across today: played yesterday, still to come today, called off, and still to come
                # tomorrow. A match takes its report from its kick-off (`is_played`), so the played one kicks off on a day
                # already gone, and the phone's booked referee owes its report whatever hour the seed is loaded at.
                case 5:
                    return {"date": self.day(-1), "time": "09:30:00", "booking": self.booked(2, phone), "tore": (1, 2)}
                case 6:
                    return {"date": self.day(0), "time": "16:00:00", "booking": booking}
                # The phone's departing fixture, on a day still to come, so the exit tells Birke of it whatever hour the
                # seed is loaded at: a notice lists only a fixture before its kick-off (`austritt_notices_of`).
                case 7:
                    return {"date": self.day(1), "time": "17:30:00", "booking": booking}
                case 8:
                    return {"date": self.day(0), "time": "11:00:00", "booking": booking, "sonderereignis": "ausgefallen"}
                # Matchday 3, next week. Group A's two are the coming fixtures the journeys' contact seats and booked
                # referees answer, the desktop's and the phone's, the latest days of the matchday, so each one's request is
                # still open tomorrow.
                case 9:
                    return {"date": self.day(8), "time": "17:00:00", "booking": self.booked(0, desktop)}
                case 10:
                    return {"date": self.day(9), "time": "17:00:00", "booking": self.booked(1, phone)}
                case 11:
                    return {"date": self.day(7), "time": "17:00:00", "booking": booking}
                case 12:
                    # Ben Brandt's, whom the first pass tells of the booking's lifting (`asked_referee`), on a ground no other
                    # fixture that day holds.
                    return {"date": self.day(7), "time": "18:30:00", "booking": self.booked(1, self.referees[1])}
                # The knockout: drawn, its fixtures undated, nobody in them.
                case _:
                    return {}

        # The running season, new groups. Matchday 1 is played and holds a forfeit, matchday 2 is today, matchday 3 is next
        # week, and the knockout is drawn with nobody in it yet. Its two days are set, as the activation refuses a season
        # holding an undated matchday (`activate_spieltage_undated`), and a dated one is never undated again.
        self.running = self.season(
            saison_id=RUNNING,
            status="active",
            start=self.day(-35),
            end=self.day(120),
            drawn=self.day(-40),
            groups={"A": ("Ahorn", "Eiche", "Ulme", "Kastanie"), "B": ("Birke", "Linde", "Esche", "Weide")},
            dates=[
                (self.day(-14), self.day(-10)),
                (self.day(-2), self.day(2)),
                (self.day(5), self.day(9)),
                (self.day(28), self.day(28)),
                (self.day(35), self.day(35)),
            ],
            play=running_play,
        )
        # The registration window ended the day before the season began, and its link stays open: an entry now is a
        # nominee (`entry_is_a_nominee`).
        self.running.saison["registrierung"] = {"open": True, "end": self.day(-36)}

        # Each journey's fixtures are the ones set up for it above, its contact's and its booked referee's coming one the
        # same, its departing club's fixture still to play on a later day: a notice lists only a fixture before its
        # kick-off, so one dated today would drop off it once the seed is loaded past that hour.
        for project, played, coming in zip(PROJECTS, (2, 5), (9, 10), strict=True):
            self.expect_fixture(project["booked"]["played"], played)
            self.expect_fixture(project["booked"]["coming"], coming)
            self.expect_fixture(project["contact"]["fixture"], coming)
            departing = self.running.number_of(project["departing"]["fixture"])
            spiel = None if departing is None else self.running.spiel(departing)
            if spiel is None or spiel["ergebnis"] is not None or (spiel["date"] is not None and spiel["date"] <= self.today):
                raise ValueError(
                    f"the journeys' departing fixture {project['departing']['fixture']} is no fixture of the running season, is played,"
                    " or is dated today or earlier"
                )
        # The Spielplan's journey opens the first matchday's first match and reads its result, the match editor moves the
        # kick-off of today's match alone at its venue and with its referee, and the first pass lifts the booking of the
        # disqualified club's fixture still to play.
        self.expect_fixture(PEOPLE["spielplan"]["opened"], 1)
        if self.running.spiel(1)["ergebnis"] != PEOPLE["spielplan"]["ergebnis"]:
            raise ValueError(f"the Spielplan's journey reads {PEOPLE['spielplan']['ergebnis']}, where the seed's match 1 ends otherwise")
        self.expect_fixture(PEOPLE["matchEditor"]["rescheduled"], 6)
        self.expect_fixture(PEOPLE["firstPass"]["lifted"], 12)

    def expect_fixture(self, fixture: str, nr: int) -> None:
        found = self.running.number_of(fixture)
        if found != nr:
            raise ValueError(f"the journeys name {fixture}, which is match {found} of the running season, where the seed sets up match {nr}")

    # --- A seat's person and link ---------------------------------------------------------------------------------

    def seated(self, first_name: str, last_name: str, entered_on: int, email: str | None = None) -> dict[str, Any]:
        """A person as the form or the league seats them, nobody having answered.

        Every phone its own: the form refuses two people one number (`find_repeated_contact_refusal`). Each is one of the
        hundred the Bundesnetzagentur keeps unassigned for media productions, (0)176 040690 00 to 99.
        """

        self.seated_people += 1
        if self.seated_people > 99:
            raise ValueError("the seed seats more people than the media range holds numbers")
        return {
            "first_name": first_name,
            "last_name": last_name,
            "email": email or f"{first_name}.{last_name}@example.com".lower(),
            "phone": f"+49 176 040690{self.seated_people:02d}",
            "birth_date": None,
            "einwilligung": compose_seat_einwilligung(today=self.day(entered_on)),
        }

    def confirmed_person(self, person: Mapping[str, Any], answered_on: int) -> dict[str, Any]:
        """The same person after their own link: no WhatsApp and no media, each choice evidenced under a seat's wordings."""

        answer = compose_seat_confirmation_update(
            kontakte={"trainer": person},
            seats=["trainer"],
            birth_date=self.day(-40 * 365),
            today=self.day(answered_on),
            text_versions=SEAT_TEXT_VERSIONS,
            whatsapp=False,
            media=False,
            at=self.stamp(answered_on),
            takes_the_notice_back=False,
        )
        return applied({"kontakte": {"trainer": person}}, answer)["kontakte"]["trainer"]

    def seat_link(self, mail: Mail, *, reminded_on: int | None = None, declined_on: int | None = None) -> dict[str, Any]:
        """A seat's bookkeeping beside its person: an application's link takes one reminder, a season row's none."""

        sent_at = self.day(mail.sent_on)
        entry = compose_bewerbung_confirmation(today=sent_at) if mail.reminded else compose_kontakt_confirmation(today=sent_at)
        return {
            **entry,
            "token_hashes": [link_hash(mail.label)],
            **({"reminded_at": None if reminded_on is None else self.day(reminded_on)} if mail.reminded else {}),
            "declined_at": None if declined_on is None else self.day(declined_on),
        }

    def open_seat(self, first_name: str, last_name: str, *, reminded_on: int | None = None, email: str | None = None) -> SeatState:
        return lambda mail: (self.seated(first_name, last_name, mail.sent_on, email), self.seat_link(mail, reminded_on=reminded_on))

    def confirmed_seat(self, first_name: str, last_name: str, email: str | None = None) -> SeatState:
        return lambda mail: (
            self.confirmed_person(self.seated(first_name, last_name, mail.sent_on, email), mail.sent_on + 1),
            self.seat_link(mail),
        )

    def objected_seat(self, declined_on: int) -> SeatState:
        """A Widerspruch empties the seat and keeps its day beside it."""

        return lambda mail: (None, self.seat_link(mail, declined_on=declined_on))

    @staticmethod
    def erased_seat() -> SeatState:
        """An erasure takes the person and the entry with it, and a seat nobody was ever seated in holds neither."""

        return lambda mail: (None, None)

    vacant_seat = erased_seat

    def seats(self, mail: Mail, states: Mapping[str, SeatState], trainer_is_also: str | None = None) -> dict[str, Any]:
        """The two blocks a record's seats fill. A Trainer's second seat is that person's, one link answering both."""

        filled = {seat: state(Mail(mail.owner, mail.sent_on, mail.reminded, f"{mail.owner}-{seat}")) for seat, state in states.items()}
        every = filled if trainer_is_also is None else {**filled, trainer_is_also: copy.deepcopy(filled["trainer"])}
        return {
            "kontakte": {**{seat: pair[0] for seat, pair in every.items()}, "trainer_is_also": trainer_is_also},
            "confirmations": {seat: pair[1] for seat, pair in every.items()},
        }

    def row_seats(self, owner: str, sent_on: int, states: Mapping[str, SeatState]) -> dict[str, Any]:
        return self.seats(Mail(owner, sent_on, False), states)

    def journey_seat(self, team_name: str, trainer: Mapping[str, str], ansprechperson: SeatState | None = None) -> None:
        """One Trainer the league seated a month ago on `team_name`'s running season, confirmed through their own link.

        Confirmed the next day, the club's other seats empty, and never a departing club's, which an Austritt journey's
        notice reaches.
        """

        if team_name in {project["departing"]["team"] for project in PROJECTS}:
            raise ValueError(f"{team_name} holds a journey's seat and departs in another journey")
        self.running.row(team_name).update(
            self.row_seats(
                f"{team_name.lower()}-{RUNNING}",
                -30,
                {
                    "trainer": self.confirmed_seat(trainer["first_name"], trainer["last_name"], trainer["address"]),
                    "ansprechperson": ansprechperson or self.vacant_seat(),
                    "stellvertretung": self.vacant_seat(),
                },
            )
        )

    def _seats(self) -> None:
        # Weide stayed away from match 3 and is disqualified since: it keeps its group place and its drawn fixtures, match 12
        # still to play, as a departed club does. Its open seat's link takes a Widerspruch alone (`saison_state_of`).
        self.running.row("Weide").update(
            {
                "austritt": {"type": "disqualifikation", "reason": "Nicht zum Spiel angetreten", "date": self.day(-12)},
                **self.row_seats(
                    "weide",
                    -5,
                    {
                        "trainer": self.confirmed_seat("Wiebke", "Wagner"),
                        "ansprechperson": self.open_seat("Willi", "Wendt"),
                        "stellvertretung": self.objected_seat(-2),
                    },
                ),
            }
        )

        # Birke's Trainer, seated by the league and confirmed through her own link: the Austritt journeys' opponent.
        trainerin = PEOPLE["austritt"]["opponent"]
        self.running.row("Birke")["kontakte"] = {
            "trainer": self.confirmed_person(self.seated(trainerin["first_name"], trainerin["last_name"], -62, trainerin["address"]), -60),
            "ansprechperson": None,
            "stellvertretung": None,
            "trainer_is_also": None,
        }

        # The contact's journeys' seats, whose fixture next week asks its answer and owes its line-up, and whose club holds
        # one confirmed registration waiting on it; then the registration journeys', the seat that admits the pupil
        # registering through the club's link. Kastanie's Ansprechperson is no journey's: the person a drive of the team's
        # pages signs in as, the club holding a stored line-up, a locked one, an agreed date and several registrations.
        for project in PROJECTS:
            self.journey_seat(project["contact"]["team"], project["contact"]["trainer"])
        contact = PEOPLE["others"]["contact"]
        desktop_registering, phone_registering = (project["registering"] for project in PROJECTS)
        if desktop_registering["team"] != "Kastanie":
            raise ValueError(
                f"the desktop's registration journey names {desktop_registering['team']}, where the seed seats its Ansprechperson at Kastanie"
            )
        self.journey_seat(
            "Kastanie", desktop_registering["admitter"], self.confirmed_seat(contact["first_name"], contact["last_name"], contact["address"])
        )
        self.journey_seat(phone_registering["team"], phone_registering["admitter"])

    # --- The confirmations a fixture's parties owe ----------------------------------------------------------------

    def request(self, spiel: Mapping[str, Any], party: Mapping[str, Any], asked_on: int, **fields: Any) -> dict[str, Any]:
        """A row about `spiel` for `party`, minted and asked by the pass `asked_on` days from today, laid under `fields`."""

        minted = compose_spielbestaetigung(
            row_id=ObjectId(), saison_id=spiel["saison_id"], spiel=spiel, party=party, today=self.day(asked_on), asked=True
        )
        return read_back_document(Collection.SPIELBESTAETIGUNGEN, {**minted, **fields})

    def team_party(self, team_name: str) -> dict[str, Any]:
        return {"kind": "team", "team_id": self.team_by_name[team_name]["_id"]}

    @staticmethod
    def schiedsrichter_of(spiel: Mapping[str, Any]) -> dict[str, Any]:
        return {"kind": "schiedsrichter", "schiedsrichter_id": spiel["schiedsrichter"]["schiedsrichter_id"]}

    def _requests(self) -> None:
        running = self.running
        # Match 11, Birke against Linde next week, asked about two weeks ago, as the pass asks a fixture three weeks out
        # (`:: last_request_day`) and dates its deadline a week ahead of it (`:: deadline_of`), and declined by Birke's
        # Trainer three days ago for the next day at the same hour, which clashes with no other fixture's ground or referee.
        proposed = running.spiel(11)
        decline = compose_answer_update(
            answer="declined",
            seat="trainer",
            vorschlag=FLSpielbestaetigungAppointment(date=self.day(8), time=proposed["time"]),
            reason="Am Spieltag ist unsere Halle belegt.",
            today=self.day(-3),
        )
        proposals = [self.request(proposed, self.team_party("Birke"), -14, **decline["$set"])]

        # Match 12, Esche against Weide next week, asked of its referee like match 11 and unanswered: the first pass closes
        # the row for Weide's exit and owes him the Einteilung's lifting (`notice_owed`), the one mail of the kind a journey
        # can read.
        lifted = running.spiel(12)
        asked_referee = self.request(lifted, self.schiedsrichter_of(lifted), -14)

        # Next week's group A fixtures, asked of the journeys' seat and referee twelve days ago, inside the three weeks the
        # pass asks ahead (`:: last_request_day`), so the seat's link answers until tomorrow at least: match 9 the
        # desktop's, match 10 the phone's. The stack's first pass asks the other club of each.
        journey_requests = [
            request
            for project, nr in zip(PROJECTS, (9, 10), strict=True)
            for request in (
                self.request(running.spiel(nr), self.team_party(project["contact"]["team"]), -12),
                self.request(running.spiel(nr), self.schiedsrichter_of(running.spiel(nr)), -12),
            )
        ]

        # Each a state a person's own page shows, no journey's: Kastanie's agreement on match 10, which is why the first pass
        # asks it nothing; Birke's request about tomorrow's match 7, unanswered past its deadline six days ago, which the
        # first pass after tomorrow's 17:30 kick-off closes, taking it off Birke's Übersicht; and two referees' bookings,
        # Carla Conrad's on match 11 still to answer and Anna Ahrens's on today's match 6 agreed, which her list shows until
        # the 16:00 kick-off and as the report owed from then.
        kastanie_agreed = compose_answer_update(answer="agreed", seat="ansprechperson", vorschlag=None, reason=None, today=self.day(-5))
        referee_agreed = compose_schiedsrichter_answer_update(answer="agreed", reason=None, today=self.day(-15))
        stated_requests = [
            self.request(running.spiel(10), self.team_party("Kastanie"), -12, **kastanie_agreed["$set"]),
            self.request(running.spiel(7), self.team_party("Birke"), -20),
            self.request(proposed, self.schiedsrichter_of(proposed), -14),
            self.request(running.spiel(6), self.schiedsrichter_of(running.spiel(6)), -20, **referee_agreed["$set"]),
        ]
        self.spielbestaetigungen = [*proposals, asked_referee, *journey_requests, *stated_requests]

    # --- The squads -----------------------------------------------------------------------------------------------

    def pupil(self, first_name: str, last_name: str, consented_on: int | None = None, email: str | None = None) -> dict[str, Any]:
        """A pupil, publishing the name and no media under a pupil's wordings.

        Sixteen and a half, so sixteen on the day of a confirmation two months back too, which refuses a younger pupil
        (`REGISTRIERUNG_MIN_AGE_YEARS`), and under the media's eighteen.
        """

        on = self.consented if consented_on is None else consented_on
        consent = compose_initial(
            block={"scope": "kader_public", "date": self.day(on), "confirmed_at": self.day(on), "media": False},
            at=self.stamp(on),
            text_versions=SPIELER_TEXT_VERSIONS,
        )
        return spieler_document(
            ObjectId(),
            first_name,
            last_name,
            email=email or f"{first_name}.{last_name}@schule.example".lower(),
            birth_date=self.day(-(16 * 365 + 183)),
            einwilligung=consent,
        )

    def kader_row(
        self,
        person: Mapping[str, Any],
        team_name: str,
        nummer: str,
        *,
        saison: str = RUNNING,
        position: str = "Angriff",
        nominee: bool = False,
        retired_on: int | None = None,
        rolle: str | None = None,
    ) -> dict[str, Any]:
        return saison_spieler_document(
            person["_id"],
            saison,
            self.team_by_name[team_name]["_id"],
            _id=ObjectId(),
            is_nachnominiert=nominee,
            rolle=rolle,
            position=position,
            nummer=nummer,
            inactive_since=None if retired_on is None else self.day(retired_on),
        )

    def _kader_rows(self) -> None:
        mia, desktop, phone = PEOPLE["others"]["pupil"], *(project["kaderPupil"] for project in PROJECTS)
        self.mia = self.pupil(mia["first_name"], mia["last_name"], email=mia["address"])
        self.jonas = self.pupil(desktop, "Ahornberg")
        self.lena = self.pupil(phone, "Kastner")
        self.ahorn = [self.pupil(*name) for name in AHORN_KADER]
        nominee = self.pupil("Karl", "Quast")
        retired_nominee = self.pupil("Rosa", "Reiter")
        # In no squad of the finished season or a later one: the scheduler's first pass erases them, the deletion a season
        # after.
        season_after = self.pupil("Till", "Thalberg")
        self.kastanie = [self.pupil(*name) for name in KASTANIE_KADER]
        ulme = [self.pupil(*name) for name in ULME_KADER]
        for kader in (AHORN_KADER, KASTANIE_KADER, ULME_KADER):
            if any(pupil in f"{first} {last}" for first, last in kader for pupil in (desktop, phone)):
                raise ValueError(f"a squad name holds {desktop} or {phone}, whom the administration's journey opens by a name holding theirs")
        self.spieler = [self.mia, self.jonas, self.lena, *self.ahorn, nominee, retired_nominee, season_after, *self.kastanie, *ulme]

        def positioned(people: Sequence[Mapping[str, Any]], team_name: str, first: int) -> list[dict[str, Any]]:
            return [
                self.kader_row(person, team_name, str(first + index), position=POSITIONS[index % len(POSITIONS)])
                for index, person in enumerate(people)
            ]

        # Mia captains Ahorn and Jonas is its Co-Kapitän, each mark standing on the squad and on match 1's line-up; Mia
        # played for Ahorn in the finished season too, a pupil's own page holding a past season beside the running one.
        self.kader_rows = [
            self.kader_row(self.mia, "Ahorn", "9", saison=FINISHED),
            self.kader_row(self.mia, "Ahorn", "9", rolle="kapitaen"),
            self.kader_row(self.jonas, "Ahorn", "4", rolle="co_kapitaen"),
            *positioned(self.ahorn, "Ahorn", 10),
            self.kader_row(nominee, "Ahorn", "30", nominee=True),
            self.kader_row(retired_nominee, "Ahorn", "31", nominee=True, retired_on=-5),
            self.kader_row(self.lena, "Kastanie", "7"),
            *positioned(self.kastanie, "Kastanie", 8),
            *positioned(ulme, "Ulme", 1),
        ]

    # --- The registration links and what came through them --------------------------------------------------------

    def _registrations(self) -> None:
        # Each minted for copying. Group A's stay open past the window's end, the registration journeys' among them, and
        # Weide's opens as the link no longer valid (`find_team_departed_refusal`).
        self.invitations = {
            team_name: invitation_document(
                ObjectId(), saison_id=RUNNING, team_id=self.team_by_name[team_name]["_id"], token=f"made-up-{team_name.lower()}-invitation"
            )
            for team_name in ("Ahorn", "Eiche", "Ulme", "Kastanie", "Weide")
        }
        for project in PROJECTS:
            registering = project["registering"]
            invitation = self.invitations.get(registering["team"])
            if invitation is None or invitation["token_hashes"] != [hash_token(registering["token"])]:
                raise ValueError(
                    f"the registration journey opens {registering['token']}, which is no link the seed mints for {registering['team']}"
                )

        def registration(
            person: Mapping[str, Any],
            submitted_on: int,
            *,
            team_name: str = "Kastanie",
            confirmed: bool = False,
            decision: Mapping[str, Any] | None = None,
        ) -> dict[str, Any]:
            """One pupil's row through a club's link, past the window's end, so its admission makes a nominee."""

            consent = person["einwilligung"]
            return registrierung_document(
                ObjectId(),
                person["email"],
                saison_id=RUNNING,
                team_id=self.team_by_name[team_name]["_id"],
                first_name=person["first_name"],
                last_name=person["last_name"],
                token=f"made-up-{person['first_name'].lower()}-registration",
                submitted_at=self.day(submitted_on),
                deadline=self.day(submitted_on + CONFIRMATION_DEADLINE_DAYS),
                position="Abwehr",
                stufe="Q2",
                confirmed=registrierung_confirmed(
                    birth_date=person["birth_date"],
                    today=consent["confirmed_at"],
                    at=consent["evidence"]["scope"]["at"],
                    scope=consent["scope"],
                    media=consent["media"],
                )
                if confirmed
                else None,
                invitation_id=self.invitations[team_name]["_id"],
                **({} if decision is None else {"status": "declined", "decision": dict(decision)}),
            )

        ole = PEOPLE["administration"]["registration"]
        self.registrierungen = [
            registration(self.pupil(ole["first_name"], ole["last_name"]), -1),
            registration(self.pupil("Pia", "Sander", -2), -3, confirmed=True),
            registration(self.pupil("Ben", "Stark"), -4, decision={"made_at": self.day(-2), "reason": "other_person"}),
            # The one waiting on each contact's journey's seat (`contact`'s `pupil`), confirmed yesterday.
            *(
                registration(
                    self.pupil(project["contact"]["pupil"]["first_name"], project["contact"]["pupil"]["last_name"], -1),
                    -2,
                    team_name=project["contact"]["team"],
                    confirmed=True,
                )
                for project in PROJECTS
            ),
        ]

        # Match 1, Ahorn 2:1 Kastanie two weeks ago, reported by its referee and adopted since: a named scorer, a scorer
        # nobody named, an erased pupil's goal, naming nobody as well, a caution and a red card.
        reported = self.running.spiel(1)
        self.spielberichte = [
            spielbericht_document(
                reported,
                bericht=bericht_document(
                    ergebnis_vorschlag={"team1_tore": 2, "team2_tore": 1, "elfmeterschiessen": None, "sonderereignis": None},
                    scorers=[
                        {"side": "team1", "spieler_id": self.mia["_id"], "minute": "12", "eigentor": False},
                        {"side": "team2", "spieler_id": None, "minute": "40", "eigentor": False},
                        {"side": "team1", "spieler_id": None, "minute": "45+2", "eigentor": False},
                    ],
                    cards=[
                        {"side": "team2", "spieler_id": self.lena["_id"], "minute": "33", "colour": "gelb"},
                        {"side": "team1", "spieler_id": self.jonas["_id"], "minute": "78", "colour": "rot"},
                    ],
                    sides=spielbericht_sides(reported),
                    submitted_at=datetime.fromisoformat(f"{self.day(-14)}T17:00:00").replace(tzinfo=UTC),
                    adopted=True,
                ),
            )
        ]

        # Both clubs' for match 1; Kastanie's alone, four starters short of a side, for match 10 next week, whose other club,
        # the phone's contact seat's, has entered none, as Ahorn, the desktop's, has entered none for match 9; none for
        # today's match 6, past the hour its line-up was due; and none for tomorrow's match 7, due today at 17:30.
        eleven = [self.mia, self.jonas, *self.ahorn[:9]]

        def ids(people: Sequence[Mapping[str, Any]]) -> list[Any]:
            return [person["_id"] for person in people]

        self.aufstellungen = [
            aufstellung_document(reported, self.team_by_name["Ahorn"]["_id"], starters=ids(eleven), bench=ids(self.ahorn[9:12])),
            aufstellung_document(reported, self.team_by_name["Kastanie"]["_id"], starters=ids([self.lena])),
            aufstellung_document(self.running.spiel(10), self.team_by_name["Kastanie"]["_id"], starters=ids([self.lena, *self.kastanie])),
        ]

    # --- The planned season ---------------------------------------------------------------------------------------

    def application(
        self,
        *,
        submitted_on: int,
        wunschfarbe: str,
        states: Mapping[str, SeatState],
        picked: str | None = None,
        new_school: tuple[str, int] | None = None,
        owner: str | None = None,
        trainer_is_also: str | None = None,
        wunschgegner: str | None = None,
        **outcome: Any,
    ) -> dict[str, Any]:
        """One application as the form stored it, for the club `picked` or the new school `new_school` names.

        `new_school` by its name and its place in the scenario, each seat in the state `states` names, its link mailed on
        the day of the submission; `outcome` is what the triage moved, `owner` the link labels' head where a club applied
        twice.
        """

        name = picked if picked is not None else new_school[0] if new_school is not None else ""
        blocks = self.seats(Mail(owner or name.lower(), submitted_on, True), states, trainer_is_also)
        schule = None if new_school is None else {"team_name": new_school[0], **school(*new_school)}
        return bewerbung_document(
            ObjectId(),
            PLANNED,
            outcome.pop("status", "submitted"),
            kontakte=blocks["kontakte"],
            confirmations=blocks["confirmations"],
            submitted_at=self.day(submitted_on),
            # The club an acceptance of a new school made, or the one the form picked.
            team_id=outcome.pop("team_id", None if picked is None else self.team_by_name[picked]["_id"]),
            schule=schule,
            trikot={"existing_set": "", "wunschfarbe": wunschfarbe},
            wunschgegner=wunschgegner,
            **outcome,
        )

    def _planned_season(self) -> None:
        # The window opened a month ago and runs a month on, and the registration window ends before the season's first day,
        # as its write holds it (`registrierung_window_reaches_saison_start`). Undrawn: the create writes no `spielplan` key.
        # Four groups, so a full one stands beside room for every club the journeys enter (`planned_rows`).
        self.planned = saison_document(
            PLANNED,
            "future",
            start_date=self.day(150),
            end_date=self.day(300),
            rules=rules_document(number_of_gruppen=4),
            bewerbung={"open": True, "start": self.day(-30), "end": self.day(30)},
            registrierung={"open": True, "end": self.day(140)},
        )

        def decision_on(made_on: int, reason: str | None = None) -> dict[str, Any]:
            return {"made_at": self.day(made_on), "reason": reason}

        accepted_new_school = self.application(
            new_school=("Pappel", TEAM_NAMES.index("Pappel")),
            submitted_on=-20,
            wunschfarbe="gelb",
            states={
                "trainer": self.confirmed_seat("Paula", "Pohl"),
                "ansprechperson": self.confirmed_seat("Peter", "Pohl"),
                "stellvertretung": self.confirmed_seat("Petra", "Pohl"),
            },
            status="accepted",
            team_id=self.team_by_name["Pappel"]["_id"],
            decision=decision_on(-4),
        )
        accepted_team = self.application(
            picked="Ulme",
            submitted_on=-18,
            wunschfarbe="blau",
            states={
                "trainer": self.confirmed_seat("Ute", "Ullrich"),
                "ansprechperson": self.confirmed_seat("Udo", "Ullrich"),
                "stellvertretung": self.confirmed_seat("Uwe", "Ullrich"),
            },
            status="accepted",
            decision=decision_on(-4),
        )
        # Its Ansprechperson's mail bounced, which the seat's row says, for an administrator to correct the address.
        self.bounced = self.application(
            new_school=(PEOPLE["firstPass"]["applications"]["left"], 4),
            submitted_on=-2,
            wunschfarbe="orange",
            states={
                "trainer": self.confirmed_seat("Egon", "Ehlers"),
                "ansprechperson": self.open_seat("Edda", "Ehlers"),
                "stellvertretung": self.open_seat("Emil", "Ehlers"),
            },
        )
        erased = PEOPLE["firstPass"]["erased"]
        self.bewerbungen = [
            # Nobody has answered.
            self.application(
                new_school=("Akazie", 0),
                submitted_on=-1,
                wunschfarbe="rot",
                wunschgegner="Ahorn-Gymnasium",
                states={
                    "trainer": self.open_seat("Anton", "Albers"),
                    "ansprechperson": self.open_seat("Anke", "Albers"),
                    "stellvertretung": self.open_seat("Ali", "Albers"),
                },
            ),
            # Every seat confirmed: a new school ready for the acceptance, wishing for a colour the season has taken.
            self.application(
                new_school=("Erle", 1),
                submitted_on=-10,
                wunschfarbe="blau",
                states={
                    "trainer": self.confirmed_seat("Erik", "Engel"),
                    "ansprechperson": self.confirmed_seat("Erna", "Engel"),
                    "stellvertretung": self.confirmed_seat("Enno", "Engel"),
                },
            ),
            # A picked club ready for the acceptance, its Trainer holding the Ansprechperson's seat too, and the same club's
            # second application beside it, the Dublette.
            self.application(
                picked="Kastanie",
                submitted_on=-9,
                wunschfarbe="gruen",
                trainer_is_also="ansprechperson",
                states={"trainer": self.confirmed_seat("Kira", "Kolb"), "stellvertretung": self.confirmed_seat("Kurt", "Kolb")},
            ),
            self.application(
                picked="Kastanie",
                owner="kastanie-second",
                submitted_on=-2,
                wunschfarbe="hellgruen",
                states={
                    "trainer": self.open_seat("Kai", "Kunze"),
                    "ansprechperson": self.open_seat("Karla", "Kunze"),
                    "stellvertretung": self.open_seat("Kim", "Kunze"),
                },
            ),
            # A confirmed seat, a reminded one and a Widerspruch, whose notice to the Ansprechperson named the deletion day.
            self.application(
                new_school=("Holunder", 2),
                submitted_on=-6,
                wunschfarbe="violett",
                states={
                    "trainer": self.confirmed_seat("Hilke", "Hoff"),
                    "ansprechperson": self.open_seat("Hauke", "Hoff", reminded_on=-3),
                    "stellvertretung": self.objected_seat(-2),
                },
                erasure_announced_at=self.day(-2),
            ),
            # A seat emptied by an erasure, the others' links still running.
            self.application(
                new_school=("Hasel", 3),
                submitted_on=-2,
                wunschfarbe="tuerkis",
                states={
                    "trainer": self.erased_seat(),
                    "ansprechperson": self.confirmed_seat("Heike", "Hahnemann"),
                    "stellvertretung": self.open_seat("Horst", "Hahnemann"),
                },
            ),
            self.bounced,
            # Past its deadline: the first pass, a minute after the frontend starts, erases it and tells the Trainerin, the
            # one seat that confirmed, the one deletion a journey can read.
            self.application(
                new_school=(PEOPLE["firstPass"]["applications"]["lapsed"], 6),
                owner="laerche",
                submitted_on=-16,
                wunschfarbe="braun",
                states={
                    "trainer": self.confirmed_seat(erased["first_name"], erased["last_name"], erased["address"]),
                    "ansprechperson": self.open_seat("Lutz", "Lehmann", reminded_on=-13),
                    "stellvertretung": self.open_seat("Lisa", "Lehmann", reminded_on=-13),
                },
            ),
            # Declined with a seat still open, whose link the decision ended.
            self.application(
                new_school=("Flieder", 5),
                submitted_on=-12,
                wunschfarbe="flieder",
                states={
                    "trainer": self.confirmed_seat("Frank", "Fink"),
                    "ansprechperson": self.confirmed_seat("Fenja", "Fink"),
                    "stellvertretung": self.open_seat("Fritz", "Fink"),
                },
                status="declined",
                decision=decision_on(-3, "Die Gruppen sind voll"),
            ),
            accepted_new_school,
            accepted_team,
        ]

        def planned_row(team_name: str, gruppe: str, trikot_farbe: str, people: Mapping[str, Any] | None = None) -> dict[str, Any]:
            team = self.team_by_name[team_name]
            return saison_team_document(
                PLANNED,
                team["_id"],
                team["name"],
                team["shorthand"],
                _id=ObjectId(),
                gruppe=gruppe,
                trikot_farbe=trikot_farbe,
                **(people or {}),
            )

        # Group B is full, group A has room for the acceptance's journeys and group C for the administration's. The two
        # accepted applications' clubs carry their people as the acceptance copies them, and Esche stands entered with
        # nobody yet; the clubs the journeys' rejected applications pick and the clubs the administration's journeys enter
        # are left to enter, so none holds a row.
        self.planned_rows = [
            planned_row("Ulme", "B", "blau", {"kontakte": accepted_team["kontakte"]}),
            planned_row("Pappel", "B", "gelb", {"kontakte": accepted_new_school["kontakte"]}),
            planned_row("Esche", "B", "gold"),
            planned_row(
                "Eiche",
                "B",
                "rosa",
                self.row_seats(
                    "eiche",
                    -8,
                    {
                        "trainer": self.confirmed_seat("Eva", "Ebner"),
                        "ansprechperson": self.objected_seat(-6),
                        "stellvertretung": self.erased_seat(),
                    },
                ),
            ),
            planned_row(
                "Linde",
                "A",
                "schwarz",
                self.row_seats(
                    "linde",
                    -2,
                    {
                        "trainer": self.open_seat("Lars", "Lorenz"),
                        "ansprechperson": self.open_seat("Lotte", "Lorenz"),
                        "stellvertretung": self.confirmed_seat("Lukas", "Lorenz"),
                    },
                ),
            ),
        ]
        entered = {row["name"] for row in self.planned_rows}
        for project in PROJECTS:
            for team_name in (project["applicants"]["declined"], project["entered"]["team"]):
                if team_name in entered:
                    raise ValueError(f"a journey enters {team_name} into the planned season, which the seed has entered already")

    # --- Mail, bans, address changes and the log ------------------------------------------------------------------

    def _access(self) -> None:
        # The last mail owed `bounced`'s Ansprechperson, as its final state leaves the row (`final_update`): it owes nothing
        # and only says what became of the mail.
        recorded = datetime.fromisoformat(f"{self.day(-2)}T09:00:00").replace(tzinfo=UTC)
        receipt = outbox_document(
            "made-up/bounced",
            to=self.bounced["kontakte"]["ansprechperson"]["email"],
            now=recorded,
            data=FLBewerbungReceivedData(
                kind="bewerbung_received",
                saison_id=PLANNED,
                seats=["ansprechperson"],
                pending=["ansprechperson", "stellvertretung"],
                deadline=self.bounced["confirmations"]["ansprechperson"]["deadline"],
            ),
            reference=FLOutboxReference(collection=Collection.BEWERBUNGEN, id=self.bounced["_id"], seat="ansprechperson"),
        )
        self.outbox = [
            read_back_document(
                Collection.OUTBOX,
                {
                    **applied(receipt, final_update("sent", now=recorded + timedelta(minutes=1))),
                    "attempts": 1,
                    "delivery": {"state": "undeliverable", "reason": "bounced", "at": recorded + timedelta(minutes=5)},
                },
            )
        ]

        access = PEOPLE["access"]
        # Long enough for a phone's row to have to wrap it. None before a first season: a ban counts its five seasons from
        # the running one, and the list refuses a ban while none runs (`ban_list_no_saison`).
        self.ban_list = (
            []
            if self.first_year
            else [ban_document(access["ban"], until="2031", ban_reason="Beleidigungen am Spielfeldrand", created_at=self.day(-30))]
        )

        def address_change(holder: str, way: FLAddressChangeWay, label: str, **step: Any) -> dict[str, Any]:
            """A running change as its start writes it, its links minted at their hand-outs, `step` the presses since."""

            started = datetime.fromisoformat(f"{self.day(-1)}T12:00:00").replace(tzinfo=clock.GERMANY)
            return read_back_document(
                Collection.ADDRESS_CHANGES,
                {
                    "_id": ObjectId(),
                    **compose_record(address=holder, email=holder.replace("@", ".neu@"), way=way, now=started),
                    "token_hashes": [link_hash(f"{label}-new")],
                    "stop": {"token_hashes": [link_hash(f"{label}-stop")]},
                    **step,
                },
            )

        self.address_changes = [
            address_change(access["changing"]["address"], "waiting_period", "noll", valid_until=self.waiting),
            # Its wait outlasts any run, as a handover's does: the hourly pass switches an address whose date has passed.
            address_change(
                PEOPLE["administrators"]["moving"],
                "account",
                "move",
                valid_until=None,
                released_at=self.in_effect,
                confirmed_at=self.in_effect,
                effective_from=self.waiting,
            ),
        ]

        def logged(hours_ago: int, by: str, action: str, **fields: Any) -> dict[str, Any]:
            return action_log_document(action, by=by, at=self.now - timedelta(hours=hours_ago), **fields)

        # One row of each who: an administrator's folded address, a team's representative, a referee, a pass, a person. Before
        # a first season, the acts no season was there for alone.
        self.action_log = [
            logged(50, "person", "erasure.own"),
            *(
                []
                if self.first_year
                else [
                    logged(40, "system", "retention.kontakte", saison_id=FINISHED, count=2),
                    logged(30, "schiedsrichter", "spielbericht.saved", saison_id=FINISHED, spiel_nr=1),
                    logged(20, "kontakt", "spielbestaetigung.answered", team=PEOPLE["access"]["loggedTeam"], saison_id=FINISHED),
                ]
            ),
            logged(10, PEOPLE["owner"], "grant.added", label=PEOPLE["administrators"]["waiting"]),
        ]

        # The mailbox of the latest registration's pupil, whose press anchored it: as the seed runs, since an anchor lapses
        # an hour after its last press and the read-back reads it after the seed.
        self.mailbox_anchors = [
            mailbox_anchor_document(registrierung["email"], anchored_at=self.now) for registrierung in self.registrierungen[:1]
        ]

    # --- Writing it -----------------------------------------------------------------------------------------------

    def documents(self) -> dict[Collection, list[dict[str, Any]]]:
        """Every collection's documents in their order, each read through its record model.

        Each anchored collection's first carries its anchor's count.
        """

        written = {
            Collection.TEAMS: self.teams,
            Collection.SPIELORTE: self.venues,
            Collection.SCHIEDSRICHTER: self.referees,
            Collection.GRANTS: self.grants,
            Collection.SAISONS: [*(season.saison for season in self.played), self.planned],
            Collection.SAISON_TEAMS: [*(row for season in self.played for row in season.rows), *self.planned_rows],
            Collection.SPIELTAGE: [spieltag for season in self.played for spieltag in season.spieltage],
            Collection.SPIELE: [spiel for season in self.played for spiel in season.spiele],
            Collection.SPIELER: self.spieler,
            Collection.SAISON_SPIELER: self.kader_rows,
            Collection.SPIELBERICHTE: self.spielberichte,
            Collection.AUFSTELLUNGEN: self.aufstellungen,
            Collection.BEWERBUNGEN: self.bewerbungen,
            Collection.INVITATIONS: list(self.invitations.values()),
            Collection.REGISTRIERUNGEN: self.registrierungen,
            Collection.OUTBOX: self.outbox,
            Collection.BAN_LIST: self.ban_list,
            Collection.ADDRESS_CHANGES: self.address_changes,
            Collection.ACTION_LOG: self.action_log,
            Collection.SPIELBESTAETIGUNGEN: self.spielbestaetigungen,
            Collection.MAILBOX_ANCHORS: self.mailbox_anchors,
        }
        return {
            collection: [
                read_back_document(collection, {**document, **({ANCHOR_FIELD: 1} if collection in ANCHORED and index == 0 else {})})
                for index, document in enumerate(documents)
            ]
            for collection, documents in written.items()
        }


# --- The landing's state --------------------------------------------------------------------------------------------


def moved(iso: str | None, days: int) -> str | None:
    """`iso` moved by `days`, a stored day or `None` as it stands."""

    return None if iso is None else (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def move_running(league: MadeUpLeague, days: int) -> None:
    """The running season's start, its matchdays and its fixtures moved by `days`, its end as it stands."""

    running = league.running
    running.saison["start_date"] = moved(running.saison["start_date"], days)
    for row in running.spieltage:
        row.update(start=moved(row["start"], days), end=moved(row["end"], days))
    for row in running.spiele:
        row["date"] = moved(row["date"], days)


def unplayed(league: MadeUpLeague, row: dict[str, Any], *, undated: bool = False) -> None:
    """A fixture as the draw leaves it: no goals, no shoot-out, no event, no report and no line-up, undated where asked."""

    for side in ("team1", "team2"):
        if row[side] is not None:
            row[side]["tore"] = None
    row.update(ergebnis=None, elfmeterschiessen=None, sonderereignis=None)
    if undated:
        row.update(date=None, time=None)
    league.spielberichte = [report for report in league.spielberichte if report["spiel_id"] != row["_id"]]
    league.aufstellungen = [aufstellung for aufstellung in league.aufstellungen if aufstellung["spiel_id"] != row["_id"]]


def played(
    league: MadeUpLeague, row: dict[str, Any], tore: tuple[int, int], *, sides: tuple[str, str] | None = None, elfmeterschiessen: Any = None
) -> None:
    """`row` played as `tore` says, its sides named where the knockout has none yet."""

    for key, name, goals in zip(("team1", "team2"), sides or (None, None), tore, strict=True):
        row[key] = {"team_id": league.team_by_name[name]["_id"], "tore": goals} if name is not None else {**row[key], "tore": goals}
    row.update(ergebnis=f"{tore[0]}:{tore[1]}", elfmeterschiessen=elfmeterschiessen)


def countdown(league: MadeUpLeague, *, undated: bool) -> None:
    move_running(league, 49)
    for row in league.running.spiele:
        unplayed(league, row, undated=undated)
    # A season not yet started holds no exit, whatever day one is dated: the app records one only once it has started.
    for row in league.running.rows:
        row["austritt"] = None


def decided(league: MadeUpLeague) -> None:
    running = league.running
    move_running(league, -30)
    # The group fixtures not yet played, but the one called off, and both knockout days, all before today.
    for nr in (6, 7, 9, 10, 11, 12):
        played(league, running.spiel(nr), (1, 0))
    for phase, offset in (("halbfinale", -7), ("finale", -3)):
        next(row for row in running.spieltage if row["saison_phase"] == phase).update(start=league.day(offset), end=league.day(offset))
    for nr in (13, 14):
        running.spiel(nr).update(date=league.day(-7), time="15:00:00")
    running.spiel(15).update(date=league.day(-3), time="13:00:00")
    running.spiel(16).update(date=league.day(-3), time="15:00:00")
    # Fielded as the knockout's sources name them from the tables these results give: A Ahorn 9, Ulme 4, Kastanie 3,
    # Eiche 1; B Esche 9, Birke 6, Linde and Weide 0.
    played(league, running.spiel(13), (2, 0), sides=("Ahorn", "Birke"))
    played(league, running.spiel(14), (1, 2), sides=("Esche", "Ulme"))
    played(league, running.spiel(15), (3, 1), sides=("Birke", "Esche"))
    played(league, running.spiel(16), (1, 1), sides=("Ahorn", "Ulme"), elfmeterschiessen={"team1": 4, "team2": 3})


def no_window_open(league: MadeUpLeague) -> None:
    league.planned["bewerbung"]["open"] = False


def landed(state: Callable[[MadeUpLeague], None], *, first_year: bool = False) -> Callable[[datetime], MadeUpLeague]:
    """The league built on `now`, then `state` applied once every request has copied the fixture it is about.

    A request about a moved fixture is one about a slot the fixture left, which neither act takes.
    """

    def build(now: datetime) -> MadeUpLeague:
        league = MadeUpLeague(now=now, first_year=first_year)
        state(league)
        return league

    return build


# The state of the season card and the join band on the landing, by `SEED_LANDING`, which `local.sh --e2e --landing=<state>`
# seeds for a look at `/` under each. The running ones change the running season's dates and results; the two with no
# season running are the league before its first season, the one league with none, the second closing the planned
# season's window.
# - `running`, the seed as written: a last result and a next match.
# - `running-two-one-side`: every fixture dated in the past, so the card shows two last results and no next match.
# - `countdown`: the season starts in two weeks, no fixture dated or played.
# - `countdown-with-opening`: the same, its fixtures dated, the first of them the opening match.
# - `decided`: every group fixture and the knockout played three weeks back, the final on penalties.
# - `window`: no season yet, the planned one's application window open, so the card is the window's.
# - `none`: no season yet and no window open, so the card is the empty box.
LANDING_STATES: Final[Mapping[str, Callable[[datetime], MadeUpLeague]]] = {
    "running": landed(lambda league: None),
    "running-two-one-side": landed(lambda league: move_running(league, -10)),
    "countdown": landed(lambda league: countdown(league, undated=True)),
    "countdown-with-opening": landed(lambda league: countdown(league, undated=False)),
    "decided": landed(decided),
    "window": landed(lambda league: None, first_year=True),
    "none": landed(no_window_open, first_year=True),
}


async def write(client: AsyncMongoClient, database_name: str, league: MadeUpLeague) -> int:
    """Replace every document of the database with the league's, and answer the exit code."""

    documents = league.documents()
    database = client[database_name]
    try:
        # Emptied rather than dropped: the backend's boot made each collection with its indexes, and a dropped collection
        # would be re-created by the first insert with none.
        for name in await database.list_collection_names():
            if name.startswith("system."):
                continue
            removed = (await database[name].delete_many({})).deleted_count
            if removed:
                print(f"emptied {name}: {removed} document(s)")
        # Ordered: an insert a unique index refuses stops the seed with the server's own account of the key.
        for collection, rows in documents.items():
            # A landing state may leave a collection empty, and `insert_many` refuses an empty list.
            if not rows:
                continue
            inserted = await database[collection].insert_many(rows, ordered=True)
            print(f"seeded {collection}: {len(inserted.inserted_ids)} document(s)")
    except PyMongoError as failure:
        # An insert the server refused, in the server's own account of the key. A bulk write answered with write-concern
        # errors alone, one the set never acknowledged, refused no document.
        if isinstance(failure, BulkWriteError) and (written := failure.details.get("writeErrors")):
            print(f"An insert was refused: {written[0]['errmsg']}", file=sys.stderr)
            return REFUSED
        # The type alone: the driver's message names the host it resolved out of the secret. Nothing of the seed was
        # judged, as the read-back's own unreadable database is not.
        print(f"The database could not be written ({type(failure).__name__}).", file=sys.stderr)
        return UNJUDGED

    print(f"made-up seed written to '{database_name}', today being {league.today}")
    return 0


# The one server the seed writes to: the `mongo` service the local and the end-to-end stacks start, at the port it
# listens on, as the local stack's Compose file names it to the backend. Production starts no such service.
LOCAL_SERVER: Final = [("mongo", 27017)]


def is_local_server(uri: str) -> bool:
    """Whether `uri` is a login-free `mongodb://` URI naming `LOCAL_SERVER` alone and connecting to it directly, by pymongo's own parser.

    A match on that one server rather than a list of others: whatever else a URI names, the seed empties nothing there.
    Without `directConnection=true` the driver joins the whole replica set its one host belongs to, and writes to
    whichever member that set names its primary, so the host alone would bound only the first server it asks.
    """
    # The plain scheme before the parse: `mongodb+srv://` asks DNS for its hosts during it, and names no local service.
    if not uri.startswith("mongodb://"):
        return False
    try:
        parsed = parse_uri(uri)
    # Judged, never printed: the parser's message can quote what it read.
    except PyMongoError, ValueError, TypeError:
        return False
    return (
        parsed["nodelist"] == LOCAL_SERVER
        and parsed["options"].get("directConnection") is True
        and parsed["username"] is None
        and parsed["password"] is None
    )


async def _main() -> int:
    # Unset, the seed as written; set, it names a state or is refused, the empty name among them.
    landing = os.environ.get("SEED_LANDING", AS_WRITTEN)
    if landing not in LANDING_STATES:
        # A refusal, 2, before the settings are read: nothing was built or written.
        print(f"SEED_LANDING names no state of the landing: {landing}. One of: {', '.join(LANDING_STATES)}.", file=sys.stderr)
        return UNJUDGED
    try:
        config = get_config()
    # Its message names variables, files and failure types, never a value, as the backend's boot logs it.
    except EnvironmentValidationError as refusal:
        print(f"The settings could not be loaded: {refusal}", file=sys.stderr)
        return UNJUDGED
    uri = config.mongodb_uri.get_secret_value()
    if not is_local_server(uri):
        # A refusal, 2, before any client exists. It names what the seed requires alone: the settings are a secret.
        print(
            "The made-up seed writes only to the local or the end-to-end stack's own mongo service, at port 27017 with directConnection=true.",
            file=sys.stderr,
        )
        return UNJUDGED
    league = LANDING_STATES[landing](clock.now())

    client = new_client(uri)
    try:
        return await write(client, config.db_base_name, league)
    finally:
        await client.close()


if __name__ == "__main__":
    try:
        code = asyncio.run(_main())
    except Exception as error:
        _crashed(error)
    raise SystemExit(code)
