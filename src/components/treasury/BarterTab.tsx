/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, BarterTransaction, Customer, Supplier } from '../../types';
import { 
  Repeat, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  ArrowLeftRight, FileText, Hash, FileSpreadsheet, Printer, 
  Save, X, Calendar, User, Banknote, ShieldCheck, Scale
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString,
  getTodayJalali, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate
} from '../../utils/persianUtils';
import TreasuryDateFilterBar, { DateFilterMode } from './TreasuryDateFilterBar';

interface BarterTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export default function BarterTab({ db, onUpdateDb, activePeriodId, askConfirm }: BarterTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingBarter, setEditingBarter] = useState<BarterTransaction | null>(null);

  // Unified Date Filter State (Default to 'today')
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('today');
  const [specificDate, setSpecificDate] = useState<string>(getTodayJalali());
  const [fromDate, setFromDate] = useState<string>(getRelativeJalaliDate(-7));
  const [toDate, setToDate] = useState<string>(getTodayJalali());

  // Form State
  const [barterNo, setBarterNo] = useState('');
  const [date, setDate] = useState(getTodayJalali());
  const [partyAType, setPartyAType] = useState<'customer' | 'supplier' | 'other'>('customer');
  const [partyAId, setPartyAId] = useState('');
  const [partyAName, setPartyAName] = useState('');
  const [partyBType, setPartyBType] = useState<'customer' | 'supplier' | 'other'>('supplier');
  const [partyBId, setPartyBId] = useState('');
  const [partyBName, setPartyBName] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [itemsDescription, setItemsDescription] = useState('');
  const [settlementDiffAmount, setSettlementDiffAmount] = useState<number>(0);
  const [settlementDiffMethod, setSettlementDiffMethod] = useState<'cash' | 'cheque' | 'on_account'>('on_account');
  const [contractNo, setContractNo] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'completed' | 'in_progress' | 'cancelled'>('completed');

  const barters = useMemo(() => {
    return db.barterTransactions || [];
  }, [db.barterTransactions]);

  const customers = useMemo(() => db.customers || [], [db.customers]);
  const suppliers = useMemo(() => db.suppliers || [], [db.suppliers]);

  const stats = useMemo(() => {
    const totalCount = barters.length;
    const completedCount = barters.filter(b => b.status === 'completed').length;
    const totalVolume = barters.filter(b => b.status === 'completed').reduce((sum, b) => sum + (b.amount || 0), 0);
    return { totalCount, completedCount, totalVolume };
  }, [barters]);

  const filteredBarters = useMemo(() => {
    const today = getTodayJalali();
    const yesterday = getRelativeJalaliDate(-1);
    const sevenDaysAgo = getRelativeJalaliDate(-7);
    const thirtyDaysAgo = getRelativeJalaliDate(-30);

    return barters.filter(b => {
      // Date Filtering
      if (dateFilterMode === 'today') {
        if (normalizeJalaliDate(b.date) !== normalizeJalaliDate(today)) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (normalizeJalaliDate(b.date) !== normalizeJalaliDate(yesterday)) return false;
      } else if (dateFilterMode === '7days') {
        if (!isJalaliDateInRange(b.date, sevenDaysAgo, today)) return false;
      } else if (dateFilterMode === '30days') {
        if (!isJalaliDateInRange(b.date, thirtyDaysAgo, today)) return false;
      } else if (dateFilterMode === 'specific') {
        if (normalizeJalaliDate(b.date) !== normalizeJalaliDate(specificDate)) return false;
      } else if (dateFilterMode === 'range') {
        if (!isJalaliDateInRange(b.date, fromDate, toDate)) return false;
      }

      if (searchQuery) {
        const matches = 
          matchPersianString(b.partyAName, searchQuery) ||
          matchPersianString(b.partyBName, searchQuery) ||
          b.barterNo.includes(searchQuery) ||
          matchPersianString(b.itemsDescription, searchQuery) ||
          matchPersianString(b.description || '', searchQuery);
        if (!matches) return false;
      }
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      return true;
    });
  }, [barters, dateFilterMode, specificDate, fromDate, toDate, searchQuery, statusFilter]);

  const handleOpenNew = () => {
    setEditingBarter(null);
    const seq = (barters.length + 1).toString().padStart(3, '0');
    setBarterNo(`BTR-1405-${seq}`);
    setDate(getTodayJalali());
    setPartyAType('customer');
    setPartyAId(customers[0]?.id || '');
    setPartyAName(customers[0]?.name || '');
    setPartyBType('supplier');
    setPartyBId(suppliers[0]?.id || '');
    setPartyBName(suppliers[0]?.name || '');
    setAmount(0);
    setItemsDescription('تحویل محصولات نهایی در قبال دریافت مواد اولیه');
    setSettlementDiffAmount(0);
    setSettlementDiffMethod('on_account');
    setContractNo(`CTR-BTR-${seq}`);
    setDescription('');
    setStatus('completed');
    setActiveSubView('form');
  };

  const handleOpenEdit = (b: BarterTransaction) => {
    setEditingBarter(b);
    setBarterNo(b.barterNo);
    setDate(b.date);
    setPartyAType(b.partyAType);
    setPartyAId(b.partyAId || '');
    setPartyAName(b.partyAName);
    setPartyBType(b.partyBType);
    setPartyBId(b.partyBId || '');
    setPartyBName(b.partyBName);
    setAmount(b.amount);
    setItemsDescription(b.itemsDescription);
    setSettlementDiffAmount(b.settlementDiffAmount || 0);
    setSettlementDiffMethod(b.settlementDiffMethod || 'on_account');
    setContractNo(b.contractNo || '');
    setDescription(b.description || '');
    setStatus(b.status);
    setActiveSubView('form');
  };

  const handlePartyASelect = (id: string) => {
    setPartyAId(id);
    if (partyAType === 'customer') {
      const found = customers.find(c => c.id === id);
      if (found) setPartyAName(found.name);
    } else if (partyAType === 'supplier') {
      const found = suppliers.find(s => s.id === id);
      if (found) setPartyAName(found.name);
    }
  };

  const handlePartyBSelect = (id: string) => {
    setPartyBId(id);
    if (partyBType === 'customer') {
      const found = customers.find(c => c.id === id);
      if (found) setPartyBName(found.name);
    } else if (partyBType === 'supplier') {
      const found = suppliers.find(s => s.id === id);
      if (found) setPartyBName(found.name);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyAName.trim() || !partyBName.trim() || amount <= 0) {
      alert('لطفاً مشخصات هر دو طرف تهاتر و مبلغ معتبر را وارد فرمایید.');
      return;
    }

    const currentList = db.barterTransactions || [];
    let updatedList: BarterTransaction[];

    const barterObj: BarterTransaction = {
      id: editingBarter ? editingBarter.id : `btr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      periodId: activePeriodId,
      barterNo: barterNo.trim(),
      date,
      partyAType,
      partyAId: partyAId || undefined,
      partyAName: partyAName.trim(),
      partyBType,
      partyBId: partyBId || undefined,
      partyBName: partyBName.trim(),
      amount: Number(amount) || 0,
      itemsDescription: itemsDescription.trim(),
      settlementDiffAmount: Number(settlementDiffAmount) || 0,
      settlementDiffMethod,
      contractNo: contractNo.trim(),
      description: description.trim(),
      registeredBy: 'مدیر کل سامانه گاتان',
      status,
      createdAt: editingBarter ? editingBarter.createdAt : new Date().toLocaleDateString('fa-IR')
    };

    if (editingBarter) {
      updatedList = currentList.map(b => b.id === editingBarter.id ? barterObj : b);
    } else {
      updatedList = [barterObj, ...currentList];
    }

    onUpdateDb({
      ...db,
      barterTransactions: updatedList
    });

    setActiveSubView('list');
    setEditingBarter(null);
  };

  const handleDelete = (b: BarterTransaction) => {
    askConfirm(
      'حذف سند تهاتر',
      `آیا از حذف سند تهاتر شماره "${b.barterNo}" به ارزش ${toPersianDigits(formatWithCommas(b.amount))} ریال اطمینان دارید؟`,
      () => {
        const updated = (db.barterTransactions || []).filter(item => item.id !== b.id);
        onUpdateDb({
          ...db,
          barterTransactions: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['شماره سند تهاتر', 'تاریخ', 'طرف اول', 'طرف دوم', 'ارزش مبادله (ریال)', 'شرح کالاها و خدمات مبادله شده', 'مابه‌التفاوت', 'وضعیت'];
    const rows = filteredBarters.map(b => [
      b.barterNo,
      b.date,
      b.partyAName,
      b.partyBName,
      b.amount,
      b.itemsDescription,
      b.settlementDiffAmount || 0,
      b.status === 'completed' ? 'تکمیل شده' : b.status === 'in_progress' ? 'در حال اجرا' : 'لغو شده'
    ]);
    downloadCSV('گزارش_اسناد_تهاتر_خزانه.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تعداد قراردادهای تهاتر</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Repeat className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تهاترهای نهایی و تسویه‌شده</span>
            <span className="text-2xl font-black text-emerald-400 mt-1 block">{toPersianDigits(stats.completedCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">ارزش ریالی مبادلات تهاتری</span>
            <span className="text-lg font-black text-cyan-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalVolume))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Scale className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                <Repeat className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingBarter ? 'ویرایش سند تهاتر کالا و خدمات' : 'ثبت سند تهاتر و تسویه غیرنقدی دوجانبه'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">مبادله کالا با کالا، کالا با مواد اولیه، تهاتر خدمات و تسویه حساب‌های متقابل</p>
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
              {/* Barter No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-indigo-400" />
                  شماره سند تهاتر <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={barterNo}
                  onChange={(e) => setBarterNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  تاریخ سند تهاتر <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Contract No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">شماره قرارداد / تفاهم‌نامه</label>
                <input
                  type="text"
                  placeholder="مثال: CTR-BTR-88"
                  value={contractNo}
                  onChange={(e) => setContractNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Party A */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
                <span className="font-bold text-indigo-300 block flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  طرف اول (ارائه‌دهنده کالا / مشتری)
                </span>
                <select
                  value={partyAType}
                  onChange={(e) => setPartyAType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-slate-300"
                >
                  <option value="customer">مشتری</option>
                  <option value="supplier">تامین‌کننده</option>
                  <option value="other">طرف متفرقه</option>
                </select>
                {partyAType === 'customer' ? (
                  <select
                    value={partyAId}
                    onChange={(e) => handlePartyASelect(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  >
                    <option value="">-- انتخاب مشتری --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : partyAType === 'supplier' ? (
                  <select
                    value={partyAId}
                    onChange={(e) => handlePartyASelect(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  >
                    <option value="">-- انتخاب تامین‌کننده --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="نام طرف اول"
                    value={partyAName}
                    onChange={(e) => setPartyAName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  />
                )}
              </div>

              {/* Party B */}
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-2xl space-y-3">
                <span className="font-bold text-cyan-300 block flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  طرف دوم (دریافت‌کننده کالا / تامین‌کننده)
                </span>
                <select
                  value={partyBType}
                  onChange={(e) => setPartyBType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-slate-300"
                >
                  <option value="supplier">تامین‌کننده مواد اولیه</option>
                  <option value="customer">مشتری</option>
                  <option value="other">طرف متفرقه</option>
                </select>
                {partyBType === 'supplier' ? (
                  <select
                    value={partyBId}
                    onChange={(e) => handlePartyBSelect(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  >
                    <option value="">-- انتخاب تامین‌کننده --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : partyBType === 'customer' ? (
                  <select
                    value={partyBId}
                    onChange={(e) => handlePartyBSelect(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  >
                    <option value="">-- انتخاب مشتری --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="نام طرف دوم"
                    value={partyBName}
                    onChange={(e) => setPartyBName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-white"
                  />
                )}
              </div>

              {/* Amount & Status */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                    ارزش ریالی معامله تهاتری (ریال) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formatWithCommas(amount)}
                    onChange={(e) => setAmount(parseNumber(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-black text-sm text-left focus:border-indigo-500 outline-none transition-colors font-mono"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">وضعیت تسویه تهاتر</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors"
                  >
                    <option value="completed">تکمیل و تسویه شده</option>
                    <option value="in_progress">در حال اجرا / تحویل تدریجی</option>
                    <option value="cancelled">لغو شده</option>
                  </select>
                </div>
              </div>

              {/* Items Description */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">شرح اقلام و کالاهای مبادله شده</label>
                <textarea
                  rows={2}
                  placeholder="مثال: تحویل ۵۰ عدد کیک مجلسی و ۱۰۰ عدد کروسان در ازای دریافت ۱۰ کارتن کره مارگارین و ۵ کیسه شکر..."
                  value={itemsDescription}
                  onChange={(e) => setItemsDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors text-xs"
                  required
                />
              </div>

              {/* Description */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">توضیحات و توافقات حسابداری</label>
                <textarea
                  rows={2}
                  placeholder="نحوه صدور فاکتور رسمی دو طرف، تراز دفاتر مالی و..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-indigo-500 outline-none transition-colors text-xs"
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
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {editingBarter ? 'ذخیره تغییرات' : 'ثبت سند تهاتر'}
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
            title="فیلتر زمانی قراردادهای تهاتر:"
            colorScheme="indigo"
          />

          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو در قراردادهای تهاتر، نام طرفین، شرح اقلام..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-white focus:border-indigo-500 outline-none transition-colors placeholder:text-slate-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-indigo-500 outline-none transition-colors"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="completed">تکمیل شده</option>
                <option value="in_progress">در حال اجرا</option>
                <option value="cancelled">لغو شده</option>
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
                onClick={() => printElement('barter-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست تهاترها"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت سند تهاتر جدید</span>
              </button>
            </div>
          </div>

          {/* Barters Table */}
          <div id="barter-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره سند / تاریخ</th>
                  <th className="p-3.5">طرف اول مبادله</th>
                  <th className="p-3.5 text-center">
                    <ArrowLeftRight className="w-4 h-4 mx-auto text-indigo-400" />
                  </th>
                  <th className="p-3.5">طرف دوم مبادله</th>
                  <th className="p-3.5">شرح اقلام و کالاهای مبادله‌شده</th>
                  <th className="p-3.5 text-left">ارزش تهاتر (ریال)</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredBarters.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      هیچ سند تهاتری منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredBarters.map((b, index) => {
                    return (
                      <tr key={b.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-indigo-400">{b.barterNo}</div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {toPersianDigits(b.date)}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white">{b.partyAName}</div>
                          <span className="text-[10px] text-slate-500 block">
                            {b.partyAType === 'customer' ? 'مشتری' : 'تامین‌کننده'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className="p-1 rounded bg-indigo-500/10 text-indigo-400 inline-block font-mono text-[10px]">
                            تهاتر
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-cyan-300">{b.partyBName}</div>
                          <span className="text-[10px] text-slate-500 block">
                            {b.partyBType === 'supplier' ? 'تامین‌کننده' : 'مشتری'}
                          </span>
                        </td>
                        <td className="p-3.5 max-w-[240px]">
                          <div className="text-slate-200 line-clamp-2">{b.itemsDescription}</div>
                          {b.contractNo && (
                            <span className="text-[10px] text-indigo-400 font-mono block mt-0.5">
                              قرارداد: {b.contractNo}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className="font-black text-sm text-emerald-400">
                            {toPersianDigits(formatWithCommas(b.amount))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">ریال</span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            b.status === 'completed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : b.status === 'in_progress'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {b.status === 'completed' ? 'تکمیل شده' : b.status === 'in_progress' ? 'در حال اجرا' : 'لغو شده'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(b)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش سند"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(b)}
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
