// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { RailFrame } from "./RailFrame";

import type { Account } from "./FrameNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bereich/verwaltung/spielorte",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

const ADRESSE = "verwaltung@example.com";

const ACCOUNT: Account = {
  name: ADRESSE,
  role: COPY.verwaltung.rolle,
  address: ADRESSE,
  menu: [[{ kind: "link", label: COPY.vorlage.konto, href: "/bereich/konto/signin" }]],
};

describe("the rail frame's account", () => {
  it("streams in: the frame and its page are drawn while the session is still judged", async () => {
    const { promise: account, resolve } = Promise.withResolvers<Account | null>();
    await act(async () =>
      render(
        <RailFrame
          groups={[{ entries: [{ id: "spielorte", label: COPY.seite.spielorte, href: "/bereich/verwaltung/spielorte", icon: "suche" }] }]}
          bar={["spielorte"]}
          foot={{ kind: "account", account }}>
          <p>Seite</p>
        </RailFrame>,
      ),
    );

    expect(screen.getByText("Seite")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: COPY.seite.spielorte }).length).toBeGreaterThan(0);
    expect(screen.queryByText(COPY.verwaltung.rolle)).toBeNull();

    await act(async () => resolve(ACCOUNT));
    expect(screen.getByText(COPY.verwaltung.rolle)).toBeTruthy();
  });

  it("shows no account for a session the area turns away", async () => {
    await act(async () =>
      render(
        <RailFrame
          groups={[]}
          bar={["spielorte"]}
          foot={{ kind: "account", account: Promise.resolve(null) }}>
          <p>Seite</p>
        </RailFrame>,
      ),
    );

    expect(screen.getByText("Seite")).toBeTruthy();
    expect(screen.queryByRole("button", { name: COPY.vorlage.konto })).toBeNull();
    expect(screen.queryByText(ADRESSE)).toBeNull();
  });
});
