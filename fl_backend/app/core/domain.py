"""
CORE · the domain model, as a declaration

Data only: no application code imports this module and nothing evaluates it. Enforcement stays at
the write endpoints, and `fl_backend/tests/core/test_domain.py` compares the declaration against
the code.
"""

from dataclasses import dataclass
from enum import StrEnum

from app.core.collections import Collection


class Action(StrEnum):
    """What happens to a referencing row when its target changes or goes away.

    `StrEnum`, because the `(str, Enum)` mixin renders the member NAME in an f-string.
    """

    #: The operation is refused while a reference exists, by a `find_*_refusal` at the write.
    RESTRICT = "RESTRICT"
    CASCADE = "CASCADE"
    #: The reference is emptied and the referencing row survives. See `UNUSED_ACTIONS`.
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


# A statement, not an oversight: a bracket slot whose feeder cannot be resolved KEEPS its occupant
# and is reported as a fault.
UNUSED_ACTIONS: frozenset[Action] = frozenset({Action.SET_NULL})


@dataclass(frozen=True)
class Aggregate:
    """One consistency boundary: a root plus the collections whose invariants are checked against it.

    Membership is decided by ONE question -- does an invariant hold this collection and the root
    true together? -- never by whether one points at another.
    """

    name: str
    root: Collection
    members: tuple[Collection, ...]
    #: THE INVARIANT, then what it means for membership: the rule holding root and members true
    #: together, then what that excludes.
    boundary: str


@dataclass(frozen=True)
class Reference:
    """One directed reference between two collections, and what the code does about it."""

    source: Collection
    #: Every field path carrying this reference. Real paths, so the conformance test resolves them.
    fields: tuple[str, ...]
    target: Collection
    #: THE CONSTRAINT: `RESTRICT` where the write refuses a target it cannot resolve, `NO_ACTION`
    #: where nothing looks. `on_target_change` and `on_target_removed` are the actions it carries.
    on_reference_created: Action
    on_target_change: Action
    on_target_removed: Action
    #: WHAT THE CODE DOES, then what it deliberately does not -- the action in the present tense,
    #: then the part a reader would otherwise assume travels with it.
    note: str


@dataclass(frozen=True)
class FieldPolicy:
    """When one field may be written, and what enforces that."""

    collection: Collection
    field: str
    editability: Editability
    #: WHEN, then WHY. Opens with the timing word the editability turns on, and the reason follows
    #: a colon. Empty only where the field is plainly `EDITABLE`.
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
    #: ONE CLAUSE naming what is refused, present tense, no closing period -- a table cell, not a
    #: sentence. The reason lives in the constant's own comment beside the code.
    summary: str
    implemented_by: str
    tested_by: str
    #: True where the rule needs more than the payload and its own document -- the rules a uniform
    #: evaluator could not express, because they read the aggregate rather than a row.
    multi_document: bool = False


@dataclass(frozen=True)
class Unenforced:
    """A state the system permits on purpose, and what shows it to a person instead.

    Named because an absence looks identical to an omission.
    """

    #: THE STATE, as a noun phrase. Not a sentence: it completes "the system permits ...".
    subject: str
    #: WHY REFUSING WOULD BE WRONG, then what happens instead -- the cost of the rule first, because
    #: that is the argument.
    reason: str
    #: THE ENTRY BAR: the codes a reader would expect to cover this state and does not find. A state
    #: sitting near no rule surprises nobody, and belongs at the line it concerns instead.
    near: tuple[str, ...]
    #: `<test path>::<class>` proving the claim, paired one-to-one with this tuple. An entry nothing
    #: executes decays into the oversight it exists to be distinguishable from.
    proven_by: str
    #: An `/admin` route or a repo path to the component showing the state. Empty only where nothing
    #: shows it, which `reason` then has to answer for.
    surfaced_by: str = ""


