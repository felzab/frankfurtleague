/**
 * The brand ink grade for a standalone control — a toggle, a row's action — which
 * `fl_frontend/src/shared/components/ui/textLink.ts :: textLink` cannot serve: its base underlines
 * for every caller (`docs/frontend/spec.md :: I43`), and neither of those is a link inside text.
 */
export const BRAND_INK = "text-brand transition-colors hover:text-brand-solid dark:hover:text-brand-solid-accent";
