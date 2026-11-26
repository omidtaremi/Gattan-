/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type { BranchDefinition } from './shared/branches';

export interface Period {
  id: string; // e.g., "1405-01"
  name: string; // e.g., "دوره فروردین ۱۴۰۵"
  isActive: boolean;
  createdAt: string;
  startDate?: string;
  endDate?: string;
}

export interface ItemCategory {
  id: string;
  periodId: string;
  name: string;
}

export interface Warehouse {
  id: string;
  periodId: string;
  name: string;
  code?: string;
  location?: string;
  isActive?: boolean;
}

export interface Item {
  id: string;
  periodId: string;
  code: string;
  accountId: string; // کد حسابداری
  name: string;
  categoryId: string; // From ItemCategory
  unit: 'عددی' | 'کیلویی'; // default 'کیلویی'
  barcode: string;
  systemBarcode?: string; // بارکد شناسه سیستمی
  packageType: 'کارتن' | 'گونی' | 'سطل' | 'حلب'; // default 'کارتن'
  qtyPerPackage: number; // default 1
  weightPerPackage: number; // default 1
  reorderThreshold: number;
  price: number; // قیمت خرید پیش‌فرض / قیمت ریالی
  isActive: boolean;
  warehouse?: string; // انبار محل کالا
}

export interface PurchaseInvoiceItem {
  itemId: string;
  qty: number;
  price: number; // خرید ثبت شده
  packageCount: number;
}

export interface PurchaseInvoice {
  id: string;
  periodId: string;
  supplierId: string;
  date: string; // Jalali DATE, e.g. "1405/01/15"
  items: PurchaseInvoiceItem[];
  invoiceNumber: string;
}

export interface StockCountAudit {
  id: string;
  periodId: string;
  title: string;
  date: string; // Jalali
}

export interface StockCount {
  id: string;
  auditId: string;
  periodId: string;
  itemId: string;
  fullPackages: number; // تعداد بسته کامل
  looseQty: number; // مقدار جزئی
  totalCalculatedQty: number; // (Packs * PerPack) + Loose
  value: number; // value in Rials
  warehouse?: string; // انبار محل شمارش
  shelfLocation?: string; // قفسه یا جایگاه در انبار
  countDate?: string; // تاریخ یا زمان شمارش
  notes?: string; // توضیحات و یادداشت شمارش
}

export interface SupplierBankAccount {
  bankName: string;
  accountNo: string;
  shaba: string;
  cardNo: string;
}

export interface Supplier {
  id: string;
  periodId: string;
  name: string;
  phone: string;
  address: string;
  bankAccounts: SupplierBankAccount[];
  isActive: boolean;
  suppliedItemIds: string[]; // List of standard Item IDs
}

export interface CustomerBankAccount {
  bankName: string;
  accountNo: string;
  shaba: string;
  cardNo: string;
  accountHolder?: string;
}

export interface CustomerCategory {
  id: string;
  periodId?: string;
  name: string; // e.g. 'فروشگاه‌های زنجیره‌ای', 'عمده‌فروشان', 'خرده‌فروشان', 'سازمانی و ارگانی', 'کافه‌ها و هتل‌ها', 'VIP'
  code?: string;
  defaultDiscountPercent?: number; // درصد تخفیف پیش‌فرض
  defaultPaymentTerm?: string;
  description?: string;
}

export interface Customer {
  id: string;
  periodId: string;
  code: string; // کد مشتری مثلا C-101
  accountingCode?: string; // کد معین / تفصیلی حسابداری
  name: string; // نام شخص یا عنوان واحد تجاری
  type: 'حقیقی' | 'حقوقی' | 'فروشگاه' | 'سازمانی'; // نوع مشتری
  categoryId?: string; // شناسه گروه مشتری
  contactPerson?: string; // نام رابط / مدیر خرید
  nationalId?: string; // کد ملی شخص یا شناسه ملی شرکت
  economicCode?: string; // کد اقتصادی
  registrationNo?: string; // شماره ثبت
  phone: string; // تلفن همراه اصلی
  tel?: string; // تلفن ثابت
  fax?: string;
  email?: string;
  province?: string; // استان
  city?: string; // شهر
  postalCode?: string; // کد پستی ۱۰ رقمی
  address: string; // نشانی دقیق
  deliveryAddress?: string; // نشانی تحویل بار
  discountPercent?: number; // درصد تخفیف اختصاصی
  creditLimit?: number; // سقف اعتبار مالی به ریال
  settlementPeriodDays?: number; // مهلت تسویه به روز
  paymentTerms?: 'نقدی' | 'چک ۳۰ روزه' | 'چک ۶۰ روزه' | 'چک ۹۰ روزه' | 'اعتباری'; // نحوه تسویه پیش‌فرض
  salesAgent?: string; // بازاریاب یا کارشناس فروش
  bankAccounts?: CustomerBankAccount[]; // اطلاعات حساب‌های بانکی
  isActive: boolean; // وضعیت فعال بودن
  status?: 'active' | 'inactive' | 'blocked'; // وضعیت
  blockReason?: string; // دلیل مسدودی
  notes?: string; // یادداشت‌ها و مشخصات اعتباری
  preferredProductIds?: string[]; // محصولات پرتکرار / مورد علاقه
  createdAt?: string;
}

export interface Department {
  id: string;
  periodId: string;
  name: string;
  code?: string;
  targetMargin?: number;
  isShared?: boolean;
}

export interface ProductCategory {
  id: string;
  periodId: string;
  name: string;
  targetMargin?: number;
  departmentId?: string; // Mapped production Department ID
}

export interface Product {
  id: string;
  periodId: string;
  code: string;
  accountId: string;
  name: string;
  categoryId: string; // From ProductCategory
  unit: 'عدد' | 'کیلو'; // default 'عدد'
  barcode: string;
  barcodeType?: 'simple' | 'weighted_composite' | 'count_composite'; // نوع بارکد: ساده (ثابت) یا ترکیبی/متغیر (وزنی یا تعدادی ترازوی دیبال)
  itemIdentifierCode?: string; // کد شناسایی ۵ رقمی در ساختار بارکد متغیر (مثلاً 00123)
  dibalPluCode?: number; // کد PLU متناظر در ترازوی دیبال
  sku?: string; // کد کالا
  packageType: 'سلفون' | 'شیرینک' | 'لانچ باکس' | 'جعبه'; // default 'سلفون'
  qtyPerPackage: number; // default 1
  weightPerPackage: number; // default 1
  salePrice: number;
  cogsPrice: number; // Calculated or manually specified
  purchaseCost?: number; // بهای خرید پایه کالاهای خریداری‌شده (بدون فرمول تولید) جهت جلوگیری از خطای تجمعی سربار
  weight?: number; // وزن محصول (به گرم)
  approvedPrice?: number; // قیمت فروش تایید شده مصوب
  isWip?: boolean; // آیا کالای در جریان ساخت است یاخیر
}

export interface SalesPeriod {
  id: string;
  periodId: string;
  name: string; // Monthly name, e.g., "فروردین"
  startDate: string;
  endDate: string;
}

export interface ProductSale {
  id: string;
  salesPeriodId: string;
  periodId: string;
  productId: string;
  qtySold: number; // تعداد یا کیلو فروش رفته
  discount: number; // تخفیف
  preDiscountAmount: number; // مبلغ فروش قبل از تخفیف
  netSalesAmount: number; // مبلغ خالص فروش
  month?: number; // 1-12 ماه مالی
  year?: number; // سال مالی
}

export interface UnitConversion {
  id: string;
  periodId: string;
  rawMaterialId: string; // Item ID
  purchaseUnit: string; // Unit from Item (e.g., "کیلویی")
  consumptionUnit: string; // unit used in recipe (e.g. "گرم")
  factor: number; // e.g. 1000 (1 kg = 1000g)
}

export interface ProductFormulaItem {
  rawMaterialId: string; // کد معین حسابداری ماده اولیه یا کد حسابداری نیمه‌ساخته (یا شناسه در صورت نبود کد)
  quantity: number; // مصرف بر اساس واحد مصرف
}

