import { tv } from "./tv";

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

/**
 * The editor's bar at the foot of the viewport, which `EditorBar` draws and the editor's placeholder holds: on desktop as
 * tall as the rail's foot beside it (`--rail-foot`, from `tokens.css`), so the two top hairlines are one line.
 */
export const editorBarLook = tv({
  base: "sticky bottom-0 z-10 flex h-14 items-center gap-4 border-t border-border bg-bg px-4 lg:h-(--rail-foot) lg:px-8",
});
