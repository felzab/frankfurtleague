from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload


class TestTheActivationIsTheOneWriterOfTheStatus:
    """At most one season `active` is the database's; exactly one from the first activation on is this writer's."""

    def test_no_season_payload_carries_the_field(self):
        """The patch writes its payload wholesale, so a `status` field would ride along unnamed."""

        assert not {"status"} & set(FLPostSaisonPayload.model_fields)
        assert not {"status"} & set(FLPatchSaisonPayload.model_fields)
