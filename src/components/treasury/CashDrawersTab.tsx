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
  toPersianDigits, formatWithCommas, parseNumber, printElement, matchPersianString 
} from '../../utils/persianUtils';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../../utils/simpleId';
import {
  KpiStrip,
  UnifiedToolbar,
  UnifiedFilterBar,
  UNIFIED_FILTER_SELECT_CLASS,
  UNIFIED_FILTER_LABEL_CLASS,
} from '../ui/UnifiedErpUi';
import {
  exportRowsToExcel,
  downloadTemplateExcel,
  readSpreadsheetRows,
  pickRowField,
} from '../../utils/tableIoUtils';

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
  const [cashierFilter, setCashierFilter] = useState<string>('all');
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
      if (cashierFilter === 'unassigned' && d.cashierId) return false;
      if (cashierFilter !== 'all' && cashierFilter !== 'unassigned' && d.cashierId !== cashierFilter) return false;
      return true;
    });
  }, [drawers, searchQuery, statusFilter, cashierFilter, cashierMap]);

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

  const handleExportExcel = () => {
    const rows = filteredDrawers.map(d => ({
      'کد صندوق': d.code,
      'نام صندوق': d.name,
      'محل استقرار': d.location || '',
      'صندوق‌دار مسئول': d.cashierId ? (cashierMap[d.cashierId] || '-') : 'مشترک',
      'موجودی اولیه (ریال)': d.initialBalance || 0,
      'موجودی لحظه‌ای (ریال)': drawerBalances[d.id] || d.initialBalance || 0,
      'سقف مجاز نقدینگی (ریال)': d.maxLimit || 0,
      'کد حسابداری': d.accountingCode || '',
      'وضعیت': d.isActive ? 'فعال' : 'غیرفعال',
    }));
    exportRowsToExcel(rows, 'صندوق‌های نقدی', 'گزارش_صندوق_های_نقدی');
  };

  const handleDownloadTemplate = () => {
    downloadTemplateExcel(
      ['کد صندوق', 'نام صندوق', 'محل استقرار', 'موجودی اولیه (ریال)', 'سقف مجاز نقدینگی (ریال)', 'کد حسابداری', 'وضعیت', 'توضیحات'],
      [{
        'کد صندوق': 'CSH-01',
        'نام صندوق': 'صندوق پیشخوان فروشگاه',
        'محل استقرار': 'پیشخوان اصلی',
        'موجودی اولیه (ریال)': 5000000,
        'سقف مجاز نقدینگی (ریال)': 100000000,
        'کد حسابداری': '102001',
        'وضعیت': 'فعال',
        'توضیحات': '',
      }],
      'قالب_صندوق',
      'نمونه_صندوق_های_نقدی'
    );
  };

  const handleImportExcel = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) return;
      const currentList = db.cashDrawers || [];
      const genId = createSimpleIdGenerator(currentList, getPrefixForCollection('cashDrawers'));
      const imported: CashDrawer[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const drawerName = pickRowField(row, ['نام صندوق', 'عنوان', 'name']);
        if (!drawerName) continue;
        const drawerCode = pickRowField(row, ['کد صندوق', 'کد', 'code']) || `CSH-${(drawers.length + i + 1).toString().padStart(2, '0')}`;
        const statusRaw = pickRowField(row, ['وضعیت', 'status']);
        imported.push({
          id: genId(),
          periodId: activePeriodId,
          code: drawerCode,
          name: drawerName,
          location: pickRowField(row, ['محل استقرار', 'محل', 'location']) || 'پیشخوان فروشگاه',
          initialBalance: parseNumber(pickRowField(row, ['موجودی اولیه (ریال)', 'موجودی اولیه', 'initialBalance'])) || 0,
          maxLimit: parseNumber(pickRowField(row, ['سقف مجاز نقدینگی (ریال)', 'سقف مجاز نقدینگی', 'maxLimit'])) || 0,
          accountingCode: pickRowField(row, ['کد حسابداری', 'accountingCode']),
          isActive: statusRaw !== 'غیرفعال',
          notes: pickRowField(row, ['توضیحات', 'notes']),
          createdAt: new Date().toLocaleDateString('fa-IR'),
        });
      }
      if (imported.length > 0) {
        onUpdateDb({ ...db, cashDrawers: [...imported, ...currentList] });
      }
    } catch (err) {
      console.error('Cash drawers import error:', err);
    }
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || statusFilter !== 'all' || cashierFilter !== 'all');
  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCashierFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Unified KPI Strip */}
      <KpiStrip
        items={[
          { label: 'تعداد کل صندوق‌ها', value: stats.totalCount, sublabel: 'صندوق' },
          { label: 'صندوق‌های فعال', value: stats.activeCount, sublabel: 'فعال', tone: 'success' },
          { label: 'مجموع موجودی اولیه', value: toPersianDigits(formatWithCommas(stats.totalInitial)), sublabel: 'ریال', tone: 'info' },
          { label: 'مجموع نقدینگی حاضر', value: toPersianDigits(formatWithCommas(stats.totalCurrent)), sublabel: 'ریال', tone: 'warning' },
        ]}
      />

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
                className="px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
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
          {/* Unified Toolbar & Filter Bar */}
          <UnifiedToolbar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="جستجو بر اساس نام صندوق، کد، محل استقرار یا نام مسئول..."
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onDownloadTemplate={handleDownloadTemplate}
            onImportExcel={handleImportExcel}
            onExportExcel={handleExportExcel}
            onPrint={() => printElement('cash-drawers-table-print', 'فهرست صندوق‌های نقدی')}
            onAdd={handleOpenNew}
            addLabel="تعریف صندوق جدید"
          />

          <UnifiedFilterBar columnsClass="grid-cols-1 sm:grid-cols-2">
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>صندوق‌دار مسئول</label>
              <select
                value={cashierFilter}
                onChange={(e) => setCashierFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه مسئولین</option>
                <option value="unassigned">مشترک / بدون مسئول ثابت</option>
                {cashiers.map(c => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت صندوق</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="active">فقط فعال</option>
                <option value="inactive">غیرفعال</option>
              </select>
            </div>
          </UnifiedFilterBar>

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
