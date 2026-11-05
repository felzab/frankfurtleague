from datetime import date, datetime, time, timedelta
from typing import Annotated, Final, Literal, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, model_validator

from app.api.spielberichte.schemas import FLSpielberichtPublic
from app.api.spiele.schemas import FLSpielJoined
from app.api.spieler.schemas import FLSpielerPublic
from app.api.teams.schemas import MAX_NUMBER_OF_GROUPS, FLAustritt, FLSaisonTeamEntry, FLTabelleRow, FLTeamPageClub
from app.core import clock

# Imported rather than restated. Acyclic: no model of `teams` imports this file --
# `teams/services.py` does, and no model there.
from app.core.crud import Anchored
from app.core.exceptions import rule_refusal
from app.shared.schemas.bounds import LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, SAISON_ID_LENGTH
from app.shared.schemas.custom import CustomDateString, CustomObjectId, CustomTimeString, refuse_reversed_span
from app.shared.schemas.literals import FLGruppenNames, FLSaisonPhase, FLSaisonStatus, FLSortOrder, FLSpielerStufe
from app.shared.schemas.responses import BaseAPIResponse, BaseReadModel

type FLSaisonsSortOptions = Literal["_id", "start_date", "end_date"]


class FLSaisonForfeitErgebnis(BaseModel):
    """What a fixture is awarded when one side does not appear.

    Both sides' goals rather than a margin, composed at `app/api/spiele/services.py :: apply_payload_to_spiel`.
    A LEVEL award needs a season with no knockout round (`rules_forfeit_unentschieden_in_a_knockout`).
    """

    sieger_tore: int = Field(ge=0)
    verlierer_tore: int = Field(ge=0)


# The three the fixture list is a function of. Named types because `FLSpielplanShape` carries the
# same three, and a bound spelled at two sites is a bound that drifts.
QualifiersPerGroup = Annotated[int, Field(gt=0)]
# The season's capacity: a team enters only a group the season offers -- a prefix of the closed set
# -- and only while it has room.
NumberOfGroups = Annotated[int, Field(gt=0, le=MAX_NUMBER_OF_GROUPS)]
# The floor stops a group phase generating no fixture at all; the ceiling bounds one GROUP, where
# what a whole season may play is `rules_spiele_over_one_read`, weighing every group and the bracket at once.
MIN_TEAMS_PER_GROUP: Final = 2
MAX_TEAMS_PER_GROUP: Final = 16
TeamsPerGroup = Annotated[int, Field(ge=MIN_TEAMS_PER_GROUP, le=MAX_TEAMS_PER_GROUP)]


class FLSaisonRules(BaseModel):
    win_points: int = Field(gt=0)
    draw_points: int = Field(ge=0)
    # No default on any of the three: one would make the number a constant chosen here, as a
    # hardcoded 3/1/0 would.
    qualifiers_per_gruppe: QualifiersPerGroup

    number_of_gruppen: NumberOfGroups
    teams_per_gruppe: TeamsPerGroup

    # Which figure separates two clubs level on points. No default, for the reason above.
    tiebreak_order: Literal["tordifferenz", "direkter_vergleich"]

    # A ceiling on one team's squad for one season, enforced at the squad write rather than here.
    max_kadergroesse: int = Field(gt=0)

    forfeit_ergebnis: FLSaisonForfeitErgebnis

    # No validator holds `saison_spieler` to this: it bounds what the FORM offers, so narrowing it
    # cannot invalidate a season already played.
    allowed_stufen: list[FLSpielerStufe] = Field(min_length=1)


class FLSaisonSpielplan(BaseModel):
    """What the generator left behind on the season it wrote.

    Counts rather than a hash: these are the two numbers an admin can compare against the page in
    front of them, and a hash answers no question anyone standing there is asking.
    """

    generated_at: CustomDateString
    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)


class FLSaisonBewerbung(BaseModel):
    """When the league accepts applications for this season: while today lies between `start` and `end`, both included.

    No flag beside the span: closing early is moving `end` to today (`app/api/bewerbungen/services.py ::
    saison_nimmt_bewerbungen_an`).
    """

    start: CustomDateString
    end: CustomDateString


