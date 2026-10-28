// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { RailFrame, RailPage } from "./RailFrame";

import type { Account } from "./FrameNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bereich/verwaltung/spielorte",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: theme.setTheme }) }));

const leave = vi.hoisted(() => ({ signOut: vi.fn(), leaveDocumentFor: vi.fn(), appToast: vi.fn() }));
vi.mock("@/shared/utils/signOut", () => ({ signOut: leave.signOut }));
vi.mock("@/shared/utils/documentNavigation", () => ({ leaveDocumentFor: leave.leaveDocumentFor }));
vi.mock("./Toast", async (original) => ({ ...(await original<Record<string, unknown>>()), appToast: leave.appToast }));

const ADRESSE = "verwaltung@example.com";

// An administrator: the grant stores no name.
const ACCOUNT: Account = { role: COPY.verwaltung.rolle, address: ADRESSE };

/** The frame of a one-page area around a page, its account read as given. */
async function renderFrame(account: Promise<Account | null>) {
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
}

/** Opens the account menu from the rail's row, which holds the role. */
async function openMenu() {
  const row = screen.getByText(COPY.verwaltung.rolle).closest("button");
  if (row === null) throw new Error("the account row is no button");
  await userEvent.click(row);
}

beforeEach(() => {
  // The rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
  vi.clearAllMocks();
});

describe("the rail frame's account", () => {
  it("streams in: the frame and its page are drawn while the session is still judged", async () => {
    const { promise: account, resolve } = Promise.withResolvers<Account | null>();
    await renderFrame(account);

    expect(screen.getByText("Seite")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: COPY.seite.spielorte }).length).toBeGreaterThan(0);
    expect(screen.queryByText(COPY.verwaltung.rolle)).toBeNull();

    await act(async () => resolve(ACCOUNT));
    expect(screen.getByText(COPY.verwaltung.rolle)).toBeTruthy();
  });

  it("shows no account for a session the area turns away", async () => {
    await renderFrame(Promise.resolve(null));

    expect(screen.getByText("Seite")).toBeTruthy();
    expect(screen.queryByText(ADRESSE)).toBeNull();
  });
});

describe("the rail's entries", () => {
  it("mark the current page as every navigating list marks its place", async () => {
    await renderFrame(Promise.resolve(ACCOUNT));

    const current = screen.getAllByRole("link", { name: COPY.seite.spielorte }).find((link) => link.getAttribute("aria-current") === "page");
    expect(current?.hasAttribute("data-selected")).toBe(true);
  });
});

/** The signed-out frame around a page with its title strip, where the rail's toggle stands. */
async function renderPage() {
  await act(async () =>
    render(
      <RailFrame
        groups={[{ entries: [{ id: "spielorte", label: COPY.seite.spielorte, href: "/bereich/verwaltung/spielorte", icon: "suche" }] }]}
        bar={["spielorte"]}
        foot={{ kind: "anmelden", href: ROUTES.anmeldung.pfad() }}>
        <RailPage
          area="bereich"
          title={{ route: "verwaltungSpielorte" }}>
          <p>Seite</p>
        </RailPage>
      </RailFrame>,
    ),
  );
}

/** The rail's own link for the entry, apart from the phone bar's for the same page. */
function railLink(rail: HTMLElement) {
  return screen.getAllByRole("link", { name: COPY.seite.spielorte }).find((link) => rail.contains(link));
}

describe("the rail's collapse", () => {
  it("keeps each entry's name for a screen reader and names it in a tooltip only while collapsed", async () => {
    await renderPage();
    const toggle = screen.getByRole("button", { name: COPY.vorlage.seitenleiste.einklappen });
    const rail = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    if (rail === null) throw new Error("the toggle controls no rail");

    // A tab from the rail's logo reaches the entry as a keyboard would, which is what opens a tooltip on focus.
    const logo = screen.getAllByRole("link", { name: COPY.marke.name })[0];
    if (logo === undefined) throw new Error("the rail has no logo");

    // Expanded, the entry shows its own words: focusing it from the keyboard opens no tooltip.
    logo.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(railLink(rail));
    expect(screen.queryByRole("tooltip")).toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: COPY.vorlage.seitenleiste.ausklappen })).toBe(toggle);
    expect(railLink(rail)?.textContent).toBe(COPY.seite.spielorte);
    logo.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(railLink(rail));
    expect(screen.getByRole("tooltip").textContent).toBe(COPY.seite.spielorte);
  });

  it("toggles with Ctrl+B, and with Cmd+B on a Mac, from anywhere on the page", async () => {
    await renderPage();
    const toggle = screen.getByRole("button", { name: COPY.vorlage.seitenleiste.einklappen });

    await userEvent.keyboard("{Control>}b{/Control}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.keyboard("{Meta>}b{/Meta}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // Below the rail's breakpoint no rail shows: a flip would fold it unseen and take the browser's own Ctrl+B.
  it("leaves Ctrl+B to the browser where the rail does not stand", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: false }) as MediaQueryList);
    await renderPage();
    const press = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true });

    act(() => void window.dispatchEvent(press));

    expect(press.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: COPY.vorlage.seitenleiste.einklappen }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the account menu", () => {
  it("names an address with no name once, in the row, and repeats it in no heading of the menu", async () => {
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    expect(screen.getAllByText(ADRESSE)).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: COPY.vorlage.konto })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: COPY.seite.impressum })).toBeTruthy();
  });

  it("heads the menu with a person's name and address where the person has a name", async () => {
    await renderFrame(Promise.resolve({ ...ACCOUNT, name: "Mia Berg" }));
    await openMenu();

    expect(screen.getAllByText("Mia Berg")).toHaveLength(2);
    expect(screen.getAllByText(ADRESSE)).toHaveLength(1);
  });

  it("signs out with one press and leaves the document for the start page", async () => {
    leave.signOut.mockResolvedValue({ success: true });
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.abmelden }));

    await vi.waitFor(() => expect(leave.leaveDocumentFor).toHaveBeenCalledWith("/"));
    expect(leave.appToast).not.toHaveBeenCalled();
  });

  it("keeps the person in place with the one failure line where the sign-out fails", async () => {
    leave.signOut.mockResolvedValue({ success: false, error: "x" });
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: COPY.shared.verb.abmelden }));

    await vi.waitFor(() => expect(leave.appToast).toHaveBeenCalledWith("danger", COPY.shared.toast.fehler));
    expect(leave.leaveDocumentFor).not.toHaveBeenCalled();
  });

  it("offers the theme as one row of three glyphs at its foot, the one in force marked, and sets the one chosen", async () => {
    await renderFrame(Promise.resolve(ACCOUNT));
    await openMenu();

    // Outside the menu's own list, so its keyboard model is untouched, in the order dark, light, system.
    const row = screen.getByRole("radiogroup", { name: COPY.seite.darstellung });
    expect(screen.getByRole("menu").contains(row)).toBe(false);
    const { darstellung } = COPY.vorlage;
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toStrictEqual([
      darstellung.dunkel,
      darstellung.hell,
      darstellung.system,
    ]);
    expect(screen.getByRole("radio", { name: darstellung.system }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: darstellung.dunkel }));

    expect(theme.setTheme).toHaveBeenCalledWith("dark");
  });
});
