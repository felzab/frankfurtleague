import math
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from http import HTTPStatus
from typing import Any, Final, Literal

from app.api.saisons.schemas import FLSaisonRules
from app.api.spielbestaetigungen.services import ANSETZUNG_QUELLEN, build_closable_filter, party_key
from app.api.spiele.schemas import (
    PHASE_RANK,
    SONDEREREIGNIS_KEEPING_ITS_SLOT,
    SONDEREREIGNIS_NO_SHOW,
    SONDEREREIGNIS_PRODUCING_A_RECORD,
    SONDEREREIGNIS_WITHOUT_A_RESULT,
    FLBracketFault,
    FLBracketFaultBooking,
    FLBracketFaultClash,
    FLBracketFaultGruppe,
    FLBracketFaultOccupant,
    FLBracketFaultQuelle,
    FLBracketFaultSlot,
    FLBracketFaultSpiel,
    FLBracketFaultSpieltag,
    FLPatchSpielDataPayload,
    FLSpiel,
    FLSpielCommon,
    FLSpielElfmeterschiessen,
    FLSpielJoinedAdmin,
    FLSpielJoinedInternal,
    FLSpielortFieldPayload,
    FLSpielortFieldRecord,
    FLSpielQuelle,
    FLSpielQuelleGruppe,
    FLSpielQuelleSpiel,
    FLSpielRecipient,
    FLSpielRecipientListAdapter,
    FLSpielSchiedsrichterFieldPayload,
    FLSpielSchiedsrichterFieldRecord,
    FLSpielSlotHolder,
    FLSpielTeamField,
    FLSpielTeamFieldJoinedInternal,
    FLSpielTeamFieldPayload,
    FLSpielVoidedResult,
    is_unplayed,
    records_an_absence,
)
from app.api.teams.services import DecidedStanding, in_the_season_when_decided, is_played, offered_gruppen
from app.core.codes import Code
from app.core.collections import Collection
from app.core.exceptions import FieldPath, WriteRefusal
from app.shared.einwilligung import NAME_IS_PUBLIC
from app.shared.schemas.custom import CustomObjectId
from app.shared.schemas.literals import FLGruppenNames, FLSonderereignis, FLSpielSide

SAISON_TEAMS_AS_NAME = "saison_teams_rows"


def _joined_side(side: FLSpielSide) -> Mapping[str, Any]:
    """One side with its season row folded in. `$mergeObjects`, never a rebuilt object: listing the keys copies `FLSpielTeamField`."""

    # Not `$getField`, which needs MongoDB 5.0: the test tier's container cannot speak for the
    # production server's version.
    matching_row = {"$filter": {"input": f"${SAISON_TEAMS_AS_NAME}", "cond": {"$eq": ["$$this.team_id", f"${side}.team_id"]}}}
    # One `$let` for every key, so the name a side is served under and the way its club left can never
    # be answered off different rows. Merged last, so the row's name wins over anything the document holds.
    joined_state = {
        "$let": {
            "vars": {"row": {"$first": matching_row}},
            "in": {
                "name": "$$row.name",
                "shorthand": "$$row.shorthand",
                "austritt": {"$ifNull": ["$$row.austritt", None]},
                # A field path on a null or absent record resolves to missing, which `$ifNull` reads
                # as "no way out recorded" -- the same answer the null record itself gives.
                "austritt_type": {"$ifNull": ["$$row.austritt.type", None]},
            },
        }
    }

    return {
        "$cond": [
            # `$eq` against null also catches a document missing the key, so an unresolved slot
            # never becomes an object holding only an austritt.
            {"$eq": [f"${side}", None]},
            None,
            {"$mergeObjects": [f"${side}", joined_state]},
        ]
    }


SPIELBESTAETIGUNGEN_AS_NAME = "spielbestaetigungen_rows"

# The served verdict's key, which `FLSpielJoined` declares and no stored shape does.
ANSETZUNG_CONFIRMED = "ansetzung_confirmed"


# Each joined row's marks: whether it is about the Ansetzung the fixture stands at now, and whether the team
# verdict counts it as its club's agreement.
_CURRENT = "current"
_TEAM_AGREED = "team_agreed"


def _confirmations_lookup() -> Mapping[str, Any]:
    """Every unclosed row and every referee's answer, marked on the five stored snapshot values, never on `ansetzung.digest`.

    No aggregation recomputes the digest, so an answer stops counting at a move, not at the hourly close.
    """

    current = {"$and": [{"$eq": [f"$ansetzung.{key}", f"$${key}"]} for key in ANSETZUNG_QUELLEN]}

    return {
        "$lookup": {
            "from": Collection.SPIELBESTAETIGUNGEN,
            "let": {
                "spiel_saison_id": "$saison_id",
                "spiel_id": "$_id",
                # `$ifNull`, not the bare path: an absent ground leaves `$spielort.spielort_id` missing, which
                # equals no stored null, and `compose_ansetzung` stores a null there.
                **{key: {"$ifNull": [f"${path}", None]} for key, path in ANSETZUNG_QUELLEN.items()},
            },
            "pipeline": [
                {
                    "$match": {
                        # Answered rows too: `build_answerable_filter` would drop every agreement. And a club's
                        # discarded proposal, the league having kept the date: left out, the club reads as never asked.
                        "$or": [
                            build_closable_filter(),
                            {"party.kind": "team", "closed.reason": "discarded"},
                            # A referee's every answer, closed or not, so their own decline is told from an answer since.
                            {"party.kind": "schiedsrichter", "answer": {"$ne": None}},
                        ],
                        "$expr": {
                            "$and": [
                                # The two keys `spielbestaetigungen_saison_id_spiel_id` leads with: without
                                # them every fixture of the most-read endpoint scans the collection.
                                {"$eq": ["$saison_id", "$$spiel_saison_id"]},
                                {"$eq": ["$spiel_id", "$$spiel_id"]},
                                # A discard about an Ansetzung the fixture has left settles nothing, as the close
                                # would have shut an unclosed row about it; a referee's decline stands whatever moved since.
                                {"$or": [{"$eq": ["$closed", None]}, {"$ne": ["$party.kind", "team"]}, current]},
                            ]
                        },
                    }
                },
                # No seat, no hash, no `reason`: the verdict is what leaves the join. The club's id
                # is the fixture's own side id, public already, and lets the verdict count clubs, not rows.
                {
                    "$project": {
                        "party.kind": 1,
                        "party.team_id": 1,
                        # A club's only closed rows the match admits are its discards.
                        _TEAM_AGREED: {"$or": [{"$eq": ["$answer.kind", "agreed"]}, {"$ne": ["$closed", None]}]},
                        _CURRENT: current,
                        # The referee gate's own inputs: their id tells the booked referee's rows from a replaced
                        # one's; the close tells their open rows from their closed answers, which the pass-minted id orders.
                        "_id": 1,
                        "party.schiedsrichter_id": 1,
                        "closed": 1,
                        "answer.kind": 1,
                    }
                },
            ],
            "as": SPIELBESTAETIGUNGEN_AS_NAME,
        }
    }


def _ansetzung_confirmed() -> Mapping[str, Any]:
    """Three-valued, `None` never folding into `False`, which marks the card provisional.

    A row about an Ansetzung the fixture has left counts towards asked; a referee's row towards neither; a discarded
    proposal as its club's agreement.
    """

    team_rows = {"$filter": {"input": f"${SPIELBESTAETIGUNGEN_AS_NAME}", "cond": {"$eq": ["$$this.party.kind", "team"]}}}
    current_rows = {"$filter": {"input": "$$team_rows", "cond": f"$$this.{_CURRENT}"}}
    all_agreed = {"$allElementsTrue": [{"$map": {"input": "$$current_rows", "in": f"$$this.{_TEAM_AGREED}"}}]}
    # `$ifNull`, not the bare path, so a null side reads as null; it matches no row's snapshot, so it never confirms.
    sides = [{"$ifNull": [f"${ANSETZUNG_QUELLEN[key]}", None]} for key in ("team1_id", "team2_id")]
    # The agreeing clubs are the two sides, never merely two rows: two answers of one club leave the
    # other's agreement missing.
    both_clubs = {"$setEquals": [{"$map": {"input": "$$current_rows", "in": "$$this.party.team_id"}}, sides]}

    return {
        "$let": {
            "vars": {"team_rows": team_rows},
            "in": {
                "$cond": [
                    {"$eq": [{"$size": "$$team_rows"}, 0]},
                    None,
                    {"$let": {"vars": {"current_rows": current_rows}, "in": {"$and": [all_agreed, both_clubs]}}},
                ]
            },
        }
    }


SCHIEDSRICHTER_AS_NAME = "schiedsrichter_rows"
SPIELORTE_AS_NAME = "spielorte_rows"

# The served mark's key, which `FLSpielJoined` declares and no stored shape does.
FOR_THIRD_PLACE = "for_third_place"

FINALE_KEY_NAME = "finale_key"
FINALE_AS_NAME = "finale_rows"


def _third_place_stages() -> list[Mapping[str, Any]]:
    """Mark the match for third place: of a Finale matchday holding the two the draw writes, the lower-numbered.

    Told apart by number rather than by a `verlierer` source, which an admin may clear by hand: the draw numbers the
    match for third place just ahead of the final, and no save renumbers a match. A season whose match for third place
    is not yet recorded holds its final alone, and that final is never marked. The one rule, which `podium_of` reads off
    the mark.
    """

    return [
        # Keyed on the season for a Finale match alone: every other match looks up a null key, which no fixture holds,
        # so only the Finale's two read their phase.
        {"$set": {FINALE_KEY_NAME: {"$cond": [{"$eq": ["$saison_phase", "finale"]}, "$saison_id", None]}}},
        {
            "$lookup": {
                "from": Collection.SPIELE,
                "localField": FINALE_KEY_NAME,
                "foreignField": "saison_id",
                "pipeline": [{"$match": {"saison_phase": "finale"}}, {"$project": {"_id": 0, "spiel_nr": 1}}],
                "as": FINALE_AS_NAME,
            }
        },
        {
            "$set": {
                FOR_THIRD_PLACE: {
                    "$and": [
                        {"$eq": [{"$size": f"${FINALE_AS_NAME}"}, 2]},
                        {"$eq": ["$spiel_nr", {"$min": f"${FINALE_AS_NAME}.spiel_nr"}]},
                    ]
                }
            }
        },
    ]


