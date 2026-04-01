import crypto from "node:crypto";

// VULNERABILITY [A02]: MD5 is cryptographically broken - should use bcrypt, scrypt, or argon2.
export function hashPassword(password) {
  return crypto.createHash("md5").update(password).digest("hex");
}

export function checkPassword(password, hash) {
  return hashPassword(password) === hash;
}
