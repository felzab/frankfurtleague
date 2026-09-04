from typing import Any, Mapping, Sequence, get_args

from pydantic import ValidationError

from app.api.teams.schemas import FLPostTeamPayload, FLTrikotFarbe
from app.core.crud import build_sort
from app.core.exceptions import WriteRefusal

# What every code below refuses is `docs/logging/error-codes.md`.
BEWERBUNG_ALREADY_DECIDED = "REQ-BEWERBUNG-001"
BEWERBUNG_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-002"
BEWERBUNG_SCHULE_UNUSABLE = "REQ-BEWERBUNG-003"
BEWERBUNG_FENSTER_GESCHLOSSEN = "REQ-BEWERBUNG-004"
BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED = "REQ-BEWERBUNG-005"
BEWERBUNG_PICKED_CLUB_UNUSABLE = "REQ-BEWERBUNG-006"
BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED = "REQ-BEWERBUNG-007"
BEWERBUNG_SHORTHAND_TAKEN = "REQ-BEWERBUNG-008"

# `bewerbung: null` and no key are both the closed window, never an error (`FLSaison.bewerbung`
# defaults).
_WINDOW_FIELDS = ("offen", "von", "bis")


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


# --- The PUBLIC submission. Every refusal below is judged before the one write, in the order the
# router asks them in.


def recorded_window(*, bewerbung: Any) -> Mapping[str, Any] | None:
    """The window this stored value IS, or `None` where a reader could not subscript it.

    Short of one it is unreadable, so each caller answers its own miss rather than 500ing on the
    subscript.
    """

    if not isinstance(bewerbung, Mapping) or not all(field in bewerbung for field in _WINDOW_FIELDS):
        return None

    return bewerbung


def window_is_running(*, bewerbung: Any, today: str) -> bool:
    """Whether this season takes applications on `today`: `offen`, AND the day inside the span.

    Both ends are compared rather than assuming `von <= bis`: span ordering is enforced on the
    season PAYLOAD alone, so a stored reversal is reachable.
    """

    if recorded_window(bewerbung=bewerbung) is None:
        return False

    return bool(bewerbung["offen"]) and str(bewerbung["von"]) <= today <= str(bewerbung["bis"])


def find_window_refusal(*, bewerbung: Any, today: str) -> WriteRefusal | None:
    """Why this season is taking no application today, or `None`.

    ONE code for all three ways -- no window, the flag off, the day outside the span. Naming which
    would report a season's administrative state to an anonymous visitor.
    """

    if window_is_running(bewerbung=bewerbung, today=today):
        return None

    return WriteRefusal(
        error_code=BEWERBUNG_FENSTER_GESCHLOSSEN,
        message="this season is not accepting applications today; the application window is closed",
    )


def find_submission_subject_refusal(*, team_id: Any | None, schule: Any | None) -> WriteRefusal | None:
    """Why this submission resolves to no single school, or `None`.

    Its OWN code beside `find_acceptance_subject_refusal`, which asks this of a STORED application:
    one code would leave a public refusal and a triage refusal alike in the log.
    """

    if (team_id is None) == (schule is None):
        named = "both an existing club and a new school" if team_id is not None else "neither an existing club nor a new school"
        return WriteRefusal(
            error_code=BEWERBUNG_SUBMISSION_SUBJECT_UNRESOLVED,
            message=f"this submission names {named}; exactly one of the two says which school is applying",
        )

    return None


def find_picked_club_refusal(*, team_raw: Mapping[str, Any] | None) -> WriteRefusal | None:
    """Why the club the applicant picked is not one to apply as, or `None`.

    ONE code for a club that does not exist and one that has left: the picker offers neither, so
    either answer means the same thing -- a client sending an id it was never given.
    """

    if team_raw is None or team_raw.get("inactive_since") is not None:
        return WriteRefusal(
            error_code=BEWERBUNG_PICKED_CLUB_UNUSABLE,
            message=(
                "the club this submission names is not one the league offers; reload the list and pick again, "
                "or propose a new school under a shorthand no club holds"
            ),
        )

    return None


