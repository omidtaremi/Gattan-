import React, { useRef } from 'react';
import {
  Copy,
  Download,
  Edit2,
  Eye,
  FileSpreadsheet,
  Inbox,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

/**
 * Canonical Persian UI copy dictionary across all ERP modules.
 * Use these constants everywhere so similar operations always carry identical wording.
 */
export const ERP_BUTTON_LABELS = {
  add: 'افزودن',
  save: 'ذخیره',
  edit: 'ویرایش',
  delete: 'حذف',
  cancel: 'انصراف',
  close: 'بستن',
  searchPlaceholder: 'جستجو...',
  clearFilters: 'پاک‌سازی فیلتر',
  copyFromPeriod: 'کپی از دوره',
  importExcel: 'ورود از اکسل',
  exportExcel: 'خروجی اکسل',
  excelTemplate: 'فایل نمونه',
  print: 'چاپ',
  details: 'جزئیات',
  refresh: 'بروزرسانی',
  actionsColumn: 'عملیات',
} as const;

export type ErpButtonVariant =
  | 'primary'
  | 'secondary'
  | 'neutral'
  | 'danger'
  | 'danger-subtle'
  | 'ghost';

export type ErpButtonSize = 'sm' | 'md';

export type ErpIconProp = React.ReactNode | React.ComponentType<{ className?: string }>;

function renderErpIcon(icon: ErpIconProp, defaultClassName = 'w-4 h-4'): React.ReactNode {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  if (typeof icon === 'function') {
    const Comp = icon as React.ComponentType<{ className?: string }>;
    return <Comp className={defaultClassName} />;
  }
  if (typeof icon === 'object' && '$$typeof' in (icon as Record<string, unknown>)) {
    const Comp = icon as unknown as React.ComponentType<{ className?: string }>;
    return <Comp className={defaultClassName} />;
  }
  return icon as React.ReactNode;
}

export interface ErpButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ErpButtonVariant;
  size?: ErpButtonSize;
  icon?: ErpIconProp;
  children?: React.ReactNode;
}

const NEUTRAL_BUTTON_CLASSES =
  'bg-white dark:bg-slate-950/90 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800';

const VARIANT_CLASSES: Record<ErpButtonVariant, string> = {
  primary:
    'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white border border-rose-500/80 shadow-md shadow-rose-600/20',
  secondary: NEUTRAL_BUTTON_CLASSES,
  neutral: NEUTRAL_BUTTON_CLASSES,
  danger:
    'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white border border-rose-600 shadow-xs',
  'danger-subtle':
    'bg-transparent hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-500/25',
  ghost:
    'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-transparent',
};

const SIZE_CLASSES: Record<ErpButtonSize, string> = {
  sm: 'min-h-[34px] py-1.5 px-2.5 text-xs gap-1.5 leading-tight',
  md: 'min-h-[38px] py-2 px-3.5 text-xs sm:text-[13px] gap-1.5 leading-tight',
};

export const ErpButton: React.FC<ErpButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center rounded-xl font-bold transition-all whitespace-nowrap shrink-0 disabled:opacity-45 disabled:pointer-events-none cursor-pointer ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
    {...rest}
  >
    {icon && <span className="inline-flex items-center shrink-0">{renderErpIcon(icon, 'w-4 h-4')}</span>}
    {children}
  </button>
);

/* -------------------------------------------------------------------------- */
/* Layer 1: ModuleHeader                                                      */
/* -------------------------------------------------------------------------- */

export interface ModuleHeaderProps {
  icon?: ErpIconProp;
  title: string;
  subtitle?: string;
  periodName?: string;
  recordCount?: number;
  recordLabel?: string;
  metaItems?: string[];
  rightExtra?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const ModuleHeader: React.FC<ModuleHeaderProps> = ({
  icon,
  title,
  subtitle,
  periodName,
  recordCount,
  recordLabel = 'ردیف',
  metaItems,
  rightExtra,
  actions,
  className = '',
}) => {
  const computedMeta: string[] = [];
  if (typeof recordCount === 'number') {
    computedMeta.push(`${recordCount.toLocaleString('fa-IR')} ${recordLabel}`);
  }
  if (periodName) {
    computedMeta.push(periodName);
  }
  if (metaItems?.length) computedMeta.push(...metaItems.filter(Boolean));
  const extraContent = rightExtra || actions;

  return (
    <header
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3.5 border-b border-slate-200 dark:border-slate-800/90 ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="w-10 h-10 rounded-xl border border-slate-200 dark:border-rose-500/25 bg-slate-50 dark:bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
            {renderErpIcon(icon, 'w-5 h-5')}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {(computedMeta.length > 0 || extraContent) && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {computedMeta.length > 0 && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-bold tabular-nums px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800">
              {computedMeta.join(' · ')}
            </div>
          )}
          {rightExtra}
          {actions}
        </div>
      )}
    </header>
  );
};

