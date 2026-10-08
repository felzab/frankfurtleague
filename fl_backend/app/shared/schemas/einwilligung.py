from pydantic import BaseModel, ConfigDict


class FLEinwilligungBeleg(BaseModel):
    """When a person set one consent choice, and under which wording."""

    # An instant in UTC (`app/core/recording.py :: log_stamp`), where the block carries a day: two
    # acts on one day are ordered by it.
    am: str
    # A label of `app/shared/einwilligung.py :: FASSUNGEN`: the words the person was shown.
    text_version: str


class FLEinwilligungNachweis(FLEinwilligungBeleg):
    """The evidence one consent choice keeps: the act that set its value, and on a withdrawal the grant it ended."""

    erteilt_zuvor: FLEinwilligungBeleg | None = None


class FLEinwilligungNachweise(BaseModel):
    """Each choice's evidence, null until its person sets it: a record no person has answered carries none."""

    umfang: FLEinwilligungNachweis | None = None
    medien: FLEinwilligungNachweis | None = None


class FLEinwilligungStand(BaseModel):
    """Each choice's stand where the account page was served, null where the record carried no evidence for it.

    A consent PATCH's precondition, echoed back as served, never a secret (`docs/backend/spec.md :: I591`).
    """

    # Required with no default, as `kontakte_stand` is: an omitted precondition judges nothing.
    umfang: str | None
    medien: str | None


# As a press echoes it. Forbidden rather than ignored: a key the precondition does not compare would
# read as judged.
class FLEinwilligungStandPayload(FLEinwilligungStand):
    model_config = ConfigDict(extra="forbid")
