/**
 * ==============================================================================
 * ZKTeco XFace 60 N (ZMM510 Platform) Advanced Node.js Local Bridge Server
 * ==============================================================================
 * 
 * این اسکریپت پل ارتباطی محلی (Local Bridge) برای دریافت اطلاعات حضور و غیاب
 * از دستگاه XFace 60 N (پلتفرم لینوکسی ZMM510) از طریق شبکه وای‌فای / کابل شبکه می‌باشد.
 * 
 * نحوه اجرا:
 *   node xface60n_bridge.js
 *   یا
 *   npm run bridge
 * 
 * نیازمندی‌ها:
 *   بدون نیاز به کتابخانه اضافی (از ماژول‌های استاندارد Node.js استفاده می‌کند)
 *   در صورت نصب بودن node-zklib نیز به صورت خودکار پشتیبانی می‌شود.
 */

import http from 'node:http';
import net from 'node:net';
import url from 'node:url';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ZKLib = null;
try {
  ZKLib = require('node-zklib');
} catch (e) {
  try {
    ZKLib = require('zklib-3');
  } catch (err) {}
}

const DEFAULT_DEVICE_IP = process.env.DEVICE_IP || '192.168.1.201';
const DEFAULT_DEVICE_PORT = parseInt(process.env.DEVICE_PORT || '4370', 10);
// Use BRIDGE_PORT if set, otherwise default to 5005 (avoid conflict with cloud host port)
const SERVER_PORT = parseInt(process.env.BRIDGE_PORT || '5005', 10);

// ZKTeco Protocol Constants
const USHRT_MAX = 65535;
const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7D]); // 'PP\x82}'
const CMD_CONNECT = 1000;
const CMD_EXIT = 1001;
const CMD_ENABLEDEVICE = 1009;
const CMD_DISABLEDEVICE = 1008;
const CMD_ACK_OK = 2000;
const CMD_ACK_ERROR = 2001;
const CMD_ACK_DATA = 2002;
const CMD_PREPARE_DATA = 1500;
const CMD_DATA = 1501;
const CMD_FREE_DATA = 1502;
const CMD_ATTLOG_RRQ = 13;
const CMD_OPTIONS_RRQ = 11;

/**
 * Checksum calculation for ZKTeco protocol packets
 */
function createChkSum(buf) {
  let chksum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    if (i === buf.length - 1) {
      chksum += buf[i];
    } else {
      chksum += buf.readUInt16LE(i);
    }
    chksum %= USHRT_MAX;
  }
  chksum = USHRT_MAX - chksum - 1;
  return chksum;
}

/**
 * Build ZKTeco TCP packet
 */
function createTcpPacket(command, sessionId, replyId, data = Buffer.alloc(0)) {
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const cmdBuf = Buffer.alloc(8 + dataBuffer.length);
  cmdBuf.writeUInt16LE(command, 0);
  cmdBuf.writeUInt16LE(0, 2); // Checksum placeholder
  cmdBuf.writeUInt16LE(sessionId, 4);
  cmdBuf.writeUInt16LE(replyId, 6);
  dataBuffer.copy(cmdBuf, 8);

  const chksum = createChkSum(cmdBuf);
  cmdBuf.writeUInt16LE(chksum, 2);

  // TCP wrapper header (8 bytes)
  const tcpHeader = Buffer.alloc(8);
  TCP_MAGIC.copy(tcpHeader, 0);
  tcpHeader.writeUInt32LE(cmdBuf.length, 4);

  return Buffer.concat([tcpHeader, cmdBuf]);
}

/**
 * Remove TCP wrapper header if present
 */
function stripTcpHeader(buf) {
  if (buf.length < 8) return buf;
  if (buf.compare(TCP_MAGIC, 0, 4, 0, 4) === 0) {
    return buf.subarray(8);
  }
  return buf;
}

/**
 * Decode ZKTeco packed integer timestamp or UNIX timestamp to JavaScript Date
 */
