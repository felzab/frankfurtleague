"use client";

import Plus from "@gravity-ui/icons/Plus";

import { useOverlayState } from "@heroui/react";
import { Button } from "@heroui/react/button";

import { formButton } from "./formButtons";
import { FormModal } from "./FormModal";

import type { ReactNode } from "react";

/** An admin list's create trigger and the dialog it opens, the body handed the dialog's close. */
export function CreateModal({ label, heading, children }: { label: string; heading: string; children: (close: () => void) => ReactNode }) {
  const modalState = useOverlayState();

  return (
    <>
      <Button
        onPress={modalState.open}
        className={formButton({ intent: "trigger" })}>
        <Plus
          aria-hidden="true"
          className="size-4.5"
        />
        {/* Hidden from sight rather than from the tree below `sm`: it is the button's only name. */}
        <span className="max-sm:sr-only">{label}</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading={heading}>
        {children(modalState.close)}
      </FormModal>
    </>
  );
}
