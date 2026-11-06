import copy
from typing import Any

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.api.saisons.schemas import FLPatchSaisonPayload
from app.api.schiedsrichter.schemas import FLPostSchiedsrichterPayload
from app.api.spieler.schemas import (
    FLEinwilligung,
    FLPatchKaderRowPayload,
    FLPatchSpielerSaisonPayload,
    FLSaisonSpielerRow,
    FLSpielerRecord,
)
from app.api.spieler.services import build_ghost_spieler
from app.api.spielorte.schemas import FLPostSpielortPayload
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLSpieltag
from app.api.teams.schemas import (
    FLAustrittPayload,
    FLKontaktpersonPayload,
    FLPostTeamPayload,
)
from app.shared.schemas.bounds import SAISON_ID_LENGTH
from tests.documents import spieler_document


class TestSpieler:
    # Nullable is not open: a missing answer is null, a value outside the set is unstorable.
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            # Two spellings of one position — the split the closed set removes.
            ("position", "Sturm"),
            ("position", "TW"),
            # A placeholder somebody typed where null already meant the same thing.
            ("position", "?"),
            ("stufe", "??"),
            # Outside the Oberstufe, which is where the set stops.
            ("stufe", "10"),
        ],
    )
    def test_rejects_a_position_or_stufe_outside_its_closed_set(self, field, value):
        with pytest.raises(ValidationError):
            FLPatchKaderRowPayload.model_validate({"nummer": None, "position": None, "stufe": None, "rolle": None, field: value})

    def test_accepts_the_stufe_no_row_holds_yet(self):
        """`E2` is offered although the current season has nobody in it — the phases run in sequence."""
        row = FLPatchKaderRowPayload.model_validate({"nummer": None, "position": None, "stufe": "E2", "rolle": None})

        assert row.stufe == "E2"

    @pytest.mark.parametrize("field", ["first_name", "birth_date", "einwilligung"])
    def test_the_record_refuses_a_person_stored_as_nobody(self, field):
        """No write stores such a person, so the read-back is the one place a hand edit blanking one shows."""

        with pytest.raises(ValidationError):
            FLSpielerRecord.model_validate(spieler_document(ObjectId(), **{"first_name": "Max", "last_name": "Mustermann", field: None}))

    def test_the_record_refuses_the_sentinel_holding_an_address(self):
        """No lookup by address excludes the sentinel, so the read-back is where one given an address shows."""

        with pytest.raises(ValidationError):
            FLSpielerRecord.model_validate({**build_ghost_spieler(), "email": "geist@schule.example"})

    @pytest.mark.parametrize("absent", [True, False], ids=["absent", "null"])
    def test_the_person_patch_requires_a_birthdate(self, absent: bool):
        """No default and no null, so neither a form that forgot the field nor a cleared picker clears a stored date."""

        names = {"first_name": "Max", "last_name": "Mustermann", "nummer": None, "position": None, "stufe": None, "rolle": None, "version": 0}

        with pytest.raises(ValidationError):
            FLPatchSpielerSaisonPayload.model_validate(names if absent else {**names, "birth_date": None})


class TestEinwilligung:
    """The consent record: what may be published, and whether anyone confirmed it."""

    @pytest.mark.parametrize("field", ["scope", "date", "confirmed_at", "media", "evidence"])
    def test_requires_every_key(self, einwilligung, field, assert_rejects):
        """Each key a stored record carries, so a model accepting one fewer would let the read-back pass a row missing it."""

        incomplete = einwilligung()
        del incomplete[field]

        assert_rejects(FLEinwilligung, incomplete, field)

    def test_the_patch_payload_carries_no_consent_field(self):
        """`patch_spieler_saison` `$set`s this model's fields, so a field here would let a name correction rewrite what somebody agreed to."""

        assert "einwilligung" not in FLPatchSpielerSaisonPayload.model_fields


