/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppDatabase } from '../types';
import { createSimpleIdGenerator, getPrefixForCollection } from './simpleId';
import { formatWithCommas, normalizePersianString, toPersianDigits } from './persianUtils';
import {
  getPeriodBarcodeSettings,
  getPeriodPayrollRules,
  getPeriodProductionSettings,
  setPeriodBarcodeSettings,
  setPeriodPayrollRules,
  setPeriodProductionSettings,
} from './periodIsolation';

export type CopySectionKey =
  | 'items'
  | 'itemCategories'
  | 'unitsOfMeasurement'
  | 'warehouses'
  | 'purchaseInvoices'
  | 'stockCountAudits'
  | 'suppliers'
  | 'customers'
  | 'customerCategories'
  | 'customerProductionOrders'
  | 'products'
  | 'productCategories'
  | 'departments'
  | 'packagingTypes'
  | 'salesPeriods'
  | 'salesTransactions'
  | 'barcodeSettings'
  | 'productFormulas'
  | 'unitConversions'
  | 'dailyProductionSegments'
  | 'productionPlanningSettings'
  | 'productionPlanningOrders'
  | 'procurementOrders'
  | 'bankAccounts'
  | 'cashDrawers'
  | 'posTerminals'
  | 'cashiers'
  | 'chequeBooks'
  | 'treasuryReceipts'
  | 'treasuryPayments'
  | 'barterTransactions'
  | 'counterpartySettlements'
  | 'cashierShiftCloseouts'
  | 'personnel'
  | 'personnelCategories'
  | 'personnelContracts'
  | 'personnelAllocations'
  | 'salaryBaseRates'
  | 'shifts'
  | 'productionSections'
  | 'shiftAssignments'
  | 'monthlyWorkdaySettings'
  | 'officialHolidays'
  | 'payrollCalculationRules'
  | 'taxExemptions'
  | 'taxBrackets'
  | 'seniorityRateRules'
  | 'insuredSalaryItems'
  | 'leaveBuyoutSalaryItems'
  | 'taxableSalaryItems'
  | 'payrollPeriods'
  | 'attendanceRecords'
  | 'personnelSettlements'
  | 'periodOverheads'
  | 'dibalScales'
  | 'dibalPLUs'
  | 'dibalTickets';

export interface CopySectionMeta {
  key: CopySectionKey;
  title: string;
  description: string;
  isSingleton?: boolean;
}

export interface CopyPreviewItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface CopyExecutionResult {
  updatedDb: AppDatabase;
  copiedCount: number;
  skippedCount: number;
  autoCreatedDeps: string[];
}

