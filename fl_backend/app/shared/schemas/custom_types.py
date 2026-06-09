from typing import Annotated, Any

from bson import ObjectId
from pydantic import GetCoreSchemaHandler, StringConstraints
from pydantic_core import CoreSchema, core_schema


class CustomObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:
        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema([
                # If it's already an ObjectId, allow it
                core_schema.is_instance_schema(ObjectId),
                # If it's a string, validate it as an ObjectId
                core_schema.chain_schema([
                    core_schema.str_schema(),
                    core_schema.no_info_plain_validator_function(ObjectId),
                ]),
            ]),
            # How to serialize it to JSON
            serialization=core_schema.plain_serializer_function_ser_schema(lambda v: str(v)),
        )


# Regex for YYYY-MM-DD (e.g., 2026-06-08)
# Ensures months are 01-12 and days are 01-31
DATE_REGEX = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"

# Regex for HH:MM:SS (e.g., 14:30:00)
# Ensures hours are 00-23, minutes 00-59, seconds 00-59
TIME_REGEX = r"^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"

# Create the reusable custom types
CustomStrDate = Annotated[str, StringConstraints(pattern=DATE_REGEX, strict=True)]

CustomStrTime = Annotated[str, StringConstraints(pattern=TIME_REGEX, strict=True)]