export interface DailyProductionSegment {
  id: string;
  periodId: string;
  productId: string;
  startTime: string; // "hh:mm"
  endTime: string; // "hh:mm"
  producedQty: number;
}

export interface ProductFormula {
  id: string;
  periodId: string;
  productId: string; // کد حسابداری محصول (یا شناسه در صورت نبود کد)
  ingredients: ProductFormulaItem[];
  name?: string;
  isActive?: boolean;
}

export interface PersonnelChild {
  gender: 'پسر' | 'دختر';
  age: number;
  subjectToAllowance: boolean;
  isStudent?: boolean;
}

export interface PersonnelCategory {
  id: string;
  periodId?: string;
  name: string;
}

export interface Personnel {
  id: string; // local code / system id
  periodId: string;
  employeeCode: string;
  accountCode?: string;
  nationalId?: string;
  insuranceCode?: string;
  fatherName?: string;
  birthDate?: string;
  birthPlace?: string;
  center?: string;
  project?: string;
  complementaryInsurance?: boolean;
  yearsBase?: number;
  entryDate?: string;
  insuranceDate?: string;
  dailyYearsDifference?: number;
  bankName?: string;
  bankAccount?: string;
  shaba?: string;
  cardNo?: string;
  hasInsurance?: boolean;
  employerPremium3?: number; // حق بیمه ۳ درصد بیکاری
  employerPremium?: number; // حق بیمه کارفرما ۲۰ درصد
  workerPremium?: number; // حق بیمه کارگر ۷ درصد
  attractionAllowance?: number; // حق جذب
  baseSalaryInsurance?: number; // حقوق پایه بیمه
  dailyWage?: number;
  isDailyWage?: boolean;
  contractDailyWageAmount?: number;
  taxShare?: number;
  childrenCount?: number;
  isMarried?: boolean;
  fixedAllowances?: number;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  mobile?: string;
  role?: string;
  isActive: boolean;
  departureDate?: string; // تاریخ ترک کار (مثلاً 1405/04/15)
  departureReason?: string; // علت ترک کار (استعفا، پایان قرارداد، اخراج، توافقی، سایر)
  baseSalary?: number;
  insuranceHistory?: string | number;
  bankAccounts?: PersonnelBankAccount[];
  capabilities?: string[];
  attendanceCode?: string;
  postalCode?: string;
  jobAllowance?: number;
  isSubjectToEmployerPremium?: boolean;
  isSubjectToUnemploymentPremium?: boolean;
  isSubjectToWorkerPremium?: boolean;
  gender?: 'مرد' | 'زن';
  maritalStatus?: 'مجرد' | 'متاهل';
  childrenList?: PersonnelChild[];
  address?: string;
  emergencyMobile?: string;
  insuranceHistoryDays?: number;
  personnelCategoryId?: string;
  militaryStatus?: 'اتمام' | 'غیبت' | 'معافیت' | 'نامشخص' | '';
  hasNationalCardCopy?: boolean;
  hasBirthCertificatePagesCopy?: boolean;
  hasPhoto?: boolean;
  hasSocialSecurityRegistrationForm?: boolean;
  hasPromissoryNote?: boolean;
  hasHealthCard?: boolean;
  hasPreEmploymentExam?: boolean;
  promissoryNoteNumber?: string;
  promissoryNoteIssuerName?: string;
  promissoryNoteAmount?: number;
  hasSupplementaryInsurance?: boolean;
  supplementaryInsuranceDate?: string;
  supplementaryInsurancePremium?: number;
  contractStartDate?: string;
  contractEndDate?: string;
  contractDurationMonths?: number;
  contractBaseSalary?: number;
  contractDailySalary?: number;
  birthCertificateNumber?: string;
  dailySalaryInsurance?: number;
  shiftScheduleType?: 'rotating' | 'fixed';
  fixedShiftId?: string;
  personnel?: any; // Nested personnel object to save all fields
}

export interface PersonnelContract {
  id: string;
  employeeCode: string; // Dynamic reference to personnel
  periodId: string;
  contractStartDate: string;
  contractEndDate: string;
  contractDurationMonths: number;
  contractBaseSalary: number;
  contractDailySalary?: number;
  contractDailyWageAmount?: number;
  contractDailyInsuranceSalary?: number;
  contractBaseInsuranceSalary?: number;
  contractSeniorityBase?: number;
  calculatedWorkerPremium?: number; // سهم کارگر ۷٪
  calculatedEmployerPremium20?: number; // سهم کارفرما ۲۰٪
  calculatedUnemploymentPremium3?: number; // بیمه بیکاری ۳٪
  calculatedTotalEmployerPremium23?: number; // مجموع سهم کارفرما و بیکاری ۲۳٪
  role: string;
  // Metadata & notes:
  notes?: string;
  createdAt?: string;

  // Personal fields captured at contract time (optional snapshot or loaded from profile):
  fullName?: string;
  nationalId?: string;
  fatherName?: string;
  birthDate?: string;
  postalCode?: string;
  address?: string;
  mobile?: string;
  insuranceCode?: string;
  militaryStatus?: string;
  promissoryNoteNumber?: string;
  promissoryNoteAmount?: number;
  jobAllowance?: number;
  contract?: any; // Nested contract object to save salary & wage info
  isActive?: boolean; // وضعیت فعال بودن قرارداد (همیشه آخرین قرارداد هر پرسنل فعال است)
}


export interface ShiftAssignment {
  id: string;
  periodId?: string; // Scoped to period
  year?: number; // Scoped to fiscal year
  month?: number; // Scoped to Jalali month (1-12)
  dayName: string; // 'شنبه' etc.
  shiftId: string;
  deptId: string; // This represents sectionId now
  employeeCode: string;
  isSubstitute?: boolean;
  substitutedEmployeeCode?: string;
  isOnLeave?: boolean;
  isSurplus?: boolean;
  date?: string;
  employeeId?: string;
}

export interface ProductionSection {
  id: string;
  periodId?: string;
  name: string;
  minStaff: number; // minimum staff requirement
  startTime?: string; // added start time for section
  endTime?: string;   // added end time for section
  canBeEmpty?: boolean;
  departmentCategoryId?: string; // assigned production department ID
}

export interface ShiftScheme {
  id: string;
  periodId?: string;
  name: string;
  isActive: boolean;
  productionSections?: ProductionSection[];
  shiftAssignments?: ShiftAssignment[];
  personnelCapabilities?: Record<string, string[]>; // employeeCode -> array of sectionIds
}

export interface PersonnelBankAccount {
  bankName: string;
  accountNo: string;
  shaba: string;
  cardNo: string;
}

export interface PayrollPeriod {
  id: string;
  periodId: string;
  title: string;
  dateRange: string;
  month?: number;
  year?: number;
  status?: 'ثبت شده' | 'پیش‌نویس' | 'بسته شده';
  registeredAt?: string;
  totalEmployees?: number;
  totalNetPayable?: number;
  totalInsurance?: number;
  totalCost?: number;
  attendancePerformanceSnapshot?: any[];
}

export interface PayrollItem {
  id: string;
  payrollPeriodId?: string;
  periodId: string;
  employeeCode: string;
  month?: number;
  year?: number;
  baseSalary?: number;
  housingAllowance?: number;
  foodAllowance?: number;
  childAllowance?: number;
  overtimeHoursAmount?: number;
  deductionsAmount?: number;
  employerInsurance23?: number;
  payableAmount: number;
  employerPensionShare?: number; // بیمه کارفرما سهم ۲۰ درصد
  employerUnemploymentShare?: number; // بیمه بیکاری سهم ۳ درصد
  totalPayrollCost?: number; // جمع کل حقوق و بیمه

