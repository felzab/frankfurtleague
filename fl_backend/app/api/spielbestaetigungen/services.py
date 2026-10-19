import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Final

from app.api.bewerbungen.services import seat_named
from app.api.identitaet.services import holds_a_name, namen_aus
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtAnsetzung,
    FLSpielbestaetigungAntwortArt,
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
from app.api.teams.services import has_taken_place
from app.core.exceptions import WriteRefusal

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
    """A result, any `sonderereignis`, or a club out of the season on or before the fixture's day: the sweep's three closes.

    Any `sonderereignis`, not only those `has_taken_place` counts: a called-off fixture is asked afresh once reinstated.
    """

    if has_taken_place(lage.spiel) or lage.spiel.get("sonderereignis") is not None:
        return True

    datum = lage.spiel.get("datum")
    austritte = [(row.get("austritt") or {}).get("datum") for row in lage.vereine]

    return datum is not None and any(austritt is not None and austritt <= datum for austritt in austritte)


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
