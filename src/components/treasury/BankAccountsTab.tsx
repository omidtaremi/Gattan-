/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, BankAccount, PosTerminal } from '../../types';
import { 
  Landmark, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  CreditCard, Hash, FileSpreadsheet, Printer, Save, X, AlertTriangle, 
  Building2, ArrowUpDown, ChevronDown, Check, Eye, RefreshCw, Wallet
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
} from '../../utils/persianUtils';
import { nextSimpleId, getPrefixForCollection } from '../../utils/simpleId';

interface BankAccountsTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

const IRANIAN_BANKS = [
  'بانک ملی ایران', 'بانک ملت', 'بانک صادرات ایران', 'بانک تجارت', 'بانک سپه',
  'بانک سامان', 'بانک پاسارگاد', 'بانک پارسیان', 'بانک آینده', 'بانک اقتصاد نوین',
  'بانک شهر', 'بانک سینا', 'بانک دی', 'بانک کشاورزی', 'بانک مسکن',
  'بانک صنعت و معدن', 'بانک توسعه صادرات', 'بانک رفاه کارگران', 'بانک قرض‌الحسنه رسالت',
  'بانک قرض‌الحسنه مهر ایران', 'پست بانک ایران', 'بانک خاورمیانه', 'بانک کارآفرین', 'بانک گردشگری'
];

