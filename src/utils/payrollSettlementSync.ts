/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AppDatabase,
  AttendanceRecord,
  PayrollCalculationRules,
  PayrollItem,
  Personnel,
  PersonnelContract,
  PersonnelSettlement,
  SalaryBaseRate,
  SettlementReason,
  SettlementType
} from '../types';
import {
  isShiftAssignmentInMonth,
  normalizeJalaliDate,
  parseEffectiveDepartureLastWorkYM,
  parseShamsiYearMonth,
  toEnglishDigits,
  toPersianDigits
} from './persianUtils';

export const DEFAULT_MONTHLY_LEAVE_HM = '15:53';
export const DEFAULT_MONTHLY_LEAVE_MINUTES = 15 * 60 + 53; // 953 دقیقه (۱۵ ساعت و ۵۳ دقیقه)
export const DEFAULT_LEAVE_BUYOUT_ITEM_KEYS = [
  'dailyBaseSalary',
  'baseYearsRate',
  'foodAllowance',
  'housingAllowance',
  'marriageAllowance'
] as const;

export function parseMonthlyLeaveMinutes(value?: string | number | null): number {
  if (value === null || value === undefined) return DEFAULT_MONTHLY_LEAVE_MINUTES;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 60) : DEFAULT_MONTHLY_LEAVE_MINUTES;
  }
  const raw = toEnglishDigits(String(value)).trim();
  if (!raw) return DEFAULT_MONTHLY_LEAVE_MINUTES;
  const hmMatch = raw.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (hmMatch) {
    const hrs = parseInt(hmMatch[1], 10);
    const mins = Math.min(59, parseInt(hmMatch[2], 10));
    if (Number.isFinite(hrs) && Number.isFinite(mins)) {
      return Math.max(0, hrs * 60 + mins);
    }
  }
  const numeric = parseFloat(raw.replace(/٫/g, '.'));
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric * 60);
  }
  return DEFAULT_MONTHLY_LEAVE_MINUTES;
}

export function formatMonthlyLeaveHM(minutes: number, persian = false): string {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return persian ? toPersianDigits(formatted) : formatted;
}

export function normalizeMonthlyLeaveHMInput(value?: string | null): string {
  const raw = toEnglishDigits(String(value ?? '')).trim();
  if (!raw) return DEFAULT_MONTHLY_LEAVE_HM;
  return formatMonthlyLeaveHM(parseMonthlyLeaveMinutes(raw), false);
}

export function getMonthlyLeaveMinutesForYearMonth(
  db: AppDatabase,
  year: number | string,
  activePeriodId?: string
): number {
  const rates = db.salaryBaseRates || [];
  const yearStr = toEnglishDigits(String(year || '')).trim();
  let matched: SalaryBaseRate | undefined;
  if (yearStr) {
    matched =
      rates.find(r => toEnglishDigits(String(r.year || '')).trim() === yearStr && (!activePeriodId || r.periodId === activePeriodId)) ||
      rates.find(r => toEnglishDigits(String(r.year || '')).trim() === yearStr);
  }
  if (!matched && activePeriodId) {
    matched = rates.find(r => r.periodId === activePeriodId);
  }
  if (matched && matched.monthlyLeaveHours && String(matched.monthlyLeaveHours).trim() !== '') {
    return parseMonthlyLeaveMinutes(matched.monthlyLeaveHours);
  }
  return DEFAULT_MONTHLY_LEAVE_MINUTES;
}

export function getLeaveBuyoutSalaryItemsForContract(
  c: any,
  emp: any,
  db: AppDatabase,
  fallbackPeriodId: string
): { periodId: string; items: any[]; isConfigured: boolean } {
  const allItems = db.leaveBuyoutSalaryItems || [];
  if (allItems.length === 0) {
    return { periodId: fallbackPeriodId, items: [], isConfigured: false };
  }

  const getYear4 = (d?: string): string => {
    if (!d) return '';
    const m = toEnglishDigits(String(d)).match(/^(\d{4})/);
    return m ? m[1] : '';
  };

  const conStartRaw = c?.contractStartDate || emp?.contractStartDate || emp?.entryDate || c?.date || c?.monthDate || '';
  const conEndRaw = c?.contractEndDate || emp?.contractEndDate || '';
  const monthDateRaw = c?.monthDate || c?.date || '';

  const cleanConStart = conStartRaw ? normalizeJalaliDate(toEnglishDigits(String(conStartRaw))) : '';
  const cleanConEnd = conEndRaw ? normalizeJalaliDate(toEnglishDigits(String(conEndRaw))) : '';
  const cleanMonthDate = monthDateRaw ? normalizeJalaliDate(toEnglishDigits(String(monthDateRaw))) : '';

  // 1. Direct date range match / overlap
  if (cleanMonthDate || cleanConStart) {
    const matchedByRange = allItems.filter((item: any) => {
      const iStart = item.startDate
        ? normalizeJalaliDate(toEnglishDigits(String(item.startDate)))
        : (item.periodId ? `${String(item.periodId).substring(0, 4)}/01/01` : '');
      const iEnd = item.endDate
        ? normalizeJalaliDate(toEnglishDigits(String(item.endDate)))
        : (item.periodId ? `${String(item.periodId).substring(0, 4)}/12/29` : '');

      if (iStart && iEnd) {
        if (cleanMonthDate) {
          return cleanMonthDate >= iStart && cleanMonthDate <= iEnd;
        }
        if (cleanConStart && cleanConEnd) {
          return cleanConStart <= iEnd && cleanConEnd >= iStart;
        }
        if (cleanConStart) {
          return cleanConStart >= iStart && cleanConStart <= iEnd;
        }
      } else if (iStart && !iEnd) {
        if (cleanMonthDate) return cleanMonthDate >= iStart;
        if (cleanConEnd) return cleanConEnd >= iStart;
        if (cleanConStart) return cleanConStart >= iStart;
      } else if (!iStart && iEnd) {
        if (cleanMonthDate) return cleanMonthDate <= iEnd;
        if (cleanConStart) return cleanConStart <= iEnd;
      }
      return false;
    });

    if (matchedByRange.length > 0) {
      return {
        periodId: matchedByRange[0].periodId || fallbackPeriodId,
        items: matchedByRange,
        isConfigured: true
      };
    }
  }

  // 2. Match by target year (strictly scoped so an unregistered year falls back to default items)
  const year = getYear4(cleanMonthDate || cleanConStart) || getYear4(fallbackPeriodId);
  if (year) {
    const yearItems = allItems.filter((item: any) => {
      if (item.startDate && getYear4(item.startDate) === year) return true;
      if (item.endDate && getYear4(item.endDate) === year) return true;
      if (item.periodId && toEnglishDigits(String(item.periodId)).startsWith(year)) return true;
      return false;
    });
    if (yearItems.length > 0) {
      return {
        periodId: yearItems[0].periodId || fallbackPeriodId,
        items: yearItems,
        isConfigured: true
      };
    }
  }

  // 3. No configured rule for this year/range -> caller applies legal default items
  return { periodId: fallbackPeriodId, items: [], isConfigured: false };
}

export interface PayrollMonthSnapshot {
  year: number;
  month: number;
  sourceType: 'locked_payroll' | 'live_attendance';
  workedDays: number;
  overtimeHours: number;
  holidayWorkHours: number;
  fridayWorkHours: number;
  usedLeaveDays: number;
  usedLeaveHours: number;
  usedLeaveMinutes: number;
  finalLeaveMinutes: number;
  dailyBaseSalary: number;
  baseSalary: number;
  foodAllowance: number;
  housingAllowance: number;
  childAllowance: number;
  marriageAllowance: number;
  seniorityBase: number;
  monthlyEidi: number;
  monthlyYearsBenefit: number;
  jobAllowance: number;
  overtimeHourlyRate: number;
  overtimeAmount: number;
  holidayHourlyRate: number;
  holidayWorkAmount: number;
  fridayHourlyRate: number;
  fridayWorkAmount: number;
  grossSalary: number;
  insurableGross: number;
  workerInsuranceShare: number;
  payrollTax: number;
  supplementaryInsurance: number;
  deductionsAmount: number;
  netSalaryPayable: number;
  payrollItemPayable: number;
}

export function getShamsiMonthDaysHelper(jy: number, jm: number): number {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  if (jm === 12) {
    const r = jy % 33;
    const isLeap = [1, 5, 9, 13, 17, 22, 26, 30].includes(r);
    return isLeap ? 30 : 29;
  }
  return 30;
}

function normalizeDateStr(dateStr?: string | null): string {
  return normalizeJalaliDate(dateStr);
}

function cleanCodeNoZeros(c: any): string {
  const s = toEnglishDigits(String(c || '')).trim().toLowerCase();
  const noZeros = s.replace(/^0+/, '');
  return noZeros === '' && s !== '' ? '0' : noZeros;
}

function cleanAttCode(c: any): string {
  return toEnglishDigits(String(c || '')).trim().toLowerCase().replace(/^0+/, '');
}

function normEmpCode(c: any): string {
  return toEnglishDigits(String(c ?? '')).trim();
}

function parseHMToMinutes(hm?: string): number {
  if (!hm) return 0;
  const eng = toEnglishDigits(String(hm)).trim();
  const pts = eng.split(':');
  if (pts.length !== 2) return 0;
  return ((parseInt(pts[0], 10) || 0) * 60) + (parseInt(pts[1], 10) || 0);
}

function roundMinutesToHour(mins?: number): number {
  const res = Math.round((mins || 0) / 60);
  return res === 0 ? 0 : res;
}

function parseHMToRoundedHour(hm?: string, fallbackHours?: number): number {
  if (hm) {
    const eng = toEnglishDigits(String(hm)).trim();
    if (eng.includes(':')) {
      return roundMinutesToHour(parseHMToMinutes(eng));
    }
    const num = parseFloat(eng);
    if (!isNaN(num)) {
      const res = Math.round(num);
      return res === 0 ? 0 : res;
    }
  }
  const res = Math.round(fallbackHours || 0);
  return res === 0 ? 0 : res;
}

