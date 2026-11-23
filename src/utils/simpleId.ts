/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppDatabase } from '../types';

/**
 * Standard simple primary key prefixes across the entire Gatan ERP.
 * Format: `${prefix}-${n}` where n is a positive sequential integer (1, 2, 3, ...).
 */
export const COLLECTION_ID_PREFIXES: Record<string, string> = {
  // Periods & Structure
  periods: 'p',
  departments: 'dept',
  itemCategories: 'icat',
  productCategories: 'pcat',
  warehouses: 'wh',
  unitsOfMeasurement: 'unit',
  packagingTypes: 'pkg',

  // Inventory, Products & Production
  items: 'item',
  products: 'prod',
  productFormulas: 'form',
  unitConversions: 'conv',
  dailyProductionSegments: 'seg',
  productionPlanningOrders: 'ppo',
  customerProductionOrders: 'cpo',
  procurementOrders: 'po',
  purchaseInvoices: 'inv',
  stockCountAudits: 'aud',
  stockCounts: 'sc',

  // Sales & Counterparties
  salesPeriods: 'sp',
  productSales: 'sale',
  salesTransactions: 'stx',
  suppliers: 'sup',
  customers: 'cust',
  customerCategories: 'ccat',

  // Treasury
  bankAccounts: 'bank',
  cashDrawers: 'csh',
  posTerminals: 'pos',
  cashiers: 'cshr',
  chequeBooks: 'chkb',
  chequeLeaves: 'leaf',
  treasuryReceipts: 'rec',
  treasuryPayments: 'pay',
  barterTransactions: 'btr',
  counterpartySettlements: 'set',
  cashierShiftCloseouts: 'cls',

  // HR, Payroll & Attendance
  personnel: 'emp',
  personnelCategories: 'pgrp',
  personnelContracts: 'cnt',
  payrollPeriods: 'pp',
  payrollItems: 'pi',
  personnelAllocations: 'alloc',
  salaryBaseRates: 'sbr',
  attendanceRecords: 'att',
  shifts: 'sh',
  shiftAssignments: 'sha',
  productionSections: 'sec',
  shiftSchemes: 'sch',
  monthlyWorkdaySettings: 'mws',
  officialHolidays: 'ohd',
  seniorityRateRules: 'snr',
  insuredSalaryItems: 'ins',
  leaveBuyoutSalaryItems: 'lbo',
  taxableSalaryItems: 'txi',
  taxExemptions: 'txe',
  taxBrackets: 'txb',
  payrollSettings: 'pset',
  personnelSettlements: 'stl',

  // Overheads, Scales, Barcodes & System Security
  periodOverheads: 'oh',
  dibalScales: 'scale',
  dibalPLUs: 'plu',
  dibalTickets: 'tkt',
  roles: 'role',
  users: 'usr',

  // Nested sub-entity prefixes
  barcodeProfiles: 'bp',
  ovens: 'ovn',
  trays: 'try',
  racks: 'rck',
  orderLines: 'ln',
  terminalLogs: 'log',
};

export function getPrefixForCollection(collectionKey: keyof AppDatabase | string): string {
  return COLLECTION_ID_PREFIXES[String(collectionKey)] || String(collectionKey).slice(0, 4).toLowerCase();
}

/**
 * Checks whether an ID already conforms to the clean simple format `prefix-N` (e.g. `item-1`, `prod-42`).
 */
export function isSimpleId(id: unknown, prefix: string): boolean {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-[1-9]\\d*$`).test(trimmed);
}

/**
 * Extracts the highest numeric index already used for a given prefix across a list of records/IDs.
 */
export function getMaxSimpleIdNumber(
  collection: ReadonlyArray<{ id?: string } | string> | undefined | null,
  prefix: string
): number {
  if (!Array.isArray(collection) || collection.length === 0) return 0;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}-(\\d+)$`);
  let max = 0;
  for (let i = 0; i < collection.length; i++) {
    const entry = collection[i];
    const rawId = typeof entry === 'string' ? entry : entry?.id;
    if (typeof rawId !== 'string') continue;
    const match = rawId.trim().match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > max) {
        max = n;
      }
    }
  }
  return max;
}

/**
 * Generates the next simple sequential ID (`${prefix}-${max + 1}`) for a collection.
 */
export function nextSimpleId(
  collection: ReadonlyArray<{ id?: string } | string> | undefined | null,
  prefix: string,
  extraUsedIds?: Iterable<string>
): string {
  const used = new Set<string>();
  let max = getMaxSimpleIdNumber(collection, prefix);

  if (Array.isArray(collection)) {
    for (let i = 0; i < collection.length; i++) {
      const entry = collection[i];
      const rawId = typeof entry === 'string' ? entry : entry?.id;
      if (typeof rawId === 'string' && rawId.trim()) {
        used.add(rawId.trim());
      }
    }
  }

  if (extraUsedIds) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-(\\d+)$`);
    for (const id of extraUsedIds) {
      if (!id) continue;
      const trimmed = id.trim();
      used.add(trimmed);
      const match = trimmed.match(pattern);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
  }

  let candidateNum = max + 1;
  while (used.has(`${prefix}-${candidateNum}`)) {
    candidateNum += 1;
  }
  return `${prefix}-${candidateNum}`;
}

/**
 * Stateful sequential ID generator for batch creation (imports, cross-period copies, migrations).
 */
export function createSimpleIdGenerator(
  collection: ReadonlyArray<{ id?: string } | string> | undefined | null,
  prefix: string
): () => string {
  const used = new Set<string>();
  let counter = getMaxSimpleIdNumber(collection, prefix);

  if (Array.isArray(collection)) {
    for (let i = 0; i < collection.length; i++) {
      const entry = collection[i];
      const rawId = typeof entry === 'string' ? entry : entry?.id;
      if (typeof rawId === 'string' && rawId.trim()) {
        used.add(rawId.trim());
      }
    }
  }

  return () => {
    counter += 1;
    while (used.has(`${prefix}-${counter}`)) {
      counter += 1;
    }
    const id = `${prefix}-${counter}`;
    used.add(id);
    return id;
  };
}
