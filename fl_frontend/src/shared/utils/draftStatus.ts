import type { FieldErrors } from "@/shared/utils/validation";

/**
 * One row of an edit page's change list. A field with no descriptor is invisible to that page: it
 * neither renders a row nor counts towards `isDirty`.
 */
export type FLFieldDescriptor<TSource, TGroup extends string> = {
  /** The payload's dotted path AND the input `name`, the `FieldErrors` key and the anchor id, so all four move together. */
  path: string;
  label: string;
  group: TGroup;
  /** DISPLAY text doubling as the comparison key, so a field must format to a string that changes exactly when its value does. */
  read: (source: TSource) => string | null;
  /** Restricts the row to drafts where the field exists. Defaults to always. */
  appliesTo?: (source: TSource) => boolean;
  /** Widened where a schema reports a field's failures under several keys. Defaults to `[path]`. */
  errorPaths?: readonly string[];
};

export type FLFieldStatus<TGroup extends string> = {
  path: string;
  label: string;
  group: TGroup;
  isChanged: boolean;
  error: string | null;
  storedText: string | null;
  draftText: string | null;
};

export type FLDraftStatus<TGroup extends string> = {
  fields: readonly FLFieldStatus<TGroup>[];
  byPath: ReadonlyMap<string, FLFieldStatus<TGroup>>;
  /** Every path the editor's descriptor table carries, whether or not its descriptor applies to this draft. */
  declared: ReadonlySet<string>;
  changed: readonly FLFieldStatus<TGroup>[];
  invalid: readonly FLFieldStatus<TGroup>[];
  isDirty: boolean;
};

/**
 * Empty becomes null; anything else is returned AS TYPED. Nothing trims before the save -- not the
 * Zod schemas, not the backend -- so trimming here would report a whitespace-only edit as unchanged.
 */
export const emptyAsNull = (value: string | null): string | null => (value === null || value.trim() === "" ? null : value);

/**
 * The numeric counterpart. An emptied number field holds `null`, and `String(null)` would report it as the word
 * "null" -- a change list saying a count went from 3 to "null" rather than to nothing at all.
 */
export const numberAsNull = (value: number | null): string | null => (value === null ? null : String(value));

/**
 * The fold every editor's change list shares. A slice contributes only what is its own — its group
 * union, its descriptors and their `read` functions — which is also what lets this live in `shared`
 * without importing a feature.
 */
export function deriveDraftStatus<TSource, TGroup extends string>({
  descriptors,
  stored,
  draft,
  fieldErrors,
}: {
  descriptors: readonly FLFieldDescriptor<TSource, TGroup>[];
  stored: TSource;
  draft: TSource;
  fieldErrors: FieldErrors;
}): FLDraftStatus<TGroup> {
  const fields = descriptors
    .filter((descriptor) => descriptor.appliesTo?.(draft) ?? true)
    .map((descriptor): FLFieldStatus<TGroup> => {
      const storedText = descriptor.read(stored);
      const draftText = descriptor.read(draft);
      const error =
        (descriptor.errorPaths ?? [descriptor.path]).map((path) => fieldErrors[path]).find((message) => message !== undefined) ?? null;

      return {
        path: descriptor.path,
        label: descriptor.label,
        group: descriptor.group,
        isChanged: storedText !== draftText,
        error,
        storedText,
        draftText,
      };
    });

  const changed = fields.filter((field) => field.isChanged);

  return {
    fields,
    byPath: new Map(fields.map((field) => [field.path, field])),
    declared: new Set(descriptors.map((descriptor) => descriptor.path)),
    changed,
    invalid: fields.filter((field) => field.error !== null),
    isDirty: changed.length > 0,
  };
}

/**
 * One field's row, `undefined` where its descriptor does not apply to this draft. A path the table does not
 * declare throws: a lookup answering `undefined` for it reads as a field left unchanged, and drops its marker.
 */
export function fieldStatus<TGroup extends string>(status: FLDraftStatus<TGroup>, path: string): FLFieldStatus<TGroup> | undefined {
  if (!status.declared.has(path)) throw new Error(`${path} is no path this editor's descriptor table declares`);

  return status.byPath.get(path);
}
