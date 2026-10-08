/**
 * A person's own-data reads and their account entries as the backend serves them, so a field a read
 * gains is added here once. Untyped, `shared` naming no slice's schema (`docs/frontend/spec.md` I9): a
 * typed suite parses the fixture through its mirror.
 */

/** The consent half of an account entry: confirmed on its own page, the media consent not given. */
const einwilligungsTeil = (umfang: string, textVersion: string) => ({
  inactive_since: null,
  einwilligung: {
    umfang: umfang,
    erteilt_von: "volljaehrig",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: textVersion,
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  bestaetigt_text_version: textVersion,
  nachweis_stand: { umfang: null, medien: null },
  erteilbar: true,
  medien_angeboten: true,
  mindestalter: 16,
  medien_mindestalter: 18,
});

/** A pupil's stored data as their own page reads it, in no squad yet. */
export const spielerSelbst = () => ({
  spieler_id: "6890a1b2c3d4e5f607390031",
  vorname: "Alina",
  nachname: "Fischer",
  geburtsdatum: "2008-05-02",
  kader: [],
});

/** The same pupil on the account page, the registration's team, school and season served. */
export const spielerKonto = () => ({
  ...spielerSelbst(),
  ...einwilligungsTeil("kader_oeffentlich", "2026-09-spielerseite-3"),
  kontext: { vorname: "Alina", team: "Lessing Lions", schule: "Lessing-Gymnasium", saison: "2526" },
});

/** A referee's stored data as their own page reads it, their fee stored. */
export const schiedsrichterSelbst = () => ({
  schiedsrichter_id: "6890a1b2c3d4e5f607390041",
  name: "Mara Okafor",
  schule: null,
  kontakt: { telefon: null, email: "mara@example.org" },
  honorar: 25,
  geburtsdatum: "2007-03-01",
});

/** The same referee on the account page. */
export const schiedsrichterKonto = () => ({
  ...schiedsrichterSelbst(),
  ...einwilligungsTeil("intern", "2026-09-schiedsrichterseite-3"),
  kontext: { vorname: "Mara" },
});
