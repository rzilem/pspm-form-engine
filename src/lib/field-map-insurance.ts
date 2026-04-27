/**
 * HOA New Business Insurance Intake — canonical field map.
 *
 * This file is the single source of truth that wires together:
 *   - Form labels (UI)
 *   - Cell coordinates in the carrier's XLSX template
 *   - Section grouping (which wizard step a field belongs to)
 *   - Field type (text / date / money / boolean Y-N / number / select / longtext)
 *
 * The XLSX template lives at /templates/hoa-new-business-template.xlsx.
 * Sheet 1 ("Assoc Info") gets data in row 3.
 * Sheet 2 ("Building Information") gets up to 8 building rows in rows 2-9.
 * Cell AI3 (Sheet 1) is a SUM formula — do NOT overwrite.
 * Cells J2:J9 + H10:J10 (Sheet 2) are SUM formulas — do NOT overwrite.
 *
 * Do not rename a field key without updating both the XLSX populator and
 * any existing draft rows in the DB (their JSONB will be addressed by key).
 */

export type FieldType =
  | 'text'
  | 'longtext'
  | 'date'
  | 'money'
  | 'number'
  | 'percent'
  | 'select'
  | 'yesno'
  | 'yesnoNa'
  | 'email'
  | 'phone';

export interface FieldDef {
  /** Stable JSON key — used as data[key] in DB JSONB and in form state. */
  key: string;
  /** UI label. */
  label: string;
  /** Optional helper text shown under the label. */
  help?: string;
  type: FieldType;
  /** Cell coordinate in Sheet 1 ("Assoc Info") row 3 (e.g. "A3"). */
  cell: string;
  /** Marks a required field. Optional fields skip Zod required check. */
  required?: boolean;
  /** Select options when type === 'select'. */
  options?: ReadonlyArray<string>;
  /** Field groups inside a step that should render in a 2-column row. */
  half?: boolean;
}

export interface SectionDef {
  /** Stable section id — used as wizard step slug. */
  id: string;
  /** UI title in the stepper and section header. */
  title: string;
  /** One-line description shown under the title. */
  description: string;
  fields: ReadonlyArray<FieldDef>;
}

const ASSOCIATION_TYPES = ['Condo', 'Townhome', 'Single Family', 'Commercial'] as const;
const SECURITY_GUARD_TYPES = [
  'N/A',
  '3rd-party contractor',
  'Association employees',
  'Off-duty police',
  'Armed neighborhood watch',
  'Other',
] as const;
const SCOPE_OF_STATEMENT = ['Audit', 'Review', 'Compilation'] as const;

// ---------------------------------------------------------------------------
// Section 1 — Association Information & Coverage
// Spreadsheet cols A-N (Association Information, A1 merged) row 3.
// ---------------------------------------------------------------------------
const ASSOCIATION_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'effective_date',       label: 'Policy Effective Date',     type: 'date',  cell: 'A3', required: true,  half: true },
  { key: 'expiration_date',      label: 'Policy Expiration Date',    type: 'date',  cell: 'B3', required: true,  half: true },
  { key: 'do_limit',             label: 'D&O Limit',                 type: 'money', cell: 'C3', required: true,  half: true },
  { key: 'crime_limit',          label: 'Crime Limit',               type: 'money', cell: 'D3', required: true,  half: true },
  { key: 'social_eng_limit',     label: 'Social Engineering Limit',  type: 'money', cell: 'E3', required: true,  half: true },
  { key: 'cyber_limit',          label: 'Cyber Limit',               type: 'money', cell: 'F3', required: true,  half: true },
  { key: 'legal_name',           label: "Association's Legal Name",  type: 'text',  cell: 'G3', required: true },
  { key: 'association_type',     label: 'Association Type',          type: 'select', options: ASSOCIATION_TYPES, cell: 'H3', required: true, half: true },
  { key: 'fein',                 label: 'FEIN',                      type: 'text',  cell: 'I3', required: true,  help: 'Federal Employer Identification Number (XX-XXXXXXX)', half: true },
  { key: 'street_address',       label: 'Street Address',            type: 'text',  cell: 'J3', required: true },
  { key: 'city',                 label: 'City',                      type: 'text',  cell: 'K3', required: true,  half: true },
  { key: 'state',                label: 'State',                     type: 'text',  cell: 'L3', required: true,  half: true },
  { key: 'zip',                  label: 'Zip',                       type: 'text',  cell: 'M3', required: true,  half: true },
  { key: 'county',               label: 'County',                    type: 'text',  cell: 'N3', required: true,  half: true },
];

