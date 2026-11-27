import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Printer, 
  ChevronRight, 
  ChevronLeft, 
  Search, 
  FileText, 
  Building2, 
  User, 
  Calendar, 
  CreditCard, 
  ShieldCheck, 
  Layers, 
  Eye, 
  EyeOff,
  Copy,
  Check,
  Briefcase,
  Clock,
  Share2,
  FileCheck2,
  Phone,
  MapPin,
  Award,
  DollarSign,
  Leaf,
  Scissors
} from 'lucide-react';
import { Personnel } from '../../types';
import { 
  toPersianDigits, 
  formatWithCommas, 
  numberToWordsPersian, 
  getTodayJalali 
} from '../../utils/persianUtils';

export interface PayslipItemData {
  periodId: string;
  year: number;
  month: number;
  monthName: string;
  issueDate: string;
  slipNumber: string;
  
  // Workshop info
  workshopName: string;
  workshopCode: string;
  workshopAddress?: string;
  workshopPhone?: string;
  insuranceBranch?: string;
  
  // Employee info
  employee: Personnel;
  jobTitle: string;
  department: string;
  contractType: string;
  hireDate: string;
  bankName: string;
  bankAccount: string;
  shebaNumber: string;
  maritalStatusText: string;
  childrenCount: number;
  fatherName?: string;
  nationalId?: string;
  insuranceCode?: string;
  accountCode?: string;
  
  // Work & Attendance
  totalDaysInMonth: number;
  requiredWorkDays: number;
  requiredHours: number;
  actualWorkedDays: number;
  insuranceDays: number;
  workedHoursHM: string;
  overtimeHoursHM: string;
  fridayWorkHoursHM: string;
  holidayWorkHoursHM: string;
  leaveHoursHM: string;
  delayHoursHM: string;
  leaveDays?: number;
  
  // Detailed Leave Accounting
  prevLeaveHM?: string;
  allocatedLeaveHM?: string;
  usedLeaveHM?: string;
  finalLeaveHM?: string;
  
  // Matching Contract Information
  contractSeniorityBase?: number;
  contractStartDate?: string;
  contractEndDate?: string;
  contractNumber?: string;
  
  // Wage Rate Bases
  dailyBaseSalary: number;
  hourlyWage: number;
  overtimeHourlyRate?: number;
  fridayHourlyRate?: number;
  holidayHourlyRate?: number;
  overtimeHours?: number;
  fridayWorkHours?: number;
  holidayWorkHours?: number;
  
  // Earnings (استحقاقی‌ها)
  monthlyBaseSalary: number;
  foodAllowance: number;
  housingAllowance: number;
  childAllowance: number;
  marriageAllowance: number;
  seniorityBase: number;
  jobAllowance: number;
  overtimePay: number;
  fridayWorkPay: number;
  holidayWorkPay: number;
  monthlyEidi?: number;
  monthlyYearsBenefit?: number;
  otherBonuses?: number;
  totalGrossSalary: number;
  
  // Deductions (کسورات)
  workerInsurance7: number;
  payrollTax: number;
  supplementaryInsurance: number;
  delayFineDeduction: number;
  salaryAdvanceDeduction?: number;
  loanInstallmentDeduction?: number;
  otherDeductions?: number;
  totalDeductions: number;
  
  // Net Payable (خالص پرداختی)
  netPayable: number;
  netPayableInWords: string;
  
  // Employer Statutory Info (سهم کارفرما و مبانی قانونی)
  insurableBase: number;
  taxableBase: number;
  employerInsurance20: number;
  unemploymentInsurance3: number;
  totalEmployerInsurance23: number;
  totalInsurance30: number;
  totalEmployerCost: number;
}

interface PersonnelPayslipModalProps {
  isOpen: boolean;
  onClose: () => void;
  payslips: PayslipItemData[];
  initialEmployeeCode?: string;
  year: number;
  month: number;
  activePeriodId: string;
}

