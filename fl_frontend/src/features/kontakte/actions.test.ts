import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `useRouter` reads the first and `useSearchParams` the
   second — and the seats below render under both. A Next release that moves either module fails this
   file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { deriveKontakteDraftStatus } from "./kontakteDraftStatus.ts";
import { describeKontaktErasureUmfang } from "./utils.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { FLKontaktErasureResponse } from "./schemas.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
/**
 * Read rather than called: what each case asserts is which module carries a step — which declares a
 * tier, which composes the report — and a call reports an outcome rather than the site.
 */
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
/** Whitespace-collapsed: the admin list page's copy is JSX text, so the formatter picks its line breaks. */
const PAGE_SOURCE = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "app", "admin", "kontakte", "page.tsx"), "utf8");
const SECTION = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminKontakteEditForm", "FormKontakteSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");
const PAGE = PAGE_SOURCE.replace(/\s+/g, " ");

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FormKontakteSection } = await import("./components/forms/AdminKontakteEditForm/FormKontakteSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { default: AdminKontaktePage } = await import("@/app/admin/kontakte/page.tsx");

/** What `useRouter` hands the erasure control. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const person = (vorname: string, nachname: string, email: string): FLKontaktperson => ({
  vorname,
  nachname,
  email,
  telefon: "069 111",
  geburtsdatum: "1990-12-10",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "1", datum: "2026-03-12" },
});

/** Three seats, each holding a different person, so an offer on the wrong one names the wrong name. */
const BLOCK: FLSaisonTeamKontakte = {
  trainer: person("Ada", "Byron", "ada@example.org"),
  ansprechperson: person("Grace", "Hopper", "grace@example.org"),
  stellvertretung: person("Alan", "Turing", "alan@example.org"),
  trainer_ist_zugleich: null,
};

/** The same three with no address, which is the one state the write has no key for. */
const BLOCK_OHNE_ADRESSE: FLSaisonTeamKontakte = {
  ...BLOCK,
  trainer: person("Ada", "Byron", ""),
  ansprechperson: person("Grace", "Hopper", ""),
  stellvertretung: person("Alan", "Turing", ""),
};

/** The seats under every context they read: the router, the query the way out rides, the draft status. */
const sectionMarkup = (kontakte: FLSaisonTeamKontakte): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2526") },
        h(DraftStatusProvider, {
          status: deriveKontakteDraftStatus({ stored: { kontakte }, draft: { kontakte }, fieldErrors: {} }),
          children: h(FormKontakteSection, {
            value: kontakte,
            isMember: true,
            teamHref: "/admin/teams/t1?saison_id=2526",
            banners: [],
            onChange: () => undefined,
            onFieldLeft: () => undefined,
            isDirty: false,
            onValidateSelection: () => undefined,
          }),
        }),
      ),
    ),
  );

/** One rendered seat per entry, cut at the next seat's own title. */
const seatPanels = (html: string): string[] => html.split("<h2").slice(1);

/** The list page's own return. Its table sits behind the boundary, whose fallback stands here. */
const PAGE_MARKUP = renderTree(
  h(
    AppRouterContext.Provider,
    { value: ROUTER },
    h(
      SearchParamsContext.Provider,
      { value: new URLSearchParams("saison_id=2526") },
      h(AdminKontaktePage, { params: Promise.resolve({}), searchParams: Promise.resolve({ saison_id: "2526" }) }),
    ),
  ),
);

const ERASURE_OPERATION = "POST /kontakte/erasure";

/* Each declaration is cut at the one named after it, the header above the first included: a boundary
   that stopped matching then fails the case pinning the cut rather than every case reading the slice. */
const ERASE_ACTION = sliceBetween(ACTIONS, "export async function eraseKontaktpersonAction", " * The three seats one club holds");
const ACTION_HEADER = sliceBetween(ACTIONS, '"use server"', "export async function eraseKontaktpersonAction");
/* The erasure's own half of `mutations.ts`. Cut, because the module holds the seats' write too, and
   an assertion over the whole file would answer about whichever of the two moved last. */
const ERASE_MUTATION = sliceBetween(MUTATIONS, "export async function eraseKontaktperson", "// Both ids go in the PATH");
const RESPONSE_SCHEMA = sliceBetween(SCHEMAS, "export const FLKontaktErasureResponseSchema", null);

/**
 * One function body's statements, comments and blank lines dropped. What the text tests below can
 * assert is the SHAPE of a handler; that it behaves is not reachable from here, and is said so at
 * each case rather than dressed up in a longer regex.
 */
