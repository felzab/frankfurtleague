import copy
import string
from typing import Any, get_args

import pytest
from bson import ObjectId
from pydantic import BaseModel, ValidationError

from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload, FLSaison
from app.api.schiedsrichter.schemas import FLPatchSchiedsrichterPayload, FLPostSchiedsrichterPayload, FLSchiedsrichter
from app.api.spiele.schemas import MAX_QUALIFIERS, FLSpielBooking
from app.api.spieler.schemas import (
    FLEinwilligung,
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLSaisonSpielerResponse,
    FLSaisonSpielerRow,
    FLSpieler,
    FLSpielerMembership,
    FLSpielerRecord,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import build_ghost_spieler
from app.api.spielorte.schemas import FLPostSpielortPayload, FLSpielort
from app.api.spieltage.schemas import FLPatchSpieltagPayload, FLSpieltag
from app.api.teams.schemas import (
    MAX_NUMBER_OF_GROUPS,
    FLKontaktpersonPayload,
    FLPatchSaisonTeamPayload,
    FLPostSaisonTeamPayload,
    FLPostTeamPayload,
)
from app.shared.schemas.bounds import KONTAKT_NAME_MAX_LENGTH, SAISON_ID_LENGTH
from app.shared.schemas.literals import FLGruppenNames
from tests.database import a_clean_database, on_the_seed_loop
from tests.documents import spieler_document
from tests.worker import worker_database

EINWILLIGUNG_DATABASE_NAME = worker_database("fl_einwilligung_validator_test")

SPIELER_OID = ObjectId("6890a1b2c3d4e5f607420001")

_GRUPPEN_ALPHABET = string.ascii_uppercase


def gruppe_name(index: int) -> str:
    """The name at a zero-based `index`, by the rule `FLGruppenNames` is spelled to follow."""

    name = ""
    while True:
        index, offset = divmod(index, len(_GRUPPEN_ALPHABET))
        name = _GRUPPEN_ALPHABET[offset] + name
        if index == 0:
            return name
        # What makes it BIJECTIVE base-26: there is no zero digit, so a full wheel borrows from the
        # place above rather than leaving it a leading `A`.
        index -= 1


def gruppen_names(count: int) -> tuple[str, ...]:
    """The first `count` group names, by the rule the closed set follows: A-Z, then AA, AB, onward.

    Bijective base-26, so it is total: the 27th name is `AA` rather than an error met only once the
    cap passes Z.
    """

    return tuple(gruppe_name(index) for index in range(count))


class TestTheGroupNames:
    def test_the_closed_set_is_the_naming_rule_s_own_prefix(self):
        """The one pin on a set a type checker forces us to spell: a fifth name that is not `E` fails here rather than in a season."""

        assert get_args(FLGruppenNames.__value__) == gruppen_names(MAX_NUMBER_OF_GROUPS)

    @pytest.mark.parametrize(
        ("count", "expected"),
        [
            pytest.param(1, ("A",), id="one group"),
            pytest.param(8, ("A", "B", "C", "D", "E", "F", "G", "H"), id="eight groups"),
            pytest.param(26, tuple(string.ascii_uppercase), id="the whole alphabet"),
            pytest.param(28, (*string.ascii_uppercase, "AA", "AB"), id="past the alphabet"),
        ],
    )
    def test_it_names_this_many_groups_exactly_like_this(self, count: int, expected: tuple[str, ...]):
        """Asserted past the cap on purpose: a rule producing the right four names for four is indistinguishable from the list it replaced."""

        assert gruppen_names(count) == expected

    def test_the_set_is_exactly_as_wide_as_the_bracket(self):
        """The width is arithmetic, in both directions.

        A season sends one club per group at least, so a name past `MAX_QUALIFIERS` names a group
        nothing can save; short of it, a group count the bracket admits has no name.
        """

        assert MAX_NUMBER_OF_GROUPS == MAX_QUALIFIERS


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

    def test_the_payload_rejects_a_malformed_email_through_the_nested_contact(self, kontakt, assert_rejects):
        assert_rejects(
            FLPostSchiedsrichterPayload,
            {"kontakt": kontakt(email="nope"), "name": "Anna Referee", "schule": None, "default_payment": 20},
            "email",
        )

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

    @pytest.mark.parametrize("model", [FLPostSchiedsrichterPayload, FLPatchSchiedsrichterPayload])
    def test_the_payload_holds_the_name_to_every_persons_ceiling(self, kontakt, assert_rejects, model):
        body = {"kontakt": kontakt(), "schule": None, "default_payment": 20}

        assert_rejects(model, {**body, "name": "A" * (KONTAKT_NAME_MAX_LENGTH + 1)}, "name")
        assert len(model.model_validate({**body, "name": "A" * KONTAKT_NAME_MAX_LENGTH}).name) == KONTAKT_NAME_MAX_LENGTH

    def test_the_read_model_still_accepts_a_stored_name_the_payload_would_refuse(self, schiedsrichter):
        """A read model refusing a stored name would answer 500 for the whole list because of one row."""
        assert FLSchiedsrichter.model_validate(schiedsrichter(name="A. Referee")).name == "A. Referee"

    def test_the_read_model_still_serves_a_stored_contact_the_payload_would_refuse(self, schiedsrichter, kontakt):
        """The nested half of the case above, and the one a NARROWED rule reaches: the phone rule grew a final digit after rows existed."""
        stored = kontakt(telefon="069 1234 ", email="a" * 250 + "@b.example")

        assert FLSchiedsrichter.model_validate(schiedsrichter(kontakt=stored)).kontakt.telefon == "069 1234 "

    def test_payload_shares_the_same_constraints(self, kontakt, assert_rejects):
        assert_rejects(FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "", "schule": None, "default_payment": 0}, "name")
        assert_rejects(
            FLPostSchiedsrichterPayload, {"kontakt": kontakt(), "name": "X", "schule": None, "default_payment": -1}, "default_payment"
        )


