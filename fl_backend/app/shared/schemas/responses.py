from typing import Literal

from pydantic import BaseModel


class BaseAPIResponse(BaseModel):
    # On every response model, so a client tells a successful empty result from a failure without
    # reading the status code.
    acknowledged: Literal[0, 1] = 1
