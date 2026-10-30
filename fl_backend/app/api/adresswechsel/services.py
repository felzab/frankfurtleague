"""
API · one address's pending change, as its own record keyed by the address: the record's shape, its steps, its filters and its refusals

Pure: no read and no write. A change belongs to an address, never to one of the records the address holds, so whose
records it moves is read from the address when it takes effect (`app/api/adresswechsel/crud.py :: read_the_bestand`).

Invariants:
- Every instant is stored as a BSON date and compared as one; a filter on one always carries `$type: "date"`, so a null
  never compares.
- Every read of a live change carries `LIVE_TERMS`, the filter `uniq_adresswechsel_adresse` indexes.
"""

import unicodedata
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal, get_args

from app.core.clock import GERMANY as _GERMANY
from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.folding import sign_in_identifier
from app.shared.schemas.bounds import ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_TAGE, GENEHMIGUNG_TAGE
from app.shared.schemas.literals import FLAdresswechselEndeArt, FLAdresswechselWartetAuf, FLAdresswechselWeg, FLGenehmigungVerwehrt

ADRESSWECHSEL_WEGE: Final[tuple[str, ...]] = get_args(FLAdresswechselWeg.__value__)

# What the stop link of the address on file shows, one state per step the change waits on.
FLAdresswechselBisherigZustand = Literal["freigabe_offen", "offen", "genehmigung", "wartezeit"]

# What the new mailbox's link shows while the change stands. `genehmigung_abgelaufen` is a confirmed change's lapsed
# approval week, never `abgelaufen`: that is the link's own deadline, and a confirmed link takes no second answer.
FLAdresswechselNeuZustand = Literal["gueltig", "abgelaufen", "gesperrt", "nicht_bestaetigbar", "bestaetigt", "genehmigung_abgelaufen"]

ADRESSWECHSEL_ENDE_ARTEN: Final[tuple[str, ...]] = get_args(FLAdresswechselEndeArt.__value__)

# The tier of the grant a change moves ranked, and so who may approve it: `owner` another owner alone.
_RANG: Final[Mapping[str, int]] = {"administration": 0, "owner": 1}

# The one filter every read of a live change carries: `uniq_adresswechsel_adresse` indexes these rows alone.
LIVE_TERMS: Final[Mapping[str, Any]] = {"beendet": {"$type": "null"}}

# A `$lookup` joining on the address carries these beside its key, for `build_address_filter`'s reason.
LIVE_KEYED_TERMS: Final[Mapping[str, Any]] = {"adresse": {"$type": "string"}, **LIVE_TERMS}


def als_utc(moment: Any) -> datetime | None:
    """A stored instant marked as the UTC it is, the driver reading one back with no offset; `None` for anything else."""

    if not isinstance(moment, datetime):
        return None

    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def gueltig_bis_ab(now: datetime) -> datetime:
    """When a step asked at `now` lapses: a link to the new mailbox, or the approval asked of the address on file."""

    return now.astimezone(UTC) + timedelta(hours=ADRESSWECHSEL_GUELTIG_STUNDEN)


def wirksam_ab_von(bestaetigt_am: datetime) -> datetime:
    return bestaetigt_am.astimezone(UTC) + timedelta(days=ADRESSWECHSEL_WARTEZEIT_TAGE)


def _german_day(now: datetime) -> str:
    # The day the restore planner judges a link's send by (`app/api/identitaet/wiederherstellung.py :: Window`).
    return now.astimezone(_GERMANY).strftime("%Y-%m-%d")


def compose_genehmigung(*, verwaltung: str, gestartet_von: str, now: datetime) -> dict[str, Any]:
    """The approval a change moving a grant waits on: the tier it moves, who started it, when, and the end of its week."""

    return {
        "verwaltung": verwaltung,
        # Its approver held their grant since then (`app/api/berechtigungen/services.py :: haelt_seit`).
        "angefragt_am": now.astimezone(UTC),
        "bis": now.astimezone(UTC) + timedelta(days=GENEHMIGUNG_TAGE),
        # Folded, as `erteilt_von` stores an administrator: the one compared with the approver.
        "gestartet_von": gestartet_von,
        "genehmigt_am": None,
        "genehmigt_von": None,
    }


