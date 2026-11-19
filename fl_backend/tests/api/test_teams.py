import pytest
from pydantic import ValidationError

from app.api.teams.schemas import FLTeam


def test_rejects_a_website_url_that_is_not_http(team):
    """A security constraint, not tidiness: this URL is rendered into an href on a public page.

    One URL proves the field runs the shared validator, whose own table holds what it refuses.
    """
    with pytest.raises(ValidationError):
        FLTeam.model_validate(team(website_url="javascript:alert(1)"))
