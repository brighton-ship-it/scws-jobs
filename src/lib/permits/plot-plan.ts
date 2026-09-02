import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  COUNTY_LABEL,
  PROPERTY_LINE_SETBACK_FT,
  SEPTIC_SETBACK_FT,
  type County,
  type ResearchResult,
} from './types.ts';

export const SCWS_LETTERHEAD = {
  name: 'Southern California Well Service',
  license: 'C-57 #1011552',
  phone: '(760) 440-8520',
  shop: '1077 Main Street, Unit B, Ramona, CA 92065',
};

export interface PlotPlanInput {
  result: ResearchResult;
  proposedWell?: { lat: number; lng: number } | null;
  manualSeptic?: { lat: number; lng: number } | null;
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
}

const PAGE = { width: 792, height: 612 };
const MAP = { x: 28, y: 150, width: 736, height: 380 };

type Pt = { x: number; y: number };

function projectFactory(lat0: number, lng0: number) {
  const feetPerDegLat = 364000;
  const feetPerDegLng = 364000 * Math.cos((lat0 * Math.PI) / 180);
  return (lat: number, lng: number): Pt => ({
    x: (lng - lng0) * feetPerDegLng,
    y: (lat - lat0) * feetPerDegLat,
  });
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
  const notes = [
    ...result.notes,
    result.septic?.status === 'missing' ? result.septic.message || '' : '',
    result.septicPermits.length
      ? 'Orange septic markers are parcel centroids from county/SCWS data, not surveyed tank or leach-field locations.'
      : '',
    !result.wells.length
      ? 'No DWR well points are drawn. If DWR was down, that is stated in Sources — locations were not invented.'
      : '',
    `Property-line setback shown: ${PROPERTY_LINE_SETBACK_FT[result.county]} ft (${COUNTY_LABEL[result.county]}). Septic setback ${SEPTIC_SETBACK_FT} ft only where a location is known.`,
    'Always verify current DEH setbacks before submitting.',
  ].filter(Boolean);

  return {
    title: 'Well Permit Plot Plan',
    county: result.county,
    apn: result.parcel?.apn || 'Not found',
    siteAddress: result.parcel?.siteAddress || result.formattedAddress || '—',
    ownerName: result.parcel?.ownerName || 'Not published on GIS',
    lotSize,
    scaleLabel: 'See graphic scale',
    notes,
    wellsOnPlan: result.wells.filter((w) => w.latitude && w.longitude).length,
    septicOnPlan: result.septicPermits.length + (input.manualSeptic ? 1 : 0),
    hasParcel: Boolean(result.parcel?.geometry?.rings?.[0]?.length),
    inventedLocations: false,
  };
}

