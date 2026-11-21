from collections.abc import Mapping
from datetime import date, datetime, time
from typing import Annotated, Final, Literal, LiteralString, get_args

from pydantic import (
    BaseModel,
    Field,
    TypeAdapter,
    ValidationError,
    ValidationInfo,
    field_validator,
)
from pydantic_core import InitErrorDetails

from app.api.aufstellungen.schemas import FLAufstellungenPublic
from app.api.invitations.schemas import FLInvitationLinkRow
from app.api.spielberichte.schemas import FLSpielberichtPublic
from app.api.spiele.schemas import FLSpielJoined
from app.api.spieler.schemas import FLSpielerPublic, FLSpielerSelfKaderRow

# Imported rather than restated. Acyclic: no model of `teams` imports this file.
from app.api.teams.schemas import MAX_NUMBER_OF_GROUPS, FLAustritt, FLSaisonTeamEntry, FLTabelleRow, FLTeamPageTeam
from app.core import clock
from app.core.codes import Code, Rule
from app.core.crud import Anchored
from app.core.exceptions import Bound, rule_refusal
from app.shared.schemas.bounds import KADER_SIZE_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomTimeString, CustomVersion, refuse_reversed_span
from app.shared.schemas.literals import FLGruppenNames, FLSaisonStatus, FLSonderereignis, FLSpielerStufe
from app.shared.schemas.responses import BasePayload, BaseReadModel


class FLSaisonForfeitErgebnis(BaseModel):
    """What a fixture is awarded when one side does not appear, as both sides' goals rather than a margin.

    A level award needs a season with no knockout round.
    """

    sieger_tore: int = Field(ge=0)
    verlierer_tore: int = Field(ge=0)


# The three the fixture list is a function of. Named types because `FLSpielplanShape` carries the
# same three, and a bound spelled at two sites is a bound that drifts.
QualifiersPerGroup = Annotated[int, Field(gt=0)]
# The season's capacity: a team enters only a group the season offers -- a prefix of the closed set
# -- and only while it has room.
NumberOfGroups = Annotated[int, Field(gt=0, le=MAX_NUMBER_OF_GROUPS)]
# The floor stops a group phase generating no fixture at all. The ceiling keeps the widest season the two bounds admit,
# every group full and the bracket at its cap, inside one page of a season-scoped read.
MIN_TEAMS_PER_GROUP: Final = 2
MAX_TEAMS_PER_GROUP: Final = 8
TeamsPerGroup = Annotated[int, Field(ge=MIN_TEAMS_PER_GROUP, le=MAX_TEAMS_PER_GROUP)]


class FLSaisonRules(BaseModel):
    # No default on any of the points or the qualifiers: one would make the number a constant chosen
    # here, as a hardcoded 3/1/0 would.
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)
    loss_points: int = Field(ge=0)
    qualifiers_per_gruppe: QualifiersPerGroup

    number_of_gruppen: NumberOfGroups
    teams_per_gruppe: TeamsPerGroup

    # Which figure separates two clubs level on points. No default: one would make the order a constant chosen here.
    tiebreak_order: Literal["tordifferenz", "direkter_vergleich"]

    # A ceiling on one team's squad for one season, enforced at the squad write rather than here.
    max_kader_size: int = Field(gt=0, le=KADER_SIZE_MAX)

    forfeit_ergebnis: FLSaisonForfeitErgebnis

    # No validator holds `saison_spieler` to this: it bounds what the form offers, so narrowing it
    # cannot invalidate a season already played.
    allowed_stufen: list[FLSpielerStufe] = Field(min_length=1)


class FLSaisonSpielplan(BaseModel):
    """The day the draw last wrote the season's Spielplan, the one fact of a draw no stored matchday or fixture gives.

    No counts: what a season holds is counted off its stored matchdays and fixtures, which every write judges, so a
    stored copy could only drift from them (`FLSaisonDrawn`).
    """

    generated_at: CustomDateString


class FLSaisonBewerbung(BaseModel):
    """When the league accepts applications for this season: while today lies between `start` and `end`, both included.

    `open` pauses the form alone, its dates untouched and the applications already received staying in triage.
    """

    open: bool
    start: CustomDateString
    end: CustomDateString


class FLSaisonBewerbungPayload(FLSaisonBewerbung):
    """The application window as a season write sends it, judged apart from the season's own span: it may open before the season does."""

    # At the window's `end`, which a field validator here places on that date, the box a reversed window is repaired on.
    @field_validator("end")
    @classmethod
    def the_application_window_ends_after_it_opens(cls, end: str, info: ValidationInfo) -> str:
        if "start" in info.data:
            refuse_reversed_span(start=info.data["start"], end=end, kind="bewerbung_window_ends_before_start")

        return end


