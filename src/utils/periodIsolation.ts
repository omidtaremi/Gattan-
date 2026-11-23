/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AppDatabase,
  BarcodeSettings,
  PayrollCalculationRules,
  Period,
  ProductionPlanningSettings,
} from '../types';
import {
  COLLECTION_ID_PREFIXES,
  createSimpleIdGenerator,
  getPrefixForCollection,
  isSimpleId,
  nextSimpleId,
} from './simpleId';

/**
 * Every array collection in AppDatabase whose records are strictly isolated per fiscal period.
 * Only users, roles, server/backup settings, and global digitalMenu branding remain system-wide.
 */
export const ISOLATED_ARRAY_COLLECTIONS: ReadonlyArray<keyof AppDatabase> = [
  'itemCategories',
  'warehouses',
  'unitsOfMeasurement',
  'items',
  'purchaseInvoices',
  'stockCountAudits',
  'stockCounts',
  'suppliers',
  'customerCategories',
  'customers',
  'customerProductionOrders',
  'departments',
  'productCategories',
  'packagingTypes',
  'products',
  'salesPeriods',
  'productSales',
  'salesTransactions',
  'unitConversions',
  'productFormulas',
  'dailyProductionSegments',
  'productionPlanningOrders',
  'procurementOrders',
  'periodOverheads',
  'bankAccounts',
  'cashDrawers',
  'posTerminals',
  'cashiers',
  'chequeBooks',
  'chequeLeaves',
  'treasuryReceipts',
  'treasuryPayments',
  'barterTransactions',
  'counterpartySettlements',
  'cashierShiftCloseouts',
  'personnelCategories',
  'personnel',
  'personnelContracts',
  'payrollPeriods',
  'payrollItems',
  'personnelAllocations',
  'salaryBaseRates',
  'seniorityRateRules',
  'insuredSalaryItems',
  'leaveBuyoutSalaryItems',
  'taxableSalaryItems',
  'taxExemptions',
  'taxBrackets',
  'attendanceRecords',
  'monthlyWorkdaySettings',
  'officialHolidays',
  'payrollSettings',
  'shifts',
  'productionSections',
  'shiftAssignments',
  'shiftSchemes',
  'personnelSettlements',
  'dibalScales',
  'dibalPLUs',
  'dibalTickets',
];

export const DEFAULT_PAYROLL_CALCULATION_RULES: PayrollCalculationRules = {
  calculateEarlyOvertime: true,
  calculateLateOvertime: true,
  calculateHolidayWork: true,
  calculateFridayWork: true,
  calculateEntryDelayFine: false,
  delayFineRate: 1.0,
  deductClothesChangingTime: false,
  clothesChangingDuration: 15,
};

export function createDefaultBarcodeSettings(): BarcodeSettings {
  return {
    defaultWeightedPrefix: '20',
    defaultCountPrefix: '22',
    defaultSimpleLength: 13,
    autoParseOnScan: true,
    enableSoundOnScan: true,
    profiles: [
      {
        id: 'bp-1',
        name: 'بارکد وزنی استاندارد ترازوی دیبال (پیش‌کد ۲۰)',
        type: 'weighted',
        symbology: 'EAN-13',
        prefix: '20',
        itemCodeLength: 5,
        valueLength: 5,
        hasCheckDigit: true,
        unitMultiplier: 1000,
        description: 'ساختار استاندارد ۱۳ رقمی وزنی: ۲ رقم پیش‌کد + ۵ رقم کد کالا + ۵ رقم وزن به گرم + ۱ رقم کنترلی',
        isDefault: true,
        patternSample: '20CCCCWWWWWC',
      },
      {
        id: 'bp-2',
        name: 'بارکد تعدادی ترازو و بسته‌بندی (پیش‌کد ۲۲)',
        type: 'count',
        symbology: 'EAN-13',
        prefix: '22',
        itemCodeLength: 5,
        valueLength: 5,
        hasCheckDigit: true,
        unitMultiplier: 1,
        description: 'ساختار استاندارد ۱۳ رقمی تعدادی: ۲ رقم پیش‌کد + ۵ رقم کد کالا + ۵ رقم تعداد + ۱ رقم کنترلی',
        isDefault: false,
        patternSample: '22CCCCQQQQQC',
      },
    ],
  };
}

export function createDefaultProductionPlanningSettings(periodId: string): ProductionPlanningSettings {
  return {
    periodId,
    startHour: '06:00',
    endHour: '24:00',
    prepTimeMinutes: 15,
    kneadingTimeMinutes: 20,
    totalRacks: 10,
    tiersPerRack: 16,
    proofingMaxRacks: 6,
    ovens: [],
    trays: [],
    productAssignments: [],
    racks: [],
  };
}

export function getPeriodPayrollRules(db: AppDatabase, periodId: string): PayrollCalculationRules {
  const map = db.payrollCalculationRulesByPeriod;
  if (map && map[periodId]) {
    return map[periodId];
  }
  return { ...DEFAULT_PAYROLL_CALCULATION_RULES };
}

export function setPeriodPayrollRules(
  db: AppDatabase,
  periodId: string,
  rules: PayrollCalculationRules
): AppDatabase {
  return {
    ...db,
    payrollCalculationRules: periodId === db.selectedPeriodId ? rules : db.payrollCalculationRules,
    payrollCalculationRulesByPeriod: {
      ...(db.payrollCalculationRulesByPeriod || {}),
      [periodId]: rules,
    },
  };
}

export function getPeriodBarcodeSettings(db: AppDatabase, periodId: string): BarcodeSettings {
  const map = db.barcodeSettingsByPeriod;
  if (map && map[periodId]) {
    return map[periodId];
  }
  return {
    defaultWeightedPrefix: '20',
    defaultCountPrefix: '22',
    defaultSimpleLength: 13,
    autoParseOnScan: true,
    enableSoundOnScan: true,
    profiles: [],
  };
}

