/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { getTodayJalali, toEnglishDigits, toPersianDigits } from '../utils/persianUtils';

export interface ShamsiDatePickerProps {
  id?: string;
  label?: React.ReactNode;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  labelClassName?: string;
  buttonClassName?: string;
  popoverAlign?: 'right' | 'left';
  defaultYear?: number;
  disabled?: boolean;
}

const SHAMSI_MONTHS = [
  { id: 1, name: 'فروردین' },
  { id: 2, name: 'اردیبهشت' },
  { id: 3, name: 'خرداد' },
  { id: 4, name: 'تیر' },
  { id: 5, name: 'مرداد' },
  { id: 6, name: 'شهریور' },
  { id: 7, name: 'مهر' },
  { id: 8, name: 'آبان' },
  { id: 9, name: 'آذر' },
  { id: 10, name: 'دی' },
  { id: 11, name: 'بهمن' },
  { id: 12, name: 'اسفند' }
];

const WEEKDAYS_ABBR = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const SHAMSI_YEARS = Array.from({ length: 96 }, (_, i) => 1320 + i); // 1320 to 1415

function isShamsiLeap(jy: number): boolean {
  const r = ((jy % 33) + 33) % 33;
  return r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
}

function getShamsiMonthDays(jy: number, jm: number): number {
  if (jm >= 1 && jm <= 6) return 31;
  if (jm >= 7 && jm <= 11) return 30;
  if (jm === 12) return isShamsiLeap(jy) ? 30 : 29;
  return 30;
}

function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  const jy_offset = jy - 979;
  const jm_offset = jm - 1;
  const jd_offset = jd - 1;

  let j_day_no =
    365 * jy_offset +
    Math.floor(jy_offset / 33) * 8 +
    Math.floor(((jy_offset % 33) + 3) / 4);
  for (let i = 0; i < jm_offset; ++i) {
    j_day_no += i < 6 ? 31 : 30;
  }
  j_day_no += jd_offset;

  let g_day_no = j_day_no + 79;

  let gy = 1600 + 400 * Math.floor(g_day_no / 146097);
  g_day_no = g_day_no % 146097;

  let leap = true;
  if (g_day_no >= 36525) {
    g_day_no--;
    gy += 100 * Math.floor(g_day_no / 36524);
    g_day_no = g_day_no % 36524;

    if (g_day_no >= 365) {
      g_day_no++;
    } else {
      leap = false;
    }
  }

  gy += 4 * Math.floor(g_day_no / 1461);
  g_day_no = g_day_no % 1461;

  if (g_day_no >= 366) {
    leap = false;
    g_day_no--;
    gy += Math.floor(g_day_no / 365);
    g_day_no = g_day_no % 365;
  }

  let gd = g_day_no + 1;
  const sal_g = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (let i = 1; i <= 12; i++) {
    if (gd <= sal_g[i]) {
      gm = i;
      break;
    }
    gd -= sal_g[i];
  }
  return new Date(gy, gm - 1, gd);
}

