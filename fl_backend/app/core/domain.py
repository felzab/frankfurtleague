"""
CORE · the domain model, as a declaration

What the entities are, which of them form one consistency boundary, what happens to a reference when its
target changes, and when each field may be written. Every statement here is DATA -- there is no evaluator
in this module and nothing calls it at request time.

 WHY A DECLARATION AND NOT AN ENGINE ──────────────────────────────────────────────────────────────────────

  **An invariant is enforced at the aggregate boundary, which is the write endpoint, and it stays there.**
  That is the textbook answer and the one this repository already implements: every rule below is a pure
  `find_*_refusal` function returning `(error_code, detail)`, called by the endpoint that owns the write.
  A central evaluator that each write had to remember to consult would be bypassable, and a rule that can
  be bypassed reads as coverage it does not have.

  So this module is the OTHER half: the model stated once, in a form a test can compare against the code
  and a document can cite instead of restating. It is the shape `constraints.py` has for the database and
  `src/core/apiContract.test.ts` has for the wire -- a hand-written declaration plus a conformance test,
  which ADR-0031 ratified as "checked, not generated".

  `tests/core/test_domain.py` is what makes it true rather than decorative: every domain `REQ-*` code the
  application defines appears here, every rule names a callable and a test that resolve, every collection
  belongs to exactly one aggregate, every field policy names a real field, and a field called derived is
  on no document.

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • **No application code imports this module.** Only the conformance test and the documentation read it.
    A caller wanting to ASK the model something is the point at which this becomes an engine, and that is
    a decision to take deliberately rather than by adding one import.
  • Every `implemented_by` is a dotted path to a real symbol and every `tested_by` is a real file and
    class, so the test resolves them rather than trusting the strings.
  • A referential action names what the CODE does, never what it ought to do. Where the answer is "nothing
    happens, deliberately", the action is `NO_ACTION` and the note says why.
  • Only fields whose answer is not plainly `EDITABLE` are listed. A row for every editable string would
    bury the thirty that carry a condition.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/domain.md -- the reader's version of everything below
  docs/_decisions/0066-the-domain-model-is-declared-and-conformance-checked.md
"""

from dataclasses import dataclass
from enum import Enum


class Action(str, Enum):
    """
    What happens to a referencing row when its target changes or goes away.

    SQL's own vocabulary, because it is precise and widely understood -- and because MongoDB enforces none
    of it, so naming the intended behaviour is the only way the intention is written down at all.
    """

    #: The operation is refused while a reference exists, by a `find_*_refusal` at the write.
    RESTRICT = "RESTRICT"
    #: The change is propagated into the referencing rows.
    CASCADE = "CASCADE"
    #: The reference is emptied and the referencing row survives.
    SET_NULL = "SET_NULL"
    #: Nothing happens, deliberately. The reference is left alone and stays resolvable.
    NO_ACTION = "NO_ACTION"


class Editability(str, Enum):
    """When a field may be written."""

    #: Writable through a payload whenever the aggregate's state allows it.
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


@dataclass(frozen=True)
class Aggregate:
    """
    One consistency boundary: a root plus the collections whose invariants are checked against it.

    Membership is decided by ONE question -- does an invariant hold this collection and the root true
    together? -- and not by whether one document points at another. `spiele` points at `spieltage` and
    they are separate aggregates, because no rule spans a matchday and a fixture.
    """

    name: str
    root: str
    members: tuple[str, ...]
    #: Why these belong together, in a sentence a reader can check against the rules below.
    boundary: str


@dataclass(frozen=True)
class Reference:
    """One directed reference between two collections, and what the code does about it."""

    source: str
    #: Every field path carrying this reference. Real paths, so the conformance test resolves them.
    fields: tuple[str, ...]
    target: str
    on_target_change: Action
    on_target_removed: Action
    note: str


@dataclass(frozen=True)
class FieldPolicy:
    """When one field may be written, and what enforces that."""

    collection: str
    field: str
    editability: Editability
    #: The state or the control the editability depends on. Empty where the field is plainly editable.
    condition: str = ""
    #: A dotted path to what enforces it, or "" where the enforcement is an ABSENCE -- no payload carries
    #: the field, which is not a symbol that can be named.
    enforced_by: str = ""


