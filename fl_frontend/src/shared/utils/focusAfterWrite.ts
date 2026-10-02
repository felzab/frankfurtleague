const SECTION = "data-focus-section";
const ROW = "data-focus-row";
const SLOT = "data-focus-slot";
const HEADING = "data-focus-heading";

/** The box whose heading takes the focus when nothing in it can, and the scope its rows are looked up in. */
export const focusSection = (key: string): Record<string, string> => ({ [SECTION]: key });

/** One row of a section, keyed by the entity it shows, so the key survives the row being drawn again. */
export const focusRow = (key: string): Record<string, string> => ({ [ROW]: key });

/** Every control standing in one place carries its name: the pressed one, and whatever replaces it. */
export const focusSlot = (name: string): Record<string, string> => ({ [SLOT]: name });

/** `-1` so the heading takes a landing without becoming a tab stop. */
export const FOCUS_HEADING = { [HEADING]: "", tabIndex: -1 } as const;

/** Every element the browser lets a press or a Tab reach, before the inert and disabled ones are dropped. */
const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]";

/** Where the focus stood when the write was pressed, by keys alone: a re-keyed editor draws every element anew. */
type Place = {
  /** The sections around the control, innermost first. */
  sections: readonly string[];
  slot: string | null;
  /** The pressed row, then the rows after it, then the rows before it, each half nearest first. */
  rows: readonly (string | null)[];
};

let armed: (() => void) | null = null;

const keyed = (scope: ParentNode, attribute: string, key: string): Element[] =>
  [...scope.querySelectorAll(`[${attribute}]`)].filter((element) => element.getAttribute(attribute) === key);

/** A row's own section only: a nested section's rows are a different list. */
const rowsOf = (section: Element): Element[] =>
  [...section.querySelectorAll(`[${ROW}]`)].filter((row) => row.closest(`[${SECTION}]`) === section);

/** The slot's tab stop: under a refusal that is the overlay beside the inert control, which the slot holds too. */
function stopIn(slot: Element): HTMLElement | null {
  const candidates = [slot, ...slot.querySelectorAll(FOCUSABLE)];

  return (
    candidates.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.matches(FOCUSABLE) &&
        !element.matches(":disabled") &&
        element.getAttribute("tabindex") !== "-1" &&
        element.closest("[inert]") === null,
    ) ?? null
  );
}

function placeOf(anchor: Element): Place | null {
  const sections: string[] = [];
  for (let section = anchor.closest(`[${SECTION}]`); section !== null; section = section.parentElement?.closest(`[${SECTION}]`) ?? null) {
    sections.push(section.getAttribute(SECTION) ?? "");
  }
  if (sections.length === 0) return null;

  const section = anchor.closest(`[${SECTION}]`);
  const row = anchor.closest(`[${ROW}]`);
  const keys = section === null ? [] : rowsOf(section).map((each) => each.getAttribute(ROW));
  const at = row === null ? -1 : keys.indexOf(row.getAttribute(ROW));

  return {
    sections,
    slot: anchor.closest(`[${SLOT}]`)?.getAttribute(SLOT) ?? null,
    rows: at === -1 ? [null] : [keys[at] ?? null, ...keys.slice(at + 1), ...keys.slice(0, at).reverse()],
  };
}

function target(place: Place): HTMLElement | null {
  const [inner = ""] = place.sections;
  const section = keyed(document, SECTION, inner)[0];

  if (section !== undefined && place.slot !== null) {
    for (const row of place.rows) {
      const scopes = row === null ? [section] : rowsOf(section).filter((each) => each.getAttribute(ROW) === row);
      for (const scope of scopes) {
        const stop = keyed(scope, SLOT, place.slot)
          .map(stopIn)
          .find((each) => each !== null);
        if (stop !== undefined) return stop;
      }
    }
  }

  // Outward from the pressed control's own section, as each one an emptied list or a decided page took away goes too.
  for (const key of place.sections) {
    const heading = keyed(document, SECTION, key)[0]?.querySelector<HTMLElement>(`[${HEADING}]`);
    if (heading != null) return heading;
  }

  return document.querySelector<HTMLElement>(`h1[${HEADING}]`);
}

/**
 * The one landing for a control its own write takes off the page (`docs/frontend/spec.md :: I540`).
 * Read at the press, so the rows around it are the ones the reader saw; `landed` once the write succeeded.
 */
export function focusAfterWrite(anchor: Element | null = document.activeElement): { landed: () => void } {
  const place = anchor === null ? null : placeOf(anchor);

  return {
    landed: () => {
      if (anchor === null || place === null) return;
      armed?.();

      const land = (): boolean => {
        if (anchor.isConnected) return false;
        // A focus held outside the control's sections stays where it is, as a dialog not yet closed over
        // the control holds it. One inside them was put there by the page, the reader having pressed
        // nothing since: react-aria's grid falls back to the cell.
        const active = document.activeElement;
        if (active !== null && active !== document.body && !place.sections.some((key) => keyed(document, SECTION, key)[0]?.contains(active))) {
          return false;
        }
        target(place)?.focus();
        return true;
      };
      if (land()) return;

      // The refresh carrying the write's result commits after the action answers, so the control is
      // still standing here.
      const observer = new MutationObserver(() => {
        if (land()) stop();
      });
      // A key or a press is the reader acting again, after which a landing would move them off it.
      const stop = (): void => {
        observer.disconnect();
        document.removeEventListener("keydown", stop, true);
        document.removeEventListener("pointerdown", stop, true);
        if (armed === stop) armed = null;
      };
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("keydown", stop, true);
      document.addEventListener("pointerdown", stop, true);
      armed = stop;
    },
  };
}
