import path from "node:path";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";

import type { ZodType } from "zod";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** A `schemas.ts` module, named by its path below `src` in forward slashes, and what it exports. */
export type SchemaModule = { module: string; exports: Record<string, unknown> };

/**
 * Every `schemas.ts` under `root`, loaded. Sorted: a sweep keying exports by name lets a later module
 * overwrite an earlier one, so an unfixed order would attribute a name two modules export to either.
 */
export async function schemaModules(root: string): Promise<SchemaModule[]> {
  const files = filesUnder(root, (name) => name === "schemas.ts", 8).sort();

  return Promise.all(
    files.map(async (file) => ({
      module: path.relative(SRC_DIR, file).split(path.sep).join("/"),
      exports: (await import(pathToFileURL(file).href)) as Record<string, unknown>,
    })),
  );
}

export function isZodSchema(value: unknown): value is ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}
