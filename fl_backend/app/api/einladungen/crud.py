from collections.abc import Sequence
from typing import Any, Final

from app.api.einladungen.schemas import FLInvitationRecipient
from app.api.outbox.schemas import FLInvitationData, FLOutboxLink, FLOutboxReference
from app.api.outbox.services import OwedMail
from app.core.collections import Collection

# Where a mailed invitation link lives. No address to judge: the row names none, its recipients standing on the season row, and the
# link is the team's rather than a person's credential. Never superseding: a link copied off the mint stays valid beside the mailed ones.
EINLADUNG_LINK: Final = FLOutboxLink(paths=["token_hashes"], addresses=[], replaced=False)


def einladung_bezug(invitation_id: Any) -> FLOutboxReference:
    """The invite a mail is about. No seat: every recipient is mailed the team's one link, and its state is the invite's."""

    return FLOutboxReference(collection=Collection.INVITATIONS, id=invitation_id, seat=None)


def owed_einladung_mails(
    *, invitation_id: Any, team_name: str, saison_id: str, recipient: Sequence[FLInvitationRecipient], occasion: str
) -> list[OwedMail]:
    """One mail per confirmed seat, each keyed by the invite, the occasion and the seat, so a replayed write owes nothing twice."""

    return [
        OwedMail(
            key=f"{Collection.INVITATIONS}/{invitation_id}/{occasion}/{person.rolle}",
            an=person.email,
            data=FLInvitationData(kind="invitation", team=team_name, saison_id=saison_id),
            reference=einladung_bezug(invitation_id),
            link=EINLADUNG_LINK,
        )
        for person in recipient
    ]
