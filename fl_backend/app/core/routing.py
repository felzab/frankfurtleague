"""
CORE · path parameter convertors

One custom URL convertor, `objectid`, and the helper that spells a path with it. It exists
because `GET /spiele/action_required` and `GET /spiele/{spiel_id}` live in different routers
(ADR-0027), so declaration order cannot separate them — constraining the parameter to 24 hex
characters removes the ambiguity at its source, whatever order the routers are included in. A
malformed id is therefore a 404 rather than a 422: a path identifies, a query validates (ADR-0057).

Invariants:
- Registration is an import side effect — `by_id()` is what keeps this module's import real.
"""

from starlette.convertors import Convertor, register_url_convertor

CONVERTOR_NAME = "objectid"

# A 24-character hex string, which is what `str(ObjectId(...))` produces. Deliberately not parsed here:
# the endpoints annotate with `CustomRouteObjectId`, so this decides only whether the path matches.
OBJECT_ID_REGEX = "[0-9a-fA-F]{24}"


class ObjectIdConvertor(Convertor[str]):
    regex = OBJECT_ID_REGEX

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


register_url_convertor(CONVERTOR_NAME, ObjectIdConvertor())


def by_id(parameter: str) -> str:
    """
    The sub-path addressing one document by its ObjectId — `/{spiel_id:objectid}`.

    FastAPI strips the convertor when it builds the OpenAPI document, so the published path reads
    `/spiele/{spiel_id}` and clients generated from it are unaffected.
    """
    return f"/{{{parameter}:{CONVERTOR_NAME}}}"
