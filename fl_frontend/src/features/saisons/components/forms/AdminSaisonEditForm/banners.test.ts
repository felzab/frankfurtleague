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
    isTiebreakChanged: false,
    isStufenChanged: false,
    hasDrawnSpiele: false,
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

    // The site-wide reach rides in the title and the retroactive one in the body, so the pair is
    // what proves the entry was not split; neither regex pins a wording beyond its own fact.
    assert.match(banner?.title ?? "", /ganzen Seite/);
    assert.match(banner?.body ?? "", /längst gespielte Spiele/);
  });

  /* The rail carries it alone. Rendered beside the rules fields as well, the same sentence read as a
     property of those fields, when it is one about every edit the page can make. */
  it("keeps the live-season entry off the rules panel", () => {
    const [banner] = build({ saisonStatus: "active" });

    assert.equal(banner?.inline, null);
  });

  /* The freeze the draw imposes, which no other entry states: `saison.past` names the three the
     scoring freezes, and on a drawn season two further fields are shut with it. */
  it("says so on the rail once the season holds fixtures, whatever its status", () => {
    assert.deepEqual(ids(build({ hasDrawnSpiele: true })), ["saison.drawn"]);
    assert.deepEqual(ids(build({ saisonStatus: "past", hasDrawnSpiele: true })), ["saison.past", "saison.drawn"]);
  });

  /* An `info`, and this is the whole reason: `resolveBlockingBanners` raises `ConfirmSaveModal` for a
     `warning`, which would put a dialog in front of every save on a season that holds fixtures. */
  it("grades the drawn freeze as a standing property rather than as a consequence of the save", () => {
    const [banner] = build({ hasDrawnSpiele: true });

    assert.equal(banner?.severity, "info");
    assert.equal(banner?.inline, null);
  });

  it("grades both rule breaches as danger, and only the span one claims the save is barred", () => {
    const breaches = [...build({ isEndBeforeStart: true }), ...build({ qualifiersPerGroup: 5 })];

    assert.deepEqual(ids(breaches), ["saison.end-before-start", "saison.qualifiers-overflow"]);
    assert.ok(breaches.every((banner) => banner.severity === "danger"));
    // The overflow saves while it is not worsened, so promising otherwise would relatch what I44 opened.
    assert.match(breaches[1]?.body ?? "", /nicht weiter verschlechtert/);
  });

  it("warns about a moved tiebreak on its own entry, since re-sorting is not re-scoring", () => {
    const both = build({ isPointsChanged: true, isTiebreakChanged: true });

    assert.deepEqual(ids(both), ["saison.points-changed", "saison.tiebreak-changed"]);
    // A warning, so the save confirms: neither effect is visible at the field that caused it.
    assert.ok(both.every((banner) => banner.severity === "warning"));
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

  it("stays quiet about the rollover on a finished season, which no open fixture is what blocks", () => {
    assert.deepEqual(ids(build({ saisonStatus: "past", outgoingSaisonId: "2025", offeneSpieleCount: 3 })), ["saison.past"]);
  });
});
