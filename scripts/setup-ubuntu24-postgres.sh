#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Gatan Comprehensive System - Self-Hosted PostgreSQL & App Setup (Ubuntu 24.04)
# ==============================================================================

APP_DIR="${APP_DIR:-$(pwd)}"
DB_NAME="${PGDATABASE:-gatan_db}"
DB_USER="${PGUSER:-gatan_user}"
DB_PASS="${PGPASSWORD:-$(openssl rand -hex 18)}"
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"
APP_PORT="${PORT:-3000}"
SERVER_DOMAIN="${SERVER_DOMAIN:-_}"

echo "============================================================"
echo "  Gatan Self-Hosted Setup for Ubuntu 24.04 LTS + PostgreSQL"
echo "============================================================"

if [[ $EUID -ne 0 ]]; then
  echo "Please run this script as root or with sudo: sudo bash scripts/setup-ubuntu24-postgres.sh"
  exit 1
fi

echo "[1/6] Updating apt repositories and installing PostgreSQL + Nginx + curl..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y postgresql postgresql-contrib nginx curl ca-certificates gnupg openssl

echo "[2/6] Starting and enabling PostgreSQL service..."
systemctl enable postgresql
systemctl start postgresql

echo "[3/6] Creating PostgreSQL role '${DB_USER}' and database '${DB_NAME}' (UTF-8)..."
su - postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" | grep -q 1; then
  su - postgres -c "createdb -O ${DB_USER} -E UTF8 -T template0 ${DB_NAME}"
fi

su - postgres -c "psql -d ${DB_NAME} -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER}; GRANT ALL ON SCHEMA public TO ${DB_USER};\""

echo "[4/6] Applying schema from db/schema.sql..."
if [[ -f "${APP_DIR}/db/schema.sql" ]]; then
  PGPASSWORD="${DB_PASS}" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -f "${APP_DIR}/db/schema.sql"
fi

echo "[5/6] Checking Node.js 22 LTS & PM2..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "[6/6] Writing .env and configuring Nginx reverse proxy..."
ENV_FILE="${APP_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  cp "${ENV_FILE}" "${ENV_FILE}.bak.$(date +%s)"
fi

cat > "${ENV_FILE}" <<EOF
APP_ENV=production
PORT=${APP_PORT}
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=${DB_USER}
PGPASSWORD="${DB_PASS}"
PGDATABASE=${DB_NAME}
PGSSLMODE=disable
AUTH_SECRET="${AUTH_SECRET}"
EOF
chmod 600 "${ENV_FILE}"

cat > /etc/nginx/sites-available/gatan <<EOF
server {
    listen 80;
    server_name ${SERVER_DOMAIN};

    client_max_body_size 150M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/gatan /etc/nginx/sites-enabled/gatan
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "Installing npm packages, building production frontend, and starting PM2..."
cd "${APP_DIR}"
npm ci || npm install
npm run build
pm2 delete gatan-app >/dev/null 2>&1 || true
NODE_ENV=production pm2 start npm --name gatan-app -- start
pm2 save

echo ""
echo "============================================================"
echo "  Setup Complete!"
echo "  Database: ${DB_NAME} | User: ${DB_USER}"
echo "  .env saved at: ${ENV_FILE}"
echo "  App running via PM2 on port ${APP_PORT} behind Nginx (port 80)."
echo "  Optional SSL: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx"
echo "============================================================"