class FLSaisonRegistrierung(BaseModel):
    """When a pupil may register for this season: from its activation to `end`, which falls before the season's start.

    No start of its own, the activation being the opening (`app/api/registrierungen/services.py ::
    saison_nimmt_registrierungen_an`); `offen` pauses the link alone. Its own model rather than an alias of
    `FLSaisonBewerbung` above: the two windows are two decisions an administrator takes apart.
    """

    offen: bool
    end: CustomDateString


class FLSaisonPhaseSchedule(BaseModel):
    """One phase of a season: how many matchdays it takes, and how many matches each holds.

    A phase the bracket does not reach is ABSENT rather than present with zeroes, so the list IS the
    phases the season plays, in playing order.
    """

    phase: FLSaisonPhase
    spieltage: int = Field(ge=0)
    matches_per_spieltag: int = Field(ge=0)


# Private, so the read model and both payloads state these fields once, and the base itself
# publishes no OpenAPI component.
class _SaisonWritable(BaseModel):
    # No span check at this level: `refuse_reversed_span` is payload-only, and a read refusing a
    # stored reversal would hide the row from the edit that repairs it.
    start_date: CustomDateString
    end_date: CustomDateString
    rules: FLSaisonRules
    # NO default, so the payloads have none: `PATCH` replaces the season wholesale, and an omitted
    # key would close the application window as an edit nobody asked for.
    bewerbung: FLSaisonBewerbung | None
    # No default either, for the reason above: the second window is shut by the same omission.
    registrierung: FLSaisonRegistrierung | None


class _SaisonPayload(_SaisonWritable):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def the_season_ends_after_it_starts(self) -> Self:
        """Judged on every edit, a `past` season's included: its end date stays editable so a mistyped one can be repaired.

        Its start date is fixed once a fixture has taken place, which `saison_start_taken_place` refuses on the stored season.
        """

        refuse_reversed_span(start=self.start_date, end=self.end_date, kind="saison_ends_before_start")

        return self

    @model_validator(mode="after")
    def the_application_window_ends_after_it_opens(self) -> Self:
        """Judged apart from the season's own span: a window may legitimately open before the season does."""

        if self.bewerbung is not None:
            refuse_reversed_span(start=self.bewerbung.start, end=self.bewerbung.end, kind="bewerbung_window_ends_before_start")

        return self

    @model_validator(mode="after")
    def the_registration_window_ends_before_the_season_starts(self) -> Self:
        """Registration closes before the season's first day: a pupil joining once play has begun is a Nachnominierung, not a registration.

        `latest` is the last day the window may end on, the day before `start_date`.
        """

        if self.registrierung is not None and self.registrierung.end >= self.start_date:
            latest = (date.fromisoformat(self.start_date) - timedelta(days=1)).isoformat()
            raise rule_refusal(
                "registrierung_window_reaches_saison_start", "the registration window reaches the season's start", {"latest": latest}
            )

        return self


class _SaisonStored(_SaisonWritable):
    # Exactly `SAISON_ID_LENGTH` characters, as every `saison_id` referencing this one demands:
    # without it, an id like "2026/27" validates here and every document pointing at it fails on read.
    id: str = Field(validation_alias="_id", serialization_alias="id", min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)

    status: FLSaisonStatus

    # DEFAULTED: the season's creation writes no key, the generator being what writes it.
    spielplan: FLSaisonSpielplan | None = None

    # 0 until a write raises it, as the create stamps it.
    version: int = 0


class FLSaison(_SaisonStored, BaseReadModel):
    # DERIVED, and on no document. Injected before validation, because a computed field would close
    # an import cycle.
    schedule: tuple[FLSaisonPhaseSchedule, ...]


class FLSaisonRecord(_SaisonStored, Anchored):
    """A season as `saisons` stores it: no derived schedule."""


class FLSaisonAdmin(FLSaison):
    """The same season for the admin surfaces, with whether it has started and whether a fixture of it has taken place."""

    # DERIVED per read by `app/api/saisons/services.py :: has_started` off the stored `start_date`, the predicate
    # every start lock reads, so a control closed on it closes exactly what the endpoint refuses.
    begun: bool
    # DERIVED per read by `app/api/teams/services.py :: has_taken_place` over every fixture of the season: true,
    # the start date is fixed (`saison_start_taken_place`), so the field closes exactly where the edit refuses.
    taken_place: bool


