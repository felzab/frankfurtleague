import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Final, NamedTuple, cast

from app.api.bewerbungen.services import days_after, seat_named
from app.api.identitaet.services import holds_a_name, namen_aus
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtAnsetzung,
    FLSpielbestaetigungAntwortArt,
    FLSpielbestaetigungGrund,
    FLSpielbestaetigungSeite,
    FLSpielbestaetigungTermin,
    FLSpielbestaetigungZustand,
)
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielOrtFieldPayload,
    FLSpielOrtFieldPublic,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielTeamFieldPayload,
)
from app.api.teams.schemas import KONTAKT_ROLLEN, FLKontaktRolle
from app.api.teams.services import has_taken_place, seats_changing_holder
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.schemas.bounds import (
    SPIEL_ANFRAGE_VORLAUF_TAGE,
    SPIEL_BESTAETIGUNG_FRIST_TAGE,
    SPIEL_ERINNERUNG_TAGE_ERSTE,
    SPIEL_ERINNERUNG_TAGE_ZWEITE,
)

# Each stored `ansetzung` key and its fixture path: the ONE list the digest, the snapshot and the public
# verdict's `$lookup` read, a key one lacks giving two answers to which Ansetzung a row is about.
ANSETZUNG_QUELLEN: Final[Mapping[str, str]] = {
    "datum": "datum",
    "uhrzeit": "uhrzeit",
    "spielort_id": "ort.spielort_id",
    "team1_id": "team1.team_id",
    "team2_id": "team2.team_id",
}

# The request and the two reminders: every link a seat was mailed answers until the deadline, so a
# reminder appends its hash and the oldest one cannot fall off before the row closes.
TOKEN_HASHES_PER_SEAT: Final = 3


def _read_path(document: Mapping[str, Any], path: str) -> Any:
    value: Any = document
    for key in path.split("."):
        value = value.get(key) if isinstance(value, Mapping) else None

    return value


def _ansetzung_values(spiel: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _read_path(spiel, path) for key, path in ANSETZUNG_QUELLEN.items()}


def _digest(values: Mapping[str, Any]) -> str:
    # A missing value is the empty string; no input's own alphabet holds the separator.
    canonical = "|".join("" if values[key] is None else str(values[key]) for key in ANSETZUNG_QUELLEN)

    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def ansetzung_stand_of(spiel: Mapping[str, Any]) -> str:
    """The digest of a raw fixture's Ansetzung: `datum`, `uhrzeit`, `ort.spielort_id`, `team1.team_id`, `team2.team_id`.

    The ground on purpose: a confirmation binds it too. A sixth input changes every stored row's meaning.
    """

    return _digest(_ansetzung_values(spiel))


