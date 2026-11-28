"""One module for every kind of own record, deciding from what the routers pass.

One module, so the kinds' PATCHes cannot answer one press differently and the account page's read judges a grant
exactly as the PATCH it offers does. It reads only through what a router passes: the one press a person's own block
takes runs on the collection, the client and the write its router hands it. An administrator's entry of a withdrawal a
person asked for by mail is here too, so it reaches the blocks their own press reaches.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from http import HTTPStatus
from typing import Any, Final, Literal, Protocol, get_args

from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.bewerbungen.services import build_own_bewerbung_filter, pull_schule_name
from app.api.identity.schemas import FLEinwilligungWithdrawalReport, FLSubjectSeat
from app.api.identity.services import holds_a_seat, is_own_registrierung, own_seats
from app.api.kontakte.services import rows_seating
from app.api.registrierungen.services import build_erasure_registrierung_filter, build_own_registrierung_filter
from app.api.saisons.services import SAISON_LOOKUP
from app.api.schiedsrichter.services import EINWILLIGUNG_FIELD, SELF_REFEREE_ORDER, build_self_referee_filter
from app.api.spieler.services import SELF_PUPIL_ORDER, build_self_pupil_filter
from app.core.clock import utc_stamp
from app.core.codes import Code
from app.core.collections import Collection as DbCollection
from app.core.crud import aggregate_many_from_db, patch_past_the_version_in_db, refuse, refuse_faults
from app.core.exceptions import APIError
from app.core.journal import Journal
from app.core.readonly import ReadCollection
from app.core.recording import record_act
from app.core.transactions import transact
from app.shared.einwilligung import find_self_media_refusal, media_offered
from app.shared.einwilligung_evidence import (
    CHOICES,
    FLEinwilligungChoice,
    TextVersions,
    compose_choices,
    compose_mail_withdrawal,
    evidence_state_of,
    is_given,
)
from app.shared.schemas.einwilligung import (
    WITHHELD_BY_A_PERSON,
    WITHHELD_ON_A_SEAT,
    FLAccountEinwilligungPayload,
    FLSchiedsrichterAccountEinwilligungPayload,
    FLWithdrawalChoice,
    by_choice,
)
from app.shared.schemas.literals import KONTAKT_SEATS


def gives_anything(*, saved: Mapping[str, Any], chosen: Mapping[FLEinwilligungChoice, Any]) -> bool:
    """Whether a press grants a choice the stored record withholds, in either vocabulary.

    A grant is admitted only where its record's grant predicate allows it, a withdrawal on every confirmed one (Art. 7(3) DSGVO).
    """

    return any(is_given(choice, value) and not is_given(choice, saved.get(choice)) for choice, value in chosen.items())


def _moved(saved: Mapping[str, Any], choice: FLEinwilligungChoice, value: Any) -> bool:
    return value != (is_given("media", saved.get("media")) if choice == "media" else saved.get(choice))


def compose_person_move(
    *, saved: Mapping[str, Any], chosen: Mapping[FLEinwilligungChoice, Any], at: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving a person's own block, at `einwilligung`, by the choices that change; `None` where none does.

    Never `confirmed_at`, read by the panel and the publication mask: each press's labels are its evidence's.
    """

    moved: list[FLEinwilligungChoice] = [choice for choice in CHOICES if choice in chosen and _moved(saved, choice, chosen[choice])]
    if not moved:
        return None

    return {
        "$set": compose_choices(
            path="einwilligung",
            saved=saved,
            set_fields={choice: chosen[choice] for choice in moved},
            at=at,
            text_versions=text_versions,
        )
    }


def compose_seat_move(
    *, seats: Mapping[str, Mapping[str, Any]], chosen: Mapping[FLEinwilligungChoice, Any], at: str, text_versions: TextVersions
) -> dict[str, dict[str, Any]] | None:
    """The update moving every held seat's block of one row or application, `seats` keyed by seat; `None` where none moves."""

    set_fields: dict[str, Any] = {}
    for seat, saved in seats.items():
        set_fields.update(
            compose_choices(
                path=f"kontakte.{seat}.einwilligung",
                saved=saved,
                set_fields={choice: chosen[choice] for choice in CHOICES if choice in chosen and _moved(saved, choice, chosen[choice])},
                at=at,
                text_versions=text_versions,
            )
        )

    return {"$set": set_fields} if set_fields else None


