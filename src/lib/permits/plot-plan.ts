import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fetchAerialJpeg, ringBBox } from './gis.ts';
import {
  BLOCKED_CSLB,
  COUNTY_LABEL,
  EXISTING_WELL_SETBACK_FT,
  INVENTORY_RADIUS_FT,
  LEACH_SETBACK_FT,
  PROPERTY_LINE_SETBACK_FT,
  SCWS_CSLB,
  TANK_SETBACK_FT,
  type County,
  type ResearchResult,
} from './types.ts';

export const SCWS_LETTERHEAD = {
  name: 'Southern California Well Service',
  license: `C-57 CSLB #${SCWS_CSLB}`,
  phone: '(760) 440-8520',
  shop: '1077 Main Street, Unit B, Ramona, CA 92065',
};

export interface PlotPlanInput {
  result: ResearchResult;
  proposedWell?: { lat: number; lng: number } | null;
  manualSeptic?: { lat: number; lng: number } | null;
  aerialJpeg?: Uint8Array | null;
  fetchImpl?: typeof fetch;
}

export interface PlotPlanModel {
  title: string;
  county: County;
  apn: string;
  siteAddress: string;
  ownerName: string;
  lotSize: string;
  scaleLabel: string;
  notes: string[];
  wellsOnPlan: number;
  septicOnPlan: number;
  hasParcel: boolean;
  inventedLocations: false;
  cslb: string;
  disclaimer: string;
}

/** 11×17 landscape (points). */
const PAGE = { width: 1224, height: 792 };
const MAP = { x: 18, y: 40, width: 868, height: 718 };
const PANEL = { x: 896, y: 40, width: 310, height: 718 };

type Pt = { x: number; y: number };

function projectFactory(lat0: number, lng0: number) {
  const feetPerDegLat = 364000;
  const feetPerDegLng = 364000 * Math.cos((lat0 * Math.PI) / 180);
  return {
    project: (lat: number, lng: number): Pt => ({
      x: (lng - lng0) * feetPerDegLng,
      y: (lat - lat0) * feetPerDegLat,
    }),
    unproject: (p: Pt): { lat: number; lng: number } => ({
      lat: lat0 + p.y / feetPerDegLat,
      lng: lng0 + p.x / feetPerDegLng,
    }),
    feetPerDegLat,
    feetPerDegLng,
  };
}

