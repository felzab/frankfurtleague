// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { MailedPage } from "./MailedPage";
import { OneShotForm } from "./OneShot";

import type { ReactElement } from "react";
import type { MailedState } from "./MailedPage";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => {} }) }));

/** A read that never lands, so the page shows its wait. */
const READING = new Promise<MailedState>(() => {});

const FIELD = "field";

/** The markup the server sends for an element, as a browser holds it before the page's code runs. */
function served(element: ReactElement): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(element);
  return root;
}

/** The wait of a question asking one field, its sentences and its boxes as given. */
const wait = (shape: { sentence?: string | false; sentenceAfter?: string; boxes?: boolean }) =>
  served(
    <MailedPage
      page={READING}
      facts={0}
      act={COPY.shared.verb.next}
      fields={<span data-field={FIELD} />}
      {...shape}
    />,
  );

/** The field's placeholder in a page's markup. */
const fieldIn = (page: HTMLElement) => page.querySelector(`[data-field="${FIELD}"]`);

/** The class of the wrapper the landed question's form gives its fields. */
const landedWrapper = (boxes: boolean) =>
  fieldIn(
    served(
      <OneShotForm
        head={<h1>{COPY.shared.help}</h1>}
        action={async () => ({ ok: false, reason: COPY.shared.failure.tooManyAttempts })}
        acts={{ primary: COPY.shared.verb.next }}
        boxes={boxes}>
        <span data-field={FIELD} />
      </OneShotForm>,
    ),
  )?.parentElement?.className;

// The harm: the page shifting when its read lands, a paragraph, a line or a box out of place in the wait, which no
// reading of the landed page meets and no type holds.
describe("a mailed question's wait", () => {
  it("stands the second sentence in a paragraph of its own only where the question has one", () => {
    const after = COPY.shared.verb.signIn;

    expect(wait({ sentence: COPY.shared.help }).textContent).not.toContain(after);
    expect(wait({ sentence: COPY.shared.help, sentenceAfter: after }).textContent).toContain(after);
  });

  it("draws no sentence's line where the question has none, the fields following the title", () => {
    /** Whether the fields' wrapper stands directly under the title's line, the wait's first block. */
    const underTitle = (page: HTMLElement) => {
      const before = fieldIn(page)?.parentElement?.previousElementSibling;
      return before !== null && before !== undefined && before === before.parentElement?.firstElementChild;
    };

    expect(underTitle(wait({ sentence: false }))).toBe(true);
    expect(underTitle(wait({}))).toBe(false);
  });

  it.each([false, true])("lays the fields out as the landed form does, boxes %s", (boxes) => {
    expect(fieldIn(wait({ boxes }))?.parentElement?.className).toBe(landedWrapper(boxes));
  });
});
