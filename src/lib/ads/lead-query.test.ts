import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectLeadRows } from './lead-query.ts';

describe('selectLeadRows', () => {
  it('retries without a column the schema cache does not have', async () => {
    const seen: string[] = [];
    const query = {
      select(columns: string) {
        seen.push(columns);
        return {
          gte() {
            return {
              limit() {
                if (columns.includes('lead_source')) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message: "Could not find the 'lead_source' column of 'booking_requests' in the schema cache",
                    },
                  });
                }
                return Promise.resolve({ data: [{ id: '1', gclid: 'abc' }], error: null });
              },
            };
          },
        };
      },
    };
    const result = await selectLeadRows(query, ['id', 'gclid', 'lead_source'], '2026-01-01');
    assert.equal(result.data?.[0].gclid, 'abc');
    assert.equal(seen.some((columns) => !columns.includes('lead_source')), true);
  });
});