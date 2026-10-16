import "@/shared/testing/dom.ts";
import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { act, createElement as h, useState } from "react";
import { useRouter } from "next/navigation";

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { person, sitz } from "@/core/subjectFixtures.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { FLSaisonSchema } from "@/features/saisons/schemas.ts";
import { FLTeamSchema } from "@/features/teams/schemas.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { laufendeKontaktFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { membershipAnswer } from "@/shared/testing/membershipFixtures.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import {
  answer,
  answerReadsWith,
  EMPTIEST_ANSWER,
  isNavigation,
  OBJECT_ID,
  redirectTarget,
  resolvedPage,
  saisonFields,
} from "@/shared/testing/pageHarness.ts";

import type { Sicherheit } from "@/features/konto/types.ts";
import type { Navigations } from "@/shared/testing/nextContexts.ts";
import type { AnswerSchema } from "@/shared/testing/pageHarness.ts";
import type { ReactNode } from "react";

doubleEveryAction();
/* Signed in as somebody every area admits: an administrator holding a seat on the club and season
   every address names, a pupil record and a referee record. A public page is visited signed out. */
const { setSession } = doubleActionRequest({
  subject: person(
    {
      sitze: [sitz({ team_id: OBJECT_ID, saison_id: "2026" })],
      spieler: [{ spieler_id: OBJECT_ID }],
      schiedsrichter: [{ schiedsrichter_id: OBJECT_ID }],
      verwaltung: "administration",
      berechtigt_seit: "2026-01-01T00:00:00Z",
    },
    true,
  ),
});

/** The account page's security section, whose real read opens the sign-in store's database. */
const SICHERHEIT: Sicherheit = {
  passkeys: [
    { id: "eins", name: "Laptop", anbieter: null, eingerichtetAm: "2026-09-01T08:00:00.000Z", zuletztVerwendetAm: null, diesesGeraet: true },
  ],
  kannHinzufuegen: true,
  anmeldungen: [],
  verwaltung: true,
  inhaberId: "doubled-user",
  inhaberAdresse: "pia@example.org",
  freshUntil: null,
  enrolmentUntil: null,
  servedAt: 0,
};
registerDoubles({ modules: { "features/konto/sicherheit.ts": { readSicherheit: () => Promise.resolve(SICHERHEIT) } } });

/** Open for applications and for registrations, so the public forms render rather than their closed panels. */
const FENSTER = { offen: true, von: "2026-01-01", bis: "2026-12-31" };

const SAISON = FLSaisonSchema.parse({
  ...saisonFields("2026", "active"),
  start_date: "2026-03-07",
  end_date: "2026-10-31",
  schedule: [],
  spielplan: null,
  bewerbung: FENSTER,
  registrierung: FENSTER,
});

const ADDRESS = { strasse: "Hauptstraße", hausnummer: "1", plz: "60311", stadtteil: "", stadt: "Frankfurt am Main" };

/** The club every address names, in the fields each of its reads shares. */
const CLUB = {
  id: OBJECT_ID,
  name: "FC Alpha",
  shorthand: "AL",
  description: "",
  full_name: "FC Alpha Frankfurt",
  website_url: null,
  address: ADDRESS,
  schulform: null,
  inactive_since: null,
};

/** A squad row of the player every address names, on that club in that season. */
const KADER_ZEILE = {
  spieler_id: OBJECT_ID,
  vorname: "Ada",
  nachname: null,
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: false,
};

/** The fields each record a page opens by its address carries, by the read listing it. */
const LISTED: Readonly<Record<string, Record<string, unknown>>> = {
  "/teams/memberships": { teams: [{ ...CLUB, memberships: [membershipAnswer({ saison_id: "2026" })] }] },
  "/spieler/memberships": {
    spieler: [
      {
        id: OBJECT_ID,
        vorname: "Ada",
        nachname: null,
        inactive_since: null,
        geburtsdatum: null,
        einwilligung: null,
        email: null,
        memberships: [{ ...KADER_ZEILE, saison_id: "2026", team_id: OBJECT_ID }],
      },
    ],
  },
  "/spielorte": {
    spielorte: [
      {
        id: OBJECT_ID,
        name: "Sportpark Nord",
        maps_link: "https://maps.example.org",
        default_mietpreis: 0,
        inactive_since: null,
        address: ADDRESS,
      },
    ],
  },
  [`/spieler/kader/${OBJECT_ID}/2026`]: { team_id: OBJECT_ID, saison_id: "2026", erlaubte_stufen: ["Q1"], kader: [KADER_ZEILE] },
};

