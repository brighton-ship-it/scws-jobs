/** PostgREST PGRST204 names the column the schema cache does not have yet. */

export function missingColumnName(
  error: { code?: string | null; message?: string | null } | null | undefined
): string | null {
  if (!error?.message) return null;
  const match = error.message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] ?? null;
}

export function withoutColumn<T extends Record<string, unknown>>(row: T, column: string): T {
  if (!(column in row)) return row;
  const next = { ...row };
  delete next[column];
  return next;
}
