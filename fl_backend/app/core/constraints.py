import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import partial
from typing import Any, TypedDict

from pymongo import ASCENDING, DESCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.core.collections import Collection
from app.core.crud import GERMAN_COLLATION
from app.shared.schemas.bounds import ADRESSWECHSEL_NACHLAUF_TAGE, AKTION_RETENTION_SECONDS
from app.shared.schemas.literals import KONTAKT_ROLLEN


@dataclass(frozen=True)
class UniqueIndex:
    """One uniqueness rule. `rule` exists so a failed build says which rule broke, not which keys."""

    collection: str
    name: str
    keys: tuple[str, ...]
    rule: str
    # Which rows the rule reaches.
    partial_filter: Mapping[str, Any] | None = None


UNIQUE_INDEXES: Sequence[UniqueIndex] = (
    UniqueIndex(Collection.SAISON_TEAMS, "uniq_saison_id_team_id", ("saison_id", "team_id"), "one junction row per team per season"),
    UniqueIndex(Collection.SAISON_SPIELER, "uniq_spieler_id_saison_id", ("spieler_id", "saison_id"), "one junction row per player per season"),
    UniqueIndex(Collection.SPIELE, "uniq_saison_id_spiel_nr", ("saison_id", "spiel_nr"), "a spiel_nr identifies one match within a season"),
    UniqueIndex(Collection.TEAMS, "uniq_shorthand", ("shorthand",), "a shorthand identifies exactly one team"),
    # Retired rows included, as `uniq_shorthand` includes them, and refused at the CREATE because
    # nothing merges two of these: a second row under one name would be a state only a person could
    # undo, by renaming one.
    UniqueIndex(Collection.SPIELORTE, "uniq_spielort_name", ("name",), "a name identifies exactly one venue"),
    # Every row, as the venue index above takes every row: an erasure deletes the referee rather
    # than nulling them, so the one null name this can meet is the ghost's and there is only ever
    # one ghost (`app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`).
    UniqueIndex(Collection.SCHIEDSRICHTER, "uniq_schiedsrichter_name", ("name",), "a name identifies exactly one referee"),
    # The phase is a key, not a filter: positions restart at 1 in each phase, so a season legitimately
    # holds several matchdays numbered 1.
    UniqueIndex(
        Collection.SPIELTAGE,
        "uniq_saison_id_saison_phase_position",
        ("saison_id", "saison_phase", "position"),
        "one matchday per position within a phase of a season",
    ),
    # It is also the READ path: the sign-up check is one indexed equality against this key, so
    # dropping the index costs a collection scan per submission as well as the rule.
    UniqueIndex(Collection.SPERRLISTE, "uniq_sperrliste_adresse_hash", ("adresse_hash",), "one entry per banned address"),
    # `$type` rather than the equality `{"widerrufen_am": None}`, which also matches a row missing
    # the key: MongoDB's manual names `$type` among the operators a `partialFilterExpression`
    # supports and names no null form at all
    # (https://www.mongodb.com/docs/manual/core/index-partial/, which moves without us; read
    # 2026-09-21).
    UniqueIndex(
        Collection.EINLADUNGEN,
        "uniq_einladung_live",
        ("saison_id", "team_id"),
        "one live invite per team per season",
        partial_filter={"widerrufen_am": {"$type": "null"}},
    ),
    # `$type` for the reason above: a missing key indexes as null, so without the filter the second
    # keyless submission would collide with the first.
    UniqueIndex(
        Collection.BEWERBUNGEN,
        "uniq_bewerbung_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one application per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    UniqueIndex(
        Collection.REGISTRIERUNGEN,
        "uniq_registrierung_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one registration per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    # The same key after its registration was admitted, so a replay finds it here once the row above
    # is gone. Filtered for the reason above: a squad row an administrator wrote carries none.
    UniqueIndex(
        Collection.SAISON_SPIELER,
        "uniq_saison_spieler_idempotenz_schluessel",
        ("idempotenz_schluessel",),
        "one admitted registration per submission key",
        partial_filter={"idempotenz_schluessel": {"$type": "string"}},
    ),
    # One stored person per address, firing where two admissions for one new address race. Filtered
    # on `$type`, so persons holding no address are not one null key; an equality reader carries the
    # term or scans.
    UniqueIndex(
        Collection.SPIELER,
        "uniq_spieler_email",
        ("email",),
        "one person per address",
        partial_filter={"email": {"$type": "string"}},
    ),
    # Partial, because the league keeps every season it ever played: unfiltered, the second `past`
    # row would be refused. Checked at each write rather than at the commit, so a rollover demotes
    # before it promotes (`app/api/saisons/admin_router.py :: activate_saison`).
    UniqueIndex(Collection.SAISONS, "uniq_saison_active", ("status",), "at most one season is active", partial_filter={"status": "active"}),
    # Also the READ path of every admin-tier request (`app/api/berechtigungen/guard.py :: verify_actor_is_admin`),
    # and what refuses a second grant a Playground paste adds for an address already holding one.
    UniqueIndex(Collection.BERECHTIGUNGEN, "uniq_berechtigung_adresse", ("adresse",), "one grant per address"),
    # What makes a pass run twice mint once, and a second decline need a new stand rather than a
    # refusal. Both party ids are keys, the one a row lacks indexing as null. `$type` for
    # `uniq_einladung_live`'s reason.
    UniqueIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "uniq_spielbestaetigung_offen",
        ("spiel_id", "partei.art", "partei.team_id", "partei.schiedsrichter_id", "ansetzung.stand"),
        "one open confirmation per party per Ansetzung",
        partial_filter={"antwort": {"$type": "null"}, "geschlossen": {"$type": "null"}},
    ),
    # What makes two first writes of one fixture's report one document: the second insert meets this.
    UniqueIndex(Collection.SPIELBERICHTE, "uniq_spielbericht_spiel_id", ("spiel_id",), "one report per fixture"),
    # Two starts on one address meet here as a write conflict their transactions retry. The key's `$type` term keeps an
    # ending's null address out; a keyed read carries it too (`app/api/adresswechsel/services.py :: build_address_filter`),
    # or the planner scans.
    UniqueIndex(
        Collection.ADRESSWECHSEL,
        "uniq_adresswechsel_adresse",
        ("adresse",),
        "one live change per address",
        partial_filter={"beendet": {"$type": "null"}, "adresse": {"$type": "string"}},
    ),
    # Two requests about one address meet here. Unfiltered, a lapsed row too: the write asking anew removes that one first
    # (`app/api/berechtigungen/antraege.py :: clear_the_address_in_session`), the TTL monitor passing up to a minute late.
    UniqueIndex(Collection.BERECHTIGUNGEN_ANTRAEGE, "uniq_berechtigung_antrag_adresse", ("adresse",), "one request per address"),
    # Also the READ path of every enqueue, which finds a replay's row by it (`app/api/postausgang/services.py :: enqueue_mail`).
    UniqueIndex(Collection.POSTAUSGANG, "uniq_postausgang_schluessel", ("schluessel",), "one row per owed mail"),
)


