"""
API · the ban list's judgements, spelled apart from the request

One function computes the stored form, so a write and every later check hash under one key. A second
spelling would file rows no check can match, and nothing would report it.
"""

import hashlib
import hmac
from typing import Final

from email_validator import EmailNotValidError, validate_email
from pydantic import SecretStr

from app.core.exceptions import WriteRefusal
from app.shared.folding import sign_in_identifier

# One code over two readers: each slice words it for its own, an administrator being told plainly
# what a visitor is told neutrally (`.claude/rules/cross-surface.md`).
SPERRLISTE_ADRESSE_GESPERRT = "REQ-SPERRLISTE-001"

# One label per purpose: the same master keys a second corpus in a later programme, and a mistake
# in one must not read the other. Not a rotation scheme (`docs/backend/spec.md :: 1.5`).
SPERRLISTE_SCHLUESSEL_VERSION: Final = "sperrliste-v1"


def _sub_key(master: SecretStr) -> bytes:
    """Derived per call rather than memoised: a cache keyed on the master holds the secret in a module-level dict for the process's life."""

    return hmac.new(master.get_secret_value().encode("utf-8"), SPERRLISTE_SCHLUESSEL_VERSION.encode("utf-8"), hashlib.sha256).digest()


def sperrliste_identifier(address: str) -> str:
    """The one canonical form a ban is keyed on (`docs/backend/spec.md :: I269`).

    Raises `ValueError` where the value is no address at all.
    """

    # FIRST, so the trim and the case-fold are the ones the frontend runs: `validate_email` refuses
    # the trailing space a paste out of a mail client carries, where the fold takes it off.
    folded = sign_in_identifier(address)

    try:
        # pydantic's own call, so a payload-validated address canonicalises to the value it already
        # holds: `check_deliverability=False`, and the normalisation is idempotent.
        normalised = validate_email(folded, check_deliverability=False).normalized
    except EmailNotValidError:
        # `from None`, for the reason `app/core/config.py :: get_config` suppresses its own cause:
        # the library's message quotes the value it rejected, and this slice keeps addresses out of
        # every traceback and log line.
        raise ValueError("this keying canonicalises an email address, and the value handed to it is not one") from None

    # AGAIN, because the normalisation recomposes a decoded domain: what a later check compares has
    # to be in the fold's own form (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
    return sign_in_identifier(normalised)


def adresse_hash(address: str, *, schluessel: SecretStr) -> str:
    """The form a ban is stored in.

    KEYED, where `app/api/bewerbungen/services.py :: hash_token` is not: an address is a dictionary
    word, so an unkeyed digest confirms a guess at one hash per row.
    """

    return hmac.new(_sub_key(schluessel), sperrliste_identifier(address).encode("utf-8"), hashlib.sha256).hexdigest()


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
