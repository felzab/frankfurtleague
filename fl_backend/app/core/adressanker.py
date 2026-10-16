"""
CORE · one folded address's anchor, the document every transaction writing that address into a record writes

A transaction protects a judgement only over the documents it writes (`docs/backend/spec.md :: I53`), and an
erasure never writes a record committed for its address after its snapshot opened, never having read it. Both
writing the address's anchor puts the two in one write set, so whichever commits second runs again
(`docs/backend/spec.md :: I719`).
"""

import hashlib
import hmac
from collections.abc import Iterable
from typing import Final

from pydantic import SecretStr
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core.crud import anchor_by_id_in_db
from app.shared.folding import sign_in_identifier
from app.shared.sub_keys import derive_sub_key

# Its own label under the `sperrliste_schluessel` master, beside the ban list's, the log's and the journal's
# (`app/core/security.py :: AKTEUR_PSEUDONYM_VERSION`): under theirs an anchor's id would equal a ban's digest,
# a pseudonym or a journal hash.
ADRESSANKER_VERSION: Final = "adressanker-v1"


def adressanker_id(address: str, *, schluessel: SecretStr) -> str:
    """Keyed on the sign-in fold, the identity the erasure judges a record by, so every spelling of one mailbox meets on one anchor."""

    return hmac.new(derive_sub_key(schluessel, ADRESSANKER_VERSION), sign_in_identifier(address).encode("utf-8"), hashlib.sha256).hexdigest()


async def anchor_the_addresses(
    adressen: Iterable[str | None],
    *,
    adressanker_collection: AsyncCollection,
    schluessel: SecretStr,
    # REQUIRED: committed on its own, an anchor conflicts with nobody.
    session: AsyncClientSession,
) -> None:
    """Anchor every address here in the caller's transaction, an empty slot anchoring nothing."""

    ids = sorted({adressanker_id(adresse, schluessel=schluessel) for adresse in adressen if adresse})
    if ids:
        await anchor_by_id_in_db(collection=adressanker_collection, ids=ids, session=session)
