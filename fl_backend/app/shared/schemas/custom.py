import re
from dataclasses import dataclass
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
from pydantic.json_schema import JsonSchemaValue, WithJsonSchema
from pydantic_core import CoreSchema, core_schema

from app.shared.schemas.bounds import TEAM_SHORTHAND_LENGTH

DATE_REGEX = r"^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"

TIME_REGEX = r"^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"

# 24 hex characters, what `str(ObjectId(...))` produces, and every string `parse_object_id` takes. Unanchored:
# `app/core/routing.py :: ObjectIdConvertor` compiles it into a whole path, which carries its own anchors.
OBJECT_ID_REGEX = "[0-9a-fA-F]{24}"


def parse_object_id(value: str) -> ObjectId | None:
    """`None` rather than a raise: the log's search term answers a malformed id with a text match.

    One reader for it and for the payload type, so the two cannot disagree about what names a document.
    """

    try:
        oid = ObjectId(value)
    except InvalidId:
        return None

    # `bytes.fromhex` skips ASCII whitespace and bson re-checks no length, so a 24-character value
    # holding two of them is kept as an eleven-byte id nobody sent. Folded, because bson
    # lower-cases a well-formed upper-case id and that is not the defect.
    return oid if str(oid).lower() == value.lower() else None


class CustomObjectIdAnnotation:
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler: GetCoreSchemaHandler) -> CoreSchema:

        def validate_str_to_oid(v: str) -> ObjectId:
            oid = parse_object_id(v)
            if oid is None:
                # No `from`: the reader answers `None` both for a value bson refused and for one
                # it decoded to something else, so there is no single cause to chain.
                raise ValueError("Invalid ObjectId")

            return oid

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
        return handler(core_schema.str_schema(pattern=f"^{OBJECT_ID_REGEX}$"))


CustomObjectId = Annotated[ObjectId, CustomObjectIdAnnotation]


# The path-parameter spelling, deliberately the SAME type. NEVER give it a converter declaring
# `Annotated[str, ...]` while returning an ObjectId: every endpoint's id would then type as `str`.
CustomRouteObjectId = CustomObjectId


def parse_empty_string_to_none(value: Any) -> Any:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


CustomOptionalString = Annotated[str | None, BeforeValidator(parse_empty_string_to_none)]


# What a blank input is before `parse_empty_string_to_none` reads it as absent.
BLANK_PATTERN = r"^\s*$"


@dataclass(frozen=True)
class AdmitsOnInput:
    """The request-side schema also admits what a before-validator folds away.

    The document describes a value after its fold, and a client generated from it refuses what the
    backend accepts unless the request side says so; the response side keeps the folded shape.
    """

    admitted: JsonSchemaValue

    def __get_pydantic_json_schema__(self, core_schema: CoreSchema, handler: GetJsonSchemaHandler) -> JsonSchemaValue:
        schema = handler(core_schema)
        if handler.mode != "validation":
            return schema

        # Flattened where the type is already a union, the optional ones being one.
        alternatives = schema["anyOf"] if set(schema) == {"anyOf"} else [schema]

        return {"anyOf": [*alternatives, self.admitted]}


BLANK_ADMITTED = AdmitsOnInput({"type": "string", "pattern": BLANK_PATTERN})


def fold_shorthand(value: Any) -> Any:
    return value.strip().upper() if isinstance(value, str) else value


SHORTHAND_PATTERN = rf"^[A-Z]{{{TEAM_SHORTHAND_LENGTH}}}$"

# What the fold turns into `SHORTHAND_PATTERN`: either case, and padding the strip takes off.
SHORTHAND_INPUT_PATTERN = rf"^\s*[A-Za-z]{{{TEAM_SHORTHAND_LENGTH}}}\s*$"

# Folded before the pattern judges it, on every model carrying a club's code: `uniq_shorthand` and
# every comparison of codes are byte for byte, so `abc` and `ABC` would otherwise be two clubs. The
# fold sits outermost, after the constraint, so it runs first; the request side publishes what the
# fold accepts, the response side the folded code.
CustomShorthand = Annotated[
    str,
    StringConstraints(pattern=SHORTHAND_PATTERN),
    BeforeValidator(fold_shorthand),
    WithJsonSchema({"type": "string", "pattern": SHORTHAND_INPUT_PATTERN}, mode="validation"),
]

# An alias rather than a repeated `Field`, so a field cannot be added with the bound left off.
CustomNonEmptyString = Annotated[str, StringConstraints(min_length=1)]

