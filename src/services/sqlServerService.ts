/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * سرویس یکپارچه‌سازی و همگام‌سازی با پایگاه داده Microsoft SQL Server سیستم فروشگاه
 * این ماژول ارتباط امن بین سامانه وب و سرور محلی فروشگاه (REST API / SQL Server) را برقرار می‌کند.
 */

import { AppDatabase } from '../types';

export interface SqlServerSyncResult {
  success: boolean;
  message: string;
  timestamp?: string;
  details?: any;
}

/**
 * تست برقراری اتصال با سرور محلی فروشگاه
 */
export async function testSqlServerConnection(serverUrl: string, apiKey?: string): Promise<SqlServerSyncResult> {
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  const targetUrl = `${cleanUrl}/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['X-API-KEY'] = apiKey;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: true,
        message: 'اتصال به سرویس پایگاه داده SQL Server فروشگاه با موفقیت برقرار شد.',
        timestamp: new Date().toISOString(),
        details: data
      };
    } else {
      return {
        success: false,
        message: `پاسخ ناموفق از سرور فروشگاه: کد وضعیت ${response.status} (${response.statusText})`
      };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'مهلت زمانی اتصال به سرور فروشگاه به پایان رسید (Timeout). لطفاً از روشن بودن سرور و درستی آدرس IP اطمینان حاصل کنید.'
      };
    }
    return {
      success: false,
      message: `خطا در برقراری ارتباط با سرور SQL Server: ${error.message || 'شبکه در دسترس نیست'}`
    };
  }
}

/**
 * ارسال و ذخیره کامل پایگاه داده فعلی به SQL Server فروشگاه
 */
export async function pushToSqlServer(serverUrl: string, db: AppDatabase, apiKey?: string): Promise<SqlServerSyncResult> {
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  const targetUrl = `${cleanUrl}/sync/push`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 sec timeout for full sync

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['X-API-KEY'] = apiKey;
    }

    // Clean cycle references or undefined values
    const payload = JSON.stringify({
      database: db,
      exportedAt: new Date().toISOString(),
      source: 'gatan_workshop_web_client'
    });

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        success: true,
        message: 'کلیه داده‌ها با موفقیت در پایگاه داده SQL Server فروشگاه ذخیره گردیدند.',
        timestamp: new Date().toISOString(),
        details: data
      };
    } else {
      return {
        success: false,
        message: `خطای سرور فروشگاه هنگام ذخیره‌سازی: ${response.status} ${response.statusText}`
      };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'ارسال داده‌ها به سرور به دلیل طولانی شدن لغو شد (Timeout).'
      };
    }
    return {
      success: false,
      message: `خطا در ارسال داده به SQL Server: ${error.message || 'سرور در دسترس نیست'}`
    };
  }
}

/**
 * دریافت آخرین وضعیت پایگاه داده از SQL Server فروشگاه
 */
export async function pullFromSqlServer(serverUrl: string, apiKey?: string): Promise<{ success: boolean; data?: AppDatabase; message: string }> {
  const cleanUrl = serverUrl.replace(/\/+$/, '');
  const targetUrl = `${cleanUrl}/sync/pull`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      headers['X-API-KEY'] = apiKey;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      const db = result.database || result;
      if (db && typeof db === 'object') {
        return {
          success: true,
          data: db as AppDatabase,
          message: 'بانک اطلاعاتی با موفقیت از SQL Server فروشگاه دریافت گردید.'
        };
      } else {
        return {
          success: false,
          message: 'قالب داده‌های دریافتی از سرور معتبر نیست.'
        };
      }
    } else {
      return {
        success: false,
        message: `سرور کد خطا بازگرداند: ${response.status} ${response.statusText}`
      };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      message: `عدم موفقیت در دریافت داده از سرور: ${error.message || 'ارتباط با سرور برقرار نشد'}`
    };
  }
}

/**
 * ایجاد اسکریپت کامل T-SQL جهت ساخت جداول در Microsoft SQL Server
 * قابل اجرا در SQL Server Management Studio (SSMS)
 */
export function generateSqlServerDDL(): string {
  return `-- =========================================================================
-- Microsoft SQL Server Database Creation Script for Gatan Workshop & Store
-- سامانه مدیریت کارگاه، فروش، انبار و حقوق و دستمزد گاتان
-- تولید شده به صورت خودکار جهت اجرای مستقیم در SQL Server Management Studio (SSMS)
-- =========================================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'GatanWorkshopDB')
BEGIN
    CREATE DATABASE [GatanWorkshopDB] COLLATE Persian_100_CI_AI;
END
GO

USE [GatanWorkshopDB];
GO

