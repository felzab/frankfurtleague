"""
CORE · the domain model, as a declaration

What the entities are, which form one consistency boundary, what happens to a reference when its
target changes, and when each field may be written. Everything here is data — no evaluator, and
nothing calls it at request time: enforcement stays at the write endpoints, and this is the model
stated once for a conformance test to compare against the code (ADR-0053).

Invariants:
- No application code imports this module — only the conformance test and the documentation read it.
- Every `implemented_by` and `tested_by` names a real symbol, resolved by `tests/core/test_domain.py`.
- A referential action names what the code does, never what it ought to do.
- Only fields whose answer is not plainly `EDITABLE` are listed.

See:
- docs/domain.md — the reader's version of everything below
- ADR-0053 — the domain model is declared and conformance-checked
"""

from dataclasses import dataclass
from enum import StrEnum

from app.core.collections import Collection


class Action(StrEnum):
    """
    What happens to a referencing row when its target changes or goes away.

    SQL's own vocabulary, because it is precise and widely understood -- and because MongoDB enforces none
    of it, so naming the intended behaviour is the only way the intention is written down at all.

    **An enum rather than a `Literal`, which is the other way round from every closed set in
    `app/api/*/schemas.py`, and the difference is what the value IS.** `FLSaisonStatus` is a `Literal`
    because the string is DATA: it is stored in MongoDB, enumerated in a `$jsonSchema` validator and
    published in `openapi.json`, so the wire format needs the bare value. This is internal vocabulary that
    is never stored, never serialised and never leaves the process -- so it wants the three things an enum
    gives and a `Literal` cannot: a namespace at the call site, per-member documentation attached to the
    member, and iteration, which `test_every_declared_value_is_used` needs.

    `StrEnum` and not the `(str, Enum)` mixin: on Python 3.12+ the mixin renders as `Action.RESTRICT`
    inside an f-string, so a test failure message names the enum instead of the value. `StrEnum` renders
    as `RESTRICT` and still compares equal to the plain string.
    """

    #: The operation is refused while a reference exists, by a `find_*_refusal` at the write.
    RESTRICT = "RESTRICT"
    CASCADE = "CASCADE"
    #: The reference is emptied and the referencing row survives. Declared vocabulary; see `UNUSED_ACTIONS`.
    SET_NULL = "SET_NULL"
    #: Nothing happens, deliberately. The reference is left alone and stays resolvable.
    NO_ACTION = "NO_ACTION"


class Editability(StrEnum):
    """When a field may be written. `COMPOSED`, `DERIVED` and `IMMUTABLE` are where the distinctions earn their keep."""

    EDITABLE = "EDITABLE"
    #: Writable in some states and refused in others. `condition` says which.
    CONDITIONAL = "CONDITIONAL"
    #: On no payload. Written only by a named control, which owns the whole transition.
    CONTROL_ONLY = "CONTROL_ONLY"
    #: On no payload, and STORED: the server composes it from fields the payload does carry.
    COMPOSED = "COMPOSED"
    #: Computed on read and stored nowhere. Asserted: a derived field is on no validator.
    DERIVED = "DERIVED"
    #: Written once, at create, and never again.
    IMMUTABLE = "IMMUTABLE"


# `SET_NULL` is declared and used by no reference -- a statement, not an oversight: no reference here
# is emptied because its target moved. A bracket slot whose feeder cannot be resolved KEEPS its
# occupant and is reported as a fault (ADR-0039).
UNUSED_ACTIONS: frozenset[Action] = frozenset({Action.SET_NULL})


@dataclass(frozen=True)
class Aggregate:
    """
    One consistency boundary: a root plus the collections whose invariants are checked against it.

    Membership is decided by ONE question -- does an invariant hold this collection and the root true
    together? -- and not by whether one document points at another. `spiele` points at `spieltage` and
    they are separate aggregates, because no rule spans a matchday and a fixture.
    """

    name: str
    root: Collection
    members: tuple[Collection, ...]
    #: **THE INVARIANT, then what it means for membership.** One or two sentences: the first names the rule
    #: that holds root and members true together, the second (where there is one) says what that excludes.
    boundary: str


