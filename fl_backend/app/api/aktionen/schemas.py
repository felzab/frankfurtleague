from typing import Any, Literal

from bson import ObjectId
from pydantic import BaseModel, Field, TypeAdapter, field_validator

from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.responses import BaseAPIResponse


def _stringify_oids(value: Any) -> Any:
    """Every `ObjectId` in a stored document, at any depth, rendered as its hex.

    Recursive because a fixture embeds ids inside `team1`, `ort` and `schiedsrichter`, so a top-level
    pass would leave the ones that actually break serialization.
    """

    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {key: _stringify_oids(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stringify_oids(item) for item in value]

    return value


class FLAktor(BaseModel):
    """Who a write was attributed to. Mirrors `app/core/recording.py :: Actor`."""

    kind: Literal["admin_session", "system"]
    email: str


class FLAktionRequest(BaseModel):
    method: str
    path: str


class FLAktion(BaseModel):
    """One recorded write.

    A read model, so nothing here refuses a stored value (`docs/backend/spec.md :: I36`): this
    collection holds copies of documents from every other one, and a row it cannot serve is a row
    nobody can see was recorded.
    """

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    at: str
    actor: FLAktor
    correlation_id: str
    request: FLAktionRequest | None
    collection: str
    operation: Literal["insert", "patch_one", "patch_many"]
    document_id: str | None
    db_filter: dict[str, str] | None
    before: dict[str, Any] | None
    modified_count: int | None
    redacted_at: str | None

    @field_validator("document_id", mode="before")
    @classmethod
    def _as_text(cls, value: Any) -> str | None:
        """An ObjectId everywhere but `saisons`, whose `_id` is already the season string.

        Stringified rather than typed as a union, because the wire carries it only to identify the
        row a restore targets and a client comparing it never needs to know which it was.
        """

        return None if value is None else str(value)

    @field_validator("before", mode="before")
    @classmethod
    def _json_safe(cls, value: Any) -> Any:
        """The stored image is a real Mongo document, so its ids are `ObjectId`s that JSON cannot carry.

        Converted on the way out rather than on the way in: the row keeps the document as it stood,
        and only the wire sees text (`docs/backend/spec.md :: I43`).
        """

        return _stringify_oids(value)


FLAktionenListAdapter = TypeAdapter(list[FLAktion])


class FLAktionenFilterParams(BaseModel):
    collection: str | None = None
    operation: Literal["insert", "patch_one", "patch_many"] | None = None
    correlation_id: str | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # Newest first, and no `sort_by`: every other order over an append-only log is a report rather
    # than a page, and one of them would have to be the default anyway.
    order: Literal["asc", "desc"] = Field(default="desc")


class FLAktionenListResponse(BaseAPIResponse):
    aktionen: list[FLAktion]