/** What a read answers wherever its schema takes it: a link still valid, a window running, a person named. */
const OPEN: Readonly<Record<string, unknown>> = {
  zustand: "gueltig",
  laeuft: true,
  offen: true,
  vorname: "Ada",
  kader_frei: true,
  team_eingetragen: true,
  saison_id: "2026",
  erlaubte_stufen: ["Q1"],
  // A label the registry runs: the contact confirmation renders its words or no form.
  laufende_fassung: laufendeKontaktFassung().textVersion,
};

/** The members of `schema` a read can be answered as: itself, or each member of its union. */
const members = (schema: AnswerSchema): AnswerSchema[] =>
  [schema, ...(schema.def?.options ?? [])].filter((member) => member.shape !== undefined);

/** The first member answering with `OPEN`'s fields where its own take them, and a grouped teams read grouped. */
function opened(endpoint: string, schema: AnswerSchema, params: Record<string, unknown>): unknown {
  for (const member of members(schema)) {
    const fields = Object.fromEntries(Object.entries(OPEN).filter(([key, value]) => member.shape?.[key]?.safeParse(value).success === true));
    if (params.in_gruppen === true && member.shape?.format?.values?.has("grouped") !== true) continue;
    try {
      return answer(member, endpoint, fields);
    } catch {
      // The next member, where this one's other fields take no empty value.
    }
  }
  return EMPTIEST_ANSWER(endpoint, schema, params);
}

/* One running season, the club, player, venue and squad every address names, and every link and
   window open: a read answered empty ends a page at its not-found or closed panel, before any field. */
answerReadsWith((endpoint, schema, params) => {
  if (endpoint.startsWith("/einwilligung/")) return einwilligungAnswer(endpoint);
  if (endpoint === "/saisons/current") return answer(schema, endpoint, { saison: SAISON });
  if (endpoint === "/saisons" || endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON] });
  if (endpoint === `/teams/${OBJECT_ID}`) return answer(schema, endpoint, { team: answer(FLTeamSchema as AnswerSchema, endpoint, CLUB) });
  const listed = LISTED[endpoint];
  if (listed !== undefined) return answer(schema, endpoint, listed);
  return opened(endpoint, schema, params);
});

/** The pages a link from a mail opens, which show their form only for the token it carries. */
const LINKED: ReadonlySet<string> = new Set([
  "(public)/registrierung/page.tsx",
  "(public)/bestaetigung/kontakt/page.tsx",
  "(public)/bestaetigung/schiedsrichter/page.tsx",
  "(public)/bestaetigung/schiedsrichter/adresse/page.tsx",
  "(public)/bestaetigung/spieler/page.tsx",
]);

/** Every URL the page's own script requested. */
const requested: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
  requested.push(input instanceof Request ? input.url : String(input));
  return new Promise<never>(() => undefined);
}) as typeof fetch;
window.XMLHttpRequest.prototype.open = function (_method: string, url: string | URL) {
  requested.push(String(url));
};
window.XMLHttpRequest.prototype.send = () => undefined;

/* jsdom loads no other document, and says so on the console rather than moving `location`: the one
   trace a `location.assign` leaves. The control below fails if its wording moves. */
const LEFT_DOCUMENT = /Not implemented: navigation/;

const APP_DIR = import.meta.dirname;
const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 40);
const label = (page: string) => path.relative(APP_DIR, page).split(path.sep).join("/");

/** One value per dynamic segment, and the address the page answers at with them. */
function addressOf(page: string): { params: Record<string, string | string[]>; pathname: string } {
  const params: Record<string, string | string[]> = {};
  const parts: string[] = [];
  for (const segment of path.relative(APP_DIR, path.dirname(page)).split(path.sep)) {
    // A route group names no segment of the address.
    if (segment === "" || /^\(.+\)$/.test(segment)) continue;
    const dynamic = /^\[(\.\.\.)?(\w+)\]$/.exec(segment);
    if (dynamic === null) {
      parts.push(segment);
      continue;
    }
    const name = dynamic[2]!;
    const value = dynamic[1] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : OBJECT_ID;
    params[name] = value;
    parts.push(Array.isArray(value) ? value.join("/") : value);
  }
  return { params, pathname: `/${parts.join("/")}` };
}

/** One field typed into, by its accessible name, and every way out of the page its marker took. */
type Field = { name: string; traces: string[] };

