import { afterEach, beforeEach } from "vitest";

// For a file under `// @vitest-environment jsdom`; a node-environment file has no window and gets nothing here.
if (typeof window !== "undefined") {
  // jsdom answers `language` with `en-US`, which react-aria reads as its default where no `I18nProvider`
  // is mounted. The site pins `de-DE` (`fl_frontend/src/core/providers/RootProviders.tsx`); so does the test window.
  Object.defineProperties(window.navigator, {
    language: { configurable: true, value: "de-DE" },
    languages: { configurable: true, value: ["de-DE"] },
  });

  // jsdom lays nothing out and animates nothing, so it has none of these. HeroUI's `ScrollShadow` constructs an
  // observer as a `Tabs` mounts.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // react-aria's shared-element transition asks the tab indicator for its animations.
  Element.prototype.getAnimations ??= () => [];
  // An opened list scrolls its option into view.
  Element.prototype.scrollTo ??= () => undefined;
  // Nor does it hit-test a point: the sign-in code field asks what stands at its right edge, looking for a password
  // manager's badge to make room for, and here nothing ever does.
  Document.prototype.elementFromPoint ??= () => null;
  // Nor does it evaluate a media query, which the editors' rails read as they mount. Every query answers unmatched
  // and never changes, the narrow layout being the one a page without a viewport renders.
  window.matchMedia ??= (media: string): MediaQueryList =>
    Object.assign(new EventTarget(), {
      media,
      matches: false,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
    });

  // Testing Library sets this only where `beforeAll` is a global, which this config leaves off; unset, React stays
  // silent about a state update landing outside `act`.
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  let thrownInCase: unknown[] | null = null;

  // A browser only logs what a handler or a frame callback threw. Here it fails the case it happened in, or the
  // file where it lands between cases, rather than scrolling past a green run.
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
    // Testing Library unmounts between cases only where `afterEach` is a global, which this config leaves off.
    // Loaded here, so a node-environment file never loads `react-dom/client`.
    const { cleanup } = await import("@testing-library/react");
    cleanup();

    const thrown = thrownInCase ?? [];
    thrownInCase = null;
    if (thrown.length === 1) throw thrown[0];
    if (thrown.length > 1) throw new AggregateError(thrown, "the page threw more than once");
  });
}
