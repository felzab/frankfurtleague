import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { resolveBlockingBanners } from "../../../../../shared/components/ui/railBanner.ts";
import { PLACING_RULES_FIELDS, PREDRAW_RULES_FIELDS, RESCORING_RULES_FIELDS } from "../../../constants.ts";
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

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..", "..");

/* Source text rather than an import: the other half of the mirror is Python, and the frontend holds
   no second copy of the tuple that could be read in its place. */
const FROZEN_RULES_SOURCE = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "saisons", "services.py"), "utf8");

const BACKEND_FROZEN_FIELDS: string[] = [
  ...(/FROZEN_RULES_FIELDS: tuple\[str, \.\.\.\] = \(([^)]*)\)/.exec(FROZEN_RULES_SOURCE)?.[1] ?? "").matchAll(/"([^"]+)"/g),
].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

/** The three reaches the frozen set is read as, in the order the editor decides them. */
const MIRRORED_FIELDS: readonly string[] = [...RESCORING_RULES_FIELDS, ...PLACING_RULES_FIELDS, ...PREDRAW_RULES_FIELDS];

/* THE COUPLING. `REQ-RULES-005` freezes exactly these four, and each is read here as one of three
   reaches — so a field added on the backend fails here naming itself, rather than being absorbed by
   whichever list happens to hold a superset. */
describe("the three reach lists against the backend's frozen set", () => {
  it("cuts the tuple out of the module before comparing against it", () => {
    assert.ok(BACKEND_FROZEN_FIELDS.length > 0, "the tuple parsed to nothing, so the comparison below is vacuous");
  });

  it("covers the frozen set, so a field added on the backend reaches no list", () => {
    const unplaced = BACKEND_FROZEN_FIELDS.filter((field) => !MIRRORED_FIELDS.includes(field));

    assert.deepEqual(unplaced, [], `frozen on the backend and on none of the three lists: ${unplaced.join(", ")}`);
  });

  it("names nothing the backend has stopped freezing", () => {
    const stale = MIRRORED_FIELDS.filter((field) => !BACKEND_FROZEN_FIELDS.includes(field));

    assert.deepEqual(stale, [], `listed here and no longer frozen on the backend: ${stale.join(", ")}`);
  });

  it("keeps the three disjoint, since one field carries one reach", () => {
    // A field on two lists would raise two warnings for one edit, or one warning the save cannot reach.
    assert.equal(new Set(MIRRORED_FIELDS).size, MIRRORED_FIELDS.length, `a field stands on two lists: ${MIRRORED_FIELDS.join(", ")}`);
  });
});