const ROLES = ["textbox", "searchbox", "combobox"] as const;

/** A marker no other text holds, and no other field's marker holds either. */
const markerOf = (index: number) => `zzmarke${String(index)}zz`;

const carries = (text: string, marker: string) => text.toLowerCase().includes(marker);

const ADDRESS_ATTRIBUTES = ["href", "src", "action", "formaction"];

/** The fields a person can type into, among what the page shows now. */
const typeable = (document: Document): (HTMLInputElement | HTMLTextAreaElement)[] =>
  [...new Set(ROLES.flatMap((role) => within(document.body).queryAllByRole(role)))].filter(
    (field): field is HTMLInputElement | HTMLTextAreaElement =>
      (field instanceof window.HTMLInputElement || field instanceof window.HTMLTextAreaElement) && !field.disabled && !field.readOnly,
  );

/** What a field's marker is looked for in, recorded as the page runs. */
type Ways = { seen: Navigations; prefetched: string[]; loads: string[] };

/**
 * Focuses `field`, types `marker` into it, presses Enter and leaves it, runs every timer that set, and
 * names each way out of the page the marker took.
 */
async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, marker: string, { seen, prefetched, loads }: Ways): Promise<Field> {
  const from = {
    href: window.location.href,
    pushed: seen.pushed.length,
    replaced: seen.replaced.length,
    prefetched: prefetched.length,
    requested: requested.length,
    loads: loads.length,
  };

  // Every timer on the case's own clock, so a write owed after any debounce is flushed here.
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: marker } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(field, { key: "Enter", code: "Enter" });
    fireEvent.blur(field);
    await act(async () => {
      mock.timers.runAll();
    });
  } finally {
    mock.timers.reset();
  }
  await act(async () => undefined);

  const linked = [...field.ownerDocument.querySelectorAll(ADDRESS_ATTRIBUTES.map((name) => `[${name}]`).join(", "))].flatMap((element) =>
    ADDRESS_ATTRIBUTES.flatMap((name) => {
      const value = element.getAttribute(name);
      return value !== null && carries(value, marker) ? [`<${element.tagName.toLowerCase()} ${name}="${value}">`] : [];
    }),
  );
  return {
    name: (field.getAttribute("aria-label") ?? field.labels?.[0]?.textContent ?? field.name).trim(),
    traces: [
      ...seen.pushed.slice(from.pushed).map((href) => `router.push ${href}`),
      ...seen.replaced.slice(from.replaced).map((href) => `router.replace ${href}`),
      ...prefetched
        .slice(from.prefetched)
        .filter((href) => carries(href, marker))
        .map((href) => `router.prefetch ${href}`),
      ...(window.location.href === from.href ? [] : [`location ${window.location.href}`]),
      ...loads.slice(from.loads).map(() => "a document load"),
      ...requested
        .slice(from.requested)
        .filter((url) => carries(url, marker))
        .map((url) => `request ${url}`),
      ...linked,
    ],
  };
}

/** A closed list's trigger, whose popover can hold a field of its own, as a picker's search box. */
const CLOSED_LIST = '[aria-haspopup="listbox"][aria-expanded="false"]';

/**
 * Types a marker into every field the tree shows, then opens each closed list and types into what it
 * shows: what each field's marker reached that it never may.
 */
async function typeIntoEvery(tree: ReactNode, pathname: string, params: Record<string, string | string[]>): Promise<Field[]> {
  const prefetched: string[] = [];
  const { router, seen } = recordingRouter({ prefetch: (href: string) => void prefetched.push(href) });
  const ways: Ways = { seen, prefetched, loads: [] };
  const reported = console.error.bind(console);
  const consoleError = mock.method(console, "error", (...args: unknown[]) => {
    if (LEFT_DOCUMENT.test(args.map(String).join(" "))) ways.loads.push(String(args[0]));
    else reported(...args);
  });
  window.history.replaceState(null, "", pathname);

  try {
    const { container } = render(underNext(tree, { router, pathname, params }));
    await act(async () => undefined);
    const document = container.ownerDocument;
    const typed = new Set<Element>();
    const fields: Field[] = [];
    const typeIntoShown = async () => {
      for (const field of typeable(document)) {
        // An earlier field's marker can take a later one off the page, as a search empties its list.
        if (typed.has(field) || !field.isConnected) continue;
        typed.add(field);
        fields.push(await typeInto(field, markerOf(typed.size), ways));
      }
    };

    await typeIntoShown();
    const user = userEvent.setup();
    for (const trigger of [...document.querySelectorAll(CLOSED_LIST)]) {
      if (!trigger.isConnected) continue;
      await user.click(trigger);
      await typeIntoShown();
      await user.keyboard("{Escape}");
    }
    return fields;
  } finally {
    cleanup();
    consoleError.mock.restore();
  }
}

