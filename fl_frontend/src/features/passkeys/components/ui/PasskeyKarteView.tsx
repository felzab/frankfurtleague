"use client";

import { useState } from "react";

import PencilToLine from "@gravity-ui/icons/PencilToLine";
import TrashBin from "@gravity-ui/icons/TrashBin";

import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { card } from "@/shared/components/ui/card";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

import { PASSKEY_NAME_MAX, PasskeyNamePayloadSchema } from "../../schemas";
import { passkeyAnzeigename } from "../../utils";

import type { PasskeyKarte } from "../../types";

// `timeZone` is what carries this, as it carries `fl_frontend/src/shared/utils/format.ts :: SPIEL_DATE_FORMATTER`:
// the image runs UTC and the reader does not, so a use at night lands on the wrong day.
const DATUM = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "long" });

/**
 * The same sentence `fl_frontend/src/features/passkeys/actions.ts :: LETZTER_PASSKEY` answers: this
 * one closes the control and that one refuses a request reaching the action anyway. **Move both.**
 */
export const LETZTER_PASSKEY = "Der letzte Passkey lässt sich nicht löschen.";

/** What deleting one costs, in the armed reveal: the sign-out is not derivable from a control labelled „Löschen“. */
const FOLGE = "Dieser Passkey wird gelöscht. Geräte, die damit angemeldet sind, werden abgemeldet.";

/** Said where the page itself runs on a session this passkey made, which the removal then ends. */
const FOLGE_DIESES_GERAET = "Auch dieses Gerät wird dabei abgemeldet.";

/** A person's last passkey: what they sign in with afterwards, and the copy their password manager keeps. */
const FOLGE_LETZTER = ["Danach meldest Du Dich wieder mit einem Code per E-Mail an.", "Lösche ihn auch in Deinem Passwortmanager."];

/**
 * One passkey's card. Its own component so each card holds its own armed state
 * (`docs/frontend/spec.md :: I37`): one state shared across the list would leave a second card one
 * press from a removal armed on the first.
 */
export function PasskeyKarteView({
  karte,
  reason,
  istLetzter,
  onRemove,
  onRename,
}: {
  karte: PasskeyKarte;
  /** What closes the deletion, or `null`. An administrator's last card is the list's to judge, not the card's. */
  reason: string | null;
  /** Whether this is the holder's only passkey and they may still delete it, which the reveal then says. */
  istLetzter: boolean;
  onRemove: (id: string) => Promise<void>;
  /** Resolves to whether the name landed, so the form closes on a success alone. */
  onRename: (id: string, name: string) => Promise<boolean>;
}) {
  const twoPress = useTwoPressConfirm();
  const [isRenaming, setIsRenaming] = useState(false);

  return (
    <li className={`${card()} flex flex-col gap-3 p-4 sm:p-5`}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="fluid-sm font-bold break-words text-foreground">{passkeyAnzeigename(karte)}</span>
        {/* Beside a name the holder chose alone: otherwise the maker already is the name above. */}
        {karte.name !== null && karte.anbieter !== null && <span className="muted-hint">{karte.anbieter}</span>}
        <span className="muted-hint">Eingerichtet am {DATUM.format(new Date(karte.eingerichtetAm))}</span>
        {/* No line at all for a passkey whose uses were never stamped, rather than a date that is not its own. */}
        {karte.zuletztVerwendetAm !== null && (
          <span className="muted-hint">Zuletzt verwendet am {DATUM.format(new Date(karte.zuletztVerwendetAm))}</span>
        )}
      </div>

      {isRenaming ? (
        <PasskeyNameForm
          karte={karte}
          onCancel={() => setIsRenaming(false)}
          onSave={async (name) => {
            if (await onRename(karte.id, name)) setIsRenaming(false);
          }}
        />
      ) : (
        <>
          {twoPress.isConfirming && (
            <ConfirmReveal>
              <p className="fluid-sm text-pretty text-foreground">{FOLGE}</p>
              {karte.diesesGeraet && <p className="fluid-sm text-pretty text-foreground">{FOLGE_DIESES_GERAET}</p>}
              {istLetzter &&
                FOLGE_LETZTER.map((satz) => (
                  <p
                    key={satz}
                    className="fluid-sm text-pretty text-foreground">
                    {satz}
                  </p>
                ))}
            </ConfirmReveal>
          )}

          <ConfirmActionRow confirm={twoPress}>
            {!twoPress.isConfirming && (
              <Button
                type="button"
                variant="secondary"
                onPress={() => setIsRenaming(true)}
                className={formButton({ intent: "cancel" })}>
                <PencilToLine
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
                Umbenennen
              </Button>
            )}
            <ConfirmPressButton
              confirm={twoPress}
              reason={reason}
              resting="Löschen"
              armed="Ja, Passkey löschen"
              running="Löscht..."
              icon={
                <TrashBin
                  aria-hidden="true"
                  className="size-4.5 shrink-0"
                />
              }
              onPress={() => twoPress.press(() => onRemove(karte.id))}
            />
          </ConfirmActionRow>
        </>
      )}
    </li>
  );
}

function PasskeyNameForm({ karte, onCancel, onSave }: { karte: PasskeyKarte; onCancel: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(karte.name ?? "");
  const [isPending, setIsPending] = useState(false);
  const { guardSubmit, useForgiveFixed, formWiring } = useDraftFieldErrors({ schemas: { umbenennen: PasskeyNamePayloadSchema } });

  useForgiveFixed({ umbenennen: { name } });

  const speichere = () => {
    if (isPending) return;
    guardSubmit({ umbenennen: { name } }, () => {
      setIsPending(true);
      void onSave(name.trim()).finally(() => setIsPending(false));
    });
  };

  return (
    <Form
      wiring={formWiring}
      onSubmit={speichere}
      className="flex flex-col gap-y-3">
      <TextField
        className="flex w-full flex-col gap-y-2"
        name="name"
        value={name}
        onChange={setName}
        maxLength={PASSKEY_NAME_MAX}
        isReadOnly={isPending}>
        <Label className="fluid-xs font-bold tracking-wider text-foreground uppercase">Name</Label>
        <Input className="w-full rounded-xl border border-control bg-surface px-4 py-3 fluid-xs text-foreground outline-none sm:fluid-sm" />
        <Description className="muted-hint">Zum Beispiel „Mein iPhone“.</Description>
        <FieldError className={FIELD_ERROR_CLASSES} />
      </TextField>

      <div className="flex flex-row flex-wrap gap-3">
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          className={formButton({ intent: "submit" })}>
          {isPending ? "Speichert..." : "Speichern"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          isDisabled={isPending}
          onPress={onCancel}
          className={formButton({ intent: "cancel" })}>
          Abbrechen
        </Button>
      </div>
    </Form>
  );
}
