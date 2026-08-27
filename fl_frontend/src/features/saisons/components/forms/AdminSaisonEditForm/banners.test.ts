import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { PLACING_RULES_FIELDS, RESCORING_RULES_FIELDS } from "../../../constants.ts";
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

/* THE COUPLING. `REQ-RULES-005` freezes exactly these four, and the editor warns about them while
   the season is still open — so a field added on the backend fails here naming itself. */
describe("the two retroactive-reach lists against the backend's frozen set", () => {
  it("cuts the tuple out of the module before comparing against it", () => {
    assert.ok(BACKEND_FROZEN_FIELDS.length > 0, "the tuple parsed to nothing, so the comparison below is vacuous");
  });

  it("splits the frozen set in two and covers all of it", () => {
    assert.deepEqual([...RESCORING_RULES_FIELDS, ...PLACING_RULES_FIELDS].sort(), [...BACKEND_FROZEN_FIELDS].sort());
    // Disjoint, or one moved field would raise both warnings for one edit.
    assert.equal(RESCORING_RULES_FIELDS.filter((field) => PLACING_RULES_FIELDS.includes(field)).length, 0);
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

  it("warns about a moved placing rule on its own entry, since re-sorting is not re-scoring", () => {
    const both = build({ isRescoringChanged: true, isPlacingChanged: true });

    assert.deepEqual(ids(both), ["saison.scoring-changed", "saison.placing-changed"]);
    // A warning, so the save confirms: neither effect is visible at the field that caused it.
    assert.ok(both.every((banner) => banner.severity === "warning"));
  });

  /* The one `auch` §1.12 keeps, and the reason the scoring entry has a body at all: a reader reads a
     rules edit as forward-looking unless the already-played half is named. */
  it("keeps the played-fixture reach on the scoring entry and off the placing one", () => {
    assert.match(build({ isRescoringChanged: true })[0]?.body ?? "", /längst gespielte Spiele/);
    assert.equal(build({ isPlacingChanged: true })[0]?.body, undefined);
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
