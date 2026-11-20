/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, PeriodOverhead } from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, getFiscalYearFromPeriod 
} from '../utils/persianUtils';
import { 
  DollarSign, TrendingDown, RefreshCcw, Save, Printer, FileSpreadsheet, 
  HelpCircle, Settings, HelpCircle as HelpIcon, ArrowUpRight, TrendingUp, Calendar 
} from 'lucide-react';

interface ExpenseManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

export default function ExpenseManagement({ db, onUpdateDb, activePeriodId }: ExpenseManagementProps) {
  
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const activePeriodObj = db.periods.find(p => p.id === activePeriodId);
  const selectedExpenseYear = useMemo(() => {
    return getFiscalYearFromPeriod(activePeriodObj, activePeriodId);
  }, [activePeriodObj, activePeriodId]);

  const defaultPeriodMonth = useMemo(() => {
    if (activePeriodId) {
      const parts = activePeriodId.split('-');
      if (parts.length >= 2) {
        const m = parseInt(parts[1], 10);
        if (!isNaN(m) && m >= 1 && m <= 12) return m;
      }
    }
    return 1;
  }, [activePeriodId]);

  const [selectedExpenseMonth, setSelectedExpenseMonth] = useState<number>(defaultPeriodMonth);

  React.useEffect(() => {
    setSelectedExpenseMonth(defaultPeriodMonth);
  }, [defaultPeriodMonth]);

  // Monthly statistics for the 12-month selector grid
  const monthlyExpenseStats = useMemo(() => {
    const stats: Record<number, { hasRecord: boolean; netTotal: number }> = {};
    for (let m = 1; m <= 12; m++) {
      stats[m] = { hasRecord: false, netTotal: 0 };
    }
    (db.periodOverheads || []).forEach(o => {
      if (o.periodId !== activePeriodId) return;
      const m = o.month !== undefined ? Number(o.month) : defaultPeriodMonth;
      const y = o.year !== undefined ? Number(o.year) : selectedExpenseYear;
      if (y === selectedExpenseYear && m >= 1 && m <= 12) {
        const net = (o.operational + o.distributionSales + o.administrative + o.financial) - o.returnsOfExpense;
        stats[m] = { hasRecord: true, netTotal: net };
      }
    });
    return stats;
  }, [db.periodOverheads, activePeriodId, defaultPeriodMonth, selectedExpenseYear]);

  // Find or construct base overhead for the selected month & year
  const activeOverhead = useMemo(() => {
    const exactMatch = (db.periodOverheads || []).find(
      o => o.periodId === activePeriodId && Number(o.month) === Number(selectedExpenseMonth) && Number(o.year) === Number(selectedExpenseYear)
    );
    if (exactMatch) return exactMatch;

    if (Number(selectedExpenseMonth) === Number(defaultPeriodMonth)) {
      const legacyMatch = (db.periodOverheads || []).find(
        o => o.periodId === activePeriodId && o.month === undefined
      );
      if (legacyMatch) return legacyMatch;
    }
    
    // Default fallback blank
    return {
      id: `ovh-${activePeriodId}-${selectedExpenseYear}-${String(selectedExpenseMonth).padStart(2, '0')}`,
      periodId: activePeriodId,
      month: selectedExpenseMonth,
      year: selectedExpenseYear,
      operational: 0,
      distributionSales: 0,
      administrative: 0,
      financial: 0,
      returnsOfExpense: 0,
      transferredAccountingCogs: 0
    };
  }, [db.periodOverheads, activePeriodId, selectedExpenseMonth, selectedExpenseYear, defaultPeriodMonth]);

  // Form states matching base overhead
  const [operational, setOperational] = useState(activeOverhead.operational);
  const [distribution, setDistribution] = useState(activeOverhead.distributionSales);
  const [administrative, setAdministrative] = useState(activeOverhead.administrative);
  const [financial, setFinancial] = useState(activeOverhead.financial);
  const [returnsOfExpense, setReturnsOfExpense] = useState(activeOverhead.returnsOfExpense);
  const [transferredCogs, setTransferredCogs] = useState(activeOverhead.transferredAccountingCogs || 0);

  // Sync state if activeOverhead changes
  React.useEffect(() => {
    setOperational(activeOverhead.operational);
    setDistribution(activeOverhead.distributionSales);
    setAdministrative(activeOverhead.administrative);
    setFinancial(activeOverhead.financial);
    setReturnsOfExpense(activeOverhead.returnsOfExpense);
    setTransferredCogs(activeOverhead.transferredAccountingCogs || 0);
  }, [activeOverhead]);


  // Net Overhead computation
  const netOverheadVal = useMemo(() => {
    return (operational + distribution + administrative + financial) - returnsOfExpense;
  }, [operational, distribution, administrative, financial, returnsOfExpense]);


  const handleSaveOverheads = (e: React.FormEvent) => {
    e.preventDefault();

    const targetRow: PeriodOverhead = {
      id: activeOverhead.id,
      periodId: activePeriodId,
      month: selectedExpenseMonth,
      year: selectedExpenseYear,
      operational,
      distributionSales: distribution,
      administrative,
      financial,
      returnsOfExpense,
      transferredAccountingCogs: transferredCogs
    };

    let updatedList = [...db.periodOverheads];
    const exists = db.periodOverheads.some(o => o.id === activeOverhead.id);

    if (exists) {
      updatedList = updatedList.map(o => o.id === activeOverhead.id ? targetRow : o);
    } else {
      updatedList.push(targetRow);
    }

    onUpdateDb({
      ...db,
      periodOverheads: updatedList
    });

    alert(`مکاتب بهای سربار و هزینه‌های عملیاتی ماه ${PERSIAN_MONTHS[selectedExpenseMonth - 1]} ${toPersianDigits(selectedExpenseYear)} با موفقیت بروزرسانی شد.`);
  };

  const exportExpensesCSV = () => {
    const headers = ['بخش سرفصل هزینه کل', 'بهای هزینه شده به ریال'];
    const rows = [
      ['هزینه های تولید و کارگاه (سربار مستقیم)', operational],
      ['هزینه های توزیع و فروش', distribution],
      ['هزینه های اداری و پشتیبانی عمومی', administrative],
      ['هزینه های مالی و بانکی', financial],
      ['مجموع بازگشت یا برگشت هزینه', returnsOfExpense],
      ['کل هزینه سربار خالص دوره جاری', netOverheadVal],
      ['بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل)', transferredCogs]
    ];

    downloadCSV('Gatan_Operational_Overhead_Ledger', headers, rows as any);
  };

  const printExpensesTable = () => {
    const el = document.getElementById('expense-records-printable-card');
    if (el) {
      printElement('دفتر کل هزینه‌ها و مخارج دوره گاتان', el.outerHTML);
    }
  };


  return (
    <div className="bg-[#0d0d0f] border border-zinc-850 text-zinc-100 rounded-2xl sm:rounded-3xl min-h-[600px] shadow-2xl font-sans p-3 sm:p-6 animate-fade-in text-right" dir="rtl">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/80 pb-3 sm:pb-4 mb-4 sm:mb-6 gap-2.5 sm:gap-3">
        <div>
          <h2 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <DollarSign className="h-5 w-5 sm:h-5.5 sm:w-5.5 text-rose-500 shrink-0" />
            کنترل هزینه‌ها، مخارج و سربارهای کارگاه
          </h2>
          <p className="hidden sm:block text-xs text-zinc-400 mt-1">حق بهره‌وری اداری، هزینه‌های بازاریابی/فروش، کارمزد شبکه شتاب بانکی و فاکتورهای پرداختی متفرقه</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={printExpensesTable}
            className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            <Printer className="h-4 w-4 text-zinc-400" /> چاپ خلاصه مخارج
          </button>
          <button
            onClick={exportExpensesCSV}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs font-bold hover:bg-emerald-900/30 hover:text-emerald-300 transition-all cursor-pointer"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-500" /> خروجی اکسل
          </button>
        </div>
      </div>

      {/* 12-Month Expense Selector Header */}
      <div className="bg-zinc-950 border border-zinc-850 rounded-3xl p-5 shadow-xl space-y-4 mb-6" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-850/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-2xl shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 text-right">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <span>ثبت و مدیریت هزینه‌ها و سربار ماهانه:</span>
                <span className="text-rose-400 font-extrabold">{PERSIAN_MONTHS[selectedExpenseMonth - 1]} {toPersianDigits(selectedExpenseYear)}</span>
              </h4>
              <p className="text-[10.5px] text-zinc-400">
                امکان ثبت و نگهداری مستقل هزینه‌های کارگاهی، توزیع و فروش، اداری و مالی برای هر یک از ۱۲ ماه سال
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-3.5 py-1.5 shadow-inner">
              <span className="text-[10.5px] text-zinc-400 font-bold">سال مالی دوره:</span>
              <span className="text-xs font-black text-rose-400 font-mono">
                {toPersianDigits(selectedExpenseYear)}
              </span>
              <span className="text-[9.5px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                متصل به دوره
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-2">
          {PERSIAN_MONTHS.map((mName, idx) => {
            const monthNum = idx + 1;
            const isSelected = selectedExpenseMonth === monthNum;
            const stats = monthlyExpenseStats[monthNum] || { hasRecord: false, netTotal: 0 };

            return (
              <button
                key={monthNum}
                type="button"
                onClick={() => setSelectedExpenseMonth(monthNum)}
                className={`p-2.5 rounded-2xl border transition-all text-right flex flex-col justify-between gap-1.5 cursor-pointer relative ${
                  isSelected
                    ? 'bg-rose-950/50 border-rose-500 shadow-md shadow-rose-950/30 ring-2 ring-rose-500/50'
                    : stats.hasRecord
                      ? 'bg-zinc-900/80 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-zinc-900'
                      : 'bg-zinc-900/40 border-zinc-850 hover:border-zinc-750 hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[10px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-zinc-500'}`}>
                    {toPersianDigits(monthNum)}
                  </span>
                  {stats.hasRecord ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" title="دارای ثبت هزینه"></span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-700"></span>
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className={`text-xs font-black truncate ${isSelected ? 'text-white' : 'text-zinc-200'}`}>
                    {mName}
                  </div>
                  {stats.hasRecord ? (
                    <div className="text-[9.5px] text-emerald-400 font-bold truncate">
                      ✓ ثبت‌شده
                    </div>
                  ) : (
                    <div className="text-[9.5px] text-zinc-500 font-medium">
                      بدون ثبت
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* ================= FORM BUILDER FOR OVERHEAD VALUES ================= */}
        <div className="xl:col-span-1 bg-zinc-900/40 p-6 rounded-3xl border border-zinc-800/80 h-fit space-y-4 shadow-xs">
          <h3 className="text-xs font-black text-emerald-400 uppercase tracking-wider border-b border-zinc-800/80 pb-2">دفتر ثبت مخارج دوره</h3>
          <p className="text-[10px] text-zinc-400 leading-relaxed">مبالغ هزینه شده در زیر پس از ذخیره، ملاک تسهیم بهای تمام شده در فرمول دستورپخت کالاها قرار خواهند گرفت.</p>

          <form onSubmit={handleSaveOverheads} className="space-y-4 font-sans text-xs">
            
            <div>
              <label htmlFor="expense-operational" className="block text-[10.5px] font-bold text-zinc-300 mb-1.5">هزینه‌های تولید و تدارک کارگاه (صنعتی/مستقیم)</label>
              <input
                id="expense-operational"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/60 border border-zinc-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-zinc-100 transition-all outline-none"
                value={formatWithCommas(operational)}
                onChange={(e) => setOperational(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-distribution" className="block text-[10.5px] font-bold text-zinc-300 mb-1.5">هزینه‌های بازاریابی، توزیع و سهم فروش کالاها</label>
              <input
                id="expense-distribution"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/60 border border-zinc-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-zinc-100 transition-all outline-none"
                value={formatWithCommas(distribution)}
                onChange={(e) => setDistribution(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-administrative" className="block text-[10.5px] font-bold text-zinc-300 mb-1.5">هزینه‌های عمومی، اداری، قبوض دپارتمان و اینترنت</label>
              <input
                id="expense-administrative"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/60 border border-zinc-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-zinc-100 transition-all outline-none"
                value={formatWithCommas(administrative)}
                onChange={(e) => setAdministrative(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-financial" className="block text-[10.5px] font-bold text-zinc-300 mb-1.5">هزینه‌های مالی، بانکی و سود خرید سفته/ضمانت</label>
              <input
                id="expense-financial"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/60 border border-zinc-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-zinc-100 transition-all outline-none"
                value={formatWithCommas(financial)}
                onChange={(e) => setFinancial(parseNumber(e.target.value))}
              />
            </div>

            <div className="border-t border-zinc-800 pt-3">
              <label htmlFor="expense-returns" className="block text-[10.5px] font-bold text-rose-400 mb-1.5">برگشت کاهشی هزینه‌ها (تخفیفات دریافت شده و تعدیل)</label>
              <input
                id="expense-returns"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/60 border border-rose-950/30 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-rose-400 transition-all outline-none"
                value={formatWithCommas(returnsOfExpense)}
                onChange={(e) => setReturnsOfExpense(parseNumber(e.target.value))}
              />
            </div>

            <div className="border-t border-zinc-800 pt-3 bg-zinc-950/30 p-2.5 rounded-xl border border-zinc-900">
              <label htmlFor="expense-transferred" className="block text-[10.5px] font-black text-indigo-400 mb-1">بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل)</label>
              <p className="text-[9px] text-zinc-500 mb-1.5 leading-tight">مبلغ بهای محاسباتی دفاتر رسمی مالی جهت همگام‌سازی و مغایرت‌گیری ترازنامه‌ای (تأثیری در تسهیم سربار کارگاهی ندارد)</p>
              <input
                id="expense-transferred"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-zinc-950/80 border border-indigo-950/50 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl text-xs font-mono font-black text-indigo-300 transition-all outline-none text-center"
                value={formatWithCommas(transferredCogs)}
                onChange={(e) => setTransferredCogs(parseNumber(e.target.value))}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 rounded-xl shadow-lg cursor-pointer transition-colors"
            >
              ذخیره و همگام‌سازی هزینه‌های دوره
            </button>
          </form>
        </div>


        {/* ================= TOTAL EXPENSES LEDGER PREVIEW ================= */}
        <div id="expense-records-printable-card" className="xl:col-span-2 space-y-6">
          
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-white border-b border-zinc-800 pb-2">بیلان کل و خلاصه تراز سربار دوره</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono select-none">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-850 text-center">
                <span className="block text-[10px] text-zinc-400 font-sans font-semibold">مجموع کل هزینه‌ها</span>
                <strong className="block text-sm font-bold text-zinc-200 mt-1">
                  {formatWithCommas(operational + distribution + administrative + financial)} ریال
                </strong>
              </div>
              <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/30 text-center text-rose-400">
                <span className="block text-[10px] text-rose-350 font-sans font-semibold">تخفیفات و برگشت‌ها</span>
                <strong className="block text-sm font-bold mt-1">
                  {formatWithCommas(returnsOfExpense)} ریال
                </strong>
              </div>
              <div className="p-4 rounded-xl bg-gradient-to-br from-zinc-850 to-emerald-950/30 border border-emerald-500/20 text-center">
                <span className="block text-[10px] font-sans text-emerald-400 font-semibold">هزینه سربار خالص توزیع‌پذیر</span>
                <strong className="block text-sm font-black text-white mt-1">
                  {formatWithCommas(netOverheadVal)} ریال
                </strong>
              </div>
            </div>

            <p className="text-[10px] text-zinc-400 leading-relaxed bg-zinc-950/40 border border-zinc-850 p-3 rounded-xl">
              توضیح: طبق الگوریتم های مالی سامانه جامع گاتان، هزینه سربار خالص توزیع پذیر بر اساس درصد سهم درآمد فروش خالص هر محصول به صورت پویا تسهیم میگردد تا قیمت تمام شده واقعی غرفه ها به دست آید.
            </p>
          </div>

          <div className="border border-zinc-800 rounded-3xl overflow-hidden bg-zinc-900 shadow-xs">
            <div className="bg-zinc-950/60 p-4 border-b border-zinc-800">
              <h4 className="text-xs font-bold text-zinc-300">سرفصل های توزیع حسابداری</h4>
            </div>

            <div className="divide-y divide-zinc-800 text-xs select-none">
              <div className="p-4 flex justify-between items-center hover:bg-zinc-800/30 transition-colors">
                <span className="font-bold text-zinc-300">۱. هزینه های مستقیم تولید و مواد اولیه کارگاهی</span>
                <strong className="font-mono text-zinc-100">{formatWithCommas(operational)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-zinc-800/30 transition-colors">
                <span className="font-bold text-zinc-300">۲. هزینه های تبلیغات، توزیع، لجستیک و سهم بازار</span>
                <strong className="font-mono text-zinc-100">{formatWithCommas(distribution)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-zinc-800/30 transition-colors">
                <span className="font-bold text-zinc-300">۳. هزینه های اداری، حقوق پشتیبانی، اینترنت و ملزومات اداری</span>
                <strong className="font-mono text-zinc-100">{formatWithCommas(administrative)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-zinc-800/30 transition-colors">
                <span className="font-bold text-zinc-300">۴. هزینه های بانکی، ضمانت نامه ها، کارمزد شبکه پرداخت</span>
                <strong className="font-mono text-zinc-100">{formatWithCommas(financial)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center bg-indigo-950/10 hover:bg-indigo-950/20 border-t border-indigo-900/30 transition-colors text-indigo-400">
                <span className="font-black">۵. بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل حساب‌ها)</span>
                <strong className="font-mono font-black">{formatWithCommas(transferredCogs)} ریال</strong>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
