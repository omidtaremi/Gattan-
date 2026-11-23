/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckSquare,
  Copy,
  RefreshCw,
  Search,
  Square,
} from 'lucide-react';
import type { AppDatabase, BranchDefinition } from '../../types';
import {
  COPY_SECTION_META,
  type CopySectionKey,
  executeCopyFromAnotherBranch,
  getCopyPreviewItems,
} from '../../utils/periodCopyEngine';
import { normalizePersianString, toPersianDigits } from '../../utils/persianUtils';
import { ERP_BUTTON_LABELS, ErpButton, UnifiedModal } from './UnifiedErpUi';
import { useErpFeedback } from './ToastContext';
import { fetchBranchCopySource } from '../../services/postgresSyncService';
import { loadDatabaseAsync, sanitizeAndMergeDatabase } from '../../db';

export interface CopyFromBranchModalProps {
  open: boolean;
  onClose: () => void;
  branches: BranchDefinition[];
  activeBranchId: string;
  targetDb: AppDatabase;
  targetPeriodId: string;
  serverMode: 'postgres' | 'local';
  onUpdateDb: (nextDb: AppDatabase) => void;
  initialSection?: CopySectionKey;
}

const SECTION_GROUPS: Array<{ label: string; keys: CopySectionKey[] }> = [
  {
    label: 'تعاریف پایه و کاتالوگ (پرکاربرد برای راه‌اندازی شعبه جدید)',
    keys: [
      'departments',
      'itemCategories',
      'unitsOfMeasurement',
      'warehouses',
      'items',
      'productCategories',
      'packagingTypes',
      'products',
      'productFormulas',
      'unitConversions',
      'suppliers',
      'customerCategories',
      'customers',
    ],
  },
  {
    label: 'تنظیمات بارکد، ترازو و برنامه‌ریزی تولید',
    keys: [
      'barcodeSettings',
      'dibalScales',
      'dibalPLUs',
      'productionPlanningSettings',
      'dailyProductionSegments',
    ],
  },
  {
    label: 'خزانه‌داری و بانک',
    keys: ['bankAccounts', 'cashDrawers', 'posTerminals', 'cashiers'],
  },
  {
    label: 'منابع انسانی و قوانین حقوق',
    keys: [
      'personnelCategories',
      'personnel',
      'shifts',
      'productionSections',
      'salaryBaseRates',
      'payrollCalculationRules',
      'monthlyWorkdaySettings',
      'officialHolidays',
      'taxExemptions',
      'taxBrackets',
      'seniorityRateRules',
    ],
  },
];

