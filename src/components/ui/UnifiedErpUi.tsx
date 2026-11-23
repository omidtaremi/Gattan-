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
  'bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700';

const VARIANT_CLASSES: Record<ErpButtonVariant, string> = {
  primary:
    'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white border border-emerald-600 shadow-xs',
  secondary: NEUTRAL_BUTTON_CLASSES,
  neutral: NEUTRAL_BUTTON_CLASSES,
  danger:
    'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white border border-rose-600 shadow-xs',
  'danger-subtle':
    'bg-transparent hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-500/25',
  ghost:
    'bg-transparent hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 border border-transparent',
};

const SIZE_CLASSES: Record<ErpButtonSize, string> = {
  sm: 'h-9 sm:h-8 px-2.5 text-xs gap-1.5',
  md: 'h-10 sm:h-9 px-3.5 text-xs sm:text-[13px] gap-1.5',
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
    className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:pointer-events-none cursor-pointer ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
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
  if (metaItems?.length) computedMeta.push(...metaItems.filter(Boolean));
  const extraContent = rightExtra || actions;

  return (
    <header
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-200 dark:border-zinc-800 ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && (
          <div className="w-9 h-9 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
            {renderErpIcon(icon, 'w-5 h-5')}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-zinc-100 truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 line-clamp-1">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {(computedMeta.length > 0 || extraContent) && (
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {computedMeta.length > 0 && (
            <div className="text-xs text-slate-500 dark:text-zinc-400 font-medium tabular-nums">
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
      className={`border-b border-slate-200 dark:border-zinc-800 overflow-x-auto no-scrollbar ${className}`}
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
              className={`relative inline-flex items-center gap-2 min-h-[44px] sm:min-h-[40px] px-3.5 text-xs sm:text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40 ${
                isActive
                  ? 'text-slate-900 dark:text-zinc-100 font-semibold'
                  : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
            >
              {tab.icon && (
                <span
                  className={
                    isActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400 dark:text-zinc-500'
                  }
                >
                  {renderErpIcon(tab.icon, 'w-4 h-4')}
                </span>
              )}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className="text-[11px] text-slate-400 dark:text-zinc-500 tabular-nums">
                  ({tab.count.toLocaleString('fa-IR')})
                </span>
              )}
              {tab.badge && (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  · {tab.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-emerald-600 dark:bg-emerald-400" />
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
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 min-w-max">
        {tabs.map(tab => {
          const isActive = tab.id === currentTab;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={`inline-flex items-center gap-1.5 min-h-[36px] sm:min-h-[32px] px-3 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-all cursor-pointer disabled:opacity-40 ${
                isActive
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-semibold shadow-xs border border-slate-200/90 dark:border-zinc-700'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 border border-transparent'
              }`}
            >
              {tab.icon && <span className="shrink-0">{renderErpIcon(tab.icon, 'w-3.5 h-3.5')}</span>}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className="text-[11px] text-slate-400 dark:text-zinc-500 tabular-nums">
                  {tab.count.toLocaleString('fa-IR')}
                </span>
              )}
              {tab.badge && (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
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
  <div className={`relative flex-1 min-w-[180px] sm:max-w-xs ${className}`}>
    <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 sm:h-9 pr-9 pl-8 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs sm:text-[13px] text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
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

  const hasSearchOrFilters = Boolean(onSearchChange || filters || (hasActiveFilters && onClearFilters));
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
      className={`flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 ${className}`}
    >
      {/* Right side (RTL start): Search & Filters */}
      {hasSearchOrFilters ? (
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          {onSearchChange && (
            <UnifiedSearchInput
              value={searchValue ?? ''}
              onChange={onSearchChange}
              placeholder={searchPlaceholder}
            />
          )}
          {filters}
          {hasActiveFilters && onClearFilters && (
            <ErpButton
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              {ERP_BUTTON_LABELS.clearFilters}
            </ErpButton>
          )}
        </div>
      ) : (
        <div className="hidden lg:block" />
      )}

      {/* Left side (RTL end): Fixed canonical order of utility buttons + primary CTA */}
      {(hasSecondaryActions || hasPrimary) && (
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 justify-end">
          {onCopyFromPeriod && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onCopyFromPeriod}
              icon={<Copy className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
            >
              {copyFromPeriodLabel}
            </ErpButton>
          )}

          {onDownloadTemplate && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onDownloadTemplate}
              icon={<FileSpreadsheet className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
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
                icon={<Upload className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
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
              icon={<Download className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
            >
              {ERP_BUTTON_LABELS.exportExcel}
            </ErpButton>
          )}

          {onPrint && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onPrint}
              icon={<Printer className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
            >
              {ERP_BUTTON_LABELS.print}
            </ErpButton>
          )}

          {onRefresh && (
            <ErpButton
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              icon={<RefreshCw className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />}
            >
              {ERP_BUTTON_LABELS.refresh}
            </ErpButton>
          )}

          {extraSecondaryActions}

          {hasSecondaryActions && hasPrimary && (
            <span className="hidden sm:inline-block w-px h-5 bg-slate-200 dark:bg-zinc-700 mx-0.5" />
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
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
        className="w-9 h-9 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
    className={`flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-900/30 ${className}`}
  >
    <div className="w-11 h-11 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-400 dark:text-zinc-500 mb-3">
      {icon ? renderErpIcon(icon, 'w-5 h-5') : <Inbox className="w-5 h-5" />}
    </div>
    <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-100">{title}</h3>
    {description && (
      <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-md leading-5">
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-emerald-600 dark:text-emerald-400 shrink-0">{renderErpIcon(icon, 'w-5 h-5')}</span>}
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={ERP_BUTTON_LABELS.close}
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {(footer || onSave) && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/60 shrink-0">
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
/* StatusText & KpiStrip (Zero candy pills, tabular numerals)                 */
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
    info: 'bg-sky-500',
    neutral: 'bg-slate-400 dark:bg-zinc-500',
  };
  const textColors: Record<StatusTone, string> = {
    success: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400',
    danger: 'text-rose-700 dark:text-rose-400',
    info: 'text-sky-700 dark:text-sky-400',
    neutral: 'text-slate-600 dark:text-zinc-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${textColors[tone]} ${className}`}
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
  tone?: 'default' | 'success' | 'danger' | 'warning';
}

export const KpiStrip: React.FC<{ items: KpiItem[]; className?: string }> = ({
  items,
  className = '',
}) => {
  const valueTone: Record<NonNullable<KpiItem['tone']>, string> = {
    default: 'text-slate-900 dark:text-zinc-100',
    success: 'text-emerald-700 dark:text-emerald-400',
    danger: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
  };

  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${className}`}
    >
      {items.map((item, idx) => (
        <div
          key={`${item.label}-${idx}`}
          className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 px-4 py-3"
        >
          <div className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 truncate">
            {item.label}
          </div>
          <div
            className={`text-base sm:text-lg font-bold tabular-nums mt-1 truncate ${valueTone[item.tone ?? 'default']}`}
          >
            {typeof item.value === 'number' ? item.value.toLocaleString('fa-IR') : item.value}
          </div>
          {item.sublabel && (
            <div className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5 truncate">
              {item.sublabel}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