/* -------------------------------------------------------------------------- */
/* Layer 2: ModulePrimaryTabs (Level 1 tabs — bottom-bordered underline)      */
/* -------------------------------------------------------------------------- */

export interface TabOption<T extends string = string> {
  id: T;
  label: string;
  icon?: ErpIconProp;
  count?: number;
  badge?: string;
  disabled?: boolean;
}

export interface ModulePrimaryTabsProps<T extends string = string> {
  tabs: TabOption<T>[];
  activeTab?: T;
  activeId?: T;
  onChange: (tab: T) => void;
  className?: string;
}

export function ModulePrimaryTabs<T extends string = string>({
  tabs,
  activeTab,
  activeId,
  onChange,
  className = '',
}: ModulePrimaryTabsProps<T>) {
  const currentTab = activeTab ?? activeId;
  return (
    <nav
      aria-label="برگه‌های بخش"
      className={`border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar ${className}`}
    >
      <div className="flex items-center gap-1 min-w-max">
        {tabs.map(tab => {
          const isActive = tab.id === currentTab;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={`relative inline-flex items-center gap-2 min-h-[44px] sm:min-h-[42px] px-3.5 text-xs sm:text-[13px] font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40 ${
                isActive
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.icon && (
                <span
                  className={
                    isActive
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }
                >
                  {renderErpIcon(tab.icon, 'w-4 h-4')}
                </span>
              )}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md ${
                    isActive
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {tab.count.toLocaleString('fa-IR')}
                </span>
              )}
              {tab.badge && (
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  · {tab.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-1.5 bottom-0 h-[2.5px] rounded-full bg-rose-600 dark:bg-rose-500" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Layer 3: ModuleSubTabs (Level 2 sub-tabs — compact segmented track)        */
/* -------------------------------------------------------------------------- */

export interface ModuleSubTabsProps<T extends string = string> {
  tabs: TabOption<T>[];
  activeTab?: T;
  activeId?: T;
  onChange: (tab: T) => void;
  className?: string;
}

export function ModuleSubTabs<T extends string = string>({
  tabs,
  activeTab,
  activeId,
  onChange,
  className = '',
}: ModuleSubTabsProps<T>) {
  const currentTab = activeTab ?? activeId;
  return (
    <div className={`overflow-x-auto no-scrollbar ${className}`}>
      <div className="inline-flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-max">
        {tabs.map(tab => {
          const isActive = tab.id === currentTab;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={`inline-flex items-center gap-1.5 min-h-[36px] sm:min-h-[34px] px-3.5 rounded-lg text-xs font-extrabold whitespace-nowrap shrink-0 transition-all cursor-pointer disabled:opacity-40 ${
                isActive
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20 border border-rose-500/80'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 border border-transparent'
              }`}
            >
              {tab.icon && <span className="shrink-0">{renderErpIcon(tab.icon, 'w-3.5 h-3.5')}</span>}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tab.count.toLocaleString('fa-IR')}
                </span>
              )}
              {tab.badge && (
                <span className="text-[10px] font-bold text-amber-500 dark:text-amber-300">
                  · {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Standardized Search Input                                                  */
/* -------------------------------------------------------------------------- */

export interface UnifiedSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const UnifiedSearchInput: React.FC<UnifiedSearchInputProps> = ({
  value,
  onChange,
  placeholder = ERP_BUTTON_LABELS.searchPlaceholder,
  className = '',
}) => (
  <div className={`relative flex-1 min-w-[200px] w-full sm:max-w-sm ${className}`}>
    <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 sm:h-9 pr-9 pl-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 transition-colors font-medium"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        aria-label="پاک کردن جستجو"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Layer 4: UnifiedToolbar                                                    */
/* RTL Right: Search + Filters + conditional Clear Filters                    */
/* RTL Left:  [Copy From Period] [Template] [Import] [Export] [Print] | [+Add]*/
/* -------------------------------------------------------------------------- */

export interface UnifiedToolbarProps {
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onResetFilters?: () => void;

  // Standardized action slots (rendered in exact canonical order)
  onCopyFromPeriod?: () => void;
  copyFromPeriodLabel?: string;
  onDownloadTemplate?: () => void;
  onImportExcel?: (file: File) => void;
  onImportExcelClick?: () => void;
  importAccept?: string;
  onExportExcel?: () => void;
  onPrint?: () => void;
  onRefresh?: () => void;
  extraSecondaryActions?: React.ReactNode;

  onAdd?: () => void;
  addLabel?: string;
  addIcon?: React.ReactNode;
  addDisabled?: boolean;
  primaryActionSlot?: React.ReactNode;

  className?: string;
}

export const UnifiedToolbar: React.FC<UnifiedToolbarProps> = ({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  hasActiveFilters,
  onClearFilters,
  onResetFilters,
  onCopyFromPeriod,
  copyFromPeriodLabel = ERP_BUTTON_LABELS.copyFromPeriod,
  onDownloadTemplate,
  onImportExcel,
  onImportExcelClick,
  importAccept = '.xlsx,.xls,.csv',
  onExportExcel,
  onPrint,
  onRefresh,
  extraSecondaryActions,
  onAdd,
  addLabel = ERP_BUTTON_LABELS.add,
  addIcon,
  addDisabled,
  primaryActionSlot,
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clearFiltersHandler = onClearFilters ?? onResetFilters;

  const hasSearchOrFilters = Boolean(onSearchChange || filters || (hasActiveFilters && clearFiltersHandler));
  const hasSecondaryActions = Boolean(
    onCopyFromPeriod ||
      onDownloadTemplate ||
      onImportExcel ||
      onImportExcelClick ||
      onExportExcel ||
      onPrint ||
      onRefresh ||
      extraSecondaryActions
  );
  const hasPrimary = Boolean(onAdd || primaryActionSlot);

  return (
    <div
      className={`flex flex-col xl:flex-row xl:flex-wrap xl:items-center justify-between gap-2.5 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 shadow-sm ${className}`}
    >
      {/* Right side (RTL start): Search & Filters */}
      {hasSearchOrFilters ? (
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
          {onSearchChange && (
            <UnifiedSearchInput
              value={searchValue ?? ''}
              onChange={onSearchChange}
              placeholder={searchPlaceholder}
            />
          )}
          {filters}
          {hasActiveFilters && clearFiltersHandler && (
            <ErpButton
              variant="ghost"
              size="sm"
              onClick={clearFiltersHandler}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {ERP_BUTTON_LABELS.clearFilters}
            </ErpButton>
          )}
        </div>
      ) : (
        <div className="hidden xl:block" />
      )}

      {/* Left side (RTL end): Fixed canonical order of utility buttons + primary CTA */}
      {(hasSecondaryActions || hasPrimary) && (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 justify-start xl:justify-end">
          {onCopyFromPeriod && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onCopyFromPeriod}
              icon={<Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
            >
              {copyFromPeriodLabel}
            </ErpButton>
          )}

          {onDownloadTemplate && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onDownloadTemplate}
              icon={<FileSpreadsheet className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />}
            >
              {ERP_BUTTON_LABELS.excelTemplate}
            </ErpButton>
          )}

          {(onImportExcel || onImportExcelClick) && (
            <>
              {onImportExcel && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={importAccept}
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onImportExcel(file);
                      e.target.value = '';
                    }
                  }}
                />
              )}
              <ErpButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (onImportExcelClick) onImportExcelClick();
                  else fileInputRef.current?.click();
                }}
                icon={<Upload className="w-3.5 h-3.5 text-cyan-500 dark:text-cyan-400" />}
              >
                {ERP_BUTTON_LABELS.importExcel}
              </ErpButton>
            </>
          )}

          {onExportExcel && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onExportExcel}
              icon={<Download className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />}
            >
              {ERP_BUTTON_LABELS.exportExcel}
            </ErpButton>
          )}

          {onPrint && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onPrint}
              icon={<Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />}
            >
              {ERP_BUTTON_LABELS.print}
            </ErpButton>
          )}

          {onRefresh && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              icon={<RefreshCw className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />}
            >
              {ERP_BUTTON_LABELS.refresh}
            </ErpButton>
          )}

          {extraSecondaryActions}

          {hasSecondaryActions && hasPrimary && (
            <span className="hidden xl:inline-block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          )}

          {primaryActionSlot}

          {onAdd && (
            <ErpButton
              variant="primary"
              size="sm"
              onClick={onAdd}
              disabled={addDisabled}
              icon={addIcon ?? <Plus className="w-4 h-4" />}
            >
              {addLabel}
            </ErpButton>
          )}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* UnifiedFilterBar (Matches CustomerManagement 4-column filter bar)          */
/* -------------------------------------------------------------------------- */

export const UnifiedFilterBar: React.FC<{
  children: React.ReactNode;
  columnsClass?: string;
  className?: string;
}> = ({ children, columnsClass = 'grid-cols-2 sm:grid-cols-4', className = '' }) => (
  <div className={`bg-white dark:bg-slate-900/90 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 ${className}`}>
    <div className={`grid ${columnsClass} gap-2.5`}>{children}</div>
  </div>
);

export const UNIFIED_FILTER_SELECT_CLASS =
  'w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs font-bold focus:outline-none focus:border-rose-500 cursor-pointer';

export const UNIFIED_FILTER_LABEL_CLASS =
  'block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1';

/* -------------------------------------------------------------------------- */
/* RowActions (Leftmost table column: [Details/Print] [Edit] [Delete])        */
/* -------------------------------------------------------------------------- */

export interface RowActionsProps {
  onDetails?: () => void;
  detailsTitle?: string;
  onPrint?: () => void;
  printTitle?: string;
  onEdit?: () => void;
  editTitle?: string;
  onDelete?: () => void;
  deleteTitle?: string;
  extra?: React.ReactNode;
}

export const RowActions: React.FC<RowActionsProps> = ({
  onDetails,
  detailsTitle = ERP_BUTTON_LABELS.details,
  onPrint,
  printTitle = ERP_BUTTON_LABELS.print,
  onEdit,
  editTitle = ERP_BUTTON_LABELS.edit,
  onDelete,
  deleteTitle = ERP_BUTTON_LABELS.delete,
  extra,
}) => (
  <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
    {extra}
    {onDetails && (
      <button
        type="button"
        onClick={onDetails}
        title={detailsTitle}
        aria-label={detailsTitle}
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <Eye className="w-4 h-4" />
      </button>
    )}
    {onPrint && (
      <button
        type="button"
        onClick={onPrint}
        title={printTitle}
        aria-label={printTitle}
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <Printer className="w-4 h-4" />
      </button>
    )}
    {onEdit && (
      <button
        type="button"
        onClick={onEdit}
        title={editTitle}
        aria-label={editTitle}
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <Edit2 className="w-4 h-4" />
      </button>
    )}
    {onDelete && (
      <button
        type="button"
        onClick={onDelete}
        title={deleteTitle}
        aria-label={deleteTitle}
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* EmptyPeriodState (For blank periods or empty filtered views)               */
/* -------------------------------------------------------------------------- */

export interface EmptyPeriodStateProps {
  title?: string;
  description?: string;
  onAdd?: () => void;
  addLabel?: string;
  onCopyFromPeriod?: () => void;
  icon?: ErpIconProp;
  className?: string;
}

export const EmptyPeriodState: React.FC<EmptyPeriodStateProps> = ({
  title = 'در این دوره مالی هنوز اطلاعاتی ثبت نشده است',
  description = 'می‌توانید رکورد جدید ثبت کنید یا اطلاعات دلخواه خود را از دوره‌های مالی قبلی کپی کنید.',
  onAdd,
  addLabel = ERP_BUTTON_LABELS.add,
  onCopyFromPeriod,
  icon,
  className = '',
}) => (
  <div
    className={`flex flex-col items-center justify-center text-center py-12 px-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 ${className}`}
  >
    <div className="w-11 h-11 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
      {icon ? renderErpIcon(icon, 'w-5 h-5') : <Inbox className="w-5 h-5" />}
    </div>
    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
    {description && (
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md leading-5">
        {description}
      </p>
    )}
    {(onAdd || onCopyFromPeriod) && (
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
        {onCopyFromPeriod && (
          <ErpButton
            variant="secondary"
            size="md"
            onClick={onCopyFromPeriod}
            icon={<Copy className="w-4 h-4" />}
          >
            {ERP_BUTTON_LABELS.copyFromPeriod}
          </ErpButton>
        )}
        {onAdd && (
          <ErpButton
            variant="primary"
            size="md"
            onClick={onAdd}
            icon={<Plus className="w-4 h-4" />}
          >
            {addLabel}
          </ErpButton>
        )}
      </div>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* UnifiedModal                                                               */
/* -------------------------------------------------------------------------- */

export interface UnifiedModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ErpIconProp;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  cancelLabel?: string;
}

export const UnifiedModal: React.FC<UnifiedModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  maxWidthClass = 'max-w-2xl',
  children,
  footer,
  onSave,
  saveLabel = ERP_BUTTON_LABELS.save,
  saveDisabled,
  cancelLabel = ERP_BUTTON_LABELS.cancel,
}) => {
  if (!open) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-rose-600 dark:text-rose-400 shrink-0">{renderErpIcon(icon, 'w-5 h-5')}</span>}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100 truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={ERP_BUTTON_LABELS.close}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {(footer || onSave) && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 shrink-0">
            {footer ?? (
              <>
                <ErpButton variant="secondary" onClick={onClose}>
                  {cancelLabel}
                </ErpButton>
                <ErpButton
                  variant="primary"
                  onClick={onSave}
                  disabled={saveDisabled}
                  icon={<Save className="w-4 h-4" />}
                >
                  {saveLabel}
                </ErpButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* StatusText & KpiStrip (CustomerManagement unified KPI card architecture)   */
/* -------------------------------------------------------------------------- */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

export const StatusText: React.FC<{
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'neutral', children, className = '' }) => {
  const dotColors: Record<StatusTone, string> = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-cyan-500',
    neutral: 'bg-slate-400 dark:bg-slate-500',
  };
  const textColors: Record<StatusTone, string> = {
    success: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
    danger: 'text-rose-700 dark:text-rose-400',
    info: 'text-cyan-700 dark:text-cyan-400',
    neutral: 'text-slate-600 dark:text-slate-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap ${textColors[tone]} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[tone]}`} />
      <span>{children}</span>
    </span>
  );
};

export interface KpiItem {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  valueClassName?: string;
}

export const KpiStrip: React.FC<{ items: KpiItem[]; className?: string }> = ({
  items,
  className = '',
}) => {
  const labelTone: Record<NonNullable<KpiItem['tone']>, string> = {
    default: 'text-slate-500 dark:text-slate-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    danger: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
    info: 'text-cyan-600 dark:text-cyan-400',
  };
  const valueTone: Record<NonNullable<KpiItem['tone']>, string> = {
    default: 'text-slate-900 dark:text-slate-100',
    success: 'text-emerald-700 dark:text-emerald-400',
    danger: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
    info: 'text-cyan-600 dark:text-cyan-400',
  };

  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5 ${className}`}
    >
      {items.map((item, idx) => {
        const tone = item.tone ?? 'default';
        const displayValue = typeof item.value === 'number' ? item.value.toLocaleString('fa-IR') : item.value;
        return (
          <div
            key={`${item.label}-${idx}`}
            className="bg-slate-50 dark:bg-slate-950/70 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800/80 min-w-0"
          >
            <span className={`text-[11px] font-bold block mb-1 truncate ${labelTone[tone]}`}>
              {item.label}
            </span>
            <div className="flex items-baseline justify-between gap-1.5 min-w-0">
              <span
                title={String(displayValue)}
                className={`font-black font-mono tabular-nums min-w-0 ${item.valueClassName ?? 'text-lg sm:text-xl truncate'} ${valueTone[tone]}`}
              >
                {displayValue}
              </span>
              {item.sublabel && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 truncate">
                  {item.sublabel}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