// ---------------------------------------------------------------------------
// Section 2 — Statement of Values (cols P-AI, row 3)
// AI3 is a SUM formula and is intentionally omitted.
// ---------------------------------------------------------------------------
const STATEMENT_OF_VALUES_FIELDS: ReadonlyArray<FieldDef> = [
  // Building 1 + 2 summary (full schedule lives on Sheet 2)
  { key: 'bldg1_description',    label: 'Building 1 Description',    type: 'text',  cell: 'P3' },
  { key: 'bldg1_building_value', label: 'Building 1 Building Value', type: 'money', cell: 'Q3', half: true },
  { key: 'bldg1_contents_value', label: 'Building 1 Contents Value', type: 'money', cell: 'R3', half: true },
  { key: 'bldg2_description',    label: 'Building 2 Description',    type: 'text',  cell: 'S3' },
  { key: 'bldg2_building_value', label: 'Building 2 Building Value', type: 'money', cell: 'T3', half: true },
  { key: 'bldg2_contents_value', label: 'Building 2 Contents Value', type: 'money', cell: 'U3', half: true },

  // Amenities & owned property (14 line items)
  { key: 'val_gates',            label: 'Gates',                                            type: 'money', cell: 'V3',  half: true },
  { key: 'val_sport_courts',     label: 'Fence and lighting (sport courts/fields)',         type: 'money', cell: 'W3',  half: true },
  { key: 'val_perimeter_fences', label: 'Fences / perimeter walls',                         type: 'money', cell: 'X3',  half: true },
  { key: 'val_fountains',        label: 'Fountains, lights, pumps, wells',                  type: 'money', cell: 'Y3',  half: true },
  { key: 'val_irrigation',       label: 'Irrigation system',                                type: 'money', cell: 'Z3',  half: true },
  { key: 'val_mailbox_kiosks',   label: 'Mailbox kiosks',                                   type: 'money', cell: 'AA3', half: true },
  { key: 'val_monuments_signs',  label: 'Monuments / signs',                                type: 'money', cell: 'AB3', half: true },
  { key: 'val_other_property',   label: 'Other owned property not otherwise described',     type: 'money', cell: 'AC3', help: 'Trees, plants, and shrubs are covered up to $10,000 by default — only list values above that.' },
  { key: 'val_playground',       label: 'Playground / park equipment',                      type: 'money', cell: 'AD3', half: true },
  { key: 'val_security_cameras', label: 'Security cameras and lighting',                    type: 'money', cell: 'AE3', half: true },
  { key: 'val_splash_parks',     label: 'Splash parks',                                     type: 'money', cell: 'AF3', half: true },
  { key: 'val_streets_lights',   label: 'Streets and street lights',                        type: 'money', cell: 'AG3', half: true },
  { key: 'val_pools',            label: 'Swimming pools (incl. equipment, slides, boards)', type: 'money', cell: 'AH3', half: true },
  // AI3 = SUM(P3:AH3) — auto-calculated, do NOT populate.
];

