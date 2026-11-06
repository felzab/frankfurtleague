import json
import re
from typing import Any

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.shared.schemas.custom import (
    CustomDateString,
    CustomExternalUrl,
    CustomObjectId,
    CustomTimeString,
)


class _Date(BaseModel):
    value: CustomDateString


class _Time(BaseModel):
    value: CustomTimeString


class _Url(BaseModel):
    value: CustomExternalUrl


class _ObjectId(BaseModel):
    value: CustomObjectId


@pytest.mark.parametrize("value", ["2026-02-31", "2026-04-31", "2025-02-29"])
def test_rejects_dates_that_pass_the_regex_but_do_not_exist(value):
    """`2025-02-29` is load-bearing: `DATE_REGEX` cannot tell a leap year from an ordinary one."""
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


@pytest.mark.parametrize("value", ["2026-1-1", "26-01-01", "2026/01/01", "2026-13-01", "", "today"])
def test_rejects_malformed_dates(value):
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


# The frontend mirror must reject these identically, or a form produces a 422 the user cannot act on.
@pytest.mark.parametrize("value", ["14:30", "14:30:00.5", "24:00:00", "14:60:00", "2:30:00"])
def test_rejects_times_without_seconds_or_out_of_range(value):
    with pytest.raises(ValidationError):
        _Time.model_validate({"value": value})


# A security control: `website_url` is rendered into an href. The cases embedding a valid URL matter
# most — a start-anchored check passes them.
@pytest.mark.parametrize(
    "value",
    [
        "javascript:alert(1)",
        "data:text/html,<script>",
        "vbscript:x",
        "ftp://example.com",
        "example.com",
        "https://nodot",
        "javascript:fetch('https://evil.co/x')",
        "data:text/html,<a href=https://a.bc>",
        "https://a.bc <script>alert(1)</script>",
        "https://1.2.3.4",
        "http://192.168.1.10/status",
        "https://example.com.",
        # A newline the strip cannot see: decoded before `DOMAIN_REGEX`, Python's `$` would match
        # ahead of it where zod's refuses.
        "https://example.com%0A",
        # `new URL` throws on an invalid port; `urlsplit`'s `.port` is lazy, so it has to be touched
        # for the two ends to agree.
        "https://example.com:notaport/",
        # Undecodable punycode: passes `DOMAIN_REGEX` yet `new URL` rejects it, so the round-trip
        # check is what keeps the two ends in agreement.
        "https://xn--kthe-kollwitz-schule-5nb.de",
        "https://",
        "//example.com",
        # Userinfo: `hostname` excludes it, so every host check below passed while the URL resolved
        # to whatever follows the `@`. The panel renders the string and follows the host.
        "https://frankfurtleague.de@evil.example",
        "https://user:pw@evil.example",
    ],
)
def test_rejects_non_http_schemes_and_bare_hosts(value):
    with pytest.raises(ValidationError):
        _Url.model_validate({"value": value})


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        ("https://exa\nmple.com", "https://example.com"),
        ("https://example.com\n", "https://example.com"),
        ("\thttps://example.com", "https://example.com"),
        ("https://example.com\r\n", "https://example.com"),
    ],
)
def test_returns_the_text_it_validated_rather_than_the_raw_value(stored, expected):
    """`urlsplit` discards tabs and newlines before parsing, so the host that passes `DOMAIN_REGEX` is not the raw string."""
    assert _Url.model_validate({"value": stored}).value == expected


def test_object_id_round_trips_as_a_24_hex_string():
    parsed = _ObjectId.model_validate({"value": "6890a1b2c3d4e5f607182930"})
    assert str(parsed.value) == "6890a1b2c3d4e5f607182930"

    # The `isinstance` is the assertion: a json branch declaring only a string leaves `value` a `str`,
    # and every comparison against a stored `_id` silently misses.
    from_json = _ObjectId.model_validate_json('{"value": "6890a1b2c3d4e5f607182930"}')
    assert isinstance(from_json.value, ObjectId)
    assert from_json.value == parsed.value


@pytest.mark.parametrize(
    "value",
    [
        "6890a1b2 c3d4e5f6 071829",
        "6890a1b2\tc3d4e5f6\t071829",
        "6890a1b2\nc3d4e5f6\n071829",
        "6890a1b2\rc3d4e5f6\r071829",
        "6890a1b2\vc3d4e5f6\v071829",
        "6890a1b2\fc3d4e5f6\f071829",
    ],
)
def test_rejects_ids_bson_decodes_shorter_than_it_was_given(value):
    """bson accepts every one of these, so none is redundant with the malformed set above.

    All six appear because the class `bytes.fromhex` skips is every ASCII whitespace character
    rather than the space alone.
    """

    with pytest.raises(ValidationError):
        _ObjectId.model_validate({"value": value})

    with pytest.raises(ValidationError):
        _ObjectId.model_validate_json(json.dumps({"value": value}))


def _admits(schema: dict[str, Any], value: str) -> bool:
    """Whether a string meets a published schema of strings, nulls and patterns, as a generated client would judge it."""

    if "anyOf" in schema:
        return any(_admits(alternative, value) for alternative in schema["anyOf"])

    return schema.get("type") == "string" and re.search(schema.get("pattern", ""), value) is not None
