"""
SHARED · custom pydantic types

The scalar types every entity model is built from: ObjectId, the date and time string formats, and the
scheme-restricted external URL.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • Dates are `YYYY-MM-DD` STRINGS, not `date` objects, and are compared lexicographically throughout
    the service. The format sorts correctly, which is the only reason that works -- it is not
    negotiable.
  • `DATE_REGEX` alone accepts impossible dates such as 2026-02-31, so a calendar validator runs after
    it. The regex constrains shape; only `date.fromisoformat` constrains reality.
  • `CustomExternalUrl` restricts the SCHEME. A bare "is this a URL" check accepts `javascript:` and
    `data:`, which become XSS sinks the moment React renders them into an href. It parses rather than
    pattern-matches, mirroring the frontend's own check.
  • ObjectId serialisation is context-dependent: `keep_oid` returns the ObjectId for a database write,
    otherwise a string for the wire. A model dumped for Mongo without that context writes strings and
    silently breaks every subsequent id comparison.
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

# Regex for YYYY-MM-DD (e.g., 2026-06-08)
# Ensures months are 01-12 and days are 01-31
DATE_REGEX = r"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"

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


# The path-parameter spelling, and deliberately the SAME type rather than a second one. A path segment
# arrives as a string and the union branch above converts it, so this needs no converter of its own.
# NEVER give it a converter of its own that declares `Annotated[str, ...]` while returning an ObjectId:
# that lie is not cosmetic. Every endpoint's id parameter would type as `str`, and a type checker then
# cannot see the write path's id handling at all -- a whole class of argument-type error goes unreported.
#
# Kept as a distinct NAME because it says where the value comes from, and because `by_id()` in
# app/core/routing.py constrains the same parameter to 24 hex characters at the ROUTING layer -- the two
# belong together and the name is what pairs them.
CustomRouteObjectId = CustomObjectId


def parse_empty_string_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


CustomOptionalString = Annotated[str | None, BeforeValidator(parse_empty_string_to_none)]


# Regex for a phone number: digits, spaces, +, -, ( ) and . -- 3 to 20 characters.
# Mirrors PHONE_REGEX in fl_frontend/src/shared/schemas.ts.
PHONE_REGEX = r"^([+]?[\s0-9\-().]{3,20})$"

# Hostname rule for an external URL. Byte-for-byte the regex zod uses for `z.regexes.domain`
# (fl_frontend/node_modules/zod/v4/core/regexes.js), because ExternalUrlSchema tests the parsed
# hostname against exactly this. Keeping the two identical is the point: a value must be accepted or
# rejected the same way at both ends. It requires real domain labels, so it rejects bare hosts
# ("localhost"), single-letter TLDs, underscores, and IP literals.
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
    which are XSS sinks once React renders them into an href (audit R3b S8.1).

    Parses rather than pattern-matches, mirroring what zod's ExternalUrlSchema does on the frontend:
    split the URL, check the scheme, then test the *hostname* against DOMAIN_REGEX. A single regex
    over the whole string cannot do this correctly -- the previous one was anchored only at the
    start, so every character after the host was unvalidated and the leading `^` was carrying the
    entire scheme restriction on its own.

    Deliberately not pydantic's AnyHttpUrl: that normalises the value, and appending a trailing
    slash would silently rewrite what is already stored and served.
    """
    try:
        parts = urlsplit(value)
        # Read `.port` for its side effect: urlsplit is lazy, and an invalid port
        # ("example.com:notaport") only raises when the attribute is accessed. `new URL` rejects it
        # outright, so without this the backend would accept a URL the frontend refuses. Bound to a
        # name because a bare attribute access reads as dead code (and ruff's B018 says so).
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

    # DOMAIN_REGEX is ASCII-only, and so is the WHATWG `hostname` zod tests -- but `new URL`
    # punycodes on the way in, so zod sees "xn--kthe-...". urlsplit does not, so an umlaut domain
    # would reach the regex verbatim and be rejected. Encode first, or a perfectly ordinary
    # "https://käthe-kollwitz-schule.de" fails validation on the READ path and takes the whole teams
    # API down with it.
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
