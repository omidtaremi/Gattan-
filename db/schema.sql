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
  password_hash TEXT NOT NULL,
  is_2fa BOOLEAN NOT NULL DEFAULT FALSE,
  secret_code TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users (username);

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
WHERE c.collection_key = 'periods' AND c.is_chunked = FALSE;

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
WHERE c.collection_key = 'items' AND c.is_chunked = FALSE;

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
WHERE c.collection_key = 'products' AND c.is_chunked = FALSE;

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
WHERE c.collection_key = 'productFormulas' AND c.is_chunked = FALSE;

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
WHERE c.collection_key = 'personnel' AND c.is_chunked = FALSE;

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
WHERE c.collection_key = 'customers' AND c.is_chunked = FALSE;

CREATE OR REPLACE VIEW v_suppliers AS
SELECT
  elem->>'id' AS id,
  elem->>'periodId' AS period_id,
  elem->>'name' AS name,
  elem->>'phone' AS phone,
  COALESCE((elem->>'isActive')::boolean, TRUE) AS is_active
FROM app_collections c,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.data) = 'array' THEN c.data ELSE '[]'::jsonb END) AS elem
WHERE c.collection_key = 'suppliers' AND c.is_chunked = FALSE;
