from typing import Any

import pytest
from bson import ObjectId
from pydantic import ValidationError
from pymongo.database import Database

from app.api.spieler.schemas import (
    FLSpieler,
    FLSpielerFilterParams,
    FLSpielerMembershipsResponse,
    FLSpielerWithMemberships,
)
from app.api.spieler.services import build_spieler_memberships_pipeline, build_spieler_pipeline

SAISON = "2026"
PRIOR_SAISON = "2025"

SPIELER_OIDS = {
    "Abel": ObjectId("6890a1b2c3d4e5f607290001"),
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
            "is_captain": 1,
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
                            "is_captain": False,
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
                        "is_captain": False,
                        "inactive_since": None,
                    }
                ],
            }
        )

        assert player.memberships[0].position is None
        assert player.memberships[0].stufe is None


def _spieler(name: str, *, inactive_since: str | None = None) -> dict[str, Any]:
    return {
        "_id": SPIELER_OIDS[name],
        "vorname": name[0],
        "nachname": name,
        "inactive_since": inactive_since,
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
        "is_captain": False,
        "inactive_since": inactive_since,
    }


@pytest.fixture(scope="session")
def squads(mongo_database: Database) -> Database:
    """Its own corpus rather than `conftest.py`'s league: squads there would make the pipeline suites depend on rows they never mention."""
    for collection in ("spieler", "saison_spieler"):
        mongo_database.drop_collection(collection)

    mongo_database.spieler.insert_many(
        [
            _spieler("Abel"),
            # The person is retired and their squad row is not: the two are independent.
            _spieler("Baum", inactive_since="2026-05-01"),
            _spieler("Cordes"),
            _spieler("Ohne"),
        ]
    )

    mongo_database.saison_spieler.insert_many(
        [
            _squad_row("Abel", SAISON, nummer="7"),
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
        return {player.nachname or "": player for player in (FLSpielerWithMemberships.model_validate(row) for row in raw)}

    def test_it_returns_every_player_exactly_once(self, squads: Database):
        """One row per PERSON, including the one who plays two seasons — the unwind's failure, undone."""
        players = self._by_surname(squads)

        assert sorted(players) == ["Abel", "Baum", "Cordes", "Ohne"]
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

    def test_the_order_is_by_forename(self, squads: Database):
        raw = list(squads.spieler.aggregate(build_spieler_memberships_pipeline()))

        assert [row["vorname"] for row in raw] == ["A", "B", "C", "O"]