class TestSaisonSpielerRow:
    """`saison_spieler`'s declared shape. It validates no stored document — see the class docstring for why it may not."""

    def test_a_number_is_a_string_and_not_an_int(self, saison_spieler):
        """Squad numbers are worn, not counted: `07` and `7` are different shirts, and an int erases the distinction."""

        assert FLSaisonSpielerRow.model_validate(saison_spieler(nummer="07")).nummer == "07"

        with pytest.raises(ValidationError):
            FLSaisonSpielerRow.model_validate(saison_spieler(nummer=7))


class TestSpieltag:
    def test_carries_no_name(self):
        """A stored name restates a composed fact with nothing holding the two consistent."""

        assert "name" not in FLSpieltag.model_fields

    def test_carries_its_stored_position(self, spieltag):
        assert FLSpieltag.model_validate(spieltag(position=3)).position == 3


class TestTheMatchdaysSpan:
    """`refuse_reversed_span` under the matchday payload, which names the span by its kind."""

    def test_refuses_a_matchday_ending_before_it_begins(self):
        with pytest.raises(ValidationError) as failure:
            FLPatchSpieltagPayload.model_validate({"start": "2026-09-05", "end": "2026-09-04", "version": 0})

        # At the end it judges, as the wire's path names it: a refusal at the model's own path reaches no box.
        assert [(error["type"], error["loc"], error.get("ctx")) for error in failure.value.errors()] == [
            ("spieltag_ends_before_start", ("end",), {"start": "2026-09-05"})
        ]


class TestTheSeasonsSpans:
    """`refuse_reversed_span` under every caller, each naming its span by a kind of its own."""

    @staticmethod
    def payload(saison, **overrides: Any) -> dict[str, Any]:
        """The stored season narrowed to the payload's keys: `extra="forbid"` refuses `_id`, `status` and `schedule`."""

        stored = saison()

        return {
            "start_date": stored["start_date"],
            "end_date": stored["end_date"],
            "rules": stored["rules"],
            "bewerbung": {"open": True, "start": "2025-09-01", "end": "2025-10-31"},
            "registrierung": {"open": True, "end": "2025-12-15"},
            "version": 0,
            **overrides,
        }

    @pytest.mark.parametrize(
        ("overrides", "refused"),
        [
            pytest.param(
                {"start_date": "2026-06-30", "end_date": "2026-01-01"},
                ("saison_ends_before_start", ("end_date",), {"start": "2026-06-30"}),
                id="the season's end",
            ),
            pytest.param(
                {"bewerbung": {"open": True, "start": "2025-10-31", "end": "2025-09-01"}},
                ("bewerbung_window_ends_before_start", ("bewerbung", "end"), {"start": "2025-10-31"}),
                id="the application window's end",
            ),
            pytest.param(
                {"registrierung": {"open": True, "end": "2026-01-01"}},
                ("registrierung_window_reaches_saison_start", ("registrierung", "end"), {"latest": "2025-12-31"}),
                id="the registration window's end",
            ),
        ],
    )
    def test_refuses_each_span_at_its_end_with_its_kind_and_bound(self, saison, overrides, refused):
        """Each rule sits at the end it judges: one raised at the model's own path reaches the wire naming no box, and no form shows it.

        The wire's `path` is this `loc`, `app/core/exception_handlers.py :: _refused_field` dropping only FastAPI's `body`.
        """
        assert saison()["start_date"] == "2026-01-01"

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonPayload.model_validate(self.payload(saison, **overrides))

        assert [(error["type"], error["loc"], error.get("ctx")) for error in failure.value.errors()] == [refused]


class TestTheSeasonsWindowsAreRequiredWithNoDefault:
    """Parametrised over both windows: a default added to either would leave the other's case green."""

    @pytest.mark.parametrize("field", ["bewerbung", "registrierung"])
    def test_a_payload_omitting_a_window_is_refused_rather_than_closing_it(self, saison, field, assert_rejects):
        body = {key: value for key, value in TestTheSeasonsSpans.payload(saison).items() if key != field}

        assert_rejects(FLPatchSaisonPayload, body, field)


