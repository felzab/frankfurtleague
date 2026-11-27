import { ROUTES } from "@/core/routes";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

import { REGISTRIERUNG_CONFIRMED, registrierungEndOf } from "../../ends";

type Props = PageProps<"/confirm/spieler/done">;

export const metadata = pageMetadata(ROUTES.registrierungConfirmationDone, { title: REGISTRIERUNG_CONFIRMED.title });

/**
 * `/confirm/spieler/done`, a pupil's confirmation's done state: the page the answer leads to once it is stored and the
 * link forgotten, the confirmed card, which says the earlier choices stand where the address says another tab or
 * device confirmed first. It reads nothing else, so a reload shows that card again rather than the forgotten link's.
 */
export default async function RegistrierungConfirmedPage({ searchParams }: Props) {
  return <ClassicStatusPage {...await registrierungEndOf(searchParams)} />;
}
