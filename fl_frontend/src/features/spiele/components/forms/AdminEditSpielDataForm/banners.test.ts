import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

import { buildSpielBanners } from "./banners.ts";

import type { SpielBanner, SpielBannerSide } from "./banners.ts";

const side = (fieldName: "team1" | "team2", overrides: Partial<SpielBannerSide> = {}): SpielBannerSide => ({
  fieldName,
  label: fieldName === "team1" ? "Team 1" : "Team 2",
  quelle: null,
  team: null,
  ...overrides,
});

const team = (teamId: string, name: string) => ({ team_id: teamId, name, shorthand: name.slice(0, 3), tore: null, austritt: null });

const build = (overrides: Partial<Parameters<typeof buildSpielBanners>[0]> = {}): readonly SpielBanner[] =>
  buildSpielBanners({
    isKnockout: true,
    sides: [],
    knockoutTeamIds: new Set<string>(),
    isNewlyChosen: false,
    sonderereignis: null,
    dependentSpielNummern: [],
    hasAnyTore: false,
    hasDecidedErgebnis: false,
    voidedSpielNummern: [],
    releasedSpielNummern: [],
    ...overrides,
  });

const ids = (banners: readonly SpielBanner[]): string[] => banners.map((banner) => banner.id);

describe("buildSpielBanners", () => {
  it("raises nothing for an untouched knockout fixture with both sides wired", () => {
    assert.deepEqual(ids(build({ sides: [side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } })] })), []);
  });

  it("says nothing about a manual side in the group phase, where there is no wiring to lose", () => {
    assert.deepEqual(ids(build({ isKnockout: false, sides: [side("team1"), side("team2")] })), []);
  });

  it("gives the two sides distinct ids, which is what the React key now rests on", () => {
    const built = build({ sides: [side("team1"), side("team2")] });

    assert.deepEqual(ids(built), ["spiel.team1-manual", "spiel.team2-manual"]);
  });

  it("adds the qualification warning only for a hand-picked team the bracket does not already field", () => {
    const picked = side("team1", { team: team("t1", "Adler") });

    assert.ok(ids(build({ sides: [picked] })).includes("spiel.team1-unqualified"));
    assert.ok(!ids(build({ sides: [picked], knockoutTeamIds: new Set(["t1"]) })).includes("spiel.team1-unqualified"));
  });

  it("thins the cluster down: the standing note goes while a specific banner stands", () => {
    // Red without `resolveRailBanners`, which is what thins the callouts down to one pick's worth.
    const newlyChosen = build({ isNewlyChosen: true, sonderereignis: "ausgefallen" });
    assert.ok(ids(newlyChosen).includes("spiel.sonderereignis-standing"));
    assert.ok(!ids(resolveRailBanners(newlyChosen)).includes("spiel.sonderereignis-standing"));

    const refused = build({ sonderereignis: "ausgefallen", hasAnyTore: true });
    assert.ok(!ids(resolveRailBanners(refused)).includes("spiel.sonderereignis-standing"));

    const awarded = build({ sonderereignis: "nichtantreten_team1" });
    assert.ok(!ids(resolveRailBanners(awarded)).includes("spiel.sonderereignis-standing"));
  });

  it("keeps the standing note on a fixture called off in an earlier session with nothing else to say", () => {
    assert.deepEqual(ids(resolveRailBanners(build({ sonderereignis: "ausgefallen" }))), ["spiel.sonderereignis-standing"]);
  });

  // **The one member the standing note excludes**: an abandoned fixture IS still chased, so "wird
  // nicht mehr angemahnt" would be false of it.
  it("never claims an abandoned fixture stops being chased", () => {
    assert.deepEqual(ids(build({ sonderereignis: "abgebrochen" })), []);
  });

  it("announces a change from one member to another, not only a first event", () => {
    const swapped = build({ isNewlyChosen: true, sonderereignis: "annulliert" });

    assert.match(swapped.find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "", /Annulliert/);
  });

  it("gives each member its own meaning rather than one sentence for all five", () => {
    const titles = (["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"] as const).map(
      (sonderereignis) =>
        build({ isNewlyChosen: true, sonderereignis }).find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "",
    );

    assert.equal(new Set(titles).size, titles.length);
  });

  it("names the fixtures an unscored event leaves unoccupied, singular and plural", () => {
    const one = build({ isNewlyChosen: true, sonderereignis: "ausgefallen", dependentSpielNummern: [29] });
    const many = build({ isNewlyChosen: true, sonderereignis: "annulliert", dependentSpielNummern: [29, 30, 31] });

    assert.match(one.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiel 29 unbesetzt/);
    assert.match(many.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiele 29, 30 und 31 unbesetzt/);
  });

  // A no-show is awarded a result and an abandonment may still be scored, so each RESOLVES the slot
  // below rather than stalling it.
  it("leaves the bracket banner off an event that still produces a result", () => {
    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2", "abgebrochen"] as const) {
      const built = build({ isNewlyChosen: true, sonderereignis, dependentSpielNummern: [29] });

      assert.ok(!ids(built).includes("spiel.knockout-feeds"), sonderereignis);
    }
  });

  it("leaves the bracket banner off a group-phase cancellation, which feeds nothing", () => {
    const built = build({ isKnockout: false, isNewlyChosen: true, sonderereignis: "ausgefallen", dependentSpielNummern: [29] });

    assert.ok(!ids(built).includes("spiel.knockout-feeds"));
  });

  // `REQ-STATE-002` refuses on ANY typed goal, so this banner's condition is not the decided-result one.
  it("reports a result beside an unscored event as the refusal it is", () => {
    for (const sonderereignis of ["ausgefallen", "annulliert"] as const) {
      const refusal = build({ sonderereignis, hasAnyTore: true }).find((banner) => banner.id === "spiel.result-refused");

      assert.equal(refusal?.severity, "danger", sonderereignis);
    }
  });

  it("says nothing about a refusal while no goal has been typed", () => {
    assert.ok(!ids(build({ sonderereignis: "ausgefallen", hasDecidedErgebnis: true })).includes("spiel.result-refused"));
  });

  // The single warning this replaced read as "check whether the result should stay" -- false for a
  // forfeit, which is the awarded state working exactly as designed.
  it("never warns about the result on a forfeit, which is the awarded state itself", () => {
    const built = build({ sonderereignis: "nichtantreten_team1", hasDecidedErgebnis: true, hasAnyTore: true });

    assert.ok(!ids(built).includes("spiel.abandoned-decided"));
    assert.ok(!ids(built).includes("spiel.result-refused"));
    assert.ok(ids(built).includes("spiel.forfeit-awarded"));
  });

  // Info while nothing is lost, warning once typed goals are about to be replaced -- which is also
  // what makes the save confirm.
  it("raises the forfeit note only to a warning when it would discard typed goals", () => {
    const bare = build({ sonderereignis: "nichtantreten_team2" });
    const withGoals = build({ sonderereignis: "nichtantreten_team2", hasAnyTore: true });

    assert.equal(bare.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity, "info");
    assert.equal(withGoals.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity, "warning");
  });

  // The one member for which the surviving warning text still reads correctly.
  it("keeps the ambiguity warning for an abandoned fixture carrying a decided result", () => {
    const built = build({ sonderereignis: "abgebrochen", hasDecidedErgebnis: true, hasAnyTore: true });

    assert.ok(ids(built).includes("spiel.abandoned-decided"));
  });

  it("puts the void preview's fixture numbers in the title, where the consequence is", () => {
    const built = build({ voidedSpielNummern: [29, 30], releasedSpielNummern: [31] });

    assert.match(built.find((banner) => banner.id === "spiel.void-preview")?.title ?? "", /Spielen 29 und 30/);
    assert.match(built.find((banner) => banner.id === "spiel.release-preview")?.title ?? "", /Spiel 31 entfernt/);
  });

  it("sorts danger over warning over info on the rail", () => {
    const built = resolveRailBanners(build({ sonderereignis: "ausgefallen", releasedSpielNummern: [31], voidedSpielNummern: [29] }));

    assert.deepEqual(
      built.map((banner) => banner.severity),
      ["danger", "warning", "info"],
    );
  });
});
