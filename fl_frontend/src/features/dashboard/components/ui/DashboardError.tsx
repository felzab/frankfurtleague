"use client";

import { ArrowRotateRight } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { ctaButton } from "@/shared/components/ui/formButtons";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";

export function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <StatusPanel
      variant="inline"
      tone="warning"
      badgeLabel="Spielunterbrechung"
      heading="Daten konnten nicht geladen werden."
      message="Dieser Bereich ist gerade nicht erreichbar."
      digestLabel="Ref"
      digest={error.digest}>
      <Button
        onPress={() => retry()}
        // The brand fill, as on every sole way out in the tree: `outline` is the grade of a peer or
        // a second choice, and a panel offering one control has neither.
        className={`${ctaButton({ intent: "primary", hover: "aria" })} mt-8`}>
        <ArrowRotateRight className="mr-2 h-4 w-4" />
        Ansicht neu laden
      </Button>
    </StatusPanel>
  );
}