export const COPY_SECTION_META: Record<CopySectionKey, CopySectionMeta> = {
  items: { key: 'items', title: 'کالاها و مواد اولیه', description: 'کپی کالاها همراه با تطبیق خودکار دسته‌بندی و انبار' },
  itemCategories: { key: 'itemCategories', title: 'دسته‌بندی کالاها', description: 'گروه‌بندی مواد اولیه انبار' },
  unitsOfMeasurement: { key: 'unitsOfMeasurement', title: 'واحدهای سنجش', description: 'واحدهای اندازه‌گیری (کیلوگرم، عدد، لیتر و...)' },
  warehouses: { key: 'warehouses', title: 'انبارها', description: 'فهرست انبارهای نگهداری کالا' },
  purchaseInvoices: { key: 'purchaseInvoices', title: 'فاکتورهای خرید', description: 'سوابق فاکتورهای خرید مواد اولیه' },
  stockCountAudits: { key: 'stockCountAudits', title: 'دوره‌های انبارگردانی', description: 'دوره‌های شمارش انبار همراه با ردیف‌های شمارش' },
  suppliers: { key: 'suppliers', title: 'تامین‌کنندگان', description: 'فهرست تامین‌کنندگان و حساب‌های بانکی آن‌ها' },
  customers: { key: 'customers', title: 'مشتریان', description: 'فهرست مشتریان همراه با تطبیق گروه مشتری' },
  customerCategories: { key: 'customerCategories', title: 'گروه‌های مشتری', description: 'دسته‌بندی مشتریان و درصد تخفیف پیش‌فرض' },
  customerProductionOrders: { key: 'customerProductionOrders', title: 'سفارش‌های تولید مشتری', description: 'سفارش‌های اختصاصی مشتریان' },
  products: { key: 'products', title: 'محصولات فروش', description: 'کاتالوگ محصولات همراه با تطبیق دسته و دپارتمان' },
  productCategories: { key: 'productCategories', title: 'دسته‌بندی محصولات', description: 'گروه‌های محصول و اتصال به دپارتمان' },
  departments: { key: 'departments', title: 'دپارتمان‌های تولید', description: 'بخش‌های اصلی (نان، قنادی، کافه، فینگرفود، مشترک)' },
  packagingTypes: { key: 'packagingTypes', title: 'انواع بسته‌بندی', description: 'ظروف، جعبه‌ها و وزن ظرف بسته‌بندی' },
  salesPeriods: { key: 'salesPeriods', title: 'دوره‌ها و آمار فروش', description: 'دوره‌های فروش همراه با ردیف‌های فروش محصولات' },
  salesTransactions: { key: 'salesTransactions', title: 'ریز تراکنش‌های فروش', description: 'فاکتورها و تراکنش‌های فروش روزانه' },
  barcodeSettings: { key: 'barcodeSettings', title: 'پروفایل‌ها و تنظیمات بارکد', description: 'تنظیمات بارکد وزنی و تعدادی', isSingleton: true },
  productFormulas: { key: 'productFormulas', title: 'فرمولاسیون محصولات (BOM)', description: 'دستور ساخت و مواد تشکیل‌دهنده محصولات' },
  unitConversions: { key: 'unitConversions', title: 'ضرایب تبدیل واحد', description: 'تبدیل واحد خرید به واحد مصرف در فرمولاسیون' },
  dailyProductionSegments: { key: 'dailyProductionSegments', title: 'بازه‌های تولید روزانه', description: 'زمان‌بندی و حجم تولید محصولات' },
  productionPlanningSettings: { key: 'productionPlanningSettings', title: 'تنظیمات برنامه‌ریزی تولید', description: 'فرها، سینی‌ها، قفسه‌ها و تنظیمات پخت هر محصول', isSingleton: true },
  productionPlanningOrders: { key: 'productionPlanningOrders', title: 'برنامه‌های تولید ثبت‌شده', description: 'برنامه‌های پخت و چیدمان قفسه‌ها' },
  procurementOrders: { key: 'procurementOrders', title: 'سفارش‌های خرید کالا', description: 'درخواست‌های خرید هفتگی و تامین' },
  bankAccounts: { key: 'bankAccounts', title: 'حساب‌های بانکی', description: 'اطلاعات حساب‌های بانکی و شبا' },
  cashDrawers: { key: 'cashDrawers', title: 'صندوق‌های نقدی و تنخواه', description: 'فهرست صندوق‌های فروشگاهی و کارگاهی' },
  posTerminals: { key: 'posTerminals', title: 'دستگاه‌های کارتخوان (POS)', description: 'ترمینال‌های بانکی متصل به حساب و صندوق' },
  cashiers: { key: 'cashiers', title: 'صندوق‌داران', description: 'اطلاعات صندوق‌داران و شیفت‌های آن‌ها' },
  chequeBooks: { key: 'chequeBooks', title: 'دسته‌چک‌ها و برگه‌ها', description: 'دسته‌چک‌های بانکی همراه با برگه‌های چک' },
  treasuryReceipts: { key: 'treasuryReceipts', title: 'اسناد دریافت', description: 'دریافت‌های نقدی، کارتخوان، حواله و چک' },
  treasuryPayments: { key: 'treasuryPayments', title: 'اسناد پرداخت', description: 'پرداخت‌های نقدی، بانکی و چک' },
  barterTransactions: { key: 'barterTransactions', title: 'اسناد تهاتر', description: 'مبادلات تهاتری بین طرف‌حساب‌ها' },
  counterpartySettlements: { key: 'counterpartySettlements', title: 'تسویه طرف‌حساب‌ها', description: 'اسناد تسویه مشتریان و تامین‌کنندگان' },
  cashierShiftCloseouts: { key: 'cashierShiftCloseouts', title: 'بستن شیفت صندوق', description: 'گزارش‌های تحویل و بستن شیفت صندوق‌داران' },
  personnel: { key: 'personnel', title: 'فهرست پرسنل', description: 'مشخصات پرسنل، اطلاعات بانکی و بیمه‌ای' },
  personnelCategories: { key: 'personnelCategories', title: 'دسته‌بندی پرسنل', description: 'گروه‌های پرسنلی (تولید، اداری، پشتیبانی و...)' },
  personnelContracts: { key: 'personnelContracts', title: 'قراردادهای پرسنل', description: 'قراردادهای کاری و دستمزد پرسنل' },
  personnelAllocations: { key: 'personnelAllocations', title: 'تسهیم پرسنل در دپارتمان‌ها', description: 'تخصیص سهم حقوق پرسنل به دپارتمان‌ها' },
  salaryBaseRates: { key: 'salaryBaseRates', title: 'نرخ‌ها و ثوابت حقوق پایه', description: 'مزد روزانه، بن، مسکن، اولاد، اضافه‌کاری' },
  shifts: { key: 'shifts', title: 'شیفت‌های کاری', description: 'تعریف ساعات شروع و پایان شیفت‌ها' },
  productionSections: { key: 'productionSections', title: 'بخش‌های کاری و تولید', description: 'ایستگاه‌های کاری و حداقل نیروی مورد نیاز' },
  shiftAssignments: { key: 'shiftAssignments', title: 'برنامه چیدمان شیفت‌ها', description: 'انتساب پرسنل به شیفت‌ها و بخش‌ها' },
  monthlyWorkdaySettings: { key: 'monthlyWorkdaySettings', title: 'روزهای کاری ماهانه', description: 'تعداد روز کاری و ساعات موظفی هر ماه' },
  officialHolidays: { key: 'officialHolidays', title: 'تعطیلات رسمی', description: 'فهرست تاریخ‌های تعطیل رسمی سال' },
  payrollCalculationRules: { key: 'payrollCalculationRules', title: 'قوانین محاسبه حقوق و تردد', description: 'ضوابط اضافه‌کاری، تاخیر، کسر زمان و مالیات', isSingleton: true },
  taxExemptions: { key: 'taxExemptions', title: 'سقف معافیت مالیاتی', description: 'معافیت مالیاتی سالانه حقوق' },
  taxBrackets: { key: 'taxBrackets', title: 'پلکان‌های مالیاتی', description: 'نرخ‌های پلکانی مالیات حقوق' },
  seniorityRateRules: { key: 'seniorityRateRules', title: 'جدول پایه سنوات', description: 'نرخ روزانه سنوات بر اساس سابقه' },
  insuredSalaryItems: { key: 'insuredSalaryItems', title: 'اقلام مشمول بیمه', description: 'آیتم‌های حقوقی مشمول کسر حق بیمه' },
  leaveBuyoutSalaryItems: { key: 'leaveBuyoutSalaryItems', title: 'اقلام مبنای بازخرید مرخصی', description: 'آیتم‌های مبنای محاسبه مرخصی' },
  taxableSalaryItems: { key: 'taxableSalaryItems', title: 'اقلام مشمول مالیات', description: 'آیتم‌های حقوقی مشمول مالیات' },
  payrollPeriods: { key: 'payrollPeriods', title: 'لیست‌های حقوق ماهانه', description: 'دوره‌های حقوق همراه با ریز فیش پرسنل' },
  attendanceRecords: { key: 'attendanceRecords', title: 'سوابق تردد پرسنل', description: 'ورود و خروج‌های ثبت‌شده پرسنل' },
  personnelSettlements: { key: 'personnelSettlements', title: 'اسناد تسویه حساب پرسنل', description: 'محاسبات تسویه پایان کار و قرارداد' },
  periodOverheads: { key: 'periodOverheads', title: 'هزینه‌ها و مخارج سربار', description: 'هزینه‌های عملیاتی، توزیع، مالی و اداری' },
  dibalScales: { key: 'dibalScales', title: 'تنظیمات ترازوهای دیبال', description: 'پیکربندی شبکه و مشخصات ترازوها' },
  dibalPLUs: { key: 'dibalPLUs', title: 'جدول کالاهای ترازو (PLU)', description: 'کدهای PLU، قیمت و کلیدهای مستقیم' },
  dibalTickets: { key: 'dibalTickets', title: 'قبوض ترازو دیبال', description: 'تراکنش‌های توزین دریافت‌شده از ترازو' },
};

