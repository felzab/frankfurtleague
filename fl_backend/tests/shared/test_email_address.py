import json
from pathlib import Path
from typing import Final, NamedTuple

import pytest
from pydantic import TypeAdapter, ValidationError

from app.api.identity.schemas import LoeschungAdresse
from app.shared.folding import league_address, sign_in_identifier

# One table both suites run their own rule and fold over, the frontend half in `fl_frontend/src/core/emailAddress.test.ts`,
# so the two folds cannot part.
EMAIL_ADDRESSES: Final = Path(__file__).resolve().parent / "email_addresses.json"


class Row(NamedTuple):
    case: str
    typed: str
    # What a payload stores, or `None` where the rule refuses the address.
    stored: str | None
    folded: str


ROWS: Final = tuple(Row(**row) for row in json.loads(EMAIL_ADDRESSES.read_bytes().decode("utf-8")))


def test_the_table_holds_each_kind_of_row():
    """Two runtimes agree on any table the rule answers alike throughout, so each kind has to be in it to be compared."""

    assert any(row.stored is None for row in ROWS), "no row is refused"
    assert any(row.stored is None and not row.typed.rpartition("@")[2].isascii() for row in ROWS), "no row refuses a Unicode domain"
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


ERASURE_LOOKUP: Final = TypeAdapter(LoeschungAdresse)


def _ascii_domain(row: Row) -> bool:
    return row.folded.rpartition("@")[2].isascii()


@pytest.mark.parametrize("row", [row for row in ROWS if _ascii_domain(row)], ids=lambda row: row.case)
def test_the_erasure_lookup_asks_for_the_mailbox_the_row_folds_to(row: Row):
    """The page ends the sign-in account its own trimmed box folds to: a lookup trimming otherwise erases another mailbox's records."""

    assert sign_in_identifier(ERASURE_LOOKUP.validate_python(row.typed)) == row.folded


@pytest.mark.parametrize("row", [row for row in ROWS if not _ascii_domain(row)], ids=lambda row: row.case)
def test_the_erasure_lookup_refuses_a_domain_no_row_stores(row: Row):
    """Every stored domain is ASCII, so the lookup tells its administrator so rather than answering that nothing is held."""

    with pytest.raises(ValidationError) as raised:
        ERASURE_LOOKUP.validate_python(row.typed)

    assert [error["type"] for error in raised.value.errors()] == ["email_not_accepted"]


@pytest.mark.parametrize("row", [row for row in ROWS if row.stored is not None], ids=lambda row: row.case)
def test_what_a_payload_stores_is_the_typed_address_s_fold(row: Row):
    """So a typed address, folded, meets the row its payload stored by equality, and a ban keyed on either is one key."""

    assert row.stored == row.folded