# Its own model rather than an alias of `FLSaisonBewerbung` above: the two windows are two decisions an administrator
# takes apart.
class FLSaisonRegistrierung(BaseModel):
    """When a pupil's entry is an ordinary one: from the season's activation to `end`, which falls before the season's start.

    Past `end` the link runs on until the season ends and an entry is a Nachnominierung; `open` pauses the link alone.
    """

    open: bool
    end: CustomDateString


# Private, so the read model and both payloads state these fields once, and the base itself
# publishes no OpenAPI component.
class _SaisonSpan(BaseModel):
    # No span check at this level: `refuse_reversed_span` is payload-only, and a read refusing a
    # stored reversal would hide the row from the edit that repairs it.
    start_date: CustomDateString
    end_date: CustomDateString


class _SaisonWritable(_SaisonSpan):
    rules: FLSaisonRules
    # No default, so the payloads have none: `PATCH` replaces the season wholesale, and an omitted
    # key would close the application window as an edit nobody asked for.
    bewerbung: FLSaisonBewerbung | None
    # No default either: an omitted key would shut the second window the same way.
    registrierung: FLSaisonRegistrierung | None


def _refused_at_the_end(
    window: FLSaisonBewerbung | FLSaisonRegistrierung, rule: Rule, message: LiteralString, bounds: Mapping[str, Bound]
) -> ValidationError:
    """`rule_refusal`'s refusal placed on a window's `end`, which the field validator naming the window prefixes with its own key.

    A line error at `("end",)`, as `pydantic_core.InitErrorDetails` spells one: a field validator's own refusal sits at its
    field, the window, which is no box a form can mark.
    """

    return ValidationError.from_exception_data(
        type(window).__name__, [InitErrorDetails(type=rule_refusal(rule, message, bounds), loc=("end",), input=window.end)]
    )


class _SaisonSpanPayload(_SaisonSpan, BasePayload):
    # Field validators, each at the end its rule judges, reading the start off `info.data`: a model validator's refusal sits at
    # the model, a path no box answers. `start_date` is declared first, so it is validated first; where it failed it is absent
    # from `info.data`, and its own refusal is the one answered.
    @field_validator("end_date")
    @classmethod
    def the_season_ends_after_it_starts(cls, end_date: str, info: ValidationInfo) -> str:
        """Judged on every edit, a `past` season's included: its end date stays editable so a mistyped one can be repaired.

        Its start date is fixed once a fixture has taken place, which `saison_start_taken_place` refuses on the stored season.
        """

        if "start_date" in info.data:
            refuse_reversed_span(start=info.data["start_date"], end=end_date, kind="saison_ends_before_start")

        return end_date


class _SaisonPayload(_SaisonSpanPayload, _SaisonWritable):
    # The window's own payload, which judges its span at its `end`.
    bewerbung: FLSaisonBewerbungPayload | None

    @field_validator("registrierung")
    @classmethod
    def the_registration_window_ends_before_the_season_starts(
        cls, registrierung: FLSaisonRegistrierung | None, info: ValidationInfo
    ) -> FLSaisonRegistrierung | None:
        """Registration closes before the season's first day: a pupil joining once play has begun is a Nachnominierung, not a registration.

        `latest` is the last day the window may end on, the day before `start_date`.
        """

        start_date = info.data.get("start_date")
        if registrierung is not None and start_date is not None and registrierung.end >= start_date:
            latest = clock.days_after(day=start_date, days=-1)
            raise _refused_at_the_end(
                registrierung,
                "registrierung_window_reaches_saison_start",
                "the registration window reaches the season's start",
                {"latest": latest},
            )

        return registrierung


class _SaisonStored(_SaisonWritable):
    # Its year in exactly `SAISON_ID_LENGTH` ASCII digits, as every `saison_id` referencing this one demands, and as the
    # ban's bound and the retention sweep's successor add to it and compare the sums as strings. `[0-9]`, never `\d`,
    # which matches Arabic-Indic and fullwidth digits too. The create mints the id, so no write takes one from a payload,
    # and the read-back names one a hand-written file stored.
    id: str = Field(validation_alias="_id", serialization_alias="id", pattern=f"^[0-9]{{{SAISON_ID_LENGTH}}}$")

    status: FLSaisonStatus

    version: int


class FLSaison(_SaisonStored, BaseReadModel):
    """A season as a read serves it, its stored fields alone."""