/** What one page did: threw on the way to its tree, or rendered with these fields typed into. */
type Visit = { thrown: unknown } | { fields: Field[] };

async function visit(page: string): Promise<Visit> {
  const { default: Page } = (await import(pathToFileURL(page).href)) as { default: (props: unknown) => unknown };
  const { params, pathname } = addressOf(page);
  if (label(page).startsWith("(public)/")) setSession(null);

  let tree: ReactNode;
  try {
    tree = await resolvedPage(Page, {
      params: Promise.resolve(params),
      searchParams: Promise.resolve(LINKED.has(label(page)) ? { token: "zz-link-aus-der-mail" } : {}),
    });
  } catch (error) {
    return { thrown: error };
  }
  return { fields: await typeIntoEvery(tree, pathname, params) };
}

const NOT_MATCHED = "the area's 404, answered for an address no other route takes";

/** The pages a session every area admits is sent away from, and why none holds a field to type into. */
const TURNED_AWAY: Readonly<Record<string, string>> = {
  "(public)/signin/passkey/page.tsx": "sends a session with no passkey step pending on to the landing; its card offers no field",
  "(public)/signin/weiter/page.tsx": "the sign-in landing, which renders nothing and only sends the session on",
  "bereich/(persoenlich)/[...unmatched]/page.tsx": NOT_MATCHED,
  "bereich/admin/[...unmatched]/page.tsx": NOT_MATCHED,
  "bereich/team/[team_id]/[saison_id]/[...unmatched]/page.tsx": NOT_MATCHED,
  "dashboard/[...unmatched]/page.tsx": NOT_MATCHED,
};

const SCHULADRESSE = "a school's public address, opened on the map link the administrator may follow, and no person's";

/** The fields whose text rides a URL by design, by page and then by the field's name, and why. */
const URL_BY_DESIGN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "bereich/admin/teams/[team_id]/page.tsx": {
    Straße: SCHULADRESSE,
    "Nr.": SCHULADRESSE,
    PLZ: SCHULADRESSE,
    Stadt: SCHULADRESSE,
    Stadtteil: SCHULADRESSE,
  },
};

/** The search box each page holding one must show the sweep: a render reaching no field fails here by name. */
const SEARCHES: Readonly<Record<string, string>> = {
  "(public)/bewerbung/[saison_id]/page.tsx": "Schule suchen",
  "bereich/admin/administratoren/page.tsx": "Zugänge suchen",
  "bereich/admin/aktionen/page.tsx": "Änderungen suchen",
  "bereich/admin/bewerbungen/page.tsx": "Bewerbungen suchen",
  "bereich/admin/kontakte/page.tsx": "Kontakte suchen",
  "bereich/admin/registrierungen/page.tsx": "Registrierungen suchen",
  "bereich/admin/saisons/page.tsx": "Saisons suchen",
  "bereich/admin/schiedsrichter/page.tsx": "Schiedsrichter suchen",
  "bereich/admin/sperrliste/page.tsx": "Sperren suchen",
  "bereich/admin/spieler/page.tsx": "Spieler suchen",
  "bereich/admin/spielorte/page.tsx": "Spielorte suchen",
  "bereich/admin/spielsuche/page.tsx": "Spiele suchen",
  "bereich/admin/spieltage/page.tsx": "Spieltage suchen",
  "bereich/admin/teams/page.tsx": "Teams suchen",
  "dashboard/spielsuche/page.tsx": "Spiele suchen",
};

/** A field writing what is typed into it out of the page one way, for the control. */
function Leaking({ how }: { how: (typed: string, router: ReturnType<typeof useRouter>) => void }): ReactNode {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  return h("input", {
    "aria-label": "Suchen",
    value: typed,
    onChange: (event: { target: { value: string } }) => {
      setTyped(event.target.value);
      how(event.target.value, router);
    },
  });
}

