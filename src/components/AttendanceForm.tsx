/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { AppDatabase, Personnel, AttendanceRecord, PayrollCalculationRules, ShiftAssignment } from '../types';
import { toPersianDigits, toEnglishDigits, formatWithCommas, parseNumber, getTodayJalali, isEmployeeEligibleForMonth, isEmployeeDepartedInMonth, getDefaultYearMonthFromPeriod, isShiftAssignmentInMonth } from '../utils/persianUtils';
import { getPeriodPayrollRules, getPeriodPersonnelCapabilities } from '../utils/periodIsolation';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../utils/simpleId';
import { 
  Calendar, Upload, AlertTriangle, CheckCircle, Plus, Trash2, Edit3, Save, Download, RefreshCw, Users, Clock, AlertCircle, Info, Check, X, FileSpreadsheet, Search, ArrowLeftRight, RotateCcw, Sparkles, Briefcase,
  Radio, Wifi, Smartphone, Cpu, Printer, ArrowRight
} from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import AttendanceDeviceManagement from './AttendanceDeviceManagement';
import * as XLSX from 'xlsx';
import {
  didSettleLeaveThroughMonth,
  findFirstAttendanceDateForCode,
  isDepartedOrSettlingInMonth,
  resolveDepartedMonthAttendancePerf
} from '../utils/payrollSettlementSync';
import {
  buildCandidateShiftsPool,
  runSmartShiftDiagnosticEngine,
  SmartShiftDiagnosticCandidate,
  SmartShiftSourceCategory
} from '../utils/smartShiftDiagnostic';

interface AttendanceFormProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  activePeriodId: string;
  selectedYear?: number;
  selectedMonth?: number;
  onYearChange?: (year: number) => void;
  onMonthChange?: (month: number) => void;
  initialActiveTab?: 'records' | 'mismatches' | 'performance';
  initialMismatchEmployeeFilter?: string;
  initialInspectEmployeeId?: string;
  onClearInitialNavigation?: () => void;
  isMonthLocked?: boolean;
}

function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  try {
    const date = new Date(gy, gm - 1, gd);
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    let jy = 0, jm = 0, jd = 0;
    parts.forEach(p => {
      // Use toEnglishDigits to safely convert any Persian/Arabic digits returned by Intl
      const val = parseInt(toEnglishDigits(p.value), 10);
      if (p.type === 'year') jy = val;
      else if (p.type === 'month') jm = val;
      else if (p.type === 'day') jd = val;
    });
    if (jy && jm && jd) {
      return { jy, jm, jd };
    }
  } catch (e) {
    console.error('Error in Intl conversion', e);
  }

  // Reliable manual fallback:
  const g_days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const j_days_in_month = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  const gy_sub = gy - 1600;
  const gm_sub = gm - 1;
  const gd_sub = gd - 1;

  let g_day_no = 365 * gy_sub + Math.floor((gy_sub + 3) / 4) - Math.floor((gy_sub + 99) / 100) + Math.floor((gy_sub + 399) / 400);

  for (let i = 0; i < gm_sub; ++i) {
    g_day_no += g_days_in_month[i];
  }
  if (gm_sub > 1 && ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0))) {
    g_day_no++;
  }
  g_day_no += gd_sub;

  let j_day_no = g_day_no - 79;
  const j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;

  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;

  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }

  let i = 0;
  for (i = 0; i < 11 && j_day_no >= j_days_in_month[i]; ++i) {
    j_day_no -= j_days_in_month[i];
  }
  const jm = i + 1;
  const jd = j_day_no + 1;

  return { jy, jm, jd };
}

function parseDateToJalali(dateStr: string): string {
  let clean = toEnglishDigits(dateStr).trim();
  if (/^\d{8}$/.test(clean)) {
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    clean = `${y}/${m}/${d}`;
  }

  const parts = clean.replace(/[-\/]/g, '/').split('/');
  if (parts.length < 3) return dateStr;
  
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  let d = parseInt(parts[2], 10);
  
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
  
  // If year is in the last part (e.g. DD/MM/YYYY or MM/DD/YYYY)
  if (d >= 2000) {
    let realY = d;
    let realM = m;
    let realD = y;
    if (y > 12) {
      realD = y;
      realM = m;
    } else if (m > 12) {
      realD = m;
      realM = y;
    }
    const { jy, jm, jd } = gregorianToJalali(realY, realM, realD);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }
  
  if (y >= 2000) {
    const { jy, jm, jd } = gregorianToJalali(y, m, d);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }

  if (d >= 1300 && d < 1600 && m >= 1 && m <= 12 && y >= 1 && y <= 31) {
    return `${d}/${String(m).padStart(2, '0')}/${String(y).padStart(2, '0')}`;
  }
  
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

function getJalaliDaysInMonth(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const r = year % 33;
  const isLeap = r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
  return isLeap ? 30 : 29;
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = toEnglishDigits(timeStr).trim();
  const parts = clean.split(':');
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function getCircularMinutesDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

function resolveEntryExitTimesForShift(
  rawTimes: string[],
  shiftStartStr?: string,
  shiftEndStr?: string
): {
  firstEntry: string;
  lastExit: string;
  firstEntryMins: number;
  lastExitMins: number;
  shiftStartMins: number;
  shiftEndMins: number;
  sortedTimes: string[];
} {
  const cleaned = (rawTimes || []).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      firstEntry: '',
      lastExit: '',
      firstEntryMins: 0,
      lastExitMins: 0,
      shiftStartMins: 0,
      shiftEndMins: 0,
      sortedTimes: []
    };
  }

  const sStartRaw = shiftStartStr ? timeToMinutes(toEnglishDigits(shiftStartStr).trim()) : 0;
  const sEndRaw = shiftEndStr ? timeToMinutes(toEnglishDigits(shiftEndStr).trim()) : 0;
  const isOvernight = Boolean(shiftStartStr && shiftEndStr && sEndRaw <= sStartRaw);

  if (isOvernight) {
    const pivot = Math.floor((sStartRaw + sEndRaw) / 2);
    const toTimeline = (t: string) => {
      const m = timeToMinutes(t);
      return m < pivot ? m + 1440 : m;
    };
    const sorted = [...cleaned].sort((a, b) => toTimeline(a) - toTimeline(b));
    return {
      firstEntry: sorted[0],
      lastExit: sorted[sorted.length - 1],
      firstEntryMins: toTimeline(sorted[0]),
      lastExitMins: toTimeline(sorted[sorted.length - 1]),
      shiftStartMins: sStartRaw,
      shiftEndMins: sEndRaw + 1440,
      sortedTimes: sorted
    };
  }

  const sorted = [...cleaned].sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  return {
    firstEntry: sorted[0],
    lastExit: sorted[sorted.length - 1],
    firstEntryMins: timeToMinutes(sorted[0]),
    lastExitMins: timeToMinutes(sorted[sorted.length - 1]),
    shiftStartMins: sStartRaw,
    shiftEndMins: sEndRaw,
    sortedTimes: sorted
  };
}

function calculateDailyWorkedMinutes(times: string[], statuses?: number[]): number {
  if (times.length < 2) return 0;
  const parseTimeToMinutes = (t: string): number => timeToMinutes(t);
  const rStatuses = statuses || times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
  
  // Pair time and status, and sort them numerically by minutes
  const pairs = times.map((time, idx) => ({ time, status: rStatuses[idx], mins: parseTimeToMinutes(time) }));
  pairs.sort((a, b) => a.mins - b.mins);

  let totalMinutes = 0;
  let activeEntryTime: number | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const timeMin = pairs[i].mins;
    const status = pairs[i].status;
    if (status === 0) {
      activeEntryTime = timeMin;
    } else if (status === 1 && activeEntryTime !== null) {
      totalMinutes += (timeMin - activeEntryTime);
      activeEntryTime = null;
    }
  }
  // Support overnight shift punch pairs (e.g. 22:00 entry and 06:00 exit -> after numeric sort, exit 06:00 appears before entry 22:00)
  if (totalMinutes === 0 && pairs.length === 2 && pairs[0].status === 1 && pairs[1].status === 0) {
    return (pairs[0].mins + 1440) - pairs[1].mins;
  }
  if (totalMinutes === 0 && pairs.length >= 2) {
    const first = pairs[0].mins;
    const last = pairs[pairs.length - 1].mins;
    if (last > first) {
      return last - first;
    }
  }
  return totalMinutes > 0 ? totalMinutes : 0;
}

function formatMinutesToHoursAndMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return toPersianDigits(`${hours}:${mins}`);
}

function formatMinutesToDecimalHours(minutes: number): string {
  const decimal = (minutes / 60).toFixed(1);
  const parsed = parseFloat(decimal);
  return toPersianDigits(parsed.toString());
}