const norm = (v: unknown) => normalizePersianString(v ?? '');

function getSourceRecords(db: AppDatabase, section: CopySectionKey, sourcePeriodId: string): any[] {
  if (section === 'barcodeSettings') {
    const cfg = getPeriodBarcodeSettings(db, sourcePeriodId);
    return cfg.profiles || [];
  }
  if (section === 'productionPlanningSettings') {
    const cfg = getPeriodProductionSettings(db, sourcePeriodId);
    const hasContent =
      (cfg.ovens?.length || 0) > 0 ||
      (cfg.trays?.length || 0) > 0 ||
      (cfg.productAssignments?.length || 0) > 0 ||
      (cfg.racks?.length || 0) > 0;
    return hasContent ? [{ id: 'settings', ...cfg }] : [];
  }
  if (section === 'payrollCalculationRules') {
    const map = db.payrollCalculationRulesByPeriod;
    return map && map[sourcePeriodId] ? [{ id: 'rules', ...map[sourcePeriodId] }] : [];
  }
  const arr = (db as any)[section];
  if (!Array.isArray(arr)) return [];
  return arr.filter((r: any) => r && r.periodId === sourcePeriodId);
}

export function getCopyPreviewItems(
  db: AppDatabase,
  section: CopySectionKey,
  sourcePeriodId: string
): CopyPreviewItem[] {
  const rows = getSourceRecords(db, section, sourcePeriodId);
  return rows.map((r: any) => {
    switch (section) {
      case 'items':
        return {
          id: r.id,
          title: r.name || 'کالای بدون نام',
          subtitle: [r.code && `کد: ${toPersianDigits(r.code)}`, r.accountId && `معین: ${toPersianDigits(r.accountId)}`, r.unit].filter(Boolean).join(' · '),
          meta: r.price ? `${formatWithCommas(r.price)} ریال` : undefined,
        };
      case 'products':
        return {
          id: r.id,
          title: r.name || 'محصول بدون نام',
          subtitle: [r.code && `کد: ${toPersianDigits(r.code)}`, r.accountId && `حسابداری: ${toPersianDigits(r.accountId)}`, r.isWip ? 'نیمه‌ساخته' : r.unit].filter(Boolean).join(' · '),
          meta: r.salePrice ? `${formatWithCommas(r.salePrice)} ریال` : undefined,
        };
      case 'itemCategories':
      case 'productCategories':
      case 'departments':
      case 'customerCategories':
      case 'personnelCategories':
      case 'warehouses':
      case 'unitsOfMeasurement':
      case 'packagingTypes':
        return {
          id: r.id,
          title: r.name || r.id,
          subtitle: [r.code && `کد: ${toPersianDigits(r.code)}`, r.symbol, r.location, r.description].filter(Boolean).join(' · '),
        };
      case 'suppliers':
        return {
          id: r.id,
          title: r.name || r.id,
          subtitle: [r.phone && toPersianDigits(r.phone), r.address].filter(Boolean).join(' · '),
        };
      case 'customers':
        return {
          id: r.id,
          title: r.name || r.id,
          subtitle: [r.code && toPersianDigits(r.code), r.phone && toPersianDigits(r.phone), r.type].filter(Boolean).join(' · '),
        };
      case 'personnel':
        return {
          id: r.id,
          title: r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.employeeCode,
          subtitle: [`کد پرسنلی: ${toPersianDigits(r.employeeCode || '-')}`, r.role || r.center].filter(Boolean).join(' · '),
          meta: r.isActive === false ? 'غیرفعال' : 'فعال',
        };
      case 'personnelContracts':
        return {
          id: r.id,
          title: `${r.fullName || r.employeeCode} — ${r.role || 'قرارداد'}`,
          subtitle: `${toPersianDigits(r.contractStartDate || '')} تا ${toPersianDigits(r.contractEndDate || '')}`,
          meta: r.contractBaseSalary ? `${formatWithCommas(r.contractBaseSalary)} ریال` : undefined,
        };
      case 'productFormulas': {
        const prod = (db.products || []).find(
          (p) => p.periodId === sourcePeriodId && (p.accountId === r.productId || p.id === r.productId)
        );
        return {
          id: r.id,
          title: prod ? `${prod.name} (${r.name || 'فرمول اصلی'})` : `فرمول ${toPersianDigits(r.productId)}`,
          subtitle: `${toPersianDigits(r.ingredients?.length || 0)} ماده اولیه`,
        };
      }
      case 'unitConversions': {
        const item = (db.items || []).find((i) => i.id === r.rawMaterialId);
        return {
          id: r.id,
          title: item?.name || r.rawMaterialId,
          subtitle: `هر ۱ ${r.purchaseUnit} = ${toPersianDigits(r.factor)} ${r.consumptionUnit}`,
        };
      }
      case 'bankAccounts':
        return {
          id: r.id,
          title: `${r.bankName} — ${r.branchName || r.accountHolder}`,
          subtitle: `حساب: ${toPersianDigits(r.accountNo)}`,
          meta: r.initialBalance ? `${formatWithCommas(r.initialBalance)} ریال` : undefined,
        };
      case 'cashDrawers':
        return {
          id: r.id,
          title: r.name,
          subtitle: [r.code && toPersianDigits(r.code), r.location].filter(Boolean).join(' · '),
        };
      case 'posTerminals':
        return {
          id: r.id,
          title: `${r.pspName} — پایانه ${toPersianDigits(r.terminalId)}`,
          subtitle: [r.model, r.connectionType].filter(Boolean).join(' · '),
        };
      case 'cashiers':
        return {
          id: r.id,
          title: r.fullName,
          subtitle: [r.code && toPersianDigits(r.code), r.shiftType && `شیفت ${r.shiftType}`].filter(Boolean).join(' · '),
        };
      case 'chequeBooks':
        return {
          id: r.id,
          title: `سری ${toPersianDigits(r.series)} (${toPersianDigits(r.startNumber)} تا ${toPersianDigits(r.endNumber)})`,
          subtitle: r.description || `${toPersianDigits(r.totalLeaves)} برگ`,
        };
      case 'treasuryReceipts':
        return {
          id: r.id,
          title: `${toPersianDigits(r.receiptNo)} — ${r.counterpartyName}`,
          subtitle: `${toPersianDigits(r.date)} · ${r.category || r.description || ''}`,
          meta: `${formatWithCommas(r.amount)} ریال`,
        };
      case 'treasuryPayments':
        return {
          id: r.id,
          title: `${toPersianDigits(r.paymentNo)} — ${r.beneficiaryName}`,
          subtitle: `${toPersianDigits(r.date)} · ${r.category || r.description || ''}`,
          meta: `${formatWithCommas(r.amount)} ریال`,
        };
      case 'barterTransactions':
        return {
          id: r.id,
          title: `${toPersianDigits(r.barterNo)} — ${r.partyAName} / ${r.partyBName}`,
          subtitle: toPersianDigits(r.date),
          meta: `${formatWithCommas(r.amount)} ریال`,
        };
      case 'counterpartySettlements':
        return {
          id: r.id,
          title: `${toPersianDigits(r.settlementNo)} — ${r.partyName}`,
          subtitle: toPersianDigits(r.date),
          meta: `${formatWithCommas(r.totalSettledAmount)} ریال`,
        };
      case 'cashierShiftCloseouts':
        return {
          id: r.id,
          title: `${toPersianDigits(r.closeoutNo)} — ${r.cashierName}`,
          subtitle: `${toPersianDigits(r.date)} · ${r.cashDrawerName || ''}`,
        };
      case 'salaryBaseRates':
        return {
          id: r.id,
          title: `نرخ پایه سال ${toPersianDigits(r.year)}`,
          subtitle: `مزد روزانه: ${formatWithCommas(r.dailyBaseSalary)} ریال`,
        };
      case 'shifts':
        return {
          id: r.id,
          title: r.name,
          subtitle: `${toPersianDigits(r.startTime)} تا ${toPersianDigits(r.endTime)}`,
        };
      case 'productionSections':
        return {
          id: r.id,
          title: r.name,
          subtitle: `حداقل پرسنل: ${toPersianDigits(r.minStaff)} نفر`,
        };
      case 'monthlyWorkdaySettings':
        return {
          id: r.id,
          title: `سال ${toPersianDigits(r.year)} — ماه ${toPersianDigits(r.month)}`,
          subtitle: `${toPersianDigits(r.workingDaysCount)} روز کاری · ${toPersianDigits(r.requiredWorkHours)} ساعت`,
        };
      case 'officialHolidays':
        return {
          id: r.id,
          title: toPersianDigits(r.date),
          subtitle: `سال ${toPersianDigits(r.year)}`,
        };
      case 'periodOverheads':
        return {
          id: r.id,
          title: r.month ? `سربار ماه ${toPersianDigits(r.month)} / ${toPersianDigits(r.year || '')}` : 'سربار دوره',
          subtitle: `عملیاتی: ${formatWithCommas(r.operational)} · اداری: ${formatWithCommas(r.administrative)}`,
        };
      case 'barcodeSettings':
        return {
          id: r.id,
          title: r.name,
          subtitle: `پیش‌کد: ${toPersianDigits(r.prefix)} · ${r.symbology}`,
        };
      case 'productionPlanningSettings':
        return {
          id: 'settings',
          title: 'کل تنظیمات تجهیزات و ظرفیت تولید',
          subtitle: `${toPersianDigits(r.ovens?.length || 0)} فر · ${toPersianDigits(r.trays?.length || 0)} نوع سینی · ${toPersianDigits(r.productAssignments?.length || 0)} محصول`,
        };
      case 'payrollCalculationRules':
        return {
          id: 'rules',
          title: 'قوانین و ضوابط محاسبه حقوق و تردد',
          subtitle: `اضافه‌کاری، تعطیل‌کاری، تاخیر و کسر زمان`,
        };
      case 'dibalScales':
        return {
          id: r.id,
          title: r.name,
          subtitle: `${r.model} · IP: ${r.ipAddress}`,
        };
      case 'dibalPLUs':
        return {
          id: r.id,
          title: `PLU ${toPersianDigits(r.pluCode)} — ${r.name}`,
          meta: `${formatWithCommas(r.pricePerKg)} ریال`,
        };
      case 'stockCountAudits':
        return {
          id: r.id,
          title: r.title,
          subtitle: toPersianDigits(r.date),
        };
      case 'purchaseInvoices':
        return {
          id: r.id,
          title: `فاکتور ${toPersianDigits(r.invoiceNumber || r.id)}`,
          subtitle: `${toPersianDigits(r.date)} · ${toPersianDigits(r.items?.length || 0)} قلم`,
        };
      case 'salesPeriods':
        return {
          id: r.id,
          title: r.name,
          subtitle: `${toPersianDigits(r.startDate)} تا ${toPersianDigits(r.endDate)}`,
        };
      case 'payrollPeriods':
        return {
          id: r.id,
          title: r.title,
          subtitle: r.dateRange,
        };
      case 'customerProductionOrders':
        return {
          id: r.id,
          title: `${toPersianDigits(r.orderNumber)} — ${r.customerName}`,
          subtitle: `تحویل: ${toPersianDigits(r.deliveryDate)}`,
          meta: `${formatWithCommas(r.totalAmount)} ریال`,
        };
      case 'procurementOrders':
        return {
          id: r.id,
          title: r.title || `سفارش ${toPersianDigits(r.orderDate)}`,
          subtitle: `${toPersianDigits(r.items?.length || 0)} ردیف`,
        };
      case 'personnelSettlements':
        return {
          id: r.id,
          title: `${toPersianDigits(r.settlementNo)} — کد پرسنلی ${toPersianDigits(r.employeeCode)}`,
          subtitle: toPersianDigits(r.settlementDate),
          meta: `${formatWithCommas(r.finalNetPayable)} ریال`,
        };
      default:
        return {
          id: r.id,
          title: r.name || r.title || r.itemName || r.employeeCode || r.fiscalYear || r.date || r.id,
          subtitle: r.description || r.date || r.fiscalYear || undefined,
        };
    }
  });
}

