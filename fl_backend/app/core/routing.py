"""
CORE · path parameter convertors

One custom URL convertor, `objectid`, and the helper that spells a path with it.

 WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────────

  `GET /spiele/action_required` is admin-authorized and `GET /spiele/{spiel_id}` is not, so the two live
  in different routers -- and with an unconstrained `{spiel_id}` the literal path is captured by the
  parameter, making the order routers are included in `app/main.py` load-bearing. That is a fragile thing
  to rest a route on: it is invisible at both definition sites and breaks silently.

  Constraining the parameter to 24 hex characters removes the ambiguity at its source. `action_required`
  simply does not match, so routing falls through to the literal path whatever the include order is.

  Declaring literal routes before parameterised ones is the usual answer and is what `saisons/router.py`
  does for `/current`. It works only WITHIN one router; these two cannot share one, because they do not
  share an authorization level (ADR-0034).

 A CONSEQUENCE WORTH HAVING ───────────────────────────────────────────────────────────────────────────────

  A malformed id is now a 404 rather than a 422. `/spiele/not-an-id` matches no route at all, which is
  the honest answer -- it is not a match whose id failed validation, it is not a match. The same value
  in a query parameter stays a 422, and that split is ratified rather than accidental (ADR-0071): a
  path identifies, a query validates.

 REGISTRATION IS AN IMPORT SIDE EFFECT ────────────────────────────────────────────────────────────────────

  Starlette resolves a convertor name when the route is COMPILED, which happens as the decorator runs --
  so this module must be imported before any router module that uses it. Routers reach the convertor
  through `by_id()` rather than by spelling the name themselves, which makes that import real rather than
  something a tidy-up could remove as unused.
"""

from starlette.convertors import Convertor, register_url_convertor

CONVERTOR_NAME = "objectid"

# A 24-character hex string, which is what `str(ObjectId(...))` produces. Deliberately NOT parsing to a
# bson.ObjectId here: the endpoints annotate the parameter with `CustomRouteObjectId`, so parsing stays
# in one place and this decides only whether the path matches at all.
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
