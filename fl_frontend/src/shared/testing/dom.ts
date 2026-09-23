import { afterEach, beforeEach } from "node:test";

import { JSDOM } from "jsdom";

// Without `pretendToBeVisual` jsdom defines no `requestAnimationFrame`, which react-aria's focus scope calls as a dialog unmounts.
const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true });

// Installed as this module evaluates, so it is the first import of every file using it: `react-dom/client`, Testing
// Library's `screen` and react-aria each read whether a document exists once, as they load.
for (const key of Object.getOwnPropertyNames(window)) {
  if (!key.startsWith("_") && !(key in globalThis)) Reflect.set(globalThis, key, Reflect.get(window, key));
}

// Node's own `navigator` survives the copy above and answers `language` with the runner's locale, which react-aria
// reads as its default where no `I18nProvider` is mounted. The site pins `de-DE`
// (`fl_frontend/src/core/providers/RootProviders.tsx`); so does the test window.
Object.defineProperties(globalThis.navigator, {
  language: { configurable: true, value: "de-DE" },
  languages: { configurable: true, value: ["de-DE"] },
});

// Node defines these itself, and jsdom refuses an instance of Node's: react-aria's focus scope dispatches a
// `CustomEvent` as a dialog unmounts, and react-dom builds a `FormData` from the form a submit handler transitions from.
Object.assign(globalThis, { Event: window.Event, CustomEvent: window.CustomEvent, FormData: window.FormData });

// jsdom lays nothing out and animates nothing, so it has none of these. HeroUI's `ScrollShadow` constructs an observer
// as a `Tabs` mounts.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
// react-aria's shared-element transition asks the tab indicator for its animations.
window.Element.prototype.getAnimations ??= () => [];
// An opened list scrolls its option into view.
window.Element.prototype.scrollTo ??= () => undefined;

// Nor does it evaluate a media query, which the editors' rails read as they mount. Every query answers unmatched and
// never changes, the narrow layout being the one a page without a viewport renders.
window.matchMedia ??= (media: string): MediaQueryList =>
  Object.assign(new window.EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
globalThis.matchMedia ??= window.matchMedia;

// Testing Library sets this only under a global `beforeAll`, which `node:test` lacks; unset, React stays silent about a
// state update landing outside `act`.
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// Awaited only now, the globals above being what `react-dom/client` reads as it loads. The gate runs every scope at
// once, and a `waitFor` that settles in milliseconds alone took 1.27 s there against the default 1 s ceiling.
const { configure } = await import("@testing-library/react");
configure({ asyncUtilTimeout: 5000 });

let thrownInCase: unknown[] | null = null;

// A browser only logs what a handler or a frame callback threw. Here it fails the case it happened in, or the file
// where it lands between cases, rather than scrolling past a green run.
window.addEventListener("error", (event) => {
  event.preventDefault();
  if (thrownInCase !== null) thrownInCase.push(event.error);
  else
    queueMicrotask(() => {
      throw event.error;
    });
});

beforeEach(() => {
  thrownInCase = [];
});

afterEach(async () => {
  // Imported here and never above, where it would load `react-dom/client` ahead of the globals. Testing Library
  // unmounts between cases only where a global `afterEach` exists, which `node:test` lacks.
  const { cleanup } = await import("@testing-library/react");
  cleanup();

  const thrown = thrownInCase ?? [];
  thrownInCase = null;
  if (thrown.length === 1) throw thrown[0];
  if (thrown.length > 1) throw new AggregateError(thrown, "the page threw more than once");
});
