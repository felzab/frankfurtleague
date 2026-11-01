import { doubleToasts } from "@/test-support/actionDoubles.ts";
import { afterEach, describe, expect, it } from "vitest";

import { ANTWORT_UNKLAR } from "./publicSubmit.ts";

/* The real module hands its raising to HeroUI's queue rather than back to the caller. */
const { raised } = doubleToasts();

/* After the double: a static import would bind the real toast module first. */
const { reportRefusedConfirmation } = await import("./linkConfirmation.ts");

afterEach(() => {
  raised.length = 0;
});

/** What each arm was handed, in the order the helper handed it. */
function drive(antwort: Parameters<typeof reportRefusedConfirmation<string>>[0]): string[] {
  const seen: string[] = [];
  reportRefusedConfirmation(antwort, {
    onZustand: (state) => seen.push(`zustand:${state}`),
    onRefusal: () => seen.push("refusal"),
  });

  return seen;
}

describe("reportRefusedConfirmation", () => {
  /* The envelope's own sentence is an administrator's repair; the visitor's is to reopen the link. */
  it("titles an answer of unknown outcome as unread, over the reopen sentence, and hands neither arm", () => {
    const seen = drive({ success: false, outcome: "unknown", error: "Ob es gespeichert wurde, ist unklar.", zustand: "verbraucht" });

    expect(seen).toStrictEqual([]);
    expect(raised.map(({ variant, title, description }) => [variant, title, description])).toStrictEqual([
      ["danger", "Unklar, ob es bei uns angekommen ist", ANTWORT_UNKLAR],
    ]);
  });

  it("hands a link that died between the open and the press to its panel, raising nothing", () => {
    const seen = drive({ success: false, error: "Der Link ist abgelaufen.", zustand: "abgelaufen" });

    expect(seen).toStrictEqual(["zustand:abgelaufen"]);
    expect(raised).toStrictEqual([]);
  });

  it("leaves every other refusal to the form's own raising", () => {
    const seen = drive({ success: false, error: "Deine Antwort wurde nicht gespeichert." });

    expect(seen).toStrictEqual(["refusal"]);
    expect(raised).toStrictEqual([]);
  });
});