export default function BankAccountsTab({ db, onUpdateDb, activePeriodId, askConfirm }: BankAccountsTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [viewingAccount, setViewingAccount] = useState<BankAccount | null>(null);

  // Form State
  const [bankName, setBankName] = useState(IRANIAN_BANKS[0]);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [shaba, setShaba] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [accountType, setAccountType] = useState<'جاری' | 'پس‌انداز' | 'قرض‌الحسنه' | 'کوتاه‌مدت'>('جاری');
  const [accountHolder, setAccountHolder] = useState('');
  const [initialBalance, setInitialBalance] = useState<number>(0);
  const [accountingCode, setAccountingCode] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  const accounts = useMemo(() => {
    return (db.bankAccounts || []).filter(a => a.periodId === activePeriodId);
  }, [db.bankAccounts, activePeriodId]);

  const posTerminals = useMemo(() => {
    return (db.posTerminals || []).filter(t => t.periodId === activePeriodId);
  }, [db.posTerminals, activePeriodId]);

  // Balance calculation (initial balance + receipts - payments, active period only)
  const accountBalances = useMemo(() => {
    const map: Record<string, number> = {};
    const periodReceipts = (db.treasuryReceipts || []).filter(r => r.periodId === activePeriodId);
    const periodPayments = (db.treasuryPayments || []).filter(p => p.periodId === activePeriodId);
    accounts.forEach(acc => {
      let balance = acc.initialBalance || 0;
      periodReceipts.forEach(r => {
        if (r.bankAccountId === acc.id && r.status === 'confirmed') {
          balance += (r.amount || 0);
        }
      });
      periodPayments.forEach(p => {
        if (p.bankAccountId === acc.id && p.status === 'confirmed') {
          balance -= (p.amount || 0);
        }
      });
      map[acc.id] = balance;
    });
    return map;
  }, [accounts, db.treasuryReceipts, db.treasuryPayments, activePeriodId]);

  const stats = useMemo(() => {
    const totalCount = accounts.length;
    const activeCount = accounts.filter(a => a.isActive).length;
    const totalInitial = accounts.reduce((sum, a) => sum + (a.initialBalance || 0), 0);
    const totalCurrent = accounts.reduce((sum, a) => sum + (accountBalances[a.id] || a.initialBalance || 0), 0);
    return { totalCount, activeCount, totalInitial, totalCurrent };
  }, [accounts, accountBalances]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      if (searchQuery) {
        const matches = 
          matchPersianString(acc.bankName, searchQuery) ||
          matchPersianString(acc.branchName, searchQuery) ||
          matchPersianString(acc.accountHolder, searchQuery) ||
          acc.accountNo.includes(searchQuery) ||
          (acc.cardNo && acc.cardNo.includes(searchQuery)) ||
          (acc.shaba && acc.shaba.includes(searchQuery));
        if (!matches) return false;
      }
      if (typeFilter !== 'all' && acc.accountType !== typeFilter) return false;
      if (statusFilter === 'active' && !acc.isActive) return false;
      if (statusFilter === 'inactive' && acc.isActive) return false;
      return true;
    });
  }, [accounts, searchQuery, typeFilter, statusFilter]);

  const handleOpenNew = () => {
    setEditingAccount(null);
    setBankName(IRANIAN_BANKS[0]);
    setBranchName('');
    setBranchCode('');
    setAccountNo('');
    setShaba('');
    setCardNo('');
    setAccountType('جاری');
    setAccountHolder('صنایع غذایی گاتان');
    setInitialBalance(0);
    setAccountingCode('');
    setIsActive(true);
    setNotes('');
    setActiveSubView('form');
  };

  const handleOpenEdit = (acc: BankAccount) => {
    setEditingAccount(acc);
    setBankName(acc.bankName);
    setBranchName(acc.branchName);
    setBranchCode(acc.branchCode || '');
    setAccountNo(acc.accountNo);
    setShaba(acc.shaba || '');
    setCardNo(acc.cardNo || '');
    setAccountType(acc.accountType);
    setAccountHolder(acc.accountHolder);
    setInitialBalance(acc.initialBalance || 0);
    setAccountingCode(acc.accountingCode || '');
    setIsActive(acc.isActive);
    setNotes(acc.notes || '');
    setActiveSubView('form');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim() || !accountNo.trim() || !accountHolder.trim()) {
      alert('لطفاً نام بانک، شماره حساب و نام صاحب حساب را تکمیل نمایید.');
      return;
    }

    let cleanShaba = shaba.trim().toUpperCase();
    if (cleanShaba && !cleanShaba.startsWith('IR')) {
      cleanShaba = `IR${cleanShaba}`;
    }

    const currentList = db.bankAccounts || [];
    let updatedList: BankAccount[];

    if (editingAccount) {
      updatedList = currentList.map(a => a.id === editingAccount.id ? {
        ...a,
        bankName: bankName.trim(),
        branchName: branchName.trim(),
        branchCode: branchCode.trim(),
        accountNo: accountNo.trim(),
        shaba: cleanShaba,
        cardNo: cardNo.replace(/\s+/g, '').trim(),
        accountType,
        accountHolder: accountHolder.trim(),
        initialBalance: Number(initialBalance) || 0,
        accountingCode: accountingCode.trim(),
        isActive,
        notes: notes.trim()
      } : a);
    } else {
      const newAcc: BankAccount = {
        id: nextSimpleId(currentList, getPrefixForCollection('bankAccounts')),
        periodId: activePeriodId,
        bankName: bankName.trim(),
        branchName: branchName.trim(),
        branchCode: branchCode.trim(),
        accountNo: accountNo.trim(),
        shaba: cleanShaba,
        cardNo: cardNo.replace(/\s+/g, '').trim(),
        accountType,
        accountHolder: accountHolder.trim(),
        initialBalance: Number(initialBalance) || 0,
        accountingCode: accountingCode.trim(),
        isActive,
        notes: notes.trim(),
        createdAt: new Date().toLocaleDateString('fa-IR')
      };
      updatedList = [newAcc, ...currentList];
    }

    onUpdateDb({
      ...db,
      bankAccounts: updatedList
    });

    setActiveSubView('list');
    setEditingAccount(null);
  };

  const handleDelete = (acc: BankAccount) => {
    askConfirm(
      'حذف حساب بانکی',
      `آیا از حذف حساب بانکی "${acc.bankName} - ${acc.accountNo}" اطمینان دارید؟ در صورت وجود گردش مالی، حذف حساب ممکن است سوابق را مخدوش کند.`,
      () => {
        const updated = (db.bankAccounts || []).filter(a => a.id !== acc.id);
        onUpdateDb({
          ...db,
          bankAccounts: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['نام بانک', 'شعبه', 'شماره حساب', 'شماره شبا', 'شماره کارت', 'نوع حساب', 'صاحب حساب', 'موجودی اولیه (ریال)', 'موجودی لحظه‌ای (ریال)', 'کد حسابداری', 'وضعیت'];
    const rows = filteredAccounts.map(a => [
      a.bankName,
      a.branchName,
      a.accountNo,
      a.shaba || '-',
      a.cardNo || '-',
      a.accountType,
      a.accountHolder,
      a.initialBalance || 0,
      accountBalances[a.id] || a.initialBalance || 0,
      a.accountingCode || '-',
      a.isActive ? 'فعال' : 'غیرفعال'
    ]);
    downloadCSV('گزارش_حسابهای_بانکی.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تعداد کل حساب‌های بانکی</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <Landmark className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">حساب‌های بانکی فعال</span>
            <span className="text-2xl font-black text-emerald-400 mt-1 block">{toPersianDigits(stats.activeCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع موجودی اولیه</span>
            <span className="text-lg font-black text-cyan-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalInitial))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع مانده دفتری لحظه‌ای</span>
            <span className="text-lg font-black text-amber-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalCurrent))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                <Landmark className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingAccount ? 'ویرایش حساب بانکی' : 'ثبت و تعریف حساب بانکی جدید'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">مشخصات دقیق شعبه، شماره حساب، شبا و موجودی اولیه</p>
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
              {/* Bank Name */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-rose-400" />
                  نام بانک <span className="text-rose-400">*</span>
                </label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-medium"
                  required
                >
                  {IRANIAN_BANKS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              {/* Branch Name */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">نام شعبه</label>
                <input
                  type="text"
                  placeholder="مثال: شعبه مرکزی بازار، شعبه سعادت‌آباد"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                />
              </div>

              {/* Branch Code */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">کد شعبه</label>
                <input
                  type="text"
                  placeholder="مثال: ۱۲۳۴"
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Account Number */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-rose-400" />
                  شماره حساب <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="مثال: 0105678901004"
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Shaba Number */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">شماره شبا (IBAN)</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="IR120180000000003410987654"
                    value={shaba}
                    onChange={(e) => setShaba(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono uppercase"
                    maxLength={26}
                  />
                </div>
              </div>

              {/* Card Number */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-rose-400" />
                  شماره کارت ۱۶ رقمی
                </label>
                <input
                  type="text"
                  placeholder="6037-9918-2345-6789"
                  value={cardNo}
                  onChange={(e) => setCardNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                  maxLength={19}
                />
              </div>

              {/* Account Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">نوع حساب</label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                >
                  <option value="جاری">جاری (دارای دسته چک)</option>
                  <option value="پس‌انداز">پس‌انداز</option>
                  <option value="قرض‌الحسنه">قرض‌الحسنه</option>
                  <option value="کوتاه‌مدت">سپرده کوتاه مدت</option>
                </select>
              </div>

              {/* Account Holder */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">
                  نام صاحب حساب <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="نام شخص یا عنوان شرکت"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                  required
                />
              </div>

              {/* Accounting Code */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">کد تفصیلی / معین حسابداری</label>
                <input
                  type="text"
                  placeholder="مثال: 101001"
                  value={accountingCode}
                  onChange={(e) => setAccountingCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Initial Balance */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">موجودی اولیه در بدو دوره (ریال)</label>
                <input
                  type="text"
                  value={formatWithCommas(initialBalance)}
                  onChange={(e) => setInitialBalance(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-bold text-left focus:border-rose-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت حساب</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                >
                  <option value="active">فعال و قابل استفاده در تراکنش‌ها</option>
                  <option value="inactive">راکد / غیرفعال</option>
                </select>
              </div>

              {/* Notes */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">توضیحات و یادداشت</label>
                <textarea
                  rows={2}
                  placeholder="یادداشت‌های مرتبط با این حساب بانکی، شعبه ارائه‌دهنده دسته چک، و غیره..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors text-xs"
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
                {editingAccount ? 'ذخیره تغییرات' : 'ثبت نهایی حساب بانکی'}
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
                  placeholder="جستجو بر اساس نام بانک، شعبه، شماره حساب، کارت یا شبا..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 py-2.5 text-xs text-white focus:border-rose-500 outline-none transition-colors placeholder:text-slate-500"
                />
              </div>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-rose-500 outline-none transition-colors"
              >
                <option value="all">همه انواع حساب</option>
                <option value="جاری">حساب جاری</option>
                <option value="پس‌انداز">پس‌انداز</option>
                <option value="قرض‌الحسنه">قرض‌الحسنه</option>
                <option value="کوتاه‌مدت">کوتاه‌مدت</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:border-rose-500 outline-none transition-colors"
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
                onClick={() => printElement('bank-accounts-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست حساب‌های بانکی"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>تعریف حساب جدید</span>
              </button>
            </div>
          </div>

          {/* Accounts Table */}
          <div id="bank-accounts-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">بانک و شعبه</th>
                  <th className="p-3.5">شماره حساب / نوع</th>
                  <th className="p-3.5">شماره شبا و کارت</th>
                  <th className="p-3.5">صاحب حساب</th>
                  <th className="p-3.5 text-left">موجودی دفتری (ریال)</th>
                  <th className="p-3.5 text-center">کارتخوان‌های متصل</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      هیچ حساب بانکی منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((acc, index) => {
                    const currentBal = accountBalances[acc.id] || acc.initialBalance || 0;
                    const linkedPos = posTerminals.filter(p => p.bankAccountId === acc.id);

                    return (
                      <tr key={acc.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-rose-400" />
                            {acc.bankName}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {acc.branchName || 'مرکزی'} {acc.branchCode ? `(کد: ${toPersianDigits(acc.branchCode)})` : ''}
                          </div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-slate-200">{toPersianDigits(acc.accountNo)}</div>
                          <span className="inline-block mt-0.5 text-[10px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded-md">
                            حساب {acc.accountType}
                          </span>
                        </td>
                        <td className="p-3.5 space-y-0.5">
                          {acc.shaba ? (
                            <div className="font-mono text-[11px] text-cyan-300 select-all" dir="ltr">
                              {acc.shaba}
                            </div>
                          ) : (
                            <span className="text-slate-600 text-[11px]">-</span>
                          )}
                          {acc.cardNo && (
                            <div className="font-mono text-[10px] text-slate-400 select-all" dir="ltr">
                              {acc.cardNo.replace(/(\d{4})/g, '$1 ').trim()}
                            </div>
                          )}
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-200">{acc.accountHolder}</div>
                          {acc.accountingCode && (
                            <span className="text-[10px] text-slate-500 font-mono block">
                              کد تفصیلی: {toPersianDigits(acc.accountingCode)}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className={`font-black text-sm ${currentBal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {toPersianDigits(formatWithCommas(currentBal))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">
                            اولیه: {toPersianDigits(formatWithCommas(acc.initialBalance || 0))}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          {linkedPos.length > 0 ? (
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              {linkedPos.map(p => (
                                <span key={p.id} className="text-[10px] px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-md font-mono">
                                  {p.pspName.split(' ')[0]} ({toPersianDigits(p.terminalId.slice(-4))})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-600 text-[11px]">-</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            acc.isActive 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {acc.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(acc)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش حساب"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(acc)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                              title="حذف حساب"
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
