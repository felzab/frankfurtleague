from collections.abc import Sequence
from typing import Any, Final

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.einladungen.schemas import FLEinladungEmpfaenger
from app.api.einladungen.services import einladung_ist_versendet
from app.api.postausgang.crud import lagen_of
from app.api.postausgang.schemas import FLEinladungDaten, FLPostausgangBezug, FLPostausgangLage, FLPostausgangLink
from app.api.postausgang.services import OwedMail
from app.core.collections import Collection

# Where a mailed invitation link lives. No address to judge: the row names none, its recipients standing on the season row, and the
# link is the team's rather than a person's credential. Never superseding: a link copied off the mint stays valid beside the mailed ones.
EINLADUNG_LINK: Final = FLPostausgangLink(pfade=["token_hashes"], adressen=[], ersetzt=False)


def einladung_bezug(einladung_id: Any) -> FLPostausgangBezug:
    """The invite a mail is about. No seat: every recipient is mailed the team's one link, and its state is the invite's."""

    return FLPostausgangBezug(sammlung=Collection.EINLADUNGEN, id=einladung_id, sitz=None)


def owed_einladung_mails(
    *, einladung_id: Any, team_name: str, saison_id: str, empfaenger: Sequence[FLEinladungEmpfaenger], anlass: str
) -> list[OwedMail]:
    """One mail per confirmed seat, each keyed by the invite, the occasion and the seat, so a replayed write owes nothing twice."""

    return [
        OwedMail(
            schluessel=f"{Collection.EINLADUNGEN}/{einladung_id}/{anlass}/{person.rolle}",
            an=person.email,
            daten=FLEinladungDaten(art="einladung", team=team_name, saison_id=saison_id),
            bezug=einladung_bezug(einladung_id),
            link=EINLADUNG_LINK,
        )
        for person in empfaenger
    ]


async def lagen_der_einladungen(
    *, postausgang_collection: AsyncCollection, einladung_ids: Sequence[Any], session: AsyncClientSession | None = None
) -> dict[Any, FLPostausgangLage]:
    """What became of the last mail owed about each of these invites, keyed by invite; one absent where none was ever owed."""

    lagen = await lagen_of(postausgang_collection=postausgang_collection, sammlung=Collection.EINLADUNGEN, ids=einladung_ids, session=session)

    return {einladung_id: lage for (einladung_id, _), lage in lagen.items()}


async def versendete_einladungen(
    *, postausgang_collection: AsyncCollection, einladung_ids: Sequence[Any], session: AsyncClientSession | None = None
) -> set[Any]:
    """The invites whose last mail is still owed or went out, `einladung_ist_versendet` of each, in one read."""

    lagen = await lagen_der_einladungen(postausgang_collection=postausgang_collection, einladung_ids=einladung_ids, session=session)

    return {einladung_id for einladung_id, lage in lagen.items() if einladung_ist_versendet(lage=lage)}
