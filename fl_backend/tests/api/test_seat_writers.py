"""
API · every write moving a season row's seats calls the void after it, in its own function

A source sweep over `fl_backend/app`: each seat writer keeps its own `patch_one_in_db`, whose filter and update the write
traces read, so nothing but this sweep holds it to `app/api/teams/crud.py :: void_moved_seats` (`docs/backend/spec.md ::
I758`). A writer forgetting the void leaves the old holder's match links answering, which no response shows.

Read conservatively: a collection or an update the sweep cannot name counts as the season rows' and as moving a seat, so
what it cannot read is a writer to answer for rather than a writer passed over.
"""

import ast
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NamedTuple

from app.api.kontakte.crud import clear_seats
from app.api.teams.crud import void_moved_seats
from app.api.teams.schemas import FLPatchSaisonTeamPayload
from app.api.teams.services import departing_holders
from app.core.collections import Collection
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    WRITE_HELPERS,
    Declaration,
    callee,
    module_of,
    parsed,
    resolve_reference,
    scoped_calls,
)

# The calls changing a document already stored: an insert seats nobody a link was mailed to.
UPDATE_HELPERS: Final = frozenset({"patch_one_in_db", "patch_many_in_db"}) & WRITE_HELPERS
DRIVER_UPDATES: Final = frozenset({"find_one_and_update", "find_one_and_replace", "replace_one", "update_many", "update_one", "bulk_write"})

SEATS_HANDLE: Final = f"{Collection.SAISON_TEAMS}{COLLECTION_ARGUMENT_SUFFIX}"
SEATS_MEMBER: Final = f"{Collection.__name__}.{Collection.SAISON_TEAMS.name}"
# Every other collection, by its dependency's name and by its member: a handle outside these may hold the seats.
OTHER_HANDLES: Final = frozenset(f"{member}{COLLECTION_ARGUMENT_SUFFIX}" for member in Collection if member is not Collection.SAISON_TEAMS)
OTHER_MEMBERS: Final = frozenset(f"{Collection.__name__}.{member.name}" for member in Collection if member is not Collection.SAISON_TEAMS)
VOID: Final = void_moved_seats.__name__
# `functools.partial` binds a helper's arguments where it is built, so the write is answered for there.
BINDS_LATER: Final = "partial"

# `app/core/crud.py` declares the helpers every writer calls, writing whatever it is handed.
DECLARING_THE_HELPERS: Final = APP_ROOT / "core" / "crud.py"

# Each writer that may reach a season row's seats and moves no holder, by module and its function's whole chain, and why.
NOT_VOIDING: Final[Mapping[str, str]] = {
    # Its body is `FLPatchSaisonTeamPayload`, which declares no `kontakte` (`test_the_club_move_carries_no_seat`).
    "app/api/teams/admin_router.py::patch_saison_team.move_the_club": "the club's group and colour, never a seat",
    "app/api/teams/person_router.py::patch_einwilligung.write": "a seat holder's own consent, moving their record and never who holds the seat",
    "app/api/identitaet/wiederherstellung.py::_plan_widerruf.rewrite_withdrawal": "a withdrawal replayed onto the seated person's record",
    "app/api/zustellung/router.py::_apply.write_the_state": "a message's delivery state beside the seat it went to",
}


@dataclass(frozen=True)
class SeatWrite:
    """One function writing a season row's seats, directly or by handing the row's collection to a writer."""

    where: str
    voids: bool


class Handle(NamedTuple):
    """What one write's collection argument names: the season rows, another collection, one unread, or a parameter."""

    kind: str
    scope: Declaration | None = None
    parameter: str = ""


SEATS: Final = Handle("seats")
UNREAD: Final = Handle("unread")
ANOTHER: Final = Handle("another")
# Where one name holds several values, the one reaching the seats answers.
_RISK: Final = {"seats": 0, "unread": 1, "parameter": 2, "another": 3}


class Relay(NamedTuple):
    """A writer taking its collection as a parameter, which its callers answer for."""

    parameter: str
    position: int | None


def _key(module: Path, chain: tuple[Declaration, ...]) -> str:
    where = module.relative_to(BACKEND_ROOT).as_posix() if module.is_relative_to(BACKEND_ROOT) else module.name

    return f"{where}::{'.'.join(scope.name for scope in chain) or '<module>'}"


def _is_an_update(call: ast.Call) -> bool:
    return callee(call) in UPDATE_HELPERS or (isinstance(call.func, ast.Attribute) and callee(call) in DRIVER_UPDATES)