  // Detailed calculation fields (ریز محاسبات حقوق و دستمزد)
  attendanceDaysWorked?: number;
  workDaysCount?: number;
  insuranceDaysCount?: number;
  dailyBaseSalary?: number;
  dailyInsuranceSalary?: number;
  workedHours?: number;
  workedHoursHM?: string;
  overtimeHours?: number;
  overtimeHoursHM?: string;
  overtimePay?: number;
  fridayWorkHours?: number;
  fridayWorkHoursHM?: string;
  fridayWorkPay?: number;
  holidayWorkHours?: number;
  holidayWorkHoursHM?: string;
  holidayWorkPay?: number;
  marriageAllowance?: number;
  seniorityBase?: number;
  jobAllowance?: number;
  monthlyEidi?: number;
  monthlyYearsBenefit?: number;
  grossSalary?: number;
  workerInsurance7?: number;
  payrollTax?: number;
  supplementaryInsurance?: number;
  delayFineDeduction?: number;
  normalManagementDeductionHours?: number;
  normalManagementDeductionMinutes?: number;
  normalManagementDeductionHM?: string;
  managementOtDeductionHours?: number;
  managementOtDeductionMinutes?: number;
  managementOtDeductionHM?: string;
  insurableBase?: number;
  insuranceMonthlyBaseSalary?: number;
  insuranceMonthlyBenefits?: number;
  taxableBase?: number;
  totalInsurance30?: number;
}

export interface SalaryBaseRate {
  id: string;
  periodId: string; // Scoped period ID
  year: string; // "سال" (e.g. "1405", "1404")
  dailyBaseSalary: number; // "حقوق پایه روزانه"
  hourlyBaseSalary?: number; // "پایه حقوق ساعتی"
  dailyInsuranceSalary: number; // "حقوق پایه روزانه بیمه"
  housingAllowance: number; // "حق مسکن"
  foodAllowance: number; // "کمک هزینه اقلام مصرفی (حق بن)"
  childAllowance: number; // "حق اولاد"
  baseYearsRate: number; // "پایه سنوات"
  marriageAllowance: number; // "حق تاهل"
  taxableAmount: number; // "مبلغ مشمول مالیات"
  overtimeHourlyRate: number; // "مبلغ اضافه کاری ساعتی"
  fridayWorkHourlyRate?: number; // "حق جمعه کاری ساعتی (۴۰٪ حقوق پایه روزانه)"
  holidayWorkHourlyRate?: number; // "حق تعطیل کاری ساعتی"
  monthlyLeaveHours?: string; // "مرخصی ساعتی ماهانه" (فرمت HH:MM، پیش‌فرض 15:53)
}

export interface SeniorityRateRule {
  id: string;
  periodId?: string;
  seniorityYears: number; // سابقه (سال)
  dailyRate: number;      // مبلغ پایه سنوات روزانه
  fiscalYear: string;     // سال مالی
}

export interface PersonnelAllocation {
  id: string;
  periodId: string;
  employeeCode: string;
  departmentCategoryId: string; // ProductCategory ID
  salaryShare?: number; // Specific salary if specified, otherwise split evenly
}

export interface PeriodOverhead {
  id: string;
  periodId: string;
  month?: number; // 1-12 ماه مالی
  year?: number; // سال مالی
  operational: number; // هزینه های عملیاتی
  distributionSales: number; // توزیع و فروش
  financial: number; // مالی
  administrative: number; // اداری
  returnsOfExpense: number; // برگشت از هزینه (که کسر می‌شود)
  transferredAccountingCogs?: number; // بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل)
}

export interface SalesTransaction {
  id: string;
  periodId: string; // Scoped period ID
  invoiceNumber?: string; // شماره فاکتور
  customerName?: string; // نام مشتری
  customerCode?: string; // کد مشتری
  productCode: string; // کد کالا
  dateStr: string; // تاریخ
  productName: string; // نام کالا
  categoryName?: string; // گروه کالا
  qtySold: number; // تعداد فروش
  unitPrice: number; // فی
  discount: number; // تخفیف
  salesAmount: number; // مبلغ فروش
  time?: string; // زمان فروش (ساعت)
  hour: number; // ساعت (0-23)
  dayOfMonth: number; // روز ماه (1-31)
  weekday: string; // روز هفته
  productId?: string; // ID کالا متناظر در کاتالوگ
  categoryId?: string; // ID دسته محصول متناظر
  month?: number; // ماه مالی ۱ تا ۱۲
  year?: number; // سال مالی
}

export interface UnitOfMeasurement {
  id: string;
  periodId?: string;
  name: string; // e.g. 'کیلوگرم', 'عدد', 'لیتر'
  symbol?: string; // e.g. 'kg', 'pcs', 'L'
  description?: string;
  isActive?: boolean;
}

export interface PackagingType {
  id: string;
  periodId?: string;
  name: string; // e.g. 'سلفون', 'شیرینک', 'کارتن'
  code?: string; // e.g. 'PKG-01'
  tareWeightGrams?: number; // وزن ظروف/پوشش به گرم
  defaultQtyPerPackage?: number; // ظرفیت پیش‌فرض
  description?: string;
  isActive?: boolean;
}

export interface AppDatabase {
  periods: Period[];
  selectedPeriodId: string;
  itemCategories: ItemCategory[];
  items: Item[];
  suppliers: Supplier[];
  productCategories: ProductCategory[];
  departments?: Department[];
  products: Product[];
  salesPeriods: SalesPeriod[];
  productSales: ProductSale[];
  unitConversions: UnitConversion[];
  productFormulas: ProductFormula[];
  personnel: Personnel[];
  payrollPeriods: PayrollPeriod[];
  payrollItems: PayrollItem[];
  personnelAllocations: PersonnelAllocation[];
  periodOverheads: PeriodOverhead[];
  procurementOrders: ProcurementOrder[];
  stockCountAudits: StockCountAudit[];
  stockCounts: StockCount[];
  purchaseInvoices: PurchaseInvoice[];
  dailyProductionSegments?: DailyProductionSegment[];
  shiftAssignments?: ShiftAssignment[];
  productionSections?: ProductionSection[];
  shiftSchemes?: ShiftScheme[];
  roles?: import('./shared/rbac').UserRoleDefinition[];
  users: any[];
  currentUser: any | null;
  googleSheetsUrl: string;
  syncStatus: 'synced' | 'pending' | 'offline' | 'error';
  lastSyncTime: string;
  salesTransactions?: SalesTransaction[];
  warehouses?: Warehouse[];
  unitsOfMeasurement?: UnitOfMeasurement[];
  packagingTypes?: PackagingType[];
  salaryBaseRates?: SalaryBaseRate[];
  personnelCategories?: PersonnelCategory[];
  customBanks?: string[];
  personnelContracts?: PersonnelContract[];
  seniorityRateRules?: SeniorityRateRule[];
  insuredSalaryItems?: {
    id: string;
    periodId?: string;
    startDate?: string;
    endDate?: string;
    itemKey: string;
    itemName: string;
  }[];
  leaveBuyoutSalaryItems?: {
    id: string;
    periodId?: string;
    startDate?: string;
    endDate?: string;
    itemKey: string;
    itemName: string;
  }[];
  attendanceRecords?: AttendanceRecord[];
  monthlyWorkdaySettings?: MonthlyWorkdaySetting[];
  payrollSettings?: any[];
  payrollCalculationRules?: PayrollCalculationRules;
  officialHolidays?: OfficialHoliday[];
  contractTemplateText?: string;
  contractIntroText?: string;
  contractEmployerText?: string;
  contractLocationText?: string;
  contractHoursText?: string;
  contractRestText?: string;
  contractHolidayText?: string;
  contractPersonnelText?: string;
  taxExemptions?: {
    id: string;
    periodId?: string;
    fiscalYear: string;
    exemptionLimit: number;
  }[];
  taxBrackets?: {
    id: string;
    periodId?: string;
    fiscalYear: string;
    fromAmount: number;
    toAmount: number;
    taxRate: number;
  }[];
  taxableSalaryItems?: {
    id: string;
    periodId?: string;
    startDate?: string;
    endDate?: string;
    itemKey: string;
    itemName: string;
  }[];
  productionPlanningSettings?: any;
  productionPlanningSettingsByPeriod?: Record<string, ProductionPlanningSettings>;
  productionPlanningOrders?: any[];
  customerProductionOrders?: CustomerProductionOrder[];
  customerOrderPurposes?: string[];
  dibalScales?: DibalScaleConfig[];
  dibalPLUs?: DibalPLUMapping[];
  dibalTickets?: DibalWeighingTicket[];
  barcodeSettings?: BarcodeSettings;
  barcodeSettingsByPeriod?: Record<string, BarcodeSettings>;
  payrollCalculationRulesByPeriod?: Record<string, PayrollCalculationRules>;
  personnelCapabilitiesByPeriod?: Record<string, Record<string, string[]>>;
  customers?: Customer[];
  customerCategories?: CustomerCategory[];
  bankAccounts?: BankAccount[];
  cashDrawers?: CashDrawer[];
  posTerminals?: PosTerminal[];
  cashiers?: Cashier[];
  chequeBooks?: ChequeBook[];
  chequeLeaves?: ChequeLeaf[];
  treasuryReceipts?: TreasuryReceipt[];
  treasuryPayments?: TreasuryPayment[];
  barterTransactions?: BarterTransaction[];
  counterpartySettlements?: CounterpartySettlement[];
  cashierShiftCloseouts?: CashierShiftCloseout[];
  personnelSettlements?: PersonnelSettlement[];
  personnelCapabilities?: Record<string, string[]>;
  attendanceDeviceConfig?: AttendanceDeviceConfig;
  sqlServerConfig?: SqlServerConfig;
  approvedMismatches?: string[];
  approvedMismatchesByPeriod?: Record<string, string[]>;
  payrollManualOverrides?: Record<string, {
    workDays?: Record<string, number>;
    insuranceDays?: Record<string, number>;
    normalMgmtDeductions?: Record<string, number>;
  }>;
  digitalMenu?: import('./shared/digitalMenu').DigitalMenuConfig;
  digitalMenuByPeriod?: Record<string, any>;
  contractTemplatesByPeriod?: Record<string, any>;
}

