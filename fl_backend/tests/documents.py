"""
TESTS · the stored shapes both tiers build from: seeds, and the rules and consent that payload fixtures and rules models take

Each document as the shipped indexes judge it. Plain functions rather than fixtures: the `on_a_*`
helpers and module-scoped corpora that seed them take no fixture.

Invariants:
- A value default (an address, a date, a rule, a consent) is one no test reads: a test asserting on a
  value passes it at the call, even one equal to the default.
- A null, `False` or `gruppenphase` default is the ordinary state a seed stands in (active, not
  withdrawn, not yet filled in), which tests rely on: a test wanting another state passes it.
- A builder of a whole stored document answers only what its record model reads back as
  `python -m app.readback` does, the overrides at the call included: a seed that breaks a document on
  purpose lays the break over the builder's answer.
"""

import copy
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Final, TypeAliasType, get_args
from zoneinfo import ZoneInfo

from bson import ObjectId

from app.api.address_change.services import compose_record
from app.api.bewerbungen.services import compose_confirmations, compose_einwilligung, confirmation_deadline_from
from app.api.invitations.services import compose_invitation
from app.api.outbox.schemas import FLBanData
from app.api.outbox.services import OwedMail, row_of
from app.api.registrierungen.services import compose_confirmation, compose_confirmation_update, compose_registrierung
from app.api.schiedsrichter.services import build_ghost_schiedsrichter
from app.api.spielbestaetigungen.services import compose_ansetzung
from app.api.spieler.services import build_ghost_spieler
from app.api.teams.services import compose_kontakt_confirmation
from app.core.clock import utc_stamp
from app.core.collections import EDITED_COLLECTIONS, Collection
from app.core.crud import VERSION_FIELD
from app.readback import RECORD_MODELS
from app.shared.einwilligung_evidence import CHOICES, EVIDENCE, TextVersions, compose_initial, compose_receipt
from app.shared.folding import league_address
from app.shared.schemas.einwilligung import FLMediaTextVersion, FLNameKaderTextVersion, FLNameSpielplanTextVersion, FLWhatsappTextVersion
from app.shared.schemas.literals import KONTAKT_ROLLEN, FLAddressChangeWay
from app.shared.tokens import hash_token

ADDRESS: Final[Mapping[str, str]] = {
    "street": "Hanauer Landstraße",
    "house_number": "12a",
    "postcode": "60314",
    "district": "Ostend",
    "city": "Frankfurt am Main",
}

_GERMANY: Final = ZoneInfo("Europe/Berlin")


def _read_back(collection: Collection, document: dict[str, Any]) -> dict[str, Any]:
    """`document`, once `collection`'s record model has read it as the read-back does.

    The models ignore an unknown key at runtime, so a seed still writing a field its model dropped passes every case,
    and an assertion reading that field back holds whatever the code under test did.
    """

    # The id the insert mints where the builder leaves one to it, as every stored document holds one.
    RECORD_MODELS[collection].model_validate({"_id": ObjectId(), **document}, extra="forbid")
    # The read-back's rule beside the model, whose `version` defaults to 0 for the runtime reads: every write of an edited
    # collection stores one.
    if collection in EDITED_COLLECTIONS and VERSION_FIELD not in document:
        raise ValueError(f"a {collection} document without `{VERSION_FIELD}`, which every write of it stores")
    return document


def label_of(alias: TypeAliasType) -> str:
    """The one label a consent's `Literal` admits, read off the alias so no suite spells it twice."""

    return get_args(alias.__value__)[0]


# The labels each kind of record's press names, keyed by the choice each evidences.
SEAT_TEXT_VERSIONS: Final[TextVersions] = {"scope": label_of(FLWhatsappTextVersion), "media": label_of(FLMediaTextVersion)}
SPIELER_TEXT_VERSIONS: Final[TextVersions] = {"scope": label_of(FLNameKaderTextVersion), "media": label_of(FLMediaTextVersion)}
SCHIEDSRICHTER_TEXT_VERSIONS: Final[TextVersions] = {
    "scope": label_of(FLNameSpielplanTextVersion),
    "media": label_of(FLMediaTextVersion),
}


def confirmed_instant(tag: str) -> str:
    """The instant a seed's person confirmed on `tag`: noon in Germany, spelled as `utc_stamp` spells evidence."""

    return utc_stamp(datetime.fromisoformat(f"{tag}T12:00:00").replace(tzinfo=_GERMANY))