function boundsOf(points: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return points.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      minY: Math.min(b.minY, p.y),
      maxX: Math.max(b.maxX, p.x),
      maxY: Math.max(b.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function niceScaleFeet(raw: number): number {
  const candidates = [20, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
  return candidates.find((n) => n >= raw) || Math.ceil(raw / 100) * 100;
}

export function buildPlotPlanModel(input: PlotPlanInput): PlotPlanModel {
  const { result } = input;
  const acres = result.parcel?.lotSizeAcres;
  const sqft = result.parcel?.lotSizeSqFt;
  const lotSize = acres
    ? `${acres.toFixed(2)} acres`
    : sqft
      ? `${sqft.toLocaleString()} sq ft`
      : 'Not published';
  const lineSetback = PROPERTY_LINE_SETBACK_FT[result.county];
  const notes = [
    ...result.notes,
    result.septic?.status === 'missing' ? result.septic.message || '' : '',
    result.septic?.geometry?.some((g) => g.kind === 'tank' || g.kind === 'leach')
      ? 'Tank/leach/existing well drawn from a DEH as-built traced onto county GIS — not invented.'
      : result.septic?.locationUnknown
        ? 'Septic GIS is a parcel flag only. Tank/leach are drawn only from a parsed DEH as-built.'
        : '',
    result.dehDocuments?.some((d) => d.isAsBuiltCandidate && d.geometryExtracted)
      ? 'DEH as-built FileRecordId traced onto county GIS (LARC overlay). Neighbor as-builts stay listed until their FileRecordIds are wired.'
      : result.dehDocuments?.some((d) => d.isAsBuiltCandidate)
        ? 'DEH as-built on file, geometry not extracted — no fake tank or leach was drawn.'
        : '',
    result.neighbors?.length
      ? 'Neighbor septic vs sewer is the WW_SEPTIC parcel flag. DEH FileRecordIds are listed; tank/leach are not drawn until an as-built PDF is parsed.'
      : result.septicPermits.length
        ? 'Neighbor septic markers (if any) are parcel flags, not surveyed tank locations.'
        : '',
    !result.wells.length
      ? 'No DWR/CNRA well points are drawn. If the source was down, that is stated in Sources — locations were not invented.'
      : `CNRA/DWR wells within ${INVENTORY_RADIUS_FT} ft of the proposed pin: ${result.wellsWithin250Ft ?? 0}.`,
    `Property-line setback shown: ${lineSetback} ft (${COUNTY_LABEL[result.county]}).`,
    'Office plot plan for DEH — NOT a stamped survey. Do not use as a construction staking document.',
    'Always verify current DEH setbacks before submitting.',
  ].filter(Boolean);

  return {
    title: 'Well-drilling permit SITE PLAN',
    county: result.county,
    apn: result.parcel?.apn || 'Not found',
    siteAddress: result.parcel?.siteAddress || result.formattedAddress || '—',
    ownerName: result.parcel?.ownerName || 'Unknown (not published)',
    lotSize,
    scaleLabel: 'Scale as shown (graphic bar)',
    notes,
    wellsOnPlan: result.wells.filter((w) => w.latitude && w.longitude).length,
    septicOnPlan:
      (result.septic?.geometry?.length || 0) + (input.manualSeptic ? 1 : 0),
    hasParcel: Boolean(result.parcel?.geometry?.rings?.[0]?.length),
    inventedLocations: false,
    cslb: SCWS_CSLB,
    disclaimer:
      'Office plot plan for DEH — NOT a stamped survey. Do not use as a construction staking document.',
  };
}

function resolvePin(input: PlotPlanInput): { lat: number; lng: number } | null {
  if (input.proposedWell) return input.proposedWell;
  if (input.result.proposedWell) {
    return { lat: input.result.proposedWell.lat, lng: input.result.proposedWell.lng };
  }
  return null;
}

export async function renderPlotPlanPdf(input: PlotPlanInput): Promise<Uint8Array> {
  const model = buildPlotPlanModel(input);
  for (const blocked of BLOCKED_CSLB) {
    if (SCWS_LETTERHEAD.license.includes(blocked)) {
      throw new Error('Refusing to render a plot plan with a blocked CSLB number');
    }
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE.width,
    height: PAGE.height,
    color: rgb(0.97, 0.97, 0.96),
  });

  const drawn = await drawMap(page, pdf, font, bold, input);

  drawPanel(page, font, bold, input, model, drawn.scaleFeetPerInch);
  drawFooter(page, font, bold, model);

  const page2 = pdf.addPage([PAGE.width, PAGE.height]);
  drawWellsPage(page2, font, bold, input);

  return pdf.save();
}

function drawFooter(page: PDFPage, font: PDFFont, bold: PDFFont, model: PlotPlanModel) {
  page.drawRectangle({
    x: 18,
    y: 8,
    width: PAGE.width - 36,
    height: 26,
    color: rgb(0.12, 0.14, 0.16),
  });
  page.drawText(pdfSafe(model.disclaimer), {
    x: 26,
    y: 18,
    size: 9,
    font: bold,
    color: rgb(1, 0.92, 0.35),
  });
}

function drawPanel(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  input: PlotPlanInput,
  model: PlotPlanModel,
  scaleFeetPerInch: number
) {
  const { result } = input;
  const pin = resolvePin(input) || result.proposedWell;
  page.drawRectangle({
    x: PANEL.x,
    y: PANEL.y,
    width: PANEL.width,
    height: PANEL.height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.75, 0.76, 0.74),
    borderWidth: 1,
  });

  page.drawRectangle({
    x: PANEL.x,
    y: PANEL.y + PANEL.height - 52,
    width: PANEL.width,
    height: 52,
    color: rgb(0.08, 0.2, 0.36),
  });
  page.drawText(SCWS_LETTERHEAD.name, {
    x: PANEL.x + 10,
    y: PANEL.y + PANEL.height - 20,
    size: 10,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(SCWS_LETTERHEAD.license, {
    x: PANEL.x + 10,
    y: PANEL.y + PANEL.height - 34,
    size: 8,
    font,
    color: rgb(0.85, 0.92, 1),
  });
  page.drawText(`${SCWS_LETTERHEAD.phone}  |  ${SCWS_LETTERHEAD.shop}`, {
    x: PANEL.x + 10,
    y: PANEL.y + PANEL.height - 46,
    size: 6,
    font,
    color: rgb(0.75, 0.84, 0.92),
  });

  let y = PANEL.y + PANEL.height - 68;
  const x = PANEL.x + 10;
  page.drawText('SITE / PROJECT', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 12;
  y = line(page, font, x, y, 'Project', 'TEST well-drilling permit plot plan. Office exhibit for DEH — not a construction stakeout.');
  y = line(page, font, x, y, 'County', `${COUNTY_LABEL[model.county]}${jurisNote(result)}`);
  y = line(page, font, x, y, 'Site', model.siteAddress);
  y = line(page, font, x, y, 'APN', model.apn);
  y = line(page, font, x, y, 'Area', model.lotSize);
  y = line(page, font, x, y, 'Owner', model.ownerName);
  y -= 6;

  page.drawText('PROPOSED WELL', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 12;
  if (pin) {
    y = line(page, font, x, y, 'WGS84', `${pin.lat.toFixed(8)} N, ${pin.lng.toFixed(8)} W`);
    const pw = result.proposedWell;
    if (pw) {
      y = line(
        page,
        font,
        x,
        y,
        'Placement',
        pw.meetsSetbacks
          ? 'Maximin to leach/tank/exist. well (not centroid)'
          : 'Best pocket - setbacks FLAGGED (not centroid)'
      );
      y = line(page, font, x, y, 'To PL', metLabel(pw.distances.propertyLineFt, PROPERTY_LINE_SETBACK_FT[result.county]));
      y = line(page, font, x, y, 'To tank', metLabel(pw.distances.tankFt, TANK_SETBACK_FT, 'unknown (no as-built geometry)'));
      y = line(page, font, x, y, 'To leach', metLabel(pw.distances.leachFt, LEACH_SETBACK_FT, 'unknown (no as-built geometry)'));
      y = line(page, font, x, y, 'To well', metLabel(pw.distances.existingWellFt, EXISTING_WELL_SETBACK_FT));
      for (const flag of pw.flags.slice(0, 4)) {
        y = wrap(page, font, x, y, `FLAG: ${flag}`, 46, rgb(0.65, 0.15, 0.1));
      }
    }
  } else {
    y = line(page, font, x, y, 'Pin', 'Not placed — parcel geometry missing');
  }
  y -= 6;

  page.drawText('SEPTIC / SEWER', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 12;
  y = line(page, font, x, y, 'Status', result.septic?.designation || result.septic?.message || 'Unknown');
  y = line(page, font, x, y, 'Source', result.septic?.source || '—');
  const asBuilts = (result.dehDocuments || []).filter((d) => d.isAsBuiltCandidate);
  if (asBuilts.length) {
    for (const doc of asBuilts.slice(0, 3)) {
      y = wrap(
        page,
        font,
        x,
        y,
        doc.geometryExtracted
          ? `FileRecordId ${doc.fileRecordId}  ${doc.subcategory || ''} - as-built traced onto GIS`
          : `FileRecordId ${doc.fileRecordId}  ${doc.subcategory || ''} - as-built on file, geometry not extracted`,
        48,
        rgb(0.45, 0.2, 0.05)
      );
    }
  } else {
    y = line(page, font, x, y, 'As-built', 'None listed in DEH library (or not San Diego)');
  }
  y -= 6;

  page.drawText('STRUCTURES & WELLS', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 12;
  const onParcel = (result.structures || []).filter((s) => s.onSubjectParcel);
  const dwelling = [...onParcel].sort((a, b) => (b.areaSqFt || 0) - (a.areaSqFt || 0))[0];
  y = line(
    page,
    font,
    x,
    y,
    'Footprints',
    dwelling
      ? `Largest on parcel ${dwelling.areaSqFt?.toLocaleString() || '?'} sf (SD BUILDING_OUTLINES)`
      : onParcel.length
        ? `${onParcel.length} on-parcel footprints`
        : 'None from BUILDING_OUTLINES on this parcel'
  );
  y = line(
    page,
    font,
    x,
    y,
    `CNRA WCR <=${INVENTORY_RADIUS_FT} ft`,
    result.wellsWithin250Ft === 0 ? '0 (NONE)' : String(result.wellsWithin250Ft)
  );
  y -= 6;

  page.drawText('NEIGHBORS (flag + FileRecordId)', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 12;
  const neighbors = result.neighbors || [];
  if (!neighbors.length) {
    y = line(page, font, x, y, 'Parcels', 'None returned (or not San Diego)');
  } else {
    for (const n of neighbors.slice(0, 8)) {
      const ids = (n.dehDocuments || []).map((d) => d.fileRecordId).filter(Boolean).join(', ');
      const geom =
        n.tankLeach === 'as_built_extracted'
          ? 'as-built traced'
          : n.tankLeach === 'as_built_on_file'
            ? 'as-built on file, not extracted'
            : 'no tank/leach drawn';
      y = wrap(
        page,
        font,
        x,
        y,
        `${n.apn}  ${n.system}${n.distanceFt != null ? `  ${n.distanceFt} ft` : ''}  ${ids ? `FileRecordId ${ids}` : 'no DEH hits'}  ${geom}`,
        48
      );
    }
  }
  y -= 8;

  page.drawText('LEGEND', { x, y, size: 8, font: bold, color: rgb(0.15, 0.2, 0.28) });
  y -= 14;
  legendRow(page, font, x, y, rgb(0.95, 0.82, 0.1), 'Subject parcel');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.85, 0.75, 0.15), '10 ft PL inset / 40 ft west easement');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.92, 0.48, 0.12), 'Existing structure (BUILDING_OUTLINES)');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.15, 0.4, 0.85), 'Proposed well pin');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.12, 0.55, 0.28), 'Existing well + 100 ft (as-built / CNRA)');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.55, 0.22, 0.55), 'Septic tank (DEH as-built only)');
  y -= 12;
  legendRow(page, font, x, y, rgb(0.55, 0.35, 0.15), 'Leach field (DEH as-built only)');
  y -= 18;

  page.drawText(`Engineer scale  1" = ${scaleFeetPerInch} ft`, {
    x,
    y,
    size: 8,
    font: bold,
    color: rgb(0.15, 0.2, 0.28),
  });
  y -= 12;
  page.drawText(model.scaleLabel, { x, y, size: 7, font, color: rgb(0.3, 0.3, 0.3) });
}

