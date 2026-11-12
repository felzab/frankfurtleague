/**
 * E2E · layout shift as the browser reports it: every `layout-shift` entry of the Layout Instability API
 * (https://wicg.github.io/layout-instability/), each source described while its node still stands, so a failure names
 * what moved and from where to where.
 *
 * The budget is zero, summed over every entry's `value`, `hadRecentInput` included. The usual metric, CLS, would pass
 * what this guard exists for: it leaves out an entry within 500 ms of an input, which every client navigation's shift
 * is, and calls 0.1 good, where the landing's 19-px jump measured 0.0059. Chromium alone reports the entries: WebKit
 * lists no `layout-shift` among `PerformanceObserver.supportedEntryTypes`, so the `layout` project runs in Chromium at
 * a phone's size too.
 */
import path from "node:path";

import { expect } from "@playwright/test";

import { E2E_DIR } from "./journey";

import type { BrowserContext, Page } from "@playwright/test";

/**
 * Who the guard signs in as by a mailed code, each a record of the seed no journey writes to, and where each lands:
 * `../layout/sessions.setup.ts` signs each in once a run.
 */
export const SIGNED_IN_BY_CODE = {
  // A captain of the running season who played the finished one too.
  pupil: { address: "mia.ahornberg@schule.example", landing: /^\/area\/spieler\/2027$/ },
  // Booked in both seasons, an agreed booking today and a played match's report owed.
  referee: { address: "anna.ahrens@example.com", landing: /^\/area\/schiedsrichter$/ },
  // Kastanie's Ansprechperson: a stored line-up, a locked one, an agreed date and several registrations.
  contact: { address: "konrad.kuhn@example.com", landing: /^\/area\/team\/[0-9a-f]{24}\/2027$/ },
} as const;

/**
 * Where a code's role's session is kept between the setup and the guard: beside the administrator's, with the stack's
 * keys, never in the run's output, which a failed CI run uploads.
 */
export const sessionFile = (role: keyof typeof SIGNED_IN_BY_CODE): string => path.join(E2E_DIR, `layout-${role}.json`);

/**
 * The entry the API reports (https://wicg.github.io/layout-instability/#sec-layout-shift), which TypeScript's DOM
 * library does not declare, Chromium being its one implementation.
 */
type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
  sources: readonly { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
};

/** A box as `DOMRectReadOnly` gives it, in CSS pixels rounded: x, y, width, height. */
type Box = readonly [number, number, number, number];

/** One node that moved, described in the document it moved in. */
type ShiftSource = {
  /** The landmark it stands in: `main`, `header`, `nav`, `aside`, `footer`, or `none`. */
  landmark: string;
  /** The node and its two nearest ancestors, by tag, id, kit slot and the first classes. */
  node: string;
  /** The start of its text. */
  text: string;
  previous: Box | null;
  current: Box | null;
};

/** One entry of the API: the address it was reported at, its share of the viewport moved, and its sources. */
type Shift = { address: string; value: number; hadRecentInput: boolean; sources: readonly ShiftSource[] };

/** Every shift a context's documents have reported, in the order they arrived. */
export type ShiftRecord = Shift[];

/** The function each document hands its entries to, on every frame's `window`: a name no page of the site uses. */
const SHIFT_BINDING = "journeyMeetsLayoutShift";

/**
 * Records every layout shift each document of `context` reports, from its first frame: an init script runs before any
 * script of the page, and the observer's `buffered` flag hands it the entries reported before it observed. Each entry
 * goes to the driver as it arrives, so a document a redirect leaves keeps its entries.
 */
export async function recordShifts(context: BrowserContext): Promise<ShiftRecord> {
  const record: ShiftRecord = [];
  await context.exposeBinding(SHIFT_BINDING, (_source, shift: Shift) => {
    record.push(shift);
  });
  await context.addInitScript((binding) => {
    const forward = (shift: unknown) => {
      void (Reflect.get(window, binding) as (shift: unknown) => Promise<void>)(shift);
    };
    const one = (element: Element) => {
      const slot = element.getAttribute("data-slot") ?? element.getAttribute("role") ?? element.getAttribute("aria-label");
      const classes = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      return `${element.tagName.toLowerCase()}${element.id === "" ? "" : `#${element.id}`}${slot === null ? "" : `[${slot.slice(0, 30)}]`}${classes === "" ? "" : `.${classes.slice(0, 90)}`}`;
    };
    const describe = (node: Node | null) => {
      const element = node === null ? null : node instanceof Element ? node : node.parentElement;
      if (element === null) return { landmark: "none", node: "#text", text: "" };
      const chain: string[] = [];
      for (let at: Element | null = element; at !== null && chain.length < 3; at = at.parentElement) chain.push(one(at));
      return {
        landmark: ["main", "header", "nav", "aside", "footer"].find((name) => element.closest(name) !== null) ?? "none",
        node: chain.join(" < "),
        text: (element instanceof HTMLElement ? element.innerText : (element.textContent ?? "")).trim().replace(/\s+/g, " ").slice(0, 60),
      };
    };
    const box = (rect: DOMRectReadOnly): readonly number[] => [rect.x, rect.y, rect.width, rect.height].map(Math.round);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        forward({
          address: location.pathname + location.search,
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: entry.sources.map((source) => ({
            ...describe(source.node),
            previous: box(source.previousRect),
            current: box(source.currentRect),
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, SHIFT_BINDING);
  return record;
}

/**
 * Waits until `page` stands still: no `[aria-busy="true"]` left, then two animation frames and 300 ms in which no new
 * shift arrives and the address holds, repeated until one such window passes. A navigation inside the window destroys
 * the context it was waited in, which is a page still moving, so the wait starts again.
 */
export async function settle(page: Page, record: ShiftRecord): Promise<void> {
  for (;;) {
    const [count, address] = [record.length, page.url()];
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const quiet = await page
      .evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), 300)));
          }),
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.includes("Execution context was destroyed")) return false;
        throw error;
      });
    if (quiet && record.length === count && page.url() === address) return;
  }
}

/** A shift in the words of a failure: where, how much, and each source's box before and after. */
function wordsOf({ address, value, hadRecentInput, sources }: Shift): string {
  const lines = sources.map(
    ({ landmark, node, text, previous, current }) =>
      `    ${landmark}: ${node}${text === "" ? "" : ` „${text}“`}  ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`,
  );
  return [`  ${address}: ${value.toFixed(5)}${hadRecentInput ? " (after an input)" : ""}`, ...lines].join("\n");
}

/**
 * Runs `act`, a load or a navigation, waits until the page stands still, and asserts that nothing moved: the sum of every
 * shift reported since `act` began is zero. Soft, so a test's other loads still report.
 */
export async function expectStill(page: Page, record: ShiftRecord, act: () => Promise<unknown>): Promise<void> {
  const from = record.length;
  await act();
  await settle(page, record);
  const shifts = record.slice(from);
  const total = shifts.reduce((sum, { value }) => sum + value, 0);
  expect.soft(total, `the page moved while it loaded:\n${shifts.map(wordsOf).join("\n")}`).toBe(0);
}