def compose_ansetzung(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """The stored `ansetzung` of a row minted for this fixture: the digest's inputs and the digest, from one read."""

    values = _ansetzung_values(spiel)

    return {**values, "stand": _digest(values)}


def build_answerable_filter() -> dict[str, Any]:
    """A row the answer may write: neither answered nor closed, the reach of `uniq_spielbestaetigung_offen`.

    The first press binds because this filter rides on the write itself, so two seats pressing at once
    are one answer.
    """

    return {"antwort": None, "geschlossen": None}


def build_closable_filter() -> dict[str, Any]:
    """A row the sweep's close reaches: not yet closed, ANSWERED OR NOT.

    Never `build_answerable_filter`: an agreement a move overtook would keep no stamp saying why it
    stopped applying.
    """

    return {"geschlossen": None}


def build_token_filter(*, token_hash: str) -> Mapping[str, Any]:
    """Every seat's hashes, so the hash alone finds the row. No state term: a reopened link shows its own state."""

    return {"$or": [{f"kontakte.{seat}.token_hashes": token_hash} for seat in KONTAKT_ROLLEN]}


def seat_holding(*, spielbestaetigung_raw: Mapping[str, Any], token_hash: str) -> FLKontaktRolle | None:
    """Which seat this hash names, read off the row the filter found: the first in seat order, where a mirrored pair shares one."""

    block = spielbestaetigung_raw.get("kontakte")
    if not isinstance(block, Mapping):
        return None

    for seat in KONTAKT_ROLLEN:
        entry = block.get(seat)
        hashes = entry.get("token_hashes") if isinstance(entry, Mapping) else None
        if isinstance(hashes, list) and token_hash in hashes:
            return seat_named(seat)

    return None


# --- The LINK's view and answer. What each code refuses is `docs/backend/spec.md` §1.4.

ANSETZUNG_TOKEN_UNKNOWN = "REQ-ANSETZUNG-001"
ANSETZUNG_BEANTWORTET = "REQ-ANSETZUNG-002"
ANSETZUNG_FRIST_VORBEI = "REQ-ANSETZUNG-003"
ANSETZUNG_GEAENDERT = "REQ-ANSETZUNG-004"
ANSETZUNG_ENTSCHIEDEN = "REQ-ANSETZUNG-005"
ANSETZUNG_VORSCHLAG_VERGANGEN = "REQ-ANSETZUNG-007"
ANSETZUNG_GESCHLOSSEN = "REQ-ANSETZUNG-009"
ANSETZUNG_GESPERRT = "REQ-ANSETZUNG-011"
ANSETZUNG_NAME_IN_BEGRUENDUNG = "REQ-ANSETZUNG-012"

# A row closed for one of these is about an Ansetzung the fixture has left, which the page tells apart
# from a deadline that ran out.
GRUENDE_UNGUELTIG: Final = frozenset({"ansetzung_geaendert", "schiedsrichter_gewechselt"})

# An INCLUSION: of a row's links the hashes alone, which resolve the seat and never leave the handler.
LINK_FIELDS: Mapping[str, int] = {
    "saison_id": 1,
    "spiel_id": 1,
    "partei": 1,
    "ansetzung": 1,
    "frist": 1,
    "antwort": 1,
    "geschlossen": 1,
    **{f"kontakte.{seat}.token_hashes": 1 for seat in KONTAKT_ROLLEN},
}


def entscheidung_of(*, spiel: Mapping[str, Any], austritte: Iterable[str], tag: Any) -> FLSpielbestaetigungGrund | None:
    """Why a fixture takes no confirmation whatever its Ansetzung: decided, called off, or a club out by `tag`.

    One rule for the link's refusal and the pass's close, so no link answers what the next pass shuts.
    """

    if has_taken_place(spiel):
        return "spiel_entschieden"

    # Every other event leaves no record: a called-off fixture is asked afresh once reinstated.
    if spiel.get("sonderereignis") is not None:
        return "abgesagt"

    if tag is not None and any(austritt <= tag for austritt in austritte):
        return "austritt"

    return None


@dataclass(frozen=True)
class AnsetzungLage:
    """What a link is judged against and does not write: the fixture as it stands, and both clubs' season rows."""

    spiel: Mapping[str, Any]
    vereine: Sequence[Mapping[str, Any]]


def seat_adresse(*, lage: AnsetzungLage, spielbestaetigung_raw: Mapping[str, Any], seat: str) -> str | None:
    """The address the seat holds now on its club's season row.

    A seat a write emptied or handed over had its links voided in that write, so a link resolving here is its holder's.
    """

    team_id = (spielbestaetigung_raw.get("partei") or {}).get("team_id")
    verein = next((row for row in lage.vereine if row.get("team_id") == team_id), None)
    sitz = ((verein or {}).get("kontakte") or {}).get(seat)
    email = sitz.get("email") if isinstance(sitz, Mapping) else None

    return email if isinstance(email, str) else None


def _stand_moved(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage) -> bool:
    return ansetzung_stand_of(lage.spiel) != spielbestaetigung_raw["ansetzung"]["stand"]


def _decided(*, lage: AnsetzungLage) -> bool:
    """`entscheidung_of` over the fixture as it stands and both clubs' season rows, the rule the pass's close shuts a row by."""

    austritte = [str(datum) for row in lage.vereine if (datum := (row.get("austritt") or {}).get("datum")) is not None]

    return entscheidung_of(spiel=lage.spiel, austritte=austritte, tag=lage.spiel.get("datum")) is not None


def _past_frist(*, spielbestaetigung_raw: Mapping[str, Any], today: str) -> bool:
    # A link answers on its deadline's own day.
    return today > str(spielbestaetigung_raw["frist"])


def zustand_of(
    *,
    spielbestaetigung_raw: Mapping[str, Any],
    lage: AnsetzungLage,
    today: str,
    gesperrt: bool,
    vorschlag_offen: FLSpielbestaetigungTermin | None,
) -> FLSpielbestaetigungZustand:
    """What a reopened link shows, the first state matching winning: a spent link is answered, never refused."""

    antwort, geschlossen = spielbestaetigung_raw.get("antwort"), spielbestaetigung_raw.get("geschlossen")

    if gesperrt:
        return "gesperrt"

    if isinstance(antwort, Mapping):
        return "zugesagt" if antwort["art"] == "zugesagt" else "abgelehnt"

    if (isinstance(geschlossen, Mapping) and geschlossen["grund"] in GRUENDE_UNGUELTIG) or _stand_moved(
        spielbestaetigung_raw=spielbestaetigung_raw, lage=lage
    ):
        return "ungueltig"

    if geschlossen is not None or _decided(lage=lage) or _past_frist(spielbestaetigung_raw=spielbestaetigung_raw, today=today):
        return "abgelaufen"

    return "gueltig" if vorschlag_offen is None else "vorschlag"


def find_unknown_link_refusal(*, seat: FLKontaktRolle | None) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-001`: ONE answer for a guess and a voided link, which a stranger's guess must not tell apart."""

    if seat is not None:
        return None

    return WriteRefusal(
        error_code=ANSETZUNG_TOKEN_UNKNOWN,
        status=HTTPStatus.NOT_FOUND,
        message="this link opens no fixture confirmation; it may have been replaced when its seat changed hands",
    )


def find_gesperrt_link_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-011`: asked at the press, however old the link, ahead of every state of its row."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=ANSETZUNG_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
        message="the email address this link was sent to is on the ban list, so it answers nothing",
    )


