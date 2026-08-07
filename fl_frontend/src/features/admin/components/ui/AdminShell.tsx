"use client";

import { signOutAction } from "@/features/auth/actions";
import { AppShell } from "@/shared/components/layout/shell/AppShell";

import { ADMIN_SIDEMENU_ICONS, ADMIN_SIDEMENU_STRUCTURE } from "../../constants";

import type React from "react";

/**
 * The admin shell: the app's chrome, wired to the admin navigation.
 *
 * A thin client wrapper rather than the layout calling `AppShell` directly, for one reason — the
 * sign-out. `AppShell` lives in `shared`, which may not import from `features`, so the action is
 * injected here. Its presence is also the gate: the dashboard shell passes none and therefore
 * renders no sign-out item at all.
 */
export function AdminShell({ saisonMetadataDisplay, children }: { saisonMetadataDisplay: React.ReactNode; children: React.ReactNode }) {
  return (
    <AppShell
      structure={ADMIN_SIDEMENU_STRUCTURE}
      linkPrefix="/admin"
      iconDictionary={ADMIN_SIDEMENU_ICONS}
      saisonMetadataDisplay={saisonMetadataDisplay}
      // What the bar reads on the match editor, which sits under `/admin/spiele/` and is no nav
      // entry of its own. That page names the fixture it is editing in its own `h2`.
      fallbackTitle="Admin"
      onSignOut={signOutAction}>
      {children}
    </AppShell>
  );
}
