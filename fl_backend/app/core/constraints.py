from collections.abc import Sequence

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure

from app.core.collections import Collection
from app.core.crud import GERMAN_COLLATION
from app.shared.schemas.bounds import ACTION_LOG_ENTRY_RETENTION_SECONDS, ADDRESS_CHANGE_RETENTION_DAYS, MAILBOX_ANCHOR_RETENTION_SECONDS
from app.shared.schemas.literals import KONTAKT_SEATS

# Each index by its name, which the boot's refusal names and a `dropIndex` line takes, so a name never changes: the boot
# only adds, and a renamed index would stand in production beside the old one. An option a rule does not need is left
# out rather than passed as `None`, since the server refuses a name already held at different options.

# One document per key. Dropping one of these costs correctness: only the database sees two writes racing for a key.
UNIQUE_INDEXES: Sequence[tuple[Collection, IndexModel]] = (
    # One junction row per team per season.
    (Collection.SAISON_TEAMS, IndexModel(["saison_id", "team_id"], name="uniq_saison_id_team_id", unique=True)),
    # One junction row per player per season.
    (Collection.SAISON_SPIELER, IndexModel(["spieler_id", "saison_id"], name="uniq_spieler_id_saison_id", unique=True)),
    # A `spiel_nr` identifies one match within a season.
    (Collection.SPIELE, IndexModel(["saison_id", "spiel_nr"], name="uniq_saison_id_spiel_nr", unique=True)),
    # A shorthand identifies exactly one team.
    (Collection.TEAMS, IndexModel(["shorthand"], name="uniq_shorthand", unique=True)),
    # A name identifies exactly one venue. Retired rows included, as `uniq_shorthand` includes them, and refused at the
    # create because nothing merges two of these: a second row under one name would be a state only a person could
    # undo, by renaming one.
    (Collection.SPIELORTE, IndexModel(["name"], name="uniq_spielort_name", unique=True)),
    # A name identifies exactly one referee. Every row, as the venue index above takes every row: an erasure deletes the
    # referee rather than nulling the name, so the index meets no null.
    (Collection.SCHIEDSRICHTER, IndexModel(["name"], name="uniq_schiedsrichter_name", unique=True)),
    # One matchday per position within a phase of a season. The phase is a key, not a filter: positions restart at 1 in
    # each phase, so a season legitimately holds several matchdays numbered 1.
    (
        Collection.SPIELTAGE,
        IndexModel(["saison_id", "saison_phase", "position"], name="uniq_saison_id_saison_phase_position", unique=True),
    ),
    # One entry per banned address. It is also the READ path: the sign-in and the Postausgang's hand-out each ask by
    # this key, so dropping the index costs a collection scan per read as well as the rule.
    (Collection.BAN_LIST, IndexModel(["address"], name="uniq_ban_list_address", unique=True)),
    # One live invite per team per season. `$type` rather than the equality `{"revoked_at": None}`, which also matches a
    # row missing the key: MongoDB's manual names `$type` among the operators a `partialFilterExpression` supports and
    # names no null form at all (https://www.mongodb.com/docs/manual/core/index-partial/).
    (
        Collection.INVITATIONS,
        IndexModel(
            ["saison_id", "team_id"], name="uniq_invitation_live", unique=True, partialFilterExpression={"revoked_at": {"$type": "null"}}
        ),
    ),
    # One application per submission key. `$type`, as above: a missing key indexes as null, so without the filter the
    # second keyless submission would collide with the first.
    (
        Collection.BEWERBUNGEN,
        IndexModel(
            ["idempotency_key"],
            name="uniq_bewerbung_idempotency_key",
            unique=True,
            partialFilterExpression={"idempotency_key": {"$type": "string"}},
        ),
    ),
    # One registration per submission key, filtered as the application's is.
    (
        Collection.REGISTRIERUNGEN,
        IndexModel(
            ["idempotency_key"],
            name="uniq_registrierung_idempotency_key",
            unique=True,
            partialFilterExpression={"idempotency_key": {"$type": "string"}},
        ),
    ),
    # One stored person per address, firing where two admissions for one new address race. Filtered on `$type`, so
    # persons holding no address are not one null key; an equality reader carries the term or scans.
    (
        Collection.SPIELER,
        IndexModel(["email"], name="uniq_spieler_email", unique=True, partialFilterExpression={"email": {"$type": "string"}}),
    ),
    # At most one season is active. Partial, because the league keeps every season it ever played: unfiltered, the
    # second `past` row would be refused. Checked at each write rather than at the commit, so a rollover demotes before
    # it promotes.
    (Collection.SAISONS, IndexModel(["status"], name="uniq_saison_active", unique=True, partialFilterExpression={"status": "active"})),
    # One grant per address. Also the READ path of every admin-tier request, and what refuses a second grant a hand-run
    # `mongosh` file adds for an address already holding one.
    (Collection.GRANTS, IndexModel(["address"], name="uniq_grant_address", unique=True)),
    # At most one owner. Checked at each write rather than at the commit, so a handover demotes before it promotes.
    (Collection.GRANTS, IndexModel(["admin_tier"], name="uniq_grant_owner", unique=True, partialFilterExpression={"admin_tier": "owner"})),
    # One open confirmation per party per Ansetzung: what makes a pass run twice mint once, and a second decline need a
    # new digest rather than a refusal. Both party ids are keys, the one a row lacks indexing as null. `$type`, as a
    # partial filter takes no equality on null.
    (
        Collection.SPIELBESTAETIGUNGEN,
        IndexModel(
            ["spiel_id", "party.kind", "party.team_id", "party.schiedsrichter_id", "ansetzung.digest"],
            name="uniq_spielbestaetigung_open",
            unique=True,
            partialFilterExpression={"answer": {"$type": "null"}, "closed": {"$type": "null"}},
        ),
    ),
    # One report per fixture: what makes two first writes of one fixture's report one document, the second insert
    # meeting this.
    (Collection.SPIELBERICHTE, IndexModel(["spiel_id"], name="uniq_spielbericht_spiel_id", unique=True)),
    # One line-up per club per fixture, the same for two seats of one club saving its first line-up at once, and the key
    # every read of a fixture's line-ups joins on. The club and never the side: a side re-fielded by a knockout
    # correction keeps no other club's.
    (Collection.AUFSTELLUNGEN, IndexModel(["spiel_id", "team_id"], name="uniq_aufstellung_spiel_id_team_id", unique=True)),
    # One live change per address: two starts on one address meet here as a write conflict their transactions retry.
    # The key's `$type` term keeps an ending's null address out; a keyed read carries it too, or the planner scans.
    (
        Collection.ADDRESS_CHANGES,
        IndexModel(
            ["address"],
            name="uniq_address_change_address",
            unique=True,
            partialFilterExpression={"ended": {"$type": "null"}, "address": {"$type": "string"}},
        ),
    ),
    # One row per owed mail. Also the READ path of every enqueue, which finds a replay's row by it.
    (Collection.OUTBOX, IndexModel(["key"], name="uniq_outbox_key", unique=True)),
)


