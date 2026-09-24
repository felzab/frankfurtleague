import { readFileSync } from "node:fs";
import path from "node:path";

export const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "openapi.json");

// Printed by the contract suites to whoever must refresh the document, a citation rather than the
// command: TypeScript cannot import the command's one declaration, and no check would hold a copy to it.
export const REGENERATE_CITATION = "`fl_backend/tests/openapi_document.py :: REGENERATE`";

export function readPublishedDocument(): unknown {
  try {
    return JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }
}
