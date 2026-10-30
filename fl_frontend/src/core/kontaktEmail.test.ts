import { describe, expect, it } from "vitest";

import type { FLKontaktLinkData } from "./generated/client/types.ts";

const { mailFor } = await import("./mailKinds.ts");
const { renderMail } = await import("./emailShell.ts");
const { kontaktBestaetigungsLink } = await import("./kontaktLink.ts");

const ORIGIN = "http://localhost:3000";

/** One person's link as a contacts save owes it, on an open row unless `row` names a closed one. */
const daten = (row: FLKontaktLinkData["row"] = "open", rollen: FLKontaktLinkData["rollen"] = ["ansprechperson"]) =>
  ({ art: "kontakt_confirmation", saison_id: "2627", schule: "Lessing-Kolleg", rollen, frist: "2026-10-17", row }) as const;

const rendered = (facts: ReturnType<typeof daten>) => {
  const mail = mailFor("kontakt_confirmation", facts, { token: "beispiel-eins", secret: null, origin: ORIGIN });
  if (mail === undefined) throw new Error("the kind has no builder");

  return { mail, text: renderMail(mail).text };
};

describe("a season row's contact link", () => {
  it("asks a person seated on an open row to confirm, through its own token on the serving origin", () => {
    const { mail, text } = rendered(daten());

    expect(text).toMatch(/Bitte bestätige, dass das stimmt:/);
    expect(mail.button).toStrictEqual({ label: "Eintrag bestätigen", href: kontaktBestaetigungsLink(ORIGIN, "beispiel-eins") });
  });

  /* A closed row's link takes the Widerspruch alone, so its mail asks no confirmation the page would then refuse. */
  for (const [row, grund] of [
    ["saison_past", /Die Saison ist vorbei/],
    ["ausgetreten", /Das Team spielt in dieser Saison nicht mehr mit/],
  ] as const) {
    it(`asks a person seated on a row that is ${row} for the Widerspruch alone`, () => {
      const { mail, text } = rendered(daten(row));

      expect(text).toMatch(grund);
      expect(text).not.toMatch(/Bitte bestätige/);
      expect(mail.button).toStrictEqual({ label: "Zum Eintrag", href: kontaktBestaetigungsLink(ORIGIN, "beispiel-eins") });
    });
  }

  it("names every seat the one person holds, in the seats' own order", () => {
    expect(rendered(daten("open", ["trainer", "ansprechperson"])).mail.subjectLine).toMatch(
      /^Du bist als Ansprechperson und Trainerin oder Trainer für Lessing-Kolleg eingetragen$/,
    );
  });
});
