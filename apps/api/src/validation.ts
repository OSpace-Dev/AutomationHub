import { invalidPayload } from "./errors.js";

export function requireObject(value: unknown, field = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPayload(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw invalidPayload(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalString(object: Record<string, unknown>, field: string, fallback = ""): string {
  const value = object[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw invalidPayload(`${field} must be a string`);
  return value.trim();
}

export function requireInteger(object: Record<string, unknown>, field: string): number {
  const value = object[field];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw invalidPayload(`${field} must be a positive integer`);
  }
  return value as number;
}

export function optionalNonNegativeInteger(object: Record<string, unknown>, field: string): number | undefined {
  const value = object[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw invalidPayload(`${field} must be a non-negative integer`);
  }
  return value as number;
}