def find_already_entered_refusal(*, entered: bool) -> WriteRefusal | None:
    """Why this club may not apply for this season, or `None`.

    A club already holding the season's junction row is IN it, so an application would ask for
    something already granted. A shared season is not refused: two schools may apply on one day.
    """

    if entered:
        return WriteRefusal(
            error_code=BEWERBUNG_PICKED_CLUB_ALREADY_ENTERED,
            message="this club already plays the season this submission applies for",
        )

    return None


def find_shorthand_refusal(*, taken: bool) -> WriteRefusal | None:
    """Why the proposed Kürzel cannot be the new school's, or `None`.

    Asked here as well as by the availability check, which narrows the collision without preventing
    it: acceptance would otherwise fail on a duplicate key, the school already told it applied.
    """

    if taken:
        return WriteRefusal(
            error_code=BEWERBUNG_SHORTHAND_TAKEN,
            message="the shorthand this submission proposes already belongs to a club; choose another",
        )

    return None


def compose_einwilligung(*, text_version: str, today: str) -> dict[str, Any]:
    """The consent record the server writes.

    `administrativ` on every seat: one person ticked for three, and only a seat's own confirmation
    writes `person`. Named by no client, who could otherwise dress a transcription as a signature.
    """

    return {"umfang": "kontaktdaten", "erteilt_von": "administrativ", "text_version": text_version, "datum": today, "bestaetigt_am": None}


# The three seats, in the order `FLSaisonTeamKontakte` declares them; nothing reads one by position.
KONTAKT_SEATS = ("trainer", "ansprechperson", "stellvertretung")


def compose_kontakte(*, kontakte: Mapping[str, Any], today: str) -> dict[str, Any]:
    """The three people as `saison_teams` stores them, each consent recomposed here.

    Taken as the DUMPED payload rather than the model: this module composes documents, and every
    other function here takes one.
    """

    composed: dict[str, Any] = {
        seat: {
            **{field: value for field, value in kontakte[seat].items() if field != "einwilligung"},
            # Written null rather than left off, as `wunschgegner` is: the key marks a date not yet
            # entered, and the confirmation fills it (`docs/backend/spec.md :: I141`).
            "geburtsdatum": None,
            "einwilligung": compose_einwilligung(text_version=kontakte[seat]["einwilligung"]["text_version"], today=today),
        }
        for seat in KONTAKT_SEATS
    }
    composed["trainer_ist_zugleich"] = kontakte["trainer_ist_zugleich"]

    return composed


def assigned_trikot_farben(*, stored: Sequence[Any]) -> list[FLTrikotFarbe]:
    """The season's assigned colours, in the palette's own order.

    The RETURN filters through the palette rather than sorting `held` by it: a row assigned nothing
    yields a null, and one predating the enum a value the model cannot serve.
    """

    # `set(stored)` is the shorthand this refuses: an unhashable BSON value would raise there, where
    # this drops it. `app/core/constraints.py :: saison_teams.trikot_farbe` forbids one, so this holds
    # the boundary rather than a case any test can reach.
    held = {value for value in stored if isinstance(value, str)}

    # The form excludes what this returns, and a season may field at least as many teams as the palette
    # has colours. `fl_frontend/src/features/teams/utils.ts :: offeredTrikotFarben` then hands the whole
    # palette back once every colour is assigned.
    return [farbe for farbe in get_args(FLTrikotFarbe) if farbe in held]


def build_bewerbungen_sort(*, sort_by: str, order: str) -> list[tuple[str, int]]:
    """The triage queue's order, tie-broken by `_id`.

    Named rather than inline so the index test can assert on what the endpoint actually sends
    (`fl_backend/tests/core/test_constraints_execution.py`).
    """

    # `_id` breaks the tie in `order`'s OWN direction, so same-day rows read the way the queue does
    # and the pair is the index's key or its exact inverse. Pinned descending, `order=asc` would
    # match neither and scan the whole archive.
    direction = 1 if order == "asc" else -1

    return build_sort(sort_by=sort_by, order=order, chain=(("_id", direction),))
