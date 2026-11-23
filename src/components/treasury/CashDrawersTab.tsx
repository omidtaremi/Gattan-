/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, CashDrawer, Cashier } from '../../types';
import { 
  Vault, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  Coins, Hash, FileSpreadsheet, Printer, Save, X, AlertTriangle, 
  UserCheck, ArrowUpDown, ChevronDown, Check, Eye, RefreshCw, Wallet, ShieldAlert
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
} from '../../utils/persianUtils';
import { nextSimpleId, getPrefixForCollection } from '../../utils/simpleId';

interface CashDrawersTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export default function CashDrawersTab({ db, onUpdateDb, activePeriodId, askConfirm }: CashDrawersTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingDrawer, setEditingDrawer] = useState<CashDrawer | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [maxLimit, setMaxLimit] = useState<number>(0);
  const [accountingCode, setAccountingCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  const drawers = useMemo(() => {
    return (db.cashDrawers || []).filter(d => d.periodId === activePeriodId);
  }, [db.cashDrawers, activePeriodId]);

  const cashiers = useMemo(() => {
    return (db.cashiers || []).filter(c => c.periodId === activePeriodId);
  }, [db.cashiers, activePeriodId]);

  const cashierMap = useMemo(() => {
    const map: Record<string, string> = {};
    cashiers.forEach(c => { map[c.id] = c.fullName; });
    return map;
  }, [cashiers]);

  // Drawer Balance calculation (initial balance + cash receipts - cash payments, active period only)
  const drawerBalances = useMemo(() => {
    const map: Record<string, number> = {};
    const periodReceipts = (db.treasuryReceipts || []).filter(r => r.periodId === activePeriodId);
    const periodPayments = (db.treasuryPayments || []).filter(p => p.periodId === activePeriodId);
    drawers.forEach(d => {
      let balance = d.initialBalance || 0;
      periodReceipts.forEach(r => {
        if (r.cashDrawerId === d.id && r.status === 'confirmed' && r.paymentMethod === 'cash') {
          balance += (r.amount || 0);
        }
      });
      periodPayments.forEach(p => {
        if (p.cashDrawerId === d.id && p.status === 'confirmed' && p.paymentMethod === 'cash') {
          balance -= (p.amount || 0);
        }
      });
      map[d.id] = balance;
    });
    return map;
  }, [drawers, db.treasuryReceipts, db.treasuryPayments, activePeriodId]);

  const stats = useMemo(() => {
    const totalCount = drawers.length;
    const activeCount = drawers.filter(d => d.isActive).length;
    const totalInitial = drawers.reduce((sum, d) => sum + (d.initialBalance || 0), 0);
    const totalCurrent = drawers.reduce((sum, d) => sum + (drawerBalances[d.id] || d.initialBalance || 0), 0);
    return { totalCount, activeCount, totalInitial, totalCurrent };
  }, [drawers, drawerBalances]);

  const filteredDrawers = useMemo(() => {
    return drawers.filter(d => {
      if (searchQuery) {
        const matches = 
          matchPersianString(d.name, searchQuery) ||
          matchPersianString(d.location, searchQuery) ||
          d.code.includes(searchQuery) ||
          (d.cashierId && matchPersianString(cashierMap[d.cashierId] || '', searchQuery));
        if (!matches) return false;
      }
      if (statusFilter === 'active' && !d.isActive) return false;
      if (statusFilter === 'inactive' && d.isActive) return false;
      return true;
    });
  }, [drawers, searchQuery, statusFilter, cashierMap]);

  const handleOpenNew = () => {
    setEditingDrawer(null);
    const nextNum = (drawers.length + 1).toString().padStart(2, '0');
    setCode(`CSH-${nextNum}`);
    setName('');
    setLocation('پیشخوان فروشگاه');
    setCashierId('');
    setInitialBalance(0);
    setMaxLimit(100000000);
    setAccountingCode(`1020${nextNum}`);
    setIsActive(true);
    setNotes('');
    setActiveSubView('form');
  };

  const handleOpenEdit = (d: CashDrawer) => {
    setEditingDrawer(d);
    setCode(d.code);
    setName(d.name);
    setLocation(d.location);
    setCashierId(d.cashierId || '');
    setInitialBalance(d.initialBalance || 0);
    setMaxLimit(d.maxLimit || 0);
    setAccountingCode(d.accountingCode || '');
    setIsActive(d.isActive);
    setNotes(d.notes || '');
    setActiveSubView('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      alert('لطفاً نام و کد صندوق را تکمیل فرمایید.');
      return;
    }

    const currentList = db.cashDrawers || [];
    let updatedList: CashDrawer[];

    if (editingDrawer) {
      updatedList = currentList.map(d => d.id === editingDrawer.id ? {
        ...d,
        code: code.trim(),
        name: name.trim(),
        location: location.trim(),
        cashierId: cashierId || undefined,
        initialBalance: Number(initialBalance) || 0,
        maxLimit: Number(maxLimit) || 0,
        accountingCode: accountingCode.trim(),
        isActive,
        notes: notes.trim()
      } : d);
    } else {
      const newDrawer: CashDrawer = {
        id: nextSimpleId(currentList, getPrefixForCollection('cashDrawers')),
        periodId: activePeriodId,
        code: code.trim(),
        name: name.trim(),
        location: location.trim(),
        cashierId: cashierId || undefined,
        initialBalance: Number(initialBalance) || 0,
        maxLimit: Number(maxLimit) || 0,
        accountingCode: accountingCode.trim(),
        isActive,
        notes: notes.trim(),
        createdAt: new Date().toLocaleDateString('fa-IR')
      };
      updatedList = [newDrawer, ...currentList];
    }

    onUpdateDb({
      ...db,
      cashDrawers: updatedList
    });

    setActiveSubView('list');
    setEditingDrawer(null);
  };

  const handleDelete = (d: CashDrawer) => {
    askConfirm(
      'حذف صندوق نقدی',
      `آیا از حذف "${d.name} (${d.code})" اطمینان دارید؟ در صورت وجود اسناد مالی و دریافت نقدی، حذف این صندوق ممکن است گزارش‌ها را دچار مغایرت کند.`,
      () => {
        const updated = (db.cashDrawers || []).filter(item => item.id !== d.id);
        onUpdateDb({
          ...db,
          cashDrawers: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['کد صندوق', 'نام صندوق', 'محل استقرار', 'صندوق‌دار مسئول', 'موجودی اولیه (ریال)', 'موجودی لحظه‌ای (ریال)', 'سقف مجاز نقدینگی', 'کد حسابداری', 'وضعیت'];
    const rows = filteredDrawers.map(d => [
      d.code,
      d.name,
      d.location,
      d.cashierId ? (cashierMap[d.cashierId] || '-') : '-',
      d.initialBalance || 0,
      drawerBalances[d.id] || d.initialBalance || 0,
      d.maxLimit || 0,
      d.accountingCode || '-',
      d.isActive ? 'فعال' : 'غیرفعال'
    ]);
    downloadCSV('گزارش_صندوق_های_نقدی.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تعداد کل صندوق‌ها</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Vault className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">صندوق‌های فعال</span>
            <span className="text-2xl font-black text-emerald-400 mt-1 block">{toPersianDigits(stats.activeCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع موجودی اولیه صندوق‌ها</span>
            <span className="text-lg font-black text-cyan-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalInitial))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Coins className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع نقدینگی حاضر در صندوق‌ها</span>
            <span className="text-lg font-black text-rose-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalCurrent))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <Wallet className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
                <Vault className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingDrawer ? 'ویرایش اطلاعات صندوق' : 'تعریف صندوق نقدینگی جدید'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">تعیین محل، مسئول صندوق، سقف نگهداری نقدینگی و موجودی اولیه</p>
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
              {/* Code */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-amber-400" />
                  کد صندوق <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="CSH-01"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors font-mono uppercase"
                  required
                />
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">
                  نام صندوق <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="مثال: صندوق مرکزی فروشگاه، صندوق کافه، تنخواه کارخانه"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                  required
                />
              </div>

              {/* Location */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">محل استقرار / بخش</label>
                <input
                  type="text"
                  placeholder="مثال: پیشخوان اصلی فروشگاه، سالن کافه، دفتر کارخانه"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                />
              </div>

              {/* Assigned Cashier */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                  صندوق‌دار مسئول پیش‌فرض
                </label>
                <select
                  value={cashierId}
                  onChange={(e) => setCashierId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                >
                  <option value="">بدون مسئول ثابت (مشترک)</option>
                  {cashiers.map(c => (
                    <option key={c.id} value={c.id}>{c.fullName} ({c.code})</option>
                  ))}
                </select>
              </div>

              {/* Initial Balance */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">موجودی نقدی اولیه در بدو دوره (ریال)</label>
                <input
                  type="text"
                  value={formatWithCommas(initialBalance)}
                  onChange={(e) => setInitialBalance(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-bold text-left focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Max Limit */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  سقف مجاز نگهداری وجه نقد (ریال)
                </label>
                <input
                  type="text"
                  value={formatWithCommas(maxLimit)}
                  onChange={(e) => setMaxLimit(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-rose-300 font-bold text-left focus:border-amber-500 outline-none transition-colors font-mono"
                  placeholder="جهت هشدار و واریز به گاوصندوق"
                />
              </div>

              {/* Accounting Code */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">کد تفصیلی حسابداری</label>
                <input
                  type="text"
                  placeholder="مثال: 102001"
                  value={accountingCode}
                  onChange={(e) => setAccountingCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت صندوق</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                >
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال / موقت</option>
                </select>
              </div>

              {/* Notes */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">توضیحات و دستورالعمل</label>
                <textarea
                  rows={2}
                  placeholder="توضیحات مربوط به شرایط تحویل شیفت، کلیدها، یا مقررات نقدینگی این صندوق..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors text-xs"
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
                className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {editingDrawer ? 'ذخیره تغییرات' : 'ثبت نهایی صندوق'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* List View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو بر اساس نام صندوق، کد، محل استقرار یا نام مسئول..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-white focus:border-amber-500 outline-none transition-colors placeholder:text-slate-500"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-amber-500 outline-none transition-colors"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="active">فقط فعال</option>
                <option value="inactive">غیرفعال</option>
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
                onClick={() => printElement('cash-drawers-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست صندوق‌ها"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>تعریف صندوق جدید</span>
              </button>
            </div>
          </div>

          {/* Drawers Table */}
          <div id="cash-drawers-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">کد و عنوان صندوق</th>
                  <th className="p-3.5">محل استقرار</th>
                  <th className="p-3.5">صندوق‌دار مسئول</th>
                  <th className="p-3.5 text-left">موجودی نقدی لحظه‌ای (ریال)</th>
                  <th className="p-3.5 text-left">سقف مجاز نقدینگی</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredDrawers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ صندوق نقدی منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredDrawers.map((d, index) => {
                    const currentBal = drawerBalances[d.id] || d.initialBalance || 0;
                    const isOverLimit = d.maxLimit && d.maxLimit > 0 && currentBal > d.maxLimit;

                    return (
                      <tr key={d.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <Vault className="w-3.5 h-3.5 text-amber-400" />
                            {d.name}
                          </div>
                          <span className="font-mono text-[10px] text-amber-300/80 mt-0.5 block">
                            {d.code} {d.accountingCode ? `| کد معین: ${toPersianDigits(d.accountingCode)}` : ''}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-300">{d.location || 'مرکزی'}</td>
                        <td className="p-3.5">
                          {d.cashierId && cashierMap[d.cashierId] ? (
                            <span className="inline-flex items-center gap-1 text-slate-200">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                              {cashierMap[d.cashierId]}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px]">مشترک / عمومی</span>
                          )}
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className={`font-black text-sm ${currentBal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {toPersianDigits(formatWithCommas(currentBal))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            اولیه: {toPersianDigits(formatWithCommas(d.initialBalance || 0))}
                          </span>
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          {d.maxLimit && d.maxLimit > 0 ? (
                            <div>
                              <div className={`text-xs font-bold ${isOverLimit ? 'text-rose-400 animate-pulse flex items-center gap-1 justify-end' : 'text-slate-300'}`}>
                                {isOverLimit && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                                {toPersianDigits(formatWithCommas(d.maxLimit))}
                              </div>
                              {isOverLimit && (
                                <span className="text-[9.5px] text-rose-400 font-sans block">
                                  هشدار: مازاد بر سقف! انتقال به گاوصندوق
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600 text-[11px]">بدون سقف</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            d.isActive 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {d.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(d)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش صندوق"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(d)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف صندوق"
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
