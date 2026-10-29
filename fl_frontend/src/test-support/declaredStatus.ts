import type { FLDraftStatus } from "@/shared/utils/draftStatus.ts";

/**
 * A draft with no row to show, as a section stands before a save judges one. It names its paths because
 * `fieldStatus` throws for one its table does not declare, and `declaredStatus<SliceFieldPath>` holds each to that table.
 */
export function declaredStatus<P extends string>(paths: readonly NoInfer<P>[]): FLDraftStatus<string> {
  return { fields: [], byPath: new Map(), declared: new Set(paths), changed: [], invalid: [], isDirty: false };
}
