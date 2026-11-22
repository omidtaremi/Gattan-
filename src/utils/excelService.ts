import * as XLSX from 'xlsx';
import { AppDatabase, PersonnelSettlement, SettlementMonthlyDetail, SettlementReason } from '../types';
import {
  toEnglishDigits,
  matchPersianString,
  isShiftAssignmentInMonth,
  isEmployeeEligibleForMonth,
  normalizeAccountingCode,
  getProductFormulaKey,
  getMaterialFormulaKey,
  doesFormulaMatchProduct,
  doesIngredientMatchMaterial,
} from './persianUtils';

const MAX_EXCEL_LEN = 30000;
const MAX_ROWS_PER_SHEET = 200000;

function assignChunkedString(target: Record<string, any>, key: string, strVal: string) {
  if (strVal.length > MAX_EXCEL_LEN) {
    const numChunks = Math.ceil(strVal.length / MAX_EXCEL_LEN);
    target[key] = strVal.slice(0, MAX_EXCEL_LEN);
    for (let i = 1; i < numChunks; i++) {
      target[`${key}_chunk_${i}`] = strVal.slice(i * MAX_EXCEL_LEN, (i + 1) * MAX_EXCEL_LEN);
    }
  } else {
    target[key] = strVal;
  }
}

function writeWorkbookToBlob(wb: XLSX.WorkBook): Blob {
  // Using type: 'buffer' + compression: true avoids SheetJS's browser 'array'->'binary'->a2s() path
  // which allocates a giant JS Array(byteLength) of single-character strings and throws RangeError: Invalid array length on large datasets.
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true });
  const bytes = wbout instanceof Uint8Array
    ? wbout
    : Array.isArray(wbout)
      ? new Uint8Array(wbout)
      : new Uint8Array(wbout);
  return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
}

function safeExportData(data: any[]): any[] {
  if (!data || !Array.isArray(data)) return [];
  return data.map(row => {
    if (!row || typeof row !== 'object') return {};
    const newRow: any = {};
    Object.keys(row).forEach(key => {
      const val = row[key];
      if (val === undefined || val === null) {
        newRow[key] = '';
      } else if (typeof val === 'number') {
        if (Number.isNaN(val) || !Number.isFinite(val)) {
          newRow[key] = 0;
        } else {
          newRow[key] = val;
        }
      } else if (typeof val === 'string') {
        assignChunkedString(newRow, key, val);
      } else if (typeof val === 'boolean') {
        newRow[key] = val;
      } else if (val instanceof Date) {
        newRow[key] = val.toISOString();
      } else {
        let serialized: string;
        try {
          serialized = JSON.stringify(val);
        } catch {
          serialized = String(val);
        }
        assignChunkedString(newRow, key, serialized);
      }
    });
    return newRow;
  });
}

function safeImportData(data: any[]): any[] {
  if (!data || !Array.isArray(data)) return [];
  const cleanedRows: any[] = [];
  for (let idx = 0; idx < data.length; idx++) {
    const row = data[idx];
    if (!row || typeof row !== 'object') continue;
    const keys = Object.keys(row);
    const hasMeaningfulValue = keys.some(
      (k) => k !== 'خالی' && row[k] !== '' && row[k] !== undefined && row[k] !== null
    );
    if (!hasMeaningfulValue) continue;

    const chunkKeys = keys.filter((key) => key.includes('_chunk_'));
    if (chunkKeys.length === 0) {
      cleanedRows.push(row);
      continue;
    }

    const newRow = { ...row };
    const originalKeysWithChunks = new Set<string>();
    chunkKeys.forEach((key) => {
      const parts = key.split('_chunk_');
      if (parts.length >= 2) {
        const originalKey = parts.slice(0, -1).join('_chunk_');
        originalKeysWithChunks.add(originalKey);
      }
    });

    originalKeysWithChunks.forEach((originalKey) => {
      let fullStr =
        newRow[originalKey] !== undefined && newRow[originalKey] !== null
          ? String(newRow[originalKey])
          : '';
      let i = 1;
      while (true) {
        const chunkKey = `${originalKey}_chunk_${i}`;
        if (newRow[chunkKey] !== undefined && newRow[chunkKey] !== null) {
          fullStr += String(newRow[chunkKey]);
          delete newRow[chunkKey];
          i++;
        } else {
          break;
        }
      }
      newRow[originalKey] = fullStr;
    });

    cleanedRows.push(newRow);
  }
  return cleanedRows;
}

