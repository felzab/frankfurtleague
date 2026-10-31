from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Final, Literal, get_args

from bson import ObjectId
from pydantic import AfterValidator, BaseModel, Field, TypeAdapter, field_validator, model_validator

from app.core.recording import ActorRole
from app.shared.schemas.bounds import ACTOR_PSEUDONYM_SHOWN, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLSortOrder
from app.shared.schemas.responses import BaseAPIResponse

# One alias for both the row and the filter: without it the two hand-copies drift, and a filter
# narrower than the rows answers a legal `?operation=` with a 422 that no test would catch.
type FLActionLogEntryOperation = Literal["insert", "insert_many", "patch_one", "patch_many", "delete_many", "erase_many"]


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


# One alias for the row and the categoriser below, which is exhaustive over it: a kind added here
# without a category is a recorded write the log's origin filter cannot reach.
FLAktorKind = Literal["admin_session", "person_session", "system", "public"]

# What the origin filter narrows on, and no stored value: `person` files an administrator's session
# and a signed-in person's alike, so the categories outlive the kinds they are derived from.
type FLActionLogEntryHerkunft = Literal["person", "system", "public"]


class FLAktorMitAdresse(BaseModel):
    """An actor the row names by `email`: an administrator's address, or a sentinel."""

    kind: Literal["admin_session", "system", "public"]
    email: str


class FLActorWithAdresseRow(FLAktorMitAdresse):
    """An actor named by `email` as both reads serve one: the stored actor, its address withheld where the ban list holds it."""

    # Null exactly where `email_barred` is set, as the grants list withholds its actors.
    email: str | None
    email_barred: bool


def _served_prefix(pseudonym: str) -> str:
    return pseudonym[:ACTOR_PSEUDONYM_SHOWN]


class FLActorPerson(BaseModel):
    """A signed-in person, named by a pseudonym prefix and the kind of person the write was made as, and never by an address."""

    kind: Literal["person_session"]
    pseudonym: Annotated[str, AfterValidator(_served_prefix)]
    funktion: ActorRole


# On `kind`, so a person's row can never be read as carrying an address, nor an administrator's as
# carrying none.
FLAktor = Annotated[FLAktorMitAdresse | FLActorPerson, Field(discriminator="kind")]

# The stored actor, judged before its address is withheld: a row the stored shape refuses fails
# rather than being served withheld.
FLAktorAdapter = TypeAdapter(FLAktor)

FLAktorZeile = Annotated[FLActorWithAdresseRow | FLActorPerson, Field(discriminator="kind")]


def herkunft_of_kind(kind: FLAktorKind) -> FLActionLogEntryHerkunft:
    """A `match` with no fallback branch: a kind added beside these fails the type check here rather than falling in with the signed-in people.

    `fl_frontend/src/features/aktionen/constants.ts :: AKTOR_HERKUNFT` files a row the same way, and
    the two move together.
    """

    match kind:
        case "admin_session" | "person_session":
            return "person"
        case "system":
            return "system"
        case "public":
            return "public"


# Keyed by the stored value, which the tally reads raw: a kind no category names is absent here, and
# an absent one counts for its area and under no origin.
HERKUNFT_JE_KIND: Final[Mapping[str, FLActionLogEntryHerkunft]] = {kind: herkunft_of_kind(kind) for kind in get_args(FLAktorKind)}


class FLActionLogEntryRequest(BaseModel):
    method: str
    path: str


