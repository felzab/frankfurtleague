from typing import Annotated

from pydantic import AfterValidator, StringConstraints

from app.shared.schemas.bounds import BEWERBUNG_TOKEN_MAX_LENGTH
from app.shared.schemas.custom import SINGLE_LINE_PATTERN, CustomDateString
from app.shared.schemas.responses import BasePayload, BaseReadModel

# The raw token of a person's link. The ceiling counts what arrives and the strip runs after it, so the
# published `maxLength` is what the backend accepts.
CustomToken = Annotated[
    str,
    StringConstraints(max_length=BEWERBUNG_TOKEN_MAX_LENGTH, pattern=SINGLE_LINE_PATTERN),
    AfterValidator(str.strip),
    StringConstraints(min_length=1),
]


class FLTokenPayload(BasePayload):
    """The token of the link a person opened, in the body: a token in a URL reaches the edge's access line."""

    token: CustomToken


# No token hash: it is a raw document key the confirmation query alone reads, so no read serves one.
class FLConfirmation(BaseReadModel):
    """One person's confirmation bookkeeping as an administrator reads it."""

    sent_at: CustomDateString
    # Stored beside the send rather than derived from it: raising the bound would otherwise move the
    # deadline of every link already in somebody's inbox.
    deadline: CustomDateString
