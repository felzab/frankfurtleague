import copy
from typing import Any, get_args

import pytest
from pydantic import BaseModel, ValidationError

from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload, FLSaison
from app.api.schiedsrichter.schemas import FLPostSchiedsrichterPayload, FLSchiedsrichter
from app.api.spiele.schemas import FLSpielBooking
from app.api.spieler.schemas import (
    FLEinwilligung,
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLPostSpielerPayload,
    FLSaisonSpielerResponse,
    FLSaisonSpielerRow,
    FLSpieler,
    FLSpielerMembership,
)
from app.api.spieler.services import registration_einwilligung
from app.api.spielorte.schemas import FLPostSpielortPayload, FLSpielort
from app.api.spieltage.schemas import FLSpieltag
from app.api.teams.schemas import (
    FLGruppenNames,
    FLKontaktpersonPayload,
    FLPatchSaisonTeamPayload,
    FLPostSaisonTeamPayload,
    FLPostTeamPayload,
)
from app.shared.schemas.bounds import SAISON_ID_LENGTH


class TestSpielort:
    def test_accepts_a_valid_spielort(self, spielort):
        assert FLSpielort.model_validate(spielort()).default_mietpreis == 80

    @pytest.mark.parametrize("field", ["name", "maps_link"])
    def test_rejects_an_empty_required_string(self, spielort, field):
        """Both strings are embedded onto every match that uses the venue."""
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(**{field: ""}))

    def test_rejects_a_negative_default_rent(self, spielort):
        with pytest.raises(ValidationError):
            FLSpielort.model_validate(spielort(default_mietpreis=-1))

    def test_payload_accepts_a_valid_body(self, address):
        """Without it a mistyped key makes the rejection test below pass for the wrong reason."""
        parsed = FLPostSpielortPayload.model_validate({"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80})

        assert parsed.default_mietpreis == 80

    def test_payload_shares_the_same_constraints(self, address, assert_rejects):
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "", "default_mietpreis": 0}, "name")
        assert_rejects(FLPostSpielortPayload, {"address": address(), "name": "X", "default_mietpreis": -1}, "default_mietpreis")


class TestSchiedsrichter:
    def test_accepts_a_valid_schiedsrichter(self, schiedsrichter):
        assert FLSchiedsrichter.model_validate(schiedsrichter()).default_payment == 20

    def test_rejects_an_empty_name(self, schiedsrichter):
        """The name is embedded onto every match the referee officiates."""
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(name=""))

    def test_rejects_a_negative_payment(self, schiedsrichter):
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(default_payment=-1))

    def test_accepts_a_missing_school(self, schiedsrichter):
        """Not every referee is attached to a school."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(schule=None)).schule is None

    def test_rejects_a_malformed_email_through_the_nested_contact(self, schiedsrichter, kontakt):
        with pytest.raises(ValidationError):
            FLSchiedsrichter.model_validate(schiedsrichter(kontakt=kontakt(email="nope")))

    def test_payload_accepts_a_valid_body(self, kontakt):
        parsed = FLPostSchiedsrichterPayload.model_validate(
            {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        )

        assert parsed.default_payment == 20

    # A referee is a person, so the name takes the player payloads' rule; the cost is a refused initial or title.
    @pytest.mark.parametrize("name", ["A. Referee", "Referee (C)", "Referee 2"])
    def test_payload_rejects_a_name_that_is_not_letters(self, kontakt, assert_rejects, name):
        assert_rejects(
            FLPostSchiedsrichterPayload,
            {"kontakt": kontakt(), "name": name, "schule": None, "default_payment": 20},
            "name",
        )

    def test_the_read_model_still_accepts_a_stored_name_the_payload_would_refuse(self, schiedsrichter):
        """A read model refusing a stored name would answer 500 for the whole list because of one row."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(name="A. Referee")).name == "A. Referee"

    def test_payload_shares_the_same_constraints(self, kontakt, assert_rejects):
        assert_rejects(FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "", "schule": None, "default_payment": 0}, "name")
        assert_rejects(
            FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "X", "schule": None, "default_payment": -1}, "default_payment"
        )


