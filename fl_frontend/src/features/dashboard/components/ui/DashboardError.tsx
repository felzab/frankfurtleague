"use client";

import { ArrowRotateRight } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { CrashReportLink } from "@/shared/components/ui/CrashReportLink";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";

export function DashboardError({ error, retry, isRetrying }: { error: Error & { digest?: string }; retry: () => void; isRetrying: boolean }) {
  return (
    <StatusPanel
      variant="inline"
      tone="warning"
      badgeLabel="Spielunterbrechung"
      heading="Daten konnten nicht geladen werden."
      message="Dieser Bereich ist gerade nicht erreichbar. Der Fehler wurde automatisch gemeldet."
      digest={error.digest}>
      <Button
        onPress={() => retry()}
        isDisabled={isRetrying}
        // The brand fill, as on every sole way out in the tree: `outline` is the grade of a peer or
        // a second choice, and a panel offering one control has neither.
        className={`${ctaButton({ intent: "primary", hover: "aria" })} mt-8`}>
        <ArrowRotateRight className="mr-2 size-4" />
        {isRetrying ? "Lädt neu..." : "Ansicht neu laden"}
      </Button>

      <CrashReportLink digest={error.digest} />
    </StatusPanel>
  );
}