# One read each, which this database would otherwise answer with a collection scan. Dropping one costs speed, not
# correctness. A collation is the one its reads use, since a read under another walks none of the index's string keys;
# a partial filter is stated whole by its reads, or the planner may not take the index.
SUPPORT_INDEXES: Sequence[tuple[Collection, IndexModel]] = (
    # A season's applications in one status: the season overview's undecided ones, oldest first, walk the sort keys in
    # order, and the duplicate check and the season's passes read the season and the status off the index. The list of
    # a season's applications states the season alone, so `status` stands before its sort keys and it sorts the season's
    # rows in memory, work bounded by one season rather than by the archive an anonymous form can grow.
    (
        Collection.BEWERBUNGEN,
        IndexModel(
            [("saison_id", ASCENDING), ("status", ASCENDING), ("submitted_at", DESCENDING), ("_id", DESCENDING)],
            name="bewerbungen_saison_id_status_queue",
        ),
    ),
    # The address page's lookup, driven by strangers. Multikey, each array's every hash a key, so a lookup's equality on
    # one finds its change. A tombstone keeps its hashes, so each link answers how its change ended.
    (Collection.ADDRESS_CHANGES, IndexModel([("token_hashes", ASCENDING)], name="address_change_token_hashes")),
    # The address page's stop lookup, driven by strangers.
    (Collection.ADDRESS_CHANGES, IndexModel([("stop.token_hashes", ASCENDING)], name="address_change_stop_token_hashes")),
    # The invite page's lookup, driven by strangers. Not a unique one, though a hash collides with nothing: a revoked row
    # keeps its hashes, so the key holds as many rows as the team has been reissued links. Multikey, a row keeping the
    # copied link and every mailed one.
    (Collection.INVITATIONS, IndexModel([("token_hashes", ASCENDING)], name="invitations_token_hashes")),
    # The confirmation page's lookup, driven by strangers. Multikey, the row keeping every link it was mailed.
    (Collection.REGISTRIERUNGEN, IndexModel([("confirmation.token_hashes", ASCENDING)], name="registrierungen_confirmation_token_hashes")),
    # A contact seat's confirmation page, through the application's lookup, driven by strangers. One per clause of the
    # lookup's `$or`, each multikey: every open of a contact's link reads this collection by the hash, and anybody can
    # grow it through the public application form.
    *(
        (
            Collection.BEWERBUNGEN,
            IndexModel([(f"confirmations.{seat}.token_hashes", ASCENDING)], name=f"bewerbungen_confirmations_{seat}_token_hashes"),
        )
        for seat in KONTAKT_SEATS
    ),
    # One team's pending registrations for one season, newest first, narrowed by status or not. `status` sits after the
    # sort keys, the read being free to omit it: an index serves a sort "only when the query includes equality
    # conditions on all prefix keys that precede the sort keys."
    # (https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
    (
        Collection.REGISTRIERUNGEN,
        IndexModel(
            [("saison_id", ASCENDING), ("team_id", ASCENDING), ("submitted_at", DESCENDING), ("_id", DESCENDING), ("status", ASCENDING)],
            name="registrierungen_saison_id_team_id_queue",
        ),
    ),
    # One team's pending registrations a pupil confirmed, newest first: the confirmed rows alone, which the team's
    # pending read takes first. On the queue index above it would fetch every unconfirmed row standing newer, and anybody
    # holding the team's link writes one with every press. "To use the partial index, a query must contain the filter
    # expression" (https://www.mongodb.com/docs/manual/core/index-partial/), so the read states this filter whole.
    (
        Collection.REGISTRIERUNGEN,
        IndexModel(
            [("saison_id", ASCENDING), ("team_id", ASCENDING), ("submitted_at", DESCENDING), ("_id", DESCENDING)],
            name="registrierungen_saison_id_team_id_confirmed_queue",
            partialFilterExpression={"status": "submitted", "einwilligung.confirmed_at": {"$type": "string"}},
        ),
    ),
    # A season's or one fixture's confirmations, which the pass, the admin read and the verdict filter on.
    (
        Collection.SPIELBESTAETIGUNGEN,
        IndexModel([("saison_id", ASCENDING), ("spiel_id", ASCENDING)], name="spielbestaetigungen_saison_id_spiel_id"),
    ),
    # A referee's rows at their erasure, read inside its transaction, which states neither a season nor a fixture the
    # season-leading index could narrow by. A referee's panel joins their rows on the season and the fixture, the keys of
    # the index above.
    (
        Collection.SPIELBESTAETIGUNGEN,
        IndexModel(
            [("party.schiedsrichter_id", ASCENDING), ("saison_id", ASCENDING)], name="spielbestaetigungen_party_schiedsrichter_id_saison_id"
        ),
    ),
    # A referee's own fixtures, on their pages and at their erasure. Read on every render of a referee's pages, and by
    # the referee's erasure and retirement, none stating a fixture the season-leading index could narrow by; the season
    # second, for the list of one season's fixtures.
    (
        Collection.SPIELE,
        IndexModel(
            [("schiedsrichter.schiedsrichter_id", ASCENDING), ("saison_id", ASCENDING)],
            name="spiele_schiedsrichter_schiedsrichter_id_saison_id",
        ),
    ),
    # A season's reports, which the season overview and the season editor's count read, and a replace's or an undraw's
    # removal filters on.
    (Collection.SPIELBERICHTE, IndexModel([("saison_id", ASCENDING)], name="spielberichte_saison_id")),
    # The reports naming a leaving pupil, read inside their erasure's transaction. The reports are kept with no
    # retention bound, and the pupil's erasure names no season the season-leading index could narrow by: one per clause
    # of its `$or`, which uses indexes only when every clause has one; each multikey.
    *(
        (
            Collection.SPIELBERICHTE,
            IndexModel([(f"bericht.{entries}.spieler_id", ASCENDING)], name=f"spielberichte_bericht_{entries}_spieler_id"),
        )
        for entries in ("scorers", "cards")
    ),
    # The line-ups naming a pupil, read inside their erasure's transaction. Multikey: the line-ups are kept with no
    # retention bound, as the reports are.
    (Collection.AUFSTELLUNGEN, IndexModel([("spieler.spieler_id", ASCENDING)], name="aufstellungen_spieler_spieler_id")),
    # A season's line-ups, which a replace's or an undraw's removal filters on, and one club's among them.
    (Collection.AUFSTELLUNGEN, IndexModel([("saison_id", ASCENDING), ("team_id", ASCENDING)], name="aufstellungen_saison_id_team_id")),
    # One season's squad rows of one or two clubs, ordered by name, under the collation the two squad reads sort names
    # by: the report reads it on every form and panel read and twice on every write, the squad page on every read.
    (
        Collection.SAISON_SPIELER,
        IndexModel([("saison_id", ASCENDING), ("team_id", ASCENDING)], name="saison_spieler_saison_id_team_id_de", collation=GERMAN_COLLATION),
    ),
    # A person's seats, which the subject lookup reads on every signed-in page, by the fold every address payload
    # stores: one index per clause of each `$or`, which uses indexes only when every clause has one.
    *(
        (Collection.SAISON_TEAMS, IndexModel([(f"kontakte.{seat}.email", ASCENDING)], name=f"saison_teams_kontakte_{seat}_email"))
        for seat in KONTAKT_SEATS
    ),
    # A person's applications, which every sign-in attempt and account page read, one per clause as above.
    *(
        (Collection.BEWERBUNGEN, IndexModel([(f"kontakte.{seat}.email", ASCENDING)], name=f"bewerbungen_kontakte_{seat}_email"))
        for seat in KONTAKT_SEATS
    ),
    # A person's registrations, which every sign-in attempt and account page read. Compound, so the sign-in's `status`
    # term is read off the index; the erasure's read of every status walks its prefix.
    (Collection.REGISTRIERUNGEN, IndexModel([("email", ASCENDING), ("status", ASCENDING)], name="registrierungen_email_status")),
    # The changes naming an address as their new one, which every erasure and its preview read.
    (Collection.ADDRESS_CHANGES, IndexModel([("email", ASCENDING)], name="address_change_email")),
    # The drain's claim of the open rows, oldest first: equality on `state` and the claim's own sort after it; the lease
    # and the deadline are read off the open rows alone.
    (Collection.OUTBOX, IndexModel([("state", ASCENDING), ("recorded_at", ASCENDING), ("_id", ASCENDING)], name="outbox_open")),
    # The newest mail about one record and seat, which says whether its holder's mail arrives.
    (
        Collection.OUTBOX,
        IndexModel(
            [
                ("reference.collection", ASCENDING),
                ("reference.id", ASCENDING),
                ("reference.seat", ASCENDING),
                ("recorded_at", DESCENDING),
                ("_id", DESCENDING),
            ],
            name="outbox_reference",
        ),
    ),
)


