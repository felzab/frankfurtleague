from typing import Annotated, Any

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import (
    AfterValidator,
    BeforeValidator,
    GetCoreSchemaHandler,
    SerializationInfo,
    StringConstraints,
)
from pydantic_core import CoreSchema, core_schema

# Regex for YYYY-MM-DD (e.g., 2026-06-08)
# Ensures months are 01-12 and days are 01-31
DATE_REGEX = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"

# Regex for HH:MM:SS (e.g., 14:30:00)
# Ensures hours are 00-23, minutes 00-59, seconds 00-59
TIME_REGEX = r"^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"


class CustomObjectIdAnnotation:
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:

        def validate_str_to_oid(v: str) -> ObjectId:
            try:
                return ObjectId(v)
            except InvalidId as invalid_id_error:
                raise ValueError("Invalid ObjectId") from invalid_id_error

        def serialize_oid(v: ObjectId, info: SerializationInfo) -> Any:
            if info.context and info.context.get("keep_oid"):
                return v
            return str(v)

        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema(
                [
                    # If it's already an ObjectId, allow it
                    core_schema.is_instance_schema(ObjectId),
                    # If it's a string, validate it as an ObjectId
                    core_schema.chain_schema(
                        [
                            core_schema.str_schema(),
                            core_schema.no_info_plain_validator_function(validate_str_to_oid),
                        ]
                    ),
                ]
            ),
            # How to serialize it to JSON
            serialization=core_schema.plain_serializer_function_ser_schema(serialize_oid, info_arg=True),
        )


CustomObjectId = Annotated[ObjectId, CustomObjectIdAnnotation]


def parse_string_to_oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except InvalidId as invalid_id_error:
        raise ValueError("Invalid ObjectId format") from invalid_id_error


CustomRouteObjectId = Annotated[str, AfterValidator(parse_string_to_oid)]


def parse_empty_string_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


CustomOptionalString = Annotated[str | None, BeforeValidator(parse_empty_string_to_none)]


CustomDateString = Annotated[str, StringConstraints(pattern=DATE_REGEX, strict=True)]
CustomTimeString = Annotated[str, StringConstraints(pattern=TIME_REGEX, strict=True)]

CustomOptionalDateString = Annotated[CustomDateString | None, BeforeValidator(parse_empty_string_to_none)]
CustomOptionalTimeString = Annotated[CustomTimeString | None, BeforeValidator(parse_empty_string_to_none)]
