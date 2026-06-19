from typing import Any

from pydantic import BaseModel, model_validator

from app.api.spiele.schemas import FLSpielOrtField, FLSpielSchiedsrichterField, FLSpielTeamField
from app.shared.schemas.custom_types import CustomObjectId, CustomStrDate, CustomStrTime


class UpdateGameDataCallBody(BaseModel):
    spiel_id: CustomObjectId
    is_canceled: bool

    team1: FLSpielTeamField
    team2: FLSpielTeamField

    datum: CustomStrDate | None
    uhrzeit: CustomStrTime | None
    ort: FLSpielOrtField | None
    schiedsrichter: FLSpielSchiedsrichterField | None

    @model_validator(mode="before")
    @classmethod
    def empty_strings_to_none(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip() == "" else v) for k, v in data.items()}
        return data
