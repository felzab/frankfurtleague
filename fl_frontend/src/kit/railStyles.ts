import { tv } from "tailwind-variants/lite";

/**
 * What the rail's parts share between the frame, drawn on the server, and its client parts (`RailState.tsx`):
 * kept apart from the client module, whose every export the server would receive as a reference it cannot
 * call.
 */

/** The rail's id, which the strip's toggle names in `aria-controls`; one rail stands in a document. */
export const RAIL_ID = "rail";

/** Words of the rail that fade as it collapses, clipped by the box they stand in rather than wrapped. */
export const railFade = tv({ base: "transition-opacity duration-(--motion-in) group-data-collapsed:opacity-0" });

/**
 * A rail link's 18-px glyph, in a 24-px box while the rail is collapsed: the list's 12-px inset, the link's
 * 12 and the box's 3 centre it in the 72-px rail, which no step of the spacing scale does with 18 px alone.
 */
export const railGlyph = tv({ base: "flex shrink-0 justify-center group-data-collapsed:w-6" });
