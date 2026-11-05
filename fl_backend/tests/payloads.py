from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from app.api.spiele.schemas import SPIEL_PATCH_WRITTEN_FIELDS, FLSpielOrtFieldPayload, FLSpielSchiedsrichterFieldPayload

# The two blocks a payload takes field by field, which refuse any other: a test's document may carry
# more than the stored shape, the name a read joins among it.
NESTED_PAYLOAD_BLOCKS: Mapping[str, type[BaseModel]] = {
    "ort": FLSpielOrtFieldPayload,
    "schiedsrichter": FLSpielSchiedsrichterFieldPayload,
}


def spiel_patch_body(stored: Mapping[str, Any], **overrides: Any) -> dict[str, Any]:
    """`stored` as the editor would submit it; overriding nothing gives the no-op save.

    Not the document: the editor sends the fixture's fields and the `version` it read, and none of the names a read joins.
    """

    body: dict[str, Any] = {field: stored.get(field) for field in SPIEL_PATCH_WRITTEN_FIELDS}

    for key, block in NESTED_PAYLOAD_BLOCKS.items():
        stored_block = body.get(key)
        if stored_block is not None:
            # Indexed rather than `.get`, so a stored block missing a field the payload needs fails
            # here rather than downstream on a body that looks well formed.
            body[key] = {field: stored_block[field] for field in block.model_fields}

    # The precondition is the version the editor was served, which no override of a field moves.
    body["version"] = stored.get("version", 0)

    return {**body, **overrides}