@dataclass(frozen=True)
class Rule:
    """One refusal a write path performs."""

    code: str
    operation: str
    aggregate: str
    summary: str
    implemented_by: str
    tested_by: str
    #: True where the rule needs more than the payload and its own document. These are the rules a
    #: uniform evaluator could not have expressed, because they read the aggregate rather than a row.
    multi_document: bool = False


@dataclass(frozen=True)
class Unenforced:
    """A state the system permits on purpose, and what shows it to a person instead."""

    subject: str
    reason: str
    #: The surface reporting the state, or "" where nothing does and nothing needs to.
    surfaced_by: str = ""


# =====================================================================================================
# THE AGGREGATES
# =====================================================================================================
#
# Seven, over nine collections, and the two that surprise a reader are worth stating first.
#
# `spiele` is NOT one aggregate per match. Entering a result resolves the season's bracket in the same
# transaction and rewrites fixtures the request never named (ADR-0042), so the consistency boundary of a
# match write is every fixture in that season. `PATCH /spiele/{spiel_id}` looks like a single-document
# write and is a write to the season's fixture set.
#
# `teams` is NOT inside `Saison`. A team document is season-independent -- the single most important
# structural fact in this model -- and what belongs to a season is the junction row.

AGGREGATES: tuple[Aggregate, ...] = (
    Aggregate(
        name="Saison",
        root="saisons",
        members=("saison_teams", "saison_spieler"),
        boundary=(
            "A season's `rules` bound its own entries: a junction row's group must be one the season runs "
            "and within its capacity, and both are checked against the root on every write from either "
            "side. `saison_spieler` joins for its identity being (player, season) and for `stufe` being "
            "offered by the root."
        ),
    ),
    Aggregate(
        name="Saison-Spielplan",
        root="spiele",
        members=(),
        boundary=(
            "One season's fixtures, as a set. Resolving the bracket reads every fixture of the season and "
            "may rewrite any of them, so a single match is not a boundary -- the season's fixture set is."
        ),
    ),
    Aggregate(
        name="Spieltag",
        root="spieltage",
        members=(),
        boundary=(
            "A matchday alone. Nothing holds a matchday and its fixtures true together: its position and "
            "its expected match count are both derived from elsewhere, and retiring one leaves its "
            "matches untouched."
        ),
    ),
    Aggregate(
        name="Team",
        root="teams",
        members=(),
        boundary="A club, season-independent. Every season-scoped fact about it lives on `saison_teams`.",
    ),
    Aggregate(
        name="Spieler",
        root="spieler",
        members=(),
        boundary="A person, season-independent. Everything a squad list shows lives on `saison_spieler`.",
    ),
    Aggregate(
        name="Spielort",
        root="spielorte",
        members=(),
        boundary="A venue. Reached from a match through an embedded display copy beside the id.",
    ),
    Aggregate(
        name="Schiedsrichter",
        root="schiedsrichter",
        members=(),
        boundary="A referee. Reached from a match the way a venue is.",
    ),
)


# =====================================================================================================
# THE REFERENCES
# =====================================================================================================

