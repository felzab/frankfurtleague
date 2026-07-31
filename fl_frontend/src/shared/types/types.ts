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
export interface SidemenuStructureSubOption<TIcon extends string> {
  id: string;
  label: string;
  iconName: TIcon;
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
   * a rejected submit could only ever produce a toast that named nothing (R4 §3.1).
   */
  fieldErrors?: FieldErrors;
} | null;

/**
 * Bulletproof generic type for Next.js 15+ App Router Pages.
 * * @template TParams - Dynamic route parameters (e.g., folder `[id]`)
 * @template TSearchParams - URL query string (e.g., `?saison_id=2026`)
 */
export type NextPageProps<TParams = Record<string, string | string[]>, TSearchParams = { [key: string]: string | string[] | undefined }> = {
  params: Promise<TParams>;
  searchParams: Promise<TSearchParams>;
};
