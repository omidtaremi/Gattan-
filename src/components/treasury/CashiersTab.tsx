/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Cashier, CashDrawer } from '../../types';
import { 
  Users, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  UserCheck, Hash, FileSpreadsheet, Printer, Save, X, AlertTriangle, 
  Vault, Shield, KeyRound, Phone, Clock, Percent, Eye, RefreshCw
} from 'lucide-react';
import { 
  toPersianDigits, parseNumber, printElement, matchPersianString 
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

interface CashiersTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

const AVAILABLE_PERMISSIONS = [
  { key: 'cash_receipt', label: 'دریافت نقد از مشتری' },
  { key: 'pos_receipt', label: 'دریافت کارتخوان (پوز)' },
  { key: 'returns', label: 'ثبت مرجوعی کالا / فاکتور برگشتی' },
  { key: 'discount_apply', label: 'اعمال تخفیف تا سقف مجاز' },
  { key: 'shift_closeout', label: 'بستن شیفت و تسویه پایان وقت' }
];

export default function CashiersTab({ db, onUpdateDb, activePeriodId, askConfirm }: CashiersTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingCashier, setEditingCashier] = useState<Cashier | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [phone, setPhone] = useState('');
  const [defaultCashDrawerId, setDefaultCashDrawerId] = useState('');
  const [shiftType, setShiftType] = useState<'صبح' | 'عصر' | 'شب' | 'چرخشی'>('صبح');
  const [maxDiscountPercent, setMaxDiscountPercent] = useState<number>(5);
  const [permissions, setPermissions] = useState<string[]>(['cash_receipt', 'pos_receipt', 'shift_closeout']);
  const [pinCode, setPinCode] = useState('');
  const [startDate, setStartDate] = useState(new Date().toLocaleDateString('fa-IR'));
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  const cashiers = useMemo(() => {
    return (db.cashiers || []).filter(c => c.periodId === activePeriodId);
  }, [db.cashiers, activePeriodId]);

  const cashDrawers = useMemo(() => {
    return (db.cashDrawers || []).filter(d => d.periodId === activePeriodId);
  }, [db.cashDrawers, activePeriodId]);

  const cashDrawerMap = useMemo(() => {
    const map: Record<string, string> = {};
    cashDrawers.forEach(d => { map[d.id] = `${d.name} (${d.code})`; });
    return map;
  }, [cashDrawers]);

  // Cashier shift closeout count (active period only)
  const cashierStats = useMemo(() => {
    const map: Record<string, { closeoutsCount: number; receiptsCount: number }> = {};
    const periodCloseouts = (db.cashierShiftCloseouts || []).filter(cl => cl.periodId === activePeriodId);
    const periodReceipts = (db.treasuryReceipts || []).filter(r => r.periodId === activePeriodId);
    cashiers.forEach(c => {
      const closeoutsCount = periodCloseouts.filter(cl => cl.cashierId === c.id).length;
      const receiptsCount = periodReceipts.filter(r => r.cashierId === c.id).length;
      map[c.id] = { closeoutsCount, receiptsCount };
    });
    return map;
  }, [cashiers, db.cashierShiftCloseouts, db.treasuryReceipts, activePeriodId]);

  const stats = useMemo(() => {
    const totalCount = cashiers.length;
    const activeCount = cashiers.filter(c => c.isActive).length;
    const morningCount = cashiers.filter(c => c.shiftType === 'صبح').length;
    const eveningCount = cashiers.filter(c => c.shiftType === 'عصر').length;
    return { totalCount, activeCount, morningCount, eveningCount };
  }, [cashiers]);

  const filteredCashiers = useMemo(() => {
    return cashiers.filter(c => {
      if (searchQuery) {
        const matches = 
          matchPersianString(c.fullName, searchQuery) ||
          c.code.includes(searchQuery) ||
          (c.phone && c.phone.includes(searchQuery)) ||
          (c.nationalId && c.nationalId.includes(searchQuery));
        if (!matches) return false;
      }
      if (shiftFilter !== 'all' && c.shiftType !== shiftFilter) return false;
      if (statusFilter === 'active' && !c.isActive) return false;
      if (statusFilter === 'inactive' && c.isActive) return false;
      return true;
    });
  }, [cashiers, searchQuery, shiftFilter, statusFilter]);

  const handleOpenNew = () => {
    setEditingCashier(null);
    const nextNum = (cashiers.length + 101).toString();
    setCode(`CSHR-${nextNum}`);
    setFullName('');
    setNationalId('');
    setPhone('');
    setDefaultCashDrawerId(cashDrawers[0]?.id || '');
    setShiftType('صبح');
    setMaxDiscountPercent(5);
    setPermissions(['cash_receipt', 'pos_receipt', 'shift_closeout']);
    setPinCode('1234');
    setStartDate(new Date().toLocaleDateString('fa-IR'));
    setIsActive(true);
    setNotes('');
    setActiveSubView('form');
  };

  const handleOpenEdit = (c: Cashier) => {
    setEditingCashier(c);
    setCode(c.code);
    setFullName(c.fullName);
    setNationalId(c.nationalId || '');
    setPhone(c.phone || '');
    setDefaultCashDrawerId(c.defaultCashDrawerId || '');
    setShiftType(c.shiftType);
    setMaxDiscountPercent(c.maxDiscountPercent || 0);
    setPermissions(c.permissions || []);
    setPinCode(c.pinCode || '');
    setStartDate(c.startDate || new Date().toLocaleDateString('fa-IR'));
    setIsActive(c.isActive);
    setNotes(c.notes || '');
    setActiveSubView('form');
  };

  const togglePermission = (permKey: string) => {
    if (permissions.includes(permKey)) {
      setPermissions(permissions.filter(p => p !== permKey));
    } else {
      setPermissions([...permissions, permKey]);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !code.trim()) {
      alert('لطفاً نام کامل و کد صندوق‌دار را وارد نمایید.');
      return;
    }

    const currentList = db.cashiers || [];
    let updatedList: Cashier[];

    if (editingCashier) {
      updatedList = currentList.map(c => c.id === editingCashier.id ? {
        ...c,
        code: code.trim(),
        fullName: fullName.trim(),
        nationalId: nationalId.trim(),
        phone: phone.trim(),
        defaultCashDrawerId: defaultCashDrawerId || undefined,
        shiftType,
        maxDiscountPercent: Number(maxDiscountPercent) || 0,
        permissions,
        pinCode: pinCode.trim(),
        startDate,
        isActive,
        notes: notes.trim()
      } : c);
    } else {
      const newCashier: Cashier = {
        id: nextSimpleId(currentList, getPrefixForCollection('cashiers')),
        periodId: activePeriodId,
        code: code.trim(),
        fullName: fullName.trim(),
        nationalId: nationalId.trim(),
        phone: phone.trim(),
        defaultCashDrawerId: defaultCashDrawerId || undefined,
        shiftType,
        maxDiscountPercent: Number(maxDiscountPercent) || 0,
        permissions,
        pinCode: pinCode.trim(),
        startDate,
        isActive,
        notes: notes.trim(),
        createdAt: new Date().toLocaleDateString('fa-IR')
      };
      updatedList = [newCashier, ...currentList];
    }

    onUpdateDb({
      ...db,
      cashiers: updatedList
    });

    setActiveSubView('list');
    setEditingCashier(null);
  };

  const handleDelete = (c: Cashier) => {
    askConfirm(
      'حذف صندوق‌دار',
      `آیا از حذف صندوق‌دار "${c.fullName} (${c.code})" اطمینان دارید؟`,
      () => {
        const updated = (db.cashiers || []).filter(item => item.id !== c.id);
        onUpdateDb({
          ...db,
          cashiers: updated
        });
      }
    );
  };

  const handleExportExcel = () => {
    const rows = filteredCashiers.map(c => {
      const info = cashierStats[c.id] || { closeoutsCount: 0, receiptsCount: 0 };
      return {
        'کد پرسنلی صندوق‌دار': c.code,
        'نام و نام خانوادگی': c.fullName,
        'کد ملی': c.nationalId || '',
        'شماره تماس': c.phone || '',
        'صندوق پیش‌فرض': c.defaultCashDrawerId ? (cashDrawerMap[c.defaultCashDrawerId] || '') : '',
        'شیفت کاری': c.shiftType,
        'سقف تخفیف (%)': c.maxDiscountPercent || 0,
        'تعداد تسویه شیفت': info.closeoutsCount,
        'وضعیت': c.isActive ? 'فعال' : 'غیرفعال',
      };
    });
    exportRowsToExcel(rows, 'صندوق‌داران', 'گزارش_صندوق_داران');
  };

  const handleDownloadTemplate = () => {
    downloadTemplateExcel(
      ['کد پرسنلی صندوق‌دار', 'نام و نام خانوادگی', 'کد ملی', 'شماره تماس', 'شیفت کاری', 'سقف تخفیف (%)', 'وضعیت', 'توضیحات'],
      [{
        'کد پرسنلی صندوق‌دار': 'CSHR-101',
        'نام و نام خانوادگی': 'فاطمه رستمی',
        'کد ملی': '0019876543',
        'شماره تماس': '09121234567',
        'شیفت کاری': 'صبح',
        'سقف تخفیف (%)': 5,
        'وضعیت': 'فعال',
        'توضیحات': '',
      }],
      'قالب_صندوق‌داران',
      'نمونه_صندوق_داران'
    );
  };

  const handleImportExcel = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) return;
      const currentList = db.cashiers || [];
      const genId = createSimpleIdGenerator(currentList, getPrefixForCollection('cashiers'));
      const imported: Cashier[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const nameVal = pickRowField(row, ['نام و نام خانوادگی', 'نام', 'fullName']);
        if (!nameVal) continue;
        const codeVal = pickRowField(row, ['کد پرسنلی صندوق‌دار', 'کد', 'code']) || `CSHR-${cashiers.length + 101 + i}`;
        const rawShift = pickRowField(row, ['شیفت کاری', 'شیفت', 'shiftType']);
        const shiftVal: Cashier['shiftType'] =
          rawShift === 'عصر' || rawShift === 'شب' || rawShift === 'گردشی'
            ? rawShift
            : rawShift === 'چرخشی'
            ? 'گردشی'
            : 'صبح';
        const statusRaw = pickRowField(row, ['وضعیت', 'status']);
        imported.push({
          id: genId(),
          periodId: activePeriodId,
          code: codeVal,
          fullName: nameVal,
          nationalId: pickRowField(row, ['کد ملی', 'nationalId']),
          phone: pickRowField(row, ['شماره تماس', 'موبایل', 'phone']),
          defaultCashDrawerId: cashDrawers[0]?.id || undefined,
          shiftType: shiftVal,
          maxDiscountPercent: parseNumber(pickRowField(row, ['سقف تخفیف (%)', 'سقف تخفیف', 'maxDiscountPercent'])) || 5,
          permissions: ['cash_receipt', 'pos_receipt', 'shift_closeout'],
          pinCode: '1234',
          startDate: new Date().toLocaleDateString('fa-IR'),
          isActive: statusRaw !== 'غیرفعال',
          notes: pickRowField(row, ['توضیحات', 'یادداشت', 'notes']),
          createdAt: new Date().toLocaleDateString('fa-IR'),
        });
      }
      if (imported.length > 0) {
        onUpdateDb({ ...db, cashiers: [...imported, ...currentList] });
      }
    } catch (err) {
      console.error('Cashiers import error:', err);
    }
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || shiftFilter !== 'all' || statusFilter !== 'all');
  const handleClearFilters = () => {
    setSearchQuery('');
    setShiftFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Unified KPI Strip */}
      <KpiStrip
        items={[
          { label: 'کل صندوق‌داران تعریف‌شده', value: stats.totalCount, sublabel: 'نفر' },
          { label: 'صندوق‌داران فعال', value: stats.activeCount, sublabel: 'فعال', tone: 'success' },
          { label: 'صندوق‌داران شیفت صبح', value: stats.morningCount, sublabel: 'صبح', tone: 'warning' },
          { label: 'صندوق‌داران شیفت عصر / شب', value: stats.eveningCount, sublabel: 'عصر', tone: 'info' },
        ]}
      />

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingCashier ? 'ویرایش مشخصات صندوق‌دار' : 'تعریف صندوق‌دار و کاربر دخل جدید'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">مشخصات هویتی، شیفت، دسترسی‌ها و سقف تخفیف مجاز</p>
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
                  <Hash className="w-3.5 h-3.5 text-purple-400" />
                  کد پرسنلی صندوق‌دار <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="CSHR-101"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors font-mono uppercase"
                  required
                />
              </div>

              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">
                  نام و نام خانوادگی <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="مثال: فاطمه رستمی"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors"
                  required
                />
              </div>

              {/* National ID */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">کد ملی (۱۰ رقمی)</label>
                <input
                  type="text"
                  placeholder="0019876543"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors font-mono"
                  maxLength={10}
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-purple-400" />
                  شماره موبایل
                </label>
                <input
                  type="text"
                  placeholder="09121234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Default Cash Drawer */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Vault className="w-3.5 h-3.5 text-amber-400" />
                  صندوق فیزیکی پیش‌فرض
                </label>
                <select
                  value={defaultCashDrawerId}
                  onChange={(e) => setDefaultCashDrawerId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors"
                >
                  <option value="">-- بدون صندوق ثابت --</option>
                  {cashDrawers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              {/* Shift Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  نوبت کاری (شیفت)
                </label>
                <select
                  value={shiftType}
                  onChange={(e) => setShiftType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors"
                >
                  <option value="صبح">شیفت صبح (۰۷:۳۰ الی ۱۵:۳۰)</option>
                  <option value="عصر">شیفت عصر (۱۵:۳۰ الی ۲۳:۳۰)</option>
                  <option value="شب">شیفت شب (۲۳:۳۰ الی ۰۷:۳۰)</option>
                  <option value="چرخشی">شیفت چرخشی</option>
                </select>
              </div>

              {/* Max Discount Percent */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-400" />
                  سقف مجاز تخفیف در فاکتور (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={maxDiscountPercent}
                  onChange={(e) => setMaxDiscountPercent(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* PIN Code */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-purple-400" />
                  پین‌کد / رمز عبور سریع صندوق
                </label>
                <input
                  type="password"
                  placeholder="مثال: 1234"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors font-mono"
                  maxLength={6}
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت حساب کاربری</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors"
                >
                  <option value="active">فعال و مجاز به کار با صندوق</option>
                  <option value="inactive">مسدود / مرخصی / غیرفعال</option>
                </select>
              </div>

              {/* Permissions */}
              <div className="md:col-span-3 space-y-2 bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl">
                <label className="text-slate-300 font-bold flex items-center gap-1.5 block">
                  <Shield className="w-4 h-4 text-purple-400" />
                  مجوزها و دسترسی‌های صندوق‌دار در سیستم
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                  {AVAILABLE_PERMISSIONS.map(perm => {
                    const isChecked = permissions.includes(perm.key);
                    return (
                      <label 
                        key={perm.key} 
                        className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                          isChecked 
                            ? 'bg-purple-500/10 border-purple-500/40 text-white' 
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => togglePermission(perm.key)}
                          className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-xs font-medium">{perm.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">یادداشت‌ها</label>
                <textarea
                  rows={2}
                  placeholder="سوابق، تضمین‌های دریافت‌شده، معرف و توضیحات شغلی..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-purple-500 outline-none transition-colors text-xs"
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
                {editingCashier ? 'ذخیره تغییرات' : 'ثبت صندوق‌دار'}
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
            searchPlaceholder="جستجو بر اساس نام، کد پرسنلی، شماره موبایل یا کد ملی..."
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onDownloadTemplate={handleDownloadTemplate}
            onImportExcel={handleImportExcel}
            onExportExcel={handleExportExcel}
            onPrint={() => printElement('cashiers-table-print', 'فهرست صندوق‌داران')}
            onAdd={handleOpenNew}
            addLabel="تعریف صندوق‌دار جدید"
          />

          <UnifiedFilterBar columnsClass="grid-cols-1 sm:grid-cols-2">
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>نوبت کاری (شیفت)</label>
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه شیفت‌ها</option>
                <option value="صبح">شیفت صبح</option>
                <option value="عصر">شیفت عصر</option>
                <option value="شب">شیفت شب</option>
                <option value="چرخشی">شیفت چرخشی</option>
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت حساب</label>
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

          {/* Cashiers Table */}
          <div id="cashiers-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">کد و نام صندوق‌دار</th>
                  <th className="p-3.5">موبایل / کد ملی</th>
                  <th className="p-3.5">صندوق پیش‌فرض</th>
                  <th className="p-3.5">شیفت کاری</th>
                  <th className="p-3.5 text-center">سقف تخفیف</th>
                  <th className="p-3.5 text-center">تعداد تسویه‌ها</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredCashiers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      هیچ صندوق‌داری منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredCashiers.map((c, index) => {
                    const info = cashierStats[c.id] || { closeoutsCount: 0, receiptsCount: 0 };

                    return (
                      <tr key={c.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                            {c.fullName}
                          </div>
                          <span className="font-mono text-[10px] text-purple-300/80 block mt-0.5">
                            {c.code}
                          </span>
                        </td>
                        <td className="p-3.5 space-y-0.5">
                          <div className="font-mono text-slate-200">{toPersianDigits(c.phone || '-')}</div>
                          {c.nationalId && (
                            <span className="font-mono text-[10px] text-slate-500 block">
                              ملی: {toPersianDigits(c.nationalId)}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-slate-300">
                          {c.defaultCashDrawerId ? (
                            <span className="inline-flex items-center gap-1">
                              <Vault className="w-3.5 h-3.5 text-amber-400" />
                              {cashDrawerMap[c.defaultCashDrawerId] || '-'}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px]">شناور / بدون صندوق ثابت</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className="inline-block px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-800 text-slate-300">
                            شیفت {c.shiftType}
                          </span>
                        </td>
                        <td className="p-3.5 text-center font-mono text-amber-300 font-bold">
                          {toPersianDigits(c.maxDiscountPercent || 0)}%
                        </td>
                        <td className="p-3.5 text-center font-mono text-cyan-300 font-bold">
                          {toPersianDigits(info.closeoutsCount)} تسویه
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            c.isActive 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {c.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(c)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش صندوق‌دار"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(c)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف صندوق‌دار"
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
