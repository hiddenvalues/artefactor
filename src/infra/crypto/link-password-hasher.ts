import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";

// S32a — the `LinkPasswordHasher` adapter: scrypt with a per-hash random salt,
// compared in constant time. Stored as `scrypt$<salt b64url>$<key b64url>`, so
// the parameters can change later behind a new prefix.

const PREFIX = "scrypt";
const KEY_BYTES = 32;
const SALT_BYTES = 16;

function derive(password: string, salt: BinaryLike): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_BYTES, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export class ScryptLinkPasswordHasher implements LinkPasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt);
    return `${PREFIX}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const [prefix, salt, key, ...rest] = hash.split("$");
    if (prefix !== PREFIX || !salt || !key || rest.length > 0) return false;
    const expected = Buffer.from(key, "base64url");
    if (expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, Buffer.from(salt, "base64url"));
    return timingSafeEqual(actual, expected);
  }
}
