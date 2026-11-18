from typing import Literal

from app.shared.schemas.responses import BaseReadModel


class CheckIsLiveResponse(BaseReadModel):
    # A `Literal`, not a free string: failure is already the status code.
    status: Literal["ok"] = "ok"


class CheckIsReadyResponse(BaseReadModel):
    # A `Literal`, not a free string: a database that does not answer is the 503.
    status: Literal["ok"] = "ok"
