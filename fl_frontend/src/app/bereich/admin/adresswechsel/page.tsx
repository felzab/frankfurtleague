import { connection } from "next/server";

import { AdminAdresswechselView } from "@/features/adresswechsel/components/views/AdminAdresswechselView";
import { getAdresswechselVerwaltungAnsicht } from "@/features/adresswechsel/queries";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { requireAdminRequest } from "@/shared/utils/adminRead";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminAdresswechselPage(props: NextPageProps) {
  // The builder stage has no reachable store, so a session read resolved at build time fails the image build.
  await connection();
  // It reads nothing without a change named, so it asks the check its first read would have asked (`docs/frontend/spec.md :: I122`).
  await requireAdminRequest();

  // A link from an editor, a reveal or the account page names a change by its id, never by an address: a URL is kept
  // by every log line the request passes.
  const { adresswechsel } = await props.searchParams;
  const id = CustomObjectIdStringSchema.safeParse(adresswechsel);

  return <AdminAdresswechselView anfang={id.success ? await getAdresswechselVerwaltungAnsicht(id.data) : null} />;
}