# The served verdicts' keys on the referee block, which `FLSpielSchiedsrichterFieldPublic` and
# `FLSpielJoined` read and no stored shape declares.
NAME_IS_PUBLIC_KEY = "name_is_public"
EINSATZ_CONFIRMED = "einsatz_confirmed"


def _referee_lookup() -> Mapping[str, Any]:
    """The booked referee's current name and consent verdict alone: no address, nothing the admin tier does not serve already.

    The public tier reduces the name by that verdict (`FLSpielSchiedsrichterFieldPublic`).
    """

    return {
        "$lookup": {
            "from": Collection.SCHIEDSRICHTER,
            # `$ifNull`, not the bare path: an empty slot matches no row rather than one by accident.
            "let": {"schiedsrichter_id": {"$ifNull": ["$schiedsrichter.schiedsrichter_id", None]}},
            "pipeline": [
                {"$match": {"$expr": {"$eq": ["$_id", "$$schiedsrichter_id"]}}},
                # The pupils' predicate itself, never a third spelling of it.
                {"$project": {"_id": 0, "name": 1, NAME_IS_PUBLIC_KEY: NAME_IS_PUBLIC}},
            ],
            "as": SCHIEDSRICHTER_AS_NAME,
        }
    }


def _venue_lookup() -> Mapping[str, Any]:
    """The booked venue's current name and the search its Maps link runs, and nothing else of its row."""

    return {
        "$lookup": {
            "from": Collection.SPIELORTE,
            # A fixture with no venue looks up a missing path, which the manual reads as null: no venue's `_id` is.
            "localField": "spielort.spielort_id",
            "foreignField": "_id",
            "pipeline": [{"$project": {"_id": 0, "name": 1, "maps_link": 1}}],
            "as": SPIELORTE_AS_NAME,
        }
    }


def _joined_venue() -> Mapping[str, Any]:
    """The venue block with its row's name and link folded in, conditional as `_joined_side` is, so no venue stays null."""

    return {
        "$cond": [
            {"$eq": ["$spielort", None]},
            None,
            {"$mergeObjects": ["$spielort", {"$ifNull": [{"$first": f"${SPIELORTE_AS_NAME}"}, {}]}]},
        ]
    }


def _einsatz_confirmed() -> Mapping[str, Any]:
    """`True` only where the booked referee's open rows, else their latest answer, agree to the Ansetzung as it stands.

    Never three-valued: a booking the pass has not reached would publish its referee.
    """

    own_rows = {
        "$filter": {
            "input": f"${SPIELBESTAETIGUNGEN_AS_NAME}",
            "cond": {
                "$and": [
                    {"$eq": ["$$this.party.kind", "schiedsrichter"]},
                    {"$eq": ["$$this.party.schiedsrichter_id", "$schiedsrichter.schiedsrichter_id"]},
                ]
            },
        }
    }
    open_rows = {"$filter": {"input": "$$own_rows", "cond": {"$eq": [{"$ifNull": ["$$this.closed", None]}, None]}}}
    answered = {"$filter": {"input": "$$own_rows", "cond": {"$ne": [{"$ifNull": ["$$this.answer.kind", None]}, None]}}}

    def agreed(row: str) -> Mapping[str, Any]:
        # `$ifNull` on both: no latest answer leaves `$$latest` missing, which must read as not agreed, never as null.
        return {"$and": [{"$ifNull": [f"{row}.{_CURRENT}", False]}, {"$eq": [{"$ifNull": [f"{row}.answer.kind", None]}, "agreed"]}]}

    # Open rows first: the decline closes its own row, and a fresh one is minted only after, so an open row is newer.
    judged = {
        "$cond": [
            {"$gt": [{"$size": "$$open_rows"}, 0]},
            {"$allElementsTrue": [{"$map": {"input": "$$open_rows", "in": agreed("$$this")}}]},
            agreed("$$latest"),
        ]
    }

    return {
        "$let": {
            "vars": {"own_rows": own_rows},
            "in": {
                "$let": {
                    "vars": {"open_rows": open_rows, "latest": {"$last": {"$sortArray": {"input": answered, "sortBy": {"_id": 1}}}}},
                    "in": judged,
                }
            },
        }
    }


def _joined_referee() -> Mapping[str, Any]:
    """The block with its row's name and both verdicts folded in, conditional as `_joined_side` is, so an empty slot stays null."""

    joined = {
        # Null where no row answers: a booking naming nobody is served nameless.
        "name": {"$ifNull": [{"$first": f"${SCHIEDSRICHTER_AS_NAME}.name"}, None]},
        # A join answering nothing withholds: it costs a page a name, never a person theirs.
        NAME_IS_PUBLIC_KEY: {"$ifNull": [{"$first": f"${SCHIEDSRICHTER_AS_NAME}.{NAME_IS_PUBLIC_KEY}"}, False]},
        EINSATZ_CONFIRMED: _einsatz_confirmed(),
    }

    return {"$cond": [{"$eq": ["$schiedsrichter", None]}, None, {"$mergeObjects": ["$schiedsrichter", joined]}]}


def _season_rows_lookup() -> Mapping[str, Any]:
    """Both sides' rows of the fixture's own season: the name and shorthand each is played under, and the way it left."""

    return {
        "$lookup": {
            "from": Collection.SAISON_TEAMS,
            "let": {
                "spiel_saison_id": "$saison_id",
                # `$ifNull`, not the bare path: a null side makes `$teamN.team_id` missing, and
                # a missing element shifts the other into its position.
                "team1_id": {"$ifNull": ["$team1.team_id", None]},
                "team2_id": {"$ifNull": ["$team2.team_id", None]},
            },
            "pipeline": [
                {
                    "$match": {
                        "$expr": {
                            "$and": [
                                {"$eq": ["$saison_id", "$$spiel_saison_id"]},
                                # No junction row carries a null `team_id`, so a null slot
                                # matches nothing rather than a row by accident.
                                {"$in": ["$team_id", ["$$team1_id", "$$team2_id"]]},
                            ]
                        }
                    }
                },
                {"$project": {"_id": 0, "team_id": 1, "name": 1, "shorthand": 1, "austritt": 1}},
            ],
            "as": SAISON_TEAMS_AS_NAME,
        }
    }


def _ordered(db_filter: Mapping[str, Any], sort_by: Sequence[tuple[str, int]] | None, limit: int | None) -> list[Mapping[str, Any]]:
    pipeline: list[Mapping[str, Any]] = [{"$match": db_filter}]

    if sort_by is not None:
        # A dict, so `$sort` keeps its order; safe only while a caller's sort repeats no key.
        pipeline.append({"$sort": dict(sort_by)})

    if limit is not None:
        pipeline.append({"$limit": limit})

    return pipeline


def build_named_spiele_pipeline(
    db_filter: Mapping[str, Any],
    *,
    projection: Mapping[str, Any],
    sort_by: Sequence[tuple[str, int]] | None = None,
    limit: int | None = None,
) -> list[Mapping[str, Any]]:
    """The fixtures `db_filter` selects, each side and the venue named as `build_spiele_pipeline` names them, and `projection` of them.

    For a reader of a fixture's own fields that serves no verdict: the stored document holds no name, so a plain
    `find` answers a side and the venue nameless. The referee stays the stored block, an id with no name: a reader
    of the name takes `build_spiele_pipeline`, whose join carries the consent verdict that reduces it.
    """

    return [
        *_ordered(db_filter, sort_by, limit),
        _season_rows_lookup(),
        _venue_lookup(),
        {
            "$set": {
                "team1": _joined_side("team1"),
                "team2": _joined_side("team2"),
                "spielort": _joined_venue(),
            }
        },
        {"$project": dict(projection)},
    ]


def build_spiele_pipeline(
    db_filter: Mapping[str, Any],
    sort_by: Sequence[tuple[str, int]] | None = None,
    limit: int | None = None,
) -> list[Mapping[str, Any]]:
    """Every match read runs this; each side's name and withdrawal join on the document's own `saison_id`.

    The fixture stores no name: a side's comes from its season row, so a past season keeps the name a club played it
    under, and the venue's and the referee's from their current rows. Both spellings of a withdrawal are projected
    and each read model declares the one it serves: the document is the data, the model the allow-list.
    """

    pipeline = _ordered(db_filter, sort_by, limit)

    pipeline.append(_season_rows_lookup())

    pipeline.append(_confirmations_lookup())

    pipeline.append(_referee_lookup())

    pipeline.append(_venue_lookup())

    pipeline.extend(_third_place_stages())

    pipeline.append(
        {
            "$set": {
                "team1": _joined_side("team1"),
                "team2": _joined_side("team2"),
                ANSETZUNG_CONFIRMED: _ansetzung_confirmed(),
                "schiedsrichter": _joined_referee(),
                "spielort": _joined_venue(),
            }
        }
    )

    # Dropped here rather than at validation: `extra="ignore"` discards these scratch rows in
    # silence, after the driver has carried one array per fixture across every list read.
    pipeline.append(
        {
            "$unset": [
                SAISON_TEAMS_AS_NAME,
                SPIELBESTAETIGUNGEN_AS_NAME,
                SCHIEDSRICHTER_AS_NAME,
                SPIELORTE_AS_NAME,
                FINALE_KEY_NAME,
                FINALE_AS_NAME,
            ]
        }
    )

    return pipeline


# The `bool` says whether either side differs from the occupant stored.
ResolvedSides = tuple[FLSpielTeamField | None, FLSpielTeamField | None, bool]


