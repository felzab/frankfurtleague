from collections.abc import Sequence
from typing import Any, Final

from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.einladungen.schemas import FLInvitationRecipient
from app.api.einladungen.services import einladung_ist_versendet
from app.api.postausgang.crud import lagen_of
from app.api.postausgang.schemas import FLInvitationData, FLPostausgangBezug, FLPostausgangLink
from app.api.postausgang.services import OwedMail
from app.core.collections import Collection

# Where a mailed invitation link lives. No address to judge: the row names none, its recipients standing on the season row, and the
# link is the team's rather than a person's credential. Never superseding: a link copied off the mint stays valid beside the mailed ones.
EINLADUNG_LINK: Final = FLPostausgangLink(paths=["token_hashes"], adressen=[], replaced=False)


def einladung_bezug(invitation_id: Any) -> FLPostausgangBezug:
    """The invite a mail is about. No seat: every recipient is mailed the team's one link, and its state is the invite's."""

    return FLPostausgangBezug(collection=Collection.EINLADUNGEN, id=invitation_id, seat=None)


def owed_einladung_mails(
    *, invitation_id: Any, team_name: str, saison_id: str, recipient: Sequence[FLInvitationRecipient], anlass: str
) -> list[OwedMail]:
    """One mail per confirmed seat, each keyed by the invite, the occasion and the seat, so a replayed write owes nothing twice."""

    return [
        OwedMail(
            key=f"{Collection.EINLADUNGEN}/{invitation_id}/{anlass}/{person.rolle}",
            an=person.email,
            data=FLInvitationData(art="invitation", team=team_name, saison_id=saison_id),
            reference=einladung_bezug(invitation_id),
            link=EINLADUNG_LINK,
        )
        for person in recipient
    ]


async def versendete_einladungen(
    *, postausgang_collection: AsyncCollection, einladung_ids: Sequence[Any], session: AsyncClientSession | None = None
) -> set[Any]:
    """The invites whose last mail is still owed or went out, `einladung_ist_versendet` of each, in one read."""

    lagen = await lagen_of(postausgang_collection=postausgang_collection, collection=Collection.EINLADUNGEN, ids=einladung_ids, session=session)

    # Keyed by the invite and its seat, which an invite's mails leave empty.
    return {einladung_id for (einladung_id, _), lage in lagen.items() if einladung_ist_versendet(lage=lage)}
