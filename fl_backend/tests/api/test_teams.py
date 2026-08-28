import pytest
from pydantic import ValidationError

from app.api.saisons.schemas import FLSaisonForfeitErgebnis, FLSaisonRules
from app.api.spieler.schemas import FLSpielerStufe
from app.api.teams.schemas import (
    FLKontaktperson,
    FLKontaktpersonPayload,
    FLPatchSaisonTeamKontaktePayload,
    FLPatchSaisonTeamPayload,
    FLPatchTeamPayload,
    FLPostTeamPayload,
    FLSaisonTeamKontakte,
    FLSaisonTeamKontaktePayload,
    FLTeam,
    FLTeamRecord,
    FLTeamsGroupedResponse,
    FLTeamStatistik,
)
from app.api.teams.services import build_gruppen

# A whole person as a row STORES one. Reused rather than re-spelled: the shape is the read model's,
# so a field added to it fails here rather than at the first real write.
STORED_KONTAKTPERSON = {
    "vorname": "Anke",
    "nachname": "Koerner",
    "email": "a.koerner@example.de",
    "telefon": "+49 170 1234567",
    "geburtsdatum": "1984-05-09",
    "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
}

# Typed as the `Literal` list `FLSaisonRules` declares: a bare `list[str]` is invariant against it.
STUFEN: list[FLSpielerStufe] = ["E1", "Q1", "Q2", "Q3", "Q4"]

RULES = FLSaisonRules(
    win_points=3,
    draw_points=1,
    qualifiers_per_group=2,
    number_of_groups=4,
    teams_per_group=4,
    tiebreak_order="tordifferenz",
    max_kadergroesse=50,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    erlaubte_stufen=STUFEN,
)


def test_accepts_a_valid_team(team):
    parsed = FLTeam.model_validate(team())
    assert parsed.gruppe == "A"
    assert str(parsed.id) == "6890a1b2c3d4e5f607182930"


@pytest.mark.parametrize("field", ["name", "full_name"])
def test_rejects_an_empty_required_name(team, field):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(**{field: ""}))


def test_accepts_an_empty_description(team):
    """Optional prose, unlike the required names beside it: the two must not be aligned."""
    assert FLTeam.model_validate(team(description="")).description == ""


@pytest.mark.parametrize("gruppe", ["X", "", "a", "AB", "1"])
def test_rejects_a_group_outside_a_to_d(team, gruppe):
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(gruppe=gruppe))


@pytest.mark.parametrize("gruppe", ["A", "B", "C", "D"])
def test_accepts_each_of_the_four_groups(team, gruppe):
    """So the rejection test above cannot be passing for the wrong reason."""
    assert FLTeam.model_validate(team(gruppe=gruppe)).gruppe == gruppe


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "example.com"])
def test_rejects_a_website_url_that_is_not_http(team, url):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url=url))


