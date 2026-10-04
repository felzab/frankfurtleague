import ast
from collections.abc import Callable, Iterator, Mapping
from copy import deepcopy
from pathlib import Path
from typing import Any, Final

import bson
import pytest
from pydantic import BaseModel

from app.api.bewerbungen.services import compose_confirmation_update, compose_kontakt_seat_update, compose_kontakte
from app.api.konto.services import compose_selbst_einwilligung_move
from app.api.registrierungen.services import compose_person_update
from app.api.teams.services import compose_kontakte_at_entry, compose_kontakte_herkunft
from app.core.config import API_VERSION
from app.core.domain import OPERATION_SEPARATOR, RULES
from app.shared.einwilligung_nachweis import NACHWEIS, WAHLEN, ist_erteilt
from tests.core.app_source import api_routes, application

# Every write stamping a consent label, enumerated BY HAND rather than read off the routes: the case
# below holds this list to what the application serves, so a new writer fails by its name until it
# is judged and listed.
LABEL_WRITERS: Final = frozenset(
    {
        "POST /bewerbungen",
        "POST /bewerbungen/einwilligung",
        "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}",
        "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte",
        "POST /registrierungen/bestaetigung",
        "POST /schiedsrichter/bestaetigung",
        "PATCH /spieler/selbst/einwilligung",
        "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung",
        "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung",
    }
)

LABEL_FIELD: Final = "text_version"


def _models_in(annotation: Any) -> Iterator[type[BaseModel]]:
    """Every model one annotation names, through unions, containers and `Annotated` metadata."""

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        yield annotation
        return

    for argument in getattr(annotation, "__args__", ()) or ():
        yield from _models_in(argument)
    for metadata in getattr(annotation, "__metadata__", ()) or ():
        yield from _models_in(metadata)


def _names_a_label(model: type[BaseModel], seen: frozenset[type[BaseModel]] = frozenset()) -> bool:
    """Whether a body of this model carries a label at any depth, a nested seat's record included."""

    if model in seen:
        return False

    return LABEL_FIELD in model.model_fields or any(
        _names_a_label(nested, seen | {model}) for field in model.model_fields.values() for nested in _models_in(field.annotation)
    )


def _served_label_writers() -> set[str]:
    """Each served operation whose request body names a label, keyed as `RULES` spells an operation."""

    prefix = f"/api/v{API_VERSION}"

    return {
        f"{method} {route.path_format.removeprefix(prefix)}"
        for route in api_routes(application())
        for param in route.dependant.body_params
        if any(_names_a_label(model) for model in _models_in(param.field_info.annotation))
        for method in route.methods or ()
    }


def _judged_operations() -> set[str]:
    rule = next(rule for rule in RULES if rule.code == "REQ-EINWILLIGUNG-001")

    return set(rule.operation.split(OPERATION_SEPARATOR))


class TestEveryLabelWriteIsJudged:
    """`docs/backend/spec.md :: I550` on every write: the list above, the served bodies and the rule's operations are one set."""

    def test_the_enumerated_writers_are_every_served_body_naming_a_label(self):
        """Derived from the bodies, never from the rule: a writer the rule forgot is still served, and found here."""

        assert _served_label_writers() == LABEL_WRITERS

    @pytest.mark.parametrize("operation", sorted(LABEL_WRITERS))
    def test_the_writer_is_named_by_the_label_rule(self, operation: str):
        """Named, its handler is traced to the judge by `fl_backend/tests/core/test_rule_publication.py`, and published with the code."""

        assert operation in _judged_operations()


# The instants of a confirmation, a later withdrawal of its media consent, and the write under test.
CONFIRMED_AT: Final = "2026-03-01T09:00:00+00:00"
WITHDRAWN_AT: Final = "2026-03-20T09:00:00+00:00"
AM: Final = "2026-04-01T10:30:00+00:00"

