/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, CashierShiftCloseout, Cashier, CashDrawer, BankAccount } from '../../types';
import { 
  Lock, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  AlertTriangle, Calculator, FileSpreadsheet, Printer, 
  Save, X, Calendar, Clock, User, Banknote, ShieldCheck, CreditCard, Vault, Hash,
  RefreshCw, Sparkles, CheckCircle2, Layers, ArrowDownLeft, ArrowUpRight
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString,
  getTodayJalali, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate
} from '../../utils/persianUtils';
import TreasuryDateFilterBar, { DateFilterMode } from './TreasuryDateFilterBar';

interface CashierShiftCloseoutTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export default function CashierShiftCloseoutTab({ db, onUpdateDb, activePeriodId, askConfirm }: CashierShiftCloseoutTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingCloseout, setEditingCloseout] = useState<CashierShiftCloseout | null>(null);

  // Date Filter State for List View
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'yesterday' | '7days' | '30days' | 'specific' | 'range' | 'all'>('today');
  const [specificDate, setSpecificDate] = useState<string>(getTodayJalali());
  const [fromDate, setFromDate] = useState<string>(getRelativeJalaliDate(-7));
  const [toDate, setToDate] = useState<string>(getTodayJalali());

  // Form State
  const [closeoutNo, setCloseoutNo] = useState('');
  const [date, setDate] = useState(getTodayJalali());
  const [shift, setShift] = useState<'morning' | 'evening' | 'night' | 'full_day'>('morning');
  const [cashierId, setCashierId] = useState('');
  const [cashierName, setCashierName] = useState('');
  const [cashDrawerId, setCashDrawerId] = useState('');
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [totalCashSales, setTotalCashSales] = useState<number>(0);
  const [totalCashReceipts, setTotalCashReceipts] = useState<number>(0);
  const [totalCashPayments, setTotalCashPayments] = useState<number>(0);
  const [actualCashCount, setActualCashCount] = useState<number>(0);
  const [totalPosReceipts, setTotalPosReceipts] = useState<number>(0);
  const [posTransactionsCount, setPosTransactionsCount] = useState<number>(0);
  const [transferredToSafe, setTransferredToSafe] = useState<number>(0);
  const [transferredToBank, setTransferredToBank] = useState<number>(0);
  const [bankAccountId, setBankAccountId] = useState('');
  const [cashierNotes, setCashierNotes] = useState('');
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [status, setStatus] = useState<'closed' | 'open' | 'discrepancy'>('closed');
  const [autoCalculatedApplied, setAutoCalculatedApplied] = useState(false);

  const closeouts = useMemo(() => {
    return db.cashierShiftCloseouts || [];
  }, [db.cashierShiftCloseouts]);

  const cashiers = useMemo(() => db.cashiers || [], [db.cashiers]);
  const cashDrawers = useMemo(() => db.cashDrawers || [], [db.cashDrawers]);
  const bankAccounts = useMemo(() => db.bankAccounts || [], [db.bankAccounts]);
  const treasuryReceipts = useMemo(() => db.treasuryReceipts || [], [db.treasuryReceipts]);
  const treasuryPayments = useMemo(() => db.treasuryPayments || [], [db.treasuryPayments]);

  // System Calculation Engine (Extracts real transactions from database to prevent manual entry errors)
  const systemCalculations = useMemo(() => {
    const targetDate = normalizeJalaliDate(date);
    
    // Matched cash receipts for this date & cashier/drawer
    const matchedReceipts = treasuryReceipts.filter(r => {
      if (normalizeJalaliDate(r.date) !== targetDate) return false;
      if (r.status === 'cancelled') return false;
      if (cashierId && r.cashierId && r.cashierId !== cashierId) return false;
      if (cashDrawerId && r.cashDrawerId && r.cashDrawerId !== cashDrawerId) return false;
      return true;
    });

    const cashReceipts = matchedReceipts.filter(r => r.paymentMethod === 'cash');
    
    let calculatedCashSales = 0;
    let calculatedOtherReceipts = 0;

    cashReceipts.forEach(r => {
      const isSales = r.category === 'فروش نقدی روزانه' || r.category === 'تسویه فاکتور فروش' || !r.category;
      if (isSales) {
        calculatedCashSales += (r.amount || 0);
      } else {
        calculatedOtherReceipts += (r.amount || 0);
      }
    });

    // POS Receipts
    const posReceipts = matchedReceipts.filter(r => r.paymentMethod === 'pos');
    const calculatedPosAmount = posReceipts.reduce((sum, r) => sum + (r.amount || 0), 0);
    const calculatedPosCount = posReceipts.length;

    // Matched cash payments
    const matchedPayments = treasuryPayments.filter(p => {
      if (normalizeJalaliDate(p.date) !== targetDate) return false;
      if (p.status === 'cancelled') return false;
      if (p.paymentMethod !== 'cash') return false;
      if (cashDrawerId && p.cashDrawerId && p.cashDrawerId !== cashDrawerId) return false;
      return true;
    });

    const calculatedCashPayments = matchedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const selectedDrawer = cashDrawers.find(d => d.id === cashDrawerId);
    const calculatedOpening = selectedDrawer ? (selectedDrawer.openingBalance || selectedDrawer.balance || 0) : 0;
    const calculatedExpected = calculatedOpening + calculatedCashSales + calculatedOtherReceipts - calculatedCashPayments;

    return {
      cashSales: calculatedCashSales,
      otherReceipts: calculatedOtherReceipts,
      cashPayments: calculatedCashPayments,
      posAmount: calculatedPosAmount,
      posCount: calculatedPosCount,
      openingBalance: calculatedOpening,
      expectedCash: calculatedExpected,
      receiptsCount: matchedReceipts.length,
      paymentsCount: matchedPayments.length
    };
  }, [treasuryReceipts, treasuryPayments, cashDrawers, date, cashierId, cashDrawerId]);

  // Method to sync system-calculated figures into form
  const applySystemCalculations = () => {
    setTotalCashSales(systemCalculations.cashSales);
    setTotalCashReceipts(systemCalculations.otherReceipts);
    setTotalCashPayments(systemCalculations.cashPayments);
    setTotalPosReceipts(systemCalculations.posAmount);
    setPosTransactionsCount(systemCalculations.posCount);
    if (!editingCloseout) {
      setOpeningBalance(systemCalculations.openingBalance);
      setActualCashCount(systemCalculations.expectedCash);
    }
    setAutoCalculatedApplied(true);
  };

  // Expected cash calculated
  const expectedCash = useMemo(() => {
    return (Number(openingBalance) || 0) + (Number(totalCashSales) || 0) + (Number(totalCashReceipts) || 0) - (Number(totalCashPayments) || 0);
  }, [openingBalance, totalCashSales, totalCashReceipts, totalCashPayments]);

  // Difference calculated
  const cashDifference = useMemo(() => {
    return (Number(actualCashCount) || 0) - expectedCash;
  }, [actualCashCount, expectedCash]);

  const stats = useMemo(() => {
    const totalCount = closeouts.length;
    const closedCount = closeouts.filter(c => c.status === 'closed').length;
    const totalPos = closeouts.reduce((sum, c) => sum + (c.totalPosReceipts || 0), 0);
    const totalCashTurnover = closeouts.reduce((sum, c) => sum + (c.totalCashSales || 0) + (c.totalCashReceipts || 0), 0);
    const totalDiscrepancy = closeouts.reduce((sum, c) => sum + (c.cashDifference || 0), 0);
    return { totalCount, closedCount, totalPos, totalCashTurnover, totalDiscrepancy };
  }, [closeouts]);

  const filteredCloseouts = useMemo(() => {
    const today = getTodayJalali();
    const yesterday = getRelativeJalaliDate(-1);
    const sevenDaysAgo = getRelativeJalaliDate(-7);
    const thirtyDaysAgo = getRelativeJalaliDate(-30);

    return closeouts.filter(c => {
      // Date filter
      if (dateFilterMode === 'today') {
        if (normalizeJalaliDate(c.date) !== normalizeJalaliDate(today)) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (normalizeJalaliDate(c.date) !== normalizeJalaliDate(yesterday)) return false;
      } else if (dateFilterMode === '7days') {
        if (!isJalaliDateInRange(c.date, sevenDaysAgo, today)) return false;
      } else if (dateFilterMode === '30days') {
        if (!isJalaliDateInRange(c.date, thirtyDaysAgo, today)) return false;
      } else if (dateFilterMode === 'specific') {
        if (normalizeJalaliDate(c.date) !== normalizeJalaliDate(specificDate)) return false;
      } else if (dateFilterMode === 'range') {
        if (!isJalaliDateInRange(c.date, fromDate, toDate)) return false;
      }

      if (searchQuery) {
        const matches = 
          matchPersianString(c.cashierName, searchQuery) ||
          c.closeoutNo.includes(searchQuery) ||
          matchPersianString(c.cashierNotes || '', searchQuery) ||
          matchPersianString(c.supervisorNotes || '', searchQuery);
        if (!matches) return false;
      }
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      return true;
    });
  }, [closeouts, dateFilterMode, specificDate, fromDate, toDate, searchQuery, statusFilter]);

  const handleOpenNew = () => {
    setEditingCloseout(null);
    const seq = (closeouts.length + 1).toString().padStart(3, '0');
    setCloseoutNo(`CLS-140501-${seq}`);
    const today = getTodayJalali();
    setDate(today);
    setShift('morning');
    const initialCashier = cashiers[0];
    const initialCashierId = initialCashier?.id || '';
    setCashierId(initialCashierId);
    setCashierName(initialCashier?.fullName || '');
    
    const assignedDrawerId = initialCashier?.assignedDrawerId || cashDrawers[0]?.id || '';
    setCashDrawerId(assignedDrawerId);
    const drawer = cashDrawers.find(d => d.id === assignedDrawerId);
    const drawerBal = drawer ? (drawer.openingBalance || drawer.balance || 5000000) : 5000000;
    setOpeningBalance(drawerBal);

    // Fetch system values for today immediately
    const targetDate = normalizeJalaliDate(today);
    const mReceipts = treasuryReceipts.filter(r => normalizeJalaliDate(r.date) === targetDate && r.status !== 'cancelled');
    const mPayments = treasuryPayments.filter(p => normalizeJalaliDate(p.date) === targetDate && p.status !== 'cancelled' && p.paymentMethod === 'cash');
    
    const cashRecs = mReceipts.filter(r => r.paymentMethod === 'cash');
    let cSales = 0;
    let cOther = 0;
    cashRecs.forEach(r => {
      const isSales = r.category === 'فروش نقدی روزانه' || r.category === 'تسویه فاکتور فروش' || !r.category;
      if (isSales) {
        cSales += (r.amount || 0);
      } else {
        cOther += (r.amount || 0);
      }
    });

    const posRecs = mReceipts.filter(r => r.paymentMethod === 'pos');
    const posAmt = posRecs.reduce((sum, r) => sum + (r.amount || 0), 0);
    const posCnt = posRecs.length;
    const payAmt = mPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    setTotalCashSales(cSales);
    setTotalCashReceipts(cOther);
    setTotalCashPayments(payAmt);
    setTotalPosReceipts(posAmt);
    setPosTransactionsCount(posCnt);
    const expected = drawerBal + cSales + cOther - payAmt;
    setActualCashCount(expected);
    setTransferredToSafe(Math.max(0, expected - 5000000));
    setTransferredToBank(0);
    setBankAccountId(bankAccounts[0]?.id || '');
    setCashierNotes('شمارش نهایی صندوق و استعلام تراکنش‌های سیستمی انجام شد.');
    setSupervisorNotes('تایید و وجوه نقد تحویل خزانه گردید.');
    setStatus('closed');
    setAutoCalculatedApplied(true);
    setActiveSubView('form');
  };

  const handleOpenEdit = (c: CashierShiftCloseout) => {
    setEditingCloseout(c);
    setCloseoutNo(c.closeoutNo);
    setDate(c.date);
    setShift(c.shift);
    setCashierId(c.cashierId);
    setCashierName(c.cashierName);
    setCashDrawerId(c.cashDrawerId);
    setOpeningBalance(c.openingBalance);
    setTotalCashSales(c.totalCashSales);
    setTotalCashReceipts(c.totalCashReceipts);
    setTotalCashPayments(c.totalCashPayments);
    setActualCashCount(c.actualCashCount);
    setTotalPosReceipts(c.totalPosReceipts);
    setPosTransactionsCount(c.posTransactionsCount);
    setTransferredToSafe(c.transferredToSafe);
    setTransferredToBank(c.transferredToBank);
    setBankAccountId(c.bankAccountId || '');
    setCashierNotes(c.cashierNotes || '');
    setSupervisorNotes(c.supervisorNotes || '');
    setStatus(c.status);
    setAutoCalculatedApplied(false);
    setActiveSubView('form');
  };

  const handleCashierSelect = (id: string) => {
    setCashierId(id);
    const found = cashiers.find(c => c.id === id);
    if (found) {
      setCashierName(found.fullName);
      if (found.assignedDrawerId) {
        setCashDrawerId(found.assignedDrawerId);
        const drawer = cashDrawers.find(d => d.id === found.assignedDrawerId);
        if (drawer) setOpeningBalance(drawer.balance || 0);
      }
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashierName.trim()) {
      alert('لطفاً صندوق‌دار و صندوق مربوطه را مشخص فرمایید.');
      return;
    }

    const currentList = db.cashierShiftCloseouts || [];
    let updatedList: CashierShiftCloseout[];

    const finalDiff = (Number(actualCashCount) || 0) - expectedCash;
    let finalStatus = status;
    if (finalDiff !== 0 && status === 'closed') {
      finalStatus = 'discrepancy';
    }

    const closeoutObj: CashierShiftCloseout = {
      id: editingCloseout ? editingCloseout.id : `cls-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      periodId: activePeriodId,
      closeoutNo: closeoutNo.trim(),
      date,
      shift,
      cashierId,
      cashierName: cashierName.trim(),
      cashDrawerId,
      openingBalance: Number(openingBalance) || 0,
      totalCashSales: Number(totalCashSales) || 0,
      totalCashReceipts: Number(totalCashReceipts) || 0,
      totalCashPayments: Number(totalCashPayments) || 0,
      expectedCash,
      actualCashCount: Number(actualCashCount) || 0,
      cashDifference: finalDiff,
      totalPosReceipts: Number(totalPosReceipts) || 0,
      posTransactionsCount: Number(posTransactionsCount) || 0,
      transferredToSafe: Number(transferredToSafe) || 0,
      transferredToBank: Number(transferredToBank) || 0,
      bankAccountId: bankAccountId || undefined,
      cashierNotes: cashierNotes.trim(),
      supervisorNotes: supervisorNotes.trim(),
      status: finalStatus,
      closedAt: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      approvedBy: 'مدیر فروشگاه و خزانه'
    };

    if (editingCloseout) {
      updatedList = currentList.map(c => c.id === editingCloseout.id ? closeoutObj : c);
    } else {
      updatedList = [closeoutObj, ...currentList];
    }

    onUpdateDb({
      ...db,
      cashierShiftCloseouts: updatedList
    });

    setActiveSubView('list');
    setEditingCloseout(null);
  };

  const handleDelete = (c: CashierShiftCloseout) => {
    askConfirm(
      'حذف بستن حساب شیفت',
      `آیا از حذف برگه تسویه حساب شیفت شماره "${c.closeoutNo}" مربوط به صندوق‌دار "${c.cashierName}" اطمینان دارید؟`,
      () => {
        const updated = (db.cashierShiftCloseouts || []).filter(item => item.id !== c.id);
        onUpdateDb({
          ...db,
          cashierShiftCloseouts: updated
        });
      }
    );
  };

  const handleExportCSV = () => {
    const headers = ['شماره برگه', 'تاریخ', 'شیفت', 'صندوق‌دار', 'موجودی دفتری', 'شمارش فیزیکی', 'مغایرت (کسری/مازاد)', 'رسیدهای کارتخوان', 'تحویلی به گاوصندوق', 'وضعیت'];
    const rows = filteredCloseouts.map(c => [
      c.closeoutNo,
      c.date,
      c.shift === 'morning' ? 'صبح' : c.shift === 'evening' ? 'عصر' : 'کامل',
      c.cashierName,
      c.expectedCash,
      c.actualCashCount,
      c.cashDifference,
      c.totalPosReceipts,
      c.transferredToSafe,
      c.status === 'closed' ? 'تایید و بسته شده' : c.status === 'discrepancy' ? 'دارای مغایرت' : 'باز'
    ]);
    downloadCSV('گزارش_بستن_حساب_صندوقداران.csv', headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">کل شیفت‌های بسته‌شده</span>
            <span className="text-2xl font-black text-white mt-1 block">{toPersianDigits(stats.totalCount)}</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Lock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع گردش نقدینگی شیفت‌ها</span>
            <span className="text-lg font-black text-emerald-400 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalCashTurnover))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Banknote className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">تراکنش‌های کارتخوان POS</span>
            <span className="text-lg font-black text-cyan-300 mt-1 block">
              {toPersianDigits(formatWithCommas(stats.totalPos))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <CreditCard className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div>
            <span className="text-xs text-slate-400 font-medium block">مجموع مغایرت‌های صندوق (کسری/مازاد)</span>
            <span className={`text-lg font-black mt-1 block ${stats.totalDiscrepancy < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {toPersianDigits(formatWithCommas(stats.totalDiscrepancy))} <span className="text-[10px] text-slate-400 font-normal">ریال</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <Calculator className="w-6 h-6" />
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
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingCloseout ? 'ویرایش فرم بستن حساب صندوق‌دار' : 'فرم بستن حساب روزانه و تسویه شیفت صندوق‌دار'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">محاسبه خودکار تراز نقدی، شمارش فیزیکی، تشخیص مغایرت و انتقال وجوه به گاوصندوق</p>
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
            {/* System Calculation Auto-Sync Banner */}
            <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-amber-500/5 border border-amber-500/30 p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/20 rounded-xl text-amber-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-amber-300">محاسبه و استعلام هوشمند از سیستم</span>
                    {autoCalculatedApplied ? (
                      <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-bold">
                        <CheckCircle2 className="w-3 h-3" /> مقادیر از اسناد سیستم تطبیق یافت
                      </span>
                    ) : (
                      <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-medium">
                        ویرایش دستی / سفارشی
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    فروش نقدی، دریافتی‌ها، پرداختی‌ها و تراکنش‌های کارتخوان بر اساس اسناد ثبت‌شده تاریخ <span className="text-white font-bold font-mono">{toPersianDigits(date)}</span> به صورت خودکار استخراج شدند تا از خطای انسانی جلوگیری شود.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={applySystemCalculations}
                  className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  title="استعلام مجدد مقادیر از اسناد حسابداری و دریافتی‌های صندوق"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>محاسبه مجدد از سیستم</span>
                </button>
              </div>
            </div>

            {/* System Breakdown Quick Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 text-xs">
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">فروش نقدی سیستمی</span>
                <span className="text-emerald-400 font-bold font-mono text-xs mt-0.5 block">
                  {toPersianDigits(formatWithCommas(systemCalculations.cashSales))} ریال
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">سایر دریافتی‌های سیستمی</span>
                <span className="text-cyan-300 font-bold font-mono text-xs mt-0.5 block">
                  {toPersianDigits(formatWithCommas(systemCalculations.otherReceipts))} ریال
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">پرداختی‌ها و هزینه‌های ثبت‌شده</span>
                <span className="text-rose-400 font-bold font-mono text-xs mt-0.5 block">
                  {toPersianDigits(formatWithCommas(systemCalculations.cashPayments))} ریال
                </span>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 block">رسیدهای کارتخوان POS ({toPersianDigits(systemCalculations.posCount)} تراکنش)</span>
                <span className="text-cyan-400 font-bold font-mono text-xs mt-0.5 block">
                  {toPersianDigits(formatWithCommas(systemCalculations.posAmount))} ریال
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              {/* Closeout No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-amber-400" />
                  شماره برگه بستن حساب <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={closeoutNo}
                  onChange={(e) => setCloseoutNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  تاریخ تسویه شیفت <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setAutoCalculatedApplied(false);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Shift */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  شیفت کاری
                </label>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                >
                  <option value="morning">شیفت صبح (۰۸:۰۰ الی ۱۶:۰۰)</option>
                  <option value="evening">شیفت عصر (۱۶:۰۰ الی ۲۳:۰۰)</option>
                  <option value="night">شیفت شب</option>
                  <option value="full_day">تمام وقت / کامل روزانه</option>
                </select>
              </div>

              {/* Cashier Select */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-amber-400" />
                  صندوق‌دار تحویل‌دهنده <span className="text-rose-400">*</span>
                </label>
                <select
                  value={cashierId}
                  onChange={(e) => handleCashierSelect(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                  required
                >
                  <option value="">-- انتخاب صندوق‌دار --</option>
                  {cashiers.map(c => (
                    <option key={c.id} value={c.id}>{c.fullName} ({c.code})</option>
                  ))}
                </select>
              </div>

              {/* Cash Drawer */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Vault className="w-3.5 h-3.5 text-amber-400" />
                  صندوق تحویلی <span className="text-rose-400">*</span>
                </label>
                <select
                  value={cashDrawerId}
                  onChange={(e) => setCashDrawerId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors"
                  required
                >
                  <option value="">-- انتخاب صندوق --</option>
                  {cashDrawers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              {/* Opening Balance */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">موجودی تنخواه اول شیفت (ریال)</label>
                <input
                  type="text"
                  value={formatWithCommas(openingBalance)}
                  onChange={(e) => setOpeningBalance(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-bold text-left focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Cash Flow Panel */}
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950/80 p-4 rounded-2xl border border-slate-800">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-bold text-emerald-400">جمع فروش نقدی شیفت (ریال)</label>
                    <span className="text-[10px] text-emerald-500/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">مشخص‌شده توسط سیستم</span>
                  </div>
                  <input
                    type="text"
                    value={formatWithCommas(totalCashSales)}
                    onChange={(e) => {
                      setTotalCashSales(parseNumber(e.target.value));
                      setAutoCalculatedApplied(false);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-emerald-400 font-mono text-left font-bold focus:border-emerald-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-bold text-cyan-300">سایر دریافتی‌های نقدی (ریال)</label>
                    <span className="text-[10px] text-cyan-400/80 bg-cyan-500/10 px-1.5 py-0.5 rounded">مشخص‌شده توسط سیستم</span>
                  </div>
                  <input
                    type="text"
                    value={formatWithCommas(totalCashReceipts)}
                    onChange={(e) => {
                      setTotalCashReceipts(parseNumber(e.target.value));
                      setAutoCalculatedApplied(false);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-cyan-300 font-mono text-left font-bold focus:border-cyan-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-bold text-rose-400">پرداختی‌ها و هزینه‌های نقدی (ریال)</label>
                    <span className="text-[10px] text-rose-400/80 bg-rose-500/10 px-1.5 py-0.5 rounded">مشخص‌شده توسط سیستم</span>
                  </div>
                  <input
                    type="text"
                    value={formatWithCommas(totalCashPayments)}
                    onChange={(e) => {
                      setTotalCashPayments(parseNumber(e.target.value));
                      setAutoCalculatedApplied(false);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-rose-400 font-mono text-left font-bold focus:border-rose-500 outline-none"
                  />
                </div>
              </div>

              {/* Physical Count & Difference Panel */}
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-950 p-4 rounded-2xl border border-amber-500/30">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">موجودی دفتری مورد انتظار (ریال)</label>
                  <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-slate-300 font-black text-sm text-left font-mono">
                    {toPersianDigits(formatWithCommas(expectedCash))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-amber-400 font-bold flex items-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5" />
                    موجودی فیزیکی شمارش‌شده (ریال) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formatWithCommas(actualCashCount)}
                    onChange={(e) => setActualCashCount(parseNumber(e.target.value))}
                    className="w-full bg-slate-900 border border-amber-500/50 rounded-xl p-3 text-amber-300 font-black text-sm text-left font-mono focus:border-amber-400 outline-none"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">وضعیت مغایرت (کسری / مازاد)</label>
                  <div className={`w-full bg-slate-900 border rounded-xl p-3 font-black text-sm text-left font-mono ${
                    cashDifference === 0 
                      ? 'border-emerald-500/40 text-emerald-400'
                      : cashDifference > 0 
                      ? 'border-cyan-500/40 text-cyan-300'
                      : 'border-rose-500/40 text-rose-400'
                  }`}>
                    {cashDifference === 0 ? 'تراز دقیق (بدون مغایرت)' : `${toPersianDigits(formatWithCommas(cashDifference))} ریال ${cashDifference > 0 ? '(مازاد)' : '(کسری)'}`}
                  </div>
                </div>
              </div>

              {/* POS Summary */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                  مجموع تراکنش‌های کارتخوان (ریال)
                </label>
                <input
                  type="text"
                  value={formatWithCommas(totalPosReceipts)}
                  onChange={(e) => setTotalPosReceipts(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-cyan-300 font-bold text-left focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">تعداد کل تراکنش‌های کارتخوان</label>
                <input
                  type="number"
                  value={posTransactionsCount}
                  onChange={(e) => setPosTransactionsCount(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Transferred to Safe */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Vault className="w-3.5 h-3.5 text-emerald-400" />
                  مبلغ تحویلی به گاوصندوق اصلی (ریال)
                </label>
                <input
                  type="text"
                  value={formatWithCommas(transferredToSafe)}
                  onChange={(e) => setTransferredToSafe(parseNumber(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 font-bold text-left focus:border-amber-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Notes */}
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">یادداشت صندوق‌دار</label>
                  <textarea
                    rows={2}
                    placeholder="توضیحات در خصوص مغایرت، اسکناس‌های فرسوده، چک‌های دریافتی..."
                    value={cashierNotes}
                    onChange={(e) => setCashierNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">تایید و یادداشت سرپرست خزانه</label>
                  <textarea
                    rows={2}
                    placeholder="توضیحات سرپرست، تحویل وجه و تایید تراز نهایی..."
                    value={supervisorNotes}
                    onChange={(e) => setSupervisorNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-amber-500 outline-none transition-colors text-xs"
                  />
                </div>
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
                {editingCloseout ? 'ذخیره تغییرات' : 'تایید نهایی و بستن حساب شیفت'}
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
            title="فیلتر زمانی تسویه شیفت‌ها:"
            colorScheme="amber"
          />

          {/* Controls Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو با شماره برگه، نام صندوق‌دار، یادداشت‌ها..."
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
                <option value="closed">بسته و تایید شده</option>
                <option value="discrepancy">دارای مغایرت</option>
                <option value="open">باز</option>
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
                onClick={() => printElement('closeouts-table-print')}
                className="p-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ لیست بستن حساب‌ها"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>

              <button
                onClick={handleOpenNew}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت بستن حساب شیفت</span>
              </button>
            </div>
          </div>

          {/* Closeouts Table */}
          <div id="closeouts-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره برگه / تاریخ</th>
                  <th className="p-3.5">صندوق‌دار و شیفت</th>
                  <th className="p-3.5 text-left">موجودی دفتری</th>
                  <th className="p-3.5 text-left">شمارش فیزیکی</th>
                  <th className="p-3.5 text-center">مغایرت</th>
                  <th className="p-3.5 text-left">کارتخوان POS</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredCloseouts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">
                      هیچ برگه بستن حساب صندوق‌داری یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredCloseouts.map((c, index) => {
                    return (
                      <tr key={c.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-amber-400">{c.closeoutNo}</div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {toPersianDigits(c.date)}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {c.cashierName}
                          </div>
                          <span className="text-[10px] text-amber-400 block">
                            {c.shift === 'morning' ? 'شیفت صبح' : c.shift === 'evening' ? 'شیفت عصر' : 'تمام وقت'}
                          </span>
                        </td>
                        <td className="p-3.5 text-left font-mono text-slate-300">
                          {toPersianDigits(formatWithCommas(c.expectedCash))}
                        </td>
                        <td className="p-3.5 text-left font-mono font-bold text-emerald-400">
                          {toPersianDigits(formatWithCommas(c.actualCashCount))}
                        </td>
                        <td className="p-3.5 text-center font-mono">
                          {c.cashDifference === 0 ? (
                            <span className="text-emerald-400 text-[11px] font-bold">تراز دقیق</span>
                          ) : (
                            <span className={`text-[11px] font-bold ${c.cashDifference > 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                              {toPersianDigits(formatWithCommas(c.cashDifference))} {c.cashDifference > 0 ? '+' : ''}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-left font-mono text-cyan-300">
                          {toPersianDigits(formatWithCommas(c.totalPosReceipts))}
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            c.status === 'closed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : c.status === 'discrepancy'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {c.status === 'closed' ? 'بسته و تایید' : c.status === 'discrepancy' ? 'دارای مغایرت' : 'باز'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(c)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش سند"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(c)}
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