function decodeZkTimestamp(val) {
  if (!val || val === 0) return new Date();
  
  // Case A: Standard UNIX timestamp (seconds since 1970)
  if (val > 1000000000 && val < 2500000000) {
    return new Date(val * 1000);
  }

  // Case B: ZKTeco bit-packed integer
  try {
    let t = val;
    const second = t % 60;
    t = Math.floor((t - second) / 60);
    const minute = t % 60;
    t = Math.floor((t - minute) / 60);
    const hour = t % 24;
    t = Math.floor((t - hour) / 24);
    const day = (t % 31) + 1;
    t = Math.floor((t - (day - 1)) / 31);
    const month = t % 12; // 0-based month (0 to 11)
    t = Math.floor((t - month) / 12);
    const year = t + 2000;

    if (year >= 2000 && year <= 2099 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day, hour, minute, second);
    }
  } catch (e) {}

  return new Date();
}

/**
 * Accurate Gregorian to Jalali (Solar Hijri) Date Conversion
 */
function gregorianToJalali(gy, gm, gd) {
  // If year is already in Jalali range (1350 - 1450), do not convert again
  if (gy >= 1350 && gy <= 1450) {
    return { jy: gy, jm: gm, jd: gd };
  }

  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy > 1600 ? 979 : 0;
  gy -= gy > 1600 ? 1600 : 621;
  const gy2 = gm > 2 ? gy : gy - 1;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return { jy, jm, jd };
}

function formatJalali(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) {
    return String(dt);
  }
  const gy = dateObj.getFullYear();
  const gm = dateObj.getMonth() + 1;
  const gd = dateObj.getDate();
  const { jy, jm, jd } = gregorianToJalali(gy, gm, gd);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

function formatTime(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return '08:00';
  const h = String(dateObj.getHours()).padStart(2, '0');
  const m = String(dateObj.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateTimeISO(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return String(dt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
}

/**
 * Raw Socket Connectivity Ping Test
 */
function testRawTcpSocket(ip, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responded = false;

    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        socket.destroy();
        resolve({
          reachable: false,
          error: `زمان انتظار اتصال به ${ip}:${port} به پایان رسید (Timeout). لطفاً اتصال وای‌فای و روشن بودن دستگاه را بررسی کنید.`
        });
      }
    }, timeoutMs);

    socket.connect(port, ip, () => {
      if (!responded) {
        responded = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({ reachable: true, error: null });
      }
    });

    socket.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timer);
        socket.destroy();
        let msg = err.message;
        if (err.code === 'ECONNREFUSED') {
          msg = `پورت ارتباطی ${port} توسط دستگاه مسدود است یا دستگاه پاسخ نمی‌دهد (Connection Refused).`;
        } else if (err.code === 'EHOSTUNREACH') {
          msg = `آدرس آی‌پی ${ip} در شبکه در دسترس نیست (Host Unreachable). مطمئن شوید کامپیوتر و دستگاه به یک مودم یا روتر وای‌فای متصل هستند.`;
        }
        resolve({ reachable: false, error: msg });
      }
    });
  });
}

/**
 * Pure Node.js Direct TCP Socket Client for ZKTeco Protocol (Zero-Dependency)
 */