class TestSpieler:
    def test_accepts_a_valid_spieler(self, spieler):
        assert FLSpieler.model_validate(spieler()).vorname == "Max"

    # An empty forename is no name: the erased pupils' sentinel stores null, and nothing stores "".
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

    @pytest.mark.parametrize("field", ["vorname", "geburtsdatum", "einwilligung"])
    def test_the_record_refuses_a_person_stored_as_nobody(self, field):
        """No write stores such a person, so the read-back is the one place a hand edit blanking one shows."""

        with pytest.raises(ValidationError):
            FLSpielerRecord.model_validate(spieler_document(ObjectId(), **{"vorname": "Max", "nachname": "Mustermann", field: None}))

    def test_the_record_reads_the_sentinel_back(self):
        assert FLSpielerRecord.model_validate(build_ghost_spieler(), extra="forbid").vorname is None

    def test_the_record_refuses_the_sentinel_holding_an_address(self):
        """No lookup by address excludes the sentinel, so the read-back is where one given an address shows."""

        with pytest.raises(ValidationError):
            FLSpielerRecord.model_validate({**build_ghost_spieler(), "email": "geist@schule.example"})

    @pytest.mark.parametrize("absent", [True, False], ids=["absent", "null"])
    def test_the_person_patch_requires_a_birthdate(self, absent: bool):
        """No default and no null, so neither a form that forgot the field nor a cleared picker clears a stored date."""

        names = {"vorname": "Max", "nachname": "Mustermann"}

        with pytest.raises(ValidationError):
            FLPatchSpielerPayload.model_validate(names if absent else {**names, "geburtsdatum": None})

    @pytest.mark.parametrize("part", ["vorname", "nachname"])
    def test_the_person_patch_holds_a_name_to_the_registrations_ceiling(self, part: str):
        """An administrator's edit may not store a name the pupil's own registration would refuse."""

        names = {"vorname": "Max", "nachname": "Mustermann", "geburtsdatum": "2009-05-04"}

        with pytest.raises(ValidationError):
            FLPatchSpielerPayload.model_validate({**names, part: "A" * (KONTAKT_NAME_MAX_LENGTH + 1)})

        at_the_bound = FLPatchSpielerPayload.model_validate({**names, part: "A" * KONTAKT_NAME_MAX_LENGTH})
        assert len(getattr(at_the_bound, part) or "") == KONTAKT_NAME_MAX_LENGTH


