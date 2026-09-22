from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# The application's slice declares the delivery state, and one shape is stored at every home the
# register names (`app/api/zustellung/services.py :: ZIEL_PFADE`).
from app.api.bewerbungen.schemas import FLBewerbungZustellung, FLKontaktRolle
from app.shared.schemas.custom import CustomDateString, CustomNonEmptyString, CustomObjectId, CustomOptionalDateString
from app.shared.schemas.responses import BaseAPIResponse


class FLEinladungVersand(BaseModel):
    """The carrier a message about this invite is recorded in.

    A carrier rather than the record itself: `zustellung_pfad` composes a dotted path out of it, and
    the accepted send skips a row holding no carrier at all.
    """

    # Absent until something is mailed, and null never: the send writes the whole record
    # (`app/api/zustellung/services.py :: compose_ziel_zustellung_update`).
    zustellung: FLBewerbungZustellung | None = None


class FLEinladung(BaseModel):
    """One minted link as it is served -- and NO `token_hash`.

    A model declaring the hash would put every live link of the season on an admin read
    (`docs/backend/spec.md :: I275`).
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    erstellt_am: CustomDateString
    # The bound actor, on no payload: a link and its `aktionen` row cannot then name two people.
    erstellt_von: CustomNonEmptyString
    # Required as a KEY and null while the invite stands: `uniq_einladung_live` reaches the rows
    # holding null, so a row that could omit it would fall outside the one-live-invite rule.
    widerrufen_am: CustomOptionalDateString
    versand: FLEinladungVersand | None = None


class FLEinladungMintResponse(BaseAPIResponse):
    """A freshly minted registration link, and the only answer that ever carries its raw value.

    Shown once for copying and mailed on a separate press; no later read recovers it from the hash
    (`docs/backend/spec.md :: I275`).
    """

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    einladung_id: CustomObjectId
    token: CustomNonEmptyString
    erstellt_am: CustomDateString
    erstellt_von: CustomNonEmptyString


class FLEinladungWriteResponse(BaseAPIResponse):
    """The revoked row. Revoking keeps it, so a delivery event about its link still lands somewhere."""

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    einladung_id: CustomObjectId


class FLEinladungResponse(BaseAPIResponse):
    """The team's live link for one season, or nothing, beside the window deciding what it opens.

    Declared here rather than in `app/api/teams/schemas.py`, whose endpoint answers it: moving it
    there is an import cycle through `app/api/bewerbungen/schemas.py`.
    """

    saison_id: CustomNonEmptyString
    team_id: CustomObjectId
    # Null where the team holds none: a link is minted on a press, so holding none is the state
    # every team starts in.
    einladung: FLEinladung | None
    # Composed here rather than derived by the reader, as `FLBewerbungFensterResponse` composes its
    # own: a link is live and opens nothing the moment the registration window shuts.
    laeuft: bool


class FLEinladungEmpfaenger(BaseModel):
    """One mailbox a link goes to, and the seat it is addressed as."""

    rolle: FLKontaktRolle
    vorname: CustomNonEmptyString
    email: CustomNonEmptyString


# Four ordinary states and a failure: `erzeugung_fehlgeschlagen` alone says the league failed that
# team, and a surface words it apart from the rest (`docs/backend/spec.md :: I282`).
FLEinladungVersandGrund = Literal[
    "austritt_eingetragen",
    "erzeugung_fehlgeschlagen",
    "kein_kontaktblock",
    "keine_bestaetigte_kontaktperson",
    "bereits_gesendet",
]


class _EinladungVersandZeile(BaseModel):
    """What the preview and the press both say about one team."""

    team_id: CustomObjectId
    # The junction row's own copy of the club's name, so the list reads as the season's teams do
    # rather than needing a second read of `teams`.
    team_name: CustomNonEmptyString
    empfaenger: list[FLEinladungEmpfaenger]
    uebersprungen: FLEinladungVersandGrund | None
    # Served rather than derived: a row carries no trace of the invitation the team holds, so a
    # caller cannot tell a team whose link this press kills from one that never had a link.
    ersetzt_link: bool


class FLEinladungVersandVorschauZeile(_EinladungVersandZeile):
    """One team as the preview reports it. It mints nothing, so it answers no link."""


class FLEinladungVersandZeile(_EinladungVersandZeile):
    """One team as the press left it."""

    # Null exactly where the team was skipped. The raw value is answered here and never again, a
    # link being recoverable from no read.
    einladung_id: CustomObjectId | None
    token: str | None


class FLEinladungVersandPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # False by default, so pressing twice mails nobody twice: a team whose live link already carries
    # a delivery record is skipped unless this says otherwise.
    erneut: bool = False


class FLEinladungVersandVorschauResponse(BaseAPIResponse):
    """Who the press would mail, over the same rule the press then performs."""

    saison_id: CustomNonEmptyString
    zeilen: list[FLEinladungVersandVorschauZeile]


class FLEinladungVersandResponse(BaseAPIResponse):
    """What the press did, per admitted team of the season."""

    saison_id: CustomNonEmptyString
    zeilen: list[FLEinladungVersandZeile]