FLSaisonAdminListAdapter = TypeAdapter(list[FLSaisonAdmin])


class FLSaisonsFilterParams(BaseModel):
    # No `saison_id`: this narrows a list, where `GET /saisons/{saison_id}` names one.
    status: FLSaisonStatus | None = None

    limit: int = Field(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX)
    sort_by: FLSaisonsSortOptions = Field(default="_id")
    order: FLSortOrder = Field(default="asc")


# The league's FIRST season, and the floor an id may not fall below. A LITERAL because it is a fact
# about this league's own history; the ceiling below is a fact about the calendar and is computed.
FIRST_SAISON_YEAR: Final = 2026


def refuse_a_saison_year_outside_the_league(value: str) -> str:
    """The half a digits-only pattern cannot express: an alternation over the legal years would be a literal somebody maintains."""

    # Read PER VALIDATION: a ceiling computed at import pins the year the process started, so the
    # first January after a long-running deploy would refuse next season's id.
    newest = clock.now().year + 1

    # `int` is total only because the pattern ran first: drop it and `int`'s own message carries the
    # rejected value into the log.
    if not FIRST_SAISON_YEAR <= int(value) <= newest:
        raise rule_refusal(
            "saison_year_out_of_range", "the season id names a year outside the league's", {"min": FIRST_SAISON_YEAR, "max": newest}
        )

    return value


class FLPostSaisonPayload(_SaisonPayload):
    # CHOSEN, not generated: `saisons._id` is the string every `saison_id` references, so this is
    # the one create payload carrying an id. No strip: the digits refuse a padded id rather than repair
    # it, and constraints set after a validator would leave the pattern out of the published schema.

    # `[0-9]` and never `\d`, which pydantic's Rust engine reads as `\p{Nd}`: an Arabic-Indic or
    # fullwidth year parses as a number, sorts nowhere near its neighbours and can never be retyped.

    # The width is `SAISON_ID_LENGTH`'s alone: a pattern spelling it as well would refuse an id of the
    # declared length the moment that constant moves, every mirror having followed it.
    id: Annotated[
        str,
        StringConstraints(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH, pattern=r"^[0-9]+$"),
        AfterValidator(refuse_a_saison_year_outside_the_league),
    ]


# The patch shape IS `_SaisonPayload`, and stays a name of its own: a private base publishes no
# OpenAPI component, and the generated client names the patch's body by it.
class FLPatchSaisonPayload(_SaisonPayload):
    # The `version` the editor was served, so a save over a season another write moved since is refused as stale.
    version: int


class FLSwapGruppenPayload(BaseModel):
    """The two clubs a group swap exchanges. Symmetric.

    Neither side carries a `gruppe`: reading one from the payload would let a stale form write a
    group nobody stands in.
    """

    model_config = ConfigDict(extra="forbid")

    team1_id: CustomObjectId
    team2_id: CustomObjectId


class FLSwapGruppenResponse(BaseAPIResponse):
    """Both junction rows as the swap left them, plus `rewritten_spiele` -- the second half of the write, reported not assumed."""

    # Stated on a RESPONSE because `app/api/saisons/admin_router.py :: swap_gruppen` builds this model
    # in-transaction and before the junction writes: a path id outside the width aborts the exchange
    # rather than failing the echo of a swap that landed.
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    team1_id: CustomObjectId
    team1_gruppe: FLGruppenNames
    team2_id: CustomObjectId
    team2_gruppe: FLGruppenNames
    rewritten_spiele: int


class FLSaisonAdminTeam(BaseReadModel):
    """One club's row of the season as the editor's swap and replacement sections list it, graded as each write judges it.

    Both flags are `app/api/teams/services.py :: has_taken_place` over the row's fixtures, the predicate each write's
    `sides_taken_place` reads: over its group fixtures for the swap, which rewrites those alone, so a pair is closed
    where either club's is; over every fixture for the replacement, which hands the whole schedule over.
    """

    team_id: CustomObjectId
    name: str
    shorthand: str
    gruppe: FLGruppenNames
    austritt: FLAustritt | None
    group_fixture_taken_place: bool
    fixture_taken_place: bool


class FLSaisonAdminClub(BaseReadModel):
    """A club a replacement may bring into the season: one still in the league that holds no row of it."""

    id: CustomObjectId = Field(validation_alias="_id", serialization_alias="id")
    name: str
    shorthand: str


