/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AppDatabase, Product, Item, ProductFormula, ProductFormulaItem, UnitConversion, DailyProductionSegment, PayrollItem, PersonnelAllocation, Department, ProductCategory 
} from '../types';
import SearchableSelect from './SearchableSelect';
import { 
  toPersianDigits, formatWithCommas, parseNumber, downloadCSV, printElement, matchPersianString, getTodayJalali, getFiscalYearFromPeriod, getDefaultYearMonthFromPeriod, toEnglishDigits,
  normalizeAccountingCode, getProductFormulaKey, getMaterialFormulaKey, doesFormulaMatchProduct, doesIngredientMatchMaterial
} from '../utils/persianUtils';
import { decodeFileBuffer, parseCSVText } from '../utils/csvUtils';
import { exportCogsFormulasToExcel, importCogsFormulasFromExcel } from '../utils/excelService';
import { 
  Plus, Search, Trash2, Copy, RefreshCcw, HelpCircle, Settings, Calculator, 
  CheckCircle, AlertCircle, Edit, DollarSign, ArrowLeftRight, TrendingUp, 
  TrendingDown, FileSpreadsheet, Percent, Info, Layers, Users, Building, 
  ShieldAlert, Activity, Coffee, ArrowUpRight, Upload, Check, Clock,
  Printer, PieChart, BarChart3, AlertTriangle, Scale, X, Save, CheckSquare,
  ArrowUpDown, ArrowUp, ArrowDown, Calendar
} from 'lucide-react';
import { nextSimpleId, createSimpleIdGenerator } from '../utils/simpleId';
import { CopySectionKey } from '../utils/periodCopyEngine';
import CopyFromPeriodModal from './ui/CopyFromPeriodModal';
import {
  ModuleHeader,
  ModulePrimaryTabs,
  ErpButton,
  ERP_BUTTON_LABELS,
  KpiStrip,
  UnifiedToolbar,
} from './ui/UnifiedErpUi';
import { downloadTemplateExcel } from '../utils/tableIoUtils';

interface CogsManagementProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId: string;
}

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const UNASSIGNED_DEPT_ID = '__UNASSIGNED__';

const normalizeEmpCode = (code: any): string => toEnglishDigits(String(code ?? '')).trim();
const stripZeroEmpCode = (code: string): string => code.replace(/^0+/, '') || code;
const normalizeCatName = (name?: string): string =>
  String(name || '').trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ');

const getPayrollItemTotalCost = (pi: PayrollItem): number => {
  const ins23 = pi.employerInsurance23 !== undefined
    ? Number(pi.employerInsurance23 || 0)
    : (Number(pi.employerPensionShare || 0) + Number(pi.employerUnemploymentShare || 0));
  const computed = Number(pi.payableAmount || 0) + ins23;
  return computed > 0 ? computed : Number(pi.totalPayrollCost || 0);
};

export default function CogsManagement({ db, onUpdateDb, activePeriodId }: CogsManagementProps) {
  const [activeTab, setActiveTab] = useState<'formulas' | 'conversions' | 'timeline' | 'analytics' | 'comparison' | 'pricing' | 'wip'>('formulas');
  const [showCopyModal, setShowCopyModal] = useState(false);

  const activeCopySection: CopySectionKey = useMemo(() => {
    switch (activeTab) {
      case 'conversions': return 'unitConversions';
      case 'timeline': return 'dailyProductionSegments';
      case 'wip': return 'products';
      default: return 'productFormulas';
    }
  }, [activeTab]);

  const activePeriodObj = useMemo(() => db.periods.find(p => p.id === activePeriodId), [db.periods, activePeriodId]);
  const selectedCogsYear = useMemo(() => getFiscalYearFromPeriod(activePeriodObj, activePeriodId), [activePeriodObj, activePeriodId]);

  const defaultPeriodMonthYear = useMemo(() => {
    const ym = getDefaultYearMonthFromPeriod(activePeriodObj, activePeriodId);
    return { defaultYear: ym.year, defaultMonth: ym.month };
  }, [activePeriodId, activePeriodObj]);

  const [selectedCogsMonth, setSelectedCogsMonth] = useState<number>(defaultPeriodMonthYear.defaultMonth);

  React.useEffect(() => {
    setSelectedCogsMonth(defaultPeriodMonthYear.defaultMonth);
  }, [activePeriodId, defaultPeriodMonthYear.defaultMonth]);
  const [showAllocationTableModal, setShowAllocationTableModal] = useState(false);
  const [allocationModalTab, setAllocationModalTab] = useState<'departmental' | 'summary'>('departmental');
  const [allocationSearchQuery, setAllocationSearchQuery] = useState('');
  const [selectedAllocationCatId, setSelectedAllocationCatId] = useState<string>('all');
  const [recalcTrigger, setRecalcTrigger] = useState(0);
  const [recalcFeedback, setRecalcFeedback] = useState<{ total: number; updated: number; time: string } | null>(null);
  const [isEditingPurchaseCost, setIsEditingPurchaseCost] = useState(false);
  const [tempPurchaseCost, setTempPurchaseCost] = useState('');

  const periodDepartmentsList = useMemo(() => {
    const rawDepts = (db.departments || []).filter(d => d.periodId === activePeriodId);
    const source: (Department | ProductCategory)[] = rawDepts.length > 0
      ? rawDepts
      : (db.productCategories || []).filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return source.filter(d => {
      const normName = normalizeCatName(d.name);
      const duplicate = seen.has(d.id) || (Boolean(normName) && seen.has(`name:${normName}`));
      seen.add(d.id);
      if (normName) seen.add(`name:${normName}`);
      return !duplicate;
    });
  }, [db.departments, db.productCategories, activePeriodId]);

  // Target profit margin & price approval state variables (per production department)
  const [deptMargins, setDeptMargins] = useState<Record<string, number>>(() => {
    const margins: Record<string, number> = {};
    (db.productCategories || []).forEach(cat => {
      if (cat.targetMargin !== undefined) margins[cat.id] = cat.targetMargin;
    });
    (db.departments || []).forEach(dept => {
      if (dept.targetMargin !== undefined) margins[dept.id] = dept.targetMargin;
    });
    return margins;
  });

  React.useEffect(() => {
    const margins: Record<string, number> = {};
    (db.productCategories || []).filter(c => c.periodId === activePeriodId).forEach(cat => {
      if (cat.targetMargin !== undefined) margins[cat.id] = cat.targetMargin;
    });
    periodDepartmentsList.forEach(dept => {
      if (dept.targetMargin !== undefined) margins[dept.id] = dept.targetMargin;
    });
    setDeptMargins(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(margins);
      if (prevKeys.length === nextKeys.length && nextKeys.every(k => prev[k] === margins[k])) {
        return prev;
      }
      return margins;
    });
  }, [periodDepartmentsList, db.productCategories, activePeriodId]);

  const [dateOfChange, setDateOfChange] = useState(() => {
    return `${selectedCogsYear}/${String(defaultPeriodMonthYear.defaultMonth).padStart(2, '0')}/01`;
  });

  React.useEffect(() => {
    setDateOfChange(`${selectedCogsYear}/${String(selectedCogsMonth).padStart(2, '0')}/01`);
  }, [selectedCogsYear, selectedCogsMonth]);

  const [approvedPrices, setApprovedPrices] = useState<Record<string, number>>({});
  const [originalPrices, setOriginalPrices] = useState<Record<string, number>>({});
  const [analyticsSearch, setAnalyticsSearch] = useState('');
  const [analyticsFormulaFilter, setAnalyticsFormulaFilter] = useState<'all' | 'with_formula' | 'without_formula' | 'purchased'>('all');
  const [analyticsCategoryFilter, setAnalyticsCategoryFilter] = useState<string>('all');
  const [pricingSearch, setPricingSearch] = useState('');
  const [pricingFilterMode, setPricingFilterMode] = useState<'all' | 'approved' | 'hasCost'>('all');

  // Performance comparison tab state variables
  const [comparisonSearch, setComparisonSearch] = useState('');
  const [comparisonCategoryFilter, setComparisonCategoryFilter] = useState<string>('all');
  const [comparisonSortMode, setComparisonSortMode] = useState<'default' | 'growth_desc' | 'growth_asc' | 'rev_growth_desc' | 'rev_growth_asc'>('default');
  const [comparisonGroupByDepartment, setComparisonGroupByDepartment] = useState<boolean>(true);
  const [comparisonGrowthFilter, setComparisonGrowthFilter] = useState<'all' | 'positive_qty' | 'negative_qty' | 'positive_rev' | 'negative_rev'>('all');

  const periodProducts = useMemo(() => {
    return db.products.filter(p => p.periodId === activePeriodId);
  }, [db.products, activePeriodId]);

  const productCategories = useMemo(() => {
    const filtered = (db.productCategories || []).filter(c => c.periodId === activePeriodId);
    const seen = new Set<string>();
    return filtered.filter(c => {
      const normName = normalizeCatName(c.name);
      const duplicate = seen.has(c.id) || (Boolean(normName) && seen.has(`name:${normName}`));
      seen.add(c.id);
      if (normName) seen.add(`name:${normName}`);
      return !duplicate;
    });
  }, [db.productCategories, activePeriodId]);

  const departments = periodDepartmentsList;
  const hasIndependentDepartments = useMemo(
    () => (db.departments || []).some(d => d.periodId === activePeriodId),
    [db.departments, activePeriodId]
  );

  // Normalized department & category lookup maps
  const departmentNameById = useMemo(() => {
    const map: Record<string, string> = {};
    (db.productCategories || []).forEach(c => {
      map[c.id] = normalizeCatName(c.name);
    });
    (db.departments || []).forEach(d => {
      map[d.id] = normalizeCatName(d.name);
    });
    return map;
  }, [db.departments, db.productCategories]);

  const stripDeptPrefix = (name: string): string =>
    normalizeCatName(name).replace(/^(?:دپارتمان\s*خط\s*تولید|دپارتمان\s*تولید|دپارتمان)\s+/, '').trim();

  const isSharedDeptId = React.useCallback((deptId?: string): boolean => {
    if (!deptId) return true;
    const trimmed = String(deptId).trim();
    if (!trimmed || trimmed === UNASSIGNED_DEPT_ID) return false;
    if (trimmed === 'cat-4' || /-cat-4$/.test(trimmed) || /-dept-4$/.test(trimmed)) return true;
    const deptName = departmentNameById[trimmed] || stripDeptPrefix(trimmed);
    if (deptName === 'مشترک' || deptName.includes('کادر مشترک') || deptName.includes('سربار کارگاه')) return true;
    return false;
  }, [departmentNameById]);

  const sharedCanonicalCatId = useMemo(() => {
    const sharedDept = departments.find(d => normalizeCatName(d.name) === 'مشترک' || /-cat-4$/.test(d.id) || /-dept-4$/.test(d.id) || d.id === 'cat-4');
    return sharedDept?.id || 'cat-4';
  }, [departments]);

  const resolveCanonicalCategoryId = React.useCallback((rawDeptId?: string): string => {
    if (!rawDeptId) return sharedCanonicalCatId;
    const trimmed = String(rawDeptId).trim();
    if (trimmed === UNASSIGNED_DEPT_ID) return UNASSIGNED_DEPT_ID;
    if (!trimmed || isSharedDeptId(trimmed)) return sharedCanonicalCatId;
    if (departments.some(d => d.id === trimmed)) return trimmed;

    const rawName = departmentNameById[trimmed] || normalizeCatName(trimmed);
    const stripped = stripDeptPrefix(rawName);
    if (stripped) {
      const byName = departments.find(d => {
        const dn = normalizeCatName(d.name);
        return dn === stripped || stripDeptPrefix(dn) === stripped;
      });
      if (byName) return byName.id;
    }

    const legacyMatch = trimmed.match(/-(?:cat|dept)-(\d+)$/);
    if (legacyMatch) {
      const idx = parseInt(legacyMatch[1], 10);
      const bySuffix = departments.find(d => d.id.endsWith(`-cat-${idx}`) || d.id.endsWith(`-dept-${idx}`));
      if (bySuffix) return bySuffix.id;
      const defaultNames = ['نان', 'قنادی', 'کافه', 'فینگر فود', 'مشترک'];
      if (idx >= 0 && idx < defaultNames.length) {
        const byDefaultName = departments.find(d => normalizeCatName(d.name) === defaultNames[idx]);
        if (byDefaultName) return byDefaultName.id;
      }
    }

    return trimmed;
  }, [departments, departmentNameById, isSharedDeptId, sharedCanonicalCatId]);

  const categoryByIdMap = useMemo(() => {
    const map: Record<string, ProductCategory> = {};
    productCategories.forEach(c => {
      map[c.id] = c;
    });
    return map;
  }, [productCategories]);

  // Effective purchased/resale classifier: Product-level override > Category-level default > false (produced)
  const isProductPurchased = React.useCallback((p: Product): boolean => {
    if (p.isPurchased !== undefined) return Boolean(p.isPurchased);
    const cat = categoryByIdMap[p.categoryId];
    return Boolean(cat?.isPurchased);
  }, [categoryByIdMap]);

  const resolveProductDepartmentId = React.useCallback((productCategoryId?: string): string => {
    if (!productCategoryId) return UNASSIGNED_DEPT_ID;
    const cat = categoryByIdMap[productCategoryId];
    if (!cat) {
      if (!hasIndependentDepartments && departments.some(d => d.id === productCategoryId)) {
        return productCategoryId;
      }
      return UNASSIGNED_DEPT_ID;
    }
    if (cat.departmentId) {
      if (departments.some(d => d.id === cat.departmentId)) return cat.departmentId;
      const canon = resolveCanonicalCategoryId(cat.departmentId);
      if (departments.some(d => d.id === canon)) return canon;
      return UNASSIGNED_DEPT_ID;
    }
    if (!hasIndependentDepartments) {
      const canon = resolveCanonicalCategoryId(cat.id);
      if (departments.some(d => d.id === canon)) return canon;
    }
    return UNASSIGNED_DEPT_ID;
  }, [categoryByIdMap, departments, hasIndependentDepartments, resolveCanonicalCategoryId]);

  const unmappedCategoryStats = useMemo(() => {
    const unmappedCategories = productCategories.filter(
      cat => !isSharedDeptId(cat.id) && resolveProductDepartmentId(cat.id) === UNASSIGNED_DEPT_ID
    );
    const unassignedProducts = periodProducts.filter(
      p => resolveProductDepartmentId(p.categoryId) === UNASSIGNED_DEPT_ID
    );
    return {
      unmappedCategories,
      unassignedProductsCount: unassignedProducts.length
    };
  }, [productCategories, periodProducts, isSharedDeptId, resolveProductDepartmentId]);

  const departmentFilterOptions = useMemo(() => {
    if (unmappedCategoryStats.unassignedProductsCount > 0) {
      return [
        ...departments,
        { id: UNASSIGNED_DEPT_ID, periodId: activePeriodId, name: 'تخصیص‌نیافته (بدون دپارتمان)' }
      ];
    }
    return departments;
  }, [departments, unmappedCategoryStats.unassignedProductsCount, activePeriodId]);

  const resolveProductCategoryFilterId = React.useCallback((rawCatId?: string): string => {
    if (!rawCatId) return '';
    if (productCategories.some(c => c.id === rawCatId)) return rawCatId;
    const rawName = departmentNameById[rawCatId] || normalizeCatName(rawCatId);
    const byName = productCategories.find(c => normalizeCatName(c.name) === rawName);
    return byName ? byName.id : rawCatId;
  }, [productCategories, departmentNameById]);

  React.useEffect(() => {
    const approved: Record<string, number> = {};
    const original: Record<string, number> = {};
    periodProducts.forEach(p => {
      approved[p.id] = Number.isFinite(Number(p.approvedPrice)) ? Number(p.approvedPrice) : 0;
      original[p.id] = Number.isFinite(Number(p.salePrice)) ? Number(p.salePrice) : 0;
    });
    setApprovedPrices(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(approved);
      if (prevKeys.length === nextKeys.length && nextKeys.every(k => prev[k] === approved[k])) {
        return prev;
      }
      return approved;
    });
    setOriginalPrices(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(original);
      if (prevKeys.length === nextKeys.length && nextKeys.every(k => prev[k] === original[k])) {
        return prev;
      }
      return original;
    });
  }, [periodProducts]);

  const handleDeptMarginChange = (deptId: string, marginValue: number) => {
    const updated = { ...deptMargins, [deptId]: marginValue };
    setDeptMargins(updated);

    const updatedDepartments = (db.departments || []).map(dept =>
      dept.id === deptId ? { ...dept, targetMargin: marginValue } : dept
    );
    const updatedCategories = (db.productCategories || []).map(cat =>
      cat.id === deptId ? { ...cat, targetMargin: marginValue } : cat
    );

    onUpdateDb({
      ...db,
      departments: updatedDepartments,
      productCategories: updatedCategories
    });
  };

  const selectedSalesPeriodId = activePeriodId;

  const activeSalesRecords = useMemo(() => {
    return db.productSales.filter(s => {
      if (s.periodId !== activePeriodId) return false;
      if (s.month !== undefined && s.year !== undefined) {
        return Number(s.month) === Number(selectedCogsMonth) && Number(s.year) === Number(selectedCogsYear);
      }
      return Number(selectedCogsMonth) === Number(defaultPeriodMonthYear.defaultMonth) &&
             Number(selectedCogsYear) === Number(defaultPeriodMonthYear.defaultYear);
    });
  }, [db.productSales, activePeriodId, selectedCogsMonth, selectedCogsYear, defaultPeriodMonthYear]);

  const totalSalesRevenueNet = useMemo(() => {
    return activeSalesRecords.reduce((acc, current) => acc + current.netSalesAmount, 0);
  }, [activeSalesRecords]);

  // Profit & Loss memos are computed right after fullCalculatedCOGSMap so they always use real-time calculated COGS.

  const comparedPeriodId = useMemo(() => {
    const sorted = [...db.periods].sort((a, b) => a.id.localeCompare(b.id));
    const currentIndex = sorted.findIndex(p => p.id === activePeriodId);
    if (currentIndex > 0) {
      return sorted[currentIndex - 1].id;
    }
    return db.periods.find(p => p.id !== activePeriodId)?.id || '';
  }, [db.periods, activePeriodId]);
  
  const prevMonthHasSalesInPeriod = useMemo(() => {
    if (selectedCogsMonth <= 1) return false;
    const prevM = selectedCogsMonth - 1;
    return db.productSales.some(s => {
      if (s.periodId !== activePeriodId) return false;
      if (s.month !== undefined && s.year !== undefined) {
        return Number(s.month) === prevM && Number(s.year) === Number(selectedCogsYear);
      }
      return prevM === Number(defaultPeriodMonthYear.defaultMonth) && Number(selectedCogsYear) === Number(defaultPeriodMonthYear.defaultYear);
    });
  }, [db.productSales, activePeriodId, selectedCogsMonth, selectedCogsYear, defaultPeriodMonthYear]);

  const comparisonPrevLabel = useMemo(() => {
    if (prevMonthHasSalesInPeriod) {
      return `${PERSIAN_MONTHS[selectedCogsMonth - 2]} ${toPersianDigits(selectedCogsYear)}`;
    }
    return db.periods.find(p => p.id === comparedPeriodId)?.name || comparedPeriodId;
  }, [prevMonthHasSalesInPeriod, selectedCogsMonth, selectedCogsYear, db.periods, comparedPeriodId]);

  const growthComparisonList = useMemo(() => {
    if (!prevMonthHasSalesInPeriod && !comparedPeriodId) return [];

    return activeSalesRecords.map(sale => {
      const prodObj = db.products.find(p => p.id === sale.productId);
      if (!prodObj) return null;

      let compSale: typeof sale | undefined;
      if (prevMonthHasSalesInPeriod) {
        const prevM = selectedCogsMonth - 1;
        compSale = db.productSales.find(s => {
          if (s.periodId !== activePeriodId || s.productId !== prodObj.id) return false;
          if (s.month !== undefined && s.year !== undefined) {
            return Number(s.month) === prevM && Number(s.year) === Number(selectedCogsYear);
          }
          return prevM === Number(defaultPeriodMonthYear.defaultMonth) && Number(selectedCogsYear) === Number(defaultPeriodMonthYear.defaultYear);
        });
      } else {
        const compProd = db.products.find(p => p.periodId === comparedPeriodId && (
          (p.code && p.code === prodObj.code) || 
          (p.name && p.name === prodObj.name)
        ));
        compSale = compProd 
          ? db.productSales.find(s => s.periodId === comparedPeriodId && s.productId === compProd.id)
          : undefined;
      }

      const priorQty = compSale ? compSale.qtySold : 0;
      const priorRevenue = compSale ? compSale.netSalesAmount : 0;

      const currentQty = Math.round(sale.qtySold * 100) / 100;
      const currentRev = Math.round(sale.netSalesAmount * 100) / 100;
      const roundedPriorQty = Math.round(priorQty * 100) / 100;
      const roundedPriorRev = Math.round(priorRevenue * 100) / 100;

      const qtyGrowth = Math.round((currentQty - roundedPriorQty) * 100) / 100;
      const revGrowth = Math.round((currentRev - roundedPriorRev) * 100) / 100;

      const qtyGrowthPct = roundedPriorQty > 0 ? Math.round((qtyGrowth / roundedPriorQty) * 10000) / 100 : 100;
      const revGrowthPct = roundedPriorRev > 0 ? Math.round((revGrowth / roundedPriorRev) * 10000) / 100 : 100;

      return {
        prod: prodObj,
        currentQty,
        currentRev,
        priorQty: roundedPriorQty,
        priorRev: roundedPriorRev,
        qtyGrowth,
        qtyGrowthPct,
        revGrowth,
        revGrowthPct
      };
    }).filter(Boolean) as any[];
  }, [activeSalesRecords, prevMonthHasSalesInPeriod, comparedPeriodId, selectedCogsMonth, selectedCogsYear, activePeriodId, defaultPeriodMonthYear, db.products, db.productSales]);

  const searchedGrowthComparisonList = useMemo(() => {
    let list = growthComparisonList;
    if (analyticsSearch) {
      list = list.filter(g => 
        matchPersianString(g.prod.name, analyticsSearch) || 
        matchPersianString(g.prod.code, analyticsSearch)
      );
    }
    
    if (analyticsFormulaFilter === 'with_formula') {
      list = list.filter(g => !isProductPurchased(g.prod) && db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, g.prod) && f.periodId === activePeriodId && f.ingredients.length > 0));
    } else if (analyticsFormulaFilter === 'without_formula') {
      list = list.filter(g => !isProductPurchased(g.prod) && !db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, g.prod) && f.periodId === activePeriodId && f.ingredients.length > 0));
    } else if (analyticsFormulaFilter === 'purchased') {
      list = list.filter(g => isProductPurchased(g.prod));
    }

    if (analyticsCategoryFilter && analyticsCategoryFilter !== 'all') {
      list = list.filter(g => resolveProductDepartmentId(g.prod.categoryId) === analyticsCategoryFilter);
    }
    
    return list;
  }, [growthComparisonList, analyticsSearch, analyticsFormulaFilter, analyticsCategoryFilter, db.productFormulas, activePeriodId, resolveProductDepartmentId, isProductPurchased]);

  const searchedGrowthTotals = useMemo(() => {
    let priorRevSum = 0;
    let currentRevSum = 0;
    let revGrowthSum = 0;
    let priorQtySum = 0;
    let currentQtySum = 0;

    searchedGrowthComparisonList.forEach(g => {
      priorRevSum += g.priorRev;
      currentRevSum += g.currentRev;
      revGrowthSum += g.revGrowth;
      priorQtySum += g.priorQty;
      currentQtySum += g.currentQty;
    });

    return {
      priorRevSum,
      currentRevSum,
      revGrowthSum,
      priorQtySum,
      currentQtySum
    };
  }, [searchedGrowthComparisonList]);

  const processedComparisonList = useMemo(() => {
    let list = [...growthComparisonList];

    // Search filter
    if (comparisonSearch) {
      list = list.filter(g => 
        matchPersianString(g.prod.name, comparisonSearch) || 
        matchPersianString(g.prod.code, comparisonSearch)
      );
    }

    // Department filter
    if (comparisonCategoryFilter && comparisonCategoryFilter !== 'all') {
      list = list.filter(g => resolveProductDepartmentId(g.prod.categoryId) === comparisonCategoryFilter);
    }

    // Growth status filter
    if (comparisonGrowthFilter === 'positive_qty') {
      list = list.filter(g => g.qtyGrowth >= 0);
    } else if (comparisonGrowthFilter === 'negative_qty') {
      list = list.filter(g => g.qtyGrowth < 0);
    } else if (comparisonGrowthFilter === 'positive_rev') {
      list = list.filter(g => g.revGrowth >= 0);
    } else if (comparisonGrowthFilter === 'negative_rev') {
      list = list.filter(g => g.revGrowth < 0);
    }

    // Sorting (strictly only for Physical Growth and Revenue Growth)
    if (comparisonSortMode === 'growth_desc') {
      list.sort((a, b) => b.qtyGrowth - a.qtyGrowth);
    } else if (comparisonSortMode === 'growth_asc') {
      list.sort((a, b) => a.qtyGrowth - b.qtyGrowth);
    } else if (comparisonSortMode === 'rev_growth_desc') {
      list.sort((a, b) => b.revGrowth - a.revGrowth);
    } else if (comparisonSortMode === 'rev_growth_asc') {
      list.sort((a, b) => a.revGrowth - b.revGrowth);
    }

    return list;
  }, [growthComparisonList, comparisonSearch, comparisonCategoryFilter, comparisonGrowthFilter, comparisonSortMode, resolveProductDepartmentId]);

  const processedComparisonTotals = useMemo(() => {
    let priorRevSum = 0;
    let currentRevSum = 0;
    let revGrowthSum = 0;
    let priorQtySum = 0;
    let currentQtySum = 0;

    processedComparisonList.forEach(g => {
      priorRevSum += g.priorRev;
      currentRevSum += g.currentRev;
      revGrowthSum += g.revGrowth;
      priorQtySum += g.priorQty;
      currentQtySum += g.currentQty;
    });

    return {
      priorRevSum,
      currentRevSum,
      revGrowthSum,
      priorQtySum,
      currentQtySum
    };
  }, [processedComparisonList]);

  const printComparisonReport = () => {
    const activePeriodName = `${PERSIAN_MONTHS[selectedCogsMonth - 1]} ${toPersianDigits(selectedCogsYear)}`;
    const comparedPeriodName = comparisonPrevLabel;

    let tableContentHtml = '';

    const numberCellStyle = "font-family: 'Vazirmatn', Tahoma, sans-serif; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 11px;";

    if (comparisonGroupByDepartment) {
      departmentFilterOptions.forEach(cat => {
        const catItems = processedComparisonList.filter(g => resolveProductDepartmentId(g.prod.categoryId) === cat.id);
        if (catItems.length === 0) return;

        tableContentHtml += `
          <tr style="background-color: #eef2ff; font-weight: 800;">
            <td colspan="7" style="padding: 10px 12px; border: 1px solid #cbd5e1; text-align: right; color: #1e1b4b; font-size: 12px; font-weight: 800;">
              دپارتمان تولیدی: ${cat.name}
            </td>
          </tr>
        `;

        let catPriorQty = 0;
        let catCurrentQty = 0;
        let catPriorRev = 0;
        let catCurrentRev = 0;
        let catRevGrowth = 0;

        catItems.forEach(g => {
          catPriorQty += g.priorQty;
          catCurrentQty += g.currentQty;
          catPriorRev += g.priorRev;
          catCurrentRev += g.currentRev;
          catRevGrowth += g.revGrowth;

          const growthClass = g.qtyGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
          const growthSign = g.qtyGrowth >= 0 ? '+' : '';
          const revClass = g.revGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
          const revSign = g.revGrowth >= 0 ? '+' : '';

          tableContentHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: right; font-weight: 700; color: #1e293b; font-size: 11px;">
                ${g.prod.name} <span style="font-size: 10px; color: #64748b; font-weight: 500;">(${g.prod.code || '-'})</span>
              </td>
              <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #334155;">
                ${formatWithCommas(g.priorQty)} <span style="font-size: 9px; color: #64748b; font-weight: 400;">${g.prod.unit}</span>
              </td>
              <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #334155;">
                ${formatWithCommas(g.currentQty)} <span style="font-size: 9px; color: #64748b; font-weight: 400;">${g.prod.unit}</span>
              </td>
              <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} font-weight: 700; ${growthClass}">
                ${growthSign}${formatWithCommas(g.qtyGrowth)} (${formatWithCommas(g.qtyGrowthPct)}%)
              </td>
              <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #334155;">
                ${formatWithCommas(Math.round(g.priorRev))}
              </td>
              <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #334155;">
                ${formatWithCommas(Math.round(g.currentRev))}
              </td>
              <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} font-weight: 700; ${revClass}">
                ${revSign}${formatWithCommas(Math.round(g.revGrowth))}
              </td>
            </tr>
          `;
        });

        const catQtyGrowth = catCurrentQty - catPriorQty;
        const catQtyGrowthPct = catPriorQty > 0 ? Math.round((catQtyGrowth / catPriorQty) * 10000) / 100 : 100;
        const catQtyClass = catQtyGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
        const catQtySign = catQtyGrowth >= 0 ? '+' : '';
        const catRevClass = catRevGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
        const catRevSign = catRevGrowth >= 0 ? '+' : '';

        tableContentHtml += `
          <tr style="background-color: #f8fafc; font-weight: 700; border-top: 1.5px solid #cbd5e1;">
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: right; color: #334155; font-size: 11px; font-weight: 700;">
              سرجمع دپارتمان ${cat.name}
            </td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #1e293b;">${formatWithCommas(Number(catPriorQty.toFixed(2)))}</td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #1e293b;">${formatWithCommas(Number(catCurrentQty.toFixed(2)))}</td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} ${catQtyClass}">
              ${catQtySign}${formatWithCommas(Number(catQtyGrowth.toFixed(2)))} (${formatWithCommas(catQtyGrowthPct)}%)
            </td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #1e293b;">${formatWithCommas(Math.round(catPriorRev))}</td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #1e293b;">${formatWithCommas(Math.round(catCurrentRev))}</td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} ${catRevClass}">
              ${catRevSign}${formatWithCommas(Math.round(catRevGrowth))}
            </td>
          </tr>
        `;
      });
    } else {
      processedComparisonList.forEach(g => {
        const growthClass = g.qtyGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
        const growthSign = g.qtyGrowth >= 0 ? '+' : '';
        const revClass = g.revGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;';
        const revSign = g.revGrowth >= 0 ? '+' : '';

        tableContentHtml += `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: right; font-weight: 700; color: #1e293b; font-size: 11px;">
              ${g.prod.name} <span style="font-size: 10px; color: #64748b; font-weight: 500;">(${g.prod.code || '-'})</span>
            </td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #334155;">
              ${formatWithCommas(g.priorQty)} <span style="font-size: 9px; color: #64748b; font-weight: 400;">${g.prod.unit}</span>
            </td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} color: #334155;">
              ${formatWithCommas(g.currentQty)} <span style="font-size: 9px; color: #64748b; font-weight: 400;">${g.prod.unit}</span>
            </td>
            <td style="padding: 9px 8px; border: 1px solid #cbd5e1; text-align: center; ${numberCellStyle} font-weight: 700; ${growthClass}">
              ${growthSign}${formatWithCommas(g.qtyGrowth)} (${formatWithCommas(g.qtyGrowthPct)}%)
            </td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #334155;">
              ${formatWithCommas(Math.round(g.priorRev))}
            </td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} color: #334155;">
              ${formatWithCommas(Math.round(g.currentRev))}
            </td>
            <td style="padding: 9px 12px; border: 1px solid #cbd5e1; text-align: left; ${numberCellStyle} font-weight: 700; ${revClass}">
              ${revSign}${formatWithCommas(Math.round(g.revGrowth))}
            </td>
          </tr>
        `;
      });
    }

    const grandQtyGrowth = processedComparisonTotals.currentQtySum - processedComparisonTotals.priorQtySum;
    const grandQtyGrowthPct = processedComparisonTotals.priorQtySum > 0 
      ? Math.round((grandQtyGrowth / processedComparisonTotals.priorQtySum) * 10000) / 100 
      : 100;

    const grandQtyClass = grandQtyGrowth >= 0 ? 'color: #4ade80;' : 'color: #f87171;';
    const grandQtySign = grandQtyGrowth >= 0 ? '+' : '';
    const grandRevClass = processedComparisonTotals.revGrowthSum >= 0 ? 'color: #4ade80;' : 'color: #f87171;';
    const grandRevSign = processedComparisonTotals.revGrowthSum >= 0 ? '+' : '';

    const grandTotalRowHtml = `
      <tr style="background-color: #0f172a; color: #ffffff; font-weight: 800; font-size: 12px; border-top: 2px solid #0f172a;">
        <td style="padding: 12px; border: 1px solid #0f172a; text-align: right; font-weight: 900;">جمع کل نهایی</td>
        <td style="padding: 12px 8px; border: 1px solid #0f172a; text-align: center; ${numberCellStyle} color: #ffffff;">${formatWithCommas(Number(processedComparisonTotals.priorQtySum.toFixed(2)))}</td>
        <td style="padding: 12px 8px; border: 1px solid #0f172a; text-align: center; ${numberCellStyle} color: #ffffff;">${formatWithCommas(Number(processedComparisonTotals.currentQtySum.toFixed(2)))}</td>
        <td style="padding: 12px 8px; border: 1px solid #0f172a; text-align: center; ${numberCellStyle} ${grandQtyClass} font-weight: 800;">
          ${grandQtySign}${formatWithCommas(Number(grandQtyGrowth.toFixed(2)))} (${formatWithCommas(grandQtyGrowthPct)}%)
        </td>
        <td style="padding: 12px; border: 1px solid #0f172a; text-align: left; ${numberCellStyle} color: #ffffff;">${formatWithCommas(Math.round(processedComparisonTotals.priorRevSum))}</td>
        <td style="padding: 12px; border: 1px solid #0f172a; text-align: left; ${numberCellStyle} color: #ffffff;">${formatWithCommas(Math.round(processedComparisonTotals.currentRevSum))}</td>
        <td style="padding: 12px; border: 1px solid #0f172a; text-align: left; ${numberCellStyle} ${grandRevClass} font-weight: 800;">
          ${grandRevSign}${formatWithCommas(Math.round(processedComparisonTotals.revGrowthSum))}
        </td>
      </tr>
    `;

    const printableHtml = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&display=swap');
        * {
          font-family: 'Vazirmatn', 'B Yekan', Tahoma, Arial, sans-serif !important;
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
          background-color: #ffffff;
          color: #0f172a;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .num-val {
          font-variant-numeric: tabular-nums;
        }
      </style>

      <div class="printable" style="direction: rtl; font-family: 'Vazirmatn', Tahoma, Arial, sans-serif; padding: 20px; color: #0f172a; background-color: #ffffff;">
        <!-- Header Container -->
        <div style="border: 2px solid #4338ca; border-radius: 16px; padding: 22px; margin-bottom: 24px; background-color: #fafafa;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 16px;">
            <div>
              <h1 style="margin: 0; color: #3730a3; font-size: 18px; font-weight: 900; letter-spacing: -0.2px;">گزارش مدیریتی و مقایسه عملکرد دوره‌ای فروش</h1>
              <p style="margin: 6px 0 0 0; color: #475569; font-size: 11px; font-weight: 500;">تحلیل رشد فروش فیزیکی و ریالی فرآورده‌های تولیدی کارگاه</p>
            </div>
            <div style="text-align: left;">
              <div style="font-size: 11px; font-weight: 700; color: #334155;">دوره مالی جاری: <span class="num-val" style="color: #4338ca; font-weight: 800;">${activePeriodName}</span></div>
              <div style="font-size: 11px; font-weight: 700; color: #334155; margin-top: 4px;">دوره مبنای مقایسه: <span class="num-val" style="color: #4338ca; font-weight: 800;">${comparedPeriodName}</span></div>
              <div style="font-size: 10px; color: #64748b; margin-top: 5px; font-weight: 500;">تاریخ تهیه گزارش: ${getTodayJalali()}</div>
            </div>
          </div>

          <!-- KPI Summary Grid -->
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 16px;">
            <div style="background-color: #ffffff; border: 1px solid #cbd5e1; padding: 12px 8px; border-radius: 12px; text-align: center;">
              <span style="font-size: 10px; color: #64748b; font-weight: 600; display: block; margin-bottom: 4px;">مجموع درآمد دوره قبل</span>
              <strong class="num-val" style="font-size: 12px; color: #0f172a; font-weight: 800;">${formatWithCommas(Math.round(processedComparisonTotals.priorRevSum))} <span style="font-size: 8px; color: #64748b; font-weight: 500;">ریال</span></strong>
            </div>
            <div style="background-color: #ffffff; border: 1px solid #cbd5e1; padding: 12px 8px; border-radius: 12px; text-align: center;">
              <span style="font-size: 10px; color: #64748b; font-weight: 600; display: block; margin-bottom: 4px;">مجموع درآمد ماه جاری</span>
              <strong class="num-val" style="font-size: 12px; color: #0f172a; font-weight: 800;">${formatWithCommas(Math.round(processedComparisonTotals.currentRevSum))} <span style="font-size: 8px; color: #64748b; font-weight: 500;">ریال</span></strong>
            </div>
            <div style="background-color: #ffffff; border: 1px solid #cbd5e1; padding: 12px 8px; border-radius: 12px; text-align: center;">
              <span style="font-size: 10px; color: #64748b; font-weight: 600; display: block; margin-bottom: 4px;">میزان ارتقای کل درآمد</span>
              <strong class="num-val" style="font-size: 12px; ${processedComparisonTotals.revGrowthSum >= 0 ? 'color: #15803d;' : 'color: #b91c1c;'} font-weight: 800;">
                ${processedComparisonTotals.revGrowthSum >= 0 ? '+' : ''}${formatWithCommas(Math.round(processedComparisonTotals.revGrowthSum))} <span style="font-size: 8px; font-weight: 500;">ریال</span>
              </strong>
            </div>
            <div style="background-color: #ffffff; border: 1px solid #cbd5e1; padding: 12px 8px; border-radius: 12px; text-align: center;">
              <span style="font-size: 10px; color: #64748b; font-weight: 600; display: block; margin-bottom: 4px;">درصد ارتقای فروش ریالی</span>
              <strong class="num-val" style="font-size: 12px; ${processedComparisonTotals.revGrowthSum >= 0 ? 'color: #15803d;' : 'color: #b91c1c;'} font-weight: 800;">
                ${processedComparisonTotals.revGrowthSum >= 0 ? '+' : ''}${processedComparisonTotals.priorRevSum > 0 ? (processedComparisonTotals.revGrowthSum / processedComparisonTotals.priorRevSum * 100).toFixed(1) : '100'}%
              </strong>
            </div>
            <div style="background-color: #ffffff; border: 1px solid #cbd5e1; padding: 12px 8px; border-radius: 12px; text-align: center;">
              <span style="font-size: 10px; color: #64748b; font-weight: 600; display: block; margin-bottom: 4px;">نسبت درصد ارتقای فروش تعدادی</span>
              <strong class="num-val" style="font-size: 12px; ${grandQtyGrowth >= 0 ? 'color: #15803d;' : 'color: #b91c1c;'} font-weight: 800;">
                ${grandQtySign}${grandQtyGrowthPct}%
              </strong>
            </div>
          </div>
        </div>

        <!-- Filter Status Bar -->
        <div style="font-size: 11px; margin-bottom: 14px; color: #334155; font-weight: 600; display: flex; justify-content: space-between; background-color: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <span>دسته‌بندی: <strong style="color: #4338ca; font-weight: 700;">${comparisonGroupByDepartment ? 'به تفکیک دپارتمان‌های تولیدی' : 'کل فرآورده‌ها (یکپارچه)'}</strong></span>
          <span>مرتب‌سازی: <strong style="color: #4338ca; font-weight: 700;">${
            comparisonSortMode === 'growth_desc' ? 'رشد فیزیکی (بیشترین به کمترین)' :
            comparisonSortMode === 'growth_asc' ? 'رشد فیزیکی (کمترین به بیشترین)' :
            comparisonSortMode === 'rev_growth_desc' ? 'ارتقای درآمد (بیشترین به کمترین)' :
            comparisonSortMode === 'rev_growth_asc' ? 'ارتقای درآمد (کمترین به بیشترین)' : 'پیش‌فرض'
          }</strong></span>
        </div>

        <!-- Comparison Table -->
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px;">
          <thead>
            <tr style="background-color: #3730a3; color: #ffffff; font-weight: 800;">
              <th style="padding: 10px 12px; border: 1px solid #312e81; text-align: right; font-weight: 800; font-size: 11px;">نام فرآورده نهایی</th>
              <th style="padding: 10px 8px; border: 1px solid #312e81; text-align: center; font-weight: 800; font-size: 11px;">مقدار فروش قبلی (${comparedPeriodName})</th>
              <th style="padding: 10px 8px; border: 1px solid #312e81; text-align: center; font-weight: 800; font-size: 11px;">مقدار فروش جدید (${activePeriodName})</th>
              <th style="padding: 10px 8px; border: 1px solid #312e81; text-align: center; font-weight: 800; font-size: 11px;">رشد فیزیکی فروش</th>
              <th style="padding: 10px 12px; border: 1px solid #312e81; text-align: left; font-weight: 800; font-size: 11px;">فروش مالی قبلی (ریال)</th>
              <th style="padding: 10px 12px; border: 1px solid #312e81; text-align: left; font-weight: 800; font-size: 11px;">فروش مالی جدید (ریال)</th>
              <th style="padding: 10px 12px; border: 1px solid #312e81; text-align: left; font-weight: 800; font-size: 11px; background-color: #312e81;">ارتقای درآمد (ریال)</th>
            </tr>
          </thead>
          <tbody>
            ${tableContentHtml}
            ${grandTotalRowHtml}
          </tbody>
        </table>

        <!-- Signatures -->
        <div style="margin-top: 50px; display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; color: #334155; border-top: 1px dashed #cbd5e1; padding-top: 20px;">
          <div style="text-align: center; width: 30%;">
            <div>تنظیم‌کننده گزارش مالی کارگاه</div>
            <div style="margin-top: 35px; border-bottom: 1px dotted #94a3b8; width: 80%; margin-x: auto;"></div>
          </div>
          <div style="text-align: center; width: 30%;">
            <div>مدیر دپارتمان حسابداری صنعتی</div>
            <div style="margin-top: 35px; border-bottom: 1px dotted #94a3b8; width: 80%; margin-x: auto;"></div>
          </div>
          <div style="text-align: center; width: 30%;">
            <div>تایید مدیریت عامل</div>
            <div style="margin-top: 35px; border-bottom: 1px dotted #94a3b8; width: 80%; margin-x: auto;"></div>
          </div>
        </div>
      </div>
    `;

    printElement('گزارش و مقایسه عملکرد دوره‌ای', printableHtml);
  };

  const printProfitLossReport = () => {
    const el = document.getElementById('sales-profit-loss-table');
    if (el) {
      printElement('گزارش سود و زیان و بررسی قیمت تمام شده محصولات', el.outerHTML);
    }
  };

  // Input states for UX inline material modifier
  const [editingItemInline, setEditingItemInline] = useState<Item | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  };

  // Dataset extraction
  const products = useMemo(() => db.products.filter(p => p.periodId === activePeriodId), [db.products, activePeriodId]);
  const rawItems = useMemo(() => db.items.filter(i => i.periodId === activePeriodId), [db.items, activePeriodId]);
  const activeRawItems = useMemo(() => rawItems.filter(i => i.isActive), [rawItems]);
  const formulas = useMemo(() => db.productFormulas.filter(f => f.periodId === activePeriodId), [db.productFormulas, activePeriodId]);
  const conversions = useMemo(() => db.unitConversions.filter(c => c.periodId === activePeriodId), [db.unitConversions, activePeriodId]);
  const sales = activeSalesRecords;

  // Aggregated sales per canonical productId for the selected month
  const salesTotalsByProductId = useMemo(() => {
    const idLookup: Record<string, string> = {};
    products.forEach(p => {
      idLookup[p.id] = p.id;
      if (p.code) idLookup[p.code.trim().toLowerCase()] = p.id;
      if (p.accountId) idLookup[p.accountId.trim().toLowerCase()] = p.id;
    });
    const map: Record<string, { qtySold: number; netSalesAmount: number }> = {};
    sales.forEach(s => {
      const resolvedId = idLookup[s.productId] || idLookup[String(s.productId || '').trim().toLowerCase()] || s.productId;
      if (!map[resolvedId]) {
        map[resolvedId] = { qtySold: 0, netSalesAmount: 0 };
      }
      map[resolvedId].qtySold += Number(s.qtySold || 0);
      map[resolvedId].netSalesAmount += Number(s.netSalesAmount || 0);
    });
    return map;
  }, [sales, products]);

  // Overhead / Expenses strictly for the selected month (with default-month legacy fallback)
  const overhead = useMemo(() => {
    const exactMatch = (db.periodOverheads || []).find(
      o => o.periodId === activePeriodId &&
        Number(toEnglishDigits(String(o.month ?? ''))) === Number(selectedCogsMonth) &&
        Number(toEnglishDigits(String(o.year ?? ''))) === Number(selectedCogsYear)
    );
    if (exactMatch) return exactMatch;
    if (
      Number(selectedCogsMonth) === Number(defaultPeriodMonthYear.defaultMonth) &&
      Number(selectedCogsYear) === Number(defaultPeriodMonthYear.defaultYear)
    ) {
      return (db.periodOverheads || []).find(o => o.periodId === activePeriodId && o.month === undefined);
    }
    return undefined;
  }, [db.periodOverheads, activePeriodId, selectedCogsMonth, selectedCogsYear, defaultPeriodMonthYear]);

  // Helper: map month/year -> matching registered PayrollPeriod IDs in activePeriodId
  const payrollPeriodIdsByYearMonth = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    (db.payrollPeriods || []).forEach(pp => {
      if (pp.periodId !== activePeriodId) return;
      let y = pp.year !== undefined ? Number(toEnglishDigits(String(pp.year))) : NaN;
      let m = pp.month !== undefined ? Number(toEnglishDigits(String(pp.month))) : NaN;
      if ((isNaN(y) || isNaN(m)) && pp.dateRange) {
        const match = toEnglishDigits(pp.dateRange).match(/(1[34]\d{2})\/(\d{1,2})\//);
        if (match) {
          y = parseInt(match[1], 10);
          m = parseInt(match[2], 10);
        }
      }
      if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
        const key = `${y}-${m}`;
        if (!map[key]) map[key] = new Set<string>();
        if (pp.id) map[key].add(pp.id);
      }
    });
    return map;
  }, [db.payrollPeriods, activePeriodId]);

  // Monthly Payroll items strictly for the selected month (with default-month legacy fallback)
  const payrollItems = useMemo(() => {
    const targetPayrollPeriodId = `pp-${activePeriodId}-${selectedCogsYear}-${String(selectedCogsMonth).padStart(2, '0')}`;
    const registeredIds = payrollPeriodIdsByYearMonth[`${selectedCogsYear}-${selectedCogsMonth}`];
    const exactMonthItems = (db.payrollItems || []).filter(p => {
      if (p.periodId !== activePeriodId) return false;
      if (p.payrollPeriodId === targetPayrollPeriodId) return true;
      if (p.payrollPeriodId && registeredIds && registeredIds.has(p.payrollPeriodId)) return true;
      if (p.month !== undefined && p.year !== undefined) {
        return Number(toEnglishDigits(String(p.year))) === Number(selectedCogsYear) &&
               Number(toEnglishDigits(String(p.month))) === Number(selectedCogsMonth);
      }
      return false;
    });
    if (exactMonthItems.length > 0) return exactMonthItems;

    if (
      Number(selectedCogsMonth) === Number(defaultPeriodMonthYear.defaultMonth) &&
      Number(selectedCogsYear) === Number(defaultPeriodMonthYear.defaultYear)
    ) {
      return (db.payrollItems || []).filter(
        p => p.periodId === activePeriodId && p.month === undefined && p.year === undefined && !p.id?.startsWith('pay-settled-')
      );
    }
    return [];
  }, [db.payrollItems, activePeriodId, selectedCogsMonth, selectedCogsYear, defaultPeriodMonthYear, payrollPeriodIdsByYearMonth]);

  // Monthly readiness overview for the 12-month selector grid
  const monthlyCogsReadinessStats = useMemo(() => {
    const stats: Record<number, {
      salesCount: number;
      netSales: number;
      payrollCount: number;
      payrollCost: number;
      hasOverhead: boolean;
      overheadNet: number;
    }> = {};
    for (let m = 1; m <= 12; m++) {
      stats[m] = { salesCount: 0, netSales: 0, payrollCount: 0, payrollCost: 0, hasOverhead: false, overheadNet: 0 };
    }

    (db.productSales || []).forEach(s => {
      if (s.periodId !== activePeriodId) return;
      const m = s.month !== undefined ? Number(s.month) : defaultPeriodMonthYear.defaultMonth;
      const y = s.year !== undefined ? Number(s.year) : defaultPeriodMonthYear.defaultYear;
      if (y === selectedCogsYear && m >= 1 && m <= 12) {
        stats[m].salesCount += 1;
        stats[m].netSales += Number(s.netSalesAmount || 0);
      }
    });

    for (let m = 1; m <= 12; m++) {
      const ppId = `pp-${activePeriodId}-${selectedCogsYear}-${String(m).padStart(2, '0')}`;
      const regIds = payrollPeriodIdsByYearMonth[`${selectedCogsYear}-${m}`];
      const mPayItems = (db.payrollItems || []).filter(p => {
        if (p.periodId !== activePeriodId) return false;
        if (p.payrollPeriodId === ppId) return true;
        if (p.payrollPeriodId && regIds && regIds.has(p.payrollPeriodId)) return true;
        if (p.month !== undefined && p.year !== undefined) {
          return Number(toEnglishDigits(String(p.year))) === selectedCogsYear &&
                 Number(toEnglishDigits(String(p.month))) === m;
        }
        return m === defaultPeriodMonthYear.defaultMonth && selectedCogsYear === defaultPeriodMonthYear.defaultYear && !p.id?.startsWith('pay-settled-');
      });
      stats[m].payrollCount = mPayItems.length;
      stats[m].payrollCost = mPayItems.reduce((acc, pi) => acc + getPayrollItemTotalCost(pi), 0);

      const mOvh = (db.periodOverheads || []).find(
        o => o.periodId === activePeriodId &&
          Number(toEnglishDigits(String(o.month ?? ''))) === m &&
          Number(toEnglishDigits(String(o.year ?? ''))) === selectedCogsYear
      ) || (m === defaultPeriodMonthYear.defaultMonth && selectedCogsYear === defaultPeriodMonthYear.defaultYear
        ? (db.periodOverheads || []).find(o => o.periodId === activePeriodId && o.month === undefined)
        : undefined);
      if (mOvh) {
        stats[m].hasOverhead = true;
        stats[m].overheadNet = (mOvh.operational + mOvh.distributionSales + mOvh.administrative + mOvh.financial) - mOvh.returnsOfExpense;
      }
    }

    return stats;
  }, [db.productSales, db.payrollItems, db.periodOverheads, activePeriodId, selectedCogsYear, defaultPeriodMonthYear, payrollPeriodIdsByYearMonth]);

  const allocations = useMemo(() => (db.personnelAllocations || []).filter(a => a.periodId === activePeriodId), [db.personnelAllocations, activePeriodId]);

  const allocationLookupByEmpCode = useMemo(() => {
    const activeExactMap = new Map<string, PersonnelAllocation>();
    const activeStrippedMap = new Map<string, PersonnelAllocation>();
    const fallbackExactMap = new Map<string, PersonnelAllocation>();
    const fallbackStrippedMap = new Map<string, PersonnelAllocation>();

    const isDirectAllocEntry = (a?: PersonnelAllocation): boolean => {
      if (!a || !a.departmentCategoryId || isSharedDeptId(a.departmentCategoryId)) return false;
      const canon = resolveCanonicalCategoryId(a.departmentCategoryId);
      return departments.some(d => !isSharedDeptId(d.id) && d.id === canon);
    };

    const allocPriorityScore = (a: PersonnelAllocation): number => {
      if (isDirectAllocEntry(a)) return 3;
      if (a.departmentCategoryId && !isSharedDeptId(a.departmentCategoryId)) return 2;
      return 1;
    };

    const putBest = (map: Map<string, PersonnelAllocation>, key: string, alloc: PersonnelAllocation) => {
      if (!key) return;
      const existing = map.get(key);
      if (!existing || allocPriorityScore(alloc) >= allocPriorityScore(existing)) {
        map.set(key, alloc);
      }
    };

    allocations.forEach(a => {
      const c = normalizeEmpCode(a.employeeCode);
      if (!c) return;
      putBest(activeExactMap, c, a);
      putBest(activeStrippedMap, stripZeroEmpCode(c), a);
    });

    // Strictly isolated to active period (no cross-period allocation or personnel fallback)
    const personByAnyCode = new Map<string, any>();
    (db.personnel || [])
      .filter(p => p.periodId === activePeriodId)
      .forEach(p => {
        [p.employeeCode, p.attendanceCode, p.accountCode, p.id].forEach(codeCandidate => {
          const c = normalizeEmpCode(codeCandidate);
          if (!c) return;
          personByAnyCode.set(c, p);
          personByAnyCode.set(stripZeroEmpCode(c), p);
        });
      });

    // Shift assignment -> production section -> departmentCategoryId fallback (active period only)
    const sectionDeptById = new Map<string, string>();
    (db.productionSections || [])
      .filter(sec => sec.periodId === activePeriodId)
      .forEach(sec => {
        if (sec?.id && sec.departmentCategoryId && !isSharedDeptId(sec.departmentCategoryId)) {
          sectionDeptById.set(sec.id, sec.departmentCategoryId);
        }
      });
    const sectionAllocByEmpCode = new Map<string, PersonnelAllocation>();
    (db.shiftAssignments || []).forEach(sa => {
      if (sa.periodId !== activePeriodId) return;
      if (sa.year !== undefined && sa.month !== undefined) {
        if (Number(sa.year) !== Number(selectedCogsYear) || Number(sa.month) !== Number(selectedCogsMonth)) return;
      }
      const deptId = sa.deptId ? sectionDeptById.get(sa.deptId) : undefined;
      if (!deptId) return;
      const c = normalizeEmpCode(sa.employeeCode);
      if (!c) return;
      const synthetic: PersonnelAllocation = {
        id: `sec-alloc-${c}`,
        periodId: activePeriodId,
        employeeCode: c,
        departmentCategoryId: deptId
      };
      sectionAllocByEmpCode.set(c, synthetic);
      sectionAllocByEmpCode.set(stripZeroEmpCode(c), synthetic);
    });

    const lookupInMaps = (code: any, exact: Map<string, PersonnelAllocation>, stripped: Map<string, PersonnelAllocation>) => {
      const c = normalizeEmpCode(code);
      if (!c) return undefined;
      return exact.get(c) || stripped.get(stripZeroEmpCode(c));
    };

    const get = (empCode: any): PersonnelAllocation | undefined => {
      const c = normalizeEmpCode(empCode);
      if (!c) return undefined;
      const matchedPerson = personByAnyCode.get(c) || personByAnyCode.get(stripZeroEmpCode(c));
      const candidateCodes = matchedPerson
        ? [c, matchedPerson.employeeCode, matchedPerson.attendanceCode, matchedPerson.accountCode, matchedPerson.id]
        : [c];

      let activeSharedFallback: PersonnelAllocation | undefined = undefined;
      for (const cand of candidateCodes) {
        const hit = lookupInMaps(cand, activeExactMap, activeStrippedMap);
        if (hit) {
          if (isDirectAllocEntry(hit)) return hit;
          if (!activeSharedFallback) activeSharedFallback = hit;
        }
      }
      for (const cand of candidateCodes) {
        const hit = lookupInMaps(cand, sectionAllocByEmpCode, sectionAllocByEmpCode);
        if (hit && isDirectAllocEntry(hit)) return hit;
      }
      for (const cand of candidateCodes) {
        const hit = lookupInMaps(cand, fallbackExactMap, fallbackStrippedMap);
        if (hit && isDirectAllocEntry(hit)) return hit;
      }
      if (activeSharedFallback) return activeSharedFallback;
      for (const cand of candidateCodes) {
        const hit = lookupInMaps(cand, fallbackExactMap, fallbackStrippedMap);
        if (hit) return hit;
      }
      for (const cand of candidateCodes) {
        const hit = lookupInMaps(cand, sectionAllocByEmpCode, sectionAllocByEmpCode);
        if (hit) return hit;
      }
      return undefined;
    };

    return { get };
  }, [allocations, db.personnelAllocations, db.personnel, db.productionSections, db.shiftAssignments, activePeriodId, selectedCogsYear, selectedCogsMonth, departments, isSharedDeptId, resolveCanonicalCategoryId]);

  const isDirectDeptAllocation = React.useCallback((alloc?: PersonnelAllocation): boolean => {
    if (!alloc || !alloc.departmentCategoryId || isSharedDeptId(alloc.departmentCategoryId)) return false;
    const canon = resolveCanonicalCategoryId(alloc.departmentCategoryId);
    return departments.some(dept => !isSharedDeptId(dept.id) && dept.id === canon);
  }, [isSharedDeptId, departments, resolveCanonicalCategoryId]);

  // Timeline Segments
  const periodSegments = useMemo(() => db.dailyProductionSegments?.filter(s => s.periodId === activePeriodId) || [], [db.dailyProductionSegments, activePeriodId]);

  // Time conversion helper
  const parseTimeToMinutes = (t: string): number => {
    if (!t) return 0;
    const parts = t.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  };

  // 1. Calculate time coefficients (minutes spent per unit)
  const timeCoefficents = useMemo(() => {
    const coeffs: Record<string, number> = {};
    const accumMinutes: Record<string, number> = {};
    const accumProduced: Record<string, number> = {};

    periodSegments.forEach(seg => {
      const minutes = Math.max(0, parseTimeToMinutes(seg.endTime) - parseTimeToMinutes(seg.startTime));
      accumMinutes[seg.productId] = (accumMinutes[seg.productId] || 0) + minutes;
      accumProduced[seg.productId] = (accumProduced[seg.productId] || 0) + (seg.producedQty || 0);
    });

    products.forEach(p => {
      const minutes = accumMinutes[p.id] || 0;
      const qty = accumProduced[p.id] || 0;
      coeffs[p.id] = qty > 0 ? (minutes / qty) : 0;
    });

    return coeffs;
  }, [periodSegments, products]);

  // Fast mapping of raw items (priority: accountId > id > code)
  const rawItemMap = useMemo(() => {
    const map: Record<string, Item> = {};
    rawItems.forEach(i => {
      if (i.code) {
        const c = normalizeAccountingCode(i.code);
        if (c) {
          map[c] = i;
          map[c.toLowerCase()] = i;
        }
        map[i.code.trim()] = i;
      }
    });
    rawItems.forEach(i => {
      map[i.id] = i;
    });
    rawItems.forEach(i => {
      if (i.accountId) {
        const acc = normalizeAccountingCode(i.accountId);
        if (acc) {
          map[acc] = i;
          map[acc.toLowerCase()] = i;
        }
        map[i.accountId.trim()] = i;
      }
    });
    return map;
  }, [rawItems]);

  const productMap = useMemo(() => {
    const map: Record<string, Product> = {};
    products.forEach(p => {
      if (p.code) {
        const c = normalizeAccountingCode(p.code);
        if (c) {
          map[c] = p;
          map[c.toLowerCase()] = p;
        }
        map[p.code.trim()] = p;
      }
    });
    products.forEach(p => {
      map[p.id] = p;
    });
    products.forEach(p => {
      if (p.accountId) {
        const acc = normalizeAccountingCode(p.accountId);
        if (acc) {
          map[acc] = p;
          map[acc.toLowerCase()] = p;
        }
        map[p.accountId.trim()] = p;
      }
    });
    return map;
  }, [products]);

  const resolveProductByFormulaKey = React.useCallback((formulaProdKey: string): Product | undefined => {
    if (!formulaProdKey) return undefined;
    const norm = normalizeAccountingCode(formulaProdKey);
    return (
      (norm ? products.find(p => p.accountId && normalizeAccountingCode(p.accountId) === norm) : undefined) ||
      products.find(p => p.id === formulaProdKey) ||
      (norm ? products.find(p => p.code && normalizeAccountingCode(p.code) === norm) : undefined)
    );
  }, [products]);

  const resolveMaterialByKey = React.useCallback((matKey: string): { item?: Item; wip?: Product; isWip: boolean } => {
    if (!matKey) return { isWip: false };
    const norm = normalizeAccountingCode(matKey);
    const itemByAcc = norm ? rawItems.find(i => i.accountId && normalizeAccountingCode(i.accountId) === norm) : undefined;
    if (itemByAcc) return { item: itemByAcc, isWip: false };
    const wipByAcc = norm ? products.find(p => p.isWip && p.accountId && normalizeAccountingCode(p.accountId) === norm) : undefined;
    if (wipByAcc) return { wip: wipByAcc, isWip: true };

    const itemById = rawItems.find(i => i.id === matKey);
    if (itemById) return { item: itemById, isWip: false };
    const wipById = products.find(p => p.isWip && p.id === matKey);
    if (wipById) return { wip: wipById, isWip: true };

    const itemByCode = norm ? rawItems.find(i => i.code && normalizeAccountingCode(i.code) === norm) : undefined;
    if (itemByCode) return { item: itemByCode, isWip: false };
    const wipByCode = norm ? products.find(p => p.isWip && p.code && normalizeAccountingCode(p.code) === norm) : undefined;
    if (wipByCode) return { wip: wipByCode, isWip: true };

    return { isWip: false };
  }, [rawItems, products]);

  const findMaterialConversion = React.useCallback((matKey: string, resolvedItem?: Item | null): UnitConversion | undefined => {
    const normKey = normalizeAccountingCode(matKey);
    const itemId = resolvedItem?.id;
    const itemAcc = resolvedItem?.accountId ? normalizeAccountingCode(resolvedItem.accountId) : '';
    return conversions.find(c => {
      if (!c.rawMaterialId) return false;
      const convNorm = normalizeAccountingCode(c.rawMaterialId);
      if (matKey && (c.rawMaterialId === matKey || (normKey && convNorm === normKey))) return true;
      if (itemId && c.rawMaterialId === itemId) return true;
      if (itemAcc && convNorm === itemAcc) return true;
      return false;
    });
  }, [conversions]);

  // Validation: If sales are registered
  const isSalesRegistered = useMemo(() => sales.length > 0, [sales]);

  // Total sales volume & net value metrics
  const totalSalesVolumeAndValue = useMemo(() => {
    let qtyTot = 0;
    let netTot = 0;
    sales.forEach(s => {
      qtyTot += s.qtySold;
      netTot += s.netSalesAmount;
    });
    return { qtyTot, netTot };
  }, [sales]);

  // Formula products tabs settings
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [formulaSearchQuery, setFormulaSearchQuery] = useState('');
  const [formulaFilter, setFormulaFilter] = useState<'all' | 'has_formula' | 'no_formula' | 'purchased'>('all');
  const [formulaCategoryFilter, setFormulaCategoryFilter] = useState<string>('all');

  // Timeline Scheduler States
  const [timelineProductId, setTimelineProductId] = useState('');
  const [timelineDuration, setTimelineDuration] = useState(0);
  const [timelineProducedQty, setTimelineProducedQty] = useState(0);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [liveSearchQuery, setLiveSearchQuery] = useState('');
  const [onlyOperational, setOnlyOperational] = useState(false);
  const [timelineSearchQuery, setTimelineSearchQuery] = useState('');

  const filteredPeriodSegments = useMemo(() => {
    if (!timelineSearchQuery) return periodSegments;
    return periodSegments.filter(seg => {
      const prod = products.find(p => p.id === seg.productId);
      if (!prod) return false;
      return matchPersianString(prod.name, timelineSearchQuery) || matchPersianString(prod.code, timelineSearchQuery);
    });
  }, [periodSegments, products, timelineSearchQuery]);

  const searchedLiveProducts = useMemo(() => {
    let list = products;
    if (onlyOperational) {
      list = products.filter(p => (timeCoefficents[p.id] || 0) > 0);
    }
    if (!liveSearchQuery) return list;
    return list.filter(p => matchPersianString(p.name, liveSearchQuery) || matchPersianString(p.code, liveSearchQuery));
  }, [products, liveSearchQuery, onlyOperational, timeCoefficents]);

  // Formula Items constructor draft states
  const [draftMaterialId, setDraftMaterialId] = useState('');
  const [draftMaterialQty, setDraftMaterialQty] = useState(0);
  const [copySourceProductId, setCopySourceProductId] = useState('');

  React.useEffect(() => {
    setCopySourceProductId('');
    setIsEditingWeight(false);
    setTempWeight('');
  }, [selectedProductId]);

  React.useEffect(() => {
    setFormulaCategoryFilter('all');
    setAnalyticsCategoryFilter('all');
    setComparisonCategoryFilter('all');
    setSelectedAllocationCatId('all');
  }, [activePeriodId]);

  React.useEffect(() => {
    if (products.length > 0) {
      if (!selectedProductId || !products.some(p => p.id === selectedProductId)) {
        setSelectedProductId(products[0].id);
      }
    } else {
      setSelectedProductId('');
    }
  }, [products, selectedProductId]);

  const selectedProductData = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  const selectedProductFormulaKey = useMemo(() => {
    return selectedProductData ? getProductFormulaKey(selectedProductData) : selectedProductId;
  }, [selectedProductData, selectedProductId]);

  // Multiple Formulas states
  const [selectedFormulaId, setSelectedFormulaId] = useState<string | null>(null);
  const [isCreatingFormula, setIsCreatingFormula] = useState(false);
  const [newFormulaName, setNewFormulaName] = useState('');
  const [cloneCurrentFormula, setCloneCurrentFormula] = useState(true);
  const [editingFormulaId, setEditingFormulaId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [isEditingWeight, setIsEditingWeight] = useState(false);
  const [tempWeight, setTempWeight] = useState('');

  // Batch workshop calculator states
  const [showBatchCalculator, setShowBatchCalculator] = useState(false);
  const [batchOutputWeight, setBatchOutputWeight] = useState<number | ''>('');
  const [batchWastagePercent, setBatchWastagePercent] = useState<number | ''>('');
  const [batchIngredients, setBatchIngredients] = useState<{ rawMaterialId: string; quantity: number }[]>([]);
  const [batchDraftMaterialId, setBatchDraftMaterialId] = useState('');
  const [batchDraftQty, setBatchDraftQty] = useState<number | ''>('');
  const [isEditingBatchTargetWeight, setIsEditingBatchTargetWeight] = useState(false);
  const [tempBatchTargetWeight, setTempBatchTargetWeight] = useState('');
  const [batchSearchQuery, setBatchSearchQuery] = useState('');
  const [editingBatchMatId, setEditingBatchMatId] = useState<string | null>(null);
  const [editingBatchMatSelectedId, setEditingBatchMatSelectedId] = useState<string>('');
  const [editingBatchMatQty, setEditingBatchMatQty] = useState<number | ''>('');

  // WIP (Semi-finished) Products definition states
  const [wipCode, setWipCode] = useState('');
  const [wipAccountId, setWipAccountId] = useState('');
  const [wipName, setWipName] = useState('');
  const [wipCategoryId, setWipCategoryId] = useState('');
  const [wipUnit, setWipUnit] = useState<'عدد' | 'کیلو'>('کیلو');
  const [wipWeight, setWipWeight] = useState<number | ''>('');
  const [wipPackageType, setWipPackageType] = useState<'سلفون' | 'شیرینک' | 'لانچ باکس' | 'جعبه'>('سلفون');
  const [wipBarcode, setWipBarcode] = useState('');
  const [wipQtyPerPackage, setWipQtyPerPackage] = useState<number>(1);
  const [wipWeightPerPackage, setWipWeightPerPackage] = useState<number>(1);
  const [wipEditingId, setWipEditingId] = useState<string | null>(null);

  React.useEffect(() => {
    if (!wipEditingId) {
      setWipCategoryId(prev => {
        if (prev && productCategories.some(c => c.id === prev)) return prev;
        return productCategories.find(c => !isSharedDeptId(c.id))?.id || productCategories[0]?.id || '';
      });
    }
  }, [productCategories, activePeriodId, wipEditingId, isSharedDeptId]);

  const handleSaveWipProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wipCode || !wipName) {
      alert('لطفا کد و نام کالای در جریان ساخت را تکمیل فرمایید.');
      return;
    }

    const weightNum = wipWeight === '' ? 1000 : Number(wipWeight);
    const defaultWipCatId = productCategories.find(c => !isSharedDeptId(c.id))?.id || productCategories[0]?.id || '';
    const resolvedWipCatId = (wipCategoryId && productCategories.some(c => c.id === wipCategoryId)) ? wipCategoryId : defaultWipCatId;

    const wipId = wipEditingId || nextSimpleId(db.products, 'prod');
    const wipData: Product = {
      id: wipId,
      periodId: activePeriodId,
      code: wipCode.trim(),
      accountId: wipAccountId.trim(),
      name: wipName.trim(),
      categoryId: resolvedWipCatId,
      unit: wipUnit,
      barcode: wipBarcode.trim() || wipId,
      packageType: wipPackageType,
      qtyPerPackage: wipQtyPerPackage || 1,
      weightPerPackage: wipWeightPerPackage || 1,
      salePrice: 0,
      cogsPrice: 0,
      weight: weightNum,
      isWip: true
    };

    let updatedProducts = [...db.products];
    let updatedFormulas = db.productFormulas;
    if (wipEditingId) {
      const oldWip = db.products.find(p => p.id === wipEditingId);
      updatedProducts = updatedProducts.map(p => p.id === wipEditingId ? wipData : p);
      if (oldWip) {
        const oldKey = getProductFormulaKey(oldWip);
        const newKey = getProductFormulaKey(wipData);
        if (oldKey && newKey && oldKey !== newKey && Array.isArray(db.productFormulas)) {
          updatedFormulas = db.productFormulas.map(f => {
            if (f.periodId && f.periodId !== activePeriodId) return f;
            let changed = false;
            let nextProductId = f.productId;
            if (doesFormulaMatchProduct(f.productId, oldWip)) {
              nextProductId = newKey;
              changed = true;
            }
            const nextIngredients = (f.ingredients || []).map(ing => {
              if (doesIngredientMatchMaterial(ing.rawMaterialId, oldWip)) {
                changed = true;
                return { ...ing, rawMaterialId: newKey };
              }
              return ing;
            });
            return changed ? { ...f, productId: nextProductId, ingredients: nextIngredients } : f;
          });
        }
      }
      alert('کالای در جریان ساخت با موفقیت ویرایش شد.');
    } else {
      updatedProducts.push(wipData);
      alert('کالای در جریان ساخت جدید با موفقیت ثبت شد.');
    }

    onUpdateDb({
      ...db,
      products: updatedProducts,
      productFormulas: updatedFormulas
    });

    // Reset Form
    setWipCode('');
    setWipAccountId('');
    setWipName('');
    setWipCategoryId(defaultWipCatId);
    setWipUnit('کیلو');
    setWipWeight('');
    setWipPackageType('سلفون');
    setWipBarcode('');
    setWipQtyPerPackage(1);
    setWipWeightPerPackage(1);
    setWipEditingId(null);
  };

  const handleEditWipProduct = (p: Product) => {
    setWipEditingId(p.id);
    setWipCode(p.code);
    setWipAccountId(p.accountId || '');
    setWipName(p.name);
    setWipCategoryId(p.categoryId);
    setWipUnit(p.unit);
    setWipWeight(p.weight || '');
    setWipPackageType(p.packageType || 'سلفون');
    setWipBarcode(p.barcode || '');
    setWipQtyPerPackage(p.qtyPerPackage || 1);
    setWipWeightPerPackage(p.weightPerPackage || 1);
    
    // Smooth scroll to form
    const element = document.getElementById('wip-form-anchor');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleDeleteWipProduct = (id: string) => {
    if (!window.confirm('آیا از حذف این کالای در جریان ساخت اطمینان دارید؟ ارتباط فرمولاسیون بر اساس کد حسابداری محفوظ خواهد ماند تا در صورت ثبت مجدد بازیابی شود.')) {
      return;
    }

    const updatedProducts = db.products.filter(p => p.id !== id);

    onUpdateDb({
      ...db,
      products: updatedProducts
    });

    alert('کالای در جریان ساخت حذف گردید.');
  };

  const exportWipToCSV = () => {
    const headers = [
      'کد کالا',
      'نام کالا',
      'کد حسابداری',
      'دپارتمان',
      'واحد سنجش (عدد یا کیلو)',
      'وزن مبنا (گرم)',
      'نوع بسته‌بندی (سلفون/شیرینک/لانچ باکس/جعبه)',
      'بارکد'
    ];

    const wipProducts = db.products.filter(p => p.isWip && p.periodId === activePeriodId);
    const rows = wipProducts.map(p => {
      const categoryName = productCategories.find(c => c.id === p.categoryId)?.name || '';
      return [
        p.code || '',
        p.name || '',
        p.accountId || '',
        categoryName,
        p.unit || 'کیلو',
        (p.weight || 1000).toString(),
        p.packageType || 'سلفون',
        p.barcode || ''
      ];
    });

    if (rows.length === 0) {
      const sampleRows = [
        ['WIP-101', 'سس مخصوص سیر کارگاهی', '14020101', 'آشپزخانه گرم', 'کیلو', '1000', 'سلفون', 'wip-101'],
        ['WIP-102', 'نان برگر دست‌ساز کنجدی', '14020102', 'نانوایی', 'عدد', '80', 'شیرینک', 'wip-102']
      ];
      downloadCSV('Gatan_Wip_Products_Template', headers, sampleRows);
    } else {
      downloadCSV('Gatan_Wip_Products', headers, rows);
    }
  };

  const handleImportWipCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) {
          alert('فایل یا خوانده نشد یا فاقد داده است.');
          return;
        }

        const text = decodeFileBuffer(buffer);
        const rows = parseCSVText(text);
        if (rows.length <= 1) {
          alert('داده‌های معتبری یافت نشد.');
          return;
        }

        let loadedRowsCount = 0;
        let skippedRowsCount = 0;

        const updatedProducts = [...db.products];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2) {
            skippedRowsCount++;
            continue;
          }

          const code = row[0].trim();
          const name = row[1].trim();
          if (!code || !name) {
            skippedRowsCount++;
            continue;
          }

          const accountId = row[2] ? row[2].trim() : '';
          const deptName = row[3] ? row[3].trim() : '';
          let unitRaw = row[4] ? row[4].trim() : 'کیلو';
          let unit: 'عدد' | 'کیلو' = 'کیلو';
          if (unitRaw === 'عدد' || unitRaw.includes('number')) {
            unit = 'عدد';
          }

          const weight = row[5] ? parseNumber(row[5]) : 1000;
          let pkgType: 'سلفون' | 'شیرینک' | 'لانچ باکس' | 'جعبه' = 'سلفون';
          const pkgRaw = row[6] ? row[6].trim() : 'سلفون';
          if (['سلفون', 'شیرینک', 'لانچ باکس', 'جعبه'].includes(pkgRaw)) {
            pkgType = pkgRaw as any;
          }

          // Find department ID by name (strictly active period)
          let categoryId = productCategories[0]?.id || '';
          if (deptName) {
            const matchedCat = productCategories.find(c => matchPersianString(c.name, deptName));
            if (matchedCat) {
              categoryId = matchedCat.id;
            }
          }

          // Check if product with this code already exists as a WIP in the active period
          const existingIdx = updatedProducts.findIndex(p => p.isWip && p.periodId === activePeriodId && p.code.toLowerCase() === code.toLowerCase());
          const nextId = existingIdx !== -1 ? updatedProducts[existingIdx].id : nextSimpleId(updatedProducts, 'prod');
          const barcode = row[7] ? row[7].trim() : nextId;

          const wipData: Product = {
            id: nextId,
            periodId: activePeriodId,
            code,
            accountId,
            name,
            categoryId,
            unit,
            barcode,
            packageType: pkgType,
            qtyPerPackage: 1,
            weightPerPackage: 1,
            salePrice: 0,
            cogsPrice: 0,
            weight: weight || 1000,
            isWip: true
          };

          if (existingIdx !== -1) {
            updatedProducts[existingIdx] = wipData;
          } else {
            updatedProducts.push(wipData);
          }
          loadedRowsCount++;
        }

        onUpdateDb({
          ...db,
          products: updatedProducts
        });

        alert(`عملیات واردسازی با موفقیت انجام شد:\nتعداد ${toPersianDigits(loadedRowsCount)} ردیف کالای نیمه‌ساخته بارگذاری یا به‌روزرسانی شد.\nتعداد ${toPersianDigits(skippedRowsCount)} ردیف نادیده گرفته شد.`);
      } catch (err: any) {
        alert('خطا در پردازش فایل: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleLoadIngredientsFromActive = () => {
    if (!activeFormulaData || activeFormulaData.ingredients.length === 0) {
      alert('فرمولاسیون فعلی کالا فاقد ماده اولیه ثبت شده است.');
      return;
    }
    const mapped = activeFormulaData.ingredients.map(item => {
      const resolved = resolveMaterialByKey(item.rawMaterialId);
      const ent = resolved.item || resolved.wip;
      return {
        rawMaterialId: ent ? getMaterialFormulaKey(ent) : item.rawMaterialId,
        quantity: item.quantity
      };
    });
    setBatchIngredients(mapped);
    alert(`تعداد ${toPersianDigits(mapped.length)} ماده اولیه از فرمول پیش‌فرض بارگذاری شد.`);
  };

  const handleAddBatchIngredient = () => {
    if (!batchDraftMaterialId) {
      alert('لطفا ابتدا کالا یا ماده مصرفی را انتخاب فرمایید.');
      return;
    }
    const parsedQty = Number(batchDraftQty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      alert('مقدار مصرفی در بچ باید بزرگتر از صفر باشد.');
      return;
    }

    setBatchIngredients(prev => {
      const existingIdx = prev.findIndex(item => item.rawMaterialId === batchDraftMaterialId);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx].quantity = parsedQty;
        return copy;
      } else {
        return [...prev, { rawMaterialId: batchDraftMaterialId, quantity: parsedQty }];
      }
    });

    setBatchDraftMaterialId('');
    setBatchDraftQty('');
  };

  const handleRemoveBatchIngredient = (rawMatId: string) => {
    setBatchIngredients(prev => prev.filter(item => item.rawMaterialId !== rawMatId));
    if (editingBatchMatId === rawMatId) {
      setEditingBatchMatId(null);
      setEditingBatchMatQty('');
    }
  };

  const handleStartInlineEditBatch = (rawMatId: string, currentQty: number) => {
    setEditingBatchMatId(rawMatId);
    setEditingBatchMatSelectedId(rawMatId);
    setEditingBatchMatQty(currentQty);
  };

  const handleSaveInlineEditBatch = (originalRawMatId: string) => {
    const parsedQty = Number(editingBatchMatQty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      alert('مقدار مصرفی در بچ باید بزرگتر از صفر باشد.');
      return;
    }
    if (!editingBatchMatSelectedId) {
      alert('لطفاً کالا یا ماده مصرفی مناسب را انتخاب کنید.');
      return;
    }

    // Check duplication if they changed the material ID
    if (editingBatchMatSelectedId !== originalRawMatId) {
      const alreadyExists = batchIngredients.some(item => item.rawMaterialId === editingBatchMatSelectedId);
      if (alreadyExists) {
        alert('این کالا قبلاً در لیست مواد مصرفی بچ ثبت شده است.');
        return;
      }
    }

    setBatchIngredients(prev =>
      prev.map(item =>
        item.rawMaterialId === originalRawMatId 
          ? { rawMaterialId: editingBatchMatSelectedId, quantity: parsedQty } 
          : item
      )
    );
    setEditingBatchMatId(null);
    setEditingBatchMatQty('');
    setEditingBatchMatSelectedId('');
  };

  const handleCancelInlineEditBatch = () => {
    setEditingBatchMatId(null);
    setEditingBatchMatQty('');
    setEditingBatchMatSelectedId('');
  };

  const handleApplyBatchToFormula = () => {
    if (!selectedProductId) return;
    if (batchIngredients.length === 0) {
      alert('لطفا حداقل یک ماده مصرفی در بخش محاسبه بچ وارد کنید.');
      return;
    }
    
    const targetW = selectedProductData?.weight || 1000;
    const batchOutW = Number(batchOutputWeight) || targetW;
    const wastageP = Number(batchWastagePercent) || 0;

    const finalIngredients = batchIngredients.map(item => {
      const ratio = item.quantity / batchOutW; 
      const baseQty = ratio * targetW;
      const quantityWithWastage = baseQty * (1 + wastageP / 100);
      const resolved = resolveMaterialByKey(item.rawMaterialId);
      const ent = resolved.item || resolved.wip;
      return {
        rawMaterialId: ent ? getMaterialFormulaKey(ent) : (normalizeAccountingCode(item.rawMaterialId) || item.rawMaterialId),
        quantity: Number(quantityWithWastage.toFixed(4))
      };
    });

    let updatedFormulas = [...db.productFormulas];
    const matchedRecipeObj = activeFormulaData;

    if (matchedRecipeObj) {
      updatedFormulas = updatedFormulas.map(f => f.id === matchedRecipeObj.id ? { ...f, productId: selectedProductFormulaKey, ingredients: finalIngredients } : f);
    } else {
      updatedFormulas.push({
        id: nextSimpleId(updatedFormulas, 'form'),
        periodId: activePeriodId,
        productId: selectedProductFormulaKey,
        ingredients: finalIngredients,
        name: 'فرمول بچ محاسباتی',
        isActive: true
      });
    }

    onUpdateDb({ ...db, productFormulas: updatedFormulas });
    alert('فرمولاسیون کارگاهی با موفقیت کالیبره و در دستور ساخت کالای جاری ثبت شد.');
    setShowBatchCalculator(false);
  };

  const productFormulas = useMemo(() => {
    if (!selectedProductData) return [];
    return formulas.filter(f => doesFormulaMatchProduct(f.productId, selectedProductData));
  }, [formulas, selectedProductData]);

  const handleCreateNewFormula = (name: string, shouldCloneCurrent: boolean) => {
    if (!selectedProductId) return;
    const cleanName = name.trim() || `فرمول شماره ${toPersianDigits(productFormulas.length + 1)}`;
    const newFormulaId = nextSimpleId(db.productFormulas, 'form');
    const newFormula: ProductFormula = {
      id: newFormulaId,
      periodId: activePeriodId,
      productId: selectedProductFormulaKey,
      ingredients: shouldCloneCurrent && activeFormulaData ? [...activeFormulaData.ingredients] : [],
      name: cleanName,
      isActive: productFormulas.length === 0
    };

    const updatedFormulas = [...db.productFormulas, newFormula];
    onUpdateDb({ ...db, productFormulas: updatedFormulas });
    setSelectedFormulaId(newFormulaId);
  };

  const handleSetActiveFormula = (fId: string) => {
    const updatedFormulas = db.productFormulas.map(f => {
      if (selectedProductData ? doesFormulaMatchProduct(f.productId, selectedProductData) : f.productId === selectedProductId) {
        return { ...f, productId: selectedProductFormulaKey, isActive: f.id === fId };
      }
      return f;
    });
    onUpdateDb({ ...db, productFormulas: updatedFormulas });
    setSelectedFormulaId(fId);
  };

  const handleDeleteFormula = (fId: string) => {
    if (confirm('آیا مطمئن هستید که می‌خواهید این فرمول را به طور کامل حذف کنید؟')) {
      const updatedFormulas = db.productFormulas.filter(f => f.id !== fId);
      
      // Calculate remaining formulas for the current product
      const remainingForProduct = updatedFormulas.filter(f =>
        (selectedProductData ? doesFormulaMatchProduct(f.productId, selectedProductData) : f.productId === selectedProductId) &&
        f.periodId === activePeriodId
      );
      let finalFormulas = updatedFormulas;
      
      if (remainingForProduct.length > 0) {
        const deletedF = db.productFormulas.find(f => f.id === fId);
        if (deletedF?.isActive) {
          // If the deleted formula was the active one, mark the first remaining one as active
          finalFormulas = updatedFormulas.map(f => {
            if (f.id === remainingForProduct[0].id) {
              return { ...f, isActive: true };
            }
            return f;
          });
          setSelectedFormulaId(remainingForProduct[0].id);
        } else {
          setSelectedFormulaId(remainingForProduct[0].id);
        }
      } else {
        setSelectedFormulaId(null);
      }
      
      onUpdateDb({ ...db, productFormulas: finalFormulas });
    }
  };

  const handleRenameFormula = (fId: string, currentName: string) => {
    setEditingFormulaId(fId);
    setRenamingValue(currentName);
  };

  const saveRenameFormula = (fId: string) => {
    const cleanName = renamingValue.trim();
    if (!cleanName) {
      alert('نام فرمول نمی‌تواند خالی باشد.');
      return;
    }
    const updatedFormulas = db.productFormulas.map(f => {
      if (f.id === fId) {
        return { ...f, name: cleanName };
      }
      return f;
    });
    onUpdateDb({ ...db, productFormulas: updatedFormulas });
    setEditingFormulaId(null);
  };

  const handleSaveWeight = () => {
    if (!selectedProductId) return;
    const parsed = parseFloat(tempWeight);
    const finalWeightValue = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    
    const updatedProducts = db.products.map(p => {
      if (p.id === selectedProductId) {
        return {
          ...p,
          weight: finalWeightValue
        };
      }
      return p;
    });
    
    onUpdateDb({ ...db, products: updatedProducts });
    setIsEditingWeight(false);
  };

  const handleSaveBatchTargetWeight = () => {
    if (!selectedProductId) return;
    const parsed = parseFloat(tempBatchTargetWeight);
    const finalWeightValue = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    
    const updatedProducts = db.products.map(p => {
      if (p.id === selectedProductId) {
        return {
          ...p,
          weight: finalWeightValue
        };
      }
      return p;
    });
    
    onUpdateDb({ ...db, products: updatedProducts });
    setIsEditingBatchTargetWeight(false);
  };

  React.useEffect(() => {
    if (!selectedProductId || !selectedProductData) {
      setSelectedFormulaId(null);
      return;
    }
    const pFormulas = formulas.filter(f => doesFormulaMatchProduct(f.productId, selectedProductData));
    if (pFormulas.length === 0) {
      setSelectedFormulaId(null);
    } else {
      const activeF = pFormulas.find(f => f.isActive) || pFormulas[0];
      setSelectedFormulaId(activeF.id);
    }
  }, [selectedProductId, selectedProductData, activePeriodId, formulas]);

  const activeFormulaData = useMemo(() => {
    if (!selectedProductData) return undefined;
    if (selectedFormulaId) {
      const found = formulas.find(f => f.id === selectedFormulaId);
      if (found && doesFormulaMatchProduct(found.productId, selectedProductData)) return found;
    }
    const pFormulas = formulas.filter(f => doesFormulaMatchProduct(f.productId, selectedProductData));
    return pFormulas.find(f => f.isActive) || pFormulas[0];
  }, [formulas, selectedProductData, selectedFormulaId]);

  React.useEffect(() => {
    if (activeFormulaData) {
      const mapped = (activeFormulaData.ingredients || []).map(item => {
        const resolved = resolveMaterialByKey(item.rawMaterialId);
        const ent = resolved.item || resolved.wip;
        return {
          rawMaterialId: ent ? getMaterialFormulaKey(ent) : item.rawMaterialId,
          quantity: item.quantity
        };
      });
      setBatchIngredients(mapped);
    } else {
      setBatchIngredients([]);
    }
    setBatchOutputWeight('');
    setBatchWastagePercent('');
    setBatchDraftQty('');
    setBatchDraftMaterialId('');
    setBatchSearchQuery('');
    setEditingBatchMatId(null);
    setEditingBatchMatSelectedId('');
  }, [activeFormulaData?.id, selectedProductId, resolveMaterialByKey]);



  const sourceProductsForCopy = useMemo(() => {
    return products.filter(p => 
      p.id !== selectedProductId && 
      db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0)
    );
  }, [products, db.productFormulas, selectedProductId]);

  // Calculate matching conversion factors
  const activeConversionFactor = useMemo(() => {
    if (!draftMaterialId) return 1;
    const resolved = resolveMaterialByKey(draftMaterialId);
    const rItem = resolved.item;
    if (rItem && rItem.unit === 'کیلویی') {
      return 1000;
    }
    if (resolved.wip) {
      return resolved.wip.unit === 'کیلو' ? 1000 : 1;
    }
    const matched = findMaterialConversion(draftMaterialId, rItem);
    return matched ? matched.factor : 1;
  }, [draftMaterialId, resolveMaterialByKey, findMaterialConversion]);

  const categoryFilteredProducts = useMemo(() => {
    if (formulaCategoryFilter === 'all') return products;
    return products.filter(p => resolveProductCategoryFilterId(p.categoryId) === formulaCategoryFilter);
  }, [products, formulaCategoryFilter, resolveProductCategoryFilterId]);

  const searchedFormulaProducts = useMemo(() => {
    let list = categoryFilteredProducts;
    if (formulaFilter === 'has_formula') {
      list = categoryFilteredProducts.filter(p => !isProductPurchased(p) && formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0));
    } else if (formulaFilter === 'no_formula') {
      list = categoryFilteredProducts.filter(p => !isProductPurchased(p) && !formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0));
    } else if (formulaFilter === 'purchased') {
      list = categoryFilteredProducts.filter(p => isProductPurchased(p));
    }

    if (!formulaSearchQuery) return list;
    return list.filter(p => matchPersianString(p.name, formulaSearchQuery) || matchPersianString(p.code, formulaSearchQuery));
  }, [categoryFilteredProducts, formulas, formulaFilter, formulaSearchQuery, isProductPurchased]);

  // Immutable base purchase cost lookup for purchased goods (products without formula)
  // Prevents runaway feedback loops where allocated sharedLabor/overhead saved to p.cogsPrice would be re-added on every render.
  const rawItemByLookupKey = useMemo(() => {
    const map: Record<string, Item> = {};
    rawItems.forEach(item => {
      if (item.accountId) {
        const key = normalizeAccountingCode(item.accountId);
        if (key) map[key] = item;
      }
      if (item.code) {
        const key = normalizeAccountingCode(item.code);
        if (key && !map[key]) map[key] = item;
      }
    });
    return map;
  }, [rawItems]);

  const getPurchasedBaseCost = React.useCallback((p: Product): number => {
    if (p.purchaseCost !== undefined && p.purchaseCost !== null && Number.isFinite(Number(p.purchaseCost))) {
      return Math.max(0, Math.round(Number(p.purchaseCost)));
    }
    const accKey = p.accountId ? normalizeAccountingCode(p.accountId) : '';
    const codeKey = p.code ? normalizeAccountingCode(p.code) : '';
    const matchedRaw = (accKey && rawItemByLookupKey[accKey]) || (codeKey && rawItemByLookupKey[codeKey]);
    if (matchedRaw && Number.isFinite(Number(matchedRaw.price)) && Number(matchedRaw.price) > 0) {
      return Math.round(Number(matchedRaw.price));
    }
    const fallback = Number(p.cogsPrice);
    return Number.isFinite(fallback) ? Math.max(0, Math.round(fallback)) : 0;
  }, [rawItemByLookupKey]);

  // ==========================================
  // REAL-TIME COMPREHENSIVE COGS ESTIMATION MATRIX
  // ==========================================
  const fullCalculatedCOGSMap = useMemo(() => {
    void recalcTrigger;
    const results: Record<string, {
      materialCost: number;
      directLabor: number;
      sharedLabor: number;
      overheadCost: number;
      totalCOGSPrice: number;
    }> = {};

    // Pre-resolve active formula & purchased status per product once
    const activeRecipeByProductId: Record<string, ProductFormula | undefined> = {};
    const hasFormulaByProductId: Record<string, boolean> = {};
    const isPurchasedByProductId: Record<string, boolean> = {};
    products.forEach(p => {
      const productFormulasList = formulas.filter(f => doesFormulaMatchProduct(f.productId, p));
      const recipe = productFormulasList.find(f => f.isActive) || productFormulasList[0];
      activeRecipeByProductId[p.id] = recipe;
      hasFormulaByProductId[p.id] = Boolean(recipe && recipe.ingredients && recipe.ingredients.length > 0);
      isPurchasedByProductId[p.id] = isProductPurchased(p);
    });

    // 1. Aggregate monthly sales qty/net-revenue/weight globally (all products) AND per mapped Department (produced products ONLY — strictly excluding purchased goods)
    let totalSalesQtyAll = 0;
    let totalNetSalesAll = 0;
    let grandTotalWeight = 0;
    let allGlobalSoldHaveWeight = true;

    const catProducedSalesQtyMap: Record<string, number> = {};
    const catProducedNetSalesMap: Record<string, number> = {};
    const catProducedWeightMap: Record<string, number> = {};
    const catAllProducedSoldHaveWeightMap: Record<string, boolean> = {};

    products.forEach(p => {
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      const saleAgg = salesTotalsByProductId[p.id];
      const sp = saleAgg ? saleAgg.qtySold : 0;
      const netRev = saleAgg ? saleAgg.netSalesAmount : 0;
      const isPurchased = isPurchasedByProductId[p.id];

      if (sp > 0) {
        totalSalesQtyAll += sp;
        totalNetSalesAll += netRev;

        const prodWeight = p.unit === 'کیلو' ? 1000 : (Number(p.weight) || 0);
        if (prodWeight <= 0) {
          allGlobalSoldHaveWeight = false;
        } else {
          grandTotalWeight += sp * prodWeight;
        }

        // Direct labor denominators include ALL produced goods (formulated + non-formulated produced) and strictly exclude purchased goods
        if (!isPurchased) {
          catProducedSalesQtyMap[pDeptId] = (catProducedSalesQtyMap[pDeptId] || 0) + sp;
          catProducedNetSalesMap[pDeptId] = (catProducedNetSalesMap[pDeptId] || 0) + netRev;
          if (prodWeight <= 0) {
            catAllProducedSoldHaveWeightMap[pDeptId] = false;
          } else {
            if (catAllProducedSoldHaveWeightMap[pDeptId] === undefined) {
              catAllProducedSoldHaveWeightMap[pDeptId] = true;
            }
            catProducedWeightMap[pDeptId] = (catProducedWeightMap[pDeptId] || 0) + (sp * prodWeight);
          }
        }
      }
    });

    // Fallback department & global sales volume across other months in the same period
    const fallbackProducedCategorySalesMap: Record<string, { qty: number; weight: number }> = {};
    let fallbackGlobalSalesQty = 0;
    let fallbackGlobalSalesWeight = 0;
    if (totalSalesQtyAll === 0 || Object.keys(catProducedSalesQtyMap).length === 0) {
      const prodLookup: Record<string, Product> = {};
      products.forEach(p => {
        prodLookup[p.id] = p;
        if (p.code) prodLookup[p.code.trim().toLowerCase()] = p;
        if (p.accountId) prodLookup[p.accountId.trim().toLowerCase()] = p;
      });
      const perMonthProducedCatTotals: Record<string, Record<string, { qty: number; weight: number }>> = {};
      const perMonthGlobalTotals: Record<string, { qty: number; weight: number }> = {};
      (db.productSales || []).forEach(s => {
        if (s.periodId !== activePeriodId || Number(s.qtySold || 0) <= 0) return;
        const prod = prodLookup[s.productId] || prodLookup[String(s.productId || '').trim().toLowerCase()];
        if (!prod) return;
        const pDeptId = resolveProductDepartmentId(prod.categoryId);
        const ymKey = `${s.year || selectedCogsYear}-${s.month || 1}`;
        const q = Number(s.qtySold || 0);
        const pw = prod.unit === 'کیلو' ? 1000 : (Number(prod.weight) || 0);

        if (!perMonthGlobalTotals[ymKey]) perMonthGlobalTotals[ymKey] = { qty: 0, weight: 0 };
        perMonthGlobalTotals[ymKey].qty += q;
        perMonthGlobalTotals[ymKey].weight += pw > 0 ? (q * pw) : 0;

        if (!isPurchasedByProductId[prod.id]) {
          if (!perMonthProducedCatTotals[pDeptId]) perMonthProducedCatTotals[pDeptId] = {};
          if (!perMonthProducedCatTotals[pDeptId][ymKey]) perMonthProducedCatTotals[pDeptId][ymKey] = { qty: 0, weight: 0 };
          perMonthProducedCatTotals[pDeptId][ymKey].qty += q;
          perMonthProducedCatTotals[pDeptId][ymKey].weight += pw > 0 ? (q * pw) : 0;
        }
      });

      const globalMonths = Object.values(perMonthGlobalTotals);
      if (globalMonths.length > 0) {
        fallbackGlobalSalesQty = globalMonths.reduce((s, v) => s + v.qty, 0) / globalMonths.length;
        fallbackGlobalSalesWeight = globalMonths.reduce((s, v) => s + v.weight, 0) / globalMonths.length;
      }

      Object.entries(perMonthProducedCatTotals).forEach(([deptId, monthMap]) => {
        const months = Object.values(monthMap);
        if (months.length > 0) {
          const avgQty = months.reduce((s, v) => s + v.qty, 0) / months.length;
          const avgWeight = months.reduce((s, v) => s + v.weight, 0) / months.length;
          fallbackProducedCategorySalesMap[deptId] = { qty: avgQty, weight: avgWeight };
        }
      });
    }

    const safeNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // 2. Partition selected month's Payroll into Direct (by canonical Department) & Shared (مشترک / unallocated); UNASSIGNED always stays 0 direct labor
    const categoryDirectLaborMap: Record<string, number> = { [UNASSIGNED_DEPT_ID]: 0 };
    departments.forEach(dept => {
      categoryDirectLaborMap[dept.id] = 0;
    });

    let totalSharedLaborPayroll = 0;
    payrollItems.forEach(payItem => {
      const totalWage = safeNum(getPayrollItemTotalCost(payItem));
      const alloc = allocationLookupByEmpCode.get(payItem.employeeCode);
      if (!alloc || isSharedDeptId(alloc.departmentCategoryId)) {
        totalSharedLaborPayroll += totalWage;
        return;
      }
      const canonicalDeptId = resolveCanonicalCategoryId(alloc.departmentCategoryId);
      const matchedDept = departments.find(d => !isSharedDeptId(d.id) && d.id === canonicalDeptId);
      if (matchedDept) {
        categoryDirectLaborMap[matchedDept.id] = (categoryDirectLaborMap[matchedDept.id] || 0) + totalWage;
      } else {
        totalSharedLaborPayroll += totalWage;
      }
    });

    // 3. Aggregate selected month's Overheads (strictly finite to prevent NaN propagation)
    let netOverheadValue = 0;
    if (overhead) {
      netOverheadValue =
        (safeNum(overhead.operational) +
          safeNum(overhead.distributionSales) +
          safeNum(overhead.administrative) +
          safeNum(overhead.financial)) -
        safeNum(overhead.returnsOfExpense);
    }

    // Monthly required work hours for selected COGS month/year
    const targetSetting = (db.monthlyWorkdaySettings || []).find(
      s => Number(toEnglishDigits(String(s.year ?? ''))) === Number(selectedCogsYear) &&
           Number(toEnglishDigits(String(s.month ?? ''))) === Number(selectedCogsMonth)
    );
    const rawRequiredHours = targetSetting ? safeNum(targetSetting.requiredWorkHours) : 192;
    const requiredHours = rawRequiredHours > 0 ? rawRequiredHours : 192;

    // Catalog non-WIP produced product count & weight per mapped Department (for zero-sales formulated fallback)
    const catProducedFinishedStats: Record<string, { count: number; totalWeight: number; allHaveWeight: boolean }> = {};
    products.forEach(p => {
      if (p.isWip || isPurchasedByProductId[p.id]) return;
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      if (!catProducedFinishedStats[pDeptId]) {
        catProducedFinishedStats[pDeptId] = { count: 0, totalWeight: 0, allHaveWeight: true };
      }
      catProducedFinishedStats[pDeptId].count += 1;
      const pw = p.unit === 'کیلو' ? 1000 : (Number(p.weight) || 0);
      if (pw > 0) {
        catProducedFinishedStats[pDeptId].totalWeight += pw;
      } else {
        catProducedFinishedStats[pDeptId].allHaveWeight = false;
      }
    });

    // Solve for raw and adjusted direct, shared, and overhead rates for each product (Method 2)
    const rawAllocationsMap: Record<string, { direct: number; shared: number; overhead: number }> = {};
    const catRawDirectSum: Record<string, number> = {};
    let globalRawSharedSum = 0;
    let globalRawOverheadSum = 0;

    products.forEach(p => {
      const hasFormula = hasFormulaByProductId[p.id];
      const isPurchased = isPurchasedByProductId[p.id];
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      const Tsd = (pDeptId === UNASSIGNED_DEPT_ID || isPurchased) ? 0 : (categoryDirectLaborMap[pDeptId] || 0);
      const saleAgg = salesTotalsByProductId[p.id];
      const sp = saleAgg ? saleAgg.qtySold : 0;
      const netRev = saleAgg ? saleAgg.netSalesAmount : 0;
      const pUnitTime = timeCoefficents[p.id] || 0;
      const prodWeight = p.unit === 'کیلو' ? 1000 : (Number(p.weight) || 0);

      let rawDirect = 0;
      let rawShared = 0;
      let rawOverhead = 0;

      if (!isPurchased && hasFormula) {
        // Case A: Produced goods WITH formula
        if (sp > 0) {
          if (pUnitTime > 0) {
            const hourlyWageDirect = requiredHours > 0 ? (Tsd / requiredHours) : 0;
            const pUnitTimeInHours = pUnitTime / 60;
            rawDirect = pDeptId === UNASSIGNED_DEPT_ID ? 0 : (pUnitTimeInHours * hourlyWageDirect);

            const hourlyWageShared = requiredHours > 0 ? (totalSharedLaborPayroll / requiredHours) : 0;
            rawShared = pUnitTimeInHours * hourlyWageShared;

            const hourlyWageOverhead = requiredHours > 0 ? (netOverheadValue / requiredHours) : 0;
            rawOverhead = pUnitTimeInHours * hourlyWageOverhead;
          } else {
            if (pDeptId !== UNASSIGNED_DEPT_ID && Tsd > 0) {
              const catWeight = catProducedWeightMap[pDeptId] || 0;
              const catNetSales = catProducedNetSalesMap[pDeptId] || 0;
              const catQty = catProducedSalesQtyMap[pDeptId] || 0;
              const useCatWeight = catAllProducedSoldHaveWeightMap[pDeptId] === true && catWeight > 0;

              let inCatShare = 0;
              if (useCatWeight) {
                inCatShare = (sp * prodWeight) / catWeight;
              } else if (catNetSales > 0) {
                inCatShare = netRev / catNetSales;
              } else if (catQty > 0) {
                inCatShare = sp / catQty;
              }
              rawDirect = (inCatShare * Tsd) / sp;
            }

            const useGlobalWeight = allGlobalSoldHaveWeight && grandTotalWeight > 0;
            let globalShare = 0;
            if (useGlobalWeight) {
              globalShare = (sp * prodWeight) / grandTotalWeight;
            } else if (totalNetSalesAll > 0) {
              globalShare = netRev / totalNetSalesAll;
            } else if (totalSalesQtyAll > 0) {
              globalShare = sp / totalSalesQtyAll;
            }
            rawShared = (globalShare * totalSharedLaborPayroll) / sp;
            rawOverhead = (globalShare * netOverheadValue) / sp;
          }
        } else if (!p.isWip) {
          // Fallback for zero-sales formulated finished products (WIP stays pure material cost)
          if (pUnitTime > 0) {
            const hourlyWageDirect = requiredHours > 0 ? (Tsd / requiredHours) : 0;
            rawDirect = pDeptId === UNASSIGNED_DEPT_ID ? 0 : ((pUnitTime / 60) * hourlyWageDirect);
            rawShared = requiredHours > 0 ? (pUnitTime / 60) * (totalSharedLaborPayroll / requiredHours) : 0;
            rawOverhead = requiredHours > 0 ? (pUnitTime / 60) * (netOverheadValue / requiredHours) : 0;
          } else {
            if (pDeptId !== UNASSIGNED_DEPT_ID && Tsd > 0) {
              const catWeight = catProducedWeightMap[pDeptId] || 0;
              const catQty = catProducedSalesQtyMap[pDeptId] || 0;
              if (catWeight > 0 && prodWeight > 0) {
                rawDirect = (Tsd / catWeight) * prodWeight;
              } else if (catQty > 0) {
                rawDirect = Tsd / catQty;
              } else if (fallbackProducedCategorySalesMap[pDeptId]) {
                const fb = fallbackProducedCategorySalesMap[pDeptId];
                if (fb.weight > 0 && prodWeight > 0) {
                  rawDirect = (Tsd / fb.weight) * prodWeight;
                } else if (fb.qty > 0) {
                  rawDirect = Tsd / fb.qty;
                }
              } else {
                const catStats = catProducedFinishedStats[pDeptId];
                if (catStats && catStats.count > 0) {
                  if (catStats.allHaveWeight && catStats.totalWeight > 0 && prodWeight > 0) {
                    rawDirect = (Tsd / catStats.totalWeight) * prodWeight;
                  } else {
                    rawDirect = Tsd / catStats.count;
                  }
                }
              }
            }
            if (grandTotalWeight > 0 && prodWeight > 0) {
              rawShared = (totalSharedLaborPayroll / grandTotalWeight) * prodWeight;
              rawOverhead = (netOverheadValue / grandTotalWeight) * prodWeight;
            } else if (totalSalesQtyAll > 0) {
              rawShared = totalSharedLaborPayroll / totalSalesQtyAll;
              rawOverhead = netOverheadValue / totalSalesQtyAll;
            } else if (fallbackGlobalSalesWeight > 0 && prodWeight > 0) {
              rawShared = (totalSharedLaborPayroll / fallbackGlobalSalesWeight) * prodWeight;
              rawOverhead = (netOverheadValue / fallbackGlobalSalesWeight) * prodWeight;
            } else if (fallbackGlobalSalesQty > 0) {
              rawShared = totalSharedLaborPayroll / fallbackGlobalSalesQty;
              rawOverhead = netOverheadValue / fallbackGlobalSalesQty;
            }
          }
        }
      } else if (!isPurchased && !hasFormula) {
        // Case B: Produced goods WITHOUT formula -> Direct labor strictly by net-sales share of produced goods in its department; 0 if zero sales in selected month
        if (sp > 0) {
          if (pDeptId !== UNASSIGNED_DEPT_ID && Tsd > 0) {
            const catNetSales = catProducedNetSalesMap[pDeptId] || 0;
            const catQty = catProducedSalesQtyMap[pDeptId] || 0;
            let inCatShare = 0;
            if (catNetSales > 0) {
              inCatShare = netRev / catNetSales;
            } else if (catQty > 0) {
              inCatShare = sp / catQty;
            }
            rawDirect = (inCatShare * Tsd) / sp;
          }

          const useGlobalWeight = allGlobalSoldHaveWeight && grandTotalWeight > 0;
          let globalShare = 0;
          if (useGlobalWeight) {
            globalShare = (sp * prodWeight) / grandTotalWeight;
          } else if (totalNetSalesAll > 0) {
            globalShare = netRev / totalNetSalesAll;
          } else if (totalSalesQtyAll > 0) {
            globalShare = sp / totalSalesQtyAll;
          }
          rawShared = (globalShare * totalSharedLaborPayroll) / sp;
          rawOverhead = (globalShare * netOverheadValue) / sp;
        } else {
          // Zero sales in selected month -> Direct labor is strictly 0
          rawDirect = 0;
          if (!p.isWip) {
            if (grandTotalWeight > 0 && prodWeight > 0) {
              rawShared = (totalSharedLaborPayroll / grandTotalWeight) * prodWeight;
              rawOverhead = (netOverheadValue / grandTotalWeight) * prodWeight;
            } else if (totalSalesQtyAll > 0) {
              rawShared = totalSharedLaborPayroll / totalSalesQtyAll;
              rawOverhead = netOverheadValue / totalSalesQtyAll;
            } else if (fallbackGlobalSalesWeight > 0 && prodWeight > 0) {
              rawShared = (totalSharedLaborPayroll / fallbackGlobalSalesWeight) * prodWeight;
              rawOverhead = (netOverheadValue / fallbackGlobalSalesWeight) * prodWeight;
            } else if (fallbackGlobalSalesQty > 0) {
              rawShared = totalSharedLaborPayroll / fallbackGlobalSalesQty;
              rawOverhead = netOverheadValue / fallbackGlobalSalesQty;
            }
          }
        }
      } else {
        // Case C: Purchased / Resale goods -> Direct labor is strictly 0
        rawDirect = 0;
        if (sp > 0) {
          const useGlobalWeight = allGlobalSoldHaveWeight && grandTotalWeight > 0;
          let globalShare = 0;
          if (useGlobalWeight) {
            globalShare = (sp * prodWeight) / grandTotalWeight;
          } else if (totalNetSalesAll > 0) {
            globalShare = netRev / totalNetSalesAll;
          } else if (totalSalesQtyAll > 0) {
            globalShare = sp / totalSalesQtyAll;
          }
          rawShared = (globalShare * totalSharedLaborPayroll) / sp;
          rawOverhead = (globalShare * netOverheadValue) / sp;
        } else if (!p.isWip) {
          if (grandTotalWeight > 0 && prodWeight > 0) {
            rawShared = (totalSharedLaborPayroll / grandTotalWeight) * prodWeight;
            rawOverhead = (netOverheadValue / grandTotalWeight) * prodWeight;
          } else if (totalSalesQtyAll > 0) {
            rawShared = totalSharedLaborPayroll / totalSalesQtyAll;
            rawOverhead = netOverheadValue / totalSalesQtyAll;
          } else if (fallbackGlobalSalesWeight > 0 && prodWeight > 0) {
            rawShared = (totalSharedLaborPayroll / fallbackGlobalSalesWeight) * prodWeight;
            rawOverhead = (netOverheadValue / fallbackGlobalSalesWeight) * prodWeight;
          } else if (fallbackGlobalSalesQty > 0) {
            rawShared = totalSharedLaborPayroll / fallbackGlobalSalesQty;
            rawOverhead = netOverheadValue / fallbackGlobalSalesQty;
          }
        }
      }

      rawAllocationsMap[p.id] = { direct: rawDirect, shared: rawShared, overhead: rawOverhead };

      if (sp > 0 && !isPurchased) {
        catRawDirectSum[pDeptId] = (catRawDirectSum[pDeptId] || 0) + (sp * rawDirect);
        globalRawSharedSum += (sp * rawShared);
        globalRawOverheadSum += (sp * rawOverhead);
      } else if (sp > 0) {
        globalRawSharedSum += (sp * rawShared);
        globalRawOverheadSum += (sp * rawOverhead);
      }
    });

    // Compute coefficients for Method 2 Adjustment per Department
    const coeffDirect: Record<string, number> = { [UNASSIGNED_DEPT_ID]: 1.0 };
    departments.forEach(dept => {
      const Tsd = categoryDirectLaborMap[dept.id] || 0;
      const rawSum = catRawDirectSum[dept.id] || 0;
      coeffDirect[dept.id] = rawSum > 0 ? (Tsd / rawSum) : 1.0;
    });

    const coeffShared = globalRawSharedSum > 0 ? (totalSharedLaborPayroll / globalRawSharedSum) : 1.0;
    const coeffOverhead = globalRawOverheadSum > 0 ? (netOverheadValue / globalRawOverheadSum) : 1.0;

    // Build the final adjusted allocations map
    const adjustedAllocationsMap: Record<string, { direct: number; shared: number; overhead: number }> = {};
    products.forEach(p => {
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      const ra = rawAllocationsMap[p.id];
      const sp = salesTotalsByProductId[p.id]?.qtySold || 0;

      if (sp > 0) {
        const cDirect = pDeptId === UNASSIGNED_DEPT_ID ? 0 : (coeffDirect[pDeptId] !== undefined ? coeffDirect[pDeptId] : 1.0);
        adjustedAllocationsMap[p.id] = {
          direct: ra.direct * cDirect,
          shared: ra.shared * coeffShared,
          overhead: ra.overhead * coeffOverhead
        };
      } else {
        adjustedAllocationsMap[p.id] = {
          direct: pDeptId === UNASSIGNED_DEPT_ID ? 0 : ra.direct,
          shared: ra.shared,
          overhead: ra.overhead
        };
      }
    });

    // Solve for each product in 3 passes to handle nested WIP dependencies cleanly without stale cogsPrice bleed-through
    for (let pass = 0; pass < 3; pass++) {
      products.forEach(p => {
        let ingredientsSum = 0;
        const recipe = activeRecipeByProductId[p.id];
        const hasFormula = hasFormulaByProductId[p.id];

        if (hasFormula && recipe) {
          let rawIngSum = 0;
          recipe.ingredients.forEach(ing => {
            const ingQty = safeNum(ing.quantity);
            if (ingQty <= 0) return;
            const resolved = resolveMaterialByKey(ing.rawMaterialId);
            if (resolved.item) {
              const raw = resolved.item;
              const factor = raw.unit === 'کیلویی' ? 1000 : safeNum(findMaterialConversion(ing.rawMaterialId, raw)?.factor || 1);
              const unitPrice = factor > 0 ? (safeNum(raw.price) / factor) : 0;
              rawIngSum += ingQty * unitPrice;
            } else if (resolved.wip) {
              const wipProduct = resolved.wip;
              const wipCogs = results[wipProduct.id] !== undefined
                ? safeNum(results[wipProduct.id].totalCOGSPrice)
                : (hasFormulaByProductId[wipProduct.id] ? 0 : getPurchasedBaseCost(wipProduct));
              const factor = wipProduct.unit === 'کیلو' ? 1000 : 1;
              const unitPrice = factor > 0 ? (wipCogs / factor) : 0;
              rawIngSum += ingQty * unitPrice;
            }
          });
          ingredientsSum = Math.round(safeNum(rawIngSum));
        } else {
          ingredientsSum = getPurchasedBaseCost(p);
        }

        const adj = adjustedAllocationsMap[p.id] || { direct: 0, shared: 0, overhead: 0 };
        const directLaborCost = !isPurchasedByProductId[p.id] ? safeNum(adj.direct) : 0;
        const sharedLaborCost = safeNum(adj.shared);
        const overheadCostVal = safeNum(adj.overhead);
        const totalCOGS = safeNum(ingredientsSum + directLaborCost + sharedLaborCost + overheadCostVal);

        results[p.id] = {
          materialCost: safeNum(ingredientsSum),
          directLabor: directLaborCost,
          sharedLabor: sharedLaborCost,
          overheadCost: overheadCostVal,
          totalCOGSPrice: totalCOGS
        };
      });
    }

    return results;
  }, [products, formulas, resolveMaterialByKey, findMaterialConversion, salesTotalsByProductId, payrollItems, overhead, timeCoefficents, db.monthlyWorkdaySettings, db.productSales, activePeriodId, selectedCogsYear, selectedCogsMonth, departments, allocationLookupByEmpCode, isSharedDeptId, resolveCanonicalCategoryId, resolveProductDepartmentId, getPurchasedBaseCost, isProductPurchased, recalcTrigger]);

  // Real-time Profit & Loss analysis directly synced with fullCalculatedCOGSMap
  const productsWithLossAndProfit = useMemo(() => {
    const prodLookup: Record<string, Product> = {};
    products.forEach(p => {
      prodLookup[p.id] = p;
      if (p.code) prodLookup[p.code.trim().toLowerCase()] = p;
      if (p.accountId) prodLookup[p.accountId.trim().toLowerCase()] = p;
    });

    return activeSalesRecords.map(sale => {
      const prod = prodLookup[sale.productId] || prodLookup[String(sale.productId || '').trim().toLowerCase()];
      if (!prod) return null;

      const calcEntry = fullCalculatedCOGSMap[prod.id];
      const unitCogs = calcEntry !== undefined ? Math.round(calcEntry.totalCOGSPrice) : (prod.cogsPrice || 0);
      const totalCOGS = sale.qtySold * unitCogs;
      const profitValue = sale.netSalesAmount - totalCOGS;
      const isLossMaking = profitValue < 0;

      return {
        sale,
        prod,
        unitCogs,
        totalCOGS,
        profitValue,
        isLossMaking
      };
    }).filter(Boolean) as any[];
  }, [activeSalesRecords, products, fullCalculatedCOGSMap]);

  const lossyProductsList = useMemo(() => {
    return productsWithLossAndProfit.filter(x => x.isLossMaking);
  }, [productsWithLossAndProfit]);

  const searchedLossyProductsList = useMemo(() => {
    let list = lossyProductsList;
    if (analyticsCategoryFilter && analyticsCategoryFilter !== 'all') {
      list = list.filter(x => resolveProductDepartmentId(x.prod.categoryId) === analyticsCategoryFilter);
    }
    return list;
  }, [lossyProductsList, analyticsCategoryFilter, resolveProductDepartmentId]);

  const totalProfitSum = useMemo(() => {
    return productsWithLossAndProfit
      .filter(x => x.profitValue > 0)
      .reduce((acc, curr) => acc + curr.profitValue, 0);
  }, [productsWithLossAndProfit]);

  const totalLossSum = useMemo(() => {
    return productsWithLossAndProfit
      .filter(x => x.profitValue < 0)
      .reduce((acc, curr) => acc + Math.abs(curr.profitValue), 0);
  }, [productsWithLossAndProfit]);

  const searchedProductsWithLossAndProfit = useMemo(() => {
    let list = productsWithLossAndProfit;

    if (analyticsSearch) {
      list = list.filter(x =>
        matchPersianString(x.prod.name, analyticsSearch) ||
        matchPersianString(x.prod.code, analyticsSearch)
      );
    }

    if (analyticsFormulaFilter === 'with_formula') {
      list = list.filter(x => !isProductPurchased(x.prod) && db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, x.prod) && f.periodId === activePeriodId && f.ingredients.length > 0));
    } else if (analyticsFormulaFilter === 'without_formula') {
      list = list.filter(x => !isProductPurchased(x.prod) && !db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, x.prod) && f.periodId === activePeriodId && f.ingredients.length > 0));
    } else if (analyticsFormulaFilter === 'purchased') {
      list = list.filter(x => isProductPurchased(x.prod));
    }

    if (analyticsCategoryFilter && analyticsCategoryFilter !== 'all') {
      list = list.filter(x => resolveProductDepartmentId(x.prod.categoryId) === analyticsCategoryFilter);
    }

    return list;
  }, [productsWithLossAndProfit, analyticsSearch, analyticsFormulaFilter, analyticsCategoryFilter, db.productFormulas, activePeriodId, resolveProductDepartmentId, isProductPurchased]);

  const searchedTotals = useMemo(() => {
    let netSalesAmountSum = 0;
    let totalCogsSum = 0;
    let profitValueSum = 0;
    let qtySoldSum = 0;

    searchedProductsWithLossAndProfit.forEach(x => {
      netSalesAmountSum += x.sale.netSalesAmount;
      totalCogsSum += x.totalCOGS;
      profitValueSum += x.profitValue;
      qtySoldSum += x.sale.qtySold;
    });

    return {
      netSalesAmountSum,
      totalCogsSum,
      profitValueSum,
      qtySoldSum
    };
  }, [searchedProductsWithLossAndProfit]);

  // Global COGS statistics card widgets
  const globalCOGSStats = useMemo(() => {
    let formulatedCount = 0;
    let totalMarginSum = 0;
    let formulatedWithMarginCount = 0;

    products.forEach(p => {
      const hasF = formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0);
      if (hasF) formulatedCount++;

      const cogsObj = fullCalculatedCOGSMap[p.id];
      if (cogsObj && cogsObj.totalCOGSPrice > 0 && p.salePrice > 0) {
        const margin = ((p.salePrice - cogsObj.totalCOGSPrice) / p.salePrice) * 100;
        totalMarginSum += margin;
        formulatedWithMarginCount++;
      }
    });

    const averageMargin = formulatedWithMarginCount > 0 ? totalMarginSum / formulatedWithMarginCount : 0;
    
    // Total overhead
    let totalOverheadCost = 0;
    if (overhead) {
      totalOverheadCost = (overhead.operational + overhead.distributionSales + overhead.administrative + overhead.financial) - overhead.returnsOfExpense;
    }

    // Total personnel costs
    let totalPayrollCost = 0;
    payrollItems.forEach(pi => {
      totalPayrollCost += getPayrollItemTotalCost(pi);
    });

    return {
      formulatedCount,
      totalOverheadCost,
      totalPayrollCost,
      averageMargin
    };
  }, [products, formulas, fullCalculatedCOGSMap, overhead, payrollItems]);

  const detailedAllocationData = useMemo(() => {
    // Partition selected month's payroll cleanly between Direct departments & Shared
    const categoryDirectLaborMap: Record<string, number> = { [UNASSIGNED_DEPT_ID]: 0 };
    departments.forEach(dept => {
      categoryDirectLaborMap[dept.id] = 0;
    });

    let totalSharedLaborPayroll = 0;
    payrollItems.forEach(payItem => {
      const totalWage = getPayrollItemTotalCost(payItem);
      const alloc = allocationLookupByEmpCode.get(payItem.employeeCode);
      if (!alloc || isSharedDeptId(alloc.departmentCategoryId)) {
        totalSharedLaborPayroll += totalWage;
        return;
      }
      const canonicalDeptId = resolveCanonicalCategoryId(alloc.departmentCategoryId);
      const matchedDept = departments.find(d => !isSharedDeptId(d.id) && d.id === canonicalDeptId);
      if (matchedDept) {
        categoryDirectLaborMap[matchedDept.id] = (categoryDirectLaborMap[matchedDept.id] || 0) + totalWage;
      } else {
        totalSharedLaborPayroll += totalWage;
      }
    });

    // Aggregate Overheads
    let netOverheadValue = 0;
    if (overhead) {
      netOverheadValue = (overhead.operational + overhead.distributionSales + overhead.administrative + overhead.financial) - overhead.returnsOfExpense;
    }

    // Group products by mapped Department (+ Unassigned group if any exist)
    const categoriesList = departmentFilterOptions.map(dept => {
      const Tsd = dept.id === UNASSIGNED_DEPT_ID ? 0 : (categoryDirectLaborMap[dept.id] || 0);
      const catProducts = products.filter(p => resolveProductDepartmentId(p.categoryId) === dept.id);

      let categoryTotalWeight = 0;
      let categoryTotalNetSales = 0;
      let categoryTotalQty = 0;
      let allCatSoldHaveWeight = true;

      catProducts.forEach(p2 => {
        if (isProductPurchased(p2)) return; // Exclude purchased goods from department produced direct-labor pool
        const saleAgg2 = salesTotalsByProductId[p2.id];
        const sp2 = saleAgg2 ? saleAgg2.qtySold : 0;
        const netRev2 = saleAgg2 ? saleAgg2.netSalesAmount : 0;
        if (sp2 > 0) {
          categoryTotalQty += sp2;
          categoryTotalNetSales += netRev2;
          const prodWeight2 = p2.unit === 'کیلو' ? 1000 : (Number(p2.weight) || 0);
          if (prodWeight2 <= 0) {
            allCatSoldHaveWeight = false;
          } else {
            categoryTotalWeight += sp2 * prodWeight2;
          }
        }
      });

      const productDetails = catProducts.map(p => {
        const saleAgg = salesTotalsByProductId[p.id];
        const sp = saleAgg ? saleAgg.qtySold : 0;
        const netRev = saleAgg ? saleAgg.netSalesAmount : 0;
        const isPurchased = isProductPurchased(p);
        const hasFormula = formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0);
        const productClass: 'formulated' | 'produced_no_formula' | 'purchased' = isPurchased
          ? 'purchased'
          : (hasFormula ? 'formulated' : 'produced_no_formula');

        const cogsData = fullCalculatedCOGSMap[p.id] || { directLabor: 0, sharedLabor: 0, overheadCost: 0 };
        const directLaborPerUnit = cogsData.directLabor;
        const sharedLaborPerUnit = cogsData.sharedLabor;
        const overheadPerUnit = cogsData.overheadCost;

        const pUnitTime = timeCoefficents[p.id] || 0;
        let allocationMode: 'time' | 'weight' | 'sales_no_formula' | 'purchased' | 'none' = 'none';
        let allocationDetail = '';
        let pctWeightInCategory = 0;

        if (isPurchased) {
          allocationMode = 'purchased';
          allocationDetail = 'کالای خریداری (حقوق مستقیم صفر)';
        } else if (sp > 0) {
          if (!hasFormula) {
            allocationMode = 'sales_no_formula';
            pctWeightInCategory = categoryTotalNetSales > 0 ? (netRev / categoryTotalNetSales) : (categoryTotalQty > 0 ? (sp / categoryTotalQty) : 0);
            allocationDetail = `سهم فروش دپارتمان (${toPersianDigits((pctWeightInCategory * 100).toFixed(1))}٪)`;
          } else if (pUnitTime > 0) {
            allocationMode = 'time';
            allocationDetail = 'زمان‌محور تعدیل‌شده (روش دوم)';
          } else {
            allocationMode = 'weight';
            const prodWeight = p.unit === 'کیلو' ? 1000 : (Number(p.weight) || 0);
            if (allCatSoldHaveWeight && categoryTotalWeight > 0) {
              pctWeightInCategory = (sp * prodWeight) / categoryTotalWeight;
              allocationDetail = 'وزن‌محور تعدیل‌شده (روش دوم)';
            } else if (categoryTotalNetSales > 0) {
              pctWeightInCategory = netRev / categoryTotalNetSales;
              allocationDetail = 'فروش‌محور تعدیل‌شده (بدون وزن)';
            } else if (categoryTotalQty > 0) {
              pctWeightInCategory = sp / categoryTotalQty;
              allocationDetail = 'مقدارمحور تعدیل‌شده (بدون وزن)';
            } else {
              allocationDetail = 'وزن‌محور تعدیل‌شده (روش دوم)';
            }
          }
        } else {
          allocationDetail = hasFormula ? 'فاقد فروش در این ماه' : 'فاقد فروش (حقوق مستقیم صفر)';
        }

        const directLaborTotal = sp * directLaborPerUnit;
        const sharedLaborTotal = sp * sharedLaborPerUnit;
        const overheadTotal = sp * overheadPerUnit;

        return {
          productId: p.id,
          name: p.name,
          code: p.code,
          unit: p.unit,
          weight: p.weight || 0,
          qtySold: sp,
          productClass,
          allocationMode,
          allocationDetail,
          pUnitTime,
          pctWeightInCategory,
          directLaborPerUnit,
          directLaborTotal,
          sharedLaborPerUnit,
          sharedLaborTotal,
          overheadPerUnit,
          overheadTotal,
          totalPerUnit: directLaborPerUnit + sharedLaborPerUnit + overheadPerUnit,
          totalAll: directLaborTotal + sharedLaborTotal + overheadTotal
        };
      });

      const totalDirectAllocated = productDetails.reduce((sum, item) => sum + item.directLaborTotal, 0);
      const totalSharedAllocated = productDetails.reduce((sum, item) => sum + item.sharedLaborTotal, 0);
      const totalOverheadAllocated = productDetails.reduce((sum, item) => sum + item.overheadTotal, 0);

      return {
        categoryId: dept.id,
        categoryName: dept.name,
        directPayrollBooked: Tsd,
        products: productDetails,
        totalDirectAllocated,
        totalSharedAllocated,
        totalOverheadAllocated,
        totalAllocatedSum: totalDirectAllocated + totalSharedAllocated + totalOverheadAllocated
      };
    });

    // Summary calculation
    let totalDirectPayrollBooked = 0;
    departments.forEach(dept => {
      if (!isSharedDeptId(dept.id)) {
        totalDirectPayrollBooked += categoryDirectLaborMap[dept.id] || 0;
      }
    });

    const totalDirectAllocatedSum = categoriesList.reduce((sum, cat) => sum + cat.totalDirectAllocated, 0);
    const totalSharedAllocatedSum = categoriesList.reduce((sum, cat) => sum + cat.totalSharedAllocated, 0);
    const totalOverheadAllocatedSum = categoriesList.reduce((sum, cat) => sum + cat.totalOverheadAllocated, 0);

    return {
      categories: categoriesList,
      summary: {
        direct: {
          booked: totalDirectPayrollBooked,
          allocated: totalDirectAllocatedSum,
          diff: totalDirectPayrollBooked - totalDirectAllocatedSum
        },
        shared: {
          booked: totalSharedLaborPayroll,
          allocated: totalSharedAllocatedSum,
          diff: totalSharedLaborPayroll - totalSharedAllocatedSum
        },
        overhead: {
          booked: netOverheadValue,
          allocated: totalOverheadAllocatedSum,
          diff: netOverheadValue - totalOverheadAllocatedSum
        },
        totals: {
          booked: totalDirectPayrollBooked + totalSharedLaborPayroll + netOverheadValue,
          allocated: totalDirectAllocatedSum + totalSharedAllocatedSum + totalOverheadAllocatedSum,
          diff: (totalDirectPayrollBooked + totalSharedLaborPayroll + netOverheadValue) - (totalDirectAllocatedSum + totalSharedAllocatedSum + totalOverheadAllocatedSum)
        }
      }
    };
  }, [products, departments, departmentFilterOptions, payrollItems, overhead, salesTotalsByProductId, timeCoefficents, fullCalculatedCOGSMap, allocationLookupByEmpCode, isSharedDeptId, resolveCanonicalCategoryId, resolveProductDepartmentId, formulas, isProductPurchased]);

  const selectedDraftMaterial = useMemo(() => {
    if (!draftMaterialId) return undefined;
    const resolved = resolveMaterialByKey(draftMaterialId);
    if (resolved.item) {
      return { ...resolved.item, isWip: false as const, rawItem: resolved.item };
    }
    if (resolved.wip) {
      const pItem = resolved.wip;
      return {
        id: pItem.id,
        accountId: pItem.accountId || '',
        code: pItem.code,
        name: pItem.name,
        unit: pItem.unit === 'کیلو' ? 'کیلویی' : 'عددی',
        price: fullCalculatedCOGSMap[pItem.id]?.totalCOGSPrice || pItem.cogsPrice || 0,
        packageType: 'لانچ باکس' as const,
        isWip: true as const,
        rawItem: undefined
      };
    }
    return undefined;
  }, [draftMaterialId, resolveMaterialByKey, fullCalculatedCOGSMap]);

  const selectableMaterials = useMemo(() => {
    const rawOptions = activeRawItems.map(i => ({
      value: getMaterialFormulaKey(i),
      label: `[ماده خام] ${i.accountId ? `${i.accountId} | ` : ''}${i.code} | ${i.name}`
    }));

    const wipProducts = products.filter(p => p.isWip && p.id !== selectedProductId);
    const wipOptions = wipProducts.map(w => ({
      value: getMaterialFormulaKey(w),
      label: `[نیمه ساخته] ${w.accountId ? `${w.accountId} | ` : ''}${w.code} | ${w.name}`
    }));

    return [...rawOptions, ...wipOptions];
  }, [activeRawItems, products, selectedProductId]);


  // ==========================================
  // SUGGESTED SELLING PRICE & SIMULATION MATRIX
  // ==========================================
  const pricingData = useMemo(() => {
    return periodProducts.map(p => {
      const cogsObj = fullCalculatedCOGSMap[p.id] || { totalCOGSPrice: 0 };
      const costPrice = Math.round(cogsObj.totalCOGSPrice);
      
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      const margin = pDeptId !== UNASSIGNED_DEPT_ID
        ? (deptMargins[pDeptId] ?? deptMargins[p.categoryId] ?? 20)
        : 20;
      
      // Calculate suggested selling price: S = C / (1 - P/100)
      let suggestedPrice = 0;
      if (margin >= 100) {
        suggestedPrice = costPrice * (1 + margin / 100);
      } else {
        suggestedPrice = Math.round(costPrice / (1 - margin / 100));
      }

      const activeApprovedPrice = approvedPrices[p.id] || p.approvedPrice || p.salePrice || 0;
      const originalPrice = originalPrices[p.id] ?? p.salePrice ?? 0;

      const dept = pDeptId !== UNASSIGNED_DEPT_ID ? departments.find(d => d.id === pDeptId) : undefined;
      const category = categoryByIdMap[p.categoryId];
      const categoryName = dept
        ? dept.name
        : category
          ? `تخصیص‌نیافته (${category.name})`
          : 'تخصیص‌نیافته (بدون دپارتمان)';

      return {
        product: p,
        categoryName,
        costPrice,
        margin,
        suggestedPrice,
        approvedPrice: activeApprovedPrice,
        originalPrice,
      };
    });
  }, [periodProducts, fullCalculatedCOGSMap, deptMargins, approvedPrices, originalPrices, departments, categoryByIdMap, resolveProductDepartmentId]);

  const filteredPricingData = useMemo(() => {
    let data = pricingData;
    if (pricingSearch) {
      data = data.filter(item => 
        matchPersianString(item.product.name, pricingSearch) || 
        matchPersianString(item.product.code, pricingSearch)
      );
    }
    if (pricingFilterMode === 'approved') {
      data = data.filter(item => {
        const approvedVal = approvedPrices[item.product.id] || item.product.approvedPrice || 0;
        return approvedVal > 0;
      });
    } else if (pricingFilterMode === 'hasCost') {
      data = data.filter(item => 
        item.costPrice > 0 && 
        formulas.some(f => doesFormulaMatchProduct(f.productId, item.product) && f.ingredients.length > 0)
      );
    }
    return data;
  }, [pricingData, pricingSearch, pricingFilterMode, approvedPrices, formulas]);

  const {
    departmentCostAllocationPivot,
    totalActualDirectLabor,
    totalActualSharedLabor,
    totalActualOverhead,
    totalAllocatedDirectLabor,
    totalAllocatedSharedLabor,
    totalAllocatedOverhead,
    totalAllocatedMaterialCost
  } = useMemo(() => {
    const pivot: Record<string, {
      directLaborAllocated: number;
      sharedLaborAllocated: number;
      overheadAllocated: number;
      materialCostAllocated: number;
      totalAllocated: number;
    }> = {};

    departmentFilterOptions.forEach(dept => {
      pivot[dept.id] = {
        directLaborAllocated: 0,
        sharedLaborAllocated: 0,
        overheadAllocated: 0,
        materialCostAllocated: 0,
        totalAllocated: 0
      };
    });

    products.forEach(p => {
      const pDeptId = resolveProductDepartmentId(p.categoryId);
      const sp = salesTotalsByProductId[p.id]?.qtySold || 0;
      const calc = fullCalculatedCOGSMap[p.id];

      if (sp > 0 && calc && pivot[pDeptId]) {
        const dl = (calc.directLabor || 0) * sp;
        const sl = (calc.sharedLabor || 0) * sp;
        const oh = (calc.overheadCost || 0) * sp;
        const mc = (calc.materialCost || 0) * sp;

        pivot[pDeptId].directLaborAllocated += dl;
        pivot[pDeptId].sharedLaborAllocated += sl;
        pivot[pDeptId].overheadAllocated += oh;
        pivot[pDeptId].materialCostAllocated += mc;
        pivot[pDeptId].totalAllocated += (dl + sl + oh + mc);
      }
    });

    // Aggregated real-ledger values for selected month
    let actDirect = 0;
    let actShared = 0;
    payrollItems.forEach(pi => {
      const alloc = allocationLookupByEmpCode.get(pi.employeeCode);
      const val = getPayrollItemTotalCost(pi);
      if (isDirectDeptAllocation(alloc)) {
        actDirect += val;
      } else {
        actShared += val;
      }
    });

    let actOverhead = 0;
    if (overhead) {
      actOverhead = (overhead.operational + overhead.distributionSales + overhead.administrative + overhead.financial) - overhead.returnsOfExpense;
    }

    let allocDirect = 0;
    let allocShared = 0;
    let allocOverhead = 0;
    let allocMaterial = 0;

    Object.values(pivot).forEach(val => {
      allocDirect += val.directLaborAllocated;
      allocShared += val.sharedLaborAllocated;
      allocOverhead += val.overheadAllocated;
      allocMaterial += val.materialCostAllocated;
    });

    return {
      departmentCostAllocationPivot: pivot,
      totalActualDirectLabor: actDirect,
      totalActualSharedLabor: actShared,
      totalActualOverhead: actOverhead,
      totalAllocatedDirectLabor: allocDirect,
      totalAllocatedSharedLabor: allocShared,
      totalAllocatedOverhead: allocOverhead,
      totalAllocatedMaterialCost: allocMaterial
    };
  }, [products, salesTotalsByProductId, departmentFilterOptions, fullCalculatedCOGSMap, payrollItems, overhead, allocationLookupByEmpCode, isDirectDeptAllocation, resolveProductDepartmentId]);

  const previousPeriodInfo = useMemo(() => {
    const sorted = [...db.periods].sort((a, b) => a.id.localeCompare(b.id));
    const currentIndex = sorted.findIndex(p => p.id === activePeriodId);
    
    let prevId = '';
    let prevName = '';

    if (currentIndex > 0) {
      prevId = sorted[currentIndex - 1].id;
      prevName = sorted[currentIndex - 1].name;
    } else {
      const fallbackPeriod = db.periods.find(p => p.id !== activePeriodId);
      if (fallbackPeriod) {
        prevId = fallbackPeriod.id;
        prevName = fallbackPeriod.name;
      }
    }

    return { id: prevId, name: prevName };
  }, [db.periods, activePeriodId]);

  const prevPeriodSimulation = useMemo(() => {
    if (!previousPeriodInfo.id) {
      return {
        hasData: false,
        prevPeriodName: '',
        totalQtySold: 0,
        oldSalesRevenue: 0,
        oldSalesCOGS: 0,
        oldProfit: 0,
        newSalesRevenue: 0,
        newSalesCOGS: 0,
        newProfit: 0,
        profitDifference: 0,
        items: []
      };
    }

    const prevSales = db.productSales.filter(s => s.periodId === previousPeriodInfo.id);
    const prevProducts = db.products.filter(p => p.periodId === previousPeriodInfo.id);

    let totalQtySold = 0;
    let oldSalesRevenue = 0;
    let oldSalesCOGS = 0;
    let newSalesRevenue = 0;
    let newSalesCOGS = 0;

    const itemsSimulated: any[] = [];

    prevSales.forEach(sale => {
      const prevProd = prevProducts.find(p => p.id === sale.productId);
      if (!prevProd) return;

      const currentProd = periodProducts.find(p => p.code === prevProd.code || p.name === prevProd.name);
      
      const qty = sale.qtySold;
      totalQtySold += qty;
      
      const prevCogsUnit = prevProd.cogsPrice || 0;
      const oldRev = sale.netSalesAmount;
      oldSalesRevenue += oldRev;
      oldSalesCOGS += qty * prevCogsUnit;

      let approvedPrice = 0;
      let currentCogsPrice = 0;

      if (currentProd) {
        approvedPrice = approvedPrices[currentProd.id] || currentProd.approvedPrice || currentProd.salePrice || prevProd.salePrice || 0;
        currentCogsPrice = (fullCalculatedCOGSMap[currentProd.id]?.totalCOGSPrice) ?? currentProd.cogsPrice ?? prevCogsUnit;
      } else {
        approvedPrice = prevProd.salePrice || 0;
        currentCogsPrice = prevCogsUnit;
      }

      const simulatedRevenue = qty * approvedPrice;
      const simulatedCOGS = qty * currentCogsPrice;

      newSalesRevenue += simulatedRevenue;
      newSalesCOGS += simulatedCOGS;

      itemsSimulated.push({
        code: prevProd.code,
        accountId: prevProd.accountId,
        name: prevProd.name,
        unit: prevProd.unit,
        qtySold: qty,
        oldSalePrice: prevProd.salePrice,
        oldRevenue: oldRev,
        oldProfit: oldRev - (qty * prevCogsUnit),
        newSalePrice: approvedPrice,
        newRevenue: simulatedRevenue,
        unitCogs: currentCogsPrice,
        newCOGS: simulatedCOGS,
        newProfit: simulatedRevenue - simulatedCOGS
      });
    });

    const oldProfit = oldSalesRevenue - oldSalesCOGS;
    const newProfit = newSalesRevenue - newSalesCOGS;
    const profitDifference = newProfit - oldProfit;

    return {
      hasData: prevSales.length > 0,
      prevPeriodName: previousPeriodInfo.name,
      totalQtySold,
      oldSalesRevenue,
      oldSalesCOGS,
      oldProfit,
      newSalesRevenue,
      newSalesCOGS,
      newProfit,
      profitDifference,
      items: itemsSimulated
    };
  }, [previousPeriodInfo, db.productSales, db.products, periodProducts, approvedPrices, fullCalculatedCOGSMap]);

  const handleSavePricesToDb = () => {
    const updatedProducts = db.products.map(p => {
      if (p.periodId === activePeriodId) {
        const approvedVal = approvedPrices[p.id] !== undefined ? approvedPrices[p.id] : (p.approvedPrice || 0);
        if (approvedVal > 0) {
          return { 
            ...p, 
            salePrice: approvedVal,
            approvedPrice: approvedVal
          };
        }
      }
      return p;
    });

    onUpdateDb({
      ...db,
      products: updatedProducts
    });
    
    // Update originalPrices
    const syncedOriginals: Record<string, number> = {};
    updatedProducts.filter(p => p.periodId === activePeriodId).forEach(p => {
      syncedOriginals[p.id] = p.salePrice || 0;
    });
    setOriginalPrices(syncedOriginals);

    alert('تمامی مبالغ تایید شده با موفقیت به عنوان قیمت فروش کاتالوگ محصولات ثبت گردید.');
  };

  const exportPricingToExcel = () => {
    const headers = [
      'کد حسابداری',
      'نام کالا',
      'واحد کالا',
      'بهای تمام شده تک واحد (ریال)',
      'سود هدف دپارتمان (%)',
      'قیمت پیشنهادی فروش (ریال)',
      'قیمت قبلی فروش (ریال)',
      'قیمت جدید فروش مصوب (ریال)',
      'تفاضل قیمت (ریال)',
      'تاریخ تغییر مبالغ'
    ];

    const rows = pricingData.map(item => [
      item.product.accountId || '',
      item.product.name,
      item.product.unit,
      item.costPrice.toString(),
      `${item.margin}%`,
      item.suggestedPrice.toString(),
      item.originalPrice.toString(),
      item.approvedPrice.toString(),
      (item.approvedPrice - item.originalPrice).toString(),
      dateOfChange
    ]);

    downloadCSV(`گزارش_پیشنهاد_و_تایید_قیمت_فروش_دوره_${activePeriodId}`, headers, rows);
  };

  const printPricingReport = () => {
    const el = document.getElementById('pricing-printable-report-container');
    if (el) {
      printElement('گزارش تغییرات قیمت‌های فروش مصوب و سودآوری', el.outerHTML);
    } else {
      alert('موردی برای چاپ یافت نشد.');
    }
  };

  const printFormulationReport = () => {
    const el = document.getElementById('formulation-printable-report-container');
    if (el) {
      printElement(`شناسنامه فنی و فرمولاسیون ${selectedProductData?.name || ''}`, el.outerHTML);
    } else {
      alert('فرمولی برای چاپ یافت نشد.');
    }
  };


  // Copy formulas from previous periods
  const handleCopyFormulasFromPriorPeriod = () => {
    const otherPeriodFormulas = db.productFormulas.filter(f => f.periodId !== activePeriodId);
    if (otherPeriodFormulas.length === 0) {
      alert('هیچ فرمولی در دوره‌های زمانی دیگر در بانک اطلاعاتی موجود نمی‌باشد.');
      return;
    }

    if (confirm(`آیا مایل به انتقال تعداد ${otherPeriodFormulas.length} فرمول ساخت از دوره‌های پیشین به این دوره هستید؟`)) {
      const freshFormulas = [...db.productFormulas];
      otherPeriodFormulas.forEach(oldF => {
        const oldProductObj = db.products.find(p => doesFormulaMatchProduct(oldF.productId, p));
        const localProduct = oldProductObj
          ? (
              (oldProductObj.accountId && products.find(p => p.accountId && normalizeAccountingCode(p.accountId) === normalizeAccountingCode(oldProductObj.accountId))) ||
              products.find(p => (oldProductObj.code && p.code === oldProductObj.code) || p.name === oldProductObj.name)
            )
          : products.find(p => doesFormulaMatchProduct(oldF.productId, p));

        const targetProdKey = localProduct ? getProductFormulaKey(localProduct) : normalizeAccountingCode(oldF.productId);
        if (!targetProdKey) return;

        const alreadyExists = localProduct
          ? formulas.some(f => doesFormulaMatchProduct(f.productId, localProduct))
          : formulas.some(f => normalizeAccountingCode(f.productId) === targetProdKey);

        if (!alreadyExists) {
          const mappedIngredients = (oldF.ingredients || []).map(ing => {
            const resolvedLocal = resolveMaterialByKey(ing.rawMaterialId);
            const localEnt = resolvedLocal.item || resolvedLocal.wip;
            if (localEnt) {
              return { ...ing, rawMaterialId: getMaterialFormulaKey(localEnt) };
            }
            const oldMat = db.items.find(i => doesIngredientMatchMaterial(ing.rawMaterialId, i))
              || db.products.find(p => p.isWip && doesIngredientMatchMaterial(ing.rawMaterialId, p));
            if (oldMat) {
              const matchedLocal = (oldMat.accountId && (
                rawItems.find(i => i.accountId && normalizeAccountingCode(i.accountId) === normalizeAccountingCode(oldMat.accountId)) ||
                products.find(p => p.isWip && p.accountId && normalizeAccountingCode(p.accountId) === normalizeAccountingCode(oldMat.accountId))
              )) || rawItems.find(i => i.name === oldMat.name) || products.find(p => p.isWip && p.name === oldMat.name);
              if (matchedLocal) {
                return { ...ing, rawMaterialId: getMaterialFormulaKey(matchedLocal) };
              }
              return { ...ing, rawMaterialId: getMaterialFormulaKey(oldMat) };
            }
            return { ...ing };
          });

          freshFormulas.push({
            id: nextSimpleId(freshFormulas, 'form'),
            periodId: activePeriodId,
            productId: targetProdKey,
            name: oldF.name,
            isActive: oldF.isActive,
            ingredients: mappedIngredients
          });
        }
      });

      onUpdateDb({ ...db, productFormulas: freshFormulas });
      alert('فرمول‌های تولید با موفقیت انتقال یافتند، لطفا نرخ‌گذاری قیمت تمام شده را بررسی فرمایید.');
    }
  };



  const handleAddIngredient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    if (!draftMaterialId) {
      alert('ابتدا کالا/مواد خام ورودی را انتخاب فرمایید.');
      return;
    }

    if (draftMaterialQty <= 0) {
      alert('مقدار مصرف ماده مصرفی باید بزرگتر از صفر باشد.');
      return;
    }

    const matchedRecipeObj = activeFormulaData;
    let updatedFormulas = [...db.productFormulas];
    const resolvedDraftEnt = selectedDraftMaterial?.rawItem || resolveMaterialByKey(draftMaterialId).wip || resolveMaterialByKey(draftMaterialId).item;
    const matKey = resolvedDraftEnt
      ? getMaterialFormulaKey(resolvedDraftEnt)
      : (normalizeAccountingCode(draftMaterialId) || draftMaterialId);
    const prodKey = selectedProductFormulaKey;

    const newIngredientItem: ProductFormulaItem = {
      rawMaterialId: matKey,
      quantity: draftMaterialQty
    };

    if (matchedRecipeObj) {
      let ingredients = [...matchedRecipeObj.ingredients];
      if (editingMaterialId) {
        const normEdit = normalizeAccountingCode(editingMaterialId);
        ingredients = ingredients.filter(x => x.rawMaterialId !== editingMaterialId && (!normEdit || normalizeAccountingCode(x.rawMaterialId) !== normEdit));
      }
      
      const normMatKey = normalizeAccountingCode(matKey);
      const existsIndex = ingredients.findIndex(x => x.rawMaterialId === matKey || (normMatKey && normalizeAccountingCode(x.rawMaterialId) === normMatKey));
      if (existsIndex >= 0) {
        ingredients[existsIndex] = newIngredientItem;
      } else {
        ingredients.push(newIngredientItem);
      }

      updatedFormulas = updatedFormulas.map(f => f.id === matchedRecipeObj.id ? { ...f, productId: prodKey, ingredients } : f);
    } else {
      updatedFormulas.push({
        id: nextSimpleId(updatedFormulas, 'form'),
        periodId: activePeriodId,
        productId: prodKey,
        ingredients: [newIngredientItem]
      });
    }

    onUpdateDb({ ...db, productFormulas: updatedFormulas });

    // Reset rows
    setDraftMaterialId('');
    setDraftMaterialQty(0);
    setEditingMaterialId(null);
  };

  const deleteIngredient = (rawMatId: string) => {
    if (!activeFormulaData) return;
    if (confirm('آیا مایل به حذف این ماده مصرفی از فرمول هستید؟')) {
      const normDel = normalizeAccountingCode(rawMatId);
      const updatedIngredients = activeFormulaData.ingredients.filter(x =>
        x.rawMaterialId !== rawMatId && (!normDel || normalizeAccountingCode(x.rawMaterialId) !== normDel)
      );
      onUpdateDb({
        ...db,
        productFormulas: db.productFormulas.map(f => f.id === activeFormulaData.id ? { ...f, ingredients: updatedIngredients } : f)
      });
    }
  };

  const handleCopyFormulationFromProduct = (sourceProductId: string) => {
    if (!selectedProductId) return;
    if (!sourceProductId) {
      alert('لطفاً ابتدا یک کالا به عنوان منبع انتخاب نمایید.');
      return;
    }

    const sourceProduct = products.find(p => p.id === sourceProductId);

    // Strictly search in the active period's formulas
    const currentPeriodSourceFormulas = formulas.filter(f =>
      sourceProduct ? doesFormulaMatchProduct(f.productId, sourceProduct) : f.productId === sourceProductId
    );
    const sourceFormulaObj = currentPeriodSourceFormulas.find(f => f.isActive && f.ingredients.length > 0)
      || currentPeriodSourceFormulas.find(f => f.ingredients.length > 0)
      || currentPeriodSourceFormulas[0];

    if (!sourceFormulaObj || !sourceFormulaObj.ingredients || sourceFormulaObj.ingredients.length === 0) {
      alert('کالای منبع انتخاب‌شده در دوره فعال فاقد فرمولاسیون یا ماده مصرفی می‌باشد.');
      return;
    }

    const sourceName = sourceProduct ? sourceProduct.name : 'کالای منبع';

    if (confirm(`آیا مایل به کپی کردن فرمول ساخت کالا از "${sourceName}" برای کالای جاری (${selectedProductData?.name || ''}) هستید؟ این عملیات جایگزین مواد مصرفی فعلی کالای جاری خواهد شد.`)) {
      const activeFormula = activeFormulaData;
      let updatedFormulas = [...db.productFormulas];

      const duplicatedIngredients = sourceFormulaObj.ingredients.map(ing => {
        const resolved = resolveMaterialByKey(ing.rawMaterialId);
        const ent = resolved.item || resolved.wip;
        return {
          ...ing,
          rawMaterialId: ent ? getMaterialFormulaKey(ent) : ing.rawMaterialId
        };
      });

      if (activeFormula) {
        updatedFormulas = updatedFormulas.map(f => 
          f.id === activeFormula.id ? { ...f, productId: selectedProductFormulaKey, ingredients: duplicatedIngredients } : f
        );
      } else {
        updatedFormulas.push({
          id: nextSimpleId(updatedFormulas, 'form'),
          periodId: activePeriodId,
          productId: selectedProductFormulaKey,
          ingredients: duplicatedIngredients,
          name: 'فرمول اصلی',
          isActive: true
        });
      }

      onUpdateDb({ ...db, productFormulas: updatedFormulas });
      setCopySourceProductId('');
      alert('فرمولاسیون با موفقیت کپی و جایگزین گردید.');
    }
  };

  const handleAddTimelineNode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!timelineProductId || timelineDuration <= 0 || timelineProducedQty <= 0) {
      alert('لطفاً مشخصات ردیف تولید را کامل و صحیح وارد نمایید.');
      return;
    }

    const segments = db.dailyProductionSegments || [];
    let updated: DailyProductionSegment[];

    const h = Math.floor(timelineDuration / 60);
    const m = timelineDuration % 60;
    const startTimeStr = "00:00";
    const endTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    if (editingSegmentId) {
      updated = segments.map(s => s.id === editingSegmentId ? {
        ...s,
        productId: timelineProductId,
        startTime: startTimeStr,
        endTime: endTimeStr,
        producedQty: timelineProducedQty
      } : s);
    } else {
      updated = [
        ...segments,
        {
          id: nextSimpleId(segments, 'seg'),
          periodId: activePeriodId,
          productId: timelineProductId,
          startTime: startTimeStr,
          endTime: endTimeStr,
          producedQty: timelineProducedQty
        }
      ];
    }

    onUpdateDb({
      ...db,
      dailyProductionSegments: updated
    });

    // Reset input fields
    setTimelineProductId('');
    setTimelineDuration(0);
    setTimelineProducedQty(0);
    setEditingSegmentId(null);
  };

  const deleteTimelineNode = (id: string) => {
    if (confirm('آیا مایل به حذف این بخش زمانی از برنامه تولید هستید؟')) {
      const segments = db.dailyProductionSegments || [];
      onUpdateDb({
        ...db,
        dailyProductionSegments: segments.filter(s => s.id !== id)
      });
    }
  };

  // Automatic & manual COGS catalog sync — locks purchaseCost for non-formula purchased goods & prevents infinite update loops
  const latestDbRef = React.useRef(db);
  latestDbRef.current = db;
  const onUpdateDbRef = React.useRef(onUpdateDb);
  onUpdateDbRef.current = onUpdateDb;
  const lastAutoSyncSignatureRef = React.useRef<string>('');

  const syncCalculatedCogsToCatalog = React.useCallback((showToast?: boolean, isAutoEffect?: boolean) => {
    if (!activePeriodId) return;
    const currentDb = latestDbRef.current;
    let hasDiff = false;
    let periodCount = 0;
    let updatedCount = 0;
    const sigParts: string[] = [`${activePeriodId}|${selectedCogsYear}|${selectedCogsMonth}`];

    const updatedProducts = (currentDb.products || []).map(p => {
      if (p.periodId !== activePeriodId) return p;
      periodCount++;
      const hasFormula = formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0);
      const calcEntry = fullCalculatedCOGSMap[p.id];
      const currentCogs = Number.isFinite(Number(p.cogsPrice)) ? Math.round(Number(p.cogsPrice)) : 0;
      const nextCogs = calcEntry !== undefined && Number.isFinite(calcEntry.totalCOGSPrice)
        ? Math.round(calcEntry.totalCOGSPrice)
        : currentCogs;

      const hasStoredPurchaseCost =
        p.purchaseCost !== undefined &&
        p.purchaseCost !== null &&
        Number.isFinite(Number(p.purchaseCost));
      const nextPurchaseCost = !hasFormula
        ? (hasStoredPurchaseCost ? Math.max(0, Math.round(Number(p.purchaseCost))) : getPurchasedBaseCost(p))
        : undefined;

      sigParts.push(`${p.id}:${nextCogs}:${hasFormula ? '-' : nextPurchaseCost}`);

      const cogsChanged = p.cogsPrice !== nextCogs;
      const saleChanged = Boolean(p.isWip) && p.salePrice !== nextCogs;
      const purchaseCostChanged =
        !hasFormula &&
        (!hasStoredPurchaseCost || Number(p.purchaseCost) !== nextPurchaseCost);

      if (cogsChanged || saleChanged || purchaseCostChanged) {
        hasDiff = true;
        updatedCount++;
        return {
          ...p,
          ...(!hasFormula ? { purchaseCost: nextPurchaseCost } : {}),
          cogsPrice: nextCogs,
          ...(p.isWip ? { salePrice: nextCogs } : {})
        };
      }
      return p;
    });

    const signature = sigParts.join(';');
    if (isAutoEffect && signature === lastAutoSyncSignatureRef.current) {
      return;
    }

    if (hasDiff) {
      lastAutoSyncSignatureRef.current = signature;
      onUpdateDbRef.current({ ...currentDb, products: updatedProducts });
    } else if (isAutoEffect) {
      lastAutoSyncSignatureRef.current = signature;
    }

    if (showToast) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setRecalcFeedback({ total: periodCount, updated: updatedCount, time: timeStr });
    }
  }, [activePeriodId, selectedCogsYear, selectedCogsMonth, formulas, fullCalculatedCOGSMap, getPurchasedBaseCost]);

  // Push Calculated COGS Price to master Product catalog
  const applyCogsPricesToProductCatalog = () => {
    lastAutoSyncSignatureRef.current = '';
    syncCalculatedCogsToCatalog(true, false);
  };

  // Explicit user-triggered recalculation button handler
  const handleRecalculateCogs = () => {
    lastAutoSyncSignatureRef.current = '';
    setRecalcTrigger(prev => prev + 1);
    syncCalculatedCogsToCatalog(true, false);
  };

  const handleSavePurchaseCost = () => {
    if (!selectedProductId) return;
    const parsed = parseFloat(toEnglishDigits(tempPurchaseCost).replace(/,/g, ''));
    const nextBaseCost = isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed);
    const updatedProducts = db.products.map(p =>
      p.id === selectedProductId
        ? { ...p, purchaseCost: nextBaseCost }
        : p
    );
    lastAutoSyncSignatureRef.current = '';
    onUpdateDbRef.current({ ...db, products: updatedProducts });
    setIsEditingPurchaseCost(false);
    setRecalcTrigger(prev => prev + 1);
  };

  const handleToggleProductPurchased = (productId: string) => {
    const target = db.products.find(p => p.id === productId);
    if (!target) return;
    const nextPurchased = !isProductPurchased(target);
    const updatedProducts = db.products.map(p =>
      p.id === productId
        ? { ...p, isPurchased: nextPurchased }
        : p
    );
    lastAutoSyncSignatureRef.current = '';
    onUpdateDbRef.current({ ...db, products: updatedProducts });
    setRecalcTrigger(prev => prev + 1);
  };

  React.useEffect(() => {
    setIsEditingPurchaseCost(false);
    setTempPurchaseCost('');
  }, [selectedProductId]);

  React.useEffect(() => {
    syncCalculatedCogsToCatalog(false, true);
  }, [syncCalculatedCogsToCatalog]);


  // ==========================================
  // TAB 2: UNIT CONVERSION MANAGEMENT
  // ==========================================
  const [convSearch, setConvSearch] = useState('');
  const [newConvMatId, setNewConvMatId] = useState('');
  const [newConvPUnit, setNewConvPUnit] = useState('بسته');
  const [newConvCUnit, setNewConvCUnit] = useState('عدد');
  const [newConvFactor, setNewConvFactor] = useState(12);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);

  const searchedConversions = useMemo(() => {
    // Only show number-based conversions to keep user interface clean and avoid showing automatic kg conversions
    const filteredConvs = conversions.filter(c => {
      const r = rawItemMap[c.rawMaterialId];
      return r && r.unit === 'عددی';
    });
    if (!convSearch) return filteredConvs;
    return filteredConvs.filter(c => {
      const r = rawItemMap[c.rawMaterialId];
      return r ? matchPersianString(r.name, convSearch) || matchPersianString(r.code, convSearch) : false;
    });
  }, [conversions, convSearch, rawItemMap]);

  const handleAddConversion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConvMatId) {
      alert('لطفا ابتدا کالا/مواد خام ورودی را انتخاب فرمایید.');
      return;
    }

    if (editingConvId) {
      onUpdateDb({
        ...db,
        unitConversions: db.unitConversions.map(c =>
          c.id === editingConvId
            ? {
                ...c,
                rawMaterialId: newConvMatId,
                purchaseUnit: newConvPUnit,
                consumptionUnit: newConvCUnit,
                factor: newConvFactor
              }
            : c
        )
      });
      setNewConvMatId('');
      setEditingConvId(null);
    } else {
      if (conversions.some(c => c.rawMaterialId === newConvMatId)) {
        alert('ضریب تبدیل واحد برای این ماده خام قبلاً تعریف شده است.');
        return;
      }

      onUpdateDb({
        ...db,
        unitConversions: [...db.unitConversions, {
          id: nextSimpleId(db.unitConversions, 'conv'),
          periodId: activePeriodId,
          rawMaterialId: newConvMatId,
          purchaseUnit: newConvPUnit,
          consumptionUnit: newConvCUnit,
          factor: newConvFactor
        }]
      });
      setNewConvMatId('');
    }
  };

  const startEditConversion = (conv: any) => {
    setEditingConvId(conv.id);
    setNewConvMatId(conv.rawMaterialId);
    setNewConvPUnit(conv.purchaseUnit);
    setNewConvCUnit(conv.consumptionUnit);
    setNewConvFactor(conv.factor);
  };

  const cancelEditConversion = () => {
    setEditingConvId(null);
    setNewConvMatId('');
    setNewConvPUnit('بسته');
    setNewConvCUnit('عدد');
    setNewConvFactor(12);
  };

  const deleteConversion = (id: string) => {
    if (confirm('آیا مایل به حذف این ضریب تبدیل واحد هستید؟')) {
      onUpdateDb({
        ...db,
        unitConversions: db.unitConversions.filter(c => c.id !== id)
      });
      if (editingConvId === id) {
        cancelEditConversion();
      }
    }
  };

  const exportConversionsCSV = () => {
    const headers = ['کد ماده اولیه', 'نام کالا', 'واحد خرید', 'واحد فرمول مصرفی', 'ضریب تبدیل'];
    const rows = conversions.map(c => {
      const r = rawItemMap[c.rawMaterialId];
      return [r?.accountId || r?.code || '', r?.name || '', c.purchaseUnit, c.consumptionUnit, c.factor];
    });
    downloadCSV('Gatan_Unit_Conversions', headers, rows);
  };

  const handleImportConversionsCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) {
          alert('فایل یا خوانده نشد یا فاقد داده است.');
          return;
        }

        const text = decodeFileBuffer(buffer);
        const rows = parseCSVText(text);
        if (rows.length <= 1) {
          alert('داده‌های ضریب تبدیل معتبری یافت نشد.');
          return;
        }

        const rawItemByAccountId: Record<string, Item> = {};
        const rawItemByCode: Record<string, Item> = {};
        const rawItemByName: Record<string, Item> = {};
        rawItems.forEach(item => {
          if (item.accountId) {
            rawItemByAccountId[item.accountId.trim().toLowerCase()] = item;
          }
          rawItemByCode[item.code.trim().toLowerCase()] = item;
          rawItemByName[item.name.trim().toLowerCase()] = item;
        });

        const newConversions = [...db.unitConversions];
        let loadedRowsCount = 0;
        let skippedRowsCount = 0;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 5) {
            skippedRowsCount++;
            continue;
          }

          const matCode = row[0].trim();
          const matName = row[1].trim();
          const pUnit = row[2].trim();
          const cUnit = row[3].trim();
          const factorVal = parseNumber(row[4]);

          if (factorVal <= 0) {
            skippedRowsCount++;
            continue;
          }

          let matchedRaw = rawItemByAccountId[matCode.toLowerCase()];
          if (!matchedRaw) {
            matchedRaw = rawItemByCode[matCode.toLowerCase()];
          }
          if (!matchedRaw) {
            matchedRaw = rawItemByName[matName.toLowerCase()];
          }
          if (!matchedRaw) {
            matchedRaw = rawItemByName[matCode.toLowerCase()];
          }

          if (matchedRaw) {
            const idx = newConversions.findIndex(c => c.periodId === activePeriodId && c.rawMaterialId === matchedRaw.id);
            if (idx >= 0) {
              newConversions.splice(idx, 1);
            }
            newConversions.push({
              id: nextSimpleId(newConversions, 'conv'),
              periodId: activePeriodId,
              rawMaterialId: matchedRaw.id,
              purchaseUnit: pUnit || 'کیلویی',
              consumptionUnit: cUnit || 'گرم',
              factor: factorVal
            });
            loadedRowsCount++;
          } else {
            skippedRowsCount++;
          }
        }

        if (loadedRowsCount === 0) {
          alert('هیچ سطری از ضریب تبدیل با شناسه یا نام کالا در دیتابیس تطابق نداشت. لطفاً کدهای کالا را کنترل بفرمایید.');
          return;
        }

        onUpdateDb({
          ...db,
          unitConversions: newConversions
        });

        alert(`عملیات با موفقیت پایان یافت!\nتعداد ${loadedRowsCount} ضریب تبدیل واحد ثبت شد.\nتعداد ${skippedRowsCount} رکورد نامعتبر یا نادیده گرفته شد.`);
        e.target.value = '';
      } catch (err: any) {
        console.error(err);
        alert(`خطا در پردازش فایل: ${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportTimelineCSV = () => {
    const headers = ['کد محصول', 'نام محصول', 'مدت زمان تولید (دقیقه)', 'تعداد یا وزن تولید'];
    const rows = periodSegments.map(seg => {
      const p = productMap[seg.productId];
      const start = parseTimeToMinutes(seg.startTime);
      const end = parseTimeToMinutes(seg.endTime);
      const minutes = Math.max(0, end - start);
      return [p?.accountId || p?.code || '', p?.name || '', minutes, seg.producedQty];
    });
    
    if (rows.length === 0) {
      if (confirm('شما هنوز هیچ رکورد تولیدی ثبت نکرده‌اید. مایل به دانلود قالب خالی هستید؟')) {
        const sampleRows = [
          ['P-101', 'کلوچه کنجدی مینی', '45', '150'],
          ['P-102', 'بیسکوئیت رژیمی جو', '60', '80']
        ];
        downloadCSV('Gatan_Production_Timeline_Template', headers, sampleRows);
      }
    } else {
      downloadCSV('Gatan_Production_Timeline', headers, rows);
    }
  };

  const handleImportTimelineCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) {
          alert('فایل خالی یا فاقد داده است.');
          return;
        }

        const text = decodeFileBuffer(buffer);
        const rows = parseCSVText(text);
        if (rows.length <= 1) {
          alert('داده‌ای در فایل یافت نشد.');
          return;
        }

        const productByAccountId: Record<string, Product> = {};
        const productByCode: Record<string, Product> = {};
        const productByName: Record<string, Product> = {};
        products.forEach(p => {
          if (p.accountId) {
            productByAccountId[p.accountId.trim().toLowerCase()] = p;
          }
          productByCode[p.code.trim().toLowerCase()] = p;
          productByName[p.name.trim().toLowerCase()] = p;
        });

        const segments = db.dailyProductionSegments || [];
        const otherSegments = segments.filter(s => s.periodId !== activePeriodId);
        const importedSegments: DailyProductionSegment[] = [];

        let loadedRowsCount = 0;
        let skippedRowsCount = 0;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 4) {
            skippedRowsCount++;
            continue;
          }

          const prodCode = row[0].trim();
          const prodName = row[1].trim();
          const durationVal = parseNumber(row[2]);
          const producedQtyVal = parseNumber(row[3]);

          if (durationVal <= 0 || producedQtyVal <= 0) {
            skippedRowsCount++;
            continue;
          }

          let matchedProduct = productByAccountId[prodCode.toLowerCase()];
          if (!matchedProduct) {
            matchedProduct = productByCode[prodCode.toLowerCase()];
          }
          if (!matchedProduct) {
            matchedProduct = productByName[prodName.toLowerCase()];
          }
          if (!matchedProduct) {
            matchedProduct = productByName[prodCode.toLowerCase()];
          }

          if (matchedProduct) {
            const h = Math.floor(durationVal / 60);
            const m = durationVal % 60;
            const startTimeStr = "00:00";
            const endTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

            importedSegments.push({
              id: nextSimpleId([...otherSegments, ...importedSegments], 'seg'),
              periodId: activePeriodId,
              productId: matchedProduct.id,
              startTime: startTimeStr,
              endTime: endTimeStr,
              producedQty: producedQtyVal
            });
            loadedRowsCount++;
          } else {
            skippedRowsCount++;
          }
        }

        if (loadedRowsCount === 0) {
          alert('هیچ رکوردی با کد یا نام محصول معتبر تطبیق نداشت. لطفاً کد محصولات را کنترل کنید.');
          return;
        }

        onUpdateDb({
          ...db,
          dailyProductionSegments: [...otherSegments, ...importedSegments]
        });

        alert(`عملیات بارگذاری تولید زمان‌محور پایان یافت!\nتعداد ${loadedRowsCount} رکورد با موفقیت وارد گردید.\nتعداد ${skippedRowsCount} سطر نادیده گرفته شد.`);
        e.target.value = '';
      } catch (err: any) {
        console.error(err);
        alert(`خطا در گشایش فایل: ${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportFormulasCSV = () => {
    const headers = ['کد حسابداری محصول', 'نام محصول', 'کد معین ماده اولیه', 'نام ماده اولیه', 'حجم مصرفی در فرمول پخت'];
    const rows: any[][] = [];
    formulas.forEach(f => {
      const p = resolveProductByFormulaKey(f.productId);
      const prodCodeOut = p ? getProductFormulaKey(p) : f.productId;
      const prodNameOut = p ? p.name : 'محصول حذف‌شده';
      f.ingredients.forEach(ing => {
        const resolved = resolveMaterialByKey(ing.rawMaterialId);
        const item = resolved.item || resolved.wip;
        rows.push([
          prodCodeOut || '',
          prodNameOut,
          item ? getMaterialFormulaKey(item) : ing.rawMaterialId,
          item?.name || 'ماده اولیه حذف‌شده',
          ing.quantity
        ]);
      });
    });

    if (rows.length === 0) {
      if (confirm('هیچ فرمول ساخت فعالی در این دوره به ثبت نرسیده است. آیا مایل به بارگیری الگوی خام شیت فرمولاسیون هستید؟')) {
        const sampleRows = [
          ['201001', 'کلوچه کنجدی مینی', '102001', 'آرد مرغوب غلات', '120'],
          ['201001', 'کلوچه کنجدی مینی', '102002', 'روغن مارگارین قنادی', '40'],
          ['201002', 'بیسکوئیت رژیمی جو', '102001', 'آرد مرغوب غلات', '90'],
          ['201002', 'بیسکوئیت رژیمی جو', '102003', 'سبوس خام جو دوسر', '60']
        ];
        downloadCSV('Gatan_Formulas_Template', headers, sampleRows);
      }
    } else {
      downloadCSV('Gatan_Formulas_Active_Period', headers, rows);
    }
  };

  const handleImportFormulasCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        if (!buffer) {
          alert('فایل یا خوانده نشد یا فاقد داده است.');
          return;
        }

        const text = decodeFileBuffer(buffer);
        const rows = parseCSVText(text);
        if (rows.length <= 1) {
          alert('داده‌های فرمول معتبری یافت نشد.');
          return;
        }

        const prodFormMap: Record<string, ProductFormulaItem[]> = {};

        // Build mapping registers
        const productByAccountId: Record<string, Product> = {};
        const productByCode: Record<string, Product> = {};
        const productByName: Record<string, Product> = {};
        products.forEach(p => {
          if (p.accountId) {
            productByAccountId[normalizeAccountingCode(p.accountId).toLowerCase()] = p;
          }
          if (p.code) {
            productByCode[normalizeAccountingCode(p.code).toLowerCase()] = p;
          }
          productByName[p.name.trim().toLowerCase()] = p;
        });

        const matByAccountId: Record<string, Item | Product> = {};
        const matByCode: Record<string, Item | Product> = {};
        const matByName: Record<string, Item | Product> = {};
        rawItems.forEach(item => {
          if (item.accountId) {
            matByAccountId[normalizeAccountingCode(item.accountId).toLowerCase()] = item;
          }
          if (item.code) {
            matByCode[normalizeAccountingCode(item.code).toLowerCase()] = item;
          }
          matByName[item.name.trim().toLowerCase()] = item;
        });
        products.filter(p => p.isWip).forEach(wip => {
          if (wip.accountId && !matByAccountId[normalizeAccountingCode(wip.accountId).toLowerCase()]) {
            matByAccountId[normalizeAccountingCode(wip.accountId).toLowerCase()] = wip;
          }
          if (wip.code && !matByCode[normalizeAccountingCode(wip.code).toLowerCase()]) {
            matByCode[normalizeAccountingCode(wip.code).toLowerCase()] = wip;
          }
          if (!matByName[wip.name.trim().toLowerCase()]) {
            matByName[wip.name.trim().toLowerCase()] = wip;
          }
        });

        let loadedRowsCount = 0;
        let skippedRowsCount = 0;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 5) {
            skippedRowsCount++;
            continue;
          }

          const prodCodeRaw = normalizeAccountingCode(row[0]);
          const prodName = row[1].trim();
          const matCodeRaw = normalizeAccountingCode(row[2]);
          const matName = row[3].trim();
          const qtyVal = parseNumber(row[4]);

          if (qtyVal <= 0) {
            skippedRowsCount++;
            continue;
          }

          let matchedProduct = productByAccountId[prodCodeRaw.toLowerCase()];
          if (!matchedProduct) {
            matchedProduct = productByCode[prodCodeRaw.toLowerCase()];
          }
          if (!matchedProduct) {
            matchedProduct = productByName[prodName.toLowerCase()];
          }
          if (!matchedProduct) {
            matchedProduct = productByName[prodCodeRaw.toLowerCase()];
          }

          let matchedMat = matByAccountId[matCodeRaw.toLowerCase()];
          if (!matchedMat) {
            matchedMat = matByCode[matCodeRaw.toLowerCase()];
          }
          if (!matchedMat) {
            matchedMat = matByName[matName.toLowerCase()];
          }
          if (!matchedMat) {
            matchedMat = matByName[matCodeRaw.toLowerCase()];
          }

          const prodKey = matchedProduct ? getProductFormulaKey(matchedProduct) : prodCodeRaw;
          const matKey = matchedMat ? getMaterialFormulaKey(matchedMat) : matCodeRaw;

          if (prodKey && matKey) {
            if (!prodFormMap[prodKey]) {
              prodFormMap[prodKey] = [];
            }
            const existingIdx = prodFormMap[prodKey].findIndex(ing => normalizeAccountingCode(ing.rawMaterialId) === normalizeAccountingCode(matKey));
            if (existingIdx >= 0) {
              prodFormMap[prodKey][existingIdx].quantity = qtyVal;
            } else {
              prodFormMap[prodKey].push({
                rawMaterialId: matKey,
                quantity: qtyVal
              });
            }
            loadedRowsCount++;
          } else {
            skippedRowsCount++;
          }
        }

        if (loadedRowsCount === 0) {
          alert('هیچ سطری از فرمول با شناسه کالاها یا محصولات موجود در دیتابیس تطابق نداشت. لطفاً کدهای حسابداری کالا و فرآورده را کنترل بفرمایید.');
          return;
        }

        const otherPeriodFormulas = db.productFormulas.filter(f => f.periodId !== activePeriodId);
        const nextImpFormId = createSimpleIdGenerator(otherPeriodFormulas, 'form');
        const importedPeriodFormulas: ProductFormula[] = Object.keys(prodFormMap).map((prodKey) => ({
          id: nextImpFormId(),
          periodId: activePeriodId,
          productId: prodKey,
          ingredients: prodFormMap[prodKey]
        }));

        onUpdateDb({
          ...db,
          productFormulas: [...otherPeriodFormulas, ...importedPeriodFormulas]
        });

        alert(`عملیات با موفقیت پایان یافت!\nتعداد ${loadedRowsCount} متریال به فرمول ساخت محصولات فعال این دوره تخصیص یافت.\nتعداد ${skippedRowsCount} رکورد نامعتبر یا نادیده گرفته شد.`);
        e.target.value = '';
      } catch (err: any) {
        console.error(err);
        alert(`خطا در گشایش دیتای فایل: ${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Inline Modifier Action for raw material catalog
  const handleSaveInlineItemEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItemInline) return;

    onUpdateDb({
      ...db,
      items: db.items.map(i => i.id === editingItemInline.id ? editingItemInline : i)
    });
    setEditingItemInline(null);
    alert('اطلاعات ماده اولیه با موفقیت اصلاح شد و محاسبات بهای تولید فرآوری گردید.');
  };

  // Memoized departmental monthly direct labor wages (for selected month)
  const departmentDirectLaborPayroll = useMemo(() => {
    const map: Record<string, number> = {};
    departments.forEach(dept => {
      map[dept.id] = 0;
    });
    payrollItems.forEach(payItem => {
      const alloc = allocationLookupByEmpCode.get(payItem.employeeCode);
      if (!alloc || !alloc.departmentCategoryId) return;
      const cost = getPayrollItemTotalCost(payItem);
      if (isSharedDeptId(alloc.departmentCategoryId)) {
        map[sharedCanonicalCatId] = (map[sharedCanonicalCatId] || 0) + cost;
        return;
      }
      const canonicalDeptId = resolveCanonicalCategoryId(alloc.departmentCategoryId);
      const matchedDept = departments.find(d => !isSharedDeptId(d.id) && d.id === canonicalDeptId);
      if (matchedDept) {
        map[matchedDept.id] = (map[matchedDept.id] || 0) + cost;
      } else {
        map[sharedCanonicalCatId] = (map[sharedCanonicalCatId] || 0) + cost;
      }
    });
    return map;
  }, [payrollItems, departments, allocationLookupByEmpCode, isSharedDeptId, resolveCanonicalCategoryId, sharedCanonicalCatId]);


  const downloadSampleFormulasExcel = () => {
    downloadTemplateExcel(
      ['کد محصول', 'نام محصول', 'کد ماده اولیه', 'نام ماده اولیه', 'مقدار مصرف', 'واحد'],
      [
        { 'کد محصول': '1001', 'نام محصول': 'نان باگت فرانسوی', 'کد ماده اولیه': 'M-101', 'نام ماده اولیه': 'آرد نانوایی', 'مقدار مصرف': 0.35, 'واحد': 'کیلوگرم' },
      ],
      'فرمولاسیون',
      'نمونه_فرمولاسیون_محصولات'
    );
  };

  const downloadSampleConversionsExcel = () => {
    downloadTemplateExcel(
      ['نام ماده اولیه', 'واحد خرید', 'واحد مصرف', 'ضریب تبدیل'],
      [
        { 'نام ماده اولیه': 'آرد نانوایی', 'واحد خرید': 'کیسه', 'واحد مصرف': 'کیلوگرم', 'ضریب تبدیل': 40 },
      ],
      'ضرایب تبدیل',
      'نمونه_ضرایب_تبدیل'
    );
  };

  const downloadSampleTimelineExcel = () => {
    downloadTemplateExcel(
      ['تاریخ شروع', 'تاریخ پایان', 'عنوان بازه'],
      [
        { 'تاریخ شروع': '1404/01/01', 'تاریخ پایان': '1404/01/31', 'عنوان بازه': 'بازه اول فروردین' },
      ],
      'تولید زمان‌محور',
      'نمونه_تولید_زمان_محور'
    );
  };

  const downloadSampleWipExcel = () => {
    downloadTemplateExcel(
      ['کد محصول', 'نام نیمه‌ساخته', 'واحد', 'مقدار تولید'],
      [
        { 'کد محصول': 'WIP-101', 'نام نیمه‌ساخته': 'خمیر پایه شیرینی', 'واحد': 'کیلوگرم', 'مقدار تولید': 10 },
      ],
      'WIP',
      'نمونه_نیمه_ساخته_WIP'
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12 text-right font-sans selection:bg-rose-500 selection:text-white" dir="rtl">
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <ModuleHeader
          icon={<Calculator className="w-5 h-5" />}
          title={`کنترل و محاسبات بهای تمام شده کارگاهی (COGS) — ${PERSIAN_MONTHS[selectedCogsMonth - 1]} ${toPersianDigits(selectedCogsYear)}`}
          subtitle="فرآوری آنلاین مواد مصرفی (BOM)، حقوق مستقیم دپارتمانی، سهم حقوق مشترک و سربار تولید بر مبنای دوره فعال"
          periodName={activePeriodObj?.name}
          recordCount={globalCOGSStats.formulatedCount}
          recordLabel="فرمول فعال"
          actions={
            <ErpButton variant="secondary" size="sm" icon={<Copy className="w-3.5 h-3.5" />} onClick={() => setShowCopyModal(true)}>
              {ERP_BUTTON_LABELS.copyFromPeriod}
            </ErpButton>
          }
        />

        <ModulePrimaryTabs
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as typeof activeTab)}
          tabs={[
            { id: 'formulas', label: 'فرمولاسیون و بهای تمام‌شده', icon: <Calculator className="h-4 w-4" />, count: formulas.length },
            { id: 'timeline', label: 'تولید و تسهیم زمان‌محور', icon: <Clock className="h-4 w-4" />, count: periodSegments.length },
            { id: 'conversions', label: 'ضریب تبدیل واحدها', icon: <ArrowLeftRight className="h-4 w-4" />, count: conversions.length },
            { id: 'analytics', label: 'تحلیل سود و زیان', icon: <DollarSign className="h-4 w-4" /> },
            { id: 'comparison', label: 'مقایسه عملکرد', icon: <Activity className="h-4 w-4" /> },
            { id: 'pricing', label: 'شبیه‌ساز قیمت‌گذاری', icon: <TrendingUp className="h-4 w-4" /> },
            { id: 'wip', label: 'کالای در جریان ساخت (WIP)', icon: <Layers className="h-4 w-4" />, count: products.filter(p => p.isWip).length }
          ]}
        />
      </div>

      {/* Main Content Card */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right" dir="rtl">
        <KpiStrip
          items={[
            { label: `سربار تولید (${PERSIAN_MONTHS[selectedCogsMonth - 1]})`, value: formatWithCommas(Math.round(globalCOGSStats.totalOverheadCost)), sublabel: 'ریال', tone: 'info' },
            { label: `حقوق و دستمزد (${PERSIAN_MONTHS[selectedCogsMonth - 1]})`, value: formatWithCommas(Math.round(globalCOGSStats.totalPayrollCost)), sublabel: 'ریال', tone: 'default' },
            { label: 'فرآورده فرموله‌شده', value: `${toPersianDigits(globalCOGSStats.formulatedCount)} / ${toPersianDigits(products.length)}`, sublabel: 'کالاهای دارای فرمول', tone: 'warning' },
            { label: 'میانگین سود ناخالص', value: `${toPersianDigits(globalCOGSStats.averageMargin.toFixed(1))}%`, sublabel: 'حاشیه سود دوره', tone: 'success' },
          ]}
        />

      {/* 0. 12-MONTH COGS SELECTOR HEADER (Positioned directly above the Cost & Payroll Allocation Table button) */}
      <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 shadow-xl space-y-4 mb-4" dir="rtl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-850/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-500 rounded-2xl shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="space-y-0.5 text-right">
              <h4 className="text-sm font-black text-white flex items-center gap-2 flex-wrap">
                <span>انتخاب ماه جهت محاسبه و تحلیل قیمت تمام شده (COGS):</span>
                <span className="text-rose-400 font-extrabold">{PERSIAN_MONTHS[selectedCogsMonth - 1]} {toPersianDigits(selectedCogsYear)}</span>
              </h4>
              <p className="text-[10.5px] text-slate-400">
                با انتخاب هر ماه، تسهیم هزینه‌ها، حقوق مستقیم و مشترک و محاسبات بهای تمام‌شده به‌صورت خودکار بر اساس داده‌های همان ماه انجام و در سیستم اعمال می‌شود
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-1.5 shadow-inner" title="سال مالی بر اساس دوره فعال در مدیریت دوره‌های زمانی و مالی تعیین شده است">
              <span className="text-[10.5px] text-slate-400 font-bold">سال مالی دوره:</span>
              <span className="text-xs font-black text-rose-400 font-mono">
                {toPersianDigits(selectedCogsYear)}
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
            const isSelected = selectedCogsMonth === monthNum;
            const mStats = monthlyCogsReadinessStats[monthNum] || {
              salesCount: 0,
              netSales: 0,
              payrollCount: 0,
              payrollCost: 0,
              hasOverhead: false,
              overheadNet: 0
            };
            const isReadyAll = mStats.salesCount > 0 && mStats.payrollCount > 0 && mStats.hasOverhead;
            const hasAnyData = mStats.salesCount > 0 || mStats.payrollCount > 0 || mStats.hasOverhead;

            return (
              <button
                key={monthNum}
                type="button"
                onClick={() => setSelectedCogsMonth(monthNum)}
                className={`p-2.5 rounded-2xl border transition-all text-right flex flex-col justify-between gap-1.5 cursor-pointer relative ${
                  isSelected
                    ? 'bg-rose-950/50 border-rose-500 shadow-md shadow-rose-950/30 ring-2 ring-rose-500/50'
                    : isReadyAll
                      ? 'bg-slate-900/80 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-slate-900'
                      : hasAnyData
                        ? 'bg-slate-900/60 border-amber-500/25 hover:border-amber-500/50 hover:bg-slate-900'
                        : 'bg-slate-900/40 border-slate-850 hover:border-slate-750 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-[10px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-slate-500'}`}>
                    {toPersianDigits(monthNum)}
                  </span>
                  {isReadyAll ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" title="تکمیل (فروش + حقوق + هزینه)"></span>
                  ) : hasAnyData ? (
                    <span className="w-2 h-2 rounded-full bg-amber-400 shadow-xs shadow-amber-400/50" title="داده ناقص"></span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span>
                  )}
                </div>

                <div className="space-y-0.5">
                  <div className={`text-xs font-black truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                    {mName}
                  </div>
                  <div className="text-[9px] font-bold truncate flex items-center gap-1">
                    {mStats.salesCount > 0 ? (
                      <span className="text-emerald-400">فروش✓</span>
                    ) : (
                      <span className="text-slate-600">فروش—</span>
                    )}
                    <span className="text-slate-700">|</span>
                    {mStats.payrollCount > 0 ? (
                      <span className="text-teal-400">حقوق✓</span>
                    ) : (
                      <span className="text-slate-600">حقوق—</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Month Readiness & Summary Banner */}
        {(() => {
          const selStats = monthlyCogsReadinessStats[selectedCogsMonth] || {
            salesCount: 0,
            netSales: 0,
            payrollCount: 0,
            payrollCost: 0,
            hasOverhead: false,
            overheadNet: 0
          };
          const isComplete = selStats.salesCount > 0 && selStats.payrollCount > 0 && selStats.hasOverhead;
          return (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl shrink-0 ${
                    isComplete ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-white">
                        اطلاعات مبنای محاسبه بهای تمام‌شده ماه {PERSIAN_MONTHS[selectedCogsMonth - 1]} {toPersianDigits(selectedCogsYear)}:
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        isComplete
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-black'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                      }`}>
                        {isComplete ? '✓ تمامی مبانی ماه تکمیل است' : 'داده برخی بخش‌ها در این ماه ناقص است'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 flex items-center gap-x-5 gap-y-1 flex-wrap pt-0.5 font-sans">
                      <span>
                        فروش ماه:{' '}
                        {selStats.salesCount > 0 ? (
                          <strong className="text-emerald-400 font-mono">{toPersianDigits(selStats.salesCount)} قلم ({formatWithCommas(Math.round(selStats.netSales))} ریال)</strong>
                        ) : (
                          <strong className="text-slate-500">ثبت نشده</strong>
                        )}
                      </span>
                      <span>
                        حقوق و دستمزد ماه:{' '}
                        {selStats.payrollCount > 0 ? (
                          <strong className="text-teal-400 font-mono">{toPersianDigits(selStats.payrollCount)} نفر ({formatWithCommas(Math.round(selStats.payrollCost))} ریال)</strong>
                        ) : (
                          <strong className="text-slate-500">ثبت نشده</strong>
                        )}
                      </span>
                      <span>
                        هزینه‌ها و سربار ماه:{' '}
                        {selStats.hasOverhead ? (
                          <strong className="text-blue-400 font-mono">{formatWithCommas(Math.round(selStats.overheadNet))} ریال</strong>
                        ) : (
                          <strong className="text-slate-500">ثبت نشده</strong>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Allocation Table & Recalculate COGS Buttons directly below the 12-month selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-5 mb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setShowAllocationTableModal(true);
              setAllocationModalTab('departmental');
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 text-white font-black text-xs rounded-xl shadow-lg border border-rose-400/10 select-none cursor-pointer transition-all active:scale-98"
          >
            <FileSpreadsheet className="h-4 w-4 text-rose-100" />
            جدول تسهیم هزینه و حقوق
          </button>

          <button
            type="button"
            onClick={handleRecalculateCogs}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-xl shadow-lg border border-indigo-400/20 select-none cursor-pointer transition-all active:scale-98"
            title="بازمحاسبه کامل بهای تمام‌شده کلیه کالاها و همگام‌سازی کاتالوگ"
          >
            <RefreshCcw className="h-4 w-4 text-indigo-100" />
            محاسبه مجدد بهای تمام شده
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {recalcFeedback && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-[11px] font-bold text-emerald-300">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              محاسبه مجدد انجام شد ({toPersianDigits(recalcFeedback.total)} کالا • {toPersianDigits(recalcFeedback.updated)} تغییر • {toPersianDigits(recalcFeedback.time)})
            </span>
          )}
          <span className="text-[11px] text-emerald-400/90 font-bold">
            ✓ تسهیم خودکار بهای تمام‌شده برای ماه {PERSIAN_MONTHS[selectedCogsMonth - 1]} {toPersianDigits(selectedCogsYear)} فعال است
          </span>
        </div>
      </div>

      {/* 2. NAVIGATION AND INTERACTIVE CONTROLS */}
      <div className="space-y-3">
        <div className="space-y-3">
          {activeTab === 'formulas' && (
            <UnifiedToolbar
              onDownloadTemplate={downloadSampleFormulasExcel}
              onImportExcel={handleImportFormulasCSV}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={exportFormulasCSV}
              onPrint={() => printElement('cogs-formulas-printable', `فرمولاسیون و بهای تمام‌شده — ${PERSIAN_MONTHS[selectedCogsMonth - 1]}`)}
              extraSecondaryActions={
                <ErpButton
                  variant="primary"
                  size="sm"
                  onClick={applyCogsPricesToProductCatalog}
                  icon={<Save className="h-3.5 w-3.5" />}
                  title="ثبت بهای تمام شده محاسبه شده بر اساس فرمول در کاتالوگ (کالاهای بدون فرمول بهای صفر می‌گیرند)"
                >
                  ثبت نهایی بهای تمام شده در کاتالوگ
                </ErpButton>
              }
            />
          )}

          {activeTab === 'timeline' && (
            <UnifiedToolbar
              onDownloadTemplate={downloadSampleTimelineExcel}
              onImportExcel={handleImportTimelineCSV}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={exportTimelineCSV}
              onPrint={() => printElement('cogs-timeline-printable', `برنامه تولید زمان‌محور — ${PERSIAN_MONTHS[selectedCogsMonth - 1]}`)}
            />
          )}

          {activeTab === 'conversions' && (
            <UnifiedToolbar
              onDownloadTemplate={downloadSampleConversionsExcel}
              onImportExcel={handleImportConversionsCSV}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={exportConversionsCSV}
              onPrint={() => printElement('cogs-conversions-printable', 'ضریب تبدیل واحدها')}
            />
          )}

          {activeTab === 'analytics' && (
            <UnifiedToolbar
              onPrint={() => printElement('cogs-analytics-printable', `تحلیل سود و زیان — ${PERSIAN_MONTHS[selectedCogsMonth - 1]}`)}
            />
          )}

          {activeTab === 'comparison' && (
            <UnifiedToolbar
              onPrint={() => printElement('cogs-comparison-printable', 'مقایسه عملکرد دوره‌ای بهای تمام‌شده')}
            />
          )}

          {activeTab === 'pricing' && (
            <UnifiedToolbar
              onExportExcel={exportPricingToExcel}
              onPrint={printPricingReport}
            />
          )}

          {activeTab === 'wip' && (
            <UnifiedToolbar
              onDownloadTemplate={downloadSampleWipExcel}
              onImportExcel={handleImportWipCSV}
              importAccept=".csv,.xlsx,.xls"
              onExportExcel={exportWipToCSV}
              onPrint={() => printElement('cogs-wip-printable', 'کالای در جریان ساخت (WIP)')}
            />
          )}
        </div>
      </div>

      {/* 3. SALES INPUT & UNMAPPED CATEGORY WARNING GATES */}
      {!isSalesRegistered ? (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-amber-950/20 border border-amber-500/20 rounded-2xl flex items-start gap-3.5 text-amber-200 text-xs leading-relaxed"
        >
          <ShieldAlert className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <strong className="block text-sm font-bold text-amber-400 mb-1">پیش‌شرط ناقص: ثبت فروش ماه فعال خالی است!</strong>
            جهت تسهیم صحیح همزمان حقوق پرسنل بخش مشترک (Wages Matrix) و همچنین تخصیص بهینه هزینه‌های غیرمستقیم سربار کارخانه‌ای بر اساس مبالغ فروش محصول نهایی، لطفا ابتدا رکوردها و فاکتورهای فروش دوره فعال این ماه مالی را در بخش <span className="font-extrabold underline text-amber-400">"فروش ماهانه"</span> پورتال به صورت دستی یا فایل اکسل تکمیل بفرمایید. در حال حاضر محاسب سهم مشترک صفر تلقی می‌شود.
          </div>
        </motion.div>
      ) : (
        <div className="mb-6 p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex items-center gap-2.5 text-emerald-300 text-xs text-right">
          <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
          <span>تطبیق اطلاعات فروش دوره‌ای فعال با موفقیت برقرار شد. هزینه‌های حقوق مشترک و سربار کارگاهی به نسبت سهم فروش خالص (مجموع خالص: <strong className="font-sans font-black text-emerald-400 underline">{formatWithCommas(totalSalesVolumeAndValue.netTot)}</strong> ریال) به فرآورده‌ها تخصیص خواهند یافت.</span>
        </div>
      )}

      {(unmappedCategoryStats.unmappedCategories.length > 0 || unmappedCategoryStats.unassignedProductsCount > 0) && (
        <div className="mb-6 p-4 bg-amber-950/25 border border-amber-500/35 rounded-2xl flex items-start gap-3 text-amber-200 text-xs leading-relaxed">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-black text-amber-300 text-sm">
              هشدار تخصیص دپارتمان: {toPersianDigits(unmappedCategoryStats.unmappedCategories.length)} دسته‌بندی ({unmappedCategoryStats.unassignedProductsCount > 0 ? `${toPersianDigits(unmappedCategoryStats.unassignedProductsCount)} محصول` : 'بدون محصول متصل'}) هنوز به دپارتمان تولیدی متصل نشده‌اند!
            </div>
            <p className="text-[11px] text-amber-200/85">
              تا زمانی که در بخش «فروش ← دسته‌بندی محصولات و دپارتمان‌ها» دپارتمان هر دسته‌بندی مشخص نشود، این کالاها در گروه «تخصیص‌نیافته» قرار می‌گیرند و <strong>حقوق مستقیم دپارتمان آن‌ها صفر ریال</strong> لحاظ می‌شود (حقوق مشترک و سربار همچنان محاسبه می‌شود).
              {unmappedCategoryStats.unmappedCategories.length > 0 && (
                <span className="block mt-1 text-amber-300 font-bold">
                  دسته‌های نیازمند تخصیص: {unmappedCategoryStats.unmappedCategories.map(c => c.name).join('، ')}
                </span>
              )}
            </p>
          </div>
        </div>
      )}


      {/* ======================= TAB 1: FORMULAS AND COGS MATRIX ======================= */}
      {activeTab === 'formulas' && (
        <div id="cogs-formulas-printable" className="space-y-6">
          {/* Formula Excel Export/Import Header Bar */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-850 shadow-md" dir="rtl">
            <div className="text-right space-y-0.5">
              <h4 className="text-xs font-black text-slate-100 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                مدیریت و انتقال فایل اکسل فرمول‌های ساخت محصولات (BOM)
              </h4>
              <p className="text-[11px] text-slate-400">
                امکان خروجی گرفتن، ویرایش گروهی مواد اولیه در اکسل و بارگذاری مجدد کامل فرمول‌های ساخت
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportCogsFormulasToExcel(db, activePeriodId)}
                className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white p-2 px-3.5 rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                title="دانلود فایل اکسل فرمول‌های ساخت کالاهای دوره به تفکیک مواد اولیه"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>دانلود اکسل فرمول‌ها (.xlsx)</span>
              </button>
              <label className="text-xs font-bold bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-200 p-2 px-3.5 rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer">
                <Upload className="h-4 w-4 text-amber-400" />
                <span>بارگذاری فایل اکسل</span>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                      const buffer = evt.target?.result as ArrayBuffer;
                      if (!buffer) return;
                      try {
                        const updated = importCogsFormulasFromExcel(buffer, db, activePeriodId);
                        onUpdateDb(updated);
                        alert('فرمول‌های ساخت با موفقیت از اکسل دریافت و به‌روزرسانی شدند.');
                      } catch (err) {
                        alert('خطا در خواندن فایل اکسل فرمول‌ها.');
                      }
                    };
                    reader.readAsArrayBuffer(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column: List Sidebar (Interactive Explorer) */}
            <div className="lg:col-span-4 bg-slate-950 p-4 rounded-3xl border border-slate-850 h-fit space-y-4">
              <div className="flex items-center justify-between border-b border-slate-850 pb-2">
                <span className="text-xs font-black text-slate-200">فرآورده‌های نهایی کارگاه</span>
                <span className="text-[10px] bg-slate-900 border border-slate-800 px-2 py-0.5 text-slate-400 rounded-full font-bold">کاتالوگ دوره</span>
              </div>

              {/* Sidebar Search Input */}
              <div className="relative">
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-slate-500" />
                </span>
                <input
                  id="formula-p-search-premium"
                  type="text"
                  placeholder="جستجو بر اساس نام یا کد..."
                  className="w-full pl-3 pr-10 py-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans font-medium"
                  value={formulaSearchQuery}
                  onChange={(e) => setFormulaSearchQuery(e.target.value)}
                />
              </div>

              {/* Product Category Filter */}
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 font-extrabold pr-1">دسته‌بندی محصولات:</label>
                <select
                  value={formulaCategoryFilter}
                  onChange={(e) => setFormulaCategoryFilter(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-xl py-2 px-3 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans font-medium"
                >
                  <option value="all" className="bg-slate-950 text-white font-bold">همه دسته‌بندی‌ها</option>
                  {productCategories.map(cat => (
                    <option key={cat.id} value={cat.id} className="bg-slate-950 text-white font-bold">
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter Toggles (3-state classification + All) */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 rounded-xl border border-slate-850 text-[10px] font-bold select-none">
                <button
                  type="button"
                  onClick={() => setFormulaFilter('all')}
                  className={`py-1.5 px-1.5 rounded-lg transition-all cursor-pointer text-center font-sans ${
                    formulaFilter === 'all'
                      ? 'bg-rose-600 text-white shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  همه ({toPersianDigits(categoryFilteredProducts.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFormulaFilter('has_formula')}
                  className={`py-1.5 px-1.5 rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 font-sans ${
                    formulaFilter === 'has_formula'
                      ? 'bg-emerald-600 text-white shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                  تولیدی فرمول‌دار ({toPersianDigits(categoryFilteredProducts.filter(p => !isProductPurchased(p) && formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0)).length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFormulaFilter('no_formula')}
                  className={`py-1.5 px-1.5 rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 font-sans ${
                    formulaFilter === 'no_formula'
                      ? 'bg-amber-600 text-white shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0"></span>
                  تولیدی بدون فرمول ({toPersianDigits(categoryFilteredProducts.filter(p => !isProductPurchased(p) && !formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0)).length)})
                </button>
                <button
                  type="button"
                  onClick={() => setFormulaFilter('purchased')}
                  className={`py-1.5 px-1.5 rounded-lg transition-all cursor-pointer text-center flex items-center justify-center gap-1 font-sans ${
                    formulaFilter === 'purchased'
                      ? 'bg-sky-600 text-white shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0"></span>
                  خریداری ({toPersianDigits(categoryFilteredProducts.filter(p => isProductPurchased(p)).length)})
                </button>
              </div>

              {/* Sidebar list items */}
              <div className="max-h-[38rem] overflow-y-auto divide-y divide-slate-900 pr-1 select-none space-y-1 bg-slate-950/60 rounded-xl p-1">
                {searchedFormulaProducts.map(p => {
                  const compCogs = fullCalculatedCOGSMap[p.id];
                  const isSelected = selectedProductId === p.id;
                  const hasFormula = formulas.some(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0);
                  const isPurchased = isProductPurchased(p);
                  const pFormulasCount = formulas.filter(f => doesFormulaMatchProduct(f.productId, p)).length;

                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className={`w-full text-right p-3 rounded-2xl flex justify-between items-center transition-all cursor-pointer group ${
                        isSelected 
                          ? 'bg-rose-950/50 border border-rose-500 text-white' 
                          : 'bg-transparent border border-transparent hover:bg-slate-900/60 text-slate-300'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-extrabold text-xs flex items-center gap-1.5 flex-wrap">
                          {isPurchased ? (
                            <span className="h-1.5 w-1.5 bg-sky-400 rounded-full" title="کالای خریداری (بازرگانی) — حقوق مستقیم صفر"></span>
                          ) : hasFormula ? (
                            <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full" title="تولیدی (دارای فرمول ساخت)"></span>
                          ) : (
                            <span className="h-1.5 w-1.5 bg-amber-500 rounded-full" title="تولیدی (بدون فرمول — حقوق مستقیم بر اساس سهم فروش دپارتمان)"></span>
                          )}
                          <span className={`${isSelected ? 'text-white font-black' : 'text-slate-200 group-hover:text-white'}`}>{p.name}</span>
                          {isPurchased ? (
                            <span className="bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[8px] px-1.5 py-0.5 rounded font-sans font-bold">
                              خریداری
                            </span>
                          ) : !hasFormula ? (
                            <span className="bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[8px] px-1.5 py-0.5 rounded font-sans font-bold">
                              تولیدی بدون فرمول
                            </span>
                          ) : null}
                          {p.isWip && (
                            <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 text-[8px] px-1.5 py-0.5 rounded font-sans font-bold">
                              نیمه‌ساخته
                            </span>
                          )}
                          {pFormulasCount > 1 && (
                            <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[8px] px-1 rounded-md font-mono font-bold mr-1">
                              {toPersianDigits(pFormulasCount)} فرمول
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono">کد: {p.code} | حساب: {p.accountId || 'ثبت‌نشده'}</div>
                      </div>

                      <div className="text-left space-y-1">
                        <span className="block text-[10px] font-black font-mono text-white">
                          {compCogs ? formatWithCommas(Math.round(compCogs.totalCOGSPrice)) : '0'} <span className="text-[8px] text-slate-500">ریال</span>
                        </span>
                        <span className="block text-[8px] text-slate-400">بهای تمام‌شده</span>
                      </div>
                    </button>
                  );
                })}
                {searchedFormulaProducts.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    محصولی با این کلمه کلیدی یافت نشد.
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Main Pricing breakdowns and calculations */}
            <div className="lg:col-span-8 space-y-6">
              <AnimatePresence mode="wait">
                {selectedProductId && selectedProductData ? (
                  <motion.div 
                    key={selectedProductId}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.2 }}
                    className="bg-slate-950 ring-1 ring-slate-850 p-6 rounded-3xl space-y-6"
                  >
                    
                    {/* Header: Selected product state, and action to Catalog */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-4 border-slate-900 gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Calculator className="h-5 w-5 text-rose-500" />
                          <h2 className="text-base font-black text-white">{selectedProductData.name}</h2>
                          <span className="text-[10px] bg-slate-900 border border-slate-850 px-2 py-0.5 rounded-md font-mono text-slate-400">کد محصول: {selectedProductData.code}</span>
                          {selectedProductData.accountId ? (
                            <span className="text-[10px] bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-md font-mono text-emerald-300">کد حسابداری (کلید فرمول): {selectedProductData.accountId}</span>
                          ) : (
                            <span className="text-[10px] bg-amber-950/40 border border-amber-500/30 px-2 py-0.5 rounded-md text-amber-300">بدون کد حسابداری (اتصال موقت با شناسه)</span>
                          )}
                          {(() => {
                            const selPurchased = isProductPurchased(selectedProductData);
                            const selHasFormula = Boolean(activeFormulaData && activeFormulaData.ingredients.length > 0);
                            return (
                              <>
                                {selPurchased ? (
                                  <span className="text-[10px] bg-sky-500/15 border border-sky-500/35 px-2 py-0.5 rounded-md font-bold text-sky-300">
                                    خریداری (بازرگانی • حقوق مستقیم صفر)
                                  </span>
                                ) : selHasFormula ? (
                                  <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-md font-bold text-emerald-300">
                                    تولیدی (دارای فرمول)
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 rounded-md font-bold text-amber-300">
                                    تولیدی (بدون فرمول • حقوق مستقیم بر مبنای سهم فروش دپارتمان)
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleToggleProductPurchased(selectedProductData.id)}
                                  className="text-[10px] px-2 py-0.5 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold cursor-pointer transition-colors"
                                  title="تغییر سریع وضعیت کالا بین تولیدی کارگاه و خریداری (بازرگانی)"
                                >
                                  {selPurchased ? 'تبدیل به تولیدی' : 'تبدیل به خریداری'}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <p className="text-[11px] text-slate-400">واحد سنجش نهایی: <strong className="text-slate-200">{selectedProductData.unit}</strong></p>
                          <p className="text-[11px] text-slate-400">قیمت فروش کارخانه‌ای مصوب: <strong className="text-indigo-400 font-mono underline">{formatWithCommas(selectedProductData.salePrice)} ریال</strong></p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        {activeFormulaData && activeFormulaData.ingredients.length > 0 && (
                          <button
                            type="button"
                            onClick={printFormulationReport}
                            className="w-full sm:w-auto px-3.5 sm:px-4 py-2 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white border border-slate-800 hover:border-slate-700 rounded-xl text-[11px] sm:text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Printer className="h-4 w-4 text-emerald-450 shrink-0" />
                            <span>چاپ گزارش حرفه‌ای بها و فرمولاسیون</span>
                          </button>
                        )}
                        <button
                          onClick={applyCogsPricesToProductCatalog}
                          className="w-full sm:w-auto px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[11px] sm:text-xs font-bold transition-all shadow-md shadow-rose-600/10 hover:shadow-rose-600/20 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle className="h-4 w-4 shrink-0" />
                          <span>ثبت نهایی بهای تمام شده در کاتالوگ</span>
                        </button>
                      </div>
                    </div>

                    {/* INTERACTIVE BENTO GRID FOR COGS COMPONENT COST PILES */}
                    {fullCalculatedCOGSMap[selectedProductId] && (
                      <div className="space-y-4">
                        <h4 className="text-xs font-black text-slate-300 flex items-center gap-1.5 pb-1">
                          <Activity className="h-3.5 w-3.5 text-rose-400" />
                          آنالیز تفکیکی بهای تمام شده مصارف کارگاه
                        </h4>
                        
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3.5">
                          
                          {/* Card 1: RAW INGREDIENTS RECIPE SUM OR PURCHASED BASE COST */}
                          <div className="p-3 bg-slate-900 border border-slate-850 rounded-2xl space-y-2 relative group hover:border-slate-800 transition-all">
                            <div className="flex items-center justify-between gap-1">
                              <span className="block text-[10px] text-slate-400 font-bold">
                                {activeFormulaData && activeFormulaData.ingredients.length > 0
                                  ? 'بهای کل مواد خام'
                                  : isProductPurchased(selectedProductData)
                                    ? 'بهای خرید پایه (کالای خریداری)'
                                    : 'بهای پایه کالا (تولیدی بدون فرمول)'}
                              </span>
                              {(!activeFormulaData || activeFormulaData.ingredients.length === 0) && !isEditingPurchaseCost && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTempPurchaseCost(String(getPurchasedBaseCost(selectedProductData)));
                                    setIsEditingPurchaseCost(true);
                                  }}
                                  className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                                  title="اصلاح بهای پایه کالای بدون فرمول"
                                >
                                  ویرایش
                                </button>
                              )}
                            </div>
                            {isEditingPurchaseCost && (!activeFormulaData || activeFormulaData.ingredients.length === 0) ? (
                              <div className="flex items-center gap-1 mt-1">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={tempPurchaseCost}
                                  onChange={(e) => setTempPurchaseCost(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSavePurchaseCost();
                                    if (e.key === 'Escape') setIsEditingPurchaseCost(false);
                                  }}
                                  className="w-full px-2 py-1 rounded-lg bg-slate-950 border border-indigo-500/50 text-xs font-mono text-white focus:outline-none"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={handleSavePurchaseCost}
                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                                >
                                  ثبت
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-baseline gap-1 mt-1">
                                <strong className="text-[13px] font-black text-white font-mono">{formatWithCommas(Math.round(fullCalculatedCOGSMap[selectedProductId].materialCost))}</strong>
                                <span className="text-[9px] text-slate-500">ریال</span>
                              </div>
                            )}
                            <div className="pt-2 border-t border-slate-850/80 flex items-center justify-between text-[9px] text-slate-450">
                              <span>سهم از کل:</span>
                              <span className="font-mono text-slate-300 font-bold">
                                {fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice > 0 
                                  ? ((fullCalculatedCOGSMap[selectedProductId].materialCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0) 
                                  : 0}%
                              </span>
                            </div>
                          </div>

                          {/* Card 2: ALLOCATED DIRECT LABOR WAGES */}
                          <div className="p-3 bg-slate-900 border border-slate-850 rounded-2xl space-y-2 hover:border-slate-800 transition-all">
                            <span className="block text-[10px] text-slate-400 font-bold">حقوق مستقیم دپارتمان</span>
                            <div className="flex items-baseline gap-1 mt-1 font-mono">
                              <strong className="text-[13px] font-black text-white font-mono">{formatWithCommas(Math.round(fullCalculatedCOGSMap[selectedProductId].directLabor))}</strong>
                              <span className="text-[9px] text-slate-500">ریال</span>
                            </div>
                            <div className="pt-2 border-t border-slate-850/80 flex items-center justify-between text-[9px] text-slate-450">
                              <span>سهم از کل:</span>
                              <span className="font-mono text-slate-300 font-bold">
                                {fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice > 0 
                                  ? ((fullCalculatedCOGSMap[selectedProductId].directLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0) 
                                  : 0}%
                              </span>
                            </div>
                          </div>

                          {/* Card 3: CENTRAL WAGES SHARE */}
                          <div className="p-3 bg-slate-900 border border-slate-850 rounded-2xl space-y-2 hover:border-slate-800 transition-all">
                            <span className="block text-[10px] text-slate-400 font-bold">سهم حقوق مشترک</span>
                            <div className="flex items-baseline gap-1 mt-1 font-mono">
                              <strong className="text-[13px] font-black text-white font-mono">{formatWithCommas(Math.round(fullCalculatedCOGSMap[selectedProductId].sharedLabor))}</strong>
                              <span className="text-[9px] text-slate-500">ریال</span>
                            </div>
                            <div className="pt-2 border-t border-slate-850/80 flex items-center justify-between text-[9px] text-slate-450">
                              <span>سهم از کل:</span>
                              <span className="font-mono text-slate-300 font-bold">
                                {fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice > 0 
                                  ? ((fullCalculatedCOGSMap[selectedProductId].sharedLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0) 
                                  : 0}%
                              </span>
                            </div>
                          </div>

                          {/* Card 4: INDIRECT OVERHEAD */}
                          <div className="p-3 bg-slate-900 border border-slate-850 rounded-2xl space-y-2 hover:border-slate-800 transition-all">
                            <span className="block text-[10px] text-slate-400 font-bold">هزینه‌های سربار تخصیصی</span>
                            <div className="flex items-baseline gap-1 mt-1 font-mono">
                              <strong className="text-[13px] font-black text-white font-mono">{formatWithCommas(Math.round(fullCalculatedCOGSMap[selectedProductId].overheadCost))}</strong>
                              <span className="text-[9px] text-slate-500">ریال</span>
                            </div>
                            <div className="pt-2 border-t border-slate-850/80 flex items-center justify-between text-[9px] text-slate-450">
                              <span>سهم از کل:</span>
                              <span className="font-mono text-slate-300 font-bold">
                                {fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice > 0 
                                  ? ((fullCalculatedCOGSMap[selectedProductId].overheadCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0) 
                                  : 0}%
                              </span>
                            </div>
                          </div>

                          {/* Card 5: FINAL SYSTEM COST BASE & PROFITABILITY LEVEL ASSESSMENT */}
                          {(() => {
                            const finalPrice = fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice;
                            const salePrice = selectedProductData.salePrice;
                            const nominalProfit = salePrice - finalPrice;
                            const marginPercent = salePrice > 0 ? (nominalProfit / salePrice) * 100 : 0;

                            let badgeColor = 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20';
                            let statusText = `سودآور عالی (${toPersianDigits(marginPercent.toFixed(0))}٪)`;
                            if (salePrice <= 0) {
                              badgeColor = 'text-slate-400 bg-slate-800/60 border-slate-700';
                              statusText = 'قیمت فروش ثبت نشده';
                            } else if (nominalProfit < 0) {
                              badgeColor = 'text-rose-400 bg-rose-950/40 border-rose-500/20';
                              statusText = 'فروش در زیان ⚠️';
                            } else if (marginPercent < 15) {
                              badgeColor = 'text-amber-400 bg-amber-950/40 border-amber-500/20';
                              statusText = `حاشیه سود پایین (${toPersianDigits(marginPercent.toFixed(0))}٪)`;
                            }

                            return (
                              <div className="p-3 bg-gradient-to-br from-slate-900 to-rose-950/30 border border-rose-500/10 rounded-2xl space-y-2 col-span-1 md:col-span-1">
                                <span className="block text-[10px] text-rose-300 font-black">بهای تمام‌شده مصوب</span>
                                <div className="flex items-baseline gap-1 mt-1 font-mono">
                                  <strong className="text-[13.5px] font-black text-rose-400 font-mono">{formatWithCommas(Math.round(finalPrice))}</strong>
                                  <span className="text-[8px] text-slate-400">ریال</span>
                                </div>
                                <div className="pt-2 border-t border-rose-900/40 text-[9px] flex flex-wrap gap-1">
                                  <span className={`px-1.5 py-0.5 rounded border text-[8px] ${badgeColor}`}>{statusText}</span>
                                </div>
                              </div>
                            );
                          })()}

                        </div>

                        {/* Interactive Visual cost visualizer split bar (custom progress) */}
                        {fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice > 0 && (
                          <div className="bg-slate-900/60 p-3.5 rounded-2xl border border-slate-850">
                            <div className="flex justify-between items-center text-[10px] text-slate-450 mb-2">
                              <span>توزیع بصری سرفصل‌های هزینه ورودی:</span>
                              <div className="flex gap-3 font-mono">
                                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-indigo-500 rounded-sm"></span>مواد: {((fullCalculatedCOGSMap[selectedProductId].materialCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0)}%</span>
                                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-emerald-500 rounded-sm"></span>حقوق مستقیم: {((fullCalculatedCOGSMap[selectedProductId].directLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0)}%</span>
                                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-blue-500 rounded-sm"></span>حقوق مشترک: {((fullCalculatedCOGSMap[selectedProductId].sharedLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0)}%</span>
                                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-amber-500 rounded-sm"></span>سربار غیرمستقیم: {((fullCalculatedCOGSMap[selectedProductId].overheadCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100).toFixed(0)}%</span>
                              </div>
                            </div>
                            <div className="w-full h-3 rounded-full overflow-hidden bg-slate-950 flex">
                              <div 
                                style={{ width: `${(fullCalculatedCOGSMap[selectedProductId].materialCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100}%` }} 
                                className="bg-indigo-500 h-full transition-all"
                                title="سهم مواد اولیه"
                              />
                              <div 
                                style={{ width: `${(fullCalculatedCOGSMap[selectedProductId].directLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100}%` }} 
                                className="bg-emerald-500 h-full transition-all"
                                title="سهم حقوق مستقیم"
                              />
                              <div 
                                style={{ width: `${(fullCalculatedCOGSMap[selectedProductId].sharedLabor / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100}%` }} 
                                className="bg-blue-500 h-full transition-all"
                                title="سهم حقوق مشترک"
                              />
                              <div 
                                style={{ width: `${(fullCalculatedCOGSMap[selectedProductId].overheadCost / fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice) * 100}%` }} 
                                className="bg-amber-500 h-full transition-all"
                                title="سهم سربار ساخت"
                              />
                            </div>
                            
                            {/* BOM Recipe Weight and Cost Summary Display */}
                            {(() => {
                              if (!activeFormulaData || !activeFormulaData.ingredients || activeFormulaData.ingredients.length === 0) return null;
                              
                              // calculate weight
                              const totalWeight = activeFormulaData.ingredients.reduce((sum, ing) => {
                                const resolved = resolveMaterialByKey(ing.rawMaterialId);
                                const item = resolved.item || resolved.wip;
                                if (!item) return sum;

                                let weightInGrams = 0;
                                if (resolved.wip) {
                                  if (resolved.wip.unit === 'کیلو') {
                                    weightInGrams = ing.quantity;
                                  }
                                } else if (resolved.item) {
                                  if (resolved.item.unit === 'کیلویی') {
                                    weightInGrams = ing.quantity;
                                  } else {
                                    const conv = findMaterialConversion(ing.rawMaterialId, resolved.item);
                                    if (conv) {
                                      const cUnit = conv.consumptionUnit || '';
                                      const isWeightBased = cUnit === 'گرم' || cUnit === 'سی سی' || cUnit.includes('گرم') || cUnit.includes('سی‌سی') || cUnit.includes('سی سی') || cUnit.includes('کیلو');
                                      if (isWeightBased) {
                                        if (cUnit.includes('کیلو')) {
                                          weightInGrams = ing.quantity * 1000;
                                        } else {
                                          weightInGrams = ing.quantity;
                                        }
                                      }
                                    }
                                  }
                                }
                                return sum + weightInGrams;
                              }, 0);

                              return (
                                <div className="mt-3.5 pt-3 border-t border-slate-850/60 flex flex-col gap-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <div className="flex items-center gap-1.5 text-slate-350">
                                      <Coffee className="h-4.5 w-4.5 text-indigo-400" />
                                      <span>سرجمع فرمول پخت کالا (BOM):</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 items-center">
                                      {totalWeight > 0 && (
                                        <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2.5 py-1 rounded-xl font-mono text-center text-xs font-black">
                                          وزن کل فرمول: {toPersianDigits(totalWeight.toFixed(totalWeight % 1 === 0 ? 0 : 2))} گرم
                                        </span>
                                      )}
                                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-xl font-mono text-center text-xs font-black">
                                        بهای کل مواد خام: {formatWithCommas(Math.round(fullCalculatedCOGSMap[selectedProductId].materialCost))} ریال
                                      </span>
                                    </div>
                                  </div>

                                  {selectedProductData && (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-850/80">
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-[11px] font-bold text-slate-350 flex items-center gap-1.5">
                                          <Scale className="h-3.5 w-3.5 text-indigo-400" />
                                          وزن بسته‌بندی نهایی فرآورده (کاتالوگ):
                                        </span>
                                        <p className="text-[9.5px] text-slate-500">
                                          وزن خالص هر واحد فروش کالا جهت درج در شناسنامه فنی و فرمولاسیون
                                        </p>
                                      </div>
                                      
                                      <div className="flex items-center gap-2">
                                        {isEditingWeight ? (
                                          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-indigo-500/40">
                                            <input
                                              type="number"
                                              value={tempWeight}
                                              onChange={(e) => setTempWeight(e.target.value)}
                                              className="w-16 bg-transparent text-left font-mono font-bold text-xs text-indigo-400 focus:outline-none ml-1 placeholder-slate-600"
                                              placeholder="مثلا ۷۵۰"
                                              autoFocus
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  handleSaveWeight();
                                                } else if (e.key === 'Escape') {
                                                  setIsEditingWeight(false);
                                                }
                                              }}
                                            />
                                            <span className="text-[9px] font-bold text-slate-500 font-sans">گرم</span>
                                            <div className="border-r border-slate-800 h-3 mx-1"></div>
                                            <button
                                              type="button"
                                              onClick={handleSaveWeight}
                                              className="p-1 hover:bg-slate-900 rounded text-emerald-500 hover:text-emerald-400 cursor-pointer"
                                              title="ذخیره وزن"
                                            >
                                              <Check className="h-3 w-3" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setIsEditingWeight(false)}
                                              className="p-1 hover:bg-slate-900 rounded text-rose-500 hover:text-rose-400 cursor-pointer"
                                              title="انصراف"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-black text-indigo-300 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-lg tracking-wide">
                                              {selectedProductData.weight ? toPersianDigits(selectedProductData.weight) : toPersianDigits(0)} <span className="text-[10px] font-bold text-indigo-450">گرم</span>
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setTempWeight(selectedProductData.weight ? String(selectedProductData.weight) : '');
                                                setIsEditingWeight(true);
                                              }}
                                              className="p-1.5 hover:bg-slate-800 bg-slate-900/40 border border-slate-800/80 rounded-lg text-slate-450 hover:text-indigo-400 hover:border-indigo-500/30 transition-all cursor-pointer flex items-center gap-1"
                                              title="اصلاح وزن خالص این محصول"
                                            >
                                              <Edit className="h-3 w-3" />
                                              <span className="text-[9px] font-bold">اصلاح وزن</span>
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            
                            {/* Gross Profit Margin Indicator widget */}
                            {(() => {
                              const finalPrice = fullCalculatedCOGSMap[selectedProductId].totalCOGSPrice;
                              const salePrice = selectedProductData.salePrice;
                              const marginPct = salePrice > 0 ? ((salePrice - finalPrice) / salePrice) * 100 : 0;
                              return (
                                <div className="mt-3 pt-3 border-t border-slate-850 flex flex-wrap items-center justify-between text-xs">
                                  <span className="text-slate-400">تحلیل حاشیه سود کارگاه (Gross Margin):</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-slate-400">حجم حاشیه سود ریالی: <strong className="font-mono text-slate-100">{formatWithCommas(Math.round(salePrice - finalPrice))} ریال</strong></span>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black font-mono shadow-md flex items-center gap-1 bg-slate-900 border border-slate-800">
                                      {marginPct > 0 ? (
                                        <>
                                          <TrendingUp className="h-3 w-3 text-emerald-400" />
                                          <span className="text-emerald-400">+{marginPct.toFixed(1)}% سود ناخالص</span>
                                        </>
                                      ) : (
                                        <>
                                          <TrendingDown className="h-3 w-3 text-rose-405" />
                                          <span className="text-rose-400">{marginPct.toFixed(1)}% زیان ناخالص</span>
                                        </>
                                      )}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* MULTIPLE FORMULAS SECTION */}
                    <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-850 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/60">
                        <div className="flex items-center gap-2 text-right">
                          <Layers className="h-4.5 w-4.5 text-rose-500" />
                          <div>
                            <h3 className="text-xs font-black text-slate-200">فرمول‌های ساخت موازی کالا (Formulations)</h3>
                            <p className="text-[9.5px] text-slate-450">امکان ثبت چندین فرمول؛ یک فرمول به عنوان فعال (مبنای استخراج خودکار قیمت تمام‌شده) علامت‌گذاری می‌شود.</p>
                          </div>
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => {
                            setNewFormulaName(`فرمول شماره ${toPersianDigits(productFormulas.length + 1)}`);
                            setCloneCurrentFormula(true);
                            setIsCreatingFormula(!isCreatingFormula);
                          }}
                          className="px-3.5 py-1.5 bg-rose-600/10 hover:bg-rose-600 border border-rose-500/30 text-rose-400 hover:text-white rounded-xl text-[10.5px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 self-end sm:self-auto"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          تعریف فرمول جدید
                        </button>
                      </div>

                      {/* Create New Formula Inline Form */}
                      {isCreatingFormula && (
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 space-y-3">
                          <h4 className="text-[11px] font-bold text-slate-300">مشخصات فرمول متمم</h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-1">نام فرمول:</label>
                              <input
                                type="text"
                                className="w-full p-2 border border-slate-800 rounded-lg text-xs bg-slate-900 text-white outline-none focus:border-rose-500"
                                placeholder="مثلاً: فرمول اقتصادی، فرمول پرمیوم"
                                value={newFormulaName}
                                onChange={(e) => setNewFormulaName(e.target.value)}
                              />
                            </div>
                            <div className="flex items-center h-10">
                              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={cloneCurrentFormula}
                                  onChange={(e) => setCloneCurrentFormula(e.target.checked)}
                                  className="rounded border-slate-800 text-rose-600 focus:ring-rose-500 bg-slate-900 h-4 w-4"
                                />
                                کپی برداری از مواد فرمول فعلی
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  handleCreateNewFormula(newFormulaName, cloneCurrentFormula);
                                  setIsCreatingFormula(false);
                                }}
                                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg py-1.5 text-xs font-bold transition-all h-9 cursor-pointer"
                              >
                                ثبت فرمول
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsCreatingFormula(false)}
                                className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-350 rounded-lg py-1.5 text-xs font-bold transition-all h-9 cursor-pointer"
                              >
                                انصراف
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Formulas List Tabs */}
                      <div className="flex flex-wrap gap-2.5">
                        {productFormulas.length === 0 ? (
                          <div className="text-slate-500 text-xs italic py-1 gap-1 flex items-center">
                            <Info className="h-4 w-4" />
                            هنوز فرمولی طراحی نشده است. اولین ماده مصرفی را اضافه کنید تا فرمول پیش‌فرض ساخته شود.
                          </div>
                        ) : (
                          productFormulas.map((f, idx) => {
                            const isCurrentSelected = activeFormulaData?.id === f.id;
                            const isActiveCalculatedBasis = f.isActive || (!productFormulas.some(x => x.isActive) && idx === 0);
                            return (
                              <div
                                key={f.id}
                                className={`flex items-center rounded-xl p-0.5 border select-none transition-all ${
                                  isCurrentSelected
                                    ? 'bg-rose-950/20 border-rose-500/50 text-white'
                                    : 'bg-slate-950/40 border-slate-850/70 text-slate-450 hover:border-slate-805 hover:text-slate-200'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => editingFormulaId !== f.id && setSelectedFormulaId(f.id)}
                                  className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 ${editingFormulaId === f.id ? 'cursor-default' : 'cursor-pointer'}`}
                                >
                                  <Layers className={`h-3.5 w-3.5 ${isCurrentSelected ? 'text-rose-500' : 'text-slate-550'}`} />
                                  {editingFormulaId === f.id ? (
                                    <input
                                      type="text"
                                      value={renamingValue}
                                      onChange={(e) => setRenamingValue(e.target.value)}
                                      className="bg-slate-900 border border-slate-700 text-white rounded px-1.5 py-0.5 text-xs tracking-wide focus:outline-none focus:border-rose-500 w-28 text-right font-medium"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          saveRenameFormula(f.id);
                                        } else if (e.key === 'Escape') {
                                          setEditingFormulaId(null);
                                        }
                                      }}
                                      autoFocus
                                    />
                                  ) : (
                                    <span>{f.name || `فرمول شماره ${toPersianDigits(idx + 1)}`}</span>
                                  )}
                                  {isActiveCalculatedBasis && editingFormulaId !== f.id && (
                                    <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-450 px-1.5 py-0.5 rounded text-[8px] font-black mr-1">
                                      فرمول مبنا
                                    </span>
                                  )}
                                </button>
                                
                                <div className="border-r border-slate-800/80 h-4 mr-1 pr-1 flex items-center gap-1">
                                  {editingFormulaId === f.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          saveRenameFormula(f.id);
                                        }}
                                        title="ذخیره نام"
                                        className="p-1 hover:bg-slate-800 rounded text-emerald-500 hover:text-emerald-400 transition-all cursor-pointer"
                                      >
                                        <Check className="h-3 w-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingFormulaId(null);
                                        }}
                                        title="انصراف"
                                        className="p-1 hover:bg-slate-800 rounded text-rose-500 hover:text-rose-400 transition-all cursor-pointer"
                                      >
                                        <RefreshCcw className="h-3 w-3" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRenameFormula(f.id, f.name || `فرمول شماره ${idx + 1}`);
                                      }}
                                      title="ویرایش نام فرمول"
                                      className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-indigo-400 transition-all cursor-pointer"
                                    >
                                      <Edit className="h-3 w-3" />
                                    </button>
                                  )}
                                  
                                  {!isActiveCalculatedBasis && editingFormulaId !== f.id && (
                                    <button
                                      type="button"
                                      onClick={() => handleSetActiveFormula(f.id)}
                                      title="فعال‌سازی به عنوان فرمول اصلی (مبنای محاسبات)"
                                      className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-emerald-400 transition-all cursor-pointer"
                                    >
                                      <CheckCircle className="h-3 w-3" />
                                    </button>
                                  )}
                                  
                                  {productFormulas.length > 1 && editingFormulaId !== f.id && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteFormula(f.id)}
                                      title="حذف کامل این فرمول"
                                      className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-rose-500 transition-all cursor-pointer"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Copy Formulation section */}
                    <div className="bg-slate-905 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1">
                        <div className="flex items-center gap-1.5 text-slate-300 font-bold text-xs">
                          <Copy className="h-4 w-4 text-indigo-400" />
                          <span>کپی فرمولاسیون از سایر کالاها</span>
                        </div>
                        <span className="text-[10px] text-slate-500">جایگزینی فرمولاسیون کالای جاری با فرمول یکی از فرآورده‌های دیگر</span>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <div className="flex-1">
                          <SearchableSelect
                            id="copy-formula-source-select"
                            value={copySourceProductId}
                            onChange={(val) => setCopySourceProductId(val)}
                            options={sourceProductsForCopy.map(p => {
                              const activeF = formulas.find(f => doesFormulaMatchProduct(f.productId, p));
                              const pFormula = activeF || db.productFormulas.find(f => doesFormulaMatchProduct(f.productId, p) && f.ingredients.length > 0);
                              const ingCount = pFormula ? pFormula.ingredients.length : 0;
                              return {
                                value: p.id,
                                label: `${p.code} | ${p.name} (${toPersianDigits(ingCount)} ماده مصرفی)`
                              };
                            })}
                            placeholder="-- انتخاب کالای منبع برای الگوبرداری --"
                          />
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => handleCopyFormulationFromProduct(copySourceProductId)}
                          disabled={!copySourceProductId}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 select-none h-9 cursor-pointer ${
                            copySourceProductId
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/10'
                              : 'bg-slate-850 text-slate-500 border border-slate-800 cursor-not-allowed'
                          }`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          کپی و جایگزینی فرمولاسیون
                        </button>
                      </div>
                    </div>

                    {/* Batch Workshop Calculator banner */}
                    <div className="bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 p-4 rounded-2xl border border-indigo-500/10 space-y-3">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="space-y-1">
                          <h4 className="text-xs font-black text-white flex items-center gap-2">
                            <Scale className="h-4 w-4 text-rose-500 animate-pulse" />
                            محاسبه‌گر پیشرفته بچ تولید کارگاهی و کسر پخت (سرشکن ضایعات)
                          </h4>
                          <p className="text-[10px] text-slate-400">
                            فرمول را بر اساس مقادیر واقعی مصرفی یک بچ تستی (مثلا خامه و نان رولتی) وارد کنید، سیستم بر اساس وزن بسته‌بندی نهایی شبیه‌سازی و ضایعات را تسهیم می‌کند.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowBatchCalculator(!showBatchCalculator);
                            if (!showBatchCalculator && batchIngredients.length === 0 && activeFormulaData?.ingredients) {
                              // Auto-load if calculator was empty and formulation had formulas
                              const mapped = activeFormulaData.ingredients.map(item => {
                                const resolved = resolveMaterialByKey(item.rawMaterialId);
                                const ent = resolved.item || resolved.wip;
                                return {
                                  rawMaterialId: ent ? getMaterialFormulaKey(ent) : item.rawMaterialId,
                                  quantity: item.quantity
                                };
                              });
                              setBatchIngredients(mapped);
                            }
                          }}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            showBatchCalculator 
                              ? 'bg-rose-550/20 text-rose-300 border border-rose-500/25' 
                              : 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/35 hover:bg-indigo-600/35'
                          }`}
                        >
                          {showBatchCalculator ? 'بستن پنل محاسبه بچ' : 'راه‌اندازی و باز کردن پنل بچ'}
                        </button>
                      </div>

                      {showBatchCalculator && (
                        <div className="border-t border-slate-800/80 pt-4 space-y-4">
                          {/* Top row targets */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="text-[10px] font-bold text-slate-300 block mb-1">وزن فرآورده نهایی تولید شده در این بچ (گرم)</label>
                              <div className="relative">
                                <input
                                  type="number"
                                  className="w-full p-2.5 pr-8 border border-slate-800 rounded-xl text-xs font-mono bg-slate-950 text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                  placeholder="مثلاً ۳۰۰۰"
                                  value={batchOutputWeight}
                                  onChange={(e) => setBatchOutputWeight(e.target.value === '' ? '' : Math.abs(parseFloat(e.target.value)))}
                                />
                                <span className="absolute left-3 top-3 text-[9px] font-bold text-slate-505">گرم</span>
                              </div>
                            </div>

                            <div>
                              <label className="text-[10px] font-bold text-slate-300 block mb-1">درصد افت پخت / ضایعات فرآیند (%)</label>
                              <div className="relative">
                                <input
                                  type="number"
                                  className="w-full p-2.5 pr-8 border border-slate-800 rounded-xl text-xs font-mono bg-slate-950 text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                                  placeholder="مثلاً ۱۰٪ یا ۵٪"
                                  value={batchWastagePercent}
                                  onChange={(e) => setBatchWastagePercent(e.target.value === '' ? '' : Math.abs(parseFloat(e.target.value)))}
                                />
                                <span className="absolute left-3 top-3 text-[9px] font-bold text-slate-505">درصد</span>
                              </div>
                            </div>

                            <div className="flex flex-col justify-end">
                              <span className="text-[10px] font-bold text-slate-400 block mb-1">کالای هدف جاری</span>
                              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 flex items-center justify-between gap-1.5 min-h-[42px]">
                                <span className="text-xs text-slate-400 font-bold truncate max-w-[120px]">{selectedProductData?.name}</span>
                                {isEditingBatchTargetWeight ? (
                                  <div className="flex items-center gap-1 bg-slate-900 border border-indigo-505 px-1.5 py-0.5 rounded-lg">
                                    <input
                                      type="number"
                                      className="w-12 bg-transparent text-left font-mono font-bold text-[10.5px] text-indigo-400 focus:outline-none"
                                      value={tempBatchTargetWeight}
                                      onChange={(e) => setTempBatchTargetWeight(e.target.value)}
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleSaveBatchTargetWeight();
                                        } else if (e.key === 'Escape') {
                                          setIsEditingBatchTargetWeight(false);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={handleSaveBatchTargetWeight}
                                      className="p-0.5 hover:bg-slate-850 rounded text-emerald-450 hover:text-emerald-400 cursor-pointer flex items-center justify-center"
                                      title="ذخیره"
                                    >
                                      <Check className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setIsEditingBatchTargetWeight(false)}
                                      className="p-0.5 hover:bg-slate-850 rounded text-rose-455 hover:text-rose-400 cursor-pointer flex items-center justify-center"
                                      title="انصراف"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-indigo-400 font-mono font-black bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20">
                                      {toPersianDigits(selectedProductData?.weight || 1000)} گرم هدف
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTempBatchTargetWeight(String(selectedProductData?.weight || 1000));
                                        setIsEditingBatchTargetWeight(true);
                                      }}
                                      className="p-1 border border-slate-800 hover:bg-slate-900 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                                      title="ویرایش وزن هدف"
                                    >
                                      <Edit className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action helper bar */}
                          <div className="flex justify-between items-center border-b border-slate-800/60 pb-2">
                            <span className="text-[10px] font-extrabold text-slate-300 flex items-center gap-1.5">
                              <Coffee className="h-3 w-3 text-indigo-400" />
                              لیست مواد مصرف شده در بچ آزمایشی:
                            </span>
                            <button
                              type="button"
                              onClick={handleLoadIngredientsFromActive}
                              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold underline flex items-center gap-1 bg-cyan-950/20 hover:bg-cyan-950/40 px-2.5 py-1 rounded-lg border border-cyan-850 cursor-pointer"
                            >
                              بارگذاری مواد از فرمولاسیون فعلی محصول
                            </button>
                          </div>

                          {/* Ingredient inputs for batch */}
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end bg-slate-950 p-3.5 rounded-2xl border border-slate-850">
                            <div className="sm:col-span-6 text-right">
                              <label className="text-[10.5px] font-bold text-slate-400 block mb-1">انتخاب ماده اولیـه یا کالای نیمه‌ساخته ورودی</label>
                              <SearchableSelect
                                id="batch-material-select"
                                value={batchDraftMaterialId}
                                onChange={(val) => setBatchDraftMaterialId(val)}
                                options={selectableMaterials}
                                placeholder="-- کالا یا ماده مصرفی را انتخاب کنید --"
                              />
                            </div>

                            <div className="sm:col-span-4 text-right">
                              <label className="text-[10.5px] font-bold text-slate-400 block mb-1">مقدار مصرف در این بچ (گرم)</label>
                              <input
                                type="number"
                                className="w-full p-2 border border-slate-800 rounded-xl text-xs font-mono bg-slate-900 text-white outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                                placeholder="وزن گرم مصرفی"
                                value={batchDraftQty}
                                onChange={(e) => setBatchDraftQty(e.target.value === '' ? '' : Math.abs(parseFloat(e.target.value)))}
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <button
                                type="button"
                                onClick={handleAddBatchIngredient}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2 text-xs font-bold transition-all shadow-md cursor-pointer h-9 flex items-center justify-center gap-1"
                              >
                                {batchIngredients.some(item => item.rawMaterialId === batchDraftMaterialId) ? 'تغییر مقدار' : 'افزودن مـاده'}
                              </button>
                            </div>
                          </div>

                          {/* Selected Batch ingredients view and live comparison */}
                          <div className="space-y-2">
                            {batchIngredients.length === 0 ? (
                              <div className="text-center p-6 text-slate-500 text-xs border border-dashed border-slate-850 rounded-2xl bg-slate-950/40">
                                هیچ ماده مصرفی هنوز برای بچ وارد نشده است. مقادیر واقعی را در فرم بالا اضافه کنید یا از فرمول کنونی بارگذاری اولیه نمایید.
                              </div>
                            ) : (
                              <div className="space-y-3">
                                {/* Search and filter bar for batch list */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-850/70">
                                  <div className="relative flex-1">
                                    <span className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                                      <Search className="h-4 w-4 text-slate-400" />
                                    </span>
                                    <input
                                      type="text"
                                      placeholder="جستجو در بین مواد مصرف شده در بچ جاری..."
                                      className="w-full pl-3 pr-9 py-1.5 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-550 font-sans"
                                      value={batchSearchQuery}
                                      onChange={(e) => setBatchSearchQuery(e.target.value)}
                                    />
                                    {batchSearchQuery && (
                                      <button
                                        type="button"
                                        onClick={() => setBatchSearchQuery('')}
                                        className="absolute inset-y-0 left-3 flex items-center text-slate-400 hover:text-white text-xs cursor-pointer"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-450 font-sans font-bold text-left sm:text-right">
                                    تعداد نمایش: <span className="font-mono text-white">{toPersianDigits(batchIngredients.filter(item => {
                                      if (!batchSearchQuery) return true;
                                      const res = resolveMaterialByKey(item.rawMaterialId);
                                      const rawMat = res.item || res.wip;
                                      if (!rawMat) return matchPersianString(item.rawMaterialId, batchSearchQuery);
                                      return matchPersianString(rawMat.name, batchSearchQuery) || matchPersianString(rawMat.code || '', batchSearchQuery) || matchPersianString(rawMat.accountId || '', batchSearchQuery);
                                    }).length)}</span> از <span className="font-mono text-white">{toPersianDigits(batchIngredients.length)}</span> ردیف
                                  </div>
                                </div>

                                {batchIngredients.filter(item => {
                                  if (!batchSearchQuery) return true;
                                  const res = resolveMaterialByKey(item.rawMaterialId);
                                  const rawMat = res.item || res.wip;
                                  if (!rawMat) return matchPersianString(item.rawMaterialId, batchSearchQuery);
                                  return matchPersianString(rawMat.name, batchSearchQuery) || matchPersianString(rawMat.code || '', batchSearchQuery) || matchPersianString(rawMat.accountId || '', batchSearchQuery);
                                }).length === 0 ? (
                                  <div className="text-center p-6 text-slate-500 text-xs border border-dashed border-slate-850 rounded-2xl bg-slate-950/40">
                                    ماده‌ای منطبق با عبارت جستجوی شما در لیست بچ یافت نشد.
                                  </div>
                                ) : (
                                  <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950">
                                    <table className="min-w-full text-right text-xs">
                                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-850">
                                        <tr>
                                          <th className="px-3.5 py-2.5 font-bold">نام ماده اولیـه اصلی</th>
                                          <th className="px-3.5 py-2.5 text-center font-bold">مصرف در بچ واقعی</th>
                                          <th className="px-3.5 py-2.5 text-center font-bold">نسبت سهم (%)</th>
                                          <th className="px-3.5 py-2.5 text-center font-bold">سهم در وزن بسته‌بندی</th>
                                          <th className="px-3.5 py-2.5 text-center text-rose-455 font-bold">با احتساب کسر پخت / ضایعات</th>
                                          <th className="px-3.5 py-2.5 text-center font-bold">عملیات</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-850 font-medium font-sans">
                                        {batchIngredients
                                          .filter(item => {
                                            if (!batchSearchQuery) return true;
                                            const res = resolveMaterialByKey(item.rawMaterialId);
                                            const rawMat = res.item || res.wip;
                                            if (!rawMat) return matchPersianString(item.rawMaterialId, batchSearchQuery);
                                            return matchPersianString(rawMat.name, batchSearchQuery) || matchPersianString(rawMat.code || '', batchSearchQuery) || matchPersianString(rawMat.accountId || '', batchSearchQuery);
                                          })
                                          .map((item, idx) => {
                                            const res = resolveMaterialByKey(item.rawMaterialId);
                                            const rawMat = res.item || res.wip;
                                            const targetWeight = selectedProductData?.weight || 1000;
                                            const batchOutW = Number(batchOutputWeight) || targetWeight;
                                            const wastageP = Number(batchWastagePercent) || 0;

                                            // Math ratios
                                            const ratioFraction = item.quantity / batchOutW;
                                            const ratioPercent = ratioFraction * 100;
                                            const pWeight = ratioFraction * targetWeight;
                                            const pWeightWastage = pWeight * (1 + wastageP / 100);

                                            return (
                                              <tr key={`${item.rawMaterialId}-${idx}`} className="hover:bg-slate-900/60 transition-colors">
                                                <td className="px-3.5 py-2.5 font-bold text-slate-200">
                                                  {editingBatchMatId === item.rawMaterialId ? (
                                                    <div className="w-full text-right" style={{ direction: 'rtl' }}>
                                                      <SearchableSelect
                                                        id={`batch-edit-mat-select-${item.rawMaterialId}`}
                                                        value={editingBatchMatSelectedId}
                                                        onChange={(val) => setEditingBatchMatSelectedId(val)}
                                                        options={selectableMaterials}
                                                        placeholder="-- کالا/ماده مصرفی را انتخاب کنید --"
                                                      />
                                                    </div>
                                                  ) : (
                                                    <>
                                                      <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span>{rawMat?.name || `ماده اولیه حذف‌شده (${item.rawMaterialId})`}</span>
                                                        {rawMat && 'isWip' in rawMat && rawMat.isWip && (
                                                          <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 text-[8px] px-1.5 py-0.5 rounded font-sans font-bold">نیمه‌ساخته</span>
                                                        )}
                                                      </div>
                                                      <div className="text-[9px] text-slate-500 font-mono">کد: {rawMat?.code || '-'} | معین: {rawMat?.accountId || item.rawMaterialId}</div>
                                                    </>
                                                  )}
                                                </td>
                                                <td className="px-3.5 py-2.5 text-center font-mono text-zinc-300">
                                                  {editingBatchMatId === item.rawMaterialId ? (
                                                    <div className="flex items-center justify-center gap-1.5" dir="ltr">
                                                      <span className="text-[10px] text-slate-450 font-sans">گرم</span>
                                                      <input
                                                        type="number"
                                                        className="w-20 py-0.5 px-2 border border-indigo-500 rounded-lg text-xs font-mono bg-slate-900 text-white outline-none focus:ring-1 focus:ring-indigo-500 text-center"
                                                        value={editingBatchMatQty}
                                                        onChange={(e) => setEditingBatchMatQty(e.target.value === '' ? '' : Math.abs(parseFloat(e.target.value)))}
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                          if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleSaveInlineEditBatch(item.rawMaterialId);
                                                          } else if (e.key === 'Escape') {
                                                            handleCancelInlineEditBatch();
                                                          }
                                                        }}
                                                      />
                                                    </div>
                                                  ) : (
                                                    <span>{toPersianDigits(item.quantity)} گرم</span>
                                                  )}
                                                </td>
                                                <td className="px-3.5 py-2.5 text-center font-mono text-cyan-400">{toPersianDigits(ratioPercent.toFixed(1))}%</td>
                                                <td className="px-3.5 py-2.5 text-center font-mono text-slate-400">{toPersianDigits(pWeight.toFixed(1))} گرم</td>
                                                <td className="px-3.5 py-2.5 text-center font-mono text-emerald-400 bg-emerald-500/[0.02]">
                                                  {toPersianDigits(pWeightWastage.toFixed(1))} گرم
                                                </td>
                                                <td className="px-3.5 py-2.5 text-center">
                                                  {editingBatchMatId === item.rawMaterialId ? (
                                                    <div className="flex items-center justify-center gap-1.5">
                                                      <button
                                                        type="button"
                                                        onClick={() => handleSaveInlineEditBatch(item.rawMaterialId)}
                                                        className="p-1 hover:bg-emerald-950 rounded text-emerald-450 hover:text-emerald-400 transition-colors cursor-pointer"
                                                        title="ذخیره تغییرات"
                                                      >
                                                        <Check className="h-3.5 w-3.5" />
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={handleCancelInlineEditBatch}
                                                        className="p-1 hover:bg-slate-900 rounded text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
                                                        title="انصراف"
                                                      >
                                                        <X className="h-3.5 w-3.5" />
                                                      </button>
                                                    </div>
                                                  ) : (
                                                    <div className="flex items-center justify-center gap-1.5">
                                                      <button
                                                        type="button"
                                                        onClick={() => handleStartInlineEditBatch(item.rawMaterialId, item.quantity)}
                                                        className="p-1 hover:bg-slate-900 rounded text-slate-400 hover:text-indigo-400 transition-all cursor-pointer"
                                                        title="ویرایش مقدار"
                                                      >
                                                        <Edit className="h-3.5 w-3.5" />
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleRemoveBatchIngredient(item.rawMaterialId)}
                                                        className="p-1 hover:bg-rose-950/60 rounded text-slate-500 hover:text-rose-455 transition-all cursor-pointer"
                                                        title="حذف"
                                                      >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                      </button>
                                                    </div>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                      </tbody>
                                    <tfoot className="bg-slate-900 border-t-2 border-slate-800 font-bold text-xs text-white">
                                      <tr className="bg-slate-900/95">
                                        <td className="px-3.5 py-3 font-extrabold text-slate-350">مجموع کل مصارف در بچ</td>
                                        <td className="px-3.5 py-3 text-center font-mono text-zinc-100">
                                          {toPersianDigits(batchIngredients.reduce((sum, item) => sum + item.quantity, 0).toFixed(0))} <span className="text-[10px] text-slate-550">گرم</span>
                                        </td>
                                        <td className="px-3.5 py-3 text-center font-mono text-cyan-400">
                                          {toPersianDigits(((batchIngredients.reduce((sum, item) => sum + item.quantity, 0) / (Number(batchOutputWeight) || (selectedProductData?.weight || 1000))) * 100).toFixed(1))}%
                                        </td>
                                        <td className="px-3.5 py-3 text-center font-mono text-slate-300">
                                          {toPersianDigits(((batchIngredients.reduce((sum, item) => sum + item.quantity, 0) / (Number(batchOutputWeight) || (selectedProductData?.weight || 1000))) * (selectedProductData?.weight || 1000)).toFixed(1))} <span className="text-[10px] text-slate-550">گرم</span>
                                        </td>
                                        <td className="px-3.5 py-3 text-center font-mono text-emerald-400 bg-emerald-500/[0.04]">
                                          {toPersianDigits((
                                            ((batchIngredients.reduce((sum, item) => sum + item.quantity, 0) / (Number(batchOutputWeight) || (selectedProductData?.weight || 1000))) * (selectedProductData?.weight || 1000)) * (1 + (Number(batchWastagePercent) || 0) / 100)
                                          ).toFixed(1))} <span className="text-[10px] text-emerald-500/60">گرم</span>
                                        </td>
                                        <td className="px-3.5 py-3 text-center"></td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}

                                {/* Total and Actions */}
                                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
                                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-305 font-bold">
                                    <div>
                                      مجموع مواد در مصرف بچ: <span className="text-white font-mono">{toPersianDigits(batchIngredients.reduce((acc, i) => acc + i.quantity, 0))} گرم</span>
                                    </div>
                                    <div className="border-r border-slate-800 h-4 hidden sm:block"></div>
                                    <div>
                                      وزن پر شده تک بسته هدف: <span className="text-white font-mono">{toPersianDigits(selectedProductData?.weight || 1000)} گرم</span>
                                    </div>
                                    <div className="border-r border-slate-800 h-4 hidden sm:block"></div>
                                    <div className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">
                                      مجموع مواد برای پارت تک محصول با کسر پخت {toPersianDigits(batchWastagePercent || 0)}٪: 
                                      <span className="font-mono font-black ml-1">
                                        {toPersianDigits((
                                          batchIngredients.reduce((acc, item) => {
                                            const targetW = selectedProductData?.weight || 1000;
                                            const batchOutW = Number(batchOutputWeight) || targetW;
                                            const wastageP = Number(batchWastagePercent) || 0;
                                            const ratio = item.quantity / batchOutW; 
                                            const pWeight = ratio * targetW;
                                            return acc + pWeight * (1 + wastageP / 100);
                                          }, 0)
                                        ).toFixed(1))} گرم
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBatchIngredients([]);
                                        setBatchOutputWeight('');
                                        setBatchWastagePercent('');
                                      }}
                                      className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all hover:bg-slate-850 cursor-pointer"
                                    >
                                      پاکسازی همه
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleApplyBatchToFormula}
                                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-emerald-600/10 flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Check className="h-4 w-4" />
                                      محاسبه و درج خودکار به فرمولاسیون فعال
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Formula components addition form */}
                    <div className="bg-slate-900 p-4 rounded-2xl border border-slate-850 space-y-3">
                      <div className="flex items-center gap-1 text-slate-300 font-bold text-xs">
                        <Plus className="h-4 w-4 text-rose-500" />
                        <span>افزودن ماده خام / کالا به دستور مصرف پخت</span>
                      </div>
                      
                      <form onSubmit={handleAddIngredient} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-12 lg:col-span-8">
                          <label htmlFor="recipe-raw-select-premium" className="text-[10px] font-bold text-slate-400 block mb-1">کالا یا ماده خام مصرفی</label>
                          <SearchableSelect
                            id="recipe-raw-select-premium"
                            value={draftMaterialId}
                            onChange={(val) => setDraftMaterialId(val)}
                            options={selectableMaterials}
                            placeholder="-- کالا یا ماده مصرفی را انتخاب کنید --"
                          />
                        </div>

                        <div className="md:col-span-6 lg:col-span-2">
                          <label htmlFor="recipe-consumption-qty-premium" className="text-[10px] font-bold text-slate-400 block mb-1">
                            مقدار مصرف ({selectedDraftMaterial?.unit === 'کیلویی' ? 'گرم' : (findMaterialConversion(draftMaterialId, selectedDraftMaterial?.rawItem)?.consumptionUnit || (selectedDraftMaterial?.isWip ? (selectedDraftMaterial.unit === 'کیلویی' ? 'گرم' : 'عدد') : selectedDraftMaterial?.unit) || 'گرم/واحد')})
                          </label>
                          <input
                            id="recipe-consumption-qty-premium"
                            type="number"
                            step="any"
                            onFocus={handleFocus}
                            className="w-full p-2 border border-slate-800 rounded-xl text-xs font-mono bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                            placeholder="مقدار به عنوان واحد مصرف"
                            value={draftMaterialQty || ''}
                            onChange={(e) => setDraftMaterialQty(parseNumber(e.target.value))}
                            min={0.0001}
                            required
                          />
                        </div>

                         <div className="md:col-span-6 lg:col-span-2">
                          {editingMaterialId ? (
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="w-2/3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2 px-3 text-xs font-bold transition-all shadow-md shadow-emerald-600/10 cursor-pointer h-10 flex items-center justify-center gap-1"
                              >
                                <Check className="h-4 w-4" />
                                ثبت تغییرات
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMaterialId(null);
                                  setDraftMaterialId('');
                                  setDraftMaterialQty(0);
                                }}
                                className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2 px-2 text-xs font-bold transition-all cursor-pointer h-10 flex items-center justify-center"
                              >
                                انصراف
                              </button>
                            </div>
                          ) : (
                            <button
                              type="submit"
                              className="w-full bg-rose-600 hover:bg-rose-700 text-white rounded-xl py-2 px-4 text-xs font-bold transition-all shadow-md shadow-rose-600/10 cursor-pointer h-10 flex items-center justify-center gap-1"
                            >
                              <Plus className="h-4 w-4" />
                              افزودن
                            </button>
                          )}
                        </div>
                      </form>
                    </div>

                    {/* LIVE SPEC EDITOR SHORTCUT FOR MATERIAL (UX speedup) */}
                    {selectedDraftMaterial && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-slate-900 border border-slate-850/80 p-3.5 rounded-2xl text-xs text-slate-300 space-y-2"
                      >
                        <div className="flex justify-between items-center border-b border-slate-850 pb-2">
                          <span className="flex items-center gap-1 font-bold text-slate-200">
                            <Info className="h-3.5 w-3.5 text-blue-400" />
                            برگ مشخصات خرید مبدا: <strong className="text-white">{selectedDraftMaterial.name}</strong>
                          </span>
                          {!selectedDraftMaterial.isWip && selectedDraftMaterial.rawItem && (
                            <button
                              type="button"
                              onClick={() => setEditingItemInline(selectedDraftMaterial.rawItem!)}
                              className="text-rose-455 hover:text-rose-400 font-extrabold flex items-center gap-0.5 hover:underline cursor-pointer"
                            >
                              <Edit className="h-3.5 w-3.5" /> ویرایش ثبتی ماده خام
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-slate-400 text-[11px]">
                          <div>نرخ خرید مبدا: <span className="text-white font-bold">{formatWithCommas(selectedDraftMaterial.price)} ریال</span></div>
                          <div>واحد خرید: <span className="text-white font-bold">{selectedDraftMaterial.unit}</span></div>
                          <div>جعبه/بسته‌بندی: <span className="text-white font-bold">{selectedDraftMaterial.packageType}</span></div>
                          <div>نرخ کالیبراسیون: <span className="text-amber-400 font-bold">۱ {selectedDraftMaterial.unit === 'کیلویی' ? 'کیلو' : 'عدد'} = {toPersianDigits(activeConversionFactor)} {selectedDraftMaterial.unit === 'کیلویی' ? 'گرم' : (findMaterialConversion(draftMaterialId, selectedDraftMaterial.rawItem)?.consumptionUnit || 'گرم')}</span></div>
                        </div>
                      </motion.div>
                    )}

                    {/* BOM LIST TABLE */}
                    <div className="space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-900">
                        <div className="space-y-0.5 text-right">
                          <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5">
                            <Coffee className="h-4 w-4 text-rose-500" />
                            مواد تشکیل‌دهنده فرمول ساخت (BOM):
                          </h3>
                          <p className="text-[10px] text-zinc-400">بهای محاسباتی مصرفی بر اساس تقسیم ضریب کالیبراسیون بر قیمت خرید مرجع (ذخیره‌سازی با کد معین حسابداری)</p>
                        </div>
                        {activeFormulaData && activeFormulaData.ingredients.length > 0 && (
                          <button
                            type="button"
                            onClick={printFormulationReport}
                            className="bg-zinc-900 hover:bg-zinc-850 text-slate-200 hover:text-white border border-zinc-800 hover:border-zinc-700 px-3.5 py-2 rounded-xl text-[10.5px] font-bold cursor-pointer transition-all flex items-center gap-1.5 self-end sm:self-auto"
                          >
                            <Printer className="h-3.5 w-3.5 text-emerald-400" />
                            چاپ گزارش حرفه‌ای فرمولاسیون
                          </button>
                        )}
                      </div>
                      
                      <div className="border border-slate-850 rounded-2xl overflow-x-auto bg-slate-950 shadow-inner">
                        <table className="min-w-full text-right text-xs">
                          <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-850">
                            <tr>
                              <th className="px-4 py-3 text-[10px] text-slate-450 border-b border-slate-850">کد و نام ماده اولیـه اصلی</th>
                              <th className="px-4 py-2 text-center text-[10px] text-slate-450 border-b border-slate-850">حجم مصرفی در فرمول پخت</th>
                              <th className="px-4 py-3 text-left text-[10px] text-slate-450 border-b border-slate-850">بهای خرید مرجع (ریال/واحد)</th>
                              <th className="px-4 py-3 text-left text-[10px] text-slate-450 border-b border-slate-850">بهای محاسباتی مصرف تک ردیف</th>
                              <th className="px-4 py-2 text-center text-[10px] text-slate-450 border-b border-slate-850">عملیات مدیریت</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-900 font-medium">
                            {!activeFormulaData || activeFormulaData.ingredients.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-slate-500 animate-pulse">فرمول ساخت و اجزای مصرفی آرد، مغز و افزودنی ها هنوز ثمر نبخشیده است. از فرم فوق اضافه فرمایید.</td>
                              </tr>
                            ) : (
                              <>
                                {activeFormulaData.ingredients.map((ing, index) => {
                                  const resolved = resolveMaterialByKey(ing.rawMaterialId);
                                  const item = resolved.item || resolved.wip;
                                  if (!item) {
                                    return (
                                      <tr key={`${ing.rawMaterialId}-${index}`} className="bg-amber-950/15 hover:bg-amber-950/25 transition-all">
                                        <td className="px-4 py-3 border-r border-slate-900">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <div className="font-extrabold text-amber-300">کالا / ماده اولیه یافت نشد (حذف‌شده)</div>
                                            <span className="bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[8px] px-1.5 py-0.5 rounded font-bold">منتظر ثبت مجدد با همین کد</span>
                                          </div>
                                          <div className="text-[9px] text-amber-400/80 font-mono">کد معین حسابداری ذخیره‌شده: {toPersianDigits(ing.rawMaterialId)}</div>
                                        </td>
                                        <td className="px-4 py-2 text-center font-mono font-black text-rose-450">
                                          {toPersianDigits(ing.quantity)}
                                        </td>
                                        <td className="px-4 py-2 text-left font-mono text-slate-500">
                                          ۰ <span className="text-[9px]">نامشخص</span>
                                        </td>
                                        <td className="px-4 py-2 text-left font-mono font-black text-slate-500">
                                          ۰ <span className="text-[9px] font-normal">ریال</span>
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                          <button
                                            type="button"
                                            onClick={() => deleteIngredient(ing.rawMaterialId)}
                                            className="text-rose-500 hover:text-rose-400 text-[11px] font-black cursor-pointer hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-all inline-block"
                                          >
                                            حذف ردیف
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  }

                                  const isWipItem = resolved.isWip;

                                  let itemPrice = 0;
                                  let consumptionUnit = 'گرم/عدد';
                                  let factor = 1;
                                  let displayPricePerUnit = '';

                                  if (isWipItem && resolved.wip) {
                                    itemPrice = fullCalculatedCOGSMap[resolved.wip.id]?.totalCOGSPrice || resolved.wip.cogsPrice || 0;
                                    consumptionUnit = resolved.wip.unit === 'کیلو' ? 'گرم' : 'عدد';
                                    factor = resolved.wip.unit === 'کیلو' ? 1000 : 1;
                                    displayPricePerUnit = `به ازای هر ${resolved.wip.unit === 'کیلو' ? 'کیلو' : 'عدد'}`;
                                  } else if (resolved.item) {
                                    itemPrice = resolved.item.price;
                                    if (resolved.item.unit === 'کیلویی') {
                                      factor = 1000;
                                      consumptionUnit = 'گرم';
                                    } else {
                                      const conv = findMaterialConversion(ing.rawMaterialId, resolved.item);
                                      factor = conv ? conv.factor : 1;
                                      consumptionUnit = conv?.consumptionUnit || 'عدد';
                                    }
                                    displayPricePerUnit = `به ازای هر ${resolved.item.unit === 'کیلویی' ? 'کیلو' : 'عدد'}`;
                                  }

                                  const unitPrice = itemPrice / factor;
                                  const cost = ing.quantity * unitPrice;
                                  const canonicalMatKey = getMaterialFormulaKey(item);

                                  return (
                                    <tr key={`${ing.rawMaterialId}-${index}`} className="hover:bg-slate-900/50 transition-all">
                                      <td className="px-4 py-3 border-r border-slate-900">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <div className="font-extrabold text-slate-200">{item.name}</div>
                                          {isWipItem && (
                                            <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[8px] px-1 rounded font-bold">نیمه‌ساخته</span>
                                          )}
                                          {!item.accountId && (
                                            <span className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[8px] px-1 rounded font-bold">فاقد کد معین</span>
                                          )}
                                        </div>
                                        <div className="text-[9px] text-slate-500 font-mono">کد: {item.code} | کد معین حسابداری: {item.accountId || 'ثبت‌نشده'}</div>
                                      </td>
                                      <td className="px-4 py-2 text-center font-mono font-black text-rose-450">
                                        {toPersianDigits(ing.quantity)} {consumptionUnit}
                                      </td>
                                      <td className="px-4 py-2 text-left font-mono text-slate-350">
                                        {formatWithCommas(Math.round(itemPrice))} <span className="text-[9px] text-slate-500">{displayPricePerUnit}</span>
                                      </td>
                                      <td className="px-4 py-2 text-left font-mono font-black text-emerald-450">
                                        {formatWithCommas(Math.round(cost))} <span className="text-[9px] text-slate-500 font-normal">ریال</span>
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDraftMaterialId(canonicalMatKey);
                                              setDraftMaterialQty(ing.quantity);
                                              setEditingMaterialId(ing.rawMaterialId);
                                            }}
                                            className="text-amber-500 hover:text-amber-400 text-[11px] font-black cursor-pointer hover:bg-amber-500/10 px-2 py-1 rounded-lg transition-all inline-block"
                                          >
                                            ویرایش ردیف
                                          </button>
                                          <span className="text-slate-800">|</span>
                                          <button
                                            type="button"
                                            onClick={() => deleteIngredient(ing.rawMaterialId)}
                                            className="text-rose-500 hover:text-rose-400 text-[11px] font-black cursor-pointer hover:bg-rose-500/10 px-2 py-1 rounded-lg transition-all inline-block"
                                          >
                                            حذف ردیف
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}

                                {/* ROW SUM TOTALS - EXTREMELY ELEGANT & COLUMN ALIGNED */}
                                {(() => {
                                  // calculate total weight in grams directly from (items with KG unit) + (items that have been converted)
                                  const totalWeight = activeFormulaData.ingredients.reduce((sum, ing) => {
                                    const resolved = resolveMaterialByKey(ing.rawMaterialId);
                                    const item = resolved.item || resolved.wip;
                                    if (!item) return sum;

                                    let weightInGrams = 0;

                                    if (resolved.isWip && resolved.wip) {
                                      if (resolved.wip.unit === 'کیلو') {
                                        weightInGrams = ing.quantity;
                                      }
                                    } else if (resolved.item) {
                                      if (resolved.item.unit === 'کیلویی') {
                                        weightInGrams = ing.quantity;
                                      } else {
                                        const conv = findMaterialConversion(ing.rawMaterialId, resolved.item);
                                        if (conv) {
                                          const cUnit = conv.consumptionUnit || '';
                                          const isWeightBased = cUnit === 'گرم' || cUnit === 'سی سی' || cUnit.includes('گرم') || cUnit.includes('سی‌سی') || cUnit.includes('سی سی') || cUnit.includes('کیلو');
                                          if (isWeightBased) {
                                            if (cUnit.includes('کیلو')) {
                                              weightInGrams = ing.quantity * 1000;
                                            } else {
                                              weightInGrams = ing.quantity;
                                            }
                                          }
                                        }
                                      }
                                    }
                                    return sum + weightInGrams;
                                  }, 0);

                                  // calculate total cost
                                  const totalCost = activeFormulaData.ingredients.reduce((sum, ing) => {
                                    const resolved = resolveMaterialByKey(ing.rawMaterialId);
                                    const item = resolved.item || resolved.wip;
                                    if (!item) return sum;

                                    let itemPrice = 0;
                                    let factor = 1;

                                    if (resolved.isWip && resolved.wip) {
                                      itemPrice = fullCalculatedCOGSMap[resolved.wip.id]?.totalCOGSPrice || resolved.wip.cogsPrice || 0;
                                      factor = resolved.wip.unit === 'کیلو' ? 1000 : 1;
                                    } else if (resolved.item) {
                                      itemPrice = resolved.item.price;
                                      factor = resolved.item.unit === 'کیلویی' ? 1000 : (findMaterialConversion(ing.rawMaterialId, resolved.item)?.factor || 1);
                                    }

                                    const unitPrice = itemPrice / factor;
                                    return sum + Math.round(ing.quantity * unitPrice);
                                  }, 0);

                                  return (
                                    <tr className="bg-slate-900/60 font-black border-t-2 border-slate-800">
                                      <td className="px-4 py-4 text-slate-300 font-extrabold text-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                                          سرجمع فرمول پخت کالا (BOM):
                                        </div>
                                      </td>
                                      <td className="px-4 py-4 text-center">
                                        <div className="flex flex-col gap-1 items-center justify-center">
                                          {totalWeight > 0 ? (
                                            <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-3 py-1.5 rounded-xl font-mono text-center text-xs font-black min-w-[120px] inline-block">
                                              وزن کل: {toPersianDigits(totalWeight.toFixed(totalWeight % 1 === 0 ? 0 : 2))} گرم
                                            </span>
                                          ) : (
                                            <span className="text-slate-500 font-mono">-</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-4 text-left text-slate-400 font-normal">
                                        -
                                      </td>
                                      <td className="px-4 py-4 text-left">
                                        <div className="inline-block bg-emerald-950/40 border border-emerald-500/20 px-4 py-2 rounded-xl font-mono text-xs text-emerald-400 font-black">
                                          بهای کل مواد: {formatWithCommas(Math.round(totalCost))} <span className="text-[10px] text-emerald-300 font-normal">ریال</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-4 text-center text-slate-500 font-normal">
                                        -
                                      </td>
                                    </tr>
                                  );
                                })()}
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                  </motion.div>
                ) : (
                  <div className="bg-slate-950 p-16 text-center rounded-3xl text-slate-500 border border-slate-850 flex flex-col items-center justify-center space-y-3 h-[400px]">
                    <Layers className="h-10 w-10 text-slate-700 animate-bounce" />
                    <span className="text-xs font-bold text-slate-400">لطفا یک فرآورده نهایی را جهت نمایش، ترسیم قیمت تمام شده یا تدوین فرمول ساخت مصرفی از منوی پهلو گزینش بفرمایید.</span>
                  </div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </div>
      )}


      {/* ======================= TAB 2: UNIT CONVERSION MANAGEMENT MATRIX ======================= */}
      {activeTab === 'conversions' && (
        <div id="cogs-conversions-printable" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left conversion formula addition */}
            <div className="lg:col-span-4 bg-slate-950 p-5 rounded-3xl border border-slate-850 h-fit space-y-4">
              <div className="border-b border-slate-900 pb-2">
                <h3 className="text-xs font-black text-slate-200">
                  {editingConvId ? 'ویرایش کالیبره و ضریب تبدیل' : 'کالیبره و ضریب تبدیل واحد هوشمند'}
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">نرخ‌گذاری پلتفرم بر اساس واحدهای بزرگ خرید (کیلویی/عددي) است اما در دستور پخت از وزن گرم استفاده می‌شود. با ثبت ضرایب، تقسیم آنلاین خودکار صورت می‌پذیرد.</p>
              </div>

              <form onSubmit={handleAddConversion} className="space-y-4">
                <div>
                  <label htmlFor="conv-raw-select-premium" className="block text-[10px] font-bold text-slate-400 mb-1">کالای خام هدف</label>
                  <SearchableSelect
                    id="conv-raw-select-premium"
                    value={newConvMatId}
                    onChange={(val) => setNewConvMatId(val)}
                    options={rawItems.filter(r => r.unit === 'عددی').map(r => ({
                      value: r.id,
                      label: `${r.name} (${r.code})`
                    }))}
                    placeholder="-- ماده اولیه را برگزینید --"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="conv-punit-premium" className="block text-[10px] font-semibold text-slate-400 mb-1">واحد خرید</label>
                    <select
                      id="conv-punit-premium"
                      className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer"
                      value={newConvPUnit}
                      onChange={(e) => setNewConvPUnit(e.target.value)}
                      required
                    >
                      <option value="بسته">بسته</option>
                      <option value="کارتن">کارتن</option>
                      <option value="جعبه">جعبه</option>
                      <option value="شیشه">شیشه</option>
                      <option value="قوطی">قوطی</option>
                      <option value="شل">شل</option>
                      <option value="گالن">گالن</option>
                      <option value="کیلوگرم">کیلوگرم</option>
                      <option value="عدد">عدد</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conv-cunit-premium" className="block text-[10px] font-semibold text-slate-400 mb-1">واحد فرمول مصرفی</label>
                    <select
                      id="conv-cunit-premium"
                      className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 cursor-pointer"
                      value={newConvCUnit}
                      onChange={(e) => setNewConvCUnit(e.target.value)}
                      required
                    >
                      <option value="عدد">عدد</option>
                      <option value="گرم">گرم</option>
                      <option value="سی سی">سی سی</option>
                      <option value="میلی‌لیتر">میلی‌لیتر</option>
                      <option value="برگ">برگ</option>
                      <option value="سانتی‌متر">سانتی‌متر</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="conv-factor-premium" className="block text-[10px] font-semibold text-slate-400 mb-1">ضریب کالیبره (نرخ تبدیل در هر واحد بزرگ)</label>
                  <input
                    id="conv-factor-premium"
                    type="number"
                    onFocus={handleFocus}
                    className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={newConvFactor}
                    onChange={(e) => setNewConvFactor(parseNumber(e.target.value))}
                    min={1}
                    required
                  />
                  <span className="block text-[8px] text-slate-500 mt-1">مثال: ۱ کیلوگرم آرد نول = ۱۰۰۰ گرم (عدد ۱۰۰۰ درج شود)</span>
                </div>

                <div className="flex gap-2">
                  {editingConvId && (
                    <button
                      type="button"
                      onClick={cancelEditConversion}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl py-2.5 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                    >
                      انصراف
                    </button>
                  )}
                  <button
                    type="submit"
                    className={`${editingConvId ? 'flex-[2] bg-indigo-600 hover:bg-indigo-700' : 'w-full bg-rose-600 hover:bg-rose-700'} text-white rounded-xl py-2.5 text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-1`}
                  >
                    {editingConvId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {editingConvId ? 'ذخیره تغییرات ضریب' : 'ثبت رسمی ضابطه تبدیل واحد'}
                  </button>
                </div>
              </form>
            </div>

            {/* Right side interactive List & spreadsheet view */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950 p-4 rounded-3xl border border-slate-850">
                <div className="relative w-full sm:w-64">
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-500" />
                  </span>
                  <input
                    id="conv-search-inp-premium"
                    type="text"
                    placeholder="جستجو کالا در جدول تبدیل‌ها..."
                    className="w-full pl-3 pr-10 py-1.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans"
                    value={convSearch}
                    onChange={(e) => setConvSearch(e.target.value)}
                  />
                </div>
                
                <button
                  onClick={exportConversionsCSV}
                  className="text-xs bg-emerald-950/30 text-emerald-400 border border-emerald-500/10 px-3 py-1.5 rounded-xl font-bold hover:bg-emerald-900/20 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  خروجی اکسل مبدل‌ها (CSV)
                </button>
              </div>

              <div className="border border-slate-850 rounded-3xl overflow-x-auto bg-slate-950">
                <table className="min-w-full text-right text-xs">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-850">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-300">ماده خام ورودی</th>
                      <th className="px-4 py-2 text-center text-slate-300">واحد اصلی خرید</th>
                      <th className="px-4 py-2 text-center text-slate-300">واحد خرد مصرفی</th>
                      <th className="px-4 py-2 text-left text-slate-300">تناسب ضریب تبدیل ساخت</th>
                      <th className="px-4 py-2 text-center text-slate-300">مدیریت ضریب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {searchedConversions.map(c => {
                      const r = rawItemMap[c.rawMaterialId];
                      return (
                        <tr key={c.id} className="hover:bg-slate-900/40 transition-all">
                          <td className="px-4 py-3 border-r border-slate-905">
                            <span className="font-extrabold text-slate-200">{r?.name}</span>
                            <span className="text-[9px] text-slate-500 block">شناسه‌کالا: {r?.code}</span>
                          </td>
                          <td className="px-4 py-2 text-center font-extrabold text-rose-400">{c.purchaseUnit}</td>
                          <td className="px-4 py-2 text-center font-extrabold text-indigo-400">{c.consumptionUnit}</td>
                          <td className="px-4 py-2 text-left font-mono font-black text-slate-100">
                            ۱ {c.purchaseUnit} = <span className="text-emerald-400 font-extrabold">{toPersianDigits(c.factor)}</span> {c.consumptionUnit}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => startEditConversion(c)}
                                className="text-amber-500 hover:text-amber-450 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                              >
                                ویرایش
                              </button>
                              <button
                                onClick={() => deleteConversion(c.id)}
                                className="text-rose-500 hover:text-rose-450 hover:bg-rose-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                              >
                                حذف سرفصل
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {searchedConversions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 animate-pulse">در این دوره مالی هیچ ضابطه یا ضریب کالیبره واحدی به ثبت نرسیده است.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}


      {/* ===================== TIMELINE-BASED PRODUCTION PLANNER & ALLOCATOR ===================== */}
      {activeTab === 'timeline' && (
        <div id="cogs-timeline-printable" className="space-y-6 animate-fade-in text-right">
          
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850">
            <h2 className="text-sm font-black text-rose-450 border-b border-slate-850 pb-3 mb-3 flex items-center gap-2">
              <Clock className="h-5 w-5 text-rose-500" />
              برنامه‌ریزی تولید کارگاهی و جدول تسهیم پیشرفته زمان‌محور
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              با ثبت بازه‌های کارگاهی واقعی هر محصول در طول یک روز کار، نرخ تخصیص زمان ساخت (دقیقه به ازای هر واحد محصول) محاسبه گشته و سهم حقوق مستقیم، فیش بیمه و حتی هزینه‌های سربار متناسب با زمان حقیقی تلف‌شده روی آن فرآورده تسهیم قطعی می‌گردد. این روش نارسایی روش تخصیص ساده حجمی را کاملا مرتفع می‌سازد.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* RIGHT COLUMN: Form and Department Wages */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Creator Form */}
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4 shadow-xl">
                <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5 border-b border-slate-850 pb-2">
                  <Plus className="h-4 w-4 text-emerald-400" />
                  {editingSegmentId ? 'ویرایش ردیف زمان‌بندی تولید' : 'ثبت بخش زمانی تولید جدید'}
                </h3>

                <form onSubmit={handleAddTimelineNode} className="space-y-3.5">
                  <div>
                    <label htmlFor="timeline-prod-select" className="block text-[10px] font-bold text-slate-400 mb-1.5">انتخاب فرآورده نهایی</label>
                    <SearchableSelect
                      id="timeline-prod-select"
                      value={timelineProductId}
                      onChange={(val) => setTimelineProductId(val)}
                      options={products.map(p => ({
                        value: p.id,
                        label: `${p.code} | ${p.name}`
                      }))}
                      placeholder="-- محصول را گزینش کنید --"
                    />
                  </div>
                  <div>
                    <label htmlFor="timeline-duration-input" className="block text-[10px] font-bold text-slate-400 mb-1">مدت زمان تولید محصول (دقیقه)</label>
                    <input
                      id="timeline-duration-input"
                      type="number"
                      onFocus={handleFocus}
                      placeholder="مثال: ۴۵"
                      className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 font-mono focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none"
                      value={timelineDuration || ''}
                      onChange={(e) => setTimelineDuration(parseNumber(e.target.value))}
                      min={1}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="timeline-qty-input" className="block text-[10px] font-bold text-slate-400 mb-1">حجم واقعی تولید (تعداد / واحد فیزیکی)</label>
                    <input
                      id="timeline-qty-input"
                      type="number"
                      onFocus={handleFocus}
                      placeholder="مثال: ۱۰۰ عدد"
                      className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-100 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none"
                      value={timelineProducedQty || ''}
                      onChange={(e) => setTimelineProducedQty(parseNumber(e.target.value))}
                      min={1}
                      required
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="submit"
                      className={`flex-grow py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-1 ${
                        editingSegmentId 
                          ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10' 
                          : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/15'
                      }`}
                    >
                      {editingSegmentId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      {editingSegmentId ? 'بروزرسانی تغییرات ردیف' : 'درج در تایم‌لاین تولید'}
                    </button>
                    {editingSegmentId && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineProductId('');
                          setTimelineDuration(0);
                          setTimelineProducedQty(0);
                          setEditingSegmentId(null);
                        }}
                        className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-350 rounded-xl text-xs font-extrabold cursor-pointer"
                      >
                        لغو
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Department Labor Budgets (Daily representation) */}
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
                <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5 border-b border-slate-850 pb-2">
                  <Users className="h-4 w-4 text-sky-400" />
                  برآورد حقوق روزانه دپارتمان‌های فعال
                </h3>
                
                <div className="space-y-3">
                  {departments.map(dept => {
                    const monthlyDirect = departmentDirectLaborPayroll[dept.id] || 0;
                    const dailyDirect = monthlyDirect / 30;
                    return (
                      <div key={dept.id} className="p-3 bg-slate-900/60 rounded-2xl border border-slate-850/70 space-y-1.5 hover:border-slate-850 transition-all">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black text-white">{dept.name}</span>
                          <span className="text-[9px] text-slate-500">شناسه: {dept.id}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 border-t border-slate-850/40 pt-1.5 font-mono">
                          <div>ماهانه: <strong className="text-slate-300 font-bold">{formatWithCommas(Math.round(monthlyDirect))} ریال</strong></div>
                          <div className="text-left font-bold">روزانه (۳۰ روز): <strong className="text-emerald-450 font-black">{formatWithCommas(Math.round(dailyDirect))} ریال</strong></div>
                        </div>
                      </div>
                    );
                  })}
                  {departments.length === 0 && (
                    <p className="text-[10px] text-slate-500 text-center py-2">هیچ دپارتمان فعالی بارگذاری نشده است.</p>
                  )}
                </div>
              </div>

            </div>

            {/* LEFT COLUMN: Registered Segments and Calculated Coefficients */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* Daily production timeline */}
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-3 shadow-xl font-sans font-medium text-[11px]">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-slate-850 pb-2">
                  <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5">
                    <Activity className="h-4.5 w-4.5 text-indigo-400" />
                    برنامه زمانی عملیاتی تولید امروز کارگاه (Timeline)
                  </h3>
                  
                  <div className="relative w-full sm:w-64">
                    <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <Search className="h-3.5 w-3.5 text-slate-550" />
                    </span>
                    <input
                      id="timeline-search"
                      type="text"
                      placeholder="جستجوی محصول در تایم‌لاین..."
                      className="w-full pl-3 pr-8 py-1.5 border border-slate-800 rounded-lg text-[11px] bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans"
                      value={timelineSearchQuery}
                      onChange={(e) => setTimelineSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
 
                <div className="border border-slate-850 rounded-2xl overflow-x-auto bg-slate-950">
                  <table className="min-w-full text-right text-xs">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-850 text-[10px]">
                      <tr>
                        <th className="px-4 py-3 font-bold text-slate-300">فرآورده هدف</th>
                        <th className="px-4 py-2 text-center text-slate-300">مدت زمان تولید (دقیقه)</th>
                        <th className="px-4 py-2 text-center text-slate-300">حجم واقعی تولید (تعداد)</th>
                        <th className="px-4 py-2 text-left text-slate-300">سرعت تولید تک واحد</th>
                        <th className="px-4 py-2 text-center text-slate-300 font-bold">بخش مدیریتی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {filteredPeriodSegments.map(seg => {
                        const prod = products.find(p => p.id === seg.productId);
                        const durationMins = Math.max(0, parseTimeToMinutes(seg.endTime) - parseTimeToMinutes(seg.startTime));
                        const rate = seg.producedQty > 0 ? (durationMins / seg.producedQty) : 0;
 
                        return (
                          <tr key={seg.id} className="hover:bg-slate-900/50 transition-all">
                            <td className="px-4 py-3 border-r border-slate-900">
                              <span className="font-extrabold text-slate-100">{prod?.name || 'کالای ناشناخته'}</span>
                              <span className="text-[9px] text-slate-500 block">کد کالا: {prod?.code}</span>
                            </td>
                            <td className="px-4 py-2 text-center font-mono font-bold text-slate-300">{toPersianDigits(durationMins)} دقیقه</td>
                            <td className="px-4 py-2 text-center font-mono text-rose-450">{toPersianDigits(seg.producedQty)} عدد</td>
                            <td className="px-4 py-2 text-left font-mono font-black text-emerald-400">
                              {rate.toFixed(1)} <span className="text-[9px] text-slate-500">دقیقه/واحد</span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTimelineProductId(seg.productId);
                                    setTimelineDuration(durationMins);
                                    setTimelineProducedQty(seg.producedQty);
                                    setEditingSegmentId(seg.id);
                                  }}
                                  className="text-amber-500 hover:text-amber-400 text-[11px] font-bold px-2 py-0.5 rounded hover:bg-amber-500/10 cursor-pointer transition-all"
                                >
                                  ویرایش
                                </button>
                                <span className="text-slate-850">|</span>
                                <button
                                  type="button"
                                  onClick={() => deleteTimelineNode(seg.id)}
                                  className="text-rose-500 hover:text-rose-400 text-[11px] font-bold px-2 py-0.5 rounded hover:bg-rose-500/10 cursor-pointer transition-all"
                                >
                                  حذف
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredPeriodSegments.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500 animate-pulse">
                            {timelineSearchQuery ? 'محصولی با این مشخصات در برنامه زمانی امروز یافت نشد.' : 'هنوز هیچ بخشی برای تایم‌لاین تولید امروز ثبت نگردیده است. فرم سمت راست را تکمیل نمایید.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Simulation Result Matrices */}
              <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-slate-850 pb-3">
                  <h3 className="text-xs font-black text-white flex items-center gap-2">
                    <Percent className="h-4.5 w-4.5 text-emerald-400" />
                    بروزرسانی زنده قیمت تمام شده و سهم تخصیص زمان‌محور (در تک واحد)
                  </h3>
                  
                  <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
                    {/* Filter Toggle */}
                    <label className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer transition-all select-none">
                      <input
                        type="checkbox"
                        checked={onlyOperational}
                        onChange={(e) => setOnlyOperational(e.target.checked)}
                        className="rounded border-slate-800 text-rose-500 focus:ring-rose-500/20 bg-slate-950 focus:ring-offset-0 cursor-pointer h-3.5 w-3.5"
                      />
                      <span>فقط فرآورده‌های دارای برنامه زمانی عملیاتی</span>
                    </label>

                    <div className="relative w-full sm:w-64">
                      <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <Search className="h-3.5 w-3.5 text-slate-550" />
                      </span>
                      <input
                        id="live-update-search"
                        type="text"
                        placeholder="جستجوی محصول..."
                        className="w-full pl-3 pr-8 py-1 border border-slate-800 rounded-lg text-[11px] bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all font-sans"
                        value={liveSearchQuery}
                        onChange={(e) => setLiveSearchQuery(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-slate-850 rounded-2xl overflow-x-auto bg-slate-950">
                  <table className="min-w-full text-right text-xs">
                    <thead className="bg-slate-900 text-slate-400 border-b border-slate-850 text-[10px]">
                      <tr>
                        <th className="px-4 py-3 font-bold text-slate-300">فرآورده‌های نهایی فعال</th>
                        <th className="px-4 py-2 text-center text-slate-350">ثابت زمان (دقیقه/واحد)</th>
                        <th className="px-4 py-2 text-center text-slate-350">حقوق مستقیم زمان‌محور (ریال)</th>
                        <th className="px-4 py-2 text-center text-slate-350">حقوق مشترک (ریال)</th>
                        <th className="px-4 py-2 text-center text-slate-350">سهم سربار ساخت (ریال)</th>
                        <th className="px-4 py-2 text-left text-slate-200">بهای نهایی COGS تک واحد (ریال)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {searchedLiveProducts.map(p => {
                        const calculated = fullCalculatedCOGSMap[p.id] || { materialCost: 0, directLabor: 0, sharedLabor: 0, overheadCost: 0, totalCOGSPrice: 0 };
                        const unitTime = timeCoefficents[p.id] || 0;

                        return (
                          <tr key={p.id} className="hover:bg-slate-900/40 transition-all font-medium">
                            <td className="px-4 py-3 border-r border-slate-900 font-bold text-slate-300">{p.name}</td>
                            <td className="px-4 py-2 text-center font-mono text-slate-400 font-bold">{toPersianDigits(unitTime.toFixed(unitTime > 0 ? 2 : 0))} دقیقه</td>
                            <td className="px-4 py-2 text-center font-mono text-indigo-400 font-extrabold">{formatWithCommas(Math.round(calculated.directLabor))}</td>
                            <td className="px-4 py-2 text-center font-mono text-sky-450 font-black">{formatWithCommas(Math.round(calculated.sharedLabor))}</td>
                            <td className="px-4 py-2 text-center font-mono text-amber-400 font-bold">{formatWithCommas(Math.round(calculated.overheadCost))}</td>
                            <td className="px-4 py-2 text-left font-mono font-black text-rose-450 text-xs bg-slate-900/10">
                              {formatWithCommas(Math.round(calculated.totalCOGSPrice))} <span className="text-[8px] text-slate-500 font-sans">ریال</span>
                            </td>
                          </tr>
                        );
                      })}
                      {searchedLiveProducts.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500 animate-pulse">محصولی با این مشخصات یافت نشد.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 bg-rose-950/10 border border-rose-500/10 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 text-right">
                  <span className="text-[10px] text-slate-400">تغییرات فوق بلافاصله در شیت شبیه‌ساز بالا بروزآوری گردیده‌اند. جهت ثبت فیزیکی قطعی این مبالغ در کاتالوگ فروش کالا از دکمه زیر بهره ببرید:</span>
                  <button
                    onClick={applyCogsPricesToProductCatalog}
                    className="bg-rose-600 hover:bg-rose-700 text-white rounded-xl py-1.5 px-4 text-xs font-black transition-all cursor-pointer shadow-lg shadow-rose-600/10"
                  >
                    ثبت تغییرات در کاتالوگ
                  </button>
                </div>
              </div>

            </div>

          </div>

        </div>
      )}


      {/* ================= TAB 4: ADVANCED PROFIT AND ANALYSIS REPORT ================= */}
      {activeTab === 'analytics' && (
        <div id="cogs-analytics-printable" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h3 className="text-base font-bold text-white flex items-center gap-1.5">
              <DollarSign className="h-5 w-5 text-rose-500" /> بررسی قیمت تمام شده نسبت به قیمت فروش فرآورده‌ها
            </h3>
            
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={printProfitLossReport} className="text-xs font-bold border border-slate-800 bg-slate-900 p-2 px-4 rounded-xl select-none hover:bg-slate-800 text-slate-200 flex items-center gap-1 cursor-pointer">
                <Printer className="h-4 w-4" /> چاپ گزارش ارزش ریالی
              </button>
            </div>
          </div>

          {/* Search box and Formula/Department filters for Profit/Loss products */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-950 p-4 rounded-3xl border border-slate-850">
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute right-3.5 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="جستجوی نام یا کد فرآورده در جدول سود و زیان..."
                  className="w-full pl-3 pr-10 py-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-sans"
                  value={analyticsSearch}
                  onChange={(e) => setAnalyticsSearch(e.target.value)}
                />
              </div>

              {/* Department filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-bold whitespace-nowrap">دپارتمان / گروه:</span>
                <select
                  value={analyticsCategoryFilter}
                  onChange={(e) => setAnalyticsCategoryFilter(e.target.value)}
                  className="p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-2 focus:ring-rose-500/20 font-bold cursor-pointer transition-all"
                >
                  <option value="all">همه دپارتمان‌ها</option>
                  {departmentFilterOptions.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              {/* Formula status split filter */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 font-bold">تفکیک فرمول تولید:</span>
                <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setAnalyticsFormulaFilter('all')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      analyticsFormulaFilter === 'all'
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    همه فرآورده‌ها ({toPersianDigits(productsWithLossAndProfit.length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsFormulaFilter('with_formula')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                      analyticsFormulaFilter === 'with_formula'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    تولیدی (دارای فرمول) ({toPersianDigits(productsWithLossAndProfit.filter(x => !isProductPurchased(x.prod) && db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, x.prod) && f.periodId === activePeriodId && f.ingredients.length > 0)).length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsFormulaFilter('without_formula')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                      analyticsFormulaFilter === 'without_formula'
                        ? 'bg-amber-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    تولیدی (بدون فرمول) ({toPersianDigits(productsWithLossAndProfit.filter(x => !isProductPurchased(x.prod) && !db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, x.prod) && f.periodId === activePeriodId && f.ingredients.length > 0)).length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsFormulaFilter('purchased')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                      analyticsFormulaFilter === 'purchased'
                        ? 'bg-sky-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    خریداری ({toPersianDigits(productsWithLossAndProfit.filter(x => isProductPurchased(x.prod)).length)})
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs text-slate-400">
              نمایش موازنه: <span className="font-bold text-white font-mono">{toPersianDigits(searchedProductsWithLossAndProfit.length)}</span> از <span className="font-bold text-slate-500 font-mono">{toPersianDigits(productsWithLossAndProfit.length)}</span> فرآورده
            </div>
          </div>

          {/* بخش سود و زیان: سرجمع تسهیم مستقیم، مشترک و سربار به تفکیک دپارتمان */}
          <div className="bg-slate-950 p-6 rounded-3xl border border-slate-850 space-y-6">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-900">
              <Layers className="h-5 w-5 text-indigo-400" />
              <h4 className="text-sm font-black text-white">گزارش موازنه تسهیم سرجمع دستمزد مستقیم، مشترک و سربار محاسباتی کارگاه</h4>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              جدول زیر سرجمع تسهیم‌شده هر یک از ارکان سه‌گانه بهای تمام شده (مواد خام مصرفی واقعی، دستمزد مستقیم زمان‌محور، دستمزد مشترک کادر کارگاه، و سربار محاسباتی کارخانه‌ای) را به صورت تجمعی بر اساس حجم کل فروش کالاها به تفکیک دپارتمان محصول شبیه‌سازی کرده و با ارقام ثبت‌شده واقعی دفاتر تطبیق می‌دهد.
            </p>

            {/* Pivot table by department */}
            <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-900/50 overflow-x-auto">
              <table className="min-w-full text-right text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-850">
                  <tr>
                    <th className="px-4 py-3 text-slate-300">نام دپارتمان / گروه کالا</th>
                    <th className="px-4 py-3 text-center text-slate-300">بهای مواد خام فروش‌رفته (ریال)</th>
                    <th className="px-4 py-3 text-center text-slate-300">دستمزد مستقیم تسهیم‌شده (ریال)</th>
                    <th className="px-4 py-3 text-center text-slate-300">دستمزد مشترک تسهیم‌شده (ریال)</th>
                    <th className="px-4 py-3 text-center text-slate-300">سربار محاسباتی تسهیم‌شده (ریال)</th>
                    <th className="px-4 py-3 text-left text-slate-200 bg-slate-950/40">جمع کل تخصیص‌یافته به دپارتمان (ریال)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 font-medium">
                  {departmentFilterOptions.filter(dept => analyticsCategoryFilter === 'all' || dept.id === analyticsCategoryFilter).map(dept => {
                    const data = departmentCostAllocationPivot[dept.id] || { directLaborAllocated: 0, sharedLaborAllocated: 0, overheadAllocated: 0, materialCostAllocated: 0, totalAllocated: 0 };
                    return (
                      <tr key={dept.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className={`px-4 py-3.5 font-extrabold ${dept.id === UNASSIGNED_DEPT_ID ? 'text-amber-300' : 'text-white'}`}>{dept.name}</td>
                        <td className="px-4 py-3.5 text-center font-mono text-emerald-450 font-bold">{formatWithCommas(Math.round(data.materialCostAllocated))}</td>
                        <td className="px-4 py-3.5 text-center font-mono text-indigo-400 font-bold">{formatWithCommas(Math.round(data.directLaborAllocated))}</td>
                        <td className="px-4 py-3.5 text-center font-mono text-sky-450 font-black">{formatWithCommas(Math.round(data.sharedLaborAllocated))}</td>
                        <td className="px-4 py-3.5 text-center font-mono text-amber-400 font-bold">{formatWithCommas(Math.round(data.overheadAllocated))}</td>
                        <td className="px-4 py-3.5 text-left font-mono font-black text-rose-450 bg-slate-950/20">{formatWithCommas(Math.round(data.totalAllocated))}</td>
                      </tr>
                    );
                  })}
                  
                  {/* Row for totals */}
                  <tr className="bg-slate-950 border-t-2 border-slate-800 font-extrabold text-slate-300">
                    <td className="px-4 py-3 text-slate-350">۱. سرجمع تسهیم‌شده سیستم (سیستمی):</td>
                    <td className="px-4 py-3 text-center font-mono text-emerald-450">{formatWithCommas(Math.round(totalAllocatedMaterialCost))}</td>
                    <td className="px-4 py-3 text-center font-mono text-indigo-400">{formatWithCommas(Math.round(totalAllocatedDirectLabor))}</td>
                    <td className="px-4 py-3 text-center font-mono text-sky-450">{formatWithCommas(Math.round(totalAllocatedSharedLabor))}</td>
                    <td className="px-4 py-3 text-center font-mono text-amber-400">{formatWithCommas(Math.round(totalAllocatedOverhead))}</td>
                    <td className="px-4 py-3 text-left font-mono text-rose-450 bg-slate-950/40">{formatWithCommas(Math.round(totalAllocatedMaterialCost + totalAllocatedDirectLabor + totalAllocatedSharedLabor + totalAllocatedOverhead))}</td>
                  </tr>

                  {/* Row for official ledger values */}
                  <tr className="bg-slate-950/80 border-t border-slate-900 text-slate-300">
                    <td className="px-4 py-3 text-indigo-300 font-black">
                      ۲. ثبتی دفاتر حسابداری (دفتر واقعی):
                      <span className="block text-[8px] font-sans font-normal text-indigo-400">بایگانی/انتقالی از سیستم حسابداری</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-indigo-350 font-black bg-indigo-950/15">
                      {formatWithCommas(Math.round(overhead?.transferredAccountingCogs || 0))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">بهای تمام شده انتقالی</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-indigo-350">
                      {formatWithCommas(Math.round(totalActualDirectLabor))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">لیست حقوق مستقیم</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-sky-305">
                      {formatWithCommas(Math.round(totalActualSharedLabor))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">کل کادر ثابت کارگاه</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-amber-350">
                      {formatWithCommas(Math.round(totalActualOverhead))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">مخارج سربار دفتری</span>
                    </td>
                    <td className="px-4 py-3 text-left font-mono text-indigo-400 bg-slate-950/30 font-black">
                      {formatWithCommas(Math.round((overhead?.transferredAccountingCogs || 0) + totalActualDirectLabor + totalActualSharedLabor + totalActualOverhead))}
                    </td>
                  </tr>

                  {/* Row for differences */}
                  <tr className="bg-slate-950 border-t border-slate-900 border-dashed text-slate-400 font-bold">
                    <td className="px-4 py-3 text-slate-400">
                      ۳. تفاضل و مغایرت نهایی ترازنامه:
                      <span className="block text-[8px] font-sans font-normal text-slate-550">(تسهیم سیستمی - واقعی دفاتر)</span>
                    </td>
                    
                    {/* Material Cost Difference */}
                    <td className={`px-4 py-3 text-center font-mono font-black ${
                      Math.abs(Math.round(totalAllocatedMaterialCost - (overhead?.transferredAccountingCogs || 0))) < 1000 
                        ? 'text-emerald-400' 
                        : 'text-amber-400'
                    }`}>
                      {formatWithCommas(Math.round(totalAllocatedMaterialCost - (overhead?.transferredAccountingCogs || 0)))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">تفاوت بهای مواد خام</span>
                    </td>

                    {/* Direct Labor Difference */}
                    <td className={`px-4 py-3 text-center font-mono font-black ${
                      Math.abs(Math.round(totalActualDirectLabor - totalAllocatedDirectLabor)) < 1000 
                        ? 'text-emerald-400' 
                        : 'text-amber-400'
                    }`}>
                      {formatWithCommas(Math.round(totalActualDirectLabor - totalAllocatedDirectLabor))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">جذب‌نشده / مغایرت</span>
                    </td>

                    {/* Shared Labor Difference */}
                    <td className={`px-4 py-3 text-center font-mono font-black ${
                      Math.abs(Math.round(totalActualSharedLabor - totalAllocatedSharedLabor)) < 1000 
                        ? 'text-emerald-400' 
                        : 'text-amber-400'
                    }`}>
                      {formatWithCommas(Math.round(totalActualSharedLabor - totalAllocatedSharedLabor))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">انحراف کادر ثابت</span>
                    </td>

                    {/* Overhead Difference */}
                    <td className={`px-4 py-3 text-center font-mono font-black ${
                      Math.abs(Math.round(totalActualOverhead - totalAllocatedOverhead)) < 1000 
                        ? 'text-emerald-400' 
                        : 'text-amber-400'
                    }`}>
                      {formatWithCommas(Math.round(totalActualOverhead - totalAllocatedOverhead))}
                      <span className="block text-[8px] font-sans font-normal text-slate-550">انحراف مخارج سربار</span>
                    </td>

                    {/* Grand Total Difference */}
                    <td className="px-4 py-3 text-left font-mono font-black text-rose-500 bg-slate-950/20">
                      {formatWithCommas(Math.round(
                        (totalAllocatedMaterialCost + totalAllocatedDirectLabor + totalAllocatedSharedLabor + totalAllocatedOverhead) -
                        ((overhead?.transferredAccountingCogs || 0) + totalActualDirectLabor + totalActualSharedLabor + totalActualOverhead)
                      ))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <>
              {/* Loss Making Warnings Section */}
              {searchedLossyProductsList.length > 0 && (
                <div className="p-4 bg-rose-950/20 border border-rose-900/30 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <AlertTriangle className="h-5 w-5 text-rose-500 animate-bounce" />
                    هشدار جدی: سیستم {toPersianDigits(searchedLossyProductsList.length)} محصول زیان‌ده فعال ردیابی کرده است!
                  </div>
                  <p className="text-xs text-rose-300 leading-relaxed">این کالاها با قیمتی تولید می‌شوند که بالاتر از قیمت مصوب فروش نهایی یا خالص دریافتی می‌باشد. لطفا هرچه سریع‌تر قیمت خرید مواد اولیه را کاهش یا قیمت فروش نهایی را افزایش دهید.</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
                    {searchedLossyProductsList.map((x, idx) => (
                      <div key={x.sale?.id || `${x.prod.id}-${idx}`} className="bg-slate-900/80 border border-rose-900/30 p-3 rounded-xl text-xs flex justify-between items-center shadow-sm">
                        <div>
                          <strong className="block text-white font-sans mb-1">{x.prod.name}</strong>
                          <span className="text-slate-400">فروش: {formatWithCommas(x.prod.salePrice)} <span className="text-slate-650 font-normal">| تمام شده: {formatWithCommas(x.unitCogs ?? x.prod.cogsPrice)}</span></span>
                        </div>
                        <div className="text-rose-400 font-bold">
                          ضرر: {formatWithCommas(Math.abs(x.profitValue))} ریال
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Profits Table */}
              <div id="sales-profit-loss-table" className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-900/40 shadow-sm overflow-x-auto">
                <table className="min-w-full text-right text-sm">
                  <thead className="bg-slate-950">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400">کد</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400">عنوان فرآورده غدایی نهایی</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-center">حجم کل فروش</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">مجموع فاکتور فروش خالص</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">مجموع بهای کل تولید (COGS)</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">سود ناخالص دوره</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-center font-bold">بازخورد سوددهی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {searchedProductsWithLossAndProfit.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500 italic">هیچ موردی منطبق بر فیلتر جستجوی شما یافت نشد یا داده‌ای در این بازه زمانی وجود ندارد.</td>
                      </tr>
                    ) : (
                      <>
                        {searchedProductsWithLossAndProfit.map((x, idx) => {
                          const hasFormula = db.productFormulas.some(f => doesFormulaMatchProduct(f.productId, x.prod) && f.periodId === activePeriodId && f.ingredients.length > 0);
                          const isPurchased = isProductPurchased(x.prod);
                          const pDeptId = resolveProductDepartmentId(x.prod.categoryId);
                          const deptName = pDeptId === UNASSIGNED_DEPT_ID
                            ? `تخصیص‌نیافته (${categoryByIdMap[x.prod.categoryId]?.name || 'نامشخص'})`
                            : (departments.find(d => d.id === pDeptId)?.name || 'نامشخص');
                          return (
                            <tr key={x.sale?.id || `${x.prod.id}-${idx}`} className="hover:bg-slate-900/60 transition-colors">
                              <td className="px-4 py-3.5 font-mono text-slate-500 text-xs">{x.prod.code}</td>
                              <td className="px-4 py-3">
                                <div className="font-bold text-white">{x.prod.name}</div>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <span className="text-[10px] text-slate-400">قیمت مصوب: {formatWithCommas(Math.round(x.prod.salePrice))}</span>
                                  <span className={`inline-flex items-center text-[9px] font-black px-1 py-0.5 rounded border ${pDeptId === UNASSIGNED_DEPT_ID ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>دپارتمان: {deptName}</span>
                                  {isPurchased ? (
                                    <span className="inline-flex items-center text-[9px] font-black bg-sky-500/15 text-sky-300 border border-sky-500/30 px-1.5 py-0.5 rounded">خریداری (بازرگانی)</span>
                                  ) : hasFormula ? (
                                    <span className="inline-flex items-center text-[9px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">تولیدی (دارای فرمول)</span>
                                  ) : (
                                    <span className="inline-flex items-center text-[9px] font-black bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">تولیدی (بدون فرمول)</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center font-mono font-bold text-slate-300">{formatWithCommas(Number(Number(x.sale.qtySold).toFixed(2)))} {x.prod.unit}</td>
                              <td className="px-4 py-3 text-left font-mono text-slate-100">{formatWithCommas(Math.round(x.sale.netSalesAmount))}</td>
                              <td className="px-4 py-3 text-left font-mono text-slate-400">{formatWithCommas(Math.round(x.totalCOGS))}</td>
                              <td className={`px-4 py-3 text-left font-mono font-bold ${x.isLossMaking ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {formatWithCommas(Math.round(x.profitValue))} ریال
                              </td>
                              <td className="px-4 py-3 text-center">
                                {x.isLossMaking ? (
                                  <span className="font-bold text-xs bg-rose-500/10 text-rose-455 p-1 px-3 rounded-full border border-rose-500/20">زیان ده ✖</span>
                                ) : (
                                  <span className="font-bold text-xs bg-emerald-500/10 text-emerald-455 p-1 px-3 rounded-full border border-emerald-500/20">سودآور ✔</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        
                        {/* Row for Grand Totals of Filtered Products */}
                        <tr className="bg-slate-950 border-t-2 border-slate-800 font-extrabold text-slate-200">
                          <td className="px-4 py-3.5 text-xs text-slate-450 font-bold">جمع کل</td>
                          <td className="px-4 py-3.5 font-sans text-right text-xs text-slate-300">
                            {toPersianDigits(searchedProductsWithLossAndProfit.length)} فرآورده فیلتر شده
                          </td>
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-300 text-xs">
                            {formatWithCommas(Number(Number(searchedTotals.qtySoldSum).toFixed(2)))}
                          </td>
                          <td className="px-4 py-3.5 text-left font-mono text-emerald-440 text-xs font-black">
                            {formatWithCommas(Math.round(searchedTotals.netSalesAmountSum))} ریال
                          </td>
                          <td className="px-4 py-3.5 text-left font-mono text-slate-300 text-xs">
                            {formatWithCommas(Math.round(searchedTotals.totalCogsSum))} ریال
                          </td>
                          <td className={`px-4 py-3.5 text-left font-mono text-xs font-black bg-slate-900/20 ${searchedTotals.profitValueSum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatWithCommas(Math.round(searchedTotals.profitValueSum))} ریال
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {searchedTotals.profitValueSum >= 0 ? (
                              <span className="font-bold text-xs bg-emerald-500/10 text-emerald-400 p-1 px-3 rounded-full border border-emerald-500/20">سود کل دوره ✔</span>
                            ) : (
                              <span className="font-bold text-xs bg-rose-500/10 text-rose-400 p-1 px-3 rounded-full border border-rose-500/20">زیان کل دوره ✖</span>
                            )}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Simple custom SVG visual graphs representing Monthly overall Share of Product categories percentage */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div className="bg-slate-950 border border-slate-850 p-5 rounded-3xl space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1"><PieChart className="h-4 w-4" /> توزیع درصد سهم فروش محصولات نسبت به کل بازار</h4>
                  <p className="text-[10px] text-slate-500">سهم درصدی وزن یا تعداد خالص فروش هر گروه به صورت کیک چارت متناسب</p>
                  
                  <div className="space-y-2 pt-2">
                    {productsWithLossAndProfit.map((x, idx) => {
                      const pct = totalSalesRevenueNet > 0 ? (x.sale.netSalesAmount / totalSalesRevenueNet) * 100 : 0;
                      return (
                        <div key={x.sale?.id || `${x.prod.id}-${idx}`} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold text-slate-350">
                            <span>{x.prod.name}</span>
                            <span>{toPersianDigits(pct.toFixed(1))}% ({formatWithCommas(x.sale.netSalesAmount)} ریال)</span>
                          </div>
                          <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-rose-600 h-full rounded-full transition-all duration-1000" 
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-850 p-5 rounded-3xl flex flex-col justify-start space-y-4 md:self-start w-full">
                  <div>
                    <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1">
                      <BarChart3 className="h-4 w-4" /> وضعیت حاشیه سود کل ناخالص دوره فعال
                    </h4>
                    <p className="text-[10px] text-slate-500 mb-4">آمار کلیدی درآمد ماه مالی ثبت شده به تفکیک</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-2 font-mono text-center">
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl col-span-2 sm:col-span-1">
                      <span className="block text-[10px] text-slate-400 font-sans">فروش خالص کل دوره</span>
                      <strong className="block text-sm font-bold text-rose-500 mt-1">{formatWithCommas(totalSalesRevenueNet)} ریال</strong>
                    </div>
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl col-span-2 sm:col-span-1">
                      <span className="block text-[10px] text-slate-400 font-sans">تعداد فرآورده‌ها در تحلیل</span>
                      <strong className="block text-sm font-bold text-slate-200 mt-1">{toPersianDigits(activeSalesRecords.length)} ردیف</strong>
                    </div>
                    
                    {/* Separated profit and loss bento items */}
                    <div className="p-3 bg-emerald-950/30 border border-emerald-900/30 rounded-2xl col-span-2 sm:col-span-1">
                      <span className="block text-[10px] text-emerald-400 font-sans">جمع کل سود (محصولات سودده)</span>
                      <strong className="block text-sm font-bold text-emerald-450 mt-1">{formatWithCommas(totalProfitSum)} ریال</strong>
                    </div>
                    
                    <div className="p-3 bg-rose-950/30 border border-rose-900/30 rounded-2xl col-span-2 sm:col-span-1">
                      <span className="block text-[10px] text-rose-400 font-sans">جمع کل زیان (محصولات زیان‌ده)</span>
                      <strong className="block text-sm font-bold text-rose-450 mt-1">{formatWithCommas(totalLossSum)} ریال</strong>
                    </div>
                  </div>

                  <div className="p-3 bg-rose-950/10 border border-rose-900/20 rounded-2xl flex items-center justify-between text-xs">
                    <span className="text-rose-300 font-bold">جمع زیان کالاهایی که زیان است (مجموع زیان خالص):</span>
                    <strong className="font-bold text-rose-400 font-mono text-xs">{formatWithCommas(totalLossSum)} ریال</strong>
                  </div>

                  <div className={`p-3.5 rounded-2xl flex items-center justify-between border ${
                    (totalProfitSum - totalLossSum) >= 0 
                      ? 'bg-emerald-950/40 text-emerald-200 border-emerald-900/30' 
                      : 'bg-rose-950/40 text-rose-200 border-rose-900/30'
                  }`}>
                    <span className="text-xs font-semibold">حاشیه سودآوری کل فرآورده‌ها (خالص):</span>
                    <strong className="text-sm font-bold font-mono">
                      {formatWithCommas(totalProfitSum - totalLossSum)} ریال
                    </strong>
                  </div>
                </div>
              </div>
            </>
        </div>
      )}


      {/* ================= TAB 4.5: PERIOD PERFORMANCE COMPARISON ================= */}
      {activeTab === 'comparison' && (
        <div id="cogs-comparison-printable" className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-white flex items-center gap-1.5">
                <Activity className="h-5 w-5 text-indigo-400" /> مقایسه عملکرد دوره قبل نسبت به ماه جاری
              </h3>
              <p className="text-xs text-slate-400 mt-1">تحلیل روند فروش مقداری و ریالی فرآورده‌های نهایی کارگاه به تفکیک دپارتمان‌های تولیدی</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={printComparisonReport} 
                className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 px-5 rounded-xl shadow-lg shadow-indigo-600/10 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Printer className="h-4.5 w-4.5" /> چاپ گزارش مقایسه‌ای پیشرفته
              </button>
            </div>
          </div>

          {/* KPI Dashboard Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between min-w-0">
              <span className="text-xs text-slate-400 font-medium">مجموع درآمد دوره قبل ({comparisonPrevLabel})</span>
              <div className="mt-2 flex flex-wrap items-baseline gap-1 min-w-0">
                <span className="text-xs sm:text-sm font-black text-white font-mono tabular-nums tracking-tight break-words">{formatWithCommas(Math.round(processedComparisonTotals.priorRevSum))}</span>
                <span className="text-[10px] text-slate-500 shrink-0">ریال</span>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between min-w-0">
              <span className="text-xs text-slate-400 font-medium">مجموع درآمد ماه جاری ({PERSIAN_MONTHS[selectedCogsMonth - 1]} {toPersianDigits(selectedCogsYear)})</span>
              <div className="mt-2 flex flex-wrap items-baseline gap-1 min-w-0">
                <span className="text-xs sm:text-sm font-black text-white font-mono tabular-nums tracking-tight break-words">{formatWithCommas(Math.round(processedComparisonTotals.currentRevSum))}</span>
                <span className="text-[10px] text-slate-500 shrink-0">ریال</span>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between min-w-0">
              <span className="text-xs text-slate-400 font-medium">تغییر ریالی درآمد کل</span>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                <div className="flex flex-wrap items-baseline gap-1 min-w-0">
                  <span className={`text-xs sm:text-sm font-black font-mono tabular-nums tracking-tight break-words ${processedComparisonTotals.revGrowthSum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {processedComparisonTotals.revGrowthSum >= 0 ? '+' : ''}{formatWithCommas(Math.round(processedComparisonTotals.revGrowthSum))}
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">ریال</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 ${processedComparisonTotals.revGrowthSum >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                  {processedComparisonTotals.revGrowthSum >= 0 ? 'رشد' : 'کاهش'}
                </span>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium">نسبت درصد ارتقای فروش ریالی</span>
              <div className="mt-2 flex items-baseline gap-1">
                <span className={`text-lg font-black font-mono ${processedComparisonTotals.revGrowthSum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {processedComparisonTotals.revGrowthSum >= 0 ? '+' : ''}
                  {processedComparisonTotals.priorRevSum > 0 
                    ? (processedComparisonTotals.revGrowthSum / processedComparisonTotals.priorRevSum * 100).toFixed(1) 
                    : '100'}%
                </span>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-medium">نسبت درصد ارتقای فروش تعدادی</span>
              <div className="mt-2 flex items-baseline gap-1">
                {(() => {
                  const totalQtyGrowth = processedComparisonTotals.currentQtySum - processedComparisonTotals.priorQtySum;
                  const qtyGrowthPctVal = processedComparisonTotals.priorQtySum > 0 
                    ? ((totalQtyGrowth / processedComparisonTotals.priorQtySum) * 100).toFixed(1) 
                    : (processedComparisonTotals.currentQtySum > 0 ? '100' : '0');
                  return (
                    <span className={`text-lg font-black font-mono ${totalQtyGrowth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {totalQtyGrowth >= 0 ? '+' : ''}{qtyGrowthPctVal}%
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Filtering, Grouping and Sorting Control Center */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-full sm:w-56 relative">
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    placeholder="جستجو در نام فرآورده یا کد..."
                    value={comparisonSearch}
                    onChange={(e) => setComparisonSearch(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 text-slate-200 pl-4 pr-9 py-2 rounded-xl text-xs placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <select
                  value={comparisonCategoryFilter}
                  onChange={(e) => setComparisonCategoryFilter(e.target.value)}
                  className="w-full sm:w-64 bg-slate-900 border border-slate-750 text-slate-100 font-bold px-4 py-2 rounded-xl text-xs sm:text-sm focus:outline-none focus:border-indigo-500 cursor-pointer shadow-sm transition-all"
                >
                  <option value="all">همه دپارتمان‌ها (کل فرآورده‌ها)</option>
                  {departmentFilterOptions.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>

                <select
                  value={comparisonSortMode}
                  onChange={(e) => setComparisonSortMode(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 text-indigo-400 font-bold px-3 py-1.5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="default">مرتب‌سازی: پیش‌فرض</option>
                  <option value="growth_desc">رشد فیزیکی: بیشترین به کمترین (نزولی)</option>
                  <option value="growth_asc">رشد فیزیکی: کمترین به بیشترین (صعودی)</option>
                  <option value="rev_growth_desc">ارتقای درآمد: بیشترین به کمترین (نزولی)</option>
                  <option value="rev_growth_asc">ارتقای درآمد: کمترین به بیشترین (صعودی)</option>
                </select>
              </div>

              <div className="flex items-center gap-3 border-t border-slate-900 md:border-0 pt-3 md:pt-0">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={comparisonGroupByDepartment}
                    onChange={(e) => setComparisonGroupByDepartment(e.target.checked)}
                    className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-350">دسته‌بندی به تفکیک دپارتمان‌های تولیدی</span>
                </label>
              </div>
            </div>

            {/* Quick Filter Badges for Positive / Negative Growth */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900 text-xs font-bold">
              <span className="text-slate-500 text-[11px] font-medium ml-1">فیلترهای سریع رشد:</span>
              <button
                type="button"
                onClick={() => setComparisonGrowthFilter('all')}
                className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                  comparisonGrowthFilter === 'all'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                همه کالاها ({growthComparisonList.length})
              </button>
              <button
                type="button"
                onClick={() => setComparisonGrowthFilter('positive_qty')}
                className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  comparisonGrowthFilter === 'positive_qty'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20 font-black'
                    : 'bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40 border border-emerald-800/40'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                کالاهای با رشد مثبت (+تعداد)
              </button>
              <button
                type="button"
                onClick={() => setComparisonGrowthFilter('negative_qty')}
                className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  comparisonGrowthFilter === 'negative_qty'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20 font-black'
                    : 'bg-rose-950/30 text-rose-400 hover:bg-rose-900/40 border border-rose-800/40'
                }`}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                کالاهای با رشد منفی (-تعداد)
              </button>
              <button
                type="button"
                onClick={() => setComparisonGrowthFilter('positive_rev')}
                className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  comparisonGrowthFilter === 'positive_rev'
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20 font-black'
                    : 'bg-teal-950/30 text-teal-300 hover:bg-teal-900/40 border border-teal-800/40'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                ارتقای درآمد (+درآمد)
              </button>
              <button
                type="button"
                onClick={() => setComparisonGrowthFilter('negative_rev')}
                className={`px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                  comparisonGrowthFilter === 'negative_rev'
                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20 font-black'
                    : 'bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 border border-amber-800/40'
                }`}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                افت درآمد (-درآمد)
              </button>
            </div>
          </div>

          {/* Main Comparison Table */}
          <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-900/40 shadow-sm overflow-x-auto">
            <table className="min-w-full text-right text-sm">
              <thead className="bg-slate-950 border-b border-slate-850">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-400">فرآورده نهایی</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-center">مقدار فروش قبلی ({comparisonPrevLabel})</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-center">مقدار فروش جدید ({PERSIAN_MONTHS[selectedCogsMonth - 1]} {toPersianDigits(selectedCogsYear)})</th>
                  
                  {/* Quantity Growth Sortable Column Header */}
                  <th 
                    onClick={() => setComparisonSortMode(prev => prev === 'growth_desc' ? 'growth_asc' : 'growth_desc')}
                    className="px-4 py-3 text-xs font-semibold text-slate-300 hover:text-white text-center cursor-pointer select-none transition-colors group"
                    title="کلیک جهت مرتب‌سازی بر اساس رشد فیزیکی"
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>رشد فیزیکی فروش</span>
                      {comparisonSortMode === 'growth_desc' && <ArrowDown className="h-3.5 w-3.5 text-indigo-400 font-bold" />}
                      {comparisonSortMode === 'growth_asc' && <ArrowUp className="h-3.5 w-3.5 text-indigo-400 font-bold" />}
                      {comparisonSortMode !== 'growth_desc' && comparisonSortMode !== 'growth_asc' && (
                        <ArrowUpDown className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                      )}
                    </div>
                  </th>

                  <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">فروش مالی قبلی (ریال)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-400 text-left">فروش مالی جدید (ریال)</th>

                  {/* Revenue Growth Sortable Column Header */}
                  <th 
                    onClick={() => setComparisonSortMode(prev => prev === 'rev_growth_desc' ? 'rev_growth_asc' : 'rev_growth_desc')}
                    className="px-4 py-3 text-xs font-semibold text-indigo-400 hover:text-indigo-300 text-left bg-indigo-950/20 font-bold cursor-pointer select-none transition-colors group"
                    title="کلیک جهت مرتب‌سازی بر اساس ارتقای درآمد"
                  >
                    <div className="flex items-center justify-start gap-1.5">
                      <span>ارتقای درآمد (ریال)</span>
                      {comparisonSortMode === 'rev_growth_desc' && <ArrowDown className="h-3.5 w-3.5 text-indigo-400 font-bold" />}
                      {comparisonSortMode === 'rev_growth_asc' && <ArrowUp className="h-3.5 w-3.5 text-indigo-400 font-bold" />}
                      {comparisonSortMode !== 'rev_growth_desc' && comparisonSortMode !== 'rev_growth_asc' && (
                        <ArrowUpDown className="h-3.5 w-3.5 text-indigo-500/60 group-hover:text-indigo-400 transition-colors" />
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 text-xs">
                {comparisonGroupByDepartment ? (
                  departmentFilterOptions.map(cat => {
                    const catItems = processedComparisonList.filter(g => resolveProductDepartmentId(g.prod.categoryId) === cat.id);
                    if (catItems.length === 0) return null;

                    let catPriorQty = 0;
                    let catCurrentQty = 0;
                    let catPriorRev = 0;
                    let catCurrentRev = 0;
                    let catRevGrowth = 0;

                    return (
                      <React.Fragment key={cat.id}>
                        {/* Category Row */}
                        <tr className="bg-slate-900/80 font-bold border-b border-slate-850">
                          <td colSpan={7} className="px-4 py-2.5 text-indigo-300 font-extrabold">
                            دپارتمان: {cat.name}
                          </td>
                        </tr>

                        {/* Category Items */}
                        {catItems.map((g, idx) => {
                          catPriorQty += g.priorQty;
                          catCurrentQty += g.currentQty;
                          catPriorRev += g.priorRev;
                          catCurrentRev += g.currentRev;
                          catRevGrowth += g.revGrowth;

                          return (
                            <tr key={`${cat.id}-${g.prod.id}-${idx}`} className="hover:bg-slate-900/40 transition-colors">
                              <td className="px-4 py-3 font-semibold text-slate-200 pl-8">{g.prod.name} ({g.prod.code || '-'})</td>
                              <td className="px-4 py-3 text-center font-mono text-slate-400">{formatWithCommas(g.priorQty)} <span className="text-[10px] text-slate-600">{g.prod.unit}</span></td>
                              <td className="px-4 py-3 text-center font-mono text-slate-200">{formatWithCommas(g.currentQty)} <span className="text-[10px] text-slate-600">{g.prod.unit}</span></td>
                              <td className="px-4 py-3 text-center">
                                {g.qtyGrowth >= 0 ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-500/20">
                                    +{formatWithCommas(g.qtyGrowth)} ({formatWithCommas(g.qtyGrowthPct)}%)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold border border-rose-500/20">
                                    {formatWithCommas(g.qtyGrowth)} ({formatWithCommas(g.qtyGrowthPct)}%)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-left font-mono text-slate-450">{formatWithCommas(Math.round(g.priorRev))}</td>
                              <td className="px-4 py-3 text-left font-mono text-slate-250">{formatWithCommas(Math.round(g.currentRev))}</td>
                              <td className="px-4 py-3 text-left font-mono font-bold bg-indigo-950/5">
                                {g.revGrowth >= 0 ? (
                                  <span className="text-emerald-400">+{formatWithCommas(Math.round(g.revGrowth))}</span>
                                ) : (
                                  <span className="text-rose-400">{formatWithCommas(Math.round(g.revGrowth))}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Category Subtotal Row */}
                        <tr className="bg-slate-950/40 font-bold border-b border-slate-800">
                          <td className="px-4 py-2.5 text-slate-350 italic pl-6">سرجمع {cat.name}</td>
                          <td className="px-4 py-2.5 text-center font-mono text-slate-400">{formatWithCommas(Number(catPriorQty.toFixed(2)))}</td>
                          <td className="px-4 py-2.5 text-center font-mono text-slate-300">{formatWithCommas(Number(catCurrentQty.toFixed(2)))}</td>
                          <td className="px-4 py-2.5 text-center">
                            {catCurrentQty - catPriorQty >= 0 ? (
                              <span className="text-emerald-400 text-[10px]">
                                +{formatWithCommas(Number((catCurrentQty - catPriorQty).toFixed(2)))} ({formatWithCommas(catPriorQty > 0 ? Math.round(((catCurrentQty - catPriorQty) / catPriorQty) * 10000) / 100 : 100)}%)
                              </span>
                            ) : (
                              <span className="text-rose-400 text-[10px]">
                                {formatWithCommas(Number((catCurrentQty - catPriorQty).toFixed(2)))} ({formatWithCommas(catPriorQty > 0 ? Math.round(((catCurrentQty - catPriorQty) / catPriorQty) * 10000) / 100 : 100)}%)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-left font-mono text-slate-400">{formatWithCommas(Math.round(catPriorRev))}</td>
                          <td className="px-4 py-2.5 text-left font-mono text-slate-300">{formatWithCommas(Math.round(catCurrentRev))}</td>
                          <td className="px-4 py-2.5 text-left font-mono bg-indigo-950/10">
                            {catRevGrowth >= 0 ? (
                              <span className="text-emerald-400">+{formatWithCommas(Math.round(catRevGrowth))}</span>
                            ) : (
                              <span className="text-rose-400">{formatWithCommas(Math.round(catRevGrowth))}</span>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                ) : (
                  processedComparisonList.map((g, idx) => (
                    <tr key={`${g.prod.id}-${idx}`} className="hover:bg-slate-900/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-200">{g.prod.name} ({g.prod.code || '-'})</td>
                      <td className="px-4 py-3 text-center font-mono text-slate-400">{formatWithCommas(g.priorQty)} <span className="text-[10px] text-slate-600">{g.prod.unit}</span></td>
                      <td className="px-4 py-3 text-center font-mono text-slate-200">{formatWithCommas(g.currentQty)} <span className="text-[10px] text-slate-600">{g.prod.unit}</span></td>
                      <td className="px-4 py-3 text-center">
                        {g.qtyGrowth >= 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold border border-emerald-500/20">
                            +{formatWithCommas(g.qtyGrowth)} ({formatWithCommas(g.qtyGrowthPct)}%)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full text-[10px] font-bold border border-rose-500/20">
                            {formatWithCommas(g.qtyGrowth)} ({formatWithCommas(g.qtyGrowthPct)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-left font-mono text-slate-450">{formatWithCommas(Math.round(g.priorRev))}</td>
                      <td className="px-4 py-3 text-left font-mono text-slate-250">{formatWithCommas(Math.round(g.currentRev))}</td>
                      <td className="px-4 py-3 text-left font-mono font-bold bg-indigo-950/5">
                        {g.revGrowth >= 0 ? (
                          <span className="text-emerald-400">+{formatWithCommas(Math.round(g.revGrowth))}</span>
                        ) : (
                          <span className="text-rose-400">{formatWithCommas(Math.round(g.revGrowth))}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}

                {/* Grand Total Row */}
                <tr className="bg-slate-950 border-t-2 border-slate-850 font-extrabold text-slate-200">
                  <td className="px-4 py-3 text-xs font-bold text-slate-400">جمع کل نهایی فرآورده‌ها</td>
                  <td className="px-4 py-3 text-center font-mono text-slate-400">{formatWithCommas(Number(processedComparisonTotals.priorQtySum.toFixed(2)))}</td>
                  <td className="px-4 py-3 text-center font-mono text-slate-200">{formatWithCommas(Number(processedComparisonTotals.currentQtySum.toFixed(2)))}</td>
                  <td className="px-4 py-3 text-center font-mono">-</td>
                  <td className="px-4 py-3 text-left font-mono text-slate-350">{formatWithCommas(Math.round(processedComparisonTotals.priorRevSum))}</td>
                  <td className="px-4 py-3 text-left font-mono text-slate-100">{formatWithCommas(Math.round(processedComparisonTotals.currentRevSum))}</td>
                  <td className="px-4 py-3 text-left font-mono font-black bg-indigo-950/15">
                    {processedComparisonTotals.revGrowthSum >= 0 ? (
                      <span className="text-emerald-400">+{formatWithCommas(Math.round(processedComparisonTotals.revGrowthSum))} ریال</span>
                    ) : (
                      <span className="text-rose-400">{formatWithCommas(Math.round(processedComparisonTotals.revGrowthSum))} ریال</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* ================= TAB 5: SUGGESTED SELLING PRICING & PROFITABILITY MANAGER ================= */}
      {activeTab === 'pricing' && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-indigo-400" />
                  شبیه‌ساز و قیمت‌گذاری فروش نهایی کالاها بر اساس حاشیه سود هدف دپارتمان‌ها
                </h3>
                <p className="text-xs text-slate-400 mt-1">تعدیل هدفمند قیمت فروش محصولات با موازنه بهای تمام شده (COGS) و حاشیه سود هدف هر دپارتمان تولیدی</p>
              </div>

              <div className="flex items-center gap-2.5">
                <label htmlFor="price-change-date-picker" className="text-xs text-slate-400 font-bold select-none">تاریخ اعمال تغییرات:</label>
                <input
                  id="price-change-date-picker"
                  type="text"
                  className="p-2 py-1.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-center w-36"
                  value={dateOfChange}
                  onChange={(e) => setDateOfChange(e.target.value)}
                  placeholder="مثال: ۱۴۰۵/۰۳/۰۱"
                />
              </div>
            </div>

            {/* Instruction block */}
            <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/15 rounded-2xl flex items-start gap-3">
              <Info className="h-4.5 w-4.5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-indigo-200 leading-relaxed md:leading-loose">
                <strong>فرمول حاشیه سود حاصل از فروش (Profit Margin):</strong> در این متدولوژی، درصد سود اعلامی شما برآورده پس از کسر بهای محاسباتی تمام شده از مبلغ نهایی فروش است. فرمول ریاضی حاکم: 
                <code className="mx-2 bg-slate-900 px-1.5 py-0.5 rounded font-mono text-indigo-300">قیمت فروش پیشنهادی = قیمت تمام شده / (۱ - درصد سود)</code>. این بدین معنی است که سود حاصل از هر فروش دقیقاً سهم درصد دلخواه شما از کل نقدینگی فروش نهایی خواهد بود.
              </div>
            </div>
          </div>

          {/* Grid of Department targets and Profitability simulation inside previous period sales volume */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* 1. Department margins targets manager (4 cols) */}
            <div className="lg:col-span-5 bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
              <div className="border-b border-slate-900 pb-3">
                <h4 className="text-xs font-black text-white flex items-center gap-1.5">
                  <Building className="h-4 w-4 text-emerald-400" />
                  تعیین درصد سود هدف دپارتمان‌ها (گروه فرآورده‌ها)
                </h4>
                <p className="text-[10px] text-slate-500 mt-1">نرخ سود ترجیحی حاصل از فروش کالاها به تفکیک رده کارگاهی</p>
              </div>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {departments.length === 0 ? (
                  <div className="text-xs text-slate-500 italic py-4 text-center">هیچ دپارتمان یا دسته‌بندی فعالی ثبت نشده است.</div>
                ) : (
                  departments.map(dept => {
                    const currentMargin = deptMargins[dept.id] ?? 20;
                    return (
                      <div key={dept.id} className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-850 rounded-2xl hover:border-slate-800 transition-all">
                        <span className="text-xs font-bold text-slate-300">{dept.name}</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="99"
                            className="w-14 p-1.5 text-center border border-slate-800 rounded-lg text-xs bg-slate-950 text-emerald-400 font-mono font-bold outline-none focus:ring-1 focus:ring-rose-500"
                            value={currentMargin}
                            onChange={(e) => handleDeptMarginChange(dept.id, Math.min(99, Math.max(0, parseInt(e.target.value) || 0)))}
                          />
                          <span className="text-xs text-slate-500 font-bold">% حاشیه سود</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Profitability simulation on prior period sales volumes (7 cols) */}
            <div className="lg:col-span-7 bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
              <div className="border-b border-slate-900 pb-3 flex justify-between items-center">
                <div>
                  <h4 className="text-xs font-black text-white flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-rose-400" />
                    شبیه‌ساز تداوم سودآوری کل بر اساس حجم فروش دوره گذشته
                  </h4>
                  <p className="text-[10px] text-slate-500 mt-1">تطبیق فاکتورهای فروش دوره قبل با ساختار مبالغ فروش جدید پیشنهادی جاری</p>
                </div>
                {prevPeriodSimulation.hasData && (
                  <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-300 px-2 py-1 rounded-md font-bold font-sans animate-pulse">
                    مبنا: دوره {prevPeriodSimulation.prevPeriodName}
                  </span>
                )}
              </div>

              {!prevPeriodSimulation.hasData ? (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
                  <AlertCircle className="h-8 w-8 text-slate-500/80" />
                  <p className="text-xs text-slate-500">هیچ سابقه فاکتور یا دوره موازی قبلی برای شبیه‌سازی آماری حجم فروش یافت نشد.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-slate-900 p-3 rounded-2xl border border-slate-850 text-center font-mono space-y-1">
                      <span className="text-[10px] text-slate-500 font-sans block">سودآوری واقعی دوره گذشته</span>
                      <strong className="text-xs text-slate-300 font-extrabold block">{formatWithCommas(Math.round(prevPeriodSimulation.oldProfit * 100) / 100)} ریال</strong>
                      <span className="text-[9px] text-slate-500 font-sans block">فروش: {formatWithCommas(Math.round(prevPeriodSimulation.oldSalesRevenue * 100) / 100)} ریال</span>
                    </div>

                    <div className="bg-slate-900 p-3 rounded-2xl border border-indigo-950/60 ring-1 ring-indigo-500/10 text-center font-mono space-y-1">
                      <span className="text-[10px] text-indigo-300 font-sans block">سود شبیه‌سازی شده جدید</span>
                      <strong className="text-xs text-indigo-400 font-black block">{formatWithCommas(Math.round(prevPeriodSimulation.newProfit * 100) / 100)} ریال</strong>
                      <span className="text-[9px] text-slate-550 font-sans block">درآمد فرضی: {formatWithCommas(Math.round(prevPeriodSimulation.newSalesRevenue * 100) / 100)} ریال</span>
                    </div>

                    <div className={`p-3 rounded-2xl border text-center font-mono flex flex-col justify-center space-y-1 ${
                      prevPeriodSimulation.profitDifference >= 0 
                        ? 'bg-emerald-950/15 border-emerald-900/30 text-emerald-400 ring-1 ring-emerald-500/15' 
                        : 'bg-rose-950/15 border-rose-900/30 text-rose-400 ring-1 ring-rose-500/15'
                    }`}>
                      <span className="text-[10px] text-slate-400 font-sans block">پیش‌بینی رشد سود ناخالص</span>
                      <strong className="text-xs font-black flex items-center justify-center gap-1">
                        {prevPeriodSimulation.profitDifference >= 0 ? '+' : ''}{formatWithCommas(Math.round(prevPeriodSimulation.profitDifference * 100) / 100)}
                      </strong>
                      <span className="text-[8px] font-sans block text-slate-500">مجموعه کل کارگاهی و ساخت</span>
                    </div>
                  </div>

                  {/* Profitability progress bar comparison */}
                  <div className="p-3.5 bg-slate-900/50 rounded-2xl border border-slate-850 space-y-2">
                    <div className="flex justify-between text-[11px] font-black text-slate-300">
                      <span>مقایسه نرخ حاشیه سود کل مجموعه:</span>
                      <div className="flex gap-4">
                        <span className="text-slate-400">نرخ واقعی قبل: <strong className="text-slate-300 font-mono">{(prevPeriodSimulation.oldSalesRevenue > 0 ? (prevPeriodSimulation.oldProfit / prevPeriodSimulation.oldSalesRevenue * 100) : 0).toFixed(2)}%</strong></span>
                        <span className="text-indigo-400">نرخ فرضی نوین: <strong className="font-mono">{(prevPeriodSimulation.newSalesRevenue > 0 ? (prevPeriodSimulation.newProfit / prevPeriodSimulation.newSalesRevenue * 100) : 0).toFixed(2)}%</strong></span>
                      </div>
                    </div>
                    
                    <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden flex gap-0.5 p-0.5 border border-slate-850">
                      {/* Past */}
                      <div 
                        title="سابقه سود درصد کل"
                        className="bg-slate-705 h-full rounded-l-full transition-all" 
                        style={{ width: `${Math.max(2, Math.min(100, prevPeriodSimulation.oldSalesRevenue > 0 ? (prevPeriodSimulation.oldProfit / prevPeriodSimulation.oldSalesRevenue * 100) : 0))}%` }} 
                      />
                      {/* Improvement or drop */}
                      <div 
                        title="اختلاف سود و فرآوری"
                        className={`h-full rounded-r-full transition-all ${prevPeriodSimulation.profitDifference >= 0 ? 'bg-indigo-500' : 'bg-rose-650'}`} 
                        style={{ width: `${Math.max(2, Math.min(100, Math.abs(prevPeriodSimulation.newProfit - prevPeriodSimulation.oldProfit) / (prevPeriodSimulation.oldSalesRevenue || 1) * 105))}%` }} 
                      />
                    </div>
                    <span className="text-[9px] text-slate-550 block leading-relaxed font-sans">شبیه‌سازی بر اساس کاتالوگ فروش فرآورده در ماه گذشته به میزان {toPersianDigits(prevPeriodSimulation.items.length)} ردیف کالای فروش‌رفته فعال تطبیق داده شده است.</span>
                  </div>

                  {/* Detailed Simulated Products Table */}
                  <div className="pt-4 border-t border-slate-900 space-y-3">
                    <h5 className="text-[11px] font-black text-slate-300">جزئیات شبیه‌سازی سودآوری بر تک‌تک محصولات (شامل سرجمع و مقایسه با سود/زیان قبلی)</h5>
                    <div className="border border-slate-850 rounded-2xl bg-slate-900/50 max-h-[300px] overflow-auto">
                      <table className="min-w-full text-right text-[10.5px]">
                        <thead className="bg-slate-950 text-slate-400 border-b border-slate-850 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-slate-300">نام فرآورده</th>
                            <th className="px-3 py-2 text-center text-slate-300">تعداد فروش</th>
                            <th className="px-3 py-2 text-center text-slate-300">قیمت مصوب جدید</th>
                            <th className="px-3 py-2 text-center text-slate-300">درآمد جدید</th>
                            <th className="px-3 py-2 text-center text-slate-300">سود/زیان قبل</th>
                            <th className="px-3 py-2 text-center text-slate-300">سود ناخالص جدید</th>
                            <th className="px-3 py-2 text-left text-slate-300">اختلاف سودآوری</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 font-medium">
                          {prevPeriodSimulation.items.map((item: any, idx: number) => {
                            const qtyRounded = Math.round(item.qtySold * 100) / 100;
                            const newSalePriceRounded = Math.round(item.newSalePrice * 100) / 100;
                            const newRevenueRounded = Math.round(item.newRevenue * 100) / 100;
                            const oldProfitRounded = Math.round(item.oldProfit * 100) / 100;
                            const newProfitRounded = Math.round(item.newProfit * 100) / 100;
                            const diffRounded = Math.round((item.newProfit - item.oldProfit) * 100) / 100;
                            return (
                              <tr key={`${item.code || item.name}-${idx}`} className="hover:bg-slate-900/40 transition-colors">
                                <td className="px-3 py-2 text-white font-bold">{item.name}</td>
                                <td className="px-3 py-2 text-center font-mono text-slate-300">{formatWithCommas(qtyRounded)}</td>
                                <td className="px-3 py-2 text-center font-mono text-zinc-300">{formatWithCommas(newSalePriceRounded)} ریال</td>
                                <td className="px-3 py-2 text-center font-mono text-slate-400">{formatWithCommas(newRevenueRounded)} ریال</td>
                                <td className={`px-3 py-2 text-center font-mono ${oldProfitRounded >= 0 ? 'text-emerald-450' : 'text-rose-455'}`}>
                                  {formatWithCommas(oldProfitRounded)} ریال
                                </td>
                                <td className={`px-3 py-2 text-center font-mono ${newProfitRounded >= 0 ? 'text-indigo-400' : 'text-rose-455'}`}>
                                  {formatWithCommas(newProfitRounded)} ریال
                                </td>
                                <td className={`px-3 py-2 text-left font-mono font-black ${diffRounded >= 0 ? 'text-emerald-450' : 'text-rose-455'}`}>
                                  {diffRounded >= 0 ? '+' : ''}{formatWithCommas(diffRounded)} ریال
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-950/90 font-black border-t border-slate-800 sticky bottom-0 z-10 text-slate-200 text-xs">
                          <tr>
                            <td className="px-3 py-2.5 font-extrabold text-slate-300">سرجمع شبیه‌سازی:</td>
                            <td className="px-3 py-2.5 text-center font-mono text-slate-300">{formatWithCommas(Math.round(prevPeriodSimulation.totalQtySold * 100) / 100)}</td>
                            <td className="px-3 py-2.5 text-center text-slate-550 font-sans">-</td>
                            <td className="px-3 py-2.5 text-center font-mono text-indigo-300">{formatWithCommas(Math.round(prevPeriodSimulation.newSalesRevenue * 100) / 100)} ریال</td>
                            <td className={`px-3 py-2.5 text-center font-mono ${prevPeriodSimulation.oldProfit >= 0 ? 'text-emerald-450' : 'text-rose-455'}`}>
                              {formatWithCommas(Math.round(prevPeriodSimulation.oldProfit * 100) / 100)} ریال
                            </td>
                            <td className={`px-3 py-2.5 text-center font-mono ${prevPeriodSimulation.newProfit >= 0 ? 'text-indigo-400' : 'text-rose-455'}`}>
                              {formatWithCommas(Math.round(prevPeriodSimulation.newProfit * 100) / 100)} ریال
                            </td>
                            <td className={`px-3 py-2.5 text-left font-mono font-black ${prevPeriodSimulation.profitDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {prevPeriodSimulation.profitDifference >= 0 ? '+' : ''}{formatWithCommas(Math.round(prevPeriodSimulation.profitDifference * 100) / 100)} ریال
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Pricing table Grid list */}
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-slate-900 pb-3">
              <div>
                <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                  <Calculator className="h-4.5 w-4.5 text-rose-500" />
                  لیست کنترل نهایی مبالغ فروش جفت شده و قیمت تمام شده کالاها
                </h3>
                <p className="text-[10px] text-slate-500 mt-1">امکان بازبینی پیشنهادات، ویرایش مستقیم دستی قیمت‌ها و تایید دسته‌جمعی مبالغ به تفکیک کالا</p>
              </div>
              <button
                type="button"
                onClick={handleSavePricesToDb}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/20 transition-all active:scale-95 whitespace-nowrap"
              >
                <CheckSquare className="h-4 w-4" />
                درج تمامی مبالغ تایید شده به کاتالوگ محصولات
              </button>
            </div>

            {/* Search and Filters Area */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/60 p-3.5 rounded-2xl border border-slate-850">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="جستجوی نام یا کد فرآورده غدایی..."
                  className="w-full pl-3 pr-9 py-1.5 border border-slate-800 rounded-xl text-xs bg-slate-950 text-white placeholder-slate-500 outline-none focus:ring-1 focus:ring-rose-500"
                  value={pricingSearch}
                  onChange={(e) => setPricingSearch(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-slate-400 font-bold ml-1">فیلتر نمایش:</span>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setPricingFilterMode('all')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      pricingFilterMode === 'all' 
                        ? 'bg-rose-600 text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    کل فرآورده‌ها ({toPersianDigits(pricingData.length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingFilterMode('approved')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      pricingFilterMode === 'approved' 
                        ? 'bg-rose-600 text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    فقط قیمت‌های تایید شده ({toPersianDigits(pricingData.filter(item => {
                      const approvedVal = approvedPrices[item.product.id] || item.product.approvedPrice || 0;
                      return approvedVal > 0;
                    }).length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingFilterMode('hasCost')}
                    className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      pricingFilterMode === 'hasCost' 
                        ? 'bg-rose-600 text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    فقط دارای بهای تمام شده ({toPersianDigits(pricingData.filter(item => 
                      item.costPrice > 0 && 
                      formulas.some(f => doesFormulaMatchProduct(f.productId, item.product) && f.ingredients.length > 0)
                    ).length)})
                  </button>
                </div>
              </div>
            </div>

            {/* Table data */}
            <div className="border border-slate-850 rounded-2xl overflow-hidden bg-slate-950 overflow-x-auto">
              <table className="min-w-full text-right text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-850 text-[10px] font-bold">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-300">کدهنری</th>
                    <th className="px-4 py-3 font-semibold text-slate-300 border-l border-slate-900">نام فرآورده نهایی موازنه شده</th>
                    <th className="px-4 py-2 font-semibold text-slate-300 text-center">دپارتمان مربوطه</th>
                    <th className="px-4 py-2 font-semibold text-slate-300 text-left">بهای تمام شده (ریال)</th>
                    <th className="px-4 py-3 font-semibold text-slate-300 text-center">% سود دپارتمان</th>
                    <th className="px-4 py-2 font-semibold text-indigo-400 text-left bg-indigo-950/10 font-bold">فی پیشنهادی فروش (ریال)</th>
                    <th className="px-4 py-2 font-semibold text-slate-300 text-center">قیمت قبلی فروش (ریال)</th>
                    <th className="px-4 py-2 font-semibold text-indigo-200 text-right bg-slate-900 font-bold">قیمت فروش تایید شده (ریال)</th>
                    <th className="px-4 py-2 font-semibold text-slate-300 text-center">تایید و بازخورد سوددهی کالا</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {filteredPricingData.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500 italic">هیچ موردی منطبق بر فیلتر جستجو یا معیارهای گزینش شما یافت نشد.</td>
                    </tr>
                  ) : (
                    filteredPricingData.map((item) => {
                      const currentApprovedPrice = approvedPrices[item.product.id] ?? item.product.salePrice ?? 0;
                      const achievementMargin = currentApprovedPrice > 0 
                        ? ((currentApprovedPrice - item.costPrice) / currentApprovedPrice * 100) 
                        : 0;

                      // Check correctness vs target margin
                      const isMarginMet = achievementMargin >= item.margin - 0.5;

                      return (
                        <tr key={item.product.id} className="hover:bg-slate-900/40 transition-colors font-medium">
                          <td className="px-4 py-3.5 font-mono text-slate-500 font-bold text-[10px]">{item.product.code}</td>
                          <td className="px-4 py-3 border-l border-slate-900">
                            <span className="font-extrabold text-slate-100 block">{item.product.name}</span>
                            <span className="text-[9px] text-slate-550 block">کد معین: {item.product.accountId || 'فاقد کد حسابداری'}</span>
                          </td>
                          <td className="px-4 py-2 text-center text-slate-400 font-bold">{item.categoryName}</td>
                          <td className="px-4 py-2 text-left font-mono font-bold text-slate-300">{formatWithCommas(item.costPrice)}</td>
                          <td className="px-4 py-3 text-center font-mono text-emerald-400 font-extrabold">{toPersianDigits(item.margin)}%</td>
                          <td className="px-4 py-2 text-left font-mono font-black text-indigo-400 bg-indigo-950/10">
                            {formatWithCommas(item.suggestedPrice)}
                          </td>
                          <td className="px-4 py-2 text-center font-mono text-slate-450">{formatWithCommas(item.originalPrice)}</td>
                          
                          {/* Live Input editable field */}
                          <td className="px-4 py-2 text-right bg-slate-900/30">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="text"
                                onFocus={handleFocus}
                                className="w-28 p-1.5 border border-slate-800 rounded-lg text-xs bg-slate-950 text-white font-mono font-extrabold text-center outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500"
                                value={formatWithCommas(approvedPrices[item.product.id] ?? 0)}
                                onChange={(e) => {
                                  const parsed = parseNumber(e.target.value);
                                  setApprovedPrices(prev => ({ ...prev, [item.product.id]: parsed }));
                                }}
                                onBlur={() => {
                                  const parsed = approvedPrices[item.product.id] ?? 0;
                                  const updatedProducts = db.products.map(p => {
                                    if (p.id === item.product.id) {
                                      return { ...p, approvedPrice: parsed };
                                    }
                                    return p;
                                  });
                                  onUpdateDb({
                                    ...db,
                                    products: updatedProducts
                                  });
                                }}
                              />
                              <span className="text-[9px] text-slate-550 font-sans">{item.product.unit}</span>
                            </div>
                          </td>

                          {/* Status and Margin indicators only */}
                          <td className="px-4 py-2 text-center">
                            <div className="flex items-center justify-center gap-1.5 font-sans">
                              {currentApprovedPrice > 0 ? (
                                <span className={`px-2 py-1 rounded text-[10px] font-sans font-extrabold ${
                                  isMarginMet 
                                    ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-900/30' 
                                    : 'bg-rose-900/20 text-rose-400 border border-rose-900/30'
                                }`} title={`حاشیه سود فرضی فعال: ${achievementMargin.toFixed(0)}%`}>
                                  {achievementMargin.toFixed(0)}% سود مصوب
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-500 italic block">منتظر قیمت تایید شده</span>
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

            {/* Prompt for printing report preview */}
            <div className="p-3 bg-slate-900 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 mt-4 text-[10px] text-slate-400 border border-slate-800">
              <span>تغییرات قیمت فروش به صورت مستقیم با تغییر فیلد قیمت مصوب جدید اعمال شده و فورا ذخیره و محاسبه می شود. نیاز به استفاده از دکمه مجزا نیست.</span>
            </div>
          </div>

        </div>
      )}


      {/* ================= TAB 6: WIP (SEMI-FINISHED) PRODUCTS MANAGER ================= */}
      {activeTab === 'wip' && (
        <div id="cogs-wip-printable" className="space-y-6 animate-fadeIn">
          {/* Header Card */}
          <div className="bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-900 pb-4">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Layers className="h-5 w-5 text-indigo-400" />
                  مدیریت کالاهای در جریان ساخت (WIP - نیمه‌ساخته واسط)
                </h3>
                <p className="text-xs text-slate-400 mt-1">تعریف دسته‌بندی، کدینگ مالکیتی، مشخصات عمومی و محاسب بهای نیمه‌سازه واسط جهت استفاده درخت‌واره در فرمول‌های تابعه</p>
              </div>
            </div>

            <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/15 rounded-2xl flex items-start gap-3">
              <Info className="h-4.5 w-4.5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-indigo-200 leading-relaxed md:leading-loose">
                <strong>مکانیسم زنجیره ارزش فرآورده (WIP Integration):</strong> کالاهای در جریان ساخت به فرآورده‌های واسط کارگاهی (مانند سس مادر، مرغ خام طعم‌دار، مایع فلافل، ترشی دست‌ساز و غیره) گفته می‌شود. شما می‌توانید این کالاها را در این قسمت ثبت کنید. بهای تمام‌شده آنها از روی فرمولاسیون خودشان به صورت چندمرحله‌ای (Nested Levels BOM) ارزیابی شده و به عنوان متریال پایه در دستور پخت‌های بالادستی (فرآورده‌های نهایی) تسهیم ارزشی می‌گردد.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" id="wip-form-anchor">
            {/* Left Column: Register/Edit Form */}
            <div className="lg:col-span-4 bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
              <h4 className="text-xs font-black text-slate-200 border-r-2 border-indigo-500 pr-2 flex items-center gap-1">
                <span>{wipEditingId ? 'ویرایش مشخصات نیمه‌ساخته' : 'تعریف نیمه‌ساخته واسط جدید'}</span>
              </h4>

              <form onSubmit={handleSaveWipProduct} className="space-y-3">
                <div>
                  <label htmlFor="wip-code" className="block text-[10px] font-bold text-slate-400 mb-1">کد شناسایی کالا</label>
                  <input
                    id="wip-code"
                    type="text"
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="مثال: WIP-101"
                    value={wipCode}
                    onChange={(e) => setWipCode(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label htmlFor="wip-account-id" className="block text-[10px] font-bold text-slate-400 mb-1">کد حسابداری / معین</label>
                  <input
                    id="wip-account-id"
                    type="text"
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="مثال: ۱۴۰۲۰۱۰۱"
                    value={wipAccountId}
                    onChange={(e) => setWipAccountId(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="wip-name" className="block text-[10px] font-bold text-slate-400 mb-1">نام یا عنوان فارسی کالای نیمه‌ساخته</label>
                  <input
                    id="wip-name"
                    type="text"
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-sans"
                    placeholder="مثال: خمیر پیتزا چوک ایتالیایی"
                    value={wipName}
                    onChange={(e) => setWipName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="wip-category-id" className="block text-[10px] font-bold text-slate-400 mb-1">دپارتمان تولیدی</label>
                    <select
                      id="wip-category-id"
                      className="w-full p-2 border border-slate-850 rounded-xl text-xs bg-slate-900 text-white outline-none font-sans focus:border-indigo-500"
                      value={wipCategoryId}
                      onChange={(e) => setWipCategoryId(e.target.value)}
                    >
                      <option value="">-- انتخاب دپارتمان --</option>
                      {productCategories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="wip-unit" className="block text-[10px] font-bold text-slate-400 mb-1">واحد پایه ارزش‌گذاری</label>
                    <select
                      id="wip-unit"
                      className="w-full p-2 border border-slate-850 rounded-xl text-xs bg-slate-900 text-white outline-none font-bold focus:border-indigo-500"
                      value={wipUnit}
                      onChange={(e) => setWipUnit(e.target.value as 'عدد' | 'کیلو')}
                    >
                      <option value="کیلو">کیلوگرم</option>
                      <option value="عدد">عدد</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="wip-weight" className="block text-[10px] font-bold text-slate-400 mb-1">وزن مبنای بچ/واحد (گرم)</label>
                    <input
                      id="wip-weight"
                      type="number"
                      className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      placeholder="مثال: ۱۰۰۰"
                      value={wipWeight}
                      onChange={(e) => setWipWeight(e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </div>

                  <div>
                    <label htmlFor="wip-package-type" className="block text-[10px] font-bold text-slate-400 mb-1">نوع بسته‌بندی حفاظتی</label>
                    <select
                      id="wip-package-type"
                      className="w-full p-2 border border-slate-850 rounded-xl text-xs bg-slate-900 text-white outline-none font-sans focus:border-indigo-500"
                      value={wipPackageType}
                      onChange={(e) => setWipPackageType(e.target.value as any)}
                    >
                      <option value="سلفون">سلفون</option>
                      <option value="شیرینک">شیرینک</option>
                      <option value="لانچ باکس">لانچ باکس</option>
                      <option value="جعبه">جعبه</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="wip-barcode" className="block text-[10px] font-bold text-slate-400 mb-1">بارکد داخلی کالا</label>
                  <input
                    id="wip-barcode"
                    type="text"
                    className="w-full p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    placeholder="امکان اسکن لیبل کارگاهی"
                    value={wipBarcode}
                    onChange={(e) => setWipBarcode(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 pt-3">
                  <button
                    type="submit"
                    className="flex-grow bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-2.5 rounded-xl transition-all cursor-pointer shadow-lg shadow-indigo-600/15"
                  >
                    {wipEditingId ? 'ذخیره اصلاحات نیمه‌ساخته' : 'ثبت غرفه‌ای نیمه‌ساخته'}
                  </button>
                  {wipEditingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setWipEditingId(null);
                        setWipCode('');
                        setWipAccountId('');
                        setWipName('');
                        setWipCategoryId(productCategories.find(c => !isSharedDeptId(c.id))?.id || productCategories[0]?.id || '');
                        setWipUnit('کیلو');
                        setWipWeight('');
                        setWipPackageType('سلفون');
                        setWipBarcode('');
                        setWipQtyPerPackage(1);
                        setWipWeightPerPackage(1);
                      }}
                      className="px-3 border border-slate-800 hover:bg-slate-900 text-slate-400 rounded-xl text-xs transition-all cursor-pointer bg-slate-950"
                    >
                      انصراف
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Right Column: WIP List */}
            <div className="lg:col-span-8 bg-slate-950 p-5 rounded-3xl border border-slate-850 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <h4 className="text-xs font-black text-slate-200 border-r-2 border-indigo-500 pr-2">
                  لیست لوجهای در جریان ساخت ثبت شده فعال
                </h4>
                <div className="text-[10px] text-slate-500">
                  تعداد کل ثبت شده: <span className="font-bold text-slate-350">{toPersianDigits(db.products.filter(p => p.isWip && p.periodId === activePeriodId).length)} ردیف</span>
                </div>
              </div>

              {db.products.filter(p => p.isWip && p.periodId === activePeriodId).length === 0 ? (
                <div className="p-8 text-center bg-slate-900/50 border border-slate-900 rounded-2xl">
                  <Layers className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">تاکنون محصول نیمه‌ساخته‌ای بابت زنجیره تولید این دوره مالی ارزیابی نگردیده است.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-900">
                  <table className="w-full text-xs text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-slate-300 font-bold border-b border-slate-850">
                        <th className="px-4 py-3 text-center w-12">کد</th>
                        <th className="px-4 py-3">نام و عنوان فرآورده واسط</th>
                        <th className="px-4 py-3 text-center font-bold">دپارتمان</th>
                        <th className="px-4 py-3 text-center font-bold">واحد</th>
                        <th className="px-4 py-3 text-center font-bold">وزن مبنا</th>
                        <th className="px-4 py-3 text-left font-bold">قیمت تمام‌شده (محاسباتی)</th>
                        <th className="px-4 py-3 text-center w-24 font-bold">عملیات ویرایشی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {db.products
                        .filter(p => p.isWip && p.periodId === activePeriodId)
                        .map(p => {
                          const calculatedVal = fullCalculatedCOGSMap[p.id]?.totalCOGSPrice || p.cogsPrice || 0;
                          const categoryName = db.productCategories.find(c => c.id === p.categoryId)?.name || 'طعم‌سازی';
                          
                          return (
                            <tr key={p.id} className="border-b border-slate-900 hover:bg-slate-900/30 transition-all">
                              <td className="px-4 py-3 text-center font-mono font-bold text-indigo-400">{toPersianDigits(p.code)}</td>
                              <td className="px-4 py-3">
                                <div className="font-extrabold text-slate-200">{p.name}</div>
                                <div className="text-[9px] text-slate-500 font-mono">حسابداری: {toPersianDigits(p.accountId || '-')} | بارکد: {toPersianDigits(p.barcode || '-')}</div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className="bg-indigo-500/10 text-indigo-300 font-bold px-2 py-0.5 rounded text-[10px]">
                                  {categoryName}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center text-slate-400 font-bold">{p.unit}</td>
                              <td className="px-4 py-3 text-center font-mono font-bold text-slate-300">{toPersianDigits(p.weight || 1000)} گرم</td>
                              <td className="px-4 py-3 text-left font-mono font-black text-emerald-450 text-[13px]">
                                {formatWithCommas(Math.round(calculatedVal))} <span className="text-[9px] font-normal text-slate-500">ریال</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => handleEditWipProduct(p)}
                                    className="p-1 px-2 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded text-[10px] transition-all flex items-center gap-1 cursor-pointer"
                                    title="ویرایش مشخصات"
                                  >
                                    <Edit className="h-3 w-3" /> ویرایش
                                  </button>
                                  <button
                                    onClick={() => handleDeleteWipProduct(p.id)}
                                    className="p-1 px-2 border border-rose-950/20 hover:bg-rose-900 hover:text-white text-rose-450 rounded text-[10px] transition-all flex items-center gap-1 cursor-pointer"
                                    title="حذف نیمه‌ساخته"
                                  >
                                    <Trash2 className="h-3 w-3" /> حذف
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* HIDDEN PRINT CONTAINERS (MIGRATED OUTSIDE OF TABS SO ALWAYS IN DOM) */}
      <div className="hidden">
        {/* pricing-printable-report-container start */}
        <div id="pricing-printable-report-container" className="bg-white text-black text-right print:p-0" dir="rtl" style={{ fontFamily: '"Vazirmatn", "Tahoma", sans-serif', padding: '0px' }}>
          <style>
            {`
              @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;450;600;700;900&family=Libre+Barcode+39&display=swap');
              
              body, html {
                margin: 0 !important;
                padding: 0 !important;
                background-color: white !important;
              }
              #pricing-printable-report-container {
                width: 100% !important;
                max-width: 100% !important;
                box-sizing: border-box !important;
                padding: 0px !important;
                margin: 0px !important;
                background-color: white !important;
              }
              #pricing-printable-report-container table {
                width: 100% !important;
                border-collapse: collapse !important;
                margin-bottom: 24px !important;
              }
              #pricing-printable-report-container th, 
              #pricing-printable-report-container td {
                border: 1px solid #cbd5e1 !important;
                padding: 4px 5px !important;
                vertical-align: middle !important;
                font-size: 10.5px !important;
                color: black !important;
              }
              #pricing-printable-report-container th {
                background-color: #f8fafc !important;
                font-weight: bold !important;
                text-align: center !important;
                color: #1e293b !important;
              }
              #pricing-printable-report-container .text-center {
                text-align: center !important;
              }
              #pricing-printable-report-container .text-right {
                text-align: right !important;
              }
              #pricing-printable-report-container .text-left {
                text-align: left !important;
              }
              #pricing-printable-report-container .font-mono {
                font-family: 'Vazirmatn', 'Tahoma', sans-serif !important;
              }

              @media print {
                @page {
                  size: portrait !important;
                  margin: 0.4cm !important;
                }
                body, html {
                  font-size: 10px !important;
                  font-family: 'Vazirmatn', 'Tahoma', sans-serif !important;
                  color: black !important;
                  background-color: white !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  padding: 0px !important;
                  margin: 0px !important;
                }
                #pricing-printable-report-container {
                  width: 100% !important;
                  max-width: 100% !important;
                  padding: 0px !important;
                  margin: 0px !important;
                }
                th {
                  background-color: #f8fafc !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
              }
            `}
          </style>

          {/* Decorative Document Border Accent */}
          <div style={{ borderBottom: '3px solid #1e293b', paddingBottom: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 'bold' }}>سیستم جامع کنترل بهای تمام شده و فروش (COGS)</span>
                <h1 style={{ fontSize: '17px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>ابلاغیه رسمی قیمت فروش مصوب نهایی فرآورده‌ها</h1>
              </div>
              <div style={{ textAlign: 'left', fontSize: '10px', color: '#475569', fontFamily: '"Vazirmatn", sans-serif' }}>
                <div style={{ fontWeight: 'bold' }}>سند ابلاغ تغییر نرخ</div>
                <div>{db.periods.find(p => p.id === activePeriodId)?.name || activePeriodId}</div>
              </div>
            </div>
          </div>

          {/* Document Metadata Table Block */}
          <table style={{ width: '100%', marginBottom: '24px', borderCollapse: 'collapse', fontSize: '10px' }}>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', width: '25%', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>دوره مالی فعال:</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', width: '25%', fontFamily: '"Vazirmatn", sans-serif', fontWeight: 'bold' }}>{db.periods.find(p => p.id === activePeriodId)?.name || activePeriodId}</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', width: '25%', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>تاریخ اجرای نرخ مصوب:</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', width: '25%', fontFamily: '"Vazirmatn", sans-serif', fontWeight: 'bold' }}>{toPersianDigits(dateOfChange)}</td>
              </tr>
              <tr>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>تنظیم‌کننده ارزیابی:</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', fontFamily: '"Vazirmatn", sans-serif' }}>مدیریت بهای تمام شده و امور مالی کارگاه</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>مستند مرجع ابلاغ:</td>
                <td style={{ border: '1px solid #cbd5e1', padding: '8px', fontFamily: '"Vazirmatn", sans-serif' }}>مصوبه هیئت مدیره کارخانه صنعتی</td>
              </tr>
            </tbody>
          </table>

          {/* Table of products */}
          <div style={{ marginBottom: '24px' }}>
            <table className="w-full text-xs text-right border-collapse border border-slate-300" id="pricing-printable-report-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', color: '#1e293b', fontWeight: 'bold' }}>
                  <th className="border border-slate-300 px-1 py-2 text-center" style={{ width: '32px', fontSize: '10px' }}>ردیف</th>
                  <th className="border border-slate-300 px-1 py-2 text-center" style={{ width: '68px', fontSize: '10px' }}>کد حسابداری</th>
                  <th className="border border-slate-300 px-2 py-2 text-right" style={{ width: 'auto', fontSize: '11px' }}>نام محصول</th>
                  <th className="border border-slate-300 px-2 py-2 text-center" style={{ width: '115px', fontSize: '10px' }}>بارکد فعال (اسکن خوان)</th>
                  <th className="border border-slate-300 px-2 py-2 text-left" style={{ width: '145px', backgroundColor: '#f1f5f9', fontSize: '11.5px' }}>فی فروش جدید (ریال)</th>
                  <th className="border border-slate-300 px-1 py-2 text-center" style={{ width: '35px', fontSize: '9px', lineHeight: '1.1' }}>ثبت سیستم</th>
                  <th className="border border-slate-300 px-1 py-2 text-center" style={{ width: '35px', fontSize: '9px', lineHeight: '1.1' }}>ثبت ترازو</th>
                  <th className="border border-slate-300 px-1 py-2 text-center" style={{ width: '35px', fontSize: '9px', lineHeight: '1.1' }}>اصلاح لیبل</th>
                </tr>
              </thead>
              <tbody>
                {pricingData
                  .filter(item => {
                    const approvedVal = approvedPrices[item.product.id] ?? 0;
                    return approvedVal > 0;
                  })
                  .map((item, index) => {
                    const approvedVal = approvedPrices[item.product.id] ?? 0;
                    const rawVal = item.product.barcode || item.product.code || "123456";
                    
                    // Normalizing Persian/Arabic numbers to English numbers for Code 39 barcode formatting
                    const normalizedEngDigits = rawVal
                       .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
                       .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
                       
                    const barValUpper = String(normalizedEngDigits).toUpperCase();
                    const safeBarVal = barValUpper.split('').filter(char => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%".includes(char)).join('') || "123456";

                    return (
                      <tr key={item.product.id} className="border border-slate-300">
                        <td className="border border-slate-300 px-1 py-1.5 text-center" style={{ fontSize: '11px', fontFamily: '"Vazirmatn", sans-serif', fontWeight: 'bold' }}>{toPersianDigits(index + 1)}</td>
                        <td className="border border-slate-300 px-1 py-1.5 text-center" style={{ fontSize: '10px', fontFamily: '"Vazirmatn", sans-serif', fontWeight: 'bold' }}>{toPersianDigits(item.product.accountId || '-')}</td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right" style={{ fontWeight: '700', fontSize: '11px', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word', fontFamily: '"Vazirmatn", sans-serif' }}>{item.product.name}</td>
                        <td className="border border-slate-300 px-1 py-1 text-center" style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', direction: 'ltr' }}>
                            {/* Extremely high-resolution barcode font readable but nicely compact */}
                            <div style={{ fontFamily: '"Libre Barcode 39", cursive', fontSize: '38px', lineHeight: '0.75', color: 'black', letterSpacing: '0.8px', padding: '4px 0 1px 0' }}>
                              *{safeBarVal}*
                            </div>
                            <span style={{ fontSize: '8px', fontFamily: '"Vazirmatn", sans-serif', fontWeight: 'bold', display: 'block', color: '#475569', marginTop: '-1.5px', letterSpacing: '0.5px' }}>
                              {toPersianDigits(safeBarVal)}
                            </span>
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-left font-black" style={{ backgroundColor: '#f1f5f9', fontSize: '22px', color: '#000000', fontFamily: '"Vazirmatn", sans-serif', fontWeight: '900', whiteSpace: 'nowrap' }}>
                          {toPersianDigits(formatWithCommas(approvedVal))}
                          <span style={{ fontSize: '10px', fontWeight: 'bold', marginRight: '3px', color: '#475569', fontFamily: '"Vazirmatn", sans-serif' }}> ریال</span>
                        </td>
                        {/* Checkboxes column for register in System */}
                        <td className="border border-slate-300 px-1 py-1.5 text-center" style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: '13px', height: '13px', border: '1.2px solid #000', borderRadius: '3px', backgroundColor: '#ffffff' }}></div>
                          </div>
                        </td>
                        {/* Checkboxes column for register in Scale */}
                        <td className="border border-slate-300 px-1 py-1.5 text-center" style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: '13px', height: '13px', border: '1.2px solid #000', borderRadius: '3px', backgroundColor: '#ffffff' }}></div>
                          </div>
                        </td>
                        {/* Checkboxes column for packaging label repair */}
                        <td className="border border-slate-300 px-1 py-1.5 text-center" style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: '13px', height: '13px', border: '1.2px solid #000', borderRadius: '3px', backgroundColor: '#ffffff' }}></div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Informational Footer Note */}
          <div style={{ fontSize: '9px', color: '#475569', lineHeight: '1.6', borderRight: '2px solid #64748b', paddingRight: '10px', marginBottom: '24px' }}>
            <span>همکار گرامی؛ مقتضی است پس از دریافت این برگ ثبتی ابلاغ نرخ، به صورت ترتیبی و گام‌به‌گام اقدامات فوق را برای تک‌تک محصولات علامت‌گذاری نمایید تا مغایرتی در قیمت مصرف‌کننده، فاکتورهای حسابداری فروشگاه و حافظه داخلی ترازوهای دیجیتال پیش نیاید.</span>
          </div>

          {/* Signature Blocks */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', marginTop: '32px', textAlign: 'center', fontSize: '11px' }}>
            <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 'bold', color: '#1e293b', paddingBottom: '40px', borderBottom: '1px dashed #cbd5e1', marginBottom: '8px' }}>امضا حسابداری صنعتی</div>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block', fontWeight: '500' }}>بخش بها تمام شده کارگاهی</span>
            </div>
            <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 'bold', color: '#1e293b', paddingBottom: '40px', borderBottom: '1px dashed #cbd5e1', marginBottom: '8px' }}>امضا مدیریت دپارتمان مربوطه</div>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block', fontWeight: '500' }}>سرپرست تولید و ساخت</span>
            </div>
            <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 'bold', color: '#1e293b', paddingBottom: '40px', borderBottom: '1px dashed #cbd5e1', marginBottom: '8px' }}>مهر و امضا مدیریت عامل</div>
              <span style={{ fontSize: '10px', color: '#64748b', display: 'block', fontWeight: '500' }}>مصوبه رسمی تایید نرخ هیئت مدیره</span>
            </div>
          </div>
        </div>
        {/* pricing-printable-report-container end */}

        {/* formulation-printable-report-container start */}
        <div id="formulation-printable-report-container" className="bg-white text-black text-right print:p-0" dir="rtl" style={{ fontFamily: '"Vazirmatn", "Tahoma", sans-serif', padding: '0px' }}>
          {selectedProductData && activeFormulaData && (
            <>
              <style>
                {`
                  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;450;600;700;900&display=swap');
                  
                  #formulation-printable-report-container {
                    width: 100% !important;
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                    padding: 0px !important;
                    margin: 0px !important;
                    background-color: white !important;
                    color: black !important;
                  }
                  #formulation-printable-report-container table {
                    width: 100% !important;
                    border-collapse: collapse !important;
                    margin-bottom: 20px !important;
                  }
                  #formulation-printable-report-container th, 
                  #formulation-printable-report-container td {
                    border: 1px solid #cbd5e1 !important;
                    padding: 6px 8px !important;
                    vertical-align: middle !important;
                    font-size: 11px !important;
                    color: black !important;
                  }
                  #formulation-printable-report-container th {
                    background-color: #f1f5f9 !important;
                    font-weight: bold !important;
                    text-align: center !important;
                    color: #0f172a !important;
                  }
                  @media print {
                    @page {
                      size: portrait !important;
                      margin: 0.5cm !important;
                    }
                    body, html {
                      font-family: 'Vazirmatn', 'Tahoma', sans-serif !important;
                      color: black !important;
                      background-color: white !important;
                      -webkit-print-color-adjust: exact !important;
                      print-color-adjust: exact !important;
                    }
                  }
                `}
              </style>

              {/* Print Letterhead / Title Area */}
              <div style={{ borderBottom: '3px double #0f172a', paddingBottom: '12px', marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '10px', color: '#475569', display: 'block', fontWeight: 'bold' }}>سامانه محاسبات بهای تمام شده و مدیریت کارگاه (COGS)</span>
                    <h1 style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a', marginTop: '4px' }}>شناسنامه فنی، فرمولاسیون و بهای تمام‌شده ساخت کالا</h1>
                  </div>
                  <div style={{ textAlign: 'left', fontSize: '9px', color: '#334155' }}>
                    <div style={{ fontWeight: 'bold' }}>برنامه پخت و دستور مصرف (BOM)</div>
                    <div style={{ marginTop: '2px' }}>دوره مالی: {db.periods.find(p => p.id === activePeriodId)?.name || activePeriodId}</div>
                    <div>تاریخ گزارش: {toPersianDigits(getTodayJalali())}</div>
                  </div>
                </div>
              </div>

              {/* Section 1: Product Passport details */}
              <h3 style={{ fontSize: '12px', fontWeight: '900', color: '#0f172a', marginBottom: '8px', borderRight: '3px solid #e11d48', paddingRight: '8px' }}>مشخصات عمومی فرآورده</h3>
              <table style={{ width: '100%', marginBottom: '16px' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '20%', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>نام محصول:</td>
                    <td style={{ width: '30%', fontWeight: '900', color: '#e11d48' }}>{selectedProductData.name}</td>
                    <td style={{ width: '20%', backgroundColor: '#f8fafc', fontWeight: 'bold' }}>کد حسابداری محصول:</td>
                    <td style={{ width: '30%', fontFamily: 'monospace', fontWeight: 'bold' }}>{toPersianDigits(selectedProductData.accountId || selectedProductData.code || '-')}</td>
                  </tr>
                  <tr>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>گروه فرآورده:</td>
                    <td>{(db.productCategories || []).find(c => c.id === selectedProductData.categoryId)?.name || 'دسته عمومی'}</td>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>کد سیستمی کالا:</td>
                    <td style={{ fontFamily: 'monospace' }}>{toPersianDigits(selectedProductData.id)}</td>
                  </tr>
                  <tr>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>وزن چانه / بسته‌بندی:</td>
                    <td style={{ fontWeight: 'bold' }}>
                      {selectedProductData.weight ? `${toPersianDigits(selectedProductData.weight)} گرم` : 'ثبت نشده'}
                    </td>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>واحد قیمت‌گذاری مصوب:</td>
                    <td>{selectedProductData.unit || 'عدد'}</td>
                  </tr>
                  <tr>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>نسخه (نام فرمول ساخت):</td>
                    <td style={{ fontWeight: 'bold', color: '#000000' }}>{activeFormulaData.name || 'فرمول اصلی'}</td>
                    <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>وضعیت فرمول کالا:</td>
                    <td style={{ fontWeight: 'bold', color: activeFormulaData.isActive ? '#059669' : '#e11d48' }}>
                      {activeFormulaData.isActive ? 'فرمول فعال و مبنای کل' : 'فرمول جایگزین (آرشیو/غیرفعال)'}
                    </td>
                  </tr>
                  {(() => {
                    const cogsData = fullCalculatedCOGSMap[selectedProductData.id];
                    const approvedPrice = selectedProductData.salePrice || 0;
                    if (!cogsData) return null;
                    const roundedMaterialCost = Math.round(cogsData.materialCost);
                    const roundedLabor = Math.round(cogsData.directLabor + cogsData.sharedLabor);
                    const roundedOverhead = Math.round(cogsData.overheadCost);
                    const totalRoundedCOGS = roundedMaterialCost + roundedLabor + roundedOverhead;
                    const profitMargin = approvedPrice > 0 ? ((approvedPrice - totalRoundedCOGS) / approvedPrice) * 100 : 0;
                    return (
                      <>
                        <tr>
                          <td style={{ backgroundColor: '#f1f5f9', fontWeight: 'bold' }}>قیمت فروش مصوب نهایی:</td>
                          <td style={{ fontWeight: 'bold', fontSize: '12px' }}>{approvedPrice > 0 ? `${formatWithCommas(approvedPrice)} ریال` : 'تعیین نشده'}</td>
                          <td style={{ backgroundColor: '#f1f5f9', fontWeight: 'bold' }}>بهای تمام شده محاسباتی (COGS):</td>
                          <td style={{ fontWeight: 'bold', fontSize: '12px', color: '#059669' }}>{formatWithCommas(totalRoundedCOGS)} ریال</td>
                        </tr>
                        <tr>
                          <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>سود ناخالص تک واحد:</td>
                          <td style={{ fontWeight: 'bold' }}>{approvedPrice > 0 ? `${formatWithCommas(Math.round(approvedPrice - totalRoundedCOGS))} ریال` : 'نامشخص'}</td>
                          <td style={{ backgroundColor: '#f8fafc', fontWeight: 'bold' }}>حاشیه سود فرضی (Margin):</td>
                          <td style={{ fontWeight: 'bold', color: profitMargin >= 0 ? '#059669' : '#dc2626' }}>
                            {approvedPrice > 0 ? `${toPersianDigits(profitMargin.toFixed(1))}%` : 'نامشخص'}
                          </td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>

              {/* Section 2: Detailed BOM Ingredients */}
              <h3 style={{ fontSize: '12px', fontWeight: '900', color: '#0f172a', marginBottom: '8px', borderRight: '3px solid #e11d48', paddingRight: '8px' }}>مواد خام مصرفی ریزدستور پخت (Recipe Instructions)</h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '6%', textAlign: 'center' }}>ردیف</th>
                    <th style={{ width: '12%', textAlign: 'center' }}>کد کالا</th>
                    <th style={{ width: '38%', textAlign: 'right' }}>نام ماده مصرفی اولیه</th>
                    <th style={{ width: '14%', textAlign: 'center' }}>حجم در فرمول</th>
                    <th style={{ width: '15%', textAlign: 'left' }}>آخرین فی خرید خام</th>
                    <th style={{ width: '15%', textAlign: 'left', backgroundColor: '#f1f5f9' }}>بهای محاسباتی مصرف</th>
                  </tr>
                </thead>
                <tbody>
                  {activeFormulaData.ingredients.map((ing: any, idx: number) => {
                    const resolved = resolveMaterialByKey(ing.rawMaterialId);
                    const item = resolved.item || resolved.wip;
                    if (!item) {
                      return (
                        <tr key={`${ing.rawMaterialId}-${idx}`}>
                          <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{toPersianDigits(idx + 1)}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '10px' }}>{toPersianDigits(ing.rawMaterialId)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#b45309' }}>
                            کالا / ماده اولیه یافت نشد (حذف‌شده)
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: '900', color: '#b91c1c' }}>
                            {toPersianDigits(ing.quantity)}
                          </td>
                          <td style={{ textAlign: 'left', fontWeight: 'bold' }}>۰</td>
                          <td style={{ textAlign: 'left', fontWeight: 'bold', backgroundColor: '#fafafa', color: '#64748b' }}>۰ ریال</td>
                        </tr>
                      );
                    }
                    const itemPrice = resolved.isWip && resolved.wip
                      ? (fullCalculatedCOGSMap[resolved.wip.id]?.totalCOGSPrice || resolved.wip.cogsPrice || 0)
                      : (resolved.item?.price || 0);
                    const factor = resolved.isWip && resolved.wip
                      ? (resolved.wip.unit === 'کیلو' ? 1000 : 1)
                      : (resolved.item?.unit === 'کیلویی' ? 1000 : (findMaterialConversion(ing.rawMaterialId, resolved.item)?.factor || 1));
                    const unitPrice = itemPrice / factor;
                    const ingredientCost = ing.quantity * unitPrice;
                    const consumptionUnit = resolved.isWip && resolved.wip
                      ? (resolved.wip.unit === 'کیلو' ? 'گرم' : 'عدد')
                      : (resolved.item?.unit === 'کیلویی' ? 'گرم' : (findMaterialConversion(ing.rawMaterialId, resolved.item)?.consumptionUnit || 'عدد'));
                    const purchaseUnitLabel = resolved.isWip && resolved.wip
                      ? resolved.wip.unit
                      : (resolved.item?.unit === 'کیلویی' ? 'کیلو' : 'عدد');

                    return (
                      <tr key={`${ing.rawMaterialId}-${idx}`}>
                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{toPersianDigits(idx + 1)}</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: '10px' }}>{toPersianDigits(item.code)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                          {item.name}
                          {item.accountId ? <span style={{ fontSize: '9px', color: '#64748b', marginRight: '6px' }}>(حساب: {toPersianDigits(item.accountId)})</span> : null}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: '900', color: '#b91c1c' }}>
                          {toPersianDigits(ing.quantity)} {consumptionUnit}
                        </td>
                        <td style={{ textAlign: 'left', fontWeight: 'bold' }}>
                          {toPersianDigits(formatWithCommas(Math.round(itemPrice)))} <span style={{ fontSize: '9px', color: '#64748b' }}>({purchaseUnitLabel})</span>
                        </td>
                        <td style={{ textAlign: 'left', fontWeight: 'bold', backgroundColor: '#fafafa', color: '#047857' }}>
                          {formatWithCommas(Math.round(ingredientCost))} ریال
                        </td>
                      </tr>
                    );
                  })}

                  {/* Summary row within ingredients table */}
                  {(() => {
                    const totalWeight = activeFormulaData.ingredients.reduce((sum, ing) => {
                      const resolved = resolveMaterialByKey(ing.rawMaterialId);
                      const item = resolved.item || resolved.wip;
                      if (!item) return sum;

                      let weightInGrams = 0;
                      if (resolved.isWip && resolved.wip) {
                        if (resolved.wip.unit === 'کیلو') {
                          weightInGrams = ing.quantity;
                        }
                      } else if (resolved.item) {
                        if (resolved.item.unit === 'کیلویی') {
                          weightInGrams = ing.quantity;
                        } else {
                          const conv = findMaterialConversion(ing.rawMaterialId, resolved.item);
                          if (conv) {
                            const cUnit = conv.consumptionUnit || '';
                            const isWeightBased = cUnit === 'گرم' || cUnit === 'سی سی' || cUnit.includes('گرم') || cUnit.includes('سی‌سی') || cUnit.includes('سی سی') || cUnit.includes('کیلو');
                            if (isWeightBased) {
                              if (cUnit.includes('کیلو')) {
                                weightInGrams = ing.quantity * 1000;
                              } else {
                                weightInGrams = ing.quantity;
                              }
                            }
                          }
                        }
                      }
                      return sum + weightInGrams;
                    }, 0);

                    const totalCost = activeFormulaData.ingredients.reduce((sum, ing) => {
                      const resolved = resolveMaterialByKey(ing.rawMaterialId);
                      const item = resolved.item || resolved.wip;
                      if (!item) return sum;
                      const itemPrice = resolved.isWip && resolved.wip
                        ? (fullCalculatedCOGSMap[resolved.wip.id]?.totalCOGSPrice || resolved.wip.cogsPrice || 0)
                        : (resolved.item?.price || 0);
                      const factor = resolved.isWip && resolved.wip
                        ? (resolved.wip.unit === 'کیلو' ? 1000 : 1)
                        : (resolved.item?.unit === 'کیلویی' ? 1000 : (findMaterialConversion(ing.rawMaterialId, resolved.item)?.factor || 1));
                      const unitPrice = itemPrice / factor;
                      return sum + Math.round(ing.quantity * unitPrice);
                    }, 0);

                    return (
                      <tr style={{ backgroundColor: '#f8fafc', fontWeight: '900' }}>
                        <td colSpan={3} style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '11px' }}>سرجمع مقادیر دستور پخت (BOM Total Sum):</td>
                        <td style={{ textAlign: 'center', color: '#b91c1c' }}>
                          {totalWeight > 0 ? `${toPersianDigits(totalWeight.toFixed(totalWeight % 1 === 0 ? 0 : 2))} گرم ` : '-'}
                        </td>
                        <td style={{ textAlign: 'left' }}>-</td>
                        <td style={{ textAlign: 'left', color: '#047857', fontSize: '11.5px', backgroundColor: '#ecfdf5' }}>
                          {formatWithCommas(Math.round(totalCost))} ریال
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>

              {/* Section 3: Cost allocation breakdown cards */}
              {(() => {
                const cogs = fullCalculatedCOGSMap[selectedProductData.id];
                if (!cogs) return null;
                const roundedMaterialCost = Math.round(cogs.materialCost);
                const roundedLabor = Math.round(cogs.directLabor + cogs.sharedLabor);
                const roundedOverhead = Math.round(cogs.overheadCost);
                const totalRoundedCOGS = roundedMaterialCost + roundedLabor + roundedOverhead;
                return (
                  <div style={{ marginTop: '14px', marginBottom: '22px' }}>
                    <h3 style={{ fontSize: '12px', fontWeight: '900', color: '#0f172a', marginBottom: '8px', borderRight: '3px solid #e11d48', paddingRight: '8px' }}>تسهیم هزینه‌های جاری دوره‌ای بابت تولید کالا</h3>
                    <table style={{ width: '100%' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <th style={{ width: '25%', fontSize: '10.5px' }}>بهای مواد اولیه (سند پخت)</th>
                          <th style={{ width: '25%', fontSize: '10.5px' }}>حقوق و دستمزد مستقیم</th>
                          <th style={{ width: '25%', fontSize: '10.5px' }}>هزینه سربار مستقیم/غیرمستقیم</th>
                          <th style={{ width: '25%', backgroundColor: '#ecfdf5', color: '#047857', fontSize: '11px' }}>بهای تمام شده کارگاهی</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ textAlign: 'center', fontWeight: 'bold' }}>
                          <td>{formatWithCommas(roundedMaterialCost)} ریال</td>
                          <td>{formatWithCommas(roundedLabor)} ریال</td>
                          <td>{formatWithCommas(roundedOverhead)} ریال</td>
                          <td style={{ backgroundColor: '#ecfdf5', color: '#047857', fontSize: '13px', fontWeight: '900' }}>
                            {formatWithCommas(totalRoundedCOGS)} ریال
                          </td>
                        </tr>
                        <tr style={{ textAlign: 'center', fontSize: '9px', color: '#64748b' }}>
                          <td>{toPersianDigits((totalRoundedCOGS > 0 ? (roundedMaterialCost / totalRoundedCOGS * 100) : 0).toFixed(1))}% سهم مواد</td>
                          <td>{toPersianDigits((totalRoundedCOGS > 0 ? (roundedLabor / totalRoundedCOGS * 100) : 0).toFixed(1))}% سهم پرسنل</td>
                          <td>{toPersianDigits((totalRoundedCOGS > 0 ? (roundedOverhead / totalRoundedCOGS * 100) : 0).toFixed(1))}% سهم سربارها</td>
                          <td style={{ backgroundColor: '#ecfdf5' }}>سهم سرجمع: ۱۰۰٪</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              {/* Industrial Print Notice */}
              <div style={{ fontSize: '9.5px', color: '#475569', lineHeight: '1.6', borderRight: '2px solid #e11d48', paddingRight: '10px', marginBottom: '28px', backgroundColor: '#fffbfb', padding: '6px' }}>
                <span>نکته فنی تولید: اطلاعات فوق به صورت زنده بر اساس فرآیند بچ‌سازی (Batch Processing)، فاکتورهای مواد اولیه کلاود، ضرایب تبدیل کالیبره شده و فرمول‌های ساخت مصوب استخراج گردیده است. مقتضی است پرسنل زحمتکش آشپزخانه و واحد بچینگ طبق مقادیر فوق اقدام به ساخت فرآورده نمایند و کنترل کیفی بر روند مصرف آرا و افزودنی ها نظارت مستقیم داشته باشد.</span>
              </div>

              {/* Standard manufacturing signature list */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '20px', textAlign: 'center', fontSize: '10.5px' }}>
                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <div style={{ fontWeight: 'bold', color: '#0f172a', paddingBottom: '35px', borderBottom: '1px dashed #cbd5e1', marginBottom: '6px' }}>تهیه‌کننده (حسابداری صنعتی)</div>
                  <span style={{ fontSize: '9px', color: '#475569', display: 'block' }}>مدیریت بهای تمام شده</span>
                </div>
                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <div style={{ fontWeight: 'bold', color: '#0f172a', paddingBottom: '35px', borderBottom: '1px dashed #cbd5e1', marginBottom: '6px' }}>مدیر فنی و کنترل کیفی (QA)</div>
                  <span style={{ fontSize: '9px', color: '#475569', display: 'block' }}>انطباق فیزیکی بچ تولیدی</span>
                </div>
                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <div style={{ fontWeight: 'bold', color: '#0f172a', paddingBottom: '35px', borderBottom: '1px dashed #cbd5e1', marginBottom: '6px' }}>مدیر تولید</div>
                  <span style={{ fontSize: '9px', color: '#475569', display: 'block' }}>تایید فرآیند و تست بچ پخت</span>
                </div>
                <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                  <div style={{ fontWeight: 'bold', color: '#0f172a', paddingBottom: '35px', borderBottom: '1px dashed #cbd5e1', marginBottom: '6px' }}>تایید نهایی مدیریت کارخانه</div>
                  <span style={{ fontSize: '9px', color: '#475569', display: 'block' }}>ابلاغ رسمی قیمت و دستور ساخت</span>
                </div>
              </div>
            </>
          )}
        </div>
        {/* formulation-printable-report-container end */}
      </div>

      {/* ===================== APPLE-INSPIRED PREMIUM INLINE MODAL DIALOG (MATERIALS DIRECT EDITOR) ===================== */}
      {editingItemInline && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans" dir="rtl">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-950 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-right"
          >
            <div className="flex justify-between items-center border-b border-slate-900 pb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <Edit className="h-4 w-4 text-rose-500" />
                ویرایش مشخصات اصلی ماده کالا: {editingItemInline.name}
              </h3>
            </div>
            
            <form onSubmit={handleSaveInlineItemEdit} className="space-y-4">
              <div>
                <label htmlFor="inline-item-name-premium" className="block text-xs font-semibold text-slate-400 mb-1.5">عنوان نام فارسی کالا</label>
                <input
                  id="inline-item-name-premium"
                  type="text"
                  className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-sans"
                  value={editingItemInline.name}
                  onChange={(e) => setEditingItemInline({...editingItemInline, name: e.target.value})}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inline-item-price-premium" className="block text-xs font-semibold text-slate-400 mb-1.5">نرخ خرید عمده (ریال)</label>
                  <input
                    id="inline-item-price-premium"
                    type="text"
                    onFocus={handleFocus}
                    className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={formatWithCommas(editingItemInline.price)}
                    onChange={(e) => setEditingItemInline({...editingItemInline, price: parseNumber(e.target.value)})}
                  />
                </div>

                <div>
                  <label htmlFor="inline-item-unit-premium" className="block text-xs font-semibold text-slate-400 mb-1.5">واحد پایه خرید</label>
                  <select
                    id="inline-item-unit-premium"
                    className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-100 text-slate-900 outline-none font-bold"
                    value={editingItemInline.unit}
                    onChange={(e) => setEditingItemInline({...editingItemInline, unit: e.target.value as any})}
                  >
                    <option value="کیلویی">کیلویی</option>
                    <option value="عددی">عددی</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="inline-item-qpack-premium" className="block text-xs font-semibold text-slate-400 mb-1.5">تعداد در بسته‌بندی</label>
                  <input
                    id="inline-item-qpack-premium"
                    type="number"
                    onFocus={handleFocus}
                    className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={editingItemInline.qtyPerPackage}
                    onChange={(e) => setEditingItemInline({...editingItemInline, qtyPerPackage: parseNumber(e.target.value)})}
                  />
                </div>

                <div>
                  <label htmlFor="inline-item-wpack-premium" className="block text-xs font-semibold text-slate-400 mb-1.5">وزن خالص در بسته</label>
                  <input
                    id="inline-item-wpack-premium"
                    type="number"
                    step="any"
                    onFocus={handleFocus}
                    className="w-full p-2.5 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white font-mono outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                    value={editingItemInline.weightPerPackage}
                    onChange={(e) => setEditingItemInline({...editingItemInline, weightPerPackage: parseNumber(e.target.value)})}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="submit"
                  className="flex-grow bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer shadow-lg shadow-rose-600/10"
                >
                  بروزآوری مشخصات خرید
                </button>
                <button
                  type="button"
                  onClick={() => setEditingItemInline(null)}
                  className="px-4 border border-slate-850 hover:bg-slate-905 text-slate-400 hover:text-white rounded-xl text-xs cursor-pointer transition-all bg-slate-900"
                >
                  انصراف
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ===================== WAGES AND OVERHEAD ALLOCATION TABLE MODAL ===================== */}
      {showAllocationTableModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans" dir="rtl">
          <motion.div 
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-950 border border-slate-800 rounded-3xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl text-right"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-850 p-5 bg-slate-900/50">
              <div className="flex items-center gap-2.5">
                <div className="bg-rose-500/10 text-rose-400 p-2 rounded-xl">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-black text-white">جدول تسهیم هزینه و حقوق دوره فعال</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">جزئیات محاسباتی تخصیص دستمزد مستقیم، حقوق مشترک و هزینه سربار به تفکیک دپارتمان‌ها و محصولات</p>
                </div>
              </div>
              <button
                onClick={() => setShowAllocationTableModal(false)}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Navigation Tabs & Search/Filters Bar */}
            <div className="border-b border-slate-850 p-4 bg-slate-900/30 flex flex-col md:flex-row md:items-center justify-between gap-3.5">
              {/* Tab Toggles */}
              <div className="flex p-0.5 bg-slate-950 rounded-xl border border-slate-850 w-fit">
                <button
                  onClick={() => setAllocationModalTab('departmental')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    allocationModalTab === 'departmental'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  تسهیم دپارتمان‌ها و محصولات
                </button>
                <button
                  onClick={() => setAllocationModalTab('summary')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    allocationModalTab === 'summary'
                      ? 'bg-rose-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Calculator className="h-3.5 w-3.5" />
                  خلاصه موازنه کل و انطباق دفاتر
                </button>
              </div>

              {/* Filtering Controls (Only visible in Departmental tab) */}
              {allocationModalTab === 'departmental' && (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Category Filter */}
                  <select
                    value={selectedAllocationCatId}
                    onChange={(e) => setSelectedAllocationCatId(e.target.value)}
                    className="p-2 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-1 focus:ring-rose-500 font-bold"
                  >
                    <option value="all">همه دپارتمان‌ها</option>
                    {departmentFilterOptions.map(dept => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>

                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="جستجوی کالا..."
                      value={allocationSearchQuery}
                      onChange={(e) => setAllocationSearchQuery(e.target.value)}
                      className="p-2 pr-8 border border-slate-800 rounded-xl text-xs bg-slate-900 text-white outline-none focus:ring-1 focus:ring-rose-500 w-44"
                    />
                    <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Content Pane */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {allocationModalTab === 'departmental' ? (
                // 1. Departmental list view
                <div className="space-y-6">
                  {detailedAllocationData.categories
                    .filter(cat => selectedAllocationCatId === 'all' || cat.categoryId === selectedAllocationCatId)
                    .map(cat => {
                      // Filter products inside this category
                      const filteredProducts = cat.products.filter(p => {
                        if (!allocationSearchQuery) return true;
                        const q = allocationSearchQuery.toLowerCase();
                        return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
                      });

                      if (filteredProducts.length === 0 && allocationSearchQuery) return null;

                      return (
                        <div key={cat.categoryId} className="bg-slate-900/50 rounded-2xl border border-slate-850 overflow-hidden">
                          {/* Category Header Card */}
                          <div className="p-4 bg-slate-900 border-b border-slate-850 flex flex-wrap items-center justify-between gap-2.5">
                            <div>
                              <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-rose-550" />
                                دپارتمان: {cat.categoryName}
                              </h3>
                              <p className="text-[10px] text-slate-400 mt-1">بخش تولید تخصصی محصولات این گروه با موازنه هزینه سالانه</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 font-semibold text-slate-300">
                                حقوق مستقیم ثبت شده: <span className="text-rose-400 font-mono font-bold text-xs">{formatWithCommas(cat.directPayrollBooked)}</span> ریال
                              </span>
                              <span className="text-[10px] bg-emerald-950/20 px-2.5 py-1 rounded-lg border border-emerald-500/20 font-semibold text-emerald-400">
                                جمع کل تسهیم‌شده کالاها: <span className="font-mono font-bold text-xs">{formatWithCommas(Math.round(cat.totalAllocatedSum))}</span> ریال
                              </span>
                            </div>
                          </div>

                          {/* Category Products Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-right border-collapse">
                              <thead>
                                <tr className="bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-850">
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">کد</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300">نام محصول دپارتمان</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">حجم فروش</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">روش تسهیم</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">حقوق مستقیم (واحد / کل)</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">حقوق مشترک (واحد / کل)</th>
                                  <th className="py-2.5 px-3 font-bold text-slate-300 text-center">سربار کارگاهی (واحد / کل)</th>
                                  <th className="py-2.5 px-3 font-bold text-emerald-400 text-center bg-emerald-950/10">جمع کل تسهیمی (واحد / کل)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-850/50">
                                {filteredProducts.length === 0 ? (
                                  <tr>
                                    <td colSpan={8} className="py-8 text-center text-slate-500 font-bold">
                                      هیچ کالایی در این دپارتمان برای نمایش یافت نشد.
                                    </td>
                                  </tr>
                                ) : (
                                  filteredProducts.map(p => (
                                    <tr key={p.productId} className="hover:bg-slate-850/30 transition-all">
                                      <td className="py-2.5 px-3 text-center font-mono text-[10px] text-slate-400">{toPersianDigits(p.code)}</td>
                                      <td className="py-2.5 px-3 font-bold text-slate-100">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span>{p.name}</span>
                                          <span className="text-[9px] text-slate-400 font-semibold">({p.unit === 'کیلو' ? 'کیلویی' : `${toPersianDigits(p.weight || '')} گرمی`})</span>
                                          {p.productClass === 'purchased' ? (
                                            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-bold">خریداری</span>
                                          ) : p.productClass === 'formulated' ? (
                                            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 font-bold">تولیدی (فرمول‌دار)</span>
                                          ) : (
                                            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">تولیدی (بدون فرمول)</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-300">
                                        {p.qtySold > 0 ? toPersianDigits(formatWithCommas(p.qtySold)) : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        {p.allocationMode === 'purchased' ? (
                                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-sky-600/15 text-sky-300 border border-sky-500/25">
                                            {p.allocationDetail}
                                          </span>
                                        ) : p.qtySold > 0 ? (
                                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                            p.allocationMode === 'time'
                                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/10'
                                              : p.allocationMode === 'sales_no_formula'
                                                ? 'bg-amber-600/15 text-amber-300 border border-amber-500/30'
                                                : 'bg-emerald-600/10 text-emerald-400 border border-emerald-500/15'
                                          }`}>
                                            {p.allocationDetail}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 text-[10px]">{p.allocationDetail || '—'}</span>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-mono">
                                        {p.qtySold > 0 || p.directLaborPerUnit > 0 ? (
                                          <div className="flex flex-col">
                                            <span className="text-slate-200 font-bold">{formatWithCommas(Math.round(p.directLaborPerUnit))}</span>
                                            <span className="text-[10px] text-slate-400 mt-0.5">کل: {formatWithCommas(Math.round(p.directLaborTotal))}</span>
                                          </div>
                                        ) : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-mono">
                                        {p.qtySold > 0 || p.sharedLaborPerUnit > 0 ? (
                                          <div className="flex flex-col">
                                            <span className="text-slate-200 font-bold">{formatWithCommas(Math.round(p.sharedLaborPerUnit))}</span>
                                            <span className="text-[10px] text-slate-400 mt-0.5">کل: {formatWithCommas(Math.round(p.sharedLaborTotal))}</span>
                                          </div>
                                        ) : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-mono">
                                        {p.qtySold > 0 || p.overheadPerUnit > 0 ? (
                                          <div className="flex flex-col">
                                            <span className="text-slate-200 font-bold">{formatWithCommas(Math.round(p.overheadPerUnit))}</span>
                                            <span className="text-[10px] text-slate-400 mt-0.5">کل: {formatWithCommas(Math.round(p.overheadTotal))}</span>
                                          </div>
                                        ) : '—'}
                                      </td>
                                      <td className="py-2.5 px-3 text-center font-mono bg-emerald-950/5">
                                        {p.qtySold > 0 || p.totalPerUnit > 0 ? (
                                          <div className="flex flex-col">
                                            <span className="text-emerald-400 font-black">{formatWithCommas(Math.round(p.totalPerUnit))}</span>
                                            <span className="text-[10px] text-emerald-500 font-bold mt-0.5">کل: {formatWithCommas(Math.round(p.totalAll))}</span>
                                          </div>
                                        ) : '—'}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                // 2. Summary & Audit comparison view
                <div className="space-y-6">
                  {/* Summary allocation table as requested */}
                  <div className="bg-slate-900/50 rounded-2xl border border-slate-850 p-6 space-y-4">
                    <div>
                      <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                        <Calculator className="h-4 w-4 text-rose-500" />
                        جدول خلاصه تسهیم کل و موازنه دفاتر مالی
                      </h3>
                      <p className="text-[10px] text-slate-400 mt-1">تطبیق سرجمع مبالغ ثبت‌شده در دفاتر حسابداری با مقادیر کل تسهیم‌شده روی بهای تمام‌شده کالاهای به فروش رفته</p>
                    </div>

                    <div className="overflow-x-auto border border-slate-850 rounded-xl overflow-hidden">
                      <table className="w-full text-xs text-right border-collapse">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-850">
                            <th className="py-3 px-4 font-bold text-slate-300">سرفصل تسهیم و توزیع هزینه</th>
                            <th className="py-3 px-4 font-bold text-slate-300 text-center">هزینه ثبت شده در سیستم (دفاتر)</th>
                            <th className="py-3 px-4 font-bold text-slate-300 text-center">جمع مبالغ تسهیم‌شده به کالاها</th>
                            <th className="py-3 px-4 font-bold text-slate-300 text-center">مغایرت توازن (اختلاف دفتر و تخصیص)</th>
                            <th className="py-3 px-4 font-bold text-slate-300 text-center">وضعیت انطباق</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850">
                          {/* Direct Labor row */}
                          <tr className="hover:bg-slate-850/10 transition-all font-mono text-slate-200">
                            <td className="py-3.5 px-4 font-bold text-right font-sans text-slate-100">حقوق و دستمزد مستقیم (دپارتمان‌ها)</td>
                            <td className="py-3.5 px-4 text-center">{formatWithCommas(Math.round(detailedAllocationData.summary.direct.booked))} ریال</td>
                            <td className="py-3.5 px-4 text-center text-emerald-400 font-bold">{formatWithCommas(Math.round(detailedAllocationData.summary.direct.allocated))} ریال</td>
                            <td className={`py-3.5 px-4 text-center font-bold ${Math.abs(detailedAllocationData.summary.direct.diff) < 1000 ? 'text-slate-400' : 'text-rose-400'}`}>
                              {formatWithCommas(Math.round(detailedAllocationData.summary.direct.diff))} ریال
                            </td>
                            <td className="py-3.5 px-4 text-center font-sans">
                              {Math.abs(detailedAllocationData.summary.direct.diff) < 1000 ? (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">سازگار و تراز</span>
                              ) : (
                                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold">دارای مغایرت</span>
                              )}
                            </td>
                          </tr>

                          {/* Shared Labor row */}
                          <tr className="hover:bg-slate-850/10 transition-all font-mono text-slate-200">
                            <td className="py-3.5 px-4 font-bold text-right font-sans text-slate-100">حقوق و دستمزد مشترک (پشتیبانی/اداری)</td>
                            <td className="py-3.5 px-4 text-center">{formatWithCommas(Math.round(detailedAllocationData.summary.shared.booked))} ریال</td>
                            <td className="py-3.5 px-4 text-center text-emerald-400 font-bold">{formatWithCommas(Math.round(detailedAllocationData.summary.shared.allocated))} ریال</td>
                            <td className={`py-3.5 px-4 text-center font-bold ${Math.abs(detailedAllocationData.summary.shared.diff) < 1000 ? 'text-slate-400' : 'text-rose-400'}`}>
                              {formatWithCommas(Math.round(detailedAllocationData.summary.shared.diff))} ریال
                            </td>
                            <td className="py-3.5 px-4 text-center font-sans">
                              {Math.abs(detailedAllocationData.summary.shared.diff) < 1000 ? (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">سازگار و تراز</span>
                              ) : (
                                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold">دارای مغایرت</span>
                              )}
                            </td>
                          </tr>

                          {/* Overhead row */}
                          <tr className="hover:bg-slate-850/10 transition-all font-mono text-slate-200">
                            <td className="py-3.5 px-4 font-bold text-right font-sans text-slate-100">هزینه‌های سربار تولید کارگاهی</td>
                            <td className="py-3.5 px-4 text-center">{formatWithCommas(Math.round(detailedAllocationData.summary.overhead.booked))} ریال</td>
                            <td className="py-3.5 px-4 text-center text-emerald-400 font-bold">{formatWithCommas(Math.round(detailedAllocationData.summary.overhead.allocated))} ریال</td>
                            <td className={`py-3.5 px-4 text-center font-bold ${Math.abs(detailedAllocationData.summary.overhead.diff) < 1000 ? 'text-slate-400' : 'text-rose-400'}`}>
                              {formatWithCommas(Math.round(detailedAllocationData.summary.overhead.diff))} ریال
                            </td>
                            <td className="py-3.5 px-4 text-center font-sans">
                              {Math.abs(detailedAllocationData.summary.overhead.diff) < 1000 ? (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-bold">سازگار و تراز</span>
                              ) : (
                                <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-bold">دارای مغایرت</span>
                              )}
                            </td>
                          </tr>

                          {/* Grand total row */}
                          <tr className="bg-slate-900/80 font-mono text-slate-100 font-black border-t-2 border-slate-850">
                            <td className="py-4 px-4 text-right font-sans text-white text-xs">جمع کل موازنه منابع و مخارج</td>
                            <td className="py-4 px-4 text-center text-rose-400 text-xs">{formatWithCommas(Math.round(detailedAllocationData.summary.totals.booked))} ریال</td>
                            <td className="py-4 px-4 text-center text-emerald-400 text-xs">{formatWithCommas(Math.round(detailedAllocationData.summary.totals.allocated))} ریال</td>
                            <td className={`py-4 px-4 text-center text-xs ${Math.abs(detailedAllocationData.summary.totals.diff) < 1000 ? 'text-slate-400' : 'text-rose-400'}`}>
                              {formatWithCommas(Math.round(detailedAllocationData.summary.totals.diff))} ریال
                            </td>
                            <td className="py-4 px-4 text-center font-sans text-xs">
                              {Math.abs(detailedAllocationData.summary.totals.diff) < 1000 ? (
                                <span className="bg-emerald-600 text-white shadow-md shadow-emerald-600/10 px-3 py-1 rounded-lg text-[10px] font-extrabold">موازنه ۱۰۰٪ تراز است</span>
                              ) : (
                                <span className="bg-rose-600 text-white shadow-md shadow-rose-600/10 px-3 py-1 rounded-lg text-[10px] font-extrabold">مغایرت عددی آشکار</span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Audit Guide and Explanation Card */}
                  <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-850 space-y-3">
                    <h4 className="text-xs font-black text-rose-400 flex items-center gap-1.5">
                      راهنمای تحلیل موازنه و ریشه‌یابی خطاها (Audit Guide):
                    </h4>
                    <ul className="text-[11px] text-slate-400 space-y-2 list-disc list-inside">
                      <li>
                        <strong className="text-slate-200">سازوکار موازنه بی نقص:</strong> موازنه دستمزد و سربار زمانی کاملاً صفر (تراز) می‌گردد که کل حجم فروش دپارتمان‌های فعال دارای مقدار باشد و فرآورده‌ای در حالت بدون فروش باقی نمانده باشد.
                      </li>
                      <li>
                        <strong className="text-slate-200">علت مغایرت جزئی در تسهیم دستمزد مستقیم:</strong> در صورتی که برای گروهی از محصولات، هیچ فروشی (فاکتور فروش) در دوره ثبت نشده باشد، هزینه تخصیص‌یافته به دپارتمان مربوطه موقتاً در دفاتر بدون تسهیم باقی می‌ماند تا بابت بهای موجودی‌های انتهای دوره (WIP یا انبار) ارزیابی گردد.
                      </li>
                      <li>
                        <strong className="text-slate-200">روش تسهیم زمان‌محور در بازه کارگاه:</strong> محصولاتی که دارای بازه زمانی کارگاهی معتبر در بخش تولید ثبت‌شده هستند، هزینه پرسنل را به طور واقعی بر پایه ساعات مشغول به‌کار جذب می‌کنند. مابقی محصولات با روش fallback وزن‌محور (حجمی) توزیع می‌گردد.
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="border-t border-slate-850 p-4 bg-slate-900/50 flex items-center justify-end">
              <button
                onClick={() => setShowAllocationTableModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                بستن پنجره گزارش
              </button>
            </div>
          </motion.div>
        </div>
      )}

      </div>

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