export interface SqlServerConfig {
  serverUrl?: string; // e.g. "http://localhost:5000/api" or "http://192.168.1.100:5000/api"
  apiKey?: string;
  autoSync?: boolean;
  lastSyncTime?: string;
  status?: 'disconnected' | 'connected' | 'error';
}

export type DatabaseSchema = AppDatabase;

export interface BarcodeProfile {
  id: string;
  name: string; // e.g. "ترازوی دیبال بخش قنادی (پیش‌کد ۲۰)"
  type: 'weighted' | 'count' | 'simple'; // وزنی، تعدادی، یا ساده
  symbology: 'EAN-13' | 'CODE-128' | 'EAN-128' | 'QR';
  prefix: string; // e.g. "20", "21", "22"
  itemCodeLength: number; // default 5 (digits)
  valueLength: number; // default 5 (digits) for weight (in grams) or quantity
  hasCheckDigit: boolean; // default true (1 digit at end)
  unitMultiplier?: number; // e.g. 1000 for grams to kg, or 1 for quantity
  description?: string;
  isDefault?: boolean;
  patternSample?: string; // e.g. "20CCCCWWWWWC"
}

export interface BarcodeSettings {
  defaultWeightedPrefix: string; // e.g. "20"
  defaultCountPrefix: string; // e.g. "22"
  defaultSimpleLength?: number;
  profiles: BarcodeProfile[];
  autoParseOnScan?: boolean;
  enableSoundOnScan?: boolean;
}

export interface MonthlyWorkdaySetting {
  id: string;
  periodId?: string;
  year: number;
  month: number;
  daysInMonth: number;
  fridaysCount: number;
  nonFridayHolidays: number;
  workingDaysCount: number;
  requiredWorkHours: number;
}

export interface PayrollCalculationRules {
  calculateEarlyOvertime: boolean;
  calculateLateOvertime: boolean;
  calculateHolidayWork: boolean;
  calculateFridayWork: boolean;
  calculateEntryDelayFine: boolean;
  delayFineRate: number; // e.g. 1 minute delay = X minutes fine
  deductClothesChangingTime: boolean;
  clothesChangingDuration: number; // in minutes
  deductDailyBreakTime?: boolean; // آیا ساعت استراحت روزانه کسر شود
  dailyBreakDurationMinutes?: number; // مدت ساعت استراحت روزانه (مثلا ۴۰ دقیقه)
  calculatePayrollTax?: boolean;
}

export interface OfficialHoliday {
  id: string;
  periodId?: string;
  year: number;
  date: string; // YYYY/MM/DD
}

export interface AttendanceRecord {
  id: string;
  periodId: string;
  year: number;
  month: number;
  attendanceCode: string;
  employeeId?: string; // matches Personnel.id
  date: string; // Jalali Date, e.g. "1402/05/12"
  shiftId?: string; // Assigned shift or production section ID for this day
  shiftName?: string; // Human-readable shift or section name for this day
  times: string[]; // clock times, e.g., ["07:30", "16:45"]
  statuses?: number[]; // clock types: 0 for entry, 1 for exit
  errors?: string[];
  isSystemCorrected?: boolean;
  originalTimes?: string[];
  originalStatuses?: number[];
  correctionReport?: {
    originalTime: string;
    originalType: string;
    addedTime: string;
    addedType: string;
    shiftTimes: string;
    discrepancy: string;
  };
}

export type ProcurementItemStatus = 'pending' | 'purchased' | 'received' | 'carried_over';

export interface ProcurementOrderItem {
  lineId?: string;
  rawMaterialId?: string;
  productId?: string;
  supplierId?: string; // تامین‌کننده اختصاصی این ردیف کالا
  qtyProposed: number;
  estimatedCostPerUnit: number;
  totalEstimatedCost: number;
  lastPurchasePrice?: number;
  lastPurchasePriceSource?: 'invoice' | 'catalog';
  lastPurchaseDate?: string;
  itemStatus?: ProcurementItemStatus;
  isReceived?: boolean; // سازگاری با سفارش‌های قبلی (همگام با itemStatus === 'received')
  purchasedAt?: string;
  purchasedBy?: string;
  receivedQty?: number; // مقدار واقعی تحویل‌گرفته‌شده توسط پرسنل
  receivedBy?: string; // نام تحویل‌گیرنده
  receivedAt?: string; // تاریخ تایید دریافت
  receiptNotes?: string; // یادداشت تحویل یا علت مغایرت
  carriedOverFromOrderId?: string; // شناسه سفارش قبلی در صورت انتقال از جاماندگان
  carriedOverFromLineId?: string;
  carriedOverFromTitle?: string;
  carriedOverToOrderId?: string; // شناسه سفارش جدید در صورت انتقال به هفته بعد
  rowNotes?: string;
}

export interface ProcurementOrder {
  id: string;
  periodId: string;
  title?: string; // عنوان درخواست هفتگی (مثلاً سفارش هفته دوم اردیبهشت)
  requestedBy?: string; // نام پرسنل یا سرپرست درخواست‌کننده
  supplierId?: string; // اختیاری (برای سازگاری با سفارش‌های قبلی تک‌تامین‌کننده‌ای)
  orderDate: string;
  expectedDeliveryDate: string;
  items: ProcurementOrderItem[];
  totalBill: number;
  status: string;
  notes?: string;
  isActive?: boolean; // فعال یا غیرفعال (پس از پایان مهلت تحویل یا ثبت درخواست هفتگی جدید غیرفعال می‌شود)
  deactivatedAt?: string;
  deactivationReason?: 'new_order' | 'deadline_passed';
  createdAt?: string;
  updatedAt?: string;
}

export type CustomerProductionOrderStatus =
  | 'registered'
  | 'in_production'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export interface CustomerProductionOrderItem {
  lineId: string;
  productId?: string; // شناسه محصول از کاتالوگ (در صورت انتخاب از لیست)
  productName: string; // عنوان محصول (از کاتالوگ یا ورود دستی سفارشی)
  productCategoryName?: string; // نوع محصول / دسته‌بندی
  departmentId: string; // شناسه دپارتمان تولید
  departmentName: string; // نام دپارتمان تولید
  quantity: number; // تعداد سفارش
  unit: string; // واحد (عدد، کیلو، سینی، جعبه، بسته)
  weightOrSize?: string; // وزن، سایز یا تعداد نفر (مثلاً ۲ کیلو / ۱۲ نفره)
  flavorOrFilling?: string; // طعم، فیلینگ، مغز یا حساسیت غذایی
  needsInscription: boolean; // آیا مشتری نیاز به نوشتن جمله خاص روی محصول دارد؟
  inscriptionText?: string; // متن دقیق جمله روی محصول
  inscriptionStyle?: string; // رنگ یا مدل نوشتار/تزئین اختیاری
  sampleImages: string[]; // تصاویر نمونه درخواستی مشتری (فشرده‌شده Base64 DataURL)
  estimatedUnitPrice: number; // قیمت واحد برآوردی (ریال)
  totalPrice: number; // جمع ردیف (ریال)
  itemStatus: CustomerProductionOrderStatus; // وضعیت تولید این ردیف در دپارتمان مربوطه
  itemNotes?: string; // توضیحات فنی کارگاه برای این ردیف
}