function metLabel(dist: number | null, minFt: number, unknown = '-'): string {
  if (dist == null) return unknown;
  return `${dist} ft  (min ${minFt} ${dist >= minFt ? 'MET' : 'FLAG'})`;
}

function jurisNote(result: ResearchResult): string {
  return result.county === 'san_diego' ? '  |  Unincorporated SD County (CN when published)' : '';
}

function legendRow(page: PDFPage, font: PDFFont, x: number, y: number, color: ReturnType<typeof rgb>, label: string) {
  page.drawRectangle({ x, y: y - 1, width: 10, height: 8, color, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.4 });
  page.drawText(label, { x: x + 16, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
}

function line(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  label: string,
  value: string
): number {
  page.drawText(pdfSafe(label.toUpperCase()), { x, y, size: 6, font, color: rgb(0.45, 0.48, 0.5) });
  const text = clip(value, 52);
  page.drawText(text, { x, y: y - 10, size: 8, font, color: rgb(0.1, 0.12, 0.14) });
  return y - 22;
}

function wrap(
  page: PDFPage,
  font: PDFFont,
  x: number,
  y: number,
  value: string,
  max: number,
  color = rgb(0.2, 0.2, 0.2)
): number {
  const words = pdfSafe(value).split(/\s+/);
  let row = '';
  let yy = y;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (next.length > max && row) {
      page.drawText(row, { x, y: yy, size: 7, font, color });
      yy -= 9;
      row = word;
    } else {
      row = next;
    }
  }
  if (row) {
    page.drawText(row, { x, y: yy, size: 7, font, color });
    yy -= 11;
  }
  return yy;
}

function pdfSafe(text: string): string {
  return String(text || '')
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/·/g, '|')
    .replace(/≈/g, '~')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function clip(text: string, max: number): string {
  const safe = pdfSafe(text);
  if (!safe) return '-';
  return safe.length > max ? `${safe.slice(0, max - 1)}...` : safe;
}

async function drawMap(
  page: PDFPage,
  pdf: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  input: PlotPlanInput
): Promise<{ scaleFeetPerInch: number }> {
  const { result } = input;
  const ring = result.parcel?.geometry?.rings?.[0];
  const pin = resolvePin(input);
  const center = pin || result.searchPoint || { lat: 33.04, lng: -116.87 };
  const { project, unproject } = projectFactory(center.lat, center.lng);

  const world: Pt[] = [];
  if (ring) {
    for (const pt of ring) world.push(project(pt[1], pt[0]));
  } else {
    world.push({ x: -80, y: -80 }, { x: 80, y: 80 });
  }

  const nearbyWells = result.wells.filter(
    (w) => w.latitude && w.longitude && (w.distance_from_parcel || 0) <= INVENTORY_RADIUS_FT + 200
  );
  for (const well of nearbyWells) world.push(project(well.latitude, well.longitude));
  for (const structure of result.structures || []) {
    for (const pt of structure.rings?.[0] || []) world.push(project(pt[1], pt[0]));
  }
  if (pin) world.push(project(pin.lat, pin.lng));
  if (input.manualSeptic) world.push(project(input.manualSeptic.lat, input.manualSeptic.lng));
  for (const geom of result.septic?.geometry || []) {
    if (geom.rings) for (const pt of geom.rings[0] || []) world.push(project(pt[1], pt[0]));
    if (geom.lat != null && geom.lng != null) world.push(project(geom.lat, geom.lng));
  }

  const b = boundsOf(world);
  const pad = 50;
  const spanX = Math.max(b.maxX - b.minX, 80) + pad * 2;
  const spanY = Math.max(b.maxY - b.minY, 80) + pad * 2;
  const scale = Math.min((MAP.width - 16) / spanX, (MAP.height - 16) / spanY);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;

  const toPage = (p: Pt): Pt => ({
    x: MAP.x + MAP.width / 2 + (p.x - midX) * scale,
    y: MAP.y + MAP.height / 2 + (p.y - midY) * scale,
  });

  const feetPerInch = niceScaleFeet(72 / scale);

  page.drawRectangle({
    x: MAP.x,
    y: MAP.y,
    width: MAP.width,
    height: MAP.height,
    color: rgb(0.86, 0.88, 0.84),
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 1.2,
  });

  const visMin: Pt = { x: midX - MAP.width / 2 / scale, y: midY - MAP.height / 2 / scale };
  const visMax: Pt = { x: midX + MAP.width / 2 / scale, y: midY + MAP.height / 2 / scale };
  const sw = unproject(visMin);
  const ne = unproject(visMax);
  const aerialBbox = {
    minX: Math.min(sw.lng, ne.lng),
    minY: Math.min(sw.lat, ne.lat),
    maxX: Math.max(sw.lng, ne.lng),
    maxY: Math.max(sw.lat, ne.lat),
  };

  let aerial = input.aerialJpeg ?? null;
  if (aerial === null && input.aerialJpeg === undefined) {
    try {
      aerial = await fetchAerialJpeg(aerialBbox, { width: 1800, height: 1400 }, input.fetchImpl ?? fetch);
    } catch {
      aerial = null;
    }
  }
  if (aerial) {
    try {
      const img = await pdf.embedJpg(aerial);
      page.drawImage(img, { x: MAP.x, y: MAP.y, width: MAP.width, height: MAP.height });
    } catch {
      // Keep the vector plan if the JPEG is unreadable.
    }
  }

  page.drawRectangle({
    x: MAP.x + 8,
    y: MAP.y + MAP.height - 28,
    width: 430,
    height: 20,
    color: rgb(1, 1, 1),
    opacity: 0.82,
  });
  page.drawText(clip(`${SCWS_LETTERHEAD.name}  |  ${SCWS_LETTERHEAD.license}`, 78), {
    x: MAP.x + 12,
    y: MAP.y + MAP.height - 22,
    size: 9,
    font: bold,
    color: rgb(0.08, 0.12, 0.18),
  });

  for (const structure of result.structures || []) {
    const sring = structure.rings?.[0];
    if (!sring || sring.length < 3) continue;
    drawFilledRing(page, sring, project, toPage, rgb(0.92, 0.48, 0.12), 0.45, rgb(0.55, 0.25, 0.05));
    const c = ringCentroidLatLng(sring);
    const p = toPage(project(c.lat, c.lng));
    const onParcel = structure.onSubjectParcel;
    const area = structure.areaSqFt ? `${Math.round(structure.areaSqFt)} sf` : '';
    const label = onParcel
      ? area && structure.areaSqFt && structure.areaSqFt >= 1500
        ? `EXISTING DWELLING ${area}`
        : `EXISTING STRUCTURE ${area}`
      : '';
    if (label && p.x > MAP.x && p.x < MAP.x + MAP.width) {
      page.drawText(clip(label, 36), { x: p.x - 28, y: p.y, size: 6, font: bold, color: rgb(0.35, 0.15, 0.02) });
    }
  }

  if (ring && ring.length >= 3) {
    const path = ring.map((pt) => toPage(project(pt[1], pt[0])));
    for (let i = 0; i < path.length; i++) {
      page.drawLine({
        start: path[i],
        end: path[(i + 1) % path.length],
        thickness: 2.4,
        color: rgb(0.98, 0.86, 0.12),
      });
    }
    const insetFt = PROPERTY_LINE_SETBACK_FT[result.county];
    const box = ringBBox(ring);
    const midLat = (box.minY + box.maxY) / 2;
    const fl = 364000 * Math.cos((midLat * Math.PI) / 180);
    const inset = [
      [box.minX + insetFt / fl, box.minY + insetFt / 364000],
      [box.maxX - insetFt / fl, box.minY + insetFt / 364000],
      [box.maxX - insetFt / fl, box.maxY - insetFt / 364000],
      [box.minX + insetFt / fl, box.maxY - insetFt / 364000],
      [box.minX + insetFt / fl, box.minY + insetFt / 364000],
    ];
    drawDashedRing(page, inset, project, toPage, rgb(0.95, 0.82, 0.2), 0.8);
  } else if (result.searchPoint) {
    const p = toPage(project(result.searchPoint.lat, result.searchPoint.lng));
    page.drawCircle({ x: p.x, y: p.y, size: 5, color: rgb(0.8, 0.2, 0.2) });
    page.drawText('Geocoded point - parcel polygon not found', {
      x: p.x + 8,
      y: p.y,
      size: 8,
      font: bold,
      color: rgb(0.6, 0.15, 0.15),
    });
  }

  for (const geom of result.septic?.geometry || []) {
    if (geom.kind === 'easement' && geom.rings?.[0]) {
      drawDashedRing(page, geom.rings[0], project, toPage, rgb(0.95, 0.82, 0.15), 1.1);
      const c = ringCentroidLatLng(geom.rings[0]);
      const p = toPage(project(c.lat, c.lng));
      page.drawText(clip(geom.label || "40' PRIVATE RD / UTIL EASEMENT (as-built)", 42), {
        x: p.x - 40,
        y: p.y,
        size: 6,
        font,
        color: rgb(0.45, 0.38, 0.05),
      });
    }
    if (geom.kind === 'leach' && geom.rings?.[0]) {
      drawFilledRing(page, geom.rings[0], project, toPage, rgb(0.55, 0.35, 0.15), 0.4, rgb(0.4, 0.22, 0.08));
      const c = ringCentroidLatLng(geom.rings[0]);
      const p = toPage(project(c.lat, c.lng));
      page.drawText(clip(geom.label || 'LEACH FIELD (DEH as-built)', 40), {
        x: p.x - 30,
        y: p.y,
        size: 6,
        font,
        color: rgb(0.35, 0.2, 0.05),
      });
    }
    if (geom.kind === 'tank') {
      const loc =
        geom.lat != null && geom.lng != null
          ? { lat: geom.lat, lng: geom.lng }
          : ringCentroidLatLng(geom.rings?.[0] || []);
      const p = toPage(project(loc.lat, loc.lng));
      page.drawRectangle({
        x: p.x - 4,
        y: p.y - 3,
        width: 8,
        height: 6,
        color: rgb(0.55, 0.22, 0.55),
      });
      page.drawText(clip(geom.label || 'SEPTIC TANK (DEH as-built)', 40), {
        x: p.x + 6,
        y: p.y,
        size: 6,
        font,
        color: rgb(0.35, 0.1, 0.35),
      });
    }
    if (geom.kind === 'existing_well' && geom.lat != null && geom.lng != null) {
      const p = toPage(project(geom.lat, geom.lng));
      page.drawCircle({
        x: p.x,
        y: p.y,
        size: Math.max(EXISTING_WELL_SETBACK_FT * scale, 8),
        borderColor: rgb(0.12, 0.55, 0.28),
        borderWidth: 0.8,
        color: undefined,
      });
      page.drawCircle({ x: p.x, y: p.y, size: 3.5, color: rgb(0.12, 0.55, 0.28) });
      page.drawText(clip(geom.label || 'EXISTING WELL (as-built)', 36), {
        x: p.x + 6,
        y: p.y + 2,
        size: 6,
        font,
        color: rgb(0.08, 0.35, 0.18),
      });
    }
  }

  if (input.manualSeptic) {
    const p = toPage(project(input.manualSeptic.lat, input.manualSeptic.lng));
    page.drawCircle({ x: p.x, y: p.y, size: 3.5, color: rgb(0.75, 0.25, 0.7) });
    page.drawText('Septic (office-placed)', { x: p.x + 5, y: p.y, size: 6, font, color: rgb(0.45, 0.1, 0.4) });
  }

  if (pin) {
    const origin = toPage(project(pin.lat, pin.lng));
    const invR = Math.max(INVENTORY_RADIUS_FT * scale, 8);
    page.drawCircle({
      x: origin.x,
      y: origin.y,
      size: invR,
      borderColor: rgb(0.15, 0.4, 0.85),
      borderWidth: 0.8,
      color: undefined,
      borderDashArray: [4, 3],
    });
    page.drawText(`${INVENTORY_RADIUS_FT} ft inventory`, {
      x: origin.x + invR * 0.55,
      y: origin.y + invR * 0.55,
      size: 6,
      font,
      color: rgb(0.1, 0.25, 0.55),
    });

    const tank = result.septic?.geometry?.find((g) => g.kind === 'tank');
    const leach = result.septic?.geometry?.find((g) => g.kind === 'leach');
    if (tank && (tank.lat != null || tank.rings)) {
      page.drawCircle({
        x: origin.x,
        y: origin.y,
        size: Math.max(50 * scale, 6),
        borderColor: rgb(0.85, 0.15, 0.12),
        borderWidth: 0.7,
        color: undefined,
        borderDashArray: [3, 2],
      });
    }
    if (leach) {
      page.drawCircle({
        x: origin.x,
        y: origin.y,
        size: Math.max(100 * scale, 8),
        borderColor: rgb(0.85, 0.15, 0.12),
        borderWidth: 0.7,
        color: undefined,
        borderDashArray: [3, 2],
      });
    }

    drawCrosshair(page, origin);
    page.drawText('PROPOSED WELL', {
      x: origin.x + 8,
      y: origin.y + 6,
      size: 7,
      font: bold,
      color: rgb(0.05, 0.2, 0.55),
    });
    page.drawText(`${pin.lat.toFixed(8)} N`, {
      x: origin.x + 8,
      y: origin.y - 4,
      size: 6,
      font,
      color: rgb(0.05, 0.15, 0.4),
    });
    page.drawText(`${pin.lng.toFixed(8)} W`, {
      x: origin.x + 8,
      y: origin.y - 12,
      size: 6,
      font,
      color: rgb(0.05, 0.15, 0.4),
    });

    const pw = result.proposedWell;
    const tankGeom = result.septic?.geometry?.find((g) => g.kind === 'tank');
    const leachGeom = result.septic?.geometry?.find((g) => g.kind === 'leach');
    const wellGeom = result.septic?.geometry?.find((g) => g.kind === 'existing_well');
    if (tankGeom && (tankGeom.lat != null || tankGeom.rings)) {
      const loc =
        tankGeom.lat != null && tankGeom.lng != null
          ? { lat: tankGeom.lat, lng: tankGeom.lng }
          : ringCentroidLatLng(tankGeom.rings?.[0] || []);
      drawCallout(page, font, origin, toPage(project(loc.lat, loc.lng)), metLabel(pw?.distances.tankFt ?? null, TANK_SETBACK_FT));
    }
    if (leachGeom?.rings?.[0]) {
      const loc = ringCentroidLatLng(leachGeom.rings[0]);
      drawCallout(page, font, origin, toPage(project(loc.lat, loc.lng)), metLabel(pw?.distances.leachFt ?? null, LEACH_SETBACK_FT));
    }
    if (wellGeom && wellGeom.lat != null && wellGeom.lng != null) {
      drawCallout(
        page,
        font,
        origin,
        toPage(project(wellGeom.lat, wellGeom.lng)),
        metLabel(pw?.distances.existingWellFt ?? null, EXISTING_WELL_SETBACK_FT)
      );
    }

    if (ring) {
      const box = ringBBox(ring);
      const feetLat = 364000;
      const feetLng = 364000 * Math.cos((pin.lat * Math.PI) / 180);
      const dN = Math.round((box.maxY - pin.lat) * feetLat);
      const dE = Math.round((box.maxX - pin.lng) * feetLng);
      const dS = Math.round((pin.lat - box.minY) * feetLat);
      const dW = Math.round((pin.lng - box.minX) * feetLng);
      page.drawText(`${dN} ft to N line`, {
        x: origin.x + 8,
        y: origin.y - 22,
        size: 6,
        font,
        color: rgb(1, 1, 1),
      });
      page.drawText(`${dS} ft to S PL / ${dE} ft to E PL / ${dW} ft to W line`, {
        x: origin.x + 8,
        y: origin.y - 30,
        size: 6,
        font,
        color: rgb(1, 1, 1),
      });
    }
  }

  for (const well of nearbyWells) {
    const p = toPage(project(well.latitude, well.longitude));
    const dist = well.distance_from_parcel != null ? ` ${well.distance_from_parcel} ft` : '';
    page.drawCircle({ x: p.x, y: p.y, size: 3.2, color: rgb(0.12, 0.55, 0.28) });
    page.drawText(clip(`${well.wcr_number}${dist}`, 24), {
      x: p.x + 5,
      y: p.y + 3,
      size: 6,
      font,
      color: rgb(0.05, 0.3, 0.15),
    });
  }

  for (const road of result.roads || []) {
    const p = toPage(project(road.lat, road.lng));
    if (p.x < MAP.x || p.x > MAP.x + MAP.width || p.y < MAP.y || p.y > MAP.y + MAP.height) continue;
    page.drawText(clip(road.name, 22), { x: p.x, y: p.y, size: 7, font: bold, color: rgb(1, 1, 0.85) });
  }

  drawScaleBar(page, font, MAP.x + 16, MAP.y + 18, feetPerInch);
  drawNorth(page, bold, MAP.x + MAP.width - 28, MAP.y + MAP.height - 70);

  return { scaleFeetPerInch: feetPerInch };
}

function ringCentroidLatLng(ring: number[][]): { lat: number; lng: number } {
  if (!ring.length) return { lat: 0, lng: 0 };
  let x = 0;
  let y = 0;
  for (const pt of ring) {
    x += pt[0];
    y += pt[1];
  }
  return { lng: x / ring.length, lat: y / ring.length };
}

function drawDashedRing(
  page: PDFPage,
  ring: number[][],
  project: (lat: number, lng: number) => Pt,
  toPage: (p: Pt) => Pt,
  color: ReturnType<typeof rgb>,
  thickness: number
) {
  const path = ring.map((pt) => toPage(project(pt[1], pt[0])));
  for (let i = 0; i < path.length; i++) {
    page.drawLine({
      start: path[i],
      end: path[(i + 1) % path.length],
      thickness,
      color,
      dashArray: [4, 3],
    });
  }
}

function drawCallout(page: PDFPage, font: PDFFont, from: Pt, to: Pt, label: string) {
  page.drawLine({
    start: from,
    end: to,
    thickness: 0.6,
    color: rgb(1, 1, 1),
    dashArray: [2, 2],
  });
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  page.drawText(clip(label, 28), { x: mx + 2, y: my + 2, size: 6, font, color: rgb(1, 1, 1) });
}

function drawFilledRing(
  page: PDFPage,
  ring: number[][],
  project: (lat: number, lng: number) => Pt,
  toPage: (p: Pt) => Pt,
  fill: ReturnType<typeof rgb>,
  opacity: number,
  stroke: ReturnType<typeof rgb>
) {
  const path = ring.map((pt) => toPage(project(pt[1], pt[0])));
  if (path.length < 3) return;
  const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
  page.drawSvgPath(d, { color: fill, borderColor: stroke, borderWidth: 0.7, opacity });
}

function drawCrosshair(page: PDFPage, p: Pt) {
  page.drawCircle({
    x: p.x,
    y: p.y,
    size: 5,
    borderColor: rgb(0.1, 0.35, 0.9),
    borderWidth: 1.4,
    color: rgb(0.7, 0.85, 1),
  });
  page.drawLine({
    start: { x: p.x - 8, y: p.y },
    end: { x: p.x + 8, y: p.y },
    thickness: 1.2,
    color: rgb(0.1, 0.35, 0.9),
  });
  page.drawLine({
    start: { x: p.x, y: p.y - 8 },
    end: { x: p.x, y: p.y + 8 },
    thickness: 1.2,
    color: rgb(0.1, 0.35, 0.9),
  });
}

function drawScaleBar(page: PDFPage, font: PDFFont, x: number, y: number, feetPerInch: number) {
  const barInches = 1.4;
  const barPx = barInches * 72;
  const feet = Math.round(feetPerInch * barInches);
  page.drawRectangle({
    x: x - 6,
    y: y - 16,
    width: barPx + 40,
    height: 28,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });
  page.drawLine({ start: { x, y }, end: { x: x + barPx, y }, thickness: 2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y - 4 }, end: { x, y: y + 4 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({
    start: { x: x + barPx, y: y - 4 },
    end: { x: x + barPx, y: y + 4 },
    thickness: 1.2,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('0', { x: x - 2, y: y - 12, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`${feet} ft`, { x: x + barPx - 16, y: y - 12, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
}

function drawNorth(page: PDFPage, bold: PDFFont, x: number, y: number) {
  page.drawRectangle({
    x: x - 14,
    y: y - 8,
    width: 28,
    height: 52,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });
  page.drawLine({ start: { x, y }, end: { x, y: y + 28 }, thickness: 1.4, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y + 28 }, end: { x: x - 5, y: y + 18 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y + 28 }, end: { x: x + 5, y: y + 18 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('N', { x: x - 4, y: y + 32, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
}

function drawWellsPage(page: PDFPage, font: PDFFont, bold: PDFFont, input: PlotPlanInput) {
  const { result } = input;
  page.drawText('Nearby wells (CA DWR / CNRA), DEH documents, and sources', {
    x: 28,
    y: 760,
    size: 13,
    font: bold,
    color: rgb(0.1, 0.15, 0.15),
  });
  page.drawText(
    'Only wells returned by DWR/CNRA are listed. Empty table means none found or the service was down - not a fake zero. Tank/leach geometry is never invented.',
    { x: 28, y: 744, size: 8, font, color: rgb(0.3, 0.3, 0.3) }
  );

  const headers = ['WCR', 'Depth ft', 'Static ft', 'Use', 'Dist ft'];
  const cols = [28, 200, 280, 360, 620];
  headers.forEach((h, i) => {
    page.drawText(h, { x: cols[i], y: 720, size: 8, font: bold, color: rgb(0.2, 0.2, 0.2) });
  });

  if (!result.wells.length) {
    page.drawText('No DWR/CNRA wells to list.', { x: 28, y: 700, size: 9, font, color: rgb(0.4, 0.2, 0.2) });
  } else {
    result.wells.slice(0, 16).forEach((well, i) => {
      const y = 702 - i * 14;
      const row = [
        well.wcr_number || '-',
        well.total_completed_depth != null ? String(well.total_completed_depth) : '-',
        well.static_water_level != null ? String(well.static_water_level) : '-',
        clip(well.well_use || '-', 36),
        well.distance_from_parcel != null ? String(well.distance_from_parcel) : '-',
      ];
      row.forEach((cell, c) => {
        page.drawText(pdfSafe(cell), { x: cols[c], y, size: 8, font, color: rgb(0.15, 0.15, 0.15) });
      });
    });
  }

  let y = 450;
  page.drawText('DEH Document Library (sanctioned SearchDocuments API)', {
    x: 28,
    y,
    size: 11,
    font: bold,
    color: rgb(0.1, 0.15, 0.15),
  });
  y -= 16;
  const docs = result.dehDocuments || [];
  if (!docs.length) {
    page.drawText('No DEH-LWQD documents listed for this APN (or county is not San Diego).', {
      x: 28,
      y,
      size: 8,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 14;
  } else {
    for (const doc of docs.slice(0, 8)) {
      page.drawText(
        clip(
          `FileRecordId ${doc.fileRecordId}  ${doc.subcategory || doc.category || ''}  ${doc.permitId || ''}  ${doc.note}`,
          140
        ),
        { x: 28, y, size: 8, font, color: rgb(0.2, 0.2, 0.2) }
      );
      y -= 12;
    }
  }

  y -= 8;
  page.drawText('Sources', { x: 28, y, size: 11, font: bold, color: rgb(0.1, 0.15, 0.15) });
  y -= 16;
  for (const source of result.sources) {
    page.drawText(clip(`${source.status.toUpperCase()}  ${source.name} - ${source.message || ''}`, 140), {
      x: 28,
      y,
      size: 8,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 12;
    if (y < 80) break;
  }

  y -= 8;
  page.drawText('Notes', { x: 28, y, size: 11, font: bold, color: rgb(0.1, 0.15, 0.15) });
  y -= 14;
  for (const note of buildPlotPlanModel(input).notes.slice(0, 8)) {
    page.drawText(clip(note, 150), { x: 28, y, size: 8, font, color: rgb(0.25, 0.25, 0.25) });
    y -= 12;
  }

  page.drawText(pdfSafe(`Generated ${new Date().toLocaleString('en-US')}  |  ${SCWS_LETTERHEAD.license}`), {
    x: 28,
    y: 28,
    size: 8,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
}