@dataclass(frozen=True)
class Reference:
    """One directed reference between two collections, and what the code does about it."""

    source: Collection
    #: Every field path carrying this reference. Real paths, so the conformance test resolves them.
    fields: tuple[str, ...]
    target: Collection
    on_target_change: Action
    on_target_removed: Action
    #: **WHAT THE CODE DOES, then what it deliberately does not.** The first sentence states the action in
    #: the present tense; the second names the part a reader would otherwise assume travels with it.
    note: str


@dataclass(frozen=True)
class FieldPolicy:
    """When one field may be written, and what enforces that."""

    collection: Collection
    field: str
    editability: Editability
    #: **WHEN, then WHY.** Opens with the timing word the editability turns on -- "frozen once",
    #: "written only by", "computed from" -- and the reason follows after a colon. Empty only where the
    #: field is plainly `EDITABLE`.
    condition: str = ""
    #: A dotted path to what enforces it, or "" where the enforcement is an ABSENCE -- no payload carries
    #: the field, which is not a symbol that can be named.
    enforced_by: str = ""


@dataclass(frozen=True)
class Rule:
    """One refusal a write path performs."""

    code: str
    #: The endpoints that perform it, ` . `-separated where more than one does.
    operation: str
    aggregate: str
    #: **ONE CLAUSE naming what is refused, present tense, no closing period.** It is a table cell rather
    #: than a sentence, and the reason lives in the constant's own comment beside the code.
    summary: str
    implemented_by: str
    tested_by: str
    #: True where the rule needs more than the payload and its own document. These are the rules a
    #: uniform evaluator could not have expressed, because they read the aggregate rather than a row.
    multi_document: bool = False


@dataclass(frozen=True)
class Unenforced:
    """
    A state the system permits on purpose, and what shows it to a person instead.

    Named because an absence looks identical to an omission.
    """

    #: **THE STATE, as a noun phrase.** Not a sentence: it completes "the system permits ...".
    subject: str
    #: **WHY REFUSING WOULD BE WRONG, then what happens instead.** Always in that order -- the cost of the
    #: rule first, because that is the argument, and the mitigation second.
    reason: str
    #: The surface reporting the state, or "" where nothing does and nothing needs to.
    surfaced_by: str = ""


AGGREGATES: tuple[Aggregate, ...] = (
    Aggregate(
        name="Saison",
        root=Collection.SAISONS,
        members=(Collection.SAISON_TEAMS, Collection.SAISON_SPIELER),
        boundary=(
            "A season's `rules` bound its own entries: a junction row's group must be one the season runs "
            "and within its capacity, and both are checked against the root on every write from either "
            "side. `saison_spieler` joins for its identity being (player, season) and for `stufe` being "
            "offered by the root."
        ),
    ),
    Aggregate(
        name="Saison-Spielplan",
        root=Collection.SPIELE,
        members=(),
        boundary=(
            "One season's fixtures, as a set. Resolving the bracket reads every fixture of the season and "
            "may rewrite any of them, so a single match is not a boundary -- the season's fixture set is."
        ),
    ),
    Aggregate(
        name="Spieltag",
        root=Collection.SPIELTAGE,
        members=(),
        boundary=(
            "A matchday alone. Nothing holds a matchday and its fixtures true together: its position and "
            "its expected match count are both derived from elsewhere, and retiring one leaves its "
            "matches untouched."
        ),
    ),
    Aggregate(
        name="Team",
        root=Collection.TEAMS,
        members=(),
        boundary="A club, season-independent. Every season-scoped fact about it lives on `saison_teams`.",
    ),
    Aggregate(
        name="Spieler",
        root=Collection.SPIELER,
        members=(),
        boundary="A person, season-independent. Everything a squad list shows lives on `saison_spieler`.",
    ),
    Aggregate(
        name="Spielort",
        root=Collection.SPIELORTE,
        members=(),
        boundary="A venue. Reached from a match through an embedded display copy beside the id.",
    ),
    Aggregate(
        name="Schiedsrichter",
        root=Collection.SCHIEDSRICHTER,
        members=(),
        boundary="A referee. Reached from a match the way a venue is.",
    ),
)