function getBusinessSignature(section: CopySectionKey, rec: any): string {
  switch (section) {
    case 'items':
    case 'products':
      return norm(rec.accountId || rec.code || rec.name);
    case 'itemCategories':
    case 'productCategories':
    case 'departments':
    case 'warehouses':
    case 'unitsOfMeasurement':
    case 'packagingTypes':
    case 'customerCategories':
    case 'personnelCategories':
    case 'shifts':
    case 'productionSections':
      return norm(rec.name);
    case 'suppliers':
      return norm(rec.name);
    case 'customers':
      return norm(rec.code || rec.nationalId || rec.name);
    case 'personnel':
      return norm(rec.employeeCode || rec.nationalId || rec.fullName);
    case 'bankAccounts':
      return norm(rec.accountNo || rec.shaba);
    case 'cashDrawers':
      return norm(rec.code || rec.name);
    case 'posTerminals':
      return norm(rec.terminalId);
    case 'cashiers':
      return norm(rec.code || rec.fullName);
    case 'chequeBooks':
      return `${norm(rec.series)}::${rec.startNumber}`;
    case 'productFormulas':
      return `${norm(rec.productId)}::${norm(rec.name || 'اصلی')}`;
    case 'unitConversions':
      return `${norm(rec.rawMaterialId)}::${norm(rec.consumptionUnit)}`;
    case 'salaryBaseRates':
      return norm(rec.year);
    case 'monthlyWorkdaySettings':
      return `${rec.year}-${rec.month}`;
    case 'officialHolidays':
      return norm(rec.date);
    case 'dibalScales':
      return `${rec.scaleId}::${norm(rec.ipAddress)}`;
    case 'dibalPLUs':
      return String(rec.pluCode);
    case 'barcodeSettings':
      return `${norm(rec.prefix)}::${norm(rec.name)}`;
    case 'insuredSalaryItems':
    case 'leaveBuyoutSalaryItems':
    case 'taxableSalaryItems':
      return norm(rec.itemKey || rec.itemName);
    case 'taxExemptions':
      return norm(rec.fiscalYear);
    case 'seniorityRateRules':
      return `${norm(rec.fiscalYear)}::${rec.seniorityYears}`;
    default:
      return '';
  }
}

