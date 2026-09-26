import { createHash, generateKeyPairSync, sign } from "node:crypto";

/*
 * One P-256 authenticator every suite driving a real passkey ceremony posts as, because nothing else
 * drives one the plugin verifies: the user-verified flag is the authenticator's alone to set, and no
 * double standing in for the library would be carrying it.
 */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });

/** The page's origin, which the ceremony's client data names and the plugin checks. */
const LOCAL_ORIGIN = "http://localhost:3000";

/** A COSE_Key for ES256 over P-256, the form the plugin stores a passkey's key in. */
export const COSE_KEY = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  Buffer.from(jwk.x ?? "", "base64url"),
  Buffer.from([0x22, 0x58, 0x20]),
  Buffer.from(jwk.y ?? "", "base64url"),
]);

export const CREDENTIAL_RAW_ID = Buffer.from("fabricated-credential-id");
export const CREDENTIAL_ID = CREDENTIAL_RAW_ID.toString("base64url");

const FLAG_PRESENT = 0x01;
const FLAG_VERIFIED = 0x04;
/** Attested credential data follows the counter, which is what carries the key out of a registration. */
const FLAG_ATTESTED = 0x40;

const flags = (userVerified: boolean): number => (userVerified ? FLAG_PRESENT | FLAG_VERIFIED : FLAG_PRESENT);

/** `rpIdHash ‖ flags ‖ signCount`, the 37 bytes an assertion is signed over. */
function authenticatorData(userVerified: boolean): Buffer {
  return Buffer.concat([createHash("sha256").update("localhost").digest(), Buffer.from([flags(userVerified)]), Buffer.alloc(4)]);
}

/** The same 37 bytes with the attested credential data a registration appends: AAGUID, the id and the key. */
function registrationAuthenticatorData(userVerified: boolean, rawId: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(rawId.length);

  return Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([FLAG_ATTESTED | flags(userVerified)]),
    Buffer.alloc(4),
    // All zeroes, which is what a privacy-preserving platform reports and what the plugin stores.
    Buffer.alloc(16),
    length,
    rawId,
    COSE_KEY,
  ]);
}

/* CBOR by hand, because no encoder is installed and the shape is fixed. The two-byte length header
   is legal at any size, so the one branch a hand-rolled writer gets wrong is not written. */
function attestationObject(userVerified: boolean, rawId: Buffer): Buffer {
  const authData = registrationAuthenticatorData(userVerified, rawId);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(authData.length);

  return Buffer.concat([
    Buffer.from([0xa3]),
    Buffer.from([0x63]),
    Buffer.from("fmt"),
    Buffer.from([0x64]),
    Buffer.from("none"),
    Buffer.from([0x67]),
    Buffer.from("attStmt"),
    Buffer.from([0xa0]),
    Buffer.from([0x68]),
    Buffer.from("authData"),
    Buffer.from([0x59]),
    length,
    authData,
  ]);
}

/** One enrolment as a browser would post it, over the challenge the options call minted. */
export function registrationFor(challenge: string, userVerified: boolean, rawId: Buffer = CREDENTIAL_RAW_ID) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: challenge, origin: LOCAL_ORIGIN, crossOrigin: false }));

  return {
    id: rawId.toString("base64url"),
    rawId: rawId.toString("base64url"),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      attestationObject: attestationObject(userVerified, rawId).toString("base64url"),
      transports: ["internal"],
    },
  };
}

/** One assertion as a browser would post it, signed over the challenge the options call minted. */
export function assertionFor(challenge: string, userVerified: boolean, origin = LOCAL_ORIGIN, credentialId = CREDENTIAL_ID) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: challenge, origin: origin, crossOrigin: false }));
  const signed = Buffer.concat([authenticatorData(userVerified), createHash("sha256").update(clientData).digest()]);

  return {
    id: credentialId,
    rawId: credentialId,
    // Narrowed, because the library's own type for this body admits the one spelling and an
    // in-process caller is handed it rather than a JSON string.
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData(userVerified).toString("base64url"),
      signature: sign("sha256", signed, privateKey).toString("base64url"),
      // Left out rather than nulled: the library's own type for this body has no null in it, and an
      // authenticator returning no user handle omits the member.
      userHandle: undefined,
    },
  };
}
