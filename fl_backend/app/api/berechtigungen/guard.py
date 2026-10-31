"""
API · the actor check every admin-tier router declares

Here beside the grants it reads, so `app/core/security.py`, which verifies the session it judges,
depends on no slice.
"""

from http import HTTPStatus
from typing import Annotated

from fastapi import Depends

from app.api.berechtigungen.crud import live_unbarred_grant_since
from app.api.sperrliste.lookup import SperrlisteLookup
from app.core.codes import Code
from app.core.dependencies import GrantsCollection
from app.core.exceptions import APIError
from app.core.security import SessionActor, refused_session, signed_in_since, verify_admin_actor
from app.shared.folding import sign_in_identifier


async def verify_actor_is_admin(
    # First, so a request naming nobody is refused before the grant read opens the database.
    actor: Annotated[SessionActor, Depends(verify_admin_actor)],
    berechtigungen_collection: GrantsCollection,
    sperrliste: SperrlisteLookup,
) -> None:
    """Refuse an actor who holds no live grant or whose address is banned, read per request, or one who signed in before the grant."""

    # Folded, as every grant is stored, or a mixed-case identifier locks an administrator out of the
    # panel. Either tier admits: `owner` holds every power `administration` does.
    seit = await live_unbarred_grant_since(
        sign_in_identifier(actor.email), berechtigungen_collection=berechtigungen_collection, sperrliste=sperrliste
    )
    if seit is None:
        raise APIError(HTTPStatus.FORBIDDEN, Code.ACTOR_NOT_ADMIN)

    if not signed_in_since(actor.auth_time, seit):
        raise refused_session()
