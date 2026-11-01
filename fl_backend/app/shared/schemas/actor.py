from typing import Literal

from pydantic import BaseModel


class FLVonAdmin(BaseModel):
    """An administrator's act, naming nobody: the record keeps how a thing was settled, not who typed it."""

    art: Literal["admin"]
