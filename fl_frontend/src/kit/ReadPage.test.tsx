// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ReadPage } from "./ReadPage";

import type { ComponentProps, ReactElement } from "react";
import type { ReadRecord } from "./ReadPage";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const { fact } = COPY.spielplan;

const RECORD: ReadRecord = {
  title: { route: "spiel", team1: { record: "Goethe" }, team2: { record: "Helmholtz" } },
  groups: [{ kind: "facts", facts: [{ label: fact.spieltag, value: { record: "1. Spieltag" } }] }],
};

/** The document once every boundary has its content. */
async function streamed(page: ReactElement): Promise<HTMLElement> {
  const stream = await renderToReadableStream(page);
  await stream.allReady;
  const root = document.createElement("div");
  root.innerHTML = await new Response(stream).text();
  return root;
}

describe("a match's own page", () => {
  it("heads its facts with the match's head and what befell the match", async () => {
    const page = await streamed(
      <ReadPage
        scope="saison"
        record={Promise.resolve({
          ...RECORD,
          spiel: {
            head: {
              eyebrow: COPY.shared.spieltag(1),
              team1: { name: { record: "Goethe" }, plaque: { record: "GOE" } },
              team2: { name: { record: "Helmholtz" }, plaque: { record: "HEL" } },
            },
            sonderereignis: { title: COPY.spielplan.sonderereignis.ausgefallen, text: COPY.spielplan.sonderereignis.consequence.ausgefallen },
          },
        })}
      />,
    );

    const head = within(page).getByText("Goethe");
    const callout = within(page).getByText(COPY.spielplan.sonderereignis.consequence.ausgefallen);
    const facts = within(page).getByText(fact.spieltag);
    expect(head.compareDocumentPosition(callout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(callout.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("a club's own page", () => {
  it("heads its groups with the club's head and, where the club left the season, its route, its day and its reason", async () => {
    const title = COPY.shared.austrittSince(COPY.shared.austritt.disqualifikation.state, "2026-03-14");
    const page = await streamed(
      <ReadPage
        scope="saison"
        record={Promise.resolve({
          ...RECORD,
          club: { head: <p>Goethe-Gymnasium</p>, austritt: { title, text: { record: "Zweimal nicht angetreten." } } },
        })}
      />,
    );

    const head = within(page).getByText("Goethe-Gymnasium");
    const note = within(page).getByText(title);
    const grund = within(page).getByText("Zweimal nicht angetreten.");
    const facts = within(page).getByText(fact.spieltag);
    expect(note.textContent).toBe("Disqualifiziert seit 14.03.2026");
    expect(head.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(grund) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grund.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the read page's wait", () => {
  it("draws the facts' skeleton while the record is read, and the record once it is", async () => {
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(
      <ReadPage
        scope="saison"
        record={new Promise(() => undefined)}
      />,
    );
    expect(within(waiting).getByRole("status").textContent).toBe(COPY.shared.loading);
    // The record names the page, so no heading stands until it is read.
    expect(within(waiting).queryByRole("heading", { level: 1 })).toBeNull();

    const read = await streamed(
      <ReadPage
        scope="saison"
        record={Promise.resolve(RECORD)}
      />,
    );
    expect(within(read).getByRole("heading", { level: 1 }).textContent).toBe(COPY.page.spiel({ record: "Goethe" }, { record: "Helmholtz" }));
    expect(within(read).getByText("1. Spieltag")).toBeTruthy();
    expect(within(read).queryByRole("status")).toBeNull();
  });
});
