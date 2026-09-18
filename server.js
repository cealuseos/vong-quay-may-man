const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'round-data.json');
const ADMIN_USER = 'vtclonefootball';
const ADMIN_HASH = 'b6ee0a839a49003d499bbcd2cabc29017dbcd762f802e33d92037145073ffb56';
const adminTokens = new Set();
const defaultState = { entries: [], min: 1, max: 200, endsAt: null, winner: null, prizeImage: null, promoImage: null, promoUrl: '' };

function state() { let current; try { current = { ...defaultState, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch { current = { ...defaultState }; } if (current.endsAt && !current.winner && Date.now() >= current.endsAt && current.entries.length) { current.winner = current.entries[Math.floor(Math.random() * current.entries.length)]; current.endsAt = Date.now(); save(current); } return current; }
function save(value) { fs.writeFileSync(DATA_FILE, JSON.stringify(value, null, 2)); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4_500_000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Dữ liệu không hợp lệ')); } }); }); }
function isAdmin(req) { return adminTokens.has(req.headers['x-admin-token']); }
function type(file) { return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.css':'text/css' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, state());
    if (url.pathname === '/api/join' && req.method === 'POST') { const { name, number, social } = await body(req); const s = state(), n = Number(number), clean = String(name || '').trim().slice(0, 32), contact = String(social || '').trim().slice(0, 200); if (!clean || !Number.isInteger(n) || n < s.min || n > s.max) return json(res, 400, { error:'Số hoặc tên chưa hợp lệ.' }); if (contact && !/^https?:\/\//i.test(contact)) return json(res, 400, { error:'Link liên hệ chưa hợp lệ.' }); if (s.winner) return json(res, 409, { error:'Vòng quay đã kết thúc.' }); if (s.entries.some(x => x.number === n)) return json(res, 409, { error:'Số này đã có người chọn.' }); if (s.entries.some(x => x.name.toLowerCase() === clean.toLowerCase())) return json(res, 409, { error:'Mỗi người chỉ chọn một số.' }); s.entries.push({ name:clean, number:n, social:contact }); s.entries.sort((a,b)=>a.number-b.number); save(s); return json(res, 201, s); }
    if (url.pathname === '/api/admin/login' && req.method === 'POST') { const { username, password } = await body(req); const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex'); if (username !== ADMIN_USER || hash !== ADMIN_HASH) return json(res, 401, { error:'Tài khoản hoặc mật khẩu chưa đúng.' }); const token = crypto.randomBytes(32).toString('hex'); adminTokens.add(token); return json(res, 200, { token }); }
    if (!isAdmin(req) && url.pathname.startsWith('/api/admin/')) return json(res, 403, { error:'Cần quyền quản trị.' });
    if (url.pathname === '/api/admin/config' && req.method === 'POST') { const d = await body(req), s = state(); const min=Number(d.min), max=Number(d.max), seconds=Number(d.seconds); if (!Number.isInteger(min)||!Number.isInteger(max)||min>max||seconds<0) return json(res,400,{error:'Cấu hình không hợp lệ.'}); s.min=min;s.max=max;s.endsAt=Date.now()+seconds*1000;save(s);return json(res,200,s); }
    if (url.pathname === '/api/admin/spin' && req.method === 'POST') { const s=state(); if (!s.entries.length) return json(res,400,{error:'Chưa có người chơi.'}); s.winner=s.entries[Math.floor(Math.random()*s.entries.length)];s.endsAt=Date.now();save(s);return json(res,200,s); }
    if (url.pathname === '/api/admin/reset' && req.method === 'POST') { const s=state();s.entries=[];s.winner=null;s.endsAt=null;save(s);return json(res,200,s); }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, ''); const file = path.resolve(ROOT, relative); if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res,404,{error:'Không tìm thấy trang.'}); res.writeHead(200,{'Content-Type':type(file),'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);
  } catch (error) { json(res, 500, { error:error.message || 'Lỗi máy chủ.' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Lucky draw server running on port ${PORT}`));
