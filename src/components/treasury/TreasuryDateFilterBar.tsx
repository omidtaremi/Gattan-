/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Calendar, Filter, Clock } from 'lucide-react';
import { toPersianDigits, getTodayJalali } from '../../utils/persianUtils';

export type DateFilterMode = 'today' | 'yesterday' | '7days' | '30days' | 'specific' | 'range' | 'all';

interface TreasuryDateFilterBarProps {
  dateFilterMode: DateFilterMode;
  setDateFilterMode: (mode: DateFilterMode) => void;
  specificDate: string;
  setSpecificDate: (val: string) => void;
  fromDate: string;
  setFromDate: (val: string) => void;
  toDate: string;
  setToDate: (val: string) => void;
  title?: string;
  colorScheme?: 'emerald' | 'rose' | 'amber' | 'indigo' | 'cyan' | 'teal';
}

export default function TreasuryDateFilterBar({
  dateFilterMode,
  setDateFilterMode,
  specificDate,
  setSpecificDate,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  title = 'فیلتر زمانی اسناد:',
  colorScheme = 'amber'
}: TreasuryDateFilterBarProps) {
  const todayStr = getTodayJalali();

  const getActiveClass = () => {
    switch (colorScheme) {
      case 'emerald':
        return 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20 font-black';
      case 'rose':
        return 'bg-rose-600 text-white shadow-md shadow-rose-600/20 font-black';
      case 'cyan':
        return 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-black';
      case 'indigo':
        return 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-black';
      case 'teal':
        return 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20 font-black';
      case 'amber':
      default:
        return 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 font-black';
    }
  };

  const activeClass = getActiveClass();
  const inactiveClass = 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800';

  return (
    <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-inner">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-bold text-slate-400 ml-1.5 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-amber-400" />
          {title}
        </span>

        <button
          type="button"
          onClick={() => setDateFilterMode('today')}
          className={`px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
            dateFilterMode === 'today' ? activeClass : inactiveClass
          }`}
        >
          امروز ({toPersianDigits(todayStr)})
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('yesterday')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === 'yesterday' ? activeClass : inactiveClass
          }`}
        >
          دیروز
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('7days')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === '7days' ? activeClass : inactiveClass
          }`}
        >
          ۷ روز گذشته
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('30days')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === '30days' ? activeClass : inactiveClass
          }`}
        >
          ۳۰ روز گذشته
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('specific')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === 'specific' ? activeClass : inactiveClass
          }`}
        >
          یک روز خاص
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('range')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === 'range' ? activeClass : inactiveClass
          }`}
        >
          بازه زمانی
        </button>

        <button
          type="button"
          onClick={() => setDateFilterMode('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            dateFilterMode === 'all' ? activeClass : inactiveClass
          }`}
        >
          همه تاریخ‌ها
        </button>
      </div>

      {/* Inputs for specific date or range */}
      {dateFilterMode === 'specific' && (
        <div className="flex items-center gap-2 text-xs bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-700">
          <span className="text-slate-400 font-medium">تاریخ مورد نظر:</span>
          <input
            type="text"
            value={specificDate}
            onChange={(e) => setSpecificDate(e.target.value)}
            placeholder="1405/01/15"
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono text-center outline-none focus:border-amber-400 w-32"
          />
        </div>
      )}

      {dateFilterMode === 'range' && (
        <div className="flex items-center gap-2 text-xs flex-wrap bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-700">
          <span className="text-slate-400 font-medium">از تاریخ:</span>
          <input
            type="text"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            placeholder="1405/01/01"
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono text-center outline-none focus:border-amber-400 w-28"
          />
          <span className="text-slate-400 font-medium">تا تاریخ:</span>
          <input
            type="text"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            placeholder="1405/01/30"
            className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono text-center outline-none focus:border-amber-400 w-28"
          />
        </div>
      )}
    </div>
  );
}