class TestEinwilligung:
    """The consent record: what may be published, and whether anyone confirmed it."""

    def test_accepts_a_collected_consent(self, spieler, einwilligung):
        collected = einwilligung(umfang="kader_oeffentlich")

        einwilligung = FLSpieler.model_validate(spieler(einwilligung=collected)).einwilligung

        assert einwilligung is not None and einwilligung.umfang == "kader_oeffentlich"

    @pytest.mark.parametrize("field", ["umfang", "datum", "confirmed_at", "text_version", "medien", "nachweis"])
    def test_requires_every_key(self, einwilligung, field, assert_rejects):
        """Each key a stored record carries, so a model accepting one fewer would let the read-back pass a row missing it."""

        incomplete = einwilligung()
        del incomplete[field]

        assert_rejects(FLEinwilligung, incomplete, field)

    def test_a_media_consent_is_read_beside_the_publication_scope_and_not_inside_it(self, einwilligung):
        """Two independent answers: a reader asking `umfang` whether a photo may be published gets the wrong question's answer."""

        parsed = FLEinwilligung.model_validate(einwilligung(umfang="kader_oeffentlich", text_version="liga-2026-03", medien=True))

        assert parsed.text_version == "liga-2026-03"
        assert parsed.medien is True
        assert parsed.umfang == "kader_oeffentlich"

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            # A scope somebody invented where the two the league publishes under already exist.
            ("umfang", "oeffentlich"),
            ("umfang", "kader"),
        ],
    )
    def test_rejects_a_value_outside_its_closed_set(self, einwilligung, field, value, assert_rejects):
        assert_rejects(FLEinwilligung, einwilligung(**{field: value}), field)

    def test_rejects_a_date_that_is_not_a_calendar_day(self, einwilligung, assert_rejects):
        assert_rejects(FLEinwilligung, einwilligung(datum="2026-02-31"), "datum")

    def test_the_patch_payload_carries_no_consent_field(self):
        """`patch_spieler` `$set`s this model's whole dump, so a field here would let a name correction rewrite what somebody agreed to."""

        assert "einwilligung" not in FLPatchSpielerPayload.model_fields


@pytest.mark.db
class TestTheConsentRecordStoredAndReadBack:
    """The record the registration flow writes, stored and read back through the person's read model."""

    def _written(self, url: str, einwilligung: dict[str, Any]) -> dict[str, Any]:
        async def body() -> Any:
            async with a_clean_database(url, EINWILLIGUNG_DATABASE_NAME) as (_, database):
                await database.spieler.insert_one(
                    {
                        "_id": SPIELER_OID,
                        "vorname": "Wiltrudis",
                        "nachname": "Meier",
                        "email": "wiltrudis@schule.example",
                        "inactive_since": None,
                        "geburtsdatum": "2009-05-04",
                        "einwilligung": einwilligung,
                    }
                )

                return await database.spieler.find_one({"_id": SPIELER_OID})

        return on_the_seed_loop(body())

    def test_a_confirmed_record_is_stored_and_reads_back_carrying_both_answers(self, mongo_url: str, einwilligung):

        stored = self._written(mongo_url, einwilligung(text_version="liga-2026-03", medien=True))
        parsed = FLSpielerWithMemberships.model_validate(
            {**stored, "address_change_id": None, "address_change_viewable_denied": None, "memberships": []}
        )

        assert parsed.einwilligung is not None
        assert (parsed.einwilligung.text_version, parsed.einwilligung.medien) == ("liga-2026-03", True)


class TestSaisonSpielerRow:
    """`saison_spieler`'s declared shape. It validates no stored document — see the class docstring for why it may not."""

    def test_declares_exactly_the_stored_keys(self):
        """Compared as a set against what the writes store: a model naming another key would declare one nothing writes."""

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
            "is_nachnominiert",
            "rolle",
            "stufe",
            "position",
            "nummer",
            "inactive_since",
            "version",
        }

    def test_a_number_is_a_string_and_not_an_int(self, saison_spieler):
        """Squad numbers are worn, not counted: `07` and `7` are different shirts, and an int erases the distinction."""

        assert FLSaisonSpielerRow.model_validate(saison_spieler(nummer="07")).nummer == "07"

        with pytest.raises(ValidationError):
            FLSaisonSpielerRow.model_validate(saison_spieler(nummer=7))

    def test_it_shares_the_closed_sets_with_the_read_models(self):
        """A Literal of its own would compare equal to `FLSpieler`'s today and drift the moment either moves."""

        assert FLSaisonSpielerRow.model_fields["stufe"].annotation == FLSpieler.model_fields["stufe"].annotation
        assert FLSaisonSpielerRow.model_fields["position"].annotation == FLSpieler.model_fields["position"].annotation


