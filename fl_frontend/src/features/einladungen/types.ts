import type { FLEinladungZeile } from "@/core/generated/client/types";

/**
 * What the team editor's invite panel is rendered from. **`laeuft` rides beside the row rather than
 * on it**: the window's verdict is a judgement about today and belongs to no invite, which carries
 * no expiry date of its own.
 */
export type TeamEinladungState = {
  einladung: FLEinladungZeile | null;
  laeuft: boolean;
};