# A pupil's record after a confirmation and a press withdrawing the media consent: both choices
# evidenced, the withdrawal naming the grant it ended.
PERSON_RECORD: Final = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "volljaehrig",
    "datum": "2026-03-01",
    "bestaetigt_am": "2026-03-01",
    "text_version": "2026-09-spielerseite-3",
    "medien": False,
    NACHWEIS: {
        "umfang": {"am": CONFIRMED_AT, "text_version": "2026-09-spielerseite-3"},
        "medien": {
            "am": WITHDRAWN_AT,
            "text_version": "2026-10-konto-spieler",
            "erteilt_zuvor": {"am": CONFIRMED_AT, "text_version": "2026-09-spielerseite-3"},
        },
    },
}
# A seat its applicant named, which nobody has answered yet.
SEAT_RECORD: Final = {
    "umfang": "kontaktdaten",
    "erfasst_von": "administrativ",
    "text_version": "2026-09-bestaetigung-5",
    "datum": "2026-03-01",
    "bestaetigt_am": None,
    "medien": False,
    "eingetragen_von": "bewerbung",
}
# The same seat once its person answered, granting both choices.
ANSWERED_SEAT: Final = {
    **SEAT_RECORD,
    "umfang": "kontaktdaten_whatsapp",
    "erfasst_von": "person",
    "bestaetigt_am": "2026-03-02",
    "medien": True,
    NACHWEIS: {
        "umfang": {"am": CONFIRMED_AT, "text_version": "2026-09-bestaetigung-5"},
        "medien": {"am": CONFIRMED_AT, "text_version": "2026-09-bestaetigung-5"},
    },
}
SEAT: Final = {"vorname": "Ida", "nachname": "Musterfrau", "email": "ida@example.com", "telefon": "+4915110000001"}
OTHER: Final = {"vorname": "Jonas", "nachname": "Beispiel", "email": "jonas@example.com", "telefon": "+4915110000002"}


def _apply(document: Mapping[str, Any], update: Mapping[str, Any]) -> dict[str, Any]:
    """The `$set` MongoDB would apply, on dotted paths, and nothing else."""

    applied = deepcopy(dict(document))
    assert set(update) <= {"$set"}, f"an operator this reading does not apply: {set(update)}"

    for path, value in update.get("$set", {}).items():
        *steps, leaf = path.split(".")
        node = applied
        for step in steps:
            node = node.setdefault(step, {})
        node[leaf] = deepcopy(value)

    return applied


def _at(document: Mapping[str, Any], path: str) -> Any:
    node: Any = document
    for step in path.split("."):
        node = node.get(step) if isinstance(node, Mapping) else None
    return node


# One write: the document it reads, the update it composes, and the block paths it may touch.
Write = tuple[dict[str, Any], Mapping[str, Any], tuple[str, ...]]


def _seats(**slots: Any) -> dict[str, Any]:
    return {"trainer": None, "ansprechperson": None, "stellvertretung": None, "trainer_ist_zugleich": None, **slots}


def _contact_confirmation() -> Write:
    stored = {"kontakte": _seats(trainer={**SEAT, "einwilligung": dict(SEAT_RECORD)})}
    update = compose_confirmation_update(
        kontakte=stored["kontakte"],
        seats=("trainer",),
        geburtsdatum="1984-05-09",
        today="2026-04-01",
        text_version="label",
        whatsapp=True,
        medien=True,
        am=AM,
    )
    return stored, update, ("kontakte.trainer.einwilligung",)


def _account_press() -> Write:
    stored = {"einwilligung": dict(PERSON_RECORD)}
    update = compose_selbst_einwilligung_move(
        bloecke=[("einwilligung", stored["einwilligung"])], umfang="intern", medien=False, am=AM, text_version="2026-10-konto-spieler"
    )
    assert update is not None, "the press moved nothing, so this case proves nothing"
    return stored, update, ("einwilligung",)


def _admission() -> Write:
    """A registration confirmed after the scope's grant and before the media withdrawal: the withdrawal must stand."""

    stored = {"vorname": "Ida", "nachname": "Musterfrau", "einwilligung": dict(PERSON_RECORD)}
    registered_at = "2026-03-10T09:00:00+00:00"
    fresh = {
        **PERSON_RECORD,
        "umfang": "intern",
        "datum": "2026-03-10",
        "bestaetigt_am": "2026-03-10",
        "medien": True,
        NACHWEIS: {
            "umfang": {"am": registered_at, "text_version": "2026-09-spielerseite-3"},
            "medien": {"am": registered_at, "text_version": "2026-09-spielerseite-3"},
        },
    }
    registrierung = {"vorname": "Ida", "nachname": "Musterfrau", "geburtsdatum": "2009-05-04", "einwilligung": fresh}
    update = compose_person_update(registrierung_raw=registrierung, gespeichert=stored["einwilligung"], adresse="ida@example.com")
    assert "einwilligung.umfang" in update["$set"], "the registration renewed no choice, so this case proves nothing"
    return stored, update, ("einwilligung",)


def _submission() -> Write:
    sent = {
        **_seats(
            **{
                seat: {**SEAT, "einwilligung": {"text_version": "2026-09-bewerbung-5"}}
                for seat in ("trainer", "ansprechperson", "stellvertretung")
            }
        )
    }
    return {}, {"$set": {"kontakte": compose_kontakte(kontakte=sent, today="2026-04-01")}}, ("kontakte.trainer.einwilligung",)


