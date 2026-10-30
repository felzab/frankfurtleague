from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from app.shared.schemas.bounds import EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN
from app.shared.schemas.literals import FLEinwilligungUmfang, FLKontaktKenntnisnahmeUmfang
from app.shared.schemas.responses import BaseReadModel


class FLEinwilligungBeleg(BaseModel):
    """When a person set one consent choice, and under which wording."""

    # An instant in UTC (`app/core/recording.py :: log_stamp`), where the block carries a day: two
    # acts on one day are ordered by it.
    am: str
    # A label of `app/shared/einwilligung.py :: FASSUNGEN`: the words the person was shown.
    text_version: str


class FLEinwilligungNachweis(FLEinwilligungBeleg, BaseReadModel):
    """The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended."""

    erteilt_zuvor: FLEinwilligungBeleg | None = None


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


# The label of the control the press was given under, recorded on its evidence. The ceiling counts what
# arrives and the strip runs after it, so the published `maxLength` is what the backend accepts.
CustomEinwilligungTextVersion = Annotated[
    str,
    StringConstraints(max_length=EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
]


class FLSelbstEinwilligungPayload(BaseModel):
    """A pupil's, a referee's or a registration's own two choices on their record.

    Both choices on every press, and no member defaulted: a default would let a page that forgot one
    reset the person's other choice.
    """

    model_config = ConfigDict(extra="forbid")

    umfang: FLEinwilligungUmfang
    medien: bool
    text_version: CustomEinwilligungTextVersion
    # The record's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload


class FLSitzEinwilligungPayload(BaseModel):
    """A seat holder's own two choices for every seat they hold on one row.

    Both choices on every press: a page that sent one alone would leave the other judged by nothing.
    """

    model_config = ConfigDict(extra="forbid")

    umfang: FLKontaktKenntnisnahmeUmfang
    medien: bool
    text_version: CustomEinwilligungTextVersion
    # The row's `nachweis_stand` as the page was served it.
    nachweis_stand: FLEinwilligungStandPayload
