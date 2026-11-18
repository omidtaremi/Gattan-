# -*- coding: utf-8 -*-
"""
==============================================================================
ZKTeco XFace 60 N (ZMM510 Platform) Advanced Python Local Bridge Server
==============================================================================

Dependencies:
    pip install pyzk flask flask-cors

Run:
    python xface60n_bridge.py
"""

import os
import sys
from datetime import datetime
from flask import Flask, request, jsonify, render_template_string, Response
from flask_cors import CORS

try:
    from zk import ZK
except ImportError:
    print("Error: PyZK is not installed. Run: pip install pyzk flask flask-cors")
    sys.exit(1)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

DEFAULT_DEVICE_IP = os.environ.get('DEVICE_IP', '192.168.1.201')
DEFAULT_DEVICE_PORT = int(os.environ.get('DEVICE_PORT', '4370'))
SERVER_PORT = int(os.environ.get('BRIDGE_PORT', '5005'))

def gregorian_to_jalali(gy, gm, gd):
    if 1350 <= gy <= 1450:
        return gy, gm, gd
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    jy = 979 if gy > 1600 else 0
    gy -= 1600 if gy > 1600 else 621
    gy2 = gy if gm > 2 else gy - 1
    days = (365 * gy) + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) - 80 + gd + g_d_m[gm - 1]
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + (days // 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + ((days - 186) // 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd

HTML_DASHBOARD = """
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>داشبورد پل محلی پایتون: دستگاه XFace 60 N (ZMM510)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { font-family: Tahoma, Segoe UI, sans-serif; background: #0b1120; color: #f8fafc; padding: 25px; margin: 0; direction: rtl; }
    .container { max-width: 1000px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
    h1 { color: #f43f5e; font-size: 20px; margin-top: 0; display: flex; align-items: center; justify-content: space-between; }
    .badge { background: #eab30825; color: #facc15; border: 1px solid #eab30850; padding: 4px 10px; border-radius: 8px; font-size: 12px; }
    input { background: #0f172a; border: 1px solid #475569; color: #fff; padding: 10px 14px; border-radius: 10px; font-family: monospace; font-size: 14px; outline: none; }
    button { background: #e11d48; color: white; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: bold; font-family: inherit; font-size: 13px; }
    .btn-secondary { background: #2563eb; }
    .btn-emerald { background: #059669; }
    #statusResult { padding: 14px; border-radius: 10px; font-size: 13px; font-weight: bold; margin-top: 14px; display: none; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { border: 1px solid #334155; padding: 10px; text-align: center; }
    th { background: #0f172a; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>
        <span>پل ارتباطی اختصاصی Python: دستگاه XFace 60 N</span>
        <span class="badge">PyZK Engine (پورت 5005)</span>
      </h1>
      <p style="color: #94a3b8; font-size: 13px;">اتصال مستقیم سوکت TCP پایتون با ommit_ping=True به پورت ۴۳۷۰</p>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <label>آی‌پی دستگاه:</label>
        <input type="text" id="devIp" value="{{ default_ip }}" style="width: 160px; text-align: center;">
        <label>پورت:</label>
        <input type="text" id="devPort" value="{{ default_port }}" style="width: 80px; text-align: center;">
        <button onclick="checkStatus()">۱. تست وضعیت</button>
        <button onclick="fetchLogs()" class="btn-secondary">۲. تخلیه زنده</button>
        <button onclick="downloadDat()" class="btn-emerald">۳. دانلود فایل DAT</button>
      </div>
      <div id="statusResult"></div>
    </div>
    <div class="card">
      <h3>لیست رکوردهای تردد دریافت شده (<span id="logCount" style="color: #38bdf8;">۰</span> تردد)</h3>
      <table id="logsTable">
        <thead>
          <tr>
            <th>ردیف</th>
            <th>کد پرسنلی</th>
            <th>تاریخ شمسی</th>
            <th>ساعت</th>
            <th>نوع</th>
          </tr>
        </thead>
        <tbody id="tableBody">
          <tr><td colspan="5" style="color: #64748b; padding: 20px;">دکمه «۲. تخلیه زنده» را کلیک کنید.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <script>
    async function checkStatus() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      const el = document.getElementById('statusResult');
      el.style.display = 'block';
      el.style.background = 'rgba(56, 189, 248, 0.15)';
      el.style.color = '#38bdf8';
      el.innerText = 'درحال اتصال...';
      try {
        const res = await fetch('/status?ip=' + ip + '&port=' + port);
        const data = await res.json();
        if (data.status === 'online') {
          el.style.background = 'rgba(16, 185, 129, 0.15)';
          el.style.color = '#34d399';
          el.innerText = '✔ ارتباط موفق! سریال: ' + (data.serialNumber || 'تأیید شد') + ' | کاربران: ' + data.userCount;
        } else {
          el.style.background = 'rgba(239, 68, 68, 0.15)';
          el.style.color = '#f87171';
          el.innerText = '✖ خطا: ' + (data.error || 'عدم پاسخ');
        }
      } catch (e) {
        el.innerText = '✖ خطا در ارتباط: ' + e.message;
      }
    }

    async function fetchLogs() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '<tr><td colspan="5" style="color: #38bdf8; padding: 20px;">درحال خواندن اطلاعات...</td></tr>';
      try {
        const res = await fetch('/logs?ip=' + ip + '&port=' + port);
        const data = await res.json();
        if (data.logs && Array.isArray(data.logs)) {
          document.getElementById('logCount').innerText = data.logs.length;
          tbody.innerHTML = '';
          data.logs.forEach((log, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (idx + 1) + '</td><td>' + log.userId + '</td><td>' + log.jalaliDate + '</td><td>' + log.time + '</td><td>' + (log.status === 0 ? 'ورود' : 'خروج') + '</td>';
            tbody.appendChild(tr);
          });
        } else {
          tbody.innerHTML = '<tr><td colspan="5" style="color: #f87171;">خطا: ' + (data.error || 'نامشخص') + '</td></tr>';
        }
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: #f87171;">خطا: ' + e.message + '</td></tr>';
      }
    }

    function downloadDat() {
      const ip = document.getElementById('devIp').value;
      const port = document.getElementById('devPort').value;
      window.open('/download_dat?ip=' + ip + '&port=' + port, '_blank');
    }
  </script>
</body>
</html>
"""

@app.route('/', methods=['GET'])
def index():
    return render_template_string(HTML_DASHBOARD, default_ip=DEFAULT_DEVICE_IP, default_port=DEFAULT_DEVICE_PORT)

@app.route('/status', methods=['GET'])
def status():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))
    zk = ZK(ip, port=port, timeout=8, password=0, force_udp=False, ommit_ping=True, verbose=False)
    conn = None
    try:
        conn = zk.connect()
        conn.disable_device()
        firmware = conn.get_firmware_version()
        serial = conn.get_serialnumber()
        users = conn.get_users()
        conn.enable_device()
        return jsonify({
            "status": "online",
            "model": "XFace 60 N",
            "platform": "ZMM510",
            "firmware": str(firmware),
            "serialNumber": str(serial),
            "userCount": len(users)
        })
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 200
    finally:
        if conn:
            try: conn.disconnect()
            except: pass