export const PersonnelPayslipModal: React.FC<PersonnelPayslipModalProps> = ({
  isOpen,
  onClose,
  payslips,
  initialEmployeeCode,
  year,
  month,
  activePeriodId
}) => {
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    if (initialEmployeeCode && payslips.length > 0) {
      const idx = payslips.findIndex(p => p.employee.employeeCode === initialEmployeeCode);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [layoutMode, setLayoutMode] = useState<'a5_dual' | 'a5_single' | 'a4_portrait'>('a5_dual');
  const [showEmployerContrib, setShowEmployerContrib] = useState<boolean>(true);
  const [showSignatures, setShowSignatures] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Sync index if initialEmployeeCode changes
  useEffect(() => {
    if (initialEmployeeCode && payslips.length > 0) {
      const idx = payslips.findIndex(p => p.employee.employeeCode === initialEmployeeCode);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [initialEmployeeCode, payslips]);

  // Escape key to close & lock background body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Filtered indices for live search
  const filteredIndices = useMemo(() => {
    if (!searchQuery.trim()) return payslips.map((_, i) => i);
    const q = searchQuery.toLowerCase().trim();
    return payslips
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        const name = (p.employee.fullName || `${p.employee.firstName} ${p.employee.lastName}`).toLowerCase();
        const code = String(p.employee.employeeCode || '').toLowerCase();
        const nationalId = String(p.employee.nationalId || p.nationalId || '').toLowerCase();
        const dept = String(p.department || '').toLowerCase();
        return name.includes(q) || code.includes(q) || nationalId.includes(q) || dept.includes(q);
      })
      .map(({ i }) => i);
  }, [payslips, searchQuery]);

  // Jump to first match when search narrows out current index
  useEffect(() => {
    if (searchQuery.trim() && filteredIndices.length > 0 && !filteredIndices.includes(currentIndex)) {
      setCurrentIndex(filteredIndices[0]);
    }
  }, [searchQuery, filteredIndices, currentIndex]);

  const currentPayslip = payslips[currentIndex] || payslips[0];

  if (!isOpen || !currentPayslip) return null;

  // Print helper function using an isolated iframe
  const handlePrint = (mode: 'current' | 'all') => {
    const slipsToPrint = mode === 'all' ? payslips : [currentPayslip];
    if (slipsToPrint.length === 0) return;

    const isA5Dual = layoutMode === 'a5_dual';
    const isA5Single = layoutMode === 'a5_single';

    const printDocHtml = `
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>فیش رسمی حقوق و دستمزد - ${currentPayslip.workshopName}</title>
        <!-- High-Definition Persian Fonts -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
        <style>
          @page {
            size: ${isA5Single ? 'A5 landscape' : 'A4 portrait'};
            margin: ${isA5Single ? '4mm' : (isA5Dual ? '4mm 5mm 4mm 5mm' : '7mm 6mm 7mm 6mm')};
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: 'Vazirmatn', 'Vazir', 'Shabnam', 'Sahel', 'Tahoma', 'Segoe UI', Arial, sans-serif !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
            font-feature-settings: "ss05" 1, "locl" 1;
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0;
            padding: 0;
            direction: rtl;
            text-align: right;
            font-size: ${isA5Dual || isA5Single ? '8.5px' : '9.5px'};
            line-height: 1.32;
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          
          /* Dual A5 layout stacked on one A4 sheet */
          .dual-stacked-wrapper {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .dual-cut-separator {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin: ${isA5Dual ? '3mm 0' : '4mm 0'};
            padding: 0;
            color: #333333;
          }
          .cut-line {
            flex: 1;
            border-bottom: 1.5px dashed #000000;
            height: 0;
          }
          .cut-scissors {
            font-size: 12px;
            color: #000000;
          }
          .cut-label {
            font-size: 8px;
            font-weight: 800;
            background: #ffffff;
            padding: 0 6px;
            color: #000000;
          }
          
          /* Eco-friendly B&W layout: Zero toner fills, crisp hairline borders */
          .payslip-container {
            width: 100%;
            margin: 0 auto;
            border: 1.4px solid #000000;
            border-radius: 3px;
            overflow: hidden;
            background: #ffffff !important;
            box-sizing: border-box;
          }
          .header-table {
            width: 100%;
            border-collapse: collapse;
            background-color: #ffffff !important;
            border-bottom: 1.5px solid #000000;
          }
          .header-table td {
            padding: ${isA5Dual || isA5Single ? '3px 6px' : '5px 8px'};
            vertical-align: middle;
            background-color: #ffffff !important;
          }
          .company-title {
            font-size: ${isA5Dual || isA5Single ? '10.5px' : '13px'};
            font-weight: 900;
            color: #000000;
          }
          .main-title {
            font-size: ${isA5Dual || isA5Single ? '12px' : '15px'};
            font-weight: 900;
            color: #000000;
            text-align: center;
            margin: 0;
            letter-spacing: -0.2px;
          }
          .sub-title {
            font-size: ${isA5Dual || isA5Single ? '8px' : '9.5px'};
            color: #111111;
            text-align: center;
            font-weight: bold;
            margin-top: 1px;
          }
          .meta-text {
            font-size: ${isA5Dual || isA5Single ? '8px' : '9px'};
            color: #000000;
            line-height: 1.35;
          }
          .section-banner {
            background-color: #ffffff !important;
            font-weight: 900;
            font-size: ${isA5Dual || isA5Single ? '8.8px' : '10px'};
            padding: ${isA5Dual || isA5Single ? '2.5px 5px' : '3.5px 6px'};
            color: #000000;
            border-top: 1.3px solid #000000;
            border-bottom: 1.3px solid #000000;
            letter-spacing: -0.1px;
          }
          table.data-table {
            width: 100%;
            border-collapse: collapse;
            background-color: #ffffff !important;
          }
          table.data-table th, table.data-table td {
            border: 1px solid #111111;
            padding: ${isA5Dual || isA5Single ? '2.5px 4.5px' : '3.5px 5.5px'};
            font-size: ${isA5Dual || isA5Single ? '8.2px' : '9.2px'};
            background-color: #ffffff !important;
            color: #000000 !important;
          }
          table.data-table th {
            background-color: #ffffff !important;
            font-weight: 900;
            color: #000000 !important;
            border-bottom: 1.3px solid #000000;
            font-size: ${isA5Dual || isA5Single ? '8.5px' : '9.5px'};
          }
          .text-center { text-align: center; }
          .text-left { text-align: left; }
          .text-right { text-align: right; }
          .font-mono { 
            font-family: 'Vazirmatn', 'Vazir', 'Tahoma', sans-serif !important; 
            font-variant-numeric: tabular-nums;
            font-weight: bold; 
          }
          .font-bold { font-weight: bold; }
          .font-black { font-weight: 900; }
          
          .net-box {
            background: #ffffff !important;
            border: 1.5px solid #000000;
            border-radius: 3px;
            padding: ${isA5Dual || isA5Single ? '3px 8px' : '5px 10px'};
            margin: 2px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .net-number {
            font-size: ${isA5Dual || isA5Single ? '12px' : '15px'};
            font-weight: 900;
            color: #000000;
            font-family: 'Vazirmatn', 'Vazir', 'Tahoma', sans-serif !important;
          }
          .signatures-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 4px;
            padding: ${isA5Dual || isA5Single ? '3px 6px 4px 6px' : '5px 8px 6px 8px'};
            background: #ffffff !important;
            border-top: 1px dashed #000000;
            margin-top: 2px;
          }
          .sig-box {
            text-align: center;
            font-size: ${isA5Dual || isA5Single ? '7.5px' : '8.5px'};
            font-weight: bold;
            color: #000000;
            min-height: ${isA5Dual || isA5Single ? '28px' : '38px'};
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .dots {
            color: #000000;
            letter-spacing: 1px;
            font-size: 6px;
          }
          .legal-receipt {
            font-size: ${isA5Dual || isA5Single ? '7.2px' : '8.2px'};
            color: #000000;
            background: #ffffff !important;
            padding: 2.5px 5px;
            border-top: 1px solid #000000;
            text-align: justify;
            line-height: 1.3;
          }
          .footer-watermark {
            font-size: 7.2px;
            color: #333333;
            text-align: center;
            padding: 1.5px 3px;
            background: #ffffff !important;
            border-top: 1px solid #000000;
          }
          .note-text {
            font-size: 7.2px;
            color: #222222;
            padding: 1.5px 4px;
            background: #ffffff;
            border-top: 1px solid #000000;
          }
        </style>
      </head>
      <body>
        ${(() => {
          if (isA5Dual) {
            // Dual A5 mode on A4 paper: 2 slips per A4 sheet
            if (mode === 'current') {
              // Single employee: 2 copies (Worker copy + Employer/Accounting archive)
              return `
                <div class="dual-stacked-wrapper">
                  <div class="payslip-container">
                    ${renderSingleSlipContentHtml(currentPayslip, 'نسخه اول: کارگر (پرسنل)')}
                  </div>
                  <div class="dual-cut-separator">
                    <span class="cut-scissors">✂</span>
                    <span class="cut-line"></span>
                    <span class="cut-label">خط برش و جداسازی (نسخه کارگر / نسخه بایگانی کارفرما)</span>
                    <span class="cut-line"></span>
                    <span class="cut-scissors">✂</span>
                  </div>
                  <div class="payslip-container">
                    ${renderSingleSlipContentHtml(currentPayslip, 'نسخه دوم: بایگانی کارفرما و حسابداری')}
                  </div>
                </div>
              `;
            } else {
              // All employees: Print 2 slips per A4 page
              const pages: string[] = [];
              for (let i = 0; i < slipsToPrint.length; i += 2) {
                const s1 = slipsToPrint[i];
                const s2 = slipsToPrint[i + 1];
                pages.push(`
                  <div class="dual-stacked-wrapper">
                    <div class="payslip-container">
                      ${renderSingleSlipContentHtml(s1, 'نسخه پرسنل (کارگر)')}
                    </div>
                    ${s2 ? `
                      <div class="dual-cut-separator">
                        <span class="cut-scissors">✂</span>
                        <span class="cut-line"></span>
                        <span class="cut-label">خط برش و جداسازی فیش‌های حقوقی</span>
                        <span class="cut-line"></span>
                        <span class="cut-scissors">✂</span>
                      </div>
                      <div class="payslip-container">
                        ${renderSingleSlipContentHtml(s2, 'نسخه پرسنل (کارگر)')}
                      </div>
                    ` : `
                      <div class="dual-cut-separator">
                        <span class="cut-scissors">✂</span>
                        <span class="cut-line"></span>
                        <span class="cut-label">خط برش و جداسازی (نسخه بایگانی کارفرما)</span>
                        <span class="cut-line"></span>
                        <span class="cut-scissors">✂</span>
                      </div>
                      <div class="payslip-container">
                        ${renderSingleSlipContentHtml(s1, 'نسخه دوم: بایگانی کارفرما و حسابداری')}
                      </div>
                    `}
                  </div>
                  ${i + 2 < slipsToPrint.length ? '<div class="page-break"></div>' : ''}
                `);
              }
              return pages.join('');
            }
          } else {
            // Single slip per page (either A5 single paper or full A4)
            return slipsToPrint.map((s, idx) => `
              <div class="payslip-container">
                ${renderSingleSlipContentHtml(s, 'نسخه پرسنل (کارگر)')}
              </div>
              ${idx < slipsToPrint.length - 1 ? '<div class="page-break"></div>' : ''}
            `).join('');
          }
        })()}
        <script>
          window.onload = function() {
            var doPrint = function() {
              window.focus();
              window.print();
            };
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(function() {
                setTimeout(doPrint, 250);
              }).catch(function() {
                setTimeout(doPrint, 350);
              });
            } else {
              setTimeout(doPrint, 350);
            }
          };
        </script>
      </body>
      </html>
    `;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write(printDocHtml);
      frameDoc.close();

      setTimeout(() => {
        if (document.body.contains(printFrame)) {
          document.body.removeChild(printFrame);
        }
      }, 60000);
    }
  };

  const formatRoundedPayslipHour = (hoursNum?: number, hmStr?: string): number => {
    if (hoursNum !== undefined && hoursNum !== null && Number.isInteger(Number(hoursNum))) {
      const val = Number(hoursNum);
      return val === 0 ? 0 : val;
    }
    if (hmStr) {
      const eng = String(hmStr)
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .trim();
      if (eng.includes(':')) {
        const pts = eng.split(':');
        const h = parseInt(pts[0], 10) || 0;
        const m = parseInt(pts[1], 10) || 0;
        const res = Math.round((h * 60 + m) / 60);
        return res === 0 ? 0 : res;
      }
      const parsed = parseFloat(eng);
      if (!isNaN(parsed)) {
        const res = Math.round(parsed);
        return res === 0 ? 0 : res;
      }
    }
    const res = Math.round(Number(hoursNum) || 0);
    return res === 0 ? 0 : res;
  };

  // Pure HTML template builder for print & PDF
  function renderSingleSlipContentHtml(s: PayslipItemData, copyTitle: string): string {
    const fullName = s.employee.fullName || `${s.employee.firstName} ${s.employee.lastName}`;
    const overtimeHourly = s.overtimeHourlyRate || Math.round(s.hourlyWage * 1.4);
    const fridayHourly = (s.fridayHourlyRate !== undefined && s.fridayHourlyRate > 0)
      ? s.fridayHourlyRate
      : Math.round(((s.dailyBaseSalary || 0) * 0.40) / 7.33);
    const holidayHourly = s.holidayHourlyRate || overtimeHourly;
    const otRoundedHours = formatRoundedPayslipHour(s.overtimeHours, s.overtimeHoursHM);
    const fridayRoundedHours = formatRoundedPayslipHour(s.fridayWorkHours, s.fridayWorkHoursHM);
    const holidayRoundedHours = formatRoundedPayslipHour(s.holidayWorkHours, s.holidayWorkHoursHM);

    return `
      <!-- 1. Header Box -->
      <table class="header-table">
        <tr>
          <td style="width: 28%; text-align: right;">
            <div class="company-title">${s.workshopName}</div>
            <div class="meta-text">کد کارگاه تامین اجتماعی: <strong class="font-mono">${toPersianDigits(s.workshopCode)}</strong></div>
            <div class="meta-text">شعبه بیمه: ${s.insuranceBranch || 'شعبه ۱ تامین اجتماعی'}</div>
          </td>
          <td style="width: 44%; text-align: center;">
            <h2 class="main-title">فیش رسمی حقوق و دستمزد ماهیانه</h2>
            <div class="sub-title">منطبق بر ضوابط قانون کار و تامین اجتماعی - ${s.monthName} ماه سال ${toPersianDigits(s.year)}</div>
          </td>
          <td style="width: 28%; text-align: left;">
            <div class="meta-text">شماره فیش: <strong class="font-mono">${toPersianDigits(s.slipNumber)}</strong></div>
            <div class="meta-text">تاریخ صدور: <span class="font-mono">${toPersianDigits(s.issueDate)}</span></div>
            <div class="meta-text">نسخه: <strong>${copyTitle}</strong></div>
          </td>
        </tr>
      </table>

      <!-- 2. Personnel Identification & Contract Details -->
      <div class="section-banner">۱. مشخصات هویتی، استخدامی و حساب بانکی پرسنل</div>
      <table class="data-table">
        <tr>
          <th style="width: 13%;">نام و خانوادگی</th>
          <td style="width: 22%; font-weight: bold;">${fullName}</td>
          <th style="width: 12%;">کد ملی</th>
          <td style="width: 20%;" class="font-mono font-bold">${toPersianDigits(s.employee?.nationalId || s.nationalId || '')}</td>
          <th style="width: 13%;">کد پرسنلی / تردد</th>
          <td style="width: 20%;" class="font-mono font-bold">
            ${toPersianDigits(s.employee?.employeeCode || '')}
            ${s.employee?.attendanceCode ? ` / تردد: ${toPersianDigits(s.employee.attendanceCode)}` : ''}
          </td>
        </tr>
        <tr>
          <th>عنوان شغلی / سمت</th>
          <td>${s.employee?.role || (s.employee as any)?.jobTitle || s.jobTitle || ''}</td>
          <th>شماره بیمه</th>
          <td class="font-mono">${toPersianDigits(s.employee?.insuranceCode || s.insuranceCode || '')}</td>
          <th>دپارتمان / بخش</th>
          <td>${s.department || ''}</td>
        </tr>
        <tr>
          <th>نام پدر</th>
          <td>${s.employee?.fatherName || s.fatherName || ''}</td>
          <th>وضعیت تاهل / اولاد</th>
          <td>${s.maritalStatusText || ''}${s.childrenCount ? ` (${toPersianDigits(s.childrenCount)} فرزند مشمول ماده ۸۶)` : ''}</td>
          <th>تاریخ استخدام</th>
          <td class="font-mono">${toPersianDigits(s.employee?.entryDate || s.hireDate || '')}</td>
        </tr>
        <tr>
          <th>نوع قرارداد کار</th>
          <td>${s.contractType || ''}</td>
          <th>شماره حساب و شبا</th>
          <td colspan="3" class="font-mono">
            ${s.bankName ? `بانک: ${s.bankName} ` : ''}
            ${s.shebaNumber ? `| شبا: ${s.shebaNumber} ` : ''}
            ${(s.bankAccount || (s.employee as any)?.bankAccountNumber || s.employee?.bankAccount) ? `| حساب: ${s.bankAccount || (s.employee as any)?.bankAccountNumber || s.employee?.bankAccount}` : ''}
          </td>
        </tr>
        <tr>
          <th>قرارداد متناظر دوره</th>
          <td>
            ${s.contractStartDate ? `از ${toPersianDigits(s.contractStartDate)} ${s.contractEndDate ? `تا ${toPersianDigits(s.contractEndDate)}` : ''}` : ''}
          </td>
          <th>پایه سنوات ماهانه قرارداد</th>
          <td colspan="3" class="font-mono font-bold">
            ${(s.contractSeniorityBase || s.seniorityBase) ? `${formatWithCommas(s.contractSeniorityBase || s.seniorityBase)} ریال` : ''}
          </td>
        </tr>
      </table>

      <!-- 3. Attendance, Working Hours & Wage Rate Bases (Matched with Performance Table) -->
      <div class="section-banner">۲. خلاصه کارکرد، حضور و غیاب و پایه‌های محاسباتی دستمزد</div>
      <table class="data-table">
        <tr>
          <th class="text-center" style="width: 11%;">روزهای تقویمی</th>
          <th class="text-center" style="width: 11%;">کارکرد موثر</th>
          <th class="text-center" style="width: 11%;">روزهای بیمه</th>
          <th class="text-center" style="width: 11%;">ساعات موظفی</th>
          <th class="text-center" style="width: 11%;">ساعات کارکرد</th>
          <th class="text-center" style="width: 12%;">اضافه‌کار عادی</th>
          <th class="text-center" style="width: 11%;">جمعه کاری</th>
          <th class="text-center" style="width: 11%;">تعطیل کاری</th>
          <th class="text-center" style="width: 11%;">تاخیر / کسر کار</th>
        </tr>
        <tr class="text-center font-mono">
          <td>${toPersianDigits(s.totalDaysInMonth)} روز</td>
          <td class="font-black">${toPersianDigits(s.actualWorkedDays)} روز</td>
          <td>${toPersianDigits(s.insuranceDays)} روز</td>
          <td>${toPersianDigits(s.requiredHours)} س</td>
          <td>${toPersianDigits(s.workedHoursHM || '۰:۰۰')}</td>
          <td class="font-black">${toPersianDigits(otRoundedHours)} س</td>
          <td>${toPersianDigits(fridayRoundedHours)} س</td>
          <td>${toPersianDigits(holidayRoundedHours)} س</td>
          <td>${toPersianDigits(s.delayHoursHM || '۰:۰۰')}</td>
        </tr>
      </table>

      <!-- Leave Accounting Breakdown Box -->
      <table class="data-table" style="border-top: none;">
        <tr class="text-center font-mono" style="background-color: #f8fafc;">
          <td style="width: 25%;">
            <span style="color: #333333; font-size: 7.5px;">مرخصی مانده از قبل:</span> 
            <strong>${toPersianDigits(s.prevLeaveHM || '۰:۰۰')}</strong>
          </td>
          <td style="width: 25%;">
            <span style="color: #333333; font-size: 7.5px;">مرخصی تعلق‌گرفته این ماه:</span> 
            <strong>${toPersianDigits(s.allocatedLeaveHM || '۰:۰۰')}</strong>
          </td>
          <td style="width: 25%;">
            <span style="color: #333333; font-size: 7.5px;">مرخصی استفاده‌شده این ماه:</span> 
            <strong>${toPersianDigits(s.usedLeaveHM || '۰:۰۰')}</strong>
          </td>
          <td style="width: 25%;">
            <span style="color: #333333; font-size: 7.5px;">مانده نهایی مرخصی دوره:</span> 
            <strong class="font-black">${toPersianDigits(s.finalLeaveHM || s.leaveHoursHM || '۰:۰۰')}</strong>
          </td>
        </tr>
      </table>

      <!-- Wage Rates Row -->
      <table class="data-table" style="border-top: none;">
        <tr class="text-center font-mono">
          <td style="width: 20%;"><span style="color: #333333; font-size: 7.5px;">مزد ثابت روزانه:</span> <strong>${formatWithCommas(s.dailyBaseSalary)}</strong> ریال</td>
          <td style="width: 20%;"><span style="color: #333333; font-size: 7.5px;">مزد هر ساعت کار عادی:</span> <strong>${formatWithCommas(s.hourlyWage)}</strong> ریال</td>
          <td style="width: 20%;"><span style="color: #333333; font-size: 7.5px;">نرخ هر ساعت اضافه کار:</span> <strong>${formatWithCommas(overtimeHourly)}</strong> ریال</td>
          <td style="width: 20%;"><span style="color: #333333; font-size: 7.5px;">نرخ هر ساعت جمعه‌کاری:</span> <strong>${formatWithCommas(fridayHourly)}</strong> ریال</td>
          <td style="width: 20%;"><span style="color: #333333; font-size: 7.5px;">نرخ هر ساعت تعطیل‌کاری:</span> <strong>${formatWithCommas(holidayHourly)}</strong> ریال</td>
        </tr>
      </table>

      <!-- 4. Detailed Earnings & Deductions Ledger -->
      <div class="section-banner">۳. ریز اقلام حقوق و مزایا (استحقاقی‌ها) در برابر کسورات قانونی و اختیاری</div>
      <table class="data-table">
        <thead>
          <tr>
            <th colspan="2" style="width: 50%; text-align: center; background: #ffffff; color: #000000; font-weight: 900; border-bottom: 1.2px solid #000000;">
              حقوق و مزایای ناخالص (استحقاقی‌ها)
            </th>
            <th colspan="2" style="width: 50%; text-align: center; background: #ffffff; color: #000000; font-weight: 900; border-bottom: 1.2px solid #000000;">
              کسورات قانونی و اختیاری
            </th>
          </tr>
          <tr>
            <th style="width: 32%;">شرح قلم مزایا</th>
            <th style="width: 18%; text-align: left;">مبلغ (ریال)</th>
            <th style="width: 32%;">شرح قلم کسورات</th>
            <th style="width: 18%; text-align: left;">مبلغ (ریال)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>حقوق پایه کارکرد (${toPersianDigits(s.actualWorkedDays)} روز)</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.monthlyBaseSalary)}</td>
            <td>حق بیمه تامین اجتماعی سهم کارگر (۷٪)</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.workerInsurance7)}</td>
          </tr>
          <tr>
            <td>کمک هزینه اقلام مصرفی (حق بن)</td>
            <td class="text-left font-mono">${formatWithCommas(s.foodAllowance)}</td>
            <td>مالیات بر درآمد حقوق ماهانه</td>
            <td class="text-left font-mono">${formatWithCommas(s.payrollTax)}</td>
          </tr>
          <tr>
            <td>کمک هزینه مسکن (حق مسکن مصوب)</td>
            <td class="text-left font-mono">${formatWithCommas(s.housingAllowance)}</td>
            <td>حق بیمه تکمیلی درمان سهم کارگر</td>
            <td class="text-left font-mono">${formatWithCommas(s.supplementaryInsurance)}</td>
          </tr>
          <tr>
            <td>حق اولاد و عائله‌مندی (${toPersianDigits(s.childrenCount)} فرزند)</td>
            <td class="text-left font-mono">${formatWithCommas(s.childAllowance)}</td>
            <td>مساعده و علی‌الحساب دریافتی</td>
            <td class="text-left font-mono">${formatWithCommas(s.salaryAdvanceDeduction || 0)}</td>
          </tr>
          <tr>
            <td>حق تاهل مصوب قانون کار</td>
            <td class="text-left font-mono">${formatWithCommas(s.marriageAllowance)}</td>
            <td>اقساط وام و خرید پرسنل از کارگاه</td>
            <td class="text-left font-mono">${formatWithCommas(s.loanInstallmentDeduction || 0)}</td>
          </tr>
          <tr>
            <td>پایه سنوات ماهانه (مزد سنوات)</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.seniorityBase)}</td>
            <td>سایر کسورات قانونی و توافقی</td>
            <td class="text-left font-mono">${formatWithCommas(s.otherDeductions || 0)}</td>
          </tr>
          <tr>
            <td>فوق‌العاده اضافه کاری عادی</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.overtimePay)}</td>
            <td colspan="2" style="background: #ffffff; text-align: center; font-weight: bold; color: #000000; font-size: 7.5px; border-top: 1px dashed #000000;">
              مبانی محاسباتی بیمه و مالیات
            </td>
          </tr>
          <tr>
            <td>فوق‌العاده جمعه‌کاری (۴۰٪ قانونی)</td>
            <td class="text-left font-mono">${formatWithCommas(s.fridayWorkPay)}</td>
            <td>حقوق و مزایای مشمول کسر بیمه:</td>
            <td class="text-left font-mono">${formatWithCommas(s.insurableBase)}</td>
          </tr>
          <tr>
            <td>فوق‌العاده تعطیل‌کاری رسمی</td>
            <td class="text-left font-mono">${formatWithCommas(s.holidayWorkPay)}</td>
            <td>حقوق و مزایای مشمول مالیات:</td>
            <td class="text-left font-mono">${formatWithCommas(s.taxableBase)}</td>
          </tr>
          <tr>
            <td>فوق‌العاده شغل و حق مسئولیت</td>
            <td class="text-left font-mono">${formatWithCommas(s.jobAllowance)}</td>
            <td>بیمه سهم کارفرما (${toPersianDigits('23')}٪):</td>
            <td class="text-left font-mono">${formatWithCommas(s.totalEmployerInsurance23)}</td>
          </tr>
          <tr>
            <td>عیدی و پاداش ماهانه (سهم ۲/۳۶۵ کارکرد)</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.monthlyEidi || 0)}</td>
            <td style="color: #666666; font-size: 7.5px;">وضعیت پرداخت: جاری / ذخیره</td>
            <td class="text-left font-mono" style="color: #666666; font-size: 7.5px;">مطابق ضوابط کارگاه</td>
          </tr>
          <tr>
            <td>پاداش سنوات خدمت ماهانه (سهم ۱/۳۶۵ کارکرد)</td>
            <td class="text-left font-mono font-bold">${formatWithCommas(s.monthlyYearsBenefit || 0)}</td>
            <td style="color: #666666; font-size: 7.5px;">وضعیت پرداخت: جاری / ذخیره</td>
            <td class="text-left font-mono" style="color: #666666; font-size: 7.5px;">مطابق ضوابط کارگاه</td>
          </tr>
          <tr style="border-top: 1.5px solid #000000;">
            <td style="font-weight: 900; color: #000000;">جمع کل حقوق و مزایا (استحقاقی):</td>
            <td class="text-left font-mono font-black" style="color: #000000; font-size: 9.5px;">${formatWithCommas(s.totalGrossSalary)}</td>
            <td style="font-weight: 900; color: #000000; background: #ffffff;">جمع کل کسورات:</td>
            <td class="text-left font-mono font-black" style="color: #000000; background: #ffffff; font-size: 9.5px;">${formatWithCommas(s.totalDeductions)}</td>
          </tr>
        </tbody>
      </table>

      <!-- 5. Net Payable Banner -->
      <div class="net-box">
        <div>
          <div style="font-size: 9.5px; font-weight: 900; color: #000000;">
            خالص پرداختی نهایی به کارگر (پس از کسر کلیه کسورات قانونی):
          </div>
          <div style="font-size: 8px; color: #111111; margin-top: 1.5px;">
            مبلغ به حروف: <strong>« ${s.netPayableInWords} ریال »</strong>
            ${s.netPayable > 0 ? `<span style="margin-right: 6px; color: #000000; font-weight: bold;">(معادل: ${formatWithCommas(Math.round(s.netPayable / 10))} تومان)</span>` : ''}
          </div>
        </div>
        <div style="text-align: left;">
          <div class="net-number">${formatWithCommas(s.netPayable)} ریال</div>
          <div style="font-size: 7.5px; color: #000000; font-weight: bold;">آماده حواله پایا / ساتنا به شبا</div>
        </div>
      </div>

      <!-- 6. Legal Acknowledgement & Signatures -->
      ${showSignatures ? `
        <div class="legal-receipt">
          <strong>اقرارنامه و رسید دریافت دستمزد (ماده ۳۷ قانون کار):</strong> این فیش بر اساس کارکرد واقعی و حضور در محل کار تنظیم گردیده و اینجانب با امضای ذیل آن اعلام می‌دارم که کلیه حقوق، مزایا، اضافه‌کار و سایر مطالبات قانونی خود مربوط به ماه جاری را مطابق ارقام مندرج و پس از کسر کسورات قانونی دریافت نمودم.
        </div>
        <div class="signatures-grid">
          <div class="sig-box">
            <span>تنظیم‌کننده (حسابداری حقوق):</span>
            <span class="dots">......................................</span>
          </div>
          <div class="sig-box">
            <span>بررسی‌کننده (امور اداری و منابع انسانی):</span>
            <span class="dots">......................................</span>
          </div>
          <div class="sig-box">
            <span>تاییدکننده (مدیریت کارگاه):</span>
            <span class="dots">......................................</span>
          </div>
          <div class="sig-box">
            <span>امضا و اثر انگشت کارگر:</span>
            <span class="dots">......................................</span>
          </div>
        </div>
      ` : ''}

      <div class="footer-watermark">
        سامانه جامع حسابداری و حقوق و دستمزد فروشگاه و کارگاه گاتان | تولید رسمی طبق استانداردهای اداره کار و سازمان تامین اجتماعی
      </div>
    `;
  }

  // Copy structured text to clipboard for SMS or Messenger sharing
  const handleCopySummary = () => {
    const fullName = currentPayslip.employee.fullName || `${currentPayslip.employee.firstName} ${currentPayslip.employee.lastName}`;
    const text = `
📋 فیش حقوق و دستمزد ماهیانه (استاندارد قانون کار)
🏢 کارگاه: ${currentPayslip.workshopName}
👤 پرسنل: ${fullName} (کد پرسنلی: ${toPersianDigits(currentPayslip.employee.employeeCode)})
🆔 کد ملی: ${toPersianDigits(currentPayslip.employee.nationalId || currentPayslip.nationalId || '-')}
📅 دوره کارکرد: ${currentPayslip.monthName} ${toPersianDigits(currentPayslip.year)}
⏱ روز کارکرد: ${toPersianDigits(currentPayslip.actualWorkedDays)} روز | اضافه کار: ${toPersianDigits(currentOtRoundedHours)} ساعت | جمعه‌کاری: ${toPersianDigits(currentFridayRoundedHours)} ساعت | تعطیل‌کاری: ${toPersianDigits(currentHolidayRoundedHours)} ساعت
🌴 مانده مرخصی: ${toPersianDigits(currentPayslip.finalLeaveHM || currentPayslip.leaveHoursHM || '۰:۰۰')}

💵 جمع حقوق و مزایای ناخالص: ${formatWithCommas(currentPayslip.totalGrossSalary)} ریال
  • حقوق پایه: ${formatWithCommas(currentPayslip.monthlyBaseSalary)} ریال
  • اضافه کار: ${formatWithCommas(currentPayslip.overtimePay)} ریال
  • عیدی ماهانه: ${formatWithCommas(currentPayslip.monthlyEidi || 0)} ریال
  • سنوات ماهانه: ${formatWithCommas(currentPayslip.monthlyYearsBenefit || 0)} ریال
🛡 بیمه سهم کارگر (۷٪): ${formatWithCommas(currentPayslip.workerInsurance7)} ریال
⚖ مالیات حقوق: ${formatWithCommas(currentPayslip.payrollTax)} ریال
🔻 جمع کل کسورات: ${formatWithCommas(currentPayslip.totalDeductions)} ریال
==============================
💰 خالص پرداختی نهایی: ${formatWithCommas(currentPayslip.netPayable)} ریال
(« ${currentPayslip.netPayableInWords} ریال »)
معادل: ${formatWithCommas(Math.round(currentPayslip.netPayable / 10))} تومان
💳 شماره شبا: ${currentPayslip.shebaNumber || '-'}
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentFullName = currentPayslip.employee.fullName || `${currentPayslip.employee.firstName} ${currentPayslip.employee.lastName}`;
  const overtimeHourlyRate = currentPayslip.overtimeHourlyRate || Math.round(currentPayslip.hourlyWage * 1.4);
  const fridayHourlyRate = (currentPayslip.fridayHourlyRate !== undefined && currentPayslip.fridayHourlyRate > 0)
    ? currentPayslip.fridayHourlyRate
    : Math.round(((currentPayslip.dailyBaseSalary || 0) * 0.40) / 7.33);
  const holidayHourlyRate = currentPayslip.holidayHourlyRate || overtimeHourlyRate;
  const currentOtRoundedHours = formatRoundedPayslipHour(currentPayslip.overtimeHours, currentPayslip.overtimeHoursHM);
  const currentFridayRoundedHours = formatRoundedPayslipHour(currentPayslip.fridayWorkHours, currentPayslip.fridayWorkHoursHM);
  const currentHolidayRoundedHours = formatRoundedPayslipHour(currentPayslip.holidayWorkHours, currentPayslip.holidayWorkHoursHM);

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-hidden"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 w-full max-w-5xl h-[94dvh] max-h-[94dvh] rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Top Control Bar */}
        <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 bg-slate-950 border-b border-slate-800 space-y-2.5 shrink-0">
          {/* Row 1: Title + Pinned Close Button */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20 shrink-0">
                <FileText className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-black text-white flex items-center gap-2 flex-wrap">
                  <span className="truncate">فیش رسمی حقوق و دستمزد پرسنل</span>
                  <span className="hidden md:inline text-[10px] text-emerald-400 font-bold border-r border-slate-700 pr-2">
                    استاندارد مصوب قانون کار و تامین اجتماعی
                  </span>
                </h3>
                <p className="text-[10px] sm:text-[10.5px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>دوره:</span>
                  <strong className="text-slate-200">{currentPayslip.monthName} {toPersianDigits(year)}</strong>
                  <span className="text-slate-600">·</span>
                  <span>تعداد کل فیش‌ها:</span>
                  <strong className="text-rose-400">{toPersianDigits(payslips.length)}</strong>
                  <span>نفر</span>
                </p>
              </div>
            </div>

            {/* Prominent Always-Visible Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/35 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
              title="بستن پنجره فیش حقوق (Esc)"
            >
              <X className="h-4 w-4" />
              <span>بستن</span>
            </button>
          </div>

          {/* Row 2: Print Layout & Quick Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/70">
            {/* Layout switch: A5 Dual on A4 vs A5 Single vs A4 Full */}
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-1 text-[11px] sm:text-xs flex-wrap gap-0.5">
              <button
                type="button"
                onClick={() => setLayoutMode('a5_dual')}
                className={`px-2 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                  layoutMode === 'a5_dual' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="چاپ دو فیش A5 در یک برگ A4 (بالا و پایین با خط برش وسط)"
              >
                <Scissors className="h-3 w-3" />
                <span>دو فیش در یک A4</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('a5_single')}
                className={`px-2 py-1 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap ${
                  layoutMode === 'a5_single' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="ابعاد استاندارد اختصاصی برگه A5"
              >
                تک‌فیش A5
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('a4_portrait')}
                className={`px-2 py-1 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap ${
                  layoutMode === 'a4_portrait' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="قالب استاندارد رسمی تک برگی تمام‌صفحه A4"
              >
                تک‌برگی A4
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* Print Current */}
              <button
                type="button"
                onClick={() => handlePrint('current')}
                className="px-2.5 sm:px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[11px] sm:text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer whitespace-nowrap"
                title="چاپ فیش پرسنل فعلی (در حالت دو فیش در یک A4، نسخه پرسنل و نسخه بایگانی در یک برگه A4 چاپ می‌شود)"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>چاپ فیش</span>
              </button>

              {/* Print All */}
              <button
                type="button"
                onClick={() => handlePrint('all')}
                className="px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] sm:text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
                title="چاپ تمامی فیش‌های پرسنل (در حالت دو فیش در یک A4، هر برگه دو فیش را در خود جای می‌دهد)"
              >
                <Printer className="h-3.5 w-3.5 text-emerald-400" />
                <span>چاپ همه ({toPersianDigits(payslips.length)})</span>
              </button>

              {/* Copy button */}
              <button
                type="button"
                onClick={handleCopySummary}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                title="کپی خلاصه فیش در کلیپ‌بورد"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{copied ? 'کپی شد' : 'کپی'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sub-bar: Navigation, Search & Toggles */}
        <div className="px-3.5 sm:px-4 py-2 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 font-bold hidden sm:inline">انتخاب پرسنل:</span>
            
            {/* Next / Prev */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
              <button
                type="button"
                disabled={currentIndex <= 0}
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="پرسنل قبلی"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="font-mono px-1.5 text-slate-200 font-bold text-[11px]">
                {toPersianDigits(currentIndex + 1)} از {toPersianDigits(payslips.length)}
              </span>
              <button
                type="button"
                disabled={currentIndex >= payslips.length - 1}
                onClick={() => setCurrentIndex(prev => Math.min(payslips.length - 1, prev + 1))}
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="پرسنل بعدی"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            {/* Employee Dropdown */}
            <select
              value={currentIndex}
              onChange={e => setCurrentIndex(Number(e.target.value))}
              className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:border-rose-500 font-bold max-w-[200px] sm:max-w-xs cursor-pointer"
            >
              {filteredIndices.length > 0 ? (
                filteredIndices.map((idx) => {
                  const p = payslips[idx];
                  return (
                    <option key={p.employee.id || idx} value={idx}>
                      {toPersianDigits(idx + 1)}. {p.employee.fullName || `${p.employee.firstName} ${p.employee.lastName}`} ({toPersianDigits(p.employee.employeeCode)})
                    </option>
                  );
                })
              ) : (
                <option value={currentIndex}>موردی با این جستجو یافت نشد</option>
              )}
            </select>

            {/* Quick search input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجوی نام، کد ملی، پرسنلی..."
                className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl pr-8 pl-3 py-1.5 focus:border-rose-500 w-40 sm:w-44 font-medium"
              />
              <Search className="h-3.5 w-3.5 text-slate-500 absolute right-2.5 top-2" />
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {layoutMode === 'a5_dual' && (
              <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-amber-300 font-bold bg-amber-950/40 border border-amber-700/50 px-2.5 py-1 rounded-xl">
                <Scissors className="h-3.5 w-3.5 text-amber-400" />
                <span>چاپ اقتصادی: ۲ فیش A5 در هر برگ A4 با خط برش</span>
              </div>
            )}

            <label className="flex items-center gap-1.5 text-slate-300 text-[11px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showEmployerContrib}
                onChange={e => setShowEmployerContrib(e.target.checked)}
                className="accent-rose-600 rounded cursor-pointer"
              />
              <span>نمایش سهم بیمه کارفرما</span>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300 text-[11px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSignatures}
                onChange={e => setShowSignatures(e.target.checked)}
                className="accent-rose-600 rounded cursor-pointer"
              />
              <span>محل امضاها و اقرارنامه</span>
            </label>
          </div>
        </div>

        {/* Modal Scrollable Body: High-Fidelity Paper Simulation */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 sm:p-4 md:p-5 bg-slate-950/80">
          <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-2xl p-3 sm:p-5 md:p-6 font-sans border-2 border-slate-800 text-slate-950 select-text">
            
            {/* Header Section */}
            <div className="pb-3 mb-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-right border-b-2 border-slate-900">
              <div className="text-right space-y-0.5 sm:w-1/4">
                <div className="font-black text-sm text-slate-950">
                  {currentPayslip.workshopName}
                </div>
                <div className="text-[11px] text-slate-800 font-bold">
                  کد کارگاه تامین اجتماعی: <span className="font-mono font-black text-slate-950">{toPersianDigits(currentPayslip.workshopCode)}</span>
                </div>
                <div className="text-[10px] text-slate-700 font-bold">
                  شعبه بیمه: {currentPayslip.insuranceBranch || 'شعبه ۱ تامین اجتماعی'}
                </div>
              </div>

              <div className="text-center sm:flex-1">
                <h2 className="text-base sm:text-lg font-black text-slate-950">
                  فیش رسمی حقوق و دستمزد ماهیانه
                </h2>
                <div className="text-xs font-black mt-0.5 text-slate-800">
                  منطبق بر ضوابط قانون کار و سازمان تامین اجتماعی - {currentPayslip.monthName} {toPersianDigits(currentPayslip.year)}
                </div>
              </div>

              <div className="text-left space-y-0.5 sm:w-1/4 font-sans text-xs">
                <div className="text-slate-900 font-bold">
                  شماره سند: <strong className="font-mono font-black text-slate-950">{toPersianDigits(currentPayslip.slipNumber)}</strong>
                </div>
                <div className="text-slate-900 font-bold">
                  تاریخ صدور: <span className="font-mono font-black text-slate-950">{toPersianDigits(currentPayslip.issueDate)}</span>
                </div>
                <div className="text-[10.5px] font-black text-emerald-950 bg-emerald-100 border border-emerald-500 px-2 py-0.5 rounded inline-block">
                  تسویه قطعی ماهانه
                </div>
              </div>
            </div>

            {/* Block 1: Personnel Identification & Contract Details */}
            <div className="mb-3">
              <div className="font-black text-xs px-3 py-1.5 rounded-t-lg bg-slate-900 text-white border border-slate-900">
                ۱. مشخصات هویتی، استخدامی و حساب بانکی پرسنل
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-right text-xs border-collapse border border-slate-400">
                <tbody>
                  <tr className="border-b border-slate-300">
                    <td className="p-2 font-black w-1/6 border-l border-slate-300 text-slate-900">نام و خانوادگی:</td>
                    <td className="p-2 font-black w-2/6 border-l border-slate-300 text-slate-950 text-sm">{currentFullName}</td>
                    <td className="p-2 font-black w-1/6 border-l border-slate-300 text-slate-900">کد ملی:</td>
                    <td className="p-2 font-mono font-black w-2/6 text-slate-950">{toPersianDigits(currentPayslip.employee?.nationalId || currentPayslip.nationalId || '')}</td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">شماره پرسنلی / تردد:</td>
                    <td className="p-2 font-mono font-black border-l border-slate-300 text-slate-950">
                      {toPersianDigits(currentPayslip.employee?.employeeCode || '')}
                      {currentPayslip.employee?.attendanceCode ? ` / تردد: ${toPersianDigits(currentPayslip.employee.attendanceCode)}` : ''}
                    </td>
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">شماره بیمه:</td>
                    <td className="p-2 font-mono font-black text-slate-950">{toPersianDigits(currentPayslip.insuranceCode || currentPayslip.employee?.insuranceCode || '')}</td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">عنوان شغلی / سمت:</td>
                    <td className="p-2 font-bold border-l border-slate-300 text-slate-950">{currentPayslip.employee?.role || (currentPayslip.employee as any)?.jobTitle || currentPayslip.jobTitle || ''}</td>
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">دپارتمان / مرکز هزینه:</td>
                    <td className="p-2 font-bold text-slate-950">{currentPayslip.department || ''}</td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">نام پدر:</td>
                    <td className="p-2 font-bold border-l border-slate-300 text-slate-950">{currentPayslip.employee?.fatherName || currentPayslip.fatherName || ''}</td>
                    <td className="p-2 font-black border-l border-slate-300 text-slate-900">وضعیت تاهل / اولاد:</td>
                    <td className="p-2 font-bold text-slate-950">
                      {currentPayslip.maritalStatusText || ''}{currentPayslip.childrenCount ? ` (${toPersianDigits(currentPayslip.childrenCount)} فرزند مشمول ماده ۸۶)` : ''}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-2.5 font-black border-l border-slate-300 text-slate-900">نوع قرارداد کار:</td>
                    <td className="p-2.5 border-l border-slate-300 font-bold text-slate-950">{currentPayslip.contractType || ''}</td>
                    <td className="p-2.5 font-black border-l border-slate-300 text-slate-900">تاریخ استخدام:</td>
                    <td className="p-2.5 font-mono font-bold text-slate-950">
                      {toPersianDigits(currentPayslip.employee?.entryDate || currentPayslip.hireDate || '')}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-300">
                    <td className="p-2.5 font-black border-l border-slate-300 text-slate-900">قرارداد متناظر دوره:</td>
                    <td className="p-2.5 border-l border-slate-300 font-mono text-xs font-bold text-slate-950">
                      {currentPayslip.contractStartDate 
                        ? `از ${toPersianDigits(currentPayslip.contractStartDate)} ${currentPayslip.contractEndDate ? `تا ${toPersianDigits(currentPayslip.contractEndDate)}` : ''}` 
                        : ''}
                    </td>
                    <td className="p-2.5 font-black border-l border-slate-300 text-slate-900">پایه سنوات ماهانه قرارداد:</td>
                    <td className="p-2.5 font-mono font-bold text-slate-950">
                      {formatWithCommas(currentPayslip.contractSeniorityBase ?? currentPayslip.seniorityBase ?? 0)} ریال
                    </td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-black border-l border-slate-300 text-slate-900">مشخصات حساب بانکی:</td>
                    <td colSpan={3} className="p-2.5 font-mono text-xs font-bold text-slate-950">
                      {currentPayslip.bankName ? `بانک: ${currentPayslip.bankName} ` : ''}
                      {currentPayslip.shebaNumber ? `| شبا: ${currentPayslip.shebaNumber} ` : ''}
                      {(currentPayslip.bankAccount || (currentPayslip.employee as any)?.bankAccountNumber || currentPayslip.employee?.bankAccount) ? `| حساب: ${currentPayslip.bankAccount || (currentPayslip.employee as any)?.bankAccountNumber || currentPayslip.employee?.bankAccount}` : ''}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>

            {/* Block 2: Attendance Metrics & Wage Rate Bases */}
            <div className="mb-4">
              <div className="font-black text-xs px-3.5 py-2 rounded-t-xl flex items-center justify-between bg-slate-900 text-white">
                <span>۲. خلاصه کارکرد، حضور و غیاب و پایه‌های محاسباتی دستمزد (بر اساس کارنامه تردد و قرارداد)</span>
                <span className="text-[11px] font-bold text-slate-300">دوره: {currentPayslip.monthName} {toPersianDigits(year)}</span>
              </div>
              
              {/* Attendance Grid with High Legibility */}
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5 text-center border border-slate-300 p-2.5 bg-slate-50">
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">روزهای تقویمی</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.totalDaysInMonth)} روز</strong>
                </div>
                <div className="p-2 rounded-xl bg-emerald-50 border-2 border-emerald-500 shadow-xs">
                  <span className="block text-[11px] font-black text-emerald-950">کارکرد موثر</span>
                  <strong className="font-mono text-sm font-black block mt-0.5 text-emerald-950">{toPersianDigits(currentPayslip.actualWorkedDays)} روز</strong>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">روزهای بیمه</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.insuranceDays)} روز</strong>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">ساعات موظفی</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.requiredHours)} س</strong>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">ساعات کارکرد</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.workedHoursHM || '۰:۰۰')}</strong>
                </div>
                <div className="p-2 rounded-xl bg-amber-50 border-2 border-amber-500 shadow-xs">
                  <span className="block text-[11px] font-black text-amber-950">اضافه کاری عادی</span>
                  <strong className="font-mono text-sm font-black block mt-0.5 text-amber-950">
                    {toPersianDigits(currentOtRoundedHours)} ساعت
                  </strong>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">جمعه کاری</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">
                    {toPersianDigits(currentFridayRoundedHours)} ساعت
                  </strong>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-300 shadow-xs">
                  <span className="block text-[11px] font-bold text-slate-700">تعطیل کاری</span>
                  <strong className="font-mono text-sm block mt-0.5 text-slate-950 font-black">
                    {toPersianDigits(currentHolidayRoundedHours)} ساعت
                  </strong>
                </div>
                <div className="p-2 rounded-xl bg-rose-50 border border-rose-400 shadow-xs">
                  <span className="block text-[11px] font-bold text-rose-900">تاخیر و کسر کار</span>
                  <strong className="font-mono text-sm block mt-0.5 text-rose-950 font-black">{toPersianDigits(currentPayslip.delayHoursHM || '۰:۰۰')}</strong>
                </div>
              </div>

              {/* Dedicated Leave Breakdown Box with High Contrast */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs p-2.5 text-center font-mono border-x border-b border-slate-300 bg-emerald-50/50">
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">مرخصی مانده از قبل:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.prevLeaveHM || '۰:۰۰')}</strong>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">مرخصی استحقاقی ماه:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.allocatedLeaveHM || '۰:۰۰')}</strong>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">مرخصی استفاده‌شده:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{toPersianDigits(currentPayslip.usedLeaveHM || '۰:۰۰')}</strong>
                </div>
                <div className="bg-emerald-100 p-2 rounded-xl border-2 border-emerald-500">
                  <span className="text-xs block font-sans font-black text-emerald-950">مانده نهایی مرخصی:</span>
                  <strong className="text-sm block mt-0.5 text-emerald-950 font-black">{toPersianDigits(currentPayslip.finalLeaveHM || currentPayslip.leaveHoursHM || '۰:۰۰')}</strong>
                </div>
              </div>

              {/* Wage Rates Row with Explicit Seniority Base */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs p-2.5 text-center font-mono border-x border-b border-slate-300 bg-sky-50/50">
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">مزد ثابت روزانه:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{formatWithCommas(currentPayslip.dailyBaseSalary)}</strong>
                  <span className="text-[10px] text-slate-600 font-bold">ریال</span>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">نرخ ساعت عادی:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{formatWithCommas(currentPayslip.hourlyWage)}</strong>
                  <span className="text-[10px] text-slate-600 font-bold">ریال</span>
                </div>
                <div className="bg-slate-900 p-2 rounded-xl border border-slate-700">
                  <span className="text-xs block font-sans font-bold text-white">نرخ اضافه‌کار:</span>
                  <strong className="text-sm block mt-0.5 text-white font-black">{formatWithCommas(overtimeHourlyRate)}</strong>
                  <span className="text-[10px] text-slate-300 font-bold">ریال</span>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">نرخ جمعه‌کاری:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{formatWithCommas(fridayHourlyRate)}</strong>
                  <span className="text-[10px] text-slate-600 font-bold">ریال</span>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-300">
                  <span className="text-xs block font-sans font-bold text-slate-800">نرخ تعطیل‌کاری:</span>
                  <strong className="text-sm block mt-0.5 text-slate-950 font-black">{formatWithCommas(holidayHourlyRate)}</strong>
                  <span className="text-[10px] text-slate-600 font-bold">ریال</span>
                </div>
                <div className="bg-amber-100 p-2 rounded-xl border border-amber-400">
                  <span className="text-xs block font-sans font-black text-amber-950">پایه سنوات ماهانه:</span>
                  <strong className="text-sm block mt-0.5 text-amber-950 font-black">{formatWithCommas(currentPayslip.seniorityBase)}</strong>
                  <span className="text-[10px] text-amber-950 font-bold">ریال</span>
                </div>
              </div>
            </div>

            {/* Block 3: Detailed Earnings & Deductions Table */}
            <div className="mb-4">
              <div className="font-black text-xs px-3.5 py-2 rounded-t-xl bg-slate-900 text-white">
                ۳. ریز اقلام حقوق، مزایا، کسورات و تعهدات قانونی (منطبق بر قرارداد متناظر)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-slate-300 rounded-b-xl overflow-hidden">
                
                {/* Right Column: Earnings */}
                <div className="border-b md:border-b-0 md:border-l border-slate-300">
                  <div className="p-2.5 text-center text-xs font-black bg-emerald-100 text-emerald-950 border-b border-slate-300">
                    حقوق و مزایای ناخالص (استحقاقی‌ها)
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="p-2.5 font-bold text-slate-900">حقوق پایه کارکرد ({toPersianDigits(currentPayslip.actualWorkedDays)} روز)</td>
                        <td className="p-2.5 text-left font-mono font-black text-slate-950">{formatWithCommas(currentPayslip.monthlyBaseSalary)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">کمک هزینه اقلام مصرفی خانوار (حق بن)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.foodAllowance)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">کمک هزینه مسکن (حق مسکن مصوب)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.housingAllowance)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">حق اولاد و عائله‌مندی ({toPersianDigits(currentPayslip.childrenCount)} فرزند)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.childAllowance)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">حق تاهل مصوب قانون کار</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.marriageAllowance)} ریال</td>
                      </tr>
                      
                      {/* Monthly Seniority Base */}
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">
                          <div className="flex items-center gap-1.5">
                            <span>پایه سنوات ماهانه (مزد سنوات)</span>
                            <span className="text-[10px] px-1.5 py-0.5 border border-slate-600 text-slate-800 rounded font-bold">قرارداد متناظر</span>
                          </div>
                        </td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.seniorityBase)} ریال
                        </td>
                      </tr>

                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">فوق‌العاده اضافه کاری عادی</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.overtimePay)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">فوق‌العاده جمعه‌کاری (۴۰٪ قانونی)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.fridayWorkPay)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">فوق‌العاده کار در روزهای تعطیل رسمی</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.holidayWorkPay)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">فوق‌العاده شغل / حق مسئولیت کارگاهی</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.jobAllowance)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">عیدی و پاداش ماهانه (سهم ۲/۳۶۵ کارکرد)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.monthlyEidi || 0)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">پاداش سنوات خدمت ماهانه (سهم ۱/۳۶۵ کارکرد)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">{formatWithCommas(currentPayslip.monthlyYearsBenefit || 0)} ریال</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-emerald-100 border-slate-400 text-emerald-950">
                        <th className="p-3 text-right font-black text-xs text-emerald-950">جمع کل حقوق و مزایا (استحقاقی):</th>
                        <th className="p-3 text-left font-mono font-black text-sm text-emerald-950">
                          {formatWithCommas(currentPayslip.totalGrossSalary)} ریال
                        </th>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Left Column: Deductions */}
                <div>
                  <div className="p-2.5 text-center text-xs font-black bg-rose-100 text-rose-950 border-b border-slate-300">
                    کسورات قانونی و اختیاری
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">حق بیمه تامین اجتماعی سهم کارگر (۷٪)</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.workerInsurance7)} ریال
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">مالیات بر درآمد حقوق ماهانه</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.payrollTax)} ریال
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">بیمه تکمیلی درمان سهم کارگر</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.supplementaryInsurance)} ریال
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">مساعده و علی‌الحساب‌های دریافتی</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.salaryAdvanceDeduction || 0)} ریال
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">اقساط وام و خرید پرسنل از کارگاه</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.loanInstallmentDeduction || 0)} ریال
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 font-bold text-slate-800">سایر کسورات قانونی و توافقی</td>
                        <td className="p-2.5 text-left font-mono font-bold text-slate-950">
                          {formatWithCommas(currentPayslip.otherDeductions || 0)} ریال
                        </td>
                      </tr>

                      {/* Stat Bases */}
                      <tr className="border-t border-slate-300">
                        <td colSpan={2} className="p-2.5 font-black text-xs text-slate-900">
                          مبانی محاسباتی تامین اجتماعی و امور مالیاتی:
                        </td>
                      </tr>
                      <tr>
                        <td className="p-2.5 text-xs font-bold text-slate-800">حقوق و مزایای مشمول کسر حق بیمه:</td>
                        <td className="p-2.5 text-left font-mono font-black text-slate-950">{formatWithCommas(currentPayslip.insurableBase)} ریال</td>
                      </tr>
                      <tr>
                        <td className="p-2.5 text-xs font-bold text-slate-800">حقوق و مزایای مشمول مالیات حقوق:</td>
                        <td className="p-2.5 text-left font-mono font-black text-slate-950">{formatWithCommas(currentPayslip.taxableBase)} ریال</td>
                      </tr>
                      {showEmployerContrib && (
                        <tr>
                          <td className="p-2.5 text-xs font-bold text-slate-800">بیمه سهم کارفرما (۲۰٪) + بیکاری (۳٪):</td>
                          <td className="p-2.5 text-left font-mono font-black text-slate-950">{formatWithCommas(currentPayslip.totalEmployerInsurance23)} ریال</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-rose-100 border-slate-400 text-rose-950">
                        <th className="p-3 text-right font-black text-xs text-rose-950">جمع کل کسورات قانونی و اختیاری:</th>
                        <th className="p-3 text-left font-mono font-black text-sm text-rose-950">
                          {formatWithCommas(currentPayslip.totalDeductions)} ریال
                        </th>
                      </tr>
                    </tfoot>
                  </table>
                </div>

              </div>
            </div>

            {/* Block 4: Final Net Payable Banner */}
            <div className="p-4 my-3 flex flex-col sm:flex-row items-center justify-between gap-3 bg-gradient-to-r from-emerald-100 via-slate-50 to-emerald-100 border-2 border-emerald-600 rounded-xl shadow-md">
              <div className="text-right">
                <span className="text-xs font-black block text-slate-950">
                  مبلغ خالص حقوق قابل پرداخت به پرسنل:
                </span>
                <span className="text-xs font-black mt-1 block text-slate-950">
                  به حروف: <strong className="text-emerald-950 font-black">« {currentPayslip.netPayableInWords} ریال »</strong>
                </span>
                <span className="text-[11.5px] mt-0.5 block text-slate-800 font-bold">
                  معادل: <strong className="text-emerald-950 font-black">{formatWithCommas(Math.round(currentPayslip.netPayable / 10))} تومان</strong>
                </span>
              </div>
              <div className="text-left font-mono">
                <div className="text-2xl font-black text-emerald-950">
                  {formatWithCommas(currentPayslip.netPayable)} <span className="text-sm font-bold text-slate-800">ریال</span>
                </div>
                <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full inline-block mt-1 text-emerald-950 bg-emerald-200 border border-emerald-500">
                  تایید شده جهت واریز حواله بانکی
                </span>
              </div>
            </div>

            {/* Block 5: Signatures & Legal Verification */}
            {showSignatures && (
              <div className="p-3 mt-3 space-y-3 border-2 border-slate-400 rounded-xl bg-slate-50">
                <p className="text-[10.5px] leading-relaxed text-justify border-b border-slate-300 pb-2 text-black font-semibold">
                  <strong>اقرارنامه و رسید دریافت دستمزد (ماده ۳۷ قانون کار):</strong> این فیش به منزله برگه رسمی اعلام کارکرد و حقوق ماهیانه کارگر صادر گردیده و پرسنل با امضای ذیل آن اعلام می‌دارد که کلیه حقوق و مزایای قانونی ماه جاری را بر اساس ارقام مندرج و پس از کسر کسورات قانونی به طور کامل دریافت نموده و نسبت به این دوره ادعایی ندارد.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs font-bold pt-1 text-slate-900">
                  <div className="h-14 flex flex-col justify-between">
                    <span>تنظیم‌کننده (امور مالی):</span>
                    <span className="text-[9px] font-mono text-slate-500">......................................</span>
                  </div>
                  <div className="h-14 flex flex-col justify-between">
                    <span>بررسی‌کننده (امور اداری):</span>
                    <span className="text-[9px] font-mono text-slate-500">......................................</span>
                  </div>
                  <div className="h-14 flex flex-col justify-between">
                    <span>تاییدکننده (مدیریت کارگاه):</span>
                    <span className="text-[9px] font-mono text-slate-500">......................................</span>
                  </div>
                  <div className="h-14 flex flex-col justify-between">
                    <span>امضا و اثر انگشت کارگر:</span>
                    <span className="text-[9px] font-mono text-slate-500">......................................</span>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Pinned Bottom Footer Bar */}
        <div className="px-3.5 sm:px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-400 truncate">
            فیش فعلی: <strong className="text-slate-200">{currentFullName}</strong> ({toPersianDigits(currentPayslip.employee.employeeCode)})
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handlePrint('current')}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>چاپ فیش</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-black rounded-xl transition-all cursor-pointer"
            >
              بستن پنجره
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalContent;
  return createPortal(modalContent, document.body);
};