@dataclass(frozen=True)
class SupportIndex:
    """One read this database would otherwise answer with a collection scan.

    Separate from `UniqueIndex` because dropping one of these costs speed, not correctness.
    """

    collection: str
    name: str
    keys: tuple[tuple[str, int], ...]
    rule: str
    # The collation of the reads it serves, which must be the index's own: a read under another one walks none of its
    # string keys.
    collation: Mapping[str, Any] | None = None


SUPPORT_INDEXES: Sequence[SupportIndex] = (
    # `_id` is in the key because the read SORTS by it: with `at` alone MongoDB cannot walk this
    # index and scans the whole log instead -- measured, and the log holds twelve months of writes
    # (`app/api/aktionen/admin_router.py :: get_aktionen`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_queue",
        (("at", DESCENDING), ("_id", DESCENDING)),
        "the log page reads newest first",
    ),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_trace_id",
        (("trace_id", ASCENDING),),
        "a write and its fan-out are read as one action",
    ),
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_target",
        (("collection", ASCENDING), ("document_id", ASCENDING)),
        "one document's history, and the rows a person's erasure must redact",
    ),
    # Every key `FACET_TALLY` groups on, in its `$sort`'s order: a group key missing here leaves that
    # sort blocking in memory, and where no other index serves the match, scanning the whole log,
    # images and all (`app/api/aktionen/admin_router.py :: FACET_TALLY`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_facets",
        (("collection", ASCENDING), ("operation", ASCENDING), ("actor.kind", ASCENDING)),
        "the counts the log page's three facets are told, over every recorded row",
    ),
    # `actor.pseudonym` leads: an erasure for a person's request matches on it alone, and the pupils' pass,
    # running for a whole season at once, on both (`app/api/identitaet/crud.py :: unattribute_in_session`,
    # `:: erase_pupil_actor_in_session`).
    SupportIndex(
        Collection.AKTIONEN,
        "aktionen_actor_pseudonym",
        (("actor.pseudonym", ASCENDING), ("actor.funktion", ASCENDING)),
        "the rows a person wrote, which their erasure marks inside its transaction",
    ),
    # Ending in the read's own sort order, `eingereicht_am` then `_id`: with the sort key unindexed
    # every request scans the collection and sorts it in memory, which is work proportional to an
    # archive an anonymous form can grow.
    SupportIndex(
        Collection.BEWERBUNGEN,
        "bewerbungen_saison_id_status_queue",
        (("saison_id", ASCENDING), ("status", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING)),
        "one season's queue narrowed to one status, which is what a triage tab reads",
    ),
    # Multikey, each array's every hash a key, so a lookup's equality on one finds its change. A tombstone keeps its
    # hashes, so each link answers how its change ended.
    SupportIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_token_hashes",
        (("token_hashes", ASCENDING),),
        "the address page's lookup, driven by strangers",
    ),
    SupportIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_stopp_token_hashes",
        (("stopp.token_hashes", ASCENDING),),
        "the address page's stop lookup, driven by strangers",
    ),
    # Not a unique one, though a hash collides with nothing: a revoked row keeps its hashes, so the
    # key holds as many rows as the team has been reissued links. Multikey, a row keeping the copied
    # link and every mailed one.
    SupportIndex(
        Collection.EINLADUNGEN,
        "einladungen_token_hashes",
        (("token_hashes", ASCENDING),),
        "the invite page's lookup, driven by strangers",
    ),
    # Multikey, the row keeping every link it was mailed.
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_bestaetigung_token_hashes",
        (("bestaetigung.token_hashes", ASCENDING),),
        "the confirmation page's lookup, driven by strangers",
    ),
    # One per clause of each `$or`, for the registration's pair's reason: a contact seat's link is
    # looked up on whichever seat holds it, on a season row or on an application.
    *(
        SupportIndex(
            Collection.SAISON_TEAMS,
            f"saison_teams_bestaetigungen_{seat}_token_hashes",
            ((f"bestaetigungen.{seat}.token_hashes", ASCENDING),),
            "a contact seat's confirmation page, through the season row's lookup, driven by strangers",
        )
        for seat in KONTAKT_ROLLEN
    ),
    # Multikey, each seat keeping every link it was mailed until a re-send voids them.
    *(
        SupportIndex(
            Collection.BEWERBUNGEN,
            f"bewerbungen_bestaetigungen_{seat}_token_hashes",
            ((f"bestaetigungen.{seat}.token_hashes", ASCENDING),),
            "a contact seat's confirmation page, through the application's lookup, driven by strangers",
        )
        for seat in KONTAKT_ROLLEN
    ),
    # `status` sits after the sort keys, the read being free to omit it: an index serves a sort
    # "only when the query includes equality conditions on all prefix keys that precede the sort
    # keys." Mirrored from
    # https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/; read 2026-09-21.
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_saison_id_team_id_queue",
        (("saison_id", ASCENDING), ("team_id", ASCENDING), ("eingereicht_am", DESCENDING), ("_id", DESCENDING), ("status", ASCENDING)),
        "one team's pending registrations for one season, newest first, narrowed by status or not",
    ),
    SupportIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "spielbestaetigungen_saison_id_spiel_id",
        (("saison_id", ASCENDING), ("spiel_id", ASCENDING)),
        "a season's or one fixture's confirmations, which the pass, the admin read and the verdict filter on",
    ),
    # One per clause of the token filter's `$or`, for the registration's pair's reason; each multikey,
    # a seat keeping every link it was mailed.
    *(
        SupportIndex(
            Collection.SPIELBESTAETIGUNGEN,
            f"spielbestaetigungen_kontakte_{seat}_token_hashes",
            ((f"kontakte.{seat}.token_hashes", ASCENDING),),
            "a fixture confirmation link's lookup, driven by strangers",
        )
        for seat in KONTAKT_ROLLEN
    ),
    # A collection with no retention bound, read inside every contact erasure's and Widerspruch's transaction.
    SupportIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "spielbestaetigungen_antwort_von_halter",
        (("antwort.von.halter", ASCENDING),),
        "the reasons a leaving contact typed, from whichever seat",
    ),
    # Read on every load of a referee's own panel, and inside every referee erasure's transaction, neither stating a
    # fixture the season-leading index could narrow by.
    SupportIndex(
        Collection.SPIELBESTAETIGUNGEN,
        "spielbestaetigungen_partei_schiedsrichter_id_saison_id",
        (("partei.schiedsrichter_id", ASCENDING), ("saison_id", ASCENDING)),
        "a referee's own rows, on their panel and at their erasure",
    ),
    SupportIndex(
        Collection.SPIELBERICHTE,
        "spielberichte_saison_id",
        (("saison_id", ASCENDING),),
        "a season's reports, which the triage's read and a replace's or an undraw's removal filter on",
    ),
    # For `spielbestaetigungen_antwort_von_halter`'s reason: the reports are kept with no retention bound.
    SupportIndex(
        Collection.SPIELBERICHTE,
        "spielberichte_eingereicht_von_schiedsrichter_id",
        (("bericht.eingereicht_von.schiedsrichter_id", ASCENDING),),
        "the reports a leaving referee sent, read inside their erasure's transaction",
    ),
    # Under the collation the two squad reads sort names by: the report reads it on every form and panel read and twice
    # on every write, the squad page on every read.
    SupportIndex(
        Collection.SAISON_SPIELER,
        "saison_spieler_saison_id_team_id_de",
        (("saison_id", ASCENDING), ("team_id", ASCENDING)),
        "one season's squad rows of one or two clubs, ordered by name",
        collation=GERMAN_COLLATION,
    ),
    # A person's records by the fold every address payload stores, one index per
    # clause of each `$or`, for the registration's pair's reason.
    *(
        SupportIndex(
            Collection.SAISON_TEAMS,
            f"saison_teams_kontakte_{seat}_email",
            ((f"kontakte.{seat}.email", ASCENDING),),
            "a person's seats, which the subject lookup reads on every signed-in page",
        )
        for seat in KONTAKT_ROLLEN
    ),
    *(
        SupportIndex(
            Collection.BEWERBUNGEN,
            f"bewerbungen_kontakte_{seat}_email",
            ((f"kontakte.{seat}.email", ASCENDING),),
            "a person's applications, which every sign-in attempt and account page read",
        )
        for seat in KONTAKT_ROLLEN
    ),
    # Compound, so the sign-in's `status` term is read off the index; the erasure's read of every status walks its prefix.
    SupportIndex(
        Collection.REGISTRIERUNGEN,
        "registrierungen_email_status",
        (("email", ASCENDING), ("status", ASCENDING)),
        "a person's registrations, which every sign-in attempt and account page read",
    ),
    SupportIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_email",
        (("email", ASCENDING),),
        "the changes naming an address as their new one, which every erasure and its preview read",
    ),
    # Equality on `stand` and the claim's own sort after it; the lease and the deadline are read off the open rows alone.
    SupportIndex(
        Collection.POSTAUSGANG,
        "postausgang_offen",
        (("stand", ASCENDING), ("erfasst_am", ASCENDING), ("_id", ASCENDING)),
        "the drain's claim of the open rows, oldest first",
    ),
    SupportIndex(
        Collection.POSTAUSGANG,
        "postausgang_bezug",
        (("bezug.sammlung", ASCENDING), ("bezug.id", ASCENDING), ("bezug.sitz", ASCENDING), ("erfasst_am", DESCENDING), ("_id", DESCENDING)),
        "the newest mail about one record and seat, which says whether its holder's mail arrives",
    ),
)