# A pupil's record as their own confirmation wrote it and their admission carried it onto the person,
# publishing the name and no media.
EINWILLIGUNG: Final[Mapping[str, Any]] = compose_initial(
    block={
        "scope": "kader_public",
        "date": "2026-01-20",
        "confirmed_at": "2026-01-20",
        "media": False,
    },
    at=confirmed_instant("2026-01-20"),
    text_versions=SPIELER_TEXT_VERSIONS,
)

# The ordinary competition, so no rule a suite is not about refuses first. Every key spelled out, so a
# key added to `FLSaisonRules` fails a seed rather than taking a default nobody picked.
_RULES: Final[Mapping[str, Any]] = {
    "win_points": 3,
    "draw_points": 1,
    "loss_points": 0,
    "qualifiers_per_gruppe": 2,
    "number_of_gruppen": 4,
    "teams_per_gruppe": 4,
    "tiebreak_order": "tordifferenz",
    "max_kader_size": 18,
    "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
    "allowed_stufen": ["E1", "Q1", "Q2", "Q3", "Q4"],
}


def rules_document(**overrides: Any) -> dict[str, Any]:
    """A season's `rules` block; `deepcopy`, since two seasons in one test would otherwise share its lists."""

    return {**copy.deepcopy(dict(_RULES)), **overrides}


def saison_document(saison_id: str, status: str, **fields: Any) -> dict[str, Any]:
    """The first half of the id's year, which covers the schedule the default rules imply; no `schedule`, which is derived on read."""

    return _read_back(
        Collection.SAISONS,
        {
            "_id": saison_id,
            "start_date": f"{saison_id}-01-01",
            "end_date": f"{saison_id}-06-30",
            "status": status,
            "rules": rules_document(),
            "bewerbung": None,
            "registrierung": None,
            "version": 0,
            **fields,
        },
    )