function formatMinutesToHM(mins: number): string {
  const isNegative = mins < 0;
  const absMins = Math.abs(Math.round(mins));
  const h = Math.floor(absMins / 60);
  const m = absMins % 60;
  return `${isNegative ? '-' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Compact self-contained Jalali to Persian weekday converter
function getPersianWeekdayOfDate(dateStr: string): string {
  const FA_WEEKDAYS_MAP = [
    'یک‌شنبه', // 0: Sunday
    'دوشنبه',  // 1: Monday
    'سه‌شنبه', // 2: Tuesday
    'چهارشنبه',// 3: Wednesday
    'پنج‌شنبه', // 4: Thursday
    'جمعه',    // 5: Friday
    'شنبه'     // 6: Saturday
  ];

  try {
    const cleanDate = toEnglishDigits(dateStr).replace(/\//g, '-');
    const parts = cleanDate.split('-');
    if (parts.length === 3) {
      const jy = parseInt(parts[0], 10);
      const jm = parseInt(parts[1], 10);
      const jd = parseInt(parts[2], 10);

      // Convert to Gregorian using standard algorithm
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
      const dayIdx = gregDate.getDay();
      return FA_WEEKDAYS_MAP[dayIdx];
    }
  } catch (err) {
    console.error('Error parsing weekday', err);
  }
  return 'شنبه';
}

function normalizeDateStr(dateStr: string): string {
  if (!dateStr) return '';
  const clean = toEnglishDigits(dateStr).trim().replace(/[-\/]/g, '/');
  const parts = clean.split('/');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }
  }
  return dateStr;
}

// Robust helper to check if an attendance record belongs to an employee
// STRICTLY matches by attendanceCode (کد پرسنل حضور و غیاب) ONLY — NEVER employeeCode!
export function isRecordForEmployee(rec: any, empObj: any): boolean {
  if (!rec || !empObj) return false;
  const clean = (c: any) => {
    const s = toEnglishDigits(String(c || '')).trim().toLowerCase();
    const noZeros = s.replace(/^0+/, '');
    return noZeros === '' && s !== '' ? '0' : noZeros;
  };
  const recCode = clean(rec.attendanceCode);
  const rawEmpAtt = toEnglishDigits(String(empObj.attendanceCode ?? empObj.personnel?.attendanceCode ?? '')).trim();
  const empAttTokens = rawEmpAtt
    ? rawEmpAtt.split(/[\s,،;|/\\]+/).map(t => clean(t)).filter(Boolean)
    : [];

  // 1. When the attendance record has a punch code (recCode), match STRICTLY against personnel.attendanceCode ONLY.
  // Never fall back to employeeCode!
  if (recCode) {
    return empAttTokens.includes(recCode);
  }

  // 2. Fallback to employeeId ONLY when the record has NO attendanceCode at all (e.g. manual entry without punch code)
  if (rec.employeeId && rec.employeeId === empObj.id) {
    return true;
  }

  return false;
}

// Helper to normalize day name for robust matching (removes half-spaces, spaces, hyphens)
const normalizeWeekday = (day: string): string => {
  return (day || '').replace(/[\u200C\s-]/g, '');
};

const isSameDay = (dayA: string, dayB: string): boolean => {
  return normalizeWeekday(dayA) === normalizeWeekday(dayB);
};

// Robust helper to check if a shift assignment belongs to an employee
export function isShiftAssignmentForEmployee(assign: any, empObj: any): boolean {
  if (!assign || !empObj) return false;

  const clean = (c: any) => {
    const s = toEnglishDigits(String(c || '')).trim().toLowerCase();
    const noZeros = s.replace(/^0+/, '');
    return noZeros === '' && s !== '' ? '0' : noZeros;
  };

  const assignEmpId = assign.employeeId ? String(assign.employeeId).trim() : '';
  const empId = empObj.id ? String(empObj.id).trim() : '';
  const empCode = clean(empObj.employeeCode);
  const empAttCode = clean(empObj.attendanceCode);
  const assignCode = clean(assign.employeeCode);
  const subCode = clean(assign.substitutedEmployeeCode);

  // When an assignment is marked on leave, ONLY its designated substitute (if any) works that shift;
  // the original employee on leave must NOT be treated as assigned to this shift.
  if (assign.isOnLeave) {
    if (!subCode) return false;
    return Boolean(
      (empCode && subCode === empCode) ||
      (empAttCode && subCode === empAttCode) ||
      (empId && subCode === clean(empId))
    );
  }

  // 1. Strict match by employeeId if present on both
  if (assignEmpId && empId && assignEmpId === empId) {
    return true;
  }

  if (!assignCode) return false;

  // 2. Direct match with employeeId string if stored in employeeCode
  if (empId && assignCode === clean(empId)) return true;

  // 3. Primary canonical match: by employeeCode (weekly shifts from 'شیفت‌بندی پرسنل')
  if (empCode && assignCode === empCode) {
    if (assignEmpId && empId && assignEmpId !== empId) {
      return false;
    }
    return true;
  }

  // 4. Secondary fallback match: by attendanceCode (only if assign doesn't conflict with another employeeId)
  if (empAttCode && assignCode === empAttCode) {
    if (assignEmpId && empId && assignEmpId !== empId) {
      return false;
    }
    return true;
  }

  return false;
}

const normalizeAttCode = (val: any): string => {
  if (val === undefined || val === null) return '';
  let s = toEnglishDigits(String(val))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200B-\u200F\u202A-\u202E\u00A0\uFEFF\s]/g, '')
    .toLowerCase();
  if (/^\d+\.0+$/.test(s)) {
    s = s.replace(/\.0+$/, '');
  }
  return s;
};

const stripLeadingZeros = (s: string): string => {
  if (!s) return '';
  const noZeros = s.replace(/^0+/, '');
  return noZeros === '' ? '0' : noZeros;
};

const splitAttCodes = (raw: any): string[] => {
  if (raw === undefined || raw === null) return [];
  return toEnglishDigits(String(raw))
    .split(/[,،;|/\s]+/)
    .map(part => normalizeAttCode(part))
    .filter(Boolean);
};

const getEmpAttCode = (p: any): string => {
  if (!p) return '';
  return String(p.attendanceCode ?? p.personnel?.attendanceCode ?? '').trim();
};

const getEmpCode = (p: any): string => {
  if (!p) return '';
  return String(p.employeeCode ?? p.personnel?.employeeCode ?? '').trim();
};

const comparePersonnelByAttCode = (a: Personnel, b: Personnel): number => {
  const tokA = splitAttCodes(getEmpAttCode(a))[0] || '';
  const tokB = splitAttCodes(getEmpAttCode(b))[0] || '';
  const hasA = tokA.length > 0;
  const hasB = tokB.length > 0;
  if (hasA && !hasB) return -1;
  if (!hasA && hasB) return 1;
  if (hasA && hasB) {
    const isNumA = /^\d+$/.test(tokA);
    const isNumB = /^\d+$/.test(tokB);
    if (isNumA && isNumB) {
      const diff = Number(tokA) - Number(tokB);
      if (diff !== 0) return diff;
    }
    const cmp = tokA.localeCompare(tokB, 'fa', { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }
  const empA = normalizeAttCode(getEmpCode(a));
  const empB = normalizeAttCode(getEmpCode(b));
  if (empA && empB) {
    const empCmp = empA.localeCompare(empB, 'fa', { numeric: true, sensitivity: 'base' });
    if (empCmp !== 0) return empCmp;
  }
  const nameA = a.fullName || `${a.firstName || ''} ${a.lastName || ''}`.trim();
  const nameB = b.fullName || `${b.firstName || ''} ${b.lastName || ''}`.trim();
  return nameA.localeCompare(nameB, 'fa');
};

const isDummyUnknownPersonnel = (p: Personnel): boolean => {
  const fn = (p.firstName || '').trim();
  const ln = (p.lastName || '').trim();
  const full = (p.fullName || '').trim();
  if (!fn && !ln && !full) return true;
  if (fn === 'نامشخص' || full === 'نامشخص') return true;
  if (/^نامشخص\s*\(.*\)$/.test(full)) return true;
  return false;
};

export default function AttendanceForm(props: AttendanceFormProps) {
  const { db, onUpdateDb, activePeriodId, isMonthLocked } = props;

  // Parse active period to default year and month
  const fallbackShiftYearMonth = useMemo(
    () => getDefaultYearMonthFromPeriod(db.periods?.find(p => p.id === activePeriodId), activePeriodId),
    [db.periods, activePeriodId]
  );

  const defaultYear = fallbackShiftYearMonth.year;
  const defaultMonth = fallbackShiftYearMonth.month;

  const [localYear, setLocalYear] = useState<number>(defaultYear);
  const [localMonth, setLocalMonth] = useState<number>(defaultMonth);

  const selectedYear = props.selectedYear !== undefined ? props.selectedYear : localYear;
  const selectedMonth = props.selectedMonth !== undefined ? props.selectedMonth : localMonth;

  const setSelectedYear = (y: number) => {
    if (props.onYearChange) {
      props.onYearChange(y);
    } else {
      setLocalYear(y);
    }
  };

  const setSelectedMonth = (m: number) => {
    if (props.onMonthChange) {
      props.onMonthChange(m);
    } else {
      setLocalMonth(m);
    }
  };

  useEffect(() => {
    if (props.selectedYear === undefined) {
      setLocalYear(defaultYear);
    }
  }, [defaultYear, props.selectedYear]);

  useEffect(() => {
    if (props.selectedMonth === undefined) {
      setLocalMonth(defaultMonth);
    }
  }, [defaultMonth, props.selectedMonth]);
  const [activeTab, setActiveTab] = useState<'records' | 'mismatches' | 'performance'>('records');
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState<boolean>(false);
  const [mismatchEmployeeFilter, setMismatchEmployeeFilter] = useState<string>('all');
  const [mismatchViewMode, setMismatchViewMode] = useState<'active' | 'anomalies' | 'approved'>('active');
  const [anomalyTypeFilter, setAnomalyTypeFilter] = useState<'all' | 'no_shift' | 'delay_2h' | 'unauthorized_2h'>('all');

  useEffect(() => {
    if (props.initialActiveTab) {
      setActiveTab(props.initialActiveTab);
    }
    if (props.initialMismatchEmployeeFilter) {
      setMismatchEmployeeFilter(props.initialMismatchEmployeeFilter);
    }
    if (props.initialInspectEmployeeId) {
      setInspectEmployeeId(props.initialInspectEmployeeId);
    }
    if (props.initialActiveTab || props.initialMismatchEmployeeFilter || props.initialInspectEmployeeId) {
      if (props.onClearInitialNavigation) {
        props.onClearInitialNavigation();
      }
    }
  }, [props.initialActiveTab, props.initialMismatchEmployeeFilter, props.initialInspectEmployeeId, props.onClearInitialNavigation]);
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'valid' | 'unknown'>('all');
  const [errorSubFilter, setErrorSubFilter] = useState<'all' | 'no_entry' | 'no_exit' | 'extra'>('all');
  const [personnelSearch, setPersonnelSearch] = useState<string>('');
  
  // Local state for loaded attendance records
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  const recordsWithTimesIndex = useMemo(() => {
    const clean = (c: any) => stripLeadingZeros(normalizeAttCode(c));
    const codesWithTimes = new Set<string>();
    const empIdsWithTimesNoCode = new Set<string>();
    const allMonthCodes = new Set<string>();
    const allMonthEmpIdsNoCode = new Set<string>();

    records.forEach(r => {
      const recCode = clean(r.attendanceCode);
      if (recCode) {
        allMonthCodes.add(recCode);
      } else if (r.employeeId) {
        allMonthEmpIdsNoCode.add(r.employeeId);
      }
      if (r.times && r.times.length > 0) {
        if (recCode) {
          codesWithTimes.add(recCode);
        } else if (r.employeeId) {
          empIdsWithTimesNoCode.add(r.employeeId);
        }
      }
    });

    const registeredPayrollEmpCodes = new Set<string>();
    (db.payrollItems || []).forEach(pi => {
      if (pi.periodId === activePeriodId && Number(pi.year) === Number(selectedYear) && Number(pi.month) === Number(selectedMonth)) {
        const c = normalizeAttCode(pi.employeeCode);
        if (c) registeredPayrollEmpCodes.add(c);
      }
    });

    return {
      codes: codesWithTimes,
      empIdsNoCode: empIdsWithTimesNoCode,
      allMonthCodes,
      allMonthEmpIdsNoCode,
      registeredPayrollEmpCodes,
      clean
    };
  }, [records, db.payrollItems, activePeriodId, selectedYear, selectedMonth]);

  const hasRecordWithTimesForEmployee = React.useCallback((empObj: any) => {
    if (!empObj) return false;
    const attTokens = splitAttCodes(getEmpAttCode(empObj));
    if (attTokens.length > 0 && attTokens.some(tok => recordsWithTimesIndex.codes.has(stripLeadingZeros(tok)))) {
      return true;
    }
    return Boolean(empObj.id && recordsWithTimesIndex.empIdsNoCode.has(empObj.id));
  }, [recordsWithTimesIndex]);

  const hasAnyRecordOrPayrollForEmployee = React.useCallback((empObj: any) => {
    if (!empObj) return false;
    const normEmpCode = normalizeAttCode(getEmpCode(empObj));
    if (normEmpCode && recordsWithTimesIndex.registeredPayrollEmpCodes.has(normEmpCode)) {
      return true;
    }
    const attTokens = splitAttCodes(getEmpAttCode(empObj));
    if (attTokens.length > 0 && attTokens.some(tok => recordsWithTimesIndex.allMonthCodes.has(stripLeadingZeros(tok)))) {
      return true;
    }
    return Boolean(empObj.id && recordsWithTimesIndex.allMonthEmpIdsNoCode.has(empObj.id));
  }, [recordsWithTimesIndex]);

  // All personnel strictly belonging to activePeriodId
  const allPeriodPersonnel = useMemo(() => {
    return (db.personnel || []).filter(p => p.periodId === activePeriodId);
  }, [db.personnel, activePeriodId]);

  // All genuine (non-dummy) personnel defined in the active period
  const allGenuinePeriodPersonnel = useMemo(() => {
    return allPeriodPersonnel.filter(p => !isDummyUnknownPersonnel(p));
  }, [allPeriodPersonnel]);

  // Genuine personnel of the active period eligible for the selected payroll month (entryDate matched, departed included during departure month & excluded from month after)
  const activePeriodPersonnel = useMemo(() => {
    const seenCodes = new Set<string>();
    return allGenuinePeriodPersonnel
      .filter(p => {
        const hasHistoricalOrAtt = hasAnyRecordOrPayrollForEmployee(p);
        return isEmployeeEligibleForMonth(p, Number(selectedYear), Number(selectedMonth), hasHistoricalOrAtt);
      })
      .filter(p => {
        const uniqueKey = getEmpCode(p) ? normalizeAttCode(getEmpCode(p)) : p.id;
        if (!uniqueKey || seenCodes.has(uniqueKey)) return false;
        seenCodes.add(uniqueKey);
        return true;
      })
      .sort((a, b) => (a.fullName || `${a.firstName || ''} ${a.lastName || ''}`).localeCompare(b.fullName || `${b.firstName || ''} ${b.lastName || ''}`, 'fa'));
  }, [allGenuinePeriodPersonnel, selectedYear, selectedMonth, hasAnyRecordOrPayrollForEmployee]);

  // Personnel list for the attendance-code matcher combobox sorted ascending by attendanceCode (کد تردد)
  const matcherPersonnelList = useMemo(() => {
    return [...activePeriodPersonnel].sort(comparePersonnelByAttCode);
  }, [activePeriodPersonnel]);

  // Dynamically compute unknown / unregistered codes strictly for the current selected month and active period
  // Uses ALL personnel defined in the period so any code already defined in پرونده پرسنل (including registered unknowns) is never falsely flagged as an error
  const unregisteredCodes = useMemo(() => {
    const unknownByCleanKey = new Map<string, string>();
    const validCodesSet = new Set<string>();
    const knownById = new Map<string, Personnel>();

    allPeriodPersonnel.forEach(p => {
      if (p.id && !knownById.has(p.id)) knownById.set(p.id, p);
      // Strictly collect ONLY attendanceCode (کد پرسنل حضور و غیاب) — never employeeCode
      const attTokens = splitAttCodes(getEmpAttCode(p));
      if (attTokens.length > 0) {
        attTokens.forEach(tok => {
          validCodesSet.add(tok);
          validCodesSet.add(stripLeadingZeros(tok));
        });
      }
    });

    records.forEach(rec => {
      if (rec.periodId && rec.periodId !== activePeriodId) return;

      const rYear = Number(rec.year);
      const rMonth = Number(rec.month);
      let isForSelectedMonth = false;
      if (!isNaN(rYear) && !isNaN(rMonth) && rYear > 0 && rMonth > 0) {
        isForSelectedMonth = rYear === Number(selectedYear) && rMonth === Number(selectedMonth);
      } else if (rec.date) {
        const parts = toEnglishDigits(rec.date).split(/[\/\-]/);
        if (parts.length >= 2) {
          const py = parseInt(parts[0], 10);
          const pm = parseInt(parts[1], 10);
          isForSelectedMonth = py === Number(selectedYear) && pm === Number(selectedMonth);
        }
      }

      if (!isForSelectedMonth) return;

      const cleanCode = normalizeAttCode(rec.attendanceCode);
      const cleanWithoutZeros = stripLeadingZeros(cleanCode);

      // Check if record's attendance code matches any personnel's attendanceCode defined in this period
      if (cleanCode && (validCodesSet.has(cleanCode) || (cleanWithoutZeros && validCodesSet.has(cleanWithoutZeros)))) {
        return;
      }

      // Check if record is already linked to a defined personnel whose attendanceCode matches this record's punch code
      if (rec.employeeId) {
        const linkedEmp = knownById.get(rec.employeeId);
        if (linkedEmp) {
          const empAttTokens = splitAttCodes(getEmpAttCode(linkedEmp)).map(stripLeadingZeros);
          if (!cleanWithoutZeros || (empAttTokens.length > 0 && empAttTokens.includes(cleanWithoutZeros))) {
            return;
          }
        }
      }

      const rawDisplayCode = toEnglishDigits(String(rec.attendanceCode || '')).trim();
      const dedupKey = cleanWithoutZeros || cleanCode || rawDisplayCode;
      if (rawDisplayCode && dedupKey && !unknownByCleanKey.has(dedupKey)) {
        unknownByCleanKey.set(dedupKey, rawDisplayCode);
      }
    });

    return Array.from(unknownByCleanKey.values());
  }, [records, allPeriodPersonnel, activePeriodId, selectedYear, selectedMonth]);

  const setUnregisteredCodes = (_codes: string[]) => {};
  const [selectedPersonnelMap, setSelectedPersonnelMap] = useState<Record<string, string>>({});
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const isDataLoaded = records.length > 0;
  const [correctionReports, setCorrectionReports] = useState<any[]>([]);
  const [showReportsModal, setShowReportsModal] = useState<boolean>(false);
  const [pendingCorrectedRecords, setPendingCorrectedRecords] = useState<AttendanceRecord[] | null>(null);
  const [approvedReportIds, setApprovedReportIds] = useState<string[]>([]);
  const [fallbackSectionId, setFallbackSectionId] = useState<string>('');

  // States for mismatch report enhancements
  const [draftShifts, setDraftShifts] = useState<Record<string, string>>({}); // recordKey -> sectionId
  const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null); // recordKey
  const [draftTimes, setDraftTimes] = useState<string>(''); // comma-separated clock times input
  const [draftEntry, setDraftEntry] = useState<string>('');
  const [draftExit, setDraftExit] = useState<string>('');
  const [approvedMismatches, setApprovedMismatches] = useState<string[]>(() => {
    if (db.approvedMismatches && Array.isArray(db.approvedMismatches) && db.approvedMismatches.length > 0) {
      return db.approvedMismatches;
    }
    try {
      const stored = localStorage.getItem('approved_mismatches');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  React.useEffect(() => {
    if (db.approvedMismatches && Array.isArray(db.approvedMismatches) && db.approvedMismatches.length > 0) {
      setApprovedMismatches(prev => {
        const merged = Array.from(new Set([...prev, ...db.approvedMismatches!]));
        return merged;
      });
    }
  }, [db.approvedMismatches]);

  const periodProductionSections = useMemo(
    () => (db.productionSections || []).filter(s => s.periodId === activePeriodId),
    [db.productionSections, activePeriodId]
  );
  const periodShifts = useMemo(
    () => (db.productionSections || []).filter(s => s.periodId === activePeriodId),
    [db.productionSections, activePeriodId]
  );
  const periodOfficialHolidays = useMemo(
    () => (db.officialHolidays || []).filter(h => h.periodId === activePeriodId),
    [db.officialHolidays, activePeriodId]
  );
  const periodMonthlyWorkdaySettings = useMemo(
    () => (db.monthlyWorkdaySettings || []).filter(s => s.periodId === activePeriodId),
    [db.monthlyWorkdaySettings, activePeriodId]
  );
  const periodRules = useMemo(
    () => getPeriodPayrollRules(db, activePeriodId),
    [db, activePeriodId]
  );
  const periodCapabilities = useMemo(
    () => getPeriodPersonnelCapabilities(db, activePeriodId),
    [db, activePeriodId]
  );

  React.useEffect(() => {
    if (periodProductionSections.length > 0 && !fallbackSectionId) {
      setFallbackSectionId(periodProductionSections[0].id);
    }
  }, [periodProductionSections, fallbackSectionId]);

  const [inspectEmployeeId, setInspectEmployeeId] = useState<string>('');
  const [editingDayNum, setEditingDayNum] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<string>('');
  const [editingExit, setEditingExit] = useState<string>('');

  const [isSmartFixModalOpen, setIsSmartFixModalOpen] = useState<boolean>(false);
  const [smartFixCandidates, setSmartFixCandidates] = useState<SmartShiftDiagnosticCandidate[]>([]);
  const [selectedFixKeys, setSelectedFixKeys] = useState<Set<string>>(new Set());
  const [smartFixFilter, setSmartFixFilter] = useState<'all' | SmartShiftSourceCategory>('all');

  const getAuthorizedCapabilitiesForEmployee = (emp: Personnel | undefined | null): string[] => {
    if (!emp) return [];
    const realEmp = (db.personnel || []).find(p => p.periodId === activePeriodId && (p.id === emp.id || (p.employeeCode && emp.employeeCode && p.employeeCode === emp.employeeCode))) || emp;
    const isDeparted = (realEmp as any).isDeparted === true || !!realEmp.departureDate || realEmp.isActive === false;
    const capsSet = new Set<string>();
    if (realEmp.capabilities && Array.isArray(realEmp.capabilities)) {
      realEmp.capabilities.forEach(c => capsSet.add(c));
    }
    if (isDeparted && capsSet.size === 0 && realEmp.employeeCode) {
      const dbCaps = periodCapabilities?.[realEmp.employeeCode];
      if (dbCaps && Array.isArray(dbCaps)) {
        dbCaps.forEach(c => capsSet.add(c));
      }
      if (db.shiftSchemes) {
        db.shiftSchemes.filter(scheme => scheme.periodId === activePeriodId).forEach(scheme => {
          const schemeCaps = scheme.personnelCapabilities?.[realEmp.employeeCode];
          if (schemeCaps && Array.isArray(schemeCaps)) {
            schemeCaps.forEach(c => capsSet.add(c));
          }
        });
      }
    }
    return Array.from(capsSet);
  };

  const resolveShiftDisplayName = (shiftId: string): string => {
    if (!shiftId || shiftId === 'none') return 'بدون شیفت';
    const sec = periodProductionSections.find(s => s.id === shiftId || s.departmentCategoryId === shiftId);
    if (sec) return `${sec.name}${sec.startTime && sec.endTime ? ` (${sec.startTime} - ${sec.endTime})` : ''}`;
    const sh = periodShifts.find(s => s.id === shiftId);
    if (sh) return `${sh.name}${sh.startTime && sh.endTime ? ` (${sh.startTime} - ${sh.endTime})` : ''}`;
    return shiftId;
  };

  const handleRevertShiftToDefault = (mismatch: any) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر شیفت وجود ندارد.');
      return;
    }
    const cleanDate = normalizeDateStr(mismatch.dateStr);
    const updatedAssignments = (db.shiftAssignments || []).filter(a => 
      !(a.date && normalizeDateStr(a.date) === cleanDate && isShiftAssignmentForEmployee(a, mismatch.employee))
    );
    const recordKey = `${mismatch.employee.id}-${mismatch.dateStr}`;
    const nextApproved = approvedMismatches.filter(k => k !== recordKey && k !== `anomaly-${recordKey}`);
    setApprovedMismatches(nextApproved);
    try {
      localStorage.setItem('approved_mismatches', JSON.stringify(nextApproved));
    } catch {}

    onUpdateDb({
      ...db,
      approvedMismatches: nextApproved,
      shiftAssignments: updatedAssignments
    });
  };

  const handleReevaluateMonthlyShiftScheme = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر شیفت وجود ندارد.');
      return;
    }
    if (!confirm('آیا از بازنشانی و اعمال شیفت‌بندی جدید پایه برای این ماه اطمینان دارید؟ تمام تغییرات دستی این ماه بازنشانی خواهند شد.')) {
      return;
    }
    const ymPrefix = `${selectedYear}/${String(selectedMonth).padStart(2, '0')}`;
    const updatedAssignments = (db.shiftAssignments || []).filter(a => {
      if (!a.date) return true;
      const cleanDate = normalizeDateStr(a.date);
      return !cleanDate.startsWith(ymPrefix);
    });

    onUpdateDb({
      ...db,
      shiftAssignments: updatedAssignments
    });
    alert('شیفت‌بندی این ماه با موفقیت بازنشانی و طبق الگوی پایه مجدداً محاسبه گردید.');
  };

  const { personnelWithCirculation, personnelWithoutCirculation, presentPersonnelList } = useMemo(() => {
    const withCirc: Personnel[] = [];
    const withoutCirc: Personnel[] = [];
    
    // Deduplicate and use allPeriodPersonnel (activePeriodId prioritized) to ensure registered personnel in that period are displayed
    const seenIds = new Set<string>();
    const uniquePersonnel = allPeriodPersonnel
      .filter(p => {
        if (!p.id) return false;
        if (seenIds.has(p.id)) return false;
        seenIds.add(p.id);
        return true;
      });

    uniquePersonnel.forEach(p => {
      const hasCirc = hasRecordWithTimesForEmployee(p);
      const isEligible = isEmployeeEligibleForMonth(p, Number(selectedYear), Number(selectedMonth), hasCirc);

      if (!isEligible) {
        return;
      }

      if (hasCirc) {
        withCirc.push(p);
      } else {
        withoutCirc.push(p);
      }
    });

    return {
      personnelWithCirculation: withCirc,
      personnelWithoutCirculation: withoutCirc,
      presentPersonnelList: [...withCirc, ...withoutCirc]
    };
  }, [hasRecordWithTimesForEmployee, allPeriodPersonnel, selectedYear, selectedMonth]);

  React.useEffect(() => {
    if (presentPersonnelList.length > 0) {
      const exists = presentPersonnelList.some(p => p.id === inspectEmployeeId);
      if (!exists) {
        setInspectEmployeeId(presentPersonnelList[0].id);
      }
    } else {
      setInspectEmployeeId('');
    }
  }, [presentPersonnelList, inspectEmployeeId]);

  const calendarDays = useMemo(() => {
    const daysCount = getJalaliDaysInMonth(selectedYear, selectedMonth);
    const list = [];
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${selectedYear}/${String(selectedMonth).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
      const weekday = getPersianWeekdayOfDate(dateStr);
      list.push({
        dayNum: d,
        dateStr,
        weekday
      });
    }
    return list;
  }, [selectedYear, selectedMonth]);

  const shiftsList = useMemo(() => {
    return periodShifts;
  }, [periodShifts]);

  const getEmployeeShiftAssignmentForWeekday = (empObj: any, weekdayName: string, dateStr?: string) => {
    if (dateStr) {
      const dateMatch = (db.shiftAssignments || []).find(a => 
        a.periodId === activePeriodId &&
        a.date && normalizeDateStr(a.date) === normalizeDateStr(dateStr) &&
        isShiftAssignmentForEmployee(a, empObj)
      );
      if (dateMatch) {
        return dateMatch;
      }
    }

    // Support fixed shift defined in Personnel Profile
    if (empObj?.shiftScheduleType === 'fixed') {
      const fixedId = empObj.fixedShiftId || 'none';
      if (fixedId === 'none') {
        return { deptId: 'none', shiftId: 'none', id: `fixed-none-${empObj.id}`, isOnLeave: false };
      }
      return { deptId: fixedId, shiftId: fixedId, id: `fixed-${empObj.id}`, isOnLeave: false };
    }

    // Default rotating shift: use per-month weekly schedule from shift assignments
    const weeklyMatch = (db.shiftAssignments || []).find(a =>
      isSameDay(a.dayName, weekdayName) &&
      (!a.date) &&
      isShiftAssignmentInMonth(a, activePeriodId, Number(selectedYear), Number(selectedMonth), fallbackShiftYearMonth) &&
      isShiftAssignmentForEmployee(a, empObj)
    );

    return weeklyMatch ? weeklyMatch : null;
  };

  const handleRunSmartShiftDiagnostic = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان پایش و تغییر شیفت وجود ندارد.');
      return;
    }

    const candidateShiftsPool = buildCandidateShiftsPool(periodProductionSections);

    const getRawTimesForDay = (emp: Personnel, dateStr: string): string[] => {
      const normDate = normalizeDateStr(dateStr);
      const merged: string[] = [];
      records.forEach(r => {
        if (normalizeDateStr(r.date) === normDate && isRecordForEmployee(r, emp)) {
          (r.times || []).forEach(t => {
            if (t && !merged.includes(t)) merged.push(t);
          });
        }
      });
      return merged;
    };

    const candidates = runSmartShiftDiagnosticEngine({
      activeMismatches: activeMismatchesUnfiltered,
      activeAnomalies: activeAnomaliesUnfiltered,
      approvedItems: approvedMismatchItems,
      candidateShiftsPool,
      getAuthorizedCapabilities: (emp) => getAuthorizedCapabilitiesForEmployee(emp),
      getRawTimesForDay,
      rules: periodRules
    });

    if (candidates.length === 0) {
      alert('پایش هوشمند انجام شد: هیچ شیفت پیشنهادی مناسب‌تر یا قابل تاییدی (منطبق با ماتریس توانمندی پرسنل) برای ترددهای دارای عدم تطابق، بدون شیفت، تایید شده یا مغایرت‌های غیرمجاز پیدا نشد.');
      return;
    }

    // Stage the best suggested / approvable shift into table row dropdowns so even manual row inspection reflects it
    const nextDrafts = { ...draftShifts };
    candidates.forEach(c => {
      nextDrafts[c.key] = c.suggestedShift.shiftId;
    });
    setDraftShifts(nextDrafts);

    setSmartFixFilter('all');
    setSmartFixCandidates(candidates);
    setSelectedFixKeys(new Set(candidates.map(c => c.key)));
    setIsSmartFixModalOpen(true);
  };

  const handleApplySmartShiftFixes = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر شیفت وجود ندارد.');
      return;
    }

    let updatedAssignments = [...(db.shiftAssignments || [])];
    const genSaId = createSimpleIdGenerator(updatedAssignments, getPrefixForCollection('shiftAssignments'));
    let updatedAttendanceRecords = [...(db.attendanceRecords || [])];
    const newApproved = [...approvedMismatches];

    const nextDrafts = { ...draftShifts };
    let assignedCount = 0;
    let approvedCount = 0;

    smartFixCandidates.forEach(cand => {
      if (!selectedFixKeys.has(cand.key)) return;
      const { mismatch, suggestedShift, requiresUserApproval, approvalKeysToAdd } = cand;
      const empCapabilities = getAuthorizedCapabilitiesForEmployee(mismatch.employee);
      if (!empCapabilities.includes(suggestedShift.shiftId)) return;

      delete nextDrafts[cand.key];
      if (requiresUserApproval) {
        approvedCount++;
      } else {
        assignedCount++;
      }

      const targetCode = mismatch.employee.employeeCode || mismatch.employee.attendanceCode || '';
      const cleanDate = normalizeDateStr(mismatch.dateStr);

      const existingAssign = updatedAssignments.find(a =>
        a.periodId === activePeriodId &&
        a.date && normalizeDateStr(a.date) === cleanDate &&
        isShiftAssignmentForEmployee(a, mismatch.employee)
      );

      if (existingAssign) {
        updatedAssignments = updatedAssignments.map(a =>
          a.id === existingAssign.id ? {
            ...a,
            periodId: activePeriodId,
            year: Number(selectedYear),
            month: Number(selectedMonth),
            deptId: suggestedShift.shiftId,
            shiftId: suggestedShift.shiftId,
            employeeId: mismatch.employee.id,
            employeeCode: targetCode || a.employeeCode,
            isOnLeave: false,
            date: cleanDate
          } : a
        );
      } else {
        const newAssign = {
          id: genSaId(),
          periodId: activePeriodId,
          year: Number(selectedYear),
          month: Number(selectedMonth),
          dayName: mismatch.weekday,
          shiftId: suggestedShift.shiftId,
          deptId: suggestedShift.shiftId,
          employeeCode: targetCode,
          employeeId: mismatch.employee.id,
          isSubstitute: false,
          isOnLeave: false,
          date: cleanDate
        };
        updatedAssignments.push(newAssign);
      }

      const resolvedName = resolveShiftDisplayName(suggestedShift.shiftId);
      updatedAttendanceRecords = updatedAttendanceRecords.map(r =>
        normalizeDateStr(r.date) === cleanDate && isRecordForEmployee(r, mismatch.employee)
          ? { ...r, shiftId: suggestedShift.shiftId, shiftName: resolvedName }
          : r
      );

      if (requiresUserApproval && approvalKeysToAdd && approvalKeysToAdd.length > 0) {
        approvalKeysToAdd.forEach(k => newApproved.push(k));
      }
    });

    setDraftShifts(nextDrafts);

    const uniqueApproved = Array.from(new Set(newApproved));
    setApprovedMismatches(uniqueApproved);
    try {
      localStorage.setItem('approved_mismatches', JSON.stringify(uniqueApproved));
    } catch {}

    onUpdateDb({
      ...db,
      approvedMismatches: uniqueApproved,
      shiftAssignments: updatedAssignments,
      attendanceRecords: updatedAttendanceRecords
    });
    setRecords(updatedAttendanceRecords.filter(r => r.periodId === activePeriodId && Number(r.year) === Number(selectedYear) && Number(r.month) === Number(selectedMonth)));

    setIsSmartFixModalOpen(false);
    const totalProcessed = assignedCount + approvedCount;
    const summaryParts: string[] = [];
    if (assignedCount > 0) summaryParts.push(`${toPersianDigits(assignedCount)} مورد اصلاح و انتساب بهترین شیفت مجاز`);
    if (approvedCount > 0) summaryParts.push(`${toPersianDigits(approvedCount)} مورد تایید مغایرت غیرمجاز با انتخاب بهترین شیفت مجاز`);
    alert(`عملیات پایش هوشمند با موفقیت برای ${toPersianDigits(totalProcessed)} مورد ثبت شد (${summaryParts.join(' و ')}).`);
  };

  const handleUpdateShiftForDay = (empObj: any, weekdayName: string, selectedSectionId: string, dateStr?: string, customApprovedMismatches?: string[]) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر شیفت وجود ندارد.');
      return;
    }
    const isNoShift = selectedSectionId === 'none';
    if (!isNoShift) {
      const empCapabilities = getAuthorizedCapabilitiesForEmployee(empObj);
      if (!empCapabilities.includes(selectedSectionId)) {
        alert(`خطا در انتساب شیفت: شیفت انتخاب‌شده جزو بخش‌های مجاز تعریف‌شده در «ماتریس ارزیابی توانمندی پرسنل در بخش‌های تولیدی» برای «${empObj?.fullName || 'این پرسنل'}» نیست.`);
        return;
      }
    }
    let updatedAssignments = [...(db.shiftAssignments || [])];
    const targetCode = empObj.employeeCode || empObj.attendanceCode || '';

    if (dateStr) {
      const cleanDate = normalizeDateStr(dateStr);
      const existingAssign = updatedAssignments.find(a => 
        a.date && normalizeDateStr(a.date) === cleanDate &&
        isShiftAssignmentForEmployee(a, empObj)
      );

      if (existingAssign) {
        updatedAssignments = updatedAssignments.map(a => 
          a.id === existingAssign.id ? { 
            ...a, 
            periodId: activePeriodId,
            year: Number(selectedYear),
            month: Number(selectedMonth),
            deptId: selectedSectionId,
            shiftId: selectedSectionId,
            employeeId: empObj.id,
            employeeCode: targetCode || a.employeeCode,
            isOnLeave: isNoShift,
            date: cleanDate
          } : a
        );
      } else {
        const newAssign = {
          id: nextSimpleId(updatedAssignments, getPrefixForCollection('shiftAssignments')),
          periodId: activePeriodId,
          year: Number(selectedYear),
          month: Number(selectedMonth),
          dayName: weekdayName,
          shiftId: selectedSectionId,
          deptId: selectedSectionId,
          employeeCode: targetCode,
          employeeId: empObj.id,
          isSubstitute: false,
          isOnLeave: isNoShift,
          date: cleanDate
        };
        updatedAssignments.push(newAssign);
      }
    } else {
      const targetYear = Number(selectedYear);
      const targetMonth = Number(selectedMonth);
      const existingAssign = updatedAssignments.find(a => 
        isSameDay(a.dayName, weekdayName) &&
        (!a.date) &&
        isShiftAssignmentInMonth(a, activePeriodId, targetYear, targetMonth, fallbackShiftYearMonth) &&
        isShiftAssignmentForEmployee(a, empObj)
      );

      if (selectedSectionId === 'none') {
        if (existingAssign) {
          updatedAssignments = updatedAssignments.map(a => 
            a.id === existingAssign.id ? { 
              ...a, 
              periodId: activePeriodId,
              year: targetYear,
              month: targetMonth,
              deptId: 'none',
              shiftId: 'none',
              employeeId: empObj.id,
              employeeCode: targetCode || a.employeeCode,
              isOnLeave: true
            } : a
          );
        } else {
          const newAssign = {
            id: nextSimpleId(updatedAssignments, getPrefixForCollection('shiftAssignments')),
            periodId: activePeriodId,
            year: targetYear,
            month: targetMonth,
            dayName: weekdayName,
            shiftId: 'none',
            deptId: 'none',
            employeeCode: targetCode,
            employeeId: empObj.id,
            isSubstitute: false,
            isOnLeave: true
          };
          updatedAssignments.push(newAssign);
        }
      } else {
        if (existingAssign) {
          updatedAssignments = updatedAssignments.map(a => 
            a.id === existingAssign.id ? { 
              ...a, 
              periodId: activePeriodId,
              year: targetYear,
              month: targetMonth,
              deptId: selectedSectionId,
              shiftId: selectedSectionId,
              employeeId: empObj.id,
              employeeCode: targetCode || a.employeeCode,
              isOnLeave: false
            } : a
          );
        } else {
          const newAssign = {
            id: nextSimpleId(updatedAssignments, getPrefixForCollection('shiftAssignments')),
            periodId: activePeriodId,
            year: targetYear,
            month: targetMonth,
            dayName: weekdayName,
            shiftId: selectedSectionId,
            deptId: selectedSectionId,
            employeeCode: targetCode,
            employeeId: empObj.id,
            isSubstitute: false,
            isOnLeave: false
          };
          updatedAssignments.push(newAssign);
        }
      }
    }

    let updatedPersonnel = db.personnel || [];
    if (!dateStr && empObj?.shiftScheduleType === 'fixed') {
      updatedPersonnel = updatedPersonnel.map(p => 
        p.id === empObj.id ? { ...p, fixedShiftId: selectedSectionId } : p
      );
    }

    let updatedAttendanceRecords = db.attendanceRecords || [];
    if (dateStr) {
      const cleanDate = normalizeDateStr(dateStr);
      const resolvedName = resolveShiftDisplayName(selectedSectionId);
      updatedAttendanceRecords = updatedAttendanceRecords.map(r =>
        normalizeDateStr(r.date) === cleanDate && isRecordForEmployee(r, empObj)
          ? { ...r, shiftId: selectedSectionId, shiftName: resolvedName }
          : r
      );
    }

    onUpdateDb({
      ...db,
      approvedMismatches: customApprovedMismatches || (db.approvedMismatches && db.approvedMismatches.length > 0 ? db.approvedMismatches : approvedMismatches),
      personnel: updatedPersonnel,
      shiftAssignments: updatedAssignments,
      attendanceRecords: updatedAttendanceRecords
    });
    if (dateStr) {
      setRecords(updatedAttendanceRecords.filter(r => r.periodId === activePeriodId && Number(r.year) === Number(selectedYear) && Number(r.month) === Number(selectedMonth)));
    }
  };

  const handleSaveInlineAttendance = (mismatch: any, entryStr: string, exitStr: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان ویرایش تردد وجود ندارد.');
      return;
    }
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const cleanEntry = toEnglishDigits((entryStr || '').trim());
    const cleanExit = toEnglishDigits((exitStr || '').trim());

    const parts: string[] = [];
    if (cleanEntry && timeRegex.test(cleanEntry)) parts.push(cleanEntry);
    if (cleanExit && timeRegex.test(cleanExit)) parts.push(cleanExit);

    if (parts.length === 0) {
      alert('لطفاً حداقل یک ساعت ورود یا خروج معتبر با فرمت HH:MM وارد نمایید (مثال: 08:00)');
      return;
    }

    const cleanTimes = parts;

    const isRecordForEmployeeHelper = (rec: any, empObj: any) => isRecordForEmployee(rec, empObj);

    const existingRecord = (db.attendanceRecords || []).find(r => 
      isRecordForEmployeeHelper(r, mismatch.employee) && 
      normalizeDateStr(r.date) === normalizeDateStr(mismatch.dateStr)
    );

    let updatedRecords = [...(db.attendanceRecords || [])];

    if (existingRecord) {
      updatedRecords = updatedRecords.map(r => 
        r.id === existingRecord.id 
          ? { 
              ...r, 
              times: cleanTimes,
              statuses: cleanTimes.map((_, i) => i % 2 === 0 ? 0 : 1)
            }
          : r
      );
    } else {
      const dateParts = (mismatch.dateStr || '').split('/');
      const recordYear = dateParts[0] ? parseInt(dateParts[0], 10) : Number(selectedYear);
      const recordMonth = dateParts[1] ? parseInt(dateParts[1], 10) : Number(selectedMonth);

      const newRecord = {
        id: nextSimpleId(updatedRecords, getPrefixForCollection('attendanceRecords')),
        employeeId: mismatch.employee.id,
        attendanceCode: mismatch.employee.attendanceCode || '',
        employeeName: mismatch.employee.fullName,
        date: mismatch.dateStr,
        times: cleanTimes,
        statuses: cleanTimes.map((_, i) => i % 2 === 0 ? 0 : 1),
        periodId: activePeriodId,
        year: recordYear,
        month: recordMonth
      };
      updatedRecords.push(newRecord);
    }

    onUpdateDb({
      ...db,
      attendanceRecords: updatedRecords
    });

    setRecords(updatedRecords);
    setEditingAttendanceId(null);
  };

  const handleApproveMismatch = (mismatch: any, mode: 'mismatch' | 'anomaly' = 'mismatch') => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تایید یا تغییر مغایرت وجود ندارد.');
      return;
    }
    const recordKey = `${mismatch.employee.id}-${mismatch.dateStr}`;
    const approvalKey = mode === 'anomaly' ? `anomaly-${recordKey}` : recordKey;
    const nextApproved = Array.from(new Set([...approvedMismatches, approvalKey]));
    setApprovedMismatches(nextApproved);
    try {
      localStorage.setItem('approved_mismatches', JSON.stringify(nextApproved));
    } catch {}

    // Commit the selected shift assignment if draft was selected or if mismatch has a target shift
    const selectedDraft = draftShifts[recordKey] !== undefined ? draftShifts[recordKey] : mismatch.currentSectionId;
    if (selectedDraft && selectedDraft !== 'none') {
      handleUpdateShiftForDay(mismatch.employee, mismatch.weekday, selectedDraft, mismatch.dateStr, nextApproved);
    } else {
      onUpdateDb({
        ...db,
        approvedMismatches: nextApproved
      });
    }
  };

  const handleUnapproveMismatch = (item: any) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر وضعیت تایید وجود ندارد.');
      return;
    }
    const recordKey = `${item.employee.id}-${item.dateStr}`;
    const keysToRemove = new Set<string>([
      item.approvalKey,
      recordKey,
      `anomaly-${recordKey}`,
      ...(Array.isArray(item.approvalKeys) ? item.approvalKeys : [])
    ]);
    const nextApproved = approvedMismatches.filter(k => !keysToRemove.has(k));
    setApprovedMismatches(nextApproved);
    try {
      localStorage.setItem('approved_mismatches', JSON.stringify(nextApproved));
    } catch {}

    onUpdateDb({
      ...db,
      approvedMismatches: nextApproved
    });
  };

  const inspectionDetails = useMemo(() => {
    if (activeTab !== 'performance' || !inspectEmployeeId) return null;
    
    const emp = (db.personnel || []).find(p => p.id === inspectEmployeeId);
    if (!emp) return null;

    const isRecordForEmployeeHelper = (rec: any, empObj: any) => isRecordForEmployee(rec, empObj);

    const empRecords = records.filter(r => isRecordForEmployeeHelper(r, emp));
    const recordMap = new Map<string, AttendanceRecord>();
    empRecords.forEach(r => {
      recordMap.set(normalizeDateStr(r.date), r);
    });

    const getShiftForDay = (empObj: any, dateStr: string, targetY: number = Number(selectedYear), targetM: number = Number(selectedMonth)) => {
      const weekdayName = getPersianWeekdayOfDate(dateStr);
      let assignment = (db.shiftAssignments || []).find(a => 
        a.date && normalizeDateStr(a.date) === normalizeDateStr(dateStr) &&
        isShiftAssignmentForEmployee(a, empObj)
      );

      if (assignment) {
        if (assignment.deptId === 'none' || assignment.shiftId === 'none' || assignment.isOnLeave) return null;
      } else {
        // If employee has a fixed shift schedule defined in profile
        if (empObj?.shiftScheduleType === 'fixed') {
          if (!empObj.fixedShiftId || empObj.fixedShiftId === 'none') return null;
          const matchedShift = (db.productionSections || []).find(sh => sh.id === empObj.fixedShiftId);

          let section = (db.productionSections || []).find(sec => sec.id === empObj.fixedShiftId || sec.departmentCategoryId === empObj.fixedShiftId);
          const resolvedStart = section?.startTime || matchedShift?.startTime;
          const resolvedEnd = section?.endTime || matchedShift?.endTime;
          if (!resolvedStart || !resolvedEnd) return null;
          return {
            name: section?.name || matchedShift?.name || 'شیفت ثابت',
            startTime: toEnglishDigits(resolvedStart).trim(),
            endTime: toEnglishDigits(resolvedEnd).trim()
          };
        }

        assignment = (db.shiftAssignments || []).find(a => 
          isSameDay(a.dayName, weekdayName) &&
          (!a.date) &&
          isShiftAssignmentInMonth(a, activePeriodId, targetY, targetM, fallbackShiftYearMonth) &&
          isShiftAssignmentForEmployee(a, empObj)
        );
      }
      if (!assignment || assignment.deptId === 'none' || assignment.shiftId === 'none' || (assignment.isOnLeave && !assignment.substitutedEmployeeCode)) return null;

      const matchedShift = (db.productionSections || []).find(sh => sh.id === assignment.shiftId || sh.id === assignment.deptId);

      const directSection = (db.productionSections || []).find(sec => sec.id === assignment.deptId || sec.id === assignment.shiftId);
      let section = directSection || (db.productionSections || []).find(sec => sec.departmentCategoryId === assignment.deptId);
      if (!section && !matchedShift) {
        const empAlloc = (db.personnelAllocations || []).find(pa => 
          (pa.employeeCode === empObj.employeeCode || 
           (empObj.attendanceCode && pa.employeeCode === empObj.attendanceCode)) &&
          pa.periodId === activePeriodId
        );
        if (empAlloc?.departmentCategoryId) {
          section = (db.productionSections || []).find(sec => 
            sec.id === empAlloc.departmentCategoryId || 
            sec.departmentCategoryId === empAlloc.departmentCategoryId
          );
        }
      }

      const resolvedStart = directSection?.startTime || matchedShift?.startTime || section?.startTime;
      const resolvedEnd = directSection?.endTime || matchedShift?.endTime || section?.endTime;

      if (!resolvedStart || !resolvedEnd) return null;

      return {
        name: section?.name || matchedShift?.name || 'شیفت کاری',
        startTime: toEnglishDigits(resolvedStart).trim(),
        endTime: toEnglishDigits(resolvedEnd).trim()
      };
    };

    const rawRules = periodRules;
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

    let totalWorkedMinutes = 0;
    let totalBreakMinutes = 0;
    let totalNetWorkedMinutes = 0;
    let totalNormalWorkMinutes = 0;
    let presentDaysCount = 0;
    let absentDaysCount = 0;
    let totalDelayMinutes = 0;
    let totalDelayMinutesNormal = 0;
    let totalDelayMinutesFriday = 0;
    let totalDelayMinutesHoliday = 0;
    let totalEarlyOvertimeMinutes = 0;
    let totalLateOvertimeMinutes = 0;
    let totalHolidayWorkMinutes = 0;
    let totalFridayWorkMinutes = 0;

    const daysDetails = calendarDays.map(day => {
      const rec = recordMap.get(normalizeDateStr(day.dateStr));
      const isPresent = !!rec && rec.times.length > 0;
      let workedMin = 0;
      let breakMin = 0;
      
      if (isPresent) {
        workedMin = calculateDailyWorkedMinutes(rec.times, rec.statuses);
        breakMin = rulesObj.deductDailyBreakTime ? (rulesObj.dailyBreakDurationMinutes ?? 40) : 0;
        totalWorkedMinutes += workedMin; // Gross presence duration
        totalBreakMinutes += breakMin;
        presentDaysCount++;
      } else {
        absentDaysCount++;
      }

      const shift = getShiftForDay(emp, day.dateStr);
      const resolvedTimes = rec
        ? resolveEntryExitTimesForShift(rec.times, shift?.startTime, shift?.endTime)
        : null;

      let delayMin = 0;
      let overtimeEarlyMin = 0;
      let overtimeLateMin = 0;

      if (isPresent && shift && resolvedTimes && resolvedTimes.sortedTimes.length >= 2) {
        const { firstEntryMins, lastExitMins, shiftStartMins, shiftEndMins } = resolvedTimes;

        if (firstEntryMins > shiftStartMins) {
          delayMin = firstEntryMins - shiftStartMins;
        }

        if (firstEntryMins < shiftStartMins) {
          overtimeEarlyMin = shiftStartMins - firstEntryMins;
        }
        if (lastExitMins > shiftEndMins) {
          overtimeLateMin = shiftEndMins ? lastExitMins - shiftEndMins : 0;
        }
      }

      const isFriday = normalizeWeekday(day.weekday) === normalizeWeekday('جمعه');
      const isHoliday = periodOfficialHolidays.some(
        h => toEnglishDigits(h.date).replace(/[-\/]/g, '/') === toEnglishDigits(day.dateStr).replace(/[-\/]/g, '/')
      );

      const rawEarly = overtimeEarlyMin;
      const rawLate = overtimeLateMin;
      const unallowedEarly = rulesObj.calculateEarlyOvertime ? 0 : rawEarly;
      const unallowedLate = rulesObj.calculateLateOvertime ? 0 : rawLate;
      const unauthorizedPresenceMin = unallowedEarly + unallowedLate;

      const adjustedWorkedMin = isPresent ? Math.max(0, workedMin - breakMin - unauthorizedPresenceMin) : 0;
      if (isPresent) {
        totalNetWorkedMinutes += adjustedWorkedMin;
      }

      let normalWorkMin = 0;
      let overtimeMandatoryMin = 0;
      let fridayWorkMin = 0;
      let holidayWorkMin = 0;

      if (isPresent) {
        const standardCap = 480 - breakMin;
        if (isHoliday && !isFriday) {
          if (rulesObj.calculateHolidayWork) {
            holidayWorkMin = Math.max(0, adjustedWorkedMin);
            normalWorkMin = 0;
          } else {
            normalWorkMin = Math.min(adjustedWorkedMin, standardCap);
            overtimeMandatoryMin = Math.max(0, adjustedWorkedMin - normalWorkMin);
          }
        } else if (isFriday) {
          fridayWorkMin = rulesObj.calculateFridayWork ? adjustedWorkedMin : 0;
          if (isHoliday && rulesObj.calculateHolidayWork) {
            holidayWorkMin = Math.max(0, adjustedWorkedMin);
            normalWorkMin = 0;
            overtimeMandatoryMin = 0;
          } else {
            normalWorkMin = Math.min(adjustedWorkedMin, standardCap);
            overtimeMandatoryMin = Math.max(0, adjustedWorkedMin - normalWorkMin);
          }
        } else {
          normalWorkMin = Math.min(adjustedWorkedMin, standardCap);
          overtimeMandatoryMin = Math.max(0, adjustedWorkedMin - normalWorkMin);
        }
      }

      let delayMinNormal = 0;
      let delayMinFriday = 0;
      let delayMinHoliday = 0;

      if (delayMin > 0) {
        if (isFriday) {
          delayMinFriday = delayMin;
        } else if (isHoliday) {
          delayMinHoliday = delayMin;
        } else {
          delayMinNormal = delayMin;
        }
      }

      totalDelayMinutes += delayMin;
      totalDelayMinutesNormal += delayMinNormal;
      totalDelayMinutesFriday += delayMinFriday;
      totalDelayMinutesHoliday += delayMinHoliday;

      totalEarlyOvertimeMinutes += rulesObj.calculateEarlyOvertime ? overtimeEarlyMin : 0;
      totalLateOvertimeMinutes += rulesObj.calculateLateOvertime ? overtimeLateMin : 0;
      totalHolidayWorkMinutes += holidayWorkMin;
      totalFridayWorkMinutes += fridayWorkMin;
      totalNormalWorkMinutes += normalWorkMin;

      return {
        ...day,
        isPresent,
        times: rec ? rec.times : [],
        workedMin,
        breakMin,
        unauthorizedPresenceMin,
        adjustedWorkedMin,
        normalWorkMin,
        overtimeMandatoryMin,
        delayMin,
        delayMinNormal,
        delayMinFriday,
        delayMinHoliday,
        overtimeEarlyMin: rulesObj.calculateEarlyOvertime ? overtimeEarlyMin : 0,
        overtimeLateMin: rulesObj.calculateLateOvertime ? overtimeLateMin : 0,
        holidayWorkMin,
        fridayWorkMin,
        isFridayDay: isFriday,
        isHolidayDay: isHoliday,
        record: rec,
        shift: shift
      };
    });

    let normalDaysWorkedCount = 0;
    let holidayDaysWorkedCount = 0;
    let fridayDaysWorkedCount = 0;
    daysDetails.forEach(d => {
      if (!d.isPresent) return;
      if (d.isHolidayDay && !d.isFridayDay) {
        if (rulesObj.calculateHolidayWork) holidayDaysWorkedCount++;
        else normalDaysWorkedCount++;
      } else if (d.isFridayDay) {
        fridayDaysWorkedCount++;
      } else {
        normalDaysWorkedCount++;
      }
    });

    const shiftMismatches = daysDetails.filter(day => {
      if (!day.isPresent || !day.shift || day.times.length < 2) return false;
      const resolved = resolveEntryExitTimesForShift(day.times, day.shift.startTime, day.shift.endTime);
      const entryDiff = getCircularMinutesDiff(resolved.firstEntryMins, resolved.shiftStartMins);
      const exitDiff = getCircularMinutesDiff(resolved.lastExitMins, resolved.shiftEndMins);
      return entryDiff > 60 && exitDiff > 60;
    }).map(day => {
      const resolved = resolveEntryExitTimesForShift(day.times, day.shift!.startTime, day.shift!.endTime);
      const entryDiff = getCircularMinutesDiff(resolved.firstEntryMins, resolved.shiftStartMins);
      const exitDiff = getCircularMinutesDiff(resolved.lastExitMins, resolved.shiftEndMins);
      return {
        ...day,
        entryDiff,
        exitDiff,
        firstEntry: resolved.firstEntry,
        lastExit: resolved.lastExit
      };
    });

    const monthlySetting = periodMonthlyWorkdaySettings.find(
      s => Number(s.year) === Number(selectedYear) && Number(s.month) === Number(selectedMonth)
    );
    const targetSetting = (db.payrollSettings || []).find(s => s.periodId === activePeriodId);
    const targetWorkingDays = targetSetting ? Number(targetSetting.workingDaysCount) : 26;
    const requiredHours = monthlySetting
      ? Number(monthlySetting.requiredWorkHours)
      : (targetSetting ? Number(targetSetting.monthlyRequiredHours || (targetWorkingDays * 8)) : 192);
    const requiredMinutes = requiredHours * 60;

    // جریمه تاخیر ورود و تعویض لباس مطابق جدول کارنامه عملکرد حضور و غیاب
    const delayFineRate = Number(rulesObj.delayFineRate) || 1.0;
    const activeDelayFineNormal = rulesObj.calculateEntryDelayFine ? totalDelayMinutesNormal * delayFineRate : 0;
    const activeDelayFineFriday = rulesObj.calculateEntryDelayFine ? totalDelayMinutesFriday * delayFineRate : 0;
    const activeDelayFineHoliday = rulesObj.calculateEntryDelayFine ? totalDelayMinutesHoliday * delayFineRate : 0;
    const clothesDur = Number(rulesObj.clothesChangingDuration) || 15;
    const activeClothesNormal = rulesObj.deductClothesChangingTime ? normalDaysWorkedCount * clothesDur : 0;
    const activeClothesFriday = rulesObj.deductClothesChangingTime ? fridayDaysWorkedCount * clothesDur : 0;
    const activeClothesHoliday = rulesObj.deductClothesChangingTime ? holidayDaysWorkedCount * clothesDur : 0;

    const curOverrideKey = `${activePeriodId}_${selectedYear}_${selectedMonth}`;
    const normalMgmtHours = Number(db.payrollManualOverrides?.[curOverrideKey]?.normalMgmtDeductions?.[emp.employeeCode] || 0);
    const normalMgmtDeductionMinutes = Math.round(Math.max(0, normalMgmtHours) * 60);

    // 1- ساعت خالص کارکرد = خالص مدت حضور - جریمه تاخیر ورود (عادی + جمعه + تعطیل) - تعویض لباس - کسر مدیریتی ساعت عادی
    const netWorkMinutes = Math.max(
      0,
      totalNetWorkedMinutes -
        (activeDelayFineNormal + activeDelayFineFriday + activeDelayFineHoliday) -
        (activeClothesNormal + activeClothesFriday + activeClothesHoliday) -
        normalMgmtDeductionMinutes
    );
    const netHolidayMinutes = Math.max(0, totalHolidayWorkMinutes - activeDelayFineHoliday - activeClothesHoliday);
    const netFridayMinutes = rulesObj.calculateFridayWork
      ? Math.max(0, totalFridayWorkMinutes - activeDelayFineFriday - activeClothesFriday)
      : 0;

    // مرخصی مانده قبلی از ماه قبل (در صورت ثبت دوره از اسنپ‌شات قفل‌شده، در غیر این صورت محاسبه دقیق ماه قبل)
    const prevM = Number(selectedMonth) === 1 ? 12 : Number(selectedMonth) - 1;
    const prevY = Number(selectedMonth) === 1 ? Number(selectedYear) - 1 : Number(selectedYear);
    let prevLeaveMinutes = 0;
    const prevRegPeriod = (db.payrollPeriods || []).find(
      pp => pp.periodId === activePeriodId && Number(pp.year) === prevY && Number(pp.month) === prevM
    );
    const prevSnap = prevRegPeriod?.attendancePerformanceSnapshot?.find(
      (s: any) => s?.employee?.id === emp.id || (emp.employeeCode && s?.employee?.employeeCode === emp.employeeCode)
    );
    if (didSettleLeaveThroughMonth(emp, prevY, prevM, db.personnelSettlements, activePeriodId)) {
      prevLeaveMinutes = 0;
    } else if (prevSnap) {
      prevLeaveMinutes = Number(prevSnap.finalLeaveMinutes || 0);
    } else {
      const prevSetting = periodMonthlyWorkdaySettings.find(s => Number(s.year) === prevY && Number(s.month) === prevM);
      const prevReqMins = (prevSetting ? Number(prevSetting.requiredWorkHours) : 192) * 60;
      const prevEmpRecs = (db.attendanceRecords || []).filter(rec => {
        if (rec.periodId !== activePeriodId) return false;
        if (!isRecordForEmployeeHelper(rec, emp)) return false;
        const dStr = normalizeDateStr(rec.date);
        const parts = dStr.split('/');
        return parts.length >= 3 && parseInt(parts[0], 10) === prevY && parseInt(parts[1], 10) === prevM;
      });
      if (prevEmpRecs.length > 0) {
        let pPresence = 0;
        let pNormalOnly = 0;
        let pMandatoryOt = 0;
        let pHolidayPresence = 0;
        let pDelayN = 0, pDelayF = 0, pDelayH = 0;
        let pNormDays = 0, pFriDays = 0, pHolDays = 0;
        const prevMap = new Map<string, any>();
        prevEmpRecs.forEach(r => {
          const ds = normalizeDateStr(r.date);
          if (!prevMap.has(ds)) prevMap.set(ds, { ...r, times: [...r.times], statuses: r.statuses ? [...r.statuses] : [] });
        });
        const prevDaysCount = getJalaliDaysInMonth(prevY, prevM);
        for (let pd = 1; pd <= prevDaysCount; pd++) {
          const pDateStr = `${prevY}/${String(prevM).padStart(2, '0')}/${String(pd).padStart(2, '0')}`;
          const pRec = prevMap.get(normalizeDateStr(pDateStr));
          if (!pRec || !pRec.times || pRec.times.length === 0) continue;
          const pWorked = calculateDailyWorkedMinutes(pRec.times, pRec.statuses);
          const pBreak = rulesObj.deductDailyBreakTime ? (rulesObj.dailyBreakDurationMinutes ?? 40) : 0;
          const pShift = getShiftForDay(emp, pDateStr, prevY, prevM);
          const pResolved = resolveEntryExitTimesForShift(pRec.times, pShift?.startTime, pShift?.endTime);
          let pDelay = 0, pEarly = 0, pLate = 0;
          if (pShift && pResolved.sortedTimes.length >= 2) {
            const { firstEntryMins: fe, lastExitMins: le, shiftStartMins: ss, shiftEndMins: se } = pResolved;
            if (fe > ss) pDelay = fe - ss;
            if (fe < ss) pEarly = ss - fe;
            if (le > se) pLate = se ? le - se : 0;
          }
          const pUnauth = (rulesObj.calculateEarlyOvertime ? 0 : pEarly) + (rulesObj.calculateLateOvertime ? 0 : pLate);
          const pAdjusted = Math.max(0, pWorked - pBreak - pUnauth);
          pPresence += pAdjusted;
          const pWeekday = getPersianWeekdayOfDate(pDateStr);
          const pIsFri = normalizeWeekday(pWeekday) === normalizeWeekday('جمعه');
          const pIsHol = periodOfficialHolidays.some(h => toEnglishDigits(h.date).replace(/[-\/]/g, '/') === toEnglishDigits(pDateStr).replace(/[-\/]/g, '/'));
          const pStdCap = 480 - pBreak;
          if (pIsHol && !pIsFri) {
            if (rulesObj.calculateHolidayWork) {
              pHolidayPresence += pAdjusted;
              pHolDays++;
            } else {
              const pNC = Math.min(pAdjusted, pStdCap);
              pNormalOnly += pNC;
              pMandatoryOt += Math.max(0, pAdjusted - pNC);
              pNormDays++;
            }
          } else if (pIsFri) {
            if (pIsHol && rulesObj.calculateHolidayWork) {
              pHolidayPresence += pAdjusted;
            } else {
              const pNC = Math.min(pAdjusted, pStdCap);
              pNormalOnly += pNC;
              pMandatoryOt += Math.max(0, pAdjusted - pNC);
            }
            pFriDays++;
          } else {
            const pNC = Math.min(pAdjusted, pStdCap);
            pNormalOnly += pNC;
            pMandatoryOt += Math.max(0, pAdjusted - pNC);
            pNormDays++;
          }
          if (pDelay > 0) {
            if (pIsFri) pDelayF += pDelay;
            else if (pIsHol) pDelayH += pDelay;
            else pDelayN += pDelay;
          }
        }
        const pActiveDelayN = rulesObj.calculateEntryDelayFine ? pDelayN * delayFineRate : 0;
        const pActiveDelayF = rulesObj.calculateEntryDelayFine ? pDelayF * delayFineRate : 0;
        const pActiveDelayH = rulesObj.calculateEntryDelayFine ? pDelayH * delayFineRate : 0;
        const pActiveDelay = pActiveDelayN + pActiveDelayF + pActiveDelayH;
        const pActiveClothesN = rulesObj.deductClothesChangingTime ? pNormDays * clothesDur : 0;
        const pActiveClothesF = rulesObj.deductClothesChangingTime ? pFriDays * clothesDur : 0;
        const pActiveClothesH = rulesObj.deductClothesChangingTime ? pHolDays * clothesDur : 0;
        const pActiveClothes = pActiveClothesN + pActiveClothesF + pActiveClothesH;
        const prevOverrideKey = `${activePeriodId}_${prevY}_${prevM}`;
        const pMgmtMin = Math.round(Math.max(0, Number(db.payrollManualOverrides?.[prevOverrideKey]?.normalMgmtDeductions?.[emp.employeeCode] || 0)) * 60);
        const pNetWork = Math.max(0, pPresence - pActiveDelay - pActiveClothes - pMgmtMin);
        const prevSkipLeave = isDepartedOrSettlingInMonth(
          emp,
          prevY,
          prevM,
          db.personnelSettlements,
          activePeriodId
        );
        if (prevSkipLeave) {
          const pNonHolDed =
            pActiveDelayN +
            pActiveDelayF +
            pActiveClothesN +
            pActiveClothesF +
            (rulesObj.calculateHolidayWork ? 0 : pActiveDelayH + pActiveClothesH);
          const pNetNormalOnly = Math.max(0, pNormalOnly - pNonHolDed - pMgmtMin);
          const pNetHoliday = Math.max(0, pHolidayPresence - pActiveDelayH - pActiveClothesH);
          const pDepPerf = resolveDepartedMonthAttendancePerf({
            netNormalOnlyMinutes: pNetNormalOnly,
            mandatoryOtMinutes: pMandatoryOt,
            netHolidayMinutes: pNetHoliday,
            requiredMinutes: prevReqMins,
            presenceDaysCount: pNormDays + pFriDays + pHolDays,
            prevLeaveMinutes: 0,
            totalDaysInMonth: prevDaysCount
          });
          prevLeaveMinutes = pDepPerf.finalLeaveMinutes;
        } else {
          const pAllocLeave = pNetWork >= prevReqMins ? 20 * 60 : (prevReqMins > 0 ? Math.round((pNetWork / prevReqMins) * 20 * 60) : 0);
          if (pNetWork >= prevReqMins) {
            prevLeaveMinutes = pAllocLeave;
          } else {
            const pDeficit = prevReqMins - pNetWork;
            prevLeaveMinutes = Math.max(0, pAllocLeave - Math.min(pDeficit, pAllocLeave));
          }
        }
      }
    }

    const skipLeaveInjection = isDepartedOrSettlingInMonth(
      emp,
      Number(selectedYear),
      Number(selectedMonth),
      db.personnelSettlements,
      activePeriodId
    );

    const nonHolidayDelayAndClothes =
      activeDelayFineNormal +
      activeDelayFineFriday +
      activeClothesNormal +
      activeClothesFriday +
      (rulesObj.calculateHolidayWork ? 0 : activeDelayFineHoliday + activeClothesHoliday);
    const netNormalOnlyMinutes = Math.max(0, totalNormalWorkMinutes - nonHolidayDelayAndClothes - normalMgmtDeductionMinutes);
    const totalDailyMandatoryOtMinutes = daysDetails.reduce((s, d) => s + (d.overtimeMandatoryMin || 0), 0);

    const extraRequiredMinutes = Math.max(0, netWorkMinutes - requiredMinutes);

    let allocatedLeaveMinutes = 0;
    let currentWorkedMinutes = netWorkMinutes;
    let finalOtMinutes = 0;
    let finalLeaveMinutes = prevLeaveMinutes;
    let finalHolidayMinutes = 0;
    let finalFridayMinutes = netFridayMinutes;
    let finalDaysWorked = 0;

    if (skipLeaveInjection) {
      const depPerf = resolveDepartedMonthAttendancePerf({
        netNormalOnlyMinutes,
        mandatoryOtMinutes: totalDailyMandatoryOtMinutes,
        netHolidayMinutes,
        requiredMinutes,
        presenceDaysCount: presentDaysCount,
        prevLeaveMinutes,
        totalDaysInMonth: getJalaliDaysInMonth(Number(selectedYear), Number(selectedMonth))
      });
      allocatedLeaveMinutes = depPerf.allocatedLeaveMinutes;
      currentWorkedMinutes = depPerf.finalWorkedMinutes;
      finalOtMinutes = depPerf.finalOtMinutes;
      finalHolidayMinutes = depPerf.finalHolidayMinutes;
      finalLeaveMinutes = depPerf.finalLeaveMinutes;
      finalDaysWorked = depPerf.attendanceDaysWorked;
    } else {
      if (netWorkMinutes >= requiredMinutes) {
        allocatedLeaveMinutes = 20 * 60;
      } else if (requiredMinutes > 0) {
        allocatedLeaveMinutes = Math.round((netWorkMinutes / requiredMinutes) * 20 * 60);
      }

      const totalLeaveMinutes = prevLeaveMinutes + allocatedLeaveMinutes;
      finalLeaveMinutes = totalLeaveMinutes;

      if (netWorkMinutes >= requiredMinutes) {
        // ۱. حالت اول: کارکرد بیشتر یا مساوی موظفی ماه
        currentWorkedMinutes = requiredMinutes;
        finalHolidayMinutes = Math.min(netHolidayMinutes, extraRequiredMinutes);
        finalOtMinutes = Math.max(0, extraRequiredMinutes - finalHolidayMinutes);
      } else {
        // ۲. حالت دوم: کارکرد کمتر از موظفی ماه (تامین کسری صرفاً از مرخصی دوره)
        if (currentWorkedMinutes < requiredMinutes && finalLeaveMinutes > 0) {
          const deficit = requiredMinutes - currentWorkedMinutes;
          const leaveUsed = Math.min(deficit, finalLeaveMinutes);
          currentWorkedMinutes += leaveUsed;
          finalLeaveMinutes -= leaveUsed;
        }
        finalOtMinutes = 0;
        finalHolidayMinutes = 0;
      }

      // در نهایت ساعت کارکرد نهایی تقسیم بر 8 و رندینگ اعشاری
      const rawDays = (currentWorkedMinutes / 60) / 8;
      const intDays = Math.floor(rawDays);
      const decDays = Number((rawDays - intDays).toFixed(4));
      finalDaysWorked = decDays < 0.5 ? intDays : intDays + 1;
    }

    let finalWorkedMinutes = currentWorkedMinutes;
    let remainingLeaveMinutes = finalLeaveMinutes; // مانده مرخصی

    let resolvedRequiredHours = requiredHours;
    let resolvedRequiredMinutes = requiredMinutes;
    let resolvedNetWorkMinutes = netWorkMinutes;

    // در صورت قفل بودن سند ماه، نتایج نهایی دقیقاً از اسنپ‌شات ثبت‌شده دوره خوانده می‌شوند تا هیچ‌گونه تغییری رخ ندهد
    if (isMonthLocked) {
      const lockedRegPeriod = (db.payrollPeriods || []).find(
        pp => pp.periodId === activePeriodId && Number(pp.year) === Number(selectedYear) && Number(pp.month) === Number(selectedMonth)
      );
      const lockedSnap = lockedRegPeriod?.attendancePerformanceSnapshot?.find(
        (s: any) => s?.employee?.id === emp.id || (emp.employeeCode && s?.employee?.employeeCode === emp.employeeCode)
      );
      if (lockedSnap) {
        resolvedRequiredMinutes = Number(lockedSnap.requiredMinutes ?? requiredMinutes);
        resolvedRequiredHours = Math.round(resolvedRequiredMinutes / 60);
        resolvedNetWorkMinutes = Number(lockedSnap.netWorkMinutes ?? netWorkMinutes);
        finalWorkedMinutes = Number(lockedSnap.finalWorkedMinutes ?? finalWorkedMinutes);
        finalOtMinutes = Number(lockedSnap.finalOtMinutes ?? finalOtMinutes);
        finalFridayMinutes = Number(lockedSnap.finalFridayMinutes ?? finalFridayMinutes);
        finalHolidayMinutes = Number(lockedSnap.finalHolidayMinutes ?? finalHolidayMinutes);
        allocatedLeaveMinutes = Number(lockedSnap.allocatedLeaveMinutes ?? allocatedLeaveMinutes);
        remainingLeaveMinutes = Number(lockedSnap.finalLeaveMinutes ?? remainingLeaveMinutes);
        finalDaysWorked = Number(lockedSnap.attendanceDaysWorked ?? lockedSnap.daysWorkedCount ?? finalDaysWorked);
      }
    }

    let totalUnauthorizedPresenceMinutes = 0;
    let totalMandatoryOvertimeMinutes = 0;
    daysDetails.forEach(d => {
      totalUnauthorizedPresenceMinutes += d.unauthorizedPresenceMin || 0;
      totalMandatoryOvertimeMinutes += d.overtimeMandatoryMin || 0;
    });

    return {
      employee: emp,
      totalWorkedMinutes,
      totalBreakMinutes,
      totalUnauthorizedPresenceMinutes,
      totalNetWorkedMinutes,
      totalNormalWorkMinutes,
      totalMandatoryOvertimeMinutes,
      netWorkMinutes: resolvedNetWorkMinutes,
      requiredHours: resolvedRequiredHours,
      requiredMinutes: resolvedRequiredMinutes,
      finalWorkedMinutes,
      finalOtMinutes,
      finalFridayMinutes,
      finalHolidayMinutes,
      allocatedLeaveMinutes,
      remainingLeaveMinutes,
      finalDaysWorked,
      presentDaysCount,
      absentDaysCount,
      totalDelayMinutes,
      totalDelayMinutesNormal,
      totalDelayMinutesFriday,
      totalDelayMinutesHoliday,
      totalEarlyOvertimeMinutes,
      totalLateOvertimeMinutes,
      totalHolidayWorkMinutes,
      totalFridayWorkMinutes,
      daysDetails,
      shiftMismatches,
      isDepartedNoLeavePad: skipLeaveInjection
    };
  }, [activeTab, inspectEmployeeId, records, calendarDays, db.personnel, db.productionSections, db.officialHolidays, db.shiftAssignments, db.payrollSettings, db.monthlyWorkdaySettings, db.payrollCalculationRules, db.payrollManualOverrides, db.payrollPeriods, db.attendanceRecords, db.personnelAllocations, db.personnelSettlements, activePeriodId, selectedYear, selectedMonth, isMonthLocked, fallbackShiftYearMonth]);

  const approvedMismatchesSet = useMemo(() => new Set(approvedMismatches), [approvedMismatches]);

  const { allMismatches, allAnomalies, approvedMismatchItems } = useMemo(() => {
    if (activeTab !== 'mismatches') {
      return { allMismatches: [] as any[], allAnomalies: [] as any[], approvedMismatchItems: [] as any[] };
    }
    const activePersonnel = activePeriodPersonnel;
    const mismatchesList: any[] = [];
    const anomaliesList: any[] = [];

    const rawRules = periodRules;
    const calcEarlyOt = rawRules.calculateEarlyOvertime ?? true;
    const calcLateOt = rawRules.calculateLateOvertime ?? true;

    const shiftsArr = periodShifts;
    const shiftById = new Map<string, any>();
    shiftsArr.forEach(sh => shiftById.set(sh.id, sh));

    const prodSectionsArr = periodProductionSections;
    const sectionById = new Map<string, any>();
    const sectionByDeptCat = new Map<string, any>();
    prodSectionsArr.forEach(sec => {
      sectionById.set(sec.id, sec);
      if (sec.departmentCategoryId && !sectionByDeptCat.has(sec.departmentCategoryId)) {
        sectionByDeptCat.set(sec.departmentCategoryId, sec);
      }
    });

    const resolveShiftCandidate = (assignment: any) => {
      if (!assignment || assignment.deptId === 'none' || assignment.shiftId === 'none') return null;
      if (assignment.isOnLeave && !assignment.substitutedEmployeeCode) return null;

      const matchedShift = shiftById.get(assignment.shiftId) || shiftById.get(assignment.deptId);
      const directSection = sectionById.get(assignment.deptId) || sectionById.get(assignment.shiftId);
      const section = directSection || sectionByDeptCat.get(assignment.deptId);

      const resolvedStart = directSection?.startTime || matchedShift?.startTime || section?.startTime;
      const resolvedEnd = directSection?.endTime || matchedShift?.endTime || section?.endTime;
      if (!resolvedStart || !resolvedEnd) return null;

      return {
        shift: {
          startTime: toEnglishDigits(resolvedStart).trim(),
          endTime: toEnglishDigits(resolvedEnd).trim(),
          name: section?.name || matchedShift?.name || 'شیفت کاری'
        },
        sectionId: section ? section.id : (matchedShift ? matchedShift.id : (assignment?.shiftId || assignment?.deptId || 'none'))
      };
    };

    const dateAssignmentsByDate = new Map<string, ShiftAssignment[]>();
    const weeklyPeriodAssignmentsByDay = new Map<string, ShiftAssignment[]>();

    (db.shiftAssignments || []).forEach(a => {
      if (a.date) {
        if (a.periodId === activePeriodId) {
          const dKey = normalizeDateStr(a.date);
          let arr = dateAssignmentsByDate.get(dKey);
          if (!arr) { arr = []; dateAssignmentsByDate.set(dKey, arr); }
          arr.push(a);
        }
      } else if (a.dayName && isShiftAssignmentInMonth(a, activePeriodId, Number(selectedYear), Number(selectedMonth), fallbackShiftYearMonth)) {
        const wKey = normalizeWeekday(a.dayName);
        let arr = weeklyPeriodAssignmentsByDay.get(wKey);
        if (!arr) { arr = []; weeklyPeriodAssignmentsByDay.set(wKey, arr); }
        arr.push(a);
      }
    });

    const cleanRecCode = (c: any) => {
      const s = toEnglishDigits(String(c || '')).trim().toLowerCase();
      const noZeros = s.replace(/^0+/, '');
      return noZeros === '' && s !== '' ? '0' : noZeros;
    };
    const recordsByCode = new Map<string, AttendanceRecord[]>();
    const recordsByEmpIdNoCode = new Map<string, AttendanceRecord[]>();
    records.forEach(r => {
      const rc = cleanRecCode(r.attendanceCode);
      if (rc) {
        let arr = recordsByCode.get(rc);
        if (!arr) { arr = []; recordsByCode.set(rc, arr); }
        arr.push(r);
      } else if (r.employeeId) {
        let arr = recordsByEmpIdNoCode.get(r.employeeId);
        if (!arr) { arr = []; recordsByEmpIdNoCode.set(r.employeeId, arr); }
        arr.push(r);
      }
    });

    const empById = new Map<string, Personnel>();
    const empRecordMapById = new Map<string, Map<string, AttendanceRecord>>();

    const getShiftCandidatesForEmpDay = (emp: Personnel, normDayDate: string, weekdayName: string) => {
      const wKey = normalizeWeekday(weekdayName);
      const dateBucket = dateAssignmentsByDate.get(normDayDate) || [];
      const dateMatches = dateBucket.filter(a => isShiftAssignmentForEmployee(a, emp));

      let candidateAssignments: any[] = [];
      let isExplicitOffOrLeave = false;
      if (dateMatches.length > 0) {
        const explicitNone = dateMatches.some(a => a.deptId === 'none' || a.shiftId === 'none' || (a.isOnLeave && !a.substitutedEmployeeCode));
        const activeDateMatches = dateMatches.filter(a => a.deptId !== 'none' && a.shiftId !== 'none' && !(a.isOnLeave && !a.substitutedEmployeeCode));
        if (explicitNone && activeDateMatches.length === 0) {
          isExplicitOffOrLeave = true;
          candidateAssignments = [];
        } else {
          candidateAssignments = activeDateMatches;
        }
      } else if (emp.shiftScheduleType === 'fixed') {
        if (!emp.fixedShiftId || emp.fixedShiftId === 'none') {
          isExplicitOffOrLeave = true;
          candidateAssignments = [];
        } else {
          candidateAssignments = [{
            id: `fixed-${emp.id}`,
            shiftId: emp.fixedShiftId,
            deptId: emp.fixedShiftId,
            dayName: weekdayName,
            employeeCode: emp.employeeCode
          }];
        }
      } else {
        const periodWeekly = (weeklyPeriodAssignmentsByDay.get(wKey) || []).filter(a => isShiftAssignmentForEmployee(a, emp));
        candidateAssignments = periodWeekly.filter(a => a.deptId !== 'none' && a.shiftId !== 'none' && !(a.isOnLeave && !a.substitutedEmployeeCode));
      }

      const resolvedCandidates = candidateAssignments
        .map(resolveShiftCandidate)
        .filter((x): x is NonNullable<typeof x> => x !== null);

      return { resolvedCandidates, isExplicitOffOrLeave };
    };

    const evaluateCandidates = (recTimes: string[], resolvedCandidates: NonNullable<ReturnType<typeof resolveShiftCandidate>>[]) => {
      const evaluations = resolvedCandidates.map(cand => {
        const resolvedTimes = resolveEntryExitTimesForShift(recTimes, cand.shift.startTime, cand.shift.endTime);
        const entryDiff = getCircularMinutesDiff(resolvedTimes.firstEntryMins, resolvedTimes.shiftStartMins);
        const exitDiff = getCircularMinutesDiff(resolvedTimes.lastExitMins, resolvedTimes.shiftEndMins);

        let delayMin = 0;
        let overtimeEarlyMin = 0;
        let overtimeLateMin = 0;
        if (resolvedTimes.sortedTimes.length >= 2) {
          const { firstEntryMins, lastExitMins, shiftStartMins, shiftEndMins } = resolvedTimes;
          if (firstEntryMins > shiftStartMins) delayMin = firstEntryMins - shiftStartMins;
          if (firstEntryMins < shiftStartMins) overtimeEarlyMin = shiftStartMins - firstEntryMins;
          if (lastExitMins > shiftEndMins) overtimeLateMin = shiftEndMins ? lastExitMins - shiftEndMins : 0;
        }
        const unauthorizedPresenceMin = (calcEarlyOt ? 0 : overtimeEarlyMin) + (calcLateOt ? 0 : overtimeLateMin);

        return {
          cand,
          resolvedTimes,
          entryDiff,
          exitDiff,
          delayMin,
          unauthorizedPresenceMin,
          isMismatch: entryDiff > 60 && exitDiff > 60
        };
      });
      evaluations.sort((a, b) => (a.entryDiff + a.exitDiff) - (b.entryDiff + b.exitDiff));
      return evaluations;
    };

    activePersonnel.forEach(emp => {
      empById.set(emp.id, emp);
      const empAttTokens = splitAttCodes(getEmpAttCode(emp)).map(t => cleanRecCode(t)).filter(Boolean);
      const matchedByAttCode: AttendanceRecord[] = [];
      const seenRecIds = new Set<string>();
      empAttTokens.forEach(tok => {
        const list = recordsByCode.get(tok) || [];
        list.forEach(r => {
          if (!seenRecIds.has(r.id)) {
            seenRecIds.add(r.id);
            matchedByAttCode.push(r);
          }
        });
      });
      const noCodeRecs = emp.id ? (recordsByEmpIdNoCode.get(emp.id) || []) : [];
      noCodeRecs.forEach(r => {
        if (!seenRecIds.has(r.id)) {
          seenRecIds.add(r.id);
          matchedByAttCode.push(r);
        }
      });
      const empRecords = matchedByAttCode;
      if (empRecords.length === 0) return;

      const recordMap = new Map<string, AttendanceRecord>();
      empRecords.forEach(r => {
        const dKey = normalizeDateStr(r.date);
        const existing = recordMap.get(dKey);
        if (!existing) {
          recordMap.set(dKey, { ...r, times: [...r.times], statuses: r.statuses ? [...r.statuses] : [] });
        } else {
          const mergedTimes = [...existing.times];
          const mergedStatuses = [...(existing.statuses || [])];
          r.times.forEach((t, idx) => {
            if (!mergedTimes.includes(t)) {
              mergedTimes.push(t);
              if (r.statuses && r.statuses[idx] !== undefined) {
                mergedStatuses.push(r.statuses[idx]);
              }
            }
          });
          recordMap.set(dKey, { ...existing, times: mergedTimes, statuses: mergedStatuses });
        }
      });
      empRecordMapById.set(emp.id, recordMap);

      calendarDays.forEach(day => {
        const normDayDate = normalizeDateStr(day.dateStr);
        const rec = recordMap.get(normDayDate);
        if (!rec || rec.times.length === 0) return;

        const weekdayName = day.weekday || getPersianWeekdayOfDate(day.dateStr);
        const { resolvedCandidates } = getShiftCandidatesForEmpDay(emp, normDayDate, weekdayName);

        // 1. Attendance recorded WITHOUT any assigned shift
        if (resolvedCandidates.length === 0) {
          const resolvedNoShift = resolveEntryExitTimesForShift(rec.times);
          const sortedRaw = resolvedNoShift.sortedTimes;
          anomaliesList.push({
            employee: emp,
            dayNum: day.dayNum,
            dateStr: day.dateStr,
            weekday: weekdayName,
            firstEntry: sortedRaw[0] || rec.times[0] || '',
            lastExit: sortedRaw.length >= 2 ? sortedRaw[sortedRaw.length - 1] : '',
            shift: null,
            entryDiff: null,
            exitDiff: null,
            delayMin: 0,
            unauthorizedPresenceMin: 0,
            currentSectionId: 'none',
            isNoShift: true,
            hasExcessiveDelay: false,
            hasExcessiveUnauthorized: false,
            isAlsoMismatch: false
          });
          return;
        }

        if (rec.times.length < 2) return;

        const evaluations = evaluateCandidates(rec.times, resolvedCandidates);
        const hasValidMatch = evaluations.some(ev => !ev.isMismatch);
        const bestEval = evaluations[0];

        if (!hasValidMatch) {
          mismatchesList.push({
            employee: emp,
            dayNum: day.dayNum,
            dateStr: day.dateStr,
            weekday: day.weekday,
            firstEntry: bestEval.resolvedTimes.firstEntry,
            lastExit: bestEval.resolvedTimes.lastExit,
            shift: bestEval.cand.shift,
            entryDiff: bestEval.entryDiff,
            exitDiff: bestEval.exitDiff,
            delayMin: bestEval.delayMin,
            unauthorizedPresenceMin: bestEval.unauthorizedPresenceMin,
            currentSectionId: bestEval.cand.sectionId
          });
        }

        // 2. Daily delay > 2 hours (120 mins) OR unauthorized hours > 2 hours (120 mins)
        if (bestEval.delayMin > 120 || bestEval.unauthorizedPresenceMin > 120) {
          anomaliesList.push({
            employee: emp,
            dayNum: day.dayNum,
            dateStr: day.dateStr,
            weekday: weekdayName,
            firstEntry: bestEval.resolvedTimes.firstEntry,
            lastExit: bestEval.resolvedTimes.lastExit,
            shift: bestEval.cand.shift,
            entryDiff: bestEval.entryDiff,
            exitDiff: bestEval.exitDiff,
            delayMin: bestEval.delayMin,
            unauthorizedPresenceMin: bestEval.unauthorizedPresenceMin,
            currentSectionId: bestEval.cand.sectionId,
            isNoShift: false,
            hasExcessiveDelay: bestEval.delayMin > 120,
            hasExcessiveUnauthorized: bestEval.unauthorizedPresenceMin > 120,
            isAlsoMismatch: !hasValidMatch
          });
        }
      });
    });

    // 3. Build ALL approved mismatch / anomaly items for the active selected year/month
    // Deduplicate strictly by (emp.id, normDate) so each personnel+day appears ONLY once
    const ymPrefix = `${selectedYear}/${String(selectedMonth).padStart(2, '0')}/`;
    const approvedByDayMap = new Map<string, any>();
    const mismatchByKey = new Map<string, any>();
    mismatchesList.forEach(m => mismatchByKey.set(`${m.employee.id}-${m.dateStr}`, m));
    const anomalyByKey = new Map<string, any>();
    anomaliesList.forEach(a => anomalyByKey.set(`${a.employee.id}-${a.dateStr}`, a));

    approvedMismatches.forEach(rawKey => {
      const clean = toEnglishDigits(String(rawKey || '')).trim();
      const match = clean.match(/^(anomaly-)?(.+)-(\d{4}\/\d{1,2}\/\d{1,2})$/);
      if (!match) return;
      const approvalKind = match[1] ? 'anomaly' as const : 'mismatch' as const;
      const empId = match[2];
      const normDate = normalizeDateStr(match[3]);
      if (!normDate.startsWith(ymPrefix)) return;

      const emp = empById.get(empId) || allPeriodPersonnel.find(p => p.id === empId);
      if (!emp) return;

      const dayKey = `${emp.id}-${normDate}`;
      const existingApproved = approvedByDayMap.get(dayKey);
      const activeM = mismatchByKey.get(dayKey);
      const activeA = anomalyByKey.get(dayKey);

      if (existingApproved) {
        if (!existingApproved.approvalKeys.includes(rawKey)) {
          existingApproved.approvalKeys.push(rawKey);
        }
        if (approvalKind === 'mismatch' && activeM) {
          Object.assign(existingApproved, {
            ...activeM,
            approvalKey: existingApproved.approvalKey,
            approvalKind: existingApproved.approvalKind,
            approvalKeys: existingApproved.approvalKeys
          });
        } else if (approvalKind === 'anomaly' && activeA) {
          existingApproved.hasExcessiveDelay = existingApproved.hasExcessiveDelay || activeA.hasExcessiveDelay;
          existingApproved.hasExcessiveUnauthorized = existingApproved.hasExcessiveUnauthorized || activeA.hasExcessiveUnauthorized;
          existingApproved.isNoShift = existingApproved.isNoShift || activeA.isNoShift;
        }
        return;
      }

      const dateParts = normDate.split('/');
      const dayNum = parseInt(dateParts[2] || '0', 10) || 0;
      const weekdayName = getPersianWeekdayOfDate(normDate);

      if (approvalKind === 'mismatch' && activeM) {
        approvedByDayMap.set(dayKey, {
          ...activeM,
          approvalKey: rawKey,
          approvalKind: 'mismatch',
          approvalKeys: [rawKey]
        });
        return;
      }
      if (approvalKind === 'anomaly' && activeA) {
        approvedByDayMap.set(dayKey, {
          ...activeA,
          approvalKey: rawKey,
          approvalKind: 'anomaly',
          approvalKeys: [rawKey]
        });
        return;
      }

      // Reconstruct live current state (e.g. shift was updated when approved)
      const recMap = empRecordMapById.get(emp.id);
      const rec = recMap ? recMap.get(normDate) : undefined;
      const { resolvedCandidates } = getShiftCandidatesForEmpDay(emp, normDate, weekdayName);
      const recTimes = rec ? rec.times : [];

      let firstEntry = '';
      let lastExit = '';
      let shiftObj: any = null;
      let currentSectionId = 'none';
      let entryDiff: number | null = null;
      let exitDiff: number | null = null;
      let delayMin = 0;
      let unauthorizedPresenceMin = 0;

      if (resolvedCandidates.length > 0 && recTimes.length >= 2) {
        const evals = evaluateCandidates(recTimes, resolvedCandidates);
        const best = evals[0];
        firstEntry = best.resolvedTimes.firstEntry;
        lastExit = best.resolvedTimes.lastExit;
        shiftObj = best.cand.shift;
        currentSectionId = best.cand.sectionId;
        entryDiff = best.entryDiff;
        exitDiff = best.exitDiff;
        delayMin = best.delayMin;
        unauthorizedPresenceMin = best.unauthorizedPresenceMin;
      } else if (resolvedCandidates.length > 0) {
        const cand = resolvedCandidates[0];
        shiftObj = cand.shift;
        currentSectionId = cand.sectionId;
        const resolved = resolveEntryExitTimesForShift(recTimes, cand.shift.startTime, cand.shift.endTime);
        firstEntry = resolved.sortedTimes[0] || '';
        lastExit = resolved.sortedTimes.length >= 2 ? resolved.sortedTimes[resolved.sortedTimes.length - 1] : '';
      } else {
        const resolved = resolveEntryExitTimesForShift(recTimes);
        firstEntry = resolved.sortedTimes[0] || '';
        lastExit = resolved.sortedTimes.length >= 2 ? resolved.sortedTimes[resolved.sortedTimes.length - 1] : '';
      }

      approvedByDayMap.set(dayKey, {
        employee: emp,
        dayNum,
        dateStr: normDate,
        weekday: weekdayName,
        firstEntry,
        lastExit,
        shift: shiftObj,
        entryDiff,
        exitDiff,
        delayMin,
        unauthorizedPresenceMin,
        currentSectionId,
        approvalKey: rawKey,
        approvalKind,
        approvalKeys: [rawKey],
        isNoShift: resolvedCandidates.length === 0,
        hasExcessiveDelay: delayMin > 120,
        hasExcessiveUnauthorized: unauthorizedPresenceMin > 120
      });
    });

    const approvedList = Array.from(approvedByDayMap.values());
    approvedList.sort((a, b) => a.dayNum - b.dayNum || (a.employee.fullName || '').localeCompare(b.employee.fullName || '', 'fa'));

    return {
      allMismatches: mismatchesList,
      allAnomalies: anomaliesList,
      approvedMismatchItems: approvedList
    };
  }, [activeTab, activePeriodPersonnel, allPeriodPersonnel, db.shiftAssignments, db.productionSections, db.payrollCalculationRules, records, calendarDays, activePeriodId, approvedMismatches, selectedYear, selectedMonth, fallbackShiftYearMonth]);

  const activeMismatchesUnfiltered = useMemo(() => {
    return allMismatches.filter(m => !approvedMismatchesSet.has(`${m.employee.id}-${m.dateStr}`));
  }, [allMismatches, approvedMismatchesSet]);

  const filteredMismatches = useMemo(() => {
    if (mismatchEmployeeFilter === 'all') return activeMismatchesUnfiltered;
    return activeMismatchesUnfiltered.filter(m => m.employee.id === mismatchEmployeeFilter);
  }, [activeMismatchesUnfiltered, mismatchEmployeeFilter]);

  const activeAnomaliesUnfiltered = useMemo(() => {
    return allAnomalies.filter(a => !approvedMismatchesSet.has(`anomaly-${a.employee.id}-${a.dateStr}`));
  }, [allAnomalies, approvedMismatchesSet]);

  const filteredAnomalies = useMemo(() => {
    let list = activeAnomaliesUnfiltered;
    if (mismatchEmployeeFilter !== 'all') {
      list = list.filter(a => a.employee.id === mismatchEmployeeFilter);
    }
    if (anomalyTypeFilter === 'no_shift') {
      list = list.filter(a => a.isNoShift);
    } else if (anomalyTypeFilter === 'delay_2h') {
      list = list.filter(a => a.hasExcessiveDelay);
    } else if (anomalyTypeFilter === 'unauthorized_2h') {
      list = list.filter(a => a.hasExcessiveUnauthorized);
    }
    return list;
  }, [activeAnomaliesUnfiltered, mismatchEmployeeFilter, anomalyTypeFilter]);

  const filteredApprovedItems = useMemo(() => {
    if (mismatchEmployeeFilter === 'all') return approvedMismatchItems;
    return approvedMismatchItems.filter(a => a.employee.id === mismatchEmployeeFilter);
  }, [approvedMismatchItems, mismatchEmployeeFilter]);

  const handleSetFilterType = (type: 'all' | 'errors' | 'valid' | 'unknown') => {
    setFilterType(type);
    setErrorSubFilter('all');
  };

  // Years array for selector
  const yearsList = [1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409, 1410];
  const monthsList = [
    { value: 1, label: 'فروردین' },
    { value: 2, label: 'اردیبهشت' },
    { value: 3, label: 'خرداد' },
    { value: 4, label: 'تیر' },
    { value: 5, label: 'مرداد' },
    { value: 6, label: 'شهریور' },
    { value: 7, label: 'مهر' },
    { value: 8, label: 'آبان' },
    { value: 9, label: 'آذر' },
    { value: 10, label: 'دی' },
    { value: 11, label: 'بهمن' },
    { value: 12, label: 'اسفند' },
  ];

  // Helper: map personnel strictly by attendanceCode and ID (never employeeCode)
  const personnelMap = useMemo(() => {
    const map = new Map<string, Personnel>();
    // Sort so dummy placeholders are set first and genuine active personnel overwrite them
    const list = [...allPeriodPersonnel]
      .sort((a, b) => {
        const aDum = isDummyUnknownPersonnel(a) ? 0 : 1;
        const bDum = isDummyUnknownPersonnel(b) ? 0 : 1;
        return aDum - bDum;
      });

    list.forEach(p => {
      const attTokens = splitAttCodes(getEmpAttCode(p));
      const cleanId = String(p.id || '').trim();
      if (cleanId) {
        map.set(cleanId, p);
      }
      // Strictly map ONLY under attendanceCode (کد پرسنل حضور و غیاب) — NEVER employeeCode!
      if (attTokens.length > 0) {
        attTokens.forEach(tok => {
          map.set(tok, p);
          const noZeros = stripLeadingZeros(tok);
          if (noZeros) map.set(noZeros, p);
        });
      }
    });
    return map;
  }, [allPeriodPersonnel]);

  // Indexed O(1) personnel lookup strictly by attendanceCode ONLY (never employeeCode)
  const personnelLookup = useMemo(() => {
    const byIdInPeriod = new Map<string, Personnel>();
    const byIdAny = new Map<string, Personnel>();
    const genuineByAtt = new Map<string, Personnel>();
    const anyByAtt = new Map<string, Personnel>();

    const setKeys = (map: Map<string, Personnel>, rawCode: any, p: Personnel) => {
      const c = normalizeAttCode(rawCode);
      if (!c) return;
      if (!map.has(c)) map.set(c, p);
      const noZeros = stripLeadingZeros(c);
      if (noZeros && !map.has(noZeros)) map.set(noZeros, p);
      if (/^\d+$/.test(c)) {
        const numKey = `num:${Number(c)}`;
        if (!map.has(numKey)) map.set(numKey, p);
      }
    };

    const allPersonnel = db.personnel || [];
    for (let i = 0; i < allPersonnel.length; i++) {
      const p = allPersonnel[i];
      if (p.id && !byIdAny.has(p.id)) byIdAny.set(p.id, p);
    }

    // Iterate allPeriodPersonnel (already sorted with exact activePeriodId first)
    for (let i = 0; i < allPeriodPersonnel.length; i++) {
      const p = allPeriodPersonnel[i];
      if (p.id && !byIdInPeriod.has(p.id)) byIdInPeriod.set(p.id, p);

      const dummy = isDummyUnknownPersonnel(p);
      const attTokens = splitAttCodes(getEmpAttCode(p));
      if (attTokens.length > 0) {
        attTokens.forEach(tok => {
          if (!dummy) setKeys(genuineByAtt, tok, p);
          setKeys(anyByAtt, tok, p);
        });
      }
    }

    return { byIdInPeriod, byIdAny, genuineByAtt, anyByAtt };
  }, [db.personnel, allPeriodPersonnel]);

  // Robust O(1) personnel finder strictly matching attendanceCode ONLY (never employeeCode)
  const findPersonnel = React.useCallback((code: string): Personnel | undefined => {
    const clean = normalizeAttCode(code);
    if (!clean) return undefined;
    const withoutZeros = stripLeadingZeros(clean);
    const numKey = /^\d+$/.test(clean) ? `num:${Number(clean)}` : '';

    const lookupInMap = (map: Map<string, Personnel>, allowNumeric: boolean): Personnel | undefined => {
      return map.get(clean) || (withoutZeros ? map.get(withoutZeros) : undefined) || (allowNumeric && numKey ? map.get(numKey) : undefined);
    };

    return (
      lookupInMap(personnelLookup.genuineByAtt, true) ||
      lookupInMap(personnelLookup.anyByAtt, true)
    );
  }, [personnelLookup]);

  // Load existing records from db if they exist for this month/year and sort by date
  useEffect(() => {
    if (db.attendanceRecords) {
      const filtered = db.attendanceRecords.filter(r => {
        if (r.periodId !== activePeriodId) return false;
        const rYear = Number(r.year);
        const rMonth = Number(r.month);
        if (!isNaN(rYear) && !isNaN(rMonth) && rYear > 0 && rMonth > 0) {
          return rYear === Number(selectedYear) && rMonth === Number(selectedMonth);
        }
        if (r.date) {
          const parts = toEnglishDigits(r.date).split(/[\/\-]/);
          if (parts.length >= 2) {
            const py = parseInt(parts[0], 10);
            const pm = parseInt(parts[1], 10);
            return py === Number(selectedYear) && pm === Number(selectedMonth);
          }
        }
        return false;
      });

      if (filtered.length > 0) {
        const sorted = [...filtered].sort((a, b) => a.date.localeCompare(b.date) || a.attendanceCode.localeCompare(b.attendanceCode));
        // Auto-synchronize record employeeId strictly with personnel matching attendanceCode ONLY
        const synchronized = sorted.map(r => {
          if (r.attendanceCode) {
            const genuine = findPersonnel(r.attendanceCode);
            if (genuine) {
              if (r.employeeId !== genuine.id) {
                return { ...r, employeeId: genuine.id };
              }
            } else if (r.employeeId) {
              // Clear stale employeeId if the linked employee does not have this exact attendanceCode
              const currentEmp = personnelLookup.byIdAny.get(r.employeeId);
              const curAtt = getEmpAttCode(currentEmp);
              const curTokens = curAtt ? splitAttCodes(curAtt).map(stripLeadingZeros) : [];
              const cleanRec = stripLeadingZeros(normalizeAttCode(r.attendanceCode));
              if (!currentEmp || curTokens.length === 0 || !curTokens.includes(cleanRec)) {
                return { ...r, employeeId: undefined };
              }
            }
          }
          return r;
        });
        setRecords(synchronized);
      } else {
        setRecords([]);
      }
    } else {
      setRecords([]);
    }
  }, [db.attendanceRecords, activePeriodId, selectedYear, selectedMonth, findPersonnel, personnelLookup]);

  // Parse Date cell
  const parseDateCell = (val: any): string => {
    if (!val) return '';
    const str = String(val).trim();
    // If full Jalali date like 1402/05/12
    if (str.includes('/') || str.includes('-')) {
      return toEnglishDigits(str).replace(/-/g, '/');
    }
    // If just a day number
    const num = parseInt(toEnglishDigits(str), 10);
    if (!isNaN(num) && num >= 1 && num <= 31) {
      return `${selectedYear}/${String(selectedMonth).padStart(2, '0')}/${String(num).padStart(2, '0')}`;
    }
    return str;
  };

  // Format raw time to HH:MM (handles HH:MM:SS, HH:MM, PM/AM, Excel fractional days, etc.)
  const formatToHHMM = (rawTimeStr: any): string => {
    if (rawTimeStr === null || rawTimeStr === undefined) return '00:00';
    
    let clean = toEnglishDigits(String(rawTimeStr)).trim();
    if (!clean) return '00:00';

    // 1. Handle Excel serial time fraction (e.g. 0.354166666666667)
    // It must be a decimal between 0 and 1
    const numericVal = parseFloat(clean);
    if (!isNaN(numericVal) && numericVal > 0 && numericVal < 1 && clean.includes('.') && clean.startsWith('0.')) {
      const totalSeconds = Math.round(numericVal * 24 * 3600);
      const hours = Math.floor(totalSeconds / 3600) % 24;
      const minutes = Math.floor((totalSeconds % 3600) / 60) % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    // 2. Handle float hours like 8.30 or 17.15 (dot instead of colon)
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const beforeDot = parseInt(parts[0], 10);
      if (!isNaN(beforeDot) && beforeDot >= 0 && beforeDot < 24) {
        // e.g. 8.3 -> 08:30
        const afterDotStr = parts[1].padEnd(2, '0').substring(0, 2);
        const minutes = parseInt(afterDotStr, 10);
        if (!isNaN(minutes) && minutes < 60) {
          clean = parts[0] + ':' + afterDotStr;
        }
      }
    }

    // 3. Handle PM/AM indicators
    let isPM = false;
    let hasAmPm = false;
    const upperClean = clean.toUpperCase();
    if (upperClean.includes('PM')) {
      isPM = true;
      hasAmPm = true;
    } else if (upperClean.includes('AM')) {
      hasAmPm = true;
    }
    clean = clean.replace(/(AM|PM)/gi, '').trim();

    // 4. Handle ISO dates / strings with spaces (e.g. "Sun Dec 31 1899 08:30:00" or "2023-10-12T08:30:00")
    if (clean.includes('T')) {
      const tPart = clean.split('T')[1];
      if (tPart) clean = tPart;
    } else if (clean.includes(' ') && clean.includes(':')) {
      const parts = clean.split(/\s+/);
      const timeCandidate = parts.find(p => p.includes(':'));
      if (timeCandidate) clean = timeCandidate;
    }

    // 5. Handle HH:MM:SS or HH:MM format
    if (clean.includes(':')) {
      const parts = clean.split(':');
      if (parts.length >= 2) {
        let hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        
        if (isNaN(hours) || isNaN(minutes)) {
          return '00:00';
        }
        
        if (hasAmPm) {
          if (isPM && hours < 12) {
            hours += 12;
          } else if (!isPM && hours === 12) {
            hours = 0;
          }
        }
        
        return `${String(hours % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      }
    }

    // 6. Handle purely digits formats (e.g., 800, 1730, 83000, 173000)
    if (/^\d+$/.test(clean)) {
      if (clean.length === 1 || clean.length === 2) {
        let hours = parseInt(clean, 10);
        if (hasAmPm) {
          if (isPM && hours < 12) {
            hours += 12;
          } else if (!isPM && hours === 12) {
            hours = 0;
          }
        }
        return `${String(hours % 24).padStart(2, '0')}:00`;
      }
      if (clean.length === 3) {
        clean = '0' + clean; // 830 -> 0830
      }
      if (clean.length === 4) {
        let hours = parseInt(clean.substring(0, 2), 10);
        const minutes = parseInt(clean.substring(2, 4), 10);
        if (hasAmPm) {
          if (isPM && hours < 12) {
            hours += 12;
          } else if (!isPM && hours === 12) {
            hours = 0;
          }
        }
        return `${String(hours % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      }
      if (clean.length === 5) {
        clean = '0' + clean; // 83000 -> 083000
      }
      if (clean.length === 6) {
        let hours = parseInt(clean.substring(0, 2), 10);
        const minutes = parseInt(clean.substring(2, 4), 10);
        if (hasAmPm) {
          if (isPM && hours < 12) {
            hours += 12;
          } else if (!isPM && hours === 12) {
            hours = 0;
          }
        }
        return `${String(hours % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      }
    }

    return '00:00';
  };

  // Resolve statuses for a day's logs (handles cases where all are 0 or all identical by auto-alternating)
  const resolveStatuses = (logs: { time: string; status?: number }[]): number[] => {
    if (logs.length === 0) return [];
    const sorted = [...logs].sort((a, b) => a.time.localeCompare(b.time));
    
    const nonUndefined = sorted.filter(l => l.status !== undefined);
    let allIdentical = false;
    
    if (nonUndefined.length === sorted.length && sorted.length > 0) {
      const firstStatus = nonUndefined[0].status;
      allIdentical = nonUndefined.every(l => l.status === firstStatus);
    } else if (nonUndefined.length === 0) {
      allIdentical = true;
    }
    
    if (allIdentical) {
      return sorted.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
    }

    const res = sorted.map((l, idx) => {
      return l.status !== undefined ? l.status : (idx % 2 === 0 ? 0 : 1);
    });

    // Inverted check: If first is exit (1) and last is entry (0) with 2 logs, fix to [0, 1]
    if (res.length === 2 && res[0] === 1 && res[1] === 0) {
      return [0, 1];
    }

    return res;
  };

  // Analyze errors for a record
  const evaluateErrors = (times: string[], statuses?: number[]): string[] => {
    const errors: string[] = [];
    if (times.length === 0) {
      return [];
    }

    const rStatuses = statuses || times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
    const entriesCount = rStatuses.filter(s => s === 0).length;
    const exitsCount = rStatuses.filter(s => s === 1).length;

    if (entriesCount === 0 && exitsCount > 0) {
      errors.push('خروج بدون ورود (فقط تراکنش خروج ثبت شده)');
    } else if (entriesCount > 0 && exitsCount === 0) {
      errors.push('ورود بدون خروج (فقط تراکنش ورود ثبت شده)');
    } else {
      if (entriesCount > 1) {
        errors.push(`چندین ورود در یک روز (${toPersianDigits(entriesCount)} ورود)`);
      }
      if (exitsCount > 1) {
        errors.push(`چندین خروج در یک روز (${toPersianDigits(exitsCount)} خروج)`);
      }
    }

    // Chronological order error check:
    if (times.length >= 2 && entriesCount > 0 && exitsCount > 0) {
      const firstEntryIdx = rStatuses.indexOf(0);
      const firstExitIdx = rStatuses.indexOf(1);
      if (firstExitIdx < firstEntryIdx) {
        errors.push('تردد نامرتب (خروج قبل از ورود ثبت شده)');
      }
    }

    return errors;
  };

  // Sample download DAT generator
  const downloadSampleDat = () => {
    const ym = `${selectedYear}/${String(selectedMonth).padStart(2, '0')}`;
    const lines = [
      `1001\t${ym}/01\t07:30:00\t1\t0`,
      `1001\t${ym}/01\t16:45:00\t1\t1`,
      `1002\t${ym}/01\t08:00:00\t1\t0`,
      `1002\t${ym}/01\t17:15:00\t1\t1`,
      `1003\t${ym}/02\t07:45:00\t1\t0`,
      `1004\t${ym}/02\t08:00:00\t1\t0`,
      `1004\t${ym}/02\t17:30:00\t1\t1`,
      `1005\t${ym}/02\t08:15:00`,
      `1005\t${ym}/02\t17:10:00`
    ];
    const content = lines.join('\r\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Sample_Attendance.dat');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download Group Attendance Excel Template
  const handleDownloadGroupAttendanceTemplate = () => {
    const daysInMonth = (selectedMonth <= 6) ? 31 : (selectedMonth <= 11 ? 30 : (selectedYear % 4 === 3 ? 30 : 29));
    const personnelList = (db.personnel || []).filter(p => !activePeriodId || p.periodId === activePeriodId);

    const rows = personnelList.map(p => {
      const fullName = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'بدون نام';
      const attCode = p.attendanceCode || p.employeeCode || '';
      const rowObj: Record<string, any> = {
        'سال': selectedYear,
        'ماه': selectedMonth,
        'نام پرسنل': fullName,
        'کد تردد': attCode,
      };
      for (let day = 1; day <= daysInMonth; day++) {
        rowObj[`روز ${day} - ورود`] = '';
        rowObj[`روز ${day} - خروج`] = '';
      }
      return rowObj;
    });

    if (rows.length === 0) {
      const sampleRow: Record<string, any> = {
        'سال': selectedYear,
        'ماه': selectedMonth,
        'نام پرسنل': 'نمونه: علی احمدی',
        'کد تردد': '101',
      };
      for (let day = 1; day <= daysInMonth; day++) {
        sampleRow[`روز ${day} - ورود`] = day === 1 ? '08:00' : '';
        sampleRow[`روز ${day} - خروج`] = day === 1 ? '17:00' : '';
      }
      rows.push(sampleRow);
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "GroupAttendance");
    const monthName = monthsList.find(m => m.value === selectedMonth)?.label || String(selectedMonth);
    XLSX.writeFile(wb, `Gatan_Group_Attendance_${selectedYear}_${monthName}.xlsx`);
  };

  // Upload Group Attendance Excel File
  const handleUploadGroupAttendanceExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان بارگذاری تردد وجود ندارد.');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          alert('فایل اکسل تهی است یا برگه معتبری ندارد.');
          return;
        }
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any>(sheet);
        if (!rows || rows.length === 0) {
          alert('فایل اکسل هیچ ردیفی ندارد.');
          return;
        }

        const newRecordsMap = new Map<string, AttendanceRecord>();
        const existingRecords = db.attendanceRecords || [];
        existingRecords.forEach(r => {
          if (r.periodId === activePeriodId) {
            newRecordsMap.set(`${r.attendanceCode}_${r.date}`, r);
          } else {
            newRecordsMap.set(`${r.attendanceCode}_${r.date}`, r);
          }
        });

        let importedCount = 0;
        const missingCodeErrors: string[] = [];

        rows.forEach((row, rowIndex) => {
          if (!row) return;
          const keys = Object.keys(row);
          
          let rowYear = selectedYear;
          let rowMonth = selectedMonth;
          let attCode = '';
          let personnelName = '';

          for (const k of keys) {
            const kClean = toEnglishDigits(k).trim().replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase();
            if (kClean.includes('سال') || kClean === 'year' || kClean === 'jy') {
              const val = parseInt(toEnglishDigits(String(row[k] || '')), 10);
              if (!isNaN(val) && val > 1300 && val < 1500) {
                rowYear = val;
              }
            } else if (kClean.includes('ماه') || kClean === 'month' || kClean === 'jm') {
              const val = parseInt(toEnglishDigits(String(row[k] || '')), 10);
              if (!isNaN(val) && val >= 1 && val <= 12) {
                rowMonth = val;
              }
            } else if (kClean.includes('نامپرسنل') || kClean.includes('نام') || kClean.includes('name')) {
              personnelName = String(row[k] || '').trim();
            } else if (kClean.includes('کدتردد') || kClean.includes('کدحضور') || kClean.includes('attcode') || kClean.includes('code') || kClean.includes('کد')) {
              if (!attCode) {
                attCode = toEnglishDigits(String(row[k] || '')).trim();
              }
            }
          }

          // Positional fallbacks
          if (rowYear === selectedYear && keys.length >= 1) {
            const val = parseInt(toEnglishDigits(String(row[keys[0]] || '')), 10);
            if (!isNaN(val) && val > 1300 && val < 1500) {
              rowYear = val;
            }
          }
          if (rowMonth === selectedMonth && keys.length >= 2) {
            const val = parseInt(toEnglishDigits(String(row[keys[1]] || '')), 10);
            if (!isNaN(val) && val >= 1 && val <= 12) {
              rowMonth = val;
            }
          }
          if (!personnelName && keys.length >= 3) {
            personnelName = String(row[keys[2]] || '').trim();
          }
          if (!attCode && keys.length >= 4) {
            attCode = toEnglishDigits(String(row[keys[3]] || '')).trim();
          } else if (!attCode && keys.length >= 3) {
            attCode = toEnglishDigits(String(row[keys[2]] || '')).trim();
          } else if (!attCode && keys.length >= 2) {
            attCode = toEnglishDigits(String(row[keys[1]] || '')).trim();
          }

          if (!attCode) {
            const displayName = personnelName || `ردیف شماره ${toPersianDigits(rowIndex + 2)}`;
            missingCodeErrors.push(displayName);
            return;
          }

          const daysInRowMonth = (rowMonth <= 6) ? 31 : (rowMonth <= 11 ? 30 : (rowYear % 4 === 3 ? 30 : 29));

          for (let day = 1; day <= daysInRowMonth; day++) {
            let entryVal = '';
            let exitVal = '';

            for (const k of keys) {
              const kClean = toEnglishDigits(k).trim().replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase();
              const dayStr = String(day);
              
              const isTargetDay = kClean.includes(`روز${dayStr}`) || kClean.includes(`day${dayStr}`) || kClean.includes(`د${dayStr}`) || (kClean.includes(dayStr) && !kClean.includes('سال') && !kClean.includes('ماه'));

              if (isTargetDay) {
                if (kClean.includes('ورود') || kClean.includes('entry') || kClean.includes('in')) {
                  entryVal = String(row[k] || '').trim();
                } else if (kClean.includes('خروج') || kClean.includes('exit') || kClean.includes('out')) {
                  exitVal = String(row[k] || '').trim();
                }
              }
            }

            const formatExcelTime = (val: any): string => {
              if (val === undefined || val === null || val === '') return '';
              let s = String(val).trim();
              const num = Number(s);
              if (!isNaN(num) && num > 0 && num < 1) {
                const totalMins = Math.round(num * 24 * 60);
                const h = Math.floor(totalMins / 60);
                const m = totalMins % 60;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              }
              return toEnglishDigits(s);
            };

            const cleanEntry = formatExcelTime(entryVal);
            const cleanExit = formatExcelTime(exitVal);

            if (cleanEntry || cleanExit) {
              const dateStr = `${rowYear}/${String(rowMonth).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
              const times: string[] = [];
              const statuses: number[] = [];

              if (cleanEntry) {
                times.push(cleanEntry);
                statuses.push(0);
              }
              if (cleanExit) {
                times.push(cleanExit);
                statuses.push(1);
              }

              const recordId = `att-group-${activePeriodId}-${rowYear}-${rowMonth}-${attCode}-${day}`;
              const rec: AttendanceRecord = {
                id: recordId,
                periodId: activePeriodId,
                year: rowYear,
                month: rowMonth,
                attendanceCode: attCode,
                date: dateStr,
                times,
                statuses,
                isSystemCorrected: true
              };

              newRecordsMap.set(`${attCode}_${dateStr}`, rec);
              importedCount++;
            }
          }
        });

        const updatedAttendanceRecords = Array.from(newRecordsMap.values());
        onUpdateDb({
          ...db,
          attendanceRecords: updatedAttendanceRecords
        });

        let alertMsg = `فایل تردد گروهی با موفقیت بارگذاری شد!\n\n✓ تعداد ${toPersianDigits(importedCount)} تردد روزانه برای دوره/ماه مندرج ثبت گردید.`;
        if (missingCodeErrors.length > 0) {
          alertMsg += `\n\n⚠️ خطا: ${toPersianDigits(missingCodeErrors.length)} ردیف به دلیل «نداشتن کد تردد» نادیده گرفته شدند:\n• ${missingCodeErrors.slice(0, 10).join('\n• ')}${missingCodeErrors.length > 10 ? '\n(... و موارد دیگر)' : ''}`;
        }
        alert(alertMsg);
      } catch (err) {
        console.error(err);
        alert('خطا در پردازش فایل اکسل تردد گروهی. لطفاً ساختار ستون‌ها را بررسی فرمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Handle file upload (supporting .dat, .txt, .csv, .log formats from attendance devices)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان بارگذاری تردد وجود ندارد.');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          alert('فایل تهی است یا محتوای معتبری ندارد.');
          return;
        }

        const lines = text.split(/\r?\n/);
        if (lines.length === 0) {
          alert('فایل تهی است.');
          return;
        }

        // Group raw records by [userId, jalaliDate]
        const groupedMap = new Map<string, { deviceCode: string; date: string; year: number; month: number; logs: { time: string; status?: number }[] }>();
        let totalLinesParsed = 0;
        let skippedLinesCount = 0;

        lines.forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          // Split by any sequence of whitespace (tabs/spaces) or commas or semicolons
          const tokens = trimmed.split(/[\s,;]+/).filter(t => t.length > 0);
          if (tokens.length < 2) return;

          // Find date token (contains / or - or 8 digits like 20240512 or 14030215)
          const dateIdx = tokens.findIndex(t => t.includes('-') || t.includes('/') || (/^\d{8}$/.test(t) && parseInt(t.substring(0, 4), 10) > 1300));
          // Find time token (contains : or 4-6 digit time)
          const timeIdx = tokens.findIndex((t, idx) => idx !== dateIdx && (t.includes(':') || /^\d{4,6}$/.test(t)));

          let userId = '';
          let datePart = '';
          let timePart = '';
          let statusVal: number | undefined = undefined;

          if (dateIdx !== -1 && timeIdx !== -1) {
            datePart = tokens[dateIdx];
            timePart = tokens[timeIdx];

            const minDateTimeIdx = Math.min(dateIdx, timeIdx);
            const maxDateTimeIdx = Math.max(dateIdx, timeIdx);

            // Pre-date tokens strictly appearing BEFORE date and time (where user PIN / ID is positioned)
            const preTokens = tokens.filter((_, idx) => idx < minDateTimeIdx);

            if (preTokens.length === 1) {
              // Standard attendance log format: [UserID, Date, Time, VerifyMode, Status]
              // Strictly use this single leading token as user ID
              userId = toEnglishDigits(preTokens[0]).trim();
            } else if (preTokens.length === 2) {
              // Format with terminal/row ID and user ID: [DeviceID/RowID, UserPIN, Date, Time]
              // or [UserPIN, Name/Card, Date, Time]
              const t0 = toEnglishDigits(preTokens[0]).trim();
              const t1 = toEnglishDigits(preTokens[1]).trim();
              
              const p0 = findPersonnel(t0);
              const p1 = findPersonnel(t1);

              if (p1 && !isDummyUnknownPersonnel(p1)) {
                userId = t1;
              } else if (p0 && !isDummyUnknownPersonnel(p0) && !/^\d{1,2}$/.test(t0)) {
                // Only take t0 if it's an established personnel and not a generic small device number (e.g. device 1..10)
                userId = t0;
              } else {
                // In standard device logs [DeviceID, UserPIN, Date, Time], the token immediately preceding date is the user PIN
                // E.g. for "4  41", t1 ("41") is the user attendance code, while "4" is the device terminal number
                userId = t1 || t0;
              }
            } else if (preTokens.length > 2) {
              // Format with user ID and text/name: e.g. [UserID, FirstName, LastName, Date, Time]
              // Find the token that strictly matches genuine personnel
              let matchedToken: string | undefined;
              for (const tok of preTokens) {
                const cTok = toEnglishDigits(tok).trim();
                const p = findPersonnel(cTok);
                if (p && !isDummyUnknownPersonnel(p)) {
                  matchedToken = cTok;
                  break;
                }
              }
              if (matchedToken) {
                userId = matchedToken;
              } else {
                // Prefer token immediately preceding date if numeric, else first numeric
                const tLast = toEnglishDigits(preTokens[preTokens.length - 1]).trim();
                if (/^\d+$/.test(tLast)) {
                  userId = tLast;
                } else {
                  const numericToken = preTokens.find(t => /^\d+$/.test(toEnglishDigits(t).trim()));
                  userId = numericToken ? toEnglishDigits(numericToken).trim() : toEnglishDigits(preTokens[0]).trim();
                }
              }
            } else {
              // Only when date & time appear at the very start of the line: [Date, Time, UserID, ...]
              const postTokens = tokens.filter((_, idx) => idx > maxDateTimeIdx);
              userId = postTokens[0] ? toEnglishDigits(postTokens[0]).trim() : '';
            }

            // Extract status if available from tokens strictly after date & time:
            // Standard biometric logs: Check post-date tokens (verifyMode, inOutStatus)
            const postTokens = tokens.filter((_, idx) => idx > maxDateTimeIdx);
            if (postTokens.length >= 2) {
              // Usually postTokens[0] is verify mode (e.g. 4 for face, 1 for fingerprint)
              // postTokens[1] is in/out state (0 for entry, 1 for exit)
              if (postTokens[1] === '0' || postTokens[1] === '1') {
                statusVal = parseInt(postTokens[1], 10);
              } else if (postTokens[0] === '0' || postTokens[0] === '1') {
                statusVal = parseInt(postTokens[0], 10);
              }
            } else if (postTokens.length === 1 && (postTokens[0] === '0' || postTokens[0] === '1')) {
              statusVal = parseInt(postTokens[0], 10);
            }
          } else {
            // Fallback positional indices
            userId = tokens[0] || '';
            datePart = tokens[1] || '';
            timePart = tokens[2] || '00:00';
          }

          // Skip header lines or corrupt rows
          if (!datePart || !/\d/.test(datePart) || !userId || !/\d/.test(userId)) {
            skippedLinesCount++;
            return;
          }

          // Standardize date to Jalali YYYY/MM/DD
          const parsedJalali = parseDateToJalali(datePart);
          const jalaliParts = parsedJalali.split('/');
          let jalaliDate = parsedJalali;
          let recYear = selectedYear;
          let recMonth = selectedMonth;

          if (jalaliParts.length >= 3) {
            const py = parseInt(toEnglishDigits(jalaliParts[0]), 10);
            const pm = parseInt(toEnglishDigits(jalaliParts[1]), 10);
            const pd = parseInt(toEnglishDigits(jalaliParts[2]), 10);
            if (!isNaN(py) && py > 1300 && !isNaN(pm) && pm >= 1 && pm <= 12 && !isNaN(pd) && pd >= 1 && pd <= 31) {
              recYear = py;
              recMonth = pm;
              jalaliDate = `${py}/${String(pm).padStart(2, '0')}/${String(pd).padStart(2, '0')}`;
            }
          }

          // Clean and standardize time
          const cleanTime = formatToHHMM(timePart);
          totalLinesParsed++;

          const cleanUserId = toEnglishDigits(userId).trim();
          const groupKey = `${cleanUserId}_${jalaliDate}`;
          if (!groupedMap.has(groupKey)) {
            groupedMap.set(groupKey, {
              deviceCode: cleanUserId,
              date: jalaliDate,
              year: recYear,
              month: recMonth,
              logs: []
            });
          }
          
          const group = groupedMap.get(groupKey)!;
          // Filter duplicate swipes within 2 minutes for the same employee on the same date
          const newTimeMins = timeToMinutes(cleanTime);
          const isDuplicatePunch = group.logs.some(l => Math.abs(timeToMinutes(l.time) - newTimeMins) <= 2);
          if (!isDuplicatePunch) {
            group.logs.push({
              time: cleanTime,
              status: statusVal
            });
          }
        });

        if (groupedMap.size === 0) {
          alert(`هیچ رکورد تردد معتبری در این فایل پیدا نشد.\n\nتعداد کل ردیف‌های فایل: ${toPersianDigits(totalLinesParsed + skippedLinesCount)}`);
          return;
        }

        // Build list of attendance records
        const newRecords: AttendanceRecord[] = [];
        const uniqueUnknownCodes = new Set<string>();
        const genAttId = createSimpleIdGenerator(db.attendanceRecords || [], getPrefixForCollection('attendanceRecords'));

        groupedMap.forEach((val) => {
          // Sort daily logs chronologically
          val.logs.sort((a, b) => a.time.localeCompare(b.time));

          const times = val.logs.map(l => l.time);
          const statuses = resolveStatuses(val.logs);
          const matchedEmployee = findPersonnel(val.deviceCode);

          if (!matchedEmployee) {
            uniqueUnknownCodes.add(val.deviceCode);
          }

          newRecords.push({
            id: genAttId(),
            periodId: activePeriodId,
            year: val.year,
            month: val.month,
            attendanceCode: val.deviceCode,
            employeeId: matchedEmployee?.id,
            date: val.date,
            times,
            statuses,
            errors: evaluateErrors(times, statuses)
          });
        });

        // Sort records by date then deviceCode
        newRecords.sort((a, b) => a.date.localeCompare(b.date) || a.attendanceCode.localeCompare(b.attendanceCode));

        // Auto-detect dominant year and month from the uploaded records
        const monthCounts = new Map<string, number>();
        newRecords.forEach(r => {
          const key = `${r.year}-${r.month}`;
          monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
        });
        let dominantKey = '';
        let maxCount = 0;
        monthCounts.forEach((count, key) => {
          if (count > maxCount) {
            maxCount = count;
            dominantKey = key;
          }
        });

        const targetYear = Number(selectedYear);
        const targetMonth = Number(selectedMonth);
        const curMonthLabel = monthsList.find(m => m.value === targetMonth)?.label || `ماه ${targetMonth}`;

        // Separate records strictly for this selected month vs other months
        const monthMatchingRecords = newRecords.filter(
          r => Number(r.year) === targetYear && Number(r.month) === targetMonth
        );

        let finalRecordsForThisMonth: AttendanceRecord[] = [];

        if (monthMatchingRecords.length > 0) {
          // If file contains records for this selected month, extract strictly this month's records
          finalRecordsForThisMonth = monthMatchingRecords;
        } else {
          // If no records strictly matched (for example, the file dates had another year/month or days only),
          // offer to assign them to the currently selected month:
          const shouldAssignToSelectedMonth = confirm(
            `تاریخ‌های موجود در فایل با ماه انتخابی «${curMonthLabel} ${toPersianDigits(targetYear)}» منطبق نیستند.\n\nآیا مایلید رکوردهای کارکرد این فایل به عنوان ترددهای ماه انتخابی «${curMonthLabel} ${toPersianDigits(targetYear)}» ثبت و ذخیره گردند؟\n\n(با تایید، روزهای کارکرد موجود به ماه ${curMonthLabel} منتسب می‌شوند)`
          );
          if (shouldAssignToSelectedMonth) {
            finalRecordsForThisMonth = newRecords.map(r => {
              const dayStr = (r.date || '').split('/')[2] || '01';
              const cleanDay = String(parseInt(toEnglishDigits(dayStr), 10) || 1).padStart(2, '0');
              const newDate = `${targetYear}/${String(targetMonth).padStart(2, '0')}/${cleanDay}`;
              return {
                ...r,
                periodId: activePeriodId,
                year: targetYear,
                month: targetMonth,
                date: newDate
              };
            });
          } else {
            alert(`عملیات بارگذاری تردد لغو گردید. لطفاً فایل تردد مربوط به ماه انتخابی «${curMonthLabel} ${toPersianDigits(targetYear)}» را بارگذاری فرمایید.`);
            return;
          }
        }

        // Clean out existing records ONLY for this target (periodId, targetYear, targetMonth)
        const activeY = targetYear;
        const activeM = targetMonth;
        const existingRecords = db.attendanceRecords || [];
        const baseRecords = existingRecords.filter(
          r => !(r.periodId === activePeriodId && Number(r.year) === Number(activeY) && Number(r.month) === Number(activeM))
        );
        const mergedAllRecords = [...baseRecords, ...finalRecordsForThisMonth];
        mergedAllRecords.sort((a, b) => a.date.localeCompare(b.date) || a.attendanceCode.localeCompare(b.attendanceCode));

        onUpdateDb({
          ...db,
          attendanceRecords: mergedAllRecords
        });

        // Update local state for current viewing month
        setRecords(finalRecordsForThisMonth);

        const monthUnknownCodes = new Set<string>();
        finalRecordsForThisMonth.forEach(r => {
          const cleanCode = normalizeAttCode(r.attendanceCode);
          const cleanWithoutZeros = stripLeadingZeros(cleanCode);
          const isRegisteredInPeriod = allPeriodPersonnel.some(p => {
            const attTokens = splitAttCodes(getEmpAttCode(p));
            if (attTokens.length > 0) {
              return attTokens.some(tok => tok === cleanCode || (cleanWithoutZeros && stripLeadingZeros(tok) === cleanWithoutZeros));
            }
            const pEmp = normalizeAttCode(getEmpCode(p));
            return Boolean(pEmp) && (pEmp === cleanCode || (cleanWithoutZeros && stripLeadingZeros(pEmp) === cleanWithoutZeros));
          });
          if (!isRegisteredInPeriod && cleanCode) {
            monthUnknownCodes.add(toEnglishDigits(String(r.attendanceCode || '')).trim());
          }
        });

        const finalMonthLabel = monthsList.find(m => m.value === activeM)?.label || `ماه ${activeM}`;
        alert(`پردازش و ثبت فایل تردد با موفقیت انجام شد:\n\n✓ تعداد ${toPersianDigits(finalRecordsForThisMonth.length)} روز-کارکرد برای ماه «${finalMonthLabel} ${toPersianDigits(activeY)}» در سامانه ثبت و ذخیره گردید.\n✓ عملکرد ورود و خروج پرسنل با موفقیت به‌روزرسانی شد.\n✓ تعداد کدهای نامشخص این ماه: ${toPersianDigits(monthUnknownCodes.size)}\n✓ تعداد کل ردیف‌های خوانده‌شده: ${toPersianDigits(totalLinesParsed)}`);
      } catch (err) {
        console.error(err);
        alert('خطایی در خواندن فایل رخ داد. لطفاً ساختار فایل را کنترل کنید.');
      }
    };

    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // Handler to apply records fetched online directly from XFace 60 N (ZMM510) device
  const handleApplyRecordsFromDevice = (newRecords: AttendanceRecord[]) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان ثبت تردد از دستگاه وجود ندارد.');
      return;
    }
    if (!newRecords || newRecords.length === 0) return;

    const targetYear = Number(selectedYear);
    const targetMonth = Number(selectedMonth);

    // Strictly filter incoming records for selected month and active period
    const monthMatchingRecords = newRecords.filter(r => {
      const rYear = Number(r.year);
      const rMonth = Number(r.month);
      if (!isNaN(rYear) && !isNaN(rMonth) && rYear > 0 && rMonth > 0) {
        return rYear === targetYear && rMonth === targetMonth;
      }
      if (r.date) {
        const parts = toEnglishDigits(r.date).split(/[\/\-]/);
        return parts.length >= 2 && parseInt(parts[0], 10) === targetYear && parseInt(parts[1], 10) === targetMonth;
      }
      return false;
    }).map(r => ({
      ...r,
      periodId: activePeriodId,
      year: targetYear,
      month: targetMonth
    }));

    if (monthMatchingRecords.length === 0) {
      const curMonthLabel = monthsList.find(m => m.value === targetMonth)?.label || `ماه ${targetMonth}`;
      alert(`ترددهای واکشی‌شده از دستگاه حاوی اطلاعاتی برای ماه انتخابی «${curMonthLabel} ${toPersianDigits(targetYear)}» نمی‌باشند.`);
      return;
    }

    // Merge with records from other periods/months
    const baseRecords = (db.attendanceRecords || []).filter(
      r => !(r.periodId === activePeriodId && Number(r.year) === targetYear && Number(r.month) === targetMonth)
    );

    const mergedRecords = [...baseRecords, ...monthMatchingRecords];
    mergedRecords.sort((a, b) => a.date.localeCompare(b.date) || a.attendanceCode.localeCompare(b.attendanceCode));

    onUpdateDb({
      ...db,
      attendanceRecords: mergedRecords
    });

    setRecords(monthMatchingRecords);
    setActiveTab('records');
  };

  // Auto register unknown device codes as "نامشخص" personnel
  const handleAutoRegisterUnknowns = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان ثبت پرسنل جدید یا تغییر تردد وجود ندارد.');
      return;
    }
    if (unregisteredCodes.length === 0) return;

    let updatedPersonnel = [...(db.personnel || [])];
    const genEmpId = createSimpleIdGenerator(updatedPersonnel, getPrefixForCollection('personnel'));
    const registeredNow: Personnel[] = [];

    const combinedAttendanceRecords = [...(db.attendanceRecords || []), ...records];

    unregisteredCodes.forEach(code => {
      const cleanCode = toEnglishDigits(String(code)).trim();
      const normClean = stripLeadingZeros(normalizeAttCode(cleanCode));
      // Check if a genuine personnel already exists for this code
      const existing = findPersonnel(cleanCode);
      if (existing && !isDummyUnknownPersonnel(existing)) {
        return;
      }
      const alreadyHas = updatedPersonnel.some(p => {
        if (p.periodId !== activePeriodId) return false;
        const attTokens = splitAttCodes(getEmpAttCode(p));
        if (attTokens.length === 0) return false;
        return attTokens.some(tok => tok === normalizeAttCode(cleanCode) || (normClean && stripLeadingZeros(tok) === normClean));
      });
      if (alreadyHas) return;

      const firstAttDate = findFirstAttendanceDateForCode(combinedAttendanceRecords, cleanCode, activePeriodId);
      const newEmpId = genEmpId();
      const newEmp: Personnel = {
        id: newEmpId,
        periodId: activePeriodId,
        employeeCode: `EMP-U-${cleanCode}`,
        firstName: 'نامشخص',
        lastName: `(کد ${cleanCode})`,
        fullName: `نامشخص (کد ${cleanCode})`,
        attendanceCode: cleanCode,
        entryDate: firstAttDate || undefined,
        isActive: true,
        isMarried: false,
        childrenCount: 0,
        hasInsurance: false
      };

      updatedPersonnel.push(newEmp);
      registeredNow.push(newEmp);
    });

    const isMatch = (attCode: string | undefined, targetCode: string) => {
      if (!attCode || !targetCode) return false;
      const c1 = toEnglishDigits(String(attCode)).trim();
      const c2 = toEnglishDigits(String(targetCode)).trim();
      return c1 === c2 || c1.replace(/^0+/, '') === c2.replace(/^0+/, '');
    };

    const mappedRecords = records.map(rec => {
      const cleanRecCode = toEnglishDigits(String(rec.attendanceCode || '')).trim();
      const emp = findPersonnel(cleanRecCode) || registeredNow.find(p => isMatch(p.attendanceCode, cleanRecCode));
      if (emp) {
        return { ...rec, employeeId: emp.id };
      }
      return rec;
    });

    const updatedDbAttendanceRecords = (db.attendanceRecords || []).map(rec => {
      if (rec.periodId === activePeriodId) {
        const cleanRecCode = toEnglishDigits(String(rec.attendanceCode || '')).trim();
        const emp = findPersonnel(cleanRecCode) || registeredNow.find(p => isMatch(p.attendanceCode, cleanRecCode));
        if (emp) {
          return { ...rec, employeeId: emp.id };
        }
      }
      return rec;
    });

    const updatedDb: AppDatabase = {
      ...db,
      personnel: updatedPersonnel,
      attendanceRecords: updatedDbAttendanceRecords
    };
    
    setRecords(mappedRecords);
    onUpdateDb(updatedDb);

    if (registeredNow.length > 0) {
      alert(`تعداد ${toPersianDigits(registeredNow.length)} پرسنل جدید با نام "نامشخص" و کد پرسنلی حضور و غیاب مربوطه با موفقیت در پرونده‌های پرسنلی ثبت شدند.`);
    } else {
      alert('تمامی کدهای نامشخص با موفقیت با پرونده‌های پرسنلی موجود تطبیق داده شدند.');
    }
  };

  // Assign an unregistered attendance code to a registered personnel
  const handleAssignCodeToPersonnel = (code: string, pId: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان انتساب کد تردد وجود ندارد.');
      return;
    }
    const cleanInput = normalizeAttCode(code);
    const cleanWithoutZeros = stripLeadingZeros(cleanInput);
    const displayCode = toEnglishDigits(String(code)).trim();

    const combinedAttendanceRecords = [...(db.attendanceRecords || []), ...records];
    const firstAttDate = findFirstAttendanceDateForCode(combinedAttendanceRecords, code, activePeriodId);

    // 1. Update the target personnel's attendanceCode (and entryDate if empty) and delete any dummy placeholder personnel previously generated for this code
    const updatedPersonnel = (db.personnel || [])
      .filter(p => {
        if (p.id !== pId && p.periodId === activePeriodId) {
          const isDummy = isDummyUnknownPersonnel(p);
          const pAttTokens = splitAttCodes(p.attendanceCode).map(stripLeadingZeros);
          if (isDummy && cleanWithoutZeros && pAttTokens.includes(cleanWithoutZeros)) {
            return false;
          }
        }
        return true;
      })
      .map(p => {
        if (p.id === pId) {
          const hasEntryDate = Boolean(p.entryDate && String(p.entryDate).trim() && String(p.entryDate).trim() !== '-');
          return {
            ...p,
            attendanceCode: displayCode,
            entryDate: hasEntryDate ? p.entryDate : (firstAttDate || p.entryDate)
          };
        }
        return p;
      });

    const isMatch = (attCode: string | undefined) => {
      if (!attCode) return false;
      const c = stripLeadingZeros(normalizeAttCode(attCode));
      return Boolean(c && cleanWithoutZeros && c === cleanWithoutZeros);
    };

    const mappedRecords = records.map(rec => {
      if (isMatch(rec.attendanceCode)) {
        return {
          ...rec,
          attendanceCode: displayCode,
          employeeId: pId,
          errors: evaluateErrors(rec.times, rec.statuses)
        };
      }
      return rec;
    });

    const updatedDbAttendanceRecords = (db.attendanceRecords || []).map(rec => {
      if (rec.periodId === activePeriodId && isMatch(rec.attendanceCode)) {
        return {
          ...rec,
          attendanceCode: displayCode,
          employeeId: pId
        };
      }
      return rec;
    });

    const updatedDb: AppDatabase = {
      ...db,
      personnel: updatedPersonnel,
      attendanceRecords: updatedDbAttendanceRecords
    };

    setRecords(mappedRecords);
    setSelectedPersonnelMap(prev => {
      const copy = { ...prev };
      delete copy[code];
      delete copy[displayCode];
      delete copy[cleanInput];
      if (cleanWithoutZeros) delete copy[cleanWithoutZeros];
      return copy;
    });
    onUpdateDb(updatedDb);

    const targetPersonnel = (db.personnel || []).find(p => p.id === pId);
    const pName = targetPersonnel ? (targetPersonnel.fullName || `${targetPersonnel.firstName || ''} ${targetPersonnel.lastName || ''}`.trim()) : 'پرسنل';
    alert(`کد حضور و غیاب ${toPersianDigits(displayCode)} با موفقیت به «${pName}» انتصاب داده شد و در پرونده پرسنلی وی ذخیره گردید.`);
  };

  // Clear all attendance records and payroll calculations for active period
  const handleClearPeriodData = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان پاک‌سازی ترددها وجود ندارد.');
      setShowClearConfirm(false);
      return;
    }
    const remainingRecords = (db.attendanceRecords || []).filter(
      r => r.periodId !== activePeriodId
    );
    const remainingPayrollItems = (db.payrollItems || []).filter(
      p => p.periodId !== activePeriodId
    );

    onUpdateDb({
      ...db,
      attendanceRecords: remainingRecords,
      payrollItems: remainingPayrollItems
    });

    setRecords([]);
    setShowClearConfirm(false);
  };

  // Auto-correct records of personnel with only 1 clock entry/exit transaction based on shifts
  const handleAutoCorrectSingleTimes = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان اصلاح خودکار ترددها وجود ندارد.');
      return;
    }
    if (!records || records.length === 0) {
      alert('هیچ رکورد ترددی برای پردازش بارگذاری نشده است.');
      return;
    }

    let successCount = 0;
    let skippedNoShift = 0;
    let skippedNoEmp = 0;
    const reportsList: any[] = [];

    const updatedRecords = records.map(rec => {
      // Only process records with exactly 1 clock transaction (entry or exit, no extra times)
      if (rec.times.length !== 1) {
        return rec;
      }

      // Must have a matched employee
      const matchedEmployee = (db.personnel || []).find(p => p.id === rec.employeeId);
      if (!matchedEmployee) {
        skippedNoEmp++;
        return rec;
      }

      // Determine day of the week
      const weekdayName = getPersianWeekdayOfDate(rec.date);

      // Find shift assignment (passing rec.date to get specific date assignment if available!)
      const assignment = getEmployeeShiftAssignmentForWeekday(matchedEmployee, weekdayName, rec.date);

      // Robustly find the production section based on assignment's deptId or category mapping
      // Must exactly match the shift scheduling section - no fallback to personnel allocations!
      let section = null;
      if (assignment && assignment.deptId && assignment.deptId !== 'none') {
        section = (db.productionSections || []).find(sec => sec.id === assignment.deptId || sec.departmentCategoryId === assignment.deptId);
      }

      let resolvedStart = '';
      let resolvedEnd = '';
      let displayShiftTitle = '';

      if (section) {
        resolvedStart = section.startTime;
        resolvedEnd = section.endTime;
        displayShiftTitle = section.name || 'بخش مستقل';
      } else {
        // No production section assigned -> shift is "بدون بخش (مرخصی/تعطیل)"
        displayShiftTitle = 'بدون بخش (مرخصی/تعطیل)';
        // Use user-selected fallback production section working hours
        const fallbackSec = (db.productionSections || []).find(sec => sec.id === fallbackSectionId);
        if (fallbackSec) {
          resolvedStart = fallbackSec.startTime;
          resolvedEnd = fallbackSec.endTime;
        } else {
          resolvedStart = '08:00';
          resolvedEnd = '17:00';
        }
      }

      const secStartTime = toEnglishDigits(resolvedStart).trim() || '08:00';
      const secEndTime = toEnglishDigits(resolvedEnd).trim() || '17:00';

      const singleTime = rec.times[0];
      const startMin = timeToMinutes(secStartTime);
      const endMin = timeToMinutes(secEndTime);
      const actualMin = timeToMinutes(singleTime);

      const diffStart = Math.abs(actualMin - startMin);
      const diffEnd = Math.abs(actualMin - endMin);

      let newTimes: string[] = [];
      let newStatuses: number[] = [];
      let isEntry = false;
      let addedTime = '';
      let discrepancyText = '';

      if (diffStart <= diffEnd) {
        // Closer to start -> Treat as ENTRY, add secEndTime as EXIT
        newTimes = [singleTime, secEndTime];
        newStatuses = [0, 1];
        isEntry = true;
        addedTime = secEndTime;
        
        const diffVal = actualMin - startMin;
        if (diffVal > 0) {
          discrepancyText = `ورود با تاخیر: ${toPersianDigits(diffVal)} دقیقه`;
        } else if (diffVal < 0) {
          discrepancyText = `ورود زودتر: ${toPersianDigits(Math.abs(diffVal))} دقیقه`;
        } else {
          discrepancyText = 'ورود سر وقت (بدون مغایرت)';
        }
        successCount++;
      } else {
        // Closer to end -> Treat as EXIT, add secStartTime as ENTRY
        newTimes = [secStartTime, singleTime];
        newStatuses = [0, 1];
        isEntry = false;
        addedTime = secStartTime;

        const diffVal = endMin - actualMin;
        if (diffVal > 0) {
          discrepancyText = `خروج تعجیل: ${toPersianDigits(diffVal)} دقیقه`;
        } else if (diffVal < 0) {
          discrepancyText = `خروج با اضافه‌کاری: ${toPersianDigits(Math.abs(diffVal))} دقیقه`;
        } else {
          discrepancyText = 'خروج سر وقت (بدون مغایرت)';
        }
        successCount++;
      }

      const originalTimes = [...rec.times];
      const originalStatuses = rec.statuses ? [...rec.statuses] : [0];

      reportsList.push({
        id: rec.id,
        employeeName: `${matchedEmployee.firstName} ${matchedEmployee.lastName || ''}`,
        employeeCode: matchedEmployee.employeeCode,
        date: rec.date,
        weekday: weekdayName,
        originalTime: singleTime,
        originalType: isEntry ? 'ورود' : 'خروج',
        addedTime: addedTime,
        addedType: isEntry ? 'خروج سیستمی' : 'ورود سیستمی',
        shiftTimes: `${toPersianDigits(secStartTime)} الی ${toPersianDigits(secEndTime)} (${displayShiftTitle})`,
        selectedSectionId: section ? section.id : 'none',
        discrepancy: discrepancyText,
        isLateOrEarly: discrepancyText.includes('تاخیر') || discrepancyText.includes('تعجیل')
      });

      return {
        ...rec,
        times: newTimes,
        statuses: newStatuses,
        isSystemCorrected: true,
        originalTimes: originalTimes,
        originalStatuses: originalStatuses,
        errors: evaluateErrors(newTimes, newStatuses),
        correctionReport: {
          originalTime: singleTime,
          originalType: isEntry ? 'entry' : 'exit',
          addedTime: addedTime,
          addedType: isEntry ? 'exit' : 'entry',
          shiftTimes: `${toPersianDigits(secStartTime)} - ${toPersianDigits(secEndTime)} (${displayShiftTitle})`,
          discrepancy: discrepancyText
        }
      };
    });

    if (successCount > 0) {
      setPendingCorrectedRecords(updatedRecords);
      setCorrectionReports(reportsList);
      setApprovedReportIds(reportsList.map(r => r.id)); // Default to all approved
      setShowReportsModal(true);
    } else {
      alert(`هیچ تردد تک‌ساعته قابل اصلاحی بر اساس برنامه شیفت پرسنل یافت نشد.
${skippedNoShift > 0 ? `- تعداد ${toPersianDigits(skippedNoShift)} تردد تک‌ساعته یافت شد، اما شیفتی برای این پرسنل در روزهای مربوطه تعریف نشده است.` : ''}`);
    }
  };

  const handleCancelCorrections = () => {
    setPendingCorrectedRecords(null);
    setApprovedReportIds([]);
    setShowReportsModal(false);
  };

  const handleReportSectionChange = (recordId: string, sectionId: string) => {
    if (!pendingCorrectedRecords) return;

    // Find original record
    const originalRec = records.find(r => r.id === recordId);
    if (!originalRec || originalRec.times.length !== 1) return;

    const matchedEmployee = (db.personnel || []).find(p => p.id === originalRec.employeeId);
    if (!matchedEmployee) return;

    // Find selected section
    const section = (db.productionSections || []).find(sec => sec.id === sectionId);
    let resolvedStart = '';
    let resolvedEnd = '';
    let displayShiftTitle = '';

    if (section) {
      resolvedStart = section.startTime;
      resolvedEnd = section.endTime;
      displayShiftTitle = section.name || 'بخش مستقل';
    } else {
      displayShiftTitle = sectionId === 'none' ? 'بدون بخش (مرخصی/تعطیل)' : '[شیفت نا مشخص]';
      const fallbackSec = (db.productionSections || []).find(sec => sec.id === fallbackSectionId);
      if (fallbackSec) {
        resolvedStart = fallbackSec.startTime;
        resolvedEnd = fallbackSec.endTime;
      } else {
        resolvedStart = '08:00';
        resolvedEnd = '17:00';
      }
    }

    const secStartTime = toEnglishDigits(resolvedStart).trim() || '08:00';
    const secEndTime = toEnglishDigits(resolvedEnd).trim() || '17:00';

    const singleTime = originalRec.times[0];
    const startMin = timeToMinutes(secStartTime);
    const endMin = timeToMinutes(secEndTime);
    const actualMin = timeToMinutes(singleTime);

    const diffStart = Math.abs(actualMin - startMin);
    const diffEnd = Math.abs(actualMin - endMin);

    let newTimes: string[] = [];
    let newStatuses: number[] = [];
    let isEntry = false;
    let addedTime = '';
    let discrepancyText = '';

    if (diffStart <= diffEnd) {
      // Closer to start -> Treat as ENTRY, add secEndTime as EXIT
      newTimes = [singleTime, secEndTime];
      newStatuses = [0, 1];
      isEntry = true;
      addedTime = secEndTime;
      
      const diffVal = actualMin - startMin;
      if (diffVal > 0) {
        discrepancyText = `ورود با تاخیر: ${toPersianDigits(diffVal)} دقیقه`;
      } else if (diffVal < 0) {
        discrepancyText = `ورود زودتر: ${toPersianDigits(Math.abs(diffVal))} دقیقه`;
      } else {
        discrepancyText = 'ورود سر وقت (بدون مغایرت)';
      }
    } else {
      // Closer to end -> Treat as EXIT, add secStartTime as ENTRY
      newTimes = [secStartTime, singleTime];
      newStatuses = [0, 1];
      isEntry = false;
      addedTime = secStartTime;

      const diffVal = endMin - actualMin;
      if (diffVal > 0) {
        discrepancyText = `خروج تعجیل: ${toPersianDigits(diffVal)} دقیقه`;
      } else if (diffVal < 0) {
        discrepancyText = `خروج با اضافه‌کاری: ${toPersianDigits(Math.abs(diffVal))} دقیقه`;
      } else {
        discrepancyText = 'خروج سر وقت (بدون مغایرت)';
      }
    }

    const originalTimes = [...originalRec.times];
    const originalStatuses = originalRec.statuses ? [...originalRec.statuses] : [0];

    // Update pendingCorrectedRecords
    const updatedPending = pendingCorrectedRecords.map(rec => {
      if (rec.id === recordId) {
        return {
          ...rec,
          times: newTimes,
          statuses: newStatuses,
          isSystemCorrected: true,
          originalTimes: originalTimes,
          originalStatuses: originalStatuses,
          errors: evaluateErrors(newTimes, newStatuses),
          correctionReport: {
            originalTime: singleTime,
            originalType: isEntry ? 'entry' : 'exit',
            addedTime: addedTime,
            addedType: isEntry ? 'exit' : 'entry',
            shiftTimes: `${toPersianDigits(secStartTime)} - ${toPersianDigits(secEndTime)} (${displayShiftTitle})`,
            discrepancy: discrepancyText
          }
        };
      }
      return rec;
    });
    setPendingCorrectedRecords(updatedPending);

    // Update correctionReports
    const updatedReports = correctionReports.map(item => {
      if (item.id === recordId) {
        return {
          ...item,
          addedTime: addedTime,
          addedType: isEntry ? 'خروج سیستمی' : 'ورود سیستمی',
          shiftTimes: `${toPersianDigits(secStartTime)} الی ${toPersianDigits(secEndTime)} (${displayShiftTitle})`,
          selectedSectionId: sectionId,
          discrepancy: discrepancyText,
          isLateOrEarly: discrepancyText.includes('تاخیر') || discrepancyText.includes('تعجیل')
        };
      }
      return item;
    });
    setCorrectionReports(updatedReports);
  };

  const handleApplyCorrections = () => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان اعمال اصلاحات هوشمند وجود ندارد.');
      return;
    }
    if (pendingCorrectedRecords) {
      const finalRecords = records.map(originalRec => {
        const isApproved = approvedReportIds.includes(originalRec.id);
        if (isApproved) {
          const correctedRec = pendingCorrectedRecords.find(r => r.id === originalRec.id);
          return correctedRec || originalRec;
        }
        return originalRec;
      });

      persistMonthRecordsToDb(finalRecords);
      setPendingCorrectedRecords(null);
      setApprovedReportIds([]);
      setShowReportsModal(false);
      alert('اصلاحات هوشمند با موفقیت به جدول ترددها اعمال و در سیستم ثبت گردید.');
    }
  };

  // Revert a system corrected record
  const handleRevertSystemCorrection = (recordId: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId && r.isSystemCorrected && r.originalTimes) {
        return {
          ...r,
          times: [...r.originalTimes],
          statuses: r.originalStatuses ? [...r.originalStatuses] : undefined,
          isSystemCorrected: false,
          originalTimes: undefined,
          originalStatuses: undefined,
          correctionReport: undefined,
          errors: evaluateErrors(r.originalTimes, r.originalStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Modify a record's specific time
  const handleTimeChange = (recordId: string, timeIdx: number, newVal: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId) {
        const newTimes = [...r.times];
        newTimes[timeIdx] = toEnglishDigits(newVal).trim();
        
        const rStatuses = r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const pairs = r.times.map((t, idx) => ({
          time: idx === timeIdx ? toEnglishDigits(newVal).trim() : t,
          status: rStatuses[idx] !== undefined ? rStatuses[idx] : (idx % 2 === 0 ? 0 : 1)
        }));

        const cleanPairs = pairs.filter(p => p.time !== '');
        cleanPairs.sort((a, b) => a.time.localeCompare(b.time));

        const sortedTimes = cleanPairs.map(p => p.time);
        const sortedStatuses = cleanPairs.map(p => p.status);

        return {
          ...r,
          times: sortedTimes,
          statuses: sortedStatuses,
          errors: evaluateErrors(sortedTimes, sortedStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  const handleSaveDailyAttendanceCorrection = (dateStr: string, entryTime: string, exitTime: string, emp: Personnel) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان اصلاح تردد وجود ندارد.');
      return;
    }
    const cleanEntry = toEnglishDigits(entryTime).trim();
    const cleanExit = toEnglishDigits(exitTime).trim();

    const updatedTimes: string[] = [];
    if (cleanEntry) updatedTimes.push(cleanEntry);
    if (cleanExit) updatedTimes.push(cleanExit);

    let updatedRecords = [...records];
    
    const isRecordForEmployeeHelper = (rec: any, empObj: any) => isRecordForEmployee(rec, empObj);

    const existingIndex = updatedRecords.findIndex(
      r => isRecordForEmployeeHelper(r, emp) && toEnglishDigits(r.date) === toEnglishDigits(dateStr)
    );

    if (existingIndex > -1) {
      if (updatedTimes.length === 0) {
        updatedRecords.splice(existingIndex, 1);
      } else {
        updatedRecords[existingIndex] = {
          ...updatedRecords[existingIndex],
          times: updatedTimes,
          statuses: updatedTimes.map((_, idx) => (idx % 2 === 0 ? 0 : 1)),
          errors: evaluateErrors(updatedTimes, updatedTimes.map((_, idx) => (idx % 2 === 0 ? 0 : 1)))
        };
      }
    } else if (updatedTimes.length > 0) {
      updatedRecords.push({
        id: nextSimpleId(db.attendanceRecords || [], getPrefixForCollection('attendanceRecords')),
        periodId: activePeriodId,
        year: Number(selectedYear),
        month: Number(selectedMonth),
        attendanceCode: emp.attendanceCode || '',
        employeeId: emp.id,
        date: dateStr,
        times: updatedTimes,
        statuses: updatedTimes.map((_, idx) => (idx % 2 === 0 ? 0 : 1)),
        errors: []
      });
    }

    setRecords(updatedRecords);

    // Also persist immediately to keep it extremely stable and reliable!
    const baseRecords = (db.attendanceRecords || []).filter(
      r => !(r.periodId === activePeriodId && r.year === selectedYear && r.month === selectedMonth)
    );
    onUpdateDb({
      ...db,
      attendanceRecords: [...baseRecords, ...updatedRecords]
    });

    alert(`تردد روز ${toPersianDigits(dateStr)} جهت پرسنل با موفقیت اصلاح و ثبت مجدد گردید.`);
  };

  // Add a new time transaction to a record
  const handleAddTime = (recordId: string, timeVal: string, forcedStatus?: number) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    if (!timeVal.trim()) return;
    const cleanTime = toEnglishDigits(timeVal).trim();

    const updated = records.map(r => {
      if (r.id === recordId) {
        if (r.times.includes(cleanTime)) return r;

        const rStatuses = r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const entriesCount = rStatuses.filter(s => s === 0).length;
        const exitsCount = rStatuses.filter(s => s === 1).length;
        const defaultNewStatus = forcedStatus !== undefined ? forcedStatus : (entriesCount > exitsCount ? 1 : 0);

        const pairs = r.times.map((t, idx) => ({
          time: t,
          status: rStatuses[idx]
        }));

        pairs.push({ time: cleanTime, status: defaultNewStatus });
        pairs.sort((a, b) => a.time.localeCompare(b.time));

        const sortedTimes = pairs.map(p => p.time);
        const sortedStatuses = pairs.map(p => p.status);

        return {
          ...r,
          times: sortedTimes,
          statuses: sortedStatuses,
          errors: evaluateErrors(sortedTimes, sortedStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Toggle status of a specific time between Entry (0) and Exit (1)
  const handleToggleStatus = (recordId: string, timeIdx: number) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId) {
        const rStatuses = [...(r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1)))];
        rStatuses[timeIdx] = rStatuses[timeIdx] === 0 ? 1 : 0;

        return {
          ...r,
          statuses: rStatuses,
          errors: evaluateErrors(r.times, rStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Delete a specific time from a record
  const handleDeleteTime = (recordId: string, timeVal: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId) {
        const rStatuses = r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const pairs = r.times.map((t, idx) => ({
          time: t,
          status: rStatuses[idx]
        })).filter(p => p.time !== timeVal);

        const sortedTimes = pairs.map(p => p.time);
        const sortedStatuses = pairs.map(p => p.status);

        return {
          ...r,
          times: sortedTimes,
          statuses: sortedStatuses,
          errors: evaluateErrors(sortedTimes, sortedStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Convert/promote an extra entry/exit to main Entry or Exit
  const handlePromoteToMain = (recordId: string, additionalTimeIdx: number, targetSlot: 'entry' | 'exit') => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId) {
        const rStatuses = r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        
        // Find current entry / exit indices
        const oldEntryIdx = rStatuses.indexOf(0);
        const oldExitIdx = rStatuses.indexOf(1);

        // Get the actual time of the additional log we want to promote
        const promotedTime = r.times[additionalTimeIdx];

        // Build a new list of pairs
        let pairs = r.times.map((t, idx) => ({
          time: t,
          status: rStatuses[idx]
        }));

        if (targetSlot === 'entry') {
          // Remove the old entry if it exists
          if (oldEntryIdx !== -1) {
            const oldEntryTime = r.times[oldEntryIdx];
            pairs = pairs.filter(p => p.time !== oldEntryTime);
          }
          // Mark the promoted one as entry (0)
          pairs = pairs.map(p => {
            if (p.time === promotedTime) {
              return { ...p, status: 0 };
            }
            return p;
          });
        } else {
          // Remove the old exit if it exists
          if (oldExitIdx !== -1) {
            const oldExitTime = r.times[oldExitIdx];
            pairs = pairs.filter(p => p.time !== oldExitTime);
          }
          // Mark the promoted one as exit (1)
          pairs = pairs.map(p => {
            if (p.time === promotedTime) {
              return { ...p, status: 1 };
            }
            return p;
          });
        }

        pairs.sort((a, b) => a.time.localeCompare(b.time));
        const sortedTimes = pairs.map(p => p.time);
        const sortedStatuses = pairs.map(p => p.status);

        return {
          ...r,
          times: sortedTimes,
          statuses: sortedStatuses,
          errors: evaluateErrors(sortedTimes, sortedStatuses)
        };
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Swap main entry and exit times by swapping their status values
  const handleSwapEntryExit = (recordId: string) => {
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان تغییر تردد وجود ندارد.');
      return;
    }
    const updated = records.map(r => {
      if (r.id === recordId) {
        const rStatuses = r.statuses || r.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const entryIdx = rStatuses.indexOf(0);
        const exitIdx = rStatuses.indexOf(1);

        if (entryIdx !== -1 && exitIdx !== -1) {
          const newStatuses = [...rStatuses];
          newStatuses[entryIdx] = 1;
          newStatuses[exitIdx] = 0;
          return {
            ...r,
            statuses: newStatuses,
            errors: evaluateErrors(r.times, newStatuses)
          };
        } else if (entryIdx !== -1) {
          const newStatuses = [...rStatuses];
          newStatuses[entryIdx] = 1;
          return {
            ...r,
            statuses: newStatuses,
            errors: evaluateErrors(r.times, newStatuses)
          };
        } else if (exitIdx !== -1) {
          const newStatuses = [...rStatuses];
          newStatuses[exitIdx] = 0;
          return {
            ...r,
            statuses: newStatuses,
            errors: evaluateErrors(r.times, newStatuses)
          };
        }
      }
      return r;
    });
    persistMonthRecordsToDb(updated);
  };

  // Persist current month's attendance edits immediately to AppDatabase
  const persistMonthRecordsToDb = (nextMonthRecords: AttendanceRecord[]) => {
    const normalizedRecords = nextMonthRecords.map(r => ({
      ...r,
      periodId: activePeriodId,
      year: Number(selectedYear),
      month: Number(selectedMonth)
    }));
    const baseRecords = (db.attendanceRecords || []).filter(r => {
      if (r.periodId !== activePeriodId) return true;
      const rYear = Number(r.year);
      const rMonth = Number(r.month);
      if (!isNaN(rYear) && !isNaN(rMonth) && rYear > 0 && rMonth > 0) {
        return !(rYear === Number(selectedYear) && rMonth === Number(selectedMonth));
      }
      if (r.date) {
        const parts = toEnglishDigits(r.date).split(/[\/\-]/);
        if (parts.length >= 2) {
          return !(parseInt(parts[0], 10) === Number(selectedYear) && parseInt(parts[1], 10) === Number(selectedMonth));
        }
      }
      return true;
    });
    onUpdateDb({
      ...db,
      attendanceRecords: [...baseRecords, ...normalizedRecords]
    });
    setRecords(normalizedRecords);
  };

  // Filtering records list
  const filteredRecords = useMemo(() => {
    return records.filter(rec => {
      let matchedEmp: Personnel | undefined = undefined;
      if (rec.attendanceCode) {
        matchedEmp = findPersonnel(rec.attendanceCode);
      }
      if (!matchedEmp && rec.employeeId) {
        const empById = personnelLookup.byIdInPeriod.get(rec.employeeId);
        if (empById) {
          const empAttTokens = splitAttCodes(getEmpAttCode(empById)).map(stripLeadingZeros);
          const cleanRecCode = stripLeadingZeros(normalizeAttCode(rec.attendanceCode));
          if (!cleanRecCode || empAttTokens.includes(cleanRecCode)) {
            matchedEmp = empById;
          }
        }
      }
      const isUnknown = !matchedEmp || isDummyUnknownPersonnel(matchedEmp);
      
      if (filterType === 'errors') {
        if (!rec.errors || rec.errors.length === 0) return false;

        const rStatuses = rec.statuses || rec.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const entryIdx = rStatuses.indexOf(0);
        const exitIdx = rStatuses.indexOf(1);

        if (errorSubFilter === 'no_entry') {
          if (entryIdx !== -1) return false;
        } else if (errorSubFilter === 'no_exit') {
          if (exitIdx !== -1) return false;
        } else if (errorSubFilter === 'extra') {
          const mainCount = (entryIdx !== -1 ? 1 : 0) + (exitIdx !== -1 ? 1 : 0);
          if (rec.times.length <= mainCount) return false;
        }
      } else if (filterType === 'valid') {
        if (rec.errors && rec.errors.length > 0) return false;
      } else if (filterType === 'unknown') {
        if (!isUnknown) return false;
      }

      if (personnelSearch.trim()) {
        const query = toEnglishDigits(personnelSearch.toLowerCase().trim());
        const cleanQuery = query.replace(/^0+/, '') || query;
        const firstName = String(matchedEmp?.firstName || '').toLowerCase();
        const lastName = String(matchedEmp?.lastName || '').toLowerCase();
        const fullName = `${firstName} ${lastName}`;
        const attCode = toEnglishDigits(String(rec.attendanceCode || '')).toLowerCase().trim();
        const cleanAttCode = attCode.replace(/^0+/, '');
        const empCode = toEnglishDigits(String(matchedEmp?.employeeCode || '')).toLowerCase().trim();
        const cleanEmpCode = empCode.replace(/^0+/, '');

        // If user searched a number (e.g. "4"), match exactly to code 4 (or 04), NOT 41 or 14
        const isNumericQuery = /^\d+$/.test(cleanQuery);
        let codeMatches = false;
        if (isNumericQuery) {
          codeMatches = (cleanAttCode === cleanQuery || cleanEmpCode === cleanQuery || attCode === query || empCode === query);
        } else {
          codeMatches = attCode.includes(query) || empCode.includes(query);
        }

        const nameMatches = fullName.includes(query) || firstName.includes(query) || lastName.includes(query);

        if (!codeMatches && !nameMatches) {
          return false;
        }
      }

      return true;
    });
  }, [records, filterType, errorSubFilter, db.personnel, personnelSearch, findPersonnel, personnelLookup]);

  // Counts for each error type
  const errorSubCounts = useMemo(() => {
    let noEntry = 0;
    let noExit = 0;
    let extra = 0;

    records.forEach(rec => {
      if (rec.errors && rec.errors.length > 0) {
        const rStatuses = rec.statuses || rec.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
        const entryIdx = rStatuses.indexOf(0);
        const exitIdx = rStatuses.indexOf(1);

        if (entryIdx === -1) {
          noEntry++;
        }
        if (exitIdx === -1) {
          noExit++;
        }
        const mainCount = (entryIdx !== -1 ? 1 : 0) + (exitIdx !== -1 ? 1 : 0);
        if (rec.times.length > mainCount) {
          extra++;
        }
      }
    });

    return { noEntry, noExit, extra };
  }, [records]);

  // Count errors
  const errorCount = useMemo(() => {
    return records.filter(r => r.errors && r.errors.length > 0).length;
  }, [records]);

  // personnelOptions for dropdown
  const personnelOptions = useMemo(() => {
    return (db.personnel || [])
      .filter(p => p.periodId === activePeriodId)
      .map(p => ({
        value: p.id,
        label: `${p.firstName} ${p.lastName} ${p.attendanceCode ? `(کد تردد: ${toPersianDigits(p.attendanceCode)})` : '(بدون کد تردد)'}`
      }));
  }, [db.personnel, activePeriodId]);

  // Quick State for adding a new record manually
  const [showAddManualForm, setShowAddManualForm] = useState(false);
  const [manualEmployeeId, setManualEmployeeId] = useState('');
  const [manualType, setManualType] = useState<'both' | 'entry_only' | 'exit_only'>('both');
  const [manualDate, setManualDate] = useState('');
  const [manualTime1, setManualTime1] = useState('08:00');
  const [manualTime2, setManualTime2] = useState('17:00');

  const handleAddRecordManually = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMonthLocked) {
      alert('سند حقوق و دستمزد این ماه قفل شده است و امکان ثبت تردد دستی وجود ندارد.');
      return;
    }
    if (!manualEmployeeId) {
      alert('لطفاً پرسنل مورد نظر را انتخاب نمایید.');
      return;
    }
    if (!manualDate.trim()) {
      alert('لطفاً تاریخ را وارد نمایید.');
      return;
    }

    const matchedEmployee = (db.personnel || []).find(p => p.id === manualEmployeeId);
    if (!matchedEmployee) {
      alert('پرسنل یافت نشد.');
      return;
    }

    const empCode = matchedEmployee.attendanceCode || '';

    let sortedTimes: string[] = [];
    let sortedStatuses: number[] = [];

    if (manualType === 'both') {
      const timesList: string[] = [];
      const statusesList: number[] = [];
      if (manualTime1.trim()) {
        timesList.push(toEnglishDigits(manualTime1).trim());
        statusesList.push(0);
      }
      if (manualTime2.trim()) {
        timesList.push(toEnglishDigits(manualTime2).trim());
        statusesList.push(1);
      }
      // Pair and sort chronologically
      const pairs = timesList.map((t, idx) => ({ time: t, status: statusesList[idx] }));
      pairs.sort((a, b) => a.time.localeCompare(b.time));
      sortedTimes = pairs.map(p => p.time);
      sortedStatuses = pairs.map(p => p.status);
    } else if (manualType === 'entry_only') {
      if (!manualTime1.trim()) {
        alert('لطفاً ساعت ورود را وارد نمایید.');
        return;
      }
      sortedTimes = [toEnglishDigits(manualTime1).trim()];
      sortedStatuses = [0];
    } else if (manualType === 'exit_only') {
      if (!manualTime2.trim()) {
        alert('لطفاً ساعت خروج را وارد نمایید.');
        return;
      }
      sortedTimes = [toEnglishDigits(manualTime2).trim()];
      sortedStatuses = [1];
    }

    const targetDate = parseDateCell(manualDate);

    const isRecordForEmployeeHelper = (rec: any, empObj: any) => isRecordForEmployee(rec, empObj);

    const existingIndex = records.findIndex(
      r => isRecordForEmployeeHelper(r, matchedEmployee) && normalizeDateStr(r.date) === normalizeDateStr(targetDate)
    );

    let updatedRecordsList = [...records];

    if (existingIndex > -1) {
      const existingRecord = records[existingIndex];
      const existingTimes = existingRecord.times || [];
      const existingStatuses = existingRecord.statuses || [];

      // Combine existing and new times/statuses
      const allPairs = [
        ...existingTimes.map((t, idx) => ({
          time: t,
          status: existingStatuses[idx] !== undefined ? existingStatuses[idx] : 0
        })),
        ...sortedTimes.map((t, idx) => ({
          time: t,
          status: sortedStatuses[idx] !== undefined ? sortedStatuses[idx] : 0
        }))
      ];

      // De-duplicate pairs by time
      const seenTimes = new Set<string>();
      const uniquePairs = allPairs.filter(p => {
        if (seenTimes.has(p.time)) return false;
        seenTimes.add(p.time);
        return true;
      });

      // Sort pairs chronologically
      uniquePairs.sort((a, b) => a.time.localeCompare(b.time));

      const finalTimes = uniquePairs.map(p => p.time);
      const finalStatuses = uniquePairs.map(p => p.status);

      updatedRecordsList[existingIndex] = {
        ...existingRecord,
        times: finalTimes,
        statuses: finalStatuses,
        errors: evaluateErrors(finalTimes, finalStatuses)
      };
    } else {
      const newRec: AttendanceRecord = {
        id: nextSimpleId(db.attendanceRecords || [], getPrefixForCollection('attendanceRecords')),
        periodId: activePeriodId,
        year: selectedYear,
        month: selectedMonth,
        attendanceCode: empCode,
        employeeId: matchedEmployee.id,
        date: targetDate,
        times: sortedTimes,
        statuses: sortedStatuses,
        errors: evaluateErrors(sortedTimes, sortedStatuses)
      };
      updatedRecordsList.push(newRec);
    }

    updatedRecordsList.sort((a, b) => a.date.localeCompare(b.date) || a.attendanceCode.localeCompare(b.attendanceCode));

    persistMonthRecordsToDb(updatedRecordsList);
    
    // Clear filters and show the records tab so the new manual entry is immediately displayed
    setFilterType('all');
    setErrorSubFilter('all');
    setPersonnelSearch(matchedEmployee.fullName || `${matchedEmployee.firstName} ${matchedEmployee.lastName}`);
    setActiveTab('records');

    setManualEmployeeId('');
    setManualDate('');
    setShowAddManualForm(false);
    alert('رکورد تردد دستی با موفقیت افزوده و ثبت گردید و جدول بر اساس تاریخ مرتب شد.');
  };

  // Professional Single-Page A4 Performance Card Print Handler
  const handlePrintPersonnelPerformance = () => {
    if (!inspectionDetails || !inspectionDetails.employee) {
      alert('لطفاً ابتدا پرسنل مورد نظر را جهت چاپ کارنامه عملکرد انتخاب نمایید.');
      return;
    }

    const emp = inspectionDetails.employee;
    const empName = emp.fullName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'پرسنل';
    const monthObj = monthsList.find(m => m.value === selectedMonth);
    const monthLabel = monthObj ? monthObj.label : 'ماه جاری';
    const todayJalali = getTodayJalali();

    const alloc = (db.personnelAllocations || []).find(pa => 
      (pa.employeeCode === emp.employeeCode || (emp.attendanceCode && pa.employeeCode === emp.attendanceCode)) &&
      pa.periodId === activePeriodId
    );
    const deptObj = alloc ? (db.productCategories || []).find(d => d.periodId === activePeriodId && d.id === alloc.departmentCategoryId) : null;
    const empDept = deptObj ? deptObj.name : 'کارگاه تولیدی';

    const printHtml = `
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>کارنامه عملکرد ماهانه - ${empName} - ${monthLabel} ${toPersianDigits(selectedYear)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4 portrait;
            margin: 3.5mm 5mm 3.5mm 5mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Vazirmatn', 'Vazir', 'Shabnam', 'Sahel', 'Tahoma', 'Segoe UI', Arial, sans-serif !important;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
            font-feature-settings: "ss05" 1, "locl" 1;
            direction: rtl;
            text-align: right;
            font-size: 7.4px;
            line-height: 1.15;
          }
          .report-wrapper {
            width: 100%;
            box-sizing: border-box;
            page-break-inside: avoid;
            page-break-after: avoid;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            background: #ffffff !important;
            page-break-inside: avoid;
          }
          th, td {
            border: 1px solid #111111;
            padding: 1.5px 2.5px;
            color: #000000 !important;
          }
          th {
            background-color: #ffffff !important;
            font-weight: 900;
          }
          .font-mono {
            font-family: 'Vazirmatn', 'Vazir', 'Tahoma', sans-serif !important;
            font-variant-numeric: tabular-nums;
            font-weight: bold;
          }
          .text-center { text-align: center; }
          .text-left { text-align: left; }
          .text-right { text-align: right; }
        </style>
      </head>
      <body>
        <div class="report-wrapper">
          <!-- 1. Header & Organization Identity -->
          <table style="border: 1.4px solid #000000; margin-bottom: 2.5px;">
            <tr>
              <td style="width: 28%; vertical-align: middle; padding: 3px 5px; border-left: 1px solid #000;">
                <div style="font-weight: 900; font-size: 9px;">کارگاه نان و شیرینی سنتی گاتان</div>
                <div style="font-size: 7.5px; color: #222; margin-top: 1px;">شناسه کارگاه: <strong>۰۷۱۰۰۰۳۳۳۴</strong></div>
              </td>
              <td style="width: 44%; text-align: center; vertical-align: middle; padding: 3px 5px; border-left: 1px solid #000;">
                <div style="font-size: 11px; font-weight: 900; letter-spacing: -0.2px;">کارنامه ارزیابی عملکرد و تردد ماهانه پرسنل</div>
                <div style="font-size: 7.5px; font-weight: bold; color: #222; margin-top: 1px;">سامانه هوشمند ارزیابی حضور، غیاب و کارکرد کارگاهی</div>
              </td>
              <td style="width: 28%; vertical-align: middle; text-align: left; padding: 3px 5px; font-size: 7.5px;" class="font-mono">
                <div>دوره کارکرد: <strong>${monthLabel} ${toPersianDigits(selectedYear)}</strong></div>
                <div style="margin-top: 1px;">تاریخ صدور: <strong>${todayJalali}</strong></div>
              </td>
            </tr>
          </table>

          <!-- 2. Employee Metadata Bar -->
          <table style="border: 1.2px solid #000000; margin-bottom: 2.5px; font-size: 7.8px;">
            <tr>
              <td style="width: 28%; padding: 2px 4px; border-left: 1px solid #000;">
                نام پرسنل: <strong>${empName}</strong>
              </td>
              <td style="width: 24%; padding: 2px 4px; border-left: 1px solid #000;">
                کد پرسنلی / تردد: <strong class="font-mono">${toPersianDigits(emp.employeeCode || '-')} / ${toPersianDigits(emp.attendanceCode || '-')}</strong>
              </td>
              <td style="width: 24%; padding: 2px 4px; border-left: 1px solid #000;">
                کد ملی: <strong class="font-mono">${toPersianDigits(emp.nationalId || '-')}</strong>
              </td>
              <td style="width: 24%; padding: 2px 4px;">
                بخش کاری: <strong>${empDept}</strong>
              </td>
            </tr>
          </table>

          <!-- 3. Key Summary Figures Strip -->
          <table style="border: 1.2px solid #000000; text-align: center; margin-bottom: 2.5px; font-size: 7.3px;">
            <thead>
              <tr style="border-bottom: 1px solid #000; font-weight: 800;">
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">جمع حضور</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">خالص حضور</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">کارکرد عادی</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">استراحت / غیرمجاز</th>
                <th style="width: 12%; border-left: 1px solid #000; padding: 2px;">حضور / غیبت</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">اضافه‌کار موظفی</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">کل تاخیرها</th>
                <th style="width: 11%; border-left: 1px solid #000; padding: 2px;">جمعه‌کاری</th>
                <th style="width: 11%; padding: 2px;">تعطیل‌کاری</th>
              </tr>
            </thead>
            <tbody>
              <tr class="font-mono" style="font-weight: 800;">
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalWorkedMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalNetWorkedMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalNormalWorkMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${toPersianDigits(formatMinutesToHM(inspectionDetails.totalBreakMinutes))} / ${toPersianDigits(formatMinutesToHM(inspectionDetails.totalUnauthorizedPresenceMinutes))}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${toPersianDigits(inspectionDetails.presentDaysCount)} / ${toPersianDigits(inspectionDetails.absentDaysCount)} روز</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalMandatoryOvertimeMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalDelayMinutesNormal + inspectionDetails.totalDelayMinutesFriday + inspectionDetails.totalDelayMinutesHoliday)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalFridayWorkMinutes)}</td>
                <td style="padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalHolidayWorkMinutes)}</td>
              </tr>
            </tbody>
          </table>

          <!-- 3.5 Final Performance Calculation Results Strip -->
          <table style="border: 1.2px solid #000000; text-align: center; margin-bottom: 2.5px; font-size: 7.5px;">
            <thead>
              <tr style="border-bottom: 1px solid #000; font-weight: 900; background: #f5f5f5;">
                <th style="width: 16.6%; border-left: 1px solid #000; padding: 2px;">روز کارکرد نهایی</th>
                <th style="width: 16.6%; border-left: 1px solid #000; padding: 2px;">ساعت کارکرد نهایی</th>
                <th style="width: 16.6%; border-left: 1px solid #000; padding: 2px;">اضافه‌کار نهایی</th>
                <th style="width: 16.6%; border-left: 1px solid #000; padding: 2px;">جمعه‌کاری نهایی</th>
                <th style="width: 16.6%; border-left: 1px solid #000; padding: 2px;">تعطیل‌کاری نهایی</th>
                <th style="width: 16.6%; padding: 2px;">مانده مرخصی دوره</th>
              </tr>
            </thead>
            <tbody>
              <tr class="font-mono" style="font-weight: 900;">
                <td style="border-left: 1px solid #000; padding: 2px;">${toPersianDigits(inspectionDetails.finalDaysWorked)} روز</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.finalWorkedMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.finalOtMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.finalFridayMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.finalHolidayMinutes)}</td>
                <td style="padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.remainingLeaveMinutes)}</td>
              </tr>
            </tbody>
          </table>

          <!-- 4. Daily Performance Detailed Ledger (Fits tightly on 1 page) -->
          <table style="border: 1.2px solid #000000; font-size: 7px;">
            <thead>
              <tr style="border-bottom: 1.2px solid #000; font-weight: 900; background: #ffffff;" class="text-center">
                <th style="width: 4%; border-left: 1px solid #000; padding: 1.8px 2px;">روز</th>
                <th style="width: 7%; border-left: 1px solid #000; padding: 1.8px 2px;">روز هفته</th>
                <th style="width: 12%; border-left: 1px solid #000; padding: 1.8px 2px;">شیفت مصوب</th>
                <th style="width: 13%; border-left: 1px solid #000; padding: 1.8px 2px;">ساعات تردد</th>
                <th style="width: 6%; border-left: 1px solid #000; padding: 1.8px 2px;">وضعیت</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">حضور</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">استراحت</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">غیرمجاز</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">خالص حضور</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">کار عادی</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">اضافه موظفی</th>
                <th style="width: 6.5%; border-left: 1px solid #000; padding: 1.8px 2px;">تاخیر</th>
                <th style="width: 6%; border-left: 1px solid #000; padding: 1.8px 2px;">جمعه</th>
                <th style="width: 6.5%; padding: 1.8px 2px;">تعطیل</th>
              </tr>
            </thead>
            <tbody>
              ${inspectionDetails.daysDetails.map((day) => {
                const isFri = normalizeWeekday(day.weekday) === normalizeWeekday('جمعه');
                const isHol = periodOfficialHolidays.some(
                  h => toEnglishDigits(h.date).replace(/[-\/]/g, '/') === toEnglishDigits(day.dateStr).replace(/[-\/]/g, '/')
                );
                const shiftText = day.shift ? (day.shift.name ? `${day.shift.name} (${toPersianDigits(day.shift.startTime)}-${toPersianDigits(day.shift.endTime)})` : `${toPersianDigits(day.shift.startTime)}-${toPersianDigits(day.shift.endTime)}`) : 'بدون شیفت';
                const timesText = day.times && day.times.length > 0 ? day.times.map(t => toPersianDigits(t)).join(' - ') : '-';
                const statusText = day.isPresent ? 'حاضر' : (isHol ? 'تعطیل' : (isFri ? 'جمعه' : 'غایب'));

                return `
                  <tr class="text-center font-mono">
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; font-weight: bold;">${toPersianDigits(day.dayNum)}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; font-family: 'Vazirmatn', sans-serif;">${day.weekday}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${shiftText}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; direction: ltr; text-align: center;">${timesText}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; font-family: 'Vazirmatn', sans-serif; font-weight: bold;">${statusText}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; font-weight: bold;">${day.workedMin > 0 ? formatMinutesToHoursAndMinutes(day.workedMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.breakMin > 0 ? formatMinutesToHoursAndMinutes(day.breakMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.unauthorizedPresenceMin > 0 ? formatMinutesToHoursAndMinutes(day.unauthorizedPresenceMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px; font-weight: bold;">${day.adjustedWorkedMin > 0 ? formatMinutesToHoursAndMinutes(day.adjustedWorkedMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.normalWorkMin > 0 ? formatMinutesToHoursAndMinutes(day.normalWorkMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.overtimeMandatoryMin > 0 ? formatMinutesToHoursAndMinutes(day.overtimeMandatoryMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.delayMin > 0 ? formatMinutesToHoursAndMinutes(day.delayMin) : '-'}</td>
                    <td style="border-left: 1px solid #000; padding: 1.3px 1.5px;">${day.fridayWorkMin > 0 ? formatMinutesToHoursAndMinutes(day.fridayWorkMin) : '-'}</td>
                    <td style="padding: 1.3px 1.5px;">${day.holidayWorkMin > 0 ? formatMinutesToHoursAndMinutes(day.holidayWorkMin) : '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr class="text-center font-mono" style="font-weight: 900; border-top: 1.2px solid #000;">
                <td colspan="5" style="border-left: 1px solid #000; padding: 2px; text-align: center; font-family: 'Vazirmatn', sans-serif;">سرجمع کل کارکرد ماه:</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalWorkedMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalBreakMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalUnauthorizedPresenceMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalNetWorkedMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalNormalWorkMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalMandatoryOvertimeMinutes)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalDelayMinutesNormal + inspectionDetails.totalDelayMinutesFriday + inspectionDetails.totalDelayMinutesHoliday)}</td>
                <td style="border-left: 1px solid #000; padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalFridayWorkMinutes)}</td>
                <td style="padding: 2px;">${formatMinutesToHoursAndMinutes(inspectionDetails.totalHolidayWorkMinutes)}</td>
              </tr>
            </tfoot>
          </table>

          <!-- 5. Formal Legal Signatures -->
          <table style="border: 1px solid #000; margin-top: 3px; font-size: 7.2px; text-align: center;">
            <tr>
              <td style="width: 25%; padding: 3px; border-left: 1px solid #000;">
                <div>امضا و تایید پرسنل (کارگر)</div>
                <div style="margin-top: 14px; letter-spacing: 1px;">........................</div>
              </td>
              <td style="width: 25%; padding: 3px; border-left: 1px solid #000;">
                <div>مسئول حضور و غیاب</div>
                <div style="margin-top: 14px; letter-spacing: 1px;">........................</div>
              </td>
              <td style="width: 25%; padding: 4px; border-left: 1px solid #000;">
                <div>سرپرست کارگاه و تولید</div>
                <div style="margin-top: 14px; letter-spacing: 1px;">........................</div>
              </td>
              <td style="width: 25%; padding: 3px;">
                <div>مدیریت کارگاه نان و شیرینی گاتان</div>
                <div style="margin-top: 14px; letter-spacing: 1px;">........................</div>
              </td>
            </tr>
          </table>
        </div>

        <script>
          window.onload = function() {
            var doPrint = function() {
              window.focus();
              window.print();
            };
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(function() {
                setTimeout(doPrint, 250);
              }).catch(function() {
                setTimeout(doPrint, 350);
              });
            } else {
              setTimeout(doPrint, 350);
            }
          };
        </script>
      </body>
      </html>
    `;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(printHtml);
      frameDoc.close();

      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 60000);
    }
  };

  return (
    <div className="space-y-6" id="attendance-section">
      {/* Title Panel */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-500/10 text-rose-500 rounded-xl">
              <Clock className="h-5 w-5" />
            </div>
            <h3 className="text-base font-black text-white">سامانه هوشمند حضور و غیاب پرسنل کارگاه</h3>
          </div>
          <p className="text-xs text-slate-400">
            بارگذاری کارکرد خام دستگاه حضور غیاب، تطبیق بر پایه کد پرسنلی حضور و غیاب، اعتبارسنجی خودکار ترتیب ترددها (ورود/خروج) و تصحیح آنلاین خطاها
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full md:w-auto shrink-0">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadSampleDat}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span>دانلود فایل نمونه DAT</span>
            </button>
            <button
              onClick={handleDownloadGroupAttendanceTemplate}
              className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 hover:text-white border border-emerald-900/50 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              <span>دانلود فایل نمونه اکسل تردد گروهی</span>
            </button>
          </div>
        </div>
      </div>

      {isMonthLocked && (
        <div className="bg-amber-950/30 border border-amber-500/40 rounded-2xl px-4 py-3 flex items-center gap-3 text-amber-200 text-xs font-bold shadow-md" dir="rtl">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
          <span>سند حقوق و دستمزد این ماه ثبت قطعی و قفل شده است. تا زمان بازگشایی قفل ماه، امکان ویرایش ترددها، بارگذاری فایل جدید یا تغییر شیفت‌های این ماه غیرفعال می‌باشد.</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-wrap border-b border-slate-800 gap-1.5 p-1 bg-slate-900/60 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('records')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-black transition-all cursor-pointer rounded-lg border ${
            activeTab === 'records'
              ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/10 font-extrabold'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          ثبت و اصلاح ترددها (ورود و خروج)
        </button>

        {isDataLoaded && (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('mismatches')}
              className={`flex items-center gap-2 px-5 py-3 text-xs font-black transition-all cursor-pointer rounded-lg border ${
                activeTab === 'mismatches'
                  ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/10 font-extrabold'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              عدم تطابق شیفت و تردد پرسنل
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('performance')}
              className={`flex items-center gap-2 px-5 py-3 text-xs font-black transition-all cursor-pointer rounded-lg border ${
                activeTab === 'performance'
                  ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/10 font-extrabold'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              سامانه هوشمند ارزیابی عملکرد ماهانه پرسنل
            </button>
          </>
        )}
      </div>

      {/* Control center & configuration */}
      {(!isDataLoaded || activeTab === 'records') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        
        {/* Step 1: Configuration */}
        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4 shadow-lg lg:col-span-1">
          <h4 className="text-xs font-black text-rose-400 flex items-center gap-2 border-b border-slate-850 pb-3">
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
            تنظیم زمان و دریافت فایل ترددها
          </h4>

          {/* Month & Year Display (linked to top-of-page settings) */}
          <div className="bg-slate-900 border border-slate-850 rounded-2xl p-3.5 text-right space-y-1.5">
            <span className="text-[11px] text-slate-400 font-extrabold block">دوره محاسباتی فعال (تنظیم شده در بالای صفحه):</span>
            <div className="flex items-center gap-2 text-rose-400 font-black text-xs">
              <Calendar className="h-4 w-4 text-rose-500" />
              <span>
                {monthsList.find(m => m.value === selectedMonth)?.label || ''} {toPersianDigits(selectedYear)}
              </span>
            </div>
          </div>

          {/* Direct WiFi / Network Connection Card for XFace 60 N */}
          <div className="pt-1">
            <button
              type="button"
              disabled={isMonthLocked}
              onClick={() => !isMonthLocked && setIsDeviceModalOpen(true)}
              className={`w-full flex flex-col items-center justify-center p-4 border-2 rounded-2xl transition-all group text-center space-y-1.5 shadow-lg ${
                isMonthLocked
                  ? 'border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed opacity-60'
                  : 'border-indigo-500/30 hover:border-indigo-400 bg-indigo-950/20 hover:bg-indigo-950/40 cursor-pointer shadow-indigo-950/30'
              }`}
            >
              <div className="flex items-center gap-2 text-indigo-300 group-hover:text-white font-black text-xs">
                <Radio className="h-5 w-5 text-rose-500 animate-pulse" />
                <span>اتصال مستقیم آنلاین به دستگاه XFace 60 N (شبکه و وای‌فای)</span>
              </div>
              <span className="text-[10px] text-slate-400 leading-normal">
                پلتفرم سخت‌افزاری ZMM510 | پورت ۴۳۷۰ | تخلیه مستقیم ترددها بدون نیاز به فلش مموری
              </span>
            </button>
          </div>

          {/* Upload card */}
          <div className="pt-1">
            <label 
              htmlFor={isMonthLocked ? undefined : "attendance-file-upload"}
              className={`flex flex-col items-center justify-center p-5 border-2 border-dashed rounded-2xl transition-all group text-center ${
                isMonthLocked
                  ? 'border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed'
                  : 'border-slate-800 hover:border-rose-500/50 bg-slate-900/50 hover:bg-slate-900 cursor-pointer'
              }`}
            >
              <Upload className="h-7 w-7 text-slate-500 group-hover:text-rose-500 transition-all mb-2 animate-bounce" />
              <span className="text-xs font-black text-slate-300">یا انتخاب و بارگذاری فایل ترددها (DAT, TXT, CSV, LOG)</span>
              <span className="text-[10px] text-slate-500 mt-1 leading-normal text-justify">
                پشتیبان فایل‌های استاندارد دستگاه‌های حضور و غیاب (.dat, .txt, .csv, .log) با استخراج خودکار ترددها، تاریخ شمسی/میلادی و ذخیره فوری عملکرد
              </span>
              <input 
                id="attendance-file-upload"
                type="file"
                accept=".dat,.txt,.csv,.log"
                disabled={isMonthLocked}
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Group Attendance Excel Upload Card */}
          <div className="pt-1">
            <label 
              htmlFor={isMonthLocked ? undefined : "group-attendance-excel-upload"}
              className={`flex flex-col items-center justify-center p-5 border-2 border-dashed rounded-2xl transition-all group text-center ${
                isMonthLocked
                  ? 'border-slate-800 bg-slate-900/30 opacity-50 cursor-not-allowed'
                  : 'border-emerald-500/40 hover:border-emerald-500 bg-emerald-950/10 hover:bg-emerald-950/20 cursor-pointer'
              }`}
            >
              <FileSpreadsheet className="h-7 w-7 text-emerald-500 group-hover:text-emerald-400 transition-all mb-2 animate-bounce" />
              <span className="text-xs font-black text-slate-200">بارگذاری فایل تردد گروهی از اکسل (XLSX)</span>
              <span className="text-[10px] text-slate-400 mt-1 leading-normal text-justify">
                ستون اول: نام پرسنل | ستون دوم: کد تردد | ستون‌های بعدی: ورود و خروج روزهای ۱ تا ۳۱ ماه
              </span>
              <input 
                id="group-attendance-excel-upload"
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={isMonthLocked}
                onChange={handleUploadGroupAttendanceExcel}
                className="hidden"
              />
            </label>
          </div>

          {/* Load indicators or summary */}
          {isDataLoaded && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">کل روز-کارکرد استخراج شده:</span>
                <span className="font-bold text-white font-mono">{toPersianDigits(records.length)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">تعداد ردیف‌های خطا:</span>
                <span className={`font-bold font-mono ${errorCount > 0 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}>
                  {toPersianDigits(errorCount)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">کد پرسنلی حضور و غیاب ناشناس:</span>
                <span className={`font-bold font-mono ${unregisteredCodes.length > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {toPersianDigits(unregisteredCodes.length)}
                </span>
              </div>
            </div>
          )}

          {/* Action Button: Clear period data */}
          <div className="pt-3 border-t border-slate-900">
            <button
              type="button"
              disabled={isMonthLocked}
              onClick={() => !isMonthLocked && setShowClearConfirm(true)}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl text-xs font-bold transition-all shadow-sm ${
                isMonthLocked
                  ? 'bg-slate-800 border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-rose-950/30 hover:bg-rose-900 border-rose-900/50 text-rose-300 hover:text-white cursor-pointer'
              }`}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              <span>پاک کردن تردد و عملکرد دوره</span>
            </button>
          </div>
        </div>

        {/* Step 2: Unregistered Personnel alerts and auto registration */}
        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-4 shadow-lg lg:col-span-2 flex flex-col justify-between">
          <div className="space-y-4">
            <h4 className="text-xs font-black text-amber-400 flex items-center gap-2 border-b border-slate-850 pb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              تطبیق‌دهنده کد پرسنلی حضور و غیاب و ثبت «نامشخص»
            </h4>

            {unregisteredCodes.length > 0 ? (
              <div className="space-y-3">
                <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 flex gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="text-xs font-black text-amber-300 block">شناسایی کدهای تردد نامشخص و تعریف‌نشده در پایگاه پرسنلی</span>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      کدهای پرسنلی حضور و غیاب زیر در لیست پرسنل شما تعریف نشده‌اند. طبق قواعد سیستمی، می‌توانید این کدها را به پرسنل موجود انتصاب دهید یا به صورت خودکار ثبت نامشخص کنید.
                    </p>
                  </div>
                </div>

                <div className="max-h-[180px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {unregisteredCodes.map(code => {
                    const selectedPId = selectedPersonnelMap[code] || '';
                    return (
                      <div key={code} className="bg-slate-900 border border-slate-850 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-white bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded-lg font-mono">
                            کد {toPersianDigits(code)}
                          </span>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 md:w-2/3">
                          <div className="flex-1">
                            <select
                              value={selectedPId}
                              disabled={isMonthLocked}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedPersonnelMap(prev => ({
                                  ...prev,
                                  [code]: val
                                }));
                              }}
                              className={`w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 font-sans ${isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              <option value="">--- انتخاب پرسنل از پرونده پرسنلی دوره فعال (مرتب بر اساس کد تردد) ---</option>
                              {matcherPersonnelList.length === 0 ? (
                                <option value="" disabled>هیچ پرسنلی در پرونده پرسنلی این دوره تعریف نشده است</option>
                              ) : (
                                matcherPersonnelList.map(p => {
                                  const fullName = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'بدون نام';
                                  const rawAtt = getEmpAttCode(p);
                                  const attCodeLabel = rawAtt ? `کد تردد: ${toPersianDigits(rawAtt)}` : 'فاقد کد تردد';
                                  const empCodeLabel = p.employeeCode ? `کد پرسنلی: ${toPersianDigits(p.employeeCode)}` : '';
                                  return (
                                    <option key={p.id} value={p.id}>
                                      {attCodeLabel} — {fullName}{empCodeLabel ? ` [${empCodeLabel}]` : ''}
                                    </option>
                                  );
                                })
                              )}
                            </select>
                          </div>

                          <button
                            type="button"
                            disabled={!selectedPId || isMonthLocked}
                            onClick={() => {
                              if (!isMonthLocked && selectedPId) {
                                handleAssignCodeToPersonnel(code, selectedPId);
                              }
                            }}
                            className={`w-full py-1.5 px-3 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 ${
                              selectedPId && !isMonthLocked
                                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 font-extrabold shadow-md shadow-amber-500/10 cursor-pointer'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-850'
                            }`}
                          >
                            <Save className="h-3.5 w-3.5" />
                            ذخیره و ثبت در پرونده پرسنلی
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center flex flex-col items-center justify-center space-y-2">
                <CheckCircle className="h-10 w-10 text-emerald-500" />
                <span className="text-xs font-black text-slate-200">وضعیت تطبیق کدهای حضور و غیاب عالی است!</span>
                <p className="text-[11px] text-slate-400 max-w-md leading-relaxed">
                  تمامی ترددهای ثبت‌شده در فایل با کدهای پرسنلی تطابق دارند یا پرسنل ناشناس از قبل تعریف و برچسب‌گذاری شده‌اند.
                </p>
              </div>
            )}
          </div>

          {unregisteredCodes.length > 0 && (
            <button
              type="button"
              disabled={isMonthLocked}
              onClick={handleAutoRegisterUnknowns}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold shadow-lg transition-all ${
                isMonthLocked
                  ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed shadow-none'
                  : 'bg-amber-600 hover:bg-amber-500 text-white cursor-pointer'
              }`}
            >
              <Users className="h-4 w-4" />
              تعریف و ثبت خودکار کدهای ناشناس بالا به عنوان پرسنل {`{نامشخص}`} در سیستم
            </button>
          )}
        </div>
      </div>
      )}

      {/* Tab: Shift & Attendance Mismatch Report */}
      {activeTab === 'mismatches' && isDataLoaded && (
        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-6 shadow-xl animate-fadeIn" id="shift-attendance-mismatches">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 border-b border-slate-850 pb-4">
            <div className="space-y-1 text-right w-full xl:w-auto">
              <div className="flex flex-wrap items-center gap-2.5 justify-start">
                <AlertTriangle className="h-5 w-5 text-amber-500 animate-pulse" />
                <h4 className="text-sm font-black text-white">سامانه هوشمند پایش و اصلاح عدم تطابق شیفت و تردد</h4>
              </div>
              <p className="text-xs text-slate-400">
                مشاهده و تصحیح مغایرت‌های ورود و خروج پرسنل با شیفت‌های تعریف شده در دوره محاسباتی جاری ({monthsList.find(m => m.value === selectedMonth)?.label} {toPersianDigits(selectedYear)})
              </p>
            </div>

            {/* Filter Selector & Smart Actions */}
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full xl:w-auto" dir="rtl">
              <button
                type="button"
                disabled={isMonthLocked}
                onClick={handleRunSmartShiftDiagnostic}
                className={`px-3.5 py-1.5 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all border ${
                  isMonthLocked
                    ? 'bg-slate-800 text-slate-500 border-slate-800 cursor-not-allowed'
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 cursor-pointer border-amber-400/40'
                }`}
                title="پایش اتوماتیک ترددهای پرسنل و پیشنهاد شیفت متناظر مجاز جهت رفع مغایرت"
              >
                <Sparkles className="h-4 w-4" />
                <span>✨ پایش و اصلاح هوشمند خودکار شیفت‌ها</span>
              </button>



              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap">تفکیک پرسنل:</label>
                <select
                  value={mismatchEmployeeFilter}
                  onChange={(e) => setMismatchEmployeeFilter(e.target.value)}
                  className="w-full sm:w-64 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500 font-sans cursor-pointer transition-all"
                >
                  <option value="all">همه پرسنل</option>
                  {(() => {
                    const activeByEmp = new Map<string, number>();
                    const anomalyByEmp = new Map<string, number>();
                    const approvedByEmp = new Map<string, number>();

                    for (let i = 0; i < activeMismatchesUnfiltered.length; i++) {
                      const empId = activeMismatchesUnfiltered[i].employee.id;
                      activeByEmp.set(empId, (activeByEmp.get(empId) || 0) + 1);
                    }
                    for (let i = 0; i < activeAnomaliesUnfiltered.length; i++) {
                      const empId = activeAnomaliesUnfiltered[i].employee.id;
                      anomalyByEmp.set(empId, (anomalyByEmp.get(empId) || 0) + 1);
                    }
                    for (let i = 0; i < approvedMismatchItems.length; i++) {
                      const empId = approvedMismatchItems[i].employee.id;
                      approvedByEmp.set(empId, (approvedByEmp.get(empId) || 0) + 1);
                    }

                    const empCandidates = new Map<string, Personnel>();
                    activePeriodPersonnel.forEach(p => empCandidates.set(p.id, p));
                    approvedMismatchItems.forEach(a => {
                      if (a.employee?.id && !empCandidates.has(a.employee.id)) {
                        empCandidates.set(a.employee.id, a.employee);
                      }
                    });

                    return Array.from(empCandidates.values())
                      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'fa'))
                      .map(emp => {
                        const activeCount = activeByEmp.get(emp.id) || 0;
                        const anomalyCount = anomalyByEmp.get(emp.id) || 0;
                        const approvedCount = approvedByEmp.get(emp.id) || 0;
                        if (activeCount === 0 && anomalyCount === 0 && approvedCount === 0) return null;

                        const parts: string[] = [];
                        if (activeCount > 0) parts.push(`${toPersianDigits(activeCount)} عدم تطابق`);
                        if (anomalyCount > 0) parts.push(`${toPersianDigits(anomalyCount)} بدون شیفت/تاخیر/غیرمجاز`);
                        if (approvedCount > 0) parts.push(`${toPersianDigits(approvedCount)} تایید شده`);

                        return (
                          <option key={emp.id} value={emp.id}>
                            {emp.fullName} ({toPersianDigits(emp.attendanceCode || emp.employeeCode)}) - {parts.join(' | ')}
                          </option>
                        );
                      });
                  })()}
                </select>
              </div>
            </div>
          </div>

          {/* Sub-Section Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-2 rounded-2xl border border-slate-850" dir="rtl">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMismatchViewMode('active')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                  mismatchViewMode === 'active'
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>عدم تطابق شیفت و تردد</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono ${
                  mismatchViewMode === 'active' ? 'bg-slate-950/20 text-slate-950' : 'bg-amber-500/15 text-amber-400'
                }`}>
                  {toPersianDigits(activeMismatchesUnfiltered.filter(m => mismatchEmployeeFilter === 'all' || m.employee.id === mismatchEmployeeFilter).length)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMismatchViewMode('anomalies')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                  mismatchViewMode === 'anomalies'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                    : 'bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>تردد بدون شیفت / تاخیر و غیرمجاز (&gt; ۲ ساعت)</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono ${
                  mismatchViewMode === 'anomalies' ? 'bg-white/20 text-white' : 'bg-rose-500/15 text-rose-400'
                }`}>
                  {toPersianDigits(activeAnomaliesUnfiltered.filter(a => mismatchEmployeeFilter === 'all' || a.employee.id === mismatchEmployeeFilter).length)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMismatchViewMode('approved')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                  mismatchViewMode === 'approved'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                    : 'bg-slate-900/80 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <CheckCircle className="h-3.5 w-3.5" />
                <span>مغایرت‌های تایید شده</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono ${
                  mismatchViewMode === 'approved' ? 'bg-white/20 text-white' : 'bg-emerald-500/15 text-emerald-400'
                }`}>
                  {toPersianDigits(filteredApprovedItems.length)}
                </span>
              </button>
            </div>

            {mismatchViewMode === 'anomalies' && (() => {
              const empScoped = activeAnomaliesUnfiltered.filter(a => mismatchEmployeeFilter === 'all' || a.employee.id === mismatchEmployeeFilter);
              const noShiftCnt = empScoped.filter(a => a.isNoShift).length;
              const delayCnt = empScoped.filter(a => a.hasExcessiveDelay).length;
              const unauthCnt = empScoped.filter(a => a.hasExcessiveUnauthorized).length;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAnomalyTypeFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      anomalyTypeFilter === 'all' ? 'bg-slate-200 text-slate-950' : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    همه ({toPersianDigits(empScoped.length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnomalyTypeFilter('no_shift')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      anomalyTypeFilter === 'no_shift' ? 'bg-amber-500 text-slate-950' : 'bg-slate-950 text-amber-400 hover:bg-amber-500/10 border border-amber-500/20'
                    }`}
                  >
                    بدون شیفت ({toPersianDigits(noShiftCnt)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnomalyTypeFilter('delay_2h')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      anomalyTypeFilter === 'delay_2h' ? 'bg-rose-500 text-white' : 'bg-slate-950 text-rose-400 hover:bg-rose-500/10 border border-rose-500/20'
                    }`}
                  >
                    تاخیر &gt; ۲ ساعت ({toPersianDigits(delayCnt)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnomalyTypeFilter('unauthorized_2h')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      anomalyTypeFilter === 'unauthorized_2h' ? 'bg-purple-500 text-white' : 'bg-slate-950 text-purple-400 hover:bg-purple-500/10 border border-purple-500/20'
                    }`}
                  >
                    غیرمجاز &gt; ۲ ساعت ({toPersianDigits(unauthCnt)})
                  </button>
                </div>
              );
            })()}
          </div>

          {(() => {
            const currentRows = mismatchViewMode === 'active'
              ? filteredMismatches
              : mismatchViewMode === 'anomalies'
                ? filteredAnomalies
                : filteredApprovedItems;

            const emptyHeading = mismatchViewMode === 'active'
              ? 'هیچ عدم تطابق فعالی در این بخش یافت نشد!'
              : mismatchViewMode === 'anomalies'
                ? 'هیچ تردد بدون شیفت، تاخیر یا ساعت غیرمجاز بیش از ۲ ساعت یافت نشد!'
                : 'هیچ مغایرت تاییدشده‌ای برای فیلتر انتخابی ثبت نشده است!';

            const emptyDesc = mismatchViewMode === 'active'
              ? 'تمام ترددهای بررسی‌نشده با شیفت اختصاصی تعریف شده تطابق بهینه دارند یا قبلاً تایید شده‌اند.'
              : mismatchViewMode === 'anomalies'
                ? 'تمامی ترددهای دارای شیفت و یا کمتر از ۲ ساعت تاخیر/ساعت غیرمجاز هستند.'
                : 'مواردی که با دکمه «تایید مغایرت» یا «اصلاح هوشمند» تایید شوند، برای بررسی و اصلاح مجدد در این بخش نمایش داده می‌شوند.';

            return (
              <>
                {/* Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" dir="rtl">
                  <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl shrink-0 ${
                      mismatchViewMode === 'approved' ? 'bg-emerald-500/10 text-emerald-400' : mismatchViewMode === 'anomalies' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-500'
                    }`}>
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <span className="text-[10px] text-slate-400 font-bold block">
                        {mismatchViewMode === 'active'
                          ? 'موارد عدم تطابق فعال'
                          : mismatchViewMode === 'anomalies'
                            ? 'تردد بدون شیفت / تاخیر و غیرمجاز (> ۲ ساعت)'
                            : 'مغایرت‌های تایید شده قابل بازبینی'}
                      </span>
                      <span className={`text-sm font-black font-mono block ${
                        mismatchViewMode === 'approved' ? 'text-emerald-400' : mismatchViewMode === 'anomalies' ? 'text-rose-400' : 'text-amber-400'
                      }`}>
                        {toPersianDigits(currentRows.length)} مورد
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3">
                    <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl shrink-0">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <span className="text-[10px] text-slate-400 font-bold block">تعداد پرسنل در این فهرست</span>
                      <span className="text-sm font-black text-rose-400 font-mono block">
                        {toPersianDigits(new Set(currentRows.map(m => m.employee.id)).size)} نفر از پرسنل
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl shrink-0">
                      <CheckCircle className="h-5 w-5" />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <span className="text-[10px] text-slate-400 font-bold block">وضعیت اصلاح و بازبینی</span>
                      <span className="text-sm font-black text-emerald-400 block">
                        {mismatchViewMode === 'approved' ? 'امکان اصلاح شیفت، تردد و لغو تایید فعال است' : 'آماده اصلاح آنلاین و همگام‌سازی لحظه‌ای'}
                      </span>
                    </div>
                  </div>
                </div>

                {currentRows.length === 0 ? (
                  <div className="bg-slate-900/30 border border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-3" dir="rtl">
                    <div className="mx-auto w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center">
                      <Check className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <h5 className="text-xs font-black text-slate-200">{emptyHeading}</h5>
                      <p className="text-[11px] text-slate-400">{emptyDesc}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4" dir="rtl">
                    <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950/40">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-850 text-right text-xs">
                          <thead className="bg-slate-900 text-slate-300 font-bold">
                            <tr>
                              <th className="px-4 py-3 text-right">پرسنل / کد حضور غیاب</th>
                              <th className="px-4 py-3 text-center">تاریخ و وضعیت تشخیص</th>
                              <th className="px-4 py-3 text-center">شیفت تعریف شده</th>
                              <th className="px-4 py-3 text-center">اولین ورود / آخرین خروج واقعی</th>
                              <th className="px-4 py-3 text-center">اختلاف / تاخیر / غیرمجاز</th>
                              <th className="px-4 py-3 text-center w-[350px]">عملیات پایش و اصلاح هوشمند مغایرت‌ها</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-850 bg-slate-950/20 text-slate-300">
                            {currentRows.map((mismatch, idx) => {
                              const recordKey = `${mismatch.employee.id}-${mismatch.dateStr}`;
                              const approvalScopeKey = mismatchViewMode === 'approved'
                                ? mismatch.approvalKey
                                : `${mismatchViewMode}-${recordKey}`;

                              return (
                                <tr key={`${approvalScopeKey}-${idx}`} className="hover:bg-slate-900/40 transition-colors">
                                  <td className="px-4 py-3 text-right">
                                    <div className="font-bold text-white">{mismatch.employee.fullName}</div>
                                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                      کد: {toPersianDigits(mismatch.employee.attendanceCode || mismatch.employee.employeeCode)}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="font-bold text-slate-200">
                                      روز {toPersianDigits(mismatch.dayNum)} {monthsList.find(m => m.value === selectedMonth)?.label}
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-sans mt-0.5">({mismatch.weekday})</div>
                                    <div className="flex flex-wrap justify-center gap-1 mt-1">
                                      {mismatchViewMode === 'approved' && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold">
                                          تایید شده
                                        </span>
                                      )}
                                      {mismatch.isNoShift && (
                                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[9px] font-bold">
                                          بدون شیفت
                                        </span>
                                      )}
                                      {mismatch.hasExcessiveDelay && (
                                        <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[9px] font-bold">
                                          تاخیر &gt; ۲ ساعت
                                        </span>
                                      )}
                                      {mismatch.hasExcessiveUnauthorized && (
                                        <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[9px] font-bold">
                                          غیرمجاز &gt; ۲ ساعت
                                        </span>
                                      )}
                                      {mismatch.isAlsoMismatch && mismatchViewMode === 'anomalies' && (
                                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 text-[9px] font-bold">
                                          عدم تطابق شیفت
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {(() => {
                                      const activeSecId = draftShifts[recordKey] !== undefined ? draftShifts[recordKey] : mismatch.currentSectionId;
                                      const activeSec = activeSecId === 'none' ? null : (db.productionSections || []).find(s => s.id === activeSecId);
                                      const activeShiftObj = activeSecId === 'none' ? null : (activeSec ? {
                                        name: activeSec.name,
                                        startTime: toEnglishDigits(activeSec.startTime || '').trim(),
                                        endTime: toEnglishDigits(activeSec.endTime || '').trim()
                                      } : ((db.productionSections || []).find(s => s.id === activeSecId) || mismatch.shift));

                                      return (
                                        <>
                                          <div className="font-bold text-white text-xs mb-0.5">
                                            {activeSecId === 'none' ? 'بدون شیفت' : (activeShiftObj?.name || 'شیفت تعریف شده')}
                                          </div>
                                          <div className="font-mono text-amber-400 font-bold">
                                            {activeSecId === 'none'
                                              ? '---'
                                              : `${toPersianDigits(activeShiftObj?.startTime || '')} الی ${toPersianDigits(activeShiftObj?.endTime || '')}`}
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="text-slate-300 font-mono">
                                      ورود: <span className="text-white font-bold">{mismatch.firstEntry ? toPersianDigits(mismatch.firstEntry) : '---'}</span>
                                    </div>
                                    <div className="text-slate-300 font-mono mt-0.5">
                                      خروج: <span className="text-white font-bold">{mismatch.lastExit ? toPersianDigits(mismatch.lastExit) : '---'}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    {(() => {
                                      const activeSecId = draftShifts[recordKey] !== undefined ? draftShifts[recordKey] : mismatch.currentSectionId;
                                      const activeSec = activeSecId === 'none' ? null : (db.productionSections || []).find(s => s.id === activeSecId);
                                      const activeShiftObj = activeSecId === 'none' ? null : (activeSec ? {
                                        startTime: toEnglishDigits(activeSec.startTime || '').trim(),
                                        endTime: toEnglishDigits(activeSec.endTime || '').trim()
                                      } : ((db.productionSections || []).find(s => s.id === activeSecId) || mismatch.shift));

                                      const hasPair = Boolean(mismatch.firstEntry && mismatch.lastExit);
                                      const activeResolved = activeShiftObj?.startTime && activeShiftObj?.endTime && hasPair
                                        ? resolveEntryExitTimesForShift([mismatch.firstEntry, mismatch.lastExit], activeShiftObj.startTime, activeShiftObj.endTime)
                                        : null;
                                      const calcEntryDiff = activeShiftObj?.startTime && hasPair
                                        ? getCircularMinutesDiff(activeResolved ? activeResolved.firstEntryMins : timeToMinutes(mismatch.firstEntry), activeResolved ? activeResolved.shiftStartMins : timeToMinutes(toEnglishDigits(activeShiftObj.startTime).trim()))
                                        : (activeSecId === 'none' ? null : mismatch.entryDiff);
                                      const calcExitDiff = activeShiftObj?.endTime && hasPair
                                        ? getCircularMinutesDiff(activeResolved ? activeResolved.lastExitMins : timeToMinutes(mismatch.lastExit), activeResolved ? activeResolved.shiftEndMins : timeToMinutes(toEnglishDigits(activeShiftObj.endTime).trim()))
                                        : (activeSecId === 'none' ? null : mismatch.exitDiff);

                                      let liveDelayMin = mismatch.delayMin || 0;
                                      let liveUnauthMin = mismatch.unauthorizedPresenceMin || 0;
                                      if (activeSecId === 'none') {
                                        liveDelayMin = 0;
                                        liveUnauthMin = 0;
                                      } else if (activeResolved) {
                                        const rRules = periodRules;
                                        const cEarly = rRules.calculateEarlyOvertime ?? true;
                                        const cLate = rRules.calculateLateOvertime ?? true;
                                        liveDelayMin = activeResolved.firstEntryMins > activeResolved.shiftStartMins ? activeResolved.firstEntryMins - activeResolved.shiftStartMins : 0;
                                        const eOt = activeResolved.firstEntryMins < activeResolved.shiftStartMins ? activeResolved.shiftStartMins - activeResolved.firstEntryMins : 0;
                                        const lOt = (activeResolved.shiftEndMins && activeResolved.lastExitMins > activeResolved.shiftEndMins) ? activeResolved.lastExitMins - activeResolved.shiftEndMins : 0;
                                        liveUnauthMin = (cEarly ? 0 : eOt) + (cLate ? 0 : lOt);
                                      }

                                      const fmtHM = (m: number) => toPersianDigits(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

                                      return (
                                        <div className="space-y-0.5">
                                          <div className="text-rose-400 font-sans font-medium text-[11px]">
                                            اختلاف ورود: <span className="font-bold font-mono">{calcEntryDiff !== null && calcEntryDiff !== undefined ? fmtHM(calcEntryDiff) : '---'}</span>
                                          </div>
                                          <div className="text-rose-400 font-sans font-medium text-[11px]">
                                            اختلاف خروج: <span className="font-bold font-mono">{calcExitDiff !== null && calcExitDiff !== undefined ? fmtHM(calcExitDiff) : '---'}</span>
                                          </div>
                                          {liveDelayMin > 0 && (
                                            <div className={`font-sans font-medium text-[10.5px] ${liveDelayMin > 120 ? 'text-amber-300 font-bold' : 'text-slate-400'}`}>
                                              تاخیر: <span className="font-mono">{fmtHM(liveDelayMin)}</span>
                                            </div>
                                          )}
                                          {liveUnauthMin > 0 && (
                                            <div className={`font-sans font-medium text-[10.5px] ${liveUnauthMin > 120 ? 'text-purple-300 font-bold' : 'text-slate-400'}`}>
                                              غیرمجاز: <span className="font-mono">{fmtHM(liveUnauthMin)}</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="flex flex-col gap-2.5 items-stretch max-w-[340px] mx-auto text-right font-sans">
                                      
                                      {editingAttendanceId === recordKey ? (
                                        /* Inline Edit Attendance Block */
                                        <div className="bg-slate-900 border border-purple-500/30 p-2.5 rounded-xl space-y-2 text-right" dir="rtl">
                                          <span className="text-[10px] text-purple-400 font-extrabold block">اصلاح ساعت‌های ورود و خروج:</span>
                                          <div className="flex gap-2 items-center">
                                            <div className="flex-1">
                                              <span className="text-[9px] text-slate-400 block mb-0.5">ورود:</span>
                                              <input
                                                type="text"
                                                value={draftEntry}
                                                onChange={(e) => setDraftEntry(e.target.value)}
                                                placeholder="08:00"
                                                disabled={isMonthLocked}
                                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-1 text-xs font-mono text-center outline-none focus:border-purple-500"
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              disabled={isMonthLocked}
                                              onClick={() => {
                                                const temp = draftEntry;
                                                setDraftEntry(draftExit);
                                                setDraftExit(temp);
                                              }}
                                              className="mt-4 p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg cursor-pointer transition-colors"
                                              title="جایگزینی ورود و خروج"
                                            >
                                              <ArrowLeftRight className="h-3 w-3" />
                                            </button>
                                            <div className="flex-1">
                                              <span className="text-[9px] text-slate-400 block mb-0.5">خروج:</span>
                                              <input
                                                type="text"
                                                value={draftExit}
                                                onChange={(e) => setDraftExit(e.target.value)}
                                                placeholder="17:00"
                                                disabled={isMonthLocked}
                                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-lg p-1 text-xs font-mono text-center outline-none focus:border-purple-500"
                                              />
                                            </div>
                                          </div>
                                          <div className="flex gap-1.5 justify-center pt-1">
                                            <button
                                              type="button"
                                              disabled={isMonthLocked}
                                              onClick={() => handleSaveInlineAttendance(mismatch, draftEntry, draftExit)}
                                              className="text-[10px] font-bold bg-purple-600 hover:bg-purple-700 text-white p-1 px-2.5 rounded-md cursor-pointer transition-colors disabled:opacity-50"
                                            >
                                              ذخیره تردد
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setEditingAttendanceId(null)}
                                              className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 p-1 px-2.5 rounded-md cursor-pointer transition-colors"
                                            >
                                              انصراف
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        /* Main Actions Block */
                                        <>
                                          {/* Shift Dropdown strictly filtered by Capability Matrix */}
                                          <div className="flex items-center gap-1.5">
                                            {(() => {
                                              const empCapabilities = getAuthorizedCapabilitiesForEmployee(mismatch.employee);
                                              const authorizedSections = (db.productionSections || []).filter(sec => empCapabilities.includes(sec.id));
                                              const authorizedShifts = (shiftsList || []).filter(sh => !(db.productionSections || []).some(s => s.id === sh.id) && empCapabilities.includes(sh.id));
                                              return (
                                                <select
                                                  value={draftShifts[recordKey] !== undefined ? draftShifts[recordKey] : mismatch.currentSectionId}
                                                  disabled={isMonthLocked}
                                                  onChange={(e) => setDraftShifts({ ...draftShifts, [recordKey]: e.target.value })}
                                                  className={`flex-1 px-2 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 font-sans transition-all ${
                                                    isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                                                  }`}
                                                >
                                                  <option value="none">بدون شیفت</option>
                                                  {authorizedSections.map(sec => (
                                                    <option key={sec.id} value={sec.id}>
                                                      {sec.name} ({toPersianDigits(sec.startTime)} الی {toPersianDigits(sec.endTime)})
                                                    </option>
                                                  ))}
                                                  {authorizedShifts.map(sh => (
                                                    <option key={sh.id} value={sh.id}>
                                                      {sh.name} ({toPersianDigits(sh.startTime)} الی {toPersianDigits(sh.endTime)})
                                                    </option>
                                                  ))}
                                                </select>
                                              );
                                            })()}
                                          </div>

                                          {/* Action Buttons Row */}
                                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                                            {/* Save Shift Button */}
                                            <button
                                              type="button"
                                              disabled={isMonthLocked}
                                              onClick={() => {
                                                const selectedVal = draftShifts[recordKey] !== undefined ? draftShifts[recordKey] : mismatch.currentSectionId;
                                                handleUpdateShiftForDay(mismatch.employee, mismatch.weekday, selectedVal, mismatch.dateStr);
                                                
                                                const nextDrafts = { ...draftShifts };
                                                delete nextDrafts[recordKey];
                                                setDraftShifts(nextDrafts);
                                              }}
                                              className={`text-[10px] font-bold p-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                                                isMonthLocked
                                                  ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                                                  : 'bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-600 hover:text-white cursor-pointer'
                                              }`}
                                              title="ثبت شیفت جدید"
                                            >
                                              <Check className="h-3 w-3 text-emerald-500" />
                                              <span>ثبت شیفت</span>
                                            </button>

                                            {/* Revert to Base Shift Button */}
                                            <button
                                              type="button"
                                              onClick={() => handleRevertShiftToDefault(mismatch)}
                                              disabled={isMonthLocked}
                                              className={`text-[10px] font-bold p-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                                                isMonthLocked
                                                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800'
                                                  : 'bg-amber-600/10 border border-amber-500/20 text-amber-400 hover:bg-amber-600 hover:text-white cursor-pointer'
                                              }`}
                                              title="بازگشت به شیفت پایه تعریف شده در الگوی سیستم"
                                            >
                                              <RotateCcw className="h-3 w-3 text-amber-500" />
                                              <span>↺ شیفت پایه</span>
                                            </button>

                                            {/* Approve or Unapprove Button */}
                                            {mismatchViewMode === 'approved' ? (
                                              <button
                                                type="button"
                                                disabled={isMonthLocked}
                                                onClick={() => handleUnapproveMismatch(mismatch)}
                                                className={`text-[10px] font-bold p-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                                                  isMonthLocked
                                                    ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                                                    : 'bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white cursor-pointer'
                                                }`}
                                                title="لغو تایید و بازگرداندن به لیست مغایرت‌ها"
                                              >
                                                <X className="h-3 w-3 text-rose-500" />
                                                <span>لغو تایید</span>
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                disabled={isMonthLocked}
                                                onClick={() => handleApproveMismatch(mismatch, mismatchViewMode === 'anomalies' ? 'anomaly' : 'mismatch')}
                                                className={`text-[10px] font-bold p-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                                                  isMonthLocked
                                                    ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                                                    : 'bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white cursor-pointer'
                                                }`}
                                                title="تایید و ثبت در فهرست مغایرت‌های تایید شده"
                                              >
                                                <CheckCircle className="h-3 w-3 text-blue-500" />
                                                <span>تایید مغایرت</span>
                                              </button>
                                            )}

                                            {/* Edit Attendance Button */}
                                            <button
                                              type="button"
                                              disabled={isMonthLocked}
                                              onClick={() => {
                                                setEditingAttendanceId(recordKey);
                                                setDraftEntry(mismatch.firstEntry || '');
                                                setDraftExit(mismatch.lastExit || '');
                                              }}
                                              className={`text-[10px] font-bold p-1.5 rounded-lg transition-all flex items-center justify-center gap-1 ${
                                                isMonthLocked
                                                  ? 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
                                                  : 'bg-purple-600/10 border border-purple-500/20 text-purple-400 hover:bg-purple-600 hover:text-white cursor-pointer'
                                              }`}
                                              title="اصلاح ساعت‌های تردد این روز"
                                            >
                                              <Edit3 className="h-3 w-3 text-purple-500" />
                                              <span>اصلاح تردد</span>
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Step 3: Personnel Monthly Performance Inspector */}
      {activeTab === 'performance' && isDataLoaded && inspectionDetails && (
        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-6 shadow-xl animate-fadeIn" id="monthly-performance-inspector">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-slate-850 pb-5">
            <div className="space-y-1 text-right">
              <div className="flex items-center gap-2.5">
                <Users className="h-5 w-5 text-rose-500 shrink-0" />
                <h4 className="text-base font-black text-white">سامانه هوشمند ارزیابی عملکرد ماهانه پرسنل</h4>
              </div>
              <p className="text-xs text-slate-400">
                مشاهده کارکرد روزانه، روزهای حضور و غیبت و جمع مدت حضور در ماه جاری ({monthsList.find(m => m.value === selectedMonth)?.label} {toPersianDigits(selectedYear)}) به تفکیک پرسنل
              </p>
            </div>

            {/* Personnel Selector & Dedicated Print Action Bar */}
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
              <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 py-2 px-3 rounded-xl text-xs font-bold text-slate-300">
                <span className="text-slate-400">دوره محاسباتی:</span>
                <span className="font-mono text-rose-400 font-extrabold">{monthsList.find(m => m.value === selectedMonth)?.label} {toPersianDigits(selectedYear)}</span>
              </div>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                <label className="text-xs font-bold text-slate-300 whitespace-nowrap">انتخاب پرسنل:</label>
                <select
                  value={inspectEmployeeId}
                  onChange={(e) => setInspectEmployeeId(e.target.value)}
                  className="bg-transparent text-xs text-white focus:outline-none font-sans cursor-pointer min-w-[190px]"
                >
                  {personnelWithCirculation.length > 0 && (
                    <optgroup label="دارای گردش (کارکرد در این ماه)">
                      {personnelWithCirculation.map(p => {
                        const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'نامشخص';
                        const code = p.attendanceCode ? ` (کد تردد: ${toPersianDigits(p.attendanceCode)})` : '';
                        return (
                          <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                            {name} {code}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  {personnelWithoutCirculation.length > 0 && (
                    <optgroup label="بدون گردش (بدون کارکرد در این ماه)">
                      {personnelWithoutCirculation.map(p => {
                        const name = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'نامشخص';
                        const code = p.attendanceCode ? ` (کد تردد: ${toPersianDigits(p.attendanceCode)})` : '';
                        return (
                          <option key={p.id} value={p.id} className="bg-slate-900 text-white">
                            {name} {code}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>

              <button
                type="button"
                onClick={handlePrintPersonnelPerformance}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-600/30 cursor-pointer transition-all border border-rose-500/60 shrink-0"
                title="چاپ رسمی کارنامه تفصیلی عملکرد ماهانه این پرسنل در یک برگه A4 با مصرف حداقل کارتریج"
              >
                <Printer className="h-4 w-4" />
                <span>چاپ کارنامه عملکرد (A4 تک‌صفحه)</span>
              </button>
            </div>
          </div>

          {/* Performance Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
            {/* Mismatch Status Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`p-2.5 ${(inspectionDetails.shiftMismatches || []).length > 0 ? 'bg-amber-500/10 text-amber-500 animate-pulse' : 'bg-emerald-500/10 text-emerald-500'} rounded-xl shrink-0`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="وضعیت تطابق شیفت و تردد">وضعیت تطابق شیفت و تردد</span>
                  <span className={`text-xs font-black block whitespace-nowrap ${(inspectionDetails.shiftMismatches || []).length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {(inspectionDetails.shiftMismatches || []).length > 0 
                      ? `دارای ${toPersianDigits((inspectionDetails.shiftMismatches || []).length)} مورد مغایرت فعال`
                      : 'کاملاً منطبق و بدون مغایرت'
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Total Duration Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع حضور در ماه">جمع حضور در ماه</span>
                  <span className="text-xs font-black text-white font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalWorkedMinutes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Normal Work Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl shrink-0">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع کارکرد عادی ماه">جمع کارکرد عادی ماه</span>
                  <span className="text-xs font-black text-emerald-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalNormalWorkMinutes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Present Days Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-500 rounded-xl shrink-0">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="روزهای حضور">روزهای حضور</span>
                  <span className="text-xs font-black text-emerald-400 font-mono block whitespace-nowrap">
                    {toPersianDigits(inspectionDetails.presentDaysCount)} روز
                  </span>
                </div>
              </div>
            </div>

            {/* Absent Days Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl shrink-0">
                  <X className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="روزهای غیبت">روزهای غیبت</span>
                  <span className="text-xs font-black text-rose-400 font-mono block whitespace-nowrap">
                    {toPersianDigits(inspectionDetails.absentDaysCount)} روز
                  </span>
                </div>
              </div>
            </div>

            {/* Total Delay Card (Normal) */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-amber-500/10 text-amber-500 rounded-xl shrink-0">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="تاخیر روز عادی">تاخیر روز عادی</span>
                  <span className="text-xs font-black text-amber-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalDelayMinutesNormal || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Delay Card (Friday) */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl shrink-0">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="تاخیر جمعه کاری">تاخیر جمعه کاری</span>
                  <span className="text-xs font-black text-rose-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalDelayMinutesFriday || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Delay Card (Holiday) */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-red-500/10 text-red-500 rounded-xl shrink-0">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="تاخیر تعطیل کاری">تاخیر تعطیل کاری</span>
                  <span className="text-xs font-black text-red-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalDelayMinutesHoliday || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Early Overtime Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-sky-500/10 text-sky-500 rounded-xl shrink-0">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="اضافه کار اول وقت">اضافه کار اول وقت</span>
                  <span className="text-xs font-black text-sky-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalEarlyOvertimeMinutes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Late Overtime Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-sky-500/10 text-sky-500 rounded-xl shrink-0">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="اضافه کار آخر وقت">اضافه کار آخر وقت</span>
                  <span className="text-xs font-black text-sky-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalLateOvertimeMinutes)}
                  </span>
                </div>
              </div>
            </div>



            {/* Total Friday Work Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-purple-500/10 text-purple-500 rounded-xl shrink-0">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع جمعه کاری ماه">جمع جمعه کاری ماه</span>
                  <span className="text-xs font-black text-purple-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalFridayWorkMinutes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Holiday Work Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-purple-500/10 text-purple-500 rounded-xl shrink-0">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع تعطیل کاری ماه">جمع تعطیل کاری ماه</span>
                  <span className="text-xs font-black text-purple-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalHolidayWorkMinutes)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Break Time Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع استراحت روزهای ماه">جمع استراحت ماه</span>
                  <span className="text-xs font-black text-amber-300 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalBreakMinutes || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Unauthorized Presence Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl shrink-0">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="جمع ساعت غیر مجاز حضور">ساعت غیر مجاز حضور</span>
                  <span className="text-xs font-black text-rose-300 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalUnauthorizedPresenceMinutes || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Net Presence Duration Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="خالص مدت حضور (مبنای مدت عادی کارنامه)">خالص مدت حضور ماه</span>
                  <span className="text-xs font-black text-sky-300 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalNetWorkedMinutes || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Mandatory Overtime Card */}
            <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 flex items-center gap-3 justify-between min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl shrink-0">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="space-y-0.5 text-right min-w-0">
                  <span className="text-[10px] text-slate-400 font-bold block truncate" title="اضافه کار موظفی روزانه">اضافه کار موظفی</span>
                  <span className="text-xs font-black text-sky-400 font-mono block whitespace-nowrap">
                    {formatMinutesToHoursAndMinutes(inspectionDetails.totalMandatoryOvertimeMinutes || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Final Performance Calculations Strip (کارنامه عملکرد نهایی) */}
          <div className="bg-slate-900/80 border border-sky-850/60 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-sky-400" />
                <h5 className="text-xs font-black text-sky-200">
                  خلاصه کارنامه عملکرد نهایی پرسنل (بر اساس شروط تهاتر و کارکرد مصوب دوره)
                </h5>
              </div>
              <span className="text-[10px] text-slate-400">
                ساعت موظفی دوره: <strong className="text-white font-mono">{formatMinutesToHoursAndMinutes(inspectionDetails.requiredMinutes)}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* 1. روزهای کارکرد */}
              <div className="bg-slate-950/70 border border-sky-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-sky-300 font-bold block">روزهای کارکرد</span>
                <span className="text-base font-black text-white font-mono block">
                  {toPersianDigits(inspectionDetails.finalDaysWorked)} <span className="text-[10px] font-normal text-slate-400">روز</span>
                </span>
                <span className="text-[9px] text-slate-500 block truncate" title="تقسیم بر ۸ ساعت با رندینگ اعشاری">رندینگ کارکرد نهایی / ۸</span>
              </div>

              {/* 2. ساعت کارکرد نهایی */}
              <div className="bg-slate-950/70 border border-rose-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-rose-300 font-bold block">ساعت کارکرد نهایی</span>
                <span className="text-base font-black text-rose-400 font-mono block">
                  {formatMinutesToHoursAndMinutes(inspectionDetails.finalWorkedMinutes)}
                </span>
                <span className="text-[9px] text-slate-500 block truncate" title="تکمیل تا سقف موظفی">سقف موظفی مصوب</span>
              </div>

              {/* 3. اضافه کار نهایی */}
              <div className="bg-slate-950/70 border border-emerald-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-emerald-300 font-bold block">اضافه کار نهایی</span>
                <span className="text-base font-black text-emerald-400 font-mono block">
                  {formatMinutesToHoursAndMinutes(inspectionDetails.finalOtMinutes)}
                </span>
                <span className="text-[9px] text-slate-500 block truncate" title="پس از تهاتر کسری موظفی">مازاد تهاتر شده</span>
              </div>

              {/* 4. جمعه کاری نهایی */}
              <div className="bg-slate-950/70 border border-indigo-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-indigo-300 font-bold block">جمعه کاری نهایی</span>
                <span className="text-base font-black text-indigo-400 font-mono block">
                  {formatMinutesToHoursAndMinutes(inspectionDetails.finalFridayMinutes)}
                </span>
                <span className="text-[9px] text-slate-500 block truncate">کارکرد خالص جمعه</span>
              </div>

              {/* 5. تعطیل کاری نهایی */}
              <div className="bg-slate-950/70 border border-purple-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-purple-300 font-bold block">تعطیل کاری نهایی</span>
                <span className="text-base font-black text-purple-400 font-mono block">
                  {formatMinutesToHoursAndMinutes(inspectionDetails.finalHolidayMinutes)}
                </span>
                <span className="text-[9px] text-slate-500 block truncate" title="پس از تهاتر کسری موظفی">باقیمانده تعطیل‌کاری</span>
              </div>

              {/* 6. مانده مرخصی دوره */}
              <div className="bg-slate-950/70 border border-teal-500/30 rounded-xl p-3 text-right space-y-1">
                <span className="text-[10px] text-teal-300 font-bold block">مانده مرخصی دوره</span>
                <span className="text-base font-black text-teal-400 font-mono block">
                  {formatMinutesToHoursAndMinutes(inspectionDetails.remainingLeaveMinutes)}
                </span>
                <span className="text-[9px] text-slate-500 block truncate" title="مرخصی مصرف‌نشده دوره">
                  {inspectionDetails.isDepartedNoLeavePad
                    ? 'ترک کار — محفوظ جهت تسویه حساب'
                    : 'مانده قابل انتقال'}
                </span>
              </div>
            </div>
          </div>

          {/* Daily grid container */}
          <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950/40">
            {/* Table Header Action Bar */}
            <div className="bg-slate-900/90 border-b border-slate-850 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-rose-500" />
                <span className="text-xs font-black text-white">
                  جدول تفصیلی تردد و کارکرد روزانه: <span className="text-rose-400 font-extrabold">{inspectionDetails.employee.fullName || `${inspectionDetails.employee.firstName} ${inspectionDetails.employee.lastName || ''}`}</span>
                </span>
                <span className="text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded-md font-mono border border-slate-800">
                  کد: {toPersianDigits(inspectionDetails.employee.attendanceCode || inspectionDetails.employee.employeeCode || '-')}
                </span>
              </div>
              <button
                type="button"
                onClick={handlePrintPersonnelPerformance}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white rounded-xl text-xs font-black shadow-md shadow-rose-600/25 cursor-pointer transition-all border border-rose-500/40"
                title="چاپ رسمی کارنامه تفصیلی عملکرد ماهانه این پرسنل در یک برگه A4"
              >
                <Printer className="h-4 w-4" />
                <span>چاپ کارنامه عملکرد (A4 تک‌صفحه)</span>
              </button>
            </div>
            <div className="max-h-[450px] overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-850 text-right text-xs">
                <thead className="bg-slate-900 text-slate-300 font-bold sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-right w-[8%]">روز ماه</th>
                    <th className="px-4 py-3 text-center w-[8%]">نام روز هفته</th>
                    <th className="px-4 py-3 text-center w-[11%]">شیفت کاری (تعریف شده)</th>
                    <th className="px-4 py-3 text-center w-[13%]">ساعات تردد ثبت‌شده</th>
                    <th className="px-4 py-3 text-center w-[6%]">وضعیت حضور</th>
                    <th className="px-4 py-3 text-center w-[7%]">مدت حضور</th>
                    <th className="px-4 py-3 text-center w-[7%]">مدت استراحت روز</th>
                    <th className="px-4 py-3 text-center w-[7%]">ساعت غیر مجاز حضور</th>
                    <th className="px-4 py-3 text-center w-[7%]">خالص مدت حضور</th>
                    <th className="px-4 py-3 text-center w-[8%]">مدت کارکرد عادی</th>
                    <th className="px-4 py-3 text-center w-[7%]">مدت جمعه کاری</th>
                    <th className="px-4 py-3 text-center w-[7%]">مدت تعطیل کاری</th>
                    <th className="px-4 py-3 text-center w-[6%]">تاخیر روز عادی</th>
                    <th className="px-4 py-3 text-center w-[6%]">تاخیر جمعه کاری</th>
                    <th className="px-4 py-3 text-center w-[6%]">تاخیر تعطیل کاری</th>
                    <th className="px-4 py-3 text-center w-[7%]">اضافه کار اول وقت</th>
                    <th className="px-4 py-3 text-center w-[7%]">اضافه کار آخر وقت</th>
                    <th className="px-4 py-3 text-center w-[7%]">اضافه کار موظفی</th>
                    <th className="px-4 py-3 text-center w-[8%]">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {inspectionDetails.daysDetails.map((day) => {
                    const currentAssignment = getEmployeeShiftAssignmentForWeekday(inspectionDetails.employee, day.weekday, day.dateStr);
                    const isNoShift = !currentAssignment || currentAssignment.deptId === 'none' || currentAssignment.shiftId === 'none' || currentAssignment.isOnLeave;
                    const matchedSection = !isNoShift ? (db.productionSections || []).find(sec => sec.id === currentAssignment?.deptId || sec.departmentCategoryId === currentAssignment?.deptId) : null;
                    const matchedShiftObj = !isNoShift ? (shiftsList || []).find(sh => sh.id === currentAssignment?.shiftId || sh.id === currentAssignment?.deptId) : null;
                    const currentSectionId = isNoShift ? 'none' : (matchedSection ? matchedSection.id : (matchedShiftObj ? matchedShiftObj.id : (currentAssignment?.shiftId || currentAssignment?.deptId || 'none')));

                    return (
                      <tr key={day.dayNum} className={`hover:bg-slate-900/40 transition-colors ${!day.isPresent ? 'bg-rose-950/5' : ''}`}>
                        <td className="px-4 py-3 font-bold text-slate-200">
                          {toPersianDigits(day.dayNum)} {monthsList.find(m => m.value === selectedMonth)?.label}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-300 font-medium">
                          {day.weekday}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const empCapabilities = getAuthorizedCapabilitiesForEmployee(inspectionDetails.employee);
                            const authorizedSections = (db.productionSections || []).filter(sec => empCapabilities.includes(sec.id));
                            const authorizedShifts = (shiftsList || []).filter(sh => !(db.productionSections || []).some(s => s.id === sh.id) && empCapabilities.includes(sh.id));
                            return (
                              <select
                                value={currentSectionId}
                                disabled={isMonthLocked}
                                onChange={(e) => handleUpdateShiftForDay(inspectionDetails.employee, day.weekday, e.target.value, day.dateStr)}
                                className={`px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-200 focus:outline-none focus:border-rose-500 font-sans transition-all ${
                                  isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                                }`}
                              >
                                <option value="none">بدون شیفت</option>
                                {authorizedSections.map(sec => (
                                  <option key={sec.id} value={sec.id}>
                                    {sec.name} ({toPersianDigits(sec.startTime)} الی {toPersianDigits(sec.endTime)})
                                  </option>
                                ))}
                                {authorizedShifts.map(sh => (
                                  <option key={sh.id} value={sh.id}>
                                    {sh.name} ({toPersianDigits(sh.startTime)} الی {toPersianDigits(sh.endTime)})
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs">
                          {editingDayNum === day.dayNum ? (
                            <div className="flex items-center justify-center gap-1 inline-flex" onClick={(e) => e.stopPropagation()}>
                              <span className="text-[10px] text-slate-500">ورود:</span>
                              <input
                                type="text"
                                placeholder="۰۸:۰۰"
                                value={editingEntry}
                                onChange={(e) => setEditingEntry(e.target.value)}
                                className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-center text-white focus:outline-none focus:border-rose-500 font-bold"
                              />
                              <span className="text-[10px] text-slate-500 mr-1">خروج:</span>
                              <input
                                type="text"
                                placeholder="۱۶:۰۰"
                                value={editingExit}
                                onChange={(e) => setEditingExit(e.target.value)}
                                className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-center text-white focus:outline-none focus:border-rose-500 font-bold"
                              />
                            </div>
                          ) : day.isPresent ? (
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {day.times.map((t, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-slate-850 text-slate-200 rounded-lg border border-slate-750 text-[11px] font-bold">
                                  {toPersianDigits(t)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500 font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {day.isPresent ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10.5px] font-bold border border-emerald-500/10">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              حضور
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 text-[10.5px] font-bold border border-rose-500/10">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                              غیبت
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-slate-300">
                          {day.isPresent && day.workedMin > 0 ? (
                            <span className="text-[12px] bg-slate-850 text-slate-300 px-2 py-1 border border-slate-750 rounded-lg font-mono tracking-wider" title={formatMinutesToHoursAndMinutes(day.workedMin)}>
                              {toPersianDigits(formatMinutesToHM(day.workedMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-amber-300">
                          {day.isPresent && day.breakMin > 0 ? (
                            <span className="text-[12px] bg-amber-950/30 text-amber-300 px-2.5 py-1 border border-amber-900/40 rounded-lg font-mono tracking-wider" title={formatMinutesToHoursAndMinutes(day.breakMin)}>
                              {toPersianDigits(formatMinutesToHM(day.breakMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-rose-300">
                          {day.isPresent && day.unauthorizedPresenceMin > 0 ? (
                            <span className="text-[12px] bg-rose-950/30 text-rose-300 px-2.5 py-1 border border-rose-900/40 rounded-lg font-mono tracking-wider" title={formatMinutesToHoursAndMinutes(day.unauthorizedPresenceMin)}>
                              {toPersianDigits(formatMinutesToHM(day.unauthorizedPresenceMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-sky-300">
                          {day.isPresent && day.adjustedWorkedMin > 0 ? (
                            <span className="text-[12px] bg-sky-950/30 text-sky-300 px-2.5 py-1 border border-sky-900/40 rounded-lg font-mono tracking-wider" title={formatMinutesToHoursAndMinutes(day.adjustedWorkedMin)}>
                              {toPersianDigits(formatMinutesToHM(day.adjustedWorkedMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-emerald-400">
                          {day.isPresent && day.normalWorkMin > 0 ? (
                            <span className="text-[12px] bg-emerald-950/25 text-emerald-400 px-2.5 py-1 border border-emerald-900/30 rounded-lg font-mono tracking-wider" title={formatMinutesToHoursAndMinutes(day.normalWorkMin)}>
                              {toPersianDigits(formatMinutesToHM(day.normalWorkMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-purple-400">
                          {day.isPresent && day.fridayWorkMin > 0 ? (
                            <span className="bg-purple-950/25 text-purple-400 px-2.5 py-1 border border-purple-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.fridayWorkMin)}>
                              {toPersianDigits(formatMinutesToHM(day.fridayWorkMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-purple-400">
                          {day.isPresent && day.holidayWorkMin > 0 ? (
                            <span className="bg-purple-950/25 text-purple-400 px-2.5 py-1 border border-purple-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.holidayWorkMin)}>
                              {toPersianDigits(formatMinutesToHM(day.holidayWorkMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        {/* تاخیر روز عادی */}
                        <td className="px-4 py-3 text-center font-mono text-amber-500">
                          {day.isPresent && day.delayMinNormal > 0 ? (
                            <span className="bg-amber-950/25 text-amber-400 px-2 py-1 border border-amber-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.delayMinNormal)}>
                              {toPersianDigits(formatMinutesToHM(day.delayMinNormal))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        {/* تاخیر جمعه کاری */}
                        <td className="px-4 py-3 text-center font-mono text-rose-500">
                          {day.isPresent && day.delayMinFriday > 0 ? (
                            <span className="bg-rose-950/25 text-rose-400 px-2 py-1 border border-rose-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.delayMinFriday)}>
                              {toPersianDigits(formatMinutesToHM(day.delayMinFriday))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        {/* تاخیر تعطیل کاری */}
                        <td className="px-4 py-3 text-center font-mono text-red-500">
                          {day.isPresent && day.delayMinHoliday > 0 ? (
                            <span className="bg-red-950/25 text-red-400 px-2 py-1 border border-red-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.delayMinHoliday)}>
                              {toPersianDigits(formatMinutesToHM(day.delayMinHoliday))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sky-400">
                          {day.isPresent && day.overtimeEarlyMin > 0 ? (
                            <span className="bg-sky-950/25 text-sky-400 px-2.5 py-1 border border-sky-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.overtimeEarlyMin)}>
                              {toPersianDigits(formatMinutesToHM(day.overtimeEarlyMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sky-400">
                          {day.isPresent && day.overtimeLateMin > 0 ? (
                            <span className="bg-sky-950/25 text-sky-400 px-2.5 py-1 border border-sky-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.overtimeLateMin)}>
                              {toPersianDigits(formatMinutesToHM(day.overtimeLateMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-sky-400">
                          {day.isPresent && day.overtimeMandatoryMin > 0 ? (
                            <span className="bg-sky-950/25 text-sky-400 px-2.5 py-1 border border-sky-900/30 rounded-lg text-[11px] font-bold" title={formatMinutesToHoursAndMinutes(day.overtimeMandatoryMin)}>
                              {toPersianDigits(formatMinutesToHM(day.overtimeMandatoryMin))}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {editingDayNum === day.dayNum ? (
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => {
                                  const dateStr = `${selectedYear}/${String(selectedMonth).padStart(2, '0')}/${String(day.dayNum).padStart(2, '0')}`;
                                  handleSaveDailyAttendanceCorrection(dateStr, editingEntry, editingExit, inspectionDetails.employee);
                                  setEditingDayNum(null);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-2.5 py-1 rounded-lg text-[10px] shadow-xs cursor-pointer transition-all border border-emerald-500/10"
                              >
                                ثبت
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingDayNum(null)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold px-2 py-1 rounded-lg text-[10px] cursor-pointer transition-all border border-slate-750"
                              >
                                انصراف
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isMonthLocked}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isMonthLocked) return;
                                setEditingDayNum(day.dayNum);
                                setEditingEntry(day.times[0] || '');
                                setEditingExit(day.times[1] || '');
                              }}
                              className={`font-extrabold px-2.5 py-1 rounded-lg text-[10px] shadow-xs transition-all border ${
                                isMonthLocked
                                  ? 'bg-slate-800 text-slate-500 border-slate-800 cursor-not-allowed'
                                  : 'bg-rose-600 hover:bg-rose-700 text-white cursor-pointer border-rose-500/10'
                              }`}
                            >
                              اصلاح تردد
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-900 border-t-2 border-slate-800 font-black text-slate-200">
                  <tr>
                    <td className="px-4 py-3.5 text-right text-xs font-black text-rose-400">جمع کل ماه:</td>
                    <td className="px-4 py-3.5"></td>
                    <td className="px-4 py-3.5"></td>
                    <td className="px-4 py-3.5"></td>
                    <td className="px-4 py-3.5"></td>
                    <td className="px-4 py-3.5 text-center text-[12px] text-slate-300 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalWorkedMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[12px] text-amber-300 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalBreakMinutes || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[12px] text-rose-300 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalUnauthorizedPresenceMinutes || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[12px] text-sky-300 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalNetWorkedMinutes || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[12px] text-emerald-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalNormalWorkMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-purple-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalFridayWorkMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-purple-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalHolidayWorkMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-amber-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalDelayMinutesNormal || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-rose-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalDelayMinutesFriday || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-red-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalDelayMinutesHoliday || 0))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-sky-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalEarlyOvertimeMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-sky-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalLateOvertimeMinutes))}
                    </td>
                    <td className="px-4 py-3.5 text-center text-[11.5px] text-sky-400 font-mono font-bold">
                      {toPersianDigits(formatMinutesToHM(inspectionDetails.totalMandatoryOvertimeMinutes || 0))}
                    </td>
                    <td className="px-4 py-3.5"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab filter and manual insertion bar */}
      {isDataLoaded && activeTab === 'records' && (
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col gap-4 shadow-md">
          {/* First Row: Filters & Search placed side-by-side */}
          <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
            <div className="flex flex-row flex-wrap items-center gap-2 flex-1">
              <button
                onClick={() => handleSetFilterType('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterType === 'all' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                همه رکوردهای ماه ({toPersianDigits(records.length)})
              </button>
              <button
                onClick={() => handleSetFilterType('errors')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  filterType === 'errors' ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                فقط دارای خطا ({toPersianDigits(errorCount)})
              </button>
              <button
                onClick={() => handleSetFilterType('valid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterType === 'valid' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                ترددهای معتبر ({toPersianDigits(records.length - errorCount)})
              </button>
              <button
                onClick={() => handleSetFilterType('unknown')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  filterType === 'unknown' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                پرسنل ناشناس ({toPersianDigits(records.filter(r => {
                  let matchedEmp: Personnel | undefined = r.attendanceCode ? findPersonnel(r.attendanceCode) : undefined;
                  if (!matchedEmp && r.employeeId) {
                    const empById = personnelLookup.byIdInPeriod.get(r.employeeId);
                    if (empById) {
                      const empAttTokens = splitAttCodes(getEmpAttCode(empById)).map(stripLeadingZeros);
                      const cleanRecCode = stripLeadingZeros(normalizeAttCode(r.attendanceCode));
                      if (!cleanRecCode || empAttTokens.includes(cleanRecCode)) {
                        matchedEmp = empById;
                      }
                    }
                  }
                  return !matchedEmp || isDummyUnknownPersonnel(matchedEmp);
                }).length)})
              </button>
            </div>

            {/* Personnel Search bar */}
            <div className="relative min-w-[200px] md:min-w-[260px]">
              <input
                type="text"
                value={personnelSearch}
                onChange={(e) => setPersonnelSearch(e.target.value)}
                placeholder="جستجوی نام پرسنل یا کد حضور..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 text-right font-medium"
              />
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            </div>
          </div>

          {/* Sub-Filters for Incomplete / Faulty Records (visible only when 'errors' is selected) */}
          {filterType === 'errors' && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-950/40 p-3 rounded-lg border border-slate-800/50 animate-fadeIn">
              <span className="text-slate-400 text-xs font-bold pl-2">تفکیک خطاهای تردد:</span>
              <button
                onClick={() => setErrorSubFilter('all')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                  errorSubFilter === 'all' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 font-black' : 'bg-slate-800/40 text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                همه خطاهای تردد ({toPersianDigits(errorCount)})
              </button>
              <button
                onClick={() => setErrorSubFilter('no_entry')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  errorSubFilter === 'no_entry' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 font-black' : 'bg-slate-800/40 text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                <AlertCircle className="h-3 w-3" />
                بدون ورود ({toPersianDigits(errorSubCounts.noEntry)})
              </button>
              <button
                onClick={() => setErrorSubFilter('no_exit')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  errorSubFilter === 'no_exit' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 font-black' : 'bg-slate-800/40 text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                <AlertCircle className="h-3 w-3" />
                بدون خروج ({toPersianDigits(errorSubCounts.noExit)})
              </button>
              <button
                onClick={() => setErrorSubFilter('extra')}
                className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                  errorSubFilter === 'extra' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 font-black' : 'bg-slate-800/40 text-slate-400 hover:text-white border border-transparent'
                }`}
              >
                <Plus className="h-3 w-3" />
                دارای تردد اضافی ({toPersianDigits(errorSubCounts.extra)})
              </button>
            </div>
          )}

          {/* Action Buttons Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-800 pt-3">
            <div className="text-[11px] text-slate-400 font-medium">
              تعداد ترددها با فیلتر فعلی: <span className="text-white font-extrabold">{toPersianDigits(filteredRecords.length)}</span> مورد
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <div className="flex items-center gap-1.5 border border-slate-800 bg-slate-950/70 rounded-lg px-2 py-1" title="انتخاب ساعت کاری یک بخش جهت محاسبه خودکار تردد ناقص پرسنل فاقد بخش اختصاصی">
                <span className="text-[10px] text-slate-400 font-bold">بخش محاسباتی (شیفت نامشخص):</span>
                <select
                  value={fallbackSectionId}
                  onChange={(e) => setFallbackSectionId(e.target.value)}
                  className="bg-transparent text-white text-[11px] font-bold outline-none border-none focus:ring-0 cursor-pointer p-0"
                >
                  {(db.productionSections || []).map(sec => (
                    <option key={sec.id} value={sec.id} className="bg-slate-900 text-white">
                      {sec.name} ({toPersianDigits(sec.startTime)} - {toPersianDigits(sec.endTime)})
                    </option>
                  ))}
                  {(db.productionSections || []).length === 0 && (
                    <option value="" className="bg-slate-900 text-white">هیچ بخشی تعریف نشده</option>
                  )}
                </select>
              </div>
              <button
                type="button"
                disabled={isMonthLocked}
                onClick={handleAutoCorrectSingleTimes}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isMonthLocked
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/10 cursor-pointer'
                }`}
                title="تکمیل خودکار ساعت ورود یا خروج ناقص پرسنل بر اساس برنامه شیفت کاری مصوب"
              >
                <Clock className="h-4 w-4 text-amber-200" />
                اصلاح خودکار بر اساس شیفت هفتگی
              </button>
              <button
                type="button"
                disabled={isMonthLocked}
                onClick={() => !isMonthLocked && setShowAddManualForm(!showAddManualForm)}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all ${
                  isMonthLocked
                    ? 'bg-slate-800 text-slate-500 border-slate-800 cursor-not-allowed'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700 cursor-pointer'
                }`}
              >
                <Plus className="h-4 w-4 text-rose-500" />
                ثبت دستی تردد روزانه جدید
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Insert Form */}
      {showAddManualForm && (
        <form onSubmit={handleAddRecordManually} className="bg-slate-950 p-6 rounded-2xl border border-rose-500/30 shadow-2xl space-y-5 animate-fade-in max-w-xl">
          <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
            <Plus className="h-5 w-5 text-rose-500" />
            <h4 className="text-sm font-black text-white">ثبت دستی یا مجزای تردد روزانه پرسنل</h4>
          </div>

          <div className="space-y-3">
            {/* Employee Selection */}
            <div className="space-y-1">
              <label className="text-[11px] text-slate-300 font-extrabold block">انتخاب نام پرسنل</label>
              <SearchableSelect
                value={manualEmployeeId}
                onChange={(val) => setManualEmployeeId(val)}
                options={personnelOptions}
                placeholder="برای جستجو و انتخاب پرسنل کلیک کنید..."
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Type of Manual Entry */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-300 font-extrabold block">نوع ثبت تردد</label>
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500 font-bold"
                >
                  <option value="both">ورود و خروج همزمان</option>
                  <option value="entry_only">ثبت ورود به تنهایی</option>
                  <option value="exit_only">ثبت خروج به تنهایی</option>
                </select>
              </div>

              {/* Day / Date */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-300 font-extrabold block">تاریخ یا روز (۱ تا ۳۱)</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: 15 یا 1402/05/15"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500 text-center font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Entry Time */}
              {(manualType === 'both' || manualType === 'entry_only') && (
                <div className="space-y-1 animate-fade-in">
                  <label className="text-[11px] text-slate-300 font-extrabold block">ساعت ورود (تراکنش اول)</label>
                  <input
                    type="text"
                    required={manualType === 'entry_only'}
                    placeholder="مثال: 07:30"
                    value={manualTime1}
                    onChange={(e) => setManualTime1(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500 text-center font-mono font-bold"
                  />
                </div>
              )}

              {/* Exit Time */}
              {(manualType === 'both' || manualType === 'exit_only') && (
                <div className="space-y-1 animate-fade-in">
                  <label className="text-[11px] text-slate-300 font-extrabold block">ساعت خروج (تراکنش دوم)</label>
                  <input
                    type="text"
                    required={manualType === 'exit_only'}
                    placeholder="مثال: 17:00"
                    value={manualTime2}
                    onChange={(e) => setManualTime2(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-rose-500 text-center font-mono font-bold"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-850">
            <button
              type="submit"
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-lg shadow-rose-600/15"
            >
              افزودن به جدول ترددها
            </button>
            <button
              type="button"
              onClick={() => setShowAddManualForm(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-350 hover:text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              انصراف
            </button>
          </div>
        </form>
      )}

      {/* Main Records Interactive Table */}
      {isDataLoaded && activeTab === 'records' ? (
        <div className="bg-slate-950/40 rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-right text-xs">
              <thead className="bg-gradient-to-l from-slate-900 via-slate-900 to-slate-950 text-slate-300 border-b border-slate-800">
                <tr>
                  <th className="px-2 py-3 font-extrabold text-right w-[13%] text-[11px] tracking-wide text-slate-400">پرسنل کارگاه / کارخانه</th>
                  <th className="px-1.5 py-3 font-extrabold text-center w-[8%] text-[11px] tracking-wide text-slate-400">کد حضور و غیاب</th>
                  <th className="px-1.5 py-3 font-extrabold text-center w-[11%] text-[11px] tracking-wide text-slate-400">تاریخ تردد (روز)</th>
                  <th className="px-2 py-3 font-extrabold text-center w-[44%] min-w-[300px] text-[11px] tracking-wide text-slate-400">ساعت‌های ثبت‌شده تردد (ورود / خروج)</th>
                  <th className="px-1.5 py-3 font-extrabold text-center w-[10%] text-[11px] tracking-wide text-slate-400">جمع مدت حضور</th>
                  <th className="px-1.5 py-3 font-extrabold text-center w-[14%] text-[11px] tracking-wide text-slate-400">وضعیت ترتیب / نوع خطا</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 bg-slate-950/20">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-xs font-bold">
                      هیچ موردی منطبق با فیلتر انتخابی شما یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => {
                    let matchedEmployee: Personnel | undefined = undefined;
                    if (rec.attendanceCode) {
                      matchedEmployee = findPersonnel(rec.attendanceCode);
                    }
                    if (!matchedEmployee && rec.employeeId) {
                      const empById = personnelLookup.byIdInPeriod.get(rec.employeeId);
                      if (empById) {
                        const empAttTokens = splitAttCodes(getEmpAttCode(empById)).map(stripLeadingZeros);
                        const cleanRecCode = stripLeadingZeros(normalizeAttCode(rec.attendanceCode));
                        if (!cleanRecCode || empAttTokens.includes(cleanRecCode)) {
                          matchedEmployee = empById;
                        }
                      }
                    }
                    const isUnknownName = !matchedEmployee || isDummyUnknownPersonnel(matchedEmployee);
                    
                    // Temporary input for adding a new time to this row
                    return (
                      <RecordRow 
                        key={rec.id}
                        rec={rec}
                        matchedEmployee={matchedEmployee}
                        isUnknownName={isUnknownName}
                        weekday={getPersianWeekdayOfDate(rec.date)}
                        isMonthLocked={!!isMonthLocked}
                        onTimeChange={handleTimeChange}
                        onAddTime={handleAddTime}
                        onDeleteTime={handleDeleteTime}
                        onToggleStatus={handleToggleStatus}
                        onPromoteTime={handlePromoteToMain}
                        onSwapEntryExit={handleSwapEntryExit}
                        onRevertSystemCorrection={handleRevertSystemCorrection}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Discrepancy Correction Report Modal */}
      {showReportsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-6 text-right max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-400 animate-pulse" />
                <h3 className="text-sm font-black text-white">گزارش هوشمند اصلاح خودکار و مغایرت‌های شیفت</h3>
              </div>
              <button
                onClick={handleCancelCorrections}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-1">
              <p>
                لیست زیر شامل پرسنلی است که در این دوره فقط دارای <strong>یک ثبت تردد تک‌ساعته ناقص</strong> بوده‌اند. سیستم به طور خودکار جهت ممانعت از تضییع حقوق پرسنل و کارفرما، ساعت مفقود ورود یا خروج آنها را با توجه به برنامه‌ریزی شیفت هفتگی و وضعیت مرخصی در آن روز، تکمیل نموده است.
              </p>
              <p className="text-emerald-400 font-bold">
                لطفاً جهت اعمال این اصلاحات پیشنهادی به جدول حضور و غیاب، روی دکمه «تأیید و اعمال اصلاحات هوشمند» در پایین کلیک کنید. در غیر این صورت روی دکمه «انصراف» کلیک کنید تا جدول بدون تغییر باقی بماند.
              </p>
              <p className="text-amber-400 font-normal">
                تذکر مهم: مغایرت‌های استخراج شده در زیر نمایانگر تاخیرهای واقعی ورود یا تعجیل‌های خروج پرسنل است که به منظور بازبینی و ارزیابی خطا در اختیار شما قرار می‌گیرد.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-950/50">
              <table className="min-w-full divide-y divide-slate-850 text-right text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold">
                  <tr>
                    <th className="px-4 py-2.5 text-center w-12">
                      <input 
                        type="checkbox"
                        disabled={isMonthLocked}
                        checked={approvedReportIds.length === correctionReports.length && correctionReports.length > 0}
                        onChange={(e) => {
                          if (isMonthLocked) return;
                          if (e.target.checked) {
                            setApprovedReportIds(correctionReports.map(r => r.id));
                          } else {
                            setApprovedReportIds([]);
                          }
                        }}
                        className={`h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500 ${isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        title="انتخاب / عدم انتخاب همه"
                      />
                    </th>
                    <th className="px-4 py-2.5">نام پرسنل (کد)</th>
                    <th className="px-4 py-2.5 text-center">تاریخ (روز هفته)</th>
                    <th className="px-4 py-2.5 text-center">برنامه شیفت مصوب</th>
                    <th className="px-4 py-2.5 text-center">ساعت ثبت واقعی</th>
                    <th className="px-4 py-2.5 text-center">ساعت فرضی سیستم</th>
                    <th className="px-4 py-2.5 text-right text-rose-400">شرح مغایرت با شیفت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {correctionReports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-bold">
                        هیچ رکوردی در این مرحله اصلاح نگردید.
                      </td>
                    </tr>
                  ) : (
                    correctionReports.map((item, idx) => {
                      const isApproved = approvedReportIds.includes(item.id);
                      return (
                        <tr 
                          key={item.id || idx} 
                          className={`transition-all ${
                            isApproved 
                              ? 'hover:bg-slate-900/45 bg-slate-950/20' 
                              : 'bg-slate-950/70 opacity-40 hover:opacity-60'
                          }`}
                        >
                          <td className="px-4 py-3 text-center w-12">
                            <input 
                              type="checkbox"
                              disabled={isMonthLocked}
                              checked={isApproved}
                              onChange={(e) => {
                                if (isMonthLocked) return;
                                if (e.target.checked) {
                                  setApprovedReportIds(prev => [...prev, item.id]);
                                } else {
                                  setApprovedReportIds(prev => prev.filter(id => id !== item.id));
                                }
                              }}
                              className={`h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-emerald-500 ${isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-200">
                            {item.employeeName}
                            <span className="block text-[10px] text-slate-500 font-mono font-normal">کد: {toPersianDigits(item.employeeCode)}</span>
                          </td>
                          <td className="px-4 py-3 text-center text-slate-300">
                            <span className="font-mono">{toPersianDigits(item.date)}</span>
                            <span className="block text-[10px] text-slate-500">({item.weekday})</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1.5 max-w-[190px] mx-auto">
                              <select
                                value={item.selectedSectionId || 'fallback'}
                                disabled={isMonthLocked}
                                onChange={(e) => handleReportSectionChange(item.id, e.target.value)}
                                className={`w-full bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] text-white focus:outline-none focus:border-rose-500 font-sans transition-colors ${isMonthLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <option value="fallback">بخش پیش‌فرض / محاسباتی</option>
                                <option value="none">بدون بخش (مرخصی/تعطیل)</option>
                                {(db.productionSections || []).map(sec => (
                                  <option key={sec.id} value={sec.id}>
                                    {sec.name} ({toPersianDigits(sec.startTime)} - {toPersianDigits(sec.endTime)})
                                  </option>
                                ))}
                              </select>
                              <span className="text-[9px] text-slate-400 block font-sans font-medium text-center">
                                {toPersianDigits(item.shiftTimes)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 rounded font-mono font-bold text-[11px] border border-emerald-900/50">
                              {item.originalType}: {toPersianDigits(item.originalTime)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="px-2 py-0.5 bg-slate-900 text-slate-400 rounded font-mono font-bold text-[11px] border border-slate-800">
                              {item.addedType}: {toPersianDigits(item.addedTime)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.isLateOrEarly 
                                ? 'bg-rose-950/80 text-rose-400 border border-rose-900/50' 
                                : 'bg-emerald-950/80 text-emerald-400 border border-emerald-900/50'
                            }`}>
                              {item.discrepancy}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 border-t border-slate-800 pt-3">
              <span className="text-[11px] text-slate-400 font-medium">
                تعداد کل ترددهای تصحیح شده پیشنهادی: <span className="text-white font-extrabold">{toPersianDigits(correctionReports.length)}</span> مورد
                {approvedReportIds.length !== correctionReports.length && (
                  <>
                    {' '} | تأیید شده: <span className="text-emerald-400 font-extrabold">{toPersianDigits(approvedReportIds.length)}</span> مورد
                  </>
                )}
              </span>
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={handleCancelCorrections}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  انصراف و عدم اعمال
                </button>
                <button
                  type="button"
                  onClick={handleApplyCorrections}
                  disabled={approvedReportIds.length === 0 || isMonthLocked}
                  className={`px-5 py-1.5 rounded-lg text-xs font-bold shadow-lg transition-all flex items-center gap-1.5 ${
                    approvedReportIds.length === 0 || isMonthLocked
                      ? 'bg-slate-850 text-slate-500 border border-slate-800 cursor-not-allowed shadow-none'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/15 cursor-pointer'
                  }`}
                >
                  <Check className="h-4 w-4" />
                  تأیید و اعمال اصلاحات هوشمند
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear Period Data Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn" dir="rtl">
          <div className="bg-slate-900 border border-slate-850 rounded-2xl max-w-md w-full p-6 text-right shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-2 text-rose-500 border-b border-slate-800 pb-3">
              <AlertTriangle className="h-5 w-5 animate-pulse" />
              <h3 className="text-sm font-black text-white">هشدار: پاک کردن تمامی اطلاعات این دوره</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              آیا از پاک کردن تمامی ترددهای پرسنل و محاسبات حقوق و دستمزد ثبت‌شده برای دوره فعال (<span className="text-rose-400 font-extrabold">{monthsList.find(m => m.value === selectedMonth)?.label || ''} {toPersianDigits(selectedYear)}</span>) اطمینان دارید؟ این عملیات غیرقابل بازگشت است.
            </p>

            <div className="flex items-center gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleClearPeriodData}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/10 cursor-pointer transition-all flex items-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                تأیید و پاک‌سازی کامل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Online Hardware Connection Modal for XFace 60 N */}
      {isDeviceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto flex items-center justify-center animate-fadeIn" dir="rtl">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-3xl shadow-2xl p-6 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl">
                  <Radio className="h-5 w-5 animate-pulse" />
                </div>
                <div className="space-y-0.5">
                  <h3 className="text-base font-black text-white">اتصال آنلاین به دستگاه حضور و غیاب XFace 60 N</h3>
                  <p className="text-xs text-slate-400">تخلیه مستقیم ترددها از طریق شبکه محلی یا Wi-Fi (پلتفرم ZMM510 / پورت ۴۳۷۰)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDeviceModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer border border-transparent hover:border-slate-700"
                title="بستن پنجره"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <AttendanceDeviceManagement
              db={db}
              onUpdateDb={onUpdateDb}
              activePeriodId={activePeriodId}
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onApplyRecordsToTable={(devRecords) => {
                handleApplyRecordsFromDevice(devRecords);
                setIsDeviceModalOpen(false);
              }}
              onClose={() => setIsDeviceModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Smart Auto-Diagnostic and Shift Fix Modal */}
      {isSmartFixModalOpen && (() => {
        const fmtHM = (mins: number) =>
          toPersianDigits(`${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);

        const mismatchCnt = smartFixCandidates.filter(c => c.sourceCategory === 'mismatch').length;
        const noShiftCnt = smartFixCandidates.filter(c => c.sourceCategory === 'no_shift').length;
        const approvedImproveCnt = smartFixCandidates.filter(c => c.sourceCategory === 'approved_improvement').length;
        const needsApprovalCnt = smartFixCandidates.filter(c => c.sourceCategory === 'unauthorized_needs_approval').length;

        const visibleCandidates = smartFixFilter === 'all'
          ? smartFixCandidates
          : smartFixCandidates.filter(c => c.sourceCategory === smartFixFilter);

        const categoryBadge = (cat: SmartShiftSourceCategory) => {
          switch (cat) {
            case 'mismatch':
              return { label: 'عدم تطابق شیفت', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
            case 'no_shift':
              return { label: 'تردد بدون شیفت', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
            case 'approved_improvement':
              return { label: 'تایید شده (بهبود شیفت)', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
            case 'unauthorized_needs_approval':
              return { label: 'مغایرت غیرمجاز نیازمند تایید', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' };
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn" dir="rtl">
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-4xl w-full p-6 text-right shadow-2xl flex flex-col gap-4 max-h-[88vh] overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-amber-400">
                  <Sparkles className="h-5 w-5 animate-pulse" />
                  <h3 className="text-sm font-black text-white">نتایج پایش هوشمند شیفت‌ها (بر اساس ماتریس توانمندی مجاز پرسنل)</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSmartFixModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed space-y-2">
                <p>
                  سیستم ترددهای عدم تطابق، بدون شیفت، تایید شده و مغایرت‌های غیرمجاز را بررسی کرد و <span className="font-extrabold text-amber-400">{toPersianDigits(smartFixCandidates.length)} مورد</span> پیشنهاد یا شیفت قابل تایید مجاز یافت شده است:
                </p>

                {/* Filter & Bulk Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSmartFixFilter('all')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                        smartFixFilter === 'all' ? 'bg-slate-200 text-slate-950 border-slate-200' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      همه ({toPersianDigits(smartFixCandidates.length)})
                    </button>
                    {mismatchCnt > 0 && (
                      <button
                        type="button"
                        onClick={() => setSmartFixFilter('mismatch')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                          smartFixFilter === 'mismatch' ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-950 text-amber-300 border-amber-500/20 hover:bg-amber-500/10'
                        }`}
                      >
                        عدم تطابق ({toPersianDigits(mismatchCnt)})
                      </button>
                    )}
                    {noShiftCnt > 0 && (
                      <button
                        type="button"
                        onClick={() => setSmartFixFilter('no_shift')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                          smartFixFilter === 'no_shift' ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-950 text-cyan-300 border-cyan-500/20 hover:bg-cyan-500/10'
                        }`}
                      >
                        بدون شیفت ({toPersianDigits(noShiftCnt)})
                      </button>
                    )}
                    {approvedImproveCnt > 0 && (
                      <button
                        type="button"
                        onClick={() => setSmartFixFilter('approved_improvement')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                          smartFixFilter === 'approved_improvement' ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-slate-950 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/10'
                        }`}
                      >
                        تاییدشده قابل بهبود ({toPersianDigits(approvedImproveCnt)})
                      </button>
                    )}
                    {needsApprovalCnt > 0 && (
                      <button
                        type="button"
                        onClick={() => setSmartFixFilter('unauthorized_needs_approval')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                          smartFixFilter === 'unauthorized_needs_approval' ? 'bg-rose-500 text-white border-rose-400' : 'bg-slate-950 text-rose-300 border-rose-500/20 hover:bg-rose-500/10'
                        }`}
                      >
                        نیازمند تایید با بهترین شیفت ({toPersianDigits(needsApprovalCnt)})
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedFixKeys(new Set(smartFixCandidates.map(c => c.key)))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      انتخاب همه
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFixKeys(new Set(smartFixCandidates.filter(c => !c.requiresUserApproval).map(c => c.key)))}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/20 cursor-pointer"
                    >
                      فقط انتساب شیفت مجاز
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFixKeys(new Set())}
                      className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-400 cursor-pointer"
                    >
                      لغو انتخاب همه
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[50vh] border border-slate-800 rounded-xl p-2 bg-slate-950/50 space-y-2">
                {visibleCandidates.map((cand) => {
                  const { mismatch, suggestedShift, key, sourceCategory, requiresUserApproval, isSameShiftAsCurrent } = cand;
                  const isSelected = selectedFixKeys.has(key);
                  const badge = categoryBadge(sourceCategory);

                  return (
                    <div
                      key={key}
                      onClick={() => {
                        const next = new Set(selectedFixKeys);
                        if (isSelected) next.delete(key);
                        else next.add(key);
                        setSelectedFixKeys(next);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${
                        isSelected
                          ? requiresUserApproval
                            ? 'bg-rose-950/20 border-rose-500/40 text-slate-100'
                            : 'bg-amber-950/20 border-amber-500/40 text-slate-100'
                          : 'bg-slate-900/40 border-slate-800 text-slate-400 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="h-4 w-4 mt-1 rounded accent-amber-500 cursor-pointer shrink-0"
                        />
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-xs text-white">
                              {mismatch.employee.fullName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({toPersianDigits(mismatch.dateStr)} - {mismatch.weekday})
                            </span>
                            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span>
                              تردد واقعی: <span className="font-mono text-emerald-400 font-bold">{mismatch.firstEntry ? toPersianDigits(mismatch.firstEntry) : '---'}</span> تا <span className="font-mono text-emerald-400 font-bold">{mismatch.lastExit ? toPersianDigits(mismatch.lastExit) : '---'}</span>
                            </span>
                            <span className="text-slate-400">
                              شیفت فعلی: <span className="text-slate-200 font-bold">{mismatch.currentSectionId === 'none' ? 'بدون شیفت' : (mismatch.shift?.name || resolveShiftDisplayName(mismatch.currentSectionId))}</span>
                              {!mismatch.currentIsAuthorized && mismatch.currentSectionId !== 'none' && (
                                <span className="text-rose-400 mr-1">(خارج از ماتریس مجاز)</span>
                              )}
                            </span>
                          </div>
                          {requiresUserApproval && (
                            <div className="flex flex-wrap items-center gap-2 text-[10px] pt-0.5">
                              {suggestedShift.hasExcessiveDelay && (
                                <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold">
                                  تاخیر روی بهترین شیفت: {fmtHM(suggestedShift.delayMin)}
                                </span>
                              )}
                              {suggestedShift.hasExcessiveUnauthorized && (
                                <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 font-bold">
                                  ساعت غیرمجاز: {fmtHM(suggestedShift.unauthorizedPresenceMin)}
                                </span>
                              )}
                              {suggestedShift.isMismatch && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                                  اختلاف ورود/خروج باقیمانده: {fmtHM(suggestedShift.entryDiff)} / {fmtHM(suggestedShift.exitDiff)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`text-left sm:text-right bg-slate-950 p-2.5 rounded-lg border text-xs shrink-0 min-w-[220px] ${
                        requiresUserApproval ? 'border-rose-500/30' : 'border-emerald-500/30'
                      }`}>
                        <div className="text-[10px] text-slate-400 mb-0.5">
                          {requiresUserApproval
                            ? (isSameShiftAsCurrent ? 'بهترین شیفت مجاز قابل تایید (تثبیت شیفت فعلی):' : 'بهترین شیفت مجاز انتخاب‌شده جهت تایید:')
                            : 'بهترین شیفت مناسب و مجاز:'}
                        </div>
                        <div className={`font-black ${requiresUserApproval ? 'text-rose-300' : 'text-amber-300'}`}>
                          {suggestedShift.name} ({toPersianDigits(suggestedShift.startTime)} الی {toPersianDigits(suggestedShift.endTime)})
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          اختلاف ورود: {fmtHM(suggestedShift.entryDiff)} | خروج: {fmtHM(suggestedShift.exitDiff)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-between pt-2 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-bold">
                  {toPersianDigits(selectedFixKeys.size)} مورد انتخاب شده (هم‌زمان در لیست جدول نیز به عنوان شیفت پیشنهادی/قابل تایید انتخاب گردید)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSmartFixModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={handleApplySmartShiftFixes}
                    disabled={selectedFixKeys.size === 0 || isMonthLocked}
                    className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedFixKeys.size > 0 && !isMonthLocked
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Check className="h-4 w-4" />
                    تأیید و اعمال اصلاحات انتخاب شده
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Sub-component for individual interactive row to prevent unwanted full table re-renders during state typing
interface RecordRowProps {
  key?: string;
  rec: AttendanceRecord;
  matchedEmployee: Personnel | undefined;
  isUnknownName: boolean;
  weekday: string;
  isMonthLocked?: boolean;
  onTimeChange: (recordId: string, timeIdx: number, newVal: string) => void;
  onAddTime: (recordId: string, timeVal: string, forcedStatus?: number) => void;
  onDeleteTime: (recordId: string, timeVal: string) => void;
  onToggleStatus: (recordId: string, timeIdx: number) => void;
  onPromoteTime: (recordId: string, additionalTimeIdx: number, targetSlot: 'entry' | 'exit') => void;
  onSwapEntryExit: (recordId: string) => void;
  onRevertSystemCorrection: (recordId: string) => void;
}

function RecordRow({ rec, matchedEmployee, isUnknownName, weekday, isMonthLocked, onTimeChange, onAddTime, onDeleteTime, onToggleStatus, onPromoteTime, onSwapEntryExit, onRevertSystemCorrection }: RecordRowProps) {
  // Identify status index for first entry (0) and first exit (1)
  const rStatuses = rec.statuses || rec.times.map((_, idx) => (idx % 2 === 0 ? 0 : 1));
  
  const entryIdx = rStatuses.indexOf(0);
  const exitIdx = rStatuses.indexOf(1);

  const entryTime = entryIdx !== -1 ? rec.times[entryIdx] : '';
  const exitTime = exitIdx !== -1 ? rec.times[exitIdx] : '';

  // Local state for typed new values if slot is empty
  const [typedEntry, setTypedEntry] = useState('');
  const [typedExit, setTypedExit] = useState('');

  const handleBlurEntry = () => {
    if (typedEntry.trim()) {
      onAddTime(rec.id, typedEntry.trim(), 0);
      setTypedEntry('');
    }
  };

  const handleBlurExit = () => {
    if (typedExit.trim()) {
      onAddTime(rec.id, typedExit.trim(), 1);
      setTypedExit('');
    }
  };

  return (
    <tr className={`hover:bg-slate-900/40 transition-all even:bg-slate-900/10 border-r-2 ${rec.errors && rec.errors.length > 0 ? 'bg-rose-950/5 border-r-rose-500/50' : 'border-r-transparent hover:border-r-rose-500/30'}`}>
      {/* Personnel Column */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <div className="flex flex-col gap-0.5 text-right">
            <span className={`font-extrabold text-xs transition-colors hover:text-white ${isUnknownName ? 'text-amber-400 flex items-center gap-1' : 'text-slate-100'}`}>
              {isUnknownName && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />}
              {matchedEmployee ? `${matchedEmployee.firstName} ${matchedEmployee.lastName || ''}`.trim() : 'نامشخص'}
            </span>
            <span className="text-[9.5px] text-slate-400 font-mono font-medium">کد پرسنلی: {toPersianDigits(matchedEmployee?.employeeCode || 'تعریف نشده')}</span>
          </div>
        </div>
      </td>

      {/* Device code */}
      <td className="px-1 py-2 text-center">
        <span className="inline-flex items-center justify-center px-1.5 py-0.5 bg-slate-900/80 text-slate-300 rounded-lg font-mono font-bold border border-slate-800/80 text-[10px] shadow-sm select-all">
          {toPersianDigits(rec.attendanceCode)}
        </span>
      </td>

      {/* Date */}
      <td className="px-1 py-2 text-center font-bold text-slate-200">
        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-900/40 rounded-lg border border-slate-800 text-[10.5px]">
          <span className="font-mono font-extrabold text-slate-200">{toPersianDigits(rec.date)}</span>
          <span className="text-[9.5px] text-slate-400 font-bold border-r border-slate-800 pr-1 mr-0.5">
            {weekday}
          </span>
        </div>
      </td>

      {/* Clocks list with interactive tools */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-center gap-1.5">
            {/* Entry Slot */}
            <div className={`flex items-center bg-slate-900 rounded-xl px-2 py-1 text-xs text-white font-mono font-bold transition-all shadow-sm w-36 justify-between gap-1 border ${
              rec.isSystemCorrected && rec.correctionReport?.addedType === 'entry'
                ? 'border-amber-500/50 bg-amber-500/5 shadow-[0_0_12px_rgba(245,158,11,0.12)]'
                : 'border-slate-800/80 hover:border-emerald-500/40 focus-within:border-emerald-500/50'
            }`}>
              <span className={`px-1 py-0.5 rounded text-[8.5px] font-black select-none shrink-0 ${
                rec.isSystemCorrected && rec.correctionReport?.addedType === 'entry'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>ورود</span>
              {entryIdx !== -1 ? (
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <input 
                    type="text"
                    disabled={isMonthLocked}
                    className="w-16 bg-transparent text-center focus:outline-none text-slate-100 border-none p-0 font-mono font-extrabold text-xs tracking-wider disabled:opacity-60"
                    value={entryTime}
                    onChange={(e) => onTimeChange(rec.id, entryIdx, e.target.value)}
                  />
                  <button 
                    type="button" 
                    disabled={isMonthLocked}
                    onClick={() => onDeleteTime(rec.id, entryTime)}
                    className="text-slate-500 hover:text-rose-400 hover:bg-slate-800 p-0.5 rounded cursor-pointer shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    title="حذف ورود"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <input 
                  type="text"
                  disabled={isMonthLocked}
                  placeholder="--:--"
                  value={typedEntry}
                  onChange={(e) => setTypedEntry(e.target.value)}
                  onBlur={handleBlurEntry}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleBlurEntry();
                  }}
                  className="w-16 bg-transparent text-center focus:outline-none text-slate-500 focus:text-emerald-400 border-none p-0 font-mono font-bold text-xs tracking-wider disabled:opacity-40"
                />
              )}
            </div>

            {/* Swap Button */}
            <button
              type="button"
              onClick={() => onSwapEntryExit(rec.id)}
              disabled={isMonthLocked || (entryIdx === -1 && exitIdx === -1)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer text-slate-400 hover:text-amber-400 shrink-0 ${
                isMonthLocked || (entryIdx === -1 && exitIdx === -1)
                  ? 'opacity-20 cursor-not-allowed border-slate-900 bg-slate-950/40'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-900 shadow-md hover:shadow-lg'
              }`}
              title="جابه‌جایی ورود و خروج اصلی"
            >
              <ArrowLeftRight className="h-3 w-3" />
            </button>

            {/* Exit Slot */}
            <div className={`flex items-center bg-slate-900 rounded-xl px-2 py-1 text-xs text-white font-mono font-bold transition-all shadow-sm w-36 justify-between gap-1 border ${
              rec.isSystemCorrected && rec.correctionReport?.addedType === 'exit'
                ? 'border-amber-500/50 bg-amber-500/5 shadow-[0_0_12px_rgba(245,158,11,0.12)]'
                : 'border-slate-800/80 hover:border-amber-500/40 focus-within:border-amber-500/50'
            }`}>
              <span className={`px-1 py-0.5 rounded text-[8.5px] font-black select-none shrink-0 ${
                rec.isSystemCorrected && rec.correctionReport?.addedType === 'exit'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>خروج</span>
              {exitIdx !== -1 ? (
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <input 
                    type="text"
                    disabled={isMonthLocked}
                    className="w-16 bg-transparent text-center focus:outline-none text-slate-100 border-none p-0 font-mono font-extrabold text-xs tracking-wider disabled:opacity-60"
                    value={exitTime}
                    onChange={(e) => onTimeChange(rec.id, exitIdx, e.target.value)}
                  />
                  <button 
                    type="button" 
                    disabled={isMonthLocked}
                    onClick={() => onDeleteTime(rec.id, exitTime)}
                    className="text-slate-500 hover:text-rose-400 hover:bg-slate-800 p-0.5 rounded cursor-pointer shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    title="حذف خروج"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <input 
                  type="text"
                  disabled={isMonthLocked}
                  placeholder="--:--"
                  value={typedExit}
                  onChange={(e) => setTypedExit(e.target.value)}
                  onBlur={handleBlurExit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleBlurExit();
                  }}
                  className="w-16 bg-transparent text-center focus:outline-none text-slate-500 focus:text-amber-400 border-none p-0 font-mono font-bold text-xs tracking-wider disabled:opacity-40"
                />
              )}
            </div>
          </div>

          {/* Revert Button under main clocks row */}
          {rec.isSystemCorrected && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1 animate-fadeIn">
              <button
                type="button"
                disabled={isMonthLocked}
                onClick={() => onRevertSystemCorrection(rec.id)}
                className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 rounded-lg border border-amber-500/20 hover:border-amber-500/40 text-[9.5px] font-bold cursor-pointer transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                title="بازگردانی تردد به حالت دستی تک‌ساعته قبل از اصلاح سیستم"
              >
                <RotateCcw className="h-2.5 w-2.5 text-amber-400 animate-spin-reverse" />
                <span>بازگردانی اصلاح سیستم</span>
              </button>
              <span className="text-[9.5px] text-slate-400 font-medium bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-850">
                تنظیم خودکار شیفت
              </span>
            </div>
          )}

          {/* Render any additional/extra times if they exist */}
          {rec.times.length > ( (entryIdx !== -1 ? 1 : 0) + (exitIdx !== -1 ? 1 : 0) ) && (
            <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-900 mt-1 items-center">
              <span className="text-[9.5px] text-slate-400 font-extrabold select-none text-center">ترددهای اضافی:</span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {rec.times.map((t, idx) => {
                  if (idx === entryIdx || idx === exitIdx) return null;
                  const isExit = rec.statuses ? rec.statuses[idx] === 1 : (idx % 2 !== 0);
                  return (
                    <div 
                      key={idx} 
                      className={`flex flex-col gap-1 bg-slate-950 border rounded-lg p-1.5 w-36 transition-all shadow-sm hover:shadow-md ${
                        isExit ? 'border-amber-950 text-amber-300 hover:border-amber-500/20' : 'border-emerald-950 text-emerald-300 hover:border-emerald-500/20'
                      }`}
                    >
                      {/* Top row: Status tag, Input, and Delete button */}
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          disabled={isMonthLocked}
                          onClick={() => onToggleStatus(rec.id, idx)}
                          className={`px-1 py-0.5 rounded text-[8px] font-black transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                            isExit ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          } ${!isMonthLocked ? 'cursor-pointer' : ''}`}
                          title="تغییر نوع تردد"
                        >
                          {isExit ? 'خروج' : 'ورود'}
                        </button>
                        <div className="flex items-center gap-1 flex-1 justify-end">
                          <input 
                            type="text"
                            disabled={isMonthLocked}
                            className="w-16 bg-transparent text-center focus:outline-none text-white border-none p-0 font-mono font-extrabold text-xs tracking-wider disabled:opacity-60"
                            value={t}
                            onChange={(e) => onTimeChange(rec.id, idx, e.target.value)}
                          />
                          <button 
                            type="button" 
                            disabled={isMonthLocked}
                            onClick={() => onDeleteTime(rec.id, t)}
                            className="text-slate-500 hover:text-rose-400 hover:bg-slate-900 p-0.5 rounded cursor-pointer shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            title="حذف تردد اضافی"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                      
                      {/* Bottom row: Conversion/Promotion buttons */}
                      <div className="grid grid-cols-2 gap-1 border-t border-slate-900 pt-1 mt-0.5">
                        <button
                          type="button"
                          disabled={isMonthLocked}
                          onClick={() => onPromoteTime(rec.id, idx, 'entry')}
                          className="text-[8px] font-bold text-emerald-400 hover:bg-emerald-500/20 bg-emerald-500/5 border border-emerald-500/10 hover:border-emerald-500/20 rounded py-0.5 cursor-pointer transition-all text-center disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ورود
                        </button>
                        <button
                          type="button"
                          disabled={isMonthLocked}
                          onClick={() => onPromoteTime(rec.id, idx, 'exit')}
                          className="text-[8px] font-bold text-amber-400 hover:bg-amber-500/20 bg-amber-500/5 border border-amber-500/10 hover:border-amber-500/20 rounded py-0.5 cursor-pointer transition-all text-center disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          خروج
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </td>

      {/* Total presence duration in day */}
      <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-300">
        {rec.times.length > 0 && calculateDailyWorkedMinutes(rec.times, rec.statuses) > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-mono text-[11px] font-extrabold shadow-sm">
            <Clock className="h-3 w-3 text-emerald-400 shrink-0" />
            {formatMinutesToHoursAndMinutes(calculateDailyWorkedMinutes(rec.times, rec.statuses))}
          </span>
        ) : (
          <span className="text-slate-500 text-xs font-normal">--</span>
        )}
      </td>

      {/* Status / Error descriptions */}
      <td className="px-3 py-2.5 text-center">
        <div className="flex flex-col items-center justify-center gap-1">
          {rec.errors && rec.errors.length > 0 ? (
            <div className="flex flex-col items-center gap-1">
              {rec.errors.map((err, i) => (
                <span key={i} className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm select-none">
                  <AlertCircle className="h-3 w-3 shrink-0 text-rose-400" />
                  {err}
                </span>
              ))}
            </div>
          ) : rec.times.length === 2 ? (
            <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm mx-auto w-fit select-none">
              <CheckCircle className="h-3 w-3 text-emerald-400" />
              تردد مرتب
            </span>
          ) : rec.times.length === 0 ? (
            <span className="text-slate-500 text-[10px] font-medium bg-slate-900/50 px-2 py-0.5 rounded border border-slate-850">بدون کارکرد</span>
          ) : (
            <span className="px-2.5 py-0.5 bg-slate-900 text-slate-300 border border-slate-800 rounded-full text-[10px] font-extrabold flex items-center gap-1 shadow-sm w-fit select-none">
              <Sparkles className="h-3 w-3 text-rose-400" />
              تردد ترکیبی ({toPersianDigits(rec.times.length)})
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
