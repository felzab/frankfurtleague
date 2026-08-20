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
    changed,
    invalid: fields.filter((field) => field.error !== null),
    isDirty: changed.length > 0,
  };
}
