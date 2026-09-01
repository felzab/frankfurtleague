import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBlockingBanners } from "@/shared/components/ui/railBanner.ts";

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
    draftGrund: "",
    isGruppeLocked: false,
    isGruppeChanged: false,
    ...overrides,
  });

const ids = (banners: readonly TeamBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildTeamBanners", () => {
  it("raises nothing for a settled membership with no pending edit", () => {
    assert.deepEqual(ids(build()), []);
  });

  /* One shape across the four retirable editors: the title names the exclusion, the body names what
     survives, and the way back is the header's own control rather than a sentence pointing at it. */
  it("states the retirement as the exclusion plus what survives, and points at no control", () => {
    const [banner] = build({ isRetired: true });

    assert.match(banner?.title ?? "", /erscheint in keiner Auswahlliste/);
    assert.match(banner?.body ?? "", /Kürzel bleibt reserviert/, "the body stopped naming what survives");
    assert.ok(!/reaktivieren|Kopf der Seite/i.test(banner?.body ?? ""));
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
    assert.match(retired("active"), /läuft schon/);
    assert.match(retired("past"), /ist beendet/);
  });

  it("says which of the two closed statuses is in the way", () => {
    const closed = (status: "active" | "past") =>
      build({ isMember: false, saisonStatus: status }).find((banner) => banner.id === "team.not-in-saison-closed")?.body ?? "";

    assert.match(closed("active"), /läuft schon/);
    assert.match(closed("past"), /beendet/);
  });

  it("tells entering an austritt apart from lifting one", () => {
    const record = { type: "disqualifikation", grund: "Nicht angetreten", datum: "2026-03-12" } as const;

    assert.deepEqual(ids(build({ hasAustritt: true })), ["team.austritt-entering"]);
    assert.deepEqual(ids(build({ storedAustritt: record })), ["team.austritt-lifting"]);
  });

  it("renders the stored reason verbatim, with its date in the title", () => {
    const record = { type: "disqualifikation", grund: "Wiederholt nicht angetreten", datum: "2026-03-12" } as const;
    // `draftGrund` matching the record is the untouched reason: an edited one raises the publication
    // warning ahead of this, which is the case below.
    const [banner] = build({ hasAustritt: true, storedAustritt: record, draftGrund: record.grund });

    assert.equal(banner?.body, record.grund);
    assert.match(banner?.title ?? "", /12\.03\.2026/);
  });

  it("titles the standing banner from the route, so a withdrawal is not called a disqualification", () => {
    const standing = (type: "disqualifikation" | "rueckzug") =>
      build({ hasAustritt: true, storedAustritt: { type, grund: "Schule aufgelöst", datum: "2026-03-12" }, draftGrund: "Schule aufgelöst" })[0]
        ?.title ?? "";

    assert.match(standing("disqualifikation"), /^Disqualifiziert seit/);
    assert.match(standing("rueckzug"), /^Zurückgezogen seit/);
  });

  it("warns again when a standing reason is rewritten, because that publishes new words", () => {
    const record = { type: "disqualifikation", grund: "Nicht angetreten", datum: "2026-03-12" } as const;
    const raised = build({ hasAustritt: true, storedAustritt: record, draftGrund: "Wiederholt nicht angetreten" });

    assert.deepEqual(ids(raised), ["team.austritt-entering", "team.austritt-standing"]);
    // The standing banner is `info` and cannot confirm anything, so the rewrite has to carry its own.
    assert.equal(resolveBlockingBanners(raised)?.[0]?.id, "team.austritt-entering");
  });

  it("leaves an untouched reason out of the save confirmation, so an unrelated edit saves straight through", () => {
    const record = { type: "disqualifikation", grund: "Nicht angetreten", datum: "2026-03-12" } as const;

    assert.equal(resolveBlockingBanners(build({ hasAustritt: true, storedAustritt: record, draftGrund: record.grund })), null);
  });

  /* The pair `raisedBy` exists for: the record already stands and is on screen at page load, while
     the words this draft would put on the public page are the save's doing. */
  it("classifies the standing austritt as state and a rewritten reason as change", () => {
    const record = { type: "disqualifikation", grund: "Nicht angetreten", datum: "2026-03-12" } as const;
    const raised = build({ hasAustritt: true, storedAustritt: record, draftGrund: "Wiederholt nicht angetreten" });

    assert.equal(raised.find(({ id }) => id === "team.austritt-standing")?.raisedBy, "state");
    assert.equal(raised.find(({ id }) => id === "team.austritt-entering")?.raisedBy, "change");
  });

  /* Colour and confirmation are separate switches: a banner the page load already carries asks
     nothing at save time, and one graded `change` here would confirm every later edit forever. */
  it("classifies every banner a page load already carries as state", () => {
    const record = { type: "rueckzug", grund: "Schule aufgelöst", datum: "2026-03-12" } as const;
    const atLoad = [
      ...build({ isRetired: true }),
      ...build({ isMember: false }),
      ...build({ isMember: false, isRetired: true, saisonStatus: "active" }),
      ...build({ hasAustritt: true, storedAustritt: record, draftGrund: record.grund }),
    ];

    for (const banner of atLoad) assert.equal(banner.raisedBy, "state", `${banner.id} would confirm a situation the save did not cause`);
  });

  it("keeps the group warning off a locked group, whatever the draft says", () => {
    assert.deepEqual(ids(build({ isGruppeChanged: true })), ["team.gruppe-changed"]);
    assert.deepEqual(ids(build({ isGruppeChanged: true, isGruppeLocked: true })), []);
  });

  it("states the move's one certain outcome and leaves the window it was allowed under unsaid", () => {
    const [banner] = build({ isGruppeChanged: true });

    // The picker is open only where `REQ-ENTER-004` already permits the move, so a sentence about
    // that window is reassurance, and one about the seeding promises a change no result decides yet.
    assert.equal(banner?.id, "team.gruppe-changed");
    assert.match(banner?.title ?? "", /Tabellen beider Gruppen/);
    assert.equal(banner?.body, undefined);
    assert.equal(banner?.raisedBy, "change", "the picker's own move stopped reaching the save confirmation");
  });
});
