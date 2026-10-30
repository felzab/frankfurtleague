"""
API · the ban check and the binders every person's router declares

Here beside the ban list they read, so `app/core/security.py`, which verifies the session they
judge, depends on no slice.
"""

from collections.abc import AsyncIterator, Callable, Mapping
from http import HTTPStatus
from typing import Annotated, Final, get_args

from fastapi import Depends

from app.api.sperrliste.lookup import SperrlisteLookup, adressen_gesperrt
from app.core.codes import Code
from app.core.config import BackendConfig, get_app_config
from app.core.exceptions import APIError
from app.core.recording import AktorFunktion, PersonActor
from app.core.security import Attribution, SessionActor, actor_binder, akteur_pseudonym, verify_person_actor
from app.shared.folding import sign_in_identifier


async def verify_person_is_unbarred(
    # First, so a request naming nobody is refused before the ban read opens the database.
    actor: Annotated[SessionActor, Depends(verify_person_actor)],
    sperrliste: SperrlisteLookup,
) -> SessionActor:
    """Refuse a person the ban list holds, read per request: the frontend's guard misses a ban entered since."""

    # Keyed as the grant check keys its own ban read.
    if await adressen_gesperrt(sperrliste, [sign_in_identifier(actor.email)]):
        raise APIError(HTTPStatus.FORBIDDEN, Code.PERSON_BARRED)

    return actor


def person_actor_binder(funktion: AktorFunktion) -> Callable[..., AsyncIterator[str]]:
    """The binder a person's router declares, fixing the Funktion its writes are recorded under and yielding the folded identifier.

    The Funktion is never read off the request: the handler re-derives that the person holds it before
    writing, so the record names what was checked.
    """

    def the_person(
        # The ban check rides the binder, so a router declaring it cannot serve a barred person.
        actor: Annotated[SessionActor, Depends(verify_person_is_unbarred)],
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> Attribution[str]:
        # What the handler authorises against, so one mailbox's two spellings cannot hold two answers.
        identifier = sign_in_identifier(actor.email)
        pseudonym = akteur_pseudonym(identifier, schluessel=config.sperrliste_schluessel)

        return Attribution(PersonActor(pseudonym=pseudonym, funktion=funktion), identifier)

    return actor_binder(the_person)


PERSON_ACTOR_BINDERS: Final[Mapping[AktorFunktion, Callable[..., AsyncIterator[str]]]] = {
    funktion: person_actor_binder(funktion) for funktion in get_args(AktorFunktion)
}

# A handler's folded address, from the binder its router declares, which FastAPI then runs once a
# request; another Funktion's alias runs a second binder, recording the writes under that Funktion.
KontaktIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]
SpielerIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["spieler"])]
SchiedsrichterIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])]