-- 1. جدول دوره‌های مالی (Periods)
IF OBJECT_ID(N'[dbo].[Periods]', N'U') IS NULL
CREATE TABLE [dbo].[Periods] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [Name] NVARCHAR(150) NOT NULL,
    [StartDate] NVARCHAR(30) NULL,
    [EndDate] NVARCHAR(30) NULL,
    [IsActive] BIT NOT NULL DEFAULT 1,
    [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- 2. جدول دسته‌بندی مواد اولیه (ItemCategories)
IF OBJECT_ID(N'[dbo].[ItemCategories]', N'U') IS NULL
CREATE TABLE [dbo].[ItemCategories] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [Name] NVARCHAR(150) NOT NULL
);
GO

-- 3. جدول مواد اولیه و ملزومات (Items)
IF OBJECT_ID(N'[dbo].[Items]', N'U') IS NULL
CREATE TABLE [dbo].[Items] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [AccountId] NVARCHAR(50) NULL,
    [Name] NVARCHAR(250) NOT NULL,
    [CategoryId] NVARCHAR(50) NULL,
    [Unit] NVARCHAR(50) NOT NULL,
    [Barcode] NVARCHAR(100) NULL,
    [PackageType] NVARCHAR(100) NULL,
    [QtyPerPackage] DECIMAL(18, 4) NOT NULL DEFAULT 1,
    [WeightPerPackage] DECIMAL(18, 4) NOT NULL DEFAULT 1,
    [ReorderThreshold] DECIMAL(18, 4) NOT NULL DEFAULT 0,
    [Price] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [IsActive] BIT NOT NULL DEFAULT 1
);
GO

-- 4. جدول محصولات و کالاها (Products)
IF OBJECT_ID(N'[dbo].[Products]', N'U') IS NULL
CREATE TABLE [dbo].[Products] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [AccountId] NVARCHAR(50) NULL,
    [Name] NVARCHAR(250) NOT NULL,
    [CategoryId] NVARCHAR(50) NULL,
    [Unit] NVARCHAR(50) NOT NULL,
    [Barcode] NVARCHAR(100) NULL,
    [PackageType] NVARCHAR(100) NULL,
    [QtyPerPackage] DECIMAL(18, 4) NOT NULL DEFAULT 1,
    [WeightPerPackage] DECIMAL(18, 4) NOT NULL DEFAULT 1,
    [SalePrice] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [CogsPrice] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [Weight] DECIMAL(18, 4) NOT NULL DEFAULT 0
);
GO

-- 5. جدول تأمین‌کنندگان (Suppliers)
IF OBJECT_ID(N'[dbo].[Suppliers]', N'U') IS NULL
CREATE TABLE [dbo].[Suppliers] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [Name] NVARCHAR(200) NOT NULL,
    [Code] NVARCHAR(50) NULL,
    [ContactPerson] NVARCHAR(150) NULL,
    [Phone] NVARCHAR(50) NULL,
    [Address] NVARCHAR(500) NULL,
    [Notes] NVARCHAR(MAX) NULL
);
GO