def withdrawal_line(
    *, blocks: Sequence[Mapping[str, Any]], chosen: Mapping[FLEinwilligungChoice, Any]
) -> tuple[FLEinwilligungChoice, ...] | None:
    """The choices a press moved off a grant on any of `blocks`, for its journal line; `None` where it withdrew none.

    A grant is never journalled: a restore taking one back leaves the person less exposed, never more.
    """

    return (
        tuple(
            choice
            for choice, value in chosen.items()
            if not is_given(choice, value) and any(is_given(choice, block.get(choice)) for block in blocks)
        )
        or None
    )


def find_own_entry_refusal(*, held: bool) -> APIError | None:
    """`role_not_held` on a person's own record: the address holds no record this operation may read or change.

    One answer for another person's id, an unconfirmed record and none at all, so the refusal tells
    nobody which ids exist.
    """

    if held:
        return None

    return APIError(HTTPStatus.FORBIDDEN, Code.ROLE_NOT_HELD)


def find_evidence_state_refusal(*, expected: Mapping[str, Any], blocks: Sequence[Any]) -> APIError | None:
    """`choices_stale`: a choice's evidence moved since the page was served.

    Refused rather than merged: a stale page sends the other choice as it last saw it, and taking that
    would re-grant what the person withdrew elsewhere.
    """

    if dict(expected) == evidence_state_of(blocks=blocks):
        return None

    return APIError(HTTPStatus.CONFLICT, Code.CHOICES_STALE)


# Every consent press runs the one sequence below between finding its record and writing it, a refusal at any step
# writing nothing. One sequence for every kind, so no two presses judge in two orders: the stale page first, then a
# grant the record may not take, then the media age.

# Whether the record the press found may take a grant, asked only of a press granting something: the
# read behind it is the Funktion lookup, and a withdrawal needs none.
MayGive = Callable[[], Awaitable[bool]]


async def may_always_give(_session: AsyncClientSession) -> bool:
    """`Grants.may_give` of a record no state of which refuses a grant: a pupil's, whose every confirmed record stands live."""

    return True


async def _before_giving(
    *,
    blocks: Sequence[Mapping[str, Any]],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
    may_give: MayGive | None,
) -> bool:
    """The steps every kind shares, the stale page and a grant the record may not take; whether the press grants."""

    refuse(find_evidence_state_refusal(expected=evidence_state, blocks=blocks))

    given = any(gives_anything(saved=block, chosen=chosen) for block in blocks)
    if given and (may_give is None or not await may_give()):
        raise APIError(HTTPStatus.FORBIDDEN, Code.GIVING_NOT_ALLOWED)

    return given


async def press_einwilligung(
    *,
    blocks: Sequence[Mapping[str, Any]],
    birth_dates: Sequence[Any],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
    may_give: MayGive,
    today: str,
) -> None:
    """A press on a kind that takes grants, refused where a step refuses it, leaving the write to the handler.

    `blocks` are the consent blocks the press moves, each beside its person's stored birthdate in `birth_dates`.
    """

    await _before_giving(
        blocks=blocks,
        chosen=chosen,
        evidence_state=evidence_state,
        may_give=may_give,
    )
    media = is_given("media", chosen.get("media"))
    for block, birth_date in zip(blocks, birth_dates, strict=True):
        refuse_faults(find_self_media_refusal(saved=block, media=media, birth_date=birth_date, today=today))


async def press_withdrawal(
    *,
    blocks: Sequence[Mapping[str, Any]],
    chosen: Mapping[FLEinwilligungChoice, Any],
    evidence_state: Mapping[str, Any],
) -> None:
    """A press on a kind taking withdrawals alone: every grant refused before any rule only a grant meets, and nothing counted."""

    await _before_giving(
        blocks=blocks,
        chosen=chosen,
        evidence_state=evidence_state,
        may_give=None,
    )


@dataclass(frozen=True, kw_only=True)
class Grants:
    """What a kind taking grants judges one by: whether its found record may take one, and the day the media age is reckoned on."""

    # Asked in the press's own transaction, so a read behind it sees what the press's read saw.
    may_give: Callable[[AsyncClientSession], Awaitable[bool]]
    today: str


class OwnWrite(Protocol):
    """A kind's write of a press's move onto its found record; which count the write moves is the kind's (`docs/decisions.md`, versions)."""

    def __call__(
        self, *, collection: AsyncCollection, db_filter: Mapping[str, Any], update: Mapping[str, Any], session: AsyncClientSession
    ) -> Awaitable[object]: ...


