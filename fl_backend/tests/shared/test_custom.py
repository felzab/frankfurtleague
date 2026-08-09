"""
SHARED · the custom string types

The date test is the one that matters: `DATE_REGEX` alone accepts 2026-02-31, because a regex
cannot know how many days a month has, so a real calendar check sits behind it.
"""

import pytest
from pydantic import BaseModel, ValidationError

from app.shared.schemas.custom import CustomDateString, CustomExternalUrl, CustomObjectId, CustomTimeString


class _Date(BaseModel):
    value: CustomDateString


class _Time(BaseModel):
    value: CustomTimeString


class _Url(BaseModel):
    value: CustomExternalUrl


class _ObjectId(BaseModel):
    value: CustomObjectId


@pytest.mark.parametrize("value", ["2026-01-01", "2026-12-31", "2024-02-29", "2026-02-28"])
def test_accepts_real_calendar_dates(value):
    """Ordinary dates plus a real leap day, 2024-02-29 — the positive side of the calendar check."""
    assert _Date.model_validate({"value": value}).value == value


@pytest.mark.parametrize("value", ["2026-02-31", "2026-04-31", "2026-02-30", "2025-02-29"])
def test_rejects_dates_that_pass_the_regex_but_do_not_exist(value):
    """The point of the whole module: shapes DATE_REGEX allows but the calendar does not, including 2025-02-29."""
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


@pytest.mark.parametrize("value", ["2026-1-1", "26-01-01", "2026/01/01", "2026-13-01", "", "today"])
def test_rejects_malformed_dates(value):
    """Wrong padding, wrong separator, wrong order, out-of-range month, and empty."""
    with pytest.raises(ValidationError):
        _Date.model_validate({"value": value})


@pytest.mark.parametrize("value", ["00:00:00", "09:05:00", "23:59:59"])
def test_accepts_times_with_seconds(value):
    """Midnight, a single-digit hour zero-padded, and the last second of the day."""
    assert _Time.model_validate({"value": value}).value == value


# The backend accepts none of these, and the frontend schema must not accept them either: a form
# that submits a time this rejects produces a 422 the user cannot act on. This pins the backend half
# of that contract, so the mirror has something to be checked against.
@pytest.mark.parametrize("value", ["14:30", "14:30:00.5", "24:00:00", "14:60:00", "2:30:00"])
def test_rejects_times_without_seconds_or_out_of_range(value):
    """Missing seconds and fractional seconds — the two shapes the frontend used to send and the API answered with 422."""
    with pytest.raises(ValidationError):
        _Time.model_validate({"value": value})


@pytest.mark.parametrize(
    "value",
    [
        "https://example.com",
        "http://example.com/path",
        "https://sub.example.co.uk",
        "https://example.com:8443/x",
        "https://user@example.com",
        # Accepted because zod reads the scheme off a parsed URL, which lowercases it. The previous
        # regex was case-sensitive and rejected this -- a disagreement between the two ends.
        "HTTPS://EXAMPLE.COM",
    ],
)
def test_accepts_http_and_https_urls(value):
    """Both schemes, plus port, userinfo and an uppercase scheme — which a case-sensitive regex once rejected."""
    assert _Url.model_validate({"value": value}).value == value


# The scheme allowlist is a security control, not tidiness: website_url is rendered into an href on
# a public page, and React renders javascript: without complaint (audit R3b S8.1).
#
# The last four are the cases the previous regex-only check got wrong. The two embedding a valid URL
# are the important ones: that regex was anchored only at the start, so its leading "^" carried the
# entire scheme restriction on its own -- every other rejection case here passed even with the "^"
# deleted, which meant nothing defended the control that actually mattered.
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
        # `new URL` throws on an invalid port, so the frontend rejects this; without touching
        # urlsplit's lazy `.port` the backend would have accepted it.
        "https://example.com:notaport/",
        # Valid-looking but undecodable punycode. Passes DOMAIN_REGEX (ASCII letters, digits and
        # hyphens only) yet `new URL` rejects it, so the round-trip check is what keeps the two ends
        # in agreement.
        "https://xn--kthe-kollwitz-schule-5nb.de",
        "https://",
        "//example.com",
    ],
)
def test_rejects_non_http_schemes_and_bare_hosts(value):
    """The security case: javascript:, data: and vbscript:, plus hosts a start-anchored regex wrongly accepted."""
    with pytest.raises(ValidationError):
        _Url.model_validate({"value": value})


# The frontend accepts these because `new URL` punycodes the host before zod tests it. urlsplit does
# not, so without encoding first an ordinary German umlaut domain would be rejected here -- on the
# READ path, taking down every route that lists teams. A narrower rule than the regex it replaced.
@pytest.mark.parametrize(
    "value",
    [
        "https://käthe-kollwitz-schule.de",
        "https://schule-für-alle.de",
        "https://xn--kthe-kollwitz-schule-bzb.de",
    ],
)
def test_accepts_internationalised_domains(value):
    """Umlaut domains in both unicode and punycode form — rejecting these would break every team listing."""
    assert _Url.model_validate({"value": value}).value == value


# Serialises back to the 24-hex string the frontend's CustomObjectIdStringSchema expects.
def test_object_id_round_trips_as_a_24_hex_string():
    """Serialises back to the 24-hex string the frontend's CustomObjectIdStringSchema expects."""
    parsed = _ObjectId.model_validate({"value": "6890a1b2c3d4e5f607182930"})
    assert str(parsed.value) == "6890a1b2c3d4e5f607182930"


@pytest.mark.parametrize("value", ["not-an-objectid", "6890a1b2c3d4e5f60718293", ""])
def test_rejects_malformed_object_ids(value):
    """Non-hex, one character short, and empty."""
    with pytest.raises(ValidationError):
        _ObjectId.model_validate({"value": value})