class FLSaisonsAdminListResponse(BaseAPIResponse):
    format: Literal["list"] = "list"
    saisons: list[FLSaisonAdmin]


class FLSaisonFrameEntry(BaseReadModel):
    """One season as the season pages' frame lists it: its id and its span; which one the site is on is the response's."""

    id: str = Field(validation_alias="_id", serialization_alias="id")
    start_date: CustomDateString
    end_date: CustomDateString


FLSaisonFrameEntryListAdapter = TypeAdapter(list[FLSaisonFrameEntry])


class FLSaisonFrameResponse(BaseAPIResponse):
    """Every season the public may read, the newest first, and the one the site is on.

    `active_saison_id` is null for a league no season has been activated in; a season stays active, finished or not,
    until the next is activated.
    """

    saisons: list[FLSaisonFrameEntry]
    active_saison_id: str | None


class FLSaisonsSingleResponse(BaseAPIResponse):
    format: Literal["single"] = "single"
    saison: FLSaison


class FLPostSaisonResponse(BaseAPIResponse):
    created_id: str


class FLActivateSaisonResponse(BaseAPIResponse):
    """How many seasons the activation moved off `active` -- normally exactly one."""

    deactivated: int


class FLSpielplanShape(BaseModel):
    """The three rules a season's fixture list is a function of, as this draw is to run from.

    All three or none: the draw is one function of the whole shape, and a payload naming half
    of it would take the rest off a season about to stop matching it.
    """

    model_config = ConfigDict(extra="forbid")

    number_of_gruppen: NumberOfGroups
    teams_per_gruppe: TeamsPerGroup
    qualifiers_per_gruppe: QualifiersPerGroup


class FLGenerateSpielplanPayload(BaseModel):
    """Whether this draw may REPLACE what the season already holds, and the shape it runs from.

    An absent body is a first draw off the season's own rules: nothing is destroyed and no
    number moves by omission. `spielplan_replace_outside_its_window` bounds a confirmed one.
    """

    # The payload the rule was found on: a misspelled `shape` validates as
    # ABSENT, so a confirmed replace destroys fixtures off the season's OLD rules, under a 201
    # reporting a shape that never moved.
    model_config = ConfigDict(extra="forbid")

    replace: bool = Field(default=False)

    # ABSENT keeps the season's stored three, which is what drawing off its own rules is. The rest of
    # `FLSaisonRules` stays `PATCH`'s alone: those rules shaped no fixture, and carrying them here
    # would give every one of them a second writer.
    shape: FLSpielplanShape | None = Field(default=None)


class FLGenerateSpielplanResponse(BaseAPIResponse):
    """What the draw wrote, and what a confirmed replace deleted first, flat rather than nested.

    An admin reads the written counts without a second request, and they are the same numbers the
    season's own watermark keeps, so the two can be compared by eye.
    """

    # No `extra="forbid"` here: the rule reaches request bodies alone, and this
    # is a response model.
    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)
    generated_at: CustomDateString

    # Off the replace's own `DeleteResult`s, so a confirmation is answered with what it destroyed
    # rather than with what was asked for. Zero on a first draw, which deletes nothing.
    removed_spieltage: int = Field(default=0, ge=0)
    removed_spiele: int = Field(default=0, ge=0)


class FLUndrawSpielplanResponse(BaseAPIResponse):
    """What removing the season's Spielplan took away, on the shape the draw reports.

    Both counts are zero on a season already undrawn, which is why the watermark is reported apart:
    it is the one thing a season can hold with neither collection behind it.
    """

    saison_id: str = Field(min_length=SAISON_ID_LENGTH, max_length=SAISON_ID_LENGTH)
    spieltage: int = Field(ge=0)
    spiele: int = Field(ge=0)
    watermark_cleared: bool


class FLSaisonAdminResponse(BaseAPIResponse):
    """What the season editor shows, in one read: the season, its clubs, the clubs a replacement may bring in, its shapes and its matchdays.

    `shapes` is every shape the season's other rules admit, judged as the draw judges a shape it is given;
    `count_spieltage` is the matchdays the season holds.
    """

    saison: FLSaisonAdmin
    teams: list[FLSaisonAdminTeam]
    incoming_clubs: list[FLSaisonAdminClub]
    shapes: list[FLSpielplanShape]
    count_spieltage: int = Field(ge=0)


