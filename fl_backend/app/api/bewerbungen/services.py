from typing import Any, Mapping

from pydantic import ValidationError

from app.api.teams.schemas import FLPostTeamPayload
from app.core.exceptions import WriteRefusal

# What every code below refuses is `docs/logging/error-codes.md`.
BEWERBUNG_ALREADY_DECIDED = "REQ-BEWERBUNG-001"
BEWERBUNG_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-002"
BEWERBUNG_SCHULE_UNUSABLE = "REQ-BEWERBUNG-003"


def find_triage_refusal(*, status: str) -> WriteRefusal | None:
    """Why this application may no longer be decided, or `None`.

    ONE code for both endpoints: which of the two arrived second is nothing an administrator can act
    on differently. Without it a second press re-enters the club, failing on a duplicate key.
    """

    if status != "eingereicht":
        return WriteRefusal(
            error_code=BEWERBUNG_ALREADY_DECIDED,
            message=f"this application is already {status}; a decision is taken once, and the record of it stands",
        )

    return None


def find_acceptance_subject_refusal(*, team_id: Any | None, schule: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why this application resolves to no single club to enter, or `None`.

    While it is `eingereicht`, EXACTLY one of the two carries a value -- a rule the write path holds
    because types and enums cannot state it (`docs/backend/spec.md :: I16`).
    """

    if (team_id is None) == (schule is None):
        named = "both an existing club and a new school" if team_id is not None else "neither an existing club nor a new school"
        return WriteRefusal(
            error_code=BEWERBUNG_SUBJECT_UNRESOLVED,
            message=f"this application names {named}; exactly one of the two says what acceptance would enter into the season",
        )

    return None


# The school's field names in the club's. `team_name` becomes the club's `name`; the other five are
# spelled alike on both sides, and `description` is on neither.
_CLUB_FIELDS_FROM_SCHULE = {
    "team_name": "name",
    "full_name": "full_name",
    "shorthand": "shorthand",
    "schulform": "schulform",
    "address": "address",
    "website_url": "website_url",
}


def compose_new_club(*, schule: Any) -> dict[str, Any]:
    """The club document acceptance would create, from the school's block AS STORED.

    Raw so `find_new_club_refusal` judges every field: a `str()` here makes a club named `'None'`
    from a null with no undo, and a subscript 500s where the rule promises 409.
    """

    fields = schule if isinstance(schule, Mapping) else {}

    return {
        # Empty rather than composed from the application: `description` is the club's own public
        # blurb, and a sentence the league wrote would stand on the team page as though the school
        # had written it.
        "description": "",
        # A key the block has not got is left OUT rather than defaulted, so the guard names it
        # "Field required" rather than judging a null nobody submitted.
        **{club_field: fields[schule_field] for schule_field, club_field in _CLUB_FIELDS_FROM_SCHULE.items() if schule_field in fields},
    }


def parse_new_club(*, club_document: Mapping[str, Any]) -> dict[str, Any]:
    """The club document AS STORED, from one the guard has already passed.

    Parsed, not composed: `website_url`'s validator strips tab, return and newline, so the raw
    block leaves `teams` holding what `POST /teams` never stores for the same school.
    """

    return FLPostTeamPayload.model_validate(club_document).model_dump(mode="json")


def find_new_club_refusal(*, club_document: Mapping[str, Any]) -> WriteRefusal | None:
    """Why the school's details make no club, or `None`.

    Through the payload itself, never a copy: the validator only types them
    (`docs/backend/spec.md :: I16`), so a scheme-less `website_url` reaches storage, and `FLTeam`
    500s every club read.
    """

    try:
        FLPostTeamPayload.model_validate(club_document)
    # NARROW on purpose: anything else raised here is a fault in this code, and a 409 blaming the
    # school for one is a refusal nobody can act on.
    except ValidationError as unusable_school:
        first = unusable_school.errors()[0]
        # The field PATH and the reason, never a submitted value -- this block holds a real school's
        # address (`docs/logging/spec.md :: L9`). `compose_new_club` keys the document by the payload's
        # own field names, so the path is one of those and nothing typed.
        field = ".".join(str(part) for part in first["loc"]) or "schule"

        return WriteRefusal(
            error_code=BEWERBUNG_SCHULE_UNUSABLE,
            message=f"this school's {field} is not one a club can be created from: {first['msg']}",
        )

    return None
