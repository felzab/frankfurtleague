from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, cast

import pytest
from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.api.saisons.schemas import FLSaisonRules
from app.api.spiele.crud import advance_bracket_winners, bracket_faults_of
from app.api.spiele.schemas import FLBracketFault, FLSpielJoinedInternalListAdapter
from app.core.readonly import ReadCollection
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT
from tests.documents import rules_document

MATCH_ID = "6890a1b2c3d4e5f60720{:04d}"
SAISON_ID = "2026"

PayloadFactory = Callable[..., dict[str, Any]]


def saison_of(spiel: PayloadFactory, count: int) -> list[dict[str, Any]]:
    """`count` group fixtures of one season, each with its own id and number so none collapses onto another."""

    return [spiel(_id=MATCH_ID.format(nr), spiel_nr=nr) for nr in range(1, count + 1)]


RULES = FLSaisonRules.model_validate(rules_document(max_kader_size=50, allowed_stufen=["E1", "E2"]))


class _SaisonCollection:
    """One collection, called as `pull_many_from_db` calls the driver: `find`, then `limit`, then `to_list`."""

    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self.documents = documents

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _SaisonCollection:
        return self

    def limit(self, count: int) -> _SaisonCollection:
        # Truncating rather than answering everything: this IS the silent loss under test.
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.documents if length is None else self.documents[:length]


def run_advance(collection: _SaisonCollection) -> None:
    """`asyncio.run`, as the rest of the suite drives an async function; no event-loop plugin is configured.

    The same stand-in serves as every collection: no fixture here carries a `quelle`, so nothing but
    the season is read.
    """

    asyncio.run(
        advance_bracket_winners(
            spiele_collection=cast(AsyncCollection, collection),
            teams_collection=cast(AsyncCollection, collection),
            saison_id=SAISON_ID,
            rules=RULES,
            session=cast(AsyncClientSession, object()),
        )
    )


class TestTheBracketWriteRefusesATruncatedSeason:
    """The resolution writes back what it derived, so a season it could not read whole is a wrong bracket committed."""

    def test_a_season_past_the_cap_is_refused(self, spiel):
        collection = _SaisonCollection(saison_of(spiel, LIST_LIMIT_DEFAULT + 1))

        with pytest.raises(ValueError, match=str(LIST_LIMIT_DEFAULT)):
            run_advance(collection)


