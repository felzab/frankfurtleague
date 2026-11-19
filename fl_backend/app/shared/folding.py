import re
import unicodedata
from typing import Any, Final, LiteralString

from email_validator import EmailNotValidError, ValidatedEmail, validate_email

from app.core.codes import Rule
from app.core.exceptions import rule_refusal

# ECMAScript's `WhiteSpace` and `LineTerminator`, never `str.strip()`'s set, which takes U+0085 and
# leaves U+FEFF: the two ends would part on a character nobody can see. Code points rather than an
# invisible string literal.
_TRIMMED: Final = "".join(
    chr(point)
    for point in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
)

# ASCII's letters alone, never `str.lower`, whose tables move with the interpreter's Unicode release:
# the frontend lowers the same 26, so this step cannot part the two folds.
_ASCII_LOWER: Final = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")

_REFUSAL: Final[tuple[Rule, LiteralString]] = ("email_not_accepted", "this is no email address the league accepts")


def trimmed(address: str) -> str:
    """`address` as a page's `.trim()` leaves it, so a value judged on both sides starts from one spelling."""

    return address.strip(_TRIMMED)


def refuse_a_domain_beyond_ascii(address: str) -> str:
    """`address` as given; the address rule's refusal where its domain holds a character beyond ASCII.

    Every stored domain is ASCII, an international one in punycode, so a lookup naming one in Unicode would find nothing.
    """

    if not address.rpartition("@")[2].isascii():
        raise rule_refusal(*_REFUSAL)

    return address


def _validated(address: str) -> ValidatedEmail:
    bare = trimmed(address)
    # Before the library, which would take a Unicode domain and answer it in punycode: a second spelling of one
    # mailbox, which no fold of the typed address meets.
    if not bare.isascii():
        raise rule_refusal(*_REFUSAL)

    try:
        return validate_email(bare, allow_smtputf8=False, check_deliverability=False)
    except EmailNotValidError:
        # `from None`: the library's message quotes the value it rejected, and no address reaches a
        # traceback or a log line.
        raise rule_refusal(*_REFUSAL) from None


def league_address(address: str) -> str:
    """The form every address payload stores; `ValueError` where the address rule refuses it.

    The rule is ASCII throughout, so the stored form is the sign-in fold of what it accepts, and every read of a stored
    address is an equality on the asker's fold.
    """

    validated = _validated(address)
    # Set wherever `allow_smtputf8` is off, which refuses every address that would leave it unset.
    assert validated.ascii_email is not None
    return sign_in_identifier(validated.ascii_email)


def sign_in_identifier(address: str) -> str:
    """The frontend's `asSignInIdentifier` in Python: trimmed and lower-cased.

    A stored address is compared in this form, or one mailbox's two spellings compare unequal and
    nothing fails. It never raises, so an address no rule takes today still folds.
    """

    return trimmed(address).translate(_ASCII_LOWER)


# Both spellings of the country code. Neither arm can take the other's value -- `0049…` does not
# start with `49` -- so the order carries nothing.
_PHONE_COUNTRY_CODES = ("0049", "49")


def normalise_phone(value: str) -> str:
    """One spelling per telephone number, so `+49 170 …` and `0170 …` compare equal.

    Digits alone, `PHONE_REGEX` admitting spaces, brackets, hyphens and dots. No German area code
    starts with the trunk `0`, so a leading country code folds back to it.
    """

    digits = re.sub(r"[^0-9]", "", value)

    for country_code in _PHONE_COUNTRY_CODES:
        if digits.startswith(country_code):
            # The second `removeprefix` takes the trunk zero written as `(0)`, which is the standard
            # German notation and the commonest spelling of all. An international-format number
            # carries no real leading zero, so dropping one can only be right.
            return f"0{digits.removeprefix(country_code).removeprefix('0')}"

    return digits


def composed_name(value: Any) -> str:
    """NFC, each run of spaces one space, capitals kept: a decomposed umlaut is one name typed on another keyboard."""

    return " ".join(unicodedata.normalize("NFC", str(value or "")).split())


def person_name_key(value: Any) -> str:
    """`composed_name` and `lower`, never `casefold`: „Weiß“ and „Weiss“ are two families."""

    return composed_name(value).lower()
