"""
API · the ban list's judgements, spelled apart from the request

One function computes the stored form, so a write and every later check hash under one key. A second
spelling would file rows no check can match, and nothing would report it.
"""

import hashlib
import hmac
from typing import Final

from pydantic import SecretStr

from app.core.exceptions import WriteRefusal
from app.shared.folding import canonical_address
from app.shared.schemas.bounds import SAISON_ID_LENGTH, SPERRE_DAUER_SAISONS

# One code over two readers: each slice words it for its own, an administrator being told plainly
# what a visitor is told neutrally (`.claude/rules/cross-surface.md`).
SPERRLISTE_ADRESSE_GESPERRT = "REQ-SPERRLISTE-001"

SPERRLISTE_KEINE_SAISON = "REQ-SPERRLISTE-002"

# One label per purpose: the same master keys a second corpus in a later programme, and a mistake
# in one must not read the other. Not a rotation scheme (`docs/backend/spec.md :: 1.5`).
SPERRLISTE_SCHLUESSEL_VERSION: Final = "sperrliste-v1"


def _sub_key(master: SecretStr) -> bytes:
    """Derived per call rather than memoised: a cache keyed on the master holds the secret in a module-level dict for the process's life."""

    return hmac.new(master.get_secret_value().encode("utf-8"), SPERRLISTE_SCHLUESSEL_VERSION.encode("utf-8"), hashlib.sha256).digest()


def adresse_hash(address: str, *, schluessel: SecretStr) -> str:
    """The form a ban is stored in.

    KEYED, where `app/api/bewerbungen/services.py :: hash_token` is not: an address is a dictionary
    word, so an unkeyed digest confirms a guess at one hash per row.
    """

    # The rule every address payload runs too (`app/shared/schemas/kontakt.py :: CustomEmail`), so an
    # address a payload admitted keys a ban rather than answering 500.
    return hmac.new(_sub_key(schluessel), canonical_address(address).encode("utf-8"), hashlib.sha256).hexdigest()


def compose_gesperrt_bis_saison_id(*, massgebliche_saison_id: str) -> str:
    """The last season a ban entered now still covers, `SPERRE_DAUER_SAISONS` past the reference season.

    Raises rather than composing a bound nothing can compare: `address_is_gesperrt` orders two of
    these as STRINGS, which holds only at one width.
    """

    # `isascii()` beside `isdigit()`, which alone is true of Arabic-Indic and fullwidth digits: `int`
    # reads those as a year and returns an ASCII bound that sorts nowhere near the id it came from
    # (`app/api/bewerbungen/services.py :: next_saison_id`).
    if not (massgebliche_saison_id.isascii() and massgebliche_saison_id.isdigit() and len(massgebliche_saison_id) == SAISON_ID_LENGTH):
        raise ValueError(f"a ban is bounded against a season id of {SAISON_ID_LENGTH} ASCII digits, and this league's is not one")

    bound = f"{int(massgebliche_saison_id) + SPERRE_DAUER_SAISONS:0{SAISON_ID_LENGTH}d}"

    # The ANSWER's width, where the clause above guards the input's: the format widens rather than
    # truncating, and a wider bound sorts nowhere near the ids it is compared with.
    if len(bound) != SAISON_ID_LENGTH:
        raise ValueError(f"a bound {SPERRE_DAUER_SAISONS} seasons past {massgebliche_saison_id} needs over {SAISON_ID_LENGTH} digits")

    return bound


def find_keine_saison_refusal(*, massgebliche_saison_id: str | None) -> WriteRefusal | None:
    """`REQ-SPERRLISTE-002`: while no season is running there is nothing to count five seasons from.

    A ban written there would need an unbounded row, which is the shape the lapse exists to refuse.
    """

    if massgebliche_saison_id is not None:
        return None

    return WriteRefusal(
        error_code=SPERRLISTE_KEINE_SAISON,
        message="a ban lapses after five seasons and no season is running, so there is no season to count them from",
    )


def find_sperrliste_refusal(*, gesperrt: bool) -> WriteRefusal | None:
    """`REQ-SPERRLISTE-001`: the list already holds this address.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if not gesperrt:
        return None

    return WriteRefusal(
        error_code=SPERRLISTE_ADRESSE_GESPERRT,
        message="this email address is already on the ban list; lift the entry that holds it rather than adding a second",
    )
