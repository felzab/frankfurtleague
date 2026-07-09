export interface SidemenuStructureSubOption {
  id: string;
  label: string;
}

export interface SidemenuStructureEntry {
  category_name: string;
  sub_options: SidemenuStructureSubOption[];
}

export type SidemenuStructure = SidemenuStructureEntry[];

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
