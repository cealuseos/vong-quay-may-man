const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cấu hình cổng:
// - Trên Render: Render tự động cung cấp biến môi trường PORT (ví dụ 10000).
// - Trong AI Studio: NGINX chạy ở cổng 8080 và reverse proxy vào cổng 3000.
// - Chạy cục bộ (Local): Mặc định cổng 3000.
const PORT = process.env.PORT && process.env.PORT !== '8080'
  ? Number(process.env.PORT)
  : 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'round-data.json');
const ADMIN_USER = 'vtclonefootball';
const ADMIN_HASH = 'b6ee0a839a49003d499bbcd2cabc29017dbcd762f802e33d92037145073ffb56';
const ADMIN_SECRET = 'lucky_vtclonefootball_key_2026';
const adminTokens = new Set();

function createAdminToken() {
  const payload = 'admin_' + Date.now();
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  const token = `${payload}.${sig}`;
  adminTokens.add(token);
  return token;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  if (adminTokens.has(token)) return true;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  if (sig === expected) {
    adminTokens.add(token);
    return true;
  }
  return false;
}
const defaultState = {
  roundId: 1,
  entries: [],
  min: 1,
  max: 500,
  spinDuration: 6,
  totalDuration: 300000,
  startedAt: null,
  endsAt: null,
  winner: null,
  prizeImage: null,
  promoImage: null,
  promoUrl: '',
  zaloCommunityUrl: ''
};

function state() {
  let current;
  try {
    if (fs.existsSync(DATA_FILE)) {
      current = { ...defaultState, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
      if (!current.roundId) current.roundId = 1;
      if (!current.spinDuration) current.spinDuration = 6;
      if (!current.totalDuration) current.totalDuration = 300000;
    } else {
      current = { ...defaultState };
    }
  } catch {
    current = { ...defaultState };
  }

  // Khởi tạo thời gian đếm ngược mặc định đồng bộ nếu vòng đang mở và chưa có endsAt
  if (!current.winner && !current.endsAt) {
    current.totalDuration = current.totalDuration || 300000;
    current.startedAt = Date.now();
    current.endsAt = current.startedAt + current.totalDuration;
    save(current);
  }

  if (current.endsAt && !current.winner && Date.now() >= current.endsAt) {
    if (current.entries && current.entries.length) {
      current.winner = current.entries[Math.floor(Math.random() * current.entries.length)];
      current.endsAt = Date.now();
    } else {
      current.endsAt = Date.now();
    }
    save(current);
  }
  return {
    ...current,
    serverNow: Date.now()
  };
}

function save(value) {
  try {
    const toSave = { ...value };
    delete toSave.serverNow;
    fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.error('Lỗi khi ghi dữ liệu round-data.json:', err.message);
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.serverNow === undefined) {
      value.serverNow = Date.now();
    }
  }
  res.end(JSON.stringify(value));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 15_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Dữ liệu gửi lên không đúng định dạng JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  return verifyAdminToken(req.headers['x-admin-token']);
}

