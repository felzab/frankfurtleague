from typing import Literal

from app.shared.schemas.responses import BaseReadModel


class ProbeResponse(BaseReadModel):
    # A `Literal`, not a free string: a failing probe is its status code.
    status: Literal["ok"] = "ok"
