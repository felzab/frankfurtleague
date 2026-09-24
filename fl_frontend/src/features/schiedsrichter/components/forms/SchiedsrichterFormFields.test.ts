import { describeBoxCaps } from "@/shared/testing/boxCaps.ts";
import { renderMarkup } from "@/shared/testing/renderTest.ts";

const { SchiedsrichterFormFields } = await import("./SchiedsrichterFormFields.tsx");

const MARKUP = renderMarkup(SchiedsrichterFormFields, {
  draft: { name: "Anna Schmidt", default_payment: 20, kontakt: { telefon: null, email: "anna.schmidt@beispiel.de" }, schule: null },
  onChange: () => undefined,
});

// The create's own payload, which both the referee editor's create and the match form's inline create send.
describeBoxCaps("the referee create's boxes", MARKUP, "FLPostSchiedsrichterPayload");
