import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

registerDoubles();

const { buildSpielerAdresswechselEmail, buildSpielerAdresswechselHinweisEmail } = await import("./spielerEmail.ts");

const LINK_DATEN = { origin: ORIGIN, token: "abc123", fristText: "05.10.2026" };
const HINWEIS_DATEN = { origin: ORIGIN, vorname: "Mira" };

/* `docs/frontend/spec.md :: I89`: these messages carry no column of facts, so every value the prose
   prints is folded by its builder or by nothing. */
describe("no value can open a line of its own in the text part", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;

  /** Each builder with the break in each value it prints, one value at a time. */
  const faelle = (): { name: string; mail: { subject: string; text: string } }[] => [
    { name: "the address link's fristText", mail: buildSpielerAdresswechselEmail({ ...LINK_DATEN, fristText: wert }) },
    { name: "the notice's vorname", mail: buildSpielerAdresswechselHinweisEmail({ ...HINWEIS_DATEN, vorname: wert }) },
  ];

  it("folds every value a message prints onto one line, in the text part and the subject", () => {
    for (const { name, mail } of faelle()) {
      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), `${name} forged a line`);
      // Folded, never dropped: the deadline and the name are what the reader acts on.
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), `${name} was not carried onto one line`);
      assert.ok(!/[\r\n]/.test(mail.subject), `${name} put a break in the subject`);
    }
  });
});
