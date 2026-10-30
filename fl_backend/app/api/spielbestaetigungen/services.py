import hashlib
import hmac
from collections.abc import Iterable, Mapping, Sequence, Set
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Final, NamedTuple, cast

from pydantic import SecretStr

from app.api.bewerbungen.services import days_after, seat_named
from app.api.spielbestaetigungen.schemas import (
    FLSpielbestaetigungAnsichtAnsetzung,
    FLSpielbestaetigungAntwortArt,
    FLSpielbestaetigungGrund,
    FLSpielbestaetigungSchiedsrichterZustand,
    FLSpielbestaetigungTermin,
    FLSpielbestaetigungZustand,
)
from app.api.spiele.schemas import (
    SONDEREREIGNIS_CALLING_OFF_BEFORE_ITS_DAY,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielOrtFieldPayload,
    FLSpielOrtFieldPublic,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielTeamFieldPayload,
)
from app.api.teams.services import has_taken_place, seats_changing_holder
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import WriteRefusal
from app.core.sentinels import GHOST_SCHIEDSRICHTER_ID
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import (
    SPIEL_ANFRAGE_VORLAUF_TAGE,
    SPIEL_BESTAETIGUNG_FRIST_TAGE,
    SPIEL_ERINNERUNG_TAGE_ERSTE,
    SPIEL_ERINNERUNG_TAGE_ZWEITE,
)
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLKontaktRolle, FLSpielSeite
from app.shared.sub_keys import derive_sub_key

# Each stored `ansetzung` key and its fixture path: the ONE list the digest, the snapshot and the public
# verdict's `$lookup` read, a key one lacks giving two answers to which Ansetzung a row is about.
ANSETZUNG_QUELLEN: Final[Mapping[str, str]] = {
    "datum": "datum",
    "uhrzeit": "uhrzeit",
    "spielort_id": "ort.spielort_id",
    "team1_id": "team1.team_id",
    "team2_id": "team2.team_id",
}


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

    Repeated on the write after the read's judgement; a rival answer committing between them conflicts, and the retry
    judges.
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


# --- The LINK's view and answer.


# A row closed, or due to close, for one of these is about an Ansetzung the fixture has left, which the
# page tells apart from a deadline that ran out.
GRUENDE_UNGUELTIG: Final = frozenset({"ansetzung_geaendert", "schiedsrichter_gewechselt"})

# An INCLUSION: of a row's links the hashes alone, which resolve the seat and never leave the handler; of its answer
# which way it went and the role, never the reason, the proposal or the holder digest.
LINK_FIELDS: Mapping[str, int] = {
    "saison_id": 1,
    "spiel_id": 1,
    "partei": 1,
    "ansetzung": 1,
    "frist": 1,
    "antwort.art": 1,
    "antwort.von.art": 1,
    "antwort.von.rolle": 1,
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

    return kontakt_adresse(kontakte=(verein or {}).get("kontakte"), seat=seat)


def _grund_now(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage, today: str) -> FLSpielbestaetigungGrund | None:
    """Why the pass's next close would shut this row, read off its own judge: a link never shows or refuses otherwise than it records."""

    austritte = {row.get("team_id"): str(datum) for row in lage.vereine if (datum := (row.get("austritt") or {}).get("datum")) is not None}

    return grund_to_end(row=spielbestaetigung_raw, spiel=lage.spiel, austritte=austritte, today=today)


def _past_frist(*, spielbestaetigung_raw: Mapping[str, Any], today: str) -> bool:
    # Never a referee's row: the Einteilung names no deadline, so a referee answers until the day goes by, which
    # `grund_to_close` judges.
    if spielbestaetigung_raw["partei"]["art"] == "schiedsrichter":
        return False

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

    # Closed, by the reason stored; open or a discard still holding its question, by the one the close would store.
    grund = (
        geschlossen["grund"]
        if isinstance(geschlossen, Mapping) and geschlossen["grund"] not in GRUENDE_ANSWERED_FOR_THE_STAND
        else _grund_now(spielbestaetigung_raw=spielbestaetigung_raw, lage=lage, today=today)
    )

    # Ahead of the answer: an answer about an Ansetzung the fixture has left settles nothing, and the move's notice
    # told every seat its link is void, so no seat reopening it may be told nothing is owed.
    if grund in GRUENDE_UNGUELTIG:
        return "ungueltig"

    # Ahead of the answer too: an agreement to a fixture called off since would send its party to the ground.
    if grund == "abgesagt":
        return "abgesagt"

    # Ahead of the answer as well, which would read as a decision still to come: the league kept the date. Never once the
    # fixture moved, the date it kept gone with the move.
    if (
        grund is None
        and isinstance(geschlossen, Mapping)
        and geschlossen["grund"] in GRUENDE_ANSWERED_FOR_THE_STAND
        and not stand_moved(spielbestaetigung_raw=spielbestaetigung_raw, lage=lage)
    ):
        return "verworfen"

    if isinstance(antwort, Mapping):
        return "zugesagt" if antwort["art"] == "zugesagt" else "abgelehnt"

    if grund is not None or _past_frist(spielbestaetigung_raw=spielbestaetigung_raw, today=today):
        return "abgelaufen"

    return "gueltig" if vorschlag_offen is None else "vorschlag"


def find_unknown_link_refusal(*, seat: FLKontaktRolle | None) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-001`: ONE answer for a guess and a voided link, which a stranger's guess must not tell apart."""

    if seat is not None:
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_TOKEN_UNKNOWN,
        status=HTTPStatus.NOT_FOUND,
    )


def find_gesperrt_link_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-011`: asked at the press, however old the link, ahead of every state of its row."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
    )