def _reseat() -> Write:
    stored = {"kontakte": _seats(ansprechperson={**SEAT, "einwilligung": dict(ANSWERED_SEAT)})}
    update = compose_kontakt_seat_update(
        seats=("ansprechperson",),
        person=dict(OTHER),
        text_version="2026-09-bestaetigung-5",
        token_hash="frisch",
        today="2026-04-01",
        bestaetigungsfrist="2026-04-15",
    )
    return stored, update, ("kontakte.ansprechperson.einwilligung",)


def _contacts_editor() -> Write:
    """One seat kept, answered, and one handed on from an answered person to another."""

    stored = {
        "kontakte": _seats(trainer={**SEAT, "einwilligung": dict(ANSWERED_SEAT)}, ansprechperson={**OTHER, "einwilligung": dict(ANSWERED_SEAT)})
    }
    sent_record = {"umfang": "kontaktdaten", "text_version": "2026-09-bewerbung-5", "datum": "2026-04-01"}
    sent = _seats(
        trainer={**SEAT, "einwilligung": dict(sent_record)},
        ansprechperson={**SEAT, "email": "neu@example.com", "einwilligung": dict(sent_record)},
    )
    # The router's own update: the block is set whole, every kept record carried inside it.
    update = {"$set": {"kontakte": compose_kontakte_herkunft(kontakte=sent, stored=stored["kontakte"])}}
    return stored, update, ("kontakte.trainer.einwilligung", "kontakte.ansprechperson.einwilligung")


def _acceptance() -> Write:
    """An application accepted with one seat answered and one not: the season row takes both."""

    kontakte = _seats(trainer={**SEAT, "einwilligung": dict(ANSWERED_SEAT)}, ansprechperson={**OTHER, "einwilligung": dict(SEAT_RECORD)})
    update = {"$set": {"kontakte": compose_kontakte_at_entry(kontakte=kontakte)}}
    return {"kontakte": kontakte}, update, ("kontakte.trainer.einwilligung", "kontakte.ansprechperson.einwilligung")


# Every function under `fl_backend/app` composing a consent block or moving a choice on one, by its
# lane. Held to the code below, so a new composer fails by name until it is judged here.
PERSON_WRITES: Final[Mapping[str, Callable[[], Write]]] = {
    "app/api/bewerbungen/services.py::compose_confirmation_update": _contact_confirmation,
    "app/api/konto/services.py::compose_selbst_einwilligung_move": _account_press,
    "app/api/registrierungen/services.py::compose_person_update": _admission,
}
ADMIN_WRITES: Final[Mapping[str, Callable[[], Write]]] = {
    "app/api/bewerbungen/services.py::compose_kontakte": _submission,
    "app/api/bewerbungen/services.py::compose_kontakt_seat_update": _reseat,
    "app/api/teams/services.py::compose_kontakte_herkunft": _contacts_editor,
    "app/api/teams/services.py::compose_kontakte_at_entry": _acceptance,
}
# Driven by their own suites, or through a write above: each writes a block born whole from its
# person's own answer, carries one whole, builds a block for a writer above, or only reads.
NOT_DRIVEN_HERE: Final = frozenset(
    {
        # Born whole from the person's own answer, behind a refusal of any second one.
        "app/api/registrierungen/services.py::compose_confirmation_update",
        "app/api/schiedsrichter/services.py::compose_confirmation_update",
        # A new person carries their registration's block whole.
        "app/api/registrierungen/services.py::compose_person",
        # A registration is submitted with no block: its pupil's confirmation writes one.
        "app/api/registrierungen/services.py::compose_registrierung",
        # Builders the writes above call.
        "app/api/bewerbungen/services.py::compose_einwilligung",
        "app/api/schiedsrichter/services.py::compose_einwilligung",
        # Readers: a served body, or the record a seat's person keeps.
        "app/api/konto/services.py::compose_spieler_selbst",
        "app/api/konto/services.py::compose_schiedsrichter_selbst",
        "app/api/konto/services.py::compose_sitze_selbst",
        "app/api/teams/services.py::_confirmation_held_by",
        "app/api/registrierungen/einwilligung_router.py::post_bestaetigung",
        "app/api/registrierungen/einwilligung_router.py::answer_for_the_pupil",
        "app/api/schiedsrichter/person_router.py::patch_einwilligung",
        "app/api/schiedsrichter/person_router.py::write",
        "app/api/spieler/selbst_router.py::patch_einwilligung",
        "app/api/spieler/selbst_router.py::write",
        "app/api/teams/person_router.py::patch_einwilligung",
        "app/api/teams/person_router.py::write",
    }
)

# What marks a function as touching a consent block: a mapping keyed by the block or one of its
# choices, a call stamping evidence, or the provenance an administrative write sets.
_BLOCK_KEYS: Final = frozenset({"einwilligung", *WAHLEN, NACHWEIS})
_STAMPING_CALLS: Final = frozenset({"compose_wahlen", "compose_geboren", "compose_erneuert"})
_HERKUNFT: Final = "UNCONFIRMED_HERKUNFT"
APP: Final = Path(__file__).resolve().parents[2] / "app"


