"""
API · the ban list's judgements, spelled apart from the request

One function computes the stored form, so a write and every later check hash under one key. A second
spelling would file rows no check can match, and nothing would report it.
"""

import hashlib
import hmac
from collections.abc import Collection, Iterable
from http import HTTPStatus
from typing import Final

from pydantic import SecretStr

from app.core.codes import Code
from app.core.exceptions import WriteRefusal
from app.shared.folding import canonical_address, sign_in_identifier
from app.shared.schemas.bounds import SAISON_ID_LENGTH, SPERRE_DAUER_SAISONS
from app.shared.sub_keys import derive_sub_key

# One label per purpose: the same master keys the action log's pseudonyms
# (`app/core/security.py :: AKTEUR_PSEUDONYM_VERSION`), and a mistake in one must not read the other.
# Not a rotation scheme.
SPERRLISTE_SCHLUESSEL_VERSION: Final = "sperrliste-v1"


def adresse_hash(address: str, *, key: SecretStr) -> str:
    """The form a ban is stored in.

    KEYED, where `app/shared/tokens.py :: hash_token` is not: an address is a dictionary
    word, so an unkeyed digest confirms a guess at one hash per row.
    """

    # The rule every address payload runs too (`app/shared/schemas/kontakt.py :: CustomEmail`), so an
    # address a payload admitted keys a ban rather than answering 500.
    return hmac.new(derive_sub_key(key, SPERRLISTE_SCHLUESSEL_VERSION), canonical_address(address).encode("utf-8"), hashlib.sha256).hexdigest()


def withheld_actor(actor: str | None, barred: Collection[str]) -> str | None:
    """An actor field with a barred address withheld, compared on the fold the barred set holds."""

    if actor is None or sign_in_identifier(actor) in barred:
        return None

    return actor


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
    """`sperrliste_no_saison`: while no season is running there is nothing to count five seasons from.

    A ban written there would need an unbounded row, which is the shape the lapse exists to refuse.
    """

    if massgebliche_saison_id is not None:
        return None

    return WriteRefusal(
        error_code=Code.SPERRLISTE_NO_SAISON,
        status=HTTPStatus.CONFLICT,
    )


def stored_adresse_hash(address: str, *, key: SecretStr) -> str | None:
    """The ban key of a stored address, or `None` where today's rule refuses it, as no ban can key one.

    Never raising: the actor fields it is asked of hold markers as well as addresses, and a stored address an older
    rule admitted must not fail the page it sits on.
    """

    try:
        return adresse_hash(address, key=key)
    except ValueError:
        return None


def berechtigte_hashes(administrators: Iterable[str], *, key: SecretStr) -> set[str]:
    """Each administrator's address as a ban is keyed, so a ban is compared in the form it bars by."""

    hashes = (stored_adresse_hash(administrator, key=key) for administrator in administrators)

    return {gehasht for gehasht in hashes if gehasht is not None}


def find_verwaltung_refusal(*, gehasht: str, berechtigt: set[str]) -> WriteRefusal | None:
    """`sperrliste_verwaltung`: the address holds a grant in `berechtigungen`, which is revoked first.

    The target's state, so 409: the ban is refused for what the address is, and revoking the grant
    is what changes it.
    """

    if gehasht not in berechtigt:
        return None

    return WriteRefusal(
        error_code=Code.SPERRLISTE_VERWALTUNG,
        status=HTTPStatus.CONFLICT,
    )


def find_sperrliste_refusal(*, barred: bool) -> WriteRefusal | None:
    """`duplicate_key`: the list already holds this address.

    Takes the answer rather than the lookup, so the caller's read runs in the caller's transaction.
    """

    if not barred:
        return None

    return WriteRefusal(
        error_code=Code.DUPLICATE_KEY,
        status=HTTPStatus.CONFLICT,
    )
