import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBlockingBanners, resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { SONDEREREIGNIS_LABELS } from "../../../constants.ts";
import { buildSpielBanners, isSpielRefusalBannerId, isSpielRefusalCode } from "./banners.ts";

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
    // The permissive default, so every case below that is not about the seeding rule reads as a
    // fixture on the round its bracket opens on.
    seedsFromTheGroups: true,
    sides: [],
    knockoutTeamIds: new Set<string>(),
    isNewlyChosen: false,
    sonderereignis: null,
    dependentSpielNummern: [],
    hasAnyTore: false,
    hasDecidedErgebnis: false,
    dropsShootOut: false,
    voidedSpielNummern: [],
    releasedSpielNummern: [],
    refusalCode: null,
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

  /* The Herkunft picker's chosen option reads „Manuell gesetzt“, so a title spelling that back is the
     second telling (`docs/frontend/spec.md` §1.12, diagnostic 4). What it does not show is the reach. */
  it("states what a hand-set side costs rather than the choice the picker already shows", () => {
    const [banner] = build({ sides: [side("team1")] });

    assert.equal(banner?.body, undefined);
    assert.ok(!/manuell|von Hand|nicht mehr|automatisch/i.test(banner?.title ?? ""));
    assert.match(banner?.title ?? "", /Spätere Ergebnisse lassen Team 1 unverändert/);
  });

  /* A slot is off its source whatever this save does, and `docs/frontend/spec.md` §1.12 grades a
     standing property `info` — above it, every later edit of the fixture confirms for this. */
  it("grades a hand-set side as a standing property, clear of the save's confirmation", () => {
    const built = build({ sides: [side("team1"), side("team2")] });

    assert.equal(built[0]?.severity, "info");
    assert.equal(resolveBlockingBanners(built), null);
  });

  /* The closed Herkunft row states its reason inside a popover and the two controls under it state
     none, so the rule they close on stands where the reader meets them. */
  it("states the rule behind a closed group placing on a round the bracket does not open on", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const [banner, ...rest] = build({ seedsFromTheGroups: false, sides: [seeded] });

    assert.equal(rest.length, 0);
    assert.equal(banner?.id, "spiel.team1-seed-closed");
    assert.equal(banner?.inline, "team1-herkunft");
    assert.match(banner?.title ?? "", /Herkunft von Team 1 nur in der ersten KO-Runde/);
    // The fixture saves as it stands, so nothing under the title may offer a repair for a block.
    assert.equal(banner?.body, undefined);
  });

  it("says it per side, so both sides of a hand-wired fixture carry their own", () => {
    const gruppe = { type: "gruppe", gruppe: "A", platz: 1 } as const;
    const built = build({ seedsFromTheGroups: false, sides: [side("team1", { quelle: gruppe }), side("team2", { quelle: gruppe })] });

    assert.deepEqual(ids(built), ["spiel.team1-seed-closed", "spiel.team2-seed-closed"]);
    assert.match(built[1]?.title ?? "", /Team 2/);
  });

  it("leaves a match-fed and a hand-set side alone on that same round", () => {
    const fed = side("team1", { quelle: { type: "spiel", spiel_nr: 29, ausgang: "sieger" } });

    assert.deepEqual(ids(build({ seedsFromTheGroups: false, sides: [fed] })), []);
    assert.deepEqual(ids(build({ seedsFromTheGroups: false, sides: [side("team2")] })), ["spiel.team2-manual"]);
  });

  /* A group fixture carrying wiring is refused under `REQ-WIRING-001` instead, whose repair is to
     drop the wiring rather than to move it onto an earlier match. */
  it("leaves it off a group-phase fixture, which this rule does not reach", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });

    assert.deepEqual(ids(build({ isKnockout: false, seedsFromTheGroups: false, sides: [seeded] })), []);
  });

  /* `info` is what keeps it off the dialog, so it needs no place on the refusal list: the fixture
     saves as it stands, and a grade above `info` would confirm every unrelated edit of it. */
  it("grades the seeding rule as a standing property rather than a refusal", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const built = build({ seedsFromTheGroups: false, sides: [seeded] });

    assert.equal(built[0]?.severity, "info");
    assert.equal(resolveBlockingBanners(built), null);
    assert.ok(!isSpielRefusalBannerId("spiel.team1-seed-closed"));
    assert.ok(!isSpielRefusalBannerId("spiel.team1-manual"));
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

    const awarded = build({ sonderereignis: "nichtantreten_team1", hasAnyTore: true });
    assert.ok(!ids(resolveRailBanners(awarded)).includes("spiel.sonderereignis-standing"));
  });

  it("keeps the standing note on a fixture called off in an earlier session with nothing else to say", () => {
    assert.deepEqual(ids(resolveRailBanners(build({ sonderereignis: "ausgefallen" }))), ["spiel.sonderereignis-standing"]);
  });

  /* The title is the whole note, and a body about how the fixture reads elsewhere would be false of
     a no-show, which reaches this note whenever the award replaces nothing. */
  it("states the standing note in its title alone, so it holds for a no-show too", () => {
    for (const sonderereignis of ["ausgefallen", "annulliert", "nichtantreten_team1"] as const) {
      const [banner] = resolveRailBanners(build({ sonderereignis }));

      assert.equal(banner?.id, "spiel.sonderereignis-standing", sonderereignis);
      assert.equal(banner?.body, undefined, sonderereignis);
    }
  });

  // **The one member the standing note excludes**: an abandoned fixture IS still chased, so "wird
  // nicht mehr angemahnt" would be false of it.
  it("never claims an abandoned fixture stops being chased", () => {
    assert.deepEqual(ids(build({ sonderereignis: "abgebrochen" })), []);
  });

  it("announces a change from one member to another, not only a first event", () => {
    const swapped = build({ isNewlyChosen: true, sonderereignis: "annulliert" });

    assert.match(swapped.find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "", /zählt rückwirkend nicht mehr/);
  });

  it("gives each member its own meaning rather than one sentence for all five", () => {
    const titles = (["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"] as const).map(
      (sonderereignis) =>
        build({ isNewlyChosen: true, sonderereignis }).find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "",
    );

    assert.equal(new Set(titles).size, titles.length);
  });

  /* The picker above spells the member's own name, so a title opening with it is the second telling
     (`docs/frontend/spec.md` §1.12, diagnostic 4). */
  it("never opens a meaning with the label the reader has just picked", () => {
    for (const sonderereignis of ["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"] as const) {
      const title = build({ isNewlyChosen: true, sonderereignis }).find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "";

      assert.ok(!title.includes("heißt"), sonderereignis);
      assert.ok(!title.startsWith(SONDEREREIGNIS_LABELS[sonderereignis]), sonderereignis);
    }
  });

  it("names the fixtures an unscored event leaves unoccupied, singular and plural", () => {
    const one = build({ isNewlyChosen: true, sonderereignis: "ausgefallen", dependentSpielNummern: [29] });
    const many = build({ isNewlyChosen: true, sonderereignis: "annulliert", dependentSpielNummern: [29, 30, 31] });

    assert.match(one.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiel 29 unbesetzt/);
    assert.match(many.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "", /Spiele 29, 30 und 31 unbesetzt/);
  });

  /* `fl_frontend/src/features/spiele/utils.ts :: listDependentSpiele` matches a source naming THIS
     fixture and never walks on, so the title stops one round short of where the emptying stops. */
  it("names the rounds behind the fixtures the title can enumerate", () => {
    const built = build({ isNewlyChosen: true, sonderereignis: "ausgefallen", dependentSpielNummern: [29] });

    assert.match(built.find((banner) => banner.id === "spiel.knockout-feeds")?.body ?? "", /Runden danach/);
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

  /* Silent while the award replaces nothing, a warning once it does -- which is also what makes the
     save confirm. An `info` never reached the save gate, so this decides a rail line alone. */
  it("raises the forfeit note only where the award would discard entered work", () => {
    const bare = build({ sonderereignis: "nichtantreten_team2" });
    const withGoals = build({ sonderereignis: "nichtantreten_team2", hasAnyTore: true });
    const withShootOut = build({ sonderereignis: "nichtantreten_team2", dropsShootOut: true });

    assert.ok(!ids(bare).includes("spiel.forfeit-awarded"));
    assert.equal(withGoals.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity, "warning");
    assert.equal(withShootOut.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity, "warning");
  });

  // The record is entered work like the goals are, and the award replaces nothing of it -- so the
  // note that speaks for the forfeit is the one place the discard can be read.
  it("names the shoot-out the award discards, and confirms the save over it", () => {
    const built = build({ sonderereignis: "nichtantreten_team1", hasAnyTore: true, dropsShootOut: true });
    const forfeit = built.find((banner) => banner.id === "spiel.forfeit-awarded");

    assert.equal(forfeit?.severity, "warning");
    // The title carries both losses, so nothing under it states the second one again.
    assert.match(forfeit?.title ?? "", /Elfmeterschießen/);
    assert.equal(forfeit?.body, undefined);
  });

  it("says nothing about a shoot-out where none is being discarded", () => {
    const forfeit = build({ sonderereignis: "nichtantreten_team1", hasAnyTore: true }).find((banner) => banner.id === "spiel.forfeit-awarded");

    assert.doesNotMatch(forfeit?.title ?? "", /Elfmeterschießen/);
    assert.doesNotMatch(forfeit?.body ?? "", /Elfmeterschießen/);
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

  it("carries the remedies the two rail-backed refusals leave off their field message", () => {
    // `fl_backend/app/api/spiele/services.py :: find_eligibility_refusal` keys on the austritt date,
    // so lifting it clears the refusal in every phase, which is what the one repair rests on.
    const eligibility = build({ refusalCode: "REQ-ELIGIBILITY-001" });
    const body = eligibility.find((banner) => banner.id === "spiel.eligibility-refused")?.body ?? "";

    assert.deepEqual(ids(eligibility), ["spiel.eligibility-refused"]);
    assert.match(body, /Hebe den Austritt auf/);
    // The alternative routes are gone: a refusal names the repair, not every other way round it.
    assert.ok(!/Nichtantreten|Gruppenphase/.test(body));

    const spieltag = build({ refusalCode: "REQ-SPIELTAG-001" });

    assert.deepEqual(ids(spieltag), ["spiel.spieltag-refused"]);
    assert.match(spieltag.find((banner) => banner.id === "spiel.spieltag-refused")?.body ?? "", /Ändere dort die Herkunft/);
  });

  // Danger for the colour a delivered refusal earns. It does NOT reach the save gate: the form
  // filters these two ids out of `resolveBlockingBanners`, a refusal being what already happened
  // rather than what a save would cause.
  it("gives both refusal banners the danger the save's own failure has", () => {
    for (const refusalCode of ["REQ-ELIGIBILITY-001", "REQ-SPIELTAG-001"] as const) {
      const [banner, ...rest] = build({ refusalCode });

      assert.equal(rest.length, 0, refusalCode);
      assert.equal(banner?.severity, "danger", refusalCode);
      assert.ok((banner?.body ?? "").length > 0, refusalCode);
    }
  });

  it("leaves both off a draft whose save was never refused", () => {
    const built = ids(build({ sonderereignis: "ausgefallen", voidedSpielNummern: [29], refusalCode: null }));

    assert.ok(!built.includes("spiel.eligibility-refused"));
    assert.ok(!built.includes("spiel.spieltag-refused"));
  });

  // `REQ-STATE-003` is the boundary case: it reaches the same map of refusals and deliberately stays
  // a field message, so a widened guard would ask the rail for an entry it does not have.
  it("narrows onto the two codes the rail answers and no third", () => {
    assert.ok(isSpielRefusalCode("REQ-ELIGIBILITY-001"));
    assert.ok(isSpielRefusalCode("REQ-SPIELTAG-001"));
    assert.ok(!isSpielRefusalCode("REQ-STATE-003"));
    assert.ok(!isSpielRefusalCode(undefined));
  });

  it("sorts danger over warning over info on the rail", () => {
    const built = resolveRailBanners(build({ sonderereignis: "ausgefallen", releasedSpielNummern: [31], voidedSpielNummern: [29] }));

    assert.deepEqual(
      built.map((banner) => banner.severity),
      ["danger", "warning", "info"],
    );
  });
});