def compose_record(
    *,
    adresse: str,
    email: str,
    weg: FLAdresswechselWeg,
    grund: str | None,
    genehmigung: Mapping[str, Any] | None,
    now: datetime,
) -> dict[str, Any]:
    """The WHOLE record a start inserts, never reused, so a journal line's id names one change.

    Both links' arrays empty: each mail's hand-out mints its link into them (`app/api/postausgang/router.py :: post_ausgabe`).
    """

    return {
        "adresse": adresse,
        "email": email,
        "weg": weg,
        "token_hashes": [],
        "stopp": {"token_hashes": []},
        "verschickt_am": _german_day(now),
        "gueltig_bis": gueltig_bis_ab(now),
        "freigegeben_am": None,
        "grund": grund,
        "bestaetigt_am": None,
        "wirksam_ab": None,
        "genehmigung": None if genehmigung is None else dict(genehmigung),
        "beendet": None,
    }


def compose_link_update(*, now: datetime, freigabe: bool) -> dict[str, Any]:
    """A fresh deadline for the new mailbox's link, for the approval of the address on file or a re-send; the stop link stays.

    The link itself is minted as its mail is handed out, replacing the one before (`owe_the_link_in_session`).
    """

    gesetzt: dict[str, Any] = {"gueltig_bis": gueltig_bis_ab(now), "verschickt_am": _german_day(now)}
    if freigabe:
        gesetzt["freigegeben_am"] = now.astimezone(UTC)

    return {"$set": gesetzt}


