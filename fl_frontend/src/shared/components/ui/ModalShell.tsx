"use client";

import { tv } from "tailwind-variants";

import { Modal } from "@heroui/react";

import type { ReactNode } from "react";

/**
 * The one modal appearance. It exists so the 20-class dialog string is declared once rather than
 * copied to each of the five sites that need it — the way three unrelated modal looks arise, with
 * the only one the public ever sees being the odd one out.
 */
/**
 * **The horizontal padding lives on the HEADER and BODY, not on the dialog**, and that is what lets a
 * footer separator reach the dialog's edges (owner, 2026-08-07).
 *
 * With `p-4` on the dialog, `Modal.Body` was a scroll container whose padding box sat 1rem inside the
 * border — and `overflow-y: auto` computes `overflow-x` to `auto` too, so anything bleeding sideways
 * was clipped or produced a horizontal scrollbar. No negative margin inside the body could ever cross
 * that boundary. Moving the inset down one level puts the clip edge at the dialog's border instead,
 * so `MODAL_FOOTER`'s negative margin lands exactly on it. The rendered padding is unchanged.
 */
const modalShell = tv({
  slots: {
    dialog: "bg-background border-border text-foreground flex w-full flex-col rounded-2xl border px-0 py-4 shadow-2xl outline-none",
    header: "shrink-0 px-4 pb-4",
    heading: "fluid-lg text-foreground font-extrabold tracking-tight",
    body: "scrollbar-hide text-foreground px-4",
  },
  variants: {
    size: {
      form: { dialog: "max-h-modal max-w-2xl", body: "flex-1 scrollbar-gutter-stable overflow-y-auto" },
      /* `max-w-sm`, one step under the old `max-w-md`: a confirmation carries one sentence and two
         buttons, and the wider box read as an empty form (owner, sixth review). Both confirmation
         dialogs share the size, so the delete and the discard stay one family. */
      confirm: { dialog: "max-w-sm", header: "pt-2", body: "pb-2" },
    },
  },
  defaultVariants: { size: "form" },
});

export function ModalShell({
  isOpen,
  onClose,
  heading,
  icon,
  size,
  role,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  heading: string;
  /** Rendered to the left of the heading — the destructive confirmations' danger badge. */
  icon?: ReactNode;
  size?: "form" | "confirm";
  /**
   * `"alertdialog"` for an irreversible action, so a screen reader signals it as one instead of
   * announcing it exactly like the benign create/edit dialogs. It reaches react-aria's
   * `useDialog`, which defaults to `"dialog"` and applies whatever it is given.
   */
  role?: "dialog" | "alertdialog";
  children: ReactNode;
}) {
  const styles = modalShell({ size });

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      // HeroUI reports both directions; the shell only owns closing. Callers that need the open
      // edge (the create modals) keep their own `useOverlayState` around it.
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog
          role={role}
          className={styles.dialog()}>
          <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

          <Modal.Header className={styles.header()}>
            <div className="flex items-center gap-4">
              {icon}
              <Modal.Heading className={styles.heading()}>{heading}</Modal.Heading>
            </div>
          </Modal.Header>

          <Modal.Body className={styles.body()}>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
