"""Here beside the grants it reads, so the core's session check depends on no slice."""

from http import HTTPStatus
from typing import Annotated, Final

from fastapi import Depends

from app.api.grants.crud import read_admin_tier_of
from app.core.codes import Code
from app.core.dependencies import GermanyNow, GrantsReadCollection, SnapshotSession
from app.core.exceptions import APIError
from app.core.security import SessionActor, bind_actor, refused_session, signed_in_since, verify_access_admin, verify_admin_actor
from app.shared.folding import sign_in_identifier


async def verify_actor_is_admin(
    # First, so a request naming nobody is refused before the grant read opens the database.
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    grants_collection: GrantsReadCollection,
    session: SnapshotSession,
    now: GermanyNow,
) -> None:
    """Refuse an actor who holds no grant in effect, read per request, or one who signed in before its date."""

    # Folded, as every grant is stored, or a mixed-case identifier locks an administrator out of the
    # panel. Either tier admits: `owner` holds every power `administration` does.
    grant = await read_admin_tier_of(grants_collection=grants_collection, address=sign_in_identifier(actor.email), now=now, session=session)
    if grant is None:
        raise APIError(HTTPStatus.FORBIDDEN, Code.ACTOR_NOT_ADMIN)

    if not signed_in_since(actor.auth_time, grant[1]):
        raise refused_session()


# An administrator's router's guards, in the order they run: the key, then the grant, then the actor bound for the
# request's writes. A tuple, as the other tiers' are.
ADMIN_TIER: Final = (Depends(verify_access_admin), Depends(verify_actor_is_admin), Depends(bind_actor))
