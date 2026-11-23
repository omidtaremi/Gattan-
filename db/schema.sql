-- ============================================================================
-- Gatan Comprehensive System - Self-Hosted PostgreSQL 16+ Schema (Ubuntu 24)
-- سامانه جامع گاتان - اسکیما استاندارد و چندکاربره PostgreSQL
-- ============================================================================

-- 1. جدول کاربران و سطوح دسترسی (Users & RBAC)
CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'کاربر انبار',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_branches JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  password_hash TEXT NOT NULL,
  is_2fa BOOLEAN NOT NULL DEFAULT FALSE,
  secret_code TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS allowed_branches JSONB NOT NULL DEFAULT '["*"]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users (username);

-- 1a. جدول رجیستری شعبه‌ها و دیتابیس مستقل هر شعبه (Multi-Branch Registry)
CREATE TABLE IF NOT EXISTS app_branches (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  db_name TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_branches_slug ON app_branches (slug);

-- 1b. جدول تعریف نقش‌های کاربری و دسترسی‌های پیش‌فرض (Custom User Roles)
CREATE TABLE IF NOT EXISTS app_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_roles_name ON app_roles (name);

-- 2. جدول نشست‌های احراز هویت کاربران (Sessions)
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions (expires_at);

-- 3. جدول مجموعه‌های داده مشترک بین تمامی کاربران (Shared Collections + Optimistic Locking)
CREATE TABLE IF NOT EXISTS app_collections (
  collection_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  is_chunked BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. جدول تکه‌بندی آرایه‌های بسیار حجیم (مانند ده‌ها هزار ردیف تراکنش فروش)
CREATE TABLE IF NOT EXISTS app_collection_chunks (
  collection_key TEXT NOT NULL REFERENCES app_collections(collection_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (collection_key, chunk_index)
);

-- 4b. جدول ذخیره رکوردبه‌رکورد مجموعه‌های داده برای به‌روزرسانی سریع تفاضلی (Record-Level Delta Storage)
CREATE TABLE IF NOT EXISTS app_collection_records (
  collection_key TEXT NOT NULL REFERENCES app_collections(collection_key) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_key, record_id)
);

CREATE INDEX IF NOT EXISTS idx_app_collection_records_order
  ON app_collection_records (collection_key, sort_order, record_id);

-- 5. جدول فراداده پایگاه داده (Metadata)
CREATE TABLE IF NOT EXISTS app_metadata (
  meta_key TEXT PRIMARY KEY,
  meta_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. جدول ثبت وقایع و تغییرات کاربران (Audit Logs)
CREATE TABLE IF NOT EXISTS app_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  collection_key TEXT,
  record_count INTEGER,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_audit_logs_created_at ON app_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_username ON app_audit_logs (username);

-- 7. جدول موقت دریافت تکه‌ای بکاپ‌های حجیم اکسل و انتقال پایگاه داده (Staged Chunked Import)
CREATE TABLE IF NOT EXISTS app_import_staging (
  import_id TEXT NOT NULL,
  collection_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL DEFAULT 1,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (import_id, collection_key, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_app_import_staging_created_at ON app_import_staging (created_at);

-- 8. جدول صف چاپ فیش‌پرینتر سیستم صندوق (POS Thermal Print Queue)
CREATE TABLE IF NOT EXISTS app_print_jobs (
  id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL DEFAULT 'cashier-main',
  job_type TEXT NOT NULL,
  title TEXT NOT NULL,
  order_id TEXT,
  order_number TEXT,
  department_name TEXT,
  paper_width_mm INTEGER NOT NULL DEFAULT 72,
  copies INTEGER NOT NULL DEFAULT 1,
  html_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  requested_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_print_jobs_station_status
  ON app_print_jobs (station_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_app_print_jobs_created_at
  ON app_print_jobs (created_at DESC);

-- ============================================================================
-- نماهای تحلیلی استاندارد SQL (Views) جهت گزارش‌گیری مستقیم در psql / BI
-- ============================================================================

CREATE OR REPLACE VIEW v_periods AS
SELECT
  elem->>'id' AS id,
  elem->>'name' AS name,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active,
  elem->>'startDate' AS start_date,
  elem->>'endDate' AS end_date,
  elem->>'createdAt' AS created_at
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'periods' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'name' AS name,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active,
  r.data->>'startDate' AS start_date,
  r.data->>'endDate' AS end_date,
  r.data->>'createdAt' AS created_at
FROM app_collection_records r
WHERE r.collection_key = 'periods';

CREATE OR REPLACE VIEW v_items AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'code' AS code,
  elem->>'accountId' AS account_id,
  elem->>'name' AS name,
  elem->>'categoryId' AS category_id,
  elem->>'unit' AS unit,
  elem->>'barcode' AS barcode,
  COALESCE((elem->>'price')::numeric, 0) AS price,
  COALESCE((elem->>'reorderThreshold')::numeric, 0) AS reorder_threshold,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'items' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'code' AS code,
  r.data->>'accountId' AS account_id,
  r.data->>'name' AS name,
  r.data->>'categoryId' AS category_id,
  r.data->>'unit' AS unit,
  r.data->>'barcode' AS barcode,
  COALESCE((r.data->>'price')::numeric, 0) AS price,
  COALESCE((r.data->>'reorderThreshold')::numeric, 0) AS reorder_threshold,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active
FROM app_collection_records r
WHERE r.collection_key = 'items';

CREATE OR REPLACE VIEW v_products AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'code' AS code,
  elem->>'accountId' AS account_id,
  elem->>'name' AS name,
  elem->>'categoryId' AS category_id,
  elem->>'unit' AS unit,
  elem->>'barcode' AS barcode,
  COALESCE((elem->>'salePrice')::numeric, 0) AS sale_price,
  COALESCE((elem->>'cogsPrice')::numeric, 0) AS cogs_price,
  COALESCE((elem->>'isWip')::boolean, FALSE) AS is_wip
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'products' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'code' AS code,
  r.data->>'accountId' AS account_id,
  r.data->>'name' AS name,
  r.data->>'categoryId' AS category_id,
  r.data->>'unit' AS unit,
  r.data->>'barcode' AS barcode,
  COALESCE((r.data->>'salePrice')::numeric, 0) AS sale_price,
  COALESCE((r.data->>'cogsPrice')::numeric, 0) AS cogs_price,
  COALESCE((r.data->>'isWip')::boolean, FALSE) AS is_wip
FROM app_collection_records r
WHERE r.collection_key = 'products';

CREATE OR REPLACE VIEW v_product_formulas AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'productId' AS product_account_code,
  elem->>'name' AS formula_name,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active,
  elem->'ingredients' AS ingredients
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'productFormulas' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'productId' AS product_account_code,
  r.data->>'name' AS formula_name,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active,
  r.data->'ingredients' AS ingredients
FROM app_collection_records r
WHERE r.collection_key = 'productFormulas';

CREATE OR REPLACE VIEW v_personnel AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'employeeCode' AS employee_code,
  elem->>'accountCode' AS account_code,
  elem->>'attendanceCode' AS attendance_code,
  COALESCE(elem->>'firstName', '') AS first_name,
  COALESCE(elem->>'lastName', '') AS last_name,
  elem->>'nationalId' AS national_id,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'personnel' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'employeeCode' AS employee_code,
  r.data->>'accountCode' AS account_code,
  r.data->>'attendanceCode' AS attendance_code,
  COALESCE(r.data->>'firstName', '') AS first_name,
  COALESCE(r.data->>'lastName', '') AS last_name,
  r.data->>'nationalId' AS national_id,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active
FROM app_collection_records r
WHERE r.collection_key = 'personnel';

CREATE OR REPLACE VIEW v_customers AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'code' AS code,
  elem->>'accountingCode' AS accounting_code,
  elem->>'name' AS name,
  elem->>'type' AS customer_type,
  elem->>'phone' AS phone,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'customers' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'code' AS code,
  r.data->>'accountingCode' AS accounting_code,
  r.data->>'name' AS name,
  r.data->>'type' AS customer_type,
  r.data->>'phone' AS phone,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active
FROM app_collection_records r
WHERE r.collection_key = 'customers';

CREATE OR REPLACE VIEW v_suppliers AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'name' AS name,
  elem->>'phone' AS phone,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'suppliers' AND c.is_chunked = FALSE
UNION ALL
SELECT
  r.data->>'id' AS id,
  r.data->>'periodId' AS period_id,
  r.data->>'name' AS name,
  r.data->>'phone' AS phone,
  COALESCE((r.data->>'isActive')::boolean, TRUE) AS is_active
FROM app_collection_records r
WHERE r.collection_key = 'suppliers';

-- نمای پیکربندی منوی دیجیتال عمومی (QR Digital Menu Config)
CREATE OR REPLACE VIEW v_digital_menu_config AS
SELECT
  c.collection_key,
  COALESCE((c.data->>'enabled')::boolean, TRUE) AS is_enabled,
  c.data->'appearance'->>'cafeNameFa' AS cafe_name_fa,
  c.data->'appearance'->>'cafeNameEn' AS cafe_name_en,
  c.data->'appearance'->>'defaultLanguage' AS default_language,
  c.data->'appearance'->>'currencyMode' AS currency_mode,
  c.data->'appearance'->>'sourcePeriodId' AS source_period_id,
  c.version,
  c.updated_by,
  c.updated_at
FROM app_collections c
WHERE c.collection_key = 'digitalMenu';

