"use client";

import { DASHBOARD_SIDEMENU_ICONS, DASHBOARD_SIDEMENU_STRUCTURE } from "@/features/dashboard/constants";
import { AppShell } from "@/shared/components/layout/shell/AppShell";

import type React from "react";

/**
 * The dashboard shell: the app's chrome, wired to the public dashboard navigation.
 *
 * **No `onSignOut`, and that absence is the switch** — these routes are behind no session, so the
 * footer's options menu renders the theme control and nothing else.
 */
export function DashboardShell({ saisonMetadataDisplay, children }: { saisonMetadataDisplay: React.ReactNode; children: React.ReactNode }) {
  return (
    <AppShell
      structure={DASHBOARD_SIDEMENU_STRUCTURE}
      linkPrefix="/dashboard"
      iconDictionary={DASHBOARD_SIDEMENU_ICONS}
      saisonMetadataDisplay={saisonMetadataDisplay}
      // What the bar reads on the two detail routes — `/dashboard/teams/<id>` and
      // `/dashboard/spieler/<id>` resolve to their section, so this is reached only by
      // `/dashboard` itself, which has no page of its own and redirects.
      fallbackTitle="Saisonübersicht">
      {children}
    </AppShell>
  );
}
