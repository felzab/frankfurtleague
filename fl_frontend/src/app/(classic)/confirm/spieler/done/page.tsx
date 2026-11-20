import { ROUTES } from "@/core/routes";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

import { REGISTRIERUNG_CONFIRMED } from "../../ends";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierungConfirmationDone;
  return pageMetadata(parent, row, row.path(), { title: REGISTRIERUNG_CONFIRMED.title });
}

/**
 * `/confirm/spieler/done`, a pupil's confirmation's done state: the page the answer leads to once it is stored and the
 * link forgotten. It reads nothing and draws the confirmed card, so a reload shows that card again rather than the
 * forgotten link's.
 */
export default function RegistrierungConfirmedPage() {
  return <ClassicStatusPage {...REGISTRIERUNG_CONFIRMED} />;
}
