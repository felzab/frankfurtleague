import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants.ts";
import {
  answer,
  answerReadsWith,
  backendNotFound,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  pageBody,
  readsOf,
  saisonFields,
  steps,
} from "@/shared/testing/pageHarness.ts";

import type { AnswerSchema, PageProps } from "@/shared/testing/pageHarness.ts";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { FLBewerbungFensterResponse } from "./schemas";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");
const ROUTE_DIR = path.join(SRC_DIR, "app", "admin", "bewerbungen");

describe("the route the sidemenu names", () => {
  /* The id IS the route segment: the nav builds its href from it and `AppTopBar` reads the page's
     one `<h1>` off the entry it matches. Renamed, both break and nothing else in the suite sees it. */
  it("names a segment that exists under /admin", () => {
    const entry = ADMIN_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options).find((option) => option.label === "Bewerbungen");

    assert.ok(entry, "no sidemenu entry is labelled Bewerbungen");
    assert.equal(entry.id, "bewerbungen", "the entry's id moved off this slice's route segment");
    assert.ok(existsSync(path.join(SRC_DIR, "app", "admin", entry.id, "page.tsx")), `/admin/${entry.id} has no page`);
  });

  /* Both segments draw a skeleton while their data resolves; without one the shell holds an empty
     frame for the length of an admin-tier round trip. */
  it("gives both segments a loading state", () => {
    assert.ok(existsSync(path.join(ROUTE_DIR, "loading.tsx")), "the list segment has no loading.tsx");
    assert.ok(existsSync(path.join(ROUTE_DIR, "[bewerbung_id]", "loading.tsx")), "the detail segment has no loading.tsx");
  });
});

const RENDERS_NOTHING = `export const BewerbungView = () => null;
export const ContentLoader = () => null;`;

/* The public page's view and loader render nothing, so a case reads the props the page hands them;
   every read answers through the harness's client double. */
const DOUBLED: [string, string][] = [
  ["/src/features/bewerbungen/components/views/BewerbungView.tsx", RENDERS_NOTHING],
  ["/src/shared/components/ui/ContentLoader.tsx", RENDERS_NOTHING],
];

registerHooks({
  load(url, context, nextLoad) {
    const doubled = DOUBLED.find(([ending]) => url.endsWith(ending));
    if (doubled !== undefined) return { format: "module", source: doubled[1], shortCircuit: true };
    return nextLoad(url, context);
  },
});

const PUBLIC_PAGE = "@/app/(public)/bewerbung/[saison_id]/page.tsx";
const { default: BewerbungPage, generateMetadata } = await import(PUBLIC_PAGE);
const { default: AdminBewerbungenPage } = await import("@/app/admin/bewerbungen/page.tsx");
const { default: AdminBewerbungPage } = await import("@/app/admin/bewerbungen/[bewerbung_id]/page.tsx");
const { FLBewerbungSchema } = await import("./schemas.ts");

/** The public page's one dynamic segment, named as its directory names it, which is the key Next hands it under. */
const SEGMENT = /\[(\w+)\]/.exec(PUBLIC_PAGE)![1]!;

/** What the window read answers in a case: a season's window, no window, no season at all, or a read that failed. */
type WindowRead = { fenster: FLBewerbungFensterResponse | null } | null | Error;

/** An answer carrying `fields`, built against the schema its read hands over so the client's check takes it. */
const built =
  (endpoint: string, fields: Record<string, unknown>) =>
  (schema: AnswerSchema): unknown =>
    answer(schema, endpoint, fields);

/** What each read answers in the running case, by the endpoint it asks; an `Error` is thrown, a function built. */
let answers = new Map<string, unknown>();

answerReadsWith((endpoint, schema, params) => {
  if (!answers.has(endpoint)) return EMPTIEST_ANSWER(endpoint, schema, params);
  const answered = answers.get(endpoint);
  if (answered instanceof Error) throw answered;
  return typeof answered === "function" ? (answered as ReturnType<typeof built>)(schema) : answered;
});

/** The backend's answer for one season's window, as `window` describes it. */
function windowAnswer(saisonId: string, window: WindowRead): unknown {
  const endpoint = `/bewerbungen/fenster/${saisonId}`;
  if (window === null) return backendNotFound(endpoint);
  if (window instanceof Error || window.fenster !== null) return window instanceof Error ? window : window.fenster;
  return { acknowledged: 1, saison_id: saisonId, fenster: null };
}

/** The public page's props for one season, keyed by the segment's own name. */
const publicProps = (saisonId: string): PageProps => ({ params: Promise.resolve({ [SEGMENT]: saisonId }), searchParams: Promise.resolve({}) });

const ABGELAUFEN: FLBewerbungFensterResponse = {
  acknowledged: 1,
  saison_id: "2026",
  offen: true,
  von: "2026-03-01",
  bis: "2026-04-30",
  laeuft: false,
  saison_beendet: false,
};
const LAEUFT: FLBewerbungFensterResponse = { ...ABGELAUFEN, laeuft: true };

