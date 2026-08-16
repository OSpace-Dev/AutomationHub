import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiError } from "./errors.js";

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

const MODEL_KEY_VERSION = "v1";

export class ApiKeyVault {
  private readonly key: Buffer | undefined;

  constructor(keyMaterial?: string) {
    this.key = keyMaterial?.trim() ? createHash("sha256").update(keyMaterial.trim()).digest() : undefined;
  }

  get configured(): boolean {
    return Boolean(this.key);
  }

  encrypt(value: string): string {
    if (!this.key) throw new ApiError(503, "model_encryption_not_configured", "Model encryption key is not configured");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [MODEL_KEY_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
  }

  decrypt(value: string): string {
    if (!this.key) throw new ApiError(503, "model_encryption_not_configured", "Model encryption key is not configured");
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(":");
    if (version !== MODEL_KEY_VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
      throw new ApiError(500, "model_api_key_unavailable", "Stored model API key is not readable");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivEncoded, "base64url"));
      decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new ApiError(500, "model_api_key_unavailable", "Stored model API key is not readable");
    }
  }
}
