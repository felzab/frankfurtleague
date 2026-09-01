import asyncio
from typing import Any, Callable, cast

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import advance_bracket_winners, find_bracket_faults
from app.api.spiele.schemas import FLBracketFault, FLPatchSpielDataPayload, FLSpiel, FLSpielAdvancement, FLSpielListAdapter
from app.api.spiele.services import (
    ResolvedReferences,
    find_booking_refusal,
    find_eligibility_refusal,
    find_result_removal_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
)
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.payloads import spiel_patch_body

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

    return FLPatchSpielDataPayload.model_validate(spiel_patch_body(stored))


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

    def test_the_booking_refusal_refuses_to_judge(self, season, payload):
        """It compares the payload's references against the STORED ones, so a slice without them judges a move it cannot see."""

        with pytest.raises(ValueError, match=str(UNREAD_SPIEL_ID)):
            find_booking_refusal(UNREAD_SPIEL_ID, payload, season, ResolvedReferences(teams={}))


RULES = FLSaisonRules.model_validate(
    {
        "win_points": 3,
        "draw_points": 1,
        "number_of_groups": 4,
        "teams_per_group": 4,
        "qualifiers_per_group": 2,
        "tiebreak_order": "tordifferenz",
        "max_kadergroesse": 50,
        "forfeit_ergebnis": {"sieger_tore": 3, "verlierer_tore": 0},
        "erlaubte_stufen": ["E1", "E2"],
    }
)


class _SeasonCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, then `limit`, then `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> "_SeasonCollection":
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

    def __init__(self, saisons: list[dict[str, Any]], spiele: list[dict[str, Any]] | None = None) -> None:
        self.saisons = saisons
        # The JOINED shape, because `build_spiele_pipeline` is what the real read runs; what is under
        # test here is the wiring above that pipeline rather than the pipeline itself.
        self.spiele = spiele or []

    def aggregate(self, pipeline: Any, collation: Any = None, session: Any = None) -> "_ArchiveCollections":
        return self

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> "_ArchiveCollections":
        return self

    def limit(self, count: int) -> "_ArchiveCollections":
        self.saisons = self.saisons[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        # The fixture read arrives here with `length=None`; the season read is capped.
        return self.spiele if length is None else self.saisons[:length]


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


# Two clashing appearances on one matchday, and a departure on another: the two sweeps that sit
# BESIDE the bracket walk, so neither can ride on a `resolve_bracket` fault.
CLASHING_SPIELTAG = "6890a1b2c3d4e5f607210001"
QUIET_SPIELTAG = "6890a1b2c3d4e5f607210002"

TWICE_FIELDED = "6890a1b2c3d4e5f607220001"
DEPARTED = "6890a1b2c3d4e5f607220002"
BYSTANDER = "6890a1b2c3d4e5f607220003"
OPPONENT = "6890a1b2c3d4e5f607220004"

# Before the day every fixture below is played on, which is what makes the occupant a fault.
DEPARTURE = {"type": "disqualifikation", "grund": "Nicht angetreten", "datum": "2026-03-01"}
FIXTURE_DAY = "2026-03-15"

CLASHING_FIRST, CLASHING_SECOND, WITH_THE_DEPARTED = 1, 2, 3


def _joined_side(team_id: str, name: str, austritt: dict[str, Any] | None = None) -> dict[str, Any]:
    """One side as `build_spiele_pipeline` serves it: the stored copy plus both spellings of the junction record joined onto it."""

    return {
        "team_id": team_id,
        "name": name,
        "shorthand": name[:2].upper(),
        "tore": None,
        "austritt": austritt,
        "austritt_type": None if austritt is None else austritt["type"],
    }


def faulted_archive(spiel: PayloadFactory) -> list[dict[str, Any]]:
    """One club fielded twice on one matchday, and one fixture fielding a club that had already left.

    Group fixtures with no `quelle`, so the bracket walk finds nothing and every fault reported comes
    from a sweep beside it.
    """

    def fixture(nr: int, spieltag_id: str, team1: dict[str, Any], team2: dict[str, Any]) -> dict[str, Any]:
        return spiel(
            _id=MATCH_ID.format(nr),
            spiel_nr=nr,
            spieltag_id=spieltag_id,
            saison_id=SAISON_ID,
            datum=FIXTURE_DAY,
            ergebnis=None,
            team1=team1,
            team2=team2,
        )

    return [
        fixture(CLASHING_FIRST, CLASHING_SPIELTAG, _joined_side(TWICE_FIELDED, "Adler"), _joined_side(BYSTANDER, "Bieber")),
        fixture(CLASHING_SECOND, CLASHING_SPIELTAG, _joined_side(TWICE_FIELDED, "Adler"), _joined_side(OPPONENT, "Cronberg")),
        fixture(WITH_THE_DEPARTED, QUIET_SPIELTAG, _joined_side(DEPARTED, "Dornbusch", DEPARTURE), _joined_side(BYSTANDER, "Bieber")),
    ]


def sweep(spiel: PayloadFactory) -> tuple[list[FLBracketFault], list[Any]]:
    """`find_bracket_faults` over the corpus above, with the season row its second read needs."""

    seasons = [{"_id": SAISON_ID, "rules": RULES.model_dump()}]
    spiele = faulted_archive(spiel)

    return asyncio.run(
        find_bracket_faults(
            spiele_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons, spiele)),
            teams_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons, spiele)),
            saisons_collection=cast(AsyncIOMotorCollection, _ArchiveCollections(seasons, spiele)),
        )
    )


class TestTheFaultSweepReportsWhatItsSweepsFound:
    """That both derivations are WIRED into the report, not merely written.

    `find_bracket_faults` feeds `GET /spiele/action_required` alone, so a sweep whose result never
    reaches the return value is a fault the one page built to surface it never shows.
    """

    def test_a_stored_double_entry_is_reported(self, spiel):
        faults, _ = sweep(spiel)
        fielded_twice = [fault for fault in faults if fault.reason == "fielded_twice"]

        assert [fault.spiel_nr for fault in fielded_twice] == [CLASHING_FIRST, CLASHING_SECOND]

    def test_a_departed_occupant_is_reported(self, spiel):
        """The other sweep beside the walk, because a report carrying one of the two would still look wired."""

        faults, _ = sweep(spiel)
        departed = [fault for fault in faults if fault.reason == "departed_occupant"]

        assert [fault.spiel_nr for fault in departed] == [WITH_THE_DEPARTED]

    def test_every_faulted_fixture_is_attached_to_the_report(self, spiel):
        """The second half of the answer: a surface renders the fixture a fault names, so an unattached one has nothing to draw."""

        _, faulted = sweep(spiel)

        assert sorted(spiel.spiel_nr for spiel in faulted) == [CLASHING_FIRST, CLASHING_SECOND, WITH_THE_DEPARTED]

    def test_the_bracket_walk_contributes_nothing_to_this_corpus(self, spiel):
        """So neither case above can be passing on a fault the walk raised about the same fixture."""

        faults, _ = sweep(spiel)

        assert {fault.reason for fault in faults} == {"fielded_twice", "departed_occupant"}
