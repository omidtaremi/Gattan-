/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function toPersianDigits(num: number | string | undefined | null): string {
  if (num === undefined || num === null) return '';
  const str = num.toString();
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return str.replace(/[0-9]/g, (w) => farsiDigits[parseInt(w, 10)]);
}

export function toEnglishDigits(str: string | number | undefined | null): string {
  if (str === undefined || str === null) return '';
  const s = str.toString();
  const farsiDigits = /[\u06f0-\u06f9]/g;
  const arabicDigits = /[\u0660-\u0669]/g;
  return s
    .replace(farsiDigits, (w) => (w.charCodeAt(0) - 1776).toString())
    .replace(arabicDigits, (w) => (w.charCodeAt(0) - 1632).toString());
}

export function formatWithCommas(num: number | string | undefined | null): string {
  if (num === undefined || num === null || num === '') return '۰';
  
  // Convert any persian numbers to english first
  const cleanEng = toEnglishDigits(num.toString()).replace(/[^0-9.-]/g, '');
  if (isNaN(parseFloat(cleanEng))) return '۰';

  const parts = cleanEng.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const englishFormatted = parts.join('.');
  
  return toPersianDigits(englishFormatted);
}

export function parseNumber(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const englishStr = toEnglishDigits(val).replace(/,/g, '');
  const parsed = parseFloat(englishStr);
  return isNaN(parsed) ? 0 : parsed;
}

export function getTodayJalali(): string {
  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      calendar: 'persian'
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
    }
  } catch (e) {
    // Fallback below
  }

  const today = new Date();
  const gy = today.getFullYear();
  const gm = today.getMonth() + 1;
  const gd = today.getDate();

  const g_days_in_month = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const j_days_in_month = [0, 31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let g_day_no = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400);

  for (let i = 1; i < gm; ++i) g_day_no += g_days_in_month[i];
  g_day_no += gd;

  let j_day_no = g_day_no - 719527;
  let j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;

  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;

  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }

  let jm = 1;
  for (let i = 1; i <= 12; ++i) {
    if (j_day_no < j_days_in_month[i]) {
      jm = i;
      break;
    }
    j_day_no -= j_days_in_month[i];
  }
  let jd = j_day_no + 1;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

