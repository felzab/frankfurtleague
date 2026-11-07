from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, Field

from app.api.grants.schemas import FLUtcInstant
from app.core.recording import ActorRole, FLAction, FLActionType
from app.shared.schemas.bounds import ACTION_LOG_SEARCH_MAX_LENGTH, ACTOR_PSEUDONYM_SHOWN
from app.shared.schemas.custom import CustomDateString, CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse

# The stored operation of a row `core/recording.py :: record_write` wrote.
type FLActionLogEntryOperation = Literal["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]


class FLActorWithAddress(BaseModel):
    """An actor the row names by `email`: an administrator's address, or a sentinel."""

    kind: Literal["admin_session", "system", "public"]
    email: str


def _served_prefix(pseudonym: str) -> str:
    return pseudonym[:ACTOR_PSEUDONYM_SHOWN]


class FLActorPerson(BaseModel):
    """A signed-in person, named by a pseudonym prefix and the kind of person the write was made as, and never by an address."""

    kind: Literal["person_session"]
    pseudonym: Annotated[str, AfterValidator(_served_prefix)]
    funktion: ActorRole


# On `kind`, so a person's row can never be read as carrying an address, nor an administrator's as
# carrying none.
FLAktor = Annotated[FLActorWithAddress | FLActorPerson, Field(discriminator="kind")]


class FLActionLogEntryRequest(BaseModel):
    method: str
    path: str


class FLAktionRecord(BaseModel):
    """One row as `action_log` stores it: its actor before any address is withheld, and no derived `stand_secured`."""

    id: CustomObjectId = Field(validation_alias="_id")
    at: str
    # The TTL index's key: the same instant as `at`, as a date.
    at_date: datetime
    actor: FLAktor
    trace_id: str
    request: FLActionLogEntryRequest | None
    collection: str
    operation: FLActionLogEntryOperation
    # A list is `delete_many`'s, and a season's id is its string.
    document_id: CustomObjectId | str | list[CustomObjectId | str] | None
    db_filter: dict[str, str] | None
    before: dict[str, Any] | list[dict[str, Any]] | None
    modified_count: int | None
    redacted_at: str | None
    erasure_reason: str | None


class FLActionLogRecord(BaseModel):
    """One act as `action_log` stores it, written by `app/core/recording.py :: record_act` alone."""

    id: CustomObjectId = Field(validation_alias="_id")
    at: datetime
    by: str
    team: str | None
    action: FLAction
    record_id: CustomObjectId | None
    label: str | None
    count: int | None
    trace_id: str


class FLActionLogFilterParams(BaseModel):
    # The last row of the page before. A malformed one answers 422, as every query id does.
    cursor: CustomObjectId | None = None
    # A case-blind search over the team and the label: German action words are reached by `type`.
    q: str | None = Field(default=None, max_length=ACTION_LOG_SEARCH_MAX_LENGTH)
    by: str | None = None
    # LIST, one key per value: a filter's one option may stand for several categories.
    type: list[FLActionType] | None = None
    # German days, both inclusive.
    from_day: CustomDateString | None = None
    until_day: CustomDateString | None = None


class FLActionLogEntry(BaseModel):
    """One act as the Protokoll serves it. Its `trace_id` and `record_id` stay in the store."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    at: FLUtcInstant
    by: str
    team: str | None
    action: FLAction
    label: str | None
    count: int | None


class FLActionLogListResponse(BaseAPIResponse):
    action_log: list[FLActionLogEntry]
    # Where the next page starts, null on the last.
    cursor: CustomObjectId | None
    # Every value `by` holds across the whole log, the who filter's options.
    by_options: list[str]
