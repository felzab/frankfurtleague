"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

import { useTheme } from "next-themes";

import type { ReactNode } from "react";

// Explicit rendering, Cloudflare's way for a page whose forms mount after it loads; fetched from this exact
// URL, never proxied (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/, read 2026-10-04).
const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The four calls of Cloudflare's script this hook makes, as its client-side rendering page documents them. */
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  getResponse: (widgetId: string) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

const turnstileApi = (): TurnstileApi | undefined => (window as Window & { turnstile?: TurnstileApi }).turnstile;

/**
 * Cloudflare's bot check on one form: `widget` is mounted once, at a place that stays mounted for as long as
 * the form can submit, and `takeToken` is called at each submit. Unseen unless Cloudflare asks for a click.
 */
export function useTurnstile(siteKey: string): { widget: ReactNode; takeToken: () => string } {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Spacing alone follows these callbacks: Cloudflare shows and hides the widget itself, so a missed
  // callback costs a margin and never the challenge.
  const [isInteractive, setIsInteractive] = useState(false);
  const { resolvedTheme } = useTheme();

  const render = () => {
    const api = turnstileApi();
    if (api === undefined || container.current === null || widgetId.current !== null) return;

    widgetId.current =
      api.render(container.current, {
        sitekey: siteKey,
        appearance: "interaction-only",
        // A token lives 300 seconds, and the application form takes longer than that to fill in.
        "refresh-expired": "auto",
        // The token is handed over at the submit, and no form here posts its own fields.
        "response-field": false,
        language: "de",
        // 150 pixels wide: `normal` and `flexible` take 300 at least, wider than the sign-in card's
        // content at a 375-pixel phone.
        size: "compact",
        theme: resolvedTheme === "dark" ? "dark" : "light",
        "before-interactive-callback": () => setIsInteractive(true),
        "after-interactive-callback": () => setIsInteractive(false),
      }) ?? null;
  };

  useEffect(
    () => () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (id !== null) turnstileApi()?.remove(id);
    },
    [],
  );

  const takeToken = (): string => {
    const id = widgetId.current;
    const api = turnstileApi();
    if (id === null || api === undefined) return "";

    const token = api.getResponse(id) ?? "";
    // A token is spent by the check it reaches, so the next submit's starts being minted now.
    if (token !== "") api.reset(id);

    return token;
  };

  return {
    widget: (
      <>
        <div
          ref={container}
          className={isInteractive ? "pt-4" : undefined}
        />
        {/* `onReady` rather than `onLoad`: it runs again on every mount, a client navigation back included. */}
        <Script
          src={TURNSTILE_API}
          onReady={render}
        />
      </>
    ),
    takeToken,
  };
}