async def press_own_einwilligung(
    *,
    einwilligung_data: FLAccountEinwilligungPayload | FLSchiedsrichterAccountEinwilligungPayload,
    kind: DbCollection,
    collection: AsyncCollection,
    own_entry: Mapping[str, Any],
    projection: Mapping[str, Any],
    owns: Callable[[Mapping[str, Any]], bool],
    grants: Grants | None,
    write: OwnWrite,
    db: AsyncMongoClient,
    now: datetime,
) -> None:
    """One press on a person's own consent record of `kind`, found by `own_entry` and refused unless it `owns` it.

    `grants` is `None` for a kind taking withdrawals alone. A refusal at any step writes nothing, and what the press
    withdrew is journalled once its transaction lands.
    """

    chosen: dict[FLEinwilligungChoice, object] = {"scope": einwilligung_data.scope, "media": einwilligung_data.media}
    evidence_state = einwilligung_data.evidence_state.model_dump()
    # One instant for every attempt.
    at = utc_stamp(now)
    journal = Journal()

    @journal.attempted
    async def write_the_press(session: AsyncClientSession) -> None:
        row = await collection.find_one(own_entry, projection=projection, session=session)
        refuse(find_own_entry_refusal(held=row is not None and owns(row)))
        assert row is not None
        saved = row["einwilligung"]

        if grants is None:
            await press_withdrawal(blocks=[saved], chosen=chosen, evidence_state=evidence_state)
        else:
            await press_einwilligung(
                blocks=[saved],
                birth_dates=[row.get("birth_date")],
                chosen=chosen,
                evidence_state=evidence_state,
                may_give=partial(grants.may_give, session),
                today=grants.today,
            )

        update = compose_person_move(saved=saved, chosen=chosen, at=at, text_versions=by_choice(einwilligung_data.text_versions))
        if update is not None:
            await write(collection=collection, db_filter={"_id": row["_id"]}, update=update, session=session)
        if moved := withdrawal_line(blocks=[saved], chosen=chosen):
            journal.note("withdrawal", [f"{kind}/{row['_id']}"], choices=list(moved))

    async with journal:
        await transact(db, write_the_press)


@dataclass(frozen=True, kw_only=True)
class Held:
    """The consent blocks one record holds of the person whose mail asked a withdrawal, keyed by path, and on a seat's record their seats."""

    blocks: Mapping[str, Mapping[str, Any]]
    seats: Sequence[str] = ()


def _held_by_the_record(row: Mapping[str, Any], _identifier: str) -> Held:
    """A pupil's, a referee's or a registration's own block; none before its person confirmed it."""

    block = row.get("einwilligung")

    return Held(blocks={"einwilligung": block} if isinstance(block, Mapping) else {})


def _held_on_the_seats(row: Mapping[str, Any], identifier: str) -> Held:
    """Every confirmed seat of a season row or an application at the address, as their own press moves them together."""

    seats = own_seats(row, identifier)

    return Held(blocks={f"kontakte.{seat}.einwilligung": row["kontakte"][seat]["einwilligung"] for seat in seats}, seats=seats)


@dataclass(frozen=True, kw_only=True)
class AddressRecords:
    """The collections an address's consent records stand in, and the clubs an application's school may be named by."""

    spieler: AsyncCollection
    schiedsrichter: AsyncCollection
    saison_teams: AsyncCollection
    bewerbungen: AsyncCollection
    registrierungen: AsyncCollection
    teams: ReadCollection


# The kinds of record an address holds a consent on, each as `FLEinwilligungWithdrawalReport` names it.
type WithdrawalKind = Literal["spieler", "schiedsrichter", "kontakt_seats", "bewerbung_seats", "registrierungen"]

# Every withdrawal choice in its type's order, the order the report lists them in.
_WITHDRAWAL_CHOICES: Final[tuple[FLWithdrawalChoice, ...]] = get_args(FLWithdrawalChoice.__value__)