def voided_no_show(sonderereignis: FLSonderereignis | None) -> FLSonderereignis | None:
    """The event a write that rewrites a side destroys, or `None`.

    A no-show alone names a side and composes its result, and `state_nichtantreten_without_two_sides` refuses one left
    beside an emptied slot -- so a fixture keeping it is one no later save can repair.
    """

    return sonderereignis if sonderereignis in SONDEREREIGNIS_NO_SHOW else None


def reopens(stored: FLSpielCommon, *, ergebnis: str | None, sonderereignis: FLSonderereignis | None) -> bool:
    """Whether a write leaving this fixture with `ergebnis` and `sonderereignis` puts it back among those still to be played.

    One question for a save and a rewrite alike, so `booking_unknown_resource` and the reports over a rewrite cannot disagree.
    """

    return not is_unplayed(ergebnis=stored.ergebnis, sonderereignis=stored.sonderereignis) and is_unplayed(
        ergebnis=ergebnis, sonderereignis=sonderereignis
    )


@dataclass(frozen=True)
class SlotAdvancement:
    """One fixture whose slots resolve to something other than what it stores; goals go with the occupant that left."""

    spiel_id: CustomObjectId
    spiel_nr: int
    team1: FLSpielTeamField | None
    team2: FLSpielTeamField | None
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None
    # Null unless this rewrite destroys the event too, so the write path decides with a null check.
    voided_sonderereignis: FLSonderereignis | None


def _source_spiel_nr(quelle: FLSpielQuelle | None) -> int | None:
    """The match a slot is fed by. A `gruppe` reference answers `None`: only fixture edges cycle."""

    return quelle.spiel_nr if isinstance(quelle, FLSpielQuelleSpiel) else None


def _is_same_team(left: FLSpielTeamField | None, right: FLSpielTeamField | None) -> bool:
    """The same club, by id alone: a joined side's name and shorthand are its season row's, never part of its identity."""

    if left is None or right is None:
        return left is None and right is None

    return left.team_id == right.team_id


def _spiele_depending_on_a_cycle(by_nr: Mapping[int, FLSpielCommon]) -> frozenset[int]:
    """Every fixture depending, directly or transitively, on a cyclic chain: nothing downstream is derivable."""

    IN_PROGRESS, DONE = 1, 2
    state: dict[int, int] = {}
    tainted: set[int] = set()

    def visit(spiel_nr: int) -> bool:
        if state.get(spiel_nr) == IN_PROGRESS:
            return True
        if state.get(spiel_nr) == DONE:
            return spiel_nr in tainted

        state[spiel_nr] = IN_PROGRESS
        spiel = by_nr.get(spiel_nr)
        sources = (_source_spiel_nr(spiel.team1_quelle), _source_spiel_nr(spiel.team2_quelle)) if spiel is not None else ()
        depends_on_a_cycle = any(visit(source) for source in sources if source is not None)
        state[spiel_nr] = DONE

        if depends_on_a_cycle:
            tainted.add(spiel_nr)
        return depends_on_a_cycle

    # Sorted, so the traversal and every memoised answer below it are decided by the input.
    for spiel_nr in sorted(by_nr):
        visit(spiel_nr)

    return frozenset(tainted)


@dataclass(frozen=True)
class BracketResolution:
    """What one season's bracket should hold. Faults are reported alongside the writes, never instead of them."""

    advancements: list[SlotAdvancement]
    bracket_faults: list[FLBracketFault]


@dataclass(frozen=True)
class _BracketWalk:
    """One resolution pass: the season's facts, and the two collections it fills as it goes.

    Frozen binds the members rather than their contents -- `memo` makes a fixture reached twice
    resolve once, `faults` makes it report once.
    """

    by_nr: Mapping[int, FLSpielCommon]
    standings: Mapping[FLGruppenNames, DecidedStanding]
    tainted: frozenset[int]
    opening_round_rank: int | None
    shared_sources: frozenset[tuple[Any, ...]]
    memo: dict[int, ResolvedSides]
    faults: list[FLBracketFault]


def _opening_round_rank(spiele: Iterable[FLSpielCommon]) -> int | None:
    """The round this season's bracket opens on, or `None` where it plays none.

    Off the rounds the season holds rather than a phase name: four
    qualifiers open at the Halbfinale, two at the Finale.
    """

    ranks = [PHASE_RANK[spiel.saison_phase] for spiel in spiele if spiel.saison_phase != "gruppenphase"]

    return min(ranks) if ranks else None


def _sources_feeding_two_spiele(spiele: Iterable[FLSpielCommon]) -> frozenset[tuple[Any, ...]]:
    """Every source whose slots span more than one fixture.

    A source feeding both sides of one fixture is `same_team`'s, so widening this would report one
    slot twice.
    """

    spiele_by_source: dict[tuple[Any, ...], set[int]] = {}
    for spiel in spiele:
        # A reference on a Gruppenphase fixture is followed by nobody, so counting it would freeze a
        # knockout slot whose own wiring is right.
        if spiel.saison_phase == "gruppenphase":
            continue

        for quelle in (spiel.team1_quelle, spiel.team2_quelle):
            if quelle is not None:
                spiele_by_source.setdefault(_quelle_key(quelle), set()).add(spiel.spiel_nr)

    return frozenset(key for key, spiel_nrs in spiele_by_source.items() if len(spiel_nrs) > 1)


def _seed_from_gruppe(
    spiel: FLSpielCommon,
    quelle: FLSpielQuelleGruppe,
    walk: _BracketWalk,
) -> tuple[FLSpielTeamField | None, bool]:
    """The team a group placing seeds in, and whether that maintains the slot.

    An undecided placing empties it: seeding from an earlier state of the table would hand a team
    back the moment a result stops supporting it.
    """

    standing = walk.standings.get(quelle.gruppe)
    if standing is None:
        # Not a group with no teams, which arrives as a standing holding none: a group the season
        # does not run is given none, and `find_gruppen_not_run` names it rather than this walk
        # judging it on a size nothing states.
        return None, False

    # Only the round the bracket opens on is fed by a placing, so a slot below it keeps what it holds.
    if walk.opening_round_rank is not None and walk.opening_round_rank < PHASE_RANK[spiel.saison_phase]:
        walk.faults.append(
            FLBracketFaultGruppe(
                reason="seed_past_the_opening_round", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz
            )
        )
        return None, False

    # A placing this group can never produce reads as a typo, so the slot keeps what it holds.
    if quelle.platz > standing.eligible:
        walk.faults.append(
            FLBracketFaultGruppe(
                reason="gruppe_too_small", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz
            )
        )
        return None, False

    team = standing.by_platz.get(quelle.platz)
    if team is not None:
        return FLSpielTeamField(team_id=team.id, tore=None), True

    # Played out and still level on every criterion: naming either team would be a guess, so the
    # slot is emptied and the way past it is to clear the `quelle` by hand.
    if standing.is_complete:
        walk.faults.append(
            FLBracketFaultGruppe(reason="tie_unresolved", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz)
        )

    return None, True


def _occupant_of(
    spiel: FLSpielCommon,
    side: FLSpielSide,
    stored: FLSpielTeamField | None,
    quelle: FLSpielQuelle | None,
    walk: _BracketWalk,
) -> tuple[FLSpielTeamField | None, bool]:
    """Who one slot should hold. `False` leaves the slot as it stands; `(None, True)` empties it."""

    # No reference: a group fixture, or a slot an admin took over by clearing it.
    if quelle is None:
        return stored, False

    # The schedule draws a group fixture's sides, so following a reference stored on one would
    # rewrite a match that was played.
    if spiel.saison_phase == "gruppenphase":
        walk.faults.append(
            FLBracketFaultSlot(reason="gruppenphase_spiel_wired", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, side=side, quelle=quelle)
        )
        return stored, False

    if isinstance(quelle, FLSpielQuelleSpiel):
        # Neither a dangling number nor a cycle states an outcome, so neither removes a team -- and
        # both are reported, because a slot nothing mentions is one an admin cannot discover.
        if quelle.spiel_nr not in walk.by_nr:
            walk.faults.append(
                FLBracketFaultQuelle(reason="spiel_missing", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr)
            )
            return stored, False

        if quelle.spiel_nr in walk.tainted:
            walk.faults.append(
                FLBracketFaultQuelle(reason="reference_cycle", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr)
            )
            return stored, False

        source = walk.by_nr[quelle.spiel_nr]

        # A group match is no bracket edge: its winner is the table's
        # answer, and a group draw states no winner at all.
        if source.saison_phase == "gruppenphase":
            walk.faults.append(
                FLBracketFaultQuelle(reason="gruppenphase_feeder", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr)
            )
            return stored, False

        # Every edge points at a strictly earlier round, which is also what makes a cycle
        # inexpressible through the write path.
        if PHASE_RANK[source.saison_phase] >= PHASE_RANK[spiel.saison_phase]:
            walk.faults.append(
                FLBracketFaultQuelle(
                    reason="feeder_not_played_first", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, quelle_spiel_nr=quelle.spiel_nr
                )
            )
            return stored, False

    # After a `spiel` reference's own shape: a chain that closes is where the sharing downstream of it
    # comes from, and reporting the sharing would leave the loop itself unnamed.
    if _quelle_key(quelle) in walk.shared_sources:
        walk.faults.append(
            FLBracketFaultSlot(reason="source_feeds_another_spiel", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, side=side, quelle=quelle)
        )
        return stored, False

    if isinstance(quelle, FLSpielQuelleGruppe):
        return _seed_from_gruppe(spiel, quelle, walk)

    return _outcome_of(quelle.spiel_nr, quelle.ausgang, walk), True


