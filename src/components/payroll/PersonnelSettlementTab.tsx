/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { 
  AppDatabase, Personnel, PersonnelContract, SalaryBaseRate,
  PersonnelSettlement, SettlementMonthlyDetail, SettlementReason
} from '../../types';
import { 
  toPersianDigits, toEnglishDigits, formatWithCommas, parseNumber, 
  downloadCSV, printElement, matchPersianString, getTodayJalali, 
  numberToWordsPersian, isValidJalaliDate, normalizeJalaliDate
} from '../../utils/persianUtils';
import { 
  Calculator, FileText, Printer, Download, Plus, Search, Trash2, 
  Edit3, CheckCircle2, AlertCircle, Calendar, DollarSign, Users, 
  Briefcase, ShieldAlert, CreditCard, ArrowRight, ChevronDown, ChevronUp, 
  Sparkles, Clock, Receipt, X, FileCheck, HelpCircle, Layers, Check, RotateCcw,
  Eye, Copy, ZoomIn, ZoomOut, Maximize2, Building2, ShieldCheck
} from 'lucide-react';
import { getInsuredSalaryItemsForContract, getTaxableSalaryItemsForContract, getSalaryBaseRateForContract } from '../PayrollManagement';

interface PersonnelSettlementTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

const JALALI_MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

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

