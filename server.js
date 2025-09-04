// server.js (v2)
// ฟีเจอร์: โฟลเดอร์, ลบไฟล์/โฟลเดอร์, Auth/JWT/Role, Drag&Drop (multipart)

const express = require('express');
const multer = require('multer');
const mime = require('mime-types');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const app = express();
if (!process.env.JWT_SECRET) { console.error('FATAL: JWT_SECRET env is required'); process.exit(1); }
const PORT = process.env.PORT || 3000;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_COOKIE = 'token';

// สร้างโฟลเดอร์อัปโหลดหากยังไม่มี
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// ---------- Utilities ----------
function sanitizeSegment(name) {
  return (name || '').toString().replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
}
function sanitizePath(p) {
  return (p || '').toString().split('/').map(sanitizeSegment).filter(Boolean).join('/');
}
function safePathFromRoot(p) {
  const rel = sanitizePath(p);
  const full = path.join(UPLOAD_ROOT, rel);
  const norm = path.normalize(full);
  if (!norm.startsWith(UPLOAD_ROOT)) throw new Error('Invalid path');
  return norm;
}
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function ensureSeedAdmin() {
  if (fs.existsSync(USERS_FILE)) return;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123'; // เปลี่ยนใน production!
  const hash = bcrypt.hashSync(adminPass, 10);
  const users = [{ id: 'u1', email: adminEmail, passwordHash: hash, role: 'admin' }];
  writeUsers(users);
  console.log(`Seeded admin -> ${adminEmail} / ${adminPass}`);
}
ensureSeedAdmin();

function issueToken(user) {
  return jwt.sign({ uid: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function parseAuth(req, res, next) {
  const token = req.cookies[TOKEN_COOKIE];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore */ }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    next();
  };
}
function iconFor(mimeType) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎞️';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) return '📝';
  return '📦';
}
function canWriteRole(role) {
  return role === 'admin' || role === 'uploader';
}

// ---------- Multer (upload) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = (req.query.dir || req.body.dir || '').toString();
    const base = safePathFromRoot(dir);
    fs.mkdirSync(base, { recursive: true });
    cb(null, base);
  },
  filename: (req, file, cb) => {
    const orig = sanitizeSegment(file.originalname);
    cb(null, orig || `file-${Date.now()}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- App Middlewares ----------
app.use(helmet());

// ---------- CORS (allow-list) ----------
const DEFAULT_ORIGINS = ['http://localhost:3000','http://127.0.0.1:3000'];
const ORIGIN_ALLOW_LIST = (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(x=>x.trim()).filter(Boolean) : DEFAULT_ORIGINS);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // allow same-origin / curl
    if (ORIGIN_ALLOW_LIST.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(parseAuth);
app.use(express.static(path.join(__dirname, 'public')));
// ไม่เสิร์ฟ /uploads แบบ static เพื่อควบคุมผ่าน API เท่านั้น

// ---------- Rate Limits ----------
const loginLimiter  = rateLimit({ windowMs: 10 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

// ---------- Auth APIs ----------
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email/password required' });
  const users = readUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.passwordHash)) {
    return res.status(400).json({ ok: false, error: 'Invalid credentials' });
  }
  const token = issueToken(u);
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json({ ok: true, user: { email: u.email, role: u.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: { email: req.user.email, role: req.user.role } });
});

app.post('/api/auth/register', requireRole('admin'), (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ ok: false, error: 'email/password/role required' });
  if (!['admin', 'uploader', 'viewer'].includes(role)) return res.status(400).json({ ok: false, error: 'invalid role' });

  const users = readUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'email already exists' });
  }
  const id = 'u' + (users.length + 1);
  const passwordHash = bcrypt.hashSync(password, 10);
  users.push({ id, email, passwordHash, role });
  writeUsers(users);
  res.json({ ok: true });
});

// ---------- Folder APIs ----------
app.post('/api/folders', requireRole('admin', 'uploader'), (req, res) => {
  const dir = (req.query.dir || req.body.dir || '').toString();
  try {
    const base = safePathFromRoot(dir);
    fs.mkdirSync(base, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.delete('/api/folders', requireRole('admin'), (req, res) => {
  const dir = (req.query.dir || req.body.dir || '').toString();
  try {
    const base = safePathFromRoot(dir);
    if (!fs.existsSync(base)) return res.json({ ok: true });
    fs.rmSync(base, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

// ---------- Files APIs ----------
app.get('/api/files', (req, res) => {
  const { dir = '' } = req.query || {};
  try {
    const base = safePathFromRoot(dir);
    if (!fs.existsSync(base)) return res.json({ ok: true, folders: [], files: [] });

    const entries = fs.readdirSync(base, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => {
        const stat = fs.statSync(path.join(base, e.name));
        return {
          name: e.name,
          isDir: e.isDirectory(),
          size: e.isFile() ? stat.size : 0,
          mtime: stat.mtimeMs
        };
      });

    const folders = entries.filter(e => e.isDir).map(e => ({ name: e.name, path: [dir, e.name].filter(Boolean).join('/') }));
    const files = entries.filter(e => !e.isDir).map(f => {
      const rel = [dir, f.name].filter(Boolean).join('/');
      return {
        name: f.name,
        path: rel,
        size: f.size,
        type: mime.lookup(f.name) || 'application/octet-stream',
        icon: iconFor(mime.lookup(f.name) || 'application/octet-stream'),
        previewUrl: `/api/file/preview?path=${encodeURIComponent(rel)}`,
        downloadUrl: `/api/file/download?path=${encodeURIComponent(rel)}`
      };
    });

    res.json({ ok: true, folders, files });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.post('/api/upload', uploadLimiter, requireRole('admin', 'uploader'), upload.array('files', 20), (req, res) => {
  const dir = (req.query.dir || req.body.dir || '').toString();
  const uploaded = (req.files || []).map(f => {
    const rel = [dir, f.filename].filter(Boolean).join('/');
    return {
      filename: f.filename,
      path: rel,
      size: f.size,
      type: mime.lookup(f.filename) || 'application/octet-stream'
    };
  });
  res.json({ ok: true, uploaded });
});

app.delete('/api/files', requireRole('admin', 'uploader'), (req, res) => {
  const p = (req.query.path || req.body.path || '').toString();
  try {
    const full = safePathFromRoot(p);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

// Preview: inline เฉพาะชนิดที่ปลอดภัยพอสมควร
const INLINE_SAFE = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'application/pdf','text/plain','application/json','text/csv','text/markdown'
]);

app.get('/api/file/preview', (req, res) => {
  const p = (req.query.path || '').toString();
  try {
    const full = safePathFromRoot(p);
    if (!fs.existsSync(full)) return res.status(404).send('Not found');
    const type = mime.lookup(full) || 'application/octet-stream';
    if (!INLINE_SAFE.has(type)) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', type);
    fs.createReadStream(full).pipe(res);
  } catch {
    res.status(400).send('Invalid path');
  }
});

app.get('/api/file/download', (req, res) => {
  const p = (req.query.path || '').toString();
  try {
    const full = safePathFromRoot(p);
    if (!fs.existsSync(full)) return res.status(404).send('Not found');
    res.download(full);
  } catch {
    res.status(400).send('Invalid path');
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`File Vault server running on http://localhost:${PORT}`);
});
