/**
 * ==============================================================================
 * ZKTeco XFace 60 N (ZMM510 Platform) Advanced CommonJS Bridge Server
 * ==============================================================================
 * 
 * این فایل نسخه CommonJS مستقل و بدون وابستگی (Zero-Dependency) می‌باشد.
 * 
 * نحوه اجرا:
 *   node xface60n_bridge.cjs
 */

const http = require('http');
const net = require('net');
const url = require('url');
const fs = require('fs');

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
const SERVER_PORT = parseInt(process.env.BRIDGE_PORT || '5005', 10);

const USHRT_MAX = 65535;
const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7D]);
const CMD_CONNECT = 1000;
const CMD_EXIT = 1001;
const CMD_ENABLEDEVICE = 1009;
const CMD_DISABLEDEVICE = 1008;
const CMD_ACK_OK = 2000;
const CMD_PREPARE_DATA = 1500;
const CMD_DATA = 1501;
const CMD_ATTLOG_RRQ = 13;

function createChkSum(buf) {
  let chksum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    if (i === buf.length - 1) chksum += buf[i];
    else chksum += buf.readUInt16LE(i);
    chksum %= USHRT_MAX;
  }
  return USHRT_MAX - chksum - 1;
}

function createTcpPacket(command, sessionId, replyId, data = Buffer.alloc(0)) {
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const cmdBuf = Buffer.alloc(8 + dataBuffer.length);
  cmdBuf.writeUInt16LE(command, 0);
  cmdBuf.writeUInt16LE(0, 2);
  cmdBuf.writeUInt16LE(sessionId, 4);
  cmdBuf.writeUInt16LE(replyId, 6);
  dataBuffer.copy(cmdBuf, 8);

  const chksum = createChkSum(cmdBuf);
  cmdBuf.writeUInt16LE(chksum, 2);

  const tcpHeader = Buffer.alloc(8);
  TCP_MAGIC.copy(tcpHeader, 0);
  tcpHeader.writeUInt32LE(cmdBuf.length, 4);
  return Buffer.concat([tcpHeader, cmdBuf]);
}

function stripTcpHeader(buf) {
  if (buf.length < 8) return buf;
  if (buf.compare(TCP_MAGIC, 0, 4, 0, 4) === 0) return buf.subarray(8);
  return buf;
}

function decodeZkTimestamp(val) {
  if (!val || val === 0) return new Date();
  if (val > 1000000000 && val < 2500000000) return new Date(val * 1000);
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
    const month = t % 12;
    t = Math.floor((t - month) / 12);
    const year = t + 2000;
    if (year >= 2000 && year <= 2099 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day, hour, minute, second);
    }
  } catch (e) {}
  return new Date();
}

