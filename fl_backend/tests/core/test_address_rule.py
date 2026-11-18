"""
CORE · every address the application mounts is built by one rule, `docs/backend/overview.md`'s "Addresses"

The slice, then each record the call is about by its id after its collection's name, the season last of them, then
the act; `self` in the place of the signed-in person's own record's id; and `/admin` closing an address only where
another tier answers the same method at the address without it. Read off the mounted routes rather than the
published document, whose paths are keys: two routes on one address would reach it as one.
"""

import re
from collections.abc import Mapping
from typing import Final

from tests.core.app_source import api_routes, application

PREFIX: Final = "/api/"

# Each path parameter, and the collection whose name stands before it. A parameter missing here fails the case below
# rather than passing unread, so a new kind of record is placed by hand once.
COLLECTION_OF: Final[Mapping[str, str]] = {
    "address_change_id": "address_change",
    "ban_list_entry_id": "ban_list",
    "bewerbung_id": "bewerbungen",
    "grant_id": "grants",
    "registrierung_id": "registrierungen",
    "saison_id": "saisons",
    "schiedsrichter_id": "schiedsrichter",
    "seat": "kontakte",
    "spiel_id": "spiele",
    "spielbestaetigung_id": "spielbestaetigungen",
    "spieler_id": "spieler",
    "spielort_id": "spielorte",
    "spieltag_id": "spieltage",
    "team_id": "teams",
}

# Parameters naming a part of a season's row rather than a record, which follow the season.
PARTS_OF_A_SEASON_ROW: Final = frozenset({"seat"})

PARAMETER = re.compile(r"\{([^}:]+)(?::[^}]+)?\}")

# The ending that marks the administration's address, and the word standing for the signed-in person's own record.
ADMIN: Final = "admin"
SELF: Final = "self"


def _segments(path: str) -> tuple[str, ...]:
    assert path.startswith(PREFIX), path

    return tuple(PARAMETER.sub(r"{\1}", path.removeprefix(PREFIX)).split("/"))


def _parameter(segment: str) -> str | None:
    return segment[1:-1] if segment.startswith("{") else None


# Every operation as (method, its address's segments, its slice).
OPERATIONS: Final = [
    (method, _segments(route.path), route.tags[0]) for route in api_routes(application()) for method in sorted(route.methods or ())
]

SERVED: Final = {(method, segments) for method, segments, _ in OPERATIONS}


def _named(method: str, segments: tuple[str, ...]) -> str:
    return f"{method} /{'/'.join(segments)}"


def test_every_address_opens_with_its_slice():
    assert [_named(method, segments) for method, segments, slice_ in OPERATIONS if segments[0] != slice_] == []


def test_every_id_stands_after_the_name_of_its_collection():
    """The slice names its own records, so their id follows it directly; any other id follows its collection's name."""

    misplaced = []
    for method, segments, _ in OPERATIONS:
        for place, segment in enumerate(segments):
            parameter = _parameter(segment)
            if parameter is not None and segments[place - 1] != COLLECTION_OF.get(parameter):
                misplaced.append(f"{_named(method, segments)}: {{{parameter}}} after {segments[place - 1]!r}")

    assert misplaced == []


def test_the_season_is_the_last_record_an_address_names():
    """Unless it is the saisons slice's own record, which stands first as every slice's own does.

    A part of the season's row, such as a contact seat, follows the season it belongs to.
    """

    late = []
    for method, segments, _ in OPERATIONS:
        season = segments.index("{saison_id}") if "{saison_id}" in segments else None
        if season is None or season == 1:
            continue
        after = {_parameter(segment) for segment in segments[season + 1 :]} - {None}
        if after - PARTS_OF_A_SEASON_ROW:
            late.append(_named(method, segments))

    assert late == []


def test_self_stands_only_in_the_place_of_the_slices_own_record():
    assert [_named(method, segments) for method, segments, _ in OPERATIONS if SELF in segments[2:]] == []


def test_admin_closes_only_an_address_another_tier_answers_without_it():
    """A tier marked where no other answers is a second spelling of the address for one reader."""

    marked = []
    for method, segments, _ in OPERATIONS:
        if ADMIN in segments[:-1] or (segments[-1] == ADMIN and (method, segments[:-1]) not in SERVED):
            marked.append(_named(method, segments))

    assert marked == []
