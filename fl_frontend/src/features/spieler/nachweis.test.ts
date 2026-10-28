import { describe, expect, it } from "vitest";

import { beschreibeNachweis, medienBestaetigungOf } from "./nachweis.ts";

describe("the act a consent choice is read back with", () => {
  /* The account page moves one choice and leaves the confirmation's day and label standing, so the
     choice's own act is what an administrator must read beside it. */
  it("names the choice's own act, in Berlin time, over the confirmation's", () => {
    const satz = beschreibeNachweis(
      { am: "2026-10-03T22:30:00Z", text_version: "2026-10-konto-spieler", erteilt_zuvor: null },
      { am: "2026-03-14", textVersion: "1", gefragt: true },
    );

    expect(satz).toBe("seit 04.10.2026, 00:30 Uhr, Fassung 2026-10-konto-spieler");
  });

  it("names the grant a withdrawal ended beside the withdrawal", () => {
    const satz = beschreibeNachweis(
      {
        am: "2026-10-04T08:00:00Z",
        text_version: "2026-10-konto-spieler",
        erteilt_zuvor: { am: "2026-09-01T10:00:00Z", text_version: "2026-10-spielerseite-5" },
      },
      { am: "2026-03-14", textVersion: "1", gefragt: true },
    );

    expect(satz).toBe(
      "seit 04.10.2026, 10:00 Uhr, Fassung 2026-10-konto-spieler (zuvor erteilt am 01.09.2026, 12:00 Uhr, Fassung 2026-10-spielerseite-5)",
    );
  });

  it("claims no act for a choice on a record nobody has confirmed", () => {
    expect(beschreibeNachweis(null, null)).toBe("Nicht bestätigt");
  });

  /* A contact seat confirmed before choices carried their own evidence is kept with its confirmation's day and label as
     its whole proof: „Nicht bestätigt“ under it would contradict the confirmation read out above. */
  it("reads a confirmed record's choice with no evidence of its own as standing on the confirmation", () => {
    expect(beschreibeNachweis(null, { am: "2026-03-14", textVersion: "1", gefragt: true })).toBe(
      "seit der Bestätigung am 14.03.2026, Fassung 1",
    );
  });

  /* A seat kept from a contact page that never asked the media choice holds a value the server wrote: the confirmation
     is no act of the person's for it. */
  it("reads a choice the confirmation's page never asked as not asked, never as standing on it", () => {
    expect(beschreibeNachweis(null, { am: "2026-09-20", textVersion: "2026-09-bestaetigungsseite-6", gefragt: false })).toBe(
      "Bei der Bestätigung am 20.09.2026 nicht gefragt (Fassung 2026-09-bestaetigungsseite-6)",
    );
  });

  /* Where the label's words could not be read, nobody knows whether its page asked: the readout claims neither. */
  it("says nobody checked where the confirmation's page could not be read", () => {
    expect(beschreibeNachweis(null, { am: "2026-09-20", textVersion: "x", gefragt: null })).toBe(
      "Bestätigt am 20.09.2026 (Fassung x), nicht geprüft, ob dabei gefragt",
    );
  });

  /* The question is the confirmed label's, as the page read it off the registry; a label it holds no answer for is
     unchecked rather than asked. */
  it("takes whether a seat's media choice was asked off its confirmed label", () => {
    const seat = (textVersion: string, bestaetigtAm: string | null) => ({ bestaetigt_am: bestaetigtAm, text_version: textVersion });
    const fragen = { vor: false, nach: true };

    expect(medienBestaetigungOf(seat("vor", "2026-09-20"), fragen)?.gefragt).toBe(false);
    expect(medienBestaetigungOf(seat("nach", "2026-10-19"), fragen)?.gefragt).toBe(true);
    expect(medienBestaetigungOf(seat("unbekannt", "2026-10-19"), fragen)?.gefragt).toBe(null);
    expect(medienBestaetigungOf(seat("vor", null), fragen)).toBe(null);
  });

  /* The read model refuses no stored value, so an instant it cannot read arrives here rather than failing. */
  it("keeps an unreadable instant as stored rather than failing the panel", () => {
    expect(
      beschreibeNachweis({ am: "kaputt", text_version: "x", erteilt_zuvor: null }, { am: "2026-03-14", textVersion: "1", gefragt: true }),
    ).toBe("seit kaputt, Fassung x");
  });
});
