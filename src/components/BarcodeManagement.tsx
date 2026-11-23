import React, { useState } from 'react';
import { 
  BarcodeSettings, 
  BarcodeProfile, 
  Product, 
  DatabaseSchema 
} from '../types';
import { 
  DEFAULT_BARCODE_PROFILES, 
  DEFAULT_BARCODE_SETTINGS, 
  parseScannedBarcode, 
  generateSampleDibalBarcode, 
  ParsedBarcodeResult 
} from '../utils/barcodeParser';
import { getPeriodBarcodeSettings, setPeriodBarcodeSettings } from '../utils/periodIsolation';
import { nextSimpleId } from '../utils/simpleId';
import { ModuleHeader, ModuleSubTabs, ErpButton, ERP_BUTTON_LABELS } from './ui/UnifiedErpUi';
import CopyFromPeriodModal from './ui/CopyFromPeriodModal';
import { useErpFeedback } from './ui/ToastContext';
import { 
  Barcode, 
  Scale, 
  Settings2, 
  Scan, 
  Plus, 
  Trash2, 
  Edit3, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles,
  Layers,
  HelpCircle,
  Hash,
  Activity,
  FileText,
  Printer,
  Check,
  X,
  Cpu
} from 'lucide-react';

interface BarcodeManagementProps {
  db: DatabaseSchema;
  onUpdateDb: (updatedDb: DatabaseSchema) => void;
  activePeriodId?: string;
}

