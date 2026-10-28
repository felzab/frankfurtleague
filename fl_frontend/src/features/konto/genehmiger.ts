import type { FLVerwaltung } from "@/features/berechtigungen/schemas";

/**
 * Who else must agree to a change moving a grant of `verwaltung`, one wording for every sentence the account page
 * says it in: an owner's change is another owner's alone.
 */
export const genehmigerText = (verwaltung: FLVerwaltung): string =>
  verwaltung === "owner" ? "eine andere Inhaberin oder ein anderer Inhaber der Verwaltung" : "eine andere Person aus der Verwaltung";
