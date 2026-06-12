from typing import Literal

from pydantic import BaseModel, Field

from app.shared.schemas.custom_types import CustomStrDate

FlSaisonStatus = Literal["past", "active", "future"]


class FlSaisonRules(BaseModel):
    win_points: int
    draw_points: int


class FlSaison(BaseModel):
    id: str = Field(alias="_id")

    start_date: CustomStrDate
    end_date: CustomStrDate
    status: FlSaisonStatus
    rules: FlSaisonRules
