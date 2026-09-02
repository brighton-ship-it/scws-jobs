/**
 * CRM well-depth tracker rows. Never invent Oak Tree / Johnson / Chen placeholders.
 */

export type TrackerWell = {
  id: string;
  customerId: string | null;
  customerName: string;
  propertyId: string | null;
  address: string;
  city: string | null;
  county: string | null;
  wellDepth: number | null;
  staticLevel: number | null;
  pumpHp: number | null;
  pumpModel: string | null;
  notes: string | null;
};

const PLACEHOLDER_NAMES = [
  /^oak tree ranch$/i,
  /^johnson residence$/i,
  /^chen property$/i,
];

export function isPlaceholderTrackerName(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return PLACEHOLDER_NAMES.some((re) => re.test(n));
}

export function mapTrackerRow(row: {
  id?: string | null;
  property_id?: string | null;
  well_depth?: number | null;
  static_water_level?: number | null;
  pump_hp?: number | null;
  pump_model?: string | null;
  notes?: string | null;
  properties?: {
    id?: string | null;
    address?: string | null;
    city?: string | null;
    county?: string | null;
    customer_id?: string | null;
    customers?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }>;
  } | null;
}): TrackerWell | null {
  if (!row?.id) return null;
  const property = row.properties || null;
  const customerRaw = property?.customers;
  const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
  const name = customer?.name?.trim() || '';
  const address = property?.address?.trim() || '';
  if (!name && !address) return null;
  return {
    id: row.id,
    customerId: customer?.id || property?.customer_id || null,
    customerName: name || 'Customer',
    propertyId: property?.id || row.property_id || null,
    address: address || 'Address on file',
    city: property?.city || null,
    county: property?.county || null,
    wellDepth: row.well_depth ?? null,
    staticLevel: row.static_water_level ?? null,
    pumpHp: row.pump_hp ?? null,
    pumpModel: row.pump_model ?? null,
    notes: row.notes ?? null,
  };
}

export function mapTrackerRows(rows: unknown): TrackerWell[] {
  if (!Array.isArray(rows)) return [];
  const mapped: TrackerWell[] = [];
  for (const row of rows) {
    const well = mapTrackerRow(row as Parameters<typeof mapTrackerRow>[0]);
    if (well) mapped.push(well);
  }
  return mapped;
}