def compose_confirmation_update(*, record: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """The new mailbox confirmed a change not taking effect now: its deadline goes, and a waiting time may start.

    The token's hash stays, so the link answers what became of the change while its record is kept.
    """

    gesetzt: dict[str, Any] = {"gueltig_bis": None, "bestaetigt_am": now.astimezone(UTC)}
    if record.get("weg") == "wartezeit":
        gesetzt["wirksam_ab"] = wirksam_ab_von(now)

    return {"$set": gesetzt}


def compose_genehmigt_update(*, akteur: str, now: datetime) -> dict[str, Any]:
    return {"$set": {"genehmigung.genehmigt_am": now.astimezone(UTC), "genehmigung.genehmigt_von": akteur}}


def build_owed_carry_filter(adressen: list[str]) -> dict[str, Any]:
    """The ended changes still owing to carry a sign-in account off one of these folded addresses.

    No index serves it: a carry is owed from an effect until the frontend reports it done, seconds as a rule.
    """

    return {"umzug.von": {"$in": adressen}}


def compose_genehmigung_widerrufen_update() -> dict[str, Any]:
    """An approval that does not stand, taken off: its request's instant and deadline stay, so a new approval is judged as the first."""

    return {"$set": {"genehmigung.genehmigt_am": None, "genehmigung.genehmigt_von": None}}


def compose_end_update(*, art: FLAdresswechselEndeArt, now: datetime) -> dict[str, Any]:
    """An ended change's tombstone: its addresses, its reason and its approval go; its hashes stay.

    The hashes let each link answer how the change ended until the TTL removes the record.
    """

    return {
        "$set": {
            "adresse": None,
            "email": None,
            "grund": None,
            "genehmigung": None,
            "beendet": {"art": art, "am": now.astimezone(UTC)},
        }
    }


def build_live_filter(adresswechsel_id: Any, terms: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """One live change by its id, matching `terms`. The filter is the judgement: an ended or unknown one is the miss."""

    return {"_id": adresswechsel_id, **LIVE_TERMS, **(terms or {})}


def build_address_filter(adresse: str) -> dict[str, Any]:
    """The live change of one folded address, which `uniq_adresswechsel_adresse` answers by equality.

    The key's type stated beside its value: the planner reads an equality as no subset of the index's `$type` term.
    """

    return {"adresse": {"$eq": adresse, "$type": "string"}, **LIVE_TERMS}


def build_addresses_filter(adressen: list[str]) -> dict[str, Any]:
    """The live changes of these folded addresses, for `build_address_filter`'s reason."""

    return {"adresse": {"$in": adressen, "$type": "string"}, **LIVE_TERMS}


def build_awaiting_genehmigung_filter(adressen: list[str], *, now: datetime) -> dict[str, Any]:
    """The live changes of these folded addresses awaiting their grant's approval, no step lapsed: what the administrators page offers.

    A lapsed one is refused `link_abgelaufen`, so the reload that refusal asks for must not offer it.
    """

    return {
        **build_addresses_filter(adressen),
        "genehmigung.genehmigt_am": {"$type": "null"},
        # `ist_abgelaufen`'s judgement, negated: one lapse rule for the press, the pass and this list.
        "$nor": build_lapsed_terms(now)["$or"],
    }


def build_awaiting_approval_terms() -> dict[str, Any]:
    """A change an administrator started without a reason, its address on file not yet asked to approve it in vain."""

    return {"weg": "freigabe", "freigegeben_am": None, "bestaetigt_am": None}


def build_resendable_terms() -> dict[str, Any]:
    """A change waiting on the new mailbox: one awaiting the address on file's approval, or confirmed, has no link to re-send."""

    return {"$nor": [{"weg": "freigabe", "freigegeben_am": None}], "bestaetigt_am": None}


def build_open_link_terms(token_hash: str) -> dict[str, Any]:
    """The new mailbox's link while the change waits on it: confirmed once, it takes no second answer."""

    return {"token_hashes": token_hash, "bestaetigt_am": None}


def build_lapsed_terms(now: datetime) -> dict[str, Any]:
    """A live change whose waiting step lapsed at or before `now`: its link, the approval it asked, or its grant's approval."""

    return {
        **LIVE_TERMS,
        "$or": [
            {"gueltig_bis": {"$type": "date", "$lte": now}},
            {"genehmigung.bis": {"$type": "date", "$lte": now}, "genehmigung.genehmigt_am": {"$type": "null"}},
        ],
    }


def build_due_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change with no waiting time left at `now`, an owed approval judged at the effect rather than here.

    A grant ended since the confirmation, by any route, leaves nothing to approve.
    """

    return {
        **LIVE_TERMS,
        "bestaetigt_am": {"$type": "date"},
        "$or": [{"wirksam_ab": {"$type": "null"}}, {"wirksam_ab": {"$type": "date", "$lte": now}}],
    }


# Where a `$lookup` of the address's grant row lands, the unique index serving it (`uniq_berechtigung_adresse`).
GEHALTEN: Final = "_berechtigung"


def build_parked_terms(now: datetime) -> dict[str, Any]:
    """A confirmed change whose approval is owed while its address still holds a grant: waiting, neither due nor lapsed.

    Read over a page `GEHALTEN` was joined onto; a lapse of the approval's week is no parking.
    """

    return {
        "bestaetigt_am": {"$type": "date"},
        "genehmigung.genehmigt_am": {"$type": "null"},
        "genehmigung.bis": {"$type": "date", "$gt": now},
        f"{GEHALTEN}.0": {"$exists": True},
    }


def ist_abgelaufen(record: Mapping[str, Any], *, now: datetime) -> bool:
    """Whether the step a live change waits on has lapsed, judged as `build_lapsed_terms` removes it."""

    gueltig_bis = als_utc(record.get("gueltig_bis"))
    if gueltig_bis is not None and gueltig_bis <= now:
        return True

    genehmigung = record.get("genehmigung")
    if not isinstance(genehmigung, Mapping) or genehmigung.get("genehmigt_am") is not None:
        return False
    bis = als_utc(genehmigung.get("bis"))

    return bis is not None and bis <= now


def genehmigung_offen(record: Mapping[str, Any]) -> bool:
    """Whether the change asks another administrator's approval it has not been given."""

    genehmigung = record.get("genehmigung")

    return isinstance(genehmigung, Mapping) and genehmigung.get("genehmigt_am") is None


def ist_faellig(record: Mapping[str, Any], *, now: datetime) -> bool:
    """Whether a confirmed change has no waiting time left: none was asked, or it ended at or before `now`."""

    wirksam_ab = als_utc(record.get("wirksam_ab"))

    return record.get("bestaetigt_am") is not None and (wirksam_ab is None or wirksam_ab <= now)


def wartet_auf(record: Mapping[str, Any]) -> FLAdresswechselWartetAuf:
    if record.get("bestaetigt_am") is not None:
        # A confirmed change with no waiting time stands only while its grant's approval is owed.
        return "wartezeit" if record.get("wirksam_ab") is not None else "genehmigung"

    if record.get("weg") == "freigabe" and record.get("freigegeben_am") is None:
        return "freigabe"

    return "neue_adresse"


_BISHERIG: Final[Mapping[FLAdresswechselWartetAuf, FLAdresswechselBisherigZustand]] = {
    "freigabe": "freigabe_offen",
    "neue_adresse": "offen",
    "genehmigung": "genehmigung",
    "wartezeit": "wartezeit",
}


def bisherig_zustand(record: Mapping[str, Any]) -> FLAdresswechselBisherigZustand:
    """What the stop link shows: the step the change waits on, and never whether it could be confirmed, the stop being refused nothing."""

    return _BISHERIG[wartet_auf(record)]


def neu_zustand(record: Mapping[str, Any], *, now: datetime, gesperrt: bool, nicht_bestaetigbar: bool) -> FLAdresswechselNeuZustand:
    """What the new mailbox's link shows, in the order the confirmation judges, so a refused press names what a reload shows.

    The unconfirmable causes read alike here; the press's own codes part them, merged only at the edge.
    """

    if record.get("bestaetigt_am") is not None:
        # Never `bestaetigt` once its approval week lapsed: the pass ends it unapproved, which the page must not deny.
        return "genehmigung_abgelaufen" if ist_abgelaufen(record, now=now) else "bestaetigt"

    if gesperrt:
        return "gesperrt"

    if ist_abgelaufen(record, now=now):
        return "abgelaufen"

    return "nicht_bestaetigbar" if nicht_bestaetigbar else "gueltig"


def deckt(genehmigung: Any, verwaltung: Any) -> bool:
    """Whether a change's approval covers moving a grant of `verwaltung`: asked for that tier or a higher one."""

    return isinstance(genehmigung, Mapping) and _RANG.get(str(genehmigung.get("verwaltung")), -1) >= _RANG.get(str(verwaltung), 2)


def _gezeigtes_label(label: str) -> str:
    """One domain label as its reader knows it: decoded from punycode where it decodes, as stored where it does not."""

    if not label.startswith("xn--"):
        return label
    try:
        decoded = label.removeprefix("xn--").encode("ascii").decode("punycode")
    except UnicodeError:
        return label

    # Punycode decodes nonsense into control characters rather than refusing it.
    return label if any(unicodedata.category(character)[0] == "C" for character in decoded) else decoded


def maskierte_adresse(email: str) -> str:
    """The pending address a league-started change shows its address on file.

    Three bullets whatever the length; the last label alone, needing no public-suffix list; decoded first, so an
    internationalised domain shows its own letter.
    """

    # Folded and decoded, never judged by the address rule, whose tables move without us: a stored value it came to
    # refuse would answer the account page a 500 (`app/shared/schemas/kontakt.py :: FLKontaktPayload`).
    local, _, domain = sign_in_identifier(email).rpartition("@")
    labels = [_gezeigtes_label(label) for label in domain.split(".")]
    gekuerzt = f"{labels[0][:1]}•••" + (f".{labels[-1]}" if len(labels) > 1 else "")

    return f"{local[:1]}•••@{gekuerzt}"


def find_unbekannt_refusal(*, found: bool) -> WriteRefusal | None:
    """`link_ungueltig`: the link matches no change, live or kept, and so answers nothing about one."""

    if found:
        return None

    return WriteRefusal(error_code=Code.LINK_UNGUELTIG, status=HTTPStatus.NOT_FOUND)


def find_beendet_refusal(*, offen: bool) -> WriteRefusal | None:
    """`adresswechsel_beendet`: the change this link or id names has ended, or this link was answered already."""

    if offen:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_BEENDET,
        status=HTTPStatus.CONFLICT,
    )


def find_abgelaufen_refusal(*, abgelaufen: bool) -> WriteRefusal | None:
    """`link_abgelaufen`: the step the change waits on lapsed -- its link, the approval asked, or its grant's approval."""

    if not abgelaufen:
        return None

    return WriteRefusal(
        error_code=Code.LINK_ABGELAUFEN,
        status=HTTPStatus.GONE,
    )


def find_bestaetigung_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`link_gesperrt`: the ban list holds the address the link was mailed to, however long ago it was minted."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=Code.LINK_GESPERRT,
        status=HTTPStatus.FORBIDDEN,
    )


