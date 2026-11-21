/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useMemo } from 'react';
import { AppDatabase, Product, ProductSale } from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, printElement, getTodayJalali, normalizePersianString, getFiscalYearFromPeriod 
} from '../utils/persianUtils';
import { 
  FileSpreadsheet, Upload, AlertCircle, AlertTriangle, Info, BarChart3, PieChart, 
  Clock, Calendar, Sparkles, TrendingUp, HelpCircle, Check, 
  Download, Filter, RefreshCw, Layers, Award, ShieldAlert, Grid, Flame,
  Plus, Trash2, Edit3, Search, ChevronLeft, ChevronRight, ChevronDown, Users
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Persian days mapping
const FA_WEEKDAYS = [
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
  'شنبه'
];

const FA_WEEKDAYS_ORDERED = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه'
];

interface SalesAnalysisDashboardProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
  products: Product[];
  categories: any[]; // ProductCategory
  productMap: Record<string, Product>;
  initialSelectedMonth?: number;
  selectedMonth?: number | 'ALL';
  onMonthChange?: (month: number | 'ALL') => void;
  selectedYear?: number;
  onYearChange?: (year: number) => void;
  onNavigateToCategories?: () => void;
}

// Transaction item interface
interface SalesTransaction {
  id: string;
  invoiceNumber?: string; // شماره فاکتور
  customerName?: string; // مشتری/ تامین کننده
  productId: string;
  productName: string;
  productCode?: string;
  categoryId: string;
  categoryName: string;
  dateStr: string; // e.g. 1405/03/12
  dayOfMonth: number; // 1-31
  weekday: string; // e.g. شنبه
  hour: number; // 0-23
  qtySold: number;
  unitPrice?: number;
  discount?: number;
  salesAmount: number;
  month?: number;
  year?: number;
}

// Jalali-to-Gregorian converter to find day of week
function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  const jy2 = jy - 979;
  const jm2 = jm - 1;
  const jd2 = jd - 1;

  let j_day_no = 365 * jy2 + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4);
  for (let i = 0; i < jm2; ++i) {
    j_day_no += (i < 6) ? 31 : 30;
  }
  j_day_no += jd2;

  let g_day_no = j_day_no + 79;
  let g_y = 1600 + 400 * Math.floor(g_day_no / 146097);
  g_day_no = g_day_no % 146097;

  let leap = 1;
  if (g_day_no >= 36525) {
    g_day_no--;
    g_y += 100 * Math.floor(g_day_no / 36524);
    g_day_no = g_day_no % 36524;

    if (g_day_no >= 365) {
      g_day_no++;
    } else {
      leap = 0;
    }
  }

  g_y += 4 * Math.floor(g_day_no / 1461);
  g_day_no = g_day_no % 1461;

  if (g_day_no >= 366) {
    leap = 0;
    g_day_no--;
    g_y += Math.floor(g_day_no / 365);
    g_day_no = g_day_no % 365;
  }

  const Sal_G = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (leap === 1) Sal_G[2] = 29;

  let i = 1;
  for (i = 1; i <= 12; ++i) {
    if (g_day_no < Sal_G[i]) break;
    g_day_no -= Sal_G[i];
  }
  const g_m = i;
  const g_d = g_day_no + 1;

  return new Date(g_y, g_m - 1, g_d);
}

function getPersianWeekdayOfDate(dateStr: string): string {
  try {
    const parts = dateStr.replace(/-/g, '/').split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);

      if (year > 1300 && year < 1500 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const gregDate = jalaliToGregorian(year, month, day);
        const dayIdx = gregDate.getDay();
        return FA_WEEKDAYS[dayIdx];
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const dayIdx = d.getDay();
      return FA_WEEKDAYS[dayIdx];
    }
  } catch (err) {
    console.error('Error parsing weekday', err);
  }
  return 'شنبه';
}

// Mock customer lists
const MOCK_CUSTOMERS = [
  'شرکت بازرگانی دریا',
  'پک پخش گاتان',
  'هایپر مارکت آریا',
  'قنادی بهار',
  'کافه رستوران ونوس',
  'آقای محمد رضایی',
  'خانم سارا کریمی',
  'احمدی (پخش البرز)',
  'فروشگاه تک بن',
  'صنایع غذایی شفق'
];

// Generates dynamic mock data with peak hours, product and category trends grouped by invoices
function generateMockSalesTransactions(productsList: Product[], categoriesList: any[]): SalesTransaction[] {
  if (productsList.length === 0) return [];

  const catMap: Record<string, string> = {};
  categoriesList.forEach(c => {
    catMap[c.id] = c.name;
  });

  const transactions: SalesTransaction[] = [];
  const totalDays = 30;
  const targetYear = 1405;
  const targetMonth = 3; // June-equivalent (Khordad)

  // Weighted hourly distribution (peak afternoon and evening hours)
  const getWeightedHour = (): number => {
    const r = Math.random();
    if (r < 0.04) return Math.floor(Math.random() * 8); 
    if (r < 0.16) return 8 + Math.floor(Math.random() * 3); 
    if (r < 0.42) return 11 + Math.floor(Math.random() * 3); // 11-13 (Lunch spike)
    if (r < 0.54) return 14 + Math.floor(Math.random() * 3); 
    if (r < 0.92) return 17 + Math.floor(Math.random() * 5); // 17-21 (Evening rush)
    return 22 + Math.floor(Math.random() * 2); 
  };

  const invoiceCount = 140; // Total invoices
  for (let invIdx = 0; invIdx < invoiceCount; invIdx++) {
    const invoiceNum = `F-100${100 + invIdx}`;
    const customerName = MOCK_CUSTOMERS[invIdx % MOCK_CUSTOMERS.length];
    const day = Math.floor(Math.random() * totalDays) + 1;
    const hour = getWeightedHour();
    const dateStr = `${targetYear}/0${targetMonth}/${day < 10 ? '0' + day : day}`;
    const weekday = getPersianWeekdayOfDate(dateStr);

    // Random number of items in this invoice (1 to 4 items)
    const itemsCount = Math.floor(Math.random() * 3) + 1;
    const selectedProducts: Product[] = [];
    
    // Choose unique products for this invoice
    for (let k = 0; k < itemsCount; k++) {
      let prod = productsList[Math.floor(Math.random() * productsList.length)];
      if (!selectedProducts.some(p => p.id === prod.id)) {
        selectedProducts.push(prod);
      }
    }

    selectedProducts.forEach(prod => {
      let weekdayMultiplier = 1.0;
      if (weekday === 'جمعه') weekdayMultiplier = 0.55; 
      if (weekday === 'پنج‌شنبه') weekdayMultiplier = 1.35; 
      if (weekday === 'شنبه') weekdayMultiplier = 1.15;

      // Organic multiplier to simulate peak hours specifically by weekday
      let peakHourOfProduct = 12;
      if (prod.name.includes('آرد') || prod.name.includes('خمیر')) {
        peakHourOfProduct = 10;
      } else if (prod.name.includes('کراوا') || prod.name.includes('پیراش')) {
        peakHourOfProduct = 18;
      }

      if (Math.abs(hour - peakHourOfProduct) <= 1) {
        weekdayMultiplier *= 1.4;
      }

      const baseQty = Math.floor(Math.random() * 8) + 1; // 1 to 8 quantity per item is more realistic for retail invoices
      const qtySold = Math.max(1, Math.round(baseQty * weekdayMultiplier));
      const salesAmount = qtySold * (prod.salePrice || 75000);

      const catId = prod.categoryId || '';
      const catName = catMap[catId] || 'دسته عمومی';

      transactions.push({
        id: `mock-tx-${invIdx}-${prod.id}-${Math.random().toString(36).substr(2, 4)}`,
        invoiceNumber: invoiceNum,
        customerName,
        productId: prod.id,
        productName: prod.name,
        categoryId: catId,
        categoryName: catName,
        dateStr,
        dayOfMonth: day,
        weekday,
        hour,
        qtySold,
        salesAmount
      });
    });
  }

  return transactions.sort((a, b) => {
    const dateComp = a.dateStr.localeCompare(b.dateStr);
    if (dateComp !== 0) return dateComp;
    return a.hour - b.hour;
  });
}