REFERENCES: tuple[Reference, ...] = (
    Reference(
        source=Collection.SPIELE,
        fields=("team1.team_id", "team2.team_id"),
        target=Collection.TEAMS,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "A rename fans out into every match's embedded `name` and `shorthand` "
            "(`app/api/teams/admin_router.py :: patch_team`). Retirement is soft and touches no match: "
            "the embedded copy is what a played fixture said at the time."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("ort.spielort_id",),
        target=Collection.SPIELORTE,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "The name and the maps link fan out; `mietpreis` deliberately does not (ADR-0021 rule 2). It "
            "records what this fixture cost, so rewriting it would rewrite history."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("schiedsrichter.schiedsrichter_id",),
        target=Collection.SCHIEDSRICHTER,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note="The name fans out; `payment` does not, for the reason `mietpreis` does not.",
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("spieltag_id",),
        target=Collection.SPIELTAGE,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Nothing is embedded, so a renamed or re-dated matchday is picked up on the next read. "
            "Retiring a matchday leaves its matches fully readable, which is why that delete is soft."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "There is no `DELETE /saisons/{saison_id}` at all: removing a season would orphan this and every other reference to it (ADR-0026)."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("team1_quelle.spiel_nr", "team2_quelle.spiel_nr"),
        target=Collection.SPIELE,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Entering a result re-resolves every slot that match feeds (ADR-0034). A `spiel_nr` the season "
            "has no match for LEAVES the slot alone and is reported as a bracket fault (ADR-0039) -- "
            "'nothing to look up' never empties a slot."
        ),
    ),
    Reference(
        source=Collection.SPIELTAGE,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note="No season delete exists, and `saison_id` is absent from the matchday patch payload, so a matchday cannot change seasons either.",
    ),
    Reference(
        source=Collection.SAISON_TEAMS,
        fields=("team_id",),
        target=Collection.TEAMS,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "Retiring a club is refused while a running or planned season holds it (`REQ-RETIRE-001`). A "
            "past season's rows survive the retirement, because those seasons still happened."
        ),
    ),
    Reference(
        source=Collection.SAISON_TEAMS,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_target_change=Action.RESTRICT,
        on_target_removed=Action.RESTRICT,
        note=(
            "The season's `rules` bound these rows, so narrowing `number_of_groups` or `teams_per_group` "
            "below what they occupy is refused (`REQ-RULES-002`, `REQ-RULES-003`). There is no row delete "
            "either: a team leaves a season only by disqualification (ADR-0026)."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "`erlaubte_stufen` bounds what the squad FORM offers and not what a row holds, so narrowing it "
            "strands nothing (ADR-0048). No season delete exists."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("team_id",),
        target=Collection.TEAMS,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Nothing is embedded and nothing is refused: a squad row pointing at a retired club still "
            "resolves, and the admin list renders it rather than hiding it."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("spieler_id",),
        target=Collection.SPIELER,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note="Retiring the person leaves every squad row intact -- the seasons they played still happened (ADR-0025).",
    ),
)


