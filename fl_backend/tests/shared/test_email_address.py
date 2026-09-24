import json
from pathlib import Path
from typing import Final, NamedTuple

import pytest

from app.shared.folding import canonical_address, league_address, mailbox_key, sign_in_identifier

# One table both suites run their own rule and fold over (`fl_frontend/src/core/emailAddress.test.ts`
# holds the frontend half): each runtime converts a Unicode domain with its own tables, and this is
# where the two are held to one answer.
EMAIL_ADDRESSES: Final = Path(__file__).resolve().parent / "email_addresses.json"

# Recorded under the keying every stored ban was hashed with, and only ever appended to: a null is a
# probe the address rule now refuses (`docs/backend/spec.md :: I330`).
BAN_KEYS: Final = Path(__file__).resolve().parent / "ban_keys.json"


class Row(NamedTuple):
    case: str
    typed: str
    # What a payload stores, or `None` where the rule refuses the address.
    stored: str | None
    folded: str


def _rows() -> tuple[Row, ...]:
    return tuple(Row(**row) for row in json.loads(EMAIL_ADDRESSES.read_bytes().decode("utf-8")))


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


@pytest.mark.parametrize("row", [row for row in ROWS if row.stored is not None], ids=lambda row: row.case)
def test_what_a_payload_stores_is_ascii_and_folds_as_the_typed_address_does(row: Row):
    """So a typed address, folded, joins the row its payload stored."""

    assert row.stored is not None
    assert row.stored.isascii()
    assert sign_in_identifier(row.stored) == row.folded


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


UMLAUT_DOMAIN: Final = "anna@müller.de"


def test_a_unicode_domain_and_its_punycode_are_one_inbox_and_the_local_part_s_case_two():
    assert mailbox_key(UMLAUT_DOMAIN) == mailbox_key("anna@XN--MLLER-KVA.DE")
    assert mailbox_key("Anna@schule.de") != mailbox_key("anna@schule.de")