export async function renderPlotPlanPdf(input: PlotPlanInput): Promise<Uint8Array> {
  const model = buildPlotPlanModel(input);
  const { result } = input;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 0,
    y: PAGE.height - 36,
    width: PAGE.width,
    height: 36,
    color: rgb(0.06, 0.45, 0.35),
  });
  page.drawText(SCWS_LETTERHEAD.name, {
    x: 28,
    y: PAGE.height - 16,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(`${SCWS_LETTERHEAD.license}  |  ${SCWS_LETTERHEAD.phone}  |  ${SCWS_LETTERHEAD.shop}`, {
    x: 28,
    y: PAGE.height - 30,
    size: 8,
    font,
    color: rgb(0.9, 0.97, 0.94),
  });
  page.drawText('PLOT PLAN', {
    x: PAGE.width - 110,
    y: PAGE.height - 22,
    size: 14,
    font: bold,
    color: rgb(1, 1, 1),
  });

  page.drawText(model.title, { x: 28, y: PAGE.height - 52, size: 12, font: bold, color: rgb(0.12, 0.16, 0.2) });
  page.drawText(`${COUNTY_LABEL[model.county]}  |  For DEH well-permit attachment`, {
    x: 28,
    y: PAGE.height - 66,
    size: 9,
    font,
    color: rgb(0.3, 0.35, 0.4),
  });

  const infoY = PAGE.height - 86;
  drawInfo(page, font, bold, 28, infoY, 'APN', model.apn);
  drawInfo(page, font, bold, 200, infoY, 'Owner', clip(model.ownerName, 42));
  drawInfo(page, font, bold, 430, infoY, 'Lot', model.lotSize);
  drawInfo(page, font, bold, 560, infoY, 'Site', clip(model.siteAddress, 42));

  page.drawRectangle({
    x: MAP.x,
    y: MAP.y,
    width: MAP.width,
    height: MAP.height,
    color: rgb(0.96, 0.97, 0.95),
    borderColor: rgb(0.75, 0.8, 0.78),
    borderWidth: 1,
  });

  const drawn = drawMap(page, font, bold, input);

  page.drawText(`Graphic scale: 1 inch = ${drawn.scaleFeetPerInch} ft    North is up`, {
    x: 28,
    y: 136,
    size: 8,
    font,
    color: rgb(0.25, 0.3, 0.32),
  });

  drawLegend(page, font, 28, 118);
  drawScaleBar(page, font, 520, 118, drawn.scaleFeetPerInch);
  drawNorth(page, bold, 740, 200);

  const note = model.notes[0] || 'Sources listed on page 2.';
  page.drawText(clip(note, 140), { x: 28, y: 72, size: 8, font, color: rgb(0.35, 0.25, 0.1) });
  page.drawText(
    `Wells in DWR pull: ${result.wells.length}   Nearby septic parcels: ${result.septicPermits.length}   Parcel boundary: ${model.hasParcel ? 'yes' : 'NOT FOUND'}`,
    { x: 28, y: 56, size: 8, font, color: rgb(0.2, 0.25, 0.28) }
  );
  page.drawText(
    pdfSafe(`Generated ${new Date().toLocaleString('en-US')}  |  Do not treat missing septic/well points as field-verified. Locations were not invented.`),
    { x: 28, y: 28, size: 7, font, color: rgb(0.45, 0.45, 0.45) }
  );

  const page2 = pdf.addPage([PAGE.width, PAGE.height]);
  drawWellsPage(page2, font, bold, input);

  return pdf.save();
}

function drawInfo(page: PDFPage, font: PDFFont, bold: PDFFont, x: number, y: number, label: string, value: string) {
  page.drawText(label.toUpperCase(), { x, y, size: 7, font: bold, color: rgb(0.4, 0.45, 0.48) });
  page.drawText(pdfSafe(value || '-'), { x, y: y - 12, size: 9, font, color: rgb(0.1, 0.12, 0.14) });
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

function drawMap(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  input: PlotPlanInput
): { scaleFeetPerInch: number } {
  const { result } = input;
  const ring = result.parcel?.geometry?.rings?.[0];
  const center = result.searchPoint || { lat: 33.04, lng: -116.87 };
  const project = projectFactory(center.lat, center.lng);

  const world: Pt[] = [];
  if (ring) {
    for (const pt of ring) world.push(project(pt[1], pt[0]));
  } else {
    world.push({ x: -80, y: -80 }, { x: 80, y: 80 });
  }

  const nearbyWells = result.wells.filter((w) => (w.distance_from_parcel || 0) <= 400);
  for (const well of nearbyWells) world.push(project(well.latitude, well.longitude));
  for (const septic of result.septicPermits) world.push(project(septic.latitude, septic.longitude));
  if (input.proposedWell) world.push(project(input.proposedWell.lat, input.proposedWell.lng));
  if (input.manualSeptic) world.push(project(input.manualSeptic.lat, input.manualSeptic.lng));

  const b = boundsOf(world);
  const pad = 40;
  const spanX = Math.max(b.maxX - b.minX, 80) + pad * 2;
  const spanY = Math.max(b.maxY - b.minY, 80) + pad * 2;
  const scale = Math.min((MAP.width - 24) / spanX, (MAP.height - 24) / spanY);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;

  const toPage = (p: Pt): Pt => ({
    x: MAP.x + MAP.width / 2 + (p.x - midX) * scale,
    y: MAP.y + MAP.height / 2 + (p.y - midY) * scale,
  });

  const feetPerInch = niceScaleFeet(72 / scale);

  if (ring && ring.length >= 3) {
    const path = ring.map((pt) => toPage(project(pt[1], pt[0])));
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const c = path[(i + 1) % path.length];
      page.drawLine({
        start: a,
        end: c,
        thickness: 1.6,
        color: rgb(0.06, 0.55, 0.4),
      });
    }
  } else if (result.searchPoint) {
    const p = toPage(project(result.searchPoint.lat, result.searchPoint.lng));
    page.drawCircle({ x: p.x, y: p.y, size: 5, color: rgb(0.8, 0.2, 0.2) });
    page.drawText('Geocoded point — parcel polygon not found', {
      x: p.x + 8,
      y: p.y,
      size: 8,
      font: bold,
      color: rgb(0.6, 0.15, 0.15),
    });
  }

  for (const well of nearbyWells) {
    const p = toPage(project(well.latitude, well.longitude));
    page.drawCircle({ x: p.x, y: p.y, size: 3.2, color: rgb(0.15, 0.35, 0.85) });
    page.drawText(clip(well.wcr_number, 16), { x: p.x + 5, y: p.y + 3, size: 6, font, color: rgb(0.1, 0.2, 0.5) });
  }

  for (const septic of result.septicPermits) {
    const p = toPage(project(septic.latitude, septic.longitude));
    page.drawCircle({ x: p.x, y: p.y, size: 3.2, color: rgb(0.9, 0.45, 0.1) });
    const r = Math.max(SEPTIC_SETBACK_FT * scale, 6);
    page.drawCircle({
      x: p.x,
      y: p.y,
      size: r,
      borderColor: rgb(0.85, 0.25, 0.15),
      borderWidth: 0.7,
      color: undefined,
    });
    page.drawText(`Septic parcel ${septic.apn} (centroid)`, {
      x: p.x + 5,
      y: p.y - 6,
      size: 6,
      font,
      color: rgb(0.55, 0.25, 0.05),
    });
  }

  if (input.manualSeptic) {
    const p = toPage(project(input.manualSeptic.lat, input.manualSeptic.lng));
    page.drawCircle({ x: p.x, y: p.y, size: 3.5, color: rgb(0.75, 0.25, 0.7) });
    page.drawText('Septic (office-placed)', { x: p.x + 5, y: p.y, size: 6, font, color: rgb(0.45, 0.1, 0.4) });
  }

  if (input.proposedWell) {
    const p = toPage(project(input.proposedWell.lat, input.proposedWell.lng));
    page.drawCircle({ x: p.x, y: p.y, size: 4, color: rgb(0.05, 0.45, 0.2), borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
    page.drawText('Proposed well', { x: p.x + 6, y: p.y + 2, size: 7, font: bold, color: rgb(0.05, 0.3, 0.15) });
  }

  return { scaleFeetPerInch: feetPerInch };
}

function drawLegend(page: PDFPage, font: PDFFont, x: number, y: number) {
  page.drawText('Legend', { x, y: y + 10, size: 8, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawLine({ start: { x, y: y + 2 }, end: { x: x + 16, y: y + 2 }, thickness: 2, color: rgb(0.06, 0.55, 0.4) });
  page.drawText('Parcel line', { x: x + 20, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawCircle({ x: x + 90, y: y + 2, size: 3, color: rgb(0.15, 0.35, 0.85) });
  page.drawText('DWR well', { x: x + 96, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawCircle({ x: x + 150, y: y + 2, size: 3, color: rgb(0.9, 0.45, 0.1) });
  page.drawText('Septic parcel centroid', { x: x + 156, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawCircle({ x: x + 270, y: y + 2, size: 3, color: rgb(0.05, 0.45, 0.2) });
  page.drawText('Proposed well', { x: x + 276, y, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
}

function drawScaleBar(page: PDFPage, font: PDFFont, x: number, y: number, feetPerInch: number) {
  const barInches = 1.2;
  const barPx = barInches * 72;
  const feet = Math.round(feetPerInch * barInches);
  page.drawLine({ start: { x, y }, end: { x: x + barPx, y }, thickness: 2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y - 4 }, end: { x, y: y + 4 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({
    start: { x: x + barPx, y: y - 4 },
    end: { x: x + barPx, y: y + 4 },
    thickness: 1.2,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(`0`, { x: x - 2, y: y - 12, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`${feet} ft`, { x: x + barPx - 16, y: y - 12, size: 7, font, color: rgb(0.2, 0.2, 0.2) });
}

function drawNorth(page: PDFPage, bold: PDFFont, x: number, y: number) {
  page.drawLine({ start: { x, y }, end: { x, y: y + 28 }, thickness: 1.4, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y + 28 }, end: { x: x - 5, y: y + 18 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawLine({ start: { x, y: y + 28 }, end: { x: x + 5, y: y + 18 }, thickness: 1.2, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('N', { x: x - 3, y: y + 32, size: 9, font: bold, color: rgb(0.1, 0.1, 0.1) });
}

function drawWellsPage(page: PDFPage, font: PDFFont, bold: PDFFont, input: PlotPlanInput) {
  const { result } = input;
  page.drawText('Nearby wells (CA DWR) and data sources', {
    x: 28,
    y: 580,
    size: 13,
    font: bold,
    color: rgb(0.1, 0.15, 0.15),
  });
  page.drawText('Only wells returned by DWR are listed. Empty table means none found or DWR was unavailable — not a fake zero.', {
    x: 28,
    y: 564,
    size: 8,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  const headers = ['WCR', 'Depth ft', 'Static ft', 'Use', 'Dist ft'];
  const cols = [28, 160, 230, 300, 520];
  headers.forEach((h, i) => {
    page.drawText(h, { x: cols[i], y: 540, size: 8, font: bold, color: rgb(0.2, 0.2, 0.2) });
  });

  if (!result.wells.length) {
    page.drawText('No DWR wells to list.', { x: 28, y: 520, size: 9, font, color: rgb(0.4, 0.2, 0.2) });
  } else {
    result.wells.slice(0, 22).forEach((well, i) => {
      const y = 524 - i * 14;
      const row = [
        well.wcr_number || '—',
        well.total_completed_depth != null ? String(well.total_completed_depth) : '—',
        well.static_water_level != null ? String(well.static_water_level) : '—',
        clip(well.well_use || '—', 36),
        well.distance_from_parcel != null ? String(well.distance_from_parcel) : '—',
      ];
      row.forEach((cell, c) => {
        page.drawText(cell, { x: cols[c], y, size: 8, font, color: rgb(0.15, 0.15, 0.15) });
      });
    });
  }

  let y = 180;
  page.drawText('Sources', { x: 28, y, size: 11, font: bold, color: rgb(0.1, 0.15, 0.15) });
  y -= 16;
  for (const source of result.sources) {
    page.drawText(clip(`${source.status.toUpperCase()}  ${source.name} — ${source.message || ''}`, 120), {
      x: 28,
      y,
      size: 8,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 12;
  }

  y -= 8;
  page.drawText('Notes', { x: 28, y, size: 11, font: bold, color: rgb(0.1, 0.15, 0.15) });
  y -= 14;
  for (const note of buildPlotPlanModel(input).notes.slice(0, 6)) {
    page.drawText(clip(note, 130), { x: 28, y, size: 8, font, color: rgb(0.25, 0.25, 0.25) });
    y -= 12;
  }
}
