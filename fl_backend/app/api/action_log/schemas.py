from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.recording import FLAction, FLActionType
from app.shared.schemas.bounds import ACTION_LOG_DAY_MAX, ACTION_LOG_DAY_MIN, ACTION_LOG_SEARCH_MAX_LENGTH
from app.shared.schemas.custom import CustomObjectId, FLUtcInstant
from app.shared.schemas.responses import BaseAPIResponse


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


class FLActionLogFilterPayload(BaseModel):
    """What the Protokoll's read narrows by, in a body: `by` is an address and `q` whatever was typed."""

    model_config = ConfigDict(extra="forbid")

    # The last row of the page before. A malformed one answers 422, as every payload's id does.
    cursor: CustomObjectId | None = None
    # A case-blind search over the team and the label: German action words are reached by `type`.
    q: str | None = Field(default=None, max_length=ACTION_LOG_SEARCH_MAX_LENGTH)
    by: str | None = None
    # LIST, one key per value: a filter's one option may stand for several categories.
    type: list[FLActionType] | None = None
    # German days, both inclusive.
    from_day: date | None = Field(default=None, ge=ACTION_LOG_DAY_MIN, le=ACTION_LOG_DAY_MAX)
    until_day: date | None = Field(default=None, ge=ACTION_LOG_DAY_MIN, le=ACTION_LOG_DAY_MAX)


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
