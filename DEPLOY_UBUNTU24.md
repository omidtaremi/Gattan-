# راهنمای نصب و راه‌اندازی کامل سامانه جامع گاتان روی سرور Ubuntu 24 (بدون محیط ابری)

این راهنما برای اجرای ۱۰۰٪ اختصاصی سایت و پایگاه داده **PostgreSQL** روی سرور مجازی **Ubuntu 24.04 LTS** شما طراحی شده است.

---

## روش اول: نصب خودکار با اسکریپت آماده

1. فایل‌های پروژه را روی سرور Ubuntu 24 آپلود یا کلون کنید (مثلاً در مسیر `/opt/gatan`).
2. وارد پوشه پروژه شوید و اسکریپت نصب را اجرا کنید:

```bash
cd /opt/gatan
sudo bash scripts/setup-ubuntu24-postgres.sh
```

این اسکریپت به صورت خودکار موارد زیر را انجام می‌دهد:
- نصب و فعال‌سازی **PostgreSQL** با رمزنگاری استاندارد `UTF-8`
- ساخت کاربر اختصاصی دیتابیس و پایگاه داده `gatan_db` با رمز عبور تصادفی امن
- اجرای فایل `db/schema.sql` جهت ایجاد جداول کاربران، نشست‌ها، داده‌های مشترک و گزارش فعالیت‌ها
- نصب **Node.js 22 LTS** و **PM2**
- ساخت فایل `.env` و بیلد نهایی پروژه (`npm run build`)
- پیکربندی **Nginx** به عنوان Reverse Proxy با پشتیبانی از آپلودهای سنگین تا `150MB`

---

## روش دوم: اجرای مرحله‌به‌مرحله دستی

### ۱) نصب PostgreSQL و ساخت دیتابیس
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql

sudo -u postgres psql -c "CREATE USER gatan_user WITH PASSWORD 'YOUR_STRONG_PASSWORD';"
sudo -u postgres createdb -O gatan_user -E UTF8 -T template0 gatan_db
```

### ۲) نصب Node.js 22 و وابستگی‌ها
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
cd /opt/gatan
npm install
```

### ۳) تنظیم فایل `.env`
فایل `.env.example` را به `.env` کپی کرده و مقادیر دیتابیس خود را وارد کنید:
```bash
cp .env.example .env
nano .env
```
مقدار `DATABASE_URL` را به شکل زیر تنظیم نمایید:
```env
APP_ENV=production
PORT=3000
DATABASE_URL="postgresql://gatan_user:YOUR_STRONG_PASSWORD@127.0.0.1:5432/gatan_db"
AUTH_SECRET="یک-رشته-تصادفی-طولانی-امنیتی"
```

### ۴) بیلد و اجرای دائمی سایت با PM2
```bash
npm run build
sudo npm install -g pm2
NODE_ENV=production pm2 start npm --name gatan-app -- start
pm2 save
pm2 startup
```

### ۵) تنظیم Nginx و فایروال
```bash
sudo apt install -y nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```
در فایل تنظیمات سایت Nginx (`/etc/nginx/sites-available/gatan`) مقدار `client_max_body_size 150M;` و `proxy_read_timeout 120s;` را برای انتقال بکاپ‌های حجیم تنظیم نمایید.

---

## ورود اولیه و انتقال داده‌های قبلی به PostgreSQL
1. پس از باز کردن سایت، با کاربر پیش‌فرض **`admin`** و رمز عبور **`123`** وارد شوید.
2. بلافاصله از بخش **«دیتابیس، کاربران و PostgreSQL»** رمز عبور کاربر `admin` و سایر کاربران را تغییر دهید و برای حسابدار، انباردار یا سایر همکاران حساب کاربری با دسترسی دلخواه ایجاد نمایید.
3. اگر از قبل اطلاعاتی در مرورگر خود یا در فایل اکسل پشتیبان داشتید:
   - با زدن دکمه **«ارسال / جایگزینی کل داده‌های فعلی در PostgreSQL»** (یا دکمه بنر آبی بالای صفحه) تمام اطلاعات مرورگر را به دیتابیس مشترک سرور منتقل کنید، یا از بخش **«پشتیبان اکسل»** فایل `.xlsx` خود را بازیابی نمایید.
4. از این لحظه تمامی کاربران روی دستگاه‌های مختلف به صورت هم‌زمان به داده‌های مشترک PostgreSQL دسترسی خواهند داشت.
