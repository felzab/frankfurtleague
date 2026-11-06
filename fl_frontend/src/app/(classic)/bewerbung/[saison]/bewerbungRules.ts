import "server-only";

import { requires } from "@/core/action";
import {
  BewerbungenPostBewerbungBody,
  bewerbungenPostBewerbungBodyKontakteTrainerEmailMax,
  bewerbungenPostBewerbungBodyKontakteTrainerFirstNameMax,
  bewerbungenPostBewerbungBodyKontakteTrainerLastNameMax,
  bewerbungenPostBewerbungBodySchuleOneAddressCityMax,
  bewerbungenPostBewerbungBodySchuleOneAddressDistrictMax,
  bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberMax,
  bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMax,
  bewerbungenPostBewerbungBodySchuleOneAddressStreetMax,
  bewerbungenPostBewerbungBodySchuleOneFullNameMax,
  bewerbungenPostBewerbungBodySchuleOneTeamNameMax,
  bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax,
  bewerbungenPostBewerbungBodyTrikotExistingSetMax,
  bewerbungenPostBewerbungBodyWunschgegnerOneMax,
} from "@/core/generated/zod/inputs";

const { shape } = BewerbungenPostBewerbungBody;

/** The new school's arm of the body's `schule`, the other being `null`. */
const [newSchool] = shape.schule.options;
const { address } = newSchool.shape;
const person = shape.kontakte.shape.trainer.shape;

/**
 * What the application's write asks of its boxes, read on the server so its schema never reaches the browser: whether a
 * box may stay empty, an untouched text box posting "" and a figure, a day or a choice no value, and the longest each
 * text may be. An address is required as written: the published rule holds its length alone, and the write's own rule
 * refuses an empty one.
 */
export const BEWERBUNG_RULES = {
  required: {
    firstName: requires(person.first_name, ""),
    lastName: requires(person.last_name, ""),
    email: true,
    phone: requires(person.phone, ""),
    teamName: requires(newSchool.shape.team_name, ""),
    fullName: requires(newSchool.shape.full_name, ""),
    schulform: requires(newSchool.shape.schulform, null),
    website: requires(newSchool.shape.website_url, null),
    street: requires(address.shape.street, ""),
    house_number: requires(address.shape.house_number, ""),
    postcode: requires(address.shape.postcode, ""),
    district: requires(address.shape.district, ""),
    city: requires(address.shape.city, ""),
    stufengroesse: requires(shape.stufengroesse, null),
    trikotSatz: requires(shape.trikot.shape.existing_set, ""),
    wunschfarbe: requires(shape.trikot.shape.wunschfarbe, null),
    expectedSize: requires(shape.kader.shape.expected_size, null),
    goodSpieler: requires(shape.kader.shape.good_spieler, null),
    wunschgegner: requires(shape.wunschgegner, null),
  },
  maxLength: {
    firstName: bewerbungenPostBewerbungBodyKontakteTrainerFirstNameMax,
    lastName: bewerbungenPostBewerbungBodyKontakteTrainerLastNameMax,
    email: bewerbungenPostBewerbungBodyKontakteTrainerEmailMax,
    teamName: bewerbungenPostBewerbungBodySchuleOneTeamNameMax,
    fullName: bewerbungenPostBewerbungBodySchuleOneFullNameMax,
    website: bewerbungenPostBewerbungBodySchuleOneWebsiteUrlOneMax,
    street: bewerbungenPostBewerbungBodySchuleOneAddressStreetMax,
    house_number: bewerbungenPostBewerbungBodySchuleOneAddressHouseNumberMax,
    district: bewerbungenPostBewerbungBodySchuleOneAddressDistrictMax,
    city: bewerbungenPostBewerbungBodySchuleOneAddressCityMax,
    trikotSatz: bewerbungenPostBewerbungBodyTrikotExistingSetMax,
    wunschgegner: bewerbungenPostBewerbungBodyWunschgegnerOneMax,
  },
  postcodeLength: bewerbungenPostBewerbungBodySchuleOneAddressPostcodeMax,
} as const;

export type BewerbungRules = typeof BEWERBUNG_RULES;
