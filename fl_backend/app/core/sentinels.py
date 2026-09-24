"""
CORE · the fixed ids naming a row no person stands behind

A referee's erasure deletes their document, so every fixture that named them has to name something
else: a reference the write path can still resolve, rather than a null each reader would branch on.
The ghost is that row, permanently retired so `REQ-BOOKING-001` refuses it every new fixture and
nameless so each surface reads it through the null-name path it already has.

Its own module because the erasure, both referee routers and the migration all reach it, and
because `app/core/domain.py` is a declaration no write path imports.
"""

from typing import Final

from bson import ObjectId

# Fixed rather than generated: every erasure and every migration has to reach one id without
# reading the others. All zeroes because an ObjectId carries a timestamp, so nothing mints this
# one by accident.
GHOST_SCHIEDSRICHTER_ID: Final = ObjectId("000000000000000000000000")

# The day the ghost carries as its retirement. Any date the league predates serves; this one is
# recognisable on sight as a sentinel rather than a day somebody stopped officiating.
GHOST_INACTIVE_SINCE: Final = "2000-01-01"
