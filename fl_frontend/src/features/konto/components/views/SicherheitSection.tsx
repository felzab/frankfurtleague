import { getKontoSession } from "@/shared/utils/kontoMutation";

import { readSicherheit } from "../../sicherheit";
import { SicherheitPanel } from "./SicherheitPanel";

/**
 * The section the account page hands `KontoPanel`, read on the server. Nothing for a session the
 * account's own guard refuses, an administrator's address signed in by mail alone among them: its
 * passkeys and sign-ins are the administrator's lane's to manage.
 */
export async function SicherheitSection() {
  const served = await getKontoSession();
  if (served === null) return null;

  return <SicherheitPanel sicherheit={await readSicherheit(served)} />;
}