class FLSaisonRecord(_SaisonStored, Anchored):
    """A season as `saisons` stores it."""

    # Defaulted: the season's creation writes no key, the draw being what writes it. Stored and never served: the
    # editor serves its day inside `FLSaisonDrawn`, beside the counts of what the season holds.
    spielplan: FLSaisonSpielplan | None = None


class _SaisonAdminStates(FLSaison):
    # The two states the list's chip and the editor both read.

    # Derived per read by `has_started` off the stored `start_date`, the predicate every start lock reads, so a control
    # closed on it closes exactly what the endpoint refuses.
    begun: bool
    # Derived per read by `decided_podium` over the season's Finale, the rule the landing reads its `decided` state by,
    # so the list, the editor and the landing say one word of one season.
    decided: bool


class FLSaisonAdmin(_SaisonAdminStates):
    """The season as its editor reads it, with whether it has started, whether a fixture of it has taken place and whether it is decided."""

    # Derived per read by `has_taken_place` over every fixture of the season: true, the start date is fixed
    # (`saison_start_taken_place`), so the field closes exactly where the edit refuses. The editor's alone, since the
    # list offers no edit it would close.
    taken_place: bool


class FLSaisonAdminListed(_SaisonAdminStates):
    """One season as the admin list shows it: whether it has started and is decided, and how many clubs and matches it holds."""

    # Counted per read off `saison_teams`, never stored: every row, a club that left included, since a team never leaves
    # a season and the season's Teams page lists it with its Austritt.
    count_teams: int = Field(ge=0)
    # Counted per read off `spiele`, never stored, as the editor counts them (`FLSaisonDrawn`).
    count_spiele: int = Field(ge=0)


# The league's first season, the id a create mints where no season is stored. A literal because it is a fact about
# this league's own history.
FIRST_SAISON_YEAR: Final = 2026


# The rules a league's first season starts from, where no season holds any to carry on. Only that very first season's
# editable starting value, which its editor shows at once and keeps editable until its start, every later season copying
# the newest one's: no hardcoded scoring, since the table always reads the season's stored rules, which its own rules
# box sets.
FIRST_SAISON_RULES: Final = FLSaisonRules(
    win_points=3,
    draw_points=1,
    loss_points=0,
    qualifiers_per_gruppe=2,
    number_of_gruppen=2,
    teams_per_gruppe=5,
    tiebreak_order="tordifferenz",
    max_kader_size=KADER_SIZE_MAX,
    forfeit_ergebnis=FLSaisonForfeitErgebnis(sieger_tore=3, verlierer_tore=0),
    allowed_stufen=list(get_args(FLSpielerStufe.__value__)),
)


# The season's two days alone: the create makes the next season, which the server names and gives the newest season's
# rules, so no typed year can name one out of turn and no client restates the carry-over; its windows start closed,
# each set in the season's own editor.
class FLPostSaisonPayload(_SaisonSpanPayload):
    pass


# The patch shape is `_SaisonPayload`, and stays a name of its own: a private base publishes no
# OpenAPI component, and the generated client names the patch's body by it.
class FLPatchSaisonPayload(_SaisonPayload):
    version: CustomVersion


class FLSwapGruppenPayload(BasePayload):
    """The two clubs a group swap exchanges, in either order.

    Neither side carries a `gruppe`: reading one from the payload would let a stale form write a
    group nobody stands in.
    """

    team1_id: CustomObjectId
    team2_id: CustomObjectId


# What the swap judges each stored group by before it writes either club's.
FLGruppenNamesAdapter: Final = TypeAdapter(FLGruppenNames)


class FLSaisonAdminTeam(BaseReadModel):
    """One club's row of the season as the swap and the replacement list it, and as its registration link's row names it."""

    team_id: CustomObjectId
    name: str
    shorthand: str
    gruppe: FLGruppenNames
    austritt: FLAustritt | None


class FLSaisonAdminIncomingTeam(BaseReadModel):
    """A club a replacement may bring into the season: one still in the league that holds no row of it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: str
    shorthand: str


class FLSaisonsAdminRefusals(BaseReadModel):
    """Why the list's act would be refused if pressed now, by its write's own judgement; null where it takes it."""

    create: Code | None


class FLSaisonsAdminListResponse(BaseReadModel):
    """Every season, with the id the next create mints and why a create would be refused now."""

    saisons: list[FLSaisonAdminListed]
    next_saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    refusals: FLSaisonsAdminRefusals


class FLSaisonFrameEntry(BaseReadModel):
    """One season as a frame's season button lists it: its id and its span."""

    id: str = Field(validation_alias="_id", serialization_alias="id")
    start_date: CustomDateString
    end_date: CustomDateString


