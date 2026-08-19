"use client";

import { signOutAction } from "@/features/auth/actions";
import { AppShell } from "@/shared/components/layout/shell/AppShell";

import { ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../../constants";

import type React from "react";

/**
 * A client wrapper rather than the layout calling `AppShell` directly: `shared` may not import from
 * `features`, so the sign-out action is injected here. Its presence is also the gate — the dashboard
 * shell passes none and renders no sign-out item.
 */
export function AdminShell({ saisonMetadataDisplay, children }: { saisonMetadataDisplay: React.ReactNode; children: React.ReactNode }) {
  return (
    <AppShell
      structure={ADMIN_SIDEMENU_STRUCTURE}
      linkPrefix="/admin"
      iconDictionary={ADMIN_SIDEMENU_ICONS}
      saisonMetadataDisplay={saisonMetadataDisplay}
      // What the bar reads on the match editor, which is under `/admin/spiele/` and is no nav entry
      // of its own.
      fallbackTitle="Admin"
      onSignOut={signOutAction}>
      {children}
    </AppShell>
  );
}
