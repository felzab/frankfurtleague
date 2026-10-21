import assert from "node:assert/strict";

/** The picker's trigger group, whose own click toggles the list: HeroUI wraps the select's button in it. */
export function pickerTrigger(label: string): HTMLElement {
  const button = [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')].find((candidate) =>
    (candidate.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .some((id) => document.getElementById(id)?.textContent?.trim().startsWith(label) === true),
  );
  return button?.closest<HTMLElement>('[data-slot="autocomplete-trigger"]') ?? assert.fail(`no picker trigger labelled ${label}`);
}
