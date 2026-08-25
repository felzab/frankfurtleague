from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from app.api.spiele.schemas import FLPatchSpielDataPayload, FLSpielOrtFieldPayload, FLSpielSchiedsrichterFieldPayload

# The two blocks whose STORED shape is wider than the one a payload takes: each carries the composed
# name the server owns, beside the id and the figure this fixture agreed.
NESTED_PAYLOAD_BLOCKS: Mapping[str, type[BaseModel]] = {
    "ort": FLSpielOrtFieldPayload,
    "schiedsrichter": FLSpielSchiedsrichterFieldPayload,
}


def spiel_patch_body(stored: Mapping[str, Any], **overrides: Any) -> dict[str, Any]:
    """`stored` as the editor would submit it, plus `overrides` — so a case overriding nothing is the no-op save.

    Handing the DOCUMENT to the payload instead would test a request nobody makes: the admin draft
    carries each block's display copies for the pickers, and
    `fl_frontend/src/features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema` strips them before
    the body is built. Keyed off the payload's own field set, which is also what drops `spiel_id`.
    Indexing rather than `.get` inside a block, so a stored one missing a field the payload needs
    fails here rather than downstream.
    """

    body: dict[str, Any] = {field: stored.get(field) for field in FLPatchSpielDataPayload.model_fields}

    for key, block in NESTED_PAYLOAD_BLOCKS.items():
        stored_block = body.get(key)
        if stored_block is not None:
            body[key] = {field: stored_block[field] for field in block.model_fields}

    return {**body, **overrides}
