from typing import Literal

from pydantic import BaseModel


class BaseAPIResponse(BaseModel):
    acknowledged: Literal[0, 1] = 1
