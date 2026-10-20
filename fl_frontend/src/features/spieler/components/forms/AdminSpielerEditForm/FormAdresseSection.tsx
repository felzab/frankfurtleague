"use client";

import { useState } from "react";

import Pencil from "@gravity-ui/icons/Pencil";

import { Button } from "@heroui/react/button";

import { ADRESSE_HINWEIS, AdresswechselBeantragen } from "@/features/konto/components/forms/AdresswechselBeantragen";
import { beantrageSpielerAdresswechselAction } from "@/features/spieler/actions";
import { ADRESSE_AENDERN } from "@/features/spieler/constants";
import { FLSpielerAdresswechselPayloadSchema } from "@/features/spieler/schemas";
import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { FocusSlot } from "@/shared/components/ui/FocusSlot";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { toFieldErrors } from "@/shared/utils/validation";

import type { AdresswechselFehler } from "@/features/konto/components/forms/AdresswechselBeantragen";

/** The schema's own sentences for the box's two values, empty where it takes them. */
const urteil = (spielerId: string, email: string, grund: string | null): AdresswechselFehler => {
  const geprueft = FLSpielerAdresswechselPayloadSchema.safeParse({ id: spielerId, email: email, grund: grund });
  if (geprueft.success) return {};
  const fehler = toFieldErrors(geprueft.error);
  return { email: fehler.email, grund: fehler.grund };
};

/**
 * Behind „Adresse ändern“, an administrator's start of a change for a pupil who cannot sign in. The save
 * never carries one: **the stored address stays in force until the change takes effect**.
 */
export function FormAdresseSection({
  spielerId,
  email,
  isDirty,
  entwurf,
  onEntwurfChange,
}: {
  spielerId: string;
  /** The stored, folded address, `null` for a pupil holding none, who takes no change. */
  email: string | null;
  /** The editor's unsaved typing, which the write re-keys the editor over. */
  isDirty: boolean;
  /** The box's typing, `null` while it is closed. Held above the editor's key, so a save's refresh keeps it. */
  entwurf: string | null;
  onEntwurfChange: (next: string | null) => void;
}) {
  // Set by the press alone: a box the refresh remounts open takes no focus from wherever the reader is.
  const [perDruck, setPerDruck] = useState(false);
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="E-Mail-Adresse">
          <Hint
            mode="reveal"
            label="Hinweis zur E-Mail-Adresse"
            body={{ lead: ADRESSE_HINWEIS }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <dl className={FIELD_PAIR_CLASSES}>
          <Angabe label="Hinterlegte Adresse">{email ?? <Leer />}</Angabe>
        </dl>

        {email === null ? (
          // The missing control in the same breath, as the consent panel beside it says its own: a reader
          // meeting an empty value among editable panels goes looking for the way to enter one.
          <p className="muted-hint">Eine Adresse kommt mit der Registrierung über den Link des Teams.</p>
        ) : (
          <FocusSlot name="adresse-aendern">
            {entwurf !== null ? (
              <AdresswechselBeantragen
                gespeicherteAdresse={email}
                isDirty={isDirty}
                entwurf={entwurf}
                fokussieren={perDruck}
                schema={FLSpielerAdresswechselPayloadSchema}
                pruefe={(neu, grund) => urteil(spielerId, neu, grund)}
                write={(neu, grund) => beantrageSpielerAdresswechselAction({ id: spielerId, email: neu, grund: grund })}
                onEntwurfChange={onEntwurfChange}
                onFertig={() => onEntwurfChange(null)}
              />
            ) : (
              <div className="flex w-full flex-wrap items-start gap-2">
                <Button
                  type="button"
                  onPress={() => {
                    setPerDruck(true);
                    // Prefilled, because the commonest correction is one wrong character.
                    onEntwurfChange(email);
                  }}
                  className={`${formButton({ intent: "nav", size: "xs" })} gap-x-2`}>
                  <Pencil
                    className="size-3.5"
                    aria-hidden="true"
                  />
                  <span>{ADRESSE_AENDERN}</span>
                </Button>
              </div>
            )}
          </FocusSlot>
        )}
      </div>
    </section>
  );
}