# Every payload field carrying a length floor, by the path that reaches it. `min_length` counts
# CHARACTERS and does not strip, so each needs `strip_whitespace` in front of its floor or spaces
# alone pass as a value stored, served and rendered as empty.
STRIPPED_WRITE_FIELDS = [
    "spielort.address.stadt",
    "spielort.address.strasse",
    "spielort.name",
    "schiedsrichter.name",
    "spieler_patch.last_name",
    "spieler_patch.first_name",
    "team.full_name",
    "team.name",
    "team.shorthand",
    "kontaktperson.last_name",
    "kontaktperson.first_name",
    "saison_team.austritt.reason",
]

# A run of spaces at every width up to the widest floor the table carries. An exact-width field is
# refused at any OTHER width by its ceiling, so one probe would pass it for a reason of its own.
WHITESPACE_RUNS = [" " * width for width in range(1, SAISON_ID_LENGTH + 1)]


def _with(body: dict[str, Any], path: tuple[str, ...], value: str) -> dict[str, Any]:
    """A DEEP copy of `body` with `path` set: several of the paths above reach into a nested block."""

    copied = copy.deepcopy(body)
    target = copied
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return copied


class TestTheWritePathStripsBeforeItCountsCharacters:
    """Per payload field with a floor: spaces alone are refused.

    No read model is here: the strip runs BEFORE the floor, so one there would refuse a stored blank.
    """

    @pytest.fixture
    def cases(self, address, kontakt, saison, team) -> dict[str, tuple[type[BaseModel], dict[str, Any], tuple[str, ...]]]:
        spielort = {"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80}
        schiedsrichter = {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        spieler = {
            "first_name": "Max",
            "last_name": "Mustermann",
            "birth_date": "2009-05-04",
            "nummer": None,
            "position": None,
            "stufe": None,
            "rolle": None,
            "version": 0,
        }
        team_payload = {key: value for key, value in team().items() if key in FLPostTeamPayload.model_fields}
        # A WRITE-side person, and not `tests/api/test_teams.py :: STORED_KONTAKTPERSON`, which holds
        # values the payload refuses on purpose.
        kontaktperson = {
            "first_name": "Anke",
            "last_name": "Koerner",
            "email": "a.koerner@example.de",
            "phone": "+49 170 1234567",
            "einwilligung": {"scope": "kontaktdaten", "date": "2026-01-15"},
        }
        austritt = {"type": "rueckzug", "reason": "Zu wenige Spieler", "date": "2026-03-01"}

        return {
            "spielort.address.stadt": (FLPostSpielortPayload, spielort, ("address", "stadt")),
            "spielort.address.strasse": (FLPostSpielortPayload, spielort, ("address", "strasse")),
            "spielort.name": (FLPostSpielortPayload, spielort, ("name",)),
            "schiedsrichter.name": (FLPostSchiedsrichterPayload, schiedsrichter, ("name",)),
            "spieler_patch.last_name": (FLPatchSpielerSaisonPayload, spieler, ("last_name",)),
            "spieler_patch.first_name": (FLPatchSpielerSaisonPayload, spieler, ("first_name",)),
            "team.full_name": (FLPostTeamPayload, team_payload, ("full_name",)),
            "team.name": (FLPostTeamPayload, team_payload, ("name",)),
            # The width is a floor as well as a ceiling, so a padded value has to reach it stripped.
            "team.shorthand": (FLPostTeamPayload, team_payload, ("shorthand",)),
            "kontaktperson.last_name": (FLKontaktpersonPayload, kontaktperson, ("last_name",)),
            "kontaktperson.first_name": (FLKontaktpersonPayload, kontaktperson, ("first_name",)),
            "saison_team.austritt.reason": (FLAustrittPayload, austritt, ("reason",)),
        }

    @pytest.mark.parametrize("blank", WHITESPACE_RUNS, ids=[str(len(run)) for run in WHITESPACE_RUNS])
    @pytest.mark.parametrize("label", STRIPPED_WRITE_FIELDS)
    def test_spaces_alone_are_refused(self, cases, label, blank, assert_rejects):
        """The whole point: `min_length` counts characters, so an unstripped floor takes a run of its own width."""

        model, body, path = cases[label]

        # The body parses as it stands, or a mistyped key would be refused under the field's own name.
        model.model_validate(body)
        assert_rejects(model, _with(body, path, blank), path[-1])