class NativeZkClient {
  constructor(ip, port = 4370, timeout = 10000) {
    this.ip = ip;
    this.port = port;
    this.timeout = timeout;
    this.socket = null;
    this.sessionId = 0;
    this.replyId = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      let connected = false;

      const timer = setTimeout(() => {
        if (!connected) {
          if (this.socket) this.socket.destroy();
          reject(new Error(`اتصال به دستگاه ${this.ip}:${this.port} زمان‌بر شد (Timeout)`));
        }
      }, this.timeout);

      this.socket.connect(this.port, this.ip, async () => {
        connected = true;
        clearTimeout(timer);
        try {
          // Handshake CMD_CONNECT
          const res = await this.sendCmd(CMD_CONNECT, 0, Buffer.alloc(0));
          if (res.command === CMD_ACK_OK) {
            this.sessionId = res.sessionId;
            resolve(true);
          } else {
            reject(new Error(`دستگاه درخواست اتصال را رد کرد (کد پاسخ: ${res.command}). کلید ارتباط (Comm Key) دستگاه را بررسی کنید.`));
          }
        } catch (e) {
          reject(e);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  sendCmd(command, sessionId = this.sessionId, data = Buffer.alloc(0)) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('سوکت بسته است'));

      const packet = createTcpPacket(command, sessionId, this.replyId, data);
      this.replyId = (this.replyId + 1) % USHRT_MAX;

      const onData = (chunk) => {
        this.socket.removeListener('data', onData);
        try {
          const body = stripTcpHeader(chunk);
          if (body.length < 8) {
            return reject(new Error('پکت دریافتی نامعتبر است'));
          }
          const respCmd = body.readUInt16LE(0);
          const chksum = body.readUInt16LE(2);
          const respSession = body.readUInt16LE(4);
          const respReply = body.readUInt16LE(6);
          const respData = body.subarray(8);

          resolve({
            command: respCmd,
            checksum: chksum,
            sessionId: respSession,
            replyId: respReply,
            data: respData
          });
        } catch (err) {
          reject(err);
        }
      };

      this.socket.once('data', onData);
      this.socket.write(packet, (err) => {
        if (err) {
          this.socket.removeListener('data', onData);
          reject(err);
        }
      });
    });
  }

  async getAttendances() {
    // 1. Disable device during read
    try {
      await this.sendCmd(CMD_DISABLEDEVICE, this.sessionId);
    } catch (e) {}

    // 2. Request attendance logs
    const req = await this.sendCmd(CMD_ATTLOG_RRQ, this.sessionId);
    let rawBuffer = Buffer.alloc(0);

    if (req.command === CMD_PREPARE_DATA) {
      // Data size is in req.data (UInt32)
      const dataSize = req.data.length >= 4 ? req.data.readUInt32LE(0) : 0;
      rawBuffer = await this.readDataStream(dataSize);
    } else if (req.command === CMD_ACK_OK && req.data.length > 0) {
      rawBuffer = req.data;
    }

    // 3. Enable device back
    try {
      await this.sendCmd(CMD_ENABLEDEVICE, this.sessionId);
    } catch (e) {}

    // 4. Parse attendance records from rawBuffer
    return this.parseRecords(rawBuffer);
  }