export interface CustomerProductionOrder {
  id: string;
  orderNumber: string; // کد پیگیری سفارش تولید (مثلاً PO-1405-001)
  periodId: string;
  customerId?: string; // شناسه مشتری در سیستم
  customerName: string;
  customerPhone: string;
  customerCategoryId?: string;
  customerCategoryName?: string;
  orderDate: string; // تاریخ ثبت شمسی
  deliveryDate: string; // تاریخ تحویل شمسی
  deliveryTime: string; // ساعت تحویل (مثلاً 17:30)
  deliveryType: 'pickup' | 'delivery'; // تحویل حضوری یا ارسال با پیک
  deliveryAddress?: string; // نشانی تحویل در صورت ارسال با پیک
  recipientName?: string; // نام تحویل‌گیرنده سفارش
  recipientPhone?: string; // تلفن همراه تحویل‌گیرنده سفارش
  orderPurpose?: string; // هدف از سفارش / مناسبت (اختیاری - جهت پیگیری و بازاریابی)
  deliveryFee?: number; // هزینه ارسال (قدیمی - اختیاری)
  items: CustomerProductionOrderItem[]; // ردیف‌های سفارش (هر ردیف با دپارتمان مجزا)
  totalAmount: number; // مبلغ کل سفارش (شامل هزینه ارسال)
  prepaymentAmount: number; // مبلغ پیش‌پرداخت (بیعانه)
  remainingAmount: number; // مانده قابل پرداخت هنگام تحویل
  prepaymentMethod?: 'cash' | 'pos' | 'bank_transfer' | 'cheque';
  treasuryReceiptId?: string; // شناسه سند دریافت خزانه‌داری (در صورت ثبت اختیاری)
  treasuryReceiptNo?: string; // شماره سند خزانه‌داری
  status: CustomerProductionOrderStatus; // وضعیت کلی سفارش
  notes?: string; // توضیحات کلی سفارش
  registeredBy?: string; // کاربر ثبت‌کننده
  createdAt: string;
  updatedAt: string;
}

export type { UserRoleDefinition } from './shared/rbac';
export type {
  DigitalMenuLanguage,
  DigitalMenuCurrencyMode,
  DigitalMenuUnavailableMode,
  DigitalMenuAppearance,
  DigitalMenuCategory,
  DigitalMenuCategorySetting,
  DigitalMenuProductSetting,
  DigitalMenuConfig,
  PublicMenuCategory,
  PublicMenuProduct,
  PublicDigitalMenuPayload,
} from './shared/digitalMenu';

export interface User {
  id: string;
  username: string;
  fullName: string;
  name?: string; // added to support name fallback
  role: string;
  permissions: string[];
  allowedBranches?: string[];
  password: string;
  is2FA: boolean;
  secretCode: string;
  isActive?: boolean;
}

export interface ProductionOven {
  id: string;
  name: string;
  type: 'گردان' | 'طبقه ای';
  trayCapacity: number; // For deck ovens
}

export interface ProductionTray {
  id: string;
  name: string;
  totalCount: number;
  traysPerRackTier: number;
}

export interface ProductTrayAssignment {
  productId: string;
  trayTypeId: string;
  qtyPerTray: number;
  prodTimePerUnit: number; // in minutes
  needsProofing: boolean;
  proofingTime: number; // in minutes
  steamRequired: boolean;
  alternatingShelves: boolean;
  coolingTimePerUnit: number; // in minutes
  packagingTimePerUnit: number; // in minutes
  bakingSettings: Record<string, { temp: number; time: number }>; // ovenId -> {temp, time}
  allowedOvens?: string[]; // list of ovenIds that are permitted for this product
  kneadingTime?: number; // in minutes (standard kneading time defined per product)
  hasKneading?: boolean;
  hasProduction?: boolean;
  hasProofing?: boolean;
  hasBaking?: boolean;
  hasCooling?: boolean;
  hasPackaging?: boolean;
}

export interface ProductionRackDefinition {
  id: string;
  rackNumber: string;
  name: string;
  tiersCount: number;
}

export interface ProductionPlanningSettings {
  periodId: string;
  startHour: string; // e.g. "06:00"
  endHour: string; // e.g. "24:00"
  prepTimeMinutes: number; // 15
  kneadingTimeMinutes: number; // 20
  totalRacks: number;
  tiersPerRack: number;
  proofingMaxRacks: number;
  ovens: ProductionOven[];
  trays: ProductionTray[];
  productAssignments: ProductTrayAssignment[];
  racks?: ProductionRackDefinition[];
}

export interface ProductionRackOrderItem {
  productId: string;
  qtyToProduce: number;
  traysNeeded: number;
  priority: number;
}

export interface ProductionPlanningOrder {
  id: string;
  periodId: string;
  rackNumber: string; // e.g. "1", "2"
  bakingTechnique: 'عادی' | '8-8';
  items: ProductionRackOrderItem[];
  postBakeNotes?: string;
  dateStr: string; // "1405/01/15"
  calculateKneadingTime?: boolean; // user response for different sections override
}

export interface DibalScaleConfig {
  id: string;
  periodId?: string;
  name: string; // e.g. "ترازوی دیبال بخش فروشگاه - Tower M-525"
  model: string; // e.g. "Dibal Tower M-525"
  scaleId: number; // e.g. 1
  departmentId: number; // e.g. 1
  connectionType: 'ethernet' | 'serial' | 'wifi'; // default 'ethernet'
  ipAddress: string; // e.g. "192.168.1.150"
  subnetMask: string; // e.g. "255.255.255.0"
  gateway: string; // e.g. "192.168.1.1"
  txPort: number; // e.g. 3000 (Transmitter Port)
  rxPort: number; // e.g. 3001 (Receiver Port)
  comPort?: string; // e.g. "COM1"
  baudRate?: number; // e.g. 9600
  parity?: 'none' | 'even' | 'odd';
  stopBits?: number;
  barcodePrefix: string; // e.g. "21"
  isOnline: boolean;
  lastSyncTime?: string;
  autoSyncReceipts?: boolean;
}

export interface AttendanceDeviceConfig {
  id: string;
  name: string; // e.g. "دستگاه حضور و غیاب XFace 60 N"
  model: string; // "XFace 60 N"
  platform: string; // "ZMM510"
  connectionType: 'tcp_ip' | 'udp' | 'local_bridge';
  ipAddress: string; // e.g. "192.168.1.201"
  port: number; // default 4370
  commKey: number; // default 0
  bridgeUrl?: string; // e.g. "http://localhost:5005"
  autoSync: boolean;
  syncIntervalMinutes?: number;
  lastSyncTime?: string;
  isOnline: boolean;
  firmwareVersion?: string;
  serialNumber?: string;
  faceCount?: number;
  userCount?: number;
  logCount?: number;
}