function getShamsiWeekdayStart(jy: number, jm: number): number {
  const gd = jalaliToGregorian(jy, jm, 1);
  const gDay = gd.getDay(); // 0=Sun .. 6=Sat
  return (gDay + 1) % 7; // Saturday=0, Sunday=1, ..., Friday=6
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const clean = toEnglishDigits(value).trim().replace(/[-\s]/g, '/');
  const parts = clean.split('/');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export default function ShamsiDatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = 'انتخاب تاریخ از تقویم شمسی...',
  labelClassName = 'block text-xs font-extrabold text-slate-700 dark:text-slate-200 font-sans',
  buttonClassName = 'w-full flex items-center justify-between px-3.5 py-2.5 border border-slate-300 dark:border-slate-800 rounded-xl text-xs bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-extrabold cursor-pointer shadow-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 focus:outline-none',
  popoverAlign = 'right',
  defaultYear,
  disabled = false
}: ShamsiDatePickerProps) {
  const todayParts = parseDateParts(getTodayJalali()) || { year: 1405, month: 1, day: 1 };
  const parsedValue = parseDateParts(value);

  const [isOpen, setIsOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState<number>(
    parsedValue?.year || defaultYear || todayParts.year
  );
  const [pickerMonth, setPickerMonth] = useState<number>(
    parsedValue?.month || todayParts.month
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleOpenToggle = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const current = parseDateParts(value);
    if (current) {
      setPickerYear(current.year);
      setPickerMonth(current.month);
    } else {
      const today = parseDateParts(getTodayJalali()) || { year: 1405, month: 1, day: 1 };
      setPickerYear(defaultYear || today.year);
      setPickerMonth(today.month);
    }
    setIsOpen(true);
  };

  const handleSelectDay = (day: number) => {
    const yStr = String(pickerYear);
    const mStr = String(pickerMonth).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    onChange(`${yStr}/${mStr}/${dStr}`);
    setIsOpen(false);
  };

  const nextMonth = () => {
    if (pickerMonth === 12) {
      setPickerMonth(1);
      setPickerYear(prev => prev + 1);
    } else {
      setPickerMonth(prev => prev + 1);
    }
  };

  const prevMonth = () => {
    if (pickerMonth === 1) {
      setPickerMonth(12);
      setPickerYear(prev => prev - 1);
    } else {
      setPickerMonth(prev => prev - 1);
    }
  };

  const handleSelectToday = () => {
    const todayStr = toEnglishDigits(getTodayJalali());
    onChange(todayStr);
    setIsOpen(false);
  };

  const totalDays = getShamsiMonthDays(pickerYear, pickerMonth);
  const startWeekday = getShamsiWeekdayStart(pickerYear, pickerMonth);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) {
    cells.push(null);
  }
  for (let i = 1; i <= totalDays; i++) {
    cells.push(i);
  }

  return (
    <div ref={containerRef} className="space-y-1.5 text-right relative" dir="rtl">
      {label && (
        <label htmlFor={id} className={labelClassName}>
          {label}
        </label>
      )}

      <div className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={handleOpenToggle}
          className={`${buttonClassName} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          dir="rtl"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-rose-500 shrink-0" />
            <span className="font-mono truncate">
              {value ? toPersianDigits(value) : placeholder}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div
            className={`absolute z-50 mt-2 w-[300px] sm:w-[320px] max-w-[92vw] bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl space-y-3.5 text-right ${
              popoverAlign === 'left' ? 'left-0' : 'right-0'
            }`}
            dir="rtl"
          >
            {/* Month & Year Navigation Controls */}
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="p-1 px-3 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-black transition-colors cursor-pointer text-xs"
                title="ماه قبل"
              >
                ◀
              </button>

              <div className="flex items-center gap-1.5">
                <select
                  className="p-1 px-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-bold cursor-pointer focus:outline-none focus:border-rose-500"
                  value={pickerMonth}
                  onChange={(e) => setPickerMonth(Number(e.target.value))}
                >
                  {SHAMSI_MONTHS.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>

                <select
                  className="p-1 px-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold cursor-pointer focus:outline-none focus:border-rose-500"
                  value={pickerYear}
                  onChange={(e) => setPickerYear(Number(e.target.value))}
                >
                  {SHAMSI_YEARS.map(y => (
                    <option key={y} value={y}>
                      {toPersianDigits(String(y))}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={nextMonth}
                className="p-1 px-3 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-black transition-colors cursor-pointer text-xs"
                title="ماه بعد"
              >
                ▶
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 text-center font-extrabold text-[10.5px] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1.5">
              {WEEKDAYS_ABBR.map(w => (
                <div key={w} className="py-0.5">
                  {w}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="h-7" />;
                }
                const isSelected = Boolean(
                  parsedValue &&
                    parsedValue.year === pickerYear &&
                    parsedValue.month === pickerMonth &&
                    parsedValue.day === day
                );
                return (
                  <button
                    key={`day-${day}`}
                    type="button"
                    onClick={() => handleSelectDay(day)}
                    className={`h-7 w-7 mx-auto text-xs flex items-center justify-center rounded-lg font-mono font-black transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {toPersianDigits(String(day))}
                  </button>
                );
              })}
            </div>

            {/* Footer today / clear buttons */}
            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-2 text-[11px] font-black">
              <button
                type="button"
                onClick={handleSelectToday}
                className="text-rose-600 dark:text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 font-black cursor-pointer transition-colors"
              >
                انتخاب امروز
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold cursor-pointer transition-colors"
              >
                پاک کردن
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
