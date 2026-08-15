import { createHash, randomBytes, randomUUID } from "node:crypto";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createRegistrationCode(): string {
  return `AH-${randomBytes(18).toString("base64url")}`;
}

export function createId(): string {
  return randomUUID();
}

export function hashContent(value: string): string {
  return hashSecret(value);
}
