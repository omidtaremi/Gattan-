/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, TreasuryPayment, BankAccount, CashDrawer, Supplier, Personnel, ChequeBook, ChequeLeaf } from '../../types';
import { 
  ArrowUpRight, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  Landmark, Vault, FileText, Hash, FileSpreadsheet, Printer, 
  Save, X, Calendar, Clock, User, Banknote, ShieldCheck, Eye, RefreshCw,
  Sparkles, CreditCard, AlertCircle, CheckCircle2, ChevronDown, BookOpen
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, printElement, matchPersianString,
  getTodayJalali, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate, numberToWordsPersian
} from '../../utils/persianUtils';
import TreasuryDateFilterBar, { DateFilterMode } from './TreasuryDateFilterBar';
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

interface PaymentsTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

const PAYMENT_CATEGORIES = [
  'تسویه فاکتور خرید مواد اولیه',
  'پرداخت حقوق و دستمزد پرسنل',
  'پرداخت مساعده / پاداش پرسنل',
  'شارژ تنخواه‌گردان کارگاه و تولید',
  'هزینه‌های جاری و آب و برق و گاز',
  'اجاره بهاء کارگاه و فروشگاه',
  'هزینه‌های تعمیرات و نگهداری ماشین‌آلات',
  'خرید ملزومات و شوینده و بسته‌بندی',
  'سایر پرداخت‌های مالی'
];