function statementsOf(slice: string): string[] {
  return slice
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*"));
}

/** One response, spelled once so a report case names only the figures it is about. */
function erasure(counts: Partial<Omit<FLKontaktErasureResponse, "acknowledged">>): FLKontaktErasureResponse {
  return {
    acknowledged: 1,
    cleared_saison_teams: 0,
    cleared_bewerbungen: 0,
    cleared_kontakt_slots: 0,
    redacted_aktionen: 0,
    ...counts,
  };
}

describe("the erasure against the backend's refusal register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the action out of the file before reading it", () => {
    assert.ok(ERASE_ACTION.includes("eraseKontaktperson(validated.data)"), "the erasure's call is outside its slice");
    assert.ok(!ERASE_ACTION.includes("import {"), "the erasure's slice reaches back over the module's imports");
    assert.ok(!ERASE_ACTION.includes("patchSaisonTeamKontakte("), "the erasure's slice runs on into the seats' write");
    assert.ok(ERASE_MUTATION.includes('"/kontakte/erasure"'), "the erasure's mutation is outside its slice");
    assert.ok(!ERASE_MUTATION.includes("/saisons/"), "the erasure's mutation slice runs on into the seats' write");
    assert.ok(
      ACTION_HEADER.includes('eraseKontaktperson, patchSaisonTeamKontakte } from "./mutations"'),
      "the header's slice no longer holds the import",
    );
    assert.ok(RESPONSE_SCHEMA.includes("redacted_aktionen"), "the response schema's slice does not reach its fields");
  });

  /* The endpoint refuses nothing: a person may want their details gone while the club they were
     reached for still plays. A rule declared against it later fails here, rather than reaching the
     admin unmapped. */
  it("has no refusal to map, and maps none", () => {
    assert.deepEqual(declaredCodes(ERASURE_OPERATION), []);
    assert.ok(!ERASE_ACTION.includes("serverErrorCode"), "the erasure maps a code its endpoint does not answer");
    assert.ok(!ERASE_ACTION.includes("APIBadStatusError"), "the erasure catches a refusal its endpoint does not raise");
  });

  /* The floor under the case above: an empty list has to mean "this endpoint declares none" rather
     than "the register was read as nothing at all". */
  it("reads a declared refusal where one exists", () => {
    assert.deepEqual(declaredCodes("DELETE /spieler/{spieler_id}/erasure"), ["REQ-PURGE-001"]);
  });
});

describe("what the erasure moves", () => {
  /* No cached read holds a contact person: the memberships read is admin-tier and memoised per
     render pass, the public team reads carry no `kontakte` at all, and the applications and the log
     are uncached too. */
  it("invalidates nothing, and says why", () => {
    assert.ok(!ACTIONS.includes("updateTag("), "a contacts write clears a cached read its endpoint does not move");
    assert.ok(!ACTIONS.includes('from "next/cache"'), "a contacts write reaches the cache API for something");
    // Both of the module's writes, so a second one added without the reasoning fails here.
    assert.equal([...ACTIONS.matchAll(/Nothing to invalidate/g)].length, 2, "an absent invalidation is left unexplained");
  });

  /* The address travels in the BODY. A path or a query segment would file it in the access log, in
     nginx's log and in `aktionen.request.path` — three fresh copies of the value being destroyed. */
  it("sends the address in the body, to the erasure endpoint, as a POST", () => {
    assert.match(ERASE_MUTATION, /"\/kontakte\/erasure"/, "the mutation no longer addresses the erasure endpoint");
    assert.match(ERASE_MUTATION, /FLKontaktErasureResponseSchema,\s*\{\s*method: "POST"/, "the erasure is sent as something other than a POST");
    assert.match(ERASE_MUTATION, /body: JSON\.stringify\(payload\)/, "the payload no longer travels in the body");
    assert.ok(!ERASE_MUTATION.includes("params:"), "the address is sent as a query parameter, which the access log keeps");
    assert.ok(!/\$\{[^}]*\}/.test(ERASE_MUTATION), "the endpoint interpolates a value into the path");
  });

  /* The admin tier is what `apiClient` sends `X-FL-Actor` on, so any other tier is refused 401 and
     unattributable both. What is asserted is the tier every write DECLARES; a call would report one
     request's outcome rather than the set. */
  it("leaves at the admin tier and at no other", () => {
    // Every write in the module, not the erasure alone: both are admin-tier and a second one added
    // at any other tier is refused 401 and unattributable both.
    const tiers = [...MUTATIONS.matchAll(/authType: "(\w+)"/g)].map((match) => match[1]);

    assert.deepEqual(tiers, ["admin", "admin"], `the module's writes are sent at: ${tiers.join(", ") || "no tier at all"}`);
  });

  /* The response carries counts and no person, and nothing on this side may put one back. */
  it("reports counts and never the address", () => {
    assert.ok(!RESPONSE_SCHEMA.includes("email"), "the response mirror carries an address the endpoint withholds");
    assert.ok(!/\bemail\b/.test(ERASE_ACTION), "the action's own report reads the address it was handed");
    assert.match(ERASE_ACTION, /message: describeKontaktErasureUmfang\(erasure\)/, "the report is composed somewhere else now");
  });
});