// ---------------------------------------------------------------------------
// Section 3 — Underwriting (cols AK-BG)
// ---------------------------------------------------------------------------
const UNDERWRITING_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'units_completed',         label: 'Current # of Completed Units',                 type: 'number',  cell: 'AK3', required: true, half: true },
  { key: 'units_pending_12mo',      label: '# of Units to be Completed in Next 12 Months', type: 'number',  cell: 'AL3', half: true },
  { key: 'units_at_completion',     label: 'Total # of Units at Completion',               type: 'number',  cell: 'AM3', required: true, half: true },
  { key: 'year_completed',          label: 'Year Community was/will be Completed',         type: 'number',  cell: 'AN3', required: true, help: '4-digit year', half: true },
  { key: 'developer_name',          label: 'Developer Name (if still under development)',  type: 'text',    cell: 'AO3' },

  { key: 'has_clubhouse',           label: 'Clubhouse / meeting hall available for rental?', type: 'yesno', cell: 'AP3', required: true, half: true },
  // Carrier expects a single answer: Y/N plus what facilities exist (e.g. "Yes — gym, basketball court").
  { key: 'exercise_facilities',     label: 'Exercise facilities, courts, or weight rooms', type: 'longtext', cell: 'AQ3', required: true, help: 'Answer "Yes" or "No". If yes, identify facilities (gym, courts, weight room, etc.).' },

  { key: 'pool_count',              label: 'Number of Pools',                                type: 'number',  cell: 'AR3', required: true, half: true },
  { key: 'pool_management_3p',      label: 'Hire 3rd-party pool management?',                type: 'yesno',   cell: 'AS3', half: true },
  { key: 'pool_lifeguards_3p',      label: 'Hire 3rd-party lifeguards?',                     type: 'yesno',   cell: 'AT3', half: true },
  { key: 'pool_written_contract',   label: 'Written contract for pool/lifeguard services?',  type: 'yesno',   cell: 'AU3', half: true },
  { key: 'pool_vgb_compliant',      label: 'Pool compliant with Virginia Graeme Baker Act?', type: 'yesno',   cell: 'AV3', half: true, help: 'Federal anti-entrapment / drain cover requirement.' },

  { key: 'has_employees',           label: 'Community has any employees?',                   type: 'yesno',   cell: 'AW3', required: true, half: true },
  { key: 'has_security_guards',     label: 'Hire security guards?',                          type: 'yesno',   cell: 'AX3', required: true, half: true },
  { key: 'security_guard_type',     label: 'If armed, by whom?',                             type: 'select', options: SECURITY_GUARD_TYPES, cell: 'AY3' },
  { key: 'security_contract_hh',    label: 'Armed security contract has hold-harmless wording?', type: 'yesno', cell: 'AZ3', help: 'Provide a copy if yes.' },

  { key: 'has_lakes_ponds',         label: 'Lakes, ponds, or retention ponds?',              type: 'yesno',   cell: 'BA3', required: true, half: true },
  { key: 'allows_boating_swimming', label: 'Boating or swimming allowed?',                   type: 'yesno',   cell: 'BB3', half: true },

  { key: 'is_master_association',   label: 'Master association with sub-associations?',      type: 'yesno',   cell: 'BC3', required: true, half: true },
  { key: 'commercial_occupancy_pct', label: '% of Commercial Occupancy (if any)',            type: 'percent', cell: 'BD3', half: true },
  { key: 'other_amenities',         label: 'Other recreational amenities not listed',        type: 'longtext', cell: 'BE3' },
  { key: 'has_short_term_rental',   label: 'HOA offers short-term rentals?',                 type: 'yesno',   cell: 'BF3', required: true, half: true },
];

// ---------------------------------------------------------------------------
// Section 4 — Accounting (cols BG-BO)
// ---------------------------------------------------------------------------
const ACCOUNTING_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'max_assets',               label: 'Maximum Assets (reserves + operating)',      type: 'money', cell: 'BG3', required: true, half: true },
  { key: 'positive_fund_balance',    label: 'Positive Fund Balance?',                     type: 'yesno', cell: 'BH3', required: true, half: true },
  { key: 'assessments_over_10pct',   label: 'Assessments or delinquents over 10%?',       type: 'yesno', cell: 'BI3', required: true, half: true },
  { key: 'assessment_increase_12mo', label: 'Assessment increase or special assessment in last 12mo (or pending)?', type: 'yesno', cell: 'BJ3', required: true, help: 'If yes, capture amount and % below.' },
  { key: 'assessment_purpose',       label: 'Purpose of the (special) assessment',        type: 'longtext', cell: 'BK3' },
  { key: 'assessment_unanimous_vote', label: 'Unanimous vote, all owners notified in writing, all agreed to pay?', type: 'yesno', cell: 'BL3' },
  { key: 'assessment_payment_schedule', label: 'Per-unit payment schedule + when final', type: 'longtext', cell: 'BM3' },
  { key: 'delinquencies_over_20pct', label: '>20% of owners more than 90 days delinquent?', type: 'yesno', cell: 'BN3', required: true, help: 'If yes, capture amount and %.' },
  { key: 'gov_fines_2yr',            label: 'Government fines or fees assessed in last 2 years?', type: 'yesno', cell: 'BO3', required: true, half: true },
];

