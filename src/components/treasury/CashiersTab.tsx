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
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
} from '../../utils/persianUtils';
import { nextSimpleId, getPrefixForCollection } from '../../utils/simpleId';

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

  const handleExportCSV = () => {
    const headers = ['کد پرسنلی صندوق‌دار', 'نام و نام خانوادگی', 'کد ملی', 'شماره تماس', 'صندوق پیش‌فرض', 'شیفت کاری', 'سقف تخفیف (%)', 'تعداد تسویه شیفت', 'وضعیت'];
    const rows = filteredCashiers.map(c => {
      const info = cashierStats[c.id] || { closeoutsCount: 0, receiptsCount: 0 };
      return [
        c.code,
        c.fullName,
        c.nationalId || '-',
        c.phone || '-',
        c.defaultCashDrawerId ? (cashDrawerMap[c.defaultCashDrawerId] || '-') : '-',
        c.shiftType,
        c.maxDiscountPercent || 0,
        info.closeoutsCount,
        c.isActive ? 'فعال' : 'غیرفعال'
      ];
    });
    downloadCSV('گزارش_صندوق_داران.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">کل صندوق‌داران تعریف‌شده</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">صندوق‌داران فعال</span>
            <span className="text-2xl font-black text-emerald-400 mt-1 block">{toPersianDigits(stats.activeCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">صندوق‌داران شیفت صبح</span>
            <span className="text-2xl font-black text-amber-300 mt-1 block">{toPersianDigits(stats.morningCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">صندوق‌داران شیفت عصر / شب</span>
            <span className="text-2xl font-black text-indigo-300 mt-1 block">{toPersianDigits(stats.eveningCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

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
                className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
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
          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو بر اساس نام، کد پرسنلی، شماره موبایل یا کد ملی..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-white focus:border-purple-500 outline-none transition-colors placeholder:text-slate-500"
                />
              </div>

              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-purple-500 outline-none transition-colors"
              >
                <option value="all">همه شیفت‌ها</option>
                <option value="صبح">شیفت صبح</option>
                <option value="عصر">شیفت عصر</option>
                <option value="شب">شیفت شب</option>
                <option value="چرخشی">شیفت چرخشی</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-purple-500 outline-none transition-colors"
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
                onClick={() => printElement('cashiers-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست صندوق‌داران"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>تعریف صندوق‌دار جدید</span>
              </button>
            </div>
          </div>

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