FIELD_POLICIES: tuple[FieldPolicy, ...] = (
    FieldPolicy(Collection.SAISONS, "id", Editability.IMMUTABLE, "chosen at create; every `saison_id` in the database references this value"),
    FieldPolicy(
        Collection.SAISONS,
        "status",
        Editability.CONTROL_ONLY,
        "`POST /saisons/{saison_id}/activate`, which demotes the incumbent in the same transaction (ADR-0026)",
        "app.api.saisons.admin_router.activate_saison",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "start_date",
        Editability.EDITABLE,
        "editable even on a finished season, and refused only where the new span would stop covering a live matchday (`REQ-DATE-004`)",
        "app.api.saisons.services.find_saison_span_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "end_date",
        Editability.EDITABLE,
        "editable even on a finished season -- correcting a mistyped date changes nothing anybody competed "
        "for -- under the same span rule as `start_date`",
        "app.api.saisons.services.find_saison_span_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.win_points",
        Editability.CONDITIONAL,
        "frozen once the season is `past`: the table is scored from it on every read, so a change rewrites the result",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.draw_points",
        Editability.CONDITIONAL,
        "frozen once the season is `past`, for the reason `win_points` is",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.qualifiers_per_group",
        Editability.CONDITIONAL,
        "frozen on a `past` season; never below a placing a bracket slot already names; the product "
        "with `number_of_groups` must be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.number_of_groups",
        Editability.CONDITIONAL,
        "never below a group that still holds teams; the product with `qualifiers_per_group` must be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.teams_per_group",
        Editability.CONDITIONAL,
        "never below the fullest group's occupancy",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.erlaubte_stufen",
        Editability.EDITABLE,
        "narrowing is safe at any time, a finished season included: it bounds what a FORM offers and "
        "never what a stored squad row holds (ADR-0048)",
    ),
    FieldPolicy(
        Collection.SPIELTAGE,
        "saison_id",
        Editability.IMMUTABLE,
        "absent from the patch payload: moving a matchday between seasons would strand its matches",
    ),
    FieldPolicy(
        Collection.SPIELTAGE,
        "anzahl_spiele",
        Editability.DERIVED,
        "computed from the season's `rules` and this matchday's phase (ADR-0052)",
        "app.api.saisons.schedule.expected_matches",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "schedule",
        Editability.DERIVED,
        "computed from this season's own `rules` (ADR-0052): the whole phase-by-phase shape the matchday "
        "above reports one entry of. Served so the matchday editor can refuse `REQ-SPIELTAG-002` before "
        "the request, which needs the count for a phase the matchday does not have yet",
        "app.api.saisons.schedule.schedule_for",
    ),
    FieldPolicy(
        Collection.SPIELTAGE,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it (ADR-0025)",
        "app.api.spieltage.admin_router.delete_spieltag",
    ),
    FieldPolicy(
        Collection.TEAMS,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it, and is refused while a running or planned season holds the club",
        "app.api.teams.services.find_retire_refusal",
    ),
    FieldPolicy(
        Collection.TEAMS, "statistik", Editability.DERIVED, "the league table, aggregated from the season's matches on every read (ADR-0019)"
    ),
    FieldPolicy(
        Collection.TEAMS,
        "gruppe",
        Editability.DERIVED,
        "joined from `saison_teams` for the season being read; the writable copy is the junction row's own field",
    ),
    FieldPolicy(Collection.TEAMS, "disqualifikation", Editability.DERIVED, "joined from `saison_teams`, like `gruppe`"),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "gruppe",
        Editability.CONDITIONAL,
        "held to the groups the season runs and to their capacity on every write; a row is created only while the season is `future`, "
        "a single move is refused once the started season has drawn its fixtures, and what stays open is a two-club swap of clubs that "
        "have not yet played inside their groups (ADR-0062)",
        "app.api.teams.services.find_entry_refusal",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "disqualifikation",
        Editability.EDITABLE,
        "required on the payload with no default, so an omitted one is a 422 rather than a team quietly reinstated (ADR-0047)",
    ),
    FieldPolicy(
        Collection.SPIELER,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it; this is the PERSON leaving the league (ADR-0025)",
    ),
    FieldPolicy(
        Collection.SAISON_SPIELER,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "the SQUAD ROW's own retirement, independent of the person's; creating never revives one, "
        "which is why 409 is the right answer (ADR-0025)",
    ),
    FieldPolicy(
        Collection.SAISON_SPIELER,
        "stufe",
        Editability.CONDITIONAL,
        "held to the league's closed set by the validator, and to the season's `erlaubte_stufen` by what the form offers (ADR-0048)",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "spiel_nr",
        Editability.IMMUTABLE,
        "a season's fixtures are created once; `/spiele` has no POST and no DELETE (ADR-0037)",
    ),
    FieldPolicy(Collection.SPIELE, "saison_id", Editability.IMMUTABLE, "for the reason `spiel_nr` is"),
    FieldPolicy(
        Collection.SPIELE,
        "saison_phase",
        Editability.IMMUTABLE,
        "for the reason `spiel_nr` is; a fixture's phase is settled when the schedule is drawn",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "spieltag_id",
        Editability.IMMUTABLE,
        "absent from the patch payload; a fixture is moved by editing the matchday's dates, not by reassigning the fixture",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "ergebnis",
        Editability.COMPOSED,
        "composed from `team1.tore` and `team2.tore` and never accepted from a client, so the stored "
        "string cannot disagree with the goals it formats",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team1",
        Editability.CONDITIONAL,
        "a side carrying a `quelle` is maintained by the bracket resolution and is not the admin's to "
        "set; clearing the `quelle` is how a person takes the slot back (ADR-0034)",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team2",
        Editability.CONDITIONAL,
        "for the reason `team1` is",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "elfmeterschiessen",
        Editability.CONDITIONAL,
        "discarded unless the goals it accompanies are level and the phase is a knockout, so a "
        "shoot-out cannot be stored against a fixture one side already won (ADR-0036)",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team1_quelle",
        Editability.CONDITIONAL,
        "never on a group-phase fixture, never naming a later or missing match, and never feeding one "
        "outcome into two slots (`REQ-WIRING-001`)",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team2_quelle",
        Editability.CONDITIONAL,
        "for the reason `team1_quelle` is",
        "app.api.spiele.services.find_wiring_refusal",
    ),
)


