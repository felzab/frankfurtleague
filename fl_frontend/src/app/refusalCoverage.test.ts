import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { isRefusalCode } from "@/core/errors.ts";
import { keyTierOf } from "@/core/keyTiers.ts";
import { publishedOperations } from "@/core/openapiDocument.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

/* The request the public mappers' reads and the undo spine load in, doubled before the `await import`s below. */
doubleActionRequest();
registerHooks({
  // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});

const { answerSettled } = await import("@/shared/testing/publishedRefusals.ts");
const { replayRefusal } = await import("@/shared/utils/undoRoute.ts");
const bewerbungen = await import("@/features/bewerbungen/refusals.ts");
const { BEWERBUNG_MIN_ALTER } = await import("@/features/bewerbungen/constants.ts");
const bewerbungUtils = await import("@/features/bewerbungen/utils.ts");
const einladungen = await import("@/features/einladungen/refusals.ts");
const kontakte = await import("@/features/kontakte/refusals.ts");
const registrierungen = await import("@/features/registrierungen/utils.ts");
const { REGISTRIERUNG_MIN_ALTER } = await import("@/features/registrierungen/constants.ts");
const saisons = await import("@/features/saisons/refusals.ts");
const schiedsrichter = await import("@/features/schiedsrichter/refusals.ts");
const schiedsrichterQueries = await import("@/features/schiedsrichter/queries.ts");
const { SCHIEDSRICHTER_MIN_ALTER } = await import("@/features/schiedsrichter/constants.ts");
const sperrliste = await import("@/features/sperrliste/refusals.ts");
const spiele = await import("@/features/spiele/refusals.ts");
const spieler = await import("@/features/spieler/refusals.ts");
const spielorte = await import("@/features/spielorte/refusals.ts");
const spieltage = await import("@/features/spieltage/refusals.ts");
const teams = await import("@/features/teams/refusals.ts");

type Mapper = (error: unknown) => unknown;

/** The operation's refusals go to the shared reader alone, which words the unique index's and no other. */
const SHARED_READER: Mapper = () => null;

/**
 * The mapper each write consults for an operation's refusals, a read's context fixed where the mapper
 * takes one. That the write does consult it is its slice suite's to hold
 * (`fl_frontend/src/shared/testing/publishedRefusals.ts :: assertEachAnswered`).
 */
const ANSWERED_BY: Readonly<Record<string, Mapper>> = {
  "POST /bewerbungen": bewerbungUtils.mapBewerbungSubmitRefusal,
  "POST /bewerbungen/einwilligung": (error) => bewerbungUtils.mapEinwilligungRefusal(error, BEWERBUNG_MIN_ALTER),
  "POST /bewerbungen/einwilligung/ansicht": bewerbungUtils.mapEinwilligungAnsichtRefusal,
  "POST /bewerbungen/{bewerbung_id}/annehmen": (error) => bewerbungen.mapTriageRefusal(error, "neue_schule"),
  "POST /bewerbungen/{bewerbung_id}/ablehnen": (error) => bewerbungen.mapTriageRefusal(error, null),
  "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut": bewerbungen.mapEinwilligungErneutRefusal,
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}/email": bewerbungen.mapKontaktEmailRefusal,
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}": bewerbungen.mapKontaktSitzRefusal,
  "POST /teams/{team_id}/saisons/{saison_id}/einladung": einladungen.mapEinladungRefusal,
  "DELETE /teams/{team_id}/saisons/{saison_id}/einladung": SHARED_READER,
  "POST /saisons/{saison_id}/einladungen/versand": einladungen.mapEinladungRefusal,
  "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte": kontakte.mapStaleBlockRefusal,
  "POST /kontakte/erasure": SHARED_READER,
  "POST /registrierungen": registrierungen.mapRegistrierungSubmitRefusal,
  "POST /registrierungen/bestaetigung": (error) => registrierungen.mapBestaetigungRefusal(error, async () => REGISTRIERUNG_MIN_ALTER),
  "POST /registrierungen/einladung/ansicht": registrierungen.mapRegistrierungAnsichtRefusal,
  "POST /registrierungen/bestaetigung/ansicht": registrierungen.mapRegistrierungAnsichtRefusal,
  "POST /saisons": (error) => saisons.mapRulesRefusal(error) ?? saisons.mapSaisonIdRefusal(error),
  "PATCH /saisons/{saison_id}": saisons.mapRulesRefusal,
  "POST /saisons/{saison_id}/activate": saisons.mapActivateRefusal,
  "POST /saisons/{saison_id}/gruppen/swap": saisons.mapSwapRefusal,
  "POST /saisons/{saison_id}/spielplan": (error) => saisons.mapSpielplanRefusal(error, false),
  "DELETE /saisons/{saison_id}/spielplan": saisons.mapUndrawRefusal,
  "POST /schiedsrichter": (error) => schiedsrichter.mapNameRefusal(error) ?? schiedsrichter.mapGesperrteAdresseRefusal(error),
  "PATCH /schiedsrichter/{schiedsrichter_id}": (error) =>
    schiedsrichter.mapNameRefusal(error) ?? schiedsrichter.mapGesperrteAdresseRefusal(error),
  "DELETE /schiedsrichter/{schiedsrichter_id}": schiedsrichter.mapRetireRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/reactivate": schiedsrichter.mapReactivateRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen": schiedsrichter.mapEinladenRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/anonymisieren": schiedsrichter.mapAnonymiseRefusal,
  "POST /schiedsrichter/bestaetigung": (error) =>
    schiedsrichterQueries.mapSchiedsrichterBestaetigungRefusal(error, async () => SCHIEDSRICHTER_MIN_ALTER),
  "POST /schiedsrichter/bestaetigung/ansicht": schiedsrichterQueries.mapSchiedsrichterAnsichtRefusal,
  "POST /sperrliste": sperrliste.mapAdresseRefusal,
  "PATCH /spiele/{spiel_id}": spiele.mapSpielRefusal,
  // Written by the undo route's replay alone.
  "PATCH /spiele/paarungen": (error) => replayRefusal(error, spiele.PAARUNGEN_REPLAY_REFUSALS) ?? null,
  "DELETE /spieler/{spieler_id}/erasure": spieler.mapErasureRefusal,
  "POST /spieler/{spieler_id}/saisons": (error) => spieler.mapSquadRefusal(error) ?? spieler.mapAlreadyInSaisonRefusal(error),
  "PATCH /spieler/{spieler_id}/saisons/{saison_id}": spieler.mapSquadRefusal,
  "DELETE /spieler/{spieler_id}/saisons/{saison_id}": SHARED_READER,
  "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate": spieler.mapSquadRefusal,
  "POST /spielorte": spielorte.mapNameRefusal,
  "PATCH /spielorte/{spielort_id}": spielorte.mapNameRefusal,
  "DELETE /spielorte/{spielort_id}": spielorte.mapRetireRefusal,
  "POST /spielorte/{spielort_id}/reactivate": SHARED_READER,
  "PATCH /spieltage/{spieltag_id}": spieltage.mapSpieltagRefusal,
  "POST /teams": (error) => teams.mapShorthandRefusal(error, teams.SHORTHAND_TAKEN_ON_CREATE),
  "PATCH /teams/{team_id}": (error) => teams.mapShorthandRefusal(error, teams.SHORTHAND_TAKEN_ON_EDIT),
  "DELETE /teams/{team_id}": teams.mapRetireRefusal,
  "POST /teams/{team_id}/reactivate": SHARED_READER,
  "POST /teams/{team_id}/saisons": (error) => teams.mapEntryRefusal(error) ?? teams.mapAlreadyEnteredRefusal(error),
  "PATCH /teams/{team_id}/saisons/{saison_id}": teams.mapEntryRefusal,
  "POST /teams/{team_id}/saisons/{saison_id}/replace": teams.mapReplacementRefusal,
};

/**
 * Every operation outside the system tier the document publishes a refusal code on, with those codes.
 * Left out on the premise that a system caller hands no refusal to a person, the way
 * `fl_frontend/src/features/zustellung/notifications.ts :: meldeAngenommen` catches and logs one.
 */
const REFUSING = new Map(
  publishedOperations()
    .filter(({ declaration }) => keyTierOf(declaration) !== "system")
    .map(({ operation, answers }) => [operation, [...new Set(answers.map(({ code }) => code).filter(isRefusalCode))]] as const)
    .filter(([, codes]) => codes.length > 0),
);

describe("every published refusal against the mapper answering it", () => {
  /* Two listings reached by different routes, the document's and this table's, required to agree: a
     reader of the document that found nothing fails here rather than asking about nothing. */
  it("names a mapper for exactly the operations the document publishes a refusal on", () => {
    assert.deepEqual(
      [...REFUSING.keys()].filter((operation) => !Object.hasOwn(ANSWERED_BY, operation)).sort(),
      [],
      "a published refusal no mapper answers",
    );
    assert.deepEqual(
      Object.keys(ANSWERED_BY)
        .filter((operation) => !REFUSING.has(operation))
        .sort(),
      [],
      "a mapper for an operation that publishes no refusal",
    );
  });

  /* A code no mapper words reaches a person as the shared fallback, which names no reason and sends the
     admin to a retry the same rule refuses again (`.claude/rules/cross-surface.md`). */
  it("answers every published refusal code in its own words, at whatever status its rule answers", async () => {
    const unworded: string[] = [];
    for (const [operation, codes] of REFUSING) {
      const mapper = ANSWERED_BY[operation];
      if (mapper === undefined) continue;

      for (const code of codes) {
        if ((await answerSettled(operation, code, mapper)) === null) unworded.push(`${code} on ${operation}`);
      }
    }

    assert.deepEqual(unworded, []);
  });
});