// Convert JSON/Objects to CSV and prompt browser download with UTF-8 BOM
export function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => 
      row.map(val => {
        if (val === null || val === undefined) return '';
        const cell = val.toString().replace(/"/g, '""');
        return cell.includes(',') || cell.includes('\n') || cell.includes('"') ? `"${cell}"` : cell;
      }).join(',')
    )
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Generate printable content of a table or DOM element beautifully styled
export function printElement(titleOrElementId: string, htmlContent?: string) {
  try {
    let title = titleOrElementId;
    let content = htmlContent || '';

    // Check if the first argument or second argument is an existing element ID
    const elById1 = document.getElementById(titleOrElementId);
    if (!htmlContent && elById1) {
      content = elById1.innerHTML || elById1.outerHTML;
      title = 'چاپ اسناد و گزارش خزانه‌داری';
    } else if (htmlContent && elById1) {
      content = elById1.innerHTML || elById1.outerHTML;
      title = htmlContent;
    } else if (htmlContent) {
      const elById2 = document.getElementById(htmlContent);
      if (elById2) {
        content = elById2.innerHTML || elById2.outerHTML;
      }
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("مرورگر شما جلوی باز شدن پنجره چاپ را گرفته است (جلوگیری از Pop-up). لطفا افزونه‌های پاپ‌آپ بلاکر را غیرفعال کرده یا اپلیکیشن را در یک تب جدید باز کرده و مجددا تلاش فرمایید.");
      return;
    }

    const todayStr = toPersianDigits(getTodayJalali());
    const nowTimeStr = toPersianDigits(new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }));

    const professionalPrintStyles = `
      @page { 
        size: A4 portrait; 
        margin: 10mm 8mm 12mm 8mm; 
      }
      * {
        box-sizing: border-box;
      }
      body {
        font-family: 'Vazirmatn', Tahoma, 'B Nazanin', Arial, sans-serif;
        background-color: #ffffff;
        color: #1e293b;
        margin: 0;
        padding: 0;
        direction: rtl;
        text-align: right;
        font-size: 11px;
        line-height: 1.5;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print, button, input[type="button"], select {
        display: none !important;
      }
      .print-container {
        width: 100%;
        max-width: 100%;
        margin: 0 auto;
      }
      /* Professional Corporate Header */
      .official-header {
        border-bottom: 2px solid #0f172a;
        padding-bottom: 10px;
        margin-bottom: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .official-header .brand {
        display: flex;
        flex-direction: column;
      }
      .official-header .brand-title {
        font-size: 16px;
        font-weight: 900;
        color: #0f172a;
        letter-spacing: -0.5px;
      }
      .official-header .brand-sub {
        font-size: 10px;
        color: #64748b;
        font-weight: bold;
        margin-top: 2px;
      }
      .official-header .doc-title-box {
        text-align: center;
        border: 1px solid #cbd5e1;
        background-color: #f8fafc;
        padding: 6px 16px;
        border-radius: 8px;
      }
      .official-header .doc-title {
        font-size: 14px;
        font-weight: 800;
        color: #0f172a;
        margin: 0;
      }
      .official-header .doc-meta {
        font-size: 9.5px;
        color: #475569;
        text-align: left;
        line-height: 1.6;
        font-family: monospace, Tahoma;
      }
      /* Table styles */
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 15px;
        font-size: 10.5px;
      }
      table th {
        background-color: #f1f5f9 !important;
        color: #0f172a !important;
        font-weight: 800;
        border: 1px solid #cbd5e1;
        padding: 6px 8px;
        text-align: right;
      }
      table td {
        border: 1px solid #e2e8f0;
        padding: 5.5px 8px;
        text-align: right;
        color: #1e293b;
      }
      table tr:nth-child(even) td {
        background-color: #fafafa !important;
      }
      /* Professional Footer & Signatures */
      .official-signatures {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-top: 24px;
        page-break-inside: avoid;
        border-top: 1px dashed #cbd5e1;
        padding-top: 14px;
      }
      .signature-box {
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px;
        text-align: center;
        background-color: #ffffff;
        min-height: 70px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .signature-title {
        font-weight: bold;
        font-size: 9.5px;
        color: #475569;
      }
      .signature-line {
        font-size: 9px;
        color: #94a3b8;
        margin-top: 25px;
      }
      .official-page-footer {
        margin-top: 15px;
        text-align: center;
        font-size: 8.5px;
        color: #94a3b8;
        border-top: 1px solid #f1f5f9;
        padding-top: 6px;
      }
    `;

    const fontImports = `
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    `;

    const fullHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="fa">
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          ${fontImports}
          <style>
            ${professionalPrintStyles}
          </style>
        </head>
        <body>
          <div class="print-container">
            <div class="official-header">
              <div class="brand">
                <span class="brand-title">صنایع غذایی گاتان</span>
                <span class="brand-sub">سیستم جامع مدیریت مالی، حسابداری و خزانه‌داری</span>
              </div>
              <div class="doc-title-box">
                <h1 class="doc-title">${title}</h1>
              </div>
              <div class="doc-meta">
                <div>تاریخ چاپ: <strong>${todayStr}</strong></div>
                <div>ساعت چاپ: <strong>${nowTimeStr}</strong></div>
                <div>وضعیت: <strong>اسناد معتبر مالی</strong></div>
              </div>
            </div>

            <div class="content-wrapper">
              ${content}
            </div>

            <div class="official-signatures">
              <div class="signature-box">
                <span class="signature-title">صندوق‌دار / متصدی ثبت</span>
                <span class="signature-line">امضاء و اثر انگشت</span>
              </div>
              <div class="signature-box">
                <span class="signature-title">کارشناس خزانه‌داری</span>
                <span class="signature-line">امضاء و تایید</span>
              </div>
              <div class="signature-box">
                <span class="signature-title">مدیر امور مالی و بودجه</span>
                <span class="signature-line">امضاء و مهر مالی</span>
              </div>
              <div class="signature-box">
                <span class="signature-title">مدیریت عامل / بازرس</span>
                <span class="signature-line">تایید نهایی</span>
              </div>
            </div>

            <div class="official-page-footer">
              سند سیستمی و گزارش رسمی تولید شده توسط نرم‌افزار جامع خزانه‌داری گاتان • چاپ شده در تاریخ ${todayStr} ساعت ${nowTimeStr}
            </div>
          </div>

          <script>
            window.addEventListener('load', function() {
              if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function() {
                  setTimeout(function() {
                    try {
                      window.print();
                      window.close();
                    } catch (e) {
                      console.error(e);
                    }
                  }, 400);
                });
              } else {
                setTimeout(function() {
                  try {
                    window.print();
                    window.close();
                  } catch (e) {
                    console.error(e);
                  }
                }, 600);
              }
            });
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(fullHtml);
    printWindow.document.close();
  } catch (err: any) {
    console.error("Print window failed to open", err);
    alert("سیستم امنیتی مرورگر شما از باز شدن ابزار چاپ در این پنجره جلوگیری کرده است. لطفا بر روی دکمه «نمایش در تب جدید» در منوی بالای صفحه کلیک کنید تا برنامه در یک تب مستقل و امن باز شده و به راحتی بتوانید عملیات چاپ را انجام دهید.");
  }
}

