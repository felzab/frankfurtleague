"""
CORE · the action log's write side

One act, one row, written by the act's own route inside the act's own transaction: `record_act` is the module's one
writer of the log, and nothing here reads it (`app/api/action_log/` serves it). A row names who acted and what they did,
never a person's name or any address but an administrator's and a grantee's, so nothing touches a row after the fact
but `app/api/action_log/crud.py :: reattribute_administrator_in_session`.
"""

from contextvars import ContextVar
from typing import Final, Literal

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection

from app.core import clock
from app.core.collections import Collection
from app.core.crud import post_one_to_db
from app.core.logging import trace_id_var

# Stands where an erased person's address stood in a record or a log row: fixed, so it singles nobody out. No `@`, so
# no address equals it.
ERASED_ACTOR_MARKER = "ERASED"

# The folded address of the administrator this request acts for, set by `app/core/security.py :: bind_actor`, which
# every admin router depends on. `None` everywhere else, so a route binding no administrator cannot record as one.
actor_var: ContextVar[str | None] = ContextVar("actor", default=None)


# Every act the Protokoll holds, category.operation. Closed and published, so an act with no German word fails
# `tsc`. A `retention.*` member names what its pass took, so that noun is a word of the catalogue too.
type FLAction = Literal[
    "saison.created",
    "saison.changed",
    "saison.activated",
    "saison.gruppen_swapped",
    "saison.spielplan_created",
    "saison.spielplan_recreated",
    "saison.spielplan_deleted",
    "saison.invitations_dispatched",
    "spieltag.changed",
    "spiel.changed",
    "spiel.ergebnis_changed",
    "spielbestaetigung.entered",
    "spielbestaetigung.vorschlag_discarded",
    "spielbestaetigung.vorschlag_adopted",
    "spielbestaetigung.answered",
    "spielbericht.saved",
    "aufstellung.saved",
    "team.entered",
    "team.changed",
    "team.retired",
    "team.reactivated",
    "team.austritt_entered",
    "team.seat_changed",
    "team.replaced",
    "team.invitation_created",
    "team.invitation_withdrawn",
    "bewerbung.accepted",
    "bewerbung.declined",
    "bewerbung.seat_changed",
    "registrierung.admitted",
    "registrierung.declined",
    "spieler.changed",
    "spieler.deregistered",
    "spieler.reactivated",
    "schiedsrichter.created",
    "schiedsrichter.changed",
    "schiedsrichter.retired",
    "schiedsrichter.reactivated",
    "spielort.created",
    "spielort.changed",
    "spielort.retired",
    "spielort.reactivated",
    "grant.added",
    "grant.removed",
    "grant.addition_withdrawn",
    "grant.handover_started",
    "grant.handover_withdrawn",
    "grant.handover_completed",
    "grant.address_change_started",
    "grant.address_switched",
    "ban.added",
    "ban.removed",
    "address_change.started",
    "address_change.discarded",
    "erasure.on_request",
    "erasure.own",
    "retention.bewerbungen",
    "retention.kontakte",
    "retention.spielbestaetigungen",
    "retention.spielberichte",
    "retention.registrierungen",
    "retention.schiedsrichter",
    "retention.spieler",
    "retention.address_changes",
    "retention.bans",
]

# The `category` of `FLAction`, the Protokoll's type filter.
type FLActionType = Literal[
    "saison",
    "spieltag",
    "spiel",
    "spielbestaetigung",
    "spielbericht",
    "aufstellung",
    "team",
    "bewerbung",
    "registrierung",
    "spieler",
    "schiedsrichter",
    "spielort",
    "grant",
    "ban",
    "address_change",
    "erasure",
    "retention",
]

# Who a row names where no administrator acted, none of them anybody's name or address.
ACT_BY_KONTAKT: Final = "kontakt"
ACT_BY_SCHIEDSRICHTER: Final = "schiedsrichter"
ACT_BY_SYSTEM: Final = "system"
ACT_BY_PERSON: Final = "person"


async def record_act(
    *,
    collection: AsyncCollection,
    action: FLAction,
    # An administrator's route leaves this out and is recorded under the address its request bound. Every other caller
    # states it, one of the four above or, on a holder's own change, the holder's folded address: a route binding no
    # administrator and naming nobody here raises inside its transaction rather than recording the wrong who.
    by: str | None = None,
    # The team's name at the act, beside `by=ACT_BY_KONTAKT`, so a search needs no join.
    team: str | None = None,
    record_id: ObjectId | None = None,
    # League data. A grant act's holds the grantee's folded address, an erasure's its typed reference.
    label: str | None = None,
    # How many records a page of a pass took.
    count: int | None = None,
    # REQUIRED: the act's own transaction, so a failed act leaves no row and a retried one leaves one.
    session: AsyncClientSession,
) -> None:
    """Append the one row of an act, inside its transaction."""

    # The target's own database handle, not an injected one, so an act needs no dependency of its own.
    await post_one_to_db(
        collection=collection.database[Collection.ACTION_LOG],
        document={
            # A BSON date, the key a TTL index expires on (`app/core/constraints.py :: TTL_INDEXES`).
            "at": clock.now(),
            "by": by if by is not None else _bound_administrator(),
            "team": team,
            "action": action,
            "record_id": record_id,
            "label": label,
            "count": count,
            # The one join to the edge line when an account is misused: stored, never served.
            "trace_id": trace_id_var.get(),
        },
        session=session,
    )


def _bound_administrator() -> str:
    address = actor_var.get()
    if address is None:
        raise LookupError("an act on a route binding no administrator states who acted")

    return address
