// Redesign: goes with its last importer.
import "server-only";

import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen";

import type { LinkVersand } from "@/shared/utils/linkVersand";

/** What the administrator is told about the message their write sent, in the words `describeBewerbungMail` uses for a fan-out. */
export function describeLinkMail(email: string, versand: LinkVersand): string {
  if (versand === "gesendet") return `Der Bestätigungslink ging an ${email}.`;
  if (versand === "zurueckgehalten") return ZURUECKGEHALTEN;
  // Naming no address, as every barred send's report names none.
  if (versand === "gesperrt") return "Der Bestätigungslink ging nicht raus, weil die Adresse auf der Sperrliste steht.";

  return `Der Bestätigungslink konnte nicht an ${email} verschickt werden. Melde Dich selbst bei der Person.`;
}
