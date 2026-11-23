/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, ChequeBook, ChequeLeaf, BankAccount, TreasuryPayment } from '../../types';
import { 
  BookOpen, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, 
  AlertTriangle, Clock, Calendar, Landmark, CreditCard, FileSpreadsheet, 
  Printer, Save, X, Eye, RefreshCw, CheckCircle2, ShieldAlert, ArrowUpRight,
  Filter, ChevronLeft, ChevronRight, BarChart2, Bell, AlertOctagon, HelpCircle,
  FileText, ArrowDownLeft, RotateCcw, Send, Building2, User, Check, Sparkles
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString,
  getTodayJalali, getJalaliDaysDifference, getRelativeJalaliDate, isJalaliDateInRange, normalizeJalaliDate,
  numberToWordsPersian, isValidJalaliDate
} from '../../utils/persianUtils';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../../utils/simpleId';

interface ChequeBooksTabProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  askConfirm: (title: string, message: string, action: () => void) => void;
}

export type ChequeSubView = 'alerts' | 'operations' | 'books' | 'leaves' | 'reports';

export default function ChequeBooksTab({ db, onUpdateDb, activePeriodId, askConfirm }: ChequeBooksTabProps) {
  const [activeView, setActiveView] = useState<ChequeSubView>('alerts');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string>('all');
  const [selectedBankId, setSelectedBankId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [alertPeriodFilter, setAlertPeriodFilter] = useState<'all' | 'today' | '3days' | '7days' | '30days' | 'overdue'>('7days');
  
  // Book Form State
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<ChequeBook | null>(null);
  const [bookBankAccountId, setBookBankAccountId] = useState('');
  const [bookSeries, setBookSeries] = useState('الف/1405');
  const [bookSayadPrefix, setBookSayadPrefix] = useState('2105');
  const [bookStartNumber, setBookStartNumber] = useState<number>(1001);
  const [bookTotalLeaves, setBookTotalLeaves] = useState<number>(25);
  const [bookReceivedDate, setBookReceivedDate] = useState(getTodayJalali());
  const [bookDescription, setBookDescription] = useState('');
  const [bookStatus, setBookStatus] = useState<'active' | 'finished' | 'cancelled'>('active');

  // Leaf Action Modal State (for Clear, Bounce, Cancel, Return, In_Bank, Edit)
  const [actionLeaf, setActionLeaf] = useState<ChequeLeaf | null>(null);
  const [leafActionType, setLeafActionType] = useState<'clear' | 'bounce' | 'cancel' | 'in_bank' | 'return' | 'edit' | 'view' | 'print' | null>(null);
  const [actionDate, setActionDate] = useState(getTodayJalali());
  const [actionReason, setActionReason] = useState('');
  const [actionTrackingNo, setActionTrackingNo] = useState('');
  const [actionBouncedDocNo, setActionBouncedDocNo] = useState('');

  // Leaf Edit fields
  const [editPayeeName, setEditPayeeName] = useState('');
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editDueDate, setEditDueDate] = useState(getTodayJalali());
  const [editNotes, setEditNotes] = useState('');

  // Direct Cheque Issue Modal State (صدور چک)
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueBookId, setIssueBookId] = useState('');
  const [issueLeafId, setIssueLeafId] = useState('');
  const [issueSayadNo, setIssueSayadNo] = useState('');
  const [issuePayeeName, setIssuePayeeName] = useState('');
  const [issueBeneficiaryType, setIssueBeneficiaryType] = useState<'supplier' | 'personnel' | 'expense' | 'shareholder' | 'other'>('supplier');
  const [issueBeneficiaryId, setIssueBeneficiaryId] = useState('');
  const [issueAmount, setIssueAmount] = useState<number>(0);
  const [issueDate, setIssueDate] = useState(getTodayJalali());
  const [issueDueDate, setIssueDueDate] = useState(getRelativeJalaliDate(30));
  const [issueCategory, setIssueCategory] = useState('تسویه فاکتور خرید');
  const [issueDescription, setIssueDescription] = useState('');

  const bankAccounts = useMemo(() => (db.bankAccounts || []).filter(b => b.periodId === activePeriodId), [db.bankAccounts, activePeriodId]);
  const chequeBooks = useMemo(() => (db.chequeBooks || []).filter(b => b.periodId === activePeriodId), [db.chequeBooks, activePeriodId]);
  const chequeLeaves = useMemo(() => (db.chequeLeaves || []).filter(l => l.periodId === activePeriodId), [db.chequeLeaves, activePeriodId]);
  const suppliers = useMemo(() => (db.suppliers || []).filter(s => s.periodId === activePeriodId), [db.suppliers, activePeriodId]);
  const personnelList = useMemo(() => (db.personnel || []).filter(p => p.periodId === activePeriodId), [db.personnel, activePeriodId]);
  const payments = useMemo(() => (db.treasuryPayments || []).filter(p => p.periodId === activePeriodId), [db.treasuryPayments, activePeriodId]);

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

  // Cheque stats calculations
  const stats = useMemo(() => {
    const totalBooks = chequeBooks.length;
    const activeBooks = chequeBooks.filter(b => b.status === 'active').length;
    const totalLeavesCount = chequeLeaves.length;
    const blankLeaves = chequeLeaves.filter(l => l.status === 'blank').length;
    const issuedLeaves = chequeLeaves.filter(l => l.status === 'issued');
    const issuedCount = issuedLeaves.length;
    const issuedTotalAmount = issuedLeaves.reduce((sum, l) => sum + (l.amount || 0), 0);
    const clearedLeaves = chequeLeaves.filter(l => l.status === 'cleared');
    const clearedTotalAmount = clearedLeaves.reduce((sum, l) => sum + (l.amount || 0), 0);
    const bouncedLeaves = chequeLeaves.filter(l => l.status === 'bounced');
    const cancelledLeaves = chequeLeaves.filter(l => l.status === 'cancelled');

    // Upcoming due cheques (issued cheques and their diff from today)
    const upcomingCheques = issuedLeaves.map(leaf => {
      const daysDiff = leaf.dueDate ? getJalaliDaysDifference(leaf.dueDate) : 999;
      return { leaf, daysDiff };
    });

    const dueToday = upcomingCheques.filter(item => item.daysDiff === 0);
    const dueIn3Days = upcomingCheques.filter(item => item.daysDiff >= 0 && item.daysDiff <= 3);
    const dueIn7Days = upcomingCheques.filter(item => item.daysDiff >= 0 && item.daysDiff <= 7);
    const overdue = upcomingCheques.filter(item => item.daysDiff < 0);

    const dueIn7DaysAmount = dueIn7Days.reduce((sum, item) => sum + (item.leaf.amount || 0), 0);
    const overdueAmount = overdue.reduce((sum, item) => sum + (item.leaf.amount || 0), 0);

    return {
      totalBooks,
      activeBooks,
      totalLeavesCount,
      blankLeaves,
      issuedCount,
      issuedTotalAmount,
      clearedCount: clearedLeaves.length,
      clearedTotalAmount,
      bouncedCount: bouncedLeaves.length,
      cancelledCount: cancelledLeaves.length,
      dueTodayCount: dueToday.length,
      dueIn3DaysCount: dueIn3Days.length,
      dueIn7DaysCount: dueIn7Days.length,
      dueIn7DaysAmount,
      overdueCount: overdue.length,
      overdueAmount,
      upcomingCheques
    };
  }, [chequeBooks, chequeLeaves]);

  // Filtered leaves for the Leaves & Operations view
  const filteredLeaves = useMemo(() => {
    return chequeLeaves.filter(leaf => {
      if (selectedBookId !== 'all' && leaf.chequeBookId !== selectedBookId) return false;
      if (selectedBankId !== 'all' && leaf.bankAccountId !== selectedBankId) return false;
      if (statusFilter !== 'all' && leaf.status !== statusFilter) return false;
      if (searchQuery) {
        const matches = 
          leaf.leafNumber.toString().includes(searchQuery) ||
          leaf.sayadNo.includes(searchQuery) ||
          (leaf.payeeName && matchPersianString(leaf.payeeName, searchQuery)) ||
          (leaf.dueDate && leaf.dueDate.includes(searchQuery)) ||
          (leaf.amount && leaf.amount.toString().includes(searchQuery));
        if (!matches) return false;
      }
      return true;
    });
  }, [chequeLeaves, selectedBookId, selectedBankId, statusFilter, searchQuery]);

  // Filtered upcoming alerts
  const filteredAlerts = useMemo(() => {
    const list = stats.upcomingCheques;
    return list.filter(item => {
      if (selectedBankId !== 'all' && item.leaf.bankAccountId !== selectedBankId) return false;
      if (searchQuery) {
        const matches = 
          item.leaf.leafNumber.toString().includes(searchQuery) ||
          item.leaf.sayadNo.includes(searchQuery) ||
          (item.leaf.payeeName && matchPersianString(item.leaf.payeeName, searchQuery)) ||
          (item.leaf.dueDate && item.leaf.dueDate.includes(searchQuery));
        if (!matches) return false;
      }
      if (alertPeriodFilter === 'today') return item.daysDiff === 0;
      if (alertPeriodFilter === '3days') return item.daysDiff >= 0 && item.daysDiff <= 3;
      if (alertPeriodFilter === '7days') return item.daysDiff >= 0 && item.daysDiff <= 7;
      if (alertPeriodFilter === '30days') return item.daysDiff >= 0 && item.daysDiff <= 30;
      if (alertPeriodFilter === 'overdue') return item.daysDiff < 0;
      return true;
    }).sort((a, b) => a.daysDiff - b.daysDiff);
  }, [stats.upcomingCheques, selectedBankId, searchQuery, alertPeriodFilter]);

  // Available blank leaves for direct issuing
  const availableBlankLeaves = useMemo(() => {
    return chequeLeaves.filter(l => (l.status === 'blank' || l.id === issueLeafId) && (!issueBookId || l.chequeBookId === issueBookId));
  }, [chequeLeaves, issueBookId, issueLeafId]);

  // Open modal to add new ChequeBook
  const handleOpenAddBook = () => {
    setEditingBook(null);
    setBookBankAccountId(bankAccounts[0]?.id || '');
    setBookSeries('الف/1405');
    setBookSayadPrefix('2105');
    setBookStartNumber(1001);
    setBookTotalLeaves(25);
    setBookReceivedDate(getTodayJalali());
    setBookDescription('');
    setBookStatus('active');
    setIsBookModalOpen(true);
  };

  // Open modal to edit existing ChequeBook
  const handleOpenEditBook = (book: ChequeBook) => {
    setEditingBook(book);
    setBookBankAccountId(book.bankAccountId);
    setBookSeries(book.series);
    setBookSayadPrefix(book.sayadPrefix || '');
    setBookStartNumber(book.startNumber);
    setBookTotalLeaves(book.totalLeaves);
    setBookReceivedDate(book.receivedDate);
    setBookDescription(book.description || '');
    setBookStatus(book.status);
    setIsBookModalOpen(true);
  };

  // Save ChequeBook and generate leaves if creating new
  const handleSaveBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookBankAccountId) {
      alert('لطفاً حساب بانکی متصل به دسته چک را انتخاب فرمایید.');
      return;
    }

    const endNumber = Number(bookStartNumber) + Number(bookTotalLeaves) - 1;

    if (editingBook) {
      // Update existing book while preserving all other periods
      const updatedBooks = (db.chequeBooks || []).map(b => {
        if (b.id === editingBook.id) {
          return {
            ...b,
            bankAccountId: bookBankAccountId,
            series: bookSeries,
            sayadPrefix: bookSayadPrefix,
            startNumber: Number(bookStartNumber),
            endNumber: endNumber,
            totalLeaves: Number(bookTotalLeaves),
            receivedDate: bookReceivedDate,
            description: bookDescription,
            status: bookStatus
          };
        }
        return b;
      });

      onUpdateDb({
        ...db,
        chequeBooks: updatedBooks
      });
      setIsBookModalOpen(false);
    } else {
      // Create new book and generate leaves with simple sequential IDs
      const newBookId = nextSimpleId(db.chequeBooks || [], getPrefixForCollection('chequeBooks'));
      const nextLeafId = createSimpleIdGenerator(db.chequeLeaves || [], getPrefixForCollection('chequeLeaves'));
      const newBook: ChequeBook = {
        id: newBookId,
        periodId: activePeriodId,
        bankAccountId: bookBankAccountId,
        series: bookSeries,
        sayadPrefix: bookSayadPrefix,
        startNumber: Number(bookStartNumber),
        endNumber: endNumber,
        totalLeaves: Number(bookTotalLeaves),
        receivedDate: bookReceivedDate,
        description: bookDescription,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      // Generate leaves
      const newLeaves: ChequeLeaf[] = [];
      for (let i = 0; i < Number(bookTotalLeaves); i++) {
        const leafNo = Number(bookStartNumber) + i;
        const sayadSerial = (leafNo).toString().padStart(6, '0');
        const sayadNo = `${bookSayadPrefix || '2105'}${sayadSerial}${(1000 + i).toString().padStart(6, '0')}`;
        newLeaves.push({
          id: nextLeafId(),
          periodId: activePeriodId,
          chequeBookId: newBookId,
          bankAccountId: bookBankAccountId,
          leafNumber: leafNo,
          sayadNo: sayadNo,
          status: 'blank',
          createdAt: new Date().toISOString()
        });
      }

      onUpdateDb({
        ...db,
        chequeBooks: [...(db.chequeBooks || []), newBook],
        chequeLeaves: [...(db.chequeLeaves || []), ...newLeaves]
      });
      setIsBookModalOpen(false);
    }
  };

  // Delete cheque book
  const handleDeleteBook = (book: ChequeBook) => {
    const bookLeaves = chequeLeaves.filter(l => l.chequeBookId === book.id);
    const hasIssued = bookLeaves.some(l => l.status !== 'blank');
    if (hasIssued) {
      alert('این دسته چک دارای برگه‌های صادر شده، پاس شده یا باطل شده است و امکان حذف کامل آن وجود ندارد. در صورت نیاز وضعیت آن را به «تمام شده» یا «مسدود» تغییر دهید.');
      return;
    }

    askConfirm(
      'حذف دسته چک',
      `آیا از حذف دسته چک با سری ${book.series} و کلیه برگه‌های سفید آن اطمینان دارید؟`,
      () => {
        const updatedBooks = (db.chequeBooks || []).filter(b => b.id !== book.id);
        const updatedLeaves = (db.chequeLeaves || []).filter(l => l.chequeBookId !== book.id);
        onUpdateDb({
          ...db,
          chequeBooks: updatedBooks,
          chequeLeaves: updatedLeaves
        });
      }
    );
  };

  // Open Direct Issue Cheque Modal
  const handleOpenIssueCheque = (presetLeaf?: ChequeLeaf) => {
    let currentBooks = chequeBooks.filter(b => b.status === 'active');
    
    // If no cheque books exist at all, auto-create a default active book and leaves so the user is never blocked
    if (currentBooks.length === 0) {
      const defaultBankId = bankAccounts[0]?.id || '';
      const newBookId = nextSimpleId(db.chequeBooks || [], getPrefixForCollection('chequeBooks'));
      const nextLeafId = createSimpleIdGenerator(db.chequeLeaves || [], getPrefixForCollection('chequeLeaves'));
      const newBook: ChequeBook = {
        id: newBookId,
        periodId: activePeriodId,
        bankAccountId: defaultBankId,
        series: 'الف/1405',
        sayadPrefix: '2105',
        startNumber: 1001,
        endNumber: 1025,
        totalLeaves: 25,
        receivedDate: getTodayJalali(),
        description: 'دسته چک ۲۵ برگی پیش‌فرض',
        status: 'active',
        createdAt: getTodayJalali()
      };

      const newLeaves: ChequeLeaf[] = Array.from({ length: 25 }, (_, i) => {
        const leafNum = 1001 + i;
        const sayad = `210514050100${leafNum}`;
        return {
          id: nextLeafId(),
          periodId: activePeriodId,
          chequeBookId: newBookId,
          bankAccountId: defaultBankId,
          leafNumber: leafNum,
          sayadNo: sayad,
          status: 'blank' as const,
          createdAt: getTodayJalali()
        };
      });

      const updatedBooks = [...(db.chequeBooks || []), newBook];
      const updatedLeaves = [...(db.chequeLeaves || []), ...newLeaves];
      onUpdateDb({
        ...db,
        chequeBooks: updatedBooks,
        chequeLeaves: updatedLeaves
      });

      setIssueBookId(newBookId);
      setIssueLeafId(newLeaves[0].id);
      setIssueSayadNo(newLeaves[0].sayadNo);
      setIssuePayeeName(suppliers[0]?.name || '');
      setIssueBeneficiaryType('supplier');
      setIssueBeneficiaryId(suppliers[0]?.id || '');
      setIssueAmount(0);
      setIssueDate(getTodayJalali());
      setIssueDueDate(getRelativeJalaliDate(30));
      setIssueCategory('تسویه فاکتور خرید');
      setIssueDescription('');
      setIsIssueModalOpen(true);
      return;
    }

    // If presetLeaf provided, use it directly
    if (presetLeaf) {
      setIssueBookId(presetLeaf.chequeBookId);
      setIssueLeafId(presetLeaf.id);
      setIssueSayadNo(presetLeaf.sayadNo);
    } else {
      // Find an active book that has blank leaves
      const bookWithBlank = currentBooks.find(b => 
        chequeLeaves.some(l => l.chequeBookId === b.id && l.status === 'blank')
      ) || currentBooks[0];

      const blankLeavesInBook = chequeLeaves.filter(l => l.chequeBookId === bookWithBlank.id && l.status === 'blank');
      
      if (blankLeavesInBook.length === 0) {
        // Find any blank leaf in all books
        const anyBlankLeaf = chequeLeaves.find(l => l.status === 'blank');
        if (anyBlankLeaf) {
          setIssueBookId(anyBlankLeaf.chequeBookId);
          setIssueLeafId(anyBlankLeaf.id);
          setIssueSayadNo(anyBlankLeaf.sayadNo);
        } else {
          // No blank leaves at all, open Add Book modal
          alert('کلیه برگه‌های دسته‌چک‌های موجود صادر یا باطل شده‌اند. لطفاً یک دسته‌چک جدید ثبت نمایید.');
          handleOpenAddBook();
          return;
        }
      } else {
        const targetLeaf = blankLeavesInBook[0];
        setIssueBookId(bookWithBlank.id);
        setIssueLeafId(targetLeaf.id);
        setIssueSayadNo(targetLeaf.sayadNo);
      }
    }

    setIssuePayeeName(suppliers[0]?.name || '');
    setIssueBeneficiaryType('supplier');
    setIssueBeneficiaryId(suppliers[0]?.id || '');
    setIssueAmount(0);
    setIssueDate(getTodayJalali());
    setIssueDueDate(getRelativeJalaliDate(30));
    setIssueCategory('تسویه فاکتور خرید');
    setIssueDescription('');
    setIsIssueModalOpen(true);
  };

  // Save Direct Issued Cheque and link with Treasury Payments
  const handleSaveIssueCheque = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issuePayeeName.trim() || issueAmount <= 0) {
      alert('لطفاً نام ذینفع و مبلغ معتبر برگه چک را وارد نمایید.');
      return;
    }
    if (!isValidJalaliDate(issueDueDate)) {
      alert('تاریخ سررسید وارد شده معتبر نمی‌باشد.');
      return;
    }

    const leaf = chequeLeaves.find(l => l.id === issueLeafId);
    if (!leaf) {
      alert('برگه چک انتخابی معتبر نمی‌باشد.');
      return;
    }

    const book = bookMap.get(leaf.chequeBookId);
    const bank = bankMap.get(leaf.bankAccountId);

    const paymentNo = `PAY-CHK-${leaf.leafNumber}`;
    const newPaymentId = nextSimpleId(db.treasuryPayments || [], getPrefixForCollection('treasuryPayments'));

    // Create Payment Record
    const newPayment: TreasuryPayment = {
      id: newPaymentId,
      periodId: activePeriodId,
      paymentNo,
      date: issueDate,
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      beneficiaryType: issueBeneficiaryType,
      beneficiaryId: issueBeneficiaryId || undefined,
      beneficiaryName: issuePayeeName.trim(),
      paymentMethod: 'cheque',
      amount: issueAmount,
      bankAccountId: leaf.bankAccountId,
      category: issueCategory,
      description: issueDescription.trim() || `صدور چک صیادی شماره ${leaf.leafNumber} در وجه ${issuePayeeName}`,
      chequeDetails: {
        chequeNo: leaf.leafNumber.toString(),
        sayadNo: issueSayadNo || leaf.sayadNo,
        dueDate: issueDueDate,
        bankName: bank?.bankName || 'بانک',
        payeeName: issuePayeeName.trim(),
        chequeBookId: leaf.chequeBookId,
        leafNumber: leaf.leafNumber,
        chequeLeafId: leaf.id,
        status: 'issued'
      },
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    // Update Leaf Record while preserving all other periods
    const updatedLeaves = (db.chequeLeaves || []).map(l => {
      if (l.id === leaf.id) {
        return {
          ...l,
          sayadNo: issueSayadNo || l.sayadNo,
          status: 'issued' as const,
          paymentId: newPaymentId,
          paymentNo: paymentNo,
          payeeName: issuePayeeName.trim(),
          beneficiaryType: issueBeneficiaryType,
          beneficiaryId: issueBeneficiaryId || undefined,
          amount: issueAmount,
          issueDate: issueDate,
          dueDate: issueDueDate,
          notes: issueDescription.trim()
        };
      }
      return l;
    });

    onUpdateDb({
      ...db,
      chequeLeaves: updatedLeaves,
      treasuryPayments: [...(db.treasuryPayments || []), newPayment]
    });

    setIsIssueModalOpen(false);
  };

  // Open Leaf Action Modal
  const handleOpenLeafAction = (leaf: ChequeLeaf, action: 'clear' | 'bounce' | 'cancel' | 'in_bank' | 'return' | 'edit' | 'view' | 'print') => {
    setActionLeaf(leaf);
    setLeafActionType(action);
    setActionDate(getTodayJalali());
    setActionReason('');
    setActionTrackingNo('');
    setActionBouncedDocNo('');

    // Prepopulate edit fields
    setEditPayeeName(leaf.payeeName || '');
    setEditAmount(leaf.amount || 0);
    setEditDueDate(leaf.dueDate || getTodayJalali());
    setEditNotes(leaf.notes || '');
  };

  // Action on Cheque Leaf: Clear, Bounce, Cancel, Return, In_Bank, Edit
  const handleApplyLeafAction = () => {
    if (!actionLeaf || !leafActionType) return;

    if (leafActionType === 'edit') {
      if (!editPayeeName.trim() || editAmount <= 0) {
        alert('لطفاً نام ذینفع و مبلغ معتبر را وارد نمایید.');
        return;
      }
      const updatedLeaves = (db.chequeLeaves || []).map(leaf => {
        if (leaf.id === actionLeaf.id) {
          return {
            ...leaf,
            payeeName: editPayeeName.trim(),
            amount: editAmount,
            dueDate: editDueDate,
            notes: editNotes.trim()
          };
        }
        return leaf;
      });

      onUpdateDb({
        ...db,
        chequeLeaves: updatedLeaves
      });

      setActionLeaf(null);
      setLeafActionType(null);
      return;
    }

    const updatedLeaves = (db.chequeLeaves || []).map(leaf => {
      if (leaf.id === actionLeaf.id) {
        if (leafActionType === 'clear') {
          return {
            ...leaf,
            status: 'cleared' as const,
            clearedDate: actionDate,
            notes: actionTrackingNo 
              ? `${leaf.notes ? leaf.notes + ' | ' : ''}وصول شد (کد پیگیری: ${actionTrackingNo}) ${actionReason ? '- ' + actionReason : ''}`
              : leaf.notes
          };
        } else if (leafActionType === 'bounce') {
          return {
            ...leaf,
            status: 'bounced' as const,
            bouncedDate: actionDate,
            bouncedReason: actionReason || 'عدم موجودی کافی در حساب / مسدودی',
            notes: actionBouncedDocNo 
              ? `${leaf.notes ? leaf.notes + ' | ' : ''}گواهی عدم پرداخت: ${actionBouncedDocNo}`
              : leaf.notes
          };
        } else if (leafActionType === 'cancel') {
          return {
            ...leaf,
            status: 'cancelled' as const,
            cancellationReason: actionReason || 'ابطال به درخواست کاربر / اشتباه در تحریر'
          };
        } else if (leafActionType === 'return') {
          return {
            ...leaf,
            status: 'cancelled' as const,
            cancellationReason: `استرداد و عودت لاشه چک (${actionDate}): ${actionReason || 'تسویه نقدی جایگزین'}`
          };
        }
      }
      return leaf;
    });

    onUpdateDb({
      ...db,
      chequeLeaves: updatedLeaves
    });

    setActionLeaf(null);
    setLeafActionType(null);
  };

  // Reset Leaf to Blank or Issued (لغو عملیات اشتباهی)
  const handleResetLeafStatus = (leaf: ChequeLeaf, targetStatus: 'blank' | 'issued') => {
    askConfirm(
      'بازنشانی وضعیت برگه چک',
      `آیا از تغییر وضعیت برگه چک شماره ${leaf.leafNumber} به «${targetStatus === 'blank' ? 'سفید و آزاد' : 'صادر شده'}» اطمینان دارید؟`,
      () => {
        const updatedLeaves = (db.chequeLeaves || []).map(l => {
          if (l.id === leaf.id) {
            if (targetStatus === 'blank') {
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
            } else {
              return {
                ...l,
                status: 'issued' as const,
                clearedDate: undefined,
                bouncedDate: undefined,
                bouncedReason: undefined,
                cancellationReason: undefined
              };
            }
          }
          return l;
        });

        onUpdateDb({
          ...db,
          chequeLeaves: updatedLeaves
        });
      }
    );
  };

  // Export Cheque Book Leaves to CSV
  const handleExportLeavesCSV = () => {
    const headers = [
      'شماره برگه چک',
      'شناسه صیاد ۱۶ رقمی',
      'بانک و شعبه',
      'سری دسته چک',
      'وضعیت',
      'در وجه / ذینفع',
      'مبلغ (ریال)',
      'تاریخ صدور',
      'تاریخ سررسید',
      'تاریخ وصول/برگشت',
      'علت برگشت/ابطال',
      'توضیحات'
    ];

    const rows = filteredLeaves.map(leaf => {
      const book = bookMap.get(leaf.chequeBookId);
      const bank = bankMap.get(leaf.bankAccountId);
      const statusLabel = 
        leaf.status === 'blank' ? 'سفید و آزاد' :
        leaf.status === 'issued' ? 'صادر شده' :
        leaf.status === 'cleared' ? 'پاس شده (وصول)' :
        leaf.status === 'bounced' ? 'برگشت خورده' : 'باطل شده';

      return [
        leaf.leafNumber,
        leaf.sayadNo,
        bank ? `${bank.bankName} - ${bank.branchName}` : '',
        book?.series || '',
        statusLabel,
        leaf.payeeName || '',
        leaf.amount || 0,
        leaf.issueDate || '',
        leaf.dueDate || '',
        leaf.clearedDate || leaf.bouncedDate || '',
        leaf.bouncedReason || leaf.cancellationReason || '',
        leaf.notes || ''
      ];
    });

    downloadCSV(`گزارش_برگه‌های_چک_${getTodayJalali().replace(/\//g, '-')}`, headers, rows);
  };

  // Export Upcoming Cheques Alert to CSV
  const handleExportAlertsCSV = () => {
    const headers = [
      'ردیف',
      'شماره برگه',
      'شناسه صیاد',
      'بانک پرداخت‌کننده',
      'در وجه / ذینفع',
      'مبلغ به ریال',
      'تاریخ سررسید',
      'روزهای باقیمانده تا موعد',
      'وضعیت سررسید'
    ];

    const rows = filteredAlerts.map((item, idx) => {
      const bank = bankMap.get(item.leaf.bankAccountId);
      let statusStr = '';
      if (item.daysDiff === 0) statusStr = 'امروز سررسید می‌شود';
      else if (item.daysDiff > 0) statusStr = `${item.daysDiff} روز تا سررسید`;
      else statusStr = `معوق (${Math.abs(item.daysDiff)} روز گذشته)`;

      return [
        idx + 1,
        item.leaf.leafNumber,
        item.leaf.sayadNo,
        bank ? `${bank.bankName} (${bank.accountNo})` : '',
        item.leaf.payeeName || '',
        item.leaf.amount || 0,
        item.leaf.dueDate || '',
        item.daysDiff,
        statusStr
      ];
    });

    downloadCSV(`اعلام_چک‌های_نزدیک_به_پرداخت_${getTodayJalali().replace(/\//g, '-')}`, headers, rows);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Fast Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-3xl border border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-teal-400" />
            مدیریت دسته‌چک‌ها، برگه‌ها و عملیات چک صیادی
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            سیستم یکپارچه ره‌گیری برگه‌های صیادی، هشدار خودکار سررسیدها، وصول، واخواست و صدور چک
          </p>
        </div>
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => handleOpenIssueCheque()}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-teal-600/30 transition-all cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-teal-200" />
            <span>صدور چک جدید (برگه سفید)</span>
          </button>
          <button
            onClick={handleOpenAddBook}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-slate-700 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-teal-400" />
            <span>ثبت دسته چک جدید</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Cheque Books */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold">دسته‌چک‌های فعال</span>
            <div className="p-2.5 bg-teal-500/10 rounded-2xl text-teal-400 border border-teal-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white font-mono">{toPersianDigits(stats.activeBooks)}</span>
            <span className="text-xs text-slate-400">از {toPersianDigits(stats.totalBooks)} جلد</span>
          </div>
          <div className="mt-2 text-xs text-teal-400/90 flex items-center gap-1 font-medium">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{toPersianDigits(stats.blankLeaves)} برگه چک سفید و آماده صدور</span>
          </div>
        </div>

        {/* Total Issued Active Cheques */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold">چک‌های صادر شده در جریان</span>
            <div className="p-2.5 bg-indigo-500/10 rounded-2xl text-indigo-400 border border-indigo-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white font-mono">{toPersianDigits(stats.issuedCount)}</span>
            <span className="text-xs text-slate-400">فقره چک صادر شده</span>
          </div>
          <div className="mt-2 text-xs text-indigo-300 font-mono flex items-center gap-1 font-bold">
            <span>مبلغ کل:</span>
            <span className="text-white">{formatWithCommas(stats.issuedTotalAmount)}</span>
            <span className="text-[10px] text-slate-400 font-normal">ریال</span>
          </div>
        </div>

        {/* High-Priority Upcoming Due Cheques Alert Card */}
        <div className={`border rounded-3xl p-5 shadow-xl relative overflow-hidden transition-all ${
          stats.dueIn7DaysCount > 0 || stats.overdueCount > 0 
            ? 'bg-gradient-to-br from-amber-950/40 via-slate-900/90 to-rose-950/30 border-amber-500/40 ring-1 ring-amber-500/30' 
            : 'bg-slate-900/90 border-slate-800'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Bell className="w-4 h-4 animate-bounce text-amber-400" />
              سررسید ۷ روز آینده و معوق
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
              {toPersianDigits(stats.dueIn7DaysCount + stats.overdueCount)} فقره
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-300 font-mono">{formatWithCommas(stats.dueIn7DaysAmount + stats.overdueAmount)}</span>
            <span className="text-[10px] text-slate-400">ریال</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-amber-200">
              {stats.dueTodayCount > 0 && <span className="text-rose-400 font-bold">({toPersianDigits(stats.dueTodayCount)} چک امروز) </span>}
              {toPersianDigits(stats.dueIn7DaysCount)} چک این هفته
            </span>
            {stats.overdueCount > 0 && (
              <span className="text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                {toPersianDigits(stats.overdueCount)} معوق
              </span>
            )}
          </div>
        </div>

        {/* Cleared & Bounced */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold">وضعیت پاس شده و برگشتی</span>
            <div className="p-2.5 bg-emerald-500/10 rounded-2xl text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-400 font-mono">{toPersianDigits(stats.clearedCount)}</span>
            <span className="text-xs text-slate-400">پاس شده</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-emerald-400/90 font-mono font-medium">{formatWithCommas(stats.clearedTotalAmount)} ریال</span>
            {stats.bouncedCount > 0 && (
              <span className="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                {toPersianDigits(stats.bouncedCount)} برگشتی
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveView('alerts')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
            activeView === 'alerts'
              ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
              : 'bg-slate-900/70 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>اعلام و هشدار سررسیدها</span>
          {(stats.dueIn7DaysCount > 0 || stats.overdueCount > 0) && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono ${
              activeView === 'alerts' ? 'bg-slate-950 text-amber-400' : 'bg-amber-500/20 text-amber-300'
            }`}>
              {toPersianDigits(stats.dueIn7DaysCount + stats.overdueCount)}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveView('operations')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
            activeView === 'operations'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20'
              : 'bg-slate-900/70 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>مرکز عملیات چک (وصول / برگشت / ابطال)</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-teal-500/20 text-teal-300">
            {toPersianDigits(stats.issuedCount)}
          </span>
        </button>

        <button
          onClick={() => setActiveView('books')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
            activeView === 'books'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20'
              : 'bg-slate-900/70 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>مدیریت دسته‌چک‌ها</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-slate-800 text-slate-300">
            {toPersianDigits(stats.totalBooks)}
          </span>
        </button>

        <button
          onClick={() => setActiveView('leaves')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
            activeView === 'leaves'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20'
              : 'bg-slate-900/70 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>ماتریس کلیه برگه‌ها</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-slate-800 text-slate-300">
            {toPersianDigits(stats.totalLeavesCount)}
          </span>
        </button>

        <button
          onClick={() => setActiveView('reports')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
            activeView === 'reports'
              ? 'bg-teal-600 text-white shadow-lg shadow-teal-600/20'
              : 'bg-slate-900/70 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          <span>گزارشات و جریان نقدینگی</span>
        </button>
      </div>

      {/* VIEW 1: ALERTS & UPCOMING DUE DATES */}
      {activeView === 'alerts' && (
        <div className="space-y-4">
          {/* Filter Bar for Alerts */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجوی سریال چک، صیاد، ذینفع..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-amber-500 outline-none"
                />
              </div>

              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-amber-500 outline-none"
              >
                <option value="all">همه حساب‌های بانکی</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo}</option>
                ))}
              </select>

              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
                {[
                  { id: 'all', label: 'همه' },
                  { id: 'today', label: 'امروز' },
                  { id: '3days', label: '۳ روزه' },
                  { id: '7days', label: '۷ روزه' },
                  { id: '30days', label: '۳۰ روزه' },
                  { id: 'overdue', label: 'معوق' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setAlertPeriodFilter(p.id as any)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all cursor-pointer ${
                      alertPeriodFilter === p.id 
                        ? 'bg-amber-500 text-slate-950 shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleExportAlertsCSV}
                className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="خروجی اکسل"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">اکسل</span>
              </button>
              <button
                onClick={() => printElement('cheque-alerts-print')}
                className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                title="چاپ چک‌های سررسید"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span className="hidden sm:inline">چاپ</span>
              </button>
            </div>
          </div>

          {/* Alerts Table */}
          <div id="cheque-alerts-print" className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره برگه / صیاد</th>
                  <th className="p-3.5">حساب و بانک مبدا</th>
                  <th className="p-3.5">در وجه / ذینفع</th>
                  <th className="p-3.5">تاریخ سررسید</th>
                  <th className="p-3.5">مهلت تا موعد</th>
                  <th className="p-3.5 text-left">مبلغ (ریال)</th>
                  <th className="p-3.5 text-center">اقدام سریع بانکی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ چک صادر شده‌ای با فیلتر سررسید انتخابی یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.map((item, idx) => {
                    const bank = bankMap.get(item.leaf.bankAccountId);
                    const isOverdue = item.daysDiff < 0;
                    const isToday = item.daysDiff === 0;

                    return (
                      <tr key={item.leaf.id} className={`hover:bg-slate-900/50 transition-colors ${
                        isOverdue ? 'bg-rose-950/10' : isToday ? 'bg-amber-950/10' : ''
                      }`}>
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(idx + 1)}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-teal-400 text-sm">
                            برگه {toPersianDigits(item.leaf.leafNumber)}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <span>صیاد:</span>
                            <span className="text-white tracking-wider">{item.leaf.sayadNo}</span>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <Landmark className="w-3.5 h-3.5 text-blue-400" />
                            {bank?.bankName || 'حساب نامشخص'}
                          </div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {bank?.branchName} • {bank?.accountNo}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white">{item.leaf.payeeName}</div>
                          {item.leaf.notes && (
                            <span className="text-[10px] text-slate-400 block truncate max-w-[180px]">
                              {item.leaf.notes}
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-white font-bold">
                          {toPersianDigits(item.leaf.dueDate || '')}
                        </td>
                        <td className="p-3.5">
                          {isToday ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950 animate-pulse inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              امروز سررسید می‌شود
                            </span>
                          ) : isOverdue ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 inline-flex items-center gap-1">
                              <AlertOctagon className="w-3 h-3" />
                              {toPersianDigits(Math.abs(item.daysDiff))} روز معوق
                            </span>
                          ) : (
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                              item.daysDiff <= 3 
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              <Calendar className="w-3 h-3" />
                              {toPersianDigits(item.daysDiff)} روز باقیمانده
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-left">
                          <div className="font-mono font-bold text-sm text-white">
                            {formatWithCommas(item.leaf.amount || 0)}
                          </div>
                          <span className="text-[10px] text-slate-400">ریال</span>
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenLeafAction(item.leaf, 'clear')}
                              className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title="ثبت پاس شدن و وصول چک"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>وصول</span>
                            </button>
                            <button
                              onClick={() => handleOpenLeafAction(item.leaf, 'bounce')}
                              className="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title="ثبت واخواست و برگشت چک"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>برگشت</span>
                            </button>
                            <button
                              onClick={() => handleOpenLeafAction(item.leaf, 'print')}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer"
                              title="چاپ شناسنامه چک"
                            >
                              <Printer className="w-3.5 h-3.5 text-cyan-400" />
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

      {/* VIEW 2: DEDICATED CHEQUE OPERATIONS CENTER */}
      {activeView === 'operations' && (
        <div className="space-y-4">
          {/* Operations Header Controls */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجوی شماره چک، شناسه صیادی، ذینفع..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-teal-500 outline-none"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-teal-500 outline-none"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="issued">صادر شده (در جریان)</option>
                <option value="cleared">پاس شده (وصول)</option>
                <option value="bounced">برگشت خورده (واخواست)</option>
                <option value="cancelled">ابطال شده / عودت</option>
                <option value="blank">سفید و آزاد</option>
              </select>

              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-teal-500 outline-none"
              >
                <option value="all">همه بانک‌ها</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.bankName}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenIssueCheque()}
                className="px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-teal-600/30 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>صدور برگه چک</span>
              </button>

              <button
                onClick={handleExportLeavesCSV}
                className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-xs font-bold cursor-pointer"
                title="خروجی اکسل"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">اکسل</span>
              </button>
            </div>
          </div>

          {/* Operations Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-right text-xs text-slate-300">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold">
                <tr>
                  <th className="p-3.5">#</th>
                  <th className="p-3.5">شماره برگه / شناسه صیاد</th>
                  <th className="p-3.5">بانک و حساب مبدا</th>
                  <th className="p-3.5">در وجه / ذینفع</th>
                  <th className="p-3.5">تاریخ صدور و سررسید</th>
                  <th className="p-3.5 text-left">مبلغ (ریال)</th>
                  <th className="p-3.5 text-center">وضعیت چرخه حیات</th>
                  <th className="p-3.5 text-center">عملیات تخصصی</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredLeaves.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      هیچ برگه چکی منطبق با فیلترهای انتخابی یافت نشد.
                    </td>
                  </tr>
                ) : (
                  filteredLeaves.map((leaf, index) => {
                    const bank = bankMap.get(leaf.bankAccountId);
                    const book = bookMap.get(leaf.chequeBookId);

                    return (
                      <tr key={leaf.id} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-3.5 text-slate-500 font-mono">{toPersianDigits(index + 1)}</td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-teal-400 text-sm">
                              {toPersianDigits(leaf.leafNumber)}
                            </span>
                            <span className="text-[10px] text-slate-500">({book?.series})</span>
                          </div>
                          <span className="font-mono text-[11px] text-white tracking-wider block mt-0.5">
                            {leaf.sayadNo}
                          </span>
                        </td>
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1">
                            <Landmark className="w-3.5 h-3.5 text-blue-400" />
                            {bank?.bankName || 'حساب نامشخص'}
                          </div>
                          <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                            {bank?.accountNo}
                          </span>
                        </td>
                        <td className="p-3.5">
                          {leaf.payeeName ? (
                            <div>
                              <div className="font-bold text-white flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                {leaf.payeeName}
                              </div>
                              <span className="text-[10px] text-slate-400 block truncate max-w-[160px]">
                                {leaf.notes || 'بدون شرح'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">برگه سفید (صادر نشده)</span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-slate-300">
                          {leaf.dueDate ? (
                            <div>
                              <div className="text-white font-bold">سررسید: {toPersianDigits(leaf.dueDate)}</div>
                              <div className="text-[10px] text-slate-400">صدور: {toPersianDigits(leaf.issueDate || '')}</div>
                            </div>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="p-3.5 text-left">
                          {leaf.amount ? (
                            <div>
                              <div className="font-mono font-bold text-sm text-white">
                                {formatWithCommas(leaf.amount)}
                              </div>
                              <span className="text-[10px] text-slate-400">ریال</span>
                            </div>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          {leaf.status === 'blank' && (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 inline-block">
                              سفید و آزاد
                            </span>
                          )}
                          {leaf.status === 'issued' && (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 inline-block">
                              صادر شده در جریان
                            </span>
                          )}
                          {leaf.status === 'cleared' && (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 inline-block">
                              پاس شده ({toPersianDigits(leaf.clearedDate || '')})
                            </span>
                          )}
                          {leaf.status === 'bounced' && (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 inline-block" title={leaf.bouncedReason}>
                              برگشت خورده
                            </span>
                          )}
                          {leaf.status === 'cancelled' && (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-700/50 text-slate-400 border border-slate-600 inline-block" title={leaf.cancellationReason}>
                              باطل شده / عودت
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {leaf.status === 'blank' && (
                              <button
                                onClick={() => handleOpenIssueCheque(leaf)}
                                className="px-2.5 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>صدور چک</span>
                              </button>
                            )}

                            {leaf.status === 'issued' && (
                              <>
                                <button
                                  onClick={() => handleOpenLeafAction(leaf, 'clear')}
                                  className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-0.5 cursor-pointer"
                                  title="ثبت پاس شدن"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>وصول</span>
                                </button>
                                <button
                                  onClick={() => handleOpenLeafAction(leaf, 'bounce')}
                                  className="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-0.5 cursor-pointer"
                                  title="ثبت برگشت"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>برگشت</span>
                                </button>
                                <button
                                  onClick={() => handleOpenLeafAction(leaf, 'edit')}
                                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer"
                                  title="ویرایش مشخصات چک"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-amber-400" />
                                </button>
                              </>
                            )}

                            {/* View & Print for issued or completed */}
                            {leaf.status !== 'blank' && (
                              <button
                                onClick={() => handleOpenLeafAction(leaf, 'print')}
                                className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer"
                                title="چاپ شناسنامه و برگه چک"
                              >
                                <Printer className="w-3.5 h-3.5 text-cyan-400" />
                              </button>
                            )}

                            {/* Cancel action */}
                            {(leaf.status === 'blank' || leaf.status === 'issued') && (
                              <button
                                onClick={() => handleOpenLeafAction(leaf, 'cancel')}
                                className="p-1 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 rounded-lg transition-all cursor-pointer"
                                title="ابطال برگه چک"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Reset / Undo action */}
                            {(leaf.status === 'cleared' || leaf.status === 'bounced' || leaf.status === 'cancelled') && (
                              <button
                                onClick={() => handleResetLeafStatus(leaf, 'issued')}
                                className="p-1 bg-slate-800 hover:bg-indigo-950 text-indigo-300 rounded-lg transition-all cursor-pointer"
                                title="بازگرداندن به حالت صادر شده"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
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

      {/* VIEW 3: CHEQUE BOOKS MANAGEMENT */}
      {activeView === 'books' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {chequeBooks.map(book => {
              const bank = bankMap.get(book.bankAccountId);
              const bookLeaves = chequeLeaves.filter(l => l.chequeBookId === book.id);
              const blankCount = bookLeaves.filter(l => l.status === 'blank').length;
              const issuedCount = bookLeaves.filter(l => l.status === 'issued').length;
              const clearedCount = bookLeaves.filter(l => l.status === 'cleared').length;
              const bouncedCount = bookLeaves.filter(l => l.status === 'bounced').length;
              const cancelledCount = bookLeaves.filter(l => l.status === 'cancelled').length;

              const usedCount = book.totalLeaves - blankCount;
              const usagePercent = Math.round((usedCount / (book.totalLeaves || 1)) * 100);

              return (
                <div key={book.id} className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl relative overflow-hidden flex flex-col justify-between">
                  <div>
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2.5 bg-teal-500/10 rounded-2xl text-teal-400 border border-teal-500/20">
                          <BookOpen className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-white text-base">دسته چک سری {book.series}</div>
                          <span className="font-mono text-xs text-slate-400">
                            پیشوند صیاد: {book.sayadPrefix || '2105'}
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        book.status === 'active' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : book.status === 'finished'
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {book.status === 'active' ? 'فعال' : book.status === 'finished' ? 'تمام شده' : 'مسدود'}
                      </span>
                    </div>

                    {/* Bank Info */}
                    <div className="mt-4 bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">حساب متصل:</span>
                        <span className="font-bold text-white">{bank?.bankName || 'حساب نامشخص'}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">شماره حساب:</span>
                        <span className="font-mono font-bold text-teal-400">{bank?.accountNo}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">بازه برگه‌ها:</span>
                        <span className="font-mono text-slate-300">
                          از {toPersianDigits(book.startNumber)} تا {toPersianDigits(book.endNumber)} ({toPersianDigits(book.totalLeaves)} برگ)
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">تاریخ دریافت:</span>
                        <span className="font-mono text-slate-300">{toPersianDigits(book.receivedDate)}</span>
                      </div>
                    </div>

                    {/* Usage Progress Bar */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-400 font-medium">پیشرفت مصرف برگه‌ها:</span>
                        <span className="font-mono font-bold text-teal-400">{toPersianDigits(usagePercent)}٪ ({toPersianDigits(usedCount)} از {toPersianDigits(book.totalLeaves)})</span>
                      </div>
                      <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                        <div style={{ width: `${(clearedCount / book.totalLeaves) * 100}%` }} className="bg-emerald-500" title="پاس شده" />
                        <div style={{ width: `${(issuedCount / book.totalLeaves) * 100}%` }} className="bg-indigo-500" title="در جریان" />
                        <div style={{ width: `${(bouncedCount / book.totalLeaves) * 100}%` }} className="bg-rose-500" title="برگشتی" />
                        <div style={{ width: `${(cancelledCount / book.totalLeaves) * 100}%` }} className="bg-slate-700" title="ابطالی" />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 font-mono">
                        <span className="text-teal-400 font-bold">{toPersianDigits(blankCount)} سفید</span>
                        <span className="text-indigo-400">{toPersianDigits(issuedCount)} در جریان</span>
                        <span className="text-emerald-400">{toPersianDigits(clearedCount)} پاس شده</span>
                        {bouncedCount > 0 && <span className="text-rose-400">{toPersianDigits(bouncedCount)} برگشتی</span>}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setSelectedBookId(book.id);
                        setActiveView('leaves');
                      }}
                      className="text-xs text-teal-400 hover:text-teal-300 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>مشاهده برگه‌ها</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenEditBook(book)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-colors cursor-pointer"
                        title="ویرایش اطلاعات دسته چک"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteBook(book)}
                        className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-xl transition-colors cursor-pointer"
                        title="حذف دسته چک"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 4: LEAVES MATRIX */}
      {activeView === 'leaves' && (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="جستجو در تمام برگه‌ها..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-teal-500 outline-none"
                />
              </div>

              <select
                value={selectedBookId}
                onChange={(e) => setSelectedBookId(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-teal-500 outline-none"
              >
                <option value="all">همه دسته‌چک‌ها</option>
                {chequeBooks.map(b => (
                  <option key={b.id} value={b.id}>سری {b.series} ({b.totalLeaves} برگ)</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-teal-500 outline-none"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="blank">سفید و آزاد</option>
                <option value="issued">صادر شده</option>
                <option value="cleared">پاس شده</option>
                <option value="bounced">برگشت خورده</option>
                <option value="cancelled">باطل شده</option>
              </select>
            </div>

            <button
              onClick={handleExportLeavesCSV}
              className="p-2 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>خروجی اکسل ماتریس</span>
            </button>
          </div>

          {/* Cards Grid for Leaves Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredLeaves.map(leaf => {
              const isBlank = leaf.status === 'blank';
              const isIssued = leaf.status === 'issued';
              const isCleared = leaf.status === 'cleared';
              const isBounced = leaf.status === 'bounced';
              const isCancelled = leaf.status === 'cancelled';

              return (
                <div
                  key={leaf.id}
                  className={`p-3 rounded-2xl border text-xs relative transition-all ${
                    isBlank 
                      ? 'bg-slate-900/60 border-slate-800 hover:border-teal-500/50' 
                      : isIssued 
                      ? 'bg-indigo-950/20 border-indigo-500/40 hover:border-indigo-500' 
                      : isCleared 
                      ? 'bg-emerald-950/20 border-emerald-500/40' 
                      : isBounced 
                      ? 'bg-rose-950/20 border-rose-500/40' 
                      : 'bg-slate-950 border-slate-800/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-white text-sm">
                      {toPersianDigits(leaf.leafNumber)}
                    </span>
                    <span className={`w-2 h-2 rounded-full ${
                      isBlank ? 'bg-slate-500' : isIssued ? 'bg-indigo-400 animate-ping' : isCleared ? 'bg-emerald-400' : isBounced ? 'bg-rose-400' : 'bg-slate-600'
                    }`} />
                  </div>

                  <div className="mt-2 text-[10px] font-mono text-slate-400 truncate tracking-wider">
                    {leaf.sayadNo}
                  </div>

                  {leaf.payeeName ? (
                    <div className="mt-1.5">
                      <div className="font-bold text-white truncate text-[11px]">{leaf.payeeName}</div>
                      <div className="font-mono font-bold text-teal-400 text-[11px] mt-0.5">
                        {formatWithCommas(leaf.amount || 0)} ریال
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                        سررسید: {toPersianDigits(leaf.dueDate || '')}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-slate-500 italic text-[11px]">سفید و آزاد</div>
                  )}

                  {/* Actions inside matrix card */}
                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    {isBlank ? (
                      <button
                        onClick={() => handleOpenIssueCheque(leaf)}
                        className="text-[10px] text-teal-400 hover:text-teal-300 font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>صدور</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleOpenLeafAction(leaf, 'view')}
                        className="text-[10px] text-slate-400 hover:text-white font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>جزئیات</span>
                      </button>
                    )}

                    {isIssued && (
                      <button
                        onClick={() => handleOpenLeafAction(leaf, 'clear')}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold cursor-pointer"
                      >
                        وصول
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 5: REPORTS & CASH FLOW */}
      {activeView === 'reports' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Bank Commitments Breakdown */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                <Landmark className="w-4 h-4 text-blue-400" />
                تعهدات چک‌های صادر شده به تفکیک بانک‌ها
              </h3>
              <div className="space-y-3">
                {bankAccounts.map(acc => {
                  const bankIssued = chequeLeaves.filter(l => l.bankAccountId === acc.id && l.status === 'issued');
                  const totalAmt = bankIssued.reduce((sum, l) => sum + (l.amount || 0), 0);

                  return (
                    <div key={acc.id} className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-white text-xs">{acc.bankName} - {acc.branchName}</div>
                        <span className="font-mono text-[10px] text-slate-400">حساب: {acc.accountNo}</span>
                      </div>
                      <div className="text-left">
                        <div className="font-mono font-bold text-sm text-teal-400">{formatWithCommas(totalAmt)} ریال</div>
                        <span className="text-[10px] text-slate-400">{toPersianDigits(bankIssued.length)} فقره چک در جریان</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lifecycle Status Summary */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-teal-400" />
                خلاصه آماری چرخه حیات برگه‌های چک
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <span className="text-xs text-slate-400 block">کل برگه‌ها:</span>
                  <span className="text-xl font-bold font-mono text-white mt-1 block">{toPersianDigits(stats.totalLeavesCount)}</span>
                </div>
                <div className="p-4 bg-teal-950/20 rounded-2xl border border-teal-500/20">
                  <span className="text-xs text-teal-400 block">برگه‌های سفید و آزاد:</span>
                  <span className="text-xl font-bold font-mono text-teal-300 mt-1 block">{toPersianDigits(stats.blankLeaves)}</span>
                </div>
                <div className="p-4 bg-indigo-950/20 rounded-2xl border border-indigo-500/20">
                  <span className="text-xs text-indigo-400 block">صادر شده (در جریان):</span>
                  <span className="text-xl font-bold font-mono text-indigo-300 mt-1 block">{toPersianDigits(stats.issuedCount)}</span>
                  <span className="text-[10px] text-slate-400 font-mono block mt-1">{formatWithCommas(stats.issuedTotalAmount)} ریال</span>
                </div>
                <div className="p-4 bg-emerald-950/20 rounded-2xl border border-emerald-500/20">
                  <span className="text-xs text-emerald-400 block">پاس شده (وصول قطعی):</span>
                  <span className="text-xl font-bold font-mono text-emerald-300 mt-1 block">{toPersianDigits(stats.clearedCount)}</span>
                  <span className="text-[10px] text-slate-400 font-mono block mt-1">{formatWithCommas(stats.clearedTotalAmount)} ریال</span>
                </div>
                <div className="p-4 bg-rose-950/20 rounded-2xl border border-rose-500/20">
                  <span className="text-xs text-rose-400 block">برگشت خورده (واخواست):</span>
                  <span className="text-xl font-bold font-mono text-rose-300 mt-1 block">{toPersianDigits(stats.bouncedCount)}</span>
                </div>
                <div className="p-4 bg-slate-800/40 rounded-2xl border border-slate-700/40">
                  <span className="text-xs text-slate-400 block">باطل شده / عودت:</span>
                  <span className="text-xl font-bold font-mono text-slate-300 mt-1 block">{toPersianDigits(stats.cancelledCount)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / EDIT CHEQUE BOOK */}
      {isBookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-teal-400" />
                {editingBook ? 'ویرایش اطلاعات دسته چک' : 'تعریف دسته چک جدید'}
              </h3>
              <button
                onClick={() => setIsBookModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBook} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">حساب بانکی متصل *</label>
                <select
                  value={bookBankAccountId}
                  onChange={(e) => setBookBankAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                  required
                >
                  <option value="">انتخاب حساب بانکی...</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.bankName} - {b.accountNo} ({b.accountHolder})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">سری دسته چک *</label>
                  <input
                    type="text"
                    placeholder="e.g. الف/1405"
                    value={bookSeries}
                    onChange={(e) => setBookSeries(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">پیشوند صیادی (۴ رقم)</label>
                  <input
                    type="text"
                    placeholder="e.g. 2105"
                    value={bookSayadPrefix}
                    onChange={(e) => setBookSayadPrefix(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">شماره سریال برگه شروع *</label>
                  <input
                    type="number"
                    value={bookStartNumber}
                    onChange={(e) => setBookStartNumber(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    required
                    disabled={!!editingBook}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">تعداد کل برگه‌ها *</label>
                  <select
                    value={bookTotalLeaves}
                    onChange={(e) => setBookTotalLeaves(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    disabled={!!editingBook}
                  >
                    <option value={10}>۱۰ برگ</option>
                    <option value={25}>۲۵ برگ</option>
                    <option value={50}>۵۰ برگ</option>
                    <option value={100}>۱۰۰ برگ</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">تاریخ دریافت از بانک *</label>
                  <input
                    type="text"
                    value={bookReceivedDate}
                    onChange={(e) => setBookReceivedDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">وضعیت دسته چک</label>
                  <select
                    value={bookStatus}
                    onChange={(e) => setBookStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                  >
                    <option value="active">فعال و آماده مصرف</option>
                    <option value="finished">تمام شده</option>
                    <option value="cancelled">مسدود / ابطال شده</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">توضیحات و یادداشت</label>
                <input
                  type="text"
                  placeholder="e.g. تحویل گرفته شده توسط آقای محمدی"
                  value={bookDescription}
                  onChange={(e) => setBookDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsBookModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-teal-600/30 transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{editingBook ? 'ذخیره تغییرات' : 'تولید برگه‌ها و ثبت'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: DIRECT CHEQUE ISSUANCE (صدور برگه چک صیادی) */}
      {isIssueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xl shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-400" />
                صدور مستقیم برگه چک صیادی
              </h3>
              <button
                onClick={() => setIsIssueModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIssueCheque} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">انتخاب دسته‌چک</label>
                  <select
                    value={issueBookId}
                    onChange={(e) => {
                      setIssueBookId(e.target.value);
                      const leaves = chequeLeaves.filter(l => l.chequeBookId === e.target.value && l.status === 'blank');
                      if (leaves[0]) {
                        setIssueLeafId(leaves[0].id);
                        setIssueSayadNo(leaves[0].sayadNo);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                  >
                    {chequeBooks.filter(b => b.status === 'active').map(b => (
                      <option key={b.id} value={b.id}>سری {b.series}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">انتخاب شماره برگه سفید *</label>
                  <select
                    value={issueLeafId}
                    onChange={(e) => {
                      setIssueLeafId(e.target.value);
                      const target = availableBlankLeaves.find(l => l.id === e.target.value);
                      if (target) setIssueSayadNo(target.sayadNo);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    required
                  >
                    {availableBlankLeaves.map(l => (
                      <option key={l.id} value={l.id}>برگه {l.leafNumber} (صیاد: {l.sayadNo})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">شناسه صیاد ۱۶ رقمی</label>
                <input
                  type="text"
                  value={issueSayadNo}
                  onChange={(e) => setIssueSayadNo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-teal-400 font-mono tracking-wider focus:border-teal-500 outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">نوع ذینفع</label>
                  <select
                    value={issueBeneficiaryType}
                    onChange={(e) => {
                      const type = e.target.value as any;
                      setIssueBeneficiaryType(type);
                      if (type === 'supplier' && suppliers[0]) {
                        setIssueBeneficiaryId(suppliers[0].id);
                        setIssuePayeeName(suppliers[0].name);
                      } else if (type === 'personnel' && personnelList[0]) {
                        setIssueBeneficiaryId(personnelList[0].id);
                        setIssuePayeeName(personnelList[0].fullName);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                  >
                    <option value="supplier">تامین‌کننده کالا و خدمات</option>
                    <option value="personnel">پرسنل و حقوق</option>
                    <option value="expense">هزینه‌های جاری</option>
                    <option value="shareholder">سهام‌دار</option>
                    <option value="other">سایر اشخاص</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">در وجه / نام ذینفع *</label>
                  <input
                    type="text"
                    placeholder="نام شخص یا شرکت دریافت‌کننده چک"
                    value={issuePayeeName}
                    onChange={(e) => setIssuePayeeName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                    required
                  />
                </div>
              </div>

              {/* Cheque Amount with Live Persian Words Conversion */}
              <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                <label className="block text-xs font-medium text-slate-300">مبلغ برگه چک (ریال) *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={issueAmount ? formatWithCommas(issueAmount) : ''}
                    onChange={(e) => setIssueAmount(parseNumber(e.target.value))}
                    placeholder="0"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-teal-400 font-mono font-bold focus:border-teal-500 outline-none"
                    required
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">ریال</span>
                </div>
                <div className="text-[11px] text-teal-300/90 font-medium flex items-center gap-1">
                  <span>به حروف:</span>
                  <span className="font-bold text-white">{numberToWordsPersian(issueAmount)} ریال</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">تاریخ صدور *</label>
                  <input
                    type="text"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">تاریخ سررسید چک *</label>
                  <input
                    type="text"
                    value={issueDueDate}
                    onChange={(e) => setIssueDueDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white font-mono focus:border-teal-500 outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">بابت / شرح صدور</label>
                <input
                  type="text"
                  placeholder="e.g. تسویه فاکتور خرید شکر و مواد اولیه"
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-teal-500 outline-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsIssueModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-teal-600/30 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تایید و صدور قطعی برگه چک</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CHEQUE LIFECYCLE ACTION (وصول / برگشت / ابطال / ویرایش) */}
      {actionLeaf && leafActionType && leafActionType !== 'print' && leafActionType !== 'view' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {leafActionType === 'clear' && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                {leafActionType === 'bounce' && <AlertTriangle className="w-5 h-5 text-rose-400" />}
                {leafActionType === 'cancel' && <XCircle className="w-5 h-5 text-slate-400" />}
                {leafActionType === 'return' && <RotateCcw className="w-5 h-5 text-indigo-400" />}
                {leafActionType === 'edit' && <Edit2 className="w-5 h-5 text-amber-400" />}
                <span>
                  {leafActionType === 'clear' && 'ثبت وصول و پاس شدن برگه چک'}
                  {leafActionType === 'bounce' && 'ثبت واخواست و برگشت برگه چک'}
                  {leafActionType === 'cancel' && 'ابطال برگه چک'}
                  {leafActionType === 'return' && 'استرداد و عودت لاشه چک'}
                  {leafActionType === 'edit' && 'ویرایش مشخصات چک صادر شده'}
                </span>
              </h3>
              <button
                onClick={() => {
                  setActionLeaf(null);
                  setLeafActionType(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cheque Quick Snapshot */}
            <div className="mt-4 bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">شماره سریال برگه:</span>
                <span className="font-mono font-bold text-teal-400">برگه {toPersianDigits(actionLeaf.leafNumber)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">شناسه صیاد:</span>
                <span className="font-mono font-bold text-white tracking-wider">{actionLeaf.sayadNo}</span>
              </div>
              {actionLeaf.payeeName && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">در وجه:</span>
                  <span className="font-bold text-white">{actionLeaf.payeeName}</span>
                </div>
              )}
              {actionLeaf.amount && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">مبلغ:</span>
                  <span className="font-mono font-bold text-white">{formatWithCommas(actionLeaf.amount)} ریال</span>
                </div>
              )}
            </div>

            {/* Action Form Inputs */}
            <div className="mt-4 space-y-3">
              {leafActionType === 'edit' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">در وجه / ذینفع *</label>
                    <input
                      type="text"
                      value={editPayeeName}
                      onChange={(e) => setEditPayeeName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">مبلغ به ریال *</label>
                    <input
                      type="text"
                      value={formatWithCommas(editAmount)}
                      onChange={(e) => setEditAmount(parseNumber(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-400 font-mono font-bold focus:border-amber-500 outline-none"
                    />
                    <span className="text-[10px] text-slate-400 block mt-1">به حروف: {numberToWordsPersian(editAmount)} ریال</span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">تاریخ سررسید *</label>
                    <input
                      type="text"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">یادداشت</label>
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      {leafActionType === 'clear' && 'تاریخ وصول و پاس شدن *'}
                      {leafActionType === 'bounce' && 'تاریخ برگشت و واخواست *'}
                      {leafActionType === 'cancel' && 'تاریخ ابطال *'}
                      {leafActionType === 'return' && 'تاریخ عودت لاشه *'}
                    </label>
                    <input
                      type="text"
                      value={actionDate}
                      onChange={(e) => setActionDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-teal-500 outline-none"
                      required
                    />
                  </div>

                  {leafActionType === 'clear' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">شماره رهگیری بانکی / سند وصول</label>
                      <input
                        type="text"
                        placeholder="e.g. TRK-98765432"
                        value={actionTrackingNo}
                        onChange={(e) => setActionTrackingNo(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-teal-500 outline-none"
                      />
                    </div>
                  )}

                  {leafActionType === 'bounce' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">شماره گواهی عدم پرداخت بانک</label>
                      <input
                        type="text"
                        placeholder="e.g. CERT-1405-554"
                        value={actionBouncedDocNo}
                        onChange={(e) => setActionBouncedDocNo(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-rose-500 outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      {leafActionType === 'clear' && 'توضیحات و یادداشت وصول'}
                      {leafActionType === 'bounce' && 'علت برگشت چک *'}
                      {leafActionType === 'cancel' && 'دلیل ابطال برگه چک *'}
                      {leafActionType === 'return' && 'علت و شخص تحویل‌گیرنده لاشه *'}
                    </label>
                    <input
                      type="text"
                      placeholder={
                        leafActionType === 'clear' ? 'e.g. کسر از حساب بانک ملت شعبه مرکزی' :
                        leafActionType === 'bounce' ? 'e.g. عدم تطابق امضا / کسری موجودی' :
                        leafActionType === 'cancel' ? 'e.g. خط‌خوردگی در متن چک / اشتباه در تحریر' : 'e.g. تسویه نقدی به جای چک'
                      }
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-teal-500 outline-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="pt-4 mt-4 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setActionLeaf(null);
                  setLeafActionType(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleApplyLeafAction}
                className={`px-5 py-2 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg transition-all cursor-pointer ${
                  leafActionType === 'clear' ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30' :
                  leafActionType === 'bounce' ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30' :
                  leafActionType === 'edit' ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30' :
                  'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>ثبت نهایی اقدام</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: OFFICIAL CHEQUE PRINT VOUCHER */}
      {actionLeaf && (leafActionType === 'print' || leafActionType === 'view') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-2xl shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Printer className="w-5 h-5 text-cyan-400" />
                شناسنامه و برگه سند چک صیادی
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => printElement(`cheque-voucher-${actionLeaf.id}`)}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-600/30"
                >
                  <Printer className="w-4 h-4" />
                  <span>چاپ سند</span>
                </button>
                <button
                  onClick={() => {
                    setActionLeaf(null);
                    setLeafActionType(null);
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Cheque Voucher Content */}
            <div id={`cheque-voucher-${actionLeaf.id}`} className="mt-4 p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
              {/* Header Box */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-xs">
                <div>
                  <span className="font-bold text-white block text-sm">صنایع غذایی گاتان</span>
                  <span className="text-[11px] text-slate-400">سند رسمی صدور و حواله چک صیادی</span>
                </div>
                <div className="text-left font-mono">
                  <div className="text-teal-400 font-bold">شماره برگه: {toPersianDigits(actionLeaf.leafNumber)}</div>
                  <div className="text-slate-400 text-[10px]">تاریخ صدور: {toPersianDigits(actionLeaf.issueDate || getTodayJalali())}</div>
                </div>
              </div>

              {/* Sayad Barcode Simulation */}
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-center">
                <span className="text-[10px] text-slate-400 block mb-1">شناسه یکتای صیاد (۱۶ رقمی)</span>
                <span className="font-mono text-base font-black text-white tracking-widest">{actionLeaf.sayadNo}</span>
              </div>

              {/* Main Fields Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">بانک صادرکننده و حساب:</span>
                  <span className="font-bold text-white mt-1 block">
                    {bankMap.get(actionLeaf.bankAccountId)?.bankName} • شعبه {bankMap.get(actionLeaf.bankAccountId)?.branchName}
                  </span>
                  <span className="font-mono text-[11px] text-teal-400 block mt-0.5">
                    شماره حساب: {bankMap.get(actionLeaf.bankAccountId)?.accountNo}
                  </span>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80">
                  <span className="text-slate-400 block text-[11px]">در وجه (ذینفع):</span>
                  <span className="font-bold text-white mt-1 block text-sm">{actionLeaf.payeeName || '---'}</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    وضعیت: {actionLeaf.status === 'cleared' ? 'وصول شده' : actionLeaf.status === 'issued' ? 'صادر شده در جریان' : 'سفید'}
                  </span>
                </div>
              </div>

              {/* Amount & Due Date Box */}
              <div className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">مبلغ به عدد:</span>
                  <span className="font-mono font-bold text-base text-teal-400">{formatWithCommas(actionLeaf.amount || 0)} ریال</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                  <span className="text-slate-400">مبلغ به حروف:</span>
                  <span className="font-bold text-white">{numberToWordsPersian(actionLeaf.amount || 0)} ریال</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                  <span className="text-slate-400">تاریخ سررسید:</span>
                  <span className="font-mono font-bold text-white">{toPersianDigits(actionLeaf.dueDate || '')}</span>
                </div>
                {actionLeaf.notes && (
                  <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                    <span className="text-slate-400">بابت / شرح:</span>
                    <span className="text-slate-300">{actionLeaf.notes}</span>
                  </div>
                )}
              </div>

              {/* Official Signatures Box */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center text-[10px]">
                <div className="p-2 border border-slate-800 rounded-lg">
                  <span className="text-slate-400 block">متصدی صدور چک</span>
                  <span className="text-slate-500 block mt-4">امضاء</span>
                </div>
                <div className="p-2 border border-slate-800 rounded-lg">
                  <span className="text-slate-400 block">مدیر امور مالی</span>
                  <span className="text-slate-500 block mt-4">امضاء و مهر</span>
                </div>
                <div className="p-2 border border-slate-800 rounded-lg">
                  <span className="text-slate-400 block">امضاء مجاز / مدیرعامل</span>
                  <span className="text-slate-500 block mt-4">امضاء نهایی</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
