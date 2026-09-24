import { readFileSync } from "node:fs";

import { DOCUMENT_PATH, REGENERATE_CITATION } from "@/core/openapiDocument.ts";

type JsonSchema = Record<string, unknown>;

export type PublishedDocument = {
  paths: Record<string, Record<string, JsonSchema>>;
  components: { schemas: Record<string, JsonSchema> };
};

/** The ceilings this reader reads. `maxLength` alone caps a box's width; the other two cap a count. */
const CEILING_KEYWORDS = ["maxLength", "maxItems", "maximum"] as const;

/**
 * One ceiling the backend publishes on a component's own field, one entry per keyword. `at` is where
 * inside the field's schema it was read: `""` for the field itself, `anyOf.<n>` for a nullable branch.
 */
export type PublishedCeiling = {
  component: string;
  field: string;
  keyword: (typeof CEILING_KEYWORDS)[number];
  bound: number;
  at: string;
};

export function readPublishedDocument(): PublishedDocument {
  try {
    return JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as PublishedDocument;
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }
}

/**
 * Every component some operation's request body reaches, closed over what those reference: a payload
 * root references its nested blocks rather than declaring them, so one hop misses every nested ceiling.
 */
export function requestComponents(document: PublishedDocument): Set<string> {
  const collect = (value: unknown, into: Set<string>) => {
    if (Array.isArray(value)) return value.forEach((item) => collect(item, into));
    if (typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "$ref" && typeof nested === "string") into.add(nested.replace("#/components/schemas/", ""));
      else collect(nested, into);
    }
  };

  const frontier = new Set<string>();
  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations)) collect(operation.requestBody, frontier);
  }

  const reached = new Set<string>();
  while (frontier.size > 0) {
    const name = frontier.values().next().value as string;
    frontier.delete(name);
    if (reached.has(name) || !(name in document.components.schemas)) continue;
    reached.add(name);
    collect(document.components.schemas[name], frontier);
  }

  return reached;
}

export function publishedCeilings(document: PublishedDocument, components: Iterable<string>): PublishedCeiling[] {
  const found: PublishedCeiling[] = [];

  for (const component of components) {
    const properties = (document.components.schemas[component]?.properties ?? {}) as Record<string, JsonSchema>;

    for (const [field, spec] of Object.entries(properties)) {
      // A nullable field publishes its bound inside `anyOf`, never beside the type: read only the outer
      // level and `website_url`'s own ceiling is silently unswept.
      const branches: [string, JsonSchema][] = [
        ["", spec],
        ...((spec.anyOf as JsonSchema[] | undefined) ?? []).map((branch, index): [string, JsonSchema] => [`anyOf.${String(index)}`, branch]),
      ];

      for (const keyword of CEILING_KEYWORDS) {
        for (const [at, branch] of branches) {
          const bound = branch[keyword];
          if (typeof bound === "number") found.push({ component, field, keyword, bound, at });
        }
      }
    }
  }

  return found;
}
