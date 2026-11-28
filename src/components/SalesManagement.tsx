/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  AppDatabase, Product, ProductCategory, Department, SalesPeriod, ProductSale, SalesTransaction, PackagingType
} from '../types';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString, normalizePersianString, toEnglishDigits, getFiscalYearFromPeriod, getDefaultYearMonthFromPeriod,
  getProductFormulaKey, getMaterialFormulaKey, doesFormulaMatchProduct, doesIngredientMatchMaterial, normalizeAccountingCode
} from '../utils/persianUtils';
import { decodeFileBuffer, parseCSVText } from '../utils/csvUtils';
import { 
  Plus, Search, Edit2, Trash2, CheckCircle, AlertTriangle, FileSpreadsheet, 
  Printer, Save, TrendingUp, TrendingDown, Layers, BarChart3, PieChart, Info, DollarSign, Download,
  Calendar, Sparkles, RefreshCw, Upload, Clock, Check, CheckSquare, X, Package, Box, Barcode as BarcodeIcon, Scale, Copy, ShoppingBag, Tag, ArrowRight
} from 'lucide-react';
import * as XLSX from 'xlsx';
import SearchableSelect from './SearchableSelect';
import SalesAnalysisDashboard from './SalesAnalysisDashboard';
import { BarcodeManagement } from './BarcodeManagement';
import { parseScannedBarcode } from '../utils/barcodeParser';
import { generateCode128Svg } from '../utils/barcodeSvg';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../utils/simpleId';
import { getPeriodBarcodeSettings } from '../utils/periodIsolation';
import { CopySectionKey } from '../utils/periodCopyEngine';
import { CopyFromPeriodModal } from './ui/CopyFromPeriodModal';
import {
  ModuleHeader,
  ModulePrimaryTabs,
  ErpButton,
  ERP_BUTTON_LABELS,
  KpiStrip,
  UnifiedToolbar,
  UnifiedFilterBar,
  UNIFIED_FILTER_SELECT_CLASS,
  UNIFIED_FILTER_LABEL_CLASS,
} from './ui/UnifiedErpUi';
import {
  exportRowsToExcel,
  downloadTemplateExcel,
  readSpreadsheetRows,
  pickRowField,
} from '../utils/tableIoUtils';

interface SalesManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

