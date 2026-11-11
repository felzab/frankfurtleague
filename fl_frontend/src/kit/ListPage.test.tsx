// @vitest-environment jsdom
import { spielColumnsHolder } from "@/test-support/spielColumns.ts";
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ClassicPage } from "./ClassicPage";
import { actLabel } from "./dialogAct";
import { ListPage } from "./ListPage";
import { ListTable } from "./ListTable";
import { RailPage } from "./RailFrame";

import type { AtRule, Container, Declaration, Document, Rule } from "postcss";
import type { ComponentProps, ReactElement } from "react";
import type { ListRoleActs, SpieltageContent } from "./ListPage";

// The strip's own links, which need no router to be read, and the address the tabs link from.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027", useRouter: () => ({ replace: vi.fn() }) }));

const compiled = compiledGlobals();

/** The media queries a declaration stands under, innermost first. */
function mediaAbove(decl: Declaration): string[] {
  const queries: string[] = [];
  for (let node: Container | Document | undefined = decl.parent; node != null; node = node.parent) {
    if (node.type === "atrule" && (node as AtRule).name === "media") queries.push((node as AtRule).params);
  }
  return queries;
}

/** Each declaration the stylesheet makes for one of `classes`, with the media queries it stands under. */
async function declarationsFor(classes: readonly string[]): Promise<{ decl: Declaration; media: string[] }[]> {
  const found: { decl: Declaration; media: string[] }[] = [];
  (await compiled).walkDecls((decl) => {
    if (decl.parent?.type !== "rule") return;
    const selectors = selectorsOf(decl.parent as Rule).map((selector) => selector.replace(/\\(.)/g, "$1"));
    if (!selectors.some((selector) => classes.some((name) => selector.includes(`.${name}`)))) return;
    found.push({ decl, media: mediaAbove(decl) });
  });
  return found;
}

// The harm: Chrome restores a reload by a selector it saved inside `main`, which finds the wrong element in the
// placeholders, and only a reload while scrolled shows the page landing elsewhere.
describe("the frames' `main`", () => {
  it.each([
    [
      "a rail page",
      <RailPage
        key="rail"
        scope="saison"
        title={{ route: "spielplan" }}>
        {null}
      </RailPage>,
    ],
    [
      "a classic page",
      <ClassicPage
        key="classic"
        width="form">
        {null}
      </ClassicPage>,
    ],
  ])("saves no scroll anchor on %s", async (_, frame) => {
    const page = document.createElement("div");
    page.innerHTML = renderToString(frame);
    const declared = await declarationsFor([...(page.querySelector("main")?.classList ?? [])]);
    expect(declared.filter(({ decl }) => decl.prop === "overflow-anchor").map(({ decl }) => decl.value)).toStrictEqual(["none"]);
  });
});

describe("the list's create act", () => {
  // The harm: a handover's start swaps its trigger for the locked button, and the keyboard's place falls to `body`.
  it("keeps the keys in the toolbar when the act it just ran locks it", async () => {
    const name = actLabel({ verb: "create", object: COPY.page.spielplan });
    const page = (locked?: typeof COPY.template.draftUnsaved) => (
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        create={{ title: name, act: { verb: "create", object: COPY.page.spielplan }, action: vi.fn(), children: null, locked }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />
    );
    const { rerender } = render(page());
    const trigger = screen.getByRole("button", { name });
    const place = trigger.closest('[data-kit-focus="home"]');
    trigger.focus();

    rerender(page(COPY.template.draftUnsaved));

    await waitFor(() => expect(document.activeElement).toBe(place));
  });

  // The harm: a dialog's trigger around the locked button would open the create form behind the reason.
  it("answers a press with its reason while locked, never its form", async () => {
    const reason = COPY.template.draftUnsaved;
    const name = actLabel({ verb: "create", object: COPY.page.spielplan });
    render(
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        create={{ title: name, act: { verb: "create", object: COPY.page.spielplan }, action: vi.fn(), children: null, locked: reason }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name }));
    expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("heading", { name })).toBeNull();
  });
});