function timeToMinutes(timeStr?: string): number {
  if (!timeStr) return 0;
  const eng = toEnglishDigits(timeStr).trim();
  const parts = eng.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function normalizeWeekday(day: string): string {
  return (day || '').replace(/[\u200C\s-]/g, '');
}

const FA_WEEKDAYS_MAP = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
function getPersianWeekdayOfDate(dateStr: string): string {
  try {
    const cleanDate = toEnglishDigits(dateStr).replace(/\//g, '-');
    const parts = cleanDate.split('-');
    if (parts.length === 3) {
      const jy = parseInt(parts[0], 10);
      const jm = parseInt(parts[1], 10);
      const jd = parseInt(parts[2], 10);
      const gy_base = jy <= 979 ? 621 : 1600;
      const jy_shifted = jy <= 979 ? jy : jy - 979;
      let days =
        365 * jy_shifted +
        Math.floor(jy_shifted / 33) * 8 +
        Math.floor(((jy_shifted % 33) + 3) / 4) +
        78 +
        jd +
        (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
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
      const g_d = days + 1;
      const sal_g = [
        0,
        31,
        (g_y % 4 === 0 && g_y % 100 !== 0) || g_y % 400 === 0 ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31
      ];
      let rem = g_d;
      let g_m = 1;
      for (g_m = 1; g_m <= 12; g_m++) {
        if (rem <= sal_g[g_m]) break;
        rem -= sal_g[g_m];
      }
      const gregDate = new Date(g_y, g_m - 1, rem);
      return FA_WEEKDAYS_MAP[gregDate.getDay()];
    }
  } catch {
    // fallback
  }
  return 'شنبه';
}

/**
 * Returns Persian label for a `SettlementReason`.
 */
export function getSettlementReasonLabel(reason?: SettlementReason | string): string {
  switch (reason) {
    case 'contract_end':
      return 'اتمام قرارداد';
    case 'dismissal':
      return 'اخراج';
    case 'resignation':
      return 'استعفا';
    case 'abandonment':
      return 'ترک کار بدون استعفا';
    default:
      return 'اتمام قرارداد';
  }
}

/**
 * Maps a Persian departure reason string stored on `Personnel.departureReason` into `SettlementReason`.
 */
export function mapPersianReasonToSettlementReason(reasonStr?: string): SettlementReason {
  const dr = String(reasonStr || '').trim();
  if (dr.includes('بدون استعفا') || dr.includes('ترک کار')) return 'abandonment';
  if (dr.includes('استعفا')) return 'resignation';
  if (dr.includes('اخراج') || dr.includes('فسخ')) return 'dismissal';
  return 'contract_end';
}

export interface ProvisionalSettlementPreview {
  employeeCode: string;
  year: number;
  month: number;
  settlementType: SettlementType;
}

/**
 * Adds (or subtracts when negative) `daysToAdd` calendar days to a normalized/Jalali date string (`YYYY/MM/DD`).
 */
export function addDaysToJalali(dateStr: string, daysToAdd = 1): string {
  const clean = normalizeDateStr(dateStr);
  const parts = clean.split('/');
  if (parts.length !== 3) return clean;
  let jy = parseInt(parts[0], 10);
  let jm = parseInt(parts[1], 10);
  let jd = parseInt(parts[2], 10);
  if (isNaN(jy) || isNaN(jm) || isNaN(jd)) return clean;

  let rem = daysToAdd;
  while (rem > 0) {
    const dim = getShamsiMonthDaysHelper(jy, jm);
    if (jd + rem <= dim) {
      jd += rem;
      rem = 0;
    } else {
      rem -= (dim - jd + 1);
      jd = 1;
      jm++;
      if (jm > 12) {
        jm = 1;
        jy++;
      }
    }
  }
  while (rem < 0) {
    if (jd + rem >= 1) {
      jd += rem;
      rem = 0;
    } else {
      rem += jd;
      jm--;
      if (jm < 1) {
        jm = 12;
        jy--;
      }
      jd = getShamsiMonthDaysHelper(jy, jm);
    }
  }
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/**
 * Returns saved `without_departure` settlements for an employee sorted chronologically by `endDate`.
 */
export function getPriorWithoutDepartureSettlements(
  employeeCode: string | undefined,
  settlements: PersonnelSettlement[] | undefined,
  activePeriodId?: string,
  excludeSettlementId?: string | null
): PersonnelSettlement[] {
  if (!employeeCode || !settlements || settlements.length === 0) return [];
  const targetCode = normEmpCode(employeeCode);
  return settlements
    .filter(s => {
      if ((s.settlementType || 'with_departure') !== 'without_departure') return false;
      if (excludeSettlementId && s.id === excludeSettlementId) return false;
      if (normEmpCode(s.employeeCode) !== targetCode) return false;
      if (activePeriodId && s.periodId && s.periodId !== activePeriodId) {
        const activeY = toEnglishDigits(String(activePeriodId)).match(/^(\d{4})/)?.[1];
        const sEndY = parseShamsiYearMonth(s.endDate)?.year;
        if (activeY && sEndY && String(sEndY) !== activeY) return false;
      }
      return true;
    })
    .sort((a, b) => normalizeDateStr(a.endDate).localeCompare(normalizeDateStr(b.endDate)));
}

/**
 * Returns true if the employee had a saved `without_departure` settlement whose period ended
 * in `(year, month)`, meaning unused leave up through that month was already bought out/settled
 * and should NOT carry over into subsequent months.
 */
export function didSettleLeaveThroughMonth(
  emp: Pick<Personnel, 'employeeCode'> | undefined | null,
  year: number,
  month: number,
  settlements?: PersonnelSettlement[],
  activePeriodId?: string
): boolean {
  if (!emp?.employeeCode || !settlements || settlements.length === 0) return false;
  const priors = getPriorWithoutDepartureSettlements(emp.employeeCode, settlements, activePeriodId);
  for (let i = 0; i < priors.length; i++) {
    const endYM = parseShamsiYearMonth(priors[i].endDate);
    if (endYM && endYM.year === Number(year) && endYM.month === Number(month)) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether `(targetYear, targetMonth)` IS the employee's departure / `with_departure` settlement month.
 * ONLY applies to the exact departure month (never alters prior months or `without_departure` settlements).
 *
 * When true:
 *  - Payroll computes worked hours strictly from regular work (`netNormalWorkMinutes`),
 *    NEVER consuming overtime, holiday work, current-month earned leave, or prior-month unused leave
 *    to pad/complete monthly regular worked hours.
 *  - Overtime and holiday work remain payable separately as overtime/holiday hours.
 *  - Unused leave stays intact (`finalLeaveMinutes`) and is paid in Settlement.
 */
export function isDepartedOrSettlingInMonth(
  emp: Pick<Personnel, 'employeeCode' | 'isActive' | 'departureDate'> | undefined | null,
  targetYear: number,
  targetMonth: number,
  settlements?: PersonnelSettlement[],
  activePeriodId?: string,
  provisionalDeparture?: ProvisionalSettlementPreview | null
): boolean {
  if (!emp) return false;

  if (
    provisionalDeparture &&
    provisionalDeparture.settlementType === 'with_departure' &&
    emp.employeeCode &&
    normEmpCode(emp.employeeCode) === normEmpCode(provisionalDeparture.employeeCode) &&
    Number(targetYear) === Number(provisionalDeparture.year) &&
    Number(targetMonth) === Number(provisionalDeparture.month)
  ) {
    return true;
  }

  if (emp.departureDate && String(emp.departureDate).trim()) {
    const dep = parseEffectiveDepartureLastWorkYM(emp.departureDate);
    if (dep && dep.year === Number(targetYear) && dep.month === Number(targetMonth)) {
      return true;
    }
  }

  if (settlements && settlements.length > 0 && emp.employeeCode) {
    const targetEmpCode = normEmpCode(emp.employeeCode);
    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i];
      if ((s.settlementType || 'with_departure') === 'without_departure') continue;
      if (normEmpCode(s.employeeCode) !== targetEmpCode) continue;
      const endYM = parseEffectiveDepartureLastWorkYM(s.endDate);
      if (activePeriodId && s.periodId && s.periodId !== activePeriodId) {
        if (endYM && endYM.year !== Number(targetYear)) continue;
      }
      if (endYM && endYM.year === Number(targetYear) && endYM.month === Number(targetMonth)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true if the employee departed in `(targetYear, targetMonth)` via `departureDate` or a saved `with_departure` settlement.
 */
export function didEmployeeDepartInMonth(
  emp: Pick<Personnel, 'employeeCode' | 'isActive' | 'departureDate'> | undefined | null,
  targetYear: number,
  targetMonth: number,
  settlements?: PersonnelSettlement[],
  activePeriodId?: string
): boolean {
  return isDepartedOrSettlingInMonth(emp, targetYear, targetMonth, settlements, activePeriodId);
}

export interface DepartedMonthPerfInput {
  netNormalOnlyMinutes: number;
  mandatoryOtMinutes: number;
  netHolidayMinutes: number;
  requiredMinutes: number;
  presenceDaysCount: number;
  prevLeaveMinutes: number;
  totalDaysInMonth: number;
  monthlyLeaveMinutes?: number;
}

export interface DepartedMonthPerfOutput {
  allocatedLeaveMinutes: number;
  totalLeaveMinutes: number;
  finalWorkedMinutes: number;
  finalOtMinutes: number;
  finalHolidayMinutes: number;
  finalLeaveMinutes: number;
  usedLeaveMinutes: number;
  attendanceDaysWorked: number;
  daysWorkedCount: number;
  isNormalWorkFullOrMore: boolean;
}

/**
 * Calculates departure-month worked hours, overtime/holiday offsets, and leave usage:
 * 1. Target ceiling is `min(requiredMinutes, presenceDaysCount * 480)`.
 * 2. If normal net work has a deficit relative to that presence ceiling:
 *    - First deduct from overtime (`mandatoryOtMinutes`), then holiday work (`netHolidayMinutes`).
 *    - Compute monthly allocated leave (`allocatedLeaveMinutes`) based on worked hours after OT/holiday offset.
 *    - If still short, consume monthly allocated leave (`allocatedLeaveMinutes`), then prior leave (`prevLeaveMinutes`).
 *    - If fully recovered to `presenceDaysCount * 480` (and below monthly `requiredMinutes`), set final worked days = `presenceDaysCount`.
 *    - If a deficit still remains, record final worked hours after subtracting the remaining deficit.
 */
export function resolveDepartedMonthAttendancePerf(
  input: DepartedMonthPerfInput
): DepartedMonthPerfOutput {
  const netNormalOnlyMinutes = Math.max(0, Number(input.netNormalOnlyMinutes) || 0);
  const mandatoryOtMinutes = Math.max(0, Number(input.mandatoryOtMinutes) || 0);
  const netHolidayMinutes = Math.max(0, Number(input.netHolidayMinutes) || 0);
  const requiredMinutes = Math.max(0, Number(input.requiredMinutes) || 0);
  const presenceDaysCount = Math.max(0, Number(input.presenceDaysCount) || 0);
  const prevLeaveMinutes = Math.max(0, Number(input.prevLeaveMinutes) || 0);
  const totalDaysInMonth = Math.max(1, Number(input.totalDaysInMonth) || 30);
  const monthlyLeaveCapMinutes =
    input.monthlyLeaveMinutes !== undefined && Number.isFinite(Number(input.monthlyLeaveMinutes))
      ? Math.max(0, Number(input.monthlyLeaveMinutes))
      : DEFAULT_MONTHLY_LEAVE_MINUTES;

  if (requiredMinutes > 0 && netNormalOnlyMinutes >= requiredMinutes) {
    const allocatedLeaveMinutes = monthlyLeaveCapMinutes;
    const totalLeaveMinutes = prevLeaveMinutes + allocatedLeaveMinutes;
    const finalWorkedMinutes = requiredMinutes;
    const finalOtMinutes = mandatoryOtMinutes + Math.max(0, netNormalOnlyMinutes - requiredMinutes);
    const finalHolidayMinutes = netHolidayMinutes;

    const rawDays = (finalWorkedMinutes / 60) / 8;
    const intDays = Math.floor(rawDays);
    const decDays = Number((rawDays - intDays).toFixed(4));
    const attendanceDaysWorked = decDays < 0.5 ? intDays : intDays + 1;

    return {
      allocatedLeaveMinutes,
      totalLeaveMinutes,
      finalWorkedMinutes,
      finalOtMinutes,
      finalHolidayMinutes,
      finalLeaveMinutes: totalLeaveMinutes,
      usedLeaveMinutes: 0,
      attendanceDaysWorked,
      daysWorkedCount: totalDaysInMonth,
      isNormalWorkFullOrMore: true
    };
  }

  const presenceCapMinutes = presenceDaysCount * 480;
  const departureTargetMinutes =
    requiredMinutes > 0 ? Math.min(requiredMinutes, presenceCapMinutes) : presenceCapMinutes;

  let currentWorkedMinutes = netNormalOnlyMinutes;
  let finalOtMinutes = mandatoryOtMinutes;
  let finalHolidayMinutes = netHolidayMinutes;
  let deficit = Math.max(0, departureTargetMinutes - currentWorkedMinutes);

  // ۱) کسر از اضافه کار و سپس تعطیل کاری برای جبران کسری تا سقف روز حضور
  if (deficit > 0 && finalOtMinutes > 0) {
    const otUsed = Math.min(deficit, finalOtMinutes);
    currentWorkedMinutes += otUsed;
    finalOtMinutes -= otUsed;
    deficit -= otUsed;
  }
  if (deficit > 0 && finalHolidayMinutes > 0) {
    const holidayUsed = Math.min(deficit, finalHolidayMinutes);
    currentWorkedMinutes += holidayUsed;
    finalHolidayMinutes -= holidayUsed;
    deficit -= holidayUsed;
  }

  // محاسبه مرخصی تعلق‌گرفته این ماه بر اساس کارکرد واقعی (پس از تبدیل اضافه‌کار/تعطیل‌کاری و پیش از مصرف مرخصی)
  let allocatedLeaveMinutes = 0;
  if (requiredMinutes > 0) {
    if (currentWorkedMinutes >= requiredMinutes) {
      allocatedLeaveMinutes = monthlyLeaveCapMinutes;
    } else {
      allocatedLeaveMinutes = Math.round((currentWorkedMinutes / requiredMinutes) * monthlyLeaveCapMinutes);
    }
  }
  const totalLeaveMinutes = prevLeaveMinutes + allocatedLeaveMinutes;

  // ۲) استفاده از مرخصی تعلق گرفته همین ماه تا سقف روز حضور
  let remainingAllocatedLeave = allocatedLeaveMinutes;
  let remainingPrevLeave = prevLeaveMinutes;
  let usedLeaveMinutes = 0;

  if (deficit > 0 && remainingAllocatedLeave > 0) {
    const allocUsed = Math.min(deficit, remainingAllocatedLeave);
    currentWorkedMinutes += allocUsed;
    remainingAllocatedLeave -= allocUsed;
    usedLeaveMinutes += allocUsed;
    deficit -= allocUsed;
  }

  // ۳) در غیر این صورت استفاده از مانده مرخصی از قبل تا سقف روز حضور
  if (deficit > 0 && remainingPrevLeave > 0) {
    const prevUsed = Math.min(deficit, remainingPrevLeave);
    currentWorkedMinutes += prevUsed;
    remainingPrevLeave -= prevUsed;
    usedLeaveMinutes += prevUsed;
    deficit -= prevUsed;
  }

  const finalLeaveMinutes = remainingAllocatedLeave + remainingPrevLeave;
  const finalWorkedMinutes = currentWorkedMinutes;
  const isNormalWorkFullOrMore = requiredMinutes > 0 && finalWorkedMinutes >= requiredMinutes;

  const rawDays = (finalWorkedMinutes / 60) / 8;
  const intDays = Math.floor(rawDays);
  const decDays = Number((rawDays - intDays).toFixed(4));
  let attendanceDaysWorked = decDays < 0.5 ? intDays : intDays + 1;

  if (!isNormalWorkFullOrMore && deficit === 0 && presenceDaysCount > 0 && finalWorkedMinutes === presenceCapMinutes) {
    attendanceDaysWorked = presenceDaysCount;
  }

  const daysWorkedCount = isNormalWorkFullOrMore ? totalDaysInMonth : attendanceDaysWorked;

  return {
    allocatedLeaveMinutes,
    totalLeaveMinutes,
    finalWorkedMinutes,
    finalOtMinutes,
    finalHolidayMinutes,
    finalLeaveMinutes,
    usedLeaveMinutes,
    attendanceDaysWorked,
    daysWorkedCount,
    isNormalWorkFullOrMore
  };
}

/**
 * Checks whether the payroll document for `(activePeriodId, year, month)` is currently locked.
 */
export function isPayrollMonthLocked(
  db: Pick<AppDatabase, 'payrollPeriods'>,
  activePeriodId: string,
  year?: number,
  month?: number,
  unlockedMonthsMap?: Record<string, boolean>
): boolean {
  if (!year || !month) return false;
  const lockKey = `${year}-${month}`;
  if (unlockedMonthsMap && unlockedMonthsMap[lockKey]) return false;
  return (db.payrollPeriods || []).some(
    pp => pp.periodId === activePeriodId && Number(pp.year) === Number(year) && Number(pp.month) === Number(month)
  );
}

function resolveSalaryRateForYearMonth(
  db: AppDatabase,
  year: number,
  month: number,
  activePeriodId: string
): SalaryBaseRate | undefined {
  const rates = db.salaryBaseRates || [];
  if (rates.length === 0) return undefined;

  const targetYearStr = String(year).trim();
  const targetMonthStr = String(month).padStart(2, '0');
  const periodYM = `${targetYearStr}-${targetMonthStr}`;

  const matchedByYM = rates.find(
    r => toEnglishDigits(String(r.year || '')).trim() === targetYearStr && r.periodId === periodYM
  );
  if (matchedByYM) return matchedByYM;

  if (activePeriodId && activePeriodId.startsWith(targetYearStr)) {
    const matchedByActive = rates.find(
      r => toEnglishDigits(String(r.year || '')).trim() === targetYearStr && r.periodId === activePeriodId
    );
    if (matchedByActive) return matchedByActive;
  }

  const matchedByYear = rates.find(r => toEnglishDigits(String(r.year || '')).trim() === targetYearStr);
  if (matchedByYear) return matchedByYear;

  const matchedByPrefix = rates.find(r => r.periodId && toEnglishDigits(String(r.periodId)).startsWith(targetYearStr));
  if (matchedByPrefix) return matchedByPrefix;

  const sorted = [...rates].sort(
    (a, b) => (Number(toEnglishDigits(String(b.year || ''))) || 0) - (Number(toEnglishDigits(String(a.year || ''))) || 0)
  );
  return sorted[0] || rates[0];
}

function resolveOvertimeHolidayFridayRates(
  dailyBase: number,
  activeRates: SalaryBaseRate | undefined
) {
  const refActiveDaily = activeRates && Number(activeRates.dailyBaseSalary) > 0 ? Number(activeRates.dailyBaseSalary) : 0;
  const useActiveRates = Boolean(activeRates) && (refActiveDaily === 0 || dailyBase === refActiveDaily);

  const defaultOt = Math.round((dailyBase * 1.4) / 7.33);
  const defaultFri = Math.round(((dailyBase || 0) * 0.40) / 7.33);

  let overtimeHourlyRateVal = defaultOt;
  if (useActiveRates && Number(activeRates?.overtimeHourlyRate) > 0) {
    const rawOt = Number(activeRates!.overtimeHourlyRate);
    overtimeHourlyRateVal = refActiveDaily > 0 && rawOt > refActiveDaily * 0.8 ? Math.round(rawOt / 7.33) : rawOt;
  }

  let fridayWorkHourlyRateVal = defaultFri;
  if (useActiveRates && Number(activeRates?.fridayWorkHourlyRate) > 0) {
    const rawFri = Number(activeRates!.fridayWorkHourlyRate);
    fridayWorkHourlyRateVal = refActiveDaily > 0 && rawFri > refActiveDaily * 0.15 ? Math.round(rawFri / 7.33) : rawFri;
  } else if (dailyBase > 0 && fridayWorkHourlyRateVal > dailyBase * 0.15) {
    fridayWorkHourlyRateVal = Math.round(fridayWorkHourlyRateVal / 7.33);
  }

  let holidayWorkHourlyRateVal = overtimeHourlyRateVal;
  if (useActiveRates && Number(activeRates?.holidayWorkHourlyRate) > 0) {
    const rawHol = Number(activeRates!.holidayWorkHourlyRate);
    holidayWorkHourlyRateVal = refActiveDaily > 0 && rawHol > refActiveDaily * 0.8 ? Math.round(rawHol / 7.33) : rawHol;
  }

  return {
    overtimeHourlyRateVal,
    fridayWorkHourlyRateVal,
    holidayWorkHourlyRateVal
  };
}

function getEligibleChildrenCount(insuranceHistoryDays: number, list: any[] = []): number {
  if (insuranceHistoryDays < 730) return 0;
  return (list || []).filter(ch => {
    if (ch.gender === 'پسر') {
      return ch.age < 18 || (ch.age >= 18 && ch.isStudent === true);
    }
    if (ch.gender === 'دختر') {
      return true;
    }
    return false;
  }).length;
}

function findMatchingContractForYearMonth(
  contracts: PersonnelContract[],
  employeeCode: string,
  year: number,
  month: number,
  periodId: string
): PersonnelContract | undefined {
  const cleanCode = normEmpCode(employeeCode);
  const empContracts = (contracts || []).filter(c => normEmpCode(c.employeeCode) === cleanCode);
  if (empContracts.length === 0) return undefined;

  const daysInMonth = getShamsiMonthDaysHelper(year, month);
  const monthStart = `${year}/${String(month).padStart(2, '0')}/01`;
  const monthEnd = `${year}/${String(month).padStart(2, '0')}/${String(daysInMonth).padStart(2, '0')}`;
  const targetYMId = `${year}-${String(month).padStart(2, '0')}`;

  const sorted = [...empContracts].sort((a, b) => {
    const actA = a.isActive === true ? 1 : 0;
    const actB = b.isActive === true ? 1 : 0;
    if (actB !== actA) return actB - actA;
    const sA = normalizeDateStr(a.contractStartDate);
    const sB = normalizeDateStr(b.contractStartDate);
    if (sB !== sA) return sB.localeCompare(sA);
    return String(b.periodId || '').localeCompare(String(a.periodId || ''));
  });

  return (
    sorted.find(c => c.periodId === periodId || c.periodId === targetYMId) ||
    sorted.find(c => {
      if (!c.contractStartDate) return false;
      const start = normalizeDateStr(c.contractStartDate);
      const end = c.contractEndDate ? normalizeDateStr(c.contractEndDate) : '9999/99/99';
      return start <= monthEnd && end >= monthStart;
    }) ||
    sorted.find(c => c.contractStartDate && normalizeDateStr(c.contractStartDate) <= monthEnd) ||
    sorted[0]
  );
}

function resolveInsuredItemKeysForMonth(
  db: AppDatabase,
  contract: PersonnelContract | undefined,
  emp: Personnel,
  year: number,
  month: number,
  activePeriodId: string
): Set<string> {
  const allInsured = db.insuredSalaryItems || [];
  if (allInsured.length === 0) {
    return new Set(['dailyBaseSalary', 'dailyInsuranceSalary', 'baseSalary', 'housingAllowance', 'foodAllowance', 'baseYearsRate', 'jobAllowance']);
  }

  const monthDate = `${year}/${String(month).padStart(2, '0')}/15`;
  const yearStr = String(year);

  const byDate = allInsured.filter(item => {
    const iStart = item.startDate ? normalizeDateStr(item.startDate) : (item.periodId ? `${item.periodId.substring(0, 4)}/01/01` : '');
    const iEnd = item.endDate ? normalizeDateStr(item.endDate) : (item.periodId ? `${item.periodId.substring(0, 4)}/12/29` : '');
    if (iStart && iEnd) return monthDate >= iStart && monthDate <= iEnd;
    if (iStart) return monthDate >= iStart;
    if (iEnd) return monthDate <= iEnd;
    return false;
  });
  if (byDate.length > 0) return new Set(byDate.map(i => i.itemKey));

  const byYear = allInsured.filter(item => {
    if (item.startDate && normalizeDateStr(item.startDate).startsWith(yearStr)) return true;
    if (item.endDate && normalizeDateStr(item.endDate).startsWith(yearStr)) return true;
    if (item.periodId && String(item.periodId).startsWith(yearStr)) return true;
    return false;
  });
  if (byYear.length > 0) return new Set(byYear.map(i => i.itemKey));

  const targetPid = contract?.periodId || activePeriodId;
  const byPid = allInsured.filter(i => i.periodId === targetPid);
  if (byPid.length > 0) return new Set(byPid.map(i => i.itemKey));

  return new Set(allInsured.map(i => i.itemKey));
}

function calculateDailyWorkedMinutes(times: string[], statuses?: number[]): number {
  if (!times || times.length < 2) return 0;
  const rStatuses = statuses || times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
  const pairs = times.map((time, idx) => ({ time, status: rStatuses[idx], mins: timeToMinutes(time) }));
  pairs.sort((a, b) => a.mins - b.mins);

  let totalMinutes = 0;
  let activeEntryTime: number | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const timeMin = pairs[i].mins;
    const status = pairs[i].status;
    if (status === 0) {
      activeEntryTime = timeMin;
    } else if (status === 1 && activeEntryTime !== null) {
      totalMinutes += timeMin - activeEntryTime;
      activeEntryTime = null;
    }
  }
  if (totalMinutes === 0 && pairs.length === 2 && pairs[0].status === 1 && pairs[1].status === 0) {
    return pairs[0].mins + 1440 - pairs[1].mins;
  }
  if (totalMinutes === 0 && pairs.length >= 2) {
    const first = pairs[0].mins;
    const last = pairs[pairs.length - 1].mins;
    if (last > first) return last - first;
  }
  return totalMinutes > 0 ? totalMinutes : 0;
}

function resolveEntryExitTimesForShift(rawTimes: string[], shiftStartStr?: string, shiftEndStr?: string) {
  const cleaned = (rawTimes || []).filter(Boolean);
  if (cleaned.length === 0) {
    return { firstEntryMins: 0, lastExitMins: 0, shiftStartMins: 0, shiftEndMins: 0, sortedTimes: [] as string[] };
  }
  const sStartRaw = shiftStartStr ? timeToMinutes(shiftStartStr) : 0;
  const sEndRaw = shiftEndStr ? timeToMinutes(shiftEndStr) : 0;
  const isOvernight = Boolean(shiftStartStr && shiftEndStr && sEndRaw <= sStartRaw);

  if (isOvernight) {
    const pivot = Math.floor((sStartRaw + sEndRaw) / 2);
    const toTimeline = (t: string) => {
      const m = timeToMinutes(t);
      return m < pivot ? m + 1440 : m;
    };
    const sorted = [...cleaned].sort((a, b) => toTimeline(a) - toTimeline(b));
    return {
      firstEntryMins: toTimeline(sorted[0]),
      lastExitMins: toTimeline(sorted[sorted.length - 1]),
      shiftStartMins: sStartRaw,
      shiftEndMins: sEndRaw + 1440,
      sortedTimes: sorted
    };
  }

  const sorted = [...cleaned].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  return {
    firstEntryMins: timeToMinutes(sorted[0]),
    lastExitMins: timeToMinutes(sorted[sorted.length - 1]),
    shiftStartMins: sStartRaw,
    shiftEndMins: sEndRaw,
    sortedTimes: sorted
  };
}

function isRecordForEmployee(rec: any, empObj: Personnel): boolean {
  if (!empObj || !rec) return false;
  const recCode = cleanAttCode(rec.attendanceCode);
  const rawEmpAtt = toEnglishDigits(String(empObj.attendanceCode || '')).trim();
  const empAttTokens = rawEmpAtt
    ? rawEmpAtt.split(/[\s,،;|/\\]+/).map(t => cleanAttCode(t)).filter(Boolean)
    : [];

  // Strictly match punch code ONLY against personnel.attendanceCode (کد پرسنل حضور و غیاب) — NEVER employeeCode
  if (recCode) {
    return empAttTokens.includes(recCode);
  }
  if (rec.employeeId && rec.employeeId === empObj.id) {
    return true;
  }
  return false;
}

/**
 * Finds the last attendance date (`YYYY/MM/DD`) recorded for `emp`.
 * If `preferredYear` and `preferredMonth` are provided and records exist in that month,
 * returns the latest attendance date in that month; otherwise returns the overall latest attendance date.
 */
export function findLastAttendanceDateForEmployee(
  db: Pick<AppDatabase, 'attendanceRecords'>,
  emp: Personnel | undefined,
  activePeriodId?: string,
  preferredYear?: number,
  preferredMonth?: number
): string {
  if (!emp) return '';
  const empRecs = (db.attendanceRecords || []).filter(
    rec =>
      isRecordForEmployee(rec, emp) &&
      ((Array.isArray(rec.times) && rec.times.length > 0) || Number((rec as any).workedMinutes || 0) > 0) &&
      rec.date
  );
  if (empRecs.length === 0) return '';

  const activeYearMatch = activePeriodId ? toEnglishDigits(String(activePeriodId)).match(/^(\d{4})/) : null;
  const targetYear = preferredYear || (activeYearMatch ? parseInt(activeYearMatch[1], 10) : undefined);

  const allNormalizedDates = empRecs
    .map(r => normalizeDateStr(r.date))
    .filter(d => /^\d{4}\/\d{2}\/\d{2}$/.test(d));
  if (allNormalizedDates.length === 0) return '';

  const yearScopedDates = targetYear
    ? allNormalizedDates.filter(d => d.startsWith(`${targetYear}/`))
    : [];
  const dates = yearScopedDates.length > 0 ? yearScopedDates : allNormalizedDates;

  if (preferredYear && preferredMonth) {
    const ymPrefix = `${preferredYear}/${String(preferredMonth).padStart(2, '0')}/`;
    const monthDates = dates.filter(d => d.startsWith(ymPrefix)).sort();
    if (monthDates.length > 0) return monthDates[monthDates.length - 1];
  }

  const sorted = [...dates].sort();
  return sorted[sorted.length - 1];
}

/**
 * Finds the first (earliest) attendance date (`YYYY/MM/DD`) for an attendance code.
 * Used when registering unknown personnel so their `entryDate` reflects their first workday.
 */
export function findFirstAttendanceDateForCode(
  attendanceRecords: AttendanceRecord[] | undefined,
  code: string | undefined,
  activePeriodId?: string
): string {
  const targetNorm = cleanCodeNoZeros(code);
  if (!targetNorm || !attendanceRecords || attendanceRecords.length === 0) return '';

  const matching = attendanceRecords.filter(rec => {
    if (!rec || !Array.isArray(rec.times) || rec.times.length === 0 || !rec.date) return false;
    const recCode = cleanCodeNoZeros(rec.attendanceCode);
    const recEmpId = cleanCodeNoZeros(rec.employeeId);
    return (Boolean(recCode) && recCode === targetNorm) || (Boolean(recEmpId) && recEmpId === targetNorm);
  });
  if (matching.length === 0) return '';

  const pool = activePeriodId
    ? matching.filter(r => r.periodId === activePeriodId)
    : matching;
  if (pool.length === 0) return '';

  const dates = pool
    .map(r => normalizeDateStr(r.date))
    .filter(d => /^\d{4}\/\d{2}\/\d{2}$/.test(d))
    .sort();

  return dates[0] || '';
}

function resolveTaxableItemKeysForMonth(
  db: AppDatabase,
  contract: PersonnelContract | undefined,
  year: number,
  month: number,
  activePeriodId: string
): { isConfigured: boolean; keys: Set<string> } {
  const allTaxable = db.taxableSalaryItems || [];
  if (allTaxable.length === 0) return { isConfigured: false, keys: new Set<string>() };

  const monthDate = `${year}/${String(month).padStart(2, '0')}/15`;
  const yearStr = String(year);

  const byDate = allTaxable.filter(item => {
    const iStart = item.startDate ? normalizeDateStr(item.startDate) : (item.periodId ? `${item.periodId.substring(0, 4)}/01/01` : '');
    const iEnd = item.endDate ? normalizeDateStr(item.endDate) : (item.periodId ? `${item.periodId.substring(0, 4)}/12/29` : '');
    if (iStart && iEnd) return monthDate >= iStart && monthDate <= iEnd;
    if (iStart) return monthDate >= iStart;
    if (iEnd) return monthDate <= iEnd;
    return false;
  });
  if (byDate.length > 0) return { isConfigured: true, keys: new Set(byDate.map(i => i.itemKey)) };

  const byYear = allTaxable.filter(item => {
    if (item.startDate && normalizeDateStr(item.startDate).startsWith(yearStr)) return true;
    if (item.endDate && normalizeDateStr(item.endDate).startsWith(yearStr)) return true;
    if (item.periodId && String(item.periodId).startsWith(yearStr)) return true;
    return false;
  });
  if (byYear.length > 0) return { isConfigured: true, keys: new Set(byYear.map(i => i.itemKey)) };

  const targetPid = contract?.periodId || activePeriodId;
  const byPid = allTaxable.filter(i => i.periodId === targetPid);
  if (byPid.length > 0) return { isConfigured: true, keys: new Set(byPid.map(i => i.itemKey)) };

  return { isConfigured: true, keys: new Set(allTaxable.map(i => i.itemKey)) };
}

function computeProgressiveTaxForSync(
  taxBase: number,
  monthlyExemption: number,
  yearBrackets: { fromAmount: number; toAmount: number; taxRate: number }[]
): number {
  if (taxBase <= monthlyExemption) return 0;
  if (yearBrackets.length > 0) {
    let taxSum = 0;
    for (let i = 0; i < yearBrackets.length; i++) {
      const b = yearBrackets[i];
      const from = Number(b.fromAmount);
      const to = b.toAmount !== null && b.toAmount !== undefined && Number(b.toAmount) > 0 ? Number(b.toAmount) : Infinity;
      const rate = Number(b.taxRate) / 100;
      if (taxBase > from) {
        const portion = Math.min(taxBase, to) - from;
        if (portion > 0) taxSum += portion * rate;
      }
    }
    return Math.round(taxSum);
  }
  let taxSum = 0;
  const limit1 = monthlyExemption;
  const limit2 = Math.round(monthlyExemption * 1.375);
  const limit3 = Math.round(monthlyExemption * 2.25);
  const limit4 = Math.round(monthlyExemption * 3.3333);
  if (taxBase > limit1) {
    const b1 = Math.min(taxBase, limit2) - limit1;
    if (b1 > 0) taxSum += b1 * 0.10;
  }
  if (taxBase > limit2) {
    const b2 = Math.min(taxBase, limit3) - limit2;
    if (b2 > 0) taxSum += b2 * 0.15;
  }
  if (taxBase > limit3) {
    const b3 = Math.min(taxBase, limit4) - limit3;
    if (b3 > 0) taxSum += b3 * 0.20;
  }
  if (taxBase > limit4) {
    const b4 = taxBase - limit4;
    if (b4 > 0) taxSum += b4 * 0.30;
  }
  return Math.round(taxSum);
}

function computeAttendancePerfForMonth(
  db: AppDatabase,
  activePeriodId: string,
  emp: Personnel,
  targetYear: number,
  targetMonth: number,
  treatAsDepartingMonth: boolean,
  visitedDepth = 0,
  perfCache = new Map<string, any>(),
  unlockedMonthsMap?: Record<string, boolean>
): {
  hasRecords: boolean;
  daysWorkedCount: number;
  attendanceDaysWorked: number;
  netWorkMinutes: number;
  requiredMinutes: number;
  finalWorkedMinutes: number;
  finalOtMinutes: number;
  finalFridayMinutes: number;
  finalHolidayMinutes: number;
  allocatedLeaveMinutes: number;
  totalLeaveMinutes: number;
  finalLeaveMinutes: number;
  usedLeaveMinutes: number;
} {
  const cacheKey = `${targetYear}-${targetMonth}`;
  if (perfCache.has(cacheKey)) return perfCache.get(cacheKey);

  const isSessionUnlocked = Boolean(unlockedMonthsMap && unlockedMonthsMap[`${targetYear}-${targetMonth}`]);

  // Check locked attendance performance snapshot first (unless explicitly unlocked in session)
  const matchingPeriod =
    (db.payrollPeriods || []).find(
      pp => pp.periodId === activePeriodId && Number(pp.year) === targetYear && Number(pp.month) === targetMonth
    ) ||
    (db.payrollPeriods || []).find(
      pp => Number(pp.year) === targetYear && Number(pp.month) === targetMonth
    );

  const empCodeNorm = normEmpCode(emp.employeeCode);
  const lockedSnapRow = !isSessionUnlocked
    ? matchingPeriod?.attendancePerformanceSnapshot?.find(
        (s: any) =>
          s?.employee?.id === emp.id ||
          (empCodeNorm && normEmpCode(s?.employee?.employeeCode) === empCodeNorm)
      )
    : undefined;

  if (lockedSnapRow) {
    const totalLeaveM = Number(lockedSnapRow.totalLeaveMinutes || 0);
    const finalLeaveM = Number(lockedSnapRow.finalLeaveMinutes || 0);
    const res = {
      hasRecords: true,
      daysWorkedCount: Number(lockedSnapRow.daysWorkedCount ?? lockedSnapRow.attendanceDaysWorked ?? 0),
      attendanceDaysWorked: Number(lockedSnapRow.attendanceDaysWorked ?? lockedSnapRow.daysWorkedCount ?? 0),
      netWorkMinutes: Number(lockedSnapRow.netWorkMinutes || 0),
      requiredMinutes: Number(lockedSnapRow.requiredMinutes || 192 * 60),
      finalWorkedMinutes: Number(lockedSnapRow.finalWorkedMinutes || 0),
      finalOtMinutes: Number(lockedSnapRow.finalOtMinutes || 0),
      finalFridayMinutes: Number(lockedSnapRow.finalFridayMinutes || 0),
      finalHolidayMinutes: Number(lockedSnapRow.finalHolidayMinutes || 0),
      allocatedLeaveMinutes: Number(lockedSnapRow.allocatedLeaveMinutes || 0),
      totalLeaveMinutes: totalLeaveM,
      finalLeaveMinutes: finalLeaveM,
      usedLeaveMinutes: Math.max(0, totalLeaveM - finalLeaveM)
    };
    perfCache.set(cacheKey, res);
    return res;
  }

  const setting = (db.monthlyWorkdaySettings || []).find(
    s => Number(s.year) === targetYear && Number(s.month) === targetMonth
  );
  const reqHours = setting ? Number(setting.requiredWorkHours) : 192;
  const reqMinutes = reqHours * 60;

  // Filter attendance records for this employee & month
  const allMonthRecs = (db.attendanceRecords || []).filter(rec => {
    if (!isRecordForEmployee(rec, emp)) return false;
    const dStr = normalizeDateStr(rec.date);
    const parts = dStr.split('/');
    if (parts.length < 3) return false;
    return parseInt(parts[0], 10) === targetYear && parseInt(parts[1], 10) === targetMonth;
  });

  // Prefer scoped to activePeriodId if available, otherwise all records for that month
  const scopedRecs = allMonthRecs.filter(r => r.periodId === activePeriodId);
  const monthRecs = scopedRecs.length > 0 ? scopedRecs : allMonthRecs;

  // Previous month carryover leave (up to 12 months back within same year chain)
  // If previous month ended a `without_departure` settlement, its remaining leave was already settled/bought out -> reset carryover to 0
  let prevLeaveMinutes = 0;
  if (visitedDepth < 12 && targetMonth > 1) {
    const prevM = targetMonth - 1;
    if (didSettleLeaveThroughMonth(emp, targetYear, prevM, db.personnelSettlements, activePeriodId)) {
      prevLeaveMinutes = 0;
    } else {
      const prevPerf = computeAttendancePerfForMonth(
        db,
        activePeriodId,
        emp,
        targetYear,
        prevM,
        isDepartedOrSettlingInMonth(emp, targetYear, prevM, db.personnelSettlements, activePeriodId),
        visitedDepth + 1,
        perfCache,
        unlockedMonthsMap
      );
      prevLeaveMinutes = prevPerf.finalLeaveMinutes || 0;
    }
  }

  if (monthRecs.length === 0) {
    const res = {
      hasRecords: false,
      daysWorkedCount: 0,
      attendanceDaysWorked: 0,
      netWorkMinutes: 0,
      requiredMinutes: reqMinutes,
      finalWorkedMinutes: 0,
      finalOtMinutes: 0,
      finalFridayMinutes: 0,
      finalHolidayMinutes: 0,
      allocatedLeaveMinutes: 0,
      totalLeaveMinutes: prevLeaveMinutes,
      finalLeaveMinutes: prevLeaveMinutes,
      usedLeaveMinutes: 0
    };
    perfCache.set(cacheKey, res);
    return res;
  }

  const rawRules = (db.payrollCalculationRules || {}) as PayrollCalculationRules;
  const rulesObj = {
    calculateEarlyOvertime: rawRules.calculateEarlyOvertime ?? true,
    calculateLateOvertime: rawRules.calculateLateOvertime ?? true,
    calculateHolidayWork: rawRules.calculateHolidayWork ?? true,
    calculateFridayWork: rawRules.calculateFridayWork ?? true,
    calculateEntryDelayFine: rawRules.calculateEntryDelayFine ?? false,
    delayFineRate: rawRules.delayFineRate ?? 1.0,
    deductClothesChangingTime: rawRules.deductClothesChangingTime ?? false,
    clothesChangingDuration: rawRules.clothesChangingDuration ?? 15,
    deductDailyBreakTime: rawRules.deductDailyBreakTime ?? true,
    dailyBreakDurationMinutes: rawRules.dailyBreakDurationMinutes ?? 40
  };

  const officialHolidaysSet = new Set<string>();
  (db.officialHolidays || []).forEach(h => {
    if (h?.date) officialHolidaysSet.add(normalizeDateStr(h.date));
  });

  const shiftsSource = db.shifts || [
    { id: 'sh-1', name: 'شیفت صبح', startTime: '06:00', endTime: '14:00' },
    { id: 'sh-2', name: 'شیفت عصر', startTime: '14:00', endTime: '22:00' },
    { id: 'sh-3', name: 'شیفت شب', startTime: '22:00', endTime: '06:00' }
  ];
  const shiftsById = new Map<string, any>();
  shiftsSource.forEach(sh => {
    if (sh?.id) shiftsById.set(sh.id, sh);
  });

  const sectionsById = new Map<string, any>();
  const sectionsByDeptCat = new Map<string, any>();
  (db.productionSections || []).forEach(sec => {
    if (sec?.id) sectionsById.set(sec.id, sec);
    if (sec?.departmentCategoryId && !sectionsByDeptCat.has(sec.departmentCategoryId)) {
      sectionsByDeptCat.set(sec.departmentCategoryId, sec);
    }
  });

  const isEmpMatchAssign = (a: any) => {
    if (!a) return false;
    const assignEmpId = a.employeeId ? String(a.employeeId).trim() : '';
    const empId = emp.id ? String(emp.id).trim() : '';
    const empAttCode = cleanCodeNoZeros(emp.attendanceCode);
    const eCode = cleanCodeNoZeros(emp.employeeCode);
    const assignCode = cleanCodeNoZeros(a.employeeCode);
    const subCode = cleanCodeNoZeros(a.substitutedEmployeeCode);

    if (a.isOnLeave) {
      if (!subCode) return false;
      return Boolean((eCode && subCode === eCode) || (empAttCode && subCode === empAttCode) || (empId && subCode === cleanCodeNoZeros(empId)));
    }
    if (assignEmpId && empId && assignEmpId === empId) return true;
    if (!assignCode) return false;
    if (empId && assignCode === cleanCodeNoZeros(empId)) return true;
    if (eCode && assignCode === eCode) return !(assignEmpId && empId && assignEmpId !== empId);
    if (empAttCode && assignCode === empAttCode) return !(assignEmpId && empId && assignEmpId !== empId);
    return false;
  };

  const periodAllocs = (db.personnelAllocations || []).filter(a => a.periodId === activePeriodId);
  const empAlloc = periodAllocs.find(
    a =>
      normEmpCode(a.employeeCode) === normEmpCode(emp.employeeCode) ||
      (emp.attendanceCode && normEmpCode(a.employeeCode) === normEmpCode(emp.attendanceCode))
  );

  const getShiftForDay = (dateStr: string) => {
    const normDate = normalizeDateStr(dateStr);
    const assigns = (db.shiftAssignments || []).filter(a =>
      isShiftAssignmentInMonth(a, activePeriodId, targetYear, targetMonth, { year: targetYear, month: targetMonth })
    );
    const dateMatches = assigns.filter(a => a.date && normalizeDateStr(a.date) === normDate && isEmpMatchAssign(a));
    let candAssign: any = null;
    if (dateMatches.length > 0) {
      let explicitNone = false;
      const activeDateMatches: any[] = [];
      for (let i = 0; i < dateMatches.length; i++) {
        const a = dateMatches[i];
        if (a.deptId === 'none' || a.shiftId === 'none' || (a.isOnLeave && !a.substitutedEmployeeCode)) {
          explicitNone = true;
        } else {
          activeDateMatches.push(a);
        }
      }
      if (explicitNone && activeDateMatches.length === 0) return null;
      candAssign = activeDateMatches[0] || null;
    } else if (emp.shiftScheduleType === 'fixed') {
      if (!emp.fixedShiftId || emp.fixedShiftId === 'none') return null;
      const sh = shiftsById.get(emp.fixedShiftId);
      const sec = sectionsById.get(emp.fixedShiftId) || sectionsByDeptCat.get(emp.fixedShiftId);
      const st = sec?.startTime || sh?.startTime;
      const en = sec?.endTime || sh?.endTime;
      if (st && en) return { startTime: toEnglishDigits(st).trim(), endTime: toEnglishDigits(en).trim() };
      return null;
    } else {
      const wKey = normalizeWeekday(getPersianWeekdayOfDate(dateStr));
      const periodWeekly = assigns.find(
        a => !a.date && normalizeWeekday(a.dayName) === wKey && isEmpMatchAssign(a) && a.deptId !== 'none' && a.shiftId !== 'none'
      );
      candAssign =
        periodWeekly ||
        (db.shiftAssignments || []).find(
          a => !a.periodId && !a.date && normalizeWeekday(a.dayName) === wKey && isEmpMatchAssign(a) && a.deptId !== 'none' && a.shiftId !== 'none'
        );
    }
    if (!candAssign) return null;
    const sh = shiftsById.get(candAssign.shiftId) || shiftsById.get(candAssign.deptId);
    let sec = sectionsById.get(candAssign.deptId) || sectionsById.get(candAssign.shiftId) || sectionsByDeptCat.get(candAssign.deptId);
    if (!sec && !sh && empAlloc?.departmentCategoryId) {
      sec = sectionsById.get(empAlloc.departmentCategoryId) || sectionsByDeptCat.get(empAlloc.departmentCategoryId);
    }
    const st = sec?.startTime || sh?.startTime;
    const en = sec?.endTime || sh?.endTime;
    if (!st || !en) return null;
    return { startTime: toEnglishDigits(st).trim(), endTime: toEnglishDigits(en).trim() };
  };

  // Group records by normalized date
  const grouped = new Map<string, any>();
  monthRecs.forEach(rec => {
    const dStr = normalizeDateStr(rec.date);
    const existing = grouped.get(dStr);
    if (!existing) {
      grouped.set(dStr, { ...rec, times: [...(rec.times || [])], statuses: rec.statuses ? [...rec.statuses] : [] });
    } else {
      (rec.times || []).forEach((t: string, j: number) => {
        if (!existing.times.includes(t)) {
          existing.times.push(t);
          if (rec.statuses && rec.statuses[j] !== undefined) existing.statuses.push(rec.statuses[j]);
        }
      });
    }
  });

  const calendarDaysCount = getShamsiMonthDaysHelper(targetYear, targetMonth);
  const monthPad = String(targetMonth).padStart(2, '0');
  let totalPresenceMinutes = 0;
  let totalNormalOnlyPresenceMinutes = 0;
  let totalMandatoryOvertimeMinutes = 0;
  let totalHolidayPresenceMinutes = 0;
  let totalFridayPresenceMinutes = 0;
  let normalDaysWorkedCount = 0;
  let holidayDaysWorkedCount = 0;
  let fridayDaysWorkedCount = 0;
  let totalDelayMinutesNormal = 0;
  let totalDelayMinutesFriday = 0;
  let totalDelayMinutesHoliday = 0;

  for (let d = 1; d <= calendarDaysCount; d++) {
    const dateStr = `${targetYear}/${monthPad}/${String(d).padStart(2, '0')}`;
    const isFriday = normalizeWeekday(getPersianWeekdayOfDate(dateStr)) === normalizeWeekday('جمعه');
    const isHoliday = officialHolidaysSet.has(dateStr);
    const rec = grouped.get(dateStr);
    const isPresent = !!rec && rec.times.length > 0;
    if (!isPresent) continue;

    const workedMin = calculateDailyWorkedMinutes(rec.times, rec.statuses);
    const breakMin = rulesObj.deductDailyBreakTime ? (rulesObj.dailyBreakDurationMinutes ?? 40) : 0;
    const shift = getShiftForDay(dateStr);
    const resolvedTimes = resolveEntryExitTimesForShift(rec.times, shift?.startTime, shift?.endTime);

    let delayMin = 0;
    let overtimeEarlyMin = 0;
    let overtimeLateMin = 0;
    if (shift && resolvedTimes.sortedTimes.length >= 2) {
      if (resolvedTimes.firstEntryMins > resolvedTimes.shiftStartMins) delayMin = resolvedTimes.firstEntryMins - resolvedTimes.shiftStartMins;
      if (resolvedTimes.firstEntryMins < resolvedTimes.shiftStartMins) overtimeEarlyMin = resolvedTimes.shiftStartMins - resolvedTimes.firstEntryMins;
      if (resolvedTimes.lastExitMins > resolvedTimes.shiftEndMins) overtimeLateMin = resolvedTimes.shiftEndMins ? resolvedTimes.lastExitMins - resolvedTimes.shiftEndMins : 0;
    }

    const unauthMin = (rulesObj.calculateEarlyOvertime ? 0 : overtimeEarlyMin) + (rulesObj.calculateLateOvertime ? 0 : overtimeLateMin);
    const adjustedWorkedMin = Math.max(0, workedMin - breakMin - unauthMin);
    totalPresenceMinutes += adjustedWorkedMin;

    const standardCap = 480 - breakMin;
    if (isHoliday && !isFriday) {
      if (rulesObj.calculateHolidayWork) {
        totalHolidayPresenceMinutes += adjustedWorkedMin;
        holidayDaysWorkedCount++;
      } else {
        const normalCap = Math.min(adjustedWorkedMin, standardCap);
        totalNormalOnlyPresenceMinutes += normalCap;
        totalMandatoryOvertimeMinutes += Math.max(0, adjustedWorkedMin - normalCap);
        normalDaysWorkedCount++;
      }
    } else if (isFriday) {
      if (rulesObj.calculateFridayWork) totalFridayPresenceMinutes += adjustedWorkedMin;
      if (isHoliday && rulesObj.calculateHolidayWork) {
        totalHolidayPresenceMinutes += adjustedWorkedMin;
      } else {
        const normalCap = Math.min(adjustedWorkedMin, standardCap);
        totalNormalOnlyPresenceMinutes += normalCap;
        totalMandatoryOvertimeMinutes += Math.max(0, adjustedWorkedMin - normalCap);
      }
      fridayDaysWorkedCount++;
    } else {
      const normalCap = Math.min(adjustedWorkedMin, standardCap);
      totalNormalOnlyPresenceMinutes += normalCap;
      totalMandatoryOvertimeMinutes += Math.max(0, adjustedWorkedMin - normalCap);
      normalDaysWorkedCount++;
    }

    if (delayMin > 0) {
      if (isFriday) totalDelayMinutesFriday += delayMin;
      else if (isHoliday) totalDelayMinutesHoliday += delayMin;
      else totalDelayMinutesNormal += delayMin;
    }
  }

  const delayFineRate = rulesObj.delayFineRate || 1.0;
  const activeDelayNormal = rulesObj.calculateEntryDelayFine ? totalDelayMinutesNormal * delayFineRate : 0;
  const activeHolidayDelayFine = rulesObj.calculateEntryDelayFine ? totalDelayMinutesHoliday * delayFineRate : 0;
  const activeFridayDelayFine = rulesObj.calculateEntryDelayFine ? totalDelayMinutesFriday * delayFineRate : 0;
  const activeDelayFine = activeDelayNormal + activeFridayDelayFine + activeHolidayDelayFine;

  const clothesDur = rulesObj.clothesChangingDuration || 15;
  const activeClothesNormal = rulesObj.deductClothesChangingTime ? normalDaysWorkedCount * clothesDur : 0;
  const activeHolidayClothes = rulesObj.deductClothesChangingTime ? holidayDaysWorkedCount * clothesDur : 0;
  const activeFridayClothes = rulesObj.deductClothesChangingTime ? fridayDaysWorkedCount * clothesDur : 0;
  const activeClothes = activeClothesNormal + activeHolidayClothes + activeFridayClothes;

  const overrideKey = `${activePeriodId}_${targetYear}_${targetMonth}`;
  const fallbackYMKey = `${targetYear}-${monthPad}_${targetYear}_${targetMonth}`;
  const mgmtHours = Math.max(
    0,
    Number(
      db.payrollManualOverrides?.[overrideKey]?.normalMgmtDeductions?.[emp.employeeCode] ??
        db.payrollManualOverrides?.[fallbackYMKey]?.normalMgmtDeductions?.[emp.employeeCode] ??
        0
    )
  );
  const mgmtMinutes = Math.round(mgmtHours * 60);

  const netWorkMinutes = Math.max(0, totalPresenceMinutes - activeDelayFine - activeClothes - mgmtMinutes);
  const netHolidayMinutes = Math.max(0, totalHolidayPresenceMinutes - activeHolidayDelayFine - activeHolidayClothes);
  const netFridayMinutes = rulesObj.calculateFridayWork
    ? Math.max(0, totalFridayPresenceMinutes - activeFridayDelayFine - activeFridayClothes)
    : 0;

  const skipLeaveInjection =
    treatAsDepartingMonth ||
    isDepartedOrSettlingInMonth(emp, targetYear, targetMonth, db.personnelSettlements, activePeriodId);

  const nonHolidayDelayAndClothes =
    activeDelayNormal +
    activeFridayDelayFine +
    activeClothesNormal +
    activeFridayClothes +
    (rulesObj.calculateHolidayWork ? 0 : activeHolidayDelayFine + activeHolidayClothes);
  const netNormalOnlyMinutes = Math.max(0, totalNormalOnlyPresenceMinutes - nonHolidayDelayAndClothes - mgmtMinutes);
  const presenceDaysCount = normalDaysWorkedCount + holidayDaysWorkedCount + fridayDaysWorkedCount;
  const totalDaysInMonth = setting && Number(setting.daysInMonth) > 0 ? Number(setting.daysInMonth) : calendarDaysCount;

  let allocatedLeaveMinutes = 0;
  let totalLeaveMinutes = prevLeaveMinutes;
  let currentWorkedMinutes = netWorkMinutes;
  let finalOtMinutes = 0;
  let finalLeaveMinutes = totalLeaveMinutes;
  let finalHolidayMinutes = 0;
  let usedLeaveMinutes = 0;
  let attendanceDaysWorked = 0;
  let daysWorkedCount = 0;

  const monthlyLeaveCapMinutes = getMonthlyLeaveMinutesForYearMonth(db, targetYear, activePeriodId);

  if (skipLeaveInjection) {
    const depPerf = resolveDepartedMonthAttendancePerf({
      netNormalOnlyMinutes,
      mandatoryOtMinutes: totalMandatoryOvertimeMinutes,
      netHolidayMinutes,
      requiredMinutes: reqMinutes,
      presenceDaysCount,
      prevLeaveMinutes,
      totalDaysInMonth,
      monthlyLeaveMinutes: monthlyLeaveCapMinutes
    });
    allocatedLeaveMinutes = depPerf.allocatedLeaveMinutes;
    totalLeaveMinutes = depPerf.totalLeaveMinutes;
    currentWorkedMinutes = depPerf.finalWorkedMinutes;
    finalOtMinutes = depPerf.finalOtMinutes;
    finalHolidayMinutes = depPerf.finalHolidayMinutes;
    finalLeaveMinutes = depPerf.finalLeaveMinutes;
    usedLeaveMinutes = depPerf.usedLeaveMinutes;
    attendanceDaysWorked = depPerf.attendanceDaysWorked;
    daysWorkedCount = depPerf.daysWorkedCount;
  } else {
    if (netWorkMinutes >= reqMinutes) allocatedLeaveMinutes = monthlyLeaveCapMinutes;
    else if (reqMinutes > 0) allocatedLeaveMinutes = Math.round((netWorkMinutes / reqMinutes) * monthlyLeaveCapMinutes);

    totalLeaveMinutes = prevLeaveMinutes + allocatedLeaveMinutes;
    const extraRequiredMinutes = Math.max(0, netWorkMinutes - reqMinutes);
    finalLeaveMinutes = totalLeaveMinutes;

    if (netWorkMinutes >= reqMinutes) {
      currentWorkedMinutes = reqMinutes;
      finalHolidayMinutes = Math.min(netHolidayMinutes, extraRequiredMinutes);
      finalOtMinutes = Math.max(0, extraRequiredMinutes - finalHolidayMinutes);
    } else {
      if (currentWorkedMinutes < reqMinutes && finalLeaveMinutes > 0) {
        const deficit = reqMinutes - currentWorkedMinutes;
        const leaveUsed = Math.min(deficit, finalLeaveMinutes);
        currentWorkedMinutes += leaveUsed;
        finalLeaveMinutes -= leaveUsed;
        usedLeaveMinutes = leaveUsed;
      }
      finalOtMinutes = 0;
      finalHolidayMinutes = 0;
    }

    const rawDays = currentWorkedMinutes / 60 / 8;
    const intDays = Math.floor(rawDays);
    const decDays = Number((rawDays - intDays).toFixed(4));
    attendanceDaysWorked = decDays < 0.5 ? intDays : intDays + 1;
    const isNormalFull = (currentWorkedMinutes >= reqMinutes || netWorkMinutes >= reqMinutes) && reqMinutes > 0;
    daysWorkedCount = isNormalFull ? totalDaysInMonth : attendanceDaysWorked;
  }

  const res = {
    hasRecords: true,
    daysWorkedCount,
    attendanceDaysWorked,
    netWorkMinutes,
    requiredMinutes: reqMinutes,
    finalWorkedMinutes: currentWorkedMinutes,
    finalOtMinutes,
    finalFridayMinutes: netFridayMinutes,
    finalHolidayMinutes,
    allocatedLeaveMinutes,
    totalLeaveMinutes,
    finalLeaveMinutes,
    usedLeaveMinutes
  };
  perfCache.set(cacheKey, res);
  return res;
}

/**
 * Resolves exact payroll snapshot for `(emp, targetYear, targetMonth)` either from:
 * 1) Registered/Locked `db.payrollItems` (+ `attendancePerformanceSnapshot`), or
 * 2) Live Attendance + Payroll Rules + `payrollManualOverrides` calculations.
 *
 * Returns `null` if no payroll or attendance record exists for that employee in that month.
 */
export function computeMonthlyPayrollSnapshotForEmployee(
  db: AppDatabase,
  activePeriodId: string,
  emp: Personnel | undefined,
  contract: PersonnelContract | undefined,
  targetYear: number,
  targetMonth: number,
  settlementEndDate?: string,
  unlockedMonthsMap?: Record<string, boolean>,
  options?: {
    treatEndAsDeparture?: boolean;
    provisionalDeparture?: ProvisionalSettlementPreview | null;
  }
): PayrollMonthSnapshot | null {
  if (!emp || !emp.employeeCode) return null;
  const empCodeNorm = normEmpCode(emp.employeeCode);
  const monthPad = String(targetMonth).padStart(2, '0');
  const ymPeriodId = `${targetYear}-${monthPad}`;
  const daysInMonth = getShamsiMonthDaysHelper(targetYear, targetMonth);
  const isSessionUnlocked = Boolean(unlockedMonthsMap && unlockedMonthsMap[`${targetYear}-${targetMonth}`]);

  // Check if this month is the employee's departure / settlement end month (strictly that month only)
  const treatEndAsDeparture = options?.treatEndAsDeparture !== false;
  const endYM = settlementEndDate
    ? (treatEndAsDeparture
        ? parseEffectiveDepartureLastWorkYM(settlementEndDate)
        : parseShamsiYearMonth(settlementEndDate))
    : null;
  const isSettlementEndMonth = Boolean(
    endYM && targetYear === endYM.year && targetMonth === endYM.month
  );
  const treatAsDepartingMonth =
    (treatEndAsDeparture && isSettlementEndMonth) ||
    isDepartedOrSettlingInMonth(
      emp,
      targetYear,
      targetMonth,
      db.personnelSettlements,
      activePeriodId,
      options?.provisionalDeparture
    );

  const activeRates = resolveSalaryRateForYearMonth(db, targetYear, targetMonth, activePeriodId);
  const effectiveContract =
    contract || findMatchingContractForYearMonth(db.personnelContracts || [], emp.employeeCode, targetYear, targetMonth, activePeriodId);

  // 1. Registered / Locked Payroll Item lookup (skipped if month is actively unlocked in session)
  const matchingItems = !isSessionUnlocked
    ? (db.payrollItems || []).filter(
        pi =>
          normEmpCode(pi.employeeCode) === empCodeNorm &&
          Number(pi.year) === Number(targetYear) &&
          Number(pi.month) === Number(targetMonth)
      )
    : [];
  const lockedItem: PayrollItem | undefined =
    matchingItems.find(pi => pi.periodId === activePeriodId) ||
    matchingItems.find(pi => pi.periodId === ymPeriodId) ||
    matchingItems[0];

  const matchingPeriods = !isSessionUnlocked
    ? (db.payrollPeriods || []).filter(
        pp => Number(pp.year) === Number(targetYear) && Number(pp.month) === Number(targetMonth)
      )
    : [];
  const lockedPeriod =
    matchingPeriods.find(pp => pp.periodId === (lockedItem?.periodId || activePeriodId)) || matchingPeriods[0];
  const lockedSnapRow = lockedPeriod?.attendancePerformanceSnapshot?.find(
    (s: any) =>
      s?.employee?.id === emp.id || (empCodeNorm && normEmpCode(s?.employee?.employeeCode) === empCodeNorm)
  );

  if (lockedItem) {
    const workedDays = Number(
      lockedItem.workDaysCount ?? lockedSnapRow?.daysWorkedCount ?? lockedSnapRow?.attendanceDaysWorked ?? daysInMonth
    );
    const overtimeHours = parseHMToRoundedHour(lockedItem.overtimeHoursHM, lockedItem.overtimeHours);
    const holidayWorkHours = parseHMToRoundedHour(lockedItem.holidayWorkHoursHM, lockedItem.holidayWorkHours);
    const fridayWorkHours = parseHMToRoundedHour(lockedItem.fridayWorkHoursHM, lockedItem.fridayWorkHours);

    const dailyBaseSalary = Number(
      lockedItem.dailyBaseSalary ||
        (workedDays > 0 && lockedItem.baseSalary ? Math.round(lockedItem.baseSalary / workedDays) : 0) ||
        activeRates?.dailyBaseSalary ||
        0
    );
    const baseSalary = Number(lockedItem.baseSalary ?? Math.round(dailyBaseSalary * workedDays));
    const foodAllowance = Number(lockedItem.foodAllowance ?? 0);
    const housingAllowance = Number(lockedItem.housingAllowance ?? 0);
    const childAllowance = Number(lockedItem.childAllowance ?? 0);
    const marriageAllowance = Number(lockedItem.marriageAllowance ?? 0);
    const seniorityBase = Number(lockedItem.seniorityBase ?? 0);
    const monthlyEidi = Number(lockedItem.monthlyEidi ?? 0);
    const monthlyYearsBenefit = Number(lockedItem.monthlyYearsBenefit ?? 0);
    const jobAllowance = Number(lockedItem.jobAllowance ?? 0);
    const overtimeAmount = Number(lockedItem.overtimePay ?? lockedItem.overtimeHoursAmount ?? 0);
    const holidayWorkAmount = Number(lockedItem.holidayWorkPay ?? 0);
    const fridayWorkAmount = Number(lockedItem.fridayWorkPay ?? 0);

    const computedGrossFallback =
      baseSalary +
      foodAllowance +
      housingAllowance +
      childAllowance +
      marriageAllowance +
      seniorityBase +
      monthlyEidi +
      monthlyYearsBenefit +
      jobAllowance +
      overtimeAmount +
      holidayWorkAmount +
      fridayWorkAmount;
    const grossSalary = Number(lockedItem.grossSalary ?? computedGrossFallback);

    const insurableGross = Number(
      lockedItem.insurableBase ?? (baseSalary + foodAllowance + housingAllowance)
    );
    const workerInsuranceShare = Number(
      lockedItem.workerInsurance7 ?? (emp.hasInsurance !== false ? Math.round(insurableGross * 0.07) : 0)
    );
    const payrollTax = Number(lockedItem.payrollTax ?? 0);
    const supplementaryInsurance = Number(lockedItem.supplementaryInsurance ?? 0);
    const deductionsAmount = Number(
      lockedItem.deductionsAmount ?? (workerInsuranceShare + payrollTax + supplementaryInsurance)
    );
    const netSalaryPayable = Number(
      lockedItem.payableAmount ?? Math.max(0, grossSalary - deductionsAmount)
    );

    const ratesResolved = resolveOvertimeHolidayFridayRates(dailyBaseSalary, activeRates);
    const perfFallback = !lockedSnapRow
      ? computeAttendancePerfForMonth(db, activePeriodId, emp, targetYear, targetMonth, treatAsDepartingMonth, 0, new Map(), unlockedMonthsMap)
      : null;
    const usedLeaveMinutes = lockedSnapRow
      ? Math.max(0, Number(lockedSnapRow.totalLeaveMinutes || 0) - Number(lockedSnapRow.finalLeaveMinutes || 0))
      : Math.max(0, Math.round(perfFallback?.usedLeaveMinutes || 0));
    const usedLeaveHours = Math.round((usedLeaveMinutes / 60) * 100) / 100;
    const usedLeaveDays = Math.round((usedLeaveMinutes / 60 / 8) * 100) / 100;
    const finalLeaveMinutes = lockedSnapRow
      ? Number(lockedSnapRow.finalLeaveMinutes || 0)
      : (perfFallback?.finalLeaveMinutes || 0);

    return {
      year: targetYear,
      month: targetMonth,
      sourceType: 'locked_payroll',
      workedDays,
      overtimeHours,
      holidayWorkHours,
      fridayWorkHours,
      usedLeaveDays,
      usedLeaveHours,
      usedLeaveMinutes,
      finalLeaveMinutes,
      dailyBaseSalary,
      baseSalary,
      foodAllowance,
      housingAllowance,
      childAllowance,
      marriageAllowance,
      seniorityBase,
      monthlyEidi,
      monthlyYearsBenefit,
      jobAllowance,
      overtimeHourlyRate: ratesResolved.overtimeHourlyRateVal,
      overtimeAmount,
      holidayHourlyRate: ratesResolved.holidayWorkHourlyRateVal,
      holidayWorkAmount,
      fridayHourlyRate: ratesResolved.fridayWorkHourlyRateVal,
      fridayWorkAmount,
      grossSalary,
      insurableGross,
      workerInsuranceShare,
      payrollTax,
      supplementaryInsurance,
      deductionsAmount,
      netSalaryPayable,
      payrollItemPayable: netSalaryPayable
    };
  }

  // 2. Live Attendance & Payroll Rules Calculation (mirrors PayrollManagement detailed table 1:1)
  const perf = computeAttendancePerfForMonth(
    db,
    activePeriodId,
    emp,
    targetYear,
    targetMonth,
    treatAsDepartingMonth,
    0,
    new Map(),
    unlockedMonthsMap
  );

  const overrideKey = `${activePeriodId}_${targetYear}_${targetMonth}`;
  const ymOverrideKey = `${ymPeriodId}_${targetYear}_${targetMonth}`;
  const manualWorkDays =
    db.payrollManualOverrides?.[overrideKey]?.workDays?.[emp.employeeCode] ??
    db.payrollManualOverrides?.[ymOverrideKey]?.workDays?.[emp.employeeCode];
  const manualInsDays =
    db.payrollManualOverrides?.[overrideKey]?.insuranceDays?.[emp.employeeCode] ??
    db.payrollManualOverrides?.[ymOverrideKey]?.insuranceDays?.[emp.employeeCode];

  if (!perf.hasRecords && manualWorkDays === undefined) {
    return null;
  }

  const targetWorkdaySetting = (db.monthlyWorkdaySettings || []).find(
    s => Number(s.year) === Number(targetYear) && Number(s.month) === Number(targetMonth)
  );
  const td =
    targetWorkdaySetting && Number(targetWorkdaySetting.daysInMonth) > 0
      ? Number(targetWorkdaySetting.daysInMonth)
      : daysInMonth || 30;

  const workedDays = manualWorkDays !== undefined ? Number(manualWorkDays) : perf.daysWorkedCount;
  const insDays = manualInsDays !== undefined ? Number(manualInsDays) : workedDays;

  const activeBaseDaily = activeRates && Number(activeRates.dailyBaseSalary) > 0 ? Number(activeRates.dailyBaseSalary) : 0;
  const specificContractDaily =
    effectiveContract?.contractDailySalary ||
    (effectiveContract?.contractBaseSalary ? Math.round(effectiveContract.contractBaseSalary / 30) : 0);
  const contractDailyBaseSalary =
    activeBaseDaily > 0
      ? specificContractDaily > activeBaseDaily &&
        normalizeDateStr(effectiveContract?.contractStartDate).startsWith(String(targetYear))
        ? specificContractDaily
        : activeBaseDaily
      : specificContractDaily > 0
      ? specificContractDaily
      : 4333333;

  const ratesResolved = resolveOvertimeHolidayFridayRates(contractDailyBaseSalary, activeRates);
  const overtimeHours = roundMinutesToHour(perf.finalOtMinutes);
  const holidayWorkHours = roundMinutesToHour(perf.finalHolidayMinutes);
  const fridayWorkHours = roundMinutesToHour(perf.finalFridayMinutes);

  const overtimeAmount = Math.round(overtimeHours * ratesResolved.overtimeHourlyRateVal);
  const holidayWorkAmount = Math.round(holidayWorkHours * ratesResolved.holidayWorkHourlyRateVal);
  const fridayWorkAmount = Math.round(fridayWorkHours * ratesResolved.fridayWorkHourlyRateVal);

  const baseSalary = Math.round(contractDailyBaseSalary * workedDays);
  const contractBaseMonthlySalary = effectiveContract
    ? (effectiveContract.contractBaseSalary || (effectiveContract.contractDailySalary ? effectiveContract.contractDailySalary * td : contractDailyBaseSalary * td))
    : (contractDailyBaseSalary * td);

  const contractFoodVal =
    (effectiveContract as any)?.calculatedFoodAllowance ??
    effectiveContract?.contract?.calculatedFoodAllowance ??
    (activeRates ? activeRates.foodAllowance : 14000000);
  const contractHousingVal =
    (effectiveContract as any)?.calculatedHousingAllowance ??
    effectiveContract?.contract?.calculatedHousingAllowance ??
    (activeRates ? activeRates.housingAllowance : 9000000);
  const countChildren = effectiveContract ? getEligibleChildrenCount(emp.insuranceHistoryDays || 0, emp.childrenList || []) : 0;
  const contractChildVal =
    (effectiveContract as any)?.calculatedChildAllowance ??
    effectiveContract?.contract?.calculatedChildAllowance ??
    (countChildren * (activeRates ? activeRates.childAllowance : 7166184));
  const isMarried = emp.maritalStatus === 'متاهل' || emp.isMarried === true;
  const contractMarriageVal =
    (effectiveContract as any)?.calculatedMarriageAllowance ??
    effectiveContract?.contract?.calculatedMarriageAllowance ??
    (isMarried ? (activeRates ? activeRates.marriageAllowance : 5000000) : 0);

  let contractSeniorityBaseValue = 0;
  if (effectiveContract) {
    const candidates = [
      effectiveContract.contractSeniorityBase,
      (effectiveContract as any).calculatedSeniorityBase,
      effectiveContract.contract?.contractSeniorityBase,
      effectiveContract.contract?.calculatedSeniorityBase,
      (effectiveContract as any).baseYearsRate,
      (effectiveContract as any).contract?.baseYearsRate,
      (effectiveContract as any).seniorityBase,
      (effectiveContract as any).contract?.seniorityBase
    ];
    for (const val of candidates) {
      if (val !== undefined && val !== null && val !== '') {
        contractSeniorityBaseValue = Math.max(0, Number(val) || 0);
        break;
      }
    }
  }

  const insKeySet = resolveInsuredItemKeysForMonth(db, effectiveContract, emp, targetYear, targetMonth, activePeriodId);
  const isTaxEnabled = Boolean(db.payrollCalculationRules?.calculatePayrollTax);
  const { isConfigured: isTaxCfg, keys: taxKeys } = resolveTaxableItemKeysForMonth(db, effectiveContract, targetYear, targetMonth, activePeriodId);
  const isTaxKey = (k: string) => (!isTaxCfg ? true : taxKeys.has(k));
  const monthlyExemption =
    activeRates && activeRates.taxableAmount !== undefined && Number(activeRates.taxableAmount) > 0
      ? Number(activeRates.taxableAmount)
      : 120000000;
  const yearBrackets = (db.taxBrackets || [])
    .filter(b => Number(b.fiscalYear) === Number(targetYear))
    .sort((a, b) => a.fromAmount - b.fromAmount);

  const contractDailyIns =
    effectiveContract?.contractDailyInsuranceSalary ||
    (activeRates ? activeRates.dailyInsuranceSalary : 0);
  const hasComplementary = emp.complementaryInsurance === true || emp.hasSupplementaryInsurance === true;
  const supplementaryInsurance = hasComplementary ? (emp.supplementaryInsurancePremium || 0) : 0;
  const isInsuredGeneral = emp.hasInsurance !== false;

  let calJobAllowance = effectiveContract
    ? (effectiveContract.jobAllowance !== undefined ? effectiveContract.jobAllowance : (emp.jobAllowance || 0))
    : 0;
  if (emp.isDailyWage && effectiveContract && (effectiveContract.contractDailyWageAmount || emp.contractDailyWageAmount)) {
    const dailyWageVal = effectiveContract.contractDailyWageAmount || emp.contractDailyWageAmount || 0;
    if (dailyWageVal > 0) {
      const targetNet26 = dailyWageVal * 26;
      const refWorkDays = 26;
      const refMonthDays = 30;
      const solverMonthlyEidiVal =
        (effectiveContract as any)?.calculatedMonthlyEidi ??
        effectiveContract?.contract?.calculatedMonthlyEidi ??
        Math.round((contractDailyBaseSalary * 30 * 2) / 12);
      const solverMonthlyYearsVal =
        (effectiveContract as any)?.calculatedMonthlyYears ??
        effectiveContract?.contract?.calculatedMonthlyYears ??
        Math.round((contractDailyBaseSalary * 30) / 12);

      const baseSalaryCalc = Math.round(contractDailyBaseSalary * refWorkDays);
      const foodAllowanceCalc = Math.round((contractFoodVal / refMonthDays) * refWorkDays);
      const housingAllowanceCalc = Math.round((contractHousingVal / refMonthDays) * refWorkDays);
      const childAllowanceCalc = Math.round((contractChildVal / refMonthDays) * refWorkDays);
      const marriageAllowanceCalc = Math.round((contractMarriageVal / refMonthDays) * refWorkDays);
      const seniorityBaseCalc = Math.round((contractSeniorityBaseValue / 30) * refWorkDays);
      const eidiCalc = Math.round((solverMonthlyEidiVal / refMonthDays) * refWorkDays);
      const yearsBenefitCalc = Math.round((solverMonthlyYearsVal / refMonthDays) * refWorkDays);
      const staticGross26 =
        baseSalaryCalc +
        foodAllowanceCalc +
        housingAllowanceCalc +
        childAllowanceCalc +
        marriageAllowanceCalc +
        seniorityBaseCalc +
        eidiCalc +
        yearsBenefitCalc;

      let insMonthlyBaseSolver = 0;
      if (contractDailyIns > 0) insMonthlyBaseSolver = contractDailyIns * refWorkDays;
      else if (insKeySet.has('dailyInsuranceSalary') && activeRates) insMonthlyBaseSolver = activeRates.dailyInsuranceSalary * refWorkDays;
      else if (insKeySet.has('dailyBaseSalary')) insMonthlyBaseSolver = contractDailyBaseSalary * refWorkDays;
      else insMonthlyBaseSolver = baseSalaryCalc;

      let staticInsBenefits26 = 0;
      if (insKeySet.has('housingAllowance')) staticInsBenefits26 += housingAllowanceCalc;
      if (insKeySet.has('foodAllowance')) staticInsBenefits26 += foodAllowanceCalc;
      if (insKeySet.has('childAllowance')) staticInsBenefits26 += childAllowanceCalc;
      if (insKeySet.has('marriageAllowance')) staticInsBenefits26 += marriageAllowanceCalc;
      if (insKeySet.has('baseYearsRate')) staticInsBenefits26 += seniorityBaseCalc;
      const isJobInsured = insKeySet.has('jobAllowance');

      let staticTaxBase26 = 0;
      if (isTaxCfg && isTaxKey('dailyInsuranceSalary')) {
        staticTaxBase26 += Math.round(contractDailyIns * refWorkDays);
      } else if (isTaxKey('dailyBaseSalary') || isTaxKey('baseSalary')) {
        staticTaxBase26 += baseSalaryCalc;
      }
      if (isTaxKey('housingAllowance')) staticTaxBase26 += housingAllowanceCalc;
      if (isTaxKey('foodAllowance')) staticTaxBase26 += foodAllowanceCalc;
      if (isTaxKey('childAllowance')) staticTaxBase26 += childAllowanceCalc;
      if (isTaxKey('marriageAllowance')) staticTaxBase26 += marriageAllowanceCalc;
      if (isTaxKey('baseYearsRate')) staticTaxBase26 += seniorityBaseCalc;
      const isJobTaxable = isTaxKey('jobAllowance');

      let low = 0;
      let high = 500000000;
      let solvedJ = 0;
      for (let iter = 0; iter < 45; iter++) {
        const mid = Math.floor((low + high) / 2);
        const computedInsBase26 = insMonthlyBaseSolver + staticInsBenefits26 + (isJobInsured ? mid : 0);
        const bimeh7 = isInsuredGeneral ? Math.round(computedInsBase26 * 0.07) : 0;
        const taxBase26 = staticTaxBase26 + (isJobTaxable ? mid : 0);
        const taxVal = isTaxEnabled ? computeProgressiveTaxForSync(taxBase26, monthlyExemption, yearBrackets) : 0;
        const net = Math.max(0, (staticGross26 + mid) - bimeh7 - taxVal - supplementaryInsurance);
        if (net >= targetNet26) {
          solvedJ = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      calJobAllowance = solvedJ;
    }
  }

  const foodAllowance = td > 0 ? Math.round((contractFoodVal / td) * workedDays) : 0;
  const housingAllowance = td > 0 ? Math.round((contractHousingVal / td) * workedDays) : 0;
  const childAllowance = td > 0 ? Math.round((contractChildVal / td) * workedDays) : 0;
  const marriageAllowance = td > 0 ? Math.round((contractMarriageVal / td) * workedDays) : 0;
  const seniorityBase = Math.round((contractSeniorityBaseValue / 30) * workedDays);
  const monthlyYearsBenefit = Math.round((contractBaseMonthlySalary / 365) * workedDays);
  const monthlyEidi = Math.round(((contractBaseMonthlySalary * 2) / 365) * workedDays);
  const jobAllowance = td > 0 ? Math.round((calJobAllowance / td) * workedDays) : 0;

  const grossSalary =
    baseSalary +
    foodAllowance +
    housingAllowance +
    childAllowance +
    marriageAllowance +
    seniorityBase +
    monthlyEidi +
    monthlyYearsBenefit +
    jobAllowance +
    overtimeAmount +
    holidayWorkAmount +
    fridayWorkAmount;

  const effectiveDailyIns =
    contractDailyIns > 0
      ? contractDailyIns
      : insKeySet.has('dailyInsuranceSalary') && activeRates && Number(activeRates.dailyInsuranceSalary) > 0
      ? Number(activeRates.dailyInsuranceSalary)
      : contractDailyBaseSalary;

  const dailySeniorityRate =
    contractSeniorityBaseValue > 0
      ? Math.round(contractSeniorityBaseValue / 30)
      : seniorityBase > 0 && workedDays > 0
      ? Math.round(seniorityBase / workedDays)
      : 0;
  const insMonthlyBase = (effectiveDailyIns + dailySeniorityRate) * insDays;
  const insFood = td > 0 ? Math.round((contractFoodVal / td) * insDays) : 0;
  const insHousing = td > 0 ? Math.round((contractHousingVal / td) * insDays) : 0;
  const insJob = td > 0 ? Math.round((calJobAllowance / td) * insDays) : 0;

  let insBenefits = 0;
  if (insKeySet.has('housingAllowance')) insBenefits += insHousing;
  if (insKeySet.has('foodAllowance')) insBenefits += insFood;
  if (insKeySet.has('childAllowance')) insBenefits += childAllowance;
  if (insKeySet.has('marriageAllowance')) insBenefits += marriageAllowance;
  if (insKeySet.has('jobAllowance')) insBenefits += insJob;

  const insurableGross = insMonthlyBase + insBenefits;
  const isInsured = emp.hasInsurance !== false && emp.isSubjectToWorkerPremium !== false;
  const workerInsuranceShare = isInsured ? Math.round(insurableGross * 0.07) : 0;

  // Tax calculation matching PayrollManagement
  let payrollTax = 0;
  if (isTaxEnabled && effectiveContract) {
    const taxDailyInsSelected = isTaxCfg && isTaxKey('dailyInsuranceSalary');
    const taxDailyBaseSelected = isTaxKey('dailyBaseSalary') || isTaxKey('baseSalary');

    let taxBase = 0;
    if (taxDailyInsSelected) {
      taxBase += Math.round((contractDailyIns || 0) * workedDays);
    } else if (taxDailyBaseSelected) {
      taxBase += baseSalary;
    }
    if (isTaxKey('housingAllowance')) taxBase += housingAllowance;
    if (isTaxKey('foodAllowance')) taxBase += foodAllowance;
    if (isTaxKey('childAllowance')) taxBase += childAllowance;
    if (isTaxKey('marriageAllowance')) taxBase += marriageAllowance;
    if (isTaxKey('baseYearsRate')) taxBase += seniorityBase;
    if (isTaxKey('jobAllowance')) taxBase += jobAllowance;
    taxBase += overtimeAmount + fridayWorkAmount + holidayWorkAmount;

    payrollTax = computeProgressiveTaxForSync(taxBase, monthlyExemption, yearBrackets);
  }

  const deductionsAmount = workerInsuranceShare + payrollTax + supplementaryInsurance;
  const netSalaryPayable = Math.max(0, grossSalary - deductionsAmount);
  const usedLeaveMinutes = Math.max(0, Math.round(perf.usedLeaveMinutes || 0));
  const usedLeaveHours = Math.round((usedLeaveMinutes / 60) * 100) / 100;
  const usedLeaveDays = Math.round((usedLeaveMinutes / 60 / 8) * 100) / 100;

  return {
    year: targetYear,
    month: targetMonth,
    sourceType: 'live_attendance',
    workedDays,
    overtimeHours,
    holidayWorkHours,
    fridayWorkHours,
    usedLeaveDays,
    usedLeaveHours,
    usedLeaveMinutes,
    finalLeaveMinutes: perf.finalLeaveMinutes,
    dailyBaseSalary: contractDailyBaseSalary,
    baseSalary,
    foodAllowance,
    housingAllowance,
    childAllowance,
    marriageAllowance,
    seniorityBase,
    monthlyEidi,
    monthlyYearsBenefit,
    jobAllowance,
    overtimeHourlyRate: ratesResolved.overtimeHourlyRateVal,
    overtimeAmount,
    holidayHourlyRate: ratesResolved.holidayWorkHourlyRateVal,
    holidayWorkAmount,
    fridayHourlyRate: ratesResolved.fridayWorkHourlyRateVal,
    fridayWorkAmount,
    grossSalary,
    insurableGross,
    workerInsuranceShare,
    payrollTax,
    supplementaryInsurance,
    deductionsAmount,
    netSalaryPayable,
    payrollItemPayable: netSalaryPayable
  };
}

/**
 * Summarizes confirmed Treasury payments made to a given personnel member within `[startDate..endDate]`.
 */
export function getEmployeeTreasuryPaidInPeriod(
  db: AppDatabase,
  emp: Personnel | undefined,
  startDate?: string,
  endDate?: string
): { totalPaid: number; advancesTotal: number; salaryPaidTotal: number; count: number } {
  if (!emp) return { totalPaid: 0, advancesTotal: 0, salaryPaidTotal: 0, count: 0 };

  const normStart = startDate ? normalizeDateStr(startDate) : '';
  const normEnd = endDate ? normalizeDateStr(endDate) : '';
  const empName = (emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`).trim();
  const empCodeNorm = normEmpCode(emp.employeeCode);

  let totalPaid = 0;
  let advancesTotal = 0;
  let salaryPaidTotal = 0;
  let count = 0;

  (db.treasuryPayments || []).forEach(tp => {
    if (tp.status === 'cancelled' || tp.beneficiaryType !== 'personnel') return;
    const matchId = tp.beneficiaryId && (tp.beneficiaryId === emp.id || normEmpCode(tp.beneficiaryId) === empCodeNorm);
    const matchName = empName && tp.beneficiaryName && tp.beneficiaryName.trim() === empName;
    if (!matchId && !matchName) return;

    const pDate = normalizeDateStr(tp.date);
    if (normStart && pDate && pDate < normStart) return;
    if (normEnd && pDate && pDate > normEnd) return;

    const amt = Number(tp.amount || 0);
    totalPaid += amt;
    count++;
    const cat = String(tp.category || '');
    const desc = String(tp.description || '');
    if (cat.includes('مساعده') || desc.includes('مساعده')) {
      advancesTotal += amt;
    } else {
      salaryPaidTotal += amt;
    }
  });

  return { totalPaid, advancesTotal, salaryPaidTotal, count };
}

/**
 * Summarizes registered `db.payrollItems` net payable amounts within `[startDate..endDate]`.
 */
export function getEmployeeRegisteredPayrollsSummary(
  db: AppDatabase,
  emp: Personnel | undefined,
  startDate?: string,
  endDate?: string,
  activePeriodId?: string
): { totalAllMonthsNet: number; totalPriorMonthsNet: number; monthsCount: number } {
  if (!emp || !emp.employeeCode) {
    return { totalAllMonthsNet: 0, totalPriorMonthsNet: 0, monthsCount: 0 };
  }

  const startYM = startDate ? parseShamsiYearMonth(startDate) : null;
  const endYM = endDate ? parseShamsiYearMonth(endDate) : null;
  const empCodeNorm = normEmpCode(emp.employeeCode);

  const byYM = new Map<string, { year: number; month: number; payableAmount: number }>();

  (db.payrollItems || []).forEach(pi => {
    if (normEmpCode(pi.employeeCode) !== empCodeNorm) return;
    const y = Number(pi.year || 0);
    const m = Number(pi.month || 0);
    if (!y || !m) return;

    if (startYM && (y < startYM.year || (y === startYM.year && m < startYM.month))) return;
    if (endYM && (y > endYM.year || (y === endYM.year && m > endYM.month))) return;

    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!byYM.has(key) || pi.periodId === activePeriodId) {
      byYM.set(key, { year: y, month: m, payableAmount: Number(pi.payableAmount || 0) });
    }
  });

  const sorted = Array.from(byYM.values()).sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
  const totalAllMonthsNet = sorted.reduce((sum, item) => sum + item.payableAmount, 0);
  const totalPriorMonthsNet =
    sorted.length > 1
      ? sorted.slice(0, sorted.length - 1).reduce((sum, item) => sum + item.payableAmount, 0)
      : 0;

  return {
    totalAllMonthsNet,
    totalPriorMonthsNet,
    monthsCount: sorted.length
  };
}
