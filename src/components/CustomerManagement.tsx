/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Customer, CustomerCategory, CustomerBankAccount, Product } from '../types';
import { 
  Users, Plus, Search, Edit2, Trash2, CheckCircle, XCircle, FileSpreadsheet, 
  Printer, Save, Phone, MapPin, CreditCard, Banknote, ListPlus, X, AlertTriangle, 
  Download, Building2, UserCheck, ShieldAlert, Tag, Percent, Calendar, FileText,
  Clock, Hash, Mail, ArrowUpDown, ChevronDown, Check, Eye, Layers, Store, Briefcase, RefreshCw, Upload, ChefHat
} from 'lucide-react';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString 
} from '../utils/persianUtils';
import { decodeFileBuffer, parseCSVText } from '../utils/csvUtils';
import CustomerProductionOrders from './CustomerProductionOrders';
import { nextSimpleId } from '../utils/simpleId';
import { ModuleHeader, ModulePrimaryTabs, UnifiedToolbar, ErpButton, ERP_BUTTON_LABELS } from './ui/UnifiedErpUi';
import CopyFromPeriodModal from './ui/CopyFromPeriodModal';
import { CopySectionKey } from '../utils/periodCopyEngine';
import { useErpFeedback } from './ui/ToastContext';

interface CustomerManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  currentUserName?: string;
}

