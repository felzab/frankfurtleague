from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.database import Database

from app.api.spieler.schemas import (
    FLEinwilligung,
    FLPatchSaisonSpielerPayload,
    FLPatchSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLSpieler,
    FLSpielerFilterParams,
    FLSpielerMembership,
    FLSpielerMembershipsResponse,
    FLSpielerPublic,
    FLSpielerSingleResponse,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import build_real_spieler_filter, build_spieler_memberships_pipeline, build_spieler_pipeline
from app.shared.folding import sign_in_identifier
from tests.documents import eigene_einwilligung_document, saison_spieler_document, spieler_document

SAISON = "2026"
PRIOR_SAISON = "2025"

# The address a person typed, and the form a row stores. Spelled out rather than computed, so a
# folding that moved parts from this corpus instead of moving it.
TYPED_ADDRESS = "Wiltrudis@Schule.DE "
STORED_ADDRESS = "wiltrudis@schule.de"

SPIELER_OIDS = {
    "Abel": ObjectId("6890a1b2c3d4e5f607290001"),
    # Shares a forename with Abel, so the sort's second key is exercised rather than only declared.
    "Alt": ObjectId("6890a1b2c3d4e5f607290005"),
    "Baum": ObjectId("6890a1b2c3d4e5f607290002"),
    # Two seasons — the case `FLSpieler` cannot report and this endpoint must.
    "Cordes": ObjectId("6890a1b2c3d4e5f607290003"),
    # No squad row at all: a player created by the admin form before being given one.
    "Ohne": ObjectId("6890a1b2c3d4e5f607290004"),
}

TEAM_OID = ObjectId("6890a1b2c3d4e5f607190001")


class TestTheMembershipsPipeline:
    def test_it_filters_out_the_sentinel_alone(self):
        # No `$match` but the sentinel's, the lookup included: a retired person, a retired row and a
        # player in no squad all belong in the admin list.
        matches = [stage["$match"] for stage in build_spieler_memberships_pipeline() if "$match" in stage]
        assert matches == [build_real_spieler_filter()]

        lookup = next(stage["$lookup"] for stage in build_spieler_memberships_pipeline() if "$lookup" in stage)
        assert all("$match" not in inner for inner in lookup["pipeline"])

    def test_it_does_not_unwind(self):
        """Unwinding turns one player with two squad rows into two rows nothing can tell apart, because `FLSpieler` carries no `saison_id`."""
        stages = [next(iter(stage)) for stage in build_spieler_memberships_pipeline()]
        assert "$unwind" not in stages

    def test_the_lookup_projects_the_junction_row_including_its_retirement(self):
        lookup = next(stage["$lookup"] for stage in build_spieler_memberships_pipeline() if "$lookup" in stage)
        assert lookup["from"] == "saison_spieler"
        assert lookup["pipeline"][0]["$project"] == {
            "_id": 0,
            "saison_id": 1,
            "team_id": 1,
            "nummer": 1,
            "position": 1,
            "stufe": 1,
            "ist_nachnominiert": 1,
            "rolle": 1,
            # A squad row really can be retired, unlike a team junction row, and dropping this makes it look live.
            "inactive_since": 1,
        }

    def test_it_sorts_by_forename_then_surname(self):
        assert build_spieler_memberships_pipeline()[-1] == {"$sort": {"vorname": 1, "nachname": 1}}


class TestWhyTheSeasonScopedReadCannotAnswerIt:
    """Three ways `GET /spieler` fails the admin list, as assertions — and the last two fail silently."""

    def test_a_named_season_makes_the_junction_join_strict(self):
        """A player with no row for that season is dropped, so the list cannot offer to give them one."""
        pipeline = build_spieler_pipeline(FLSpielerFilterParams(saison_id=SAISON))
        unwind = next(stage["$unwind"] for stage in pipeline if "$unwind" in stage)
        assert unwind["preserveNullAndEmptyArrays"] is False

    def test_an_unscoped_read_keeps_a_player_who_has_no_squad_row(self):
        """Kept by the pipeline — and then unusable, which is the next case."""
        pipeline = build_spieler_pipeline(FLSpielerFilterParams())
        unwind = next(stage["$unwind"] for stage in pipeline if "$unwind" in stage)
        assert unwind["preserveNullAndEmptyArrays"] is True

    def test_a_player_with_no_squad_row_does_not_validate_as_flspieler(self):
        """`FLSpieler` is the flattened shape, so `team_id` is required: one player with no squad row 500s the whole response."""
        with pytest.raises(ValidationError) as failure:
            FLSpieler.model_validate(
                {
                    "_id": SPIELER_OIDS["Ohne"],
                    "vorname": "Ohne",
                    "nachname": "Squad",
                    "inactive_since": None,
                }
            )

        assert "team_id" in str(failure.value)

    def test_flspieler_carries_no_saison_id(self):
        """Two seasons therefore flatten to two rows a caller cannot tell apart."""
        assert "saison_id" not in FLSpieler.model_fields


class TestTheResponseModel:
    def test_a_player_with_no_squad_row_is_valid(self):
        response = FLSpielerMembershipsResponse.model_validate(
            {
                "spieler": [
                    {
                        "_id": str(SPIELER_OIDS["Ohne"]),
                        "vorname": "Ohne",
                        "nachname": "Squad",
                        "inactive_since": None,
                        "geburtsdatum": "2009-05-04",
                        "einwilligung": EINWILLIGUNG,
                        "email": STORED_ADDRESS,
                        "adresswechsel_id": None,
                        "adresswechsel_einsehbar_verwehrt": None,
                        "memberships": [],
                    }
                ],
            }
        )

        assert response.spieler[0].memberships == []

    def test_a_membership_refuses_a_position_outside_the_closed_set(self):
        """The closed set at the read boundary: `Sturm` is a spelling outside it."""
        with pytest.raises(ValidationError):
            FLSpielerWithMemberships.model_validate(
                {
                    "_id": str(SPIELER_OIDS["Abel"]),
                    "vorname": "Anna",
                    "nachname": "Abel",
                    "inactive_since": None,
                    "geburtsdatum": "2009-05-04",
                    "einwilligung": EINWILLIGUNG,
                    "email": STORED_ADDRESS,
                    "adresswechsel_id": None,
                    "adresswechsel_einsehbar_verwehrt": None,
                    "memberships": [
                        {
                            "saison_id": SAISON,
                            "team_id": str(TEAM_OID),
                            "nummer": "7",
                            "position": "Sturm",
                            "stufe": "Q1",
                            "ist_nachnominiert": False,
                            "rolle": None,
                            "inactive_since": None,
                        }
                    ],
                }
            )

    def test_a_membership_accepts_a_null_position_and_stufe(self):
        """A squad entry is filled in over time, so both stay nullable."""
        player = FLSpielerWithMemberships.model_validate(
            {
                "_id": str(SPIELER_OIDS["Abel"]),
                "vorname": "Anna",
                "nachname": "Abel",
                "inactive_since": None,
                "geburtsdatum": "2009-05-04",
                "einwilligung": EINWILLIGUNG,
                "email": STORED_ADDRESS,
                "adresswechsel_id": None,
                "adresswechsel_einsehbar_verwehrt": None,
                "memberships": [
                    {
                        "saison_id": SAISON,
                        "team_id": str(TEAM_OID),
                        "nummer": None,
                        "position": None,
                        "stufe": None,
                        "ist_nachnominiert": False,
                        "rolle": None,
                        "inactive_since": None,
                    }
                ],
            }
        )

        assert player.memberships[0].position is None
        assert player.memberships[0].stufe is None

    def test_a_payload_refuses_the_marker(self):
        """The create derives it and nothing edits it, so a sent marker is refused rather than silently stored or dropped."""

        with pytest.raises(ValidationError) as failure:
            FLPatchSaisonSpielerPayload.model_validate(
                {
                    # Both ids ride in the path, so naming either here is an extra of its own and
                    # would satisfy this assertion without the marker being read at all.
                    "team_id": str(TEAM_OID),
                    "nummer": "7",
                    "position": "Mittelfeld",
                    "stufe": "Q1",
                    "ist_nachnominiert": True,
                    "rolle": None,
                }
            )

        assert [(entry["type"], entry["loc"][-1]) for entry in failure.value.errors()] == [("extra_forbidden", "ist_nachnominiert")]

    @pytest.mark.parametrize("payload_model", [FLPostSaisonSpielerPayload, FLPatchSaisonSpielerPayload])
    def test_a_payload_keeps_the_role_required(self, payload_model):
        """The patch `$set`s its dump, so a default here strips an armband a form forgot to send."""
        assert payload_model.model_fields["rolle"].is_required()

    @pytest.mark.parametrize("payload_model", [FLPostSaisonSpielerPayload, FLPatchSaisonSpielerPayload])
    def test_no_payload_declares_the_marker(self, payload_model):
        """Declared, even defaulted, the create would store a caller's claim about when the entry arrived.

        The backend makes the marker the create's own derivation.
        """
        assert "ist_nachnominiert" not in payload_model.model_fields


class TestWhichTierMayReadTheConsentRecord:
    """This one and no other. `tests/api/test_spieler_public_read.py` holds the base tier's own case; the SPLIT is what is pinned here."""

    def test_this_read_carries_it_and_the_base_tier_does_not(self):
        """Both halves in one assertion, because widening the base allow-list "for consistency" is exactly how the split would come undone."""
        assert "einwilligung" in FLSpielerWithMemberships.model_fields
        assert "einwilligung" not in FLSpielerPublic.model_fields

    def test_it_sits_on_the_person_and_not_on_the_squad_row(self):
        """Consent is given by somebody, and a season is not what they agreed to -- the same split `inactive_since` is on either side of."""
        assert "einwilligung" not in FLSpielerMembership.model_fields


class TestTheAddressASignedInPersonIsJoinedOn:
    """The field itself, whose one writer is the admission. What a read may serve and what a payload may carry are what this tier decides."""

    def test_this_read_carries_it_and_the_base_tier_does_not(self):
        """Both halves in one assertion, as the consent record's split is: an address is the person's and a squad list is read by anybody."""
        assert "email" in FLSpielerWithMemberships.model_fields
        # Both base-tier shapes, the list's row and the single read's body: each is its own
        # allow-list, so one widened alone would serve the address on one path and not the other.
        assert "email" not in FLSpielerPublic.model_fields
        assert "email" not in FLSpielerSingleResponse.model_fields

    def test_it_sits_on_the_person_and_not_on_the_squad_row(self):
        """One mailbox for one person across every season, so a junction row carrying it would be a copy per season to keep in step."""
        assert "email" not in FLSpielerMembership.model_fields

    def test_the_stored_form_is_the_folding_s_own_output(self):
        """What makes the seam an equality: an address stored as typed sits beside the folded one a sign-in produces and matches nothing."""
        assert sign_in_identifier(TYPED_ADDRESS) == STORED_ADDRESS

    def test_no_administrator_payload_takes_one(self, assert_rejects):
        """The refusal IS the posture: a mistyped address is corrected by registering again, and a route accepting one would undo that."""
        assert "email" not in FLPatchSpielerPayload.model_fields

        names = {"vorname": "Wiltrudis", "nachname": "Meier", "geburtsdatum": "2009-05-04"}

        assert FLPatchSpielerPayload.model_validate(names).vorname == "Wiltrudis"
        assert_rejects(FLPatchSpielerPayload, {**names, "email": STORED_ADDRESS}, "email")


# Passed rather than defaulted: `test_the_consent_record_reaches_this_read_whole` reads it back.
EINWILLIGUNG = eigene_einwilligung_document(text_version="v1", bestaetigt_am="2026-01-20")


def _spieler(name: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return spieler_document(
        SPIELER_OIDS[name], name[0], name, einwilligung=EINWILLIGUNG, email=f"{name.lower()}@schule.de", inactive_since=inactive_since
    )


def _squad_row(name: str, saison_id: str, *, nummer: str | None, inactive_since: str | None = None) -> dict[str, Any]:
    return saison_spieler_document(
        SPIELER_OIDS[name], saison_id, TEAM_OID, nummer=nummer, position="Mittelfeld", stufe="Q1", inactive_since=inactive_since
    )


@pytest.fixture(scope="session")
def squads(mongo_database: Database) -> Database:
    """Its own corpus rather than `conftest.py`'s league: squads there would make the pipeline suites depend on rows they never mention.

    Only what this fixture seeds: `tests/api/conftest.py :: league` owns the rest of `fl_test`.
    """
    for collection in ("spieler", "saison_spieler"):
        mongo_database.drop_collection(collection)

    mongo_database.spieler.insert_many(
        [
            {**_spieler("Abel"), "email": STORED_ADDRESS},
            _spieler("Alt"),
            # The person is retired and their squad row is not: the two are independent.
            _spieler("Baum", inactive_since="2026-05-01"),
            _spieler("Cordes"),
            _spieler("Ohne"),
        ]
    )

    mongo_database.saison_spieler.insert_many(
        [
            _squad_row("Abel", SAISON, nummer="7"),
            _squad_row("Alt", SAISON, nummer="4"),
            _squad_row("Baum", SAISON, nummer="3"),
            # Two seasons for one person — the case the flattened read reports as two players.
            _squad_row("Cordes", SAISON, nummer="11"),
            # The row is retired while the person plays on — independent in the other direction.
            _squad_row("Cordes", PRIOR_SAISON, nummer="9", inactive_since="2025-11-30"),
        ]
    )

    return mongo_database


@pytest.mark.db
class TestTheMembershipsPipelineExecuted:
    def _by_surname(self, squads: Database) -> dict[str, FLSpielerWithMemberships]:
        raw = list(squads.spieler.aggregate(build_spieler_memberships_pipeline()))
        # With the key the read composes after the pipeline (`app/api/spieler/admin_router.py :: get_spieler_memberships`).
        parsed = (FLSpielerWithMemberships.model_validate({**row, "adresswechsel_einsehbar_verwehrt": None}) for row in raw)
        return {player.nachname or "": player for player in parsed}

    def test_it_returns_every_player_exactly_once(self, squads: Database):
        """One row per PERSON, including the one who plays two seasons — the unwind's failure, undone."""
        players = self._by_surname(squads)

        assert sorted(players) == ["Abel", "Alt", "Baum", "Cordes", "Ohne"]
        assert len(players["Cordes"].memberships) == 2

    def test_a_player_with_no_squad_row_comes_back_with_an_empty_list(self, squads: Database):
        """Not dropped and not malformed — which is what makes the create-then-enter flow possible."""
        assert self._by_surname(squads)["Ohne"].memberships == []

    def test_a_retired_person_is_returned_with_their_squad_row(self, squads: Database):
        players = self._by_surname(squads)

        assert players["Baum"].inactive_since == "2026-05-01"
        assert [row.saison_id for row in players["Baum"].memberships] == [SAISON]

    def test_a_retired_squad_row_is_returned_and_says_so(self, squads: Database):
        """Hiding it would leave no way back: a second create is a 409 against the index the retired row still holds."""
        rows = {row.saison_id: row for row in self._by_surname(squads)["Cordes"].memberships}

        assert rows[PRIOR_SAISON].inactive_since == "2025-11-30"
        assert rows[SAISON].inactive_since is None
        # Reactivating preserves what the retired row carries, so the number has to survive the read.
        assert rows[PRIOR_SAISON].nummer == "9"

    def test_the_order_is_by_forename_then_surname(self, squads: Database):
        """Two people share a forename here, so the second key really decides an order rather than being carried untested."""
        raw = list(squads.spieler.aggregate(build_spieler_memberships_pipeline()))

        assert [row["vorname"] for row in raw] == ["A", "A", "B", "C", "O"]
        assert [row["nachname"] for row in raw][:2] == ["Abel", "Alt"]

    def test_the_consent_record_reaches_this_read_whole(self, squads: Database):
        """Through a real aggregation: nothing is projected at the root, so the record rides on the stored document."""

        assert self._by_surname(squads)["Abel"].einwilligung == FLEinwilligung.model_validate(EINWILLIGUNG)

    def test_the_stored_address_reaches_this_read_in_the_form_it_was_stored(self, squads: Database):
        """Through a real aggregation: the root is unprojected, so a key added to the document rides along, and this tier is where it may."""
        assert self._by_surname(squads)["Abel"].email == STORED_ADDRESS