export function exportDatabaseToExcel(db: AppDatabase) {
  const wb = XLSX.utils.book_new();
  const addedSheetNames = new Set<string>();

  // Helper to add sheet safely (with automatic chunking for huge tables > MAX_ROWS_PER_SHEET)
  const addSheet = (data: any[], sheetName: string) => {
    const reserveUniqueSheetName = (rawName: string): string => {
      let safeName = rawName.slice(0, 31).replace(/[:\\\/\?\*\[\]]/g, '_');
      if (addedSheetNames.has(safeName)) {
        safeName = `${safeName.slice(0, 27)}_${addedSheetNames.size}`;
      }
      addedSheetNames.add(safeName);
      return safeName;
    };

    if (!data || !Array.isArray(data) || data.length === 0) {
      const safeName = reserveUniqueSheetName(sheetName);
      const ws = XLSX.utils.aoa_to_sheet([['خالی']]);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
      return;
    }

    if (data.length <= MAX_ROWS_PER_SHEET) {
      const safeName = reserveUniqueSheetName(sheetName);
      const safeData = safeExportData(data);
      const ws = XLSX.utils.json_to_sheet(safeData);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
      return;
    }

    const cleanBase = sheetName.replace(/[:\\\/\?\*\[\]]/g, '_');
    const totalParts = Math.ceil(data.length / MAX_ROWS_PER_SHEET);
    for (let partIdx = 0; partIdx < totalParts; partIdx++) {
      const start = partIdx * MAX_ROWS_PER_SHEET;
      const end = Math.min(start + MAX_ROWS_PER_SHEET, data.length);
      const partName = partIdx === 0
        ? cleanBase
        : `${cleanBase.slice(0, 25)}_P${partIdx + 1}`;
      const safeName = reserveUniqueSheetName(partName);
      const safeChunk = safeExportData(data.slice(start, end));
      const ws = XLSX.utils.json_to_sheet(safeChunk);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    }
  };

  // 1. Periods
  const periodsExport = (db.periods || []).map(p => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    createdAt: p.createdAt,
    startDate: p.startDate,
    endDate: p.endDate
  }));
  addSheet(periodsExport, "Periods");

  // 2. Item Categories
  const itemCategoriesExport = (db.itemCategories || []).map(c => ({
    id: c.id,
    periodId: c.periodId,
    name: c.name
  }));
  addSheet(itemCategoriesExport, "Item_Categories");

  // 3. Raw Items
  const itemsExport = (db.items || []).map(r => ({
    id: r.id,
    periodId: r.periodId,
    code: r.code,
    accountId: r.accountId,
    name: r.name,
    categoryId: r.categoryId,
    unit: r.unit,
    barcode: r.barcode,
    systemBarcode: r.systemBarcode || '',
    packageType: r.packageType,
    qtyPerPackage: r.qtyPerPackage,
    weightPerPackage: r.weightPerPackage,
    reorderThreshold: r.reorderThreshold,
    price: r.price,
    isActive: r.isActive,
    warehouse: r.warehouse || ''
  }));
  addSheet(itemsExport, "Raw_Items");

  // 4. Suppliers
  const suppliersExport = (db.suppliers || []).map(s => ({
    id: s.id,
    periodId: s.periodId,
    name: s.name,
    phone: s.phone,
    address: s.address,
    isActive: s.isActive,
    bankAccounts: JSON.stringify(s.bankAccounts || []),
    suppliedItemIds: (s.suppliedItemIds || []).join(';')
  }));
  addSheet(suppliersExport, "Suppliers");

  // 5. Product Categories
  const productCategoriesExport = (db.productCategories || []).map(c => ({
    id: c.id,
    periodId: c.periodId,
    name: c.name,
    targetMargin: c.targetMargin,
    departmentId: c.departmentId || ''
  }));
  addSheet(productCategoriesExport, "Product_Categories");

  // 5b. Production Departments
  const departmentsExport = (db.departments || []).map(d => ({
    id: d.id,
    periodId: d.periodId,
    name: d.name,
    code: d.code || '',
    targetMargin: d.targetMargin,
    isShared: d.isShared ?? false
  }));
  addSheet(departmentsExport, "Departments");

  // 6. Products
  const productsExport = (db.products || []).map(r => ({
    id: r.id,
    periodId: r.periodId,
    code: r.code,
    accountId: r.accountId,
    name: r.name,
    categoryId: r.categoryId,
    unit: r.unit,
    barcode: r.barcode,
    packageType: r.packageType,
    qtyPerPackage: r.qtyPerPackage,
    weightPerPackage: r.weightPerPackage,
    salePrice: r.salePrice,
    cogsPrice: r.cogsPrice,
    weight: r.weight,
    approvedPrice: r.approvedPrice,
    isWip: r.isWip || false
  }));
  addSheet(productsExport, "Products");

  // 7. Sales Periods
  const salesPeriodsExport = (db.salesPeriods || []).map(p => ({
    id: p.id,
    periodId: p.periodId,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate
  }));
  addSheet(salesPeriodsExport, "Sales_Periods");

  // 8. Product Sales
  const productSalesExport = (db.productSales || []).map(s => ({
    id: s.id,
    salesPeriodId: s.salesPeriodId,
    periodId: s.periodId,
    productId: s.productId,
    qtySold: s.qtySold,
    discount: s.discount,
    preDiscountAmount: s.preDiscountAmount,
    netSalesAmount: s.netSalesAmount,
    month: s.month !== undefined ? s.month : (s.salesPeriodId ? Number(s.salesPeriodId) : 1),
    year: s.year || undefined
  }));
  addSheet(productSalesExport, "Product_Sales");

  // 9. Unit Conversions
  const unitConversionsExport = (db.unitConversions || []).map(c => ({
    id: c.id,
    periodId: c.periodId,
    rawMaterialId: c.rawMaterialId,
    purchaseUnit: c.purchaseUnit,
    consumptionUnit: c.consumptionUnit,
    factor: c.factor
  }));
  addSheet(unitConversionsExport, "Unit_Conversions");

  // 10. Product Formulas
  const formulasExport = (db.productFormulas || []).map(f => ({
    id: f.id,
    periodId: f.periodId,
    productId: f.productId,
    ingredients: JSON.stringify(f.ingredients || []),
    name: f.name || '',
    isActive: f.isActive || false
  }));
  addSheet(formulasExport, "Product_Formulas");

  // 11. Personnel
  const personnelExport = (db.personnel || []).map(p => ({
    id: p.id,
    periodId: p.periodId,
    employeeCode: p.employeeCode,
    accountCode: p.accountCode || '',
    nationalId: p.nationalId || '',
    insuranceCode: p.insuranceCode || '',
    fatherName: p.fatherName || '',
    birthDate: p.birthDate || '',
    birthPlace: p.birthPlace || '',
    center: p.center || '',
    project: p.project || '',
    complementaryInsurance: p.complementaryInsurance || false,
    yearsBase: p.yearsBase || 0,
    entryDate: p.entryDate || '',
    insuranceDate: p.insuranceDate || '',
    dailyYearsDifference: p.dailyYearsDifference || 0,
    bankName: p.bankName || '',
    bankAccount: p.bankAccount || '',
    shaba: p.shaba || '',
    cardNo: p.cardNo || '',
    hasInsurance: p.hasInsurance || false,
    employerPremium3: p.employerPremium3 || 0,
    employerPremium: p.employerPremium || 0,
    workerPremium: p.workerPremium || 0,
    attractionAllowance: p.attractionAllowance || 0,
    baseSalaryInsurance: p.baseSalaryInsurance || 0,
    dailyWage: p.dailyWage || 0,
    isDailyWage: p.isDailyWage || false,
    taxShare: p.taxShare || 0,
    childrenCount: p.childrenCount || 0,
    isMarried: p.isMarried || false,
    fixedAllowances: p.fixedAllowances || 0,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    fullName: p.fullName || '',
    mobile: p.mobile || '',
    role: p.role || '',
    isActive: p.isActive,
    baseSalary: p.baseSalary || 0,
    insuranceHistory: p.insuranceHistory || '',
    bankAccounts: JSON.stringify(p.bankAccounts || []),
    capabilities: JSON.stringify(p.capabilities || []),
    attendanceCode: p.attendanceCode || '',
    postalCode: p.postalCode || '',
    jobAllowance: p.jobAllowance || 0,
    isSubjectToEmployerPremium: p.isSubjectToEmployerPremium || false,
    isSubjectToUnemploymentPremium: p.isSubjectToUnemploymentPremium || false,
    isSubjectToWorkerPremium: p.isSubjectToWorkerPremium || false,
    gender: p.gender || '',
    maritalStatus: p.maritalStatus || '',
    childrenList: JSON.stringify(p.childrenList || []),
    address: p.address || '',
    emergencyMobile: p.emergencyMobile || '',
    insuranceHistoryDays: p.insuranceHistoryDays || 0,
    personnelCategoryId: p.personnelCategoryId || '',
    militaryStatus: p.militaryStatus || '',
    hasNationalCardCopy: p.hasNationalCardCopy || false,
    hasBirthCertificatePagesCopy: p.hasBirthCertificatePagesCopy || false,
    hasPhoto: p.hasPhoto || false,
    hasSocialSecurityRegistrationForm: p.hasSocialSecurityRegistrationForm || false,
    hasPromissoryNote: p.hasPromissoryNote || false,
    hasHealthCard: p.hasHealthCard || false,
    hasPreEmploymentExam: p.hasPreEmploymentExam || false,
    promissoryNoteNumber: p.promissoryNoteNumber || '',
    promissoryNoteIssuerName: p.promissoryNoteIssuerName || '',
    promissoryNoteAmount: p.promissoryNoteAmount || 0,
    hasSupplementaryInsurance: p.hasSupplementaryInsurance || false,
    supplementaryInsuranceDate: p.supplementaryInsuranceDate || '',
    supplementaryInsurancePremium: p.supplementaryInsurancePremium || 0,
    contractStartDate: p.contractStartDate || '',
    contractEndDate: p.contractEndDate || '',
    contractDurationMonths: p.contractDurationMonths || 0,
    contractBaseSalary: p.contractBaseSalary || 0,
    contractDailySalary: p.contractDailySalary || 0,
    contractDailyWageAmount: p.contractDailyWageAmount || 0,
    departureDate: p.departureDate || '',
    departureReason: p.departureReason || '',
    shiftScheduleType: p.shiftScheduleType || 'rotating',
    fixedShiftId: p.fixedShiftId || '',
    birthCertificateNumber: p.birthCertificateNumber || ''
  }));
  addSheet(personnelExport, "Personnel");

  // 12. Payroll Periods
  const payrollPeriodsExport = (db.payrollPeriods || []).map(p => ({
    id: p.id,
    periodId: p.periodId,
    title: p.title,
    dateRange: p.dateRange,
    month: p.month,
    year: p.year,
    status: p.status || 'ثبت شده',
    registeredAt: p.registeredAt || '',
    totalEmployees: p.totalEmployees,
    totalNetPayable: p.totalNetPayable,
    totalInsurance: p.totalInsurance,
    totalCost: p.totalCost,
    attendancePerformanceSnapshot: p.attendancePerformanceSnapshot ? JSON.stringify(p.attendancePerformanceSnapshot) : ''
  }));
  addSheet(payrollPeriodsExport, "Payroll_Periods");

  // 13. Payroll Items (ریز اقلام و محاسبات تفصیلی حقوق و دستمزد پرسنل)
  const payrollItemsExport = (db.payrollItems || []).map(r => ({
    id: r.id,
    payrollPeriodId: r.payrollPeriodId || '',
    periodId: r.periodId,
    employeeCode: r.employeeCode,
    month: r.month,
    year: r.year,
    baseSalary: r.baseSalary,
    housingAllowance: r.housingAllowance,
    foodAllowance: r.foodAllowance,
    childAllowance: r.childAllowance,
    marriageAllowance: r.marriageAllowance,
    seniorityBase: r.seniorityBase,
    jobAllowance: r.jobAllowance,
    monthlyEidi: r.monthlyEidi,
    monthlyYearsBenefit: r.monthlyYearsBenefit,
    attendanceDaysWorked: r.attendanceDaysWorked,
    workDaysCount: r.workDaysCount,
    insuranceDaysCount: r.insuranceDaysCount,
    dailyBaseSalary: r.dailyBaseSalary,
    dailyInsuranceSalary: r.dailyInsuranceSalary,
    workedHours: r.workedHours,
    workedHoursHM: r.workedHoursHM || '',
    overtimeHours: r.overtimeHours,
    overtimeHoursHM: r.overtimeHoursHM || '',
    overtimePay: r.overtimePay ?? r.overtimeHoursAmount,
    overtimeHoursAmount: r.overtimeHoursAmount ?? r.overtimePay,
    fridayWorkHours: r.fridayWorkHours,
    fridayWorkHoursHM: r.fridayWorkHoursHM || '',
    fridayWorkPay: r.fridayWorkPay,
    holidayWorkHours: r.holidayWorkHours,
    holidayWorkHoursHM: r.holidayWorkHoursHM || '',
    holidayWorkPay: r.holidayWorkPay,
    grossSalary: r.grossSalary,
    insuranceMonthlyBaseSalary: r.insuranceMonthlyBaseSalary,
    insuranceMonthlyBenefits: r.insuranceMonthlyBenefits,
    insurableBase: r.insurableBase,
    taxableBase: r.taxableBase,
    workerInsurance7: r.workerInsurance7,
    employerPensionShare: r.employerPensionShare,
    employerUnemploymentShare: r.employerUnemploymentShare,
    employerInsurance23: r.employerInsurance23,
    totalInsurance30: r.totalInsurance30,
    payrollTax: r.payrollTax,
    supplementaryInsurance: r.supplementaryInsurance,
    delayFineDeduction: r.delayFineDeduction,
    normalManagementDeductionHours: r.normalManagementDeductionHours ?? 0,
    normalManagementDeductionMinutes: r.normalManagementDeductionMinutes ?? 0,
    normalManagementDeductionHM: r.normalManagementDeductionHM || '',
    managementOtDeductionHours: r.managementOtDeductionHours ?? 0,
    managementOtDeductionMinutes: r.managementOtDeductionMinutes ?? 0,
    managementOtDeductionHM: r.managementOtDeductionHM || '',
    deductionsAmount: r.deductionsAmount,
    payableAmount: r.payableAmount,
    totalPayrollCost: r.totalPayrollCost
  }));
  addSheet(payrollItemsExport, "Payroll_Items");

  // 13-b. Payroll Calculations (شیت خوانا و جامع گزارش محاسبات حقوق پرسنل جهت گزارش‌گیری مدیریتی و حسابداری)
  const personnelMap = new Map((db.personnel || []).map(p => [p.employeeCode, p]));
  const personnelByIdMap = new Map((db.personnel || []).map(p => [p.id, p]));
  const contractsMap = new Map((db.personnelContracts || []).map(c => [c.employeeCode, c]));
  const payrollPeriodsMap = new Map((db.payrollPeriods || []).map(pp => [pp.id, pp]));
  const payrollCalculationsExport = (db.payrollItems || []).map(r => {
    const emp = personnelMap.get(r.employeeCode) || personnelByIdMap.get(r.employeeCode);
    const contract = contractsMap.get(r.employeeCode);
    const pp = r.payrollPeriodId ? payrollPeriodsMap.get(r.payrollPeriodId) : undefined;
    const fullName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim()) : (contract?.fullName || '');
    const insuranceCode = emp?.insuranceCode || contract?.insuranceCode || '';
    const nationalId = emp?.nationalId || contract?.nationalId || '';

    return {
      'کد پرسنل': r.employeeCode,
      'نام و نام خانوادگی': fullName,
      'کد ملی': nationalId,
      'شماره بیمه': insuranceCode,
      'دوره مالی': r.periodId,
      'سال': r.year || (pp?.year) || '',
      'ماه': r.month || (pp?.month) || '',
      'عنوان لیست': pp?.title || '',
      'روز کارکرد تردد': r.attendanceDaysWorked ?? '',
      'روز کارکرد': r.workDaysCount ?? '',
      'روز بیمه': r.insuranceDaysCount ?? '',
      'ساعت کارکرد': r.workedHoursHM || '',
      'ساعت اضافه کار': r.overtimeHoursHM || '',
      'ساعت جمعه کاری': r.fridayWorkHoursHM || '',
      'ساعت تعطیل کاری': r.holidayWorkHoursHM || '',
      'حقوق پایه روزانه': r.dailyBaseSalary ?? '',
      'حقوق پایه ماهانه': r.baseSalary ?? 0,
      'حق بن': r.foodAllowance ?? 0,
      'حق مسکن': r.housingAllowance ?? 0,
      'حق اولاد': r.childAllowance ?? 0,
      'حق تاهل': r.marriageAllowance ?? 0,
      'پایه سنوات': r.seniorityBase ?? 0,
      'فوق العاده شغلی': r.jobAllowance ?? 0,
      'عیدی و پاداش ماهانه': r.monthlyEidi ?? 0,
      'حق سنوات ماهانه': r.monthlyYearsBenefit ?? 0,
      'جمع حقوق ناخالص': r.grossSalary ?? (r.baseSalary || 0),
      'مبلغ اضافه کار': r.overtimePay ?? r.overtimeHoursAmount ?? 0,
      'مبلغ جمعه کاری': r.fridayWorkPay ?? 0,
      'مبلغ تعطیل کاری': r.holidayWorkPay ?? 0,
      'پایه بیمه ماهانه': r.insuranceMonthlyBaseSalary ?? '',
      'مزایای بیمه': r.insuranceMonthlyBenefits ?? '',
      'حقوق مشمول بیمه': r.insurableBase ?? 0,
      'بیمه سهم کارفرما ۲۰٪': r.employerPensionShare ?? 0,
      'بیمه بیکاری ۳٪': r.employerUnemploymentShare ?? 0,
      'کل بیمه سهم کارفرما ۲۳٪': r.employerInsurance23 ?? 0,
      'بیمه سهم کارگر ۷٪': r.workerInsurance7 ?? 0,
      'کل حق بیمه ۳۰٪': r.totalInsurance30 ?? ((r.employerInsurance23 || 0) + (r.workerInsurance7 || 0)),
      'حقوق مشمول مالیات': r.taxableBase ?? 0,
      'مالیات حقوق': r.payrollTax ?? 0,
      'بیمه تکمیلی': r.supplementaryInsurance ?? 0,
      'کسر جریمه تاخیر': r.delayFineDeduction ?? 0,
      'کسر مدیریتی ساعت عادی': r.normalManagementDeductionHM || '',
      'جمع کسورات': r.deductionsAmount ?? 0,
      'خالص پرداختی نهایی': r.payableAmount ?? 0,
      'بهای تمام شده حقوق کارفرما': r.totalPayrollCost ?? (r.payableAmount + (r.employerInsurance23 || 0))
    };
  });
  if (payrollCalculationsExport.length > 0) {
    addSheet(payrollCalculationsExport, "Payroll_Calculations");
  } else {
    // Add template header sheet for Payroll_Calculations if empty
    addSheet([{
      'کد پرسنل': '',
      'نام و نام خانوادگی': '',
      'کد ملی': '',
      'شماره بیمه': '',
      'دوره مالی': '',
      'سال': '',
      'ماه': '',
      'عنوان لیست': '',
      'روز کارکرد': '',
      'روز بیمه': '',
      'ساعت کارکرد': '',
      'ساعت اضافه کار': '',
      'ساعت جمعه کاری': '',
      'ساعت تعطیل کاری': '',
      'حقوق پایه روزانه': '',
      'حقوق پایه ماهانه': '',
      'حق بن': '',
      'حق مسکن': '',
      'حق اولاد': '',
      'حق تاهل': '',
      'پایه سنوات': '',
      'فوق العاده شغلی': '',
      'عیدی و پاداش ماهانه': '',
      'حق سنوات ماهانه': '',
      'جمع حقوق ناخالص': '',
      'مبلغ اضافه کار': '',
      'مبلغ جمعه کاری': '',
      'مبلغ تعطیل کاری': '',
      'پایه بیمه ماهانه': '',
      'مزایای بیمه': '',
      'حقوق مشمول بیمه': '',
      'بیمه سهم کارفرما ۲۰٪': '',
      'بیمه بیکاری ۳٪': '',
      'کل بیمه سهم کارفرما ۲۳٪': '',
      'بیمه سهم کارگر ۷٪': '',
      'کل حق بیمه ۳۰٪': '',
      'حقوق مشمول مالیات': '',
      'مالیات حقوق': '',
      'بیمه تکمیلی': '',
      'کسر جریمه تاخیر': '',
      'کسر مدیریتی ساعت عادی': '',
      'جمع کسورات': '',
      'خالص پرداختی نهایی': '',
      'بهای تمام شده حقوق کارفرما': ''
    }], "Payroll_Calculations");
  }

  // 14. Personnel Allocations
  const allocationsExport = (db.personnelAllocations || []).map(r => ({
    id: r.id,
    periodId: r.periodId,
    employeeCode: r.employeeCode,
    departmentCategoryId: r.departmentCategoryId,
    salaryShare: r.salaryShare
  }));
  addSheet(allocationsExport, "Personnel_Allocations");

  // 15. Period Overheads
  const overheadExport = (db.periodOverheads || []).map(o => ({
    id: o.id,
    periodId: o.periodId,
    month: o.month,
    year: o.year,
    operational: o.operational,
    distributionSales: o.distributionSales,
    financial: o.financial,
    administrative: o.administrative,
    returnsOfExpense: o.returnsOfExpense,
    transferredAccountingCogs: o.transferredAccountingCogs
  }));
  addSheet(overheadExport, "Period_Overheads");

  // 16. Procurement Orders
  const ordersExport = (db.procurementOrders || []).map(o => ({
    id: o.id,
    periodId: o.periodId,
    title: o.title || '',
    requestedBy: o.requestedBy || '',
    supplierId: o.supplierId || '',
    orderDate: o.orderDate,
    expectedDeliveryDate: o.expectedDeliveryDate,
    items: JSON.stringify(o.items || []),
    totalBill: o.totalBill,
    status: o.status,
    notes: o.notes || '',
    isActive: o.isActive === undefined ? '' : o.isActive ? 'true' : 'false',
    deactivatedAt: o.deactivatedAt || '',
    deactivationReason: o.deactivationReason || '',
    createdAt: o.createdAt || '',
    updatedAt: o.updatedAt || ''
  }));
  addSheet(ordersExport, "Procurement_Orders");

  // 16b. Customer Production Orders
  const customerProdOrdersExport = (db.customerProductionOrders || []).map(o => {
    // Keep cell within Excel 32k char limit by stripping oversized image payloads only in Excel sheet
    const itemsSerialized = JSON.stringify(o.items || []);
    const safeItemsJson =
      itemsSerialized.length > 30000
        ? JSON.stringify((o.items || []).map(it => ({ ...it, sampleImages: [] })))
        : itemsSerialized;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      periodId: o.periodId,
      customerId: o.customerId || '',
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerCategoryId: o.customerCategoryId || '',
      customerCategoryName: o.customerCategoryName || '',
      orderDate: o.orderDate,
      deliveryDate: o.deliveryDate,
      deliveryTime: o.deliveryTime,
      deliveryType: o.deliveryType,
      deliveryAddress: o.deliveryAddress || '',
      recipientName: o.recipientName || '',
      recipientPhone: o.recipientPhone || '',
      deliveryFee: o.deliveryFee || 0,
      items: safeItemsJson,
      totalAmount: o.totalAmount,
      prepaymentAmount: o.prepaymentAmount,
      remainingAmount: o.remainingAmount,
      prepaymentMethod: o.prepaymentMethod || '',
      treasuryReceiptId: o.treasuryReceiptId || '',
      treasuryReceiptNo: o.treasuryReceiptNo || '',
      status: o.status,
      orderPurpose: o.orderPurpose || '',
      notes: o.notes || '',
      registeredBy: o.registeredBy || '',
      createdAt: o.createdAt || '',
      updatedAt: o.updatedAt || ''
    };
  });
  addSheet(customerProdOrdersExport, "Customer_Production_Orders");

  if (Array.isArray(db.customerOrderPurposes) && db.customerOrderPurposes.length > 0) {
    addSheet(
      db.customerOrderPurposes.map((title) => ({ title })),
      "Customer_Order_Purposes"
    );
  }

  // 16c. Digital Menu Configuration
  if (db.digitalMenu) {
    addSheet([{ configJson: JSON.stringify(db.digitalMenu) }], "Digital_Menu_Config");
  }

  // 17. Stock Audits
  const auditsExport = (db.stockCountAudits || []).map(s => ({
    id: s.id,
    periodId: s.periodId,
    title: s.title,
    date: s.date
  }));
  addSheet(auditsExport, "Stock_Audits");

  // 18. Stock Counts
  const countsExport = (db.stockCounts || []).map(r => ({
    id: r.id,
    auditId: r.auditId,
    periodId: r.periodId,
    itemId: r.itemId,
    fullPackages: r.fullPackages,
    looseQty: r.looseQty,
    totalCalculatedQty: r.totalCalculatedQty,
    value: r.value,
    warehouse: r.warehouse || '',
    shelfLocation: r.shelfLocation || '',
    countDate: r.countDate || '',
    notes: r.notes || ''
  }));
  addSheet(countsExport, "Stock_Counts");

  // 19. Purchase Invoices
  const invoicesExport = (db.purchaseInvoices || []).map(i => ({
    id: i.id,
    periodId: i.periodId,
    supplierId: i.supplierId,
    date: i.date,
    items: JSON.stringify(i.items || []),
    invoiceNumber: i.invoiceNumber
  }));
  addSheet(invoicesExport, "Purchase_Invoices");

  // 20. Daily Production Segments
  const segmentsExport = (db.dailyProductionSegments || []).map(r => ({
    id: r.id,
    periodId: r.periodId,
    productId: r.productId,
    startTime: r.startTime,
    endTime: r.endTime,
    producedQty: r.producedQty
  }));
  addSheet(segmentsExport, "Daily_Production_Segments");

  // 21. Users
  const usersExport = (db.users || []).map(u => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    permissions: (u.permissions || []).join(';'),
    password: u.password,
    is2FA: u.is2FA,
    secretCode: u.secretCode
  }));
  addSheet(usersExport, "Users");

  // 21b. User Roles
  const rolesExport = (db.roles || []).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    permissions: (r.permissions || []).join(';'),
    isSystem: Boolean(r.isSystem),
  }));
  addSheet(rolesExport, "User_Roles");

  // 22. Shifts
  const shiftsExport = (db.shifts || []).map(s => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime
  }));
  addSheet(shiftsExport, "Shifts");

  // 23. Shift Assignments
  const shiftAssignmentsExport = (db.shiftAssignments || []).map(a => ({
    id: a.id,
    periodId: a.periodId || '',
    year: a.year ?? '',
    month: a.month ?? '',
    employeeCode: a.employeeCode || '',
    employeeId: a.employeeId || '',
    date: a.date || '',
    dayName: a.dayName || '',
    shiftId: a.shiftId || '',
    deptId: a.deptId || '',
    isSubstitute: a.isSubstitute ?? false,
    substitutedEmployeeCode: a.substitutedEmployeeCode || '',
    isOnLeave: a.isOnLeave ?? false,
    isSurplus: a.isSurplus ?? false
  }));
  addSheet(shiftAssignmentsExport, "Shift_Assignments");

  // 24. Production Sections
  const productionSectionsExport = (db.productionSections || []).map(sec => ({
    id: sec.id,
    name: sec.name,
    minStaff: sec.minStaff,
    startTime: sec.startTime || '۰۶:۰۰',
    endTime: sec.endTime || '۱۴:۰۰',
    canBeEmpty: sec.canBeEmpty ?? false,
    departmentCategoryId: sec.departmentCategoryId || ''
  }));
  addSheet(productionSectionsExport, "Production_Sections");

  // 39. Shift Schemes
  const shiftSchemesExport = (db.shiftSchemes || []).map(s => ({
    id: s.id,
    name: s.name,
    isActive: s.isActive,
    productionSections: JSON.stringify(s.productionSections || []),
    shiftAssignments: JSON.stringify(s.shiftAssignments || []),
    personnelCapabilities: JSON.stringify(s.personnelCapabilities || {})
  }));
  addSheet(shiftSchemesExport, "Shift_Schemes");

  // 25. Sales Transactions
  const salesTransactionsExport = (db.salesTransactions || []).map(tx => ({
    id: tx.id,
    periodId: tx.periodId,
    invoiceNumber: tx.invoiceNumber || '',
    customerName: tx.customerName || '',
    customerCode: tx.customerCode || '',
    productCode: tx.productCode,
    dateStr: tx.dateStr,
    productName: tx.productName,
    categoryName: tx.categoryName || '',
    qtySold: tx.qtySold,
    unitPrice: tx.unitPrice,
    discount: tx.discount,
    salesAmount: tx.salesAmount,
    time: tx.time || '',
    hour: tx.hour,
    dayOfMonth: tx.dayOfMonth,
    weekday: tx.weekday,
    productId: tx.productId || '',
    categoryId: tx.categoryId || '',
    month: tx.month,
    year: tx.year
  }));
  addSheet(salesTransactionsExport, "Sales_Transactions");

  // 26. Warehouses
  const warehousesExport = (db.warehouses || []).map(w => ({
    id: w.id,
    periodId: w.periodId,
    name: w.name,
    code: w.code || '',
    location: w.location || '',
    isActive: w.isActive ?? true
  }));
  addSheet(warehousesExport, "Warehouses");

  // 27. Salary Base Rates
  const salaryBaseRatesExport = (db.salaryBaseRates || []).map(r => ({
    id: r.id,
    periodId: r.periodId,
    year: r.year,
    dailyBaseSalary: r.dailyBaseSalary,
    hourlyBaseSalary: r.hourlyBaseSalary || Math.round((r.dailyBaseSalary || 0) / 7.333333),
    dailyInsuranceSalary: r.dailyInsuranceSalary,
    housingAllowance: r.housingAllowance,
    foodAllowance: r.foodAllowance,
    childAllowance: r.childAllowance,
    baseYearsRate: r.baseYearsRate,
    marriageAllowance: r.marriageAllowance,
    taxableAmount: r.taxableAmount,
    overtimeHourlyRate: r.overtimeHourlyRate,
    fridayWorkHourlyRate: r.fridayWorkHourlyRate ?? Math.round(((r.dailyBaseSalary || 0) * 0.40) / 7.33),
    holidayWorkHourlyRate: r.holidayWorkHourlyRate ?? 0,
    monthlyLeaveHours: r.monthlyLeaveHours || '15:53'
  }));
  addSheet(salaryBaseRatesExport, "Salary_Base_Rates");

  // 28. Personnel Contracts
  const personnelContractsExport = (db.personnelContracts || []).map(c => ({
    id: c.id,
    employeeCode: c.employeeCode,
    periodId: c.periodId,
    contractStartDate: c.contractStartDate,
    contractEndDate: c.contractEndDate,
    contractDurationMonths: c.contractDurationMonths,
    contractBaseSalary: c.contractBaseSalary,
    contractSeniorityBase: (c as any).contractSeniorityBase || 0,
    isActive: c.isActive !== undefined ? (c.isActive ? 'بله' : 'خیر') : 'بله',
    role: c.role,
    notes: c.notes || '',
    createdAt: c.createdAt || '',
    fullName: c.fullName || '',
    nationalId: c.nationalId || '',
    fatherName: c.fatherName || '',
    birthDate: c.birthDate || '',
    postalCode: c.postalCode || '',
    address: c.address || '',
    mobile: c.mobile || '',
    insuranceCode: c.insuranceCode || '',
    militaryStatus: c.militaryStatus || '',
    promissoryNoteNumber: c.promissoryNoteNumber || '',
    promissoryNoteAmount: c.promissoryNoteAmount || 0,
    jobAllowance: c.jobAllowance || 0,
    contractDailySalary: c.contractDailySalary || 0,
    contractDailyInsuranceSalary: c.contractDailyInsuranceSalary || 0,
    contractBaseInsuranceSalary: c.contractBaseInsuranceSalary || 0,
    contractDailyWageAmount: c.contractDailyWageAmount || 0,
    calculatedWorkerPremium: c.calculatedWorkerPremium || 0,
    calculatedEmployerPremium20: c.calculatedEmployerPremium20 || 0,
    calculatedUnemploymentPremium3: c.calculatedUnemploymentPremium3 || 0,
    calculatedTotalEmployerPremium23: c.calculatedTotalEmployerPremium23 || 0,
    contractDetailsJson: c.contract ? JSON.stringify(c.contract) : ''
  }));
  addSheet(personnelContractsExport, "Personnel_Contracts");

  // 31. Seniority Rate Rules
  const seniorityRateRulesExport = (db.seniorityRateRules || []).map(r => ({
    id: r.id,
    seniorityYears: r.seniorityYears,
    dailyRate: r.dailyRate,
    fiscalYear: r.fiscalYear
  }));
  addSheet(seniorityRateRulesExport, "Seniority_Rate_Rules");

  // 32. Custom Banks
  const customBanksExport = (db.customBanks || []).map(name => ({
    bankName: name
  }));
  addSheet(customBanksExport, "Custom_Banks");

  // 29. Insured Salary Items
  const insuredSalaryItemsExport = (db.insuredSalaryItems || []).map(item => ({
    id: item.id,
    periodId: item.periodId || '',
    itemKey: item.itemKey,
    itemName: item.itemName,
    startDate: item.startDate || '',
    endDate: item.endDate || ''
  }));
  addSheet(insuredSalaryItemsExport, "Insured_Salary_Items");

  // 29b. Leave Buyout Salary Items
  const leaveBuyoutSalaryItemsExport = (db.leaveBuyoutSalaryItems || []).map(item => ({
    id: item.id,
    periodId: item.periodId || '',
    itemKey: item.itemKey,
    itemName: item.itemName,
    startDate: item.startDate || '',
    endDate: item.endDate || ''
  }));
  addSheet(leaveBuyoutSalaryItemsExport, "Leave_Buyout_Salary_Items");

  // 30. Personnel Categories
  const personnelCategoriesExport = (db.personnelCategories || []).map(cat => ({
    id: cat.id,
    name: cat.name
  }));
  addSheet(personnelCategoriesExport, "Personnel_Categories");

  // 33. Attendance Records
  const resolveJalaliWeekday = (dateStr: string): string => {
    const FA_WEEKDAYS_MAP = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
    try {
      const cleanDate = toEnglishDigits(dateStr).replace(/\//g, '-');
      const parts = cleanDate.split('-');
      if (parts.length === 3) {
        const jy = parseInt(parts[0], 10);
        const jm = parseInt(parts[1], 10);
        const jd = parseInt(parts[2], 10);
        const gy_base = (jy <= 979) ? 621 : 1600;
        const jy_shifted = (jy <= 979) ? jy : jy - 979;
        let days = (365 * jy_shifted) + (Math.floor(jy_shifted / 33) * 8) + Math.floor(((jy_shifted % 33) + 3) / 4)
          + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
        let g_y = gy_base + 400 * Math.floor(days / 146097);
        days %= 146097;
        if (days >= 36525) {
          g_y += 100 * Math.floor(--days / 36524);
          days %= 36524;
          if (days >= 365) days++;
        }
        g_y += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days >= 366) {
          g_y += Math.floor((days - 1) / 365);
          days = (days - 1) % 365;
        }
        let g_d = days + 1;
        const sal_g = [0, 31, ((g_y % 4 === 0 && g_y % 100 !== 0) || (g_y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let g_m = 1;
        for (g_m = 1; g_m <= 12; g_m++) {
          if (g_d <= sal_g[g_m]) break;
          g_d -= sal_g[g_m];
        }
        const gregDate = new Date(g_y, g_m - 1, g_d);
        return FA_WEEKDAYS_MAP[gregDate.getDay()] || '';
      }
    } catch {}
    return '';
  };

  const normDay = (d: string) => (d || '').replace(/[\u200c\s]+/g, '').trim();
  const normDate = (d: string) => {
    const clean = toEnglishDigits(d || '').trim().replace(/[-\.]/g, '/');
    const p = clean.split('/');
    if (p.length === 3) return `${p[0].padStart(4, '0')}/${p[1].padStart(2, '0')}/${p[2].padStart(2, '0')}`;
    return clean;
  };

  const attendanceRecordsExport = (db.attendanceRecords || []).map(r => {
    let resolvedShiftId = r.shiftId || '';
    let resolvedShiftName = r.shiftName || '';

    if (!resolvedShiftId || !resolvedShiftName) {
      const emp = (db.personnel || []).find(p =>
        (r.employeeId && p.id === r.employeeId) ||
        (p.periodId === r.periodId && (
          toEnglishDigits(p.attendanceCode || '').trim() === toEnglishDigits(r.attendanceCode || '').trim() ||
          toEnglishDigits(p.employeeCode || '').trim() === toEnglishDigits(r.attendanceCode || '').trim()
        ))
      );

      if (emp) {
        const cleanRecDate = normDate(r.date);
        const weekday = resolveJalaliWeekday(r.date);
        const matchEmp = (a: any) =>
          (a.employeeId && emp.id && a.employeeId === emp.id) ||
          (a.employeeCode && emp.employeeCode && a.employeeCode === emp.employeeCode) ||
          (a.substitutedEmployeeCode && emp.employeeCode && a.substitutedEmployeeCode === emp.employeeCode);

        const dateAssign = (db.shiftAssignments || []).find(a => a.date && normDate(a.date) === cleanRecDate && matchEmp(a));
        let targetId = '';
        if (dateAssign) {
          targetId = (dateAssign.isOnLeave || dateAssign.deptId === 'none' || dateAssign.shiftId === 'none')
            ? 'none'
            : (dateAssign.deptId || dateAssign.shiftId || '');
        } else if (emp.shiftScheduleType === 'fixed' && emp.fixedShiftId && emp.fixedShiftId !== 'none') {
          targetId = emp.fixedShiftId;
        } else {
          const weeklyAssign = (db.shiftAssignments || []).find(a =>
            !a.date && normDay(a.dayName) === normDay(weekday) &&
            (!a.periodId || a.periodId === r.periodId) && matchEmp(a)
          ) || (db.shiftAssignments || []).find(a =>
            !a.date && normDay(a.dayName) === normDay(weekday) && matchEmp(a)
          );
          if (weeklyAssign) {
            targetId = (weeklyAssign.isOnLeave || weeklyAssign.deptId === 'none' || weeklyAssign.shiftId === 'none')
              ? 'none'
              : (weeklyAssign.deptId || weeklyAssign.shiftId || '');
          }
        }

        if (!resolvedShiftId && targetId) resolvedShiftId = targetId;
        if (!resolvedShiftName && targetId) {
          if (targetId === 'none') {
            resolvedShiftName = 'بدون شیفت';
          } else {
            const sec = (db.productionSections || []).find(s => s.id === targetId || s.departmentCategoryId === targetId);
            const sh = (db.shifts || []).find(s => s.id === targetId);
            resolvedShiftName = sec ? `${sec.name}${sec.startTime && sec.endTime ? ` (${sec.startTime} - ${sec.endTime})` : ''}` : (sh ? `${sh.name}${sh.startTime && sh.endTime ? ` (${sh.startTime} - ${sh.endTime})` : ''}` : targetId);
          }
        }
      }
    }

    return {
      id: r.id,
      periodId: r.periodId,
      year: r.year,
      month: r.month,
      attendanceCode: r.attendanceCode,
      employeeId: r.employeeId || '',
      date: r.date,
      shiftId: resolvedShiftId,
      shiftName: resolvedShiftName,
      times: JSON.stringify(r.times || []),
      statuses: JSON.stringify(r.statuses || []),
      errors: JSON.stringify(r.errors || []),
      isSystemCorrected: r.isSystemCorrected || false,
      originalTimes: JSON.stringify(r.originalTimes || []),
      originalStatuses: JSON.stringify(r.originalStatuses || []),
      correctionReport: JSON.stringify(r.correctionReport || null)
    };
  });
  addSheet(attendanceRecordsExport, "Attendance_Records");

  // 34. Monthly Workday Settings
  const monthlyWorkdaySettingsExport = (db.monthlyWorkdaySettings || []).map(m => ({
    id: m.id,
    year: m.year,
    month: m.month,
    daysInMonth: m.daysInMonth,
    fridaysCount: m.fridaysCount,
    nonFridayHolidays: m.nonFridayHolidays,
    workingDaysCount: m.workingDaysCount,
    requiredWorkHours: m.requiredWorkHours
  }));
  addSheet(monthlyWorkdaySettingsExport, "Monthly_Workday_Settings");

  // 35. Payroll Calculation Rules
  const rules = db.payrollCalculationRules || {
    calculateEarlyOvertime: true,
    calculateLateOvertime: true,
    calculateHolidayWork: true,
    calculateFridayWork: true,
    calculateEntryDelayFine: false,
    delayFineRate: 1.0,
    deductClothesChangingTime: false,
    clothesChangingDuration: 15,
    deductDailyBreakTime: false,
    dailyBreakDurationMinutes: 40,
    calculatePayrollTax: false
  };
  const payrollCalculationRulesExport = [{
    calculateEarlyOvertime: rules.calculateEarlyOvertime ? 1 : 0,
    calculateLateOvertime: rules.calculateLateOvertime ? 1 : 0,
    calculateHolidayWork: rules.calculateHolidayWork ? 1 : 0,
    calculateFridayWork: rules.calculateFridayWork ? 1 : 0,
    calculateEntryDelayFine: rules.calculateEntryDelayFine ? 1 : 0,
    delayFineRate: rules.delayFineRate,
    deductClothesChangingTime: rules.deductClothesChangingTime ? 1 : 0,
    clothesChangingDuration: rules.clothesChangingDuration,
    deductDailyBreakTime: rules.deductDailyBreakTime ? 1 : 0,
    dailyBreakDurationMinutes: rules.dailyBreakDurationMinutes ?? 40,
    calculatePayrollTax: rules.calculatePayrollTax ? 1 : 0
  }];
  addSheet(payrollCalculationRulesExport, "Payroll_Calculation_Rules");

  // 36. Official Holidays
  const officialHolidaysExport = (db.officialHolidays || []).map(o => ({
    id: o.id,
    year: o.year,
    date: o.date
  }));
  addSheet(officialHolidaysExport, "Official_Holidays");

  // 36-b. Tax Exemptions (سقف‌های معافیت مالیات حقوق سالانه)
  const taxExemptionsExport = (db.taxExemptions || []).map(t => ({
    id: t.id,
    fiscalYear: t.fiscalYear,
    exemptionLimit: t.exemptionLimit
  }));
  if (taxExemptionsExport.length > 0) {
    addSheet(taxExemptionsExport, "Tax_Exemptions");
  }

  // 36-c. Tax Brackets (پله‌های مالیاتی حقوق و دستمزد)
  const taxBracketsExport = (db.taxBrackets || []).map(b => ({
    id: b.id,
    fiscalYear: b.fiscalYear,
    fromAmount: b.fromAmount,
    toAmount: b.toAmount,
    taxRate: b.taxRate
  }));
  if (taxBracketsExport.length > 0) {
    addSheet(taxBracketsExport, "Tax_Brackets");
  }

  // 36-d. Taxable Salary Items (اقلام مشمول مالیات حقوق)
  const taxableSalaryItemsExport = (db.taxableSalaryItems || []).map(item => ({
    id: item.id,
    periodId: item.periodId || '',
    itemKey: item.itemKey,
    itemName: item.itemName,
    startDate: item.startDate || '',
    endDate: item.endDate || ''
  }));
  if (taxableSalaryItemsExport.length > 0) {
    addSheet(taxableSalaryItemsExport, "Taxable_Salary_Items");
  }

  // 37. Contract Template Settings
  const contractTemplateExport = [{
    text: db.contractTemplateText || '',
    intro: db.contractIntroText || '',
    employer: db.contractEmployerText || '',
    location: db.contractLocationText || '',
    hours: db.contractHoursText || '',
    rest: db.contractRestText || '',
    holiday: db.contractHolidayText || ''
  }];
  addSheet(contractTemplateExport, "Contract_Template");

  // 38. Personnel Capability Evaluation Matrix
  const capabilityMatrixExport = (db.personnel || []).map(p => {
    const row: any = {
      employeeCode: p.employeeCode,
      fullName: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || '',
    };
    (db.productionSections || []).forEach(sec => {
      const caps = p.capabilities || [];
      if (caps.includes(sec.id)) {
        row[sec.name] = caps[0] === sec.id ? "اصلی" : "کمکی";
      } else {
        row[sec.name] = "";
      }
    });
    return row;
  });
  addSheet(capabilityMatrixExport, "Capability_Matrix");

  // 39. Dibal Scales Configuration
  const dibalScalesExport = (db.dibalScales || []).map(s => ({
    id: s.id,
    name: s.name,
    model: s.model,
    scaleId: s.scaleId,
    departmentId: s.departmentId,
    connectionType: s.connectionType,
    ipAddress: s.ipAddress,
    subnetMask: s.subnetMask,
    gateway: s.gateway,
    txPort: s.txPort,
    rxPort: s.rxPort,
    comPort: s.comPort || '',
    baudRate: s.baudRate || 9600,
    parity: s.parity || 'none',
    stopBits: s.stopBits || 1,
    barcodePrefix: s.barcodePrefix,
    isOnline: s.isOnline,
    lastSyncTime: s.lastSyncTime || '',
    autoSyncReceipts: s.autoSyncReceipts || false
  }));
  addSheet(dibalScalesExport, "Dibal_Scales");

  // 40. Dibal PLUs Catalog
  const dibalPLUsExport = (db.dibalPLUs || []).map(p => ({
    id: p.id,
    pluCode: p.pluCode,
    name: p.name,
    secondName: p.secondName || '',
    pricePerKg: p.pricePerKg,
    itemType: p.itemType || 'weighted',
    priceType: p.priceType || 'variable',
    directKeyNumber: p.directKeyNumber || '',
    departmentCode: p.departmentCode,
    sectionCode: p.sectionCode || 1,
    tareWeight: p.tareWeight || 0,
    expiryDays: p.expiryDays || 10,
    packOffsetDays: p.packOffsetDays || 0,
    vatRate: p.vatRate || 0,
    promoPrice: p.promoPrice || 0,
    ingredientsText: p.ingredientsText || '',
    barcodeFormat: p.barcodeFormat || '21PPPWWWWWC',
    barcodeType: p.barcodeType || 'EAN-13',
    productId: p.productId || '',
    itemId: p.itemId || '',
    lastSentAt: p.lastSentAt || '',
    status: p.status || 'synced'
  }));
  addSheet(dibalPLUsExport, "Dibal_PLUs");

  // 41. Dibal Weighing Tickets
  const dibalTicketsExport = (db.dibalTickets || []).map(t => ({
    id: t.id,
    scaleId: t.scaleId,
    ticketNumber: t.ticketNumber,
    date: t.date,
    time: t.time,
    pluCode: t.pluCode,
    itemName: t.itemName,
    itemType: t.itemType || 'weighted',
    quantity: t.quantity || 1,
    netWeightKg: t.netWeightKg,
    unitPrice: t.unitPrice,
    totalPrice: t.totalPrice,
    status: t.status
  }));
  addSheet(dibalTicketsExport, "Dibal_Tickets");

  // 42. Customer Categories
  const customerCategoriesExport = (db.customerCategories || []).map(c => ({
    id: c.id,
    periodId: c.periodId || '',
    name: c.name,
    code: c.code || '',
    defaultDiscountPercent: c.defaultDiscountPercent || 0,
    defaultPaymentTerm: c.defaultPaymentTerm || '',
    description: c.description || ''
  }));
  addSheet(customerCategoriesExport, "Customer_Categories");

  // 43. Customers
  const customersExport = (db.customers || []).map(c => ({
    id: c.id,
    periodId: c.periodId,
    code: c.code,
    accountingCode: c.accountingCode || '',
    name: c.name,
    type: c.type,
    categoryId: c.categoryId || '',
    contactPerson: c.contactPerson || '',
    nationalId: c.nationalId || '',
    economicCode: c.economicCode || '',
    registrationNo: c.registrationNo || '',
    phone: c.phone,
    tel: c.tel || '',
    fax: c.fax || '',
    email: c.email || '',
    province: c.province || '',
    city: c.city || '',
    postalCode: c.postalCode || '',
    address: c.address,
    deliveryAddress: c.deliveryAddress || '',
    discountPercent: c.discountPercent || 0,
    creditLimit: c.creditLimit || 0,
    settlementPeriodDays: c.settlementPeriodDays || 0,
    paymentTerms: c.paymentTerms || 'نقدی',
    salesAgent: c.salesAgent || '',
    bankAccounts: JSON.stringify(c.bankAccounts || []),
    isActive: c.isActive,
    status: c.status || 'active',
    blockReason: c.blockReason || '',
    notes: c.notes || '',
    preferredProductIds: (c.preferredProductIds || []).join(';'),
    createdAt: c.createdAt || ''
  }));
  addSheet(customersExport, "Customers");

  // 44. Personnel Settlements (اسناد تسویه حساب پرسنل)
  const personnelSettlementsExport = (db.personnelSettlements || []).map(s => ({
    id: s.id,
    periodId: s.periodId,
    settlementNo: s.settlementNo,
    employeeCode: s.employeeCode,
    contractId: s.contractId || '',
    reason: s.reason,
    startDate: s.startDate,
    endDate: s.endDate,
    settlementDate: s.settlementDate,
    totalPeriodDays: s.totalPeriodDays || 0,
    totalWorkedDays: s.totalWorkedDays || 0,
    dailySalaryForCalculation: s.dailySalaryForCalculation || 0,
    monthlyBaseSalaryForCalculation: s.monthlyBaseSalaryForCalculation || 0,
    severanceDays: s.severanceDays || 0,
    severanceAmount: s.severanceAmount || 0,
    bonusDays: s.bonusDays || 0,
    bonusAmount: s.bonusAmount || 0,
    totalEntitledLeaveDays: s.totalEntitledLeaveDays || 0,
    totalUsedLeaveDays: s.totalUsedLeaveDays || 0,
    unusedLeaveDays: s.unusedLeaveDays || 0,
    unusedLeaveAmount: s.unusedLeaveAmount || 0,
    totalBaseSalaries: s.totalBaseSalaries || 0,
    totalFoodAllowances: s.totalFoodAllowances || 0,
    totalHousingAllowances: s.totalHousingAllowances || 0,
    totalChildAllowances: s.totalChildAllowances || 0,
    totalMarriageAllowances: s.totalMarriageAllowances || 0,
    totalOvertimeAmounts: s.totalOvertimeAmounts || 0,
    totalHolidayWorkAmounts: s.totalHolidayWorkAmounts || 0,
    totalFridayWorkAmounts: s.totalFridayWorkAmounts || 0,
    totalInsurableGross: s.totalInsurableGross || 0,
    totalGrossSalaries: s.totalGrossSalaries || 0,
    totalWorkerInsurance: s.totalWorkerInsurance || 0,
    totalNetSalaries: s.totalNetSalaries || 0,
    totalGrossPayable: s.totalGrossPayable || 0,
    previousYearReceivableAmount: s.previousYearReceivableAmount || 0,
    previousYearReceivableDescription: s.previousYearReceivableDescription || '',
    personnelPurchasesAmount: s.personnelPurchasesAmount || 0,
    otherDeductionsAmount: s.otherDeductionsAmount || 0,
    otherDeductionsDescription: s.otherDeductionsDescription || '',
    totalDeductions: s.totalDeductions || 0,
    employerPaidAmount: s.employerPaidAmount || 0,
    finalNetPayable: s.finalNetPayable || 0,
    status: s.status || 'draft',
    notes: s.notes || '',
    payrollSyncedAt: s.payrollSyncedAt || '',
    registeredBy: s.registeredBy || '',
    createdAt: s.createdAt || '',
    updatedAt: s.updatedAt || '',
    monthlyDetails: JSON.stringify(s.monthlyDetails || [])
  }));
  addSheet(personnelSettlementsExport, "Personnel_Settlements");

  // 45. Settlement Monthly Details (ریز کارکرد و محاسبات ماهانه اسناد تسویه)
  const settlementDetailsExport: any[] = [];
  (db.personnelSettlements || []).forEach(s => {
    (s.monthlyDetails || []).forEach((m, idx) => {
      settlementDetailsExport.push({
        settlementId: s.id,
        settlementNo: s.settlementNo,
        employeeCode: s.employeeCode,
        monthIndex: m.monthIndex !== undefined ? m.monthIndex : (idx + 1),
        year: m.year,
        month: m.month,
        monthName: m.monthName,
        totalDaysInMonth: m.totalDaysInMonth,
        workedDays: m.workedDays,
        dailyBaseSalary: m.dailyBaseSalary,
        baseSalary: m.baseSalary,
        foodAllowance: m.foodAllowance,
        housingAllowance: m.housingAllowance,
        childAllowance: m.childAllowance,
        marriageAllowance: m.marriageAllowance,
        overtimeHours: m.overtimeHours,
        overtimeAmount: m.overtimeAmount,
        holidayWorkHours: m.holidayWorkHours,
        holidayWorkAmount: m.holidayWorkAmount,
        fridayWorkHours: m.fridayWorkHours,
        fridayHourlyRate: m.fridayHourlyRate || 0,
        fridayWorkAmount: m.fridayWorkAmount,
        grossSalary: m.grossSalary,
        insurableGross: m.insurableGross || 0,
        workerInsuranceShare: m.workerInsuranceShare,
        netSalaryPayable: m.netSalaryPayable,
        usedLeaveDays: m.usedLeaveDays,
        syncedFromPayroll: m.syncedFromPayroll ? 1 : 0,
        payrollSourceType: m.payrollSourceType || '',
        payrollItemPayable: m.payrollItemPayable || 0,
        payrollLeaveRemainingMinutes: m.payrollLeaveRemainingMinutes !== undefined ? m.payrollLeaveRemainingMinutes : ''
      });
    });
  });
  if (settlementDetailsExport.length > 0) {
    addSheet(settlementDetailsExport, "Settlement_Monthly_Details");
  }

  // 56. Approved Shift Mismatches (تاییدهای مغایرت شیفت و تردد)
  const rawApproved = Array.isArray(db.approvedMismatches) ? db.approvedMismatches : [];
  let effectiveApprovedMismatches = [...rawApproved];
  if (effectiveApprovedMismatches.length === 0 && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('approved_mismatches');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          effectiveApprovedMismatches = parsed;
        }
      }
    } catch {}
  }
  const approvedMismatchesExport = effectiveApprovedMismatches.map((mismatchKey, idx) => ({
    id: `apm-${idx + 1}`,
    mismatchKey: String(mismatchKey)
  }));
  if (approvedMismatchesExport.length > 0) {
    addSheet(approvedMismatchesExport, "Approved_Shift_Mismatches");
  }

  // 57. Payroll Settings
  if (db.payrollSettings && db.payrollSettings.length > 0) {
    addSheet(db.payrollSettings.map((s: any) => ({ payload: JSON.stringify(s) })), "Payroll_Settings");
  }

  // 58. Payroll Manual Overrides (کارکرد و بیمه و کسر مدیریتی دستی)
  if (db.payrollManualOverrides && Object.keys(db.payrollManualOverrides).length > 0) {
    const overridesExport = Object.entries(db.payrollManualOverrides).map(([overrideKey, data]) => ({
      overrideKey,
      workDaysJson: JSON.stringify(data?.workDays || {}),
      insuranceDaysJson: JSON.stringify(data?.insuranceDays || {}),
      normalMgmtDeductionsJson: JSON.stringify(data?.normalMgmtDeductions || {})
    }));
    addSheet(overridesExport, "Payroll_Manual_Overrides");
  }

  // 59. Personnel Capabilities Map
  if (db.personnelCapabilities && Object.keys(db.personnelCapabilities).length > 0) {
    const capsExport = Object.entries(db.personnelCapabilities).map(([employeeCode, capabilities]) => ({
      employeeCode,
      capabilitiesJson: JSON.stringify(capabilities || [])
    }));
    addSheet(capsExport, "Personnel_Capabilities");
  }

  // 60. Attendance Device Config
  if (db.attendanceDeviceConfig) {
    addSheet([{ payload: JSON.stringify(db.attendanceDeviceConfig) }], "Attendance_Device_Config");
  }

  // 61. SQL Server Config
  if (db.sqlServerConfig) {
    addSheet([{ payload: JSON.stringify(db.sqlServerConfig) }], "Sql_Server_Config");
  }

  // Generate Excel workbook as compressed binary
  const blob = writeWorkbookToBlob(wb);
  
  // Trigger download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Gatan_Financial_Database_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importExcelToDatabase(fileBuffer: ArrayBuffer, currentDb: AppDatabase): AppDatabase {
  const bytes = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
  const wb = XLSX.read(bytes, { type: 'array' });
  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new Error('فایل اکسل انتخاب شده فاقد هرگونه ورقه (Sheet) معتبر است.');
  }

  const recognizedSheetNames = new Set([
    'periods', 'item_categories', 'raw_items', 'suppliers', 'product_categories',
    'departments', 'products', 'sales_periods', 'product_sales', 'unit_conversions',
    'product_formulas', 'personnel', 'payroll_periods', 'payroll_items',
    'payroll_calculations', 'personnel_allocations', 'period_overheads',
    'procurement_orders', 'stock_audits', 'stock_counts', 'purchase_invoices',
    'daily_production_segments', 'users', 'user_roles', 'shifts', 'shift_assignments',
    'production_sections', 'shift_schemes', 'sales_transactions', 'warehouses',
    'salary_base_rates', 'personnel_contracts', 'seniority_rate_rules',
    'custom_banks', 'insured_salary_items', 'personnel_categories',
    'attendance_records', 'monthly_workday_settings', 'payroll_calculation_rules',
    'official_holidays', 'tax_exemptions', 'tax_brackets', 'taxable_salary_items',
    'contract_template', 'capability_matrix', 'dibal_scales', 'dibal_plus',
    'dibal_tickets', 'customer_categories', 'customers', 'personnel_settlements',
    'settlement_monthly_details', 'approved_shift_mismatches', 'payroll_settings',
    'payroll_manual_overrides', 'personnel_capabilities', 'attendance_device_config',
    'sql_server_config', 'لیست حقوق', 'دوره های حقوق', 'محاسبه حقوق و دستمزد',
    'ریز اقلام حقوق', 'تایید مغایرت ها', 'تاییدات مغایرت شیفت', 'approvedmismatches',
  ]);
  const hasAnyBackupSheet = wb.SheetNames.some((n) =>
    recognizedSheetNames.has(String(n || '').trim().toLowerCase())
  );
  if (!hasAnyBackupSheet) {
    throw new Error(
      `فایل اکسل فاقد ورقه‌های استاندارد پشتیبان سامانه است (ورقه‌های یافت‌شده: ${wb.SheetNames.slice(0, 5).join('، ')}).`
    );
  }

  const result = { ...currentDb };

  const getSheetData = (sheetName: string, alternativeNames: string[] = []): any[] | null => {
    let resolvedName: string | undefined;
    let ws = wb.Sheets[sheetName];
    if (ws) resolvedName = sheetName;
    if (!ws && alternativeNames.length > 0) {
      for (const alt of alternativeNames) {
        if (wb.Sheets[alt]) {
          ws = wb.Sheets[alt];
          resolvedName = alt;
          break;
        }
      }
    }
    if (!ws) {
      const allNames = wb.SheetNames || [];
      const found = allNames.find(n => 
        n.trim().toLowerCase() === sheetName.trim().toLowerCase() ||
        alternativeNames.some(alt => alt.trim().toLowerCase() === n.trim().toLowerCase())
      );
      if (found) {
        ws = wb.Sheets[found];
        resolvedName = found;
      }
    }
    if (!ws) return null;

    const allRows: any[] = [];
    const appendRows = (target: any[], source: any[]) => {
      if (!Array.isArray(source) || source.length === 0) return;
      for (let i = 0; i < source.length; i++) {
        target.push(source[i]);
      }
    };

    const baseData = safeImportData(XLSX.utils.sheet_to_json(ws));
    appendRows(allRows, baseData);

    // Reassemble continuation sheets (<base>_P2, <base>_P3, ...) if large table was split
    const basePrefix = (resolvedName || sheetName).replace(/[:\\\/\?\*\[\]]/g, '_').slice(0, 25);
    const allSheetNames = wb.SheetNames || [];
    let partIdx = 2;
    while (true) {
      const partName = `${basePrefix}_P${partIdx}`;
      const matchedPart = wb.Sheets[partName]
        ? partName
        : allSheetNames.find(n => n.trim().toLowerCase() === partName.toLowerCase());
      if (!matchedPart || !wb.Sheets[matchedPart]) break;
      const partData = safeImportData(XLSX.utils.sheet_to_json(wb.Sheets[matchedPart]));
      appendRows(allRows, partData);
      partIdx++;
    }

    return allRows;
  };

  const parseBoolean = (val: any): boolean => {
    return val === true || val === 'true' || val === 1 || val === '1' || String(val).toLowerCase() === 'true';
  };

  const parseNumber = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    const num = Number(toEnglishDigits(String(val)));
    return isNaN(num) ? 0 : num;
  };

  const parseJSON = (val: any, fallback: any) => {
    if (val === undefined || val === null || val === '') return fallback;
    try {
      const decoded = typeof val === 'string' ? JSON.parse(val.trim()) : val;
      if (Array.isArray(fallback)) {
        return Array.isArray(decoded) ? decoded : fallback;
      }
      if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
        return decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : fallback;
      }
      return decoded ?? fallback;
    } catch {
      return fallback;
    }
  };

  // 1. Periods
  const periodsRows = getSheetData("Periods");
  if (periodsRows) {
    result.periods = periodsRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      isActive: parseBoolean(r.isActive),
      createdAt: String(r.createdAt || ''),
      startDate: r.startDate ? String(r.startDate) : undefined,
      endDate: r.endDate ? String(r.endDate) : undefined,
    })).filter(x => x.id);
  }

  // 2. Item Categories
  const catRows = getSheetData("Item_Categories");
  if (catRows) {
    result.itemCategories = catRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
    })).filter(x => x.id);
  }

  // 3. Raw Items
  const itemsRows = getSheetData("Raw_Items");
  if (itemsRows) {
    result.items = itemsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      code: String(r.code || ''),
      accountId: String(r.accountId || ''),
      name: String(r.name || ''),
      categoryId: String(r.categoryId || ''),
      unit: (r.unit === 'عددی' ? 'عددی' : 'کیلویی') as any,
      barcode: String(r.barcode || ''),
      systemBarcode: r.systemBarcode ? String(r.systemBarcode).trim() : undefined,
      packageType: (r.packageType || 'کارتن') as any,
      qtyPerPackage: parseNumber(r.qtyPerPackage) || 1,
      weightPerPackage: parseNumber(r.weightPerPackage) || 1,
      reorderThreshold: parseNumber(r.reorderThreshold),
      price: parseNumber(r.price),
      isActive: parseBoolean(r.isActive),
      warehouse: r.warehouse ? String(r.warehouse) : undefined,
    })).filter(x => x.id);
  }

  // 4. Suppliers
  const suppliersRows = getSheetData("Suppliers");
  if (suppliersRows) {
    result.suppliers = suppliersRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
      phone: String(r.phone || ''),
      address: String(r.address || ''),
      isActive: parseBoolean(r.isActive),
      bankAccounts: parseJSON(r.bankAccounts, []),
      suppliedItemIds: typeof r.suppliedItemIds === 'string' 
        ? r.suppliedItemIds.split(';').filter((x: string) => x) 
        : (Array.isArray(r.suppliedItemIds) ? r.suppliedItemIds : []),
    })).filter(x => x.id);
  }

  // 5. Product Categories
  const pCatRows = getSheetData("Product_Categories");
  if (pCatRows) {
    result.productCategories = pCatRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
      targetMargin: r.targetMargin !== undefined ? parseNumber(r.targetMargin) : undefined,
      departmentId: r.departmentId !== undefined && String(r.departmentId).trim() !== '' ? String(r.departmentId).trim() : undefined,
    })).filter(x => x.id);
  }

  // 5b. Production Departments
  const deptRows = getSheetData("Departments");
  if (deptRows) {
    result.departments = deptRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
      code: r.code ? String(r.code) : undefined,
      targetMargin: r.targetMargin !== undefined ? parseNumber(r.targetMargin) : undefined,
      isShared: r.isShared !== undefined ? parseBoolean(r.isShared) : undefined,
    })).filter(x => x.id);
  }

  // 6. Products
  const productsRows = getSheetData("Products");
  if (productsRows) {
    result.products = productsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      code: String(r.code || ''),
      accountId: String(r.accountId || ''),
      name: String(r.name || ''),
      categoryId: String(r.categoryId || ''),
      unit: (r.unit === 'کیلو' ? 'کیلو' : 'عدد') as any,
      barcode: String(r.barcode || ''),
      packageType: (r.packageType || 'سلفون') as any,
      qtyPerPackage: parseNumber(r.qtyPerPackage) || 1,
      weightPerPackage: parseNumber(r.weightPerPackage) || 1,
      salePrice: parseNumber(r.salePrice),
      cogsPrice: parseNumber(r.cogsPrice),
      weight: r.weight !== undefined ? parseNumber(r.weight) : undefined,
      approvedPrice: r.approvedPrice !== undefined ? parseNumber(r.approvedPrice) : undefined,
      isWip: r.isWip !== undefined ? parseBoolean(r.isWip) : false,
    })).filter(x => x.id);
  }

  // 7. Sales Periods
  const salesPeriodsRows = getSheetData("Sales_Periods");
  if (salesPeriodsRows) {
    result.salesPeriods = salesPeriodsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
      slateDate: r.slateDate ? String(r.slateDate) : undefined,
      startDate: String(r.startDate || ''),
      endDate: String(r.endDate || ''),
    })).filter(x => x.id);
  }

  // 8. Product Sales
  const productSalesRows = getSheetData("Product_Sales");
  if (productSalesRows) {
    result.productSales = productSalesRows.map(r => ({
      id: String(r.id || ''),
      salesPeriodId: String(r.salesPeriodId || ''),
      periodId: String(r.periodId || ''),
      productId: String(r.productId || ''),
      qtySold: parseNumber(r.qtySold),
      discount: parseNumber(r.discount),
      preDiscountAmount: parseNumber(r.preDiscountAmount),
      netSalesAmount: parseNumber(r.netSalesAmount),
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : (r.salesPeriodId ? parseNumber(r.salesPeriodId) : undefined),
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : undefined,
    })).filter(x => x.id);
  }

  // 9. Unit Conversions
  const conversionsRows = getSheetData("Unit_Conversions");
  if (conversionsRows) {
    result.unitConversions = conversionsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      rawMaterialId: String(r.rawMaterialId || ''),
      purchaseUnit: String(r.purchaseUnit || ''),
      consumptionUnit: String(r.consumptionUnit || ''),
      factor: parseNumber(r.factor),
    })).filter(x => x.id);
  }

  // 10. Product Formulas
  const formulasRows = getSheetData("Product_Formulas");
  if (formulasRows) {
    result.productFormulas = formulasRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      productId: String(r.productId || ''),
      ingredients: parseJSON(r.ingredients, []),
      name: r.name ? String(r.name) : undefined,
      isActive: r.isActive === true || r.isActive === 'true' || r.isActive === 1 || r.isActive === '1' ? true : undefined,
    })).filter(x => x.id);
  }

  // 11. Personnel
  const personnelRows = getSheetData("Personnel");
  if (personnelRows) {
    result.personnel = personnelRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      employeeCode: String(r.employeeCode || ''),
      accountCode: r.accountCode ? String(r.accountCode) : undefined,
      nationalId: r.nationalId ? String(r.nationalId) : undefined,
      insuranceCode: r.insuranceCode ? String(r.insuranceCode) : undefined,
      fatherName: r.fatherName ? String(r.fatherName) : undefined,
      birthDate: r.birthDate ? String(r.birthDate) : undefined,
      birthPlace: r.birthPlace ? String(r.birthPlace) : undefined,
      center: r.center ? String(r.center) : undefined,
      project: r.project ? String(r.project) : undefined,
      complementaryInsurance: r.complementaryInsurance !== undefined ? parseBoolean(r.complementaryInsurance) : undefined,
      yearsBase: r.yearsBase !== undefined ? parseNumber(r.yearsBase) : undefined,
      entryDate: r.entryDate ? String(r.entryDate) : undefined,
      insuranceDate: r.insuranceDate ? String(r.insuranceDate) : undefined,
      dailyYearsDifference: r.dailyYearsDifference !== undefined ? parseNumber(r.dailyYearsDifference) : undefined,
      bankName: r.bankName ? String(r.bankName) : undefined,
      bankAccount: r.bankAccount ? String(r.bankAccount) : undefined,
      shaba: r.shaba ? String(r.shaba) : undefined,
      cardNo: r.cardNo ? String(r.cardNo) : undefined,
      hasInsurance: r.hasInsurance !== undefined ? parseBoolean(r.hasInsurance) : undefined,
      employerPremium3: r.employerPremium3 !== undefined ? parseNumber(r.employerPremium3) : undefined,
      employerPremium: r.employerPremium !== undefined ? parseNumber(r.employerPremium) : undefined,
      workerPremium: r.workerPremium !== undefined ? parseNumber(r.workerPremium) : undefined,
      attractionAllowance: r.attractionAllowance !== undefined ? parseNumber(r.attractionAllowance) : undefined,
      baseSalaryInsurance: r.baseSalaryInsurance !== undefined ? parseNumber(r.baseSalaryInsurance) : undefined,
      dailyWage: r.dailyWage !== undefined ? parseNumber(r.dailyWage) : undefined,
      isDailyWage: r.isDailyWage !== undefined ? parseBoolean(r.isDailyWage) : undefined,
      taxShare: r.taxShare !== undefined ? parseNumber(r.taxShare) : undefined,
      childrenCount: r.childrenCount !== undefined ? parseNumber(r.childrenCount) : undefined,
      isMarried: r.isMarried !== undefined ? parseBoolean(r.isMarried) : undefined,
      fixedAllowances: r.fixedAllowances !== undefined ? parseNumber(r.fixedAllowances) : undefined,
      firstName: r.firstName ? String(r.firstName) : undefined,
      lastName: r.lastName ? String(r.lastName) : undefined,
      fullName: r.fullName ? String(r.fullName) : undefined,
      mobile: r.mobile ? String(r.mobile) : undefined,
      role: r.role ? String(r.role) : undefined,
      isActive: parseBoolean(r.isActive),
      baseSalary: r.baseSalary !== undefined ? parseNumber(r.baseSalary) : undefined,
      insuranceHistory: r.insuranceHistory !== undefined ? String(r.insuranceHistory) : undefined,
      bankAccounts: parseJSON(r.bankAccounts, []),
      capabilities: parseJSON(r.capabilities, []),
      attendanceCode: r.attendanceCode ? String(r.attendanceCode) : undefined,
      postalCode: r.postalCode ? String(r.postalCode) : undefined,
      jobAllowance: r.jobAllowance !== undefined ? parseNumber(r.jobAllowance) : undefined,
      isSubjectToEmployerPremium: r.isSubjectToEmployerPremium !== undefined ? parseBoolean(r.isSubjectToEmployerPremium) : undefined,
      isSubjectToUnemploymentPremium: r.isSubjectToUnemploymentPremium !== undefined ? parseBoolean(r.isSubjectToUnemploymentPremium) : undefined,
      isSubjectToWorkerPremium: r.isSubjectToWorkerPremium !== undefined ? parseBoolean(r.isSubjectToWorkerPremium) : undefined,
      gender: r.gender ? String(r.gender) as any : undefined,
      maritalStatus: r.maritalStatus ? String(r.maritalStatus) as any : undefined,
      childrenList: parseJSON(r.childrenList, []),
      address: r.address ? String(r.address) : undefined,
      emergencyMobile: r.emergencyMobile ? String(r.emergencyMobile) : undefined,
      insuranceHistoryDays: r.insuranceHistoryDays !== undefined ? parseNumber(r.insuranceHistoryDays) : undefined,
      personnelCategoryId: r.personnelCategoryId ? String(r.personnelCategoryId) : undefined,
      militaryStatus: r.militaryStatus ? String(r.militaryStatus) as any : undefined,
      hasNationalCardCopy: r.hasNationalCardCopy !== undefined ? parseBoolean(r.hasNationalCardCopy) : undefined,
      hasBirthCertificatePagesCopy: r.hasBirthCertificatePagesCopy !== undefined ? parseBoolean(r.hasBirthCertificatePagesCopy) : undefined,
      hasPhoto: r.hasPhoto !== undefined ? parseBoolean(r.hasPhoto) : undefined,
      hasSocialSecurityRegistrationForm: r.hasSocialSecurityRegistrationForm !== undefined ? parseBoolean(r.hasSocialSecurityRegistrationForm) : undefined,
      hasPromissoryNote: r.hasPromissoryNote !== undefined ? parseBoolean(r.hasPromissoryNote) : undefined,
      hasHealthCard: r.hasHealthCard !== undefined ? parseBoolean(r.hasHealthCard) : undefined,
      hasPreEmploymentExam: r.hasPreEmploymentExam !== undefined ? parseBoolean(r.hasPreEmploymentExam) : undefined,
      promissoryNoteNumber: r.promissoryNoteNumber ? String(r.promissoryNoteNumber) : undefined,
      promissoryNoteIssuerName: r.promissoryNoteIssuerName ? String(r.promissoryNoteIssuerName) : undefined,
      promissoryNoteAmount: r.promissoryNoteAmount !== undefined ? parseNumber(r.promissoryNoteAmount) : undefined,
      hasSupplementaryInsurance: r.hasSupplementaryInsurance !== undefined ? parseBoolean(r.hasSupplementaryInsurance) : undefined,
      supplementaryInsuranceDate: r.supplementaryInsuranceDate ? String(r.supplementaryInsuranceDate) : undefined,
      supplementaryInsurancePremium: r.supplementaryInsurancePremium !== undefined ? parseNumber(r.supplementaryInsurancePremium) : undefined,
      contractStartDate: r.contractStartDate ? String(r.contractStartDate) : undefined,
      contractEndDate: r.contractEndDate ? String(r.contractEndDate) : undefined,
      contractDurationMonths: r.contractDurationMonths !== undefined ? parseNumber(r.contractDurationMonths) : undefined,
      contractBaseSalary: r.contractBaseSalary !== undefined ? parseNumber(r.contractBaseSalary) : undefined,
      contractDailySalary: r.contractDailySalary !== undefined && r.contractDailySalary !== '' ? parseNumber(r.contractDailySalary) : (r['حقوق روزانه قرارداد'] !== undefined ? parseNumber(r['حقوق روزانه قرارداد']) : undefined),
      contractDailyWageAmount: r.contractDailyWageAmount !== undefined && r.contractDailyWageAmount !== '' ? parseNumber(r.contractDailyWageAmount) : (r['مزد روزانه مقطوع'] !== undefined ? parseNumber(r['مزد روزانه مقطوع']) : undefined),
      departureDate: r.departureDate ? String(r.departureDate) : (r['تاریخ ترک کار'] ? String(r['تاریخ ترک کار']) : undefined),
      departureReason: r.departureReason ? String(r.departureReason) : (r['علت ترک کار'] ? String(r['علت ترک کار']) : undefined),
      shiftScheduleType: r.shiftScheduleType ? String(r.shiftScheduleType) as any : (r['نوع شیفت'] ? String(r['نوع شیفت']) as any : undefined),
      fixedShiftId: r.fixedShiftId ? String(r.fixedShiftId) : (r['شیفت ثابت'] ? String(r['شیفت ثابت']) : undefined),
      birthCertificateNumber: r.birthCertificateNumber ? String(r.birthCertificateNumber) : undefined
    })).filter(x => x.id);
  }

  // 12. Payroll Periods
  const prPeriodsRows = getSheetData("Payroll_Periods", ["لیست حقوق", "دوره های حقوق", "PayrollPeriods"]);
  if (prPeriodsRows) {
    result.payrollPeriods = prPeriodsRows.map(r => ({
      id: String(r.id || r['شناسه'] || `pp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`),
      periodId: String(r.periodId || r['دوره مالی'] || result.selectedPeriodId || ''),
      title: String(r.title || r['عنوان لیست'] || r['عنوان'] || ''),
      dateRange: String(r.dateRange || r['بازه زمانی'] || ''),
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : (r['ماه'] !== undefined ? parseNumber(r['ماه']) : undefined),
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : (r['سال'] !== undefined ? parseNumber(r['سال']) : undefined),
      status: r.status ? String(r.status) as any : (r['وضعیت'] ? String(r['وضعیت']) as any : 'ثبت شده'),
      registeredAt: r.registeredAt ? String(r.registeredAt) : (r['تاریخ ثبت'] ? String(r['تاریخ ثبت']) : undefined),
      totalEmployees: r.totalEmployees !== undefined && r.totalEmployees !== '' ? parseNumber(r.totalEmployees) : (r['تعداد پرسنل'] !== undefined ? parseNumber(r['تعداد پرسنل']) : undefined),
      totalNetPayable: r.totalNetPayable !== undefined && r.totalNetPayable !== '' ? parseNumber(r.totalNetPayable) : (r['جمع خالص پرداختی'] !== undefined ? parseNumber(r['جمع خالص پرداختی']) : undefined),
      totalInsurance: r.totalInsurance !== undefined && r.totalInsurance !== '' ? parseNumber(r.totalInsurance) : (r['جمع کل بیمه'] !== undefined ? parseNumber(r['جمع کل بیمه']) : undefined),
      totalCost: r.totalCost !== undefined && r.totalCost !== '' ? parseNumber(r.totalCost) : (r['بهای تمام شده حقوق کارفرما'] !== undefined ? parseNumber(r['بهای تمام شده حقوق کارفرما']) : undefined),
      attendancePerformanceSnapshot: r.attendancePerformanceSnapshot ? parseJSON(r.attendancePerformanceSnapshot, undefined) : undefined,
    })).filter(x => x.id);
  }

  // 13. Payroll Items (با بارگذاری کامل تمام ستون‌های محاسباتی کارکرد، بیمه، مالیات و حقوق)
  const prItemsRows = getSheetData("Payroll_Items", ["محاسبه حقوق و دستمزد", "ریز اقلام حقوق", "Payroll_Calculations"]);
  if (prItemsRows) {
    result.payrollItems = prItemsRows.map(r => ({
      id: String(r.id || r['شناسه'] || `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`),
      payrollPeriodId: r.payrollPeriodId ? String(r.payrollPeriodId) : (r['شناسه دوره حقوق'] ? String(r['شناسه دوره حقوق']) : undefined),
      periodId: String(r.periodId || r['دوره مالی'] || result.selectedPeriodId || ''),
      employeeCode: String(r.employeeCode || r['کد پرسنل'] || ''),
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : (r['ماه'] !== undefined ? parseNumber(r['ماه']) : undefined),
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : (r['سال'] !== undefined ? parseNumber(r['سال']) : undefined),
      baseSalary: r.baseSalary !== undefined && r.baseSalary !== '' ? parseNumber(r.baseSalary) : (r['حقوق پایه ماهانه'] !== undefined ? parseNumber(r['حقوق پایه ماهانه']) : undefined),
      housingAllowance: r.housingAllowance !== undefined && r.housingAllowance !== '' ? parseNumber(r.housingAllowance) : (r['حق مسکن'] !== undefined ? parseNumber(r['حق مسکن']) : undefined),
      foodAllowance: r.foodAllowance !== undefined && r.foodAllowance !== '' ? parseNumber(r.foodAllowance) : (r['حق بن'] !== undefined ? parseNumber(r['حق بن']) : undefined),
      childAllowance: r.childAllowance !== undefined && r.childAllowance !== '' ? parseNumber(r.childAllowance) : (r['حق اولاد'] !== undefined ? parseNumber(r['حق اولاد']) : undefined),
      marriageAllowance: r.marriageAllowance !== undefined && r.marriageAllowance !== '' ? parseNumber(r.marriageAllowance) : (r['حق تاهل'] !== undefined ? parseNumber(r['حق تاهل']) : undefined),
      seniorityBase: r.seniorityBase !== undefined && r.seniorityBase !== '' ? parseNumber(r.seniorityBase) : (r['پایه سنوات'] !== undefined ? parseNumber(r['پایه سنوات']) : undefined),
      jobAllowance: r.jobAllowance !== undefined && r.jobAllowance !== '' ? parseNumber(r.jobAllowance) : (r['فوق العاده شغلی'] !== undefined ? parseNumber(r['فوق العاده شغلی']) : undefined),
      monthlyEidi: r.monthlyEidi !== undefined && r.monthlyEidi !== '' ? parseNumber(r.monthlyEidi) : (r['عیدی و پاداش ماهانه'] !== undefined ? parseNumber(r['عیدی و پاداش ماهانه']) : undefined),
      monthlyYearsBenefit: r.monthlyYearsBenefit !== undefined && r.monthlyYearsBenefit !== '' ? parseNumber(r.monthlyYearsBenefit) : (r['حق سنوات ماهانه'] !== undefined ? parseNumber(r['حق سنوات ماهانه']) : undefined),
      attendanceDaysWorked: r.attendanceDaysWorked !== undefined && r.attendanceDaysWorked !== '' ? parseNumber(r.attendanceDaysWorked) : (r['روز کارکرد تردد'] !== undefined && r['روز کارکرد تردد'] !== '' ? parseNumber(r['روز کارکرد تردد']) : undefined),
      workDaysCount: r.workDaysCount !== undefined && r.workDaysCount !== '' ? parseNumber(r.workDaysCount) : (r['روز کارکرد'] !== undefined ? parseNumber(r['روز کارکرد']) : undefined),
      insuranceDaysCount: r.insuranceDaysCount !== undefined && r.insuranceDaysCount !== '' ? parseNumber(r.insuranceDaysCount) : (r['روز بیمه'] !== undefined ? parseNumber(r['روز بیمه']) : undefined),
      dailyBaseSalary: r.dailyBaseSalary !== undefined && r.dailyBaseSalary !== '' ? parseNumber(r.dailyBaseSalary) : (r['حقوق پایه روزانه'] !== undefined ? parseNumber(r['حقوق پایه روزانه']) : undefined),
      dailyInsuranceSalary: r.dailyInsuranceSalary !== undefined && r.dailyInsuranceSalary !== '' ? parseNumber(r.dailyInsuranceSalary) : (r['حقوق روزانه بیمه'] !== undefined ? parseNumber(r['حقوق روزانه بیمه']) : undefined),
      workedHours: r.workedHours !== undefined && r.workedHours !== '' ? parseNumber(r.workedHours) : undefined,
      workedHoursHM: r.workedHoursHM ? String(r.workedHoursHM) : (r['ساعت کارکرد'] ? String(r['ساعت کارکرد']) : undefined),
      overtimeHours: r.overtimeHours !== undefined && r.overtimeHours !== '' ? parseNumber(r.overtimeHours) : undefined,
      overtimeHoursHM: r.overtimeHoursHM ? String(r.overtimeHoursHM) : (r['ساعت اضافه کار'] ? String(r['ساعت اضافه کار']) : undefined),
      overtimePay: r.overtimePay !== undefined && r.overtimePay !== '' ? parseNumber(r.overtimePay) : (r['مبلغ اضافه کار'] !== undefined ? parseNumber(r['مبلغ اضافه کار']) : undefined),
      overtimeHoursAmount: r.overtimeHoursAmount !== undefined && r.overtimeHoursAmount !== '' ? parseNumber(r.overtimeHoursAmount) : (r['مبلغ اضافه کار'] !== undefined ? parseNumber(r['مبلغ اضافه کار']) : (r.overtimePay !== undefined ? parseNumber(r.overtimePay) : undefined)),
      fridayWorkHours: r.fridayWorkHours !== undefined && r.fridayWorkHours !== '' ? parseNumber(r.fridayWorkHours) : undefined,
      fridayWorkHoursHM: r.fridayWorkHoursHM ? String(r.fridayWorkHoursHM) : (r['ساعت جمعه کاری'] ? String(r['ساعت جمعه کاری']) : undefined),
      fridayWorkPay: r.fridayWorkPay !== undefined && r.fridayWorkPay !== '' ? parseNumber(r.fridayWorkPay) : (r['مبلغ جمعه کاری'] !== undefined ? parseNumber(r['مبلغ جمعه کاری']) : undefined),
      holidayWorkHours: r.holidayWorkHours !== undefined && r.holidayWorkHours !== '' ? parseNumber(r.holidayWorkHours) : undefined,
      holidayWorkHoursHM: r.holidayWorkHoursHM ? String(r.holidayWorkHoursHM) : (r['ساعت تعطیل کاری'] ? String(r['ساعت تعطیل کاری']) : undefined),
      holidayWorkPay: r.holidayWorkPay !== undefined && r.holidayWorkPay !== '' ? parseNumber(r.holidayWorkPay) : (r['مبلغ تعطیل کاری'] !== undefined ? parseNumber(r['مبلغ تعطیل کاری']) : undefined),
      grossSalary: r.grossSalary !== undefined && r.grossSalary !== '' ? parseNumber(r.grossSalary) : (r['جمع حقوق ناخالص'] !== undefined ? parseNumber(r['جمع حقوق ناخالص']) : undefined),
      insuranceMonthlyBaseSalary: r.insuranceMonthlyBaseSalary !== undefined && r.insuranceMonthlyBaseSalary !== '' ? parseNumber(r.insuranceMonthlyBaseSalary) : (r['پایه بیمه ماهانه'] !== undefined ? parseNumber(r['پایه بیمه ماهانه']) : undefined),
      insuranceMonthlyBenefits: r.insuranceMonthlyBenefits !== undefined && r.insuranceMonthlyBenefits !== '' ? parseNumber(r.insuranceMonthlyBenefits) : (r['مزایای بیمه'] !== undefined ? parseNumber(r['مزایای بیمه']) : undefined),
      insurableBase: r.insurableBase !== undefined && r.insurableBase !== '' ? parseNumber(r.insurableBase) : (r['حقوق مشمول بیمه'] !== undefined ? parseNumber(r['حقوق مشمول بیمه']) : undefined),
      taxableBase: r.taxableBase !== undefined && r.taxableBase !== '' ? parseNumber(r.taxableBase) : (r['حقوق مشمول مالیات'] !== undefined ? parseNumber(r['حقوق مشمول مالیات']) : undefined),
      workerInsurance7: r.workerInsurance7 !== undefined && r.workerInsurance7 !== '' ? parseNumber(r.workerInsurance7) : (r['بیمه سهم کارگر ۷٪'] !== undefined ? parseNumber(r['بیمه سهم کارگر ۷٪']) : undefined),
      deductionsAmount: r.deductionsAmount !== undefined && r.deductionsAmount !== '' ? parseNumber(r.deductionsAmount) : (r['جمع کسورات'] !== undefined ? parseNumber(r['جمع کسورات']) : undefined),
      employerInsurance23: r.employerInsurance23 !== undefined && r.employerInsurance23 !== '' ? parseNumber(r.employerInsurance23) : (r['کل بیمه سهم کارفرما ۲۳٪'] !== undefined ? parseNumber(r['کل بیمه سهم کارفرما ۲۳٪']) : undefined),
      payableAmount: parseNumber(r.payableAmount !== undefined && r.payableAmount !== '' ? r.payableAmount : (r['خالص پرداختی نهایی'] !== undefined ? r['خالص پرداختی نهایی'] : 0)),
      employerPensionShare: r.employerPensionShare !== undefined && r.employerPensionShare !== '' ? parseNumber(r.employerPensionShare) : (r['بیمه سهم کارفرما ۲۰٪'] !== undefined ? parseNumber(r['بیمه سهم کارفرما ۲۰٪']) : undefined),
      employerUnemploymentShare: r.employerUnemploymentShare !== undefined && r.employerUnemploymentShare !== '' ? parseNumber(r.employerUnemploymentShare) : (r['بیمه بیکاری ۳٪'] !== undefined ? parseNumber(r['بیمه بیکاری ۳٪']) : undefined),
      totalInsurance30: r.totalInsurance30 !== undefined && r.totalInsurance30 !== '' ? parseNumber(r.totalInsurance30) : (r['کل حق بیمه ۳۰٪'] !== undefined ? parseNumber(r['کل حق بیمه ۳۰٪']) : undefined),
      payrollTax: r.payrollTax !== undefined && r.payrollTax !== '' ? parseNumber(r.payrollTax) : (r['مالیات حقوق'] !== undefined ? parseNumber(r['مالیات حقوق']) : undefined),
      supplementaryInsurance: r.supplementaryInsurance !== undefined && r.supplementaryInsurance !== '' ? parseNumber(r.supplementaryInsurance) : (r['بیمه تکمیلی'] !== undefined ? parseNumber(r['بیمه تکمیلی']) : undefined),
      delayFineDeduction: r.delayFineDeduction !== undefined && r.delayFineDeduction !== '' ? parseNumber(r.delayFineDeduction) : (r['کسر جریمه تاخیر'] !== undefined ? parseNumber(r['کسر جریمه تاخیر']) : undefined),
      normalManagementDeductionHours: r.normalManagementDeductionHours !== undefined && r.normalManagementDeductionHours !== '' ? parseNumber(r.normalManagementDeductionHours) : undefined,
      normalManagementDeductionMinutes: r.normalManagementDeductionMinutes !== undefined && r.normalManagementDeductionMinutes !== '' ? parseNumber(r.normalManagementDeductionMinutes) : undefined,
      normalManagementDeductionHM: r.normalManagementDeductionHM ? String(r.normalManagementDeductionHM) : (r['کسر مدیریتی ساعت عادی'] ? String(r['کسر مدیریتی ساعت عادی']) : undefined),
      managementOtDeductionHours: r.managementOtDeductionHours !== undefined && r.managementOtDeductionHours !== '' ? parseNumber(r.managementOtDeductionHours) : undefined,
      managementOtDeductionMinutes: r.managementOtDeductionMinutes !== undefined && r.managementOtDeductionMinutes !== '' ? parseNumber(r.managementOtDeductionMinutes) : undefined,
      managementOtDeductionHM: r.managementOtDeductionHM ? String(r.managementOtDeductionHM) : undefined,
      totalPayrollCost: r.totalPayrollCost !== undefined && r.totalPayrollCost !== '' ? parseNumber(r.totalPayrollCost) : (r['بهای تمام شده حقوق کارفرما'] !== undefined ? parseNumber(r['بهای تمام شده حقوق کارفرما']) : undefined),
    })).filter(x => x.employeeCode);
  }

  // 14. Personnel Allocations
  const allocRows = getSheetData("Personnel_Allocations");
  if (allocRows) {
    result.personnelAllocations = allocRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      employeeCode: String(r.employeeCode || ''),
      departmentCategoryId: String(r.departmentCategoryId || ''),
      salaryShare: r.salaryShare !== undefined ? parseNumber(r.salaryShare) : undefined,
    })).filter(x => x.id);
  }

  // 15. Period Overheads
  const overheadRows = getSheetData("Period_Overheads");
  if (overheadRows) {
    result.periodOverheads = overheadRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : undefined,
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : undefined,
      operational: parseNumber(r.operational),
      distributionSales: parseNumber(r.distributionSales),
      financial: parseNumber(r.financial),
      administrative: parseNumber(r.administrative),
      returnsOfExpense: parseNumber(r.returnsOfExpense),
      transferredAccountingCogs: r.transferredAccountingCogs !== undefined ? parseNumber(r.transferredAccountingCogs) : undefined,
    })).filter(x => x.id);
  }

  // 16. Procurement Orders
  const ordersRows = getSheetData("Procurement_Orders");
  if (ordersRows) {
    result.procurementOrders = ordersRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      title: r.title ? String(r.title) : undefined,
      requestedBy: r.requestedBy ? String(r.requestedBy) : undefined,
      supplierId: r.supplierId ? String(r.supplierId) : undefined,
      orderDate: String(r.orderDate || ''),
      expectedDeliveryDate: String(r.expectedDeliveryDate || ''),
      items: parseJSON(r.items, []),
      totalBill: parseNumber(r.totalBill),
      status: String(r.status || ''),
      notes: r.notes ? String(r.notes) : undefined,
      isActive:
        r.isActive === '' || r.isActive === undefined
          ? undefined
          : String(r.isActive).toLowerCase() === 'true' || r.isActive === true,
      deactivatedAt: r.deactivatedAt ? String(r.deactivatedAt) : undefined,
      deactivationReason:
        r.deactivationReason === 'new_order' || r.deactivationReason === 'deadline_passed'
          ? r.deactivationReason
          : undefined,
      createdAt: r.createdAt ? String(r.createdAt) : undefined,
      updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
    })).filter(x => x.id);
  }

  // 16b. Customer Production Orders
  const customerProdOrdersRows = getSheetData("Customer_Production_Orders");
  if (customerProdOrdersRows) {
    result.customerProductionOrders = customerProdOrdersRows.map(r => ({
      id: String(r.id || ''),
      orderNumber: String(r.orderNumber || ''),
      periodId: String(r.periodId || ''),
      customerId: r.customerId ? String(r.customerId) : undefined,
      customerName: String(r.customerName || ''),
      customerPhone: String(r.customerPhone || ''),
      customerCategoryId: r.customerCategoryId ? String(r.customerCategoryId) : undefined,
      customerCategoryName: r.customerCategoryName ? String(r.customerCategoryName) : undefined,
      orderDate: String(r.orderDate || ''),
      deliveryDate: String(r.deliveryDate || ''),
      deliveryTime: String(r.deliveryTime || '12:00'),
      deliveryType: (r.deliveryType === 'delivery' ? 'delivery' : 'pickup') as 'pickup' | 'delivery',
      deliveryAddress: r.deliveryAddress ? String(r.deliveryAddress) : undefined,
      recipientName: r.recipientName ? String(r.recipientName) : undefined,
      recipientPhone: r.recipientPhone ? String(r.recipientPhone) : undefined,
      deliveryFee: parseNumber(r.deliveryFee),
      items: parseJSON(r.items, []),
      totalAmount: parseNumber(r.totalAmount),
      prepaymentAmount: parseNumber(r.prepaymentAmount),
      remainingAmount: parseNumber(r.remainingAmount),
      prepaymentMethod: r.prepaymentMethod ? (String(r.prepaymentMethod) as any) : undefined,
      treasuryReceiptId: r.treasuryReceiptId ? String(r.treasuryReceiptId) : undefined,
      treasuryReceiptNo: r.treasuryReceiptNo ? String(r.treasuryReceiptNo) : undefined,
      status: (String(r.status || 'registered') as any),
      orderPurpose: r.orderPurpose ? String(r.orderPurpose) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
      registeredBy: r.registeredBy ? String(r.registeredBy) : undefined,
      createdAt: String(r.createdAt || new Date().toISOString()),
      updatedAt: String(r.updatedAt || new Date().toISOString()),
    })).filter(x => x.id);
  }

  const customerOrderPurposesRows = getSheetData("Customer_Order_Purposes");
  if (customerOrderPurposesRows && customerOrderPurposesRows.length > 0) {
    const parsedPurposes = customerOrderPurposesRows
      .map(r => String(r.title || '').trim())
      .filter(Boolean);
    if (parsedPurposes.length > 0) {
      result.customerOrderPurposes = parsedPurposes;
    }
  }

  // 16c. Digital Menu Configuration
  const digitalMenuRows = getSheetData("Digital_Menu_Config");
  if (digitalMenuRows && digitalMenuRows.length > 0 && digitalMenuRows[0].configJson) {
    const parsedMenu = parseJSON(digitalMenuRows[0].configJson, null);
    if (parsedMenu && typeof parsedMenu === 'object') {
      result.digitalMenu = parsedMenu;
    }
  }

  // 17. Stock Audits
  const auditsRows = getSheetData("Stock_Audits");
  if (auditsRows) {
    result.stockCountAudits = auditsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      title: String(r.title || ''),
      date: String(r.date || ''),
    })).filter(x => x.id);
  }

  // 18. Stock Counts
  const scRows = getSheetData("Stock_Counts");
  if (scRows) {
    result.stockCounts = scRows.map(r => ({
      id: String(r.id || ''),
      auditId: String(r.auditId || ''),
      periodId: String(r.periodId || ''),
      itemId: String(r.itemId || ''),
      fullPackages: parseNumber(r.fullPackages),
      looseQty: parseNumber(r.looseQty),
      totalCalculatedQty: parseNumber(r.totalCalculatedQty),
      value: parseNumber(r.value),
      warehouse: r.warehouse ? String(r.warehouse) : undefined,
      shelfLocation: r.shelfLocation ? String(r.shelfLocation) : undefined,
      countDate: r.countDate ? String(r.countDate) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
    })).filter(x => x.id);
  }

  // 19. Purchase Invoices
  const invoicesRows = getSheetData("Purchase_Invoices");
  if (invoicesRows) {
    result.purchaseInvoices = invoicesRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      supplierId: String(r.supplierId || ''),
      date: String(r.date || ''),
      items: parseJSON(r.items, []),
      invoiceNumber: String(r.invoiceNumber || ''),
    })).filter(x => x.id);
  }

  // 20. Daily Production Segments
  const timelineRows = getSheetData("Daily_Production_Segments");
  if (timelineRows) {
    result.dailyProductionSegments = timelineRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      productId: String(r.productId || ''),
      startTime: String(r.startTime || ''),
      endTime: String(r.endTime || ''),
      producedQty: parseNumber(r.producedQty),
    })).filter(x => x.id);
  }

  // 21. Users
  const usersRows = getSheetData("Users");
  if (usersRows) {
    result.users = usersRows.map(r => {
      const uname = String(r.username || '').trim();
      const existingMatch = (currentDb.users || []).find(u => u.username === uname);
      const rawPw = r.password !== undefined && r.password !== null ? String(r.password).trim() : '';
      return {
        id: String(r.id || ''),
        username: uname,
        fullName: String(r.fullName || ''),
        role: String(r.role || 'کاربر انبار').trim(),
        permissions: typeof r.permissions === 'string'
          ? r.permissions.split(';').filter((x: string) => x)
          : (Array.isArray(r.permissions) ? r.permissions : ['*']),
        password: rawPw !== '' ? rawPw : (existingMatch?.password || ''),
        is2FA: parseBoolean(r.is2FA),
        secretCode: String(r.secretCode || '123456'),
      };
    }).filter(x => x.id && x.username);
  }

  // 21b. User Roles
  const rolesRows = getSheetData("User_Roles");
  if (rolesRows) {
    result.roles = rolesRows.map(r => ({
      id: String(r.id || `role-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      name: String(r.name || '').trim(),
      description: String(r.description || ''),
      permissions: typeof r.permissions === 'string'
        ? r.permissions.split(';').map((x: string) => x.trim()).filter(Boolean)
        : (Array.isArray(r.permissions) ? r.permissions : []),
      isSystem: parseBoolean(r.isSystem) || String(r.name || '').trim() === 'مدیر ارشد',
    })).filter(x => x.name);
  }

  // 22. Shifts
  const shiftsRows = getSheetData("Shifts");
  if (shiftsRows) {
    result.shifts = shiftsRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      startTime: String(r.startTime || ''),
      endTime: String(r.endTime || ''),
    })).filter(x => x.id);
  }

  // 23. Shift Assignments
  const shiftAssignmentsRows = getSheetData("Shift_Assignments");
  if (shiftAssignmentsRows) {
    result.shiftAssignments = shiftAssignmentsRows.map(r => ({
      id: String(r.id || ''),
      dayName: String(r.dayName || r['نام روز'] || ''),
      shiftId: String(r.shiftId || r['شناسه شیفت'] || ''),
      deptId: String(r.deptId || r['شناسه بخش'] || ''),
      employeeCode: String(r.employeeCode || r['کد پرسنلی'] || ''),
      employeeId: r.employeeId ? String(r.employeeId) : (r['شناسه پرسنل'] ? String(r['شناسه پرسنل']) : undefined),
      date: r.date ? String(r.date) : (r['تاریخ'] ? String(r['تاریخ']) : undefined),
      isSubstitute: r.isSubstitute !== undefined ? parseBoolean(r.isSubstitute) : undefined,
      substitutedEmployeeCode: r.substitutedEmployeeCode ? String(r.substitutedEmployeeCode) : undefined,
      isOnLeave: r.isOnLeave !== undefined ? parseBoolean(r.isOnLeave) : undefined,
      periodId: r.periodId ? String(r.periodId) : undefined,
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : (r['سال'] !== undefined && r['سال'] !== '' ? parseNumber(r['سال']) : undefined),
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : (r['ماه'] !== undefined && r['ماه'] !== '' ? parseNumber(r['ماه']) : undefined),
      isSurplus: r.isSurplus !== undefined ? parseBoolean(r.isSurplus) : undefined,
    })).filter(x => x.id);
  }

  // 24. Production Sections
  const productionSectionsRows = getSheetData("Production_Sections");
  if (productionSectionsRows) {
    result.productionSections = productionSectionsRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      minStaff: parseNumber(r.minStaff) || 1,
      startTime: r.startTime ? String(r.startTime) : undefined,
      endTime: r.endTime ? String(r.endTime) : undefined,
      canBeEmpty: r.canBeEmpty !== undefined ? parseBoolean(r.canBeEmpty) : undefined,
      departmentCategoryId: r.departmentCategoryId ? String(r.departmentCategoryId) : undefined,
    })).filter(x => x.id);
  }

  // 25. Sales Transactions
  const salesTxRows = getSheetData("Sales_Transactions");
  if (salesTxRows) {
    result.salesTransactions = salesTxRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      invoiceNumber: r.invoiceNumber ? String(r.invoiceNumber) : undefined,
      customerName: r.customerName ? String(r.customerName) : undefined,
      customerCode: r.customerCode ? String(r.customerCode) : undefined,
      productCode: String(r.productCode || ''),
      dateStr: String(r.dateStr || ''),
      productName: String(r.productName || ''),
      categoryName: r.categoryName ? String(r.categoryName) : undefined,
      qtySold: parseNumber(r.qtySold),
      unitPrice: parseNumber(r.unitPrice),
      discount: parseNumber(r.discount),
      salesAmount: parseNumber(r.salesAmount),
      time: r.time ? String(r.time) : undefined,
      hour: parseNumber(r.hour),
      dayOfMonth: parseNumber(r.dayOfMonth),
      weekday: String(r.weekday || ''),
      productId: r.productId ? String(r.productId) : undefined,
      categoryId: r.categoryId ? String(r.categoryId) : undefined,
      month: r.month !== undefined && r.month !== '' ? parseNumber(r.month) : undefined,
      year: r.year !== undefined && r.year !== '' ? parseNumber(r.year) : undefined,
    })).filter(x => x.id);
  } else {
    result.salesTransactions = currentDb.salesTransactions || [];
  }

  // 26. Warehouses
  const warehousesRows = getSheetData("Warehouses");
  if (warehousesRows) {
    result.warehouses = warehousesRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      name: String(r.name || ''),
      code: r.code !== undefined ? String(r.code) : undefined,
      location: r.location !== undefined ? String(r.location) : undefined,
      isActive: r.isActive !== undefined ? parseBoolean(r.isActive) : undefined,
    })).filter(x => x.id);
  } else {
    result.warehouses = currentDb.warehouses || [];
  }

  // 27. Salary Base Rates
  const salaryBaseRatesRows = getSheetData("Salary_Base_Rates");
  if (salaryBaseRatesRows) {
    result.salaryBaseRates = salaryBaseRatesRows.map(r => {
      const dailyBase = parseNumber(r.dailyBaseSalary);
      const hourlyBase = parseNumber(r.hourlyBaseSalary) || (dailyBase > 0 ? Math.round(dailyBase / 7.333333) : 0);
      return {
        id: String(r.id || ''),
        periodId: String(r.periodId || ''),
        year: String(r.year || ''),
        dailyBaseSalary: dailyBase,
        hourlyBaseSalary: hourlyBase,
        dailyInsuranceSalary: parseNumber(r.dailyInsuranceSalary),
        housingAllowance: parseNumber(r.housingAllowance),
        foodAllowance: parseNumber(r.foodAllowance),
        childAllowance: parseNumber(r.childAllowance),
        baseYearsRate: parseNumber(r.baseYearsRate),
        marriageAllowance: parseNumber(r.marriageAllowance),
        taxableAmount: parseNumber(r.taxableAmount),
        overtimeHourlyRate: parseNumber(r.overtimeHourlyRate),
        fridayWorkHourlyRate: r.fridayWorkHourlyRate !== undefined ? parseNumber(r.fridayWorkHourlyRate) : Math.round((dailyBase * 0.40) / 7.33),
        holidayWorkHourlyRate: r.holidayWorkHourlyRate !== undefined ? parseNumber(r.holidayWorkHourlyRate) : 0,
        monthlyLeaveHours: r.monthlyLeaveHours ? String(r.monthlyLeaveHours).trim() : '15:53'
      };
    }).filter(x => x.id);
  } else {
    result.salaryBaseRates = currentDb.salaryBaseRates || [];
  }

  // 28. Personnel Contracts
  const personnelContractsRows = getSheetData("Personnel_Contracts");
  if (personnelContractsRows) {
    result.personnelContracts = personnelContractsRows.map(r => {
      let contractObj: any = undefined;
      if (r.contractDetailsJson) {
        try {
          contractObj = JSON.parse(r.contractDetailsJson);
        } catch {
          contractObj = undefined;
        }
      }
      const rawActive = r.isActive !== undefined ? r.isActive : r['وضعیت فعال'];
      const isActiveBool = rawActive !== undefined
        ? (rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === '1' || rawActive === 'بله')
        : true;

      return {
        id: String(r.id || ''),
        employeeCode: String(r.employeeCode || ''),
        periodId: String(r.periodId || ''),
        contractStartDate: String(r.contractStartDate || ''),
        contractEndDate: String(r.contractEndDate || ''),
        contractDurationMonths: parseNumber(r.contractDurationMonths),
        contractBaseSalary: parseNumber(r.contractBaseSalary),
        contractSeniorityBase: parseNumber(r.contractSeniorityBase),
        role: String(r.role || 'کارگر خط تولید'),
        notes: r.notes ? String(r.notes) : undefined,
        createdAt: r.createdAt ? String(r.createdAt) : undefined,
        fullName: r.fullName ? String(r.fullName) : undefined,
        nationalId: r.nationalId ? String(r.nationalId) : undefined,
        fatherName: r.fatherName ? String(r.fatherName) : undefined,
        birthDate: r.birthDate ? String(r.birthDate) : undefined,
        postalCode: r.postalCode ? String(r.postalCode) : undefined,
        address: r.address ? String(r.address) : undefined,
        mobile: r.mobile ? String(r.mobile) : undefined,
        insuranceCode: r.insuranceCode ? String(r.insuranceCode) : undefined,
        militaryStatus: r.militaryStatus ? String(r.militaryStatus) : undefined,
        promissoryNoteNumber: r.promissoryNoteNumber ? String(r.promissoryNoteNumber) : undefined,
        promissoryNoteAmount: r.promissoryNoteAmount !== undefined ? parseNumber(r.promissoryNoteAmount) : undefined,
        jobAllowance: r.jobAllowance !== undefined ? parseNumber(r.jobAllowance) : undefined,
        contractDailySalary: r.contractDailySalary !== undefined ? parseNumber(r.contractDailySalary) : undefined,
        contractDailyInsuranceSalary: r.contractDailyInsuranceSalary !== undefined ? parseNumber(r.contractDailyInsuranceSalary) : undefined,
        contractBaseInsuranceSalary: r.contractBaseInsuranceSalary !== undefined ? parseNumber(r.contractBaseInsuranceSalary) : undefined,
        contractDailyWageAmount: r.contractDailyWageAmount !== undefined ? parseNumber(r.contractDailyWageAmount) : undefined,
        calculatedWorkerPremium: r.calculatedWorkerPremium !== undefined ? parseNumber(r.calculatedWorkerPremium) : undefined,
        calculatedEmployerPremium20: r.calculatedEmployerPremium20 !== undefined ? parseNumber(r.calculatedEmployerPremium20) : undefined,
        calculatedUnemploymentPremium3: r.calculatedUnemploymentPremium3 !== undefined ? parseNumber(r.calculatedUnemploymentPremium3) : undefined,
        calculatedTotalEmployerPremium23: r.calculatedTotalEmployerPremium23 !== undefined ? parseNumber(r.calculatedTotalEmployerPremium23) : undefined,
        isActive: isActiveBool,
        contract: contractObj
      };
    }).filter(x => x.id);
  } else {
    result.personnelContracts = currentDb.personnelContracts || [];
  }

  // 31. Seniority Rate Rules
  const seniorityRateRulesRows = getSheetData("Seniority_Rate_Rules");
  if (seniorityRateRulesRows) {
    result.seniorityRateRules = seniorityRateRulesRows.map(r => ({
      id: String(r.id || ''),
      seniorityYears: parseNumber(r.seniorityYears),
      dailyRate: parseNumber(r.dailyRate),
      fiscalYear: String(r.fiscalYear || ''),
    })).filter(x => x.id);
  } else {
    result.seniorityRateRules = currentDb.seniorityRateRules || [];
  }

  // 32. Custom Banks
  const customBanksRows = getSheetData("Custom_Banks");
  if (customBanksRows) {
    result.customBanks = customBanksRows.map(r => String(r.bankName || '')).filter(x => x);
  } else {
    result.customBanks = currentDb.customBanks || [];
  }

  // 29. Insured Salary Items
  const insuredSalaryItemsRows = getSheetData("Insured_Salary_Items");
  if (insuredSalaryItemsRows) {
    result.insuredSalaryItems = insuredSalaryItemsRows.map(r => ({
      id: String(r.id || ''),
      periodId: r.periodId ? String(r.periodId) : undefined,
      itemKey: String(r.itemKey || ''),
      itemName: String(r.itemName || ''),
      startDate: r.startDate ? String(r.startDate) : undefined,
      endDate: r.endDate ? String(r.endDate) : undefined,
    })).filter(x => x.id);
  } else {
    result.insuredSalaryItems = currentDb.insuredSalaryItems || [];
  }

  // 29b. Leave Buyout Salary Items
  const leaveBuyoutSalaryItemsRows = getSheetData("Leave_Buyout_Salary_Items");
  if (leaveBuyoutSalaryItemsRows) {
    result.leaveBuyoutSalaryItems = leaveBuyoutSalaryItemsRows.map(r => ({
      id: String(r.id || ''),
      periodId: r.periodId ? String(r.periodId) : undefined,
      itemKey: String(r.itemKey || ''),
      itemName: String(r.itemName || ''),
      startDate: r.startDate ? String(r.startDate) : undefined,
      endDate: r.endDate ? String(r.endDate) : undefined,
    })).filter(x => x.id);
  } else {
    result.leaveBuyoutSalaryItems = currentDb.leaveBuyoutSalaryItems || [];
  }

  // 30. Personnel Categories
  const personnelCatRows = getSheetData("Personnel_Categories");
  if (personnelCatRows) {
    result.personnelCategories = personnelCatRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || '')
    })).filter(x => x.id);
  } else {
    result.personnelCategories = currentDb.personnelCategories || [];
  }

  // 33. Attendance Records
  const attendanceRecordsRows = getSheetData("Attendance_Records");
  if (attendanceRecordsRows) {
    result.attendanceRecords = attendanceRecordsRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      year: parseNumber(r.year),
      month: parseNumber(r.month),
      attendanceCode: String(r.attendanceCode || ''),
      employeeId: r.employeeId ? String(r.employeeId) : undefined,
      date: String(r.date || ''),
      shiftId: (r.shiftId || r['شناسه شیفت']) ? String(r.shiftId || r['شناسه شیفت']) : undefined,
      shiftName: (r.shiftName || r['شیفت'] || r['نام شیفت']) ? String(r.shiftName || r['شیفت'] || r['نام شیفت']) : undefined,
      times: parseJSON(r.times, []),
      statuses: parseJSON(r.statuses, []),
      errors: parseJSON(r.errors, []),
      isSystemCorrected: r.isSystemCorrected !== undefined ? parseBoolean(r.isSystemCorrected) : undefined,
      originalTimes: parseJSON(r.originalTimes, []),
      originalStatuses: parseJSON(r.originalStatuses, []),
      correctionReport: r.correctionReport ? parseJSON(r.correctionReport, null) : undefined,
    })).filter(x => x.id);
  } else {
    result.attendanceRecords = currentDb.attendanceRecords || [];
  }

  // 34. Monthly Workday Settings
  const monthlyWorkdaySettingsRows = getSheetData("Monthly_Workday_Settings");
  if (monthlyWorkdaySettingsRows) {
    result.monthlyWorkdaySettings = monthlyWorkdaySettingsRows.map(r => ({
      id: String(r.id || ''),
      year: parseNumber(r.year),
      month: parseNumber(r.month),
      daysInMonth: parseNumber(r.daysInMonth),
      fridaysCount: parseNumber(r.fridaysCount),
      nonFridayHolidays: parseNumber(r.nonFridayHolidays),
      workingDaysCount: parseNumber(r.workingDaysCount),
      requiredWorkHours: parseNumber(r.requiredWorkHours)
    })).filter(x => x.id);
  } else {
    result.monthlyWorkdaySettings = currentDb.monthlyWorkdaySettings || [];
  }

  // 35. Payroll Calculation Rules
  const payrollCalculationRulesRows = getSheetData("Payroll_Calculation_Rules");
  if (payrollCalculationRulesRows && payrollCalculationRulesRows.length > 0) {
    const row = payrollCalculationRulesRows[0];
    result.payrollCalculationRules = {
      calculateEarlyOvertime: parseBoolean(row.calculateEarlyOvertime),
      calculateLateOvertime: parseBoolean(row.calculateLateOvertime),
      calculateHolidayWork: parseBoolean(row.calculateHolidayWork),
      calculateFridayWork: parseBoolean(row.calculateFridayWork),
      calculateEntryDelayFine: parseBoolean(row.calculateEntryDelayFine),
      delayFineRate: parseNumber(row.delayFineRate) || 1.0,
      deductClothesChangingTime: parseBoolean(row.deductClothesChangingTime),
      clothesChangingDuration: parseNumber(row.clothesChangingDuration) || 0,
      deductDailyBreakTime: parseBoolean(row.deductDailyBreakTime),
      dailyBreakDurationMinutes: row.dailyBreakDurationMinutes !== undefined ? parseNumber(row.dailyBreakDurationMinutes) : 40,
      calculatePayrollTax: parseBoolean(row.calculatePayrollTax)
    };
  } else {
    result.payrollCalculationRules = currentDb.payrollCalculationRules || {
      calculateEarlyOvertime: true,
      calculateLateOvertime: true,
      calculateHolidayWork: true,
      calculateFridayWork: true,
      calculateEntryDelayFine: false,
      delayFineRate: 1.0,
      deductClothesChangingTime: false,
      clothesChangingDuration: 15,
      deductDailyBreakTime: false,
      dailyBreakDurationMinutes: 40,
      calculatePayrollTax: false
    };
  }

  // 36. Official Holidays
  const officialHolidaysRows = getSheetData("Official_Holidays");
  if (officialHolidaysRows) {
    result.officialHolidays = officialHolidaysRows.map(r => ({
      id: String(r.id || ''),
      year: parseNumber(r.year),
      date: String(r.date || '')
    })).filter(x => x.id);
  } else {
    result.officialHolidays = currentDb.officialHolidays || [];
  }

  // 36-b. Tax Exemptions (سقف‌های معافیت مالیاتی)
  const taxExemptionsRows = getSheetData("Tax_Exemptions");
  if (taxExemptionsRows) {
    result.taxExemptions = taxExemptionsRows.map(r => ({
      id: String(r.id || ''),
      fiscalYear: String(r.fiscalYear || ''),
      exemptionLimit: parseNumber(r.exemptionLimit)
    })).filter(x => x.id);
  } else {
    result.taxExemptions = currentDb.taxExemptions || [];
  }

  // 36-c. Tax Brackets (پله‌های مالیاتی)
  const taxBracketsRows = getSheetData("Tax_Brackets");
  if (taxBracketsRows) {
    result.taxBrackets = taxBracketsRows.map(r => ({
      id: String(r.id || ''),
      fiscalYear: String(r.fiscalYear || ''),
      fromAmount: parseNumber(r.fromAmount),
      toAmount: parseNumber(r.toAmount),
      taxRate: parseNumber(r.taxRate)
    })).filter(x => x.id);
  } else {
    result.taxBrackets = currentDb.taxBrackets || [];
  }

  // 36-d. Taxable Salary Items (اقلام مشمول مالیات حقوق)
  const taxableSalaryItemsRows = getSheetData("Taxable_Salary_Items");
  if (taxableSalaryItemsRows) {
    result.taxableSalaryItems = taxableSalaryItemsRows.map(r => ({
      id: String(r.id || ''),
      periodId: r.periodId ? String(r.periodId) : undefined,
      itemKey: String(r.itemKey || ''),
      itemName: String(r.itemName || ''),
      startDate: r.startDate ? String(r.startDate) : undefined,
      endDate: r.endDate ? String(r.endDate) : undefined,
    })).filter(x => x.id);
  } else {
    result.taxableSalaryItems = currentDb.taxableSalaryItems || [];
  }

  // 37. Contract Template Settings
  const contractTemplateRows = getSheetData("Contract_Template");
  if (contractTemplateRows && contractTemplateRows.length > 0) {
    result.contractTemplateText = String(contractTemplateRows[0].text || '');
    result.contractIntroText = String(contractTemplateRows[0].intro || '');
    result.contractEmployerText = String(contractTemplateRows[0].employer || '');
    result.contractLocationText = String(contractTemplateRows[0].location || '');
    result.contractHoursText = String(contractTemplateRows[0].hours || '');
    result.contractRestText = String(contractTemplateRows[0].rest || '');
    result.contractHolidayText = String(contractTemplateRows[0].holiday || '');
  } else {
    result.contractTemplateText = currentDb.contractTemplateText || '';
    result.contractIntroText = currentDb.contractIntroText || '';
    result.contractEmployerText = currentDb.contractEmployerText || '';
    result.contractLocationText = currentDb.contractLocationText || '';
    result.contractHoursText = currentDb.contractHoursText || '';
    result.contractRestText = currentDb.contractRestText || '';
    result.contractHolidayText = currentDb.contractHolidayText || '';
  }

  // 38. Personnel Capability Evaluation Matrix
  const capabilityMatrixRows = getSheetData("Capability_Matrix");
  if (capabilityMatrixRows && result.personnel && result.productionSections) {
    const updatedPersonnel = result.personnel.map(p => ({ ...p }));
    capabilityMatrixRows.forEach(row => {
      const empCode = row.employeeCode !== undefined ? String(row.employeeCode).trim() : '';
      if (!empCode) return;
      const emp = updatedPersonnel.find(p => String(p.employeeCode).trim() === empCode);
      if (!emp) return;

      const caps: string[] = [];
      const auxiliaryCaps: string[] = [];

      result.productionSections.forEach(sec => {
        const val = row[sec.name];
        if (val === 'اصلی' || val === 'Primary') {
          caps.push(sec.id);
        } else if (val === 'کمکی' || val === 'Auxiliary') {
          auxiliaryCaps.push(sec.id);
        }
      });

      // Merge: primary first, then auxiliary
      emp.capabilities = [...caps, ...auxiliaryCaps];
    });
    result.personnel = updatedPersonnel;
  }

  // 39. Shift Schemes
  const shiftSchemesRows = getSheetData("Shift_Schemes");
  if (shiftSchemesRows) {
    result.shiftSchemes = shiftSchemesRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      isActive: r.isActive !== undefined ? parseBoolean(r.isActive) : false,
      productionSections: parseJSON(r.productionSections, []),
      shiftAssignments: parseJSON(r.shiftAssignments, []),
      personnelCapabilities: parseJSON(r.personnelCapabilities, {})
    })).filter(x => x.id);
  } else {
    result.shiftSchemes = currentDb.shiftSchemes || [];
  }

  // 40. Dibal Scales Configuration
  const dibalScalesRows = getSheetData("Dibal_Scales");
  if (dibalScalesRows) {
    result.dibalScales = dibalScalesRows
      .filter(r => r && (r.id || r.name || r.ipAddress))
      .map(r => ({
        id: String(r.id || `scale-${Date.now()}`),
        name: String(r.name || 'ترازو دیبال M-525'),
        model: String(r.model || 'Dibal Tower M-525'),
        scaleId: parseNumber(r.scaleId) || 1,
        departmentId: parseNumber(r.departmentId) || 1,
        connectionType: (r.connectionType || 'ethernet') as any,
        ipAddress: String(r.ipAddress || '192.168.1.150'),
        subnetMask: String(r.subnetMask || '255.255.255.0'),
        gateway: String(r.gateway || '192.168.1.1'),
        txPort: parseNumber(r.txPort) || 3000,
        rxPort: parseNumber(r.rxPort) || 3001,
        comPort: r.comPort ? String(r.comPort) : undefined,
        baudRate: r.baudRate ? parseNumber(r.baudRate) : undefined,
        parity: r.parity ? String(r.parity) as any : undefined,
        stopBits: r.stopBits ? parseNumber(r.stopBits) : undefined,
        barcodePrefix: String(r.barcodePrefix || '21'),
        isOnline: parseBoolean(r.isOnline),
        lastSyncTime: r.lastSyncTime ? String(r.lastSyncTime) : undefined,
        autoSyncReceipts: parseBoolean(r.autoSyncReceipts)
      }));
  } else {
    result.dibalScales = currentDb.dibalScales || [];
  }

  // 41. Dibal PLUs Catalog
  const dibalPLUsRows = getSheetData("Dibal_PLUs");
  if (dibalPLUsRows) {
    result.dibalPLUs = dibalPLUsRows.map(r => ({
      id: String(r.id || `plu-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`),
      pluCode: parseNumber(r.pluCode) || 1,
      name: String(r.name || ''),
      secondName: r.secondName ? String(r.secondName) : undefined,
      pricePerKg: parseNumber(r.pricePerKg),
      itemType: (r.itemType === 'unit' ? 'unit' : 'weighted') as 'weighted' | 'unit',
      priceType: (r.priceType === 'fixed' ? 'fixed' : 'variable') as 'variable' | 'fixed',
      directKeyNumber: r.directKeyNumber ? parseNumber(r.directKeyNumber) : undefined,
      departmentCode: parseNumber(r.departmentCode) || 1,
      sectionCode: r.sectionCode ? parseNumber(r.sectionCode) : 1,
      tareWeight: parseNumber(r.tareWeight),
      expiryDays: parseNumber(r.expiryDays) || 10,
      packOffsetDays: parseNumber(r.packOffsetDays),
      vatRate: parseNumber(r.vatRate),
      promoPrice: parseNumber(r.promoPrice),
      ingredientsText: r.ingredientsText ? String(r.ingredientsText) : undefined,
      barcodeFormat: String(r.barcodeFormat || '21PPPWWWWWC'),
      barcodeType: (r.barcodeType || 'EAN-13') as any,
      productId: r.productId ? String(r.productId) : undefined,
      itemId: r.itemId ? String(r.itemId) : undefined,
      lastSentAt: r.lastSentAt ? String(r.lastSentAt) : undefined,
      status: (r.status || 'synced') as any,
    })).filter(x => x.name || x.pluCode);
  } else {
    result.dibalPLUs = currentDb.dibalPLUs || [];
  }

  // 42. Dibal Weighing Tickets
  const dibalTicketsRows = getSheetData("Dibal_Tickets");
  if (dibalTicketsRows) {
    result.dibalTickets = dibalTicketsRows
      .filter(r => r && (r.id || r.ticketNumber || r.pluCode))
      .map(r => ({
        id: String(r.id || `ticket-${Date.now()}`),
        scaleId: parseNumber(r.scaleId) || 1,
        ticketNumber: parseNumber(r.ticketNumber) || 1,
        date: String(r.date || new Date().toLocaleDateString('fa-IR')),
        time: String(r.time || new Date().toLocaleTimeString('fa-IR')),
        pluCode: parseNumber(r.pluCode) || 1,
        itemName: String(r.itemName || 'کالای ترازو'),
        itemType: r.itemType === 'unit' ? 'unit' : 'weighted',
        quantity: parseNumber(r.quantity) || 1,
        netWeightKg: parseNumber(r.netWeightKg),
        unitPrice: parseNumber(r.unitPrice),
        totalPrice: parseNumber(r.totalPrice),
        status: (r.status || 'raw') as any,
      }));
  } else {
    result.dibalTickets = currentDb.dibalTickets || [];
  }

  // 43. Customer Categories
  const cCatRows = getSheetData("Customer_Categories");
  if (cCatRows) {
    result.customerCategories = cCatRows.map(r => ({
      id: String(r.id || ''),
      periodId: r.periodId ? String(r.periodId) : undefined,
      name: String(r.name || ''),
      code: r.code ? String(r.code) : undefined,
      defaultDiscountPercent: parseNumber(r.defaultDiscountPercent),
      defaultPaymentTerm: r.defaultPaymentTerm ? String(r.defaultPaymentTerm) : undefined,
      description: r.description ? String(r.description) : undefined,
    })).filter(x => x.id);
  } else {
    result.customerCategories = currentDb.customerCategories || [];
  }

  // 44. Customers
  const customerRows = getSheetData("Customers");
  if (customerRows) {
    result.customers = customerRows.map(r => ({
      id: String(r.id || ''),
      periodId: String(r.periodId || ''),
      code: String(r.code || ''),
      accountingCode: r.accountingCode ? String(r.accountingCode) : undefined,
      name: String(r.name || ''),
      type: (r.type || 'حقیقی') as any,
      categoryId: r.categoryId ? String(r.categoryId) : undefined,
      contactPerson: r.contactPerson ? String(r.contactPerson) : undefined,
      nationalId: r.nationalId ? String(r.nationalId) : undefined,
      economicCode: r.economicCode ? String(r.economicCode) : undefined,
      registrationNo: r.registrationNo ? String(r.registrationNo) : undefined,
      phone: String(r.phone || ''),
      tel: r.tel ? String(r.tel) : undefined,
      fax: r.fax ? String(r.fax) : undefined,
      email: r.email ? String(r.email) : undefined,
      province: r.province ? String(r.province) : undefined,
      city: r.city ? String(r.city) : undefined,
      postalCode: r.postalCode ? String(r.postalCode) : undefined,
      address: String(r.address || ''),
      deliveryAddress: r.deliveryAddress ? String(r.deliveryAddress) : undefined,
      discountPercent: parseNumber(r.discountPercent),
      creditLimit: parseNumber(r.creditLimit),
      settlementPeriodDays: parseNumber(r.settlementPeriodDays),
      paymentTerms: (r.paymentTerms || 'نقدی') as any,
      salesAgent: r.salesAgent ? String(r.salesAgent) : undefined,
      bankAccounts: parseJSON(r.bankAccounts, []),
      isActive: parseBoolean(r.isActive),
      status: (r.status || 'active') as any,
      blockReason: r.blockReason ? String(r.blockReason) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
      preferredProductIds: typeof r.preferredProductIds === 'string'
        ? r.preferredProductIds.split(';').filter((x: string) => x)
        : (Array.isArray(r.preferredProductIds) ? r.preferredProductIds : []),
      createdAt: r.createdAt ? String(r.createdAt) : undefined
    })).filter(x => x.id);
  } else {
    result.customers = currentDb.customers || [];
  }

  // 44. Personnel Settlements (اسناد تسویه حساب پرسنل)
  const settlementRows = getSheetData("Personnel_Settlements");
  const settlementDetailsRows = getSheetData("Settlement_Monthly_Details");
  if (settlementRows) {
    result.personnelSettlements = settlementRows.map(r => {
      let parsedMonthly: SettlementMonthlyDetail[] = parseJSON(r.monthlyDetails, []);
      if ((!parsedMonthly || parsedMonthly.length === 0) && settlementDetailsRows) {
        parsedMonthly = settlementDetailsRows
          .filter((d: any) => String(d.settlementId) === String(r.id) || String(d.settlementNo) === String(r.settlementNo))
          .map((m: any, idx: number) => ({
            monthIndex: m.monthIndex !== undefined ? parseNumber(m.monthIndex) : (idx + 1),
            year: parseNumber(m.year),
            month: parseNumber(m.month),
            monthName: String(m.monthName || ''),
            totalDaysInMonth: parseNumber(m.totalDaysInMonth),
            workedDays: parseNumber(m.workedDays),
            overtimeHours: parseNumber(m.overtimeHours),
            holidayWorkHours: parseNumber(m.holidayWorkHours),
            fridayWorkHours: parseNumber(m.fridayWorkHours),
            usedLeaveDays: parseNumber(m.usedLeaveDays),
            dailyBaseSalary: parseNumber(m.dailyBaseSalary),
            baseSalary: parseNumber(m.baseSalary),
            foodAllowance: parseNumber(m.foodAllowance),
            housingAllowance: parseNumber(m.housingAllowance),
            childAllowance: parseNumber(m.childAllowance),
            marriageAllowance: parseNumber(m.marriageAllowance),
            overtimeAmount: parseNumber(m.overtimeAmount),
            holidayWorkAmount: parseNumber(m.holidayWorkAmount),
            fridayHourlyRate: m.fridayHourlyRate !== undefined ? parseNumber(m.fridayHourlyRate) : undefined,
            fridayWorkAmount: parseNumber(m.fridayWorkAmount),
            grossSalary: parseNumber(m.grossSalary),
            insurableGross: m.insurableGross !== undefined ? parseNumber(m.insurableGross) : undefined,
            workerInsuranceShare: parseNumber(m.workerInsuranceShare),
            netSalaryPayable: parseNumber(m.netSalaryPayable),
            syncedFromPayroll: m.syncedFromPayroll !== undefined ? Boolean(parseNumber(m.syncedFromPayroll) || m.syncedFromPayroll === true) : undefined,
            payrollSourceType: m.payrollSourceType ? String(m.payrollSourceType) as any : undefined,
            payrollItemPayable: m.payrollItemPayable !== undefined && m.payrollItemPayable !== '' ? parseNumber(m.payrollItemPayable) : undefined,
            payrollLeaveRemainingMinutes: m.payrollLeaveRemainingMinutes !== undefined && m.payrollLeaveRemainingMinutes !== '' ? parseNumber(m.payrollLeaveRemainingMinutes) : undefined
          }));
      }

      return {
        id: String(r.id || ''),
        periodId: String(r.periodId || ''),
        settlementNo: String(r.settlementNo || ''),
        employeeCode: String(r.employeeCode || ''),
        contractId: r.contractId ? String(r.contractId) : undefined,
        reason: (r.reason || 'contract_end') as SettlementReason,
        startDate: String(r.startDate || ''),
        endDate: String(r.endDate || ''),
        settlementDate: String(r.settlementDate || ''),
        totalPeriodDays: parseNumber(r.totalPeriodDays),
        totalWorkedDays: parseNumber(r.totalWorkedDays),
        monthlyDetails: Array.isArray(parsedMonthly) ? parsedMonthly : [],
        totalBaseSalaries: parseNumber(r.totalBaseSalaries),
        totalFoodAllowances: parseNumber(r.totalFoodAllowances),
        totalHousingAllowances: parseNumber(r.totalHousingAllowances),
        totalChildAllowances: parseNumber(r.totalChildAllowances),
        totalMarriageAllowances: parseNumber(r.totalMarriageAllowances),
        totalOvertimeAmounts: parseNumber(r.totalOvertimeAmounts),
        totalHolidayWorkAmounts: parseNumber(r.totalHolidayWorkAmounts),
        totalFridayWorkAmounts: parseNumber(r.totalFridayWorkAmounts),
        totalInsurableGross: r.totalInsurableGross !== undefined ? parseNumber(r.totalInsurableGross) : undefined,
        totalGrossSalaries: parseNumber(r.totalGrossSalaries),
        totalWorkerInsurance: parseNumber(r.totalWorkerInsurance),
        totalNetSalaries: parseNumber(r.totalNetSalaries),
        dailySalaryForCalculation: parseNumber(r.dailySalaryForCalculation),
        monthlyBaseSalaryForCalculation: parseNumber(r.monthlyBaseSalaryForCalculation),
        severanceDays: parseNumber(r.severanceDays),
        severanceAmount: parseNumber(r.severanceAmount),
        bonusDays: parseNumber(r.bonusDays),
        bonusAmount: parseNumber(r.bonusAmount),
        totalEntitledLeaveDays: parseNumber(r.totalEntitledLeaveDays),
        totalUsedLeaveDays: parseNumber(r.totalUsedLeaveDays),
        unusedLeaveDays: parseNumber(r.unusedLeaveDays),
        unusedLeaveAmount: parseNumber(r.unusedLeaveAmount),
        totalGrossPayable: parseNumber(r.totalGrossPayable),
        previousYearReceivableAmount: r.previousYearReceivableAmount !== undefined && r.previousYearReceivableAmount !== '' ? parseNumber(r.previousYearReceivableAmount) : 0,
        previousYearReceivableDescription: r.previousYearReceivableDescription ? String(r.previousYearReceivableDescription) : undefined,
        personnelPurchasesAmount: parseNumber(r.personnelPurchasesAmount),
        otherDeductionsAmount: parseNumber(r.otherDeductionsAmount),
        otherDeductionsDescription: r.otherDeductionsDescription ? String(r.otherDeductionsDescription) : undefined,
        totalDeductions: parseNumber(r.totalDeductions),
        employerPaidAmount: parseNumber(r.employerPaidAmount),
        finalNetPayable: parseNumber(r.finalNetPayable),
        status: (r.status || 'draft') as any,
        notes: r.notes ? String(r.notes) : undefined,
        payrollSyncedAt: r.payrollSyncedAt ? String(r.payrollSyncedAt) : undefined,
        registeredBy: r.registeredBy ? String(r.registeredBy) : undefined,
        createdAt: String(r.createdAt || ''),
        updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
      };
    }).filter(x => x.id);
  } else {
    result.personnelSettlements = currentDb.personnelSettlements || [];
  }

  // 56. Approved Shift Mismatches
  const approvedMismatchesRows = getSheetData("Approved_Shift_Mismatches", ["تایید مغایرت ها", "تاییدات مغایرت شیفت", "ApprovedMismatches"]);
  if (approvedMismatchesRows && approvedMismatchesRows.length > 0) {
    const keys = approvedMismatchesRows
      .map(r => String(r.mismatchKey || r['کلید مغایرت'] || r['شناسه مغایرت'] || (r.key && !String(r.key).startsWith('apm-') ? r.key : '')).trim())
      .filter(Boolean);
    result.approvedMismatches = Array.from(new Set([...(currentDb.approvedMismatches || []), ...keys]));
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('approved_mismatches', JSON.stringify(result.approvedMismatches));
      }
    } catch {}
  } else {
    result.approvedMismatches = currentDb.approvedMismatches || [];
  }

  // 57. Payroll Settings
  const payrollSettingsRows = getSheetData("Payroll_Settings");
  if (payrollSettingsRows && payrollSettingsRows.length > 0) {
    result.payrollSettings = payrollSettingsRows
      .map(r => r.payload ? parseJSON(r.payload, null) : r)
      .filter(Boolean);
  } else {
    result.payrollSettings = currentDb.payrollSettings || [];
  }

  // 58. Payroll Manual Overrides
  const payrollOverridesRows = getSheetData("Payroll_Manual_Overrides");
  if (payrollOverridesRows && payrollOverridesRows.length > 0) {
    const overridesObj: Record<string, { workDays?: Record<string, number>; insuranceDays?: Record<string, number>; normalMgmtDeductions?: Record<string, number> }> = {};
    payrollOverridesRows.forEach(r => {
      const key = String(r.overrideKey || '').trim();
      if (!key) return;
      overridesObj[key] = {
        workDays: parseJSON(r.workDaysJson, {}),
        insuranceDays: parseJSON(r.insuranceDaysJson, {}),
        normalMgmtDeductions: parseJSON(r.normalMgmtDeductionsJson, {})
      };
    });
    result.payrollManualOverrides = overridesObj;
  } else {
    result.payrollManualOverrides = currentDb.payrollManualOverrides || {};
  }

  // 59. Personnel Capabilities Map
  const personnelCapsRows = getSheetData("Personnel_Capabilities");
  if (personnelCapsRows && personnelCapsRows.length > 0) {
    const capsObj: Record<string, string[]> = {};
    personnelCapsRows.forEach(r => {
      const empCode = String(r.employeeCode || '').trim();
      if (!empCode) return;
      capsObj[empCode] = parseJSON(r.capabilitiesJson, []);
    });
    result.personnelCapabilities = capsObj;
  } else {
    result.personnelCapabilities = currentDb.personnelCapabilities || {};
  }

  // 60. Attendance Device Config
  const attDeviceRows = getSheetData("Attendance_Device_Config");
  if (attDeviceRows && attDeviceRows.length > 0) {
    const parsedDev = attDeviceRows[0].payload ? parseJSON(attDeviceRows[0].payload, null) : attDeviceRows[0];
    if (parsedDev) result.attendanceDeviceConfig = parsedDev;
  }

  // 61. SQL Server Config
  const sqlConfigRows = getSheetData("Sql_Server_Config");
  if (sqlConfigRows && sqlConfigRows.length > 0) {
    const parsedSql = sqlConfigRows[0].payload ? parseJSON(sqlConfigRows[0].payload, null) : sqlConfigRows[0];
    if (parsedSql) result.sqlServerConfig = parsedSql;
  }

  return result;
}

export function exportShiftsToExcel(
  db: AppDatabase,
  options?: { periodId?: string; year?: number; month?: number; fallbackYearMonth?: { year: number; month: number } }
) {
  const wb = XLSX.utils.book_new();

  const addSheet = (data: any[], sheetName: string) => {
    const safeData = safeExportData(data);
    const ws = XLSX.utils.json_to_sheet(safeData);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  // 1. Shifts
  const shiftsExport = (db.shifts || []).map(s => ({
    id: s.id,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime
  }));
  addSheet(shiftsExport, "Shifts");

  // 2. Shift Assignments (scoped to requested period + year + month when provided)
  const targetAssigns = (options?.periodId && options?.year && options?.month)
    ? (db.shiftAssignments || []).filter(a =>
        isShiftAssignmentInMonth(a, options.periodId!, options.year!, options.month!, options.fallbackYearMonth)
      )
    : (db.shiftAssignments || []);

  const shiftAssignmentsExport = targetAssigns.map(a => ({
    id: a.id,
    periodId: a.periodId || options?.periodId || '',
    year: a.year ?? options?.year ?? '',
    month: a.month ?? options?.month ?? '',
    employeeCode: a.employeeCode || '',
    employeeId: a.employeeId || '',
    date: a.date || '',
    dayName: a.dayName,
    shiftId: a.shiftId,
    deptId: a.deptId,
    isSubstitute: a.isSubstitute ?? false,
    substitutedEmployeeCode: a.substitutedEmployeeCode || '',
    isOnLeave: a.isOnLeave ?? false,
    isSurplus: a.isSurplus ?? false
  }));
  addSheet(shiftAssignmentsExport, "Shift_Assignments");

  // 3. Production Sections
  const productionSectionsExport = (db.productionSections || []).map(sec => ({
    id: sec.id,
    name: sec.name,
    minStaff: sec.minStaff,
    startTime: sec.startTime || '۰۶:۰۰',
    endTime: sec.endTime || '۱۴:۰۰',
    canBeEmpty: sec.canBeEmpty ?? false,
    departmentCategoryId: sec.departmentCategoryId || ''
  }));
  addSheet(productionSectionsExport, "Production_Sections");

  // 4. Personnel Capability Evaluation Matrix (filtered by active period and month-eligible personnel when provided)
  const scopedPersonnel = (db.personnel || []).filter(p => {
    if (options?.periodId && p.periodId !== options.periodId) return false;
    if (options?.year && options?.month) {
      return isEmployeeEligibleForMonth(p, options.year, options.month);
    }
    return true;
  });

  const capabilityMatrixExport = scopedPersonnel.map(p => {
    const row: any = {
      employeeCode: p.employeeCode,
      fullName: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || '',
    };
    (db.productionSections || []).forEach(sec => {
      const caps = p.capabilities || [];
      if (caps.includes(sec.id)) {
        row[sec.name] = caps[0] === sec.id ? "اصلی" : "کمکی";
      } else {
        row[sec.name] = "";
      }
    });
    return row;
  });
  addSheet(capabilityMatrixExport, "Capability_Matrix");

  // Generate Excel workbook as compressed binary
  const blob = writeWorkbookToBlob(wb);
  
  // Trigger download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = (options?.year && options?.month)
    ? `${options.year}_${String(options.month).padStart(2, '0')}`
    : new Date().toISOString().slice(0, 10);
  link.download = `Gatan_Monthly_Schedule_Backup_${suffix}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importShiftsFromExcel(
  fileBuffer: ArrayBuffer,
  currentDb: AppDatabase,
  options?: { periodId?: string; year?: number; month?: number; fallbackYearMonth?: { year: number; month: number } }
): AppDatabase {
  const wb = XLSX.read(fileBuffer, { type: 'array' });
  const result = { ...currentDb };

  const getSheetData = (sheetName: string): any[] | null => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    const rawData = XLSX.utils.sheet_to_json(ws);
    return safeImportData(rawData);
  };

  const parseBoolean = (val: any): boolean => {
    return val === true || val === 'true' || val === 1 || val === '1' || String(val).toLowerCase() === 'true';
  };

  const parseNumber = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    const num = Number(toEnglishDigits(String(val)));
    return isNaN(num) ? 0 : num;
  };

  // 1. Shifts
  const shiftsRows = getSheetData("Shifts");
  if (shiftsRows) {
    result.shifts = shiftsRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      startTime: String(r.startTime || ''),
      endTime: String(r.endTime || ''),
    })).filter(x => x.id);
  }

  // 2. Shift Assignments (preserve all other months & periods when scoped to a month)
  const shiftAssignmentsRows = getSheetData("Shift_Assignments");
  if (shiftAssignmentsRows) {
    const importedRows = shiftAssignmentsRows.map((r, idx) => ({
      id: String(r.id || `imp-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`),
      dayName: String(r.dayName || r['نام روز'] || ''),
      shiftId: String(r.shiftId || r['شناسه شیفت'] || ''),
      deptId: String(r.deptId || r['شناسه بخش'] || ''),
      employeeCode: String(r.employeeCode || r['کد پرسنلی'] || ''),
      employeeId: r.employeeId ? String(r.employeeId) : (r['شناسه پرسنل'] ? String(r['شناسه پرسنل']) : undefined),
      date: r.date ? String(r.date) : (r['تاریخ'] ? String(r['تاریخ']) : undefined),
      isSubstitute: r.isSubstitute !== undefined ? parseBoolean(r.isSubstitute) : undefined,
      substitutedEmployeeCode: r.substitutedEmployeeCode ? String(r.substitutedEmployeeCode) : undefined,
      isOnLeave: r.isOnLeave !== undefined ? parseBoolean(r.isOnLeave) : undefined,
      periodId: options?.periodId || (r.periodId ? String(r.periodId) : undefined),
      year: options?.year ?? (r.year !== undefined && r.year !== '' ? parseNumber(r.year) : undefined),
      month: options?.month ?? (r.month !== undefined && r.month !== '' ? parseNumber(r.month) : undefined),
      isSurplus: r.isSurplus !== undefined ? parseBoolean(r.isSurplus) : undefined,
    })).filter(x => x.employeeCode && x.shiftId && x.deptId);

    if (options?.periodId && options?.year && options?.month) {
      const eligibleEmpCodes = new Set(
        (currentDb.personnel || [])
          .filter(p => p.periodId === options.periodId && isEmployeeEligibleForMonth(p, options.year!, options.month!))
          .map(p => String(p.employeeCode || '').trim())
      );

      const scopedImported = importedRows
        .filter(a => eligibleEmpCodes.size === 0 || eligibleEmpCodes.has(String(a.employeeCode).trim()))
        .map(a => {
          const cleanSub = a.substitutedEmployeeCode && eligibleEmpCodes.has(String(a.substitutedEmployeeCode).trim())
            ? a.substitutedEmployeeCode
            : undefined;
          return {
            ...a,
            id: `imp-${options.year}-${options.month}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            periodId: options.periodId,
            year: options.year,
            month: options.month,
            substitutedEmployeeCode: cleanSub,
            isOnLeave: cleanSub ? a.isOnLeave : false
          };
        });

      const otherMonthAssigns = (currentDb.shiftAssignments || []).filter(
        a => !isShiftAssignmentInMonth(a, options.periodId!, options.year!, options.month!, options.fallbackYearMonth)
      );
      result.shiftAssignments = [...otherMonthAssigns, ...scopedImported];
    } else {
      result.shiftAssignments = importedRows;
    }
  }

  // 3. Production Sections
  const productionSectionsRows = getSheetData("Production_Sections");
  if (productionSectionsRows) {
    result.productionSections = productionSectionsRows.map(r => ({
      id: String(r.id || ''),
      name: String(r.name || ''),
      minStaff: parseNumber(r.minStaff) || 1,
      startTime: r.startTime ? String(r.startTime) : undefined,
      endTime: r.endTime ? String(r.endTime) : undefined,
      canBeEmpty: r.canBeEmpty !== undefined ? parseBoolean(r.canBeEmpty) : undefined,
      departmentCategoryId: r.departmentCategoryId ? String(r.departmentCategoryId) : undefined,
    })).filter(x => x.id);
  }

  // 4. Personnel Capability Evaluation Matrix
  const capabilityMatrixRows = getSheetData("Capability_Matrix");
  if (capabilityMatrixRows && result.personnel && result.productionSections) {
    const updatedPersonnel = result.personnel.map(emp => ({ ...emp }));
    capabilityMatrixRows.forEach(row => {
      const empCode = row.employeeCode !== undefined ? String(row.employeeCode).trim() : '';
      if (!empCode) return;
      const emp = updatedPersonnel.find(p =>
        String(p.employeeCode).trim() === empCode && (!options?.periodId || p.periodId === options.periodId)
      ) || updatedPersonnel.find(p => String(p.employeeCode).trim() === empCode);
      if (!emp) return;

      const caps: string[] = [];
      const auxiliaryCaps: string[] = [];

      result.productionSections!.forEach(sec => {
        const val = row[sec.name];
        if (val === 'اصلی' || val === 'Primary') {
          caps.push(sec.id);
        } else if (val === 'کمکی' || val === 'Auxiliary') {
          auxiliaryCaps.push(sec.id);
        }
      });

      // Merge: primary first, then auxiliary
      emp.capabilities = [...caps, ...auxiliaryCaps];
    });
    result.personnel = updatedPersonnel;
  }

  return result;
}

export function exportCapabilityMatrixToExcel(db: AppDatabase) {
  const wb = XLSX.utils.book_new();

  const capabilityMatrixExport = (db.personnel || []).map(p => {
    const row: any = {
      employeeCode: p.employeeCode,
      fullName: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || '',
    };
    (db.productionSections || []).forEach(sec => {
      const caps = p.capabilities || [];
      if (caps.includes(sec.id)) {
        row[sec.name] = caps[0] === sec.id ? "اصلی" : "کمکی";
      } else {
        row[sec.name] = "";
      }
    });
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(capabilityMatrixExport);
  XLSX.utils.book_append_sheet(wb, ws, "Capability_Matrix");

  // Generate Excel workbook as compressed binary
  const blob = writeWorkbookToBlob(wb);
  
  // Trigger download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Personnel_Capability_Matrix_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importCapabilityMatrixFromExcel(fileBuffer: ArrayBuffer, currentDb: AppDatabase): AppDatabase {
  const wb = XLSX.read(fileBuffer, { type: 'array' });
  const result = { ...currentDb };
  
  const ws = wb.Sheets["Capability_Matrix"] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("شیت مورد نظر یافت نشد.");

  const rows = XLSX.utils.sheet_to_json(ws) as any[];
  if (rows && result.personnel && result.productionSections) {
    // Clone personnel list to avoid direct mutation
    result.personnel = result.personnel.map(p => {
      const row = rows.find(r => {
        const rowCode = r.employeeCode !== undefined ? String(r.employeeCode).trim() : '';
        return rowCode === String(p.employeeCode).trim();
      });
      if (!row) return p;

      const caps: string[] = [];
      const auxiliaryCaps: string[] = [];

      result.productionSections.forEach(sec => {
        const val = row[sec.name];
        if (val === 'اصلی' || val === 'Primary') {
          caps.push(sec.id);
        } else if (val === 'کمکی' || val === 'Auxiliary') {
          auxiliaryCaps.push(sec.id);
        }
      });

      return {
        ...p,
        capabilities: [...caps, ...auxiliaryCaps]
      };
    });
  }

  return result;
}

export function exportDibalDataToExcel(db: AppDatabase) {
  const wb = XLSX.utils.book_new();

  const addSheet = (data: any[], sheetName: string) => {
    const safeData = safeExportData(data);
    const ws = XLSX.utils.json_to_sheet(safeData);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  // 1. Dibal Scales Configuration
  const dibalScalesExport = (db.dibalScales || []).map(s => ({
    id: s.id,
    name: s.name,
    model: s.model,
    scaleId: s.scaleId,
    departmentId: s.departmentId,
    connectionType: s.connectionType,
    ipAddress: s.ipAddress,
    subnetMask: s.subnetMask,
    gateway: s.gateway,
    txPort: s.txPort,
    rxPort: s.rxPort,
    comPort: s.comPort || '',
    baudRate: s.baudRate || 9600,
    parity: s.parity || 'none',
    stopBits: s.stopBits || 1,
    barcodePrefix: s.barcodePrefix,
    isOnline: s.isOnline,
    lastSyncTime: s.lastSyncTime || '',
    autoSyncReceipts: s.autoSyncReceipts || false
  }));
  addSheet(dibalScalesExport, "Dibal_Scales");

  // 2. Dibal PLUs Catalog
  const dibalPLUsExport = (db.dibalPLUs || []).map(p => ({
    id: p.id,
    pluCode: p.pluCode,
    name: p.name,
    secondName: p.secondName || '',
    pricePerKg: p.pricePerKg,
    itemType: p.itemType || 'weighted',
    priceType: p.priceType || 'variable',
    directKeyNumber: p.directKeyNumber || '',
    departmentCode: p.departmentCode,
    sectionCode: p.sectionCode || 1,
    tareWeight: p.tareWeight || 0,
    expiryDays: p.expiryDays || 10,
    packOffsetDays: p.packOffsetDays || 0,
    vatRate: p.vatRate || 0,
    promoPrice: p.promoPrice || 0,
    ingredientsText: p.ingredientsText || '',
    barcodeFormat: p.barcodeFormat || '21PPPWWWWWC',
    barcodeType: p.barcodeType || 'EAN-13',
    productId: p.productId || '',
    itemId: p.itemId || '',
    lastSentAt: p.lastSentAt || '',
    status: p.status || 'synced'
  }));
  addSheet(dibalPLUsExport, "Dibal_PLUs");

  // 3. Dibal Weighing Tickets
  const dibalTicketsExport = (db.dibalTickets || []).map(t => ({
    id: t.id,
    scaleId: t.scaleId,
    ticketNumber: t.ticketNumber,
    date: t.date,
    time: t.time,
    pluCode: t.pluCode,
    itemName: t.itemName,
    itemType: t.itemType || 'weighted',
    quantity: t.quantity || 1,
    netWeightKg: t.netWeightKg,
    unitPrice: t.unitPrice,
    totalPrice: t.totalPrice,
    status: t.status
  }));
  addSheet(dibalTicketsExport, "Dibal_Tickets");

  const blob = writeWorkbookToBlob(wb);
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Gatan_Dibal_Scale_Management_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importDibalDataFromExcel(fileBuffer: ArrayBuffer, currentDb: AppDatabase): AppDatabase {
  const wb = XLSX.read(fileBuffer, { type: 'array' });
  const result = { ...currentDb };

  const getSheetData = (sheetName: string): any[] | null => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    const rawData = XLSX.utils.sheet_to_json(ws);
    return safeImportData(rawData);
  };

  const parseBoolean = (val: any): boolean => {
    return val === true || val === 'true' || val === 1 || val === '1' || String(val).toLowerCase() === 'true';
  };

  const parseNumber = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  };

  // 1. Dibal Scales Configuration
  const dibalScalesRows = getSheetData("Dibal_Scales") || getSheetData(wb.SheetNames[0]);
  if (dibalScalesRows && wb.Sheets["Dibal_Scales"]) {
    result.dibalScales = dibalScalesRows.map(r => ({
      id: String(r.id || `scale-${Date.now()}`),
      name: String(r.name || 'ترازو دیبال M-525'),
      model: String(r.model || 'Dibal Tower M-525'),
      scaleId: parseNumber(r.scaleId) || 1,
      departmentId: parseNumber(r.departmentId) || 1,
      connectionType: (r.connectionType || 'ethernet') as any,
      ipAddress: String(r.ipAddress || '192.168.1.150'),
      subnetMask: String(r.subnetMask || '255.255.255.0'),
      gateway: String(r.gateway || '192.168.1.1'),
      txPort: parseNumber(r.txPort) || 3000,
      rxPort: parseNumber(r.rxPort) || 3001,
      comPort: r.comPort ? String(r.comPort) : undefined,
      baudRate: r.baudRate ? parseNumber(r.baudRate) : undefined,
      parity: r.parity ? String(r.parity) as any : undefined,
      stopBits: r.stopBits ? parseNumber(r.stopBits) : undefined,
      barcodePrefix: String(r.barcodePrefix || '21'),
      isOnline: parseBoolean(r.isOnline),
      lastSyncTime: r.lastSyncTime ? String(r.lastSyncTime) : undefined,
      autoSyncReceipts: parseBoolean(r.autoSyncReceipts)
    }));
  }

  // 2. Dibal PLUs Catalog
  const dibalPLUsRows = getSheetData("Dibal_PLUs") || (wb.Sheets["Dibal_Scales"] ? null : getSheetData(wb.SheetNames[0]));
  if (dibalPLUsRows) {
    result.dibalPLUs = dibalPLUsRows.map(r => ({
      id: String(r.id || `plu-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`),
      pluCode: parseNumber(r.pluCode) || 1,
      name: String(r.name || ''),
      secondName: r.secondName ? String(r.secondName) : undefined,
      pricePerKg: parseNumber(r.pricePerKg),
      itemType: (r.itemType === 'unit' ? 'unit' : 'weighted') as 'weighted' | 'unit',
      priceType: (r.priceType === 'fixed' ? 'fixed' : 'variable') as 'variable' | 'fixed',
      directKeyNumber: r.directKeyNumber ? parseNumber(r.directKeyNumber) : undefined,
      departmentCode: parseNumber(r.departmentCode) || 1,
      sectionCode: r.sectionCode ? parseNumber(r.sectionCode) : 1,
      tareWeight: parseNumber(r.tareWeight),
      expiryDays: parseNumber(r.expiryDays) || 10,
      packOffsetDays: parseNumber(r.packOffsetDays),
      vatRate: parseNumber(r.vatRate),
      promoPrice: parseNumber(r.promoPrice),
      ingredientsText: r.ingredientsText ? String(r.ingredientsText) : undefined,
      barcodeFormat: String(r.barcodeFormat || '21PPPWWWWWC'),
      barcodeType: (r.barcodeType || 'EAN-13') as any,
      productId: r.productId ? String(r.productId) : undefined,
      itemId: r.itemId ? String(r.itemId) : undefined,
      lastSentAt: r.lastSentAt ? String(r.lastSentAt) : undefined,
      status: (r.status || 'synced') as any,
    })).filter(x => x.name || x.pluCode);
  }

  // 3. Dibal Weighing Tickets
  const dibalTicketsRows = getSheetData("Dibal_Tickets");
  if (dibalTicketsRows) {
    result.dibalTickets = dibalTicketsRows.map(r => ({
      id: String(r.id || `ticket-${Date.now()}`),
      scaleId: parseNumber(r.scaleId) || 1,
      ticketNumber: parseNumber(r.ticketNumber) || 1,
      date: String(r.date || new Date().toLocaleDateString('fa-IR')),
      time: String(r.time || new Date().toLocaleTimeString('fa-IR')),
      pluCode: parseNumber(r.pluCode) || 1,
      itemName: String(r.itemName || 'کالای ترازو'),
      itemType: r.itemType === 'unit' ? 'unit' : 'weighted',
      quantity: parseNumber(r.quantity) || 1,
      netWeightKg: parseNumber(r.netWeightKg),
      unitPrice: parseNumber(r.unitPrice),
      totalPrice: parseNumber(r.totalPrice),
      status: (r.status || 'raw') as any,
    }));
  }

  return result;
}

export function exportMonthlySalaryCalculationsToExcel(
  year: number,
  month: number,
  rows: any[]
) {
  const wb = XLSX.utils.book_new();
  const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const monthName = monthNames[month - 1] || `ماه ${month}`;
  
  const excelData = (rows || []).map((r, idx) => ({
    'ردیف': idx + 1,
    'کد پرسنل': r.employee?.employeeCode || '',
    'کد حسابداری': r.employee?.accountingCode || r.employee?.employeeCode || '',
    'کد ملی': r.employee?.nationalId || '',
    'شماره بیمه': r.employee?.insuranceCode || '',
    'نام': r.employee?.firstName || '',
    'نام خانوادگی': r.employee?.lastName || '',
    'سمت / شغل': r.employee?.role || '',
    'ساعت کارکرد': r.finalWorkedHM || '۰:۰۰',
    'ساعت اضافه کار': r.finalOtRoundedHours !== undefined ? r.finalOtRoundedHours : Math.round((r.finalOtMinutes || 0) / 60),
    'ساعت جمعه کاری': r.finalFridayRoundedHours !== undefined ? r.finalFridayRoundedHours : Math.round((r.finalFridayMinutes || 0) / 60),
    'ساعت تعطیل کاری': r.finalHolidayRoundedHours !== undefined ? r.finalHolidayRoundedHours : Math.round((r.finalHolidayMinutes || 0) / 60),
    'روز کارکرد سیستم': r.daysWorkedCount ?? 0,
    'روز کارکرد کاربر': r.userWorkDaysCount ?? r.daysWorkedCount ?? 0,
    'روز کارکرد بیمه': r.userInsuranceDaysCount ?? r.daysWorkedCount ?? 0,
    'حقوق پایه روزانه': r.contractDailyBaseSalary ?? 0,
    'حقوق پایه روزانه بیمه': r.contractDailyInsuranceSalary ?? 0,
    'حقوق پایه ماهانه': r.monthlyBaseSalaryCalculated ?? 0,
    'حق بن': r.computedFoodAllowance ?? 0,
    'حق مسکن': r.computedHousingAllowance ?? 0,
    'حق اولاد': r.childAllowance ?? 0,
    'حق تاهل ماهانه': r.marriageAllowance ?? 0,
    'پایه سنوات ماهانه': r.computedSeniorityBase ?? 0,
    'فوق العاده شغلی': r.computedJobAllowance ?? 0,
    'عیدی و پاداش ماهانه': r.monthlyEidi ?? 0,
    'حق سنوات ماهانه': r.monthlyYearsBenefit ?? 0,
    'جمع حقوق ناخالص': r.grossBaseSalaryCalculated ?? 0,
    'مبلغ اضافه کار': r.overtimePay ?? 0,
    'مبلغ جمعه کاری': r.fridayWorkPay ?? 0,
    'مبلغ تعطیل کاری': r.totalHolidayWorkPay ?? 0,
    'جمع حقوق و اضافات': r.totalGrossWithAdditions ?? 0,
    'حقوق مشمول بیمه': r.computedInsBaseUser ?? 0,
    'حق بیمه سهم کارفرما ۲۰٪': r.calEmployerInsurance20 ?? 0,
    'حق بیمه بیکاری ۳٪': r.calUnemploymentInsurance3 ?? 0,
    'کل بیمه سهم کارفرما ۲۳٪': (r.calEmployerInsurance20 || 0) + (r.calUnemploymentInsurance3 || 0),
    'حق بیمه سهم کارگر ۷٪': r.calWorkerInsurance7 ?? 0,
    'جمع کل بیمه ۳۰٪': r.totalInsurance30 ?? 0,
    'حقوق مشمول مالیات': r.computedTaxBaseUser ?? 0,
    'مالیات حقوق': r.calculatedTaxUser ?? 0,
    'بیمه تکمیلی': r.calSupplementaryPremium ?? 0,
    'جریمه تاخیر': r.delayFineDeduction ?? 0,
    'جمع کسورات': r.totalDeductionsUser ?? 0,
    'خالص پرداختی نهایی': r.netPayableUser ?? 0,
    'بهای تمام شده حقوق کارفرما': (r.netPayableUser || 0) + (r.calEmployerInsurance20 || 0) + (r.calUnemploymentInsurance3 || 0)
  }));

  const safeData = safeExportData(excelData);
  const ws = XLSX.utils.json_to_sheet(safeData);
  XLSX.utils.book_append_sheet(wb, ws, `محاسبات حقوق ${monthName}`);

  const blob = writeWorkbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Gatan_Salary_Calculations_${monthName}_${year}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportAttendanceWorksheetToExcel(
  year: number,
  month: number,
  rows: any[]
) {
  const wb = XLSX.utils.book_new();
  const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const monthName = monthNames[month - 1] || `ماه ${month}`;

  const excelData = (rows || []).map((r, idx) => ({
    'ردیف': idx + 1,
    'نام و نام خانوادگی': `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim(),
    'کد ملی': r.employee?.nationalId || '',
    'کد حسابداری / پرسنلی': r.employee?.employeeCode || '',
    'مدت عادی': r.normalPlusExtraHM || '۰:۰۰',
    'کسر مدیریتی ساعت عادی': r.normalMgmtDeductionHM || '۰:۰۰',
    'وضعیت تردد': r.hasIncorrectAttendance ? 'خطادار / نامشخص' : 'صحیح',
    'جریمه تاخیر ورود روز عادی': r.totalDelayFineHM || '۰:۰۰',
    'جریمه تاخیر ورود جمعه کاری': r.totalFridayDelayFineHM || '۰:۰۰',
    'جریمه تاخیر ورود تعطیل کاری': r.totalHolidayDelayFineHM || '۰:۰۰',
    'تعویض لباس روز عادی': r.clothesChangingHM || '۰:۰۰',
    'تعویض لباس جمعه کاری': r.fridayClothesChangingHM || '۰:۰۰',
    'تعویض لباس تعطیل کاری': r.holidayClothesChangingHM || '۰:۰۰',
    'ساعت اضافه کاری': r.mandatoryOtHM || '۰:۰۰',
    'ساعت تعطیل کاری': r.netHolidayHM || '۰:۰۰',
    'ساعت جمعه کاری': r.netFridayHM || '۰:۰۰',
    'خالص کارکرد': r.netWorkHM || '۰:۰۰',
    'موظفی ماه': r.requiredHM || '۰:۰۰',
    'اضافه موظفی': r.extraRequiredHM || '۰:۰۰',
    'روزهای کارکرد سیستم': r.daysWorkedCount ?? 0,
    'روزهای کارکرد تایید شده': r.userWorkDaysCount ?? r.daysWorkedCount ?? 0,
    'روزهای کارکرد بیمه': r.userInsuranceDaysCount ?? r.daysWorkedCount ?? 0,
    'ساعت کارکرد نهایی': r.finalWorkedHM || '۰:۰۰',
    'ساعت اضافه کار نهایی': r.finalOtHM || '۰:۰۰',
    'ساعت جمعه کاری نهایی': r.finalFridayHM || '۰:۰۰',
    'ساعت تعطیل کاری نهایی': r.finalHolidayHM || '۰:۰۰'
  }));

  const safeData = safeExportData(excelData);
  const ws = XLSX.utils.json_to_sheet(safeData);
  XLSX.utils.book_append_sheet(wb, ws, `کارنامه تردد ${monthName}`);

  const blob = writeWorkbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Gatan_Attendance_Worksheet_${monthName}_${year}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportPersonnelContractsToExcel(
  contracts: any[],
  filterTitle: string = ''
) {
  const wb = XLSX.utils.book_new();

  const excelData = (contracts || []).map((c, idx) => {
    const isAct = c.isActive !== undefined ? Boolean(c.isActive) : true;
    const contractObj = c.contract || {};

    return {
      'ردیف': idx + 1,
      'وضعیت قرارداد': isAct ? 'فعال' : 'غیرفعال',
      'کد پرسنلی': c.employeeCode || '',
      'نام و نام خانوادگی': c.fullName || '',
      'کد ملی': c.nationalId || '',
      'شماره بیمه': c.insuranceCode || '',
      'سمت سازمانی / شغل': c.role || '',
      'تاریخ شروع قرارداد': c.contractStartDate || '',
      'تاریخ پایان قرارداد': c.contractEndDate || '',
      'مدت قرارداد (ماه)': c.contractDurationMonths ?? '',
      'حقوق پایه روزانه': c.contractDailySalary || 0,
      'حقوق پایه روزانه بیمه': c.contractDailyInsuranceSalary || 0,
      'حقوق پایه ماهانه': c.contractBaseSalary || 0,
      'حقوق پایه ماهانه بیمه': c.contractBaseInsuranceSalary || 0,
      'حق مسکن ماهانه': contractObj.calculatedHousingAllowance ?? (c.jobAllowance ? 0 : 0),
      'حق بن کارگری': contractObj.calculatedFoodAllowance ?? 0,
      'حق اولاد ماهانه': contractObj.calculatedChildAllowance ?? 0,
      'حق تاهل ماهانه': contractObj.calculatedMarriageAllowance ?? 0,
      'پایه سنوات ماهانه': c.contractSeniorityBase || contractObj.calculatedSeniorityAllowance || 0,
      'فوق العاده شغلی': c.jobAllowance || 0,
      'عیدی ماهانه': contractObj.calculatedMonthlyEidi ?? 0,
      'حق سنوات خدمت ماهانه': contractObj.calculatedMonthlyYears ?? 0,
      'سهم بیمه کارگر ۷٪': c.calculatedWorkerPremium || 0,
      'سهم بیمه کارفرما ۲۰٪': c.calculatedEmployerPremium20 || 0,
      'بیمه بیکاری ۳٪': c.calculatedUnemploymentPremium3 || 0,
      'کل بیمه سهم کارفرما ۲۳٪': c.calculatedTotalEmployerPremium23 || ((c.calculatedEmployerPremium20 || 0) + (c.calculatedUnemploymentPremium3 || 0)),
      'مبلغ سفته ضمانت': c.promissoryNoteAmount || 0,
      'شماره سفته': c.promissoryNoteNumber || '',
      'شماره همراه': c.mobile || '',
      'آدرس محل سکونت': c.address || '',
      'کد پستی': c.postalCode || '',
      'تاریخ ثبت': c.createdAt ? c.createdAt.slice(0, 10) : '',
      'توضیحات': c.notes || ''
    };
  });

  const safeData = safeExportData(excelData);
  const ws = XLSX.utils.json_to_sheet(safeData);
  XLSX.utils.book_append_sheet(wb, ws, 'قراردادهای پرسنل');

  const blob = writeWorkbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = filterTitle ? `_${filterTitle}` : '';
  link.download = `Gatan_Personnel_Contracts${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportSalaryBaseRatesToExcel(rates: any[]) {
  const wb = XLSX.utils.book_new();

  const excelData = (rates || []).map((r, idx) => ({
    'ردیف': idx + 1,
    'سال مالی': r.year || '',
    'حقوق پایه روزانه': r.dailyBaseSalary || 0,
    'پایه حقوق ساعتی': r.hourlyBaseSalary || (r.dailyBaseSalary ? Math.round(r.dailyBaseSalary / 7.333333) : 0),
    'حقوق پایه روزانه بیمه': r.dailyInsuranceSalary || 0,
    'حق مسکن ماهانه': r.housingAllowance || 0,
    'حق بن کارگری': r.foodAllowance || 0,
    'حق اولاد ماهانه': r.childAllowance || 0,
    'پایه سنوات روزانه': r.baseYearsRate || 0,
    'حق تاهل ماهانه': r.marriageAllowance || 0,
    'سقف معافیت مالیاتی': r.taxableAmount || 0,
    'حق اضافه کاری ساعتی': (r.overtimeHourlyRate && r.overtimeHourlyRate > ((r.dailyBaseSalary || 0) * 0.8))
      ? Math.round(r.overtimeHourlyRate / 7.33)
      : (r.overtimeHourlyRate || Math.round(((r.dailyBaseSalary || 0) * 1.4) / 7.33)),
    'حق جمعه کاری ساعتی': (r.fridayWorkHourlyRate && r.fridayWorkHourlyRate > ((r.dailyBaseSalary || 0) * 0.15))
      ? Math.round(r.fridayWorkHourlyRate / 7.33)
      : (r.fridayWorkHourlyRate ?? Math.round(((r.dailyBaseSalary || 0) * 0.40) / 7.33)),
    'حق تعطیل کاری ساعتی': r.holidayWorkHourlyRate ?? 0,
    'مرخصی ساعتی ماهانه': r.monthlyLeaveHours || '15:53'
  }));

  const safeData = safeExportData(excelData);
  const ws = XLSX.utils.json_to_sheet(safeData);
  XLSX.utils.book_append_sheet(wb, ws, 'ثوابت و قوانین دستمزد');

  const blob = writeWorkbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Gatan_Salary_Base_Rates_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCogsFormulasToExcel(db: AppDatabase, activePeriodId: string) {
  const wb = XLSX.utils.book_new();
  const formulas = (db.productFormulas || []).filter(f => !f.periodId || f.periodId === activePeriodId);
  const products = db.products || [];
  const items = db.items || [];
  const periodProducts = products.filter(p => !p.periodId || p.periodId === activePeriodId);
  const periodItems = items.filter(i => !i.periodId || i.periodId === activePeriodId);

  const rows: any[] = [];
  let rowIdx = 1;

  formulas.forEach(f => {
    const prod = periodProducts.find(p => doesFormulaMatchProduct(f.productId, p))
      || products.find(p => doesFormulaMatchProduct(f.productId, p));
    const prodAccountCode = prod?.accountId || f.productId || '';
    const prodCode = prod?.code || '';
    const prodName = prod?.name || 'محصول نامشخص';
    const formulaName = f.name || 'فرمول استاندارد';
    const statusStr = f.isActive !== false ? 'فعال' : 'غیرفعال';

    if (!f.ingredients || f.ingredients.length === 0) {
      rows.push({
        'ردیف': rowIdx++,
        'شناسه فرمول': f.id,
        'کد حسابداری محصول': prodAccountCode,
        'کد محصول': prodCode,
        'نام محصول': prodName,
        'نام فرمول': formulaName,
        'وضعیت': statusStr,
        'کد معین ماده اولیه': '',
        'کد ماده اولیه': '',
        'نام ماده اولیه': '',
        'مقدار مصرف': 0,
        'واحد مصرف': ''
      });
    } else {
      f.ingredients.forEach(ing => {
        const itemObj = periodItems.find(i => doesIngredientMatchMaterial(ing.rawMaterialId, i))
          || items.find(i => doesIngredientMatchMaterial(ing.rawMaterialId, i));
        const wipObj = !itemObj
          ? (periodProducts.find(p => p.isWip && doesIngredientMatchMaterial(ing.rawMaterialId, p))
            || products.find(p => p.isWip && doesIngredientMatchMaterial(ing.rawMaterialId, p)))
          : undefined;
        const matObj = itemObj || wipObj;
        rows.push({
          'ردیف': rowIdx++,
          'شناسه فرمول': f.id,
          'کد حسابداری محصول': prodAccountCode,
          'کد محصول': prodCode,
          'نام محصول': prodName,
          'نام فرمول': formulaName,
          'وضعیت': statusStr,
          'کد معین ماده اولیه': matObj?.accountId || ing.rawMaterialId || '',
          'کد ماده اولیه': matObj?.code || ing.rawMaterialId || '',
          'نام ماده اولیه': matObj?.name || 'ماده اولیه نامشخص',
          'مقدار مصرف': ing.quantity || 0,
          'واحد مصرف': matObj?.unit || 'کیلویی'
        });
      });
    }
  });

  const safeData = safeExportData(rows.length > 0 ? rows : [{
    'ردیف': 1,
    'شناسه فرمول': '',
    'کد حسابداری محصول': '',
    'کد محصول': '',
    'نام محصول': '',
    'نام فرمول': '',
    'وضعیت': 'فعال',
    'کد معین ماده اولیه': '',
    'کد ماده اولیه': '',
    'نام ماده اولیه': '',
    'مقدار مصرف': 0,
    'واحد مصرف': ''
  }]);

  const ws = XLSX.utils.json_to_sheet(safeData);
  XLSX.utils.book_append_sheet(wb, ws, 'فرمول‌های ساخت کالا (BOM)');

  const blob = writeWorkbookToBlob(wb);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Product_Formulas_BOM_${activePeriodId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importCogsFormulasFromExcel(fileBuffer: ArrayBuffer, currentDb: AppDatabase, activePeriodId: string): AppDatabase {
  const wb = XLSX.read(fileBuffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return currentDb;

  const sheet = wb.Sheets[sheetName];
  const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);
  if (!rawRows || rawRows.length === 0) return currentDb;

  const products = currentDb.products || [];
  const items = currentDb.items || [];
  const periodProducts = products.filter(p => !p.periodId || p.periodId === activePeriodId);
  const periodItems = items.filter(i => !i.periodId || i.periodId === activePeriodId);
  const searchProducts = periodProducts.length > 0 ? [...periodProducts, ...products] : products;
  const searchItems = periodItems.length > 0 ? [...periodItems, ...items] : items;
  const searchWips = searchProducts.filter(p => p.isWip);

  const existingFormulas = [...(currentDb.productFormulas || [])];

  const formulaGroupMap = new Map<string, {
    id: string;
    periodId: string;
    productId: string;
    name: string;
    isActive: boolean;
    ingredients: { rawMaterialId: string; quantity: number }[];
  }>();

  rawRows.forEach((r, idx) => {
    const rawFormulaId = String(r['شناسه فرمول'] || r['formulaId'] || r['id'] || '').trim();
    const rawProductAccCode = normalizeAccountingCode(r['کد حسابداری محصول'] || r['productAccountId'] || r['accountId'] || '');
    const rawProductCode = normalizeAccountingCode(r['کد محصول'] || r['productCode'] || '');
    const rawProductName = String(r['نام محصول'] || r['productName'] || '').trim();
    const rawFormulaName = String(r['نام فرمول'] || r['formulaName'] || 'فرمول استاندارد').trim();
    const statusVal = String(r['وضعیت'] || r['status'] || 'فعال').trim();
    const isActive = !(statusVal === 'غیرفعال' || statusVal === 'false' || statusVal === '0');

    const rawMatAccCode = normalizeAccountingCode(r['کد معین ماده اولیه'] || r['rawMaterialAccountId'] || r['materialAccountId'] || '');
    const rawMatCode = normalizeAccountingCode(r['کد ماده اولیه'] || r['rawMaterialCode'] || r['itemCode'] || '');
    const rawMatName = String(r['نام ماده اولیه'] || r['rawMaterialName'] || r['itemName'] || '').trim();
    const qty = parseFloat(toEnglishDigits(String(r['مقدار مصرف'] || r['quantity'] || '0'))) || 0;

    let targetProduct = rawProductAccCode
      ? searchProducts.find(p => p.accountId && normalizeAccountingCode(p.accountId) === rawProductAccCode)
      : undefined;
    if (!targetProduct && rawProductCode) {
      targetProduct = searchProducts.find(p =>
        (p.accountId && normalizeAccountingCode(p.accountId) === rawProductCode) ||
        (p.code && normalizeAccountingCode(p.code) === rawProductCode)
      );
    }
    if (!targetProduct && rawProductName) {
      targetProduct = searchProducts.find(p => matchPersianString(p.name, rawProductName));
    }

    const formulaProductKey = targetProduct
      ? getProductFormulaKey(targetProduct)
      : (rawProductAccCode || rawProductCode);
    if (!formulaProductKey) return;

    let targetMat: { id?: string; accountId?: string } | undefined = rawMatAccCode
      ? (searchItems.find(i => i.accountId && normalizeAccountingCode(i.accountId) === rawMatAccCode)
        || searchWips.find(w => w.accountId && normalizeAccountingCode(w.accountId) === rawMatAccCode))
      : undefined;
    if (!targetMat && rawMatCode) {
      targetMat = searchItems.find(i =>
          (i.accountId && normalizeAccountingCode(i.accountId) === rawMatCode) ||
          (i.code && normalizeAccountingCode(i.code) === rawMatCode)
        )
        || searchWips.find(w =>
          (w.accountId && normalizeAccountingCode(w.accountId) === rawMatCode) ||
          (w.code && normalizeAccountingCode(w.code) === rawMatCode)
        );
    }
    if (!targetMat && rawMatName) {
      targetMat = searchItems.find(i => matchPersianString(i.name, rawMatName))
        || searchWips.find(w => matchPersianString(w.name, rawMatName));
    }

    const formulaMatKey = targetMat
      ? getMaterialFormulaKey(targetMat)
      : (rawMatAccCode || rawMatCode);

    const groupKey = rawFormulaId || `${formulaProductKey}-${rawFormulaName}`;

    let formulaObj = formulaGroupMap.get(groupKey);
    if (!formulaObj) {
      formulaObj = {
        id: rawFormulaId || `pf-${Date.now()}-${Math.random().toString(36).substr(2, 4)}-${idx}`,
        periodId: activePeriodId,
        productId: formulaProductKey,
        name: rawFormulaName,
        isActive,
        ingredients: []
      };
      formulaGroupMap.set(groupKey, formulaObj);
    }

    if (formulaMatKey && qty > 0) {
      const existingIngIdx = formulaObj.ingredients.findIndex(
        x => normalizeAccountingCode(x.rawMaterialId) === normalizeAccountingCode(formulaMatKey)
      );
      if (existingIngIdx >= 0) {
        formulaObj.ingredients[existingIngIdx] = { rawMaterialId: formulaMatKey, quantity: qty };
      } else {
        formulaObj.ingredients.push({
          rawMaterialId: formulaMatKey,
          quantity: qty
        });
      }
    }
  });

  const importedFormulasList = Array.from(formulaGroupMap.values());
  if (importedFormulasList.length === 0) return currentDb;

  const finalFormulas = [...existingFormulas];

  importedFormulasList.forEach(imp => {
    const existingIdx = finalFormulas.findIndex(f =>
      f.id === imp.id ||
      (f.periodId === activePeriodId &&
        normalizeAccountingCode(f.productId) === normalizeAccountingCode(imp.productId) &&
        f.name === imp.name)
    );
    if (existingIdx >= 0) {
      finalFormulas[existingIdx] = imp;
    } else {
      finalFormulas.push(imp);
    }
  });

  return {
    ...currentDb,
    productFormulas: finalFormulas
  };
}



