import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { resolveBlockingBanners, resolveRailBanners } from "@/shared/components/ui/railBanner.ts";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { SONDEREREIGNIS_LABELS, SPIEL_BESTAETIGUNG_FRIST_TAGE } from "../../../constants.ts";
import { FLSonderereignisSchema } from "../../../schemas.ts";
import { buildSpielBanners, isSpielRefusalBannerId, isSpielRefusalCode, wirdAngefragt } from "./banners.ts";

import type { SpielBanner, SpielBannerAnsetzung, SpielBannerSide } from "./banners.ts";

const side = (fieldName: "team1" | "team2", overrides: Partial<SpielBannerSide> = {}): SpielBannerSide => {
  const draft = {
    fieldName,
    label: fieldName === "team1" ? "Team 1" : "Team 2",
    quelle: null,
    team: null,
    ...overrides,
  };

  // Stored mirrors the draft unless a case says otherwise, which is a page at first paint. Only a
  // case about a takeover sets the two apart, so the rest keep reading as inherited situations.
  return { storedQuelle: draft.quelle, storedTeam: draft.team, ...draft };
};

/** The day every case is rendered on, and a fixture's day so many days after it. */
const HEUTE = "2026-10-19";
const tagNach = (tage: number): string => new Date(Date.parse(HEUTE) + tage * 86_400_000).toISOString().slice(0, 10);

const KEINE_ANSETZUNG: SpielBannerAnsetzung = { datum: null, uhrzeit: null, spielortId: null, team1Id: null, team2Id: null };

/** A fixture the sweep would ask about, on this day: a kick-off, a ground and both sides. */
const angesetzt = (datum: string | null): SpielBannerAnsetzung => ({
  datum: datum,
  uhrzeit: "14:30:00",
  spielortId: "spielort-a",
  team1Id: "team-a",
  team2Id: "team-b",
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
    hasShootOut: false,
    hasDecidedErgebnis: false,
    dropsShootOut: false,
    voidedSpielNummern: [],
    releasedSpielNummern: [],
    voidPreviewFailed: false,
    refusalCode: null,
    ansetzung: KEINE_ANSETZUNG,
    storedAnsetzung: KEINE_ANSETZUNG,
    isActiveSaison: true,
    isSpielSweepOn: true,
    austrittTage: [],
    today: HEUTE,
    ...overrides,
  });

const ids = (banners: readonly SpielBanner[]): string[] => banners.map((banner) => banner.id);

/** Whether the hourly pass asks about a fixture, one condition moved per row from a fixture it asks about. */
const ANFRAGE_IS_DUE_ROWS: unknown = [
  {
    fall: "a fixture set in full, three days out",
    anders: {},
    gefragt: true,
  },
  {
    fall: "tomorrow",
    anders: {
      tage: 1,
    },
    gefragt: true,
  },
  {
    fall: "the last day the pass asks about",
    anders: {
      tage: 21,
    },
    gefragt: true,
  },
  {
    fall: "a day past the last the pass asks about",
    anders: {
      tage: 22,
    },
    gefragt: false,
  },
  {
    fall: "today",
    anders: {
      tage: 0,
    },
    gefragt: false,
  },
  {
    fall: "yesterday",
    anders: {
      tage: -1,
    },
    gefragt: false,
  },
  {
    fall: "no date",
    anders: {
      tage: null,
    },
    gefragt: false,
  },
  {
    fall: "no kick-off",
    anders: {
      uhrzeit: null,
    },
    gefragt: false,
  },
  {
    fall: "no ground",
    anders: {
      spielort: null,
    },
    gefragt: false,
  },
  {
    fall: "no first side",
    anders: {
      team1: null,
    },
    gefragt: false,
  },
  {
    fall: "no second side",
    anders: {
      team2: null,
    },
    gefragt: false,
  },
  {
    fall: "a lone goal count",
    anders: {
      tore: 2,
    },
    gefragt: false,
  },
  {
    fall: "a lone shoot-out",
    anders: {
      elfmeterschiessen: {
        team1: 4,
        team2: 3,
      },
    },
    gefragt: false,
  },
  {
    fall: "called off",
    anders: {
      sonderereignis: "ausgefallen",
    },
    gefragt: false,
  },
  {
    fall: "a no-show",
    anders: {
      sonderereignis: "nichtantreten_team1",
    },
    gefragt: false,
  },
  {
    fall: "abandoned",
    anders: {
      sonderereignis: "abgebrochen",
    },
    gefragt: false,
  },
  {
    fall: "the second club gone before the day",
    anders: {
      austritt_tage: 1,
    },
    gefragt: false,
  },
  {
    fall: "the second club gone on the day",
    anders: {
      austritt_tage: 3,
    },
    gefragt: false,
  },
  {
    fall: "the second club gone after the day",
    anders: {
      austritt_tage: 4,
    },
    gefragt: true,
  },
];