function type(file) {
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.css': 'text/css; charset=utf-8'
  };
  return mimeMap[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);

  try {
    // API State
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return json(res, 200, state());
    }

    // API Tham gia chọn số
    if (url.pathname === '/api/join' && req.method === 'POST') {
      const { name, number, social, deviceId } = await body(req);
      const s = state();
      const n = Number(number);
      const clean = String(name || '').trim().slice(0, 32);
      const contact = String(social || '').trim().slice(0, 200);
      const cleanDeviceId = String(deviceId || '').trim().slice(0, 64);

      // Trích xuất địa chỉ IP của client (hỗ trợ reverse proxy headers)
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = (forwarded ? String(forwarded).split(',')[0].trim() : '') || req.socket.remoteAddress || '';

      if (!clean || !Number.isInteger(n) || n < s.min || n > s.max) {
        return json(res, 400, { error: 'Số hoặc tên người chơi chưa hợp lệ.' });
      }
      if (s.winner) {
        return json(res, 409, { error: 'Vòng quay này đã kết thúc và chọn được người thắng. Cổng chọn số đã khóa!' });
      }
      if (s.entries.some(x => x.number === n)) {
        return json(res, 409, { error: `Số ${n} đã có người chọn trước đó.` });
      }
      if (s.entries.some(x => x.name.toLowerCase() === clean.toLowerCase())) {
        return json(res, 409, { error: 'Mỗi người chơi chỉ được chọn một số.' });
      }

      // Khóa theo thiết bị (Device ID)
      if (cleanDeviceId && s.entries.some(x => x.deviceId && x.deviceId === cleanDeviceId)) {
        return json(res, 409, { error: 'Thiết bị của bạn đã chọn một số trong vòng này rồi. Mỗi thiết bị chỉ được chọn 1 số.' });
      }

      // Khóa theo địa chỉ mạng (IP) nếu có IP hợp lệ (bỏ qua localhost / internal)
      if (clientIp && clientIp !== '127.0.0.1' && clientIp !== '::1') {
        const ipCount = s.entries.filter(x => x.ip && x.ip === clientIp).length;
        if (ipCount >= 1) {
          return json(res, 409, { error: 'Mạng / Thiết bị này đã gửi lượt chọn số rồi. Vui lòng đợi vòng quay tiếp theo!' });
        }
      }

      s.entries.push({
        name: clean,
        number: n,
        social: contact,
        deviceId: cleanDeviceId,
        ip: clientIp
      });
      s.entries.sort((a, b) => a.number - b.number);
      save(s);
      return json(res, 201, s);
    }

    // API Đăng nhập quản trị
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const { username, password } = await body(req);
      const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
      if (username !== ADMIN_USER || hash !== ADMIN_HASH) {
        return json(res, 401, { error: 'Tài khoản hoặc mật khẩu quản trị chưa đúng.' });
      }
      const token = createAdminToken();
      return json(res, 200, { token });
    }

    // Kiểm tra quyền quản trị cho các endpoint /api/admin/*
    if (!isAdmin(req) && url.pathname.startsWith('/api/admin/')) {
      return json(res, 403, { error: 'Cần quyền quản trị viên để thực hiện thao tác này.' });
    }

    // API Cấu hình thời gian & khoảng số
    if (url.pathname === '/api/admin/config' && req.method === 'POST') {
      const d = await body(req);
      const s = state();
      const min = Number(d.min);
      const max = Number(d.max);
      const seconds = Number(d.seconds);

      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || seconds < 0) {
        return json(res, 400, { error: 'Cấu hình phạm vi số hoặc thời gian không hợp lệ.' });
      }

      s.min = min;
      s.max = max;
      if (d.spinDuration !== undefined) {
        const dur = Number(d.spinDuration);
        if (Number.isInteger(dur) && dur >= 2 && dur <= 60) {
          s.spinDuration = dur;
        }
      }
      s.totalDuration = seconds * 1000;
      s.startedAt = Date.now();
      s.endsAt = seconds > 0 ? (s.startedAt + s.totalDuration) : null;
      save(s);
      return json(res, 200, s);
    }

    // API Cấu hình thời gian quay số (spinDuration)
    if (url.pathname === '/api/admin/spin-duration' && req.method === 'POST') {
      const d = await body(req);
      const s = state();
      const dur = Number(d.spinDuration);
      if (!Number.isInteger(dur) || dur < 2 || dur > 60) {
        return json(res, 400, { error: 'Thời gian quay phải là số nguyên từ 2 đến 60 giây.' });
      }
      s.spinDuration = dur;
      save(s);
      return json(res, 200, s);
    }

    // API Quay ngay lập tức
    if (url.pathname === '/api/admin/spin' && req.method === 'POST') {
      const s = state();
      if (!s.entries.length) {
        return json(res, 400, { error: 'Chưa có người chơi nào đăng ký để quay thưởng.' });
      }
      s.winner = s.entries[Math.floor(Math.random() * s.entries.length)];
      s.endsAt = Date.now();
      save(s);
      return json(res, 200, s);
    }

    // API Tạo vòng quay mới (Reset)
    if (url.pathname === '/api/admin/reset' && req.method === 'POST') {
      const s = state();
      s.roundId = (s.roundId || 1) + 1;
      s.entries = [];
      s.winner = null;
      const dur = s.totalDuration || 300000;
      s.totalDuration = dur;
      s.startedAt = Date.now();
      s.endsAt = s.startedAt + dur;
      save(s);
      return json(res, 200, s);
    }

    // API Cập nhật hình ảnh giải thưởng và banner kèm liên kết, link cộng đồng Zalo
    if (url.pathname === '/api/admin/media' && req.method === 'POST') {
      const d = await body(req);
      const s = state();
      if (d.prizeImage !== undefined) s.prizeImage = d.prizeImage;
      if (d.promoImage !== undefined) s.promoImage = d.promoImage;
      if (d.promoUrl !== undefined) s.promoUrl = String(d.promoUrl || '').trim();
      if (d.zaloCommunityUrl !== undefined) s.zaloCommunityUrl = String(d.zaloCommunityUrl || '').trim();
      save(s);
      return json(res, 200, s);
    }

    // Phục vụ file tĩnh (Frontend)
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const file = path.resolve(ROOT, relative);

    // Chặn directory traversal
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
      return json(res, 403, { error: 'Truy cập bị từ chối.' });
    }

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return json(res, 404, { error: 'Không tìm thấy tệp yêu cầu.' });
    }

    res.writeHead(200, {
      'Content-Type': type(file),
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error('Server error:', error);
    json(res, 500, { error: error.message || 'Lỗi hệ thống máy chủ.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lucky draw server is running on http://0.0.0.0:${PORT}`);
});
