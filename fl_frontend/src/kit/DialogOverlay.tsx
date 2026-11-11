"use client";

import { Modal, ModalOverlay } from "react-aria-components/Modal";

import { tv } from "./tv";

import type { ReactNode } from "react";
import type { ModalOverlayProps } from "react-aria-components/Modal";

/*
 * What a dialog (`Dialog.tsx`) and a question (`ConfirmDialog.tsx`) both stand on, in a module of its own, so each
 * reads it from here and neither imports the other for it.
 */

/**
 * The dim behind a dialog: a 10 % black scrim and a 4-px blur, fading in and out on the overlay tokens. It
 * covers the whole page, as tall as React Aria's `ModalOverlay` measures the page (`--page-height`), and
 * the centring wrapper inside it stands in the visible part.
 */
const dim = tv({
  base: "absolute top-0 left-0 z-50 h-(--page-height) w-full bg-scrim backdrop-blur-scrim transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)",
});

/**
 * The centred box every dialog shares; `width` is the drawn measure of its kind. It is never taller than
 * the visible window less the 1-rem margin its centring wrapper keeps, and scrolls inside past that, so a
 * long form's act stays in reach: `--visual-viewport-height` is the height React Aria's `ModalOverlay`
 * writes for its modal to cap itself by. Its padding is declared once, as a variable, so a part running out to
 * the box's edges (a field group's line, the pop-up's band) takes back the same measure, as Radix Themes'
 * `Inset` reads its card's.
 */
const dialogBox = tv({
  base: "grid max-h-[calc(var(--visual-viewport-height)-2rem)] w-full gap-6 overflow-y-auto rounded-xl bg-bg-overlay p-(--dialog-padding) text-fg shadow-dialog [--dialog-padding:var(--spacing-6)]",
  variants: {
    width: {
      question: "max-w-question",
      form: "max-w-dialog",
    },
  },
});

/**
 * The overlay every dialog stands in, in React Aria's documented layout: the dim over the whole page, and
 * inside it a wrapper exactly as tall as the visible window, stuck to its top, which centres the box. A
 * phone's open keyboard shrinks the visible window and not the layout one, so the box is centred, and
 * capped, in the part of the screen the keyboard leaves.
 */
export function DialogOverlay({
  width,
  children,
  ...overlay
}: Pick<ModalOverlayProps, "isOpen" | "isDismissable" | "isKeyboardDismissDisabled" | "onOpenChange"> & {
  width: "question" | "form";
  /** The React Aria `Dialog` the box holds. */
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      {...overlay}
      className={dim()}>
      <div className="sticky top-0 left-0 grid h-(--visual-viewport-height) w-full place-items-center p-4">
        <Modal
          data-kit-focus
          className={dialogBox({ width })}>
          {children}
        </Modal>
      </div>
    </ModalOverlay>
  );
}
