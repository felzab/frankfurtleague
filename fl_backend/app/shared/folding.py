import unicodedata
from typing import Final

# ECMAScript's `WhiteSpace` and `LineTerminator`, never `str.strip()`'s set, which takes U+0085 and
# leaves U+FEFF: the two ends would part on a character nobody can see. Code points rather than an
# invisible string literal.
_TRIMMED: Final = "".join(
    chr(point)
    for point in (0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
)


def sign_in_identifier(address: str) -> str:
    """One form for both ends of one join: `fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`'s spelling in Python.

    A stored address is stored as this folds it, or the seam's equality compares two spellings of
    one mailbox and nothing fails.
    """

    # NFKC before the fold, and `lower` never `casefold`, which folds „ß“ to „ss“ where the
    # frontend's `toLowerCase` leaves it standing: this answers what
    # `fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier` answers, for every code point.
    return unicodedata.normalize("NFKC", address).lower().strip(_TRIMMED)


def mailbox_key(address: str) -> str:
    """What makes two stored addresses one INBOX, which is a narrower question than `sign_in_identifier`'s.

    Over-matching costs an erasure nothing and a message everything: folded whole, two people are
    one recipient and one of them is never written to.
    """

    at = address.rfind("@")

    # The local part byte for byte and the domain without case (RFC 5321 §2.4), as
    # `fl_frontend/src/features/bewerbungen/notifications.ts :: collectSeats` compares them.
    return address if at == -1 else f"{address[:at]}@{address[at + 1 :].lower()}"