REFERENCES: tuple[Reference, ...] = (
    Reference(
        source="spiele",
        fields=("team1.team_id", "team2.team_id"),
        target="teams",
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "A rename fans out into every match's embedded `name` and `shorthand` "
            "(`app/api/teams/admin_router.py :: patch_team`). Retirement is soft and touches no match: "
            "the embedded copy is what a played fixture said at the time."
        ),
    ),
    Reference(
        source="spiele",
        fields=("ort.spielort_id",),
        target="spielorte",
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "The name and the maps link fan out; `mietpreis` deliberately does not (ADR-0028 rule 2). It "
            "records what this fixture cost, so rewriting it would rewrite history."
        ),
    ),
    Reference(
        source="spiele",
        fields=("schiedsrichter.schiedsrichter_id",),
        target="schiedsrichter",
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note="The name fans out; `payment` does not, for the reason `mietpreis` does not.",
    ),
    Reference(
        source="spiele",
        fields=("spieltag_id",),
        target="spieltage",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Nothing is embedded, so a renamed or re-dated matchday is picked up on the next read. "
            "Retiring a matchday leaves its matches fully readable, which is why that delete is soft."
        ),
    ),
    Reference(
        source="spiele",
        fields=("saison_id",),
        target="saisons",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "There is no `DELETE /saisons/{saison_id}` at all: removing a season would orphan this and every other reference to it (ADR-0033)."
        ),
    ),
    Reference(
        source="spiele",
        fields=("team1_quelle.spiel_nr", "team2_quelle.spiel_nr"),
        target="spiele",
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Entering a result re-resolves every slot that match feeds (ADR-0042). A `spiel_nr` the season "
            "has no match for LEAVES the slot alone and is reported as a bracket fault (ADR-0047) -- "
            "'nothing to look up' never empties a slot."
        ),
    ),
    Reference(
        source="spieltage",
        fields=("saison_id",),
        target="saisons",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note="No season delete exists, and `saison_id` is absent from the matchday patch payload, so a matchday cannot change seasons either.",
    ),
    Reference(
        source="saison_teams",
        fields=("team_id",),
        target="teams",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "Retiring a club is refused while a running or planned season holds it (`REQ-RETIRE-001`). A "
            "past season's rows survive the retirement, because those seasons still happened."
        ),
    ),
    Reference(
        source="saison_teams",
        fields=("saison_id",),
        target="saisons",
        on_target_change=Action.RESTRICT,
        on_target_removed=Action.RESTRICT,
        note=(
            "The season's `rules` bound these rows, so narrowing `number_of_groups` or `teams_per_group` "
            "below what they occupy is refused (`REQ-RULES-002`, `REQ-RULES-003`). There is no row delete "
            "either: a team leaves a season only by disqualification (ADR-0033)."
        ),
    ),
    Reference(
        source="saison_spieler",
        fields=("saison_id",),
        target="saisons",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "`erlaubte_stufen` bounds what the squad FORM offers and not what a row holds, so narrowing it "
            "strands nothing (ADR-0061). No season delete exists."
        ),
    ),
    Reference(
        source="saison_spieler",
        fields=("team_id",),
        target="teams",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Nothing is embedded and nothing is refused: a squad row pointing at a retired club still "
            "resolves, and the admin list renders it rather than hiding it."
        ),
    ),
    Reference(
        source="saison_spieler",
        fields=("spieler_id",),
        target="spieler",
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note="Retiring the person leaves every squad row intact -- the seasons they played still happened (ADR-0032).",
    ),
)


# =====================================================================================================
# WHEN A FIELD MAY BE WRITTEN
# =====================================================================================================

