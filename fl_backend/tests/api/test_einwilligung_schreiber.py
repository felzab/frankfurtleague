from collections.abc import Callable, Iterator, Mapping
from copy import deepcopy
from typing import Any, Final

import bson
import pytest
from pydantic import BaseModel

from app.api.bewerbungen.services import compose_confirmation_update
from app.api.konto.services import compose_selbst_einwilligung_move
from app.api.registrierungen.services import compose_person_update
from app.api.teams.services import compose_kontakte_herkunft
from app.core.config import API_VERSION
from app.core.domain import OPERATION_SEPARATOR, RULES
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


# An existing record's history: a confirmation, then a withdrawal, each to be kept byte for byte by any
# later act on the block.
EARLIER: Final = (
    {
        "am": "2026-03-01T09:00:00+00:00",
        "akt": "bestaetigt",
        "ueber": "POST /registrierungen/bestaetigung",
        "umfang": "kader_oeffentlich",
        "medien": True,
        "text_version": "2026-09-spielerseite-3",
        "erteilt_von": "volljaehrig",
    },
    {
        "am": "2026-03-20T09:00:00+00:00",
        "akt": "widerrufen",
        "ueber": "PATCH /spieler/selbst/einwilligung",
        "umfang": "kader_oeffentlich",
        "medien": False,
        "text_version": "2026-10-konto-spieler",
        "erteilt_von": "volljaehrig",
    },
)
AM: Final = "2026-04-01T10:30:00+00:00"

PERSON_RECORD: Final = {
    "umfang": "kader_oeffentlich",
    "erteilt_von": "volljaehrig",
    "datum": "2026-03-01",
    "bestaetigt_am": "2026-03-01",
    "text_version": "2026-09-spielerseite-3",
    "medien": False,
    "verlauf": list(EARLIER),
}
SEAT_RECORD: Final = {
    "umfang": "kontaktdaten",
    "erfasst_von": "administrativ",
    "text_version": "2026-09-bestaetigung-5",
    "datum": "2026-03-01",
    "bestaetigt_am": None,
    "medien": False,
    "verlauf": [{**EARLIER[0], "akt": "erteilt", "ueber": "POST /bewerbungen", "umfang": "kontaktdaten", "erfasst_von": "administrativ"}],
}
SEAT: Final = {"vorname": "Ida", "nachname": "Musterfrau", "email": "ida@example.com", "telefon": "+4915110000001"}


def _apply(document: Mapping[str, Any], update: Mapping[str, Any]) -> dict[str, Any]:
    """The `$set` and `$push` (with or without `$each`) MongoDB would apply, on dotted paths, and nothing else."""

    applied = deepcopy(dict(document))
    assert set(update) <= {"$set", "$push"}, f"an operator this reading does not apply: {set(update)}"

    def parent_of(path: str) -> tuple[dict[str, Any], str]:
        *steps, leaf = path.split(".")
        node = applied
        for step in steps:
            node = node.setdefault(step, {})
        return node, leaf

    for path, value in update.get("$set", {}).items():
        node, leaf = parent_of(path)
        node[leaf] = deepcopy(value)
    for path, value in update.get("$push", {}).items():
        node, leaf = parent_of(path)
        node.setdefault(leaf, []).extend(deepcopy(value["$each"]) if isinstance(value, Mapping) and "$each" in value else [deepcopy(value)])

    return applied


def _contact_confirmation(record: Mapping[str, Any]) -> tuple[dict[str, Any], Mapping[str, Any], str]:
    stored = {"kontakte": {"trainer": {**SEAT, "einwilligung": dict(record)}}}
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
    return stored, update, "kontakte.trainer.einwilligung"


def _contacts_editor(record: Mapping[str, Any]) -> tuple[dict[str, Any], Mapping[str, Any], str]:
    stored = {
        "kontakte": {
            "trainer": {**SEAT, "einwilligung": dict(record)},
            "ansprechperson": None,
            "stellvertretung": None,
            "trainer_ist_zugleich": None,
        }
    }
    sent = {
        **stored["kontakte"],
        "trainer": {**SEAT, "einwilligung": {"umfang": "kontaktdaten", "text_version": record["text_version"], "datum": "2026-04-01"}},
    }
    # The router's own update: the block is set whole, every kept record carried inside it.
    update = {"$set": {"kontakte": compose_kontakte_herkunft(kontakte=sent, stored=stored["kontakte"], am=AM)}}
    return stored, update, "kontakte.trainer.einwilligung"


def _admission(record: Mapping[str, Any]) -> tuple[dict[str, Any], Mapping[str, Any], str]:
    stored = {"vorname": "Ida", "nachname": "Musterfrau", "einwilligung": dict(record)}
    fresh = {**PERSON_RECORD, "datum": "2026-04-01", "bestaetigt_am": "2026-04-01", "verlauf": [{**EARLIER[0], "am": AM}]}
    registrierung = {"vorname": "Ida", "nachname": "Musterfrau", "geburtsdatum": "2009-05-04", "einwilligung": fresh}
    return stored, compose_person_update(registrierung_raw=registrierung, adresse="ida@example.com"), "einwilligung"


def _account_press(record: Mapping[str, Any]) -> tuple[dict[str, Any], Mapping[str, Any], str]:
    stored = {"einwilligung": dict(record)}
    update = compose_selbst_einwilligung_move(
        bloecke=[("einwilligung", stored["einwilligung"])],
        umfang="intern",
        medien=True,
        ueber="PATCH /spieler/selbst/einwilligung",
        am=AM,
        text_version="2026-10-konto-spieler",
    )
    assert update is not None, "the press moved nothing, so this case proves nothing"
    return stored, update, "einwilligung"


# Every writer of a block that may already exist. The application, the reseat and the pupil's and the
# referee's confirmation only bear one: each runs only where no block stands, so no earlier act is
# theirs to erase.
MOVERS: Final[Mapping[str, tuple[Callable[[Mapping[str, Any]], tuple[dict[str, Any], Mapping[str, Any], str]], Mapping[str, Any]]]] = {
    "POST /bewerbungen/einwilligung": (_contact_confirmation, SEAT_RECORD),
    "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte": (_contacts_editor, SEAT_RECORD),
    "POST /registrierungen/{registrierung_id}/aufnehmen": (_admission, PERSON_RECORD),
    "PATCH /spieler/selbst/einwilligung": (_account_press, PERSON_RECORD),
}


def _at(document: Mapping[str, Any], path: str) -> Any:
    node: Any = document
    for step in path.split("."):
        node = node[step]
    return node


class TestNoWriterErasesAnEarlierAct:
    """`docs/backend/spec.md :: I991` over every writer of an existing block: its earlier entries survive the write byte for byte, first."""

    @pytest.mark.parametrize("writer", sorted(MOVERS))
    def test_the_stored_entries_survive_the_write(self, writer: str):
        """Read off the document the update leaves, so a `$set` of the block whole fails whatever it was given."""

        compose, record = MOVERS[writer]
        stored, update, pfad = compose(record)
        before = _at(stored, pfad)["verlauf"]
        after = _at(_apply(stored, update), pfad)["verlauf"]

        assert bson.encode({"verlauf": after[: len(before)]}) == bson.encode({"verlauf": before}), writer
