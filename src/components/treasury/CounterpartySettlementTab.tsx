/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, CounterpartySettlement, Customer, Supplier, BankAccount } from '../../types';
import { 
  BadgePercent, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  Receipt, FileText, Hash, FileSpreadsheet, Printer, 
  Save, X, Calendar, User, Banknote, ShieldCheck, Landmark, Check
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString,
  getTodayJalali, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate
} from '../../utils/persianUtils';
import TreasuryDateFilterBar, { DateFilterMode } from './TreasuryDateFilterBar';
import { nextSimpleId, getPrefixForCollection } from '../../utils/simpleId';

interface CounterpartySettlementTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export default function CounterpartySettlementTab({ db, onUpdateDb, activePeriodId, askConfirm }: CounterpartySettlementTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingSettlement, setEditingSettlement] = useState<CounterpartySettlement | null>(null);

  // Unified Date Filter State (Default to 'today')
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('today');
  const [specificDate, setSpecificDate] = useState<string>(getTodayJalali());
  const [fromDate, setFromDate] = useState<string>(getRelativeJalaliDate(-7));
  const [toDate, setToDate] = useState<string>(getTodayJalali());

  // Form State
  const [settlementNo, setSettlementNo] = useState('');
  const [date, setDate] = useState(getTodayJalali());
  const [partyType, setPartyType] = useState<'customer' | 'supplier'>('customer');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [totalSettledAmount, setTotalSettledAmount] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [bankTransferAmount, setBankTransferAmount] = useState<number>(0);
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankTransferRef, setBankTransferRef] = useState('');
  const [chequeAmount, setChequeAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'completed' | 'draft' | 'cancelled'>('completed');

  const settlements = useMemo(() => {
    return (db.counterpartySettlements || []).filter(s => s.periodId === activePeriodId);
  }, [db.counterpartySettlements, activePeriodId]);

  const customers = useMemo(() => (db.customers || []).filter(c => c.periodId === activePeriodId), [db.customers, activePeriodId]);
  const suppliers = useMemo(() => (db.suppliers || []).filter(s => s.periodId === activePeriodId), [db.suppliers, activePeriodId]);
  const bankAccounts = useMemo(() => (db.bankAccounts || []).filter(b => b.periodId === activePeriodId), [db.bankAccounts, activePeriodId]);

  const stats = useMemo(() => {
    const totalCount = settlements.length;
    const completedCount = settlements.filter(s => s.status === 'completed').length;
    const totalSettled = settlements.filter(s => s.status === 'completed').reduce((sum, s) => sum + (s.totalSettledAmount || 0), 0);
    const totalDiscount = settlements.filter(s => s.status === 'completed').reduce((sum, s) => sum + (s.discountAmount || 0), 0);
    return { totalCount, completedCount, totalSettled, totalDiscount };
  }, [settlements]);

  const filteredSettlements = useMemo(() => {
    const today = getTodayJalali();
    const yesterday = getRelativeJalaliDate(-1);
    const sevenDaysAgo = getRelativeJalaliDate(-7);
    const thirtyDaysAgo = getRelativeJalaliDate(-30);

    return settlements.filter(s => {
      // Date Filtering
      if (dateFilterMode === 'today') {
        if (normalizeJalaliDate(s.date) !== normalizeJalaliDate(today)) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (normalizeJalaliDate(s.date) !== normalizeJalaliDate(yesterday)) return false;
      } else if (dateFilterMode === '7days') {
        if (!isJalaliDateInRange(s.date, sevenDaysAgo, today)) return false;
      } else if (dateFilterMode === '30days') {
        if (!isJalaliDateInRange(s.date, thirtyDaysAgo, today)) return false;
      } else if (dateFilterMode === 'specific') {
        if (normalizeJalaliDate(s.date) !== normalizeJalaliDate(specificDate)) return false;
      } else if (dateFilterMode === 'range') {
        if (!isJalaliDateInRange(s.date, fromDate, toDate)) return false;
      }

      if (searchQuery) {
        const matches = 
          matchPersianString(s.partyName, searchQuery) ||
          s.settlementNo.includes(searchQuery) ||
          matchPersianString(s.notes || '', searchQuery) ||
          (s.bankTransferRef && s.bankTransferRef.includes(searchQuery));
        if (!matches) return false;
      }
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
  }, [settlements, dateFilterMode, specificDate, fromDate, toDate, searchQuery, statusFilter]);

  const handleOpenNew = () => {
    setEditingSettlement(null);
    const seq = (settlements.length + 1).toString().padStart(3, '0');
    setSettlementNo(`SET-140501-${seq}`);
    setDate(getTodayJalali());
    setPartyType('customer');
    setPartyId(customers[0]?.id || '');
    setPartyName(customers[0]?.name || '');
    setTotalSettledAmount(0);
    setDiscountAmount(0);
    setCashAmount(0);
    setBankTransferAmount(0);
    setBankAccountId(bankAccounts[0]?.id || '');
    setBankTransferRef('');
    setChequeAmount(0);
    setNotes('تسویه کامل حساب دوره به همراه تخفیف تسویه نقدی');
    setStatus('completed');
    setActiveSubView('form');
  };

  const handleOpenEdit = (s: CounterpartySettlement) => {
    setEditingSettlement(s);
    setSettlementNo(s.settlementNo);
    setDate(s.date);
    setPartyType(s.partyType);
    setPartyId(s.partyId);
    setPartyName(s.partyName);
    setTotalSettledAmount(s.totalSettledAmount);
    setDiscountAmount(s.discountAmount || 0);
    setCashAmount(s.cashAmount || 0);
    setBankTransferAmount(s.bankTransferAmount || 0);
    setBankAccountId(s.bankAccountId || '');
    setBankTransferRef(s.bankTransferRef || '');
    setChequeAmount(s.chequeAmount || 0);
    setNotes(s.notes || '');
    setStatus(s.status);
    setActiveSubView('form');
  };

  const handlePartySelect = (id: string) => {
    setPartyId(id);
    if (partyType === 'customer') {
      const found = customers.find(c => c.id === id);
      if (found) setPartyName(found.name);
    } else {
      const found = suppliers.find(s => s.id === id);
      if (found) setPartyName(found.name);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim() || totalSettledAmount <= 0) {
      alert('لطفاً طرف حساب و مبلغ کل تسویه شده را به درستی وارد نمایید.');
      return;
    }

    const currentList = db.counterpartySettlements || [];
    let updatedList: CounterpartySettlement[];

    const setObj: CounterpartySettlement = {
      id: editingSettlement ? editingSettlement.id : nextSimpleId(currentList, getPrefixForCollection('counterpartySettlements')),
      periodId: activePeriodId,
      settlementNo: settlementNo.trim(),
      date,
      partyType,
      partyId,
      partyName: partyName.trim(),
      totalSettledAmount: Number(totalSettledAmount) || 0,
      discountAmount: Number(discountAmount) || 0,
      cashAmount: Number(cashAmount) || 0,
      bankTransferAmount: Number(bankTransferAmount) || 0,
      bankAccountId: bankAccountId || undefined,
      bankTransferRef: bankTransferRef.trim() || undefined,
      chequeAmount: Number(chequeAmount) || 0,
      notes: notes.trim(),
      registeredBy: 'مدیر کل سامانه گاتان',
      status,
      createdAt: editingSettlement ? editingSettlement.createdAt : new Date().toLocaleDateString('fa-IR')
    };

    if (editingSettlement) {
      updatedList = currentList.map(s => s.id === editingSettlement.id ? setObj : s);
    } else {
      updatedList = [setObj, ...currentList];
    }

    onUpdateDb({
      ...db,
      counterpartySettlements: updatedList
    });

    setActiveSubView('list');
    setEditingSettlement(null);
  };

  const handleDelete = (s: CounterpartySettlement) => {
    askConfirm(
      'حذف سند تسویه حساب',
      `آیا از حذف سند تسویه حساب شماره "${s.settlementNo}" به مبلغ ${toPersianDigits(formatWithCommas(s.totalSettledAmount))} ریال اطمینان دارید؟`,
      () => {
        const updated = (db.counterpartySettlements || []).filter(item => item.id !== s.id);
        onUpdateDb({
          ...db,
          counterpartySettlements: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['شماره سند تسویه', 'تاریخ', 'طرف حساب', 'نوع', 'کل مبلغ تسویه (ریال)', 'تخفیف تسویه', 'واریز بانکی', 'نقد', 'چک', 'وضعیت'];
    const rows = filteredSettlements.map(s => [
      s.settlementNo,
      s.date,
      s.partyName,
      s.partyType === 'customer' ? 'مشتری' : 'تامین‌کننده',
      s.totalSettledAmount,
      s.discountAmount || 0,
      s.bankTransferAmount || 0,
      s.cashAmount || 0,
      s.chequeAmount || 0,
      s.status === 'completed' ? 'تکمیل شده' : 'پیش‌نویس'
    ]);
    downloadCSV('گزارش_تسویه_حساب_طرفین.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تعداد اسناد تسویه حساب</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Receipt className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع بدهی/بستانکاری تسویه‌شده</span>
            <span className="text-lg font-black text-emerald-400 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalSettled))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع تخفیفات تسویه نقدی</span>
            <span className="text-lg font-black text-amber-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalDiscount))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <BadgePercent className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">اسناد تسویه نهایی</span>
            <span className="text-2xl font-black text-purple-400 mt-1 block">{toPersianDigits(stats.completedCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingSettlement ? 'ویرایش سند تسویه حساب' : 'ثبت سند جامع تسویه حساب طرف مقابل (مشتری / تامین‌کننده)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">تسویه مانده‌حساب، اعمال تخفیف نقدی و تفکیک واریزی‌های بانکی و چک</p>
              </div>
            </div>
            <button
              onClick={() => setActiveSubView('list')}
              className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              {/* Settlement No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-cyan-400" />
                  شماره سند تسویه <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={settlementNo}
                  onChange={(e) => setSettlementNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  تاریخ تسویه <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Party Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">نوع طرف حساب</label>
                <select
                  value={partyType}
                  onChange={(e) => setPartyType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="customer">مشتری (تسویه فاکتورهای فروش و طلب)</option>
                  <option value="supplier">تامین‌کننده (تسویه خرید و بستانکاری)</option>
                </select>
              </div>

              {/* Party Select */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-cyan-400" />
                  انتخاب طرف حساب <span className="text-rose-400">*</span>
                </label>
                {partyType === 'customer' ? (
                  <select
                    value={partyId}
                    onChange={(e) => handlePartySelect(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                    required
                  >
                    <option value="">-- انتخاب مشتری --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                  </select>
                ) : (
                  <select
                    value={partyId}
                    onChange={(e) => handlePartySelect(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                    required
                  >
                    <option value="">-- انتخاب تامین‌کننده --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>

              {/* Total Settled Amount */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                  کل مبلغ تسویه‌شده از مانده حساب (ریال) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={formatWithCommas(totalSettledAmount)}
                  onChange={(e) => setTotalSettledAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-black text-sm text-left focus:border-cyan-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Discount Amount */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <BadgePercent className="w-3.5 h-3.5 text-amber-400" />
                  تخفیف تسویه نقدی اعطایی / دریافتی (ریال)
                </label>
                <input
                  type="text"
                  value={formatWithCommas(discountAmount)}
                  onChange={(e) => setDiscountAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-amber-300 font-bold text-left focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Bank Transfer Amount */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Landmark className="w-3.5 h-3.5 text-cyan-400" />
                  مبلغ واریز به/از حساب بانکی (ریال)
                </label>
                <input
                  type="text"
                  value={formatWithCommas(bankTransferAmount)}
                  onChange={(e) => setBankTransferAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-cyan-300 font-bold text-left focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Bank Account Select */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">حساب بانکی مربوطه</label>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="">-- بدون حساب بانکی --</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo}</option>
                  ))}
                </select>
              </div>

              {/* Bank Transfer Ref */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">شماره پیگیری فیش / ساتنا</label>
                <input
                  type="text"
                  placeholder="مثال: SN-984512"
                  value={bankTransferRef}
                  onChange={(e) => setBankTransferRef(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Cheque & Cash Amounts */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">مبلغ چک‌های دریافتی / پرداختی (ریال)</label>
                <input
                  type="text"
                  value={formatWithCommas(chequeAmount)}
                  onChange={(e) => setChequeAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-purple-300 font-bold text-left focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">مبلغ نقدی تسویه‌شده (ریال)</label>
                <input
                  type="text"
                  value={formatWithCommas(cashAmount)}
                  onChange={(e) => setCashAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-bold text-left focus:border-cyan-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت سند تسویه</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors"
                >
                  <option value="completed">تکمیل و نهایی شده</option>
                  <option value="draft">پیش‌نویس / در حال بررسی</option>
                  <option value="cancelled">باطل شده</option>
                </select>
              </div>

              {/* Notes */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">توضیحات و شرح تسویه حساب</label>
                <textarea
                  rows={2}
                  placeholder="شرح توافقات تسویه، فاکتورهای مربوطه و ملاحظات مالی..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-cyan-500 outline-none transition-colors text-xs"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveSubView('list')}
                className="px-5 py-2.5 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {editingSettlement ? 'ذخیره تغییرات' : 'ثبت سند تسویه حساب'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* List View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          {/* Unified Date Filter Bar */}
          <TreasuryDateFilterBar
            dateFilterMode={dateFilterMode}
            setDateFilterMode={setDateFilterMode}
            specificDate={specificDate}
            setSpecificDate={setSpecificDate}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            title="فیلتر زمانی اسناد تسویه حساب:"
            colorScheme="cyan"
          />

          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو با نام طرف حساب، شماره سند، کد پیگیری فیش..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-white focus:border-cyan-500 outline-none transition-colors placeholder:text-slate-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-cyan-500 outline-none transition-colors"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="completed">تکمیل شده</option>
                <option value="draft">پیش‌نویس</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCSV}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="خروجی فایل CSV اکسل"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">اکسل</span>
              </button>

              <button
                onClick={() => printElement('settlement-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست تسویه‌ها"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت سند تسویه جدید</span>
              </button>
            </div>
          </div>

          {/* Settlements Table */}
          <div id="settlement-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره سند / تاریخ</th>
                  <th className="p-3.5">طرف حساب</th>
                  <th className="p-3.5 text-left">کل مبلغ تسویه (ریال)</th>
                  <th className="p-3.5 text-left">تخفیف تسویه</th>
                  <th className="p-3.5 text-left">واریز بانکی / نقد</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredSettlements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ سند تسویه حسابی یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((s, index) => {
                    return (
                      <tr key={s.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-cyan-400">{s.settlementNo}</div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {toPersianDigits(s.date)}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {s.partyName}
                          </div>
                          <span className="text-[10px] text-slate-500 block">
                            {s.partyType === 'customer' ? 'مشتری' : 'تامین‌کننده'}
                          </span>
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className="font-black text-sm text-emerald-400">
                            {toPersianDigits(formatWithCommas(s.totalSettledAmount))}
                          </div>
                        </td>
                        <td className="p-3.5 text-left font-mono text-amber-300 font-bold">
                          {s.discountAmount ? toPersianDigits(formatWithCommas(s.discountAmount)) : '-'}
                        </td>
                        <td className="p-3.5 text-left font-mono space-y-0.5">
                          {s.bankTransferAmount ? (
                            <div className="text-cyan-300">
                              بانک: {toPersianDigits(formatWithCommas(s.bankTransferAmount))}
                            </div>
                          ) : null}
                          {s.cashAmount ? (
                            <div className="text-slate-400 text-[10px]">
                              نقد: {toPersianDigits(formatWithCommas(s.cashAmount))}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            s.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {s.status === 'completed' ? 'تکمیل شده' : 'پیش‌نویس'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(s)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش سند"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(s)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف سند"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
      )}
    </div>
  );
}