def _collection_of(call: ast.Call) -> ast.expr | None:
    named = next((keyword.value for keyword in call.keywords if keyword.arg == "collection"), None)

    return call.func.value if named is None and isinstance(call.func, ast.Attribute) else named


def _update_of(call: ast.Call) -> ast.expr | None:
    named = next((keyword.value for keyword in call.keywords if keyword.arg == "update"), None)

    return call.args[1] if named is None and isinstance(call.func, ast.Attribute) and len(call.args) > 1 else named


def _names_a_seat(key: ast.expr | None) -> bool:
    """A key the block or a seat sits under, or one the sweep cannot read, which may be either."""

    if isinstance(key, ast.JoinedStr) and key.values and isinstance(key.values[0], ast.Constant):
        key = key.values[0]
    if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
        return True

    return key.value == "kontakte" or key.value.startswith("kontakte.")


def _may_move_a_seat(update: ast.expr | None) -> bool:
    """Read off the literal: an update naming no seat under any operator moves none, and anything else may."""

    if not isinstance(update, ast.Dict):
        return True

    for operator, fields in zip(update.keys, update.values, strict=True):
        if operator is None or not isinstance(fields, ast.Dict):
            return True
        if any(_names_a_seat(field) for field in fields.keys):
            return True

    return False


def _parameters(function: Declaration) -> list[str]:
    arguments = function.args

    return [argument.arg for argument in (*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs)]


def _own_nodes(scope: Declaration) -> Iterator[ast.AST]:
    """Every node of one function's own body, a nested function's or class's left to that scope."""

    pending: list[ast.AST] = list(scope.body)
    while pending:
        node = pending.pop()
        yield node
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            pending.extend(ast.iter_child_nodes(node))


def _bindings(scope: Declaration) -> dict[str, list[ast.expr | None]]:
    """Each name one function binds, to every value it is assigned; `None` for a binding no value reads off, a loop's or an unpacking's."""

    bound: dict[str, list[ast.expr | None]] = {}
    read: set[int] = set()
    nodes = list(_own_nodes(scope))
    for node in nodes:
        if isinstance(node, ast.Assign):
            named = [target for target in node.targets if isinstance(target, ast.Name)]
            pairs = [(target, node.value) for target in named]
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and isinstance(node.target, ast.Name) and node.value is not None:
            pairs = [(node.target, node.value)]
        else:
            continue
        for target, value in pairs:
            bound.setdefault(target.id, []).append(value)
            read.add(id(target))
    for node in nodes:
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and id(node) not in read:
            bound.setdefault(node.id, []).append(None)

    return bound


def _handle(target: ast.expr | None, chain: tuple[Declaration, ...], following: frozenset[str] = frozenset()) -> Handle:
    """What a collection argument names, a local handle followed to the value it holds, to a fixpoint."""

    if isinstance(target, ast.Subscript):
        member = ast.unparse(target.slice)
        if member == SEATS_MEMBER:
            return SEATS
        return ANOTHER if member in OTHER_MEMBERS else UNREAD
    if not isinstance(target, ast.Name):
        return UNREAD
    if target.id == SEATS_HANDLE:
        return SEATS

    for depth in range(len(chain) - 1, -1, -1):
        scope = chain[depth]
        if target.id in _parameters(scope):
            return Handle("parameter", scope, target.id)
        values = _bindings(scope).get(target.id)
        if values is not None:
            if target.id in following:
                return UNREAD
            held = [UNREAD if value is None else _handle(value, chain[: depth + 1], following | {target.id}) for value in values]
            return min(held, key=lambda handle: _RISK[handle.kind])

    # Neither a parameter nor bound here: only another collection's dependency name says what it holds.
    return ANOTHER if target.id in OTHER_HANDLES else UNREAD


def _is_empty(value: ast.expr) -> bool:
    """A `voids` the void returns on unread: no seat void at all, or `None`s alone."""

    if isinstance(value, (ast.List, ast.Tuple, ast.Set)):
        return all(isinstance(element, ast.Constant) and element.value is None for element in value.elts)
    if isinstance(value, ast.Dict):
        return not value.keys
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id in ("list", "tuple", "set", "frozenset"):
        return not value.args

    return isinstance(value, ast.Constant) and value.value is None