describe("the report the toast carries", () => {
  /* An address naming nobody is an ordinary outcome rather than a failure: it is what the admin
     presses when they are not sure the person was ever recorded. */
  it("reports both counts, each with its own zero and its own singular", () => {
    assert.equal(
      describeKontaktErasureUmfang(erasure({})),
      "Zu dieser E-Mail-Adresse war nichts gespeichert. Im Änderungsprotokoll gab es dazu keinen Eintrag.",
    );
    assert.equal(
      describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 1 })),
      "Ein Kontakteintrag wurde geleert, in einer Saison-Zugehörigkeit und keiner Bewerbung. " +
        "Bei einem Eintrag im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt.",
    );
    assert.equal(
      describeKontaktErasureUmfang(
        erasure({ cleared_saison_teams: 2, cleared_bewerbungen: 3, cleared_kontakt_slots: 5, redacted_aktionen: 12 }),
      ),
      "5 Kontakteinträge wurden geleert, in 2 Saison-Zugehörigkeiten und 3 Bewerbungen. " +
        "Bei 12 Einträgen im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt.",
    );
  });

  /* GELEERT, never deleted: no log row is dropped, only the values one held. */
  it("claims of the log only what is true of a row that lost nothing", () => {
    const report = describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 4 }));

    // `build_redaction_filter` is not narrowed to rows holding an image, so a row recording an insert
    // is stamped and counted while losing nothing. „geleert“ and „gelöscht“ are both false of it.
    assert.match(report, /Bei 4 Einträgen im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt\./);
    assert.doesNotMatch(report, /Einträge im Änderungsprotokoll wurden geleert/, "the report empties a row that held nothing");
    assert.doesNotMatch(report, /Einträge im Änderungsprotokoll (wurden )?gelöscht/, "the report deletes a log row, and none is dropped");
    // The slots really are nulled, so the contact half keeps the verb the log half may not have.
    assert.match(
      describeKontaktErasureUmfang(erasure({ cleared_kontakt_slots: 2, cleared_saison_teams: 1 })),
      /Kontakteinträge wurden geleert/,
    );
  });

  /* A person swapped out of every seat clears no slot while the log still names them. As two
     sentences the pair contradicts itself, so the whole string is what this pins. */
  it("reports a cleared log beside no cleared slot as one coherent sentence", () => {
    assert.equal(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 1 })),
      "Zu dieser E-Mail-Adresse war kein aktueller Kontakteintrag gespeichert, nur noch ein Eintrag im Änderungsprotokoll, " +
        "und dort ist jetzt kein gesicherter Stand mehr hinterlegt.",
    );
    assert.equal(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 4 })),
      "Zu dieser E-Mail-Adresse war kein aktueller Kontakteintrag gespeichert, nur noch 4 Einträge im Änderungsprotokoll, " +
        "und dort ist jetzt kein gesicherter Stand mehr hinterlegt.",
    );
    // The claim the old wording made, and the one the pair cannot both hold.
    assert.doesNotMatch(
      describeKontaktErasureUmfang(erasure({ redacted_aktionen: 1 })),
      /war nichts gespeichert/,
      "the report denies a person the change log still named",
    );
    // „geleert“ and „gelöscht“ stay false of a log row here too: a row recording an insert is stamped
    // while losing nothing.
    assert.doesNotMatch(describeKontaktErasureUmfang(erasure({ redacted_aktionen: 4 })), /Änderungsprotokoll (wurden |wurde )?gel(eert|öscht)/);
  });

  /* A toast description stands on its own, with no figures beside it to carry the grammar. */
  it("writes whole sentences rather than a telegraphic list", () => {
    const reports = [
      describeKontaktErasureUmfang(erasure({})),
      describeKontaktErasureUmfang(erasure({ cleared_saison_teams: 1, cleared_kontakt_slots: 1, redacted_aktionen: 1 })),
      describeKontaktErasureUmfang(erasure({ cleared_bewerbungen: 3, cleared_kontakt_slots: 3, redacted_aktionen: 9 })),
    ];

    for (const report of reports) {
      assert.match(report, /^[A-ZÄÖÜ0-9]/, "the report opens lower-case");
      for (const satz of report.split(". ")) assert.match(satz, /\b(wurde|wurden|war|gab|ist)\b/, `„${satz}“ carries no verb`);
      // The endpoint withholds the person, and a report is the one place a copy could creep back in.
      assert.doesNotMatch(report, /@/, "the report names an address");
    }
  });
});

