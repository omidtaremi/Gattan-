/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  QrCode,
  Eye,
  EyeOff,
  Star,
  Image as ImageIcon,
  Languages,
  Palette,
  LayoutGrid,
  FolderTree,
  Search,
  Check,
  Copy,
  Download,
  Printer,
  ExternalLink,
  Upload,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  X,
  FolderPlus,
  RotateCcw,
} from 'lucide-react';
import defaultCafeCover from '../assets/images/gatan_cafe_menu_cover_1795330536825.jpg';
import {
  AppDatabase,
  DigitalMenuCategory,
  DigitalMenuConfig,
  DigitalMenuProductSetting,
  Product,
} from '../types';
import {
  ModuleHeader,
  ModulePrimaryTabs,
  KpiStrip,
  UnifiedToolbar,
  ErpButton,
} from './ui/UnifiedErpUi';
import { printElement } from '../utils/persianUtils';
import { exportRowsToExcel } from '../utils/tableIoUtils';
import {
  ALLERGEN_OPTIONS,
  DIETARY_OPTIONS,
  DEFAULT_DIGITAL_MENU_CATEGORIES,
  DEFAULT_DIGITAL_MENU_CONFIG,
  sanitizeDigitalMenuConfig,
  resolveDigitalMenuPeriod,
  resolveLiveErpPriceRials,
  convertPriceForDisplay,
} from '../shared/digitalMenu';
import { saveDigitalMenuConfigToServer } from '../services/postgresSyncService';
import { toPersianDigits } from '../utils/persianUtils';
import { nextSimpleId } from '../utils/simpleId';

interface DigitalMenuAdminProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  activePeriodId: string;
  serverMode: 'postgres' | 'local';
  activeBranch?: { id: string; slug: string; name: string; isDefault?: boolean };
  onOpenPublicPreview?: () => void;
}

type AdminSubTab = 'overview' | 'products' | 'categories' | 'translations' | 'appearance' | 'qr';

const THEME_PRESETS = [
  {
    name: 'شیری، اسپرسو و کارامل (پیش‌فرض)',
    bg: '#F8F3EB',
    primary: '#362419',
    secondary: '#B8814D',
  },
  {
    name: 'عاجی، کاکائو و برنز ملایم',
    bg: '#FAF6F0',
    primary: '#2D1E17',
    secondary: '#A6754B',
  },
  {
    name: 'کتان گرم، زیتونی تیره و طلایی',
    bg: '#F6F4EE',
    primary: '#27352B',
    secondary: '#B58E4E',
  },
  {
    name: 'شیری روشن، ذغالی و مس گرم',
    bg: '#F7F5F2',
    primary: '#23201E',
    secondary: '#B86F4B',
  },
  {
    name: 'کرم وانیلی، آلبالویی و برنز',
    bg: '#FBF6F3',
    primary: '#4A1F28',
    secondary: '#B88356',
  },
];

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compresses an uploaded image file via HTML5 Canvas to keep database storage lean on VPS.
 */
