from collections.abc import Mapping, Sequence
from http import HTTPStatus
from typing import Any, Final, NamedTuple

from app.api.bewerbungen.services import seat_named
from app.api.invitations.schemas import FLInvitationSkipReason
from app.api.outbox.schemas import FLInvitationData, FLOutboxLink, FLOutboxReference, FLOutboxTeam
from app.api.outbox.services import OwedMail
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import APIError, link_invalid
from app.shared.einwilligung import seat_is_confirmed
from app.shared.schemas.literals import KONTAKT_SEATS, FLKontaktSeat

# An exclusion rather than an inclusion list: what it subtracts is the whole credential, where a list of everything
# else is one a later field joins by being forgotten.
WITHOUT_TOKEN_HASH: Mapping[str, int] = {"token_hashes": 0}


def find_invitation_saison_past_refusal(*, saison_status: Any) -> APIError | None:
    """`saison_past`: the season has ended.

    A `future` season mints: an administrator prepares the links before the window opens, and the
    window is judged at every use rather than at the mint.
    """

    if saison_status != "past":
        return None

    return APIError(HTTPStatus.CONFLICT, Code.SAISON_PAST)


def find_unknown_invitation_refusal(*, invitation_raw: Mapping[str, Any] | None) -> APIError | None:
    """`link_invalid`: the link value the visitor presented opens no live invite, as every dead link answers.

    Takes the row the caller's own read found, so that read runs in the caller's transaction. A revoked
    row is a miss here because the filter that found nothing asked for a live one.
    """

    if invitation_raw is not None:
        return None

    return link_invalid()


# The partial filter `uniq_invitation_live` is built on, spelled as it is: the equality with `None`
# does not imply it, so a read spelled that way scans every invite. The record model requires the key,
# so the two select the same rows.
LIVE_INVITATION: Mapping[str, Any] = {"revoked_at": {"$type": "null"}}


def build_live_team_filter(*, saison_id: str, team_id: Any) -> Mapping[str, Any]:
    """The live invite of one team and season, which `uniq_invitation_live` makes at most one row."""

    return {"saison_id": saison_id, "team_id": team_id, **LIVE_INVITATION}


def find_live_invitation_filter(*, token_hash: str) -> Mapping[str, Any]:
    """The live invite a presented link opens, or nothing.

    The revocation term is half the filter: a hash alone finds the row a reissue replaced, and that
    link is spent.
    """

    return {"token_hashes": token_hash, **LIVE_INVITATION}


def compose_invitation(*, saison_id: str, team_id: Any, token_hashes: list[str], sent_at: str | None) -> dict[str, Any]:
    """One live row: the hash of the link a mint answers for copying, or none where the press's mails mint every link.

    `sent_at` is today where the same write owes the link's mails, as the season's press does, and null on a mint for copying.
    """

    return {
        "saison_id": saison_id,
        "team_id": team_id,
        "token_hashes": token_hashes,
        "revoked_at": None,
        "sent_at": sent_at,
    }


def compose_sent_update(*, today: str) -> Mapping[str, Any]:
    """What owing a live link's mails to its seats writes on the row: the day, served as the day it was sent."""

    return {"$set": {"sent_at": today}}


def compose_revocation_update(*, today: str) -> Mapping[str, Any]:
    """What revoking writes. The row stays: a reissue's history is what says which link a bounce was about."""

    return {"$set": {"revoked_at": today}}


def invitation_is_sent(invitation_raw: Mapping[str, Any] | None) -> bool:
    """Whether this live link was mailed, by the day the season's press or the team's own stored on it.

    The stored day and never the Postausgang: its row is erased a retention after it settles, and a press judging it would
    then mail the club again, replacing the link it holds. So the season's press never replaces a mailed link, whatever
    became of its mail; the team's own press is what mails it again.
    """

    return invitation_raw is not None and invitation_raw.get("sent_at") is not None


class InvitationRecipient(NamedTuple):
    """One mailbox a link goes to, and the seat it is addressed as."""

    seat: FLKontaktSeat
    email: str


def confirmed_recipients(*, kontakte: Mapping[str, Any] | None) -> list[InvitationRecipient]:
    """The mailboxes a link may be sent to, one entry per stored address, each the fold every payload stores."""

    recipients: list[InvitationRecipient] = []
    seen: set[str] = set()

    for seat in KONTAKT_SEATS:
        entry = (kontakte or {}).get(seat)
        named = seat_named(seat)
        # An address nobody has proven gets no credential.
        if not seat_is_confirmed(entry) or named is None:
            continue

        address = str(entry.get("email") or "")
        if not address or address in seen:
            continue

        seen.add(address)
        recipients.append(InvitationRecipient(seat=named, email=address))

    return recipients


class InvitationMailPlan(NamedTuple):
    """What one team's row says, before anything is minted."""

    recipient: list[InvitationRecipient]
    skipped: FLInvitationSkipReason | None


def plan_invitation_mail(*, austritt: Any, kontakte: Mapping[str, Any] | None, invitation_raw: Mapping[str, Any] | None) -> InvitationMailPlan:
    """Who this team's link goes to, or why it is skipped.

    The season editor's rows and the press read this one plan, so a row never tells an administrator something the press
    then contradicts. `invitation_raw` is the team's live invite, `None` where it holds none.
    """

    # The record's presence, never its `type` and never a flag beside it: a team is out of the
    # season by either route, and a skip naming the contact block would send somebody to repair it.
    if austritt is not None:
        return InvitationMailPlan([], "austritt_entered")

    # Its day and never the row's presence: a team holding a live link nobody was sent is a team this press exists to
    # reach, and skipping on the row would leave those links unsent for ever. Ahead of the seats: this press never
    # mails a sent link again, so a missing address over one, as the retention leaves a finished season, would send
    # somebody to repair what no press reads.
    if invitation_is_sent(invitation_raw):
        return InvitationMailPlan([], "already_sent")

    if kontakte is None:
        return InvitationMailPlan([], "no_kontakt_block")

    recipients = confirmed_recipients(kontakte=kontakte)
    if not recipients:
        return InvitationMailPlan([], "no_confirmed_kontaktperson")

    return InvitationMailPlan(recipients, None)


# Where a mailed invitation link lives. No address to judge: the row names none, its recipients standing on the season row, and the
# link is the team's rather than a person's credential. Never superseding: a link copied off the mint stays valid beside the mailed ones.
INVITATION_LINK: Final = FLOutboxLink(paths=["token_hashes"], addresses=[], replaced=False)


def invitation_reference(invitation_id: Any) -> FLOutboxReference:
    """The invite a mail is about. No seat: every recipient is mailed the team's one link, and its state is the invite's."""

    return FLOutboxReference(collection=Collection.INVITATIONS, id=invitation_id, seat=None)


def owed_invitation_mails(
    *, invitation_id: Any, team_id: Any, team_name: str, saison_id: str, recipient: Sequence[InvitationRecipient], occasion: str
) -> list[OwedMail]:
    """One mail per confirmed seat, each keyed by the invite, the occasion and the seat, so a replayed write owes nothing twice.

    Each names its club, so a seat its holder left before the hand-out is sent no team's link.
    """

    return [
        OwedMail(
            key=f"{Collection.INVITATIONS}/{invitation_id}/{occasion}/{person.seat}",
            to=person.email,
            data=FLInvitationData(kind="invitation", team=team_name, saison_id=saison_id),
            reference=invitation_reference(invitation_id),
            link=INVITATION_LINK,
            team=FLOutboxTeam(saison_id=saison_id, team_id=team_id),
        )
        for person in recipient
    ]