AGGREGATES: tuple[Aggregate, ...] = (
    Aggregate(
        name="Saison",
        root=Collection.SAISONS,
        members=(Collection.SAISON_TEAMS, Collection.SAISON_SPIELER),
        boundary=(
            "A season's `rules` bound its own entries: a junction row's group must be one the season runs "
            "and within its capacity, and both are checked against the root on every write from either "
            "side. The root's `status` bounds them too: a junction row's `name` tracks the club it names "
            "only while the season is not `past`, which is why the rename fan-out reads `saisons` before "
            "it writes. `saison_spieler` joins for its identity being (player, season) and for `stufe` "
            "being offered by the root."
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
            "A matchday alone: its fixtures are `Saison-Spielplan`'s, so they are READ to judge its span and "
            "never written with it. Its `position` is unique among the other matchdays of its phase, and its "
            "match count comes from the season."
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
    Aggregate(
        name="Bewerbung",
        root=Collection.BEWERBUNGEN,
        members=(),
        boundary=(
            "One school's application to play one season. Held true against nothing: the document states what a "
            "school submitted, which stays true however the season and the club it names change afterwards -- so it "
            "is in no boundary with either, and its `status` claims a junction row was written rather than that one "
            "still stands. Acceptance writes into the Saison boundary in the same transaction, and what holds those "
            "writes to that season's rules is `find_entry_refusal`, which belongs to that boundary and not to this one."
        ),
    ),
    Aggregate(
        name="Aktion",
        root=Collection.AKTIONEN,
        members=(),
        boundary=(
            "One recorded write. Held true against nothing: a row is a statement that a write happened, "
            "which stays true however the document it names changes afterwards. So it is in no boundary "
            "with the collection it records, and carries no reference to it -- `document_id` names a row "
            "that may since have been deleted. A row surviving its subject is the point where that subject is a "
            "fixture or a season. Where it is a PERSON the surviving row is instead the leak, which is why every "
            "write destroying a person's values reaches in here and redacts them in place rather than dropping "
            "the row -- the enumeration of those writes is `docs/backend/spec.md :: I42`'s, not this note's."
        ),
    ),
)


REFERENCES: tuple[Reference, ...] = (
    Reference(
        source=Collection.SPIELE,
        fields=("team1.team_id", "team2.team_id"),
        target=Collection.TEAMS,
        on_reference_created=Action.NO_ACTION,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "`REQ-ELIGIBILITY-002` holds a newly fielded side to the season's `saison_teams` entrants and nothing reads "
            "`teams` here; entry into that junction reads it instead, where an absent club is a 404 and a retired one is "
            "refused (`REQ-ENTER-005`), so no junction row written since can name a club that does not exist. One written "
            "before it still can, which is what `app/core/constraints.py :: report_relations` exists to surface. The side's "
            "`name` and `shorthand` are read from that junction by the fixture write and ride on no payload; the group "
            "swap composes them from `teams`, which agrees because `REQ-SWAP-003` refuses a swap on a `past` season and "
            "no other season lets the two drift. "
            "A rename fans out into the junction rows and the matches of every season that is not `past` "
            "(`app/api/teams/admin_router.py :: patch_team`); a `past` season keeps what it was played under, as it "
            "keeps it through retirement, which is soft and touches no match."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("ort.spielort_id",),
        target=Collection.SPIELORTE,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.RESTRICT,
        note=(
            "A NEWLY assigned venue is read at the write, and one no `spielorte` row holds -- or one whose row is "
            "retired and takes no new fixtures -- is refused (`REQ-BOOKING-001`); a reference already stored is left "
            "alone. Retiring the venue is refused from the other side while an UNPLAYED fixture holds it "
            "(`REQ-RETIRE-003`), which is why a played one may keep a retired ground. "
            "The name and the maps link are read from that row rather than accepted, and they fan out on a rename; "
            "`mietpreis` deliberately does neither. It records what this fixture cost, so rewriting it would rewrite history."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("schiedsrichter.schiedsrichter_id",),
        target=Collection.SCHIEDSRICHTER,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.RESTRICT,
        note=(
            "Read at the write when NEWLY assigned, as the venue beside it is, and refused where no row holds it or "
            "the row it holds is retired; retiring the referee is refused from the other side for the reason the "
            "venue's is (`REQ-RETIRE-004`). "
            "The name is read from that row and fans out; `payment` does neither, for the reason `mietpreis` does not."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("spieltag_id",),
        target=Collection.SPIELTAGE,
        on_reference_created=Action.NO_ACTION,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.CASCADE,
        note=(
            "No request creates this reference at all: the field is on no payload and `/spiele` has no POST, "
            "so whatever writes a fixture carries the check itself. "
            "Nothing is embedded, so a re-dated matchday is picked up on the next read. "
            "A matchday is removed by a confirmed replace (`REQ-SPIELPLAN-005`), which draws both afresh, or by an undraw "
            "(`REQ-SPIELPLAN-006`), which draws neither. Each removes the season's fixtures in the same transaction, so the "
            "reference cannot dangle -- not because nothing is ever removed, but because neither collection is removed "
            "without the other (`docs/backend/spec.md :: I46`)."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_reference_created=Action.NO_ACTION,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "Unreachable in the creating direction for the reason `spieltag_id` above is. "
            "There is no `DELETE /saisons/{saison_id}` at all: removing a season would orphan this and every other reference to it."
        ),
    ),
    Reference(
        source=Collection.SPIELE,
        fields=("team1_quelle.spiel_nr", "team2_quelle.spiel_nr"),
        target=Collection.SPIELE,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.NO_ACTION,
        note=(
            "A source naming a `spiel_nr` this season has no match for is refused where it is set (`REQ-WIRING-001`). "
            "Entering a result re-resolves every slot that match feeds. A `spiel_nr` the season "
            "has no match for LEAVES the slot alone and is reported as a bracket fault -- "
            "'nothing to look up' never empties a slot."
        ),
    ),
    Reference(
        source=Collection.SPIELTAGE,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "`POST /saisons/{saison_id}/spielplan` writes every matchday of the season its own path names, so a matchday "
            "cannot be created into one that does not exist. "
            "No season delete exists, and `saison_id` is absent from the matchday patch payload, so a matchday cannot change seasons either."
        ),
    ),
    Reference(
        source=Collection.SAISON_TEAMS,
        fields=("team_id",),
        target=Collection.TEAMS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.CASCADE,
        on_target_removed=Action.RESTRICT,
        note=(
            "`post_saison_team` reads the club, so entry naming one `teams` does not hold is a 404 and entry naming a "
            "RETIRED one is refused (`REQ-ENTER-005`); that same read seeds this row's `name` and `shorthand`, which a "
            "rename then rewrites while the season is not `past`; a REPLACEMENT is the third writer of all three, reseeding them "
            "from the incoming club. A row naming no club predates that read -- the entry resolved nothing before it -- and is now "
            "reachable only by a database edit; `report_relations` is what surfaces one, and the replacement is what repairs one, "
            "which is why it resolves the INCOMING club alone and never the outgoing one. "
            "Retiring a club is refused while a running or planned season holds it (`REQ-RETIRE-001`). A "
            "past season's rows survive the retirement, because those seasons still happened."
        ),
    ),
    Reference(
        source=Collection.SAISON_TEAMS,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.RESTRICT,
        on_target_removed=Action.RESTRICT,
        note=(
            "`post_saison_team` reads the season for its status and its capacity, so entry into one that does not exist is a 404. "
            "The season's `rules` bound these rows, so narrowing `number_of_groups` or `teams_per_group` "
            "below what they occupy is refused (`REQ-RULES-002`, `REQ-RULES-003`). There is no row delete "
            "either: a club leaves a season by an austritt, or by a replacement repointing its row at another club, and the row "
            "itself survives both."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "`REQ-SQUAD-001` wants a junction row for this season, and a season nothing holds has none. "
            "`erlaubte_stufen` bounds what the squad FORM offers and not what a row holds, so narrowing it "
            "strands nothing. No season delete exists."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("team_id",),
        target=Collection.TEAMS,
        on_reference_created=Action.NO_ACTION,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "`REQ-SQUAD-001` counts a `saison_teams` row for the season and reads `teams` nowhere, so this rests on "
            "`post_saison_team` resolving the club at the junction's own entry: a squad row can name a club no "
            "`teams` document holds only where the junction row predates that read. "
            "Nothing is embedded and nothing is refused afterwards: a squad row pointing at a retired club still "
            "resolves, and the admin list renders it rather than hiding it."
        ),
    ),
    Reference(
        source=Collection.SAISON_SPIELER,
        fields=("spieler_id",),
        target=Collection.SPIELER,
        on_reference_created=Action.NO_ACTION,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "The path names the person and nothing reads it, so a squad row can name a `spieler` document nobody created. "
            "Retiring the person leaves every squad row intact -- the seasons they played still happened."
        ),
    ),
    Reference(
        source=Collection.BEWERBUNGEN,
        fields=("saison_id",),
        target=Collection.SAISONS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.RESTRICT,
        note=(
            "`post_bewerbung` resolves the season to read its application window, so a submission naming one that does "
            "not exist is a 404 there and one whose window is shut is refused (`REQ-BEWERBUNG-004`). `annehmen_bewerbung` "
            "reads it again for its status and its capacity, so an accepted application names a season twice proved. The "
            "season's `rules` bound what acceptance may write into the junction and not what this row holds, so narrowing "
            "them strands no application: the next acceptance is refused instead (`REQ-ENTER-002`, `REQ-ENTER-003`). No "
            "season delete exists. A DECLINE reads no season at all."
        ),
    ),
    Reference(
        source=Collection.BEWERBUNGEN,
        fields=("team_id",),
        target=Collection.TEAMS,
        on_reference_created=Action.RESTRICT,
        on_target_change=Action.NO_ACTION,
        on_target_removed=Action.NO_ACTION,
        note=(
            "Two writes create this reference. `post_bewerbung` resolves a club the applicant picked off the public list, "
            "refusing one `teams` does not hold and one that has left by the same code (`REQ-BEWERBUNG-006`); acceptance "
            "resolves it again, where a missing club is a 404 and a RETIRED one is `REQ-ENTER-005` -- the same two reads "
            "`post_saison_team` performs. For a new school the field is null until acceptance writes the created club's "
            "id into it. Nothing is embedded and nothing fans out: a renamed club leaves the application naming what the "
            "school typed, which is what the school applied as."
        ),
    ),
)


FIELD_POLICIES: tuple[FieldPolicy, ...] = (
    FieldPolicy(
        Collection.BEWERBUNGEN,
        "status",
        Editability.CONTROL_ONLY,
        "written `eingereicht` at create by `POST /bewerbungen`, which takes it from no payload, and moved by "
        "`POST /bewerbungen/{bewerbung_id}/annehmen` and `.../ablehnen`, each of which owns the whole transition and "
        "refuses an application already decided (`REQ-BEWERBUNG-001`)",
        "app.api.bewerbungen.services.find_triage_refusal",
    ),
    FieldPolicy(
        Collection.BEWERBUNGEN,
        "entscheidung",
        Editability.CONTROL_ONLY,
        "written by the same two endpoints, in the write that moves `status`: who decided is read from the request's "
        "bound actor rather than a payload, so it cannot disagree with the `aktionen` row recording the same write",
        "app.core.security.get_actor_email",
    ),
    FieldPolicy(
        Collection.BEWERBUNGEN,
        "team_id",
        Editability.CONTROL_ONLY,
        "written once at submission, where the applicant either picked a club off the public list or named none "
        "(`REQ-BEWERBUNG-006`), and again by acceptance, which writes a created club's id here so that an accepted "
        "application joins to the club it produced. On no payload the TRIAGE serves",
        "app.api.bewerbungen.admin_router.annehmen_bewerbung",
    ),
    FieldPolicy(
        Collection.BEWERBUNGEN,
        "kontakte",
        Editability.IMMUTABLE,
        "on no payload the triage serves: an application is the form three people filled in, and a decision moves "
        "`status`, `entscheidung` and `team_id` alone. An erasure empties the slot naming one of them, which is a "
        "removal rather than an edit",
    ),
    FieldPolicy(Collection.SAISONS, "id", Editability.IMMUTABLE, "chosen at create; every `saison_id` in the database references this value"),
    FieldPolicy(
        Collection.SAISONS,
        "status",
        Editability.CONTROL_ONLY,
        "`POST /saisons/{saison_id}/activate`, which demotes the incumbent in the same transaction; a season already "
        "`past` is never the target (`REQ-ACTIVATE-002`), since promotion would reopen the freezes its own status carries",
        "app.api.saisons.admin_router.activate_saison",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "spielplan",
        Editability.CONTROL_ONLY,
        "`POST /saisons/{saison_id}/spielplan`, which stamps it in the transaction that writes the matchdays and "
        "fixtures; a season already carrying one is refused (`REQ-SPIELPLAN-001`) unless the request confirms a REPLACE, which "
        "`REQ-SPIELPLAN-005` holds to a `future` season with nothing recorded and which restamps this in the same transaction",
        "app.api.saisons.admin_router.generate_spielplan",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "bewerbung",
        Editability.EDITABLE,
        "on the season payload, unlike `status` and `spielplan` beside it, because closing the window early is an "
        "ordinary correction rather than a transition; the payload carries no default, so a client omitting the key "
        "is refused rather than silently closing a window somebody opened",
        "app.api.saisons.schemas.FLPatchSaisonPayload",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "start_date",
        Editability.EDITABLE,
        "editable even on a finished season, and refused where the new span would stop covering a live matchday "
        "(`REQ-DATE-004`) or fall short of the matchdays the rules imply (`REQ-DATE-005`)",
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
        "rules.tiebreak_order",
        Editability.CONDITIONAL,
        "frozen once a knockout fixture of the season has been played (`REQ-RULES-012`), the bracket having been seeded from "
        "the group placings it decides, and again once the season is `past`: clubs level on points are separated by it on "
        "every read, so a change rewrites where a finished season's table placed them",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.qualifiers_per_group",
        Editability.CONDITIONAL,
        "frozen on a `past` season, and on a drawn one it moves only WITH the fixtures, through the draw's own payload "
        "(`REQ-RULES-011`); never below a placing a bracket slot already names; the product with `number_of_groups` must "
        "be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.number_of_groups",
        Editability.CONDITIONAL,
        "on a drawn season it moves only WITH the fixtures, through the draw's own payload (`REQ-RULES-011`), the schedule "
        "having been drawn from it; never below a group that still holds teams; the product with `qualifiers_per_group` "
        "must be a legal bracket",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.teams_per_group",
        Editability.CONDITIONAL,
        "moves only WITH the fixtures once the season is drawn, for the reason `number_of_groups` does; never below the "
        "fullest group's occupancy",
        "app.api.saisons.services.find_rules_refusal",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "rules.erlaubte_stufen",
        Editability.EDITABLE,
        "narrowing is safe at any time, a finished season included: it bounds what a FORM offers and never what a stored squad row holds",
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
        "computed from the season's `rules` and this matchday's phase",
        "app.api.saisons.schedule.expected_matches",
    ),
    FieldPolicy(
        Collection.SAISONS,
        "schedule",
        Editability.DERIVED,
        "computed from this season's own `rules`: the whole phase-by-phase shape the matchday "
        "above reports one entry of. Served for both halves of it — `matches_per_matchday` is the figure a "
        "matchday's own `anzahl_spiele` comes from, and `matchdays` is how many rows the season's schedule is "
        "generated to, the same figure `REQ-DATE-005` measures a season's span against",
        "app.api.saisons.schedule.schedule_for",
    ),
    FieldPolicy(
        Collection.SPIELTAGE,
        "position",
        Editability.IMMUTABLE,
        "written by `POST /saisons/{saison_id}/spielplan` (`app/api/saisons/spielplan.py`), which numbers each phase's "
        "rounds as it draws them; on no payload afterwards, so a stored row keeps its slot, and a slot its phase already "
        "holds is refused by `uniq_saison_id_saison_phase_position`. A confirmed replace (`REQ-SPIELPLAN-005`) removes the "
        "season's rows and draws fresh ones rather than renumbering any",
    ),
    FieldPolicy(
        Collection.TEAMS,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it, and is refused while a running or planned season holds the club",
        "app.api.teams.services.find_retire_refusal",
    ),
    FieldPolicy(Collection.TEAMS, "statistik", Editability.DERIVED, "the league table, aggregated from the season's matches on every read"),
    FieldPolicy(
        Collection.TEAMS,
        "gruppe",
        Editability.DERIVED,
        "joined from `saison_teams` for the season being read; the writable copy is the junction row's own field",
    ),
    FieldPolicy(Collection.TEAMS, "austritt", Editability.DERIVED, "joined from `saison_teams`, like `gruppe`"),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "gruppe",
        Editability.CONDITIONAL,
        "held to the groups the season runs and to their capacity on every write; a row is created only while the season is `future`, "
        "a single move is refused once the started season has drawn its fixtures, and what stays open is a two-club swap of clubs that "
        "have not yet played inside their groups",
        "app.api.teams.services.find_entry_refusal",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "austritt",
        Editability.EDITABLE,
        "required on the payload with no default, so an omitted one is a 422 rather than a team quietly reinstated",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "trikot_farbe",
        Editability.EDITABLE,
        "required on the payload with no default, as `austritt` is, and cleared by a REPLACEMENT: the kit belongs to the "
        "school that entered, not to the row. No state refuses it",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "kontakte",
        # EDITABLE, not CONDITIONAL, and the same as `trikot_farbe`: the two behave alike, and no state
        # refuses either. What a replacement does to both is a clearing, never a refusal.
        Editability.EDITABLE,
        "required on the payload with no default, so an omitted block is a 422 rather than three people's records silently "
        "dropped; and cleared by a REPLACEMENT for `trikot_farbe`'s reason, holding the outgoing school's contact details "
        "against another club being personal data nobody there gave. No state refuses it",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "name",
        Editability.COMPOSED,
        "seeded from the club when it enters the season and rewritten by a rename only while that season is "
        "not `past`, on no payload: a finished season keeps the name it was played under, which is what makes "
        "the copy its fixtures carry true rather than merely old",
        "app.api.teams.admin_router.post_saison_team",
    ),
    FieldPolicy(
        Collection.SAISON_TEAMS,
        "shorthand",
        Editability.COMPOSED,
        "for the reason `name` is",
        "app.api.teams.admin_router.post_saison_team",
    ),
    FieldPolicy(
        Collection.SPIELER,
        "einwilligung",
        Editability.IMMUTABLE,
        "written once by `post_spieler`, which composes it: no payload carries the field, so an admin can neither "
        "state a consent nor overwrite one, and a manual database edit is the only other writer",
    ),
    FieldPolicy(
        Collection.SPIELER,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it; this is the PERSON leaving the league",
    ),
    FieldPolicy(
        Collection.SAISON_SPIELER,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "the SQUAD ROW's own retirement, independent of the person's; creating never revives one, which is why 409 is the right answer",
    ),
    FieldPolicy(
        Collection.SAISON_SPIELER,
        "rolle",
        Editability.CONDITIONAL,
        "writable while no other LIVE row of the same team and season holds the role being given: a squad leads with one "
        "Kapitaen and one Co-Kapitaen, and holding both at once is unrepresentable rather than refused",
        "app.api.spieler.services.find_squad_rolle_refusal",
    ),
    FieldPolicy(
        Collection.SAISON_SPIELER,
        "stufe",
        Editability.CONDITIONAL,
        "held to the league's closed set by the validator, and to the season's `erlaubte_stufen` by what the form offers",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "spiel_nr",
        Editability.IMMUTABLE,
        "a stored fixture's number never changes; `/spiele` has no POST and no DELETE, and the season's whole set is written by the "
        "draw and replaced wholesale by a confirmed replace (`REQ-SPIELPLAN-005`), which is season-scoped and declares neither verb",
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
        "set; clearing the `quelle` is how a person takes the slot back",
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
        "shoot-out cannot be stored against a fixture one side already won",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team1_quelle",
        Editability.CONDITIONAL,
        "never on a group-phase fixture, never naming a later or missing match, and never feeding one "
        "outcome into two slots (`REQ-WIRING-001`); never seeding from a group placing past the round "
        "the bracket opens on (`REQ-WIRING-002`); never from a group the season does not run "
        "(`REQ-WIRING-003`)",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team2_quelle",
        Editability.CONDITIONAL,
        "for the reason `team1_quelle` is",
        "app.api.spiele.services.find_wiring_refusal",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team1.name",
        Editability.COMPOSED,
        "read from the season's junction row for `team_id` by the fixture write and carried on no payload: an "
        "editor open across a rename would otherwise submit the pre-rename copy and silently undo the "
        "fan-out for that one fixture, leaving it the only surface still showing the club's old name",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team1.shorthand",
        Editability.COMPOSED,
        "for the reason `team1.name` is",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team2.name",
        Editability.COMPOSED,
        "for the reason `team1.name` is",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "team2.shorthand",
        Editability.COMPOSED,
        "for the reason `team1.name` is",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "ort.name",
        Editability.COMPOSED,
        "read from the venue `spielort_id` names and carried on no payload, for the reason `team1.name` is. "
        "`mietpreis` beside it STAYS on the payload: it is this fixture's own agreed rent rather than a copy "
        "of the venue's default, so composing it would be the violation",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "ort.maps_link",
        Editability.COMPOSED,
        "for the reason `ort.name` is, and it is itself composed at the venue (`spielorte.maps_link`)",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELE,
        "schiedsrichter.name",
        Editability.COMPOSED,
        "for the reason `ort.name` is, `payment` beside it staying on the payload for the reason `mietpreis` does",
        "app.api.spiele.services.apply_payload_to_spiel",
    ),
    FieldPolicy(
        Collection.SPIELORTE,
        "maps_link",
        Editability.COMPOSED,
        "composed from `name` and `address` on both writes and on no payload, so a submitted one is overwritten rather "
        "than stored and a venue cannot be searchable for one place and bookable at another",
        "app.api.spielorte.admin_router._maps_link",
    ),
    FieldPolicy(
        Collection.SPIELORTE,
        "default_mietpreis",
        Editability.EDITABLE,
        "editable at any time, and a change reaches NO stored fixture: `spiele.ort.mietpreis` records what that "
        "fixture cost rather than tracking this number",
    ),
    FieldPolicy(
        Collection.SPIELORTE,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it, and the retirement is refused while an unplayed fixture is still booked here",
        "app.api.spielorte.services.find_venue_retire_refusal",
    ),
    FieldPolicy(
        Collection.SCHIEDSRICHTER,
        "default_payment",
        Editability.EDITABLE,
        "editable at any time, and a change reaches no stored fixture, for the reason a venue's `default_mietpreis` does not",
    ),
    FieldPolicy(
        Collection.SCHIEDSRICHTER,
        "inactive_since",
        Editability.CONTROL_ONLY,
        "`DELETE` stamps it and `POST /reactivate` clears it, and the retirement is refused while an unplayed fixture still names this referee",
        "app.api.schiedsrichter.services.find_referee_retire_refusal",
    ),
)


RULES: tuple[Rule, ...] = (
    Rule(
        code="REQ-RULES-001",
        operation="POST /saisons · PATCH /saisons/{saison_id} · POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="`number_of_groups` x `qualifiers_per_group` must be a power of two the phase set can hold",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestTheBracketMustHaveAShape",
    ),
    Rule(
        code="REQ-RULES-007",
        operation="POST /saisons · PATCH /saisons/{saison_id} · POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="`qualifiers_per_group` may not exceed `teams_per_group`",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestAGroupCannotQualifyMoreThanItHolds",
    ),
    Rule(
        code="REQ-RULES-008",
        operation="POST /saisons · PATCH /saisons/{saison_id} · POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a draw may not be worth more than a win",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestADrawIsNeverWorthMoreThanAWin",
    ),
    Rule(
        code="REQ-RULES-010",
        operation="POST /saisons · PATCH /saisons/{saison_id} · POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a season whose rules produce a knockout round may not award a no-show a draw",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestADrawnForfeitCannotDecideAKnockout",
    ),
    Rule(
        code="REQ-RULES-011",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`number_of_groups`, `teams_per_group` and `qualifiers_per_group` move only with a redraw once the season holds fixtures",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestADrawnSeasonKeepsTheShapeItWasDrawnFrom",
        multi_document=True,
    ),
    Rule(
        code="REQ-RULES-009",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`max_kadergroesse` may not drop below the largest squad the season already holds",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestNarrowingTheSquadCap",
        multi_document=True,
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
        code="REQ-RULES-012",
        operation="PATCH /saisons/{saison_id}",
        aggregate="Saison",
        summary="`tiebreak_order` is frozen once a knockout fixture of the season has been played",
        implemented_by="app.api.saisons.services.find_rules_refusal",
        tested_by="tests/api/test_rules_refusal.py::TestAStartedKnockoutFreezesTheTiebreak",
        multi_document=True,
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
        summary="a season's span may not shrink below a matchday's own",
        implemented_by="app.api.saisons.services.find_saison_span_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASeasonKeepsCoveringItsMatchdays",
        multi_document=True,
    ),
    Rule(
        code="REQ-DATE-005",
        operation="POST /saisons · PATCH /saisons/{saison_id} · POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a season shorter than the matchdays its own rules imply is refused",
        implemented_by="app.api.saisons.services.find_saison_span_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASeasonIsLongEnoughForItsSchedule",
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
        code="REQ-ACTIVATE-002",
        operation="POST /saisons/{saison_id}/activate",
        aggregate="Saison",
        summary="a season already `past` is never made active again",
        implemented_by="app.api.saisons.services.find_activation_refusal",
        tested_by="tests/api/test_activation_refusal.py::TestAFinishedSeasonIsNeverPromotedBack",
    ),
    Rule(
        code="REQ-ACTIVATE-003",
        operation="POST /saisons/{saison_id}/activate",
        aggregate="Saison",
        summary="a season holding no fixtures is never made active",
        implemented_by="app.api.saisons.services.find_activation_refusal",
        tested_by="tests/api/test_activation_refusal.py::TestASeasonWithNothingDrawn",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-001",
        operation="POST /teams/{team_id}/saisons · POST /bewerbungen/{bewerbung_id}/annehmen",
        aggregate="Saison",
        summary="a team enters a season only while that season is `future`",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-002",
        operation="POST /teams/{team_id}/saisons · PATCH /teams/{team_id}/saisons/{saison_id} · POST /bewerbungen/{bewerbung_id}/annehmen",
        aggregate="Saison",
        summary="the group must be one the season runs",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-003",
        operation="POST /teams/{team_id}/saisons · PATCH /teams/{team_id}/saisons/{saison_id} · POST /bewerbungen/{bewerbung_id}/annehmen",
        aggregate="Saison",
        summary="the group must have space; the caller counts a departed club's row in, a team never leaving a season",
        implemented_by="app.api.teams.services.find_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestEnteringASeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-004",
        operation="PATCH /teams/{team_id}/saisons/{saison_id}",
        aggregate="Saison",
        summary="a group change is refused once the team's fixtures are drawn, whatever the season's status",
        implemented_by="app.api.teams.services.find_gruppe_move_refusal",
        tested_by="tests/api/test_gruppe_move_refusal.py::TestTheWindowForAGroupChange",
        multi_document=True,
    ),
    Rule(
        code="REQ-ENTER-005",
        operation=(
            "POST /teams/{team_id}/saisons · POST /teams/{team_id}/saisons/{saison_id}/replace · POST /bewerbungen/{bewerbung_id}/annehmen"
        ),
        aggregate="Saison",
        summary="a club that has left the LEAGUE is entered into no season until it is reactivated",
        implemented_by="app.api.teams.services.find_club_entry_refusal",
        tested_by="tests/api/test_team_entry_refusal.py::TestWhetherTheClubIsStillInTheLeague",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-001",
        operation="POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a season already holding fixtures is not drawn again, whoever wrote them",
        implemented_by="app.api.saisons.services.find_spielplan_refusal",
        tested_by="tests/api/test_spielplan_refusal.py::TestASeasonAlreadyDrawn",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-002",
        operation="POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a season already holding matchdays is not drawn, the draw writing the whole list at once",
        implemented_by="app.api.saisons.services.find_spielplan_refusal",
        tested_by="tests/api/test_spielplan_refusal.py::TestASeasonHoldingMatchdays",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-003",
        operation="POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a Spielplan is never drawn into a season already past",
        implemented_by="app.api.saisons.services.find_spielplan_refusal",
        tested_by="tests/api/test_spielplan_refusal.py::TestAFinishedSeason",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-004",
        operation="POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a season with an offered group off `teams_per_group`, or a club outside the offered groups, is not drawn",
        implemented_by="app.api.saisons.services.find_spielplan_refusal",
        tested_by="tests/api/test_spielplan_refusal.py::TestWhetherEveryOfferedGroupHoldsItsSize",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-005",
        operation="POST /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="a confirmed replace reaches no season but a `future` one that holds nothing already played",
        implemented_by="app.api.saisons.services.find_spielplan_refusal",
        tested_by="tests/api/test_spielplan_refusal.py::TestAReplaceRunsOnlyInsideItsWindow",
        multi_document=True,
    ),
    Rule(
        code="REQ-SPIELPLAN-006",
        operation="DELETE /saisons/{saison_id}/spielplan",
        aggregate="Saison",
        summary="an undraw reaches no season but a `future` one that holds nothing recorded against a fixture",
        implemented_by="app.api.saisons.services.find_undraw_refusal",
        tested_by="tests/api/test_undraw_refusal.py::TestAnUndrawRunsOnlyInsideItsWindow",
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
        summary="no group swap once a knockout fixture has been played, abandoned, forfeited, given a goal count or a stored shoot-out",
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
        summary="no group swap once either club's gruppenphase fixture has been played, abandoned, forfeited, given a goal count "
        "or a stored shoot-out",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestTheRoundRobinClosesTheWindow",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-005",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary="no group swap that would BREAK a Spieltag, leaving a club in two of its matches; one already broken is left alone",
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestASpieltagNeverHoldsAClubTwice",
        multi_document=True,
    ),
    Rule(
        code="REQ-SWAP-006",
        operation="POST /saisons/{saison_id}/gruppen/swap",
        aggregate="Saison",
        summary=(
            "no group swap moving a departed club onto a fixture dated on or after its exit, an UNDATED one included, "
            "unless that fixture awards nothing"
        ),
        implemented_by="app.api.teams.services.find_gruppe_swap_refusal",
        tested_by="tests/api/test_gruppe_swap_refusal.py::TestASwapNeverFieldsADisqualifiedClub",
        multi_document=True,
    ),
    Rule(
        code="REQ-REPLACE-001",
        operation="POST /teams/{team_id}/saisons/{saison_id}/replace",
        aggregate="Saison",
        summary="no replacement in a `past` season, whose fixtures and the table derived from them are the record of who played",
        implemented_by="app.api.teams.services.find_replacement_refusal",
        tested_by="tests/api/test_saison_team_replacement_refusal.py::TestWhichSeasonsAreOpenToAReplacement",
        multi_document=True,
    ),
    Rule(
        code="REQ-REPLACE-002",
        operation="POST /teams/{team_id}/saisons/{saison_id}/replace",
        aggregate="Saison",
        summary="no replacement once the outgoing club's fixture has been played, abandoned, forfeited, given a goal count "
        "or a stored shoot-out",
        implemented_by="app.api.teams.services.find_replacement_refusal",
        tested_by="tests/api/test_saison_team_replacement_refusal.py::TestTheOutgoingClubMustHavePlayedNothing",
        multi_document=True,
    ),
    Rule(
        code="REQ-REPLACE-003",
        operation="POST /teams/{team_id}/saisons/{saison_id}/replace",
        aggregate="Saison",
        summary="no replacement by a club already holding a row in the season, one club named on both ends included",
        implemented_by="app.api.teams.services.find_replacement_refusal",
        tested_by="tests/api/test_saison_team_replacement_refusal.py::TestTheIncomingClubMustBeNewToTheSeason",
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
        code="REQ-DATE-002",
        operation="PATCH /spieltage/{spieltag_id}",
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
        code="REQ-DATE-008",
        operation="PATCH /spieltage/{spieltag_id}",
        aggregate="Spieltag",
        summary=(
            "within one phase, a matchday may not begin before the nearest dated matchday at a lower `position`, "
            "nor after the nearest one at a higher"
        ),
        implemented_by="app.api.spieltage.services.find_spieltag_order_refusal",
        tested_by="tests/api/test_spieltag_refusals.py::TestAMatchdayNeverBeginsBeforeItsPredecessor",
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
        code="REQ-BOOKING-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a venue or a referee NEWLY assigned to a fixture must name a row that exists and has not retired",
        implemented_by="app.api.spiele.services.find_booking_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestTheBookingRefusal",
        multi_document=True,
    ),
    Rule(
        code="REQ-CLASH-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a venue OR a referee needs four hours between two fixtures it serves; either alone refuses the write",
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
            "later feeder, no outcome feeding two slots, no hand-set team on a maintained side -- each "
            "judged on what this save moves, the source or the occupant"
        ),
        implemented_by="app.api.spiele.services.find_wiring_refusal",
        tested_by="tests/api/test_wiring_refusal.py::TestEveryRefusalCarriesItsCode",
        multi_document=True,
    ),
    Rule(
        code="REQ-WIRING-002",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary=(
            "a group placing seeds only the round this season's bracket opens on; every later slot is fed by a match, "
            "judged on the side whose source this save moves"
        ),
        implemented_by="app.api.spiele.services.find_wiring_refusal",
        tested_by="tests/api/test_wiring_refusal.py::TestEveryRefusalCarriesItsCode",
        multi_document=True,
    ),
    Rule(
        code="REQ-WIRING-003",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary=(
            "a group placing may name only a group the season runs, judged against the season's own "
            "`number_of_groups` on the side whose source this save moves"
        ),
        implemented_by="app.api.spiele.services.find_wiring_refusal",
        tested_by="tests/api/test_wiring_refusal.py::TestEveryRefusalCarriesItsCode",
        multi_document=True,
    ),
    Rule(
        code="REQ-STATE-002",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a fixture whose event awards nothing may not carry goals",
        implemented_by="app.api.spiele.services.find_state_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestAnEventThatAwardsNothingCarriesNoResult",
    ),
    Rule(
        code="REQ-STATE-003",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary="a no-show may not be recorded on a fixture with an unresolved side",
        implemented_by="app.api.spiele.services.find_state_refusal",
        tested_by="tests/api/test_occupant_refusal.py::TestANoShowNeedsBothSides",
    ),
    Rule(
        code="REQ-ELIGIBILITY-001",
        operation="PATCH /spiele/{spiel_id}",
        aggregate="Saison-Spielplan",
        summary=(
            "a team that left the season may not be fielded on or after its exit -- judged whenever the side, the date "
            "or the event moves -- unless the event names that side as the one that stayed away, or awards nothing on a "
            "Gruppenphase fixture"
        ),
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
        code="REQ-ANONYMISE-001",
        operation="POST /schiedsrichter/{schiedsrichter_id}/anonymisieren",
        aggregate="Schiedsrichter",
        summary="contact details entered again while an anonymisation runs are refused, never left standing",
        implemented_by="app.api.schiedsrichter.services.find_anonymisation_refusal",
        tested_by="tests/api/test_schiedsrichter_anonymisierung.py::TestAReEntryLandingMidAnonymisationIsRefused",
        multi_document=True,
    ),
    Rule(
        code="REQ-SQUAD-001",
        operation=(
            "POST /spieler/{spieler_id}/saisons · PATCH /spieler/{spieler_id}/saisons/{saison_id} · "
            "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate"
        ),
        aggregate="Saison",
        summary="a squad row's team must hold a junction row for that season",
        implemented_by="app.api.spieler.services.find_squad_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASquadEntry",
        multi_document=True,
    ),
    Rule(
        code="REQ-SQUAD-003",
        operation=(
            "POST /spieler/{spieler_id}/saisons · PATCH /spieler/{spieler_id}/saisons/{saison_id} · "
            "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate"
        ),
        aggregate="Saison",
        summary="a squad may not exceed the season's `max_kadergroesse`",
        implemented_by="app.api.spieler.services.find_squad_capacity_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASquadCap",
        multi_document=True,
    ),
    Rule(
        code="REQ-SQUAD-004",
        operation=(
            "POST /spieler/{spieler_id}/saisons · PATCH /spieler/{spieler_id}/saisons/{saison_id} · "
            "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate"
        ),
        aggregate="Saison",
        summary="a squad holds each `rolle` at most once among its live rows",
        implemented_by="app.api.spieler.services.find_squad_rolle_refusal",
        tested_by="tests/api/test_containment_refusals.py::TestASquadRolle",
        multi_document=True,
    ),
    Rule(
        code="REQ-BEWERBUNG-001",
        operation="POST /bewerbungen/{bewerbung_id}/annehmen · POST /bewerbungen/{bewerbung_id}/ablehnen",
        aggregate="Bewerbung",
        summary="an application already decided is neither accepted nor declined a second time",
        implemented_by="app.api.bewerbungen.services.find_triage_refusal",
        tested_by="tests/api/test_bewerbung_triage_refusal.py::TestADecisionIsTakenOnce",
    ),
    Rule(
        code="REQ-BEWERBUNG-002",
        operation="POST /bewerbungen/{bewerbung_id}/annehmen",
        aggregate="Bewerbung",
        summary="acceptance needs exactly one of an existing club and a new school to enter",
        implemented_by="app.api.bewerbungen.services.find_acceptance_subject_refusal",
        tested_by="tests/api/test_bewerbung_triage_refusal.py::TestWhatAcceptanceWouldEnter",
    ),
    Rule(
        code="REQ-BEWERBUNG-003",
        operation="POST /bewerbungen/{bewerbung_id}/annehmen",
        aggregate="Bewerbung",
        summary="a new school whose own details make no valid club is not accepted",
        implemented_by="app.api.bewerbungen.services.find_new_club_refusal",
        tested_by="tests/api/test_bewerbung_triage_refusal.py::TestWhetherTheSchoolMakesAClub",
    ),
    Rule(
        code="REQ-BEWERBUNG-004",
        operation="POST /bewerbungen",
        aggregate="Bewerbung",
        summary="an application is submitted only while the season's application window is open",
        implemented_by="app.api.bewerbungen.services.find_window_refusal",
        tested_by="tests/api/test_bewerbung_submission_refusal.py::TestTheWindowDecidesWhetherAnApplicationMayArrive",
    ),
    Rule(
        code="REQ-BEWERBUNG-005",
        operation="POST /bewerbungen",
        aggregate="Bewerbung",
        summary="a submission needs exactly one of an existing club and a new school to say who is applying",
        implemented_by="app.api.bewerbungen.services.find_submission_subject_refusal",
        tested_by="tests/api/test_bewerbung_submission_refusal.py::TestWhoIsApplying",
    ),
    Rule(
        code="REQ-BEWERBUNG-006",
        operation="POST /bewerbungen",
        aggregate="Bewerbung",
        summary="a club the public list does not offer is not one an application may be submitted as",
        implemented_by="app.api.bewerbungen.services.find_picked_club_refusal",
        tested_by="tests/api/test_bewerbung_submission_refusal.py::TestWhetherThePickedClubMayApply",
    ),
    Rule(
        code="REQ-BEWERBUNG-007",
        operation="POST /bewerbungen",
        aggregate="Bewerbung",
        summary="a club already playing the season does not apply to play it",
        implemented_by="app.api.bewerbungen.services.find_already_entered_refusal",
        tested_by="tests/api/test_bewerbung_submission_refusal.py::TestAClubAlreadyInTheSeason",
    ),
    Rule(
        code="REQ-BEWERBUNG-008",
        operation="POST /bewerbungen",
        aggregate="Bewerbung",
        summary="a new school does not propose a Kürzel a club already holds",
        implemented_by="app.api.bewerbungen.services.find_shorthand_refusal",
        tested_by="tests/api/test_bewerbung_submission_refusal.py::TestTheProposedKuerzel",
    ),
    Rule(
        code="REQ-PURGE-001",
        operation="DELETE /spieler/{spieler_id}/erasure",
        aggregate="Spieler",
        summary="a player still in the league is not erased, retirement being the step that comes first",
        implemented_by="app.api.spieler.services.find_erasure_refusal",
        tested_by="tests/api/test_spieler_erasure_execution.py::TestTheErasureIsRefusedUntilTheyAreRetired",
    ),
)


