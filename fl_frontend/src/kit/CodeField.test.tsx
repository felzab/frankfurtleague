// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { CodeField } from "./CodeField";

const { code } = COPY.anmeldung;

/** The six drawn boxes, which assistive technology does not reach. */
const boxes = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[aria-hidden][data-kit-focus=field]")];

describe("the code field", () => {
  it("is one input under one name, offering the mailed code and the digits keyboard", () => {
    render(
      <CodeField
        label={code}
        name="code"
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: code })).toBe(inputs[0]);
    expect(inputs[0]?.getAttribute("autocomplete")).toBe("one-time-code");
    expect(inputs[0]?.getAttribute("inputmode")).toBe("numeric");
    expect(inputs[0]?.getAttribute("name")).toBe("code");
  });

  it("takes focus as it appears, in place of the button pressed to send the code", () => {
    render(
      <CodeField
        label={code}
        name="code"
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: code }));
  });

  it("draws each digit in its box and keeps only digits, six at most", async () => {
    const { container } = render(
      <CodeField
        label={code}
        name="code"
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: code }), "12a 3456789");
    expect(screen.getByRole("textbox", { name: code })).toHaveProperty("value", "123456");
    expect(boxes(container).map((box) => box.textContent)).toStrictEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("takes a pasted code whole, its spaces dropped", async () => {
    const done = vi.fn();
    render(
      <CodeField
        label={code}
        name="code"
        onComplete={done}
      />,
    );
    await userEvent.click(screen.getByRole("textbox", { name: code }));
    await userEvent.paste("123 456");
    expect(done).toHaveBeenCalledExactlyOnceWith("123456");
  });

  it("calls back once the sixth digit is in, and not before", async () => {
    const done = vi.fn();
    render(
      <CodeField
        label={code}
        name="code"
        onComplete={done}
      />,
    );
    const input = screen.getByRole("textbox", { name: code });
    await userEvent.type(input, "12345");
    expect(done).not.toHaveBeenCalled();
    await userEvent.type(input, "6");
    expect(done).toHaveBeenCalledExactlyOnceWith("123456");
  });

  it("shows its edge on the box the next digit goes into while focused", async () => {
    const { container } = render(
      <CodeField
        label={code}
        name="code"
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: code }), "12");
    expect(boxes(container).map((box) => box.hasAttribute("data-focused"))).toStrictEqual([false, false, true, false, false, false]);

    await userEvent.tab();
    expect(boxes(container).some((box) => box.hasAttribute("data-focused"))).toBe(false);
  });

  it("states a refusal as the field's description, and marks the field invalid", () => {
    const refusal = COPY.anmeldung.abgelehnt.codeFalsch;
    render(
      <CodeField
        label={code}
        name="code"
        error={refusal}
      />,
    );
    const input = screen.getByRole("textbox", { name: code });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByText(refusal);
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
    // In the line under the boxes, which announces it at once.
    const line = screen.getByRole("alert");
    expect(line.contains(message)).toBe(true);
  });
});
