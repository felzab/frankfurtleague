import importlib
import inspect
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, Union, get_args, get_origin

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError
from pydantic.fields import FieldInfo

from app.api.saisons.schemas import FLSaison
from app.api.schiedsrichter.schemas import FLSchiedsrichter
from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpiel
from app.api.teams.schemas import FLPatchTeamPayload, FLTeam
from app.main import create_app
from app.shared.schemas.addresses import FLAddressPayload
from tests.config import build_test_config

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Globbed rather than listed, so a slice added later is swept without an edit here.
SCHEMA_PATHS = sorted(BACKEND_ROOT.glob("app/api/*/schemas.py")) + sorted(BACKEND_ROOT.glob("app/shared/schemas/*.py"))

# The key no model declares, used in both directions below.
UNDECLARED_KEY = "erfundenes_feld"

FORBIDDEN = "extra_forbidden"

TEAM_ID = "6890a1b2c3d4e5f607182930"


def _api_routes(router: Any) -> Iterator[APIRoute]:
    """Every endpoint reachable from `router`: FastAPI wraps an included router rather than splicing its endpoints into the parent's list."""

    for route in router.routes:
        included = getattr(route, "original_router", None)
        if included is not None:
            yield from _api_routes(included)
        elif isinstance(route, APIRoute):
            yield route


def _models_in(annotation: Any) -> Iterator[type[BaseModel]]:
    """Every model one annotation names -- through unions, containers, and the metadata a discriminated `Annotated` carries."""

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield annotation
        return

    for argument in getattr(annotation, "__args__", ()) or ():
        yield from _models_in(argument)
    for metadata in getattr(annotation, "__metadata__", ()) or ():
        yield from _models_in(metadata)


def _closure(roots: Iterable[type[BaseModel]]) -> set[type[BaseModel]]:
    """`roots` plus every model nested in one, at any depth. FIELDS only: a base class is reached by `issubclass` instead."""

    found: set[type[BaseModel]] = set()
    pending = list(roots)
    while pending:
        model = pending.pop()
        if model in found:
            continue
        found.add(model)
        pending.extend(nested for field in model.model_fields.values() for nested in _models_in(field.annotation))

    return found


def _declared_models() -> set[type[BaseModel]]:
    """Every model the schema modules declare, the private bases among them -- those publish no OpenAPI component and still carry config."""

    declared: set[type[BaseModel]] = set()
    for path in SCHEMA_PATHS:
        module_name = ".".join(path.relative_to(BACKEND_ROOT).with_suffix("").parts)
        module = importlib.import_module(module_name)
        declared.update(
            model
            for model in vars(module).values()
            if inspect.isclass(model) and issubclass(model, BaseModel) and model.__module__ == module_name
        )

    return declared


def _body_models() -> dict[type[BaseModel], str]:
    """Every model FastAPI parses a REQUEST BODY into, each with one endpoint that declares it.

    Read off the routes rather than off a naming convention, so a body model called something other
    than `...Payload` is swept too.
    """

    bodies: dict[type[BaseModel], str] = {}
    for route in _api_routes(create_app(build_test_config()).router):
        # `methods` is optional on the Starlette base a route inherits from.
        where = f"{min(route.methods or (), default='?')} {route.path}"
        for param in route.dependant.body_params:
            for model in _models_in(param.field_info.annotation):
                bodies.setdefault(model, where)

    return bodies


BODY_MODELS = _body_models()

# Everything a request body reaches, the nested blocks included.
PAYLOAD_SIDE = _closure(BODY_MODELS)

# The bases a payload is composed from. Out of the read side below, and covered anyway: `extra` is
# inherited, so config put on one shows up on every descendant that IS a read.
PAYLOAD_ANCESTORS = {
    ancestor for model in BODY_MODELS for ancestor in model.__mro__ if isinstance(ancestor, type) and issubclass(ancestor, BaseModel)
}

READ_SIDE = _closure(model for model in _declared_models() if model not in PAYLOAD_SIDE and model not in PAYLOAD_ANCESTORS)


def _is_strict(model: type[BaseModel]) -> bool:
    return model.model_config.get("extra") == "forbid"


def _a_read_parses_it(model: type[BaseModel]) -> bool:
    """Whether forbidding on `model` would reach a read: the class itself, or one deriving from it, `extra` being inherited."""

    return model in READ_SIDE or any(issubclass(read, model) for read in READ_SIDE)


def _cases(models: Iterable[type[BaseModel]]) -> list[tuple[str, type[BaseModel]]]:
    return sorted(((model.__name__, model) for model in models), key=lambda pair: pair[0])


BODY_CASES = _cases(BODY_MODELS)
PAYLOAD_SIDE_CASES = _cases(PAYLOAD_SIDE)
READ_SIDE_CASES = _cases(READ_SIDE)

# The blocks a request body reaches that a read parses too -- exactly where the rule below leaves
# `extra` lax, and so exactly where an undeclared key is dropped rather than refused.
LAX_CASES = _cases(model for model in PAYLOAD_SIDE if _a_read_parses_it(model))