class TestSpieler:
    def test_accepts_a_valid_spieler(self, spieler):
        assert FLSpieler.model_validate(spieler()).vorname == "Max"

    # A player must have a first name; the rest fills in over time, and the frontend mirrors the split.
    def test_requires_a_first_name(self, spieler):
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(vorname=""))

    @pytest.mark.parametrize("field", ["nachname", "stufe", "nummer", "position"])
    def test_allows_every_other_name_field_to_be_absent(self, spieler, field):
        assert getattr(FLSpieler.model_validate(spieler(**{field: None})), field) is None

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
    def test_rejects_a_position_or_stufe_outside_its_closed_set(self, spieler, field, value):
        with pytest.raises(ValidationError):
            FLSpieler.model_validate(spieler(**{field: value}))

    def test_accepts_the_stufe_no_row_holds_yet(self, spieler):
        """`E2` is offered although the current season has nobody in it — the phases run in sequence."""
        assert FLSpieler.model_validate(spieler(stufe="E2")).stufe == "E2"

    def test_requires_a_consent_record(self, spieler):
        """A pupil reaching a public squad list without one would be published on a claim nobody made."""

        missing = spieler()
        del missing["einwilligung"]

        with pytest.raises(ValidationError):
            FLSpieler.model_validate(missing)


class TestEinwilligung:
    """The consent record: what may be published, who agreed it, and whether anyone confirmed it."""

    def test_accepts_a_collected_consent(self, spieler):
        assert FLSpieler.model_validate(spieler()).einwilligung.umfang == "kader_oeffentlich"

    @pytest.mark.parametrize("field", ["umfang", "erteilt_von", "datum", "bestaetigt_am"])
    def test_requires_every_key(self, einwilligung, field, assert_rejects):
        """All four are in the validator's `required` tuple, so a model accepting three would read back a row the database refuses to store."""

        incomplete = einwilligung()
        del incomplete[field]

        assert_rejects(FLEinwilligung, incomplete, field)

    def test_a_carried_over_record_says_so_and_carries_no_dates(self, einwilligung):
        """`bestandsuebernahme` is the point of the third member: nobody was asked, so there is no day and no confirmation."""

        parsed = FLEinwilligung.model_validate(einwilligung(erteilt_von="bestandsuebernahme", datum=None, bestaetigt_am=None))

        assert parsed.erteilt_von == "bestandsuebernahme"
        assert parsed.datum is None

    def test_an_unconfirmed_record_is_null_rather_than_absent(self, einwilligung):
        """A null `bestaetigt_am` is the state a publication gate reads; omitting the key would make it indistinguishable from a bad row."""

        assert FLEinwilligung.model_validate(einwilligung(bestaetigt_am=None)).bestaetigt_am is None

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            # A scope somebody invented where the two the league publishes under already exist.
            ("umfang", "oeffentlich"),
            ("umfang", "kader"),
            # A source outside the three: consent comes from a guardian, an adult, or a carry-over.
            ("erteilt_von", "schule"),
            ("erteilt_von", "trainer"),
        ],
    )
    def test_rejects_a_value_outside_its_closed_set(self, einwilligung, field, value, assert_rejects):
        assert_rejects(FLEinwilligung, einwilligung(**{field: value}), field)

    def test_rejects_a_date_that_is_not_a_calendar_day(self, einwilligung, assert_rejects):
        assert_rejects(FLEinwilligung, einwilligung(datum="2026-02-31"), "datum")

    def test_a_registration_composes_a_collected_record_and_not_the_backfills(self):
        """The difference IS the distinguishability: a guardian filing a registration is consenting, and nobody asked a carried-over row."""

        composed = registration_einwilligung(today="2026-04-01")

        assert composed.erteilt_von == "erziehungsberechtigt"
        assert composed.umfang == "kader_oeffentlich"
        assert (composed.datum, composed.bestaetigt_am) == ("2026-04-01", "2026-04-01")

    def test_a_registration_is_confirmed_on_the_day_it_is_filed(self):
        """No unconfirmed window: the person filing the form is the person whose consent it is."""

        composed = registration_einwilligung(today="2026-04-01")

        assert composed.bestaetigt_am == composed.datum

    def test_the_create_payload_carries_no_consent_field(self):
        """An admin able to state one could publish a pupil on a claim nobody made."""

        assert "einwilligung" not in FLPostSpielerPayload.model_fields

    def test_the_patch_payload_carries_no_consent_field(self):
        """The load-bearing half, because `patch_spieler` `$set`s this model's whole dump."""

        assert "einwilligung" not in FLPatchSpielerPayload.model_fields

    def test_a_registration_never_claims_a_carry_over(self):
        """`bestandsuebernahme` is reserved for the backfill; composing it here would make a real consent unfindable among the assumed ones."""

        assert registration_einwilligung(today="2026-04-01").erteilt_von != "bestandsuebernahme"


