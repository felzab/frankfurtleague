import { refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapSpielberichtRefusal } from "./utils.ts";

describe("a write composed on a report that has changed since", () => {
  /* The reload draws the form anew, so the referee is told to enter the change again. */
  it("tells the referee to reload and enter the change again", () => {
    expect(mapSpielberichtRefusal(refused("bericht_meanwhile_changed"))?.error ?? "").toMatch(
      /^Der Spielbericht wurde inzwischen geändert.*Lade die Seite neu und trage Deine Änderung dort erneut ein\.$/,
    );
  });
});

describe("a referee's write on a fixture called off since the page opened", () => {
  /* A report may stand from before the call-off, so the refusal says the fixture takes none, never that none exists, and
     sends the referee to the reload that shows the fixture as it is. */
  it("says the fixture takes no report, and how to see it as it stands", () => {
    const answer = mapSpielberichtRefusal(refused("bericht_abgesagt"));

    expect(answer?.error).toBe(
      "Dieses Spiel ist inzwischen als ausgefallen oder annulliert eingetragen und nimmt keinen Spielbericht an. Lade die Seite neu.",
    );
  });
});