def _resolve_sides(spiel_nr: int, walk: _BracketWalk) -> ResolvedSides:
    """The two sides one fixture should hold. The stored side is kept where it is correct, so its goals survive."""

    if spiel_nr in walk.memo:
        return walk.memo[spiel_nr]

    spiel = walk.by_nr[spiel_nr]
    sides: list[FLSpielTeamField | None] = []
    an_occupant_changed = False
    a_side_is_maintained = False

    # Annotated rather than inferred: a bare tuple literal widens each side's name to `str`, which
    # `_occupant_of` then refuses.
    seats: tuple[tuple[FLSpielSide, FLSpielTeamField | None, FLSpielQuelle | None], ...] = (
        ("team1", spiel.team1, spiel.team1_quelle),
        ("team2", spiel.team2, spiel.team2_quelle),
    )

    for side, stored, quelle in seats:
        occupant, is_maintained = _occupant_of(spiel, side, stored, quelle, walk)
        a_side_is_maintained = a_side_is_maintained or is_maintained

        if not is_maintained or _is_same_team(occupant, stored):
            sides.append(stored)
            continue

        sides.append(occupant.model_copy(update={"tore": None}) if occupant is not None else None)
        an_occupant_changed = True

    both_sides_one_club = sides[0] is not None and sides[1] is not None and sides[0].team_id == sides[1].team_id

    # Reported even where nothing moves: a fixture already holding the club its source resolves to
    # stores the contradiction rather than producing it, and the write path cannot refuse that.
    if both_sides_one_club and a_side_is_maintained:
        walk.faults.append(FLBracketFaultSpiel(reason="same_team", spiel_id=spiel.id, spiel_nr=spiel_nr))

    # Recorded as not maintained: claiming a change would void this result and the whole subtree's.
    if an_occupant_changed and both_sides_one_club:
        walk.memo[spiel_nr] = (spiel.team1, spiel.team2, False)
        return walk.memo[spiel_nr]

    walk.memo[spiel_nr] = (sides[0], sides[1], an_occupant_changed)
    return walk.memo[spiel_nr]


def _outcome_of(spiel_nr: int, ausgang: str, walk: _BracketWalk) -> FLSpielTeamField | None:
    """The side that came out of one match as `ausgang`. `sonderereignis` is not consulted."""

    spiel = walk.by_nr[spiel_nr]
    team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, walk)

    # The stored result was scored by a side no longer in the fixture, so it is void for this whole
    # pass -- which is what carries a corrected quarter-final through to the final.
    if an_occupant_changed:
        return None

    decided = winner_and_loser(team1, team2, spiel.elfmeterschiessen)
    if decided is None:
        return None

    winner, loser = decided

    return winner if ausgang == "sieger" else loser


def winner_and_loser[Side: FLSpielTeamField](
    team1: Side | None, team2: Side | None, elfmeterschiessen: FLSpielElfmeterschiessen | None
) -> tuple[Side, Side] | None:
    """A knockout match's winner and loser by its goals, a level one by its shoot-out; `None` while it names neither."""

    # The goals are the result: a save composes `ergebnis` from them, so the two agree.
    if team1 is None or team2 is None or team1.tore is None or team2.tore is None:
        return None

    if team1.tore == team2.tore:
        # Read only here, so the bracket and the table disagree about this fixture on purpose. No group
        # fixture reaches this: a group feeder is a fault the walk reports before asking its outcome.
        if elfmeterschiessen is None:
            return None

        # Total, because `FLSpielElfmeterschiessen` refuses a level shoot-out.
        team1_won = elfmeterschiessen.team1 > elfmeterschiessen.team2
    else:
        team1_won = team1.tore > team2.tore

    return (team1, team2) if team1_won else (team2, team1)


def podium_of(finale: Sequence[FLSpielJoinedInternal]) -> list[tuple[int, FLSpielTeamFieldJoinedInternal | None]]:
    """Places one to four as the Finale's matchday decides them, each pair only once its match has.

    The final gives places one and two; the match for third place, as the read marks it (`_third_place_stages`), gives
    three and four. A place decided on or after the day its club left the season is vacant, its club `None`, by the rule
    a group's placings keep (`in_the_season_when_decided`): still a decided place, so a season whose fourth place is
    vacant has all four in.
    """

    places: list[tuple[int, FLSpielTeamFieldJoinedInternal | None]] = []
    for spiel in finale:
        first = 3 if spiel.for_third_place else 1
        decided = winner_and_loser(spiel.team1, spiel.team2, spiel.elfmeterschiessen)
        if decided is not None:
            places.extend(
                (platz, side if in_the_season_when_decided(side.austritt, spiel.date) else None)
                for platz, side in ((first, decided[0]), (first + 1, decided[1]))
            )

    # By place, whichever order the Finale's two were read in.
    return sorted(places, key=lambda place: place[0])


def _fault_order(fault: FLBracketFault) -> tuple[int, str, str, int]:
    """One fault's place in the report, spelled out per variant because the variants share no field set."""

    if isinstance(fault, FLBracketFaultGruppe):
        return (fault.spiel_nr, fault.reason, fault.gruppe, fault.platz)
    if isinstance(fault, FLBracketFaultQuelle):
        return (fault.spiel_nr, fault.reason, "", fault.quelle_spiel_nr)
    if isinstance(fault, FLBracketFaultSlot):
        return (fault.spiel_nr, fault.reason, fault.side, 0)
    return (fault.spiel_nr, fault.reason, "", 0)


def resolve_bracket(spiele: Iterable[FLSpielCommon], standings: Mapping[FLGruppenNames, DecidedStanding]) -> BracketResolution:
    """Every fixture whose slots disagree with its wiring. Pass one season: `spiel_nr` repeats across seasons."""

    by_nr = {spiel.spiel_nr: spiel for spiel in spiele}
    walk = _BracketWalk(
        by_nr=by_nr,
        standings=standings,
        tainted=_spiele_depending_on_a_cycle(by_nr),
        opening_round_rank=_opening_round_rank(by_nr.values()),
        shared_sources=_sources_feeding_two_spiele(by_nr.values()),
        memo={},
        faults=[],
    )

    advancements: list[SlotAdvancement] = []
    for spiel_nr in sorted(by_nr):
        spiel = by_nr[spiel_nr]
        team1, team2, an_occupant_changed = _resolve_sides(spiel_nr, walk)
        if not an_occupant_changed:
            continue

        # Both sides lose their goals, not only the one that moved: the other side scored against
        # the occupant being replaced.
        advancements.append(
            SlotAdvancement(
                spiel_id=spiel.id,
                spiel_nr=spiel_nr,
                team1=team1.model_copy(update={"tore": None}) if team1 is not None else None,
                team2=team2.model_copy(update={"tore": None}) if team2 is not None else None,
                voided_ergebnis=spiel.ergebnis,
                voided_elfmeterschiessen=spiel.elfmeterschiessen,
                voided_sonderereignis=voided_no_show(spiel.sonderereignis),
            )
        )

    # Bracket order, not the order the recursion happened to reach each fixture.
    walk.faults.sort(key=_fault_order)

    return BracketResolution(advancements=advancements, bracket_faults=walk.faults)


def find_gruppen_not_run(spiele: Iterable[FLSpielCommon], *, number_of_gruppen: int) -> list[FLBracketFaultGruppe]:
    """Every bracket slot seeded from a group this season does not run.

    Beside `resolve_bracket` rather than inside it: that walk is handed no standing here, so nothing
    there tells one from a group whose table is short.
    """

    offered = offered_gruppen(number_of_gruppen)
    faults = [
        FLBracketFaultGruppe(reason="gruppe_not_run", spiel_id=spiel.id, spiel_nr=spiel.spiel_nr, gruppe=quelle.gruppe, platz=quelle.platz)
        for spiel in spiele
        # A reference on a Gruppenphase fixture is followed by nobody, and `resolve_bracket` reports
        # it as the fault it is; naming the group as well would fill the list twice over.
        if spiel.saison_phase != "gruppenphase"
        for quelle in (spiel.team1_quelle, spiel.team2_quelle)
        if isinstance(quelle, FLSpielQuelleGruppe) and quelle.gruppe not in offered
    ]

    return sorted(faults, key=lambda fault: (fault.spiel_nr, fault.gruppe, fault.platz))


@dataclass(frozen=True)
class SaisonMembership:
    """One club's `saison_teams` row: the name this season is played under, and the day the club left it.

    The season's name rather than the club's, for the release a save reports.
    """

    name: str
    #: `None` while the club still competes.
    departed_from: str | None


@dataclass(frozen=True)
class BookedVenue:
    """The `spielorte` row a fixture's venue reference names, as it stands now."""

    name: str
    maps_link: str
    inactive_since: str | None


@dataclass(frozen=True)
class BookedReferee:
    """The `schiedsrichter` row a fixture's referee reference names."""

    inactive_since: str | None
    #: Whether the referee's own confirmation stands on the record; no write takes one back.
    confirmed: bool


@dataclass(frozen=True)
class ResolvedReferences:
    """Every row this payload's references name, read in the router to keep this module synchronous.

    What the booking and eligibility rules judge: whether a club holds a row this season, and whether a venue or a
    referee stands, live and confirmed.
    """

    teams: Mapping[CustomObjectId, SaisonMembership]
    #: `None` where the payload names none, and where the id names no row at all.
    spielort: BookedVenue | None = None
    schiedsrichter: BookedReferee | None = None


def _composed_side(submitted: FLSpielTeamFieldPayload | None, tore: int | None) -> FLSpielTeamField | None:
    """One side as the document will hold it: the team, and the goals the result composes."""

    return None if submitted is None else FLSpielTeamField(team_id=submitted.team_id, tore=tore)


def _composed_spielort(submitted: FLSpielortFieldPayload | None) -> FLSpielortFieldRecord | None:
    return None if submitted is None else FLSpielortFieldRecord(spielort_id=submitted.spielort_id, mietpreis=submitted.mietpreis)