RULES: tuple[Rule, ...] = (
    Rule(
        code="REQ-RULES-001",
        operation="POST /saisons · PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`number_of_groups` x `qualifiers_per_group` must be a power of two the phase set can hold",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestTheBracketMustHaveAShape",
    ),
    Rule(
        code="REQ-RULES-007",
        operation="POST /saisons · PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`qualifiers_per_group` may not exceed `teams_per_group`",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestAGroupCannotQualifyMoreThanItHolds",
    ),
    Rule(
        code="REQ-RULES-002",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`number_of_groups` may not drop below a group that still holds teams",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestNarrowingTheGroupCount",
        multi_document=True,
    ),
    Rule(
        code="REQ-RULES-003",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`teams_per_group` may not drop below the fullest group's occupancy",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestNarrowingTheCapacity",
        multi_document=True,
    ),
    Rule(
        code="REQ-RULES-004",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`qualifiers_per_group` may not drop below a placing a bracket slot already names",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestNarrowingTheQualifiers",
        multi_document=True,
    ),
    Rule(
        code="REQ-RULES-005",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="a finished season's points and qualifier count are frozen, because the table is derived from them",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestAFinishedSeasonFreezes",
    ),
    Rule(
        code="REQ-RULES-006",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="a narrowing may not leave a matchday holding more fixtures than its phase accounts for",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestNarrowingBelowAMatchdaysFixtures",
        multi_document=True,
    ),
    Rule(
        code="REQ-DATE-004",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="a season's span may not shrink below a live matchday's own",
        implemented_by="app.api.saisons.services.find_saison_span_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASeasonKeepsCoveringItsMatchdays",
        multi_document=True,
    ),
    Rule(
        code="REQ-ACTIVATE-001",
        operation="POST /saisons/{saison_id}/activate",
        aggregate="Saison",
        summary="the outgoing season's fixtures must all be played or cancelled before it is closed",
        implemented_by="app.api.saisons.services.find_activation_refusal",
        tested_by="tests/api/test_activation_refusal.py::TestTheOutgoingSeasonMustBeFinished",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-001",
        operation="POST /teams/{team_id}/saisons",
        aggregate="Saison",
        summary="a team enters a season only while that season is `future`",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
    ),
    Rule(
        code="REQ-ENTER-002",
        operation="POST /teams/{team_id}/saisons · PATCH /teams/{team_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="the group must be one the season runs",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
    ),
    Rule(
        code="REQ-ENTER-003",
        operation="POST /teams/{team_id}/saisons · PATCH /teams/{team_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="the group must have space, and a disqualified team still holds its place",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-004",
        operation="PATCH /teams/{team_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="a group change is refused once the season has started and the team's fixtures are drawn",
        implemented_by="app.api.teams.services.find_gruppe_move_refusal",
        tested_by="tests/api/test_gruppe_move_refusal.py::TestTheWindowForAGroupChange",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-001",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary="a swap names two clubs of this season standing in different groups, or it is not a swap",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestWhatCountsAsASwap",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-002",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary="no group swap once a knockout fixture carries a result, because the seeding has consumed the standings",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestTheKnockoutClosesTheWindow",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-003",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary="no group swap in a `past` season, whose table is derived from these groups and is the record of what happened",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestAFinishedSeasonIsFrozen",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-004",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary="no group swap once either club has played or called off a gruppenphase fixture; neither group would be a round robin",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestTheRoundRobinClosesTheWindow",
        multi_document=True,
    ),
    Rule(
        code="REQ-RETIRE-001",
        operation="DELETE /teams/{team_id}",
        aggregate="Team",
        summary="a club entered in a running or planned season may not be retired",
        implemented_by="app.api.teams.services.find_retire_refusal",
        tested_by="tests/api/test_team_retire_refusal.py::TestRetiringAClub",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELTAG-003",
        operation="POST /spieltage",
        aggregate="Spieltag",
        summary="a season whose knockout phase has started takes no new matchdays",
        implemented_by="app.api.spieltage.services.find_spieltag_create_refusal",
        tested_by="tests/api/test_spieltag_refusals.py::TestCreatingAMatchday",
        multi_document=True,
    ),
    Rule(
        code="REQ-DATE-002",
        operation="POST /spieltage · PATCH /spieltage/{spieltag_id}",
        aggregate="Spieltag",
        summary="a matchday's span must fall inside its season's",
        implemented_by="app.api.spieltage.services.find_spieltag_span_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestAMatchdaySitsInsideItsSeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-DATE-003",
        operation="PATCH /spieltage/{spieltag_id}",
        aggregate="Spieltag",
        summary="a matchday's span may not shrink below a date one of its own fixtures holds",
        implemented_by="app.api.spieltage.services.find_spieltag_span_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestAMatchdayKeepsCoveringItsFixtures",
        multi_document=True,
    ),
    Rule(
        code="REQ-RETIRE-002",
        operation="DELETE /spieltage/{spieltag_id}",
        aggregate="Spieltag",
        summary="a matchday holding a played match may not be retired, because retiring it unpublishes the result",
        implemented_by="app.api.spieltage.services.find_spieltag_retire_refusal",
        tested_by="tests/api/test_spieltag_refusals.py::TestRetiringAMatchday",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELTAG-002",
        operation="PATCH /spieltage/{spieltag_id}",
        aggregate="Spieltag",
        summary="a matchday's phase may not account for fewer matches than the matchday already holds",
        implemented_by="app.api.spieltage.services.find_spieltag_phase_refusal",
        tested_by="tests/api/test_spieltag_refusals.py::TestChangingThePhase",
        multi_document=True,
    ),
    Rule(
        code="REQ-DATE-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a fixture's date must fall inside the span of the matchday it belongs to",
        implemented_by="app.api.spiele.services.find_fixture_date_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestAFixtureSitsInsideItsMatchday",
        multi_document=True,
    ),
    Rule(
        code="REQ-CLASH-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a venue and a referee need four hours between two fixtures they both serve",
        implemented_by="app.api.spiele.services.find_clash_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestOneVenueAndOneRefereeAtATime",
        multi_document=True,
    ),
    Rule(
        code="REQ-WIRING-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary=(
            "the wiring must be one the season can hold: no `quelle` on a group fixture, no dangling or "
            "later feeder, no outcome feeding two slots, no hand-set team on a maintained side"
        ),
        implemented_by="app.api.spiele.services.find_wiring_refusal",
        tested_by="tests/api/test_wiring_refusal.py::TestPhaseRules",
        multi_document=True,
    ),
    Rule(
        code="REQ-ELIGIBILITY-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a disqualified team may not be NEWLY fielded on or after the disqualification, unless the fixture is a cancelled group match",
        implemented_by="app.api.spiele.services.find_eligibility_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestEligibility",
        multi_document=True,
    ),
    Rule(
        code="REQ-ELIGIBILITY-002",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a newly fielded team must hold a junction row for the fixture's season",
        implemented_by="app.api.spiele.services.find_eligibility_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestEligibility",
        multi_document=True,
    ),
    Rule(
        code="REQ-RESULT-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a side carrying goals on a played fixture may be switched but not emptied",
        implemented_by="app.api.spiele.services.find_result_removal_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestRemovingATeamFromAPlayedFixture",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELTAG-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a team plays once per Spieltag; a clash moves a manual side and is refused against a maintained one",
        implemented_by="app.api.spiele.services.judge_spieltag_occupancy",
        tested_by="tests/api/test_occupant_refusal.py::TestSpieltagOccupancy",
        multi_document=True,
    ),
    Rule(
        code="REQ-RETIRE-003",
        operation="DELETE /spielorte/{spielort_id}",
        aggregate="Spielort",
        summary="a venue still booked for an unplayed fixture may not be retired",
        implemented_by="app.api.spielorte.services.find_venue_retire_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestRetiringAVenueOrAReferee",
        multi_document=True,
    ),
    Rule(
        code="REQ-RETIRE-004",
        operation="DELETE /schiedsrichter/{schiedsrichter_id}",
        aggregate="Schiedsrichter",
        summary="a referee still assigned to an unplayed fixture may not be retired",
        implemented_by="app.api.schiedsrichter.services.find_referee_retire_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestRetiringAVenueOrAReferee",
        multi_document=True,
    ),
    Rule(
        code="REQ-SQUAD-001",
        operation="POST /spieler/{spieler_id}/saisons · PATCH /spieler/{spieler_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="a squad row's team must hold a junction row for that season",
        implemented_by="app.api.spieler.services.find_squad_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASquadEntry",
        multi_document=True,
    ),
    Rule(
        code="REQ-SQUAD-002",
        operation="POST /spieler/{spieler_id}/saisons · PATCH /spieler/{spieler_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="a squad number this write would newly take from another player is refused",
        implemented_by="app.api.spieler.services.find_squad_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASquadEntry",
        multi_document=True,
    ),
)


