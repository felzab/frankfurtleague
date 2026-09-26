import ast

from app.api.saisons.schemas import FLPatchSaisonPayload, FLPostSaisonPayload
from app.core.collections import Collection
from app.core.constraints import UNIQUE_INDEXES
from tests.core.app_source import WRITE_HELPERS, app_calls, callee, transactional_callbacks

# The callback `activate_saison` runs as one transaction, which is where both `status` writes stand.
ACTIVATION_CALLBACK = "judge_and_roll_the_league_over"

# The arguments the write helpers take their document from. A filter and a projection name a field
# too, and neither writes it.
WRITE_DOCUMENTS = frozenset({"document", "update"})

# The driver calls that change a document, and the modules `app/core/crud.py`'s own header holds them
# to -- where a write reaches the driver anywhere else, it can carry its document past the sweep below.
DRIVER_WRITES = frozenset(
    {"bulk_write", "find_one_and_replace", "find_one_and_update", "insert_many", "insert_one", "replace_one", "update_many", "update_one"}
)
WRITE_MODULES = ("app/core/crud.py", "app/core/recording.py")


def _literal_writes_of(field: str, *, on: str) -> set[tuple[str, str]]:
    """Every write naming `field` in a literal document on `on`, the function making it and the value set.

    Scoped to ONE collection's handle: a field name is not unique across the database, and an
    application carries a `status` too.
    """

    writes: set[tuple[str, str]] = set()
    for _, scope, call in app_calls():
        if not any(k.arg == "collection" and isinstance(k.value, ast.Name) and k.value.id == on for k in call.keywords):
            continue

        for keyword in call.keywords:
            if keyword.arg not in WRITE_DOCUMENTS:
                continue

            for node in ast.walk(keyword.value):
                if not isinstance(node, ast.Dict):
                    continue

                for key, value in zip(node.keys, node.values, strict=True):
                    if isinstance(key, ast.Constant) and key.value == field:
                        writes.add((scope, str(value.value) if isinstance(value, ast.Constant) else "<composed>"))

    return writes


class TestTheActivationIsTheOneWriterOfTheStatus:
    """At most one season `active` is the database's; exactly one from the first activation on is this writer's."""

    def test_a_unique_index_holds_the_active_season_alone(self):
        """Filtered to `active`, since the league keeps every season it ever played beside the running one."""

        covering = [(index.keys, index.partial_filter) for index in UNIQUE_INDEXES if index.collection == Collection.SAISONS]

        assert covering == [(("status",), {"status": "active"})]

    def test_only_the_activation_writes_a_status_a_second_season_could_hold(self):
        """Every literal write under `app/` naming the field, as the function making it and the value it sets."""

        # The sweep reads the document a write helper is GIVEN, so it is complete only while every
        # write goes through one: a driver call takes its document positionally.
        outside = sorted({f"{module} :: {scope}" for module, scope, call in app_calls() if callee(call) in DRIVER_WRITES})
        assert [call for call in outside if not call.startswith(WRITE_MODULES)] == []

        # `post_saison` writes the constant `future` at create; `active` and the demotion to `past`
        # are one function's, which is what lets one transaction hold the pair. That function is the
        # callback the activation runs, not the endpoint.
        assert _literal_writes_of("status", on="saisons_collection") == {
            ("post_saison", "future"),
            (ACTIVATION_CALLBACK, "past"),
            (ACTIVATION_CALLBACK, "active"),
        }

    def test_no_season_payload_carries_the_field(self):
        """The route the sweep above cannot see: the patch writes its payload wholesale, so a `status` field would ride along unnamed."""

        assert not {"status"} & set(FLPostSaisonPayload.model_fields)
        assert not {"status"} & set(FLPatchSaisonPayload.model_fields)

    def test_the_demotion_and_the_promotion_share_one_transaction(self):
        """Both writes inside the callback the activation runs as one transaction, each carrying its session.

        Split them across two callbacks and this fails: a demotion that committed without the
        promotion would leave the league with no active season at all.
        """

        activation = [entry for entry in transactional_callbacks(WRITE_HELPERS) if entry.where.endswith(ACTIVATION_CALLBACK)]

        assert len(activation) == 1, f"{ACTIVATION_CALLBACK} is run by {len(activation)} transactions"
        assert set(activation[0].writes) == {("patch_many_in_db", True), ("patch_one_in_db", True)}
