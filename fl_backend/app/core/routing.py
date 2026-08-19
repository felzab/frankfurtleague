from starlette.convertors import Convertor, register_url_convertor

CONVERTOR_NAME = "objectid"

# 24 hex characters, what `str(ObjectId(...))` produces. Constraining the parameter keeps a static
# path out of an id route whatever order the routers load, and makes a malformed id a 404.
OBJECT_ID_REGEX = "[0-9a-fA-F]{24}"


class ObjectIdConvertor(Convertor[str]):
    regex = OBJECT_ID_REGEX

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


# An import side effect -- `by_id()` is what keeps this module's import real.
register_url_convertor(CONVERTOR_NAME, ObjectIdConvertor())


def by_id(parameter: str) -> str:
    """The sub-path addressing one document by its ObjectId — `/{spiel_id:objectid}`.

    FastAPI strips the convertor when it builds the OpenAPI document, so the published path reads
    `/spiele/{spiel_id}`.
    """
    return f"/{{{parameter}:{CONVERTOR_NAME}}}"
