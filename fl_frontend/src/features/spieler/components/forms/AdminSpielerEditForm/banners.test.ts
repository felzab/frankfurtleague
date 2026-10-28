// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { assert, describe, expect, it } from "vitest";

import { REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_ROOM_IN_SQUAD } from "../../../constants.ts";
import { buildSpielerBanners } from "./banners.ts";

import type { SpielerBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSpielerBanners>[0]> = {}): readonly SpielerBanner[] =>
  buildSpielerBanners({
    isRetired: false,
    saisonId: "2026",
    nachnominierungLaeuft: false,
    isMember: true,
    rowInactiveSince: null,
    isRowTeamInSaison: true,
    istNachnominiert: false,
    isTeamChanged: false,
    isSquadFull: false,
    blockedRolle: null,
    ...overrides,
  });

const ids = (banners: readonly SpielerBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielerBanners", () => {
  it("raises nothing for a settled squad row with no pending edit", () => {
    expect(ids(build())).toStrictEqual([]);
  });

  /* The title names the exclusion, the body what survives, and neither points at a control. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    expect(banner?.title ?? "").toMatch(/erscheint in keiner Auswahlliste/);
    expect(banner?.body ?? "", "the body stopped naming what survives").toMatch(/Kadereinträge dieser Person bleiben erhalten/);
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
  });

  it("offers the entry remedy for a player no squad holds", () => {
    const [banner] = build({ isMember: false });

    expect(banner?.id).toBe("spieler.not-in-kader-entry");
    expect(banner?.title ?? "").toMatch(/Saison 2026/);
  });

  /* A pupil can be a girl and this slice's consent panel already writes both forms, so a masculine
     word here is wrong about half the league. Title and body together: one recast leaves an entry
     disagreeing with itself. */
  it("names the pupil neutrally in every banner that stands for the person", () => {
    const maskulin = /\bdieser spieler\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;
    const genannt: string[] = [];

    for (const [id, raised] of [
      ["spieler.retired", build({ isRetired: true })],
      ["spieler.not-in-kader-entry", build({ isMember: false })],
      ["spieler.entry-nachnominiert", build({ isMember: false, nachnominierungLaeuft: true })],
      ["spieler.nachnominiert", build({ istNachnominiert: true })],
    ] as const) {
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

  it("announces the served nachnominiert verdict only where there is no row to enter into yet", () => {
    /* Both name the player, and both spell the word out: „nachnominiert“ is what the player list
       spells back as a badge, and no surface but this one says what it means. */
    const entering = build({ isMember: false, nachnominierungLaeuft: true }).find(({ id }) => id === "spieler.entry-nachnominiert");
    const standing = build({ istNachnominiert: true }).find(({ id }) => id === "spieler.nachnominiert");

    expect(entering?.title ?? "").toMatch(/Diese Person wird nachnominiert/);
    expect(standing?.title ?? "").toMatch(/Diese Person wurde nachnominiert/);
    expect(entering?.body ?? "").toMatch(/Zu Beginn der Saison war sie nicht im Kader/);
    expect(standing?.body ?? "").toMatch(/Zu Beginn der Saison war sie nicht im Kader/);
    assert.ok(ids(build({ isMember: false, nachnominierungLaeuft: true })).includes("spieler.entry-nachnominiert"));
    assert.ok(!ids(build({ isMember: false, nachnominierungLaeuft: false })).includes("spieler.entry-nachnominiert"));
    assert.ok(!ids(build({ nachnominierungLaeuft: true })).includes("spieler.entry-nachnominiert"));
  });

  /* Dictated copy, so both lines are pinned literally rather than by a loosened pattern: a sweep
     re-deriving either of them from the copy rules is what this test is here to fail. */
  it("grades a transfer as a warning and names the timing over the move it makes", () => {
    const [banner] = build({ isTeamChanged: true });

    expect(banner?.id).toBe("spieler.team-changed");
    expect(banner?.severity).toBe("warning");
    expect(banner?.title).toBe("Teamwechsel wirkt sofort");
    expect(banner?.body).toBe("Der Spieler verschwindet aus dem alten Kader und erscheint im neuen.");
  });

  /* Both sides of the cap, because an id list asserted at the cap alone reads the same for a banner
     that stands over every squad. `info`, so the save dialog never asks about a press it cannot let
     through. */
  it("raises the full squad at the cap and not below it, and names both ways out", () => {
    const raised = build({ isSquadFull: true });

    expect(ids(raised)).toStrictEqual(["spieler.kader-voll"]);
    expect(ids(build({ isSquadFull: false })), "the banner stands over a squad that still has room").toStrictEqual([]);
    expect(raised[0]?.severity).toBe("info");
    expect(raised[0]?.body ?? "", "the nearer repair is gone").toMatch(/trage zuerst einen anderen Spieler aus/);
    expect(raised[0]?.body ?? "", "the reader is left with one way out where the season's rules are the other").toMatch(/Saisonregeln/);
  });

  /* One wording for one rule: this banner and the disabled reason can stand over one club at once. */
  it("states the cap in the wording every other surface uses", () => {
    const raised = build({ isSquadFull: true })[0];

    expect(`${raised?.title ?? ""}. ${raised?.body ?? ""}`).toBe(REACTIVATION_NEEDS_ROOM_IN_SQUAD);
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

  /* Colour and confirmation are separate switches: a banner the page load already carries asks
     nothing at save time, and only the transfer is a consequence this save has. */
  it("classifies every banner a page load already carries as state, and the transfer as change", () => {
    const atLoad = [
      ...build({ isRetired: true }),
      ...build({ isMember: false, nachnominierungLaeuft: true }),
      ...build({ rowInactiveSince: "2026-03-12", isRowTeamInSaison: false }),
      ...build({ isSquadFull: true }),
    ];

    for (const banner of atLoad) expect(banner.raisedBy, `${banner.id} would confirm a situation the save did not cause`).toBe("state");
    expect(build({ isTeamChanged: true })[0]?.raisedBy).toBe("change");
  });
});