class FLActionLogEntry(BaseModel):
    """One recorded write."""

    # A read model, so nothing here refuses a stored value: the log holds copies of documents from
    # every other collection, and a row it cannot serve is a write nobody can see was recorded.
    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    at: str
    # As served, so a row reaches the wire only through
    # `app/api/aktionen/services.py :: mit_vorenthaltenem_akteur`.
    actor: FLAktorZeile
    trace_id: str
    request: FLActionLogEntryRequest | None
    collection: str
    operation: FLActionLogEntryOperation
    document_id: str | None
    db_filter: dict[str, str] | None
    # In the image's place, never beside it: a list page of stored pre-images is megabytes serving
    # one badge. An empty array is a removal that matched nothing, and secured nothing.
    stand_secured: bool
    modified_count: int | None
    redacted_at: str | None
    anlass: str | None

    @model_validator(mode="before")
    @classmethod
    def _judge_the_stored_image(cls, data: Any) -> Any:
        """Whether the row secured an image, computed from the stored `before` this model drops.

        Presence-aware, so a dropped field cannot read as a stored null.
        """

        if isinstance(data, Mapping) and "stand_secured" not in data:
            image = data.get("before")
            data = {**data, "stand_secured": len(image) > 0 if isinstance(image, list) else image is not None}
        return data

    @field_validator("document_id", mode="before")
    @classmethod
    def _as_text(cls, value: Any) -> str | None:
        """An ObjectId everywhere but `saisons`, whose `_id` is the season string.

        Text rather than a union: the wire names only the row a restore targets; a
        removal's id array serves the redaction alone.
        """

        return None if value is None or isinstance(value, list) else str(value)


class FLActionLogEntryWithBefore(FLActionLogEntry):
    """One recorded write with the document it replaced, which only the single-row read serves."""

    # A list is `delete_many`'s: a removal follows no write a restore could replay, so one row
    # carries every image it took.
    before: dict[str, Any] | list[dict[str, Any]] | None

    @field_validator("before", mode="before")
    @classmethod
    def _json_safe(cls, value: Any) -> Any:
        """The stored image is a real Mongo document, so its ids are `ObjectId`s that JSON cannot carry.

        Converted on the way out rather than on the way in: the row keeps the document as it stood,
        and only the wire sees text.
        """

        return _stringify_oids(value)


class FLAktionRecord(BaseModel):
    """One row as `aktionen` stores it: its actor before any address is withheld, and no derived `stand_secured`."""

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
    anlass: str | None


FLAktionenListAdapter = TypeAdapter(list[FLActionLogEntry])


class FLAktionenFilterParams(BaseModel):
    # LISTS, because the bar offering them is multi-select: one key per value, FastAPI's repeated query
    # parameter. Absent is the facet turned off, `$in` of no value answering nothing.
    # Text rather than `Collection`: a log row keeps the name of a collection since retired, which the tally offers too.
    collection: list[str] | None = None
    operation: list[FLActionLogEntryOperation] | None = None
    # A term of its own rather than the kinds it stands for: the bar offers the categories, and a
    # caller sending kinds would have to know a mapping this endpoint owns.
    herkunft: list[FLActionLogEntryHerkunft] | None = None
    trace_id: str | None = None
    # `str`, never `CustomObjectId`: `saisons` stores its season string here, which the ObjectId
    # spelling would 422. `app/api/aktionen/services.py :: document_id_term` compiles it.
    document_id: str | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    # Newest first, and no `sort_by`: every other order over a log of recorded writes is a report
    # rather than a page, and one of them would have to be the default anyway.
    order: FLSortOrder = Field(default="desc")


class FLActionLogListResponse(BaseAPIResponse):
    action_log: list[FLActionLogEntry]
    # German for `FLBewerbungenListResponse.complete`'s reason, and load-bearing here too: the
    # log takes a row per recorded write and keeps it twelve months, so this read reaches the cap
    # by ordinary use.
    complete: bool
    # Open maps rather than the bar's closed sets: a stored value no option names would refuse a
    # response the page can otherwise serve, and an absent key is a value nothing was recorded under.
    count_per_collection: dict[str, int]
    count_per_operation: dict[str, int]
    count_per_herkunft: dict[str, int]


class FLActionLogEntrySingleResponse(BaseAPIResponse):
    action_log_entry: FLActionLogEntryWithBefore
