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
      badgeLabel="Fehlpass"
      heading="Daten konnten nicht geladen werden."
      message="Dieser Bereich des Dashboards ist momentan nicht erreichbar. Du kannst es noch einmal versuchen oder über das Menü zu einer anderen Ansicht wechseln."
      digestLabel="Ref"
      digest={error.digest}>
      <Button
        onPress={() => retry()}
        className={`${ctaButton({ intent: "outline", hover: "aria" })} mt-8`}>
        <ArrowRotateRight className="mr-2 h-4 w-4" />
        Ansicht neu laden
      </Button>
    </StatusPanel>
  );
}