def _composed_schiedsrichter(submitted: FLSpielSchiedsrichterFieldPayload | None) -> FLSpielSchiedsrichterFieldRecord | None:
    return (
        None
        if submitted is None
        else FLSpielSchiedsrichterFieldRecord(schiedsrichter_id=submitted.schiedsrichter_id, payment=submitted.payment)
    )


@dataclass(frozen=True)
class ComposedResult:
    """The goals a payload leaves on its fixture, and the no-show that composed them where one did."""

    team1_tore: int | None
    team2_tore: int | None
    absent_side: FLSpielSide | None

    @property
    def ergebnis(self) -> str | None:
        return f"{self.team1_tore}:{self.team2_tore}" if self.team1_tore is not None and self.team2_tore is not None else None


def compose_result(payload: FLPatchSpielDataPayload, rules: FLSaisonRules) -> ComposedResult:
    """The result as the save composes it, for the document and for `booking_unknown_resource`'s question whether it stays unplayed."""

    # An unresolved slot has nobody to score, so an unresolved fixture carries no goals rather than
    # the partial result `build_statistik_lookup_stage` has to filter against.
    both_sides_known = payload.team1 is not None and payload.team2 is not None
    team1_tore = payload.team1.tore if both_sides_known and payload.team1 is not None else None
    team2_tore = payload.team2.tore if both_sides_known and payload.team2 is not None else None

    # `both_sides_known` again, so this function keeps the invariant its first lines state rather
    # than resting on `state_nichtantreten_without_two_sides` refusing the same shape one layer up.
    absent_side = SONDEREREIGNIS_NO_SHOW.get(payload.sonderereignis or "") if both_sides_known else None
    if absent_side is not None:
        # The award is composed for the same reason `ergebnis` is: a figure the client supplied can
        # disagree with the regulation it is meant to express. The side that stayed away takes the
        # loser's goals.
        awarded = rules.forfeit_ergebnis
        team1_tore, team2_tore = (
            (awarded.verlierer_tore, awarded.sieger_tore) if absent_side == "team1" else (awarded.sieger_tore, awarded.verlierer_tore)
        )

    return ComposedResult(team1_tore=team1_tore, team2_tore=team2_tore, absent_side=absent_side)


def apply_payload_to_spiel(stored: FLSpiel, payload: FLPatchSpielDataPayload, rules: FLSaisonRules, *, now: datetime) -> FLSpiel:
    """Composed once for the save and its `dry_run` preview.

    `rules` arrives as a value, keeping this module synchronous and collection-free: a forfeit from a
    constant could disagree with the season in play. `now` judges the fixture as written played or still to come.
    """

    result = compose_result(payload, rules)

    schiedsrichter = _composed_schiedsrichter(payload.schiedsrichter)
    # A match to come books nobody it cannot name: a re-dating that puts a played match back among those to come leaves
    # its slot empty for a referee to be booked.
    if schiedsrichter is not None and schiedsrichter.schiedsrichter_id is None and not is_played(date=payload.date, time=payload.time, now=now):
        schiedsrichter = None

    is_knockout = stored.saison_phase != "gruppenphase"
    # `absent_side` too: a composed forfeit never went to penalties, and a season regulating 0:0
    # composes a level one -- which would keep a submitted shoot-out and advance the club that
    # never appeared (`_outcome_of`).
    keeps_shoot_out = is_knockout and result.ergebnis is not None and result.team1_tore == result.team2_tore and result.absent_side is None

    return stored.model_copy(
        update={
            "date": payload.date,
            "time": payload.time,
            "spielort": _composed_spielort(payload.spielort),
            "schiedsrichter": schiedsrichter,
            "team1": _composed_side(payload.team1, result.team1_tore),
            "team2": _composed_side(payload.team2, result.team2_tore),
            "team1_quelle": payload.team1_quelle,
            "team2_quelle": payload.team2_quelle,
            "ergebnis": result.ergebnis,
            "elfmeterschiessen": payload.elfmeterschiessen if keeps_shoot_out else None,
            "sonderereignis": payload.sonderereignis,
            "note": payload.note,
        }
    )


def spiel_label(saison_id: str, spiel_nr: int) -> str:
    """How a row of the Protokoll names a fixture: its season and its number, never its sides' people."""

    return f"{saison_id} / {spiel_nr}"


def stored_in_slice(spiel_id: CustomObjectId, season: Sequence[FLSpiel]) -> FLSpiel:
    """The fixture under edit, from the caller's slice.

    Absent means a truncated or wrong-season slice: the route has already read this `_id`. A
    refusal that permits what it cannot see is the wrong default.
    """

    stored = next((spiel for spiel in season if spiel.id == spiel_id), None)
    if stored is None:
        raise ValueError(f"the season slice does not hold spiel {spiel_id}, so no refusal over it can be trusted")

    return stored


def find_state_refusal(payload: FLPatchSpielDataPayload) -> WriteRefusal | None:
    """Why this patch's sonderereignis must be refused, or `None`.

    Both read the payload alone: the event and the two goal counts arrive in one body, so the pair
    is judged where it is stated.
    """

    submitted_goals = [side.tore for side in (payload.team1, payload.team2) if side is not None and side.tore is not None]

    # Refused rather than silently emptied: the goals are somebody's typing, and a save that discards
    # them without saying so is how a real result disappears.
    if payload.sonderereignis in SONDEREREIGNIS_WITHOUT_A_RESULT and submitted_goals:
        return WriteRefusal(
            error_code=Code.STATE_ERGEBNIS_ON_A_NON_EVENT,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("sonderereignis",),),
        )

    # An unresolved slot has nobody who could have failed to appear, and the award below would have
    # no side to land on.
    if payload.sonderereignis in SONDEREREIGNIS_NO_SHOW and (payload.team1 is None or payload.team2 is None):
        return WriteRefusal(
            error_code=Code.STATE_NICHTANTRETEN_WITHOUT_TWO_SIDES,
            status=HTTPStatus.UNPROCESSABLE_CONTENT,
            fields=(("sonderereignis",),),
        )

    return None


def find_ergebnis_before_start_refusal(stored: FLSpiel, payload: FLPatchSpielDataPayload, *, started: bool) -> WriteRefusal | None:
    """`ergebnis_before_saison_start`: goals, a no-show or an abandonment this save would newly store while the season has not started.

    `started` is the season's own `has_started`, the one start every start lock reads. Judged against the stored
    fixture, as the start's own edit is, so a fixture already holding a result is never trapped: that result
    resubmitted unchanged passes, and so does clearing it; a match called off or struck out stores no result and passes
    too.
    """

    if started:
        return None

    new_goals = any(
        submitted is not None and submitted.tore is not None and submitted.tore != (None if held is None else held.tore)
        for submitted, held in ((payload.team1, stored.team1), (payload.team2, stored.team2))
    )
    new_record = payload.sonderereignis in SONDEREREIGNIS_PRODUCING_A_RECORD and payload.sonderereignis != stored.sonderereignis

    if not new_goals and not new_record:
        return None

    return WriteRefusal(
        error_code=Code.ERGEBNIS_BEFORE_SAISON_START,
        status=HTTPStatus.CONFLICT,
    )


def find_eligibility_refusal(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    membership: Mapping[CustomObjectId, SaisonMembership],
) -> WriteRefusal | None:
    """Why this patch's occupants must be refused. Keyed on the payload's `date`, so an undated fixture is refused."""

    stored = stored_in_slice(spiel_id, season)

    for label, submitted, stored_side in (("team1", payload.team1, stored.team1), ("team2", payload.team2, stored.team2)):
        if submitted is None:
            continue

        stays = stored_side is not None and stored_side.team_id == submitted.team_id
        member = membership.get(submitted.team_id)

        # A newly fielded club only: one already standing here without a row is a fault to correct on
        # this very fixture, and refusing every save of it would trap that correction.
        if not stays and member is None:
            return WriteRefusal(
                error_code=Code.ELIGIBILITY_TEAM_NOT_IN_SAISON,
                status=HTTPStatus.CONFLICT,
            )

        # Every input the predicate reads, not just the side: the date and the event both decide its
        # answer, so clearing the carve-out is judged as a re-dating is. On the side alone, the escape
        # this refusal names would be a one-way door.
        if stays and payload.date == stored.date and payload.sonderereignis == stored.sonderereignis:
            continue

        if member is None or member.departed_from is None:
            continue

        absence_recorded = records_an_absence(side=label, sonderereignis=payload.sonderereignis, saison_phase=stored.saison_phase)

        if absence_recorded or (payload.date is not None and payload.date < member.departed_from):
            continue

        return WriteRefusal(
            error_code=Code.ELIGIBILITY_DISQUALIFIED,
            status=HTTPStatus.CONFLICT,
            fields=((label, "team_id"),),
        )

    return None


# A match plus its overrun, the changeover and the travel: the league plays several matches at one
# ground, so this spaces them rather than banning the pairing.
CLASH_BUFFER_MINUTES = 4 * 60

MINUTES_PER_DAY = 24 * 60

# Derived rather than assumed to be one: widen the buffer past a day and the read below has to widen
# with it, or the rule silently stops seeing the fixtures it now reaches.
CLASH_REACH_DAYS = math.ceil(CLASH_BUFFER_MINUTES / MINUTES_PER_DAY)


def _minutes_into_day(time: str) -> int:
    """`HH:MM:SS` as minutes past midnight. Seconds are dropped: nothing is scheduled to the second."""

    hours, minutes, _ = time.split(":")

    return int(hours) * 60 + int(minutes)


def _minutes_of(day: str, time: str) -> int:
    """Minutes past midnight alone put 23:30 and 00:30 twenty-three hours apart when they are one apart."""

    return date.fromisoformat(day).toordinal() * MINUTES_PER_DAY + _minutes_into_day(time)


def days_a_clash_can_reach(day: str) -> list[str]:
    """Every day a fixture dated `day` can clash into, this one included -- the days a booking read has to fetch."""

    return [str(date.fromisoformat(day) + timedelta(days=offset)) for offset in range(-CLASH_REACH_DAYS, CLASH_REACH_DAYS + 1)]


