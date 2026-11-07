"""API · the binders every person's router declares"""

from collections.abc import AsyncIterator, Callable, Mapping
from typing import Annotated, Final, get_args

from fastapi import Depends

from app.core.config import BackendConfig, get_app_config
from app.core.recording import ActorRole, PersonActor
from app.core.security import Attribution, SessionActor, actor_binder, actor_pseudonym, verify_person_actor
from app.shared.folding import sign_in_identifier


def person_actor_binder(role: ActorRole) -> Callable[..., AsyncIterator[str]]:
    """The binder a person's router declares, fixing the Funktion its writes are recorded under and yielding the folded identifier.

    The Funktion is never read off the request: the handler re-derives that the person holds it before
    writing, so the record names what was checked.
    """

    def the_person(
        actor: Annotated[SessionActor, Depends(verify_person_actor)],
        config: Annotated[BackendConfig, Depends(get_app_config)],
    ) -> Attribution[str]:
        # What the handler authorises against, so one mailbox's two spellings cannot hold two answers.
        identifier = sign_in_identifier(actor.email)
        pseudonym = actor_pseudonym(identifier, key=config.sperrliste_key)

        return Attribution(PersonActor(pseudonym=pseudonym, role=role), identifier)

    return actor_binder(the_person)


PERSON_ACTOR_BINDERS: Final[Mapping[ActorRole, Callable[..., AsyncIterator[str]]]] = {
    role: person_actor_binder(role) for role in get_args(ActorRole)
}

# A handler's folded address, from the binder its router declares, which FastAPI then runs once a
# request; another Funktion's alias runs a second binder, recording the writes under that Funktion.
KontaktIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["kontakt"])]
SpielerIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["spieler"])]
SchiedsrichterIdentifier = Annotated[str, Depends(PERSON_ACTOR_BINDERS["schiedsrichter"])]
