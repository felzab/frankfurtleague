/**
 * E2E · a server action's answer, read whole. Next posts an action to the page's own path with its id in the
 * `next-action` header and streams the answer back. Chromium does not always keep that response's body: it drops it
 * once the page navigates, and has dropped it for an answer no navigation followed, so `Response.text()` can fail
 * with "No resource with given identifier found". The route fetches the answer itself with `route.fetch()` and hands it on with
 * `route.fulfill()`, Playwright's documented way to read a response before the page acts on it
 * (https://playwright.dev/docs/network#modify-responses).
 */
import type { Page } from "@playwright/test";

/** What the action answered: its headers, every `set-cookie` line apart, and its body. */
export type ActionAnswer = {
  readonly headers: Readonly<Record<string, string>>;
  readonly setCookies: ReadonlyArray<string>;
  readonly body: string;
};

/** Runs `press` on the page at `pathname` and answers the first server action it posts there. */
export async function answerOf(page: Page, pathname: string, press: () => Promise<void>): Promise<ActionAnswer> {
  let answered: (answer: ActionAnswer) => void = () => undefined;
  const answer = new Promise<ActionAnswer>((resolve) => {
    answered = resolve;
  });

  const thePage = (url: URL) => url.pathname === pathname;
  await page.route(thePage, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || (await request.headerValue("next-action")) === null) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    answered({
      headers: response.headers(),
      setCookies: response
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => value),
      body: await response.text(),
    });
    await route.fulfill({ response });
  });

  try {
    await press();
    return await answer;
  } finally {
    await page.unroute(thePage);
  }
}
