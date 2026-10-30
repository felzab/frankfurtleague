from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.api.outbox.schemas import FLOutboxState
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.literals import FLKontaktRolle
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel


class FLEinladung(BaseReadModel):
    """One minted link as it is served, without its hash."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    created_at: CustomDateString
    # The bound actor, on no payload: a link and its `aktionen` row cannot then name two people.
    created_by: CustomNonEmptyString
    # Required as a KEY and null while the invite stands: `uniq_einladung_live` reaches the rows
    # holding null, so a row that could omit it would fall outside the one-live-invite rule.
    widerrufen_am: CustomOptionalDateString


class FLEinladungRecord(FLEinladung):
    """One minted link as `einladungen` stores it: the hash of the copied link and of every mailed one, each live."""

    token_hashes: list[str]


class FLInvitationRow(FLEinladung):
    """One live link as the team's read serves it: the stored row, its minter withheld where the ban list holds that address."""

    # Null exactly where `created_by_barred` is set, as the grants list withholds its actors.
    created_by: CustomNonEmptyString | None
    created_by_barred: bool
    # What became of the last mail owed about it, null where none was ever owed.
    delivery: FLOutboxState | None


class FLInvitationMintResponse(BaseAPIResponse):
    """A freshly minted registration link, and the only answer that ever carries its raw value.

    Shown once for copying and mailed on a separate press; no later read recovers it from the hash.
    """

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    invitation_id: CustomObjectId
    token: CustomNonEmptyString
    created_at: CustomDateString
    created_by: CustomNonEmptyString


class FLInvitationWriteResponse(BaseAPIResponse):
    """The revoked row. Revoking keeps it, so a delivery event about its link still lands somewhere."""

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    invitation_id: CustomObjectId


# Here rather than in `teams/schemas.py`, whose endpoint answers it: there it would close an import cycle through
# `bewerbungen/schemas.py`.
class FLInvitationResponse(BaseAPIResponse):
    """The team's live link for one season, or nothing, beside the window deciding what it opens."""

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    # Null where the team holds none: a link is minted on a press, so holding none is the state
    # every team starts in.
    invitation: FLInvitationRow | None
    # Composed here rather than derived by the reader, as `FLBewerbungWindowResponse` composes its
    # own: a link is live and opens nothing the moment the registration window shuts.
    running: bool


class FLInvitationRecipient(BaseModel):
    """One mailbox a link goes to, and the seat it is addressed as."""

    rolle: FLKontaktRolle
    vorname: CustomNonEmptyString
    email: CustomNonEmptyString


# Five ordinary states, a failure and an unknown: `erzeugung_failed` says the league failed
# that team and `erzeugung_uncertain` that it cannot tell, and a surface words both apart from the
# rest.
type FLInvitationDispatchGrund = Literal[
    "austritt_entered",
    "erzeugung_failed",
    "erzeugung_uncertain",
    "no_kontaktblock",
    "no_confirmed_kontaktperson",
    "kontakte_barred",
    "already_sent",
]


class _EinladungVersandZeile(BaseModel):
    """What the preview and the press both say about one team."""

    team_id: CustomObjectId
    # The junction row's own copy of the club's name, so the list reads as the season's teams do
    # rather than needing a second read of `teams`.
    team_name: CustomNonEmptyString
    recipient: list[FLInvitationRecipient]
    skipped: FLInvitationDispatchGrund | None
    # Served rather than derived: a row carries no trace of the invitation the team holds, so a
    # caller cannot tell a team whose link this press kills from one that never had a link.
    replaced_link: bool


class FLInvitationDispatchPreviewRow(_EinladungVersandZeile):
    """One team as the preview reports it. It mints nothing, so it answers no link."""


class FLInvitationDispatchRow(_EinladungVersandZeile):
    """One team as the press left it: `recipient` are owed the team's link, which each mail's hand-out mints."""

    # Whether the team held a live link when the press read it, which a failed row's page needs to
    # say that link still opens. Null where the press failed before reading it: false would say none
    # existed.
    had_link: bool | None


class FLInvitationDispatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # False by default, so pressing twice mails nobody twice: a team whose live link already has a mail owed or sent is
    # skipped unless this says otherwise.
    resend: bool = False


class FLInvitationMailPayload(BaseModel):
    """The one live link a team's panel shows, to be mailed to the team's confirmed seats."""

    model_config = ConfigDict(extra="forbid")

    # The row the panel read, so a link replaced or withdrawn since is refused rather than another one mailed.
    invitation_id: CustomObjectId


class FLInvitationMailResponse(BaseAPIResponse):
    """Who the team's live link is owed to: its confirmed seats, one entry per stored address, none where nobody confirmed."""

    invitation_id: CustomObjectId
    recipient: list[FLInvitationRecipient]


class FLInvitationDispatchPreviewResponse(BaseAPIResponse):
    """Who the press would mail, over the same rule the press then performs."""

    saison_id: CustomNonEmptyString
    rows: list[FLInvitationDispatchPreviewRow]


class FLInvitationDispatchResponse(BaseAPIResponse):
    """What the press did, per admitted team of the season."""

    saison_id: CustomNonEmptyString
    rows: list[FLInvitationDispatchRow]
