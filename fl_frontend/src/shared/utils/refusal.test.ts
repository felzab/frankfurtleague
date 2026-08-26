import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRefusal, UNKNOWN_REFUSAL } from "./refusal.ts";

describe("buildRefusal", () => {
  it("writes the reason first and the way out second, each its own sentence", () => {
    const built = buildRefusal({ reason: "Der Spielort wurde nicht angelegt", repair: "Versuche es erneut" });

    assert.equal(built, "Der Spielort wurde nicht angelegt. Versuche es erneut.");
  });

  it("frames the surface holding the repair, so no call site pairs an article with a heading", () => {
    const built = buildRefusal({ reason: "Aus diesen Regeln entsteht keine KO-Runde", repair: "Ändere die Zahlen", where: "Regeln" });

    assert.equal(built, "Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen unter „Regeln“.");
  });

  it("puts no dash anywhere, whatever its parts hold", () => {
    // `docs/frontend/spec.md` §1.12: no dash is punctuation, and the gate reads only the literals a
    // call site wrote — never the string this assembles from them.
    const built = buildRefusal({ reason: "Nichts wurde gespeichert", repair: "Melde Dich neu an", where: "Konto" });

    assert.doesNotMatch(built, /[—–]|\s-\s/);
  });
});

describe("UNKNOWN_REFUSAL", () => {
  it("names a way out and no cause, its callers having none to name", () => {
    assert.match(UNKNOWN_REFUSAL, /^[^.]+\.$/, "the cause-less refusal is one sentence");
    assert.match(UNKNOWN_REFUSAL, /neu|erneut/);
  });
});