# What every season button's read projects of a season beside its id, and the order it lists them in, the newest
# first: the public frame's and each person's own list alike, so no two buttons order one league's seasons apart.
SAISON_FRAME_FIELDS: Final = ("start_date", "end_date")
SAISON_FRAME_ORDER: Final[Mapping[str, int]] = {"_id": -1}


class FLSaisonFrameResponse(BaseReadModel):
    """Every season the public may read, the newest first, and the one the site is on.

    `active_saison_id` is null for a league no season has been activated in; a season stays active, finished or not,
    until the next is activated.
    """

    saisons: list[FLSaisonFrameEntry]
    active_saison_id: str | None


class FLOwnSaisonsResponse(BaseReadModel):
    """The seasons a signed-in person holds a row in, the newest first, which their own frame's season button offers.

    A season the public frame withholds, a planned one, is served as any other: the person's row in it is what the
    frame leads to.
    """

    saisons: list[FLSaisonFrameEntry]


class FLPostSaisonResponse(BaseReadModel):
    created_id: str


class FLSpielplanShape(BaseReadModel):
    """The three rules a season's fixture list is a function of, as one combination the season's other rules admit."""

    number_of_gruppen: NumberOfGroups
    teams_per_gruppe: TeamsPerGroup
    qualifiers_per_gruppe: QualifiersPerGroup


class FLGenerateSpielplanPayload(BasePayload):
    """Whether this draw may replace what the season already holds; the draw runs on the season's stored rules.

    An absent body is a first draw: nothing is destroyed by omission.
    """

    replace: bool = Field(default=False)


class FLSaisonActRefusals(BaseReadModel):
    """Why each of the editor's season acts would be refused if pressed now, judged by its write's own rules; null where it takes it.

    `activate` and `undraw` are their writes' whole judgement, and `create` and `recreate` the draw's judgement of the
    stored rules over the clubs entered, `recreate` then the reports it would delete.
    """

    activate: Code | None
    create: Code | None
    recreate: Code | None
    undraw: Code | None


class FLSaisonDrawn(BaseReadModel):
    """A season's Spielplan as every write judges it: the matchdays and fixtures it holds, counted per read, and the draw's day."""

    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)
    generated_at: CustomDateString


class FLSaisonAdminResponse(BaseReadModel):
    """What the season editor shows, in one read: its season, clubs, shapes and matchdays, its acts' states and its registration links.

    `shapes` is every shape the season's other rules admit, which its rules form offers;
    `spielplan` is the Spielplan the season holds, `null` while it holds no fixture; `invitations`
    holds one row per club, in `teams`' order.
    """

    saison: FLSaisonAdmin
    teams: list[FLSaisonAdminTeam]
    incoming_teams: list[FLSaisonAdminIncomingTeam]
    shapes: list[FLSpielplanShape]
    spielplan: FLSaisonDrawn | None
    refusals: FLSaisonActRefusals
    invitations: list[FLInvitationLinkRow]


class FLTeamPageSpiel(FLSpielJoined):
    """One of a club's matches with its matchday's `position` and its phase's count of matchdays, which the page names the matchday by."""

    spieltag_position: int = Field(ge=1)
    count_spieltage_in_phase: int = Field(ge=1)


class FLTeamPageResponse(BaseReadModel):
    """One club's page in one season: the club, its row of the Tabelle, its matches and its squad.

    `standing` is null for a club no group of the Tabelle lists, one that left the league; `spiele` are in the order the
    draw numbered them, each with its matchday's `position`; the squad is the base tier's, names withheld where the
    pupil's consent does not publish them.
    """

    team: FLTeamPageTeam
    standing: FLTabelleRow | None
    spiele: list[FLTeamPageSpiel]
    kader: list[FLSpielerPublic]


class FLSpielerSaisonSelfSpiel(FLTeamPageSpiel):
    """One fixture of the pupil's club, with their own place in the club's line-up for it."""

    # True where the stored line-up starts them, false where it benches them, and null where it does not name them or
    # the club has stored none.
    starts: bool | None


class FLSpielerSaisonSelfResponse(BaseReadModel):
    """A pupil's own season: where they play, and their club's fixtures."""

    saison_id: str
    # Their squad row of this season, a deregistered one included; null where they hold none.
    kader: FLSpielerSelfKaderRow | None
    # Empty where they hold no squad row of this season.
    spiele: list[FLSpielerSaisonSelfSpiel]


class FLSpielSideStanding(BaseReadModel):
    """Where one side of a group match stands in the Tabelle: its group, and its `platz`, null while it holds none."""

    gruppe: FLGruppenNames
    platz: int | None = Field(gt=0)


