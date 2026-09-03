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

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.match(banner?.body ?? "", /Plätze im Kader bleiben erhalten/, "the body stopped naming what survives");
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
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

  /* `info` and not `warning`: nothing this save destroys. Keeping it out of `ConfirmSaveModal` is
     `raisedBy: "state"`'s job below, so the colour answers only how gravely the row reads. */
  it("leaves the blocked arm an info", () => {
    const [banner] = build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false });

    assert.equal(banner?.id, "spieler.row-retired-since");
    assert.equal(banner?.severity, "info");
  });

  it("announces the derived nachgetragen flag only where there is no row to enter into yet", () => {
    /* Both name the player, and both spell the word out: „nachgetragen“ is what the player list
       spells back as a badge, and no surface but this one says what it means. */
    const entering = build({ isMember: false, saisonStatus: "active" }).find(({ id }) => id === "spieler.entry-nachgetragen");
    const standing = build({ isNachgetragen: true }).find(({ id }) => id === "spieler.nachgetragen");

    assert.match(entering?.title ?? "", /Dieser Spieler wird nachgetragen/);
    assert.match(standing?.title ?? "", /Dieser Spieler wurde nachgetragen/);
    assert.match(entering?.body ?? "", /Zu Beginn der Saison war er nicht im Kader/);
    assert.match(standing?.body ?? "", /Zu Beginn der Saison war er nicht im Kader/);
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ isMember: false, saisonStatus: "future" })).includes("spieler.entry-nachgetragen"));
    assert.ok(!ids(build({ saisonStatus: "active" })).includes("spieler.entry-nachgetragen"));
  });

  /* Dictated copy, so both lines are pinned literally rather than by a loosened pattern: a sweep
     re-deriving either of them from the copy rules is what this test is here to fail. */
  it("grades a transfer as a warning and names the timing over the move it makes", () => {
    const [banner] = build({ isTeamChanged: true });

    assert.equal(banner?.id, "spieler.team-changed");
    assert.equal(banner?.severity, "warning");
    assert.equal(banner?.title, "Teamwechsel wirkt sofort");
    assert.equal(banner?.body, "Der Spieler verschwindet aus dem alten Kader und erscheint im neuen.");
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

  /* Both are read off a DRAFT field and neither is this save's doing: the flag is derived at entry
     and never offered here, and the role is one another squad row already holds. */
  it("classifies the nachgetragen flag and a taken role as state", () => {
    assert.equal(build({ isNachgetragen: true })[0]?.raisedBy, "state");
    assert.equal(build({ blockedRolle: { label: "Kapitän", heldBy: "Jonas Weber" } })[0]?.raisedBy, "state");
  });

  /* Colour and confirmation are separate switches: a banner the page load already carries asks
     nothing at save time, and only the transfer is a consequence this save has. */
  it("classifies every banner a page load already carries as state, and the transfer as change", () => {
    const atLoad = [
      ...build({ isRetired: true }),
      ...build({ isMember: false, saisonStatus: "active" }),
      ...build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false }),
    ];

    for (const banner of atLoad) assert.equal(banner.raisedBy, "state", `${banner.id} would confirm a situation the save did not cause`);
    assert.equal(build({ isTeamChanged: true })[0]?.raisedBy, "change");
  });
});
