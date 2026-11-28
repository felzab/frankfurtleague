import { ROUTES } from "@/core/routes";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

import { entryEndOf } from "../../ends";

import type { Metadata } from "next";

type Props = PageProps<"/confirm/kontakt/done">;

export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">): Promise<Metadata> {
  return pageMetadata(ROUTES.kontaktConfirmationDone, { title: (await entryEndOf(searchParams)).title });
}

/**
 * `/confirm/kontakt/done`, a contact's answer's done state: the page the answer leads to once it is stored and the link
 * forgotten, the confirmation's card or, where the address says so, the objection's. It reads nothing else, so a reload
 * shows that card again rather than the forgotten link's.
 */
export default async function KontaktConfirmedPage({ searchParams }: Props) {
  return <ClassicStatusPage {...await entryEndOf(searchParams)} />;
}