/**
 * Executes a controlled cross-period copy with simple sequential ID generation,
 * smart deduplication (append mode) or clean target replacement (replace mode),
 * and automatic foreign-key remapping into the target period.
 */
export function executeCopyFromPeriod(
  db: AppDatabase,
  options: {
    section: CopySectionKey;
    sourcePeriodId: string;
    targetPeriodId: string;
    selectedIds: string[];
    mode: 'append' | 'replace';
  }
): CopyExecutionResult {
  const { section, sourcePeriodId, targetPeriodId, selectedIds, mode } = options;
  const selectedSet = new Set(selectedIds);
  const autoCreatedDeps: string[] = [];

  if (sourcePeriodId === targetPeriodId || selectedSet.size === 0) {
    return { updatedDb: db, copiedCount: 0, skippedCount: 0, autoCreatedDeps };
  }

  // Handle period-scoped singleton configurations first
  if (section === 'payrollCalculationRules') {
    const srcRules = getPeriodPayrollRules(db, sourcePeriodId);
    return {
      updatedDb: setPeriodPayrollRules(db, targetPeriodId, { ...srcRules }),
      copiedCount: 1,
      skippedCount: 0,
      autoCreatedDeps,
    };
  }

  if (section === 'barcodeSettings') {
    const srcCfg = getPeriodBarcodeSettings(db, sourcePeriodId);
    const tgtCfg = getPeriodBarcodeSettings(db, targetPeriodId);
    const chosen = (srcCfg.profiles || []).filter((p) => selectedSet.has(p.id));
    const baseProfiles = mode === 'replace' ? [] : [...(tgtCfg.profiles || [])];
    const existingSigs = new Set(baseProfiles.map((p) => getBusinessSignature('barcodeSettings', p)));
    const nextBpId = createSimpleIdGenerator(baseProfiles, 'bp');
    let copied = 0;
    let skipped = 0;
    for (const prof of chosen) {
      const sig = getBusinessSignature('barcodeSettings', prof);
      if (mode === 'append' && sig && existingSigs.has(sig)) {
        skipped += 1;
        continue;
      }
      baseProfiles.push({ ...prof, id: nextBpId() });
      if (sig) existingSigs.add(sig);
      copied += 1;
    }
    const nextCfg = {
      ...srcCfg,
      ...tgtCfg,
      defaultWeightedPrefix: mode === 'replace' ? srcCfg.defaultWeightedPrefix : tgtCfg.defaultWeightedPrefix || srcCfg.defaultWeightedPrefix,
      defaultCountPrefix: mode === 'replace' ? srcCfg.defaultCountPrefix : tgtCfg.defaultCountPrefix || srcCfg.defaultCountPrefix,
      profiles: baseProfiles,
    };
    return {
      updatedDb: setPeriodBarcodeSettings(db, targetPeriodId, nextCfg),
      copiedCount: copied,
      skippedCount: skipped,
      autoCreatedDeps,
    };
  }

  if (section === 'productionPlanningSettings') {
    const srcCfg = getPeriodProductionSettings(db, sourcePeriodId);
    // Map productIds by matching code/name/accountId in targetPeriodId
    const srcProducts = (db.products || []).filter((p) => p.periodId === sourcePeriodId);
    const tgtProducts = (db.products || []).filter((p) => p.periodId === targetPeriodId);
    const mapProdId = (oldProdId: string) => {
      const sp = srcProducts.find((p) => p.id === oldProdId);
      if (!sp) return oldProdId;
      const tp = tgtProducts.find(
        (p) =>
          (sp.accountId && norm(p.accountId) === norm(sp.accountId)) ||
          (sp.code && norm(p.code) === norm(sp.code)) ||
          norm(p.name) === norm(sp.name)
      );
      return tp ? tp.id : oldProdId;
    };
    const clonedSettings = {
      ...srcCfg,
      periodId: targetPeriodId,
      ovens: (srcCfg.ovens || []).map((o) => ({ ...o })),
      trays: (srcCfg.trays || []).map((t) => ({ ...t })),
      racks: (srcCfg.racks || []).map((r) => ({ ...r })),
      productAssignments: (srcCfg.productAssignments || []).map((pa) => ({
        ...pa,
        productId: mapProdId(pa.productId),
      })),
    };
    return {
      updatedDb: setPeriodProductionSettings(db, targetPeriodId, clonedSettings),
      copiedCount: 1,
      skippedCount: 0,
      autoCreatedDeps,
    };
  }

  // Standard isolated array collection copy
  const working: any = { ...db };
  const allCollection: any[] = Array.isArray(working[section]) ? [...working[section]] : [];
  const sourceRows = allCollection.filter(
    (r) => r && r.periodId === sourcePeriodId && selectedSet.has(r.id)
  );

  if (sourceRows.length === 0) {
    return { updatedDb: db, copiedCount: 0, skippedCount: 0, autoCreatedDeps };
  }

  // Helper to resolve or auto-create dependent master record by name/code in target period
  const ensureTargetRef = (
    depKey: keyof AppDatabase,
    sourceId: string | undefined,
    matchFn: (src: any, tgt: any) => boolean,
    labelFa: string,
    extraTransform?: (src: any) => Record<string, any>
  ): string | undefined => {
    if (!sourceId) return sourceId;
    const depArr: any[] = Array.isArray(working[depKey]) ? working[depKey] : [];
    const srcObj = depArr.find((x) => x && x.id === sourceId);
    if (!srcObj) return sourceId;
    const existingTgt = depArr.find((x) => x && x.periodId === targetPeriodId && matchFn(srcObj, x));
    if (existingTgt) return existingTgt.id;
    const gen = createSimpleIdGenerator(depArr, getPrefixForCollection(depKey));
    const newId = gen();
    const cloned = {
      ...srcObj,
      ...(extraTransform ? extraTransform(srcObj) : {}),
      id: newId,
      periodId: targetPeriodId,
    };
    working[depKey] = [...depArr, cloned];
    if (!autoCreatedDeps.includes(labelFa)) {
      autoCreatedDeps.push(labelFa);
    }
    return newId;
  };

  // Helper to resolve existing reference in target period (without auto-creating heavy docs)
  const findTargetRef = (
    depKey: keyof AppDatabase,
    sourceId: string | undefined,
    matchFn: (src: any, tgt: any) => boolean
  ): string | undefined => {
    if (!sourceId) return sourceId;
    const depArr: any[] = Array.isArray(working[depKey]) ? working[depKey] : [];
    const srcObj = depArr.find((x) => x && x.id === sourceId);
    if (!srcObj) return sourceId;
    const existingTgt = depArr.find((x) => x && x.periodId === targetPeriodId && matchFn(srcObj, x));
    return existingTgt ? existingTgt.id : sourceId;
  };

  const baseCollection =
    mode === 'replace'
      ? allCollection.filter((r) => r?.periodId !== targetPeriodId)
      : [...allCollection];

  const existingTargetRows = baseCollection.filter((r) => r?.periodId === targetPeriodId);
  const existingSignatures = new Set(
    existingTargetRows
      .map((r) => getBusinessSignature(section, r))
      .filter((s) => Boolean(s))
  );

  // If replacing parent collections that own child rows, also remove target period children
  if (mode === 'replace') {
    if (section === 'chequeBooks') {
      working.chequeLeaves = (working.chequeLeaves || []).filter((l: any) => l?.periodId !== targetPeriodId);
    } else if (section === 'stockCountAudits') {
      working.stockCounts = (working.stockCounts || []).filter((c: any) => c?.periodId !== targetPeriodId);
    } else if (section === 'salesPeriods') {
      working.productSales = (working.productSales || []).filter((s: any) => s?.periodId !== targetPeriodId);
    } else if (section === 'payrollPeriods') {
      working.payrollItems = (working.payrollItems || []).filter((p: any) => p?.periodId !== targetPeriodId);
    }
  }

  const nextId = createSimpleIdGenerator(allCollection, getPrefixForCollection(section));
  const copiedRows: any[] = [];
  const copiedIdMap = new Map<string, string>();
  let skippedCount = 0;

  for (const row of sourceRows) {
    const sig = getBusinessSignature(section, row);
    if (mode === 'append' && sig && existingSignatures.has(sig)) {
      skippedCount += 1;
      continue;
    }

    const newId = nextId();
    const cloned: any = { ...row, id: newId, periodId: targetPeriodId };

    // Section-specific foreign-key remapping
    if (section === 'items') {
      cloned.categoryId =
        ensureTargetRef('itemCategories', row.categoryId, (s, t) => norm(s.name) === norm(t.name), 'دسته‌بندی کالاها') ||
        row.categoryId;
      if (row.warehouse) {
        cloned.warehouse =
          ensureTargetRef('warehouses', row.warehouse, (s, t) => norm(s.name) === norm(t.name), 'انبارها') ||
          row.warehouse;
      }
    } else if (section === 'productCategories') {
      if (row.departmentId) {
        cloned.departmentId = ensureTargetRef(
          'departments',
          row.departmentId,
          (s, t) => norm(s.name) === norm(t.name),
          'دپارتمان‌های تولید'
        );
      }
    } else if (section === 'products') {
      cloned.categoryId =
        ensureTargetRef(
          'productCategories',
          row.categoryId,
          (s, t) => norm(s.name) === norm(t.name),
          'دسته‌بندی محصولات',
          (srcCat) => ({
            departmentId: srcCat.departmentId
              ? ensureTargetRef(
                  'departments',
                  srcCat.departmentId,
                  (s, t) => norm(s.name) === norm(t.name),
                  'دپارتمان‌های تولید'
                )
              : undefined,
          })
        ) || row.categoryId;
    } else if (section === 'suppliers') {
      if (Array.isArray(row.suppliedItemIds)) {
        cloned.suppliedItemIds = row.suppliedItemIds.map(
          (oldItemId: string) =>
            findTargetRef('items', oldItemId, (s, t) => norm(s.code || s.name) === norm(t.code || t.name)) || oldItemId
        );
      }
    } else if (section === 'customers') {
      if (row.categoryId) {
        cloned.categoryId = ensureTargetRef(
          'customerCategories',
          row.categoryId,
          (s, t) => norm(s.name) === norm(t.name),
          'گروه‌های مشتری'
        );
      }
    } else if (section === 'unitConversions') {
      cloned.rawMaterialId =
        findTargetRef('items', row.rawMaterialId, (s, t) => norm(s.accountId || s.code || s.name) === norm(t.accountId || t.code || t.name)) ||
        row.rawMaterialId;
    } else if (section === 'dailyProductionSegments') {
      cloned.productId =
        findTargetRef('products', row.productId, (s, t) => norm(s.accountId || s.code || s.name) === norm(t.accountId || t.code || t.name)) ||
        row.productId;
    } else if (section === 'posTerminals') {
      cloned.bankAccountId =
        ensureTargetRef('bankAccounts', row.bankAccountId, (s, t) => norm(s.accountNo) === norm(t.accountNo), 'حساب‌های بانکی') ||
        row.bankAccountId;
      if (row.cashDrawerId) {
        cloned.cashDrawerId = ensureTargetRef(
          'cashDrawers',
          row.cashDrawerId,
          (s, t) => norm(s.code || s.name) === norm(t.code || t.name),
          'صندوق‌ها'
        );
      }
    } else if (section === 'cashiers') {
      if (row.defaultCashDrawerId) {
        cloned.defaultCashDrawerId = ensureTargetRef(
          'cashDrawers',
          row.defaultCashDrawerId,
          (s, t) => norm(s.code || s.name) === norm(t.code || t.name),
          'صندوق‌ها'
        );
      }
    } else if (section === 'cashDrawers') {
      if (row.cashierId) {
        cloned.cashierId = findTargetRef('cashiers', row.cashierId, (s, t) => norm(s.code || s.fullName) === norm(t.code || t.fullName));
      }
    } else if (section === 'chequeBooks') {
      cloned.bankAccountId =
        ensureTargetRef('bankAccounts', row.bankAccountId, (s, t) => norm(s.accountNo) === norm(t.accountNo), 'حساب‌های بانکی') ||
        row.bankAccountId;
    } else if (section === 'personnel') {
      if (row.personnelCategoryId) {
        cloned.personnelCategoryId = ensureTargetRef(
          'personnelCategories',
          row.personnelCategoryId,
          (s, t) => norm(s.name) === norm(t.name),
          'دسته‌بندی پرسنل'
        );
      }
      if (row.fixedShiftId) {
        cloned.fixedShiftId = findTargetRef('shifts', row.fixedShiftId, (s, t) => norm(s.name) === norm(t.name));
      }
    } else if (section === 'personnelAllocations') {
      cloned.departmentCategoryId =
        ensureTargetRef('departments', row.departmentCategoryId, (s, t) => norm(s.name) === norm(t.name), 'دپارتمان‌های تولید') ||
        row.departmentCategoryId;
    } else if (section === 'productionSections') {
      if (row.departmentCategoryId) {
        cloned.departmentCategoryId = ensureTargetRef(
          'departments',
          row.departmentCategoryId,
          (s, t) => norm(s.name) === norm(t.name),
          'دپارتمان‌های تولید'
        );
      }
    } else if (section === 'shiftAssignments') {
      cloned.shiftId = findTargetRef('shifts', row.shiftId, (s, t) => norm(s.name) === norm(t.name)) || row.shiftId;
      cloned.deptId =
        findTargetRef('productionSections', row.deptId, (s, t) => norm(s.name) === norm(t.name)) || row.deptId;
    } else if (section === 'dibalPLUs') {
      if (row.productId) {
        cloned.productId = findTargetRef('products', row.productId, (s, t) => norm(s.accountId || s.code || s.name) === norm(t.accountId || t.code || t.name));
      }
      if (row.itemId) {
        cloned.itemId = findTargetRef('items', row.itemId, (s, t) => norm(s.accountId || s.code || s.name) === norm(t.accountId || t.code || t.name));
      }
    }

    copiedRows.push(cloned);
    copiedIdMap.set(row.id, newId);
    if (sig) existingSignatures.add(sig);
  }

  working[section] = [...baseCollection, ...copiedRows];

  // Copy child collections for composite parents
  if (copiedIdMap.size > 0) {
    if (section === 'chequeBooks') {
      const existingLeaves: any[] = Array.isArray(working.chequeLeaves) ? [...working.chequeLeaves] : [];
      const nextLeafId = createSimpleIdGenerator(existingLeaves, 'leaf');
      const newBookMap = new Map(copiedRows.map((b) => [b.id, b]));
      const srcLeaves = (db.chequeLeaves || []).filter((l) => copiedIdMap.has(l.chequeBookId));
      const clonedLeaves = srcLeaves.map((leaf) => {
        const newBookId = copiedIdMap.get(leaf.chequeBookId)!;
        const newBook = newBookMap.get(newBookId);
        return {
          ...leaf,
          id: nextLeafId(),
          periodId: targetPeriodId,
          chequeBookId: newBookId,
          bankAccountId: newBook?.bankAccountId || leaf.bankAccountId,
        };
      });
      working.chequeLeaves = [...existingLeaves, ...clonedLeaves];
    } else if (section === 'stockCountAudits') {
      const existingCounts: any[] = Array.isArray(working.stockCounts) ? [...working.stockCounts] : [];
      const nextScId = createSimpleIdGenerator(existingCounts, 'sc');
      const srcCounts = (db.stockCounts || []).filter((c) => copiedIdMap.has(c.auditId));
      const clonedCounts = srcCounts.map((c) => ({
        ...c,
        id: nextScId(),
        periodId: targetPeriodId,
        auditId: copiedIdMap.get(c.auditId)!,
        itemId:
          findTargetRef('items', c.itemId, (s, t) => norm(s.code || s.name) === norm(t.code || t.name)) || c.itemId,
      }));
      working.stockCounts = [...existingCounts, ...clonedCounts];
    } else if (section === 'salesPeriods') {
      const existingSales: any[] = Array.isArray(working.productSales) ? [...working.productSales] : [];
      const nextSaleId = createSimpleIdGenerator(existingSales, 'sale');
      const srcSales = (db.productSales || []).filter((s) => copiedIdMap.has(s.salesPeriodId));
      const clonedSales = srcSales.map((s) => ({
        ...s,
        id: nextSaleId(),
        periodId: targetPeriodId,
        salesPeriodId: copiedIdMap.get(s.salesPeriodId)!,
        productId:
          findTargetRef('products', s.productId, (sp, tp) => norm(sp.code || sp.name) === norm(tp.code || tp.name)) ||
          s.productId,
      }));
      working.productSales = [...existingSales, ...clonedSales];
    } else if (section === 'payrollPeriods') {
      const existingPi: any[] = Array.isArray(working.payrollItems) ? [...working.payrollItems] : [];
      const nextPiId = createSimpleIdGenerator(existingPi, 'pi');
      const srcPi = (db.payrollItems || []).filter((pi) => pi.payrollPeriodId && copiedIdMap.has(pi.payrollPeriodId));
      const clonedPi = srcPi.map((pi) => ({
        ...pi,
        id: nextPiId(),
        periodId: targetPeriodId,
        payrollPeriodId: copiedIdMap.get(pi.payrollPeriodId!)!,
      }));
      working.payrollItems = [...existingPi, ...clonedPi];
    }
  }

  return {
    updatedDb: working as AppDatabase,
    copiedCount: copiedRows.length,
    skippedCount,
    autoCreatedDeps,
  };
}