export interface DibalPLUMapping {
  id: string;
  periodId?: string;
  pluCode: number; // 1 to 9999
  productId?: string; // linked to db.products
  itemId?: string; // linked to db.items
  name: string;
  secondName?: string; // Dibal dual-line label description (خط دوم نام کالا)
  pricePerKg: number; // Price per Kg or price per Unit depending on itemType
  itemType?: 'weighted' | 'unit'; // 'weighted' (وزنی - 0) or 'unit' (تعدادی/غیروزنی - 1) according to Dibal protocol standard
  priceType?: 'variable' | 'fixed'; // 'variable' (متغیر) or 'fixed' (مقطوع)
  directKeyNumber?: number; // Key 1 to 70 on Dibal M-525 keypad (تداخل‌گیری کلید میانبر)
  departmentCode: number; // Dibal Department (1 to 99)
  sectionCode?: number; // Dibal Section / Family Group (1 to 99)
  tareWeight: number; // in grams (تار/وزن ظرف)
  expiryDays: number; // Expiry days offset
  packOffsetDays?: number; // Packing date offset (روزهای تاریخ بسته‌بندی)
  vatRate?: number; // VAT percentage (نرخ مالیات ارزش افزوده)
  promoPrice?: number; // Special offer price (قیمت ویژه/تخفیف)
  ingredientsText?: string; // Ingredients text (متن ترکیبات و ارزش غذایی)
  barcodeFormat: string; // e.g. "21PPPWWWWWC"
  barcodeType?: 'EAN-13' | 'EAN-128' | 'CODE-128' | 'GS1-Databar';
  lastSentAt?: string;
  status: 'synced' | 'pending' | 'failed';
}

export interface DibalWeighingTicket {
  id: string;
  periodId?: string;
  scaleId: number;
  ticketNumber: number;
  date: string; // "1405/01/15"
  time: string; // "14:25:30"
  pluCode: number;
  itemName: string;
  itemType?: 'weighted' | 'unit'; // 'weighted' (وزنی) or 'unit' (تعدادی/غیروزنی)
  quantity?: number; // Quantity for unit items (e.g. 1, 2, 5 pieces) or 1 for weighted
  netWeightKg: number; // 0 for unit items or actual weight in kg
  unitPrice: number;
  totalPrice: number;
  status: 'raw' | 'converted_to_sale';
}

// ==========================================
// TREASURY, CASH & BANK MANAGEMENT (وجوه نقد و بانک)
// ==========================================

export interface BankAccount {
  id: string;
  periodId?: string;
  bankName: string; // نام بانک (e.g. ملی, ملت, صادرات, سامان, پاسارگاد, تجارت, سپه, رسالت, کشاورزی)
  branchName: string; // نام شعبه
  branchCode?: string; // کد شعبه
  accountNo: string; // شماره حساب
  shaba: string; // شماره شبا IR...
  cardNo?: string; // شماره کارت ۱۶ رقمی
  accountType: 'جاری' | 'پس‌انداز' | 'قرض‌الحسنه' | 'کوتاه‌مدت'; // نوع حساب
  accountHolder: string; // نام صاحب حساب
  initialBalance: number; // موجودی اولیه به ریال
  currentBalance?: number; // موجودی جاری محاسبه شده
  accountingCode?: string; // کد معین یا تفصیلی حسابداری
  posTerminalIds?: string[]; // شناسه‌های کارتخوان‌های متصل
  isActive: boolean;
  notes?: string;
  createdAt?: string;
}

export interface CashDrawer {
  id: string;
  periodId?: string;
  code: string; // e.g. CSH-01
  name: string; // نام صندوق (e.g. صندوق مرکزی فروشگاه, صندوق کافه, تنخواه‌گردان)
  location: string; // بخش یا محل استقرار (فروشگاه, سالن تولید, حسابداری, انبار)
  cashierId?: string; // صندوق‌دار مسئول پیش‌فرض
  initialBalance: number; // موجودی نقدی اولیه به ریال
  currentBalance?: number; // موجودی نقدی جاری محاسبه شده
  maxLimit?: number; // سقف مجاز نگهداری نقدینگی
  accountingCode?: string; // کد حسابداری
  isActive: boolean;
  notes?: string;
  createdAt?: string;
}

export interface PosTerminal {
  id: string;
  periodId?: string;
  terminalId: string; // کد پایانه (۸ رقمی)
  merchantId: string; // کد پذیرنده (۱۲-۱۵ رقمی)
  model: string; // مدل دستگاه (e.g. PAX S90, PAX D210, Newland, کارتخوان بیسیم)
  pspName: string; // شرکت پرداخت (به‌پرداخت ملت, آسان پرداخت, سداد, ایران کیش, سامان کیش, پاسارگاد, پرداخت نوین)
  bankAccountId: string; // حساب بانکی متصل (شناسه از BankAccount)
  cashDrawerId?: string; // صندوق فیزیکی متناظر
  serialNo?: string; // شماره سریال دستگاه
  connectionType: 'LAN' | 'WiFi' | 'GPRS' | 'USB'; // نوع اتصال
  ipAddress?: string; // آدرس آی‌پی کارتخوان در شبکه محلی جهت ارسال خودکار مبلغ (PC-POS LAN) e.g. 192.168.1.150
  port?: number | string; // پورت ارتباطی کارتخوان (e.g. 1024, 8080, 8888)
  protocol?: string; // پروتکل ارسال به پوز (e.g. PC-POS LAN, Web API, سداد LAN, به پرداخت LAN)
  feePercent?: number; // درصد یا کارمزد تراکنش
  isActive: boolean;
  notes?: string;
  createdAt?: string;
}

export interface Cashier {
  id: string;
  periodId?: string;
  code: string; // کد صندوق‌دار e.g. CSHR-101
  fullName: string; // نام و نام خانوادگی
  nationalId?: string; // کد ملی
  phone: string; // شماره تماس
  defaultCashDrawerId?: string; // صندوق پیش‌فرض
  shiftType?: 'صبح' | 'عصر' | 'شب' | 'گردشی'; // شیفت کاری
  maxDiscountPercent?: number; // حداکثر سقف تخفیف مجاز
  permissions?: string[]; // اختیارات (ثبت دریافت نقدی, کارتخوان, مرجوعی, لغو فاکتور, بستن شیفت)
  pinCode?: string; // کد دسترسی / PIN
  isActive: boolean;
  startDate?: string; // تاریخ شروع به کار
  notes?: string;
  createdAt?: string;
}

export interface ChequeBook {
  id: string;
  periodId?: string;
  bankAccountId: string; // حساب بانکی متصل
  series: string; // سری دسته چک e.g. "الف/1405"
  sayadPrefix?: string; // پیشوند یا شناسه صیادی دسته چک
  startNumber: number; // شماره برگه شروع e.g. 1001
  endNumber: number; // شماره برگه پایان e.g. 1025 or 1050
  totalLeaves: number; // تعداد کل برگه‌ها e.g. 25, 50, 100
  receivedDate: string; // تاریخ تحویل از بانک (شمسی)
  description?: string;
  status: 'active' | 'finished' | 'cancelled'; // وضعیت: فعال / تمام شده / باطل شده
  createdAt?: string;
}

export interface ChequeLeaf {
  id: string;
  periodId?: string;
  chequeBookId: string;
  bankAccountId: string;
  leafNumber: number; // شماره سریال برگه چک e.g. 1001
  sayadNo: string; // شناسه ۱۶ رقمی صیاد
  status: 'blank' | 'issued' | 'cleared' | 'bounced' | 'cancelled'; // سفید / صادر شده / پاس شده / برگشت خورده / ابطال شده
  paymentId?: string; // شناسه سند پرداخت مرتبط
  paymentNo?: string; // شماره سند پرداخت
  payeeName?: string; // در وجه
  beneficiaryType?: 'supplier' | 'personnel' | 'expense' | 'shareholder' | 'other';
  beneficiaryId?: string;
  amount?: number; // مبلغ به ریال
  issueDate?: string; // تاریخ صدور (شمسی)
  dueDate?: string; // تاریخ سررسید (شمسی)
  clearedDate?: string; // تاریخ وصول / پاس شدن
  bouncedDate?: string; // تاریخ برگشت
  bouncedReason?: string; // علت برگشت
  cancellationReason?: string; // علت ابطال
  notes?: string;
  registeredBy?: string;
  createdAt?: string;
}

