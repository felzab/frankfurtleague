// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertionAnswer } from "@/core/auth/assertionAnswer";
import { COPY } from "@/core/copy";

import { usePasskeyTouch } from "./usePasskeyTouch";

/** What the assertion answers once a passkey answered the prompt, which the case sets. */
const touch = vi.hoisted(() => ({ answer: null as unknown }));

// Replaced at the module boundary: the real client asks the browser's authenticator, which no test process holds. The
// answer is the one the server writes (`fl_frontend/src/core/auth/library.ts`), never the plugin's typed `data.user`.
vi.mock("@/core/auth/browserClient", () => ({
  loadAuthClient: async () => ({
    signIn: { passkey: async () => ({ data: touch.answer, error: null }) },
  }),
  usePreloadedAuthClient: () => undefined,
}));

const HOLDER = "inhaberin@example.org";

beforeEach(() => {
  touch.answer = assertionAnswer(HOLDER);
});

/* A page whose own session ended asks a prompt naming nobody, so any account's passkey on the device answers it,
   signing that account in: the browser's own set-up would add its passkey to that account. */
describe("the passkey touch", () => {
  it("runs the act where the holder's own passkey answered, whatever its spelling", async () => {
    touch.answer = assertionAnswer(HOLDER.toUpperCase());
    const ran = vi.fn();
    const { result } = renderHook(() => usePasskeyTouch(true, HOLDER));

    await act(async () => {
      expect(await result.current.run(ran)).toBe(null);
    });
    expect(ran).toHaveBeenCalledOnce();
  });

  it("refuses as the page's sign-in ended where another account's passkey answered, running nothing", async () => {
    touch.answer = assertionAnswer("jemand-anderes@example.org");
    const ran = vi.fn();
    const { result } = renderHook(() => usePasskeyTouch(true, HOLDER));

    await act(async () => {
      expect(await result.current.run(ran)).toBe(COPY.shared.failure.signInExpired);
    });
    expect(ran).not.toHaveBeenCalled();
    expect(result.current.refusal).toBe(COPY.shared.failure.signInExpired);
  });

  it("runs nothing where the assertion's answer names no account, as a sign-in's bare answer does", async () => {
    touch.answer = { status: true };
    const ran = vi.fn();
    const { result } = renderHook(() => usePasskeyTouch(true, HOLDER));

    await act(async () => {
      expect(await result.current.run(ran)).toBe(COPY.shared.failure.unexpected);
    });
    expect(ran).not.toHaveBeenCalled();
  });
});
