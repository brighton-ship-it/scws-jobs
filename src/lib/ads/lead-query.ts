import { missingColumnName } from './optional-column.ts';

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message?: string | null } | null };

type LeadQuery = {
  select: (columns: string) => {
    gte: (
      column: string,
      value: string
    ) => {
      limit: (count: number) => PromiseLike<QueryResult>;
    };
  };
};

/** Drop a missing column and retry so an unapplied migration does not hide gclid. */
export async function selectLeadRows(
  query: LeadQuery,
  columns: string[],
  since: string,
  limit = 2000
): Promise<QueryResult> {
  let current = [...columns];
  let result = await query.select(current.join(', ')).gte('created_at', since).limit(limit);
  for (let attempt = 0; attempt < 12 && result.error; attempt += 1) {
    const column = missingColumnName(result.error);
    if (!column || !current.includes(column)) break;
    current = current.filter((name) => name !== column);
    result = await query.select(current.join(', ')).gte('created_at', since).limit(limit);
  }
  return result;
}