export interface TreasuryReceipt {
  id: string;
  periodId: string;
  receiptNo: string; // شماره سند دریافت e.g. REC-140501-001
  date: string; // Jalali Date e.g. "1405/01/15"
  time: string; // "14:30"
  counterpartyType: 'customer' | 'supplier' | 'shareholder' | 'other'; // نوع طرف حساب
  counterpartyId?: string; // شناسه مشتری یا شخص
  counterpartyName: string; // نام طرف حساب
  paymentMethod: 'cash' | 'pos' | 'bank_transfer' | 'cheque'; // روش پرداخت
  amount: number; // مبلغ دریافت به ریال
  cashDrawerId?: string; // شناسه صندوق در صورت نقدی
  posTerminalId?: string; // شناسه کارتخوان
  posTrackingNo?: string; // شماره پیگیری / مرجع تراکنش RRN
  bankAccountId?: string; // شناسه حساب بانکی در صورت حواله/پوز
  bankTransferRef?: string; // شماره رهگیری فیش یا حواله
  chequeDetails?: {
    chequeNo: string; // شماره سریال چک
    sayadNo: string; // شماره صیادی ۱۶ رقمی
    dueDate: string; // تاریخ سررسید
    bankName: string; // نام بانک صادرکننده
    drawerName: string; // نام صاحب حساب / صادرکننده چک
    branchName?: string;
    isGuaranteed?: boolean; // چک تضمینی / عادی
    status: 'pending' | 'cleared' | 'bounced' | 'returned'; // وضعیت چک
  };
  linkedInvoiceNo?: string; // شماره فاکتور فروش مرتبط (در صورت وجود)
  category?: string; // بابت (تسویه فاکتور, پیش‌دریافت, واریز متفرقه, افزایش سرمایه)
  description: string; // شرح سند
  cashierId?: string; // صندوق‌دار ثبت‌کننده
  registeredBy?: string; // کاربر ثبت‌کننده
  status: 'confirmed' | 'draft' | 'cancelled'; // وضعیت سند
  createdAt?: string;
}

export interface TreasuryPayment {
  id: string;
  periodId: string;
  paymentNo: string; // شماره سند پرداخت e.g. PAY-140501-001
  date: string; // Jalali Date
  time?: string; // "16:15"
  beneficiaryType: 'supplier' | 'expense' | 'personnel' | 'customer' | 'shareholder' | 'other'; // نوع دریافت‌کننده
  beneficiaryId?: string; // شناسه تامین‌کننده، پرسنل یا هزینه
  beneficiaryName: string; // نام دریافت‌کننده
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque' | 'pos'; // روش پرداخت
  amount: number; // مبلغ به ریال
  cashDrawerId?: string; // شناسه صندوق مبدا در صورت نقدی
  bankAccountId?: string; // شناسه حساب بانکی مبدا در صورت حواله
  bankTransferRef?: string; // شماره پیگیری ساتنا/پایا/کارت‌به‌کارت
  chequeDetails?: {
    chequeNo: string;
    sayadNo: string;
    dueDate: string;
    bankName: string;
    payeeName: string;
    chequeBookId?: string;
    leafNumber?: number;
    chequeLeafId?: string;
    status: 'issued' | 'cleared' | 'cancelled' | 'pending';
  };
  linkedInvoiceNo?: string; // شماره فاکتور خرید مرتبط
  expenseCategoryId?: string; // کد سرفصل هزینه
  category?: string; // بابت (تسویه فاکتور خرید, مخارج جاری, مساعده پرسنل, خرید نقدی کالا)
  description: string; // شرح پرداخت
  cashierId?: string;
  registeredBy?: string;
  status: 'confirmed' | 'draft' | 'cancelled' | 'pending';
  createdAt?: string;
}

export interface BarterTransaction {
  id: string;
  periodId: string;
  barterNo: string; // شماره سند تهاتر e.g. BTR-1405-001
  date: string; // تاریخ شمسی
  partyAType: 'customer' | 'supplier' | 'other'; // نوع طرف اول
  partyAId?: string; // شناسه طرف اول
  partyAName: string; // نام طرف اول
  partyBType: 'customer' | 'supplier' | 'other'; // نوع طرف دوم
  partyBId?: string; // شناسه طرف دوم
  partyBName: string; // نام طرف دوم
  amount: number; // مبلغ کل تهاتر شده به ریال
  itemsDescription: string; // شرح کالاها یا خدمات مورد تهاتر
  settlementDiffAmount?: number; // مبلغ مابه‌التفاوت
  settlementDiffMethod?: 'cash' | 'bank_transfer' | 'cheque' | 'on_account'; // نحوه تسویه مابه‌التفاوت
  contractNo?: string; // شماره قرارداد یا توافق‌نامه
  description: string; // شرح و توضیحات تکمیلی
  registeredBy?: string;
  status: 'completed' | 'pending' | 'in_progress' | 'cancelled';
  createdAt?: string;
}

export interface CounterpartySettlement {
  id: string;
  periodId: string;
  settlementNo: string; // شماره سند تسویه e.g. SET-140501-001
  date: string; // تاریخ شمسی
  partyType: 'customer' | 'supplier'; // طرف حساب: مشتری یا تامین‌کننده
  partyId: string; // شناسه مشتری یا تامین‌کننده
  partyName: string; // نام طرف حساب
  totalSettledAmount: number; // کل مبلغ تسویه شده
  discountAmount?: number; // تخفیف خوش‌حسابی یا نقدی
  cashAmount?: number; // بخش نقدی
  cashDrawerId?: string;
  posAmount?: number; // بخش کارتخوان
  posTerminalId?: string;
  posRef?: string;
  bankTransferAmount?: number; // بخش حواله بانکی
  bankAccountId?: string;
  bankTransferRef?: string;
  chequeAmount?: number; // بخش چک صیادی
  chequeSayadNo?: string;
  chequeDueDate?: string;
  barterAmount?: number; // بخش تهاتر
  allocatedInvoices?: {
    invoiceNo: string;
    invoiceDate: string;
    invoiceTotal: number;
    settledHere: number;
  }[]; // لیست فاکتورهای تسویه شده در این سند
  notes?: string;
  registeredBy?: string;
  status: 'completed' | 'draft' | 'cancelled';
  createdAt?: string;
}

export interface CashierShiftCloseout {
  id: string;
  periodId: string;
  closeoutNo: string; // شماره سند بستن حساب e.g. CLS-140501-001
  date: string; // تاریخ شمسی
  shift?: 'morning' | 'evening' | 'night' | 'full_day';
  shiftStartTime?: string; // ساعت شروع شیفت
  shiftEndTime?: string; // ساعت اتمام شیفت
  cashierId: string; // شناسه صندوق‌دار
  cashierName: string; // نام صندوق‌دار
  cashDrawerId: string; // شناسه صندوق
  cashDrawerName?: string; // نام صندوق
  openingCashBalance?: number; // موجودی نقدی اول وقت
  openingBalance?: number;
  systemCashReceipts?: number;
  totalCashSales?: number;
  totalCashReceipts?: number;
  totalCashPayments?: number;
  systemPosReceipts?: number;
  totalPosReceipts?: number;
  posTransactionsCount?: number;
  systemCashPayments?: number;
  systemExpectedCash?: number;
  expectedCash?: number;
  physicalCountedCash?: number;
  actualCashCount?: number;
  cashDiscrepancy?: number;
  cashDifference?: number;
  posCountedReceipts?: number;
  posDiscrepancy?: number;
  handoverToVaultAmount?: number;
  transferredToSafe?: number;
  transferredToBank?: number;
  bankAccountId?: string;
  retainedForNextShift?: number;
  denominationsBreakdown?: Record<string, number>;
  supervisorName?: string;
  supervisorNotes?: string;
  cashierNotes?: string;
  discrepancyReason?: string;
  notes?: string;
  status: 'closed' | 'approved' | 'disputed' | 'open' | 'discrepancy';
  closedAt?: string;
  approvedBy?: string;
  createdAt?: string;
}

export type SettlementReason = 'contract_end' | 'dismissal' | 'resignation' | 'abandonment'; // اتمام قرارداد | اخراج | استعفا | ترک کار بدون استعفا
export type SettlementType = 'with_departure' | 'without_departure'; // تسویه حساب کامل به همراه ترک کار | تسویه حساب قرارداد بدون ترک کار