class TestASquadNumberOnTheWritePath:
    """The digits bound sits on the payloads alone.

    A read model refusing a stored value answers 500 for the whole list.
    """

    PAYLOADS = [FLPostSaisonSpielerPayload, FLPatchSaisonSpielerPayload]
    READ_MODELS = [FLSpieler, FLSaisonSpielerResponse, FLSpielerMembership]

    def body(self, stored: dict[str, Any], payload_model: type[BaseModel]) -> dict[str, Any]:
        """The stored row projected onto the payload, which carries neither `_id` nor the ids the path names."""

        return {field: stored[field] for field in payload_model.model_fields if field in stored}

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
        assert FLSpieltag.model_validate(spieltag()).count_spiele == 4

    def test_carries_no_name(self):
        """A stored name restates a composed fact with nothing holding the two consistent."""

        assert "name" not in FLSpieltag.model_fields

    def test_rejects_a_negative_match_count(self, spieltag):
        """`ge=0` rather than `gt=0`: the count is derived from the season's rules, and zero is a real answer."""
        with pytest.raises(ValidationError):
            FLSpieltag.model_validate(spieltag(count_spiele=-1))

    def test_accepts_a_match_count_of_zero(self, spieltag):
        assert FLSpieltag.model_validate(spieltag(count_spiele=0)).count_spiele == 0

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


