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


class FLMedienStand(BaseModel):
    """The instant the media choice's evidence carried where the account page was served, null where it carried none.

    A consent PATCH's precondition, echoed back as served, never a secret (`docs/backend/spec.md :: I995`).
    """

    # Required with no default, as `kontakte_stand` is: an omitted precondition judges nothing.
    medien: str | None


class FLEinwilligungStand(FLMedienStand):
    """`FLMedienStand` for a control moving both choices."""

    umfang: str | None


# The two as a press echoes them. Forbidden rather than ignored: a key the precondition does not
# compare would read as judged.
class FLMedienStandPayload(FLMedienStand):
    model_config = ConfigDict(extra="forbid")


class FLEinwilligungStandPayload(FLEinwilligungStand):
    model_config = ConfigDict(extra="forbid")
