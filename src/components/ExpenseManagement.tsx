/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, PeriodOverhead } from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, getDefaultYearMonthFromPeriod 
} from '../utils/persianUtils';
import { nextSimpleId } from '../utils/simpleId';
import { DollarSign, Save, Calendar, Copy } from 'lucide-react';
import {
  ERP_BUTTON_LABELS,
  ErpButton,
  KpiStrip,
  ModuleHeader,
  UnifiedToolbar,
} from './ui/UnifiedErpUi';
import {
  downloadTemplateExcel,
  exportRowsToExcel,
  readSpreadsheetRows,
  pickRowField
} from '../utils/tableIoUtils';
import { CopyFromPeriodModal } from './ui/CopyFromPeriodModal';
import { useErpFeedback } from './ui/ToastContext';

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
  const feedback = useErpFeedback();
  const [showCopyModal, setShowCopyModal] = useState(false);
  
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  const activePeriodObj = db.periods.find(p => p.id === activePeriodId);
  const defaultYM = useMemo(
    () => getDefaultYearMonthFromPeriod(activePeriodObj, activePeriodId),
    [activePeriodObj, activePeriodId]
  );
  const selectedExpenseYear = defaultYM.year;
  const defaultPeriodMonth = defaultYM.month;

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

    return {
      id: '',
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

    const exists = Boolean(activeOverhead.id) && db.periodOverheads.some(o => o.id === activeOverhead.id);
    const recordId = exists ? activeOverhead.id : nextSimpleId(db.periodOverheads || [], 'oh');

    const targetRow: PeriodOverhead = {
      id: recordId,
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
    if (exists) {
      updatedList = updatedList.map(o => o.id === recordId ? targetRow : o);
    } else {
      updatedList.push(targetRow);
    }

    onUpdateDb({
      ...db,
      periodOverheads: updatedList
    });

    feedback.success(
      `هزینه‌ها و سربار ماه ${PERSIAN_MONTHS[selectedExpenseMonth - 1]} ${toPersianDigits(selectedExpenseYear)} ذخیره شد.`
    );
  };

  const downloadSampleExpensesExcel = () => {
    downloadTemplateExcel(
      [
        'ماه (۱ تا ۱۲)',
        'هزینه تولید و کارگاه (ریال)',
        'هزینه توزیع و فروش (ریال)',
        'هزینه اداری و عمومی (ریال)',
        'هزینه مالی و بانکی (ریال)',
        'برگشت از هزینه (ریال)',
        'بهای تمام شده انتقالی حسابداری (ریال)'
      ],
      [
        {
          'ماه (۱ تا ۱۲)': selectedExpenseMonth,
          'هزینه تولید و کارگاه (ریال)': 0,
          'هزینه توزیع و فروش (ریال)': 0,
          'هزینه اداری و عمومی (ریال)': 0,
          'هزینه مالی و بانکی (ریال)': 0,
          'برگشت از هزینه (ریال)': 0,
          'بهای تمام شده انتقالی حسابداری (ریال)': 0
        }
      ],
      'هزینه‌ها_و_سربار',
      'نمونه_هزینه_ها_و_سربار_ماهانه.xlsx'
    );
  };

  const importExpensesFile = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) {
        feedback.warning('فایل انتخابی خالی است.');
        return;
      }
      const updatedList = [...(db.periodOverheads || [])];
      let imported = 0;

      rows.forEach(row => {
        const mRaw = pickRowField(row, ['ماه (۱ تا ۱۲)', 'ماه', 'month']);
        const mNum = Math.min(12, Math.max(1, parseNumber(mRaw) || selectedExpenseMonth));
        const op = parseNumber(pickRowField(row, ['هزینه تولید و کارگاه (ریال)', 'تولید', 'operational'])) || 0;
        const dist = parseNumber(pickRowField(row, ['هزینه توزیع و فروش (ریال)', 'توزیع', 'distributionSales'])) || 0;
        const adm = parseNumber(pickRowField(row, ['هزینه اداری و عمومی (ریال)', 'اداری', 'administrative'])) || 0;
        const fin = parseNumber(pickRowField(row, ['هزینه مالی و بانکی (ریال)', 'مالی', 'financial'])) || 0;
        const ret = parseNumber(pickRowField(row, ['برگشت از هزینه (ریال)', 'برگشت', 'returnsOfExpense'])) || 0;
        const cogs = parseNumber(pickRowField(row, ['بهای تمام شده انتقالی حسابداری (ریال)', 'انتقالی', 'transferredAccountingCogs'])) || 0;

        const idx = updatedList.findIndex(
          o => o.periodId === activePeriodId && Number(o.month) === mNum && Number(o.year) === Number(selectedExpenseYear)
        );
        const rec: PeriodOverhead = {
          id: idx >= 0 ? updatedList[idx].id : nextSimpleId(updatedList, 'oh'),
          periodId: activePeriodId,
          month: mNum,
          year: selectedExpenseYear,
          operational: op,
          distributionSales: dist,
          administrative: adm,
          financial: fin,
          returnsOfExpense: ret,
          transferredAccountingCogs: cogs
        };
        if (idx >= 0) updatedList[idx] = rec;
        else updatedList.push(rec);
        imported++;
      });

      onUpdateDb({ ...db, periodOverheads: updatedList });
      feedback.success(`${toPersianDigits(imported)} ردیف هزینه ماهانه با موفقیت وارد شد.`);
    } catch (err) {
      console.error(err);
      feedback.error('خطا در خواندن فایل اکسل هزینه‌ها.');
    }
  };

  const exportExpensesExcel = () => {
    const rows = [
      { 'بخش سرفصل هزینه کل': 'هزینه‌های تولید و کارگاه (سربار مستقیم)', 'مبلغ (ریال)': operational },
      { 'بخش سرفصل هزینه کل': 'هزینه‌های توزیع و فروش', 'مبلغ (ریال)': distribution },
      { 'بخش سرفصل هزینه کل': 'هزینه‌های اداری و پشتیبانی عمومی', 'مبلغ (ریال)': administrative },
      { 'بخش سرفصل هزینه کل': 'هزینه‌های مالی و بانکی', 'مبلغ (ریال)': financial },
      { 'بخش سرفصل هزینه کل': 'مجموع بازگشت یا برگشت هزینه', 'مبلغ (ریال)': returnsOfExpense },
      { 'بخش سرفصل هزینه کل': 'کل هزینه سربار خالص دوره جاری', 'مبلغ (ریال)': netOverheadVal },
      { 'بخش سرفصل هزینه کل': 'بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل)', 'مبلغ (ریال)': transferredCogs }
    ];
    exportRowsToExcel(rows, `هزینه‌های_${PERSIAN_MONTHS[selectedExpenseMonth - 1]}`, `دفتر_هزینه_ها_${PERSIAN_MONTHS[selectedExpenseMonth - 1]}.xlsx`);
  };

  const printExpensesTable = () => {
    printElement('expense-records-printable-card', `دفتر کل هزینه‌ها و مخارج — ${PERSIAN_MONTHS[selectedExpenseMonth - 1]} ${toPersianDigits(selectedExpenseYear)}`);
  };


  const recordedMonthsCount = (Object.values(monthlyExpenseStats) as Array<{ hasRecord: boolean }>).filter(s => s.hasRecord).length;
  const grossExpensesVal = operational + distribution + administrative + financial;

  return (
    <div className="space-y-6 animate-fadeIn pb-12 text-right font-sans" dir="rtl">
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <ModuleHeader
          icon={<DollarSign className="w-5 h-5" />}
          title="هزینه‌ها و مخارج سربار"
          subtitle="ثبت و کنترل هزینه‌های تولید، توزیع و فروش، اداری، مالی و سربار قابل تسهیم هر دوره"
          periodName={activePeriodObj?.name || activePeriodId}
          recordCount={recordedMonthsCount}
          recordLabel="ماه ثبت‌شده"
          actions={
            <ErpButton
              variant="secondary"
              size="sm"
              icon={<Copy className="w-3.5 h-3.5" />}
              onClick={() => setShowCopyModal(true)}
            >
              {ERP_BUTTON_LABELS.copyFromPeriod}
            </ErpButton>
          }
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right" dir="rtl">
        <KpiStrip
          items={[
            { label: 'ماه‌های ثبت‌شده در دوره', value: toPersianDigits(recordedMonthsCount), sublabel: 'از ۱۲ ماه', tone: 'default' },
            { label: `مجموع هزینه‌های ${PERSIAN_MONTHS[selectedExpenseMonth - 1]}`, value: formatWithCommas(grossExpensesVal), sublabel: 'ریال', tone: 'warning' },
            { label: 'تخفیفات و برگشت هزینه', value: formatWithCommas(returnsOfExpense), sublabel: 'ریال', tone: 'danger' },
            { label: 'سربار خالص توزیع‌پذیر', value: formatWithCommas(netOverheadVal), sublabel: 'ریال', tone: 'success' }
          ]}
        />

        <UnifiedToolbar
          onDownloadTemplate={downloadSampleExpensesExcel}
          onImportExcel={importExpensesFile}
          importAccept=".xlsx,.xls,.csv"
          onExportExcel={exportExpensesExcel}
          onPrint={printExpensesTable}
        />

      {/* 12-Month Expense Selector Header */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4 mb-6" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 text-right">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <span>ثبت و مدیریت هزینه‌ها و سربار ماهانه:</span>
                <span className="text-rose-400 font-extrabold">{PERSIAN_MONTHS[selectedExpenseMonth - 1]} {toPersianDigits(selectedExpenseYear)}</span>
              </h4>
              <p className="text-[10.5px] text-slate-400">
                امکان ثبت و نگهداری مستقل هزینه‌های کارگاهی، توزیع و فروش، اداری و مالی برای هر یک از ۱۲ ماه سال
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-1.5 shadow-inner">
              <span className="text-[10.5px] text-slate-400 font-bold">سال مالی دوره:</span>
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
                      ? 'bg-slate-900/80 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-slate-900'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[10px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-slate-500'}`}>
                    {toPersianDigits(monthNum)}
                  </span>
                  {stats.hasRecord ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" title="دارای ثبت هزینه"></span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className={`text-xs font-black truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                    {mName}
                  </div>
                  {stats.hasRecord ? (
                    <div className="text-[9.5px] text-emerald-400 font-bold truncate">
                      ✓ ثبت‌شده
                    </div>
                  ) : (
                    <div className="text-[9.5px] text-slate-500 font-medium">
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
        <div className="xl:col-span-1 bg-slate-950/70 p-6 rounded-3xl border border-slate-800 h-fit space-y-4 shadow-xs">
          <h3 className="text-xs font-black text-emerald-400 uppercase tracking-wider border-b border-slate-800 pb-2">دفتر ثبت مخارج دوره</h3>
          <p className="text-[10px] text-slate-400 leading-relaxed">مبالغ هزینه شده در زیر پس از ذخیره، ملاک تسهیم بهای تمام شده در فرمول دستورپخت کالاها قرار خواهند گرفت.</p>

          <form onSubmit={handleSaveOverheads} className="space-y-4 font-sans text-xs">
            
            <div>
              <label htmlFor="expense-operational" className="block text-[10.5px] font-bold text-slate-300 mb-1.5">هزینه‌های تولید و تدارک کارگاه (صنعتی/مستقیم)</label>
              <input
                id="expense-operational"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-slate-100 transition-all outline-none"
                value={formatWithCommas(operational)}
                onChange={(e) => setOperational(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-distribution" className="block text-[10.5px] font-bold text-slate-300 mb-1.5">هزینه‌های بازاریابی، توزیع و سهم فروش کالاها</label>
              <input
                id="expense-distribution"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-slate-100 transition-all outline-none"
                value={formatWithCommas(distribution)}
                onChange={(e) => setDistribution(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-administrative" className="block text-[10.5px] font-bold text-slate-300 mb-1.5">هزینه‌های عمومی، اداری، قبوض دپارتمان و اینترنت</label>
              <input
                id="expense-administrative"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-slate-100 transition-all outline-none"
                value={formatWithCommas(administrative)}
                onChange={(e) => setAdministrative(parseNumber(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="expense-financial" className="block text-[10.5px] font-bold text-slate-300 mb-1.5">هزینه‌های مالی، بانکی و سود خرید سفته/ضمانت</label>
              <input
                id="expense-financial"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-slate-100 transition-all outline-none"
                value={formatWithCommas(financial)}
                onChange={(e) => setFinancial(parseNumber(e.target.value))}
              />
            </div>

            <div className="border-t border-slate-800 pt-3">
              <label htmlFor="expense-returns" className="block text-[10.5px] font-bold text-rose-400 mb-1.5">برگشت کاهشی هزینه‌ها (تخفیفات دریافت شده و تعدیل)</label>
              <input
                id="expense-returns"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-rose-500/30 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 rounded-xl text-xs font-mono font-bold text-rose-400 transition-all outline-none"
                value={formatWithCommas(returnsOfExpense)}
                onChange={(e) => setReturnsOfExpense(parseNumber(e.target.value))}
              />
            </div>

            <div className="border-t border-slate-800 pt-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
              <label htmlFor="expense-transferred" className="block text-[10.5px] font-black text-indigo-400 mb-1">بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل)</label>
              <p className="text-[9px] text-slate-400 mb-1.5 leading-tight">مبلغ بهای محاسباتی دفاتر رسمی مالی جهت همگام‌سازی و مغایرت‌گیری ترازنامه‌ای (تأثیری در تسهیم سربار کارگاهی ندارد)</p>
              <input
                id="expense-transferred"
                type="text"
                onFocus={handleFocus}
                className="w-full p-2.5 bg-slate-950 border border-indigo-500/30 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl text-xs font-mono font-black text-indigo-300 transition-all outline-none text-center"
                value={formatWithCommas(transferredCogs)}
                onChange={(e) => setTransferredCogs(parseNumber(e.target.value))}
              />
            </div>

            <ErpButton
              type="submit"
              variant="primary"
              className="w-full"
              icon={<Save className="w-4 h-4" />}
            >
              {ERP_BUTTON_LABELS.save}
            </ErpButton>
          </form>
        </div>


        {/* ================= TOTAL EXPENSES LEDGER PREVIEW ================= */}
        <div id="expense-records-printable-card" className="xl:col-span-2 space-y-6">
          
          <div className="bg-slate-950/70 border border-slate-800 p-6 rounded-3xl shadow-xs space-y-4">
            <h3 className="text-sm font-extrabold text-white border-b border-slate-800 pb-2">بیلان کل و خلاصه تراز سربار دوره</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono select-none">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center min-w-0">
                <span className="block text-[10px] text-slate-400 font-sans font-semibold">مجموع کل هزینه‌ها</span>
                <strong className="block text-xs sm:text-[13px] font-bold text-slate-100 mt-1 tabular-nums tracking-tight break-words">
                  {formatWithCommas(operational + distribution + administrative + financial)} <span className="text-[10px] font-sans text-slate-400">ریال</span>
                </strong>
              </div>
              <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/25 text-center text-rose-400 min-w-0">
                <span className="block text-[10px] text-rose-300 font-sans font-semibold">تخفیفات و برگشت‌ها</span>
                <strong className="block text-xs sm:text-[13px] font-bold mt-1 tabular-nums tracking-tight break-words">
                  {formatWithCommas(returnsOfExpense)} <span className="text-[10px] font-sans text-rose-300/80">ریال</span>
                </strong>
              </div>
              <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/25 text-center min-w-0">
                <span className="block text-[10px] font-sans text-emerald-400 font-semibold">هزینه سربار خالص توزیع‌پذیر</span>
                <strong className="block text-xs sm:text-[13px] font-black text-white mt-1 tabular-nums tracking-tight break-words">
                  {formatWithCommas(netOverheadVal)} <span className="text-[10px] font-sans text-emerald-300/80">ریال</span>
                </strong>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
              توضیح: طبق الگوریتم های مالی سامانه جامع گاتان، هزینه سربار خالص توزیع پذیر بر اساس درصد سهم درآمد فروش خالص هر محصول به صورت پویا تسهیم میگردد تا قیمت تمام شده واقعی غرفه ها به دست آید.
            </p>
          </div>

          <div className="border border-slate-800 rounded-3xl overflow-hidden bg-slate-950/70 shadow-xs">
            <div className="bg-slate-900/90 p-4 border-b border-slate-800">
              <h4 className="text-xs font-bold text-slate-200">سرفصل های توزیع حسابداری</h4>
            </div>

            <div className="divide-y divide-slate-800 text-xs select-none">
              <div className="p-4 flex justify-between items-center hover:bg-slate-800/40 transition-colors">
                <span className="font-bold text-slate-300">۱. هزینه های مستقیم تولید و مواد اولیه کارگاهی</span>
                <strong className="font-mono text-slate-100">{formatWithCommas(operational)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-slate-800/40 transition-colors">
                <span className="font-bold text-slate-300">۲. هزینه های تبلیغات، توزیع، لجستیک و سهم بازار</span>
                <strong className="font-mono text-slate-100">{formatWithCommas(distribution)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-slate-800/40 transition-colors">
                <span className="font-bold text-slate-300">۳. هزینه های اداری، حقوق پشتیبانی، اینترنت و ملزومات اداری</span>
                <strong className="font-mono text-slate-100">{formatWithCommas(administrative)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center hover:bg-slate-800/40 transition-colors">
                <span className="font-bold text-slate-300">۴. هزینه های بانکی، ضمانت نامه ها، کارمزد شبکه پرداخت</span>
                <strong className="font-mono text-slate-100">{formatWithCommas(financial)} ریال</strong>
              </div>
              <div className="p-4 flex justify-between items-center bg-indigo-950/15 hover:bg-indigo-950/25 border-t border-indigo-500/20 transition-colors text-indigo-400">
                <span className="font-black">۵. بهای تمام شده انتقالی از سیستم حسابداری (فیلد کنترل حساب‌ها)</span>
                <strong className="font-mono font-black">{formatWithCommas(transferredCogs)} ریال</strong>
              </div>
            </div>
          </div>

        </div>
      </div>
      </div>

      <CopyFromPeriodModal
        open={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        targetPeriodId={activePeriodId}
        section="periodOverheads"
        onUpdateDb={onUpdateDb}
      />
    </div>
  );
}