/**
 * Copies selected records of a section from a completely separate source branch database
 * into the active branch database's target period while preserving strict branch & period isolation.
 */
export function executeCopyFromAnotherBranch(
  sourceDb: AppDatabase,
  targetDb: AppDatabase,
  options: {
    section: CopySectionKey;
    sourcePeriodId: string;
    targetPeriodId: string;
    selectedIds: string[];
    mode: 'append' | 'replace';
  }
): CopyExecutionResult {
  const VIRTUAL_PERIOD = '__cross_branch_copy_src__';
  const staged: any = { ...targetDb };

  // Stage every array collection from sourceDb that belongs to sourcePeriodId
  const allKeys = new Set<string>([
    ...Object.keys(sourceDb || {}),
    ...Object.keys(targetDb || {}),
  ]);
  const stagedArrayKeys: string[] = [];

  for (const key of allKeys) {
    if (key === 'periods' || key === 'users' || key === 'roles' || key === 'syncLogs') continue;
    const srcVal = (sourceDb as any)?.[key];
    if (!Array.isArray(srcVal)) continue;

    const srcMatching = srcVal
      .filter((r: any) => r && typeof r === 'object' && r.periodId === options.sourcePeriodId)
      .map((r: any) => ({ ...r, periodId: VIRTUAL_PERIOD }));

    if (srcMatching.length > 0) {
      const tgtArr = Array.isArray((targetDb as any)?.[key]) ? (targetDb as any)[key] : [];
      staged[key] = [...tgtArr, ...srcMatching];
      stagedArrayKeys.push(key);
    }
  }

  // Stage period-scoped singleton configurations
  staged.barcodeSettingsByPeriod = {
    ...(targetDb.barcodeSettingsByPeriod || {}),
    [VIRTUAL_PERIOD]: getPeriodBarcodeSettings(sourceDb, options.sourcePeriodId),
  };
  staged.productionPlanningSettingsByPeriod = {
    ...(targetDb.productionPlanningSettingsByPeriod || {}),
    [VIRTUAL_PERIOD]: getPeriodProductionSettings(sourceDb, options.sourcePeriodId),
  };
  staged.payrollCalculationRulesByPeriod = {
    ...(targetDb.payrollCalculationRulesByPeriod || {}),
    [VIRTUAL_PERIOD]: getPeriodPayrollRules(sourceDb, options.sourcePeriodId),
  };

  const result = executeCopyFromPeriod(staged as AppDatabase, {
    section: options.section,
    sourcePeriodId: VIRTUAL_PERIOD,
    targetPeriodId: options.targetPeriodId,
    selectedIds: options.selectedIds,
    mode: options.mode,
  });

  // Clean up all virtual staged records from the resulting target database
  const cleaned: any = { ...result.updatedDb };
  for (const key of stagedArrayKeys) {
    if (Array.isArray(cleaned[key])) {
      cleaned[key] = cleaned[key].filter((r: any) => !r || r.periodId !== VIRTUAL_PERIOD);
    }
  }
  if (cleaned.barcodeSettingsByPeriod) {
    const nextMap = { ...cleaned.barcodeSettingsByPeriod };
    delete nextMap[VIRTUAL_PERIOD];
    cleaned.barcodeSettingsByPeriod = nextMap;
  }
  if (cleaned.productionPlanningSettingsByPeriod) {
    const nextMap = { ...cleaned.productionPlanningSettingsByPeriod };
    delete nextMap[VIRTUAL_PERIOD];
    cleaned.productionPlanningSettingsByPeriod = nextMap;
  }
  if (cleaned.payrollCalculationRulesByPeriod) {
    const nextMap = { ...cleaned.payrollCalculationRulesByPeriod };
    delete nextMap[VIRTUAL_PERIOD];
    cleaned.payrollCalculationRulesByPeriod = nextMap;
  }

  return {
    ...result,
    updatedDb: cleaned as AppDatabase,
  };
}