export function setPeriodBarcodeSettings(
  db: AppDatabase,
  periodId: string,
  settings: BarcodeSettings
): AppDatabase {
  return {
    ...db,
    barcodeSettings: periodId === db.selectedPeriodId ? settings : db.barcodeSettings,
    barcodeSettingsByPeriod: {
      ...(db.barcodeSettingsByPeriod || {}),
      [periodId]: settings,
    },
  };
}

export function getPeriodProductionSettings(
  db: AppDatabase,
  periodId: string
): ProductionPlanningSettings {
  const map = db.productionPlanningSettingsByPeriod;
  if (map && map[periodId]) {
    return map[periodId];
  }
  return createDefaultProductionPlanningSettings(periodId);
}

export function setPeriodProductionSettings(
  db: AppDatabase,
  periodId: string,
  settings: ProductionPlanningSettings
): AppDatabase {
  const normalized: ProductionPlanningSettings = { ...settings, periodId };
  return {
    ...db,
    productionPlanningSettings:
      periodId === db.selectedPeriodId ? normalized : db.productionPlanningSettings,
    productionPlanningSettingsByPeriod: {
      ...(db.productionPlanningSettingsByPeriod || {}),
      [periodId]: normalized,
    },
  };
}

export function getPeriodPersonnelCapabilities(
  db: AppDatabase,
  periodId: string
): Record<string, string[]> {
  return db.personnelCapabilitiesByPeriod?.[periodId] || {};
}

export function setPeriodPersonnelCapabilities(
  db: AppDatabase,
  periodId: string,
  capabilities: Record<string, string[]>
): AppDatabase {
  return {
    ...db,
    personnelCapabilities:
      periodId === db.selectedPeriodId ? capabilities : db.personnelCapabilities,
    personnelCapabilitiesByPeriod: {
      ...(db.personnelCapabilitiesByPeriod || {}),
      [periodId]: capabilities,
    },
  };
}

/**
 * Helper to create a brand-new, 100% isolated blank fiscal period with a simple ID (`p-N`).
 */
export function createBlankPeriod(
  db: AppDatabase,
  input: { name: string; startDate?: string; endDate?: string }
): { updatedDb: AppDatabase; period: Period } {
  const newId = nextSimpleId(db.periods || [], 'p');
  const period: Period = {
    id: newId,
    name: input.name.trim(),
    isActive: true,
    startDate: input.startDate?.trim() || '1405/01/01',
    endDate: input.endDate?.trim() || '1405/12/29',
    createdAt: new Date().toISOString(),
  };

  const updatedDb: AppDatabase = {
    ...db,
    periods: [...(db.periods || []), period],
    selectedPeriodId: newId,
  };

  return { updatedDb, period };
}

/**
 * Cleanly deletes a fiscal period and ONLY its own isolated data (zero cross-period leakage or auto-merging).
 */
export function purgePeriodData(
  db: AppDatabase,
  targetPeriodId: string
): { updatedDb: AppDatabase; nextPeriodId: string; removedCount: number } {
  const remainingPeriods = (db.periods || []).filter((p) => p.id !== targetPeriodId);
  const nextPeriodId =
    db.selectedPeriodId === targetPeriodId
      ? remainingPeriods[0]?.id || ''
      : db.selectedPeriodId || remainingPeriods[0]?.id || '';

  const nextDb: any = {
    ...db,
    periods: remainingPeriods,
    selectedPeriodId: nextPeriodId,
  };

  let removedCount = 0;

  for (const key of ISOLATED_ARRAY_COLLECTIONS) {
    const arr = db[key];
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((item: any) => item?.periodId !== targetPeriodId);
    removedCount += arr.length - filtered.length;
    nextDb[key] = filtered;
  }

  // Clean period-keyed maps
  const cleanRecordMap = <T,>(rec?: Record<string, T>): Record<string, T> | undefined => {
    if (!rec || typeof rec !== 'object') return rec;
    if (!(targetPeriodId in rec)) return rec;
    const clone = { ...rec };
    delete clone[targetPeriodId];
    return clone;
  };

  if (db.payrollCalculationRulesByPeriod) {
    nextDb.payrollCalculationRulesByPeriod = cleanRecordMap(db.payrollCalculationRulesByPeriod);
  }
  if (db.barcodeSettingsByPeriod) {
    nextDb.barcodeSettingsByPeriod = cleanRecordMap(db.barcodeSettingsByPeriod);
  }
  if (db.productionPlanningSettingsByPeriod) {
    nextDb.productionPlanningSettingsByPeriod = cleanRecordMap(db.productionPlanningSettingsByPeriod);
  }
  if (db.personnelCapabilitiesByPeriod) {
    nextDb.personnelCapabilitiesByPeriod = cleanRecordMap(db.personnelCapabilitiesByPeriod);
  }
  if (db.payrollManualOverrides && typeof db.payrollManualOverrides === 'object') {
    const cleanedOverrides: typeof db.payrollManualOverrides = {};
    for (const [k, v] of Object.entries(db.payrollManualOverrides)) {
      if (!k.startsWith(`${targetPeriodId}_`) && !k.startsWith(`${targetPeriodId}-`) && k !== targetPeriodId) {
        cleanedOverrides[k] = v;
      }
    }
    nextDb.payrollManualOverrides = cleanedOverrides;
  }

  return { updatedDb: nextDb as AppDatabase, nextPeriodId, removedCount };
}

/**
 * Returns summary counts of records inside a given period (for deletion preview & period info).
 */