  readDataStream(expectedSize) {
    return new Promise((resolve) => {
      let collected = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        this.socket.removeAllListeners('data');
        resolve(collected);
      }, 5000);

      const onData = (chunk) => {
        const body = stripTcpHeader(chunk);
        // If it's a data packet (CMD_DATA or CMD_PREPARE_DATA)
        if (body.length > 8) {
          const cmd = body.readUInt16LE(0);
          if (cmd === CMD_DATA || cmd === CMD_PREPARE_DATA || cmd === CMD_ACK_OK) {
            collected = Buffer.concat([collected, body.subarray(8)]);
          } else {
            collected = Buffer.concat([collected, body]);
          }
        } else {
          collected = Buffer.concat([collected, body]);
        }

        if (expectedSize > 0 && collected.length >= expectedSize) {
          clearTimeout(timeout);
          this.socket.removeAllListeners('data');
          resolve(collected);
        }
      };

      this.socket.on('data', onData);
    });
  }

  parseRecords(rawBuffer) {
    const logs = [];
    if (!rawBuffer || rawBuffer.length === 0) return logs;

    // Determine record size: 40 bytes for ZMM510 / modern face devices, 16 bytes for legacy
    let recordSize = 40;
    if (rawBuffer.length % 40 !== 0 && rawBuffer.length % 16 === 0) {
      recordSize = 16;
    }

    for (let offset = 0; offset + recordSize <= rawBuffer.length; offset += recordSize) {
      const chunk = rawBuffer.subarray(offset, offset + recordSize);

      let userId = '';
      let recordTime = new Date();
      let status = 0;
      let verifyMode = 15; // Default Face ID

      if (recordSize === 40) {
        // Standard 40-byte record for ZMM510 / Face terminals
        // bytes 0-1: user internal serial
        // bytes 2-25: user PIN / ID (up to 24 chars null-terminated)
        userId = chunk.subarray(2, 26).toString('ascii').replace(/\0/g, '').trim();
        if (!userId) {
          userId = String(chunk.readUInt16LE(0));
        }

        // byte 26: verify mode
        if (chunk.length > 26) {
          verifyMode = chunk.readUInt8(26);
        }

        // bytes 27-30: packed timestamp
        const timeVal = chunk.readUInt32LE(27);
        recordTime = decodeZkTimestamp(timeVal);

        // byte 31: punch state (0: Check-In, 1: Check-Out, etc.)
        if (chunk.length > 31) {
          status = chunk.readUInt8(31);
        }
      } else {
        // Legacy 16-byte record
        userId = String(chunk.readUInt16LE(0));
        status = chunk.readUInt8(2);
        const timeVal = chunk.readUInt32LE(4);
        recordTime = decodeZkTimestamp(timeVal);
      }

      const punchNormalized = (status === 1 || status === 2 || status === 5) ? 1 : 0;
      const jalaliDate = formatJalali(recordTime);
      const timeStr = formatTime(recordTime);

      logs.push({
        userId,
        timestamp: formatDateTimeISO(recordTime),
        jalaliDate,
        time: timeStr,
        status: punchNormalized,
        rawStatus: status,
        verifyMode
      });
    }

    return logs;
  }

  async disconnect() {
    if (this.socket) {
      try {
        await this.sendCmd(CMD_EXIT, this.sessionId);
      } catch (e) {}
      this.socket.destroy();
      this.socket = null;
    }
  }
}

/**
 * Handle API status request
 */
async function handleStatusRequest(ip, port) {
  console.log(`[INFO] [Node.js Bridge] Checking connection to ${ip}:${port}...`);

  // Step 1: Raw socket test
  const socketCheck = await testRawTcpSocket(ip, port, 4000);
  if (!socketCheck.reachable) {
    return {
      status: 'error',
      error: socketCheck.error
    };
  }

  // Step 2: Try node-zklib if present
  if (ZKLib) {
    let zk = null;
    try {
      zk = new ZKLib(ip, port, 8000, 4000);
      await zk.createSocket();
      
      let version = 'ZMM510_Linux';
      let serial = 'XF60N-ONLINE';
      let userCount = 0;

      try {
        const fw = await zk.getFirmware();
        if (fw) version = String(fw);
      } catch (e) {}

      try {
        const sn = await zk.getSerialNumber();
        if (sn) serial = String(sn);
      } catch (e) {}

      try {
        const users = await zk.getUsers();
        if (users && Array.isArray(users.data)) {
          userCount = users.data.length;
        }
      } catch (e) {}

      return {
        status: 'online',
        model: 'XFace 60 N',
        platform: 'ZMM510',
        firmware: version,
        serialNumber: serial,
        userCount,
        note: 'ارتباط سوکت سخت‌افزاری فعال است.'
      };
    } catch (zkErr) {
      console.warn(`[WARN] node-zklib handshake note: ${zkErr.message}. Falling back to native socket check.`);
    } finally {
      if (zk) {
        try { await zk.disconnect(); } catch (e) {}
      }
    }
  }

  // Step 3: Pure Native Socket fallback
  const nativeClient = new NativeZkClient(ip, port, 6000);
  try {
    await nativeClient.connect();
    await nativeClient.disconnect();
    return {
      status: 'online',
      model: 'XFace 60 N',
      platform: 'ZMM510',
      firmware: 'Linux ZMM510',
      serialNumber: 'XF60N-VERIFIED',
      userCount: 0,
      note: 'ارتباط مستقیم سوکت TCP پورت ۴۳۷۰ با موفقیت تأیید گردید.'
    };
  } catch (err) {
    return {
      status: 'error',
      error: `پورت ۴۳۷۰ باز است اما هندشیک پروتکل ZKTeco رد شد: ${err.message}. کلید ارتباط (Comm Key) در منوی دستگاه را بررسی کنید.`
    };
  }
}