UNENFORCED: tuple[Unenforced, ...] = (
    Unenforced(
        subject="exactly one season holds `status: active`",
        reason=(
            "No validator sees two documents, and a unique index on `status` would also permit exactly one "
            "`past` season (ADR-0020). It holds because `activate_saison` is the only writer and does both "
            "halves in one transaction."
        ),
    ),
    Unenforced(
        subject="a rollover while the outgoing season still has unplayed matches",
        reason=(
            "An early rollover is a legitimate decision, and the one occasion somebody genuinely needs it "
            "is when the data is not in the state a rule would have assumed (ADR-0026)."
        ),
        surfaced_by="the Umstellung panel on `/admin/saisons/[saison_id]`, which counts them and activates anyway",
    ),
    Unenforced(
        subject="a matchday retired while it still holds UNPLAYED fixtures",
        reason=(
            "Those fixtures leave the public Spielplan with their container, but stay fully readable and "
            "`spiele.spieltag_id` keeps resolving -- and a matchday created by mistake is exactly the one "
            "somebody needs to retire. A played one is refused instead (`REQ-RETIRE-002`)."
        ),
        surfaced_by="the retire dialog, which names how many fixtures leave the Spielplan with it",
    ),
    Unenforced(
        subject="a matchday whose attached fixtures differ from the count its phase implies",
        reason=(
            "A season being set up passes through that state on the way to being complete, so refusing it "
            "would block the setup rather than a mistake (ADR-0052)."
        ),
        surfaced_by="`/admin/spieltage`, which shows attached over expected and tints a mismatch",
    ),
    Unenforced(
        subject="a season whose end date precedes its start date",
        reason="No schema and no endpoint holds the two in order, so a page refusing it would enforce a rule the API does not have.",
        surfaced_by="the Zeitraum panel, which says so and saves anyway",
    ),
    Unenforced(
        subject="a bracket slot the resolution filled with a team later disqualified",
        reason=(
            "`REQ-ELIGIBILITY-001` covers a team being NEWLY fielded by a request; a slot already holding "
            "a since-disqualified team is reported as a derived fault and never rewritten -- only a person "
            "chooses between a forfeit and a replacement (ADR-0042)."
        ),
        surfaced_by="`/admin/action_required`, as a derived fault",
    ),
    Unenforced(
        subject="a stored bracket fault",
        reason=("Every fault is derived on each admin read and none is stored (ADR-0039). Reporting a shape is never licence to act on it."),
        surfaced_by="`/admin/action_required`",
    ),
    Unenforced(
        subject="a retired row's eventual purge",
        reason="`inactive_since` is a date so a purge can select on it; the purge itself is not built (roadmap BE-12).",
    ),
)