# One collection's retention, applied by the database rather than by a sweep in this codebase. Dropping one costs
# retention, not speed and not correctness: every row stays, and nothing anywhere reports that it did. Each is keyed on
# ONE field, and a date one: MongoDB's manual documents a compound index as ignoring `expireAfterSeconds` outright and
# a non-date value as never expiring, each in silence (https://www.mongodb.com/docs/manual/core/index-ttl/).
TTL_INDEXES: Sequence[tuple[Collection, IndexModel]] = (
    # A log row is kept for twelve months after the act it recorded.
    (
        Collection.ACTION_LOG,
        IndexModel([("at", ASCENDING)], name="action_log_retention", expireAfterSeconds=ACTION_LOG_ENTRY_RETENTION_SECONDS),
    ),
    # An ended address change is removed once its tombstone's retention has passed. A live change never expires, holding
    # no date at `ended.at`: the hourly pass ends it.
    (
        Collection.ADDRESS_CHANGES,
        IndexModel([("ended.at", ASCENDING)], name="address_change_ended_at", expireAfterSeconds=ADDRESS_CHANGE_RETENTION_DAYS * 86400),
    ),
    # A mail's row is removed on its delete date. Zero: `erase_at` is the date itself, a retention after the row's final
    # state or a secret's own lapse.
    (Collection.OUTBOX, IndexModel([("erase_at", ASCENDING)], name="outbox_erase_at", expireAfterSeconds=0)),
    # A mailbox's document is removed once no press has named it for that long.
    (
        Collection.MAILBOX_ANCHORS,
        IndexModel([("anchored_at", ASCENDING)], name="mailbox_anchors_anchored_at", expireAfterSeconds=MAILBOX_ANCHOR_RETENTION_SECONDS),
    ),
)


async def apply_constraints(db: AsyncDatabase) -> int:
    """Build every declared index on `db` and return how many are declared.

    An index is only ever ADDED: narrowing a rule to a partial filter means dropping the live index by hand first.
    Raises `RuntimeError` naming the first index the server refused.
    """

    declared = (*UNIQUE_INDEXES, *SUPPORT_INDEXES, *TTL_INDEXES)
    # One command per index rather than one per collection: a command building several fails as one, and the server's
    # message would then be all that says which index broke.
    for collection, index in declared:
        try:
            await db[collection].create_indexes([index])
        except OperationFailure as failure:
            # The server's code and never its message, which for a duplicate quotes the duplicated value. `from None`,
            # since the traceback uvicorn logs for a failed start would otherwise print that message as the cause.
            raise RuntimeError(f"Could not build index '{collection}.{index.document['name']}': server code {failure.code}") from None

    return len(declared)
