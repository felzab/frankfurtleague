from typing import Literal

from app.shared.schemas.responses import BaseAPIResponse


class CheckIsLiveResponse(BaseAPIResponse):
    # A `Literal`, not a free string: failure is already the status code.
    status: Literal["ok"] = "ok"


class CheckIsReadyResponse(BaseAPIResponse):
    status: Literal["ok"] = "ok"


class SystemInfoResponse(BaseAPIResponse):
    api_version: int
