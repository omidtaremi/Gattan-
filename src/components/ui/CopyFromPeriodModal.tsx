import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckSquare, Copy, Layers, Search, Square } from 'lucide-react';
import type { AppDatabase } from '../../types';
import {
  COPY_SECTION_META,
  type CopySectionKey,
  executeCopyFromPeriod,
  getCopyPreviewItems,
} from '../../utils/periodCopyEngine';
import { normalizePersianString, toPersianDigits } from '../../utils/persianUtils';
import { ERP_BUTTON_LABELS, ErpButton, UnifiedModal } from './UnifiedErpUi';
import { useErpFeedback } from './ToastContext';

export interface CopyFromPeriodModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  db: AppDatabase;
  targetPeriodId?: string;
  activePeriodId?: string;
  section?: CopySectionKey;
  sectionKey?: CopySectionKey;
  /** Optional list of selectable sections if a module groups multiple sub-sections */
  sections?: CopySectionKey[];
  onUpdateDb: (nextDb: AppDatabase) => void;
}

export const CopyFromPeriodModal: React.FC<CopyFromPeriodModalProps> = ({
  open: openProp,
  isOpen,
  onClose,
  db,
  targetPeriodId: targetPeriodIdProp,
  activePeriodId,
  section: sectionProp,
  sectionKey,
  sections,
  onUpdateDb,
}) => {
  const open = Boolean(openProp ?? isOpen);
  const targetPeriodId = targetPeriodIdProp ?? activePeriodId ?? '';
  const section: CopySectionKey = (sectionProp ?? sectionKey ?? (sections && sections[0]) ?? 'items') as CopySectionKey;

  const feedback = useErpFeedback();
  const [activeSection, setActiveSection] = useState<CopySectionKey>(section);
  const [sourcePeriodId, setSourcePeriodId] = useState<string>('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const availableSections = sections && sections.length > 0 ? sections : [section];
  const meta = COPY_SECTION_META[activeSection];

  const otherPeriods = useMemo(
    () => (db.periods || []).filter(p => p.id !== targetPeriodId),
    [db.periods, targetPeriodId]
  );

  const periodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of otherPeriods) {
      counts[p.id] = getCopyPreviewItems(db, activeSection, p.id).length;
    }
    return counts;
  }, [db, activeSection, otherPeriods]);

  // Reset active section when modal opens or section prop changes
  useEffect(() => {
    if (open) {
      setActiveSection(section);
      setSearch('');
      setMode('append');
    }
  }, [open, section]);

  // Auto-select the first other period that has records (or first available)
  useEffect(() => {
    if (!open) return;
    if (otherPeriods.length === 0) {
      setSourcePeriodId('');
      return;
    }
    const withData = otherPeriods.find(p => (periodCounts[p.id] || 0) > 0);
    setSourcePeriodId(prev => {
      if (prev && otherPeriods.some(p => p.id === prev) && (periodCounts[prev] || 0) > 0) {
        return prev;
      }
      return withData?.id || otherPeriods[0].id;
    });
  }, [open, activeSection, otherPeriods, periodCounts]);

  const previewItems = useMemo(() => {
    if (!sourcePeriodId) return [];
    return getCopyPreviewItems(db, activeSection, sourcePeriodId);
  }, [db, activeSection, sourcePeriodId]);

  const filteredItems = useMemo(() => {
    const q = normalizePersianString(search);
    if (!q) return previewItems;
    return previewItems.filter(item =>
      normalizePersianString(`${item.title} ${item.subtitle || ''} ${item.meta || ''}`).includes(q)
    );
  }, [previewItems, search]);

  // Select all items by default whenever sourcePeriodId or activeSection changes
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(previewItems.map(i => i.id)));
  }, [open, sourcePeriodId, activeSection, previewItems]);

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every(item => selectedIds.has(item.id));

  const toggleAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredItems.forEach(i => next.delete(i.id));
      } else {
        filteredItems.forEach(i => next.add(i.id));
      }
      return next;
    });
  };

  const toggleItem = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const targetPeriodName =
    (db.periods || []).find(p => p.id === targetPeriodId)?.name || targetPeriodId;
  const sourcePeriodName =
    (db.periods || []).find(p => p.id === sourcePeriodId)?.name || sourcePeriodId;

  const handleConfirmCopy = () => {
    if (!sourcePeriodId || selectedIds.size === 0) return;

    const result = executeCopyFromPeriod(db, {
      section: activeSection,
      sourcePeriodId,
      targetPeriodId,
      selectedIds: Array.from(selectedIds),
      mode,
    });

    onUpdateDb(result.updatedDb);

    const parts: string[] = [];
    if (result.copiedCount > 0) {
      parts.push(`${toPersianDigits(result.copiedCount)} مورد به دوره «${targetPeriodName}» کپی شد.`);
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
      feedback.success(parts.join(' '), `کپی ${meta.title}`);
    } else {
      feedback.info(parts.join(' '), `کپی ${meta.title}`);
    }
    onClose();
  };

  return (
    <UnifiedModal
      open={open}
      onClose={onClose}
      title={`${ERP_BUTTON_LABELS.copyFromPeriod} — ${meta.title}`}
      subtitle={`انتقال اطلاعات به دوره فعال: ${targetPeriodName}`}
      icon={<Copy className="w-5 h-5" />}
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <ErpButton variant="secondary" onClick={onClose}>
            {ERP_BUTTON_LABELS.cancel}
          </ErpButton>
          <ErpButton
            variant={mode === 'replace' ? 'danger' : 'primary'}
            onClick={handleConfirmCopy}
            disabled={!sourcePeriodId || selectedIds.size === 0}
            icon={<Copy className="w-4 h-4" />}
          >
            {mode === 'replace'
              ? `جایگزینی (${toPersianDigits(selectedIds.size)} مورد)`
              : `کپی ${toPersianDigits(selectedIds.size)} مورد`}
          </ErpButton>
        </>
      }
    >
      {otherPeriods.length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Layers className="w-8 h-8 text-slate-400 dark:text-zinc-500 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
            دوره مالی دیگری برای کپی وجود ندارد
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            برای استفاده از قابلیت کپی از دوره، باید حداقل دو دوره مالی در سیستم تعریف شده باشد.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Optional sub-section switcher */}
          {availableSections.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                انتخاب زیربخش
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableSections.map(secKey => {
                  const secMeta = COPY_SECTION_META[secKey];
                  const isActive = secKey === activeSection;
                  return (
                    <button
                      key={secKey}
                      type="button"
                      onClick={() => setActiveSection(secKey)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-zinc-950 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {secMeta.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Source period & Copy mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                دوره مالی مبدا
              </label>
              <select
                value={sourcePeriodId}
                onChange={e => setSourcePeriodId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs sm:text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              >
                {otherPeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({toPersianDigits(periodCounts[p.id] || 0)} مورد)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 mb-1.5">
                نحوه انتقال به دوره فعلی
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setMode('append')}
                  className={`h-8 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    mode === 'append'
                      ? 'bg-white dark:bg-zinc-800 text-emerald-700 dark:text-emerald-400 font-semibold shadow-xs border border-slate-200 dark:border-zinc-700'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  افزودن (بدون تکرار)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('replace')}
                  className={`h-8 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    mode === 'replace'
                      ? 'bg-rose-600 text-white font-semibold shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                  }`}
                >
                  جایگزینی کامل
                </button>
              </div>
            </div>
          </div>

          {mode === 'replace' && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50/70 dark:bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                در حالت جایگزینی کامل، تمام رکوردهای فعلی «{meta.title}» در دوره «{targetPeriodName}» پاک شده و موارد انتخاب‌شده از دوره «{sourcePeriodName}» جایگزین می‌شوند.
              </span>
            </div>
          )}

          {/* Selection toolbar + List */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="جستجو در موارد دوره مبدا..."
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
                  ? `در دوره «${sourcePeriodName}» هیچ رکوردی برای «${meta.title}» ثبت نشده است.`
                  : 'موردی با این عبارت جستجو یافت نشد.'}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/80">
                {filteredItems.map(item => {
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
        </div>
      )}
    </UnifiedModal>
  );
};

export default CopyFromPeriodModal;

