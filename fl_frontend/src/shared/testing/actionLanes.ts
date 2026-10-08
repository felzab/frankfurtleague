import path from "node:path";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

/** A module's path below `src`, in forward slashes, as the lane table below names it. */
export const srcPathOf = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * The server action modules answering a person, by path below `src`. One table both spines read, the
 * person spine sweeping these and the admin spine every other: a person's module missing here meets
 * the administrator's guard and fails.
 */
export const PERSON_ACTION_MODULES: ReadonlySet<string> = new Set([
  "features/kontakte/personActions.ts",
  "features/registrierungen/personActions.ts",
  "features/schiedsrichter/personActions.ts",
  "features/spieler/personActions.ts",
]);
