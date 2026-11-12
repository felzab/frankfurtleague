import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ROUTES } from "@/core/routes";
import { getSaisonFrame } from "@/features/saisons/queries";

import type { SAISONLESS_PAGES } from "@/core/routes";

/**
 * The route handler of an address naming no season: one redirect to the page in the season the site is on, sent before
 * anything renders, so a visitor and a prefetching link alike learn the page they land on from the answer's status
 * line. A league holding no season yet has no such page, and its visitor lands on the landing.
 */
export function saisonlessRedirect(page: (typeof SAISONLESS_PAGES)[number]["page"]) {
  return async function GET(): Promise<never> {
    // The site's season is read per request, never at the build, which reaches no backend.
    await connection();
    const { active_saison_id: active } = await getSaisonFrame();
    redirect(active === null ? ROUTES.home.path() : ROUTES[page].path(active));
  };
}
