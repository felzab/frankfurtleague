import { describe, expect, it } from "vitest";

import { beschreibeNachweis } from "./nachweis.ts";

describe("the act a consent choice is read back with", () => {
  /* The account page moves one choice and leaves the confirmation's day standing, so the choice's own act is what an
     administrator must read beside it. */
  it("names the choice's own act, in Berlin time, over the confirmation's", () => {
    const sentence = beschreibeNachweis(
      { am: "2026-10-03T22:30:00Z", text_version: "2026-11-name-kader-1", given_before: null },
      { am: "2026-03-14" },
    );

    expect(sentence).toBe("seit 04.10.2026, 00:30 Uhr, Fassung 2026-11-name-kader-1");
  });

  it("names the grant a withdrawal ended beside the withdrawal", () => {
    const sentence = beschreibeNachweis(
      {
        am: "2026-10-04T08:00:00Z",
        text_version: "2026-11-medien-1",
        given_before: { am: "2026-09-01T10:00:00Z", text_version: "2026-11-medien-1" },
      },
      { am: "2026-03-14" },
    );

    expect(sentence).toBe(
      "seit 04.10.2026, 10:00 Uhr, Fassung 2026-11-medien-1 (zuvor erteilt am 01.09.2026, 12:00 Uhr, Fassung 2026-11-medien-1)",
    );
  });

  it("claims no act for a choice on a record nobody has confirmed", () => {
    expect(beschreibeNachweis(null, null)).toBe("Nicht bestätigt");
  });

  /* A contact seat confirmed before choices carried their own evidence is kept with its confirmation's day as its whole
     proof: „Nicht bestätigt“ under it would contradict the confirmation read out above. */
  it("reads a confirmed record's choice with no evidence of its own as standing on the confirmation", () => {
    expect(beschreibeNachweis(null, { am: "2026-03-14" })).toBe("seit der Bestätigung am 14.03.2026");
  });

  /* The read model refuses no stored instant, so one it cannot read arrives here rather than failing. */
  it("keeps an unreadable instant as stored rather than failing the panel", () => {
    expect(beschreibeNachweis({ am: "kaputt", text_version: "2026-11-medien-1", given_before: null }, { am: "2026-03-14" })).toBe(
      "seit kaputt, Fassung 2026-11-medien-1",
    );
  });
});
