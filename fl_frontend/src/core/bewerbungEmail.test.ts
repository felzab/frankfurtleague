import { assert, describe, expect, it } from "vitest";

import type { FLBewerbungLinkData, FLBewerbungZusageData } from "./generated/client/types";

const { buildBewerbungBestaetigungEmail, buildBewerbungZusageEmail } = await import("./bewerbungEmail.ts");
const { renderMail } = await import("./emailShell.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const ZUSAGE: FLBewerbungZusageData = {
  art: "bewerbung_zusage",
  team: "Ernst-Reuter-Schule",
  saison_id: "2627",
  rollen: ["ansprechperson"],
  gruppe: "A",
  trikot_farbe: "hellgruen",
  wunschgegner: null,
};

const LINK: FLBewerbungLinkData = {
  art: "bewerbung_confirmation",
  saison_id: "2627",
  schule: "Ernst-Reuter-Schule",
  rollen: ["trainer"],
  frist: "2026-09-18",
};

describe("the acceptance's kit colour", () => {
  /* The colour sheet is the backend's slug alone: a mail naming the colour without its hex leaves neighbours such as
     Grün and Smaragd for a supplier to guess between. */
  it("states the assigned colour's name and its hex from the league's colour sheet", () => {
    const { text } = renderMail(buildBewerbungZusageEmail(ZUSAGE, { origin: ORIGIN }));

    assert.ok(text.includes("Trikotfarbe: Hellgrün (#75db06)"), "the mail lost the colour's name or its hex");
  });

  it("states that no colour is assigned yet rather than guessing one", () => {
    const { text } = renderMail(buildBewerbungZusageEmail({ ...ZUSAGE, trikot_farbe: null }, { origin: ORIGIN }));

    assert.ok(text.includes("Trikotfarbe: noch nicht festgelegt"), "the mail names a colour nobody assigned");
  });
});

describe("the confirmation link's mail", () => {
  /* A link built on the published origin sends a reader of the local stack into production. */
  it("builds the link on the origin it is handed, the token in it and nowhere else", () => {
    const { html, text } = renderMail(buildBewerbungBestaetigungEmail(LINK, { origin: ORIGIN, token: "beispiel-eins" }));

    assert.ok(text.includes(`${ORIGIN}/bestaetigung/kontakt?token=beispiel-eins`), "the link is built on another origin");
    // However often the shell prints the link, the token stands inside it each time and nowhere else.
    expect(html.split("beispiel-eins").length, "the token stands somewhere besides its link").toBe(html.split("?token=beispiel-eins").length);
  });

  /* The page asks the reader's own floor: a Trainer is asked from 16, a person holding a seat besides it from 18. */
  it("states the reader's own age floor, and never the other one", () => {
    const trainer = renderMail(buildBewerbungBestaetigungEmail(LINK, { origin: ORIGIN, token: "beispiel-eins" })).text;
    const zugleich = renderMail(
      buildBewerbungBestaetigungEmail({ ...LINK, rollen: ["ansprechperson", "trainer"] }, { origin: ORIGIN, token: "beispiel-eins" }),
    ).text;

    assert.ok(trainer.includes("mindestens 16 Jahre") && !trainer.includes("mindestens 18 Jahre"), "a Trainer is told another floor");
    assert.ok(zugleich.includes("mindestens 18 Jahre") && !zugleich.includes("mindestens 16 Jahre"), "a second seat's floor is missing");
  });
});