def team_document(team_id: Any, name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    """`inactive_since` is written null rather than omitted: a missing key matches a `None` filter, then fails response validation."""

    return _read_back(
        Collection.TEAMS,
        {
            "_id": team_id,
            "name": name,
            "shorthand": shorthand,
            "description": "",
            "full_name": f"{name}-Schule",
            # Off the shorthand, which spells a host whatever the name holds: a space in a name is no domain.
            "website_url": f"https://{shorthand.lower()}.example.de",
            "address": dict(ADDRESS),
            "schulform": None,
            "inactive_since": None,
            "version": 0,
            **fields,
        },
    )


def saison_team_document(saison_id: str, team_id: Any, name: str, shorthand: str, **fields: Any) -> dict[str, Any]:
    """The name and shorthand are the season's own copies, taken at entry."""

    return _read_back(
        Collection.SAISON_TEAMS,
        {
            "saison_id": saison_id,
            "team_id": team_id,
            "gruppe": "A",
            "austritt": None,
            "trikot_farbe": None,
            "kontakte": None,
            "name": name,
            "shorthand": shorthand,
            "version": 0,
            **fields,
        },
    )


def spiel_document(*, spiel_id: Any, saison_id: str, spiel_nr: int, spieltag_id: Any, **fields: Any) -> dict[str, Any]:
    """Every nullable key written null rather than omitted, as a save writes them, `note` among them, which `FLSpiel` defaults.

    `spiel_nr` has no default: `uniq_saison_id_spiel_nr` refuses a second fixture reusing one.
    """

    return _read_back(
        Collection.SPIELE,
        {
            "_id": spiel_id,
            "spiel_nr": spiel_nr,
            "saison_id": saison_id,
            "saison_phase": "gruppenphase",
            "spieltag_id": spieltag_id,
            "team1": None,
            "team2": None,
            "team1_quelle": None,
            "team2_quelle": None,
            "date": None,
            "time": None,
            "spielort": None,
            "schiedsrichter": None,
            "ergebnis": None,
            "elfmeterschiessen": None,
            "sonderereignis": None,
            "note": None,
            "version": 0,
            **fields,
        },
    )


def joined_spiel_document(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """`spiel` as `build_spiele_pipeline` serves it, for a report judging joined fixtures without the database.

    Each side's club still in its season, nobody asked to confirm, no match for third place. A stored document holds no
    name, so each joined name is a stand-in unless `spiel` states the one a case reads.
    """

    def side(stored: Mapping[str, Any] | None) -> dict[str, Any] | None:
        return None if stored is None else {"name": "Carl-Schurz", "shorthand": "CSX", "austritt": None, "austritt_type": None, **stored}

    def ground(stored: Mapping[str, Any] | None) -> dict[str, Any] | None:
        return None if stored is None else {"name": "Sportplatz Ost", "maps_link": "Sportplatz Ost, Frankfurt", **stored}

    def referee(stored: Mapping[str, Any] | None) -> dict[str, Any] | None:
        return None if stored is None else {"name": "A. Referee", **stored}

    return {
        **spiel,
        "team1": side(spiel.get("team1")),
        "team2": side(spiel.get("team2")),
        "spielort": ground(spiel.get("spielort")),
        "schiedsrichter": referee(spiel.get("schiedsrichter")),
        "ansetzung_confirmed": None,
        "for_third_place": False,
    }


def spielbestaetigung_document(spiel: Mapping[str, Any], *, party: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    """An open, unanswered row as the pass mints it, its snapshot composed from `spiel` by the composer the mint calls.

    So its `digest` is that of its own values, which a hand-written one never is.
    """

    return _read_back(
        Collection.SPIELBESTAETIGUNGEN,
        {
            "_id": ObjectId(),
            "saison_id": spiel["saison_id"],
            "spiel_id": spiel["_id"],
            "party": dict(party),
            "ansetzung": compose_ansetzung(spiel),
            "deadline": "2026-04-25",
            "asked_at": None,
            "reminded_at": None,
            "answer": None,
            "closed": None,
            **fields,
        },
    )


def bericht_document(**fields: Any) -> dict[str, Any]:
    """A referee's first, unadopted report of a 1:0 won by `team1`: one named scorer and one caution."""

    return {
        "ergebnis_vorschlag": {"team1_tore": 1, "team2_tore": 0, "elfmeterschiessen": None, "sonderereignis": None},
        "scorers": [{"side": "team1", "spieler_id": ObjectId(), "minute": "23", "eigentor": False}],
        "cards": [{"side": "team2", "spieler_id": ObjectId(), "minute": "45+2", "colour": "gelb"}],
        "remarks": None,
        "sides": {"team1": None, "team2": None},
        "submitted_at": datetime(2026, 3, 15, 20, tzinfo=UTC),
        "adopted": False,
        **fields,
    }


def spielbericht_sides(spiel: Mapping[str, Any]) -> dict[str, Any]:
    """The clubs `spiel` fields, as a report written on it stamps them."""

    return {side: (spiel.get(side) or {}).get("team_id") for side in ("team1", "team2")}


def spielbericht_document(spiel: Mapping[str, Any], **fields: Any) -> dict[str, Any]:
    return _read_back(
        Collection.SPIELBERICHTE,
        {
            "_id": ObjectId(),
            "saison_id": spiel["saison_id"],
            "spiel_id": spiel["_id"],
            "bericht": bericht_document(sides=spielbericht_sides(spiel)),
            "version": 0,
            **fields,
        },
    )


def aufstellung_document(spiel: Mapping[str, Any], team_id: Any, *, starters: Sequence[Any] = (), bench: Sequence[Any] = ()) -> dict[str, Any]:
    """One club's line-up for `spiel` as its first save stores it, the starters ahead of the bench."""

    return _read_back(
        Collection.AUFSTELLUNGEN,
        {
            "_id": ObjectId(),
            "saison_id": spiel["saison_id"],
            "spiel_id": spiel["_id"],
            "team_id": team_id,
            "spieler": [
                {"spieler_id": spieler_id, "starts": starts} for starts, ids in ((True, starters), (False, bench)) for spieler_id in ids
            ],
            "version": 0,
        },
    )


def kontakt_answer_document(rolle: str, *, reason: str | None, at: str = "2026-04-01", **fields: Any) -> dict[str, Any]:
    """A seat's decline as its link stores it, proposing another date."""

    return {
        "kind": "declined",
        "at": at,
        "by": {"kind": "kontakt", "rolle": rolle},
        "vorschlag": {"date": "2026-04-25", "time": "14:00:00"},
        "reason": reason,
        **fields,
    }


def outbox_document(key: str, *, to: str, now: datetime, **fields: Any) -> dict[str, Any]:
    """One owed ban notice's row as the outbox stores it, its id minted here; `now` a century ahead, as the TTL index reads it."""

    owed = OwedMail(key=key, to=to, data=FLBanData(kind="ban", ban_reason="Falsches Geburtsdatum", barred_until_saison_id="2127"))
    return _read_back(Collection.OUTBOX, {"_id": ObjectId(), **row_of(owed, now=now, secret=None, valid_until=None), **fields})


def ghost_spieler_document() -> dict[str, Any]:
    """The pupils' sentinel as the erasure's insert stores it."""

    return _read_back(Collection.SPIELER, {**build_ghost_spieler(), "version": 0})


def ghost_schiedsrichter_document() -> dict[str, Any]:
    """The referees' sentinel as the erasure's insert stores it."""

    return _read_back(Collection.SCHIEDSRICHTER, {**build_ghost_schiedsrichter(), "version": 0})


def invitation_document(
    invitation_id: Any, *, saison_id: str, team_id: Any, token: str, sent_at: str | None = None, **fields: Any
) -> dict[str, Any]:
    """One registration link as its mint stores it, live and minted for copying unless `sent_at` says it was mailed."""

    return _read_back(
        Collection.INVITATIONS,
        {
            "_id": invitation_id,
            **compose_invitation(saison_id=saison_id, team_id=team_id, token_hashes=[hash_token(token)], sent_at=sent_at),
            **fields,
        },
    )


def spieltag_document(spieltag_id: Any, saison_id: str, position: int, **fields: Any) -> dict[str, Any]:
    """One matchday as the draw inserts it: of the group phase and undated."""

    return _read_back(
        Collection.SPIELTAGE,
        {
            "_id": spieltag_id,
            "start": None,
            "end": None,
            "position": position,
            "saison_phase": "gruppenphase",
            "saison_id": saison_id,
            "version": 0,
            **fields,
        },
    )


def spielort_document(spielort_id: Any, name: str, *, default_mietpreis: int = 80, **fields: Any) -> dict[str, Any]:
    """One venue as its create stores it, live, searched for by its name in Frankfurt."""

    return _read_back(
        Collection.SPIELORTE,
        {
            "_id": spielort_id,
            "name": name,
            "address": dict(ADDRESS),
            "maps_link": f"{name}, Frankfurt",
            "default_mietpreis": default_mietpreis,
            "inactive_since": None,
            "version": 0,
            **fields,
        },
    )


def spieler_document(spieler_id: Any, first_name: str, last_name: str | None, **fields: Any) -> dict[str, Any]:
    """A person as their admission writes them, the record and the date their registration carried."""

    return _read_back(
        Collection.SPIELER,
        {
            "_id": spieler_id,
            "first_name": first_name,
            "last_name": last_name,
            # One per id, folded as the admission stores it, so two seeded persons never meet on `uniq_spieler_email`.
            "email": f"{spieler_id}@schule.example".lower(),
            "birth_date": "2009-05-04",
            "einwilligung": copy.deepcopy(dict(EINWILLIGUNG)),
            "version": 0,
            **fields,
        },
    )


def new_schule_document(team_name: str, **fields: Any) -> dict[str, Any]:
    """The school block of an application naming a school the league does not hold yet, named as `team_document` names one."""

    return {
        "team_name": team_name,
        "full_name": f"{team_name}-Schule",
        "schulform": None,
        "address": dict(ADDRESS),
        "website_url": None,
        **fields,
    }


def minted_confirmations(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    """An application's three seats as the hand-out of each seat's mail left them: one live link each, mailed `today`."""

    return {seat: {**entry, "token_hashes": [hashes[seat]]} for seat, entry in compose_confirmations(today=today).items()}


def row_confirmations(*, hashes: Mapping[str, str], today: str) -> dict[str, Any]:
    """A season row's three seats as the hand-out of each seat's mail left them: one live link each, mailed `today`."""

    return {seat: {**compose_kontakt_confirmation(today=today), "token_hashes": [hashes[seat]]} for seat in KONTAKT_ROLLEN}


def bewerbung_document(
    bewerbung_id: Any,
    saison_id: str,
    status: str,
    *,
    kontakte: Mapping[str, Any],
    submitted_at: str,
    confirmation_deadline: str | None = None,
    team_id: Any = None,
    schule: Mapping[str, Any] | None = None,
    link_prefix: str | None = None,
    sent_at: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A stored application, its school an existing club by `team_id` or a new one in `schule`.

    Each link is minted from `<link_prefix>-<seat>` on `sent_at`, by default the id and the submission day,
    the deadline counted from the mint.
    """

    prefix = str(bewerbung_id) if link_prefix is None else link_prefix
    minted = sent_at or submitted_at
    confirmations = (
        fields.pop("confirmations")
        if "confirmations" in fields
        else minted_confirmations(hashes={seat: hash_token(f"{prefix}-{seat}") for seat in KONTAKT_ROLLEN}, today=minted)
    )

    return _read_back(
        Collection.BEWERBUNGEN,
        {
            "_id": bewerbung_id,
            "version": 0,
            "saison_id": saison_id,
            "submitted_at": submitted_at,
            "status": status,
            "team_id": team_id,
            "schule": None if schule is None else dict(schule),
            "kontakte": dict(kontakte),
            "trikot": {"existing_set": "keiner", "wunschfarbe": "rot"},
            "kader": {"expected_size": 14, "good_spieler": 3},
            "stufengroesse": 96,
            "wunschgegner": None,
            "decision": None,
            # `confirmation_deadline` every seat's day at once, each seat's own otherwise, as the mint gave it.
            "confirmations": {
                seat: {**entry, "deadline": confirmation_deadline or entry.get("deadline") or confirmation_deadline_from(today=minted)}
                if isinstance(entry, Mapping)
                else entry
                for seat, entry in confirmations.items()
            },
            **fields,
        },
    )


def registrierung_document(
    registrierung_id: Any,
    email: str,
    *,
    saison_id: str,
    team_id: Any,
    first_name: str,
    last_name: str,
    token: str,
    submitted_at: str,
    deadline: str,
    position: str | None = None,
    nummer: str | None = None,
    stufe: str | None = None,
    confirmed: Mapping[str, Any] | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """A registration as the submission leaves it and, given `confirmed`, as its pupil's own confirmation then does, through their composers.

    `token` is the raw link its hash is minted from; `confirmed` the confirmation composer's keywords.
    """

    document = {
        "_id": registrierung_id,
        **compose_registrierung(
            saison_id=saison_id,
            team_id=team_id,
            invitation_id=ObjectId(),
            first_name=first_name,
            last_name=last_name,
            email=email,
            position=position,
            nummer=nummer,
            stufe=stufe,
            confirmation={**compose_confirmation(today=submitted_at, deadline=deadline, mailed=True), "token_hashes": [hash_token(token)]},
            today=submitted_at,
        ),
        "idempotency_key": str(registrierung_id),
    }
    if confirmed is not None:
        document.update(compose_confirmation_update(**confirmed)["$set"])

    return _read_back(Collection.REGISTRIERUNGEN, {**document, **fields})


def kontaktperson_document(
    first_name: str,
    *,
    confirmed_at: str | None = None,
    einwilligung: Mapping[str, Any] | None = None,
    at: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """One contact seat as its seating stores it, or, given `confirmed_at`, as its own person's confirmation left it.

    `einwilligung` holds the record's keys a case sets itself, its choices among them, laid over the seat's own.
    """

    seated = compose_einwilligung(today="2026-03-20")
    if confirmed_at is None:
        block = {**seated, **(einwilligung or {})}
    elif not confirmed_at:
        # A blank stamp, which only a hand edit stores and every reader takes for none: nobody answered.
        block = {**seated, "confirmed_at": confirmed_at, **(einwilligung or {})}
    else:
        # As `app/api/bewerbungen/services.py :: compose_confirmation_update` answers the seat: both
        # choices with their evidence, judged against the seat as seated.
        block = {**seated, "confirmed_at": confirmed_at, **(einwilligung or {})}
        if EVIDENCE not in block:
            receipt_at = at if at is not None else confirmed_instant(confirmed_at)
            block[EVIDENCE] = {
                choice: compose_receipt(
                    saved=seated, choice=choice, value=block[choice], at=receipt_at, text_version=SEAT_TEXT_VERSIONS[choice]
                )
                for choice in CHOICES
            }

    return {
        "first_name": first_name,
        "last_name": f"{first_name}-Mustermann",
        "email": f"{first_name.lower()}@example.com",
        "phone": "+49 170 1234567",
        "birth_date": None if confirmed_at is None else "1984-05-09",
        "einwilligung": block,
        **fields,
    }


def confirmed_kenntnisnahme(*, date: str = "2026-01-15", confirmed_at: str = "2026-01-16") -> dict[str, Any]:
    """A seat's record as its applicant's seating and then its own person's confirmation left it, for a seat a case spells itself."""

    return dict(kontaktperson_document("Kenntnis", confirmed_at=confirmed_at, einwilligung={"date": date})["einwilligung"])


def ban_document(address: str, *, until: str, **fields: Any) -> dict[str, Any]:
    """One ban as the shipped write stores it.

    `until` has no default: an activation lapses the row on it, so each case names the bound it seeds.
    """

    return _read_back(
        Collection.BAN_LIST,
        {
            "_id": ObjectId(),
            "address": league_address(address),
            "ban_reason": "Falsches Geburtsdatum bei der Anmeldung",
            "created_at": "2026-03-15",
            "barred_until_saison_id": until,
            **fields,
        },
    )


def saison_spieler_document(spieler_id: Any, saison_id: str, team_id: Any, **fields: Any) -> dict[str, Any]:
    """A live row carries an explicit null `inactive_since`, which is the shape a write leaves and what a `$match` reads."""

    return _read_back(
        Collection.SAISON_SPIELER,
        {
            "spieler_id": spieler_id,
            "saison_id": saison_id,
            "team_id": team_id,
            "is_nachnominiert": False,
            "rolle": None,
            "stufe": "Q2",
            "position": "Angriff",
            "nummer": None,
            "inactive_since": None,
            "version": 0,
            **fields,
        },
    )


# --- A person's OWN records, as the sign-in gate and the account page read them. The address, the stamps
# and every label a case asserts are passed at the call.


def own_einwilligung_document(*, text_versions: TextVersions, confirmed_at: str, at: str | None = None, **fields: Any) -> dict[str, Any]:
    """A pupil's or a referee's consent as their own confirmation left it, publishing the name and no media.

    Each choice evidenced at `at`, noon of `confirmed_at` unless a case names it, under its kind's `text_versions`;
    `fields` laid over the block.
    """

    born = compose_initial(
        block={
            "scope": "kader_public",
            "date": confirmed_at,
            "confirmed_at": confirmed_at,
            "media": False,
        },
        at=at if at is not None else confirmed_instant(confirmed_at),
        text_versions=text_versions,
    )

    return {**born, **fields}


def schiedsrichter_document(
    schiedsrichter_id: Any, *, email: str, name: str, default_payment: int, einwilligung: Mapping[str, Any] | None, **fields: Any
) -> dict[str, Any]:
    """One referee row, `name` unique across the collection (`app/core/constraints.py :: uniq_schiedsrichter_name`)."""

    return _read_back(
        Collection.SCHIEDSRICHTER,
        {
            "_id": schiedsrichter_id,
            "name": name,
            "schule": None,
            "default_payment": default_payment,
            "kontakt": {"phone": "+49 69 5550202", "email": email},
            "inactive_since": None,
            "birth_date": None,
            "einwilligung": None if einwilligung is None else dict(einwilligung),
            "version": 0,
            **fields,
        },
    )


def kontakte_document(**seats: Any) -> dict[str, Any]:
    """A block of three seats, each empty unless named, and no seat held twice unless `trainer_is_also` says so."""

    return {**dict.fromkeys(KONTAKT_ROLLEN), "trainer_is_also": None, **seats}


def registrierung_confirmed(*, birth_date: str, today: str, at: str, scope: str, media: bool) -> dict[str, Any]:
    """`registrierung_document`'s `confirmed` for a pupil's confirmation."""

    return {"birth_date": birth_date, "scope": scope, "media": media, "text_versions": SPIELER_TEXT_VERSIONS, "today": today, "at": at}


def address_change_document(
    *,
    address: str,
    email: str,
    token_hash: str | None,
    day: str,
    way: FLAddressChangeWay = "account",
) -> dict[str, Any]:
    """A live change's record as a start inserts it at noon of `day` in Germany, its links as their hand-outs minted them.

    `token_hash` the new mailbox's, none where its link is not yet owed; the address on file's link a hash nobody holds.
    The person's own way owes the new mailbox its link only once its address on file confirmed, so a
    `token_hash` there stands for an approval at the start.
    """

    started = datetime.fromisoformat(f"{day}T12:00:00").replace(tzinfo=ZoneInfo("Europe/Berlin"))
    asked_first = way == "account"

    return _read_back(
        Collection.ADDRESS_CHANGES,
        {
            **compose_record(address=address, email=email, way=way, now=started),
            "token_hashes": [] if token_hash is None else [token_hash],
            "stop": {"token_hashes": [hash_token(f"stop-{token_hash}")]},
            "released_at": started.astimezone(UTC) if asked_first and token_hash is not None else None,
        },
    )