export interface SettlementMonthlyDetail {
  monthIndex: number; // 1, 2, ...
  year: number; // e.g. 1403
  month: number; // 1..12
  monthName: string; // فروردین, اردیبهشت, ...
  totalDaysInMonth: number; // 31, 30, 29
  workedDays: number; // مدت کارکرد آن ماه (روز)
  overtimeHours: number; // ساعت اضافه کاری
  holidayWorkHours: number; // ساعت تعطیل کاری
  fridayWorkHours: number; // ساعت جمعه کاری
  usedLeaveDays: number; // مرخصی استفاده شده ماه (روز)
  usedLeaveHours?: number; // مرخصی استفاده شده ماه (ساعت)
  usedLeaveMinutes?: number; // مرخصی استفاده شده ماه (دقیقه)
  
  // Salary Items
  dailyBaseSalary: number; // مزد روزانه
  baseSalary: number; // حقوق پایه ماه
  foodAllowance: number; // حق بن (کمک هزینه اقلام مصرفی) - ماه‌های ۳۱ روزه همان ۳۰ روزه است
  housingAllowance: number; // حق مسکن - ماه‌های ۳۱ روزه همان ۳۰ روزه است
  childAllowance: number; // حق اولاد
  marriageAllowance: number; // حق تاهل
  overtimeHourlyRate?: number; // نرخ ساعت اضافه کاری (از قوانین و ثوابت متناظر سال قرارداد)
  overtimeAmount: number; // حق اضافه کاری
  holidayHourlyRate?: number; // نرخ ساعت تعطیل کاری
  holidayWorkAmount: number; // حق تعطیل کاری
  fridayHourlyRate?: number; // نرخ ساعت جمعه‌کاری
  fridayWorkAmount: number; // حق جمعه کاری
  seniorityBase?: number; // پایه سنوات ماه
  monthlyEidi?: number; // عیدی ماهانه درج‌شده در لیست حقوق
  monthlyYearsBenefit?: number; // سنوات ماهانه درج‌شده در لیست حقوق
  jobAllowance?: number; // حق شغل / مسئولیت ماهانه
  grossSalary: number; // جمع ناخالص حقوق و مزایای ماه
  insurableGross?: number; // مبلغ مشمول کسر بیمه ماه
  workerInsuranceShare: number; // حق بیمه سهم کارگر (۷ درصد)
  payrollTax?: number; // مالیات حقوق ماه
  supplementaryInsurance?: number; // بیمه تکمیلی ماه
  deductionsAmount?: number; // جمع کل کسورات ماه
  netSalaryPayable: number; // مبلغ حقوق قابل پرداخت ماه
  syncedFromPayroll?: boolean; // آیا این ماه از اطلاعات حقوق و دستمزد تکمیل شده است
  payrollSourceType?: 'locked_payroll' | 'live_attendance' | 'manual_contract'; // منبع محاسبه ماه
  payrollItemPayable?: number; // مبلغ خالص فیش حقوق ثبت‌شده در سیستم حقوق و دستمزد
  payrollLeaveRemainingMinutes?: number; // مانده مرخصی تجمعی تا پایان این ماه (دقیقه) طبق سیستم حقوق و حضور غیاب
  alreadySettledInPrior?: boolean; // آیا این ماه قبلاً در سند تسویه حساب بدون ترک کار تسویه شده است
  priorSettlementNo?: string; // شماره سند تسویه بدون ترک کار قبلی
}

export interface PersonnelSettlement {
  id: string;
  periodId: string;
  settlementNo: string; // شماره سند تسویه (e.g. SET-1403-001)
  employeeCode: string;
  contractId?: string; // شناسه قرارداد متناظر
  settlementType?: SettlementType; // نوع تسویه: با ترک کار | قرارداد بدون ترک کار
  reason: SettlementReason; // علت تسویه: اتمام قرارداد | اخراج | استعفا | ترک کار بدون استعفا
  
  // تاریخ‌های تسویه
  startDate: string; // تاریخ شروع کارکرد/قرارداد
  endDate: string; // تاریخ اتمام قرارداد یا تاریخ قطع همکاری
  settlementDate: string; // تاریخ تنظیم سند تسویه حساب
  
  // مدت کارکرد
  totalPeriodDays: number; // کل روزهای تقویمی دوره
  totalWorkedDays: number; // مجموع روزهای کارکرد واقعی
  
  // جزییات ماه به ماه
  monthlyDetails: SettlementMonthlyDetail[];
  
  // جمع اقلام ماهانه حقوق
  totalBaseSalaries: number;
  totalFoodAllowances: number;
  totalHousingAllowances: number;
  totalChildAllowances: number;
  totalMarriageAllowances: number;
  totalOvertimeAmounts: number;
  totalHolidayWorkAmounts: number;
  totalFridayWorkAmounts: number;
  totalInsurableGross?: number; // جمع کل مبلغ ناخالص مشمول بیمه
  totalGrossSalaries: number; // جمع کل ناخالص حقوق ماه‌ها
  totalWorkerInsurance: number; // جمع کل بیمه سهم کارگر ماه‌ها
  totalNetSalaries: number; // جمع خالص حقوق ماه‌ها
  
  // محاسبات پایان کار (عیدی، سنوات، مانده مرخصی)
  dailySalaryForCalculation: number; // مبنای آخرین مزد روزانه
  monthlyBaseSalaryForCalculation: number; // حقوق پایه ماهانه مبنا (مزد روزانه * ۳۰)
  
  // حق سنوات (پاداش پایان خدمت)
  severanceDays: number; // روزهای مبنای سنوات
  severanceAmount: number; // مبلغ سنوات بر اساس مدت کارکرد و قانون کار
  
  // عیدی و پاداش
  bonusDays: number; // روزهای مبنای عیدی
  bonusAmount: number; // مبلغ عیدی و پاداش بر اساس مدت کارکرد و قانون کار
  
  // مرخصی استحقاقی و مانده مرخصی
  totalEntitledLeaveDays: number; // سهم مرخصی پرسنل بر اساس مدت کارکرد (۲.۵ روز در ماه)
  totalEntitledLeaveHours?: number; // سهم مرخصی پرسنل بر اساس ساعت (۲۰ ساعت در ماه)
  totalUsedLeaveDays: number; // مجموع مرخصی‌های استفاده شده طی دوره (روز)
  totalUsedLeaveHours?: number; // مجموع مرخصی‌های استفاده شده طی دوره (ساعت)
  unusedLeaveDays: number; // مانده مرخصی استفاده نشده (روز)
  unusedLeaveHours?: number; // مانده مرخصی استفاده نشده (ساعت)
  unusedLeaveAmount: number; // مبلغ بازخرید مانده مرخصی (مانده ساعت * نرخ ساعتی مزد مبنا)

  // طلب حساب از قبل (مانده طلب پرسنل مربوط به سال قبل)
  previousYearReceivableAmount?: number; // مبلغ طلب حساب از قبل (ریال)
  previousYearReceivableDescription?: string; // شرح و بابت طلب حساب از قبل
  
  // جمع کل مطالبات ناخالص
  totalGrossPayable: number; // جمع کل مطالبات (حقوق ماه‌ها + سنوات + عیدی + مانده مرخصی + طلب از قبل)
  
  // کسورات
  personnelPurchasesAmount: number; // خرید طی دوره پرسنل
  otherDeductionsAmount: number; // میزان سایر کسورات
  otherDeductionsDescription?: string; // توضیحات علت کسورات
  totalDeductions: number; // مجموع کسورات (خرید دوره + سایر کسورات)
  
  // مبالغ پرداختی توسط کارفرما
  employerPaidAmount: number; // مبلغ پرداخت شده توسط کارفرما (مساعده / حقوق‌های قبلی)
  
  // مانده حساب نهایی و مبلغ قابل پرداخت
  finalNetPayable: number; // مبلغ قابل پرداخت نهایی تسویه حساب
  
  // وضعیت و فراداده
  status: 'draft' | 'finalized' | 'paid'; // پیش‌نویس | قطعی | پرداخت شده
  notes?: string;
  payrollSyncedAt?: string; // زمان آخرین همگام‌سازی خودکار با حقوق و دستمزد
  registeredBy?: string;
  createdAt: string;
  updatedAt?: string;
}