export function getPeriodRecordCounts(db: AppDatabase, periodId: string) {
  const count = (arr?: any[]) =>
    Array.isArray(arr) ? arr.filter((x) => x && x.periodId === periodId).length : 0;

  return {
    items: count(db.items),
    products: count(db.products),
    formulas: count(db.productFormulas),
    personnel: count(db.personnel),
    customers: count(db.customers),
    suppliers: count(db.suppliers),
    salesTransactions: count(db.salesTransactions) + count(db.productSales),
    purchaseInvoices: count(db.purchaseInvoices),
    treasuryDocs:
      count(db.treasuryReceipts) +
      count(db.treasuryPayments) +
      count(db.barterTransactions) +
      count(db.counterpartySettlements) +
      count(db.cashierShiftCloseouts),
    stockCounts: count(db.stockCounts),
    total: ISOLATED_ARRAY_COLLECTIONS.reduce((sum, key) => sum + count(db[key] as any[]), 0),
  };
}

/**
 * Builds a deterministic remapping table (`oldId -> simpleId`) for a collection.
 * Already-simple unique IDs (`prefix-N`) are preserved untouched so repeated runs are pure no-ops.
 */
function buildCollectionIdMap(
  arr: any[] | undefined,
  prefix: string
): { map: Map<string, string>; changed: boolean; normalized: any[] } {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { map: new Map(), changed: false, normalized: Array.isArray(arr) ? arr : [] };
  }

  // First pass: check if all IDs are already clean, unique simple IDs
  const seenClean = new Set<string>();
  let needsRemap = false;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!isSimpleId(rawId, prefix) || seenClean.has(rawId) || rawId !== item.id) {
      needsRemap = true;
      break;
    }
    seenClean.add(rawId);
  }

  if (!needsRemap) {
    return { map: new Map(), changed: false, normalized: arr };
  }

  // Collect all valid unique simple IDs first so we preserve them
  const preservedIds = new Set<string>();
  const keptIndices = new Set<number>();
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item !== 'object') continue;
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    if (isSimpleId(rawId, prefix) && !preservedIds.has(rawId)) {
      preservedIds.add(rawId);
      keptIndices.add(i);
    }
  }

  const nextId = createSimpleIdGenerator(Array.from(preservedIds), prefix);
  const map = new Map<string, string>();
  const normalized = arr.map((item, idx) => {
    if (!item || typeof item !== 'object') return item;
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    if (keptIndices.has(idx)) {
      return rawId === item.id ? item : { ...item, id: rawId };
    }
    const newId = nextId();
    if (rawId && !map.has(rawId)) {
      map.set(rawId, newId);
    }
    return { ...item, id: newId };
  });

  return { map, changed: true, normalized };
}

function remapVal(val: string | undefined, map: Map<string, string>): string | undefined {
  if (!val || map.size === 0) return val;
  return map.get(val) ?? val;
}

function remapList(list: string[] | undefined, map: Map<string, string>): string[] | undefined {
  if (!Array.isArray(list) || map.size === 0) return list;
  let changed = false;
  const next = list.map((id) => {
    const mapped = map.get(id);
    if (mapped && mapped !== id) {
      changed = true;
      return mapped;
    }
    return id;
  });
  return changed ? next : list;
}

/**
 * Lossless, idempotent migration pass:
 * 1. Backfills missing `periodId` on legacy isolated records using the first/selected period so NO existing data is lost.
 * 2. Rebuilds any legacy/complex primary keys (`Date.now()`, random hashes, old formats) to clean `prefix-N` IDs.
 * 3. Atomically updates EVERY foreign-key reference across the entire database so zero links ever break.
 */
