/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { 
  AppDatabase, Personnel, PersonnelContract, SalaryBaseRate,
  PersonnelSettlement, SettlementMonthlyDetail, SettlementReason, SettlementType
} from '../../types';
import { 
  toPersianDigits, toEnglishDigits, formatWithCommas, parseNumber, 
  downloadCSV, printElement, matchPersianString, getTodayJalali, 
  numberToWordsPersian, isValidJalaliDate, normalizeJalaliDate,
  parseEffectiveDepartureLastWorkYM, getFiscalYearFromPeriod
} from '../../utils/persianUtils';
import { nextSimpleId, getPrefixForCollection } from '../../utils/simpleId';
import { 
  Calculator, FileText, Printer, Download, Plus, Search, Trash2, 
  Edit3, CheckCircle2, AlertCircle, Calendar, DollarSign, Users, 
  Briefcase, ShieldAlert, CreditCard, ArrowRight, ChevronDown, ChevronUp, 
  Sparkles, Clock, Receipt, X, FileCheck, HelpCircle, Layers, Check, RotateCcw,
  Eye, Copy, ZoomIn, ZoomOut, Maximize2, Building2, ShieldCheck
} from 'lucide-react';
import { getInsuredSalaryItemsForContract, getTaxableSalaryItemsForContract, getSalaryBaseRateForContract } from '../PayrollManagement';
import {
  addDaysToJalali,
  computeMonthlyPayrollSnapshotForEmployee,
  DEFAULT_LEAVE_BUYOUT_ITEM_KEYS,
  findFirstAttendanceDateForCode,
  findLastAttendanceDateForEmployee,
  getEmployeeRegisteredPayrollsSummary,
  getEmployeeTreasuryPaidInPeriod,
  getLeaveBuyoutSalaryItemsForContract,
  getMonthlyLeaveMinutesForYearMonth,
  getPriorWithoutDepartureSettlements,
  getSettlementReasonLabel,
  isPayrollMonthLocked,
  mapPersianReasonToSettlementReason,
  ProvisionalSettlementPreview
} from '../../utils/payrollSettlementSync';

interface PersonnelSettlementTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  initialEmployeeCode?: string;
  initialContext?: { year: number; month: number; readOnly?: boolean } | null;
  unlockedMonthsMap?: Record<string, boolean>;
  provisionalSettlementPreview?: ProvisionalSettlementPreview | null;
  onSettlementTypeChange?: (settlementType: SettlementType) => void;
  onSettlementCloseOrCancel?: () => void;
  onClearInitialEmployee?: () => void;
}

const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const CURRENT_YEAR_CONTRACT_ID = '__CURRENT_YEAR__';

function getShamsiMonthDays(year: number, month: number): number {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  // Year 1403 is leap (کبیسه), etc.
  const isLeap = (year === 1403 || year === 1399 || year === 1407);
  return isLeap ? 30 : 29;
}

function parseJalali(dateStr: string): { y: number; m: number; d: number } | null {
  if (!dateStr) return null;
  const clean = toEnglishDigits(dateStr).trim().replace(/[-\s]/g, '/');
  const parts = clean.split('/');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return { y, m, d };
    }
  }
  return null;
}

interface DepartureMonthUnpaidLeaveInfo {
  year: number;
  month: number;
  monthName: string;
  calendarDaysToDeparture: number;
  workedDays: number;
  unpaidDays: number;
}

/**
 * کسر عیدی و سنوات ماهانه (پایان خدمت) از ناخالص و خالص ماهانه در جدول مرحله ۲ تسویه حساب
 * تا از محاسبه مضاعف با بخش مزایای پایان خدمت در مرحله ۳ جلوگیری شود.
 */
function normalizeMonthlyDetailForSettlement(m: SettlementMonthlyDetail): SettlementMonthlyDetail {
  const eidiAndYears = (m.monthlyEidi || 0) + (m.monthlyYearsBenefit || 0);
  if (eidiAndYears === 0) return m;
  const nextGross = Math.max(0, (m.grossSalary || 0) - eidiAndYears);
  const nextNet = Math.max(0, (m.netSalaryPayable || 0) - eidiAndYears);
  const nextPayrollItemPayable =
    m.payrollItemPayable !== undefined ? Math.max(0, m.payrollItemPayable - eidiAndYears) : undefined;
  return {
    ...m,
    monthlyEidi: 0,
    monthlyYearsBenefit: 0,
    grossSalary: nextGross,
    netSalaryPayable: nextNet,
    ...(nextPayrollItemPayable !== undefined ? { payrollItemPayable: nextPayrollItemPayable } : {})
  };
}

function normalizeSettlementForDisplay(s: PersonnelSettlement): PersonnelSettlement {
  const details = s.monthlyDetails || [];
  const needsNormalization = details.some(
    m => (m.monthlyEidi || 0) > 0 || (m.monthlyYearsBenefit || 0) > 0
  );
  if (!needsNormalization) return s;

  const normalizedDetails = details.map(normalizeMonthlyDetailForSettlement);
  let totalGrossSalaries = 0;
  let totalNetSalaries = 0;
  normalizedDetails.forEach(m => {
    if (m.alreadySettledInPrior) return;
    totalGrossSalaries += m.grossSalary || 0;
    totalNetSalaries += m.netSalaryPayable || 0;
  });
  const totalGrossPayable =
    totalNetSalaries +
    (s.severanceAmount || 0) +
    (s.bonusAmount || 0) +
    (s.unusedLeaveAmount || 0) +
    (s.previousYearReceivableAmount || 0);
  const finalNetPayable = Math.max(
    0,
    totalGrossPayable - (s.totalDeductions || 0) - (s.employerPaidAmount || 0)
  );
  return {
    ...s,
    monthlyDetails: normalizedDetails,
    totalGrossSalaries,
    totalNetSalaries,
    totalGrossPayable,
    finalNetPayable
  };
}

function getDepartureMonthUnpaidLeaveInfo(
  settlementType: SettlementType | undefined,
  startDateStr: string | undefined,
  endDateStr: string | undefined,
  monthlyDetails: SettlementMonthlyDetail[] | undefined
): DepartureMonthUnpaidLeaveInfo | null {
  if ((settlementType || 'with_departure') !== 'with_departure') return null;
  const normEnd = endDateStr
    ? normalizeJalaliDate(toEnglishDigits(endDateStr)) || toEnglishDigits(endDateStr)
    : '';
  if (!normEnd) return null;
  const normStart = startDateStr
    ? normalizeJalaliDate(toEnglishDigits(startDateStr)) || toEnglishDigits(startDateStr)
    : '';

  // تاریخ ترک کار یک روز پس از آخرین تردد است؛ برای شمارش روزهای کارکرد ماه ترک کار یک روز به عقب برمی‌گردیم
  const effectiveWorkEndStr =
    normStart && normEnd > normStart ? addDaysToJalali(normEnd, -1) : normEnd;
  const effEnd = parseJalali(effectiveWorkEndStr);
  if (!effEnd) return null;

  const startParsed = normStart ? parseJalali(normStart) : null;
  const startDayInMonth =
    startParsed && startParsed.y === effEnd.y && startParsed.m === effEnd.m ? startParsed.d : 1;
  const calendarDaysToDeparture = Math.max(0, effEnd.d - startDayInMonth + 1);
  if (calendarDaysToDeparture <= 0) return null;

  const list = monthlyDetails || [];
  const monthRow =
    list.find(m => m.year === effEnd.y && m.month === effEnd.m) || list[list.length - 1];
  if (!monthRow || monthRow.alreadySettledInPrior) return null;

  const workedDays = Number(monthRow.workedDays || 0);
  const unpaidDays = Math.round((calendarDaysToDeparture - workedDays) * 100) / 100;
  if (unpaidDays <= 0) return null;

  return {
    year: effEnd.y,
    month: effEnd.m,
    monthName:
      monthRow.monthName || `${JALALI_MONTH_NAMES[effEnd.m - 1]} ${toPersianDigits(effEnd.y)}`,
    calendarDaysToDeparture,
    workedDays,
    unpaidDays
  };
}

function getMonthlyUsedLeaveMinutes(m: SettlementMonthlyDetail): number {
  if (m.usedLeaveMinutes !== undefined && m.usedLeaveMinutes !== null) {
    return Math.max(0, Math.round(Number(m.usedLeaveMinutes) || 0));
  }
  if (m.usedLeaveHours !== undefined && m.usedLeaveHours !== null) {
    return Math.max(0, Math.round((Number(m.usedLeaveHours) || 0) * 60));
  }
  return Math.max(0, Math.round((Number(m.usedLeaveDays) || 0) * 8 * 60));
}

function getMonthlyUsedLeaveHours(m: SettlementMonthlyDetail): number {
  return Math.round((getMonthlyUsedLeaveMinutes(m) / 60) * 100) / 100;
}

