import { writeRealmQuery, type QboWriteDeps } from './durable-write.ts';

export type ItemTaxCategoryCheck =
  | { ok: true; taxClassificationId: string; taxClassificationName: string | null; applicableTo: string[]; itemType: string; liveSyncToken: string }
  | { ok: false; error: string };

function rows(json: any, key: string): any[] {
  const list = json?.QueryResponse?.[key];
  return Array.isArray(list) ? list : [];
}

function quoted(value: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(value)) throw new Error(`Unexpected characters in ${value}`);
  return `'${value}'`;
}

/**
 * Check a tax category change before it is previewed or posted: the class must be on QuickBooks'
 * TaxClassification list, the item's Type must be one the class applies to (a Service item cannot take
 * a goods class such as EUC-09020802), and the passed SyncToken must be the live one.
 */
export async function checkItemTaxCategory(args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<ItemTaxCategoryCheck> {
  const itemId = typeof args.itemId === 'string' ? args.itemId.trim() : '';
  const classId = typeof args.taxClassificationId === 'string' ? args.taxClassificationId.trim() : '';
  const syncToken = typeof args.syncToken === 'string' ? args.syncToken.trim() : '';
  if (!/^\d+$/.test(itemId)) return { ok: false, error: 'itemId must be a QuickBooks item id.' };
  if (!/^EUC-\d{8}-V1-\d{8}$/.test(classId)) return { ok: false, error: 'taxClassificationId must look like EUC-99990202-V1-00020000.' };
  if (!syncToken) return { ok: false, error: 'syncToken is required: the item SyncToken you read.' };
  const query = deps.qboQuery || ((sql: string) => writeRealmQuery(sql, deps));
  const classes = rows(await query(`select * from TaxClassification where Id = ${quoted(classId)}`), 'TaxClassification');
  const cls = classes.find((row) => row?.Id === classId);
  if (!cls) return { ok: false, error: `${classId} is not on the QuickBooks TaxClassification list.` };
  const applicableTo: string[] = Array.isArray(cls.ApplicableTo) ? cls.ApplicableTo.filter((t: unknown) => typeof t === 'string') : [];
  if (!applicableTo.length) return { ok: false, error: `${classId} lists no item types it applies to.` };
  const items = rows(await query(`select * from Item where Id = ${quoted(itemId)}`), 'Item');
  const item = items.find((row) => String(row?.Id) === itemId);
  if (!item) return { ok: false, error: `Item ${itemId} was not found in QuickBooks.` };
  const itemType = typeof item.Type === 'string' ? item.Type : '';
  if (!applicableTo.includes(itemType)) {
    return { ok: false, error: `Item ${itemId} is type ${itemType || 'unknown'}; ${classId} (${cls.Name ?? 'unnamed'}) applies only to ${applicableTo.join(', ')}.` };
  }
  const liveSyncToken = typeof item.SyncToken === 'string' ? item.SyncToken : '';
  if (liveSyncToken !== syncToken) {
    return { ok: false, error: `Item ${itemId} has SyncToken ${liveSyncToken || 'none'} in QuickBooks, not ${syncToken}. Re-read it before changing it.` };
  }
  return { ok: true, taxClassificationId: classId, taxClassificationName: typeof cls.Name === 'string' ? cls.Name : null, applicableTo, itemType, liveSyncToken };
}
