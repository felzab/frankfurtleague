import { readFileSync } from "node:fs";
import path from "node:path";

const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "openapi.json");

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

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** One code an operation's failure body may carry, under the status that publishes it. */
type PublishedAnswer = { code: string; status: number };

/** One operation, named `<METHOD> <path>` below the version prefix as the backend's own routes spell it. */
export type PublishedOperation = { operation: string; declaration: JsonObject; answers: PublishedAnswer[] };

/**
 * Whether a slice's mapper words a published code: a rule's, or the unique index's. The protocol's codes
 * are published on nearly every operation and answered alike on all of them by the shared reader.
 */
export function isRefusalCode(code: string): boolean {
  return code === "DB-COMMON-002" || (code.startsWith("REQ-") && !code.startsWith("REQ-AUTH-") && code !== "REQ-VAL-001");
}

/**
 * Every `error_code` enum a schema carries, its `allOf` members and `$ref` targets followed: the
 * backend narrows the failure body by composing it, and an enum it moved into a component is still
 * the operation's own.
 */
function codeEnums(document: JsonObject, schema: unknown, seen: ReadonlySet<string> = new Set()): unknown[] {
  if (!isObject(schema)) return [];

  const ref = schema.$ref;
  if (typeof ref === "string") {
    const name = ref.replace(/^#\/components\/schemas\//, "");
    const components = isObject(document.components) && isObject(document.components.schemas) ? document.components.schemas : {};
    if (seen.has(name) || !(name in components)) throw new Error(`the document cannot resolve ${ref}`);

    return codeEnums(document, components[name], new Set([...seen, name]));
  }

  const own = isObject(schema.properties) && isObject(schema.properties.error_code) ? schema.properties.error_code.enum : undefined;
  const members = Array.isArray(schema.allOf) ? schema.allOf.flatMap((member) => codeEnums(document, member, seen)) : [];

  return own === undefined ? members : [own, ...members];
}

/** The codes one response publishes, or none where its body narrows no `error_code`. */
function responseCodes(document: JsonObject, operation: string, status: string, response: unknown): string[] {
  const body = isObject(response) && isObject(response.content) ? response.content["application/json"] : undefined;
  const enums = codeEnums(document, isObject(body) ? body.schema : undefined);
  if (enums.length === 0) return [];

  // One enum and no more: two would leave which of them the backend answers from to the reader.
  const [codes] = enums;
  if (enums.length !== 1 || !Array.isArray(codes) || codes.length === 0 || !codes.every((code) => typeof code === "string")) {
    throw new Error(`the ${status} on ${operation} does not publish its codes as one enum of strings`);
  }

  return codes as string[];
}

/**
 * Every operation the document publishes, with each code its failure responses carry under their
 * numbered statuses. Throws where two published paths name one operation, which the version prefix
 * alone would part.
 */
export function publishedOperations(document: unknown = readPublishedDocument()): PublishedOperation[] {
  if (!isObject(document) || !isObject(document.paths)) throw new Error(`${DOCUMENT_PATH} publishes no paths`);

  const found = new Map<string, PublishedOperation>();
  for (const [published, item] of Object.entries(document.paths)) {
    if (!isObject(item)) continue;

    for (const [method, declaration] of Object.entries(item)) {
      if (!isObject(declaration) || !isObject(declaration.responses)) continue;

      const operation = `${method.toUpperCase()} ${published.replace(/^\/api\/v\d+/, "")}`;
      if (found.has(operation))
        throw new Error(`the document serves ${operation} twice; refresh it with the command ${REGENERATE_CITATION} declares`);

      const answers = Object.entries(declaration.responses)
        .filter(([status]) => /^\d{3}$/.test(status))
        .flatMap(([status, response]) =>
          responseCodes(document, operation, status, response).map((code) => ({ code, status: Number(status) })),
        );
      found.set(operation, { operation, declaration, answers });
    }
  }

  return [...found.values()];
}