def first_press_refusal() -> WriteRefusal:
    """`REQ-ANSETZUNG-002`, built here alone: by the spent-link judgement and by the answer whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=ANSETZUNG_BEANTWORTET,
        status=HTTPStatus.GONE,
        message="this club has already answered about this fixture, from this link or another of its seats",
    )


def find_spent_link_refusal(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage, today: str) -> WriteRefusal | None:
    """Why this row takes no answer now, or `None`, in the order a spent token meets its code.

    An answered row first, closed since or not, then one closed unanswered, then the deadline, the Ansetzung and the fixture.
    """

    if spielbestaetigung_raw.get("antwort") is not None:
        return first_press_refusal()

    if spielbestaetigung_raw.get("geschlossen") is not None:
        return WriteRefusal(
            error_code=ANSETZUNG_GESCHLOSSEN,
            status=HTTPStatus.GONE,
            message="this confirmation was closed before anybody answered; a fresh request is a new link",
        )

    if _past_frist(spielbestaetigung_raw=spielbestaetigung_raw, today=today):
        return WriteRefusal(
            error_code=ANSETZUNG_FRIST_VORBEI,
            status=HTTPStatus.GONE,
            message=f"this confirmation's deadline {spielbestaetigung_raw['frist']} has passed, and the date is the administrator's now",
        )

    if _stand_moved(spielbestaetigung_raw=spielbestaetigung_raw, lage=lage):
        return WriteRefusal(
            error_code=ANSETZUNG_GEAENDERT,
            status=HTTPStatus.GONE,
            message="the fixture's date, time, ground or sides changed since this link was sent; the new Ansetzung is asked afresh",
        )

    if _decided(lage=lage):
        return WriteRefusal(
            error_code=ANSETZUNG_ENTSCHIEDEN,
            status=HTTPStatus.GONE,
            message="this fixture has been decided, called off or lost a club since this link was sent",
        )

    return None


def find_vorschlag_vergangen_refusal(*, vorschlag: FLSpielbestaetigungTermin, today: str) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-007`: a proposal names a day still to come or today."""

    if vorschlag.datum >= today:
        return None

    return WriteRefusal(
        error_code=ANSETZUNG_VORSCHLAG_VERGANGEN,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message=f"the proposed date {vorschlag.datum} lies before today",
    )


