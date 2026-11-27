from datetime import date, datetime
from typing import Final, get_args

from pydantic import BaseModel, Field

from app.core.recording import FLAction, FLActionType
from app.shared.schemas.bounds import KONTAKT_EMAIL_MAX_LENGTH
from app.shared.schemas.custom import CustomObjectId, CustomSpielNr, FLUtcInstant
from app.shared.schemas.responses import BasePayload, BaseReadModel


class FLActionLogRecord(BaseModel):
    """One act as `action_log` stores it, inserted by `record_act` alone."""

    id: CustomObjectId = Field(validation_alias="_id")
    at: datetime
    by: str
    team: str | None
    action: FLAction
    record_id: CustomObjectId | None
    saison_id: str | None
    spiel_nr: CustomSpielNr | None
    label: str | None
    count: int | None
    trace_id: str


# The days the Protokoll's filters may name: wider than any row's, and each with a next midnight and a UTC instant that
# `date` and BSON can hold, so a day past them is refused rather than overflowing into a 500.
ACTION_LOG_DAY_MIN: Final = date(2000, 1, 1)
ACTION_LOG_DAY_MAX: Final = date(2999, 12, 31)

# The longest word a row stores, an erasure's reference: a longer search matches nothing.
ACTION_LOG_SEARCH_MAX_LENGTH: Final = 200


class FLActionLogFilterPayload(BasePayload):
    """What the action log's read narrows by."""

    # The last row of the page before.
    cursor: CustomObjectId | None = None
    # A case-blind search over the team, the season and the label: German action words are reached by `type`.
    q: str | None = Field(default=None, max_length=ACTION_LOG_SEARCH_MAX_LENGTH)
    by: str | None = Field(default=None, max_length=KONTAKT_EMAIL_MAX_LENGTH)
    # A list: a filter's one option may stand for several categories.
    type: list[FLActionType] | None = Field(default=None, max_length=len(get_args(FLActionType.__value__)))
    # A German day, inclusive.
    from_day: date | None = Field(default=None, ge=ACTION_LOG_DAY_MIN, le=ACTION_LOG_DAY_MAX)


class FLActionLogEntry(BaseModel):
    """One recorded act."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    at: FLUtcInstant
    by: str
    team: str | None
    action: FLAction
    # The season and the fixture the act was about.
    saison_id: str | None
    spiel_nr: CustomSpielNr | None
    label: str | None
    count: int | None


class FLActionLogListResponse(BaseReadModel):
    action_log: list[FLActionLogEntry]
    # Where the next page starts, null on the last.
    cursor: CustomObjectId | None


class FLActionLogByOptionsResponse(BaseReadModel):
    # Every value `by` holds across the whole log, the who filter's options.
    by_options: list[str]