/**
 * Dedicated thermal receipt printer helper (72mm standard 80mm-roll printable width, or 58mm).
 * Dynamically measures exact rendered content height (after fonts & sample images load) and injects
 * an exact `@page { size: 72mm <height>mm; }` rule so paper length matches report length with zero overflow or wasted paper.
 */
export function buildThermalReceiptDocumentHtml(
  title: string,
  bodyHtml: string,
  paperWidthMm: 72 | 80 | 58 = 72
): string {
  const effectivePaperWidth = paperWidthMm === 80 ? 72 : paperWidthMm;
  const safeContentWidth = effectivePaperWidth === 58 ? '52mm' : '68mm';

  const thermalStyles = `
    @page {
      size: ${effectivePaperWidth}mm auto;
      margin: 0mm !important;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${effectivePaperWidth}mm;
      max-width: ${effectivePaperWidth}mm;
      background: #ffffff;
      color: #000000;
      font-family: 'Vazirmatn', Tahoma, 'B Nazanin', Arial, sans-serif;
      direction: rtl;
      text-align: right;
      font-size: 10.5px;
      line-height: 1.42;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .thermal-sheet {
      width: ${safeContentWidth};
      max-width: ${safeContentWidth};
      margin: 0 auto;
      padding: 2mm 0.5mm 4mm 0.5mm;
      color: #000000;
    }
    .t-center { text-align: center; }
    .t-left { text-align: left; }
    .t-mono { font-family: ui-monospace, 'Cascadia Mono', 'Courier New', monospace; }
    .t-divider-solid { border-top: 1.5px solid #000000; margin: 5px 0; }
    .t-divider-double { border-top: 3px double #000000; margin: 6px 0; }
    .t-divider-dashed { border-top: 1px dashed #000000; margin: 5px 0; }
    .t-bar {
      background: #000000;
      color: #ffffff;
      text-align: center;
      font-weight: 900;
      padding: 4px 5px;
      border-radius: 3px;
      letter-spacing: -0.2px;
    }
    .t-kv {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 4px;
      margin: 2px 0;
    }
    .t-box {
      border: 1.5px solid #000000;
      border-radius: 4px;
      padding: 5px 6px;
      margin: 5px 0;
    }
    .t-box-double {
      border: 2.5px double #000000;
      border-radius: 4px;
      padding: 5px 6px;
      margin: 5px 0;
    }
    .t-box-dashed {
      border: 1px dashed #000000;
      border-radius: 4px;
      padding: 4px 6px;
      margin: 4px 0;
    }
    table.t-table {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0;
      font-size: 10px;
      table-layout: fixed;
    }
    table.t-table th {
      border-top: 1.5px solid #000000;
      border-bottom: 1.5px solid #000000;
      padding: 4px 2px;
      font-weight: 900;
      text-align: right;
    }
    table.t-table td {
      border-bottom: 1px dashed #000000;
      padding: 4px 2px;
      vertical-align: top;
    }
    table.t-table tr:last-child td {
      border-bottom: 1.5px solid #000000;
    }
    .t-photo {
      display: block;
      width: 100%;
      max-height: 52mm;
      object-fit: contain;
      border: 1px solid #000000;
      border-radius: 3px;
      padding: 2px;
      margin-top: 4px;
      background: #ffffff;
      filter: grayscale(100%) contrast(1.18);
    }
    @media print {
      html, body {
        width: ${effectivePaperWidth}mm !important;
        max-width: ${effectivePaperWidth}mm !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .t-avoid-break {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
  `;

  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>${thermalStyles}</style>
</head>
<body>
  <div class="thermal-sheet" id="thermal-sheet-root">${bodyHtml}</div>
</body>
</html>`;
}

export function printThermalReceipt(title: string, bodyHtml: string, paperWidthMm: 72 | 80 | 58 = 72) {
  const effectivePaperWidth = paperWidthMm === 80 ? 72 : paperWidthMm;
  const fullHtml = buildThermalReceiptDocumentHtml(title, bodyHtml, effectivePaperWidth);

  // Use an off-screen iframe with REAL paper width so exact rendered height can be measured accurately
  const existing = document.getElementById('gatan-thermal-print-frame');
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'gatan-thermal-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = `${effectivePaperWidth}mm`;
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) return;

  doc.open();
  doc.write(fullHtml);
  doc.close();

  const triggerPrint = () => {
    const win = iframe.contentWindow;
    if (!win || !doc) return;
    try {
      // Measure actual rendered height of the thermal receipt in millimeters
      const sheetEl = doc.getElementById('thermal-sheet-root') || doc.body;
      const measuredPx = Math.max(
        sheetEl?.scrollHeight || 0,
        Math.ceil(sheetEl?.getBoundingClientRect?.().height || 0),
        doc.body?.scrollHeight || 0
      );
      // Convert CSS pixels (96dpi) -> mm, plus 6mm feed margin for thermal cutter
      const exactHeightMm = Math.max(45, Math.ceil((measuredPx * 25.4) / 96) + 6);

      // Inject dynamic exact-length @page rule so roll length equals exact report length
      const existingDyn = doc.getElementById('dynamic-thermal-page-size');
      if (existingDyn) existingDyn.remove();
      const dynStyle = doc.createElement('style');
      dynStyle.id = 'dynamic-thermal-page-size';
      dynStyle.textContent = `
        @page {
          size: ${effectivePaperWidth}mm ${exactHeightMm}mm !important;
          margin: 0mm !important;
        }
        @media print {
          html, body {
            width: ${effectivePaperWidth}mm !important;
            height: ${exactHeightMm}mm !important;
            overflow: hidden !important;
          }
        }
      `;
      doc.head.appendChild(dynStyle);
      iframe.style.height = `${exactHeightMm}mm`;

      win.focus();
      win.print();
    } catch (err) {
      console.error('Thermal print failed:', err);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 2500);
    }
  };

  // Wait for fonts and all sample images inside the receipt to finish loading before measuring height
  const waitForAssets = () => {
    const imgs = Array.from(doc.images || []);
    const imgPromises = imgs.map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>(res => {
            img.onload = () => res();
            img.onerror = () => res();
          })
    );
    const fontPromise =
      doc.fonts && doc.fonts.ready ? doc.fonts.ready.catch(() => undefined) : Promise.resolve();

    Promise.all([fontPromise, ...imgPromises]).then(() => {
      setTimeout(triggerPrint, 280);
    });
  };

  if (doc.readyState === 'complete') {
    waitForAssets();
  } else {
    iframe.onload = waitForAssets;
  }
}

/**
 * Normalizes Persian and Arabic text for reliable, case-insensitive, character-agnostic searching.
 * Standardizes Arabic 'ك' and 'ي/ى' to Persian 'ک' and 'ی'.
 * Converts all numbers (Persian/Arabic) to English digits.
 * Replaces Zero-Width Non-Joiner (نیم‌فاصله) with a space and collapses multiple spaces.
 */
export function normalizePersianString(str: any): string {
  if (str === undefined || str === null) return '';
  let normalized = str.toString().toLowerCase();

  // Convert Persian & Arabic numbers to English numbers
  normalized = toEnglishDigits(normalized);

  // Convert Arabic letters to Persian equivalents
  normalized = normalized
    .replace(/[\u064A\u0649]/g, '\u06CC') // ي and ى -> ی
    .replace(/\u0643/g, '\u06A9')       // ك -> ک
    .replace(/\u200C/g, ' ')            // ZWNJ to space for comparison compatibility
    .replace(/\s+/g, ' ')               // Collapse multiple spaces
    .trim();

  return normalized;
}

/**
 * Checks if search query is contained within a target text after normalizing both strings.
 */
export function matchPersianString(text: any, query: any): boolean {
  if (query === undefined || query === null || query === '') return true;
  const normalizedText = normalizePersianString(text);
  const normalizedQuery = normalizePersianString(query);
  return normalizedText.includes(normalizedQuery);
}

/**
 * Validates Iranian National ID (10 digits with checksum validation)
 */
export function isValidNationalId(code: string | undefined | null): boolean {
  if (!code) return false;
  const clean = toEnglishDigits(code).replace(/\D/g, '');
  if (clean.length !== 10) return false;
  if (/^(\d)\1+$/.test(clean)) return false; // Reject sequences like 1111111111
  
  const check = parseInt(clean[9], 10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean[i], 10) * (10 - i);
  }
  const r = sum % 11;
  return (r < 2 && check === r) || (r >= 2 && check === 11 - r);
}

/**
 * Validates Iranian Postal Code (exactly 10 digits)
 */
export function isValidPostalCode(code: string | undefined | null): boolean {
  if (!code) return false;
  const clean = toEnglishDigits(code).replace(/\D/g, '');
  return clean.length === 10;
}

/**
 * Validates Iranian Mobile Numbers (starts with 09, 989 or 9 followed by 9 digits)
 */
export function isValidMobile(num: string | undefined | null): boolean {
  if (!num) return false;
  const clean = toEnglishDigits(num).replace(/\D/g, '');
  return /^09\d{9}$/.test(clean) || /^989\d{9}$/.test(clean) || /^9\d{9}$/.test(clean);
}

/**
 * Normalizes Jalali date string to standard YYYY/MM/DD with 2-digit month & day
 */
export function normalizeJalaliDate(d: string | undefined | null): string {
  if (!d) return '';
  const cleaned = toEnglishDigits(String(d))
    .replace(/[\u200B-\u200F\u202A-\u202E\u00A0\uFEFF]/g, '')
    .trim();
  if (!cleaned) return '';

  if (/^\d{8}$/.test(cleaned)) {
    const y4 = parseInt(cleaned.substring(0, 4), 10);
    if (y4 >= 1300 && y4 <= 1599) {
      return `${cleaned.substring(0, 4)}/${cleaned.substring(4, 6)}/${cleaned.substring(6, 8)}`;
    }
  }

  const eng = cleaned.replace(/[-_.]+/g, '/').replace(/\/+/g, '/');
  const parts = eng.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    const n0 = parseInt(parts[0], 10);
    const n1 = parseInt(parts[1], 10);
    const n2 = parseInt(parts[2], 10);
    if (!isNaN(n0) && !isNaN(n1) && !isNaN(n2)) {
      if ((parts[0].length === 4 || n0 >= 1300) && n1 >= 1 && n1 <= 12 && n2 >= 1 && n2 <= 31) {
        return `${n0}/${String(n1).padStart(2, '0')}/${String(n2).padStart(2, '0')}`;
      }
      if ((parts[2].length === 4 || n2 >= 1300) && n1 >= 1 && n1 <= 12 && n0 >= 1 && n0 <= 31) {
        return `${n2}/${String(n1).padStart(2, '0')}/${String(n0).padStart(2, '0')}`;
      }
    }
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
  return eng;
}

/**
 * Converts a Jalali date string (YYYY/MM/DD) to an integer day count from year 0 for exact comparison
 */
export function jalaliToDayNumber(jalaliStr: string): number {
  const norm = normalizeJalaliDate(jalaliStr);
  const parts = norm.split('/').map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return 0;
  }
  const [y, m, d] = parts;
  let days = y * 365 + Math.floor(y / 4);
  const j_days_in_month = [0, 31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  for (let i = 1; i < m && i <= 12; i++) {
    days += j_days_in_month[i];
  }
  days += d;
  return days;
}

/**
 * Returns difference in days between targetDate and baseDate (targetDate - baseDate).
 * If baseDate is omitted, current today's Jalali date is used.
 * Result > 0 : future date (e.g. 5 days remaining)
 * Result = 0 : today
 * Result < 0 : past/overdue date (e.g. -3 days overdue)
 */
export function getJalaliDaysDifference(targetDate: string, baseDate?: string): number {
  const base = baseDate ? normalizeJalaliDate(baseDate) : getTodayJalali();
  const target = normalizeJalaliDate(targetDate);
  const targetDays = jalaliToDayNumber(target);
  const baseDays = jalaliToDayNumber(base);
  if (!targetDays || !baseDays) return 0;
  return targetDays - baseDays;
}

/**
 * Calculates a relative Jalali date by adding/subtracting N days to/from today
 */
export function getRelativeJalaliDate(offsetDays: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  
  const gy = now.getFullYear();
  const gm = now.getMonth() + 1;
  const gd = now.getDate();

  const g_days_in_month = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const j_days_in_month = [0, 31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];

  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let g_day_no = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400);

  for (let i = 1; i < gm; ++i) g_day_no += g_days_in_month[i];
  g_day_no += gd;

  let j_day_no = g_day_no - 719527;
  let j_np = Math.floor(j_day_no / 12053);
  j_day_no %= 12053;

  let jy = 979 + 33 * j_np + 4 * Math.floor(j_day_no / 1461);
  j_day_no %= 1461;

  if (j_day_no >= 366) {
    jy += Math.floor((j_day_no - 1) / 365);
    j_day_no = (j_day_no - 1) % 365;
  }

  let jm = 1;
  for (let i = 1; i <= 12; ++i) {
    if (j_day_no < j_days_in_month[i]) {
      jm = i;
      break;
    }
    j_day_no -= j_days_in_month[i];
  }
  let jd = j_day_no + 1;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/**
 * Converts numbers to Persian words (عدد به حروف فارسی)
 * Handles negative numbers and values up to trillions
 */
export function numberToWordsPersian(num: number | string | undefined | null): string {
  if (num === undefined || num === null || num === '') return 'صفر';
  const val = typeof num === 'number' ? num : parseNumber(num);
  if (isNaN(val) || val === 0) return 'صفر';

  const isNegative = val < 0;
  const absVal = Math.floor(Math.abs(val));

  const yekan = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const dahha = ['', 'ده', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const dahYek = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const sadha = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  const scales = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

  function threeDigitsToWords(n: number): string {
    const s = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const y = n % 10;
    const parts: string[] = [];

    if (s > 0) parts.push(sadha[s]);
    if (d === 1) {
      parts.push(dahYek[y]);
    } else {
      if (d > 1) parts.push(dahha[d]);
      if (y > 0) parts.push(yekan[y]);
    }
    return parts.join(' و ');
  }

  const chunks: number[] = [];
  let temp = absVal;
  while (temp > 0) {
    chunks.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const wordChunks: string[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    if (chunk > 0) {
      const chunkWord = threeDigitsToWords(chunk);
      const scale = scales[i];
      wordChunks.push(scale ? `${chunkWord} ${scale}` : chunkWord);
    }
  }

  const result = wordChunks.join(' و ');
  return isNegative ? `منفی ${result}` : result;
}

/**
 * Validates whether a given string is a valid Jalali date (YYYY/MM/DD)
 */
export function isValidJalaliDate(dateStr: string | undefined | null): boolean {
  if (!dateStr) return false;
  const norm = normalizeJalaliDate(dateStr);
  const parts = norm.split('/').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const [y, m, d] = parts;
  if (y < 1300 || y > 1500) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1) return false;
  if (m <= 6 && d > 31) return false;
  if (m >= 7 && m <= 11 && d > 30) return false;
  if (m === 12 && d > 30) return false;
  return true;
}

/**
 * Converts a Gregorian Date or ISO string into accurate standard Jalali date (YYYY/MM/DD)
 */
export function gregorianToJalali(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return getTodayJalali();
    const formatter = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      calendar: 'persian'
    });
    const parts = formatter.formatToParts(d);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
    }
  } catch (e) {
    // fallback to today
  }
  return getTodayJalali();
}

/**
 * Checks if a given Jalali date is within [fromDate, toDate] inclusive
 */
export function isJalaliDateInRange(dateStr: string, fromDate?: string, toDate?: string): boolean {
  if (!dateStr) return false;
  const current = normalizeJalaliDate(dateStr);
  const from = fromDate ? normalizeJalaliDate(fromDate) : '';
  const to = toDate ? normalizeJalaliDate(toDate) : '';

  if (from && current < from) return false;
  if (to && current > to) return false;
  return true;
}

/**
 * Determines and extracts the 4-digit fiscal year from a Period object or activePeriodId.
 * Prioritizes:
 * 1. period.startDate (e.g. "1405/01/01" -> 1405)
 * 2. period.id (e.g. "1405-01" or "1404" -> 1405)
 * 3. period.name (e.g. "دوره فروردین ۱۴۰۵" -> 1405)
 * 4. activePeriodId string
 * 5. Jalali year from today or fallback 1405
 */
export function getFiscalYearFromPeriod(period?: { id?: string; name?: string; startDate?: string } | null, activePeriodId?: string): number {
  if (period?.startDate) {
    const engDate = toEnglishDigits(period.startDate);
    const match = engDate.match(/1[34]\d{2}/);
    if (match) return parseInt(match[0], 10);
  }

  const idToCheck = period?.id || activePeriodId;
  if (idToCheck) {
    const engId = toEnglishDigits(idToCheck);
    const match = engId.match(/1[34]\d{2}/);
    if (match) return parseInt(match[0], 10);
  }

  if (period?.name) {
    const engName = toEnglishDigits(period.name);
    const match = engName.match(/1[34]\d{2}/);
    if (match) return parseInt(match[0], 10);
  }

  if (activePeriodId) {
    const engId = toEnglishDigits(activePeriodId);
    const match = engId.match(/1[34]\d{2}/);
    if (match) return parseInt(match[0], 10);
  }

  try {
    const today = getTodayJalali();
    const matchToday = toEnglishDigits(today).match(/1[34]\d{2}/);
    if (matchToday) return parseInt(matchToday[0], 10);
  } catch (e) {
    // fallback
  }

  return 1405;
}

/**
 * Extracts year and month from a Shamsi date string like '1405/04/15', '۱۴۰۵/۰۴/۱۵', '15/04/1405', or '14050415'
 */
export function parseShamsiYearMonth(dateStr?: string | null): { year: number; month: number } | null {
  if (!dateStr) return null;
  const eng = toEnglishDigits(String(dateStr)).replace(/[\u200B-\u200F\u202A-\u202E\u00A0\uFEFF]/g, '').trim();
  if (!eng) return null;

  // Compact 8-digit format e.g. '14050415'
  if (/^\d{8}$/.test(eng)) {
    const y = parseInt(eng.substring(0, 4), 10);
    const m = parseInt(eng.substring(4, 6), 10);
    if (!isNaN(y) && !isNaN(m) && y > 1300 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }

  const parts = eng.split(/[\/\-\.]+/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;

    // Standard YYYY/MM/DD or YYYY/MM
    if (!isNaN(p0) && !isNaN(p1) && p0 > 1300 && p1 >= 1 && p1 <= 12) {
      return { year: p0, month: p1 };
    }
    // Reversed DD/MM/YYYY
    if (!isNaN(p2) && !isNaN(p1) && p2 > 1300 && p1 >= 1 && p1 <= 12) {
      return { year: p2, month: p1 };
    }
  }
  return null;
}

/**
 * Resolves the effective last-working `(year, month)` from a departure date.
 * Because departure date is stored 1 day after the last attendance date,
 * a departure date on day `01` (e.g., `1404/08/01` after working through `1404/07/30`)
 * has its last active workday in the preceding month (`1404/07`), while days `>= 2`
 * stay in the same `(year, month)`.
 */
export function parseEffectiveDepartureLastWorkYM(
  departureDate?: string | null
): { year: number; month: number } | null {
  if (!departureDate) return null;
  const eng = toEnglishDigits(String(departureDate)).replace(/[\u200B-\u200F\u202A-\u202E\u00A0\uFEFF]/g, '').trim();
  if (!eng) return null;

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  if (/^\d{8}$/.test(eng)) {
    year = parseInt(eng.substring(0, 4), 10);
    month = parseInt(eng.substring(4, 6), 10);
    day = parseInt(eng.substring(6, 8), 10);
  } else {
    const parts = eng.split(/[\/\-\.]+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      const p2 = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
      if (!isNaN(p0) && !isNaN(p1) && p0 > 1300 && p1 >= 1 && p1 <= 12) {
        year = p0;
        month = p1;
        if (!isNaN(p2) && p2 >= 1 && p2 <= 31) day = p2;
      } else if (!isNaN(p2) && !isNaN(p1) && p2 > 1300 && p1 >= 1 && p1 <= 12) {
        year = p2;
        month = p1;
        if (!isNaN(p0) && p0 >= 1 && p0 <= 31) day = p0;
      }
    }
  }

  if (year === null || month === null || isNaN(year) || isNaN(month)) return null;
  if (day === 1) {
    return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  }
  return { year, month };
}

/**
 * Checks whether an employee has departed before the target month starts,
 * meaning the target month is strictly AFTER the employee's last active workday month.
 * E.g., if last attendance was 1404/07/30 and departureDate is 1404/08/01:
 *  - Month 7: returns false (last active month)
 *  - Month 8+: returns true (already departed on 08/01)
 */
export function isEmployeeDepartedInMonth(departureDate: string | undefined | null, targetYear: number, targetMonth: number): boolean {
  if (!departureDate || !String(departureDate).trim()) return false;
  const parsed = parseEffectiveDepartureLastWorkYM(departureDate);
  if (!parsed) return false;
  
  if (targetYear > parsed.year) return true;
  if (targetYear === parsed.year && targetMonth > parsed.month) return true;
  return false;
}

/**
 * Determines if an employee should appear in monthly circulation (payroll calculation, attendance list)
 * for the given year and month.
 * - Always returns true if hasHistoricalRecord is true (never deletes past calculations).
 * - If departureDate is set and target month is after departure month: returns false.
 * - If departureDate is set and target month is <= departure month: returns true (employee was active in that month).
 * - Otherwise checks standard isActive flag.
 */
export function isEmployeeEligibleForMonth(
  emp: { isActive?: boolean; entryDate?: string; departureDate?: string; employeeCode?: string; personnel?: any },
  targetYear: number,
  targetMonth: number,
  hasHistoricalRecord: boolean = false
): boolean {
  // 1. Check work start date (تاریخ ورود به کار):
  // If present and valid, exclude employee in months strictly BEFORE their start month/year.
  // If absent/empty, show the employee.
  const rawEntry = emp.entryDate || emp.personnel?.entryDate;
  if (rawEntry && String(rawEntry).trim()) {
    const parsedEntry = parseShamsiYearMonth(rawEntry);
    if (parsedEntry) {
      if (targetYear < parsedEntry.year || (targetYear === parsedEntry.year && targetMonth < parsedEntry.month)) {
        return false;
      }
    }
  }

  // 2. Check work departure date (تاریخ ترک کار):
  // Include in the month of departure and earlier months; exclude in months strictly AFTER departure month.
  const rawDeparture = emp.departureDate || emp.personnel?.departureDate;
  if (rawDeparture && String(rawDeparture).trim()) {
    if (isEmployeeDepartedInMonth(rawDeparture, targetYear, targetMonth)) {
      return false;
    }
    return true;
  }

  // 3. Preserve historical records for employees eligible by date
  if (hasHistoricalRecord) return true;

  // 4. Standard active flag check when no departure date is set
  return emp.isActive !== false;
}

/**
 * Extracts default fiscal year and start month (1-12) from a Period or periodId string.
 */
export function getDefaultYearMonthFromPeriod(
  period?: { id?: string; name?: string; startDate?: string } | null,
  activePeriodId?: string
): { year: number; month: number } {
  const year = getFiscalYearFromPeriod(period, activePeriodId);
  let month = 1;

  const pid = period?.id || activePeriodId || '';
  const pidParts = toEnglishDigits(pid).split('-');
  if (pidParts.length >= 2) {
    const pm = parseInt(pidParts[1], 10);
    if (!isNaN(pm) && pm >= 1 && pm <= 12) {
      return { year, month: pm };
    }
  }

  if (period?.startDate) {
    const parsed = parseShamsiYearMonth(period.startDate);
    if (parsed) {
      return { year: parsed.year || year, month: parsed.month };
    }
  }

  return { year, month };
}

/**
 * Checks whether a ShiftAssignment belongs to a specific (periodId, year, month).
 * - Date-specific assignments must match the date's year/month (and periodId if present).
 * - Monthly/weekly assignments must match year & month explicitly; legacy untagged records fallback to fallbackYearMonth.
 */
export function isShiftAssignmentInMonth(
  a: { periodId?: string; year?: number; month?: number; date?: string },
  periodId: string,
  targetYear: number,
  targetMonth: number,
  fallbackYearMonth?: { year: number; month: number }
): boolean {
  if (a.periodId && periodId && a.periodId !== periodId) return false;

  if (a.date && String(a.date).trim()) {
    const parsed = parseShamsiYearMonth(a.date);
    if (parsed) {
      return parsed.year === Number(targetYear) && parsed.month === Number(targetMonth);
    }
  }

  if (a.year !== undefined && a.month !== undefined) {
    return Number(a.year) === Number(targetYear) && Number(a.month) === Number(targetMonth);
  }

  if (fallbackYearMonth) {
    return Number(targetYear) === Number(fallbackYearMonth.year) && Number(targetMonth) === Number(fallbackYearMonth.month);
  }

  return false;
}

/**
 * Normalizes an accounting code (کد حسابداری محصول / کد معین حسابداری مواد اولیه)
 * by converting Persian/Arabic digits to English and trimming whitespace.
 */
export function normalizeAccountingCode(val: any): string {
  if (val === undefined || val === null) return '';
  return toEnglishDigits(String(val)).trim();
}

/**
 * Returns canonical formula key for a Product: prefers کد حسابداری (accountId), falling back to id if empty.
 */
export function getProductFormulaKey(prod?: { id?: string; accountId?: string } | null): string {
  if (!prod) return '';
  const acc = normalizeAccountingCode(prod.accountId);
  if (acc) return acc;
  return String(prod.id || '').trim();
}

/**
 * Returns canonical formula key for a raw material Item or WIP Product:
 * prefers کد معین حسابداری (accountId), falling back to id if empty.
 */
export function getMaterialFormulaKey(mat?: { id?: string; accountId?: string } | null): string {
  if (!mat) return '';
  const acc = normalizeAccountingCode(mat.accountId);
  if (acc) return acc;
  return String(mat.id || '').trim();
}

/**
 * Checks if a ProductFormula.productId matches a given Product
 * (matches by کد حسابداری accountId first, or legacy internal id fallback).
 */
export function doesFormulaMatchProduct(
  formulaProductId: string | undefined | null,
  product?: { id?: string; accountId?: string } | null
): boolean {
  if (!formulaProductId || !product) return false;
  const rawKey = String(formulaProductId).trim();
  const normKey = normalizeAccountingCode(rawKey);
  if (!normKey) return false;

  const pAcc = normalizeAccountingCode(product.accountId);
  if (pAcc && normKey === pAcc) return true;

  if (product.id && (rawKey === String(product.id).trim() || normKey === normalizeAccountingCode(product.id))) {
    return true;
  }
  return false;
}

/**
 * Checks if a ProductFormulaItem.rawMaterialId matches a given raw Item or WIP Product
 * (matches by کد معین حسابداری accountId first, or legacy internal id fallback).
 */
export function doesIngredientMatchMaterial(
  ingRawMaterialId: string | undefined | null,
  mat?: { id?: string; accountId?: string } | null
): boolean {
  if (!ingRawMaterialId || !mat) return false;
  const rawKey = String(ingRawMaterialId).trim();
  const normKey = normalizeAccountingCode(rawKey);
  if (!normKey) return false;

  const mAcc = normalizeAccountingCode(mat.accountId);
  if (mAcc && normKey === mAcc) return true;

  if (mat.id && (rawKey === String(mat.id).trim() || normKey === normalizeAccountingCode(mat.id))) {
    return true;
  }
  return false;
}

