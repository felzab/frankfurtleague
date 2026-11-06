import { describe, expect, it } from "vitest";

import { COPY } from "./copy.ts";

import type { FLKontaktLinkData, FLKontaktRow } from "./generated/client/types.ts";

const { mailFor } = await import("./mailKinds.ts");
const { renderMail } = await import("./emailShell.ts");
const { kontaktBestaetigungsLink } = await import("./kontaktLink.ts");
const { SERVER_COPY } = await import("./serverCopy.ts");

const ORIGIN = "http://localhost:3000";

/** One person's link as a contacts save owes it, on an open row unless `row` names a closed one. */
const data = (row: FLKontaktRow = "open", rollen: FLKontaktLinkData["rollen"] = ["ansprechperson"]) =>
  ({ kind: "kontakt_confirmation", saison_id: "2627", schule: "Lessing-Kolleg", rollen, deadline: "2026-10-17", row }) as const;

const rendered = (facts: ReturnType<typeof data>) => {
  const mail = mailFor("kontakt_confirmation", facts, { token: "beispiel-eins", secret: null, origin: ORIGIN });
  if (mail === undefined) throw new Error("the kind has no builder");

  return { mail, text: renderMail(mail).text };
};

describe("a season row's contact link", () => {
  it("asks a person seated on an open row to confirm, through its own token on the serving origin", () => {
    const { mail, text } = rendered(data());

    expect(text).toContain(SERVER_COPY.mail.bewerbung.confirmOrOppose);
    expect(mail.button).toStrictEqual({ label: COPY.page.entryConfirmation, href: kontaktBestaetigungsLink(ORIGIN, "beispiel-eins") });
  });

  /* A closed row's link takes the Widerspruch alone, so its mail asks no confirmation the page would then refuse. */
  it.each(["saison_past", "ausgetreten"] as const)("asks a person seated on a row that is %s for the Widerspruch alone", (row) => {
    const { mail, text } = rendered(data(row));

    expect(text).not.toContain(SERVER_COPY.mail.bewerbung.confirmOrOppose);
    expect(mail.button).toStrictEqual({ label: SERVER_COPY.mail.kontakt.toEntry, href: kontaktBestaetigungsLink(ORIGIN, "beispiel-eins") });
  });
});
