import json
from typing import Annotated

import pytest
from bson import ObjectId
from pydantic import BaseModel, StringConstraints, ValidationError

from app.shared.schemas.custom import PHONE_REGEX, CustomDateString, CustomExternalUrl, CustomObjectId, CustomTimeString


class _Date(BaseModel):
    value: CustomDateString


class _Time(BaseModel):
    value: CustomTimeString


class _Url(BaseModel):
    value: CustomExternalUrl


class _ObjectId(BaseModel):
    value: CustomObjectId


# The REQUIRED declaration `fl_backend/app/api/teams/schemas.py :: _KontaktpersonWritablePayload`
# carries, rather than `CustomOptionalPhoneString`, whose `parse_empty_string_to_none` answers spaces
# alone with `None` before the pattern is reached.
class _Phone(BaseModel):
    value: Annotated[str, StringConstraints(pattern=PHONE_REGEX)]


@pytest.mark.parametrize(
    "value",
    [
        "2026-12-31",
        "2024-02-29",
        "2026-02-28",
        # The only case reaching `DATE_REGEX`'s single-digit day arm, and its only month `01`:
        # narrowing either leaves every other value here passing.
        "2026-01-01",
    ],
)
def test_accepts_real_calendar_dates(value):
    """`2024-02-29` is load-bearing: a real leap day the calendar check must accept."""
    assert _Date.model_validate({"value": value}).value == value


@pytest.mark.parametrize("value", ["2026-02-31", "2026-04-31", "2025-02-29"])
def test_rejects_dates_that_pass_the_regex_but_do_not_exist(value):
    """`2025-02-29` is load-bearing: `DATE_REGEX` cannot tell a leap year from an ordinary one."""
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


@pytest.mark.parametrize("value", ["2026-1-1", "26-01-01", "2026/01/01", "2026-13-01", "", "today"])
def test_rejects_malformed_dates(value):
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


@pytest.mark.parametrize("value", ["00:00:00", "09:05:00", "23:59:59"])
def test_accepts_times_with_seconds(value):
    assert _Time.model_validate({"value": value}).value == value


# The frontend mirror must reject these identically, or a form produces a 422 the user cannot act on.
@pytest.mark.parametrize("value", ["14:30", "14:30:00.5", "24:00:00", "14:60:00", "2:30:00"])
def test_rejects_times_without_seconds_or_out_of_range(value):
    with pytest.raises(ValidationError):
        _Time.model_validate({"value": value})


@pytest.mark.parametrize(
    "value",
    [
        "https://example.com",
        "http://example.com/path",
        "https://sub.example.co.uk",
        "https://example.com:8443/x",
        "https://example.com/a@b",
        "https://example.com/?q=a@b",
        # zod reads the scheme off a parsed URL, which lowercases it, so a case-sensitive check here
        # would disagree with the frontend.
        "HTTPS://EXAMPLE.COM",
    ],
)
def test_accepts_http_and_https_urls(value):
    assert _Url.model_validate({"value": value}).value == value


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


def test_normalises_nothing_beyond_those_three_characters():
    """Not `geturl()`: reassembling lowercases the scheme, rewriting a stored value on a read model — why `AnyHttpUrl` is refused too."""
    for value in ("HTTPS://EXAMPLE.COM", "https://example.com/PaTh", "https://example.com:8443/x?a=b#c"):
        assert _Url.model_validate({"value": value}).value == value


# `new URL` punycodes the host and `urlsplit` does not, so the host is encoded first. A read path:
# rejecting one takes down every route that lists teams.
@pytest.mark.parametrize(
    "value",
    [
        "https://käthe-kollwitz-schule.de",
        "https://schule-für-alle.de",
        "https://xn--kthe-kollwitz-schule-bzb.de",
    ],
)
def test_accepts_internationalised_domains(value):
    assert _Url.model_validate({"value": value}).value == value


def test_object_id_round_trips_as_a_24_hex_string():
    parsed = _ObjectId.model_validate({"value": "6890a1b2c3d4e5f607182930"})
    assert str(parsed.value) == "6890a1b2c3d4e5f607182930"

    # The `isinstance` is the assertion: a json branch declaring only a string leaves `value` a `str`,
    # and every comparison against a stored `_id` silently misses.
    from_json = _ObjectId.model_validate_json('{"value": "6890a1b2c3d4e5f607182930"}')
    assert isinstance(from_json.value, ObjectId)
    assert from_json.value == parsed.value


@pytest.mark.parametrize("value", ["not-an-objectid", "6890a1b2c3d4e5f60718293", "zzzzzzzzzzzzzzzzzzzzzzzz", ""])
def test_rejects_malformed_object_ids(value):
    with pytest.raises(ValidationError):
        _ObjectId.model_validate({"value": value})

    # Nothing routed reaches the json mode — FastAPI hands validation a parsed dict — so the
    # guarantee is the type's rather than the framework's.
    with pytest.raises(ValidationError):
        _ObjectId.model_validate_json(json.dumps({"value": value}))


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


def test_accepts_an_upper_case_id_and_serialises_it_lower_case():
    """Guards the fold: a round-trip compared exactly would refuse this, and the lower-casing is not the defect."""

    parsed = _ObjectId.model_validate({"value": "6890A1B2C3D4E5F607182930"})
    assert str(parsed.value) == "6890a1b2c3d4e5f607182930"


# Taken from the tree's own fixtures, because refusing one of these turns a school away over how it
# writes the one number the league reaches it on.
@pytest.mark.parametrize(
    "value",
    [
        "+49 (0) 69 1234-567",
        "069 1234567",
        "+49 (0)170 1234567",
        "0049-170-1234567",
        "(0170) 123 45 67",
        "069.123.4567",
        "+4915112345678",
        "030 123",
    ],
)
def test_accepts_every_german_spelling_the_tree_uses(value):
    assert _Phone.model_validate({"value": value}).value == value


# Refused rather than coerced: the required field stores what it is handed and the club page renders
# it, so a value with no digit in it is a number given to whoever tries to ring the school.
@pytest.mark.parametrize("value", ["   ", "().", "---", "(  )"])
def test_rejects_a_phone_number_carrying_no_digit(value):
    with pytest.raises(ValidationError):
        _Phone.model_validate({"value": value})


# How the rule above is reached: every accepted value ends in a digit, no floor over the digit count
# fitting a pattern that carries its own ceiling as well.
@pytest.mark.parametrize("value", ["(069)", "069 ", "069-"])
def test_rejects_a_phone_number_trailing_off_into_a_space_or_punctuation(value):
    with pytest.raises(ValidationError):
        _Phone.model_validate({"value": value})


# Both edges, because the trailing digit sits outside the class: taking it out of the run has to
# leave the window where it was, and no length bound stands beside the pattern to catch a slip.
@pytest.mark.parametrize(
    ("value", "accepted"),
    [("0" * 3, True), ("0" * 20, True), ("0" * 2, False), ("0" * 21, False)],
    ids=["at the floor", "at the ceiling", "one under the floor", "one over the ceiling"],
)
def test_keeps_both_edges_of_the_length_window(value, accepted):
    if accepted:
        assert _Phone.model_validate({"value": value}).value == value
    else:
        with pytest.raises(ValidationError):
            _Phone.model_validate({"value": value})
