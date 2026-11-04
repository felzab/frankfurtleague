from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.shared.einwilligung_nachweis import TextVersions
from app.shared.schemas.literals import FLEinwilligungUmfang, FLKontaktKenntnisnahmeUmfang
from app.shared.schemas.responses import BaseReadModel

# The label of each consent's one wording, as `fl_frontend/src/core/consentWordings.ts :: CONSENT_WORDINGS` keys it,
# which that module's map is checked against through the published contract. A press naming any other label is
# refused at the schema: a page loaded before a deploy moved a label shows words the record would then cite.
type FLWhatsappTextVersion = Literal["2026-11-whatsapp-1"]
type FLMedienTextVersion = Literal["2026-11-medien-1"]
type FLNameKaderTextVersion = Literal["2026-11-name-kader-1"]
type FLNameSpielplanTextVersion = Literal["2026-11-name-spielplan-1"]
type FLEinwilligungTextVersion = FLWhatsappTextVersion | FLMedienTextVersion | FLNameKaderTextVersion | FLNameSpielplanTextVersion


class FLEinwilligungBeleg(BaseModel):
    """When a person set one consent choice, and under which wording."""

    # An instant in UTC (`app/core/recording.py :: log_stamp`), where the block carries a day: two
    # acts on one day are ordered by it.
    am: str
    # The words the person was shown for this choice.
    text_version: FLEinwilligungTextVersion


class FLEinwilligungNachweis(FLEinwilligungBeleg, BaseReadModel):
    """The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended."""

    given_before: FLEinwilligungBeleg | None = None


class FLEinwilligungNachweise(BaseReadModel):
    """Each choice's evidence, null until its person sets it: a record no person has answered carries none."""

    umfang: FLEinwilligungNachweis | None = None
    medien: FLEinwilligungNachweis | None = None


class FLEinwilligungStand(BaseModel):
    """Each choice's stand where the account page was served, null where the record carried no evidence for it.

    A consent PATCH's precondition, echoed back as served, never a secret.
    """

    # Required with no default, as `kontakte_stand` is: an omitted precondition judges nothing.
    umfang: str | None
    medien: str | None


# As a press echoes it. Forbidden rather than ignored: a key the precondition does not compare would
# read as judged.
class FLEinwilligungStandPayload(FLEinwilligungStand):
    model_config = ConfigDict(extra="forbid")


# The labels a press was given under, one per choice, each recorded on that choice's evidence. Both on every press,
# for the payloads' reason below; one model per kind of record, whose scope wordings differ.
class FLSeatTextVersions(BaseModel):
    """A contact seat's two wordings: the WhatsApp switch and the media switch."""

    model_config = ConfigDict(extra="forbid")

    umfang: FLWhatsappTextVersion
    medien: FLMedienTextVersion


class FLSpielerTextVersions(BaseModel):
    """A pupil's two wordings: the name on the squad and the media switch."""

    model_config = ConfigDict(extra="forbid")

    umfang: FLNameKaderTextVersion
    medien: FLMedienTextVersion


class FLSchiedsrichterTextVersions(BaseModel):
    """A referee's two wordings: the name on the fixtures and the media switch."""

    model_config = ConfigDict(extra="forbid")

    umfang: FLNameSpielplanTextVersion
    medien: FLMedienTextVersion


def by_choice(text_versions: FLSeatTextVersions | FLSpielerTextVersions | FLSchiedsrichterTextVersions) -> TextVersions:
    """A press's labels keyed by the choice each evidences, as the evidence writers take them."""

    return {"umfang": text_versions.umfang, "medien": text_versions.medien}


class _OwnEinwilligungPayload(BaseModel):
    # Both choices on every press, and no member defaulted: a default would let a page that forgot one
    # reset the person's other choice.
    model_config = ConfigDict(extra="forbid")

    umfang: FLEinwilligungUmfang
    medien: bool
    # The record's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload


class FLAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A pupil's or a registration's own two choices on their record."""

    text_versions: FLSpielerTextVersions


class FLSchiedsrichterAccountEinwilligungPayload(_OwnEinwilligungPayload):
    """A referee's own two choices on their record."""

    text_versions: FLSchiedsrichterTextVersions


class FLSeatEinwilligungPayload(BaseModel):
    """A seat holder's own two choices for every seat they hold on one row.

    Both choices on every press: a page that sent one alone would leave the other judged by nothing.
    """

    model_config = ConfigDict(extra="forbid")

    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    text_versions: FLSeatTextVersions
    # The row's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload
