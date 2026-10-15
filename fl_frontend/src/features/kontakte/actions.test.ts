import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { FLSaisonSchema } from "@/features/saisons/schemas.ts";
import { FLTeamWithMembershipsSchema } from "@/features/teams/schemas.ts";
import { submitDecision } from "@/shared/hooks/useDraftFieldErrors";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { kenntnisnahme } from "@/shared/testing/kenntnisnahme.ts";
import { membershipAnswer } from "@/shared/testing/membershipFixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, renderPage, saisonFields } from "@/shared/testing/pageHarness.ts";
import { renderTree } from "@/shared/testing/renderTest";

import { FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas.ts";
import { mirrorKontakte, toKontaktePayload } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/features/teams/schemas";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { default: AdminKontaktePage } = await import("@/app/bereich/admin/kontakte/page.tsx");

/** A number per person: two seats sharing one are refused as one person entered twice. */
const TELEFON: Record<string, string> = { Ada: "069 111", Grace: "069 222", Alan: "069 333" };

const person = (vorname: string, nachname: string, email: string): FLKontaktperson => ({
  vorname,
  nachname,
  email,
  telefon: TELEFON[vorname] ?? "069 444",
  geburtsdatum: "1990-12-10",
  einwilligung: kenntnisnahme({ erfasst_von: "person", text_version: "1", datum: "2026-03-12", bestaetigt_am: "2026-03-14" }),
});

/** Three seats, each holding a different person, so an offer on the wrong one names the wrong name. */
const BLOCK: FLSaisonTeamKontakte = {
  trainer: person("Ada", "Byron", "ada@example.org"),
  ansprechperson: person("Grace", "Hopper", "grace@example.org"),
  stellvertretung: person("Alan", "Turing", "alan@example.org"),
  trainer_ist_zugleich: null,
};

/** The list page at the address naming the season `BLOCK` is held in. */
const listPage = () =>
  underNext(h(AdminKontaktePage, { params: Promise.resolve({}), searchParams: Promise.resolve({ saison_id: "2526" }) }), {
    search: "saison_id=2526",
  });

/** The season the address names. */
const SAISON = answer(FLSaisonSchema, "/saisons/list/admin", saisonFields("2526", "active"));

/* One club holding `BLOCK` in the season the address names; every other read takes the emptiest
   body its schema accepts. */
answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON] });
  if (endpoint === "/teams/memberships") {
    const club = answer(FLTeamWithMembershipsSchema, endpoint, {
      id: OBJECT_ID,
      name: "SG Alpha",
      shorthand: "SA",
      full_name: "Sportgemeinschaft Alpha",
      address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
      memberships: [membershipAnswer({ kontakte: BLOCK, kontakte_stand: "9f2c" })],
    });
    return answer(schema, endpoint, { teams: [club] });
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/** The list page resolved whole, its table and every row in it. */
const LIST_MARKUP = await renderPage(listPage());

describe("the list page", () => {
  /* One `h1` per page and the shell owns it; the heading LEVEL is `PanelHeading`'s and pinned there. */
  it("raises no heading the shell already owns", () => {
    // The control: a page rendering no row at all would satisfy the absence below unread.
    assert.ok(LIST_MARKUP.includes("Hopper"), "the list renders no row, so the absence below proves nothing");
    assert.ok(!LIST_MARKUP.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* The page's chrome may never wait on the list: rendered with no boundary awaited, the bar stands
     beside the list's fallback, where an async page would suspend whole. */
  it("renders its chrome before the list resolves", () => {
    const chrome = renderTree(listPage());

    assert.ok(chrome.includes('role="status"'), "no fallback stands where the list will resolve");
    assert.ok(chrome.includes('type="search"'), "the page's bar waits on the list");
  });
});

describe("what the save hands the write", () => {
  /* Sent as the read model spells it, a seat the person widened for WhatsApp blocks the editor's own
     guard at a path no control renders, so the row stops being editable at all. */
  it("takes a seat the person widened and writes it at the scope an administrator may spell", () => {
    const trainer = person("Ada", "Byron", "ada@example.org");
    const storedBlock: FLSaisonTeamKontakte = {
      ...BLOCK,
      trainer: { ...trainer, einwilligung: { ...trainer.einwilligung, umfang: "kontaktdaten_whatsapp" } },
    };
    // Composed exactly as the editor composes it
    // (`fl_frontend/src/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx :: buildPayload`).
    const payload = {
      team_id: "507f1f77bcf86cd799439011",
      saison_id: "2526",
      kontakte: toKontaktePayload(mirrorKontakte(storedBlock)),
      kontakte_stand: "9f2c",
    };

    const decision = submitDecision({ payloads: { kontakte: payload }, schemas: { kontakte: FLPatchSaisonTeamKontaktePayloadSchema } });
    assert.equal(decision.blocked, false, "the editor's own guard refuses a block the season already holds");

    // The action's own parse, so what this reads is what `patchSaisonTeamKontakte` is handed.
    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(payload);
    assert.ok(validated.success, "the write refuses the block a confirmed seat leaves");
    assert.equal(validated.data.kontakte?.trainer?.einwilligung.umfang, "kontaktdaten", "an administrative save asserts the person's own tick");
    assert.equal(validated.data.kontakte?.ansprechperson?.einwilligung.umfang, "kontaktdaten");
  });
});
