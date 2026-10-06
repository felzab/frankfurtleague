/**
 * A person's own-data reads as the backend serves them, one confirmed record each, for every suite
 * rendering one: a field the read gains is added here once. Untyped, since `shared` may not import a
 * slice's schema (`docs/frontend/spec.md` I9): a typed suite parses the fixture through its mirror,
 * which refuses the drift.
 */

/** What a record confirmed on its own page holds of the person's choices, the media consent not given. */
const einwilligung = (umfang: string, textVersion: string) => ({
  umfang: umfang,
  erteilt_von: "volljaehrig",
  datum: "2026-09-01",
  bestaetigt_am: "2026-09-01",
  text_version: textVersion,
  medien: false,
  nachweis: { umfang: null, medien: null },
});

/** A pupil confirmed on the pupil's page, the registration's team, school and season served, in no squad yet. */
export const spielerSelbst = () => ({
  spieler_id: "6890a1b2c3d4e5f607390031",
  vorname: "Alina",
  nachname: "Fischer",
  geburtsdatum: "2008-05-02",
  inactive_since: null,
  einwilligung: einwilligung("kader_oeffentlich", "2026-09-spielerseite-3"),
  bestaetigt_text_version: "2026-09-spielerseite-3",
  nachweis_stand: { umfang: null, medien: null },
  kontext: { vorname: "Alina", team: "Lessing Lions", schule: "Lessing-Gymnasium", saison: "2526" },
  erteilbar: true,
  medien_angeboten: true,
  mindestalter: 16,
  kader: [],
});

/** A referee confirmed on the referee's page, their fee stored. */
export const schiedsrichterSelbst = () => ({
  schiedsrichter_id: "6890a1b2c3d4e5f607390041",
  name: "Mara Okafor",
  schule: null,
  kontakt: { telefon: null, email: "mara@example.org" },
  honorar: 25,
  geburtsdatum: "2007-03-01",
  inactive_since: null,
  einwilligung: einwilligung("intern", "2026-09-schiedsrichterseite-3"),
  bestaetigt_text_version: "2026-09-schiedsrichterseite-3",
  nachweis_stand: { umfang: null, medien: null },
  kontext: { vorname: "Mara" },
  erteilbar: true,
  medien_angeboten: true,
  mindestalter: 16,
});
