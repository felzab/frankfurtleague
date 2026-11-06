// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { assert, describe, expect, it } from "vitest";

import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "../../../constants.ts";
import { buildSpielerBanners } from "./banners.ts";

import type { SpielerBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielerBanners>[0]> = {}): readonly SpielerBanner[] =>
  buildSpielerBanners({
    saisonId: "2026",
    rowInactiveSince: null,
    isRowTeamInSaison: true,
    istNachnominiert: false,
    blockedRolle: null,
    ...overrides,
  });

const ids = (banners: readonly SpielerBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielerBanners", () => {
  it("raises nothing for a settled squad row with no pending edit", () => {
    expect(ids(build())).toStrictEqual([]);
  });

  /* A pupil can be a girl and this slice's consent panel already writes both forms, so a masculine
     word here is wrong about half the league. Title and body together: one recast leaves an entry
     disagreeing with itself. */
  it("names the pupil neutrally in every banner that stands for the person", () => {
    const maskulin = /\bdieser spieler\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;
    const genannt: string[] = [];

    for (const [id, raised] of [["spieler.nachnominiert", build({ istNachnominiert: true })]] as const) {
      const banner = raised.find((candidate) => candidate.id === id);

      assert.ok(banner !== undefined, `${id} is no longer raised, so this case judges nothing`);
      assert.ok(banner.body !== undefined, `${id} carries no body, so half of this case judges nothing`);
      if (maskulin.test(banner.title)) genannt.push(`${id}: title`);
      if (maskulin.test(banner.body)) genannt.push(`${id}: body`);
    }

    expect(genannt, "a banner names the pupil with a masculine word").toStrictEqual([]);
  });

  it("dates the retirement of the squad row in its title", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12" });

    expect(banner?.id).toBe("spieler.row-retired-since");
    expect(banner?.title ?? "").toMatch(/12\.03\.2026/);
  });

  /* The banner sits directly above the reactivate button, which reads the row's STORED club — so a
     replacement having taken that club out of the season is what turns the promise into a refusal. */
  it("promises the values back only while the row's club still stands in the season", () => {
    const [kept] = build({ rowInactiveSince: "2026-03-12" });
    const [gone] = build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false });

    expect(kept?.body ?? "", "the settled arm stopped saying the values come back").toMatch(/kehren beim Reaktivieren zurück/);
    expect(gone?.body ?? "", "the blocked arm promises a return the endpoint refuses").not.toMatch(/kehren beim Reaktivieren zurück/);
    assert.ok((gone?.body ?? "").includes(REACTIVATION_NEEDS_A_TEAM_IN_SAISON), "the blocked arm names no repair");
  });

  /* `info` and not `warning`: nothing this save destroys. Keeping it out of `ConfirmSaveModal` is
     `raisedBy: "state"`'s job below, so the colour answers only how gravely the row reads. */
  it("leaves the blocked arm an info", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false });

    expect(banner?.id).toBe("spieler.row-retired-since");
    expect(banner?.severity).toBe("info");
  });

  it("names the role and its holder where the draft team has already given it away", () => {
    const banners = build({ blockedRolle: { label: "Kapitän", heldBy: "Jonas Weber" } });

    expect(ids(banners)).toStrictEqual(["spieler.rolle-vergeben"]);
    expect(banners[0]?.title ?? "").toMatch(/Kapitän/);
    expect(banners[0]?.body ?? "").toMatch(/Jonas Weber/);
  });

  // `info`, so it never raises the save dialog: the control is unavailable, which leaves the reader
  // nothing to confirm.
  it("raises no save confirmation for a blocked role", () => {
    expect(build({ blockedRolle: { label: "Co-Kapitän", heldBy: "Nils Kraus" } })[0]?.severity).toBe("info");
  });

  /* Neither is this save's doing: the flag is the stored row's, derived by the backend at entry, and
     the role is one another squad row already holds. */
  it("classifies the nachnominiert flag and a taken role as state", () => {
    expect(build({ istNachnominiert: true })[0]?.raisedBy).toBe("state");
    expect(build({ blockedRolle: { label: "Kapitän", heldBy: "Jonas Weber" } })[0]?.raisedBy).toBe("state");
  });
});