/**
 * The rows both tiers run, each moving one thing of a fixture set in full three days out. Strict, so a row moving
 * something this tier does not read fails rather than passing on the unmoved fixture.
 */
const ANFRAGE_IS_DUE = z
  .array(
    z.strictObject({
      fall: z.string(),
      anders: z.strictObject({
        tage: z.int().nullable().optional(),
        uhrzeit: z.null().optional(),
        spielort: z.null().optional(),
        team1: z.null().optional(),
        team2: z.null().optional(),
        tore: z.int().optional(),
        elfmeterschiessen: z.strictObject({ team1: z.int(), team2: z.int() }).optional(),
        sonderereignis: FLSonderereignisSchema.optional(),
        austritt_tage: z.int().optional(),
      }),
      gefragt: z.boolean(),
    }),
  )
  .parse(ANFRAGE_IS_DUE_ROWS);

/** One row's fixture: set in full three days out, one thing moved. */
const zeilenAnsetzung = (anders: (typeof ANFRAGE_IS_DUE)[number]["anders"]): SpielBannerAnsetzung => ({
  ...angesetzt(anders.tage === undefined ? tagNach(3) : anders.tage === null ? null : tagNach(anders.tage)),
  ...(anders.uhrzeit === undefined ? {} : { uhrzeit: anders.uhrzeit }),
  ...(anders.spielort === undefined ? {} : { spielortId: anders.spielort }),
  ...(anders.team1 === undefined ? {} : { team1Id: anders.team1 }),
  ...(anders.team2 === undefined ? {} : { team2Id: anders.team2 }),
});

/** Whether the confirmation's lost-notice banner is raised. */
const sofort = (overrides: Partial<Parameters<typeof buildSpielBanners>[0]>): boolean =>
  ids(build(overrides)).includes("spiel.bestaetigung-sofort");