// ---------------------------------------------------------------------------
// Section 5 — Losses + Special Events (cols BP-BS)
// ---------------------------------------------------------------------------
const LOSSES_EVENTS_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'avg_unit_value_over_1m',   label: 'Average unit/home value over $1,000,000?',   type: 'yesno', cell: 'BP3', required: true, half: true },
  { key: 'losses_in_5yr',            label: 'Any losses in the last 5 years?',            type: 'yesno', cell: 'BQ3', required: true, half: true },
  { key: 'losses_description',       label: 'Description of all losses (if any)',         type: 'longtext', cell: 'BR3' },
  { key: 'special_events',           label: 'List of special events (residents-only or open to public)', type: 'longtext', cell: 'BS3' },
];

// ---------------------------------------------------------------------------
// Section 6 — Accounting Controls (cols BT-BV)
// ---------------------------------------------------------------------------
const ACCOUNTING_CONTROLS_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'countersig_required',      label: 'Countersignature required?',                 type: 'yesno', cell: 'BT3', required: true, half: true },
  { key: 'accounts_reconciled',      label: 'Accounts reconciled regularly?',             type: 'yesno', cell: 'BU3', required: true, half: true },
  { key: 'scope_of_statement',       label: 'Scope of Financial Statement',               type: 'select', options: SCOPE_OF_STATEMENT, cell: 'BV3', required: true },
];

// ---------------------------------------------------------------------------
// Section 7 — Buildings repeater (Sheet 2, rows 2-9)
// ---------------------------------------------------------------------------
export const BUILDING_FIELDS = [
  { key: 'description',       label: 'Building Description',  type: 'text',   col: 'B' },
  { key: 'address',           label: 'Address',               type: 'text',   col: 'C' },
  { key: 'city',              label: 'City',                  type: 'text',   col: 'D' },
  { key: 'state',             label: 'State',                 type: 'text',   col: 'E' },
  { key: 'zip',               label: 'Zip',                   type: 'text',   col: 'F' },
  { key: 'county',            label: 'County',                type: 'text',   col: 'G' },
  { key: 'building_value',    label: 'Building Value',        type: 'money',  col: 'H' },
  { key: 'contents_value',    label: 'Contents Value',        type: 'money',  col: 'I' },
  // J = SUM(H,I) formula — skipped on populate
  { key: 'year_built',        label: 'Year Built',            type: 'number', col: 'K' },
  { key: 'square_footage',    label: 'Square Footage',        type: 'number', col: 'L' },
  { key: 'stories',           label: '# of Stories',          type: 'number', col: 'M' },
  { key: 'construction_type', label: 'Construction Type',     type: 'text',   col: 'N' },
  { key: 'last_roof_update',  label: 'Last Roof Update Year', type: 'number', col: 'O' },
] as const;

export const MAX_BUILDING_ROWS = 8; // Template rows 2-9.

// ---------------------------------------------------------------------------
// Sections registry
// ---------------------------------------------------------------------------
export const SECTIONS: ReadonlyArray<SectionDef> = [
  {
    id: 'association',
    title: 'Association & Coverage',
    description: 'Legal entity, address, and the policy limits being requested.',
    fields: ASSOCIATION_FIELDS,
  },
  {
    id: 'values',
    title: 'Statement of Values',
    description: 'Building 1 & 2 quick summary plus per-amenity insured values.',
    fields: STATEMENT_OF_VALUES_FIELDS,
  },
  {
    id: 'underwriting',
    title: 'Underwriting',
    description: 'Unit counts, amenities, employees, security, water features, and rentals.',
    fields: UNDERWRITING_FIELDS,
  },
  {
    id: 'accounting',
    title: 'Accounting',
    description: 'Reserve health, fund balance, assessments, and delinquencies.',
    fields: ACCOUNTING_FIELDS,
  },
  {
    id: 'losses_events',
    title: 'Losses & Special Events',
    description: 'Five-year loss history and any community events the carrier should know about.',
    fields: LOSSES_EVENTS_FIELDS,
  },
  {
    id: 'controls',
    title: 'Accounting Controls',
    description: 'Internal financial controls — required by the carrier underwriter.',
    fields: ACCOUNTING_CONTROLS_FIELDS,
  },
  {
    id: 'buildings',
    title: 'Building Schedule',
    description: 'Add up to 8 buildings with full address, year built, square footage, and roof age.',
    fields: [], // Buildings use the repeater UI defined above; no flat fields here.
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All flat (non-building) fields, flattened across sections. */
export const ALL_FIELDS: ReadonlyArray<FieldDef> = SECTIONS.flatMap((s) => s.fields);

export function getFieldByKey(key: string): FieldDef | undefined {
  return ALL_FIELDS.find((f) => f.key === key);
}

export function getSectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
