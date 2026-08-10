"""
SHARED · custom pydantic types

The scalar types every entity model is built from: ObjectId, the date and time string formats,
and the scheme-restricted external URL.

Invariants:
- Dates are `YYYY-MM-DD` strings compared lexicographically — the format sorts, so it works.
- `DATE_REGEX` accepts impossible dates; `date.fromisoformat` runs after it and constrains reality.
- `CustomExternalUrl` restricts the scheme — a bare URL check accepts `javascript:`, an XSS sink.
- ObjectId serialisation is context-dependent: `keep_oid` for a database write, string for the wire.
"""

import re
from datetime import date
from typing import Annotated, Any
from urllib.parse import urlsplit

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

        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema(
                [
                    core_schema.is_instance_schema(ObjectId),
                    core_schema.chain_schema(
                        [
                            core_schema.str_schema(),
                            core_schema.no_info_plain_validator_function(validate_str_to_oid),
                        ]
                    ),
                ]
            ),
            serialization=core_schema.plain_serializer_function_ser_schema(serialize_oid, info_arg=True),
        )


CustomObjectId = Annotated[ObjectId, CustomObjectIdAnnotation]


# The path-parameter spelling, deliberately the SAME type. NEVER give it a converter declaring
# `Annotated[str, ...]` while returning an ObjectId: every endpoint's id would type as `str` and a type
# checker could not see the write path at all.
CustomRouteObjectId = CustomObjectId


def parse_empty_string_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


CustomOptionalString = Annotated[str | None, BeforeValidator(parse_empty_string_to_none)]


# `fl_frontend/src/shared/schemas.ts :: PHONE_REGEX` mirrors this.
PHONE_REGEX = r"^([+]?[\s0-9\-().]{3,20})$"

# Byte-for-byte the regex zod uses for `z.regexes.domain`, because `ExternalUrlSchema` tests the parsed
# hostname against exactly this and both ends must accept or reject a value alike. Bare hosts and IP
# literals are rejected.
DOMAIN_REGEX = re.compile(r"^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$")

EXTERNAL_URL_SCHEMES = frozenset({"http", "https"})


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
    """
    Refuse a span whose end falls before its start, for a `model_validator(mode="after")` to call.

    Four payloads carry a date span -- a season's and a matchday's, on their create and their patch --
    and the rule is one rule, so it is written once here rather than four times with three chances to
    say it differently. The comparison is lexicographic, which works because these are `YYYY-MM-DD`
    strings and that format sorts (see the invariant at the top of this module).

    **On the PAYLOADS only, never on a read model.** A model validator refusing this on read would make
    a stored document that already holds a reversed span unreadable, taking down every page that lists
    it -- and the repair is precisely the edit that read has to serve first. So a stored reversal stays
    readable and becomes uneditable until it is corrected, which is the direction that leaves a way out.

    German, because this surfaces as a 422 field message the admin reads. `find_*_refusal` details go
    the other way: English for the log, with the code carrying the meaning (docs/logging/error-codes.md).
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
    """
    An http(s) URL safe to render into an href.

    Scheme-restricted on purpose: a bare "is this a URL" check accepts `javascript:` and `data:`,
    which are XSS sinks once React renders them into an href.

    Parses rather than pattern-matches, mirroring what zod's ExternalUrlSchema does on the frontend:
    split the URL, check the scheme, then test the *hostname* against DOMAIN_REGEX. A single regex
    over the whole string cannot do this correctly -- one anchored only at the start leaves every
    character after the host unvalidated, with the leading `^` carrying the scheme restriction alone.

    Deliberately not pydantic's AnyHttpUrl: that normalises the value, and appending a trailing
    slash would silently rewrite what is already stored and served.
    """
    try:
        parts = urlsplit(value)
        # Read `.port` for its side effect: urlsplit is lazy, so an invalid port only raises on access,
        # and without this the backend accepts a URL `new URL` refuses. Bound to a name because a bare
        # attribute access reads as dead code (ruff B018).
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

    # DOMAIN_REGEX is ASCII-only, and `new URL` punycodes on the way in, so zod sees "xn--...".
    # urlsplit does not, so encode first -- otherwise an umlaut domain fails validation on the read
    # path and takes the whole teams API with it.
    try:
        if host.isascii():
            # An "xn--" label that is not valid punycode passes DOMAIN_REGEX -- it is only ASCII
            # letters, digits and hyphens -- but `new URL` throws on it, so the frontend would
            # reject a value the backend stored. Round-tripping makes both ends agree.
            if "xn--" in host:
                host.encode("ascii").decode("idna")
        else:
            host = host.encode("idna").decode("ascii")
    except UnicodeError as invalid_host_error:
        raise ValueError("URL hostname is not a valid internationalised domain") from invalid_host_error

    if not DOMAIN_REGEX.match(host):
        raise ValueError("URL must point at a domain name")

    return value


CustomExternalUrl = Annotated[str, AfterValidator(validate_external_url)]