describe("the toolbar's acts the read decides", () => {
  // Read at once, since a prerender waits for every boundary, the list's among them.
  const LIST = {
    kind: "spieltage",
    wait: { tabs: 7, matches: 8 },
    content: Promise.resolve({ tabs: null, empty: { kind: "none", plural: COPY.shared.saison } as const }),
  } as const;
  const HEAD = { scope: "saison", title: { route: "spielplan" } } as const;

  // The harm: an empty toolbar row holds the page's gap over an administrator's list, which then stands lower than its wait.
  it("draws no row for a reader holding neither act, as the wait draws none", async () => {
    const { prelude } = await prerender(
      <ListPage
        head={HEAD}
        acts={Promise.resolve({ side: null, create: null })}
        list={LIST}
      />,
      // Every boundary in its place, where React would otherwise leave it for a script no parsed page runs.
      { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
    );
    const page = document.createElement("div");
    page.innerHTML = await new Response(prelude).text();

    expect(page.querySelector("[class*='flex-wrap']")).toBe(null);
  });

  // The harm: React's reveal throttle holds each reveal 300 ms after the last, so a toolbar in a boundary of its own can
  // land after the rows and lift them under a finger on „Entfernen“. Each boundary's reveal is one `$RC` call in the stream.
  it("reveals the toolbar and the list as one", async () => {
    const name = actLabel({ verb: "create", object: COPY.page.spielplan });
    const acts = Promise.withResolvers<ListRoleActs>();
    const list = Promise.withResolvers<SpieltageContent>();
    const stream = await renderToReadableStream(
      <ListPage
        head={HEAD}
        acts={acts.promise}
        list={{ ...LIST, content: list.promise }}
      />,
    );

    acts.resolve({
      side: null,
      create: { title: name, act: { verb: "create", object: COPY.page.spielplan }, action: vi.fn(), children: null },
    });
    list.resolve(await LIST.content);
    const page = await new Response(stream).text();

    expect(page).toContain(name);
    expect(page.match(/\$RC\("/g)).toHaveLength(1);
  });
});

type Cards = Extract<ComponentProps<typeof ListPage>["list"], { kind: "cards" }>;

/** A page of cards as a browser holds it while its one read runs, and once the read has landed. */
async function drawnCards(wait: Cards["wait"], content: Awaited<Cards["content"]>) {
  const page = (read: Cards["content"]) => (
    <ListPage
      head={{ scope: "saison", title: { route: "spielplan" } }}
      list={{ kind: "cards", wait, content: read }}
    />
  );
  const waiting = document.createElement("div");
  waiting.innerHTML = renderToString(page(new Promise(() => undefined)));

  const { prelude } = await prerender(
    page(Promise.resolve(content)),
    // Every boundary in its place, where React would otherwise leave it for a script no parsed page runs.
    { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
  );
  const landed = document.createElement("div");
  landed.innerHTML = await new Response(prelude).text();
  return { waiting, landed };
}

/** The grid a page's cards share. */
const GRID = "[class~='lg:grid-cols-2']";

describe("open work beside its record's seats", () => {
  const ACTS = [COPY.shared.verb.adopt, COPY.shared.verb.discard] as const;
  const TITLES = [COPY.page.spiele, COPY.page.registrierungen, COPY.team.kontakte] as const;
  const SPIEL = "Ahorn vs. Eiche";
  const TEAM = "Ahornschule Frankfurt";

  const drawn = () =>
    drawnCards(
      { team: true, rows: 2, cards: [{ title: TITLES[0], acts: ACTS }, { title: TITLES[1] }], seats: TITLES[2] },
      {
        team: { plaque: { record: "AHO" }, name: { record: TEAM } },
        cards: [
          {
            id: "spiele",
            title: TITLES[0],
            rows: [
              {
                id: "1",
                href: "/",
                name: { record: SPIEL },
                line: COPY.page.spiele,
                acts: (
                  <>
                    <Button
                      variant="primary"
                      label={ACTS[0]}
                    />
                    <Button
                      variant="secondary"
                      label={ACTS[1]}
                    />
                  </>
                ),
              },
              // A date the team declined: it stays for the league's decision, chipped, with nothing left to press.
              {
                id: "2",
                href: "/",
                name: { record: "Ahorn vs. Linde" },
                chip: { tone: "danger", label: COPY.admin.spiel.declined },
                line: COPY.page.spiele,
              },
            ],
          },
          { id: "registrierungen", title: TITLES[1], rows: [] },
        ],
        seats: {
          title: TITLES[2],
          rows: (["ansprechperson", "trainer", "stellvertretung"] as const).map((seat) => ({
            id: seat,
            name: { record: "Lena Ahlers" },
            chips: [],
            line: COPY.admin.seatLine([seat], null, null),
          })),
        },
      },
    );

  /** The cards of a page, in the order their grid holds them. */
  const cardsOf = (page: Element) => [...(page.querySelector(GRID)?.children ?? [])];
  /** A seats' card's rows: the card's body holds the list alone. */
  const seatsOf = (card: Element | undefined) => [...(card?.lastElementChild?.firstElementChild?.children ?? [])];

  // The harm: a box the wait leaves out, the head or a card, lands among the others' placeholders and pushes the page
  // down, and an act's bar on a seat that carries none lands a phone's row a line shorter; either moves the page under a
  // finger on „Zusagen“.
  it("waits as one skeleton of every box it lands with, the team's head and the seats' card among them", async () => {
    const { waiting, landed } = await drawn();

    const skeletons = [...waiting.querySelectorAll("[aria-busy]")];
    expect(skeletons).toHaveLength(1);
    const [skeleton] = skeletons as [Element];
    expect(cardsOf(skeleton).map((card) => card.firstElementChild?.textContent)).toStrictEqual(TITLES);
    expect(cardsOf(landed).map((card) => card.querySelector("h2")?.textContent)).toStrictEqual(TITLES);

    // The head is the one box over the cards' grid, waiting and landed, and names the team under the page's title.
    const over = (page: Element) => page.querySelector(GRID)?.previousElementSibling;
    expect([skeleton, landed].map((page) => page.querySelector(GRID)?.parentElement?.childElementCount)).toStrictEqual([2, 2]);
    expect(over(skeleton)?.childElementCount).toBe(over(landed)?.childElementCount);
    expect(over(landed)?.querySelector("h2")?.textContent).toBe(TEAM);

    expect(cardsOf(landed)[1]?.lastElementChild?.textContent).toBe(COPY.shared.empty.nothingOpen);

    const parts = (rows: Element[]) => rows.map((row) => row.childElementCount);
    expect(parts(seatsOf(cardsOf(skeleton)[2]))).toStrictEqual(parts(seatsOf(cardsOf(landed)[2])));
    expect(seatsOf(cardsOf(landed)[2])).toHaveLength(3);
  });

  // The harm: a row's acts read in another order than the page gave them, or apart from the words they act on. Where they
  // stand, beside the words or under them by the card's width, is the drive's to measure: jsdom lays nothing out.
  it("sets a row's acts after its words, in the order the page gave them", async () => {
    const { landed } = await drawn();
    const [words, acts] = [...(landed.querySelector("[data-kit-row]")?.firstElementChild?.children ?? [])] as [Element, Element];

    expect(words.textContent).toContain(SPIEL);
    expect([...acts.querySelectorAll("button")].map((button) => button.textContent)).toStrictEqual(ACTS);
  });

  // The harm: a row drawing room for acts it lacks, an empty place beside or under its words.
  it("keeps no room for acts on a row that carries none", async () => {
    const { landed } = await drawn();
    const declined = [...landed.querySelectorAll("[data-kit-row]")][1];

    expect(declined?.textContent).toContain(COPY.admin.spiel.declined);
    expect(declined?.querySelectorAll("button")).toHaveLength(0);
    // Its words, then the chevron, which holds no words: nothing stands between them.
    expect([...(declined?.firstElementChild?.children ?? [])].map((part) => part.textContent === "")).toStrictEqual([false, true]);
  });
});

describe("a page of one card holding a list", () => {
  const TITLE = COPY.page.spiele;
  const drawn = (rows: Awaited<Cards["content"]>["cards"][number]["rows"]) =>
    drawnCards(
      { rows: 2, cards: [{ title: TITLE, count: false }] },
      { cards: [{ id: "spiele", title: TITLE, rows, count: false, empty: { kind: "none", plural: TITLE } }] },
    );

  // The harm: in the grid a lone card stands at half the content's width from `lg`, and one that waits there and lands
  // outside it doubles its width as the rows arrive.
  it("waits and lands outside the grid, at the content's width", async () => {
    const { waiting, landed } = await drawn([{ id: "1", href: "/", name: { record: "Ahorn vs. Eiche" }, line: TITLE }]);

    expect(landed.querySelector("h2")?.textContent).toBe(TITLE);
    // Counted, never the node: a failing comparison would print the whole card.
    expect([waiting, landed].map((page) => page.querySelectorAll(GRID).length)).toStrictEqual([0, 0]);
  });

  // The harm: a list with nothing in it yet under „Nichts offen.“ tells a referee their work is done, where none is booked.
  it("gives way to the list's own empty state", async () => {
    const { landed } = await drawn([]);

    // Its text alone: the card's title before it would say the card still stands.
    expect(landed.querySelector("main")?.textContent).toBe(COPY.shared.empty.none(TITLE));
  });

  // The harm: a referee booked to a season's twenty games finds one by scrolling, where the administration's lists of
  // that length are searched. `ListTable.test.tsx` holds what the search narrows.
  it("draws the toolbar's search field where the page names one, before and after the rows arrive", async () => {
    const page = (content: Cards["content"]) => (
      <ListPage
        head={{ scope: "area", title: { route: "teamKader" } }}
        list={{
          kind: "cards",
          search: { label: COPY.admin.spieler.search },
          wait: { rows: 2, cards: [{ title: TITLE, count: false }] },
          content,
        }}
      />
    );
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(page(new Promise(() => undefined)));
    const landed = document.createElement("div");
    const { prelude } = await prerender(
      page(
        Promise.resolve({
          cards: [{ id: "spiele", title: TITLE, count: false, rows: [{ id: "1", href: "/", name: { record: "Ahorn vs. Eiche" } }] }],
        }),
      ),
      { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
    );
    landed.innerHTML = await new Response(prelude).text();

    expect([waiting, landed].map((drawn) => drawn.querySelectorAll('input[type="search"]').length)).toStrictEqual([1, 1]);
    expect(landed.textContent).toContain("Ahorn vs. Eiche");
  });
});

describe("a table a client page draws", () => {
  const HEAD = { nameLabel: COPY.shared.name, columns: [] } as const;
  const page = (content: Promise<{ drawn: ReactElement }>) => (
    <ListPage
      head={{ scope: "area", title: { route: "teamKader" } }}
      list={{ kind: "table", search: { label: COPY.admin.spieler.search }, head: HEAD, wait: 3, content }}
    />
  );

  // The harm: a page whose rows open its dialog draws its table itself, and a table standing outside the template's
  // wait or its body lands without a placeholder or outside the toolbar's search scope. The page is drawn as the server
  // draws it, its list body being a server component; what the toolbar's field narrows is `ListTable.test.tsx`'s.
  it("waits in the template's placeholder and lands in the template's body, under the toolbar's field", async () => {
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(page(new Promise(() => undefined)));
    expect(waiting.querySelectorAll("[aria-busy] tbody tr")).toHaveLength(3);

    const drawn = (
      <ListTable
        table={{
          ...HEAD,
          label: COPY.page.teamKader,
          rows: ["Lea Bauer", "Finn Claus"].map((name) => ({ id: name, name: { record: name }, onOpen: vi.fn(), cells: {} })),
          empty: { kind: "none", plural: COPY.page.teamKader, one: true },
        }}
      />
    );
    const landed = document.createElement("div");
    const { prelude } = await prerender(page(Promise.resolve({ drawn })), { progressiveChunkSize: Number.MAX_SAFE_INTEGER });
    landed.innerHTML = await new Response(prelude).text();

    const field = landed.querySelector('input[type="search"]');
    const rows = [...landed.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows).toStrictEqual(["Lea Bauer", "Finn Claus"]);
    expect(landed.querySelector("[aria-busy]")).toBe(null);
    // The table stands after the field in the one scope the template holds both in.
    expect(field?.compareDocumentPosition(landed.querySelector("table") as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("one club's matches under their matchdays", () => {
  type Groups = Extract<ComponentProps<typeof ListPage>["list"], { kind: "spielGroups" }>;
  const HEADS = [COPY.shared.spieltag(1), COPY.shared.spieltag(2)] as const;

  /** The page as a browser holds it while its read runs, and once the read has landed. */
  async function drawn(wait: number, content: Awaited<Groups["content"]>) {
    const page = (read: Groups["content"]) => (
      <ListPage
        head={{ scope: "area", title: { route: "teamSpiele" } }}
        list={{ kind: "spielGroups", wait, content: read }}
      />
    );
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(page(new Promise(() => undefined)));
    const { prelude } = await prerender(page(Promise.resolve(content)), { progressiveChunkSize: Number.MAX_SAFE_INTEGER });
    const landed = document.createElement("div");
    landed.innerHTML = await new Response(prelude).text();
    return { waiting, landed };
  }

  const group = (index: 0 | 1) => ({
    head: HEADS[index],
    spiel: {
      id: String(index),
      href: "/" as const,
      when: COPY.spielplan.when(null, null),
      team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
      team2: { name: { record: "Eiche" }, plaque: { record: "EIC" } },
    },
  });
  const EMPTY = { kind: "none", plural: COPY.page.spiele } as const;

  // The harm: a matchday set into the row's date line, or a head standing apart from its match, reads as the owner
  // ruled against; and a wait of another count of boxes moves the page as the matches land.
  it("sets each match in its own box under its matchday's head, and waits in as many boxes", async () => {
    const { waiting, landed } = await drawn(2, { groups: [group(0), group(1)], empty: EMPTY });

    const boxes = (page: Element) => [...(page.querySelector("main .grid.gap-y-3")?.children ?? [])];
    expect(boxes(landed).map((box) => box.querySelector("h3")?.textContent)).toStrictEqual(HEADS);
    expect(boxes(landed).map((box) => box.querySelectorAll("a").length)).toStrictEqual([1, 1]);
    expect(boxes(waiting.querySelector("[aria-busy]") ?? waiting)).toHaveLength(2);
  });

  // The harm: one box's chip widening its when column, so its score and sides stand apart from every other box's down
  // the list, or a box dropping the columns and printing its cells over each other (`spielColumnsHolder`).
  it("lines every box's match up on the one set of columns the list holds", async () => {
    const chipped = { ...group(1), spiel: { ...group(1).spiel, chip: { tone: "warn" as const, label: COPY.shared.saved } } };
    const { landed } = await drawn(2, { groups: [group(0), chipped], empty: EMPTY });

    expect(spielColumnsHolder(landed)?.closest("main")).not.toBeNull();
  });

  // The harm: a season before its draw drawn as an empty box, which reads as a list that failed to load.
  it("gives way to the list's own empty state", async () => {
    const { landed } = await drawn(2, { groups: [], empty: EMPTY });

    expect(landed.querySelector("main")?.textContent).toBe(COPY.shared.empty.none(COPY.page.spiele));
  });
});

describe("the list template's wait", () => {
  // Under `prefers-reduced-motion: reduce` the motion tokens are unset, and a declaration reading one is
  // invalid whole: were it the `animation` shorthand, the name would fall to `none` and the skeleton, at its
  // resting opacity of 0, would never show.
  it("keeps the skeleton's animation under reduced motion, a motion token setting its duration alone", async () => {
    // The document a browser holds before the content arrives: the shell, the list's boundary at its fallback.
    const page = document.createElement("div");
    page.innerHTML = renderToString(
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />,
    );
    const declared = await declarationsFor([...(page.querySelector("[aria-busy]")?.classList ?? [])]);

    const appearing = declared.filter(({ decl }) => decl.prop.startsWith("animation") || decl.prop === "opacity");
    expect(appearing.filter(({ media }) => media.length > 0)).toStrictEqual([]);
    expect(declared.filter(({ decl }) => /var\(--motion-/.test(decl.value)).map(({ decl }) => decl.prop)).toStrictEqual(["animation-duration"]);

    // The delay is declared where motion is not asked about, so it holds under reduced motion too.
    const delays: string[][] = [];
    (await compiled).walkDecls("--loading-delay", (decl) => void delays.push(mediaAbove(decl)));
    expect(delays).toStrictEqual([[]]);
  });
});
