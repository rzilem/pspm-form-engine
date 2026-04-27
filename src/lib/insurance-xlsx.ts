/**
 * Carrier XLSX populator for the HOA New Business Insurance Intake.
 *
 * Loads `templates/hoa-new-business-template.xlsx` (the carrier's required
 * format) and writes form values into the exact cells defined by the
 * field-map. Returns a fresh Buffer every call — never mutates the file
 * on disk.
 *
 * Two sheets:
 *   - "Assoc Info"           row 3 holds all flat fields. AI3 = SUM(P3:AH3)
 *                            formula and is left untouched.
 *   - "Building Information" rows 2-9 hold one building each.
 *                            J2:J9 = SUM(H,I) and H10:J10 = SUM totals.
 *                            All formula cells left untouched.
 */

import path from "path";
import { promises as fs } from "fs";
import ExcelJS from "exceljs";

import {
  ALL_FIELDS,
  BUILDING_FIELDS,
  MAX_BUILDING_ROWS,
  type FieldDef,
} from "./field-map-insurance";
import type { InsuranceFormData } from "./schemas-insurance";

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "hoa-new-business-template.xlsx");
const SHEET_ASSOC = "Assoc Info";
const SHEET_BUILDINGS = "Building Information";
const ASSOC_DATA_ROW = 3;
const BUILDING_FIRST_ROW = 2;

let cachedTemplate: Buffer | null = null;

async function loadTemplateBuffer(): Promise<Buffer> {
  if (cachedTemplate) return cachedTemplate;
  const buf = await fs.readFile(TEMPLATE_PATH);
  cachedTemplate = buf;
  return buf;
}

/**
 * Coerce a string form value into the cell value the carrier expects.
 * - money/number/percent → number (so Excel formats correctly)
 * - date → JS Date
 * - yesno → "Yes" / "No"
 * - everything else → trimmed string (or undefined when blank)
 */
function coerceForCell(
  field: { type: FieldDef["type"] },
  raw: string | undefined,
): string | number | Date | boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === "") return undefined;

  switch (field.type) {
    case "money":
    case "number":
    case "percent": {
      const cleaned = trimmed.replace(/[$,%\s]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : trimmed;
    }
    case "date": {
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? trimmed : d;
    }
    case "yesno": {
      const upper = trimmed.toUpperCase();
      if (upper === "Y") return "Yes";
      if (upper === "N") return "No";
      return trimmed;
    }
    case "yesnoNa": {
      const upper = trimmed.toUpperCase();
      if (upper === "Y") return "Yes";
      if (upper === "N") return "No";
      if (upper === "N/A") return "N/A";
      return trimmed;
    }
    default:
      return trimmed;
  }
}

/** Write a value to a cell only when the cell isn't already a formula. */
function writeIfNotFormula(
  ws: ExcelJS.Worksheet,
  address: string,
  value: string | number | Date | boolean | undefined,
) {
  if (value === undefined) return;
  const cell = ws.getCell(address);
  if (cell.formula || cell.formulaType) return;
  cell.value = value as ExcelJS.CellValue;
}

function rebaseToRow(address: string, row: number): string {
  return address.replace(/\d+$/, String(row));
}

function isNonEmptyRow(row: Record<string, string | undefined>): boolean {
  return BUILDING_FIELDS.some((f) => {
    const v = row[f.key];
    return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
  });
}

/**
 * Populate the carrier workbook with form data and return a fresh Buffer.
 *
 * Caller is responsible for validation — the populator coerces best-effort
 * but doesn't enforce required fields.
 */
export async function populateCarrierWorkbook(data: InsuranceFormData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const templateBuffer = await loadTemplateBuffer();
  // exceljs bundles its own ambient Buffer typing that conflicts with
  // @types/node@20+'s Buffer<TArrayBuffer> shape — runtime is fine.
  await wb.xlsx.load(Buffer.from(templateBuffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const assoc = wb.getWorksheet(SHEET_ASSOC);
  const buildings = wb.getWorksheet(SHEET_BUILDINGS);
  if (!assoc) throw new Error(`Template missing required sheet: ${SHEET_ASSOC}`);
  if (!buildings) throw new Error(`Template missing required sheet: ${SHEET_BUILDINGS}`);

  // Compact non-empty building rows so the carrier's per-row SUMs line up.
  const incomingBuildings = (data.buildings ?? []) as Array<Record<string, string | undefined>>;
  const nonEmptyBuildings = incomingBuildings.filter(isNonEmptyRow).slice(0, MAX_BUILDING_ROWS);

  // Mirror the first 2 buildings into Sheet 1 P3:U3 (description + values)
  // when they're not already on the flat form. AI3 SUMs P3:AH3 — staff who
  // fill the building schedule but leave Sheet 1 cells blank would otherwise
  // miss building values in TIV.
  const flatRaw = (data.flat ?? {}) as Record<string, string | undefined>;
  const flatWithMirror: Record<string, string | undefined> = { ...flatRaw };
  if (nonEmptyBuildings[0]) {
    if (!flatWithMirror.bldg1_description) flatWithMirror.bldg1_description = String(nonEmptyBuildings[0].description ?? "");
    if (!flatWithMirror.bldg1_building_value) flatWithMirror.bldg1_building_value = String(nonEmptyBuildings[0].building_value ?? "");
    if (!flatWithMirror.bldg1_contents_value) flatWithMirror.bldg1_contents_value = String(nonEmptyBuildings[0].contents_value ?? "");
  }
  if (nonEmptyBuildings[1]) {
    if (!flatWithMirror.bldg2_description) flatWithMirror.bldg2_description = String(nonEmptyBuildings[1].description ?? "");
    if (!flatWithMirror.bldg2_building_value) flatWithMirror.bldg2_building_value = String(nonEmptyBuildings[1].building_value ?? "");
    if (!flatWithMirror.bldg2_contents_value) flatWithMirror.bldg2_contents_value = String(nonEmptyBuildings[1].contents_value ?? "");
  }

  // ---- Sheet 1: flat fields, all in row 3 ----
  for (const field of ALL_FIELDS) {
    const address = rebaseToRow(field.cell, ASSOC_DATA_ROW);
    writeIfNotFormula(assoc, address, coerceForCell(field, flatWithMirror[field.key]));
  }

  // ---- Sheet 2: building schedule, compacted to rows 2..N ----
  nonEmptyBuildings.forEach((row, idx) => {
    const sheetRow = BUILDING_FIRST_ROW + idx;
    writeIfNotFormula(buildings, `A${sheetRow}`, idx + 1);
    for (const def of BUILDING_FIELDS) {
      writeIfNotFormula(
        buildings,
        `${def.col}${sheetRow}`,
        coerceForCell({ type: def.type }, row[def.key]),
      );
    }
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as unknown as Uint8Array);
}
