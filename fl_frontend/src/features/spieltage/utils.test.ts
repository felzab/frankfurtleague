import { describe, expect, it } from "vitest";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { buildSpieltagPhaseProgress, spieltagLabels } from "./utils.ts";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "../../core/generated/client/types.ts";

// A matchday as `spieltagLabels` reads one: the label needs the phase and the served position, and
// nothing else on the row.
const labelled = (id: string, phase: FLSaisonPhase, position: number) => ({ id, saison_phase: phase, position });

describe("spieltagLabels", () => {
  it("numbers a Gruppenphase matchday by its stored position", () => {
    const labels = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("b", "gruppenphase", 2)]);

    expect(labels.get("a")?.label).toBe("1. Spieltag");
    expect(labels.get("b")?.label).toBe("2. Spieltag");
  });

  // THE POINT OF STORING IT: a number taken from arrival order would rename every matchday in a
  // list handed over backwards.
  it("reads the same label whichever order the list arrives in", () => {
    const forwards = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("b", "gruppenphase", 2)]);
    const backwards = spieltagLabels([labelled("b", "gruppenphase", 2), labelled("a", "gruppenphase", 1)]);

    expect(backwards.get("a")?.label).toBe(forwards.get("a")?.label);
    expect(backwards.get("b")?.label).toBe(forwards.get("b")?.label);
  });

  // The gap is what separates the two candidate ordinals: counted from the row's place in the list
  // this answers 2, where the stored `position` answers 3.
  it("renders the stored number rather than the row's place in the list", () => {
    const labels = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("c", "gruppenphase", 3)]);

    expect(labels.get("c")?.label).toBe("3. Spieltag");
    expect(labels.get("c")?.ordinal).toBe(3);
  });

  // A knockout round is named by its phase, and only needs a number when the phase is split.
  it("numbers a knockout round only where its phase holds more than one matchday", () => {
    const alone = spieltagLabels([labelled("f", "finale", 1)]);
    const split = spieltagLabels([labelled("v1", "viertelfinale", 1), labelled("v2", "viertelfinale", 2)]);

    expect(alone.get("f")?.label).toBe("Finale");
    expect(split.get("v1")?.label).toBe("Viertelfinale (1)");
    expect(split.get("v2")?.label).toBe("Viertelfinale (2)");
  });
});

// The 2026 season's own shape: four groups of four give three group matchdays, and eight qualifiers
// play the last three rounds — so `achtelfinale` is absent rather than present with a zero.
const SCHEDULE_2026: FLSaisonPhaseSchedule[] = [
  { phase: "gruppenphase", spieltage: 3, matches_per_spieltag: 8 },
  { phase: "viertelfinale", spieltage: 1, matches_per_spieltag: 4 },
  { phase: "halbfinale", spieltage: 1, matches_per_spieltag: 2 },
  { phase: "finale", spieltage: 1, matches_per_spieltag: 1 },
];

const makeSpieltag = (phase: FLSaisonPhase) => ({ saison_phase: phase });

const held = (progress: readonly { phase: FLSaisonPhase; angelegt: number; expected: number }[], phase: FLSaisonPhase) =>
  progress.find((entry) => entry.phase === phase);

describe("buildSpieltagPhaseProgress", () => {
  it("counts a phase's matchdays against the number the season's rules imply", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [
      makeSpieltag("gruppenphase"),
      makeSpieltag("gruppenphase"),
      makeSpieltag("finale"),
    ]);

    expect(held(progress, "gruppenphase")).toStrictEqual({ phase: "gruppenphase", angelegt: 2, expected: 3 });
    expect(held(progress, "finale")).toStrictEqual({ phase: "finale", angelegt: 1, expected: 1 });
  });

  it("reports a phase with no matchday as zero rather than omitting it", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("gruppenphase")]);

    expect(held(progress, "halbfinale")).toStrictEqual({ phase: "halbfinale", angelegt: 0, expected: 1 });
  });

  // The endpoint accepts a matchday in a round this bracket does not reach, so the count describes one.
  it("expects none for a phase the season does not play", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("achtelfinale")]);

    expect(held(progress, "achtelfinale")).toStrictEqual({ phase: "achtelfinale", angelegt: 1, expected: 0 });
  });

  // Answering with zeroes would tell the page every phase is short.
  it("answers with nothing at all when no schedule was served", () => {
    expect(buildSpieltagPhaseProgress([], [makeSpieltag("gruppenphase")])).toStrictEqual([]);
  });
});
