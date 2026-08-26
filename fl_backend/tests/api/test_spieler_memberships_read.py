from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.database import Database

from app.api.spieler.schemas import (
    FLPatchSaisonSpielerPayload,
    FLPostSaisonSpielerPayload,
    FLSpieler,
    FLSpielerFilterParams,
    FLSpielerMembership,
    FLSpielerMembershipsResponse,
    FLSpielerPublic,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import build_spieler_memberships_pipeline, build_spieler_pipeline

SAISON = "2026"
PRIOR_SAISON = "2025"

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
    def test_it_filters_nothing_out(self):
        # No `$match` anywhere, the lookup included: a retired person, a retired row and a player in no
        # squad all belong in the admin list.
        stages = [next(iter(stage)) for stage in build_spieler_memberships_pipeline()]
        assert "$match" not in stages

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
            "is_nachgetragen": 1,
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
                "acknowledged": 1,
                "spieler": [
                    {
                        "_id": str(SPIELER_OIDS["Ohne"]),
                        "vorname": "Ohne",
                        "nachname": "Squad",
                        "inactive_since": None,
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
                    "memberships": [
                        {
                            "saison_id": SAISON,
                            "team_id": str(TEAM_OID),
                            "nummer": "7",
                            "position": "Sturm",
                            "stufe": "Q1",
                            "is_nachgetragen": False,
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
                "memberships": [
                    {
                        "saison_id": SAISON,
                        "team_id": str(TEAM_OID),
                        "nummer": None,
                        "position": None,
                        "stufe": None,
                        "is_nachgetragen": False,
                        "rolle": None,
                        "inactive_since": None,
                    }
                ],
            }
        )

        assert player.memberships[0].position is None
        assert player.memberships[0].stufe is None

    def test_a_membership_reads_a_row_that_carries_neither_flag(self):
        """`FLSpieler` defaults both for this reason, and this model reads the same rows: requiring them here would 500 the whole list."""
        player = FLSpielerWithMemberships.model_validate(
            {
                "_id": str(SPIELER_OIDS["Abel"]),
                "vorname": "Anna",
                "nachname": "Abel",
                "inactive_since": None,
                "memberships": [
                    {
                        "saison_id": SAISON,
                        "team_id": str(TEAM_OID),
                        "nummer": "7",
                        "position": "Mittelfeld",
                        "stufe": "Q1",
                        "inactive_since": None,
                    }
                ],
            }
        )

        assert (player.memberships[0].is_nachgetragen, player.memberships[0].rolle) == (False, None)

    def test_a_membership_defaults_match_the_flattened_read(self):
        """`FLSpielerMembership` and `FLSpieler` read the same collection: a default on one and not the other is the disagreement this pins."""
        for field in ("is_nachgetragen", "rolle"):
            assert FLSpielerMembership.model_fields[field].default == FLSpieler.model_fields[field].default

    @pytest.mark.parametrize("payload_model", [FLPostSaisonSpielerPayload, FLPatchSaisonSpielerPayload])
    @pytest.mark.parametrize("field", ["is_nachgetragen", "rolle"])
    def test_a_payload_keeps_both_squad_facts_required(self, payload_model, field):
        """The defaults belong to the read models: the patch `$set`s its dump, so one here strips an armband a form forgot to send."""
        assert payload_model.model_fields[field].is_required()


class TestWhichTierMayReadTheConsentRecord:
    """This one and no other. `tests/api/test_spieler_public_read.py` holds the base tier's own case; the SPLIT is what is pinned here."""

    def test_this_read_carries_it_and_the_base_tier_does_not(self):
        """Both halves in one assertion, because widening the base allow-list "for consistency" is exactly how the split would come undone."""
        assert "einwilligung" in FLSpielerWithMemberships.model_fields
        assert "einwilligung" not in FLSpielerPublic.model_fields

    def test_it_sits_on_the_person_and_not_on_the_squad_row(self):
        """Consent is given by somebody, and a season is not what they agreed to -- the same split `inactive_since` is on either side of."""
        assert "einwilligung" not in FLSpielerMembership.model_fields

    def test_this_read_defaults_it_where_the_stored_shape_requires_it(self):
        """`FLSpieler` describes a document nothing returns; this one validates live rows, so a bound is a 500 waiting to happen."""
        assert FLSpielerWithMemberships.model_fields["einwilligung"].default is None
        assert FLSpieler.model_fields["einwilligung"].is_required()


def _spieler(name: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "_id": SPIELER_OIDS[name],
        "vorname": name[0],
        "nachname": name,
        "inactive_since": inactive_since,
        "einwilligung": {
            "umfang": "kader_oeffentlich",
            "erteilt_von": "erziehungsberechtigt",
            "datum": "2026-01-15",
            "bestaetigt_am": "2026-01-20",
        },
    }


def _squad_row(name: str, saison_id: str, *, nummer: str | None, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "spieler_id": SPIELER_OIDS[name],
        "saison_id": saison_id,
        "team_id": TEAM_OID,
        "nummer": nummer,
        "position": "Mittelfeld",
        "stufe": "Q1",
        "is_nachgetragen": False,
        "rolle": None,
        "inactive_since": inactive_since,
    }


def _legacy_spieler(name: str) -> dict[str, Any]:
    """A person as written before the consent record existed: the key is ABSENT rather than null, which is the shape no backfill has reached."""
    person = _spieler(name)
    del person["einwilligung"]

    return person


def _legacy_squad_row(name: str, saison_id: str) -> dict[str, Any]:
    """A row as written before either field existed: the keys are ABSENT rather than empty, which is what the projection cannot supply."""
    row = _squad_row(name, saison_id, nummer="5")
    del row["is_nachgetragen"]
    del row["rolle"]

    return row


@pytest.fixture(scope="session")
def squads(mongo_database: Database) -> Database:
    """Its own corpus rather than `conftest.py`'s league: squads there would make the pipeline suites depend on rows they never mention.

    Only what this fixture seeds: `tests/api/conftest.py :: league` owns the rest of `fl_test`.
    """
    for collection in ("spieler", "saison_spieler"):
        mongo_database.drop_collection(collection)

    mongo_database.spieler.insert_many(
        [
            _spieler("Abel"),
            _legacy_spieler("Alt"),
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
            # Hung on a player who already holds a row, so no assertion above about who the corpus
            # contains has to move.
            _legacy_squad_row("Abel", PRIOR_SAISON),
        ]
    )

    return mongo_database


@pytest.mark.db
class TestTheMembershipsPipelineExecuted:
    def _by_surname(self, squads: Database) -> dict[str, FLSpielerWithMemberships]:
        raw = list(squads.spieler.aggregate(build_spieler_memberships_pipeline()))
        return {player.nachname or "": player for player in (FLSpielerWithMemberships.model_validate(row) for row in raw)}

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

    def test_a_row_written_before_the_two_fields_existed_still_reads(self, squads: Database):
        """The whole chain, because its middle is the surprise: `$project` with a `1` omits an absent key rather than nulling it."""
        raw = next(row for row in squads.spieler.aggregate(build_spieler_memberships_pipeline()) if row["nachname"] == "Abel")
        legacy = next(row for row in raw["memberships"] if row["saison_id"] == PRIOR_SAISON)

        assert "is_nachgetragen" not in legacy and "rolle" not in legacy

        rows = {row.saison_id: row for row in self._by_surname(squads)["Abel"].memberships}
        assert (rows[PRIOR_SAISON].is_nachgetragen, rows[PRIOR_SAISON].rolle) == (False, None)

    def test_the_consent_record_reaches_this_read_whole(self, squads: Database):
        """All four fields, through a real aggregation: nothing is projected at the root, so the record rides on the stored document."""
        consent = self._by_surname(squads)["Abel"].einwilligung

        assert consent is not None
        assert (consent.umfang, consent.erteilt_von) == ("kader_oeffentlich", "erziehungsberechtigt")
        assert (consent.datum, consent.bestaetigt_am) == ("2026-01-15", "2026-01-20")

    def test_a_person_stored_before_the_consent_record_existed_does_not_break_the_list(self, squads: Database):
        """The whole LIST, not the one row: every document goes through one model, so a refusal here is a 500 for everybody."""
        raw = next(row for row in squads.spieler.aggregate(build_spieler_memberships_pipeline()) if row["nachname"] == "Alt")

        assert "einwilligung" not in raw
        assert self._by_surname(squads)["Alt"].einwilligung is None