export default function PaymentsTab({ db, onUpdateDb, activePeriodId, askConfirm }: PaymentsTabProps) {
  const [activeSubView, setActiveSubView] = useState<'list' | 'form'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editingPayment, setEditingPayment] = useState<TreasuryPayment | null>(null);

  // Date Filter State (Default to 'today' as requested by user)
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'yesterday' | '7days' | '30days' | 'specific' | 'range' | 'all'>('today');
  const [specificDate, setSpecificDate] = useState<string>(getTodayJalali());
  const [fromDate, setFromDate] = useState<string>(getRelativeJalaliDate(-7));
  const [toDate, setToDate] = useState<string>(getTodayJalali());

  // Form State
  const [paymentNo, setPaymentNo] = useState('');
  const [date, setDate] = useState(getTodayJalali());
  const [time, setTime] = useState(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
  const [beneficiaryType, setBeneficiaryType] = useState<'supplier' | 'personnel' | 'expense' | 'shareholder' | 'other'>('supplier');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'cash' | 'cheque'>('bank_transfer');
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState(PAYMENT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'pending' | 'cancelled'>('confirmed');

  // Account / Source Fields
  const [bankAccountId, setBankAccountId] = useState('');
  const [bankTransferRef, setBankTransferRef] = useState('');
  const [cashDrawerId, setCashDrawerId] = useState('');

  // Cheque Fields
  const [chequeBookId, setChequeBookId] = useState('');
  const [chequeLeafId, setChequeLeafId] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [sayadNo, setSayadNo] = useState('');
  const [dueDate, setDueDate] = useState(getTodayJalali());
  const [bankName, setBankName] = useState('بانک ملت');
  const [payeeName, setPayeeName] = useState('');

  const payments = useMemo(() => {
    return (db.treasuryPayments || []).filter(p => p.periodId === activePeriodId);
  }, [db.treasuryPayments, activePeriodId]);

  const bankAccounts = useMemo(() => (db.bankAccounts || []).filter(b => b.periodId === activePeriodId), [db.bankAccounts, activePeriodId]);
  const cashDrawers = useMemo(() => (db.cashDrawers || []).filter(d => d.periodId === activePeriodId), [db.cashDrawers, activePeriodId]);
  const suppliers = useMemo(() => (db.suppliers || []).filter(s => s.periodId === activePeriodId), [db.suppliers, activePeriodId]);
  const personnelList = useMemo(() => (db.personnel || []).filter(p => p.periodId === activePeriodId), [db.personnel, activePeriodId]);
  const chequeBooks = useMemo(() => (db.chequeBooks || []).filter(b => b.periodId === activePeriodId), [db.chequeBooks, activePeriodId]);
  const chequeLeaves = useMemo(() => (db.chequeLeaves || []).filter(l => l.periodId === activePeriodId), [db.chequeLeaves, activePeriodId]);

  // Cheque Maps & Available Leaves for Selection
  const bankMap = useMemo(() => {
    const map = new Map<string, BankAccount>();
    bankAccounts.forEach(b => map.set(b.id, b));
    return map;
  }, [bankAccounts]);

  const bookMap = useMemo(() => {
    const map = new Map<string, ChequeBook>();
    chequeBooks.forEach(b => map.set(b.id, b));
    return map;
  }, [chequeBooks]);

  // Blank leaves for the currently selected cheque book (or the one being edited)
  const availableBlankLeaves = useMemo(() => {
    return chequeLeaves.filter(l => {
      if (chequeBookId && l.chequeBookId !== chequeBookId) return false;
      return l.status === 'blank' || l.id === editingPayment?.chequeDetails?.chequeLeafId;
    });
  }, [chequeLeaves, chequeBookId, editingPayment]);

  const stats = useMemo(() => {
    const totalCount = payments.length;
    const confirmedCount = payments.filter(p => p.status === 'confirmed').length;
    const totalAmount = payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + (p.amount || 0), 0);
    const bankAmount = payments.filter(p => p.status === 'confirmed' && p.paymentMethod === 'bank_transfer').reduce((sum, p) => sum + (p.amount || 0), 0);
    const cashAmount = payments.filter(p => p.status === 'confirmed' && p.paymentMethod === 'cash').reduce((sum, p) => sum + (p.amount || 0), 0);
    const chequeAmount = payments.filter(p => p.status === 'confirmed' && p.paymentMethod === 'cheque').reduce((sum, p) => sum + (p.amount || 0), 0);
    return { totalCount, confirmedCount, totalAmount, bankAmount, cashAmount, chequeAmount };
  }, [payments]);

  const filteredPayments = useMemo(() => {
    const today = getTodayJalali();
    const yesterday = getRelativeJalaliDate(-1);
    const sevenDaysAgo = getRelativeJalaliDate(-7);
    const thirtyDaysAgo = getRelativeJalaliDate(-30);

    return payments.filter(p => {
      // Date Filter
      if (dateFilterMode === 'today') {
        if (normalizeJalaliDate(p.date) !== normalizeJalaliDate(today)) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (normalizeJalaliDate(p.date) !== normalizeJalaliDate(yesterday)) return false;
      } else if (dateFilterMode === '7days') {
        if (!isJalaliDateInRange(p.date, sevenDaysAgo, today)) return false;
      } else if (dateFilterMode === '30days') {
        if (!isJalaliDateInRange(p.date, thirtyDaysAgo, today)) return false;
      } else if (dateFilterMode === 'specific') {
        if (normalizeJalaliDate(p.date) !== normalizeJalaliDate(specificDate)) return false;
      } else if (dateFilterMode === 'range') {
        if (!isJalaliDateInRange(p.date, fromDate, toDate)) return false;
      }

      if (searchQuery) {
        const matches = 
          matchPersianString(p.beneficiaryName, searchQuery) ||
          p.paymentNo.includes(searchQuery) ||
          matchPersianString(p.description || '', searchQuery) ||
          (p.bankTransferRef && p.bankTransferRef.includes(searchQuery)) ||
          (p.chequeDetails?.sayadNo && p.chequeDetails.sayadNo.includes(searchQuery));
        if (!matches) return false;
      }
      if (methodFilter !== 'all' && p.paymentMethod !== methodFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      return true;
    });
  }, [payments, dateFilterMode, specificDate, fromDate, toDate, searchQuery, methodFilter, categoryFilter, statusFilter]);

  // Handler when user selects a Cheque Book
  const handleSelectChequeBook = (bookId: string) => {
    setChequeBookId(bookId);
    const book = bookMap.get(bookId);
    if (book) {
      const bank = bankMap.get(book.bankAccountId);
      if (bank) {
        setBankAccountId(bank.id);
        setBankName(bank.bankName);
      }
      // Find first blank leaf of this book
      const firstBlank = chequeLeaves.find(l => l.chequeBookId === bookId && l.status === 'blank');
      if (firstBlank) {
        setChequeLeafId(firstBlank.id);
        setChequeNo(firstBlank.leafNumber.toString());
        setSayadNo(firstBlank.sayadNo);
      } else {
        setChequeLeafId('');
        setChequeNo('');
        setSayadNo('');
      }
    }
  };

  // Handler when user selects an individual Cheque Leaf
  const handleSelectChequeLeaf = (leafId: string) => {
    setChequeLeafId(leafId);
    const leaf = chequeLeaves.find(l => l.id === leafId);
    if (leaf) {
      setChequeNo(leaf.leafNumber.toString());
      setSayadNo(leaf.sayadNo);
      setChequeBookId(leaf.chequeBookId);
      const book = bookMap.get(leaf.chequeBookId);
      if (book) {
        const bank = bankMap.get(book.bankAccountId);
        if (bank) {
          setBankAccountId(bank.id);
          setBankName(bank.bankName);
        }
      }
    }
  };

  // Helper to auto-create a Cheque Book if none exist
  const handleAutoCreateChequeBook = () => {
    const targetBank = bankAccounts[0];
    if (!targetBank) {
      alert('لطفاً ابتدا از تب حساب‌های بانکی، حداقل یک حساب جاری تعریف نمایید.');
      return;
    }
    const newBookId = nextSimpleId(db.chequeBooks || [], getPrefixForCollection('chequeBooks'));
    const nextLeafId = createSimpleIdGenerator(db.chequeLeaves || [], getPrefixForCollection('chequeLeaves'));
    const newBook: ChequeBook = {
      id: newBookId,
      periodId: activePeriodId,
      bankAccountId: targetBank.id,
      series: 'الف/1405',
      sayadPrefix: '2105',
      startNumber: 1001,
      endNumber: 1025,
      totalLeaves: 25,
      receivedDate: getTodayJalali(),
      description: 'دسته چک پیش‌فرض ایجادشده جهت صدور پرداخت',
      status: 'active',
      createdAt: new Date().toISOString()
    };

    const newLeaves: ChequeLeaf[] = [];
    for (let i = 1001; i <= 1025; i++) {
      newLeaves.push({
        id: nextLeafId(),
        periodId: activePeriodId,
        chequeBookId: newBookId,
        bankAccountId: targetBank.id,
        leafNumber: i,
        sayadNo: `2105140501${i.toString().padStart(6, '0')}`,
        status: 'blank',
        createdAt: new Date().toISOString()
      });
    }

    onUpdateDb({
      ...db,
      chequeBooks: [...(db.chequeBooks || []), newBook],
      chequeLeaves: [...(db.chequeLeaves || []), ...newLeaves]
    });

    setChequeBookId(newBookId);
    setChequeLeafId(newLeaves[0].id);
    setChequeNo(newLeaves[0].leafNumber.toString());
    setSayadNo(newLeaves[0].sayadNo);
    setBankAccountId(targetBank.id);
    setBankName(targetBank.bankName);
  };

  const handleOpenNew = () => {
    setEditingPayment(null);
    const seq = (payments.length + 1).toString().padStart(3, '0');
    setPaymentNo(`PAY-140501-${seq}`);
    setDate(getTodayJalali());
    setTime(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));
    setBeneficiaryType('supplier');
    setBeneficiaryId(suppliers[0]?.id || '');
    setBeneficiaryName(suppliers[0]?.name || '');
    setPaymentMethod('bank_transfer');
    setAmount(0);
    setCategory(PAYMENT_CATEGORIES[0]);
    setDescription('');
    setStatus('confirmed');

    setBankAccountId(bankAccounts[0]?.id || '');
    setBankTransferRef('');
    setCashDrawerId(cashDrawers[0]?.id || '');

    // Setup active cheque book & first blank leaf
    const activeBook = chequeBooks.find(b => b.status === 'active') || chequeBooks[0];
    if (activeBook) {
      setChequeBookId(activeBook.id);
      const firstBlank = chequeLeaves.find(l => l.chequeBookId === activeBook.id && l.status === 'blank');
      if (firstBlank) {
        setChequeLeafId(firstBlank.id);
        setChequeNo(firstBlank.leafNumber.toString());
        setSayadNo(firstBlank.sayadNo);
      } else {
        setChequeLeafId('');
        setChequeNo('');
        setSayadNo('');
      }
      const bank = bankMap.get(activeBook.bankAccountId);
      setBankName(bank?.bankName || 'بانک ملت');
    } else {
      setChequeBookId('');
      setChequeLeafId('');
      setChequeNo('');
      setSayadNo('');
      setBankName(bankAccounts[0]?.bankName || 'بانک ملت');
    }

    setDueDate(getRelativeJalaliDate(30));
    setPayeeName(suppliers[0]?.name || '');

    setActiveSubView('form');
  };

  const handleOpenEdit = (p: TreasuryPayment) => {
    setEditingPayment(p);
    setPaymentNo(p.paymentNo);
    setDate(p.date);
    setTime(p.time || '');
    setBeneficiaryType(p.beneficiaryType);
    setBeneficiaryId(p.beneficiaryId || '');
    setBeneficiaryName(p.beneficiaryName);
    setPaymentMethod(p.paymentMethod);
    setAmount(p.amount);
    setCategory(p.category || PAYMENT_CATEGORIES[0]);
    setDescription(p.description || '');
    setStatus(p.status);

    setBankAccountId(p.bankAccountId || '');
    setBankTransferRef(p.bankTransferRef || '');
    setCashDrawerId(p.cashDrawerId || '');

    if (p.chequeDetails) {
      setChequeNo(p.chequeDetails.chequeNo);
      setSayadNo(p.chequeDetails.sayadNo);
      setDueDate(p.chequeDetails.dueDate);
      setBankName(p.chequeDetails.bankName);
      setPayeeName(p.chequeDetails.payeeName || p.beneficiaryName);
      setChequeBookId(p.chequeDetails.chequeBookId || '');
      setChequeLeafId(p.chequeDetails.chequeLeafId || '');
    } else {
      const activeBook = chequeBooks.find(b => b.status === 'active') || chequeBooks[0];
      if (activeBook) {
        setChequeBookId(activeBook.id);
        const firstBlank = chequeLeaves.find(l => l.chequeBookId === activeBook.id && l.status === 'blank');
        if (firstBlank) {
          setChequeLeafId(firstBlank.id);
          setChequeNo(firstBlank.leafNumber.toString());
          setSayadNo(firstBlank.sayadNo);
        }
      }
      setDueDate(getRelativeJalaliDate(30));
      setPayeeName(p.beneficiaryName);
    }
    setActiveSubView('form');
  };

  const handleSupplierChange = (sId: string) => {
    setBeneficiaryId(sId);
    const found = suppliers.find(s => s.id === sId);
    if (found) {
      setBeneficiaryName(found.name);
      setPayeeName(found.name);
    }
  };

  const handlePersonnelChange = (pId: string) => {
    setBeneficiaryId(pId);
    const found = personnelList.find(p => p.id === pId);
    if (found) {
      setBeneficiaryName(found.fullName);
      setPayeeName(found.fullName);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!beneficiaryName.trim() || amount <= 0) {
      alert('لطفاً نام ذینفع و مبلغ پرداختی معتبر را وارد نمایید.');
      return;
    }

    if (paymentMethod === 'cheque' && !sayadNo.trim()) {
      alert('لطفاً شناسه صیادی ۱۶ رقمی یا برگه چک را انتخاب فرمایید.');
      return;
    }

    const currentList = db.treasuryPayments || [];
    let updatedList: TreasuryPayment[];
    let updatedLeaves = [...(db.chequeLeaves || [])];

    const currentLeaf = chequeLeaves.find(l => l.id === chequeLeafId);
    const selectedBook = bookMap.get(chequeBookId || currentLeaf?.chequeBookId || '');
    const selectedBank = bankMap.get(selectedBook?.bankAccountId || bankAccountId);

    let chequeDetails = undefined;
    if (paymentMethod === 'cheque') {
      chequeDetails = {
        chequeNo: chequeNo.trim() || currentLeaf?.leafNumber.toString() || '1001',
        sayadNo: sayadNo.trim() || currentLeaf?.sayadNo || '',
        dueDate,
        bankName: selectedBank?.bankName || bankName || 'بانک ملت',
        payeeName: payeeName.trim() || beneficiaryName.trim(),
        chequeBookId: chequeBookId || currentLeaf?.chequeBookId,
        leafNumber: currentLeaf ? currentLeaf.leafNumber : Number(chequeNo) || undefined,
        chequeLeafId: chequeLeafId || currentLeaf?.id,
        status: (status === 'confirmed' ? 'issued' : 'pending') as any
      };
    }

    const paymentId = editingPayment ? editingPayment.id : nextSimpleId(currentList, getPrefixForCollection('treasuryPayments'));
    const paymentObj: TreasuryPayment = {
      id: paymentId,
      periodId: activePeriodId,
      paymentNo: paymentNo.trim(),
      date,
      time,
      beneficiaryType,
      beneficiaryId: beneficiaryId || undefined,
      beneficiaryName: beneficiaryName.trim(),
      paymentMethod,
      amount: Number(amount) || 0,
      bankAccountId: paymentMethod === 'bank_transfer' ? bankAccountId : paymentMethod === 'cheque' ? (selectedBank?.id || bankAccountId) : undefined,
      bankTransferRef: paymentMethod === 'bank_transfer' ? bankTransferRef.trim() : undefined,
      cashDrawerId: paymentMethod === 'cash' ? cashDrawerId : undefined,
      chequeDetails,
      category,
      description: description.trim(),
      registeredBy: 'حسابدار ارشد سامانه',
      status,
      createdAt: editingPayment ? editingPayment.createdAt : new Date().toLocaleDateString('fa-IR')
    };

    if (editingPayment) {
      updatedList = currentList.map(p => p.id === editingPayment.id ? paymentObj : p);
    } else {
      updatedList = [paymentObj, ...currentList];
    }

    // Synchronize Cheque Leaf Record in Database
    // 1. If previously editing a cheque payment and changed the leaf or method, release the old leaf
    if (editingPayment && editingPayment.chequeDetails?.chequeLeafId) {
      const oldLeafId = editingPayment.chequeDetails.chequeLeafId;
      if (oldLeafId !== chequeLeafId || paymentMethod !== 'cheque') {
        updatedLeaves = updatedLeaves.map(l => {
          if (l.id === oldLeafId) {
            return {
              id: l.id,
              periodId: l.periodId || activePeriodId,
              chequeBookId: l.chequeBookId,
              bankAccountId: l.bankAccountId,
              leafNumber: l.leafNumber,
              sayadNo: l.sayadNo,
              status: 'blank' as const,
              createdAt: l.createdAt
            };
          }
          return l;
        });
      }
    }

    // 2. If current payment is cheque, mark the leaf as issued with full metadata
    if (paymentMethod === 'cheque') {
      const targetLeafId = chequeLeafId || currentLeaf?.id;
      if (targetLeafId) {
        updatedLeaves = updatedLeaves.map(l => {
          if (l.id === targetLeafId) {
            return {
              ...l,
              sayadNo: sayadNo.trim() || l.sayadNo,
              status: (status === 'cancelled' ? 'blank' : 'issued') as any,
              paymentId: paymentObj.id,
              paymentNo: paymentObj.paymentNo,
              payeeName: payeeName.trim() || beneficiaryName.trim(),
              beneficiaryType: beneficiaryType,
              beneficiaryId: beneficiaryId || undefined,
              amount: Number(amount) || 0,
              issueDate: date,
              dueDate: dueDate,
              notes: description.trim() || `صدور چک بابت ${category} به شماره سند ${paymentObj.paymentNo}`
            };
          }
          return l;
        });
      }
    }

    onUpdateDb({
      ...db,
      treasuryPayments: updatedList,
      chequeLeaves: updatedLeaves
    });

    setActiveSubView('list');
    setEditingPayment(null);
  };

  const handleDelete = (p: TreasuryPayment) => {
    askConfirm(
      'حذف سند پرداخت',
      `آیا از حذف سند پرداخت شماره "${p.paymentNo}" به مبلغ ${toPersianDigits(formatWithCommas(p.amount))} ریال اطمینان دارید؟`,
      () => {
        const updatedPayments = (db.treasuryPayments || []).filter(item => item.id !== p.id);
        let updatedLeaves = db.chequeLeaves || [];

        // If the payment had a linked cheque leaf, restore that leaf back to blank!
        if (p.paymentMethod === 'cheque' && (p.chequeDetails?.chequeLeafId || p.chequeDetails?.sayadNo || p.paymentNo)) {
          updatedLeaves = updatedLeaves.map(l => {
            if (
              l.id === p.chequeDetails?.chequeLeafId || 
              l.paymentId === p.id || 
              (l.paymentNo === p.paymentNo && l.paymentNo)
            ) {
              return {
                id: l.id,
                periodId: l.periodId || activePeriodId,
                chequeBookId: l.chequeBookId,
                bankAccountId: l.bankAccountId,
                leafNumber: l.leafNumber,
                sayadNo: l.sayadNo,
                status: 'blank' as const,
                createdAt: l.createdAt
              };
            }
            return l;
          });
        }

        onUpdateDb({
          ...db,
          treasuryPayments: updatedPayments,
          chequeLeaves: updatedLeaves
        });
      }
    );
  };

  const handleExportExcel = () => {
    const rows = filteredPayments.map(p => ({
      'شماره سند': p.paymentNo,
      'تاریخ': p.date,
      'زمان': p.time || '',
      'ذینفع / دریافت‌کننده': p.beneficiaryName,
      'روش پرداخت': p.paymentMethod === 'bank_transfer' ? 'حواله بانکی' : p.paymentMethod === 'cash' ? 'نقدی از صندوق' : 'چک صیادی',
      'مبلغ (ریال)': p.amount,
      'بابت / سرفصل': p.category || '',
      'توضیحات': p.description || '',
      'وضعیت': p.status === 'confirmed' ? 'تایید شده' : p.status === 'pending' ? 'در انتظار' : 'لغو شده',
    }));
    exportRowsToExcel(rows, 'اسناد پرداختی', 'گزارش_اسناد_پرداختی_خزانه');
  };

  const handleDownloadTemplate = () => {
    downloadTemplateExcel(
      ['شماره سند', 'تاریخ', 'ذینفع / دریافت‌کننده', 'روش پرداخت', 'مبلغ (ریال)', 'بابت / سرفصل', 'کد پیگیری', 'توضیحات', 'وضعیت'],
      [{
        'شماره سند': 'PAY-140501-001',
        'تاریخ': getTodayJalali(),
        'ذینفع / دریافت‌کننده': 'تامین‌کننده مواد اولیه',
        'روش پرداخت': 'حواله بانکی',
        'مبلغ (ریال)': 45000000,
        'بابت / سرفصل': PAYMENT_CATEGORIES[0],
        'کد پیگیری': 'PY-8839210',
        'توضیحات': '',
        'وضعیت': 'تایید شده',
      }],
      'قالب_پرداخت',
      'نمونه_اسناد_پرداختی_خزانه'
    );
  };

  const handleImportExcel = async (file: File) => {
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) return;
      const currentList = db.treasuryPayments || [];
      const genId = createSimpleIdGenerator(currentList, getPrefixForCollection('treasuryPayments'));
      const imported: TreasuryPayment[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const beneficiary = pickRowField(row, ['ذینفع / دریافت‌کننده', 'ذینفع', 'طرف مقابل', 'beneficiaryName']);
        const amt = parseNumber(pickRowField(row, ['مبلغ (ریال)', 'مبلغ', 'amount']));
        if (!beneficiary || amt <= 0) continue;
        const methodRaw = pickRowField(row, ['روش پرداخت', 'روش', 'paymentMethod']);
        const method: TreasuryPayment['paymentMethod'] =
          methodRaw.includes('نقد') || methodRaw === 'cash'
            ? 'cash'
            : methodRaw.includes('چک') || methodRaw === 'cheque'
            ? 'cheque'
            : 'bank_transfer';
        const statusRaw = pickRowField(row, ['وضعیت', 'status']);
        const statusVal: TreasuryPayment['status'] =
          statusRaw.includes('انتظار') || statusRaw === 'pending'
            ? 'pending'
            : statusRaw.includes('لغو') || statusRaw.includes('باطل') || statusRaw === 'cancelled'
            ? 'cancelled'
            : 'confirmed';
        const refCode = pickRowField(row, ['کد پیگیری', 'شماره پیگیری', 'ref']);
        imported.push({
          id: genId(),
          periodId: activePeriodId,
          paymentNo: pickRowField(row, ['شماره سند', 'paymentNo']) || `PAY-IMP-${payments.length + i + 1}`,
          date: pickRowField(row, ['تاریخ', 'date']) || getTodayJalali(),
          time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
          beneficiaryType: 'supplier',
          beneficiaryName: beneficiary,
          paymentMethod: method,
          amount: amt,
          bankAccountId: method === 'bank_transfer' ? bankAccounts[0]?.id : undefined,
          bankTransferRef: method === 'bank_transfer' ? refCode : undefined,
          cashDrawerId: method === 'cash' ? cashDrawers[0]?.id : undefined,
          category: pickRowField(row, ['بابت / سرفصل', 'بابت', 'category']) || PAYMENT_CATEGORIES[0],
          description: pickRowField(row, ['توضیحات', 'شرح', 'description']),
          registeredBy: 'ورود از اکسل',
          status: statusVal,
          createdAt: new Date().toLocaleDateString('fa-IR'),
        });
      }
      if (imported.length > 0) {
        onUpdateDb({ ...db, treasuryPayments: [...imported, ...currentList] });
      }
    } catch (err) {
      console.error('Payments import error:', err);
    }
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || methodFilter !== 'all' || categoryFilter !== 'all' || statusFilter !== 'all');
  const handleClearFilters = () => {
    setSearchQuery('');
    setMethodFilter('all');
    setCategoryFilter('all');
    setStatusFilter('all');
  };

  return (
    <div className="space-y-6">
      {/* Unified KPI Strip */}
      <KpiStrip
        items={[
          { label: 'کل اسناد پرداختی', value: stats.totalCount, sublabel: 'سند' },
          { label: 'مجموع پرداخت تاییدشده', value: toPersianDigits(formatWithCommas(stats.totalAmount)), sublabel: 'ریال', tone: 'danger' },
          { label: 'پرداخت با حواله پایا/ساتنا', value: toPersianDigits(formatWithCommas(stats.bankAmount)), sublabel: 'ریال', tone: 'info' },
          { label: 'پرداخت نقدی / تنخواه', value: toPersianDigits(formatWithCommas(stats.cashAmount)), sublabel: 'ریال', tone: 'warning' },
        ]}
      />

      {/* Main Container */}
      {activeSubView === 'form' ? (
        /* Form View */
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingPayment ? 'ویرایش سند پرداخت وجه' : 'ثبت سند پرداخت جدید (حواله / نقد تنخواه / صدور چک)'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">ثبت آنی خروج وجه از بانک یا صندوق و صدور اسناد تسویه</p>
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
              {/* Payment No */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-rose-400" />
                  شماره سند پرداخت <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={paymentNo}
                  onChange={(e) => setPaymentNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-rose-400" />
                  تاریخ پرداخت <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Time */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  ساعت پرداخت
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                />
              </div>

              {/* Beneficiary Type */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">نوع ذینفع / دریافت‌کننده</label>
                <select
                  value={beneficiaryType}
                  onChange={(e) => setBeneficiaryType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                >
                  <option value="supplier">تامین‌کننده مواد اولیه و کالا</option>
                  <option value="personnel">پرسنل و کارکنان</option>
                  <option value="expense">هزینه جاری / تنخواه کارگاه</option>
                  <option value="shareholder">سهامدار / مالک</option>
                  <option value="other">متفرقه</option>
                </select>
              </div>

              {/* Beneficiary Select or Name */}
              {beneficiaryType === 'supplier' ? (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">
                    انتخاب تامین‌کننده <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={beneficiaryId}
                    onChange={(e) => handleSupplierChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                    required
                  >
                    <option value="">-- انتخاب تامین‌کننده --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              ) : beneficiaryType === 'personnel' ? (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">
                    انتخاب پرسنل <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={beneficiaryId}
                    onChange={(e) => handlePersonnelChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                    required
                  >
                    <option value="">-- انتخاب پرسنل --</option>
                    {personnelList.map(p => (
                      <option key={p.id} value={p.id}>{p.fullName} ({p.role})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold">
                    نام دریافت‌کننده وجه <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: تنخواه‌گردان کارگاه، اداره برق، صاحب ملک"
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                    required
                  />
                </div>
              )}

              {/* Payment Method */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">
                  روش پرداخت <span className="text-rose-400">*</span>
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-rose-400 font-bold focus:border-rose-500 outline-none transition-colors"
                >
                  <option value="bank_transfer">حواله بانکی / پایا / ساتنا</option>
                  <option value="cash">نقدی از صندوق یا تنخواه</option>
                  <option value="cheque">صدور چک صیادی (متصل به دسته چک)</option>
                </select>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-rose-400" />
                    مبلغ پرداختی (ریال) <span className="text-rose-400">*</span>
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-rose-400 font-black text-sm text-left focus:border-rose-500 outline-none transition-colors font-mono"
                  required
                />
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">بابت / سرفصل هزینه</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                >
                  {PAYMENT_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-bold">وضعیت تایید پرداخت</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                >
                  <option value="confirmed">تایید شده و کسر از موجودی</option>
                  <option value="pending">در انتظار تایید مدیریت</option>
                  <option value="cancelled">لغو شده</option>
                </select>
              </div>

              {/* Conditional Method Details */}
              {paymentMethod === 'bank_transfer' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold flex items-center gap-1.5">
                      <Landmark className="w-3.5 h-3.5 text-cyan-400" />
                      حساب بانکی مبدا پرداخت
                    </label>
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                      required
                    >
                      {bankAccounts.map(b => (
                        <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo} ({b.accountHolder})</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-bold">کد پیگیری / ارجاع حواله</label>
                    <input
                      type="text"
                      placeholder="مثال: PY-8839210"
                      value={bankTransferRef}
                      onChange={(e) => setBankTransferRef(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors font-mono"
                    />
                  </div>
                </>
              )}

              {paymentMethod === 'cash' && (
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-bold flex items-center gap-1.5">
                    <Vault className="w-3.5 h-3.5 text-amber-400" />
                    صندوق یا تنخواه مبدا پرداخت
                  </label>
                  <select
                    value={cashDrawerId}
                    onChange={(e) => setCashDrawerId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-rose-500 outline-none transition-colors"
                    required
                  >
                    {cashDrawers.map(d => (
                      <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                </div>
              )}

              {paymentMethod === 'cheque' && (
                <div className="md:col-span-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-rose-500/30 space-y-4 shadow-xl">
                  {/* Cheque Header Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-xs flex items-center gap-2">
                          <span>اتصال یکپارچه به دسته چک و صدور برگه چک صیادی</span>
                          <span className="text-[10px] bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-mono font-normal">
                            سامانه صیاد پیچک
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">با انتخاب برگه چک، وضعیت آن در بخش مدیریت چک‌ها به حالت «صادر شده» تغییر خواهد کرد.</p>
                      </div>
                    </div>

                    {chequeBooks.length === 0 ? (
                      <button
                        type="button"
                        onClick={handleAutoCreateChequeBook}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>ایجاد سریع دسته چک پیش‌فرض</span>
                      </button>
                    ) : (
                      <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-xl flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{toPersianDigits(availableBlankLeaves.length)} برگه سفید آماده صدور</span>
                      </div>
                    )}
                  </div>

                  {/* Cheque Form Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Select Cheque Book */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-rose-400" />
                        انتخاب دسته چک بانکی <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={chequeBookId}
                        onChange={(e) => handleSelectChequeBook(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:border-rose-500 outline-none transition-colors"
                      >
                        {chequeBooks.length === 0 ? (
                          <option value="">دسته چکی تعریف نشده است</option>
                        ) : (
                          chequeBooks.map(book => {
                            const bank = bankMap.get(book.bankAccountId);
                            const blankCount = chequeLeaves.filter(l => l.chequeBookId === book.id && l.status === 'blank').length;
                            return (
                              <option key={book.id} value={book.id}>
                                {bank?.bankName || 'بانک'} - سری {book.series} ({toPersianDigits(blankCount)} برگه سفید)
                              </option>
                            );
                          })
                        )}
                      </select>
                    </div>

                    {/* Select Leaf */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-cyan-400" />
                        انتخاب برگه چک سفید <span className="text-rose-400">*</span>
                      </label>
                      <select
                        value={chequeLeafId}
                        onChange={(e) => handleSelectChequeLeaf(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-rose-300 font-bold focus:border-rose-500 outline-none transition-colors"
                      >
                        {availableBlankLeaves.length === 0 ? (
                          <option value="">هیچ برگه سفیدی در این دسته چک وجود ندارد</option>
                        ) : (
                          availableBlankLeaves.map(leaf => (
                            <option key={leaf.id} value={leaf.id}>
                              برگه شماره {toPersianDigits(leaf.leafNumber)} (صیاد: {toPersianDigits(leaf.sayadNo)})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    {/* 16-Digit Sayad No */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          شناسه صیادی ۱۶ رقمی <span className="text-rose-400">*</span>
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
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-rose-300 font-mono text-center font-bold tracking-wider text-sm focus:border-rose-500 outline-none"
                        maxLength={16}
                        required
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
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white font-mono text-center font-bold focus:border-rose-500 outline-none"
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

                    {/* Payee Name */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-purple-400" />
                        در وجه شخص / شرکت
                      </label>
                      <input
                        type="text"
                        placeholder="نام ذینفع چک"
                        value={payeeName || beneficiaryName}
                        onChange={(e) => setPayeeName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:border-rose-500 outline-none"
                      />
                    </div>

                    {/* Bank & Account Info Display */}
                    <div className="space-y-1.5">
                      <label className="text-slate-300 font-bold flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-cyan-400" />
                        بانک عهده و شعبه صادرکننده
                      </label>
                      <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-slate-300 text-xs flex items-center justify-between">
                        <span>{bankName}</span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {chequeNo ? `برگه ${toPersianDigits(chequeNo)}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="md:col-span-3 space-y-1.5">
                <label className="text-slate-300 font-bold">شرح کامل پرداخت</label>
                <textarea
                  rows={2}
                  placeholder="توضیحات فاکتور خرید، شماره پیش‌فاکتور، علت پرداخت و یادداشت‌های حسابداری..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
                {editingPayment ? 'ذخیره تغییرات' : 'ثبت نهایی سند پرداخت'}
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
            title="فیلتر زمانی اسناد پرداخت وجه:"
            colorScheme="rose"
          />

          {/* Unified Toolbar & Filter Bar */}
          <UnifiedToolbar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="جستجو با شماره سند، نام ذینفع، کد پیگیری، شرح..."
            hasActiveFilters={hasActiveFilters}
            onClearFilters={handleClearFilters}
            onDownloadTemplate={handleDownloadTemplate}
            onImportExcel={handleImportExcel}
            onExportExcel={handleExportExcel}
            onPrint={() => printElement('payments-table-print', 'فهرست اسناد پرداختی')}
            onAdd={handleOpenNew}
            addLabel="ثبت سند پرداخت جدید"
          />

          <UnifiedFilterBar columnsClass="grid-cols-1 sm:grid-cols-3">
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>روش پرداخت وجه</label>
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه روش‌های پرداخت</option>
                <option value="bank_transfer">حواله بانکی</option>
                <option value="cash">نقدی از صندوق</option>
                <option value="cheque">صدور چک</option>
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>بابت / سرفصل هزینه</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه سرفصل‌ها</option>
                {PAYMENT_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={UNIFIED_FILTER_LABEL_CLASS}>وضعیت سند</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={UNIFIED_FILTER_SELECT_CLASS}
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="confirmed">تایید شده</option>
                <option value="pending">در انتظار</option>
                <option value="cancelled">لغو شده</option>
              </select>
            </div>
          </UnifiedFilterBar>

          {/* Payments Table */}
          <div id="payments-table-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold select-none">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره سند / تاریخ</th>
                  <th className="p-3.5">ذینفع / دریافت‌کننده</th>
                  <th className="p-3.5">روش و مبدا پرداخت</th>
                  <th className="p-3.5">بابت / سرفصل</th>
                  <th className="p-3.5 text-left">مبلغ پرداختی (ریال)</th>
                  <th className="p-3.5 text-center">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ سند پرداختی منطبق بر جستجو یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p, index) => {
                    return (
                      <tr key={p.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-rose-400">{p.paymentNo}</div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {toPersianDigits(p.date)} {p.time ? `- ${toPersianDigits(p.time)}` : ''}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            {p.beneficiaryName}
                          </div>
                          <span className="text-[10px] text-slate-500 block">
                            {p.beneficiaryType === 'supplier' ? 'تامین‌کننده' : p.beneficiaryType === 'personnel' ? 'پرسنل' : 'هزینه جاری'}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5 font-bold text-slate-200">
                            {p.paymentMethod === 'bank_transfer' && <Landmark className="w-3.5 h-3.5 text-cyan-400" />}
                            {p.paymentMethod === 'cash' && <Vault className="w-3.5 h-3.5 text-amber-400" />}
                            {p.paymentMethod === 'cheque' && <FileText className="w-3.5 h-3.5 text-rose-400" />}
                            {p.paymentMethod === 'bank_transfer' ? 'حواله بانکی' : p.paymentMethod === 'cash' ? 'نقدی از صندوق' : 'صدور چک صیادی'}
                          </div>
                          {p.paymentMethod === 'bank_transfer' && (
                            <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                              {p.bankTransferRef ? `رهگیری: ${p.bankTransferRef}` : (bankMap.get(p.bankAccountId || '')?.bankName || 'حساب بانکی')}
                            </span>
                          )}
                          {p.paymentMethod === 'cash' && (
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              صندوق نقدی
                            </span>
                          )}
                          {p.paymentMethod === 'cheque' && p.chequeDetails && (
                            <div className="mt-0.5 space-y-0.5 font-mono text-[10px]">
                              <div className="text-rose-300 flex items-center gap-1">
                                <span>صیاد: {toPersianDigits(p.chequeDetails.sayadNo)}</span>
                              </div>
                              <div className="text-slate-400">
                                سررسید: {toPersianDigits(p.chequeDetails.dueDate)}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-3.5 max-w-[200px]">
                          <div className="font-medium text-slate-200 truncate">{p.category}</div>
                          <span className="text-[10px] text-slate-500 block truncate">{p.description || '-'}</span>
                        </td>
                        <td className="p-3.5 text-left font-mono">
                          <div className="font-black text-sm text-rose-400">
                            {toPersianDigits(formatWithCommas(p.amount))}
                          </div>
                          <span className="text-[10px] text-slate-500 font-normal">ریال</span>
                        </td>
                        <td className="p-3.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            p.status === 'confirmed'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : p.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {p.status === 'confirmed' ? 'تایید شده' : p.status === 'pending' ? 'در انتظار' : 'لغو شده'}
                          </span>
                        </td>
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEdit(p)}
                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                              title="ویرایش سند"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(p)}
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
