import { getSaisons } from "@/features/saisons/queries";

/**
 * The season a URL naming none resolves to.
 *
 * Read for the canonical alone: what a page fetches is `resolveSaisonId`'s answer, and this decides
 * only whether the address a crawler is handed carries the id.
 */
export async function runningSaisonId(): Promise<string | undefined> {
  const { saisons } = await getSaisons();

  return saisons.find((saison) => saison.status === "active")?.id;
}