/** Each way out of a page, the trace the sweep must report for it, and a field taking it. */
const WAYS_OUT: { way: string; trace: string; tree: ReactNode }[] = [
  { way: "a router replace", trace: "router.replace", tree: h(Leaking, { how: (typed, router) => router.replace(`/x?suche=${typed}`) }) },
  {
    way: "a debounced router push",
    trace: "router.push",
    tree: h(Leaking, { how: (typed, router) => void setTimeout(() => router.push(`/x?suche=${typed}`), 300) }),
  },
  { way: "a prefetch", trace: "router.prefetch", tree: h(Leaking, { how: (typed, router) => router.prefetch(`/x?suche=${typed}`) }) },
  { way: "a history write", trace: "location", tree: h(Leaking, { how: (typed) => window.history.replaceState(null, "", `?suche=${typed}`) }) },
  {
    way: "a document load",
    trace: "a document load",
    tree: h(Leaking, { how: (typed) => window.location.assign(new URL(`/x?suche=${typed}`, window.location.href)) }),
  },
  { way: "a request", trace: "request", tree: h(Leaking, { how: (typed) => void fetch(`/api/suche?wer=${typed}`) }) },
  {
    way: "a link",
    trace: "<a href",
    tree: h(function Linking() {
      const [typed, setTyped] = useState("");
      return h("div", null, [
        h("input", {
          key: "feld",
          "aria-label": "Suchen",
          value: typed,
          onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
        }),
        h("a", { key: "link", href: `/x?suche=${typed}` }, "Treffer"),
      ]);
    }),
  },
  {
    way: "a press of Enter",
    trace: "router.push",
    tree: h(function OnEnter() {
      const router = useRouter();
      const [typed, setTyped] = useState("");
      return h("input", {
        "aria-label": "Suchen",
        value: typed,
        onChange: (event: { target: { value: string } }) => setTyped(event.target.value),
        onKeyDown: (event: { key: string }) => event.key === "Enter" && router.push(`/x?suche=${typed}`),
      });
    }),
  },
];

describe("what a visitor types into a page", () => {
  /* The control: a sweep blind to one of these passes a page taking it. */
  for (const { way, trace, tree } of WAYS_OUT) {
    it(`is caught leaving by ${way}`, async () => {
      const fields = await typeIntoEvery(tree, "/kontrolle", {});

      assert.equal(fields.length, 1, "the control's field was never typed into");
      assert.ok(
        fields[0]!.traces.some((found) => found.startsWith(trace)),
        `${way} left no trace the sweep reports: ${JSON.stringify(fields[0]!.traces)}`,
      );
    });
  }

  for (const page of PAGES) {
    it(`reaches no URL from ${label(page)}`, async () => {
      const visited = await visit(page);
      const excuse = TURNED_AWAY[label(page)];
      if ("thrown" in visited) {
        assert.ok(isNavigation(visited.thrown), `the page crashed: ${String(visited.thrown)}`);
        assert.notEqual(
          excuse,
          undefined,
          `the page sent the visitor to ${redirectTarget(visited.thrown) ?? "its 404"}, so nothing on it was typed into`,
        );
        return;
      }
      assert.equal(excuse, undefined, "the page renders: drop its excuse, so the sweep types into it");

      const byDesign = URL_BY_DESIGN[label(page)] ?? {};
      const leaked = visited.fields.filter(({ name, traces }) => traces.length > 0 && byDesign[name] === undefined);
      assert.deepEqual(
        leaked.map(({ name, traces }) => `${name}: ${traces.join(", ")}`),
        [],
        "hold what is typed in the page, and send it in a request's body (`docs/frontend/spec.md :: I680`)",
      );
      // An exemption holds only while its field still sends what is typed into it to an address.
      for (const name of Object.keys(byDesign)) {
        assert.ok(
          visited.fields.some((field) => field.name === name && field.traces.length > 0),
          `„${name}“ no longer rides a URL: drop its exemption`,
        );
      }
      const search = SEARCHES[label(page)];
      if (search !== undefined) {
        assert.ok(
          visited.fields.some((field) => field.name === search),
          `the sweep typed into no „${search}“, so it proved nothing about this page's search: ${JSON.stringify(visited.fields)}`,
        );
      }
    });
  }

  it("names only pages the app holds", () => {
    const held = new Set(PAGES.map(label));
    const named = [...Object.keys(TURNED_AWAY), ...Object.keys(URL_BY_DESIGN), ...Object.keys(SEARCHES), ...LINKED];

    assert.deepEqual(
      named.filter((page) => !held.has(page)),
      [],
    );
  });
});