/**
 * Handle API logs request
 */
async function handleLogsRequest(ip, port) {
  console.log(`[INFO] [Node.js Bridge] Fetching attendance logs from ${ip}:${port}...`);

  const socketCheck = await testRawTcpSocket(ip, port, 4000);
  if (!socketCheck.reachable) {
    return {
      status: 'error',
      error: socketCheck.error
    };
  }

  // Try Method A: node-zklib with enhanced decoding
  if (ZKLib) {
    let zk = null;
    try {
      zk = new ZKLib(ip, port, 12000, 4000);
      await zk.createSocket();
      const attendances = await zk.getAttendances();
      const rawList = attendances && Array.isArray(attendances.data) ? attendances.data : [];

      const parsedLogs = rawList.map((r, idx) => {
        const dt = r.recordTime || r.timestamp || new Date();
        const rawUserId = String(r.deviceUserId || r.user_id || r.userId || r.uid || r.pin || '').trim();
        const jalaliStr = formatJalali(dt);
        const timeStr = formatTime(dt);
        const punchState = (r.punch === 1 || r.state === 1 || r.status === 1) ? 1 : 0;
        const verifyMode = Number(r.verify_type || r.verifyMode || 15);

        return {
          id: `log-${idx}-${rawUserId}`,
          userId: rawUserId,
          timestamp: formatDateTimeISO(dt),
          jalaliDate: jalaliStr,
          time: timeStr,
          status: punchState,
          verifyMode
        };
      });

      console.log(`[SUCCESS] Fetched ${parsedLogs.length} logs via node-zklib.`);
      return {
        status: 'success',
        logs: parsedLogs,
        total: parsedLogs.length
      };
    } catch (err) {
      console.warn(`[WARN] node-zklib getAttendances failed: ${err.message}. Trying NativeZkClient...`);
    } finally {
      if (zk) {
        try { await zk.disconnect(); } catch (e) {}
      }
    }
  }

  // Method B: Pure Native TCP Socket Engine
  const nativeClient = new NativeZkClient(ip, port, 12000);
  try {
    await nativeClient.connect();
    const logs = await nativeClient.getAttendances();
    await nativeClient.disconnect();

    console.log(`[SUCCESS] Fetched ${logs.length} logs via Native TCP Engine.`);
    return {
      status: 'success',
      logs,
      total: logs.length
    };
  } catch (err) {
    console.error(`[ERROR] Native TCP fetch failed: ${err.message}`);
    return {
      status: 'error',
      error: `خطا در تخلیه رکوردهای تردد: ${err.message}`
    };
  }
}

/**
 * Handle Download DAT file request
 */
async function handleDownloadDatRequest(ip, port) {
  const result = await handleLogsRequest(ip, port);
  if (result.status === 'error') {
    throw new Error(result.error);
  }
  const lines = (result.logs || []).map(r => {
    return `${r.userId}\t${r.jalaliDate}\t${r.time}:00\t1\t${r.status}`;
  });
  return lines.join('\r\n');
}

/**
 * Web Dashboard HTML
 */
