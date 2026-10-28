"use client";

import { Form } from "react-aria-components/Form";
import { tv } from "tailwind-variants/lite";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { HelpPopover } from "./HelpPopover";
import { statusOf, useFormAction } from "./useFormAction";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";
import type { ActionAnswer, FormStatus } from "./useFormAction";

const statusLine = tv({
  base: "line-clamp-2 min-w-0 flex-1 text-sm",
  variants: {
    tone: {
      none: "",
      changes: "text-fg",
      saved: "text-success",
      error: "text-danger",
    },
  },
});

/**
 * One section of a Konto page that saves on its own: a box exactly as tall as its content, its 16-px title,
 * its fields, then a footer with the status line that is always there and the box's own „Speichern“. The
 * outcome stands in that line: „Gespeichert“, or a short red line with the input kept; a field's message
 * stands under the field. A „Gespeichert“ shown is cleared once the page is left.
 */
export function KontoBox({
  title,
  help,
  action,
  children,
}: {
  title: Copy;
  /** The section's one short help text, behind the ⓘ after its title. */
  help?: Copy;
  /** The server action saving this box's fields, read from the form by their `name`s. */
  action: (formData: FormData) => Promise<ActionAnswer>;
  /** The box's fields: the kit's, each with its `name`. */
  children: ReactNode;
}) {
  const { answer, submit, block, isBlocked, isPending } = useFormAction(action, { resetOnLeave: true });
  const status: FormStatus = statusOf(answer, isBlocked) ?? (answer?.ok === true ? { tone: "saved", text: COPY.shared.gespeichert } : null);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg">
      <Form
        validationErrors={answer !== null && !answer.ok ? answer.fieldErrors : undefined}
        onInvalid={block}
        onSubmit={(event) => {
          event.preventDefault();
          submit(new FormData(event.currentTarget));
        }}>
        <div className="grid gap-4 p-4">
          {/* The ⓘ stands beside the heading, not in it, so the heading is named by its title alone. */}
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            {help !== undefined && (
              <HelpPopover
                subject={title}
                text={help}
              />
            )}
          </div>
          <div className="grid justify-items-start gap-4">{children}</div>
        </div>
        <div className="flex items-center gap-3 border-t border-border bg-bg-surface px-4 py-3">
          <p className={statusLine({ tone: status?.tone ?? "none" })}>{status?.text}</p>
          <Button
            variant="primary"
            type="submit"
            label={COPY.shared.verb.speichern}
            isBusy={isPending}
          />
        </div>
      </Form>
    </section>
  );
}