export default function PersonnelSettlementTab({
  db,
  onUpdateDb,
  activePeriodId
}: PersonnelSettlementTabProps) {
  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState<'all' | SettlementReason>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'finalized' | 'paid'>('all');

  // Modal / Form state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Print modal state
  const [printingSettlement, setPrintingSettlement] = useState<PersonnelSettlement | null>(null);

  // Form Fields
  const [formEmployeeCode, setFormEmployeeCode] = useState('');
  const [formContractId, setFormContractId] = useState('');
  const [formReason, setFormReason] = useState<SettlementReason>('contract_end');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formSettlementDate, setFormSettlementDate] = useState(getTodayJalali());
  
  // Custom monthly details list
  const [formMonthlyDetails, setFormMonthlyDetails] = useState<SettlementMonthlyDetail[]>([]);
  
  // Deductions & Employer Payments
  const [formPurchasesAmount, setFormPurchasesAmount] = useState<string>('0');
  const [formOtherDeductionsAmount, setFormOtherDeductionsAmount] = useState<string>('0');
  const [formOtherDeductionsDescription, setFormOtherDeductionsDescription] = useState<string>('');
  const [formEmployerPaidAmount, setFormEmployerPaidAmount] = useState<string>('0');
  
  // Manual overrides for end-of-service calculated amounts (سنوات، عیدی، مانده مرخصی)
  const [formDailySalaryOverride, setFormDailySalaryOverride] = useState<string>('');
  const [formSeveranceAmount, setFormSeveranceAmount] = useState<string>('');
  const [formBonusAmount, setFormBonusAmount] = useState<string>('');
  const [formUnusedLeaveDays, setFormUnusedLeaveDays] = useState<string>('');
  const [formUnusedLeaveAmount, setFormUnusedLeaveAmount] = useState<string>('');

  const [formStatus, setFormStatus] = useState<'draft' | 'finalized' | 'paid'>('finalized');
  const [formNotes, setFormNotes] = useState('');

  // Bulk input helper for fast monthly adjustments
  const [bulkOvertime, setBulkOvertime] = useState('');
  const [bulkFriday, setBulkFriday] = useState('');
  const [bulkHoliday, setBulkHoliday] = useState('');
  const [bulkLeave, setBulkLeave] = useState('');

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
    return (db.personnelSettlements || []).filter(s => s.periodId === activePeriodId);
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

  // Find rate for a specific year
  const getSalaryRateForYear = (yearNum: number): SalaryBaseRate => {
    const yearStr = String(yearNum);
    const found = (db.salaryBaseRates || []).find(r => String(r.year).trim() === yearStr.trim() && r.periodId === activePeriodId)
      || (db.salaryBaseRates || []).find(r => String(r.year).trim() === yearStr.trim());
    
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

  // سال متناظر با سال تسویه حساب (بر اساس تاریخ پایان دوره تسویه حساب)
  const settlementYear = useMemo(() => {
    const endStr = formEndDate || selectedContract?.contractEndDate || selectedPersonnel?.contractEndDate || formSettlementDate || formStartDate || '';
    const parsedEnd = parseJalali(endStr);
    if (parsedEnd?.y) return parsedEnd.y;
    if (formMonthlyDetails && formMonthlyDetails.length > 0) {
      const last = formMonthlyDetails[formMonthlyDetails.length - 1];
      if (last?.year) return last.year;
    }
    return contractYear || 1404;
  }, [formEndDate, selectedContract, selectedPersonnel, formSettlementDate, formStartDate, formMonthlyDetails, contractYear]);

  // نرخ قوانین و ثوابت دستمزد متناسب با سال تسویه حساب
  const settlementSalaryRate = useMemo(() => {
    return getSalaryRateForYear(settlementYear);
  }, [settlementYear, db.salaryBaseRates, activePeriodId]);

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
    const resolvedSettlementYear = targetSettlementYear || settlementYear || (formEndDate ? parseJalali(formEndDate)?.y : undefined) || current.year;
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

  // Generate months breakdown automatically based on start and end dates
  const generateMonthsList = (startDateStr: string, endDateStr: string, emp?: Personnel, contract?: PersonnelContract) => {
    const start = parseJalali(startDateStr);
    const end = parseJalali(endDateStr);
    if (!start || !end) return [];

    const months: SettlementMonthlyDetail[] = [];
    let curY = start.y;
    let curM = start.m;
    let index = 1;

    const targetSettlementYear = end.y;

    while (curY < end.y || (curY === end.y && curM <= end.m)) {
      const daysInMonth = getShamsiMonthDays(curY, curM);
      let workedDays = daysInMonth;

      // If start month, work starts from start.d
      if (curY === start.y && curM === start.m) {
        workedDays = daysInMonth - start.d + 1;
      }
      // If end month, work ends on end.d
      if (curY === end.y && curM === end.m) {
        if (curY === start.y && curM === start.m) {
          workedDays = end.d - start.d + 1;
        } else {
          workedDays = end.d;
        }
      }

      workedDays = Math.max(0, Math.min(daysInMonth, workedDays));

      const rawDetail: SettlementMonthlyDetail = {
        monthIndex: index++,
        year: curY,
        month: curM,
        monthName: `${JALALI_MONTH_NAMES[curM - 1]} ${curY}`,
        totalDaysInMonth: daysInMonth,
        workedDays,
        overtimeHours: 0,
        holidayWorkHours: 0,
        fridayWorkHours: 0,
        usedLeaveDays: 0,
        dailyBaseSalary: 0,
        baseSalary: 0,
        foodAllowance: 0,
        housingAllowance: 0,
        childAllowance: 0,
        marriageAllowance: 0,
        overtimeAmount: 0,
        holidayWorkAmount: 0,
        fridayWorkAmount: 0,
        grossSalary: 0,
        workerInsuranceShare: 0,
        netSalaryPayable: 0
      };

      const calculated = calculateMonthDetail(rawDetail, emp, contract, targetSettlementYear);
      months.push(calculated);

      curM++;
      if (curM > 12) {
        curM = 1;
        curY++;
      }
    }

    return months;
  };

  // Handle employee change
  const handleEmployeeSelect = (empCode: string) => {
    setFormEmployeeCode(empCode);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveDays('');
    setFormUnusedLeaveAmount('');

    const emp = personnelList.find(p => p.employeeCode === empCode);
    const contracts = allContracts.filter(c => c.employeeCode === empCode);

    let contract: PersonnelContract | undefined = contracts[0];
    if (contract) {
      setFormContractId(contract.id);
      setFormStartDate(contract.contractStartDate || emp?.entryDate || '1404/01/01');
      if (formReason === 'contract_end') {
        setFormEndDate(contract.contractEndDate || '1404/12/29');
      }
    } else {
      setFormContractId('');
      const defaultStart = emp?.entryDate || '1404/01/01';
      setFormStartDate(defaultStart);
      if (formReason === 'contract_end') {
        setFormEndDate(emp?.contractEndDate || '1404/12/29');
      }
    }

    // Generate initial months
    const startStr = contract?.contractStartDate || emp?.entryDate || '1404/01/01';
    const endStr = (formReason === 'contract_end' && contract?.contractEndDate) ? contract.contractEndDate : (formEndDate || '1404/12/29');
    const generated = generateMonthsList(startStr, endStr, emp, contract);
    setFormMonthlyDetails(generated);
  };

  // Handle contract selection change
  const handleContractSelect = (contractId: string) => {
    setFormContractId(contractId);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveDays('');
    setFormUnusedLeaveAmount('');

    const contract = allContracts.find(c => c.id === contractId);
    if (contract) {
      setFormStartDate(contract.contractStartDate);
      if (formReason === 'contract_end') {
        setFormEndDate(contract.contractEndDate);
      }
      const endToUse = formReason === 'contract_end' ? contract.contractEndDate : (formEndDate || contract.contractEndDate);
      const generated = generateMonthsList(contract.contractStartDate, endToUse, selectedPersonnel, contract);
      setFormMonthlyDetails(generated);
    }
  };

  // Handle reason change
  const handleReasonChange = (reason: SettlementReason) => {
    setFormReason(reason);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveDays('');
    setFormUnusedLeaveAmount('');

    if (reason === 'contract_end') {
      if (selectedContract) {
        setFormStartDate(selectedContract.contractStartDate);
        setFormEndDate(selectedContract.contractEndDate);
        const generated = generateMonthsList(selectedContract.contractStartDate, selectedContract.contractEndDate, selectedPersonnel, selectedContract);
        setFormMonthlyDetails(generated);
      } else if (selectedPersonnel?.contractEndDate) {
        setFormEndDate(selectedPersonnel.contractEndDate);
        const generated = generateMonthsList(formStartDate, selectedPersonnel.contractEndDate, selectedPersonnel, selectedContract);
        setFormMonthlyDetails(generated);
      }
    }
  };

  // Handle manual date changes
  const handleDateChangeAndRecalculate = (newStart: string, newEnd: string) => {
    setFormStartDate(newStart);
    setFormEndDate(newEnd);
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveDays('');
    setFormUnusedLeaveAmount('');

    if (newStart && newEnd && newStart.length >= 8 && newEnd.length >= 8) {
      const generated = generateMonthsList(newStart, newEnd, selectedPersonnel, selectedContract);
      setFormMonthlyDetails(generated);
    }
  };

  // Update a single field in a month
  const handleMonthFieldChange = (
    index: number, 
    field: 'workedDays' | 'overtimeHours' | 'holidayWorkHours' | 'fridayWorkHours' | 'usedLeaveDays',
    val: number
  ) => {
    setFormMonthlyDetails(prev => {
      const updated = [...prev];
      const target = { ...updated[index], [field]: val };
      updated[index] = calculateMonthDetail(target, selectedPersonnel, selectedContract, settlementYear);
      return updated;
    });
  };

  // Direct manual override of calculated numbers for any month
  const handleMonthAmountChange = (
    index: number,
    field: keyof SettlementMonthlyDetail,
    val: number
  ) => {
    setFormMonthlyDetails(prev => {
      const updated = [...prev];
      const current = { ...updated[index], [field]: val };

      // Sum component items to derive grossSalary if an item was edited
      let gross = current.grossSalary;
      if (['baseSalary', 'foodAllowance', 'housingAllowance', 'childAllowance', 'marriageAllowance', 'overtimeAmount', 'fridayWorkAmount', 'holidayWorkAmount'].includes(field as string)) {
        gross = (current.baseSalary || 0) + 
                (current.foodAllowance || 0) + 
                (current.housingAllowance || 0) + 
                (current.childAllowance || 0) + 
                (current.marriageAllowance || 0) + 
                (current.overtimeAmount || 0) + 
                (current.fridayWorkAmount || 0) + 
                (current.holidayWorkAmount || 0);
      } else if (field === 'grossSalary') {
        gross = val;
      }

      let insurable = current.insurableGross || 0;
      let ins = current.workerInsuranceShare;
      if (field === 'insurableGross') {
        insurable = val;
        ins = Math.round(val * 0.07);
      } else if (field === 'workerInsuranceShare') {
        ins = val;
      }

      let net = current.netSalaryPayable;
      if (field === 'netSalaryPayable') {
        net = val;
      } else {
        net = Math.max(0, gross - ins);
      }

      updated[index] = {
        ...current,
        grossSalary: gross,
        insurableGross: insurable,
        workerInsuranceShare: ins,
        netSalaryPayable: net
      };
      return updated;
    });
  };

  // Reset a specific month back to standard legal calculations
  const handleResetMonthToFormula = (index: number) => {
    setFormMonthlyDetails(prev => {
      const updated = [...prev];
      updated[index] = calculateMonthDetail(updated[index], selectedPersonnel, selectedContract, settlementYear);
      return updated;
    });
  };

  // Reset all months back to standard legal calculations
  const handleResetAllMonthsToFormula = () => {
    setFormMonthlyDetails(prev => {
      return prev.map(m => calculateMonthDetail(m, selectedPersonnel, selectedContract, settlementYear));
    });
  };

  // Apply bulk values to all months
  const handleApplyBulk = () => {
    const ot = parseNumber(bulkOvertime);
    const fri = parseNumber(bulkFriday);
    const hol = parseNumber(bulkHoliday);
    const lv = parseNumber(bulkLeave);

    setFormMonthlyDetails(prev => {
      return prev.map(m => {
        const item = {
          ...m,
          overtimeHours: bulkOvertime !== '' ? ot : m.overtimeHours,
          fridayWorkHours: bulkFriday !== '' ? fri : m.fridayWorkHours,
          holidayWorkHours: bulkHoliday !== '' ? hol : m.holidayWorkHours,
          usedLeaveDays: bulkLeave !== '' ? lv : m.usedLeaveDays
        };
        return calculateMonthDetail(item, selectedPersonnel, selectedContract, settlementYear);
      });
    });
  };

  // Calculations for End of Service (عیدی، سنوات، مانده مرخصی، جمع کل و مانده قابل پرداخت)
  const settlementSummary = useMemo(() => {
    let totalWorkedDays = 0;
    let totalBaseSalaries = 0;
    let totalFoodAllowances = 0;
    let totalHousingAllowances = 0;
    let totalChildAllowances = 0;
    let totalMarriageAllowances = 0;
    let totalOvertimeHours = 0;
    let totalHolidayWorkHours = 0;
    let totalFridayWorkHours = 0;
    let totalOvertimeAmounts = 0;
    let totalHolidayWorkAmounts = 0;
    let totalFridayWorkAmounts = 0;
    let totalGrossSalaries = 0;
    let totalInsurableGross = 0;
    let totalWorkerInsurance = 0;
    let totalNetSalaries = 0;
    let totalUsedLeaveDays = 0;

    formMonthlyDetails.forEach(m => {
      totalWorkedDays += m.workedDays;
      totalBaseSalaries += m.baseSalary;
      totalFoodAllowances += m.foodAllowance;
      totalHousingAllowances += m.housingAllowance;
      totalChildAllowances += m.childAllowance;
      totalMarriageAllowances += m.marriageAllowance;
      totalOvertimeHours += m.overtimeHours || 0;
      totalHolidayWorkHours += m.holidayWorkHours || 0;
      totalFridayWorkHours += m.fridayWorkHours || 0;
      totalOvertimeAmounts += m.overtimeAmount;
      totalHolidayWorkAmounts += m.holidayWorkAmount;
      totalFridayWorkAmounts += m.fridayWorkAmount;
      totalGrossSalaries += m.grossSalary;
      totalInsurableGross += m.insurableGross || 0;
      totalWorkerInsurance += m.workerInsuranceShare;
      totalNetSalaries += m.netSalaryPayable;
      totalUsedLeaveDays += m.usedLeaveDays;
    });

    // Last daily & monthly salary (بر اساس پایه حقوق روزانه ناشی از نرخ ثوابت دستمزد سال قرارداد):
    const lastMonth = formMonthlyDetails[formMonthlyDetails.length - 1];
    const contractEndYear = lastMonth?.year || parseInt((formEndDate || formStartDate || '1404').split('/')[0], 10) || 1404;
    const endYearRate = getSalaryRateForYear(contractEndYear);
    const fallbackRateDaily = (endYearRate.hourlyBaseSalary && endYearRate.hourlyBaseSalary > 0)
      ? Math.round(endYearRate.hourlyBaseSalary * 7.333333)
      : (endYearRate.dailyBaseSalary > 0 ? endYearRate.dailyBaseSalary : 2388728);
    const defaultLastDailySalary = lastMonth?.dailyBaseSalary || fallbackRateDaily;
    const lastDailySalary = formDailySalaryOverride !== '' ? parseNumber(formDailySalaryOverride) : defaultLastDailySalary;
    const lastMonthlyBaseSalary = lastDailySalary * 30;

    // 1. سنوات پایان خدمت (ماده ۲۴ قانون کار):
    // به نسبت روزهای کارکرد کل قرارداد: (حقوق پایه ماهانه * کل کارکرد قرارداد) / ۳۶۵
    const severanceDays = totalWorkedDays;
    const defaultSeveranceAmount = Math.round((lastMonthlyBaseSalary * totalWorkedDays) / 365);
    const severanceAmount = formSeveranceAmount !== '' ? parseNumber(formSeveranceAmount) : defaultSeveranceAmount;

    // 2. عیدی و پاداش سالانه (قانون تعیین عیدی):
    // به نسبت روزهای کارکرد کل قرارداد: (حقوق پایه ماهانه * ۲ * کل کارکرد قرارداد) / ۳۶۵
    const bonusDays = totalWorkedDays;
    const defaultBonusAmount = Math.round((lastMonthlyBaseSalary * 2 * totalWorkedDays) / 365);
    const bonusAmount = formBonusAmount !== '' ? parseNumber(formBonusAmount) : defaultBonusAmount;

    // 3. مرخصی استحقاقی (ماده ۶۴ و ۷۱ قانون کار):
    // سالانه ۳۰ روز با جمعه‌ها (۲.۵ روز در ماه)
    // سهم مرخصی دوره: (کل کارکرد / ۳۶۵) * ۳۰
    const totalEntitledLeaveDays = Math.round(((totalWorkedDays / 365) * 30) * 10) / 10;
    const defaultUnusedLeaveDays = Math.max(0, Math.round((totalEntitledLeaveDays - totalUsedLeaveDays) * 10) / 10);
    const unusedLeaveDays = formUnusedLeaveDays !== '' ? (parseFloat(toEnglishDigits(formUnusedLeaveDays)) || 0) : defaultUnusedLeaveDays;
    const defaultUnusedLeaveAmount = Math.round(unusedLeaveDays * lastDailySalary);
    const unusedLeaveAmount = formUnusedLeaveAmount !== '' ? parseNumber(formUnusedLeaveAmount) : defaultUnusedLeaveAmount;

    // جمع کل مطالبات ناخالص (خالص حقوق ماه‌ها + سنوات + عیدی + مانده مرخصی)
    const totalGrossPayable = totalNetSalaries + severanceAmount + bonusAmount + unusedLeaveAmount;

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
      totalOvertimeHours,
      totalHolidayWorkHours,
      totalFridayWorkHours,
      totalOvertimeAmounts,
      totalHolidayWorkAmounts,
      totalFridayWorkAmounts,
      totalGrossSalaries,
      totalInsurableGross,
      totalWorkerInsurance,
      totalNetSalaries,
      totalUsedLeaveDays,
      defaultLastDailySalary,
      lastDailySalary,
      lastMonthlyBaseSalary,
      severanceDays,
      defaultSeveranceAmount,
      severanceAmount,
      bonusDays,
      defaultBonusAmount,
      bonusAmount,
      totalEntitledLeaveDays,
      defaultUnusedLeaveDays,
      unusedLeaveDays,
      defaultUnusedLeaveAmount,
      unusedLeaveAmount,
      totalGrossPayable,
      purchasesAmount,
      otherDeductions,
      totalDeductions,
      employerPaid,
      finalNetPayable
    };
  }, [
    formMonthlyDetails, 
    selectedContract, 
    formPurchasesAmount, 
    formOtherDeductionsAmount, 
    formEmployerPaidAmount,
    formDailySalaryOverride,
    formSeveranceAmount,
    formBonusAmount,
    formUnusedLeaveDays,
    formUnusedLeaveAmount
  ]);

  // Open Add Modal
  const handleOpenAdd = () => {
    setEditingId(null);
    const firstEmp = personnelList[0];
    const empCode = firstEmp?.employeeCode || '';
    setFormEmployeeCode(empCode);
    setFormReason('contract_end');
    setFormSettlementDate(getTodayJalali());
    setFormPurchasesAmount('0');
    setFormOtherDeductionsAmount('0');
    setFormOtherDeductionsDescription('');
    setFormEmployerPaidAmount('0');
    setFormDailySalaryOverride('');
    setFormSeveranceAmount('');
    setFormBonusAmount('');
    setFormUnusedLeaveDays('');
    setFormUnusedLeaveAmount('');
    setFormStatus('finalized');
    setFormNotes('');
    setBulkOvertime('');
    setBulkFriday('');
    setBulkHoliday('');
    setBulkLeave('');

    const contracts = allContracts.filter(c => c.employeeCode === empCode);
    const contract = contracts[0];
    if (contract) {
      setFormContractId(contract.id);
      setFormStartDate(contract.contractStartDate);
      setFormEndDate(contract.contractEndDate);
      const generated = generateMonthsList(contract.contractStartDate, contract.contractEndDate, firstEmp, contract);
      setFormMonthlyDetails(generated);
    } else {
      setFormContractId('');
      const st = firstEmp?.entryDate || '1404/01/01';
      const en = '1404/12/29';
      setFormStartDate(st);
      setFormEndDate(en);
      const generated = generateMonthsList(st, en, firstEmp, undefined);
      setFormMonthlyDetails(generated);
    }

    setShowModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (settlement: PersonnelSettlement) => {
    setEditingId(settlement.id);
    setFormEmployeeCode(settlement.employeeCode);
    setFormContractId(settlement.contractId || '');
    setFormReason(settlement.reason);
    setFormStartDate(settlement.startDate);
    setFormEndDate(settlement.endDate);
    setFormSettlementDate(settlement.settlementDate);
    setFormPurchasesAmount(formatWithCommas(settlement.personnelPurchasesAmount));
    setFormOtherDeductionsAmount(formatWithCommas(settlement.otherDeductionsAmount));
    setFormOtherDeductionsDescription(settlement.otherDeductionsDescription || '');
    setFormEmployerPaidAmount(formatWithCommas(settlement.employerPaidAmount));
    setFormDailySalaryOverride(settlement.dailySalaryForCalculation ? formatWithCommas(settlement.dailySalaryForCalculation) : '');
    setFormSeveranceAmount(settlement.severanceAmount !== undefined ? formatWithCommas(settlement.severanceAmount) : '');
    setFormBonusAmount(settlement.bonusAmount !== undefined ? formatWithCommas(settlement.bonusAmount) : '');
    setFormUnusedLeaveDays(settlement.unusedLeaveDays !== undefined ? String(settlement.unusedLeaveDays) : '');
    setFormUnusedLeaveAmount(settlement.unusedLeaveAmount !== undefined ? formatWithCommas(settlement.unusedLeaveAmount) : '');
    setFormStatus(settlement.status);
    setFormNotes(settlement.notes || '');
    setFormMonthlyDetails(settlement.monthlyDetails || []);
    setShowModal(true);
  };

  // Save Settlement
  const handleSaveSettlement = () => {
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
    const emp = personnelList.find(p => p.employeeCode === formEmployeeCode);

    // Auto settlement number
    const yearPrefix = formSettlementDate.split('/')[0] || activePeriodId.split('-')[0] || '1405';
    const autoNumber = `SET-${yearPrefix}-${String(currentList.length + 1).padStart(3, '0')}`;

    const newRecord: PersonnelSettlement = {
      id: editingId || `settle-${Date.now()}`,
      periodId: activePeriodId,
      settlementNo: editingId ? (currentList.find(s => s.id === editingId)?.settlementNo || autoNumber) : autoNumber,
      employeeCode: formEmployeeCode,
      contractId: formContractId || undefined,
      reason: formReason,
      startDate: formStartDate,
      endDate: formEndDate,
      settlementDate: formSettlementDate,
      totalPeriodDays: formMonthlyDetails.reduce((sum, m) => sum + m.totalDaysInMonth, 0),
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
      totalUsedLeaveDays: settlementSummary.totalUsedLeaveDays,
      unusedLeaveDays: settlementSummary.unusedLeaveDays,
      unusedLeaveAmount: settlementSummary.unusedLeaveAmount,
      totalGrossPayable: settlementSummary.totalGrossPayable,
      personnelPurchasesAmount: settlementSummary.purchasesAmount,
      otherDeductionsAmount: settlementSummary.otherDeductions,
      otherDeductionsDescription: formOtherDeductionsDescription.trim(),
      totalDeductions: settlementSummary.totalDeductions,
      employerPaidAmount: settlementSummary.employerPaid,
      finalNetPayable: settlementSummary.finalNetPayable,
      status: formStatus,
      notes: formNotes.trim(),
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

    onUpdateDb({
      ...db,
      personnelSettlements: updatedList
    });

    setShowModal(false);
    alert('سند تسویه حساب پرسنل با موفقیت ثبت و ذخیره گردید.');
  };

  // Delete Settlement
  const handleDelete = (id: string, settleNo: string) => {
    if (confirm(`آیا از حذف سند تسویه حساب شماره ${settleNo} اطمینان دارید؟`)) {
      const updatedList = (db.personnelSettlements || []).filter(s => s.id !== id);
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
      const reasonLabel = s.reason === 'contract_end' ? 'اتمام قرارداد' : s.reason === 'dismissal' ? 'اخراج' : 'استعفا';
      const statusLabel = s.status === 'paid' ? 'پرداخت شده' : s.status === 'finalized' ? 'قطعی' : 'پیش‌نویس';

      return {
        'ردیف': idx + 1,
        'شماره تسویه': s.settlementNo,
        'کد پرسنلی': s.employeeCode,
        'نام و نام خانوادگی': empName,
        'علت تسویه': reasonLabel,
        'تاریخ شروع خدمت': s.startDate,
        'تاریخ پایان خدمت': s.endDate,
        'کل روزهای کارکرد': s.totalWorkedDays || 0,
        'حقوق و مزایای خالص': s.totalNetSalaries || 0,
        'حق سنوات خدمت': s.severanceAmount || 0,
        'عیدی و پاداش': s.bonusAmount || 0,
        'مانده مرخصی (روز)': s.unusedLeaveDays || 0,
        'مبلغ مانده مرخصی': s.unusedLeaveAmount || 0,
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
      'مانده مرخصی (روز)',
      'مبلغ مانده مرخصی',
      'خرید پرسنل',
      'سایر کسورات',
      'پرداختی کارفرما',
      'خالص قابل پرداخت تسویه',
      'وضعیت'
    ];

    const rows = filteredSettlements.map(s => {
      const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
      const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
      const reasonLabel = s.reason === 'contract_end' ? 'اتمام قرارداد' : s.reason === 'dismissal' ? 'اخراج' : 'استعفا';
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
        s.unusedLeaveDays,
        s.unusedLeaveAmount,
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
    const yearPrefix = formSettlementDate.split('/')[0] || activePeriodId.split('-')[0] || '1405';
    const autoNumber = `SET-${yearPrefix}-${String(currentList.length + 1).padStart(3, '0')}`;

    const draftRecord: PersonnelSettlement = {
      id: editingId || `settle-draft-preview`,
      periodId: activePeriodId,
      settlementNo: editingId ? (currentList.find(s => s.id === editingId)?.settlementNo || autoNumber) : autoNumber,
      employeeCode: formEmployeeCode,
      contractId: formContractId || undefined,
      reason: formReason,
      startDate: formStartDate,
      endDate: formEndDate,
      settlementDate: formSettlementDate,
      totalPeriodDays: formMonthlyDetails.reduce((sum, m) => sum + m.totalDaysInMonth, 0),
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
      totalUsedLeaveDays: settlementSummary.totalUsedLeaveDays,
      unusedLeaveDays: settlementSummary.unusedLeaveDays,
      unusedLeaveAmount: settlementSummary.unusedLeaveAmount,
      totalGrossPayable: settlementSummary.totalGrossPayable,
      personnelPurchasesAmount: settlementSummary.purchasesAmount,
      otherDeductionsAmount: settlementSummary.otherDeductions,
      otherDeductionsDescription: formOtherDeductionsDescription.trim(),
      totalDeductions: settlementSummary.totalDeductions,
      employerPaidAmount: settlementSummary.employerPaid,
      finalNetPayable: settlementSummary.finalNetPayable,
      status: formStatus,
      notes: formNotes.trim(),
      registeredBy: db.currentUser?.fullName || 'مدیر سیستم',
      createdAt: getTodayJalali(),
      updatedAt: getTodayJalali()
    };
    setPrintingSettlement(draftRecord);
  };

  // Open Full Screen Preview and Print Form
  const handlePrint = (settlement: PersonnelSettlement) => {
    setPrintingSettlement(settlement);
  };

  // Copy summary to clipboard
  const handleCopySummary = (s: PersonnelSettlement, empName: string) => {
    const text = `برگه تسویه حساب رسمی پرسنل: ${empName}
شماره سند: ${s.settlementNo}
دوره کارکرد: ${s.startDate} تا ${s.endDate} (${s.totalWorkedDays} روز)
خالص حقوق و دستمزد ماه‌ها: ${formatWithCommas(s.totalNetSalaries)} ریال
حق سنوات پایان خدمت: ${formatWithCommas(s.severanceAmount)} ریال
عیدی و پاداش سالانه: ${formatWithCommas(s.bonusAmount)} ریال
بازخرید مانده مرخصی: ${formatWithCommas(s.unusedLeaveAmount)} ریال (${s.unusedLeaveDays} روز)
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
            onClick={handleOpenAdd}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-xs font-black text-white rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-rose-600/25 border border-rose-500/40"
          >
            <Plus className="h-4 w-4" />
            محاسبه و صدور تسویه حساب جدید
          </button>
        </div>
      </div>

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
                <th className="p-3.5 text-left">کسورات و پرداختی</th>
                <th className="p-3.5 text-left font-black text-rose-400">مبلغ قابل پرداخت</th>
                <th className="p-3.5 text-center">وضعیت</th>
                <th className="p-3.5 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850/60">
              {filteredSettlements.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-12 text-center text-slate-400">
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
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          s.reason === 'contract_end' 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : s.reason === 'dismissal' 
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {s.reason === 'contract_end' ? 'اتمام قرارداد' : s.reason === 'dismissal' ? 'اخراج' : 'استعفا'}
                        </span>
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

                      <td className="p-3.5 text-left font-mono text-indigo-400 font-medium">
                        {formatWithCommas(s.unusedLeaveAmount)}
                        <span className="block text-[10px] text-slate-400 font-sans">
                          {toPersianDigits(s.unusedLeaveDays)} روز مانده
                        </span>
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
                          <button
                            type="button"
                            title="ویرایش تسویه حساب"
                            onClick={() => handleOpenEdit(s)}
                            className="p-1.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                          >
                            <Edit3 className="h-4 w-4 text-amber-400" />
                          </button>
                          <button
                            type="button"
                            title="حذف تسویه حساب"
                            onClick={() => handleDelete(s.id, s.settlementNo)}
                            className="p-1.5 text-slate-300 hover:text-rose-400 bg-slate-800 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
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

      {/* ======================================================== */}
      {/* MODAL: CREATE / EDIT SETTLEMENT WIZARD */}
      {/* ======================================================== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-850 bg-slate-900/60">
              <div className="flex items-center gap-3">
                <div className="bg-rose-500/20 p-2.5 rounded-xl border border-rose-500/30 text-rose-400">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    {editingId ? 'ویرایش و بازبینی تسویه حساب پرسنل' : 'محاسبه و صدور سند تسویه حساب پرسنل'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    تنظیم بر اساس مشخصات قرارداد، قوانین کار ایران، ماه‌های ۳۱ روزه، سنوات، عیدی و مرخصی
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* SECTION 1: PERSONNEL & CONTRACT SELECTION */}
              <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-850 space-y-4">
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-rose-400" />
                  مرحله ۱: انتخاب پرسنل، قرارداد و علت تسویه حساب
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">انتخاب پرسنل *</label>
                    <select
                      value={formEmployeeCode}
                      onChange={e => handleEmployeeSelect(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-hidden focus:border-rose-500"
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
                      onChange={e => handleContractSelect(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-hidden focus:border-rose-500"
                    >
                      <option value="">-- قرارداد پیش‌فرض پرونده پرسنلی --</option>
                      {employeeContracts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.role || 'قرارداد کاری'} ({toPersianDigits(c.contractStartDate)} الی {toPersianDigits(c.contractEndDate)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">علت قطع همکاری و تسویه *</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleReasonChange('contract_end')}
                        className={`py-2 px-1 text-[11px] font-bold rounded-lg border text-center transition-all cursor-pointer ${
                          formReason === 'contract_end' 
                            ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500' 
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        اتمام قرارداد
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReasonChange('dismissal')}
                        className={`py-2 px-1 text-[11px] font-bold rounded-lg border text-center transition-all cursor-pointer ${
                          formReason === 'dismissal' 
                            ? 'bg-rose-600/30 text-rose-300 border-rose-500' 
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        اخراج
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReasonChange('resignation')}
                        className={`py-2 px-1 text-[11px] font-bold rounded-lg border text-center transition-all cursor-pointer ${
                          formReason === 'resignation' 
                            ? 'bg-amber-600/30 text-amber-300 border-amber-500' 
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        استعفا
                      </button>
                    </div>
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
                      value={formStartDate}
                      onChange={e => handleDateChangeAndRecalculate(e.target.value, formEndDate)}
                      placeholder="1404/01/01"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-center text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      {formReason === 'contract_end' 
                        ? 'تاریخ پایان قرارداد (اتمام قرارداد)' 
                        : 'تاریخ اتمام کار و قطع همکاری *'}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={formEndDate}
                      onChange={e => handleDateChangeAndRecalculate(formStartDate, e.target.value)}
                      placeholder="1404/12/29"
                      className={`w-full bg-slate-950 border rounded-lg p-2.5 text-xs text-center text-white font-mono ${
                        formReason !== 'contract_end' ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800'
                      }`}
                    />
                    {formReason !== 'contract_end' && (
                      <span className="text-[10px] text-amber-400 mt-1 block">
                        در علت اخراج یا استعفا، تاریخ دقیق آخرین روز حضور و کارکرد را وارد کنید.
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">تاریخ صدور برگه تسویه</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={formSettlementDate}
                      onChange={e => setFormSettlementDate(e.target.value)}
                      placeholder={getTodayJalali()}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-center text-white font-mono"
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
                      <button
                        type="button"
                        onClick={() => {
                          const generated = generateMonthsList(formStartDate, formEndDate, selectedPersonnel, selectedContract);
                          setFormMonthlyDetails(generated);
                        }}
                        className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 rounded-md border border-rose-500/30 text-[11px] font-bold cursor-pointer transition-colors"
                      >
                        بازسازی ماه‌های کارکرد بر اساس تاریخ‌ها
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-850/80 text-[11px]">
                      <div className="flex items-center gap-1.5 bg-amber-950/40 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg">
                        <Clock className="h-3.5 w-3.5 text-amber-400" />
                        <span>نرخ ساعتی اضافه‌کار و تعطیل‌کاری ثوابت سال تسویه حساب ({toPersianDigits(settlementYear)} - مبنای ۸ ساعت):</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(settlementOvertimeHourlyRate))}</strong>
                        <span className="text-[10px] text-amber-200/80">ریال/ساعت</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-sky-950/40 text-sky-300 border border-sky-500/30 px-2.5 py-1 rounded-lg">
                        <span>بن خواربار ماهانه:</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(contractSalaryRate?.foodAllowance || 0))}</strong>
                        <span className="text-[10px] text-sky-200/80">ریال</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                        <span>حق مسکن ماهانه:</span>
                        <strong className="font-mono text-white font-bold">{toPersianDigits(formatWithCommas(contractSalaryRate?.housingAllowance || 0))}</strong>
                        <span className="text-[10px] text-emerald-200/80">ریال</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: MONTHLY BREAKDOWN TABLE */}
              <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-850 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-emerald-400" />
                      مرحله ۲: کارکرد ماه به ماه دوره تسویه و اقلام حقوق و دستمزد (امکان ویرایش مستقیم کلیه اعداد)
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      محاسبه اضافه کار و تعطیل‌کاری بر مبنای نرخ اضافه کاری ساعتی درج شده در قوانین و ثوابت دستمزد متناسب با سال تسویه حساب ({toPersianDigits(settlementYear)} - {toPersianDigits(formatWithCommas(settlementOvertimeHourlyRate))} ریال بر مبنای ۸ ساعت کار و نه ۷.۳۳) و حق بن و مسکن متناسب با کارکرد در ماه‌های کمتر از یک ماه اعمال می‌گردد.
                    </p>
                  </div>

                  {/* Bulk Input Toolbar & Recalculate All */}
                  <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={handleResetAllMonthsToFormula}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-bold cursor-pointer transition-colors flex items-center gap-1 border border-slate-700"
                      title="محاسبه مجدد تمام ماه‌ها طبق فرمول‌های قانونی و آیتم‌های مشمول بیمه"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
                      محاسبه مجدد همه
                    </button>
                    <span className="text-[11px] text-slate-300 font-bold mr-1">ورود سریع:</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="ساعت اضافه"
                      value={bulkOvertime}
                      onChange={e => setBulkOvertime(e.target.value)}
                      className="w-24 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 rounded px-2 py-1 text-xs text-center text-amber-300 font-mono font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      title="ساعت اضافه‌کاری برای همه ماه‌ها"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="ساعت جمعه"
                      value={bulkFriday}
                      onChange={e => setBulkFriday(e.target.value)}
                      className="w-24 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 rounded px-2 py-1 text-xs text-center text-amber-300 font-mono font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      title="ساعت جمعه‌کاری برای همه ماه‌ها"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="ساعت تعطیل"
                      value={bulkHoliday}
                      onChange={e => setBulkHoliday(e.target.value)}
                      className="w-24 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 rounded px-2 py-1 text-xs text-center text-amber-300 font-mono font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      title="ساعت تعطیل‌کاری برای همه ماه‌ها"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      placeholder="روز مرخصی"
                      value={bulkLeave}
                      onChange={e => setBulkLeave(e.target.value)}
                      className="w-22 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-sky-400 rounded px-2 py-1 text-xs text-center text-sky-300 font-mono font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      title="مرخصی استفاده شده ماه برای همه ماه‌ها"
                    />
                    <button
                      type="button"
                      onClick={handleApplyBulk}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      اعمال به همه
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-right text-[11px] border-collapse">
                    <thead className="bg-slate-950 text-slate-300 border-b border-slate-800 font-bold whitespace-nowrap">
                      <tr>
                        <th className="p-2">ماه</th>
                        <th className="p-2 w-16 text-center">کارکرد</th>
                        <th className="p-2 w-16 text-center">مرخصی</th>
                        <th className="p-2 text-left">حقوق پایه</th>
                        <th className="p-2 text-left">بن خواربار</th>
                        <th className="p-2 text-left">حق مسکن</th>
                        <th className="p-2 text-left">حق اولاد</th>
                        <th className="p-2 text-left">حق تاهل</th>
                        <th className="p-2 text-center min-w-[210px]">
                          <div className="font-bold text-slate-200 flex items-center justify-center gap-1">
                            <span>اضافه‌کار</span>
                            {settlementOvertimeHourlyRate ? (
                              <span className="text-[9px] text-amber-400 font-mono font-normal">
                                ({toPersianDigits(formatWithCommas(settlementOvertimeHourlyRate))})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[9.5px] text-slate-400 font-normal flex items-center justify-center gap-2 mt-0.5">
                            <span className="text-amber-300 font-semibold">ساعت کار</span>
                            <span>|</span>
                            <span className="text-slate-300">مبلغ (ریال)</span>
                          </div>
                        </th>
                        <th className="p-2 text-center min-w-[210px]">
                          <div className="font-bold text-slate-200">جمعه‌کاری (۴۰٪)</div>
                          <div className="text-[9.5px] text-slate-400 font-normal flex items-center justify-center gap-2 mt-0.5">
                            <span className="text-amber-300 font-semibold">ساعت کار</span>
                            <span>|</span>
                            <span className="text-slate-300">مبلغ (ریال)</span>
                          </div>
                        </th>
                        <th className="p-2 text-center min-w-[210px]">
                          <div className="font-bold text-slate-200 flex items-center justify-center gap-1">
                            <span>تعطیل‌کاری</span>
                            {settlementOvertimeHourlyRate ? (
                              <span className="text-[9px] text-amber-400 font-mono font-normal">
                                ({toPersianDigits(formatWithCommas(settlementOvertimeHourlyRate))})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[9.5px] text-slate-400 font-normal flex items-center justify-center gap-2 mt-0.5">
                            <span className="text-amber-300 font-semibold">ساعت کار</span>
                            <span>|</span>
                            <span className="text-slate-300">مبلغ (ریال)</span>
                          </div>
                        </th>
                        <th className="p-2 text-left text-amber-300">ناخالص ماه</th>
                        <th className="p-2 text-left text-sky-400">مشمول بیمه</th>
                        <th className="p-2 text-left text-rose-400">بیمه ۷٪</th>
                        <th className="p-2 text-left text-emerald-400">خالص ماه</th>
                        <th className="p-2 text-center">بازنشانی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 bg-slate-950/40">
                      {formMonthlyDetails.map((m, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/30">
                          <td className="p-2 font-bold text-white whitespace-nowrap">
                            {m.monthName}
                            <span className="block text-[9px] text-slate-400 font-normal">
                              طول: {toPersianDigits(m.totalDaysInMonth)} روز
                            </span>
                          </td>

                          {/* کارکرد */}
                          <td className="p-1 text-center">
                            <input
                              type="number"
                              min={0}
                              max={m.totalDaysInMonth}
                              dir="ltr"
                              value={m.workedDays}
                              onChange={e => handleMonthFieldChange(idx, 'workedDays', parseNumber(e.target.value))}
                              className="w-16 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-rose-500 rounded p-1 text-center font-mono font-bold text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              title="روزهای کارکرد ماه"
                            />
                          </td>

                          {/* مرخصی */}
                          <td className="p-1 text-center">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              dir="ltr"
                              value={m.usedLeaveDays}
                              onChange={e => handleMonthFieldChange(idx, 'usedLeaveDays', parseNumber(e.target.value))}
                              className="w-16 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-rose-500 rounded p-1 text-center font-mono text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              title="مرخصی استفاده شده ماه"
                            />
                          </td>

                          {/* حقوق پایه */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.baseSalary)}
                              onChange={e => handleMonthAmountChange(idx, 'baseSalary', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-slate-750 rounded p-1 text-left font-mono text-[11px] text-white focus:border-sky-500"
                              title="حقوق پایه ماه"
                            />
                          </td>

                          {/* بن خواربار */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.foodAllowance)}
                              onChange={e => handleMonthAmountChange(idx, 'foodAllowance', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-slate-750 rounded p-1 text-left font-mono text-[11px] text-white focus:border-sky-500"
                              title="بن خواربار ماه"
                            />
                          </td>

                          {/* حق مسکن */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.housingAllowance)}
                              onChange={e => handleMonthAmountChange(idx, 'housingAllowance', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-slate-750 rounded p-1 text-left font-mono text-[11px] text-white focus:border-sky-500"
                              title="حق مسکن ماه"
                            />
                          </td>

                          {/* حق اولاد */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.childAllowance)}
                              onChange={e => handleMonthAmountChange(idx, 'childAllowance', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-slate-750 rounded p-1 text-left font-mono text-[11px] text-white focus:border-sky-500"
                              title="حق اولاد ماه"
                            />
                          </td>

                          {/* حق تاهل */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.marriageAllowance)}
                              onChange={e => handleMonthAmountChange(idx, 'marriageAllowance', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-slate-750 rounded p-1 text-left font-mono text-[11px] text-white focus:border-sky-500"
                              title="حق تاهل ماه"
                            />
                          </td>

                          {/* اضافه‌کاری: ساعت + مبلغ */}
                          <td className="p-1 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 justify-center">
                              <div className="relative flex items-center" title={`ساعت اضافه‌کاری (محاسبه بر اساس نرخ مصوب سال تسویه حساب ${toPersianDigits(settlementYear)} بر مبنای ۸ ساعت کار: ${toPersianDigits(formatWithCommas(m.overtimeHourlyRate || settlementOvertimeHourlyRate))} ریال)`}>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  dir="ltr"
                                  value={m.overtimeHours}
                                  onChange={e => handleMonthFieldChange(idx, 'overtimeHours', parseNumber(e.target.value))}
                                  className="w-20 sm:w-22 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 rounded-md px-2 py-1 text-center font-mono font-bold text-xs text-amber-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                  placeholder="۰"
                                />
                                <span className="text-[9px] text-slate-500 absolute left-1.5 pointer-events-none select-none font-sans">س</span>
                              </div>
                              <div className="relative flex items-center" title="مبلغ اضافه‌کاری (ریال)">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={formatWithCommas(m.overtimeAmount)}
                                  onChange={e => handleMonthAmountChange(idx, 'overtimeAmount', parseNumber(e.target.value))}
                                  className="w-26 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 rounded-md px-2 py-1 text-left font-mono text-xs text-white transition-colors"
                                  placeholder="۰"
                                />
                              </div>
                            </div>
                          </td>

                          {/* جمعه‌کاری: ساعت + مبلغ */}
                          <td className="p-1 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 justify-center">
                              <div className="relative flex items-center" title="ساعت جمعه‌کاری">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  dir="ltr"
                                  value={m.fridayWorkHours}
                                  onChange={e => handleMonthFieldChange(idx, 'fridayWorkHours', parseNumber(e.target.value))}
                                  className="w-20 sm:w-22 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 rounded-md px-2 py-1 text-center font-mono font-bold text-xs text-amber-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                  placeholder="۰"
                                />
                                <span className="text-[9px] text-slate-500 absolute left-1.5 pointer-events-none select-none font-sans">س</span>
                              </div>
                              <div className="relative flex items-center" title="مبلغ جمعه‌کاری (بر اساس نرخ ساعتی جمعه‌کاری)">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={formatWithCommas(m.fridayWorkAmount)}
                                  onChange={e => handleMonthAmountChange(idx, 'fridayWorkAmount', parseNumber(e.target.value))}
                                  className="w-26 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 rounded-md px-2 py-1 text-left font-mono text-xs text-white transition-colors"
                                  placeholder="۰"
                                />
                              </div>
                            </div>
                          </td>

                          {/* تعطیل‌کاری: ساعت + مبلغ */}
                          <td className="p-1 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 justify-center">
                              <div className="relative flex items-center" title={`ساعت تعطیل‌کاری (محاسبه بر اساس نرخ مصوب سال تسویه حساب ${toPersianDigits(settlementYear)} بر مبنای ۸ ساعت کار: ${toPersianDigits(formatWithCommas(m.holidayHourlyRate || settlementOvertimeHourlyRate))} ریال)`}>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  dir="ltr"
                                  value={m.holidayWorkHours}
                                  onChange={e => handleMonthFieldChange(idx, 'holidayWorkHours', parseNumber(e.target.value))}
                                  className="w-20 sm:w-22 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 rounded-md px-2 py-1 text-center font-mono font-bold text-xs text-amber-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                                  placeholder="۰"
                                />
                                <span className="text-[9px] text-slate-500 absolute left-1.5 pointer-events-none select-none font-sans">س</span>
                              </div>
                              <div className="relative flex items-center" title="مبلغ تعطیل‌کاری (ریال)">
                                <input
                                  type="text"
                                  dir="ltr"
                                  value={formatWithCommas(m.holidayWorkAmount)}
                                  onChange={e => handleMonthAmountChange(idx, 'holidayWorkAmount', parseNumber(e.target.value))}
                                  className="w-26 bg-slate-900 border border-slate-750 hover:border-slate-600 focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 rounded-md px-2 py-1 text-left font-mono text-xs text-white transition-colors"
                                  placeholder="۰"
                                />
                              </div>
                            </div>
                          </td>

                          {/* ناخالص ماه */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.grossSalary)}
                              onChange={e => handleMonthAmountChange(idx, 'grossSalary', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-amber-500/40 rounded p-1 text-left font-mono font-bold text-[11px] text-amber-300"
                              title="جمع ناخالص حقوق و مزایای ماه"
                            />
                          </td>

                          {/* مشمول بیمه */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.insurableGross || 0)}
                              onChange={e => handleMonthAmountChange(idx, 'insurableGross', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-sky-500/40 rounded p-1 text-left font-mono text-[11px] text-sky-300 font-bold"
                              title="مبلغ مشمول کسر بیمه بر اساس آیتم‌های مشمول بیمه"
                            />
                          </td>

                          {/* بیمه ۷٪ */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.workerInsuranceShare)}
                              onChange={e => handleMonthAmountChange(idx, 'workerInsuranceShare', parseNumber(e.target.value))}
                              className="w-20 bg-slate-900 border border-rose-500/40 rounded p-1 text-left font-mono text-[11px] text-rose-400 font-bold"
                              title="حق بیمه سهم کارگر (۷ درصد)"
                            />
                          </td>

                          {/* خالص ماه */}
                          <td className="p-1">
                            <input
                              type="text"
                              dir="ltr"
                              value={formatWithCommas(m.netSalaryPayable)}
                              onChange={e => handleMonthAmountChange(idx, 'netSalaryPayable', parseNumber(e.target.value))}
                              className="w-24 bg-slate-900 border border-emerald-500/40 rounded p-1 text-left font-mono font-bold text-[11px] text-emerald-400"
                              title="خالص حقوق پرداختی ماه"
                            />
                          </td>

                          {/* دکمه بازنشانی ردیف */}
                          <td className="p-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleResetMonthToFormula(idx)}
                              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                              title="محاسبه مجدد این ماه با فرمول قانونی خودکار"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950 font-bold border-t border-slate-800 text-slate-300">
                      <tr>
                        <td className="p-2 whitespace-nowrap">مجموع ({toPersianDigits(formMonthlyDetails.length)} ماه)</td>
                        <td className="p-2 text-center text-white font-mono">{toPersianDigits(settlementSummary.totalWorkedDays)}</td>
                        <td className="p-2 text-center text-white font-mono">{toPersianDigits(settlementSummary.totalUsedLeaveDays)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalBaseSalaries)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalFoodAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalHousingAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalChildAllowances)}</td>
                        <td className="p-2 text-left font-mono text-white">{formatWithCommas(settlementSummary.totalMarriageAllowances)}</td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex items-center justify-between gap-1 text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10" title="مجموع ساعات اضافه‌کاری">
                              {toPersianDigits(settlementSummary.totalOvertimeHours)} س
                            </span>
                            <span className="text-white" title="مجموع مبلغ اضافه‌کاری">
                              {formatWithCommas(settlementSummary.totalOvertimeAmounts)}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex items-center justify-between gap-1 text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10" title="مجموع ساعات جمعه‌کاری">
                              {toPersianDigits(settlementSummary.totalFridayWorkHours)} س
                            </span>
                            <span className="text-white" title="مجموع مبلغ جمعه‌کاری">
                              {formatWithCommas(settlementSummary.totalFridayWorkAmounts)}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono">
                          <div className="flex items-center justify-between gap-1 text-[11px]">
                            <span className="text-amber-300 font-bold px-1 rounded bg-amber-400/10" title="مجموع ساعات تعطیل‌کاری">
                              {toPersianDigits(settlementSummary.totalHolidayWorkHours)} س
                            </span>
                            <span className="text-white" title="مجموع مبلغ تعطیل‌کاری">
                              {formatWithCommas(settlementSummary.totalHolidayWorkAmounts)}
                            </span>
                          </div>
                        </td>
                        <td className="p-2 text-left font-mono text-amber-300 font-black">{formatWithCommas(settlementSummary.totalGrossSalaries)}</td>
                        <td className="p-2 text-left font-mono text-sky-400 font-bold">{formatWithCommas(settlementSummary.totalInsurableGross)}</td>
                        <td className="p-2 text-left font-mono text-rose-400 font-bold">{formatWithCommas(settlementSummary.totalWorkerInsurance)}</td>
                        <td className="p-2 text-left font-mono text-emerald-400 font-black">{formatWithCommas(settlementSummary.totalNetSalaries)}</td>
                        <td className="p-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
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
                      value={formDailySalaryOverride !== '' ? formDailySalaryOverride : formatWithCommas(settlementSummary.defaultLastDailySalary)}
                      onChange={e => setFormDailySalaryOverride(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-28 bg-transparent text-xs text-white font-mono font-bold text-left focus:outline-hidden"
                      title="مزد روزانه مبنا برای سنوات، عیدی و بازخرید مرخصی"
                    />
                    <span className="text-[11px] text-slate-400">ریال</span>
                  </div>
                  {formDailySalaryOverride !== '' && (
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
                      {formSeveranceAmount !== '' && (
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
                      value={formSeveranceAmount !== '' ? formSeveranceAmount : formatWithCommas(settlementSummary.defaultSeveranceAmount)}
                      onChange={e => setFormSeveranceAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-750 focus:border-sky-500 rounded px-2.5 py-1.5 text-xs text-sky-300 font-mono font-black text-left"
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
                      {formBonusAmount !== '' && (
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
                      value={formBonusAmount !== '' ? formBonusAmount : formatWithCommas(settlementSummary.defaultBonusAmount)}
                      onChange={e => setFormBonusAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-750 focus:border-emerald-500 rounded px-2.5 py-1.5 text-xs text-emerald-300 font-mono font-black text-left"
                    />
                  </div>
                </div>

                {/* مانده مرخصی */}
                <div className="bg-slate-900/70 p-4 rounded-xl border border-indigo-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-indigo-400 text-xs flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      بازخرید مانده مرخصی (ماده ۶۴ و ۷۱)
                    </h5>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">
                      ۲.۵ روز در ماه
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex justify-between">
                    <span>کل استحقاقی: <strong className="text-white font-mono">{toPersianDigits(settlementSummary.totalEntitledLeaveDays)}</strong> روز</span>
                    <span>استفاده شده: <strong className="text-white font-mono">{toPersianDigits(settlementSummary.totalUsedLeaveDays)}</strong> روز</span>
                    <span>مانده: <strong className="text-indigo-300 font-mono font-bold">{toPersianDigits(settlementSummary.unusedLeaveDays)}</strong> روز</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 text-[10px] block mb-1">مانده روز:</span>
                        <input
                          type="number"
                          step="0.5"
                          dir="ltr"
                          value={formUnusedLeaveDays !== '' ? formUnusedLeaveDays : String(settlementSummary.defaultUnusedLeaveDays)}
                          onChange={e => {
                            const days = e.target.value;
                            setFormUnusedLeaveDays(days);
                            const numDays = parseFloat(toEnglishDigits(days)) || 0;
                            setFormUnusedLeaveAmount(formatWithCommas(Math.round(numDays * settlementSummary.lastDailySalary)));
                          }}
                          className="w-full bg-slate-950 border border-slate-750 focus:border-indigo-500 rounded px-2 py-1 text-xs text-indigo-300 font-mono font-bold text-center"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block mb-1">مبلغ بازخرید (ریال):</span>
                        <input
                          type="text"
                          dir="ltr"
                          value={formUnusedLeaveAmount !== '' ? formUnusedLeaveAmount : formatWithCommas(settlementSummary.defaultUnusedLeaveAmount)}
                          onChange={e => setFormUnusedLeaveAmount(formatWithCommas(parseNumber(e.target.value)))}
                          className="w-full bg-slate-950 border border-slate-750 focus:border-indigo-500 rounded px-2 py-1 text-xs text-indigo-300 font-mono font-black text-left"
                        />
                      </div>
                    </div>
                    {(formUnusedLeaveDays !== '' || formUnusedLeaveAmount !== '') && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormUnusedLeaveDays('');
                          setFormUnusedLeaveAmount('');
                        }}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        بازنشانی به فرمول ({toPersianDigits(settlementSummary.defaultUnusedLeaveDays)} روز - {formatWithCommas(settlementSummary.defaultUnusedLeaveAmount)} ریال)
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 4: DEDUCTIONS & EMPLOYER PAYMENTS */}
              <div className="bg-slate-900/70 p-4 rounded-xl border border-slate-850 space-y-4">
                <h4 className="font-extrabold text-white text-sm flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-amber-400" />
                  مرحله ۳: کسورات تسویه حساب، خرید دوره و پرداختی‌های کارفرما
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">
                      خرید طی دوره پرسنل (ریال)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={formPurchasesAmount}
                      onChange={e => setFormPurchasesAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono"
                      placeholder="0"
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
                      value={formOtherDeductionsAmount}
                      onChange={e => setFormOtherDeductionsAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono"
                      placeholder="0"
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
                      value={formEmployerPaidAmount}
                      onChange={e => setFormEmployerPaidAmount(formatWithCommas(parseNumber(e.target.value)))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white font-mono"
                      placeholder="0"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      مساعده‌ها، پیش‌پرداخت تسویه یا حقوق‌های پرداخت شده
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    توضیحات و مشخص کردن علت کسورات *
                  </label>
                  <input
                    type="text"
                    value={formOtherDeductionsDescription}
                    onChange={e => setFormOtherDeductionsDescription(e.target.value)}
                    placeholder="مثال: کسر بابت قسط وام قرض‌الحسنه و مانده فاکتور خرید فروردین و اردیبهشت..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:border-rose-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">وضعیت سند تسویه</label>
                    <select
                      value={formStatus}
                      onChange={e => setFormStatus(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
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
                      value={formNotes}
                      onChange={e => setFormNotes(e.target.value)}
                      placeholder="توضیحات تکمیلی پرونده تسویه حساب..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>

              {/* FINAL SUMMARY CARD */}
              <div className="bg-gradient-to-br from-rose-950/40 via-slate-950 to-slate-950 p-5 rounded-2xl border-2 border-rose-500/40 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-rose-300 font-extrabold block">خلاصه حساب تسویه نهایی:</span>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-1">
                      <span>کل مطالبات: <strong>{formatWithCommas(settlementSummary.totalGrossPayable)}</strong></span>
                      <span>-</span>
                      <span>کل کسورات: <strong className="text-rose-400">{formatWithCommas(settlementSummary.totalDeductions)}</strong></span>
                      <span>-</span>
                      <span>پرداختی قبلی کارفرما: <strong className="text-amber-400">{formatWithCommas(settlementSummary.employerPaid)}</strong></span>
                    </div>
                  </div>

                  <div className="text-left">
                    <span className="text-[11px] text-slate-400 block">مانده قابل پرداخت به پرسنل:</span>
                    <span className="text-2xl font-black text-rose-400 font-mono">
                      {formatWithCommas(settlementSummary.finalNetPayable)} <span className="text-xs text-slate-300 font-sans">ریال</span>
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-300 flex items-center gap-2">
                  <span className="text-rose-400 font-bold">معادل حروفی:</span>
                  <span className="text-white font-medium">{numberToWordsPersian(settlementSummary.finalNetPayable)} ریال</span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-850 bg-slate-900/80 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-bold text-slate-300 rounded-xl transition-colors cursor-pointer"
              >
                انصراف
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

                <button
                  type="button"
                  onClick={handleSaveSettlement}
                  className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-xs font-black text-white rounded-xl transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer border border-rose-500/40"
                >
                  <Check className="h-4 w-4" />
                  ثبت و ذخیره سند تسویه حساب
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ======================================================== */}
      {/* HIGH-FIDELITY OFFICIAL SETTLEMENT DOCUMENT (A4 FORM & PREVIEW) */}
      {/* ======================================================== */}
      {printingSettlement && typeof document !== 'undefined' && createPortal((() => {
        const s = printingSettlement;
        const emp = personnelList.find(p => p.employeeCode === s.employeeCode);
        const empName = emp ? (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`) : s.employeeCode;
        const reasonText = s.reason === 'contract_end' 
          ? 'اتمام مدت قرارداد کار' 
          : s.reason === 'dismissal' 
            ? 'فسخ قرارداد (پایان همکاری)' 
            : 'استعفای کتبی کارگر';

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
                      title="نمایش فرم رسمی همراه با جدول تفکیکی تمام ماه‌ها"
                    >
                      ریز اقلام ۱۲ ماهه
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
                        برگه تسویه حساب قطعی و مفاصاحساب پرسنل
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
                        <td className="p-1.5 border border-black bg-white font-bold text-black">علت قطع رابطه همکاری:</td>
                        <td className="p-1.5 border border-black bg-white font-black text-black">{reasonText}</td>
                      </tr>
                      <tr>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">تاریخ شروع کارکرد در دوره:</td>
                        <td className="p-1.5 border border-black bg-white font-sans font-black text-black">{toPersianDigits(s.startDate)}</td>
                        <td className="p-1.5 border border-black bg-white font-bold text-black">تاریخ خاتمه و قطع همکاری:</td>
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
                      return (
                        <table className="w-full border-collapse border-2 border-black text-[8.5px] text-black">
                          <thead className="bg-white text-black font-black text-center border-b-2 border-black">
                            <tr>
                              <th className="border border-black p-1">ماه</th>
                              <th className="border border-black p-1 w-6">کارکرد</th>
                              <th className="border border-black p-1 w-6">مرخصی</th>
                              <th className="border border-black p-1">حقوق پایه</th>
                              <th className="border border-black p-1">بن خواربار</th>
                              <th className="border border-black p-1">حق مسکن</th>
                              <th className="border border-black p-1">حق اولاد</th>
                              <th className="border border-black p-1">حق تاهل</th>
                              <th className="border border-black p-1">اضافه‌کاری (ساعت/ریال)</th>
                              <th className="border border-black p-1">جمعه‌کاری (۴۰٪)</th>
                              <th className="border border-black p-1">تعطیل‌کاری (ساعت/ریال)</th>
                              <th className="border border-black p-1 font-black">ناخالص</th>
                              <th className="border border-black p-1">مشمول بیمه</th>
                              <th className="border border-black p-1">بیمه ۷٪</th>
                              <th className="border border-black p-1 font-black">خالص ماه (ریال)</th>
                            </tr>
                          </thead>
                          <tbody className="text-center font-sans text-black font-bold">
                            {s.monthlyDetails?.map((m, idx) => (
                              <tr key={idx} className="bg-white">
                                <td className="border border-black p-1 font-sans font-black text-black">{m.monthName}</td>
                                <td className="border border-black p-1 font-black text-black">{toPersianDigits(m.workedDays)}</td>
                                <td className="border border-black p-1 text-black">{toPersianDigits(m.usedLeaveDays || 0)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.baseSalary)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.foodAllowance)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.housingAllowance)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.childAllowance)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.marriageAllowance)}</td>
                                <td className="border border-black p-1 text-center text-black">
                                  {m.overtimeHours > 0 ? (
                                    <div className="leading-tight">
                                      <span className="font-bold text-[8px] block">{toPersianDigits(m.overtimeHours)} ساعت</span>
                                      <span className="text-[8px] block text-left">{formatWithCommas(m.overtimeAmount)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-left block">{formatWithCommas(m.overtimeAmount)}</span>
                                  )}
                                </td>
                                <td className="border border-black p-1 text-center text-black">
                                  {m.fridayWorkHours > 0 ? (
                                    <div className="leading-tight">
                                      <span className="font-bold text-[8px] block">{toPersianDigits(m.fridayWorkHours)} ساعت</span>
                                      <span className="text-[8px] block text-left">{formatWithCommas(m.fridayWorkAmount)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-left block">{formatWithCommas(m.fridayWorkAmount)}</span>
                                  )}
                                </td>
                                <td className="border border-black p-1 text-center text-black">
                                  {m.holidayWorkHours > 0 ? (
                                    <div className="leading-tight">
                                      <span className="font-bold text-[8px] block">{toPersianDigits(m.holidayWorkHours)} ساعت</span>
                                      <span className="text-[8px] block text-left">{formatWithCommas(m.holidayWorkAmount)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-left block">{formatWithCommas(m.holidayWorkAmount)}</span>
                                  )}
                                </td>
                                <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.grossSalary)}</td>
                                <td className="border border-black p-1 text-left text-black">{formatWithCommas(m.insurableGross || 0)}</td>
                                <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.workerInsuranceShare)}</td>
                                <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(m.netSalaryPayable)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="total-row font-black font-sans">
                            <tr className="bg-white text-black border-t-2 border-black">
                              <td className="border border-black p-1 font-sans font-black text-black">جمع کل</td>
                              <td className="border border-black p-1 font-black text-black">{toPersianDigits(s.totalWorkedDays)}</td>
                              <td className="border border-black p-1 text-black">{toPersianDigits(s.totalUsedLeaveDays || 0)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalBaseSalaries)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalFoodAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalHousingAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalChildAllowances)}</td>
                              <td className="border border-black p-1 text-left text-black">{formatWithCommas(s.totalMarriageAllowances)}</td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewOtHours > 0 && (
                                  <span className="font-bold text-[8px] block">{toPersianDigits(totalPreviewOtHours)} ساعت</span>
                                )}
                                <span className="text-[8px] block text-left">{formatWithCommas(s.totalOvertimeAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewFriHours > 0 && (
                                  <span className="font-bold text-[8px] block">{toPersianDigits(totalPreviewFriHours)} ساعت</span>
                                )}
                                <span className="text-[8px] block text-left">{formatWithCommas(s.totalFridayWorkAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-center text-black">
                                {totalPreviewHolHours > 0 && (
                                  <span className="font-bold text-[8px] block">{toPersianDigits(totalPreviewHolHours)} ساعت</span>
                                )}
                                <span className="text-[8px] block text-left">{formatWithCommas(s.totalHolidayWorkAmounts)}</span>
                              </td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalGrossSalaries)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalInsurableGross || 0)}</td>
                              <td className="border border-black p-1 text-left font-black text-black">{formatWithCommas(s.totalWorkerInsurance)}</td>
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
                            بازخرید مانده مرخصی استحقاقی ({toPersianDigits(s.unusedLeaveDays)} روز):
                          </td>
                          <td className="p-1.5 border border-black bg-white text-left font-sans font-black text-black">{formatWithCommas(s.unusedLeaveAmount)} ریال</td>
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
                    اینجانب <strong>{empName}</strong> با شماره ملی <strong>{toPersianDigits(emp?.nationalId || '-')}</strong> و شماره بیمه <strong>{toPersianDigits(emp?.insuranceCode || '-')}</strong>، بدین‌وسیله با اراده کامل و سلامت عقل اقرار و اعلام می‌دارم که کلیه حقوق، دستمزد پایه، مزایای قانونی، بن خواربار، حق مسکن، حق اولاد، حق تاهل، اضافه کاری، جمعه کاری، تعطیل کاری، عیدی و پاداش سالانه، حق سنوات پایان خدمت و مانده مرخصی استحقاقی ذخیره‌شده خود در طول دوران اشتغال تا تاریخ خاتمه همکاری (<span className="font-sans font-bold">{toPersianDigits(s.endDate)}</span>) را طبق ارقام فوق‌الذکر به طور کامل و صحیح دریافت نموده‌ام و هیچ‌گونه ادعا، طلب، حق یا شکایتی تحت هیچ عنوان حقوقی، کیفری یا استخدامی در گذشته، حال و آینده علیه <strong>فروشگاه نان و شیرینی گاتان</strong> و کارفرما نداشته و اسقاط کافه خیارات و برائت ذمه قطعی و همه‌جانبه کارفرما را اعلام می‌دارم.
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
