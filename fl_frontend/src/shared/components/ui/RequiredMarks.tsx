"use client";

// Redesign: goes with its last importer; the kit's fields replace it.
import { createContext, useContext } from "react";

import type { ReactNode } from "react";
import type { ZodArray, ZodDefault, ZodNullable, ZodObject, ZodOptional, ZodPipe, ZodType } from "zod";

/** The schema a wrapper holds: its inner one, or a pipe's input side, the side a form writes, past a preprocess's function. */
function unwrapped(at: ZodType): ZodType | undefined {
  const { type } = at.def;
  if (type === "optional" || type === "nullable" || type === "default") {
    return (at as ZodOptional<ZodType> | ZodNullable<ZodType> | ZodDefault<ZodType>).unwrap();
  }
  if (type === "pipe") {
    const pipe = at as ZodPipe<ZodType, ZodType>;
    return pipe.in.def.type === "transform" ? pipe.out : pipe.in;
  }
  return undefined;
}

/**
 * The schema one dotted payload path lands on through every wrapper `unwrapped` steps into, read with Zod's documented
 * `.def.type` and `.shape`, a list's entry named by its index. `undefined` where the path leaves objects and lists.
 */
function leafAt(schema: ZodType, path: string): ZodType | undefined {
  let at: ZodType | undefined = schema;

  for (const key of path.split(".")) {
    for (let inner = unwrapped(at); inner !== undefined; inner = unwrapped(at)) at = inner;
    // An index names a list's entry, whichever entry: every entry is judged by the one schema.
    if (at.def.type === "array" && /^\d+$/.test(key)) {
      at = (at as ZodArray<ZodType>).unwrap();
      continue;
    }
    if (at.def.type !== "object") return undefined;
    at = (at as ZodObject).shape[key];
    if (at === undefined) return undefined;
  }

  return at;
}

/**
 * Whether a field is required: its own schema refuses both `null` and the value its control writes when
 * emptied. A leaf taking `null` is optional however its box is spelled, the form sending `null` for it.
 */
function requiredBy(schemas: readonly ZodType[], path: string, empty: unknown): boolean {
  return schemas.some((schema) => {
    const leaf = leafAt(schema, path);
    return leaf !== undefined && !leaf.safeParse(null).success && !leaf.safeParse(empty).success;
  });
}

const RequiredSchemasContext = createContext<readonly ZodType[]>([]);

/** The payload schemas the fields below judge their marks by: a form's own, or a section's that submits elsewhere. */
export function RequiredSchemas({ schemas, children }: { schemas: readonly ZodType[]; children: ReactNode }) {
  return <RequiredSchemasContext value={schemas}>{children}</RequiredSchemasContext>;
}

/** A shared field's required mark, read off the schemas around it by the field's `name`, which is its payload path. */
export function useRequiredMark(name: string | undefined, empty: unknown): boolean {
  const schemas = useContext(RequiredSchemasContext);
  return name !== undefined && requiredBy(schemas, name, empty);
}