def _is_a_string(annotation: Any) -> bool:
    """Whether a length bound on the field counts CHARACTERS -- a `list[str]`'s counts members instead."""

    if get_origin(annotation) is Union:
        return any(_is_a_string(argument) for argument in get_args(annotation))

    return annotation is str


def _floor(field: FieldInfo) -> int | None:
    """Read off the constraint objects, so a floor spelled `Field(min_length=...)` and one inside a `StringConstraints` are both seen."""

    return next((constraint.min_length for constraint in field.metadata if getattr(constraint, "min_length", None) is not None), None)


def _strips(field: FieldInfo) -> bool:
    return any(getattr(constraint, "strip_whitespace", None) for constraint in field.metadata)


# Every string a strict payload takes, inherited fields included: what refuses a body is the model
# the route names, wherever the field was declared.
STRICT_STRINGS = [
    (f"{label}.{name}", field)
    for label, model in PAYLOAD_SIDE_CASES
    if _is_strict(model)
    for name, field in model.model_fields.items()
    if _is_a_string(field.annotation)
]

# The payload strings a value is legitimately ABSENT from rather than blank, so spaces there are no
# more filled-looking than the empty string the field already takes.
OPEN_TO_THE_EMPTY_STRING = frozenset({"stadtteil", "hausnummer", "description"})

# Where one payload REQUIRES a field the set above leaves open. Enumerated by full label, not by
# name, so the exemption reaches the one model that decided it and no sibling inherits it silently.

# A venue can genuinely lack a district and a Frankfurt school cannot, so the public application
# payload floors `stadtteil` where `FLAddressPayload` leaves it open.
FLOORED_BY_DECISION = frozenset({"FLBewerbungAddressPayload.stadtteil"})


# `empty_parameter_set_mark` defaults to skip, so a sweep that matched nothing would pass in silence.
assert BODY_CASES, "no route declares a request body; the app, or the way a body is declared, has moved"
assert READ_SIDE_CASES, "nothing is left on the read side; the split between the two has moved"
assert LAX_CASES, "no payload-side block is lax; the exemption below, and the property holding it safe, no longer have a subject"


@pytest.mark.parametrize("label,model", BODY_CASES, ids=[label for label, _ in BODY_CASES])
def test_a_request_body_refuses_a_key_no_model_declares(label: str, model: type[BaseModel]):
    """Why an ignored key matters is `docs/backend/spec.md :: I49`; the case here is narrower.

    Every model raises its missing required fields too, so what is asserted is that the undeclared
    key is among the reasons and is reported against itself.
    """

    with pytest.raises(ValidationError) as failure:
        model.model_validate({UNDECLARED_KEY: "was auch immer"})

    refusals = {(entry["type"], entry["loc"][-1]) for entry in failure.value.errors() if entry["loc"]}

    assert (FORBIDDEN, UNDECLARED_KEY) in refusals, f"{label} accepted {UNDECLARED_KEY!r} rather than refusing it"


@pytest.mark.parametrize("label,model", PAYLOAD_SIDE_CASES, ids=[label for label, _ in PAYLOAD_SIDE_CASES])
def test_a_model_is_strict_exactly_where_no_read_parses_it(label: str, model: type[BaseModel]):
    """The whole taxonomy as ONE equivalence, rather than two lists somebody has to keep in step.

    Where the line falls, and why a read may not refuse, is `docs/backend/spec.md :: I114`.
    """

    shared = _a_read_parses_it(model)
    wanted = "lax, because a read parses it too" if shared else "strict, because only a request body reaches it"

    assert _is_strict(model) is not shared, f"{label} is {'strict' if _is_strict(model) else 'lax'} where it should be {wanted}"


def test_no_model_a_read_parses_refuses_an_undeclared_key():
    """The half a payload-side edit breaks in silence, `extra` being inherited.

    One assertion over the whole read side rather than a case each: these are the models NOT under
    decision here, so the useful output is the list of any that turned strict.
    """

    strict = [label for label, model in READ_SIDE_CASES if _is_strict(model)]

    assert strict == [], f"{strict} would answer 500 for a stored document carrying a key no model declares"


class TestTheStrictHalf:
    """What a request body now refuses, at the depth the key sits on."""

    def test_a_valid_body_is_refused_solely_for_the_id_the_path_already_names(self, team):
        """Each slice's `mutations.ts` splits the id off before sending; this is what makes that a rule rather than a habit."""

        body = {key: value for key, value in team().items() if key in FLPatchTeamPayload.model_fields}

        assert FLPatchTeamPayload.model_validate(body).shorthand == "CS"

        with pytest.raises(ValidationError) as failure:
            FLPatchTeamPayload.model_validate({**body, "id": TEAM_ID})

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [(FORBIDDEN, "id")]

    def test_an_undeclared_key_inside_a_nested_payload_block_is_refused_too(self):
        """`ort` is reached from a request body and from nothing else, so the venue block is strict to its own depth.

        `name` is the case that matters: the served venue carries one, so a client copying a read
        back into a save is exactly how it would arrive.
        """

        with pytest.raises(ValidationError) as failure:
            FLPatchSpielDataPayload.model_validate({"ort": {"spielort_id": TEAM_ID, "mietpreis": 80, "name": "Sportplatz Ost"}})

        assert any(entry["type"] == FORBIDDEN and entry["loc"][-1] == "name" for entry in failure.value.errors())


