import type { Copy } from "@/core/copy";
import type { FormStatus } from "./useFormAction";

/**
 * The line of an act that cannot run, every act alike: its reason in `statusLine`'s `locked` tone, the small muted
 * face, announced as the line's every answer is, its button disabled beside or above it. A plain module, so a server
 * component's act draws it too, as `ListPage`'s create act does; a client act finds its reason through `useLocked`.
 */
export const lockedLine = (reason: Copy): FormStatus => ({ tone: "locked", text: reason });
