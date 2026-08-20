import asyncio
from typing import Any, Callable, cast

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import advance_bracket_winners, find_bracket_faults
from app.api.spiele.schemas import FLBracketFault, FLPatchSpielDataPayload, FLSpiel, FLSpielAdvancement, FLSpielListAdapter
from app.api.spiele.services import find_eligibility_refusal, find_result_removal_refusal, find_wiring_refusal, judge_spieltag_occupancy
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SAISON_ID = "2026"

# Well-formed, and deliberately outside every slice below: what is under test is the lookup, so an
# id that could not appear at all would prove nothing.
UNREAD_SPIEL_ID = ObjectId("6890a1b2c3d4e5f607209999")

PayloadFactory = Callable[..., dict[str, Any]]


def season_of(spiel: PayloadFactory, count: int) -> list[dict[str, Any]]:
    """`count` group fixtures of one season, each with its own id and number so none collapses onto another."""

    return [spiel(_id=MATCH_ID.format(nr), spiel_nr=nr) for nr in range(1, count + 1)]


@pytest.fixture
def season(spiel: PayloadFactory) -> list[FLSpiel]:
    return FLSpielListAdapter.validate_python(season_of(spiel, 2))


@pytest.fixture
def payload(spiel: PayloadFactory) -> FLPatchSpielDataPayload:
    """The no-op edit: every rule below turns on it, so a refusal reached here came from the lookup and nothing else."""

    stored = spiel()

    return FLPatchSpielDataPayload.model_validate({field: stored.get(field) for field in FLPatchSpielDataPayload.model_fields})


class TestARefusalNeverPermitsWhatItCannotSee:
    """Every refusal over a caller-supplied slice (`docs/backend/spec.md :: I45`).

    `patch_spiel_data` has already read the fixture by `_id`, so an absence here is a truncated or
    wrong-season slice: a broken contract, not a user error a 409 could describe.
    """

    def test_the_eligibility_refusal_refuses_to_judge(self, season, payload):
        with pytest.raises(ValueError, match=str(UNREAD_SPIEL_ID)):
            find_eligibility_refusal(UNREAD_SPIEL_ID, payload, season, {})

    def test_the_result_removal_refusal_refuses_to_judge(self, season, payload):
        with pytest.raises(ValueError, match=str(UNREAD_SPIEL_ID)):
            find_result_removal_refusal(UNREAD_SPIEL_ID, payload, season)

    def test_the_spieltag_occupancy_refuses_to_judge(self, season, payload):
        """An empty verdict here would plan no release and permit the save, which is the same fail-open in a different shape."""

        with pytest.raises(ValueError, match=str(UNREAD_SPIEL_ID)):
            judge_spieltag_occupancy(UNREAD_SPIEL_ID, payload, season)

    def test_the_wiring_refusal_refuses_to_judge(self, season, payload):
        with pytest.raises(ValueError, match=str(UNREAD_SPIEL_ID)):
            find_wiring_refusal(UNREAD_SPIEL_ID, payload, season)


RULES = FLSaisonRules.model_validate(
    {
        "win_points": 3,
        "draw_points": 1,
        "number_of_groups": 4,
        "teams_per_group": 4,
        "qualifiers_per_group": 2,
        "erlaubte_stufen": ["E1", "E2"],
    }
)


class _SeasonCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, then `limit`, then `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents

    def find(self, filter: Any, projection: Any = None, session: Any = None) -> "_SeasonCollection":
        return self

    def limit(self, count: int) -> "_SeasonCollection":
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


def run_advance(collection: _SeasonCollection) -> tuple[list[FLSpielAdvancement], list[FLBracketFault]]:
    """`asyncio.run`, as the rest of the suite drives an async function; no event-loop plugin is configured.

    The same stand-in serves as the teams collection: no fixture here carries a `quelle`, so no group
    standing is ever read.
    """

    return asyncio.run(
        advance_bracket_winners(
            spiele_collection=cast(AsyncIOMotorCollection, collection),
            teams_collection=cast(AsyncIOMotorCollection, collection),
            saison_id=SAISON_ID,
            rules=RULES,
            session=cast(AsyncIOMotorClientSession, object()),
        )
    )


class TestTheBracketWriteRefusesATruncatedSeason:
    """The resolution writes back what it derived, so a season it could not read whole is a wrong bracket committed."""

    def test_a_season_past_the_cap_is_refused(self, spiel):
        collection = _SeasonCollection(season_of(spiel, LIST_LIMIT_DEFAULT + 1))

        with pytest.raises(ValueError, match=str(LIST_LIMIT_DEFAULT)):
            run_advance(collection)

    def test_a_season_at_the_cap_still_resolves(self, spiel):
        """The boundary in the other direction: the largest readable season must not answer 500."""

        advanced, faults = run_advance(_SeasonCollection(season_of(spiel, LIST_LIMIT_DEFAULT)))

        assert (advanced, faults) == ([], [])


class _ArchiveCollections:
    """The fault sweep's two reads at once: `aggregate` answers the fixtures, `find`/`limit`/`to_list` the seasons."""

    def __init__(self, saisons: list[dict[str, Any]]) -> None:
        self.saisons = saisons

    def aggregate(self, pipeline: Any, session: Any = None) -> "_ArchiveCollections":
        return self

    def find(self, filter: Any, projection: Any = None, session: Any = None) -> "_ArchiveCollections":
        return self

    def limit(self, count: int) -> "_ArchiveCollections":
        self.saisons = self.saisons[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        # The fixture read arrives here with `length=None` and wants none; the season read is capped.
        return [] if length is None else self.saisons[:length]


class TestTheFaultSweepRefusesATruncatedArchive:
    """The other read that asks one past the cap: an unread season reports no faults, which reads as a clean season."""

    def test_an_archive_past_the_cap_is_refused(self):
        seasons = [{"_id": str(2000 + index), "rules": RULES.model_dump()} for index in range(LIST_LIMIT_DEFAULT + 1)]
        collections = _ArchiveCollections(seasons)

        with pytest.raises(ValueError, match=str(LIST_LIMIT_DEFAULT)):
            asyncio.run(
                find_bracket_faults(
                    spiele_collection=cast(AsyncIOMotorCollection, collections),
                    teams_collection=cast(AsyncIOMotorCollection, collections),
                    saisons_collection=cast(AsyncIOMotorCollection, collections),
                )
            )

    def test_an_archive_at_the_cap_is_swept(self):
        """The boundary the other way, so an off-by-one answers 500 for the largest readable archive rather than passing."""

        seasons = [{"_id": str(2000 + index), "rules": RULES.model_dump()} for index in range(LIST_LIMIT_DEFAULT)]

        faults, faulted = asyncio.run(
            find_bracket_faults(
                spiele_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons)),
                teams_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons)),
                saisons_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons)),
            )
        )

        assert (faults, faulted) == ([], [])
