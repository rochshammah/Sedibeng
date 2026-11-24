import type { Response } from "express";

type ContractSchema<T> = {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
};

export function parseBody<T>(
  schema: ContractSchema<T>,
  body: unknown,
  response: Response,
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    response.status(400).json({
      error: parsed.error.issues[0]?.message ?? "The request is not valid.",
    });
    return null;
  }
  return parsed.data;
}

export function responseDate(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}
