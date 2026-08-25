import { readFileSync } from "node:fs";
import path from "node:path";

// Three levels, because this module sits at `src/core` rather than in a feature slice. Reading the
// register from one place is what keeps that depth from being counted again in every test.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

// Source text rather than an import: the register is Python. Nothing on this side can load it, and
// the frontend holds no second copy that could be read instead.
const DOMAIN = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "domain.py"), "utf8");

/** What separates the operations one rule is declared against, in the backend's own register. */
const OPERATION_SEPARATOR = " · ";

interface DeclaredRule {
  readonly code: string;
  readonly operations: readonly string[];
  /** The entry's own source, for a rule found by the symbol implementing it rather than by its code. */
  readonly source: string;
}

/** Every rule the backend declares, in the order the register writes them. */
export const DECLARED_RULES: readonly DeclaredRule[] = DOMAIN.split("Rule(")
  .slice(1)
  .map((entry) => ({
    code: /code="([^"]+)"/.exec(entry)?.[1] ?? "",
    operations: (/operation="([^"]+)"/.exec(entry)?.[1] ?? "").split(OPERATION_SEPARATOR),
    source: entry,
  }));

/**
 * Every refusal one endpoint declares. Whole tokens rather than a substring match: several
 * operations are a prefix of another, and matching by substring hands one endpoint's codes to its
 * neighbour, leaving a real refusal unmapped.
 */
export function declaredCodes(operation: string): string[] {
  const codes = DECLARED_RULES.filter((rule) => rule.operations.includes(operation)).map((rule) => rule.code);

  return [...new Set(codes)].sort();
}

/**
 * One declaration's source, up to the one named after it — `to === null` reaches the module's end.
 *
 * Empty when either boundary is missing, so a boundary that stopped matching fails the test
 * pinning the cut, not every assertion reading the slice.
 */
export function sliceBetween(source: string, from: string, to: string | null): string {
  const start = source.indexOf(from);
  if (start === -1) return "";
  const end = to === null ? source.length : source.indexOf(to, start + from.length);

  return end === -1 ? "" : source.slice(start, end);
}
