/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Period, Item, ItemCategory, Supplier, Product, ProductCategory, Department,
  SalesPeriod, ProductSale, UnitConversion, ProductFormula,
  Personnel, PayrollPeriod, PayrollItem, PersonnelAllocation, PeriodOverhead, ProcurementOrder, StockCountAudit, StockCount,
  PurchaseInvoice, ShiftAssignment, AppDatabase, ProductionSection,
  MonthlyWorkdaySetting, PayrollCalculationRules, OfficialHoliday,
  Customer, CustomerCategory, UserRoleDefinition, User, BranchDefinition
} from './types';
import { DEFAULT_USER_ROLES, normalizePermissions } from './shared/rbac';
import {
  DEFAULT_BRANCHES,
  DEFAULT_BRANCH_ID,
  buildSafeBranchDbName,
  normalizeAllowedBranches,
  normalizeBranchSlug,
} from './shared/branches';
import { pushToSqlServer, pullFromSqlServer, testSqlServerConnection } from './services/sqlServerService';
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  deleteBranchFromIndexedDB,
} from './utils/idbStorage';
import {
  getDefaultYearMonthFromPeriod,
  parseShamsiYearMonth,
  normalizeAccountingCode,
  getProductFormulaKey,
  getMaterialFormulaKey
} from './utils/persianUtils';
import {
  ISOLATED_ARRAY_COLLECTIONS,
  DEFAULT_PAYROLL_CALCULATION_RULES,
  createDefaultBarcodeSettings,
  migrateLegacyKeysAndPeriodIsolation,
} from './utils/periodIsolation';
import { createSimpleIdGenerator, getPrefixForCollection } from './utils/simpleId';

const STORAGE_KEY = 'gatan_system_db';
const ACTIVE_BRANCH_STORAGE_KEY = 'gatan_active_branch_id';
const LOCAL_BRANCHES_STORAGE_KEY = 'gatan_local_branches_v1';
const LOCAL_SHARED_AUTH_KEY = 'gatan_local_shared_auth_v1';

let activeBranchIdCache: string = DEFAULT_BRANCH_ID;

export function getActiveBranchId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = (window.localStorage.getItem(ACTIVE_BRANCH_STORAGE_KEY) || '').trim();
      if (saved) {
        activeBranchIdCache = saved;
        return saved;
      }
    }
  } catch {
    // ignore
  }
  return activeBranchIdCache || DEFAULT_BRANCH_ID;
}

export function setActiveBranchId(branchId: string): void {
  const clean = String(branchId || '').trim() || DEFAULT_BRANCH_ID;
  activeBranchIdCache = clean;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ACTIVE_BRANCH_STORAGE_KEY, clean);
    }
  } catch {
    // ignore
  }
}

export function getLocalBranches(): BranchDefinition[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_BRANCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasDefault = parsed.some((b: any) => b && b.id === DEFAULT_BRANCH_ID);
          return hasDefault ? parsed : [DEFAULT_BRANCHES[0], ...parsed];
        }
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_BRANCHES.map((b) => ({ ...b }));
}

export function saveLocalBranches(branches: BranchDefinition[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_BRANCHES_STORAGE_KEY, JSON.stringify(branches));
    }
  } catch {
    // ignore
  }
}

