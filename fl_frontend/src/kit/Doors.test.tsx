// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { INSTAGRAM_URL, KONTAKT_EMAIL, THREADS_URL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { Door, Doors } from "./Doors";

const QUESTION = {
  ...SERVER_COPY.landing.doors.question,
  email: { label: SERVER_COPY.landing.contact.address, href: `mailto:${KONTAKT_EMAIL}` },
  instagram: INSTAGRAM_URL,
  threads: THREADS_URL,
} as const;

const SCHOOL = {
  title: SERVER_COPY.landing.doors.school.title,
  text: SERVER_COPY.landing.saison.windowUntil("2026-12-31"),
  act: { label: SERVER_COPY.landing.toBewerbung, href: "/bewerbung/2027" },
} as const;

describe("the doors while an application window is open", () => {
  it("holds the school's door with the way to apply, and the heading counts both doors", () => {
    render(
      <Doors
        school={SCHOOL}
        question={QUESTION}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(SERVER_COPY.landing.doors.title(true));
    expect(screen.getByRole("heading", { name: SCHOOL.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: SERVER_COPY.landing.toBewerbung }).getAttribute("href")).toBe("/bewerbung/2027");
  });
});

describe("the doors while no window is open", () => {
  it("drops the school's door, and the heading its count", () => {
    render(<Doors question={QUESTION} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(SERVER_COPY.landing.doors.title(false));
    expect(screen.queryByRole("heading", { name: SCHOOL.title })).toBe(null);
    expect(screen.queryByRole("link", { name: SERVER_COPY.landing.toBewerbung })).toBe(null);
  });

  it("keeps the question's door: the address, and the two networks named by their glyphs' labels", () => {
    render(<Doors question={QUESTION} />);
    expect(screen.getByRole("link", { name: KONTAKT_EMAIL }).getAttribute("href")).toBe(`mailto:${KONTAKT_EMAIL}`);
    expect(screen.getByRole("link", { name: COPY.template.instagram }).getAttribute("href")).toBe(INSTAGRAM_URL);
    expect(screen.getByRole("link", { name: COPY.template.threads }).getAttribute("href")).toBe(THREADS_URL);
  });
});

describe("a door standing alone under a page's title", () => {
  it("heads itself one step under the page, with its act and no paragraph", () => {
    const { container } = render(
      <Door
        title={SERVER_COPY.landing.doors.support}
        level={2}
        act={<span>{COPY.template.instagram}</span>}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(SERVER_COPY.landing.doors.support);
    expect(container.querySelector("p")).toBeNull();
    expect(screen.getByText(COPY.template.instagram)).toBeTruthy();
  });
});