class _Rows:
    """A collection answering every `find` with the same rows, whether `pull_many_from_db` limits the cursor or a caller lists it bare."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def find(self, filter: Any, projection: Any = None, collation: Any = None, session: Any = None) -> _Rows:
        return self

    def limit(self, count: int) -> _Rows:
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return self.rows


# One matchday per sweep below, so no case can pass on a fault another sweep raised about the same
# fixture.
CLASHING_SPIELTAG = "6890a1b2c3d4e5f607210001"
QUIET_SPIELTAG = "6890a1b2c3d4e5f607210002"
BRACKET_SPIELTAG = "6890a1b2c3d4e5f607210003"

TWICE_FIELDED = "6890a1b2c3d4e5f607220001"
DEPARTED = "6890a1b2c3d4e5f607220002"
BYSTANDER = "6890a1b2c3d4e5f607220003"
OPPONENT = "6890a1b2c3d4e5f607220004"

# Before the day every fixture below is played on, which is what makes the occupant a fault.
DEPARTURE = {"type": "disqualifikation", "reason": "Nicht angetreten", "date": "2026-03-01"}
SPIEL_DAY = "2026-03-15"

CLASHING_FIRST, CLASHING_SECOND, WITH_THE_DEPARTED, SEEDED_FROM_A_GROUP_NOT_RUN = 1, 2, 3, 4
AT_A_RETIRED_GROUND, REFEREED_FIRST, REFEREED_AN_HOUR_LATER = 5, 6, 7

# Their own matchdays, so no club on them makes a double entry the sweep above would report.
RETIRED_GROUND_SPIELTAG = "6890a1b2c3d4e5f607210004"
REFEREED_FIRST_SPIELTAG = "6890a1b2c3d4e5f607210005"
REFEREED_LATER_SPIELTAG = "6890a1b2c3d4e5f607210006"

RETIRED_GROUND = "6890a1b2c3d4e5f607230001"
RETIRED_ON = "2026-02-01"
TWICE_BOOKED_SCHIEDSRICHTER = "6890a1b2c3d4e5f607230002"

# Two groups, so the reference below names one this season does not run: a season offering every
# name `FLGruppenNames` spells could hold no such reference at all.
SWEPT_RULES = FLSaisonRules.model_validate(RULES.model_dump() | {"number_of_gruppen": 2})
UNRUN_GRUPPE = "D"


def _joined_side(team_id: str, name: str, austritt: dict[str, Any] | None = None) -> dict[str, Any]:
    """One side as `build_spiele_pipeline` serves it: the stored copy plus both spellings of the junction record joined onto it."""

    return {
        "team_id": team_id,
        "name": name,
        "shorthand": name[:3].upper(),
        "tore": None,
        "austritt": austritt,
        "austritt_type": None if austritt is None else austritt["type"],
    }


def faulted_saison(spiel: PayloadFactory) -> list[dict[str, Any]]:
    """One fixture per sweep, and only the last carries a `quelle`.

    The group it names is one this season does not run, so `resolve_bracket` is handed no standing
    and reports nothing: every fault below is some sweep's own.
    """

    def one_spiel(nr: int, spieltag_id: str, team1: dict[str, Any] | None, team2: dict[str, Any], **overrides: Any) -> dict[str, Any]:
        return spiel(
            **{
                "_id": MATCH_ID.format(nr),
                "spiel_nr": nr,
                "spieltag_id": spieltag_id,
                "saison_id": SAISON_ID,
                "date": SPIEL_DAY,
                "ergebnis": None,
                "team1": team1,
                "team2": team2,
                # Booked by none unless `overrides` books one: the factory's shared ground and referee
                # would otherwise double-book every fixture here against every other.
                "spielort": None,
                "schiedsrichter": None,
                "ansetzung_confirmed": None,
                "for_third_place": False,
                **overrides,
            }
        )

    return [
        one_spiel(CLASHING_FIRST, CLASHING_SPIELTAG, _joined_side(TWICE_FIELDED, "Adler"), _joined_side(BYSTANDER, "Bieber")),
        one_spiel(CLASHING_SECOND, CLASHING_SPIELTAG, _joined_side(TWICE_FIELDED, "Adler"), _joined_side(OPPONENT, "Cronberg")),
        one_spiel(WITH_THE_DEPARTED, QUIET_SPIELTAG, _joined_side(DEPARTED, "Dornbusch", DEPARTURE), _joined_side(BYSTANDER, "Bieber")),
        one_spiel(
            SEEDED_FROM_A_GROUP_NOT_RUN,
            BRACKET_SPIELTAG,
            None,
            _joined_side(OPPONENT, "Cronberg"),
            saison_phase="halbfinale",
            team1_quelle={"type": "gruppe", "gruppe": UNRUN_GRUPPE, "platz": 1},
        ),
        one_spiel(
            AT_A_RETIRED_GROUND,
            RETIRED_GROUND_SPIELTAG,
            _joined_side(BYSTANDER, "Bieber"),
            _joined_side(OPPONENT, "Cronberg"),
            spielort={
                "spielort_id": RETIRED_GROUND,
                "name": "Bezirkssportanlage West",
                "maps_link": "Bezirkssportanlage West",
                "mietpreis": 40,
            },
        ),
        one_spiel(
            REFEREED_FIRST,
            REFEREED_FIRST_SPIELTAG,
            _joined_side(BYSTANDER, "Bieber"),
            _joined_side(OPPONENT, "Cronberg"),
            time="18:00:00",
            schiedsrichter={"schiedsrichter_id": TWICE_BOOKED_SCHIEDSRICHTER, "name": "Anna Körner", "payment": 20},
        ),
        one_spiel(
            REFEREED_AN_HOUR_LATER,
            REFEREED_LATER_SPIELTAG,
            _joined_side(BYSTANDER, "Bieber"),
            _joined_side(OPPONENT, "Cronberg"),
            time="19:00:00",
            schiedsrichter={"schiedsrichter_id": TWICE_BOOKED_SCHIEDSRICHTER, "name": "Anna Körner", "payment": 20},
        ),
    ]


def sweep(spiel: PayloadFactory) -> list[FLBracketFault]:
    """`bracket_faults_of` over the corpus above, in the JOINED shape `build_spiele_pipeline` serves.

    What is under test is the wiring above that pipeline rather than the pipeline itself. The double-booking read is
    answered with the whole corpus: which of it clashes is the sweep's to judge, not the filter's.
    """

    spiele = faulted_saison(spiel)

    return asyncio.run(
        bracket_faults_of(
            spiele=FLSpielJoinedInternalListAdapter.validate_python(spiele),
            rules=SWEPT_RULES,
            saison_id=SAISON_ID,
            spiele_collection=cast(ReadCollection, _Rows(spiele)),
            teams_collection=cast(ReadCollection, _Rows([])),
            spielorte_collection=cast(ReadCollection, _Rows([{"_id": ObjectId(RETIRED_GROUND), "inactive_since": RETIRED_ON}])),
            schiedsrichter_collection=cast(ReadCollection, _Rows([])),
        )
    )


class TestTheFaultSweepReportsWhatItsSweepsFound:
    """That each sweep beside the walk is WIRED into the report.

    `bracket_faults_of` feeds the Übersicht alone, so a sweep whose result never
    reaches the return value is a fault the one page built to surface it never shows.
    """

    def test_every_sweep_reaches_the_report(self, spiel):
        """One equality over every fault, so the diff names the sweep whose result went missing."""

        faults = sorted((fault.reason, fault.spiel_nr) for fault in sweep(spiel))

        assert faults == [
            ("departed_occupant", WITH_THE_DEPARTED),
            ("double_booked", REFEREED_FIRST),
            ("double_booked", REFEREED_AN_HOUR_LATER),
            ("fielded_twice", CLASHING_FIRST),
            ("fielded_twice", CLASHING_SECOND),
            ("gruppe_not_run", SEEDED_FROM_A_GROUP_NOT_RUN),
            ("retired_booking", AT_A_RETIRED_GROUND),
        ]