export function migrateLegacyKeysAndPeriodIsolation(db: AppDatabase): {
  db: AppDatabase;
  migrated: boolean;
} {
  let working: any = { ...db };
  let migrated = false;

  // ------------------------------------------------------------------
  // STEP 1: Ensure every isolated record has an explicit periodId
  // ------------------------------------------------------------------
  const periods: Period[] = Array.isArray(working.periods) ? working.periods : [];
  const fallbackPeriodId = working.selectedPeriodId || periods[0]?.id || 'p-1';

  // Map chequeBookId -> periodId before backfilling chequeLeaves
  const chequeBookPeriodById = new Map<string, string>();
  if (Array.isArray(working.chequeBooks)) {
    for (const cb of working.chequeBooks) {
      if (cb?.id) {
        chequeBookPeriodById.set(cb.id, cb.periodId || fallbackPeriodId);
      }
    }
  }

  for (const key of ISOLATED_ARRAY_COLLECTIONS) {
    const arr = working[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    let needsPeriodBackfill = false;
    for (let i = 0; i < arr.length; i++) {
      const rec = arr[i];
      if (rec && typeof rec === 'object' && (!rec.periodId || !String(rec.periodId).trim())) {
        needsPeriodBackfill = true;
        break;
      }
    }
    if (needsPeriodBackfill) {
      migrated = true;
      working[key] = arr.map((rec: any) => {
        if (!rec || typeof rec !== 'object') return rec;
        if (rec.periodId && String(rec.periodId).trim()) return rec;
        let inferredPeriodId = fallbackPeriodId;
        if (key === 'chequeLeaves' && rec.chequeBookId) {
          inferredPeriodId = chequeBookPeriodById.get(rec.chequeBookId) || fallbackPeriodId;
        }
        return { ...rec, periodId: inferredPeriodId };
      });
    }
  }

  // Backfill period-scoped singleton settings into period maps once (without duplicating across new periods)
  if (!working.payrollCalculationRulesByPeriod && working.payrollCalculationRules) {
    migrated = true;
    working.payrollCalculationRulesByPeriod = {
      [fallbackPeriodId]: working.payrollCalculationRules,
    };
  }
  if (!working.barcodeSettingsByPeriod && working.barcodeSettings) {
    migrated = true;
    working.barcodeSettingsByPeriod = {
      [fallbackPeriodId]: working.barcodeSettings,
    };
  }
  if (!working.productionPlanningSettingsByPeriod && working.productionPlanningSettings) {
    migrated = true;
    const ps = working.productionPlanningSettings;
    const psPeriodId = ps.periodId || fallbackPeriodId;
    working.productionPlanningSettingsByPeriod = {
      [psPeriodId]: { ...ps, periodId: psPeriodId },
    };
  }
  if (
    !working.personnelCapabilitiesByPeriod &&
    working.personnelCapabilities &&
    typeof working.personnelCapabilities === 'object' &&
    Object.keys(working.personnelCapabilities).length > 0
  ) {
    migrated = true;
    working.personnelCapabilitiesByPeriod = {
      [fallbackPeriodId]: working.personnelCapabilities,
    };
  }

  // ------------------------------------------------------------------
  // STEP 2: Build complete oldId -> simpleId maps for all collections
  // ------------------------------------------------------------------
  const collectionsToMigrate: Array<keyof AppDatabase> = [
    'periods',
    'roles',
    'users',
    ...ISOLATED_ARRAY_COLLECTIONS,
  ];

  const maps = new Map<string, Map<string, string>>();
  let anyIdChanged = false;

  for (const key of collectionsToMigrate) {
    const arr = working[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const prefix = getPrefixForCollection(key);
    const { map, changed, normalized } = buildCollectionIdMap(arr, prefix);
    if (changed) {
      anyIdChanged = true;
      migrated = true;
      working[key] = normalized;
    }
    if (map.size > 0) {
      maps.set(String(key), map);
    }
  }

  // Also simplify nested IDs inside barcodeSettingsByPeriod / productionPlanningSettingsByPeriod
  if (working.barcodeSettingsByPeriod && typeof working.barcodeSettingsByPeriod === 'object') {
    const nextBarcodeMap: Record<string, BarcodeSettings> = {};
    let barcodeChanged = false;
    for (const [pid, cfg] of Object.entries(working.barcodeSettingsByPeriod as Record<string, BarcodeSettings>)) {
      if (cfg && Array.isArray(cfg.profiles)) {
        const res = buildCollectionIdMap(cfg.profiles, COLLECTION_ID_PREFIXES.barcodeProfiles);
        if (res.changed) {
          barcodeChanged = true;
          nextBarcodeMap[pid] = { ...cfg, profiles: res.normalized };
        } else {
          nextBarcodeMap[pid] = cfg;
        }
      } else {
        nextBarcodeMap[pid] = cfg;
      }
    }
    if (barcodeChanged) {
      migrated = true;
      working.barcodeSettingsByPeriod = nextBarcodeMap;
    }
  }

  // ------------------------------------------------------------------
  // STEP 3: Rewrite ALL foreign-key references atomically
  // ------------------------------------------------------------------
  if (anyIdChanged) {
    const getMap = (k: keyof AppDatabase): Map<string, string> => maps.get(String(k)) || new Map();

    const periodMap = getMap('periods');
    const userMap = getMap('users');
    const itemCatMap = getMap('itemCategories');
    const warehouseMap = getMap('warehouses');
    const itemMap = getMap('items');
    const auditMap = getMap('stockCountAudits');
    const supplierMap = getMap('suppliers');
    const custCatMap = getMap('customerCategories');
    const customerMap = getMap('customers');
    const deptMap = getMap('departments');
    const prodCatMap = getMap('productCategories');
    const productMap = getMap('products');
    const salesPeriodMap = getMap('salesPeriods');
    const procOrderMap = getMap('procurementOrders');
    const bankMap = getMap('bankAccounts');
    const cashDrawerMap = getMap('cashDrawers');
    const posMap = getMap('posTerminals');
    const cashierMap = getMap('cashiers');
    const chequeBookMap = getMap('chequeBooks');
    const chequeLeafMap = getMap('chequeLeaves');
    const receiptMap = getMap('treasuryReceipts');
    const paymentMap = getMap('treasuryPayments');
    const persCatMap = getMap('personnelCategories');
    const personnelMap = getMap('personnel');
    const contractMap = getMap('personnelContracts');
    const payrollPeriodMap = getMap('payrollPeriods');
    const shiftMap = getMap('shifts');
    const sectionMap = getMap('productionSections');

    // 3.1 Remap periodId across EVERY isolated collection & selectedPeriodId & period maps
    if (periodMap.size > 0) {
      if (working.selectedPeriodId) {
        working.selectedPeriodId = remapVal(working.selectedPeriodId, periodMap);
      }

      for (const key of ISOLATED_ARRAY_COLLECTIONS) {
        const arr = working[key];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        working[key] = arr.map((rec: any) => {
          if (!rec || typeof rec !== 'object' || !rec.periodId) return rec;
          const mappedPid = periodMap.get(rec.periodId);
          return mappedPid && mappedPid !== rec.periodId ? { ...rec, periodId: mappedPid } : rec;
        });
      }

      const remapPeriodDict = <T,>(dict?: Record<string, T>): Record<string, T> | undefined => {
        if (!dict || typeof dict !== 'object') return dict;
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(dict)) {
          const mappedK = periodMap.get(k) || k;
          if (v && typeof v === 'object' && 'periodId' in (v as any)) {
            out[mappedK] = { ...(v as any), periodId: mappedK };
          } else {
            out[mappedK] = v;
          }
        }
        return out;
      };

      working.payrollCalculationRulesByPeriod = remapPeriodDict(working.payrollCalculationRulesByPeriod);
      working.barcodeSettingsByPeriod = remapPeriodDict(working.barcodeSettingsByPeriod);
      working.productionPlanningSettingsByPeriod = remapPeriodDict(working.productionPlanningSettingsByPeriod);
      working.personnelCapabilitiesByPeriod = remapPeriodDict(working.personnelCapabilitiesByPeriod);

      if (working.productionPlanningSettings?.periodId) {
        working.productionPlanningSettings = {
          ...working.productionPlanningSettings,
          periodId: remapVal(working.productionPlanningSettings.periodId, periodMap),
        };
      }

      if (working.payrollManualOverrides && typeof working.payrollManualOverrides === 'object') {
        const nextOverrides: Record<string, any> = {};
        for (const [k, v] of Object.entries(working.payrollManualOverrides)) {
          let newKey = k;
          for (const [oldPid, newPid] of periodMap.entries()) {
            if (k === oldPid) {
              newKey = newPid;
              break;
            }
            if (k.startsWith(`${oldPid}_`)) {
              newKey = `${newPid}_${k.slice(oldPid.length + 1)}`;
              break;
            }
            if (k.startsWith(`${oldPid}-`)) {
              newKey = `${newPid}-${k.slice(oldPid.length + 1)}`;
              break;
            }
          }
          nextOverrides[newKey] = v;
        }
        working.payrollManualOverrides = nextOverrides;
      }

      if (working.digitalMenu?.periodId) {
        working.digitalMenu = {
          ...working.digitalMenu,
          periodId: remapVal(working.digitalMenu.periodId, periodMap),
        };
      }
    }

    // 3.2 currentUser
    if (userMap.size > 0 && working.currentUser?.id) {
      working.currentUser = {
        ...working.currentUser,
        id: remapVal(working.currentUser.id, userMap),
      };
    }

    // 3.3 items -> categoryId, warehouse
    if ((itemCatMap.size > 0 || warehouseMap.size > 0) && Array.isArray(working.items)) {
      working.items = working.items.map((item: any) => ({
        ...item,
        categoryId: remapVal(item.categoryId, itemCatMap) || item.categoryId,
        warehouse: item.warehouse ? remapVal(item.warehouse, warehouseMap) : item.warehouse,
      }));
    }

    // 3.4 suppliers -> suppliedItemIds
    if (itemMap.size > 0 && Array.isArray(working.suppliers)) {
      working.suppliers = working.suppliers.map((sup: any) => ({
        ...sup,
        suppliedItemIds: remapList(sup.suppliedItemIds, itemMap) || sup.suppliedItemIds,
      }));
    }

    // 3.5 purchaseInvoices -> supplierId, items[].itemId
    if ((supplierMap.size > 0 || itemMap.size > 0) && Array.isArray(working.purchaseInvoices)) {
      working.purchaseInvoices = working.purchaseInvoices.map((inv: any) => ({
        ...inv,
        supplierId: remapVal(inv.supplierId, supplierMap) || inv.supplierId,
        items: Array.isArray(inv.items)
          ? inv.items.map((line: any) => ({
              ...line,
              itemId: remapVal(line.itemId, itemMap) || line.itemId,
            }))
          : inv.items,
      }));
    }

    // 3.6 stockCounts -> auditId, itemId, warehouse
    if ((auditMap.size > 0 || itemMap.size > 0 || warehouseMap.size > 0) && Array.isArray(working.stockCounts)) {
      working.stockCounts = working.stockCounts.map((sc: any) => ({
        ...sc,
        auditId: remapVal(sc.auditId, auditMap) || sc.auditId,
        itemId: remapVal(sc.itemId, itemMap) || sc.itemId,
        warehouse: sc.warehouse ? remapVal(sc.warehouse, warehouseMap) : sc.warehouse,
      }));
    }

    // 3.7 productCategories -> departmentId
    if (deptMap.size > 0 && Array.isArray(working.productCategories)) {
      working.productCategories = working.productCategories.map((pc: any) => ({
        ...pc,
        departmentId: pc.departmentId ? remapVal(pc.departmentId, deptMap) : pc.departmentId,
      }));
    }

    // 3.8 products -> categoryId
    if (prodCatMap.size > 0 && Array.isArray(working.products)) {
      working.products = working.products.map((p: any) => ({
        ...p,
        categoryId: remapVal(p.categoryId, prodCatMap) || p.categoryId,
      }));
    }

    // 3.9 productSales -> salesPeriodId, productId
    if ((salesPeriodMap.size > 0 || productMap.size > 0) && Array.isArray(working.productSales)) {
      working.productSales = working.productSales.map((ps: any) => ({
        ...ps,
        salesPeriodId: remapVal(ps.salesPeriodId, salesPeriodMap) || ps.salesPeriodId,
        productId: remapVal(ps.productId, productMap) || ps.productId,
      }));
    }

    // 3.10 salesTransactions -> productId, categoryId
    if ((productMap.size > 0 || prodCatMap.size > 0) && Array.isArray(working.salesTransactions)) {
      working.salesTransactions = working.salesTransactions.map((tx: any) => ({
        ...tx,
        productId: tx.productId ? remapVal(tx.productId, productMap) : tx.productId,
        categoryId: tx.categoryId ? remapVal(tx.categoryId, prodCatMap) : tx.categoryId,
      }));
    }

    // 3.11 unitConversions -> rawMaterialId
    if (itemMap.size > 0 && Array.isArray(working.unitConversions)) {
      working.unitConversions = working.unitConversions.map((uc: any) => ({
        ...uc,
        rawMaterialId: remapVal(uc.rawMaterialId, itemMap) || uc.rawMaterialId,
      }));
    }

    // 3.12 productFormulas -> productId (only if storing old ID rather than accountId), ingredients[].rawMaterialId
    if ((productMap.size > 0 || itemMap.size > 0) && Array.isArray(working.productFormulas)) {
      working.productFormulas = working.productFormulas.map((f: any) => ({
        ...f,
        productId: productMap.get(f.productId) || f.productId,
        ingredients: Array.isArray(f.ingredients)
          ? f.ingredients.map((ing: any) => ({
              ...ing,
              rawMaterialId:
                itemMap.get(ing.rawMaterialId) ||
                productMap.get(ing.rawMaterialId) ||
                ing.rawMaterialId,
            }))
          : f.ingredients,
      }));
    }

    // 3.13 dailyProductionSegments -> productId
    if (productMap.size > 0 && Array.isArray(working.dailyProductionSegments)) {
      working.dailyProductionSegments = working.dailyProductionSegments.map((seg: any) => ({
        ...seg,
        productId: remapVal(seg.productId, productMap) || seg.productId,
      }));
    }

    // 3.14 productionPlanningSettings & orders -> productId
    if (productMap.size > 0) {
      const remapProdSettings = (ps: any) => {
        if (!ps || !Array.isArray(ps.productAssignments)) return ps;
        return {
          ...ps,
          productAssignments: ps.productAssignments.map((pa: any) => ({
            ...pa,
            productId: remapVal(pa.productId, productMap) || pa.productId,
          })),
        };
      };
      if (working.productionPlanningSettings) {
        working.productionPlanningSettings = remapProdSettings(working.productionPlanningSettings);
      }
      if (working.productionPlanningSettingsByPeriod) {
        const nextMap: Record<string, any> = {};
        for (const [k, v] of Object.entries(working.productionPlanningSettingsByPeriod)) {
          nextMap[k] = remapProdSettings(v);
        }
        working.productionPlanningSettingsByPeriod = nextMap;
      }
      if (Array.isArray(working.productionPlanningOrders)) {
        working.productionPlanningOrders = working.productionPlanningOrders.map((ord: any) => ({
          ...ord,
          items: Array.isArray(ord.items)
            ? ord.items.map((it: any) => ({
                ...it,
                productId: remapVal(it.productId, productMap) || it.productId,
              }))
            : ord.items,
        }));
      }
    }

    // 3.15 procurementOrders -> supplierId, items[].rawMaterialId/productId/supplierId/carriedOver*
    if (
      (supplierMap.size > 0 || itemMap.size > 0 || productMap.size > 0 || procOrderMap.size > 0) &&
      Array.isArray(working.procurementOrders)
    ) {
      working.procurementOrders = working.procurementOrders.map((ord: any) => ({
        ...ord,
        supplierId: ord.supplierId ? remapVal(ord.supplierId, supplierMap) : ord.supplierId,
        items: Array.isArray(ord.items)
          ? ord.items.map((line: any) => ({
              ...line,
              rawMaterialId: line.rawMaterialId ? remapVal(line.rawMaterialId, itemMap) : line.rawMaterialId,
              productId: line.productId ? remapVal(line.productId, productMap) : line.productId,
              supplierId: line.supplierId ? remapVal(line.supplierId, supplierMap) : line.supplierId,
              carriedOverFromOrderId: line.carriedOverFromOrderId
                ? remapVal(line.carriedOverFromOrderId, procOrderMap)
                : line.carriedOverFromOrderId,
              carriedOverToOrderId: line.carriedOverToOrderId
                ? remapVal(line.carriedOverToOrderId, procOrderMap)
                : line.carriedOverToOrderId,
            }))
          : ord.items,
      }));
    }

    // 3.16 customers -> categoryId, preferredProductIds
    if ((custCatMap.size > 0 || productMap.size > 0) && Array.isArray(working.customers)) {
      working.customers = working.customers.map((c: any) => ({
        ...c,
        categoryId: c.categoryId ? remapVal(c.categoryId, custCatMap) : c.categoryId,
        preferredProductIds: remapList(c.preferredProductIds, productMap),
      }));
    }

    // 3.17 customerProductionOrders -> customerId, customerCategoryId, treasuryReceiptId, items[].productId/departmentId
    if (
      (customerMap.size > 0 ||
        custCatMap.size > 0 ||
        receiptMap.size > 0 ||
        productMap.size > 0 ||
        deptMap.size > 0) &&
      Array.isArray(working.customerProductionOrders)
    ) {
      working.customerProductionOrders = working.customerProductionOrders.map((o: any) => ({
        ...o,
        customerId: o.customerId ? remapVal(o.customerId, customerMap) : o.customerId,
        customerCategoryId: o.customerCategoryId ? remapVal(o.customerCategoryId, custCatMap) : o.customerCategoryId,
        treasuryReceiptId: o.treasuryReceiptId ? remapVal(o.treasuryReceiptId, receiptMap) : o.treasuryReceiptId,
        items: Array.isArray(o.items)
          ? o.items.map((it: any) => ({
              ...it,
              productId: it.productId ? remapVal(it.productId, productMap) : it.productId,
              departmentId: it.departmentId ? remapVal(it.departmentId, deptMap) : it.departmentId,
            }))
          : o.items,
      }));
    }

    // 3.18 Treasury entities cross-links
    if (posMap.size > 0 && Array.isArray(working.bankAccounts)) {
      working.bankAccounts = working.bankAccounts.map((b: any) => ({
        ...b,
        posTerminalIds: remapList(b.posTerminalIds, posMap),
      }));
    }
    if (cashierMap.size > 0 && Array.isArray(working.cashDrawers)) {
      working.cashDrawers = working.cashDrawers.map((cd: any) => ({
        ...cd,
        cashierId: cd.cashierId ? remapVal(cd.cashierId, cashierMap) : cd.cashierId,
      }));
    }
    if ((bankMap.size > 0 || cashDrawerMap.size > 0) && Array.isArray(working.posTerminals)) {
      working.posTerminals = working.posTerminals.map((pt: any) => ({
        ...pt,
        bankAccountId: remapVal(pt.bankAccountId, bankMap) || pt.bankAccountId,
        cashDrawerId: pt.cashDrawerId ? remapVal(pt.cashDrawerId, cashDrawerMap) : pt.cashDrawerId,
      }));
    }
    if (cashDrawerMap.size > 0 && Array.isArray(working.cashiers)) {
      working.cashiers = working.cashiers.map((c: any) => ({
        ...c,
        defaultCashDrawerId: c.defaultCashDrawerId
          ? remapVal(c.defaultCashDrawerId, cashDrawerMap)
          : c.defaultCashDrawerId,
      }));
    }
    if (bankMap.size > 0 && Array.isArray(working.chequeBooks)) {
      working.chequeBooks = working.chequeBooks.map((cb: any) => ({
        ...cb,
        bankAccountId: remapVal(cb.bankAccountId, bankMap) || cb.bankAccountId,
      }));
    }
    if (
      (chequeBookMap.size > 0 || bankMap.size > 0 || paymentMap.size > 0 || supplierMap.size > 0 || personnelMap.size > 0) &&
      Array.isArray(working.chequeLeaves)
    ) {
      working.chequeLeaves = working.chequeLeaves.map((leaf: any) => ({
        ...leaf,
        chequeBookId: remapVal(leaf.chequeBookId, chequeBookMap) || leaf.chequeBookId,
        bankAccountId: remapVal(leaf.bankAccountId, bankMap) || leaf.bankAccountId,
        paymentId: leaf.paymentId ? remapVal(leaf.paymentId, paymentMap) : leaf.paymentId,
        beneficiaryId:
          leaf.beneficiaryType === 'supplier'
            ? remapVal(leaf.beneficiaryId, supplierMap)
            : leaf.beneficiaryType === 'personnel'
              ? remapVal(leaf.beneficiaryId, personnelMap)
              : leaf.beneficiaryId,
      }));
    }
    if (
      (customerMap.size > 0 ||
        supplierMap.size > 0 ||
        cashDrawerMap.size > 0 ||
        posMap.size > 0 ||
        bankMap.size > 0 ||
        cashierMap.size > 0) &&
      Array.isArray(working.treasuryReceipts)
    ) {
      working.treasuryReceipts = working.treasuryReceipts.map((r: any) => ({
        ...r,
        counterpartyId:
          r.counterpartyType === 'customer'
            ? remapVal(r.counterpartyId, customerMap)
            : r.counterpartyType === 'supplier'
              ? remapVal(r.counterpartyId, supplierMap)
              : r.counterpartyId,
        cashDrawerId: r.cashDrawerId ? remapVal(r.cashDrawerId, cashDrawerMap) : r.cashDrawerId,
        posTerminalId: r.posTerminalId ? remapVal(r.posTerminalId, posMap) : r.posTerminalId,
        bankAccountId: r.bankAccountId ? remapVal(r.bankAccountId, bankMap) : r.bankAccountId,
        cashierId: r.cashierId ? remapVal(r.cashierId, cashierMap) : r.cashierId,
      }));
    }
    if (
      (supplierMap.size > 0 ||
        customerMap.size > 0 ||
        personnelMap.size > 0 ||
        cashDrawerMap.size > 0 ||
        bankMap.size > 0 ||
        cashierMap.size > 0 ||
        chequeBookMap.size > 0 ||
        chequeLeafMap.size > 0) &&
      Array.isArray(working.treasuryPayments)
    ) {
      working.treasuryPayments = working.treasuryPayments.map((p: any) => ({
        ...p,
        beneficiaryId:
          p.beneficiaryType === 'supplier'
            ? remapVal(p.beneficiaryId, supplierMap)
            : p.beneficiaryType === 'customer'
              ? remapVal(p.beneficiaryId, customerMap)
              : p.beneficiaryType === 'personnel'
                ? remapVal(p.beneficiaryId, personnelMap)
                : p.beneficiaryId,
        cashDrawerId: p.cashDrawerId ? remapVal(p.cashDrawerId, cashDrawerMap) : p.cashDrawerId,
        bankAccountId: p.bankAccountId ? remapVal(p.bankAccountId, bankMap) : p.bankAccountId,
        cashierId: p.cashierId ? remapVal(p.cashierId, cashierMap) : p.cashierId,
        chequeDetails: p.chequeDetails
          ? {
              ...p.chequeDetails,
              chequeBookId: p.chequeDetails.chequeBookId
                ? remapVal(p.chequeDetails.chequeBookId, chequeBookMap)
                : p.chequeDetails.chequeBookId,
              chequeLeafId: p.chequeDetails.chequeLeafId
                ? remapVal(p.chequeDetails.chequeLeafId, chequeLeafMap)
                : p.chequeDetails.chequeLeafId,
            }
          : p.chequeDetails,
      }));
    }
    if ((customerMap.size > 0 || supplierMap.size > 0) && Array.isArray(working.barterTransactions)) {
      working.barterTransactions = working.barterTransactions.map((b: any) => ({
        ...b,
        partyAId:
          b.partyAType === 'customer'
            ? remapVal(b.partyAId, customerMap)
            : b.partyAType === 'supplier'
              ? remapVal(b.partyAId, supplierMap)
              : b.partyAId,
        partyBId:
          b.partyBType === 'customer'
            ? remapVal(b.partyBId, customerMap)
            : b.partyBType === 'supplier'
              ? remapVal(b.partyBId, supplierMap)
              : b.partyBId,
      }));
    }
    if (
      (customerMap.size > 0 || supplierMap.size > 0 || bankMap.size > 0 || cashDrawerMap.size > 0 || posMap.size > 0) &&
      Array.isArray(working.counterpartySettlements)
    ) {
      working.counterpartySettlements = working.counterpartySettlements.map((s: any) => ({
        ...s,
        partyId:
          s.partyType === 'customer'
            ? remapVal(s.partyId, customerMap) || s.partyId
            : remapVal(s.partyId, supplierMap) || s.partyId,
        bankAccountId: s.bankAccountId ? remapVal(s.bankAccountId, bankMap) : s.bankAccountId,
        cashDrawerId: s.cashDrawerId ? remapVal(s.cashDrawerId, cashDrawerMap) : s.cashDrawerId,
        posTerminalId: s.posTerminalId ? remapVal(s.posTerminalId, posMap) : s.posTerminalId,
      }));
    }
    if (
      (cashierMap.size > 0 || cashDrawerMap.size > 0 || bankMap.size > 0) &&
      Array.isArray(working.cashierShiftCloseouts)
    ) {
      working.cashierShiftCloseouts = working.cashierShiftCloseouts.map((c: any) => ({
        ...c,
        cashierId: remapVal(c.cashierId, cashierMap) || c.cashierId,
        cashDrawerId: remapVal(c.cashDrawerId, cashDrawerMap) || c.cashDrawerId,
        bankAccountId: c.bankAccountId ? remapVal(c.bankAccountId, bankMap) : c.bankAccountId,
      }));
    }

    // 3.19 Personnel, Payroll, Attendance, Shifts & Sections
    if ((persCatMap.size > 0 || shiftMap.size > 0 || sectionMap.size > 0) && Array.isArray(working.personnel)) {
      working.personnel = working.personnel.map((emp: any) => ({
        ...emp,
        personnelCategoryId: emp.personnelCategoryId
          ? remapVal(emp.personnelCategoryId, persCatMap)
          : emp.personnelCategoryId,
        fixedShiftId: emp.fixedShiftId ? remapVal(emp.fixedShiftId, shiftMap) : emp.fixedShiftId,
        capabilities: remapList(emp.capabilities, sectionMap),
      }));
    }
    if (payrollPeriodMap.size > 0 && Array.isArray(working.payrollItems)) {
      working.payrollItems = working.payrollItems.map((pi: any) => ({
        ...pi,
        payrollPeriodId: pi.payrollPeriodId ? remapVal(pi.payrollPeriodId, payrollPeriodMap) : pi.payrollPeriodId,
      }));
    }
    if ((deptMap.size > 0 || prodCatMap.size > 0) && Array.isArray(working.personnelAllocations)) {
      working.personnelAllocations = working.personnelAllocations.map((a: any) => ({
        ...a,
        departmentCategoryId:
          deptMap.get(a.departmentCategoryId) ||
          prodCatMap.get(a.departmentCategoryId) ||
          a.departmentCategoryId,
      }));
    }
    if (deptMap.size > 0 && Array.isArray(working.productionSections)) {
      working.productionSections = working.productionSections.map((sec: any) => ({
        ...sec,
        departmentCategoryId: sec.departmentCategoryId
          ? remapVal(sec.departmentCategoryId, deptMap)
          : sec.departmentCategoryId,
      }));
    }
    if ((shiftMap.size > 0 || sectionMap.size > 0 || personnelMap.size > 0) && Array.isArray(working.shiftAssignments)) {
      working.shiftAssignments = working.shiftAssignments.map((sa: any) => ({
        ...sa,
        shiftId: remapVal(sa.shiftId, shiftMap) || sa.shiftId,
        deptId: remapVal(sa.deptId, sectionMap) || sa.deptId,
        employeeId: sa.employeeId ? remapVal(sa.employeeId, personnelMap) : sa.employeeId,
      }));
    }
    if ((personnelMap.size > 0 || shiftMap.size > 0 || sectionMap.size > 0) && Array.isArray(working.attendanceRecords)) {
      working.attendanceRecords = working.attendanceRecords.map((att: any) => ({
        ...att,
        employeeId: att.employeeId ? remapVal(att.employeeId, personnelMap) : att.employeeId,
        shiftId: att.shiftId
          ? shiftMap.get(att.shiftId) || sectionMap.get(att.shiftId) || att.shiftId
          : att.shiftId,
      }));
    }
    if (contractMap.size > 0 && Array.isArray(working.personnelSettlements)) {
      working.personnelSettlements = working.personnelSettlements.map((stl: any) => ({
        ...stl,
        contractId: stl.contractId ? remapVal(stl.contractId, contractMap) : stl.contractId,
      }));
    }
    if (sectionMap.size > 0) {
      const remapCapMap = (capMap?: Record<string, string[]>) => {
        if (!capMap || typeof capMap !== 'object') return capMap;
        const out: Record<string, string[]> = {};
        for (const [k, list] of Object.entries(capMap)) {
          out[k] = remapList(list, sectionMap) || [];
        }
        return out;
      };
      if (working.personnelCapabilities) {
        working.personnelCapabilities = remapCapMap(working.personnelCapabilities);
      }
      if (working.personnelCapabilitiesByPeriod) {
        const nextByP: Record<string, Record<string, string[]>> = {};
        for (const [pid, capMap] of Object.entries(working.personnelCapabilitiesByPeriod as Record<string, Record<string, string[]>>)) {
          nextByP[pid] = remapCapMap(capMap) || {};
        }
        working.personnelCapabilitiesByPeriod = nextByP;
      }
    }

    // 3.20 Dibal PLUs -> productId, itemId
    if ((productMap.size > 0 || itemMap.size > 0) && Array.isArray(working.dibalPLUs)) {
      working.dibalPLUs = working.dibalPLUs.map((plu: any) => ({
        ...plu,
        productId: plu.productId ? remapVal(plu.productId, productMap) : plu.productId,
        itemId: plu.itemId ? remapVal(plu.itemId, itemMap) : plu.itemId,
      }));
    }

    // 3.21 Digital menu categorySettings & productSettings keys
    if (working.digitalMenu && (prodCatMap.size > 0 || productMap.size > 0)) {
      const dm = { ...working.digitalMenu };
      if (prodCatMap.size > 0 && dm.categorySettings && typeof dm.categorySettings === 'object') {
        const nextCatSettings: Record<string, any> = {};
        for (const [k, v] of Object.entries(dm.categorySettings)) {
          nextCatSettings[prodCatMap.get(k) || k] = v;
        }
        dm.categorySettings = nextCatSettings;
      }
      if (productMap.size > 0 && dm.productSettings && typeof dm.productSettings === 'object') {
        const nextProdSettings: Record<string, any> = {};
        for (const [k, v] of Object.entries(dm.productSettings)) {
          const mapped = productMap.get(k) || k;
          nextProdSettings[mapped] = v;
        }
        dm.productSettings = nextProdSettings;
      }
      working.digitalMenu = dm;
    }
  }

  return { db: working as AppDatabase, migrated };
}