# Taken from the model rather than listed: a counter added without `ge=0` is the one nothing would ask about.
@pytest.mark.parametrize("field", list(FLTeamStatistik.model_fields))
def test_rejects_negative_statistics(team, statistik, field):
    """Computed by an aggregation, so an arithmetic error surfaces here."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(statistik=statistik(**{field: -1})))


@pytest.mark.parametrize("shorthand", ["C", "CSS", ""])
def test_rejects_a_shorthand_that_is_not_two_characters(team, shorthand):
    """The narrow cards render this instead of the full name, so the width is fixed."""
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(shorthand=shorthand))


class TestFLGruppen:
    """The frontend's `FLGruppenSchema` requires all four keys, so a map built from the teams present fails the parse."""

    def test_always_emits_all_four_groups(self, team):
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]

    def test_leaves_unpopulated_groups_as_empty_lists(self, team):
        """The empty groups are `[]`, not absent and not null."""
        grouped = build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES)

        assert len(grouped.root["A"]) == 1
        assert grouped.root["B"] == grouped.root["C"] == grouped.root["D"] == []

    def test_returns_all_four_groups_for_no_teams_at_all(self):
        grouped = build_gruppen([], spiele=[], rules=RULES)

        assert sorted(grouped.root) == ["A", "B", "C", "D"]
        assert all(members == [] for members in grouped.root.values())

    def test_the_serialised_response_body_carries_all_four_groups(self, team):
        """The wire shape, not the Python object: the frontend parses the response body."""
        response = FLTeamsGroupedResponse(
            gruppen=build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES),
            qualifiers_per_group=RULES.qualifiers_per_group,
        )

        body = response.model_dump()

        assert sorted(body["gruppen"]) == ["A", "B", "C", "D"]
        assert body["gruppen"]["B"] == []
        assert body["acknowledged"] == 1
        assert body["format"] == "grouped"
        # The cutoff rides with the table it applies to, so no page marks one season's standing with another's number.
        assert body["qualifiers_per_group"] == 2

    def test_a_row_carries_the_standings_fields_and_no_club_detail(self, team):
        """A public CLIENT component renders this, so every field listed is serialised into the page -- and an address here is a school's."""
        response = FLTeamsGroupedResponse(
            gruppen=build_gruppen([FLTeam.model_validate(team(gruppe="A"))], spiele=[], rules=RULES),
            qualifiers_per_group=RULES.qualifiers_per_group,
        )

        assert sorted(response.model_dump()["gruppen"]["A"][0]) == [
            "anzahl_ausstehende_spiele",
            "austritt_type",
            "id",
            "name",
            "shorthand",
            "statistik",
        ]

    def test_a_row_names_only_the_type_of_an_austritt(self, team):
        """`grund` is free text written for publication, and the club's own page is where it is published."""
        austritt = {"type": "rueckzug", "grund": "Zu wenige Spieler", "datum": "2026-03-14"}
        rows = build_gruppen([FLTeam.model_validate(team(gruppe="A", austritt=austritt))], spiele=[], rules=RULES).root["A"]

        assert rows[0].austritt_type == "rueckzug"

    # Validation already rejects these, so reaching the guard needs `model_construct`. `X` is why it
    # cannot test `not team.gruppe`: that catches empty and None and lets anything else `KeyError`.
    @pytest.mark.parametrize("gruppe", ["", "X", "a", " ", "AB"])
    def test_refuses_a_team_it_cannot_place(self, team, gruppe):
        """Fails loudly rather than dropping the team, which the frontend would discard from the table."""
        unplaceable = FLTeam.model_construct(**{**team(), "gruppe": gruppe})

        with pytest.raises(ValueError, match="not one of A/B/C/D"):
            build_gruppen([unplaceable], spiele=[], rules=RULES)


class TestFLTeamRecord:
    """`FLTeam` cannot be echoed by a write: its season-scoped fields come from a junction row, and a club with none 404s there."""

    def test_accepts_a_stored_club_document(self, team):
        parsed = FLTeamRecord.model_validate(team())

        assert str(parsed.id) == "6890a1b2c3d4e5f607182930"
        assert parsed.inactive_since is None

    def test_accepts_a_document_carrying_none_of_the_season_scoped_fields(self, team, address):
        """The case the write path produces: the same document validated against `FLTeam` fails on all three fields."""
        stored = {key: value for key, value in team().items() if key not in {"gruppe", "austritt", "statistik"}}

        assert FLTeamRecord.model_validate(stored).name == "Carl-Schurz"

        with pytest.raises(ValidationError):
            FLTeam.model_validate(stored)

    def test_carries_the_retirement_date(self, team):
        """`inactive_since` is what a soft delete writes, so the model a delete echoes has to carry it."""
        assert FLTeamRecord.model_validate(team(inactive_since="2026-03-01")).inactive_since == "2026-03-01"

    def test_shares_the_name_constraint(self, team, assert_rejects):
        assert_rejects(FLTeamRecord, team(name=""), "name")


class TestTheClubsSchulform:
    def test_a_club_stored_before_the_field_still_reads(self, team):
        """The whole reason the READ models default it: a required one would 500 the list over every club nobody has edited."""

        stored = team()
        del stored["schulform"]

        assert FLTeam.model_validate(stored).schulform is None

    def test_a_form_outside_the_set_is_refused(self, team):
        with pytest.raises(ValidationError):
            FLTeam.model_validate(team(schulform="grundschule"))

    def test_the_write_echo_declares_it_too(self, team):
        """One declaration on the writable base, so the payloads, the record and the read model cannot come to disagree."""

        assert FLTeamRecord.model_validate(team(schulform="gesamtschule")).schulform == "gesamtschule"

    @pytest.mark.parametrize("payload", [FLPostTeamPayload, FLPatchTeamPayload])
    def test_the_payloads_refuse_to_default_it(self, team, payload):
        """The club PATCH replaces wholesale too, so a defaulted key here would clear a school form and fan the clearing out as an edit."""

        body = {key: value for key, value in team().items() if key in payload.model_fields}
        del body["schulform"]

        with pytest.raises(ValidationError) as failure:
            payload.model_validate(body)

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["schulform"]