# The WRITE-side floor: `min_length` counts CHARACTERS, so the alias above takes spaces alone -- a
# value stored and served as empty. NEVER on a read model, where the strip runs first and a stored
# blank would refuse.
CustomStrippedNonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


# A LITERAL SPACE, never `\s`: the class sits INSIDE the anchors, so `\s` there would let the value
# carry the newlines and tabs they exclude.

# The final digit sits outside the class, so no accepted value is punctuation and spaces alone: such
# a value is stored and shown as a number, and nobody can ring it.
PHONE_REGEX = r"^([+]?[ 0-9\-().]{2,19}[0-9])$"

# Unicode letters and the separators a real name uses, because an ASCII rule would refuse `Körner`.
# On the WRITE payloads only: a read model refusing a stored name 500s the response for one bad row.
PERSON_NAME_PATTERN = r"^\p{L}[\p{L}\-' ]*$"

# Paired with `strip_whitespace`, which runs first and
# takes no NUL, so padding is repaired and an interior character refused.
SINGLE_LINE_PATTERN = r"^[^\x00\n\v\f\r\u0085\u2028\u2029]*$"

# Byte-for-byte the regex zod uses for `z.regexes.domain`, because `ExternalUrlSchema` tests the
# parsed hostname against exactly this and both ends must accept or reject a value alike.
DOMAIN_REGEX = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$")

EXTERNAL_URL_SCHEMES = frozenset({"http", "https"})

# Every C0 control, which is what `urlsplit` discards before parsing -- the three WHATWG removes
# anywhere, and the rest it takes off the front. What this module RETURNS has to be what it checked.
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
    """From a PAYLOAD's `model_validator` alone: refusing a stored reversal on read would hide it from the edit that repairs it.

    German for the log and the forms mirroring it, a 422 carrying no sentence.
    """

    if end < start:
        raise ValueError(f"{end_label} darf nicht vor {start_label} liegen.")


CustomOptionalDateString = Annotated[CustomDateString | None, BeforeValidator(parse_empty_string_to_none), BLANK_ADMITTED]
CustomOptionalTimeString = Annotated[CustomTimeString | None, BeforeValidator(parse_empty_string_to_none), BLANK_ADMITTED]

# Empty string coerces to None first, so "" is stored as absent rather than failing the pattern.
CustomOptionalPhoneString = Annotated[
    Annotated[str, StringConstraints(pattern=PHONE_REGEX)] | None,
    BeforeValidator(parse_empty_string_to_none),
    BLANK_ADMITTED,
]


def validate_external_url(value: str) -> str:
    """An http(s) URL safe to render into an href.

    Scheme-restricted: a bare "is this a URL" check accepts `javascript:`, an XSS sink once React
    renders it into an href. Not `AnyHttpUrl`, which normalises and would rewrite a stored value.
    """
    # The space is not among `URL_STRIPPED_CHARACTERS`, so surrounding spaces are the caller's to strip:
    # `urlsplit` ignores them internally, so a leading space would pass every check and be returned.
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

    # `https://frankfurtleague.de@evil.com` resolves to `evil.com`: everything before the `@` is
    # userinfo, which every host check below excludes and never sees. A surface that renders the
    # string and follows the host sends a trusting reader to the attacker.
    if parts.username or parts.password:
        raise ValueError("URL must not carry credentials before the @")

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

    # Python's `$` also matches before one final newline, and zod's does not. Harmless here:
    # `URL_STRIPPED_CHARACTERS`, the newline among them, is removed before parsing, and an encoded
    # `%0A` keeps its `%`, which no label admits.
    if not DOMAIN_REGEX.match(host):
        raise ValueError("URL must point at a domain name")

    # What the checks ran on, and never `parts.geturl()`, which would also lowercase the scheme.
    return parsed


CustomExternalUrl = Annotated[str, AfterValidator(validate_external_url)]

# Absence spelled as NULL, as every other optional value here spells it, and the empty string
# coerced to it first -- `validate_external_url` would reject `""`, and an empty `href` is a live
# link to the current page rather than no link at all.
CustomOptionalExternalUrl = Annotated[CustomExternalUrl | None, BeforeValidator(parse_empty_string_to_none)]

CustomSpielNr = Annotated[int, Field(gt=0)]

# `[0-9]`, never `\d`: Python's `\d` matches Unicode decimal digits where the frontend mirror's
# does not, and both ends parse this string for win/draw/loss.
CustomErgebnisString = Annotated[str, StringConstraints(pattern=r"^[0-9]+:[0-9]+$")]