describe("buildSpielBanners", () => {
  it("raises nothing for an untouched knockout fixture with both sides wired", () => {
    expect(ids(build({ sides: [side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } })] }))).toStrictEqual([]);
  });

  it("says nothing about a manual side in the group phase, where there is no wiring to lose", () => {
    expect(ids(build({ isKnockout: false, sides: [side("team1"), side("team2")] }))).toStrictEqual([]);
  });

  it("gives the two sides distinct ids, which is what the React key now rests on", () => {
    const built = build({ sides: [side("team1"), side("team2")] });

    expect(ids(built)).toStrictEqual(["spiel.team1-manual", "spiel.team2-manual"]);
  });

  /* Two lines, and the rail is why the title may spell the picker's own choice back: it renders away
     from that control, so the state is named where it stands and the body carries the reach. */
  it("names the hand-set state in the title and what it costs in the body", () => {
    const [banner] = build({ sides: [side("team1")] });

    expect(banner?.title ?? "").toMatch(/Team 1 wird manuell gesetzt/);
    expect(banner?.body ?? "").toMatch(/nicht mehr verantwortlich für die Auswahl/);
  });

  /* Why colour and confirmation are two fields: an unwired slot is as wrong as the red says and as
     old as the stored fixture, so it stays loud on the rail and puts no question to the save. */
  it("grades a hand-set side danger without confirming a save over it", () => {
    const built = build({ sides: [side("team1"), side("team2")] });

    expect(built[0]?.severity).toBe("danger");
    expect(built[0]?.raisedBy).toBe("state");
    expect(resolveBlockingBanners(built)).toBe(null);
  });

  /* The other half of the same banner. Taking a wired slot over is the one moment the fixture stops
     being maintained, and it is this save that does it — so this is the case that must still ask. */
  it("confirms the save that takes a wired side over, while the inherited one stays quiet", () => {
    const takenOver = build({ sides: [side("team1", { storedQuelle: { type: "spiel", spiel_nr: 5, ausgang: "sieger" } })] });

    expect(takenOver[0]?.raisedBy).toBe("change");
    expect(ids(resolveBlockingBanners(takenOver) ?? [])).toStrictEqual(["spiel.team1-manual"]);
    expect(resolveBlockingBanners(build({ sides: [side("team1")] }))).toBe(null);
  });

  /* Same split, one banner down: fielding an unqualified team is worth a question when the draft is
     what fielded it, and nothing when the fixture arrived that way. */
  it("confirms an unqualified team this draft picked, and not one it inherited", () => {
    const picked = build({ sides: [side("team1", { team: team("t1", "Falken"), storedTeam: null })] });
    const inherited = build({ sides: [side("team1", { team: team("t1", "Falken") })] });

    expect(picked.find((banner) => banner.id === "spiel.team1-unqualified")?.raisedBy).toBe("change");
    expect(inherited.find((banner) => banner.id === "spiel.team1-unqualified")?.raisedBy).toBe("state");
  });

  /* The rule in one case: a fixture opened on its faults and left alone asks nothing, whatever the
     rail is showing. Both sides unwired, one of them fielding a team the bracket does not. */
  it("confirms nothing for a draft whose every fault predates it", () => {
    const stored = build({
      sides: [side("team1"), side("team2", { team: team("t2", "Falken") })],
      sonderereignis: "abgebrochen",
      hasDecidedErgebnis: true,
    });

    assert.ok(stored.every((banner) => banner.raisedBy === "state"));
    expect(resolveBlockingBanners(stored)).toBe(null);
  });

  it("confirms once the same draft causes something of its own", () => {
    const chosen = build({ isNewlyChosen: true, sonderereignis: "ausgefallen" });

    expect(resolveBlockingBanners(chosen)?.[0]?.id).toBe("spiel.sonderereignis-meaning");
  });

  /* The closed Herkunft row states its reason inside a popover and the two controls under it state
     none, so the rule they close on stands where the reader meets them. */
  it("states the rule behind a closed group placing on a round the bracket does not open on", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const [banner, ...rest] = build({ seedsFromTheGroups: false, sides: [seeded] });

    expect(rest.length).toBe(0);
    expect(banner?.id).toBe("spiel.team1-seed-closed");
    expect(banner?.inline).toBe("team1-herkunft");
    expect(banner?.title ?? "").toMatch(/Herkunft von Team 1 nur in der ersten KO-Runde/);
    // The fixture saves as it stands, so nothing under the title may offer a repair for a block.
    expect(banner?.body).toBe(undefined);
  });

  it("says it per side, so both sides of a hand-wired fixture carry their own", () => {
    const gruppe = { type: "gruppe", gruppe: "A", platz: 1 } as const;
    const built = build({ seedsFromTheGroups: false, sides: [side("team1", { quelle: gruppe }), side("team2", { quelle: gruppe })] });

    expect(ids(built)).toStrictEqual(["spiel.team1-seed-closed", "spiel.team2-seed-closed"]);
    expect(built[1]?.title ?? "").toMatch(/Team 2/);
  });

  it("leaves a match-fed and a hand-set side alone on that same round", () => {
    const fed = side("team1", { quelle: { type: "spiel", spiel_nr: 29, ausgang: "sieger" } });

    expect(ids(build({ seedsFromTheGroups: false, sides: [fed] }))).toStrictEqual([]);
    expect(ids(build({ seedsFromTheGroups: false, sides: [side("team2")] }))).toStrictEqual(["spiel.team2-manual"]);
  });

  /* A group fixture carrying wiring is refused under `REQ-WIRING-001` instead, whose repair is to
     drop the wiring rather than to move it onto an earlier match. */
  it("leaves it off a group-phase fixture, which this rule does not reach", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });

    expect(ids(build({ isKnockout: false, seedsFromTheGroups: false, sides: [seeded] }))).toStrictEqual([]);
  });

  /* `info` is what keeps it off the dialog, so it needs no place on the refusal list: the fixture
     saves as it stands, and a grade above `info` would confirm every unrelated edit of it. */
  it("grades the seeding rule as a standing property rather than a refusal", () => {
    const seeded = side("team1", { quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const built = build({ seedsFromTheGroups: false, sides: [seeded] });

    expect(built[0]?.severity).toBe("info");
    expect(resolveBlockingBanners(built)).toBe(null);
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
    expect(ids(resolveRailBanners(build({ sonderereignis: "ausgefallen" })))).toStrictEqual(["spiel.sonderereignis-standing"]);
  });

  /* The title is the whole note, and a body about how the fixture reads elsewhere would be false of
     a no-show, which reaches this note whenever the award replaces nothing. */
  it("states the standing note in its title alone, so it holds for a no-show too", () => {
    for (const sonderereignis of ["ausgefallen", "annulliert", "nichtantreten_team1"] as const) {
      const [banner] = resolveRailBanners(build({ sonderereignis }));

      expect(banner?.id, sonderereignis).toBe("spiel.sonderereignis-standing");
      expect(banner?.body, sonderereignis).toBe(undefined);
    }
  });

  // **The one member the standing note excludes**: an abandoned fixture IS still chased, so "wird
  // nicht mehr angemahnt" would be false of it.
  it("never claims an abandoned fixture stops being chased", () => {
    expect(ids(build({ sonderereignis: "abgebrochen" }))).toStrictEqual([]);
  });

  it("announces a change from one member to another, not only a first event", () => {
    const swapped = build({ isNewlyChosen: true, sonderereignis: "annulliert" });

    expect(swapped.find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "").toMatch(/zählt rückwirkend nicht mehr/);
  });

  it("gives each member its own meaning rather than one sentence for all five", () => {
    const titles = (["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"] as const).map(
      (sonderereignis) =>
        build({ isNewlyChosen: true, sonderereignis }).find((banner) => banner.id === "spiel.sonderereignis-meaning")?.title ?? "",
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  /* The picker above spells the member's own name, so a title opening with it is the second telling. */
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

    expect(one.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "").toMatch(/Spiel 29 unbesetzt/);
    expect(many.find((banner) => banner.id === "spiel.knockout-feeds")?.title ?? "").toMatch(/Spiele 29, 30 und 31 unbesetzt/);
  });

  /* `fl_frontend/src/features/spiele/utils.ts :: listDependentSpiele` matches a source naming THIS
     fixture and never walks on, so the title stops one round short of where the emptying stops. */
  it("names the rounds behind the fixtures the title can enumerate", () => {
    const built = build({ isNewlyChosen: true, sonderereignis: "ausgefallen", dependentSpielNummern: [29] });

    expect(built.find((banner) => banner.id === "spiel.knockout-feeds")?.body ?? "").toMatch(/Runden danach/);
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

      expect(refusal?.severity, sonderereignis).toBe("danger");
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

  /* Silent while the award replaces nothing, a warning once it does. The colour is the whole of what
     this decides; whether the save confirms is `raisedBy`'s, one case below. */
  it("raises the forfeit note only where the award would discard entered work", () => {
    const bare = build({ sonderereignis: "nichtantreten_team2" });
    const withGoals = build({ sonderereignis: "nichtantreten_team2", hasAnyTore: true });
    const withShootOut = build({ sonderereignis: "nichtantreten_team2", dropsShootOut: true });

    assert.ok(!ids(bare).includes("spiel.forfeit-awarded"));
    expect(withGoals.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity).toBe("warning");
    expect(withShootOut.find((banner) => banner.id === "spiel.forfeit-awarded")?.severity).toBe("warning");
  });

  // The record is entered work like the goals are, and the award replaces nothing of it -- so the
  // note that speaks for the forfeit is the one place the discard can be read.
  it("names the shoot-out the award discards, and confirms the save over it", () => {
    const built = build({ sonderereignis: "nichtantreten_team1", hasAnyTore: true, dropsShootOut: true });
    const forfeit = built.find((banner) => banner.id === "spiel.forfeit-awarded");

    expect(forfeit?.severity).toBe("warning");
    expect(resolveBlockingBanners(built)?.[0]?.id).toBe("spiel.forfeit-awarded");
    // The title carries both losses, so nothing under it states the second one again.
    expect(forfeit?.title ?? "").toMatch(/Elfmeterschießen/);
    expect(forfeit?.body).toBe(undefined);
  });

  /* An award standing over stored goals is how the fixture already reads, so the dialog is owed only
     where this edit picked the event or throws the shoot-out away. */
  it("confirms a forfeit only where this edit is what caused it", () => {
    const standing = build({ sonderereignis: "nichtantreten_team2", hasAnyTore: true });
    const chosen = build({ isNewlyChosen: true, sonderereignis: "nichtantreten_team2", hasAnyTore: true });
    const discarding = build({ sonderereignis: "nichtantreten_team2", hasAnyTore: true, dropsShootOut: true });

    expect(standing.find((banner) => banner.id === "spiel.forfeit-awarded")?.raisedBy).toBe("state");
    expect(chosen.find((banner) => banner.id === "spiel.forfeit-awarded")?.raisedBy).toBe("change");
    expect(discarding.find((banner) => banner.id === "spiel.forfeit-awarded")?.raisedBy).toBe("change");
  });

  it("says nothing about a shoot-out where none is being discarded", () => {
    const forfeit = build({ sonderereignis: "nichtantreten_team1", hasAnyTore: true }).find((banner) => banner.id === "spiel.forfeit-awarded");

    expect(forfeit?.title ?? "").not.toMatch(/Elfmeterschießen/);
    expect(forfeit?.body ?? "").not.toMatch(/Elfmeterschießen/);
  });

  // The one member for which the surviving warning text still reads correctly.
  it("keeps the ambiguity warning for an abandoned fixture carrying a decided result", () => {
    const built = build({ sonderereignis: "abgebrochen", hasDecidedErgebnis: true, hasAnyTore: true });

    assert.ok(ids(built).includes("spiel.abandoned-decided"));
    // Stored that way it is the reader's to reopen; picked here it is this save putting the question.
    expect(built.find((banner) => banner.id === "spiel.abandoned-decided")?.raisedBy).toBe("state");
    const picked = build({ isNewlyChosen: true, sonderereignis: "abgebrochen", hasDecidedErgebnis: true, hasAnyTore: true });

    expect(picked.find((banner) => banner.id === "spiel.abandoned-decided")?.raisedBy).toBe("change");
  });

  it("puts the void preview's fixture numbers in the title, where the consequence is", () => {
    const built = build({ voidedSpielNummern: [29, 30], releasedSpielNummern: [31] });

    expect(built.find((banner) => banner.id === "spiel.void-preview")?.title ?? "").toMatch(/Spielen 29 und 30/);
    expect(built.find((banner) => banner.id === "spiel.release-preview")?.title ?? "").toMatch(/Spiel 31 entfernt/);
  });

  /* A rail naming no fixture reads as a save that voids none, which a dry run that never answered did
     not say; and a save it cannot judge stays possible, so the line is no reason to confirm one. */
  it("says a failed void preview could not check, without naming a fixture or holding the save", () => {
    const built = build({ voidPreviewFailed: true });

    expect(built.map((banner) => [banner.id, banner.severity, banner.title])).toStrictEqual([
      ["spiel.void-preview-ungeprueft", "info", "Ob Spiele dadurch entfallen, konnte nicht geprüft werden"],
    ]);
    expect(resolveBlockingBanners(built)).toBe(null);
  });

  it("carries the remedies the two rail-backed refusals leave off their field message", () => {
    // `fl_backend/app/api/spiele/services.py :: find_eligibility_refusal` keys on the austritt date,
    // so lifting it clears the refusal in every phase, which is what the one repair rests on.
    const eligibility = build({ refusalCode: "REQ-ELIGIBILITY-001" });
    const body = eligibility.find((banner) => banner.id === "spiel.eligibility-refused")?.body ?? "";

    expect(ids(eligibility)).toStrictEqual(["spiel.eligibility-refused"]);
    expect(body).toMatch(/Hebe den Austritt auf/);
    // The alternative routes are gone: a refusal names the repair, not every other way round it.
    assert.ok(!/Nichtantreten|Gruppenphase/.test(body));

    const spieltag = build({ refusalCode: "REQ-SPIELTAG-001" });

    expect(ids(spieltag)).toStrictEqual(["spiel.spieltag-refused"]);
    expect(spieltag.find((banner) => banner.id === "spiel.spieltag-refused")?.body ?? "").toMatch(/Ändere dort die Herkunft/);
  });

  // Danger for the colour a delivered refusal earns. It does NOT reach the save gate: the form
  // filters these two ids out of `resolveBlockingBanners`, a refusal being what already happened
  // rather than what a save would cause.
  it("gives both refusal banners the danger the save's own failure has", () => {
    for (const refusalCode of ["REQ-ELIGIBILITY-001", "REQ-SPIELTAG-001"] as const) {
      const [banner, ...rest] = build({ refusalCode });

      expect(rest.length, refusalCode).toBe(0);
      expect(banner?.severity, refusalCode).toBe("danger");
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

  /* A date inside the deadline's days leaves the teams no notice: the next pass asks at once, and the
     link answers only that day. Whose doing it is decides whether the save confirms. */
  it("raises the confirmation's lost notice as this save's doing where the stored date was outside the window", () => {
    const banner = build({ ansetzung: angesetzt(tagNach(3)), storedAnsetzung: angesetzt(tagNach(30)) }).find(
      ({ id }) => id === "spiel.bestaetigung-sofort",
    );

    expect(banner?.raisedBy).toBe("change");
    expect(banner?.severity).toBe("warning");
    expect(banner?.inline, "the banner sits at a field rather than on the rail").toBe(null);
    expect(banner?.title).toBe(
      `Ein Spiel in den nächsten ${String(SPIEL_BESTAETIGUNG_FRIST_TAGE)} Tagen müssen die Teams noch am Tag der Anfrage bestätigen`,
    );
  });

  it("raises it as the fixture's standing state where the stored date was already inside the window", () => {
    const banner = build({ ansetzung: angesetzt(tagNach(2)), storedAnsetzung: angesetzt(tagNach(5)) }).find(
      ({ id }) => id === "spiel.bestaetigung-sofort",
    );

    expect(banner?.raisedBy).toBe("state");
  });

  /* The case a window check alone gets wrong: no pass asks about a fixture whose day has come. The deadline's last
     day still raises it, the first day past it does not. */
  it("raises nothing for a date in the past or today, whatever else is true, and nothing past the window", () => {
    for (const [datum, gespeichert] of [
      [tagNach(-2), tagNach(30)],
      [tagNach(-2), tagNach(3)],
      [HEUTE, tagNach(30)],
      [tagNach(SPIEL_BESTAETIGUNG_FRIST_TAGE + 1), tagNach(30)],
      [null, tagNach(3)],
    ] as const) {
      assert.ok(!sofort({ ansetzung: angesetzt(datum), storedAnsetzung: angesetzt(gespeichert) }), `raised for ${String(datum)}`);
    }
    assert.ok(
      sofort({ ansetzung: angesetzt(tagNach(SPIEL_BESTAETIGUNG_FRIST_TAGE)), storedAnsetzung: angesetzt(tagNach(30)) }),
      "the window's last day raised nothing",
    );
  });

  /* An unchanged stand mints nothing, so the near fixtures edited most often, a referee added, carry no warning. */
  it("raises nothing for a save that leaves the Ansetzung as it stands, however near the fixture", () => {
    assert.ok(!sofort({ ansetzung: angesetzt(tagNach(3)), storedAnsetzung: angesetzt(tagNach(3)) }));
  });

  /* Every input of the stand moves it, so each mints afresh and warns where the date is near. */
  it("raises it for a save moving any one input of the Ansetzung", () => {
    const gespeichert = angesetzt(tagNach(3));
    for (const anders of [{ uhrzeit: "18:00:00" }, { spielortId: "spielort-b" }, { team1Id: "team-c" }, { team2Id: "team-c" }] as const) {
      assert.ok(
        sofort({ ansetzung: { ...gespeichert, ...anders }, storedAnsetzung: gespeichert }),
        `raised nothing for ${Object.keys(anders)[0]}`,
      );
    }
  });

  /* Off, as it ships, the pass runs at all nowhere, which no fixture's fields can say. */
  it("raises nothing for a re-dated fixture while the confirmations' pass is switched off", () => {
    assert.ok(!sofort({ ansetzung: angesetzt(tagNach(3)), storedAnsetzung: angesetzt(tagNach(30)), isSpielSweepOn: false }));
  });

  /* The pass visits the running season alone, which the table below cannot say: it holds a fixture's own fields. */
  it("raises nothing for a re-dated fixture of a season not yet running", () => {
    assert.ok(!sofort({ ansetzung: angesetzt(tagNach(3)), storedAnsetzung: angesetzt(tagNach(30)), isActiveSaison: false }));
  });

  /* Each row of the table the pass shares, through the banner: raised where the pass asks inside the deadline's days. */
  for (const { fall, anders, gefragt } of ANFRAGE_IS_DUE) {
    it(`raises it for a re-dated fixture, ${fall}, exactly where the pass asks inside the deadline's days`, () => {
      const tage = anders.tage === undefined ? 3 : anders.tage;

      expect(
        sofort({
          ansetzung: zeilenAnsetzung(anders),
          storedAnsetzung: angesetzt(tagNach(30)),
          hasAnyTore: anders.tore !== undefined,
          hasShootOut: anders.elfmeterschiessen !== undefined,
          sonderereignis: anders.sonderereignis ?? null,
          austrittTage: anders.austritt_tage === undefined ? [] : [tagNach(anders.austritt_tage)],
        }),
      ).toBe(gefragt && tage !== null && tage <= SPIEL_BESTAETIGUNG_FRIST_TAGE);
    });
  }

  it("sorts danger over warning over info on the rail", () => {
    const built = resolveRailBanners(build({ sonderereignis: "ausgefallen", releasedSpielNummern: [31], voidedSpielNummern: [29] }));

    expect(built.map((banner) => banner.severity)).toStrictEqual(["danger", "warning", "info"]);
  });
});

describe("wirdAngefragt", () => {
  /* The editor's warning speaks of a request the pass would send, so it reads the pass's own conditions
     (`fl_backend/app/api/spielbestaetigungen/services.py :: anfrage_is_due`). */
  for (const { fall, anders, gefragt } of ANFRAGE_IS_DUE) {
    it(`asks about a fixture exactly where the pass does: ${fall}`, () => {
      expect(
        wirdAngefragt(zeilenAnsetzung(anders), {
          isActiveSaison: true,
          hasAnyTore: anders.tore !== undefined,
          hasShootOut: anders.elfmeterschiessen !== undefined,
          sonderereignis: anders.sonderereignis ?? null,
          austrittTage: anders.austritt_tage === undefined ? [] : [tagNach(anders.austritt_tage)],
          today: HEUTE,
        }),
      ).toBe(gefragt);
    });
  }
});