def _voids_after(write: ast.Call, chain: tuple[Declaration, ...], module: Path) -> bool:
    """A void call in the write's own function, AFTER the write in the source, handed a `voids` that may hold one."""

    scope = chain[-1] if chain else parsed(module)
    end = (write.end_lineno or write.lineno, write.end_col_offset or write.col_offset)

    for inner, call in scoped_calls(scope, chain):
        if len(inner) != len(chain) or callee(call) != VOID or (call.lineno, call.col_offset) <= end:
            continue
        voids = next((keyword.value for keyword in call.keywords if keyword.arg == "voids"), None)
        if voids is not None and not _is_empty(voids):
            return True

    return False


def _argument(call: ast.Call, relay: Relay) -> ast.expr | None:
    """The expression one call hands a relay's collection parameter; `None` where it binds nothing, a `**` spread unread."""

    for keyword in call.keywords:
        if keyword.arg == relay.parameter:
            return keyword.value
    if relay.position is not None and len(call.args) > relay.position:
        return call.args[relay.position]
    if any(keyword.arg is None for keyword in call.keywords):
        return ast.Name(id="<spread>", ctx=ast.Load())

    return None


def _as_called(call: ast.Call) -> ast.Call:
    """A `partial(helper, ...)` read as the call to `helper` it binds, at the place it binds it."""

    if callee(call) != BINDS_LATER or not call.args:
        return call

    return ast.copy_location(ast.Call(func=call.args[0], args=call.args[1:], keywords=call.keywords), call)


def _calls(modules: Iterable[Path]) -> Iterator[tuple[Path, tuple[Declaration, ...], ast.Call]]:
    for module in modules:
        for chain, call in scoped_calls(parsed(module), ()):
            yield module, chain, call


def _relay_of(handle: Handle) -> tuple[int, Relay] | None:
    if handle.kind != "parameter" or handle.scope is None:
        return None
    positional = [argument.arg for argument in (*handle.scope.args.posonlyargs, *handle.scope.args.args)]

    return id(handle.scope), Relay(handle.parameter, positional.index(handle.parameter) if handle.parameter in positional else None)


def seat_writes(modules: Iterable[Path]) -> frozenset[SeatWrite]:
    """Every function writing a season row's seats: by the row's own handle, by one the sweep cannot read, or through a relay."""

    calls = list(_calls(modules))
    found: set[SeatWrite] = set()
    relays: dict[int, Relay] = {}

    for module, chain, call in calls:
        if not _is_an_update(call) or not _may_move_a_seat(_update_of(call)):
            continue
        handle = _handle(_collection_of(call), chain)
        if handle in (SEATS, UNREAD):
            found.add(SeatWrite(_key(module, chain), _voids_after(call, chain, module)))
        elif (relay := _relay_of(handle)) is not None:
            relays.setdefault(*relay)

    # To a fixpoint: a relay handing its own parameter on makes its caller's caller answer.
    while True:
        known = len(relays)
        for module, chain, call in calls:
            called = _as_called(call)
            if not isinstance(called.func, (ast.Name, ast.Attribute)):
                continue
            resolved = resolve_reference(called.func, chain, module)
            relay = relays.get(id(resolved[0])) if resolved is not None else None
            argument = _argument(called, relay) if relay is not None else None
            if argument is None:
                continue
            handle = _handle(argument, chain)
            if handle in (SEATS, UNREAD):
                found.add(SeatWrite(_key(module, chain), _voids_after(called, chain, module)))
            elif (onward := _relay_of(handle)) is not None:
                relays.setdefault(*onward)
        if len(relays) == known:
            return frozenset(found)


def _app_modules() -> list[Path]:
    return [path for path in sorted(APP_ROOT.rglob("*.py")) if path != DECLARING_THE_HELPERS]


def test_every_seat_writer_voids_or_is_listed_with_why_it_moves_no_holder():
    """Both ways: a writer dropping its void call is named here, and a listed one that voids, or writes no seat, is too."""

    writes = seat_writes(_app_modules())

    assert sorted(write.where for write in writes if not write.voids) == sorted(NOT_VOIDING)


def test_the_sweep_finds_the_writers_it_exists_for():
    """A floor of the six that move a holder, so a reader that stops finding writers cannot pass by finding none."""

    voiding = {write.where for write in seat_writes(_app_modules()) if write.voids}

    assert voiding >= {
        "app/api/teams/admin_router.py::patch_saison_team_kontakte.rewrite_the_block",
        "app/api/teams/admin_router.py::replace_saison_team.hand_the_row_over",
        "app/api/kontakte/crud.py::erase_kontaktperson_in_session",
        "app/api/bewerbungen/sweep_router.py::sweep_saison.clear_the_blocks",
        "app/api/bewerbungen/einwilligung_router.py::post_einwilligung.answer_on_the_season_row",
        "app/api/identitaet/wiederherstellung.py::_plan_widerspruch.rewrite_widerspruch",
    }