-- 6. جدول پرسنل کارگاه (Personnel)
IF OBJECT_ID(N'[dbo].[Personnel]', N'U') IS NULL
CREATE TABLE [dbo].[Personnel] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [EmployeeCode] NVARCHAR(50) NOT NULL,
    [AccountCode] NVARCHAR(50) NULL,
    [AttendanceCode] NVARCHAR(50) NULL, -- کد تردد دستگاه حضور و غیاب
    [FirstName] NVARCHAR(100) NULL,
    [LastName] NVARCHAR(100) NULL,
    [FullName] NVARCHAR(200) NOT NULL,
    [NationalId] NVARCHAR(20) NULL,
    [Mobile] NVARCHAR(30) NULL,
    [EmergencyMobile] NVARCHAR(30) NULL,
    [Role] NVARCHAR(100) NULL,
    [IsActive] BIT NOT NULL DEFAULT 1,
    [IsMarried] BIT NOT NULL DEFAULT 0,
    [ChildrenCount] INT NOT NULL DEFAULT 0,
    [BaseSalary] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [BaseSalaryInsurance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [InsuranceCode] NVARCHAR(50) NULL,
    [InsuranceHistory] NVARCHAR(50) NULL,
    [InsuranceHistoryDays] INT NOT NULL DEFAULT 0,
    [PersonnelCategoryId] NVARCHAR(50) NULL,
    [Gender] NVARCHAR(20) NULL,
    [MaritalStatus] NVARCHAR(20) NULL,
    [FatherName] NVARCHAR(100) NULL,
    [BirthDate] NVARCHAR(30) NULL,
    [BirthPlace] NVARCHAR(100) NULL,
    [PostalCode] NVARCHAR(30) NULL,
    [Address] NVARCHAR(500) NULL,
    [MilitaryStatus] NVARCHAR(50) NULL,
    [AttractionAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [JobAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [HasInsurance] BIT NOT NULL DEFAULT 1,
    [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

CREATE NONCLUSTERED INDEX [IX_Personnel_AttendanceCode] ON [dbo].[Personnel]([AttendanceCode]);
CREATE NONCLUSTERED INDEX [IX_Personnel_EmployeeCode] ON [dbo].[Personnel]([EmployeeCode]);
GO

-- 7. جدول دوره‌های حقوق و دستمزد (PayrollPeriods)
IF OBJECT_ID(N'[dbo].[PayrollPeriods]', N'U') IS NULL
CREATE TABLE [dbo].[PayrollPeriods] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [Title] NVARCHAR(200) NOT NULL,
    [Year] INT NOT NULL,
    [Month] INT NOT NULL,
    [DaysInMonth] INT NOT NULL DEFAULT 30,
    [WorkingDays] INT NOT NULL DEFAULT 24,
    [FridayCount] INT NOT NULL DEFAULT 4,
    [HolidayCount] INT NOT NULL DEFAULT 2,
    [TotalRequiredHours] DECIMAL(18, 2) NOT NULL DEFAULT 176,
    [IsClosed] BIT NOT NULL DEFAULT 0,
    [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- 8. جدول اقلام و کارکرد حقوق و دستمزد پرسنل (PayrollItems)
IF OBJECT_ID(N'[dbo].[PayrollItems]', N'U') IS NULL
CREATE TABLE [dbo].[PayrollItems] (
    [Id] NVARCHAR(50) NOT NULL PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [EmployeeId] NVARCHAR(50) NOT NULL,
    [EmployeeCode] NVARCHAR(50) NOT NULL,
    [AttendanceCode] NVARCHAR(50) NULL,
    [FullName] NVARCHAR(200) NULL,
    [Role] NVARCHAR(100) NULL,
    [WorkedDays] INT NOT NULL DEFAULT 0,
    [WorkedHours] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [OvertimeHours] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [HolidayHours] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [NightHours] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [AbsenceDays] INT NOT NULL DEFAULT 0,
    [AbsenceHours] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [PaidLeaveDays] INT NOT NULL DEFAULT 0,
    [DailyRate] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [MonthlyBaseRate] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [HousingAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [GroceryAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [ChildAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [MarriageAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [AttractionAllowance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [GrossSalary] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [InsurableSalary] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [TaxableSalary] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [WorkerInsurance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [EmployerInsurance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [UnemploymentInsurance] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [TaxAmount] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [NetPayable] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [TotalEmployerCost] DECIMAL(18, 2) NOT NULL DEFAULT 0,
    [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- 9. جدول لاگ تردد و حضور و غیاب خام دستگاه (AttendanceLogs)
IF OBJECT_ID(N'[dbo].[AttendanceLogs]', N'U') IS NULL
CREATE TABLE [dbo].[AttendanceLogs] (
    [Id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [PeriodId] NVARCHAR(50) NOT NULL,
    [AttendanceCode] NVARCHAR(50) NOT NULL,
    [EmployeeId] NVARCHAR(50) NULL,
    [Date] NVARCHAR(20) NOT NULL,
    [Time] NVARCHAR(20) NOT NULL,
    [Type] NVARCHAR(30) NULL, -- ورود، خروج، مأموریت
    [DeviceId] NVARCHAR(50) NULL,
    [RawRecord] NVARCHAR(MAX) NULL,
    [CreatedAt] DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

-- 10. جدول همگام‌سازی و لاگ‌های دیتابیس (SyncLogs)
IF OBJECT_ID(N'[dbo].[SyncLogs]', N'U') IS NULL
CREATE TABLE [dbo].[SyncLogs] (
    [Id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [SyncTime] DATETIME2 NOT NULL DEFAULT GETDATE(),
    [Direction] NVARCHAR(20) NOT NULL, -- PUSH / PULL
    [Status] NVARCHAR(20) NOT NULL,
    [ClientIp] NVARCHAR(50) NULL,
    [RecordsCount] INT NULL,
    [Message] NVARCHAR(MAX) NULL
);
GO

PRINT N'پایگاه داده GatanWorkshopDB و جداول اصلی Microsoft SQL Server با موفقیت ایجاد گردیدند.';
GO
`;
}

/**
 * دانلود مستقیم اسکریپت SQL Server جهت اجرا در SSMS
 */
export function downloadSqlServerDDLScript() {
  const ddl = generateSqlServerDDL();
  const blob = new Blob([ddl], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Gatan_SQL_Server_Schema_${new Date().toISOString().slice(0, 10)}.sql`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
