import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTeamBanners } from "./banners.ts";

import type { TeamBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildTeamBanners>[0]> = {}): readonly TeamBanner[] =>
  buildTeamBanners({
    isRetired: false,
    saisonId: "2026",
    saisonStatus: "future",
    isMember: true,
    storedAustritt: null,
    hasAustritt: false,
    isGruppeLocked: false,
    isGruppeChanged: false,
    ...overrides,
  });

const ids = (banners: readonly TeamBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildTeamBanners", () => {
  it("raises nothing for a settled membership with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("names the season the club is missing from, in the title", () => {
    const [banner] = build({ isMember: false });

    // Pinned by id, so the title below is asserted against a named banner rather than whichever one
    // the builder happens to push first.
    assert.equal(banner?.id, "team.not-in-saison-future");
    assert.match(banner?.title ?? "", /Saison 2026/);
  });

  it("splits the entry case from the closed one on the season's status", () => {
    assert.ok(ids(build({ isMember: false })).includes("team.not-in-saison-future"));
    assert.ok(ids(build({ isMember: false, saisonStatus: "active" })).includes("team.not-in-saison-closed"));
    assert.ok(ids(build({ isMember: false, saisonStatus: "past" })).includes("team.not-in-saison-closed"));
  });

  it("answers a retired club ahead of the season's window, whatever that window is", () => {
    for (const saisonStatus of ["future", "active", "past"] as const) {
      const raised = ids(build({ isMember: false, isRetired: true, saisonStatus }));

      assert.ok(raised.includes("team.not-in-saison-retired"), `retired banner missing for a ${saisonStatus} season`);
      assert.ok(!raised.includes("team.not-in-saison-future"));
      assert.ok(!raised.includes("team.not-in-saison-closed"));
    }
  });

  it("lands the retired club's banner at the panel spot that replaces the entry affordance", () => {
    const banner = build({ isMember: false, isRetired: true }).find(({ id }) => id === "team.not-in-saison-retired");

    assert.equal(banner?.inline, "saison-kein-eintritt");
    // The league's word, never the season's: `Austritt` and `ausgeschieden` name a club leaving ONE
    // season, which is a different record with a different remedy.
    assert.match(banner?.body ?? "", /stillgelegte/);
    assert.ok(!/Austritt|ausgeschieden/.test(banner?.body ?? ""));
  });

  it("promises the entry control only where reactivating would open one", () => {
    const retired = (status: "future" | "active" | "past") =>
      build({ isMember: false, isRetired: true, saisonStatus: status }).find(({ id }) => id === "team.not-in-saison-retired")?.body ?? "";

    // `FormSaisonSection` renders the entry affordance on a `future` season alone. On the other two
    // the banner that replaces it says entry is closed, so an invitation here would be withdrawn.
    assert.match(retired("future"), /nimm es danach hier auf/);
    assert.doesNotMatch(retired("active"), /hier auf/);
    assert.doesNotMatch(retired("past"), /hier auf/);
    assert.match(retired("active"), /läuft bereits/);
    assert.match(retired("past"), /ist beendet/);
  });

  it("says which of the two closed statuses is in the way", () => {
    const closed = (status: "active" | "past") =>
      build({ isMember: false, saisonStatus: status }).find((banner) => banner.id === "team.not-in-saison-closed")?.body ?? "";

    assert.match(closed("active"), /läuft bereits/);
    assert.match(closed("past"), /beendet/);
  });

  it("tells entering an austritt apart from lifting one", () => {
    const record = { type: "disqualifikation", grund: "Nicht angetreten", datum: "2026-03-12" } as const;

    assert.deepEqual(ids(build({ hasAustritt: true })), ["team.austritt-entering"]);
    assert.deepEqual(ids(build({ storedAustritt: record })), ["team.austritt-lifting"]);
  });

  it("renders the stored reason verbatim, with its date in the title", () => {
    const record = { type: "disqualifikation", grund: "Wiederholt nicht angetreten", datum: "2026-03-12" } as const;
    const [banner] = build({ hasAustritt: true, storedAustritt: record });

    assert.equal(banner?.body, record.grund);
    assert.match(banner?.title ?? "", /12\.03\.2026/);
  });

  it("titles the standing banner from the route, so a withdrawal is not called a disqualification", () => {
    const standing = (type: "disqualifikation" | "rueckzug") =>
      build({ hasAustritt: true, storedAustritt: { type, grund: "Schule aufgelöst", datum: "2026-03-12" } })[0]?.title ?? "";

    assert.match(standing("disqualifikation"), /^Disqualifiziert seit/);
    assert.match(standing("rueckzug"), /^Zurückgezogen seit/);
  });

  it("keeps the group warning off a locked group, whatever the draft says", () => {
    assert.deepEqual(ids(build({ isGruppeChanged: true })), ["team.gruppe-changed"]);
    assert.deepEqual(ids(build({ isGruppeChanged: true, isGruppeLocked: true })), []);
  });
});