class TestTheMatchdaysSpan:
    """`refuse_reversed_span` under the matchday payload, which names the span by its kind."""

    def test_accepts_a_matchday_on_a_single_day(self):
        """The editor saves a day picked once as `ende` equal to `beginn`, so refusing an equal span refuses what the form offers."""
        parsed = FLPatchSpieltagPayload.model_validate({"beginn": "2026-09-04", "ende": "2026-09-04"})

        assert parsed.ende == parsed.beginn

    def test_refuses_a_matchday_ending_before_it_begins(self):
        with pytest.raises(ValidationError) as failure:
            FLPatchSpieltagPayload.model_validate({"beginn": "2026-09-05", "ende": "2026-09-04"})

        assert [error["type"] for error in failure.value.errors()] == ["spieltag_ends_before_start"]


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

    # `allowed_stufen` is a subset of the league's vocabulary, never a redefinition and never empty.
    def test_rejects_a_stufe_the_league_does_not_have(self, saison):
        """Not `assert_rejects`: it reads the last element of the error location, and a rejected list item ends with the index."""
        rules = {**saison()["rules"], "allowed_stufen": ["Q1", "10"]}

        with pytest.raises(ValidationError) as failure:
            FLSaison.model_validate(saison(rules=rules))

        assert any("allowed_stufen" in error["loc"] for error in failure.value.errors())

    def test_rejects_an_empty_stufen_list(self, saison, assert_rejects):
        """A season offering no level at all would make every squad entry unfillable."""
        rules = {**saison()["rules"], "allowed_stufen": []}

        assert_rejects(FLSaison, saison(rules=rules), "allowed_stufen")

    def test_rejects_a_season_missing_the_stufen_list(self, saison, assert_rejects):
        """Required with no default, for the reason `qualifiers_per_gruppe` is: no constant in a model."""
        rules = {key: value for key, value in saison()["rules"].items() if key != "allowed_stufen"}

        assert_rejects(FLSaison, saison(rules=rules), "allowed_stufen")

    def test_rejects_a_season_advancing_nobody(self, saison):
        """A group nobody comes out of is not a group phase, so the count is `gt=0`."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1, "qualifiers_per_gruppe": 0}))

    # No Pydantic default: a season missing the key would read as though it had one, and the bracket's
    # size would be a constant in a model.
    def test_rejects_rules_with_no_qualifier_count(self, saison):
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={"win_points": 3, "draw_points": 1}))

    # Required for the qualifier count's reason: an absent key must fail, not read as a bound nobody chose.
    @pytest.mark.parametrize("field", ["number_of_gruppen", "teams_per_gruppe"])
    def test_rejects_rules_with_no_capacity(self, saison, field):
        rules = {"win_points": 3, "draw_points": 1, "qualifiers_per_gruppe": 2, "number_of_gruppen": 4, "teams_per_gruppe": 4}
        del rules[field]

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules=rules))

    def test_the_group_cap_is_the_size_of_the_closed_set(self, saison):
        """`NumberOfGroups` reads the set's size, and this is what refuses a hand-written number back in its place.

        `offered_gruppen` slices `get_args(FLGruppenNames.__value__)`, so a cap over that size is a season the
        entry path serves short of the groups it promised.
        """
        cap = MAX_NUMBER_OF_GROUPS

        assert FLSaison.model_validate(saison(rules={**saison()["rules"], "number_of_gruppen": cap})).rules.number_of_gruppen == cap

        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(rules={**saison()["rules"], "number_of_gruppen": cap + 1}))

    @pytest.mark.parametrize("field", ["start_date", "end_date"])
    def test_rejects_a_date_that_does_not_exist(self, saison, field):
        """Both boundaries get the calendar check: the value passes the regex and is not a real day."""
        with pytest.raises(ValidationError):
            FLSaison.model_validate(saison(**{field: "2026-04-31"}))


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
            "bewerbung": {"offen": True, "von": "2025-09-01", "bis": "2025-10-31"},
            "registrierung": {"offen": True, "von": "2025-11-01", "bis": "2025-12-15"},
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

        assert [error["type"] for error in failure.value.errors()] == ["bewerbung_window_ends_before_start"]

    def test_judges_the_window_apart_from_the_season_it_belongs_to(self, saison):
        """A window may legitimately open and close before the season's first day."""
        before_the_saison = {"offen": False, "von": "2025-01-01", "bis": "2025-02-01"}

        assert FLPatchSaisonPayload.model_validate(self.payload(saison, bewerbung=before_the_saison)).bewerbung is not None

    def test_refuses_a_season_ending_before_it_starts_in_the_other_sides_words(self, saison):
        """The same helper's other caller: one kind moved without the other is what this catches."""
        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonPayload.model_validate(self.payload(saison, start_date="2026-06-30", end_date="2026-01-01"))

        assert [error["type"] for error in failure.value.errors()] == ["saison_ends_before_start"]

    def test_accepts_a_registration_window_that_runs_forwards(self, saison):
        """The floor for the registration half: without it the refusal below could pass for a reason nobody is testing."""
        parsed = FLPatchSaisonPayload.model_validate(self.payload(saison))

        assert parsed.registrierung is not None
        assert parsed.registrierung.offen is True

    def test_accepts_no_registration_window_at_all(self, saison):
        """`None` is the season taking no registrations, which the span rule has nothing to say about."""
        assert FLPatchSaisonPayload.model_validate(self.payload(saison, registrierung=None)).registrierung is None

    def test_refuses_a_registration_window_ending_before_it_opens(self, saison):
        """The third caller's own kind: the two windows raise different kinds, and one moved alone is what this catches."""
        reversed_window = {"offen": False, "von": "2025-12-15", "bis": "2025-11-01"}

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonPayload.model_validate(self.payload(saison, registrierung=reversed_window))

        assert [error["type"] for error in failure.value.errors()] == ["registrierung_window_ends_before_start"]

    def test_judges_the_registration_window_apart_from_the_application_window(self, saison):
        """Two decisions rather than one span: registration may legitimately close before applications do."""
        overlapping = {"offen": True, "von": "2025-08-01", "bis": "2025-09-15"}

        assert FLPatchSaisonPayload.model_validate(self.payload(saison, registrierung=overlapping)).registrierung is not None


class TestTheSeasonsWindowsAreRequiredWithNoDefault:
    """Parametrised over both windows: a default added to either would leave the other's case green."""

    @pytest.mark.parametrize("field", ["bewerbung", "registrierung"])
    def test_a_payload_omitting_a_window_is_refused_rather_than_closing_it(self, saison, field, assert_rejects):
        body = {key: value for key, value in TestTheSeasonsSpans.payload(saison).items() if key != field}

        assert_rejects(FLPatchSaisonPayload, body, field)

    @pytest.mark.parametrize("field", ["bewerbung", "registrierung"])
    def test_a_payload_carrying_an_explicit_null_is_accepted(self, saison, field):
        body = {**TestTheSeasonsSpans.payload(saison), field: None}

        assert getattr(FLPatchSaisonPayload.model_validate(body), field) is None


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

