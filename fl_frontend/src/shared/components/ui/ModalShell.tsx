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
 * footer separator reach the dialog's edges (decided 2026-08-07).
 *
 * With `p-4` on the dialog, `Modal.Body` was a scroll container whose padding box sat 1rem inside the
 * border — and `overflow-y: auto` computes `overflow-x` to `auto` too, so anything bleeding sideways
 * was clipped or produced a horizontal scrollbar. No negative margin inside the body could ever cross
 * that boundary. Moving the inset down one level puts the clip edge at the dialog's border instead,
 * so `MODAL_FOOTER`'s negative margin lands exactly on it. The rendered padding is unchanged.
 *
 * **`mx-0` on the body is load-bearing, and it is what makes `MODAL_FOOTER`'s arithmetic the app's own.**
 * HeroUI 3.2.3 gives `.modal__body` `-m-[3px] … p-[3px]`, so the body sat 3px WIDER than the dialog's
 * content box while the app's `px-4` set the inset to 16px — a net 13px that no declaration in this
 * repository stated, and that `MODAL_FOOTER` therefore had to guess. Zeroing the inline margin here
 * makes the body's content box exactly `px-4` inside the dialog, so the footer cancels a number this
 * file owns rather than one a HeroUI patch release can move. The block margin is already `my-0` in
 * HeroUI's own rule, so only the inline axis is in play.
 */
const modalShell = tv({
  slots: {
    dialog: "bg-background border-border text-foreground flex w-full flex-col rounded-2xl border px-0 py-4 shadow-2xl outline-none",
    header: "shrink-0 px-4 pb-4",
    heading: "fluid-lg text-foreground font-extrabold tracking-tight",
    body: "scrollbar-hide text-foreground mx-0 px-4",
  },
  variants: {
    size: {
      form: { dialog: "max-h-modal max-w-2xl", body: "flex-1 scrollbar-gutter-stable overflow-y-auto" },
      /* `max-w-sm`, one step under the old `max-w-md`: a confirmation carries one sentence and two
         buttons, and the wider box read as an empty form (sixth review). Both confirmation
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
      variant="opaque">
      {/* The blur lives on this EMPTY sibling, never on the backdrop itself (reported,
          2026-08-08). HeroUI's `variant="blur"` puts `backdrop-filter` on the ancestor that contains
          the whole dialog, and Chromium drops the filter — permanently, surviving close and reopen —
          once animated content composites inside the filtered element's subtree: the delete
          confirmation's step-2 swap was the reported trigger, and the container's own enter zoom
          runs there on every open. An element with no children has no subtree for any animation to
          run in, so the breakage has nothing to attach to. `opaque` keeps HeroUI's dim on the
          backdrop; painting below its children, it is part of what this layer blurs.
          `pointer-events-none` so an outside press still reaches the backdrop's dismiss. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 backdrop-blur-md"
      />
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
