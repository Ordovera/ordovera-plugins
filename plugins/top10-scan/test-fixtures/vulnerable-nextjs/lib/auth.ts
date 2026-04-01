import jwt from "jsonwebtoken";

// VULNERABILITY [A07]: Hardcoded weak secret for JWT signing.
const JWT_SECRET = "secret123";

export function createToken(userId: string): string {
  // VULNERABILITY [A07]: No expiration set on the token. HS256 with a short, guessable secret.
  return jwt.sign({ sub: userId }, JWT_SECRET, { algorithm: "HS256" });
}

export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}
