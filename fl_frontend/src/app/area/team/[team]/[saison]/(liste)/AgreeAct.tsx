"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/kit/Button";
import { appToast } from "@/kit/Toast";
import { answering } from "@/kit/useFormAction";

import { COPY } from "@/core/copy";

import { agreeTermin } from "./answerTermin";

/**
 * „Zusagen“ on a date's row, done at once as the administration's at-once acts are: its answer a toast, „Zugesagt“ as
 * the agreed row leaves the box with the next render, or the refusal's reason.
 */
export function AgreeAct({ id }: { /** The confirmation row the answer names. */ id: string }) {
  const router = useRouter();
  const [isAgreeing, startAgreeing] = useTransition();
  return (
    <Button
      variant="primary"
      label={COPY.shared.verb.agree}
      isBusy={isAgreeing}
      onPress={() =>
        startAgreeing(async () => {
          const answer = await answering(agreeTermin, router.refresh)({ id });
          appToast(answer.ok ? "success" : "danger", answer.ok ? COPY.shared.toast.agreed : (answer.reason ?? COPY.shared.toast.failure));
        })
      }
    />
  );
}