def first_press_refusal() -> WriteRefusal:
    """`REQ-ANSETZUNG-002`, built here alone: by the spent-link judgement and by the answer whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_BEANTWORTET,
        status=HTTPStatus.GONE,
    )


def ansetzung_verlassen_refusal() -> WriteRefusal:
    """`REQ-ANSETZUNG-004`, built here alone: by the spent-link judgement and by a referee's decline whose fixture write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_GEAENDERT,
        status=HTTPStatus.GONE,
    )


def find_spent_link_refusal(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage, today: str) -> WriteRefusal | None:
    """Why this row takes no answer now, or `None`: answered, closed unanswered, what the close would shut it for, then the deadline.

    An answered row whose Ansetzung moved answers `-002` and reads `ungueltig`: the page re-reads the view on `-002`.
    """

    if spielbestaetigung_raw.get("antwort") is not None:
        return first_press_refusal()

    if spielbestaetigung_raw.get("geschlossen") is not None:
        return WriteRefusal(
            error_code=Code.ANSETZUNG_GESCHLOSSEN,
            status=HTTPStatus.GONE,
        )

    grund = _grund_now(spielbestaetigung_raw=spielbestaetigung_raw, lage=lage, today=today)

    if grund in GRUENDE_UNGUELTIG:
        return ansetzung_verlassen_refusal()

    # A day gone by unplayed is a deadline gone by too, the deadline lying before the day: late rather than decided.
    if grund is not None and grund != "spiel_vergangen":
        return WriteRefusal(
            error_code=Code.ANSETZUNG_ENTSCHIEDEN,
            status=HTTPStatus.GONE,
        )

    if grund is not None:
        return WriteRefusal(
            error_code=Code.ANSETZUNG_FRIST_VORBEI,
            status=HTTPStatus.GONE,
        )

    if _past_frist(spielbestaetigung_raw=spielbestaetigung_raw, today=today):
        return WriteRefusal(
            error_code=Code.ANSETZUNG_FRIST_VORBEI,
            status=HTTPStatus.GONE,
        )

    return None