UNENFORCED: tuple[Unenforced, ...] = (
    Unenforced(
        subject="exactly one season holds `status: active`",
        reason=(
            "No validator sees two documents, and the index that comes closest -- a partial unique one on "
            "`status: active` -- delivers at-most-one rather than exactly-one, so a league with no active "
            "season would still satisfy it, and it would make the activation's write order load-bearing: "
            "demote the incumbent first or the index refuses the promotion. What stands instead is that "
            "`activate_saison` is the only path that can write `active` -- `post_saison` writes the create's "
            "`future` and nothing else touches the field -- and that it demotes and promotes in one transaction. "
            "That is weaker than at-most-one, and parts from it on the same case: where NOTHING holds `active` "
            "the demotion matches nothing and writes nothing, so two concurrent rollovers have disjoint write "
            "sets and both commit, leaving two seasons `active`."
        ),
        near=("REQ-ACTIVATE-001",),
        proven_by="tests/core/test_unenforced.py::TestExactlyOneActiveSeason",
    ),
    Unenforced(
        subject="a matchday whose attached fixtures differ from the count its phase implies",
        reason=(
            "A refusal would land on the season's rules patch, and the seasons it would land on are the ones whose "
            "stored rows no current write path produces -- latching those shut against every later edit, their dates "
            "included (`docs/backend/spec.md :: I44`), rather than catching a mistake. Nothing opens the gap afresh: "
            "the draw writes every phase at exactly its implied count, and `REQ-RULES-011` holds the three numbers "
            "that count follows from to the fixtures drawn from them, in either direction, from the season's first "
            "fixture onward. The matchday's own write never reads the count at all: `anzahl_spiele` is derived for "
            "the reader. The matchday editor's rail names both counts for whoever opens a stored row that holds the gap."
        ),
        near=("REQ-RULES-011", "REQ-RULES-006"),
        proven_by="tests/core/test_unenforced.py::TestAMatchdayOffItsImpliedCount",
        surfaced_by="fl_frontend/src/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx",
    ),
    Unenforced(
        subject="two players in one team and one season wearing the same squad number",
        reason=(
            "A shirt number is worn rather than assigned, and the league already fields four goalkeepers "
            "in one squad all wearing 1 -- so refusing the state would make live rows uneditable and, once "
            "one was retired, unreactivatable. Refusing it on the create and the patch while the reactivate "
            "consulted no rule at all was the same rule answering three ways (decided 2026-08-13). NOTHING REPORTS "
            "IT EITHER: no read compares one squad row's number against another's, and the create form and the "
            "editor's squad section judge `nummer` on its format alone. A comparison built later reads the stored "
            "string as typed: `07` is a shirt somebody had printed and is not `7`, so a numeric reading that merges "
            "the two makes a judgement this rule declines. Every squad list prints the figures, so a "
            "person can read two of them as equal, but no surface names that as a state -- and whether one should "
            "is open rather than settled, the same state covering a squad's keepers and a late entry colliding "
            "with a shirt somebody already wears (roadmap FB-17)."
        ),
        near=("REQ-SQUAD-001",),
        proven_by="tests/core/test_unenforced.py::TestASharedSquadNumber",
    ),
    Unenforced(
        subject="a bracket slot the resolution filled with a team that later left the season",
        reason=(
            "`REQ-ELIGIBILITY-001` judges a side a request fields or re-dates; a slot the RESOLUTION filled, "
            "which no request touched, is reported as a derived fault and never rewritten -- only a person "
            "chooses between a forfeit and a replacement."
        ),
        near=("REQ-ELIGIBILITY-001",),
        proven_by="tests/core/test_unenforced.py::TestABracketSlotHeldByADisqualifiedClub",
        surfaced_by="/admin/action_required",
    ),
    Unenforced(
        subject="a stored bracket fault",
        reason=("Every fault is derived on each admin read and none is stored. Reporting a shape is never licence to act on it."),
        near=("REQ-WIRING-001",),
        proven_by="tests/core/test_unenforced.py::TestNoBracketFaultIsStored",
        surfaced_by="/admin/action_required",
    ),
    Unenforced(
        subject="a retired row kept indefinitely",
        reason=(
            "Decided 2026-08, Datenschutzexperte consulted: a retired row is never purged on its age, so there is no "
            "RETENTION sweep to build and none may be added. The one removal is a pupil's own erasure request, which "
            "selects a subject, never an age, and `REQ-PURGE-001` makes retirement its precondition rather than its "
            "trigger. `inactive_since` stays a date (`docs/backend/spec.md :: I12`): it records WHEN a row retired, "
            "not when a sweep may take it. What the proof reaches is a removal through `app/core/crud.py`'s two "
            "helpers: refused where its literal filter names the field at any depth, failed outright where the "
            "filter is a variable. A sweep inside that module, or outside `app/`, is unscanned."
        ),
        near=("REQ-RETIRE-001",),
        proven_by="tests/core/test_unenforced.py::TestNoPurgeReachesARetiredRow",
    ),
    Unenforced(
        subject="a group phase in which every club qualifies",
        reason=(
            "A seeding-only group stage is a real format, so a floor under `qualifiers_per_group` would invent "
            "a rule this competition does not have. `REQ-RULES-007` bounds the field from above alone. The season's "
            "derived `schedule` is what makes the state visible, as the phases these numbers imply -- and the rules "
            "form itself shows only the numbers, so the admin sees the consequence on the matchday list rather than "
            "where the rule is typed."
        ),
        near=("REQ-RULES-007",),
        proven_by="tests/core/test_unenforced.py::TestAGroupPhaseEveryClubLeaves",
        surfaced_by="/admin/spieltage",
    ),
    Unenforced(
        subject="a Spieltag on which a club already stands twice",
        reason=(
            "The swap refuses only the Spieltag it BREAKS, never one already broken, because refusing over an "
            "existing fault would block the repair. `REQ-SPIELTAG-001` holds the same line one fixture at a time, and "
            "the swap's refusal message names what the exchange would break. Every appearance of the standing state "
            "is reported instead, in fixture order, because which one to correct is a competition call rather than "
            "a rule's."
        ),
        near=("REQ-SWAP-005", "REQ-SPIELTAG-001"),
        proven_by="tests/core/test_unenforced.py::TestASpieltagAlreadyHoldingAClubTwice",
        surfaced_by="/admin/action_required",
    ),
    Unenforced(
        subject="a person holding no squad row at all",
        reason=(
            "A person is registered before they are placed, and `REQ-SQUAD-001` governs the row rather than its "
            "absence. `GET /spieler/memberships` returns them with an empty membership list, so the read that "
            "would report the state already is the surface that repairs it."
        ),
        near=("REQ-SQUAD-001",),
        proven_by="tests/core/test_unenforced.py::TestAPersonWithNoSquadRow",
        surfaced_by="/admin/spieler",
    ),
    Unenforced(
        subject="a departed club holding drawn fixtures",
        reason=(
            "A departed club keeps its group place, and its opponents need a fixture to record the walkover on, "
            "so clearing them would leave a full group with nothing to play. It keeps the fixtures it already "
            "stands on, undisturbed. What `REQ-ELIGIBILITY-001` refuses is a request that DISTURBS one: fielding the "
            "club somewhere new, or moving the date or the event of a fixture it already stands on into a state that "
            "no longer records its absence."
        ),
        near=("REQ-ELIGIBILITY-001",),
        proven_by="tests/core/test_unenforced.py::TestADisqualifiedClubKeepsItsFixtures",
        surfaced_by="/admin/action_required",
    ),
    Unenforced(
        subject="a stored pre-image no current model accepts",
        reason=(
            "`FLAktionMitStand.before` is typed `dict[str, Any] | None` on purpose: an image is what a document "
            "looked like when it was written, so validating it against today's models would make every row taken "
            "before a migration unreadable -- which is the one thing the log exists to prevent. NOTHING SHOWS THE "
            "IMAGE: the list read serves `stand_gesichert` in its place, and only `GET /aktionen/{aktion_id}` -- "
            "the one-row read a restore will replay from, called by nothing yet -- carries it. So a person cannot "
            "see this state, and the restore itself is BE-15's unbuilt half."
        ),
        near=("REQ-VAL-001",),
        proven_by="tests/core/test_unenforced.py::TestAStoredPreImageIsNeverRevalidated",
    ),
    Unenforced(
        subject="a matchday of a later phase dated before one of an earlier phase",
        reason=(
            "The rule finds its neighbour with one query on `(saison_id, saison_phase, position)`, the key the "
            "collection is already indexed by. Across phases there is no such key: `position` restarts at 1 in every "
            "phase, and what orders the phases themselves is `PHASE_RANK`, which lives in application code and on no "
            "document -- so the same rule widened has no index to find its neighbour on: "
            "`uniq_saison_id_saison_phase_position` does not carry `beginn`, and the phase order is on no "
            "document at all. The state is reachable between phases alone: the draw gives every "
            "knockout phase exactly one matchday, and one matchday makes no pair to order. `/admin/spieltage` "
            "sections a season by phase in played order with each span beside it, so a phase dated against that "
            "order reads as dates running backwards down the page."
        ),
        near=("REQ-DATE-008",),
        proven_by="tests/core/test_unenforced.py::TestAPhaseDatedAgainstTheOrderItIsPlayedIn",
        surfaced_by="/admin/spieltage",
    ),
    Unenforced(
        subject="a person retired while holding a live squad row",
        reason=(
            "A rule here would make an admin empty every squad the person ever played in before retiring them, which is the "
            "archive falsified to satisfy a precondition. The two retirements are independent instead: `READ-SQUAD-001` "
            "filters a squad by the ROW's retirement and never the person's, and a row is left by its own austritt. The list "
            "carries both as separate badges, so a retired person whose squad row still stands reads as exactly that."
        ),
        near=("REQ-RETIRE-001", "REQ-SQUAD-001"),
        proven_by="tests/core/test_unenforced.py::TestARetiredPersonKeepsALiveSquadRow",
        surfaced_by="/admin/spieler",
    ),
    Unenforced(
        subject="a `future` season holding recorded results",
        reason=(
            "Binding a result to the season's status would make activation the precondition for recording a match already "
            "played, and activation is one-way. That the two can disagree is designed for rather than tolerated: both windows "
            "that destroy a draw take the recorded count and the status as two arguments rather than inferring either from "
            "the other. The season's Spielplan panel names what was entered as the reason the draw can no longer be replaced "
            "or taken back."
        ),
        near=("REQ-SPIELPLAN-005", "REQ-SPIELPLAN-006"),
        proven_by="tests/core/test_unenforced.py::TestAFutureSeasonHoldingRecordedResults",
        surfaced_by="/admin/saisons/[saison_id]",
    ),
    Unenforced(
        subject="an abandoned fixture carrying any result, or none",
        reason=(
            "An abandonment has two lawful outcomes -- the score it reached is awarded, or the match is replayed -- and this "
            "competition has no rule choosing between them, so a refusal either way would invent one. Every other event is "
            "named by the `REQ-STATE-*` pair; this one keeps its slot, which is what puts it outside the set awarding nothing. "
            "It is chased for a result like any other, the triage list's cancelled set leaving it out, and the editor warns "
            "beside the event that a decided score will count for the table."
        ),
        near=("REQ-STATE-002", "REQ-STATE-003"),
        proven_by="tests/core/test_unenforced.py::TestAnAbandonedFixtureAndItsResult",
        surfaced_by="/admin/spiele/[spiel_id]",
    ),
)