export const BarcodeManagement: React.FC<BarcodeManagementProps> = ({ db, onUpdateDb, activePeriodId }) => {
  const { toast } = useErpFeedback();
  const resolvedPeriodId = activePeriodId || db.selectedPeriodId || db.periods?.[0]?.id || 'p-1';
  const currentSettings: BarcodeSettings = getPeriodBarcodeSettings(db, resolvedPeriodId) || DEFAULT_BARCODE_SETTINGS;
  const profiles: BarcodeProfile[] = currentSettings.profiles || [];

  // State for tabs & copy modal
  const [activeSubTab, setActiveSubTab] = useState<'profiles' | 'tester' | 'guide'>('profiles');
  const [showCopyModal, setShowCopyModal] = useState(false);

  // State for editing or creating profile
  const [editingProfile, setEditingProfile] = useState<BarcodeProfile | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // General Settings Form state
  const [defaultWeightedPrefix, setDefaultWeightedPrefix] = useState(currentSettings.defaultWeightedPrefix || '20');
  const [defaultCountPrefix, setDefaultCountPrefix] = useState(currentSettings.defaultCountPrefix || '22');
  const [autoParseOnScan, setAutoParseOnScan] = useState(currentSettings.autoParseOnScan ?? true);
  const [enableSoundOnScan, setEnableSoundOnScan] = useState(currentSettings.enableSoundOnScan ?? true);

  React.useEffect(() => {
    setDefaultWeightedPrefix(currentSettings.defaultWeightedPrefix || '20');
    setDefaultCountPrefix(currentSettings.defaultCountPrefix || '22');
    setAutoParseOnScan(currentSettings.autoParseOnScan ?? true);
    setEnableSoundOnScan(currentSettings.enableSoundOnScan ?? true);
  }, [resolvedPeriodId, currentSettings.defaultWeightedPrefix, currentSettings.defaultCountPrefix, currentSettings.autoParseOnScan, currentSettings.enableSoundOnScan]);

  // Profile Form state
  const [profileName, setProfileName] = useState('');
  const [profileType, setProfileType] = useState<'weighted' | 'count' | 'simple'>('weighted');
  const [profileSymbology, setProfileSymbology] = useState<'EAN-13' | 'Code-128' | 'EAN-8' | 'UPC-A'>('EAN-13');
  const [profilePrefix, setProfilePrefix] = useState('20');
  const [itemCodeLength, setItemCodeLength] = useState(5);
  const [valueLength, setValueLength] = useState(5);
  const [unitMultiplier, setUnitMultiplier] = useState(1000);
  const [description, setDescription] = useState('');

  // Live Tester State
  const [testInputBarcode, setTestInputBarcode] = useState('');
  const [testResult, setTestResult] = useState<ParsedBarcodeResult | null>(null);

  // Sample Generator State
  const [genItemCode, setGenItemCode] = useState('101');
  const [genWeightKg, setGenWeightKg] = useState('1.250');
  const [genCount, setGenCount] = useState('3');
  const [genType, setGenType] = useState<'weighted' | 'count'>('weighted');
  const [generatedBarcode, setGeneratedBarcode] = useState('');

  // Save General Settings (period-isolated)
  const handleSaveGeneralSettings = () => {
    const updatedSettings: BarcodeSettings = {
      ...currentSettings,
      defaultWeightedPrefix,
      defaultCountPrefix,
      autoParseOnScan,
      enableSoundOnScan,
      profiles: profiles
    };
    onUpdateDb(setPeriodBarcodeSettings(db, resolvedPeriodId, updatedSettings));
    toast('تنظیمات پایه و پیش‌کدهای بارکد این دوره ذخیره شد.', 'success');
  };

  // Start edit profile
  const handleStartEdit = (prof: BarcodeProfile) => {
    setEditingProfile(prof);
    setIsCreatingNew(false);
    setProfileName(prof.name);
    setProfileType(prof.type as any);
    setProfileSymbology(prof.symbology);
    setProfilePrefix(prof.prefix);
    setItemCodeLength(prof.itemCodeLength);
    setValueLength(prof.valueLength);
    setUnitMultiplier(prof.unitMultiplier);
    setDescription(prof.description || '');
  };

  // Start new profile
  const handleStartNew = () => {
    setEditingProfile(null);
    setIsCreatingNew(true);
    setProfileName('پروفایل بارکد متغیر جدید');
    setProfileType('weighted');
    setProfileSymbology('EAN-13');
    setProfilePrefix('20');
    setItemCodeLength(5);
    setValueLength(5);
    setUnitMultiplier(1000);
    setDescription('پیکربندی بارکد وزن خالص برای ترازوهای فروشگاهی دیبال');
  };

  // Save Profile (Add or Edit)
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) {
      alert('لطفاً عنوان پروفایل بارکد را وارد کنید.');
      return;
    }

    const newProfileObj: BarcodeProfile = {
      id: editingProfile ? editingProfile.id : nextSimpleId(profiles, 'bp'),
      name: profileName,
      type: profileType,
      symbology: profileSymbology,
      prefix: profileType === 'simple' ? '' : profilePrefix,
      itemCodeLength: Number(itemCodeLength) || 5,
      valueLength: profileType === 'simple' ? 0 : (Number(valueLength) || 5),
      hasCheckDigit: profileSymbology === 'EAN-13' || profileSymbology === 'EAN-8',
      unitMultiplier: profileType === 'weighted' ? (Number(unitMultiplier) || 1000) : 1,
      description: description,
      patternSample: profileType === 'weighted' 
        ? `${profilePrefix}CCCCCWWWWWC` 
        : (profileType === 'count' ? `${profilePrefix}CCCCCQQQQQC` : 'CCCCCCCCCCCCC')
    };

    let updatedProfiles: BarcodeProfile[];
    if (editingProfile) {
      updatedProfiles = profiles.map(p => p.id === editingProfile.id ? newProfileObj : p);
    } else {
      updatedProfiles = [...profiles, newProfileObj];
    }

    const updatedSettings: BarcodeSettings = {
      ...currentSettings,
      profiles: updatedProfiles
    };

    onUpdateDb(setPeriodBarcodeSettings(db, resolvedPeriodId, updatedSettings));
    setEditingProfile(null);
    setIsCreatingNew(false);
    toast('پروفایل بارکد با موفقیت ذخیره شد.', 'success');
  };

  // Delete Profile
  const handleDeleteProfile = (id: string) => {
    const updatedProfiles = profiles.filter(p => p.id !== id);
    onUpdateDb(setPeriodBarcodeSettings(db, resolvedPeriodId, {
      ...currentSettings,
      profiles: updatedProfiles
    }));
    toast('پروفایل بارکد حذف شد.', 'info');
  };

  // Test Barcode Parsing (strictly scoped to active period products)
  const handleRunTest = (code: string) => {
    setTestInputBarcode(code);
    if (!code.trim()) {
      setTestResult(null);
      return;
    }
    const periodProducts = (db.products || []).filter(p => p.periodId === resolvedPeriodId);
    const result = parseScannedBarcode(code, periodProducts, currentSettings);
    setTestResult(result);
  };

  // Generate Sample
  const handleGenerateSample = () => {
    const val = genType === 'weighted' ? (parseFloat(genWeightKg) || 1) * 1000 : (parseInt(genCount, 10) || 1);
    const pref = genType === 'weighted' ? defaultWeightedPrefix : defaultCountPrefix;
    const barcode = generateSampleDibalBarcode(genItemCode, val, genType, pref);
    setGeneratedBarcode(barcode);
    handleRunTest(barcode);
  };

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* UNIFIED HEADER & SUB-TABS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
        <ModuleHeader
          icon={<Barcode className="h-5 w-5" />}
          title="تعریف و پیکربندی بارکدها"
          subtitle="تنظیم ساختار بارکدهای وزنی و تعدادی (سازگار با ترازو Dibal 500-SW) و قوانین دیکودر فروش"
          periodName={db.periods?.find(p => p.id === resolvedPeriodId)?.name}
          recordCount={profiles.length}
          recordLabel="پروفایل"
          actions={
            <div className="flex items-center gap-2">
              <ErpButton variant="secondary" size="sm" onClick={() => setShowCopyModal(true)}>
                {ERP_BUTTON_LABELS.copyFromPeriod}
              </ErpButton>
              <ErpButton variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setActiveSubTab('profiles'); handleStartNew(); }}>
                {ERP_BUTTON_LABELS.add}
              </ErpButton>
            </div>
          }
        />

        <ModuleSubTabs
          activeId={activeSubTab}
          onChange={(id) => setActiveSubTab(id as typeof activeSubTab)}
          tabs={[
            { id: 'profiles', label: 'پروفایل‌ها و ساختار بارکد', icon: <Layers className="h-3.5 w-3.5" />, count: profiles.length },
            { id: 'tester', label: 'تست و دیکودر زنده', icon: <Scan className="h-3.5 w-3.5" /> },
            { id: 'guide', label: 'راهنمای EAN-13', icon: <HelpCircle className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: PROFILES & GENERAL SETTINGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'profiles' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: General Configuration Box */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                <Settings2 className="h-5 w-5 text-rose-400" />
                <h3 className="font-black text-sm text-slate-100">
                  تنظیمات سراسری پیش‌کدها
                </h3>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-300 mb-1.5">
                    پیش‌کد پیش‌فرض اقلام وزنی (ترازو):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={3}
                      value={defaultWeightedPrefix}
                      onChange={(e) => setDefaultWeightedPrefix(e.target.value.replace(/\D/g, ''))}
                      className="w-20 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-center font-bold text-rose-400 text-sm focus:border-rose-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">
                      معمولاً <strong className="text-rose-400 font-mono">20</strong> یا <strong className="text-slate-300 font-mono">21</strong> (استاندارد فروشگاهی)
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1.5">
                    پیش‌کد پیش‌فرض اقلام تعدادی / بسته‌ای:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={3}
                      value={defaultCountPrefix}
                      onChange={(e) => setDefaultCountPrefix(e.target.value.replace(/\D/g, ''))}
                      className="w-20 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-center font-bold text-emerald-400 text-sm focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400">
                      معمولاً <strong className="text-emerald-400 font-mono">22</strong> یا <strong className="text-slate-300 font-mono">23</strong>
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 space-y-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoParseOnScan}
                      onChange={(e) => setAutoParseOnScan(e.target.checked)}
                      className="w-4 h-4 text-rose-600 rounded border-slate-700 bg-slate-950 focus:ring-rose-500"
                    />
                    <span className="text-slate-300 font-medium">
                      استخراج و تجزیه خودکار وزن/تعداد هنگام اسکن
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enableSoundOnScan}
                      onChange={(e) => setEnableSoundOnScan(e.target.checked)}
                      className="w-4 h-4 text-rose-600 rounded border-slate-700 bg-slate-950 focus:ring-rose-500"
                    />
                    <span className="text-slate-300 font-medium">
                      صدای بیپ تأیید هنگام شناسایی موفق بارکد
                    </span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleSaveGeneralSettings}
                  className="w-full mt-3 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/20 cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  ذخیره تنظیمات سراسری
                </button>
              </div>
            </div>

            {/* Quick Helper Box */}
            <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 text-xs text-slate-300 space-y-2.5 leading-relaxed">
              <div className="flex items-center gap-2 font-black text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                قاعده طلایی بارکدهای وزنی دیبال:
              </div>
              <p className="text-[11.5px] text-slate-400 leading-relaxed">
                ترازوی Dibal 500-SW وزن ثبت شده را در هنگام چاپ لیبل به صورت ۵ رقم پیوسته به <strong className="text-rose-400">گرم</strong> در دل بارکد EAN-13 می‌گنجاند. سیستم فروش به طور خودکار این ۵ رقم را به ۱۰۰۰ تقسیم کرده و وزن کیلوگرم را در فاکتور می‌نشاند.
              </p>
            </div>
          </div>

          {/* Right Column: Profiles List & Create/Edit Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Action Bar */}
            <div className="flex justify-between items-center bg-slate-900/95 border border-slate-800 p-5 rounded-3xl shadow-xl">
              <div>
                <h3 className="font-black text-sm text-slate-100 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-rose-400" />
                  پروفایل‌های تعریف شده بارکد ({profiles.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  قالب‌های فعال برای شناسایی بارکدهای ساده و متغیر ترازو
                </p>
              </div>
              {!isCreatingNew && !editingProfile && (
                <button
                  type="button"
                  onClick={handleStartNew}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-lg shadow-rose-600/20 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  تعریف پروفایل جدید
                </button>
              )}
            </div>

            {/* CREATE / EDIT FORM */}
            {(isCreatingNew || editingProfile) && (
              <form onSubmit={handleSaveProfile} className="bg-slate-900/95 border-2 border-rose-500/40 rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                  <h4 className="font-black text-sm text-rose-400 flex items-center gap-2">
                    <Edit3 className="h-4 w-4" />
                    {editingProfile ? 'ویرایش پروفایل بارکد' : 'ایجاد ساختار بارکد جدید'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => { setEditingProfile(null); setIsCreatingNew(false); }}
                    className="text-xs text-slate-400 hover:text-rose-400 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <X className="h-3.5 w-3.5" />
                    انصراف
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-300 mb-1.5">
                      عنوان پروفایل:
                    </label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="مثلاً: بارکد وزنی ترازوی دیبال (گرم)"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:border-rose-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-300 mb-1.5">
                      نوع بارکد:
                    </label>
                    <select
                      value={profileType}
                      onChange={(e) => {
                        const t = e.target.value as any;
                        setProfileType(t);
                        if (t === 'weighted') { setProfilePrefix('20'); setUnitMultiplier(1000); }
                        else if (t === 'count') { setProfilePrefix('22'); setUnitMultiplier(1); }
                        else { setProfilePrefix(''); setUnitMultiplier(1); }
                      }}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:border-rose-500 focus:outline-none cursor-pointer"
                    >
                      <option value="weighted">بارکد متغیر وزنی (حاوی وزن خالص به گرم)</option>
                      <option value="count">بارکد متغیر تعدادی (حاوی تعداد عددی کالا)</option>
                      <option value="simple">بارکد ثابت شرکتی (بدون داده متغیر)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-300 mb-1.5">
                      نوع استاندارد سمبولوژی (Symbology):
                    </label>
                    <select
                      value={profileSymbology}
                      onChange={(e) => setProfileSymbology(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:border-rose-500 focus:outline-none cursor-pointer"
                    >
                      <option value="EAN-13">EAN-13 (استاندارد اصلی ترازوهای فروشگاهی)</option>
                      <option value="Code-128">Code-128 (بارکد میله‌ای طول متغیر)</option>
                      <option value="EAN-8">EAN-8 (بارکد کوتاه ۸ رقمی)</option>
                      <option value="UPC-A">UPC-A (استاندارد ۱۲ رقمی)</option>
                    </select>
                  </div>

                  {profileType !== 'simple' && (
                    <div>
                      <label className="block font-bold text-slate-300 mb-1.5">
                        پیش‌کد شناسایی (Prefix):
                      </label>
                      <input
                        type="text"
                        maxLength={4}
                        value={profilePrefix}
                        onChange={(e) => setProfilePrefix(e.target.value.replace(/\D/g, ''))}
                        placeholder="20"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-rose-400 font-bold focus:border-rose-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {profileType !== 'simple' && (
                    <>
                      <div>
                        <label className="block font-bold text-slate-300 mb-1.5">
                          تعداد ارقام کد کالا / PLU:
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={6}
                          value={itemCodeLength}
                          onChange={(e) => setItemCodeLength(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono focus:border-rose-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-slate-300 mb-1.5">
                          تعداد ارقام داده متغیر (وزن یا تعداد):
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={6}
                          value={valueLength}
                          onChange={(e) => setValueLength(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono focus:border-rose-500 focus:outline-none"
                        />
                      </div>
                    </>
                  )}

                  <div className="md:col-span-2">
                    <label className="block font-bold text-slate-300 mb-1.5">
                      توضیحات و الگوی ساختار:
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="توضیحات اختیاری در مورد این پروفایل..."
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:border-rose-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Live Formula Preview */}
                <div className="bg-slate-950 text-slate-300 p-3.5 rounded-2xl font-mono text-xs flex items-center justify-between border border-slate-800">
                  <span className="text-slate-400 font-bold">فرمول ساختار:</span>
                  <span className="font-bold text-rose-400 dir-ltr">
                    {profileType === 'weighted' 
                      ? `[پیش‌کد: ${profilePrefix}] + [کد کالا: ${itemCodeLength} رقم] + [وزن خالص: ${valueLength} رقم] + [چک‌سام: ۱ رقم]` 
                      : (profileType === 'count' 
                        ? `[پیش‌کد: ${profilePrefix}] + [کد کالا: ${itemCodeLength} رقم] + [تعداد: ${valueLength} رقم] + [چک‌سام: ۱ رقم]`
                        : 'بارکد ثابت شرکتی استاندارد')}
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setEditingProfile(null); setIsCreatingNew(false); }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-rose-600/20 cursor-pointer"
                  >
                    <Save className="h-4 w-4" />
                    ذخیره پروفایل
                  </button>
                </div>
              </form>
            )}

            {/* PROFILES LIST CARDS */}
            <div className="grid grid-cols-1 gap-3.5">
              {profiles.map((prof) => {
                const isWeighted = prof.type === 'weighted';
                const isCount = prof.type === 'count';
                return (
                  <div
                    key={prof.id}
                    className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 shadow-xl hover:border-slate-700 transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-black border ${
                          isWeighted 
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            : (isCount 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-slate-800 text-slate-300 border-slate-700')
                        }`}>
                          {isWeighted ? 'متغیر وزنی (گرم)' : (isCount ? 'متغیر تعدادی' : 'بارکد ثابت')}
                        </span>
                        <h4 className="font-bold text-sm text-slate-100">
                          {prof.name}
                        </h4>
                        <span className="font-mono text-[11px] bg-slate-950 px-2.5 py-0.5 rounded-full text-slate-400 border border-slate-800">
                          {prof.symbology}
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        {prof.description || 'ساختار تعریف شده برای سیستم بارکدخوان و ترازو'}
                      </p>

                      <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400 pt-1 font-mono">
                        {prof.prefix && (
                          <span className="bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                            پیش‌کد: <strong className="text-rose-400">{prof.prefix}</strong>
                          </span>
                        )}
                        {prof.itemCodeLength > 0 && (
                          <span className="bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                            طول کد کالا: <strong className="text-cyan-400">{prof.itemCodeLength} رقم</strong>
                          </span>
                        )}
                        {prof.valueLength > 0 && (
                          <span className="bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                            طول داده {isWeighted ? 'وزن' : 'تعداد'}: <strong className="text-emerald-400">{prof.valueLength} رقم</strong>
                          </span>
                        )}
                        {prof.patternSample && (
                          <span className="text-amber-400 font-bold bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                            الگو: {prof.patternSample}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(prof)}
                        className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 rounded-xl transition-all cursor-pointer"
                        title="ویرایش"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(prof.id)}
                        className="p-2.5 bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 rounded-xl transition-all cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: SCANNER TESTER & GENERATOR */}
      {/* ========================================================================= */}
      {activeSubTab === 'tester' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Box 1: Scanner Input & Live Decoder */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
                  <Scan className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-100">
                    دیکودر و شبیه‌ساز اسکنر بارکدخوان
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    بارکد را با بارکدخوان اسکن کنید یا دستی تایپ نمایید
                  </p>
                </div>
              </div>

              {testResult && (
                <button
                  type="button"
                  onClick={() => { setTestInputBarcode(''); setTestResult(null); }}
                  className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  پاکسازی
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                ورودی بارکد (۱۳ رقمی EAN-13 یا دستی):
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  value={testInputBarcode}
                  onChange={(e) => handleRunTest(e.target.value)}
                  placeholder="مثال: 2000101012503 (کد ۱۰۱ با وزن ۱.۲۵۰ کیلوگرم)"
                  className="w-full pl-10 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-2xl font-mono text-base font-bold text-rose-400 focus:border-rose-500 focus:outline-none shadow-inner"
                />
                <Barcode className="absolute left-3.5 top-3.5 h-5 w-5 text-slate-500" />
              </div>
            </div>

            {/* Quick Demo Buttons */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-400">بارکدهای نمونه برای تست سریع:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleRunTest('2000101012503')}
                  className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-rose-400 border border-slate-800 rounded-xl font-mono text-xs transition-colors cursor-pointer"
                >
                  2000101012503 (وزنی 1.250kg)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunTest('2000045007508')}
                  className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-rose-400 border border-slate-800 rounded-xl font-mono text-xs transition-colors cursor-pointer"
                >
                  2000045007508 (وزنی 750g)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunTest('2200088000059')}
                  className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-slate-800 rounded-xl font-mono text-xs transition-colors cursor-pointer"
                >
                  2200088000059 (تعدادی ۵ عدد)
                </button>
              </div>
            </div>

            {/* PARSED RESULT PANEL */}
            {testResult && (
              <div className={`p-4 rounded-2xl border space-y-3 animate-in fade-in duration-150 ${
                testResult.error 
                  ? 'bg-rose-950/20 border-rose-500/30'
                  : 'bg-emerald-950/20 border-emerald-500/30'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {testResult.error ? (
                      <AlertCircle className="h-5 w-5 text-rose-400" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    )}
                    <span className="font-black text-xs text-slate-100">
                      {testResult.error ? 'عدم تطابق یا خطای بارکد' : 'بارکد با موفقیت دیکود و تفکیک شد'}
                    </span>
                  </div>

                  <span className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold ${
                    testResult.type === 'weighted'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : (testResult.type === 'count' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-300')
                  }`}>
                    {testResult.type === 'weighted' ? 'بارکد وزنی' : (testResult.type === 'count' ? 'بارکد تعدادی' : 'بارکد ثابت')}
                  </span>
                </div>

                {testResult.error ? (
                  <p className="text-xs text-rose-300 leading-relaxed">
                    {testResult.error}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <span className="block text-[10px] text-slate-400 mb-0.5">پیش‌کد:</span>
                      <strong className="font-mono text-sm text-rose-400">
                        {testResult.prefix || '-'}
                      </strong>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <span className="block text-[10px] text-slate-400 mb-0.5">کد کالا / PLU:</span>
                      <strong className="font-mono text-sm text-cyan-400">
                        {testResult.itemCode || '-'}
                      </strong>
                    </div>

                    {testResult.type === 'weighted' && (
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 col-span-2">
                        <span className="block text-[10px] text-slate-400 mb-0.5">وزن خالص استخراج شده:</span>
                        <strong className="font-mono text-sm text-emerald-400">
                          {testResult.extractedWeightKg} کیلوگرم ({testResult.extractedWeightGram} گرم)
                        </strong>
                      </div>
                    )}

                    {testResult.type === 'count' && (
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 col-span-2">
                        <span className="block text-[10px] text-slate-400 mb-0.5">تعداد استخراج شده:</span>
                        <strong className="font-mono text-sm text-emerald-400">
                          {testResult.extractedCount} عدد / بسته
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Matched Product Details */}
                {testResult.matchedProduct ? (
                  <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 text-xs flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">کالای منطبق در انبار:</span>
                      <strong className="text-slate-100 text-sm">
                        {testResult.matchedProduct.name}
                      </strong>
                      <span className="text-slate-500 mr-2 font-mono">
                        (کد: {testResult.matchedProduct.sku} | واحد: {testResult.matchedProduct.unit})
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-[10px] text-slate-400 block">قیمت واحد:</span>
                      <strong className="text-rose-400 font-mono text-sm">
                        {testResult.matchedProduct.price.toLocaleString('fa-IR')} ریال
                      </strong>
                    </div>
                  </div>
                ) : (
                  !testResult.error && (
                    <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 p-3 rounded-xl leading-relaxed">
                      کد کالای استخراج شده ({testResult.itemCode}) در لیست محصولات نهایی فعلی ثبت نشده است. برای اتصال، در فرم تعریف محصول، کد شناسایی بارکد متغیر را برابر {testResult.itemCode} قرار دهید.
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Box 2: Dibal Barcode Generator & Label Tester */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-black text-sm text-slate-100">
                  تولیدکننده بارکد نمونه ترازوی دیبال
                </h3>
                <p className="text-[11px] text-slate-400">
                  محاسبه آنلاین Check-Digit الگوریتم EAN-13 برای بررسی و پرینت لیبل
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1.5">
                  نوع داده:
                </label>
                <select
                  value={genType}
                  onChange={(e) => setGenType(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:border-rose-500 focus:outline-none cursor-pointer"
                >
                  <option value="weighted">وزنی (کیلوگرم / گرم)</option>
                  <option value="count">تعدادی (عدد / بسته)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1.5">
                  کد کالا / PLU ترازو:
                </label>
                <input
                  type="text"
                  value={genItemCode}
                  onChange={(e) => setGenItemCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="101"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-center font-bold text-cyan-400 focus:border-rose-500 focus:outline-none"
                />
              </div>

              {genType === 'weighted' ? (
                <div className="col-span-2">
                  <label className="block font-bold text-slate-300 mb-1.5">
                    وزن کالا (کیلوگرم):
                  </label>
                  <input
                    type="number"
                    step="0.005"
                    value={genWeightKg}
                    onChange={(e) => setGenWeightKg(e.target.value)}
                    placeholder="1.250"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-center font-bold text-emerald-400 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="col-span-2">
                  <label className="block font-bold text-slate-300 mb-1.5">
                    تعداد عددی:
                  </label>
                  <input
                    type="number"
                    value={genCount}
                    onChange={(e) => setGenCount(e.target.value)}
                    placeholder="3"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-center font-bold text-emerald-400 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleGenerateSample}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              تولید بارکد استاندارد EAN-13
            </button>

            {/* Generated Output Display */}
            {generatedBarcode && (
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl text-center space-y-2.5">
                <span className="text-[11px] text-slate-400 block font-bold">
                  بارکد ۱۳ رقمی نهایی با رقم کنترلی EAN-13:
                </span>
                <div className="font-mono text-2xl font-black tracking-widest text-amber-400 dir-ltr select-all">
                  {generatedBarcode}
                </div>
                <div className="flex justify-center items-center gap-3 text-[11px] text-slate-300 pt-1 font-mono">
                  <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">پیش‌کد: <strong className="text-rose-400">{generatedBarcode.slice(0, 2)}</strong></span>
                  <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">کد کالا: <strong className="text-cyan-400">{generatedBarcode.slice(2, 7)}</strong></span>
                  <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">داده: <strong className="text-emerald-400">{generatedBarcode.slice(7, 12)}</strong></span>
                  <span className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">چک‌سام: <strong className="text-amber-400">{generatedBarcode.slice(12, 13)}</strong></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: DIBAL SCALE EAN-13 SPECIFICATION GUIDE */}
      {/* ========================================================================= */}
      {activeSubTab === 'guide' && (
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6 text-xs text-slate-300 leading-relaxed">
          <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl">
              <FileText className="h-5 w-5" />
            </div>
            <h3 className="font-black text-sm text-slate-100">
              راهنمای فنی ساختار بارکدهای متغیر ترازوی دیبال (Dibal 500-SW / Series 500)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80 space-y-2">
              <h4 className="font-bold text-slate-100 flex items-center gap-1.5 text-xs text-rose-400">
                <Hash className="h-4 w-4" />
                ۱. بخش پیش‌کد (Prefix - ۲ رقم):
              </h4>
              <p className="text-[11.5px] text-slate-400 leading-relaxed">
                مشخص‌کننده نوع داده است. ارقام <strong className="text-rose-400 font-mono">20</strong> یا <strong className="text-rose-400 font-mono">21</strong> برای کالاهای وزنی فروشگاهی و ارقام <strong className="text-emerald-400 font-mono">22</strong> یا <strong className="text-emerald-400 font-mono">23</strong> برای اقلام تعدادی تعریف می‌شوند.
              </p>
            </div>

            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80 space-y-2">
              <h4 className="font-bold text-slate-100 flex items-center gap-1.5 text-xs text-cyan-400">
                <Activity className="h-4 w-4" />
                ۲. کد کالا / PLU (۵ رقم):
              </h4>
              <p className="text-[11.5px] text-slate-400 leading-relaxed">
                شناسه عددی محصول در حافظه ترازو که با صفرهای ابتدایی پر می‌شود (مثلاً کد ۲۵ به صورت <code className="font-mono text-cyan-400 bg-slate-900 px-1 py-0.5 rounded">00025</code> درج می‌گردد).
              </p>
            </div>

            <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800/80 space-y-2">
              <h4 className="font-bold text-slate-100 flex items-center gap-1.5 text-xs text-emerald-400">
                <Scale className="h-4 w-4" />
                ۳. داده متغیر وزن / تعداد (۵ رقم):
              </h4>
              <p className="text-[11.5px] text-slate-400 leading-relaxed">
                وزن خالص خوانده شده از کفه ترازو به گرم (مثلاً <code className="font-mono text-emerald-400 bg-slate-900 px-1 py-0.5 rounded">01250</code> برای ۱.۲۵۰ کیلوگرم) یا تعداد بسته‌ها.
              </p>
            </div>
          </div>

          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-3">
            <h4 className="font-black text-slate-200 text-xs">نمونه تصویر فرضی خوانش بارکد ۱۳ رقمی:</h4>
            <div className="font-mono text-base text-emerald-300 bg-slate-900 p-3.5 rounded-xl text-center dir-ltr tracking-widest border border-slate-800 font-bold">
              <span className="text-rose-400">20</span> - <span className="text-cyan-400">00101</span> - <span className="text-amber-400">01250</span> - <span className="text-emerald-400">3</span>
            </div>
            <div className="flex justify-around text-[10.5px] text-slate-400 text-center pt-1 font-mono">
              <span className="text-rose-400">پیش‌کد وزنی (20)</span>
              <span className="text-cyan-400">کد کالا (101)</span>
              <span className="text-amber-400">وزن: ۱۲۵۰ گرم (1.250kg)</span>
              <span className="text-emerald-400">چک‌سام خودکار (3)</span>
            </div>
          </div>
        </div>
      )}
      <CopyFromPeriodModal
        open={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        db={db}
        targetPeriodId={resolvedPeriodId}
        section="barcodeSettings"
        onUpdateDb={onUpdateDb}
      />
    </div>
  );
};