class TestSaisonSpielerRow:
    """`saison_spieler`'s declared shape. It validates no stored document — see the class docstring for why it may not."""

    def test_declares_exactly_the_ten_stored_keys(self):
        """Compared as a set against the validator's `properties`: a model naming an eleventh key would store one nothing reads."""

        # Named as STORED, so `id` reads `_id`; an alias that is not a plain string names no single key.
        stored = {
            field.validation_alias if isinstance(field.validation_alias, str) else name
            for name, field in FLSaisonSpielerRow.model_fields.items()
        }

        assert stored == {
            "_id",
            "spieler_id",
            "saison_id",
            "team_id",
            "is_nachgetragen",
            "rolle",
            "stufe",
            "position",
            "nummer",
            "inactive_since",
        }

    def test_no_field_carries_a_default_except_the_one_the_validator_does_not_require(self):
        """A default on any other key would make the model accept a row the database refuses, `required` holding the rest."""

        # `rolle` alone, and it has to stay alone: every stored row predates the field, so requiring
        # it would refuse all of them, and the model has to describe what the validator admits.
        assert [name for name, field in FLSaisonSpielerRow.model_fields.items() if not field.is_required()] == ["rolle"]

    def test_a_number_is_a_string_and_not_an_int(self, saison_spieler):
        """Squad numbers are worn, not counted: `07` and `7` are different shirts, and an int erases the distinction."""

        assert FLSaisonSpielerRow.model_validate(saison_spieler(nummer="07")).nummer == "07"

        with pytest.raises(ValidationError):
            FLSaisonSpielerRow.model_validate(saison_spieler(nummer=7))

    def test_it_shares_the_closed_sets_with_the_read_models(self):
        """A Literal of its own would compare equal to the validator's enum today and drift the moment either moves."""

        assert FLSaisonSpielerRow.model_fields["stufe"].annotation == FLSpieler.model_fields["stufe"].annotation
        assert FLSaisonSpielerRow.model_fields["position"].annotation == FLSpieler.model_fields["position"].annotation


