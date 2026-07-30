"use client";

import { ArrowRotateRight } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex h-full min-h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      {/* Compact Dashboard Error Card */}
      <div className="bg-surface/50 border-border flex w-full max-w-lg flex-col items-center rounded-2xl border p-8 shadow-sm">
        {/* Warning Badge */}
        <div className="bg-background border-border mb-6 flex items-center gap-2.5 rounded-full border px-3 py-1.5 shadow-sm">
          <div className="bg-warning h-2 w-2 animate-pulse rounded-full" />
          <span className="text-foreground text-fluid-xxs sm:text-fluid-xs font-black tracking-widest uppercase">Fehlpass</span>
        </div>

        <h2 className="text-fluid-lg text-foreground font-extrabold tracking-tight">Daten konnten nicht geladen werden.</h2>

        <p className="text-fluid-sm text-foreground-muted mt-3 leading-relaxed font-medium">
          Dieser Bereich des Dashboards ist momentan nicht erreichbar. Du kannst es noch einmal versuchen oder über das Menü zu einer anderen
          Ansicht wechseln.
        </p>

        {error.digest && <p className="text-foreground-muted/60 mt-4 font-mono text-xs tracking-wider">Ref: {error.digest}</p>}

        <Button
          onPress={() => retry()}
          className="text-fluid-sm border-border hover:bg-muted/50 text-foreground hover:scale-hover mt-8 h-11 rounded-xl border bg-transparent px-6 font-semibold shadow-sm transition-transform">
          <ArrowRotateRight className="mr-2 h-4 w-4" />
          Ansicht neu laden
        </Button>
      </div>
    </div>
  );
}