def find_vorschlag_vergangen_refusal(*, vorschlag: FLSpielbestaetigungTermin, today: str) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-007`: a proposal names a day still to come or today."""

    if vorschlag.datum >= today:
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_VORSCHLAG_VERGANGEN,
        status=HTTPStatus.UNPROCESSABLE_CONTENT,
        # The date box the form holds the proposal in, so it is marked where the reader typed the day.
        fields=(("vorschlag", "datum"),),
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
        schiedsrichter_stand=None if stored.schiedsrichter is None else stored.schiedsrichter.schiedsrichter_id,
    )


def seite_of(spielbestaetigung_raw: Mapping[str, Any]) -> FLSpielSeite:
    """Off the stored snapshot, so a side the fixture has since lost still names the reader's club."""

    team_id = (spielbestaetigung_raw.get("partei") or {}).get("team_id")

    return "team1" if team_id == spielbestaetigung_raw["ansetzung"]["team1_id"] else "team2"


def stand_moved(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage) -> bool:
    return ansetzung_stand_of(lage.spiel) != spielbestaetigung_raw["ansetzung"]["stand"]


def ansicht_ansetzung_of(spiel: Mapping[str, Any]) -> FLSpielbestaetigungAnsichtAnsetzung:
    """The fixture as it stands, for a row about that very Ansetzung: every value is the fixture's, none filled in from a row."""

    # Absent rather than null where a projection met a fixture without a ground.
    ort = spiel.get("ort")

    return FLSpielbestaetigungAnsichtAnsetzung(
        team1_name=spiel["team1"]["name"],
        team2_name=spiel["team2"]["name"],
        datum=spiel["datum"],
        uhrzeit=spiel["uhrzeit"],
        spielort=None
        if not isinstance(ort, Mapping)
        else FLSpielOrtFieldPublic(spielort_id=ort["spielort_id"], name=ort["name"], maps_link=ort["maps_link"]),
    )


def vereinsnamen_of(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage) -> tuple[str, str]:
    """The clubs a notice about a moved row names: each side as the fixture fields it now, a side it lost by its season row."""

    snapshot = spielbestaetigung_raw["ansetzung"]
    namen = {row.get("team_id"): row.get("name") for row in lage.vereine}

    def side_name(slot: str, snapshot_key: str) -> str:
        side = lage.spiel.get(slot)
        return str(side["name"]) if isinstance(side, Mapping) else str(namen.get(snapshot[snapshot_key]) or "")

    return side_name("team1", "team1_id"), side_name("team2", "team2_id")


def clubs_without_a_season_row(*, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage) -> list[Any]:
    """The row's clubs no season row names: one replaced since, whose row went to the incoming club with its name."""

    snapshot = spielbestaetigung_raw["ansetzung"]
    seated = {row.get("team_id") for row in lage.vereine}

    return [team_id for team_id in (snapshot["team1_id"], snapshot["team2_id"]) if team_id not in seated]


def ansicht_snapshot_of(
    *,
    spielbestaetigung_raw: Mapping[str, Any],
    lage: AnsetzungLage,
    # A club replaced since, by the name its `teams` document holds.
    vereinsnamen: Mapping[Any, str],
    spielort: FLSpielOrtFieldPublic | None,
) -> FLSpielbestaetigungAnsichtAnsetzung:
    """The Ansetzung a row whose stand moved was about, whole: its clubs by their season names and `spielort`, its ground read now."""

    snapshot = spielbestaetigung_raw["ansetzung"]
    # Empty only for a club no document names at all, a dangling id a replacement exists to repair.
    namen = {**vereinsnamen, **{row.get("team_id"): str(row.get("name") or "") for row in lage.vereine}}

    return FLSpielbestaetigungAnsichtAnsetzung(
        team1_name=namen.get(snapshot["team1_id"], ""),
        team2_name=namen.get(snapshot["team2_id"], ""),
        datum=snapshot["datum"],
        uhrzeit=snapshot["uhrzeit"],
        spielort=spielort,
    )


# Its own label under the `sperrliste_schluessel` master, beside the ban list's, the log's, the journal's and the anchors'
# (`app/core/adressanker.py :: ADRESSANKER_VERSION`): under theirs a holder would equal one of their digests.
HALTER_VERSION: Final = "halter-v1"


def halter_of(address: str, *, schluessel: SecretStr) -> str:
    """The answering seat's holder, as the person's erasure finds the reasons they typed from any seat.

    KEYED, an address being a dictionary word; over the fold `app/api/teams/services.py :: seats_changing_holder` tells holders apart by.
    """

    return hmac.new(derive_sub_key(schluessel, HALTER_VERSION), sign_in_identifier(address).encode("utf-8"), hashlib.sha256).hexdigest()


def compose_antwort_update(
    *,
    antwort: FLSpielbestaetigungAntwortArt,
    seat: FLKontaktRolle,
    adresse: str | None,
    schluessel: SecretStr,
    vorschlag: FLSpielbestaetigungTermin | None,
    begruendung: str | None,
    today: str,
) -> dict[str, Any]:
    return {
        "$set": {
            "antwort": {
                "art": antwort,
                "am": today,
                # Never served (`tests/core/test_constraints.py :: STORED_BUT_NOT_SERVED`).
                "von": {"art": "kontakt", "rolle": seat, "halter": None if adresse is None else halter_of(adresse, schluessel=schluessel)},
                "vorschlag": None if vorschlag is None else {"datum": vorschlag.datum, "uhrzeit": vorschlag.uhrzeit},
                "begruendung": begruendung,
            }
        }
    }


# --- The ADMINISTRATOR's settle and discard. Each check judges the row read in-session and its write's filter
# says the same again; a party's answer committing between the two conflicts with the write, whose retry refuses.


# Exactly what the season-wide read serves: every stored field but the hashes and the holder
# (`tests/core/test_constraints.py :: STORED_BUT_NOT_SERVED`), kept off the wire from the driver up.
ADMIN_FIELDS: Mapping[str, int] = {**{f"kontakte.{seat}.token_hashes": 0 for seat in KONTAKT_ROLLEN}, "antwort.von.halter": 0}


def eintragen_refusal() -> WriteRefusal:
    """`REQ-ANSETZUNG-013`, built here alone: by the check on the row read and by the settle whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_NICHT_EINTRAGBAR,
        status=HTTPStatus.CONFLICT,
    )


def find_eintragen_refusal(*, spielbestaetigung_raw: Mapping[str, Any]) -> WriteRefusal | None:
    """The administrator answers only a row neither answered nor closed, as a seat's press does."""

    if spielbestaetigung_raw.get("antwort") is None and spielbestaetigung_raw.get("geschlossen") is None:
        return None

    return eintragen_refusal()


def compose_eintragen_update(*, begruendung: str, today: str) -> dict[str, Any]:
    """A Zusage recorded for the party, naming nobody: no role and no holder, so no person's erasure ever reaches its reason."""

    return {"$set": {"antwort": {"art": "zugesagt", "am": today, "von": {"art": "admin"}, "vorschlag": None, "begruendung": begruendung}}}


def build_verwerfbar_filter() -> dict[str, Any]:
    """An open team decline carrying a proposal: the one row a discard closes, and the triage's `vorschlag_offen`.

    Any other row closed `verworfen` would silence its party for the Ansetzung.
    """

    return {"partei.art": "team", "antwort.art": "abgelehnt", "antwort.vorschlag": {"$ne": None}, **build_closable_filter()}


def verwerfen_refusal() -> WriteRefusal:
    """`REQ-ANSETZUNG-014`, built here alone: by the check on the row read and by the discard whose filtered write matched nothing."""

    return WriteRefusal(
        error_code=Code.ANSETZUNG_NICHT_VERWERFBAR,
        status=HTTPStatus.CONFLICT,
    )


def build_triage_rows_filter(*, saison_id: str, today: str) -> dict[str, Any]:
    """This season's team rows putting their fixture in the administrator's queue.

    A standing proposal, a deadline passed unanswered, or due today and asked today or never: `angefragt_am` stands in
    for the mint day no row stores.
    """

    offen = {"partei.art": "team", **build_answerable_filter()}

    return {
        "saison_id": saison_id,
        "$or": [
            build_verwerfbar_filter(),
            {**offen, "frist": {"$lt": today}},
            {**offen, "frist": today, "angefragt_am": {"$in": [None, today]}},
        ],
    }


def find_verwerfen_refusal(*, spielbestaetigung_raw: Mapping[str, Any], spiel: Mapping[str, Any]) -> WriteRefusal | None:
    """`build_verwerfbar_filter` asked of the row read, and the row about the fixture as it stands."""

    partei, antwort = spielbestaetigung_raw.get("partei") or {}, spielbestaetigung_raw.get("antwort") or {}
    if (
        partei.get("art") == "team"
        and antwort.get("art") == "abgelehnt"
        and antwort.get("vorschlag") is not None
        and spielbestaetigung_raw.get("geschlossen") is None
        and ansetzung_stand_of(spiel) == spielbestaetigung_raw["ansetzung"]["stand"]
    ):
        return None

    return verwerfen_refusal()


# --- A REFEREE'S OWN ROWS: the panel's read and the referee's answer, signed in rather than by a link.


# The close a referee's own decline writes in its transaction: outside `GRUENDE_UNGUELTIG`, so the row reads as
# their decline, and outside `GRUENDE_ANSWERED_FOR_THE_STAND`, so a re-booking is asked afresh.
GRUND_EIGENE_ABSAGE: Final = "schiedsrichter_abgelehnt"


def find_fremde_zeile_refusal(*, spielbestaetigung_raw: Mapping[str, Any] | None, schiedsrichter_ids: Iterable[Any]) -> WriteRefusal | None:
    """`REQ-ANSETZUNG-015`: ONE answer for an id naming no row and a row naming somebody else, so no id is confirmed to exist."""

    partei = (spielbestaetigung_raw or {}).get("partei") or {}
    if partei.get("art") == "schiedsrichter" and partei.get("schiedsrichter_id") in set(schiedsrichter_ids):
        return None

    return WriteRefusal(
        error_code=Code.ANSETZUNG_FREMDE_ZEILE,
        status=HTTPStatus.FORBIDDEN,
    )


def compose_schiedsrichter_antwort_update(*, antwort: FLSpielbestaetigungAntwortArt, begruendung: str | None, today: str) -> dict[str, Any]:
    """A decline closes its own row in the write emptying the referee's slot: left open, it would hold a re-booking of them unasked."""

    gesetzt: dict[str, Any] = {
        # No holder digest: that is a seat's, and a referee answers as the person their record names.
        "antwort": {"art": antwort, "am": today, "von": {"art": "schiedsrichter"}, "vorschlag": None, "begruendung": begruendung}
    }
    if antwort == "abgelehnt":
        gesetzt.update(compose_closing_update(grund=GRUND_EIGENE_ABSAGE, today=today)["$set"])

    return {"$set": gesetzt}


def build_eigene_zeilen_filter(*, saison_ids: Sequence[str], schiedsrichter_ids: Sequence[Any]) -> dict[str, Any]:
    """These referees' rows in these seasons, open, answered or closed, walked through the referee-leading index.

    The season-leading one would walk every fixture's rows of the season
    (`tests/api/test_spielbestaetigung_execution.py :: TestARefereesOwnRowsAreReadThroughTheirIndex`).
    """

    return {"saison_id": {"$in": list(saison_ids)}, **build_referee_rows_filter(schiedsrichter_ids)}


def build_current_rows_pipeline(
    *, saison_ids: Sequence[str], schiedsrichter_ids: Sequence[Any], projection: Mapping[str, int]
) -> list[dict[str, Any]]:
    """Each fixture's newest row alone, by `_id`, which the pass mints in order.

    Chosen inside the read, so a cap on it counts the fixtures the panel shows, never a fixture's history.
    """

    return [
        {"$match": build_eigene_zeilen_filter(saison_ids=saison_ids, schiedsrichter_ids=schiedsrichter_ids)},
        {"$project": dict(projection)},
        {"$sort": {"_id": -1}},
        {"$group": {"_id": "$spiel_id", "row": {"$first": "$$ROOT"}}},
        {"$replaceWith": "$row"},
    ]


def schiedsrichter_zustand_of(
    *, spielbestaetigung_raw: Mapping[str, Any], lage: AnsetzungLage, today: str
) -> FLSpielbestaetigungSchiedsrichterZustand:
    """What the panel shows of a referee's own row: the link's state, which no ban and no proposal reaches here."""

    zustand = zustand_of(spielbestaetigung_raw=spielbestaetigung_raw, lage=lage, today=today, gesperrt=False, vorschlag_offen=None)
    assert zustand != "gesperrt" and zustand != "vorschlag" and zustand != "verworfen"

    return zustand


def eingetragen_of(spielbestaetigung_raw: Mapping[str, Any]) -> bool:
    """Whether an administrator recorded this row's answer, which `compose_eintragen_update` stores as `von: {art: "admin"}`."""

    return bool(((spielbestaetigung_raw.get("antwort") or {}).get("von") or {}).get("art") == "admin")


def eigene_begruendung_of(spielbestaetigung_raw: Mapping[str, Any]) -> str | None:
    """The reason on the referee's own decline alone: an administrator's entry on their row is the league's record, not theirs to read."""

    antwort = spielbestaetigung_raw.get("antwort") or {}

    return antwort.get("begruendung") if (antwort.get("von") or {}).get("art") == "schiedsrichter" else None


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


# A closing that settles the party's one answer about its Ansetzung rather than ending the question: a second answer
# needs a new stand, which only a move mints.
GRUENDE_ANSWERED_FOR_THE_STAND: Final = frozenset({"verworfen"})

# What ends a discard as it ends an agreement beside it: every reason of `grund_to_close` but a move, which leaves the
# discard its club's answer to the Ansetzung left, and a referee change, never a club's.
GRUENDE_ENDING_AN_ANSWER: Final = frozenset({"austritt", "spiel_entschieden", "abgesagt", "spiel_vergangen"})


def build_holding_filter() -> dict[str, Any]:
    """A row holding its party's question about its Ansetzung: unclosed, or closed as answered.

    Every other closing ends the question, so a fixture reinstated or moved back to its old slot is asked afresh.
    """

    return {"$or": [build_closable_filter(), {"geschlossen.grund": {"$in": sorted(GRUENDE_ANSWERED_FOR_THE_STAND)}}]}


def build_held_filter(*, saison_id: str, spiel_ids: Sequence[Any]) -> dict[str, Any]:
    """These fixtures' rows holding their party's question about their Ansetzung."""

    return {"saison_id": saison_id, "spiel_id": {"$in": list(spiel_ids)}, **build_holding_filter()}


def build_void_notice_held_filter(*, saison_id: str, spiel_ids: Sequence[Any]) -> dict[str, Any]:
    """These fixtures' rows a move closed whose notice is still held: their party not yet told their link is void."""

    return {
        "saison_id": saison_id,
        "spiel_id": {"$in": list(spiel_ids)},
        "geschlossen.grund": "ansetzung_geaendert",
        "geschlossen.mitteilung": {"$ne": None},
    }


def void_notice_held(row: Mapping[str, Any]) -> bool:
    """`build_void_notice_held_filter` judged of a row read: a move's closing whose notice no `/mitgeteilt` has stamped."""

    geschlossen = row.get("geschlossen") or {}

    return geschlossen.get("grund") == "ansetzung_geaendert" and geschlossen.get("mitteilung") is not None


def _side_id(spiel: Mapping[str, Any], side: str) -> Any:
    block = spiel.get(side)

    return block.get("team_id") if isinstance(block, Mapping) else None


def _referee_id(spiel: Mapping[str, Any]) -> Any:
    block = spiel.get("schiedsrichter")

    return block.get("schiedsrichter_id") if isinstance(block, Mapping) else None


def grund_to_close(
    *, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str], today: str
) -> FLSpielbestaetigungGrund | None:
    """Why this unclosed row stops applying to its fixture as it stands, or `None`; `austritte` maps clubs to exit days.

    The mint asks it of every row it would write, so the close shuts nothing the mint asked.
    """

    ansetzung = row["ansetzung"]
    clubs = (ansetzung["team1_id"], ansetzung["team2_id"])
    # First, ahead of a move, neither leaving a new Ansetzung to announce; on the fixture's day as it
    # stands, or the row's where the fixture lost its date.
    tag = spiel.get("datum") or ansetzung["datum"]
    # Ahead of the decision a no-show records: entered before the day, nobody is due at the ground, so its
    # parties are told and shown a call-off.
    if today < tag and spiel.get("sonderereignis") in SONDEREREIGNIS_CALLING_OFF_BEFORE_ITS_DAY:
        return "abgesagt"

    entschieden = entscheidung_of(spiel=spiel, austritte=[austritte[team_id] for team_id in clubs if team_id in austritte], tag=tag)
    if entschieden is not None:
        return entschieden

    partei = row["partei"]
    # Ahead of the move: a referee taken off the fixture is owed no notice that it moved.
    if partei["art"] == "schiedsrichter" and _referee_id(spiel) != partei.get("schiedsrichter_id"):
        return "schiedsrichter_gewechselt"

    if ansetzung_stand_of(spiel) != ansetzung["stand"]:
        return "ansetzung_geaendert"

    # Last, so a move to or from a past day is still announced. Kept open, a row whose
    # day went by unplayed would ask about a past date for good, heading the close's oldest-first page.
    if _day_passed(ansetzung=ansetzung, today=today):
        return "spiel_vergangen"

    return None


def _day_passed(*, ansetzung: Mapping[str, Any], today: str) -> bool:
    return bool(ansetzung["datum"] < today)


def grund_to_end(
    *, row: Mapping[str, Any], spiel: Mapping[str, Any], austritte: Mapping[Any, str], today: str
) -> FLSpielbestaetigungGrund | None:
    """Why the pass's close shuts a row holding its party's question, or `None`."""

    grund = grund_to_close(row=row, spiel=spiel, austritte=austritte, today=today)
    if row.get("geschlossen") is None or grund in GRUENDE_ENDING_AN_ANSWER:
        return grund

    # Its own day, though the fixture moved: kept, a discard about an Ansetzung left would fill every pass's page.
    return "spiel_vergangen" if _day_passed(ansetzung=row["ansetzung"], today=today) else None


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
        and grund_to_close(
            row={"partei": {"art": "team"}, "ansetzung": compose_ansetzung(spiel)}, spiel=spiel, austritte=austritte, today=today
        )
        is None
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
    """The address a seat's holder is mailed at, banned on and recorded under, or `None` where the seat is empty.

    Unstripped: every seat payload stores `league_address`'s trimmed form, so a reader trimming would change nothing a write leaves.
    """

    slot = kontakte.get(seat) if isinstance(kontakte, Mapping) else None
    email = slot.get("email") if isinstance(slot, Mapping) else None

    return email if isinstance(email, str) and email else None


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


def build_erinnerung_filter(*, saison_id: str, today: str, inserted: Sequence[Any]) -> dict[str, Any]:
    """The season's open rows owed a message: a team row's reminder due today, or an unstamped request still answerable.

    Never a row this pass inserted, nor reminded on its request's day.
    """

    return {
        "saison_id": saison_id,
        **build_answerable_filter(),
        "_id": {"$nin": list(inserted)},
        "$or": [
            {"angefragt_am": None, "partei.art": "team", "frist": {"$gte": today}},
            {"angefragt_am": None, "partei.art": "schiedsrichter", "ansetzung.datum": {"$gte": today}},
            {
                "partei.art": "team",
                "frist": {"$in": erinnerung_tage(today=today)},
                "erinnert_am": {"$ne": today},
                "angefragt_am": {"$ne": today},
            },
        ],
    }


def compose_erinnerung_update(*, hashes: Mapping[str, str], today: str, erinnert: bool) -> dict[str, Any]:
    """Each seat's fresh hash appended beside the ones already mailed, and with `erinnert` the day a reminder went.

    Never capped: a request asked again while its stamp is lost mailed a link too.
    """

    pushed: dict[str, Any] = {f"kontakte.{seat}.token_hashes": token_hash for seat, token_hash in hashes.items()}

    return {"$push": {**pushed, "erinnert_am": today} if erinnert else pushed}


def compose_seats_update(*, hashes: Mapping[str, str]) -> dict[str, Any]:
    """Each seat minted afresh on an open row: a seat a write voided, a seat newly occupied, a seat a ban kept until its lift."""

    return {"$set": {f"kontakte.{seat}": compose_seat_entry(token_hash=token_hash) for seat, token_hash in hashes.items()}}


def compose_closing_update(*, grund: FLSpielbestaetigungGrund, today: str, mitteilung: bool = False) -> dict[str, Any]:
    """The closing, holding the notice it owes its party where `mitteilung`."""

    geschlossen: dict[str, Any] = {"am": today, "grund": grund}
    if mitteilung:
        geschlossen["mitteilung"] = {"versuche": 0}

    return {"$set": {"geschlossen": geschlossen}}


# --- The NOTICES a close owes, each held on its closed row until a pass that answered it is told it went.

# The passes that hand a notice out before the next gives it up, the grants' outbox's figure
# (`app/api/berechtigungen/services.py :: VERSUCHE_HOECHSTENS`): at the hourly pass, a day of answers none stamped.
MITTEILUNG_VERSUCHE_HOECHSTENS: Final = 24


GRUENDE_OWING_A_NOTICE: Final = frozenset({"ansetzung_geaendert", "schiedsrichter_gewechselt", "abgesagt"})


def _notice_to_come(*, row: Mapping[str, Any], grund: Any, spiel: Mapping[str, Any], today: str) -> bool:
    """Whether a notice is about a day still to come.

    A move's is about the slot left, now void, and the fixture's slot, which a fresh request asks: either day keeps it.
    """

    tage = [row["ansetzung"]["datum"]]
    if grund == "ansetzung_geaendert" and isinstance(spiel.get("datum"), str):
        tage.append(spiel["datum"])

    return any(tag >= today for tag in tage)


def notice_owed(*, row: Mapping[str, Any], grund: FLSpielbestaetigungGrund, spiel: Mapping[str, Any], today: str) -> bool:
    """Whether closing this row for `grund` owes its party a notice.

    Only once mailed and about a day to come: owed and given up at once, it would send the administrator to tell by hand.
    """

    return (
        row.get("angefragt_am") is not None
        and grund in GRUENDE_OWING_A_NOTICE
        and _notice_to_come(row=row, grund=grund, spiel=spiel, today=today)
    )


def verwerfen_owes_a_notice(*, row: Mapping[str, Any], today: str) -> bool:
    """Whether a discard owes the club a notice that the date stands: about a day to come.

    No stamp asked, as `notice_owed` asks one: the decline it discards came through one of the club's own links.
    """

    return _notice_to_come(row=row, grund="verworfen", spiel={}, today=today)


def notice_holds(*, row: Mapping[str, Any], spiel: Mapping[str, Any]) -> bool:
    """Whether the closing a held notice announces still holds of the fixture as it stands.

    A fixture reinstated, rebooking the row's referee or back at its slot is asked afresh, which the notice would contradict.
    """

    grund = row["geschlossen"]["grund"]
    if grund == "abgesagt":
        # A no-show stands past its day, deciding the fixture, and still voids what its parties were asked.
        return (
            spiel.get("sonderereignis") in SONDEREREIGNIS_CALLING_OFF_BEFORE_ITS_DAY
            or entscheidung_of(spiel=spiel, austritte=[], tag=None) == "abgesagt"
        )

    if grund == "schiedsrichter_gewechselt":
        return _referee_id(spiel) != row["partei"].get("schiedsrichter_id")

    # The date the discard kept: moved since, the club is asked about the new one instead.
    if grund == "verworfen":
        return ansetzung_stand_of(spiel) == row["ansetzung"]["stand"]

    return ansetzung_stand_of(spiel) != row["ansetzung"]["stand"]


def build_mitteilung_filter(*, saison_id: str) -> dict[str, Any]:
    """The season's closed rows still owing a notice; every other row holds no mark, or a null one."""

    return {"saison_id": saison_id, "geschlossen.mitteilung": {"$ne": None}}


def mitteilung_spent(*, row: Mapping[str, Any], spiel: Mapping[str, Any], today: str) -> bool:
    """Whether a pass gives a held notice up: handed out the cap's number of times, or about no day still to come."""

    geschlossen = row["geschlossen"]

    return int(geschlossen["mitteilung"]["versuche"]) >= MITTEILUNG_VERSUCHE_HOECHSTENS or not _notice_to_come(
        row=row, grund=geschlossen["grund"], spiel=spiel, today=today
    )


# --- A seat write's void: its team's rows' entries, answered and closed ones too, of every seat whose holder the write moves.


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


def build_team_rows_filter(pairs: Sequence[tuple[Any, Any]]) -> dict[str, Any]:
    """These teams' rows in these seasons, answered and closed ones too: a link opens nothing once its seat changed holder.

    Left on an answered row, it would show whoever holds the old mail the successor's ban.
    """

    return {"partei.art": "team", "$or": [_team_rows(saison_id, team_id) for saison_id, team_id in pairs]}


def group_seat_voids(voids: Sequence[SeatVoid]) -> list[tuple[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]]]:
    """The teams these writes moved seats on, grouped by the seats to null: one write per group, never per row.

    Unread first: a group whose rows hold none of the entries changes, and logs, nothing.
    """

    seats_of: dict[tuple[Any, Any], set[str]] = {}
    for void in voids:
        seats_of.setdefault((void.saison_id, void.team_id), set()).update(void.seats)

    groups: dict[tuple[FLKontaktRolle, ...], list[tuple[Any, Any]]] = {}
    for pair, seats in seats_of.items():
        groups.setdefault(tuple(seat for seat in KONTAKT_ROLLEN if seat in seats), []).append(pair)

    return list(groups.items())


def build_seat_entry_images_filter(voids: Sequence[SeatVoid]) -> dict[str, Any]:
    """Log rows whose image may be one of these teams' rows in these seasons, an undraw's removal among them; the judge decides."""

    return {
        "collection": str(Collection.SPIELBESTAETIGUNGEN),
        "$or": [{"before.saison_id": void.saison_id, "before.partei.team_id": void.team_id} for void in voids],
    }


def seat_entry_image_edits(image: Mapping[str, Any], voids: Sequence[SeatVoid]) -> dict[str, None]:
    """One image's entries of the voided seats nulled: a link's hashes and its mail's delivery record.

    An earlier holder's go too, an image naming no holder; the season's end strips them anyway.
    """

    partei = image.get("partei")
    team_id = partei.get("team_id") if isinstance(partei, Mapping) and partei.get("art") == "team" else None
    seats = {seat for void in voids if (void.saison_id, void.team_id) == (image.get("saison_id"), team_id) for seat in void.seats}

    return _seat_entries(image, seats) if team_id is not None and seats else {}


def _seat_entries(image: Mapping[str, Any], seats: Set[str]) -> dict[str, None]:
    kontakte = image.get("kontakte")

    return {
        f"kontakte.{seat}": None
        for seat in KONTAKT_ROLLEN
        if seat in seats and isinstance(kontakte, Mapping) and kontakte.get(seat) is not None
    }


def build_season_images_filter(saison_id: str) -> dict[str, Any]:
    """Every log row whose image may be one of this season's team rows, or a referee row holding a reason; the judge decides."""

    return {
        "collection": str(Collection.SPIELBESTAETIGUNGEN),
        "before.saison_id": saison_id,
        "$or": [{"before.partei.art": "team"}, {"before.antwort.begruendung": {"$ne": None}}],
    }


def season_end_image_edits(image: Mapping[str, Any], saison_id: str) -> dict[str, None]:
    """One image of this season's rows stripped as its season's end strips the row: every seat's link entry, the reason, the holder.

    A referee row holds no seat and no holder, so its image loses its reason alone.
    """

    if image.get("saison_id") != saison_id:
        return {}

    edits = _seat_entries(image, set(KONTAKT_ROLLEN))
    antwort = image.get("antwort")
    von = antwort.get("von") if isinstance(antwort, Mapping) else None
    if isinstance(antwort, Mapping) and antwort.get("begruendung") is not None:
        edits["antwort.begruendung"] = None
    # A contact's answer alone carries the digest: nulled on another answerer's `von`, it would add a key only a seat's answer names.
    if isinstance(von, Mapping) and von.get("art") == "kontakt" and von.get("halter") is not None:
        edits["antwort.von.halter"] = None

    return edits


def build_season_reasons_filter(saison_id: str) -> dict[str, Any]:
    """This season's rows holding a reason, whoever gave it and whatever the party: the season's end takes every one, the answer's way kept."""

    return {"saison_id": saison_id, "antwort.begruendung": {"$ne": None}}


def build_season_halter_filter(saison_id: str) -> dict[str, Any]:
    """This season's team rows a contact answered still holding the holder digest, which only a contact's answer carries."""

    return {"saison_id": saison_id, "partei.art": "team", "antwort.von.art": "kontakt", "antwort.von.halter": {"$ne": None}}


def build_season_entries_filter(saison_id: str) -> dict[str, Any]:
    """This season's team rows still holding a seat's link entry, so a season stripped already is written, and logged, nothing."""

    return {"saison_id": saison_id, "partei.art": "team", "$or": [{f"kontakte.{seat}": {"$ne": None}} for seat in KONTAKT_ROLLEN]}


# --- A CONTACT PERSON'S ERASURE OR WIDERSPRUCH: the reasons they typed, from whichever seat they held then.


def build_contact_reasons_filter(halter: Sequence[str]) -> dict[str, Any]:
    """Every row these holders answered from a seat, closed since or not, whatever team or seat; the digest goes with no reason too."""

    return {"antwort.von.halter": {"$in": list(halter)}}


def build_contact_reason_images_filter(halter: Sequence[str]) -> dict[str, Any]:
    """Log rows whose image holds such an answer, an undraw's removal among them, which no row standing now reaches."""

    return {"collection": str(Collection.SPIELBESTAETIGUNGEN), "before.antwort.von.halter": {"$in": list(halter)}}


def contact_reason_image_edits(image: Mapping[str, Any], halter: Sequence[str]) -> dict[str, Any]:
    """One image's reason and holder nulled where one of these holders gave its answer from a seat, as the rows' own write nulls them.

    The answer's day, its way and its role stay: they are the club's.
    """

    antwort = image.get("antwort")
    von = antwort.get("von") if isinstance(antwort, Mapping) else None
    if isinstance(von, Mapping) and von.get("halter") in halter:
        return {"antwort.begruendung": None, "antwort.von.halter": None}

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
