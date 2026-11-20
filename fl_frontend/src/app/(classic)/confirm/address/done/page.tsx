import { ROUTES } from "@/core/routes";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

import { endOfDone } from "../ends";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/confirm/address/done">;

export async function generateMetadata({ searchParams }: Pick<Props, "searchParams">, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.addressChangeDone;
  return pageMetadata(parent, row, row.path(), { title: (await endOfDone(searchParams)).title });
}

/**
 * `/confirm/address/done`, an address change's done state: the page either link's answer or the stop leads to once it
 * is stored and the link forgotten, the end its address names. It reads nothing else, so a reload shows that card again
 * rather than the forgotten link's.
 */
export default async function AddressChangeDonePage({ searchParams }: Props) {
  return <ClassicStatusPage {...await endOfDone(searchParams)} />;
}
