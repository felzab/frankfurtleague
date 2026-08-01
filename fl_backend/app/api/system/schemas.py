"""
SYSTEM · response models

Liveness, readiness and version. `status` is a `Literal["ok"]` rather than a free string: a probe that
can report anything other than ok would need callers to parse it, and failure is already expressed by
the status code.
"""

from typing import Literal

from app.shared.schemas.responses import BaseAPIResponse


class CheckIsLiveResponse(BaseAPIResponse):
    status: Literal["ok"] = "ok"


class CheckIsReadyResponse(BaseAPIResponse):
    status: Literal["ok"] = "ok"


class SystemInfoResponse(BaseAPIResponse):
    api_version: int
