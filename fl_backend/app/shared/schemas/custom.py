import re
from datetime import date
from typing import Annotated, Any
from urllib.parse import urlsplit

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    GetCoreSchemaHandler,
    GetJsonSchemaHandler,
    SerializationInfo,
    StringConstraints,
)
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema

DATE_REGEX = r"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"

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

        from_str_schema = core_schema.chain_schema(
            [
                core_schema.str_schema(),
                core_schema.no_info_plain_validator_function(validate_str_to_oid),
            ]
        )

        return core_schema.json_or_python_schema(
            # JSON has no ObjectId literal, so naming the instance check on the json branch would
            # declare a value that cannot arrive there.
            json_schema=from_str_schema,
            python_schema=core_schema.union_schema(
                [
                    core_schema.is_instance_schema(ObjectId),
                    from_str_schema,
                ]
            ),
            serialization=core_schema.plain_serializer_function_ser_schema(serialize_oid, info_arg=True),
        )

    @classmethod
    def __get_pydantic_json_schema__(cls, _core_schema: CoreSchema, handler: GetJsonSchemaHandler) -> JsonSchemaValue:
        """What an ObjectId looks like on the wire, in both JSON schema modes: a string.

        Declared rather than inferred: serialization walks to a plain validator no JSON schema can
        describe. Not a `return_schema`, which would warn on every `keep_oid` dump.
        """
        return handler(core_schema.str_schema())


CustomObjectId = Annotated[ObjectId, CustomObjectIdAnnotation]


# The path-parameter spelling, deliberately the SAME type. NEVER give it a converter declaring
# `Annotated[str, ...]` while returning an ObjectId: every endpoint's id would then type as `str`.
CustomRouteObjectId = CustomObjectId


def parse_empty_string_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


CustomOptionalString = Annotated[str | None, BeforeValidator(parse_empty_string_to_none)]

# An alias rather than a repeated `Field`, so a field cannot be added with the bound left off.
CustomNonEmptyString = Annotated[str, StringConstraints(min_length=1)]

# The WRITE-side floor: `min_length` counts CHARACTERS, so the alias above takes spaces alone -- a
# value stored and served as empty. NEVER on a read model, where the strip runs first and a stored
# blank would refuse (`docs/backend/spec.md :: I36`).
CustomStrippedNonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


# A LITERAL SPACE, never `\s`: the class sits INSIDE the anchors, so `\s` there would let the value
# carry the newlines and tabs they exclude.
PHONE_REGEX = r"^([+]?[ 0-9\-().]{3,20})$"

# Unicode letters and the separators a real name uses, because an ASCII rule would refuse `Körner`.
# On the WRITE payloads only: a read model refusing a stored name 500s the response for one bad row.
PERSON_NAME_PATTERN = r"^\p{L}[\p{L}\-' ]*$"

# Byte-for-byte the regex zod uses for `z.regexes.domain`, because `ExternalUrlSchema` tests the
# parsed hostname against exactly this and both ends must accept or reject a value alike.
DOMAIN_REGEX = re.compile(r"^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")

EXTERNAL_URL_SCHEMES = frozenset({"http", "https"})

# Every C0 control, which is what `urlsplit` discards before parsing -- the three WHATWG removes
# anywhere, and the rest it takes off the ends. What this module RETURNS has to be what it checked.
URL_STRIPPED_CHARACTERS = str.maketrans("", "", "".join(chr(code) for code in range(0x20)))


def validate_calendar_date(value: str) -> str:
    """DATE_REGEX accepts 2026-02-31 and 2026-04-31. This rejects days that do not exist."""
    try:
        date.fromisoformat(value)
    except ValueError as invalid_date_error:
        raise ValueError("Date is not a real calendar date") from invalid_date_error
    return value


CustomDateString = Annotated[str, StringConstraints(pattern=DATE_REGEX, strict=True), AfterValidator(validate_calendar_date)]
CustomTimeString = Annotated[str, StringConstraints(pattern=TIME_REGEX, strict=True)]