FIELD_POLICIES: tuple[FieldPolicy, ...] = (
    # ── Saison ────────────────────────────────────────────────────────────────────────────────────────
    FieldPolicy("saisons", "id", Editability.IMMUTABLE, "chosen at create; every `saison_id` in the database references this value"),
    FieldPolicy(
        "saisons",
        "status",
        Editability.CONTROL_ONLY,
        "`POST /saisons/{saison_id}/activate`, which demotes the incumbent in the same transaction (ADR-0033)",
        "app.api.saisons.admin_router.activate_saison",
    ),
    FieldPolicy("saisons", "start_date", Editability.EDITABLE),
    FieldPolicy(
        "saisons",
        "end_date",
        Editability.EDITABLE,
        "editable even on a finished season -- correcting a mistyped date changes nothing anybody competed for",
    ),
    FieldPolicy(
        "saisons",
        "rules.win_points",
        Editability.CONDITIONAL,
        "frozen once the season is `past`: the table is scored from it on every read, so a change rewrites the result",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        "saisons",
        "rules.draw_points",
        Editability.CONDITIONAL,
        "frozen once the season is `past`, for the reason `win_points` is",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        "saisons",
        "rules.qualifiers_per_group",
        Editability.CONDITIONAL,
        "frozen on a `past` season; never below a placing a bracket slot already names; the product "
        "with `number_of_groups` must be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        "saisons",
        "rules.number_of_groups",
        Editability.CONDITIONAL,
        "never below a group that still holds teams; the product with `qualifiers_per_group` must be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        "saisons",
        "rules.teams_per_group",
        Editability.CONDITIONAL,
        "never below the fullest group's occupancy",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        "saisons",
        "rules.erlaubte_stufen",
        Editability.EDITABLE,
        "narrowing is safe at any time, a finished season included: it bounds what a FORM offers and "
        "never what a stored squad row holds (ADR-0061)",
    ),
    # ── Spieltag ──────────────────────────────────────────────────────────────────────────────────────
    FieldPolicy(
        "spieltage",
        "saison_id",
        Editability.IMMUTABLE,
        "absent from the patch payload: moving a matchday between seasons would strand its matches",
    ),
    FieldPolicy(
        "spieltage",
        "anzahl_spiele",
        Editability.DERIVED,
        "computed from the season's `rules` and this matchday's phase (ADR-0065)",
        "app.api.saisons.schedule.expected_matches",
    ),
    FieldPolicy(
        "spieltage",
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it (ADR-0032)",
        "app.api.spieltage.admin_router.delete_spieltag",
    ),
    # ── Team ──────────────────────────────────────────────────────────────────────────────────────────
    FieldPolicy(
        "teams",
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it, and is refused while a running or planned season holds the club",
        "app.api.teams.services.find_retire_refusal",
    ),
    FieldPolicy("teams", "statistik", Editability.DERIVED, "the league table, aggregated from the season's matches on every read (ADR-0026)"),
    FieldPolicy(
        "teams",
        "gruppe",
        Editability.DERIVED,
        "joined from `saison_teams` for the season being read; the writable copy is the junction row's own field",
    ),
    FieldPolicy("teams", "disqualifikation", Editability.DERIVED, "joined from `saison_teams`, like `gruppe`"),
    FieldPolicy(
        "saison_teams",
        "gruppe",
        Editability.CONDITIONAL,
        "held to the groups the season runs and to their capacity on every write; a row is created only while the season is `future`",
        "app.api.teams.services.find_entry_refusal",
    ),
    FieldPolicy(
        "saison_teams",
        "disqualifikation",
        Editability.EDITABLE,
        "required on the payload with no default, so an omitted one is a 422 rather than a team quietly reinstated (ADR-0059)",
    ),
    # ── Spieler ───────────────────────────────────────────────────────────────────────────────────────
    FieldPolicy(
        "spieler",
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it; this is the PERSON leaving the league (ADR-0032)",
    ),
    FieldPolicy(
        "saison_spieler",
        "inactive_since",
        Editability.CONTROL_ONLY,
        "the SQUAD ROW's own retirement, independent of the person's; creating never revives one, "
        "which is why 409 is the right answer (ADR-0032)",
    ),
    FieldPolicy(
        "saison_spieler",
        "stufe",
        Editability.CONDITIONAL,
        "held to the league's closed set by the validator, and to the season's `erlaubte_stufen` by what the form offers (ADR-0061)",
    ),
    # ── Spiel ─────────────────────────────────────────────────────────────────────────────────────────
    FieldPolicy(
        "spiele", "spiel_nr", Editability.IMMUTABLE, "a season's fixtures are created once; `/spiele` has no POST and no DELETE (ADR-0045)"
    ),
    FieldPolicy("spiele", "saison_id", Editability.IMMUTABLE, "for the reason `spiel_nr` is"),
    FieldPolicy(
        "spiele", "saison_phase", Editability.IMMUTABLE, "for the reason `spiel_nr` is; a fixture's phase is settled when the schedule is drawn"
    ),
    FieldPolicy(
        "spiele",
        "spieltag_id",
        Editability.IMMUTABLE,
        "absent from the patch payload; a fixture is moved by editing the matchday's dates, not by reassigning the fixture",
    ),
    FieldPolicy(
        "spiele",
        "ergebnis",
        Editability.COMPOSED,
        "composed from `team1.tore` and `team2.tore` and never accepted from a client, so the stored "
        "string cannot disagree with the goals it formats",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        "spiele",
        "team1",
        Editability.CONDITIONAL,
        "a side carrying a `quelle` is maintained by the bracket resolution and is not the admin's to "
        "set; clearing the `quelle` is how a person takes the slot back (ADR-0042)",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        "spiele",
        "team2",
        Editability.CONDITIONAL,
        "for the reason `team1` is",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        "spiele",
        "elfmeterschiessen",
        Editability.CONDITIONAL,
        "discarded unless the goals it accompanies are level and the phase is a knockout, so a "
        "shoot-out cannot be stored against a fixture one side already won (ADR-0044)",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        "spiele",
        "team1_quelle",
        Editability.CONDITIONAL,
        "never on a group-phase fixture, never naming a later or missing match, and never feeding one "
        "outcome into two slots (`REQ-WIRING-001`)",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        "spiele",
        "team2_quelle",
        Editability.CONDITIONAL,
        "for the reason `team1_quelle` is",
        "app.api.spiele.services.find_wiring_refusal",
    ),
)


