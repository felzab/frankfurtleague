import { assert, describe, expect, it } from "vitest";

import type { FLBewerbungLinkData, FLBewerbungZusageData } from "./generated/client/types";

const { buildBewerbungConfirmationEmail, buildBewerbungZusageEmail } = await import("./bewerbungEmail.ts");
const { renderMail } = await import("./emailShell.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

const ZUSAGE: FLBewerbungZusageData = {
  kind: "bewerbung_zusage",
  team: "Ernst-Reuter-Schule",
  shorthand: "ERS",
  saison_id: "2627",
  rollen: ["ansprechperson"],
  gruppe: "A",
  trikot_farbe: "hellgruen",
};

const LINK: FLBewerbungLinkData = {
  kind: "bewerbung_confirmation",
  saison_id: "2627",
  schule: "Ernst-Reuter-Schule",
  rollen: ["trainer"],
  deadline: "2026-09-18",
};

describe("the acceptance's kit colour", () => {
  /* The colour sheet is the backend's slug alone: a mail naming the colour without its hex leaves neighbours such as
     Grün and Smaragd for a supplier to guess between. */
  it("states the assigned colour's name and its hex from the league's colour sheet", () => {
    const { text } = renderMail(buildBewerbungZusageEmail(ZUSAGE, { origin: ORIGIN }));

    assert.ok(text.includes("Trikotfarbe: Hellgrün (#75db06)"), "the mail lost the colour's name or its hex");
  });

  /* No later mail names a colour set after the Zusage, so a sentence saying one follows is a promise nobody keeps. */
  it("promises nothing where no colour is assigned", () => {
    const { text } = renderMail(buildBewerbungZusageEmail({ ...ZUSAGE, trikot_farbe: null }, { origin: ORIGIN }));

    expect(text).not.toMatch(/noch|später|bekommst|teilen wir|schicken wir|meldet sich|folgt/);
  });
});

describe("the confirmation link's mail", () => {
  /* A link built on the published origin sends a reader of the local stack into production. */
  it("builds the link on the origin it is handed, the token in it and nowhere else", () => {
    const { html, text } = renderMail(buildBewerbungConfirmationEmail(LINK, { origin: ORIGIN, token: "example-one" }));

    assert.ok(text.includes(`${ORIGIN}/confirm/kontakt?token=example-one`), "the link is built on another origin");
    // However often the shell prints the link, the token stands inside it each time and nowhere else.
    expect(html.split("example-one").length, "the token stands somewhere besides its link").toBe(html.split("?token=example-one").length);
  });
});
