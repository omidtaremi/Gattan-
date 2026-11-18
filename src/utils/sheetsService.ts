import { AppDatabase, Period, Item, Supplier, Product, ProductSale, Personnel, PeriodOverhead } from '../types';

interface SheetData {
  range: string;
  values: any[][];
}

export async function createGoogleSpreadsheet(accessToken: string, title: string = 'سامانه جامع گاتان'): Promise<string> {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets';
  const body = {
    properties: {
      title,
    },
    sheets: [
      { properties: { title: 'Periods' } },
      { properties: { title: 'Items' } },
      { properties: { title: 'Suppliers' } },
      { properties: { title: 'Products' } },
      { properties: { title: 'Sales' } },
      { properties: { title: 'Personnel' } },
      { properties: { title: 'Overheads' } },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create Google Spreadsheet: ${errorText}`);
  }

  const data = await response.json();
  return data.spreadsheetId;
}

export async function pushDatabaseToGoogleSheets(
  accessToken: string,
  spreadsheetId: string,
  db: AppDatabase
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;

  // 1. Periods values
  const periodsData: any[][] = [['PERIOD_ID', 'NAME', 'IS_ACTIVE', 'CREATED_AT']];
  db.periods.forEach(p => {
    periodsData.push([p.id, p.name, String(p.isActive), p.createdAt]);
  });

  // 2. Items values
  const itemsData: any[][] = [
    ['ITEM_ID', 'PERIOD_ID', 'CODE', 'ACCOUNT_ID', 'NAME', 'CATEGORY_ID', 'UNIT', 'BARCODE', 'PACKAGE_TYPE', 'QTY_PER_PACK', 'WEIGHT_PER_PACK', 'ALERT_THRESHOLD', 'BUY_PRICE', 'IS_ACTIVE']
  ];
  db.items.forEach(i => {
    itemsData.push([
      i.id, i.periodId, i.code || '', i.accountId || '', i.name, i.categoryId, 
      i.unit, i.barcode || '', i.packageType, i.qtyPerPackage, i.weightPerPackage, i.reorderThreshold, i.price, String(i.isActive)
    ]);
  });

  // 3. Suppliers values
  const suppliersData: any[][] = [
    ['SUPPLIER_ID', 'PERIOD_ID', 'NAME', 'PHONE', 'ADDRESS', 'IS_ACTIVE', 'ACCOUNTS_JSON', 'SUPPLIED_ITEMS_CSV']
  ];
  db.suppliers.forEach(s => {
    suppliersData.push([
      s.id, s.periodId, s.name, s.phone || '', s.address || '', String(s.isActive), 
      JSON.stringify(s.bankAccounts || []), (s.suppliedItemIds || []).join(';')
    ]);
  });

  // 4. Products values
  const productsData: any[][] = [
    ['PRODUCT_ID', 'PERIOD_ID', 'CODE', 'ACCOUNT_ID', 'NAME', 'CATEGORY_ID', 'UNIT', 'BARCODE', 'PACKAGE_TYPE', 'QTY_PER_PACK', 'WEIGHT_PER_PACK', 'SALE_PRICE', 'COGS_PRICE']
  ];
  db.products.forEach(p => {
    productsData.push([
      p.id, p.periodId, p.code || '', p.accountId || '', p.name, p.categoryId, 
      p.unit, p.barcode || '', p.packageType, p.qtyPerPackage, p.weightPerPackage, p.salePrice, p.cogsPrice
    ]);
  });

  // 5. Sales values
  const salesData: any[][] = [
    ['SALE_ID', 'SALES_PERIOD_ID', 'PERIOD_ID', 'PRODUCT_ID', 'QTY_SOLD', 'DISCOUNT', 'PRE_DIS_AMOUNT', 'NET_SALES_AMOUNT']
  ];
  db.productSales.forEach(s => {
    salesData.push([
      s.id, s.salesPeriodId, s.periodId, s.productId, s.qtySold, s.discount, s.preDiscountAmount, s.netSalesAmount
    ]);
  });

  // 6. Personnel values
  const personnelData: any[][] = [
    [
      'EMPLOYEE_CODE', 'PERIOD_ID', 'ACCOUNT_CODE', 'FIRST_NAME', 'LAST_NAME', 'NATIONAL_ID', 'INSURANCE_CODE',
      'FATHER_NAME', 'BIRTH_DATE', 'BIRTH_PLACE', 'CENTER', 'PROJECT', 'COMP_INSURANCE', 'YEARS_BASE',
      'ENTRY_DATE', 'INSURANCE_DATE', 'DAILY_YEARS_DIFF', 'BANK_NAME', 'BANK_ACCOUNT', 'SHABA', 'CARD_NO',
      'HAS_INSURANCE', 'EMPLOYER_PREM_3', 'EMPLOYER_PREM_20', 'WORKER_PREM_7', 'ATTRACT_AL', 'BASE_SAL_INS',
      'DAILY_WAGE', 'IS_DAILY_WAGE', 'TAX_SHARE', 'CHILDREN_COUNT', 'IS_MARRIED', 'FIXED_ALLOWANCES', 'IS_ACTIVE'
    ]
  ];
  db.personnel.forEach(emp => {
    personnelData.push([
      emp.employeeCode || '', emp.periodId || '', emp.accountCode || '', emp.firstName || '', emp.lastName || '',
      emp.nationalId || '', emp.insuranceCode || '', emp.fatherName || '', emp.birthDate || '', emp.birthPlace || '',
      emp.center || '', emp.project || '', String(emp.complementaryInsurance || false), emp.yearsBase || 0,
      emp.entryDate || '', emp.insuranceDate || '', emp.dailyYearsDifference || 0, emp.bankName || '',
      emp.bankAccount || '', emp.shaba || '', emp.cardNo || '', String(emp.hasInsurance || false),
      emp.employerPremium3 || 0, emp.employerPremium || 0, emp.workerPremium || 0, emp.attractionAllowance || 0,
      emp.baseSalaryInsurance || 0, emp.dailyWage || 0, String(emp.isDailyWage || false), emp.taxShare || 0,
      emp.childrenCount || 0, String(emp.isMarried || false), emp.fixedAllowances || 0, String(emp.isActive !== false)
    ]);
  });

  // 7. Overheads values
  const overheadsData: any[][] = [
    ['OVERHEAD_ID', 'PERIOD_ID', 'OPERATIONAL', 'DISTRIBUTION_SALES', 'FINANCIAL', 'ADMINISTRATIVE', 'RETURNS_OF_EXPENSE']
  ];
  db.periodOverheads.forEach(oh => {
    overheadsData.push([
      oh.id, oh.periodId, oh.operational, oh.distributionSales, oh.financial, oh.administrative, oh.returnsOfExpense
    ]);
  });

  const body = {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: 'Periods!A1:D1000', values: periodsData },
      { range: 'Items!A1:N5000', values: itemsData },
      { range: 'Suppliers!A1:H1000', values: suppliersData },
      { range: 'Products!A1:M2000', values: productsData },
      { range: 'Sales!A1:H5000', values: salesData },
      { range: 'Personnel!A1:AH2000', values: personnelData },
      { range: 'Overheads!A1:G1000', values: overheadsData },
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to push values to Google Sheets: ${errorText}`);
  }
}