# =====================================================================================================
# THE RULES
# =====================================================================================================

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
        code="REQ-RETIRE-001",
        operation="DELETE /teams/{team_id}",
        aggregate="Team",
        summary="a club entered in a running or planned season may not be retired",
        implemented_by="app.api.teams.services.find_retire_refusal",
        tested_by="tests/api/test_team_retire_refusal.py::TestRetiringAClub",
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
        summary="a disqualified team may not be NEWLY fielded",
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
        code="REQ-SPIELTAG-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a team plays once per Spieltag; a clash moves a manual side and is refused against a maintained one",
        implemented_by="app.api.spiele.services.judge_spieltag_occupancy",
        tested_by="tests/api/test_occupant_refusal.py::TestSpieltagOccupancy",
        multi_document=True,
    ),
)


# =====================================================================================================
# WHAT IS DELIBERATELY NOT ENFORCED
# =====================================================================================================
#
# Named, because an absence looks identical to an omission. Every one of these is a state the system
# permits -- and mostly reports -- and the reason is always that refusing it would block a legitimate act
# rather than a mistake.

UNENFORCED: tuple[Unenforced, ...] = (
    Unenforced(
        subject="exactly one season holds `status: active`",
        reason=(
            "No validator sees two documents, and a unique index on `status` would also permit exactly one "
            "`past` season (ADR-0027). It holds because `activate_saison` is the only writer and does both "
            "halves in one transaction."
        ),
    ),
    Unenforced(
        subject="a rollover while the outgoing season still has unplayed matches",
        reason=(
            "An early rollover is a legitimate decision, and the one occasion somebody genuinely needs it "
            "is when the data is not in the state a rule would have assumed (ADR-0033)."
        ),
        surfaced_by="the Umstellung panel on `/admin/saisons/[saison_id]`, which counts them and activates anyway",
    ),
    Unenforced(
        subject="a matchday retired while it still holds played matches",
        reason="Its matches stay fully readable and `spiele.spieltag_id` keeps resolving, so nothing is stranded.",
        surfaced_by="the retire dialog, which names the count it will leave behind",
    ),
    Unenforced(
        subject="a matchday whose attached fixtures differ from the count its phase implies",
        reason=(
            "A season being set up passes through that state on the way to being complete, so refusing it "
            "would block the setup rather than a mistake (ADR-0065)."
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
            "`REQ-ELIGIBILITY-001` covers a team being NEWLY fielded by a request, and nothing re-checks a "
            "slot after the fact. The design is ratified and the implementation deferred (roadmap FB-9)."
        ),
    ),
    Unenforced(
        subject="a stored bracket fault",
        reason=(
            "All five faults are derived on every admin read and none is stored (ADR-0047). Reporting a shape is never licence to act on it."
        ),
        surfaced_by="`/admin/action_required`",
    ),
    Unenforced(
        subject="a retired row's eventual purge",
        reason="`inactive_since` is a date so a purge can select on it; the purge itself is not built (roadmap BE-12).",
    ),
)