export default function SalesAnalysisDashboard({
  db,
  onUpdateDb,
  activePeriodId,
  products,
  categories,
  productMap,
  initialSelectedMonth,
  selectedMonth: propSelectedMonth,
  onMonthChange,
  selectedYear: propSelectedYear,
  onNavigateToCategories
}: SalesAnalysisDashboardProps) {

  const PERSIAN_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  const UNASSIGNED_DEPT_ID = '__UNASSIGNED__';
  const UNASSIGNED_DEPT_NAME = 'تخصیص‌نیافته (نیازمند تعیین دپارتمان)';

  const uniqueCategories = useMemo(() => {
    const seen = new Set<string>();
    return (categories || []).filter(c => {
      if (!c?.id || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [categories]);

  const rawPeriodDepartments = useMemo(() => {
    const raw = (db.departments || []).filter(d => d.periodId === activePeriodId);
    const seen = new Set<string>();
    return raw.filter(d => {
      if (!d?.id || seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }, [db.departments, activePeriodId]);

  const periodDepartments = useMemo(() => {
    return rawPeriodDepartments.length > 0 ? rawPeriodDepartments : uniqueCategories;
  }, [rawPeriodDepartments, uniqueCategories]);

  const deptByIdMap = useMemo(() => {
    const map: Record<string, { id: string; name: string }> = {};
    periodDepartments.forEach(d => { map[d.id] = { id: d.id, name: d.name }; });
    return map;
  }, [periodDepartments]);

  const catByIdMap = useMemo(() => {
    const map: Record<string, any> = {};
    uniqueCategories.forEach(c => { map[c.id] = c; });
    return map;
  }, [uniqueCategories]);

  const catByNormNameMap = useMemo(() => {
    const map: Record<string, any> = {};
    uniqueCategories.forEach(c => {
      const n = normalizePersianString(c.name || '');
      if (n) map[n] = c;
    });
    return map;
  }, [uniqueCategories]);

  const prodByIdMap = useMemo(() => {
    const map: Record<string, Product> = {};
    products.forEach(p => { map[p.id] = p; });
    return map;
  }, [products]);

  const resolveProductDepartment = React.useCallback((prod?: Product): { id: string; name: string; isUnassigned: boolean; sourceCatName?: string } => {
    if (!prod) {
      return { id: UNASSIGNED_DEPT_ID, name: UNASSIGNED_DEPT_NAME, isUnassigned: true, sourceCatName: 'بدون محصول' };
    }
    const catObj = prod.categoryId ? catByIdMap[prod.categoryId] : undefined;
    if (catObj) {
      if (catObj.departmentId && deptByIdMap[catObj.departmentId]) {
        return { ...deptByIdMap[catObj.departmentId], isUnassigned: false };
      }
      if (rawPeriodDepartments.length === 0 && deptByIdMap[catObj.id]) {
        return { ...deptByIdMap[catObj.id], isUnassigned: false };
      }
      return { id: UNASSIGNED_DEPT_ID, name: UNASSIGNED_DEPT_NAME, isUnassigned: true, sourceCatName: catObj.name };
    }
    if (prod.categoryId && deptByIdMap[prod.categoryId]) {
      return { ...deptByIdMap[prod.categoryId], isUnassigned: false };
    }
    return { id: UNASSIGNED_DEPT_ID, name: UNASSIGNED_DEPT_NAME, isUnassigned: true, sourceCatName: 'بدون دسته‌بندی' };
  }, [catByIdMap, deptByIdMap, rawPeriodDepartments.length]);

  const resolveTxDepartment = React.useCallback((tx: SalesTransaction): { id: string; name: string; isUnassigned: boolean; sourceCatName?: string } => {
    const prod = tx.productId ? prodByIdMap[tx.productId] : undefined;
    const txCatById = tx.categoryId ? catByIdMap[tx.categoryId] : undefined;
    const txNormName = tx.categoryName ? normalizePersianString(tx.categoryName) : '';
    const txCatByName = txNormName ? catByNormNameMap[txNormName] : undefined;
    const prodCat = prod?.categoryId ? catByIdMap[prod.categoryId] : undefined;

    const resolvedCat = txCatById || txCatByName || prodCat;
    if (resolvedCat) {
      if (resolvedCat.departmentId && deptByIdMap[resolvedCat.departmentId]) {
        return { ...deptByIdMap[resolvedCat.departmentId], isUnassigned: false };
      }
      if (rawPeriodDepartments.length === 0 && deptByIdMap[resolvedCat.id]) {
        return { ...deptByIdMap[resolvedCat.id], isUnassigned: false };
      }
      return {
        id: UNASSIGNED_DEPT_ID,
        name: UNASSIGNED_DEPT_NAME,
        isUnassigned: true,
        sourceCatName: resolvedCat.name || tx.categoryName
      };
    }

    if (tx.categoryId && deptByIdMap[tx.categoryId]) {
      return { ...deptByIdMap[tx.categoryId], isUnassigned: false };
    }
    if (prod?.categoryId && deptByIdMap[prod.categoryId]) {
      return { ...deptByIdMap[prod.categoryId], isUnassigned: false };
    }

    const cleanedSource = (tx.categoryName || '').trim();
    return {
      id: UNASSIGNED_DEPT_ID,
      name: UNASSIGNED_DEPT_NAME,
      isUnassigned: true,
      sourceCatName: cleanedSource && cleanedSource !== 'دسته عمومی' ? cleanedSource : 'بدون دسته‌بندی'
    };
  }, [prodByIdMap, catByIdMap, catByNormNameMap, deptByIdMap, rawPeriodDepartments.length]);

  // Fiscal year is determined automatically based on Time and Fiscal Periods Management
  const activePeriod = db.periods?.find(p => p.id === activePeriodId);
  const activeYear = propSelectedYear !== undefined 
    ? propSelectedYear 
    : getFiscalYearFromPeriod(activePeriod, activePeriodId);

  const [internalMonth, setInternalMonth] = useState<number | 'ALL'>(() => {
    if (propSelectedMonth !== undefined) return propSelectedMonth;
    return (initialSelectedMonth && initialSelectedMonth >= 1 && initialSelectedMonth <= 12) ? initialSelectedMonth : 1;
  });
  const [viewAllYear, setViewAllYear] = useState(false);

  React.useEffect(() => {
    if (propSelectedMonth !== undefined) {
      setInternalMonth(propSelectedMonth);
      if (propSelectedMonth !== 'ALL') {
        setViewAllYear(false);
      }
    }
  }, [propSelectedMonth]);

  const activeMonth = viewAllYear ? 'ALL' : (propSelectedMonth !== undefined ? propSelectedMonth : internalMonth);

  const handleMonthSelect = (m: number | 'ALL') => {
    if (m === 'ALL') {
      setViewAllYear(true);
      setInternalMonth('ALL');
    } else {
      setViewAllYear(false);
      setInternalMonth(m);
    }
    if (onMonthChange) onMonthChange(m);
  };

  const defaultMockData = useMemo(() => {
    // Only generate mock transactions for the initial/default period '1405-01'
    if (activePeriodId === '1405-01') {
      return generateMockSalesTransactions(products, categories);
    }
    return [];
  }, [products, categories, activePeriodId]);

  const [transactions, setTransactions] = useState<SalesTransaction[]>(defaultMockData);

  const periodTransactions = useMemo(() => {
    let list = transactions.filter(tx => tx.periodId === activePeriodId);

    // Filter by activeYear
    if (activeYear) {
      list = list.filter(tx => {
        if ((tx as any).year !== undefined && Number((tx as any).year) === Number(activeYear)) {
          return true;
        }
        if (tx.dateStr) {
          const parts = tx.dateStr.replace(/-/g, '/').split('/');
          if (parts.length >= 1) {
            const y = parseInt(parts[0], 10);
            if (!isNaN(y)) return y === Number(activeYear);
          }
        }
        return true;
      });
    }

    // Filter by activeMonth
    if (activeMonth !== 'ALL') {
      list = list.filter(tx => {
        if ((tx as any).month !== undefined && Number((tx as any).month) === Number(activeMonth)) {
          return true;
        }
        if (tx.dateStr) {
          const parts = tx.dateStr.replace(/-/g, '/').split('/');
          if (parts.length >= 2) {
            const m = parseInt(parts[1], 10);
            if (!isNaN(m)) return m === Number(activeMonth);
          }
        }
        return false;
      });
    }
    return list;
  }, [transactions, activePeriodId, activeMonth, activeYear]);

  // Compute 12-month dashboard statistics
  const monthlyDashboardStats = useMemo(() => {
    const stats: Record<number, { count: number; totalAmount: number; totalQty: number; invoiceCount: number }> = {};
    for (let m = 1; m <= 12; m++) {
      stats[m] = { count: 0, totalAmount: 0, totalQty: 0, invoiceCount: 0 };
    }

    const yearTxs = transactions.filter(tx => {
      if (tx.periodId !== activePeriodId) return false;
      if ((tx as any).year !== undefined && Number((tx as any).year) === Number(activeYear)) return true;
      if (tx.dateStr) {
        const parts = tx.dateStr.replace(/-/g, '/').split('/');
        if (parts.length >= 1) {
          const y = parseInt(parts[0], 10);
          if (!isNaN(y)) return y === Number(activeYear);
        }
      }
      return true;
    });

    const monthInvoices: Record<number, Set<string>> = {};
    for (let m = 1; m <= 12; m++) {
      monthInvoices[m] = new Set<string>();
    }

    yearTxs.forEach(tx => {
      let m = 0;
      if ((tx as any).month !== undefined) {
        m = Number((tx as any).month);
      } else if (tx.dateStr) {
        const parts = tx.dateStr.replace(/-/g, '/').split('/');
        if (parts.length >= 2) {
          m = parseInt(parts[1], 10);
        }
      }
      if (m >= 1 && m <= 12) {
        stats[m].count += 1;
        stats[m].totalAmount += (tx.salesAmount || 0);
        stats[m].totalQty += (tx.qtySold || 0);
        const invKey = tx.invoiceNumber ? tx.invoiceNumber.trim() : `inv-${tx.dateStr}-${tx.hour}-${tx.customerName || ''}`;
        monthInvoices[m].add(invKey);
      }
    });

    for (let m = 1; m <= 12; m++) {
      stats[m].invoiceCount = monthInvoices[m].size;
    }

    return stats;
  }, [transactions, activePeriodId, activeYear]);

  // Load & Sync Transactions from/to the persistent shared AppDatabase
  React.useEffect(() => {
    const existing = db.salesTransactions?.filter(tx => tx.periodId === activePeriodId) || [];
    if (existing.length > 0) {
      const isDifferent = transactions.length !== existing.length || 
                          transactions.some((tx, idx) => tx.id !== existing[idx]?.id || tx.salesAmount !== existing[idx]?.salesAmount);
      if (isDifferent) {
        setTransactions(existing);
      }
    } else {
      const isDifferent = transactions.length !== defaultMockData.length ||
                          transactions.some((tx, idx) => tx.id !== defaultMockData[idx]?.id);
      if (isDifferent) {
        setTransactions(defaultMockData);
      }
    }
  }, [activePeriodId, db.salesTransactions, defaultMockData]);

  // Unified callback to update transactions locally and propagate to parent DB
  const updateTransactions = (newTxs: SalesTransaction[]) => {
    setTransactions(newTxs);
    const existingOthers = db.salesTransactions?.filter(tx => tx.periodId !== activePeriodId) || [];
    onUpdateDb({
      ...db,
      salesTransactions: [...existingOthers, ...newTxs.map(t => ({ ...t, periodId: activePeriodId }))] as any[]
    });
  };
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<'overview' | 'daily' | 'weekly' | 'hourly' | 'heatmap' | 'peakHours' | 'transactionsList'>('overview');
  const [selectedDailyDay, setSelectedDailyDay] = useState<number | null>(null);
  const [selectedHourlyHour, setSelectedHourlyHour] = useState<number | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [selectedProductIdFilter, setSelectedProductIdFilter] = useState<string>('ALL');

  // Searchable product selection state
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const productDropdownOptions = useMemo(() => {
    const list = [
      { id: 'ALL', name: 'همه محصولات' },
      ...products
    ];
    if (!productSearchQuery) return list;
    
    const query = normalizePersianString(productSearchQuery.trim().toLowerCase());
    return list.filter(p => {
      const normalizedName = normalizePersianString(p.name.toLowerCase());
      const rawCode = (p as any).code;
      const normalizedCode = rawCode ? normalizePersianString(rawCode.toLowerCase()) : '';
      return normalizedName.includes(query) || normalizedCode.includes(query);
    });
  }, [products, productSearchQuery]);

  const selectedProductLabel = useMemo(() => {
    if (selectedProductIdFilter === 'ALL') return 'همه محصولات';
    return products.find(p => p.id === selectedProductIdFilter)?.name || 'همه محصولات';
  }, [selectedProductIdFilter, products]);

  const productSelectRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (productSelectRef.current && !productSelectRef.current.contains(event.target as Node)) {
        setProductDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Transaction manager state variables
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Form state for adding sound transactions
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInvoiceNumber, setNewInvoiceNumber] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('مشتری عمومی');
  const [newProductId, setNewProductId] = useState(products[0]?.id || '');
  const [newDateStr, setNewDateStr] = useState('1405/03/15');
  const [newHour, setNewHour] = useState(12);
  const [newQty, setNewQty] = useState(1);
  const [newAmount, setNewAmount] = useState(0);

  // Auto-set price when product is selected
  const handleProductSelectionChange = (prodId: string) => {
    setNewProductId(prodId);
    const prod = products.find(p => p.id === prodId);
    if (prod) {
      const price = prod.salePrice || 75000;
      setNewAmount(price * newQty);
    }
  };

  const handleQtySelectionChange = (qty: number) => {
    setNewQty(qty);
    const prod = products.find(p => p.id === newProductId);
    if (prod) {
      const price = prod.salePrice || 75000;
      setNewAmount(price * qty);
    }
  };

  // State for inline edit mode
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editInvoiceNum, setEditInvoiceNum] = useState('');
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editDateStr, setEditDateStr] = useState('');
  const [editHour, setEditHour] = useState(12);
  const [editQty, setEditQty] = useState(1);
  const [editAmount, setEditAmount] = useState(0);

  // Export transactions as Excel matching input structure
  const handleExportExcel = () => {
    try {
      const exportData = periodTransactions.map(tx => {
        const prod = products.find(p => p.id === tx.productId);
        const pCode = prod?.code || 'P100';
        return {
          'شماره فاکتور': tx.invoiceNumber || `F-${tx.dayOfMonth}-${tx.hour}`,
          'مشتری/ تامین کننده': tx.customerName || 'مشتری عمومی',
          'کد کالا': pCode,
          'تاریخ': tx.dateStr,
          'نام کالا': tx.productName,
          'گروه کالا': tx.categoryName,
          'ساعت': String(tx.hour),
          'تعداد فروش': tx.qtySold,
          'مبلغ فروش': tx.salesAmount
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SalesData');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true });
      const bytes = wbout instanceof Uint8Array ? wbout : new Uint8Array(wbout);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `دفتر_ثبت_فروش_ماهانه_${activePeriodId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting Excel', err);
    }
  };

  // Interactive methods for Transactions office
  const handleDeleteTransaction = (id: string) => {
    const updated = transactions.filter(t => t.id !== id);
    updateTransactions(updated);
    // Reset page if bounds exceeded
    setCurrentPage(p => Math.min(p, Math.ceil((updated.length) / itemsPerPage) || 1));
  };

  const handleStartEditRow = (tx: SalesTransaction) => {
    setEditingTxId(tx.id);
    setEditInvoiceNum(tx.invoiceNumber || '');
    setEditCustomerName(tx.customerName || 'مشتری عمومی');
    setEditDateStr(tx.dateStr);
    setEditHour(tx.hour);
    setEditQty(tx.qtySold);
    setEditAmount(tx.salesAmount);
  };

  const handleSaveEditRow = (id: string) => {
    if (!editInvoiceNum.trim()) {
      alert('لطفاً شماره فاکتور معتبر وارد کنید.');
      return;
    }
    const updated = transactions.map(t => {
      if (t.id === id) {
        const parts = editDateStr.split('/');
        const dayOfMonth = parts.length === 3 ? (parseInt(parts[2], 10) || t.dayOfMonth) : t.dayOfMonth;
        const weekdayIndex = dayOfMonth % 7;
        const weekday = FA_WEEKDAYS_ORDERED[weekdayIndex] || FA_WEEKDAYS_ORDERED[0];

        return {
          ...t,
          invoiceNumber: editInvoiceNum,
          customerName: editCustomerName,
          dateStr: editDateStr,
          hour: editHour,
          dayOfMonth,
          weekday,
          qtySold: editQty,
          salesAmount: editAmount
        };
      }
      return t;
    });
    updateTransactions(updated);
    setEditingTxId(null);
  };

  const handleAddNewTransaction = () => {
    if (!newInvoiceNumber.trim()) {
      alert('لطفاً شماره فاکتور را مشخص نمایید.');
      return;
    }

    const prod = products.find(p => p.id === newProductId);
    if (!prod) {
      alert('کالا یافت نشد.');
      return;
    }

    const parts = newDateStr.split('/');
    const dayOfMonth = parts.length === 3 ? (parseInt(parts[2], 10) || 15) : 15;
    const weekdayIndex = dayOfMonth % 7;
    const weekday = FA_WEEKDAYS_ORDERED[weekdayIndex] || FA_WEEKDAYS_ORDERED[0];

    const newTx: SalesTransaction = {
      id: Math.random().toString(36).substring(2, 9),
      invoiceNumber: newInvoiceNumber,
      customerName: newCustomerName,
      productId: prod.id,
      productName: prod.name,
      categoryId: prod.categoryId,
      categoryName: categories.find(c => c.id === prod.categoryId)?.name || 'دسته عمومی',
      dateStr: newDateStr,
      dayOfMonth,
      weekday,
      hour: newHour,
      qtySold: newQty,
      salesAmount: newAmount
    };

    updateTransactions([newTx, ...transactions]);
    setNewInvoiceNumber('');
    setNewCustomerName('مشتری عمومی');
    setShowAddForm(false);
  };

  // Peak Hour interactive sub-selectors
  const [peakHoursViewType, setPeakHoursViewType] = useState<'category' | 'product'>('category');
  const [selectedPeakCategoryId, setSelectedPeakCategoryId] = useState<string>(periodDepartments[0]?.id || 'ALL');
  const [selectedPeakProductId, setSelectedPeakProductId] = useState<string>(products[0]?.id || 'ALL');

  // Drag-and-drop file state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });

  const handleResetToMock = () => {
    updateTransactions(defaultMockData);
    setUploadStatus({
      type: 'success',
      message: 'داده‌های شبیه‌سازی شده تراکنش‌های روزانه کارگاه بارگذاری و مجدداً جایگزین گردید.'
    });
  };

  const handleDownloadTemplate = () => {
    try {
      const templateData = [
        {
          'شماره فاکتور': 'INV-1001',
          'مشتری/ تامین کننده': 'پک پخش گاتان',
          'کد کالا': products[0]?.code || 'P101',
          'تاریخ': '1405/03/15',
          'نام کالا': products[0]?.name || 'محصول نمونه ۱',
          'گروه کالا': categories.find(c => c.id === products[0]?.categoryId)?.name || 'دسته عمومی',
          'ساعت': '12',
          'تعداد فروش': 10,
          'مبلغ فروش': (products[0]?.salePrice || 100000) * 10
        },
        {
          'شماره فاکتور': 'INV-1001', // کالا دوم فاکتور اول
          'مشتری/ تامین کننده': 'پک پخش گاتان',
          'کد کالا': products[1]?.code || 'P102',
          'تاریخ': '1405/03/15',
          'نام کالا': products[1]?.name || 'محصول نمونه ۲',
          'گروه کالا': categories.find(c => c.id === products[1]?.categoryId)?.name || 'دسته عمومی',
          'ساعت': '12',
          'تعداد فروش': 3,
          'مبلغ فروش': (products[1]?.salePrice || 80000) * 3
        },
        ...products.slice(2, 5).map((p, idx) => ({
          'شماره فاکتور': `INV-100${idx + 2}`,
          'مشتری/ تامین کننده': MOCK_CUSTOMERS[idx % MOCK_CUSTOMERS.length],
          'کد کالا': p.code || `P10${idx + 3}`,
          'تاریخ': '1405/03/25',
          'نام کالا': p.name,
          'گروه کالا': categories.find(c => c.id === p.categoryId)?.name || 'دسته عمومی',
          'ساعت': String(15 + idx),
          'تعداد فروش': 5,
          'مبلغ فروش': (p.salePrice || 120000) * 5
        }))
      ];

      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SalesData');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `قالب_ثبت_تراکنشی_فروش_ماهانه.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading template', err);
    }
  };

  const parseExcelOrCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawJson = XLSX.utils.sheet_to_json<any>(worksheet);

        if (rawJson.length === 0) {
          setUploadStatus({ type: 'error', message: 'ساختار اکسل و محتوای ستون‌ها خالی است.' });
          return;
        }

        const catMap: Record<string, string> = {};
        categories.forEach(c => { catMap[c.id] = c.name; });

        const parsedTxs: SalesTransaction[] = [];
        let unmappedCount = 0;

        rawJson.forEach((row: any, rIdx: number) => {
          let rawInvoiceNumber = '';
          let rawCustomer = '';
          let rawCode = '';
          let rawName = '';
          let rawCategory = '';
          let rawDate = '';
          let rawHour = 12;
          let rawQty = 0;
          let rawAmount = 0;

          Object.keys(row).forEach(key => {
            const kClean = key.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
            const kLower = kClean.toLowerCase();
            const val = String(row[key] || '').trim();

            const isGroup = kLower.includes('گروه') || kLower.includes('دسته') || kLower.includes('group') || kLower.includes('category');
            const isCode = kLower.includes('کد') || kLower.includes('كد') || kLower.includes('code') || kLower.includes('شناسه');

            if (kLower.includes('فاکتور') || kLower.includes('فاكتور') || kLower.includes('invoice') || kLower.includes('bill') || kLower.includes('inv_') || kLower.includes('f_')) {
              rawInvoiceNumber = val;
            } else if (kLower.includes('مشتری') || kLower.includes('مشتري') || kLower.includes('تامین کننده') || kLower.includes('تامين كننده') || kLower.includes('customer') || kLower.includes('supplier')) {
              rawCustomer = val;
            } else if (isCode) {
              rawCode = val;
            } else if (isGroup) {
              rawCategory = val;
            } else if ((kLower.includes('نام') || kLower.includes('کالا') || kLower.includes('كالا') || kLower.includes('محصول') || kLower.includes('name')) && !isGroup && !isCode) {
              rawName = val;
            } else if (kLower.includes('تاریخ') || kLower.includes('تاريخ') || kLower.includes('date')) {
              rawDate = val;
            } else if (kLower.includes('ساعت') || kLower.includes('زمان') || kLower.includes('hour') || kLower.includes('time')) {
              if (val.includes(':')) {
                rawHour = parseInt(val.split(':')[0], 10) || 12;
              } else {
                rawHour = parseInt(val, 10) || 12;
              }
            } else if (kLower.includes('تعداد') || kLower.includes('مقدار') || kLower.includes('qty')) {
              rawQty = parseFloat(val) || 0;
            } else if (kLower.includes('مبلغ') || kLower.includes('قیمت') || kLower.includes('قيمت') || kLower.includes('amount') || kLower.includes('کل') || kLower.includes('كل')) {
              rawAmount = parseFloat(val) || 0;
            }
          });

          // Match catalog product using normalized strings
          const normRawName = normalizePersianString(rawName);
          const normRawCode = normalizePersianString(rawCode || '');

          let matched = products.find(p => {
            const normPName = normalizePersianString(p.name);
            const normPCode = normalizePersianString(p.code || '');
            const normPAccount = normalizePersianString(p.accountId || '');
            return (normRawCode && (normPCode === normRawCode || normPAccount === normRawCode)) ||
                   (normRawName && normPName === normRawName);
          });

          if (!matched && normRawName) {
            matched = products.find(p => {
              const normPName = normalizePersianString(p.name);
              return normPName.includes(normRawName) || normRawName.includes(normPName);
            });
          }

          const prodId = matched?.id || `virtual-${rawCode || 'unknown'}`;
          const prodName = matched?.name || rawName || `کالای ثبت‌نشده (${rawCode})`;
          const catId = matched?.categoryId || '';
          
          const catName = (rawCategory || catMap[catId] || 'دسته عمومی').trim();
          const normCatName = normalizePersianString(catName);
          let matchedCat = categories.find(c => normalizePersianString(c.name) === normCatName);
          const finalCatId = matchedCat?.id || (rawCategory ? `virtual-cat-${rawCategory}` : catId || 'other');

          if (!matched) unmappedCount++;

          let cleanDate = rawDate || '1405/03/15';
          cleanDate = cleanDate.replace(/-/g, '/');

          let dayOfM = 15;
          const parts = cleanDate.split('/');
          if (parts.length === 3) {
            dayOfM = parseInt(parts[2], 10) || 15;
          }

          parsedTxs.push({
            id: `imported-${rIdx}-${Math.random().toString(36).substr(2, 4)}`,
            invoiceNumber: rawInvoiceNumber || undefined,
            customerName: rawCustomer || 'مشتری عمومی',
            productId: prodId,
            productName: prodName,
            productCode: matched?.code || rawCode || '',
            categoryId: finalCatId,
            categoryName: catName,
            dateStr: cleanDate,
            dayOfMonth: dayOfM,
            weekday: getPersianWeekdayOfDate(cleanDate),
            hour: Math.min(23, Math.max(0, rawHour)),
            qtySold: rawQty || 1,
            unitPrice: matched?.salePrice || (rawQty > 0 ? Math.round(rawAmount / rawQty) : 100000),
            discount: 0,
            salesAmount: rawAmount || ((rawQty || 1) * (matched?.salePrice || 100000))
          });
        });

        updateTransactions(parsedTxs);
        setUploadStatus({
          type: 'success',
          message: `تعداد ${toPersianDigits(parsedTxs.length)} تراکنش معاملاتی ثبت گردید. ${unmappedCount > 0 ? `(${toPersianDigits(unmappedCount)} ردیف کالا به صورت مجازی اضافه شد)` : ''}`
        });
      } catch (err) {
        console.error(err);
        setUploadStatus({ type: 'error', message: 'خطا در مدل پارس کردن اطلاعات فایل اکسل.' });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      parseExcelOrCsvFile(e.target.files[0]);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      parseExcelOrCsvFile(e.dataTransfer.files[0]);
    }
  };

  // Submit to actual system Monthly Period ProductSale array
  const handleApplyToSystemMonthlyRecords = () => {
    try {
      const parts = (activePeriodId || '').split('-');
      const defaultYear = parts.length >= 1 ? parseInt(parts[0], 10) || 1403 : 1403;
      const defaultMonth = (activeMonth !== undefined && activeMonth !== 'ALL') ? Number(activeMonth) : (parts.length >= 2 ? parseInt(parts[1], 10) || 1 : 1);

      const aggByProdMonth: Record<string, { productId: string; year: number; month: number; qty: number; amount: number }> = {};
      transactions.forEach(tx => {
        if (tx.productId && !tx.productId.startsWith('virtual-')) {
          const txYear = tx.year || defaultYear;
          const txMonth = (tx as any).month !== undefined ? Number((tx as any).month) : defaultMonth;
          const key = `${tx.productId}_${txYear}_${txMonth}`;
          if (!aggByProdMonth[key]) {
            aggByProdMonth[key] = { productId: tx.productId, year: txYear, month: txMonth, qty: 0, amount: 0 };
          }
          aggByProdMonth[key].qty += tx.qtySold;
          aggByProdMonth[key].amount += tx.salesAmount;
        }
      });

      const affectedYearMonths = new Set(Object.values(aggByProdMonth).map(a => `${a.year}_${a.month}`));
      if (affectedYearMonths.size === 0) {
        affectedYearMonths.add(`${defaultYear}_${defaultMonth}`);
      }

      const existingOtherSales = db.productSales.filter(s => {
        if (s.periodId !== activePeriodId) return true;
        const sYear = s.year || defaultYear;
        const sMonth = s.month !== undefined ? Number(s.month) : defaultMonth;
        return !affectedYearMonths.has(`${sYear}_${sMonth}`);
      });

      const newPeriodSales: ProductSale[] = Object.values(aggByProdMonth).map((item, idx) => {
        const prod = products.find(p => p.id === item.productId);
        const qty = item.qty;
        const netAmount = item.amount;
        const preAmount = qty * (prod?.salePrice || 0);

        return {
          id: `ps-${activePeriodId}-${item.year}-${item.month}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          salesPeriodId: activePeriodId,
          periodId: activePeriodId,
          productId: item.productId,
          qtySold: qty,
          discount: Math.max(0, preAmount - netAmount),
          preDiscountAmount: preAmount > 0 ? preAmount : netAmount,
          netSalesAmount: netAmount,
          month: item.month,
          year: item.year
        };
      });

      onUpdateDb({
        ...db,
        productSales: [...existingOtherSales, ...newPeriodSales]
      });

      setUploadStatus({
        type: 'success',
        message: `تعداد ${toPersianDigits(newPeriodSales.length)} ردیف فروش تجمعی مستقیماً در دوره مالی همگام‌سازی و اعمال شد.`
      });
    } catch (err) {
      console.error(err);
      setUploadStatus({ type: 'error', message: 'خطا در ادغام با دیتابیس مالی.' });
    }
  };

  // ==========================================
  // REAL-TIME ANALYTIC PIPELINES
  // ==========================================

  // Persian Today Date calculations
  const todayJalaliStr = getTodayJalali(); // e.g. "1405/03/25"

  // Get fallback / most recent day with sales
  const lastActiveDateStr = useMemo(() => {
    const dates = [...new Set(periodTransactions.map(tx => tx.dateStr))].sort();
    return dates[dates.length - 1] || todayJalaliStr;
  }, [periodTransactions, todayJalaliStr]);

  const activeTodayDateUsed = useMemo(() => {
    const hasToday = periodTransactions.some(tx => tx.dateStr === todayJalaliStr);
    return hasToday ? todayJalaliStr : lastActiveDateStr;
  }, [periodTransactions, todayJalaliStr, lastActiveDateStr]);

  // Helper to extract a normalized real invoice number or return null if it is missing or is placeholder like "ـ"
  const getCleanInvoiceNumber = (invNum?: string): string | null => {
    if (!invNum) return null;
    let clean = invNum.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    if (!clean || clean === 'ـ' || clean === '-' || clean.toLowerCase() === 'null' || clean.toLowerCase() === 'undefined') {
      return null;
    }
    return clean;
  };

  // TODAY SALES statistics (فروش امروز)
  const todayStats = useMemo(() => {
    let revenue = 0;
    let qty = 0;
    const todayInvoiceKeys = new Set<string>();

    periodTransactions.forEach(tx => {
      if (tx.dateStr === activeTodayDateUsed) {
        revenue += tx.salesAmount;
        qty += tx.qtySold;
        const cleanInv = getCleanInvoiceNumber(tx.invoiceNumber);
        const invKey = cleanInv ? cleanInv.toLowerCase() : `fallback-${tx.dateStr}-${tx.hour}-${(tx.customerName || '').trim()}`;
        todayInvoiceKeys.add(invKey);
      }
    });

    return { 
      revenue, 
      qty, 
      count: todayInvoiceKeys.size, 
      isMockToday: activeTodayDateUsed !== todayJalaliStr 
    };
  }, [periodTransactions, activeTodayDateUsed, todayJalaliStr]);

  // GENERAL STATS (Month Sales, Invoices counts, averages)
  const stats = useMemo(() => {
    let revenue = 0;
    let volume = 0;
    let maxHourSales = 0;
    let peakHour = 12;
    let maxDaySales = 0;
    let peakDayStr = 'شنبه';

    const hourlySum: Record<number, number> = {};
    const weekdaySum: Record<string, number> = {};

    periodTransactions.forEach(tx => {
      revenue += tx.salesAmount;
      volume += tx.qtySold;

      hourlySum[tx.hour] = (hourlySum[tx.hour] || 0) + tx.salesAmount;
      weekdaySum[tx.weekday] = (weekdaySum[tx.weekday] || 0) + tx.salesAmount;
    });

    for (let h = 0; h < 24; h++) {
      if ((hourlySum[h] || 0) > maxHourSales) {
        maxHourSales = hourlySum[h] || 0;
        peakHour = h;
      }
    }

    FA_WEEKDAYS_ORDERED.forEach(wd => {
      if ((weekdaySum[wd] || 0) > maxDaySales) {
        maxDaySales = weekdaySum[wd] || 0;
        peakDayStr = wd;
      }
    });

     // Invoices count (Grouped transactions by Invoice Number or Date x Hour x Customer to be accurate)
     const invoiceKeys = new Set<string>();
     const uniqueDays = new Set<string>();
     periodTransactions.forEach(tx => {
       const cleanInv = getCleanInvoiceNumber(tx.invoiceNumber);
       const invKey = cleanInv ? cleanInv.toLowerCase() : `fallback-${tx.dateStr}-${tx.hour}-${(tx.customerName || '').trim()}`;
       invoiceKeys.add(invKey);
       uniqueDays.add(tx.dateStr);
     });
     const invoiceCount = invoiceKeys.size;
     const averageInvoiceVal = invoiceCount > 0 ? Math.round(revenue / invoiceCount) : 0;
     const uniqueDaysCount = uniqueDays.size || 1;
     const avgDailyRevenue = Math.round(revenue / uniqueDaysCount);
     const avgDailyInvoices = Math.round(invoiceCount / uniqueDaysCount);

     return {
       revenue, // فروش ماه جاری
       volume,
       invoiceCount, // تعداد فاکتور
       averageInvoiceVal, // میانگین فاکتور
       peakHour,
       peakDayStr,
       txCount: periodTransactions.length,
       uniqueDaysCount,
       avgDailyRevenue,
       avgDailyInvoices
     };
  }, [periodTransactions]);

  // Collect unmapped categories in period transactions & catalog categories
  const { unmappedCategoryNames, filterDepartments } = useMemo(() => {
    const unmappedSet = new Set<string>();
    let hasUnassigned = false;

    uniqueCategories.forEach(c => {
      if (rawPeriodDepartments.length > 0 && (!c.departmentId || !deptByIdMap[c.departmentId])) {
        if (c.name) unmappedSet.add(c.name);
      }
    });

    periodTransactions.forEach(tx => {
      const resolved = resolveTxDepartment(tx);
      if (resolved.isUnassigned) {
        hasUnassigned = true;
        if (resolved.sourceCatName) unmappedSet.add(resolved.sourceCatName);
      }
    });

    const deptOptions = periodDepartments.map(d => ({ id: d.id, name: d.name }));
    if (hasUnassigned || unmappedSet.size > 0) {
      deptOptions.push({ id: UNASSIGNED_DEPT_ID, name: UNASSIGNED_DEPT_NAME });
    }

    return {
      unmappedCategoryNames: Array.from(unmappedSet),
      filterDepartments: deptOptions
    };
  }, [uniqueCategories, rawPeriodDepartments.length, deptByIdMap, periodTransactions, resolveTxDepartment, periodDepartments]);

  React.useEffect(() => {
    if (filterDepartments.length === 0) return;
    if (!filterDepartments.some(d => d.id === selectedPeakCategoryId)) {
      setSelectedPeakCategoryId(filterDepartments[0].id);
    }
  }, [filterDepartments, selectedPeakCategoryId]);

  // sales by production department (فروش هر دپارتمان تولیدی)
  const categorySummary = useMemo(() => {
    const summary: Record<string, { id: string; groupKey: string; name: string; amount: number; qty: number; percentage: number; unit: string; isUnassigned: boolean }> = {};
    let grandRevenue = 0;

    periodTransactions.forEach(tx => {
      const resolvedDept = resolveTxDepartment(tx);
      grandRevenue += tx.salesAmount;

      const finalId = resolvedDept.id;
      const finalName = resolvedDept.name;
      const groupKey = finalId;

      if (!summary[groupKey]) {
        let isKg = finalName.includes('کیلویی') || finalName.includes('کیلو') || finalName.includes('فله') || finalName.includes('وزنی');
        if (!isKg) {
          const deptProducts = products.filter(p => resolveProductDepartment(p).id === finalId);
          if (deptProducts.length > 0) {
            const kgCount = deptProducts.filter(p => p.unit === 'کیلو').length;
            if (kgCount >= deptProducts.length / 2) {
              isKg = true;
            }
          }
        }
        summary[groupKey] = {
          id: finalId,
          groupKey,
          name: finalName,
          amount: 0,
          qty: 0,
          percentage: 0,
          unit: isKg ? 'کیلوگرم' : 'عدد',
          isUnassigned: resolvedDept.isUnassigned
        };
      }
      summary[groupKey].amount += tx.salesAmount;
      summary[groupKey].qty += tx.qtySold;
    });

    const result = Object.values(summary);
    if (grandRevenue > 0) {
      result.forEach(item => {
        item.percentage = parseFloat(((item.amount / grandRevenue) * 100).toFixed(1));
      });
    }

    return result.sort((a, b) => b.amount - a.amount);
  }, [periodTransactions, products, resolveTxDepartment, resolveProductDepartment]);

  // BEST & WORST SELLING PRODUCTS (پرفروشترین و کمفروشترین محصولات)
  const productPerformance = useMemo(() => {
    const prodMap: Record<string, { id: string; name: string; code: string; categoryName: string; amount: number; qty: number; unit: string }> = {};
    
    // Seed with all catalog products to handle products with ZERO sales as low performer correctly
    products.forEach(p => {
      const dept = resolveProductDepartment(p);
      prodMap[p.id] = {
        id: p.id,
        name: p.name,
        code: p.code || 'ـ',
        categoryName: dept.isUnassigned ? 'تخصیص‌نیافته' : dept.name,
        amount: 0,
        qty: 0,
        unit: p.unit === 'کیلو' ? 'کیلو' : 'عدد'
      };
    });

    periodTransactions.forEach(tx => {
      if (!prodMap[tx.productId]) {
        const matchingProd = products.find(p => p.id === tx.productId);
        const txDept = resolveTxDepartment(tx);
        prodMap[tx.productId] = {
          id: tx.productId,
          name: tx.productName,
          code: 'ـ',
          categoryName: txDept.isUnassigned ? 'تخصیص‌نیافته' : txDept.name,
          amount: 0,
          qty: 0,
          unit: matchingProd ? (matchingProd.unit === 'کیلو' ? 'کیلو' : 'عدد') : 'عدد'
        };
      }
      prodMap[tx.productId].amount += tx.salesAmount;
      prodMap[tx.productId].qty += tx.qtySold;
    });

    const list = Object.values(prodMap);
    const sortedByRevenue = [...list].sort((a, b) => b.amount - a.amount);

    const bestSellers = sortedByRevenue.filter(p => p.amount > 0).slice(0, 10);
    const worstSellers = sortedByRevenue.slice().reverse().slice(0, 10);

    return { bestSellers, worstSellers };
  }, [periodTransactions, products, resolveProductDepartment, resolveTxDepartment]);

  // CUSTOMER PERFORMANCE ANALYSIS (آنالیز مشتریان و خریداران برتر)
  const customerPerformance = useMemo(() => {
    const custMap: Record<string, { name: string; amount: number; qty: number; invoiceCodes: Set<string> }> = {};

    periodTransactions.forEach(tx => {
      const cName = (tx.customerName || '').trim() || 'مشتری عمومی / تعریف‌نشده';
      if (!custMap[cName]) {
        custMap[cName] = {
          name: cName,
          amount: 0,
          qty: 0,
          invoiceCodes: new Set<string>()
        };
      }
      custMap[cName].amount += tx.salesAmount;
      custMap[cName].qty += tx.qtySold;
      
      const cleanInv = getCleanInvoiceNumber(tx.invoiceNumber);
      if (cleanInv) {
        custMap[cName].invoiceCodes.add(cleanInv.toLowerCase());
      } else {
        custMap[cName].invoiceCodes.add(`fallback-${tx.dateStr}-${tx.hour}-${cName}`);
      }
    });

    const list = Object.values(custMap).map(c => ({
      name: c.name,
      amount: c.amount,
      qty: c.qty,
      invoicesCount: c.invoiceCodes.size
    }));

    const totalCustomersAmount = list.reduce((sum, item) => sum + item.amount, 0);

    const listWithPercentage = list.map(c => {
      const pct = totalCustomersAmount > 0 ? (c.amount / totalCustomersAmount) * 100 : 0;
      return {
        ...c,
        percentage: Math.round(pct * 100) / 100 // up to 2 decimal places
      };
    });

    // Sort by purchase amount descending
    return listWithPercentage.sort((a, b) => b.amount - a.amount);
  }, [periodTransactions]);

  // Hourly Chart Aggregator (فروش بر حسب ساعت)
  const hourlyChartData = useMemo(() => {
    const arr: { hour: number; amount: number; qty: number; txCount: number }[] = [];
    for (let h = 0; h < 24; h++) {
      arr.push({ hour: h, amount: 0, qty: 0, txCount: 0 });
    }

    periodTransactions.forEach(tx => {
      const matchesCategory = selectedCategoryFilter === 'ALL' || resolveTxDepartment(tx).id === selectedCategoryFilter;
      const matchesProduct = selectedProductIdFilter === 'ALL' || tx.productId === selectedProductIdFilter;
      
      if (matchesCategory && matchesProduct) {
        const hourIdx = (typeof tx.hour === 'number' && !isNaN(tx.hour) && tx.hour >= 0 && tx.hour <= 23) ? tx.hour : 12;
        if (arr[hourIdx]) {
          arr[hourIdx].amount += tx.salesAmount;
          arr[hourIdx].qty += tx.qtySold;
          arr[hourIdx].txCount += 1;
        }
      }
    });

    return arr;
  }, [periodTransactions, selectedCategoryFilter, selectedProductIdFilter, resolveTxDepartment]);

  // HEATMAP DATA (روز × ساعت)
  const weekdayHourHeatmap = useMemo(() => {
    const map: Record<string, Record<number, { amount: number; qty: number }>> = {};
    FA_WEEKDAYS_ORDERED.forEach(wd => {
      map[wd] = {};
      for (let h = 0; h < 24; h++) {
        map[wd][h] = { amount: 0, qty: 0 };
      }
    });

    periodTransactions.forEach(tx => {
      let wd = tx.weekday || 'شنبه';
      if (!FA_WEEKDAYS_ORDERED.includes(wd)) {
        wd = 'شنبه';
      }
      const hourIdx = (typeof tx.hour === 'number' && !isNaN(tx.hour) && tx.hour >= 0 && tx.hour <= 23) ? tx.hour : 12;
      if (map[wd] && map[wd][hourIdx]) {
        map[wd][hourIdx].amount += tx.salesAmount;
        map[wd][hourIdx].qty += tx.qtySold;
      }
    });

    return map;
  }, [periodTransactions]);

  // Find max cell globally to normalize Heatmap opacities
  const maxHeatmapCellAmount = useMemo(() => {
    let max = 0;
    FA_WEEKDAYS_ORDERED.forEach(wd => {
      for (let h = 0; h < 24; h++) {
        const amt = weekdayHourHeatmap[wd]?.[h]?.amount || 0;
        if (amt > max) max = amt;
      }
    });
    return max > 0 ? max : 1;
  }, [weekdayHourHeatmap]);

  // WEEKDAY PEAK HOURS PER CATEGORY AND PRODUCT
  // { [weekday]: { [categoryId/productId]: peakHour } }
  const weekdayPeakAnalysis = useMemo(() => {
    // 1. Category-based peak hours
    const catHourSum: Record<string, Record<string, Record<number, number>>> = {}; // Day -> Cat -> Hour -> Amount
    // 2. Product-based peak hours
    const prodHourSum: Record<string, Record<string, Record<number, number>>> = {}; // Day -> Prod -> Hour -> Amount

    FA_WEEKDAYS_ORDERED.forEach(wd => {
      catHourSum[wd] = {};
      prodHourSum[wd] = {};
    });

    periodTransactions.forEach(tx => {
      let wd = tx.weekday || 'شنبه';
      if (!FA_WEEKDAYS_ORDERED.includes(wd)) {
        wd = 'شنبه';
      }
      const cat = resolveTxDepartment(tx).id;
      const prod = tx.productId;
      const hourIdx = (typeof tx.hour === 'number' && !isNaN(tx.hour) && tx.hour >= 0 && tx.hour <= 23) ? tx.hour : 12;

      // Group counts
      if (!catHourSum[wd][cat]) catHourSum[wd][cat] = {};
      catHourSum[wd][cat][hourIdx] = (catHourSum[wd][cat][hourIdx] || 0) + tx.salesAmount;

      // Product counts
      if (!prodHourSum[wd][prod]) prodHourSum[wd][prod] = {};
      prodHourSum[wd][prod][hourIdx] = (prodHourSum[wd][prod][hourIdx] || 0) + tx.salesAmount;
    });

    // Solve peak hour for each
    const peaksByCategory: Record<string, Record<string, { hour: number; amount: number; qty: number }>> = {};
    const peaksByProduct: Record<string, Record<string, { hour: number; amount: number; qty: number }>> = {};

    FA_WEEKDAYS_ORDERED.forEach(wd => {
      peaksByCategory[wd] = {};
      peaksByProduct[wd] = {};

      // Categories
      Object.keys(catHourSum[wd]).forEach(catId => {
        let bestHour = -1;
        let bestAmt = -1;
        Object.keys(catHourSum[wd][catId]).forEach(hStr => {
          const h = parseInt(hStr, 10);
          const amt = catHourSum[wd][catId][h];
          if (amt > bestAmt) {
            bestAmt = amt;
            bestHour = h;
          }
        });
        peaksByCategory[wd][catId] = { hour: bestHour, amount: bestAmt, qty: 0 };
      });

      // Products
      Object.keys(prodHourSum[wd]).forEach(pId => {
        let bestHour = -1;
        let bestAmt = -1;
        Object.keys(prodHourSum[wd][pId]).forEach(hStr => {
          const h = parseInt(hStr, 10);
          const amt = prodHourSum[wd][pId][h];
          if (amt > bestAmt) {
            bestAmt = amt;
            bestHour = h;
          }
        });
        peaksByProduct[wd][pId] = { hour: bestHour, amount: bestAmt, qty: 0 };
      });
    });

    // Populate quantities
    periodTransactions.forEach(tx => {
      let wd = tx.weekday || 'شنبه';
      if (!FA_WEEKDAYS_ORDERED.includes(wd)) {
        wd = 'شنبه';
      }
      const cat = resolveTxDepartment(tx).id;
      const prod = tx.productId;
      const hourIdx = (typeof tx.hour === 'number' && !isNaN(tx.hour) && tx.hour >= 0 && tx.hour <= 23) ? tx.hour : 12;

      if (peaksByCategory[wd] && peaksByCategory[wd][cat] && peaksByCategory[wd][cat].hour === hourIdx) {
        peaksByCategory[wd][cat].qty += tx.qtySold;
      }
      if (peaksByProduct[wd] && peaksByProduct[wd][prod] && peaksByProduct[wd][prod].hour === hourIdx) {
        peaksByProduct[wd][prod].qty += tx.qtySold;
      }
    });

    return { categories: peaksByCategory, products: peaksByProduct };
  }, [periodTransactions, resolveTxDepartment]);

  // Process 31 Days line view sums
  const dailyChartData = useMemo(() => {
    const rawSums: Record<number, number> = {};
    for (let d = 1; d <= 31; d++) rawSums[d] = 0;

    periodTransactions.forEach(tx => {
      const matchesProduct = selectedProductIdFilter === 'ALL' || tx.productId === selectedProductIdFilter;
      const matchesCategory = selectedCategoryFilter === 'ALL' || resolveTxDepartment(tx).id === selectedCategoryFilter;
      if (matchesProduct && matchesCategory) {
        rawSums[tx.dayOfMonth] += tx.salesAmount;
      }
    });
    return Object.keys(rawSums).map(k => ({
      day: parseInt(k, 10),
      amount: rawSums[parseInt(k, 10)]
    }));
  }, [periodTransactions, selectedProductIdFilter, selectedCategoryFilter, resolveTxDepartment]);

  const maxDailyAmount = useMemo(() => {
    const max = Math.max(...dailyChartData.map(d => d.amount));
    return max > 0 ? max : 1;
  }, [dailyChartData]);

  // Product x Weekday Matrix Multi-aggregation
  const productWeeklyMatrix = useMemo(() => {
    const matrix: Record<string, {
      productId: string;
      productName: string;
      categoryName: string;
      weekdayAmounts: Record<string, number>;
      weekdayQtys: Record<string, number>;
      totalAmount: number;
      totalQty: number;
    }> = {};

    periodTransactions.forEach(tx => {
      const resolvedDept = resolveTxDepartment(tx);
      const matchesCategory = selectedCategoryFilter === 'ALL' || resolvedDept.id === selectedCategoryFilter;
      const matchesProduct = selectedProductIdFilter === 'ALL' || tx.productId === selectedProductIdFilter;

      if (matchesCategory && matchesProduct) {
        if (!matrix[tx.productId]) {
          matrix[tx.productId] = {
            productId: tx.productId,
            productName: tx.productName,
            categoryName: resolvedDept.isUnassigned ? 'تخصیص‌نیافته' : resolvedDept.name,
            weekdayAmounts: {},
            weekdayQtys: {},
            totalAmount: 0,
            totalQty: 0
          };
        }
        const row = matrix[tx.productId];
        row.weekdayAmounts[tx.weekday] = (row.weekdayAmounts[tx.weekday] || 0) + tx.salesAmount;
        row.weekdayQtys[tx.weekday] = (row.weekdayQtys[tx.weekday] || 0) + tx.qtySold;
        row.totalAmount += tx.salesAmount;
        row.totalQty += tx.qtySold;
      }
    });

    return Object.values(matrix).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [periodTransactions, selectedCategoryFilter, selectedProductIdFilter, resolveTxDepartment]);

  // Column totals for weekly matrix
  const productWeeklyMatrixTotals = useMemo(() => {
    const totals: Record<string, { amount: number; qty: number }> = {};
    let grandTotalAmount = 0;
    let grandTotalQty = 0;

    FA_WEEKDAYS_ORDERED.forEach(w => {
      totals[w] = { amount: 0, qty: 0 };
    });

    productWeeklyMatrix.forEach(row => {
      FA_WEEKDAYS_ORDERED.forEach(w => {
        totals[w].amount += row.weekdayAmounts[w] || 0;
        totals[w].qty += row.weekdayQtys[w] || 0;
      });
      grandTotalAmount += row.totalAmount;
      grandTotalQty += row.totalQty;
    });

    return { totals, grandTotalAmount, grandTotalQty };
  }, [productWeeklyMatrix]);

  // Combined filters and searching for transaction ledger
  const filteredTransactions = useMemo(() => {
    return periodTransactions.filter(tx => {
      const matchesCategory = selectedCategoryFilter === 'ALL' || resolveTxDepartment(tx).id === selectedCategoryFilter;
      const matchesProduct = selectedProductIdFilter === 'ALL' || tx.productId === selectedProductIdFilter;
      
      const searchLower = searchTerm.toLowerCase().trim();
      if (!searchLower) return matchesCategory && matchesProduct;

      const pCode = products.find(p => p.id === tx.productId)?.code || '';
      return matchesCategory && matchesProduct && (
        tx.invoiceNumber?.toLowerCase().includes(searchLower) ||
        tx.productName.toLowerCase().includes(searchLower) ||
        pCode.toLowerCase().includes(searchLower) ||
        tx.dateStr.includes(searchLower)
      );
    });
  }, [periodTransactions, selectedCategoryFilter, selectedProductIdFilter, searchTerm, products, resolveTxDepartment]);

  // Paginated chunk selection
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage) || 1;
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredTransactions.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredTransactions, currentPage, itemsPerPage]);

  // HTML Executive Report PDF Renderer
  const handlePrintDashboard = () => {
    // Weekday sales aggregator for print
    const weekdaySums: Record<string, { amount: number; qty: number; txCount: number }> = {};
    FA_WEEKDAYS_ORDERED.forEach(wd => {
      weekdaySums[wd] = { amount: 0, qty: 0, txCount: 0 };
    });
    periodTransactions.forEach(tx => {
      let wd = tx.weekday || 'شنبه';
      if (weekdaySums[wd]) {
        weekdaySums[wd].amount += tx.salesAmount;
        weekdaySums[wd].qty += tx.qtySold;
        weekdaySums[wd].txCount += 1;
      }
    });
    const totalWeekdayAmount = Object.values(weekdaySums).reduce((sum, item) => sum + item.amount, 0) || 1;

    // Selected labels for peak hours sub-report
    const peakViewLabel = peakHoursViewType === 'category'
      ? `دپارتمان تولیدی: ${filterDepartments.find(d => d.id === selectedPeakCategoryId)?.name || 'ـ'}`
      : `محصول: ${products.find(p => p.id === selectedPeakProductId)?.name || 'ـ'}`;

    const printContent = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;700;900&display=swap');
        @page { size: landscape !important; margin: 0.8cm !important; }
        body { font-family: 'Vazirmatn', sans-serif; direction: rtl; text-align: right; background-color: #fff; color: #1e293b; padding: 15px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: center; }
        th { background-color: #f8fafc; font-weight: bold; }
        .grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .card { border: 1px solid #e2e8f0; padding: 12px; border-radius: 12px; background-color: #f8fafc; }
        .card-title { font-size: 10px; color: #64748b; font-weight: bold; }
        .card-value { font-size: 15px; font-weight: 900; margin-top: 5px; color: #0f172a; }
        .section-title { font-size: 13px; font-weight: bold; border-right: 4px solid #f43f5e; padding-right: 8px; margin-top: 25px; margin-bottom: 12px; color: #0f172a; }
        .text-rose { color: #f43f5e; font-weight: 950; }
        .chart-container { display: flex; align-items: flex-end; justify-content: space-between; height: 110px; border-bottom: 2px solid #cbd5e1; padding: 10px 0; background-color: #f8fafc; border-radius: 8px; margin-top: 10px; margin-bottom: 25px; }
        .chart-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; margin: 0 1px; }
        .chart-bar { width: 100%; background-color: #f43f5e; border-radius: 2px 2px 0 0; }
        .chart-label { font-size: 8px; font-weight: bold; color: #64748b; margin-top: 4px; }
        
        /* New print layout additions */
        .page-break { page-break-before: always; }
        .avoid-break { page-break-inside: avoid; }
        .heatmap-grid { display: grid; grid-template-columns: 80px repeat(24, 1fr); gap: 3px; margin-top: 15px; margin-bottom: 25px; }
        .heatmap-header-cell { text-align: center; font-size: 8.5px; font-weight: 900; color: #475569; padding: 4px 0; border-bottom: 1px solid #cbd5e1; }
        .heatmap-row-label { font-size: 9.5px; font-weight: bold; color: #1e293b; display: flex; align-items: center; justify-content: flex-start; }
        .heatmap-cell { height: 24px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; }
        .peak-hours-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 10px; margin-bottom: 25px; }
        .peak-hour-card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; background-color: #f8fafc; }
        .peak-hour-day { font-size: 11px; font-weight: 900; color: #e11d48; margin-bottom: 6px; }
        .peak-hour-details { font-size: 10px; color: #334155; line-height: 1.5; }
      </style>
      <div>
        <div style="text-align: center; border-bottom: 4px double #cbd5e1; padding-bottom: 15px; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 900; color: #0f172a;">گزارش یکپارچه هوشمند تحلیل تقاضا و رفتار فروش ماهانه کارگاه</h1>
          <p style="font-size: 11px; color: #64748b; margin: 5px 0 0;">سیستم پایش داده‌های تراکنشی و همگام‌ساز فروش</p>
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-title">فروش کل ماه جاری</div>
            <div class="card-value">${formatWithCommas(stats.revenue)} ریال</div>
          </div>
          <div class="card">
            <div class="card-title">تعداد کل فاکتورها</div>
            <div class="card-value">${toPersianDigits(stats.invoiceCount)} عدد</div>
          </div>
          <div class="card">
            <div class="card-title">میانگین ارزش فاکتور</div>
            <div class="card-value">${formatWithCommas(stats.averageInvoiceVal)} ریال</div>
          </div>
          <div class="card">
            <div class="card-title">میانگین فروش روز</div>
            <div class="card-value">${formatWithCommas(stats.avgDailyRevenue)} ریال</div>
            <div style="font-size: 9px; color: #64748b; margin-top: 4px;">میانگین فاکتور روزانه: ${toPersianDigits(stats.avgDailyInvoices)} عدد (${toPersianDigits(stats.uniqueDaysCount)} روز فعال)</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
          <div>
            <div class="section-title">گزارش سهم توزیع دپارتمان‌های تولیدی</div>
            <table>
              <thead>
                <tr>
                  <th>دپارتمان تولیدی</th>
                  <th>تعداد فروش (واحد)</th>
                  <th>مبلغ فروش ناخالص (ریال)</th>
                  <th>سهم بازاری</th>
                </tr>
              </thead>
              <tbody>
                ${categorySummary.map(c => `
                  <tr>
                    <td style="font-weight: bold; text-align: right;">${c.name}</td>
                    <td>${toPersianDigits(Math.round(c.qty * 100) / 100)}</td>
                    <td style="font-weight: bold;">${formatWithCommas(c.amount)} ریال</td>
                    <td class="text-rose">${toPersianDigits(c.percentage)}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div>
            <div class="section-title">گزارش توزیع زمانی فروش در روزهای هفته</div>
            <table>
              <thead>
                <tr>
                  <th>روز هفته</th>
                  <th>تعداد فاکتور / ردیف</th>
                  <th>حجم فروش (عدد)</th>
                  <th>مبلغ کل فروش (ریال)</th>
                  <th>سهم درآمدی</th>
                </tr>
              </thead>
              <tbody>
                ${FA_WEEKDAYS_ORDERED.map(wd => {
                  const dayData = weekdaySums[wd] || { amount: 0, qty: 0, txCount: 0 };
                  const pct = totalWeekdayAmount > 0 ? (dayData.amount / totalWeekdayAmount) * 100 : 0;
                  return `
                    <tr>
                      <td style="font-weight: bold; text-align: right;">${wd}</td>
                      <td>${toPersianDigits(dayData.txCount)} ردیف</td>
                      <td>${toPersianDigits(Math.round(dayData.qty * 100) / 100)}</td>
                      <td style="font-weight: bold;">${formatWithCommas(dayData.amount)} ریال</td>
                      <td style="font-weight: bold; color: #4f46e5;">${toPersianDigits(Math.round(pct * 10) / 10)}٪</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="avoid-break">
          <div class="section-title">روند توزیع و تغییرات درآمد روزانه در ۳۱ روز ماه جاری</div>
          <div class="chart-container">
            ${dailyChartData.map(d => {
              const pct = d.amount > 0 ? (d.amount / maxDailyAmount) * 100 : 2;
              return `
                <div class="chart-bar-col">
                  <div class="chart-bar" style="height: ${pct}%;"></div>
                  <span class="chart-label">${toPersianDigits(d.day)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="avoid-break">
          <div class="section-title">نمودار توزیع زمانی فروش بر حسب ساعت تراکنش (ساعات ۰ الی ۲۳)</div>
          <div class="chart-container" style="height: 100px;">
            ${hourlyChartData.map(h => {
              const maxHourlyQty = Math.max(...hourlyChartData.map(ho => ho.qty)) || 1;
              const pct = h.qty > 0 ? (h.qty / maxHourlyQty) * 100 : 2;
              const isPeak = h.hour === stats.peakHour;
              return `
                <div class="chart-bar-col" style="margin: 0 2px;">
                  <div class="chart-bar" style="height: ${pct}%; background-color: ${isPeak ? '#0ea5e9' : '#94a3b8'};"></div>
                  <span class="chart-label">${toPersianDigits(h.hour)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- NEW COMPREHENSIVE SECTIONS: BEHAVIORAL PATTERNS -->
        <div class="page-break"></div>
        <div style="text-align: center; border-bottom: 4px double #cbd5e1; padding-bottom: 15px; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 900; color: #0f172a;">گزارش مکمل تحلیل زمانی و رفتار مصرف‌کننده (پایش پیشرفته)</h1>
          <p style="font-size: 10px; color: #64748b; margin: 5px 0 0;">رفتار فصلی روز هفته، نقشه تراکم و ماتریس‌های عملکردی</p>
        </div>

        <div class="avoid-break">
          <div class="section-title">۱. نقشه فراوانی تقاضا (Heatmap) تراکم درآمدی روز هفته × ساعت فروش</div>
          <p style="font-size: 9.5px; color: #64748b; margin-top: -5px; margin-bottom: 10px;">اعداد درج شده معرف تعداد واحد محصول به فروش رفته است. شدت رنگ سبز نشانگر چگالی تراکم ریالی است.</p>
          
          <div class="heatmap-grid" dir="rtl">
            <!-- Header Hours Row -->
            <div class="heatmap-header-cell" style="text-align: right; font-size: 9px;">روز هفته / ساعت</div>
            ${Array.from({ length: 24 }).map((_, h) => `
              <div class="heatmap-header-cell">${toPersianDigits(h)}</div>
            `).join('')}

            <!-- Grid Rows per Weekday -->
            ${FA_WEEKDAYS_ORDERED.map(wd => {
              const rowCellsHtml = Array.from({ length: 24 }).map((_, h) => {
                const cell = weekdayHourHeatmap[wd]?.[h] || { amount: 0, qty: 0 };
                const ratio = cell.amount > 0 ? (cell.amount / maxHeatmapCellAmount) : 0;
                
                // Emerald background scale matching the web app style
                const bgStyle = cell.amount > 0
                  ? `rgba(16, 185, 129, ${0.08 + ratio * 0.92})`
                  : 'rgba(241, 245, 249, 0.4)';
                const borderStyle = cell.amount > 0
                  ? `rgba(16, 185, 129, ${0.2 + ratio * 0.6})`
                  : 'rgba(226, 232, 240, 0.5)';
                const textColor = cell.amount > 0 ? '#047857' : '#94a3b8';
                const label = cell.amount > 0 ? toPersianDigits(Math.round(cell.qty * 10) / 10) : '-';

                return `
                  <div class="heatmap-cell" style="background-color: ${bgStyle}; border-color: ${borderStyle}; color: ${textColor};">
                    ${label}
                  </div>
                `;
              }).join('');

              return `
                <div class="heatmap-row-label">${wd}</div>
                ${rowCellsHtml}
              `;
            }).join('')}
          </div>
        </div>

        <div class="avoid-break">
          <div class="section-title">۲. ساعات پیک فروش به تفکیک روزهای هفته (${toPersianDigits(peakViewLabel)})</div>
          <div class="peak-hours-grid">
            ${FA_WEEKDAYS_ORDERED.map(wd => {
              let peakData = null;
              if (peakHoursViewType === 'category') {
                peakData = weekdayPeakAnalysis.categories[wd]?.[selectedPeakCategoryId];
              } else {
                peakData = weekdayPeakAnalysis.products[wd]?.[selectedPeakProductId];
              }
              const hasSales = peakData && peakData.hour > -1;

              return `
                <div class="peak-hour-card">
                  <div class="peak-hour-day">${wd}</div>
                  <div class="peak-hour-details">
                    ${hasSales ? `
                      <b>زمان اوج:</b> ساعت ${toPersianDigits(peakData.hour)} الی ${toPersianDigits(peakData.hour + 1)}:۰۰<br/>
                      <b>حجم فروش فیزیکی:</b> ${toPersianDigits(Math.round(peakData.qty * 100) / 100)} واحد<br/>
                      <b>ارزش ناخالص:</b> <span style="color: #059669; font-weight: bold;">${formatWithCommas(peakData.amount)} ریال</span>
                    ` : `
                      <span style="color: #94a3b8; font-style: italic;">فاقد تراکنش ثبت شده در این روز هفته</span>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="page-break"></div>
        <div style="text-align: center; border-bottom: 4px double #cbd5e1; padding-bottom: 15px; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 18px; font-weight: 900; color: #0f172a;">ماتریس تفصیلی عملکرد کالاها و مشتریان برتر</h1>
          <p style="font-size: 10px; color: #64748b; margin: 5px 0 0;">جدول تفکیکی روزانه محصولات و رتبه‌بندی خریداران اصلی کارگاه</p>
        </div>

        <div class="avoid-break">
          <div class="section-title">۳. ماتریس جامع درآمد حاصل از فروش کالا در روزهای هفته</div>
          <table>
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="text-align: right; width: 180px;">نام محصول</th>
                <th>گروه کالایی</th>
                ${FA_WEEKDAYS_ORDERED.map(w => `<th>${w}</th>`).join('')}
                <th style="background-color: #fef08a;">مجموع فروش</th>
              </tr>
            </thead>
            <tbody>
              ${productWeeklyMatrix.map(row => {
                const dayCellsHtml = FA_WEEKDAYS_ORDERED.map(w => {
                  const amt = row.weekdayAmounts[w] || 0;
                  const qty = row.weekdayQtys[w] || 0;
                  const roundedQty = Math.round(qty * 100) / 100;
                  return amt > 0 
                    ? `<td>
                         <div style="font-weight: bold; color: #059669;">${formatWithCommas(amt)}</div>
                         <div style="font-size: 8px; color: #64748b;">(${toPersianDigits(roundedQty)} واحد)</div>
                       </td>`
                    : `<td style="color: #cbd5e1;">۰</td>`;
                }).join('');

                return `
                  <tr>
                    <td style="text-align: right; font-weight: bold; font-size: 10px;">${row.productName}</td>
                    <td style="color: #64748b; font-size: 10px;">${row.categoryName}</td>
                    ${dayCellsHtml}
                    <td style="font-weight: 900; background-color: #fefcf0; color: #b45309;">${formatWithCommas(row.totalAmount)} ریال</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #f8fafc; font-weight: bold;">
                <td style="text-align: right;" colspan="2">جمع کل ستون‌ها</td>
                ${FA_WEEKDAYS_ORDERED.map(w => {
                  const amt = productWeeklyMatrixTotals.totals[w]?.amount || 0;
                  const qty = productWeeklyMatrixTotals.totals[w]?.qty || 0;
                  return amt > 0
                    ? `<td>
                         <div style="font-weight: bold; color: #0f172a;">${formatWithCommas(amt)} ریال</div>
                         <div style="font-size: 8px; color: #475569;">(${toPersianDigits(Math.round(qty * 100) / 100)} واحد)</div>
                       </td>`
                    : `<td>۰</td>`;
                }).join('')}
                <td style="background-color: #fef9c3; font-weight: 900; font-size: 11px; color: #92400e;">
                  ${formatWithCommas(productWeeklyMatrixTotals.grandTotalAmount)} ریال
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; margin-top: 25px;" class="avoid-break">
          <div>
            <div class="section-title">۴. پرفروش‌ترین کالاها به ترتیب سهم ریالی درآمد</div>
            <table>
              <thead>
                <tr>
                  <th>عنوان کالا</th>
                  <th>گروه کالا</th>
                  <th>تعداد فروخته شده</th>
                  <th>مجموع ناخالص پرداختی</th>
                </tr>
              </thead>
              <tbody>
                ${productPerformance.bestSellers.map(p => `
                  <tr>
                    <td style="font-weight: bold; text-align: right;">${p.name}</td>
                    <td>${p.categoryName}</td>
                    <td>${toPersianDigits(Math.round(p.qty * 100) / 100)} عدد</td>
                    <td style="font-weight: bold; color: #059669;">${formatWithCommas(p.amount)} ریال</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div>
            <div class="section-title">۵. مشتریان و خریداران برتر ماه</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40px;">رتبه</th>
                  <th>نام مشتری</th>
                  <th>تعداد فاکتور</th>
                  <th>ارزش خرید (ریال)</th>
                  <th>سهم</th>
                </tr>
              </thead>
              <tbody>
                ${customerPerformance.slice(0, 5).map((cust, idx) => `
                  <tr>
                    <td>${toPersianDigits(idx + 1)}</td>
                    <td style="font-weight: bold; text-align: right;">${cust.name}</td>
                    <td>${toPersianDigits(cust.invoicesCount)} فاکتور</td>
                    <td style="font-weight: bold; color: #059669;">${formatWithCommas(cust.amount)}</td>
                    <td style="font-weight: bold; color: #4f46e5;">${toPersianDigits(cust.percentage)}٪</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="margin-top: 40px; border-top: 1px dashed #cbd5e1; padding-top: 15px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between;">
          <span>سامانه هوشمند برنامه‌ریزی یکپارچه منابع کارگاه تولید گاتان</span>
          <span>تاریخ استخراج: ${toPersianDigits(new Date().toLocaleDateString('fa-IR'))}</span>
        </div>
      </div>
    `;
    printElement('گزارش نهایی هوشمند تحلیل رفتار فروش', printContent);
  };

  return (
    <div className="space-y-6 text-slate-100" dir="rtl">

      {/* Header element matches design philosophy with custom background and gold details */}
      <div className="bg-gradient-to-l from-slate-900 via-rose-950/20 to-slate-900 border border-rose-500/15 p-6 rounded-3xl relative overflow-hidden shadow-xl">
        <div className="absolute right-0 top-0 w-80 h-80 bg-rose-500/5 rounded-full blur-3xl -z-10" />
        <div className="absolute left-10 top-5 text-rose-500/10 -z-10 select-none">
          <TrendingUp className="h-44 w-44" />
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="bg-rose-500/10 text-rose-400 p-3 rounded-2xl border border-rose-500/20">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] rounded-md font-black tracking-widest block w-fit mb-1">EXECUTIVE SALES INTELLIGENCE</span>
              <h1 className="text-xl font-black text-white tracking-tight">
                داشبورد پیشرفته رفتار مصرف‌کننده، زمان‌بندی و پایش فروش
              </h1>
              <p className="text-[11px] text-slate-450 mt-1 leading-relaxed max-w-2xl">
                تحلیل جامع تراکنش‌های فروش همروند با برقراری اتصالات هیت‌مپ روز/ساعت، ارزیابی پرفروش‌ترین و کم‌فروش‌ترین کالاها و استخراج ساعات پیک تقاضای هفتگی کالاها.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handlePrintDashboard}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-850 text-slate-300 border border-slate-800 rounded-xl text-xs font-black transition-colors cursor-pointer"
            >
              <Download className="h-4 w-4 text-rose-400" />
              خروجی گزارش چاپی مدیریتی
            </button>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-850 text-slate-300 border border-slate-800 rounded-xl text-xs font-black transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              دریافت نمونه فایل ورود تراکنش
            </button>
          </div>
        </div>
      </div>

      {/* MONTH SELECTION RIBBON (SLIM SYNCED BAR WHEN CONTROLLED BY PARENT HEADER, FULL GRID IF STANDALONE) */}
      {propSelectedMonth !== undefined ? (
        <div className="bg-slate-950/80 border border-slate-850 rounded-2xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" dir="rtl">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${activeMonth === 'ALL' ? 'bg-amber-400' : (monthlyDashboardStats[activeMonth]?.count || 0) > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <div className="text-xs font-bold text-slate-200">
              محدوده تحلیلی فعال ({activeMonth === 'ALL' ? 'کل سال' : `ماه ${PERSIAN_MONTHS[activeMonth - 1]}`} {toPersianDigits(activeYear)}):{' '}
              {activeMonth === 'ALL' ? (
                <span className="text-amber-400 font-black">نمایش تجمیعی کلیه ماه‌های سال ({toPersianDigits(periodTransactions.length)} تراکنش)</span>
              ) : (monthlyDashboardStats[activeMonth]?.count || 0) > 0 ? (
                <span className="text-emerald-400 font-black">
                  {toPersianDigits(monthlyDashboardStats[activeMonth].count)} ردیف تراکنش ({toPersianDigits(monthlyDashboardStats[activeMonth].invoiceCount)} فاکتور) — {formatWithCommas(monthlyDashboardStats[activeMonth].totalAmount)} ریال
                </span>
              ) : (
                <span className="text-slate-400 font-normal">هیچ تراکنشی برای این ماه ثبت نشده است (هماهنگ با انتخاب ماه سربرگ).</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {viewAllYear ? (
              <button
                type="button"
                onClick={() => setViewAllYear(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-rose-300 border border-rose-500/30 cursor-pointer transition-all"
              >
                بازگشت به ماه {PERSIAN_MONTHS[(Number(propSelectedMonth) || 1) - 1]}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleMonthSelect('ALL')}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-950 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 cursor-pointer transition-all"
              >
                نمایش تجمیعی کل سال
              </button>
            )}
          </div>
        </div>
      ) : (
      <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 shadow-xl space-y-4" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-850/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-2xl shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 text-right">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <span>تحلیل و پایش زمانی فروش ماهانه:</span>
                <span className="text-rose-400 font-extrabold">
                  {activeMonth === 'ALL' ? 'کل ماه‌های سال' : PERSIAN_MONTHS[activeMonth - 1]} {toPersianDigits(activeYear)}
                </span>
              </h4>
              <p className="text-[10.5px] text-slate-400">
                امکان انتخاب مستقل هر یک از ۱۲ ماه سال جهت تحلیل رفتار مصرف‌کننده، ساعات اوج تقاضا، هیت‌مپ هفتگی و فاکتورها
              </p>
            </div>
          </div>

          {/* Fiscal Year badge (locked to fiscal period, determined automatically) */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-1.5 shadow-inner" title="سال مالی بر اساس دوره فعال در مدیریت دوره‌های زمانی و مالی تعیین شده است">
              <span className="text-[10.5px] text-slate-400 font-bold">سال مالی دوره:</span>
              <span className="text-xs font-black text-rose-400 font-mono">
                {toPersianDigits(activeYear)}
              </span>
              <span className="text-[9.5px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                متصل به دوره
              </span>
            </div>
          </div>
        </div>

        {/* 12 Months Selection Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-2">
          {PERSIAN_MONTHS.map((mName, idx) => {
            const monthNum = idx + 1;
            const isSelected = activeMonth === monthNum;
            const mStats = monthlyDashboardStats[monthNum] || { count: 0, totalAmount: 0, totalQty: 0, invoiceCount: 0 };
            const hasSales = mStats.count > 0;

            return (
              <button
                key={monthNum}
                type="button"
                onClick={() => handleMonthSelect(monthNum)}
                className={`p-2.5 rounded-2xl border transition-all text-right flex flex-col justify-between gap-1.5 cursor-pointer relative ${
                  isSelected
                    ? 'bg-rose-950/50 border-rose-500 shadow-md shadow-rose-950/30 ring-2 ring-rose-500/50'
                    : hasSales
                      ? 'bg-slate-900/80 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-slate-900'
                      : 'bg-slate-900/40 border-slate-850 hover:border-slate-750 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[10px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-slate-500'}`}>
                    {toPersianDigits(monthNum)}
                  </span>
                  {hasSales ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" title="دارای تراکنش"></span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className={`text-xs font-black truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                    {mName}
                  </div>

                  {hasSales ? (
                    <div className="text-[9.5px] text-emerald-400 font-bold truncate">
                      ✓ {toPersianDigits(mStats.count)} تراکنش
                    </div>
                  ) : (
                    <div className="text-[9.5px] text-slate-500 font-medium">
                      بدون ثبت
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Month Status & Summary Banner */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${activeMonth === 'ALL' ? 'bg-amber-400' : (monthlyDashboardStats[activeMonth]?.count || 0) > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></div>
              <div className="text-xs font-bold text-slate-200">
                وضعیت داده‌های تحلیلی {activeMonth === 'ALL' ? 'کل سال' : `ماه ${PERSIAN_MONTHS[activeMonth - 1]}`}: {' '}
                {activeMonth === 'ALL' ? (
                  <span className="text-amber-400 font-black">نمایش تجمیعی کلیه ماه‌های سال {toPersianDigits(activeYear)} ({toPersianDigits(periodTransactions.length)} تراکنش)</span>
                ) : (monthlyDashboardStats[activeMonth]?.count || 0) > 0 ? (
                  <span className="text-emerald-400 font-black">
                    {toPersianDigits(monthlyDashboardStats[activeMonth].count)} ردیف تراکنش ثبت‌شده ({toPersianDigits(monthlyDashboardStats[activeMonth].invoiceCount)} فاکتور) به ارزش {formatWithCommas(monthlyDashboardStats[activeMonth].totalAmount)} ریال
                  </span>
                ) : (
                  <span className="text-slate-400 font-normal">هیچ تراکنشی برای این ماه ثبت نشده است.</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleMonthSelect('ALL')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  activeMonth === 'ALL'
                    ? 'bg-rose-600 text-white border-rose-500 shadow-md'
                    : 'bg-slate-950 text-slate-400 hover:text-white border-slate-800 hover:border-slate-700'
                }`}
              >
                نمایش تجمیعی کل سال
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Unmapped Category-to-Department Warning Banner */}
      {unmappedCategoryNames.length > 0 && (
        <div className="bg-amber-950/35 border border-amber-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-right">
              <div className="text-xs font-black text-amber-300">
                هشدار تخصیص دپارتمان در گزارش فروش: {toPersianDigits(unmappedCategoryNames.length)} دسته‌بندی به دپارتمان تولیدی متصل نشده است
              </div>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                این دسته‌بندی‌ها تا زمان تخصیص دپارتمان، در نمودارها و جداول با عنوان «تخصیص‌نیافته» نمایش داده می‌شوند:{' '}
                <span className="font-bold text-white">{unmappedCategoryNames.join('، ')}</span>
              </p>
            </div>
          </div>
          {onNavigateToCategories && (
            <button
              type="button"
              onClick={onNavigateToCategories}
              className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-all"
            >
              تخصیص دپارتمان در تب دسته‌بندی‌ها
            </button>
          )}
        </div>
      )}

      {/* RENDER DYNAMIC NEW EXECUTIVE KPI STRIP (Today, Month, Invoices count, Average, Golden week day) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* DAILY SALES AVERAGE KEY CARD */}
        <div className="bg-gradient-to-b from-rose-950/20 to-slate-950/80 border border-rose-500/20 p-4 rounded-2xl flex flex-col justify-between relative overflow-hidden min-h-[110px]">
          <div className="absolute top-2 left-2 bg-rose-500/10 text-rose-400 p-1 rounded-lg">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-extrabold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 block" />
              میانگین فروش روز
            </span>
            <span className="text-slate-300 text-[9px] block font-semibold mt-0.5">
              میانگین فروش ماه به ازاء روز ({toPersianDigits(stats.uniqueDaysCount)} روز معامله)
            </span>
          </div>
          <div className="mt-2 text-right">
            <span className="text-base font-black text-rose-400 font-mono block">
              {formatWithCommas(stats.avgDailyRevenue)} <span className="text-[9.5px] text-slate-450 font-sans">ریال</span>
            </span>
            <p className="text-[9px] text-slate-500 mt-1">میانگین فاکتور فروش در روز: {toPersianDigits(stats.avgDailyInvoices)} عدد</p>
          </div>
        </div>

        {/* MONTHLY GROSS CARD (فروش ماه جاری) */}
        <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-2xl flex flex-col justify-between relative overflow-hidden min-h-[110px]">
          <div className="absolute top-3 left-3 bg-emerald-500/10 text-emerald-450 p-1.5 rounded-lg text-xs">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
          </div>
          <span className="text-[10.5px] text-slate-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 block" />
            فروش کل ماه جاری
          </span>
          <div className="mt-4 text-right">
            <span className="text-base font-black text-emerald-400 font-mono block">
              {formatWithCommas(stats.revenue)} <span className="text-[9.5px] text-slate-450 font-sans">ریال</span>
            </span>
            <p className="text-[9px] text-slate-500 mt-1">کل حجم فیزیکی: {toPersianDigits(stats.volume)} عدد</p>
          </div>
        </div>

        {/* TOTAL INVOICES IN PERIOD (تعداد فاکتور) */}
        <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-2xl flex flex-col justify-between relative overflow-hidden min-h-[110px]">
          <div className="absolute top-3 left-3 bg-indigo-500/10 text-indigo-400 p-1.5 rounded-lg text-xs">
            <Layers className="h-4 w-4" />
          </div>
          <span className="text-[10.5px] text-slate-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 block" />
            تعداد کل فاکتورها
          </span>
          <div className="mt-4 text-right">
            <span className="text-base font-black text-indigo-300 font-mono block">
              {toPersianDigits(stats.invoiceCount)} <span className="text-[9.5px] text-slate-450 font-sans">عدد فاکتور</span>
            </span>
            <p className="text-[9px] text-slate-500 mt-1">بر مبنای ترکیب منحصر بفرد روز × ساعت</p>
          </div>
        </div>

        {/* AVERAGE ORDER VALUE (میانگین فاکتور) */}
        <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-2xl flex flex-col justify-between relative overflow-hidden min-h-[110px]">
          <div className="absolute top-3 left-3 bg-amber-500/10 text-amber-450 p-1.5 rounded-lg text-xs">
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </div>
          <span className="text-[10.5px] text-slate-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block" />
            میانگین ارزش فاکتور
          </span>
          <div className="mt-4 text-right">
            <span className="text-base font-black text-amber-400 font-mono block">
              {formatWithCommas(stats.averageInvoiceVal)} <span className="text-[9.5px] text-slate-450 font-sans">ریال</span>
            </span>
            <p className="text-[9px] text-slate-500 mt-1">متوسط سبد خرید نقدی معاملات</p>
          </div>
        </div>

        {/* PEAK TIME & DAY SUMMARY */}
        <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-2xl flex flex-col justify-between relative overflow-hidden min-h-[110px]">
          <div className="absolute top-3 left-3 bg-sky-500/10 text-sky-450 p-1.5 rounded-lg text-xs">
            <Clock className="h-4 w-4 text-sky-400" />
          </div>
          <span className="text-[10.5px] text-slate-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 block" />
            ساعت اوج و روز طلایی هفته
          </span>
          <div className="mt-4 text-right">
            <span className="text-[14px] font-black text-slate-100 block">
              ساعت {toPersianDigits(stats.peakHour)}:۰۰ <span className="text-[9px] text-slate-500">| {stats.peakDayStr}</span>
            </span>
            <p className="text-[9px] text-sky-400 mt-1 font-bold">بیشترین حجم گسیل مراجعات</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* COLUMN 1: CONTROLS, EXCEL LOADER & CATEGORY GROUP SHARES */}
        <div className="space-y-6">

          {/* DYNAMIC PROGRESS BAR - SALES OF EACH PRODUCT GROUP (فروش هر گروه کالا) */}
          <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg">
            <h3 className="text-xs font-black text-slate-200 pb-3 border-b border-slate-800/60 flex items-center gap-1.5 mb-4">
              <PieChart className="h-4.5 w-4.5 text-orange-400" />
              سهم فروش هر دپارتمان تولیدی از کل تقاضا
            </h3>

            {categorySummary.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">داده‌های دسته‌بندی یافت نشد.</div>
            ) : (
              <div className="space-y-4">
                
                {/* Custom modern visual progress bar chart */}
                <div className="space-y-3.5">
                  {categorySummary.map((cat, idx) => {
                    const colors = [
                      'bg-rose-500 text-rose-400 dark:bg-rose-600',
                      'bg-orange-500 text-orange-400 dark:bg-orange-600',
                      'bg-amber-500 text-amber-400 dark:bg-amber-600',
                      'bg-emerald-500 text-emerald-400 dark:bg-emerald-600',
                      'bg-indigo-500 text-indigo-400 dark:bg-indigo-600'
                    ];
                    const colorClass = colors[idx % colors.length];

                    return (
                      <div key={`${cat.id}-${cat.groupKey}`} className="space-y-1 group">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-extrabold text-slate-250 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full inline-block ${colorClass.split(' ')[0]}`} />
                            {cat.name}
                          </span>
                          <span className="font-mono text-slate-400 text-[10px]">
                            {toPersianDigits(cat.percentage)}% ({toPersianDigits(Math.round(cat.qty * 100) / 100)} {cat.unit})
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800/40">
                          <div 
                            style={{ width: `${cat.percentage}%` }}
                            className={`h-full rounded-lg transition-all duration-500 ${colorClass.split(' ')[0]}`}
                          />
                        </div>
                        <div className="text-[10px] text-left font-mono text-slate-500 group-hover:text-slate-350 transition-colors">
                          {formatWithCommas(cat.amount)} ریال
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* DYNAMIC LIST OF BEST & WORST SELLING PRODUCTS */}
          <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg space-y-5">
            
            {/* Best selling */}
            <div>
              <h3 className="text-xs font-black text-emerald-400 pb-2.5 border-b border-slate-800/60 flex items-center gap-1.5 mb-3">
                <Award className="h-4.5 w-4.5" />
                پرفروش‌ترین کالاها (Top 10 ریالی)
              </h3>
              <div className="space-y-2">
                {productPerformance.bestSellers.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between text-[11px] p-2 hover:bg-slate-900/50 rounded-xl transition-all border border-transparent hover:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold font-mono text-[10px]">
                        {toPersianDigits(idx + 1)}
                      </span>
                      <div className="text-right">
                        <span className="font-bold text-slate-205 block max-w-[140px] truncate">{p.name}</span>
                        <span className="text-[9px] text-slate-500">{p.categoryName}</span>
                      </div>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-slate-200 block text-[10px]">{formatWithCommas(p.amount)} ریال</span>
                      <span className="text-[9px] text-slate-500">حجم: {toPersianDigits(Math.round(p.qty * 100) / 100)} {p.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Worst selling */}
            <div>
              <h3 className="text-xs font-black text-rose-400 pb-2.5 border-b border-slate-800/60 flex items-center gap-1.5 mb-3">
                <ShieldAlert className="h-4.5 w-4.5" />
                کم‌فروش‌ترین کالاها (Bottom 10 ریالی)
              </h3>
              <div className="space-y-2">
                {productPerformance.worstSellers.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between text-[11px] p-2 hover:bg-slate-900/50 rounded-xl transition-all border border-transparent hover:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-lg bg-rose-500/10 text-rose-450 flex items-center justify-center font-bold font-mono text-[10px]">
                        {toPersianDigits(idx + 1)}
                      </span>
                      <div className="text-right">
                        <span className="font-bold text-slate-350 block max-w-[140px] truncate">{p.name}</span>
                        <span className="text-[9px] text-slate-500">{p.categoryName}</span>
                      </div>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-slate-300 block text-[10px]">{formatWithCommas(p.amount)} ریال</span>
                      <span className="text-[9px] text-slate-550">حجم: {toPersianDigits(Math.round(p.qty * 100) / 100)} {p.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* DYNAMIC LIST OF TOP CUSTOMERS / SUPPLIERS */}
          <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg space-y-4">
            <h3 className="text-xs font-black text-slate-205 pb-3 border-b border-slate-800/60 flex items-center gap-1.5">
              <Users className="h-4.5 w-4.5 text-indigo-400" />
              مشتریان و خریداران برتر کل ماه
            </h3>
            {customerPerformance.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">داده‌های مشتریان یافت نشد.</div>
            ) : (
              <div className="space-y-2">
                {customerPerformance.slice(0, 5).map((cust, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] p-2 hover:bg-slate-900/50 rounded-xl transition-all border border-transparent hover:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold font-mono text-[10px]">
                        {toPersianDigits(idx + 1)}
                      </span>
                      <div className="text-right">
                        <span className="font-bold text-slate-200 block max-w-[140px] truncate">{cust.name}</span>
                        <span className="text-[9px] text-slate-500 font-mono">{toPersianDigits(cust.invoicesCount)} فاکتور خرید</span>
                      </div>
                    </div>
                    <div className="text-left font-mono">
                      <span className="text-emerald-450 block text-[10px] font-black">{formatWithCommas(cust.amount)} ریال</span>
                      <span className="text-[9px] text-slate-500">تعداد: {toPersianDigits(Math.round(cust.qty * 100) / 100)} • سهم: {toPersianDigits(cust.percentage)}٪</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* COLUMN 2 & 3 COMBINED: DETAILED METRIC TABS */}
        <div className="xl:col-span-2 space-y-6">

          {/* Tab selector and general filters top header */}
          <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-3xl flex flex-col gap-4">
            
            {/* Filter controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full pb-4 border-b border-slate-800/50">
              <span className="text-[10.5px] font-bold text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                <Filter className="h-3.5 w-3.5 text-rose-500" />
                فیلتر سریع:
              </span>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full sm:max-w-3xl">
                {/* Month filter combobox */}
                <select
                  value={activeMonth}
                  onChange={(e) => handleMonthSelect(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                  className="bg-slate-900 border border-slate-800 text-slate-100 text-[11px] font-black px-3 py-2 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all w-full h-[38px]"
                >
                  <option value="ALL">🗓️ همه ماه‌های سال (کل دوره)</option>
                  {[
                    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
                    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
                  ].map((mName, idx) => (
                    <option key={idx + 1} value={idx + 1}>ماه {mName} ({toPersianDigits(idx + 1)})</option>
                  ))}
                </select>

                {/* Department combobox */}
                <select
                  value={selectedCategoryFilter}
                  onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-100 text-[11px] font-black px-3 py-2 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all w-full h-[38px]"
                >
                  <option value="ALL">همه دپارتمان‌های تولیدی</option>
                  {filterDepartments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>

                {/* Custom Searchable Product Select */}
                <div ref={productSelectRef} className="relative w-full">
                  <button
                    type="button"
                    onClick={() => setProductDropdownOpen(!productDropdownOpen)}
                    className="w-full flex items-center justify-between bg-slate-900 border border-slate-800 text-slate-100 text-[11px] font-black px-3.5 py-2 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all text-right h-[38px]"
                  >
                    <span className="truncate">{selectedProductLabel}</span>
                    <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0 mr-2" />
                  </button>

                  {productDropdownOpen && (
                    <div className="absolute z-50 mt-1.5 w-full rounded-xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-72">
                      {/* Search input box */}
                      <div className="p-2 border-b border-slate-800 bg-slate-900/60 flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                        <input
                          type="text"
                          placeholder="جستجوی محصول..."
                          className="w-full bg-transparent border-none text-xs outline-none py-1 text-slate-100 placeholder-slate-500 font-sans"
                          value={productSearchQuery}
                          onChange={(e) => setProductSearchQuery(e.target.value)}
                          autoFocus
                        />
                      </div>

                      {/* Options list */}
                      <div className="overflow-y-auto flex-1 py-1 max-h-56 divide-y divide-slate-900/30">
                        {productDropdownOptions.length > 0 ? (
                          productDropdownOptions.map((opt) => {
                            const isSelected = opt.id === selectedProductIdFilter;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setSelectedProductIdFilter(opt.id);
                                  setProductDropdownOpen(false);
                                  setProductSearchQuery('');
                                }}
                                className={`w-full text-right px-4 py-2.5 text-xs font-sans flex items-center justify-between hover:bg-rose-600/10 hover:text-rose-400 transition-all cursor-pointer ${
                                  isSelected ? 'bg-rose-600/15 text-rose-400 font-black' : 'text-slate-300 font-bold'
                                }`}
                              >
                                <span className="truncate">{opt.name}</span>
                                {isSelected && <Check className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-4 py-4 text-slate-500 text-center text-xs font-sans">
                            محصولی یافت نشد.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Main view option selector - includes HEATMAP and PEAK HOURS */}
            <div className="flex flex-wrap bg-slate-900 border border-slate-850 p-0.5 rounded-xl overflow-x-auto w-full">
              <button
                onClick={() => setActiveAnalysisTab('overview')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer whitespace-nowrap ${
                  activeAnalysisTab === 'overview' ? 'bg-rose-600/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                نمای کلی و روند
              </button>
              <button
                onClick={() => setActiveAnalysisTab('heatmap')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer whitespace-nowrap ${
                  activeAnalysisTab === 'heatmap' ? 'bg-rose-600/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                هیت‌مپ روز × ساعت
              </button>
              <button
                onClick={() => setActiveAnalysisTab('peakHours')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer whitespace-nowrap ${
                  activeAnalysisTab === 'peakHours' ? 'bg-rose-600/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ساعات پیک تفکیکی
              </button>
              <button
                onClick={() => setActiveAnalysisTab('daily')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer whitespace-nowrap ${
                  activeAnalysisTab === 'daily' ? 'bg-rose-600/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ماتریس روزهای هفته
              </button>
              <button
                onClick={() => {
                  setActiveAnalysisTab('transactionsList');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer whitespace-nowrap ${
                  activeAnalysisTab === 'transactionsList' ? 'bg-rose-600/20 text-rose-450 border border-rose-500/10' : 'text-slate-300 hover:text-slate-250'
                }`}
              >
                دفتر ثبت فاکتورهای فروش
              </button>
            </div>
          </div>

          {/* TAB 1: OVERVIEW & GENERAL TREND CHARTS */}
          {activeAnalysisTab === 'overview' && (
            <div className="space-y-6">

              {/* 31 days month bar visual inline preview (فروش بر حسب روزهای ماه) */}
              {(() => {
                const peakDayObj = dailyChartData.reduce(
                  (best, cur) => (cur.amount > best.amount ? cur : best),
                  dailyChartData[0] || { day: 1, amount: 0 }
                );
                const activeDayObj = selectedDailyDay !== null
                  ? dailyChartData.find(d => d.day === selectedDailyDay) || null
                  : null;
                const hasAnyDailyRevenue = peakDayObj && peakDayObj.amount > 0;

                return (
                  <div className="bg-slate-950/40 border border-slate-800/85 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3 mb-3">
                      <h3 className="text-xs font-black text-slate-100 flex items-center gap-1.5 leading-relaxed">
                        <Calendar className="h-4 w-4 sm:h-4.5 sm:w-4.5 text-rose-500 shrink-0" />
                        <span>روند توزیع و تغییرات درآمد روزانه در ۳۱ روز ماه جاری</span>
                      </h3>
                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <span className="sm:hidden text-[10px] text-slate-400">
                          برای مشاهده همه روزها به چپ/راست بکشید
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded-lg bg-slate-900/60 border border-slate-800/70 shrink-0">
                          واحد: ریال
                        </span>
                      </div>
                    </div>

                    {/* Active / Peak Day Readout Bar (Touch-friendly on Mobile, Instant Readout on Desktop) */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800/70 text-[11px]">
                      {activeDayObj ? (
                        <>
                          <div className="flex items-center gap-2 font-bold text-slate-200">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span>روز {toPersianDigits(activeDayObj.day)} ماه:</span>
                            <strong className="text-emerald-400 font-mono font-black">
                              {toPersianDigits(formatWithCommas(activeDayObj.amount))} ریال
                            </strong>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedDailyDay(null)}
                            className="text-[10px] text-slate-400 hover:text-rose-400 font-bold cursor-pointer"
                          >
                            پاک کردن انتخاب
                          </button>
                        </>
                      ) : hasAnyDailyRevenue ? (
                        <>
                          <div className="flex items-center gap-2 font-bold text-slate-300">
                            <span className="inline-block w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                            <span>بیشترین فروش: روز {toPersianDigits(peakDayObj.day)} ماه</span>
                            <strong className="text-rose-400 font-mono font-black">
                              {toPersianDigits(formatWithCommas(peakDayObj.amount))} ریال
                            </strong>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            روی هر ستون لمس یا کلیک کنید
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">
                          تراکنش فروشی برای نمایش در نمودار ماه جاری ثبت نشده است.
                        </span>
                      )}
                    </div>

                    {/* Responsive Scrollable Bar Plot on Mobile, Full-Width on Tablet/Desktop */}
                    <div className="overflow-x-auto pb-2 -mx-1 px-1">
                      <div className="min-w-[660px] md:min-w-0 relative pt-2">
                        {/* Subtle horizontal guide lines */}
                        <div className="pointer-events-none absolute inset-x-0 top-2 bottom-6 flex flex-col justify-between">
                          <div className="border-t border-dashed border-slate-700/40 w-full" />
                          <div className="border-t border-dashed border-slate-700/30 w-full" />
                          <div className="border-t border-slate-700/50 w-full" />
                        </div>

                        <div className="flex items-end justify-between gap-1 sm:gap-[3px] relative z-10">
                          {dailyChartData.map((d) => {
                            const hasVal = d.amount > 0;
                            const pct = hasVal ? Math.max(6, (d.amount / maxDailyAmount) * 100) : 0;
                            const isPeak = hasVal && d.amount === maxDailyAmount;
                            const isSelected = selectedDailyDay === d.day;

                            return (
                              <button
                                key={d.day}
                                type="button"
                                onClick={() => setSelectedDailyDay(prev => (prev === d.day ? null : d.day))}
                                onMouseEnter={() => setSelectedDailyDay(d.day)}
                                title={`روز ${toPersianDigits(d.day)} ماه: ${formatWithCommas(d.amount)} ریال`}
                                className="flex-1 min-w-[16px] md:min-w-0 flex flex-col items-center group bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
                              >
                                {/* Explicit-height Bar Track so % height works identically on iOS Safari, Android & Desktop */}
                                <div className="w-full h-[145px] sm:h-[135px] flex items-end justify-center px-[1px]">
                                  <div
                                    style={{ height: hasVal ? `${pct}%` : '4px' }}
                                    className={`w-full rounded-t-md transition-all duration-200 ${
                                      isSelected
                                        ? 'bg-emerald-500 dark:bg-emerald-400 shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                                        : isPeak
                                        ? 'bg-gradient-to-t from-rose-600 to-amber-500 shadow-sm shadow-rose-500/25'
                                        : hasVal
                                        ? 'bg-slate-400 dark:bg-slate-600 group-hover:bg-rose-500 dark:group-hover:bg-rose-400'
                                        : 'bg-slate-200 dark:bg-slate-800/70'
                                    }`}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] md:text-[9px] font-bold mt-1.5 font-mono shrink-0 leading-none transition-colors ${
                                    isSelected
                                      ? 'text-emerald-500 dark:text-emerald-400 font-black'
                                      : isPeak
                                      ? 'text-rose-500 font-black'
                                      : 'text-slate-500 group-hover:text-rose-500'
                                  }`}
                                >
                                  {toPersianDigits(d.day)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* DYNAMIC HOURLY DISTRIBUTION OF VALUE (فروش بر حسب ساعت) */}
              {(() => {
                const maxHourlyQty = Math.max(...hourlyChartData.map(ho => ho.qty)) || 1;
                const activeHourObj = selectedHourlyHour !== null
                  ? hourlyChartData.find(h => h.hour === selectedHourlyHour) || null
                  : null;
                const peakHourObj = hourlyChartData.reduce(
                  (best, cur) => (cur.qty > best.qty ? cur : best),
                  hourlyChartData[0] || { hour: 0, qty: 0, amount: 0 }
                );

                return (
                  <div className="bg-slate-950/40 border border-slate-800/85 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl shadow-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3 mb-3">
                      <h3 className="text-xs font-black text-slate-150 flex items-center gap-1.5 leading-relaxed">
                        <Clock className="h-4 w-4 sm:h-4.5 sm:w-4.5 text-sky-400 shrink-0" />
                        <span>نمودار توزیع زمانی فروش بر حسب ساعت تراکنش (ساعات ۰ الی ۲۳)</span>
                      </h3>
                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <span className="sm:hidden text-[10px] text-slate-400">
                          برای مشاهده همه ساعات به چپ/راست بکشید
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded-lg bg-slate-900/60 border border-slate-800/70 shrink-0">
                          تعداد واحد کالا
                        </span>
                      </div>
                    </div>

                    {/* Active / Peak Hour Readout Bar */}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800/70 text-[11px]">
                      {activeHourObj ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2 font-bold text-slate-200">
                            <span className="inline-block w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                            <span>ساعت {toPersianDigits(activeHourObj.hour)}:۰۰</span>
                            <strong className="text-sky-400 font-mono font-black">
                              {toPersianDigits(activeHourObj.qty)} عدد
                            </strong>
                            <span className="text-slate-400 font-mono">
                              ({toPersianDigits(formatWithCommas(activeHourObj.amount))} ریال)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedHourlyHour(null)}
                            className="text-[10px] text-slate-400 hover:text-sky-400 font-bold cursor-pointer"
                          >
                            پاک کردن انتخاب
                          </button>
                        </>
                      ) : peakHourObj.qty > 0 ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2 font-bold text-slate-300">
                            <span className="inline-block w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                            <span>ساعت اوج فروش: {toPersianDigits(peakHourObj.hour)}:۰۰</span>
                            <strong className="text-sky-400 font-mono font-black">
                              {toPersianDigits(peakHourObj.qty)} عدد
                            </strong>
                            <span className="text-slate-400 font-mono">
                              ({toPersianDigits(formatWithCommas(peakHourObj.amount))} ریال)
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            روی هر ساعت لمس یا کلیک کنید
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">
                          داده ساعتی برای نمایش ثبت نشده است.
                        </span>
                      )}
                    </div>

                    <div className="overflow-x-auto pb-2 -mx-1 px-1">
                      <div className="min-w-[560px] md:min-w-0 relative pt-2">
                        <div className="pointer-events-none absolute inset-x-0 top-2 bottom-6 flex flex-col justify-between">
                          <div className="border-t border-dashed border-slate-700/40 w-full" />
                          <div className="border-t border-dashed border-slate-700/30 w-full" />
                          <div className="border-t border-slate-700/50 w-full" />
                        </div>

                        <div className="flex items-end justify-between gap-1 relative z-10">
                          {hourlyChartData.map((h) => {
                            const hasVal = h.qty > 0;
                            const pct = hasVal ? Math.max(6, (h.qty / maxHourlyQty) * 100) : 0;
                            const isSpike = hasVal && h.hour === stats.peakHour;
                            const isSelected = selectedHourlyHour === h.hour;

                            return (
                              <button
                                key={h.hour}
                                type="button"
                                onClick={() => setSelectedHourlyHour(prev => (prev === h.hour ? null : h.hour))}
                                onMouseEnter={() => setSelectedHourlyHour(h.hour)}
                                title={`ساعت ${toPersianDigits(h.hour)}:۰۰ — ${toPersianDigits(h.qty)} عدد (${formatWithCommas(h.amount)} ریال)`}
                                className="flex-1 min-w-[18px] md:min-w-0 flex flex-col items-center group bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
                              >
                                <div className="w-full h-[145px] sm:h-[135px] flex items-end justify-center px-[1px]">
                                  <div
                                    style={{ height: hasVal ? `${pct}%` : '4px' }}
                                    className={`w-full rounded-t-md transition-all duration-200 ${
                                      isSelected
                                        ? 'bg-emerald-500 dark:bg-emerald-400 shadow-md shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                                        : isSpike
                                        ? 'bg-gradient-to-t from-sky-600 to-sky-400 shadow-sm shadow-sky-500/25'
                                        : hasVal
                                        ? 'bg-slate-400 dark:bg-slate-600 group-hover:bg-sky-500 dark:group-hover:bg-sky-400'
                                        : 'bg-slate-200 dark:bg-slate-800/70'
                                    }`}
                                  />
                                </div>
                                <span
                                  className={`text-[10px] md:text-[9px] font-bold mt-1.5 font-mono shrink-0 leading-none transition-colors ${
                                    isSelected
                                      ? 'text-emerald-500 dark:text-emerald-400 font-black'
                                      : isSpike
                                      ? 'text-sky-500 font-black'
                                      : 'text-slate-500 group-hover:text-sky-400'
                                  }`}
                                >
                                  {toPersianDigits(h.hour)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

          {/* TAB 2: HEATMAP (روز هفته × ساعت) - Heatmap روز × ساعت */}
          {activeAnalysisTab === 'heatmap' && (
            <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg">
              <div className="border-b border-slate-800/60 pb-3 mb-4">
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                  <Flame className="h-4.5 w-4.5 text-rose-500" />
                  نقشه فراوانی تقاضا (Heatmap) تراکم درآمدی روز هفته × ساعت فروش
                </h3>
                <p className="text-[10px] text-slate-450 mt-0.5">
                  شدت رنگ مربع‌ها متناسب با سهم درآمد هر سلول از کل ساعات ماه در حال نوسان است. (سبز پررنگ یعنی بالاترین چگالی تقاضا)
                </p>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[760px] pb-1" dir="rtl">
                  
                  {/* Heatmap Grid Header (Hours 0 to 23) */}
                  <div className="grid grid-cols-25 gap-1 text-center font-mono text-[9px] text-slate-450 mb-2 border-b border-slate-900 pb-1.5">
                    <div className="text-right font-sans font-extrabold">روز هفته</div>
                    {Array.from({ length: 24 }).map((_, h) => (
                      <div key={h} className="font-extrabold">{toPersianDigits(h)}</div>
                    ))}
                  </div>

                  {/* Heatmap Grid Rows */}
                  <div className="space-y-1.5">
                    {FA_WEEKDAYS_ORDERED.map((wd) => (
                      <div key={wd} className="grid grid-cols-25 gap-1 items-center">
                        {/* Day indicator */}
                        <div className="text-right text-[10.5px] font-bold text-slate-300 pr-1 truncate">
                          {wd}
                        </div>

                        {/* Cell indicators */}
                        {Array.from({ length: 24 }).map((_, h) => {
                          const cell = weekdayHourHeatmap[wd]?.[h] || { amount: 0, qty: 0 };
                          const ratio = cell.amount > 0 ? (cell.amount / maxHeatmapCellAmount) : 0;
                          
                          // Elegant green-emerald tone gradient color scaling
                          const bgStyle = cell.amount > 0 
                            ? `rgba(16, 185, 129, ${0.08 + ratio * 0.92})` 
                            : 'rgba(30, 41, 59, 0.2)';
                          const borderStyle = cell.amount > 0
                            ? `rgba(16, 185, 129, ${0.2 + ratio * 0.6})`
                            : 'rgba(148, 163, 184, 0.05)';

                          return (
                            <div 
                              key={h}
                              style={{ backgroundColor: bgStyle, borderColor: borderStyle }}
                              className="h-7.5 rounded-lg border flex items-center justify-center relative group transition-all duration-200 cursor-help"
                            >
                              {cell.amount > 0 ? (
                                <span className="text-[8.5px] font-mono font-bold text-emerald-250">
                                  {toPersianDigits(Math.round(cell.qty * 100) / 100)}
                                </span>
                              ) : (
                                <span className="text-[8px] text-slate-800">-</span>
                              )}

                              {/* Tooltip on cellular hover */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 opacity-0 group-hover:opacity-100 bg-slate-950 text-[9px] px-2.5 py-1.5 border border-slate-800 rounded-lg transition-opacity pointer-events-none z-15 text-center w-36 shadow-xl leading-relaxed">
                                <span className="font-sans block border-b border-slate-800 pb-1 mb-1 font-extrabold text-slate-200">{wd} - ساعت {toPersianDigits(h)}:۰۰</span>
                                <span className="block text-emerald-450 font-bold">مجموع: {formatWithCommas(cell.amount)} ریال</span>
                                <span className="block text-slate-400 font-mono">تعداد: {toPersianDigits(Math.round(cell.qty * 100) / 100)} واحد</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Heatmap Legend */}
                  <div className="mt-5 flex items-center justify-end gap-2.5 text-[9px] text-slate-500 px-1 border-t border-slate-900 pt-3">
                    <span>بدون فروش / حداقل فروش</span>
                    <span className="w-3.5 h-3.5 rounded bg-slate-800/50 border border-slate-800" />
                    <span className="w-3.5 h-3.5 rounded bg-emerald-500/20 border border-emerald-500/10" />
                    <span className="w-3.5 h-3.5 rounded bg-emerald-500/50 border border-emerald-500/20" />
                    <span className="w-3.5 h-3.5 rounded bg-emerald-500/90 border border-emerald-500/50" />
                    <span>تراکم بالا (بیشترین چگالی فروش)</span>
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* TAB 3: DYNAMIC PEAK SELLING HOURS DETAILED LIST FOR THE SELECTED PRODUCT OR CATEGORY */}
          {activeAnalysisTab === 'peakHours' && (
            <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg space-y-6">
              
              <div className="border-b border-slate-800/60 pb-3">
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                  <Grid className="h-4.5 w-4.5 text-rose-500" />
                  ساعات پیک فروش به تفکیک روزهای هفته برای هر گروه کالا و محصول
                </h3>
                <p className="text-[10px] text-slate-450 mt-0.5">
                  روزهای هفته را با ساعات تمرکز فروش برای گروه کالایی منتخب و محصول دلخواه خود به صورت زنده استخراج و مقایسه کنید.
                </p>
              </div>

              {/* Selection segment */}
              <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black text-slate-350">تحلیل بر اساس:</span>
                  <div className="inline-flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setPeakHoursViewType('category')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-colors ${
                        peakHoursViewType === 'category' ? 'bg-rose-600/20 text-rose-450 font-black' : 'text-slate-400'
                      }`}
                    >
                      دپارتمان تولیدی
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeakHoursViewType('product')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md cursor-pointer transition-colors ${
                        peakHoursViewType === 'product' ? 'bg-rose-600/20 text-rose-450 font-black' : 'text-slate-400'
                      }`}
                    >
                      یک نام محصول مشخص
                    </button>
                  </div>
                </div>

                <div className="w-full md:w-64">
                  {peakHoursViewType === 'category' ? (
                    <select
                      value={selectedPeakCategoryId}
                      onChange={(e) => setSelectedPeakCategoryId(e.target.value)}
                      className="bg-slate-900 border border-slate-800 text-slate-100 text-[11px] font-black px-3 py-1.5 rounded-xl w-full cursor-pointer"
                    >
                      {filterDepartments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={selectedPeakProductId}
                      onChange={(e) => setSelectedPeakProductId(e.target.value)}
                      className="bg-slate-900 border border-slate-800 text-slate-100 text-[11px] font-black px-3 py-1.5 rounded-xl w-full cursor-pointer"
                    >
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Weekday cards display */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 pt-1">
                {FA_WEEKDAYS_ORDERED.map((wd) => {
                  let peakData = null;
                  let selectedName = '';

                  if (peakHoursViewType === 'category') {
                    peakData = weekdayPeakAnalysis.categories[wd]?.[selectedPeakCategoryId];
                    selectedName = filterDepartments.find(d => d.id === selectedPeakCategoryId)?.name || 'ـ';
                  } else {
                    peakData = weekdayPeakAnalysis.products[wd]?.[selectedPeakProductId];
                    selectedName = products.find(p => p.id === selectedPeakProductId)?.name || 'ـ';
                  }

                  const hasSales = peakData && peakData.hour > -1;

                  return (
                    <div 
                      key={wd}
                      className={`border p-4 rounded-2xl relative overflow-hidden transition-all ${
                        hasSales 
                          ? 'bg-slate-900/60 border-rose-500/20 hover:border-rose-500/40 hover:-translate-y-0.5' 
                          : 'bg-slate-950/30 border-slate-900 opacity-60'
                      }`}
                    >
                      {hasSales && (
                        <div className="absolute top-0 right-0 left-0 h-[2px] bg-rose-500/40" />
                      )}
                      
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-black text-rose-400 font-sans">{wd}</span>
                        <span className="text-[8.5px] font-mono text-slate-500 font-bold uppercase tracking-wider">PEAK REVENUE</span>
                      </div>

                      {hasSales ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-slate-205 mt-2">
                            <Clock className="h-4 w-4 text-sky-400 shrink-0" />
                            <span className="text-xs font-black">
                              ساعت {toPersianDigits(peakData.hour)}:۰۰ الی {toPersianDigits(peakData.hour + 1)}:۰۰
                            </span>
                          </div>
                          
                          <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between text-[11.5px]">
                            <span className="text-slate-400">حجم فیزیکی:</span>
                            <span className="font-bold text-slate-200 font-mono">{toPersianDigits(Math.round(peakData.qty * 100) / 100)} عدد</span>
                          </div>

                          <div className="flex items-center justify-between text-[11.5px]">
                            <span className="text-slate-400">فروش ناخالص:</span>
                            <span className="text-amber-400 font-black font-mono">{formatWithCommas(peakData.amount)} ریال</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center">
                          <span className="text-[10px] text-slate-550 block">فاقد تراکنش ثبت شده</span>
                          <span className="text-[8px] text-slate-600 block mt-1">{selectedName}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          )}

          {/* TAB 4: WESTERN TABLE MATRIX FOR PRODUCT WEEKDAY PERFORMANCE */}
          {activeAnalysisTab === 'daily' && (
            <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg">
              <div className="flex flex-wrap items-center justify-between border-b border-slate-800/60 pb-3 mb-4 gap-2">
                <div>
                  <h3 className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                    <Layers className="h-4.5 w-4.5 text-amber-500" />
                    ماتریس فروش روزهای هفته به تفکیک جداگانه محصولات
                  </h3>
                  <p className="text-[9.5px] text-slate-450 mt-0.5">آمار جامع درآمد ناخالص ریالی ریخته شده در روزهای کاری هفته کالاها</p>
                </div>
              </div>

              {productWeeklyMatrix.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">تراکنشی مطابق فیلتراسیون‌های فوق یافت نگردید.</div>
              ) : (
                <div className="overflow-x-auto max-w-full">
                  <table className="w-full text-right text-[11px] border-collapse min-w-[700px] divide-y divide-slate-800">
                    <thead>
                      <tr className="bg-slate-950/80 text-slate-400">
                        <th className="p-3 text-right">محصول</th>
                        <th className="p-3 text-center">دسته‌بندی</th>
                        {FA_WEEKDAYS_ORDERED.map(w => (
                          <th key={w} className="p-3 text-center">{w}</th>
                        ))}
                        <th className="p-3 text-center bg-slate-900 text-slate-200">مجموع فروش</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {productWeeklyMatrix.map((row) => (
                        <tr key={row.productId} className="hover:bg-slate-900/40 transition-colors">
                          <td className="p-3 font-extrabold text-slate-200">{row.productName}</td>
                          <td className="p-3 text-center text-slate-450">{row.categoryName}</td>
                           {FA_WEEKDAYS_ORDERED.map(w => {
                             const amt = row.weekdayAmounts[w] || 0;
                             const qty = row.weekdayQtys[w] || 0;
                             const roundedQty = Math.round(qty * 100) / 100;
                             return (
                               <td 
                                 key={w} 
                                 title={`${toPersianDigits(roundedQty)} عدد فروخته شده`}
                                 className={`p-3 text-center font-mono text-[10.5px] ${
                                   amt > 0 ? 'text-emerald-400 font-bold' : 'text-slate-700'
                                 }`}
                               >
                                 {amt > 0 ? (
                                   <div>
                                     <div>{formatWithCommas(amt)}</div>
                                     <span className="text-[8px] text-slate-500">({toPersianDigits(roundedQty)} عدد)</span>
                                   </div>
                                 ) : '۰'}
                               </td>
                             );
                           })}
                          <td className="p-3 text-center font-bold font-mono text-amber-405 bg-amber-500/5">
                            {formatWithCommas(row.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900/90 font-black text-rose-300 border-t border-slate-705">
                        <td className="p-3 text-right">جمع کل ستون‌ها</td>
                        <td className="p-3 text-center text-slate-400">-</td>
                        {FA_WEEKDAYS_ORDERED.map(w => {
                          const amt = productWeeklyMatrixTotals.totals[w]?.amount || 0;
                          const qty = productWeeklyMatrixTotals.totals[w]?.qty || 0;
                          const roundedQty = Math.round(qty * 100) / 100;
                          return (
                            <td 
                              key={w} 
                              title={`${toPersianDigits(roundedQty)} عدد مجموع کل`}
                              className="p-3 text-center font-mono text-[10.5px] text-emerald-400 font-black"
                            >
                              {amt > 0 ? (
                                <div>
                                  <div>{formatWithCommas(amt)}</div>
                                  <span className="text-[8.5px] text-slate-400">({toPersianDigits(roundedQty)} عدد)</span>
                                </div>
                              ) : '۰'}
                            </td>
                          );
                        })}
                        <td className="p-3 text-center font-black font-mono text-amber-400 bg-amber-500/10">
                          {formatWithCommas(productWeeklyMatrixTotals.grandTotalAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: TRANSACTIONAL INVOICES INTEGRATED LEDGER */}
          {activeAnalysisTab === 'transactionsList' && (
            <div className="space-y-6">
              
              {/* Toolbar & Search Bar */}
              <div className="bg-slate-950/40 border border-slate-800/85 p-5 rounded-3xl shadow-lg space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                      <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-500" />
                      دفتر ثبت تراکنش‌ها و اقلام فاکتورهای فروش ماه جاری
                    </h3>
                    <p className="text-[9.5px] text-slate-450 mt-0.5">ثبت دستی فاکتورها، ویرایش درون‌خطی و فیلتراسیون جامع سوابق فروش کارگاه</p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2.5">
                    <button
                      onClick={() => setShowAddForm(!showAddForm)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/20 rounded-xl text-[10.5px] font-black transition-all cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      {showAddForm ? 'بستن فرم ثبت فاکتور' : 'ثبت فاکتور فروش جدید'}
                    </button>
                    
                    <button
                      onClick={handleExportExcel}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10.5px] font-black transition-all cursor-pointer"
                    >
                      <Download className="h-4 w-4" />
                      خروجی اکسل فروش ماهانه
                    </button>
                  </div>
                </div>

                {/* Add Transaction Form Collapsible */}
                {showAddForm && (
                  <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">شماره فاکتور</label>
                        <input
                          type="text"
                          placeholder="مثلاً INV-1200"
                          value={newInvoiceNumber}
                          onChange={(e) => setNewInvoiceNumber(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-rose-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">مشتری/ تامین کننده</label>
                        <input
                          type="text"
                          placeholder="مثلاً پک پخش گاتان"
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-rose-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">انتخاب محصول</label>
                        <select
                          value={newProductId}
                          onChange={(e) => handleProductSelectionChange(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-rose-500 cursor-pointer"
                        >
                          {products.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">تاریخ فروش (شمسی)</label>
                        <input
                          type="text"
                          placeholder="مثلاً 1405/03/15"
                          value={newDateStr}
                          onChange={(e) => setNewDateStr(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg font-mono focus:outline-none focus:border-rose-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">ساعت فروش (۰ الی ۲۳)</label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={newHour}
                          onChange={(e) => setNewHour(parseInt(e.target.value, 10) || 12)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg font-mono focus:outline-none focus:border-rose-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">تعداد فروش رفته</label>
                        <input
                          type="number"
                          min="1"
                          value={newQty}
                          onChange={(e) => handleQtySelectionChange(parseInt(e.target.value, 10) || 1)}
                          className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg font-mono focus:outline-none focus:border-rose-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-450 mb-1 font-bold">مجموع مبلغ فروش (ريال)</label>
                        <input
                          type="number"
                          value={newAmount}
                          onChange={(e) => setNewAmount(parseInt(e.target.value, 10) || 0)}
                          className="w-full bg-slate-950 border border-slate-805 text-slate-100 text-[11px] px-2.5 py-1.5 rounded-lg font-mono focus:outline-none focus:border-rose-500 bg-slate-900 font-bold"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handleAddNewTransaction}
                        className="flex items-center gap-1 px-4 py-1.5 bg-emerald-650 hover:bg-emerald-600 text-white rounded-xl text-[10.5px] font-black tracking-wide cursor-pointer transition-colors"
                      >
                        <Check className="h-4.5 w-4.5" />
                        افزودن قطعی ردیف فاکتور به لیست
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub Search Panel */}
                <div className="flex items-center gap-2.5 bg-slate-900/40 p-2.5 rounded-2xl border border-slate-900">
                  <div className="relative flex-1">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="جستجو بر اساس شماره فاکتور، نام تفصیلی کالا، کد کالا یا تاریخ ثبت..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="w-full bg-slate-950/70 border border-slate-800 rounded-xl pr-9 pl-3.5 py-2 text-[10.5px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-500/50"
                    />
                  </div>
                  
                  {searchTerm && (
                    <button
                      onClick={() => {
                        setSearchTerm('');
                        setCurrentPage(1);
                      }}
                      className="text-[9.5px] text-slate-405 hover:text-rose-400 px-2 py-1 font-bold bg-slate-950 border border-slate-850 rounded-lg cursor-pointer"
                    >
                      پاک کردن فیلتر متنی
                    </button>
                  )}
                </div>
              </div>

              {/* Transactions Ledger Panel */}
              <div className="bg-slate-950/40 border border-slate-800/85 rounded-3xl shadow-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-[11px] border-collapse divide-y divide-slate-800">
                    <thead>
                      <tr className="bg-slate-950/80 text-slate-400 text-[10px]">
                        <th className="p-3 text-center w-12">ردیف</th>
                        <th className="p-3 text-right">شماره فاکتور</th>
                        <th className="p-3 text-right">مشتری/ تامین کننده</th>
                        <th className="p-3 text-right">کد کالا</th>
                        <th className="p-3 text-right">نام تفصیلی محصول</th>
                        <th className="p-3 text-center">تاریخ</th>
                        <th className="p-3 text-center">ساعت ثبت</th>
                        <th className="p-3 text-center">تعداد فروش</th>
                        <th className="p-3 text-left">مجموع مبلغ فروش</th>
                        <th className="p-3 text-center w-28">عملیات مدیریت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {paginatedTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-500 text-xs">
                            هیچ ردیف فاکتور فروش فعالی مطابق با فیلترها و کلمات جستجو پیدا نشد.
                          </td>
                        </tr>
                      ) : (
                        paginatedTransactions.map((tx, idx) => {
                          const itemIndex = (currentPage - 1) * itemsPerPage + idx + 1;
                          const pCode = products.find(p => p.id === tx.productId)?.code || 'ـ';
                          const isEditing = editingTxId === tx.id;

                          return (
                            <tr key={tx.id} className="hover:bg-slate-900/30 transition-colors">
                              {/* Index */}
                              <td className="p-3 text-center font-mono text-slate-500">{toPersianDigits(itemIndex)}</td>
                              
                              {/* Invoice Number */}
                              <td className="p-3 font-bold text-slate-200">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editInvoiceNum}
                                    onChange={(e) => setEditInvoiceNum(e.target.value)}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-24"
                                  />
                                ) : (
                                  <span className="text-indigo-400 font-sans">{toPersianDigits(tx.invoiceNumber || 'ـ')}</span>
                                )}
                              </td>

                              {/* Customer/Supplier */}
                              <td className="p-3 font-medium text-slate-250">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editCustomerName}
                                    onChange={(e) => setEditCustomerName(e.target.value)}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-32"
                                  />
                                ) : (
                                  <span>{tx.customerName || 'مشتری عمومی'}</span>
                                )}
                              </td>

                              {/* Product Code */}
                              <td className="p-3 text-slate-400 font-mono">{toPersianDigits(pCode)}</td>

                              {/* Product Name */}
                              <td className="p-3 font-extrabold text-slate-150">
                                {tx.productName}
                                {(() => {
                                  const d = resolveTxDepartment(tx);
                                  return (
                                    <span className={`block text-[8.5px] mt-0.5 ${d.isUnassigned ? 'text-amber-400' : 'text-slate-400'}`}>
                                      دپارتمان: {d.isUnassigned ? 'تخصیص‌نیافته' : d.name}
                                      {tx.categoryName ? ` (${tx.categoryName})` : ''}
                                    </span>
                                  );
                                })()}
                              </td>

                              {/* Date */}
                              <td className="p-3 text-center font-mono">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editDateStr}
                                    onChange={(e) => setEditDateStr(e.target.value)}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-24 font-mono text-center"
                                  />
                                ) : (
                                  toPersianDigits(tx.dateStr)
                                )}
                              </td>

                              {/* Hour */}
                              <td className="p-3 text-center font-mono">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="0"
                                    max="23"
                                    value={editHour}
                                    onChange={(e) => setEditHour(parseInt(e.target.value, 10) || 12)}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-14 font-mono text-center"
                                  />
                                ) : (
                                  <span>ساعت {toPersianDigits(tx.hour)}:۰۰</span>
                                )}
                              </td>

                              {/* Qty */}
                              <td className="p-3 text-center font-mono font-bold text-slate-100">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="1"
                                    value={editQty}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 1;
                                      setEditQty(val);
                                      const prod = products.find(p => p.id === tx.productId);
                                      if (prod) {
                                        setEditAmount((prod.salePrice || 75000) * val);
                                      }
                                    }}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-14 font-mono text-center"
                                  />
                                ) : (
                                  <span>{toPersianDigits(Math.round(tx.qtySold * 100) / 100)} عدد</span>
                                )}
                              </td>

                              {/* Amount */}
                              <td className="p-3 text-left font-mono font-black text-emerald-400">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(parseInt(e.target.value, 10) || 0)}
                                    className="bg-slate-950 border border-slate-800 text-slate-100 text-[11px] px-2 py-1 rounded w-28 font-mono text-left font-bold"
                                  />
                                ) : (
                                  <span>{formatWithCommas(tx.salesAmount)} ریال</span>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="p-3 text-center">
                                {isEditing ? (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      onClick={() => handleSaveEditRow(tx.id)}
                                      className="p-1 px-2.5 bg-emerald-600/25 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-650 rounded-lg text-[9.5px] font-black cursor-pointer transition-colors"
                                      title="ثبت تغییرات"
                                    >
                                      ذخیره
                                    </button>
                                    <button
                                      onClick={() => setEditingTxId(null)}
                                      className="p-1 px-2 bg-slate-905 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg text-[9.5px] cursor-pointer"
                                      title="انصراف"
                                    >
                                      لغو
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      onClick={() => handleStartEditRow(tx)}
                                      className="p-1.5 text-slate-400 hover:text-rose-455 hover:bg-rose-500/5 rounded-lg border border-transparent hover:border-rose-500/10 cursor-pointer transition-all"
                                      title="ویرایش سطر فاکتور"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransaction(tx.id)}
                                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-500/5 rounded-lg border border-transparent hover:border-red-500/10 cursor-pointer transition-all"
                                      title="حذف دائمی ردیف"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls Footer */}
                {totalPages > 1 && (
                  <div className="p-4 bg-slate-950/80 border-t border-slate-850 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">
                      نمایش ردیف‌های <strong className="text-slate-200 font-mono">{toPersianDigits((currentPage - 1) * itemsPerPage + 1)}</strong> الی{' '}
                      <strong className="text-slate-200 font-mono">{toPersianDigits(Math.min(currentPage * itemsPerPage, filteredTransactions.length))}</strong> از مجموع{' '}
                      <strong className="text-rose-450 font-black font-mono">{toPersianDigits(filteredTransactions.length)}</strong> تراکنش ثبت شده
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      
                      <div className="px-3 py-1 font-bold bg-rose-500/10 border border-rose-500/15 text-rose-400 rounded-lg font-mono">
                        صفحه {toPersianDigits(currentPage)} از {toPersianDigits(totalPages)}
                      </div>

                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* AI INTERACTIVE INSIGHTS SUBSECTION (PRE-CONFIGURED FOR REALISTIC ADVICES) */}
          <div className="bg-gradient-to-br from-indigo-950/20 via-slate-900 to-amber-950/10 border border-indigo-500/15 p-5 rounded-3xl shadow-lg relative">
            <div className="absolute left-6 top-6 text-indigo-500/10">
              <Sparkles className="h-24 w-24" />
            </div>

            <h3 className="text-xs font-black text-indigo-350 pb-3 border-b border-indigo-850 flex items-center gap-1.5 mb-4">
              <Sparkles className="h-4 w-4 text-amber-450" />
              توصیه‌های هوشمند مدیران و راهبردهای کلان کارگاه تولید گاتان
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 bg-slate-950/40 border border-slate-850 p-3.5 rounded-xl">
                <span className="text-[10.5px] font-black text-emerald-400 flex items-center gap-1.5 mb-2">
                  <Check className="h-4 w-4" />
                  برنامه‌ریزی شیفت عصرگاهی کارگاه بر مبنای پیک زمان فروش
                </span>
                <p className="text-[9.5px] text-slate-350 leading-relaxed">
                  بررسی‌ها در سیستم پایش نشان می‌دهد دوره ساعت اوج تراکنش فروش کارگاه ساعت <strong className="text-rose-450 font-black">{toPersianDigits(stats.peakHour)}:۰۰</strong> است. تأمین و توزیع متناسب خمیرگیرها و پرسنل فر کارگاه در محدوده ۱ ساعت پیش و پس از این بازه، راندمان تحویل کالا را تا حدود <strong className="text-emerald-450">۴۰٪</strong> افزایش خواهد داد.
                </p>
              </div>

              <div className="space-y-1 bg-slate-950/40 border border-slate-850 p-3.5 rounded-xl">
                <span className="text-[10.5px] font-black text-indigo-400 flex items-center gap-1.5 mb-2">
                  <Check className="h-4 w-4" />
                  مدیریت زنجیره تأمین گروه‌های کالایی استراتژیک
                </span>
                <p className="text-[9.5px] text-slate-350 leading-relaxed">
                  دسته کالایی <strong className="text-indigo-400">{categorySummary[0]?.name || 'اولیه'}</strong> با دارا بودن سهم بازاری معادل <strong className="text-rose-450 font-black">{toPersianDigits(categorySummary[0]?.percentage || 0)}٪</strong>، هسته نقدینگی ماه جاری را پشتیبانی می‌کند. نظارت بر زنجیره مواد اولیه آن در انبار اولویت بالایی دارد.
                </p>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
