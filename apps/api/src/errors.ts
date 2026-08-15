export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
  }
}

export function invalidPayload(message: string): ApiError {
  return new ApiError(400, "invalid_payload", message);
}