export default function SalesManagement({ db, onUpdateDb, activePeriodId }: SalesManagementProps) {
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'packaging' | 'barcodes' | 'records' | 'analysis' | 'shelf_tags'>('products');

  const [showCopyModal, setShowCopyModal] = useState(false);

  const activeCopySection: CopySectionKey = useMemo(() => {
    switch (activeTab) {
      case 'categories': return 'productCategories';
      case 'packaging': return 'packagingTypes';
      case 'barcodes': return 'barcodeSettings';
      case 'records': return 'salesPeriods';
      case 'analysis': return 'salesTransactions';
      default: return 'products';
    }
  }, [activeTab]);

  // Packaging Types Management State & Handlers (strictly isolated per period)
  const packagingTypesList = useMemo(() => {
    return (db.packagingTypes || []).filter(pt => pt.periodId === activePeriodId);
  }, [db.packagingTypes, activePeriodId]);

  const [pkgSearch, setPkgSearch] = useState('');
  const [newPkgType, setNewPkgType] = useState({ name: '', description: '' });
  const [editingPkgType, setEditingPkgType] = useState<PackagingType | null>(null);

  const searchedPkgTypes = useMemo(() => {
    if (!pkgSearch.trim()) return packagingTypesList;
    return packagingTypesList.filter(pt => 
      matchPersianString(pt.name, pkgSearch) ||
      (pt.description && matchPersianString(pt.description, pkgSearch))
    );
  }, [packagingTypesList, pkgSearch]);

  const handleAddOrUpdatePkgType = (e: React.FormEvent) => {
    e.preventDefault();
    const normPkg = (s?: string) => String(s || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');
    const otherPeriodsPkg = (db.packagingTypes || []).filter(pt => pt.periodId !== activePeriodId);
    if (editingPkgType) {
      const trimmed = editingPkgType.name.trim().replace(/\s+/g, ' ');
      if (!trimmed) return;
      if (packagingTypesList.some(pt => pt.id !== editingPkgType.id && normPkg(pt.name) === normPkg(trimmed))) {
        alert('نوع بسته‌بندی با این نام قبلاً ثبت شده است.');
        return;
      }
      const updatedPeriodList = packagingTypesList.map(pt => pt.id === editingPkgType.id ? { ...editingPkgType, periodId: activePeriodId, name: trimmed } : pt);
      onUpdateDb({ ...db, packagingTypes: [...otherPeriodsPkg, ...updatedPeriodList] });
      setEditingPkgType(null);
    } else {
      const trimmed = newPkgType.name.trim().replace(/\s+/g, ' ');
      if (!trimmed) return;
      if (packagingTypesList.some(pt => normPkg(pt.name) === normPkg(trimmed))) {
        alert('نوع بسته‌بندی با این نام قبلاً ثبت شده است.');
        return;
      }
      const created: PackagingType = {
        id: nextSimpleId(db.packagingTypes || [], 'pkg'),
        periodId: activePeriodId,
        name: trimmed,
        description: newPkgType.description.trim()
      };
      onUpdateDb({ ...db, packagingTypes: [...otherPeriodsPkg, ...packagingTypesList, created] });
      setNewPkgType({ name: '', description: '' });
    }
  };

  const handleDeletePkgType = (id: string) => {
    askConfirm(
      'حذف نوع بسته‌بندی',
      'آیا از حذف این نوع بسته‌بندی اطمینان دارید؟',
      () => {
        const updatedList = (db.packagingTypes || []).filter(pt => pt.id !== id);
        onUpdateDb({ ...db, packagingTypes: updatedList });
      }
    );
  };

  const handleResetDefaultPkgTypes = () => {
    const otherPeriodsPkg = (db.packagingTypes || []).filter(pt => pt.periodId !== activePeriodId);
    const nextPkgId = createSimpleIdGenerator(otherPeriodsPkg, 'pkg');
    const defaults: PackagingType[] = [
      { id: nextPkgId(), periodId: activePeriodId, name: 'سلفون', description: 'پوشش شفاف سلفونی با مقاومت رطوبتی بالا' },
      { id: nextPkgId(), periodId: activePeriodId, name: 'شیرینک', description: 'بسته‌بندی حرارتی شیرینک فیلم' },
      { id: nextPkgId(), periodId: activePeriodId, name: 'لانچ باکس', description: 'جعبه پذیرایی ویژه تشریفاتی' },
      { id: nextPkgId(), periodId: activePeriodId, name: 'جعبه مقوایی', description: 'جعبه مقوایی کادویی و عمومی' },
      { id: nextPkgId(), periodId: activePeriodId, name: 'کارتن', description: 'کارتن پنج‌لایه توزیع صادراتی' }
    ];
    onUpdateDb({ ...db, packagingTypes: [...otherPeriodsPkg, ...defaults] });
  };

  // Custom confirmation modal state for sandboxed iframe compatibility
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

  // Advanced Dual-Excel Import System State
  const [showAdvancedImport, setShowAdvancedImport] = useState(false);
  const [detailFile, setDetailFile] = useState<File | null>(null);
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [advancedImportStatus, setAdvancedImportStatus] = useState<{
    type: 'idle' | 'success' | 'error';
    message: string;
  }>({ type: 'idle', message: '' });
  
  const [reconciliationResult, setReconciliationResult] = useState<{
    totalImportedLines: number;
    totalImportedAmount: number;
    matchedInvoicesCount: number;
    unmatchedDetailedInvoices: string[];
    detailedTransactions: SalesTransaction[];
    isComparisonDone: boolean;
    existingPeriodSalesAmount: number;
    newProductsDetected?: { code: string; name: string; categoryName?: string; salePrice: number }[];
  } | null>(null);

  const [unregisteredProductsToDefine, setUnregisteredProductsToDefine] = useState<{
    code: string;
    accountId: string;
    name: string;
    categoryName?: string;
    categoryId: string;
    weight: string;
    salePrice: number;
  }[] | null>(null);

  const FA_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];

  const cleanHeader = (h: string): string => {
    return toEnglishDigits(String(h || ''))
      .trim()
      .replace(/[\u200C\u200D\u200E\u200F\uFEFF]/g, '')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[\u064A\u0649]/g, 'ی')
      .replace(/\u0643/g, 'ک')
      .replace(/\u0629/g, 'ه')
      .replace(/[_\-\/\.\:\(\)\[\]]+/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  };

  const parseTimeValue = (rawVal: any): { timeStr: string, hourVal: number } => {
    if (rawVal === undefined || rawVal === null) {
      return { timeStr: '12:00', hourVal: 12 };
    }
    
    if (rawVal instanceof Date) {
      const h = rawVal.getHours();
      const m = rawVal.getMinutes();
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hourVal: h
      };
    }

    const valStr = String(rawVal).trim();
    if (!valStr) {
      return { timeStr: '12:00', hourVal: 12 };
    }

    const numericVal = Number(rawVal);
    if (!isNaN(numericVal) && typeof rawVal === 'number' && numericVal >= 0 && numericVal < 1) {
      const totalMinutes = Math.round(numericVal * 24 * 60);
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = totalMinutes % 60;
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hourVal: h
      };
    }

    if (valStr.startsWith('0.') && !isNaN(Number(valStr))) {
      const floatVal = parseFloat(valStr);
      if (floatVal >= 0 && floatVal < 1) {
        const totalMinutes = Math.round(floatVal * 24 * 60);
        const h = Math.floor(totalMinutes / 60) % 24;
        const m = totalMinutes % 60;
        return {
          timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          hourVal: h
        };
      }
    }

    if (valStr.includes(':')) {
      let timePart = valStr;
      if (valStr.includes(' ')) {
        const parts = valStr.split(' ');
        const found = parts.find(p => p.includes(':'));
        if (found) timePart = found;
      }
      const tParts = timePart.split(':');
      const h = parseInt(tParts[0], 10);
      const m = parseInt(tParts[1] || '0', 10);
      if (!isNaN(h) && h >= 0 && h <= 23) {
        return {
          timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          hourVal: h
        };
      }
    }

    const intHour = parseInt(valStr, 10);
    if (!isNaN(intHour) && intHour >= 0 && intHour <= 23) {
      return {
        timeStr: `${String(intHour).padStart(2, '0')}:00`,
        hourVal: intHour
      };
    }

    return { timeStr: '12:00', hourVal: 12 };
  };

  const cleanInvoiceValue = (val: any): string => {
    if (val === undefined || val === null) return '';
    const engStr = toEnglishDigits(String(val)).trim().toLowerCase();
    let cleaned = engStr;
    if (cleaned.endsWith('.0')) {
      cleaned = cleaned.substring(0, cleaned.length - 2);
    }
    if (/^\d+$/.test(cleaned)) {
      cleaned = String(parseInt(cleaned, 10));
    }
    return cleaned;
  };

  const isInvoiceNum = (h: string) => {
    if (h.includes('کدکالا') || h.includes('كدكالا') || h.includes('کدمشتری') || h.includes('کدمشتري') || h.includes('ناممشتری') || h.includes('نامکالا') || h.includes('نامكالا')) {
      return false;
    }
    if (h.includes('سرجمع') || h.includes('مبلغ') || h.includes('تعداد') || h.includes('فی') || h.includes('تخفیف') || h.includes('تخفيف') || h.includes('تاریخ') || h.includes('تاريخ')) {
      return false;
    }
    return h.includes('شماره') || h.includes('سند') || h.includes('مدرک') || h.includes('فاکتور') || h.includes('فاكتور') || h.includes('invoice') || h.includes('inv') || h.includes('f_') || h === 'ردیف' || h === 'ردیففاکتور';
  };
  const isCustomerName = (h: string) => h.includes('ناممشتری') || h.includes('ناممشتري') || h.includes('customer') || h.includes('مشتری');
  const isProductCode = (h: string) => {
    if (h.includes('فاکتور') || h.includes('فاكتور') || h.includes('مشتری') || h.includes('مشتري') || h.includes('حسابدر') || h.includes('سند') || h.includes('مدرک') || h.includes('نامکالا') || h.includes('نامكالا') || h.includes('عنوان') || h.includes('گروه') || h.includes('دسته') || h.includes('دپارتمان')) {
      return false;
    }
    return h.includes('کدکالا') || h.includes('كدكالا') || h.includes('productcode') || h === 'کد' || h === 'كد' || h === 'code' || h.includes('کدمحصول') || h.includes('شناسهکالا') || h.includes('شناسه');
  };
  const isDate = (h: string) => h.includes('تاریخ') || h.includes('تاريخ') || h.includes('date');
  const isProductGroup = (h: string) => {
    if (h.includes('مشتری') || h.includes('مشتري') || h.includes('customer') || h.includes('کدکالا') || h.includes('شناسهکالا')) {
      return false;
    }
    return h.includes('گروهکالا') ||
           h.includes('گروهكالا') ||
           h.includes('گروهمحصول') ||
           h.includes('گروهفروش') ||
           h.includes('نامگروه') ||
           h.includes('عنوانگروه') ||
           h.includes('کدگروه') ||
           h.includes('دسته') ||
           h.includes('دپارتمان') ||
           h.includes('category') ||
           h.includes('group') ||
           h === 'گروه' ||
           h === 'بخش' ||
           h === 'dept';
  };
  const isProductName = (h: string) => {
    if (isProductGroup(h)) return false;
    if (h.includes('کدکالا') || h.includes('كدكالا') || h.includes('کدمشتری') || h.includes('کدمشتري') || h.includes('ناممشتری') || h.includes('ناممشتري')) {
      return false;
    }
    if (h.includes('کد') || h.includes('كد') || h.includes('شناسه') || h.includes('بارکد') || h.includes('باركد') || h.includes('بارکدکالا')) {
      return false;
    }
    return h.includes('نامکالا') || 
           h.includes('نامكالا') || 
           h.includes('productname') || 
           h.includes('نام_کالا') || 
           h.includes('شرحکالا') || 
           h.includes('شرح') || 
           h.includes('عنوان') || 
           h.includes('ناممحصول') || 
           h.includes('product') || 
           h.includes('کالاخدمت') ||
           h === 'نام' ||
           h === 'کالا' ||
           h === 'كالا';
  };
  const isQty = (h: string) => h.includes('تعدادفروش') || h.includes('تعداد') || h.includes('مقدار') || h.includes('qty') || h.includes('quantity');
  const isPrice = (h: string) => {
    if (h.includes('کل') || h.includes('جمع') || h.includes('تخفیف') || h.includes('تخفيف') || h.includes('نهایی') || h.includes('total') || h.includes('sum')) {
      return false;
    }
    return h.includes('فی') || h.includes('قیمت') || h.includes('قيمت') || h.includes('unitprice') || h.includes('rate') || h === 'قیمت';
  };
  const isDiscount = (h: string) => h.includes('تخفیف') || h.includes('تخفيف') || h.includes('discount') || h.includes('disc');
  const isAmount = (h: string) => {
    if (h.includes('تعداد') || h.includes('تخفیف') || h.includes('تخفيف') || h.includes('فی')) {
      return false;
    }
    return h.includes('مبلغفروش') || h.includes('مبلغ') || h.includes('جمع') || h.includes('amount') || h.includes('total') || h.includes('خالص');
  };

  const isInvNum2 = (h: string) => {
    if (h.includes('کدکالا') || h.includes('كدكالا') || h.includes('کدمشتری') || h.includes('کدمشتري') || h.includes('ناممشتری') || h.includes('نامکالا') || h.includes('نامكالا')) {
      return false;
    }
    if (h.includes('سرجمع') || h.includes('مبلغ') || h.includes('تعداد') || h.includes('فی') || h.includes('تخفیف') || h.includes('تخفيف') || h.includes('تاریخ') || h.includes('تاريخ')) {
      return false;
    }
    return h.includes('شماره') || h.includes('سند') || h.includes('مدرک') || h.includes('فاکتور') || h.includes('فاكتور') || h.includes('invoice') || h.includes('inv') || h.includes('f_') || h === 'ردیف' || h === 'ردیففاکتور';
  };
  const isDate2 = (h: string) => h.includes('تاریخ') || h.includes('تاريخ') || h.includes('date');
  const isCustCode2 = (h: string) => h.includes('کدمشتری') || h.includes('کدمشتري') || h.includes('customercode');
  const isCustName2 = (h: string) => h.includes('ناممشتری') || h.includes('ناممشتري') || h.includes('customer') || h.includes('مشتری');
  const isTotalSales2 = (h: string) => h.includes('سرجمعفروش') || h.includes('سرجمع') || h.includes('سرجمع_فروش') || h.includes('total');
  const isTimeSale2 = (h: string) => h.includes('زمانفروش') || h.includes('زمانانجام') || h.includes('زمانتراکنش') || h.includes('زمان') || h.includes('ساعتفروش') || h.includes('ساعتانجام') || h.includes('ساعتتراکنش') || h.includes('ساعت') || h.includes('time') || h.includes('hour') || h.includes('clock');

  const localJalaliToGregorian = (jy: number, jm: number, jd: number): Date => {
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
  };

  const localGetPersianWeekdayOfDate = (dateStr: string): string => {
    try {
      const parts = dateStr.replace(/-/g, '/').split('/');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
  
        if (year > 1300 && year < 1500 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const gregDate = localJalaliToGregorian(year, month, day);
          const dayIdx = gregDate.getDay();
          return FA_WEEKDAYS[dayIdx];
        }
      }
    } catch (err) {
      console.error('Error parsing weekday', err);
    }
    return 'شنبه';
  };

  const matchProductCategoryInList = (
    rawCatName: string | undefined,
    catList: ProductCategory[]
  ): ProductCategory | undefined => {
    if (!rawCatName || !catList || catList.length === 0) return undefined;
    const normStrict = (s: string) =>
      normalizePersianString(s).replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/\u0629/g, 'ه').trim();
    const stripPrefixes = (s: string) =>
      normStrict(s)
        .replace(/^(?:دپارتمان\s*خط\s*تولید|دپارتمان\s*تولید|دپارتمان|خط\s*تولید|گروه\s*کالا|گروه\s*محصول|دسته\s*بندی|دسته|گروه|بخش)\s+/, '')
        .trim();
    const compactStr = (s: string) => stripPrefixes(s).replace(/[\s\-_\/]+/g, '');

    const targetNorm = normStrict(rawCatName);
    const targetStripped = stripPrefixes(rawCatName);
    const targetCompact = compactStr(rawCatName);
    if (!targetCompact) return undefined;

    // 1. Exact normalized match
    let found = catList.find(c => normStrict(c.name) === targetNorm);
    if (found) return found;

    // 2. Prefix-stripped match (e.g. "دپارتمان نان" vs "نان")
    found = catList.find(c => stripPrefixes(c.name) === targetStripped);
    if (found) return found;

    // 3. Space/punctuation-insensitive match (e.g. "فینگرفود" vs "فینگر فود")
    found = catList.find(c => compactStr(c.name) === targetCompact);
    if (found) return found;

    // 4. Unambiguous containment match (e.g. "نانوایی و نان" vs "نان")
    if (targetCompact.length >= 2) {
      const candidates = catList.filter(c => {
        const cc = compactStr(c.name);
        return cc.length >= 2 && (cc.includes(targetCompact) || targetCompact.includes(cc));
      });
      if (candidates.length === 1) return candidates[0];
    }

    return undefined;
  };

  const syncExcelCategoriesFromTransactions = (
    baseCategories: ProductCategory[],
    transactions: SalesTransaction[]
  ): {
    updatedCategories: ProductCategory[];
    createdCategoryNames: string[];
    categoryByNormName: Map<string, ProductCategory>;
  } => {
    const updatedCategories = [...baseCategories];
    const periodCats = () => updatedCategories.filter(c => c.periodId === activePeriodId);
    const createdCategoryNames: string[] = [];

    const nextCatId = createSimpleIdGenerator(updatedCategories, 'pcat');
    transactions.forEach(tx => {
      const rawCat = normCatName(tx.categoryName);
      if (!rawCat || rawCat === 'نامشخص' || rawCat === 'عمومی نامشخص' || rawCat === '-') return;
      const existing =
        matchProductCategoryInList(rawCat, periodCats()) ||
        periodCats().find(c => normCatName(c.name) === rawCat);
      if (!existing) {
        const cleanDisplayName = String(tx.categoryName || '').trim().replace(/\s+/g, ' ');
        const createdCat: ProductCategory = {
          id: nextCatId(),
          periodId: activePeriodId,
          name: cleanDisplayName,
          departmentId: undefined
        };
        updatedCategories.push(createdCat);
        createdCategoryNames.push(cleanDisplayName);
      }
    });

    const categoryByNormName = new Map<string, ProductCategory>();
    periodCats().forEach(c => {
      const n = normCatName(c.name);
      if (n) categoryByNormName.set(n, c);
    });

    return { updatedCategories, createdCategoryNames, categoryByNormName };
  };

  const handleFinalizeReconciliationWithNewProducts = () => {
    if (!unregisteredProductsToDefine || !reconciliationResult) return;

    // 1. Validate category & weights
    const missingCatItem = unregisteredProductsToDefine.find(p => !p.categoryId || !p.categoryId.trim());
    if (missingCatItem) {
      alert(`لطفاً دسته‌بندی محصول «${missingCatItem.name}» را انتخاب نمایید.`);
      return;
    }

    const invalidItem = unregisteredProductsToDefine.find(p => !p.weight || isNaN(Number(p.weight)) || Number(p.weight) <= 0);
    if (invalidItem) {
      alert(`لطفاً وزن معتبری برای محصول «${invalidItem.name}» وارد کنید (عدد بزرگتر از صفر به گرم).`);
      return;
    }

    // 2. Auto-create any missing categories from Excel transactions & __CREATE__:<name>
    const syncedExcel = syncExcelCategoriesFromTransactions(db.productCategories, reconciliationResult.detailedTransactions);
    const updatedCategories = [...syncedExcel.updatedCategories];
    const nextFinalCatId = createSimpleIdGenerator(updatedCategories, 'pcat');
    const resolveSelectedCatId = (rawSelection: string): ProductCategory => {
      if (rawSelection.startsWith('__CREATE__:')) {
        const newName = rawSelection.slice('__CREATE__:'.length).trim().replace(/\s+/g, ' ');
        const periodCats = updatedCategories.filter(c => c.periodId === activePeriodId);
        const existing = matchProductCategoryInList(newName, periodCats) ||
          periodCats.find(c => normCatName(c.name) === normCatName(newName));
        if (existing) return existing;
        const createdCat: ProductCategory = {
          id: nextFinalCatId(),
          periodId: activePeriodId,
          name: newName,
          departmentId: undefined
        };
        updatedCategories.push(createdCat);
        return createdCat;
      }
      const existing = updatedCategories.find(c => c.periodId === activePeriodId && c.id === rawSelection);
      if (existing) return existing;
      const periodCats = updatedCategories.filter(c => c.periodId === activePeriodId);
      if (periodCats.length > 0) return periodCats[0];
      const genCat: ProductCategory = {
        id: nextFinalCatId(),
        periodId: activePeriodId,
        name: 'عمومی',
        departmentId: undefined
      };
      updatedCategories.push(genCat);
      return genCat;
    };

    // 3. Create product objects
    const nextFinalProdId = createSimpleIdGenerator(db.products, 'prod');
    const newProductsToPush: Product[] = unregisteredProductsToDefine.map(item => {
      const resolvedCat = resolveSelectedCatId(item.categoryId);
      return {
        id: nextFinalProdId(),
        periodId: activePeriodId,
        code: item.code,
        accountId: item.code, // کد کالا به عنوان کد حسابداری استفاده شود
        name: item.name,
        categoryId: resolvedCat.id,
        unit: 'عدد',
        barcode: '',
        packageType: 'سلفون',
        qtyPerPackage: 1,
        weightPerPackage: 1,
        salePrice: item.salePrice || 0,
        cogsPrice: 0,
        weight: Number(item.weight) // وزن محصول از کاربر پرسیده شده
      };
    });

    // 4. Update the detailedTransactions to link to the new products and resolve categoryId/categoryName cleanly
    const periodCatsAfterCreate = updatedCategories.filter(c => c.periodId === activePeriodId);
    const periodCatIdSet = new Set(periodCatsAfterCreate.map(c => c.id));
    const updatedDetailedTransactions = reconciliationResult.detailedTransactions.map(tx => {
      const excelCat = tx.categoryName
        ? (matchProductCategoryInList(tx.categoryName, periodCatsAfterCreate) ||
           periodCatsAfterCreate.find(c => normCatName(c.name) === normCatName(tx.categoryName)))
        : undefined;

      if (!tx.productId) {
        const txCodeNorm = normalizePersianString(tx.productCode || '');
        const txNameNorm = normalizePersianString(tx.productName || '');
        const matched = newProductsToPush.find(np =>
          (txCodeNorm && normalizePersianString(np.code) === txCodeNorm) ||
          (txNameNorm && normalizePersianString(np.name) === txNameNorm)
        );
        if (matched) {
          const resolvedCatObj = excelCat || periodCatsAfterCreate.find(c => c.id === matched.categoryId);
          return {
            ...tx,
            productId: matched.id,
            categoryId: resolvedCatObj?.id || matched.categoryId,
            categoryName: tx.categoryName || resolvedCatObj?.name
          };
        }
      }
      const catById = tx.categoryId ? periodCatsAfterCreate.find(c => c.id === tx.categoryId) : undefined;
      const resolvedCatObj = excelCat || catById;
      if (resolvedCatObj) {
        return {
          ...tx,
          categoryId: resolvedCatObj.id,
          categoryName: tx.categoryName || resolvedCatObj.name
        };
      }
      return tx;
    });

    // 5. Save detailed transactions to db.salesTransactions
    const incomingYearMonths = new Set<string>();
    updatedDetailedTransactions.forEach(tx => {
      const tMonth = tx.month !== undefined ? Number(tx.month) : selectedSalesMonth;
      const tYear = tx.year !== undefined ? Number(tx.year) : selectedSalesYear;
      incomingYearMonths.add(`${tYear}_${tMonth}`);
    });
    if (incomingYearMonths.size === 0) {
      incomingYearMonths.add(`${selectedSalesYear}_${selectedSalesMonth}`);
    }

    const existingOthersTransactions = (db.salesTransactions || []).filter(tx => {
      if (tx.periodId !== activePeriodId) return true;
      const tMonth = tx.month !== undefined ? Number(tx.month) : (tx.dateStr ? parseInt(tx.dateStr.split('/')[1], 10) : 1);
      const tYear = tx.year !== undefined ? Number(tx.year) : (tx.dateStr ? parseInt(tx.dateStr.split('/')[0], 10) : 1403);
      return !incomingYearMonths.has(`${tYear}_${tMonth}`);
    });
    const newTransactionsList = updatedDetailedTransactions.map(tx => ({
      ...tx,
      periodId: activePeriodId,
      month: tx.month !== undefined ? Number(tx.month) : selectedSalesMonth,
      year: tx.year !== undefined ? Number(tx.year) : selectedSalesYear
    }));

    const updatedSalesTransactions = [...existingOthersTransactions, ...newTransactionsList];

    // 6. Aggregate detailed transactions per Product AND Month/Year
    const aggByProdMonth: Record<string, { productId: string; year: number; month: number; qty: number; discount: number; netAmount: number; preDiscount: number; firstCatId?: string }> = {};
    updatedDetailedTransactions.forEach(tx => {
      if (!tx.productId) return;
      const tMonth = tx.month !== undefined ? Number(tx.month) : selectedSalesMonth;
      const tYear = tx.year !== undefined ? Number(tx.year) : selectedSalesYear;
      const key = `${tx.productId}_${tYear}_${tMonth}`;
      if (!aggByProdMonth[key]) {
        aggByProdMonth[key] = { productId: tx.productId, year: tYear, month: tMonth, qty: 0, discount: 0, netAmount: 0, preDiscount: 0, firstCatId: tx.categoryId };
      }
      aggByProdMonth[key].qty += tx.qtySold;
      aggByProdMonth[key].discount += tx.discount;
      aggByProdMonth[key].netAmount += tx.salesAmount;
      aggByProdMonth[key].preDiscount += (tx.qtySold * tx.unitPrice);
    });

    // 7. Update catalog prices using the LATEST chronological pre-discount unitPrice (NOT monthly average)
    const getTxChronoRank = (tx: SalesTransaction, idx: number): [number, number, number] => {
      const y = Number(tx.year || selectedSalesYear || 1403);
      const m = Number(tx.month || selectedSalesMonth || 1);
      let d = Number(tx.dayOfMonth || 0);
      if ((!d || d <= 0) && tx.dateStr) {
        const parts = String(tx.dateStr).split(/[\/\-]/);
        if (parts.length >= 3) {
          d = parseInt(parts[2], 10) || 1;
        }
      }
      const dateScore = y * 10000 + m * 100 + Math.max(1, d);
      let timeSec = Number(tx.hour || 0) * 3600;
      if (tx.time) {
        const tParts = String(tx.time).trim().split(':').map(n => parseInt(n, 10));
        if (tParts.length >= 2 && !Number.isNaN(tParts[0]) && !Number.isNaN(tParts[1])) {
          timeSec = tParts[0] * 3600 + tParts[1] * 60 + (!Number.isNaN(tParts[2]) ? tParts[2] : 0);
        }
      }
      return [dateScore, timeSec, idx];
    };

    const isLaterRank = (a: [number, number, number], b: [number, number, number]) =>
      a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

    const latestUnitPriceByProduct = new Map<string, { price: number; rank: [number, number, number] }>();
    updatedDetailedTransactions.forEach((tx, idx) => {
      if (!tx.productId) return;
      const unitP = Math.round(Number(tx.unitPrice || 0));
      if (unitP <= 0) return;
      const rank = getTxChronoRank(tx, idx);
      const prev = latestUnitPriceByProduct.get(tx.productId);
      if (!prev || isLaterRank(rank, prev.rank)) {
        latestUnitPriceByProduct.set(tx.productId, { price: unitP, rank });
      }
    });

    const combinedProducts = [...db.products, ...newProductsToPush];
    const updatedProducts = combinedProducts.map(p => {
      const pAggs = Object.values(aggByProdMonth).filter(a => a.productId === p.id && a.qty > 0);
      if (p.periodId === activePeriodId && pAggs.length > 0) {
        const latestUnitPrice = latestUnitPriceByProduct.get(p.id)?.price || 0;
        const hasValidCat = Boolean(p.categoryId && periodCatIdSet.has(p.categoryId));
        const fallbackCatId = !hasValidCat ? (pAggs.find(a => a.firstCatId)?.firstCatId || p.categoryId) : p.categoryId;
        if (latestUnitPrice > 0 || fallbackCatId !== p.categoryId) {
          return {
            ...p,
            salePrice: latestUnitPrice > 0 ? latestUnitPrice : p.salePrice,
            categoryId: fallbackCatId
          };
        }
      }
      return p;
    });

    const existingOthersSales = db.productSales.filter(s => {
      if (s.periodId !== activePeriodId) return true;
      const sMonth = s.month !== undefined ? Number(s.month) : defaultPeriodYM.month;
      const sYear = s.year !== undefined ? Number(s.year) : defaultPeriodYM.year;
      return !incomingYearMonths.has(`${sYear}_${sMonth}`);
    });
    
    const nextAggSaleId = createSimpleIdGenerator(existingOthersSales, 'psale');
    const newPeriodSales: ProductSale[] = Object.values(aggByProdMonth).map((item) => {
      return {
        id: nextAggSaleId(),
        salesPeriodId: activePeriodId,
        periodId: activePeriodId,
        productId: item.productId,
        qtySold: item.qty,
        discount: item.discount,
        preDiscountAmount: item.preDiscount,
        netSalesAmount: item.netAmount,
        month: item.month,
        year: item.year
      };
    });

    // 8. Update active period in database
    onUpdateDb({
      ...db,
      productCategories: updatedCategories,
      products: updatedProducts,
      salesTransactions: updatedSalesTransactions,
      productSales: [...existingOthersSales, ...newPeriodSales]
    });

    const newCatNote = syncedExcel.createdCategoryNames.length > 0
      ? ` و ${toPersianDigits(syncedExcel.createdCategoryNames.length)} دسته‌بندی جدید از فایل اکسل به بخش دسته‌بندی محصولات اضافه شد (نیازمند تخصیص دپارتمان در تب دسته‌بندی محصولات)`
      : '';

    setAdvancedImportStatus({
      type: 'success',
      message: `همگام‌سازی تراکنش‌ها با موفقیت کامل انجام شد! تعداد ${toPersianDigits(newProductsToPush.length)} محصول جدید با کد حسابداری ثبت شد، تعداد ${toPersianDigits(updatedDetailedTransactions.length)} ردیف تراکنش در داشبورد ثبت گردید و تعداد ${toPersianDigits(newPeriodSales.length)} رکورد فروش ماهیانه به‌روزرسانی شد${newCatNote}.`
    });
    
    setDetailFile(null);
    setSummaryFile(null);
    setReconciliationResult(null);
    setUnregisteredProductsToDefine(null);
  };

  const handleApplyReconciliation = () => {
    if (!reconciliationResult) return;

    // Detect if there are unregistered products in transactions
    const unregisteredTxList = reconciliationResult.detailedTransactions.filter(tx => !tx.productId);
    
    // Find unique unregistered products based on productCode or productName
    const existingCodes = new Set(db.products.filter(p => p.periodId === activePeriodId).map(p => normalizePersianString(p.code || '')));
    const existingNames = new Set(db.products.filter(p => p.periodId === activePeriodId).map(p => normalizePersianString(p.name || '')));

    const uniqueNewProductsMap = new Map<string, { code: string; name: string; categoryName?: string; salePrice: number; _dateScore: number; _timeSec: number; _idx: number }>();
    
    unregisteredTxList.forEach((tx, idx) => {
      const code = (tx.productCode || '').trim();
      const name = (tx.productName || '').trim();
      if (code || name) {
        const normCode = normalizePersianString(code);
        const normName = normalizePersianString(name || '');
        if (!existingCodes.has(normCode) && !existingNames.has(normName)) {
          const key = normCode || normName;
          const y = Number(tx.year || selectedSalesYear || 1403);
          const m = Number(tx.month || selectedSalesMonth || 1);
          const d = Math.max(1, Number(tx.dayOfMonth || 1));
          const dateScore = y * 10000 + m * 100 + d;
          let timeSec = Number(tx.hour || 0) * 3600;
          if (tx.time) {
            const tp = String(tx.time).trim().split(':').map(n => parseInt(n, 10));
            if (tp.length >= 2 && !Number.isNaN(tp[0]) && !Number.isNaN(tp[1])) {
              timeSec = tp[0] * 3600 + tp[1] * 60 + (!Number.isNaN(tp[2]) ? tp[2] : 0);
            }
          }
          const unitP = Math.round(Number(tx.unitPrice || 0));
          const prev = uniqueNewProductsMap.get(key);
          if (!prev) {
            uniqueNewProductsMap.set(key, {
              code: code || `NEW-${idx + 1}`,
              name: name && name !== 'کالای ناشناس' ? name : `کالای جدید با کد ${code || 'ناشناس'}`,
              categoryName: tx.categoryName,
              salePrice: unitP,
              _dateScore: dateScore,
              _timeSec: timeSec,
              _idx: idx
            });
          } else {
            if (!prev.categoryName && tx.categoryName) {
              prev.categoryName = tx.categoryName;
            }
            const isLater =
              dateScore !== prev._dateScore
                ? dateScore > prev._dateScore
                : timeSec !== prev._timeSec
                ? timeSec > prev._timeSec
                : idx >= prev._idx;
            if (unitP > 0 && isLater) {
              prev.salePrice = unitP;
              prev._dateScore = dateScore;
              prev._timeSec = timeSec;
              prev._idx = idx;
            }
          }
        }
      }
    });

    const uniqueNewProducts = Array.from(uniqueNewProductsMap.values());

    if (uniqueNewProducts.length > 0) {
      const mapped = uniqueNewProducts.map(p => {
        let matchedCatId = '';
        if (p.categoryName && p.categoryName.trim()) {
          const foundCat = matchProductCategoryInList(p.categoryName, categories);
          if (foundCat) {
            matchedCatId = foundCat.id;
          } else {
            matchedCatId = `__CREATE__:${p.categoryName.trim()}`;
          }
        } else if (categories.length === 1) {
          matchedCatId = categories[0].id;
        }
        return {
          code: p.code,
          accountId: p.code, // کد کالا به عنوان کد حسابداری
          name: p.name,
          categoryName: p.categoryName,
          categoryId: matchedCatId,
          weight: '1', // default 1 gram
          salePrice: p.salePrice
        };
      });
      setUnregisteredProductsToDefine(mapped);
      return;
    }

    askConfirm(
      'همگام‌سازی و اعمال نتایج تراکنش‌ها',
      'با تایید این عملیات، کلیه اطلاعات ریز تراکنش‌های فروش وارد دیتابیس شده، دسته‌بندی‌های جدید فایل اکسل به لیست دسته‌بندی‌ها اضافه و اطلاعات فروش ماهانه دوره مالی جاری بر این اساس مورد بازنویسی قرار خواهد گرفت. آیا اطمینان دارید؟',
      () => {
        const { detailedTransactions } = reconciliationResult;

        // 0. Auto-create any missing Excel categories (without departmentId so user assigns department later)
        const syncedExcel = syncExcelCategoriesFromTransactions(db.productCategories, detailedTransactions);
        const updatedCategories = syncedExcel.updatedCategories;
        const periodCatsNow = updatedCategories.filter(c => c.periodId === activePeriodId);
        const periodCatIdSet = new Set(periodCatsNow.map(c => c.id));

        // 1. Save detailed transactions to db.salesTransactions (resolving categoryId/categoryName cleanly)
        const normalizedTransactions = detailedTransactions.map(tx => {
          const excelCat = tx.categoryName
            ? (matchProductCategoryInList(tx.categoryName, periodCatsNow) ||
               periodCatsNow.find(c => normCatName(c.name) === normCatName(tx.categoryName)))
            : undefined;
          const validCat = excelCat || (tx.categoryId ? periodCatsNow.find(c => c.id === tx.categoryId) : undefined);
          return {
            ...tx,
            categoryId: validCat?.id || tx.categoryId || undefined,
            categoryName: tx.categoryName || validCat?.name || undefined
          };
        });

        const incomingYearMonths = new Set<string>();
        normalizedTransactions.forEach(tx => {
          const tMonth = tx.month !== undefined ? Number(tx.month) : selectedSalesMonth;
          const tYear = tx.year !== undefined ? Number(tx.year) : selectedSalesYear;
          incomingYearMonths.add(`${tYear}_${tMonth}`);
        });
        if (incomingYearMonths.size === 0) {
          incomingYearMonths.add(`${selectedSalesYear}_${selectedSalesMonth}`);
        }

        const existingOthersTransactions = (db.salesTransactions || []).filter(tx => {
          if (tx.periodId !== activePeriodId) return true;
          const tMonth = tx.month !== undefined ? Number(tx.month) : (tx.dateStr ? parseInt(tx.dateStr.split('/')[1], 10) : 1);
          const tYear = tx.year !== undefined ? Number(tx.year) : (tx.dateStr ? parseInt(tx.dateStr.split('/')[0], 10) : 1403);
          return !incomingYearMonths.has(`${tYear}_${tMonth}`);
        });
        const newTransactionsList = normalizedTransactions.map(tx => ({
          ...tx,
          periodId: activePeriodId,
          month: tx.month !== undefined ? Number(tx.month) : selectedSalesMonth,
          year: tx.year !== undefined ? Number(tx.year) : selectedSalesYear
        }));

        const updatedSalesTransactions = [...existingOthersTransactions, ...newTransactionsList];

        // 2. Aggregate detailed transactions per Product AND Month/Year
        const aggByProdMonth: Record<string, { productId: string; year: number; month: number; qty: number; discount: number; netAmount: number; preDiscount: number; firstCatId?: string }> = {};
        
        normalizedTransactions.forEach(tx => {
          if (!tx.productId) return;
          const tMonth = tx.month !== undefined ? Number(tx.month) : selectedSalesMonth;
          const tYear = tx.year !== undefined ? Number(tx.year) : selectedSalesYear;
          const key = `${tx.productId}_${tYear}_${tMonth}`;
          if (!aggByProdMonth[key]) {
            aggByProdMonth[key] = { productId: tx.productId, year: tYear, month: tMonth, qty: 0, discount: 0, netAmount: 0, preDiscount: 0, firstCatId: tx.categoryId };
          }
          aggByProdMonth[key].qty += tx.qtySold;
          aggByProdMonth[key].discount += tx.discount;
          aggByProdMonth[key].netAmount += tx.salesAmount;
          aggByProdMonth[key].preDiscount += (tx.qtySold * tx.unitPrice);
        });

        // Update the products base sales price using the LATEST chronological pre-discount unitPrice (NOT monthly average)
        const latestUnitPriceByProduct = new Map<string, { price: number; dateScore: number; timeSec: number; idx: number }>();
        normalizedTransactions.forEach((tx, idx) => {
          if (!tx.productId) return;
          const unitP = Math.round(Number(tx.unitPrice || 0));
          if (unitP <= 0) return;
          const y = Number(tx.year || selectedSalesYear || 1403);
          const m = Number(tx.month || selectedSalesMonth || 1);
          let d = Number(tx.dayOfMonth || 0);
          if ((!d || d <= 0) && tx.dateStr) {
            const parts = String(tx.dateStr).split(/[\/\-]/);
            if (parts.length >= 3) d = parseInt(parts[2], 10) || 1;
          }
          const dateScore = y * 10000 + m * 100 + Math.max(1, d);
          let timeSec = Number(tx.hour || 0) * 3600;
          if (tx.time) {
            const tp = String(tx.time).trim().split(':').map(n => parseInt(n, 10));
            if (tp.length >= 2 && !Number.isNaN(tp[0]) && !Number.isNaN(tp[1])) {
              timeSec = tp[0] * 3600 + tp[1] * 60 + (!Number.isNaN(tp[2]) ? tp[2] : 0);
            }
          }
          const prev = latestUnitPriceByProduct.get(tx.productId);
          const isLater =
            !prev ||
            (dateScore !== prev.dateScore
              ? dateScore > prev.dateScore
              : timeSec !== prev.timeSec
              ? timeSec > prev.timeSec
              : idx >= prev.idx);
          if (isLater) {
            latestUnitPriceByProduct.set(tx.productId, { price: unitP, dateScore, timeSec, idx });
          }
        });

        const updatedProducts = db.products.map(p => {
          const pAggs = Object.values(aggByProdMonth).filter(a => a.productId === p.id && a.qty > 0);
          if (p.periodId === activePeriodId && pAggs.length > 0) {
            const latestUnitPrice = latestUnitPriceByProduct.get(p.id)?.price || 0;
            const hasValidCat = Boolean(p.categoryId && periodCatIdSet.has(p.categoryId));
            const fallbackCatId = !hasValidCat ? (pAggs.find(a => a.firstCatId)?.firstCatId || p.categoryId) : p.categoryId;
            if (latestUnitPrice > 0 || fallbackCatId !== p.categoryId) {
              return {
                ...p,
                salePrice: latestUnitPrice > 0 ? latestUnitPrice : p.salePrice,
                categoryId: fallbackCatId
              };
            }
          }
          return p;
        });

        const existingOthersSales = db.productSales.filter(s => {
          if (s.periodId !== activePeriodId) return true;
          const sMonth = s.month !== undefined ? Number(s.month) : defaultPeriodYM.month;
          const sYear = s.year !== undefined ? Number(s.year) : defaultPeriodYM.year;
          return !incomingYearMonths.has(`${sYear}_${sMonth}`);
        });
        
        const nextAggSaleId2 = createSimpleIdGenerator(existingOthersSales, 'psale');
        const newPeriodSales: ProductSale[] = Object.values(aggByProdMonth).map((item) => {
          return {
            id: nextAggSaleId2(),
            salesPeriodId: activePeriodId,
            periodId: activePeriodId,
            productId: item.productId,
            qtySold: item.qty,
            discount: item.discount,
            preDiscountAmount: item.preDiscount,
            netSalesAmount: item.netAmount,
            month: item.month,
            year: item.year
          };
        });

        // 3. Update active period in database
        onUpdateDb({
          ...db,
          productCategories: updatedCategories,
          products: updatedProducts,
          salesTransactions: updatedSalesTransactions,
          productSales: [...existingOthersSales, ...newPeriodSales]
        });

        const newCatNote = syncedExcel.createdCategoryNames.length > 0
          ? ` و ${toPersianDigits(syncedExcel.createdCategoryNames.length)} دسته‌بندی جدید از اکسل افزوده شد (لطفاً در تب دسته‌بندی محصولات دپارتمان مربوطه را تخصیص دهید)`
          : '';

        setAdvancedImportStatus({
          type: 'success',
          message: `همگام‌سازی تراکنش‌ها با موفقیت کامل انجام شد! تعداد ${toPersianDigits(detailedTransactions.length)} ردیف تراکنش در داشبورد ثبت گردید و تعداد ${toPersianDigits(newPeriodSales.length)} رکورد فروش ماهیانه به‌روزرسانی شد${newCatNote}.`
        });
        
        setDetailFile(null);
        setSummaryFile(null);
        setReconciliationResult(null);
        setUnregisteredProductsToDefine(null);
      }
    );
  };

  const handleProcessAdvancedFiles = () => {
    if (!detailFile || !summaryFile) {
      setAdvancedImportStatus({
        type: 'error',
        message: 'لطفاً هر دو فایل ریز تراکنش و خلاصه فاکتورها را انتخاب کنید.'
      });
      return;
    }

    setAdvancedImportStatus({ type: 'idle', message: 'در حال پردازش و استخراج داده‌ها...' });

    const reader1 = new FileReader();
    reader1.onload = (e1) => {
      try {
        const data1 = new Uint8Array(e1.target?.result as ArrayBuffer);
        const wb1 = XLSX.read(data1, { type: 'array' });
        const ws1 = wb1.Sheets[wb1.SheetNames[0]];
        const json1 = XLSX.utils.sheet_to_json<any>(ws1);

        if (json1.length === 0) {
          setAdvancedImportStatus({ type: 'error', message: 'فایل ریز تراکنش‌ها خالی است.' });
          return;
        }

        const reader2 = new FileReader();
        reader2.onload = (e2) => {
          try {
            const data2 = new Uint8Array(e2.target?.result as ArrayBuffer);
            const wb2 = XLSX.read(data2, { type: 'array' });
            const ws2 = wb2.Sheets[wb2.SheetNames[0]];
            const json2 = XLSX.utils.sheet_to_json<any>(ws2);

            if (json2.length === 0) {
              setAdvancedImportStatus({ type: 'error', message: 'فایل سرجمع فاکتورها خالی است.' });
              return;
            }

            const summaryMap: Record<string, any> = {};
            json2.forEach(row => {
              let invoiceNumClean = '';
              let invoiceTimeClean = '';
              let customerCodeClean = '';
              let invoiceDateClean = '';

              Object.keys(row).forEach(key => {
                const kClean = cleanHeader(key);
                const rawVal = row[key];
                const val = String(rawVal || '').trim();

                if (isInvNum2(kClean)) {
                  invoiceNumClean = val;
                } else if (isTimeSale2(kClean)) {
                  const parsed = parseTimeValue(rawVal);
                  invoiceTimeClean = parsed.timeStr;
                } else if (isCustCode2(kClean)) {
                  customerCodeClean = val;
                } else if (isDate2(kClean)) {
                  invoiceDateClean = val;
                }
              });

              if (invoiceNumClean) {
                const invKey = cleanInvoiceValue(invoiceNumClean);
                if (invKey) {
                  summaryMap[invKey] = {
                    timeOfSale: invoiceTimeClean,
                    customerCode: customerCodeClean,
                    dateOfSale: invoiceDateClean,
                    rowObj: row
                  };
                }
              }
            });

            const parsedTransactions: SalesTransaction[] = [];
            const nextStxId = createSimpleIdGenerator(db.salesTransactions || [], 'stx');
            let totalTxsAmount = 0;
            let matchedCount = 0;
            const unmatchedInvoicesSet = new Set<string>();

            json1.forEach((row: any) => {
              let rawInvoiceNumber = '';
              let rawCustomer = '';
              let rawCode = '';
              let rawName = '';
              let rawCategory = '';
              let rawDate = '';
              let rawQty = 0;
              let rawUnitPrice = 0;
              let rawDiscount = 0;
              let rawAmount = 0;

              Object.keys(row).forEach(key => {
                const kClean = cleanHeader(key);
                const val = String(row[key] ?? '').trim();

                if (isInvoiceNum(kClean)) {
                  if (val) rawInvoiceNumber = val;
                } else if (isCustomerName(kClean)) {
                  if (val) rawCustomer = val;
                } else if (isProductCode(kClean)) {
                  if (val) rawCode = val;
                } else if (isProductGroup(kClean)) {
                  if (val) rawCategory = val;
                } else if (isProductName(kClean)) {
                  if (val) rawName = val;
                } else if (isDate(kClean)) {
                  if (val) rawDate = val;
                } else if (isQty(kClean)) {
                  rawQty = Math.round((parseNumber(row[key]) || 0) * 100) / 100;
                } else if (isPrice(kClean)) {
                  rawUnitPrice = parseNumber(row[key]);
                } else if (isDiscount(kClean)) {
                  rawDiscount = parseNumber(row[key]);
                } else if (isAmount(kClean)) {
                  rawAmount = parseNumber(row[key]);
                }
              });

              const invNumKey = cleanInvoiceValue(rawInvoiceNumber);
              const matchedSummary = invNumKey ? summaryMap[invNumKey] : undefined;
              let saleTime = '';
              let custCode = '';
              let fallbackDate = '';

              if (matchedSummary) {
                saleTime = matchedSummary.timeOfSale || '';
                custCode = matchedSummary.customerCode || '';
                fallbackDate = matchedSummary.dateOfSale || '';
                matchedCount++;
              } else if (rawInvoiceNumber) {
                const cleanedInv = cleanInvoiceValue(rawInvoiceNumber);
                if (cleanedInv) {
                  unmatchedInvoicesSet.add(cleanedInv);
                }
              }

              let saleHour = 12;
              if (saleTime) {
                const parsed = parseTimeValue(saleTime);
                saleHour = parsed.hourVal;
              }

              const normRawName = normalizePersianString(rawName);
              const normRawCode = normalizePersianString(rawCode || '');

              let matchedProduct = products.find(p => {
                const normPName = normalizePersianString(p.name);
                const normPCode = normalizePersianString(p.code || '');
                const normPAccount = normalizePersianString(p.accountId || '');
                return (normRawCode && (normPCode === normRawCode || normPAccount === normRawCode)) ||
                       (normRawName && normPName === normRawName);
              });

              if (!matchedProduct && normRawName) {
                matchedProduct = products.find(p => {
                  const normPName = normalizePersianString(p.name);
                  return normPName.includes(normRawName) || normRawName.includes(normPName);
                });
              }

              const productId = matchedProduct?.id || '';
              const validProductCat = matchedProduct?.categoryId
                ? categories.find(c => c.id === matchedProduct!.categoryId)
                : undefined;
              const matchedExcelCat = rawCategory ? matchProductCategoryInList(rawCategory, categories) : undefined;
              const categoryId = matchedExcelCat?.id || validProductCat?.id || '';
              const resolvedCategoryName = rawCategory || validProductCat?.name || undefined;

              let cleanDate = String(rawDate || fallbackDate || '').trim();
              if (cleanDate.endsWith('.0')) {
                cleanDate = cleanDate.substring(0, cleanDate.length - 2);
              }
              cleanDate = cleanDate.replace(/-/g, '/');
              if (/^\d{8}$/.test(cleanDate)) {
                cleanDate = `${cleanDate.substring(0, 4)}/${cleanDate.substring(4, 6)}/${cleanDate.substring(6, 8)}`;
              }

              let dayOfM = 15;
              let rowMonth = selectedSalesMonth;
              let rowYear = selectedSalesYear;
              if (cleanDate) {
                const dateParts = cleanDate.split('/');
                if (dateParts.length === 3) {
                  const pY = parseInt(dateParts[0], 10);
                  const pM = parseInt(dateParts[1], 10);
                  const pD = parseInt(dateParts[2], 10);
                  if (pY >= 1300 && pY <= 1500) rowYear = pY;
                  if (pM >= 1 && pM <= 12) rowMonth = pM;
                  if (pD >= 1 && pD <= 31) dayOfM = pD;
                } else if (dateParts.length === 1 && !isNaN(parseInt(dateParts[0], 10))) {
                  dayOfM = Math.min(31, Math.max(1, parseInt(dateParts[0], 10)));
                }
              }

              const formattedDateStr = `${rowYear}/${String(rowMonth).padStart(2, '0')}/${String(dayOfM).padStart(2, '0')}`;

              const totalNet = rawAmount || (rawQty * rawUnitPrice - rawDiscount);
              totalTxsAmount += totalNet;

              parsedTransactions.push({
                id: nextStxId(),
                periodId: activePeriodId,
                month: rowMonth,
                year: rowYear,
                invoiceNumber: rawInvoiceNumber ? cleanInvoiceValue(rawInvoiceNumber) : undefined,
                customerName: rawCustomer || 'مشتری عمومی',
                customerCode: custCode || undefined,
                productCode: rawCode || (matchedProduct?.code || ''),
                productName: rawName || (matchedProduct?.name || 'کالای ناشناس'),
                categoryName: resolvedCategoryName,
                qtySold: rawQty || 1,
                unitPrice: rawUnitPrice || (matchedProduct?.salePrice || 0),
                discount: rawDiscount || 0,
                salesAmount: totalNet,
                time: saleTime || undefined,
                hour: Math.min(23, Math.max(0, saleHour)),
                dayOfMonth: dayOfM,
                weekday: localGetPersianWeekdayOfDate(formattedDateStr),
                productId: productId || undefined,
                categoryId: categoryId || undefined,
                dateStr: formattedDateStr
              });
            });

            const existingSalesSum = salesRecords.reduce((acc, r) => acc + r.netSalesAmount, 0);

            // Calculate unregistered/new products identified in Excel
            const existingCodes = new Set(products.map(p => normalizePersianString(p.code || '')));
            const existingNames = new Set(products.map(p => normalizePersianString(p.name || '')));

            const uniqueNewProductsMap = new Map<string, { code: string; name: string; categoryName?: string; salePrice: number; _dateScore: number; _timeSec: number; _idx: number }>();
            
            parsedTransactions.filter(tx => !tx.productId).forEach((tx, idx) => {
              const code = (tx.productCode || '').trim();
              const name = (tx.productName || '').trim();
              if (code || name) {
                const normCode = normalizePersianString(code);
                const normName = normalizePersianString(name || '');
                if (!existingCodes.has(normCode) && !existingNames.has(normName)) {
                  const key = normCode || normName;
                  const y = Number(tx.year || selectedSalesYear || 1403);
                  const m = Number(tx.month || selectedSalesMonth || 1);
                  const d = Math.max(1, Number(tx.dayOfMonth || 1));
                  const dateScore = y * 10000 + m * 100 + d;
                  let timeSec = Number(tx.hour || 0) * 3600;
                  if (tx.time) {
                    const tp = String(tx.time).trim().split(':').map(n => parseInt(n, 10));
                    if (tp.length >= 2 && !Number.isNaN(tp[0]) && !Number.isNaN(tp[1])) {
                      timeSec = tp[0] * 3600 + tp[1] * 60 + (!Number.isNaN(tp[2]) ? tp[2] : 0);
                    }
                  }
                  const unitP = Math.round(Number(tx.unitPrice || 0));
                  const prev = uniqueNewProductsMap.get(key);
                  if (!prev) {
                    uniqueNewProductsMap.set(key, {
                      code: code || `NEW-${idx + 1}`,
                      name: name && name !== 'کالای ناشناس' ? name : `کالای جدید با کد ${code || 'ناشناس'}`,
                      categoryName: tx.categoryName,
                      salePrice: unitP,
                      _dateScore: dateScore,
                      _timeSec: timeSec,
                      _idx: idx
                    });
                  } else {
                    if (!prev.categoryName && tx.categoryName) {
                      prev.categoryName = tx.categoryName;
                    }
                    const isLater =
                      dateScore !== prev._dateScore
                        ? dateScore > prev._dateScore
                        : timeSec !== prev._timeSec
                        ? timeSec > prev._timeSec
                        : idx >= prev._idx;
                    if (unitP > 0 && isLater) {
                      prev.salePrice = unitP;
                      prev._dateScore = dateScore;
                      prev._timeSec = timeSec;
                      prev._idx = idx;
                    }
                  }
                }
              }
            });

            const uniqueNewProducts = Array.from(uniqueNewProductsMap.values()).map(({ code, name, categoryName, salePrice }) => ({
              code,
              name,
              categoryName,
              salePrice
            }));

            setReconciliationResult({
              totalImportedLines: json1.length,
              totalImportedAmount: totalTxsAmount,
              matchedInvoicesCount: matchedCount,
              unmatchedDetailedInvoices: Array.from(unmatchedInvoicesSet),
              detailedTransactions: parsedTransactions,
              isComparisonDone: true,
              existingPeriodSalesAmount: existingSalesSum,
              newProductsDetected: uniqueNewProducts
            });

            setAdvancedImportStatus({
              type: 'success',
              message: 'پردازش فایل‌ها با موفقیت انجام شد. خلاصه مقایسه و تطبیق اطلاعات در بخش زیر آماده بازبینی است.'
            });

          } catch (err) {
            console.error(err);
            setAdvancedImportStatus({ type: 'error', message: 'خطا در مدل پارس کردن اطلاعات فاکتور زمان.' });
          }
        };
        reader2.readAsArrayBuffer(summaryFile);

      } catch (err) {
        console.error(err);
        setAdvancedImportStatus({ type: 'error', message: 'خطا در مدل پارس کردن اطلاعات ریز تراکنش‌ها.' });
      }
    };
    reader1.readAsArrayBuffer(detailFile);
  };

  // Helpers
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // Monthly Sales Selection: Year is determined automatically from Time and Fiscal Periods Management
  const activePeriodObj = db.periods.find(p => p.id === activePeriodId);
  const defaultPeriodYM = useMemo(
    () => getDefaultYearMonthFromPeriod(activePeriodObj, activePeriodId),
    [activePeriodObj, activePeriodId]
  );
  const selectedSalesYear = useMemo(() => {
    return getFiscalYearFromPeriod(activePeriodObj, activePeriodId);
  }, [activePeriodObj, activePeriodId]);

  const [selectedSalesMonth, setSelectedSalesMonth] = useState<number>(() => defaultPeriodYM.month);

  React.useEffect(() => {
    setSelectedSalesMonth(defaultPeriodYM.month);
  }, [activePeriodId, defaultPeriodYM.month]);

  const PERSIAN_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  const normCatName = (s?: string): string =>
    String(s || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');

  const isSharedProdCat = (c: ProductCategory): boolean =>
    c.id === 'cat-4' || /-cat-4$/.test(c.id) || normCatName(c.name) === 'مشترک';

  // Scope datasets to activePeriodId
  const products = useMemo(() => db.products.filter(p => p.periodId === activePeriodId), [db.products, activePeriodId]);
  const categories = useMemo(() => {
    const list = db.productCategories.filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.filter(c => {
      const n = normCatName(c.name);
      const dup = seen.has(c.id) || (Boolean(n) && seen.has(`name:${n}`));
      seen.add(c.id);
      if (n) seen.add(`name:${n}`);
      return !dup;
    });
  }, [db.productCategories, activePeriodId]);
  const defaultProductCategoryId = useMemo(() => {
    return categories.find(c => !isSharedProdCat(c))?.id || categories[0]?.id || '';
  }, [categories]);
  const salesPeriods = useMemo(() => db.salesPeriods.filter(s => s.periodId === activePeriodId), [db.salesPeriods, activePeriodId]);
  
  // Filter sales records for the selected month and year
  const salesRecords = useMemo(() => {
    return db.productSales.filter(s => {
      if (s.periodId !== activePeriodId) return false;
      if (s.month !== undefined && s.year !== undefined) {
        return Number(s.month) === Number(selectedSalesMonth) && Number(s.year) === Number(selectedSalesYear);
      }
      return selectedSalesMonth === defaultPeriodYM.month && selectedSalesYear === defaultPeriodYM.year;
    });
  }, [db.productSales, activePeriodId, selectedSalesMonth, selectedSalesYear, defaultPeriodYM]);

  // Statistics per month for the 12-month selector grid
  const monthlySalesStats = useMemo(() => {
    const stats: Record<number, { count: number; totalAmount: number; totalQty: number }> = {};
    for (let m = 1; m <= 12; m++) {
      stats[m] = { count: 0, totalAmount: 0, totalQty: 0 };
    }
    db.productSales.forEach(s => {
      if (s.periodId !== activePeriodId) return;
      let m = s.month !== undefined ? Number(s.month) : undefined;
      let y = s.year !== undefined ? Number(s.year) : undefined;
      if (m === undefined) {
        m = defaultPeriodYM.month;
        y = defaultPeriodYM.year;
      }
      if (y === selectedSalesYear && m >= 1 && m <= 12) {
        stats[m].count += 1;
        stats[m].totalAmount += (s.netSalesAmount || 0);
        stats[m].totalQty += (s.qtySold || 0);
      }
    });
    return stats;
  }, [db.productSales, activePeriodId, selectedSalesYear, defaultPeriodYM]);

  const departments = useMemo(() => {
    const list = (db.departments || []).filter(d => d.periodId === activePeriodId);
    const seen = new Set<string>();
    return list.filter(d => {
      const n = normCatName(d.name);
      const dup = seen.has(d.id) || (Boolean(n) && seen.has(`name:${n}`));
      seen.add(d.id);
      if (n) seen.add(`name:${n}`);
      return !dup;
    });
  }, [db.departments, activePeriodId]);

  const resolveProductDepartmentId = React.useCallback((productCategoryId?: string): string => {
    if (!productCategoryId) return 'unassigned';
    const cat = categories.find(c => c.id === productCategoryId);
    if (cat && cat.departmentId) return cat.departmentId;
    if (departments.some(d => d.id === productCategoryId)) return productCategoryId;
    return 'unassigned';
  }, [categories, departments]);

  // Shelf Tags Management State & Logic (persisted in localStorage)
  const [tagDeptFilter, setTagDeptFilter] = useState<string>('all');
  const [tagCatFilter, setTagCatFilter] = useState<string>('all');
  const [tagSearch, setTagSearch] = useState<string>('');
  const [showShopTitle, setShowShopTitle] = useState<boolean>(() => {
    try { const s = localStorage.getItem('gatan_tag_show_shop'); return s !== null ? s === 'true' : true; } catch { return true; }
  });
  const [showCode, setShowCode] = useState<boolean>(() => {
    try { const s = localStorage.getItem('gatan_tag_show_code'); return s !== null ? s === 'true' : true; } catch { return true; }
  });
  const [showBarcode, setShowBarcode] = useState<boolean>(() => {
    try { const s = localStorage.getItem('gatan_tag_show_barcode'); return s !== null ? s === 'true' : false; } catch { return false; }
  });
  const [showDepartment, setShowDepartment] = useState<boolean>(() => {
    try { const s = localStorage.getItem('gatan_tag_show_dept'); return s !== null ? s === 'true' : true; } catch { return true; }
  });
  const [shopBrandName, setShopBrandName] = useState<string>(() => {
    try { return localStorage.getItem('gatan_tag_brand_name') || 'شیرینی و کافه گاتان'; } catch { return 'شیرینی و کافه گاتان'; }
  });
  const [selectedProductIdsForTags, setSelectedProductIdsForTags] = useState<Record<string, boolean>>({});

  // Advanced Print Customization States (persisted in localStorage)
  const [tagCols, setTagCols] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_cols'); return s ? parseInt(s, 10) : 3; } catch { return 3; }
  });
  const [tagRows, setTagRows] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_rows'); return s ? parseInt(s, 10) : 5; } catch { return 5; }
  });
  const [tagWidthCm, setTagWidthCm] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_width'); return s ? parseFloat(s) : 7; } catch { return 7; }
  });
  const [tagHeightCm, setTagHeightCm] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_height'); return s ? parseFloat(s) : 4; } catch { return 4; }
  });
  const [tagOrientation, setTagOrientation] = useState<'landscape' | 'portrait'>(() => {
    try { return (localStorage.getItem('gatan_tag_orientation') as any) || 'landscape'; } catch { return 'landscape'; }
  });
  const [paperOrientation, setPaperOrientation] = useState<'portrait' | 'landscape'>(() => {
    try { return (localStorage.getItem('gatan_paper_orientation') as any) || 'portrait'; } catch { return 'portrait'; }
  });
  const [fontSizeTitle, setFontSizeTitle] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_font_title'); return s ? parseInt(s, 10) : 13; } catch { return 13; }
  });
  const [fontSizePrice, setFontSizePrice] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_font_price'); return s ? parseInt(s, 10) : 14; } catch { return 14; }
  });
  const [fontSizeMeta, setFontSizeMeta] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_font_meta'); return s ? parseFloat(s) : 8.5; } catch { return 8.5; }
  });
  const [pageMarginMm, setPageMarginMm] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_page_margin'); return s ? parseInt(s, 10) : 0; } catch { return 0; }
  });
  const [contentAlignment, setContentAlignment] = useState<'center' | 'right' | 'left'>(() => {
    try { return (localStorage.getItem('gatan_tag_align') as any) || 'center'; } catch { return 'center'; }
  });
  const [tagFontFamily, setTagFontFamily] = useState<string>(() => {
    try { return localStorage.getItem('gatan_tag_font_family') || 'Vazirmatn'; } catch { return 'Vazirmatn'; }
  });
  const [logoUrl, setLogoUrl] = useState<string>(() => {
    try { return localStorage.getItem('gatan_tag_logo_url') || ''; } catch { return ''; }
  });
  const [logoWidth, setLogoWidth] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_logo_w'); return s ? parseInt(s, 10) : 24; } catch { return 24; }
  });
  const [logoHeight, setLogoHeight] = useState<number>(() => {
    try { const s = localStorage.getItem('gatan_tag_logo_h'); return s ? parseInt(s, 10) : 24; } catch { return 24; }
  });
  const [logoPosition, setLogoPosition] = useState<'top-right' | 'top-center' | 'top-left'>(() => {
    try { return (localStorage.getItem('gatan_tag_logo_pos') as any) || 'top-right'; } catch { return 'top-right'; }
  });
  const [tagPriceCurrency, setTagPriceCurrency] = useState<'rial' | 'toman'>(() => {
    try { return localStorage.getItem('gatan_tag_price_currency') === 'toman' ? 'toman' : 'rial'; } catch { return 'rial'; }
  });

  const formatShelfTagPrice = (salePriceRial?: number | null) => {
    const raw = Number(salePriceRial) || 0;
    const displayVal = tagPriceCurrency === 'toman' ? Math.round(raw / 10) : raw;
    return formatWithCommas(displayVal);
  };
  const shelfTagCurrencyLabel = tagPriceCurrency === 'toman' ? 'تومان' : 'ریال';

  useEffect(() => {
    try {
      localStorage.setItem('gatan_tag_cols', String(tagCols));
      localStorage.setItem('gatan_tag_rows', String(tagRows));
      localStorage.setItem('gatan_tag_width', String(tagWidthCm));
      localStorage.setItem('gatan_tag_height', String(tagHeightCm));
      localStorage.setItem('gatan_tag_orientation', tagOrientation);
      localStorage.setItem('gatan_paper_orientation', paperOrientation);
      localStorage.setItem('gatan_tag_font_title', String(fontSizeTitle));
      localStorage.setItem('gatan_tag_font_price', String(fontSizePrice));
      localStorage.setItem('gatan_tag_font_meta', String(fontSizeMeta));
      localStorage.setItem('gatan_tag_page_margin', String(pageMarginMm));
      localStorage.setItem('gatan_tag_align', contentAlignment);
      localStorage.setItem('gatan_tag_show_shop', String(showShopTitle));
      localStorage.setItem('gatan_tag_show_code', String(showCode));
      localStorage.setItem('gatan_tag_show_barcode', String(showBarcode));
      localStorage.setItem('gatan_tag_show_dept', String(showDepartment));
      localStorage.setItem('gatan_tag_brand_name', shopBrandName);
      localStorage.setItem('gatan_tag_font_family', tagFontFamily);
      localStorage.setItem('gatan_tag_logo_url', logoUrl);
      localStorage.setItem('gatan_tag_logo_w', String(logoWidth));
      localStorage.setItem('gatan_tag_logo_h', String(logoHeight));
      localStorage.setItem('gatan_tag_logo_pos', logoPosition);
      localStorage.setItem('gatan_tag_price_currency', tagPriceCurrency);
    } catch (e) {
      console.error('Error saving shelf tag settings', e);
    }
  }, [
    tagCols, tagRows, tagWidthCm, tagHeightCm, tagOrientation, paperOrientation,
    fontSizeTitle, fontSizePrice, fontSizeMeta, pageMarginMm, contentAlignment,
    showShopTitle, showCode, showBarcode, showDepartment, shopBrandName,
    tagFontFamily, logoUrl, logoWidth, logoHeight, logoPosition, tagPriceCurrency
  ]);

  const shelfTagFilteredProducts = useMemo(() => {
    let list = products;
    if (tagDeptFilter !== 'all') {
      list = list.filter(p => resolveProductDepartmentId(p.categoryId) === tagDeptFilter);
    }
    if (tagCatFilter !== 'all') {
      list = list.filter(p => p.categoryId === tagCatFilter);
    }
    if (tagSearch.trim()) {
      list = list.filter(p => matchPersianString(p.name, tagSearch) || matchPersianString(p.code, tagSearch) || matchPersianString(p.barcode, tagSearch));
    }
    return list;
  }, [products, tagDeptFilter, tagCatFilter, tagSearch, resolveProductDepartmentId]);

  const selectedShelfTagsCount = useMemo(() => {
    return Object.values(selectedProductIdsForTags).filter(Boolean).length;
  }, [selectedProductIdsForTags]);

  const handleSelectAllShelfTags = (select: boolean) => {
    const map: Record<string, boolean> = {};
    if (select) {
      shelfTagFilteredProducts.forEach(p => {
        map[p.id] = true;
      });
    }
    setSelectedProductIdsForTags(map);
  };

  const handlePrintShelfTags = () => {
    const selectedProds = products.filter(p => selectedProductIdsForTags[p.id]);
    const targetProds = selectedProds.length > 0 ? selectedProds : shelfTagFilteredProducts;
    if (targetProds.length === 0) {
      alert('هیچ محصولی برای چاپ تگ قفسه انتخاب نشده است.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("مرورگر شما جلوی باز شدن پنجره چاپ را گرفته است (Pop-up blocker). لطفا اجازه باز شدن پاپ‌آپ را بدهید.");
      return;
    }

    let html = `
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>چاپ برچسب‌های قفسه</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800;900&family=Shabnam:wght@400;700&display=swap');
          @page {
            size: A4 ${paperOrientation};
            margin: ${pageMarginMm}mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: '${tagFontFamily}', Tahoma, sans-serif;
            background: #ffffff;
            color: #000000;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .shelf-tag-card {
            width: ${tagWidthCm}cm;
            height: ${tagHeightCm}cm;
            border: 1px solid #0f172a;
            border-radius: 0px;
            padding: 4px 6px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #ffffff;
            color: #000000;
            box-sizing: border-box;
            margin: 0;
            float: right;
            overflow: hidden;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          @media print {
            body { background: white; margin: 0; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div style="display: grid; grid-template-columns: repeat(${tagCols}, ${tagWidthCm}cm); gap: 0; padding: 0; margin: 0; justify-items: start;">
    `;

    targetProds.forEach(p => {
      const catObj = categories.find(c => c.id === p.categoryId);
      const deptId = resolveProductDepartmentId(p.categoryId);
      const deptObj = departments.find(d => d.id === deptId);
      const priceFormatted = formatShelfTagPrice(p.salePrice);

      const logoHtml = logoUrl
        ? `<img src="${logoUrl}" style="width: ${logoWidth}px; height: ${logoHeight}px; object-fit: contain; flex-shrink: 0;" />`
        : '';

      const cleanShopTitle = (shopBrandName || '').trim();
      const shopTitleHtml = showShopTitle && cleanShopTitle
        ? `<span style="font-size: ${fontSizeMeta}px; font-weight: 800; color: #0f172a; white-space: nowrap;">${cleanShopTitle}</span>`
        : '';

      const deptBadgeHtml = showDepartment && deptObj
        ? `<span style="font-size: ${fontSizeMeta}px; font-weight: 700; background: #f1f5f9; padding: 1px 4px; border: 1px solid #cbd5e1; color: #0f172a; white-space: nowrap;">${deptObj.name}</span>`
        : '';

      const hasHeaderContent = Boolean(logoHtml || shopTitleHtml || deptBadgeHtml);

      const barcodeValue = (p.barcode || p.code || '').trim();
      const barcodeHeightPx = tagHeightCm >= 5 ? 28 : tagHeightCm >= 4 ? 22 : 16;
      const barcodeSvgHtml = showBarcode && barcodeValue
        ? generateCode128Svg(barcodeValue, {
            height: barcodeHeightPx,
            showText: true,
            fontSize: Math.max(7, Math.min(9.5, fontSizeMeta)),
            maxWidth: '100%'
          })
        : '';

      html += `
        <div class="shelf-tag-card">
          ${hasHeaderContent ? `
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; border-bottom: 1.5px solid #0f172a; background: #f8fafc; margin: -4px -6px 2px -6px; padding: 3px 6px;">
            <div style="display: flex; align-items: center; gap: 4px; min-width: 0;">
              ${logoPosition === 'top-right' ? logoHtml : ''}
              ${shopTitleHtml}
            </div>
            ${logoPosition === 'top-center' && logoHtml ? `<div style="display: flex; align-items: center; justify-content: center;">${logoHtml}</div>` : ''}
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              ${deptBadgeHtml}
              ${logoPosition === 'top-left' ? logoHtml : ''}
            </div>
          </div>
          ` : ''}
          <div style="text-align: ${contentAlignment}; margin: 1px 0; flex-grow: 1; display: flex; flex-direction: column; justify-content: center;">
            <div style="font-size: ${fontSizeTitle}px; font-weight: 900; line-height: 1.2; color: #000; font-family: '${tagFontFamily}', sans-serif;">${p.name}</div>
            ${catObj ? `<div style="font-size: ${fontSizeMeta}px; color: #334155; margin-top: 1px; font-weight: 600;">${catObj.name}</div>` : ''}
          </div>
          ${barcodeSvgHtml ? `<div style="width: 100%; display: flex; justify-content: center; align-items: center; padding: 1px 2px; background: #ffffff;">${barcodeSvgHtml}</div>` : ''}
          <div style="display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #e2e8f0; padding-top: 2px; margin-top: 1px;">
            <div>
              ${showCode && p.code ? `<div style="font-size: ${fontSizeMeta}px; font-family: monospace; color: #334155; font-weight: 700;">کد: ${p.code}</div>` : ''}
            </div>
            <div style="text-align: left;">
              <div style="font-size: ${fontSizePrice}px; font-weight: 900; font-family: '${tagFontFamily}', monospace; color: #000000;">${toPersianDigits(priceFormatted)} <span style="font-size: ${fontSizeMeta}px; font-weight: 700; color: #1e293b;">${shelfTagCurrencyLabel}</span></div>
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };
  const deptMap = useMemo(() => {
    const map: Record<string, string> = {};
    departments.forEach(d => { map[d.id] = d.name; });
    return map;
  }, [departments]);
  const unassignedCategories = useMemo(() => {
    return categories.filter(c => !c.departmentId || !deptMap[c.departmentId]);
  }, [categories, deptMap]);
  const catMap = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  const productMap = useMemo(() => {
    const map: Record<string, Product> = {};
    db.products.forEach(p => {
      map[p.id] = p;
      if (p.accountId) {
        map[p.accountId.trim()] = p;
        map[p.accountId.trim().toLowerCase()] = p;
      }
      if (p.code) {
        map[p.code.trim()] = p;
        map[p.code.trim().toLowerCase()] = p;
      }
    });
    return map;
  }, [db.products]);

  // ==========================================
  // TAB 1: DEFINE PRODUCTS (تعریف محصول نهایی)
  // ==========================================
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkEditCategoryId, setBulkEditCategoryId] = useState<string>('__keep__');
  const [bulkEditUnit, setBulkEditUnit] = useState<string>('__keep__');
  const [bulkEditPackageType, setBulkEditPackageType] = useState<string>('__keep__');
  const [bulkEditPurchasedType, setBulkEditPurchasedType] = useState<string>('__keep__');
  const [bulkEditFeedback, setBulkEditFeedback] = useState<string>('');
  const [prodSearch, setProdSearch] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState('ALL');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);

  const handleApplyBulkEditProducts = () => {
    if (selectedProductIds.length === 0) return;
    if (
      bulkEditCategoryId === '__keep__' &&
      bulkEditUnit === '__keep__' &&
      bulkEditPackageType === '__keep__' &&
      bulkEditPurchasedType === '__keep__'
    ) {
      setBulkEditFeedback('لطفاً حداقل یکی از فیلدهای گروه کالا، واحد فروش، نوع بسته‌بندی یا نوع تولیدی/خریداری را انتخاب کنید.');
      setTimeout(() => setBulkEditFeedback(''), 4000);
      return;
    }

    const selectedSet = new Set(selectedProductIds);
    let updatedCount = 0;
    const updatedProducts = db.products.map(prod => {
      if (!selectedSet.has(prod.id)) return prod;
      updatedCount += 1;
      const next: Product = { ...prod };
      if (bulkEditCategoryId !== '__keep__') {
        next.categoryId = bulkEditCategoryId;
      }
      if (bulkEditUnit !== '__keep__') {
        next.unit = bulkEditUnit as Product['unit'];
      }
      if (bulkEditPackageType !== '__keep__') {
        next.packageType = bulkEditPackageType as Product['packageType'];
      }
      if (bulkEditPurchasedType === 'purchased') {
        next.isPurchased = true;
      } else if (bulkEditPurchasedType === 'produced') {
        next.isPurchased = false;
      } else if (bulkEditPurchasedType === 'inherit') {
        delete next.isPurchased;
      }
      return next;
    });

    onUpdateDb({ ...db, products: updatedProducts });
    if (editingProduct && selectedSet.has(editingProduct.id)) {
      const refreshedEditing = updatedProducts.find(p => p.id === editingProduct.id) || null;
      setEditingProduct(refreshedEditing);
    }
    setBulkEditCategoryId('__keep__');
    setBulkEditUnit('__keep__');
    setBulkEditPackageType('__keep__');
    setBulkEditPurchasedType('__keep__');
    setSelectedProductIds([]);
    setBulkEditFeedback(`تغییرات دسته‌ای با موفقیت بر روی ${toPersianDigits(updatedCount)} محصول نهایی اعمال گردید.`);
    setTimeout(() => setBulkEditFeedback(''), 5000);
  };

  const handleBatchDeleteProducts = () => {
    if (selectedProductIds.length === 0) {
      alert('لطفاً ابتدا حداقل یک محصول را برای حذف انتخاب کنید.');
      return;
    }
    askConfirm(
      'حذف گروهی محصولات نهایی',
      `آیا از حذف گروهی ${toPersianDigits(selectedProductIds.length)} محصول اطمینان دارید؟ تمامی فرآیندهای فروش پیشین پابرجا می‌مانند اما مدیریت این کالاها کسر می‌گردد.`,
      () => {
        onUpdateDb({
          ...db,
          products: db.products.filter(p => !selectedProductIds.includes(p.id))
        });
        setSelectedProductIds([]);
        alert('محصولات انتخاب شده با موفقیت حذف شدند.');
      }
    );
  };

  const periodsWithProducts = useMemo(() => {
    return (db.periods || []).filter(p => p.id !== activePeriodId && (db.products || []).some(prod => prod.periodId === p.id));
  }, [db.periods, db.products, activePeriodId]);

  const handleCloneCatalogFromPeriod = (sourcePeriodId: string) => {
    if (!db) return;
    
    const sourceCats = (db.productCategories || []).filter(c => c.periodId === sourcePeriodId);
    const sourceProds = (db.products || []).filter(p => p.periodId === sourcePeriodId);
    const sourceFormulas = (db.productFormulas || []).filter(f => f.periodId === sourcePeriodId);
    const sourceItems = (db.items || []).filter(i => i.periodId === sourcePeriodId);
    const sourceItemCats = (db.itemCategories || []).filter(c => c.periodId === sourcePeriodId);
    const sourceConversions = (db.unitConversions || []).filter(c => c.periodId === sourcePeriodId);

    const existingCats = (db.productCategories || []).filter(c => c.periodId === activePeriodId);
    const otherCats = (db.productCategories || []).filter(c => c.periodId !== activePeriodId);
    
    const otherProds = (db.products || []).filter(p => p.periodId !== activePeriodId);
    const otherFormulas = (db.productFormulas || []).filter(f => f.periodId !== activePeriodId);
    const otherItems = (db.items || []).filter(i => i.periodId !== activePeriodId);
    const otherItemCats = (db.itemCategories || []).filter(c => c.periodId !== activePeriodId);
    const otherConversions = (db.unitConversions || []).filter(c => c.periodId !== activePeriodId);

    const catIdMap: Record<string, string> = {};

    const nextDeptId = createSimpleIdGenerator(db.departments || [], getPrefixForCollection('departments'));
    const nextProdCatId = createSimpleIdGenerator(db.productCategories || [], getPrefixForCollection('productCategories'));
    const nextItemCatId = createSimpleIdGenerator(db.itemCategories || [], getPrefixForCollection('itemCategories'));
    const nextItemId = createSimpleIdGenerator(db.items || [], getPrefixForCollection('items'));
    const nextProdId = createSimpleIdGenerator(db.products || [], getPrefixForCollection('products'));
    const nextConvId = createSimpleIdGenerator(db.unitConversions || [], getPrefixForCollection('unitConversions'));
    const nextFormId = createSimpleIdGenerator(db.productFormulas || [], getPrefixForCollection('productFormulas'));

    const existingDepts = (db.departments || []).filter(d => d.periodId === activePeriodId);
    const otherDepts = (db.departments || []).filter(d => d.periodId !== activePeriodId);
    const sourceDepts = (db.departments || []).filter(d => d.periodId === sourcePeriodId);
    const newDepts = [...existingDepts];
    const deptIdMap: Record<string, string> = {};
    sourceDepts.forEach(sd => {
      let matchedD = newDepts.find(d => normCatName(d.name) === normCatName(sd.name));
      if (!matchedD) {
        matchedD = {
          id: nextDeptId(),
          periodId: activePeriodId,
          name: sd.name,
          targetMargin: sd.targetMargin
        };
        newDepts.push(matchedD);
      }
      deptIdMap[sd.id] = matchedD.id;
    });

    const newCats = [...existingCats];
    sourceCats.forEach(sc => {
      let matched = newCats.find(c => c.name.trim() === sc.name.trim());
      if (!matched) {
        const newCatId = nextProdCatId();
        matched = {
          id: newCatId,
          periodId: activePeriodId,
          name: sc.name,
          departmentId: sc.departmentId ? (deptIdMap[sc.departmentId] || sc.departmentId) : undefined,
          targetMargin: sc.targetMargin
        };
        newCats.push(matched);
      }
      catIdMap[sc.id] = matched.id;
    });

    const existingItemCats = (db.itemCategories || []).filter(c => c.periodId === activePeriodId);
    const newItemCats = [...existingItemCats];
    const itemCatIdMap: Record<string, string> = {};
    
    sourceItemCats.forEach(sic => {
      let matched = newItemCats.find(c => c.name.trim() === sic.name.trim());
      if (!matched) {
        const newItemCatId = nextItemCatId();
        matched = {
          id: newItemCatId,
          periodId: activePeriodId,
          name: sic.name
        };
        newItemCats.push(matched);
      }
      itemCatIdMap[sic.id] = matched.id;
    });

    const existingItems = (db.items || []).filter(i => i.periodId === activePeriodId);
    const newItems = [...existingItems];
    const itemIdMap: Record<string, string> = {};

    sourceItems.forEach(si => {
      let matched = newItems.find(i => i.code === si.code || i.name.trim() === si.name.trim());
      if (!matched) {
        const newItemId = nextItemId();
        const originalCatId = si.categoryId;
        const targetCatId = itemCatIdMap[originalCatId] || originalCatId;
        matched = {
          ...si,
          id: newItemId,
          periodId: activePeriodId,
          categoryId: targetCatId
        };
        newItems.push(matched);
      }
      itemIdMap[si.id] = matched.id;
    });

    const existingProds = (db.products || []).filter(p => p.periodId === activePeriodId);
    const newProds = [...existingProds];
    const prodIdMap: Record<string, string> = {};

    sourceProds.forEach(sp => {
      let matched = newProds.find(p => p.code === sp.code || p.name.trim() === sp.name.trim());
      if (!matched) {
        const newProdId = nextProdId();
        const originalCatId = sp.categoryId;
        const targetCatId = catIdMap[originalCatId] || originalCatId;
        
        matched = {
          ...sp,
          id: newProdId,
          periodId: activePeriodId,
          categoryId: targetCatId
        };
        newProds.push(matched);
      }
      prodIdMap[sp.id] = matched.id;
    });

    const existingConversions = (db.unitConversions || []).filter(c => c.periodId === activePeriodId);
    const newConversions = [...existingConversions];

    sourceConversions.forEach(sc => {
      const targetMatId = itemIdMap[sc.rawMaterialId] || sc.rawMaterialId;
      const matched = newConversions.find(c => c.rawMaterialId === targetMatId && c.purchaseUnit === sc.purchaseUnit && c.consumptionUnit === sc.consumptionUnit);
      if (!matched) {
        newConversions.push({
          ...sc,
          id: nextConvId(),
          periodId: activePeriodId,
          rawMaterialId: targetMatId
        });
      }
    });

    const existingFormulas = (db.productFormulas || []).filter(f => f.periodId === activePeriodId);
    const newFormulas = [...existingFormulas];

    sourceFormulas.forEach(sf => {
      const srcProd = sourceProds.find(sp => doesFormulaMatchProduct(sf.productId, sp));
      const targetProdId = srcProd ? prodIdMap[srcProd.id] : prodIdMap[sf.productId];
      const targetProdObj = targetProdId ? newProds.find(p => p.id === targetProdId) : undefined;
      if (targetProdObj) {
        const targetProdKey = getProductFormulaKey(targetProdObj);
        const matched = newFormulas.find(f => doesFormulaMatchProduct(f.productId, targetProdObj) && (f.name || '') === (sf.name || ''));
        if (!matched) {
          const targetIngredients = sf.ingredients.map(ing => {
            const srcItem = sourceItems.find(si => doesIngredientMatchMaterial(ing.rawMaterialId, si));
            const targetItemId = srcItem ? itemIdMap[srcItem.id] : itemIdMap[ing.rawMaterialId];
            const targetItemObj = targetItemId ? newItems.find(i => i.id === targetItemId) : undefined;

            const srcWip = !targetItemObj ? sourceProds.find(sp => sp.isWip && doesIngredientMatchMaterial(ing.rawMaterialId, sp)) : undefined;
            const targetWipId = srcWip ? prodIdMap[srcWip.id] : prodIdMap[ing.rawMaterialId];
            const targetWipObj = targetWipId ? newProds.find(p => p.id === targetWipId) : undefined;

            const resolvedMatKey = targetItemObj
              ? getMaterialFormulaKey(targetItemObj)
              : targetWipObj
                ? getMaterialFormulaKey(targetWipObj)
                : (normalizeAccountingCode(ing.rawMaterialId) || ing.rawMaterialId);

            return {
              rawMaterialId: resolvedMatKey,
              quantity: ing.quantity
            };
          });
          newFormulas.push({
            id: nextFormId(),
            periodId: activePeriodId,
            productId: targetProdKey,
            name: sf.name,
            isActive: sf.isActive,
            ingredients: targetIngredients
          });
        }
      }
    });

    onUpdateDb({
      ...db,
      departments: [...otherDepts, ...newDepts],
      productCategories: [...otherCats, ...newCats],
      itemCategories: [...otherItemCats, ...newItemCats],
      items: [...otherItems, ...newItems],
      products: [...otherProds, ...newProds],
      unitConversions: [...otherConversions, ...newConversions],
      productFormulas: [...otherFormulas, ...newFormulas]
    });

    alert(`کاتالوگ محصولات شامل محصولات، گروه‌ها، مواد مصرفی اولیه و فرمول‌های ساخت با موفقیت از دوره کپی و همگام شد.`);
  };
  
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    code: '',
    accountId: '',
    name: '',
    categoryId: defaultProductCategoryId,
    unit: 'عدد',
    barcode: '',
    barcodeType: 'simple',
    itemIdentifierCode: '',
    packageType: 'سلفون',
    qtyPerPackage: 1,
    weightPerPackage: 1,
    salePrice: 0,
    cogsPrice: 0,
    weight: 0
  });

  // Sync newProduct.categoryId whenever categories or activePeriodId update (prevents empty/stale period IDs)
  React.useEffect(() => {
    setNewProduct(prev => {
      const currentValid = prev.categoryId && categories.some(c => c.id === prev.categoryId);
      if (currentValid) return prev;
      if (prev.categoryId === defaultProductCategoryId) return prev;
      return { ...prev, categoryId: defaultProductCategoryId };
    });
  }, [categories, defaultProductCategoryId, activePeriodId]);

  const filteredProducts = useMemo(() => {
    let pList = products;
    if (selectedCatFilter !== 'ALL') {
      pList = pList.filter(p => p.categoryId === selectedCatFilter);
    }
    if (prodSearch) {
      pList = pList.filter(p => 
        matchPersianString(p.name, prodSearch) || 
        matchPersianString(p.barcode, prodSearch) || 
        matchPersianString(p.accountId, prodSearch)
      );
    }
    return pList;
  }, [products, prodSearch, selectedCatFilter]);

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const isEdit = !!editingProduct;
    const stableId = isEdit 
      ? editingProduct.id 
      : nextSimpleId(db.products, 'prod');
    const rawTarget = isEdit 
      ? editingProduct! 
      : { ...newProduct, id: stableId, periodId: activePeriodId } as Product;

    if (!rawTarget.name || !rawTarget.code) {
      alert('وارد کردن کد محصول و نام محصول الزامی است.');
      return;
    }

    const hasValidCat = rawTarget.categoryId && categories.some(c => c.id === rawTarget.categoryId);
    if (isEdit && !hasValidCat && categories.length > 0) {
      alert('لطفاً گروه کالا را برای این محصول از فهرست انتخاب نمایید.');
      return;
    }
    const target: Product = {
      ...rawTarget,
      categoryId: hasValidCat ? rawTarget.categoryId : defaultProductCategoryId
    };

    let updated = [...db.products];
    let updatedFormulas = db.productFormulas;
    if (isEdit) {
      const prevProd = db.products.find(p => p.id === editingProduct.id);
      updated = updated.map(p => p.id === editingProduct.id ? target : p);
      if (prevProd) {
        const oldKey = getProductFormulaKey(prevProd);
        const newKey = getProductFormulaKey(target);
        if (newKey && oldKey !== newKey && Array.isArray(db.productFormulas)) {
          updatedFormulas = db.productFormulas.map(f => {
            if (f.periodId === activePeriodId && doesFormulaMatchProduct(f.productId, prevProd)) {
              return { ...f, productId: newKey };
            }
            return f;
          });
        }
      }
      setEditingProduct(null);
    } else {
      updated.push(target);
      setNewProduct({
        code: '',
        accountId: '',
        name: '',
        categoryId: defaultProductCategoryId,
        unit: 'عدد',
        barcode: '',
        barcodeType: 'simple',
        itemIdentifierCode: '',
        packageType: 'سلفون',
        qtyPerPackage: 1,
        weightPerPackage: 1,
        salePrice: 0,
        cogsPrice: 0,
        weight: 0
      });
    }

    onUpdateDb({ ...db, products: updated, productFormulas: updatedFormulas });
    setIsProductFormOpen(false);
  };

  const deleteProduct = (id: string) => {
    askConfirm(
      'حذف محصول نهایی',
      'آیا از حذف این محصول نهایی اطمینان دارید؟ تمامی رکوردهای محاسباتی و فرآیندهای خرید و فروش پابرجا مانده، ولی نام این محصول نهایی از فروش‌های جدید کسر می‌شود.',
      () => {
        onUpdateDb({
          ...db,
          products: db.products.filter(p => p.id !== id)
        });
      }
    );
  };

  const exportProductsCSV = () => {
    const headers = ['کد محصول', 'کد حسابداری ردیف', 'نام محصول', 'دسته‌بندی', 'واحد قیاسی', 'وزن محصول (گرم)', 'بارکد', 'سنجش بسته‌بندی', 'تعداد بسته', 'وزن بسته', 'قیمت فروش ریال', 'قیمت تمام شده ریال', 'نوع کالا (تولیدی/خریداری)'];
    const rows = products.map(p => {
      const catObj = categories.find(c => c.id === p.categoryId);
      const effectivePurchased = p.isPurchased !== undefined ? Boolean(p.isPurchased) : Boolean(catObj?.isPurchased);
      return [
        p.code,
        p.accountId,
        p.name,
        catMap[p.categoryId] || 'مشترک',
        p.unit,
        p.weight || 0,
        p.barcode,
        p.packageType,
        p.qtyPerPackage,
        p.weightPerPackage,
        p.salePrice,
        p.cogsPrice,
        effectivePurchased ? 'خریداری' : 'تولیدی'
      ];
    });
    downloadCSV('Gatan_Final_Products', headers, rows);
  };

  const downloadSampleProductsCSV = () => {
    const headers = ['کد محصول', 'کد حسابداری معین', 'نام محصول نهایی', 'گروه محصول', 'واحد فروش', 'وزن محصول (گرم)', 'بارکد', 'نوع بسته‌بندی', 'تعداد در بسته', 'وزن هر بسته', 'نرخ فروش (ریال)', 'بهای کالا cogs (ریال)', 'نوع کالا (تولیدی/خریداری)'];
    const rows = [
      ['P-101', '901010', 'کلوچه کنجدی مینی', 'کلوچه و بیسکوئیت', 'عدد', '50', '987654320011', 'سلفون', '30', '1.5', '120000', '78000', 'تولیدی'],
      ['P-102', '901011', 'بیسکوئیت رژیمی جو', 'کلوچه و بیسکوئیت', 'عدد', '300', '987654320012', 'کارتن', '12', '3.6', '240000', '165000', 'تولیدی'],
      ['P-103', '901012', 'آب معدنی کوچک', 'نوشیدنی آماده', 'عدد', '500', '987654320013', 'شیرینک', '12', '6', '150000', '95000', 'خریداری']
    ];
    downloadCSV('Sample_Gatan_Products', headers, rows);
  };

  const downloadSampleProductCategoriesCSV = () => {
    const headers = ['شناسه', 'عنوان دسته‌بندی محصول'];
    const rows = [
      ['', 'کلوچه و بیسکوئیت'],
      ['', 'کیک معمولی'],
      ['', 'نان فانتزی']
    ];
    downloadCSV('Sample_Gatan_Product_Categories', headers, rows);
  };

  const downloadSamplePeriodicSalesCSV = () => {
    const headers = ['کد حسابداری', 'نام محصول', 'بارکد', 'مقدار فروش', 'تخفیف (ریال)', 'مبلغ ناخالص (ریال)', 'مبلغ خالص (ریال)'];
    const rows = [
      ['901010', 'کلوچه کنجدی مینی', '987654320011', '1200', '1500000', '144000000', '142500000'],
      ['901011', 'بیسکوئیت رژیمی جو', '987654320012', '800', '2000000', '192000000', '190000000']
    ];
    downloadCSV('Sample_Gatan_Periodic_Sales', headers, rows);
  };

  const importProductsCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updated = [...db.products];
      const nextCsvProdId = createSimpleIdGenerator(updated, 'prod');
      let importedCount = 0;
      let updatedCount = 0;

      rows.forEach((row, index) => {
        if (index === 0 || row.length === 0) return;
        const codeVal = (row[0] || '').toString().trim();
        const accountIdVal = (row[1] || '').toString().trim();
        if (!codeVal && !accountIdVal) return;

        // Map Category or default (using normalized Persian comparison)
        const rawCatName = (row[3] || '').toString().trim();
        let matchedCat = rawCatName ? categories.find(c => normCatName(c.name) === normCatName(rawCatName)) : undefined;
        if (!matchedCat) {
          matchedCat = categories.find(c => c.id === defaultProductCategoryId) || categories[0];
        }

        const cogsPriceVal = parseNumber(row[11]) || 0;
        const rawTypeStr = (row[12] || '').toString().trim().toLowerCase();
        const parsedIsPurchased: boolean | undefined =
          rawTypeStr.includes('خرید') || rawTypeStr.includes('بازرگان') || rawTypeStr === 'purchased' || rawTypeStr === 'true' || rawTypeStr === '1'
            ? true
            : (rawTypeStr.includes('تولید') || rawTypeStr === 'produced' || rawTypeStr === 'false' || rawTypeStr === '0'
                ? false
                : undefined);

        // Compare using accountId (if present). If empty, fall back to code.
        const dupIdx = updated.findIndex(ui => 
          ui.periodId === activePeriodId && 
          (
            (accountIdVal && ui.accountId && ui.accountId.trim() === accountIdVal) ||
            (!accountIdVal && ui.code === codeVal)
          )
        );

        if (dupIdx >= 0) {
          // If already registered, update cost price (& purchased type if explicitly specified in CSV)
          updated[dupIdx] = {
            ...updated[dupIdx],
            cogsPrice: cogsPriceVal,
            purchaseCost: cogsPriceVal,
            ...(parsedIsPurchased !== undefined ? { isPurchased: parsedIsPurchased } : {})
          };
          updatedCount++;
        } else {
          const productRow: Product = {
            id: nextCsvProdId(),
            periodId: activePeriodId,
            code: codeVal,
            accountId: accountIdVal,
            name: row[2] || 'محصول وارداتی اکسل',
            categoryId: matchedCat?.id || '',
            unit: row[4]?.includes('کیلو') ? 'کیلو' : 'عدد',
            weight: parseNumber(row[5]) || 0,
            barcode: row[6] || '',
            packageType: (row[7] || 'سلفون') as any,
            qtyPerPackage: parseNumber(row[8]) || 1,
            weightPerPackage: parseNumber(row[9]) || 1,
            salePrice: parseNumber(row[10]) || 0,
            cogsPrice: cogsPriceVal,
            purchaseCost: cogsPriceVal,
            ...(parsedIsPurchased !== undefined ? { isPurchased: parsedIsPurchased } : {})
          };
          updated.push(productRow);
          importedCount++;
        }
      });

      onUpdateDb({ ...db, products: updated });
      alert(`بارگذاری اکسل محصولات پایان یافت:\nتعداد ${toPersianDigits(updatedCount)} محصول (به علت تشابه کد حسابداری) بهای تمام شده (COGS) بروزرسانی شد.\nتعداد ${toPersianDigits(importedCount)} محصول جدید به سیستم افزوده شد.`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };


  // ==========================================
  // TAB 2: PRODUCT CATEGORIES & PRODUCTION DEPARTMENTS
  // ==========================================
  const [prodCatSearch, setProdCatSearch] = useState('');
  const [editingPcatId, setEditingPcatId] = useState<string | null>(null);
  const [pcatNameInput, setPcatNameInput] = useState('');
  const [pcatDeptIdInput, setPcatDeptIdInput] = useState('');
  const [newPcatName, setNewPcatName] = useState('');
  const [newPcatDeptId, setNewPcatDeptId] = useState('');
  const [newPcatIsPurchased, setNewPcatIsPurchased] = useState(false);
  const [catAllocFilter, setCatAllocFilter] = useState<'ALL' | 'UNASSIGNED' | 'ASSIGNED'>('ALL');

  const [newDeptName, setNewDeptName] = useState('');
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [deptNameInput, setDeptNameInput] = useState('');

  const handleAddDept = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = newDeptName.trim().replace(/\s+/g, ' ');
    if (!cleanedName) return;
    const normNew = normCatName(cleanedName);
    const exists = (db.departments || []).some(
      d => d.periodId === activePeriodId && normCatName(d.name) === normNew
    );
    if (exists) {
      alert(`دپارتمان تولیدی با نام «${cleanedName}» قبلاً در این دوره ثبت شده است.`);
      return;
    }
    const created: Department = {
      id: nextSimpleId(db.departments || [], 'dept'),
      periodId: activePeriodId,
      name: cleanedName
    };
    onUpdateDb({
      ...db,
      departments: [...(db.departments || []), created]
    });
    setNewDeptName('');
  };

  const saveDeptEdit = (id: string) => {
    const cleanedName = deptNameInput.trim().replace(/\s+/g, ' ');
    if (!cleanedName) return;
    const normEdited = normCatName(cleanedName);
    const duplicate = (db.departments || []).some(
      d => d.periodId === activePeriodId && d.id !== id && normCatName(d.name) === normEdited
    );
    if (duplicate) {
      alert(`دپارتمان تولیدی با نام «${cleanedName}» قبلاً در این دوره ثبت شده است.`);
      return;
    }
    onUpdateDb({
      ...db,
      departments: (db.departments || []).map(d => d.id === id ? { ...d, name: cleanedName } : d)
    });
    setEditingDeptId(null);
  };

  const deleteDept = (id: string) => {
    askConfirm(
      'حذف دپارتمان تولیدی',
      'با حذف این دپارتمان، دسته‌بندی‌های متصل به آن به وضعیت «تخصیص‌نیافته» درخواهند آمد و تسهیم پرسنل مرتبط به بخش مشترک منتقل می‌شود. ادامه می‌دهید؟',
      () => {
        const remainingDepts = (db.departments || []).filter(d => d.id !== id);
        const periodDepts = remainingDepts.filter(d => d.periodId === activePeriodId);
        const sharedDept = periodDepts.find(d => d.id === 'cat-4' || /-cat-4$/.test(d.id) || normCatName(d.name) === 'مشترک');
        const fallbackAllocDeptId = sharedDept?.id || 'cat-4';

        onUpdateDb({
          ...db,
          departments: remainingDepts,
          productCategories: db.productCategories.map(c =>
            c.periodId === activePeriodId && c.departmentId === id
              ? { ...c, departmentId: undefined }
              : c
          ),
          personnelAllocations: (db.personnelAllocations || []).map(a =>
            a.periodId === activePeriodId && a.departmentCategoryId === id
              ? { ...a, departmentCategoryId: fallbackAllocDeptId }
              : a
          )
        });
      }
    );
  };

  const handleAssignCategoryDepartment = (catId: string, departmentId: string) => {
    const nextDeptId = departmentId ? departmentId : undefined;
    onUpdateDb({
      ...db,
      productCategories: db.productCategories.map(c =>
        c.id === catId ? { ...c, departmentId: nextDeptId } : c
      )
    });
  };

  const searchedPCats = useMemo(() => {
    let list = categories;
    if (catAllocFilter === 'UNASSIGNED') {
      list = list.filter(c => !c.departmentId || !deptMap[c.departmentId]);
    } else if (catAllocFilter === 'ASSIGNED') {
      list = list.filter(c => Boolean(c.departmentId && deptMap[c.departmentId]));
    }
    if (!prodCatSearch) return list;
    return list.filter(c =>
      matchPersianString(c.name, prodCatSearch) ||
      (c.departmentId && deptMap[c.departmentId] && matchPersianString(deptMap[c.departmentId], prodCatSearch))
    );
  }, [categories, prodCatSearch, catAllocFilter, deptMap]);

  const handleAddPCat = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = newPcatName.trim().replace(/\s+/g, ' ');
    if (!cleanedName) return;

    const normNew = normCatName(cleanedName);
    const exists = db.productCategories.some(
      c => c.periodId === activePeriodId && normCatName(c.name) === normNew
    );
    if (exists) {
      alert(`گروه کالایی با نام «${cleanedName}» قبلاً در این دوره ثبت شده است.`);
      return;
    }

    onUpdateDb({
      ...db,
      productCategories: [...db.productCategories, {
        id: nextSimpleId(db.productCategories, 'pcat'),
        periodId: activePeriodId,
        name: cleanedName,
        departmentId: newPcatDeptId || undefined,
        isPurchased: newPcatIsPurchased || undefined
      }]
    });
    setNewPcatName('');
    setNewPcatDeptId('');
    setNewPcatIsPurchased(false);
  };

  const handleToggleCategoryPurchased = (catId: string) => {
    onUpdateDb({
      ...db,
      productCategories: db.productCategories.map(c =>
        c.id === catId ? { ...c, isPurchased: !c.isPurchased } : c
      )
    });
  };

  const savePCatEdit = (id: string) => {
    const cleanedName = pcatNameInput.trim().replace(/\s+/g, ' ');
    if (!cleanedName) return;

    const normEdited = normCatName(cleanedName);
    const duplicate = db.productCategories.some(
      c => c.periodId === activePeriodId && c.id !== id && normCatName(c.name) === normEdited
    );
    if (duplicate) {
      alert(`گروه کالایی با نام «${cleanedName}» قبلاً در این دوره ثبت شده است.`);
      return;
    }

    onUpdateDb({
      ...db,
      productCategories: db.productCategories.map(c =>
        c.id === id ? { ...c, name: cleanedName, departmentId: pcatDeptIdInput || undefined } : c
      )
    });
    setEditingPcatId(null);
  };

  const deletePCat = (id: string) => {
    askConfirm(
      'حذف دسته‌بندی محصول',
      'پس از حذف این دسته‌بندی محصول، محصولات تابعه نیاز به انتخاب مجدد دسته‌بندی خواهند داشت، ادامه می‌دهید؟',
      () => {
        const remainingCats = db.productCategories.filter(c => c.id !== id);
        const remainingPeriodCats = remainingCats.filter(c => c.periodId === activePeriodId);
        const fallbackProdCatId = remainingPeriodCats[0]?.id || '';

        onUpdateDb({
          ...db,
          productCategories: remainingCats,
          products: db.products.map(p =>
            p.periodId === activePeriodId && p.categoryId === id
              ? { ...p, categoryId: fallbackProdCatId }
              : p
          )
        });
      }
    );
  };

  const exportPCatCSV = () => {
    const headers = ['شناسه', 'عنوان دسته‌بندی محصول', 'دپارتمان تولیدی'];
    const rows = categories.map(c => [c.id, c.name, (c.departmentId && deptMap[c.departmentId]) || 'تخصیص‌نیافته']);
    downloadCSV('Gatan_Product_Categories', headers, rows);
  };

  const importPCatCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updated = [...db.productCategories];
      const nextImpPcatId = createSimpleIdGenerator(updated, 'pcat');
      let count = 0;

      rows.forEach((row, idx) => {
        if (idx === 0 || row.length === 0) return;
        const rawVal = (row[1] || row[0] || '').toString().trim().replace(/\s+/g, ' ');
        if (!rawVal) return;
        const rawDeptName = (row[2] || '').toString().trim().replace(/\s+/g, ' ');
        const matchedDept = rawDeptName
          ? departments.find(d => normCatName(d.name) === normCatName(rawDeptName))
          : undefined;

        const normVal = normCatName(rawVal);
        if (!updated.some(c => c.periodId === activePeriodId && normCatName(c.name) === normVal)) {
          updated.push({
            id: nextImpPcatId(),
            periodId: activePeriodId,
            name: rawVal,
            departmentId: matchedDept?.id
          });
          count++;
        }
      });

      onUpdateDb({ ...db, productCategories: updated });
      alert(`${toPersianDigits(count)} دسته‌بندی به بخش محصولات اضافه شد.`);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };


  // ==========================================
  // TAB 3: MONTHLY SALES CYCLES (ثبت فروش ماهانه)
  // ==========================================
  const selectedSalesPeriodId = activePeriodId;
  const [manualSaleProdId, setManualSaleProdId] = useState('');
  const [manualSaleQty, setManualSaleQty] = useState(1);
  const [manualSaleDisc, setManualSaleDisc] = useState(0);
  const [manualSaleUnitPrice, setManualSaleUnitPrice] = useState<number>(0);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);

  // Barcode Scanner in Sales Registry
  const [barcodeScanInput, setBarcodeScanInput] = useState('');
  const [barcodeScanFeedback, setBarcodeScanFeedback] = useState<{
    status: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const handleBarcodeScan = (e: React.KeyboardEvent<HTMLInputElement> | React.FormEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const cleanInput = barcodeScanInput.trim();
    if (!cleanInput) return;

    const result = parseScannedBarcode(cleanInput, products, getPeriodBarcodeSettings(db, activePeriodId));

    if (result.matchedProduct) {
      setManualSaleProdId(result.matchedProduct.id);
      setManualSaleUnitPrice(result.matchedProduct.salePrice || 0);

      if (result.isVariable) {
        if (result.type === 'weighted' && result.extractedWeightKg !== undefined) {
          setManualSaleQty(result.extractedWeightKg);
          setBarcodeScanFeedback({
            status: 'success',
            message: `✅ بارکد وزنی دیبال تشخیص داده شد: ${result.matchedProduct.name} | وزن خالص: ${toPersianDigits(result.extractedWeightKg)} کیلوگرم (${toPersianDigits(result.extractedWeightGram || 0)} گرم)`
          });
        } else if (result.type === 'count' && result.extractedCount !== undefined) {
          setManualSaleQty(result.extractedCount);
          setBarcodeScanFeedback({
            status: 'success',
            message: `✅ بارکد تعدادی دیبال تشخیص داده شد: ${result.matchedProduct.name} | تعداد: ${toPersianDigits(result.extractedCount)} عدد`
          });
        }
      } else {
        setManualSaleQty(1);
        setBarcodeScanFeedback({
          status: 'success',
          message: `✅ بارکد استاندارد کالا یافت شد: ${result.matchedProduct.name} (فی: ${formatWithCommas(result.matchedProduct.salePrice)} ریال)`
        });
      }
      setBarcodeScanInput('');
    } else {
      setBarcodeScanFeedback({
        status: 'error',
        message: result.error || `❌ بارکد "${cleanInput}" با هیچ محصول یا الگوی ترازویی تطابق ندارد.`
      });
    }
  };

  // New States for Search, Edit & Delete in Invoices & Sales
  const [salesSearchText, setSalesSearchText] = useState('');

  const activeSalesPeriodData = useMemo(() => {
    return db.periods.find(p => p.id === activePeriodId);
  }, [db.periods, activePeriodId]);

  const activeSalesRecords = useMemo(() => {
    return salesRecords;
  }, [salesRecords]);

  const filteredActiveSalesRecords = useMemo(() => {
    if (!salesSearchText.trim()) return activeSalesRecords;
    return activeSalesRecords.filter(rec => {
      const p = productMap[rec.productId];
      if (!p) return false;
      return (
        matchPersianString(p.name, salesSearchText) ||
        matchPersianString(p.code, salesSearchText) ||
        (p.accountId && matchPersianString(p.accountId, salesSearchText))
      );
    });
  }, [activeSalesRecords, salesSearchText, productMap]);

  const handleAddManualSale = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSaleProdId) {
      alert('محصول انتخابی نامعتبر است.');
      return;
    }

    const prod = productMap[manualSaleProdId];
    if (!prod) return;

    const roundedQty = Math.round(manualSaleQty * 100) / 100;
    const unitPrice = manualSaleUnitPrice > 0 ? manualSaleUnitPrice : prod.salePrice;
    const gross = roundedQty * unitPrice;
    const net = gross - manualSaleDisc;

    let updatedSales = [...db.productSales];

    if (editingSaleId) {
      updatedSales = updatedSales.map(s => s.id === editingSaleId ? {
        ...s,
        productId: manualSaleProdId,
        qtySold: roundedQty,
        discount: manualSaleDisc,
        preDiscountAmount: gross,
        netSalesAmount: net,
        month: selectedSalesMonth,
        year: selectedSalesYear
      } : s);
      setEditingSaleId(null);
    } else {
      const alreadyExist = activeSalesRecords.find(s => s.productId === manualSaleProdId);
      if (alreadyExist) {
        updatedSales = updatedSales.map(s => s.id === alreadyExist.id ? {
          ...s,
          qtySold: roundedQty,
          discount: manualSaleDisc,
          preDiscountAmount: gross,
          netSalesAmount: net,
          month: selectedSalesMonth,
          year: selectedSalesYear
        } : s);
      } else {
        updatedSales.push({
          id: nextSimpleId(updatedSales, 'psale'),
          salesPeriodId: activePeriodId,
          periodId: activePeriodId,
          productId: manualSaleProdId,
          qtySold: roundedQty,
          discount: manualSaleDisc,
          preDiscountAmount: gross,
          netSalesAmount: net,
          month: selectedSalesMonth,
          year: selectedSalesYear
        });
      }
    }

    onUpdateDb({ ...db, productSales: updatedSales });
    setManualSaleProdId('');
    setManualSaleQty(1);
    setManualSaleDisc(0);
    setManualSaleUnitPrice(0);
  };

  const deleteSaleRecord = (id: string) => {
    askConfirm(
      'حذف رکورد فروش',
      'آیا مایل به حذف این رکورد فروش هستید؟ این عملیات درآمد ثبت شده را از محاسبات سود و زیان کسر خواهد کرد.',
      () => {
        onUpdateDb({
          ...db,
          productSales: db.productSales.filter(s => s.id !== id)
        });
      }
    );
  };

  // Bulk Periodic Sale Import from Excel/CSV (including auto missing product creation)
  const importPeriodicSalesCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (!buffer) return;

      const text = decodeFileBuffer(buffer);
      const rows = parseCSVText(text);
      const updatedProducts = [...db.products];
      const updatedSales = [...db.productSales];
      const nextAutoProdId = createSimpleIdGenerator(updatedProducts, 'prod');
      const nextAutoSaleId = createSimpleIdGenerator(updatedSales, 'psale');
      let importCount = 0;

      rows.forEach((row, idx) => {
        if (idx === 0 || row.length === 0) return;

        const ledgerCode = row[0];
        const productName = row[1];
        if (!ledgerCode && !productName) return;

        const barcode = row[2] || '';
        const qty = parseNumber(row[3]) || 0;
        const discount = parseNumber(row[4]) || 0;
        const gross = parseNumber(row[5]) || (qty * 400000); // fallback mock base
        const net = parseNumber(row[6]) || (gross - discount);

        // Check if product exists in current master Catalog
        let prodObj = updatedProducts.find(p => p.periodId === activePeriodId && p.accountId === ledgerCode);
        if (!prodObj && productName) {
          prodObj = updatedProducts.find(p => p.periodId === activePeriodId && p.name === productName);
        }

        // If product doesn't exist, we dynamically register it instantly!
        if (!prodObj) {
          const freshProdId = nextAutoProdId();
          prodObj = {
            id: freshProdId,
            periodId: activePeriodId,
            code: `P-${idx}`,
            accountId: ledgerCode || `LEDGER-${idx}`,
            name: productName || 'محصول ایجاد شده هوشمند',
            categoryId: defaultProductCategoryId,
            unit: 'عدد',
            barcode: barcode,
            packageType: 'سلفون',
            qtyPerPackage: 1,
            weightPerPackage: 1,
            salePrice: qty > 0 ? Math.round(net / qty) : 500000,
            cogsPrice: qty > 0 ? Math.round((net * 0.6) / qty) : 300000 // default 60% margin
          };
          updatedProducts.push(prodObj);
        } else {
          // If the product already exists, let's update its salePrice based on the unit price from Excel!
          if (qty > 0) {
            const calculatedUnitPrice = Math.round(net / qty);
            const existingIdx = updatedProducts.findIndex(p => p.id === prodObj!.id);
            if (existingIdx >= 0) {
              updatedProducts[existingIdx] = {
                ...updatedProducts[existingIdx],
                salePrice: calculatedUnitPrice
              };
              prodObj = updatedProducts[existingIdx];
            }
          }
        }

        // Register the periodic sale for selected month and year
        const saleExistsIndex = updatedSales.findIndex(s => 
          s.periodId === activePeriodId && 
          s.productId === prodObj!.id &&
          (Number(s.month !== undefined ? s.month : 1) === Number(selectedSalesMonth)) &&
          (Number(s.year !== undefined ? s.year : selectedSalesYear) === Number(selectedSalesYear))
        );
        const saleObj: ProductSale = {
          id: saleExistsIndex >= 0 ? updatedSales[saleExistsIndex].id : nextAutoSaleId(),
          salesPeriodId: activePeriodId,
          periodId: activePeriodId,
          productId: prodObj.id,
          qtySold: qty,
          discount: discount,
          preDiscountAmount: gross,
          netSalesAmount: net,
          month: selectedSalesMonth,
          year: selectedSalesYear
        };

        if (saleExistsIndex >= 0) {
          updatedSales[saleExistsIndex] = saleObj;
        } else {
          updatedSales.push(saleObj);
        }
        importCount++;
      });

      onUpdateDb({
        ...db,
        products: updatedProducts,
        productSales: updatedSales
      });
      alert(`${importCount} ردیف فروش برای ماه ${PERSIAN_MONTHS[selectedSalesMonth - 1]} با موفقیت بازنشانی شد. محصولات جاافتاده به صورت خودکار ثبت گردیدند.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const clearAllProducts = () => {
    askConfirm(
      'حذف عمومی تمامی محصولات',
      'آیا از حذف کلی تمامی محصولات ثبت شده در این دوره مالی اطمینان کامل دارید؟ این عمل غیرقابل بازگشت است و تمام رکوردهای محصول نیز حذف خواهند شد.',
      () => {
        const remainingProds = db.products.filter(p => p.periodId !== activePeriodId);
        onUpdateDb({ ...db, products: remainingProds });
      }
    );
  };

  const clearAllProductCategories = () => {
    askConfirm(
      'حذف عمومی دسته‌بندی محصولات',
      'آیا از حذف کلی تمامی دسته‌بندی‌های محصولات ثبت شده در این بازه اطمینان کامل دارید؟ (دپارتمان‌های تولیدی و تخصیص پرسنل حفظ می‌شوند)',
      () => {
        const deletedIds = new Set(db.productCategories.filter(c => c.periodId === activePeriodId).map(c => c.id));
        const remainingPCats = db.productCategories.filter(c => c.periodId !== activePeriodId);
        onUpdateDb({
          ...db,
          productCategories: remainingPCats,
          products: db.products.map(p =>
            p.periodId === activePeriodId && deletedIds.has(p.categoryId)
              ? { ...p, categoryId: '' }
              : p
          )
        });
      }
    );
  };

  const clearAllSales = () => {
    const curMonthName = PERSIAN_MONTHS[selectedSalesMonth - 1];
    askConfirm(
      'حذف رکوردهای فروش ماه انتخابی',
      `آیا مایلید تمامی رکوردهای فروش ثبت شده در ماه «${curMonthName} ${toPersianDigits(selectedSalesYear)}» به صورت کامل حذف شوند؟ رکوردهای سایر ماه‌ها دست‌نخورده باقی خواهند ماند.`,
      () => {
        const defaultYm = getDefaultYearMonthFromPeriod(db.periods.find(p => p.id === activePeriodId), activePeriodId);
        const remainingSales = db.productSales.filter(s => {
          if (s.periodId !== activePeriodId) return true;
          const sMonth = s.month !== undefined ? Number(s.month) : defaultYm.month;
          const sYear = s.year !== undefined ? Number(s.year) : defaultYm.year;
          return !(sMonth === selectedSalesMonth && sYear === selectedSalesYear);
        });
        onUpdateDb({ ...db, productSales: remainingSales });
      }
    );
  };


  // ==========================================
  // TAB 4: ADVANCED SALES ANALYTICS & RECHARTS
  // ==========================================
  const totalSalesRevenueNet = useMemo(() => {
    return activeSalesRecords.reduce((acc, current) => acc + current.netSalesAmount, 0);
  }, [activeSalesRecords]);

  // Profits & Costs calculations matching Section 3-c-xii/xiii
  const productsWithLossAndProfit = useMemo(() => {
    return activeSalesRecords.map(sale => {
      const prod = productMap[sale.productId];
      if (!prod) return null;
      
      const totalCOGS = sale.qtySold * prod.cogsPrice;
      const profitValue = sale.netSalesAmount - totalCOGS;
      const isLossMaking = profitValue < 0;

      return {
        sale,
        prod,
        totalCOGS,
        profitValue,
        isLossMaking
      };
    }).filter(Boolean) as any[];
  }, [activeSalesRecords, productMap]);

  const lossyProductsList = useMemo(() => {
    return productsWithLossAndProfit.filter(x => x.isLossMaking);
  }, [productsWithLossAndProfit]);

  const profitableProductsList = useMemo(() => {
    return productsWithLossAndProfit.filter(x => !x.isLossMaking);
  }, [productsWithLossAndProfit]);


  // Historical sales comparator helper compared to another period (e.g., previous month)
  // "نمایش وضعیت رشد فروش محصولات رشد تعدادی یا وزنی و رشد مبلغ فروش به تفکیک هر محصول"
  const comparedPeriodId = useMemo(() => {
    const sorted = [...db.periods].sort((a, b) => a.id.localeCompare(b.id));
    const currentIndex = sorted.findIndex(p => p.id === activePeriodId);
    if (currentIndex > 0) {
      return sorted[currentIndex - 1].id;
    }
    return db.periods.find(p => p.id !== activePeriodId)?.id || '';
  }, [db.periods, activePeriodId]);
  
  const growthComparisonList = useMemo(() => {
    if (!comparedPeriodId) return [];

    return activeSalesRecords.map(sale => {
      const prodObj = productMap[sale.productId];
      if (!prodObj) return null;

      // Find the equivalent product in the compared period by code or name
      const compProd = db.products.find(p => p.periodId === comparedPeriodId && (
        (p.code && p.code === prodObj.code) || 
        (p.name && p.name === prodObj.name)
      ));

      const compSale = compProd 
        ? db.productSales.find(s => s.periodId === comparedPeriodId && s.productId === compProd.id)
        : null;

      const priorQty = compSale ? compSale.qtySold : 0;
      const priorRevenue = compSale ? compSale.netSalesAmount : 0;

      const qtyGrowth = sale.qtySold - priorQty;
      const qtyGrowthPct = priorQty > 0 ? (qtyGrowth / priorQty) * 100 : 100;
      const revGrowth = sale.netSalesAmount - priorRevenue;
      const revGrowthPct = priorRevenue > 0 ? (revGrowth / priorRevenue) * 100 : 100;

      return {
        prod: prodObj,
        currentQty: sale.qtySold,
        currentRev: sale.netSalesAmount,
        priorQty,
        priorRev: priorRevenue,
        qtyGrowth,
        qtyGrowthPct,
        revGrowth,
        revGrowthPct
      };
    }).filter(Boolean) as any[];
  }, [activeSalesRecords, comparedPeriodId, productMap, db.products, db.productSales]);

  const printProfitLossReport = () => {
    const el = document.getElementById('sales-profit-loss-table');
    if (el) {
      printElement('گزارش سود و زیان و بررسی قیمت تمام شده محصولات', el.outerHTML);
    }
  };


  const downloadSamplePackagingExcel = () => {
    downloadTemplateExcel(
      ['عنوان نوع بسته‌بندی', 'توضیحات'],
      [
        { 'عنوان نوع بسته‌بندی': 'جعبه شیرینی ۱ کیلویی', 'توضیحات': 'جعبه مقوایی ویژه قنادی' },
        { 'عنوان نوع بسته‌بندی': 'کیسه نانوایی', 'توضیحات': 'بسته‌بندی نان تازه' },
      ],
      'بسته‌بندی',
      'نمونه_انواع_بسته_بندی'
    );
  };

  const exportPackagingExcel = () => {
    exportRowsToExcel(
      searchedPkgTypes.map((pt, idx) => ({
        'ردیف': idx + 1,
        'عنوان نوع بسته‌بندی': pt.name,
        'توضیحات': pt.description || '',
      })),
      'انواع_بسته_بندی',
      'بسته‌بندی'
    );
  };

  const importPackagingFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = await readSpreadsheetRows(file);
      if (rows.length === 0) return;
      const existing = db.packagingTypes || [];
      const genId = createSimpleIdGenerator(existing, 'pkg');
      const existingNames = new Set(existing.filter(p => p.periodId === activePeriodId).map(p => p.name.trim().toLowerCase()));
      const added: PackagingType[] = [];
      for (const row of rows) {
        const name = String(pickRowField(row, ['عنوان نوع بسته‌بندی', 'نوع بسته‌بندی', 'عنوان', 'name']) || '').trim();
        if (!name || existingNames.has(name.toLowerCase())) continue;
        existingNames.add(name.toLowerCase());
        added.push({
          id: genId(),
          periodId: activePeriodId,
          name,
          description: String(pickRowField(row, ['توضیحات', 'مشخصات', 'description']) || '').trim(),
        });
      }
      if (added.length > 0) {
        onUpdateDb({ ...db, packagingTypes: [...existing, ...added] });
      }
    } catch {
      // handled gracefully
    }
  };

  const exportMonthlySalesExcel = () => {
    exportRowsToExcel(
      filteredActiveSalesRecords.map((rec, idx) => {
        const p = productMap[rec.productId];
        return {
          'ردیف': idx + 1,
          'کد محصول': p?.code || rec.productId,
          'نام محصول': p?.name || '',
          'تعداد فروش': rec.quantitySold,
          'فی فروش واحد (ریال)': rec.unitPrice,
          'مبلغ ناخالص (ریال)': rec.grossSalesAmount,
          'تخفیف (ریال)': rec.discountAmount,
          'خالص فروش (ریال)': rec.netSalesAmount,
        };
      }),
      `فروش_ماهانه_${PERSIAN_MONTHS[selectedSalesMonth - 1]}_${selectedSalesYear}`,
      'فروش ماهانه'
    );
  };

  const currentMonthStats = monthlySalesStats[selectedSalesMonth] || { count: 0, totalAmount: 0, totalQty: 0 };

  return (
    <div className="space-y-6 animate-fadeIn pb-12 text-right font-sans" dir="rtl">
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <ModuleHeader
          icon={<ShoppingBag className="w-5 h-5" />}
          title="مدیریت فروش و محصولات نهایی"
          subtitle="تعریف کاتالوگ محصولات، دسته‌بندی‌ها، بسته‌بندی، بارکد، ثبت فروش ماهانه و تحلیل عملکرد فروش (ایزوله در دوره فعال)"
          periodName={activePeriodObj?.name}
          recordCount={products.length}
          recordLabel="محصول"
          actions={
            <ErpButton variant="secondary" size="sm" icon={<Copy className="w-3.5 h-3.5" />} onClick={() => setShowCopyModal(true)}>
              {ERP_BUTTON_LABELS.copyFromPeriod}
            </ErpButton>
          }
        />

        <ModulePrimaryTabs
          activeTab={activeTab}
          onChange={(id) => {
            setActiveTab(id as typeof activeTab);
            setIsProductFormOpen(false);
          }}
          tabs={[
            { id: 'products', label: 'تعریف محصولات نهایی', count: products.length },
            {
              id: 'categories',
              label: 'دسته‌بندی و دپارتمان‌ها',
              count: categories.length,
              badge: unassignedCategories.length > 0 ? `${toPersianDigits(unassignedCategories.length)} بدون دپارتمان` : undefined
            },
            { id: 'packaging', label: 'نوع بسته‌بندی', count: packagingTypesList.length },
            { id: 'barcodes', label: 'تنظیمات بارکد', icon: <BarcodeIcon className="h-4 w-4" /> },
            { id: 'records', label: 'ثبت فروش ماهانه', count: salesRecords.length },
            { id: 'analysis', label: 'تحلیل فروش ماهانه' },
            { id: 'shelf_tags', label: 'تگ و برچسب قفسه', icon: <Tag className="h-4 w-4" /> }
          ]}
        />
      </div>

      {/* Main Content Card */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right" dir="rtl">
        {!(activeTab === 'products' && isProductFormOpen) && (
          <KpiStrip
            items={[
              { label: 'محصولات نهایی کاتالوگ', value: toPersianDigits(products.length), sublabel: `${toPersianDigits(categories.length)} دسته‌بندی فعال`, tone: 'default' },
              { label: `اقلام فروش ${PERSIAN_MONTHS[selectedSalesMonth - 1]}`, value: toPersianDigits(currentMonthStats.count), sublabel: `${toPersianDigits(Math.round(currentMonthStats.totalQty * 100) / 100)} واحد فروخته‌شده`, tone: 'info' },
              { label: `خالص فروش ${PERSIAN_MONTHS[selectedSalesMonth - 1]}`, value: formatWithCommas(currentMonthStats.totalAmount), sublabel: 'ریال', tone: 'success' },
              { label: 'وضعیت تخصیص دپارتمان', value: unassignedCategories.length > 0 ? `${toPersianDigits(unassignedCategories.length)} نیازمند تخصیص` : 'تکمیل', sublabel: `${toPersianDigits(packagingTypesList.length)} نوع بسته‌بندی`, tone: unassignedCategories.length > 0 ? 'warning' : 'success' },
            ]}
          />
        )}

      {/* Global Sales Module Header & 12-Month Selector */}
      {!(activeTab === 'products' && isProductFormOpen) && (
      <div className="bg-slate-950 border border-slate-850 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 shadow-xl space-y-3 sm:space-y-4" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-850/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-2xl shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 text-right">
              <h4 className="text-sm font-black text-white flex items-center gap-2 flex-wrap">
                <span>مدیریت و ثبت فروش ماهانه:</span>
                <span className="text-rose-400 font-extrabold">{PERSIAN_MONTHS[selectedSalesMonth - 1]} {toPersianDigits(selectedSalesYear)}</span>
                {unassignedCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('categories')}
                    className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 font-black hover:bg-amber-500/25 transition-colors cursor-pointer"
                  >
                    ⚠ {toPersianDigits(unassignedCategories.length)} دسته‌بندی بدون دپارتمان
                  </button>
                )}
              </h4>
              <p className="text-[10.5px] text-slate-400">
                انتخاب ماه در این سربرگ به صورت هماهنگ روی ثبت فروش ماهانه، فاکتورها، سود و زیان و داشبورد تحلیل فروش اعمال می‌شود
              </p>
            </div>
          </div>

          {/* Fiscal Year badge (locked to fiscal period, determined automatically) */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-1.5 shadow-inner" title="سال مالی بر اساس دوره فعال در مدیریت دوره‌های زمانی و مالی تعیین شده است">
              <span className="text-[10.5px] text-slate-400 font-bold">سال مالی دوره:</span>
              <span className="text-xs font-black text-rose-400 font-mono">
                {toPersianDigits(selectedSalesYear)}
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
            const isSelected = selectedSalesMonth === monthNum;
            const stats = monthlySalesStats[monthNum] || { count: 0, totalAmount: 0, totalQty: 0 };
            const hasSales = stats.count > 0;

            return (
              <button
                key={`sales-global-month-${monthNum}`}
                type="button"
                onClick={() => setSelectedSalesMonth(monthNum)}
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
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" title="دارای فروش"></span>
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
                      ✓ {toPersianDigits(stats.count)} کالا
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

        {/* Selected Month Status & Shared Catalog Indicator */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl shrink-0 ${
                monthlySalesStats[selectedSalesMonth]?.count > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
              }`}>
                <Calendar className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-1 text-right">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-white">
                    وضعیت فروش ماه {PERSIAN_MONTHS[selectedSalesMonth - 1]} {toPersianDigits(selectedSalesYear)}:
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    monthlySalesStats[selectedSalesMonth]?.count > 0
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-black'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {monthlySalesStats[selectedSalesMonth]?.count > 0 ? `✓ دارای ${toPersianDigits(monthlySalesStats[selectedSalesMonth].count)} قلم فروش` : 'فاقد رکورد فروش'}
                  </span>
                  {(activeTab === 'products' || activeTab === 'categories' || activeTab === 'packaging' || activeTab === 'barcodes') && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 font-bold">
                      کاتالوگ، دپارتمان‌ها و تنظیمات پایه در کل دوره مشترک هستند
                    </span>
                  )}
                </div>
                {monthlySalesStats[selectedSalesMonth]?.count > 0 && (
                  <div className="text-[11px] text-slate-300 flex items-center gap-x-4 gap-y-1 flex-wrap pt-0.5 font-sans">
                    <span>تعداد اقلام: <strong className="text-white font-mono">{toPersianDigits(monthlySalesStats[selectedSalesMonth].count)} قلم</strong></span>
                    <span>مجموع تعداد فروش: <strong className="text-amber-400 font-mono">{toPersianDigits(Math.round(monthlySalesStats[selectedSalesMonth].totalQty * 100) / 100)}</strong></span>
                    <span>جمع کل درآمد خالص: <strong className="text-emerald-400 font-mono">{formatWithCommas(monthlySalesStats[selectedSalesMonth].totalAmount)} ریال</strong></span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Active Tab Content */}

      {/* ================= TAB 1: DEFINE PRODUCTS ================= */}
      {activeTab === 'products' && (
        <div className="space-y-5 animate-fade-in">
          {/* 1. TOP TOOLBAR: SEARCH, CATEGORY FILTER & ACTION BUTTONS */}
          {!isProductFormOpen && (
          <div className="space-y-3">
            <UnifiedToolbar
              searchValue={prodSearch}
              onSearchChange={setProdSearch}
              searchPlaceholder="جستجوی محصول در کاتالوگ (کد کالا، نام محصول، بارکد، گروه)..."
              onAdd={() => {
                setEditingProduct(null);
                setIsProductFormOpen(true);
              }}
              addLabel={ERP_BUTTON_LABELS.add}
              hasActiveFilters={Boolean(prodSearch || selectedCatFilter !== 'ALL')}
              onClearFilters={() => {
                setProdSearch('');
                setSelectedCatFilter('ALL');
              }}
              onDownloadTemplate={downloadSampleProductsCSV}
              onImportExcel={importProductsCSV}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={exportProductsCSV}
              onPrint={() => printElement('sales-products-printable', 'کاتالوگ محصولات نهایی')}
              extraSecondaryActions={
                <>
                  {selectedProductIds.length > 0 && (
                    <ErpButton
                      variant="primary"
                      size="sm"
                      onClick={handleBatchDeleteProducts}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      حذف دسته‌ای ({toPersianDigits(selectedProductIds.length)})
                    </ErpButton>
                  )}
                  <ErpButton
                    variant="danger"
                    size="sm"
                    onClick={clearAllProducts}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    title="حذف کلی کاتالوگ محصولات نهایی"
                  >
                    حذف کلی کاتالوگ
                  </ErpButton>
                </>
              }
            />

            <UnifiedFilterBar columnsClass="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={UNIFIED_FILTER_LABEL_CLASS}>گروه و دسته‌بندی محصول</label>
                <select
                  id="filter-cat"
                  className={UNIFIED_FILTER_SELECT_CLASS}
                  value={selectedCatFilter}
                  onChange={(e) => setSelectedCatFilter(e.target.value)}
                >
                  <option value="ALL">همه گروه‌های کالا ({toPersianDigits(products.length)})</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </UnifiedFilterBar>
          </div>
          )}

          {/* 2. PRODUCT DEFINITION FORM (FULL-WIDTH TOGGLEABLE VIEW) */}
          {isProductFormOpen && (
          <div className="bg-slate-900/60 border border-slate-800 backdrop-blur-md p-5 rounded-2xl space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs font-black text-slate-100 flex items-center gap-2">
                  <div className="p-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg">
                    <Plus className="h-4 w-4" />
                  </div>
                  {editingProduct ? 'ویرایش شناسنامه محصول نهایی' : 'تعریف محصول جدید در کاتالوگ'}
                </h3>
                {editingProduct && (
                  <span className="text-[11px] font-mono px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg font-bold">
                    در حال ویرایش: {editingProduct.name} ({editingProduct.code})
                  </span>
                )}
              </div>
              <ErpButton
                type="button"
                variant="secondary"
                size="sm"
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={() => {
                  setEditingProduct(null);
                  setIsProductFormOpen(false);
                }}
              >
                انصراف و بازگشت
              </ErpButton>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4">
              {/* Row 1: Primary Identity Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
                <div className="lg:col-span-2">
                  <label htmlFor="p-code" className="block text-[11px] font-bold text-slate-300 mb-1.5">کد اختصاصی کالا *</label>
                  <input
                    id="p-code"
                    type="text"
                    placeholder="مثال: PRD-101"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={editingProduct ? editingProduct.code : newProduct.code}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, code: e.target.value}) : setNewProduct({...newProduct, code: e.target.value})}
                    required
                  />
                </div>

                <div className="lg:col-span-2">
                  <label htmlFor="p-ledger" className="block text-[11px] font-bold text-slate-300 mb-1.5">کد حسابداری معین</label>
                  <input
                    id="p-ledger"
                    type="text"
                    placeholder="مثال: 140101"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={editingProduct ? editingProduct.accountId : newProduct.accountId}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, accountId: e.target.value}) : setNewProduct({...newProduct, accountId: e.target.value})}
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <label htmlFor="p-name" className="block text-[11px] font-bold text-slate-300 mb-1.5">نام دقیق کالا / محصول نهایی *</label>
                  <input
                    id="p-name"
                    type="text"
                    placeholder="نام کامل محصول (مثال: نان بربری سنتی ۵۰۰ گرمی)..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-bold"
                    value={editingProduct ? editingProduct.name : newProduct.name}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, name: e.target.value}) : setNewProduct({...newProduct, name: e.target.value})}
                    required
                  />
                </div>

                <div className="lg:col-span-2">
                  <label htmlFor="p-cat" className="block text-[11px] font-bold text-slate-300 mb-1.5">گروه کالا</label>
                  <select
                    id="p-cat"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer font-bold"
                    value={editingProduct
                      ? (categories.some(c => c.id === editingProduct.categoryId) ? editingProduct.categoryId : '')
                      : (categories.some(c => c.id === newProduct.categoryId) ? (newProduct.categoryId || '') : '')}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, categoryId: e.target.value}) : setNewProduct({...newProduct, categoryId: e.target.value})}
                  >
                    <option value="" className="bg-slate-950 text-slate-400">-- انتخاب گروه کالا --</option>
                    {categories.map(c => <option key={c.id} value={c.id} className="bg-slate-950 text-slate-100">{c.name}</option>)}
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label htmlFor="p-unit" className="block text-[11px] font-bold text-slate-300 mb-1.5">واحد فروش</label>
                  <select
                    id="p-unit"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer font-bold"
                    value={editingProduct ? editingProduct.unit : newProduct.unit}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, unit: e.target.value as any}) : setNewProduct({...newProduct, unit: e.target.value as any})}
                  >
                    <option value="عدد" className="bg-slate-950 text-slate-100">عدد (واحدی)</option>
                    <option value="کیلو" className="bg-slate-950 text-slate-100">کیلوگرم</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Packaging, Weight, Prices */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label htmlFor="p-pkg" className="block text-[11px] font-bold text-slate-300 mb-1.5">نوع بسته‌بندی توزیع</label>
                  <select
                    id="p-pkg"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer font-bold"
                    value={editingProduct ? editingProduct.packageType : newProduct.packageType}
                    onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, packageType: e.target.value as any}) : setNewProduct({...newProduct, packageType: e.target.value as any})}
                  >
                    {packagingTypesList.map(pt => (
                      <option key={pt.id} value={pt.name} className="bg-slate-950 text-slate-100">
                        {pt.name}
                      </option>
                    ))}
                    {!packagingTypesList.some(pt => pt.name === 'سلفون') && <option value="سلفون" className="bg-slate-950 text-slate-100">سلفون</option>}
                    {!packagingTypesList.some(pt => pt.name === 'شیرینک') && <option value="شیرینک" className="bg-slate-950 text-slate-100">شیرینک</option>}
                    {!packagingTypesList.some(pt => pt.name === 'جعبه') && <option value="جعبه" className="bg-slate-950 text-slate-100">جعبه</option>}
                  </select>
                </div>

                <div>
                  <label htmlFor="p-weight" className="block text-[11px] font-bold text-slate-300 mb-1.5">وزن خالص واحد (گرم)</label>
                  <input
                    id="p-weight"
                    type="number"
                    step="1"
                    min="0"
                    placeholder="مثال: ۱۵۰"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 placeholder-slate-600"
                    value={editingProduct ? (editingProduct.weight ?? '') : (newProduct.weight ?? '')}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (editingProduct) setEditingProduct({...editingProduct, weight: val});
                      else setNewProduct({...newProduct, weight: val});
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="p-sale-price" className="block text-[11px] font-bold text-slate-300 mb-1.5">قیمت فروش مصوب (ریال)</label>
                  <input
                    id="p-sale-price"
                    type="text"
                    onFocus={handleFocus}
                    placeholder="۰"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={formatWithCommas(editingProduct ? editingProduct.salePrice : newProduct.salePrice)}
                    onChange={(e) => {
                      const v = parseNumber(e.target.value);
                      if (editingProduct) setEditingProduct({...editingProduct, salePrice: v});
                      else setNewProduct({...newProduct, salePrice: v});
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="p-cogs-price" className="block text-[11px] font-bold text-slate-300 mb-1.5">بهای تمام شده محاسباتی (ریال)</label>
                  <input
                    id="p-cogs-price"
                    type="text"
                    onFocus={handleFocus}
                    placeholder="۰"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={formatWithCommas(editingProduct ? editingProduct.cogsPrice : newProduct.cogsPrice)}
                    onChange={(e) => {
                      const v = parseNumber(e.target.value);
                      if (editingProduct) setEditingProduct({...editingProduct, cogsPrice: v, purchaseCost: v});
                      else setNewProduct({...newProduct, cogsPrice: v, purchaseCost: v});
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="p-purchased-type" className="block text-[11px] font-bold text-slate-300 mb-1.5">نوع کالا (تسهیم حقوق مستقیم)</label>
                  <select
                    id="p-purchased-type"
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer"
                    value={(() => {
                      const curr = editingProduct ? editingProduct.isPurchased : newProduct.isPurchased;
                      if (curr === true) return 'purchased';
                      if (curr === false) return 'produced';
                      return 'inherit';
                    })()}
                    onChange={(e) => {
                      const val = e.target.value;
                      const nextIsPurchased = val === 'purchased' ? true : (val === 'produced' ? false : undefined);
                      if (editingProduct) setEditingProduct({ ...editingProduct, isPurchased: nextIsPurchased });
                      else setNewProduct({ ...newProduct, isPurchased: nextIsPurchased });
                    }}
                  >
                    <option value="inherit">تبعیت از گروه کالا (پیش‌فرض)</option>
                    <option value="produced">تولیدی کارگاه (مشمول حقوق مستقیم)</option>
                    <option value="purchased">خریداری / بازرگانی (بدون حقوق مستقیم)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Barcode Definition Section (Variable Dibal Scale & Simple Fixed) */}
              <div className="bg-slate-950/70 border border-slate-800/80 p-4 rounded-xl space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <BarcodeIcon className="h-4 w-4 text-indigo-400" />
                    نوع و ساختار بارکد محصول
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const bType = 'simple';
                        if (editingProduct) setEditingProduct({ ...editingProduct, barcodeType: bType });
                        else setNewProduct({ ...newProduct, barcodeType: bType });
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                        (editingProduct ? (editingProduct.barcodeType || 'simple') : (newProduct.barcodeType || 'simple')) === 'simple'
                          ? 'bg-indigo-600/25 text-indigo-300 border-indigo-500/50 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-850 hover:text-slate-200'
                      }`}
                    >
                      <BarcodeIcon className="h-3.5 w-3.5" />
                      بارکد ساده (ثابت)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const bType = (editingProduct ? editingProduct.unit : newProduct.unit) === 'کیلو' ? 'weighted_composite' : 'count_composite';
                        if (editingProduct) setEditingProduct({ ...editingProduct, barcodeType: bType });
                        else setNewProduct({ ...newProduct, barcodeType: bType });
                      }}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                        (editingProduct ? editingProduct.barcodeType : newProduct.barcodeType) === 'weighted_composite' || 
                        (editingProduct ? editingProduct.barcodeType : newProduct.barcodeType) === 'count_composite'
                          ? 'bg-rose-600/25 text-rose-300 border-rose-500/50 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-850 hover:text-slate-200'
                      }`}
                    >
                      <Scale className="h-3.5 w-3.5" />
                      بارکد متغیر (ترازو دیبال)
                    </button>
                  </div>
                </div>

                {(editingProduct ? editingProduct.barcodeType : newProduct.barcodeType) === 'weighted_composite' || 
                 (editingProduct ? editingProduct.barcodeType : newProduct.barcodeType) === 'count_composite' ? (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-1 animate-fadeIn">
                    <div className="md:col-span-4">
                      <label htmlFor="p-var-type" className="block text-[10px] font-bold text-slate-400 mb-1">نوع داده متغیر</label>
                      <select
                        id="p-var-type"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer"
                        value={(editingProduct ? editingProduct.barcodeType : newProduct.barcodeType) || 'weighted_composite'}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          if (editingProduct) setEditingProduct({ ...editingProduct, barcodeType: val });
                          else setNewProduct({ ...newProduct, barcodeType: val });
                        }}
                      >
                        <option value="weighted_composite">وزنی (استخراج وزن خالص به گرم)</option>
                        <option value="count_composite">تعدادی (استخراج شمارش اقلام)</option>
                      </select>
                    </div>

                    <div className="md:col-span-3">
                      <label htmlFor="p-item-identifier" className="block text-[10px] font-bold text-slate-400 mb-1">کد کالا در بارکد ترازو (۵ رقم)</label>
                      <input
                        id="p-item-identifier"
                        type="text"
                        maxLength={5}
                        placeholder="مثال: 00123"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-rose-400 text-xs font-mono font-bold focus:outline-none focus:border-rose-500"
                        value={editingProduct ? (editingProduct.itemIdentifierCode || '') : (newProduct.itemIdentifierCode || '')}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          if (editingProduct) setEditingProduct({ ...editingProduct, itemIdentifierCode: val });
                          else setNewProduct({ ...newProduct, itemIdentifierCode: val });
                        }}
                      />
                    </div>

                    <div className="md:col-span-5">
                      <label className="block text-[10px] font-bold text-slate-400 mb-1">الگوی تفکیک استاندارد EAN-13 ترازو</label>
                      <div className="p-2 bg-rose-950/20 border border-rose-500/20 rounded-lg text-[10.5px] text-slate-300 leading-relaxed font-mono text-center">
                        الگو: <span className="text-rose-400 font-bold">20</span> + <span className="text-amber-400 font-bold">{(editingProduct ? editingProduct.itemIdentifierCode : newProduct.itemIdentifierCode) || '00123'}</span> + <span className="text-emerald-400 font-bold">WWWWW</span> + <span className="text-indigo-400 font-bold">C</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="p-barcode" className="block text-[10px] font-bold text-slate-400 mb-1">بارکد تجاری / ملی (۱۳ رقمی یا بارکدخوان)</label>
                    <input
                      id="p-barcode"
                      type="text"
                      placeholder="بارکد کالا را وارد کرده یا توسط بارکدخوان اسکن کنید..."
                      className="w-full px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      value={editingProduct ? editingProduct.barcode : newProduct.barcode}
                      onChange={(e) => editingProduct ? setEditingProduct({...editingProduct, barcode: e.target.value}) : setNewProduct({...newProduct, barcode: e.target.value})}
                    />
                  </div>
                )}
              </div>

              {/* Row 4: Submit and Action Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-grow sm:flex-grow-0 sm:min-w-[220px] px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/20 cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {editingProduct ? 'ثبت و همسانی شناسنامه محصول' : 'افزودن محصول به کاتالوگ'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProduct(null);
                    setIsProductFormOpen(false);
                  }}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  انصراف و بازگشت
                </button>
              </div>
            </form>
          </div>
          )}

          {!isProductFormOpen && (
          <>
          {/* 3. COPY / SEED CATALOG BANNER (IF EMPTY) */}
          {products.length === 0 && periodsWithProducts.length > 0 && (
            <div className="bg-gradient-to-r from-rose-950/20 to-slate-900 border border-rose-500/20 p-5 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                  <Sparkles className="h-6 w-6 animate-pulse" />
                </div>
                <div className="text-right">
                  <h4 className="text-xs font-black text-slate-100">بخش محصولات نهایی در این دوره خالی است!</h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    شما می‌توانید با یک کلیک، تمام کاتالوگ محصولات، دسته‌بندی‌ها، فرمول‌ها و مواد اولیه را از دوره‌های دیگر کپی کنید.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 w-full md:w-auto justify-end">
                {periodsWithProducts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleCloneCatalogFromPeriod(p.id)}
                    className="px-3.5 py-2 bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 hover:border-rose-500 rounded-xl text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    کپی از {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Feedback Banner for Bulk Edits */}
          {bulkEditFeedback && (
            <div className="bg-emerald-950/40 border border-emerald-500/35 text-emerald-300 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{bulkEditFeedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setBulkEditFeedback('')}
                className="text-emerald-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Bulk Edit Panel when final products are selected */}
          {selectedProductIds.length > 0 && (
            <div className="bg-sky-950/30 border border-sky-500/40 p-4 rounded-2xl shadow-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/20 pb-2.5">
                <div className="flex items-center gap-2 text-sky-300 text-xs font-black">
                  <CheckSquare className="h-4 w-4 text-sky-400" />
                  <span>ویرایش دسته‌ای کالاهای انتخاب‌شده ({toPersianDigits(selectedProductIds.length)} محصول نهایی)</span>
                </div>
                <div className="flex items-center gap-2">
                  {filteredProducts.some(p => !selectedProductIds.includes(p.id)) && (
                    <button
                      type="button"
                      onClick={() => setSelectedProductIds(filteredProducts.map(p => p.id))}
                      className="text-[11px] font-bold text-sky-300 hover:text-white bg-sky-900/40 hover:bg-sky-800/60 border border-sky-500/30 px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                    >
                      انتخاب همه نتایج فیلترشده ({toPersianDigits(filteredProducts.length)})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedProductIds([])}
                    className="text-[11px] font-bold text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-700 px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                  >
                    لغو انتخاب
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">تغییر گروه کالاهای انتخابی</label>
                  <select
                    value={bulkEditCategoryId}
                    onChange={(e) => setBulkEditCategoryId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-sky-500 cursor-pointer font-bold"
                  >
                    <option value="__keep__">-- بدون تغییر گروه کالا --</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">تغییر واحد فروش کالاهای انتخابی</label>
                  <select
                    value={bulkEditUnit}
                    onChange={(e) => setBulkEditUnit(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-sky-500 cursor-pointer font-bold"
                  >
                    <option value="__keep__">-- بدون تغییر واحد فروش --</option>
                    <option value="عدد">عدد (واحدی)</option>
                    <option value="کیلو">کیلوگرم</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">تغییر نوع بسته‌بندی کالاهای انتخابی</label>
                  <select
                    value={bulkEditPackageType}
                    onChange={(e) => setBulkEditPackageType(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-sky-500 cursor-pointer font-bold"
                  >
                    <option value="__keep__">-- بدون تغییر نوع بسته‌بندی --</option>
                    {packagingTypesList.map(pt => (
                      <option key={pt.id} value={pt.name}>{pt.name}</option>
                    ))}
                    {!packagingTypesList.some(pt => pt.name === 'سلفون') && <option value="سلفون">سلفون</option>}
                    {!packagingTypesList.some(pt => pt.name === 'شیرینک') && <option value="شیرینک">شیرینک</option>}
                    {!packagingTypesList.some(pt => pt.name === 'جعبه') && <option value="جعبه">جعبه</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-300 mb-1">نوع کالا (تولیدی / خریداری)</label>
                  <select
                    value={bulkEditPurchasedType}
                    onChange={(e) => setBulkEditPurchasedType(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 text-zinc-100 text-xs px-3 py-2 rounded-xl focus:outline-none focus:border-sky-500 cursor-pointer font-bold"
                  >
                    <option value="__keep__">-- بدون تغییر نوع کالا --</option>
                    <option value="produced">تولیدی کارگاه</option>
                    <option value="purchased">خریداری / بازرگانی</option>
                    <option value="inherit">تبعیت از دسته‌بندی</option>
                  </select>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={handleApplyBulkEditProducts}
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold py-2.5 px-4 rounded-xl shadow-lg shadow-sky-600/20 flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                  >
                    <Save className="h-4 w-4" />
                    <span>اعمال تغییرات دسته‌ای</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. PRODUCTS TABLE (FULL WIDTH UNDER THE DEFINITION FORM) */}
          <div id="sales-products-printable" className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950/70 backdrop-blur-md shadow-xl">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 text-center" style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      className="rounded border-slate-800 text-rose-600 focus:ring-rose-500/25 h-3.5 w-3.5 bg-slate-950 cursor-pointer"
                      checked={filteredProducts.length > 0 && filteredProducts.every(p => selectedProductIds.includes(p.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProductIds(prev => {
                            const newIds = [...prev];
                            filteredProducts.forEach(p => {
                              if (!newIds.includes(p.id)) newIds.push(p.id);
                            });
                            return newIds;
                          });
                        } else {
                          const filteredIds = filteredProducts.map(p => p.id);
                          setSelectedProductIds(prev => prev.filter(id => !filteredIds.includes(id)));
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-3.5 font-bold tracking-wider">کد محصول</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider">کد حسابداری</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider">نام دقیق محصول</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider">نوع و ساختار بارکد</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider">بسته‌بندی</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider text-center">وزن واحد (گرم)</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider text-left">قیمت فروش</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider text-left">قیمت تمام شده</th>
                  <th className="px-4 py-3.5 font-bold tracking-wider text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                      <AlertTriangle className="h-8 w-8 mx-auto text-slate-600 mb-2.5 opacity-40" />
                      هیچ ردیف محصولی منطبق یافت نشد. از فرم بالا محصول جدیدی به کاتالوگ بیافزایید.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map(p => (
                    <tr key={p.id} className={`hover:bg-slate-800/30 transition-colors ${selectedProductIds.includes(p.id) ? 'bg-sky-950/20' : ''}`}>
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          className="rounded border-slate-800 text-rose-600 focus:ring-rose-500/25 h-3.5 w-3.5 bg-slate-950 cursor-pointer"
                          checked={selectedProductIds.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedProductIds(prev => [...prev, p.id]);
                            } else {
                              setSelectedProductIds(prev => prev.filter(id => id !== p.id));
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-4 font-black font-mono text-rose-400">{p.code}</td>
                      <td className="px-4 py-4 font-mono text-slate-400">{p.accountId || '-'}</td>
                      <td className="px-4 py-4 font-bold text-slate-100">
                        <div>{p.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className={`text-[10px] border px-2 py-0.5 rounded font-normal inline-block ${
                            catMap[p.categoryId]
                              ? 'bg-slate-950 border-slate-800 text-slate-400'
                              : (p.categoryId === 'cat-4' || /-cat-4$/.test(p.categoryId || ''))
                                ? 'bg-slate-950 border-slate-800 text-slate-400'
                                : 'bg-amber-950/30 border-amber-500/30 text-amber-400'
                          }`}>
                            {catMap[p.categoryId] || ((p.categoryId === 'cat-4' || /-cat-4$/.test(p.categoryId || '')) ? 'مشترک' : 'بدون گروه (نیاز به انتخاب)')}
                          </span>
                          {(() => {
                            const catObj = categories.find(c => c.id === p.categoryId);
                            const effPurchased = p.isPurchased !== undefined ? Boolean(p.isPurchased) : Boolean(catObj?.isPurchased);
                            return effPurchased ? (
                              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">
                                خریداری
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-mono">
                        {p.barcodeType === 'weighted_composite' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-950/40 border border-rose-900/50 px-2 py-0.5 rounded-md w-fit">
                              <Scale className="h-3 w-3" />
                              وزنی (دیبال)
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold">کد: {p.itemIdentifierCode || p.code}</span>
                          </div>
                        ) : p.barcodeType === 'count_composite' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/40 border border-amber-900/50 px-2 py-0.5 rounded-md w-fit">
                              <BarcodeIcon className="h-3 w-3" />
                              تعدادی (دیبال)
                            </span>
                            <span className="text-[10px] text-slate-400 font-bold">کد: {p.itemIdentifierCode || p.code}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md w-fit font-bold">
                              ساده (ثابت)
                            </span>
                            <span className="text-[10px] text-slate-500 truncate max-w-[110px]" title={p.barcode}>{p.barcode || '-'}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-400">{p.unit} ({p.packageType})</td>
                      <td className="px-4 py-4 text-center font-mono text-slate-300">{p.weight !== undefined ? toPersianDigits(p.weight) : '۰'}</td>
                      <td className="px-4 py-4 text-left font-mono font-black text-emerald-400">{formatWithCommas(p.salePrice)}</td>
                      <td className="px-4 py-4 text-left font-mono font-bold text-rose-400">{formatWithCommas(p.cogsPrice || 0)}</td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex justify-center gap-1.5">
                          <button
                            onClick={() => { setEditingProduct(p); setIsProductFormOpen(true); }}
                            className="text-xs text-slate-200 border border-slate-800 bg-slate-900 hover:bg-slate-800 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                          >
                            ویرایش
                          </button>
                          <button
                            onClick={() => deleteProduct(p.id)}
                            className="text-xs text-rose-400 hover:text-rose-300 border border-rose-500/20 bg-rose-950/20 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                          >
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </>
          )}
        </div>
      )}

      {/* ================= TAB 2: DEPARTMENTS & PRODUCT CATEGORIES ================= */}
      {activeTab === 'categories' && (
        <div className="space-y-6 animate-fade-in">
          {unassignedCategories.length > 0 && (
            <div className="bg-amber-950/35 border border-amber-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-right">
                  <div className="text-xs font-black text-amber-300">
                    هشدار تخصیص دپارتمان: {toPersianDigits(unassignedCategories.length)} دسته‌بندی محصول هنوز به هیچ دپارتمان تولیدی تخصیص نیافته است
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    فروش و کالاهای این دسته‌ها تا زمان تعیین دپارتمان در گزارش‌های داشبورد با عنوان «تخصیص‌نیافته» نمایش داده می‌شوند و سهم حقوق مستقیم دپارتمان آن‌ها در قیمت تمام‌شده صفر لحاظ می‌گردد:
                    {' '}
                    <span className="font-bold text-white">{unassignedCategories.map(c => c.name).join('، ')}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCatAllocFilter(catAllocFilter === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED')}
                className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-all"
              >
                {catAllocFilter === 'UNASSIGNED' ? 'نمایش همه دسته‌ها' : 'فیلتر تخصیص‌نیافته‌ها'}
              </button>
            </div>
          )}

          {/* Section 1: Independent Production Departments Management */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-xs font-black text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-400" />
                  مدیریت دپارتمان‌های تولیدی مستقل (مبنای حقوق پرسنل، قیمت تمام‌شده و داشبورد فروش)
                </h3>
                <p className="text-[10.5px] text-slate-400">
                  لیست دپارتمان‌ها از دسته‌بندی‌های اکسل مجزا است؛ هر دسته‌بندی اکسل یا محصول می‌تواند به یکی از دپارتمان‌های این فهرست متصل شود
                </p>
              </div>
              <form onSubmit={handleAddDept} className="flex items-center gap-2 w-full md:w-auto">
                <input
                  type="text"
                  placeholder="نام دپارتمان جدید (مثلاً: شیرینی خشک)..."
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 min-w-[210px] flex-1"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-all"
                >
                  + افزودن دپارتمان
                </button>
              </form>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {departments.length === 0 ? (
                <div className="text-xs text-slate-500 py-2">هنوز دپارتمانی در این دوره تعریف نشده است.</div>
              ) : (
                departments.map(dept => (
                  <div key={dept.id} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs">
                    {editingDeptId === dept.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveDeptEdit(dept.id);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={deptNameInput}
                          onChange={(e) => setDeptNameInput(e.target.value)}
                          className="px-2 py-1 bg-slate-950 border border-indigo-500 rounded-lg text-xs text-white w-32 focus:outline-none"
                        />
                        <button type="submit" className="text-emerald-400 hover:text-emerald-300 font-bold px-1.5 cursor-pointer">ثبت</button>
                        <button type="button" onClick={() => setEditingDeptId(null)} className="text-slate-400 hover:text-slate-200 px-1 cursor-pointer">لغو</button>
                      </form>
                    ) : (
                      <>
                        <span className="font-black text-slate-100">{dept.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({toPersianDigits(categories.filter(c => c.departmentId === dept.id).length)} دسته)
                        </span>
                        <button
                          type="button"
                          onClick={() => { setEditingDeptId(dept.id); setDeptNameInput(dept.name); }}
                          className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                          title="ویرایش دپارتمان"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDept(dept.id)}
                          className="text-rose-400 hover:text-rose-300 p-0.5 cursor-pointer"
                          title="حذف دپارتمان"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 2: Product Categories & Allocation to Departments */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-zinc-100 border-b border-zinc-800 pb-3 flex items-center gap-1.5">
                <Plus className="h-4.5 w-4.5 text-rose-500" />
                افزودن دسته‌بندی محصول
              </h3>
              <form onSubmit={handleAddPCat} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-zinc-400">عنوان دسته‌بندی محصول / گروه اکسل</label>
                  <input
                    id="new-pcat-name"
                    type="text"
                    required
                    placeholder="مثال: گروه کیک و بیسکوئیت"
                    className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 placeholder-zinc-650"
                    value={newPcatName}
                    onChange={(e) => setNewPcatName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-zinc-400">تخصیص به دپارتمان تولیدی (اختیاری)</label>
                  <select
                    value={newPcatDeptId}
                    onChange={(e) => setNewPcatDeptId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="">-- تخصیص‌نیافته (تعیین بعدی) --</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-sky-950/20 border border-sky-500/20 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newPcatIsPurchased}
                    onChange={(e) => setNewPcatIsPurchased(e.target.checked)}
                    className="rounded border-sky-500/40 bg-zinc-950 text-sky-500 focus:ring-0 w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[11px] font-bold text-sky-300">
                    گروه کالای خریداری / بازرگانی (بدون تسهیم حقوق مستقیم)
                  </span>
                </label>
                <button
                  type="submit"
                  className="w-full px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/15 cursor-pointer transition-all"
                >
                  ثبت دسته‌بندی محصول در دوره
                </button>
              </form>
            </div>

            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-col gap-4 bg-zinc-900/40 border border-zinc-800 p-4 rounded-2xl shadow-lg backdrop-blur-md">
                {/* Filter Tabs + Full-width Search Input row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCatAllocFilter('ALL')}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-all ${
                        catAllocFilter === 'ALL' ? 'bg-rose-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      همه ({toPersianDigits(categories.length)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatAllocFilter('UNASSIGNED')}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-all ${
                        catAllocFilter === 'UNASSIGNED'
                          ? 'bg-amber-600 text-white'
                          : unassignedCategories.length > 0
                            ? 'bg-amber-950/40 text-amber-300 border border-amber-500/40'
                            : 'bg-zinc-950 text-zinc-400 border border-zinc-800'
                      }`}
                    >
                      تخصیص‌نیافته ({toPersianDigits(unassignedCategories.length)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatAllocFilter('ASSIGNED')}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-all ${
                        catAllocFilter === 'ASSIGNED' ? 'bg-emerald-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                      }`}
                    >
                      تخصیص‌یافته ({toPersianDigits(categories.length - unassignedCategories.length)})
                    </button>
                  </div>
                </div>

                <UnifiedToolbar
                  searchValue={prodCatSearch}
                  onSearchChange={setProdCatSearch}
                  searchPlaceholder="جستجو در دسته‌بندی‌ها یا نام دپارتمان..."
                  onDownloadTemplate={downloadSampleProductCategoriesCSV}
                  onImportExcel={importPCatCSV}
                  importAccept=".csv,.xlsx,.xls"
                  onExportExcel={exportPCatCSV}
                  onPrint={() => printElement('sales-categories-printable', 'فهرست دسته‌بندی محصولات و دپارتمان‌ها')}
                  extraSecondaryActions={
                    <ErpButton
                      variant="danger"
                      size="sm"
                      onClick={clearAllProductCategories}
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                    >
                      حذف کلی دسته‌ها
                    </ErpButton>
                  }
                />
              </div>

              <div id="sales-categories-printable" className="border border-slate-800 rounded-2xl overflow-x-auto bg-slate-950/70 backdrop-blur-md">
                <table className="min-w-full text-right text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 font-bold tracking-wider">عنوان دسته‌بندی محصول</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider w-[30%]">دپارتمان تولیدی تخصیص‌یافته</th>
                      <th className="px-4 py-3.5 text-center font-bold tracking-wider w-[18%]">نوع گروه کالا</th>
                      <th className="px-4 py-3.5 text-center font-bold tracking-wider w-[18%]">عملیات مدیریت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/50 text-zinc-350">
                    {searchedPCats.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-zinc-500 text-xs">
                          دسته‌بندی مطابق با فیلتر انتخابی یافت نشد.
                        </td>
                      </tr>
                    ) : searchedPCats.map(c => {
                      const hasValidDept = Boolean(c.departmentId && deptMap[c.departmentId]);
                      return (
                        <tr key={c.id} className="hover:bg-zinc-900/10 transition-all">
                          <td className="px-4 py-4 font-bold text-zinc-200" style={{ color: '#fafafa' }}>
                            {editingPcatId === c.id ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  savePCatEdit(c.id);
                                }}
                                className="flex flex-wrap gap-2 items-center text-zinc-101"
                              >
                                <input
                                  id={`pcat-edit-inp-${c.id}`}
                                  className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-101 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                                  value={pcatNameInput}
                                  onChange={(e) => setPcatNameInput(e.target.value)}
                                />
                                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 px-4 rounded-xl text-xs font-bold cursor-pointer shadow-md transition-all">ثبت</button>
                                <button type="button" onClick={() => setEditingPcatId(null)} className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border border-zinc-700 rounded-xl text-xs transition-colors cursor-pointer">لغو</button>
                              </form>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>{c.name}</span>
                                {!hasValidDept && !c.isPurchased && (
                                  <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/35 font-bold">
                                    تخصیص‌نیافته
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={editingPcatId === c.id ? pcatDeptIdInput : (hasValidDept ? c.departmentId! : '')}
                              onChange={(e) => {
                                if (editingPcatId === c.id) {
                                  setPcatDeptIdInput(e.target.value);
                                } else {
                                  handleAssignCategoryDepartment(c.id, e.target.value);
                                }
                              }}
                              className={`w-full px-3 py-2 rounded-xl text-xs font-bold cursor-pointer focus:outline-none border transition-colors ${
                                hasValidDept
                                  ? 'bg-slate-900 border-slate-700 text-emerald-300 focus:border-indigo-500'
                                  : 'bg-amber-950/35 border-amber-500/50 text-amber-200 focus:border-amber-400'
                              }`}
                            >
                              <option value="">-- بدون دپارتمان (تخصیص‌نیافته) --</option>
                              {departments.map(d => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleCategoryPurchased(c.id)}
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border cursor-pointer transition-all ${
                                c.isPurchased
                                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/35 hover:bg-sky-500/25'
                                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20'
                              }`}
                              title="کلیک جهت تغییر وضعیت کل کالاهای این دسته‌بندی بین تولیدی و خریداری"
                            >
                              {c.isPurchased ? 'خریداری (بازرگانی)' : 'تولیدی کارگاه'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPcatId(c.id);
                                  setPcatNameInput(c.name);
                                  setPcatDeptIdInput(c.departmentId || '');
                                }} 
                                className="text-xs text-zinc-200 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                              >
                                ویرایش
                              </button>
                              <button 
                                type="button"
                                onClick={() => deletePCat(c.id)}
                                className="text-xs text-rose-455 hover:text-rose-400 border border-rose-955/25 bg-rose-955/15 p-1 px-2.5 rounded-lg transition-all cursor-pointer"
                              >
                                حذف
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
        </div>
      )}

      {/* ================= TAB 3: PACKAGING TYPES ================= */}
      {activeTab === 'packaging' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Form Side */}
            <div className="bg-zinc-900/40 border border-zinc-800 backdrop-blur-md p-6 rounded-2xl h-fit space-y-4 shadow-xl">
              <h3 className="text-xs font-black text-zinc-100 border-b border-zinc-800 pb-3 flex items-center gap-1.5">
                <Package className="h-4.5 w-4.5 text-rose-500" />
                {editingPkgType ? 'ویرایش نوع بسته‌بندی' : 'تعریف نوع بسته‌بندی جدید'}
              </h3>

              <form onSubmit={handleAddOrUpdatePkgType} className="space-y-4">
                <div>
                  <label htmlFor="pkg-name-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">عنوان نوع بسته‌بندی (الزامی)</label>
                  <input
                    id="pkg-name-input"
                    type="text"
                    required
                    placeholder="مثال: سلفون، شیرینک، جعبه کادویی"
                    className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 placeholder-zinc-650"
                    value={editingPkgType ? editingPkgType.name : newPkgType.name}
                    onChange={(e) => editingPkgType ? setEditingPkgType({ ...editingPkgType, name: e.target.value }) : setNewPkgType({ ...newPkgType, name: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="pkg-desc-input" className="block text-[11px] font-bold text-zinc-400 mb-1.5">توضیحات و خصوصیات فنی</label>
                  <textarea
                    id="pkg-desc-input"
                    rows={3}
                    placeholder="توضیحات درباره جنس، ابعاد یا مشخصات ظاهری بسته‌بندی..."
                    className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-100 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 placeholder-zinc-650"
                    value={editingPkgType ? (editingPkgType.description || '') : newPkgType.description}
                    onChange={(e) => editingPkgType ? setEditingPkgType({ ...editingPkgType, description: e.target.value }) : setNewPkgType({ ...newPkgType, description: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-600/15 cursor-pointer transition-all flex items-center justify-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {editingPkgType ? 'ثبت تغییرات' : 'ثبت نوع بسته‌بندی'}
                  </button>
                  {editingPkgType && (
                    <button
                      type="button"
                      onClick={() => setEditingPkgType(null)}
                      className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>

              <div className="pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleResetDefaultPkgTypes}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> بازنشانی به انواع بسته‌بندی پیش‌فرض
                </button>
              </div>
            </div>

            {/* Table Side */}
            <div className="md:col-span-2 space-y-4">
              <UnifiedToolbar
                searchValue={pkgSearch}
                onSearchChange={setPkgSearch}
                searchPlaceholder="جستجو در انواع بسته‌بندی..."
                onDownloadTemplate={downloadSamplePackagingExcel}
                onImportExcel={importPackagingFile}
                importAccept=".xlsx,.xls,.csv"
                onExportExcel={exportPackagingExcel}
                onPrint={() => printElement('sales-packaging-printable', 'فهرست انواع بسته‌بندی محصولات')}
              />

              <div id="sales-packaging-printable" className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950/70 backdrop-blur-md">
                <table className="min-w-full divide-y divide-slate-800 text-right">
                  <thead className="bg-slate-900/90 text-slate-400 text-xs">
                    <tr>
                      <th className="px-4 py-3.5 font-bold tracking-wider">عنوان نوع بسته‌بندی</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider">توضیحات و مشخصات</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider text-center">محصولات متصل</th>
                      <th className="px-4 py-3.5 font-bold tracking-wider text-center">عملیات مدیریت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/50 text-xs text-zinc-300">
                    {searchedPkgTypes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-zinc-500">
                          هیچ نوع بسته‌بندی تعریف نشده است.
                        </td>
                      </tr>
                    ) : (
                      searchedPkgTypes.map(pt => {
                        const linkedProdsCount = db.products.filter(p => p.packageType === pt.name).length;
                        return (
                          <tr key={pt.id} className="hover:bg-zinc-900/10 transition-colors">
                            <td className="px-4 py-4 font-bold text-white flex items-center gap-2">
                              <Box className="h-4 w-4 text-rose-500" />
                              {pt.name}
                            </td>
                            <td className="px-4 py-4 text-zinc-400 max-w-xs truncate">
                              {pt.description || '-'}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px] px-2.5 py-1 rounded-full font-bold">
                                {toPersianDigits(linkedProdsCount)} محصول
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <div className="flex justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingPkgType(pt)}
                                  className="text-xs text-zinc-200 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 p-1 px-3 rounded-lg transition-all cursor-pointer"
                                >
                                  ویرایش
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePkgType(pt.id)}
                                  className="text-xs text-rose-455 hover:text-rose-400 border border-rose-955/25 bg-rose-955/15 p-1 px-3 rounded-lg transition-all cursor-pointer"
                                >
                                  حذف
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
        </div>
      )}

      {/* ================= TAB 4: BARCODE MANAGEMENT ================= */}
      {activeTab === 'barcodes' && (
        <BarcodeManagement db={db} onUpdateDb={onUpdateDb} activePeriodId={activePeriodId} />
      )}

      {/* ================= TAB 5: MONTHLY REGISTRATION ================= */}
      {activeTab === 'records' && (
        <div className="space-y-6">
          {/* Redesigned Active Invoices & Product Sales Registry */}
          <div className="space-y-6">
            <div className="space-y-5">
              <div className="bg-slate-950 border border-slate-850 rounded-3xl p-6 shadow-xl space-y-5 text-slate-100">
                <UnifiedToolbar
                  searchValue={salesSearchText}
                  onSearchChange={setSalesSearchText}
                  searchPlaceholder="جستجو در فاکتورهای فروش (کد یا نام کالا)..."
                  onDownloadTemplate={downloadSamplePeriodicSalesCSV}
                  onImportExcel={importPeriodicSalesCSV}
                  importAccept=".csv,.xlsx,.xls"
                  onExportExcel={exportMonthlySalesExcel}
                  onPrint={() => printElement('sales-records-printable', `فروش ماهانه ${PERSIAN_MONTHS[selectedSalesMonth - 1]} ${toPersianDigits(selectedSalesYear)}`)}
                  extraSecondaryActions={
                    <>
                      <ErpButton
                        variant={showAdvancedImport ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setShowAdvancedImport(!showAdvancedImport)}
                        icon={<Sparkles className="h-3.5 w-3.5" />}
                      >
                        {showAdvancedImport ? 'پنهان‌سازی فرم پیشرفته' : 'اکسل پیشرفته دوگانه'}
                      </ErpButton>
                      <ErpButton
                        variant="danger"
                        size="sm"
                        onClick={clearAllSales}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      >
                        پاکسازی کل فروش
                      </ErpButton>
                    </>
                  }
                />

                {/* Advanced Dual-Excel Import Panel */}
                {showAdvancedImport && (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 animate-fadeIn">
                    <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                      <Sparkles className="h-5 w-5 text-indigo-400 animate-bounce" />
                      <span className="text-sm font-black text-white">سامانه یکپارچه‌ساز پیشرفته تراکنش‌های فاکتوری (تطبیق فاکتور و زمان فروش)</span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                      این پنل به شما امکان می‌دهد اطلاعات ریز اقلام تراکنش‌های فروش خود را با زمان ثبت فاکتور تطبیق دهید. پس از آپلود هر دو فایل، سیستم شماره فاکتور فیلد به فیلد را مقایسه کرده، زمان فروش را استخراج می‌نماید و سرجمع فروش را با دیتابیس مالی دوره همگام می‌کند تا کلیه گزارشات داشبورد رفتار مصرف‌کننده زمان‌بندی و پایش فروش (EXECUTIVE SALES INTELLIGENCE) بر مبنای این ریز تراکنش‌های واقعی کار کند.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Input 1 */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
                        <div>
                          <span className="text-xs font-bold text-white block mb-1">فایل اول: ریز تراکنش‌های فروش کالا</span>
                          <span className="text-[10px] text-indigo-400/85 block mb-3 leading-relaxed">شامل ستون‌های: شماره فاكتور، نام مشتري، كد كالا، تاريخ، نام كالا، گروه كالا، تعداد فروش، فی، تخفیف، مبلغ فروش</span>
                        </div>
                        <div className="relative border border-dashed border-slate-800 hover:border-indigo-600 rounded-lg p-4 text-center group cursor-pointer transition-colors bg-slate-900/20">
                          <input
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={(e) => {
                              if (e.target.files) setDetailFile(e.target.files[0]);
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <Upload className="h-6 w-6 text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span className="text-xs font-medium text-slate-300">
                              {detailFile ? `${detailFile.name} (${(detailFile.size / 1024).toFixed(1)} KB)` : 'انتخاب یا رها کردن اکسل ریز تراکنش'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Input 2 */}
                      <div className="bg-slate-950 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
                        <div>
                          <span className="text-xs font-bold text-white block mb-1">فایل دوم: خلاصه فاکتورها و زمان فروش</span>
                          <span className="text-[10px] text-indigo-400/85 block mb-3 leading-relaxed">شامل ستون‌های: شماره فاکتور، تاريخ، کد مشتری، نام مشتري، سرجمع فروش، زمان فروش</span>
                        </div>
                        <div className="relative border border-dashed border-slate-800 hover:border-indigo-600 rounded-lg p-4 text-center group cursor-pointer transition-colors bg-slate-900/20">
                          <input
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={(e) => {
                              if (e.target.files) setSummaryFile(e.target.files[0]);
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          />
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <Upload className="h-6 w-6 text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span className="text-xs font-medium text-slate-300">
                              {summaryFile ? `${summaryFile.name} (${(summaryFile.size / 1024).toFixed(1)} KB)` : 'انتخاب یا رها کردن اکسل فاکتور و زمان'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-850 pt-2.5">
                      <div className="text-[11px]">
                        {advancedImportStatus.message && (
                          <div className={`p-1.5 rounded-lg flex items-center gap-2 ${
                            advancedImportStatus.type === 'success' ? 'text-emerald-450 bg-emerald-950/20' :
                            advancedImportStatus.type === 'error' ? 'text-rose-400 bg-rose-950/20' : 'text-indigo-400 bg-indigo-950/20'
                          }`}>
                            <Info className="h-4 w-4" />
                            <span>{advancedImportStatus.message}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleProcessAdvancedFiles}
                          disabled={!detailFile || !summaryFile}
                          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap lg:mr-2 font-sans"
                        >
                          تطبیق و محاسبه سرجمع تراکنش‌ها
                        </button>
                      </div>
                    </div>

                    {reconciliationResult && (
                      <div className="space-y-4 mt-4">
                        {unregisteredProductsToDefine && unregisteredProductsToDefine.length > 0 ? (
                          <div className="bg-slate-900 border border-indigo-500/35 rounded-2xl p-5 space-y-4 animate-fadeIn shadow-lg shadow-indigo-950/20">
                            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                              <Sparkles className="h-5 w-5 text-indigo-400 shrink-0" />
                              <span className="text-sm font-black text-white">تعریف و ثبت وزن محصولات جدید شناسایی شده ({toPersianDigits(unregisteredProductsToDefine.length)} کالا)</span>
                            </div>
                            <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                              برخی از محصولات لیست فروش جزئی در فایل اکسل، قبلاً در کاتالوگ محصولات ثبت نشده‌اند. طبق قوانین سیستم، کد محصول دقیقاً به عنوان کد حسابداری کالا استفاده می‌شود. لطفاً دسته‌بندی و وزن محصول به گرم را برای هر کدام از کالاها وارد نمایید تا تعریف شده و همگام‌سازی تکمیل شود:
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {unregisteredProductsToDefine.map((item, idx) => (
                                <div key={`${item.code}-${idx}`} className="bg-slate-950 border border-slate-850 rounded-xl p-4 space-y-3 relative overflow-hidden transition-all hover:border-slate-800">
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="space-y-1 text-right w-full">
                                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">نام و عنوان محصول (قابل ویرایش):</label>
                                      <input
                                        type="text"
                                        value={item.name}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setUnregisteredProductsToDefine(prev => {
                                            if (!prev) return prev;
                                            const copy = [...prev];
                                            copy[idx] = { ...copy[idx], name: val };
                                            return copy;
                                          });
                                        }}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-right font-sans text-white focus:border-indigo-500 font-bold mb-2 outline-none transition-all"
                                      />
                                      <span className="text-[10px] text-zinc-400 font-mono block">کد کالا (کد حسابداری): {toPersianDigits(item.code)}</span>
                                      {item.categoryName && (
                                        <span className="text-[9px] bg-slate-900 border border-slate-850 text-indigo-400 px-1.5 py-0.5 rounded inline-block font-sans mt-1">گروه اکسل: {item.categoryName}</span>
                                      )}
                                    </div>
                                    <span className="text-[9px] font-bold text-indigo-400 font-sans tracking-tight bg-indigo-950/45 px-2 py-0.5 rounded-full border border-indigo-900/40 whitespace-nowrap shrink-0">ناموجود</span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3 pt-1">
                                    <div className="text-right">
                                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">دسته‌بندی نهایی: <span className="text-rose-500">*</span></label>
                                      <select
                                        value={item.categoryId}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setUnregisteredProductsToDefine(prev => {
                                            if (!prev) return prev;
                                            const copy = [...prev];
                                            copy[idx] = { ...copy[idx], categoryId: val };
                                            return copy;
                                          });
                                        }}
                                        className={`w-full bg-slate-900 border rounded-lg p-2 text-xs text-white focus:border-indigo-500 font-sans cursor-pointer ${!item.categoryId ? 'border-amber-500/70' : 'border-slate-800'}`}
                                      >
                                        <option value="">-- انتخاب دسته‌بندی --</option>
                                        {item.categoryName && item.categoryName.trim() && !matchProductCategoryInList(item.categoryName, categories) && (
                                          <option value={`__CREATE__:${item.categoryName.trim()}`}>
                                            ✨ ایجاد و انتخاب گروه «{item.categoryName.trim()}» از اکسل
                                          </option>
                                        )}
                                        {categories.map(c => (
                                          <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="text-right">
                                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">وزن محصول (به گرم): <span className="text-rose-500">*</span></label>
                                      <input
                                        type="number"
                                        placeholder="مثال: ۲۰۰"
                                        value={item.weight}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setUnregisteredProductsToDefine(prev => {
                                            if (!prev) return prev;
                                            const copy = [...prev];
                                            copy[idx] = { ...copy[idx], weight: val };
                                            return copy;
                                          });
                                        }}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-left font-mono font-bold text-white focus:border-indigo-500"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex items-center justify-end gap-2 border-t border-slate-850 pt-3">
                              <button
                                type="button"
                                onClick={() => setUnregisteredProductsToDefine(null)}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
                              >
                                انصراف
                              </button>
                              <button
                                type="button"
                                onClick={handleFinalizeReconciliationWithNewProducts}
                                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-indigo-900/30 cursor-pointer font-sans flex items-center gap-1.5"
                              >
                                🎯 ثبت محصولات جدید و همگام‌سازی فروش
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-xl">
                            <div className="flex items-start gap-2.5">
                              <CheckCircle className="h-5 w-5 text-emerald-450 shrink-0 mt-0.5" />
                              <div className="text-right">
                                <span className="text-xs font-black text-emerald-400 block mb-1">نتایج بررسی و تطبیق تراکنش‌ها:</span>
                                <span className="text-[11px] text-slate-300 leading-relaxed block font-sans">داده‌های جزئی به میزان <strong className="text-white font-mono">{toPersianDigits(reconciliationResult.totalImportedLines)} ردیف</strong> پردازش شدند. از مجموع فایل خلاصه، تعداد <strong className="text-indigo-400 font-mono">{toPersianDigits(reconciliationResult.matchedInvoicesCount)} فاکتور</strong> تطبیق موفق داشتند. می‌توانید با کلیک بر روی دکمه روبرو، کل این ریزتراکنش‌ها همگام‌سازی و بازنویسی نمایید تا اطلاعات و قیمت محصولات به‌روزرسانی شود.</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleApplyReconciliation}
                              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 font-extrabold text-[11px] text-white rounded-xl cursor-pointer transition-colors whitespace-nowrap self-stretch sm:self-auto text-center font-sans"
                            >
                              🔄 همگام‌سازی و بروزرسانی فروش ماهانه
                            </button>
                          </div>
                        )}

                        {reconciliationResult.newProductsDetected && reconciliationResult.newProductsDetected.length > 0 && (
                          <div className="bg-slate-900/60 border border-indigo-500/25 p-4 rounded-xl space-y-3 text-slate-300 animate-fadeIn shadow-lg shadow-indigo-950/10">
                            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold mb-1 col-span-full">
                              <Sparkles className="h-4 w-4 text-indigo-450 shrink-0 animate-pulse" />
                              <span>کالاهای جدید شناسایی‌شده در فايل اکسل ریزتراکنش ({toPersianDigits(reconciliationResult.newProductsDetected.length)} محصول جدید)</span>
                            </div>
                            
                            <p className="text-[11.5px] text-zinc-350 leading-relaxed font-sans">
                              سیستم با تحلیل کد و نام اقلام درون فایل اکسل ریزتراکنش، کالاهای جدید زیر را استخراج نموده است. این کالاها پیش‌تر در کاتالوگ فعال شما تعریف نشده‌اند و نام و کد حسابداری آن‌ها مستقیماً از اکسل دریافت شده است تا در صورت تایید و اعمال همگام‌سازی، به کاتالوگ و گزارش‌ها افزوده شوند:
                            </p>

                            <div className="overflow-x-auto border border-slate-850 rounded-xl bg-slate-950/40">
                              <table className="min-w-full text-right text-[11px] font-sans">
                                <thead className="bg-slate-900/80 text-zinc-400 border-b border-slate-800">
                                  <tr>
                                    <th className="px-3 py-2 font-bold select-none text-right">کد محصول (کد حسابداری)</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">نام استخراج‌شده از اکسل</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">دسته کالا متناظر</th>
                                    <th className="px-3 py-2 font-bold select-none text-left">فی فروش فرضی (ریال)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-900/30 text-zinc-300">
                                  {reconciliationResult.newProductsDetected.map((p, idx) => (
                                    <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                                      <td className="px-3 py-2.5 font-bold font-mono text-indigo-450">{toPersianDigits(p.code)}</td>
                                      <td className="px-3 py-2.5 font-bold text-zinc-100">{p.name}</td>
                                      <td className="px-3 py-2.5 text-zinc-400">{p.categoryName || 'عمومی'}</td>
                                      <td className="px-3 py-2.5 text-left font-mono font-bold text-emerald-450">{formatWithCommas(p.salePrice)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {reconciliationResult.unmatchedDetailedInvoices.length > 0 && (
                          <div className="bg-slate-900/60 border border-slate-805 p-4 rounded-xl space-y-4 text-slate-300">
                            <div className="flex items-center gap-2 text-rose-400 text-xs font-bold mb-1 col-span-full">
                              <AlertTriangle className="h-4 w-4 animate-pulse text-rose-450" />
                              <span>جزئیات فاکتورها و کالاهای فاقد زمان فروش ({toPersianDigits(reconciliationResult.unmatchedDetailedInvoices.length)} فاکتور با عدم امکان تطبیق زمان)</span>
                            </div>
                            
                            <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                              کالاهای درج‌شده در فاکتورهای زیر به دلیل عدم دسترسی به شماره فاکتور متناظر در فایل خلاصه فاکتورها، فاقد ثبت زمان دقیق خرد فروش (ساعت معین) می‌باشند:
                            </p>

                            <div className="bg-slate-950 border border-slate-850 p-3 rounded-lg text-[10px] text-slate-400">
                              <span className="font-semibold text-white block mb-1.5 font-sans">لیست شماره فاکتورهای بدون اطلاعات خلاصه/زمان:</span>
                              <div className="font-mono text-zinc-300 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                                {reconciliationResult.unmatchedDetailedInvoices.map(f => (
                                  <span key={f} className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-[10px]/tight">{toPersianDigits(f)}</span>
                                ))}
                              </div>
                            </div>

                            <div className="text-xs font-bold text-white pt-2 border-t border-slate-850 font-sans">
                              اقلام و کالاهای متناظر فاقد زمان فروش:
                            </div>

                            <div className="overflow-x-auto border border-slate-850 rounded-xl bg-slate-950/40">
                              <table className="min-w-full text-right text-[11px] font-sans">
                                <thead className="bg-slate-900/80 text-zinc-400 border-b border-slate-800">
                                  <tr>
                                    <th className="px-3 py-2 font-bold select-none text-right">شماره فاکتور</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">تاریخ</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">مشتری</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">کد کالا</th>
                                    <th className="px-3 py-2 font-bold select-none text-right">نام کالا / محصول</th>
                                    <th className="px-3 py-2 font-bold select-none text-center">تعداد</th>
                                    <th className="px-3 py-2 font-bold select-none text-left font-sans">مبلغ کل (ریال)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-900/50 text-zinc-350">
                                  {reconciliationResult.detailedTransactions
                                    .filter(tx => !tx.time)
                                    .slice(0, 50)
                                    .map((tx, idx) => (
                                      <tr key={tx.id || idx} className="hover:bg-slate-900/40 transition-colors">
                                        <td className="px-3 py-2.5 font-bold font-mono text-rose-450">{toPersianDigits(tx.invoiceNumber || '-')}</td>
                                        <td className="px-3 py-2.5 font-mono text-[10px]">{toPersianDigits(tx.dateStr || '-')}</td>
                                        <td className="px-3 py-2.5 text-zinc-400 truncate max-w-[120px]">{tx.customerName || '-'}</td>
                                        <td className="px-3 py-2.5 font-mono text-zinc-400">{toPersianDigits(tx.productCode || '-')}</td>
                                        <td className="px-3 py-2.5 font-bold text-zinc-100">{tx.productName || 'کالای ناشناس'}</td>
                                        <td className="px-3 py-2.5 text-center font-mono font-bold text-amber-500">{toPersianDigits(tx.qtySold)}</td>
                                        <td className="px-3 py-2.5 text-left font-mono font-bold text-emerald-450">{formatWithCommas(tx.salesAmount)}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                              {reconciliationResult.detailedTransactions.filter(tx => !tx.time).length > 50 && (
                                <div className="p-2.5 text-center text-slate-500 bg-slate-950/65 text-[10px]/tight font-bold border-t border-slate-850 font-sans">
                                  تعداد {toPersianDigits(reconciliationResult.detailedTransactions.filter(tx => !tx.time).length - 50)} قلم کلمه دیگر به جهت حفظ سرعت سیستم مخفی است.
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                    {/* Barcode Scanner Bar for POS */}
                    <div className="bg-indigo-950/20 border border-indigo-900/40 p-4 rounded-2xl space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                            <BarcodeIcon className="h-4 w-4 animate-pulse" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-200">اسکن سریع بارکد (بارکدخوان / ترازو دیبال)</span>
                            <span className="text-[10px] text-indigo-300/70 block">تشخیص آنی وزن، تعداد و انتخاب خودکار محصول در فاکتور</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800 self-start sm:self-auto">
                          EAN-13 (20 / 21 / 22)
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <div className="relative flex-grow">
                          <input
                            type="text"
                            placeholder="بارکد چاپ‌شده توسط ترازوی دیبال را اسکن نموده یا تایپ کنید (مثلاً 2000123015004)..."
                            value={barcodeScanInput}
                            onChange={(e) => setBarcodeScanInput(e.target.value)}
                            onKeyDown={handleBarcodeScan}
                            className="w-full pl-3 pr-4 py-2.5 bg-slate-950 border border-indigo-900/60 rounded-xl text-xs font-mono text-indigo-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleBarcodeScan}
                          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 cursor-pointer shrink-0 flex items-center gap-1.5"
                        >
                          <BarcodeIcon className="h-4 w-4" />
                          دیکود بارکد
                        </button>
                      </div>

                      {barcodeScanFeedback && (
                        <div className={`p-2.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 animate-fadeIn ${
                          barcodeScanFeedback.status === 'success' 
                            ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300' 
                            : 'bg-rose-950/40 border border-rose-500/30 text-rose-300'
                        }`}>
                          <span>{barcodeScanFeedback.message}</span>
                          <button 
                            type="button" 
                            onClick={() => setBarcodeScanFeedback(null)}
                            className="text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Integrated Manual/Add Edit Action Panel */}
                    {(() => {
                      const computedManualGross = manualSaleQty * manualSaleUnitPrice;
                      const computedManualNet = Math.max(0, computedManualGross - manualSaleDisc);

                      return (
                        <form onSubmit={handleAddManualSale} className={`grid grid-cols-1 sm:grid-cols-7 gap-4 items-end p-5 rounded-2xl transition-all ${editingSaleId ? 'bg-indigo-950/35 border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.15)] font-sans' : 'bg-slate-900 border border-slate-850 font-sans'}`}>
                          <div className="sm:col-span-2">
                            <label htmlFor="manual-sale-prod" className={`block text-[10.5px] font-bold mb-1.5 ${editingSaleId ? 'text-indigo-300 animate-pulse' : 'text-zinc-400'}`}>
                              {editingSaleId ? '✏️ ویرایش کالای فاکتور انتخابی:' : 'نام محصول نهایی و کد مالی فروش:'}
                            </label>
                            <SearchableSelect
                              id="manual-sale-prod"
                              value={manualSaleProdId}
                              onChange={(val) => {
                                setManualSaleProdId(val);
                                const selectedProd = productMap[val];
                                if (selectedProd) {
                                  setManualSaleUnitPrice(selectedProd.salePrice);
                                } else {
                                  setManualSaleUnitPrice(0);
                                }
                              }}
                              options={products.map(p => ({
                                value: p.id,
                                label: `${p.code} | ${p.name} (فی جاری: ${formatWithCommas(p.salePrice)} ریال)`
                              }))}
                              placeholder="-- یک کالا / محصول را انتخاب نمایید --"
                            />
                          </div>

                          <div>
                            <label htmlFor="manual-sale-qty" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">تعداد فروش رفته کالا</label>
                            <input
                              id="manual-sale-qty"
                              type="number"
                              step="any"
                              onFocus={handleFocus}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-zinc-100 hover:border-slate-755 focus:border-rose-500 focus:outline-none transition-all"
                              value={manualSaleQty}
                              onChange={(e) => setManualSaleQty(parseNumber(e.target.value))}
                              min={0.01}
                            />
                          </div>

                          <div>
                            <label htmlFor="manual-sale-unit-price" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">فی فروش واحد (ریال)</label>
                            <input
                              id="manual-sale-unit-price"
                              type="text"
                              onFocus={handleFocus}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-zinc-100 hover:border-slate-755 focus:border-rose-500 focus:outline-none transition-all"
                              value={formatWithCommas(manualSaleUnitPrice)}
                              onChange={(e) => setManualSaleUnitPrice(parseNumber(e.target.value))}
                            />
                          </div>

                          {/* Dynamic Gross Amount preview block */}
                          <div>
                            <label className="block text-[10.5px] font-black text-rose-400 mb-1.5">مبلغ ناخالص کل (ریال)</label>
                            <div className="w-full px-3 py-2 bg-slate-950 border border-rose-950/40 rounded-xl text-xs font-mono text-rose-450 font-extrabold text-left truncate">
                              {formatWithCommas(computedManualGross)}
                            </div>
                          </div>

                          <div>
                            <label htmlFor="manual-sale-disc" className="block text-[10.5px] font-bold text-zinc-400 mb-1.5">میزان تخفیف (ریال)</label>
                            <input
                              id="manual-sale-disc"
                              type="text"
                              onFocus={handleFocus}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-zinc-100 hover:border-slate-755 focus:border-rose-500 focus:outline-none transition-all"
                              value={formatWithCommas(manualSaleDisc)}
                              onChange={(e) => setManualSaleDisc(parseNumber(e.target.value))}
                            />
                          </div>

                          {/* Dynamic Final Net Sales preview block */}
                          <div>
                            <label className="block text-[10.5px] font-black text-emerald-400 mb-1.5">خالص نهایی فروش (ریال)</label>
                            <div className="w-full px-3 py-2 bg-slate-950 border border-emerald-950/40 rounded-xl text-xs font-mono text-emerald-450 font-black text-left truncate">
                              {formatWithCommas(computedManualNet)}
                            </div>
                          </div>

                          <div className="sm:col-span-7 flex justify-end gap-2 text-xs pt-1">
                            {editingSaleId ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSaleId(null);
                                    setManualSaleProdId('');
                                    setManualSaleQty(1);
                                    setManualSaleDisc(0);
                                    setManualSaleUnitPrice(0);
                                  }}
                                  className="px-4 py-2 bg-slate-800 text-zinc-300 hover:bg-slate-750 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-700"
                                >
                                  انصراف
                                </button>
                                <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-650/10 transition-all cursor-pointer">
                                  اعمال لایه ذخیره فاکتور
                                </button>
                              </>
                            ) : (
                              <button type="submit" className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all">
                                + ثبت نهایی فاکتور کالا
                              </button>
                            )}
                          </div>
                        </form>
                      );
                    })()}

                    {/* Redesigned Search & Summary Area for Sales Records */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5 bg-slate-900 border border-slate-850 p-4 rounded-2xl">
                      <div className="relative w-full sm:w-72">
                        <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                        <input
                          id="sales-search-field"
                          type="text"
                          className="w-full pl-3 pr-9 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors font-sans"
                          placeholder="مجرای جستجو در فاکتورها (کد یا نام کالا)..."
                          value={salesSearchText}
                          onChange={(e) => setSalesSearchText(e.target.value)}
                        />
                      </div>

                      <div className="flex flex-wrap gap-4 text-[11px] text-zinc-400 font-medium">
                        <div>
                          تعداد اقلام ثبت‌شده فاکتور: <strong className="text-white text-xs">{toPersianDigits(filteredActiveSalesRecords.length)} ردیف</strong>
                        </div>
                        <div className="border-r border-slate-800 pr-4">
                          مجموع خالص فاکتورهای دوره: <strong className="text-emerald-400 font-extrabold text-xs">{formatWithCommas(filteredActiveSalesRecords.reduce((acc, curr) => acc + curr.netSalesAmount, 0))} ریال</strong>
                        </div>
                      </div>
                    </div>

                    {/* Sales Records Listing Table with Search, Edit, and Delete */}
                    <div id="sales-records-printable" className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/70 overflow-x-auto">
                      <table className="min-w-full text-right text-xs">
                        <thead className="bg-slate-900/90 border-b border-slate-800">
                          <tr>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 w-[12%] text-center">کد محصول</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400">نام محصول / حسابداری گاتان</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-center w-[12%]">تعداد فروش رفته</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-left">فی فروش واحد (ریال)</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-left">مبلغ ناخالص کل</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-left">مجموع تخفیف</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-left">خالص نهایی فروش</th>
                            <th className="px-4 py-3.5 font-bold text-zinc-400 text-center w-[16%]">عملیات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850/60 font-sans text-xs">
                          {filteredActiveSalesRecords.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="px-4 py-9 text-center text-zinc-500 italic">
                                هیچ فاکتور فروش فعالی مطابق با پارامترهای جستجو ثبت و یا یافت نگردید.
                              </td>
                            </tr>
                          ) : (
                            filteredActiveSalesRecords.map(rec => {
                              const p = productMap[rec.productId];
                              const isBeingEdited = rec.id === editingSaleId;
                              return (
                                <tr key={rec.id} className={`transition-colors ${isBeingEdited ? 'bg-indigo-950/25 border-l-2 border-indigo-500' : 'hover:bg-slate-900/60'}`}>
                                  <td className="px-4 py-3 text-xs font-mono font-bold text-rose-400 text-center">
                                    {p?.code || rec.productId}
                                  </td>
                                  <td className="px-4 py-3 font-sans">
                                    <div className="font-bold text-white text-[12.5px]">{p?.name || 'کالا حذف شده سیستمی'}</div>
                                    <span className="text-[10px] text-zinc-400 block font-mono mt-0.5">معین: {p?.accountId || '-'} | دسته‌بندی: {catMap[p?.categoryId || ''] || '-'}</span>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <span className="inline-block font-mono font-extrabold text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-1 rounded">
                                      {toPersianDigits(Math.round(rec.qtySold * 100) / 100)} {p?.unit || 'عدد'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-left font-mono text-zinc-400">
                                    {formatWithCommas(rec.qtySold > 0 ? Math.round(rec.netSalesAmount / rec.qtySold) : (p?.salePrice || 0))}
                                  </td>
                                  <td className="px-4 py-3 text-left font-mono text-zinc-300">
                                    {formatWithCommas(rec.preDiscountAmount)}
                                  </td>
                                  <td className="px-4 py-3 text-left font-mono text-rose-450 font-medium">
                                    {formatWithCommas(rec.discount)}
                                  </td>
                                  <td className="px-4 py-3 text-left font-mono font-extrabold text-emerald-400 bg-emerald-950/10">
                                    {formatWithCommas(rec.netSalesAmount)}
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          setEditingSaleId(rec.id);
                                          setManualSaleProdId(rec.productId);
                                          setManualSaleQty(rec.qtySold);
                                          setManualSaleDisc(rec.discount);
                                          setManualSaleUnitPrice(rec.qtySold > 0 ? Math.round(rec.netSalesAmount / rec.qtySold) : (p?.salePrice || 0));
                                          const entryEl = document.getElementById('manual-sale-prod');
                                          if (entryEl) {
                                            entryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          }
                                        }} 
                                        className="text-[11px] px-2.5 py-1 bg-indigo-600/15 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-500 rounded-lg font-bold transition-all cursor-pointer"
                                      >
                                        ویرایش
                                      </button>
                                      <button 
                                        type="button"
                                        onClick={() => deleteSaleRecord(rec.id)} 
                                        className="text-[11px] px-2.5 py-1 bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/25 hover:border-rose-500 rounded-lg font-bold transition-all cursor-pointer"
                                      >
                                        حذف
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                        {filteredActiveSalesRecords.length > 0 && (
                          <tfoot>
                            <tr className="bg-slate-900/90 border-t border-slate-800 font-extrabold text-[12.5px] text-zinc-150">
                              <td colSpan={2} className="px-4 py-3.5 text-right font-black text-rose-350">جمع کل ستون‌ها</td>
                              <td className="px-4 py-3.5 text-center font-mono font-black text-emerald-400 bg-emerald-950/20">
                                {toPersianDigits(Math.round(filteredActiveSalesRecords.reduce((acc, curr) => acc + curr.qtySold, 0) * 100) / 100)}
                              </td>
                              <td className="px-4 py-3.5 text-left text-zinc-500 font-bold">-</td>
                              <td className="px-4 py-3.5 text-left font-mono text-zinc-300">
                                {formatWithCommas(filteredActiveSalesRecords.reduce((acc, curr) => acc + curr.preDiscountAmount, 0))}
                              </td>
                              <td className="px-4 py-3.5 text-left font-mono text-rose-400 font-black">
                                {formatWithCommas(filteredActiveSalesRecords.reduce((acc, curr) => acc + curr.discount, 0))}
                              </td>
                              <td className="px-4 py-3.5 text-left font-mono font-black text-emerald-450 bg-emerald-950/40">
                                {formatWithCommas(filteredActiveSalesRecords.reduce((acc, curr) => acc + curr.netSalesAmount, 0))}
                              </td>
                              <td className="px-4 py-3.5 text-center font-bold text-zinc-500">-</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

      {activeTab === 'analysis' && (
        <SalesAnalysisDashboard 
          db={db}
          onUpdateDb={onUpdateDb}
          activePeriodId={activePeriodId}
          products={products}
          categories={categories}
          productMap={productMap}
          initialSelectedMonth={selectedSalesMonth}
          selectedMonth={selectedSalesMonth}
          onMonthChange={(m) => {
            if (m !== 'ALL') setSelectedSalesMonth(m);
          }}
          selectedYear={selectedSalesYear}
          onNavigateToCategories={() => setActiveTab('categories')}
        />
      )}

      {activeTab === 'shelf_tags' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-6 text-right" dir="rtl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl shrink-0 border border-indigo-500/20">
                <Tag className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">مدیریت و چاپ تگ‌ها و برچسب‌های قفسه (Shelf Tags)</h3>
                <p className="text-xs text-slate-400 mt-0.5">طراحی، تفکیک دپارتمانی و چاپ برچسب قیمت استاندارد برای نصب روی شلف‌ها و ویترین فروشگاه</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={handlePrintShelfTags}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-2xl text-xs font-black shadow-lg shadow-indigo-500/20 transition-all cursor-pointer border border-indigo-400/30"
              >
                <Printer className="w-4 h-4" />
                <span>چاپ برچسب‌های قفسه ({toPersianDigits(selectedShelfTagsCount > 0 ? selectedShelfTagsCount : shelfTagFilteredProducts.length)})</span>
              </button>
            </div>
          </div>

          {/* Filters & Customization Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1.5">فیلتر دپارتمان تولیدی</label>
              <select
                value={tagDeptFilter}
                onChange={(e) => setTagDeptFilter(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="all">همه دپارتمان‌ها ({departments.length})</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1.5">فیلتر دسته‌بندی کالا</label>
              <select
                value={tagCatFilter}
                onChange={(e) => setTagCatFilter(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500 font-medium"
              >
                <option value="all">همه دسته‌بندی‌ها ({categories.length})</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Search & Toggles Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950/40 p-3.5 rounded-2xl border border-slate-800">
            <div className="relative w-full sm:w-72">
              <Search className="absolute right-3.5 top-3 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="جستجو در نام، کد یا بارکد کالا..."
                className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl pr-10 pl-3.5 py-2.5 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-4 flex-wrap text-xs text-slate-300 font-bold">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showShopTitle}
                  onChange={(e) => setShowShopTitle(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                />
                <span>نمایش نام فروشگاه</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCode}
                  onChange={(e) => setShowCode(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                />
                <span>نمایش کد کالا</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBarcode}
                  onChange={(e) => setShowBarcode(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                />
                <span>چاپ بارکد</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDepartment}
                  onChange={(e) => setShowDepartment(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                />
                <span>چاپ دپارتمان</span>
              </label>

              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1">
                <span className="text-[11px] text-slate-400 font-bold whitespace-nowrap">واحد قیمت چاپ:</span>
                <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTagPriceCurrency('rial')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                      tagPriceCurrency === 'rial'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ریال
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagPriceCurrency('toman')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-all cursor-pointer ${
                      tagPriceCurrency === 'toman'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    تومان
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Print Customization Panel */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <h4 className="text-xs font-black text-indigo-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>تنظیمات پیشرفته ابعاد، چیدمان، لوگو، فونت و چاپ لیبل (بدون فاصله برای برش آسان)</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">تعداد در عرض (ستون)</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={tagCols}
                  onChange={(e) => setTagCols(Math.max(1, parseInt(e.target.value) || 3))}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">تعداد در طول (سطر)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={tagRows}
                  onChange={(e) => setTagRows(Math.max(1, parseInt(e.target.value) || 5))}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">عرض لیبل (cm)</label>
                <input
                  type="number"
                  step="0.5"
                  min={1}
                  max={30}
                  value={tagWidthCm}
                  onChange={(e) => setTagWidthCm(parseFloat(e.target.value) || 7)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">طول لیبل (cm)</label>
                <input
                  type="number"
                  step="0.5"
                  min={1}
                  max={30}
                  value={tagHeightCm}
                  onChange={(e) => setTagHeightCm(parseFloat(e.target.value) || 4)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">جهت کاغذ چاپ</label>
                <select
                  value={paperOrientation}
                  onChange={(e) => setPaperOrientation(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium"
                >
                  <option value="portrait">عمودی A4 (Portrait)</option>
                  <option value="landscape">افقی A4 (Landscape)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">حاشیه کاغذ (mm)</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={pageMarginMm}
                  onChange={(e) => setPageMarginMm(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
              <div className="sm:col-span-2">
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">عنوان فروشگاه / برند روی برچسب</label>
                <input
                  type="text"
                  value={shopBrandName}
                  onChange={(e) => setShopBrandName(e.target.value)}
                  placeholder="مثلاً: شیرینی و کافه گاتان"
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2.5 font-medium"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">نوع فونت لیبل</label>
                <select
                  value={tagFontFamily}
                  onChange={(e) => setTagFontFamily(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium"
                >
                  <option value="Vazirmatn">وزیر (Vazirmatn)</option>
                  <option value="Shabnam">شبنم (Shabnam)</option>
                  <option value="Tahoma">تخما (Tahoma)</option>
                  <option value="Arial">آریال (Arial)</option>
                  <option value="Yekan">یکان (Yekan)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">چیدمان محتوا</label>
                <select
                  value={contentAlignment}
                  onChange={(e) => setContentAlignment(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium"
                >
                  <option value="center">مرکز (Center)</option>
                  <option value="right">راست (Right)</option>
                  <option value="left">چپ (Left)</option>
                </select>
              </div>
            </div>

            {/* Logo Settings & Font Sizes */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 pt-2 border-t border-slate-800/80 items-end">
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">لوگوی لیبل</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          setLogoUrl(event.target?.result as string || '');
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="hidden"
                    id="logo-upload-input"
                  />
                  <label htmlFor="logo-upload-input" className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer transition-all">
                    {logoUrl ? 'تغییر لوگو' : 'آپلود لوگو'}
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="px-2 py-2 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white rounded-xl text-xs font-bold transition-all"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>
              {logoUrl && (
                <>
                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-300 mb-1">عرض لوگو (px)</label>
                    <input
                      type="number"
                      min={12}
                      max={100}
                      value={logoWidth}
                      onChange={(e) => setLogoWidth(parseInt(e.target.value) || 24)}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-300 mb-1">ارتفاع لوگو (px)</label>
                    <input
                      type="number"
                      min={12}
                      max={100}
                      value={logoHeight}
                      onChange={(e) => setLogoHeight(parseInt(e.target.value) || 24)}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-bold text-slate-300 mb-1">محل لوگو</label>
                    <select
                      value={logoPosition}
                      onChange={(e) => setLogoPosition(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-medium"
                    >
                      <option value="top-right">بالای راست</option>
                      <option value="top-center">بالای مرکز</option>
                      <option value="top-left">بالای چپ</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">فونت نام (px)</label>
                <input
                  type="number"
                  min={8}
                  max={24}
                  value={fontSizeTitle}
                  onChange={(e) => setFontSizeTitle(parseInt(e.target.value) || 13)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">فونت قیمت (px)</label>
                <input
                  type="number"
                  min={10}
                  max={30}
                  value={fontSizePrice}
                  onChange={(e) => setFontSizePrice(parseInt(e.target.value) || 14)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-slate-300 mb-1">فونت جزئیات (px)</label>
                <input
                  type="number"
                  min={6}
                  max={14}
                  value={fontSizeMeta}
                  onChange={(e) => setFontSizeMeta(parseFloat(e.target.value) || 8.5)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 font-mono font-bold"
                />
              </div>
            </div>
          </div>

          {/* Products List & Selection Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-2">
              <span className="text-xs font-bold text-slate-300">
                فهرست کالاها و محصولات قابل چاپ تگ ({toPersianDigits(shelfTagFilteredProducts.length)} مورد)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectAllShelfTags(true)}
                  className="text-xs px-3 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-lg font-bold transition-colors cursor-pointer border border-slate-700"
                >
                  انتخاب همه
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllShelfTags(false)}
                  className="text-xs px-3 py-1 bg-slate-800 hover:bg-slate-750 text-slate-400 rounded-lg font-bold transition-colors cursor-pointer border border-slate-700"
                >
                  لغو انتخاب‌ها
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950">
              <table className="min-w-full divide-y divide-slate-800 text-right text-xs">
                <thead className="bg-slate-900/80 text-slate-300 font-bold">
                  <tr>
                    <th className="p-3.5 text-center w-12">
                      <input
                        type="checkbox"
                        checked={shelfTagFilteredProducts.length > 0 && shelfTagFilteredProducts.every(p => selectedProductIdsForTags[p.id])}
                        onChange={(e) => handleSelectAllShelfTags(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="p-3.5">کد کالا</th>
                    <th className="p-3.5">نام محصول</th>
                    <th className="p-3.5">دسته‌بندی و دپارتمان</th>
                    <th className="p-3.5 text-center">واحد فروش</th>
                    <th className="p-3.5 text-left">قیمت مصوب ({shelfTagCurrencyLabel})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-slate-200">
                  {shelfTagFilteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500 font-medium">
                        هیچ کالایی مطابق با فیلترهای انتخابی یافت نشد.
                      </td>
                    </tr>
                  ) : (
                    shelfTagFilteredProducts.map(p => {
                      const catObj = categories.find(c => c.id === p.categoryId);
                      const deptId = resolveProductDepartmentId(p.categoryId);
                      const deptObj = departments.find(d => d.id === deptId);
                      const isSelected = !!selectedProductIdsForTags[p.id];

                      return (
                        <tr 
                          key={p.id} 
                          onClick={() => {
                            setSelectedProductIdsForTags(prev => ({ ...prev, [p.id]: !prev[p.id] }));
                          }}
                          className={`hover:bg-slate-900/70 transition-colors cursor-pointer ${isSelected ? 'bg-indigo-950/20' : ''}`}
                        >
                          <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedProductIdsForTags(prev => ({ ...prev, [p.id]: checked }));
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="p-3.5 font-mono font-bold text-indigo-400">{p.code || '---'}</td>
                          <td className="p-3.5 font-black text-white">{p.name}</td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {catObj && <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded-md text-[10px] font-bold">{catObj.name}</span>}
                              {deptObj && <span className="px-2 py-0.5 bg-indigo-500/15 text-indigo-300 rounded-md text-[10px] font-black border border-indigo-500/30">{deptObj.name}</span>}
                            </div>
                          </td>
                          <td className="p-3.5 text-center font-medium text-slate-300">{p.unit}</td>
                          <td className="p-3.5 text-left font-mono font-black text-emerald-400">
                            {toPersianDigits(formatShelfTagPrice(p.salePrice))}
                            <span className="text-[10px] font-bold text-slate-400 mr-1">{shelfTagCurrencyLabel}</span>
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
      </div>

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn animate-duration-200" dir="rtl">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-right animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-500 mb-4">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                <AlertTriangle className="h-6 w-6 text-rose-500 animate-pulse" />
              </div>
              <h3 className="text-base font-extrabold text-slate-100">{confirmModal.title}</h3>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed font-medium mb-6">
              {confirmModal.message}
            </p>
            
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg border border-rose-500/15 transition-all cursor-pointer"
              >
                تایید و حذف دائم
              </button>
            </div>
          </div>
        </div>
      )}

      <CopyFromPeriodModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        activePeriodId={activePeriodId}
        sectionKey={activeCopySection}
        onUpdateDb={onUpdateDb}
      />

    </div>
  );
}
