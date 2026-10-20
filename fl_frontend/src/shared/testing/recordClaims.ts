/**
 * The person actions claiming the person's record rather than a seat, by `<slice> :: <export>`, with the
 * operation each sends: one table for both registers, since a record route one list misses is driven
 * through the seat's spine unnoticed.
 */
export const RECORD_CLAIMS: ReadonlyMap<string, string> = new Map([
  ["kontakte :: patchBewerbungEinwilligungAction", "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung"],
  ["kontakte :: patchSitzEinwilligungAction", "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung"],
  ["konto :: loescheKontoAction", "POST /identitaet/selbst/erasure"],
  ["registrierungen :: patchRegistrierungEinwilligungAction", "PATCH /registrierungen/selbst/{registrierung_id}/einwilligung"],
  ["schiedsrichter :: patchSchiedsrichterEinwilligungAction", "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung"],
  ["spielberichte :: putSpielberichtAction", "PUT /spielberichte/{spiel_id}/bericht"],
  ["spieler :: patchSpielerEinwilligungAction", "PATCH /spieler/selbst/einwilligung"],
]);