@dataclass(frozen=True)
class TTLIndex:
    """One collection's retention, applied by the database rather than by a sweep in this codebase.

    Separate from `SupportIndex` because dropping one of these costs retention, not speed and not
    correctness: every row stays, and nothing anywhere reports that it did.
    """

    collection: str
    name: str
    # ONE field, and a date one: MongoDB's manual documents a compound index as ignoring
    # `expireAfterSeconds` outright and a non-date value as never expiring, each in silence. Mirrored
    # from https://www.mongodb.com/docs/manual/core/index-ttl/, which moves without us; read 2026-09-04.
    key: str
    seconds: int
    rule: str


TTL_INDEXES: Sequence[TTLIndex] = (
    # Not `at`, though it names the same instant: it is a string, which this index would accept and
    # then expire nothing under, for as long as anyone left it there.
    TTLIndex(
        Collection.AKTIONEN,
        "aktionen_retention",
        "at_date",
        AKTION_RETENTION_SECONDS,
        "a log row is kept for twelve months after the write it recorded",
    ),
    # A live change never expires, holding no date at `beendet.am`: the hourly pass ends it, taking its address out of the
    # log images, which a TTL deletion never would.
    TTLIndex(
        Collection.ADRESSWECHSEL,
        "adresswechsel_beendet_am",
        "beendet.am",
        ADRESSWECHSEL_NACHLAUF_TAGE * 86400,
        "an ended address change is removed once its tombstone's retention has passed",
    ),
    # Zero: a lapsed request decides nothing, and every read already treats it as gone.
    TTLIndex(
        Collection.BERECHTIGUNGEN_ANTRAEGE,
        "berechtigungen_antraege_bis",
        "genehmigung.bis",
        0,
        "a request nobody decided is removed once the TTL monitor next passes after it lapsed",
    ),
    # Zero: `loeschen_am` is the date itself, a retention after the row's final state or a secret's own lapse.
    TTLIndex(Collection.POSTAUSGANG, "postausgang_loeschen_am", "loeschen_am", 0, "a mail's row is removed on its delete date"),
)


