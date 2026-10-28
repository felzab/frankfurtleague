import { assert, describe, expect, it } from "vitest";

import { resolveBlockingBanners } from "../../../../../shared/components/ui/railBanner.ts";
import { buildSaisonBanners } from "./banners.ts";

import type { SaisonBanner } from "./banners.ts";

const build = (overrides: Partial<Parameters<typeof buildSaisonBanners>[0]> = {}): readonly SaisonBanner[] =>
  buildSaisonBanners({
    saisonStatus: "future",
    isEndBeforeStart: false,
    qualifiersPerGroup: 2,
    teamsPerGroup: 4,
    isRescoringChanged: false,
    isPlacingChanged: false,
    isStufenChanged: false,
    hasDrawnSpiele: false,
    outgoingSaisonId: null,
    offeneSpieleCount: 0,
    ...overrides,
  });

const ids = (banners: readonly SaisonBanner[]): string[] => banners.map((banner) => banner.id);
describe("buildSaisonBanners", () => {
  it("raises nothing for a planned season with no pending edit and nothing to roll over", () => {
    expect(ids(build())).toStrictEqual([]);
  });

  /* Only the finished season speaks for itself. A running one is reported by whichever rule the draft
     actually moved, so a standing entry beside them would be the same fact told before it is true. */
  it("says nothing about a running season until an edit reaches a frozen rule", () => {
    expect(ids(build({ saisonStatus: "active" }))).toStrictEqual([]);
    expect(ids(build({ saisonStatus: "past" }))).toStrictEqual(["saison.past"]);
  });

  /* The title is the whole entry: a body would state the freeze from the other side, and the panel's
     read-only fields already show which of them is shut. */
  it("states the finished season's freeze in its title alone", () => {
    const [banner] = build({ saisonStatus: "past" });

    expect(banner?.body).toBe(undefined);
    expect(banner?.inline).toBe("regeln-status");
  });

  /* The freeze the draw imposes, which no other entry states: `saison.past` names the three the
     scoring freezes, and on a drawn season two further fields are shut with it. */
  it("says so on the rail once the season holds fixtures, whatever its status", () => {
    expect(ids(build({ hasDrawnSpiele: true }))).toStrictEqual(["saison.drawn"]);
    expect(ids(build({ saisonStatus: "past", hasDrawnSpiele: true }))).toStrictEqual(["saison.past", "saison.drawn"]);
  });

  /* An `info` and rail-only: the freeze is the shape the panel's read-only fields already show, and
     no field on this page answers it. */
  it("grades the drawn freeze as a standing property rather than as a consequence of the save", () => {
    const [banner] = build({ hasDrawnSpiele: true });

    expect(banner?.severity).toBe("info");
    expect(banner?.inline).toBe(null);
    expect(banner?.raisedBy).toBe("state");
  });

  it("grades both rule breaches as danger, and only the span one claims the save is barred", () => {
    const breaches = [...build({ isEndBeforeStart: true }), ...build({ qualifiersPerGroup: 5 })];

    expect(ids(breaches)).toStrictEqual(["saison.end-before-start", "saison.qualifiers-overflow"]);
    assert.ok(breaches.every((banner) => banner.severity === "danger"));
    // The overflow saves while it is not worsened, so promising otherwise would relatch what the backend opened.
    expect(breaches[1]?.body ?? "").toMatch(/nicht weiter verschlechtert/);
  });

  /* THE SPLIT, over the two dangers worth having it for: an excess `REQ-RULES-007` lets stand,
     and an outgoing season the rollover answers. Both greet a
     reader who has touched nothing, and `change` would confirm forever. */
  it("keeps a danger the page opened on out of the confirmation, colour untouched", () => {
    const standing = [...build({ qualifiersPerGroup: 5 }), ...build({ outgoingSaisonId: "2025", offeneSpieleCount: 3 })];

    expect(ids(standing)).toStrictEqual(["saison.qualifiers-overflow", "saison.rollover-blocked"]);
    assert.ok(standing.every((banner) => banner.severity === "danger" && banner.raisedBy === "state"));
    expect(resolveBlockingBanners(standing)).toBe(null);
  });

  /* The other half of the same rule: each of these reads the draft against what is stored, so the
     save is what causes it — and the `info` pair is dropped by severity, from either side. */
  it("confirms the save for the draft's own consequences, and for nothing else", () => {
    const pending = build({ isEndBeforeStart: true, isRescoringChanged: true, isStufenChanged: true, hasDrawnSpiele: true });

    expect(resolveBlockingBanners(pending)?.map((banner) => banner.id)).toStrictEqual(["saison.end-before-start", "saison.scoring-changed"]);
  });

  it("warns about a moved placing rule on its own entry, since re-sorting is not re-scoring", () => {
    const both = build({ isRescoringChanged: true, isPlacingChanged: true });

    expect(ids(both)).toStrictEqual(["saison.scoring-changed", "saison.placing-changed"]);
    // A warning the draft raised, so the save confirms: neither effect is visible at the field that caused it.
    assert.ok(both.every((banner) => banner.severity === "warning" && banner.raisedBy === "change"));
  });

  /* The one `auch` §1.12 keeps, and the reason this entry has a body at all: a reader reads a rules
     edit as forward-looking unless the already-played half is named. The save reaches one, `past`
     being the only status the field is frozen in. */
  it("names the played-fixture reach on the re-scoring entry", () => {
    expect(build({ isRescoringChanged: true })[0]?.body ?? "").toMatch(/Auch längst gespielte Spiele/);
  });

  /* Both titles are fixed copy rather than §1.12's output, and each is the whole banner: a body under
     either would answer a second question its title has not raised. */
  it("carries the placing and the Stufen entry in their titles alone", () => {
    expect(build({ isPlacingChanged: true })[0]?.body).toBe(undefined);
    expect(build({ isStufenChanged: true })[0]?.body).toBe(undefined);
    expect(build({ isStufenChanged: true })[0]?.title).toBe("Bestehende Kadereinträge behalten ihre Stufe");
  });

  /* The mood is the point: the scoring moves for certain, while whether the table a reader then opens
     looks different depends on what has been played. */
  it("states each rules change as an outcome that could follow, never as a recalculation", () => {
    expect(build({ isRescoringChanged: true })[0]?.title ?? "").toMatch(/Die Tabelle könnte sich ändern/);
    expect(build({ isPlacingChanged: true })[0]?.title ?? "").toMatch(/Die Platzierungen der Teams könnten sich ändern/);
  });

  it("counts the outgoing season's unfinished fixtures into the title, singular and plural", () => {
    const one = build({ outgoingSaisonId: "2025", offeneSpieleCount: 1 });
    const many = build({ outgoingSaisonId: "2025", offeneSpieleCount: 3 });

    expect(one[0]?.title ?? "").toMatch(/^1 Spiel der Saison 2025/);
    expect(many[0]?.title ?? "").toMatch(/^3 Spiele der Saison 2025/);
  });

  it("stays quiet about the rollover on the season that is already running", () => {
    expect(ids(build({ saisonStatus: "active", outgoingSaisonId: "2025", offeneSpieleCount: 3 }))).toStrictEqual([]);
  });

  it("stays quiet about the rollover on a finished season, which no open fixture is what blocks", () => {
    expect(ids(build({ saisonStatus: "past", outgoingSaisonId: "2025", offeneSpieleCount: 3 }))).toStrictEqual(["saison.past"]);
  });
});