/** The fields the club list and the colours answer with, or the `Error` each read throws. */
type PublicReads = { schulen?: Record<string, unknown> | Error; farben?: Record<string, unknown> | Error };

/** Season 2026's reads: its window, the club list and the assigned colours. */
function answerPublic(window: WindowRead, { schulen = { schulen: [] }, farben = { vergeben: [] } }: PublicReads = {}): void {
  answers = new Map<string, unknown>([
    ["/bewerbungen/fenster/2026", windowAnswer("2026", window)],
    ["/bewerbungen/schulen", schulen instanceof Error ? schulen : built("/bewerbungen/schulen", schulen)],
    ["/bewerbungen/trikotfarben/2026", farben instanceof Error ? farben : built("/bewerbungen/trikotfarben/2026", farben)],
  ]);
}

/** One season's metadata, with the window read answering `window`. */
async function metadataFor(window: WindowRead): Promise<Metadata> {
  answerPublic(window);

  return generateMetadata(publicProps("2026"));
}

type BewerbungViewProps = {
  fenster: unknown;
  isUnlesbar: boolean;
  schulen: unknown[];
  isSchulenLesbar: boolean;
  vergebeneFarben: unknown[];
};

/** The public page's body for 2026, and the endpoints it read on the way. */
async function publicBody(window: WindowRead, reads: PublicReads = {}): Promise<BewerbungViewProps> {
  answerPublic(window, reads);
  clearSteps();

  return ((await pageBody(BewerbungPage, publicProps("2026"))) as ReactElement<BewerbungViewProps>).props;
}

const endpointsRead = (): string[] => readsOf(steps).map(({ endpoint }) => endpoint);

/* `docs/frontend/spec.md :: I22`: a dynamic segment's page awaits `params`, and every runtime API,
   inside its boundary. An async default would hold the chrome for the whole read. */
describe("where each page opts out of prerendering", () => {
  const ADMIN_PROPS: PageProps = { params: Promise.resolve({ bewerbung_id: "6890a1b2c3d4e5f607181001" }), searchParams: Promise.resolve({}) };

  for (const [where, Page, props] of [
    ["the admin list page", AdminBewerbungenPage, ADMIN_PROPS],
    ["the admin detail page", AdminBewerbungPage, ADMIN_PROPS],
    ["the public application page", BewerbungPage, publicProps("2026")],
  ] as const) {
    it(`${where} returns its chrome synchronously`, () => {
      const returned: unknown = (Page as (props: PageProps) => unknown)(props);

      assert.equal(returned instanceof Promise, false, `${where} awaits its data before the chrome renders`);
    });
  }

  /* The admin pages are held to the same order by the walk in `fl_frontend/src/app/admin/omittedSaison.test.ts`,
     which reaches no public page. */
  it("the public application page awaits connection() before its first read", async () => {
    answerPublic({ fenster: LAEUFT });
    clearSteps();
    const { thrown, unconnected } = await callPage(BewerbungPage, publicProps("2026"));

    assert.deepEqual(thrown, []);
    assert.ok(endpointsRead().includes("/bewerbungen/fenster/2026"), "the body made no read, so the order below proves nothing");
    assert.deepEqual(unconnected, [], "a read runs before connection(), which the image build reaches no backend for");
  });
});

describe("how the list page reads the header's season", () => {
  const saison = (id: string, status: "active" | "future") => ({
    ...saisonFields(id, status),
    start_date: `${id}-03-07`,
    end_date: `${id}-10-31`,
    schedule: [],
    spielplan: null,
    bewerbung: null,
    registrierung: null,
  });
  const LEAGUE = [saison("2026", "active"), saison("2027", "future")];
  /** Shaped as the backend's ids, as the row schema demands; the last four digits name the row's season. */
  const rowId = (saison_id: string) => `6890a1b2c3d4e5f60718${saison_id}`;
  const row = (saison_id: string) =>
    answer(FLBewerbungSchema, "/bewerbungen", { id: rowId(saison_id), saison_id, schule: null, team_id: null });

  /** The list page's body where the address names 2027 and the queue answers one application per season. */
  async function listBody(): Promise<ReactElement<{ bewerbungen: { id: string; inSelectedSaison: boolean }[] }>> {
    answers = new Map<string, unknown>([
      ["/saisons/list/admin", built("/saisons/list/admin", { saisons: LEAGUE })],
      ["/bewerbungen", built("/bewerbungen", { bewerbungen: [row("2026"), row("2027")], vollstaendig: true })],
    ]);
    clearSteps();

    return (await pageBody(AdminBewerbungenPage, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ saison_id: "2027" }),
    })) as ReactElement<{
      bewerbungen: { id: string; inSelectedSaison: boolean }[];
    }>;
  }

  /* The selector writes `?saison_id=`, and the page reaches it only through its own props: without
     the parameter forwarded, the queue is asked against the running season on every navigation. */
  it("asks the queue against the season the address names", async () => {
    await listBody();

    assert.deepEqual(
      readsOf(steps)
        .filter(({ endpoint }) => endpoint === "/bewerbungen")
        .map(({ params }) => params.saison_id),
      ["2027"],
    );
  });

  /* Where the season actually lands: the rows carry it, and the facet reads it off them. Dropped,
     every row would answer the season facet the same way and the list would open on nothing. */
  it("marks the rows of that season, and only those", async () => {
    const rows = (await listBody()).props.bewerbungen;

    assert.deepEqual(
      rows.map(({ id, inSelectedSaison }) => [id, inSelectedSaison]),
      [
        [rowId("2026"), false],
        [rowId("2027"), true],
      ],
    );
  });
});