class TestASquadNumberOnTheWritePath:
    """The digits bound sits on the payloads alone.

    A read model refusing a stored value answers 500 for the whole list (`docs/backend/spec.md :: I36`).
    """

    PAYLOADS = [FLPostSaisonSpielerPayload, FLPatchSaisonSpielerPayload]
    READ_MODELS = [FLSpieler, FLSaisonSpielerResponse, FLSpielerMembership]

    def body(self, stored: dict[str, Any], payload_model: type[BaseModel]) -> dict[str, Any]:
        """The stored row projected onto the payload, which carries neither `_id` nor the ids the path names."""

        return {field: stored[field] for field in payload_model.model_fields}

    @pytest.mark.parametrize("payload_model", PAYLOADS)
    @pytest.mark.parametrize("nummer", ["7", "07", "1234"])
    def test_a_payload_accepts_one_to_four_digits(self, saison_spieler, payload_model, nummer):
        assert payload_model.model_validate(self.body(saison_spieler(nummer=nummer), payload_model)).nummer == nummer

    @pytest.mark.parametrize("payload_model", PAYLOADS)
    def test_a_payload_accepts_null(self, saison_spieler, payload_model):
        """A squad often does not know the number yet, and null is how the caller says so."""

        assert payload_model.model_validate(self.body(saison_spieler(nummer=None), payload_model)).nummer is None

    @pytest.mark.parametrize("payload_model", PAYLOADS)
    @pytest.mark.parametrize(
        "nummer",
        [
            # A name where a shirt belongs — what free text admitted and this closes.
            "Torwart",
            "7a",
            # Longer than any shirt printed, and a paste of something else.
            "12345",
            # Empty is not null: the caller has to say which they mean.
            "",
            " 7",
            # Unicode decimals, which Python's `\d` would admit and the frontend's would not.
            "٧",
        ],
    )
    def test_a_payload_refuses_anything_else(self, saison_spieler, payload_model, nummer, assert_rejects):
        assert_rejects(payload_model, self.body(saison_spieler(nummer=nummer), payload_model), "nummer")

    @pytest.mark.parametrize("read_model", READ_MODELS)
    def test_a_read_model_still_returns_a_stored_value_the_payload_would_refuse(self, read_model, spieler, saison_spieler):
        """The 362 rows predate the bound; one holding `Torwart` must stay readable, and editable, rather than 500 the list it is in."""

        stored = spieler(nummer="Torwart") if read_model is FLSpieler else saison_spieler(nummer="Torwart")

        assert read_model.model_validate(stored).nummer == "Torwart"