describe("where the control stands", () => {
  /* Keyed on the ADDRESS across every season and both collections, and the applications it also
     reaches appear on no row of the list, so a reader has to see whose data it is while reading what
     it takes. */
  it("stands inside the panel of the person it erases, never on the list", () => {
    // One offer per seat, each naming the person that seat holds and no other.
    assert.deepEqual(
      seatPanels(sectionMarkup(BLOCK)).map((seat) => /<strong>([^<]*)<\/strong>/.exec(seat)?.[1] ?? ""),
      ["Ada Byron", "Grace Hopper", "Alan Turing"],
      "a seat offers the erasure of somebody it does not hold, or offers none",
    );
    // The ADDRESS is the key the write travels with, and nothing paints a value the markup never shows.
    assert.match(SECTION, /<FormKontaktErasure email=\{person\.email\}/, "the erasure is keyed on something other than the seat's own address");

    assert.ok(!PAGE_MARKUP.includes("Kontaktperson löschen"), "the list's own chrome offers the erasure");
    /* The list's rows render behind the boundary that chrome carries, so what the table hands a row
       is read here rather than met in the markup above. */
    assert.ok(!PAGE.includes("FormKontaktErasure"), "the erasure is on the list, detached from the person");
  });

  /* The claim points two seats at one record. Offered on both, the same person would read as two, and
     the second press would erase somebody already gone. */
  it("offers it on the seat that holds the person, never on the mirrored copy", () => {
    const offers = (kontakte: FLSaisonTeamKontakte): boolean[] =>
      seatPanels(sectionMarkup(kontakte)).map((seat) => seat.includes("Kontaktperson löschen"));

    assert.deepEqual(offers(BLOCK), [true, true, true], "a seat holding a person offers no erasure, so the absences below prove nothing");
    // The Trainer IS the named seat's person here, so a second offer would erase somebody already gone.
    assert.deepEqual(
      offers({ ...BLOCK, trainer_ist_zugleich: "ansprechperson" }),
      [false, true, true],
      "the mirrored seat offers its own erasure",
    );
    // The address is the whole key, so a seat holding none can offer nothing to erase.
    assert.deepEqual(offers(BLOCK_OHNE_ADRESSE), [false, false, false], "a seat with no address offers an erasure keyed on nothing");
  });

  /* One `h1` per page and the shell owns it; the heading LEVEL is `PanelHeading`'s and pinned there. */
  it("raises no heading the shell already owns", () => {
    assert.ok(!PAGE_MARKUP.includes("<h1"), "the page's own chrome raises an h1 the shell already owns");
    /* The control that absence needs: the page's whole return is one boundary, so what renders is
       the fallback, and a page rendering nothing at all would satisfy the line above unread. */
    assert.ok(PAGE_MARKUP.includes('role="status"'), "the page's chrome renders nothing, so the absence above proves nothing");
    // The list itself renders behind the boundary, so what the table returns is read rather than met.
    assert.ok(!PAGE.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* The page's chrome may never wait on the list, and the fetch below the boundary may never run in
     the image build. */
  it("leaves the page's shape intact", () => {
    assert.match(PAGE, /export default function AdminKontaktePage/, "the page's default export became async");
    // The FIRST statement, not merely a present one: the image builder reaches no backend, so a fetch
    // ordered above this call runs at build time. `[\s\S]*?` would have admitted one in between.
    assert.equal(
      // Index 1: index 0 is the function's own signature, which the cut opens on.
      statementsOf(sliceBetween(PAGE_SOURCE, "async function KontakteTable", null))[1],
      "await connection();",
      "the data component no longer opens with await connection()",
    );
  });
});
