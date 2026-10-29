"""
CORE · the fixed ids naming a row no person stands behind

An erasure deletes the person's document, so every entry that named them has to name something
else: a reference the write path can still resolve, rather than a null each reader would branch on.
Each sentinel is that row for its collection, and nameless.

The referee's ghost is permanently retired, so `REQ-BOOKING-001` refuses it every new fixture, and
each fixture surface reads it through the null-name path it already has. The pupils' sentinel also
carries no consent record, so no count of consent records includes it, and no read serves it: every
served model requires a forename, so each read excludes the sentinel by its id.

Its own module because the referee routers, the fixture reads and the pupil filters all reach these
ids.
"""

from typing import Final

from bson import ObjectId

# Fixed rather than generated: every erasure has to reach one id without reading the others. All
# zeroes because an ObjectId carries a timestamp, so nothing mints this one by accident.
GHOST_SCHIEDSRICHTER_ID: Final = ObjectId("000000000000000000000000")

# The referee's ghost with its last digit raised: the zero timestamp is what no generated ObjectId
# can carry, and one digit apart shows the two are sentinels of one kind.
GHOST_SPIELER_ID: Final = ObjectId("000000000000000000000001")

# The day each sentinel carries as its retirement. Any date the league predates serves; this one is
# recognisable on sight as a sentinel rather than a day somebody stopped officiating or playing.
GHOST_INACTIVE_SINCE: Final = "2000-01-01"