@app.route('/logs', methods=['GET'])
def logs():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))
    zk = ZK(ip, port=port, timeout=12, password=0, force_udp=False, ommit_ping=True, verbose=False)
    conn = None
    try:
        conn = zk.connect()
        conn.disable_device()
        records = conn.get_attendance()
        conn.enable_device()

        parsed = []
        for r in records:
            dt = r.timestamp
            jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
            jalali_str = f"{jy:04d}/{jm:02d}/{jd:02d}"
            time_str = dt.strftime("%H:%M")
            punch_val = 1 if r.punch in [1, 2, 5] else 0
            parsed.append({
                "userId": str(r.user_id),
                "timestamp": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "jalaliDate": jalali_str,
                "time": time_str,
                "status": punch_val,
                "verifyMode": getattr(r, 'verify_type', 15)
            })

        return jsonify({"status": "success", "logs": parsed, "total": len(parsed)})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 200
    finally:
        if conn:
            try: conn.disconnect()
            except: pass

@app.route('/download_dat', methods=['GET'])
def download_dat():
    ip = request.args.get('ip', DEFAULT_DEVICE_IP).strip()
    port = int(request.args.get('port', DEFAULT_DEVICE_PORT))
    zk = ZK(ip, port=port, timeout=12, password=0, force_udp=False, ommit_ping=True)
    conn = None
    lines = []
    try:
        conn = zk.connect()
        conn.disable_device()
        records = conn.get_attendance()
        conn.enable_device()
        for r in records:
            dt = r.timestamp
            jy, jm, jd = gregorian_to_jalali(dt.year, dt.month, dt.day)
            jalali_str = f"{jy:04d}/{jm:02d}/{jd:02d}"
            time_str = dt.strftime("%H:%M:%S")
            punch_val = 1 if r.punch in [1, 2, 5] else 0
            lines.append(f"{r.user_id}\t{jalali_str}\t{time_str}\t1\t{punch_val}")
    except Exception as e:
        return f"Error: {e}", 500
    finally:
        if conn:
            try: conn.disconnect()
            except: pass

    content = "\r\n".join(lines)
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment;filename=XFace60N_Attendance.dat"}
    )

if __name__ == '__main__':
    print("====================================================================")
    print("  🚀 ZKTeco XFace 60 N (ZMM510) Python Bridge Server")
    print(f"  📡 Target Device:      {DEFAULT_DEVICE_IP}:{DEFAULT_DEVICE_PORT}")
    print(f"  🌐 Local Web Dashboard: http://localhost:{SERVER_PORT}")
    print("====================================================================")
    app.run(host='0.0.0.0', port=SERVER_PORT, debug=False)