class FLTeamPageSpiel(FLSpielJoined):
    """One of a club's matches with its matchday's `position` and its phase's count of matchdays, which the page names the matchday by."""

    spieltag_position: int = Field(ge=1)
    count_spieltage_in_phase: int = Field(ge=1)


FLTeamPageSpielListAdapter: Final = TypeAdapter(list[FLTeamPageSpiel])


class FLTeamPageResponse(BaseAPIResponse):
    """One club's page in one season: the club, its row of the Tabelle, its matches and its squad.

    `standing` is null for a club no group of the Tabelle lists, one that left the league; `spiele` are in the order the
    draw numbered them, each with its matchday's `position`; the squad is the base tier's, names withheld where the
    pupil's consent does not publish them.
    """

    team: FLTeamPageClub
    standing: FLTabelleRow | None
    spiele: list[FLTeamPageSpiel]
    kader: list[FLSpielerPublic]


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


class FLSpielPageResponse(BaseAPIResponse):
    """One match as its page and its pop-up show it.

    The match, its matchday's `position` and its phase's count of matchdays, which together name the matchday, where
    each side stands, and what the public may read of its report, null where none is stored.
    """

    spiel: FLSpielJoined
    spieltag_position: int = Field(ge=1)
    count_spieltage_in_phase: int = Field(ge=1)
    standings: FLSpielSideStandings
    bericht: FLSpielberichtPublic | None


class FLLandingSide(BaseReadModel):
    """A club as the landing names it, on the opening match or the podium, under the name and shorthand it plays the season under."""

    name: str
    shorthand: str


class FLLandingOpeningSpiel(BaseReadModel):
    """The season's opening match: when it is set to start, in Berlin wall time, its two sides and its Spieltag's `position`.

    A side is null while its slot is empty, as a match's own sides are.
    """

    datum: CustomDateString
    uhrzeit: CustomTimeString | None
    spieltag_position: int = Field(ge=1)
    team1: FLLandingSide | None
    team2: FLLandingSide | None


def saison_start(start_date: str) -> datetime:
    """The instant a season starts, which the landing counts down to: 00:00 in Berlin on its `start_date`, with that day's offset.

    The day's first minute exists on every day: Berlin changes its clocks at two and three in the morning.
    """

    return datetime.combine(date.fromisoformat(start_date), time(), tzinfo=clock.GERMANY)


# Places one to four by position, each its club, or null where the place is vacant, its club having left the season by
# then. A vacancy is still a decided place, so a season with one has all four in.
FLPodium = tuple[FLLandingSide | None, FLLandingSide | None, FLLandingSide | None, FLLandingSide | None]


class FLLandingCounts(BaseReadModel):
    """Three of the season's four figures, counted on every read: its goals, its matches and its matchdays.

    The fourth, its clubs, is the length of the `teams` served beside them. `count_spiele` is every match of any phase the
    Tabelle would count, one carrying an `ergebnis`, a forfeit among them, so a season before its first played match reads
    0; `count_tore` is both sides' goals summed over the same matches: a forfeit's awarded goals among them, a shoot-out's
    never.
    """

    count_tore: int = Field(ge=0)
    count_spiele: int = Field(ge=0)
    count_spieltage: int = Field(ge=0)


class _FLLandingSaisonFacts(BaseReadModel):
    """What the landing shows of the season the site is on in every state: `start` is 00:00 in Berlin on its `start_date`."""

    id: str
    start: datetime
    counts: FLLandingCounts
    teams: list[FLSaisonTeamEntry]


class FLLandingBeforeStart(_FLLandingSaisonFacts):
    """Before its start date: its opening match, the earliest dated group match, null while none is."""

    state: Literal["before_start"]
    opening_spiel: FLLandingOpeningSpiel | None


class FLLandingRunning(_FLLandingSaisonFacts):
    """From its start date: the latest result and the next match, at most one of each, empty where there is none."""

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


class FLLandingResponse(BaseAPIResponse):
    """The landing's facts: the season the site is on, null for a league that has none, and an open window."""

    saison: FLLandingSaison | None
    bewerbung_window: FLBewerbungWindow | None
