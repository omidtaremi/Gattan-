/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, TreasuryReceipt, BankAccount, CashDrawer, PosTerminal, Cashier, Customer } from '../../types';
import { 
  ArrowDownLeft, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  CreditCard, Landmark, Vault, FileText, Hash, FileSpreadsheet, Printer, 
  Save, X, Calendar, Clock, User, Banknote, ShieldCheck, Eye, RefreshCw,
  Building, CheckCircle2, ChevronDown
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString,
  getTodayJalali, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate, numberToWordsPersian
} from '../../utils/persianUtils';
import TreasuryDateFilterBar, { DateFilterMode } from './TreasuryDateFilterBar';

interface ReceiptsTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

const RECEIPT_CATEGORIES = [
  'تسویه فاکتور فروش',
  'پیش‌دریافت سفارش مشتری',
  'فروش نقدی روزانه',
  'تسویه مانده بدهی مشتری',
  'دریافت بابت درآمد غیرعملیاتی',
  'بازگشت وجه تنخواه',
  'سرمایه‌گذاری / تزریق نقدینگی',
  'سایر دریافتی‌ها'
];

export default function ReceiptsTab({ db, onUpdateDb, activePeriodId, askConfirm }: ReceiptsTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingReceipt, setEditingReceipt] = useState<TreasuryReceipt | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<TreasuryReceipt | null>(null);

  // Date Filter State (Default to 'today' as requested by user)
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'yesterday' | '7days' | '30days' | 'specific' | 'range' | 'all'>('today');
  const [specificDate, setSpecificDate] = useState<string>(getTodayJalali());
  const [fromDate, setFromDate] = useState<string>(getRelativeJalaliDate(-7));
  const [toDate, setToDate] = useState<string>(getTodayJalali());

  // Form State
  const [receiptNo, setReceiptNo] = useState('');
  const [date, setDate] = useState(getTodayJalali());
  const [time, setTime] = useState(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
  const [counterpartyType, setCounterpartyType] = useState<'customer' | 'personnel' | 'shareholder' | 'other'>('customer');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pos' | 'bank_transfer' | 'cheque'>('pos');
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState(RECEIPT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending' | 'cancelled'>('confirmed');

  // Account / Target Fields
  const [cashDrawerId, setCashDrawerId] = useState('');
  const [posTerminalId, setPosTerminalId] = useState('');
  const [posTrackingNo, setPosTrackingNo] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankTransferRef, setBankTransferRef] = useState('');
  const [cashierId, setCashierId] = useState('');

  // Cheque Fields
  const [chequeNo, setChequeNo] = useState('');
  const [sayadNo, setSayadNo] = useState('');
  const [dueDate, setDueDate] = useState(getTodayJalali());
  const [bankName, setBankName] = useState('بانک ملی ایران');
  const [drawerName, setDrawerName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [isGuaranteed, setIsGuaranteed] = useState(true);

  const receipts = useMemo(() => {
    return db.treasuryReceipts || [];
  }, [db.treasuryReceipts]);

  const bankAccounts = useMemo(() => db.bankAccounts || [], [db.bankAccounts]);
  const cashDrawers = useMemo(() => db.cashDrawers || [], [db.cashDrawers]);
  const posTerminals = useMemo(() => db.posTerminals || [], [db.posTerminals]);
  const cashiers = useMemo(() => db.cashiers || [], [db.cashiers]);
  const customers = useMemo(() => db.customers || [], [db.customers]);

  const stats = useMemo(() => {
    const totalCount = receipts.length;
    const confirmedCount = receipts.filter(r => r.status === 'confirmed').length;
    const totalAmount = receipts.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + (r.amount || 0), 0);
    const posAmount = receipts.filter(r => r.status === 'confirmed' && r.paymentMethod === 'pos').reduce((sum, r) => sum + (r.amount || 0), 0);
    const bankAmount = receipts.filter(r => r.status === 'confirmed' && r.paymentMethod === 'bank_transfer').reduce((sum, r) => sum + (r.amount || 0), 0);
    const cashAmount = receipts.filter(r => r.status === 'confirmed' && r.paymentMethod === 'cash').reduce((sum, r) => sum + (r.amount || 0), 0);
    const chequeAmount = receipts.filter(r => r.status === 'confirmed' && r.paymentMethod === 'cheque').reduce((sum, r) => sum + (r.amount || 0), 0);
    return { totalCount, confirmedCount, totalAmount, posAmount, bankAmount, cashAmount, chequeAmount };
  }, [receipts]);

  const filteredReceipts = useMemo(() => {
    const today = getTodayJalali();
    const yesterday = getRelativeJalaliDate(-1);
    const sevenDaysAgo = getRelativeJalaliDate(-7);
    const thirtyDaysAgo = getRelativeJalaliDate(-30);

    return receipts.filter(r => {
      // Date Filter
      if (dateFilterMode === 'today') {
        if (normalizeJalaliDate(r.date) !== normalizeJalaliDate(today)) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (normalizeJalaliDate(r.date) !== normalizeJalaliDate(yesterday)) return false;
      } else if (dateFilterMode === '7days') {
        if (!isJalaliDateInRange(r.date, sevenDaysAgo, today)) return false;
      } else if (dateFilterMode === '30days') {
        if (!isJalaliDateInRange(r.date, thirtyDaysAgo, today)) return false;
      } else if (dateFilterMode === 'specific') {
        if (normalizeJalaliDate(r.date) !== normalizeJalaliDate(specificDate)) return false;
      } else if (dateFilterMode === 'range') {
        if (!isJalaliDateInRange(r.date, fromDate, toDate)) return false;
      }

      if (searchQuery) {
        const matches = 
          matchPersianString(r.counterpartyName, searchQuery) ||
          r.receiptNo.includes(searchQuery) ||
          matchPersianString(r.description || '', searchQuery) ||
          (r.posTrackingNo && r.posTrackingNo.includes(searchQuery)) ||
          (r.bankTransferRef && r.bankTransferRef.includes(searchQuery)) ||
          (r.chequeDetails?.sayadNo && r.chequeDetails.sayadNo.includes(searchQuery));
        if (!matches) return false;
      }
      if (methodFilter !== 'all' && r.paymentMethod !== methodFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [receipts, dateFilterMode, specificDate, fromDate, toDate, searchQuery, methodFilter, categoryFilter, statusFilter]);

  const handleOpenNew = () => {
    setEditingReceipt(null);
    const seq = (receipts.length + 1).toString().padStart(3, '0');
    setReceiptNo(`REC-140501-${seq}`);
    setDate(getTodayJalali());
    setTime(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
    setCounterpartyType('customer');
    setCounterpartyId(customers[0]?.id || '');
    setCounterpartyName(customers[0]?.name || '');
    setPaymentMethod('pos');
    setAmount(0);
    setCategory(RECEIPT_CATEGORIES[0]);
    setDescription('');
    setStatus('confirmed');

    setCashDrawerId(cashDrawers[0]?.id || '');
    setPosTerminalId(posTerminals[0]?.id || '');
    setPosTrackingNo('');
    setBankAccountId(bankAccounts[0]?.id || '');
    setBankTransferRef('');
    setCashierId(cashiers[0]?.id || '');

    setChequeNo('');
    setSayadNo('');
    setDueDate(getTodayJalali());
    setBankName('بانک ملی ایران');
    setDrawerName(customers[0]?.name || '');
    setBranchName('مرکزی');
    setIsGuaranteed(true);

    setActiveSubView('form');
  };

  const handleOpenEdit = (r: TreasuryReceipt) => {
    setEditingReceipt(r);
    setReceiptNo(r.receiptNo);
    setDate(r.date);
    setTime(r.time || '');
    setCounterpartyType(r.counterpartyType);
    setCounterpartyId(r.counterpartyId || '');
    setCounterpartyName(r.counterpartyName);
    setPaymentMethod(r.paymentMethod);
    setAmount(r.amount);
    setCategory(r.category || RECEIPT_CATEGORIES[0]);
    setDescription(r.description || '');
    setStatus(r.status);

    setCashDrawerId(r.cashDrawerId || '');
    setPosTerminalId(r.posTerminalId || '');
    setPosTrackingNo(r.posTrackingNo || '');
    setBankAccountId(r.bankAccountId || '');
    setBankTransferRef(r.bankTransferRef || '');
    setCashierId(r.cashierId || '');

    if (r.chequeDetails) {
      setChequeNo(r.chequeDetails.chequeNo);
      setSayadNo(r.chequeDetails.sayadNo);
      setDueDate(r.chequeDetails.dueDate);
      setBankName(r.chequeDetails.bankName);
      setDrawerName(r.chequeDetails.drawerName);
      setBranchName(r.chequeDetails.branchName || '');
      setIsGuaranteed(r.chequeDetails.isGuaranteed !== false);
    }
    setActiveSubView('form');
  };

  const handleCustomerChange = (cId: string) => {
    setCounterpartyId(cId);
    const found = customers.find(c => c.id === cId);
    if (found) {
      setCounterpartyName(found.name);
      setDrawerName(found.name);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterpartyName.trim() || amount <= 0) {
      alert('لطفاً نام طرف مقابل و مبلغ دریافتی معتبر را وارد نمایید.');
      return;
    }

    const currentList = db.treasuryReceipts || [];
    let updatedList: TreasuryReceipt[];

    let chequeDetails = undefined;
    if (paymentMethod === 'cheque') {
      chequeDetails = {
        chequeNo: chequeNo.trim(),
        sayadNo: sayadNo.trim(),
        dueDate,
        bankName,
        drawerName: drawerName.trim() || counterpartyName.trim(),
        branchName: branchName.trim(),
        isGuaranteed,
        status: 'pending' as const
      };
    }

    const receiptObj: TreasuryReceipt = {
      id: editingReceipt ? editingReceipt.id : `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      periodId: activePeriodId,
      receiptNo: receiptNo.trim(),
      date,
      time,
      counterpartyType,
      counterpartyId: counterpartyId || undefined,
      counterpartyName: counterpartyName.trim(),
      paymentMethod,
      amount: Number(amount) || 0,
      bankAccountId: (paymentMethod === 'bank_transfer' || paymentMethod === 'pos') ? bankAccountId : undefined,
      posTerminalId: paymentMethod === 'pos' ? posTerminalId : undefined,
      posTrackingNo: paymentMethod === 'pos' ? posTrackingNo.trim() : undefined,
      cashDrawerId: paymentMethod === 'cash' ? cashDrawerId : undefined,
      bankTransferRef: paymentMethod === 'bank_transfer' ? bankTransferRef.trim() : undefined,
      chequeDetails,
      category,
      description: description.trim(),
      cashierId: cashierId || undefined,
      registeredBy: 'مدیر کل سامانه گاتان',
      status,
      createdAt: editingReceipt ? editingReceipt.createdAt : new Date().toLocaleDateString('fa-IR')
    };

    if (editingReceipt) {
      updatedList = currentList.map(r => r.id === editingReceipt.id ? receiptObj : r);
    } else {
      updatedList = [receiptObj, ...currentList];
    }

    onUpdateDb({
      ...db,
      treasuryReceipts: updatedList
    });

    setActiveSubView('list');
    setEditingReceipt(null);
  };

  const handleDelete = (r: TreasuryReceipt) => {
    askConfirm(
      'حذف سند دریافت',
      `آیا از حذف سند دریافت شماره "${r.receiptNo}" به مبلغ ${toPersianDigits(formatWithCommas(r.amount))} ریال اطمینان دارید؟`,
      () => {
        const updated = (db.treasuryReceipts || []).filter(item => item.id !== r.id);
        onUpdateDb({
          ...db,
          treasuryReceipts: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['شماره سند', 'تاریخ', 'زمان', 'طرف مقابل', 'روش دریافت', 'مبلغ (ریال)', 'بابت / سرفصل', 'وضعیت'];
    const rows = filteredReceipts.map(r => [
      r.receiptNo,
      r.date,
      r.time || '-',
      r.counterpartyName,
      r.paymentMethod === 'pos' ? 'کارتخوان' : r.paymentMethod === 'bank_transfer' ? 'حواله بانکی' : r.paymentMethod === 'cash' ? 'نقد' : 'چک',
      r.amount,
      r.category,
      r.status === 'confirmed' ? 'تایید شده' : r.status === 'pending' ? 'در انتظار' : 'لغو شده'
    ]);
    downloadCSV('گزارش_اسناد_دریافتی_خزانه.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">کل اسناد دریافتی</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع دریافتی تاییدشده</span>
            <span className="text-lg font-black text-emerald-400 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalAmount))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Banknote className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">دریافتی از کارتخوان (POS)</span>
            <span className="text-lg font-black text-cyan-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.posAmount))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">حواله بانکی و ساتنا/پایا</span>
            <span className="text-lg font-black text-purple-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.bankAmount))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Landmark className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
                <ArrowDownLeft className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingReceipt ? 'ویرایش سند دریافت وجه' : 'ثبت سند دریافت جدید (نقد / کارتخوان / حواله / چک)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">ثبت آنی واریز به حساب، کارتخوان یا ورود وجه به صندوق و خزانه</p>
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
              {/* Receipt No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-emerald-400" />
                  شماره سند دریافت <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={receiptNo}
                  onChange={(e) => setReceiptNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  تاریخ دریافت <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Time */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  ساعت دریافت
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Counterparty Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">نوع طرف حساب</label>
                <select
                  value={counterpartyType}
                  onChange={(e) => setCounterpartyType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                >
                  <option value="customer">مشتری / خریدار</option>
                  <option value="personnel">پرسنل / همکار</option>
                  <option value="shareholder">سهامدار / شریک تجاری</option>
                  <option value="other">متفرقه / فروشگاهی</option>
                </select>
              </div>

              {/* Counterparty Select or Name */}
              {counterpartyType === 'customer' ? (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">
                    انتخاب مشتری <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={counterpartyId}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                    required
                  >
                    <option value="">-- انتخاب مشتری از لیست --</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">
                    نام پرداخت‌کننده / طرف حساب <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: آقای حسینی (مشتری نقدی)"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                    required
                  />
                </div>
              )}

              {/* Payment Method */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">
                  روش دریافت وجه <span className="text-rose-400">*</span>
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-bold focus:border-emerald-500 outline-none transition-colors"
                >
                  <option value="pos">کارتخوان (POS)</option>
                  <option value="bank_transfer">حواله بانکی / پایا / ساتنا</option>
                  <option value="cash">نقدی به صندوق (Cash)</option>
                  <option value="cheque">چک صیادی بنفش</option>
                </select>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                    مبلغ دریافتی (ریال) <span className="text-rose-400">*</span>
                  </span>
                  {amount > 0 && (
                    <span className="text-[10px] text-amber-400 font-normal truncate max-w-[200px]">
                      {numberToWordsPersian(amount)} ریال
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={formatWithCommas(amount)}
                  onChange={(e) => setAmount(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-black text-sm text-left focus:border-emerald-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">بابت / سرفصل دریافت</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                >
                  {RECEIPT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Cashier In Charge */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">صندوق‌دار / تحویل‌گیرنده</label>
                <select
                  value={cashierId}
                  onChange={(e) => setCashierId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                >
                  <option value="">-- بدون صندوق‌دار خاص --</option>
                  {cashiers.map(c => (
                    <option key={c.id} value={c.id}>{c.fullName} ({c.code})</option>
                  ))}
                </select>
              </div>

              {/* Conditional Method Details */}
              {paymentMethod === 'pos' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                      دستگاه کارتخوان
                    </label>
                    <select
                      value={posTerminalId}
                      onChange={(e) => setPosTerminalId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                      required
                    >
                      {posTerminals.map(p => (
                        <option key={p.id} value={p.id}>{p.pspName} - پایانه {p.terminalId}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold">شماره پیگیری / ارجاع رسید پوز (RRN)</label>
                    <input
                      type="text"
                      placeholder="مثال: 984512098"
                      value={posTrackingNo}
                      onChange={(e) => setPosTrackingNo(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors font-mono"
                    />
                  </div>
                </>
              )}

              {paymentMethod === 'bank_transfer' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold flex items-center gap-1.5">
                      <Landmark className="w-3.5 h-3.5 text-purple-400" />
                      حساب بانکی مقصد واریز
                    </label>
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                      required
                    >
                      {bankAccounts.map(b => (
                        <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold">شماره پیگیری حواله ساتنا/پایا</label>
                    <input
                      type="text"
                      placeholder="مثال: SN-8839210"
                      value={bankTransferRef}
                      onChange={(e) => setBankTransferRef(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors font-mono"
                    />
                  </div>
                </>
              )}

              {paymentMethod === 'cash' && (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold flex items-center gap-1.5">
                    <Vault className="w-3.5 h-3.5 text-amber-400" />
                    صندوق نقدینگی ورودی
                  </label>
                  <select
                    value={cashDrawerId}
                    onChange={(e) => setCashDrawerId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                    required
                  >
                    {cashDrawers.map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                </div>
              )}

              {paymentMethod === 'cheque' && (
                <div className="md:col-span-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-emerald-500/30 space-y-4 shadow-xl">
                  {/* Cheque Header Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs flex items-center gap-2">
                          <span>دریافت و ثبت چک صیادی مشتری (اسناد دریافتنی)</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-mono font-normal">
                            سامانه یکپارچه صیاد
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">اطلاعات این چک به طور یکپارچه در بخش «مدیریت چک‌ها و برگه چک‌ها» قابل پیگیری، وصول، خواباندن به حساب و عودت می‌باشد.</p>
                      </div>
                    </div>

                    <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-xl flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ثبت مستقیم در خزانه اسناد دریافتنی</span>
                    </div>
                  </div>

                  {/* Cheque Inputs Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* 16-Digit Sayad No */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          شناسه صیادی ۱۶ رقمی چک <span className="text-rose-400">*</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {sayadNo.length}/16 رقم
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="1102345678901234"
                        value={sayadNo}
                        onChange={(e) => setSayadNo(e.target.value.replace(/\D/g, '').slice(0, 16))}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-emerald-300 font-mono text-center font-bold tracking-wider text-sm focus:border-emerald-500 outline-none"
                        maxLength={16}
                        required
                      />
                    </div>

                    {/* Cheque Serial No */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <Hash className="w-3.5 h-3.5 text-cyan-400" />
                        شماره سریال برگه چک
                      </label>
                      <input
                        type="text"
                        placeholder="مثال: 789456"
                        value={chequeNo}
                        onChange={(e) => setChequeNo(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono focus:border-emerald-500 outline-none"
                      />
                    </div>

                    {/* Due Date with Quick Presets */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-amber-400" />
                        تاریخ سررسید چک <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-center font-bold focus:border-emerald-500 outline-none"
                        placeholder="1405/02/15"
                        required
                      />
                      {/* Presets */}
                      <div className="flex items-center gap-1 pt-1 overflow-x-auto">
                        <button
                          type="button"
                          onClick={() => setDueDate(getRelativeJalaliDate(15))}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer transition-colors"
                        >
                          +۱۵ روز
                        </button>
                        <button
                          type="button"
                          onClick={() => setDueDate(getRelativeJalaliDate(30))}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer transition-colors"
                        >
                          +۱ ماه
                        </button>
                        <button
                          type="button"
                          onClick={() => setDueDate(getRelativeJalaliDate(60))}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer transition-colors"
                        >
                          +۲ ماه
                        </button>
                        <button
                          type="button"
                          onClick={() => setDueDate(getRelativeJalaliDate(90))}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer transition-colors"
                        >
                          +۳ ماه
                        </button>
                      </div>
                    </div>

                    {/* Bank Name */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <Building className="w-3.5 h-3.5 text-purple-400" />
                        نام بانک صادرکننده چک
                      </label>
                      <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:border-emerald-500 outline-none transition-colors"
                      >
                        <option value="بانک ملی ایران">بانک ملی ایران</option>
                        <option value="بانک ملت">بانک ملت</option>
                        <option value="بانک صادرات ایران">بانک صادرات ایران</option>
                        <option value="بانک تجارت">بانک تجارت</option>
                        <option value="بانک سپه">بانک سپه</option>
                        <option value="بانک پاسارگاد">بانک پاسارگاد</option>
                        <option value="بانک سامان">بانک سامان</option>
                        <option value="بانک پارسیان">بانک پارسیان</option>
                        <option value="بانک آینده">بانک آینده</option>
                        <option value="بانک کشاورزی">بانک کشاورزی</option>
                        <option value="بانک مسکن">بانک مسکن</option>
                        <option value="بانک رفاه کارگران">بانک رفاه کارگران</option>
                        <option value="بانک شهر">بانک شهر</option>
                        <option value="بانک رسالت">بانک قرض‌الحسنه رسالت</option>
                        <option value="بانک مهر ایران">بانک قرض‌الحسنه مهر ایران</option>
                        <option value="پست بانک ایران">پست بانک ایران</option>
                      </select>
                    </div>

                    {/* Branch Name */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold">نام یا کد شعبه بانک</label>
                      <input
                        type="text"
                        placeholder="مثال: شعبه مرکزی کد ۲۱۴"
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:border-emerald-500 outline-none"
                      />
                    </div>

                    {/* Drawer / Account Holder Name */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-emerald-400" />
                        صاحب حساب صادرکننده چک
                      </label>
                      <input
                        type="text"
                        placeholder="نام صادرکننده در سامانه صیاد"
                        value={drawerName || counterpartyName}
                        onChange={(e) => setDrawerName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت تایید سند</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors"
                >
                  <option value="confirmed">تایید شده و موثر در موجودی</option>
                  <option value="pending">در انتظار تایید حسابداری</option>
                  <option value="cancelled">باطل / لغو شده</option>
                </select>
              </div>

              {/* Description */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">شرح کامل سند دریافت</label>
                <textarea
                  rows={2}
                  placeholder="توضیحات تکمیلی، شماره فاکتور فروش تسویه‌شده، علت تخفیف یا توضیحات دیگر..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none transition-colors text-xs"
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
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {editingReceipt ? 'ذخیره تغییرات' : 'ثبت نهایی سند دریافت'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* List View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          {/* Uniform Treasury Date Filter Bar */}
          <TreasuryDateFilterBar
            dateFilterMode={dateFilterMode}
            setDateFilterMode={setDateFilterMode}
            specificDate={specificDate}
            setSpecificDate={setSpecificDate}
            fromDate={fromDate}
            setFromDate={setFromDate}
            toDate={toDate}
            setToDate={setToDate}
            title="فیلتر زمانی اسناد دریافت وجه:"
            colorScheme="emerald"
          />

          {/* Controls Bar - Single Line with Graceful Wrapping */}
          <div className="flex flex-wrap items-center gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="جستجو با شماره سند، نام مشتری، کد پیگیری، شرح..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl pr-10 pl-4 text-xs text-white focus:border-emerald-500 outline-none transition-colors placeholder:text-slate-500"
              />
            </div>

            {/* Method Filter Combobox */}
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="h-10 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 focus:border-emerald-500 outline-none transition-colors shrink-0 cursor-pointer"
            >
              <option value="all">همه روش‌های دریافت</option>
              <option value="pos">کارتخوان (POS)</option>
              <option value="bank_transfer">حواله بانکی</option>
              <option value="cash">نقدی</option>
              <option value="cheque">چک صیادی</option>
            </select>

            {/* Status Filter Combobox */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 focus:border-emerald-500 outline-none transition-colors shrink-0 cursor-pointer"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="confirmed">تایید شده</option>
              <option value="pending">در انتظار</option>
              <option value="cancelled">لغو شده</option>
            </select>

            {/* Export Excel Button */}
            <button
              onClick={handleExportCSV}
              className="h-10 px-3.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold shrink-0 cursor-pointer"
              title="خروجی فایل CSV اکسل"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>اکسل</span>
            </button>

            {/* Print Button */}
            <button
              onClick={() => printElement('receipts-table-print')}
              className="h-10 px-3.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold shrink-0 cursor-pointer"
              title="چاپ لیست دریافت‌ها"
            >
              <Printer className="w-4 h-4 text-cyan-400" />
              <span>چاپ</span>
            </button>

            {/* New Receipt Button */}
            <button
              onClick={handleOpenNew}
              className="h-10 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all shrink-0 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>ثبت سند دریافت جدید</span>
            </button>
          </div>

          {/* Receipts Table */}
          <div id="receipts-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره سند / تاریخ</th>
                  <th className="p-3.5">طرف مقابل</th>
                  <th className="p-3.5">روش و محل واریز</th>
                  <th className="p-3.5">بابت / شرح</th>
                  <th className="p-3.5 text-left">مبلغ دریافتی (ریال)</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ سند دریافتی با فیلترهای انتخابی یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredReceipts.map((r, index) => {
                    return (
                      <tr key={r.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-emerald-400">{r.receiptNo}</div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {toPersianDigits(r.date)} {r.time ? `- ${toPersianDigits(r.time)}` : ''}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {r.counterpartyName}
                          </div>
                          <span className="text-[10px] text-slate-500 block">
                            {r.counterpartyType === 'customer' ? 'مشتری' : r.counterpartyType === 'personnel' ? 'پرسنل' : 'متفرقه'}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5 font-bold text-slate-200">
                            {r.paymentMethod === 'pos' && <CreditCard className="w-3.5 h-3.5 text-cyan-400" />}
                            {r.paymentMethod === 'bank_transfer' && <Landmark className="w-3.5 h-3.5 text-purple-400" />}
                            {r.paymentMethod === 'cash' && <Vault className="w-3.5 h-3.5 text-amber-400" />}
                            {r.paymentMethod === 'cheque' && <FileText className="w-3.5 h-3.5 text-emerald-400" />}
                            {r.paymentMethod === 'pos' ? 'کارتخوان' : r.paymentMethod === 'bank_transfer' ? 'حواله بانکی' : r.paymentMethod === 'cash' ? 'نقدی' : 'چک صیادی دریافتی'}
                          </div>
                          {r.paymentMethod === 'pos' && (
                            <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                              {r.posTrackingNo ? `پیگیری: ${r.posTrackingNo}` : 'پوز فروشگاه'}
                            </span>
                          )}
                          {r.paymentMethod === 'bank_transfer' && (
                            <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                              {r.bankTransferRef ? `رهگیری: ${r.bankTransferRef}` : 'حساب بانکی'}
                            </span>
                          )}
                          {r.paymentMethod === 'cash' && (
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              صندوق نقدی
                            </span>
                          )}
                          {r.paymentMethod === 'cheque' && r.chequeDetails && (
                            <div className="mt-0.5 space-y-0.5 font-mono text-[10px]">
                              <div className="text-emerald-400 flex items-center gap-1">
                                <span>صیاد: {toPersianDigits(r.chequeDetails.sayadNo)}</span>
                              </div>
                              <div className="text-slate-400">
                                {r.chequeDetails.bankName} - سررسید: {toPersianDigits(r.chequeDetails.dueDate)}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-3.5 max-w-[200px]">
                          <div className="font-medium text-slate-200 truncate">{r.category}</div>
                          <span className="text-[10px] text-slate-500 block truncate">{r.description || '-'}</span>
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className="font-black text-sm text-emerald-400">
                            {toPersianDigits(formatWithCommas(r.amount))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">ریال</span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            r.status === 'confirmed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : r.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {r.status === 'confirmed' ? 'تایید شده' : r.status === 'pending' ? 'در انتظار' : 'لغو شده'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(r)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش سند"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
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