describe("buildSaisonBanners", () => {
  it("raises nothing for a planned season with no pending edit and nothing to roll over", () => {
    assert.deepEqual(ids(build()), []);
  });

  /* Only the finished season speaks for itself. A running one is reported by whichever rule the draft
     actually moved, so a standing entry beside them would be the same fact told before it is true. */
  it("says nothing about a running season until an edit reaches a frozen rule", () => {
    assert.deepEqual(ids(build({ saisonStatus: "active" })), []);
    assert.deepEqual(ids(build({ saisonStatus: "past" })), ["saison.past"]);
  });

  /* The title is the whole entry: a body would state the freeze from the other side, and the panel's
     read-only fields already show which of them is shut. */
  it("states the finished season's freeze in its title alone", () => {
    const [banner] = build({ saisonStatus: "past" });

    assert.equal(banner?.body, undefined);
    assert.equal(banner?.inline, "regeln-status");
  });

  /* The freeze the draw imposes, which no other entry states: `saison.past` names the three the
     scoring freezes, and on a drawn season two further fields are shut with it. */
  it("says so on the rail once the season holds fixtures, whatever its status", () => {
    assert.deepEqual(ids(build({ hasDrawnSpiele: true })), ["saison.drawn"]);
    assert.deepEqual(ids(build({ saisonStatus: "past", hasDrawnSpiele: true })), ["saison.past", "saison.drawn"]);
  });

  /* An `info` and rail-only: the freeze is the shape the panel's read-only fields already show, and
     no field on this page answers it. */
  it("grades the drawn freeze as a standing property rather than as a consequence of the save", () => {
    const [banner] = build({ hasDrawnSpiele: true });

    assert.equal(banner?.severity, "info");
    assert.equal(banner?.inline, null);
    assert.equal(banner?.raisedBy, "state");
  });

  it("grades both rule breaches as danger, and only the span one claims the save is barred", () => {
    const breaches = [...build({ isEndBeforeStart: true }), ...build({ qualifiersPerGroup: 5 })];

    assert.deepEqual(ids(breaches), ["saison.end-before-start", "saison.qualifiers-overflow"]);
    assert.ok(breaches.every((banner) => banner.severity === "danger"));
    // The overflow saves while it is not worsened, so promising otherwise would relatch what I44 opened.
    assert.match(breaches[1]?.body ?? "", /nicht weiter verschlechtert/);
  });

  /* THE SPLIT, over the two dangers worth having it for: an excess `REQ-RULES-007` lets stand
     (`docs/backend/spec.md :: I44`), and an outgoing season the rollover answers. Both greet a
     reader who has touched nothing, and `change` would confirm forever. */
  it("keeps a danger the page opened on out of the confirmation, colour untouched", () => {
    const standing = [...build({ qualifiersPerGroup: 5 }), ...build({ outgoingSaisonId: "2025", offeneSpieleCount: 3 })];

    assert.deepEqual(ids(standing), ["saison.qualifiers-overflow", "saison.rollover-blocked"]);
    assert.ok(standing.every((banner) => banner.severity === "danger" && banner.raisedBy === "state"));
    assert.equal(resolveBlockingBanners(standing), null);
  });

  /* The other half of the same rule: each of these reads the draft against what is stored, so the
     save is what causes it — and the `info` pair is dropped by severity, from either side. */
  it("confirms the save for the draft's own consequences, and for nothing else", () => {
    const pending = build({ isEndBeforeStart: true, isRescoringChanged: true, isStufenChanged: true, hasDrawnSpiele: true });

    assert.deepEqual(
      resolveBlockingBanners(pending)?.map((banner) => banner.id),
      ["saison.end-before-start", "saison.scoring-changed"],
    );
  });

  it("warns about a moved placing rule on its own entry, since re-sorting is not re-scoring", () => {
    const both = build({ isRescoringChanged: true, isPlacingChanged: true });

    assert.deepEqual(ids(both), ["saison.scoring-changed", "saison.placing-changed"]);
    // A warning the draft raised, so the save confirms: neither effect is visible at the field that caused it.
    assert.ok(both.every((banner) => banner.severity === "warning" && banner.raisedBy === "change"));
  });

  /* The one `auch` §1.12 keeps, and the reason either entry has a body at all: a reader reads a rules
     edit as forward-looking unless the already-played half is named. Both saves reach one, `past`
     being the only status either field is frozen in. */
  it("names the played-fixture reach on both retroactive entries", () => {
    assert.match(build({ isRescoringChanged: true })[0]?.body ?? "", /Auch längst gespielte Spiele/);
    assert.match(build({ isPlacingChanged: true })[0]?.body ?? "", /auch längst fertige Gruppen/);
  });

  /* The mood is the point: the scoring moves for certain, while whether the table a reader then opens
     looks different depends on what has been played. */
  it("states each rules change as an outcome that could follow, never as a recalculation", () => {
    assert.match(build({ isRescoringChanged: true })[0]?.title ?? "", /Die Tabelle könnte sich ändern/);
    assert.match(build({ isPlacingChanged: true })[0]?.title ?? "", /Die Qualifikanten für die KO-Runde könnten sich ändern/);
  });

  it("counts the outgoing season's unfinished fixtures into the title, singular and plural", () => {
    const one = build({ outgoingSaisonId: "2025", offeneSpieleCount: 1 });
    const many = build({ outgoingSaisonId: "2025", offeneSpieleCount: 3 });

    assert.match(one[0]?.title ?? "", /^1 Spiel der Saison 2025/);
    assert.match(many[0]?.title ?? "", /^3 Spiele der Saison 2025/);
  });

  it("stays quiet about the rollover on the season that is already running", () => {
    assert.deepEqual(ids(build({ saisonStatus: "active", outgoingSaisonId: "2025", offeneSpieleCount: 3 })), []);
  });

  it("stays quiet about the rollover on a finished season, which no open fixture is what blocks", () => {
    assert.deepEqual(ids(build({ saisonStatus: "past", outgoingSaisonId: "2025", offeneSpieleCount: 3 })), ["saison.past"]);
  });
});
