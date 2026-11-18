/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SystemTabId =
  | 'items'
  | 'suppliers'
  | 'customers'
  | 'sales'
  | 'cogs'
  | 'production_planning'
  | 'procurement'
  | 'treasury'
  | 'payroll'
  | 'expenses'
  | 'dibal_scale'
  | 'cloud_sync';

export interface SystemTabDefinition {
  id: SystemTabId;
  label: string;
}

export const SYSTEM_TABS: SystemTabDefinition[] = [
  { id: 'items', label: 'مدیریت کالا و انبارگردانی' },
  { id: 'suppliers', label: 'تامین کنندگان' },
  { id: 'customers', label: 'مشتریان' },
  { id: 'sales', label: 'فروش' },
  { id: 'cogs', label: 'بهای قیمت تمام شده (COGS)' },
  { id: 'production_planning', label: 'برنامه‌ریزی تولید و سفارشات' },
  { id: 'procurement', label: 'سفارش کالا' },
  { id: 'treasury', label: 'وجوه نقد و بانک (خزانه)' },
  { id: 'payroll', label: 'حقوق و دستمزد' },
  { id: 'expenses', label: 'هزینه‌ها و مخارج سربار' },
  { id: 'dibal_scale', label: 'مدیریت ترازوی دیبال (Dibal M-525)' },
  { id: 'cloud_sync', label: 'دیتابیس، کاربران و سرور (PostgreSQL)' },
];

export interface AuthUserLike {
  id?: string;
  username?: string;
  fullName?: string;
  name?: string;
  role?: string;
  permissions?: string[];
  is2FA?: boolean;
  isActive?: boolean;
}

export function normalizePermissions(permissions?: string[] | null): string[] {
  if (!Array.isArray(permissions)) return [];
  const mapped = new Set<string>();
  for (const raw of permissions) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (p === 'orders') {
      mapped.add('procurement');
    } else {
      mapped.add(p);
    }
  }
  return Array.from(mapped);
}

export function isAdminUser(user?: AuthUserLike | null): boolean {
  if (!user) return false;
  const perms = normalizePermissions(user.permissions);
  return user.role === 'مدیر ارشد' || perms.includes('*');
}

export function canAccessTab(user: AuthUserLike | null | undefined, tabId: SystemTabId): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  const perms = normalizePermissions(user.permissions);
  return perms.includes(tabId);
}

export function getFirstAllowedTab(user: AuthUserLike | null | undefined): SystemTabId {
  if (!user) return 'items';
  for (const tab of SYSTEM_TABS) {
    if (canAccessTab(user, tab.id)) {
      return tab.id;
    }
  }
  return 'items';
}

/**
 * Keys in AppDatabase that belong purely to client UI state and must NOT overwrite shared server state.
 */
export const CLIENT_ONLY_DB_KEYS = new Set<string>([
  'currentUser',
  'selectedPeriodId',
  'syncStatus',
  'lastSyncTime',
]);

/**
 * Maps each AppDatabase collection key to which module tab permissions allow writing it.
 * '*' means admin only. 'ANY_AUTH' means any authenticated user (e.g. non-destructive UI prefs).
 */
