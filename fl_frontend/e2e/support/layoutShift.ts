/**
 * E2E · layout shift as the browser reports it: every `layout-shift` entry of the Layout Instability API
 * (https://wicg.github.io/layout-instability/), each source described while its node still stands, so a failure names
 * what moved and from where to where.
 *
 * The budget is zero, summed over every entry's `value`, `hadRecentInput` included. The usual metric, CLS, would pass
 * what this guard exists for: it leaves out an entry within 500 ms of an input, which every client navigation's shift
 * is, and calls 0.1 good, where the landing's 19-px jump measured 0.0059.
 *
 * A press and a load are each held to the budget from their start, every entry counted. A load's first frame shows its
 * page whole: the root layout's `expect` link keeps Chromium from painting a document opened by address until its
 * body's last element is parsed, so no frame shows a box sized by content later in the document before that content.
 *
 * Chromium alone reports the entries: WebKit lists no `layout-shift` among `PerformanceObserver.supportedEntryTypes`,
 * so the `layout` project runs in Chromium at a phone's size too, and the recorder fails a context whose browser lists
 * none.
 */
import path from "node:path";

import { expect, test } from "@playwright/test";

import { E2E_DIR } from "./journey";

import type { BrowserContext, Page } from "@playwright/test";

/**
 * Who the guard signs in as by a mailed code, each a record of the seed no journey writes to, and where each lands:
 * `../layout/sessions.setup.ts` signs each in once a run.
 */
export const SIGNED_IN_BY_CODE = {
  // A captain of the running season who played the finished one too.
  pupil: { address: "mia.ahornberg@schule.example", landing: /^\/area\/spieler$/ },
  // Booked in both seasons, an agreed booking today and a played match's report owed.
  referee: { address: "anna.ahrens@example.com", landing: /^\/area\/schiedsrichter$/ },
  // Kastanie's Ansprechperson: a stored line-up, a locked one, an agreed date and several registrations.
  contact: { address: "konrad.kuhn@example.com", landing: /^\/area\/team\/[0-9a-f]{24}\/2027$/ },
} as const;

/**
 * A referee no journey signs in as, whom the guard signs in by a mailed code a moment before reading the passkey's
 * offer, which stands for five minutes after a sign-in: `../layout/shift.spec.ts` signs them in itself, never a setup.
 */
export const NEWCOMER = "carla.conrad@example.com";

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
 * Records every layout shift each document of `page`'s context reports, from its first frame: an init script runs
 * before any script of the page, and the observer's `buffered` flag hands it the entries reported before it observed.
 * Each entry goes to the driver as it arrives, so a document a redirect leaves keeps its entries. A browser listing no
 * `layout-shift` entry would observe nothing and sum zero on every page, so the context fails at once; an entry whose
 * sources cannot be described still counts its value.
 */
export async function recordShifts(page: Page): Promise<ShiftRecord> {
  const context: BrowserContext = page.context();
  expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("layout-shift")), "the browser reports layout shift").toBe(
    true,
  );
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
    const sourcesOf = (entry: LayoutShiftEntry) => {
      try {
        return entry.sources.map((source) => ({
          ...describe(source.node),
          previous: box(source.previousRect),
          current: box(source.currentRect),
        }));
      } catch (error) {
        // A throw here would drop the entry's value with it, and the case would sum zero.
        return [{ landmark: "none", node: `undescribed: ${String(error)}`, text: "", previous: null, current: null }];
      }
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        forward({
          address: location.pathname + location.search,
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: sourcesOf(entry),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, SHIFT_BINDING);
  return record;
}

/** The quiet one window of `settle` asks for, after two animation frames. */
const QUIET_MS = 300;

/**
 * How many windows `settle` waits through for a quiet one before it fails naming what moved. It is the smaller of two
 * budgets: a case's timeout reached first would fail the case with no shift named, so `settle` refuses a timeout its
 * windows cannot fit in.
 */
const WINDOWS = 10;

/**
 * Waits until `page` stands still: two animation frames and `QUIET_MS` in which no new shift arrives and the address
 * holds, repeated until one such window passes, and failing after `WINDOWS` with the shifts and the address it saw. A
 * navigation inside the window destroys the context it was waited in, which is a page still moving, so the wait starts
 * again.
 */
export async function settle(page: Page, record: ShiftRecord): Promise<void> {
  const { timeout } = test.info();
  if (timeout !== 0 && WINDOWS * QUIET_MS >= timeout) {
    throw new Error(`settle's ${String(WINDOWS)} windows of ${String(QUIET_MS)} ms outlast the case's timeout of ${String(timeout)} ms`);
  }
  const from = record.length;
  for (let window = 0; window < WINDOWS; window++) {
    const [count, address] = [record.length, page.url()];
    const quiet = await page
      .evaluate(
        (ms) =>
          new Promise<boolean>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(true), ms)));
          }),
        QUIET_MS,
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.includes("Execution context was destroyed")) return false;
        throw error;
      });
    if (quiet && record.length === count && page.url() === address) return;
  }
  throw new Error(`the page never stood still in ${String(WINDOWS)} windows, at ${page.url()}:\n${record.slice(from).map(wordsOf).join("\n")}`);
}

/** A shift in the words of a failure: where, how much, and each source's box before and after. */
function wordsOf({ address, value, hadRecentInput, sources }: Shift): string {
  const lines = sources.map(
    ({ landmark, node, text, previous, current }) =>
      `    ${landmark}: ${node}${text === "" ? "" : ` „${text}“`}  ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`,
  );
  return [`  ${address}: ${value.toFixed(5)}${hadRecentInput ? " (after an input)" : ""}`, ...lines].join("\n");
}

/** The share of the viewport `shifts` moved, summed: what the budget of zero is held against. */
export const totalOf = (shifts: ShiftRecord): number => shifts.reduce((sum, { value }) => sum + value, 0);

/**
 * Runs `act`, a load or a press, waits until the page stands still, and asserts that nothing moved: the sum of every
 * shift reported since `act` began is zero. Soft, so a test's other loads still report. Answers what `act` answered.
 */
export async function expectStill<Answer>(page: Page, record: ShiftRecord, act: () => Promise<Answer>): Promise<Answer> {
  const from = record.length;
  const answer = await act();
  await settle(page, record);
  const shifts = record.slice(from);
  expect.soft(totalOf(shifts), `the page moved while it loaded:\n${shifts.map(wordsOf).join("\n")}`).toBe(0);
  return answer;
}
