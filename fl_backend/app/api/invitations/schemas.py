from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.api.outbox.schemas import FLOutboxStatus
from app.shared.schemas.custom import CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLInvitation(BaseReadModel):
    """One minted link as it is served, without its hash."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    # Required as a key and null while the invite stands: `uniq_invitation_live` reaches the rows
    # holding null, so a row that could omit it would fall outside the one-live-invite rule.
    revoked_at: CustomOptionalDateString
    # The German day the link's mails were last owed to the team's confirmed seats, by the season's press or the team's own;
    # null where none ever was, a link minted for copying. Stored rather than read off `outbox`, whose rows are erased a
    # retention after their final state.
    sent_at: CustomOptionalDateString


class FLInvitationRecord(FLInvitation):
    """One minted link as `invitations` stores it: the hash of the copied link and of every mailed one, each live."""

    token_hashes: list[str]


class FLInvitationRow(FLInvitation):
    """One live link as the team's read serves it."""

    # What became of the last mail owed about it, null where none was ever owed.
    delivery: FLOutboxStatus | None


class FLInvitationMintResponse(BaseAPIResponse):
    """A freshly minted registration link, and the only answer that ever carries its raw value: no later read recovers it."""

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    invitation_id: CustomObjectId
    token: CustomNonEmptyString


class FLInvitationWriteResponse(BaseAPIResponse):
    """The revoked link, which stays stored so a delivery event about it still lands."""

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    invitation_id: CustomObjectId


type FLInvitationSkipReason = Literal[
    "austritt_entered",
    "no_kontakt_block",
    "no_confirmed_kontaktperson",
    "already_sent",
]


class FLInvitationLinkRow(BaseModel):
    """One team's registration link, and what the season's press would do for the team today."""

    team_id: CustomObjectId
    # The junction row's own copy of the club's name, so the list reads as the season's teams do
    # rather than needing a second read of `teams`.
    team_name: CustomNonEmptyString
    skipped: FLInvitationSkipReason | None
    # Whether the team holds a live link: the plan the row shares with the press carries no trace of the invitation itself.
    has_link: bool
    # The live link's `sent_at`: the day its mails were last owed, null where it never was mailed or the team holds none.
    sent_at: CustomOptionalDateString


class FLTeamLinkState(BaseModel):
    """A team's registration link: the live link, whether it opens anything, and what the season's press would do for the team."""

    invitation: FLInvitationRow | None
    # Composed here rather than derived by the reader, as the application form's window is: a link is live and opens
    # nothing while the season takes no registration, the window's end shutting nothing.
    running: bool
    # Whether the season stands paused: the window can read closed for its dates alone.
    paused: bool
    # Why the season's press would pass this team over today, `None` where it would mail it.
    skipped: FLInvitationSkipReason | None


class FLInvitationMailPayload(BaseModel):
    """The team's live link, to be mailed to its confirmed seats."""

    model_config = ConfigDict(extra="forbid")

    # The row the panel read, so a link replaced or withdrawn since is refused rather than another one mailed.
    invitation_id: CustomObjectId


class FLInvitationMailResponse(BaseAPIResponse):
    """How many the team's live link is owed to: its confirmed seats, one per stored address, 0 where nobody confirmed."""

    mailed: int = Field(ge=0)


class FLInvitationDispatchResponse(BaseAPIResponse):
    """How the season's press came out, counted in teams."""

    saison_id: CustomNonEmptyString
    mailed: int = Field(ge=0)
    skipped: int = Field(ge=0)
    # Each one logged with what became of its commit; a team whose commit went unanswered is counted here too.
    failed: int = Field(ge=0)