export const COLLECTION_WRITE_PERMISSIONS: Record<string, string[]> = {
  // Admin-only collections
  periods: ['*'],
  users: ['*'],
  googleSheetsUrl: ['*'],
  sqlServerConfig: ['*'],

  // Inventory & Warehouse
  itemCategories: ['items', 'cogs', 'procurement'],
  items: ['items', 'cogs', 'procurement', 'production_planning'],
  warehouses: ['items'],
  stockCountAudits: ['items'],
  stockCounts: ['items'],
  purchaseInvoices: ['items', 'procurement', 'suppliers', 'treasury'],
  unitsOfMeasurement: ['items', 'cogs'],
  packagingTypes: ['items', 'cogs'],

  // Suppliers
  suppliers: ['suppliers', 'procurement', 'items', 'treasury'],

  // Customers
  customerCategories: ['customers', 'sales', 'treasury'],
  customers: ['customers', 'sales', 'treasury'],

  // Sales & Barcode
  salesPeriods: ['sales', 'cogs'],
  productSales: ['sales', 'cogs'],
  salesTransactions: ['sales', 'treasury'],
  barcodeSettings: ['sales', 'items', 'dibal_scale'],

  // Products, COGS & Formulas
  productCategories: ['cogs', 'items', 'sales', 'production_planning'],
  departments: ['cogs', 'payroll'],
  products: ['cogs', 'items', 'sales', 'production_planning', 'dibal_scale'],
  unitConversions: ['cogs', 'items'],
  productFormulas: ['cogs'],
  periodOverheads: ['cogs', 'expenses'],
  personnelAllocations: ['cogs', 'payroll', 'expenses'],

  // Production Planning
  dailyProductionSegments: ['production_planning', 'cogs'],
  productionPlanningSettings: ['production_planning'],
  productionPlanningOrders: ['production_planning'],

  // Procurement
  procurementOrders: ['procurement', 'items'],

  // Treasury
  bankAccounts: ['treasury', 'payroll'],
  cashDrawers: ['treasury', 'sales'],
  posTerminals: ['treasury', 'sales'],
  cashiers: ['treasury', 'sales'],
  chequeBooks: ['treasury'],
  chequeLeaves: ['treasury'],
  treasuryReceipts: ['treasury'],
  treasuryPayments: ['treasury'],
  barterTransactions: ['treasury'],
  counterpartySettlements: ['treasury'],
  cashierShiftCloseouts: ['treasury', 'sales'],
  customBanks: ['treasury', 'suppliers', 'customers', 'payroll'],

  // Payroll, HR & Attendance
  personnel: ['payroll', 'expenses', 'cogs'],
  payrollPeriods: ['payroll', 'expenses'],
  payrollItems: ['payroll', 'expenses', 'cogs'],
  shifts: ['payroll', 'production_planning'],
  shiftAssignments: ['payroll', 'production_planning'],
  productionSections: ['payroll', 'production_planning'],
  shiftSchemes: ['payroll', 'production_planning'],
  salaryBaseRates: ['payroll'],
  personnelCategories: ['payroll', 'expenses'],
  personnelContracts: ['payroll'],
  seniorityRateRules: ['payroll'],
  insuredSalaryItems: ['payroll'],
  attendanceRecords: ['payroll'],
  monthlyWorkdaySettings: ['payroll'],
  payrollSettings: ['payroll'],
  payrollCalculationRules: ['payroll'],
  officialHolidays: ['payroll'],
  contractTemplateText: ['payroll'],
  contractIntroText: ['payroll'],
  contractEmployerText: ['payroll'],
  contractLocationText: ['payroll'],
  contractHoursText: ['payroll'],
  contractRestText: ['payroll'],
  contractHolidayText: ['payroll'],
  contractPersonnelText: ['payroll'],
  taxExemptions: ['payroll'],
  taxBrackets: ['payroll'],
  taxableSalaryItems: ['payroll'],
  personnelSettlements: ['payroll', 'treasury'],
  personnelCapabilities: ['payroll', 'production_planning'],
  attendanceDeviceConfig: ['payroll'],
  approvedMismatches: ['payroll'],
  payrollManualOverrides: ['payroll'],

  // Dibal Scale
  dibalScales: ['dibal_scale'],
  dibalPLUs: ['dibal_scale'],
  dibalTickets: ['dibal_scale'],
};

export function canWriteCollection(user: AuthUserLike | null | undefined, collectionKey: string): boolean {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (CLIENT_ONLY_DB_KEYS.has(collectionKey)) return false;
  const allowedTabs = COLLECTION_WRITE_PERMISSIONS[collectionKey];
  if (!allowedTabs) {
    // Unknown/future keys default to admin-only for safety
    return false;
  }
  if (allowedTabs.includes('*')) return false;
  const userPerms = normalizePermissions(user.permissions);
  return allowedTabs.some(tab => userPerms.includes(tab));
}
