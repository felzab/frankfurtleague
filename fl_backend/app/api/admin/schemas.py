"""
ADMIN · response models

Only the Spiel patch response lives here. Venue and referee payloads stay in their own slices, because
they describe those entities rather than the admin surface.
"""

from app.shared.schemas.responses import BaseAPIResponse


class FLPatchSpielDataResponse(BaseAPIResponse):
    """The `{"acknowledged": 1}` body patch_spiel_data returns, declared rather than implied."""