class TestSpieltag:
    def test_accepts_a_valid_spieltag(self, spieltag):
        assert FLSpieltag.model_validate(spieltag()).anzahl_spiele == 4

    def test_carries_no_name(self):
        """A stored name restates a composed fact with nothing holding the two consistent."""

        assert "name" not in FLSpieltag.model_fields

    def test_rejects_a_negative_match_count(self, spieltag):
        """`ge=0` rather than `gt=0`: the count is derived from the season's rules, and zero is a real answer."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(anzahl_spiele=-1))

    def test_accepts_a_match_count_of_zero(self, spieltag):
        assert FLSpieltag.model_validate(spieltag(anzahl_spiele=0)).anzahl_spiele == 0

    def test_carries_its_stored_position(self, spieltag):
        assert FLSpieltag.model_validate(spieltag(position=3)).position == 3

    @pytest.mark.parametrize("position", [0, -1])
    def test_rejects_a_position_below_one(self, spieltag, position):
        """`ge=1` rather than `ge=0`: the reader renders this very number, and a zeroth matchday counts nobody."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(position=position))

    @pytest.mark.parametrize("field", ["beginn", "ende"])
    def test_rejects_a_date_that_does_not_exist(self, spieltag, field):
        """Both ends of the range get the calendar check, not just the regex."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(**{field: "2026-02-31"}))


class TestSaison:
    def test_accepts_a_valid_saison(self, saison):
        assert FLSaison.model_validate(saison()).rules.win_points == 3

    def test_rejects_non_positive_win_points(self, saison):
        """A win must be worth something, or the table cannot rank anyone."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 0, "draw_points": 1}))

    def test_rejects_negative_draw_points(self, saison):
        """A draw cannot cost points."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": -1}))

    def test_accepts_zero_draw_points(self, saison):
        """The asymmetry with wins: a draw worth nothing is a legal rule set."""
        rules = {**saison()["rules"], "draw_points": 0}

        assert FLSaison.model_validate(saison(rules=rules)).rules.draw_points == 0

    # `erlaubte_stufen` is a subset of the league's vocabulary, never a redefinition and never empty.
    def test_rejects_a_stufe_the_league_does_not_have(self, saison):
        """Not `assert_rejects`: it reads the last element of the error location, and a rejected list item ends with the index."""
        rules = {**saison()["rules"], "erlaubte_stufen": ["Q1", "10"]}

        with pytest.raises(ValidationError) as failure:
            FLSaison.model_validate(saison(rules=rules))

        assert any("erlaubte_stufen" in error["loc"] for error in failure.value.errors())

    def test_rejects_an_empty_stufen_list(self, saison, assert_rejects):
        """A season offering no level at all would make every squad entry unfillable."""
        rules = {**saison()["rules"], "erlaubte_stufen": []}

        assert_rejects(FLSaison, saison(rules=rules), "erlaubte_stufen")

    def test_rejects_a_season_missing_the_stufen_list(self, saison, assert_rejects):
        """Required with no default, for the reason `qualifiers_per_group` is: no constant in a model."""
        rules = {key: value for key, value in saison()["rules"].items() if key != "erlaubte_stufen"}

        assert_rejects(FLSaison, saison(rules=rules), "erlaubte_stufen")

    def test_rejects_a_season_advancing_nobody(self, saison):
        """A group nobody comes out of is not a group phase, so the count is `gt=0`."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1, "qualifiers_per_group": 0}))

    # No Pydantic default: a season missing the key would read as though it had one, and the bracket's
    # size would be a constant in a model.
    def test_rejects_rules_with_no_qualifier_count(self, saison):
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1}))

    # Required for the qualifier count's reason: an absent key must fail, not read as a bound nobody chose.
    @pytest.mark.parametrize("field", ["number_of_groups", "teams_per_group"])
    def test_rejects_rules_with_no_capacity(self, saison, field):
        rules = {"win_points": 3, "draw_points": 1, "qualifiers_per_group": 2, "number_of_groups": 4, "teams_per_group": 4}
        del rules[field]

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules=rules))

    def test_the_group_cap_is_the_size_of_the_closed_set(self, saison):
        """The bound and `offered_gruppen`'s cap are two spellings of one number.

        `number_of_groups` carries a literal and `offered_gruppen` reads `get_args(FLGruppenNames)`,
        so a fifth group name would refuse the season the entry path would then serve.
        """
        cap = len(get_args(FLGruppenNames))

        assert FLSaison.model_validate(saison(rules={**saison()["rules"], "number_of_groups": cap})).rules.number_of_groups == cap

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={**saison()["rules"], "number_of_groups": cap + 1}))

    @pytest.mark.parametrize("field", ["start_date", "end_date"])
    def test_rejects_a_date_that_does_not_exist(self, saison, field):
        """Both boundaries get the calendar check: the value passes the regex and is not a real day."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(**{field: "2026-04-31"}))


class TestTheSeasonsSpans:
    """`refuse_reversed_span` under both callers, with the labels each passes it.

    Asserted whole because `fl_frontend/src/features/saisons/schemas.ts` mirrors both sentences word
    for word.
    """

    @staticmethod
    def payload(saison, **overrides: Any) -> dict[str, Any]:
        """The stored season narrowed to the payload's keys: `extra="forbid"` refuses `_id`, `status` and `schedule`."""

        stored = saison()

        return {
            "start_date": stored["start_date"],
            "end_date": stored["end_date"],
            "rules": stored["rules"],
            "bewerbung": {"offen": True, "von": "2025-09-01", "bis": "2025-10-31"},
            **overrides,
        }

    def test_accepts_a_window_that_runs_forwards(self, saison):
        """The floor: without it every refusal below could pass for a reason nobody is testing."""
        parsed = FLPatchSaisonPayload.model_validate(self.payload(saison))

        assert parsed.bewerbung is not None
        assert parsed.bewerbung.offen is True

    def test_accepts_no_window_at_all(self, saison):
        """`None` is the season with nothing recorded, which the span rule has nothing to say about."""
        assert FLPatchSaisonPayload.model_validate(self.payload(saison, bewerbung=None)).bewerbung is None

    def test_refuses_a_window_ending_before_it_opens(self, saison):
        reversed_window = {"offen": False, "von": "2025-10-31", "bis": "2025-09-01"}

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonPayload.model_validate(self.payload(saison, bewerbung=reversed_window))

        assert "Das Ende darf nicht vor dem Beginn der Bewerbungsfrist liegen." in str(failure.value)

    def test_judges_the_window_apart_from_the_season_it_belongs_to(self, saison):
        """A window may legitimately open and close before the season's first day."""
        before_the_season = {"offen": False, "von": "2025-01-01", "bis": "2025-02-01"}

        assert FLPatchSaisonPayload.model_validate(self.payload(saison, bewerbung=before_the_season)).bewerbung is not None

    def test_refuses_a_season_ending_before_it_starts_in_the_other_sides_words(self, saison):
        """The same helper's other caller: one label pair moved without the other is what this catches."""
        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonPayload.model_validate(self.payload(saison, start_date="2026-06-30", end_date="2026-01-01"))

        assert "Das Enddatum darf nicht vor dem Startdatum liegen." in str(failure.value)