def find_spiel_date_refusal(*, date: str | None, spieltag_start: str | None, spieltag_end: str | None) -> WriteRefusal | None:
    """Why this fixture's date must be refused, or `None`.

    An undated fixture contradicts no span, and an undated matchday states none to contradict: a
    drawn season carries both until somebody sets them, and neither absence is a disagreement.
    """

    if date is None or spieltag_start is None or spieltag_end is None:
        return None

    if spieltag_start <= date <= spieltag_end:
        return None

    return WriteRefusal(
        error_code=Code.SPIEL_OUTSIDE_SPIELTAG,
        status=HTTPStatus.CONFLICT,
        fields=(("date",),),
    )


# A fixture whose referee block carries the record's id: never `FLSpielJoined`, whose block withholds it.
type BookedSpiel = FLSpiel | FLSpielJoinedAdmin


@dataclass(frozen=True)
class BookedReferences:
    """A fixture's venue and referee, each `None` where the question this answers leaves that reference out."""

    spielort_id: CustomObjectId | None
    schiedsrichter_id: CustomObjectId | None


def _chosen_references(spiel: BookedSpiel | FLPatchSpielDataPayload | FLSpielSlotHolder) -> BookedReferences:
    return BookedReferences(
        spielort_id=spiel.spielort.spielort_id if spiel.spielort is not None else None,
        schiedsrichter_id=spiel.schiedsrichter.schiedsrichter_id if spiel.schiedsrichter is not None else None,
    )


def find_new_bookings(stored: FLSpiel, payload: FLPatchSpielDataPayload, rules: FLSaisonRules) -> BookedReferences:
    """Which references `booking_unknown_resource` judges: each one this payload moves, and each one it keeps on a fixture it reopens."""

    chosen = _chosen_references(payload)
    held = _chosen_references(stored)

    # A retirement passes a played or called-off fixture by and leaves its booking, so the save
    # putting it back among those still to be played is the booking nothing judged.
    reopened = reopens(stored, ergebnis=compose_result(payload, rules).ergebnis, sonderereignis=payload.sonderereignis)

    return BookedReferences(
        spielort_id=chosen.spielort_id if reopened or chosen.spielort_id != held.spielort_id else None,
        schiedsrichter_id=chosen.schiedsrichter_id if reopened or chosen.schiedsrichter_id != held.schiedsrichter_id else None,
    )


# Where the save's payload holds each resource: a refusal about one names it, so the editor marks that field.
RESOURCE_PATHS: Final[Mapping[Literal["Spielort", "Schiedsrichter"], FieldPath]] = {
    "Spielort": ("spielort", "spielort_id"),
    "Schiedsrichter": ("schiedsrichter", "schiedsrichter_id"),
}


def find_booking_refusal(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    resolved: ResolvedReferences,
    rules: FLSaisonRules,
) -> WriteRefusal | None:
    """Why this patch's venue or referee must be refused, or `None`. Only a reference `find_new_bookings` names is judged.

    A booking naming nobody is kept where the fixture stores one and never made: only an erasure makes one.
    """

    stored = stored_in_slice(spiel_id, season)
    if (
        payload.schiedsrichter is not None
        and payload.schiedsrichter.schiedsrichter_id is None
        and (stored.schiedsrichter is None or stored.schiedsrichter.schiedsrichter_id is not None)
    ):
        return WriteRefusal(
            error_code=Code.BOOKING_UNKNOWN_RESOURCE,
            status=HTTPStatus.CONFLICT,
            fields=(RESOURCE_PATHS["Schiedsrichter"],),
        )

    new = find_new_bookings(stored, payload, rules)

    references = (
        (RESOURCE_PATHS["Spielort"], new.spielort_id, resolved.spielort),
        (RESOURCE_PATHS["Schiedsrichter"], new.schiedsrichter_id, resolved.schiedsrichter),
    )

    for path, chosen, row in references:
        if chosen is None:
            continue

        if row is None:
            return WriteRefusal(
                error_code=Code.BOOKING_UNKNOWN_RESOURCE,
                status=HTTPStatus.CONFLICT,
                fields=(path,),
            )

        if row.inactive_since is not None:
            return WriteRefusal(
                error_code=Code.BOOKING_UNKNOWN_RESOURCE,
                status=HTTPStatus.CONFLICT,
                fields=(path,),
            )

    # After both arms above, so a retired referee meets the retirement first.
    if new.schiedsrichter_id is not None and resolved.schiedsrichter is not None and not resolved.schiedsrichter.confirmed:
        return WriteRefusal(
            error_code=Code.BOOKING_UNCONFIRMED_SCHIEDSRICHTER,
            status=HTTPStatus.CONFLICT,
            fields=(RESOURCE_PATHS["Schiedsrichter"],),
        )

    return None


@dataclass(frozen=True)
class BookedSlot:
    """One other fixture's claim on a venue or a referee."""

    spiel_id: CustomObjectId
    # Beside the number, which is unique within one season alone, and this claim can sit in any.
    saison_id: str
    spiel_nr: int
    date: str
    time: str
    resource: Literal["Spielort", "Schiedsrichter"]


@dataclass(frozen=True)
class SlotClaim:
    """One venue or referee a fixture holds at the hour `spiel_double_booked` measures from."""

    resource: Literal["Spielort", "Schiedsrichter"]
    #: The `spiele` path holding the reference, which the read of the other fixtures is keyed on.
    field: Literal["spielort.spielort_id", "schiedsrichter.schiedsrichter_id"]
    reference: CustomObjectId
    date: str
    time: str


def find_slot_claims(spiel: BookedSpiel | FLPatchSpielDataPayload) -> list[SlotClaim]:
    """Every venue and referee `spiel_double_booked` judges on this fixture, asked of a payload and of the fixture it replaces alike."""

    # The same partition the read of the other fixtures filters on: an event that frees the slot cannot
    # double-book anything, and judging it would make the admin move the fixture before recording
    # that it was called off.
    if spiel.date is None or spiel.time is None or spiel.sonderereignis not in SONDEREREIGNIS_KEEPING_ITS_SLOT:
        return []

    held = _chosen_references(spiel)
    claims: list[SlotClaim] = []

    if held.spielort_id is not None:
        claims.append(SlotClaim("Spielort", "spielort.spielort_id", held.spielort_id, spiel.date, spiel.time))

    if held.schiedsrichter_id is not None:
        claims.append(SlotClaim("Schiedsrichter", "schiedsrichter.schiedsrichter_id", held.schiedsrichter_id, spiel.date, spiel.time))

    return claims


def find_claims_made(stored: BookedSpiel, payload: FLPatchSpielDataPayload) -> list[SlotClaim]:
    """Every claim this payload makes that the stored fixture did not already make.

    The one set `spiel_double_booked` judges and the save anchors, so neither covers a claim the other misses.
    """

    # A claim the fixture already made was in every rival's snapshot, or its maker anchored it. Judging
    # it again would refuse every save of a fixture a reopening left clashing, a note included, until
    # somebody moves it.
    standing = set(find_slot_claims(stored))

    return [claim for claim in find_slot_claims(payload) if claim not in standing]


def build_slot_holder_filter(claims: Sequence[SlotClaim]) -> dict[str, Any]:
    references: dict[str, set[Any]] = {}
    for claim in claims:
        references.setdefault(claim.field, set()).add(claim.reference)

    return {
        # No `saison_id`: a double booking crosses competitions.
        "$or": [{field: {"$in": list(ids)}} for field, ids in references.items()],
        # The neighbouring days too: the rule measures a real interval, so a fixture at 00:30 clashes with
        # one at 23:30 the evening before, which a read scoped to the claim's own date never fetches.
        "date": {"$in": sorted({day for claim in claims for day in days_a_clash_can_reach(claim.date)})},
        "time": {"$ne": None},
        # An abandoned match used the ground and the referee; the rest freed both.
        "sonderereignis": {"$in": list(SONDEREREIGNIS_KEEPING_ITS_SLOT)},
    }


def slots_booked_against(claim: SlotClaim, holders: Sequence[FLSpielSlotHolder], *, spiel_id: CustomObjectId) -> list[BookedSlot]:
    """Every fixture in `holders` but `spiel_id` holding `claim`'s row, as the refusal and its report both compare them."""

    return [
        BookedSlot(
            spiel_id=holder.id,
            saison_id=holder.saison_id,
            spiel_nr=holder.spiel_nr,
            date=holder.date,
            time=holder.time,
            resource=claim.resource,
        )
        for holder in holders
        if holder.id != spiel_id and _reference_of(_chosen_references(holder), claim.resource) == claim.reference
    ]


def find_references_to_anchor(stored: FLSpiel, payload: FLPatchSpielDataPayload, rules: FLSaisonRules) -> BookedReferences:
    """Every reference the save anchors: each `booking_unknown_resource` judges, and each `spiel_double_booked` claim `find_claims_made` names.

    Read off the two functions the rules read, so no anchor misses a reference a rule judged.
    """

    new = find_new_bookings(stored, payload, rules)
    made = {claim.resource for claim in find_claims_made(stored, payload)}

    chosen = _chosen_references(payload)

    return BookedReferences(
        spielort_id=chosen.spielort_id if new.spielort_id is not None or "Spielort" in made else None,
        schiedsrichter_id=chosen.schiedsrichter_id if new.schiedsrichter_id is not None or "Schiedsrichter" in made else None,
    )


def find_clash_refusal(*, date: str | None, time: str | None, booked: Sequence[BookedSlot]) -> WriteRefusal | None:
    """Why this fixture's venue or referee must be refused, or `None`. `booked` is every other fixture holding it."""

    if date is None or time is None:
        return None

    clash = _first_clash(date=date, time=time, booked=booked)
    if clash is None:
        return None

    slot, gap = clash

    return WriteRefusal(
        error_code=Code.SPIEL_DOUBLE_BOOKED,
        status=HTTPStatus.CONFLICT,
        fields=(RESOURCE_PATHS[slot.resource],),
    )


