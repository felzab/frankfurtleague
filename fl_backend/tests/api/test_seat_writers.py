"""
API · every write moving a season row's seats calls the void in its own function

A source sweep over `fl_backend/app`: each seat writer keeps its own `patch_one_in_db`, whose filter and update the write
traces read, so nothing but this sweep holds it to `app/api/teams/crud.py :: void_moved_seats` (`docs/backend/spec.md ::
I758`). A writer forgetting the void leaves the old holder's match links answering, which no response shows.
"""

import ast
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from app.api.teams.crud import void_moved_seats
from app.core.collections import Collection
from tests.core.app_source import (
    APP_ROOT,
    BACKEND_ROOT,
    COLLECTION_ARGUMENT_SUFFIX,
    WRITE_HELPERS,
    Declaration,
    bound_at,
    callee,
    parsed,
    resolve_callee,
    scoped_calls,
)

# The calls changing a document already stored: an insert seats nobody a link was mailed to.
UPDATE_HELPERS: Final = frozenset({"patch_one_in_db", "patch_many_in_db"}) & WRITE_HELPERS
DRIVER_UPDATES: Final = frozenset({"find_one_and_update", "find_one_and_replace", "replace_one", "update_many", "update_one", "bulk_write"})

SEATS_HANDLE: Final = f"{Collection.SAISON_TEAMS}{COLLECTION_ARGUMENT_SUFFIX}"
SEATS_MEMBER: Final = f"{Collection.__name__}.{Collection.SAISON_TEAMS.name}"
VOID: Final = void_moved_seats.__name__

# `app/core/crud.py` declares the helpers every writer calls, writing whatever it is handed.
DECLARING_THE_HELPERS: Final = APP_ROOT / "core" / "crud.py"

# Each writer that may reach a season row's seats and moves no holder, by module and function, and why.
NOT_VOIDING: Final[Mapping[str, str]] = {
    # Its body is `FLPatchSaisonTeamPayload`, which declares no `kontakte`: the block is the contacts save's.
    "app/api/teams/admin_router.py::move_the_club": "the club's group and colour, never a seat",
    "app/api/teams/person_router.py::write": "a seat holder's own consent, moving their record and never who holds the seat",
    "app/api/identitaet/wiederherstellung.py::rewrite_withdrawal": "a withdrawal replayed onto the record of the person still seated",
    "app/api/zustellung/router.py::write_the_state": "a message's delivery state beside the seat it went to",
}


@dataclass(frozen=True)
class SeatWrite:
    """One function writing a season row's seats, directly or by handing the row's collection to a writer."""

    where: str
    voids: bool


def _key(module: Path, scope: str, root: Path) -> str:
    return f"{module.relative_to(root).as_posix()}::{scope}"


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


def _handle(target: ast.expr | None, function: Declaration | None) -> str:
    """`seats`, `parameter:<name>`, `another` or `unread`: what one write's collection argument names."""

    if isinstance(target, ast.Name):
        if target.id == SEATS_HANDLE:
            return "seats"
        if function is not None and target.id in _parameters(function):
            return f"parameter:{target.id}"
        return "another" if target.id.endswith(COLLECTION_ARGUMENT_SUFFIX) else "unread"
    if isinstance(target, ast.Subscript):
        member = ast.unparse(target.slice)
        if member == SEATS_MEMBER:
            return "seats"
        return "another" if member.startswith(f"{Collection.__name__}.") else "unread"

    return "unread"


def _voids(function: Declaration | None, module: ast.Module) -> bool:
    return any(isinstance(node, ast.Call) and callee(node) == VOID for node in ast.walk(function or module))


def _calls(modules: Iterable[Path]) -> Iterator[tuple[Path, tuple[Declaration, ...], ast.Call]]:
    for module in modules:
        for chain, call in scoped_calls(parsed(module), ()):
            yield module, chain, call


def seat_writes(modules: Iterable[Path], root: Path = BACKEND_ROOT) -> frozenset[SeatWrite]:
    """Every function writing a season row's seats: by the row's own handle, by one the sweep cannot read, or through a helper."""

    modules = tuple(modules)
    found: set[SeatWrite] = set()
    # A writer taking its collection as a parameter, by the declaration and the parameter: its callers answer for it.
    relays: dict[int, tuple[str, int | None]] = {}

    for module, chain, call in _calls(modules):
        if not _is_an_update(call):
            continue
        function = chain[-1] if chain else None
        handle = _handle(_collection_of(call), function)
        if handle in ("seats", "unread") and _may_move_a_seat(_update_of(call)):
            found.add(SeatWrite(_key(module, function.name if function else "<module>", root), _voids(function, parsed(module))))
        elif handle.startswith("parameter:") and function is not None:
            parameter = handle.removeprefix("parameter:")
            positional = [argument.arg for argument in (*function.args.posonlyargs, *function.args.args)]
            relays[id(function)] = (parameter, positional.index(parameter) if parameter in positional else None)

    for module, chain, call in _calls(modules):
        resolved = resolve_callee(call, chain, module)
        relay = relays.get(id(resolved[0])) if resolved is not None else None
        if relay is not None and bound_at(call, *relay).argument == SEATS_HANDLE:
            function = chain[-1] if chain else None
            found.add(SeatWrite(_key(module, function.name if function else "<module>", root), _voids(function, parsed(module))))

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
        "app/api/teams/admin_router.py::rewrite_the_block",
        "app/api/teams/admin_router.py::hand_the_row_over",
        "app/api/kontakte/crud.py::erase_kontaktperson_in_session",
        "app/api/bewerbungen/sweep_router.py::clear_the_blocks",
        "app/api/bewerbungen/einwilligung_router.py::answer_on_the_season_row",
        "app/api/identitaet/wiederherstellung.py::rewrite_widerspruch",
    }


SAMPLE: Final = """\
async def direct(saison_teams_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte.trainer": None}}, session=session)


async def direct_and_voided(saison_teams_collection, spielbestaetigungen_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"kontakte": None}}, session=session)
    await void_moved_seats(spielbestaetigungen_collection=spielbestaetigungen_collection, voids=[], session=session)


async def no_seat(saison_teams_collection, session):
    await patch_one_in_db(collection=saison_teams_collection, db_filter={}, update={"$set": {"gruppe": "A"}}, session=session)


async def unread_update(saison_teams_collection, update, session):
    await saison_teams_collection.update_one({}, update, session=session)


async def relay(collection, session):
    await patch_one_in_db(collection=collection, db_filter={}, update={"$set": {f"kontakte.{session}": None}}, session=session)


async def through_the_relay(saison_teams_collection, session):
    await relay(saison_teams_collection, session)


async def through_the_relay_elsewhere(bewerbungen_collection, session):
    await relay(bewerbungen_collection, session)
"""


def test_the_reader_tells_each_shape_apart(tmp_path: Path):
    """The control for the reader's reach: the tree's writers are uniform enough that a reader stopping early passes over them."""

    sample = tmp_path / "sample.py"
    sample.write_bytes(SAMPLE.encode("utf-8"))

    found = {(write.where, write.voids) for write in seat_writes([sample], tmp_path)}

    assert found == {
        ("sample.py::direct", False),
        ("sample.py::direct_and_voided", True),
        ("sample.py::unread_update", False),
        ("sample.py::through_the_relay", False),
    }
