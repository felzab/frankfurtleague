import type { FieldErrors } from "../utils/validation";

/**
 * What one route's info glyph says. The shape is the hierarchy rather than a paragraph list each author
 * structures their own way: rendered, a term is bold and its detail is not, so a reader scans the terms.
 */
export interface SidemenuHint {
  /** One sentence: what the page is for. Never a list, never two sentences of setup. */
  lead: string;
  /** One entry per thing worth naming — a control, a state, a rule the page applies. */
  points?: readonly { term: string; detail: string }[];
  /**
   * A closing caveat, for the one thing a reader would otherwise look for here and not find. It counts
   * against the cap like a bullet (`docs/frontend/spec.md` §1.12).
   */
  note?: string;
}

/**
 * `TIcon` has no default on purpose: with one, an unannotated structure infers `string`, the icon dictionary accepts
 * any key, and the missed lookup is swallowed by `SidemenuNavItem`'s truthiness guard.
 */
export interface SidemenuStructureSubOption<TIcon extends string> {
  id: string;
  label: string;
  iconName: TIcon;
  /**
   * Required, so a new route cannot ship without one: a hint present on only some pages is worse than none, because
   * its absence then reads as "this page has nothing to explain".
   */
  hint: SidemenuHint;
}

interface SidemenuStructureEntry<TIcon extends string> {
  /**
   * The heading above the group, or `""` for a group that needs none — an empty name is a real option rather than a
   * missing value, and `SidemenuNavLinks` keys such a group on its first item's id.
   */
  category_name: string;
  sub_options: SidemenuStructureSubOption<TIcon>[];
}

export type SidemenuStructure<TIcon extends string> = SidemenuStructureEntry<TIcon>[];

export type FormState = {
  message?: string;
  success: boolean;
  error?: string;
  /** Keyed by the field's dotted payload path. `error` stays the transport-level fallback: a 500 belongs to no field. */
  fieldErrors?: FieldErrors;
  /** Safe to echo back: it is the user's own input rather than a lookup result, so it reveals no registration. */
  submittedEmail?: string;
  /**
   * The backend's code for a failure a field can own; the form places the message, holding the payload it submitted. A
   * failure body carries nothing else (L4 in `docs/logging/spec.md`), and one code covers one rule, not one field.
   */
  errorCode?: string;
  /**
   * The `spiel_nr` of every other fixture a match write moved. Read by the edit page's live warning through
   * `dry_run=true` and by the undo toast; both are empty on an ordinary edit, which is what makes presence mean something.
   */
  voidedFixtures?: number[];
  releasedFixtures?: number[];
} | null;

/** Both members are Promises: a page destructuring them synchronously type-checks against an older shape and fails at request time. */
export type NextPageProps<TParams = Record<string, string | string[]>, TSearchParams = { [key: string]: string | string[] | undefined }> = {
  params: Promise<TParams>;
  searchParams: Promise<TSearchParams>;
};
