import { beforeEach } from "node:test";

/** One widget the page asked Cloudflare's script for, with the options it was rendered with. */
type Widget = {
  readonly id: string;
  readonly container: HTMLElement;
  readonly options: Record<string, unknown>;
  removed: boolean;
  resets: number;
};

type Callback = (...args: unknown[]) => unknown;

/**
 * Cloudflare's script, which jsdom never loads: the three calls the hook makes, and its callbacks for a
 * case to fire. Each case starts with no widget, a render and a reset minting a token at once.
 */
export function doubleTurnstile(): {
  /** Every widget rendered in the case so far, removed ones included. */
  widgets: Widget[];
  /** The widgets on the page now. */
  live: () => Widget[];
  /** Whether a render and a reset mint at once; off, a token comes only from `mint`. */
  mintsAtOnce: (on: boolean) => void;
  /** Mints a token for the one widget on the page and returns it. */
  mint: () => string;
  /** The last token minted in the case. */
  lastMinted: () => string | undefined;
  /** Fires the live widget's named callback, as Cloudflare would. */
  fire: (
    callback: "error-callback" | "expired-callback" | "before-interactive-callback" | "after-interactive-callback",
    ...args: unknown[]
  ) => unknown;
} {
  const widgets: Widget[] = [];
  let mintsAtOnce = true;
  let minted = 0;
  let last: string | undefined;

  const live = (): Widget[] => widgets.filter((widget) => !widget.removed);

  const only = (): Widget => {
    const standing = live();
    if (standing.length !== 1) throw new Error(`${String(standing.length)} widgets stand on the page, not one`);
    return standing[0] as Widget;
  };

  const mintFor = (widget: Widget): string => {
    minted += 1;
    last = `turnstile-token-${String(minted)}`;
    (widget.options.callback as Callback)(last);
    return last;
  };

  const byId = (id: string): Widget => {
    const widget = widgets.find((candidate) => candidate.id === id);
    if (widget === undefined || widget.removed) throw new Error(`no widget ${id} stands on the page`);
    return widget;
  };

  Reflect.set(window, "turnstile", {
    render: (container: HTMLElement, options: Record<string, unknown>): string => {
      const widget: Widget = { id: `widget-${String(widgets.length + 1)}`, container, options, removed: false, resets: 0 };
      widgets.push(widget);
      if (mintsAtOnce) mintFor(widget);
      return widget.id;
    },
    reset: (id: string): void => {
      const widget = byId(id);
      widget.resets += 1;
      if (mintsAtOnce) mintFor(widget);
    },
    remove: (id: string): void => {
      byId(id).removed = true;
    },
  });

  beforeEach(() => {
    widgets.length = 0;
    mintsAtOnce = true;
    last = undefined;
  });

  return {
    widgets,
    live,
    mintsAtOnce: (on) => {
      mintsAtOnce = on;
    },
    mint: () => mintFor(only()),
    lastMinted: () => last,
    fire: (callback, ...args) => (only().options[callback] as Callback)(...args),
  };
}
