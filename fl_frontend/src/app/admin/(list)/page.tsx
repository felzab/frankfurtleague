import { connection } from "next/server";

import { ROUTES } from "@/core/routes";
import { getAdminSaisons } from "@/features/saisons/queries";
import { selectSaison } from "@/features/saisons/resolvers";
import { pageMetadata } from "@/shared/utils/metadata";

import { AdminOverview } from "./saisons/[saison]/page";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.admin, ROUTES.admin.path());
}

/**
 * The season the administration works in by standard, the one the frame's season button stands on, read at request
 * time; `null` while the league holds none. The read is the frame's own, so it costs the page no request of its own.
 */
async function readStandard(): Promise<string | null> {
  await connection();
  const { saisons } = await getAdminSaisons();
  return selectSaison(saisons)?.id ?? null;
}

/** `/admin`: the address a link uses where it cannot know the season, drawing that season's Übersicht in place. */
export default function AdminPage() {
  return <AdminOverview saison={readStandard()} />;
}
