// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { render, screen, within } from "@testing-library/react";
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

import type { Copy } from "@/core/copy";
import type { AtRule, Container, Declaration, Document, Rule } from "postcss";
import type { ComponentProps, ReactElement } from "react";
import type { SpieltageContent } from "./ListPage";

// The strip's own links, which need no router to be read, and the address the tabs link from.
vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
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

describe("what the read says over the list", () => {
  // Read at once, since a prerender waits for every boundary, the list's among them.
  const LIST = {
    kind: "spieltage",
    wait: { tabs: 7, matches: 8 },
    content: Promise.resolve({ tabs: null, empty: { kind: "none", plural: COPY.shared.saison } as const }),
  } as const;
  const HEAD = { scope: "saison", title: { route: "spielplan" } } as const;

  // The harm: React's reveal throttle holds each reveal 300 ms after the last, so a notice in a boundary of its own can
  // land after the rows and lift them under a finger on a row's act. Each boundary's reveal is one `$RC` call in the stream.
  it("reveals the notice and the list as one", async () => {
    const text = COPY.template.draftUnsaved;
    const notice = Promise.withResolvers<Copy | null>();
    const list = Promise.withResolvers<SpieltageContent>();
    const stream = await renderToReadableStream(
      <ListPage
        head={HEAD}
        notice={notice.promise}
        list={{ ...LIST, content: list.promise }}
      />,
    );

    notice.resolve(text);
    list.resolve(await LIST.content);
    const page = await new Response(stream).text();

    expect(page).toContain(text);
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

/** The grid a page's cards share, reached from a card's title, which stands in its card's head. */
const gridOf = (title: Element) => title.parentElement?.parentElement?.parentElement;

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

  /** A seats' card's rows: the card's body holds the list alone. */
  const seatsOf = (card: Element | undefined) => [...(card?.lastElementChild?.firstElementChild?.children ?? [])];

  // The harm: a box the wait leaves out, the head or a card, lands among the others' placeholders and pushes the page
  // down, and an act's bar on a seat that carries none lands a phone's row a line shorter; either moves the page under a
  // finger on „Zusagen“.
  it("waits as one skeleton of every box it lands with, the team's head and the seats' card among them", async () => {
    const { waiting, landed } = await drawn();

    const skeletons = [...waiting.querySelectorAll<HTMLElement>("[aria-busy]")];
    expect(skeletons).toHaveLength(1);
    const [skeleton] = skeletons as [HTMLElement];
    // The wait sets a card's title as words, the landed card as its heading.
    const grids = [gridOf(within(skeleton).getByText(TITLES[0])), gridOf(within(landed).getByRole("heading", { name: TITLES[0] }))];
    const [waitingCards, landedCards] = grids.map((grid) => [...(grid?.children ?? [])]) as [Element[], Element[]];
    expect(waitingCards.map((card) => card.firstElementChild?.textContent)).toStrictEqual(TITLES);
    expect(landedCards.map((card) => card.querySelector("h2")?.textContent)).toStrictEqual(TITLES);

    // The head is the one box over the cards' grid, which stands in the container its columns read, waiting and landed,
    // and names the team under the page's title.
    const boxes = grids.map((grid) => grid?.parentElement);
    const [waitingHead, landedHead] = boxes.map((box) => box?.previousElementSibling);
    expect(boxes.map((box) => box?.parentElement?.childElementCount)).toStrictEqual([2, 2]);
    expect(waitingHead?.childElementCount).toBe(landedHead?.childElementCount);
    expect(landedHead?.querySelector("h2")?.textContent).toBe(TEAM);

    expect(landedCards[1]?.lastElementChild?.textContent).toBe(COPY.shared.empty.nothingOpen);

    // A seat's row frames its words and, where it carries any, its acts.
    const parts = (rows: Element[]) => rows.map((row) => row.firstElementChild?.childElementCount);
    expect(parts(seatsOf(waitingCards[2]))).toStrictEqual(parts(seatsOf(landedCards[2])));
    expect(seatsOf(landedCards[2])).toHaveLength(3);
  });
});

describe("a card of open work holding more than five rows", () => {
  // The harm: the card's count stops saying how many are open once the rows are cut to five.
  it("shows the count of all of them over the five it draws", async () => {
    const TITLE = COPY.page.spiele;
    const { landed } = await drawnCards(
      { rows: 5, cards: [{ title: TITLE }] },
      {
        cards: [
          {
            id: "dates",
            title: TITLE,
            rows: Array.from({ length: 15 }, (_, index) => ({ id: String(index), href: "/", name: { record: `Spiel ${String(index + 1)}` } })),
          },
        ],
      },
    );

    const card = within(landed).getByRole("heading", { name: TITLE }).closest("section") as HTMLElement;
    expect(within(card).getByText("15")).toBeDefined();
  });
});

describe("a page of one card holding a list", () => {
  const TITLE = COPY.page.spiele;
  const drawn = (rows: Awaited<Cards["content"]>["cards"][number]["rows"]) =>
    drawnCards(
      { rows: 2, cards: [{ title: TITLE, count: false }] },
      { cards: [{ id: "spiele", title: TITLE, rows, count: false, empty: { kind: "none", plural: TITLE } }] },
    );

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

    // Landed, the list holds each box, a matchday's head in its group; waiting, the wait's box in the content's place holds it.
    const list = within(landed).getByRole("heading", { name: HEADS[0] }).closest("section")?.parentElement?.parentElement;
    const boxes = [...(list?.children ?? [])];
    expect(boxes.map((box) => box.querySelector("h3")?.textContent)).toStrictEqual(HEADS);
    expect(boxes.map((box) => box.querySelectorAll("a").length)).toStrictEqual([1, 1]);
    expect(waiting.querySelector("[aria-busy] > [aria-hidden] > *")?.children).toHaveLength(2);
  });

  // The harm: a season before its draw drawn as an empty box, which reads as a list that failed to load.
  it("gives way to the list's own empty state", async () => {
    const { landed } = await drawn(2, { groups: [], empty: EMPTY });

    expect(landed.querySelector("main")?.textContent).toBe(COPY.shared.empty.none(COPY.page.spiele));
  });
});
