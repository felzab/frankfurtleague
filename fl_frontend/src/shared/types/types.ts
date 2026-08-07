/**
 * SHARED · cross-slice types
 *
 * The three shapes more than one slice speaks: the sidemenu structure, the server-action result, and
 * the App Router page props. A type used by exactly one slice belongs in that slice's own `types.ts`.
 */

import type { FieldErrors } from "../utils/validation";

/**
 * Generic over the icon key so a structure and its icon dictionary cannot disagree.
 *
 * Each slice declares its dictionary `as const` in its own `constants.ts` and derives the key union
 * from it (`AdminIconName`, `DashboardIconName`), so a typo in either half is a compile error rather
 * than a nav item that silently renders with no icon.
 *
 * `TIcon` has **no default** on purpose. A default of `string` would let an unannotated structure
 * infer `TIcon = string`, at which point `Record<string, React.ElementType>` accepts any dictionary
 * at all, the lookup misses at runtime, and `SidemenuNavItem`'s truthiness guard swallows it —
 * producing exactly the silent missing icon this type exists to prevent. Requiring the argument
 * makes the guarantee structural rather than a convention.
 */
/**
 * What one route's info glyph says, in the two levels every one of them has.
 *
 * **The shape is the hierarchy**, rather than a paragraph list that each author structures their own
 * way: `lead` answers "what is this page" in one sentence, and each `points` entry names one thing on
 * it and then explains that thing. Rendered, the term is bold and the detail is not, so a reader
 * scans the terms and stops at the one they came for — which a run of equal-weight paragraphs cannot
 * support however well each is written.
 *
 * `points` is optional because a page with nothing to enumerate should not invent entries to fill a
 * shape; the lead alone is a complete hint.
 */
export interface SidemenuHint {
  /** One sentence: what the page is for. Never a list, never two sentences of setup. */
  lead: string;
  /** One entry per thing worth naming — a control, a state, a rule the page applies. */
  points?: readonly { term: string; detail: string }[];
  /** A closing caveat, for the one thing a reader would otherwise look for here and not find. */
  note?: string;
}

export interface SidemenuStructureSubOption<TIcon extends string> {
  id: string;
  label: string;
  iconName: TIcon;
  /**
   * What the route is for, shown behind the info glyph beside the shell's page title.
   *
   * **Required, so a new route cannot ship without one** — an optional field here would be filled in
   * for the first few entries and forgotten after that, and a hint that exists on five pages out of
   * twelve is worse than none, because its absence then reads as "this page has nothing to explain".
   */
  hint: SidemenuHint;
}

export interface SidemenuStructureEntry<TIcon extends string> {
  category_name: string;
  sub_options: SidemenuStructureSubOption<TIcon>[];
}

export type SidemenuStructure<TIcon extends string> = SidemenuStructureEntry<TIcon>[];

export type FormState = {
  message?: string;
  success: boolean;
  error?: string;
  /**
   * Per-field validation messages, keyed by the field's dotted payload path. `error` stays the
   * transport-level fallback — a network failure or a 500 belongs to no field. Without this channel
   * a rejected submit could only ever produce a toast that named nothing.
   */
  fieldErrors?: FieldErrors;
  /**
   * Echoes an address the user just typed, so a confirmation screen can show it back. Safe to
   * return: it is their own input, not a lookup result, so it reveals nothing about who is
   * registered.
   */
  submittedEmail?: string;
  /**
   * The backend's own error code for a failure a FIELD can own, where the form is what knows which
   * field.
   *
   * A failure body is `{error_code, correlation_id}` and nothing else (`docs/logging.md`, L4), so the
   * code is the only channel a refusal has — and one code per rule is what the code table's own rule
   * asks for, since "team1 is disqualified" and "team2 is disqualified" are one failure mode. The
   * form places the message, because it holds the payload it submitted and the same team data the
   * picker derives its chips from (ADR-0052). Absent on every failure no field could own.
   */
  errorCode?: string;
  /**
   * The `spiel_nr` of every OTHER fixture a match write moved: those whose stored result it destroyed,
   * and those a team was released from (ADR-0051, ADR-0052).
   *
   * Read by the edit page's live warning, which asks for them through `dry_run=true` before a save,
   * and by the undo toast, which needs to know which fixtures to put back. Both empty on the ordinary
   * edit, which is what makes their presence meaningful.
   */
  voidedFixtures?: number[];
  releasedFixtures?: number[];
} | null;

/**
 * Both members are Promises because App Router route props are async from Next 15 onwards — a page
 * that destructures them synchronously type-checks against an older shape and fails at request time.
 */
export type NextPageProps<TParams = Record<string, string | string[]>, TSearchParams = { [key: string]: string | string[] | undefined }> = {
  params: Promise<TParams>;
  searchParams: Promise<TSearchParams>;
};