def _first_clash(*, date: str, time: str, booked: Sequence[BookedSlot]) -> tuple[BookedSlot, int] | None:
    """The earliest slot in `booked` less than the buffer away, and how far, for the refusal and the report alike."""

    start = _minutes_of(date, time)
    for slot in sorted(booked, key=lambda entry: (entry.date, entry.time, entry.saison_id, entry.spiel_nr)):
        gap = abs(_minutes_of(slot.date, slot.time) - start)
        if gap < CLASH_BUFFER_MINUTES:
            return slot, gap

    return None


def find_result_removal_refusal(spiel_id: CustomObjectId, payload: FLPatchSpielDataPayload, season: Sequence[FLSpiel]) -> WriteRefusal | None:
    """Why emptying a side that holds stored goals must be refused."""

    stored = stored_in_slice(spiel_id, season)

    for submitted, stored_side in ((payload.team1, stored.team1), (payload.team2, stored.team2)):
        if submitted is not None or stored_side is None or stored_side.tore is None:
            continue

        return WriteRefusal(
            error_code=Code.ERGEBNIS_SIDE_EMPTIED,
            status=HTTPStatus.CONFLICT,
        )

    return None


def find_departed_occupants(spiele: Sequence[FLSpielJoinedInternal]) -> list[FLBracketFaultOccupant]:
    """Every fixture fielding a team that left the season, in every phase."""

    faults: list[FLBracketFaultOccupant] = []
    for spiel in sorted(spiele, key=lambda entry: (entry.saison_id, entry.spiel_nr)):
        for side in ("team1", "team2"):
            occupant: FLSpielTeamFieldJoinedInternal | None = getattr(spiel, side)
            if occupant is None or occupant.austritt is None:
                continue

            # The internal fixture: the ordering is against the day a club left, which no served
            # side carries. The date rule is `eligibility_disqualified`'s.
            effective = occupant.austritt.date
            if spiel.date is not None and spiel.date < effective:
                continue

            if records_an_absence(side=side, sonderereignis=spiel.sonderereignis, saison_phase=spiel.saison_phase):
                continue

            faults.append(
                FLBracketFaultOccupant(
                    reason="departed_occupant",
                    spiel_id=spiel.id,
                    spiel_nr=spiel.spiel_nr,
                    side=side,
                    team_id=occupant.team_id,
                    team_name=occupant.name,
                    austritt_type=occupant.austritt.type,
                    exited_since=effective,
                    spiel_date=spiel.date,
                )
            )

    return faults


def _fielded_twice[Spiel: FLSpielCommon](spiele: Sequence[Spiel]) -> list[tuple[Spiel, FLSpielSide]]:
    """`spieltag_occupied`'s state, wherever a double entry got stored: each side whose club stands twice on its Spieltag.

    Grouped by matchday, never by season: nothing ties a fixture's `saison_id` to its matchday's.
    Sides rather than matches, so both sides of one fixture clash too.
    """

    keyed: list[tuple[tuple[CustomObjectId, CustomObjectId], Spiel, FLSpielSide]] = []

    for spiel in sorted(spiele, key=lambda entry: (entry.saison_id, entry.spiel_nr)):
        for side in ("team1", "team2"):
            occupant: FLSpielTeamField | None = getattr(spiel, side)
            if occupant is not None:
                keyed.append(((spiel.spieltag_id, occupant.team_id), spiel, side))

    # Built for every side and kept only where the club appears twice, so the report stays in fixture
    # order: each appearance is a place the correction could be made, and the choice is the admin's.
    appearances = Counter(key for key, _, _ in keyed)

    return [(spiel, side) for key, spiel, side in keyed if appearances[key] > 1]


def find_double_entries(spiele: Sequence[FLSpielJoinedInternal]) -> list[FLBracketFaultSpieltag]:
    """Every appearance `_fielded_twice` finds, as the report names it: off the joined fixtures, which carry each side's name."""

    faults: list[FLBracketFaultSpieltag] = []
    for spiel, side in _fielded_twice(spiele):
        occupant: FLSpielTeamFieldJoinedInternal = getattr(spiel, side)
        faults.append(
            FLBracketFaultSpieltag(
                reason="fielded_twice",
                spiel_id=spiel.id,
                spiel_nr=spiel.spiel_nr,
                spieltag_id=spiel.spieltag_id,
                side=side,
                team_id=occupant.team_id,
                team_name=occupant.name,
            )
        )

    return faults


def find_retired_bookings(
    spiele: Sequence[FLSpielJoinedAdmin],
    *,
    retired_venues: Mapping[CustomObjectId, str],
    retired_referees: Mapping[CustomObjectId, str],
) -> list[FLBracketFaultBooking]:
    """`booking_unknown_resource`'s state on a fixture still to be played, wherever it got stored."""

    faults: list[FLBracketFaultBooking] = []

    for spiel in sorted(spiele, key=lambda entry: (entry.saison_id, entry.spiel_nr)):
        # A played or called-off fixture keeps a retired row lawfully: `spielort_still_booked` lets the row retire past it.
        if not is_unplayed(ergebnis=spiel.ergebnis, sonderereignis=spiel.sonderereignis):
            continue

        if spiel.spielort is not None and (retired_on := retired_venues.get(spiel.spielort.spielort_id)) is not None:
            faults.append(
                FLBracketFaultBooking(
                    reason="retired_booking",
                    spiel_id=spiel.id,
                    spiel_nr=spiel.spiel_nr,
                    booking="spielort",
                    booking_id=spiel.spielort.spielort_id,
                    name=spiel.spielort.name,
                    inactive_since=retired_on,
                )
            )

        # A booking naming nobody joins no row, so neither a name nor a retirement.
        referee = spiel.schiedsrichter
        if (
            referee is not None
            and referee.schiedsrichter_id is not None
            and referee.name is not None
            and (retired_on := retired_referees.get(referee.schiedsrichter_id)) is not None
        ):
            faults.append(
                FLBracketFaultBooking(
                    reason="retired_booking",
                    spiel_id=spiel.id,
                    spiel_nr=spiel.spiel_nr,
                    booking="schiedsrichter",
                    booking_id=referee.schiedsrichter_id,
                    name=referee.name,
                    inactive_since=retired_on,
                )
            )

    return faults


def find_double_bookings(spiele: Sequence[FLSpielJoinedAdmin], holders: Sequence[FLSpielSlotHolder]) -> list[FLBracketFaultClash]:
    """`spiel_double_booked`'s state wherever stored; `holders` is every fixture of any season claiming one of these rows.

    Each fixture is judged as a save of it would be, so the report names the match that 409 names.
    """

    faults: list[FLBracketFaultClash] = []

    for spiel in sorted(spiele, key=lambda entry: (entry.saison_id, entry.spiel_nr)):
        for claim in find_slot_claims(spiel):
            clash = _first_clash(date=claim.date, time=claim.time, booked=slots_booked_against(claim, holders, spiel_id=spiel.id))
            if clash is None:
                continue

            slot, _ = clash
            held = spiel.spielort if claim.resource == "Spielort" else spiel.schiedsrichter

            faults.append(
                FLBracketFaultClash(
                    reason="double_booked",
                    spiel_id=spiel.id,
                    spiel_nr=spiel.spiel_nr,
                    saison_id=spiel.saison_id,
                    booking="spielort" if claim.resource == "Spielort" else "schiedsrichter",
                    name=held.name if held is not None else None,
                    other_spiel_id=slot.spiel_id,
                    other_saison_id=slot.saison_id,
                    other_spiel_nr=slot.spiel_nr,
                    other_date=slot.date,
                    other_time=slot.time,
                )
            )

    return faults


def _reference_of(references: BookedReferences, resource: Literal["Spielort", "Schiedsrichter"]) -> CustomObjectId | None:
    return references.spielort_id if resource == "Spielort" else references.schiedsrichter_id


@dataclass(frozen=True)
class SpieltagRelease:
    """One side emptied so a team can be fielded here. Carries what that fixture loses, or a deleted scoreline reads as an emptied slot."""

    spiel_id: CustomObjectId
    spiel_nr: int
    side: FLSpielSide
    team_name: str
    other_side_present: bool
    voided_ergebnis: str | None
    voided_elfmeterschiessen: FLSpielElfmeterschiessen | None
    # Carried because the `$set` cannot read the fixture it empties.
    voided_sonderereignis: FLSonderereignis | None


@dataclass(frozen=True)
class SpieltagVerdict:
    """What fielding this payload does to the rest of the Spieltag; `releases` is void unless `refusal` is `None`."""

    refusal: WriteRefusal | None
    releases: list[SpieltagRelease]


