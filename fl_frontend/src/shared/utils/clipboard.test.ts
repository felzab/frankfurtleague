import { afterEach, describe, expect, it } from "vitest";

import { copyTextToClipboard } from "./clipboard.ts";

/** Node's own, put back after every case so nothing below leaks into a suite sharing this process. */
const NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, "navigator");

const handedOver: string[] = [];

/** Defined rather than assigned: node declares `navigator` as an accessor with no setter. */
const withClipboard = (clipboard: unknown): void => {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true, writable: true });
};

const RECORDER = {
  writeText: (text: string): Promise<void> => {
    handedOver.push(text);
    return Promise.resolve();
  },
};

afterEach(() => {
  handedOver.length = 0;
  if (NAVIGATOR === undefined) Reflect.deleteProperty(globalThis, "navigator");
  else Object.defineProperty(globalThis, "navigator", NAVIGATOR);
});

describe("copyTextToClipboard", () => {
  it("hands the composed string over and reports the copy", async () => {
    withClipboard(RECORDER);

    expect(await copyTextToClipboard("Anna Schmidt, anna@example.org")).toBe(true);
    expect(handedOver).toStrictEqual(["Anna Schmidt, anna@example.org"]);
  });

  /* Drop the guard and this fails on the second assertion: the empty write goes through, the answer
     is `true`, and a success toast names a copy the reader cannot paste. */
  it("refuses an empty string without reaching the clipboard", async () => {
    withClipboard(RECORDER);

    expect(await copyTextToClipboard("")).toBe(false);
    expect(handedOver, "an empty write reached the clipboard, over whatever the reader had there").toStrictEqual([]);
  });

  it("reports no copy where the browser hands out no clipboard", async () => {
    withClipboard(undefined);

    expect(await copyTextToClipboard("Anna Schmidt")).toBe(false);
  });
});