@dataclass(frozen=True)
class ConstraintSummary:
    # Counted apart because dropping each costs something different: correctness, speed or retention.
    unique_indexes: int
    support_indexes: int
    ttl_indexes: int


class _PartialFilterOption(TypedDict, total=False):
    """Typed rather than a plain `dict`, which pyright unpacks against `create_index`'s `session` parameter and refuses."""

    partialFilterExpression: Mapping[str, Any]


class _CollationOption(TypedDict, total=False):
    """Typed for `_PartialFilterOption`'s reason."""

    collation: Mapping[str, Any]


async def _apply_unique_index(db: AsyncDatabase, index: UniqueIndex) -> None:
    # Omitted rather than passed as `None` where a rule reaches every row: an omitted key and
    # `partialFilterExpression=None` are different options under one name, and `create_index` refuses
    # a name already held at different ones (`docs/ops/runbooks.md` §2).
    partial_option: _PartialFilterOption = {"partialFilterExpression": index.partial_filter} if index.partial_filter is not None else {}

    try:
        await db[index.collection].create_index([(key, ASCENDING) for key in index.keys], name=index.name, unique=True, **partial_option)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build unique index '{index.collection}.{index.name}' ({index.rule}): {failure}") from failure


async def _apply_support_index(db: AsyncDatabase, support: SupportIndex) -> None:
    # Omitted rather than passed as `None`, for `_apply_unique_index`'s reason.
    collation_option: _CollationOption = {"collation": support.collation} if support.collation is not None else {}

    try:
        await db[support.collection].create_index(list(support.keys), name=support.name, **collation_option)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build support index '{support.collection}.{support.name}' ({support.rule}): {failure}") from failure


