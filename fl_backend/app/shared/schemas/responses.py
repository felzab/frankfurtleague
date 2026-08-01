"""
SHARED · response envelope

`BaseAPIResponse` is the base every response model extends. `acknowledged` is the one field every
endpoint returns, so a client can tell a successful empty result from a failure without inspecting the
status code.
"""

from typing import Literal

from pydantic import BaseModel


class BaseAPIResponse(BaseModel):
    acknowledged: Literal[0, 1] = 1
