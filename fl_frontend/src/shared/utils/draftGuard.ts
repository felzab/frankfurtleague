import { appToast } from "@/shared/utils/appToast";

/**
 * True where a one-way control may proceed. Each revalidates its route, so an unsaved draft would go
 * with the replaced props. Calls no Hook, so it takes
 * [no `use` prefix](https://react.dev/learn/reusing-logic-with-custom-hooks).
 */
export function guardAgainstDraft(isDirty: boolean, whatIsInTheWay: string): boolean {
  if (!isDirty) return true;

  appToast.warning("Erst speichern", { description: whatIsInTheWay });
  return false;
}
