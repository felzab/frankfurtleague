"""
SPIELE · write endpoints, and the one admin-only read

Every mutation sits beside the reads for the resource it changes, in a second router whose guard is
`verify_access_admin` (ADR-0034).

 INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────

  • `verify_access_admin` is attached at ROUTER level, so every endpoint added here is guarded by
    construction. Never move the guard onto an individual endpoint.
  • There is NO POST and NO DELETE here, and neither is to be added (ADR-0045). A season's fixtures are
    all created at its start; a match is thereafter CANCELLED (`is_canceled`) or MOVED (`datum`), and
    those two are the whole vocabulary of change. Deleting one would leave every `teamN_quelle` naming
    its `spiel_nr` pointing at nothing, which the resolution reads as a typo and acts on by leaving the
    slot alone -- so the bracket would keep a team it should not, and report nothing.
  • `ergebnis` is DERIVED from the two `tore` values and is never accepted from the client. A fixture
    with an unresolved side has no goals to derive from and therefore no result (ADR-0041).
  • `elfmeterschiessen` IS accepted from the client -- it is a scoreline of its own and nothing else in
    the document states it -- but only on a KNOCKOUT fixture whose goals are level. Anywhere else it is
    discarded on the way in: a group-phase match has no tie to break, and a shoot-out on a fixture one
    side already won is a contradiction (ADR-0044).
  • BOTH of those live in `apply_payload_to_spiel`, and this handler states neither for itself. The
    `dry_run=true` preview applies the same function, so a normalisation restated here would be the
    one place the preview and the save could drift (ADR-0051).
  • The payload is written wholesale with `$set`, so a field absent from it is overwritten rather than
    preserved. That is why the money fields carry no Pydantic default. The keys come from the PAYLOAD's
    field set, not from the normalised fixture's, so `spiel_nr`, `spieltag_id`, `saison_id` and
    `saison_phase` are never in an update that has no business naming them.
  • `dry_run=true` opens NO transaction and writes nothing, and it runs every refusal first. A preview
    that could succeed where the save is refused is worse than no preview at all.
  • `patch_spiel_data` writes NO team document. Team statistics are derived from the matches on read
    (ADR-0026), so there is no second write to keep in step and no team to look up here. It does write
    other MATCH documents: entering a result resolves the season's bracket, which moves winners into
    the fixtures whose `quelle` names that match (ADR-0042).
  • Wiring the season cannot hold is a 409 (`REQ-WIRING-001`), decided by `find_wiring_refusal` inside
    the transaction and before the write (ADR-0046). The resolution's own containment of the same
    shapes stays: it is for data that never passed through this endpoint.
  • An OCCUPANT the season cannot hold is a 409 with its own code, decided by `find_eligibility_refusal`
    and `judge_spieltag_occupancy` beside it (ADR-0052). Distinct codes because the advice differs:
    reloading fixes a raced bracket and fixes nothing about a disqualified team.
  • Every refusal runs in `judge`, which BOTH paths call. That is the whole mechanism keeping the
    preview honest -- a rule added to one path and not the other is not expressible here.
  • `/action_required` DERIVES its bracket faults and stores none (ADR-0047). It is the only read here
    that does work beyond a filter, and it is uncached for the same reason the rest of the route is.
    Reporting a fault never resolves it: the containment in `resolve_bracket` is what owns that.

 WHY `/action_required` DOES NOT COLLIDE WITH `/{spiel_id}` ────────────────────────────────────────────────

  They are the same path shape at the same depth, in two routers with different authorization -- so
  declaration order cannot separate them. The `objectid` convertor does: `GET /spiele/{spiel_id}` in
  `router.py` matches only 24 hex characters, so "action_required" is not a candidate for it and routing
  reaches this endpoint whatever order the routers are included in. See `app/core/routing.py`.

 SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────────

  docs/backend/spec.md -- section 3, the write path step by step
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query
from motor.motor_asyncio import AsyncIOMotorClientSession

from app.api.saisons.crud import pull_saison_id_and_rules
from app.api.spiele.crud import (
    advance_bracket_winners,
    find_bracket_faults,
    preview_bracket_after_patch,
    pull_saison_membership,
    release_spieltag_sides,
)
from app.api.spiele.schemas import (
    FLPatchSpielDataPayload,
    FLPatchSpielDataResponse,
    FLSpiel,
    FLSpieleActionRequiredResponse,
    FLSpielJoined,
    FLSpielJoinedListAdapter,
    FLSpielListAdapter,
)
from app.api.spiele.services import (
    BookedSlot,
    SpieltagRelease,
    apply_payload_to_spiel,
    build_spiele_pipeline,
    find_clash_refusal,
    find_eligibility_refusal,
    find_fixture_date_refusal,
    find_wiring_refusal,
    judge_spieltag_occupancy,
)
from app.core.config import API_VERSION
from app.core.crud import aggregate_many_from_db, patch_one_in_db, pull_many_from_db, pull_one_from_db
from app.core.dependencies import (
    DBClient,
    SaisonsCollection,
    SaisonTeamsCollection,
    SpieleCollection,
    SpieltageCollection,
    TeamsCollection,
    get_german_date_str,
)
from app.core.exceptions import DocumentConflictException, DocumentNotFoundException
from app.core.routing import by_id
from app.core.security import verify_access_admin
from app.shared.schemas.custom import CustomObjectId, CustomRouteObjectId

router = APIRouter(
    prefix=f"/api/v{API_VERSION}/spiele",
    dependencies=[Depends(verify_access_admin)],
)


@router.get("/action_required", response_model=FLSpieleActionRequiredResponse, summary="Spiele needing attention")
async def get_spiele_action_required(
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    today: str = Depends(get_german_date_str),
) -> FLSpieleActionRequiredResponse:
    """
    List Spiele that need an admin's attention, and the bracket faults among them.

    A match qualifies if it is cancelled, is missing a date, time, venue or referee, is in the past
    with no result recorded, or is a knockout fixture with a side that has neither a team nor a
    `quelle`. That last shape is legal and permanent-by-default: nothing resolves such a slot and
    nothing else reminds the admin that it is theirs (ADR-0046). A Gruppenphase fixture is exempt --
    an unscheduled group match is an unfilled schedule, not an orphaned slot, and every group fixture
    legitimately carries no `quelle` forever. Not season-filtered: it spans every season.

    **`bracket_faults` is derived here rather than filtered** (ADR-0047). A fault is a contradiction
    between documents -- a `quelle` naming a match the season does not have, a cycle, a placing no
    standing will produce, a fixture resolving to one club -- so no Mongo filter can select one, and
    the resolution is what decides them. Every fixture a fault names is added to `spiele` below, so the
    client holds the document behind each fault whether or not the filter also selected it.

    Deliberately uncached on the frontend — admin-authorized data does not belong in a shared cache
    (ADR-0013), and a derived fault list would be wrong the moment a document changed under it anyway.
    """

    # Fetch all games with either a missing attribute or games which have a date in the past but don't
    # have a final score. Through `build_spiele_pipeline`, as both public reads are: this list renders
    # through the same `SpielCard`, so serving the unjoined shape here would be a DQ badge the grids
    # show and the triage list silently does not.
    spiele_raw = await aggregate_many_from_db(
        collection=spiele_collection,
        pipeline=build_spiele_pipeline(
            db_filter={
                "$or": [
                    {"is_canceled": True},
                    {"datum": None},
                    {"uhrzeit": None},
                    {"ort": None},
                    {"schiedsrichter": None},
                    {"datum": {"$lt": today}, "ergebnis": None},
                    {
                        "saison_phase": {"$ne": "gruppenphase"},
                        "$or": [
                            {"team1": None, "team1_quelle": None},
                            {"team2": None, "team2_quelle": None},
                        ],
                    },
                ]
            }
        ),
    )
    spiele = FLSpielJoinedListAdapter.validate_python(spiele_raw)

    bracket_faults, faulted_spiele = await find_bracket_faults(
        spiele_collection=spiele_collection,
        teams_collection=teams_collection,
        saisons_collection=saisons_collection,
    )

    # Keyed by id and not by `spiel_nr`, which repeats across the seasons this route spans. A faulted
    # fixture the filter above already selected keeps that copy; both come from the same collection in
    # the same request, so the two are the same document.
    by_id: dict[CustomObjectId, FLSpielJoined] = {spiel.id: spiel for spiel in spiele}
    for spiel in faulted_spiele:
        by_id.setdefault(spiel.id, spiel)

    return FLSpieleActionRequiredResponse(spiele=list(by_id.values()), bracket_faults=bracket_faults)


@router.patch(by_id("spiel_id"), response_model=FLPatchSpielDataResponse, summary="Update a Spiel")
async def patch_spiel_data(
    spiel_id: CustomRouteObjectId,
    spiel_data: Annotated[FLPatchSpielDataPayload, Body()],
    db: DBClient,
    spiele_collection: SpieleCollection,
    teams_collection: TeamsCollection,
    saisons_collection: SaisonsCollection,
    saison_teams_collection: SaisonTeamsCollection,
    spieltage_collection: SpieltageCollection,
    dry_run: Annotated[bool, Query(description="Report what this payload would move and destroy, and write nothing")] = False,
) -> FLPatchSpielDataResponse:
    """
    Update one Spiel, then resolve the season's playoff bracket.

    `ergebnis` is derived from the two `tore` values and must not be submitted. The payload is written
    wholesale, so every field must be present -- an omitted field is overwritten, not preserved.

    `elfmeterschiessen` records how a knockout that finished level was settled, and is kept only on a
    fixture outside the Gruppenphase whose two goal counts are equal; anywhere else it is discarded
    rather than refused, because a group draw is a final result and the goals are what say whether a
    shoot-out was possible at all (ADR-0044). It decides the bracket below and is invisible to the
    league table, which counts the match as the draw it was (ADR-0026).

    **A result can move fixtures other than this one.** The occupant of a slot referring to match 25 is
    the winner of match 25, so entering that match's result fills the slot, correcting it later moves
    the right team in, and deleting it empties the slot again (ADR-0042). A slot referring to a group
    placing is filled the same way, once no remaining fixture in that group can still change who holds
    it (ADR-0043). Every fixture written either way is named in `advanced_to`.

    `bracket_faults` names every stored contradiction this season's resolution walked past: a `platz`
    its group will never produce, a placing the tiebreak chain cannot separate in a group that has
    finished, a `quelle` naming a match the season does not have, a chain of references that closes on
    itself, and a fixture whose two sides resolve to one club (ADR-0047). A group still being played is
    not reported: that placing is simply not decided yet. The same list is re-derivable at
    `GET /spiele/action_required`, so missing it here is not losing it.

    The league table follows on its own: team statistics are computed from the match documents by
    `GET /teams`, so a result entered here is reflected the next time that table is read.

    **`dry_run=true` answers the same question and writes nothing** (ADR-0051). It applies the payload
    in memory through `apply_payload_to_spiel`, resolves the bracket against the season that produces,
    and returns the same response -- so the edit surface can name exactly which fixtures a save would
    take a stored result from, before the admin commits to it. Every refusal below runs first, so a
    preview either reports the save's own 409 or the save's own outcome; it can never promise a write
    that would then be refused.

    **Wiring the season cannot hold is refused with a 409** (`REQ-WIRING-001`, ADR-0046) before
    anything is written: a `quelle` on a Gruppenphase fixture, a `spiel` source the season does not
    have or that is not played before this fixture, one outcome feeding two slots, and a team
    submitted against a side a `quelle` maintains. The form does not offer these shapes, so a request
    carrying one is stale or racing another admin -- reloading is the way past the 409.

    **An occupant the season cannot hold is refused with a 409 of its own** (ADR-0052), because the
    advice differs and "reload the page" is wrong for it. `REQ-ELIGIBILITY-001` is a disqualified team
    being newly fielded, `REQ-ELIGIBILITY-002` a team with no `saison_teams` row for the season, and
    `REQ-SPIELTAG-001` a team that would then stand in two fixtures of one Spieltag on a side the
    resolution maintains. Resubmitting a stored occupant unchanged always passes, or the fixture whose
    occupant was disqualified after being placed would be the one fixture nobody could correct.

    **A Spieltag clash against a MANUAL side moves it rather than refusing.** Fielding a team here is
    a statement about where it plays, so the other fixture gives the team up -- and loses its own
    result with it, for the reason an advancement does. Every side emptied that way is named in
    `released_sides`.

    `saison_id` is deliberately not part of the payload: it is not declared on the model and Pydantic
    would discard it. The frontend passes it separately, for cache invalidation only.
    """

    # Read BEFORE anything else and in FULL, because the payload's normalisation needs the fixture it
    # is applied to: `saison_phase` decides whether a shoot-out survives, and the preview resolves the
    # bracket against the fixture this produces. Nothing on the payload writes `saison_id`,
    # `saison_phase`, `spiel_nr` or `spieltag_id`, so they cannot change under this request. The 404
    # the write raises below stays, as the guard against a match deleted between the two.
    stored_raw = await pull_one_from_db(collection=spiele_collection, db_filter={"_id": spiel_id})
    stored = FLSpiel.model_validate(stored_raw)
    saison_id = stored.saison_id

    # Every rule the write path applies to the payload, in one place, so the preview below and the
    # save cannot normalise it differently (ADR-0051).
    patched = apply_payload_to_spiel(stored, spiel_data)

    # The season's own scoring, which the standing behind a `gruppe` reference is derived with, exactly
    # as `GET /teams` derives the table (ADR-0026). Read outside any transaction on both paths: no
    # season document is written here, so there is nothing of a transaction's own to see.
    _, saison_rules = await pull_saison_id_and_rules(saisons_collection=saisons_collection, saison_id=saison_id)

    async def judge(session: AsyncIOMotorClientSession | None) -> tuple[list[FLSpiel], list[SpieltagRelease]]:
        """
        The season as this request sees it, and the sides another fixture must give up -- refusing first.

        Shared by the preview and the save so a preview can never succeed where the save is refused,
        which is the disagreement the whole extraction exists to prevent. Every refusal is raised here,
        before either path writes or resolves anything.
        """

        season_raw = await pull_many_from_db(collection=spiele_collection, db_filter={"saison_id": saison_id}, session=session)
        season = FLSpielListAdapter.validate_python(season_raw)

        # The rules are `find_wiring_refusal`'s (ADR-0046): wiring on a group fixture, a source the
        # season cannot honour, one outcome feeding two slots, and a hand-set team on a maintained
        # side. The English detail is for the log; the form prevents these shapes, so a request
        # carrying one is stale or raced.
        wiring_refusal = find_wiring_refusal(spiel_id, spiel_data, season)
        if wiring_refusal is not None:
            raise DocumentConflictException(error_code="REQ-WIRING-001", message=wiring_refusal)

        # The occupants, which the wiring rules deliberately say nothing about (ADR-0052). The junction
        # is read through the session on the write path, so a disqualification committed by this same
        # transaction is visible to the rule that reads it.
        membership = await pull_saison_membership(saison_teams_collection=saison_teams_collection, saison_id=saison_id, session=session)
        eligibility_refusal = find_eligibility_refusal(spiel_id, spiel_data, season, membership)
        if eligibility_refusal is not None:
            raise DocumentConflictException(error_code=eligibility_refusal.error_code, message=eligibility_refusal.message)

        verdict = judge_spieltag_occupancy(spiel_id, spiel_data, season)
        if verdict.refusal is not None:
            raise DocumentConflictException(error_code=verdict.refusal.error_code, message=verdict.refusal.message)

        # The fixture's own date against the span of the matchday it belongs to (`REQ-DATE-001`). Read
        # through the session like everything else here, so a matchday widened by a concurrent write is
        # seen. `stored` is the fixture being patched, which is what names the matchday: `spieltag_id` is
        # on no payload, so this write cannot move it.
        stored = next((entry for entry in season if entry.id == spiel_id), None)
        if stored is not None:
            # `find_one` directly rather than `pull_one_from_db`, which takes no session. A fixture whose
            # matchday is missing is left alone: `spieltag_id` is on no payload, so this write did not
            # create that dangling reference and refusing here would trap the fixture rather than fix it.
            spieltag_raw = await spieltage_collection.find_one(
                {"_id": stored.spieltag_id},
                {"beginn": 1, "ende": 1},
                session=session,
            )
            if spieltag_raw is not None:
                date_refusal = find_fixture_date_refusal(
                    datum=spiel_data.datum,
                    spieltag_beginn=str(spieltag_raw["beginn"]),
                    spieltag_ende=str(spieltag_raw["ende"]),
                )
                if date_refusal is not None:
                    error_code, detail = date_refusal
                    raise DocumentConflictException(error_code=error_code, message=detail)

        # The venue and the referee, across EVERY season rather than this one: a ground is double-booked by
        # two fixtures at one time whether or not they belong to the same competition. Only the same day is
        # read, because the buffer is a within-day comparison.
        if spiel_data.datum is not None:
            claims: list[BookedSlot] = []
            for resource, field, chosen in (
                ("Spielort", "ort.spielort_id", spiel_data.ort.spielort_id if spiel_data.ort is not None else None),
                (
                    "Schiedsrichter",
                    "schiedsrichter.schiedsrichter_id",
                    spiel_data.schiedsrichter.schiedsrichter_id if spiel_data.schiedsrichter is not None else None,
                ),
            ):
                if chosen is None:
                    continue
                async for other in spiele_collection.find(
                    {field: chosen, "datum": spiel_data.datum, "uhrzeit": {"$ne": None}, "_id": {"$ne": spiel_id}, "is_canceled": False},
                    {"spiel_nr": 1, "datum": 1, "uhrzeit": 1},
                    session=session,
                ):
                    claims.append(
                        BookedSlot(
                            spiel_nr=int(other["spiel_nr"]),
                            datum=str(other["datum"]),
                            uhrzeit=str(other["uhrzeit"]),
                            resource=resource,  # type: ignore[arg-type]
                        )
                    )

            clash_refusal = find_clash_refusal(datum=spiel_data.datum, uhrzeit=spiel_data.uhrzeit, booked=claims)
            if clash_refusal is not None:
                error_code, detail = clash_refusal
                raise DocumentConflictException(error_code=error_code, message=detail)

        return season, verdict.releases

    if dry_run:
        # No transaction and no write. The refusals above have already run, so a preview answers either
        # the same 409 the save would or the exact list of fixtures the save would rewrite (ADR-0051).
        season, releases = await judge(session=None)
        advanced_to, released_sides, bracket_faults = await preview_bracket_after_patch(
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            season=season,
            patched=patched,
            releases=releases,
        )
        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    # Written wholesale, and built from the NORMALISED fixture rather than from the payload -- the two
    # differ exactly where a rule above applies, and taking the keys from the payload's own field set
    # is what keeps `spiel_nr`, `spieltag_id`, `saison_id` and `saison_phase` out of a `$set` that has
    # no business naming them.
    document = patched.model_dump(context={"keep_oid": True}, include={*FLPatchSpielDataPayload.model_fields, "ergebnis"})

    # The transaction is what makes the result and the advancement it causes one fact: a bracket that
    # resolved against a result the caller never committed would be worse than one that did not resolve.
    #
    # `with_transaction` rather than a bare `start_transaction`, because two saves in one season each
    # resolve the whole bracket and can write-conflict on the same advanced fixture -- a transient
    # error the driver labels as retryable, which the bare form would surface as a 500. The callback
    # is safe to re-run: the `$set` states absolute values and the resolution recomputes from scratch,
    # so a retry writes the same thing the first attempt would have. The 404 below is not transient
    # and aborts without retrying.
    async def write_result_and_resolve_bracket(session: AsyncIOMotorClientSession) -> FLPatchSpielDataResponse:
        # Refused BEFORE anything is written, inside the transaction, against the season as this
        # request sees it -- so a retry after a write conflict revalidates against fresh reads, and a
        # refusal leaves the season exactly as it was.
        _, releases = await judge(session=session)

        patched_spiel_raw = await patch_one_in_db(
            collection=spiele_collection,
            filter={"_id": spiel_id},
            update={"$set": document},
            session=session,
        )
        # `find_one_and_update` returns None only when nothing matched, so this is the 404 branch
        # rather than an error check.
        if patched_spiel_raw is None:
            raise DocumentNotFoundException(
                filter={"_id": spiel_id},
                error_code="DB-COMMON-001",
            )

        # Before the resolution, not after: a slot this release opens can be refilled by the very
        # resolution that follows it, and the reverse order would leave the season one pass behind.
        released_sides = await release_spieltag_sides(spiele_collection=spiele_collection, releases=releases, session=session)

        advanced_to, bracket_faults = await advance_bracket_winners(
            spiele_collection=spiele_collection,
            teams_collection=teams_collection,
            saison_id=saison_id,
            rules=saison_rules,
            session=session,
        )

        return FLPatchSpielDataResponse(advanced_to=advanced_to, released_sides=released_sides, bracket_faults=bracket_faults)

    async with await db.start_session() as session:
        return await session.with_transaction(write_result_and_resolve_bracket)
