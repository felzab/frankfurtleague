from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload
from app.core.collections import Collection
from app.core.constraints import UNIQUE_INDEXES


class TestTheActivationIsTheOneWriterOfTheStatus:
    """At most one season `active` is the database's; exactly one from the first activation on is this writer's."""

    def test_a_unique_index_holds_the_active_season_alone(self):
        """Filtered to `active`, since the league keeps every season it ever played beside the running one."""

        covering = [(index.keys, index.partial_filter) for index in UNIQUE_INDEXES if index.collection == Collection.SAISONS]

        assert covering == [(("status",), {"status": "active"})]

    def test_no_season_payload_carries_the_field(self):
        """The patch writes its payload wholesale, so a `status` field would ride along unnamed."""

        assert not {"status"} & set(FLPostSaisonPayload.model_fields)
        assert not {"status"} & set(FLPatchSaisonPayload.model_fields)
