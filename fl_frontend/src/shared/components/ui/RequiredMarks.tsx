"use client";

import { createContext, useContext } from "react";

import type { ReactNode } from "react";
import type { ZodNullable, ZodObject, ZodOptional, ZodType } from "zod";

/**
 * The schema one dotted payload path lands on, through `.optional()` and `.nullable()`, read with Zod's
 * documented `.def.type`, `.unwrap()` and `.shape`. `undefined` where the path leaves the object tree.
 */
function leafAt(schema: ZodType, path: string): ZodType | undefined {
  let at: ZodType | undefined = schema;

  for (const key of path.split(".")) {
    while (at.def.type === "optional" || at.def.type === "nullable") at = (at as ZodOptional<ZodType> | ZodNullable<ZodType>).unwrap();
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
export function requiredBy(schemas: readonly ZodType[], path: string, empty: unknown): boolean {
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