def judge_spieltag_occupancy(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    teams: Mapping[CustomObjectId, SaisonMembership],
) -> SpieltagVerdict:
    """Where this payload's teams already stand on the same Spieltag; `teams` names a released side as its season row does."""

    stored = stored_in_slice(spiel_id, season)

    if payload.team1 is not None and payload.team2 is not None and payload.team1.team_id == payload.team2.team_id:
        return SpieltagVerdict(
            refusal=WriteRefusal(
                error_code=Code.SPIELTAG_OCCUPIED,
                status=HTTPStatus.CONFLICT,
            ),
            releases=[],
        )

    fielded = {side.team_id for side in (payload.team1, payload.team2) if side is not None}
    releases: list[SpieltagRelease] = []

    same_spieltag = (spiel for spiel in season if spiel.id != spiel_id and spiel.spieltag_id == stored.spieltag_id)

    # Sorted, so a refusal names the earliest offending fixture and two runs plan the same releases.
    for other in sorted(same_spieltag, key=lambda spiel: spiel.spiel_nr):
        sides: tuple[tuple[FLSpielSide, FLSpielTeamField | None, FLSpielQuelle | None], ...] = (
            ("team1", other.team1, other.team1_quelle),
            ("team2", other.team2, other.team2_quelle),
        )

        for label, occupant, quelle in sides:
            if occupant is None or occupant.team_id not in fielded:
                continue

            if quelle is not None:
                return SpieltagVerdict(
                    refusal=WriteRefusal(
                        error_code=Code.SPIELTAG_OCCUPIED,
                        status=HTTPStatus.CONFLICT,
                    ),
                    releases=[],
                )

            releases.append(
                SpieltagRelease(
                    spiel_id=other.id,
                    spiel_nr=other.spiel_nr,
                    side=label,
                    # The released club is the one this payload fields, so it holds a row this season.
                    team_name=teams[occupant.team_id].name,
                    # The write path strips the other side's goals -- scored against the team being
                    # removed -- so it has to know whether a side is there to strip.
                    other_side_present=(other.team2 if label == "team1" else other.team1) is not None,
                    voided_ergebnis=other.ergebnis,
                    voided_elfmeterschiessen=other.elfmeterschiessen,
                    voided_sonderereignis=voided_no_show(other.sonderereignis),
                )
            )

    return SpieltagVerdict(refusal=None, releases=releases)


def find_advancement_occupancy_refusal(season: Sequence[FLSpielCommon], advancements: Sequence[SlotAdvancement]) -> WriteRefusal | None:
    """Why resolving the bracket must be refused, or `None`.

    `judge_spieltag_occupancy` sees only the sides a request fields, so the sides the resolution
    fills from the wiring reach no rule at all.
    """

    moved = {advancement.spiel_id: advancement for advancement in advancements}
    resolved = [
        spiel.model_copy(update={"team1": moved[spiel.id].team1, "team2": moved[spiel.id].team2}) if spiel.id in moved else spiel
        for spiel in season
    ]

    # `_fielded_twice` on both sides, never a second reading of it: what counts as one club standing
    # twice is decided in one place, and the fault the report shows is the same one.
    def keys(spiele: Sequence[FLSpielCommon]) -> set[tuple[CustomObjectId, CustomObjectId]]:
        return {(spiel.spieltag_id, getattr(spiel, side).team_id) for spiel, side in _fielded_twice(spiele)}

    # A pair already stored is skipped: refusing over a standing fault would block every edit that could repair it.
    if not keys(resolved) - keys(season):
        return None

    return WriteRefusal(
        error_code=Code.SPIELTAG_OCCUPIED_BY_THE_RESOLUTION,
        status=HTTPStatus.CONFLICT,
    )


# The deleted result's own fields, whichever report carries it: a released side's adds which side and whose.
_VOIDED_FIELDS: Final = frozenset(FLSpielVoidedResult.model_fields)


def _voided_key(result: FLSpielVoidedResult) -> str:
    """One deleted result as a comparable identity: its fixture and each value it held."""

    return result.model_dump_json(include=set(_VOIDED_FIELDS))


def voided_results_of(rewrites: Iterable[FLSpielVoidedResult]) -> list[FLSpielVoidedResult]:
    """Every stored result `rewrites` delete, each once, in their fixtures' numbers' order; a slot filled from empty deletes none.

    One reading for the dry run's answer and the save's judgement, so the set a person confirms is the set the save
    compares. A fixture releasing both its sides deletes its one result once.
    """

    voided = {
        _voided_key(rewrite): FLSpielVoidedResult.model_validate(rewrite.model_dump(include=set(_VOIDED_FIELDS), context={"keep_oid": True}))
        for rewrite in rewrites
        if rewrite.voided_ergebnis is not None or rewrite.voided_elfmeterschiessen is not None or rewrite.voided_sonderereignis is not None
    }

    return sorted(voided.values(), key=lambda result: result.spiel_nr)


def find_voided_results_refusal(*, confirmed: Iterable[FLSpielVoidedResult], voided: Iterable[FLSpielVoidedResult]) -> WriteRefusal | None:
    """Refuse a save deleting later results other than those it confirms, by value.

    By value as well as by fixture, so a result changed since the question was asked is asked about again.
    """

    if {_voided_key(result) for result in confirmed} == {_voided_key(result) for result in voided}:
        return None

    return WriteRefusal(error_code=Code.VOIDED_RESULTS_STALE, status=HTTPStatus.CONFLICT)


def _quelle_key(quelle: FLSpielQuelle) -> tuple[Any, ...]:
    """One source as a hashable identity, so 'the same outcome feeding two slots' is a set lookup."""

    if isinstance(quelle, FLSpielQuelleSpiel):
        return ("spiel", quelle.spiel_nr, quelle.ausgang)
    return ("gruppe", quelle.gruppe, quelle.platz)


def _wiring_refusal() -> WriteRefusal:
    """One code for every shape with the same repair -- the season moved under the page, so reload."""

    return WriteRefusal(error_code=Code.WIRING_UNSUPPORTED, status=HTTPStatus.CONFLICT)


def find_wiring_refusal(
    spiel_id: CustomObjectId,
    payload: FLPatchSpielDataPayload,
    season: Sequence[FLSpiel],
    *,
    # No default: a caller that forgot it would accept a slot wired to a group the season does not run.
    number_of_gruppen: int,
) -> WriteRefusal | None:
    """Why this patch's bracket wiring must be refused -- the write path only."""

    stored = stored_in_slice(spiel_id, season)

    by_nr = {spiel.spiel_nr: spiel for spiel in season}
    used = {
        _quelle_key(quelle)
        for spiel in season
        if spiel.id != spiel_id
        for quelle in (spiel.team1_quelle, spiel.team2_quelle)
        if quelle is not None
    }

    sides = (
        ("team1", payload.team1, payload.team1_quelle, stored.team1_quelle),
        ("team2", payload.team2, payload.team2_quelle, stored.team2_quelle),
    )

    # A source this payload keeps is not judged below, but the season still holds it, so the other
    # side cannot be pointed at it. Seeded before the loop, so the answer does not depend on which
    # side the admin moved.
    used |= {_quelle_key(quelle) for _, _, quelle, stored_quelle in sides if quelle is not None and quelle == stored_quelle}

    opening_round_rank = _opening_round_rank(season)

    for _, _, quelle, stored_quelle in sides:
        # The payload replaces the fixture wholesale, so a rule reading it alone would latch every
        # later edit of a fixture already wired this way.
        if quelle is None or quelle == stored_quelle:
            continue

        if stored.saison_phase == "gruppenphase":
            return _wiring_refusal()

        if isinstance(quelle, FLSpielQuelleSpiel):
            source = by_nr.get(quelle.spiel_nr)
            if source is None:
                return _wiring_refusal()
            if source.saison_phase == "gruppenphase":
                return _wiring_refusal()
            if PHASE_RANK[source.saison_phase] >= PHASE_RANK[stored.saison_phase]:
                return _wiring_refusal()

        # Before the round check, as a dangling `spiel_nr` is judged before its phase: whether the
        # season runs the group at all comes first, whichever round the slot is in.
        if isinstance(quelle, FLSpielQuelleGruppe) and quelle.gruppe not in offered_gruppen(number_of_gruppen):
            return WriteRefusal(
                error_code=Code.WIRING_GRUPPE_NOT_RUN,
                status=HTTPStatus.CONFLICT,
            )

        if isinstance(quelle, FLSpielQuelleGruppe) and opening_round_rank is not None and opening_round_rank < PHASE_RANK[stored.saison_phase]:
            return WriteRefusal(
                error_code=Code.WIRING_SEED_PAST_THE_OPENING_ROUND,
                status=HTTPStatus.CONFLICT,
            )

        key = _quelle_key(quelle)
        if key in used:
            return _wiring_refusal()
        used.add(key)

    for label, team, quelle, _ in sides:
        if quelle is None:
            continue

        stored_team = stored.team1 if label == "team1" else stored.team2
        stored_id = stored_team.team_id if stored_team is not None else None
        submitted_id = team.team_id if team is not None else None
        if stored_id != submitted_id:
            return _wiring_refusal()

    return None


# Where `build_party_name_stages` sets a confirmation row's party's name.
PARTY_NAME_FIELD: Final = "party_name"


def build_party_name_stages(*, saison_id: str) -> list[Mapping[str, Any]]:
    """Stages setting on each confirmation row the name its party's own record holds: a club's season row, a referee's."""

    return [
        {
            "$lookup": {
                "from": Collection.SAISON_TEAMS,
                "localField": "party.team_id",
                "foreignField": "team_id",
                "pipeline": [{"$match": {"saison_id": saison_id}}, {"$project": {"_id": 0, "name": 1}}],
                "as": "club",
            }
        },
        {
            "$lookup": {
                "from": Collection.SCHIEDSRICHTER,
                "localField": "party.schiedsrichter_id",
                "foreignField": "_id",
                "pipeline": [{"$project": {"_id": 0, "name": 1}}],
                "as": "referee",
            }
        },
        {"$set": {PARTY_NAME_FIELD: {"$first": {"$concatArrays": ["$club.name", "$referee.name"]}}}},
        {"$unset": ["club", "referee"]},
    ]


def recipients_named(parties: Sequence[Mapping[str, Any]], *, names: Mapping[tuple[str, Any], str | None]) -> list[FLSpielRecipient]:
    """Each party an act mails by the name its own record holds, the one shape every page naming whom an act mails reads.

    Every row's party holds a record: a club its season row, which nothing deletes, and a referee their own, which an
    erasure deletes in the transaction removing every row naming them. No row names nobody, since the pass mints no row
    for a booking naming nobody. So a party `names` lacks is a broken reference, refused rather than dropped from the
    question in silence.
    """

    unnamed = [party for party in parties if names.get(party_key(party)) is None]
    if unnamed:
        raise ValueError(f"no record names the parties {unnamed}")

    return FLSpielRecipientListAdapter.validate_python([{**party, "name": names[party_key(party)]} for party in parties])