def beteiligte_namen(*, lage: AnsetzungLage) -> frozenset[str]:
    """Every name the people of this Ansetzung hold: both clubs' three seats on their season rows, and the booked referee.

    The referee off the fixture's copy, which a rename rewrites in its own transaction; the ghost's is null.
    """

    fields = [
        *(
            ((row.get("kontakte") or {}).get(seat) or {}).get(part)
            for row in lage.vereine
            for seat in KONTAKT_ROLLEN
            for part in ("vorname", "nachname")
        ),
        (lage.spiel.get("schiedsrichter") or {}).get("name"),
    ]

    return namen_aus(fields)


def find_name_in_begruendung_refusal(*, begruendung: str, names: Iterable[str]) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-012`: no name of the Ansetzung's people stands in a reason the row keeps for the season (`holds_a_name`).

    A common word equal to a name is refused with it, and the club rephrases.
    """

    if not holds_a_name(begruendung, names):
        return None

    # Naming none of them: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=ANSETZUNG_NAME_IN_BEGRUENDUNG,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        message="the reason names a person of this fixture's clubs or its referee, and the confirmation keeps it for the season",
        fields=(("begruendung",),),
    )


def proposal_payload(stored: FLSpiel, vorschlag: FLSpielbestaetigungTermin) -> FLPatchSpielDataPayload:
    """The stored fixture as the administrator's wholesale save would carry it on the proposed date and hour, everything else kept.

    So a proposal meets the very judges that save meets, references and event as they stand.
    """

    return FLPatchSpielDataPayload(
        sonderereignis=stored.sonderereignis,
        team1=None if stored.team1 is None else FLSpielTeamFieldPayload(team_id=stored.team1.team_id, tore=stored.team1.tore),
        team2=None if stored.team2 is None else FLSpielTeamFieldPayload(team_id=stored.team2.team_id, tore=stored.team2.tore),
        team1_quelle=stored.team1_quelle,
        team2_quelle=stored.team2_quelle,
        elfmeterschiessen=stored.elfmeterschiessen,
        datum=vorschlag.datum,
        uhrzeit=vorschlag.uhrzeit,
        ort=None if stored.ort is None else FLSpielOrtFieldPayload(spielort_id=stored.ort.spielort_id, mietpreis=stored.ort.mietpreis),
        schiedsrichter=(
            None
            if stored.schiedsrichter is None
            else FLSpielSchiedsrichterFieldPayload(
                schiedsrichter_id=stored.schiedsrichter.schiedsrichter_id, payment=stored.schiedsrichter.payment
            )
        ),
        # No judge reads the note, and a hand-written one past the payload's bound would refuse a proposal for a field it never names.
        notiz=None,
    )


def seite_of(spielbestaetigung_raw: Mapping[str, Any]) -> FLSpielbestaetigungSeite:
    """Off the stored snapshot, so a side the fixture has since lost still names the reader's club."""

    team_id = (spielbestaetigung_raw.get("partei") or {}).get("team_id")

    return "team1" if team_id == spielbestaetigung_raw["ansetzung"]["team1_id"] else "team2"


def ansicht_ansetzung_of(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage) -> FLSpielbestaetigungAnsichtAnsetzung:
    """The fixture as it stands now; where it has lost its day, hour or a side, the Ansetzung the row was about.

    Only a link whose stand moved meets such a fixture, and its page renders the state alone.
    """

    snapshot = spielbestaetigung_raw["ansetzung"]
    namen = {row.get("team_id"): row.get("name") for row in lage.vereine}

    def side_name(slot: str, snapshot_key: str) -> str:
        side = lage.spiel.get(slot)
        return str(side["name"]) if isinstance(side, Mapping) else str(namen.get(snapshot[snapshot_key]) or "")

    ort = lage.spiel.get("ort")

    return FLSpielbestaetigungAnsichtAnsetzung(
        team1_name=side_name("team1", "team1_id"),
        team2_name=side_name("team2", "team2_id"),
        datum=lage.spiel.get("datum") or snapshot["datum"],
        uhrzeit=lage.spiel.get("uhrzeit") or snapshot["uhrzeit"],
        spielort=None
        if not isinstance(ort, Mapping)
        else FLSpielOrtFieldPublic(spielort_id=ort["spielort_id"], name=ort["name"], maps_link=ort["maps_link"]),
    )


def ansicht_vorschlag_of(
    *, spielbestaetigung_raw: Mapping[str, Any], zustand: FLSpielbestaetigungZustand, vorschlag_offen: FLSpielbestaetigungTermin | None
) -> FLSpielbestaetigungTermin | None:
    """The proposal in front of the reader: the other club's on `vorschlag`, this row's own on `abgelehnt`."""

    if zustand == "vorschlag":
        return vorschlag_offen

    antwort = spielbestaetigung_raw.get("antwort")
    if zustand == "abgelehnt" and isinstance(antwort, Mapping) and isinstance(antwort.get("vorschlag"), Mapping):
        return FLSpielbestaetigungTermin.model_validate(antwort["vorschlag"])

    return None


def compose_antwort_update(
    *,
    antwort: FLSpielbestaetigungAntwortArt,
    seat: FLKontaktRolle,
    vorschlag: FLSpielbestaetigungTermin | None,
    begruendung: str | None,
    today: str,
) -> dict[str, Any]:
    return {
        "$set": {
            "antwort": {
                "art": antwort,
                "am": today,
                "von": {"art": "kontakt", "rolle": seat},
                "vorschlag": None if vorschlag is None else {"datum": vorschlag.datum, "uhrzeit": vorschlag.uhrzeit},
                "begruendung": begruendung,
            }
        }
    }


# --- The pass: what its mint and its reminder write.


def compose_seat_entry(*, token_hash: str) -> dict[str, Any]:
    """One seat's entry as every mint writes it, on a fresh row and on a seat minted afresh on an open one.

    No delivery state: no report has yet named the message this link goes out in.
    """

    return {"token_hashes": [token_hash], "zustellung": None}


def frist_of(*, datum: str, today: str) -> str:
    """The deadline a row minted today is given: a fixture already inside the notice period is due today."""

    return max(today, days_after(day=datum, days=-SPIEL_BESTAETIGUNG_FRIST_TAGE))


def letzter_anfrage_tag(*, today: str) -> str:
    """The latest fixture day a pass run today asks about: the request goes out once its deadline is the answer window away."""

    return days_after(day=today, days=SPIEL_BESTAETIGUNG_FRIST_TAGE + SPIEL_ANFRAGE_VORLAUF_TAGE)


def build_anfrage_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's fixtures the mint may ask about; `anfrage_is_due` decides, this narrows the read."""

    return {
        "saison_id": saison_id,
        "datum": {"$gt": today, "$lte": letzter_anfrage_tag(today=today)},
        "uhrzeit": {"$ne": None},
        "ort": {"$ne": None},
        "team1": {"$ne": None},
        "team2": {"$ne": None},
        "ergebnis": None,
        "sonderereignis": None,
    }


def _side_id(spiel: Mapping[str, Any], side: str) -> Any:
    block = spiel.get(side)

    return block.get("team_id") if isinstance(block, Mapping) else None


def _referee_id(spiel: Mapping[str, Any]) -> Any:
    block = spiel.get("schiedsrichter")

    return block.get("schiedsrichter_id") if isinstance(block, Mapping) else None


def grund_to_close(*, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str]) -> FLSpielbestaetigungGrund | None:
    """Why this unclosed row stops applying to its fixture as it stands, or `None`; `austritte` maps clubs to exit days.

    The mint asks it of every row it would write, so the close shuts nothing the mint asked.
    """

    ansetzung = row["ansetzung"]
    clubs = (ansetzung["team1_id"], ansetzung["team2_id"])
    # First, ahead of a move, neither leaving a new Ansetzung to announce; on the fixture's day as it
    # stands, or the row's where the fixture lost its date.
    entschieden = entscheidung_of(
        spiel=spiel, austritte=[austritte[team_id] for team_id in clubs if team_id in austritte], tag=spiel.get("datum") or ansetzung["datum"]
    )
    if entschieden is not None:
        return entschieden

    partei = row["partei"]
    # Ahead of the move: a referee taken off the fixture is owed no notice that it moved.
    if partei["art"] == "schiedsrichter" and _referee_id(spiel) != partei.get("schiedsrichter_id"):
        return "schiedsrichter_gewechselt"

    if ansetzung_stand_of(spiel) != ansetzung["stand"]:
        return "ansetzung_geaendert"

    return None


def anfrage_is_due(*, spiel: Mapping[str, Any], austritte: Mapping[Any, str], today: str) -> bool:
    """Whether the mint asks about this fixture today: dated strictly after today, inside the answer window, fully set, undecided.

    The floor is a date because `has_taken_place` reads a record, so an unplayed fixture of the past reads as open.
    """

    datum = spiel.get("datum")
    asked = (
        isinstance(datum, str)
        and today < datum <= letzter_anfrage_tag(today=today)
        and spiel.get("uhrzeit") is not None
        and isinstance(spiel.get("ort"), Mapping)
        and _side_id(spiel, "team1") is not None
        and _side_id(spiel, "team2") is not None
        and spiel.get("ergebnis") is None
        and spiel.get("sonderereignis") is None
    )

    # Never a row the close would shut: a club gone by the fixture's day, or a lone goal count or
    # shoot-out, would otherwise be minted, closed and minted again, a fresh request every pass.
    return (
        asked
        and grund_to_close(row={"partei": {"art": "team"}, "ansetzung": compose_ansetzung(spiel)}, spiel=spiel, austritte=austritte) is None
    )


def parteien_of(spiel: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every party a fixture's Ansetzung asks: both sides, and its referee unless that is the ghost.

    The ghost holds no address, so a row for it would be minted and never mailed nor answered.
    """

    parteien: list[dict[str, Any]] = [{"art": "team", "team_id": _side_id(spiel, side)} for side in ("team1", "team2")]
    schiedsrichter_id = _referee_id(spiel)
    if schiedsrichter_id is not None and schiedsrichter_id != GHOST_SCHIEDSRICHTER_ID:
        parteien.append({"art": "schiedsrichter", "schiedsrichter_id": schiedsrichter_id})

    return parteien


def partei_key(partei: Mapping[str, Any]) -> tuple[str, Any]:
    """One party as the unique index tells parties apart."""

    return partei["art"], partei.get("team_id") if partei["art"] == "team" else partei.get("schiedsrichter_id")


def compose_spielbestaetigung(
    *,
    row_id: Any,
    saison_id: str,
    spiel: Mapping[str, Any],
    partei: Mapping[str, Any],
    hashes: Mapping[str, str],
    today: str,
) -> dict[str, Any]:
    """A row as the mint writes it, about the fixture's Ansetzung as it stands. A seat `hashes` leaves out holds no link."""

    return {
        "_id": row_id,
        "saison_id": saison_id,
        "spiel_id": spiel["_id"],
        "partei": dict(partei),
        "ansetzung": compose_ansetzung(spiel),
        "frist": frist_of(datum=spiel["datum"], today=today),
        "angefragt_am": None,
        "erinnert_am": [],
        # A referee answers signed in rather than by a link.
        "kontakte": (
            None
            if partei["art"] == "schiedsrichter"
            else {seat: compose_seat_entry(token_hash=hashes[seat]) if seat in hashes else None for seat in KONTAKT_ROLLEN}
        ),
        "antwort": None,
        "geschlossen": None,
    }


def kontakt_adresse(*, kontakte: Any, seat: str) -> str | None:
    """The address a seat's holder is reached at, or `None` where the seat is empty."""

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    email = str(slot.get("email") or "").strip() if isinstance(slot, Mapping) else ""

    return email or None


def link_groups(*, kontakte: Any, seats: Sequence[str]) -> list[list[FLKontaktRolle]]:
    """The seats as links: one per seat, a mirrored Trainer sharing the link of the seat it holds too where both are among `seats`.

    Two seats one press answers are one thing to do (`fl_frontend/src/features/bewerbungen/notifications.ts :: seatsByMailbox`).
    """

    zugleich = kontakte.get("trainer_ist_zugleich") if isinstance(kontakte, Mapping) else None
    groups: dict[str, list[FLKontaktRolle]] = {}
    for seat in seats:
        anchor = str(zugleich) if seat == "trainer" and zugleich in seats else seat
        groups.setdefault(anchor, []).append(cast(FLKontaktRolle, seat))

    return list(groups.values())


def erinnerung_tage(*, today: str) -> list[str]:
    """The deadlines a row is reminded of today, each reminder falling its count of days before the deadline."""

    return [days_after(day=today, days=tage) for tage in (SPIEL_ERINNERUNG_TAGE_ERSTE, SPIEL_ERINNERUNG_TAGE_ZWEITE)]


def build_erinnerung_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """The season's open team rows a reminder falls due on today and none has gone out for."""

    return {
        "saison_id": saison_id,
        "partei.art": "team",
        **build_answerable_filter(),
        "frist": {"$in": erinnerung_tage(today=today)},
        "erinnert_am": {"$ne": today},
    }


def compose_erinnerung_update(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    """The reminder's one update: each seat's fresh hash appended beside the ones already mailed, and the day.

    Appended, never replacing: every link a seat was mailed answers until the deadline.
    """

    pushed: dict[str, Any] = {
        f"kontakte.{seat}.token_hashes": {"$each": [token_hash], "$slice": -TOKEN_HASHES_PER_SEAT} for seat, token_hash in hashes.items()
    }

    return {"$push": {**pushed, "erinnert_am": today}}


def compose_seats_update(*, hashes: Mapping[str, str]) -> dict[str, Any]:
    """Each seat minted afresh on an open row: a seat a write voided, a seat newly occupied, a seat a ban kept until its lift."""

    return {"$set": {f"kontakte.{seat}": compose_seat_entry(token_hash=token_hash) for seat, token_hash in hashes.items()}}


def compose_closing_update(*, grund: FLSpielbestaetigungGrund, today: str) -> dict[str, Any]:
    return {"$set": {"geschlossen": {"am": today, "grund": grund}}}


# --- A seat write's void: the open rows' entries of every seat whose holder the write moves.


class SeatVoid(NamedTuple):
    """The seats one season row's write empties or hands on, keyed as its team's rows name it."""

    saison_id: Any
    team_id: Any
    seats: tuple[FLKontaktRolle, ...]


def kontakte_ohne(stored_kontakte: Any, seats: Sequence[str]) -> Any:
    """The block a write emptying these seats leaves: what a Widerspruch or an erasure hands `seat_void_of`."""

    if not isinstance(stored_kontakte, Mapping):
        return stored_kontakte

    return {**stored_kontakte, **dict.fromkeys(seats)}


def seat_void_of(*, saison_id: Any, team_id: Any, stored_kontakte: Any, kontakte: Any) -> SeatVoid | None:
    """What one season row's write voids, read off the block it replaced and the block it leaves; `None` where it moves no holder."""

    moved = set(seats_changing_holder(stored=stored_kontakte, kontakte=kontakte))
    if not moved:
        return None

    # Every seat the write leaves empty too, whose entry is null already wherever no write slipped past the void: so
    # every whole-block clear nulls one seat set, and a call clearing many rows writes once.
    block = kontakte if isinstance(kontakte, Mapping) else {}
    seats: tuple[FLKontaktRolle, ...] = tuple(seat for seat in KONTAKT_ROLLEN if seat in moved or not isinstance(block.get(seat), Mapping))

    return SeatVoid(saison_id=saison_id, team_id=team_id, seats=seats)


def _team_rows(saison_id: Any, team_id: Any) -> dict[str, Any]:
    return {"saison_id": saison_id, "partei.team_id": team_id}


def build_open_team_rows_filter(pairs: Sequence[tuple[Any, Any]]) -> dict[str, Any]:
    """These teams' rows in these seasons that are still answerable, so an answered row keeps its answer and its links."""

    return {"partei.art": "team", **build_answerable_filter(), "$or": [_team_rows(saison_id, team_id) for saison_id, team_id in pairs]}


def build_open_seat_rows_pipeline(voids: Sequence[SeatVoid]) -> list[Mapping[str, Any]]:
    """Per team and season, which seats hold an entry on any open row: one document per row written, so one batch answers it."""

    return [
        {"$match": build_open_team_rows_filter([(void.saison_id, void.team_id) for void in voids])},
        {
            "$group": {
                "_id": {"saison_id": "$saison_id", "team_id": "$partei.team_id"},
                # An object sorts above null, so only a standing entry counts.
                **{seat: {"$max": {"$gt": [f"$kontakte.{seat}", None]}} for seat in KONTAKT_ROLLEN},
            }
        },
    ]


def group_seat_voids(
    *, voids: Sequence[SeatVoid], held: Sequence[Mapping[str, Any]]
) -> list[tuple[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]]]:
    """The teams whose open rows hold an entry of a seat their write moved, grouped by the seats to null.

    One write per group rather than per row, so a call costs the same however many rows it voids.
    """

    seats_of: dict[tuple[Any, Any], set[str]] = {}
    for void in voids:
        seats_of.setdefault((void.saison_id, void.team_id), set()).update(void.seats)

    groups: dict[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]] = {}
    for team in held:
        pair = (team["_id"]["saison_id"], team["_id"]["team_id"])
        seats = seats_of.get(pair, set())
        # A team whose rows hold none of them is not written: the update would change nothing and still file a log row.
        if any(team.get(seat) is True for seat in seats):
            groups.setdefault(tuple(seat for seat in KONTAKT_ROLLEN if seat in seats), []).append(pair)

    return list(groups.items())


# --- A CONTACT PERSON'S ERASURE: the reason a seat they hold gave on their team's confirmations.


class TeamSeats(NamedTuple):
    """The seats one person held on one team's season row, keyed as that team's confirmations name it."""

    saison_id: Any
    team_id: Any
    seats: Sequence[str]


def build_contact_reasons_filter(held: Sequence[TeamSeats]) -> dict[str, Any]:
    """Every row of these teams answered from one of these seats with a reason, closed since or not."""

    return {
        "partei.art": "team",
        "antwort.von.art": "kontakt",
        "antwort.begruendung": {"$ne": None},
        "$or": [{**_team_rows(team.saison_id, team.team_id), "antwort.von.rolle": {"$in": list(team.seats)}} for team in held],
    }


def build_contact_reason_images_filter(held: Sequence[TeamSeats]) -> dict[str, Any]:
    """Log rows whose image may hold such a reason; `contact_reason_image_edits` decides, an image at a time."""

    return {
        "collection": str(Collection.SPIELBESTAETIGUNGEN),
        "before.antwort.von.art": "kontakt",
        "$or": [{"before.saison_id": team.saison_id, "before.partei.team_id": team.team_id} for team in held],
    }


def contact_reason_image_edits(image: Mapping[str, Any], held: Sequence[TeamSeats]) -> dict[str, Any]:
    """One image's reason nulled where one of these seats gave it for its team; its answer, day and role stay."""

    partei, antwort = image.get("partei"), image.get("antwort")
    if not isinstance(partei, Mapping) or not isinstance(antwort, Mapping) or antwort.get("begruendung") is None:
        return {}

    von = antwort.get("von")
    given = (image.get("saison_id"), partei.get("team_id"), von.get("rolle") if isinstance(von, Mapping) else None)
    if (
        isinstance(von, Mapping)
        and von.get("art") == "kontakt"
        and any(given == (t.saison_id, t.team_id, seat) for t in held for seat in t.seats)
    ):
        return {"antwort.begruendung": None}

    return {}


# --- The REFEREE'S ERASURE: which rows and log images name the person, and what each image becomes.


def build_referee_rows_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every row whose party is one of these referees, open, answered or closed."""

    return {"partei.art": "schiedsrichter", "partei.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def build_referee_images_filter(schiedsrichter_ids: Sequence[Any]) -> Mapping[str, Any]:
    """Every `spielbestaetigungen` log row whose image names one of these referees as its party.

    Selected inside the image, as `app/api/schiedsrichter/services.py :: build_booked_image_filter` selects: an undraw's
    `delete_many` row holds images of rows long gone, which no id standing now reaches.
    """

    return {"collection": str(Collection.SPIELBESTAETIGUNGEN), "before.partei.schiedsrichter_id": {"$in": list(schiedsrichter_ids)}}


def referee_image_edits(image: Mapping[str, Any], schiedsrichter_ids: Sequence[Any]) -> dict[str, Any]:
    """One image naming one of these referees, its party repointed at the ghost and their reason nulled.

    The Ansetzung, the deadline and which way the answer went stay: they name nobody once the party is the ghost.
    """

    partei = image.get("partei")
    if not isinstance(partei, Mapping) or partei.get("art") != "schiedsrichter" or partei.get("schiedsrichter_id") not in schiedsrichter_ids:
        return {}

    edits: dict[str, Any] = {"partei.schiedsrichter_id": GHOST_SCHIEDSRICHTER_ID}
    if isinstance(image.get("antwort"), Mapping):
        edits["antwort.begruendung"] = None

    return edits