export const CopyFromBranchModal: React.FC<CopyFromBranchModalProps> = ({
  open,
  onClose,
  branches,
  activeBranchId,
  targetDb,
  targetPeriodId,
  serverMode,
  onUpdateDb,
  initialSection = 'products',
}) => {
  const feedback = useErpFeedback();

  const otherBranches = useMemo(
    () => branches.filter((b) => b.id !== activeBranchId && b.isActive !== false),
    [branches, activeBranchId]
  );

  const activeBranchName =
    branches.find((b) => b.id === activeBranchId)?.name || activeBranchId;
  const targetPeriodName =
    (targetDb.periods || []).find((p) => p.id === targetPeriodId)?.name || targetPeriodId;

  const [sourceBranchId, setSourceBranchId] = useState<string>('');
  const [sourceDb, setSourceDb] = useState<AppDatabase | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState('');

  const [sourcePeriodId, setSourcePeriodId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<CopySectionKey>(initialSection);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Initialize source branch when modal opens
  useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection);
    setMode('append');
    setSearch('');
    setSourceError('');
    if (otherBranches.length > 0) {
      setSourceBranchId((prev) =>
        prev && otherBranches.some((b) => b.id === prev) ? prev : otherBranches[0].id
      );
    } else {
      setSourceBranchId('');
      setSourceDb(null);
    }
  }, [open, otherBranches, initialSection]);

  // Load source branch database whenever sourceBranchId changes
  useEffect(() => {
    if (!open || !sourceBranchId) {
      setSourceDb(null);
      return;
    }

    let cancelled = false;
    const loadSource = async () => {
      setIsLoadingSource(true);
      setSourceError('');
      try {
        let loaded: AppDatabase | null = null;
        if (serverMode === 'postgres') {
          const res = await fetchBranchCopySource(sourceBranchId);
          if (!res.ok) {
            throw new Error(res.error || 'خطا در دریافت داده‌های شعبه مبدا');
          }
          loaded = sanitizeAndMergeDatabase(res.collections || {});
        } else {
          loaded = await loadDatabaseAsync(sourceBranchId);
        }

        if (cancelled) return;
        setSourceDb(loaded);
        const periods = loaded.periods || [];
        const activeP = periods.find((p) => p.isActive) || periods[0];
        setSourcePeriodId(activeP?.id || '');
      } catch (err: any) {
        if (!cancelled) {
          setSourceDb(null);
          setSourceError(err?.message || 'خطا در خواندن اطلاعات شعبه مبدا');
        }
      } finally {
        if (!cancelled) setIsLoadingSource(false);
      }
    };

    loadSource();
    return () => {
      cancelled = true;
    };
  }, [open, sourceBranchId, serverMode]);

  const sourcePeriods = useMemo(() => sourceDb?.periods || [], [sourceDb]);
  const meta = COPY_SECTION_META[activeSection];

  const previewItems = useMemo(() => {
    if (!sourceDb || !sourcePeriodId) return [];
    return getCopyPreviewItems(sourceDb, activeSection, sourcePeriodId);
  }, [sourceDb, activeSection, sourcePeriodId]);

  const filteredItems = useMemo(() => {
    const q = normalizePersianString(search);
    if (!q) return previewItems;
    return previewItems.filter((item) =>
      normalizePersianString(`${item.title} ${item.subtitle || ''} ${item.meta || ''}`).includes(q)
    );
  }, [previewItems, search]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(previewItems.map((i) => i.id)));
  }, [open, sourceBranchId, sourcePeriodId, activeSection, previewItems]);

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredItems.forEach((i) => next.delete(i.id));
      } else {
        filteredItems.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sourceBranchName =
    branches.find((b) => b.id === sourceBranchId)?.name || sourceBranchId;

  const handleConfirmCopy = () => {
    if (!sourceDb || !sourcePeriodId || !targetPeriodId || selectedIds.size === 0) return;

    const result = executeCopyFromAnotherBranch(sourceDb, targetDb, {
      section: activeSection,
      sourcePeriodId,
      targetPeriodId,
      selectedIds: Array.from(selectedIds),
      mode,
    });

    onUpdateDb(result.updatedDb);

    const parts: string[] = [];
    if (result.copiedCount > 0) {
      parts.push(
        `${toPersianDigits(result.copiedCount)} مورد از «${sourceBranchName}» به «${activeBranchName}» کپی شد.`
      );
    } else {
      parts.push('مورد جدیدی برای کپی وجود نداشت (همه موارد انتخابی تکراری بودند).');
    }
    if (result.skippedCount > 0) {
      parts.push(`${toPersianDigits(result.skippedCount)} مورد تکراری رد شد.`);
    }
    if (result.autoCreatedDeps.length > 0) {
      parts.push(`وابستگی‌های ایجادشده: ${result.autoCreatedDeps.join('، ')}`);
    }

    if (result.copiedCount > 0) {
      feedback.success(parts.join(' '), `کپی ${meta.title} از شعبه دیگر`);
    } else {
      feedback.info(parts.join(' '), `کپی ${meta.title}`);
    }
    onClose();
  };

  return (
    <UnifiedModal
      open={open}
      onClose={onClose}
      title="کپی اطلاعات از شعبه دیگر"
      subtitle={`مقصد: ${activeBranchName} — ${targetPeriodName}`}
      icon={<Building2 className="w-5 h-5" />}
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <ErpButton variant="secondary" onClick={onClose}>
            {ERP_BUTTON_LABELS.cancel}
          </ErpButton>
          <ErpButton
            variant={mode === 'replace' ? 'danger' : 'primary'}
            onClick={handleConfirmCopy}
            disabled={isLoadingSource || !sourceDb || !sourcePeriodId || selectedIds.size === 0}
            icon={<Copy className="w-4 h-4" />}
          >
            {mode === 'replace'
              ? `جایگزینی (${toPersianDigits(selectedIds.size)} مورد)`
              : `کپی ${toPersianDigits(selectedIds.size)} مورد به شعبه فعلی`}
          </ErpButton>
        </>
      }
    >
      {otherBranches.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Building2 className="w-8 h-8 text-slate-400 dark:text-zinc-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
            شعبه دیگری برای کپی در دسترس نیست
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            برای انتقال تعاریف بین شعبه‌ها باید حداقل به دو شعبه فعال دسترسی داشته باشید.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Source Branch, Source Period, Section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                شعبه مبدا
              </label>
              <select
                value={sourceBranchId}
                onChange={(e) => setSourceBranchId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs sm:text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                {otherBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                دوره مالی مبدا
              </label>
              <select
                value={sourcePeriodId}
                onChange={(e) => setSourcePeriodId(e.target.value)}
                disabled={isLoadingSource || sourcePeriods.length === 0}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs sm:text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
              >
                {sourcePeriods.length === 0 ? (
                  <option value="">دوره‌ای یافت نشد</option>
                ) : (
                  sourcePeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                بخش مورد نظر برای کپی
              </label>
              <select
                value={activeSection}
                onChange={(e) => setActiveSection(e.target.value as CopySectionKey)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs sm:text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                {SECTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.keys.map((secKey) => (
                      <option key={secKey} value={secKey}>
                        {COPY_SECTION_META[secKey].title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Copy Mode */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800">
            <div className="text-xs text-slate-600 dark:text-zinc-400">
              <span className="font-semibold text-slate-800 dark:text-zinc-200">{meta.title}: </span>
              {meta.description}
            </div>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shrink-0">
              <button
                type="button"
                onClick={() => setMode('append')}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'append'
                    ? 'bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-400 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400'
                }`}
              >
                افزودن (بدون تکرار)
              </button>
              <button
                type="button"
                onClick={() => setMode('replace')}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'replace'
                    ? 'bg-rose-600 text-white font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400'
                }`}
              >
                جایگزینی کامل
              </button>
            </div>
          </div>

          {mode === 'replace' && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                در حالت جایگزینی کامل، تمام رکوردهای فعلی «{meta.title}» در دوره «{targetPeriodName}» از «{activeBranchName}» حذف شده و موارد انتخاب‌شده جایگزین می‌شوند.
              </span>
            </div>
          )}

          {sourceError && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{sourceError}</span>
            </div>
          )}

          {isLoadingSource ? (
            <div className="py-10 text-center flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
              <RefreshCw className="w-5 h-5 animate-spin text-emerald-600" />
              <span>در حال بارگذاری اطلاعات از {sourceBranchName}...</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="جستجو در موارد شعبه مبدا..."
                    className="w-full h-9 pr-9 pl-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAllFiltered}
                    disabled={filteredItems.length === 0}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 text-xs font-medium text-slate-700 dark:text-zinc-200 disabled:opacity-40 cursor-pointer"
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>{allFilteredSelected ? 'لغو انتخاب همه' : 'انتخاب همه'}</span>
                  </button>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
                    {toPersianDigits(selectedIds.size)} از {toPersianDigits(previewItems.length)}
                  </span>
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="py-8 text-center rounded-xl border border-dashed border-slate-200 dark:border-zinc-800 text-xs text-slate-500 dark:text-zinc-400">
                  {previewItems.length === 0
                    ? `در شعبه «${sourceBranchName}» رکوردی برای «${meta.title}» در این دوره ثبت نشده است.`
                    : 'موردی با این عبارت جستجو یافت نشد.'}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/80">
                  {filteredItems.map((item) => {
                    const checked = selectedIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-right transition-colors cursor-pointer ${
                          checked
                            ? 'bg-emerald-50/60 dark:bg-emerald-500/10'
                            : 'bg-white dark:bg-zinc-900/40 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              checked
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-950'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3" />}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-zinc-100 truncate">
                              {item.title}
                            </div>
                            {item.subtitle && (
                              <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                        {item.meta && (
                          <span className="text-[11px] text-slate-500 dark:text-zinc-400 tabular-nums shrink-0">
                            {item.meta}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </UnifiedModal>
  );
};

export default CopyFromBranchModal;
