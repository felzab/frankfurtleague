/**
 * SAISONS · season editor banner tests
 *
 * This editor carries no `supersedes` edge — its two status banners are mutually exclusive by
 * construction, and the group-swap panel's lock explanations stay out of the list entirely. What is
 * worth asserting is exactly that: the gates, and the count interpolation the rollover title carries.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSaisonBanners } from "./banners.ts";

import type { SaisonBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSaisonBanners>[0]> = {}): readonly SaisonBanner[] =>
  buildSaisonBanners({
    saisonStatus: "future",
    isEndBeforeStart: false,
    qualifiersPerGroup: 2,
    teamsPerGroup: 4,
    isPointsChanged: false,
    isStufenChanged: false,
    outgoingSaisonId: null,
    offeneSpieleCount: 0,
    ...overrides,
  });

const ids = (banners: readonly SaisonBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSaisonBanners", () => {
  it("raises nothing for a planned season with no pending edit and nothing to roll over", () => {
    assert.deepEqual(ids(build()), []);
  });

  it("gives each season status exactly one banner, never both", () => {
    assert.deepEqual(ids(build({ saisonStatus: "active" })), ["saison.active"]);
    assert.deepEqual(ids(build({ saisonStatus: "past" })), ["saison.past"]);
  });

  it("carries both live-season consequences in one entry, since neither follows from the other", () => {
    const [banner] = build({ saisonStatus: "active" });

    assert.match(banner?.body ?? "", /ohne ausgewählte Saison/);
    assert.match(banner?.body ?? "", /bei jedem Aufruf neu gerechnet/);
  });

  it("grades both save-blocking rule breaches as danger", () => {
    const blocking = [...build({ isEndBeforeStart: true }), ...build({ qualifiersPerGroup: 5 })];

    assert.deepEqual(ids(blocking), ["saison.end-before-start", "saison.qualifiers-overflow"]);
    assert.ok(blocking.every((banner) => banner.severity === "danger"));
  });

  it("counts the outgoing season's unfinished fixtures into the title, singular and plural", () => {
    const one = build({ outgoingSaisonId: "2025", offeneSpieleCount: 1 });
    const many = build({ outgoingSaisonId: "2025", offeneSpieleCount: 3 });

    assert.match(one[0]?.title ?? "", /^1 Spiel der Saison 2025/);
    assert.match(many[0]?.title ?? "", /^3 Spiele der Saison 2025/);
  });

  it("stays quiet about the rollover on the season that is already running", () => {
    assert.deepEqual(ids(build({ saisonStatus: "active", outgoingSaisonId: "2025", offeneSpieleCount: 3 })), ["saison.active"]);
  });
});
