import { readFileSync } from "node:fs";

import { DOCUMENT_PATH, REGENERATE_CITATION } from "@/core/openapiDocument.ts";

type JsonSchema = Record<string, unknown>;

export type PublishedDocument = {
  paths: Record<string, Record<string, JsonSchema>>;
  components: { schemas: Record<string, JsonSchema> };
};

/**
 * One ceiling the backend publishes on a component's own field. `characters` is `null` where the field
 * is bounded by a `maximum` instead, which caps a count and no box's width.
 */
export type PublishedCeiling = { component: string; field: string; characters: number | null; maximum: number | null };

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
      const branches = [spec, ...((spec.anyOf as JsonSchema[] | undefined) ?? [])];
      const bound = (key: string) => branches.map((branch) => branch[key]).find((value): value is number => typeof value === "number") ?? null;
      const characters = bound("maxLength");
      const maximum = characters === null ? bound("maximum") : null;

      if (characters !== null || maximum !== null) found.push({ component, field, characters, maximum });
    }
  }

  return found;
}
