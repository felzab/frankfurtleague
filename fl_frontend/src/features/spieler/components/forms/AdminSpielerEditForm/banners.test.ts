import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON } from "../../../constants.ts";
import { buildSpielerBanners } from "./banners.ts";

import type { SpielerBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielerBanners>[0]> = {}): readonly SpielerBanner[] =>
  buildSpielerBanners({
    isRetired: false,
    saisonId: "2026",
    saisonStatus: "future",
    isMember: true,
    rowInactiveSince: null,
    isRowTeamInSaison: true,
    isNachgetragen: false,
    isTeamChanged: false,
    blockedRolle: null,
    ...overrides,
  });

const ids = (banners: readonly SpielerBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielerBanners", () => {
  it("raises nothing for a settled squad row with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  /* One shape across the four retirable editors: the title names the exclusion, the body names what
     survives, and the way back is the header's own control rather than a sentence pointing at it. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.ok(!/Reaktivieren/.test(banner?.body ?? ""));
  });

  it("offers the entry remedy for a player no squad holds", () => {
    const [banner] = build({ isMember: false });

    assert.equal(banner?.id, "spieler.not-in-kader-entry");
    assert.match(banner?.title ?? "", /Saison 2026/);
  });

  it("dates the retirement of the squad row in its title", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12" });

    assert.equal(banner?.id, "spieler.row-retired-since");
    assert.match(banner?.title ?? "", /12\.03\.2026/);
  });

  /* The banner sits directly above the reactivate button, which reads the row's STORED club — so a
     replacement having taken that club out of the season is what turns the promise into a refusal. */
  it("promises the values back only while the row's club still stands in the season", () => {
    const [kept] = build({ rowInactiveSince: "2026-03-12" });
    const [gone] = build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false });

    assert.match(kept?.body ?? "", /kehren beim Reaktivieren zurück/, "the settled arm stopped saying the values come back");
    assert.doesNotMatch(gone?.body ?? "", /kehren beim Reaktivieren zurück/, "the blocked arm promises a return the endpoint refuses");
    assert.ok((gone?.body ?? "").includes(REACTIVATION_NEEDS_A_TEAM_IN_SAISON), "the blocked arm names no repair");
  });

  /* `info` and not `warning`: nothing this save destroys, and a `warning` would route every save of
     the player through `ConfirmSaveModal` for a state the form did not cause. */
  it("leaves the blocked arm an info", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false });

    assert.equal(banner?.id, "spieler.row-retired-since");
    assert.equal(banner?.severity, "info");
  });

  it("announces the derived nachgetragen flag only where there is no row to enter into yet", () => {
    // Titles alone: why the flag is set is the season's status, which the page already shows.
    assert.equal(build({ isMember: false, saisonStatus: "active" }).find(({ id }) => id === "spieler.entry-nachgetragen")?.body, undefined);
    assert.equal(build({ isNachgetragen: true }).find(({ id }) => id === "spieler.nachgetragen")?.body, undefined);
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ isMember: false, saisonStatus: "future" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
  });

  it("grades a transfer as a warning", () => {
    const [banner] = build({ isTeamChanged: true });

    assert.equal(banner?.id, "spieler.team-changed");
    assert.equal(banner?.severity, "warning");
  });

  it("names the role and its holder where the draft team has already given it away", () => {
    const banners = build({ blockedRolle: { label: "Kapitän", heldBy: "Jonas Weber" } });

    assert.deepEqual(ids(banners), ["spieler.rolle-vergeben"]);
    assert.match(banners[0]?.title ?? "", /Kapitän/);
    assert.match(banners[0]?.body ?? "", /Jonas Weber/);
  });

  // `info`, so it never raises the save dialog: the control is unavailable, which leaves the reader
  // nothing to confirm.
  it("raises no save confirmation for a blocked role", () => {
    assert.equal(build({ blockedRolle: { label: "Co-Kapitän", heldBy: "Nils Kraus" } })[0]?.severity, "info");
  });
});