export async function pullDatabaseFromGoogleSheets(
  accessToken: string,
  spreadsheetId: string,
  currentDb: AppDatabase
): Promise<AppDatabase> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=Periods!A1:D1000&ranges=Items!A1:N5000&ranges=Suppliers!A1:H1000&ranges=Products!A1:M2000&ranges=Sales!A1:H5000&ranges=Personnel!A1:AH2000&ranges=Overheads!A1:G1000`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to pull data from Google Sheets: ${errorText}`);
  }

  const result = await response.json();
  const valueRanges = result.valueRanges || [];

  const tempDb: AppDatabase = { ...currentDb };

  // Parse Ranges
  valueRanges.forEach((rangeObj: any) => {
    const rangeName = rangeObj.range || '';
    const values: any[][] = rangeObj.values || [];
    if (values.length <= 1) return; // Only header or empty

    const headers = values[0];
    const rows = values.slice(1);

    if (rangeName.includes('Periods')) {
      const parsedPeriods: Period[] = rows.map(row => ({
        id: row[0],
        name: row[1],
        isActive: row[2] === 'true',
        createdAt: row[3] || new Date().toISOString()
      }));
      if (parsedPeriods.length > 0) tempDb.periods = parsedPeriods;
    } 
    else if (rangeName.includes('Items')) {
      const parsedItems: Item[] = rows.map(row => ({
        id: row[0],
        periodId: row[1],
        code: row[2] || '',
        accountId: row[3] || '',
        name: row[4],
        categoryId: row[5],
        unit: row[6]?.trim() === 'عددی' ? 'عددی' : 'کیلویی',
        barcode: row[7] || '',
        packageType: (row[8] || 'کارتن') as any,
        qtyPerPackage: parseFloat(row[9]) || 1,
        weightPerPackage: parseFloat(row[10]) || 1,
        reorderThreshold: parseFloat(row[11]) || 0,
        price: parseFloat(row[12]) || 0,
        isActive: row[13] !== 'false'
      }));
      if (parsedItems.length > 0) tempDb.items = parsedItems;
    } 
    else if (rangeName.includes('Suppliers')) {
      const parsedSuppliers: Supplier[] = rows.map(row => {
        let bankAccounts = [];
        try {
          bankAccounts = JSON.parse(row[6] || '[]');
        } catch {
          bankAccounts = [];
        }
        return {
          id: row[0],
          periodId: row[1],
          name: row[2],
          phone: row[3] || '',
          address: row[4] || '',
          isActive: row[5] !== 'false',
          bankAccounts,
          suppliedItemIds: row[7] ? row[7].split(';').filter((idObj: any) => idObj.trim()) : []
        };
      });
      if (parsedSuppliers.length > 0) tempDb.suppliers = parsedSuppliers;
    } 
    else if (rangeName.includes('Products')) {
      const parsedProducts: Product[] = rows.map(row => ({
        id: row[0],
        periodId: row[1],
        code: row[2] || '',
        accountId: row[3] || '',
        name: row[4],
        categoryId: row[5],
        unit: row[6]?.trim() === 'کیلو' ? 'کیلو' : 'عدد',
        barcode: row[7] || '',
        packageType: (row[8] || 'سلفون') as any,
        qtyPerPackage: parseFloat(row[9]) || 1,
        weightPerPackage: parseFloat(row[10]) || 1,
        salePrice: parseFloat(row[11]) || 0,
        cogsPrice: parseFloat(row[12]) || 0
      }));
      if (parsedProducts.length > 0) tempDb.products = parsedProducts;
    } 
    else if (rangeName.includes('Sales')) {
      const parsedSales: ProductSale[] = rows.map(row => ({
        id: row[0],
        salesPeriodId: row[1],
        periodId: row[2],
        productId: row[3],
        qtySold: parseFloat(row[4]) || 0,
        discount: parseFloat(row[5]) || 0,
        preDiscountAmount: parseFloat(row[6]) || 0,
        netSalesAmount: parseFloat(row[7]) || 0
      }));
      if (parsedSales.length > 0) tempDb.productSales = parsedSales;
    } 
    else if (rangeName.includes('Personnel')) {
      const parsedPersonnel: Personnel[] = rows.map(row => ({
        id: `emp-${row[0]}`,
        employeeCode: row[0],
        periodId: row[1],
        accountCode: row[2],
        firstName: row[3],
        lastName: row[4],
        nationalId: row[5],
        insuranceCode: row[6],
        fatherName: row[7],
        birthDate: row[8],
        birthPlace: row[9],
        center: row[10],
        project: row[11],
        complementaryInsurance: row[12] === 'true',
        yearsBase: parseFloat(row[13]) || 0,
        entryDate: row[14],
        insuranceDate: row[15],
        dailyYearsDifference: parseFloat(row[16]) || 0,
        bankName: row[17],
        bankAccount: row[18],
        shaba: row[19],
        cardNo: row[20],
        hasInsurance: row[21] === 'true',
        employerPremium3: parseFloat(row[22]) || 0,
        employerPremium: parseFloat(row[23]) || 0,
        workerPremium: parseFloat(row[24]) || 0,
        attractionAllowance: parseFloat(row[25]) || 0,
        baseSalaryInsurance: parseFloat(row[26]) || 0,
        dailyWage: parseFloat(row[27]) || 0,
        isDailyWage: row[28] === 'true',
        taxShare: parseFloat(row[29]) || 0,
        childrenCount: parseInt(row[30], 10) || 0,
        isMarried: row[31] === 'true',
        fixedAllowances: parseFloat(row[32]) || 0,
        isActive: row[33] !== 'false'
      }));
      if (parsedPersonnel.length > 0) tempDb.personnel = parsedPersonnel;
    } 
    else if (rangeName.includes('Overheads')) {
      const parsedOverheads: PeriodOverhead[] = rows.map(row => ({
        id: row[0],
        periodId: row[1],
        operational: parseFloat(row[2]) || 0,
        distributionSales: parseFloat(row[3]) || 0,
        financial: parseFloat(row[4]) || 0,
        administrative: parseFloat(row[5]) || 0,
        returnsOfExpense: parseFloat(row[6]) || 0
      }));
      if (parsedOverheads.length > 0) tempDb.periodOverheads = parsedOverheads;
    }
  });

  return tempDb;
}