async def _apply_ttl_index(db: AsyncDatabase, ttl: TTLIndex) -> None:
    try:
        await db[ttl.collection].create_index([(ttl.key, ASCENDING)], name=ttl.name, expireAfterSeconds=ttl.seconds)
    except OperationFailure as failure:
        raise RuntimeError(f"Could not build TTL index '{ttl.collection}.{ttl.name}' ({ttl.rule}): {failure}") from failure


# One declared operation, not yet started: a coroutine built for a lane that stops early would be
# left un-awaited, which is a warning rather than an error and so goes unseen.
_Runner = Callable[[], Awaitable[None]]


async def _run_lane(lane: Sequence[tuple[int, _Runner]]) -> tuple[int, Exception] | None:
    """Run one namespace's operations in order, stopping at the first that fails.

    The failure is RETURNED, not raised: raising it would hand the caller whichever lane lost the
    race, and the caller owes a promise about which failure that is.
    """
    for position, run in lane:
        try:
            await run()
        # `Exception` and not `BaseException`: a cancellation escapes the lane, short-circuits `gather` and
        # reaches the caller whatever its declared position. Ranking it would make a stopped boot wait for
        # every slower lane first.
        except Exception as failure:
            return position, failure

    return None


async def _apply_concurrently(declared: Sequence[tuple[str, _Runner]]) -> None:
    """Apply `declared` concurrently and raise the `Exception` DECLARED first, not the one that arrived.

    One lane per namespace: MongoDB documents `create` as locking the collection it names, and
    documents nothing about two index builds racing on one.
    """
    lanes: dict[str, list[tuple[int, _Runner]]] = {}
    # Numbered BEFORE the split, so a rank is the DECLARED position and not the position within a lane:
    # a later-declared operation opening its own lane would rank 0 there, and per-lane numbering would
    # report it over an earlier one standing second in its lane, as `aktionen_trace_id` does.
    for position, (namespace, run) in enumerate(declared):
        lanes.setdefault(namespace, []).append((position, run))

    # Nothing short-circuits: `_run_lane` returns its failure rather than raising, so every other
    # lane runs on to completion and a failed apply leaves MORE applied than a sequential one
    # would. Safe because each operation here is idempotent.
    outcomes = await asyncio.gather(*(_run_lane(lane) for lane in lanes.values()))
    failures = [outcome for outcome in outcomes if outcome is not None]

    if failures:
        raise min(failures, key=lambda failure: failure[0])[1]


async def apply_constraints(db: AsyncDatabase) -> ConstraintSummary:
    """Apply every index to `db`.

    An index is only ever ADDED: narrowing a rule to a `partial_filter` means dropping the live index
    by hand first (`docs/ops/runbooks.md` §2). Raises the `Exception` declared first.
    """
    await _apply_concurrently(
        [
            *((index.collection, partial(_apply_unique_index, db, index)) for index in UNIQUE_INDEXES),
            *((support.collection, partial(_apply_support_index, db, support)) for support in SUPPORT_INDEXES),
            *((ttl.collection, partial(_apply_ttl_index, db, ttl)) for ttl in TTL_INDEXES),
        ]
    )

    return ConstraintSummary(
        unique_indexes=len(UNIQUE_INDEXES),
        support_indexes=len(SUPPORT_INDEXES),
        ttl_indexes=len(TTL_INDEXES),
    )
