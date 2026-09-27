/**
 * Every administrator action the server holds to the step-up window, by export against its slice
 * (`docs/frontend/spec.md :: I432`). `fl_frontend/src/shared/utils/adminStepUp.test.ts` holds this list
 * to what the actions themselves refuse, both ways.
 */
export const STEP_UP_WRITES: Readonly<Record<string, string>> = {
  ablehnenBewerbungAction: "bewerbungen",
  annehmenBewerbungAction: "bewerbungen",
  einwilligungErneutSendenAction: "bewerbungen",
  kontaktEmailKorrigierenAction: "bewerbungen",
  besetzeKontaktSitzAction: "bewerbungen",
  patchSaisonTeamKontakteAction: "kontakte",
  eraseKontaktpersonAction: "kontakte",
  postEinladungVersandAction: "einladungen",
  postEinladungAction: "einladungen",
  mailEinladungAction: "einladungen",
  deleteEinladungAction: "einladungen",
  postSaisonAction: "saisons",
  activateSaisonAction: "saisons",
  generateSpielplanAction: "saisons",
  undrawSpielplanAction: "saisons",
  postSaisonTeamAction: "teams",
  replaceSaisonTeamAction: "teams",
  postSchiedsrichterAction: "schiedsrichter",
  patchSchiedsrichterAction: "schiedsrichter",
  einladeSchiedsrichterAction: "schiedsrichter",
  reactivateSchiedsrichterAction: "schiedsrichter",
  anonymiseSchiedsrichterAction: "schiedsrichter",
  deleteSperreAction: "sperrliste",
  postBerechtigungAction: "berechtigungen",
  deleteBerechtigungAction: "berechtigungen",
  eraseSpielerAction: "spieler",
};

/**
 * Refused from a stale session on some calls alone: clearing a club's contacts, a mint over a standing
 * link, a replacing draw, a referee's save or return minting a link.
 */
export const CONDITIONALLY_STEPPED_UP: ReadonlySet<string> = new Set([
  "patchSaisonTeamKontakteAction",
  "postEinladungAction",
  "generateSpielplanAction",
  "patchSchiedsrichterAction",
  "reactivateSchiedsrichterAction",
]);

/**
 * How a caller's press asks: on its armed press, on its only one, through the create form it declares
 * the step-up to, or `never`, for a conditional action sent only on calls the server lets through.
 */
export type StepUpPress = "two-press" | "one-press" | "create" | "never";

// Driven by kind: two-press by `fl_frontend/src/shared/components/ui/confirmPanels.test.ts`, the rest
// by `fl_frontend/src/features/admin/stepUpCallers.test.ts`.
/**
 * Every module sending a step-up write, and how each press asks, held to every module importing one
 * by the syntax sweep in `fl_frontend/src/features/admin/stepUpCallers.test.ts`.
 */
export const STEP_UP_CALLERS: Readonly<Record<string, Readonly<Record<string, StepUpPress>>>> = {
  "features/bewerbungen/components/forms/AdminBewerbungAblehnenSection.tsx": { ablehnenBewerbungAction: "two-press" },
  "features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx": { annehmenBewerbungAction: "two-press" },
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx": {
    einwilligungErneutSendenAction: "one-press",
    kontaktEmailKorrigierenAction: "one-press",
    besetzeKontaktSitzAction: "one-press",
  },
  "features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx": { patchSaisonTeamKontakteAction: "never" },
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteLoeschenSection.tsx": { patchSaisonTeamKontakteAction: "two-press" },
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx": { eraseKontaktpersonAction: "two-press" },
  "features/saisons/components/forms/AdminCreateSaisonForm.tsx": { postSaisonAction: "create" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormEinladungVersandSection.tsx": { postEinladungVersandAction: "two-press" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormRolloverSection.tsx": { activateSaisonAction: "two-press" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx": {
    generateSpielplanAction: "two-press",
    undrawSpielplanAction: "two-press",
  },
  "features/saisons/components/forms/AdminSaisonEditForm/FormTeamErsatzSection.tsx": { replaceSaisonTeamAction: "two-press" },
  "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx": { reactivateSchiedsrichterAction: "one-press" },
  "features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm.tsx": { postSchiedsrichterAction: "create" },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx": {
    patchSchiedsrichterAction: "one-press",
  },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx": {
    anonymiseSchiedsrichterAction: "two-press",
  },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormBestaetigungSection.tsx": {
    einladeSchiedsrichterAction: "one-press",
  },
  "features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx": { reactivateSchiedsrichterAction: "one-press" },
  "features/sperrliste/components/forms/AdminSperreAufhebenPanel.tsx": { deleteSperreAction: "two-press" },
  "features/berechtigungen/components/forms/AdminCreateBerechtigungForm.tsx": { postBerechtigungAction: "create" },
  "features/berechtigungen/components/forms/AdminBerechtigungEntziehenPanel.tsx": { deleteBerechtigungAction: "two-press" },
  "features/spieler/components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx": { eraseSpielerAction: "two-press" },
  "features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx": {
    postEinladungAction: "two-press",
    deleteEinladungAction: "two-press",
    mailEinladungAction: "one-press",
  },
  "features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx": { postSaisonTeamAction: "one-press" },
};