def find_ersetzte_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`adresswechsel_ersetzte_gesperrt`: the ban list holds the address the change replaces, so moving would carry the ban's person off it."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_ERSETZTE_GESPERRT,
        status=HTTPStatus.CONFLICT,
    )


def find_vergeben_refusal(*, vergeben: bool) -> WriteRefusal | None:
    """`adresswechsel_vergeben`: another pupil signs in on the new address, and one address is one pupil (`uniq_spieler_email`)."""

    if not vergeben:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_VERGEBEN,
        status=HTTPStatus.CONFLICT,
    )


def find_unveraendert_refusal(*, adresse: str, folded: str) -> WriteRefusal | None:
    """`adresswechsel_unveraendert`: the typed address signs in as the one on file, so it would ask a mailbox already proved.

    `folded` is the typed address's sign-in identifier, which the caller folds; `adresse` is one already.
    """

    if folded != adresse:
        return None

    # Naming neither address: the message reaches the refusal's log line.
    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_UNVERAENDERT,
        status=HTTPStatus.CONFLICT,
    )


def find_gesperrt_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`adresswechsel_gesperrt`: no link an administrator mints goes to an address the ban list holds. Worded for them."""

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_GESPERRT,
        status=HTTPStatus.CONFLICT,
    )


def find_nichts_refusal(*, leer: bool) -> WriteRefusal | None:
    """`adresswechsel_nichts`: the address holds nothing a change moves, so there is nothing to change."""

    if not leer:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_NICHTS,
        status=HTTPStatus.CONFLICT,
    )


def find_kein_genehmiger_refusal(*, genehmiger: int) -> WriteRefusal | None:
    """`adresswechsel_kein_genehmiger`: a change moving a grant waits on an approver nobody could be.

    Neither the changed address nor the change's starter approves, and an owner's grant is approved by another owner alone:
    the last owner makes another first.
    """

    if genehmiger > 0:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_KEIN_GENEHMIGER,
        status=HTTPStatus.CONFLICT,
    )


def find_keine_genehmigung_offen_refusal(*, offen: bool) -> WriteRefusal | None:
    """`adresswechsel_keine_genehmigung_offen`: the change asks no approval, or was given it already."""

    if offen:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_KEINE_GENEHMIGUNG_OFFEN,
        status=HTTPStatus.CONFLICT,
    )


def find_genehmigung_verwehrt_refusal(*, verwehrt: FLGenehmigungVerwehrt | None) -> WriteRefusal | None:
    """Why this approver may not approve the change, or `None`.

    `adresswechsel_genehmigung_verwehrt` for the changed address or the starter, `adresswechsel_genehmigung_inhaber` for an owner's grant
    without an owner's power, `adresswechsel_genehmigung_juenger` for an approver whose grant, or owner's tier, took effect after the
    change's start.
    """

    if verwehrt is None:
        return None

    if verwehrt == "juenger":
        return WriteRefusal(
            error_code=Code.ADRESSWECHSEL_GENEHMIGUNG_JUENGER,
            status=HTTPStatus.FORBIDDEN,
        )

    if verwehrt == "inhaber":
        return WriteRefusal(
            error_code=Code.ADRESSWECHSEL_GENEHMIGUNG_INHABER,
            status=HTTPStatus.FORBIDDEN,
        )

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_GENEHMIGUNG_VERWEHRT,
        status=HTTPStatus.FORBIDDEN,
    )


def find_nicht_gedeckt_refusal(*, gedeckt: bool) -> WriteRefusal | None:
    """`adresswechsel_nicht_gedeckt`: the address came to hold a grant, or a higher tier, than the change's approval was asked for.

    Moving it would hand access over unapproved, and leaving it would keep it at an address its person has left.
    """

    if gedeckt:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_NICHT_GEDECKT,
        status=HTTPStatus.CONFLICT,
    )


def find_belegt_refusal(*, belegt: bool) -> WriteRefusal | None:
    """`adresswechsel_belegt`: an entry names the new address, and moving the person onto it would join two people's.

    Never judged at the person's own start, which would tell its holder which addresses hold entries.
    """

    if not belegt:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_BELEGT,
        status=HTTPStatus.CONFLICT,
    )


def find_neue_berechtigt_refusal(*, berechtigt: bool) -> WriteRefusal | None:
    """`adresswechsel_neue_berechtigt`: the new address holds a grant already, and one address holds one grant."""

    if not berechtigt:
        return None

    return WriteRefusal(
        error_code=Code.ADRESSWECHSEL_NEUE_BERECHTIGT,
        status=HTTPStatus.CONFLICT,
    )