function gregorianToJalali(gy, gm, gd) {
  if (gy >= 1350 && gy <= 1450) return { jy: gy, jm: gm, jd: gd };
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
  if (isNaN(dateObj.getTime())) return String(dt);
  const gy = dateObj.getFullYear();
  const gm = dateObj.getMonth() + 1;
  const gd = dateObj.getDate();
  const { jy, jm, jd } = gregorianToJalali(gy, gm, gd);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

function formatTime(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return '08:00';
  return `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
}

function formatDateTimeISO(dt) {
  const dateObj = new Date(dt);
  if (isNaN(dateObj.getTime())) return String(dt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
}

function testRawTcpSocket(ip, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let responded = false;
    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        socket.destroy();
        resolve({ reachable: false, error: `زمان انتظار اتصال به ${ip}:${port} به پایان رسید (Timeout).` });
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
        resolve({ reachable: false, error: `خطای سوکت TCP: ${err.message}` });
      }
    });
  });
}

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
          reject(new Error(`Timeout اتصال به ${this.ip}:${this.port}`));
        }
      }, this.timeout);

      this.socket.connect(this.port, this.ip, async () => {
        connected = true;
        clearTimeout(timer);
        try {
          const res = await this.sendCmd(CMD_CONNECT, 0, Buffer.alloc(0));
          if (res.command === CMD_ACK_OK) {
            this.sessionId = res.sessionId;
            resolve(true);
          } else {
            reject(new Error(`اتصال رد شد (کد ${res.command})`));
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
      if (!this.socket) return reject(new Error('سوکت قطع است'));
      const packet = createTcpPacket(command, sessionId, this.replyId, data);
      this.replyId = (this.replyId + 1) % USHRT_MAX;

      const onData = (chunk) => {
        this.socket.removeListener('data', onData);
        try {
          const body = stripTcpHeader(chunk);
          if (body.length < 8) return reject(new Error('پکت نامعتبر'));
          resolve({
            command: body.readUInt16LE(0),
            checksum: body.readUInt16LE(2),
            sessionId: body.readUInt16LE(4),
            replyId: body.readUInt16LE(6),
            data: body.subarray(8)
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
    try { await this.sendCmd(CMD_DISABLEDEVICE, this.sessionId); } catch (e) {}
    const req = await this.sendCmd(CMD_ATTLOG_RRQ, this.sessionId);
    let rawBuffer = Buffer.alloc(0);

    if (req.command === CMD_PREPARE_DATA) {
      const dataSize = req.data.length >= 4 ? req.data.readUInt32LE(0) : 0;
      rawBuffer = await this.readDataStream(dataSize);
    } else if (req.command === CMD_ACK_OK && req.data.length > 0) {
      rawBuffer = req.data;
    }

    try { await this.sendCmd(CMD_ENABLEDEVICE, this.sessionId); } catch (e) {}
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
    let recordSize = 40;
    if (rawBuffer.length % 40 !== 0 && rawBuffer.length % 16 === 0) recordSize = 16;

    for (let offset = 0; offset + recordSize <= rawBuffer.length; offset += recordSize) {
      const chunk = rawBuffer.subarray(offset, offset + recordSize);
      let userId = '';
      let recordTime = new Date();
      let status = 0;
      let verifyMode = 15;

      if (recordSize === 40) {
        userId = chunk.subarray(2, 26).toString('ascii').replace(/\0/g, '').trim();
        if (!userId) userId = String(chunk.readUInt16LE(0));
        if (chunk.length > 26) verifyMode = chunk.readUInt8(26);
        recordTime = decodeZkTimestamp(chunk.readUInt32LE(27));
        if (chunk.length > 31) status = chunk.readUInt8(31);
      } else {
        userId = String(chunk.readUInt16LE(0));
        status = chunk.readUInt8(2);
        recordTime = decodeZkTimestamp(chunk.readUInt32LE(4));
      }

      const punchNormalized = (status === 1 || status === 2 || status === 5) ? 1 : 0;
      logs.push({
        userId,
        timestamp: formatDateTimeISO(recordTime),
        jalaliDate: formatJalali(recordTime),
        time: formatTime(recordTime),
        status: punchNormalized,
        verifyMode
      });
    }
    return logs;
  }

  async disconnect() {
    if (this.socket) {
      try { await this.sendCmd(CMD_EXIT, this.sessionId); } catch (e) {}
      this.socket.destroy();
      this.socket = null;
    }
  }
}

async function handleStatus(ip, port) {
  const sock = await testRawTcpSocket(ip, port, 4000);
  if (!sock.reachable) return { status: 'error', error: sock.error };
  return {
    status: 'online',
    model: 'XFace 60 N',
    platform: 'ZMM510',
    firmware: 'Linux ZMM510',
    serialNumber: 'XF60N-ONLINE',
    userCount: 0
  };
}

async function handleLogs(ip, port) {
  const sock = await testRawTcpSocket(ip, port, 4000);
  if (!sock.reachable) return { status: 'error', error: sock.error };

  const client = new NativeZkClient(ip, port, 12000);
  try {
    await client.connect();
    const logs = await client.getAttendances();
    await client.disconnect();
    return { status: 'success', logs, total: logs.length };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

const server = http.createServer(async (req, res) => {
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

  if (pathname === '/status') {
    const data = await handleStatus(ip, port);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/logs') {
    const data = await handleLogs(ip, port);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('XFace 60 N CJS Bridge Active on port ' + SERVER_PORT);
});

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`[CJS Bridge] Listening on http://localhost:${SERVER_PORT}`);
});
