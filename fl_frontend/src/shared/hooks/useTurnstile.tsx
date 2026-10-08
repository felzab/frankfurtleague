"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Script from "next/script";

import { useTheme } from "next-themes";

import { KONTAKT_EMAIL } from "@/core/brand";
import { MENSCH_BESTAETIGEN } from "@/core/turnstileToken";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { postClientError } from "@/shared/utils/clientError";

import type { ReactNode } from "react";

// Explicit rendering, Cloudflare's way for a page whose forms mount after it loads; fetched from this exact
// URL, never proxied (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/, read 2026-10-04).
const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Cloudflare's own bound on a siteverify call: a press waits for a token being minted as long as the
// server would wait for its verdict, and is then answered rather than posting a token the server refuses.
const TOKEN_WAIT_MS = 10_000;

/** A press past `TOKEN_WAIT_MS` with no token minted. */
export const NOCH_NICHT_FERTIG = "Die Prüfung, ob Du ein Mensch bist, ist noch nicht fertig. Versuche es gleich erneut.";

/**
 * A form's sentence for a check that did not load. A blocked check stays refused, so the league's address is the
 * way in for a browser that will not load it.
 */
export const NICHT_GELADEN = `Die Prüfung, ob Du ein Mensch bist, ließ sich nicht laden. Erlaube challenges.cloudflare.com in Deinem Browser oder Werbeblocker und lade die Seite neu, oder schreib uns an ${KONTAKT_EMAIL}.`;

/** The calls of Cloudflare's script this hook makes, as its client-side rendering page documents them. */
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

const turnstileApi = (): TurnstileApi | undefined => (window as Window & { turnstile?: TurnstileApi }).turnstile;

/** Minting, holding a token, showing Cloudflare's click, or failed until Cloudflare's own retry mints one. */
type Stand = "laedt" | "bereit" | "interaktiv" | "fehlgeschlagen";

/** A press's token, or the sentence it is answered with instead: a press never posts an empty token. */
type Anfrage = { readonly token: string } | { readonly satz: string };

/**
 * One form's bot check: `widget` stands before the submit, where Cloudflare's example places it, and each
 * press awaits `takeToken`. `fehlgeschlagen` is the form's sentence for a check that did not load.
 */
export function useTurnstile(
  siteKey: string,
  fehlgeschlagen: string = NICHT_GELADEN,
): { widget: ReactNode; takeToken: () => Promise<Anfrage> } {
  const [stand, setStandState] = useState<Stand>("laedt");
  // Read by a press, which can run between a callback and the render it causes.
  const standNow = useRef<Stand>("laedt");
  const setStand = (next: Stand): void => {
    standNow.current = next;
    setStandState(next);
  };

  // State rather than a ref, so a container the form mounts anew is an effect's dependency.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // Already there after a client navigation, whose `onReady` would only confirm it.
  const [isScriptReady, setIsScriptReady] = useState(() => typeof window !== "undefined" && turnstileApi() !== undefined);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  /** The presses waiting on the next callback, handed its token or `null` where it brought none. */
  const waiting = useRef(new Set<(minted: string | null) => void>());
  const reported = useRef(false);

  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const settle = (minted: string | null): void => {
    for (const waiter of [...waiting.current]) waiter(minted);
  };

  // Reported once per form: Cloudflare retries by itself, calling back again for the one fault.
  const fail = (code: string): void => {
    token.current = null;
    setStand("fehlgeschlagen");
    settle(null);
    if (reported.current) return;
    reported.current = true;
    postClientError(`turnstile.widget_failed ${code}`);
  };

  const onToken = useEffectEvent((minted: string) => {
    token.current = minted;
    setStand("bereit");
    settle(minted);
  });
  const onExpired = useEffectEvent(() => {
    token.current = null;
    setStand("laedt");
  });
  const onError = useEffectEvent((code: string) => fail(code));
  const onInteractive = useEffectEvent(() => {
    setStand("interaktiv");
    settle(null);
  });
  const onInteractiveDone = useEffectEvent(() => {
    if (standNow.current === "interaktiv") setStand(token.current === null ? "laedt" : "bereit");
  });

  // One widget per container and theme, removed with them: a second render into a container is a second
  // widget, minting and loading Cloudflare's frame of its own.
  useEffect(() => {
    const api = turnstileApi();
    if (container === null || !isScriptReady || api === undefined) return;

    const id = api.render(container, {
      sitekey: siteKey,
      appearance: "interaction-only",
      // A token lives 300 seconds, and the application form takes longer than that to fill in.
      "refresh-expired": "auto",
      // The token is handed over at the press, and no form here posts its own fields.
      "response-field": false,
      language: "de",
      // 150 pixels wide: `normal` and `flexible` take 300 at least, wider than the sign-in card's
      // content at a 375-pixel phone.
      size: "compact",
      // A widget takes its theme at render alone, so the site's toggle renders it anew.
      theme: theme,
      callback: (minted: string) => onToken(minted),
      "expired-callback": () => onExpired(),
      // True tells Cloudflare the failure is handled; without the callback its script throws into the page.
      "error-callback": (code: unknown) => {
        onError(String(code));
        return true;
      },
      "before-interactive-callback": () => onInteractive(),
      "after-interactive-callback": () => onInteractiveDone(),
    });
    if (id === undefined) return;
    widgetId.current = id;

    return () => {
      widgetId.current = null;
      // Minting again with the token: a press before the new widget mints waits for it, never answers at once.
      token.current = null;
      setStand("laedt");
      api.remove(id);
    };
  }, [container, isScriptReady, siteKey, theme]);

  const takeToken = (): Promise<Anfrage> => {
    const handOver = (minted: string): Anfrage => {
      // A token is spent by the check it reaches, so the next press's starts being minted now.
      token.current = null;
      setStand("laedt");
      if (widgetId.current !== null) turnstileApi()?.reset(widgetId.current);
      return { token: minted };
    };
    const withoutToken = (): Anfrage => {
      if (standNow.current === "fehlgeschlagen") return { satz: fehlgeschlagen };
      return { satz: standNow.current === "interaktiv" ? MENSCH_BESTAETIGEN : NOCH_NICHT_FERTIG };
    };

    if (token.current !== null) return Promise.resolve(handOver(token.current));
    if (standNow.current !== "laedt") return Promise.resolve(withoutToken());

    return new Promise((resolve) => {
      const waiter = (minted: string | null): void => {
        clearTimeout(timer);
        waiting.current.delete(waiter);
        resolve(minted === null ? withoutToken() : handOver(minted));
      };
      const timer = setTimeout(() => waiter(null), TOKEN_WAIT_MS);
      waiting.current.add(waiter);
    });
  };

  return {
    widget: (
      <>
        <div
          ref={setContainer}
          // Spacing alone follows the callbacks: Cloudflare shows and hides the widget itself, so a missed
          // callback costs a margin and never the challenge.
          className={stand === "interaktiv" ? "pb-4" : undefined}
        />
        {stand === "fehlgeschlagen" && <p className={`${FIELD_ERROR_CLASSES} pb-4`}>{fehlgeschlagen}</p>}
        {/* `onReady` rather than `onLoad`: it runs again on every mount, a client navigation back included. */}
        <Script
          src={TURNSTILE_API}
          onReady={() => setIsScriptReady(true)}
          // A blocked script calls no callback of Cloudflare's, so its failure is the page's to report.
          onError={() => fail("script")}
        />
      </>
    ),
    takeToken,
  };
}