# A seat's projection: the address `own_seats` judges each seat by, and the block it moves.
_SEAT_FIELDS: Final = {f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung")}


@dataclass(frozen=True, kw_only=True)
class _Kind:
    """How one kind of record is selected by the address, which of its blocks the person holds, and what a choice sets there."""

    report: WithdrawalKind
    collection: DbCollection
    # The unnarrowed selection the erasure reads too: a retired row, a finished season and a decided record included.
    select: Callable[[str], Mapping[str, Any]]
    projection: Mapping[str, Any]
    held_of: Callable[[Mapping[str, Any], str], Held]
    withheld: Mapping[FLWithdrawalChoice, tuple[FLEinwilligungChoice, Any]]


_KINDS: Final = (
    _Kind(
        report="spieler",
        collection=DbCollection.SPIELER,
        select=build_self_pupil_filter,
        projection={"einwilligung": 1},
        held_of=_held_by_the_record,
        withheld=WITHHELD_BY_A_PERSON,
    ),
    _Kind(
        report="schiedsrichter",
        collection=DbCollection.SCHIEDSRICHTER,
        select=build_self_referee_filter,
        projection={EINWILLIGUNG_FIELD: 1},
        held_of=_held_by_the_record,
        withheld=WITHHELD_BY_A_PERSON,
    ),
    _Kind(
        report="kontakt_seats",
        collection=DbCollection.SAISON_TEAMS,
        select=rows_seating,
        projection={"team_id": 1, "name": 1, **_SEAT_FIELDS},
        held_of=_held_on_the_seats,
        withheld=WITHHELD_ON_A_SEAT,
    ),
    _Kind(
        report="bewerbung_seats",
        collection=DbCollection.BEWERBUNGEN,
        select=rows_seating,
        projection={"team_id": 1, "schule": 1, **_SEAT_FIELDS},
        held_of=_held_on_the_seats,
        withheld=WITHHELD_ON_A_SEAT,
    ),
    _Kind(
        report="registrierungen",
        collection=DbCollection.REGISTRIERUNGEN,
        select=build_erasure_registrierung_filter,
        projection={"einwilligung": 1},
        held_of=_held_by_the_record,
        withheld=WITHHELD_BY_A_PERSON,
    ),
)


def _collection_of(records: AddressRecords, kind: _Kind) -> AsyncCollection:
    return {
        DbCollection.SPIELER: records.spieler,
        DbCollection.SCHIEDSRICHTER: records.schiedsrichter,
        DbCollection.SAISON_TEAMS: records.saison_teams,
        DbCollection.BEWERBUNGEN: records.bewerbungen,
        DbCollection.REGISTRIERUNGEN: records.registrierungen,
    }[kind.collection]


@dataclass(frozen=True, kw_only=True)
class _Withdrawal:
    """One record a withdrawal moves: the blocks it withholds on, what it sets there, and the choices of the mail it ends."""

    kind: _Kind
    row: Mapping[str, Any]
    held: Held
    withheld: Mapping[FLEinwilligungChoice, Any]
    # The record's choices the entry moves off a grant, for the journal, whose replay reads a record's own vocabulary.
    moved: tuple[FLEinwilligungChoice, ...]
    ended: frozenset[FLWithdrawalChoice]


async def _withdrawals_at(
    identifier: str, *, choices: AbstractSet[FLWithdrawalChoice], records: AddressRecords, session: AsyncClientSession
) -> list[_Withdrawal]:
    """Every record at the address on which a named choice is granted, read in `session`, in the kinds' order."""

    withdrawals: list[_Withdrawal] = []
    for kind in _KINDS:
        # Typed, as pyright widens a comprehension's literal keys to `str`.
        named: dict[FLWithdrawalChoice, tuple[FLEinwilligungChoice, Any]] = {
            choice: pair for choice, pair in kind.withheld.items() if choice in choices
        }
        withheld = dict(named.values())
        if not withheld:
            continue
        rows = await aggregate_many_from_db(
            collection=_collection_of(records, kind),
            pipeline=[{"$match": kind.select(identifier)}, {"$project": kind.projection}, {"$sort": {"_id": 1}}],
            session=session,
        )
        for row in rows:
            held = kind.held_of(row, identifier)
            moved = withdrawal_line(blocks=list(held.blocks.values()), chosen=withheld)
            if moved is None:
                continue
            ended: frozenset[FLWithdrawalChoice] = frozenset(choice for choice, (record_choice, _) in named.items() if record_choice in moved)
            withdrawals.append(_Withdrawal(kind=kind, row=row, held=held, withheld=withheld, moved=moved, ended=ended))

    return withdrawals


def _report_of(withdrawals: Sequence[_Withdrawal]) -> FLEinwilligungWithdrawalReport:
    """Per kind, the choices the entry ends on any of its records, in the mail's order of `FLWithdrawalChoice`."""

    ended: dict[WithdrawalKind, set[FLWithdrawalChoice]] = {kind.report: set() for kind in _KINDS}
    for withdrawal in withdrawals:
        ended[withdrawal.kind.report] |= withdrawal.ended

    return FLEinwilligungWithdrawalReport.model_validate(
        {kind: [choice for choice in _WITHDRAWAL_CHOICES if choice in chosen] for kind, chosen in ended.items()}
    )


async def preview_withdrawal_at_address(
    identifier: str, *, choices: AbstractSet[FLWithdrawalChoice], records: AddressRecords, session: AsyncClientSession
) -> FLEinwilligungWithdrawalReport:
    """What `withdraw_at_address` would end, read in a snapshot session and writing nothing: the entry's dry run."""

    return _report_of(await _withdrawals_at(identifier, choices=choices, records=records, session=session))


async def withdraw_at_address(
    identifier: str, *, choices: AbstractSet[FLWithdrawalChoice], records: AddressRecords, db: AsyncMongoClient, now: datetime
) -> FLEinwilligungWithdrawalReport:
    """An administrator's entry of a withdrawal the person asked for by mail, on every record the address holds, in one write.

    Withholds each named choice on every block at the address granting it, the name and the media consent on a person's
    own record and WhatsApp and the media consent on a seat, and grants nothing. The records are read again inside the
    transaction, so a record changed since the dry run is judged as it stands. Each record moved is recorded under its
    kind's act and journalled once the transaction lands, as the person's own press is.
    """

    at = utc_stamp(now)
    journal = Journal()

    @journal.attempted
    async def write_the_withdrawals(session: AsyncClientSession) -> FLEinwilligungWithdrawalReport:
        withdrawals = await _withdrawals_at(identifier, choices=choices, records=records, session=session)
        for withdrawal in withdrawals:
            row, kind = withdrawal.row, withdrawal.kind
            collection = _collection_of(records, kind)
            # Past the count, as the person's own press is: no form saves the consent, and the read above in this
            # transaction is what a second withdrawal or a press is judged against.
            await patch_past_the_version_in_db(
                collection=collection,
                db_filter={"_id": row["_id"]},
                update={"$set": compose_mail_withdrawal(blocks=withdrawal.held.blocks, withheld=withdrawal.withheld, at=at)},
                session=session,
            )
            await _record(withdrawal, collection=collection, teams=records.teams, session=session)
            journal.note("withdrawal", [f"{kind.collection}/{row['_id']}"], choices=list(withdrawal.moved), seats=withdrawal.held.seats)

        return _report_of(withdrawals)

    async with journal:
        return await transact(db, write_the_withdrawals)


async def _record(withdrawal: _Withdrawal, *, collection: AsyncCollection, teams: ReadCollection, session: AsyncClientSession) -> None:
    """The Protokoll's row of one record moved: a season row by its club and the row's name, an application by its school.

    Each act a literal at its own call, so the closed list of acts is held to the lines recording them.
    """

    row = withdrawal.row
    match withdrawal.kind.report:
        case "spieler":
            await record_act(collection=collection, action="spieler.einwilligung_withdrawn", record_id=row["_id"], session=session)
        case "schiedsrichter":
            await record_act(collection=collection, action="schiedsrichter.einwilligung_withdrawn", record_id=row["_id"], session=session)
        case "kontakt_seats":
            await record_act(
                collection=collection,
                action="team.seat_einwilligung_withdrawn",
                record_id=row["team_id"],
                label=str(row["name"]),
                session=session,
            )
        case "bewerbung_seats":
            schule = await pull_schule_name(bewerbung_raw=row, teams_collection=teams, session=session)
            await record_act(
                collection=collection, action="bewerbung.seat_einwilligung_withdrawn", record_id=row["_id"], label=schule, session=session
            )
        case "registrierungen":
            await record_act(collection=collection, action="registrierung.einwilligung_withdrawn", record_id=row["_id"], session=session)


def context_teams_lookup(local_field: str) -> Mapping[str, Any]:
    """The clubs a record's `local_field` names, read today as `teams`: the name a registration's entry shows."""

    return {
        "$lookup": {
            "from": DbCollection.TEAMS,
            "localField": local_field,
            "foreignField": "_id",
            "pipeline": [{"$project": {"name": 1}}],
            "as": "teams",
        }
    }


def _account_einwilligung(block: Mapping[str, Any]) -> dict[str, Any]:
    return {"scope": block["scope"], "media": block["media"]}


def _compose_spieler_person(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "spieler_id": row["_id"],
        "first_name": row["first_name"],
        "last_name": row.get("last_name"),
        "birth_date": row.get("birth_date"),
    }


def build_account_pupil_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's pupil row as its account entry and the Funktionen the page judges a grant by read it."""

    return [
        {"$match": build_self_pupil_filter(identifier)},
        {"$project": {"first_name": 1, "last_name": 1, "birth_date": 1, "einwilligung": 1}},
        {"$sort": SELF_PUPIL_ORDER},
    ]


def compose_spieler_account(row: Mapping[str, Any], *, today: str) -> dict[str, Any]:
    """The pupil's account entry: its stored data and its consent."""

    return {
        **_compose_spieler_person(row),
        "einwilligung": _account_einwilligung(row["einwilligung"]),
        "evidence_state": evidence_state_of(blocks=[row["einwilligung"]]),
        "media_offered": media_offered(birth_date=row.get("birth_date"), today=today),
    }


def _compose_schiedsrichter_person(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schiedsrichter_id": row["_id"],
        "name": row["name"],
        "schule": row.get("schule"),
        "kontakt": row["kontakt"],
        "birth_date": row.get("birth_date"),
    }


def build_account_referee_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """This address's referee rows as their account entries and the Funktionen the page judges a grant by read them."""

    return [
        {"$match": build_self_referee_filter(identifier)},
        {
            "$project": {
                "name": 1,
                "schule": 1,
                "kontakt": 1,
                "birth_date": 1,
                "default_payment": 1,
                "inactive_since": 1,
                EINWILLIGUNG_FIELD: 1,
            }
        },
        {"$sort": SELF_REFEREE_ORDER},
    ]


def compose_schiedsrichter_account(row: Mapping[str, Any], *, givable: bool, today: str) -> dict[str, Any]:
    """One referee row's account entry: its stored data, its fee and its consent."""

    return {
        **_compose_schiedsrichter_person(row),
        "default_payment": row["default_payment"],
        "einwilligung": _account_einwilligung(row["einwilligung"]),
        "evidence_state": evidence_state_of(blocks=[row["einwilligung"]]),
        "givable": givable,
        "media_offered": media_offered(birth_date=row.get("birth_date"), today=today),
    }


# What a held seat's entry serves of its person beside the address and the consent, which `_seat_persons` reads.
_SEAT_PERSON_FIELDS: Final = ("first_name", "last_name", "phone", "birth_date")


def build_self_seat_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every season row one of whose seats names the address, `own_seats` judging each seat.

    No `austritt` term: a withdrawal reaches a withdrawn team's seat too. Each row carries its season's status, so the page
    reads none apart.
    """

    return [
        {"$match": rows_seating(identifier)},
        {
            "$project": {
                "saison_id": 1,
                "team_id": 1,
                "name": 1,
                "shorthand": 1,
                # Read by the Funktionen the page judges a grant by, which come from these rows.
                "austritt": 1,
                **{f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung", *_SEAT_PERSON_FIELDS)},
            }
        },
        # A past season's row after a running one's, the last key unique so no two rows tie.
        {"$sort": {"saison_id": -1, "name": 1, "team_id": 1}},
        # Read by the same Funktionen.
        SAISON_LOOKUP,
    ]


def seat_choices_of_row(blocks: Sequence[Mapping[str, Any]]) -> dict[FLEinwilligungChoice, Any]:
    """Each choice as the account page serves one person's seats on a row: on where any held seat's is, so a withdrawal stays offered.

    One person's seats on a row may disagree, each seat's link being answered on its own.
    """

    return {
        "scope": "kontakt_data_whatsapp" if any(is_given("scope", block.get("scope")) for block in blocks) else "kontakt_data",
        "media": any(is_given("media", block.get("media")) for block in blocks),
    }


def changed_seat_choices(
    *, blocks: Sequence[Mapping[str, Any]], pressed: Mapping[FLEinwilligungChoice, Any]
) -> dict[FLEinwilligungChoice, Any]:
    """The choices a seat press changed against the row its page served; one sent back as shown is no grant and no move.

    On seats answered apart, moving it would grant one what was never pressed.
    """

    shown = seat_choices_of_row(blocks)

    return {choice: value for choice, value in pressed.items() if value != shown[choice]}


def _seat_choices_held(held: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    blocks = [person["einwilligung"] for person in held]

    return {**seat_choices_of_row(blocks), "evidence_state": evidence_state_of(blocks=blocks)}


def _seat_persons(row: Mapping[str, Any], seats: Sequence[str]) -> list[dict[str, Any]]:
    """What each held seat stores of its person, in the seats' order: one person may be typed two ways on two seats."""

    return [{"seat": seat, **{field: row["kontakte"][seat].get(field) for field in _SEAT_PERSON_FIELDS}} for seat in seats]


def compose_seats_self(
    rows: Sequence[Mapping[str, Any]],
    identifier: str,
    *,
    seats_with_panel: Sequence[FLSubjectSeat],
    today: str,
) -> list[dict[str, Any]]:
    """One entry per season row on which this address holds a confirmed seat, the seat PATCH moving a person's seats together."""

    entries = []
    for row in rows:
        seats = own_seats(row, identifier)
        if not seats:
            continue
        held = [row["kontakte"][seat] for seat in seats]
        entries.append(
            {
                "team_id": row["team_id"],
                "team_name": row["name"],
                "saison_id": row["saison_id"],
                "seats": seats,
                "persons": _seat_persons(row, seats),
                **_seat_choices_held(held),
                "media_offered": all(media_offered(birth_date=person.get("birth_date"), today=today) for person in held),
                "givable": holds_a_seat(seats_with_panel, team_id=row["team_id"], saison_id=row["saison_id"]),
            }
        )

    return entries


def build_self_bewerbung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending application with a seat at the address, `own_seats` then keeping the confirmed ones as on a season row."""

    return [
        {"$match": build_own_bewerbung_filter(identifier)},
        {
            "$project": {
                "saison_id": 1,
                **{f"kontakte.{seat}.{field}": 1 for seat in KONTAKT_SEATS for field in ("email", "einwilligung", *_SEAT_PERSON_FIELDS)},
            }
        },
        {"$sort": {"saison_id": -1, "_id": 1}},
    ]


def compose_bewerbung_seats_self(rows: Sequence[Mapping[str, Any]], identifier: str) -> list[dict[str, Any]]:
    """One entry per pending application on which this address holds a confirmed seat, as `compose_seats_self` answers a row."""

    entries = []
    for row in rows:
        seats = own_seats(row, identifier)
        if not seats:
            continue
        held = [row["kontakte"][seat] for seat in seats]
        entries.append(
            {
                "bewerbung_id": row["_id"],
                "saison_id": row["saison_id"],
                "seats": seats,
                "persons": _seat_persons(row, seats),
                **_seat_choices_held(held),
            }
        )

    return entries


def build_self_registrierung_pipeline(identifier: str) -> list[Mapping[str, Any]]:
    """Every pending registration at the address, `is_own_registrierung` then keeping the confirmed ones as the gate does."""

    return [
        {"$match": build_own_registrierung_filter(identifier)},
        {
            "$project": {
                field: 1
                for field in (
                    "saison_id",
                    "team_id",
                    "status",
                    "email",
                    "first_name",
                    "last_name",
                    "birth_date",
                    "einwilligung",
                )
            }
        },
        {"$sort": {"saison_id": -1, "_id": 1}},
        context_teams_lookup("team_id"),
    ]


def compose_registrierungen_self(
    rows: Sequence[Mapping[str, Any]], identifier: str, *, teams: Mapping[Any, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """One entry per pending registration of this address its pupil confirmed."""

    entries = []
    for row in rows:
        if not is_own_registrierung(row, identifier):
            continue
        block = row["einwilligung"]
        team = teams.get(row["team_id"])
        entries.append(
            {
                "registrierung_id": row["_id"],
                "team_name": None if team is None else team.get("name"),
                "saison_id": row["saison_id"],
                "scope": block["scope"],
                "media": is_given("media", block["media"]),
                "evidence_state": evidence_state_of(blocks=[block]),
                **{field: row.get(field) for field in ("first_name", "last_name", "birth_date")},
            }
        )

    return entries