class TestTheLaxHalf:
    """One stored document per block a read shares with a payload, each carrying a key no model declares.

    Lax by decision rather than by omission (`docs/backend/spec.md :: I114`).
    """

    def test_every_field_of_a_lax_block_is_required(self):
        """Why the exemption above is not a hole.

        A key misspelled here is dropped and the field it meant left missing, so the body is refused
        anyway. Give `win_points` a default and a mistyped one answers 200, leaving the points
        where they were.
        """

        defaulted = [f"{label}.{name}" for label, model in LAX_CASES for name, field in model.model_fields.items() if not field.is_required()]

        assert defaulted == [], f"{defaulted} carry a default inside a block that forbids nothing, so a key misspelled into one is accepted"

    def test_a_season_whose_rules_carry_an_undeclared_key_still_reads(self, saison):
        stored = saison()
        stored["rules"] = {**stored["rules"], UNDECLARED_KEY: 7}

        assert FLSaison.model_validate(stored).rules.win_points == 3

    def test_a_fixture_whose_side_carries_an_undeclared_key_still_reads(self, spiel, spiel_team_field):
        """The side a payload submits is the BASE of the side a document stores, so strictness on the payload would land here."""

        stored = spiel(team1=spiel_team_field(**{UNDECLARED_KEY: "x"}))

        assert FLSpiel.model_validate(stored).team1 is not None

    def test_a_referee_whose_contact_carries_an_undeclared_key_still_reads(self, schiedsrichter, kontakt):
        stored = schiedsrichter(kontakt=kontakt(**{UNDECLARED_KEY: "x"}))

        assert FLSchiedsrichter.model_validate(stored).kontakt.email is not None

    def test_a_team_whose_austritt_carries_an_undeclared_key_still_reads(self, team):
        austritt = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-14", UNDECLARED_KEY: "x"}

        assert FLTeam.model_validate(team(austritt=austritt)).austritt is not None


class TestAFloorOnAPayloadStringCountsWhatIsLeftAfterTheStrip:
    """A floor counts CHARACTERS, so a field that does not strip first takes spaces alone.

    What is stored then looks filled and is not, and every reader of the field renders it -- a
    club's shorthand is the whole of what a league table names it by.
    """

    def test_the_sweep_reads_strings_on_both_sides_of_the_rule(self):
        """The floor: a sweep seeing no floors, or no open strings, would pass a clause below over nothing."""

        assert [label for label, field in STRICT_STRINGS if _floor(field)], "no strict payload declares a string with a length floor"
        assert [label for label, field in STRICT_STRINGS if not _floor(field)], "no strict payload declares a string without one"

    def test_every_string_carrying_a_floor_is_stripped_before_the_floor_counts_it(self):
        """Drop `strip_whitespace` from any payload string with a floor and this fails, the next one too.

        Never on the read side, where the strip runs first and a stored blank would refuse the
        whole list it appears in (`docs/backend/spec.md :: I36`).
        """

        unstripped = sorted(label for label, field in STRICT_STRINGS if _floor(field) and not _strips(field))

        assert unstripped == [], f"{unstripped} clear their floor on spaces alone"

    def test_the_strings_no_floor_covers_are_the_ones_a_value_is_absent_from(self):
        """Why the clause above reaches every floor and still excuses nothing: these carry none to count.

        Give one a floor and the rule takes it over, which is the answer where a field stops being
        optional.
        """

        floored = sorted(
            label
            for label, field in STRICT_STRINGS
            if label.split(".")[-1] in OPEN_TO_THE_EMPTY_STRING and label not in FLOORED_BY_DECISION and _floor(field)
        )

        assert floored == []

    def test_every_floor_taken_by_decision_is_one_a_payload_really_carries(self):
        """The other direction: an entry left behind would excuse a field that has since gone back to being optional."""

        floored = {label for label, field in STRICT_STRINGS if _floor(field)}

        assert FLOORED_BY_DECISION <= floored, f"{sorted(FLOORED_BY_DECISION - floored)} carry no floor and need no exemption"

    def test_a_payload_still_takes_the_empty_string_where_the_value_is_absent(self, address, team):
        """The behaviour behind the set above, so it is a property of the fields rather than a list somebody wrote."""

        blank = FLAddressPayload.model_validate(address(stadtteil="", hausnummer=""))

        assert (blank.stadtteil, blank.hausnummer) == ("", "")

        body = {key: value for key, value in team(description="").items() if key in FLPatchTeamPayload.model_fields}

        assert FLPatchTeamPayload.model_validate(body).description == ""