# The fixed-width ids, whose ceiling is counted on arrival, and every `CustomKontaktName`, whose pattern
# is: a padded value is refused rather than stored stripped.
PADDING_REFUSED_FIELDS = [
    "saison.id",
    "saison_team.saison_id",
    "saison_spieler.saison_id",
    "kontaktperson.nachname",
    "kontaktperson.vorname",
    "schiedsrichter.name",
    "spieler_patch.nachname",
    "spieler_patch.vorname",
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

    No read model is here: the strip runs BEFORE the floor, so one there would refuse a stored blank.
    """

    @pytest.fixture
    def cases(self, address, kontakt, saison, saison_spieler, team) -> dict[str, tuple[type[BaseModel], dict[str, Any], tuple[str, ...]]]:
        spielort = {"address": address(), "name": "Sportplatz Ost", "default_mietpreis": 80}
        schiedsrichter = {"kontakt": kontakt(), "name": "Anna Referee", "schule": None, "default_payment": 20}
        spieler = {"vorname": "Max", "nachname": "Mustermann", "geburtsdatum": "2009-05-04"}
        team_payload = {key: value for key, value in team().items() if key in FLPostTeamPayload.model_fields}
        # A WRITE-side person, and not `tests/api/test_teams.py :: STORED_KONTAKTPERSON`, which holds
        # values the payload refuses on purpose.
        kontaktperson = {
            "vorname": "Anke",
            "nachname": "Koerner",
            "email": "a.koerner@example.de",
            "telefon": "+49 170 1234567",
            "einwilligung": {"umfang": "kontaktdaten", "text_version": "v1", "datum": "2026-01-15"},
        }
        saison_team = {
            "gruppe": "A",
            "austritt": {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-01"},
            "trikot_farbe": None,
        }
        # The stored rows minus what only storage carries, which is what each create payload takes.
        new_saison = {"id": saison()["_id"], "rules": saison()["rules"], "start_date": "2026-01-01", "end_date": "2026-06-30"}
        new_saison["bewerbung"] = {"offen": True, "von": "2025-11-01", "bis": "2025-12-15"}
        new_saison["registrierung"] = {"offen": False, "von": "2026-01-05", "bis": "2026-02-05"}
        new_saison_spieler = {key: value for key, value in saison_spieler().items() if key in FLPostSaisonSpielerPayload.model_fields}
        new_saison_team = {"saison_id": saison()["_id"], "gruppe": "A"}

        return {
            "spielort.address.stadt": (FLPostSpielortPayload, spielort, ("address", "stadt")),
            "spielort.address.strasse": (FLPostSpielortPayload, spielort, ("address", "strasse")),
            "spielort.name": (FLPostSpielortPayload, spielort, ("name",)),
            "schiedsrichter.name": (FLPostSchiedsrichterPayload, schiedsrichter, ("name",)),
            "spieler_patch.nachname": (FLPatchSpielerPayload, spieler, ("nachname",)),
            "spieler_patch.vorname": (FLPatchSpielerPayload, spieler, ("vorname",)),
            "team.full_name": (FLPostTeamPayload, team_payload, ("full_name",)),
            "team.name": (FLPostTeamPayload, team_payload, ("name",)),
            # The width is a floor as well as a ceiling, so a padded value has to reach it stripped.
            "team.shorthand": (FLPostTeamPayload, team_payload, ("shorthand",)),
            # Three independent declarations of the season id, so a strip dropped from one is
            # invisible to the other two's clauses.
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

    @pytest.mark.parametrize("label", [label for label in STRIPPED_WRITE_FIELDS if label not in PADDING_REFUSED_FIELDS])
    def test_a_padded_value_is_stored_stripped(self, cases, label):
        model, body, path = cases[label]
        original = _sent(body, path)

        assert _stored(model.model_validate(_with(body, path, f"  {original}  ")), path) == original

    @pytest.mark.parametrize("label", PADDING_REFUSED_FIELDS)
    def test_a_padded_value_is_refused(self, cases, label, assert_rejects):
        """The published schema is what the backend accepts, so a value its ceiling or pattern refuses padded is never repaired."""

        model, body, path = cases[label]

        assert_rejects(model, _with(body, path, f" {_sent(body, path)} "), path[-1])

    @pytest.mark.parametrize("blank", WHITESPACE_RUNS, ids=[str(len(run)) for run in WHITESPACE_RUNS])
    @pytest.mark.parametrize("label", STRIPPED_WRITE_FIELDS)
    def test_spaces_alone_are_refused(self, cases, label, blank, assert_rejects):
        """The whole point: `min_length` counts characters, so an unstripped floor takes a run of its own width."""

        model, body, path = cases[label]

        assert_rejects(model, _with(body, path, blank), path[-1])