async function compressImageFileToDataUrl(
  file: File,
  maxWidth = 960,
  maxHeight = 720,
  quality = 0.82
): Promise<string> {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimes.includes(file.type.toLowerCase())) {
    throw new Error('فرمت تصویر مجاز نیست. لطفاً فایل JPG، PNG یا WebP انتخاب نمایید.');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('حجم فایل تصویر بیش از ۱۲ مگابایت است.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('خطا در خواندن فایل تصویر.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('تصویر انتخاب‌شده معتبر نیست.'));
      img.onload = () => {
        let targetW = img.width;
        let targetH = img.height;
        if (targetW > maxWidth || targetH > maxHeight) {
          const ratio = Math.min(maxWidth / targetW, maxHeight / targetH);
          targetW = Math.max(1, Math.round(targetW * ratio));
          targetH = Math.max(1, Math.round(targetH * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('مرورگر از پردازش تصویر پشتیبانی نمی‌کند.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const outType = file.type === 'image/png' && maxWidth <= 400 ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outType, quality);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export default function DigitalMenuAdmin({
  db,
  onUpdateDb,
  activePeriodId,
  serverMode,
  activeBranch,
  onOpenPublicPreview,
}: DigitalMenuAdminProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>('overview');
  const [config, setConfig] = useState<DigitalMenuConfig>(() =>
    sanitizeDigitalMenuConfig(db.digitalMenu || DEFAULT_DIGITAL_MENU_CONFIG)
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filters for Menu Products & Translations
  const [productSearch, setProductSearch] = useState('');
  const [productMenuCategoryFilter, setProductMenuCategoryFilter] = useState<string>('all');
  const [productStatusFilter, setProductStatusFilter] = useState<
    'all' | 'visible' | 'hidden' | 'unavailable' | 'featured' | 'no_image'
  >('all');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [bulkMoveTargetCategoryId, setBulkMoveTargetCategoryId] = useState<string>('');

  const [translationSearch, setTranslationSearch] = useState('');
  const [onlyMissingEn, setOnlyMissingEn] = useState(false);

  // Add ERP Products Modal states (single & bulk opt-in)
  const [showAddProductsModal, setShowAddProductsModal] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [modalErpGroupFilter, setModalErpGroupFilter] = useState<string>('all');
  const [modalHideAlreadyAdded, setModalHideAlreadyAdded] = useState(true);
  const [modalTargetMenuCategoryId, setModalTargetMenuCategoryId] = useState<string>('');
  const [modalSelectedProductIds, setModalSelectedProductIds] = useState<Set<string>>(new Set());

  // New Standalone Digital Menu Category Form states
  const [newCatNameFa, setNewCatNameFa] = useState('');
  const [newCatNameEn, setNewCatNameEn] = useState('');
  const [newCatDescFa, setNewCatDescFa] = useState('');
  const [newCatDescEn, setNewCatDescEn] = useState('');

  // Safe Category Delete Modal state (when category has assigned products)
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<DigitalMenuCategory | null>(null);
  const [reassignCategoryId, setReassignCategoryId] = useState<string>('');

  // QR states
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Reset local editor when switching branches
  useEffect(() => {
    setConfig(sanitizeDigitalMenuConfig(db.digitalMenu || DEFAULT_DIGITAL_MENU_CONFIG));
    setHasUnsavedChanges(false);
  }, [activeBranch?.id]);

  // Sync external db.digitalMenu updates when no unsaved local edits exist
  useEffect(() => {
    if (!hasUnsavedChanges && db.digitalMenu) {
      setConfig(sanitizeDigitalMenuConfig(db.digitalMenu));
    }
  }, [db.digitalMenu, hasUnsavedChanges]);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3800);
  }, []);

  const updateConfig = useCallback((updater: (prev: DigitalMenuConfig) => DigitalMenuConfig) => {
    setConfig((prev) => updater(prev));
    setHasUnsavedChanges(true);
  }, []);

  // Resolve source ERP period for live pricing
  const resolvedPeriod = useMemo(
    () =>
      resolveDigitalMenuPeriod(
        db.periods || [],
        db.products || [],
        config.appearance.sourcePeriodId || activePeriodId
      ),
    [db.periods, db.products, config.appearance.sourcePeriodId, activePeriodId]
  );

  // Live ERP non-WIP products available to pick from (single source of truth for live pricing)
  const erpProductsInPeriod = useMemo(() => {
    const targetPeriodId = resolvedPeriod.id || activePeriodId;
    return (db.products || []).filter(
      (p) => p.periodId === targetPeriodId && !p.isWip
    );
  }, [db.products, resolvedPeriod.id, activePeriodId]);

  // Lookup map strictly within resolvedPeriod (or activePeriodId)
  const erpProductById = useMemo(() => {
    const targetPeriodId = resolvedPeriod.id || activePeriodId;
    const map = new Map<string, Product>();
    for (const p of db.products || []) {
      if (!p || !p.id || p.isWip) continue;
      if (p.periodId === targetPeriodId) {
        map.set(p.id, p);
      }
    }
    return map;
  }, [db.products, resolvedPeriod.id, activePeriodId]);

  // Helper ERP group list ONLY for filtering inside the "Add Products from ERP" picker modal
  const erpHelperGroups = useMemo(() => {
    const targetPeriodId = resolvedPeriod.id || activePeriodId;
    return (db.productCategories || []).filter(
      (c) => c.periodId === targetPeriodId
    );
  }, [db.productCategories, resolvedPeriod.id, activePeriodId]);

  const erpHelperGroupNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of erpHelperGroups) m.set(c.id, c.name);
    return m;
  }, [erpHelperGroups]);

  // Standalone Digital Menu Categories (sorted by displayOrder)
  const menuCategories = useMemo(() => {
    return [...(config.menuCategories || [])].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [config.menuCategories]);

  const menuCategoryMap = useMemo(() => {
    const map = new Map<string, DigitalMenuCategory>();
    for (const c of menuCategories) map.set(c.id, c);
    return map;
  }, [menuCategories]);

  // Opt-in products explicitly added to the Digital Menu, joined with live ERP product data
  const menuProductEntries = useMemo(() => {
    const entries: Array<{ product: Product; setting: DigitalMenuProductSetting }> = [];
    const rawSettings = Object.values(config.products || {}) as DigitalMenuProductSetting[];
    for (const setting of rawSettings) {
      if (!setting || !setting.productId) continue;
      const erpProd = erpProductById.get(setting.productId);
      if (!erpProd) continue;
      entries.push({ product: erpProd, setting });
    }
    entries.sort((a, b) => a.setting.displayOrder - b.setting.displayOrder);
    return entries;
  }, [config.products, erpProductById]);

  const productCountByMenuCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of menuProductEntries) {
      const cid = entry.setting.menuCategoryId || '';
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    return counts;
  }, [menuProductEntries]);

  // Product setting patch & remove helpers
  const patchProductSetting = useCallback(
    (productId: string, patch: Partial<DigitalMenuProductSetting>) => {
      updateConfig((prev) => {
        const existing = prev.products[productId];
        if (!existing) return prev;
        return {
          ...prev,
          products: {
            ...prev.products,
            [productId]: {
              ...existing,
              ...patch,
              productId,
            },
          },
        };
      });
    },
    [updateConfig]
  );

  const removeProductsFromMenu = useCallback(
    (productIds: string[]) => {
      if (productIds.length === 0) return;
      const toRemove = new Set(productIds);
      updateConfig((prev) => {
        const nextProducts: Record<string, DigitalMenuProductSetting> = {};
        for (const [k, v] of Object.entries(prev.products) as Array<[string, DigitalMenuProductSetting]>) {
          if (!toRemove.has(k)) {
            nextProducts[k] = v;
          }
        }
        return { ...prev, products: nextProducts };
      });
      if (expandedProductId && toRemove.has(expandedProductId)) {
        setExpandedProductId(null);
      }
    },
    [updateConfig, expandedProductId]
  );

  // Add 1 or multiple ERP products into Digital Menu with target menuCategoryId
  const addErpProductsToMenu = useCallback(
    (productIds: string[], targetMenuCategoryId: string) => {
      if (productIds.length === 0) return;
      updateConfig((prev) => {
        const nextProducts: Record<string, DigitalMenuProductSetting> = { ...prev.products };
        const existingValues = Object.values(nextProducts) as DigitalMenuProductSetting[];
        let maxOrder = existingValues.reduce<number>(
          (max, item) => Math.max(max, item.displayOrder || 0),
          0
        );

        for (const pid of productIds) {
          if (nextProducts[pid]) {
            // Already in menu: update its category if a target category was explicitly chosen
            if (targetMenuCategoryId) {
              nextProducts[pid] = {
                ...nextProducts[pid],
                menuCategoryId: targetMenuCategoryId,
              };
            }
          } else {
            maxOrder += 10;
            nextProducts[pid] = {
              productId: pid,
              menuCategoryId: targetMenuCategoryId,
              visible: true,
              featured: false,
              isAvailable: true,
              displayOrder: maxOrder,
              imageUrl: '',
              nameFaOverride: '',
              nameEn: '',
              descriptionFa: '',
              descriptionEn: '',
              allergens: [],
              dietaryLabels: [],
            };
          }
        }
        return { ...prev, products: nextProducts };
      });
    },
    [updateConfig]
  );

  // Standalone Menu Category CRUD helpers
  const handleAddMenuCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const fa = newCatNameFa.trim();
    const en = newCatNameEn.trim();
    if (!fa) {
      showToast('error', 'لطفاً عنوان فارسی دسته‌بندی را وارد نمایید.');
      return;
    }
    const maxOrder = menuCategories.reduce((m, c) => Math.max(m, c.displayOrder), 0);
    const newCat: DigitalMenuCategory = {
      id: nextSimpleId(config.menuCategories || [], 'dmcat'),
      nameFa: fa,
      nameEn: en,
      descriptionFa: newCatDescFa.trim(),
      descriptionEn: newCatDescEn.trim(),
      visible: true,
      displayOrder: maxOrder + 10,
    };
    updateConfig((prev) => ({
      ...prev,
      menuCategories: [...prev.menuCategories, newCat],
    }));
    setNewCatNameFa('');
    setNewCatNameEn('');
    setNewCatDescFa('');
    setNewCatDescEn('');
    showToast('success', `دسته‌بندی «${fa}» به منوی دیجیتال اضافه شد.`);
  };

  const patchMenuCategory = useCallback(
    (catId: string, patch: Partial<DigitalMenuCategory>) => {
      updateConfig((prev) => ({
        ...prev,
        menuCategories: prev.menuCategories.map((c) =>
          c.id === catId ? { ...c, ...patch } : c
        ),
      }));
    },
    [updateConfig]
  );

  const handleMoveMenuCategory = (idx: number, direction: -1 | 1) => {
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= menuCategories.length) return;
    const reordered = [...menuCategories];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(swapIdx, 0, moved);
    const normalized = reordered.map((c, i) => ({
      ...c,
      displayOrder: (i + 1) * 10,
    }));
    updateConfig((prev) => ({
      ...prev,
      menuCategories: normalized,
    }));
  };

  const handleRequestDeleteCategory = (cat: DigitalMenuCategory) => {
    const assignedCount = productCountByMenuCategory.get(cat.id) || 0;
    if (assignedCount === 0) {
      updateConfig((prev) => ({
        ...prev,
        menuCategories: prev.menuCategories.filter((c) => c.id !== cat.id),
      }));
      showToast('success', `دسته‌بندی «${cat.nameFa}» حذف شد.`);
      return;
    }
    const otherCat = menuCategories.find((c) => c.id !== cat.id);
    setReassignCategoryId(otherCat ? otherCat.id : '');
    setDeleteCategoryTarget(cat);
  };

  const handleConfirmDeleteCategory = () => {
    if (!deleteCategoryTarget) return;
    const deletedId = deleteCategoryTarget.id;
    const deletedName = deleteCategoryTarget.nameFa;
    const nextTargetId = reassignCategoryId;

    updateConfig((prev) => {
      const nextProducts: Record<string, DigitalMenuProductSetting> = {};
      for (const [pid, setting] of Object.entries(prev.products) as Array<[string, DigitalMenuProductSetting]>) {
        nextProducts[pid] =
          setting.menuCategoryId === deletedId
            ? { ...setting, menuCategoryId: nextTargetId }
            : setting;
      }
      return {
        ...prev,
        menuCategories: prev.menuCategories.filter((c) => c.id !== deletedId),
        products: nextProducts,
      };
    });
    setDeleteCategoryTarget(null);
    showToast(
      'success',
      nextTargetId
        ? `دسته‌بندی «${deletedName}» حذف و محصولات آن به دسته انتخاب‌شده منتقل شدند.`
        : `دسته‌بندی «${deletedName}» حذف شد و محصولات آن به حالت بدون دسته‌بندی رفتند.`
    );
  };

  const handleRestoreDefaultCategories = () => {
    updateConfig((prev) => {
      const existingIds = new Set(prev.menuCategories.map((c) => c.id));
      const maxOrder = prev.menuCategories.reduce((m, c) => Math.max(m, c.displayOrder), 0);
      const missingDefaults = DEFAULT_DIGITAL_MENU_CATEGORIES.filter(
        (d) => !existingIds.has(d.id)
      ).map((d, i) => ({
        ...d,
        displayOrder: maxOrder + (i + 1) * 10,
      }));
      return {
        ...prev,
        menuCategories: [...prev.menuCategories, ...missingDefaults],
      };
    });
    showToast('success', 'دسته‌بندی‌های پیش‌فرض کافه به لیست اضافه شدند.');
  };

  // Open Add ERP Products modal
  const openAddProductsModal = (preferredMenuCatId?: string) => {
    const defaultCat =
      preferredMenuCatId ||
      (productMenuCategoryFilter !== 'all' && productMenuCategoryFilter !== '__unassigned__'
        ? productMenuCategoryFilter
        : menuCategories[0]?.id || '');
    setModalTargetMenuCategoryId(defaultCat);
    setModalSelectedProductIds(new Set());
    setModalSearch('');
    setModalErpGroupFilter('all');
    setShowAddProductsModal(true);
  };

  // Filtered ERP products inside the Add Products Modal
  const modalFilteredErpProducts = useMemo(() => {
    const q = modalSearch.trim().toLowerCase();
    return erpProductsInPeriod.filter((p) => {
      const alreadyInMenu = Boolean(config.products[p.id]);
      if (modalHideAlreadyAdded && alreadyInMenu) return false;
      if (modalErpGroupFilter !== 'all' && p.categoryId !== modalErpGroupFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        String(p.code || '').toLowerCase().includes(q)
      );
    });
  }, [
    erpProductsInPeriod,
    config.products,
    modalHideAlreadyAdded,
    modalErpGroupFilter,
    modalSearch,
  ]);

  // Overview KPI Metrics (strictly based on opt-in menu products & standalone menu categories)
  const overviewStats = useMemo(() => {
    const visibleCatIds = new Set(
      menuCategories.filter((c) => c.visible !== false).map((c) => c.id)
    );
    let visibleProducts = 0;
    let unassignedProducts = 0;
    let featuredCount = 0;
    let missingImages = 0;
    let missingEnglish = 0;

    for (const { setting } of menuProductEntries) {
      const hasValidCat = Boolean(setting.menuCategoryId && menuCategoryMap.has(setting.menuCategoryId));
      if (!hasValidCat) unassignedProducts++;
      const isEffectivelyVisible =
        setting.visible && hasValidCat && visibleCatIds.has(setting.menuCategoryId);
      if (isEffectivelyVisible) visibleProducts++;
      if (setting.featured) featuredCount++;
      if (!setting.imageUrl) missingImages++;
      if (!setting.nameEn?.trim()) missingEnglish++;
    }

    return {
      totalErpProducts: erpProductsInPeriod.length,
      selectedMenuProducts: menuProductEntries.length,
      visibleProducts,
      unassignedProducts,
      featuredCount,
      totalCategories: menuCategories.length,
      activeCategories: visibleCatIds.size,
      missingImages,
      missingEnglish,
    };
  }, [menuCategories, menuCategoryMap, menuProductEntries, erpProductsInPeriod.length]);

  // Filtered Menu Products list
  const filteredMenuProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return menuProductEntries.filter(({ product, setting }) => {
      const hasValidCat = Boolean(setting.menuCategoryId && menuCategoryMap.has(setting.menuCategoryId));
      if (productMenuCategoryFilter === '__unassigned__') {
        if (hasValidCat) return false;
      } else if (productMenuCategoryFilter !== 'all') {
        if (setting.menuCategoryId !== productMenuCategoryFilter) return false;
      }

      if (productStatusFilter === 'visible' && !setting.visible) return false;
      if (productStatusFilter === 'hidden' && setting.visible) return false;
      if (productStatusFilter === 'unavailable' && setting.isAvailable) return false;
      if (productStatusFilter === 'featured' && !setting.featured) return false;
      if (productStatusFilter === 'no_image' && Boolean(setting.imageUrl)) return false;

      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        String(product.code || '').toLowerCase().includes(q) ||
        (setting.nameFaOverride || '').toLowerCase().includes(q) ||
        (setting.nameEn || '').toLowerCase().includes(q)
      );
    });
  }, [
    menuProductEntries,
    menuCategoryMap,
    productMenuCategoryFilter,
    productStatusFilter,
    productSearch,
  ]);

  // Filtered Translation list (ONLY opt-in menu products!)
  const filteredTranslationEntries = useMemo(() => {
    const q = translationSearch.trim().toLowerCase();
    return menuProductEntries.filter(({ product, setting }) => {
      if (onlyMissingEn && setting.nameEn?.trim()) return false;
      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        (setting.nameEn || '').toLowerCase().includes(q) ||
        (setting.nameFaOverride || '').toLowerCase().includes(q)
      );
    });
  }, [menuProductEntries, translationSearch, onlyMissingEn]);

  // Public Menu URL & QR Generation (per-branch QR route)
  const publicMenuUrl = useMemo(() => {
    const branchPath =
      activeBranch && !activeBranch.isDefault && activeBranch.slug
        ? `/menu/${encodeURIComponent(activeBranch.slug)}`
        : '/menu';
    const customBase = (config.appearance.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (customBase) {
      return `${customBase}${branchPath}`;
    }
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${branchPath}`;
    }
    return branchPath;
  }, [config.appearance.publicBaseUrl, activeBranch?.id, activeBranch?.slug, activeBranch?.isDefault]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(publicMenuUrl, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#1F1712',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [publicMenuUrl]);

  // Persist changes to ERP state + PostgreSQL API (if connected)
  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const sanitized = sanitizeDigitalMenuConfig({
        ...config,
        updatedAt: new Date().toISOString(),
      });

      if (serverMode === 'postgres') {
        const res = await saveDigitalMenuConfigToServer(sanitized);
        if (!res.ok) {
          showToast('error', res.error || 'خطا در ذخیره تنظیمات منوی دیجیتال در سرور.');
          setIsSaving(false);
          return;
        }
      }

      onUpdateDb({
        ...db,
        digitalMenu: sanitized,
      });
      setConfig(sanitized);
      setHasUnsavedChanges(false);
      showToast('success', 'تنظیمات منوی دیجیتال ذخیره شد و بلافاصله در منوی عمومی اعمال گردید.');
    } catch (err: any) {
      showToast('error', err?.message || 'خطا در ذخیره‌سازی تنظیمات منو.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkVisibility = (visible: boolean) => {
    const ids: string[] = filteredMenuProducts.map((e) => e.product.id);
    if (ids.length === 0) return;
    updateConfig((prev) => {
      const nextProducts: Record<string, DigitalMenuProductSetting> = { ...prev.products };
      for (const pid of ids) {
        if (nextProducts[pid]) {
          nextProducts[pid] = { ...nextProducts[pid], visible };
        }
      }
      return { ...prev, products: nextProducts };
    });
  };

  const handleBulkReassignCategory = () => {
    if (!bulkMoveTargetCategoryId) return;
    const ids: string[] = filteredMenuProducts.map((e) => e.product.id);
    if (ids.length === 0) return;
    updateConfig((prev) => {
      const nextProducts: Record<string, DigitalMenuProductSetting> = { ...prev.products };
      for (const pid of ids) {
        if (nextProducts[pid]) {
          nextProducts[pid] = {
            ...nextProducts[pid],
            menuCategoryId: bulkMoveTargetCategoryId,
          };
        }
      }
      return { ...prev, products: nextProducts };
    });
    const catName = menuCategoryMap.get(bulkMoveTargetCategoryId)?.nameFa || '';
    showToast(
      'success',
      `${toPersianDigits(ids.length)} محصول به دسته «${catName}» منتقل شدند.`
    );
    setBulkMoveTargetCategoryId('');
  };

  const handleUploadProductImage = async (productId: string, file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 900, 675, 0.82);
      patchProductSetting(productId, { imageUrl: dataUrl });
      showToast('success', 'تصویر محصول فشرده‌سازی و بارگذاری شد. برای انتشار نهایی دکمه ذخیره را بزنید.');
    } catch (err: any) {
      showToast('error', err?.message || 'خطا در بارگذاری تصویر');
    }
  };

  const handleUploadAppearanceImage = async (field: 'logoUrl' | 'coverImageUrl', file?: File) => {
    if (!file) return;
    try {
      const dataUrl =
        field === 'logoUrl'
          ? await compressImageFileToDataUrl(file, 360, 360, 0.88)
          : await compressImageFileToDataUrl(file, 1440, 720, 0.82);
      updateConfig((prev) => ({
        ...prev,
        appearance: { ...prev.appearance, [field]: dataUrl },
      }));
      showToast('success', 'تصویر با موفقیت بارگذاری شد.');
    } catch (err: any) {
      showToast('error', err?.message || 'خطا در بارگذاری تصویر');
    }
  };

  const handleCopyPublicUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicMenuUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      showToast('error', 'امکان کپی خودکار وجود ندارد؛ لطفاً لینک را به‌صورت دستی کپی کنید.');
    }
  };

  const handleDownloadQrPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = 'gatan-cafe-digital-menu-qr.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintQrCard = () => {
    if (!qrDataUrl) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }

    const safeNameFa = escapeHtml(config.appearance.cafeNameFa);
    const safeNameEn = escapeHtml(config.appearance.cafeNameEn);
    const safeTaglineFa = escapeHtml(config.appearance.taglineFa);
    const safeBg = escapeHtml(config.appearance.backgroundColor || '#F8F3EB');
    const safePrimary = escapeHtml(config.appearance.primaryColor);
    const safeSecondary = escapeHtml(config.appearance.secondaryColor);
    const safeUrl = escapeHtml(publicMenuUrl);

    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${safeNameFa} - QR Menu Card</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;800&family=Cormorant+Garamond:wght@600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 16mm;
    color: ${safePrimary};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .card {
    width: 118mm;
    border: 1.5px solid #D9CEC1;
    border-radius: 18px;
    padding: 14mm 11mm;
    text-align: center;
    background: ${safeBg};
  }
  .accent-line {
    width: 48px;
    height: 3px;
    border-radius: 99px;
    background: ${safeSecondary};
    margin: 0 auto 12px;
  }
  .brand-fa { font-size: 22px; font-weight: 800; color: ${safePrimary}; margin-bottom: 4px; }
  .brand-en { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 20px; font-weight: 700; color: #594A40; letter-spacing: 0.04em; margin-bottom: 8px; }
  .tagline { font-size: 11px; color: #6E5F55; line-height: 1.7; margin-bottom: 18px; }
  .qr-box {
    background: #ffffff;
    border: 1px solid #E5DDD3;
    border-radius: 16px;
    padding: 14px;
    display: inline-block;
    margin-bottom: 16px;
  }
  .qr-box img { width: 62mm; height: 62mm; display: block; }
  .cta-fa { font-size: 14px; font-weight: 800; color: ${safePrimary}; margin-bottom: 4px; }
  .cta-en { font-size: 11px; font-weight: 600; color: #6E5F55; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 12px; }
  .url { font-size: 9.5px; color: #8B7B70; direction: ltr; word-break: break-all; border-top: 1px dashed #DDD2C6; padding-top: 10px; }
  @page { size: A5 portrait; margin: 10mm; }
</style>
</head>
<body>
  <div class="card">
    <div class="accent-line"></div>
    <div class="brand-fa">${safeNameFa}</div>
    <div class="brand-en">${safeNameEn}</div>
    ${safeTaglineFa ? `<div class="tagline">${safeTaglineFa}</div>` : ''}
    <div class="qr-box">
      <img src="${qrDataUrl}" alt="Digital Menu QR Code" />
    </div>
    <div class="cta-fa">برای مشاهده منوی دیجیتال اسکن کنید</div>
    <div class="cta-en">Scan to View Our Digital Menu</div>
    <div class="url">${safeUrl}</div>
  </div>
</body>
</html>`);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 1500);
    }, 350);
  };

  const handleOpenPreview = () => {
    if (onOpenPublicPreview) {
      onOpenPublicPreview();
    } else if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/menu');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const subTabs: Array<{ id: AdminSubTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'overview', label: 'نمای کلی', icon: <LayoutGrid className="h-4 w-4" /> },
    {
      id: 'categories',
      label: 'دسته‌بندی‌های منو',
      icon: <FolderTree className="h-4 w-4" />,
      badge: menuCategories.length,
    },
    {
      id: 'products',
      label: 'محصولات منو',
      icon: <Eye className="h-4 w-4" />,
      badge: menuProductEntries.length,
    },
    { id: 'translations', label: 'ترجمه‌های دوزبانه', icon: <Languages className="h-4 w-4" /> },
    { id: 'appearance', label: 'ظاهر و برندینگ', icon: <Palette className="h-4 w-4" /> },
    { id: 'qr', label: 'کد QR کافه', icon: <QrCode className="h-4 w-4" /> },
  ];

  const formatDisplayPriceAdmin = (priceRials: number) => {
    const val = convertPriceForDisplay(priceRials, config.appearance.currencyMode);
    const unit = config.appearance.currencyMode === 'rial' ? 'ریال' : 'تومان';
    return `${toPersianDigits(val.toLocaleString('en-US'))} ${unit}`;
  };

  const handleExportDigitalMenuExcel = () => {
    const catMap = new Map<string, string>(menuCategories.map(c => [c.id, c.nameFa]));
    const rows = Object.entries(config.products || {}).map(([prodId, setting], idx) => {
      const p = erpProductsInPeriod.find(pr => pr.id === prodId);
      const s = setting as DigitalMenuProductSetting;
      return {
        'ردیف': idx + 1,
        'کد محصول': p?.code || prodId,
        'نام فارسی': s.nameFaOverride || p?.name || '',
        'نام انگلیسی': s.nameEn || '',
        'دسته‌بندی منو': s.menuCategoryId ? (catMap.get(s.menuCategoryId) || '') : '',
        'قیمت (ریال)': p?.salesPrice || 0,
        'وضعیت نمایش': s.visible !== false ? 'فعال' : 'مخفی',
        'پیشنهاد سرآشپز': s.featured ? 'بله' : 'خیر',
      };
    });
    exportRowsToExcel(rows, 'منوی دیجیتال', 'منوی_دیجیتال_گاتان');
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12 font-sans text-right" dir="rtl">
      {/* ================= UNIFIED MODULE HEADER + PRIMARY TABS ================= */}
      <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <ModuleHeader
          icon={<QrCode className="h-5 w-5" />}
          title="مدیریت منوی دیجیتال عمومی (QR)"
          subtitle={`دسته‌بندی‌های اختصاصی منو + انتخاب دلخواه از محصولات ERP با قیمت زنده — ${config.enabled ? 'فعال و عمومی' : 'موقتاً غیرفعال'}`}
          periodName={resolvedPeriod.name || 'نامشخص'}
          recordCount={overviewStats.selectedMenuProducts}
          recordLabel="محصول در منو"
          actions={
            <>
              <ErpButton
                variant="secondary"
                size="sm"
                onClick={handleOpenPreview}
                icon={<ExternalLink className="h-3.5 w-3.5 text-emerald-400" />}
              >
                پیش‌نمایش زنده /menu
              </ErpButton>
              <ErpButton
                variant="primary"
                size="sm"
                onClick={handleSaveConfig}
                disabled={isSaving}
                icon={isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              >
                {isSaving ? 'در حال ذخیره...' : hasUnsavedChanges ? 'ذخیره و انتشار تغییرات' : 'ذخیره تنظیمات'}
              </ErpButton>
            </>
          }
        />

        <ModulePrimaryTabs
          activeId={subTab}
          onChange={(id) => setSubTab(id as AdminSubTab)}
          tabs={subTabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            count: typeof tab.badge === 'number' ? tab.badge : undefined,
          }))}
        />
      </div>

      {/* Main Content Card */}
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl sm:rounded-3xl shadow-xl p-3.5 sm:p-6 space-y-5 font-sans text-right" dir="rtl">
        <KpiStrip
          items={[
            { label: 'محصولات انتخاب‌شده در منو', value: `${toPersianDigits(overviewStats.selectedMenuProducts)} / ${toPersianDigits(overviewStats.totalErpProducts)}`, sublabel: `${toPersianDigits(overviewStats.visibleProducts)} مورد فعال نمایشی`, tone: 'default' },
            { label: 'دسته‌بندی‌های اختصاصی منو', value: `${toPersianDigits(overviewStats.activeCategories)} / ${toPersianDigits(overviewStats.totalCategories)}`, sublabel: `${toPersianDigits(overviewStats.featuredCount)} پیشنهاد ویژه سرآشپز`, tone: 'info' },
            { label: 'محصولات بدون تصویر', value: toPersianDigits(overviewStats.missingImages), sublabel: 'نیازمند بارگذاری تصویر', tone: overviewStats.missingImages > 0 ? 'warning' : 'success' },
            { label: 'محصولات بدون ترجمه EN', value: toPersianDigits(overviewStats.missingEnglish), sublabel: 'تکمیل نسخه انگلیسی', tone: overviewStats.missingEnglish > 0 ? 'warning' : 'success' },
          ]}
        />

        <UnifiedToolbar
          onExportExcel={handleExportDigitalMenuExcel}
          onPrint={() => printElement('digital-menu-admin-printable', 'مدیریت منوی دیجیتال عمومی گاتان')}
        />

      {/* Feedback Toast */}
      {toast && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: OVERVIEW                                                        */}
      {/* ===================================================================== */}
      {subTab === 'overview' && (
        <div id="digital-menu-admin-printable" className="space-y-5">
          {/* Quick Onboarding Banner when zero products added yet */}
          {overviewStats.selectedMenuProducts === 0 && (
            <div className="bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-700/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-black text-emerald-950 dark:text-emerald-200">
                  هنوز محصولی به منوی دیجیتال اضافه نشده است
                </h3>
                <p className="text-xs text-emerald-800/90 dark:text-emerald-300/80 leading-relaxed">
                  {toPersianDigits(overviewStats.totalCategories)} دسته‌بندی آماده کافه برای شما ایجاد شده است. اکنون می‌توانید محصولات دلخواه را به‌صورت تکی یا گروهی از کاتالوگ ERP به دسته‌بندی‌های منو اضافه کنید.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('products');
                    openAddProductsModal();
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>افزودن محصول از ERP</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('categories')}
                  className="px-3.5 py-2.5 rounded-xl border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-xs font-bold cursor-pointer hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30"
                >
                  ویرایش دسته‌بندی‌ها
                </button>
              </div>
            </div>
          )}

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => setSubTab('products')}
              className="text-right bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 hover:border-emerald-400/60 rounded-2xl p-4 space-y-1 cursor-pointer transition-colors"
            >
              <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                محصولات انتخاب‌شده در منو
              </div>
              <div className="text-sm sm:text-[15px] font-black text-slate-900 dark:text-white font-mono tabular-nums tracking-tight">
                {toPersianDigits(overviewStats.selectedMenuProducts)}
                <span className="text-xs font-normal text-slate-400 mr-1">
                  از {toPersianDigits(overviewStats.totalErpProducts)} ERP
                </span>
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                {toPersianDigits(overviewStats.visibleProducts)} مورد فعال برای نمایش به مشتری
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSubTab('categories')}
              className="text-right bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 hover:border-emerald-400/60 rounded-2xl p-4 space-y-1 cursor-pointer transition-colors"
            >
              <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                دسته‌بندی‌های اختصاصی منو
              </div>
              <div className="text-sm sm:text-[15px] font-black text-slate-900 dark:text-white font-mono tabular-nums tracking-tight">
                {toPersianDigits(overviewStats.activeCategories)}
                <span className="text-xs font-normal text-slate-400 mr-1">
                  از {toPersianDigits(overviewStats.totalCategories)}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                {toPersianDigits(overviewStats.featuredCount)} محصول پیشنهاد ویژه سرآشپز
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setProductStatusFilter('no_image');
                setSubTab('products');
              }}
              className="text-right bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 hover:border-amber-400/60 rounded-2xl p-4 space-y-1 cursor-pointer transition-colors"
            >
              <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                محصولات منو بدون تصویر
              </div>
              <div className="text-sm sm:text-[15px] font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums tracking-tight">
                {toPersianDigits(overviewStats.missingImages)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                کلیک جهت بارگذاری تصویر
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setOnlyMissingEn(true);
                setSubTab('translations');
              }}
              className="text-right bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 hover:border-sky-400/60 rounded-2xl p-4 space-y-1 cursor-pointer transition-colors"
            >
              <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                محصولات منو بدون ترجمه EN
              </div>
              <div className="text-sm sm:text-[15px] font-black text-sky-600 dark:text-sky-400 font-mono tabular-nums tracking-tight">
                {toPersianDigits(overviewStats.missingEnglish)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                کلیک جهت تکمیل ترجمه
              </div>
            </button>
          </div>

          {overviewStats.unassignedProducts > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-700/40 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
              <span>
                <strong>{toPersianDigits(overviewStats.unassignedProducts)} محصول</strong> در منوی دیجیتال فاقد دسته‌بندی معتبر هستند و تا زمان انتساب دسته‌بندی در منوی عمومی نمایش داده نمی‌شوند.
              </span>
              <button
                type="button"
                onClick={() => {
                  setProductMenuCategoryFilter('__unassigned__');
                  setSubTab('products');
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold shrink-0 cursor-pointer"
              >
                مشاهده و انتساب دسته
              </button>
            </div>
          )}

          {/* Master Toggle & Quick QR Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    وضعیت انتشار عمومی منو
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                    مشتریان بدون نیاز به ورود به ERP، صرفاً محصولات انتخاب‌شده در این منو را با قیمت‌های زنده ERP مشاهده می‌کنند (بدون امکان ثبت سفارش آنلاین).
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) =>
                      updateConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                    className="h-5 w-5 accent-emerald-600 rounded cursor-pointer"
                  />
                  <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">
                    {config.enabled ? 'منو فعال است' : 'منو غیرفعال است'}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/70 dark:border-zinc-800">
                  <div className="text-slate-500 dark:text-zinc-400 mb-1">
                    آدرس عمومی منو (کد QR اختصاصی{activeBranch?.name ? ` — ${activeBranch.name}` : ''})
                  </div>
                  <div className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400 break-all" dir="ltr">
                    {publicMenuUrl}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/70 dark:border-zinc-800">
                  <div className="text-slate-500 dark:text-zinc-400 mb-1">واحد نمایش قیمت (از قیمت زنده ERP)</div>
                  <div className="font-bold text-slate-800 dark:text-zinc-100">
                    {config.appearance.currencyMode === 'toman'
                      ? 'تومان (محاسبه خودکار از ریال ERP)'
                      : 'ریال (مستقیم از ERP)'}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-3">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Cafe QR"
                  className="h-32 w-32 rounded-xl border border-slate-200 bg-white p-2"
                />
              )}
              <button
                type="button"
                onClick={() => setSubTab('qr')}
                className="w-full py-2 px-3 rounded-xl bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-xs font-bold cursor-pointer transition-colors"
              >
                دریافت و چاپ کد QR کافه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: STANDALONE DIGITAL MENU CATEGORIES (CRUD)                       */}
      {/* ===================================================================== */}
      {subTab === 'categories' && (
        <div id="digital-menu-admin-printable" className="space-y-4">
          {/* Add New Category Form */}
          <form
            onSubmit={handleAddMenuCategory}
            className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <FolderPlus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>افزودن دسته‌بندی اختصاصی جدید برای منوی دیجیتال</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  این دسته‌بندی‌ها مستقل از گروه‌های تولید و حسابداری ERP هستند و صرفاً برای نمایش حرفه‌ای منو به مشتریان کافه استفاده می‌شوند.
                </p>
              </div>
              {menuCategories.length < DEFAULT_DIGITAL_MENU_CATEGORIES.length && (
                <button
                  type="button"
                  onClick={handleRestoreDefaultCategories}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 text-[11px] font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>بازیابی دسته‌های پیش‌فرض</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input
                type="text"
                value={newCatNameFa}
                onChange={(e) => setNewCatNameFa(e.target.value)}
                placeholder="نام فارسی دسته * (مثلاً: نوشیدنی‌های فصلی)"
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
              />
              <input
                type="text"
                dir="ltr"
                value={newCatNameEn}
                onChange={(e) => setNewCatNameEn(e.target.value)}
                placeholder="English Title (e.g., Seasonal Drinks)"
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
              <input
                type="text"
                value={newCatDescFa}
                onChange={(e) => setNewCatDescFa(e.target.value)}
                placeholder="توضیح کوتاه فارسی (اختیاری)"
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
              <input
                type="text"
                dir="ltr"
                value={newCatDescEn}
                onChange={(e) => setNewCatDescEn(e.target.value)}
                placeholder="Short EN description (optional)"
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>افزودن دسته‌بندی</span>
              </button>
            </div>
          </form>

          {/* Existing Standalone Digital Menu Categories List */}
          {menuCategories.length === 0 ? (
            <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-8 text-center space-y-3">
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                هیچ دسته‌بندی برای منوی دیجیتال تعریف نشده است. از فرم بالا دسته جدید بسازید یا ۹ دسته پیش‌فرض کافه را بازیابی کنید.
              </p>
              <button
                type="button"
                onClick={handleRestoreDefaultCategories}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
              >
                ایجاد ۹ دسته پیش‌فرض کافه
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {menuCategories.map((cat, idx) => {
                const assignedCount = productCountByMenuCategory.get(cat.id) || 0;

                return (
                  <div
                    key={cat.id}
                    className={`bg-white dark:bg-[#11131a] border rounded-2xl p-4 space-y-3 transition-opacity ${
                      cat.visible
                        ? 'border-slate-200 dark:border-zinc-800'
                        : 'border-slate-200/60 dark:border-zinc-800/50 opacity-70'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveMenuCategory(idx, -1)}
                            className="p-1 rounded border border-slate-200 dark:border-zinc-700 disabled:opacity-30 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-800"
                            title="انتقال به بالا"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === menuCategories.length - 1}
                            onClick={() => handleMoveMenuCategory(idx, 1)}
                            className="p-1 rounded border border-slate-200 dark:border-zinc-700 disabled:opacity-30 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-800"
                            title="انتقال به پایین"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>

                        <div>
                          <div className="text-sm font-black text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                            <span>{toPersianDigits(idx + 1)}. {cat.nameFa}</span>
                            {cat.nameEn && (
                              <span dir="ltr" className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                                ({cat.nameEn})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                            {toPersianDigits(assignedCount)} محصول منتسب‌شده به این دسته
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('products');
                            openAddProductsModal(cat.id);
                          }}
                          className="px-2.5 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:opacity-90"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>افزودن محصول به این دسته</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => patchMenuCategory(cat.id, { visible: !cat.visible })}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                            cat.visible
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-zinc-800 border-slate-300 dark:border-zinc-700 text-slate-500'
                          }`}
                        >
                          {cat.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          <span>{cat.visible ? 'نمایش' : 'مخفی'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRequestDeleteCategory(cat)}
                          title="حذف دسته‌بندی"
                          className="p-2 rounded-xl border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                          عنوان فارسی
                        </label>
                        <input
                          type="text"
                          value={cat.nameFa}
                          onChange={(e) => patchMenuCategory(cat.id, { nameFa: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                          عنوان انگلیسی (English)
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          value={cat.nameEn}
                          onChange={(e) => patchMenuCategory(cat.id, { nameEn: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                          توضیح کوتاه فارسی
                        </label>
                        <input
                          type="text"
                          value={cat.descriptionFa || ''}
                          onChange={(e) =>
                            patchMenuCategory(cat.id, { descriptionFa: e.target.value })
                          }
                          placeholder="اختیاری..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                          توضیح کوتاه انگلیسی
                        </label>
                        <input
                          type="text"
                          dir="ltr"
                          value={cat.descriptionEn || ''}
                          onChange={(e) =>
                            patchMenuCategory(cat.id, { descriptionEn: e.target.value })
                          }
                          placeholder="Optional..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: OPT-IN MENU PRODUCTS MANAGEMENT                                 */}
      {/* ===================================================================== */}
      {subTab === 'products' && (
        <div id="digital-menu-admin-printable" className="space-y-4">
          {/* Action & Filter Bar */}
          <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  محصولات انتخاب‌شده در منوی دیجیتال ({toPersianDigits(menuProductEntries.length)} محصول)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  فقط محصولاتی که اینجا اضافه می‌کنید در منوی عمومی نمایش داده می‌شوند و قیمت آن‌ها به‌صورت زنده از ERP خوانده می‌شود.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openAddProductsModal()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>افزودن محصول از ERP (تکی / گروهی)</span>
              </button>
            </div>

            {menuProductEntries.length > 0 && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-zinc-800/80">
                  <div className="relative">
                    <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="جستجو در محصولات منو..."
                      className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                    />
                  </div>

                  <select
                    value={productMenuCategoryFilter}
                    onChange={(e) => setProductMenuCategoryFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                  >
                    <option value="all">
                      همه دسته‌بندی‌های منو ({toPersianDigits(menuCategories.length)})
                    </option>
                    {menuCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameFa} ({toPersianDigits(productCountByMenuCategory.get(c.id) || 0)})
                      </option>
                    ))}
                    {overviewStats.unassignedProducts > 0 && (
                      <option value="__unassigned__">
                        بدون دسته‌بندی ({toPersianDigits(overviewStats.unassignedProducts)})
                      </option>
                    )}
                  </select>

                  <select
                    value={productStatusFilter}
                    onChange={(e) => setProductStatusFilter(e.target.value as any)}
                    className="px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                  >
                    <option value="all">همه وضعیت‌ها</option>
                    <option value="visible">فقط فعال در منو</option>
                    <option value="hidden">فقط مخفی موقت</option>
                    <option value="featured">فقط پیشنهاد ویژه</option>
                    <option value="unavailable">فقط ناموجود</option>
                    <option value="no_image">فقط فاقد تصویر</option>
                  </select>
                </div>

                {/* Bulk Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-xs">
                  <span className="text-slate-500 dark:text-zinc-400 font-semibold">
                    نتایج فیلترشده: {toPersianDigits(filteredMenuProducts.length)} محصول
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {menuCategories.length > 0 && filteredMenuProducts.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={bulkMoveTargetCategoryId}
                          onChange={(e) => setBulkMoveTargetCategoryId(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-bold"
                        >
                          <option value="">انتقال گروهی نتایج به دسته...</option>
                          {menuCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nameFa}
                            </option>
                          ))}
                        </select>
                        {bulkMoveTargetCategoryId && (
                          <button
                            type="button"
                            onClick={handleBulkReassignCategory}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[11px] font-bold cursor-pointer"
                          >
                            اعمال انتقال
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleBulkVisibility(true)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/40 font-bold cursor-pointer"
                    >
                      نمایش همه نتایج
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkVisibility(false)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 font-bold cursor-pointer"
                    >
                      مخفی‌سازی همه نتایج
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Empty State vs Added Menu Products List */}
          {menuProductEntries.length === 0 ? (
            <div className="bg-white dark:bg-[#11131a] border border-dashed border-slate-300 dark:border-zinc-700 rounded-2xl p-10 text-center space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <Plus className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-black text-slate-900 dark:text-white">
                لیست محصولات منوی دیجیتال خالی است
              </h4>
              <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                به‌صورت پیش‌فرض هیچ محصولی از ERP در منوی مشتریان نمایش داده نمی‌شود. روی دکمه زیر کلیک کنید تا محصولات دلخواه را به‌صورت تکی یا گروهی انتخاب و به دسته‌بندی منوی دیجیتال منتسب نمایید.
              </p>
              <button
                type="button"
                onClick={() => openAddProductsModal()}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>انتخاب و افزودن محصول از ERP</span>
              </button>
            </div>
          ) : filteredMenuProducts.length === 0 ? (
            <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-8 text-center text-xs text-slate-500 dark:text-zinc-400">
              محصولی مطابق فیلتر انتخابی یافت نشد.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredMenuProducts.map(({ product, setting }) => {
                const livePriceRials = resolveLiveErpPriceRials(product);
                const isExpanded = expandedProductId === product.id;
                const hasValidCategory = Boolean(
                  setting.menuCategoryId && menuCategoryMap.has(setting.menuCategoryId)
                );

                return (
                  <div
                    key={product.id}
                    className={`bg-white dark:bg-[#11131a] border rounded-2xl p-3.5 transition-colors ${
                      !hasValidCategory
                        ? 'border-amber-300 dark:border-amber-700/60'
                        : setting.visible
                        ? 'border-slate-200 dark:border-zinc-800'
                        : 'border-slate-200/60 dark:border-zinc-800/50 opacity-70'
                    }`}
                  >
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                      {/* Thumbnail + Title + Live ERP Price + Inline Menu Category Selector */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="relative h-14 w-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 shrink-0 flex items-center justify-center">
                          {setting.imageUrl ? (
                            <img
                              src={setting.imageUrl}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 text-slate-400" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-slate-900 dark:text-white truncate">
                              {setting.nameFaOverride || product.name}
                            </span>
                            {product.code && (
                              <span className="text-[10.5px] font-mono text-slate-500 dark:text-zinc-400">
                                ({product.code})
                              </span>
                            )}
                            {setting.nameEn && (
                              <span dir="ltr" className="text-[11px] text-sky-600 dark:text-sky-400">
                                {setting.nameEn}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            {/* Dedicated Digital Menu Category Assignment Selector */}
                            <select
                              value={hasValidCategory ? setting.menuCategoryId : ''}
                              onChange={(e) =>
                                patchProductSetting(product.id, { menuCategoryId: e.target.value })
                              }
                              aria-label="دسته‌بندی منوی دیجیتال"
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold outline-none ${
                                hasValidCategory
                                  ? 'border-emerald-300 dark:border-emerald-700/50 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                                  : 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                              }`}
                            >
                              <option value="">-- انتخاب دسته‌بندی منو --</option>
                              {menuCategories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.nameFa}
                                </option>
                              ))}
                            </select>

                            <span className="text-slate-300 dark:text-zinc-700">·</span>

                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              قیمت زنده ERP: {formatDisplayPriceAdmin(livePriceRials)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Quick Controls */}
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <label className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-[11px] font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1 cursor-pointer">
                          <Upload className="h-3.5 w-3.5" />
                          <span>{setting.imageUrl ? 'تغییر عکس' : 'عکس'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              handleUploadProductImage(product.id, file);
                            }}
                          />
                        </label>

                        {setting.imageUrl && (
                          <button
                            type="button"
                            onClick={() => patchProductSetting(product.id, { imageUrl: '' })}
                            title="حذف تصویر محصول"
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-500 hover:text-rose-500 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-2 py-1">
                          <span className="text-[10px] text-slate-500">ترتیب:</span>
                          <input
                            type="number"
                            value={setting.displayOrder}
                            onChange={(e) =>
                              patchProductSetting(product.id, {
                                displayOrder: Number(e.target.value) || 0,
                              })
                            }
                            className="w-11 text-center text-xs font-bold bg-transparent outline-none tabular-nums"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            patchProductSetting(product.id, { featured: !setting.featured })
                          }
                          title="پیشنهاد ویژه سرآشپز"
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                            setting.featured
                              ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-600/50 text-amber-700 dark:text-amber-300'
                              : 'border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-amber-600'
                          }`}
                        >
                          <Star className={`h-3.5 w-3.5 ${setting.featured ? 'fill-current' : ''}`} />
                          <span>ویژه</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            patchProductSetting(product.id, { isAvailable: !setting.isAvailable })
                          }
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                            setting.isAvailable
                              ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-700/40 text-sky-700 dark:text-sky-300'
                              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-700/40 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {setting.isAvailable ? 'موجود' : 'ناموجود'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            patchProductSetting(product.id, { visible: !setting.visible })
                          }
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                            setting.visible
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-zinc-800 border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400'
                          }`}
                        >
                          {setting.visible ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                          <span>{setting.visible ? 'نمایش' : 'مخفی'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setExpandedProductId(isExpanded ? null : product.id)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                          title="توضیحات، حساسیت‌زاها و برچسب‌های غذایی"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeProductsFromMenu([product.id])}
                          title="حذف از منوی دیجیتال (کالا در ERP حفظ می‌شود)"
                          className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Product Metadata Editor */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-zinc-800 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 dark:text-zinc-400 mb-1">
                              توضیحات فارسی منو (اختیاری)
                            </label>
                            <textarea
                              rows={2}
                              value={setting.descriptionFa || ''}
                              onChange={(e) =>
                                patchProductSetting(product.id, { descriptionFa: e.target.value })
                              }
                              placeholder="مثلاً: تهیه شده با کره فرانسوی، خمیر هزارلا و شکلات تلخ بلژیکی..."
                              className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 dark:text-zinc-400 mb-1">
                              توضیحات انگلیسی منو (English Description)
                            </label>
                            <textarea
                              rows={2}
                              dir="ltr"
                              value={setting.descriptionEn || ''}
                              onChange={(e) =>
                                patchProductSetting(product.id, { descriptionEn: e.target.value })
                              }
                              placeholder="e.g., Flaky French butter pastry filled with dark Belgian chocolate..."
                              className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-bold text-slate-600 dark:text-zinc-400">
                              ویژگی‌های غذایی و معرفی محصول
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {DIETARY_OPTIONS.map((opt) => {
                                const checked = (setting.dietaryLabels || []).includes(opt.id);
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                      const current = setting.dietaryLabels || [];
                                      const next = checked
                                        ? current.filter((x) => x !== opt.id)
                                        : [...current, opt.id];
                                      patchProductSetting(product.id, { dietaryLabels: next });
                                    }}
                                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                                      checked
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300'
                                    }`}
                                  >
                                    {opt.labelFa}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="text-[11px] font-bold text-slate-600 dark:text-zinc-400">
                              مواد حساسیت‌زا (Allergens)
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {ALLERGEN_OPTIONS.map((opt) => {
                                const checked = (setting.allergens || []).includes(opt.id);
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                      const current = setting.allergens || [];
                                      const next = checked
                                        ? current.filter((x) => x !== opt.id)
                                        : [...current, opt.id];
                                      patchProductSetting(product.id, { allergens: next });
                                    }}
                                    className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                                      checked
                                        ? 'bg-amber-600 text-white border-amber-600'
                                        : 'border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300'
                                    }`}
                                  >
                                    {opt.labelFa}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: BILINGUAL TRANSLATIONS (ONLY OPT-IN MENU PRODUCTS)              */}
      {/* ===================================================================== */}
      {subTab === 'translations' && (
        <div id="digital-menu-admin-printable" className="space-y-4">
          {menuProductEntries.length === 0 ? (
            <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-8 text-center space-y-3">
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                ابتدا محصولات مورد نظر خود را در تب «محصولات منو» اضافه کنید تا بتوانید ترجمه فارسی و انگلیسی آن‌ها را در اینجا مدیریت نمایید.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubTab('products');
                  openAddProductsModal();
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold cursor-pointer"
              >
                افزودن محصول از ERP
              </button>
            </div>
          ) : (
            <>
              <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={translationSearch}
                    onChange={(e) => setTranslationSearch(e.target.value)}
                    placeholder="جستجوی محصول منو جهت ترجمه..."
                    className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyMissingEn}
                    onChange={(e) => setOnlyMissingEn(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600 rounded cursor-pointer"
                  />
                  <span>
                    فقط محصولات فاقد ترجمه انگلیسی ({toPersianDigits(overviewStats.missingEnglish)})
                  </span>
                </label>
              </div>

              <div className="space-y-3">
                {filteredTranslationEntries.map(({ product, setting }) => {
                  const menuCatName =
                    menuCategoryMap.get(setting.menuCategoryId)?.nameFa || 'بدون دسته‌بندی';
                  return (
                    <div
                      key={product.id}
                      className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-black text-slate-900 dark:text-white">
                          {product.name}{' '}
                          <span className="font-normal text-slate-400">({menuCatName})</span>
                        </span>
                        <span
                          className={`text-[10.5px] font-bold ${
                            setting.nameEn?.trim()
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {setting.nameEn?.trim()
                            ? 'ترجمه انگلیسی ثبت شده'
                            : 'بدون ترجمه انگلیسی (نمایش نام پیش‌فرض)'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={setting.nameFaOverride || ''}
                            onChange={(e) =>
                              patchProductSetting(product.id, { nameFaOverride: e.target.value })
                            }
                            placeholder={`نام فارسی در منو (پیش‌فرض: ${product.name})`}
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                          />
                          <textarea
                            rows={2}
                            value={setting.descriptionFa || ''}
                            onChange={(e) =>
                              patchProductSetting(product.id, { descriptionFa: e.target.value })
                            }
                            placeholder="توضیحات فارسی محصول در منوی مشتریان..."
                            className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                          />
                        </div>

                        <div className="space-y-2">
                          <input
                            type="text"
                            dir="ltr"
                            value={setting.nameEn || ''}
                            onChange={(e) =>
                              patchProductSetting(product.id, { nameEn: e.target.value })
                            }
                            placeholder="English Product Name (e.g. Chocolate Croissant)"
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                          />
                          <textarea
                            rows={2}
                            dir="ltr"
                            value={setting.descriptionEn || ''}
                            onChange={(e) =>
                              patchProductSetting(product.id, { descriptionEn: e.target.value })
                            }
                            placeholder="English product description for international guests..."
                            className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 5: MENU APPEARANCE & SETTINGS                                      */}
      {/* ===================================================================== */}
      {subTab === 'appearance' && (
        <div id="digital-menu-admin-printable" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Branding & Texts */}
          <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white border-b border-slate-100 dark:border-zinc-800 pb-2.5">
              هویت بصری و متون برند (دوزبانه)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  نام کافه / فروشگاه (فارسی)
                </label>
                <input
                  type="text"
                  value={config.appearance.cafeNameFa}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, cafeNameFa: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  نام کافه / فروشگاه (English)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={config.appearance.cafeNameEn}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, cafeNameEn: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                شعار و معرفی کوتاه (فارسی)
              </label>
              <input
                type="text"
                value={config.appearance.taglineFa}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    appearance: { ...prev.appearance, taglineFa: e.target.value },
                  }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                شعار و معرفی کوتاه (English Tagline)
              </label>
              <input
                type="text"
                dir="ltr"
                value={config.appearance.taglineEn}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    appearance: { ...prev.appearance, taglineEn: e.target.value },
                  }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
              />
            </div>

            {/* Logo & Cover Upload */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                  لوگوی کافه
                </label>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 overflow-hidden flex items-center justify-center shrink-0">
                    {config.appearance.logoUrl ? (
                      <img
                        src={config.appearance.logoUrl}
                        alt="Logo"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-[11px] font-bold cursor-pointer text-center">
                      بارگذاری لوگو
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          handleUploadAppearanceImage('logoUrl', f);
                        }}
                      />
                    </label>
                    {config.appearance.logoUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          updateConfig((prev) => ({
                            ...prev,
                            appearance: { ...prev.appearance, logoUrl: '' },
                          }))
                        }
                        className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                      >
                        حذف لوگو
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                  تصویر کاور هدر منو
                </label>
                <div className="relative h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-zinc-700">
                  <img
                    src={config.appearance.coverImageUrl || defaultCafeCover}
                    alt="Cover preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-[11px] font-bold cursor-pointer">
                    بارگذاری کاور اختصاصی
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        handleUploadAppearanceImage('coverImageUrl', f);
                      }}
                    />
                  </label>
                  {config.appearance.coverImageUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        updateConfig((prev) => ({
                          ...prev,
                          appearance: { ...prev.appearance, coverImageUrl: '' },
                        }))
                      }
                      className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                    >
                      بازگشت به کاور پیش‌فرض
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Theme Color Pickers & Presets */}
            <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <div className="text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                پالت رنگی منوی دیجیتال (پس‌زمینه، متن اصلی و رنگ تأکیدی)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold cursor-pointer">
                  <input
                    type="color"
                    value={config.appearance.backgroundColor || '#F8F3EB'}
                    onChange={(e) =>
                      updateConfig((prev) => ({
                        ...prev,
                        appearance: { ...prev.appearance, backgroundColor: e.target.value },
                      }))
                    }
                    className="h-7 w-9 rounded cursor-pointer border-0 bg-transparent shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold">رنگ پس‌زمینه</div>
                    <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                      {config.appearance.backgroundColor || '#F8F3EB'}
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold cursor-pointer">
                  <input
                    type="color"
                    value={config.appearance.primaryColor}
                    onChange={(e) =>
                      updateConfig((prev) => ({
                        ...prev,
                        appearance: { ...prev.appearance, primaryColor: e.target.value },
                      }))
                    }
                    className="h-7 w-9 rounded cursor-pointer border-0 bg-transparent shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold">رنگ متن اصلی</div>
                    <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                      {config.appearance.primaryColor}
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 p-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-bold cursor-pointer">
                  <input
                    type="color"
                    value={config.appearance.secondaryColor}
                    onChange={(e) =>
                      updateConfig((prev) => ({
                        ...prev,
                        appearance: { ...prev.appearance, secondaryColor: e.target.value },
                      }))
                    }
                    className="h-7 w-9 rounded cursor-pointer border-0 bg-transparent shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold">رنگ تأکیدی</div>
                    <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                      {config.appearance.secondaryColor}
                    </div>
                  </div>
                </label>
              </div>

              {/* Compact live palette sample */}
              <div
                className="rounded-xl p-3.5 flex items-center justify-between gap-3 border border-black/10"
                style={{
                  backgroundColor: config.appearance.backgroundColor || '#F8F3EB',
                  color: config.appearance.primaryColor,
                }}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold truncate">{config.appearance.cafeNameFa}</div>
                  <div className="text-[11px] opacity-70 truncate">
                    پیش‌نمایش خوانایی متن روی پس‌زمینه انتخابی
                  </div>
                </div>
                <span
                  className="text-xs font-bold shrink-0 pb-0.5 border-b-2"
                  style={{
                    color: config.appearance.secondaryColor,
                    borderColor: config.appearance.secondaryColor,
                  }}
                >
                  رنگ تأکیدی
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        appearance: {
                          ...prev.appearance,
                          backgroundColor: preset.bg,
                          primaryColor: preset.primary,
                          secondaryColor: preset.secondary,
                        },
                      }))
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-black/15"
                      style={{ backgroundColor: preset.bg }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: preset.primary }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: preset.secondary }}
                    />
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Menu Behavior & Café Contact Footer */}
          <div className="bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-900 dark:text-white border-b border-slate-100 dark:border-zinc-800 pb-2.5">
              تنظیمات نمایش، قیمت و اطلاعات تماس کافه
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  زبان پیش‌فرض منو
                </label>
                <select
                  value={config.appearance.defaultLanguage}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: {
                        ...prev.appearance,
                        defaultLanguage: e.target.value === 'en' ? 'en' : 'fa',
                      },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                >
                  <option value="fa">فارسی (پیش‌فرض · راست‌به‌چپ)</option>
                  <option value="en">انگلیسی (English · LTR)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  واحد نمایش قیمت زنده ERP
                </label>
                <select
                  value={config.appearance.currencyMode}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: {
                        ...prev.appearance,
                        currencyMode: e.target.value === 'rial' ? 'rial' : 'toman',
                      },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                >
                  <option value="toman">تومان (تقسیم خودکار ریال ERP بر ۱۰)</option>
                  <option value="rial">ریال (دقیقاً مطابق ERP)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  نحوه نمایش محصولات ناموجود
                </label>
                <select
                  value={config.appearance.unavailableBehavior}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: {
                        ...prev.appearance,
                        unavailableBehavior: e.target.value === 'hide' ? 'hide' : 'badge',
                      },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                >
                  <option value="badge">نمایش با وضعیت «موقتاً ناموجود»</option>
                  <option value="hide">مخفی‌سازی خودکار از منوی مشتری</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  دوره مالی منبع قیمت‌ها در ERP
                </label>
                <select
                  value={config.appearance.sourcePeriodId}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, sourcePeriodId: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                >
                  <option value="">خودکار (آخرین دوره فعال دارای محصول)</option>
                  {(db.periods || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-5 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.appearance.showPrices}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, showPrices: e.target.checked },
                    }))
                  }
                  className="h-4 w-4 accent-emerald-600 rounded"
                />
                <span>نمایش قیمت محصولات در منو</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.appearance.showFeaturedSection}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, showFeaturedSection: e.target.checked },
                    }))
                  }
                  className="h-4 w-4 accent-emerald-600 rounded"
                />
                <span>نمایش نوار پیشنهاد ویژه سرآشپز</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  ساعات کاری (فارسی)
                </label>
                <input
                  type="text"
                  value={config.appearance.hoursFa}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, hoursFa: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  ساعات کاری (English)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={config.appearance.hoursEn}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, hoursEn: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  شماره تماس کافه (اختیاری)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={config.appearance.phoneDisplay}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, phoneDisplay: e.target.value },
                    }))
                  }
                  placeholder="021-xxxxxxxx"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  شناسه اینستاگرام (بدون @)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={config.appearance.instagramHandle}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: {
                        ...prev.appearance,
                        instagramHandle: e.target.value.replace(/^@+/, ''),
                      },
                    }))
                  }
                  placeholder="gatan.bakery"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  نشانی کافه (فارسی)
                </label>
                <input
                  type="text"
                  value={config.appearance.addressFa}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, addressFa: e.target.value },
                    }))
                  }
                  placeholder="نشانی دقیق فروشگاه و کافه گاتان..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  پیام راهنمای سفارش به سالن‌دار (فارسی)
                </label>
                <input
                  type="text"
                  value={config.appearance.waiterNoticeFa}
                  onChange={(e) =>
                    updateConfig((prev) => ({
                      ...prev,
                      appearance: { ...prev.appearance, waiterNoticeFa: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 6: SINGLE GENERAL CAFÉ QR CODE MANAGEMENT                          */}
      {/* ===================================================================== */}
      {subTab === 'qr' && (
        <div id="digital-menu-admin-printable" className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2 bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col items-center text-center space-y-4">
            <div
              className="w-full max-w-[290px] rounded-2xl border border-[#E5DDD3] p-6 space-y-3 shadow-sm"
              style={{
                backgroundColor: config.appearance.backgroundColor || '#F8F3EB',
                color: config.appearance.primaryColor,
              }}
            >
              <div
                className="w-10 h-1 rounded-full mx-auto"
                style={{ backgroundColor: config.appearance.secondaryColor }}
              />
              <div>
                <div
                  className="text-base font-black"
                  style={{ color: config.appearance.primaryColor }}
                >
                  {config.appearance.cafeNameFa}
                </div>
                <div className="text-xs font-semibold text-[#6E5F55] mt-0.5">
                  {config.appearance.cafeNameEn}
                </div>
              </div>

              <div className="bg-white p-3 rounded-xl border border-[#EAE2D9] inline-block">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Public Digital Menu QR Code"
                    className="h-48 w-48 block"
                  />
                ) : (
                  <div className="h-48 w-48 flex items-center justify-center text-xs text-slate-400">
                    در حال تولید کد QR...
                  </div>
                )}
              </div>

              <div className="space-y-0.5">
                <div
                  className="text-xs font-black"
                  style={{ color: config.appearance.primaryColor }}
                >
                  برای مشاهده منوی دیجیتال اسکن کنید
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[#7D6D62] font-semibold">
                  Scan to View Digital Menu
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 w-full">
              <button
                type="button"
                onClick={handleDownloadQrPng}
                disabled={!qrDataUrl}
                className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>دانلود PNG باکیفیت</span>
              </button>
              <button
                type="button"
                onClick={handlePrintQrCard}
                disabled={!qrDataUrl}
                className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-xs font-bold text-slate-800 dark:text-zinc-100 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Printer className="h-4 w-4" />
                <span>چاپ کارت رومیزی</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-3 bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5">
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                تنظیمات لینک و کد QR عمومی کافه
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                این کد QR عمومی برای تمام میزها، کانتر فروش و استند ورودی کافه استفاده می‌شود و مستقیماً مشتریان را بدون نیاز به ورود به ERP به صفحه منوی دیجیتال هدایت می‌کند.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                نشانی عمومی رمزگذاری‌شده در کد QR
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  dir="ltr"
                  value={publicMenuUrl}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-xs font-mono text-emerald-700 dark:text-emerald-400"
                />
                <button
                  type="button"
                  onClick={handleCopyPublicUrl}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span>کپی شد</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>کپی لینک</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                دامنه اختصاصی سرور VPS برای چاپ QR (اختیاری)
              </label>
              <input
                type="url"
                dir="ltr"
                value={config.appearance.publicBaseUrl}
                onChange={(e) =>
                  updateConfig((prev) => ({
                    ...prev,
                    appearance: { ...prev.appearance, publicBaseUrl: e.target.value },
                  }))
                }
                placeholder="https://gatan.yourdomain.ir"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono"
              />
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                اگر خالی بماند، به‌صورت خودکار دامنه فعلی سرور شما استفاده می‌شود. پس از دیپلوی روی Ubuntu 24 VPS با دامنه و SSL، می‌توانید دامنه اصلی را وارد کرده و QR نهایی را چاپ کنید.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/40 space-y-1.5 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="font-black flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" />
                <span>به‌روزرسانی خودکار بدون نیاز به چاپ مجدد QR</span>
              </div>
              <p className="text-[11.5px] leading-relaxed opacity-90">
                هر زمان قیمت محصولی را در ERP تغییر دهید یا محصولات و دسته‌بندی‌های منو را ویرایش کنید، محتوای منو به‌صورت آنی روی همین کد QR به‌روز می‌شود.
              </p>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleOpenPreview}
                className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                <ExternalLink className="h-4 w-4" />
                <span>باز کردن صفحه منوی عمومی (/menu)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL A: ADD ERP PRODUCTS TO DIGITAL MENU (SINGLE & BULK SELECT)       */}
      {/* ===================================================================== */}
      {showAddProductsModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setShowAddProductsModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[88vh] bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            dir="rtl"
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  افزودن محصول از کاتالوگ ERP به منوی دیجیتال
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                  محصولات دلخواه را تکی یا گروهی انتخاب کرده و مستقیماً به یکی از دسته‌بندی‌های منوی دیجیتال منتسب کنید.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddProductsModal(false)}
                className="h-9 w-9 rounded-xl border border-slate-200 dark:border-zinc-700 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Target Digital Menu Category + Search & Filter */}
            <div className="p-4 border-b border-slate-100 dark:border-zinc-800/80 space-y-3 bg-slate-50/70 dark:bg-zinc-900/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                    دسته‌بندی مقصد در منوی دیجیتال *
                  </label>
                  <select
                    value={modalTargetMenuCategoryId}
                    onChange={(e) => setModalTargetMenuCategoryId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                  >
                    <option value="">-- انتخاب دسته‌بندی منوی دیجیتال --</option>
                    {menuCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameFa} {c.nameEn ? `(${c.nameEn})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                    فیلتر کمکی بر اساس گروه ERP (فقط جهت جستجوی سریع‌تر)
                  </label>
                  <select
                    value={modalErpGroupFilter}
                    onChange={(e) => setModalErpGroupFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
                  >
                    <option value="all">همه گروه‌های ERP</option>
                    {erpHelperGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    placeholder="جستجوی نام یا کد محصول در ERP..."
                    className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                  />
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-zinc-300 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={modalHideAlreadyAdded}
                    onChange={(e) => setModalHideAlreadyAdded(e.target.checked)}
                    className="h-4 w-4 accent-emerald-600 rounded"
                  />
                  <span>مخفی‌کردن موارد اضافه‌شده</span>
                </label>
              </div>

              {/* Select All / Clear */}
              {modalFilteredErpProducts.length > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 dark:text-zinc-400 font-semibold">
                    {toPersianDigits(modalFilteredErpProducts.length)} محصول قابل انتخاب
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setModalSelectedProductIds(
                          new Set(modalFilteredErpProducts.map((p) => p.id))
                        )
                      }
                      className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
                    >
                      انتخاب همه نتایج
                    </button>
                    {modalSelectedProductIds.size > 0 && (
                      <>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setModalSelectedProductIds(new Set())}
                          className="text-slate-500 hover:underline cursor-pointer"
                        >
                          لغو انتخاب ({toPersianDigits(modalSelectedProductIds.size)})
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable ERP Products List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {modalFilteredErpProducts.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-zinc-400">
                  محصول جدیدی برای نمایش با این فیلتر یافت نشد.
                </div>
              ) : (
                modalFilteredErpProducts.map((prod) => {
                  const isChecked = modalSelectedProductIds.has(prod.id);
                  const existingEntry = config.products[prod.id];
                  const livePriceRials = resolveLiveErpPriceRials(prod);

                  return (
                    <div
                      key={prod.id}
                      onClick={() => {
                        setModalSelectedProductIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(prod.id)) next.delete(prod.id);
                          else next.add(prod.id);
                          return next;
                        });
                      }}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/35 border-emerald-400 dark:border-emerald-600/60'
                          : 'bg-white dark:bg-zinc-900/50 border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="h-4 w-4 accent-emerald-600 rounded shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                            {prod.name}{' '}
                            {prod.code && (
                              <span className="text-[10.5px] font-mono text-slate-400">
                                ({prod.code})
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                            <span>گروه ERP: {erpHelperGroupNameMap.get(prod.categoryId) || 'عمومی'}</span>
                            <span>·</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              {formatDisplayPriceAdmin(livePriceRials)}
                            </span>
                            {existingEntry && (
                              <>
                                <span>·</span>
                                <span className="text-sky-600 dark:text-sky-400 font-semibold">
                                  فعلاً در دسته:{' '}
                                  {menuCategoryMap.get(existingEntry.menuCategoryId)?.nameFa ||
                                    'بدون دسته'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Single-Add Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!modalTargetMenuCategoryId) {
                            showToast('error', 'ابتدا دسته‌بندی مقصد منوی دیجیتال را در بالا انتخاب کنید.');
                            return;
                          }
                          addErpProductsToMenu([prod.id], modalTargetMenuCategoryId);
                          showToast(
                            'success',
                            `«${prod.name}» به دسته «${
                              menuCategoryMap.get(modalTargetMenuCategoryId)?.nameFa || ''
                            }» اضافه شد.`
                          );
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold shrink-0 cursor-pointer hover:bg-emerald-600 hover:text-white transition-colors"
                      >
                        {existingEntry ? 'انتقال دسته' : '+ افزودن'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-600 dark:text-zinc-300">
                {toPersianDigits(modalSelectedProductIds.size)} محصول انتخاب شده
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddProductsModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 text-xs font-bold text-slate-600 dark:text-zinc-300 cursor-pointer"
                >
                  بستن
                </button>
                <button
                  type="button"
                  disabled={modalSelectedProductIds.size === 0 || !modalTargetMenuCategoryId}
                  onClick={() => {
                    const ids = Array.from(modalSelectedProductIds);
                    addErpProductsToMenu(ids, modalTargetMenuCategoryId);
                    const targetName = menuCategoryMap.get(modalTargetMenuCategoryId)?.nameFa || '';
                    showToast(
                      'success',
                      `${toPersianDigits(ids.length)} محصول با موفقیت به دسته «${targetName}» اضافه شدند.`
                    );
                    setModalSelectedProductIds(new Set());
                    setShowAddProductsModal(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer"
                >
                  افزودن {toPersianDigits(modalSelectedProductIds.size)} محصول به دسته انتخابی
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL B: SAFE CATEGORY DELETE & PRODUCT REASSIGNMENT                   */}
      {/* ===================================================================== */}
      {deleteCategoryTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDeleteCategoryTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-[#11131a] border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4 shadow-2xl"
            dir="rtl"
          >
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              حذف دسته‌بندی «{deleteCategoryTarget.nameFa}»
            </h3>
            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
              هم‌اکنون{' '}
              <strong>
                {toPersianDigits(productCountByMenuCategory.get(deleteCategoryTarget.id) || 0)} محصول
              </strong>{' '}
              به این دسته‌بندی منتسب هستند. محصولات از ERP حذف نمی‌شوند؛ مشخص کنید این محصولات به کدام دسته منتقل شوند:
            </p>

            <select
              value={reassignCategoryId}
              onChange={(e) => setReassignCategoryId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
            >
              <option value="">بدون دسته‌بندی (مخفی تا انتساب مجدد)</option>
              {menuCategories
                .filter((c) => c.id !== deleteCategoryTarget.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    انتقال به: {c.nameFa}
                  </option>
                ))}
            </select>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteCategoryTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 text-xs font-bold cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCategory}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
              >
                تایید حذف دسته‌بندی
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