class FLSpielSideStandings(BaseReadModel):
    """Each side's place in the Tabelle on a group match.

    Null on a knockout match, whose round is the match's own phase, and for a side the groups do not list.
    """

    team1: FLSpielSideStanding | None
    team2: FLSpielSideStanding | None


class FLSpielPageResponse(BaseReadModel):
    """One match as its page and its pop-up show it.

    The match, its matchday's `position` and its phase's count of matchdays, which together name the matchday, where
    each side stands, each side's line-up from the moment its club stores one, and what the public may read of its
    report, null where none is stored.
    """

    spiel: FLSpielJoined
    spieltag_position: int = Field(ge=1)
    count_spieltage_in_phase: int = Field(ge=1)
    standings: FLSpielSideStandings
    # Beside the report and never inside it: a line-up is the club's own, stored days before any report.
    aufstellungen: FLAufstellungenPublic
    bericht: FLSpielberichtPublic | None


class FLLandingSide(BaseReadModel):
    """A club as the landing names it, on the opening match or the podium, under the name and shorthand it plays the season under."""

    name: str
    shorthand: str


class FLLandingOpeningSpiel(BaseReadModel):
    """The season's opening match: when it is set to start, in Berlin wall time, its two sides and its Spieltag's `position`.

    A side is null while its slot is empty, as a match's own sides are.
    """

    date: CustomDateString
    time: CustomTimeString | None
    spieltag_position: int = Field(ge=1)
    team1: FLLandingSide | None
    team2: FLLandingSide | None
    # What befell the match, so the line draws it as every match block does.
    sonderereignis: FLSonderereignis | None


def saison_start(start_date: str) -> datetime:
    """The instant a season starts, which the landing counts down to: 00:00 in Berlin on its `start_date`, with that day's offset.

    The day's first minute exists on every day: Berlin changes its clocks at two and three in the morning.
    """

    return datetime.combine(date.fromisoformat(start_date), time(), tzinfo=clock.GERMANY)


# Places one to four by position, each its club, or null where the place is vacant, its club having left the season by
# then. A vacancy is still a decided place, so a season with one has all four in.
FLPodium = tuple[FLLandingSide | None, FLLandingSide | None, FLLandingSide | None, FLLandingSide | None]


class FLLandingCounts(BaseReadModel):
    """The league's four figures over every season the public reads, counted on every read and never stored.

    `count_saisons` is those seasons; `count_schulen` the clubs that took part in any of them, each counted once;
    `count_spiele` every match of any phase the Tabelle would count, one carrying an `ergebnis`, a forfeit among them;
    `count_tore` both sides' goals summed over the same matches, a forfeit's awarded goals among them, a shoot-out's never.
    """

    count_saisons: int = Field(ge=0)
    count_schulen: int = Field(ge=0)
    count_spiele: int = Field(ge=0)
    count_tore: int = Field(ge=0)


class _FLLandingSaisonFacts(BaseReadModel):
    """What the landing shows of the season the site is on in every state: `starts_at` is 00:00 in Berlin on its `start_date`."""

    id: str
    starts_at: datetime
    teams: list[FLSaisonTeamEntry]


class FLLandingBeforeStart(_FLLandingSaisonFacts):
    """Before its start date: its opening match, the earliest dated group match, null while none is."""

    state: Literal["before_start"]
    opening_spiel: FLLandingOpeningSpiel | None


class FLLandingRunning(_FLLandingSaisonFacts):
    """From its start date: two matches where the season has two, each side nearest first.

    A latest result and a next match where both exist, else two of the side that has them.
    """

    state: Literal["running"]
    recent: list[FLSpielJoined]
    upcoming: list[FLSpielJoined]


class FLLandingDecided(_FLLandingSaisonFacts):
    """Once all four places are in: places one to four in their order."""

    state: Literal["decided"]
    podium: FLPodium


# One member per state, so a state is served with exactly the facts it shows and a reader narrowing on `state` is handed
# them typed, rather than checking at run time for a field the flat shape left nullable in every state.
FLLandingSaison = Annotated[FLLandingBeforeStart | FLLandingRunning | FLLandingDecided, Field(discriminator="state")]


class FLBewerbungWindow(BaseReadModel):
    """The application window open today, by the one rule the submission refuses on: the season it is for and its last day."""

    saison_id: str
    end: CustomDateString


class FLLandingResponse(BaseReadModel):
    """The landing's facts: the season the site is on, null for a league that has none, an open window, and the league's figures."""

    saison: FLLandingSaison | None
    bewerbung_window: FLBewerbungWindow | None
    # The day the next window opens, by the judgement the form's page serves as `upcoming`.
    bewerbung_opens_on: CustomDateString | None
    counts: FLLandingCounts
