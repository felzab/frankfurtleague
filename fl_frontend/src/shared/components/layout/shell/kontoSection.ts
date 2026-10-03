import type { SidemenuHint } from "@/shared/types/types";

/**
 * What the bar reads over the account page, and what the control reaching it is called: one name
 * wherever the page is offered, whichever shell frames it.
 */
export const KONTO_SECTION = {
  label: "Konto",
  hint: {
    lead: "Deine Adresse, Deine Passkeys und wo Du gerade angemeldet bist.",
  },
} as const satisfies { label: string; hint: SidemenuHint };