class TestSpielBooking:
    """`find_clash_refusal` splits `uhrzeit` into three parts over a bare projection, and the database is hand-edited."""

    def booking(self, **overrides):
        return {"spiel_nr": 3, "datum": "2026-03-15", "uhrzeit": "18:00:00", **overrides}

    def test_accepts_a_well_formed_booking(self):
        assert FLSpielBooking.model_validate(self.booking()).uhrzeit == "18:00:00"

    @pytest.mark.parametrize("uhrzeit", ["18:00", "18", "abend", "25:00:00"])
    def test_rejects_a_time_the_comparison_could_not_read(self, uhrzeit):
        """`18:00` is load-bearing: three-part unpacking raises `ValueError` on it rather than a 422."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(uhrzeit=uhrzeit))

    def test_rejects_a_malformed_date(self):
        """The date is compared too, so it needs the same guarantee as the time."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(datum="15.03.2026"))

    def test_rejects_a_non_positive_fixture_number(self):
        """`spiel_nr` is named back to the admin in the refusal, so a zero would be nonsense to act on."""

        with pytest.raises(ValidationError):
            FLSpielBooking.model_validate(self.booking(spiel_nr=0))


# Every payload field carrying a length floor, by the path that reaches it. `min_length` counts
# CHARACTERS and does not strip, so each needs `strip_whitespace` in front of its floor or spaces
# alone pass as a value stored, served and rendered as empty.
STRIPPED_WRITE_FIELDS = [
    "spielort.address.stadt",
    "spielort.address.strasse",
    "spielort.name",
    "schiedsrichter.name",
    "spieler_post.nachname",
    "spieler_post.vorname",
    "spieler_patch.nachname",
    "spieler_patch.vorname",
    "team.full_name",
    "team.name",
    "team.shorthand",
    "saison.id",
    "saison_team.saison_id",
    "saison_spieler.saison_id",
    "kontaktperson.nachname",
    "kontaktperson.vorname",
    "kontaktperson.einwilligung.text_version",
    "saison_team.austritt.grund",
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


def _sent(body: dict[str, Any], path: tuple[str, ...]) -> str:
    value: Any = body
    for key in path:
        value = value[key]
    return value


def _stored(parsed: BaseModel, path: tuple[str, ...]) -> str:
    value: Any = parsed
    for key in path:
        value = getattr(value, key)
    return value


class TestTheWritePathStripsBeforeItCountsCharacters:
    """Per payload field with a floor: a padded value is stored stripped, and spaces alone are refused.

    No read model is here: the strip runs BEFORE the floor, so one there would refuse a stored blank
    (`docs/backend/spec.md :: I36`).
    """

    @pytest.fixture
    def cases(self, address, kontakt, saison, saison_spieler, team) -> dict[str, tuple[type[BaseModel], dict[str, Any], tuple[str, ...]]]:
        spielort = {"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80}
        schiedsrichter = {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        spieler = {"vorname": "Max", "nachname": "Mustermann"}
        club = {key: value for key, value in team().items() if key in FLPostTeamPayload.model_fields}
        # A WRITE-side person, and not `tests/api/test_teams.py :: STORED_KONTAKTPERSON`, which holds
        # values the payload refuses on purpose.
        kontaktperson = {
            "vorname": "Anke",
            "nachname": "Koerner",
            "email": "a.koerner@example.de",
            "telefon": "+49 170 1234567",
            "geburtsdatum": "1984-05-09",
            "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
        }
        saison_team = {
            "gruppe": "A",
            "austritt": {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-01"},
            "trikot_farbe": None,
        }
        # The stored rows minus what only storage carries, which is what each create payload takes.
        new_saison = {"id": saison()["_id"], "rules": saison()["rules"], "start_date": "2026-01-01", "end_date": "2026-06-30"}
        new_saison["bewerbung"] = {"offen": True, "von": "2025-11-01", "bis": "2025-12-15"}
        new_saison_spieler = {key: value for key, value in saison_spieler().items() if key in FLPostSaisonSpielerPayload.model_fields}
        new_saison_team = {"saison_id": saison()["_id"], "gruppe": "A"}

        return {
            "spielort.address.stadt": (FLPostSpielortPayload, spielort, ("address", "stadt")),
            "spielort.address.strasse": (FLPostSpielortPayload, spielort, ("address", "strasse")),
            "spielort.name": (FLPostSpielortPayload, spielort, ("name",)),
            "schiedsrichter.name": (FLPostSchiedsrichterPayload, schiedsrichter, ("name",)),
            "spieler_post.nachname": (FLPostSpielerPayload, spieler, ("nachname",)),
            "spieler_post.vorname": (FLPostSpielerPayload, spieler, ("vorname",)),
            # The two payloads declare these independently, so a strip dropped from one alone is
            # invisible to the other's clause.
            "spieler_patch.nachname": (FLPatchSpielerPayload, spieler, ("nachname",)),
            "spieler_patch.vorname": (FLPatchSpielerPayload, spieler, ("vorname",)),
            "team.full_name": (FLPostTeamPayload, club, ("full_name",)),
            "team.name": (FLPostTeamPayload, club, ("name",)),
            # The width is a floor as well as a ceiling, so a padded value has to reach it stripped.
            "team.shorthand": (FLPostTeamPayload, club, ("shorthand",)),
            # Three independent declarations of the season id, as the two `spieler` payloads are.
            "saison.id": (FLPostSaisonPayload, new_saison, ("id",)),
            "saison_team.saison_id": (FLPostSaisonTeamPayload, new_saison_team, ("saison_id",)),
            "saison_spieler.saison_id": (FLPostSaisonSpielerPayload, new_saison_spieler, ("saison_id",)),
            "kontaktperson.nachname": (FLKontaktpersonPayload, kontaktperson, ("nachname",)),
            "kontaktperson.vorname": (FLKontaktpersonPayload, kontaktperson, ("vorname",)),
            "kontaktperson.einwilligung.text_version": (FLKontaktpersonPayload, kontaktperson, ("einwilligung", "text_version")),
            "saison_team.austritt.grund": (FLPatchSaisonTeamPayload, saison_team, ("austritt", "grund")),
        }

    def test_the_table_reaches_every_field_it_names(self, cases):
        """Non-vacuity: a label with no case would skip a field while both clauses below stayed green."""

        assert sorted(cases) == sorted(STRIPPED_WRITE_FIELDS)

    @pytest.mark.parametrize("label", STRIPPED_WRITE_FIELDS)
    def test_a_valid_body_still_parses(self, cases, label):
        """Without it a mistyped key would make both clauses below pass for the wrong reason."""

        model, body, path = cases[label]

        assert _stored(model.model_validate(body), path) == _sent(body, path)

    @pytest.mark.parametrize("label", STRIPPED_WRITE_FIELDS)
    def test_a_padded_value_is_stored_stripped(self, cases, label):
        model, body, path = cases[label]
        original = _sent(body, path)

        assert _stored(model.model_validate(_with(body, path, f"  {original}  ")), path) == original

    @pytest.mark.parametrize("blank", WHITESPACE_RUNS, ids=[str(len(run)) for run in WHITESPACE_RUNS])
    @pytest.mark.parametrize("label", STRIPPED_WRITE_FIELDS)
    def test_spaces_alone_are_refused(self, cases, label, blank, assert_rejects):
        """The whole point: `min_length` counts characters, so an unstripped floor takes a run of its own width."""

        model, body, path = cases[label]

        assert_rejects(model, _with(body, path, blank), path[-1])
