"""
CORE · the nine collection names

One declaration of what this database holds, so the name is written once rather than in each of the three
places that need it: the DI accessors in `db.py`, the `$jsonSchema` validators in `constraints.py`, and the
aggregate and reference tables in `domain.py`.

 WHY AN ENUM HERE AND A `Literal` IN `app/api/*/schemas.py` ─────────────────────────────────────────────────

  The difference is what the value IS. `FLSaisonStatus` is a `Literal` because the string is DATA: it is
  stored in MongoDB, enumerated in a validator and published in `openapi.json`, so the wire format needs
  the bare value and nothing else. A collection name never crosses the wire -- it is how this process
  addresses its own storage -- so it wants the three things an enum gives and a `Literal` cannot: a
  namespace at the call site, per-member documentation attached to the member, and iteration.

  Iteration is what earns it. `test_every_collection_is_declared_once` walks `Collection` against
  `COLLECTION_VALIDATORS` and against `db.py`'s accessors, so a tenth collection added to one and not the
  others fails rather than drifting -- and that check is not expressible over a `Literal` without
  `get_args`.

  `StrEnum` rather than the `(str, Enum)` mixin, for the reason `app/core/domain.py` gives: on Python 3.12+
  the mixin renders as `Collection.SAISONS` inside an f-string, and a Mongo filter built from one would
  carry the enum's name instead of the collection's.

 WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────────────────────

  It is not a declaration of FIELD names, and there is deliberately no equivalent for those. A filter needs
  the STORED name, which differs from the model's field where an alias is involved (`_id` against `id`), so
  a constants layer over fields would be a hand-maintained third copy of every schema -- which is what
  ADR-0031 exists to avoid. Motor's API takes strings there and this repository keeps them.
"""

from enum import StrEnum


class Collection(StrEnum):
    """Every collection this database has. The value is the name Mongo knows it by."""

    #: Seasons. The `_id` is the four-character season string every `saison_id` elsewhere references.
    SAISONS = "saisons"
    #: The season-to-team junction, which is what belongs to a season -- the club itself does not.
    SAISON_TEAMS = "saison_teams"
    #: The season-to-player junction, carrying everything a squad list shows.
    SAISON_SPIELER = "saison_spieler"
    #: Fixtures. One aggregate per SEASON rather than per match, because a result resolves the bracket.
    SPIELE = "spiele"
    #: Matchdays: named blocks of a season's fixtures, though the name itself is derived (ADR-0067).
    SPIELTAGE = "spieltage"
    #: Clubs, season-independent.
    TEAMS = "teams"
    #: People, season-independent.
    SPIELER = "spieler"
    #: Venues.
    SPIELORTE = "spielorte"
    #: Referees.
    SCHIEDSRICHTER = "schiedsrichter"
