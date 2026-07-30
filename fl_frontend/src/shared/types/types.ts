/**
 * Generic over the icon key so a structure and its icon dictionary cannot disagree.
 *
 * Each slice declares its dictionary `as const` in its own `constants.ts` and derives the key union
 * from it (`AdminIconName`, `DashboardIconName`), so a typo in either half is a compile error rather
 * than a nav item that silently renders with no icon. The default `string` keeps the types usable
 * for any caller that has not opted in.
 */
export interface SidemenuStructureSubOption<TIcon extends string = string> {
  id: string;
  label: string;
  iconName: TIcon;
}

export interface SidemenuStructureEntry<TIcon extends string = string> {
  category_name: string;
  sub_options: SidemenuStructureSubOption<TIcon>[];
}

export type SidemenuStructure<TIcon extends string = string> = SidemenuStructureEntry<TIcon>[];

export type FormState = {
  message?: string;
  success: boolean;
  error?: string;
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