function getDashboardHtml(defaultIp, defaultPort) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>داشبورد پل محلی Node.js: دستگاه XFace 60 N (ZMM510)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { font-family: Tahoma, Segoe UI, sans-serif; background: #0b1120; color: #f8fafc; padding: 25px; margin: 0; direction: rtl; }
    .container { max-width: 1000px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4); }
    h1 { color: #f43f5e; font-size: 20px; margin-top: 0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
    .badge-node { background: #22c55e25; color: #4ade80; border: 1px solid #22c55e50; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: normal; }
    .desc { font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
    .form-group { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
    label { font-size: 13px; color: #cbd5e1; font-weight: bold; }
    input { background: #0f172a; border: 1px solid #475569; color: #fff; padding: 10px 14px; border-radius: 10px; font-family: monospace; font-size: 14px; outline: none; }
    input:focus { border-color: #38bdf8; }
    button { background: #e11d48; color: white; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: bold; font-family: inherit; font-size: 13px; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
    button:hover { background: #be123c; transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    .btn-secondary { background: #2563eb; }
    .btn-secondary:hover { background: #1d4ed8; }
    .btn-emerald { background: #059669; }
    .btn-emerald:hover { background: #047857; }
    .btn-slate { background: #475569; }
    .btn-slate:hover { background: #334155; }
    #statusResult { padding: 14px 18px; border-radius: 10px; font-size: 13px; font-weight: bold; margin-top: 14px; display: none; line-height: 1.6; }
    .success-box { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); display: block !important; }
    .error-box { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); display: block !important; }
    .info-box { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); display: block !important; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { border: 1px solid #334155; padding: 10px 12px; text-align: center; }
    th { background: #0f172a; color: #94a3b8; font-weight: bold; }
    tr:nth-child(even) { background: rgba(15, 23, 42, 0.5); }
    tr:hover { background: rgba(51, 65, 85, 0.5); }
    .badge { padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
    .badge-in { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-out { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
    .quick-tips { background: #0f172a; border-radius: 12px; padding: 16px; font-size: 12px; color: #94a3b8; line-height: 1.8; border-right: 4px solid #38bdf8; margin-top: 20px; }
    .quick-tips strong { color: #f1f5f9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>
        <span>پل ارتباطی پیشرفته Node.js: دستگاه XFace 60 N (ZMM510)</span>
        <span class="badge-node">Node.js Engine (پورت 5005)</span>
      </h1>
      <p class="desc">
        این پل ارتباطی محلی بدون نیاز به نرم‌افزار واسطه، مستقیماً پروتکل TCP پلتفرم سخت‌افزاری ZMM510 را در پورت ۴۳۷۰ اجرا کرده و داده‌های تردد را به سامانه حسابداری منتقل می‌کند.
      </p>

      <div class="form-group">
        <label>آدرس آی‌پی دستگاه (وای‌فای):</label>
        <input type="text" id="devIp" value="${defaultIp}" style="width: 160px; text-align: center;">
        
        <label>پورت ارتباطی:</label>
        <input type="text" id="devPort" value="${defaultPort}" style="width: 80px; text-align: center;">

        <button onclick="checkStatus()">
          <span>۱. تست ارتباط و وضعیت دستگاه</span>
        </button>
        <button onclick="fetchLogs()" class="btn-secondary">
          <span>۲. تخلیه زنده ترددهای دستگاه</span>
        </button>
        <button onclick="downloadDat()" class="btn-emerald">
          <span>۳. دانلود فایل استاندارد DAT</span>
        </button>
      </div>

      <div id="statusResult"></div>

      <div class="quick-tips">
        <strong>راهنمای رفع سریع مشکل اتصال و عدم تطابق اطلاعات:</strong><br>
        ۱. در صفحه لمسی دستگاه XFace 60 N به منوی <b>ارتباطات ◄ شبکه / وای‌فای (Comm. ◄ Wi-Fi)</b> رفته و آی‌پی دقیق نمایش داده شده را در کادر بالا وارد فرمایید.<br>
        ۲. در بخش <b>ارتباطات ◄ تنظیمات پیشرفته</b> مطمئن شوید که <b>کلید ارتباط (Comm Key)</b> روی مقدار <b>0</b> قرار دارد.<br>
        ۳. پس از تخلیه زنده رکوردها با دکمه شماره ۲، می‌توانید دکمه <b>«کپی متن JSON»</b> را بزنید و در برنامه اصلی، در تب <b>«چسباندن متن ترددها»</b> مستقیماً پیست نمایید.
      </div>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <h3 style="margin: 0; font-size: 16px;">
          رکوردهای تردد دریافت شده از حافظه سخت‌افزاری (<span id="logCount" style="color: #38bdf8;">۰</span> تردد)
        </h3>
        <div style="display: flex; gap: 8px;">
          <button onclick="copyJsonLogs()" class="btn-slate">کپی متن JSON جهت انتقال به سامانه</button>
        </div>
      </div>

      <div style="overflow-x: auto; max-height: 480px; margin-top: 15px;">
        <table id="logsTable">
          <thead>
            <tr>
              <th>ردیف</th>
              <th>کد پرسنلی در دستگاه</th>
              <th>تاریخ شمسی</th>
              <th>ساعت تردد</th>
              <th>نوع ثبت</th>
              <th>روش احراز هویت</th>
            </tr>
          </thead>
          <tbody id="tableBody">
            <tr>
              <td colspan="6" style="color: #64748b; padding: 30px;">
                هنوز ترددی تخلیه نشده است. دکمه «۲. تخلیه زنده ترددهای دستگاه» را بزنید.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    let globalLogs = [];

    function showStatus(text, type = 'info') {
      const el = document.getElementById('statusResult');
      el.className = type + '-box';
      el.innerHTML = text;
      el.style.display = 'block';
    }

    async function checkStatus() {
      const ip = document.getElementById('devIp').value.trim();
      const port = document.getElementById('devPort').value.trim();
      showStatus('درحال بررسی و اتصال سوکت به دستگاه ' + ip + ':' + port + '...', 'info');

      try {
        const res = await fetch('/status?ip=' + encodeURIComponent(ip) + '&port=' + encodeURIComponent(port));
        const data = await res.json();
        if (data.status === 'online') {
          showStatus('✔ ارتباط با دستگاه XFace 60 N با موفقیت برقرار شد!<br>' +
            'مدل: <b>' + (data.model || 'XFace 60 N') + '</b> | ' +
            'پلتفرم: <b>' + (data.platform || 'ZMM510') + '</b> | ' +
            'سریال نامبر: <b>' + (data.serialNumber || 'تأیید شد') + '</b> | ' +
            'تعداد پرسنل: <b>' + (data.userCount || '۰') + ' نفر</b> | ' +
            'نسخه نرم‌افزار: <b>' + (data.firmware || 'Linux ZMM510') + '</b>', 'success');
        } else {
          showStatus('✖ خطا در اتصال: ' + (data.error || 'دستگاه پاسخ نداد'), 'error');
        }
      } catch (err) {
        showStatus('✖ خطا در ارتباط با سرور پل ارتباطی: ' + err.message, 'error');
      }
    }

    async function fetchLogs() {
      const ip = document.getElementById('devIp').value.trim();
      const port = document.getElementById('devPort').value.trim();
      const tbody = document.getElementById('tableBody');
      showStatus('درحال خواندن رکوردهای تردد از حافظه دستگاه XFace 60 N...', 'info');
      tbody.innerHTML = '<tr><td colspan="6" style="color: #38bdf8; padding: 25px;">درحال تخلیه داده‌ها از دستگاه...</td></tr>';

      try {
        const res = await fetch('/logs?ip=' + encodeURIComponent(ip) + '&port=' + encodeURIComponent(port));
        const data = await res.json();

        if (data.status === 'error') {
          showStatus('✖ خطا در تخلیه اطلاعات: ' + data.error, 'error');
          tbody.innerHTML = '<tr><td colspan="6" style="color: #f87171; padding: 25px;">خطا: ' + data.error + '</td></tr>';
          return;
        }

        if (data.logs && Array.isArray(data.logs)) {
          globalLogs = data.logs;
          document.getElementById('logCount').innerText = data.logs.length;
          tbody.innerHTML = '';

          if (data.logs.length === 0) {
            showStatus('اتصال برقرار شد اما حافظه تردد دستگاه در حال حاضر خالی است.', 'info');
            tbody.innerHTML = '<tr><td colspan="6" style="color: #f59e0b; padding: 25px;">هیچ رکوردی در حافظه دستگاه یافت نشد.</td></tr>';
            return;
          }

          showStatus('✔ تعداد ' + data.logs.length + ' رکورد تردد با موفقیت از دستگاه تخلیه گردید.', 'success');
          data.logs.forEach((log, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (idx + 1) + '</td>' +
              '<td style="font-weight: bold; color: #38bdf8;">' + log.userId + '</td>' +
              '<td>' + log.jalaliDate + '</td>' +
              '<td style="color: #f43f5e; font-weight: bold;">' + log.time + '</td>' +
              '<td><span class="badge ' + (log.status === 0 ? 'badge-in' : 'badge-out') + '">' + (log.status === 0 ? 'ورود' : 'خروج') + '</span></td>' +
              '<td>تشخیص چهره هوشمند XFace 60 N</td>';
            tbody.appendChild(tr);
          });
        }
      } catch (err) {
        showStatus('✖ خطا در ارتباط: ' + err.message, 'error');
        tbody.innerHTML = '<tr><td colspan="6" style="color: #f87171; padding: 25px;">خطا: ' + err.message + '</td></tr>';
      }
    }

    function downloadDat() {
      const ip = document.getElementById('devIp').value.trim();
      const port = document.getElementById('devPort').value.trim();
      window.open('/download_dat?ip=' + encodeURIComponent(ip) + '&port=' + encodeURIComponent(port), '_blank');
    }

    function copyJsonLogs() {
      if (!globalLogs || globalLogs.length === 0) {
        alert('ابتدا با دکمه شماره ۲، ترددها را از دستگاه تخلیه فرمایید.');
        return;
      }
      navigator.clipboard.writeText(JSON.stringify(globalLogs, null, 2));
      alert('متن JSON ترددها در کلیپ‌بورد کپی شد! اکنون می‌توانید در سامانه حسابداری در تب «چسباندن متن ترددها» پیست نمایید.');
    }
  </script>
</body>
</html>`;
}

/**
 * Native Node.js HTTP Server (Zero-Dependency & CORS Enabled)
 */
const server = http.createServer(async (req, res) => {
  // CORS & Private Network Access Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const ip = (parsedUrl.query.ip || DEFAULT_DEVICE_IP).toString().trim();
  const port = parseInt((parsedUrl.query.port || DEFAULT_DEVICE_PORT).toString(), 10);

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHtml(DEFAULT_DEVICE_IP, DEFAULT_DEVICE_PORT));
    return;
  }

  if (pathname === '/status') {
    try {
      const data = await handleStatusRequest(ip, port);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', error: e.message }));
    }
    return;
  }

  if (pathname === '/logs') {
    try {
      const data = await handleLogsRequest(ip, port);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', error: e.message }));
    }
    return;
  }

  if (pathname === '/download_dat') {
    try {
      const datContent = await handleDownloadDatRequest(ip, port);
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename=XFace60N_Attendance.dat'
      });
      res.end(datContent);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error: ' + e.message);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log('====================================================================');
  console.log('  🚀 ZKTeco XFace 60 N (ZMM510) Advanced Node.js Bridge Server');
  console.log(`  📡 Target Device:      ${DEFAULT_DEVICE_IP}:${DEFAULT_DEVICE_PORT}`);
  console.log(`  🌐 Local Web Dashboard: http://localhost:${SERVER_PORT}`);
  console.log('====================================================================');
});
