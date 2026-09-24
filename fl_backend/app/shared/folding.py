import re
import unicodedata
from typing import Any, Final

from email_validator import EmailNotValidError, ValidatedEmail, validate_email

# ECMAScript's `WhiteSpace` and `LineTerminator`, never `str.strip()`'s set, which takes U+0085 and
# leaves U+FEFF: the two ends would part on a character nobody can see. Code points rather than an
# invisible string literal.
_TRIMMED: Final = "".join(
    chr(point)
    for point in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
)

# ASCII's letters alone, never `str.lower`, whose tables move with the interpreter's Unicode release:
# the frontend lowers the same 26, so this step cannot part the two folds; their domain conversions
# are held to one answer by `fl_backend/tests/shared/email_addresses.json`.
_ASCII_LOWER: Final = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _ascii_domain(domain: str) -> str | None:
    """The domain as `league_address` converts it, or `None` where that refuses it."""

    try:
        # Inside a stand-in address: `validate_email` is the library's one public entry, and the
        # local part `x` passes each of its rules, so the domain is all it judges.
        return validate_email(f"x@{domain}", allow_smtputf8=False, check_deliverability=False).ascii_domain
    except EmailNotValidError:
        return None


def _folded_domain(domain: str) -> str:
    # A row stored before the address rule holds its domain in Unicode, and converting it here is
    # what joins it to the punycode spelling every payload stores now (`docs/backend/spec.md :: I333`).
    if not domain.isascii():
        domain = _ascii_domain(domain) or domain

    return domain.translate(_ASCII_LOWER)


def _league_validated(address: str) -> ValidatedEmail:
    """`allow_smtputf8=False` is the address rule's whole choice: a local part in ASCII, and a Unicode domain converted to punycode."""

    try:
        return validate_email(address.strip(_TRIMMED), allow_smtputf8=False, check_deliverability=False)
    except EmailNotValidError:
        # `from None`, for the reason `app/core/config.py :: get_config` suppresses its own cause:
        # the library's message quotes the value it rejected, and no address reaches a traceback or
        # a log line.
        raise ValueError("this is no email address the league accepts") from None


def league_address(address: str) -> str:
    """The form every address payload stores (`docs/backend/spec.md :: I332`); `ValueError` where the rule refuses it."""

    validated = _league_validated(address)

    # Set wherever `allow_smtputf8` is off, which refuses every address that would leave it unset.
    assert validated.ascii_email is not None
    return validated.ascii_email


def sign_in_identifier(address: str) -> str:
    """`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`'s spelling in Python.

    A stored address is compared in this form, or one mailbox's two spellings compare unequal and
    nothing fails. It never raises, so an address no rule takes today still folds.
    """

    trimmed = address.strip(_TRIMMED)
    local, at, domain = trimmed.rpartition("@")

    return f"{local.translate(_ASCII_LOWER)}@{_folded_domain(domain)}" if at else trimmed.translate(_ASCII_LOWER)


def canonical_address(address: str) -> str:
    """The form a ban is keyed on; `ValueError` where the address rule refuses the value.

    Its domain DECODED rather than in punycode, as the stored bans were keyed
    (`docs/backend/spec.md :: I330`), Greek sigmas apart (`docs/backend/spec.md :: I269`).
    """

    validated = _league_validated(address)
    assert validated.ascii_local_part is not None

    # `domain` is the library's decoding of the punycode it stores. `lower` rather than the ASCII
    # fold: UTS46 leaves Cherokee in capitals, and the keys already stored lower-cased them.
    return f"{validated.ascii_local_part.translate(_ASCII_LOWER)}@{validated.domain.lower()}"


def stored_spellings(identifier: str) -> tuple[str, ...]:
    """Every spelling a stored row may hold this identifier in (`docs/backend/spec.md :: I333`).

    The fold before the address rule stored the domain decoded and lower-cased, so an equality or a
    pattern over stored rows asks for both.
    """

    local, at, domain = identifier.rpartition("@")
    labels = domain.split(".")
    if not at or not any(label.startswith("xn--") for label in labels):
        return (identifier,)

    try:
        # Punycode's decoding is arithmetic over the label and reads no Unicode table, so no release
        # of anything moves it.
        decoded = ".".join(label[4:].encode("ascii").decode("punycode") if label.startswith("xn--") else label for label in labels)
        # A label can decode to a lone surrogate, which the driver cannot encode into a query, and the
        # erasure's lookup, held to no address rule (`docs/backend/spec.md :: I329`), passes one here.
        decoded.encode("utf-8")
    except UnicodeError:
        return (identifier,)

    return (identifier, f"{local}@{decoded.lower()}")


# Escaped one character at a time, which Python's `re` and the server's PCRE read alike.
_TRIMMED_CLASS: Final = "[" + "".join(re.escape(character) for character in _TRIMMED) + "]"


def trimmed_pattern(alternation: str) -> str:
    """`alternation`, an escaped `$regex` fragment, anchored so that whatever `sign_in_identifier` trims may stand at either end.

    A pre-filter taking less than the fold leaves a row the fold would have claimed unread.
    """

    return f"^{_TRIMMED_CLASS}*(?:{alternation}){_TRIMMED_CLASS}*$"


def person_name_key(value: Any) -> str:
    """NFC and `lower`, never `casefold`: „Weiß“ and „Weiss“ are two families, and a decomposed umlaut is one name typed on another keyboard."""

    return " ".join(unicodedata.normalize("NFC", str(value or "")).split()).lower()


def mailbox_key(address: str) -> str:
    """What makes two stored addresses one INBOX, which is a narrower question than `sign_in_identifier`'s.

    Folded whole, two people are one recipient and one of them is never written to.
    """

    local, at, domain = address.rpartition("@")

    # The local part byte for byte and the domain without case (RFC 5321 §2.4), as
    # `fl_frontend/src/core/emailAddress.ts :: mailboxKey` compares them.
    return f"{local}@{_folded_domain(domain)}" if at else address