def refuse_reversed_span(*, start: str, end: str, start_label: str, end_label: str) -> None:
    """Refuse a span whose end falls before its start, from a `model_validator`.

    On the PAYLOADS only: refusing on read would make a stored reversal unreadable, and the repair
    is the edit that read must serve. German, because it surfaces as a 422.
    """

    if end < start:
        raise ValueError(f"{end_label} darf nicht vor {start_label} liegen.")


CustomOptionalDateString = Annotated[CustomDateString | None, BeforeValidator(parse_empty_string_to_none)]
CustomOptionalTimeString = Annotated[CustomTimeString | None, BeforeValidator(parse_empty_string_to_none)]

# Empty string coerces to None first, so "" is stored as absent rather than failing the pattern.
CustomOptionalPhoneString = Annotated[
    Annotated[str, StringConstraints(pattern=PHONE_REGEX)] | None,
    BeforeValidator(parse_empty_string_to_none),
]


def validate_external_url(value: str) -> str:
    """An http(s) URL safe to render into an href.

    Scheme-restricted: a bare "is this a URL" check accepts `javascript:`, an XSS sink once React
    renders it into an href. Not `AnyHttpUrl`, which normalises and would rewrite a stored value.
    """
    # Every C0 control, removed BEFORE parsing so what this returns is what the checks ran on.
    # `geturl()` would also lowercase the scheme.

    # SURROUNDING whitespace is not among them and is the caller's to strip: `urlsplit` ignores it
    # internally, so a leading space would pass every check and be returned on the value.
    parsed = value.translate(URL_STRIPPED_CHARACTERS)

    try:
        parts = urlsplit(parsed)
        # Read `.port` for its side effect: urlsplit is lazy, so an invalid port only raises on
        # access. Bound to a name because a bare attribute access reads as dead code (ruff B018).
        _port = parts.port
    except ValueError as invalid_url_error:
        raise ValueError("URL could not be parsed") from invalid_url_error

    # zod compares the scheme case-insensitively, because it reads it back off a parsed URL object.
    if parts.scheme.lower() not in EXTERNAL_URL_SCHEMES:
        raise ValueError("URL must use http or https")

    # `hostname` is the bare host: port stripped, userinfo excluded, already lowercased.
    host = parts.hostname
    if not host:
        raise ValueError("URL must point at a domain name")

    # `DOMAIN_REGEX` is ASCII-only and `new URL` punycodes on the way in, so zod sees "xn--".
    # urlsplit does not, so encode first -- otherwise an umlaut domain fails on the read path.
    try:
        if host.isascii():
            # An "xn--" label that is not valid punycode passes `DOMAIN_REGEX` but `new URL` throws
            # on it, so the frontend would reject a value the backend stored.
            if "xn--" in host:
                host.encode("ascii").decode("idna")
        else:
            host = host.encode("idna").decode("ascii")
    except UnicodeError as invalid_host_error:
        raise ValueError("URL hostname is not a valid internationalised domain") from invalid_host_error

    if not DOMAIN_REGEX.match(host):
        raise ValueError("URL must point at a domain name")

    return parsed


CustomExternalUrl = Annotated[str, AfterValidator(validate_external_url)]

# Absence spelled as NULL, as every other optional value here spells it, and the empty string
# coerced to it first -- `validate_external_url` would reject `""`, and an empty `href` is a live
# link to the current page rather than no link at all.
CustomOptionalExternalUrl = Annotated[CustomExternalUrl | None, BeforeValidator(parse_empty_string_to_none)]

# The WRITE-side spelling, as `CustomStrippedNonEmptyString` is: a URL neither begins nor ends in
# whitespace, and `validate_external_url` leaves it on -- so a leading space reaches storage and a
# trailing one is refused for the wrong reason.
CustomStrippedOptionalExternalUrl = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True), AfterValidator(validate_external_url)] | None,
    BeforeValidator(parse_empty_string_to_none),
]

CustomSpielNr = Annotated[int, Field(gt=0)]

# `[0-9]`, never `\d`: Python's `\d` matches Unicode decimal digits where the frontend mirror's
# does not, and both ends parse this string for win/draw/loss.
CustomErgebnisString = Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")]