def test_only_the_contacts_editor_tells_whom_it_took_off_the_row():
    """An erasure, a Widerspruch, the season's end and a club replacement send no leaving notice, and an address move keeps its person."""

    telling = {_key(module, chain) for module, chain, call in _calls(_app_modules()) if callee(call) == departing_holders.__name__}

    assert telling == {"app/api/teams/admin_router.py::patch_saison_team_kontakte.rewrite_the_block"}


def test_the_club_move_carries_no_seat():
    """`move_the_club`'s listing rests on this: it `$set`s its payload's dump whole, so a `kontakte` field there would move seats unvoided."""

    assert "kontakte" not in FLPatchSaisonTeamPayload.model_fields
    assert FLPatchSaisonTeamPayload.model_config.get("extra") == "forbid"


SAMPLE: Final = """\
import functools

from app.api.kontakte import crud
from app.api.kontakte.crud import clear_seats


async def direct(saison_teams_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte.trainer": None}}, session=session)


async def direct_and_voided(saison_teams_collection, spielbestaetigungen_collection, voids, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)


async def voided_before(saison_teams_collection, spielbestaetigungen_collection, voids, session):
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=voids, session=session)
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)


async def voided_with_none(saison_teams_collection, spielbestaetigungen_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=[], session=session)


async def no_seat(saison_teams_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"gruppe": "A"}}, session=session)


async def unread_update(saison_teams_collection, update, session):
    await saison_teams_collection.update_one({}, update, session=session)


async def local_handle(database, session):
    junction_collection = database[Collection.SAISON_TEAMS]
    await patch_one_in_db(collection=junction_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)


async def misnamed_handle(database, session):
    bewerbungen_collection = database[Collection.SAISON_TEAMS]
    await patch_one_in_db(collection=bewerbungen_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)


async def another_handle(database, session):
    junction_collection = database[Collection.BEWERBUNGEN]
    await patch_one_in_db(collection=junction_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)


async def relay(collection, session):
    await patch_one_in_db(collection=collection, db_filter={}, update={"$set": {f"kontakte.{session}": None}}, session=session)


async def relay_of_the_relay(collection, session):
    await relay(collection, session)


async def through_the_relay(saison_teams_collection, session):
    await relay(saison_teams_collection, session)


async def through_the_relay_by_member(database, session):
    await relay(database[Collection.SAISON_TEAMS], session)


async def through_the_relay_elsewhere(bewerbungen_collection, database, session):
    await relay(bewerbungen_collection, session)
    await relay(database[Collection.BEWERBUNGEN], session)


async def through_two_relays(saison_teams_collection, session):
    await relay_of_the_relay(saison_teams_collection, session)


async def through_a_module_attribute(database, rows, session):
    await crud.clear_seats(database[Collection.SAISON_TEAMS], rows, set(), session)


async def through_a_partial(saison_teams_collection, rows, session):
    clear = functools.partial(clear_seats, saison_teams_collection)
    await clear(rows, set(), session)


async def first_route(saison_teams_collection):
    async def write(session):
        await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)

    return write


async def second_route(saison_teams_collection):
    async def write(session):
        await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)

    return write
"""


def test_the_reader_tells_each_shape_apart(tmp_path: Path):
    """The tree's writers are uniform enough that a reader stopping early passes them, so a sample holds its reach.

    Read beside `clear_seats`'s module, a relay the tree holds, so a module attribute or a `partial` reaching it resolves.
    """

    sample = tmp_path / "sample.py"
    sample.write_bytes(SAMPLE.encode("utf-8"))

    found = {(write.where, write.voids) for write in seat_writes([sample, module_of(clear_seats)]) if write.where.startswith("sample.py::")}

    assert found == {
        ("sample.py::direct", False),
        ("sample.py::direct_and_voided", True),
        ("sample.py::voided_before", False),
        ("sample.py::voided_with_none", False),
        ("sample.py::unread_update", False),
        ("sample.py::local_handle", False),
        ("sample.py::misnamed_handle", False),
        ("sample.py::through_the_relay", False),
        ("sample.py::through_the_relay_by_member", False),
        ("sample.py::through_two_relays", False),
        ("sample.py::through_a_module_attribute", False),
        ("sample.py::through_a_partial", False),
        ("sample.py::first_route.write", False),
        ("sample.py::second_route.write", False),
    }