class TestTheJunctionPatchPayload:
    """It replaces every field it takes wholesale, so what it DEFAULTS is what a client can drop by accident."""

    @pytest.mark.parametrize("field", ["gruppe", "austritt", "trikot_farbe"])
    def test_every_writable_field_is_required(self, field):
        """An omitted key defaulting to `None` would reinstate a disqualified club or clear a colour nobody touched."""

        body = {"gruppe": "A", "austritt": None, "trikot_farbe": None}
        del body[field]

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamPayload.model_validate(body)

        assert [entry["loc"][-1] for entry in failure.value.errors()] == [field]

    def test_it_takes_the_three_fields_and_nothing_about_the_contacts(self):
        assert set(FLPatchSaisonTeamPayload.model_fields) == {"gruppe", "austritt", "trikot_farbe"}

    def test_a_contact_block_sent_here_is_refused(self):
        """`extra="forbid"`, so a stale client is a 422 rather than a block this endpoint never judged."""

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamPayload.model_validate({"gruppe": "A", "austritt": None, "trikot_farbe": None, "kontakte": None})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["kontakte"]

    def test_a_club_whose_stored_contacts_the_write_side_refuses_can_still_be_saved(self):
        """Why no `kontakte` on this payload: the bound is on the write side alone (`docs/backend/spec.md :: I36`).

        A round-tripped block would fail every save with errors on `kontakte.*` paths the club editor
        renders no field for, leaving no box to correct.
        """

        stored_but_unwritable = {
            "trainer": {**STORED_KONTAKTPERSON, "telefon": "nicht bekannt"},
            "ansprechperson": None,
            "stellvertretung": None,
            "trainer_ist_ansprechperson": False,
        }

        assert FLSaisonTeamKontakte.model_validate(stored_but_unwritable).trainer is not None
        with pytest.raises(ValidationError):
            FLSaisonTeamKontaktePayload.model_validate(stored_but_unwritable)

        parsed = FLPatchSaisonTeamPayload.model_validate({"gruppe": "B", "austritt": None, "trikot_farbe": None})

        assert parsed.gruppe == "B"


class TestTheContactsPatchPayload:
    """The block's own endpoint, which is where every rule about the three people now lives."""

    def test_a_contact_block_missing_one_of_the_three_people_is_refused(self):
        """The block is written whole or not at all, so a partial one is a form half filled in rather than a smaller truth."""

        with pytest.raises(ValidationError):
            FLPatchSaisonTeamKontaktePayload.model_validate({"kontakte": {"trainer_ist_ansprechperson": False}})

    def test_the_block_is_required_so_a_null_clears_it_deliberately(self):
        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonTeamKontaktePayload.model_validate({})

        assert [entry["loc"][-1] for entry in failure.value.errors()] == ["kontakte"]


class TestAContactRecordReadsBackHoweverItWasStored:
    """`docs/backend/spec.md :: I36`, on the model where breaking it locks itself in.

    The validator types these as bare strings, so an import can store a value no payload would take
    -- and `GET /teams/memberships` is the only route to repairing the row.
    """

    # A title's `.`, an address `EmailStr` refuses, and 21 characters where `PHONE_REGEX` allows 20
    # -- one per bound the payload adds, so no case below passes on another's refusal.
    REFUSED = {"nachname": "Dr. Koerner", "email": "not an address", "telefon": "+49 170 1234567 890 12"}

    ACCEPTED = {"nachname": "Koerner", "email": "a.koerner@example.de", "telefon": "+49 170 1234567"}

    STORED = {
        "vorname": "Anke",
        "geburtsdatum": "1984-05-09",
        "einwilligung": {"umfang": "kontaktdaten", "erteilt_von": "person", "text_version": "v1", "datum": "2026-01-15"},
        **REFUSED,
    }

    def test_the_read_model_takes_every_one_of_them(self):
        parsed = FLKontaktperson.model_validate(self.STORED)

        assert (parsed.nachname, parsed.email, parsed.telefon) == (self.REFUSED["nachname"], self.REFUSED["email"], self.REFUSED["telefon"])

    @pytest.mark.parametrize("field", sorted(REFUSED))
    def test_the_payload_refuses_it(self, field):
        """Non-vacuity: without this the case above would pass just as well over a payload that had stopped checking."""

        body = {**self.STORED, **self.ACCEPTED, field: self.REFUSED[field]}

        with pytest.raises(ValidationError) as failure:
            FLKontaktpersonPayload.model_validate(body)

        assert [entry["loc"][-1] for entry in failure.value.errors()] == [field]
