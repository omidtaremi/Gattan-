import React, { useState, useMemo } from 'react';
import { AppDatabase, MonthlyWorkdaySetting, PayrollCalculationRules, OfficialHoliday } from '../types';
import { toPersianDigits, toEnglishDigits, parseNumber, formatWithCommas, getFiscalYearFromPeriod } from '../utils/persianUtils';
import { getPeriodPayrollRules, setPeriodPayrollRules } from '../utils/periodIsolation';
import { nextSimpleId, createSimpleIdGenerator, getPrefixForCollection } from '../utils/simpleId';
import * as XLSX from 'xlsx';
import { 
  Calendar, Clock, Plus, Trash2, Edit3, Settings, X, Check, FileSpreadsheet, Download, Search, AlertTriangle, CheckSquare, Square, Info
} from 'lucide-react';

interface AttendanceSettingsFormProps {
  db: AppDatabase;
  onUpdateDb: (updated: AppDatabase) => void;
  activePeriodId?: string;
}

export default function AttendanceSettingsForm({ db, onUpdateDb, activePeriodId }: AttendanceSettingsFormProps) {
  const effectivePeriodId = activePeriodId || db.periods?.[0]?.id || 'p-1';
  const activePeriodObj = useMemo(() => (db.periods || []).find(p => p.id === effectivePeriodId), [db.periods, effectivePeriodId]);
  const defaultFiscalYearStr = String(getFiscalYearFromPeriod(activePeriodObj, effectivePeriodId));

  // Search and Filter states
  const [workdayYearFilter, setWorkdayYearFilter] = useState<string>(defaultFiscalYearStr);
  const [holidayYearFilter, setHolidayYearFilter] = useState<string>(defaultFiscalYearStr);

  // Workday form states
  const [editingWorkdayId, setEditingWorkdayId] = useState<string | null>(null);
  const [workdayYear, setWorkdayYear] = useState<string>('1405');
  const [workdayMonth, setWorkdayMonth] = useState<string>('1');
  const [workdayDaysInMonth, setWorkdayDaysInMonth] = useState<string>('31');
  const [workdayFridaysCount, setWorkdayFridaysCount] = useState<string>('4');
  const [workdayNonFridayHolidays, setWorkdayNonFridayHolidays] = useState<string>('0');
  const [workdayWorkingDaysCount, setWorkdayWorkingDaysCount] = useState<string>('27');
  const [workdayRequiredWorkHours, setWorkdayRequiredWorkHours] = useState<string>('192');

  // Holiday form states
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [holidayYear, setHolidayYear] = useState<string>('1405');
  const [holidayDate, setHolidayDate] = useState<string>('');

  // Tax Exemption form states
  const [editingExId, setEditingExId] = useState<string | null>(null);
  const [exYear, setExYear] = useState<string>('1403');
  const [exLimit, setExLimit] = useState<string>('');
  const [exSearchQuery, setExSearchQuery] = useState<string>('');

  // Tax Brackets form states
  const [editingBracketId, setEditingBracketId] = useState<string | null>(null);
  const [bracketYear, setBracketYear] = useState<string>('1403');
  const [bracketFrom, setBracketFrom] = useState<string>('');
  const [bracketTo, setBracketTo] = useState<string>('');
  const [bracketRate, setBracketRate] = useState<string>('');
  const [bracketSearchQuery, setBracketSearchQuery] = useState<string>('');

  // Rules states (strictly period-isolated)
  const rules = useMemo<PayrollCalculationRules>(() => {
    const baseRules = getPeriodPayrollRules(db, effectivePeriodId);
    return {
      ...baseRules,
      deductDailyBreakTime: baseRules.deductDailyBreakTime ?? true,
      dailyBreakDurationMinutes: baseRules.dailyBreakDurationMinutes ?? 40,
      calculatePayrollTax: baseRules.calculatePayrollTax ?? false
    };
  }, [db, effectivePeriodId]);

  const [calcNotification, setCalcNotification] = useState<string | null>(null);

  // Auto-calculate Workdays and Hours
  const handleAutoCalculate = () => {
    const totalDays = parseInt(toEnglishDigits(workdayDaysInMonth)) || 0;
    const fridays = parseInt(toEnglishDigits(workdayFridaysCount)) || 0;
    const holidays = parseInt(toEnglishDigits(workdayNonFridayHolidays)) || 0;
    
    const workingDays = Math.max(0, totalDays - fridays - holidays);
    const requiredHours = workingDays * 8; // Default 8 hours per working day
    
    setWorkdayWorkingDaysCount(workingDays.toString());
    setWorkdayRequiredWorkHours(requiredHours.toString());
  };

  // Update calculation rules in database (scoped to effectivePeriodId)
  const updateRule = <K extends keyof PayrollCalculationRules>(key: K, value: PayrollCalculationRules[K]) => {
    const updatedRules = { ...rules, [key]: value };
    onUpdateDb(setPeriodPayrollRules(db, effectivePeriodId, updatedRules));
    setCalcNotification('تغییرات محاسبات حقوق با موفقیت در دیتابیس ثبت گردید.');
    setTimeout(() => setCalcNotification(null), 3000);
  };

  // Submit Workday Setting
  const handleSaveWorkdaySetting = (e: React.FormEvent) => {
    e.preventDefault();
    const year = parseInt(toEnglishDigits(workdayYear)) || 1405;
    const month = parseInt(toEnglishDigits(workdayMonth)) || 1;
    const days = parseInt(toEnglishDigits(workdayDaysInMonth)) || 0;
    const fridays = parseInt(toEnglishDigits(workdayFridaysCount)) || 0;
    const nonFridays = parseInt(toEnglishDigits(workdayNonFridayHolidays)) || 0;
    const workingDays = parseInt(toEnglishDigits(workdayWorkingDaysCount)) || 0;
    const reqHours = parseInt(toEnglishDigits(workdayRequiredWorkHours)) || 0;

    const allList = db.monthlyWorkdaySettings || [];
    const currentList = allList.filter(item => item.periodId === effectivePeriodId);

    // Check if duplicate month for the same year within active period
    const isDuplicate = currentList.some(
      item => item.year === year && item.month === month && item.id !== editingWorkdayId
    );

    if (isDuplicate) {
      alert(`تنظیمات مربوط به ماه ${month} سال ${year} قبلاً ثبت شده است.`);
      return;
    }

    let updatedList: MonthlyWorkdaySetting[];
    if (editingWorkdayId) {
      updatedList = allList.map(item => 
        item.id === editingWorkdayId 
          ? { id: editingWorkdayId, periodId: effectivePeriodId, year, month, daysInMonth: days, fridaysCount: fridays, nonFridayHolidays: nonFridays, workingDaysCount: workingDays, requiredWorkHours: reqHours }
          : item
      );
      setEditingWorkdayId(null);
    } else {
      const newSetting: MonthlyWorkdaySetting = {
        id: nextSimpleId(allList, getPrefixForCollection('monthlyWorkdaySettings')),
        periodId: effectivePeriodId,
        year,
        month,
        daysInMonth: days,
        fridaysCount: fridays,
        nonFridayHolidays: nonFridays,
        workingDaysCount: workingDays,
        requiredWorkHours: reqHours
      };
      updatedList = [...allList, newSetting];
    }

    onUpdateDb({
      ...db,
      monthlyWorkdaySettings: updatedList
    });

    // Reset Form
    setWorkdayMonth((prev => {
      const parsed = parseInt(prev) || 1;
      return parsed < 12 ? (parsed + 1).toString() : '1';
    })());
  };

  const handleEditWorkday = (item: MonthlyWorkdaySetting) => {
    setEditingWorkdayId(item.id);
    setWorkdayYear(item.year.toString());
    setWorkdayMonth(item.month.toString());
    setWorkdayDaysInMonth(item.daysInMonth.toString());
    setWorkdayFridaysCount(item.fridaysCount.toString());
    setWorkdayNonFridayHolidays(item.nonFridayHolidays.toString());
    setWorkdayWorkingDaysCount(item.workingDaysCount.toString());
    setWorkdayRequiredWorkHours(item.requiredWorkHours.toString());
  };

  const handleDeleteWorkday = (id: string) => {
    if (confirm('آیا از حذف این ردیف تنظیم کارکرد موظفی مطمئن هستید؟')) {
      const currentList = db.monthlyWorkdaySettings || [];
      onUpdateDb({
        ...db,
        monthlyWorkdaySettings: currentList.filter(item => item.id !== id)
      });
    }
  };

  // Submit Official Holiday
  const handleSaveHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    const year = parseInt(toEnglishDigits(holidayYear)) || 1405;
    const dateStr = toEnglishDigits(holidayDate).trim();

    if (!dateStr || !/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
      alert('لطفاً تاریخ را با فرمت صحیح YYYY/MM/DD وارد نمایید (مثال: 1405/01/01)');
      return;
    }

    const allList = db.officialHolidays || [];
    const currentList = allList.filter(item => item.periodId === effectivePeriodId);

    // Check duplicate within active period
    if (currentList.some(item => item.date === dateStr && item.id !== editingHolidayId)) {
      alert('این تاریخ تعطیلی قبلاً ثبت شده است.');
      return;
    }

    let updatedList: OfficialHoliday[];
    if (editingHolidayId) {
      updatedList = allList.map(item => 
        item.id === editingHolidayId 
          ? { id: editingHolidayId, periodId: effectivePeriodId, year, date: dateStr }
          : item
      );
      setEditingHolidayId(null);
    } else {
      const newHoliday: OfficialHoliday = {
        id: nextSimpleId(allList, getPrefixForCollection('officialHolidays')),
        periodId: effectivePeriodId,
        year,
        date: dateStr
      };
      updatedList = [...allList, newHoliday];
    }

    onUpdateDb({
      ...db,
      officialHolidays: updatedList
    });

    setHolidayDate('');
  };

  const handleEditHoliday = (item: OfficialHoliday) => {
    setEditingHolidayId(item.id);
    setHolidayYear(item.year.toString());
    setHolidayDate(item.date);
  };

  const handleDeleteHoliday = (id: string) => {
    if (confirm('آیا از حذف این روز تعطیل رسمی مطمئن هستید؟')) {
      const currentList = db.officialHolidays || [];
      onUpdateDb({
        ...db,
        officialHolidays: currentList.filter(item => item.id !== id)
      });
    }
  };

  // ====== TAX EXEMPTION CRUD ======
  const handleSaveExemption = (e: React.FormEvent) => {
    e.preventDefault();
    const year = parseInt(toEnglishDigits(exYear)) || 1403;
    const limitNum = parseFloat(toEnglishDigits(exLimit).replace(/,/g, '')) || 0;

    if (limitNum <= 0) {
      alert('لطفاً مبلغ معافیت حقوق معتبری وارد نمایید.');
      return;
    }

    const allList = db.taxExemptions || [];
    const currentList = allList.filter(item => item.periodId === effectivePeriodId);
    const isDuplicate = currentList.some(item => Number(item.fiscalYear) === year && item.id !== editingExId);
    if (isDuplicate) {
      alert(`سقف معافیت برای سال مالی ${toPersianDigits(year)} قبلاً ثبت شده است.`);
      return;
    }

    let updatedList: any[];
    if (editingExId) {
      updatedList = allList.map(item =>
        item.id === editingExId ? { ...item, periodId: effectivePeriodId, fiscalYear: year.toString(), exemptionLimit: limitNum } : item
      );
    } else {
      updatedList = [
        ...allList,
        { id: nextSimpleId(allList, getPrefixForCollection('taxExemptions')), periodId: effectivePeriodId, fiscalYear: year.toString(), exemptionLimit: limitNum }
      ];
    }

    onUpdateDb({
      ...db,
      taxExemptions: updatedList
    });

    setEditingExId(null);
    setExLimit('');
    alert(editingExId ? 'سقف معافیت حقوق با موفقیت ویرایش شد.' : 'سقف معافیت حقوق جدید با موفقیت ثبت شد.');
  };

  const handleEditExemption = (item: any) => {
    setEditingExId(item.id);
    setExYear(String(item.fiscalYear));
    setExLimit(formatWithCommas(item.exemptionLimit));
  };

  const handleDeleteExemption = (id: string) => {
    if (confirm('آیا از حذف این سقف معافیت اطمینان دارید؟')) {
      const remaining = (db.taxExemptions || []).filter(item => item.id !== id);
      onUpdateDb({
        ...db,
        taxExemptions: remaining
      });
      alert('آیتم مربوطه با موفقیت حذف گردید.');
    }
  };

  // ====== TAX BRACKETS CRUD ======
  const handleSaveBracket = (e: React.FormEvent) => {
    e.preventDefault();
    const year = parseInt(toEnglishDigits(bracketYear)) || 1403;
    const fromVal = parseFloat(toEnglishDigits(bracketFrom).replace(/,/g, '')) || 0;
    const toValText = toEnglishDigits(bracketTo).replace(/,/g, '');
    const toVal = toValText === '' ? null : (parseFloat(toValText) || 0);
    const rateVal = parseFloat(toEnglishDigits(bracketRate)) || 0;

    if (toVal !== null && toVal <= fromVal) {
      alert('مبلغ "تا مبلغ" باید بزرگتر از "از مبلغ" باشد.');
      return;
    }

    const allList = db.taxBrackets || [];

    let updatedList: any[];
    if (editingBracketId) {
      updatedList = allList.map(item =>
        item.id === editingBracketId ? { ...item, periodId: effectivePeriodId, fiscalYear: year.toString(), fromAmount: fromVal, toAmount: toVal, taxRate: rateVal } : item
      );
    } else {
      updatedList = [
        ...allList,
        { id: nextSimpleId(allList, getPrefixForCollection('taxBrackets')), periodId: effectivePeriodId, fiscalYear: year.toString(), fromAmount: fromVal, toAmount: toVal, taxRate: rateVal }
      ];
    }

    onUpdateDb({
      ...db,
      taxBrackets: updatedList
    });

    setEditingBracketId(null);
    setBracketFrom('');
    setBracketTo('');
    setBracketRate('');
    alert(editingBracketId ? 'طبقه مالیاتی با موفقیت ویرایش شد.' : 'طبقه مالیاتی جدید با موفقیت ثبت شد.');
  };

  const handleEditBracket = (item: any) => {
    setEditingBracketId(item.id);
    setBracketYear(String(item.fiscalYear));
    setBracketFrom(formatWithCommas(item.fromAmount));
    setBracketTo(item.toAmount !== null ? formatWithCommas(item.toAmount) : '');
    setBracketRate(String(item.taxRate));
  };

  const handleDeleteBracket = (id: string) => {
    if (confirm('آیا از حذف این طبقه مالیاتی اطمینان دارید؟')) {
      const remaining = (db.taxBrackets || []).filter(item => item.id !== id);
      onUpdateDb({
        ...db,
        taxBrackets: remaining
      });
      alert('طبقه مالیاتی مربوطه با موفقیت حذف گردید.');
    }
  };

  // EXCEL EXPORTS (period-isolated)
  const handleExportWorkdaysExcel = () => {
    const list = (db.monthlyWorkdaySettings || []).filter(item => item.periodId === effectivePeriodId);
    const formatted = list.map(item => ({
      'سال': item.year,
      'ماه': item.month,
      'روزهای ماه': item.daysInMonth,
      'تعداد جمعه': item.fridaysCount,
      'تعطیل غیر جمعه': item.nonFridayHolidays,
      'تعداد روز کاری': item.workingDaysCount,
      'ساعت کار موظفی': item.requiredWorkHours
    }));

    const ws = XLSX.utils.json_to_sheet(formatted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Workdays");
    XLSX.writeFile(wb, "Gatan_Monthly_Workdays_Template.xlsx");
  };

  const handleExportHolidaysExcel = () => {
    const list = (db.officialHolidays || []).filter(item => item.periodId === effectivePeriodId);
    const formatted = list.map(item => ({
      'سال': item.year,
      'تاریخ': item.date
    }));

    const ws = XLSX.utils.json_to_sheet(formatted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Holidays");
    XLSX.writeFile(wb, "Gatan_Official_Holidays_Template.xlsx");
  };

  // EXCEL IMPORTS
  const handleImportWorkdaysExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          alert('فایل اکسل تهی است یا برگه معتبری ندارد.');
          return;
        }
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          alert('برگه معتبری در فایل اکسل یافت نشد.');
          return;
        }
        const rows = XLSX.utils.sheet_to_json<any>(sheet);

        const imported: MonthlyWorkdaySetting[] = [];
        const allCurrentWorkdays = db.monthlyWorkdaySettings || [];
        const genMwsId = createSimpleIdGenerator(allCurrentWorkdays, getPrefixForCollection('monthlyWorkdaySettings'));

        const getRowVal = (row: any, possibleKeys: string[]) => {
          const keys = Object.keys(row);
          for (const pk of possibleKeys) {
            const pkNorm = pk.replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase();
            const foundKey = keys.find(k => k.trim().replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase() === pkNorm);
            if (foundKey !== undefined) {
              return row[foundKey];
            }
          }
          return undefined;
        };

        for (const row of rows) {
          if (!row) continue;

          const rawYear = getRowVal(row, ['سال', 'year', 'yr']);
          const rawMonth = getRowVal(row, ['ماه', 'month', 'm']);

          const year = parseInt(toEnglishDigits(rawYear !== undefined && rawYear !== null ? rawYear.toString() : '')) || 0;
          const month = parseInt(toEnglishDigits(rawMonth !== undefined && rawMonth !== null ? rawMonth.toString() : '')) || 0;

          if (year && month) {
            const rawDaysInMonth = getRowVal(row, ['روزهای ماه', 'daysInMonth', 'days_in_month', 'روزها']);
            const rawFridaysCount = getRowVal(row, ['تعداد جمعه', 'fridaysCount', 'fridays_count', 'جمعه‌ها', 'جمعه ها']);
            const rawNonFridayHolidays = getRowVal(row, ['تعطیل غیر جمعه', 'nonFridayHolidays', 'non_friday_holidays', 'تعطیلات غیر جمعه']);
            const rawWorkingDaysCount = getRowVal(row, ['تعداد روز کاری', 'workingDaysCount', 'working_days_count', 'روزهای کاری']);
            const rawRequiredWorkHours = getRowVal(row, ['ساعت کار موظفی', 'requiredWorkHours', 'required_work_hours', 'ساعت موظفی']);

            imported.push({
              id: genMwsId(),
              periodId: effectivePeriodId,
              year,
              month,
              daysInMonth: parseInt(toEnglishDigits(rawDaysInMonth !== undefined && rawDaysInMonth !== null ? rawDaysInMonth.toString() : '')) || 30,
              fridaysCount: parseInt(toEnglishDigits(rawFridaysCount !== undefined && rawFridaysCount !== null ? rawFridaysCount.toString() : '')) || 4,
              nonFridayHolidays: parseInt(toEnglishDigits(rawNonFridayHolidays !== undefined && rawNonFridayHolidays !== null ? rawNonFridayHolidays.toString() : '')) || 0,
              workingDaysCount: parseInt(toEnglishDigits(rawWorkingDaysCount !== undefined && rawWorkingDaysCount !== null ? rawWorkingDaysCount.toString() : '')) || 26,
              requiredWorkHours: parseInt(toEnglishDigits(rawRequiredWorkHours !== undefined && rawRequiredWorkHours !== null ? rawRequiredWorkHours.toString() : '')) || 176
            });
          }
        }

        if (imported.length === 0) {
          alert('هیچ ردیف معتبری در فایل اکسل یافت نشد. لطفاً از صحت ستون‌ها اطمینان حاصل فرمایید.');
          return;
        }

        // Merge without duplicates within effectivePeriodId (preserving other periods)
        const merged = [...allCurrentWorkdays];
        imported.forEach(imp => {
          const idx = merged.findIndex(c => c.periodId === effectivePeriodId && c.year === imp.year && c.month === imp.month);
          if (idx >= 0) {
            merged[idx] = { ...imp, id: merged[idx].id }; // update preserving id
          } else {
            merged.push(imp); // add new
          }
        });

        onUpdateDb({
          ...db,
          monthlyWorkdaySettings: merged
        });

        alert(`تعداد ${imported.length} ردیف کارکرد موظفی ماهانه با موفقیت بارگذاری گردید.`);
      } catch (err) {
        console.error(err);
        alert('خطا در خواندن فایل اکسل. لطفاً فایل را بررسی نمایید.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // reset file input
  };

  const handleImportHolidaysExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          alert('فایل اکسل تهی است یا برگه معتبری ندارد.');
          return;
        }
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          alert('برگه معتبری در فایل اکسل یافت نشد.');
          return;
        }
        const rows = XLSX.utils.sheet_to_json<any>(sheet);

        const imported: OfficialHoliday[] = [];
        const allCurrentHolidays = db.officialHolidays || [];
        const genOhdId = createSimpleIdGenerator(allCurrentHolidays, getPrefixForCollection('officialHolidays'));

        const getRowVal = (row: any, possibleKeys: string[]) => {
          const keys = Object.keys(row);
          for (const pk of possibleKeys) {
            const pkNorm = pk.replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase();
            const foundKey = keys.find(k => k.trim().replace(/\s+/g, '').replace(/\u200c/g, '').toLowerCase() === pkNorm);
            if (foundKey !== undefined) {
              return row[foundKey];
            }
          }
          return undefined;
        };

        for (const row of rows) {
          if (!row) continue;

          const rawYear = getRowVal(row, ['سال', 'year', 'yr']);
          const rawDate = getRowVal(row, ['تاریخ', 'date', 'dt']);

          const year = parseInt(toEnglishDigits(rawYear !== undefined && rawYear !== null ? rawYear.toString() : '')) || 0;
          let dateStr = toEnglishDigits(rawDate !== undefined && rawDate !== null ? rawDate.toString() : '').trim();

          // Let's also normalize dates that use hyphens instead of slashes, e.g. 1405-01-01 -> 1405/01/01
          dateStr = dateStr.replace(/-/g, '/');

          if (year && dateStr && /^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
            imported.push({
              id: genOhdId(),
              periodId: effectivePeriodId,
              year,
              date: dateStr
            });
          }
        }

        if (imported.length === 0) {
          alert('هیچ ردیف تعطیلی معتبری یافت نشد. فرمت صحیح تاریخ YYYY/MM/DD می‌باشد.');
          return;
        }

        // Merge based on unique dates within effectivePeriodId (preserving other periods)
        const merged = [...allCurrentHolidays];
        imported.forEach(imp => {
          if (!merged.some(m => m.periodId === effectivePeriodId && m.date === imp.date)) {
            merged.push(imp);
          }
        });

        onUpdateDb({
          ...db,
          officialHolidays: merged
        });

        alert(`تعداد ${imported.length} روز تعطیل رسمی با موفقیت از اکسل بارگذاری گردید.`);
      } catch (err) {
        console.error(err);
        alert('خطا در پردازش فایل اکسل تعطیلات.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // reset file input
  };

  // Filtered lists (strictly period-isolated)
  const filteredWorkdays = useMemo(() => {
    const list = (db.monthlyWorkdaySettings || []).filter(item => item.periodId === effectivePeriodId);
    if (!workdayYearFilter) return list;
    return list.filter(item => item.year.toString() === workdayYearFilter);
  }, [db.monthlyWorkdaySettings, effectivePeriodId, workdayYearFilter]);

  const filteredHolidays = useMemo(() => {
    const list = (db.officialHolidays || []).filter(item => item.periodId === effectivePeriodId);
    if (!holidayYearFilter) return list;
    return list.filter(item => item.year.toString() === holidayYearFilter);
  }, [db.officialHolidays, effectivePeriodId, holidayYearFilter]);

  const persianMonths = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];

  return (
    <div className="space-y-8 animate-fade-in text-right" dir="rtl">

      {/* 2. calculations rules DIV (محاسبات حقوق) */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl space-y-6">
        <h3 className="text-base font-black text-white border-b border-slate-850 pb-3 flex items-center gap-2">
          <Settings className="h-5 w-5 text-amber-500" />
          محاسبات حقوق و قوانین حضور و غیاب
        </h3>

        {calcNotification && (
          <div className="bg-emerald-950/70 border border-emerald-900/50 text-emerald-400 p-3 rounded-xl text-xs font-bold animate-pulse flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            {calcNotification}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Box 1 */}
          <div 
            onClick={() => updateRule('calculateEarlyOvertime', !rules.calculateEarlyOvertime)}
            className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
              rules.calculateEarlyOvertime 
                ? 'bg-emerald-950/20 border-emerald-900/40 hover:bg-emerald-950/30' 
                : 'bg-slate-900/30 border-slate-850 hover:bg-slate-900/50'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {rules.calculateEarlyOvertime ? (
                <CheckSquare className="h-5 w-5 text-emerald-500" />
              ) : (
                <Square className="h-5 w-5 text-slate-600" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">محاسبه اضافه کار اول وقت انجام شود؟</p>
              <p className="text-[10px] text-slate-500 mt-1">احتساب دقایق حضور پیش از شروع رسمی شیفت مصوب به عنوان اضافه کار.</p>
            </div>
          </div>

          {/* Box 2 */}
          <div 
            onClick={() => updateRule('calculateLateOvertime', !rules.calculateLateOvertime)}
            className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
              rules.calculateLateOvertime 
                ? 'bg-emerald-950/20 border-emerald-900/40 hover:bg-emerald-950/30' 
                : 'bg-slate-900/30 border-slate-850 hover:bg-slate-900/50'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {rules.calculateLateOvertime ? (
                <CheckSquare className="h-5 w-5 text-emerald-500" />
              ) : (
                <Square className="h-5 w-5 text-slate-600" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">محاسبه اضافه کار آخر وقت انجام شود؟</p>
              <p className="text-[10px] text-slate-500 mt-1">احتساب حضور مستمر پرسنل پس از خاتمه ساعت رسمی شیفت کاری مصوب.</p>
            </div>
          </div>

          {/* Box 3 */}
          <div 
            onClick={() => updateRule('calculateHolidayWork', !rules.calculateHolidayWork)}
            className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
              rules.calculateHolidayWork 
                ? 'bg-emerald-950/20 border-emerald-900/40 hover:bg-emerald-950/30' 
                : 'bg-slate-900/30 border-slate-850 hover:bg-slate-900/50'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {rules.calculateHolidayWork ? (
                <CheckSquare className="h-5 w-5 text-emerald-500" />
              ) : (
                <Square className="h-5 w-5 text-slate-600" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">محاسبه تعطیل کاری انجام شود؟</p>
              <p className="text-[10px] text-slate-500 mt-1">احتساب حضور پرسنل در روزهای منطبق با تقویم تعطیلات رسمی به عنوان تعطیل‌کاری.</p>
            </div>
          </div>

          {/* Box 4 */}
          <div 
            onClick={() => updateRule('calculateFridayWork', !rules.calculateFridayWork)}
            className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
              rules.calculateFridayWork 
                ? 'bg-emerald-950/20 border-emerald-900/40 hover:bg-emerald-950/30' 
                : 'bg-slate-900/30 border-slate-850 hover:bg-slate-900/50'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {rules.calculateFridayWork ? (
                <CheckSquare className="h-5 w-5 text-emerald-500" />
              ) : (
                <Square className="h-5 w-5 text-slate-600" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-200">محاسبه جمعه کاری انجام شود؟</p>
              <p className="text-[10px] text-slate-500 mt-1">محاسبه و پرداخت فوق‌العاده جمعه کاری برای حضور روز جمعه مستقل از شیفت هفتگی.</p>
            </div>
          </div>

          {/* Box 5 (Conditional fine) */}
          <div className="p-4 rounded-xl border bg-slate-900/30 border-slate-850 space-y-3">
            <div 
              onClick={() => updateRule('calculateEntryDelayFine', !rules.calculateEntryDelayFine)}
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <div className="mt-0.5 shrink-0">
                {rules.calculateEntryDelayFine ? (
                  <CheckSquare className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 text-slate-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">جریمه تاخیر ورود محاسبه شود؟</p>
                <p className="text-[10px] text-slate-500 mt-1">کاهش یا جریمه نقدی و زمانی کارکرد به ازای تاخیر در ورود رسمی.</p>
              </div>
            </div>

            {rules.calculateEntryDelayFine && (
              <div className="pt-2 border-t border-slate-850/50 animate-fade-in">
                <label className="block text-[10px] text-slate-400 font-bold mb-1">ضریب جریمه (دقیقه به ازای هر دقیقه تاخیر):</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number"
                    step="0.5"
                    min="1"
                    value={rules.delayFineRate}
                    onChange={(e) => updateRule('delayFineRate', parseFloat(e.target.value) || 1.0)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">دقیقه کسر</span>
                </div>
              </div>
            )}
          </div>

          {/* Box 6 (Conditional clothes change) */}
          <div className="p-4 rounded-xl border bg-slate-900/30 border-slate-850 space-y-3">
            <div 
              onClick={() => updateRule('deductClothesChangingTime', !rules.deductClothesChangingTime)}
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <div className="mt-0.5 shrink-0">
                {rules.deductClothesChangingTime ? (
                  <CheckSquare className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 text-slate-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">زمان تعویض لباس کسر شود؟</p>
                <p className="text-[10px] text-slate-500 mt-1">کسر دقایق مشخص از کارکرد کل جهت امور تعویض لباس بدو ورود و خروج.</p>
              </div>
            </div>

            {rules.deductClothesChangingTime && (
              <div className="pt-2 border-t border-slate-850/50 animate-fade-in">
                <label className="block text-[10px] text-slate-400 font-bold mb-1">مدت زمان کسر لباس (دقیقه در روز):</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number"
                    min="0"
                    value={rules.clothesChangingDuration}
                    onChange={(e) => updateRule('clothesChangingDuration', parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">دقیقه</span>
                </div>
              </div>
            )}
          </div>

          {/* Box 9 (Daily Break Time Deduction) */}
          <div className="p-4 rounded-xl border bg-slate-900/30 border-slate-850 space-y-3">
            <div 
              onClick={() => updateRule('deductDailyBreakTime', !rules.deductDailyBreakTime)}
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <div className="mt-0.5 shrink-0">
                {rules.deductDailyBreakTime ? (
                  <CheckSquare className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 text-slate-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">آیا ساعت استراحت روزانه کسر شود؟</p>
                <p className="text-[10px] text-slate-500 mt-1">کسر زمان استراحت روزانه از مدت حضور و محاسبه خالص مدت حضور و کارکرد عادی.</p>
              </div>
            </div>

            {rules.deductDailyBreakTime && (
              <div className="pt-2 border-t border-slate-850/50 animate-fade-in">
                <label className="block text-[10px] text-slate-400 font-bold mb-1">مدت ساعت استراحت روزانه (دقیقه):</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number"
                    min="0"
                    value={rules.dailyBreakDurationMinutes ?? 40}
                    onChange={(e) => updateRule('dailyBreakDurationMinutes', parseInt(e.target.value) || 40)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white"
                  />
                  <span className="text-[10px] text-slate-500 shrink-0">دقیقه</span>
                </div>
              </div>
            )}
          </div>

          {/* Box 7 (Tax Calculation Toggle) */}
          <div className="p-4 rounded-xl border bg-slate-900/30 border-slate-850 space-y-3">
            <div 
              onClick={() => updateRule('calculatePayrollTax', !rules.calculatePayrollTax)}
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <div className="mt-0.5 shrink-0">
                {rules.calculatePayrollTax ? (
                  <CheckSquare className="h-5 w-5 text-emerald-500" />
                ) : (
                  <Square className="h-5 w-5 text-slate-600" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">محاسبه مالیات حقوق انجام شود؟</p>
                <p className="text-[10px] text-slate-500 mt-1">در صورت فعال بودن، مالیات بر حقوق در محاسبات کارکرد ماهانه پرسنل بر اساس جدول معافیت و طبقات مالیاتی کسر خواهد شد.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Monthly Workday Settings Table (جدول کارکرد موظفی ماهانه) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Workday Form Side */}
        <div className="xl:col-span-1 bg-slate-950 p-6 rounded-2xl border border-slate-800 h-fit space-y-6 shadow-xl">
          <h3 className="text-sm font-black text-white border-b border-slate-850 pb-3 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-500" />
            {editingWorkdayId ? 'ویرایش کارکرد موظفی ماهانه' : 'تعریف کارکرد موظفی ماهانه'}
          </h3>

          <form onSubmit={handleSaveWorkdaySetting} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 font-bold mb-1.5">سال (خورشیدی)</label>
                <input 
                  type="number"
                  required
                  value={workdayYear}
                  onChange={(e) => setWorkdayYear(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-bold mb-1.5">ماه</label>
                <select
                  value={workdayMonth}
                  onChange={(e) => setWorkdayMonth(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg text-xs text-white text-center cursor-pointer font-bold"
                >
                  {persianMonths.map((m, idx) => (
                    <option key={idx} value={(idx + 1).toString()}>{m} ({idx + 1})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 font-bold mb-1">کل روزها</label>
                <input 
                  type="number"
                  required
                  value={workdayDaysInMonth}
                  onChange={(e) => setWorkdayDaysInMonth(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-1.5 rounded-lg font-mono text-center text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-bold mb-1">تعداد جمعه</label>
                <input 
                  type="number"
                  required
                  value={workdayFridaysCount}
                  onChange={(e) => setWorkdayFridaysCount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-1.5 rounded-lg font-mono text-center text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 font-bold mb-1">تعطیل غیرجمعه</label>
                <input 
                  type="number"
                  required
                  value={workdayNonFridayHolidays}
                  onChange={(e) => setWorkdayNonFridayHolidays(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-1.5 rounded-lg font-mono text-center text-xs text-white"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAutoCalculate}
                className="text-[10px] bg-amber-950/40 text-amber-400 hover:text-amber-300 border border-amber-900/50 hover:border-amber-700 rounded px-2.5 py-1 font-bold cursor-pointer transition-all"
              >
                محاسبه خودکار روز و ساعت کارکرد موظفی
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-900">
              <div>
                <label className="block text-[11px] text-slate-400 font-bold mb-1.5">روزهای کاری موظفی</label>
                <input 
                  type="number"
                  required
                  value={workdayWorkingDaysCount}
                  onChange={(e) => setWorkdayWorkingDaysCount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 font-bold mb-1.5">ساعت کار موظفی</label>
                <input 
                  type="number"
                  required
                  value={workdayRequiredWorkHours}
                  onChange={(e) => setWorkdayRequiredWorkHours(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-1"
              >
                {editingWorkdayId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingWorkdayId ? 'ذخیره تغییرات' : 'ثبت کارکرد موظفی'}
              </button>

              {editingWorkdayId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorkdayId(null);
                    setWorkdayYear('1405');
                    setWorkdayMonth('1');
                    setWorkdayDaysInMonth('31');
                    setWorkdayFridaysCount('4');
                    setWorkdayNonFridayHolidays('0');
                    setWorkdayWorkingDaysCount('27');
                    setWorkdayRequiredWorkHours('192');
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                >
                  انصراف
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Workday Table & Search Side */}
        <div className="xl:col-span-2 bg-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-850 pb-3 gap-3">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
              لیست کارکرد موظفی ماه‌های سال {toPersianDigits(workdayYearFilter)}
            </h3>

            {/* Excel Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportWorkdaysExcel}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-[10px] font-bold border border-slate-800 hover:border-slate-700 transition-all flex items-center gap-1 cursor-pointer"
                title="دانلود قالب اکسل"
              >
                <Download className="h-3.5 w-3.5" />
                دانلود الگو
              </button>

              <label className="px-2.5 py-1.5 bg-emerald-950/40 hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 rounded-lg text-[10px] font-bold border border-emerald-900/40 hover:border-emerald-700/60 transition-all flex items-center gap-1 cursor-pointer">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                بارگذاری اکسل
                <input 
                  type="file" 
                  accept=".xlsx, .xls" 
                  onChange={handleImportWorkdaysExcel} 
                  className="hidden" 
                />
              </label>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-3 bg-slate-900/40 border border-slate-850 p-3 rounded-xl max-w-sm">
            <Search className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-xs text-slate-400 font-bold shrink-0">فیلتر بر اساس سال:</span>
            <input 
              type="number"
              value={workdayYearFilter}
              onChange={(e) => setWorkdayYearFilter(e.target.value)}
              placeholder="مثال: 1405"
              className="w-full bg-transparent focus:outline-none font-mono text-xs text-white"
            />
          </div>

          <div className="overflow-x-auto border border-slate-850 rounded-xl">
            <table className="min-w-full divide-y divide-slate-850 text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold">
                <tr>
                  <th className="px-4 py-3">ماه</th>
                  <th className="px-3 py-3 text-center">کل روزها</th>
                  <th className="px-3 py-3 text-center">تعداد جمعه</th>
                  <th className="px-3 py-3 text-center">تعطیلات غیرجمعه</th>
                  <th className="px-3 py-3 text-center">روز کاری موظفی</th>
                  <th className="px-3 py-3 text-center">ساعت کار موظفی</th>
                  <th className="px-4 py-3 text-center w-24">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850/60">
                {filteredWorkdays.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-bold">
                      هیچ ردیفی جهت نمایش با این فیلتر سال یافت نشد. می‌توانید ردیف جدید تعریف کنید یا فایل اکسل بارگذاری نمایید.
                    </td>
                  </tr>
                ) : (
                  filteredWorkdays
                    .sort((a, b) => a.month - b.month)
                    .map((item) => (
                      <tr key={item.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-200">
                          {persianMonths[item.month - 1]} ({toPersianDigits(item.month)})
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-slate-300">
                          {toPersianDigits(item.daysInMonth)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-slate-300">
                          {toPersianDigits(item.fridaysCount)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-rose-400">
                          {toPersianDigits(item.nonFridayHolidays)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-emerald-400 font-bold">
                          {toPersianDigits(item.workingDaysCount)} روز
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-white font-bold">
                          {toPersianDigits(item.requiredWorkHours)} ساعت
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleEditWorkday(item)}
                              className="p-1 text-slate-400 hover:text-emerald-400 cursor-pointer transition-colors"
                              title="ویرایش"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteWorkday(item.id)}
                              className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                              title="حذف"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. Official Holidays of the Year (تعطیلات رسمی سال) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Holiday Form Side */}
        <div className="xl:col-span-1 bg-slate-950 p-6 rounded-2xl border border-slate-800 h-fit space-y-6 shadow-xl">
          <h3 className="text-sm font-black text-white border-b border-slate-850 pb-3 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-rose-400" />
            {editingHolidayId ? 'ویرایش روز تعطیل رسمی' : 'ثبت روز تعطیل رسمی'}
          </h3>

          <form onSubmit={handleSaveHoliday} className="space-y-4">
            <div>
              <label className="block text-[11px] text-slate-400 font-bold mb-1.5">سال (خورشیدی)</label>
              <input 
                type="number"
                required
                value={holidayYear}
                onChange={(e) => setHolidayYear(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 font-bold mb-1.5">تاریخ تعطیلی (فرمت: YYYY/MM/DD)</label>
              <input 
                type="text"
                required
                placeholder="مثال: 1405/01/01"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white p-2 rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-1"
              >
                {editingHolidayId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingHolidayId ? 'ذخیره تغییرات' : 'افزودن روز تعطیل'}
              </button>

              {editingHolidayId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingHolidayId(null);
                    setHolidayYear('1405');
                    setHolidayDate('');
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                >
                  انصراف
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Holiday Table & Search Side */}
        <div className="xl:col-span-2 bg-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-850 pb-3 gap-3">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Clock className="h-5 w-5 text-rose-400" />
              لیست روزهای تعطیل رسمی سال {toPersianDigits(holidayYearFilter)}
            </h3>

            {/* Excel Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportHolidaysExcel}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-[10px] font-bold border border-slate-800 hover:border-slate-700 transition-all flex items-center gap-1 cursor-pointer"
                title="دانلود قالب اکسل"
              >
                <Download className="h-3.5 w-3.5" />
                دانلود الگو
              </button>

              <label className="px-2.5 py-1.5 bg-emerald-950/40 hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 rounded-lg text-[10px] font-bold border border-emerald-900/40 hover:border-emerald-700/60 transition-all flex items-center gap-1 cursor-pointer">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                بارگذاری اکسل
                <input 
                  type="file" 
                  accept=".xlsx, .xls" 
                  onChange={handleImportHolidaysExcel} 
                  className="hidden" 
                />
              </label>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex items-center gap-3 bg-slate-900/40 border border-slate-850 p-3 rounded-xl max-w-sm">
            <Search className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-xs text-slate-400 font-bold shrink-0">فیلتر بر اساس سال:</span>
            <input 
              type="number"
              value={holidayYearFilter}
              onChange={(e) => setHolidayYearFilter(e.target.value)}
              placeholder="مثال: 1405"
              className="w-full bg-transparent focus:outline-none font-mono text-xs text-white"
            />
          </div>

          <div className="overflow-x-auto border border-slate-850 rounded-xl">
            <table className="min-w-full divide-y divide-slate-850 text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold">
                <tr>
                  <th className="px-6 py-3">ردیف</th>
                  <th className="px-6 py-3">سال</th>
                  <th className="px-6 py-3 text-center">تاریخ تعطیل رسمی</th>
                  <th className="px-6 py-3 text-center w-28">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850/60">
                {filteredHolidays.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500 font-bold">
                      هیچ روز تعطیل رسمی برای این فیلتر سال یافت نشد. می‌توانید روز جدید تعریف کنید یا فایل اکسل بارگذاری نمایید.
                    </td>
                  </tr>
                ) : (
                  filteredHolidays
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-900/30 transition-colors">
                        <td className="px-6 py-3 font-mono text-slate-450 font-semibold">
                          {toPersianDigits(idx + 1)}
                        </td>
                        <td className="px-6 py-3 font-bold text-slate-300">
                          سال {toPersianDigits(item.year)}
                        </td>
                        <td className="px-6 py-3 text-center font-mono text-rose-400 font-bold text-sm">
                          {toPersianDigits(item.date)}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditHoliday(item)}
                              className="p-1 text-slate-400 hover:text-emerald-400 cursor-pointer transition-colors"
                              title="ویرایش"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteHoliday(item.id)}
                              className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer transition-colors"
                              title="حذف"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. Tax Configuration Section (تنظیمات معافیت و طبقات مالیات حقوق) */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl space-y-6">
        <h3 className="text-sm font-black text-white border-b border-slate-850 pb-3 flex items-center gap-2">
          <Settings className="h-5 w-5 text-amber-500" />
          تنظیمات معافیت سالانه و طبقات مالیات حقوق
        </h3>

        <div className="grid grid-cols-1 gap-6">
          
          {/* Tax Brackets Form & Table (طبقات مالیات حقوق) */}
          <div className="bg-slate-900/50 p-5 rounded-xl border border-slate-800 space-y-4">
            <h4 className="text-xs font-black text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-1.5">
              <span>{editingBracketId ? 'ویرایش طبقه مالیاتی' : 'ثبت طبقه مالیاتی حقوق'}</span>
            </h4>

            <form onSubmit={handleSaveBracket} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-[10.5px] text-slate-400 font-bold mb-1">سال مالی</label>
                <input 
                  type="number"
                  required
                  value={bracketYear}
                  onChange={(e) => setBracketYear(toEnglishDigits(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-[10.5px] text-slate-400 font-bold mb-1">از مبلغ ماهانه (ریال)</label>
                <input 
                  type="text"
                  required
                  placeholder="مثال: ۱۲۰,۰۰۰,۰۰۰"
                  value={bracketFrom}
                  onChange={(e) => {
                    const clean = toEnglishDigits(e.target.value).replace(/,/g, '');
                    if (!isNaN(Number(clean)) || clean === '') {
                      setBracketFrom(formatWithCommas(clean));
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-[10.5px] text-slate-400 font-bold mb-1">تا مبلغ ماهانه (ریال - خالی برای بی‌سقف)</label>
                <input 
                  type="text"
                  placeholder="مثال: ۱۸۰,۰۰۰,۰۰۰"
                  value={bracketTo}
                  onChange={(e) => {
                    const clean = toEnglishDigits(e.target.value).replace(/,/g, '');
                    if (!isNaN(Number(clean)) || clean === '') {
                      setBracketTo(formatWithCommas(clean));
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                />
              </div>

              <div>
                <label className="block text-[10.5px] text-slate-400 font-bold mb-1">نرخ مالیات (درصد)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number"
                    required
                    min="0"
                    max="100"
                    placeholder="۱۰"
                    value={bracketRate}
                    onChange={(e) => setBracketRate(toEnglishDigits(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 focus:outline-none p-2 rounded-lg font-mono text-center text-xs text-white font-bold"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>

              <div className="md:col-span-4 flex justify-end gap-2 pt-2 border-t border-slate-800/50">
                {editingBracketId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBracketId(null);
                      setBracketFrom('');
                      setBracketTo('');
                      setBracketRate('');
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                  >
                    انصراف
                  </button>
                )}
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-md"
                >
                  {editingBracketId ? 'ثبت تغییرات طبقه' : 'افزودن طبقه مالیاتی جدید'}
                </button>
              </div>
            </form>

            <div className="border-t border-slate-800/80 pt-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-amber-500">طبقات مالیاتی تعریف شده (بر اساس سال مالی):</span>
                <input
                  type="text"
                  placeholder="جستجوی سال..."
                  value={bracketSearchQuery}
                  onChange={(e) => setBracketSearchQuery(e.target.value)}
                  className="bg-slate-950 border border-slate-800 focus:outline-none p-1 rounded text-[9px] w-32 text-center text-white font-bold"
                />
              </div>

              <div className="overflow-x-auto max-h-[180px] overflow-y-auto pr-1">
                <table className="min-w-full divide-y divide-slate-800 text-right text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold sticky top-0">
                    <tr>
                      <th className="px-4 py-2">سال مالی</th>
                      <th className="px-4 py-2">از مبلغ ماهانه</th>
                      <th className="px-4 py-2">تا مبلغ ماهانه</th>
                      <th className="px-4 py-2 text-center">نرخ مالیات</th>
                      <th className="px-4 py-2 text-center w-24">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/20">
                    {(() => {
                      const brackets = (db.taxBrackets || []).filter(item => 
                        item.periodId === effectivePeriodId &&
                        String(item.fiscalYear).includes(toEnglishDigits(bracketSearchQuery))
                      ).sort((a, b) => Number(a.fiscalYear) - Number(b.fiscalYear) || a.fromAmount - b.fromAmount);

                      if (brackets.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-500 font-bold">
                              هیچ طبقه مالیاتی برای این سال مالی ثبت نشده است.
                            </td>
                          </tr>
                        );
                      }

                      return brackets.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-900/30 transition-colors">
                          <td className="px-4 py-2 font-bold text-slate-300">
                            سال {toPersianDigits(item.fiscalYear)}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-300">
                            {toPersianDigits(formatWithCommas(item.fromAmount))} ریال
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-300">
                            {item.toAmount !== null ? `${toPersianDigits(formatWithCommas(item.toAmount))} ریال` : <span className="text-slate-500">بدون سقف</span>}
                          </td>
                          <td className="px-4 py-2 text-center font-mono font-black text-rose-400 text-xs">
                            {toPersianDigits(item.taxRate)} %
                          </td>
                          <td className="px-4 py-2 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleEditBracket(item)}
                                className="p-1 text-slate-400 hover:text-emerald-450 cursor-pointer transition-colors"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBracket(item.id)}
                                className="p-1 text-slate-400 hover:text-rose-455 cursor-pointer transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