function formatMinutesToPersianHM(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${toPersianDigits(h)}:${toPersianDigits(String(m).padStart(2, '0'))}`;
}

function formatMinutesToEnglishHM(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function parseLeaveHMToMinutes(raw: string): number | null {
  const cleaned = toEnglishDigits(raw || '').trim();
  if (!cleaned) return null;
  if (cleaned.includes(':')) {
    const [hPart, mPart = '0'] = cleaned.split(':');
    const h = Math.max(0, parseInt(hPart || '0', 10) || 0);
    const m = Math.max(0, parseInt(mPart || '0', 10) || 0);
    return h * 60 + m;
  }
  if (cleaned.includes('.') || cleaned.includes('٫')) {
    const dec = parseFloat(cleaned.replace(/٫/g, '.'));
    return Number.isFinite(dec) ? Math.max(0, Math.round(dec * 60)) : 0;
  }
  const hOnly = parseInt(cleaned, 10);
  return Number.isFinite(hOnly) ? Math.max(0, hOnly * 60) : 0;
}

function getSettlementUnusedLeaveHours(
  s: Pick<PersonnelSettlement, 'unusedLeaveHours' | 'unusedLeaveDays'>
): number {
  if (s.unusedLeaveHours !== undefined && s.unusedLeaveHours !== null) {
    return Math.max(0, Math.round(Number(s.unusedLeaveHours) * 10000) / 10000);
  }
  return Math.max(0, Math.round(((Number(s.unusedLeaveDays) || 0) * 8) * 10000) / 10000);
}

function formatHoursAsPersianHM(hours: number): string {
  return formatMinutesToPersianHM(Math.round((Number(hours) || 0) * 60));
}

function formatPersianHoursValue(hours: number): string {
  const rounded = Math.round((Number(hours) || 0) * 100) / 100;
  return toPersianDigits(String(rounded).replace('.', '٫'));
}

export default function PersonnelSettlementTab({
  db,
  onUpdateDb,
  activePeriodId,
  initialEmployeeCode,
  initialContext,
  unlockedMonthsMap,
  provisionalSettlementPreview,
  onSettlementTypeChange,
  onSettlementCloseOrCancel,
  onClearInitialEmployee
}: PersonnelSettlementTabProps) {
  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState<'all' | SettlementReason>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'finalized' | 'paid'>('all');

  // Modal / Form state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forceReadOnlyView, setForceReadOnlyView] = useState(false);
  const [lastDetectedAttendanceDate, setLastDetectedAttendanceDate] = useState<string>('');

  // Print modal state
  const [printingSettlement, setPrintingSettlement] = useState<PersonnelSettlement | null>(null);

  const currentYear = useMemo(() => {
    const pidMatch = toEnglishDigits(String(activePeriodId || '')).match(/^(\d{4})/);
    if (pidMatch) return parseInt(pidMatch[1], 10);
    const today = parseJalali(getTodayJalali());
    if (today?.y) return today.y;
    return 1404;
  }, [activePeriodId]);

  // Form Fields
  const [formEmployeeCode, setFormEmployeeCode] = useState('');
  const [formContractId, setFormContractId] = useState(CURRENT_YEAR_CONTRACT_ID);
  const [formSettlementType, setFormSettlementType] = useState<SettlementType>('with_departure');
  const [formReason, setFormReason] = useState<SettlementReason>('contract_end');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formSettlementDate, setFormSettlementDate] = useState(getTodayJalali());
  
  // Custom monthly details list
  const [formMonthlyDetails, setFormMonthlyDetails] = useState<SettlementMonthlyDetail[]>([]);
  
  // Deductions & Employer Payments
  const [formPurchasesAmount, setFormPurchasesAmount] = useState<string>('۰');
  const [formOtherDeductionsAmount, setFormOtherDeductionsAmount] = useState<string>('۰');
  const [formOtherDeductionsDescription, setFormOtherDeductionsDescription] = useState<string>('');
  const [formEmployerPaidAmount, setFormEmployerPaidAmount] = useState<string>('۰');
  
  // Previous year receivable (طلب حساب از قبل پرسنل)
  const [formPreviousYearReceivableAmount, setFormPreviousYearReceivableAmount] = useState<string>('۰');
  const [formPreviousYearReceivableDescription, setFormPreviousYearReceivableDescription] = useState<string>('');
  const [formPayrollSyncedAt, setFormPayrollSyncedAt] = useState<string>('');

  // Manual overrides for end-of-service calculated amounts (سنوات، عیدی، مانده مرخصی)
  const [formDailySalaryOverride, setFormDailySalaryOverride] = useState<string>('');
  const [formSeveranceAmount, setFormSeveranceAmount] = useState<string>('');
  const [formBonusAmount, setFormBonusAmount] = useState<string>('');
  const [formUnusedLeaveHours, setFormUnusedLeaveHours] = useState<string>('');
  const [formUnusedLeaveAmount, setFormUnusedLeaveAmount] = useState<string>('');

  const [formStatus, setFormStatus] = useState<'draft' | 'finalized' | 'paid'>('finalized');
  const [formNotes, setFormNotes] = useState('');

  // Quick accordion expanded state
  const [expandedMonthlyDetails, setExpandedMonthlyDetails] = useState(true);

  // Professional Preview & Print state controls
  const [previewZoom, setPreviewZoom] = useState<number>(100);
  const [previewMode, setPreviewMode] = useState<'full' | 'summary'>('full');
  const [copiedSummary, setCopiedSummary] = useState(false);

  // All personnel & contracts
  const personnelList = useMemo(() => {
    return (db.personnel || []).filter(p => p.periodId === activePeriodId);
  }, [db.personnel, activePeriodId]);

  const allContracts = useMemo(() => {
    return (db.personnelContracts || []).filter(c => c.periodId === activePeriodId);
  }, [db.personnelContracts, activePeriodId]);

  const settlements = useMemo(() => {
    return (db.personnelSettlements || [])
      .filter(s => s.periodId === activePeriodId)
      .map(normalizeSettlementForDisplay);
  }, [db.personnelSettlements, activePeriodId]);

  // Filtered settlements list
  const filteredSettlements = useMemo(() => {
    return settlements.filter(s => {
      const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
      const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : '';
      
      const matchSearch = matchPersianString(empName, searchQuery) ||
        matchPersianString(s.employeeCode, searchQuery) ||
        matchPersianString(s.settlementNo, searchQuery);

      const matchReason = reasonFilter === 'all' || s.reason === reasonFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;

      return matchSearch && matchReason && matchStatus;
    });
  }, [settlements, personnelList, searchQuery, reasonFilter, statusFilter]);

  // Overall Statistics
  const stats = useMemo(() => {
    let totalCount = settlements.length;
    let totalGross = 0;
    let totalSeverance = 0;
    let totalBonus = 0;
    let totalUnusedLeave = 0;
    let totalDeductions = 0;
    let totalFinalNet = 0;

    settlements.forEach(s => {
      totalGross += s.totalGrossSalaries || 0;
      totalSeverance += s.severanceAmount || 0;
      totalBonus += s.bonusAmount || 0;
      totalUnusedLeave += s.unusedLeaveAmount || 0;
      totalDeductions += (s.totalDeductions || 0) + (s.employerPaidAmount || 0);
      totalFinalNet += s.finalNetPayable || 0;
    });

    return {
      totalCount,
      totalGross,
      totalSeverance,
      totalBonus,
      totalUnusedLeave,
      totalDeductions,
      totalFinalNet
    };
  }, [settlements]);

  // Selected employee in form
  const selectedPersonnel = useMemo(() => {
    return personnelList.find(p => p.employeeCode === formEmployeeCode);
  }, [personnelList, formEmployeeCode]);

  // Employee's contracts
  const employeeContracts = useMemo(() => {
    if (!formEmployeeCode) return [];
    return allContracts.filter(c => c.employeeCode === formEmployeeCode);
  }, [allContracts, formEmployeeCode]);

  // Selected contract in form
  const selectedContract = useMemo(() => {
    return employeeContracts.find(c => c.id === formContractId);
  }, [employeeContracts, formContractId]);

  // Find rate for a specific year (optionally prioritizing contract's explicit rateId or date range)
  const getSalaryRateForYear = (yearNum: number, targetDate?: string, preferredRateId?: string): SalaryBaseRate => {
    const yearStr = String(yearNum);
    const rates = db.salaryBaseRates || [];
    const normalizeYMD = (d?: string) => {
      if (!d) return '';
      const p = parseJalali(d);
      if (!p) return '';
      return `${String(p.y).padStart(4, '0')}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
    };

    let found: SalaryBaseRate | undefined;
    if (preferredRateId) {
      found = rates.find(r => r.id === preferredRateId);
    }
    if (!found && targetDate) {
      const targetNorm = normalizeYMD(targetDate);
      if (targetNorm) {
        found = rates.find(r => {
          const s = normalizeYMD(r.startDate);
          const e = normalizeYMD(r.endDate);
          return !!(s && e && targetNorm >= s && targetNorm <= e);
        });
      }
    }
    if (!found) {
      found = rates.find(r => String(r.year).trim() === yearStr.trim() && r.periodId === activePeriodId)
        || rates.find(r => String(r.year).trim() === yearStr.trim());
    }
    
    if (found) {
      const daily = found.dailyBaseSalary || 0;
      const hourly = (found.hourlyBaseSalary && found.hourlyBaseSalary > 0)
        ? found.hourlyBaseSalary
        : Math.round(daily / 7.333333);
      const rawOt = (found.overtimeHourlyRate && Number(found.overtimeHourlyRate) > 0)
        ? Number(found.overtimeHourlyRate)
        : Math.round((daily / 8) * 1.4);
      const overtime = rawOt > (daily * 0.8) ? Math.round(rawOt / 7.33) : rawOt;
      const rawFri = (found.fridayWorkHourlyRate !== undefined && found.fridayWorkHourlyRate > 0)
        ? found.fridayWorkHourlyRate
        : Math.round((daily * 0.40) / 7.33);
      const friday = rawFri > (daily * 0.15) ? Math.round(rawFri / 7.33) : rawFri;
      return {
        ...found,
        hourlyBaseSalary: hourly,
        overtimeHourlyRate: overtime,
        fridayWorkHourlyRate: friday
      };
    }

    // Fallback based on Iranian Labor Law standards
    const fallbackDaily = 2388728;
    const fallbackHourly = Math.round(fallbackDaily / 7.333333);
    const fallbackOvertime8h = Math.round((fallbackDaily / 8) * 1.4); // بر مبنای ۸ ساعت کار
    return {
      id: `sbr-fallback-${yearNum}`,
      periodId: activePeriodId,
      year: yearStr,
      dailyBaseSalary: fallbackDaily, // استاندارد پایه روزانه
      hourlyBaseSalary: fallbackHourly, // پایه حقوق ساعتی
      dailyInsuranceSalary: fallbackDaily,
      housingAllowance: 9000000, // ۹ میلیون ریال
      foodAllowance: 14000000, // ۱۴ میلیون ریال بن
      childAllowance: 7166184, // حق اولاد
      baseYearsRate: 70000,
      marriageAllowance: 5000000, // ۵ میلیون ریال حق تاهل
      taxableAmount: 120000000,
      overtimeHourlyRate: fallbackOvertime8h,
      fridayWorkHourlyRate: Math.round((fallbackDaily * 0.40) / 7.33)
    };
  };

  // سال متناظر با سال قرارداد
  const contractYear = useMemo(() => {
    const startStr = selectedContract?.contractStartDate || formStartDate || selectedPersonnel?.contractStartDate || selectedPersonnel?.entryDate || '';
    const parsedStart = parseJalali(startStr);
    if (parsedStart?.y) return parsedStart.y;
    const endStr = selectedContract?.contractEndDate || formEndDate || selectedPersonnel?.contractEndDate || '';
    const parsedEnd = parseJalali(endStr);
    if (parsedEnd?.y) return parsedEnd.y;
    return 1404;
  }, [selectedContract, formStartDate, formEndDate, selectedPersonnel]);

  // سال متناظر با سال تسویه حساب (بر اساس تاریخ موثر آخرین کارکرد در تسویه حساب)
  const settlementYear = useMemo(() => {
    const endStr = formEndDate || selectedContract?.contractEndDate || selectedPersonnel?.contractEndDate || formSettlementDate || formStartDate || '';
    if (formEndDate && formSettlementType === 'with_departure') {
      const effYM = parseEffectiveDepartureLastWorkYM(formEndDate);
      if (effYM?.year) return effYM.year;
    }
    const parsedEnd = parseJalali(endStr);
    if (parsedEnd?.y) return parsedEnd.y;
    if (formMonthlyDetails && formMonthlyDetails.length > 0) {
      const last = formMonthlyDetails[formMonthlyDetails.length - 1];
      if (last?.year) return last.year;
    }
    return contractYear || 1404;
  }, [formEndDate, formSettlementType, selectedContract, selectedPersonnel, formSettlementDate, formStartDate, formMonthlyDetails, contractYear]);

  // نرخ قوانین و ثوابت دستمزد متناسب با سال و دوره تسویه حساب
  const settlementSalaryRate = useMemo(() => {
    const targetDate = formEndDate || selectedContract?.contractStartDate || formStartDate || '';
    return getSalaryRateForYear(settlementYear, targetDate, selectedContract?.salaryBaseRateId);
  }, [settlementYear, formEndDate, formStartDate, selectedContract, db.salaryBaseRates, activePeriodId]);

  // نرخ اضافه کاری ساعتی مصوب سال تسویه حساب بر مبنای ۸ ساعت کار و نه ۷.۳۳:
  const settlementOvertimeHourlyRate = useMemo(() => {
    if (settlementSalaryRate?.overtimeHourlyRate && settlementSalaryRate.overtimeHourlyRate > 0) {
      return settlementSalaryRate.overtimeHourlyRate;
    }
    const sDaily = (settlementSalaryRate?.dailyBaseSalary && settlementSalaryRate.dailyBaseSalary > 0)
      ? settlementSalaryRate.dailyBaseSalary
      : 2388728;
    const hourlyWage8h = Math.round(sDaily / 8);
    return Math.round(hourlyWage8h * 1.4);
  }, [settlementSalaryRate]);

  // نرخ پایه حقوق و ثوابت متناظر با سال قرارداد
  const contractSalaryRate = useMemo(() => {
    const matched = getSalaryBaseRateForContract(
      selectedContract ? {
        ...selectedContract,
        contractStartDate: selectedContract.contractStartDate || formStartDate,
        contractEndDate: selectedContract.contractEndDate || formEndDate
      } : {
        contractStartDate: formStartDate,
        contractEndDate: formEndDate
      },
      selectedPersonnel,
      db,
      activePeriodId
    );
    if (matched) return matched;
    return getSalaryRateForYear(contractYear);
  }, [selectedContract, formStartDate, formEndDate, selectedPersonnel, db, activePeriodId, contractYear]);

  // Helper to re-calculate a single month based on laws & inputs
  const calculateMonthDetail = (
    current: SettlementMonthlyDetail,
    emp: Personnel | undefined,
    contract: PersonnelContract | undefined,
    targetSettlementYear?: number
  ): SettlementMonthlyDetail => {
    const yearNum = current.year;
    const rate = getSalaryRateForYear(yearNum);

    // ۱. استخراج سال متناظر با سال قرارداد و بازیابی نرخ‌های مصوب در قوانین و ثوابت دستمزد:
    const effectiveContract = contract || selectedContract || (emp ? allContracts.find(c => c.employeeCode === emp.employeeCode) : undefined);
    const contractStartDateStr = effectiveContract?.contractStartDate || formStartDate || emp?.contractStartDate || emp?.entryDate || '';
    const contractEndDateStr = effectiveContract?.contractEndDate || formEndDate || emp?.contractEndDate || '';
    const parsedStart = parseJalali(contractStartDateStr);
    const parsedEnd = parseJalali(contractEndDateStr);
    const resolvedContractYear = parsedStart?.y || parsedEnd?.y || current.year;

    // نرخ مصوب قوانین و ثوابت متناظر با سال قرارداد:
    const resolvedContractRate = getSalaryBaseRateForContract(
      effectiveContract ? {
        ...effectiveContract,
        contractStartDate: effectiveContract.contractStartDate || contractStartDateStr,
        contractEndDate: effectiveContract.contractEndDate || contractEndDateStr
      } : {
        contractStartDate: contractStartDateStr,
        contractEndDate: contractEndDateStr
      },
      emp,
      db,
      activePeriodId
    ) || getSalaryRateForYear(resolvedContractYear);

    // دستور صریح کاربر:
    // «در بخش تسویه حساب پایه حقوق ساعتی درج شده در بخش قوانین و ثوابت دستمزد متناسب با سال قرارداد ملاک محاسبه حقوق پایه است . نه مبلغ حقوق پایه بیمه . اما ملاک محاسبه حق بیمه سهم کارگر حقوق پایه بیمه باید باشد .»
    
    // پایه حقوق ساعتی درج شده در بخش قوانین و ثوابت دستمزد متناسب با سال قرارداد:
    const hourlyBase = (rate.hourlyBaseSalary && rate.hourlyBaseSalary > 0)
      ? rate.hourlyBaseSalary
      : Math.round((rate.dailyBaseSalary || 0) / 7.333333);

    // مزد پایه روزانه ناشی از پایه حقوق ساعتی ثوابت دستمزد (ملاک محاسبه حقوق پایه - ۷ ساعت و ۲۰ دقیقه = ۷.۳۳۳۳۳۳ ساعت در روز):
    const dailyBase = (rate.hourlyBaseSalary && rate.hourlyBaseSalary > 0)
      ? Math.round(rate.hourlyBaseSalary * 7.333333)
      : (rate.dailyBaseSalary > 0 ? rate.dailyBaseSalary : 2388728);

    const workedDays = Math.max(0, current.workedDays);
    const baseSalary = Math.round(dailyBase * workedDays);

    // ۲. محاسبه مزایای رفاهی و انگیزشی طبق قانون کار (بن خواربار و حق مسکن):
    // دستور کاربر: «همچنین مبلغ حق بن و حق مسکن جهت کارکرد کمتر از یک ماه درست محاسبه نمی شود»
    // قانون کار: در کارکرد کامل ماه (workedDays >= monthDays)، کل مبلغ مصوب ماهانه پرداخت می‌شود.
    // در کارکرد کمتر از یک ماه (workedDays < monthDays)، دقیقاً متناسب با روزهای کارکرد و تعداد روزهای همان ماه (workedDays / monthDays) محاسبه می‌گردد.
    const monthDays = current.totalDaysInMonth || getShamsiMonthDays(current.year, current.month);

    // ۱) حق بن و خواربار (کمک هزینه اقلام مصرفی):
    const monthlyFood = (effectiveContract as any)?.calculatedFoodAllowance !== undefined && (effectiveContract as any)?.calculatedFoodAllowance > 0
      ? (effectiveContract as any).calculatedFoodAllowance
      : (effectiveContract?.contract?.calculatedFoodAllowance !== undefined && effectiveContract?.contract?.calculatedFoodAllowance > 0
        ? effectiveContract.contract.calculatedFoodAllowance
        : (resolvedContractRate?.foodAllowance || rate.foodAllowance || 14000000));

    let foodAllowance = 0;
    if (workedDays >= monthDays) {
      foodAllowance = monthlyFood;
    } else if (workedDays > 0 && monthDays > 0) {
      foodAllowance = Math.round((monthlyFood / monthDays) * workedDays);
    }

    // ۲) حق مسکن:
    const monthlyHousing = (effectiveContract as any)?.calculatedHousingAllowance !== undefined && (effectiveContract as any)?.calculatedHousingAllowance > 0
      ? (effectiveContract as any).calculatedHousingAllowance
      : (effectiveContract?.contract?.calculatedHousingAllowance !== undefined && effectiveContract?.contract?.calculatedHousingAllowance > 0
        ? effectiveContract.contract.calculatedHousingAllowance
        : (resolvedContractRate?.housingAllowance || rate.housingAllowance || 9000000));

    let housingAllowance = 0;
    if (workedDays >= monthDays) {
      housingAllowance = monthlyHousing;
    } else if (workedDays > 0 && monthDays > 0) {
      housingAllowance = Math.round((monthlyHousing / monthDays) * workedDays);
    }

    // ۳) حق اولاد:
    const childCount = emp?.childrenCount || (emp?.childrenList || []).length || 0;
    const hasInsuranceDays = emp?.insuranceHistoryDays || 0;
    const isChildEligible = childCount > 0 && (hasInsuranceDays >= 720 || emp?.childrenList?.some(ch => ch.subjectToAllowance));
    let childAllowance = 0;
    if (isChildEligible) {
      const childRate = resolvedContractRate?.childAllowance || rate.childAllowance || 7166184;
      const fullChild = childCount * childRate;
      if (workedDays >= monthDays) {
        childAllowance = fullChild;
      } else if (workedDays > 0 && monthDays > 0) {
        childAllowance = Math.round((fullChild / monthDays) * workedDays);
      }
    }

    // ۴) حق تاهل:
    const isMarried = emp?.maritalStatus === 'متاهل' || emp?.isMarried === true;
    let marriageAllowance = 0;
    if (isMarried) {
      const marriageRate = resolvedContractRate?.marriageAllowance || rate.marriageAllowance || 5000000;
      if (workedDays >= monthDays) {
        marriageAllowance = marriageRate;
      } else if (workedDays > 0 && monthDays > 0) {
        marriageAllowance = Math.round((marriageRate / monthDays) * workedDays);
      }
    }

    // ۳. محاسبه مبلغ اضافه کار ساعتی و تعطیل کاری:
    // دستور صریح و موکد کاربر:
    // «در فرم تسویه حساب پرسنل جهت محاسبه مبلغ اضافه کاری و تعطیل کاری از مبلغ اضافه کاری ساعتی درج شده در قوانین و توابت دستمزد متناسب با سال تسویه حساب بر مبنای 8ساعت کار و نه 7.33 محاسبه شود»
    
    // ۱) استخراج سال تسویه حساب و نرخ قوانین و ثوابت دستمزد سال تسویه حساب:
    const effFormEndYear = (formEndDate && formSettlementType === 'with_departure')
      ? parseEffectiveDepartureLastWorkYM(formEndDate)?.year
      : (formEndDate ? parseJalali(formEndDate)?.y : undefined);
    const resolvedSettlementYear = targetSettlementYear || settlementYear || effFormEndYear || current.year;
    const targetSettlementRate = getSalaryRateForYear(resolvedSettlementYear);

    // ۲) مبلغ اضافه کاری ساعتی درج شده در قوانین و ثوابت دستمزد متناسب با سال تسویه حساب:
    let effectiveOvertimeHourlyRate = Number(targetSettlementRate?.overtimeHourlyRate || 0);

    // ۳) در صورت عدم درج مستقیم یا صفر بودن، محاسبه نرخ بر مبنای ۸ ساعت کار در روز (و نه ۷.۳۳):
    if (!effectiveOvertimeHourlyRate || effectiveOvertimeHourlyRate <= 0) {
      const dailyBaseFor8h = (targetSettlementRate?.dailyBaseSalary && targetSettlementRate.dailyBaseSalary > 0)
        ? targetSettlementRate.dailyBaseSalary
        : 2388728;
      const hourlyWage8h = Math.round(dailyBaseFor8h / 8);
      effectiveOvertimeHourlyRate = Math.round(hourlyWage8h * 1.4);
    }

    // ۴) محاسبه مبالغ اضافه کاری و تعطیل کاری بر اساس نرخ اضافه کار سال تسویه حساب (بر مبنای ۸ ساعت کار):
    const overtimeAmount = Math.round(current.overtimeHours * effectiveOvertimeHourlyRate);
    const holidayWorkAmount = Math.round(current.holidayWorkHours * effectiveOvertimeHourlyRate);

    // حق پایه سنوات روزانه:
    let dailyBaseYears = 0;
    if ((effectiveContract as any)?.calculatedSeniorityBase !== undefined && (effectiveContract as any)?.calculatedSeniorityBase > 0) {
      dailyBaseYears = Math.round((effectiveContract as any).calculatedSeniorityBase / 30);
    } else if (effectiveContract?.contractSeniorityBase && effectiveContract.contractSeniorityBase > 0) {
      dailyBaseYears = Math.round(effectiveContract.contractSeniorityBase / 30);
    } else if (emp?.dailyYearsDifference && emp.dailyYearsDifference > 0) {
      dailyBaseYears = emp.dailyYearsDifference;
    } else if (emp?.yearsBase && emp.yearsBase > 0) {
      dailyBaseYears = emp.yearsBase > 500000 ? Math.round(emp.yearsBase / 30) : emp.yearsBase;
    } else if (resolvedContractRate?.baseYearsRate && resolvedContractRate.baseYearsRate > 0) {
      dailyBaseYears = resolvedContractRate.baseYearsRate > 500000 ? Math.round(resolvedContractRate.baseYearsRate / 30) : resolvedContractRate.baseYearsRate;
    } else if (rate.baseYearsRate > 0) {
      dailyBaseYears = rate.baseYearsRate > 500000 ? Math.round(rate.baseYearsRate / 30) : rate.baseYearsRate;
    }

    // حق جمعه کاری ساعتی (مبنای ۷.۳۳ ساعت از ثوابت و قوانین دستمزد):
    const rawFridayRate = (resolvedContractRate?.fridayWorkHourlyRate && resolvedContractRate.fridayWorkHourlyRate > 0)
      ? resolvedContractRate.fridayWorkHourlyRate
      : (rate.fridayWorkHourlyRate && rate.fridayWorkHourlyRate > 0
        ? rate.fridayWorkHourlyRate
        : Math.round((dailyBase * 0.40) / 7.33));
    const fridayHourlyRate = (rawFridayRate > (dailyBase * 0.15))
      ? Math.round(rawFridayRate / 7.33)
      : rawFridayRate;
    const fridayWorkAmount = Math.round(fridayHourlyRate * current.fridayWorkHours);

    // Gross Salary
    const grossSalary = baseSalary + foodAllowance + housingAllowance + childAllowance + marriageAllowance + overtimeAmount + fridayWorkAmount + holidayWorkAmount;

    // Worker Insurance Share (7%):
    // دستور کاربر: «اما ملاک محاسبه حق بیمه سهم کارگر حقوق پایه بیمه باید باشد .»
    const monthStartDate = `${current.year}/${String(current.month).padStart(2, '0')}/01`;
    const targetContract = {
      ...effectiveContract,
      contractStartDate: effectiveContract?.contractStartDate || formStartDate || monthStartDate,
      contractEndDate: effectiveContract?.contractEndDate || formEndDate || monthStartDate,
      monthDate: monthStartDate
    };
    const { items: empInsuredItems } = getInsuredSalaryItemsForContract(
      targetContract,
      emp,
      db,
      activePeriodId
    );
    const isInsuringConfigured = empInsuredItems.length > 0;
    const isKeyInsured = (key: string) => {
      if (!isInsuringConfigured) {
        return ['dailyBaseSalary', 'dailyInsuranceSalary', 'baseSalary', 'housingAllowance', 'foodAllowance', 'baseYearsRate', 'marriageAllowance'].includes(key);
      }
      return empInsuredItems.some((item: any) => item.itemKey === key);
    };

    // حقوق پایه بیمه روزانه (دقیقاً ملاک محاسبه حق بیمه سهم کارگر حقوق پایه بیمه است):
    let dailyInsuranceBase = 0;
    if (effectiveContract?.contractDailyInsuranceSalary && effectiveContract.contractDailyInsuranceSalary > 0) {
      dailyInsuranceBase = effectiveContract.contractDailyInsuranceSalary;
    } else if (effectiveContract?.contractBaseInsuranceSalary && effectiveContract.contractBaseInsuranceSalary > 0) {
      dailyInsuranceBase = Math.round(effectiveContract.contractBaseInsuranceSalary / 30);
    } else if (emp?.dailySalaryInsurance && emp.dailySalaryInsurance > 0) {
      dailyInsuranceBase = emp.dailySalaryInsurance;
    } else if (emp?.baseSalaryInsurance && emp.baseSalaryInsurance > 0) {
      dailyInsuranceBase = emp.baseSalaryInsurance > 10000000 ? Math.round(emp.baseSalaryInsurance / 30) : emp.baseSalaryInsurance;
    } else if (rate.dailyInsuranceSalary > 0) {
      dailyInsuranceBase = rate.dailyInsuranceSalary;
    } else {
      dailyInsuranceBase = dailyBase;
    }

    let insurableGross = 0;
    if (isKeyInsured('dailyInsuranceSalary') || isKeyInsured('dailyBaseSalary') || isKeyInsured('baseSalary')) {
      insurableGross += dailyInsuranceBase * workedDays;
    }
    if (isKeyInsured('baseYearsRate')) {
      insurableGross += dailyBaseYears * workedDays;
    }
    if (isKeyInsured('foodAllowance')) {
      insurableGross += foodAllowance;
    }
    if (isKeyInsured('housingAllowance')) {
      insurableGross += housingAllowance;
    }
    if (isKeyInsured('childAllowance')) {
      insurableGross += childAllowance;
    }
    if (isKeyInsured('marriageAllowance')) {
      insurableGross += marriageAllowance;
    }
    if (isKeyInsured('overtimePay') || isKeyInsured('overtimeAmount')) {
      insurableGross += overtimeAmount;
    }
    if (isKeyInsured('fridayWorkPay') || isKeyInsured('fridayWorkAmount')) {
      insurableGross += fridayWorkAmount;
    }
    if (isKeyInsured('holidayWorkPay') || isKeyInsured('holidayWorkAmount')) {
      insurableGross += holidayWorkAmount;
    }
    if (isKeyInsured('jobAllowance') && emp?.jobAllowance) {
      insurableGross += emp.jobAllowance;
    }

    // سهم بیمه کارگر (۷ درصد) بر اساس حقوق پایه بیمه و اقلام مشمول:
    const workerInsuranceShare = (emp?.hasInsurance !== false) ? Math.round(insurableGross * 0.07) : 0;

    // Net Salary Payable
    const netSalaryPayable = Math.max(0, grossSalary - workerInsuranceShare);

    return {
      ...current,
      dailyBaseSalary: dailyBase,
      baseSalary,
      foodAllowance,
      housingAllowance,
      childAllowance,
      marriageAllowance,
      overtimeHourlyRate: effectiveOvertimeHourlyRate,
      overtimeAmount,
      holidayHourlyRate: effectiveOvertimeHourlyRate,
      holidayWorkAmount,
      fridayHourlyRate,
      fridayWorkAmount,
      grossSalary,
      insurableGross,
      workerInsuranceShare,
      netSalaryPayable
    };
  };

  // Check if departure month's payroll document is locked (accounting for +1 day departure offset)
  const isSettlementEndDateLocked = (
    endDateStr?: string,
    settlementType: SettlementType = 'with_departure'
  ): boolean => {
    if (!endDateStr) return false;
    if (settlementType === 'with_departure') {
      const eff = parseEffectiveDepartureLastWorkYM(endDateStr);
      if (!eff) return false;
      return isPayrollMonthLocked(db, activePeriodId, eff.year, eff.month, unlockedMonthsMap);
    }
    const parsed = parseJalali(endDateStr);
    if (!parsed) return false;
    return isPayrollMonthLocked(db, activePeriodId, parsed.y, parsed.m, unlockedMonthsMap);
  };

  const isSettlementRecordLocked = (s: Pick<PersonnelSettlement, 'endDate' | 'settlementType'>): boolean => {
    const sType: SettlementType = s.settlementType || 'with_departure';
    if (sType === 'without_departure') return false;
    return isSettlementEndDateLocked(s.endDate, sType);
  };

  const isDepartureMonthPayrollLocked = useMemo(() => {
    if (formSettlementType === 'without_departure') return false;
    return isSettlementEndDateLocked(formEndDate, formSettlementType);
  }, [formEndDate, formSettlementType, db.payrollPeriods, activePeriodId, unlockedMonthsMap]);

  const isModalReadOnly = Boolean(forceReadOnlyView || isDepartureMonthPayrollLocked);

  const priorWithoutDepartureForForm = useMemo(() => {
    return getPriorWithoutDepartureSettlements(
      formEmployeeCode,
      db.personnelSettlements,
      activePeriodId,
      editingId
    );
  }, [formEmployeeCode, db.personnelSettlements, activePeriodId, editingId]);

  const handleCloseModal = () => {
    setShowModal(false);
    onSettlementCloseOrCancel?.();
  };

  // Helper to determine employee's effective start date in a fiscal year
  // (advances automatically past any prior `without_departure` settlement's `endDate`)
  const resolveStartDateForCurrentYear = (
    emp: Personnel | undefined,
    empContracts: PersonnelContract[],
    yearNum: number,
    excludeSettlementId?: string | null,
    targetEndDate?: string
  ): string => {
    const yearStart = `${yearNum}/01/01`;
    if (!emp) return yearStart;

    let baseStart = yearStart;
    const entryNorm = emp.entryDate ? normalizeJalaliDate(emp.entryDate) : '';
    const entryParsed = parseJalali(entryNorm);

    if (!(entryParsed && entryParsed.y < yearNum)) {
      const candidates: string[] = [];
      if (entryParsed && entryParsed.y === yearNum) {
        candidates.push(entryNorm);
      }

      const firstAtt = findFirstAttendanceDateForCode(
        db.attendanceRecords,
        emp.attendanceCode,
        activePeriodId
      );
      const firstAttParsed = parseJalali(firstAtt);
      if (firstAttParsed && firstAttParsed.y === yearNum) {
        candidates.push(firstAtt);
      }

      empContracts.forEach(c => {
        const cs = c.contractStartDate ? normalizeJalaliDate(c.contractStartDate) : '';
        const csParsed = parseJalali(cs);
        if (csParsed && csParsed.y < yearNum) {
          candidates.push(yearStart);
        } else if (csParsed && csParsed.y === yearNum) {
          candidates.push(cs);
        }
      });

      if (candidates.length > 0) {
        candidates.sort();
        baseStart = candidates[0];
      }
    }

    // Advance startDate past any prior `without_departure` settlement already issued in this year
    const priors = getPriorWithoutDepartureSettlements(
      emp.employeeCode,
      db.personnelSettlements,
      activePeriodId,
      excludeSettlementId
    );
    const normTargetEnd = targetEndDate ? normalizeJalaliDate(targetEndDate) : '';
    const applicablePriors = priors.filter(ps => {
      const psEndNorm = normalizeJalaliDate(ps.endDate);
      const psEndY = parseJalali(psEndNorm)?.y;
      if (psEndY !== yearNum) return false;
      if (normTargetEnd && psEndNorm >= normTargetEnd) return false;
      return true;
    });

    if (applicablePriors.length > 0) {
      const latestPriorEnd = normalizeJalaliDate(applicablePriors[applicablePriors.length - 1].endDate);
      const nextDay = addDaysToJalali(latestPriorEnd, 1);
      const nextDayParsed = parseJalali(nextDay);
      if (
        nextDayParsed &&
        nextDayParsed.y === yearNum &&
        nextDay > baseStart &&
        (!normTargetEnd || nextDay <= normTargetEnd)
      ) {
        return nextDay;
      }
    }

    return baseStart;
  };

  // Helper to resolve default reason & dates (departure date is 1 day after last attendance so the last workday isn't deducted)
  const resolveDepartureDefaults = (
    emp?: Personnel,
    contract?: PersonnelContract,
    fallbackReason: SettlementReason = 'contract_end',
    preferredYear?: number,
    preferredMonth?: number,
    isCurrentYearMode = false,
    settlementType: SettlementType = 'with_departure',
    excludeSettlementId?: string | null
  ): { reason: SettlementReason; startDate: string; endDate: string; detectedLastAttendance: string } => {
    const resolvedReason: SettlementReason =
      settlementType === 'without_departure'
        ? 'contract_end'
        : emp?.departureReason
        ? mapPersianReasonToSettlementReason(emp.departureReason)
        : fallbackReason;
    const empContracts = emp ? allContracts.filter(c => c.employeeCode === emp.employeeCode) : [];
    const targetYearForStart = preferredYear || currentYear;
    const detectedLastAttendance = findLastAttendanceDateForEmployee(
      db,
      emp,
      activePeriodId,
      preferredYear,
      preferredMonth
    );
    const suggestedDepartureDate = detectedLastAttendance ? addDaysToJalali(detectedLastAttendance, 1) : '';
    const endDate =
      settlementType === 'without_departure'
        ? (contract?.contractEndDate || detectedLastAttendance || emp?.contractEndDate || getTodayJalali())
        : (suggestedDepartureDate ||
          (emp?.departureDate && String(emp.departureDate).trim()) ||
          contract?.contractEndDate ||
          emp?.contractEndDate ||
          getTodayJalali());
    const startDate = isCurrentYearMode
      ? resolveStartDateForCurrentYear(emp, empContracts, targetYearForStart, excludeSettlementId, endDate)
      : (contract?.contractStartDate || emp?.contractStartDate || emp?.entryDate || `${targetYearForStart}/01/01`);
    return { reason: resolvedReason, startDate, endDate, detectedLastAttendance };
  };

  // Generate months breakdown automatically strictly between [startDate .. effectiveWorkEnd] (never inserting post-departure months)
  const generateMonthsList = (
    startDateStr: string,
    endDateStr: string,
    emp?: Personnel,
    contract?: PersonnelContract,
    isCurrentYearMode = false,
    _yearOverride?: number,
    settlementTypeOverride?: SettlementType,
    excludeSettlementIdOverride?: string | null
  ) => {
    const effectiveSettlementType = settlementTypeOverride ?? formSettlementType;
    const normStart = normalizeJalaliDate(toEnglishDigits(startDateStr)) || toEnglishDigits(startDateStr);
    const normEnd = normalizeJalaliDate(toEnglishDigits(endDateStr)) || toEnglishDigits(endDateStr);
    const effectiveWorkEndStr =
      effectiveSettlementType === 'with_departure' && normEnd && (!normStart || normEnd > normStart)
        ? addDaysToJalali(normEnd, -1)
        : normEnd;

    const start = parseJalali(normStart);
    const end = parseJalali(effectiveWorkEndStr);
    if (!start || !end) return [];

    const effectiveExcludeId = excludeSettlementIdOverride !== undefined ? excludeSettlementIdOverride : editingId;
    const empContractsForEmp = emp ? allContracts.filter(c => c.employeeCode === emp.employeeCode) : [];
    const priors = emp
      ? getPriorWithoutDepartureSettlements(emp.employeeCode, db.personnelSettlements, activePeriodId, effectiveExcludeId)
      : [];

    const ymPairs: { y: number; m: number }[] = [];
    let curYLoop = start.y;
    let curMLoop = start.m;
    let safety = 0;
    while ((curYLoop < end.y || (curYLoop === end.y && curMLoop <= end.m)) && safety < 36) {
      ymPairs.push({ y: curYLoop, m: curMLoop });
      curMLoop++;
      if (curMLoop > 12) {
        curMLoop = 1;
        curYLoop++;
      }
      safety++;
    }

    const months: SettlementMonthlyDetail[] = [];
    let index = 1;
    const targetSettlementYear = end.y;

    for (let i = 0; i < ymPairs.length; i++) {
      const { y: curY, m: curM } = ymPairs[i];
      const daysInMonth = getShamsiMonthDays(curY, curM);

      // Check whether this full calendar month was already settled in a prior `without_departure` settlement
      const matchingPrior = priors.find(ps => {
        const psStart = parseJalali(ps.startDate);
        const psEnd = parseJalali(ps.endDate);
        if (!psStart || !psEnd) return false;
        const afterOrEqStart = curY > psStart.y || (curY === psStart.y && curM >= psStart.m);
        const beforeEndMonth = curY < psEnd.y || (curY === psEnd.y && curM < psEnd.m);
        const fullEndMonth = curY === psEnd.y && curM === psEnd.m && psEnd.d >= daysInMonth;
        return afterOrEqStart && (beforeEndMonth || fullEndMonth);
      });

      const effectiveProvisional =
        provisionalSettlementPreview &&
        emp &&
        toEnglishDigits(String(emp.employeeCode)).trim() === toEnglishDigits(String(provisionalSettlementPreview.employeeCode)).trim()
          ? { ...provisionalSettlementPreview, settlementType: effectiveSettlementType }
          : provisionalSettlementPreview;

      const payrollSnap = emp
        ? computeMonthlyPayrollSnapshotForEmployee(
            db,
            activePeriodId,
            emp,
            isCurrentYearMode ? undefined : contract,
            curY,
            curM,
            endDateStr,
            unlockedMonthsMap,
            {
              treatEndAsDeparture: effectiveSettlementType === 'with_departure',
              provisionalDeparture: effectiveProvisional
            }
          )
        : null;

      if (payrollSnap) {
        months.push(normalizeMonthlyDetailForSettlement({
          monthIndex: index++,
          year: curY,
          month: curM,
          monthName: `${JALALI_MONTH_NAMES[curM - 1]} ${toPersianDigits(curY)}`,
          totalDaysInMonth: daysInMonth,
          workedDays: payrollSnap.workedDays,
          overtimeHours: payrollSnap.overtimeHours,
          holidayWorkHours: payrollSnap.holidayWorkHours,
          fridayWorkHours: payrollSnap.fridayWorkHours,
          usedLeaveDays: payrollSnap.usedLeaveDays,
          usedLeaveHours: payrollSnap.usedLeaveHours,
          usedLeaveMinutes: payrollSnap.usedLeaveMinutes,
          dailyBaseSalary: payrollSnap.dailyBaseSalary,
          baseSalary: payrollSnap.baseSalary,
          foodAllowance: payrollSnap.foodAllowance,
          housingAllowance: payrollSnap.housingAllowance,
          childAllowance: payrollSnap.childAllowance,
          marriageAllowance: payrollSnap.marriageAllowance,
          seniorityBase: payrollSnap.seniorityBase,
          monthlyEidi: payrollSnap.monthlyEidi,
          monthlyYearsBenefit: payrollSnap.monthlyYearsBenefit,
          jobAllowance: payrollSnap.jobAllowance,
          overtimeHourlyRate: payrollSnap.overtimeHourlyRate,
          overtimeAmount: payrollSnap.overtimeAmount,
          holidayHourlyRate: payrollSnap.holidayHourlyRate,
          holidayWorkAmount: payrollSnap.holidayWorkAmount,
          fridayHourlyRate: payrollSnap.fridayHourlyRate,
          fridayWorkAmount: payrollSnap.fridayWorkAmount,
          grossSalary: payrollSnap.grossSalary,
          insurableGross: payrollSnap.insurableGross,
          workerInsuranceShare: payrollSnap.workerInsuranceShare,
          payrollTax: payrollSnap.payrollTax,
          supplementaryInsurance: payrollSnap.supplementaryInsurance,
          deductionsAmount: payrollSnap.deductionsAmount,
          netSalaryPayable: payrollSnap.netSalaryPayable,
          syncedFromPayroll: true,
          payrollSourceType: payrollSnap.sourceType,
          payrollItemPayable: payrollSnap.payrollItemPayable,
          payrollLeaveRemainingMinutes: payrollSnap.finalLeaveMinutes,
          alreadySettledInPrior: Boolean(matchingPrior),
          priorSettlementNo: matchingPrior?.settlementNo
        }));
      } else {
        let workedDays = daysInMonth;

        if (curY === start.y && curM === start.m) {
          workedDays = daysInMonth - start.d + 1;
        }
        if (curY === end.y && curM === end.m) {
          if (curY === start.y && curM === start.m) {
            workedDays = end.d - start.d + 1;
          } else {
            workedDays = end.d;
          }
        }

        workedDays = Math.max(0, Math.min(daysInMonth, workedDays));

        const monthStartStr = `${curY}/${String(curM).padStart(2, '0')}/01`;
        const monthEndStr = `${curY}/${String(curM).padStart(2, '0')}/${String(daysInMonth).padStart(2, '0')}`;
        const monthContract = isCurrentYearMode
          ? (empContractsForEmp.find(c => {
              const cs = normalizeJalaliDate(c.contractStartDate || '');
              const ce = c.contractEndDate ? normalizeJalaliDate(c.contractEndDate) : '9999/99/99';
              return Boolean(cs && cs <= monthEndStr && ce >= monthStartStr);
            }) || empContractsForEmp[0])
          : contract;

        const rawDetail: SettlementMonthlyDetail = {
          monthIndex: index++,
          year: curY,
          month: curM,
          monthName: `${JALALI_MONTH_NAMES[curM - 1]} ${toPersianDigits(curY)}`,
          totalDaysInMonth: daysInMonth,
          workedDays,
          overtimeHours: 0,
          holidayWorkHours: 0,
          fridayWorkHours: 0,
          usedLeaveDays: 0,
          usedLeaveHours: 0,
          usedLeaveMinutes: 0,
          dailyBaseSalary: 0,
          baseSalary: 0,
          foodAllowance: 0,
          housingAllowance: 0,
          childAllowance: 0,
          marriageAllowance: 0,
          seniorityBase: 0,
          monthlyEidi: 0,
          monthlyYearsBenefit: 0,
          jobAllowance: 0,
          overtimeAmount: 0,
          holidayWorkAmount: 0,
          fridayWorkAmount: 0,
          grossSalary: 0,
          workerInsuranceShare: 0,
          payrollTax: 0,
          supplementaryInsurance: 0,
          deductionsAmount: 0,
          netSalaryPayable: 0,
          syncedFromPayroll: false,
          payrollSourceType: 'manual_contract'
        };

        const calculated = calculateMonthDetail(rawDetail, emp, monthContract, targetSettlementYear);
        months.push({
          ...calculated,
          syncedFromPayroll: false,
          payrollSourceType: 'manual_contract',
          alreadySettledInPrior: Boolean(matchingPrior),
          priorSettlementNo: matchingPrior?.settlementNo
        });
      }
    }

    return months;
  };

  // Handle settlement type change (with_departure vs without_departure)
  const handleSettlementTypeChange = (nextType: SettlementType) => {
    if (isModalReadOnly) return;
    setFormSettlementType(nextType);
    onSettlementTypeChange?.(nextType);
    if (nextType === 'without_departure') {
      setFormReason('contract_end');
    }
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');

    if (selectedPersonnel) {
      const isCY = formContractId === CURRENT_YEAR_CONTRACT_ID;
      let startToUse = formStartDate;
      let endToUse = formEndDate;
      if (nextType === 'without_departure' && !isCY && selectedContract?.contractEndDate) {
        endToUse = selectedContract.contractEndDate;
        setFormEndDate(endToUse);
      } else if (nextType === 'with_departure') {
        const resolved = resolveDepartureDefaults(
          selectedPersonnel,
          isCY ? undefined : selectedContract,
          formReason,
          initialContext?.year || currentYear,
          initialContext?.month,
          isCY,
          'with_departure',
          editingId
        );
        startToUse = isCY ? resolved.startDate : formStartDate;
        endToUse = resolved.endDate;
        setLastDetectedAttendanceDate(resolved.detectedLastAttendance);
        if (isCY) setFormStartDate(startToUse);
        setFormEndDate(endToUse);
      }
      if (startToUse && endToUse) {
        const generated = generateMonthsList(
          startToUse,
          endToUse,
          selectedPersonnel,
          isCY ? undefined : selectedContract,
          isCY,
          currentYear,
          nextType,
          editingId
        );
        setFormMonthlyDetails(generated);
        setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
      }
    }
  };

  // Handle employee change (defaults contract selector to کل قرارداد سال جاری)
  const handleEmployeeSelect = (empCode: string) => {
    if (isModalReadOnly) return;
    setFormEmployeeCode(empCode);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');

    const emp = personnelList.find(p => p.employeeCode === empCode);
    setFormContractId(CURRENT_YEAR_CONTRACT_ID);

    const resolved = resolveDepartureDefaults(
      emp,
      undefined,
      'contract_end',
      currentYear,
      undefined,
      true,
      formSettlementType,
      editingId
    );
    setLastDetectedAttendanceDate(resolved.detectedLastAttendance);
    setFormReason(resolved.reason);
    setFormStartDate(resolved.startDate);
    setFormEndDate(resolved.endDate);

    const generated = generateMonthsList(
      resolved.startDate,
      resolved.endDate,
      emp,
      undefined,
      true,
      currentYear,
      formSettlementType,
      editingId
    );
    setFormMonthlyDetails(generated);
    setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
  };

  // Handle contract selection change
  const handleContractSelect = (contractId: string) => {
    if (isModalReadOnly) return;
    setFormContractId(contractId);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');

    if (contractId === CURRENT_YEAR_CONTRACT_ID) {
      const resolved = resolveDepartureDefaults(
        selectedPersonnel,
        undefined,
        formReason,
        currentYear,
        undefined,
        true,
        formSettlementType,
        editingId
      );
      setLastDetectedAttendanceDate(resolved.detectedLastAttendance);
      setFormStartDate(resolved.startDate);
      setFormEndDate(resolved.endDate);
      const generated = generateMonthsList(
        resolved.startDate,
        resolved.endDate,
        selectedPersonnel,
        undefined,
        true,
        currentYear,
        formSettlementType,
        editingId
      );
      setFormMonthlyDetails(generated);
      setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
      return;
    }

    const contract = allContracts.find(c => c.id === contractId);
    if (contract) {
      setFormStartDate(contract.contractStartDate);
      const detected = findLastAttendanceDateForEmployee(db, selectedPersonnel, activePeriodId);
      setLastDetectedAttendanceDate(detected);
      const suggestedDeparture = detected ? addDaysToJalali(detected, 1) : '';
      const endToUse =
        formSettlementType === 'without_departure'
          ? (contract.contractEndDate || detected || formEndDate)
          : (suggestedDeparture ||
            (selectedPersonnel?.departureDate && String(selectedPersonnel.departureDate).trim()) ||
            formEndDate ||
            contract.contractEndDate);
      setFormEndDate(endToUse);
      const generated = generateMonthsList(
        contract.contractStartDate,
        endToUse,
        selectedPersonnel,
        contract,
        false,
        currentYear,
        formSettlementType,
        editingId
      );
      setFormMonthlyDetails(generated);
      setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
      return;
    }

    // Fallback: قرارداد پیش‌فرض پرونده پرسنلی
    const fallbackStart = selectedPersonnel?.contractStartDate || selectedPersonnel?.entryDate || `${currentYear}/01/01`;
    const detected = findLastAttendanceDateForEmployee(db, selectedPersonnel, activePeriodId);
    setLastDetectedAttendanceDate(detected);
    const suggestedDeparture = detected ? addDaysToJalali(detected, 1) : '';
    const endToUse =
      formSettlementType === 'without_departure'
        ? (selectedPersonnel?.contractEndDate || detected || formEndDate || getTodayJalali())
        : (suggestedDeparture ||
          (selectedPersonnel?.departureDate && String(selectedPersonnel.departureDate).trim()) ||
          formEndDate ||
          selectedPersonnel?.contractEndDate ||
          getTodayJalali());
    setFormStartDate(fallbackStart);
    setFormEndDate(endToUse);
    const generated = generateMonthsList(
      fallbackStart,
      endToUse,
      selectedPersonnel,
      undefined,
      false,
      currentYear,
      formSettlementType,
      editingId
    );
    setFormMonthlyDetails(generated);
    setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
  };

  // Handle reason change (preserves detected last attendance date)
  const handleReasonChange = (reason: SettlementReason) => {
    if (isModalReadOnly) return;
    setFormReason(reason);
  };

  // Handle manual date changes
  const handleDateChangeAndRecalculate = (newStart: string, newEnd: string) => {
    if (isModalReadOnly) return;
    const cleanStart = toEnglishDigits(newStart);
    const cleanEnd = toEnglishDigits(newEnd);
    setFormStartDate(cleanStart);
    setFormEndDate(cleanEnd);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');

    if (cleanStart && cleanEnd && cleanStart.length >= 8 && cleanEnd.length >= 8) {
      const isCY = formContractId === CURRENT_YEAR_CONTRACT_ID;
      const generated = generateMonthsList(
        cleanStart,
        cleanEnd,
        selectedPersonnel,
        isCY ? undefined : selectedContract,
        isCY,
        currentYear,
        formSettlementType,
        editingId
      );
      setFormMonthlyDetails(generated);
      setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
    }
  };

  // Explicit Sync from Payroll & Attendance button handler
  const handleSyncFromPayroll = () => {
    if (isModalReadOnly) return;
    if (!selectedPersonnel || !formStartDate || !formEndDate) {
      alert('لطفاً ابتدا پرسنل و تاریخ شروع و پایان کارکرد را مشخص نمایید.');
      return;
    }
    const isCY = formContractId === CURRENT_YEAR_CONTRACT_ID;
    const generated = generateMonthsList(
      formStartDate,
      formEndDate,
      selectedPersonnel,
      isCY ? undefined : selectedContract,
      isCY,
      currentYear,
      formSettlementType,
      editingId
    );
    setFormMonthlyDetails(generated);
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');
    setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
  };

  // Calculations for End of Service (عیدی، سنوات، مانده مرخصی، جمع کل و مانده قابل پرداخت)
  const settlementSummary = useMemo(() => {
    let totalWorkedDays = 0;
    let totalBaseSalaries = 0;
    let totalFoodAllowances = 0;
    let totalHousingAllowances = 0;
    let totalChildAllowances = 0;
    let totalMarriageAllowances = 0;
    let totalOtherAllowances = 0;
    let totalOvertimeHours = 0;
    let totalHolidayWorkHours = 0;
    let totalFridayWorkHours = 0;
    let totalOvertimeAmounts = 0;
    let totalHolidayWorkAmounts = 0;
    let totalFridayWorkAmounts = 0;
    let totalGrossSalaries = 0;
    let totalInsurableGross = 0;
    let totalWorkerInsurance = 0;
    let totalTaxAndSupp = 0;
    let totalNetSalaries = 0;
    let totalUsedLeaveMinutes = 0;

    formMonthlyDetails.forEach(m => {
      if (m.alreadySettledInPrior) return;
      totalWorkedDays += m.workedDays;
      totalBaseSalaries += m.baseSalary;
      totalFoodAllowances += m.foodAllowance;
      totalHousingAllowances += m.housingAllowance;
      totalChildAllowances += m.childAllowance;
      totalMarriageAllowances += m.marriageAllowance;
      totalOtherAllowances += (m.seniorityBase || 0) + (m.jobAllowance || 0);
      totalOvertimeHours += m.overtimeHours || 0;
      totalHolidayWorkHours += m.holidayWorkHours || 0;
      totalFridayWorkHours += m.fridayWorkHours || 0;
      totalOvertimeAmounts += m.overtimeAmount;
      totalHolidayWorkAmounts += m.holidayWorkAmount;
      totalFridayWorkAmounts += m.fridayWorkAmount;
      totalGrossSalaries += m.grossSalary;
      totalInsurableGross += m.insurableGross || 0;
      totalWorkerInsurance += m.workerInsuranceShare;
      totalTaxAndSupp += (m.payrollTax || 0) + (m.supplementaryInsurance || 0);
      totalNetSalaries += m.netSalaryPayable;
      totalUsedLeaveMinutes += getMonthlyUsedLeaveMinutes(m);
    });
    const totalUsedLeaveHours = Math.round((totalUsedLeaveMinutes / 60) * 100) / 100;
    const totalUsedLeaveDays = Math.round((totalUsedLeaveMinutes / 60 / 8) * 100) / 100;

    // Detect any prior `without_departure` settlements overlapping `[formStartDate .. formEndDate]`
    const normStart = formStartDate ? normalizeJalaliDate(formStartDate) : '';
    const normEnd = formEndDate ? normalizeJalaliDate(formEndDate) : '';
    const overlappingPriors = priorWithoutDepartureForForm.filter(ps => {
      const psS = normalizeJalaliDate(ps.startDate);
      const psE = normalizeJalaliDate(ps.endDate);
      if (normStart && psE && psE < normStart) return false;
      if (normEnd && psS && psS > normEnd) return false;
      return true;
    });
    const priorSettledMonthsCount = formMonthlyDetails.filter(m => m.alreadySettledInPrior).length;

    // Last daily & monthly salary (مبتنی بر ماه موثر تسویه حساب):
    const normStartForEnd = formStartDate ? normalizeJalaliDate(toEnglishDigits(formStartDate)) : '';
    const normEndForEnd = formEndDate ? normalizeJalaliDate(toEnglishDigits(formEndDate)) : '';
    const effectiveSummaryEndDate =
      formSettlementType === 'with_departure' && normEndForEnd && (!normStartForEnd || normEndForEnd > normStartForEnd)
        ? addDaysToJalali(normEndForEnd, -1)
        : normEndForEnd;
    const endParsed = parseJalali(effectiveSummaryEndDate || '');
    const unsettledDetails = formMonthlyDetails.filter(m => !m.alreadySettledInPrior);
    const lookupPool = unsettledDetails.length > 0 ? unsettledDetails : formMonthlyDetails;
    const activeMonths = lookupPool.filter(
      m => m.syncedFromPayroll || m.workedDays > 0 || m.dailyBaseSalary > 0
    );
    const exactEndMonthRow = endParsed
      ? lookupPool.find(
          m =>
            m.year === endParsed.y &&
            m.month === endParsed.m &&
            (m.syncedFromPayroll || m.workedDays > 0 || m.dailyBaseSalary > 0)
        )
      : undefined;
    const lastActiveOnOrBeforeEnd = endParsed
      ? [...activeMonths]
          .reverse()
          .find(m => m.year < endParsed.y || (m.year === endParsed.y && m.month <= endParsed.m))
      : undefined;
    const refLastMonth =
      exactEndMonthRow ||
      lastActiveOnOrBeforeEnd ||
      activeMonths[activeMonths.length - 1] ||
      lookupPool[lookupPool.length - 1];

    const contractEndYear =
      endParsed?.y ||
      refLastMonth?.year ||
      parseInt((effectiveSummaryEndDate || formStartDate || String(currentYear)).split('/')[0], 10) ||
      currentYear;
    const endYearRate = getSalaryRateForYear(contractEndYear);
    const fallbackRateDaily = (endYearRate.hourlyBaseSalary && endYearRate.hourlyBaseSalary > 0)
      ? Math.round(endYearRate.hourlyBaseSalary * 7.333333)
      : (endYearRate.dailyBaseSalary > 0 ? endYearRate.dailyBaseSalary : 2388728);
    const defaultLastDailySalary = refLastMonth?.dailyBaseSalary || fallbackRateDaily;
    const lastDailySalary = formDailySalaryOverride !== '' ? parseNumber(formDailySalaryOverride) : defaultLastDailySalary;
    const lastMonthlyBaseSalary = lastDailySalary * 30;

    // 1. سنوات پایان خدمت (ماده ۲۴ قانون کار):
    // به نسبت روزهای کارکرد تسویه‌نشده قرارداد: (حقوق پایه ماهانه * کل کارکرد تسویه‌نشده) / ۳۶۵
    const severanceDays = totalWorkedDays;
    const defaultSeveranceAmount = Math.round((lastMonthlyBaseSalary * totalWorkedDays) / 365);
    const severanceAmount = formSeveranceAmount !== '' ? parseNumber(formSeveranceAmount) : defaultSeveranceAmount;

    // 2. عیدی و پاداش سالانه (قانون تعیین عیدی):
    // به نسبت روزهای کارکرد تسویه‌نشده قرارداد: (حقوق پایه ماهانه * ۲ * کل کارکرد تسویه‌نشده) / ۳۶۵
    const bonusDays = totalWorkedDays;
    const defaultBonusAmount = Math.round((lastMonthlyBaseSalary * 2 * totalWorkedDays) / 365);
    const bonusAmount = formBonusAmount !== '' ? parseNumber(formBonusAmount) : defaultBonusAmount;

    // 3. مرخصی استحقاقی و بازخرید آن بر اساس ساعت:
    // سقف مرخصی ماهانه از فیلد «مرخصی ساعتی ماهانه» در قوانین و ثوابت دستمزد (پیش‌فرض ۱۵:۵۳) خوانده می‌شود.
    // نرخ هر ساعت بازخرید = جمع مبلغ ماهانه (مبنای ۳۰ روز) آیتم‌های مشمول محاسبه بازخرید مرخصی ÷ ۲۲۰ ساعت
    const monthlyLeaveMinutes = getMonthlyLeaveMinutesForYearMonth(db, contractEndYear, activePeriodId);

    // یافتن آخرین قرارداد پرسنل برای خواندن اقلام مبنای ۳۰ روزه
    const allContractsForEmployee = (employeeContracts.length > 0
      ? employeeContracts
      : (db.personnelContracts || []).filter(c => c.employeeCode === selectedPersonnel?.employeeCode)
    ).slice().sort((a, b) => {
      const aDate = normalizeJalaliDate(toEnglishDigits(a.contractStartDate || ''));
      const bDate = normalizeJalaliDate(toEnglishDigits(b.contractStartDate || ''));
      if (bDate !== aDate) return bDate.localeCompare(aDate);
      return Number(b.isActive !== false) - Number(a.isActive !== false);
    });
    const latestEmployeeContract = selectedContract || allContractsForEmployee[0];

    const buyoutLookupDate = effectiveSummaryEndDate || formEndDate || `${contractEndYear}/01/01`;
    const buyoutLookupContract = {
      ...(latestEmployeeContract || {}),
      contractStartDate: latestEmployeeContract?.contractStartDate || formStartDate || `${contractEndYear}/01/01`,
      contractEndDate: latestEmployeeContract?.contractEndDate || buyoutLookupDate,
      monthDate: buyoutLookupDate
    };
    const buyoutContractRate =
      getSalaryBaseRateForContract(buyoutLookupContract, selectedPersonnel, db, activePeriodId) || endYearRate;

    const { items: configuredBuyoutItems, isConfigured: isLeaveBuyoutCustomConfigured } =
      getLeaveBuyoutSalaryItemsForContract(buyoutLookupContract, selectedPersonnel, db, activePeriodId);

    const LEAVE_BUYOUT_ITEM_LABELS: Record<string, string> = {
      dailyBaseSalary: 'حقوق پایه ماهانه (۳۰ روز)',
      dailyInsuranceSalary: 'حقوق پایه بیمه ماهانه (۳۰ روز)',
      housingAllowance: 'کمک هزینه مسکن (حق مسکن)',
      foodAllowance: 'کمک هزینه اقلام مصرفی (حق بن)',
      childAllowance: 'کمک هزینه عائله‌مندی (حق اولاد)',
      marriageAllowance: 'کمک هزینه تاهل (حق همسر)',
      baseYearsRate: 'حق پایه سنوات (۳۰ روز)',
      jobAllowance: 'فوق‌العاده شغلی (حق مسئولیت)'
    };

    const resolvedBuyoutEntries: { key: string; label: string }[] = [];
    const seenBuyoutKeys = new Set<string>();
    if (isLeaveBuyoutCustomConfigured && configuredBuyoutItems.length > 0) {
      configuredBuyoutItems.forEach((it: any) => {
        const k = String(it.itemKey || '').trim();
        if (!k || seenBuyoutKeys.has(k)) return;
        seenBuyoutKeys.add(k);
        resolvedBuyoutEntries.push({
          key: k,
          label: it.itemName || LEAVE_BUYOUT_ITEM_LABELS[k] || k
        });
      });
    } else {
      DEFAULT_LEAVE_BUYOUT_ITEM_KEYS.forEach((k) => {
        seenBuyoutKeys.add(k);
        resolvedBuyoutEntries.push({
          key: k,
          label: LEAVE_BUYOUT_ITEM_LABELS[k] || k
        });
      });
    }

    const resolveMonthlyBuyoutItemAmount = (key: string): number => {
      const emp = selectedPersonnel;
      const con: any = latestEmployeeContract;
      switch (key) {
        case 'dailyBaseSalary': {
          if (formDailySalaryOverride !== '') return lastDailySalary * 30;
          if (con?.contractBaseSalary && con.contractBaseSalary > 0) return Number(con.contractBaseSalary);
          if (con?.contractDailySalary && con.contractDailySalary > 0) return Math.round(Number(con.contractDailySalary) * 30);
          return lastMonthlyBaseSalary;
        }
        case 'dailyInsuranceSalary': {
          if (con?.contractBaseInsuranceSalary && con.contractBaseInsuranceSalary > 0) {
            return Number(con.contractBaseInsuranceSalary);
          }
          if (con?.contractDailyInsuranceSalary && con.contractDailyInsuranceSalary > 0) {
            return Math.round(Number(con.contractDailyInsuranceSalary) * 30);
          }
          if (emp?.baseSalaryInsurance && emp.baseSalaryInsurance > 0) {
            return emp.baseSalaryInsurance > 10000000
              ? Number(emp.baseSalaryInsurance)
              : Math.round(Number(emp.baseSalaryInsurance) * 30);
          }
          if (emp?.dailySalaryInsurance && emp.dailySalaryInsurance > 0) {
            return Math.round(Number(emp.dailySalaryInsurance) * 30);
          }
          return Math.round((buyoutContractRate?.dailyInsuranceSalary || endYearRate.dailyInsuranceSalary || lastDailySalary) * 30);
        }
        case 'baseYearsRate': {
          if (con?.calculatedSeniorityBase && con.calculatedSeniorityBase > 0) {
            return Number(con.calculatedSeniorityBase);
          }
          if (con?.contractSeniorityBase && con.contractSeniorityBase > 0) {
            return Number(con.contractSeniorityBase);
          }
          if (con?.contract?.calculatedSeniorityBase && con.contract.calculatedSeniorityBase > 0) {
            return Number(con.contract.calculatedSeniorityBase);
          }
          if (emp?.dailyYearsDifference && emp.dailyYearsDifference > 0) {
            return Math.round(Number(emp.dailyYearsDifference) * 30);
          }
          if (emp?.yearsBase && emp.yearsBase > 0) {
            return emp.yearsBase > 500000 ? Number(emp.yearsBase) : Math.round(Number(emp.yearsBase) * 30);
          }
          const insStart = parseJalali(emp?.insuranceDate || emp?.entryDate || '');
          const refDateParsed = parseJalali(con?.contractStartDate || buyoutLookupDate || '');
          if (insStart && refDateParsed) {
            const totalMonthsDiff = (refDateParsed.y - insStart.y) * 12 + (refDateParsed.m - insStart.m) + (refDateParsed.d >= insStart.d ? 0 : -1);
            const completedYears = Math.floor(totalMonthsDiff / 12);
            if (completedYears >= 1) {
              const yrStr = String(contractEndYear);
              const refDateNorm = `${String(refDateParsed.y).padStart(4, '0')}/${String(refDateParsed.m).padStart(2, '0')}/${String(refDateParsed.d).padStart(2, '0')}`;
              const normRuleDate = (d?: string) => {
                if (!d) return '';
                const p = parseJalali(d);
                if (!p) return '';
                return `${String(p.y).padStart(4, '0')}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
              };
              const matchingYears = (db.seniorityRateRules || []).filter(r => r.seniorityYears === completedYears);
              const rule = matchingYears.find(r => {
                const s = normRuleDate(r.startDate);
                const e = normRuleDate(r.endDate);
                if (!s && !e) return false;
                if (s && refDateNorm < s) return false;
                if (e && refDateNorm > e) return false;
                return true;
              }) || matchingYears.find(
                r => toEnglishDigits(String(r.fiscalYear || '')).trim() === yrStr
              );
              if (rule && rule.dailyRate > 0) {
                return Math.round(rule.dailyRate * 30);
              }
            }
          }
          if (refLastMonth && refLastMonth.seniorityBase && refLastMonth.seniorityBase > 0 && refLastMonth.workedDays > 0) {
            return Math.round((refLastMonth.seniorityBase / refLastMonth.workedDays) * 30);
          }
          return 0;
        }
        case 'foodAllowance': {
          if (con?.calculatedFoodAllowance && con.calculatedFoodAllowance > 0) return Number(con.calculatedFoodAllowance);
          if (con?.contract?.calculatedFoodAllowance && con.contract.calculatedFoodAllowance > 0) {
            return Number(con.contract.calculatedFoodAllowance);
          }
          return Number(buyoutContractRate?.foodAllowance || endYearRate.foodAllowance || 0);
        }
        case 'housingAllowance': {
          if (con?.calculatedHousingAllowance && con.calculatedHousingAllowance > 0) return Number(con.calculatedHousingAllowance);
          if (con?.contract?.calculatedHousingAllowance && con.contract.calculatedHousingAllowance > 0) {
            return Number(con.contract.calculatedHousingAllowance);
          }
          return Number(buyoutContractRate?.housingAllowance || endYearRate.housingAllowance || 0);
        }
        case 'childAllowance': {
          if (con?.calculatedChildAllowance && con.calculatedChildAllowance > 0) return Number(con.calculatedChildAllowance);
          if (con?.contract?.calculatedChildAllowance && con.contract.calculatedChildAllowance > 0) {
            return Number(con.contract.calculatedChildAllowance);
          }
          const childCount = emp?.childrenCount || (emp?.childrenList || []).length || 0;
          const hasInsuranceDays = emp?.insuranceHistoryDays || 0;
          const isChildEligible =
            childCount > 0 && (hasInsuranceDays >= 720 || emp?.childrenList?.some(ch => ch.subjectToAllowance));
          if (!isChildEligible) return 0;
          const childRate = Number(buyoutContractRate?.childAllowance || endYearRate.childAllowance || 0);
          return Math.round(childCount * childRate);
        }
        case 'marriageAllowance': {
          const isMarried = emp?.maritalStatus === 'متاهل' || emp?.isMarried === true;
          if (!isMarried) return 0;
          if (con?.calculatedMarriageAllowance && con.calculatedMarriageAllowance > 0) {
            return Number(con.calculatedMarriageAllowance);
          }
          if (con?.contract?.calculatedMarriageAllowance && con.contract.calculatedMarriageAllowance > 0) {
            return Number(con.contract.calculatedMarriageAllowance);
          }
          return Number(buyoutContractRate?.marriageAllowance || endYearRate.marriageAllowance || 0);
        }
        case 'jobAllowance': {
          if (con?.jobAllowance && con.jobAllowance > 0) return Number(con.jobAllowance);
          if (con?.contract?.jobAllowance && con.contract.jobAllowance > 0) return Number(con.contract.jobAllowance);
          return Number(emp?.jobAllowance || 0);
        }
        default:
          return 0;
      }
    };

    const leaveBuyoutBreakdown = resolvedBuyoutEntries.map(entry => ({
      key: entry.key,
      label: entry.label,
      amount: Math.max(0, Math.round(resolveMonthlyBuyoutItemAmount(entry.key)))
    }));
    const leaveBuyoutBaseMonthlySum = leaveBuyoutBreakdown.reduce((sum, item) => sum + item.amount, 0);
    const leaveHourlyRate = leaveBuyoutBaseMonthlySum / 220;

    let payrollRemainingLeaveMinutes: number | undefined = undefined;
    if (
      exactEndMonthRow &&
      exactEndMonthRow.payrollLeaveRemainingMinutes !== undefined &&
      exactEndMonthRow.payrollLeaveRemainingMinutes !== null
    ) {
      payrollRemainingLeaveMinutes = Number(exactEndMonthRow.payrollLeaveRemainingMinutes);
    } else {
      for (let i = lookupPool.length - 1; i >= 0; i--) {
        const m = lookupPool[i];
        if (endParsed && (m.year > endParsed.y || (m.year === endParsed.y && m.month > endParsed.m))) {
          continue;
        }
        const mins = m?.payrollLeaveRemainingMinutes;
        if (mins !== undefined && mins !== null) {
          payrollRemainingLeaveMinutes = Number(mins);
          break;
        }
      }
    }
    const hasPayrollLeaveBalance = payrollRemainingLeaveMinutes !== undefined;
    const payrollUnusedLeaveHours = hasPayrollLeaveBalance
      ? Math.max(0, Math.round((payrollRemainingLeaveMinutes! / 60) * 100) / 100)
      : 0;
    const payrollUnusedLeaveDays = Math.round((payrollUnusedLeaveHours / 8) * 100) / 100;

    // If a prior `without_departure` settlement ended inside the SAME month as `formEndDate`, deduct its already-paid unused leave (in hours)
    const sameMonthPriorSettledLeaveHours = endParsed
      ? Math.round(
          overlappingPriors
            .filter(ps => {
              const psE = parseJalali(ps.endDate);
              return psE && psE.y === endParsed.y && psE.m === endParsed.m;
            })
            .reduce((s, ps) => s + getSettlementUnusedLeaveHours(ps), 0) * 100
        ) / 100
      : 0;

    // سهم مرخصی دوره طبق فرمول: (کارکرد تسویه‌نشده / ۳۶۵) * (۱۲ × مرخصی ساعتی ماهانه)
    const annualEntitledLeaveHours = (monthlyLeaveMinutes / 60) * 12;
    const totalEntitledLeaveMinutes = Math.max(0, Math.round((totalWorkedDays / 365) * monthlyLeaveMinutes * 12));
    const totalEntitledLeaveHours = Math.round((totalEntitledLeaveMinutes / 60) * 10000) / 10000;
    const totalEntitledLeaveDays = Math.round((totalEntitledLeaveHours / 8) * 100) / 100;
    const formulaUnusedLeaveMinutes = Math.max(0, totalEntitledLeaveMinutes - totalUsedLeaveMinutes);
    const formulaUnusedLeaveHours = Math.round((formulaUnusedLeaveMinutes / 60) * 10000) / 10000;
    const formulaUnusedLeaveDays = Math.round((formulaUnusedLeaveHours / 8) * 100) / 100;
    const sameMonthPriorSettledLeaveMinutes = Math.max(0, Math.round(sameMonthPriorSettledLeaveHours * 60));
    const rawDefaultUnusedLeaveMinutes = hasPayrollLeaveBalance
      ? Math.max(0, Math.round(payrollRemainingLeaveMinutes!))
      : formulaUnusedLeaveMinutes;
    const defaultUnusedLeaveMinutes = Math.max(0, rawDefaultUnusedLeaveMinutes - sameMonthPriorSettledLeaveMinutes);
    const defaultUnusedLeaveHours = Math.round((defaultUnusedLeaveMinutes / 60) * 10000) / 10000;
    const defaultUnusedLeaveDays = Math.round((defaultUnusedLeaveHours / 8) * 100) / 100;
    const parsedFormUnusedMinutes = parseLeaveHMToMinutes(formUnusedLeaveHours);
    const unusedLeaveMinutes =
      formUnusedLeaveHours !== ''
        ? Math.max(0, parsedFormUnusedMinutes ?? 0)
        : defaultUnusedLeaveMinutes;
    const unusedLeaveHours = Math.round((unusedLeaveMinutes / 60) * 10000) / 10000;
    const unusedLeaveDays = Math.round((unusedLeaveHours / 8) * 100) / 100;
    const defaultUnusedLeaveAmount = Math.round((unusedLeaveMinutes / 60) * leaveHourlyRate);
    const unusedLeaveAmount = formUnusedLeaveAmount !== '' ? parseNumber(formUnusedLeaveAmount) : defaultUnusedLeaveAmount;

    // 4. طلب حساب از قبل (مانده بستانکاری پرسنل از سال یا دوره قبل)
    const previousYearReceivable = parseNumber(formPreviousYearReceivableAmount);

    // جمع کل مطالبات ناخالص (خالص حقوق ماه‌های تسویه‌نشده + سنوات + عیدی + مانده مرخصی + طلب از قبل)
    const totalGrossPayable = totalNetSalaries + severanceAmount + bonusAmount + unusedLeaveAmount + previousYearReceivable;

    // کسورات
    const purchasesAmount = parseNumber(formPurchasesAmount);
    const otherDeductions = parseNumber(formOtherDeductionsAmount);
    const totalDeductions = purchasesAmount + otherDeductions;

    // مبالغ پرداخت شده قبلی توسط کارفرما (مساعده / حقوق‌های پرداخت شده)
    const employerPaid = parseNumber(formEmployerPaidAmount);

    // مبلغ نهایی قابل پرداخت تسویه حساب
    const finalNetPayable = Math.max(0, totalGrossPayable - totalDeductions - employerPaid);

    return {
      totalWorkedDays,
      totalBaseSalaries,
      totalFoodAllowances,
      totalHousingAllowances,
      totalChildAllowances,
      totalMarriageAllowances,
      totalOtherAllowances,
      totalOvertimeHours,
      totalHolidayWorkHours,
      totalFridayWorkHours,
      totalOvertimeAmounts,
      totalHolidayWorkAmounts,
      totalFridayWorkAmounts,
      totalGrossSalaries,
      totalInsurableGross,
      totalWorkerInsurance,
      totalTaxAndSupp,
      totalNetSalaries,
      totalUsedLeaveMinutes,
      totalUsedLeaveHours,
      totalUsedLeaveDays,
      defaultLastDailySalary,
      lastDailySalary,
      leaveHourlyRate,
      monthlyLeaveMinutes,
      leaveBuyoutBreakdown,
      leaveBuyoutBaseMonthlySum,
      isLeaveBuyoutCustomConfigured,
      lastMonthlyBaseSalary,
      severanceDays,
      defaultSeveranceAmount,
      severanceAmount,
      bonusDays,
      defaultBonusAmount,
      bonusAmount,
      totalEntitledLeaveDays,
      totalEntitledLeaveHours,
      totalEntitledLeaveMinutes,
      hasPayrollLeaveBalance,
      payrollRemainingLeaveMinutes,
      payrollUnusedLeaveHours,
      payrollUnusedLeaveDays,
      formulaUnusedLeaveHours,
      formulaUnusedLeaveMinutes,
      formulaUnusedLeaveDays,
      defaultUnusedLeaveHours,
      defaultUnusedLeaveMinutes,
      defaultUnusedLeaveDays,
      unusedLeaveHours,
      unusedLeaveMinutes,
      unusedLeaveDays,
      defaultUnusedLeaveAmount,
      unusedLeaveAmount,
      previousYearReceivable,
      totalGrossPayable,
      purchasesAmount,
      otherDeductions,
      totalDeductions,
      employerPaid,
      finalNetPayable,
      overlappingPriors,
      priorSettledMonthsCount,
      sameMonthPriorSettledLeaveHours,
      sameMonthPriorSettledLeaveMinutes
    };
  }, [
    formMonthlyDetails,
    formStartDate,
    formEndDate,
    formSettlementType,
    priorWithoutDepartureForForm,
    selectedPersonnel,
    selectedContract,
    employeeContracts,
    db.personnelContracts,
    db.salaryBaseRates,
    db.seniorityRateRules,
    db.leaveBuyoutSalaryItems,
    activePeriodId,
    formPurchasesAmount,
    formOtherDeductionsAmount,
    formEmployerPaidAmount,
    formPreviousYearReceivableAmount,
    formDailySalaryOverride,
    formSeveranceAmount,
    formBonusAmount,
    formUnusedLeaveHours,
    formUnusedLeaveAmount
  ]);

  const departureUnpaidLeaveInfo = useMemo(
    () =>
      getDepartureMonthUnpaidLeaveInfo(
        formSettlementType,
        formStartDate,
        formEndDate,
        formMonthlyDetails
      ),
    [formSettlementType, formStartDate, formEndDate, formMonthlyDetails]
  );

  // Payroll, Treasury & Sync summary insights for the currently selected personnel & date range
  const payrollIntegrationInsights = useMemo(() => {
    const syncedMonthsCount = formMonthlyDetails.filter(m => m.syncedFromPayroll).length;
    const lockedMonthsCount = formMonthlyDetails.filter(m => m.payrollSourceType === 'locked_payroll').length;
    const liveMonthsCount = formMonthlyDetails.filter(m => m.payrollSourceType === 'live_attendance').length;
    const treasurySummary = getEmployeeTreasuryPaidInPeriod(db, selectedPersonnel, formStartDate, formEndDate);
    const normStartForReg = formStartDate ? normalizeJalaliDate(toEnglishDigits(formStartDate)) : '';
    const normEndForReg = formEndDate ? normalizeJalaliDate(toEnglishDigits(formEndDate)) : '';
    const effectiveEndForReg =
      formSettlementType === 'with_departure' && normEndForReg && (!normStartForReg || normEndForReg > normStartForReg)
        ? addDaysToJalali(normEndForReg, -1)
        : formEndDate;
    const registeredPayrollsSummary = getEmployeeRegisteredPayrollsSummary(db, selectedPersonnel, formStartDate, effectiveEndForReg, activePeriodId);

    return {
      syncedMonthsCount,
      lockedMonthsCount,
      liveMonthsCount,
      treasurySummary,
      registeredPayrollsSummary
    };
  }, [formMonthlyDetails, db, selectedPersonnel, formStartDate, formEndDate, formSettlementType, activePeriodId]);

  // Open Add Modal
  const handleOpenAdd = (
    preselectEmpCode?: string,
    ctx?: { year: number; month: number; readOnly?: boolean }
  ) => {
    setEditingId(null);
    setForceReadOnlyView(Boolean(ctx?.readOnly));
    const initialType: SettlementType = 'with_departure';
    setFormSettlementType(initialType);
    const targetEmp = preselectEmpCode
      ? (personnelList.find(p => p.employeeCode === preselectEmpCode) || personnelList[0])
      : personnelList[0];
    const empCode = targetEmp?.employeeCode || preselectEmpCode || '';
    setFormEmployeeCode(empCode);
    setFormSettlementDate(getTodayJalali());
    setFormPurchasesAmount('۰');
    setFormOtherDeductionsAmount('۰');
    setFormOtherDeductionsDescription('');
    setFormEmployerPaidAmount('۰');
    setFormPreviousYearReceivableAmount('۰');
    setFormPreviousYearReceivableDescription('');
    setFormDailySalaryOverride('');
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveHours('');
    setFormUnusedLeaveAmount('');
    setFormStatus('finalized');
    setFormNotes('');

    setFormContractId(CURRENT_YEAR_CONTRACT_ID);

    const resolved = resolveDepartureDefaults(
      targetEmp,
      undefined,
      'contract_end',
      ctx?.year || currentYear,
      ctx?.month,
      true,
      initialType,
      null
    );
    setLastDetectedAttendanceDate(resolved.detectedLastAttendance);
    setFormReason(resolved.reason);
    setFormStartDate(resolved.startDate);
    setFormEndDate(resolved.endDate);

    const generated = generateMonthsList(
      resolved.startDate,
      resolved.endDate,
      targetEmp,
      undefined,
      true,
      ctx?.year || currentYear,
      initialType,
      null
    );
    setFormMonthlyDetails(generated);
    setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');

    setShowModal(true);
  };

  // Open Edit / View Modal
  const handleOpenEdit = (
    settlement: PersonnelSettlement,
    explicitReadOnly?: boolean,
    ctx?: { year: number; month: number; readOnly?: boolean }
  ) => {
    const resolvedType: SettlementType = settlement.settlementType || 'with_departure';
    const locked = Boolean(explicitReadOnly) || isSettlementRecordLocked({ endDate: settlement.endDate, settlementType: resolvedType });
    setForceReadOnlyView(locked);
    setEditingId(settlement.id);
    setFormSettlementType(resolvedType);
    onSettlementTypeChange?.(resolvedType);
    setFormEmployeeCode(settlement.employeeCode);
    const effectiveContractId = settlement.contractId || CURRENT_YEAR_CONTRACT_ID;
    setFormContractId(effectiveContractId);
    setFormReason(settlement.reason);
    setFormStartDate(settlement.startDate);
    setFormEndDate(settlement.endDate);
    setFormSettlementDate(settlement.settlementDate);
    setFormPurchasesAmount(formatWithCommas(settlement.personnelPurchasesAmount));
    setFormOtherDeductionsAmount(formatWithCommas(settlement.otherDeductionsAmount));
    setFormOtherDeductionsDescription(settlement.otherDeductionsDescription || '');
    setFormEmployerPaidAmount(formatWithCommas(settlement.employerPaidAmount));
    setFormPreviousYearReceivableAmount(formatWithCommas(settlement.previousYearReceivableAmount || 0));
    setFormPreviousYearReceivableDescription(settlement.previousYearReceivableDescription || '');
    setFormPayrollSyncedAt(settlement.payrollSyncedAt || '');
    setFormDailySalaryOverride(settlement.dailySalaryForCalculation ? formatWithCommas(settlement.dailySalaryForCalculation) : '');
    setFormSeveranceAmount(settlement.severanceAmount !== undefined ? formatWithCommas(settlement.severanceAmount) : '');
    setFormBonusAmount(settlement.bonusAmount !== undefined ? formatWithCommas(settlement.bonusAmount) : '');
    const resolvedUnusedHours =
      settlement.unusedLeaveHours !== undefined && settlement.unusedLeaveHours !== null
        ? settlement.unusedLeaveHours
        : settlement.unusedLeaveDays !== undefined
        ? Math.round(settlement.unusedLeaveDays * 8 * 10000) / 10000
        : undefined;
    setFormUnusedLeaveHours(
      resolvedUnusedHours !== undefined ? formatMinutesToEnglishHM(Math.round(resolvedUnusedHours * 60)) : ''
    );
    setFormUnusedLeaveAmount(settlement.unusedLeaveAmount !== undefined ? formatWithCommas(settlement.unusedLeaveAmount) : '');
    setFormStatus(settlement.status);
    setFormNotes(settlement.notes || '');

    const emp = personnelList.find(p => p.employeeCode === settlement.employeeCode);
    const isCYMode = effectiveContractId === CURRENT_YEAR_CONTRACT_ID;
    const contract = isCYMode
      ? undefined
      : (allContracts.find(c => c.id === settlement.contractId) || allContracts.find(c => c.employeeCode === settlement.employeeCode));
    const detected = findLastAttendanceDateForEmployee(
      db,
      emp,
      activePeriodId,
      ctx?.year,
      ctx?.month
    );
    setLastDetectedAttendanceDate(detected);

    let effectiveEndDate = settlement.endDate;
    if (!locked && resolvedType === 'with_departure' && detected) {
      const normSavedEnd = normalizeJalaliDate(toEnglishDigits(settlement.endDate)) || toEnglishDigits(settlement.endDate);
      if (normSavedEnd === detected) {
        effectiveEndDate = addDaysToJalali(detected, 1);
        setFormEndDate(effectiveEndDate);
      }
    }

    // Sync Step 2 months strictly to Payroll Lists unless locked with existing snapshot
    if (!locked || !settlement.monthlyDetails || settlement.monthlyDetails.length === 0) {
      const cyTargetYear =
        ctx?.year ||
        (resolvedType === 'with_departure'
          ? parseEffectiveDepartureLastWorkYM(effectiveEndDate)?.year
          : parseJalali(effectiveEndDate)?.y) ||
        parseJalali(settlement.startDate)?.y ||
        currentYear;
      const synced = generateMonthsList(
        settlement.startDate,
        effectiveEndDate,
        emp,
        contract,
        isCYMode,
        cyTargetYear,
        resolvedType,
        settlement.id
      );
      setFormMonthlyDetails(
        synced.length > 0
          ? synced
          : (settlement.monthlyDetails || []).map(normalizeMonthlyDetailForSettlement)
      );
      if (ctx && !locked && synced.some(m => m.syncedFromPayroll)) {
        setFormUnusedLeaveHours('');
        setFormUnusedLeaveAmount('');
        setFormSeveranceAmount('');
        setFormBonusAmount('');
        setFormDailySalaryOverride('');
      }
    } else {
      setFormMonthlyDetails(
        (settlement.monthlyDetails || []).map(normalizeMonthlyDetailForSettlement)
      );
    }

    setShowModal(true);
  };

  // Deep link from Payroll Management ("تسویه حساب" / "مشاهده تسویه حساب")
  useEffect(() => {
    if (!initialEmployeeCode) return;
    const ctxReadOnly = Boolean(initialContext?.readOnly);
    const empSettlements = settlements.filter(s => s.employeeCode === initialEmployeeCode);

    const existingWithDeparture = empSettlements.find(
      s => (s.settlementType || 'with_departure') === 'with_departure'
    );
    const existingMatchingMonthWithoutDeparture =
      !ctxReadOnly && initialContext
        ? empSettlements.find(s => {
            if ((s.settlementType || 'with_departure') !== 'without_departure') return false;
            const endP = parseJalali(s.endDate);
            return Boolean(endP && endP.y === initialContext.year && endP.m === initialContext.month);
          })
        : undefined;

    const existing = ctxReadOnly
      ? (existingWithDeparture || empSettlements[0])
      : (existingWithDeparture || existingMatchingMonthWithoutDeparture);

    if (existing) {
      handleOpenEdit(existing, ctxReadOnly, initialContext || undefined);
    } else {
      handleOpenAdd(initialEmployeeCode, initialContext || undefined);
    }
    onClearInitialEmployee?.();
  }, [initialEmployeeCode, initialContext]);

  // Save Settlement
  const handleSaveSettlement = () => {
    if (isModalReadOnly) {
      alert('سند حقوق و دستمزد ماه ترک کار قفل است و امکان ویرایش یا ثبت برگه تسویه حساب وجود ندارد.');
      return;
    }
    if (!formEmployeeCode) {
      alert('لطفا پرسنل را انتخاب نمایید.');
      return;
    }
    if (!formStartDate || !formEndDate) {
      alert('لطفا تاریخ شروع و پایان تسویه حساب را مشخص کنید.');
      return;
    }
    if (formMonthlyDetails.length === 0) {
      alert('هیچ ماهی برای این بازه کارکرد استخراج نشده است.');
      return;
    }

    const currentList = db.personnelSettlements || [];
    const activePeriodObj = (db.periods || []).find(p => p.id === activePeriodId);
    const cleanSettlementDate = normalizeJalaliDate(toEnglishDigits(formSettlementDate)) || toEnglishDigits(formSettlementDate) || getTodayJalali();
    const yearPrefix = cleanSettlementDate.split('/')[0] || String(getFiscalYearFromPeriod(activePeriodObj, activePeriodId));
    const periodSettlementCount = currentList.filter(s => s.periodId === activePeriodId).length;
    const autoNumber = `SET-${yearPrefix}-${String(periodSettlementCount + 1).padStart(3, '0')}`;
    const normalizedStartDate = normalizeJalaliDate(toEnglishDigits(formStartDate)) || toEnglishDigits(formStartDate);
    const rawNormalizedEndDate = normalizeJalaliDate(toEnglishDigits(formEndDate)) || toEnglishDigits(formEndDate);
    const normalizedEndDate =
      formSettlementType === 'with_departure' &&
      lastDetectedAttendanceDate &&
      rawNormalizedEndDate === lastDetectedAttendanceDate
        ? addDaysToJalali(lastDetectedAttendanceDate, 1)
        : rawNormalizedEndDate;
    const effectiveReason: SettlementReason = formSettlementType === 'without_departure' ? 'contract_end' : formReason;

    const newRecord: PersonnelSettlement = {
      id: editingId || nextSimpleId(currentList, getPrefixForCollection('personnelSettlements')),
      periodId: activePeriodId,
      settlementNo: editingId ? (currentList.find(s => s.id === editingId)?.settlementNo || autoNumber) : autoNumber,
      employeeCode: formEmployeeCode,
      contractId: formContractId || undefined,
      settlementType: formSettlementType,
      reason: effectiveReason,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      settlementDate: cleanSettlementDate,
      totalPeriodDays: formMonthlyDetails.filter(m => !m.alreadySettledInPrior).reduce((sum, m) => sum + m.totalDaysInMonth, 0),
      totalWorkedDays: settlementSummary.totalWorkedDays,
      monthlyDetails: formMonthlyDetails,
      totalBaseSalaries: settlementSummary.totalBaseSalaries,
      totalFoodAllowances: settlementSummary.totalFoodAllowances,
      totalHousingAllowances: settlementSummary.totalHousingAllowances,
      totalChildAllowances: settlementSummary.totalChildAllowances,
      totalMarriageAllowances: settlementSummary.totalMarriageAllowances,
      totalOvertimeAmounts: settlementSummary.totalOvertimeAmounts,
      totalHolidayWorkAmounts: settlementSummary.totalHolidayWorkAmounts,
      totalFridayWorkAmounts: settlementSummary.totalFridayWorkAmounts,
      totalGrossSalaries: settlementSummary.totalGrossSalaries,
      totalInsurableGross: settlementSummary.totalInsurableGross,
      totalWorkerInsurance: settlementSummary.totalWorkerInsurance,
      totalNetSalaries: settlementSummary.totalNetSalaries,
      dailySalaryForCalculation: settlementSummary.lastDailySalary,
      monthlyBaseSalaryForCalculation: settlementSummary.lastMonthlyBaseSalary,
      severanceDays: settlementSummary.severanceDays,
      severanceAmount: settlementSummary.severanceAmount,
      bonusDays: settlementSummary.bonusDays,
      bonusAmount: settlementSummary.bonusAmount,
      totalEntitledLeaveDays: settlementSummary.totalEntitledLeaveDays,
      totalEntitledLeaveHours: settlementSummary.totalEntitledLeaveHours,
      totalUsedLeaveDays: settlementSummary.totalUsedLeaveDays,
      totalUsedLeaveHours: settlementSummary.totalUsedLeaveHours,
      unusedLeaveDays: settlementSummary.unusedLeaveDays,
      unusedLeaveHours: settlementSummary.unusedLeaveHours,
      unusedLeaveAmount: settlementSummary.unusedLeaveAmount,
      previousYearReceivableAmount: settlementSummary.previousYearReceivable,
      previousYearReceivableDescription: formPreviousYearReceivableDescription.trim() || undefined,
      totalGrossPayable: settlementSummary.totalGrossPayable,
      personnelPurchasesAmount: settlementSummary.purchasesAmount,
      otherDeductionsAmount: settlementSummary.otherDeductions,
      otherDeductionsDescription: formOtherDeductionsDescription.trim(),
      totalDeductions: settlementSummary.totalDeductions,
      employerPaidAmount: settlementSummary.employerPaid,
      finalNetPayable: settlementSummary.finalNetPayable,
      status: formStatus,
      notes: formNotes.trim(),
      payrollSyncedAt: formPayrollSyncedAt || undefined,
      registeredBy: db.currentUser?.fullName || 'مدیر سیستم',
      createdAt: editingId ? (currentList.find(s => s.id === editingId)?.createdAt || getTodayJalali()) : getTodayJalali(),
      updatedAt: getTodayJalali()
    };

    let updatedList: PersonnelSettlement[];
    if (editingId) {
      updatedList = currentList.map(s => s.id === editingId ? newRecord : s);
    } else {
      updatedList = [newRecord, ...currentList];
    }

    let updatedPersonnel = db.personnel || [];
    if (formSettlementType === 'with_departure') {
      const departureReasonLabel = getSettlementReasonLabel(effectiveReason);
      updatedPersonnel = updatedPersonnel.map(p => {
        if (
          p.employeeCode === formEmployeeCode &&
          p.periodId === activePeriodId
        ) {
          return {
            ...p,
            departureDate: normalizedEndDate,
            departureReason: departureReasonLabel,
            isActive: false
          };
        }
        return p;
      });
    }

    onUpdateDb({
      ...db,
      personnelSettlements: updatedList,
      personnel: updatedPersonnel
    });

    setShowModal(false);
    onSettlementCloseOrCancel?.();
    alert(
      formSettlementType === 'with_departure'
        ? 'سند تسویه حساب پرسنل با موفقیت ثبت گردید و تاریخ و علت ترک کار در پرونده پرسنل درج شد.'
        : 'سند تسویه حساب قرارداد (بدون ترک کار) با موفقیت ثبت شد و پرسنل همچنان در وضعیت فعال باقی ماند.'
    );
  };

  // Delete Settlement
  const handleDelete = (s: PersonnelSettlement) => {
    if (isSettlementRecordLocked(s)) {
      alert('سند حقوق و دستمزد ماه ترک کار قفل است و امکان حذف این برگه تسویه حساب وجود ندارد.');
      return;
    }
    if (confirm(`آیا از حذف سند تسویه حساب شماره ${s.settlementNo} اطمینان دارید؟`)) {
      const updatedList = (db.personnelSettlements || []).filter(item => item.id !== s.id);
      onUpdateDb({
        ...db,
        personnelSettlements: updatedList
      });
    }
  };

  // Export Excel / CSV
  const handleExportExcel = () => {
    if (filteredSettlements.length === 0) {
      alert('هیچ تسویه‌حسابی برای خروجی اکسل یافت نشد.');
      return;
    }

    const excelData = filteredSettlements.map((s, idx) => {
      const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
      const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
      const reasonLabel = (s.settlementType || 'with_departure') === 'without_departure'
        ? 'تسویه قرارداد (بدون ترک کار)'
        : getSettlementReasonLabel(s.reason);
      const statusLabel = s.status === 'paid' ? 'پرداخت شده' : s.status === 'finalized' ? 'قطعی' : 'پیش‌نویس';

      return {
        'ردیف': idx + 1,
        'شماره تسویه': s.settlementNo,
        'کد پرسنلی': s.employeeCode,
        'نام و نام خانوادگی': empName,
        'نوع و علت تسویه': reasonLabel,
        'تاریخ شروع خدمت': s.startDate,
        'تاریخ پایان خدمت': s.endDate,
        'کل روزهای کارکرد': s.totalWorkedDays || 0,
        'حقوق و مزایای خالص': s.totalNetSalaries || 0,
        'حق سنوات خدمت': s.severanceAmount || 0,
        'عیدی و پاداش': s.bonusAmount || 0,
        'مانده مرخصی (ساعت)': getSettlementUnusedLeaveHours(s),
        'مبلغ مانده مرخصی': s.unusedLeaveAmount || 0,
        'طلب حساب از قبل': s.previousYearReceivableAmount || 0,
        'خرید پرسنل': s.personnelPurchasesAmount || 0,
        'سایر کسورات': s.otherDeductionsAmount || 0,
        'پرداختی کارفرما': s.employerPaidAmount || 0,
        'خالص قابل پرداخت تسویه': s.finalNetPayable || 0,
        'وضعیت': statusLabel
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, 'تسویه حساب پرسنل');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Gatan_Personnel_Settlements_${activePeriodId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const headers = [
      'شماره تسویه',
      'کد پرسنلی',
      'نام پرسنل',
      'علت تسویه',
      'تاریخ شروع',
      'تاریخ پایان',
      'کل روزهای کارکرد',
      'حقوق و مزایای خالص',
      'حق سنوات',
      'عیدی و پاداش',
      'مانده مرخصی (ساعت)',
      'مبلغ مانده مرخصی',
      'طلب حساب از قبل',
      'خرید پرسنل',
      'سایر کسورات',
      'پرداختی کارفرما',
      'خالص قابل پرداخت تسویه',
      'وضعیت'
    ];

    const rows = filteredSettlements.map(s => {
      const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
      const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
      const reasonLabel = getSettlementReasonLabel(s.reason);
      const statusLabel = s.status === 'paid' ? 'پرداخت شده' : s.status === 'finalized' ? 'قطعی' : 'پیش‌نویس';

      return [
        s.settlementNo,
        s.employeeCode,
        empName,
        reasonLabel,
        s.startDate,
        s.endDate,
        s.totalWorkedDays,
        s.totalNetSalaries,
        s.severanceAmount,
        s.bonusAmount,
        getSettlementUnusedLeaveHours(s),
        s.unusedLeaveAmount,
        s.previousYearReceivableAmount || 0,
        s.personnelPurchasesAmount,
        s.otherDeductionsAmount,
        s.employerPaidAmount,
        s.finalNetPayable,
        statusLabel
      ];
    });

    downloadCSV(`Personnel_Settlements_${activePeriodId}`, headers, rows);
  };

  // Preview Current Draft Settlement in Print Layout
  const handlePreviewCurrentDraft = () => {
    if (!formEmployeeCode) {
      alert('لطفاً ابتدا پرسنل را انتخاب نمایید.');
      return;
    }
    const currentList = db.personnelSettlements || [];
    const activePeriodObj = (db.periods || []).find(p => p.id === activePeriodId);
    const yearPrefix = formSettlementDate.split('/')[0] || String(getFiscalYearFromPeriod(activePeriodObj, activePeriodId));
    const periodSettlementCount = currentList.filter(s => s.periodId === activePeriodId).length;
    const autoNumber = `SET-${yearPrefix}-${String(periodSettlementCount + 1).padStart(3, '0')}`;

    const draftRecord: PersonnelSettlement = {
      id: editingId || `settle-draft-preview`,
      periodId: activePeriodId,
      settlementNo: editingId ? (currentList.find(s => s.id === editingId)?.settlementNo || autoNumber) : autoNumber,
      employeeCode: formEmployeeCode,
      contractId: formContractId || undefined,
      settlementType: formSettlementType,
      reason: formSettlementType === 'without_departure' ? 'contract_end' : formReason,
      startDate: formStartDate,
      endDate: formEndDate,
      settlementDate: formSettlementDate,
      totalPeriodDays: formMonthlyDetails.filter(m => !m.alreadySettledInPrior).reduce((sum, m) => sum + m.totalDaysInMonth, 0),
      totalWorkedDays: settlementSummary.totalWorkedDays,
      monthlyDetails: formMonthlyDetails,
      totalBaseSalaries: settlementSummary.totalBaseSalaries,
      totalFoodAllowances: settlementSummary.totalFoodAllowances,
      totalHousingAllowances: settlementSummary.totalHousingAllowances,
      totalChildAllowances: settlementSummary.totalChildAllowances,
      totalMarriageAllowances: settlementSummary.totalMarriageAllowances,
      totalOvertimeAmounts: settlementSummary.totalOvertimeAmounts,
      totalHolidayWorkAmounts: settlementSummary.totalHolidayWorkAmounts,
      totalFridayWorkAmounts: settlementSummary.totalFridayWorkAmounts,
      totalGrossSalaries: settlementSummary.totalGrossSalaries,
      totalInsurableGross: settlementSummary.totalInsurableGross,
      totalWorkerInsurance: settlementSummary.totalWorkerInsurance,
      totalNetSalaries: settlementSummary.totalNetSalaries,
      dailySalaryForCalculation: settlementSummary.lastDailySalary,
      monthlyBaseSalaryForCalculation: settlementSummary.lastMonthlyBaseSalary,
      severanceDays: settlementSummary.severanceDays,
      severanceAmount: settlementSummary.severanceAmount,
      bonusDays: settlementSummary.bonusDays,
      bonusAmount: settlementSummary.bonusAmount,
      totalEntitledLeaveDays: settlementSummary.totalEntitledLeaveDays,
      totalEntitledLeaveHours: settlementSummary.totalEntitledLeaveHours,
      totalUsedLeaveDays: settlementSummary.totalUsedLeaveDays,
      totalUsedLeaveHours: settlementSummary.totalUsedLeaveHours,
      unusedLeaveDays: settlementSummary.unusedLeaveDays,
      unusedLeaveHours: settlementSummary.unusedLeaveHours,
      unusedLeaveAmount: settlementSummary.unusedLeaveAmount,
      previousYearReceivableAmount: settlementSummary.previousYearReceivable,
      previousYearReceivableDescription: formPreviousYearReceivableDescription.trim() || undefined,
      totalGrossPayable: settlementSummary.totalGrossPayable,
      personnelPurchasesAmount: settlementSummary.purchasesAmount,
      otherDeductionsAmount: settlementSummary.otherDeductions,
      otherDeductionsDescription: formOtherDeductionsDescription.trim(),
      totalDeductions: settlementSummary.totalDeductions,
      employerPaidAmount: settlementSummary.employerPaid,
      finalNetPayable: settlementSummary.finalNetPayable,
      status: formStatus,
      notes: formNotes.trim(),
      payrollSyncedAt: formPayrollSyncedAt || undefined,
      registeredBy: db.currentUser?.fullName || 'مدیر سیستم',
      createdAt: getTodayJalali(),
      updatedAt: getTodayJalali()
    };
    setPrintingSettlement(draftRecord);
  };

  // Open Full Screen Preview and Print Form
  const handlePrint = (settlement: PersonnelSettlement) => {
    setPrintingSettlement(normalizeSettlementForDisplay(settlement));
  };

  // Copy summary to clipboard
  const handleCopySummary = (s: PersonnelSettlement, empName: string) => {
    const text = `برگه تسویه حساب رسمی پرسنل: ${empName}
شماره سند: ${toPersianDigits(s.settlementNo)}
دوره کارکرد: ${toPersianDigits(s.startDate)} تا ${toPersianDigits(s.endDate)} (${toPersianDigits(s.totalWorkedDays)} روز)
خالص حقوق و دستمزد ماه‌ها: ${formatWithCommas(s.totalNetSalaries)} ریال
حق سنوات پایان خدمت: ${formatWithCommas(s.severanceAmount)} ریال
عیدی و پاداش سالانه: ${formatWithCommas(s.bonusAmount)} ریال
بازخرید مانده مرخصی: ${formatWithCommas(s.unusedLeaveAmount)} ریال (${formatHoursAsPersianHM(getSettlementUnusedLeaveHours(s))} ساعت)
طلب حساب از قبل (مانده سال قبل): ${formatWithCommas(s.previousYearReceivableAmount || 0)} ریال${s.previousYearReceivableDescription ? ` (${s.previousYearReceivableDescription})` : ''}
جمع کل مطالبات: ${formatWithCommas(s.totalGrossPayable)} ریال
کسورات و پرداختی قبلی: ${formatWithCommas((s.totalDeductions || 0) + (s.employerPaidAmount || 0))} ریال
مبلغ خالص قابل پرداخت نهایی: ${formatWithCommas(s.finalNetPayable)} ریال
به حروف: ${numberToWordsPersian(s.finalNetPayable)} ریال`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    }
  };

  useEffect(() => {
    if (printingSettlement) {
      document.body.classList.add('settlement-print-active');
    } else {
      document.body.classList.remove('settlement-print-active');
    }
    return () => {
      document.body.classList.remove('settlement-print-active');
    };
  }, [printingSettlement]);

  const handleTriggerPrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 text-slate-100 font-sans" dir="rtl">
      {/* Background Dashboard & Form Sections (hidden in print when preview is active) */}
      <div className={printingSettlement ? 'print:hidden space-y-6' : 'space-y-6'}>
        {/* Top Header & Overview */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between bg-slate-950 p-6 rounded-2xl border border-slate-850 gap-4 shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="bg-rose-500/15 p-3 rounded-2xl border border-rose-500/30 text-rose-400">
            <Calculator className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              سامانه جامع تسویه حساب پرسنل و پایان همکاری
              <span className="text-[11px] font-normal px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                منطبق با قانون کار و تامین اجتماعی
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              محاسبه حقوق ماه به ماه، ثوابت دستمزد، ماه‌های ۳۱ روزه، سنوات، عیدی و پاداش، بازخرید مرخصی، خرید دوره و کسورات
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          {!showModal ? (
            <>
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-850 text-xs font-bold text-slate-200 rounded-xl border border-slate-750 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="دانلود فایل رسمی اکسل (.xlsx) تسویه حساب‌های پرسنل"
              >
                <Download className="h-4 w-4 text-emerald-400" />
                خروجی اکسل (.xlsx)
              </button>
              
              <button
                type="button"
                onClick={() => handleOpenAdd()}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-xs font-black text-white rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-rose-600/25 border border-rose-500/40"
              >
                <Plus className="h-4 w-4" />
                افزودن / صدور تسویه حساب جدید
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleCloseModal}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-black text-slate-200 rounded-xl border border-slate-700 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <RotateCcw className="h-4 w-4" />
              بازگشت به لیست تسویه حساب‌ها
            </button>
          )}
        </div>
      </div>

      {!showModal && (
        <>
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
          <span className="text-[11px] text-slate-400 block font-medium">تعداد اسناد تسویه</span>
          <span className="text-lg font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">در این دوره</span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
          <span className="text-[11px] text-slate-400 block font-medium">مجموع حقوق و مزایا</span>
          <span className="text-sm font-black text-amber-300 mt-1 block">{formatWithCommas(stats.totalGross)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">ریال ناخالص</span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
          <span className="text-[11px] text-slate-400 block font-medium">مجموع سنوات خدمت</span>
          <span className="text-sm font-black text-sky-400 mt-1 block">{formatWithCommas(stats.totalSeverance)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">ماده ۲۴ قانون کار</span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
          <span className="text-[11px] text-slate-400 block font-medium">مجموع عیدی و پاداش</span>
          <span className="text-sm font-black text-emerald-400 mt-1 block">{formatWithCommas(stats.totalBonus)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">به نسبت کارکرد دوره</span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
          <span className="text-[11px] text-slate-400 block font-medium">مجموع بازخرید مرخصی</span>
          <span className="text-sm font-black text-indigo-400 mt-1 block">{formatWithCommas(stats.totalUnusedLeave)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5 block">ماده ۶۴ قانون کار</span>
        </div>

        <div className="bg-slate-950 p-4 rounded-xl border border-rose-900/40 bg-rose-950/20">
          <span className="text-[11px] text-rose-300 block font-bold">خالص کل قابل پرداخت</span>
          <span className="text-sm font-black text-white mt-1 block">{formatWithCommas(stats.totalFinalNet)}</span>
          <span className="text-[10px] text-rose-400 mt-0.5 block">ریال پس از تمام کسورات</span>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full md:w-auto">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="جستجو در اسناد تسویه بر اساس نام پرسنل، کد ملی، شماره تسویه..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-9 pl-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-hidden focus:border-rose-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400 text-[11px]">علت:</span>
            <select
              value={reasonFilter}
              onChange={e => setReasonFilter(e.target.value as any)}
              className="bg-transparent text-slate-200 border-none outline-hidden text-xs cursor-pointer"
            >
              <option value="all">همه علت‌ها</option>
              <option value="contract_end">اتمام قرارداد</option>
              <option value="dismissal">اخراج</option>
              <option value="resignation">استعفا</option>
              <option value="abandonment">ترک کار بدون استعفا</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400 text-[11px]">وضعیت:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="bg-transparent text-slate-200 border-none outline-hidden text-xs cursor-pointer"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="finalized">قطعی شده</option>
              <option value="paid">پرداخت شده</option>
            </select>
          </div>
        </div>
      </div>

      {/* Settlements Table */}
      <div className="bg-slate-950 rounded-2xl border border-slate-850 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900 text-slate-400 border-b border-slate-850 font-bold">
              <tr>
                <th className="p-3.5">شماره تسویه</th>
                <th className="p-3.5">پرسنل</th>
                <th className="p-3.5">علت قطع همکاری</th>
                <th className="p-3.5">بازه زمانی تسویه</th>
                <th className="p-3.5 text-center">کارکرد</th>
                <th className="p-3.5 text-left">خالص حقوق ماه‌ها</th>
                <th className="p-3.5 text-left">سنوات خدمت</th>
                <th className="p-3.5 text-left">عیدی و پاداش</th>
                <th className="p-3.5 text-left">مانده مرخصی</th>
                <th className="p-3.5 text-left">طلب از قبل</th>
                <th className="p-3.5 text-left">کسورات و پرداختی</th>
                <th className="p-3.5 text-left font-black text-rose-400">مبلغ قابل پرداخت</th>
                <th className="p-3.5 text-center">وضعیت</th>
                <th className="p-3.5 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850/60">
              {filteredSettlements.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-12 text-center text-slate-400">
                    <Receipt className="h-10 w-10 text-slate-400 mx-auto mb-2 opacity-50" />
                    هیچ سند تسویه حسابی با شرایط انتخابی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredSettlements.map(s => {
                  const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
                  const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
                  
                  return (
                    <tr key={s.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="p-3.5 font-mono text-slate-300 font-bold">
                        {toPersianDigits(s.settlementNo)}
                        <span className="block text-[10px] text-slate-400">{toPersianDigits(s.settlementDate)}</span>
                      </td>

                      <td className="p-3.5">
                        <span className="font-bold text-white block">{empName}</span>
                        <span className="text-[11px] text-slate-400 block font-mono">کد: {toPersianDigits(s.employeeCode)}</span>
                      </td>

                      <td className="p-3.5">
                        {(s.settlementType || 'with_departure') === 'without_departure' ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border bg-sky-500/15 text-sky-300 border-sky-500/30">
                            قرارداد (بدون ترک کار)
                          </span>
                        ) : (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                            s.reason === 'contract_end' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : s.reason === 'dismissal' 
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                              : s.reason === 'abandonment'
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {getSettlementReasonLabel(s.reason)}
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-[11px] text-slate-300 font-mono">
                        {toPersianDigits(s.startDate)} تا {toPersianDigits(s.endDate)}
                      </td>

                      <td className="p-3.5 text-center font-bold text-slate-200">
                        {toPersianDigits(s.totalWorkedDays)} روز
                      </td>

                      <td className="p-3.5 text-left font-mono font-medium text-slate-200">
                        {formatWithCommas(s.totalNetSalaries)}
                      </td>

                      <td className="p-3.5 text-left font-mono text-sky-400 font-medium">
                        {formatWithCommas(s.severanceAmount)}
                      </td>

                      <td className="p-3.5 text-left font-mono text-emerald-400 font-medium">
                        {formatWithCommas(s.bonusAmount)}
                      </td>

                      <td
                        className="p-3.5 text-left font-mono text-indigo-400 font-medium"
                        title={`بازخرید مانده مرخصی: ${formatHoursAsPersianHM(getSettlementUnusedLeaveHours(s))} ساعت مانده — فرمول محاسبه: (جمع اقلام مشمول بازخرید مرخصی ÷ ۲۲۰ ساعت) × ساعت مانده مرخصی`}
                      >
                        {formatWithCommas(s.unusedLeaveAmount)}
                        <span className="block text-[10px] text-slate-400 font-sans">
                          {formatHoursAsPersianHM(getSettlementUnusedLeaveHours(s))} ساعت مانده
                        </span>
                      </td>

                      <td className="p-3.5 text-left font-mono text-teal-400 font-medium">
                        {formatWithCommas(s.previousYearReceivableAmount || 0)}
                        {s.previousYearReceivableDescription && (
                          <span className="block text-[9.5px] text-slate-400 font-sans truncate max-w-[110px]" title={s.previousYearReceivableDescription}>
                            {s.previousYearReceivableDescription}
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-left font-mono text-amber-400 text-[11px]">
                        {formatWithCommas((s.totalDeductions || 0) + (s.employerPaidAmount || 0))}
                      </td>

                      <td className="p-3.5 text-left font-mono font-black text-rose-400 text-sm">
                        {formatWithCommas(s.finalNetPayable)}
                        <span className="block text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                      </td>

                      <td className="p-3.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          s.status === 'paid' 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : s.status === 'finalized'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {s.status === 'paid' ? 'پرداخت شده' : s.status === 'finalized' ? 'قطعی' : 'پیش‌نویس'}
                        </span>
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            title="چاپ برگه رسمی تسویه حساب"
                            onClick={() => handlePrint(s)}
                            className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                          >
                            <Printer className="h-4 w-4 text-sky-400" />
                          </button>
                          {isSettlementRecordLocked(s) ? (
                            <button
                              type="button"
                              title="مشاهده تسویه حساب (سند حقوق ماه ترک کار قفل است)"
                              onClick={() => handleOpenEdit(s, true)}
                              className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                            >
                              <Eye className="h-4 w-4 text-emerald-400" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="ویرایش تسویه حساب"
                              onClick={() => handleOpenEdit(s, false)}
                              className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                            >
                              <Edit3 className="h-4 w-4 text-amber-400" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isSettlementRecordLocked(s)}
                            title={
                              isSettlementRecordLocked(s)
                                ? 'سند حقوق ماه ترک کار قفل است و امکان حذف وجود ندارد'
                                : 'حذف تسویه حساب'
                            }
                            onClick={() => handleDelete(s)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isSettlementRecordLocked(s)
                                ? 'text-slate-600 bg-slate-900/50 cursor-not-allowed opacity-50'
                                : 'text-slate-300 hover:text-rose-400 bg-slate-800 hover:bg-rose-950/40 cursor-pointer'
                            }`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* ======================================================== */}
      {/* FULL-PAGE VIEW: CREATE / EDIT SETTLEMENT WIZARD          */}
      {/* ======================================================== */}
      {showModal && (
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl w-full flex flex-col shadow-xl overflow-hidden animate-fade-in">
            {/* Full-Page Form Header (Customer-style) */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6 border-b border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 text-rose-400 rounded-xl shrink-0">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex flex-wrap items-center gap-2">
                    <span>
                      {isModalReadOnly
                        ? 'مشاهده سند تسویه حساب پرسنل (فقط خواندنی)'
                        : editingId
                        ? 'ویرایش و بازبینی تسویه حساب پرسنل'
                        : 'محاسبه و صدور سند تسویه حساب پرسنل'}
                    </span>
                    {isModalReadOnly && (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        سند حقوق ماه ترک کار قفل است
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    {formSettlementType === 'without_departure'
                      ? 'تسویه کامل یک قرارداد بدون قطع همکاری (پرسنل فعال باقی می‌ماند و مانده مرخصی و سنوات تا پایان این قرارداد تسویه می‌شود).'
                      : 'اطلاعات حقوق و دستمزد ماه‌ها مستقیماً مطابق لیست‌های حقوق محاسبه می‌شود؛ در ماه ترک کار مانده مرخصی و اضافه‌کار صرفاً در تسویه حساب اعمال می‌گردد.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border border-slate-700 shrink-0"
              >
                <X className="h-4 w-4" />
                {isModalReadOnly ? 'بازگشت' : 'انصراف و بازگشت'}
              </button>
            </div>

            {/* Form Body */}
            <div className="p-5 sm:p-6 space-y-6 flex-1 text-xs">
              {isModalReadOnly && (
                <div className="bg-amber-950/35 border border-amber-500/40 rounded-xl p-3.5 flex items-center gap-2.5 text-amber-200 text-xs font-bold">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>
                    سند حقوق و دستمزد ماه ترک کار قفل شده است؛ این برگه تسویه حساب در حالت «فقط مشاهده» باز شده و امکان ویرایش یا تغییر اطلاعات آن وجود ندارد.
                  </span>
                </div>
              )}

              {/* SECTION 1: PERSONNEL & CONTRACT SELECTION */}
              <div className="bg-slate-950/60 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-4">
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-rose-400" />
                  مرحله ۱: انتخاب نوع تسویه، پرسنل، قرارداد و بازه زمانی
                </h4>

                {/* Settlement Type Selector */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isModalReadOnly}
                    onClick={() => handleSettlementTypeChange('with_departure')}
                    className={`p-3.5 rounded-xl border text-right transition-all ${
                      isModalReadOnly ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      formSettlementType === 'with_departure'
                        ? 'bg-rose-500/15 border-rose-500 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-white">تسویه حساب کامل به همراه ترک کار</span>
                      {formSettlementType === 'with_departure' && (
                        <CheckCircle2 className="h-4 w-4 text-rose-400 shrink-0" />
                      )}
                    </div>
                    <span className="block text-[11px] text-slate-300 mt-1 leading-relaxed">
                      ثبت تاریخ و علت ترک کار در پرونده پرسنل، اعمال قوانین ماه ترک کار بر لیست حقوق و مختومه شدن همکاری
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isModalReadOnly}
                    onClick={() => handleSettlementTypeChange('without_departure')}
                    className={`p-3.5 rounded-xl border text-right transition-all ${
                      isModalReadOnly ? 'opacity-75 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      formSettlementType === 'without_departure'
                        ? 'bg-sky-500/15 border-sky-500 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-xs text-white">تسویه حساب قرارداد بدون ترک کار</span>
                      {formSettlementType === 'without_departure' && (
                        <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0" />
                      )}
                    </div>
                    <span className="block text-[11px] text-slate-300 mt-1 leading-relaxed">
                      تسویه کامل یک قرارداد در پایان دوره همراه با بازخرید مرخصی (پرسنل فعال می‌ماند و در تسویه نهایی کسر می‌شود)
                    </span>
                  </button>
                </div>

                {/* Prior without_departure settlements notice */}
                {priorWithoutDepartureForForm.length > 0 && (
                  <div className="bg-sky-950/30 border border-sky-500/35 rounded-xl p-3.5 space-y-2 text-[11px]">
                    <div className="flex items-center gap-2 font-extrabold text-sky-300">
                      <AlertCircle className="h-4 w-4 text-sky-400 shrink-0" />
                      <span>
                        سوابق تسویه حساب قرارداد (بدون ترک کار) برای این پرسنل ({toPersianDigits(priorWithoutDepartureForForm.length)} سند):
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {priorWithoutDepartureForForm.map(ps => (
                        <span
                          key={ps.id}
                          className="inline-flex items-center gap-1.5 bg-slate-950 border border-sky-500/30 rounded-lg px-2.5 py-1 text-[10.5px] text-slate-200"
                        >
                          <strong className="font-mono text-sky-300">{toPersianDigits(ps.settlementNo)}</strong>
                          <span>|</span>
                          <span className="font-mono">{toPersianDigits(ps.startDate)} تا {toPersianDigits(ps.endDate)}</span>
                          <span>|</span>
                          <span>مرخصی تسویه‌شده: <strong className="font-mono text-emerald-300">{formatHoursAsPersianHM(getSettlementUnusedLeaveHours(ps))}</strong> ساعت</span>
                        </span>
                      ))}
                    </div>
                    <p className="text-[10.5px] text-sky-300 font-medium leading-relaxed">
                      مانده مرخصی، کارکرد، عیدی و سنوات بازه‌های قبلی بدون ترک کار یک‌بار تسویه شده‌اند و در محاسبه تسویه جدید و انتقال مرخصی ماه‌های بعد به‌صورت خودکار لحاظ و کسر می‌شوند.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">انتخاب پرسنل *</label>
                    <select
                      value={formEmployeeCode}
                      disabled={isModalReadOnly}
                      onChange={e => handleEmployeeSelect(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-hidden focus:border-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="">-- انتخاب پرسنل --</option>
                      {personnelList.map(p => (
                        <option key={p.employeeCode} value={p.employeeCode}>
                          {p.fullName || `${p.firstName || ''} ${p.lastName || ''}`} (کد: {toPersianDigits(p.employeeCode)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">قرارداد کاری مرتبط</label>
                    <select
                      value={formContractId}
                      disabled={isModalReadOnly}
                      onChange={e => handleContractSelect(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-hidden focus:border-rose-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value={CURRENT_YEAR_CONTRACT_ID}>
                        کل قرارداد سال جاری ({toPersianDigits(currentYear)})
                      </option>
                      {employeeContracts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.role || 'قرارداد کاری'} ({toPersianDigits(c.contractStartDate)} الی {toPersianDigits(c.contractEndDate)})
                        </option>
                      ))}
                      <option value="">-- قرارداد پیش‌فرض پرونده پرسنلی --</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      {formSettlementType === 'without_departure'
                        ? 'وضعیت همکاری'
                        : 'علت تسویه حساب و ترک کار *'}
                    </label>
                    {formSettlementType === 'without_departure' ? (
                      <div className="bg-sky-950/30 border border-sky-500/40 rounded-lg p-2.5 text-[11px] font-bold text-sky-300 text-center">
                        اتمام قرارداد (ادامه همکاری بدون ترک کار)
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          disabled={isModalReadOnly}
                          onClick={() => handleReasonChange('contract_end')}
                          className={`py-2 px-1 text-[10.5px] font-bold rounded-lg border text-center transition-all ${
                            isModalReadOnly ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            formReason === 'contract_end' 
                              ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500' 
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                        >
                          اتمام قرارداد
                        </button>
                        <button
                          type="button"
                          disabled={isModalReadOnly}
                          onClick={() => handleReasonChange('dismissal')}
                          className={`py-2 px-1 text-[10.5px] font-bold rounded-lg border text-center transition-all ${
                            isModalReadOnly ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            formReason === 'dismissal' 
                              ? 'bg-rose-600/30 text-rose-300 border-rose-500' 
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                        >
                          اخراج
                        </button>
                        <button
                          type="button"
                          disabled={isModalReadOnly}
                          onClick={() => handleReasonChange('resignation')}
                          className={`py-2 px-1 text-[10.5px] font-bold rounded-lg border text-center transition-all ${
                            isModalReadOnly ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            formReason === 'resignation' 
                              ? 'bg-amber-600/30 text-amber-300 border-amber-500' 
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                        >
                          استعفا
                        </button>
                        <button
                          type="button"
                          disabled={isModalReadOnly}
                          onClick={() => handleReasonChange('abandonment')}
                          className={`py-2 px-1 text-[10.5px] font-bold rounded-lg border text-center transition-all ${
                            isModalReadOnly ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            formReason === 'abandonment' 
                              ? 'bg-purple-600/30 text-purple-300 border-purple-500' 
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                        >
                          ترک کار بدون استعفا
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dates Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-850">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      تاریخ شروع کارکرد (از قرارداد)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formStartDate)}
                      onChange={e => handleDateChangeAndRecalculate(toEnglishDigits(e.target.value), formEndDate)}
                      placeholder="۱۴۰۴/۰۱/۰۱"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-center text-white font-mono disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      {formSettlementType === 'without_departure'
                        ? 'تاریخ پایان قرارداد مورد تسویه *'
                        : 'تاریخ ترک کار (یک روز پس از آخرین تردد پرسنل) *'}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formEndDate)}
                      onChange={e => handleDateChangeAndRecalculate(formStartDate, toEnglishDigits(e.target.value))}
                      placeholder="۱۴۰۴/۱۲/۲۹"
                      className={`w-full bg-slate-950 border rounded-lg p-2.5 text-xs text-center text-white font-mono disabled:opacity-60 ${
                        lastDetectedAttendanceDate ? 'border-emerald-500/50 bg-emerald-950/15' : 'border-amber-500/60 bg-amber-950/20'
                      }`}
                    />
                    {lastDetectedAttendanceDate ? (() => {
                      const expectedEndDate =
                        formSettlementType === 'with_departure'
                          ? addDaysToJalali(lastDetectedAttendanceDate, 1)
                          : lastDetectedAttendanceDate;
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                          <span className="text-[10px] text-emerald-400">
                            آخرین روز تردد ثبت‌شده:{' '}
                            <strong className="font-mono">{toPersianDigits(lastDetectedAttendanceDate)}</strong>
                            {formSettlementType === 'with_departure' && (
                              <>
                                {' '}| ترک کار:{' '}
                                <strong className="font-mono text-sky-300">{toPersianDigits(expectedEndDate)}</strong>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })() : (
                      <span className="text-[10px] text-amber-400 mt-1 block">
                        {formSettlementType === 'without_departure'
                          ? 'تاریخ دقیق پایان قرارداد مورد تسویه را وارد کنید.'
                          : 'تردد ثبت‌شده‌ای یافت نشد؛ تاریخ ترک کار (یک روز پس از آخرین روز حضور) را وارد کنید.'}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">تاریخ صدور برگه تسویه</label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formSettlementDate)}
                      onChange={e => setFormSettlementDate(toEnglishDigits(e.target.value))}
                      placeholder={toPersianDigits(getTodayJalali())}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-center text-white font-mono disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Profile Snapshot Banner */}
                {selectedPersonnel && (
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between text-[11px] gap-2">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="font-bold text-white">{selectedPersonnel.fullName || `${selectedPersonnel.firstName} ${selectedPersonnel.lastName}`}</span>
                        <span>|</span>
                        <span>کد ملی: <strong className="font-mono text-slate-200">{toPersianDigits(selectedPersonnel.nationalId || '-')}</strong></span>
                        <span>|</span>
                        <span>شماره بیمه: <strong className="font-mono text-slate-200">{toPersianDigits(selectedPersonnel.insuranceCode || '-')}</strong></span>
                        <span>|</span>
                        <span>وضعیت تاهل: <strong className="text-emerald-300">{selectedPersonnel.maritalStatus || (selectedPersonnel.isMarried ? 'متاهل' : 'مجرد')}</strong></span>
                        <span>|</span>
                        <span>تعداد فرزندان: <strong className="font-mono text-slate-200">{toPersianDigits(selectedPersonnel.childrenCount || (selectedPersonnel.childrenList?.length || 0))}</strong></span>
                      </div>
                      {!isModalReadOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            const isCY = formContractId === CURRENT_YEAR_CONTRACT_ID;
                            const generated = generateMonthsList(
                              formStartDate,
                              formEndDate,
                              selectedPersonnel,
                              isCY ? undefined : selectedContract,
                              isCY,
                              currentYear,
                              formSettlementType,
                              editingId
                            );
                            setFormMonthlyDetails(generated);
                            setFormPayrollSyncedAt(generated.some(m => m.syncedFromPayroll) ? getTodayJalali() : '');
                          }}
                          className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 rounded-md border border-rose-500/30 text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          بازسازی ماه‌های کارکرد بر اساس تاریخ‌ها
                        </button>
                      )}
                    </div>

                    {/* Last Attendance Announcement Banner */}
                    {lastDetectedAttendanceDate ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-950/30 border border-emerald-500/35 rounded-lg px-3 py-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-2 text-emerald-200">
                          <Calendar className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>
                            آخرین روز تردد ثبت‌شده پرسنل:{' '}
                            <strong className="font-mono text-white text-xs">{toPersianDigits(lastDetectedAttendanceDate)}</strong>
                          </span>
                          {formSettlementType === 'with_departure' && (
                            <>
                              <span className="text-emerald-500">|</span>
                              <span>
                                تاریخ ترک کار در سیستم (یک روز پس از آخرین تردد):{' '}
                                <strong className="font-mono text-sky-300 text-xs">
                                  {toPersianDigits(formEndDate || addDaysToJalali(lastDetectedAttendanceDate, 1))}
                                </strong>
                              </span>
                            </>
                          )}
                        </div>
                        <span className="text-[10.5px] text-emerald-300 font-medium">
                          ثبت ترک کار با یک روز فاصله باعث می‌شود کارکرد روز آخر در محاسبات کسر نشود.
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-amber-950/25 border border-amber-500/30 rounded-lg px-3 py-1.5 text-[10.5px] text-amber-300 font-medium">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span>
                          برای این پرسنل در دوره جاری تردد ثبت‌شده‌ای یافت نشد؛ در صورت وجود تاریخ ترک کار، آن را یک روز پس از آخرین روز کاری وارد فرمایید.
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-850/80 text-[11px]">
                      <div className="flex items-center gap-1.5 bg-amber-950/40 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg">
                        <Clock className="h-3.5 w-3.5 text-amber-400" />
                        <span>نرخ ساعتی اضافه‌کار و تعطیل‌کاری ثوابت سال تسویه حساب ({toPersianDigits(settlementYear)} - مبنای ۸ ساعت):</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(settlementOvertimeHourlyRate))}</strong>
                        <span className="text-[10px] text-amber-300 font-bold">ریال/ساعت</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-sky-950/40 text-sky-300 border border-sky-500/30 px-2.5 py-1 rounded-lg">
                        <span>بن خواربار ماهانه:</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(contractSalaryRate?.foodAllowance || 0))}</strong>
                        <span className="text-[10px] text-sky-300 font-bold">ریال</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                        <span>حق مسکن ماهانه:</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(contractSalaryRate?.housingAllowance || 0))}</strong>
                        <span className="text-[10px] text-emerald-300 font-bold">ریال</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: MONTHLY BREAKDOWN TABLE (READ-ONLY SYNCED WITH PAYROLL LISTS) */}
              <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-850 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-extrabold text-white text-sm flex items-center gap-2 flex-wrap">
                      <Calendar className="h-4 w-4 text-emerald-400" />
                      <span>مرحله ۲: اقلام حقوق و دستمزد ماه به ماه (مطابق با لیست‌های حقوق)</span>
                      {payrollIntegrationInsights.syncedMonthsCount > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {toPersianDigits(payrollIntegrationInsights.syncedMonthsCount)} ماه همگام‌سازی‌شده
                          {payrollIntegrationInsights.lockedMonthsCount > 0 && ` (${toPersianDigits(payrollIntegrationInsights.lockedMonthsCount)} ثبت‌شده)`}
                          {payrollIntegrationInsights.liveMonthsCount > 0 && ` (${toPersianDigits(payrollIntegrationInsights.liveMonthsCount)} تردد زنده)`}
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      اطلاعات حقوق و دستمزد ماه‌های مختلف مطابق با لیست‌های حقوق و تردد نمایش داده می‌شود؛ مبالغ عیدی و حق سنوات پایان خدمت از ناخالص و خالص ماهانه کسر شده و به صورت تفکیکی در بخش مزایای پایان خدمت محاسبه می‌گردد.
                    </p>
                  </div>

                  {!isModalReadOnly && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSyncFromPayroll}
                        className="px-3 py-1.5 bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 rounded-lg text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1.5 border border-emerald-500/40"
                        title="به‌روزرسانی کارکرد، حقوق، کسورات و مانده مرخصی از لیست‌های حقوق و تردد"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                        همگام‌سازی از حقوق و دستمزد
                      </button>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-right text-[11px] border-collapse">
                    <thead className="bg-slate-950 text-slate-300 border-b border-slate-800 font-bold whitespace-nowrap">
                      <tr>
                        <th className="p-2">ماه</th>
                        <th className="p-2 text-center">کارکرد</th>
                        <th className="p-2 text-center">مرخصی استفاده شده (ساعت)</th>
                        <th className="p-2 text-left">حقوق پایه</th>
                        <th className="p-2 text-left">بن خواربار</th>
                        <th className="p-2 text-left">حق مسکن</th>
                        <th className="p-2 text-left">حق اولاد</th>
                        <th className="p-2 text-left">حق تاهل</th>
                        <th className="p-2 text-left">سایر مزایا</th>
                        <th className="p-2 text-center">اضافه‌کار (ساعت / مبلغ)</th>
                        <th className="p-2 text-center">جمعه‌کاری (ساعت / مبلغ)</th>
                        <th className="p-2 text-center">تعطیل‌کاری (ساعت / مبلغ)</th>
                        <th className="p-2 text-left text-amber-300">ناخالص ماه</th>
                        <th className="p-2 text-left text-sky-400">مشمول بیمه</th>
                        <th className="p-2 text-left text-rose-400">بیمه ۷٪</th>
                        <th className="p-2 text-left text-rose-300">مالیات و تکمیلی</th>
                        <th className="p-2 text-left text-emerald-400">خالص ماه</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 bg-slate-950/40">
                      {formMonthlyDetails.map((m, idx) => {
                        const otherBenefits =
                          (m.seniorityBase || 0) +
                          (m.jobAllowance || 0);
                        const taxAndSupp = (m.payrollTax || 0) + (m.supplementaryInsurance || 0);
                        return (
                          <tr
                            key={idx}
                            className={m.alreadySettledInPrior ? 'bg-slate-900/60 opacity-60' : 'hover:bg-slate-900/30'}
                          >
                            <td className="p-2 font-bold text-white whitespace-nowrap">
                              {toPersianDigits(m.monthName)}
                              <span className="block text-[9px] text-slate-400 font-normal">
                                طول: {toPersianDigits(m.totalDaysInMonth)} روز
                              </span>
                              {m.alreadySettledInPrior ? (
                                <span
                                  className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[8.5px] font-bold border bg-amber-500/15 text-amber-300 border-amber-500/30"
                                  title="این ماه قبلاً در سند تسویه بدون ترک کار تسویه شده و در جمع کل محاسبه نمی‌شود"
                                >
                                  تسویه‌شده قبلی ({toPersianDigits(m.priorSettlementNo || '')})
                                </span>
                              ) : (
                                <span
                                  className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[8.5px] font-bold border ${
                                    m.payrollSourceType === 'locked_payroll'
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : m.payrollSourceType === 'live_attendance'
                                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                      : m.workedDays === 0
                                      ? 'bg-slate-900 text-slate-500 border-slate-800'
                                      : 'bg-slate-800 text-slate-400 border-slate-700'
                                  }`}
                                >
                                  {m.payrollSourceType === 'locked_payroll'
                                    ? 'حقوق ثبت‌شده'
                                    : m.payrollSourceType === 'live_attendance'
                                    ? 'کارکرد تردد'
                                    : m.workedDays === 0
                                    ? 'بدون کارکرد'
                                    : 'قرارداد'}
                                </span>
                              )}
                            </td>

                            <td className="p-2 text-center font-mono font-bold text-white">
                              {toPersianDigits(m.workedDays)}
                            </td>

                            <td
                              className="p-2 text-center font-mono text-sky-300 whitespace-nowrap"
                              title={`${formatPersianHoursValue(getMonthlyUsedLeaveHours(m))} ساعت`}
                            >
                              {formatMinutesToPersianHM(getMonthlyUsedLeaveMinutes(m))}
                            </td>

                            <td className="p-2 text-left font-mono text-slate-200 whitespace-nowrap">
                              {formatWithCommas(m.baseSalary)}
                            </td>

                            <td className="p-2 text-left font-mono text-slate-200 whitespace-nowrap">
                              {formatWithCommas(m.foodAllowance)}
                            </td>

                            <td className="p-2 text-left font-mono text-slate-200 whitespace-nowrap">
                              {formatWithCommas(m.housingAllowance)}
                            </td>

                            <td className="p-2 text-left font-mono text-slate-200 whitespace-nowrap">
                              {formatWithCommas(m.childAllowance)}
                            </td>

                            <td className="p-2 text-left font-mono text-slate-200 whitespace-nowrap">
                              {formatWithCommas(m.marriageAllowance)}
                            </td>

                            <td
                              className="p-2 text-left font-mono text-slate-300 whitespace-nowrap"
                              title={`پایه سنوات: ${formatWithCommas(m.seniorityBase || 0)} | حق شغل: ${formatWithCommas(m.jobAllowance || 0)}`}
                            >
                              {formatWithCommas(otherBenefits)}
                            </td>

                            <td className="p-2 text-center font-mono whitespace-nowrap">
                              <div className="flex flex-col items-center">
                                <span className="text-[10px] text-amber-300 font-bold">
                                  {toPersianDigits(m.overtimeHours || 0)} س
                                </span>
                                <span className="text-slate-200">{formatWithCommas(m.overtimeAmount)}</span>
                              </div>
                            </td>

                            <td className="p-2 text-center font-mono whitespace-nowrap">
                              <div className="flex flex-col items-center">
                                <span className="text-[10px] text-amber-300 font-bold">
                                  {toPersianDigits(m.fridayWorkHours || 0)} س
                                </span>
                                <span className="text-slate-200">{formatWithCommas(m.fridayWorkAmount)}</span>
                              </div>
                            </td>

                            <td className="p-2 text-center font-mono whitespace-nowrap">
                              <div className="flex flex-col items-center">
                                <span className="text-[10px] text-amber-300 font-bold">
                                  {toPersianDigits(m.holidayWorkHours || 0)} س
                                </span>
                                <span className="text-slate-200">{formatWithCommas(m.holidayWorkAmount)}</span>
                              </div>
                            </td>

                            <td className="p-2 text-left font-mono font-bold text-amber-300 whitespace-nowrap">
                              {formatWithCommas(m.grossSalary)}
                            </td>

                            <td className="p-2 text-left font-mono font-bold text-sky-300 whitespace-nowrap">
                              {formatWithCommas(m.insurableGross || 0)}
                            </td>

                            <td className="p-2 text-left font-mono font-bold text-rose-400 whitespace-nowrap">
                              {formatWithCommas(m.workerInsuranceShare)}
                            </td>

                            <td
                              className="p-2 text-left font-mono text-rose-300 whitespace-nowrap"
                              title={`مالیات: ${formatWithCommas(m.payrollTax || 0)} | بیمه تکمیلی: ${formatWithCommas(m.supplementaryInsurance || 0)}`}
                            >
                              {formatWithCommas(taxAndSupp)}
                            </td>

                            <td className="p-2 text-left font-mono font-black text-emerald-400 whitespace-nowrap">
                              {formatWithCommas(m.netSalaryPayable)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-950 font-bold border-t border-slate-800 text-slate-300">
                      <tr>
                        <td className="p-2 whitespace-nowrap">مجموع ({toPersianDigits(formMonthlyDetails.length)} ماه)</td>
                        <td className="p-2 text-center text-white font-mono">{toPersianDigits(settlementSummary.totalWorkedDays)}</td>
                        <td
                          className="p-2 text-center text-white font-mono whitespace-nowrap"
                          title={`${formatPersianHoursValue(settlementSummary.totalUsedLeaveHours)} ساعت`}
                        >
                          {formatMinutesToPersianHM(settlementSummary.totalUsedLeaveMinutes)}
                        </td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalBaseSalaries)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalFoodAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalHousingAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalChildAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalMarriageAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalOtherAllowances)}</td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex flex-col items-center text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10">
                              {toPersianDigits(settlementSummary.totalOvertimeHours)} س
                            </span>
                            <span className="text-white">{formatWithCommas(settlementSummary.totalOvertimeAmounts)}</span>
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex flex-col items-center text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10">
                              {toPersianDigits(settlementSummary.totalFridayWorkHours)} س
                            </span>
                            <span className="text-white">{formatWithCommas(settlementSummary.totalFridayWorkAmounts)}</span>
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex flex-col items-center text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10">
                              {toPersianDigits(settlementSummary.totalHolidayWorkHours)} س
                            </span>
                            <span className="text-white">{formatWithCommas(settlementSummary.totalHolidayWorkAmounts)}</span>
                          </div>
                        </td>
                        <td className="p-2 text-left font-mono text-amber-300 font-black">{formatWithCommas(settlementSummary.totalGrossSalaries)}</td>
                        <td className="p-2 text-left font-mono text-sky-400 font-bold">{formatWithCommas(settlementSummary.totalInsurableGross)}</td>
                        <td className="p-2 text-left font-mono text-rose-400 font-bold">{formatWithCommas(settlementSummary.totalWorkerInsurance)}</td>
                        <td className="p-2 text-left font-mono text-rose-300 font-bold">{formatWithCommas(settlementSummary.totalTaxAndSupp)}</td>
                        <td className="p-2 text-left font-mono text-emerald-400 font-black">{formatWithCommas(settlementSummary.totalNetSalaries)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {departureUnpaidLeaveInfo && (
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-950/35 border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-xs text-amber-300">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>
                        پرسنل در ماه ترک کار تعداد{' '}
                        <strong className="text-white font-mono text-sm">
                          {toPersianDigits(String(departureUnpaidLeaveInfo.unpaidDays).replace('.', '٫'))}
                        </strong>{' '}
                        روز مرخصی بدون حقوق داشته است.
                      </span>
                    </div>
                    <span className="text-[11px] text-amber-300 font-bold font-mono">
                      (روزهای ماه تا تاریخ ترک کار: {toPersianDigits(departureUnpaidLeaveInfo.calendarDaysToDeparture)} روز | روز کارکرد ثبت‌شده: {toPersianDigits(departureUnpaidLeaveInfo.workedDays)} روز)
                    </span>
                  </div>
                )}
              </div>

              {/* SECTION 3: END OF SERVICE BENEFITS (عیدی، سنوات، مانده مرخصی) */}
              {/* Daily Wage for End-of-Service Calculations */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-200 block">
                    مزد روزانه مبنای محاسبات مزایای پایان خدمت (سنوات، عیدی، بازخرید مرخصی):
                  </label>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    به طور پیش‌فرض بر مبنای آخرین ماه کارکرد ({formatWithCommas(settlementSummary.defaultLastDailySalary)} ریال) محاسبه شده و کاملاً قابل اصلاح دستی است.
                  </span>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-750 focus-within:border-rose-500 rounded-lg px-2.5 py-1.5">
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formDailySalaryOverride !== '' ? formDailySalaryOverride : formatWithCommas(settlementSummary.defaultLastDailySalary))}
                      onChange={e => setFormDailySalaryOverride(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-28 bg-transparent text-xs text-white font-mono font-bold text-left focus:outline-hidden disabled:opacity-70"
                      title="مزد روزانه مبنا برای سنوات، عیدی و بازخرید مرخصی"
                    />
                    <span className="text-[11px] text-slate-400">ریال</span>
                  </div>
                  {!isModalReadOnly && formDailySalaryOverride !== '' && (
                    <button
                      type="button"
                      onClick={() => setFormDailySalaryOverride('')}
                      className="text-[10px] text-rose-400 hover:text-rose-300 p-1.5 bg-rose-500/10 rounded-lg border border-rose-500/30 flex items-center gap-1 cursor-pointer transition-colors"
                      title="بازنشانی به مزد پیش‌فرض"
                    >
                      <RotateCcw className="h-3 w-3" />
                      بازنشانی
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* السنوات */}
                <div className="bg-slate-900/70 p-4 rounded-xl border border-sky-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-sky-400 text-xs flex items-center gap-1.5">
                      <Briefcase className="h-4 w-4" />
                      حق سنوات پایان خدمت (ماده ۲۴)
                    </h5>
                    <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full">
                      یک ماه به ازای سال
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    فرمول: (آخرین حقوق پایه ماهانه × کارکرد کل قرارداد {toPersianDigits(settlementSummary.totalWorkedDays)} روز) / ۳۶۵
                  </p>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">مبلغ حق سنوات (ریال):</span>
                      {!isModalReadOnly && formSeveranceAmount !== '' && (
                        <button
                          type="button"
                          onClick={() => setFormSeveranceAmount('')}
                          className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                          title="بازنشانی به فرمول قانونی"
                        >
                          <RotateCcw className="h-3 w-3" />
                          فرمول قانونی ({formatWithCommas(settlementSummary.defaultSeveranceAmount)})
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formSeveranceAmount !== '' ? formSeveranceAmount : formatWithCommas(settlementSummary.defaultSeveranceAmount))}
                      onChange={e => setFormSeveranceAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-750 focus:border-sky-500 rounded px-2.5 py-1.5 text-xs text-sky-300 font-mono font-black text-left disabled:opacity-70"
                    />
                  </div>
                </div>

                {/* عیدی و پاداش */}
                <div className="bg-slate-900/70 p-4 rounded-xl border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4" />
                      عیدی و پاداش پایان کار
                    </h5>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">
                      کارکرد کل قرارداد
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    فرمول: (حقوق پایه ماهانه × ۲ × کارکرد کل قرارداد {toPersianDigits(settlementSummary.totalWorkedDays)} روز) / ۳۶۵
                  </p>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">مبلغ عیدی و پاداش (ریال):</span>
                      {!isModalReadOnly && formBonusAmount !== '' && (
                        <button
                          type="button"
                          onClick={() => setFormBonusAmount('')}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                          title="بازنشانی به فرمول قانونی"
                        >
                          <RotateCcw className="h-3 w-3" />
                          فرمول قانونی ({formatWithCommas(settlementSummary.defaultBonusAmount)})
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formBonusAmount !== '' ? formBonusAmount : formatWithCommas(settlementSummary.defaultBonusAmount))}
                      onChange={e => setFormBonusAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-750 focus:border-emerald-500 rounded px-2.5 py-1.5 text-xs text-emerald-300 font-mono font-black text-left disabled:opacity-70"
                    />
                  </div>
                </div>

                {/* مانده مرخصی */}
                <div className="bg-slate-900/70 p-4 rounded-xl border border-indigo-500/30 space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <h5 className="font-bold text-indigo-400 text-xs flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      بازخرید مانده مرخصی (ماده ۶۴ و ۷۱)
                    </h5>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        settlementSummary.hasPayrollLeaveBalance
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 font-bold'
                          : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                      }`}
                    >
                      {settlementSummary.hasPayrollLeaveBalance
                        ? 'متصل به تردد حقوق (ساعتی)'
                        : `${formatMinutesToPersianHM(settlementSummary.monthlyLeaveMinutes)} ساعت در ماه`}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex flex-wrap justify-between gap-1">
                    {settlementSummary.hasPayrollLeaveBalance ? (
                      <>
                        <span>
                          مانده مرخصی حقوق:{' '}
                          <strong className="text-emerald-300 font-mono">
                            {formatMinutesToPersianHM(settlementSummary.payrollRemainingLeaveMinutes || 0)}
                          </strong>{' '}
                          ساعت
                        </span>
                        <span className="text-slate-500">
                          فرمول: {formatMinutesToPersianHM(settlementSummary.formulaUnusedLeaveMinutes)} ساعت
                        </span>
                      </>
                    ) : (
                      <>
                        <span>کل استحقاقی: <strong className="text-white font-mono">{formatMinutesToPersianHM(settlementSummary.totalEntitledLeaveMinutes)}</strong> ساعت</span>
                        <span>استفاده شده: <strong className="text-white font-mono">{formatMinutesToPersianHM(settlementSummary.totalUsedLeaveMinutes)}</strong> ساعت</span>
                        <span>مانده: <strong className="text-indigo-300 font-mono font-bold">{formatMinutesToPersianHM(settlementSummary.unusedLeaveMinutes)}</strong> ساعت</span>
                      </>
                    )}
                    <span className="text-indigo-300 font-medium w-full">
                      نرخ هر ساعت بازخرید (جمع آیتم‌های مشمول ÷ ۲۲۰):{' '}
                      <strong className="font-mono text-white">
                        {formatWithCommas(Math.round(settlementSummary.leaveHourlyRate))}
                      </strong>{' '}
                      ریال
                    </span>
                    {settlementSummary.sameMonthPriorSettledLeaveMinutes > 0 && (
                      <span className="text-amber-300 w-full">
                        کسر مرخصی تسویه‌شده قبلی در این ماه: <strong className="font-mono">{formatMinutesToPersianHM(settlementSummary.sameMonthPriorSettledLeaveMinutes)}</strong> ساعت
                      </span>
                    )}
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 text-[10px] block mb-1">مانده مرخصی (ساعت:دقیقه):</span>
                        <input
                          type="text"
                          inputMode="text"
                          dir="ltr"
                          placeholder="۰۰:۰۰"
                          disabled={isModalReadOnly}
                          value={toPersianDigits(
                            formUnusedLeaveHours !== ''
                              ? formUnusedLeaveHours
                              : formatMinutesToEnglishHM(settlementSummary.defaultUnusedLeaveMinutes)
                          )}
                          onChange={e => {
                            const rawEng = toEnglishDigits(e.target.value).replace(/[^0-9:]/g, '');
                            const firstColon = rawEng.indexOf(':');
                            const cleaned =
                              firstColon === -1
                                ? rawEng
                                : rawEng.slice(0, firstColon + 1) + rawEng.slice(firstColon + 1).replace(/:/g, '').slice(0, 2);
                            setFormUnusedLeaveHours(cleaned);
                            const parsedMins = parseLeaveHMToMinutes(cleaned) ?? 0;
                            setFormUnusedLeaveAmount(
                              formatWithCommas(Math.round((parsedMins / 60) * settlementSummary.leaveHourlyRate))
                            );
                          }}
                          onBlur={() => {
                            if (formUnusedLeaveHours !== '') {
                              const parsedMins = parseLeaveHMToMinutes(formUnusedLeaveHours) ?? 0;
                              setFormUnusedLeaveHours(formatMinutesToEnglishHM(parsedMins));
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-750 focus:border-indigo-500 rounded px-2 py-1 text-xs text-indigo-300 font-mono font-bold text-center disabled:opacity-70"
                        />
                        <span className="text-[9.5px] text-slate-400 block text-center mt-0.5 font-mono">
                          فرمت ساعت:دقیقه (مثلاً ۱۵:۵۳)
                        </span>
                      </div>
                      <div className="relative group">
                        <span className="text-slate-400 text-[10px] flex items-center gap-1 mb-1 cursor-help">
                          <span>مبلغ بازخرید (ریال):</span>
                          <HelpCircle className="h-3 w-3 text-indigo-400 shrink-0" />
                        </span>
                        <input
                          type="text"
                          dir="ltr"
                          disabled={isModalReadOnly}
                          value={toPersianDigits(formUnusedLeaveAmount !== '' ? formUnusedLeaveAmount : formatWithCommas(settlementSummary.defaultUnusedLeaveAmount))}
                          onChange={e => setFormUnusedLeaveAmount(formatWithCommas(parseNumber(e.target.value)))}
                          className="w-full bg-slate-950 border border-slate-750 focus:border-indigo-500 rounded px-2 py-1 text-xs text-indigo-300 font-mono font-black text-left disabled:opacity-70"
                        />
                        {/* Tooltip نمایش جزئیات روش محاسبه بازخرید مرخصی */}
                        <div
                          role="tooltip"
                          className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all duration-150 absolute bottom-full left-0 mb-2 z-50 w-80 max-w-[90vw] bg-slate-950 border border-indigo-400/50 rounded-xl shadow-2xl p-3 text-right space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                            <span className="text-[11px] font-black text-indigo-300">
                              روش محاسبه مبلغ بازخرید مرخصی
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-bold">
                              {settlementSummary.isLeaveBuyoutCustomConfigured ? 'طبق قوانین ثبت‌شده' : 'پیش‌فرض قانونی'}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[9.5px] text-slate-400 font-bold">
                              اقلام مشمول ماهانه (مبنای ۳۰ روز آخرین قرارداد/پرونده):
                            </div>
                            {settlementSummary.leaveBuyoutBreakdown.map(item => (
                              <div key={item.key} className="flex items-center justify-between text-[10px] gap-2">
                                <span className="text-slate-300">{item.label}</span>
                                <span className="font-mono text-white font-bold whitespace-nowrap">
                                  {formatWithCommas(item.amount)} ریال
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="border-t border-slate-800 pt-1.5 space-y-1 text-[10px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-300 font-bold">جمع آیتم‌های مشمول:</span>
                              <span className="font-mono text-emerald-300 font-black whitespace-nowrap">
                                {formatWithCommas(settlementSummary.leaveBuyoutBaseMonthlySum)} ریال
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-300">نرخ هر ساعت (جمع ÷ ۲۲۰ ساعت):</span>
                              <span className="font-mono text-sky-300 font-bold whitespace-nowrap">
                                {formatWithCommas(Math.round(settlementSummary.leaveHourlyRate))} ریال
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 bg-indigo-500/15 border border-indigo-500/30 rounded-lg px-2 py-1 mt-1">
                              <span className="text-indigo-200 font-bold">
                                نرخ ساعتی × {formatMinutesToPersianHM(settlementSummary.unusedLeaveMinutes)} ساعت:
                              </span>
                              <span className="font-mono text-indigo-200 font-black whitespace-nowrap">
                                {formatWithCommas(settlementSummary.defaultUnusedLeaveAmount)} ریال
                              </span>
                            </div>
                            {formUnusedLeaveAmount !== '' && (
                              <div className="text-[9.5px] text-amber-300 pt-0.5">
                                توجه: مقدار فعلی فیلد ({formatWithCommas(settlementSummary.unusedLeaveAmount)} ریال) به صورت دستی اصلاح شده است.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {!isModalReadOnly && (formUnusedLeaveHours !== '' || formUnusedLeaveAmount !== '') && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormUnusedLeaveHours('');
                          setFormUnusedLeaveAmount('');
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        بازنشانی به مقدار محاسبه‌شده ({formatMinutesToPersianHM(settlementSummary.defaultUnusedLeaveMinutes)} ساعت - {formatWithCommas(settlementSummary.defaultUnusedLeaveAmount)} ریال)
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 4: PREVIOUS YEAR RECEIVABLE, DEDUCTIONS & EMPLOYER PAYMENTS */}
              <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-850 space-y-4">
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-amber-400" />
                  مرحله ۳: طلب حساب از قبل (مانده سال قبل)، کسورات و پرداختی‌های کارفرما
                </h4>

                {/* طلب حساب از قبل (مانده بستانکاری سال قبل) */}
                <div className="bg-teal-950/25 border border-teal-500/30 rounded-xl p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-teal-300 flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4 text-teal-400" />
                      طلب حساب از قبل پرسنل (مانده بستانکاری منتقل‌شده از سال / دوره قبل)
                    </span>
                    <span className="text-[10px] text-teal-300 font-bold bg-teal-500/15 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                      افزوده می‌شود به جمع مطالبات تسویه (+)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1 text-[11px]">
                        مبلغ طلب از قبل (ریال)
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        disabled={isModalReadOnly}
                        value={toPersianDigits(formPreviousYearReceivableAmount)}
                        onChange={e => setFormPreviousYearReceivableAmount(formatWithCommas(parseNumber(e.target.value)))}
                        className="w-full bg-slate-950 border border-teal-500/40 focus:border-teal-400 rounded-lg p-2.5 text-xs text-teal-300 font-mono font-bold disabled:opacity-70"
                        placeholder="۰"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-slate-300 font-bold mb-1 text-[11px]">
                        شرح و بابت طلب سال قبل
                      </label>
                      <input
                        type="text"
                        disabled={isModalReadOnly}
                        value={formPreviousYearReceivableDescription}
                        onChange={e => setFormPreviousYearReceivableDescription(e.target.value)}
                        placeholder="مثال: مانده طلب حقوق معوقه سال ۱۴۰۴ / مانده تسویه حساب دوره قبل پرسنل..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-teal-400 rounded-lg p-2.5 text-xs text-white disabled:opacity-70"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      خرید طی دوره پرسنل (ریال)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formPurchasesAmount)}
                      onChange={e => setFormPurchasesAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono disabled:opacity-70"
                      placeholder="۰"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      خرید شیرینی، نان یا اقلام کارگاه در طول دوره
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      میزان سایر کسورات (ریال)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formOtherDeductionsAmount)}
                      onChange={e => setFormOtherDeductionsAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono disabled:opacity-70"
                      placeholder="۰"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      وام، خسارت، جریمه یا سایر بدهی‌ها
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      مبالغ پرداخت شده توسط کارفرما (ریال)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      disabled={isModalReadOnly}
                      value={toPersianDigits(formEmployerPaidAmount)}
                      onChange={e => setFormEmployerPaidAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono disabled:opacity-70"
                      placeholder="۰"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      مساعده‌ها، پیش‌پرداخت تسویه یا حقوق‌های پرداخت شده
                    </span>
                    {!isModalReadOnly && (payrollIntegrationInsights.treasurySummary.totalPaid > 0 ||
                      payrollIntegrationInsights.registeredPayrollsSummary.totalAllMonthsNet > 0) && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {payrollIntegrationInsights.treasurySummary.totalPaid > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setFormEmployerPaidAmount(formatWithCommas(payrollIntegrationInsights.treasurySummary.totalPaid))
                            }
                            className="px-2 py-0.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded text-[10px] font-bold cursor-pointer transition-colors"
                            title={`مساعده: ${formatWithCommas(payrollIntegrationInsights.treasurySummary.advancesTotal)} | حقوق: ${formatWithCommas(payrollIntegrationInsights.treasurySummary.salaryPaidTotal)}`}
                          >
                            درج از خزانه‌داری: {formatWithCommas(payrollIntegrationInsights.treasurySummary.totalPaid)} ریال
                          </button>
                        )}
                        {payrollIntegrationInsights.registeredPayrollsSummary.totalPriorMonthsNet > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setFormEmployerPaidAmount(
                                formatWithCommas(payrollIntegrationInsights.registeredPayrollsSummary.totalPriorMonthsNet)
                              )
                            }
                            className="px-2 py-0.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 rounded text-[10px] font-bold cursor-pointer transition-colors"
                            title="جمع خالص فیش‌های ثبت‌شده ماه‌های قبل (به‌جز ماه آخر تسویه)"
                          >
                            حقوق ماه‌های قبل: {formatWithCommas(payrollIntegrationInsights.registeredPayrollsSummary.totalPriorMonthsNet)} ریال
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    توضیحات و مشخص کردن علت کسورات *
                  </label>
                  <input
                    type="text"
                    disabled={isModalReadOnly}
                    value={formOtherDeductionsDescription}
                    onChange={e => setFormOtherDeductionsDescription(e.target.value)}
                    placeholder="مثال: کسر بابت قسط وام قرض‌الحسنه و مانده فاکتور خرید فروردین و اردیبهشت..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:border-rose-500 disabled:opacity-70"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">وضعیت سند تسویه</label>
                    <select
                      disabled={isModalReadOnly}
                      value={formStatus}
                      onChange={e => setFormStatus(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white disabled:opacity-70"
                    >
                      <option value="finalized">قطعی شده (آماده پرداخت و امضا)</option>
                      <option value="paid">پرداخت شده و تسویه کامل</option>
                      <option value="draft">پیش‌نویس</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1">یادداشت‌های داخلی</label>
                    <input
                      type="text"
                      disabled={isModalReadOnly}
                      value={formNotes}
                      onChange={e => setFormNotes(e.target.value)}
                      placeholder="توضیحات تکمیلی پرونده تسویه حساب..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white disabled:opacity-70"
                    />
                  </div>
                </div>
              </div>

              {/* FINAL SUMMARY CARD */}
              <div className="bg-rose-950/25 p-5 rounded-2xl border-2 border-rose-500/40 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-rose-300 font-extrabold block">خلاصه حساب تسویه نهایی:</span>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-200 mt-1.5">
                      <span>کل مطالبات: <strong className="text-white">{formatWithCommas(settlementSummary.totalGrossPayable)}</strong></span>
                      {settlementSummary.previousYearReceivable > 0 && (
                        <span className="text-teal-300 font-bold">(شامل {formatWithCommas(settlementSummary.previousYearReceivable)} طلب از قبل)</span>
                      )}
                      <span>-</span>
                      <span>کل کسورات: <strong className="text-rose-400">{formatWithCommas(settlementSummary.totalDeductions)}</strong></span>
                      <span>-</span>
                      <span>پرداختی قبلی کارفرما: <strong className="text-amber-400">{formatWithCommas(settlementSummary.employerPaid)}</strong></span>
                    </div>
                  </div>

                  <div className="text-left">
                    <span className="text-[11px] text-slate-300 font-bold block">مانده قابل پرداخت به پرسنل:</span>
                    <span className="text-2xl font-black text-rose-400 font-mono">
                      {formatWithCommas(settlementSummary.finalNetPayable)} <span className="text-xs text-slate-200 font-sans">ریال</span>
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-200 flex items-center gap-2">
                  <span className="text-rose-400 font-bold">معادل حروفی:</span>
                  <span className="text-white font-bold">{numberToWordsPersian(settlementSummary.finalNetPayable)} ریال</span>
                </div>
              </div>
            </div>

            {/* Form Footer */}
            <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-bold text-slate-200 rounded-xl transition-colors cursor-pointer border border-slate-700"
              >
                {isModalReadOnly ? 'بازگشت به لیست' : 'انصراف و بازگشت'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviewCurrentDraft}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-bold text-sky-400 hover:text-sky-300 rounded-xl transition-all border border-slate-700 flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="مشاهده پیش‌نمایش برگه چاپی رسمی با ارقام فعلی"
                >
                  <Eye className="h-4 w-4" />
                  پیش‌نمایش فرم چاپی
                </button>

                {!isModalReadOnly && (
                  <button
                    type="button"
                    onClick={handleSaveSettlement}
                    className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-xs font-black text-white rounded-xl transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer border border-rose-500/40"
                  >
                    <Check className="h-4 w-4" />
                    ثبت و ذخیره سند تسویه حساب
                  </button>
                )}
              </div>
            </div>
        </div>
      )}
      </div>

      {/* ======================================================== */}
      {/* HIGH-FIDELITY OFFICIAL SETTLEMENT DOCUMENT (A4 FORM & PREVIEW) */}
      {/* ======================================================== */}
      {printingSettlement && typeof document !== 'undefined' && createPortal((() => {
        const s = normalizeSettlementForDisplay(printingSettlement);
        const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
        const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
        const reasonText = s.reason === 'contract_end' 
          ? 'اتمام مدت قرارداد کار' 
          : s.reason === 'dismissal' 
            ? 'اخراج / فسخ قرارداد' 
            : s.reason === 'abandonment'
              ? 'ترک کار بدون استعفا'
              : 'استعفای کتبی کارگر';
        const printUnpaidLeaveInfo = getDepartureMonthUnpaidLeaveInfo(
          s.settlementType,
          s.startDate,
          s.endDate,
          s.monthlyDetails
        );
        const normSStart = s.startDate
          ? normalizeJalaliDate(toEnglishDigits(s.startDate)) || toEnglishDigits(s.startDate)
          : '';
        const normSEnd = s.endDate
          ? normalizeJalaliDate(toEnglishDigits(s.endDate)) || toEnglishDigits(s.endDate)
          : '';
        let waiverLastAttendanceDate = s.endDate;
        if ((s.settlementType || 'with_departure') !== 'without_departure') {
          const effYM = parseEffectiveDepartureLastWorkYM(s.endDate);
          const detectedMonth = findLastAttendanceDateForEmployee(
            db,
            emp,
            activePeriodId,
            effYM?.year,
            effYM?.month
          );
          const detectedAny = detectedMonth || findLastAttendanceDateForEmployee(db, emp, activePeriodId);
          if (detectedAny && (!normSEnd || detectedAny <= normSEnd)) {
            waiverLastAttendanceDate = detectedAny;
          } else if (normSEnd && (!normSStart || normSEnd > normSStart)) {
            waiverLastAttendanceDate = addDaysToJalali(normSEnd, -1);
          }
        }

        return (
          <div 
            id="settlement-print-portal"
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex flex-col items-center justify-start p-2 sm:p-4 overflow-y-auto font-sans print:p-0 print:m-0 print:bg-white print:static print:inset-auto print:backdrop-blur-none print:overflow-visible print:block print:w-full"
          >
            {/* Top Toolbar (Hidden during printing) */}
            <div className="w-full max-w-[210mm] lg:max-w-5xl bg-slate-900/95 border border-slate-750 backdrop-blur-xl rounded-2xl p-3 mb-3 shadow-2xl print:hidden sticky top-2 z-30 transition-all">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Right: Badge & Employee Name */}
                <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-white">پیش‌نمایش برگه رسمی تسویه حساب</h3>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          سند قطعی مالی
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        پرسنل: <strong className="text-slate-200">{empName}</strong> | شماره سند: <span className="font-mono text-slate-300">{toPersianDigits(s.settlementNo)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center: View Mode & Zoom Controls */}
                <div className="flex items-center gap-2 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  {/* Mode Selector */}
                  <div className="flex items-center bg-slate-900 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setPreviewMode('full')}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                        previewMode === 'full'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="نمایش فرم رسمی همراه با جدول تفکیکی تمام ماه‌های دوره"
                    >
                      ریز اقلام ماه‌های کارکرد
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode('summary')}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                        previewMode === 'summary'
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="نمایش خلاصه مدیریتی فشرده تک‌صفحه‌ای"
                    >
                      خلاصه مدیریتی
                    </button>
                  </div>

                  {/* Divider */}
                  <div className="h-4 w-px bg-slate-800 hidden sm:block"></div>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewZoom(prev => Math.max(70, prev - 10))}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="کوچک‌نمایی (-۱۰٪)"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom(100)}
                      className="px-1.5 py-0.5 text-[11px] font-mono text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="بازنشانی به اندازه واقعی (۱۰۰٪)"
                    >
                      {toPersianDigits(previewZoom)}٪
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom(prev => Math.min(130, prev + 10))}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="بزرگ‌نمایی (+۱۰٪)"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Left: Action Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopySummary(s, empName)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-slate-700 transition-all shadow-sm"
                    title="کپی متن خلاصه تسویه برای حسابداری یا پیام‌رسان"
                  >
                    {copiedSummary ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedSummary ? 'کپی شد' : 'کپی خلاصه'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTriggerPrint}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-600/30 transition-all border border-rose-500/40"
                    title="ارسال مستقیم به پرینتر یا ذخیره در قالب فایل PDF"
                  >
                    <Printer className="h-4 w-4" />
                    چاپ سند / PDF
                  </button>

                  <button
                    type="button"
                    onClick={() => setPrintingSettlement(null)}
                    className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-750 rounded-xl cursor-pointer transition-colors border border-slate-700"
                    title="بستن پنجره پیش‌نمایش"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Printing Advice Strip */}
              <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 text-slate-400">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  راهنمای چاپ و ذخیره: در پنجره چاپ مرورگر، اندازه کاغذ را روی <strong>A4</strong> و گزینه <strong>گرافیک پس‌زمینه (Background graphics)</strong> را فعال فرمایید.
                </span>
                <span className="hidden md:inline text-slate-400 font-sans">
                  بازه کارکرد: {toPersianDigits(s.startDate)} تا {toPersianDigits(s.endDate)} ({toPersianDigits(s.totalWorkedDays)} روز)
                </span>
              </div>
            </div>

            {/* A4 Document Container (Styled with exact Iranian Corporate Standards) */}
            <div 
              style={{ 
                transform: previewZoom !== 100 ? `scale(${previewZoom / 100})` : undefined, 
                transformOrigin: 'top center',
                transition: 'transform 0.15s ease-out' 
              }}
              className="w-full max-w-[210mm] transition-all print:transform-none"
            >
              <div 
                id="printable-settlement-form" 
                className="official-print-sheet w-full bg-white text-black p-6 sm:p-8 border-2 border-black print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full mx-auto mb-10 relative text-right leading-normal" 
                dir="rtl"
              >
                {/* -------------------------------------------------------- */}
                {/* 1. EMPLOYER & STORE HEADER (INDIVIDUAL BUSINESS IDENTITY) */}
                {/* -------------------------------------------------------- */}
                <div className="border-b-2 border-black pb-3 mb-3.5 flex items-start justify-between gap-3">
                  {/* Right: Store Name & Individual Identity */}
                  <div className="text-right w-1/3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className="w-8 h-8 border-2 border-black bg-white text-black flex items-center justify-center font-black text-sm shrink-0">
                        گ
                      </div>
                      <div>
                        <h1 className="text-sm font-black text-black tracking-tight leading-tight">
                          فروشگاه نان و شیرینی گاتان
                        </h1>
                        <span className="text-[10px] text-black font-bold block mt-0.5">
                          کارفرما: شخصیت حقیقی (واحد صنفی)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Center: Formal Title Box */}
                  <div className="text-center w-1/3 pt-0.5">
                    <div className="border-2 border-black bg-white px-2.5 py-1">
                      <h2 className="text-xs font-black text-black tracking-tight">
                        {(s.settlementType || 'with_departure') === 'without_departure'
                          ? 'برگه تسویه حساب قرارداد پرسنل (بدون ترک کار)'
                          : 'برگه تسویه حساب قطعی و مفاصاحساب پرسنل'}
                      </h2>
                      <p className="text-[9px] text-black font-bold mt-0.5">
                        منطبق با مواد ۲۴، ۳۱، ۳۴، ۶۴ و ۷۱ قانون کار جمهوری اسلامی ایران
                      </p>
                    </div>
                  </div>

                  {/* Left: Document Ledger Box */}
                  <div className="text-left w-1/3">
                    <div className="border-2 border-black bg-white p-1.5 font-sans text-[10px] space-y-0.5 text-black">
                      <div className="flex justify-between border-b border-black pb-0.5">
                        <span className="text-black font-sans font-bold">شماره سند:</span>
                        <strong className="text-black font-black">{toPersianDigits(s.settlementNo)}</strong>
                      </div>
                      <div className="flex justify-between border-b border-black pb-0.5">
                        <span className="text-black font-sans font-bold">تاریخ صدور:</span>
                        <strong className="text-black font-bold">{toPersianDigits(s.settlementDate)}</strong>
                      </div>
                      <div className="flex justify-between border-b border-black pb-0.5">
                        <span className="text-black font-sans font-bold">دوره حقوقی:</span>
                        <strong className="text-black font-bold">{toPersianDigits(s.periodId)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black font-sans font-bold">وضعیت مالی:</span>
                        <strong className="text-black font-sans font-black">قطعی و تسویه‌شده</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* 2. SECTION 1: PERSONNEL PROFILE & CONTRACT SPECS */}
                {/* -------------------------------------------------------- */}
                <div className="mb-3.5">
                  <div className="bg-white border-2 border-black text-black px-2.5 py-1 text-[11px] font-black flex items-center justify-between border-b-0">
                    <span>۱. مشخصات هویتی، استخدامی و سوابق قراردادی کارگر</span>
                    <span className="text-[10px] font-black text-black font-sans">
                      کد پرسنلی: {toPersianDigits(s.employeeCode)}
                    </span>
                  </div>
                  <table className="w-full border-collapse border-2 border-black text-[10px] text-black">
                    <tbody>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold w-1/6 text-black">نام و نام خانوادگی:</td>
                        <td className="p-1.5 border border-black bg-white w-2/6 font-black text-black text-[11px]">{empName}</td>
                        <td className="p-1.5 border border-black bg-white font-bold w-1/6 text-black">کد پرسنلی:</td>
                        <td className="p-1.5 border border-black bg-white w-2/6 font-sans font-black text-black">{toPersianDigits(s.employeeCode)}</td>
                      </tr>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">کد ملی / شناسنامه:</td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">{toPersianDigits(emp?.nationalId || '-')}</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">شماره بیمه تأمین اجتماعی:</td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">{toPersianDigits(emp?.insuranceCode || '-')}</td>
                      </tr>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">شغل و سمت سازمانی:</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">{emp?.role || 'کارگر نانوایی و قنادی'}</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">
                          {(s.settlementType || 'with_departure') === 'without_departure' ? 'نوع تسویه حساب:' : 'علت قطع رابطه همکاری:'}
                        </td>
                        <td className="p-1.5 border border-black bg-white font-black text-black">
                          {(s.settlementType || 'with_departure') === 'without_departure'
                            ? 'تسویه کامل قرارداد (ادامه همکاری بدون ترک کار)'
                            : reasonText}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">تاریخ شروع کارکرد در دوره:</td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">{toPersianDigits(s.startDate)}</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">
                          {(s.settlementType || 'with_departure') === 'without_departure' ? 'تاریخ پایان دوره قرارداد:' : 'تاریخ خاتمه و قطع همکاری:'}
                        </td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">{toPersianDigits(s.endDate)}</td>
                      </tr>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">کل مدت کارکرد در دوره:</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">
                          {toPersianDigits(s.totalWorkedDays)} روز کاری (معادل {toPersianDigits((s.totalWorkedDays / 30).toFixed(1).replace('.', '٫'))} ماه)
                        </td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">آخرین مزد روزانه مبنا:</td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">
                          {formatWithCommas(s.dailySalaryForCalculation)} ریال
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* -------------------------------------------------------- */}
                {/* 3. SECTION 2: MONTHLY SALARY & WAGE BREAKDOWN */}
                {/* -------------------------------------------------------- */}
                {previewMode === 'full' ? (
                  <div className="mb-3.5">
                    <div className="bg-white border-2 border-black text-black px-2.5 py-1 text-[11px] font-black flex items-center justify-between border-b-0">
                      <span>۲. صورت‌وضعیت کارکرد و ریز اقلام حقوق و دستمزد ماه‌های دوره همکاری (تفکیک دقیق اقلام)</span>
                      <span className="text-[9.5px] font-black text-black font-sans">
                        ارقام به ریال
                      </span>
                    </div>
                    {(() => {
                      const totalPreviewOtHours = s.monthlyDetails?.reduce((sum, m) => sum + (m.overtimeHours || 0), 0) || 0;
                      const totalPreviewFriHours = s.monthlyDetails?.reduce((sum, m) => sum + (m.fridayWorkHours || 0), 0) || 0;
                      const totalPreviewHolHours = s.monthlyDetails?.reduce((sum, m) => sum + (m.holidayWorkHours || 0), 0) || 0;
                      const totalPreviewOtherAllowances =
                        s.monthlyDetails?.reduce(
                          (sum, m) =>
                            sum +
                            (m.seniorityBase || 0) +
                            (m.jobAllowance || 0),
                          0
                        ) || 0;
                      const totalPreviewTaxAndSupp =
                        s.monthlyDetails?.reduce(
                          (sum, m) => sum + (m.payrollTax || 0) + (m.supplementaryInsurance || 0),
                          0
                        ) || 0;
                      const totalPreviewUsedLeaveMinutes =
                        s.monthlyDetails && s.monthlyDetails.length > 0
                          ? s.monthlyDetails.reduce(
                              (sum, m) =>
                                m.alreadySettledInPrior ? sum : sum + getMonthlyUsedLeaveMinutes(m),
                              0
                            )
                          : Math.round(
                              (s.totalUsedLeaveHours ?? (s.totalUsedLeaveDays || 0) * 8) * 60
                            );
                      return (
                        <table className="w-full border-collapse border-2 border-black text-[8px] text-black">
                          <thead className="bg-white text-black font-black text-center border-b-2 border-black">
                            <tr>
                              <th className="border border-black p-1">ماه</th>
                              <th className="border border-black p-1 w-6">کارکرد</th>
                              <th className="border border-black p-1 w-10">مرخصی استفاده شده (ساعت)</th>
                              <th className="border border-black p-1">حقوق پایه</th>
                              <th className="border border-black p-1">بن خواربار</th>
                              <th className="border border-black p-1">حق مسکن</th>
                              <th className="border border-black p-1">حق اولاد</th>
                              <th className="border border-black p-1">حق تاهل</th>
                              <th className="border border-black p-1">سایر مزایا</th>
                              <th className="border border-black p-1">اضافه‌کاری</th>
                              <th className="border border-black p-1">جمعه‌کاری</th>
                              <th className="border border-black p-1">تعطیل‌کاری</th>
                              <th className="border border-black p-1 font-black">ناخالص</th>
                              <th className="border border-black p-1">مشمول بیمه</th>
                              <th className="border border-black p-1">بیمه ۷٪</th>
                              <th className="border border-black p-1">مالیات/تکمیلی</th>
                              <th className="border border-black p-1 font-black">خالص ماه</th>
                            </tr>
                          </thead>
                          <tbody className="text-center font-sans text-black font-bold">
                            {s.monthlyDetails?.map((m, idx) => {
                              const rowOtherAllowances =
                                (m.seniorityBase || 0) +
                                (m.jobAllowance || 0);
                              const rowTaxAndSupp = (m.payrollTax || 0) + (m.supplementaryInsurance || 0);
                              return (
                                <tr key={idx} className="bg-white">
                                  <td className="border border-black p-1 font-sans font-black text-black">{toPersianDigits(m.monthName)}</td>
                                  <td className="border border-black p-1 font-black text-black">{toPersianDigits(m.workedDays)}</td>
                                  <td className="border border-black p-1 text-black whitespace-nowrap">{formatMinutesToPersianHM(getMonthlyUsedLeaveMinutes(m))}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.baseSalary)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.foodAllowance)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.housingAllowance)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.childAllowance)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.marriageAllowance)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(rowOtherAllowances)}</td>
                                  <td className="border border-black p-1 text-center text-black">
                                    {m.overtimeHours > 0 ? (
                                      <div className="leading-tight">
                                        <span className="font-bold text-[7.5px] block">{toPersianDigits(m.overtimeHours)} ساعت</span>
                                        <span className="text-[7.5px] block text-left">{formatWithCommas(m.overtimeAmount)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-left block">{formatWithCommas(m.overtimeAmount)}</span>
                                    )}
                                  </td>
                                  <td className="border border-black p-1 text-center text-black">
                                    {m.fridayWorkHours > 0 ? (
                                      <div className="leading-tight">
                                        <span className="font-bold text-[7.5px] block">{toPersianDigits(m.fridayWorkHours)} ساعت</span>
                                        <span className="text-[7.5px] block text-left">{formatWithCommas(m.fridayWorkAmount)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-left block">{formatWithCommas(m.fridayWorkAmount)}</span>
                                    )}
                                  </td>
                                  <td className="border border-black p-1 text-center text-black">
                                    {m.holidayWorkHours > 0 ? (
                                      <div className="leading-tight">
                                        <span className="font-bold text-[7.5px] block">{toPersianDigits(m.holidayWorkHours)} ساعت</span>
                                        <span className="text-[7.5px] block text-left">{formatWithCommas(m.holidayWorkAmount)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-left block">{formatWithCommas(m.holidayWorkAmount)}</span>
                                    )}
                                  </td>
                                  <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.grossSalary)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.insurableGross || 0)}</td>
                                  <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.workerInsuranceShare)}</td>
                                  <td className="border border-black p-1 text-left text-black">{formatWithCommas(rowTaxAndSupp)}</td>
                                  <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.netSalaryPayable)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="total-row font-black font-sans">
                            <tr className="bg-white text-black border-t-2 border-black">
                              <td className="border border-black p-1 font-sans font-black text-black">جمع کل</td>
                              <td className="border border-black p-1 font-black text-black">{toPersianDigits(s.totalWorkedDays)}</td>
                              <td className="border border-black p-1 text-black whitespace-nowrap">{formatMinutesToPersianHM(totalPreviewUsedLeaveMinutes)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalBaseSalaries)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalFoodAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalHousingAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalChildAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalMarriageAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(totalPreviewOtherAllowances)}</td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewOtHours > 0 && (
                                  <span className="font-bold text-[7.5px] block">{toPersianDigits(totalPreviewOtHours)} ساعت</span>
                                )}
                                <span className="text-[7.5px] block text-left">{formatWithCommas(s.totalOvertimeAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewFriHours > 0 && (
                                  <span className="font-bold text-[7.5px] block">{toPersianDigits(totalPreviewFriHours)} ساعت</span>
                                )}
                                <span className="text-[7.5px] block text-left">{formatWithCommas(s.totalFridayWorkAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewHolHours > 0 && (
                                  <span className="font-bold text-[7.5px] block">{toPersianDigits(totalPreviewHolHours)} ساعت</span>
                                )}
                                <span className="text-[7.5px] block text-left">{formatWithCommas(s.totalHolidayWorkAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalGrossSalaries)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalInsurableGross || 0)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalWorkerInsurance)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(totalPreviewTaxAndSupp)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalNetSalaries)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="mb-3.5 p-2 bg-white border-2 border-black text-center text-[10.5px] font-bold text-black">
                    <span>ریز اقلام کارکرد ماهانه در دفاتر حقوق و دستمزد فروشگاه ثبت و ضبط بوده و نسخه خلاصه مدیریتی نمایش داده شده است.</span>
                  </div>
                )}

                {printUnpaidLeaveInfo && (
                  <div className="mb-3.5 px-3 py-1.5 bg-white border-2 border-black text-black text-[10px] font-bold flex items-center justify-between gap-2">
                    <span>
                      توضیح کارکرد ماه ترک کار: پرسنل در ماه ترک کار تعداد{' '}
                      <strong className="font-black">
                        {toPersianDigits(String(printUnpaidLeaveInfo.unpaidDays).replace('.', '٫'))}
                      </strong>{' '}
                      روز مرخصی بدون حقوق داشته است.
                    </span>
                    <span className="text-[9px] font-sans">
                      (روزهای ماه تا تاریخ ترک کار: {toPersianDigits(printUnpaidLeaveInfo.calendarDaysToDeparture)} روز - کارکرد: {toPersianDigits(printUnpaidLeaveInfo.workedDays)} روز)
                    </span>
                  </div>
                )}

                {/* -------------------------------------------------------- */}
                {/* 4. SECTION 3: LEGAL BENEFITS & DEDUCTIONS BREAKDOWN */}
                {/* -------------------------------------------------------- */}
                <div className="grid grid-cols-2 gap-3 mb-3.5">
                  {/* مطالبات و مزایای پایان خدمت */}
                  <div>
                    <div className="bg-white border-2 border-black text-black px-2.5 py-1 text-[10.5px] font-black flex items-center justify-between border-b-0">
                      <span>۳. مطالبات و مزایای قانونی پایان خدمت (بستانکاری)</span>
                      <span className="text-[9.5px] font-black text-black">مقررات قانون کار</span>
                    </div>
                    <table className="w-full border-collapse border-2 border-black text-[10px] text-black">
                      <tbody>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">جمع خالص حقوق و دستمزد ماه‌های کارکرد:</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.totalNetSalaries)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">
                            حق سنوات پایان خدمت (ماده ۲۴ - کارکرد {toPersianDigits(s.totalWorkedDays)} روز):
                          </td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.severanceAmount)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">
                            عیدی و پاداش سالانه قانونی (به نسبت کارکرد {toPersianDigits(s.totalWorkedDays)} روز):
                          </td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.bonusAmount)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">
                            بازخرید مانده مرخصی استحقاقی ({formatHoursAsPersianHM(getSettlementUnusedLeaveHours(s))} ساعت):
                          </td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.unusedLeaveAmount)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">
                            طلب حساب از قبل (مانده بستانکاری سال/دوره قبل{s.previousYearReceivableDescription ? ` — ${s.previousYearReceivableDescription}` : ''}):
                          </td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.previousYearReceivableAmount || 0)} ریال</td>
                        </tr>
                        <tr className="bg-white font-black text-black border-t-2 border-black">
                          <td className="p-1.5 border border-black bg-white text-black font-black">جمع کل مطالبات ناخالص پایان خدمت:</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-xs text-black">{formatWithCommas(s.totalGrossPayable)} ریال</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* کسورات و پرداختی‌های کارفرما */}
                  <div>
                    <div className="bg-white border-2 border-black text-black px-2.5 py-1 text-[10.5px] font-black flex items-center justify-between border-b-0">
                      <span>۴. کسورات قانونی و پرداختی‌های قبلی کارفرما (بدهکاری)</span>
                      <span className="text-[9.5px] font-black text-black">اسناد مالی</span>
                    </div>
                    <table className="w-full border-collapse border-2 border-black text-[10px] text-black">
                      <tbody>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">مانده خرید طی دوره پرسنل از فروشگاه:</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.personnelPurchasesAmount)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">سایر کسورات قانونی، خسارت و تعهدات:</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.otherDeductionsAmount)} ریال</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">شرح و علت سایر کسورات:</td>
                          <td className="p-1.5 border border-black bg-white text-black font-medium text-[9.5px]">{s.otherDeductionsDescription || 'فاقد کسورات متفرقه'}</td>
                        </tr>
                        <tr>
                          <td className="p-1.5 border border-black bg-white font-bold text-black">مبالغ پرداخت شده قبلی کارفرما (مساعده/حقوق):</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.employerPaidAmount)} ریال</td>
                        </tr>
                        <tr className="bg-white font-black text-black border-t-2 border-black">
                          <td className="p-1.5 border border-black bg-white text-black font-black">جمع کل کسورات و پرداختی‌های قبلی:</td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-xs text-black">
                            {formatWithCommas((s.totalDeductions || 0) + (s.employerPaidAmount || 0))} ریال
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* 5. SECTION 4: NET FINAL PAYABLE BANNER (CLEAN B&W BORDER) */}
                {/* -------------------------------------------------------- */}
                <div 
                  style={{ backgroundColor: '#ffffff', color: '#000000', borderColor: '#000000' }}
                  className="border-2 border-black p-3 bg-white mb-3.5 flex flex-col sm:flex-row items-center justify-between gap-3"
                >
                  <div className="space-y-0.5 text-right">
                    <span className="text-xs font-black text-black block">
                      مبلغ خالص قابل پرداخت نهایی تسویه حساب (وجه تسویه):
                    </span>
                    <div className="text-[11.5px] text-black font-bold">
                      مبلغ به حروف: <strong className="text-black font-black text-xs">« {numberToWordsPersian(s.finalNetPayable)} ریال »</strong>
                    </div>
                    <span className="text-[9.5px] text-black font-bold block">
                      روش تسویه: حواله بانکی ساتنا / پایا یا چک بانکی تضمین‌شده به شماره حساب و شماره شبا کارگر
                    </span>
                  </div>
                  <div 
                    style={{ backgroundColor: '#ffffff', color: '#000000', borderColor: '#000000' }}
                    className="text-left bg-white text-black px-5 py-2 border-2 border-black"
                  >
                    <span className="text-[9.5px] text-black block text-right font-black">مبلغ خالص قطعی:</span>
                    <span className="text-xl font-black font-sans tracking-tight text-black block">
                      {formatWithCommas(s.finalNetPayable)} <span className="text-xs font-sans font-bold text-black">ریال</span>
                    </span>
                  </div>
                </div>

                {/* -------------------------------------------------------- */}
                {/* 6. SECTION 5: OFFICIAL LEGAL WAIVER & FULL RELEASE STATEMENT */}
                {/* -------------------------------------------------------- */}
                <div 
                  style={{ backgroundColor: '#ffffff', color: '#000000', borderColor: '#000000' }}
                  className="border-2 border-black p-3 text-[10px] leading-relaxed mb-3.5 bg-white text-justify text-black font-normal"
                >
                  <div className="flex items-center gap-1.5 font-black text-black mb-1 border-b border-black pb-1">
                    <FileCheck className="h-4 w-4 text-black" />
                    <span>اقرارنامه رسمی دریافت مطالبات، اسقاط کافه دعاوی و مفاصاحساب قطعی کارگری:</span>
                  </div>
                  <p className="mt-1 leading-5">
                    اینجانب <strong>{empName}</strong> با شماره ملی <strong>{toPersianDigits(emp?.nationalId || '-')}</strong> و شماره بیمه <strong>{toPersianDigits(emp?.insuranceCode || '-')}</strong>، بدین‌وسیله با اراده کامل و سلامت عقل اقرار و اعلام می‌دارم که کلیه حقوق، دستمزد پایه، مزایای قانونی، بن خواربار، حق مسکن، حق اولاد، حق تاهل، اضافه کاری، جمعه کاری، تعطیل کاری، عیدی و پاداش سالانه، حق سنوات پایان دوره، مانده مرخصی استحقاقی ذخیره‌شده و مانده طلب حساب از قبل خود در بازه زمانی مورد تسویه تا تاریخ (<span className="font-sans font-bold">{toPersianDigits(waiverLastAttendanceDate)}</span>) را طبق ارقام فوق‌الذکر به طور کامل و صحیح دریافت نموده‌ام و نسبت به دوره تسویه‌شده مذکور هیچ‌گونه ادعا، طلب، حق یا شکایتی تحت هیچ عنوان حقوقی، کیفری یا استخدامی علیه <strong>فروشگاه نان و شیرینی گاتان</strong> و کارفرما نداشته و {(s.settlementType || 'with_departure') === 'without_departure' ? 'این تسویه حساب مربوط به مختومه‌شدن کامل دوره قرارداد فوق بدون قطع ادامه همکاری می‌باشد.' : 'اسقاط کافه خیارات و برائت ذمه قطعی و همه‌جانبه کارفرما را اعلام می‌دارم.'}
                  </p>
                </div>

                {/* -------------------------------------------------------- */}
                {/* 7. SECTION 6: 4-WAY FORMAL SIGNATURE BOXES (CLEAN B&W) */}
                {/* -------------------------------------------------------- */}
                <div 
                  style={{ backgroundColor: '#ffffff', color: '#000000', borderColor: '#000000' }}
                  className="border-2 border-black bg-white mb-2"
                >
                  <div className="grid grid-cols-4 divide-x divide-x-reverse divide-black text-center text-[10px]">
                    {/* کارگر با اثر انگشت */}
                    <div 
                      style={{ backgroundColor: '#ffffff', color: '#000000' }}
                      className="p-2.5 bg-white flex flex-col justify-between min-h-[120px] text-black"
                    >
                      <div>
                        <span className="font-black text-black block text-[10.5px]">کارگر / گیرنده وجه</span>
                        <span className="text-[9.5px] text-black font-bold block mt-0.5">{empName}</span>
                      </div>
                      <div 
                        style={{ backgroundColor: '#ffffff', color: '#000000', borderColor: '#000000' }}
                        className="my-1 border border-dashed border-black bg-white p-1 flex flex-col items-center justify-center"
                      >
                        <span className="text-[8.5px] text-black font-bold">محل اثر انگشت و امضا</span>
                        <div className="w-10 h-10 border border-dashed border-black rounded-full my-0.5"></div>
                      </div>
                      <span className="text-[8.5px] text-black font-bold block">تاریخ: ____ / ____ / ۱۴۰۴</span>
                    </div>

                    {/* امور اداری و منابع انسانی */}
                    <div 
                      style={{ backgroundColor: '#ffffff', color: '#000000' }}
                      className="p-2.5 bg-white flex flex-col justify-between min-h-[120px] text-black"
                    >
                      <div>
                        <span className="font-black text-black block text-[10.5px]">امور اداری و کارگزینی</span>
                        <span className="text-[9.5px] text-black font-bold block mt-0.5">تایید کارکرد و مرخصی</span>
                      </div>
                      <div className="h-14 border-b border-dashed border-black my-1"></div>
                      <span className="text-[8.5px] text-black font-bold block">امضا و تایید: ________________</span>
                    </div>

                    {/* امور مالی و حسابداری */}
                    <div 
                      style={{ backgroundColor: '#ffffff', color: '#000000' }}
                      className="p-2.5 bg-white flex flex-col justify-between min-h-[120px] text-black"
                    >
                      <div>
                        <span className="font-black text-black block text-[10.5px]">امور مالی و حسابداری</span>
                        <span className="text-[9.5px] text-black font-bold block mt-0.5">بررسی محاسبات و پرداخت</span>
                      </div>
                      <div className="h-14 border-b border-dashed border-black my-1"></div>
                      <span className="text-[8.5px] text-black font-bold block">امضا و تایید: ________________</span>
                    </div>

                    {/* کارفرما / صاحب پروانه کسب */}
                    <div 
                      style={{ backgroundColor: '#ffffff', color: '#000000' }}
                      className="p-2.5 bg-white flex flex-col justify-between min-h-[120px] text-black"
                    >
                      <div>
                        <span className="font-black text-black block text-[10.5px]">کارفرما / صاحب پروانه کسب</span>
                        <span className="text-[9.5px] text-black font-bold block mt-0.5">تصویب نهایی و صدور مفاصاحساب</span>
                      </div>
                      <div className="h-14 border-b border-dashed border-black my-1"></div>
                      <span className="text-[8.5px] text-black font-bold block">مهر و امضای کارفرما</span>
                    </div>
                  </div>
                </div>

                {/* Official Page Footer */}
                <div className="border-t-2 border-black pt-1.5 flex items-center justify-between text-[9px] text-black font-bold font-sans">
                  <span>سامانه مدیریت مالی و حقوق دستمزد - فروشگاه نان و شیرینی گاتان (شخصیت حقیقی)</span>
                  <span>کد پیگیری اصالت سند: {toPersianDigits(s.settlementNo)}-{toPersianDigits(s.employeeCode)}</span>
                  <span>تاریخ و زمان چاپ: {toPersianDigits(getTodayJalali())}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })(), document.body)}
    </div>
  );
}
