"use client";

// Upstream: goes with its every call once `enableHydrationChangeEvent` reaches stable React, whose own replay does this.
import { useLayoutEffect, useRef } from "react";

/** A native control whose value React owns. */
type Control = HTMLInputElement | HTMLTextAreaElement;

const isToggle = (control: Control): control is HTMLInputElement => control.type === "checkbox" || control.type === "radio";

/** The server's value as the browser shows it: folding a textarea's `\r\n` or trimming an address is no edit of a person's. */
function drawnText(control: Control) {
  const drawn = control.cloneNode() as Control;
  drawn.value = control.defaultValue;
  return drawn.value;
}

/**
 * The change this control owes React, or `null` where the person left it as the server drew it. The values are read
 * here, in the commit, and the change raised later, so the replay outlives a render writing React's state over the
 * control. A radio the person's choice unticked owes nothing: its group replays the choice. A disabled control takes
 * no press, so what differs there is a browser's restored form, which is no edit.
 */
function owedChange(control: Control) {
  if (control.disabled) return null;
  if (isToggle(control)) {
    const { checked } = control;
    if (checked === control.defaultChecked || (control.type === "radio" && !checked)) return null;
    return () => {
      // Set through React's value tracker, which then sees the press change the control. `click` is the press itself.
      control.checked = !checked;
      control.click();
    };
  }
  const { value: typed, selectionStart, selectionEnd } = control;
  if (typed === control.defaultValue || typed === drawnText(control)) return null;
  return () => {
    // The first write goes through React's value tracker and the second past it, on the prototype, so that the
    // tracker takes the event for a keystroke: it holds the value hydration found, and drops an event finding no change.
    control.value = control.defaultValue;
    Reflect.set(Object.getPrototypeOf(control) as object, "value", typed, control);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    // Each write took the caret to the end. Only the focused control shows one, and an address box exposes none.
    if (selectionStart !== null && control === document.activeElement) control.setSelectionRange(selectionStart, selectionEnd);
  };
}

/**
 * Keeps what a person did to a server-drawn field before the page hydrated. While hydrating, React leaves the browser's
 * `value` and `checked` alone on an `input` and an empty `textarea` and fires no change, so its state stands off what
 * the person sees until the next render writes that state over it. Attached to a field's root, this compares the root's
 * controls to what the server drew in the hydrating commit, before any render can write them, and raises the change a
 * press would have, so a replayed edit is an edit to everything above the field, its draft and the leave guard included.
 * A first client mount finds nothing to raise. A `textarea` holding text is past its reach: React writes that text back
 * while hydrating, so a stored paragraph takes no edit until the page's code runs (`ParagraphBox`).
 *
 * Each change is raised in its own microtask, as React raises its own after the commit: React then flushes the render
 * of one before the next, so a handler reads the state the one before it left, and all of them run before a press
 * held by a form's action, which React replays from a later task.
 */
export function useEarlyEdit() {
  const root = useRef<HTMLDivElement>(null);
  const isDrawn = useRef(false);
  useLayoutEffect(() => {
    // Next's `Activity` re-runs this on each reveal, where a toggle a person pressed
    // since differs from its default, which React never syncs.
    if (isDrawn.current) return;
    isDrawn.current = true;
    for (const control of root.current?.querySelectorAll<Control>("input, textarea") ?? []) {
      const change = owedChange(control);
      if (change !== null) queueMicrotask(change);
    }
  }, []);
  return root;
}