export function createLocalBranch(input: {
  name: string;
  slug?: string;
  dbName?: string;
  address?: string;
  phone?: string;
}): BranchDefinition {
  const cleanName = String(input.name || '').trim();
  if (!cleanName) throw new Error('نام شعبه الزامی است.');
  const current = getLocalBranches();
  let maxNum = 2;
  const usedIds = new Set<string>();
  const usedSlugs = new Set<string>();
  const usedDbNames = new Set<string>();
  for (const b of current) {
    usedIds.add(b.id);
    usedSlugs.add(b.slug);
    usedDbNames.add(b.dbName);
    const m = b.id.match(/^branch-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  let seq = maxNum + 1;
  let newId = `branch-${seq}`;
  while (usedIds.has(newId)) {
    seq++;
    newId = `branch-${seq}`;
  }
  const baseSlug = normalizeBranchSlug(input.slug || '', newId);
  let finalSlug = baseSlug;
  let s = 2;
  while (usedSlugs.has(finalSlug)) finalSlug = `${baseSlug}-${s++}`;
  let finalDbName = String(input.dbName || '').trim().toLowerCase() || buildSafeBranchDbName(seq);
  while (usedDbNames.has(finalDbName)) {
    seq++;
    finalDbName = buildSafeBranchDbName(seq);
  }
  const created: BranchDefinition = {
    id: newId,
    slug: finalSlug,
    name: cleanName,
    dbName: finalDbName,
    isDefault: false,
    isActive: true,
    address: input.address ? String(input.address).trim() : undefined,
    phone: input.phone ? String(input.phone).trim() : undefined,
    createdAt: new Date().toISOString(),
  };
  saveLocalBranches([...current, created]);
  return created;
}

export function updateLocalBranch(
  branchId: string,
  input: { name?: string; address?: string; phone?: string; isActive?: boolean }
): BranchDefinition[] {
  const current = getLocalBranches();
  const next = current.map((b) => {
    if (b.id !== branchId) return b;
    return {
      ...b,
      name: input.name !== undefined ? String(input.name).trim() || b.name : b.name,
      address: input.address !== undefined ? String(input.address).trim() || undefined : b.address,
      phone: input.phone !== undefined ? String(input.phone).trim() || undefined : b.phone,
      isActive: b.isDefault ? true : input.isActive !== undefined ? Boolean(input.isActive) : b.isActive,
    };
  });
  saveLocalBranches(next);
  return next;
}

export async function deleteLocalBranch(branchId: string): Promise<BranchDefinition[]> {
  if (branchId === DEFAULT_BRANCH_ID) {
    throw new Error('شعبه اصلی (مرکزی) قابل حذف نیست.');
  }
  const current = getLocalBranches();
  const next = current.filter((b) => b.id !== branchId);
  saveLocalBranches(next);
  await deleteBranchFromIndexedDB(branchId);
  try {
    window.localStorage.removeItem(`gatan_branch_db_${branchId}`);
  } catch {
    // ignore
  }
  return next;
}

function loadSharedLocalAuth(): { users?: User[]; roles?: UserRoleDefinition[] } | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_SHARED_AUTH_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveSharedLocalAuth(users?: User[], roles?: UserRoleDefinition[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = loadSharedLocalAuth() || {};
      const next = {
        users: Array.isArray(users) && users.length > 0 ? users : existing.users,
        roles: Array.isArray(roles) && roles.length > 0 ? roles : existing.roles,
      };
      window.localStorage.setItem(LOCAL_SHARED_AUTH_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}

export function createBlankBranchDatabase(
  sharedUsers?: User[],
  sharedRoles?: UserRoleDefinition[]
): AppDatabase {
  const base = getInitialDatabase();
  const firstPeriod: Period = {
    id: 'p-1',
    name: 'دوره اول',
    isActive: true,
    startDate: '1405/01/01',
    endDate: '1405/01/31',
    createdAt: new Date().toISOString(),
  };

  const blank: any = {
    ...base,
    periods: [firstPeriod],
    selectedPeriodId: 'p-1',
    roles:
      Array.isArray(sharedRoles) && sharedRoles.length > 0
        ? sharedRoles
        : base.roles,
    users:
      Array.isArray(sharedUsers) && sharedUsers.length > 0
        ? sharedUsers
        : base.users,
    payrollRulesByPeriod: {
      'p-1': { ...DEFAULT_PAYROLL_CALCULATION_RULES },
    },
    barcodeSettingsByPeriod: {
      'p-1': createDefaultBarcodeSettings(),
    },
    digitalMenu: undefined,
  };

  for (const key of ISOLATED_ARRAY_COLLECTIONS) {
    blank[key] = [];
  }
  blank.shiftAssignments = [];
  blank.attendanceLogs = [];
  blank.attendanceDailySummary = [];
  blank.attendanceOverrides = [];
  blank.monthlyWorkdaySettings = [];
  blank.officialHolidays = [];
  blank.productionPlanningOrders = [];
  blank.syncLogs = [];

  return sanitizeAndMergeDatabase(blank);
}

function getBranchLocalStorageKey(branchId?: string): string {
  const clean = String(branchId || '').trim();
  if (!clean || clean === DEFAULT_BRANCH_ID) return STORAGE_KEY;
  return `gatan_branch_db_${clean}`;
}

const DEFAULT_CATEGORIES = ['نان', 'قنادی', 'کافه', 'فینگر فود', 'مشترک'];

export function getInitialDatabase(): AppDatabase {
  const initialPeriods: Period[] = [
    { id: 'p-1', name: 'دوره فروردین ۱۴۰۵', isActive: true, startDate: '1405/01/01', endDate: '1405/01/31', createdAt: '2026-03-21T00:00:00Z' },
    { id: 'p-2', name: 'دوره اردیبهشت ۱۴۰۵', isActive: true, startDate: '1405/02/01', endDate: '1405/02/31', createdAt: '2026-04-21T00:00:00Z' }
  ];

  // Only p-1 receives starter sample data; p-2 starts 100% blank to enforce strict period isolation.
  const defaultItemCategories: ItemCategory[] = DEFAULT_CATEGORIES.map((cat, index) => ({
    id: `icat-${index + 1}`,
    periodId: 'p-1',
    name: cat
  }));

  const defaultDepartments: Department[] = DEFAULT_CATEGORIES.map((cat, index) => ({
    id: `dept-${index + 1}`,
    periodId: 'p-1',
    name: cat,
    isShared: cat === 'مشترک' || index === 4
  }));

  const defaultProductCategories: ProductCategory[] = DEFAULT_CATEGORIES.map((cat, index) => ({
    id: `pcat-${index + 1}`,
    periodId: 'p-1',
    name: cat,
    departmentId: `dept-${index + 1}`
  }));

  // Seeds (all scoped strictly to p-1 with simple sequential IDs)
  const defaultItems: Item[] = [
    {
      id: 'item-1',
      periodId: 'p-1',
      code: 'R-101',
      accountId: '102001',
      name: 'آرد نول قنادی',
      categoryId: 'icat-2', // قنادی
      unit: 'کیلویی',
      barcode: '6261012345678',
      packageType: 'گونی',
      qtyPerPackage: 1,
      weightPerPackage: 40,
      reorderThreshold: 200,
      price: 380000,
      isActive: true
    },
    {
      id: 'item-2',
      periodId: 'p-1',
      code: 'R-102',
      accountId: '102002',
      name: 'شکر سفید دانه‌ریز',
      categoryId: 'icat-5', // مشترک
      unit: 'کیلویی',
      barcode: '6261012345679',
      packageType: 'گونی',
      qtyPerPackage: 1,
      weightPerPackage: 50,
      reorderThreshold: 150,
      price: 420000,
      isActive: true
    },
    {
      id: 'item-3',
      periodId: 'p-1',
      code: 'R-103',
      accountId: '102003',
      name: 'کره مارگارین سوئیسی',
      categoryId: 'icat-2', // قنادی
      unit: 'کیلویی',
      barcode: '6261012345680',
      packageType: 'کارتن',
      qtyPerPackage: 1,
      weightPerPackage: 10,
      reorderThreshold: 100,
      price: 1850000,
      isActive: true
    }
  ];

  const defaultProducts: Product[] = [
    {
      id: 'prod-1',
      periodId: 'p-1',
      code: 'P-501',
      accountId: '201001',
      name: 'کروسان شکلاتی اعلا',
      categoryId: 'pcat-2', // قنادی
      unit: 'عدد',
      barcode: '6262012345001',
      packageType: 'سلفون',
      qtyPerPackage: 1,
      weightPerPackage: 0.12,
      salePrice: 650000,
      cogsPrice: 320000,
      weight: 120
    },
    {
      id: 'prod-2',
      periodId: 'p-1',
      code: 'P-502',
      accountId: '201002',
      name: 'فرانسوی تارت سیب',
      categoryId: 'pcat-2', // قنادی
      unit: 'عدد',
      barcode: '6262012345002',
      packageType: 'شیرینک',
      qtyPerPackage: 6,
      weightPerPackage: 0.8,
      salePrice: 1200000,
      cogsPrice: 580000,
      weight: 150
    }
  ];

  const defaultSuppliers: Supplier[] = [
    {
      id: 'sup-1',
      periodId: 'p-1',
      name: 'تولیدی صنایع غذایی شاهین',
      phone: '۰۲۱۶۶۵۵۴۴۳۳',
      address: 'تهران، شهرک صنعتی بهارستان، خیابان گلستان ۴',
      isActive: true,
      bankAccounts: [
        { bankName: 'بانک ملی', accountNo: '0102030405006', shaba: 'IR890170000000102030405006', cardNo: '۶۰۳۷۹۹۱۸۲۷۳۶۴۵۵۶' },
        { bankName: 'بانک ملت', accountNo: '4567891230', shaba: 'IR450120000000004567891230', cardNo: '۶۱۰۴۳۳۷۹۱۲۳۴۵۶۷۸' }
      ],
      suppliedItemIds: ['item-1', 'item-2']
    }
  ];

  const defaultPersonnel: Personnel[] = [
    {
      id: 'emp-1',
      periodId: 'p-1',
      employeeCode: '1001',
      accountCode: '302001',
      nationalId: '0012345678',
      insuranceCode: '9080706050',
      fatherName: 'احمد',
      birthDate: '1368/05/12',
      birthPlace: 'تهران',
      center: 'کارگاه تولید محصولات قنادی',
      project: 'تولید کروسان',
      complementaryInsurance: true,
      yearsBase: 12000000,
      entryDate: '1401/01/15',
      insuranceDate: '1401/02/01',
      dailyYearsDifference: 500000,
      bankName: 'بانک رفاه',
      bankAccount: '1234567890',
      shaba: 'IR1201300000001234567890',
      cardNo: '۵۸۹۴۶۳۱۱۲۲۳۳۴۴۵۵',
      hasInsurance: true,
      employerPremium3: 3150000,
      employerPremium: 21000000,
      workerPremium: 7350000,
      attractionAllowance: 15000000,
      baseSalaryInsurance: 105000000,
      dailyWage: 3500000,
      isDailyWage: false,
      taxShare: 1200000,
      childrenCount: 2,
      isMarried: true,
      fixedAllowances: 8500000,
      firstName: 'سعید',
      lastName: 'احمدی',
      isActive: true
    }
  ];

  const defaultUsers = [
    { id: 'usr-1', username: 'admin', fullName: 'مدیر کل سامانه گاتان', role: 'مدیر ارشد', password: '123', is2FA: false, secretCode: '123456', permissions: ['*'] },
    { id: 'usr-2', username: 'acc', fullName: 'حسابدار ارشد', role: 'حسابدار', password: '123', is2FA: false, secretCode: '654321', permissions: ['items', 'sales', 'cogs', 'payroll', 'expenses', 'orders'] },
    { id: 'usr-3', username: 'store', fullName: 'کاربر انبار گاتان', role: 'کاربر انبار', password: '123', is2FA: false, secretCode: '111111', permissions: ['items'] }
  ];

  const defaultUnitsOfMeasurement = [
    { id: 'unit-1', periodId: 'p-1', name: 'کیلوگرم', symbol: 'kg', description: 'واحد سنجش وزنی اصلی انبار', isActive: true },
    { id: 'unit-2', periodId: 'p-1', name: 'عدد', symbol: 'pcs', description: 'واحد شمارش عددی محصولات و کالاها', isActive: true },
    { id: 'unit-3', periodId: 'p-1', name: 'لیتر', symbol: 'L', description: 'واحد سنجش حجم مایعات روغن و اسانس', isActive: true },
    { id: 'unit-4', periodId: 'p-1', name: 'بسته', symbol: 'pack', description: 'بسته‌بندی‌های چندتایی و پک', isActive: true },
    { id: 'unit-5', periodId: 'p-1', name: 'گرم', symbol: 'g', description: 'واحد مصرفی جزئی فرمولاسیون تولید', isActive: true },
    { id: 'unit-6', periodId: 'p-1', name: 'متر', symbol: 'm', description: 'طول نایلون و لفاف', isActive: true },
    { id: 'unit-7', periodId: 'p-1', name: 'کارتن', symbol: 'box', description: 'کارتن‌های مادر تحویلی', isActive: true },
    { id: 'unit-8', periodId: 'p-1', name: 'گونی', symbol: 'sack', description: 'گونی و کیسه مواد اولیه خام', isActive: true }
  ];

  const defaultPackagingTypes = [
    { id: 'pkg-1', periodId: 'p-1', name: 'سلفون', code: 'PKG-SLF', tareWeightGrams: 5, defaultQtyPerPackage: 1, description: 'پوشش سلفونی تک‌عددی شفاف', isActive: true },
    { id: 'pkg-2', periodId: 'p-1', name: 'شیرینک', code: 'PKG-SHR', tareWeightGrams: 12, defaultQtyPerPackage: 6, description: 'پک شیرینک حرارتی چندتایی', isActive: true },
    { id: 'pkg-3', periodId: 'p-1', name: 'لانچ باکس', code: 'PKG-LNC', tareWeightGrams: 45, defaultQtyPerPackage: 1, description: 'جعبه مقوایی لانچ باکس پذیرایی', isActive: true },
    { id: 'pkg-4', periodId: 'p-1', name: 'جعبه', code: 'PKG-BOX', tareWeightGrams: 80, defaultQtyPerPackage: 12, description: 'جعبه کادویی مقوایی ۲۴ سانتی', isActive: true },
    { id: 'pkg-5', periodId: 'p-1', name: 'کارتن', code: 'PKG-CRT', tareWeightGrams: 350, defaultQtyPerPackage: 24, description: 'کارتن ۵ لایه صادراتی', isActive: true },
    { id: 'pkg-6', periodId: 'p-1', name: 'وکیوم', code: 'PKG-VAC', tareWeightGrams: 15, defaultQtyPerPackage: 1, description: 'بسته‌بندی وکیوم خالات گاز محافظ', isActive: true },
    { id: 'pkg-7', periodId: 'p-1', name: 'پت', code: 'PKG-PET', tareWeightGrams: 25, defaultQtyPerPackage: 1, description: 'ظروف شفاف پت درب‌دار', isActive: true },
    { id: 'pkg-8', periodId: 'p-1', name: 'نایلون', code: 'PKG-NYL', tareWeightGrams: 8, defaultQtyPerPackage: 1, description: 'کیسه نایلونی دسته‌دار یا زیپ‌کیپ', isActive: true }
  ];

  const defaultBarcode = createDefaultBarcodeSettings();

  return {
    periods: initialPeriods,
    selectedPeriodId: 'p-1',
    itemCategories: defaultItemCategories,
    items: defaultItems,
    suppliers: defaultSuppliers,
    productCategories: defaultProductCategories,
    departments: defaultDepartments,
    products: defaultProducts,
    salesPeriods: [
      { id: 'sp-1', periodId: 'p-1', name: 'فروردین ماه', startDate: '1405/01/01', endDate: '1405/01/31' }
    ],
    productSales: [
      { id: 'sale-1', salesPeriodId: 'sp-1', periodId: 'p-1', productId: 'prod-1', qtySold: 1200, discount: 2000000, preDiscountAmount: 780000000, netSalesAmount: 778000000 },
      { id: 'sale-2', salesPeriodId: 'sp-1', periodId: 'p-1', productId: 'prod-2', qtySold: 450, discount: 0, preDiscountAmount: 540000000, netSalesAmount: 540000000 }
    ],
    unitConversions: [
      { id: 'conv-1', periodId: 'p-1', rawMaterialId: 'item-1', purchaseUnit: 'کیلویی', consumptionUnit: 'گرم', factor: 1000 }
    ],
    productFormulas: [
      {
        id: 'form-1',
        periodId: 'p-1',
        productId: '201001',
        name: 'فرمول اصلی',
        isActive: true,
        ingredients: [
          { rawMaterialId: '102001', quantity: 90 },
          { rawMaterialId: '102002', quantity: 15 }
        ]
      }
    ],
    personnel: defaultPersonnel,
    payrollPeriods: [
      { id: 'pp-1', periodId: 'p-1', title: 'حقوق فروردین ماه پرسنل', dateRange: '01 الی ۳۱ فروردین' }
    ],
    payrollItems: [
      { id: 'pi-1', payrollPeriodId: 'pp-1', periodId: 'p-1', employeeCode: '1001', payableAmount: 135000000, employerPensionShare: 21000000, employerUnemploymentShare: 3150000, totalPayrollCost: 159150000 }
    ],
    personnelAllocations: [
      { id: 'alloc-1', periodId: 'p-1', employeeCode: '1001', departmentCategoryId: 'dept-2', salaryShare: 135000000 }
    ],
    periodOverheads: [
      { id: 'oh-1', periodId: 'p-1', operational: 180000000, distributionSales: 45000000, financial: 12000000, administrative: 64000000, returnsOfExpense: 11000000 }
    ],
    procurementOrders: [],
    stockCountAudits: [
      { id: 'aud-1', periodId: 'p-1', title: 'انبارگردانی پایان فروردین ۱۴۰۵', date: '1405/01/30' }
    ],
    stockCounts: [
      { id: 'sc-1', auditId: 'aud-1', periodId: 'p-1', itemId: 'item-1', fullPackages: 15, looseQty: 10, totalCalculatedQty: 610, value: 231800000 },
      { id: 'sc-2', auditId: 'aud-1', periodId: 'p-1', itemId: 'item-2', fullPackages: 5, looseQty: 12, totalCalculatedQty: 262, value: 110040000 }
    ],
    purchaseInvoices: [],
    dailyProductionSegments: [],
    shiftAssignments: [],
    approvedMismatches: [],
    productionSections: [
      { id: 'sec-1', periodId: 'p-1', name: 'آماده‌سازی مواد اولیه و خمیرگیر', minStaff: 2 },
      { id: 'sec-2', periodId: 'p-1', name: 'بخش پخت و تنور', minStaff: 1 },
      { id: 'sec-3', periodId: 'p-1', name: 'خط تزیین و خنک‌کاری', minStaff: 1 },
      { id: 'sec-4', periodId: 'p-1', name: 'بسته‌بندی و لیبل‌زنی', minStaff: 2 }
    ],
    roles: DEFAULT_USER_ROLES.map((r, idx) => ({ ...r, id: `role-${idx + 1}`, permissions: [...r.permissions] })),
    users: defaultUsers,
    currentUser: defaultUsers[0],
    googleSheetsUrl: '',
    syncStatus: 'offline',
    lastSyncTime: '',
    unitsOfMeasurement: defaultUnitsOfMeasurement,
    packagingTypes: defaultPackagingTypes,
    barcodeSettings: defaultBarcode,
    barcodeSettingsByPeriod: { 'p-1': defaultBarcode },
    salaryBaseRates: [
      {
        id: 'sbr-1',
        periodId: 'p-1',
        year: '1405',
        dailyBaseSalary: 3500000,
        hourlyBaseSalary: 477273,
        dailyInsuranceSalary: 3000000,
        housingAllowance: 9000000,
        foodAllowance: 14000000,
        childAllowance: 7000000,
        baseYearsRate: 2500000,
        marriageAllowance: 5000000,
        taxableAmount: 15000000,
        overtimeHourlyRate: 450000,
        fridayWorkHourlyRate: 190996,
        holidayWorkHourlyRate: 450000,
        monthlyLeaveHours: '15:53'
      }
    ],
    insuredSalaryItems: [],
    leaveBuyoutSalaryItems: [],
    personnelCategories: [
      { id: 'pgrp-1', periodId: 'p-1', name: 'پشتیبانی کل' },
      { id: 'pgrp-2', periodId: 'p-1', name: 'بازاریابی کل' },
      { id: 'pgrp-3', periodId: 'p-1', name: 'مدیریت و اداری' },
      { id: 'pgrp-4', periodId: 'p-1', name: 'تولید و کارگاه' }
    ],
    monthlyWorkdaySettings: [
      {
        id: 'mws-1',
        periodId: 'p-1',
        year: 1405,
        month: 1,
        daysInMonth: 31,
        fridaysCount: 4,
        nonFridayHolidays: 3,
        workingDaysCount: 24,
        requiredWorkHours: 176
      }
    ],
    payrollCalculationRules: { ...DEFAULT_PAYROLL_CALCULATION_RULES },
    payrollCalculationRulesByPeriod: { 'p-1': { ...DEFAULT_PAYROLL_CALCULATION_RULES } },
    officialHolidays: [
      { id: 'ohd-1', periodId: 'p-1', year: 1405, date: '1405/01/01' },
      { id: 'ohd-2', periodId: 'p-1', year: 1405, date: '1405/01/02' },
      { id: 'ohd-3', periodId: 'p-1', year: 1405, date: '1405/01/03' }
    ],
    customerCategories: [
      { id: 'ccat-1', periodId: 'p-1', name: 'فروشگاه‌های زنجیره‌ای و هایپرمارکت‌ها', code: 'GRP-01', defaultDiscountPercent: 8, defaultPaymentTerm: 'چک ۳۰ روزه', description: 'مشتریان شبکه توزیع سراسری و هایپرها' },
      { id: 'ccat-2', periodId: 'p-1', name: 'عمده‌فروشان و بنکداران', code: 'GRP-02', defaultDiscountPercent: 12, defaultPaymentTerm: 'چک ۶۰ روزه', description: 'خریداران عمده کارتن و پالتی' },
      { id: 'ccat-3', periodId: 'p-1', name: 'کافه‌ها، رستوران‌ها و هتل‌ها (HoReCa)', code: 'GRP-03', defaultDiscountPercent: 5, defaultPaymentTerm: 'نقدی', description: 'تامین روزانه شیرینی و نان کافه‌ای' },
      { id: 'ccat-4', periodId: 'p-1', name: 'مشتریان سازمانی و ارگانی', code: 'GRP-04', defaultDiscountPercent: 7, defaultPaymentTerm: 'اعتباری', description: 'پک‌های پذیرایی همایش و سازمانی' },
      { id: 'ccat-5', periodId: 'p-1', name: 'خرده‌فروشان و قنادی‌های محلی', code: 'GRP-05', defaultDiscountPercent: 3, defaultPaymentTerm: 'نقدی', description: 'مشتریان خرد فروشگاهی' },
      { id: 'ccat-6', periodId: 'p-1', name: 'مشتریان ویژه (VIP)', code: 'GRP-06', defaultDiscountPercent: 10, defaultPaymentTerm: 'چک ۳۰ روزه', description: 'شرکای تجاری کلیدی و برتر' }
    ],
    customers: [
      {
        id: 'cust-1',
        periodId: 'p-1',
        code: 'C-1001',
        accountingCode: '103001',
        name: 'هایپرمارکت بزرگ پالادیوم (شعبه زعفرانیه)',
        type: 'فروشگاه',
        categoryId: 'ccat-1',
        contactPerson: 'مهندس رضایی (مدیر تامین کالای فاسدشدنی)',
        nationalId: '10103524671',
        economicCode: '411365891234',
        registrationNo: '345892',
        phone: '09121112233',
        tel: '02122019988',
        email: 'procurement@palladium-hyper.ir',
        province: 'تهران',
        city: 'تهران',
        postalCode: '1985843111',
        address: 'تهران، زعفرانیه، خیابان مقدس اردبیلی، مجتمع تجاری پالادیوم، طبقه همکف B',
        deliveryAddress: 'تهران، زعفرانیه، خیابان الف، انبار تخلیه بار هایپرمارکت',
        discountPercent: 8,
        creditLimit: 500000000,
        settlementPeriodDays: 30,
        paymentTerms: 'چک ۳۰ روزه',
        salesAgent: 'امیرحسین تهرانی',
        isActive: true,
        status: 'active',
        notes: 'تحویل بار صبح‌ها قبل از ساعت ۸:۳۰ صورت گیرد.',
        bankAccounts: [
          {
            bankName: 'بانک پاسارگاد',
            accountNo: '201-8000-1234567-1',
            shaba: 'IR890570020180001234567001',
            cardNo: '5022291088776655',
            accountHolder: 'شرکت تجارت نوین پالادیوم'
          }
        ],
        preferredProductIds: ['prod-1', 'prod-2']
      },
      {
        id: 'cust-2',
        periodId: 'p-1',
        code: 'C-1002',
        accountingCode: '103002',
        name: 'بازرگانی شیرینی و نان پارسیان (حاج قاسم مهدوی)',
        type: 'حقیقی',
        categoryId: 'ccat-2',
        contactPerson: 'قاسم مهدوی',
        nationalId: '0071234567',
        economicCode: '',
        registrationNo: '',
        phone: '09123334455',
        tel: '02155667788',
        email: 'mahdavi.trd@gmail.com',
        province: 'تهران',
        city: 'تهران',
        postalCode: '1165432190',
        address: 'تهران، خیابان خیام، بازار بزرگ، سرای حاج حسن، پلاک ۴۲',
        discountPercent: 12,
        creditLimit: 1200000000,
        settlementPeriodDays: 60,
        paymentTerms: 'چک ۶۰ روزه',
        salesAgent: 'محسن کریمی',
        isActive: true,
        status: 'active',
        notes: 'مشتری با اعتبار بالا و خوش‌حساب بازار.',
        bankAccounts: [
          {
            bankName: 'بانک ملی ایران',
            accountNo: '0105678901004',
            shaba: 'IR450170000000105678901004',
            cardNo: '6037991823456789',
            accountHolder: 'قاسم مهدوی'
          }
        ]
      },
      {
        id: 'cust-3',
        periodId: 'p-1',
        code: 'C-1003',
        accountingCode: '103003',
        name: 'مجموعه هتل‌های بین‌المللی اسپیناس پالاس',
        type: 'حقوقی',
        categoryId: 'ccat-3',
        contactPerson: 'سرکار خانم دکتر صادقی (رئیس تشریفات و کیترینگ)',
        nationalId: '10320489110',
        economicCode: '411298451122',
        registrationNo: '489210',
        phone: '09124445566',
        tel: '02175675000',
        email: 'catering@espinashotels.com',
        province: 'تهران',
        city: 'تهران',
        postalCode: '1981145678',
        address: 'تهران، سعادت آباد، میدان بهرود، خیابان عابدی، کوچه ۳۳، هتل اسپیناس پالاس',
        discountPercent: 10,
        creditLimit: 850000000,
        settlementPeriodDays: 45,
        paymentTerms: 'اعتباری',
        salesAgent: 'امیرحسین تهرانی',
        isActive: true,
        status: 'active',
        notes: 'پک‌های صبحانه و کروسان‌های داغ هر روز ساعت ۶:۰۰ صبح تحویل شود.',
        bankAccounts: [
          {
            bankName: 'بانک تجارت',
            accountNo: '3410987654',
            shaba: 'IR120180000000003410987654',
            cardNo: '5859837012345678',
            accountHolder: 'هتل بین المللی اسپیناس'
          }
        ]
      }
    ],
    bankAccounts: [
      {
        id: 'bank-1',
        periodId: 'p-1',
        bankName: 'بانک ملت',
        branchName: 'شعبه مرکزی بازار',
        branchCode: '1234',
        accountNo: '4567890123',
        shaba: 'IR500120000000004567890123',
        cardNo: '6104337890123456',
        accountType: 'جاری',
        accountHolder: 'شرکت صنایع غذایی و نان گاتان',
        initialBalance: 1450000000,
        currentBalance: 1450000000,
        accountingCode: '101001',
        posTerminalIds: ['pos-1'],
        isActive: true,
        notes: 'حساب اصلی درآمد و تراکنش‌های فروشگاه'
      },
      {
        id: 'bank-2',
        periodId: 'p-1',
        bankName: 'بانک سامان',
        branchName: 'شعبه سعادت آباد',
        branchCode: '842',
        accountNo: '842-800-987654-1',
        shaba: 'IR780560084280000987654001',
        cardNo: '6219861044556677',
        accountType: 'جاری',
        accountHolder: 'صنایع قنادی و شیرینی گاتان',
        initialBalance: 890000000,
        currentBalance: 890000000,
        accountingCode: '101002',
        posTerminalIds: ['pos-2'],
        isActive: true,
        notes: 'حساب تسویه حساب مشتریان عمده و کیترینگ'
      },
      {
        id: 'bank-3',
        periodId: 'p-1',
        bankName: 'بانک پاسارگاد',
        branchName: 'شعبه میرداماد',
        branchCode: '215',
        accountNo: '215-8000-4321987-1',
        shaba: 'IR450570021580000432198701',
        cardNo: '5022291077889900',
        accountType: 'پس‌انداز',
        accountHolder: 'گاتان نان و شیرینی',
        initialBalance: 320000000,
        currentBalance: 320000000,
        accountingCode: '101003',
        isActive: true,
        notes: 'حساب سپرده و پشتیبان مالی'
      }
    ],
    cashDrawers: [
      {
        id: 'csh-1',
        periodId: 'p-1',
        code: 'CSH-01',
        name: 'صندوق مرکزی فروشگاه',
        location: 'پیشخوان اصلی فروشگاه',
        cashierId: 'cshr-1',
        initialBalance: 45000000,
        currentBalance: 45000000,
        maxLimit: 120000000,
        accountingCode: '102001',
        isActive: true,
        notes: 'صندوق اصلی تسویه فاکتورهای خرده‌فروشی'
      },
      {
        id: 'csh-2',
        periodId: 'p-1',
        code: 'CSH-02',
        name: 'صندوق کافه و پذیرایی',
        location: 'سالن کافه گاتان',
        cashierId: 'cshr-2',
        initialBalance: 25000000,
        currentBalance: 25000000,
        maxLimit: 60000000,
        accountingCode: '102002',
        isActive: true,
        notes: 'صندوق سفارشات داخل سالن و بیرون‌بر'
      },
      {
        id: 'csh-3',
        periodId: 'p-1',
        code: 'CSH-03',
        name: 'تنخواه‌گردان کارگاه و تولید',
        location: 'دفتر کارخانه و سرپرستی',
        initialBalance: 80000000,
        currentBalance: 80000000,
        maxLimit: 150000000,
        accountingCode: '102003',
        isActive: true,
        notes: 'تنخواه خریدهای خرد و مایحتاج فوری تولید'
      }
    ],
    posTerminals: [
      {
        id: 'pos-1',
        periodId: 'p-1',
        terminalId: '14890234',
        merchantId: '984501234455112',
        model: 'PAX D210 (بیسیم وای‌فای)',
        pspName: 'به‌پرداخت ملت',
        bankAccountId: 'bank-1',
        cashDrawerId: 'csh-1',
        serialNo: 'SN-88392014',
        connectionType: 'WiFi',
        feePercent: 0,
        isActive: true,
        notes: 'پایانه اصلی صندوق فروشگاه'
      },
      {
        id: 'pos-2',
        periodId: 'p-1',
        terminalId: '23901145',
        merchantId: '776100234511900',
        model: 'Verifone VX680',
        pspName: 'پرداخت الکترونیک سامان (سپ)',
        bankAccountId: 'bank-2',
        cashDrawerId: 'csh-2',
        serialNo: 'SN-99120485',
        connectionType: 'LAN',
        feePercent: 0,
        isActive: true,
        notes: 'پایانه مستقر در بار کافه'
      }
    ],
    cashiers: [
      {
        id: 'cshr-1',
        periodId: 'p-1',
        code: 'CSHR-101',
        fullName: 'فاطمه رستمی',
        nationalId: '0019876543',
        phone: '09129876543',
        defaultCashDrawerId: 'csh-1',
        shiftType: 'صبح',
        maxDiscountPercent: 10,
        permissions: ['cash_receipt', 'pos_receipt', 'returns', 'shift_closeout'],
        pinCode: '1234',
        isActive: true,
        startDate: '1402/08/01',
        notes: 'صندوق‌دار ارشد شیفت صبح'
      },
      {
        id: 'cshr-2',
        periodId: 'p-1',
        code: 'CSHR-102',
        fullName: 'رضا ناصری',
        nationalId: '0028765432',
        phone: '09128765432',
        defaultCashDrawerId: 'csh-2',
        shiftType: 'عصر',
        maxDiscountPercent: 5,
        permissions: ['cash_receipt', 'pos_receipt', 'shift_closeout'],
        pinCode: '4321',
        isActive: true,
        startDate: '1403/02/15',
        notes: 'صندوق‌دار شیفت عصر و کافه'
      }
    ],
    chequeBooks: [
      {
        id: 'chkb-1',
        periodId: 'p-1',
        bankAccountId: 'bank-1',
        series: 'الف/1405',
        sayadPrefix: '2105',
        startNumber: 1001,
        endNumber: 1025,
        totalLeaves: 25,
        receivedDate: '1405/01/01',
        description: 'دسته چک ۲۵ برگی بانک ملت - جاری کارخانه و تامین‌کنندگان',
        status: 'active',
        createdAt: '1405/01/01'
      },
      {
        id: 'chkb-2',
        periodId: 'p-1',
        bankAccountId: 'bank-2',
        series: 'ب/1405',
        sayadPrefix: '2106',
        startNumber: 2001,
        endNumber: 2025,
        totalLeaves: 25,
        receivedDate: '1405/01/05',
        description: 'دسته چک ۲۵ برگی بانک سامان - حساب کیترینگ و بازرگانی',
        status: 'active',
        createdAt: '1405/01/05'
      }
    ],
    chequeLeaves: [
      {
        id: 'leaf-1',
        periodId: 'p-1',
        chequeBookId: 'chkb-1',
        bankAccountId: 'bank-1',
        leafNumber: 1001,
        sayadNo: '2105140501001001',
        status: 'cleared',
        paymentNo: 'PAY-140501-003',
        payeeName: 'شرکت آرد و غلات برتر (تامین‌کننده آرد نول)',
        beneficiaryType: 'supplier',
        beneficiaryId: 'sup-1',
        amount: 220000000,
        issueDate: '1405/01/02',
        dueDate: '1405/01/15',
        clearedDate: '1405/01/15',
        notes: 'تسویه خرید آرد نول درجه یک قنادی - وصول شد',
        registeredBy: 'مدیر کل سامانه گاتان',
        createdAt: '1405/01/01'
      },
      {
        id: 'leaf-2',
        periodId: 'p-1',
        chequeBookId: 'chkb-1',
        bankAccountId: 'bank-1',
        leafNumber: 1002,
        sayadNo: '2105140501001002',
        status: 'issued',
        paymentNo: 'PAY-140501-004',
        payeeName: 'تامین روغن و کره مارگارین',
        beneficiaryType: 'supplier',
        amount: 165000000,
        issueDate: '1405/01/05',
        dueDate: '1405/01/25',
        notes: 'بابت خرید روغن قنادی و کره مارگارین ۵ کارتن',
        registeredBy: 'حسابدار ارشد',
        createdAt: '1405/01/01'
      },
      {
        id: 'leaf-3',
        periodId: 'p-1',
        chequeBookId: 'chkb-1',
        bankAccountId: 'bank-1',
        leafNumber: 1003,
        sayadNo: '2105140501001003',
        status: 'issued',
        paymentNo: 'PAY-140501-005',
        payeeName: 'بسته‌بندی و کارتن‌سازی نفیس',
        beneficiaryType: 'supplier',
        amount: 95000000,
        issueDate: '1405/01/08',
        dueDate: '1405/02/05',
        notes: 'خرید کارتن و لانچ‌باکس‌های پذیرایی',
        registeredBy: 'حسابدار ارشد',
        createdAt: '1405/01/01'
      },
      { id: 'leaf-4', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1004, sayadNo: '2105140501001004', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-5', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1005, sayadNo: '2105140501001005', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-6', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1006, sayadNo: '2105140501001006', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-7', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1007, sayadNo: '2105140501001007', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-8', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1008, sayadNo: '2105140501001008', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-9', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1009, sayadNo: '2105140501001009', status: 'blank', createdAt: '1405/01/01' },
      { id: 'leaf-10', periodId: 'p-1', chequeBookId: 'chkb-1', bankAccountId: 'bank-1', leafNumber: 1010, sayadNo: '2105140501001010', status: 'blank', createdAt: '1405/01/01' },
      {
        id: 'leaf-11',
        periodId: 'p-1',
        chequeBookId: 'chkb-2',
        bankAccountId: 'bank-2',
        leafNumber: 2001,
        sayadNo: '2106140501002001',
        status: 'issued',
        paymentNo: 'PAY-140501-006',
        payeeName: 'شرکت پخش شکر و ادویه‌جات تهران',
        beneficiaryType: 'supplier',
        amount: 130000000,
        issueDate: '1405/01/10',
        dueDate: '1405/01/28',
        notes: 'خرید شکر سفید و وانیل کارگاهی',
        registeredBy: 'مدیر کل سامانه گاتان',
        createdAt: '1405/01/05'
      },
      { id: 'leaf-12', periodId: 'p-1', chequeBookId: 'chkb-2', bankAccountId: 'bank-2', leafNumber: 2002, sayadNo: '2106140501002002', status: 'blank', createdAt: '1405/01/05' },
      { id: 'leaf-13', periodId: 'p-1', chequeBookId: 'chkb-2', bankAccountId: 'bank-2', leafNumber: 2003, sayadNo: '2106140501002003', status: 'blank', createdAt: '1405/01/05' },
      { id: 'leaf-14', periodId: 'p-1', chequeBookId: 'chkb-2', bankAccountId: 'bank-2', leafNumber: 2004, sayadNo: '2106140501002004', status: 'blank', createdAt: '1405/01/05' }
    ],
    treasuryReceipts: [
      {
        id: 'rec-1',
        periodId: 'p-1',
        receiptNo: 'REC-140501-001',
        date: '1405/01/10',
        time: '11:30',
        counterpartyType: 'customer',
        counterpartyId: 'cust-1',
        counterpartyName: 'هایپرمارکت بزرگ پالادیوم (شعبه زعفرانیه)',
        paymentMethod: 'bank_transfer',
        amount: 250000000,
        bankAccountId: 'bank-2',
        bankTransferRef: 'SN-984512',
        category: 'تسویه فاکتور فروش',
        description: 'واریز حواله ساتنا بابت تسویه فاکتور کروسان و نان فروردین',
        cashierId: 'cshr-1',
        registeredBy: 'مدیر کل سامانه گاتان',
        status: 'confirmed',
        createdAt: '1405/01/10'
      },
      {
        id: 'rec-2',
        periodId: 'p-1',
        receiptNo: 'REC-140501-002',
        date: '1405/01/12',
        time: '16:45',
        counterpartyType: 'other',
        counterpartyName: 'مشتری متفرقه فروشگاهی',
        paymentMethod: 'pos',
        amount: 18500000,
        posTerminalId: 'pos-1',
        posTrackingNo: 'RRN-451209',
        bankAccountId: 'bank-1',
        cashDrawerId: 'csh-1',
        category: 'فروش نقدی',
        description: 'خرید کیک تولد و دسر مجلسی',
        cashierId: 'cshr-1',
        registeredBy: 'فاطمه رستمی',
        status: 'confirmed',
        createdAt: '1405/01/12'
      },
      {
        id: 'rec-3',
        periodId: 'p-1',
        receiptNo: 'REC-140501-003',
        date: '1405/01/14',
        time: '10:00',
        counterpartyType: 'customer',
        counterpartyId: 'cust-2',
        counterpartyName: 'بازرگانی شیرینی و نان پارسیان (حاج قاسم مهدوی)',
        paymentMethod: 'cheque',
        amount: 400000000,
        chequeDetails: {
          chequeNo: 'CHK-89210',
          sayadNo: '1102345678901234',
          dueDate: '1405/02/15',
          bankName: 'بانک ملی ایران',
          drawerName: 'قاسم مهدوی',
          branchName: 'شعبه بازار',
          isGuaranteed: true,
          status: 'pending'
        },
        category: 'تسویه فاکتور فروش',
        description: 'دریافت چک صیادی ۳۰ روزه بابت خرید عمده شیرینی',
        cashierId: 'cshr-1',
        registeredBy: 'مدیر کل سامانه گاتان',
        status: 'confirmed',
        createdAt: '1405/01/14'
      }
    ],
    treasuryPayments: [
      {
        id: 'pay-1',
        periodId: 'p-1',
        paymentNo: 'PAY-140501-001',
        date: '1405/01/08',
        time: '09:30',
        beneficiaryType: 'supplier',
        beneficiaryName: 'شرکت آرد و غلات برتر (تامین‌کننده آرد نول)',
        paymentMethod: 'bank_transfer',
        amount: 180000000,
        bankAccountId: 'bank-1',
        bankTransferRef: 'PY-667120',
        category: 'تسویه فاکتور خرید مواد اولیه',
        description: 'حواله پایا بابت خرید آرد قنادی و مواد اولیه کارگاه',
        registeredBy: 'حسابدار ارشد',
        status: 'confirmed',
        createdAt: '1405/01/08'
      },
      {
        id: 'pay-2',
        periodId: 'p-1',
        paymentNo: 'PAY-140501-002',
        date: '1405/01/11',
        time: '14:20',
        beneficiaryType: 'expense',
        beneficiaryName: 'تنخواه کارگاه (خرید شوینده و ملزومات)',
        paymentMethod: 'cash',
        amount: 12000000,
        cashDrawerId: 'csh-3',
        category: 'هزینه‌های جاری کارگاه',
        description: 'پرداخت نقدی بابت خرید فوری اقلام بهداشتی و نظافت خط تولید',
        registeredBy: 'مدیر کل سامانه گاتان',
        status: 'confirmed',
        createdAt: '1405/01/11'
      }
    ],
    barterTransactions: [
      {
        id: 'btr-1',
        periodId: 'p-1',
        barterNo: 'BTR-1405-001',
        date: '1405/01/12',
        partyAType: 'customer',
        partyAId: 'cust-1',
        partyAName: 'هایپرمارکت بزرگ پالادیوم',
        partyBType: 'supplier',
        partyBId: 'sup-1',
        partyBName: 'تامین روغن و کره مارگارین',
        amount: 85000000,
        itemsDescription: 'تحویل ۱۲۰ عدد کروسان و شیرینی مجلسی در ازای ۵ کارتن کره مارگارین سوئیسی',
        settlementDiffAmount: 0,
        settlementDiffMethod: 'on_account',
        contractNo: 'CTR-BTR-88',
        description: 'سند تهاتر دوجانبه محصولات نهایی با مواد اولیه کره و مارگارین',
        registeredBy: 'مدیر کل سامانه گاتان',
        status: 'completed',
        createdAt: '1405/01/12'
      }
    ],
    counterpartySettlements: [
      {
        id: 'set-1',
        periodId: 'p-1',
        settlementNo: 'SET-140501-001',
        date: '1405/01/10',
        partyType: 'customer',
        partyId: 'cust-1',
        partyName: 'هایپرمارکت بزرگ پالادیوم (شعبه زعفرانیه)',
        totalSettledAmount: 250000000,
        discountAmount: 5000000,
        bankTransferAmount: 245000000,
        bankAccountId: 'bank-2',
        bankTransferRef: 'SN-984512',
        allocatedInvoices: [
          {
            invoiceNo: 'INV-140501-01',
            invoiceDate: '1405/01/05',
            invoiceTotal: 250000000,
            settledHere: 250000000
          }
        ],
        notes: 'تسویه کامل فاکتور دوره اول همراه با ۲ درصد تخفیف پرداخت سریع نقدی',
        registeredBy: 'مدیر کل سامانه گاتان',
        status: 'completed',
        createdAt: '1405/01/10'
      }
    ],
    cashierShiftCloseouts: [
      {
        id: 'cls-1',
        periodId: 'p-1',
        closeoutNo: 'CLS-140501-001',
        date: '1405/01/12',
        shiftStartTime: '07:30',
        shiftEndTime: '15:30',
        cashierId: 'cshr-1',
        cashierName: 'فاطمه رستمی',
        cashDrawerId: 'csh-1',
        cashDrawerName: 'صندوق مرکزی فروشگاه',
        openingCashBalance: 10000000,
        systemCashReceipts: 35000000,
        systemPosReceipts: 120000000,
        systemCashPayments: 0,
        systemExpectedCash: 45000000,
        physicalCountedCash: 45000000,
        cashDiscrepancy: 0,
        posCountedReceipts: 120000000,
        posDiscrepancy: 0,
        handoverToVaultAmount: 35000000,
        retainedForNextShift: 10000000,
        denominationsBreakdown: {
          '1000000': 30,
          '500000': 20,
          '100000': 50
        },
        supervisorName: 'مدیر کل سامانه گاتان',
        notes: 'تحویل بدون کسری یا فزونی، تمامی رسیدهای پوز منطبق با گزارش پایان شیفت پایانه است.',
        status: 'approved',
        createdAt: '1405/01/12'
      }
    ],
    personnelContracts: [
      {
        id: 'cnt-1',
        periodId: 'p-1',
        employeeCode: '1001',
        role: 'سرپرست خط پخت و تنور',
        contractStartDate: '1404/01/01',
        contractEndDate: '1404/12/29',
        contractDurationMonths: 12,
        contractBaseSalary: 105000000,
        contractDailySalary: 3500000,
        fullName: 'سعید احمدی',
        nationalId: '0012345678',
        fatherName: 'احمد',
        jobAllowance: 15000000,
        notes: 'قرارداد کار معین یک‌ساله تولید',
        createdAt: '1404/01/01'
      }
    ],
    personnelSettlements: []
  };
}

let inMemoryDb: AppDatabase | null = null;

export function sanitizeAndMergeDatabaseWithMeta(raw: any): { db: AppDatabase; migrated: boolean } {
  const schema: AppDatabase = getInitialDatabase();
  if (!raw || typeof raw !== 'object') {
    return { db: schema, migrated: false };
  }
  const merged: any = { ...schema, ...raw };

  // Ensure every array collection (isolated + system-wide) is definitely an array
  const collections: (keyof AppDatabase)[] = [
    'periods',
    'roles',
    'users',
    ...ISOLATED_ARRAY_COLLECTIONS,
  ];

  collections.forEach(key => {
    if (!Array.isArray(merged[key])) {
      // Only fall back to schema defaults if the property was completely absent/invalid (never overwrite intentional empty arrays)
      merged[key] = raw && Object.prototype.hasOwnProperty.call(raw, key)
        ? []
        : ((Array.isArray(schema[key]) ? schema[key] : []) as any);
      return;
    }

    // Deduplicate identical category/department rows (same id + periodId + name) before enforcing unique IDs
    let arr = merged[key] as any[];
    if (key === 'productCategories' || key === 'itemCategories' || key === 'customerCategories' || key === 'departments') {
      const seenExact = new Set<string>();
      const deduped = arr.filter(item => {
        if (!item || typeof item !== 'object') return true;
        const id = item.id ? String(item.id).trim() : '';
        const periodId = item.periodId ? String(item.periodId).trim() : '';
        const name = item.name ? String(item.name).trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ') : '';
        if (!id) return true;
        const sig = `${id}::${periodId}::${name}`;
        if (seenExact.has(sig)) return false;
        seenExact.add(sig);
        return true;
      });
      if (deduped.length !== arr.length) {
        arr = deduped;
        merged[key] = deduped as any;
      }
    }

    // Ensure strictly unique IDs across all items in collection using simple sequential IDs
    const seenIds = new Set<string>();
    let modified = false;
    for (let idx = 0; idx < arr.length; idx++) {
      const item = arr[idx];
      if (item && typeof item === 'object') {
        const rawId = item.id ? String(item.id).trim() : '';
        if (!rawId || seenIds.has(rawId) || rawId !== item.id) {
          modified = true;
          break;
        }
        seenIds.add(rawId);
      }
    }
    if (modified) {
      const seenIdsFull = new Set<string>();
      const nextId = createSimpleIdGenerator(arr, getPrefixForCollection(key));
      merged[key] = arr.map((item: any) => {
        if (item && typeof item === 'object') {
          let itemId = item.id ? String(item.id).trim() : '';
          if (!itemId || seenIdsFull.has(itemId)) {
            itemId = nextId();
            while (seenIdsFull.has(itemId)) itemId = nextId();
            seenIdsFull.add(itemId);
            return { ...item, id: itemId };
          }
          seenIdsFull.add(itemId);
          if (itemId !== item.id) {
            return { ...item, id: itemId };
          }
        }
        return item;
      }) as any;
    }
  });

  if (!merged.payrollCalculationRules) {
    merged.payrollCalculationRules = { ...DEFAULT_PAYROLL_CALCULATION_RULES };
  }

  if (!Array.isArray(merged.approvedMismatches)) {
    merged.approvedMismatches = [];
  }

  if (!merged.currentUser) {
    merged.currentUser = schema.currentUser;
  }

  // Ensure roles array contains system admin role and any custom roles assigned to users
  const rawRoles = Array.isArray(merged.roles) ? merged.roles : [];
  const nextRoleId = createSimpleIdGenerator(rawRoles, 'role');
  const currentRoles: UserRoleDefinition[] = rawRoles.length > 0
    ? rawRoles.map((r: any) => ({
        id: String(r.id || nextRoleId()),
        name: String(r.name || '').trim(),
        description: r.description ? String(r.description) : '',
        permissions: normalizePermissions(Array.isArray(r.permissions) ? r.permissions : []),
        isSystem: Boolean(r.isSystem || r.name === 'مدیر ارشد'),
        createdAt: r.createdAt,
      })).filter((r: UserRoleDefinition) => Boolean(r.name))
    : DEFAULT_USER_ROLES.map((r, idx) => ({ ...r, id: `role-${idx + 1}`, permissions: [...r.permissions] }));

  if (!currentRoles.some(r => r.name === 'مدیر ارشد')) {
    currentRoles.unshift({ ...DEFAULT_USER_ROLES[0], id: nextRoleId(), permissions: ['*'] });
  } else {
    for (let i = 0; i < currentRoles.length; i++) {
      if (currentRoles[i].name === 'مدیر ارشد') {
        currentRoles[i] = { ...currentRoles[i], permissions: ['*'], isSystem: true };
      }
    }
  }

  const knownRoleNames = new Set(currentRoles.map(r => r.name));
  (merged.users || []).forEach((u: any) => {
    const rName = String(u?.role || '').trim();
    if (rName && !knownRoleNames.has(rName)) {
      knownRoleNames.add(rName);
      currentRoles.push({
        id: nextRoleId(),
        name: rName,
        description: 'نقش بازیابی شده از لیست کاربران',
        permissions: normalizePermissions(Array.isArray(u.permissions) ? u.permissions : []),
        isSystem: false,
      });
    }
  });
  merged.roles = currentRoles;

  const normCatTxt = (s?: string) => String(s || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');

  // Migrate independent Production Departments ONLY for legacy DBs that had productCategories before departments existed
  const rawHadDepartmentsArray = Array.isArray((raw as any).departments);
  if (!rawHadDepartmentsArray) {
    const existingDepts: Department[] = Array.isArray(merged.departments) ? [...merged.departments] : [];
    const periodsWithDepts = new Set(existingDepts.map(d => d.periodId));
    const catPeriods = new Set<string>(
      (merged.productCategories || []).map((c: any) => c.periodId).filter(Boolean)
    );
    let deptsChanged = false;
    const nextDeptId = createSimpleIdGenerator(existingDepts, 'dept');

    catPeriods.forEach(pid => {
      if (!periodsWithDepts.has(pid)) {
        const periodCats = (merged.productCategories || []).filter((c: any) => c.periodId === pid);
        const seenNames = new Set<string>();
        periodCats.forEach((cat: any) => {
          const n = normCatTxt(cat.name);
          if (seenNames.has(n)) return;
          seenNames.add(n);
          existingDepts.push({
            id: nextDeptId(),
            periodId: pid,
            name: cat.name,
            targetMargin: cat.targetMargin,
            isShared: cat.id === 'cat-4' || /-cat-4$/.test(cat.id) || n === 'مشترک'
          });
        });
        deptsChanged = true;
      }
    });

    if (deptsChanged) {
      merged.departments = existingDepts;
    }

    if (existingDepts.length > 0) {
      let catsChanged = false;
      const deptsById = new Map(existingDepts.map(d => [d.id, d]));
      const migratedCats = (merged.productCategories || []).map((cat: any) => {
        if (cat && typeof cat === 'object' && !('departmentId' in cat)) {
          const matchById = deptsById.get(cat.id);
          const matchByName = !matchById
            ? existingDepts.find(d => d.periodId === cat.periodId && normCatTxt(d.name) === normCatTxt(cat.name))
            : undefined;
          const resolved = matchById || matchByName;
          if (resolved) {
            catsChanged = true;
            return { ...cat, departmentId: resolved.id };
          }
        }
        return cat;
      });
      if (catsChanged) {
        merged.productCategories = migratedCats;
      }
    }
  }

  // Tag any legacy ShiftAssignments missing explicit year/month so each month stays isolated
  if (Array.isArray(merged.shiftAssignments) && merged.shiftAssignments.length > 0) {
    const periodsMap = new Map<string, Period>((merged.periods || []).map((p: Period) => [p.id, p]));
    const fallbackPeriodId = merged.selectedPeriodId || merged.periods?.[0]?.id || '';
    let saChanged = false;
    const taggedSA = merged.shiftAssignments.map((sa: any) => {
      if (!sa || typeof sa !== 'object') return sa;
      if (sa.year !== undefined && sa.month !== undefined) return sa;
      saChanged = true;
      if (sa.date) {
        const parsed = parseShamsiYearMonth(sa.date);
        if (parsed) {
          return { ...sa, year: parsed.year, month: parsed.month };
        }
      }
      const pId = sa.periodId || fallbackPeriodId;
      const defYM = getDefaultYearMonthFromPeriod(periodsMap.get(pId), pId);
      return {
        ...sa,
        periodId: sa.periodId || fallbackPeriodId,
        year: defYM.year,
        month: defYM.month
      };
    });
    if (saChanged) {
      merged.shiftAssignments = taggedSA;
    }
  }

  // Migrate ProductFormulas to store کد حسابداری محصول & کد معین حسابداری مواد اولیه
  if (Array.isArray(merged.productFormulas) && merged.productFormulas.length > 0) {
    const prodKeyByPeriodAndId = new Map<string, string>();
    const prodKeyById = new Map<string, string>();
    (merged.products || []).forEach((p: any) => {
      if (!p || !p.id) return;
      const pKey = getProductFormulaKey(p);
      if (!pKey) return;
      if (p.periodId) prodKeyByPeriodAndId.set(`${p.periodId}::${p.id}`, pKey);
      if (!prodKeyById.has(p.id)) prodKeyById.set(p.id, pKey);
    });

    const matKeyByPeriodAndId = new Map<string, string>();
    const matKeyById = new Map<string, string>();
    (merged.items || []).forEach((item: any) => {
      if (!item || !item.id) return;
      const mKey = getMaterialFormulaKey(item);
      if (!mKey) return;
      if (item.periodId) matKeyByPeriodAndId.set(`${item.periodId}::${item.id}`, mKey);
      if (!matKeyById.has(item.id)) matKeyById.set(item.id, mKey);
    });
    (merged.products || []).forEach((p: any) => {
      if (!p || !p.id || !p.isWip) return;
      const mKey = getMaterialFormulaKey(p);
      if (!mKey) return;
      if (p.periodId && !matKeyByPeriodAndId.has(`${p.periodId}::${p.id}`)) {
        matKeyByPeriodAndId.set(`${p.periodId}::${p.id}`, mKey);
      }
      if (!matKeyById.has(p.id)) matKeyById.set(p.id, mKey);
    });

    let formulasChanged = false;
    const migratedFormulas = merged.productFormulas.map((f: any) => {
      if (!f || typeof f !== 'object') return f;
      const rawProdKey = String(f.productId || '').trim();
      const resolvedProdKey =
        (f.periodId ? prodKeyByPeriodAndId.get(`${f.periodId}::${rawProdKey}`) : undefined) ||
        prodKeyById.get(rawProdKey) ||
        normalizeAccountingCode(rawProdKey);

      let ingChanged = false;
      const migratedIngredients = Array.isArray(f.ingredients)
        ? f.ingredients.map((ing: any) => {
            if (!ing || typeof ing !== 'object') return ing;
            const rawMatKey = String(ing.rawMaterialId || '').trim();
            const resolvedMatKey =
              (f.periodId ? matKeyByPeriodAndId.get(`${f.periodId}::${rawMatKey}`) : undefined) ||
              matKeyById.get(rawMatKey) ||
              normalizeAccountingCode(rawMatKey);
            if (resolvedMatKey && resolvedMatKey !== ing.rawMaterialId) {
              ingChanged = true;
              return { ...ing, rawMaterialId: resolvedMatKey };
            }
            return ing;
          })
        : [];

      if ((resolvedProdKey && resolvedProdKey !== f.productId) || ingChanged) {
        formulasChanged = true;
        return {
          ...f,
          productId: resolvedProdKey || f.productId,
          ingredients: ingChanged ? migratedIngredients : f.ingredients
        };
      }
      return f;
    });

    if (formulasChanged) {
      merged.productFormulas = migratedFormulas;
    }
  }

  return { db: merged as AppDatabase, migrated: false };
}

export function sanitizeAndMergeDatabase(raw: any): AppDatabase {
  return sanitizeAndMergeDatabaseWithMeta(raw).db;
}

/**
 * Fast incremental sanitizer for live in-app edits:
 * Only inspects array collections whose reference actually changed since prevDb,
 * assigning simple sequential IDs (`prefix-N`) if any item lacks or duplicates an ID.
 */
export function sanitizeChangedCollections(prevDb: AppDatabase | null, updatedDb: AppDatabase): AppDatabase {
  if (!prevDb) {
    return sanitizeAndMergeDatabase(updatedDb);
  }

  let result: AppDatabase = updatedDb;
  let clonedResult = false;
  const ensureMutable = () => {
    if (!clonedResult) {
      result = { ...updatedDb };
      clonedResult = true;
    }
    return result as any;
  };

  const keys = Object.keys(updatedDb) as Array<keyof AppDatabase>;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const nextVal = updatedDb[key];
    if (nextVal === prevDb[key]) continue;
    if (!Array.isArray(nextVal)) continue;

    const arr = nextVal as any[];
    const seenIds = new Set<string>();
    let needsFix = false;
    for (let idx = 0; idx < arr.length; idx++) {
      const item = arr[idx];
      if (item && typeof item === 'object') {
        const rawId = item.id ? String(item.id).trim() : '';
        if (!rawId || seenIds.has(rawId) || rawId !== item.id) {
          needsFix = true;
          break;
        }
        seenIds.add(rawId);
      }
    }

    if (needsFix) {
      const seenIdsFull = new Set<string>();
      const nextId = createSimpleIdGenerator(arr, getPrefixForCollection(key));
      const fixedArr = arr.map((item: any) => {
        if (item && typeof item === 'object') {
          let itemId = item.id ? String(item.id).trim() : '';
          if (!itemId || seenIdsFull.has(itemId)) {
            itemId = nextId();
            while (seenIdsFull.has(itemId)) itemId = nextId();
            seenIdsFull.add(itemId);
            return { ...item, id: itemId };
          }
          seenIdsFull.add(itemId);
          if (itemId !== item.id) {
            return { ...item, id: itemId };
          }
        }
        return item;
      });
      ensureMutable()[key] = fixedArr;
    }
  }

  return result;
}

function applySharedLocalAuthToDb(db: AppDatabase): AppDatabase {
  const shared = loadSharedLocalAuth();
  if (!shared) return db;
  const users = Array.isArray(shared.users) && shared.users.length > 0
    ? shared.users.map((u) => ({
        ...u,
        allowedBranches: normalizeAllowedBranches(u.allowedBranches, u.role, u.permissions),
      }))
    : db.users.map((u) => ({
        ...u,
        allowedBranches: normalizeAllowedBranches(u.allowedBranches, u.role, u.permissions),
      }));
  const roles = Array.isArray(shared.roles) && shared.roles.length > 0 ? shared.roles : db.roles;
  return { ...db, users, roles };
}

/**
 * بارگیری نامتقارن پایگاه داده شعبه از IndexedDB (با ظرفیت نامحدود) و مهاجرت خودکار از LocalStorage
 */
export async function loadDatabaseAsync(branchId?: string): Promise<AppDatabase> {
  const targetBranchId = String(branchId || getActiveBranchId() || DEFAULT_BRANCH_ID).trim();
  const isDefaultBranch = targetBranchId === DEFAULT_BRANCH_ID;
  const lsKey = getBranchLocalStorageKey(targetBranchId);

  // 1. First attempt: Load from high-capacity IndexedDB
  try {
    const idbData = await loadFromIndexedDB(targetBranchId);
    if (idbData) {
      const { db: merged, migrated } = sanitizeAndMergeDatabaseWithMeta(idbData);
      const withShared = applySharedLocalAuthToDb(merged);
      if (targetBranchId === getActiveBranchId()) {
        inMemoryDb = withShared;
      }
      if (migrated) {
        saveToIndexedDB(withShared, targetBranchId).catch(() => {});
      }
      return withShared;
    }
  } catch (err) {
    console.warn('Notice reading from IndexedDB on startup:', err);
  }

  // 2. Migration: If not found in IndexedDB, attempt reading from LocalStorage
  try {
    const localData = localStorage.getItem(lsKey);
    if (localData) {
      const parsed = JSON.parse(localData);
      const { db: merged } = sanitizeAndMergeDatabaseWithMeta(parsed);
      const withShared = applySharedLocalAuthToDb(merged);
      if (targetBranchId === getActiveBranchId()) {
        inMemoryDb = withShared;
      }
      saveToIndexedDB(withShared, targetBranchId).catch(() => {});
      return withShared;
    }
  } catch (err) {
    console.warn('Notice reading from LocalStorage on startup:', err);
  }

  // 3. Fallback: Default branch gets starter DB; secondary branches start cleanly blank & isolated
  const shared = loadSharedLocalAuth();
  const initialDb = isDefaultBranch
    ? applySharedLocalAuthToDb(getInitialDatabase())
    : createBlankBranchDatabase(shared?.users, shared?.roles);

  if (targetBranchId === getActiveBranchId()) {
    inMemoryDb = initialDb;
  }
  saveToIndexedDB(initialDb, targetBranchId).catch(() => {});
  return initialDb;
}

export function loadDatabase(branchId?: string): AppDatabase {
  const targetBranchId = String(branchId || getActiveBranchId() || DEFAULT_BRANCH_ID).trim();
  if (inMemoryDb && targetBranchId === getActiveBranchId()) {
    return inMemoryDb;
  }

  const lsKey = getBranchLocalStorageKey(targetBranchId);
  try {
    const data = localStorage.getItem(lsKey);
    if (data) {
      const parsed = JSON.parse(data);
      const merged = applySharedLocalAuthToDb(sanitizeAndMergeDatabase(parsed));
      if (targetBranchId === getActiveBranchId()) {
        inMemoryDb = merged;
      }
      return merged;
    }
  } catch (e) {
    // Graceful fallback
  }

  const shared = loadSharedLocalAuth();
  const defaultDb =
    targetBranchId === DEFAULT_BRANCH_ID
      ? applySharedLocalAuthToDb(getInitialDatabase())
      : createBlankBranchDatabase(shared?.users, shared?.roles);
  if (targetBranchId === getActiveBranchId()) {
    inMemoryDb = defaultDb;
  }
  return defaultDb;
}

let sqlServerSaveDebounceTimeout: any = null;
let browserSaveDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingBrowserPersistDb: AppDatabase | null = null;
let pendingBrowserPersistBranchId: string = DEFAULT_BRANCH_ID;
let isLocalStorageOversized = false;
let unloadFlushRegistered = false;

let browserSaveSkipLocalStorage = false;

export function flushBrowserDatabaseSaveNow() {
  if (browserSaveDebounceTimeout) {
    clearTimeout(browserSaveDebounceTimeout);
    browserSaveDebounceTimeout = null;
  }
  const dbToFlush = pendingBrowserPersistDb;
  const branchToFlush = pendingBrowserPersistBranchId || getActiveBranchId();
  if (!dbToFlush) return;
  pendingBrowserPersistDb = null;

  // Keep local shared users/roles synced across all local branches
  if (!browserSaveSkipLocalStorage) {
    saveSharedLocalAuth(dbToFlush.users, dbToFlush.roles);
  }

  // 1. High-capacity, robust persistence in browser IndexedDB (isolated per branch)
  saveToIndexedDB(dbToFlush, branchToFlush).catch(err => {
    console.warn('IndexedDB save notice:', err);
  });

  // 2. Safe local storage write (skipped in PostgreSQL server mode or once quota is exceeded)
  const lsKey = getBranchLocalStorageKey(branchToFlush);
  if (!isLocalStorageOversized && !browserSaveSkipLocalStorage) {
    try {
      const serialized = JSON.stringify(dbToFlush);
      if (serialized.length > 4_000_000) {
        isLocalStorageOversized = true;
        try {
          localStorage.removeItem(lsKey);
        } catch (_) {}
      } else {
        localStorage.setItem(lsKey, serialized);
      }
    } catch (_quotaErr) {
      isLocalStorageOversized = true;
      try {
        localStorage.removeItem(lsKey);
      } catch (_) {}
    }
  }
}

export function saveDatabase(
  db: AppDatabase,
  options?: { skipLocalStorage?: boolean; branchId?: string; flushImmediate?: boolean }
) {
  try {
    const targetBranch = String(options?.branchId || getActiveBranchId() || DEFAULT_BRANCH_ID).trim();
    if (targetBranch === getActiveBranchId()) {
      inMemoryDb = db;
    }
    pendingBrowserPersistDb = db;
    pendingBrowserPersistBranchId = targetBranch;
    browserSaveSkipLocalStorage = Boolean(options?.skipLocalStorage);

    if (!unloadFlushRegistered && typeof window !== 'undefined') {
      unloadFlushRegistered = true;
      window.addEventListener('beforeunload', flushBrowserDatabaseSaveNow);
      window.addEventListener('pagehide', flushBrowserDatabaseSaveNow);
    }

    if (browserSaveDebounceTimeout) {
      clearTimeout(browserSaveDebounceTimeout);
      browserSaveDebounceTimeout = null;
    }

    if (options?.flushImmediate) {
      flushBrowserDatabaseSaveNow();
    } else {
      const debounceMs = options?.skipLocalStorage ? 1200 : 350;
      browserSaveDebounceTimeout = setTimeout(() => {
        flushBrowserDatabaseSaveNow();
      }, debounceMs);
    }

    // 3. If google sheets webhook script URL is configured and browser is online, queue/sync background
    const isWebHookUrl = Boolean(
      db.googleSheetsUrl &&
      (db.googleSheetsUrl.startsWith('https://script.google.com/') ||
      (db.googleSheetsUrl.startsWith('https://') && db.googleSheetsUrl.includes('/exec')))
    );
    if (isWebHookUrl && window.navigator.onLine) {
      syncWithGoogleSheets(db).catch(() => {});
    }

    // 4. Auto-sync to local store SQL Server backend if configured and enabled
    if (db.sqlServerConfig?.serverUrl && db.sqlServerConfig.autoSync) {
      if (sqlServerSaveDebounceTimeout) {
        clearTimeout(sqlServerSaveDebounceTimeout);
      }
      sqlServerSaveDebounceTimeout = setTimeout(() => {
        saveDatabaseToSqlServer(db).catch(err => {
          console.warn('Silent SQL Server auto-sync notice:', err);
        });
      }, 5000); // 5-second debounce for local network
    }
  } catch (e) {
    console.warn('Notice saving database:', e);
  }
}

/**
 * ذخیره داده‌های سیستم در دیتابیس SQL Server فروشگاه
 */
export async function saveDatabaseToSqlServer(dbData: AppDatabase): Promise<boolean> {
  const serverUrl = dbData.sqlServerConfig?.serverUrl;
  if (!serverUrl) return false;
  
  try {
    const res = await pushToSqlServer(serverUrl, dbData, dbData.sqlServerConfig?.apiKey);
    return res.success;
  } catch (error) {
    console.error('SQL Server push error:', error);
    return false;
  }
}

/**
 * بازیابی داده‌های سیستم از دیتابیس SQL Server فروشگاه
 */
export async function loadDatabaseFromSqlServer(serverUrl: string, apiKey?: string): Promise<AppDatabase | null> {
  if (!serverUrl) return null;
  try {
    const res = await pullFromSqlServer(serverUrl, apiKey);
    if (res.success && res.data) {
      return sanitizeAndMergeDatabase(res.data);
    }
    return null;
  } catch (error) {
    console.error('SQL Server pull error:', error);
    return null;
  }
}


// Background sync simulation & real fetcher to Google Sheets if configured
export async function syncWithGoogleSheets(db: AppDatabase): Promise<boolean> {
  if (!db.googleSheetsUrl) return false;

  // Only attempt HTTP fetch if googleSheetsUrl is an actual web app or webhook endpoint
  const url = db.googleSheetsUrl.trim();
  const isWebHookUrl = url.startsWith('https://script.google.com/') || 
                       (url.startsWith('https://') && url.includes('/exec'));
  if (!isWebHookUrl) {
    // If it's a Spreadsheet ID or non-webhook, do not perform direct fetch
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }, 8000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'syncDatabase',
        payload: db,
        timestamp: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (response.ok) {
      db.syncStatus = 'synced';
      db.lastSyncTime = new Date().toLocaleTimeString('fa-IR');
      // Save status back safely
      saveDatabase(db);
      return true;
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('Google Sheets connection error - client remains offline-safe:', err?.message || err);
    }
    db.syncStatus = 'offline';
    // Still save offline status safely
    saveDatabase(db);
  } finally {
    clearTimeout(timeoutId);
  }
  return false;
}

// Full Restore from master backup CSV
export function exportMasterCSV(db: AppDatabase): string {
  // We serialize our structured database collections into a clear single delimited text block
  // which can be opened in Excel, changed, and loaded back to rebuild everything perfectly.
  let output = '';
  
  const headers = {
    periods: ['PERIOD_ID', 'NAME', 'IS_ACTIVE', 'CREATED_AT'],
    items: ['ITEM_ID', 'PERIOD_ID', 'CODE', 'ACCOUNT_ID', 'NAME', 'CATEGORY_ID', 'UNIT', 'BARCODE', 'PACKAGE_TYPE', 'QTY_PER_PACK', 'WEIGHT_PER_PACK', 'ALERT_THRESHOLD', 'BUY_PRICE', 'IS_ACTIVE'],
    suppliers: ['SUPPLIER_ID', 'PERIOD_ID', 'NAME', 'PHONE', 'ADDRESS', 'IS_ACTIVE', 'ACCOUNTS_JSON', 'SUPPLIED_ITEMS_CSV'],
    products: ['PRODUCT_ID', 'PERIOD_ID', 'CODE', 'ACCOUNT_ID', 'NAME', 'CATEGORY_ID', 'UNIT', 'BARCODE', 'PACKAGE_TYPE', 'QTY_PER_PACK', 'WEIGHT_PER_PACK', 'SALE_PRICE', 'COGS_PRICE', 'APPROVED_PRICE'],
    productSales: ['SALE_ID', 'SALES_PERIOD_ID', 'PERIOD_ID', 'PRODUCT_ID', 'QTY_SOLD', 'DISCOUNT', 'PRE_DIS_AMOUNT', 'NET_SALES_AMOUNT'],
    personnel: ['EMPLOYEE_CODE', 'PERIOD_ID', 'ACCOUNT_CODE', 'FIRST_NAME', 'LAST_NAME', 'NATIONAL_ID', 'INSURANCE_CODE', 'FATHER_NAME', 'BIRTH_DATE', 'BIRTH_PLACE', 'CENTER', 'PROJECT', 'COMP_INSURANCE', 'YEARS_BASE', 'ENTRY_DATE', 'INSURANCE_DATE', 'DAILY_YEARS_DIFF', 'BANK_NAME', 'BANK_ACCOUNT', 'SHABA', 'CARD_NO', 'HAS_INSURANCE', 'EMPLOYER_PREM_3', 'EMPLOYER_PREM_20', 'WORKER_PREM_7', 'ATTRACT_AL', 'BASE_SAL_INS', 'DAILY_WAGE', 'IS_DAILY_WAGE', 'TAX_SHARE', 'CHILDREN_COUNT', 'IS_MARRIED', 'FIXED_ALLOWANCES', 'IS_ACTIVE'],
    periodOverheads: ['OVERHEAD_ID', 'PERIOD_ID', 'OPERATIONAL', 'DISTRIBUTION_SALES', 'FINANCIAL', 'ADMINISTRATIVE', 'RETURNS_OF_EXPENSE', 'TRANSFERRED_ACCOUNTING_COGS'],
  };

  // Section: Periods
  output += '===PERIODS===\n';
  output += headers.periods.join(',') + '\n';
  db.periods.forEach(p => {
    output += `${p.id},"${p.name}",${p.isActive},${p.createdAt}\n`;
  });

  // Section: Items
  output += '\n===ITEMS===\n';
  output += headers.items.join(',') + '\n';
  db.items.forEach(i => {
    output += `${i.id},${i.periodId},${i.code},${i.accountId},"${i.name}",${i.categoryId},${i.unit},${i.barcode},${i.packageType},${i.qtyPerPackage},${i.weightPerPackage},${i.reorderThreshold},${i.price},${i.isActive}\n`;
  });

  // Section: Suppliers
  output += '\n===SUPPLIERS===\n';
  output += headers.suppliers.join(',') + '\n';
  db.suppliers.forEach(s => {
    const accountsEsc = JSON.stringify(s.bankAccounts).replace(/"/g, '""');
    output += `${s.id},${s.periodId},"${s.name}","${s.phone}","${s.address}",${s.isActive},"${accountsEsc}","${s.suppliedItemIds.join(';')}"\n`;
  });

  // Section: Products
  output += '\n===PRODUCTS===\n';
  output += headers.products.join(',') + '\n';
  db.products.forEach(p => {
    output += `${p.id},${p.periodId},${p.code},${p.accountId},"${p.name}",${p.categoryId},${p.unit},${p.barcode},${p.packageType},${p.qtyPerPackage},${p.weightPerPackage},${p.salePrice},${p.cogsPrice},${p.approvedPrice !== undefined ? p.approvedPrice : ''}\n`;
  });

  // Section: Sales
  output += '\n===SALES===\n';
  output += headers.productSales.join(',') + '\n';
  db.productSales.forEach(s => {
    output += `${s.id},${s.salesPeriodId},${s.periodId},${s.productId},${s.qtySold},${s.discount},${s.preDiscountAmount},${s.netSalesAmount}\n`;
  });

  // Section: Personnel
  output += '\n===PERSONNEL===\n';
  output += headers.personnel.join(',') + '\n';
  db.personnel.forEach(emp => {
    output += `${emp.employeeCode},${emp.periodId},${emp.accountCode},"${emp.firstName}","${emp.lastName}",${emp.nationalId},${emp.insuranceCode},"${emp.fatherName}",${emp.birthDate},"${emp.birthPlace}","${emp.center}","${emp.project}",${emp.complementaryInsurance},${emp.yearsBase},${emp.entryDate},${emp.insuranceDate},${emp.dailyYearsDifference},"${emp.bankName}","${emp.bankAccount}","${emp.shaba}","${emp.cardNo}",${emp.hasInsurance},${emp.employerPremium3},${emp.employerPremium},${emp.workerPremium},${emp.attractionAllowance},${emp.baseSalaryInsurance},${emp.dailyWage},${emp.isDailyWage},${emp.taxShare},${emp.childrenCount},${emp.isMarried},${emp.fixedAllowances},${emp.isActive}\n`;
  });

  // Section: Overheads
  output += '\n===OVERHEADS===\n';
  output += headers.periodOverheads.join(',') + '\n';
  db.periodOverheads.forEach(oh => {
    output += `${oh.id},${oh.periodId},${oh.operational},${oh.distributionSales},${oh.financial},${oh.administrative},${oh.returnsOfExpense},${oh.transferredAccountingCogs !== undefined ? oh.transferredAccountingCogs : ''}\n`;
  });

  // Section: Production Settings
  output += '\n===PRODUCTION_SETTINGS===\n';
  output += 'SETTINGS_JSON\n';
  if (db.productionPlanningSettings) {
    const settingsEsc = JSON.stringify(db.productionPlanningSettings).replace(/"/g, '""');
    output += `"${settingsEsc}"\n`;
  }

  // Section: Production Orders
  output += '\n===PRODUCTION_ORDERS===\n';
  output += 'ORDERS_JSON\n';
  if (db.productionPlanningOrders && db.productionPlanningOrders.length > 0) {
    const ordersEsc = JSON.stringify(db.productionPlanningOrders).replace(/"/g, '""');
    output += `"${ordersEsc}"\n`;
  }

  return '\uFEFF' + output; // Add BOM for excel support
}

export function importMasterCSV(csvText: string, currentDb: AppDatabase): AppDatabase {
  const result: AppDatabase = { ...currentDb };
  
  // Clean numbers from Persian if users typed in Persian
  const lines = csvText.split('\n');
  let currentSection = '';
  
  let tempPeriods: Period[] = [];
  let tempItems: Item[] = [];
  let tempSuppliers: Supplier[] = [];
  let tempProducts: Product[] = [];
  let tempSales: ProductSale[] = [];
  let tempPersonnel: Personnel[] = [];
  let tempOverheads: PeriodOverhead[] = [];
  let importedSettings: any = null;
  let importedOrders: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('===') && line.endsWith('===')) {
      currentSection = line.substring(3, line.length - 3);
      continue;
    }

    const row = parseCSVLine(line);
    if (!row || row.length === 0) continue;

    // Skip Header line by checking if row is exactly headers
    if (
      row[0].includes('ID') || 
      row[0].includes('CODE') || 
      row[0].includes('EMPLOYEE') ||
      row[5] === 'CATEGORY_ID' ||
      row[2] === 'OPERATIONAL'
    ) {
      continue; // Skip headers
    }

    try {
      if (currentSection === 'PERIODS') {
        tempPeriods.push({
          id: row[0],
          name: row[1],
          isActive: row[2] === 'true',
          createdAt: row[3] || new Date().toISOString()
        });
      } else if (currentSection === 'ITEMS') {
        tempItems.push({
          id: row[0],
          periodId: row[1],
          code: row[2],
          accountId: row[3],
          name: row[4],
          categoryId: row[5],
          unit: row[6]?.trim() === 'عددی' ? 'عددی' : 'کیلویی',
          barcode: row[7],
          packageType: (row[8] || 'کارتن') as any,
          qtyPerPackage: parseFloat(row[9]) || 1,
          weightPerPackage: parseFloat(row[10]) || 1,
          reorderThreshold: parseFloat(row[11]) || 0,
          price: parseFloat(row[12]) || 0,
          isActive: row[13] !== 'false'
        });
      } else if (currentSection === 'SUPPLIERS') {
        let bankAccounts: any[] = [];
        try {
          // Restore nested JSON objects escaping two quotes
          const rawJson = row[6] ? row[6].replace(/""/g, '"') : '[]';
          bankAccounts = JSON.parse(rawJson);
        } catch {
          bankAccounts = [];
        }
        const suppliedItemIds = row[7] ? row[7].split(';').filter(id => id.trim()) : [];
        tempSuppliers.push({
          id: row[0],
          periodId: row[1],
          name: row[2],
          phone: row[3],
          address: row[4],
          isActive: row[5] !== 'false',
          bankAccounts,
          suppliedItemIds
        });
      } else if (currentSection === 'PRODUCTS') {
        tempProducts.push({
          id: row[0],
          periodId: row[1],
          code: row[2],
          accountId: row[3],
          name: row[4],
          categoryId: row[5],
          unit: row[6]?.trim() === 'کیلو' ? 'کیلو' : 'عدد',
          barcode: row[7],
          packageType: (row[8] || 'سلفون') as any,
          qtyPerPackage: parseFloat(row[9]) || 1,
          weightPerPackage: parseFloat(row[10]) || 1,
          salePrice: parseFloat(row[11]) || 0,
          cogsPrice: parseFloat(row[12]) || 0,
          approvedPrice: row[13] !== undefined && row[13].trim() !== '' ? parseFloat(row[13]) : undefined
        });
      } else if (currentSection === 'SALES') {
        tempSales.push({
          id: row[0],
          salesPeriodId: row[1],
          periodId: row[2],
          productId: row[3],
          qtySold: parseFloat(row[4]) || 0,
          discount: parseFloat(row[5]) || 0,
          preDiscountAmount: parseFloat(row[6]) || 0,
          netSalesAmount: parseFloat(row[7]) || 0
        });
      } else if (currentSection === 'PERSONNEL') {
        tempPersonnel.push({
          id: `emp-${row[0]}`,
          employeeCode: row[0],
          periodId: row[1],
          accountCode: row[2],
          firstName: row[3],
          lastName: row[4],
          nationalId: row[5],
          insuranceCode: row[6],
          fatherName: row[7],
          birthDate: row[8],
          birthPlace: row[9],
          center: row[10],
          project: row[11],
          complementaryInsurance: row[12] === 'true',
          yearsBase: parseFloat(row[13]) || 0,
          entryDate: row[14],
          insuranceDate: row[15],
          dailyYearsDifference: parseFloat(row[16]) || 0,
          bankName: row[17],
          bankAccount: row[18],
          shaba: row[19],
          cardNo: row[20],
          hasInsurance: row[21] === 'true',
          employerPremium3: parseFloat(row[22]) || 0,
          employerPremium: parseFloat(row[23]) || 0,
          workerPremium: parseFloat(row[24]) || 0,
          attractionAllowance: parseFloat(row[25]) || 0,
          baseSalaryInsurance: parseFloat(row[26]) || 0,
          dailyWage: parseFloat(row[27]) || 0,
          isDailyWage: row[28] === 'true',
          taxShare: parseFloat(row[29]) || 0,
          childrenCount: parseInt(row[30], 10) || 0,
          isMarried: row[31] === 'true',
          fixedAllowances: parseFloat(row[32]) || 0,
          isActive: row[33] !== 'false'
        });
      } else if (currentSection === 'OVERHEADS') {
        tempOverheads.push({
          id: row[0],
          periodId: row[1],
          operational: parseFloat(row[2]) || 0,
          distributionSales: parseFloat(row[3]) || 0,
          financial: parseFloat(row[4]) || 0,
          administrative: parseFloat(row[5]) || 0,
          returnsOfExpense: parseFloat(row[6]) || 0,
          transferredAccountingCogs: row[7] !== undefined && row[7].trim() !== '' ? parseFloat(row[7]) : undefined
        });
      } else if (currentSection === 'PRODUCTION_SETTINGS') {
        try {
          const rawJson = row[0] ? row[0].replace(/""/g, '"') : '';
          if (rawJson) {
            importedSettings = JSON.parse(rawJson);
          }
        } catch (e) {
          console.error('Error importing production settings:', e);
        }
      } else if (currentSection === 'PRODUCTION_ORDERS') {
        try {
          const rawJson = row[0] ? row[0].replace(/""/g, '"') : '';
          if (rawJson) {
            importedOrders = JSON.parse(rawJson);
          }
        } catch (e) {
          console.error('Error importing production orders:', e);
        }
      }
    } catch (e) {
      console.error('Error importing line in section', currentSection, e);
    }
  }

  // Override db lists if we successfully loaded values
  if (tempPeriods.length > 0) result.periods = tempPeriods;
  if (tempItems.length > 0) result.items = tempItems;
  if (tempSuppliers.length > 0) result.suppliers = tempSuppliers;
  if (tempProducts.length > 0) result.products = tempProducts;
  if (tempSales.length > 0) result.productSales = tempSales;
  if (tempPersonnel.length > 0) result.personnel = tempPersonnel;
  if (tempOverheads.length > 0) result.periodOverheads = tempOverheads;
  if (importedSettings) result.productionPlanningSettings = importedSettings;
  if (importedOrders && importedOrders.length > 0) result.productionPlanningOrders = importedOrders;

  return result;
}

// Simple CSV line parser respecting quotation escaping
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let currentWord = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentWord += '"'; // Escaped quote inside quotes
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(currentWord.trim());
      currentWord = '';
    } else {
      currentWord += char;
    }
  }
  result.push(currentWord.trim());
  return result;
}
