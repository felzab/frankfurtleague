import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final, NamedTuple

import pytest
from pydantic import TypeAdapter

from app.api.identitaet.schemas import LoeschungAdresse
from app.shared.folding import canonical_address, league_address, sign_in_identifier

# One table both suites run their own rule and fold over, the frontend half in `fl_frontend/src/core/emailAddress.test.ts`:
# each runtime converts a Unicode domain on its own tables, held here to one answer, or each to its own where they part.
EMAIL_ADDRESSES: Final = Path(__file__).resolve().parent / "email_addresses.json"

# Recorded under the keying every stored ban was hashed with, and only ever appended to: a null is a
# probe the address rule now refuses.
BAN_KEYS: Final = Path(__file__).resolve().parent / "ban_keys.json"


class Answer(NamedTuple):
    stored: str | None
    folded: str


class Row(NamedTuple):
    case: str
    typed: str
    # What a payload stores, or `None` where the rule refuses the address.
    stored: str | None
    folded: str
    # The frontend's own answer where the two runtimes' tables part.
    frontend: Answer | None = None


def _row(row: Mapping[str, Any]) -> Row:
    frontend = row.get("frontend")

    return Row(**{**row, "frontend": None if frontend is None else Answer(**frontend)})


def _rows() -> tuple[Row, ...]:
    return tuple(_row(row) for row in json.loads(EMAIL_ADDRESSES.read_bytes().decode("utf-8")))


ROWS: Final = _rows()


def _key(probe: str) -> str | None:
    try:
        return canonical_address(probe)
    except ValueError:
        return None


def test_the_table_holds_each_kind_of_row():
    """Two runtimes agree on any table the rule answers alike throughout, so each kind has to be in it to be compared."""

    assert any(row.stored is None for row in ROWS), "no row is refused"
    assert any(row.stored is not None and not row.typed.isascii() for row in ROWS), "no row converts a Unicode domain"
    assert any(row.folded != row.typed for row in ROWS), "the fold changes no row"
    assert any(row.folded == row.typed for row in ROWS), "the fold leaves no row alone"


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row.case)
def test_a_payload_stores_each_row_as_the_table_records(row: Row):
    if row.stored is None:
        with pytest.raises(ValueError):
            league_address(row.typed)
    else:
        assert league_address(row.typed) == row.stored


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row.case)
def test_the_fold_answers_each_row_as_the_table_records(row: Row):
    assert sign_in_identifier(row.typed) == row.folded


def test_every_parting_recorded_still_parts():
    """An upgrade closing one leaves the two sides one answer, which its row then records once, its `frontend` removed."""

    assert [row.case for row in ROWS if row.frontend == Answer(row.stored, row.folded)] == []


ERASURE_LOOKUP: Final = TypeAdapter(LoeschungAdresse)


@pytest.mark.parametrize("row", ROWS, ids=lambda row: row.case)
def test_the_erasure_lookup_asks_for_the_mailbox_the_row_folds_to(row: Row):
    """The page ends the sign-in account its own trimmed box folds to: a lookup trimming otherwise erases another mailbox's records."""

    assert sign_in_identifier(ERASURE_LOOKUP.validate_python(row.typed)) == row.folded


@pytest.mark.parametrize("row", [row for row in ROWS if row.stored is not None], ids=lambda row: row.case)
def test_what_a_payload_stores_is_ascii_and_the_typed_address_s_fold(row: Row):
    """So a typed address, folded, meets the row its payload stored by equality."""

    assert row.stored is not None
    assert row.stored.isascii()
    assert row.stored == row.folded


@pytest.mark.parametrize(("probe", "key"), sorted(json.loads(BAN_KEYS.read_bytes().decode("utf-8")).items()), ids=ascii)
def test_every_ban_key_is_the_one_recorded(probe: str, key: str | None):
    """An upgrade of `email-validator` or `idna` moving one un-bans in silence, the address behind a hash being kept nowhere."""

    assert _key(probe) == key


@pytest.mark.parametrize("row", [row for row in ROWS if row.stored is not None], ids=lambda row: row.case)
def test_a_typed_address_and_what_its_payload_stored_key_one_ban(row: Row):
    """Every keying site hashes a payload's output or a stored row's spelling.

    So the key must not move between an address and what its payload stores.
    """

    assert row.stored is not None
    assert canonical_address(row.typed) == canonical_address(row.stored)