def _touches_a_block(function: ast.AST) -> bool:
    for node in ast.walk(function):
        if isinstance(node, ast.Dict) and any(
            isinstance(key, ast.Constant) and key.value in _BLOCK_KEYS and not (isinstance(value, ast.Constant) and value.value in (0, 1))
            for key, value in zip(node.keys, node.values, strict=True)
        ):
            return True
        if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", None)) in _STAMPING_CALLS:
            return True
        if isinstance(node, ast.Name) and node.id == _HERKUNFT:
            return True
    return False


def _block_composers() -> set[str]:
    """Every function under `app` the markers above find, keyed as the three sets key one. A projection's `1` is no write."""

    found: set[str] = set()
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _touches_a_block(node):
                found.add(f"{path.relative_to(APP.parent).as_posix()}::{node.name}")
    return found


def test_every_composer_of_a_consent_block_is_judged_here():
    assert _block_composers() == set(PERSON_WRITES) | set(ADMIN_WRITES) | NOT_DRIVEN_HERE


def test_the_reader_of_the_composers_finds_a_writer_by_its_markers():
    """The control: a reader finding nothing would pass the case above for an empty classification."""

    assert "app/api/teams/services.py::compose_kontakte_herkunft" in _block_composers()
    assert "app/api/teams/services.py::kontakte_fassungen_genannt" not in _block_composers()


class TestNoAdministrativeWriteSetsAConsentChoice:
    """`docs/backend/spec.md :: I869`: only a person's own write sets a choice of theirs, or stamps its evidence."""

    @pytest.mark.parametrize("writer", sorted(ADMIN_WRITES))
    def test_each_block_it_leaves_grants_nothing_it_did_not_hold_and_carries_no_new_evidence(self, writer: str):
        stored, update, pfade = ADMIN_WRITES[writer]()
        after = _apply(stored, update)

        for pfad in pfade:
            before_block, after_block = _at(stored, pfad) or {}, _at(after, pfad)
            assert isinstance(after_block, Mapping), (writer, pfad)
            for wahl in WAHLEN:
                held = after_block.get(wahl) == before_block.get(wahl) and after_block.get(NACHWEIS) == before_block.get(NACHWEIS)
                assert held or not ist_erteilt(wahl, after_block.get(wahl)), (writer, pfad, wahl)
            assert after_block.get(NACHWEIS) in (None, before_block.get(NACHWEIS)), (writer, pfad)

    def test_a_handed_seat_keeps_nothing_of_the_person_who_left(self):
        """The control: the editor's handed seat held a grant and its evidence, so a write carrying either fails above."""

        stored, update, _ = _contacts_editor()
        handed = _at(_apply(stored, update), "kontakte.ansprechperson.einwilligung")

        assert (handed["medien"], handed.get(NACHWEIS)) == (False, None)


class TestAPersonsWriteKeepsWhatItDoesNotMove:
    """`docs/backend/spec.md :: I991`: every field of the stored block the write does not name survives byte for byte."""

    @pytest.mark.parametrize("writer", sorted(PERSON_WRITES))
    def test_the_fields_it_leaves_survive(self, writer: str):
        """Read off the document the update leaves, so a `$set` of the block whole fails whatever it was given."""

        stored, update, pfade = PERSON_WRITES[writer]()
        after = _apply(stored, update)

        for pfad in pfade:
            assert pfad not in update["$set"], f"{writer} sets the block at {pfad} whole"
            named = {path.removeprefix(f"{pfad}.") for path in update["$set"] if path.startswith(f"{pfad}.")}
            before_block, after_block = _at(stored, pfad), _at(after, pfad)
            kept = {field: value for field, value in before_block.items() if field not in named and field != NACHWEIS}
            kept_evidence = {wahl: beleg for wahl, beleg in (before_block.get(NACHWEIS) or {}).items() if f"{NACHWEIS}.{wahl}" not in named}

            assert bson.encode({field: after_block[field] for field in kept}) == bson.encode(kept), writer
            assert bson.encode({wahl: after_block[NACHWEIS][wahl] for wahl in kept_evidence}) == bson.encode(kept_evidence), writer

    @pytest.mark.parametrize("writer", sorted(PERSON_WRITES))
    def test_each_choice_it_moves_carries_its_evidence_in_the_same_update(self, writer: str):
        stored, update, pfade = PERSON_WRITES[writer]()

        for pfad in pfade:
            for wahl in WAHLEN:
                assert (f"{pfad}.{wahl}" in update["$set"]) == (f"{pfad}.{NACHWEIS}.{wahl}" in update["$set"]), (writer, pfad, wahl)