export default function CustomerManagement({ db, onUpdateDb, activePeriodId, currentUserName = '' }: CustomerManagementProps) {
  const { toast } = useErpFeedback();
  // Navigation Sub-tab — defaults directly to Customer Production Orders ('orders')
  const [activeSubTab, setActiveSubTab] = useState<'orders' | 'list' | 'form' | 'categories'>('orders');
  const [copySection, setCopySection] = useState<CopySectionKey | null>(null);

  const activeCustomerOrdersCount = useMemo(() => {
    return (db.customerProductionOrders || []).filter(
      o => o.periodId === activePeriodId && o.status !== 'delivered' && o.status !== 'cancelled'
    ).length;
  }, [db.customerProductionOrders, activePeriodId]);

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'creditLimit' | 'discount'>('code');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modals & Active Selections
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const askConfirm = (title: string, message: string, action: () => void) => {
    setConfirmModal({
      title,
      message,
      onConfirm: action
    });
  };

  // Focus Helper
  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.select();
  };

  // Period Scoped Collections
  const customers = useMemo(() => {
    return (db.customers || []).filter(c => c.periodId === activePeriodId);
  }, [db.customers, activePeriodId]);

  const normCat = (s?: string): string =>
    String(s || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');

  const categories = useMemo(() => {
    const list = (db.customerCategories || []).filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.filter(c => {
      const n = normCat(c.name);
      const dup = seen.has(`id:${c.id}`) || (Boolean(n) && seen.has(`name:${n}`));
      seen.add(`id:${c.id}`);
      if (n) seen.add(`name:${n}`);
      return !dup;
    });
  }, [db.customerCategories, activePeriodId]);

  const activeProducts = useMemo(() => {
    return (db.products || []).filter(p => p.periodId === activePeriodId);
  }, [db.products, activePeriodId]);

  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const productMap = useMemo(() => {
    const map: Record<string, string> = {};
    activeProducts.forEach(p => { map[p.id] = p.name; });
    return map;
  }, [activeProducts]);

  // Statistics KPI
  const stats = useMemo(() => {
    const total = customers.length;
    const activeCount = customers.filter(c => c.isActive && c.status !== 'blocked').length;
    const blockedCount = customers.filter(c => c.status === 'blocked').length;
    const totalCredit = customers.reduce((sum, c) => sum + (c.creditLimit || 0), 0);
    const corporateCount = customers.filter(c => c.type === 'حقوقی' || c.type === 'فروشگاه' || c.type === 'سازمانی').length;
    const individualCount = customers.filter(c => c.type === 'حقیقی').length;

    return {
      total,
      activeCount,
      blockedCount,
      totalCredit,
      corporateCount,
      individualCount
    };
  }, [customers]);

  // Filtered & Sorted Customer List
  const filteredCustomers = useMemo(() => {
    return customers
      .filter(c => {
        // Search
        if (searchQuery) {
          const matches = 
            matchPersianString(c.name, searchQuery) ||
            matchPersianString(c.code, searchQuery) ||
            matchPersianString(c.phone, searchQuery) ||
            matchPersianString(c.tel || '', searchQuery) ||
            matchPersianString(c.contactPerson || '', searchQuery) ||
            matchPersianString(c.nationalId || '', searchQuery) ||
            matchPersianString(c.economicCode || '', searchQuery) ||
            matchPersianString(c.city || '', searchQuery) ||
            matchPersianString(c.address, searchQuery);
          if (!matches) return false;
        }

        // Category Filter
        if (categoryFilter !== 'all' && c.categoryId !== categoryFilter) {
          return false;
        }

        // Type Filter
        if (typeFilter !== 'all' && c.type !== typeFilter) {
          return false;
        }

        // Status Filter
        if (statusFilter !== 'all') {
          if (statusFilter === 'active' && (!c.isActive || c.status === 'blocked')) return false;
          if (statusFilter === 'inactive' && c.isActive) return false;
          if (statusFilter === 'blocked' && c.status !== 'blocked') return false;
        }

        return true;
      })
      .sort((a, b) => {
        let valA: any = a[sortBy] || '';
        let valB: any = b[sortBy] || '';

        if (sortBy === 'creditLimit' || sortBy === 'discount') {
          valA = Number(valA) || 0;
          valB = Number(valB) || 0;
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [customers, searchQuery, categoryFilter, typeFilter, statusFilter, sortBy, sortOrder]);

  // Suggest Next Customer Code
  const nextCustomerCode = useMemo(() => {
    const existingNumbers = customers
      .map(c => {
        const num = parseInt(c.code.replace(/\D/g, ''), 10);
        return isNaN(num) ? 0 : num;
      })
      .filter(n => n > 0);
    
    const max = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 1000;
    return `C-${max + 1}`;
  }, [customers]);

  // --- FORM STATE ---
  const [formData, setFormData] = useState<Partial<Customer>>({
    code: nextCustomerCode,
    accountingCode: '',
    name: '',
    type: 'حقیقی',
    categoryId: categories[0]?.id || '',
    contactPerson: '',
    nationalId: '',
    economicCode: '',
    registrationNo: '',
    phone: '',
    tel: '',
    fax: '',
    email: '',
    province: 'تهران',
    city: 'تهران',
    postalCode: '',
    address: '',
    deliveryAddress: '',
    discountPercent: 0,
    creditLimit: 0,
    settlementPeriodDays: 30,
    paymentTerms: 'نقدی',
    salesAgent: '',
    isActive: true,
    status: 'active',
    blockReason: '',
    notes: '',
    preferredProductIds: [],
    bankAccounts: []
  });

  React.useEffect(() => {
    if (!editingCustomer) {
      setFormData(prev => {
        const isValid = Boolean(prev.categoryId) && categories.some(c => c.id === prev.categoryId);
        if (isValid) return prev;
        return { ...prev, categoryId: categories[0]?.id || '' };
      });
    }
  }, [categories, editingCustomer]);

  // Draft Bank Account builder
  const [draftBank, setDraftBank] = useState<CustomerBankAccount>({
    bankName: 'بانک ملت',
    accountHolder: '',
    accountNo: '',
    shaba: '',
    cardNo: ''
  });

  const handleAddBankAccount = () => {
    if (!draftBank.accountNo && !draftBank.shaba && !draftBank.cardNo) {
      alert('لطفاً حداقل شماره حساب، شماره شبا یا شماره کارت را وارد نمایید.');
      return;
    }
    const currentBanks = formData.bankAccounts || [];
    setFormData({
      ...formData,
      bankAccounts: [...currentBanks, { ...draftBank }]
    });
    setDraftBank({
      bankName: 'بانک ملت',
      accountHolder: '',
      accountNo: '',
      shaba: '',
      cardNo: ''
    });
  };

  const handleRemoveBankAccount = (index: number) => {
    const updated = (formData.bankAccounts || []).filter((_, i) => i !== index);
    setFormData({ ...formData, bankAccounts: updated });
  };

  // Toggle preferred product
  const togglePreferredProduct = (productId: string) => {
    const current = formData.preferredProductIds || [];
    if (current.includes(productId)) {
      setFormData({ ...formData, preferredProductIds: current.filter(id => id !== productId) });
    } else {
      setFormData({ ...formData, preferredProductIds: [...current, productId] });
    }
  };

  // Prepare Edit
  const handleStartEdit = (cust: Customer) => {
    setEditingCustomer(cust);
    setFormData({
      ...cust,
      bankAccounts: cust.bankAccounts ? [...cust.bankAccounts] : [],
      preferredProductIds: cust.preferredProductIds ? [...cust.preferredProductIds] : []
    });
    setActiveSubTab('form');
  };

  // Reset Form for New Customer
  const handleStartNew = () => {
    setEditingCustomer(null);
    setFormData({
      code: nextCustomerCode,
      accountingCode: '',
      name: '',
      type: 'حقیقی',
      categoryId: categories[0]?.id || '',
      contactPerson: '',
      nationalId: '',
      economicCode: '',
      registrationNo: '',
      phone: '',
      tel: '',
      fax: '',
      email: '',
      province: 'تهران',
      city: 'تهران',
      postalCode: '',
      address: '',
      deliveryAddress: '',
      discountPercent: 0,
      creditLimit: 0,
      settlementPeriodDays: 30,
      paymentTerms: 'نقدی',
      salesAgent: '',
      isActive: true,
      status: 'active',
      blockReason: '',
      notes: '',
      preferredProductIds: [],
      bankAccounts: []
    });
    setActiveSubTab('form');
  };

  // Save Customer
  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name?.trim()) {
      alert('وارد کردن نام مشتری یا عنوان تجاری الزامی است.');
      return;
    }

    if (!formData.phone?.trim()) {
      alert('وارد کردن تلفن همراه اصلی الزامی است.');
      return;
    }

    const isEdit = !!editingCustomer;
    const finalCustomer: Customer = {
      id: isEdit ? editingCustomer.id : nextSimpleId(db.customers || [], 'cust'),
      periodId: activePeriodId,
      code: formData.code?.trim() || nextCustomerCode,
      accountingCode: formData.accountingCode?.trim() || '',
      name: formData.name.trim(),
      type: formData.type || 'حقیقی',
      categoryId: (formData.categoryId && categories.some(c => c.id === formData.categoryId) ? formData.categoryId : categories[0]?.id) || undefined,
      contactPerson: formData.contactPerson?.trim() || '',
      nationalId: formData.nationalId?.trim() || '',
      economicCode: formData.economicCode?.trim() || '',
      registrationNo: formData.registrationNo?.trim() || '',
      phone: formData.phone.trim(),
      tel: formData.tel?.trim() || '',
      fax: formData.fax?.trim() || '',
      email: formData.email?.trim() || '',
      province: formData.province?.trim() || '',
      city: formData.city?.trim() || '',
      postalCode: formData.postalCode?.trim() || '',
      address: formData.address?.trim() || '',
      deliveryAddress: formData.deliveryAddress?.trim() || '',
      discountPercent: Number(formData.discountPercent) || 0,
      creditLimit: Number(formData.creditLimit) || 0,
      settlementPeriodDays: Number(formData.settlementPeriodDays) || 0,
      paymentTerms: formData.paymentTerms || 'نقدی',
      salesAgent: formData.salesAgent?.trim() || '',
      bankAccounts: formData.bankAccounts || [],
      isActive: formData.status === 'blocked' ? false : (formData.isActive ?? true),
      status: formData.status || 'active',
      blockReason: formData.status === 'blocked' ? (formData.blockReason?.trim() || '') : '',
      notes: formData.notes?.trim() || '',
      preferredProductIds: formData.preferredProductIds || [],
      createdAt: isEdit ? editingCustomer.createdAt : new Date().toISOString()
    };

    const updatedCustomers = isEdit
      ? (db.customers || []).map(c => c.id === finalCustomer.id ? finalCustomer : c)
      : [...(db.customers || []), finalCustomer];

    onUpdateDb({
      ...db,
      customers: updatedCustomers
    });

    toast(`مشتری «${finalCustomer.name}» با کد ${finalCustomer.code} با موفقیت ${isEdit ? 'ویرایش' : 'ثبت'} شد.`, 'success');
    setEditingCustomer(null);
    setActiveSubTab('list');
  };

  // Delete Customer
  const handleDeleteCustomer = (cust: Customer) => {
    askConfirm(
      'حذف پرونده مشتری',
      `آیا از حذف اطلاعات مشتری "${cust.name}" با کد شناسایی "${cust.code}" اطمینان کامل دارید؟`,
      () => {
        const updated = (db.customers || []).filter(c => c.id !== cust.id);
        onUpdateDb({
          ...db,
          customers: updated
        });
        alert(`پرونده مشتری "${cust.name}" با موفقیت حذف گردید.`);
        if (viewingCustomer?.id === cust.id) setViewingCustomer(null);
      }
    );
  };

  // --- CUSTOMER CATEGORY MANAGEMENT ---
  const [newCatName, setNewCatName] = useState('');
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatDiscount, setNewCatDiscount] = useState<number>(0);
  const [newCatPayment, setNewCatPayment] = useState('چک ۳۰ روزه');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [editingCategory, setEditingCategory] = useState<CustomerCategory | null>(null);

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newCatName.trim();
    if (!trimmedName) {
      alert('وارد کردن عنوان گروه مشتری الزامی است.');
      return;
    }
    const normNewName = normCat(trimmedName);
    const allCats = db.customerCategories || [];
    const duplicate = allCats.some(c => c.periodId === activePeriodId && (!editingCategory || c.id !== editingCategory.id) && normCat(c.name) === normNewName);
    if (duplicate) {
      toast(`گروه مشتری «${trimmedName}» قبلاً در این دوره ثبت شده است.`, 'error');
      return;
    }

    if (editingCategory) {
      const updated = allCats.map(c => 
        c.id === editingCategory.id 
          ? { 
              ...c, 
              periodId: activePeriodId,
              name: trimmedName, 
              code: newCatCode.trim() || undefined,
              defaultDiscountPercent: Number(newCatDiscount) || 0,
              defaultPaymentTerm: newCatPayment,
              description: newCatDesc.trim() || undefined
            } 
          : c
      );
      onUpdateDb({ ...db, customerCategories: updated });
      setEditingCategory(null);
    } else {
      const newCat: CustomerCategory = {
        id: nextSimpleId(allCats, 'ccat'),
        periodId: activePeriodId,
        name: trimmedName,
        code: newCatCode.trim() || `GRP-${String(categories.length + 1).padStart(2, '0')}`,
        defaultDiscountPercent: Number(newCatDiscount) || 0,
        defaultPaymentTerm: newCatPayment,
        description: newCatDesc.trim() || undefined
      };
      onUpdateDb({ ...db, customerCategories: [...allCats, newCat] });
    }

    setNewCatName('');
    setNewCatCode('');
    setNewCatDiscount(0);
    setNewCatPayment('چک ۳۰ روزه');
    setNewCatDesc('');
    toast('گروه مشتریان با موفقیت ذخیره شد.', 'success');
  };

  const handleDeleteCategory = (cat: CustomerCategory) => {
    const linkedCount = customers.filter(c => c.categoryId === cat.id).length;
    if (linkedCount > 0) {
      toast(`امکان حذف این گروه وجود ندارد زیرا ${toPersianDigits(linkedCount)} مشتری در این گروه عضو هستند.`, 'error');
      return;
    }

    askConfirm(
      'حذف گروه مشتریان',
      `آیا از حذف گروه "${cat.name}" اطمینان دارید؟`,
      () => {
        const updated = (db.customerCategories || []).filter(c => c.id !== cat.id);
        onUpdateDb({ ...db, customerCategories: updated });
        toast(`گروه «${cat.name}» حذف شد.`, 'info');
      }
    );
  };

  // --- EXPORT / IMPORT CSV & EXCEL ---
  const handleExportCustomersCSV = () => {
    if (customers.length === 0) {
      alert('مشتری ثبت‌شده‌ای جهت خروجی وجود ندارد.');
      return;
    }

    const headers = [
      'کد مشتری',
      'نام و عنوان تجاری',
      'نوع مشتری',
      'گروه مشتری',
      'مسئول خرید / رابط',
      'تلفن همراه',
      'تلفن ثابت',
      'کد ملی / شناسه ملی',
      'کد اقتصادی',
      'شماره ثبت',
      'استان',
      'شهر',
      'نشانی کامل',
      'درصد تخفیف',
      'سقف اعتبار (ریال)',
      'مهلت تسویه (روز)',
      'نحوه تسویه',
      'کارشناس فروش',
      'وضعیت'
    ];

    const rows = customers.map(c => [
      c.code,
      c.name,
      c.type,
      categoryMap[c.categoryId || ''] || '-',
      c.contactPerson || '-',
      c.phone,
      c.tel || '-',
      c.nationalId || '-',
      c.economicCode || '-',
      c.registrationNo || '-',
      c.province || '-',
      c.city || '-',
      `"${(c.address || '').replace(/"/g, '""')}"`,
      c.discountPercent || 0,
      c.creditLimit || 0,
      c.settlementPeriodDays || 0,
      c.paymentTerms || 'نقدی',
      c.salesAgent || '-',
      c.status === 'blocked' ? 'مسدود' : (c.isActive ? 'فعال' : 'غیرفعال')
    ]);

    downloadCSV(`Customers_List_${activePeriodId}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const handlePrintList = () => {
    printElement('customer-printable-section', 'فهرست جامع مشتریان و طرف‌های تجاری');
  };

  const downloadSampleCustomersCSV = () => {
    const headers = ['کد مشتری', 'نام و عنوان تجاری', 'نوع مشتری', 'مسئول خرید', 'تلفن همراه', 'نشانی'];
    const rows = [
      ['C-1001', 'شیرینی سرای صدف', 'فروشگاه', 'آقای صدف‌پور', '09121112233', 'تهران، تجریش'],
      ['C-1002', 'کافه و فینگرفود بونو', 'حقوقی', 'خانم راد', '09223334455', 'تهران، نیاوران']
    ];
    downloadCSV(`Sample_Customers_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const importCustomersFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updatedCustomers = [...(db.customers || [])];
      let importCount = 0;

      rows.forEach((row, index) => {
        if (index === 0 || row.length === 0) return;
        const codeVal = row[0]?.trim() || nextCustomerCode;
        const nameVal = row[1]?.trim();
        if (!nameVal) return;

        if (updatedCustomers.some(c => c.periodId === activePeriodId && (c.name === nameVal || c.code === codeVal))) return;

        const importedCustomer: Customer = {
          id: nextSimpleId(updatedCustomers, 'cust'),
          periodId: activePeriodId,
          code: codeVal,
          accountingCode: '',
          name: nameVal,
          type: (row[2] as any) || 'حقیقی',
          categoryId: categories[0]?.id,
          contactPerson: row[3]?.trim() || '',
          nationalId: '',
          economicCode: '',
          registrationNo: '',
          phone: row[4]?.trim() || '09120000000',
          tel: '',
          fax: '',
          email: '',
          province: 'تهران',
          city: 'تهران',
          postalCode: '',
          address: row[5]?.trim() || '',
          deliveryAddress: '',
          discountPercent: 0,
          creditLimit: 0,
          settlementPeriodDays: 30,
          paymentTerms: 'نقدی',
          salesAgent: '',
          bankAccounts: [],
          isActive: true,
          status: 'active',
          blockReason: '',
          notes: '',
          preferredProductIds: [],
          createdAt: new Date().toISOString()
        };

        updatedCustomers.push(importedCustomer);
        importCount++;
      });

      onUpdateDb({ ...db, customers: updatedCustomers });
      toast(`${toPersianDigits(importCount)} مشتری با موفقیت از اکسل وارد شد.`, 'success');
    };
    reader.readAsArrayBuffer(file);
  };


  const handlePrintProfile = () => {
    printElement('customer-card-print-target', `شناسنامه مشتری - ${viewingCustomer?.name || 'مشتری'}`);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-4 text-right">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/20">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-black text-slate-100">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-rose-600/20 cursor-pointer"
              >
                تایید و حذف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED MODULE HEADER & PRIMARY TABS */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <ModuleHeader
          icon={<Users className="h-5 w-5" />}
          title="مدیریت مشتریان و سفارش‌های تولید"
          subtitle="ثبت سفارش تولید مشتریان، پرونده مشتریان حقیقی و حقوقی، گروه‌بندی، سقف اعتبار و شرایط تسویه"
          periodName={db.periods.find(p => p.id === activePeriodId)?.name}
          recordCount={activeSubTab === 'orders' ? activeCustomerOrdersCount : activeSubTab === 'categories' ? categories.length : customers.length}
          recordLabel={activeSubTab === 'orders' ? 'سفارش فعال' : activeSubTab === 'categories' ? 'گروه' : 'مشتری'}
          actions={
            <div className="flex items-center gap-2">
              <ErpButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  const sec: CopySectionKey =
                    activeSubTab === 'orders'
                      ? 'customerProductionOrders'
                      : activeSubTab === 'categories'
                        ? 'customerCategories'
                        : 'customers';
                  setCopySection(sec);
                }}
              >
                {ERP_BUTTON_LABELS.copyFromPeriod}
              </ErpButton>
            </div>
          }
        />

        <ModulePrimaryTabs
          activeId={activeSubTab === 'form' ? 'list' : activeSubTab}
          onChange={(id) => {
            setActiveSubTab(id as typeof activeSubTab);
          }}
          tabs={[
            { id: 'orders', label: 'ثبت سفارش تولید', icon: <ChefHat className="h-4 w-4" />, count: activeCustomerOrdersCount },
            { id: 'list', label: 'مشتریان', icon: <Users className="h-4 w-4" />, count: customers.length },
            { id: 'categories', label: 'گروه‌های مشتریان', icon: <Layers className="h-4 w-4" />, count: categories.length },
          ]}
        />

        {/* 4 SUMMARY STATS CARDS (Shown on Customer Directory / Form / Categories tabs) */}
        {activeSubTab !== 'orders' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5 mt-4 sm:mt-6 pt-3.5 sm:pt-5 border-t border-slate-800/80 relative z-10">
            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80">
              <span className="text-[11px] text-slate-400 block mb-1">کل مشتریان ثبت‌شده</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-black text-slate-100 font-mono">{toPersianDigits(stats.total)}</span>
                <span className="text-[10px] text-slate-500">پرونده</span>
              </div>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80">
              <span className="text-[11px] text-emerald-400 block mb-1">مشتریان فعال تجاری</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-black text-emerald-400 font-mono">{toPersianDigits(stats.activeCount)}</span>
                <span className="text-[10px] text-emerald-500/80">در حال همکاری</span>
              </div>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80">
              <span className="text-[11px] text-cyan-400 block mb-1">مجموع سقف اعتبار ریالی</span>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-black text-cyan-400 font-mono">{formatWithCommas(stats.totalCredit)}</span>
                <span className="text-[10px] text-slate-500">ریال</span>
              </div>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800/80">
              <span className="text-[11px] text-amber-400 block mb-1">فروشگاه‌ها و سازمانی</span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-black text-amber-400 font-mono">{toPersianDigits(stats.corporateCount)}</span>
                <span className="text-[10px] text-slate-500">شرکت / فروشگاه</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 0. CUSTOMER PRODUCTION ORDERS VIEW (DEFAULT LANDING PAGE)                 */}
      {/* ========================================================================= */}
      {activeSubTab === 'orders' && (
        <CustomerProductionOrders
          db={db}
          onUpdateDb={onUpdateDb}
          activePeriodId={activePeriodId}
          currentUserName={currentUserName}
        />
      )}

      {/* ========================================================================= */}
      {/* 1. CUSTOMER DIRECTORY VIEW */}
      {/* ========================================================================= */}
      {activeSubTab === 'list' && (
        <div className="space-y-4">
          {/* SEARCH, FILTERS & EXPORT TOOLBAR */}
          <div className="space-y-3">
            <UnifiedToolbar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="جستجو در نام مشتری، کد، موبایل، کد ملی یا شهر..."
              hasActiveFilters={Boolean(searchQuery || categoryFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all')}
              onResetFilters={() => {
                setSearchQuery('');
                setCategoryFilter('all');
                setTypeFilter('all');
                setStatusFilter('all');
              }}
              onDownloadTemplate={downloadSampleCustomersCSV}
              onImportExcel={importCustomersFile}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={handleExportCustomersCSV}
              onPrint={handlePrintList}
              onAdd={handleStartNew}
              addLabel={ERP_BUTTON_LABELS.add}
            />
            <div className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800">

            {/* FILTERS ROW */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800/60">
              {/* Category Filter */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">گروه مشتری</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="all">همه گروه‌ها ({toPersianDigits(customers.length)})</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({toPersianDigits(customers.filter(c => c.categoryId === cat.id).length)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Type Filter */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">نوع شخصیت</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="all">همه انواع</option>
                  <option value="حقیقی">شخص حقیقی</option>
                  <option value="حقوقی">شرکت و سازمان حقوقی</option>
                  <option value="فروشگاه">فروشگاه / هایپرمارکت</option>
                  <option value="سازمانی">سازمانی / ارگانی</option>
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">وضعیت فعالیت</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="all">همه وضعیت‌ها</option>
                  <option value="active">فعال و مجاز</option>
                  <option value="inactive">غیرفعال</option>
                  <option value="blocked">مسدود شده</option>
                </select>
              </div>

              {/* Sorting */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">مرتب‌سازی</label>
                <div className="flex gap-1">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="flex-grow px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="code">کد مشتری</option>
                    <option value="name">نام مشتری</option>
                    <option value="creditLimit">سقف اعتبار</option>
                    <option value="discount">درصد تخفیف</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
                    title={sortOrder === 'asc' ? 'صعودی' : 'نزولی'}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* TABLE OF CUSTOMERS */}
          <div id="customer-printable-section" className="bg-slate-900/90 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/90 text-slate-400 text-[11px] font-bold border-b border-slate-800">
                    <th className="px-4 py-3.5">کد</th>
                    <th className="px-4 py-3.5">نام مشتری / واحد تجاری</th>
                    <th className="px-4 py-3.5">گروه و نوع</th>
                    <th className="px-4 py-3.5">مسئول خرید / تماس</th>
                    <th className="px-4 py-3.5">اطلاعات تماس و نشانی</th>
                    <th className="px-4 py-3.5 text-left">سقف اعتبار مالی</th>
                    <th className="px-4 py-3.5 text-center">شرایط تسویه</th>
                    <th className="px-4 py-3.5 text-center">وضعیت</th>
                    <th className="px-4 py-3.5 text-center no-print">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                        <Users className="h-10 w-10 mx-auto text-slate-700 mb-2 opacity-50" />
                        هیچ مشتری با فیلترهای مشخص‌شده یافت نشد.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map(cust => {
                      const catName = categoryMap[cust.categoryId || ''] || 'نامشخص';
                      const isBlocked = cust.status === 'blocked';
                      const isInactive = !cust.isActive;

                      return (
                        <tr 
                          key={cust.id}
                          className="hover:bg-slate-800/50 transition-colors group"
                        >
                          {/* Code */}
                          <td className="px-4 py-3.5 font-mono font-bold text-rose-400">
                            {cust.code}
                          </td>

                          {/* Name & Type */}
                          <td className="px-4 py-3.5">
                            <div className="font-bold text-slate-100 flex items-center gap-1.5">
                              {cust.type === 'فروشگاه' && <Store className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                              {cust.type === 'حقوقی' && <Building2 className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
                              {cust.type === 'سازمانی' && <Briefcase className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
                              {cust.type === 'حقیقی' && <Users className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                              <span>{cust.name}</span>
                            </div>
                            {cust.accountingCode && (
                              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                                کد حسابداری: {cust.accountingCode}
                              </span>
                            )}
                          </td>

                          {/* Category & Type Badges */}
                          <td className="px-4 py-3.5">
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-950 border border-slate-800 text-slate-300 rounded-md w-fit">
                                {catName}
                              </span>
                              <span className="text-[9px] text-slate-500">
                                {cust.type}
                              </span>
                            </div>
                          </td>

                          {/* Contact Person */}
                          <td className="px-4 py-3.5 text-slate-300">
                            <div>{cust.contactPerson || '-'}</div>
                            {cust.nationalId && (
                              <span className="text-[10px] text-slate-500 font-mono block">
                                کد/شناسه ملی: {cust.nationalId}
                              </span>
                            )}
                          </td>

                          {/* Contact & City */}
                          <td className="px-4 py-3.5 text-slate-300">
                            <div className="font-mono text-slate-200 font-bold flex items-center gap-1">
                              <Phone className="h-3 w-3 text-rose-400 shrink-0" />
                              <span dir="ltr">{cust.phone}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]" title={cust.address}>
                              {cust.city ? `${cust.city}، ` : ''}{cust.address || '-'}
                            </div>
                          </td>

                          {/* Credit Limit */}
                          <td className="px-4 py-3.5 text-left font-mono">
                            <div className="font-bold text-cyan-400">
                              {formatWithCommas(cust.creditLimit || 0)} <span className="text-[10px] text-slate-500">ریال</span>
                            </div>
                            {(cust.discountPercent || 0) > 0 && (
                              <span className="text-[10px] text-emerald-400 font-bold block">
                                {toPersianDigits(cust.discountPercent || 0)}٪ تخفیف
                              </span>
                            )}
                          </td>

                          {/* Payment Terms */}
                          <td className="px-4 py-3.5 text-center text-slate-300">
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-950 border border-slate-800 rounded-md inline-block">
                              {cust.paymentTerms || 'نقدی'}
                            </span>
                            {(cust.settlementPeriodDays || 0) > 0 && (
                              <span className="text-[10px] text-slate-500 block mt-0.5">
                                {toPersianDigits(cust.settlementPeriodDays || 0)} روزه
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3.5 text-center">
                            {isBlocked ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-950/40 border border-rose-900/50 px-2 py-0.5 rounded-full">
                                <ShieldAlert className="h-3 w-3" />
                                مسدود
                              </span>
                            ) : isInactive ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                                <XCircle className="h-3 w-3" />
                                غیرفعال
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2 py-0.5 rounded-full">
                                <CheckCircle className="h-3 w-3" />
                                فعال
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3.5 text-center no-print">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => setViewingCustomer(cust)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-all cursor-pointer"
                                title="مشاهده شناسنامه کامل مشتری"
                              >
                                <Eye className="h-3.5 w-3.5 text-cyan-400" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleStartEdit(cust)}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-all cursor-pointer"
                                title="ویرایش پرونده مشتری"
                              >
                                <Edit2 className="h-3.5 w-3.5 text-amber-400" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteCustomer(cust)}
                                className="p-1.5 bg-slate-800 hover:bg-rose-950/50 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 rounded-lg transition-all cursor-pointer"
                                title="حذف مشتری"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. CUSTOMER FORM VIEW (CREATE / EDIT) */}
      {/* ========================================================================= */}
      {activeSubTab === 'form' && (
        <form onSubmit={handleSaveCustomer} className="space-y-6">
          <div className="bg-slate-900/95 p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
                  {editingCustomer ? <Edit2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-100">
                    {editingCustomer ? `ویرایش پرونده مشتری: ${editingCustomer.name}` : 'تعریف و ثبت پرونده مشتری جدید'}
                  </h2>
                  <span className="text-[11px] text-slate-400">
                    لطفاً اطلاعات هویتی، تماس، مالی و مشخصات بانکی مشتری را با دقت وارد فرمایید.
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveSubTab('list')}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
              >
                <X className="h-4 w-4" />
                انصراف و بازگشت
              </button>
            </div>

            {/* SECTION 1: GENERAL & IDENTITY */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-rose-400 flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                ۱. اطلاعات عمومی و هویتی مشتری
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
                {/* Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    کد شناسایی مشتری <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code || ''}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="مثال: C-1001"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-rose-400 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Name */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    نام کامل مشتری / عنوان شرکت یا فروشگاه <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="مثال: هایپرمارکت پالادیوم یا حاج قاسم مهدوی"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Customer Type */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">نوع شخصیت مشتری</label>
                  <select
                    value={formData.type || 'حقیقی'}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="حقیقی">شخص حقیقی</option>
                    <option value="حقوقی">شرکت / سازمان حقوقی</option>
                    <option value="فروشگاه">فروشگاه و هایپرمارکت</option>
                    <option value="سازمانی">سازمانی / ارگانی / نهاد</option>
                  </select>
                </div>

                {/* Category Group */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">گروه مشتری</label>
                  <select
                    value={categories.some(c => c.id === (formData.categoryId || '')) ? (formData.categoryId || '') : ''}
                    onChange={(e) => {
                      const selCat = categories.find(c => c.id === e.target.value);
                      setFormData({ 
                        ...formData, 
                        categoryId: e.target.value,
                        discountPercent: selCat?.defaultDiscountPercent || formData.discountPercent,
                        paymentTerms: (selCat?.defaultPaymentTerm as any) || formData.paymentTerms
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="">-- انتخاب گروه مشتری --</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {/* Contact Person */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">نام رابط / مدیر خرید</label>
                  <input
                    type="text"
                    value={formData.contactPerson || ''}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="مثال: آقای مهندس رضایی"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* National ID */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">کد ملی / شناسه ملی شرکت</label>
                  <input
                    type="text"
                    value={formData.nationalId || ''}
                    onChange={(e) => setFormData({ ...formData, nationalId: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="۱۰ یا ۱۱ رقم"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Economic Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">کد اقتصادی (فاکتور رسمی)</label>
                  <input
                    type="text"
                    value={formData.economicCode || ''}
                    onChange={(e) => setFormData({ ...formData, economicCode: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="۱۲ رقم"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* SECTION 2: CONTACT & ADDRESS */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-cyan-400 flex items-center gap-1.5">
                <Phone className="h-4 w-4" />
                ۲. اطلاعات تماس و نشانی ارسال بار
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
                {/* Mobile */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    تلفن همراه اصلی <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.phone || ''}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="مثال: 09121234567"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Tel */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">تلفن ثابت</label>
                  <input
                    type="text"
                    value={formData.tel || ''}
                    onChange={(e) => setFormData({ ...formData, tel: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="مثال: 02122019988"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">پست الکترونیکی (ایمیل)</label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    onFocus={handleFocus}
                    placeholder="info@customer.ir"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Province & City */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">استان و شهر</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={formData.province || ''}
                      onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                      placeholder="استان"
                      className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                    <input
                      type="text"
                      value={formData.city || ''}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="شهر"
                      className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                {/* Postal Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">کد پستی ۱۰ رقمی</label>
                  <input
                    type="text"
                    value={formData.postalCode || ''}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    placeholder="مثال: 1985843111"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Full Address */}
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">نشانی دقیق دفتر / فروشگاه</label>
                  <input
                    type="text"
                    value={formData.address || ''}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="تهران، خیابان ولیعصر، نرسیده به میدان تجریش، پلاک..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Delivery Address */}
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">نشانی انبار تحویل و تخلیه بار (در صورت تفاوت با دفتر)</label>
                  <input
                    type="text"
                    value={formData.deliveryAddress || ''}
                    onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                    placeholder="تهران، انبار مرکزی، خیابان رجایی، درب جنوبی تخلیه بار..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* SECTION 3: COMMERCIAL & FINANCIAL TERMS */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-amber-400 flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" />
                ۳. شرایط مالی، اعتبارسنجی و تسویه
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
                {/* Credit Limit */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">سقف اعتبار مالی (ریال)</label>
                  <input
                    type="text"
                    value={formData.creditLimit ? formatWithCommas(formData.creditLimit) : ''}
                    onChange={(e) => setFormData({ ...formData, creditLimit: parseNumber(e.target.value) })}
                    onFocus={handleFocus}
                    placeholder="مثال: 500,000,000"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-cyan-400 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Discount % */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">درصد تخفیف پیش‌فرض / توافقی</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formData.discountPercent ?? 0}
                    onChange={(e) => setFormData({ ...formData, discountPercent: parseFloat(e.target.value) || 0 })}
                    onFocus={handleFocus}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Payment Terms */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">نحوه تسویه پیش‌فرض</label>
                  <select
                    value={formData.paymentTerms || 'نقدی'}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="نقدی">نقدی (کارتخوان / حواله آنی)</option>
                    <option value="چک ۳۰ روزه">چک ۳۰ روزه</option>
                    <option value="چک ۶۰ روزه">چک ۶۰ روزه</option>
                    <option value="چک ۹۰ روزه">چک ۹۰ روزه</option>
                    <option value="اعتباری">اعتباری و دوره‌ای</option>
                  </select>
                </div>

                {/* Settlement Period Days */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">مهلت تسویه حساب (روز)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.settlementPeriodDays ?? 30}
                    onChange={(e) => setFormData({ ...formData, settlementPeriodDays: parseInt(e.target.value, 10) || 0 })}
                    onFocus={handleFocus}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Sales Agent */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">بازاریاب / کارشناس فروش</label>
                  <input
                    type="text"
                    value={formData.salesAgent || ''}
                    onChange={(e) => setFormData({ ...formData, salesAgent: e.target.value })}
                    placeholder="نام کارشناس فروش"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Accounting Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">کد حساب تفصیلی در سیستم مالی</label>
                  <input
                    type="text"
                    value={formData.accountingCode || ''}
                    onChange={(e) => setFormData({ ...formData, accountingCode: e.target.value })}
                    placeholder="مثال: 103001"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">وضعیت حساب مشتری</label>
                  <select
                    value={formData.status || 'active'}
                    onChange={(e) => {
                      const st = e.target.value as any;
                      setFormData({ 
                        ...formData, 
                        status: st, 
                        isActive: st === 'active' 
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="active">فعال (مجاز به ثبت سفارش)</option>
                    <option value="inactive">غیرفعال موقت</option>
                    <option value="blocked">مسدود (به دلیل بدهی یا چک برگشتی)</option>
                  </select>
                </div>

                {/* Block Reason (if blocked) */}
                {formData.status === 'blocked' && (
                  <div>
                    <label className="block text-[11px] font-bold text-rose-400 mb-1.5">علت مسدودسازی حساب</label>
                    <input
                      type="text"
                      value={formData.blockReason || ''}
                      onChange={(e) => setFormData({ ...formData, blockReason: e.target.value })}
                      placeholder="علت بدهی یا چک برگشتی..."
                      className="w-full px-3 py-2 bg-rose-950/30 border border-rose-500/40 rounded-xl text-xs text-rose-300 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 4: BANK ACCOUNTS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-rose-400 flex items-center gap-1.5">
                  <Banknote className="h-4 w-4" />
                  ۴. مشخصات و حساب‌های بانکی مشتری (جهت عودت وجه یا تطبیق فیش‌ها)
                </h3>
              </div>

              {/* Bank Accounts List */}
              <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 space-y-4">
                {/* Draft Account Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 p-3 bg-slate-900/90 rounded-xl border border-slate-800">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">نام بانک</label>
                    <select
                      value={draftBank.bankName}
                      onChange={(e) => setDraftBank({ ...draftBank, bankName: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-bold text-slate-200 cursor-pointer"
                    >
                      <option value="بانک ملی">بانک ملی</option>
                      <option value="بانک ملت">بانک ملت</option>
                      <option value="بانک صادرات">بانک صادرات</option>
                      <option value="بانک تجارت">بانک تجارت</option>
                      <option value="بانک سپه">بانک سپه</option>
                      <option value="بانک پاسارگاد">بانک پاسارگاد</option>
                      <option value="بانک سامان">بانک سامان</option>
                      <option value="بانک پارسیان">بانک پارسیان</option>
                      <option value="بانک کشاورزی">بانک کشاورزی</option>
                      <option value="بانک آینده">بانک آینده</option>
                      <option value="بانک رسالت">بانک قرض‌الحسنه رسالت</option>
                      <option value="سایر بانک‌ها">سایر بانک‌ها</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">نام صاحب حساب</label>
                    <input
                      type="text"
                      value={draftBank.accountHolder || ''}
                      onChange={(e) => setDraftBank({ ...draftBank, accountHolder: e.target.value })}
                      placeholder="نام شخص یا شرکت"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">شماره حساب</label>
                    <input
                      type="text"
                      value={draftBank.accountNo}
                      onChange={(e) => setDraftBank({ ...draftBank, accountNo: e.target.value })}
                      placeholder="شماره حساب"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1">شماره شبا (IR)</label>
                    <input
                      type="text"
                      value={draftBank.shaba}
                      onChange={(e) => setDraftBank({ ...draftBank, shaba: e.target.value })}
                      placeholder="IR000000000000000000000000"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200"
                    />
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-grow">
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">شماره کارت (۱۶ رقم)</label>
                      <input
                        type="text"
                        maxLength={16}
                        value={draftBank.cardNo}
                        onChange={(e) => setDraftBank({ ...draftBank, cardNo: e.target.value.replace(/\D/g, '') })}
                        placeholder="6037..."
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddBankAccount}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0"
                    >
                      + افزودن
                    </button>
                  </div>
                </div>

                {/* Added Accounts Badges */}
                {(formData.bankAccounts || []).length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {(formData.bankAccounts || []).map((b, idx) => (
                      <div key={idx} className="p-3 bg-slate-900 rounded-xl border border-slate-800 relative group">
                        <button
                          type="button"
                          onClick={() => handleRemoveBankAccount(idx)}
                          className="absolute top-2 left-2 p-1 text-slate-500 hover:text-rose-400 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <div className="font-bold text-xs text-slate-200 flex items-center gap-1 mb-1">
                          <CreditCard className="h-3.5 w-3.5 text-rose-400" />
                          {b.bankName}
                          {b.accountHolder && <span className="text-[10px] text-slate-400 font-normal">({b.accountHolder})</span>}
                        </div>
                        {b.accountNo && <div className="text-[11px] font-mono text-slate-300">حساب: {b.accountNo}</div>}
                        {b.shaba && <div className="text-[10px] font-mono text-slate-400 break-all">شبا: {b.shaba}</div>}
                        {b.cardNo && <div className="text-[10px] font-mono text-slate-400">کارت: {b.cardNo}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 5: PREFERRED PRODUCTS & NOTES */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-cyan-400 flex items-center gap-1.5">
                <Tag className="h-4 w-4" />
                ۵. محصولات پرتکرار / مورد علاقه و یادداشت‌های اعتباری
              </h3>

              <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 space-y-4">
                {/* Preferred Products Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-2">
                    محصولات منتخب و پرتکرار خریداری شده توسط این مشتری
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-2 bg-slate-900 rounded-xl border border-slate-800">
                    {activeProducts.map(prod => {
                      const isSelected = (formData.preferredProductIds || []).includes(prod.id);
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => togglePreferredProduct(prod.id)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                            isSelected
                              ? 'bg-rose-600/30 text-rose-300 border-rose-500/60 shadow-sm'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-850'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-rose-400" />}
                          {prod.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                    یادداشت‌ها، الزامات ارسال و شرایط ویژه مشتری
                  </label>
                  <textarea
                    rows={3}
                    value={formData.notes || ''}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="مثال: تحویل بار صبح‌ها قبل از ساعت ۸:۳۰ صورت گیرد / تخفیف ویژه به شرط تسویه نقدی ۴۸ ساعته..."
                    className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* FORM FOOTER ACTIONS */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setActiveSubTab('list')}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                انصراف
              </button>

              <button
                type="submit"
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-rose-600/20 cursor-pointer flex items-center gap-1.5"
              >
                <Save className="h-4 w-4" />
                {editingCustomer ? 'ذخیره تغییرات پرونده مشتری' : 'ثبت نهایی مشتری جدید'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ========================================================================= */}
      {/* 3. CUSTOMER CATEGORIES VIEW */}
      {/* ========================================================================= */}
      {activeSubTab === 'categories' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CATEGORY FORM */}
          <div className="md:col-span-1 bg-slate-900/95 p-5 rounded-3xl border border-slate-800 shadow-xl space-y-4 h-fit">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
              <Layers className="h-5 w-5 text-rose-400" />
              <h2 className="text-sm font-black text-slate-100">
                {editingCategory ? 'ویرایش گروه مشتری' : 'تعریف گروه جدید مشتریان'}
              </h2>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                  عنوان گروه مشتری <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="مثال: کافه‌ها و هتل‌ها (HoReCa)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-100 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1.5">کد گروه</label>
                <input
                  type="text"
                  value={newCatCode}
                  onChange={(e) => setNewCatCode(e.target.value)}
                  placeholder="مثال: GRP-05"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1.5">درصد تخفیف پیش‌فرض این گروه</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={newCatDiscount}
                  onChange={(e) => setNewCatDiscount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-emerald-400 font-bold focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1.5">شرایط تسویه پیش‌فرض</label>
                <select
                  value={newCatPayment}
                  onChange={(e) => setNewCatPayment(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  <option value="نقدی">نقدی</option>
                  <option value="چک ۳۰ روزه">چک ۳۰ روزه</option>
                  <option value="چک ۶۰ روزه">چک ۶۰ روزه</option>
                  <option value="چک ۹۰ روزه">چک ۹۰ روزه</option>
                  <option value="اعتباری">اعتباری</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1.5">توضیحات و مشخصات گروه</label>
                <textarea
                  rows={2}
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                  placeholder="توضیحات اختیاری..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                {editingCategory && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategory(null);
                      setNewCatName('');
                      setNewCatCode('');
                      setNewCatDiscount(0);
                      setNewCatPayment('چک ۳۰ روزه');
                      setNewCatDesc('');
                    }}
                    className="w-1/2 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                )}
                <button
                  type="submit"
                  className={`${editingCategory ? 'w-1/2' : 'w-full'} py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20 cursor-pointer flex items-center justify-center gap-1.5`}
                >
                  <Save className="h-4 w-4" />
                  {editingCategory ? 'ذخیره تغییرات' : 'ثبت گروه جدید'}
                </button>
              </div>
            </form>
          </div>

          {/* CATEGORIES TABLE */}
          <div className="md:col-span-2 bg-slate-900/95 p-5 rounded-3xl border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-sm font-black text-slate-100 flex items-center gap-2">
                <span>فهرست گروه‌های مشتریان</span>
                <span className="text-xs font-mono font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                  {toPersianDigits(categories.length)} گروه
                </span>
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-950/90 text-slate-400 text-[11px] font-bold border-b border-slate-800">
                    <th className="px-3 py-3">کد</th>
                    <th className="px-3 py-3">نام گروه</th>
                    <th className="px-3 py-3 text-center">تخفیف پیش‌فرض</th>
                    <th className="px-3 py-3 text-center">تسویه پیش‌فرض</th>
                    <th className="px-3 py-3 text-center">تعداد مشتری</th>
                    <th className="px-3 py-3 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {categories.map(cat => {
                    const count = customers.filter(c => c.categoryId === cat.id).length;
                    return (
                      <tr key={cat.id} className="hover:bg-slate-800/50 transition-colors">
                        <td className="px-3 py-3 font-mono font-bold text-slate-400">{cat.code || '-'}</td>
                        <td className="px-3 py-3">
                          <div className="font-bold text-slate-100">{cat.name}</div>
                          {cat.description && <div className="text-[10px] text-slate-500">{cat.description}</div>}
                        </td>
                        <td className="px-3 py-3 text-center font-mono font-bold text-emerald-400">
                          {toPersianDigits(cat.defaultDiscountPercent || 0)}٪
                        </td>
                        <td className="px-3 py-3 text-center text-slate-300">
                          {cat.defaultPaymentTerm || '-'}
                        </td>
                        <td className="px-3 py-3 text-center font-mono font-bold text-cyan-400">
                          {toPersianDigits(count)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategory(cat);
                                setNewCatName(cat.name);
                                setNewCatCode(cat.code || '');
                                setNewCatDiscount(cat.defaultDiscountPercent || 0);
                                setNewCatPayment(cat.defaultPaymentTerm || 'چک ۳۰ روزه');
                                setNewCatDesc(cat.description || '');
                              }}
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-all cursor-pointer"
                              title="ویرایش گروه"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-amber-400" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat)}
                              className="p-1.5 bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 rounded-lg transition-all cursor-pointer"
                              title="حذف گروه"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. CUSTOMER PROFILE CARD VIEW (MODAL / PRINT TARGET) */}
      {/* ========================================================================= */}
      {viewingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl space-y-5 text-right p-6 relative">
            <button
              type="button"
              onClick={() => setViewingCustomer(null)}
              className="absolute top-5 left-5 p-2 text-slate-400 hover:text-slate-200 bg-slate-800/80 rounded-full transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <div id="customer-card-print-target" className="space-y-5">
              {/* Header */}
              <div className="flex items-center gap-3.5 pb-4 border-b border-slate-800">
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
                  <Users className="h-7 w-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-slate-100">{viewingCustomer.name}</h2>
                    <span className="font-mono text-xs px-2.5 py-0.5 bg-rose-950 text-rose-400 border border-rose-800 rounded-full font-bold">
                      {viewingCustomer.code}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span>گروه: {categoryMap[viewingCustomer.categoryId || ''] || 'عمومی'}</span>
                    <span>•</span>
                    <span>نوع: {viewingCustomer.type}</span>
                  </div>
                </div>
              </div>

              {/* Grid of Key Info */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80">
                <div>
                  <span className="text-slate-500 block text-[10px]">مسئول خرید / رابط:</span>
                  <span className="font-bold text-slate-200">{viewingCustomer.contactPerson || '-'}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">تلفن همراه:</span>
                  <span className="font-mono font-bold text-rose-400" dir="ltr">{viewingCustomer.phone}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">تلفن ثابت:</span>
                  <span className="font-mono text-slate-200" dir="ltr">{viewingCustomer.tel || '-'}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">کد ملی / شناسه ملی:</span>
                  <span className="font-mono text-slate-200">{viewingCustomer.nationalId || '-'}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">کد اقتصادی:</span>
                  <span className="font-mono text-slate-200">{viewingCustomer.economicCode || '-'}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">کد حسابداری:</span>
                  <span className="font-mono text-slate-200">{viewingCustomer.accountingCode || '-'}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">سقف اعتبار مالی:</span>
                  <span className="font-mono font-bold text-cyan-400">{formatWithCommas(viewingCustomer.creditLimit || 0)} ریال</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">درصد تخفیف توافقی:</span>
                  <span className="font-mono font-bold text-emerald-400">{toPersianDigits(viewingCustomer.discountPercent || 0)}٪</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px]">شرایط تسویه:</span>
                  <span className="font-bold text-slate-200">{viewingCustomer.paymentTerms || 'نقدی'} ({toPersianDigits(viewingCustomer.settlementPeriodDays || 0)} روزه)</span>
                </div>
              </div>

              {/* Address */}
              <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80 space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-slate-500 block text-[10px]">نشانی پستی:</span>
                    <p className="text-slate-200 leading-relaxed">{viewingCustomer.address || 'ثبت نشده'}</p>
                  </div>
                </div>

                {viewingCustomer.deliveryAddress && (
                  <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-300">
                    <span className="text-amber-400 font-bold block mb-0.5">نشانی انبار تخلیه بار:</span>
                    {viewingCustomer.deliveryAddress}
                  </div>
                )}
              </div>

              {/* Bank Accounts */}
              {(viewingCustomer.bankAccounts || []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-300 flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-rose-400" />
                    حساب‌های بانکی
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {(viewingCustomer.bankAccounts || []).map((b, idx) => (
                      <div key={idx} className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                        <div className="font-bold text-rose-400">{b.bankName} {b.accountHolder ? `(${b.accountHolder})` : ''}</div>
                        {b.accountNo && <div className="text-[11px] font-mono text-slate-300">حساب: {b.accountNo}</div>}
                        {b.shaba && <div className="text-[10px] font-mono text-slate-400 break-all">شبا: {b.shaba}</div>}
                        {b.cardNo && <div className="text-[10px] font-mono text-slate-400">کارت: {b.cardNo}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {viewingCustomer.notes && (
                <div className="p-3 bg-amber-950/20 border border-amber-500/20 rounded-xl text-xs text-amber-300 leading-relaxed">
                  <strong className="block mb-0.5">یادداشت‌ها و شرایط ویژه:</strong>
                  {viewingCustomer.notes}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePrintProfile}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="h-4 w-4" />
                  چاپ شناسنامه
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleStartEdit(viewingCustomer);
                    setViewingCustomer(null);
                  }}
                  className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit2 className="h-4 w-4" />
                  ویرایش
                </button>
              </div>

              <button
                type="button"
                onClick={() => setViewingCustomer(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
      {copySection && (
        <CopyFromPeriodModal
          open={true}
          onClose={() => setCopySection(null)}
          db={db}
          targetPeriodId={activePeriodId}
          section={copySection}
          onUpdateDb={onUpdateDb}
        />
      )}
    </div>
  );
}