describe("what the public application page tells a crawler about its season", () => {
  /* A season nobody has recorded a deadline for renders one sentence and no form. Indexed, that
     sentence is what a school searching for this league finds long after the window opened. */
  it("asks not to be indexed where the season records no deadline", async () => {
    assert.deepEqual((await metadataFor({ fenster: null })).robots, { index: false });
  });

  /* The page renders the unreadable state rather than a 404, so the sentence saying the window could
     not be read is what an indexed copy would keep. */
  it("asks not to be indexed where the window could not be read", async () => {
    assert.deepEqual((await metadataFor(new Error("backend unreachable"))).robots, { index: false });
  });

  /* The control, and the boundary of the directive: a deadline that has passed is a real answer for
     the season it names, so the page stays a page a crawler may keep. */
  it("leaves a season whose deadline has passed indexable", async () => {
    assert.equal((await metadataFor({ fenster: ABGELAUFEN })).robots, undefined);
  });
});

describe("what the public application page answers for a season nobody knows", () => {
  /* The metadata only titles the panel; the body's throw is the one thing making an unknown season a
     404, and one thrown inside the read's own handlers would be caught as a read that failed. */
  it("throws not-found from the body where no season carries the id", async () => {
    await assert.rejects(
      publicBody(null),
      (error: { digest?: string }) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
      "an unknown season renders the page instead of the not-found panel",
    );
  });

  /* `resolveSaisonIdParam` reads the segment under the name its directory gives it: read under another,
     every season would 404, and a malformed one would reach the backend. */
  it("reads its season off the segment, and 404s a malformed one before any read", async () => {
    answerPublic({ fenster: ABGELAUFEN });
    clearSteps();
    await pageBody(BewerbungPage, publicProps("2026"));
    assert.deepEqual(endpointsRead(), ["/bewerbungen/fenster/2026"], "the page reads another season than its segment names");

    clearSteps();
    await assert.rejects(
      pageBody(BewerbungPage, publicProps("20x")),
      (error: { digest?: string }) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
      "a malformed season renders a page",
    );
    assert.deepEqual(endpointsRead(), [], "a malformed season reaches the backend");
  });

  /* The control, and the state the page owes a failed read: it renders the view with no window rather
     than throwing, and says the window is unreadable rather than closed. */
  it("hands the view an unreadable window where the read failed", async () => {
    const props = await publicBody(new Error("backend unreachable"));

    assert.equal(props.isUnlesbar, true, "a failed window read is reported as a state the page knows");
    assert.equal(props.fenster, null, "a failed window read hands the view a window it never got");
  });
});

describe("what the public application page reads while its window runs", () => {
  /* An anonymous visitor reads the club list and the assigned colours. A closed page showing no picker
     has no business reading either (`READ-BEWERBUNG-001`). */
  it("reads the club list and the colours only while the window is running", async () => {
    await publicBody({ fenster: ABGELAUFEN });
    assert.deepEqual(endpointsRead(), ["/bewerbungen/fenster/2026"], "a closed page reads what only a picker needs");

    await publicBody({ fenster: LAEUFT });
    assert.deepEqual(endpointsRead(), ["/bewerbungen/fenster/2026", "/bewerbungen/schulen", "/bewerbungen/trikotfarben/2026"]);
  });

  /* Uncaught, one unreachable list would take the whole form down with it. */
  it("hands the view an unread club list where that read failed", async () => {
    const props = await publicBody({ fenster: LAEUFT }, { schulen: new Error("backend unreachable") });

    assert.equal(props.isSchulenLesbar, false, "a failed club list read is reported as a list that was read");
    assert.deepEqual(props.schulen, [], "a failed club list read hands the view clubs it never got");
  });

  /* The season's ASSIGNED colours, never another application's wish: a wish is no claim on a colour,
     and offering it as taken would narrow the picker on something nobody decided. */
  it("hands the picker the colours the page's own season has assigned", async () => {
    const props = await publicBody({ fenster: LAEUFT }, { farben: { vergeben: ["rot", "blau"] } });

    assert.deepEqual(props.vergebeneFarben, ["rot", "blau"]);
  });

  /* An unreadable answer means nothing is KNOWN to be taken, so the whole palette is offered rather
     than the form going down with the read. */
  it("offers every colour where the assignments could not be read", async () => {
    const props = await publicBody({ fenster: LAEUFT }, { farben: new Error("backend unreachable") });

    assert.deepEqual(props.vergebeneFarben, []);
    assert.equal(props.isSchulenLesbar, true, "the colours' failure took the club list with it");
  });
});
