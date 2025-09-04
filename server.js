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

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret-change-me';
const TOKEN_COOKIE = 'token';

// สร้างโฟลเดอร์อัปโหลดหากยังไม่มี
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// ---------- Utilities ----------
function sanitizeSegment(name) {
  return (name || '').toString().replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
}
function sanitizeFilename(name) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_');
  return base || 'file';
}
function safePathFromRoot(relPath = '') {
  const parts = relPath.split('/').filter(Boolean).map(sanitizeSegment);
  const joined = path.join(UPLOAD_ROOT, ...parts);
  if (!joined.startsWith(UPLOAD_ROOT)) throw new Error('Invalid path');
  return joined;
}
function splitPathAndName(p) {
  const clean = (p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = clean.lastIndexOf('/');
  if (idx === -1) return { dir: '', name: clean };
  return { dir: clean.slice(0, idx), name: clean.slice(idx + 1) };
}

// ---------- Users / Auth ----------
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

// ---------- Multer storage (โฟลเดอร์ย่อย) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const rel = (req.query.dir || req.body.dir || '').toString();
    let dest;
    try {
      dest = safePathFromRoot(rel);
    } catch {
      return cb(new Error('Invalid upload path'));
    }
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const cleaned = sanitizeFilename(file.originalname);
    const rel = (req.query.dir || req.body.dir || '').toString();
    const dest = safePathFromRoot(rel);
    const ext = path.extname(cleaned);
    const base = path.basename(cleaned, ext);
    let candidate = cleaned;
    let i = 1;
    while (fs.existsSync(path.join(dest, candidate))) {
      candidate = `${base} (${i})${ext}`;
      i++;
    }
    cb(null, candidate);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- App Middlewares ----------
app.use(helmet());
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(parseAuth);
app.use(express.static(path.join(__dirname, 'public')));
// ไม่เสิร์ฟ /uploads แบบ static เพื่อควบคุมผ่าน API เท่านั้น

// ---------- Auth APIs ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email/password required' });
  const users = readUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.passwordHash)) {
    return res.status(400).json({ ok: false, error: 'Invalid credentials' });
  }
  const token = issueToken(u);
  res.cookie(TOKEN_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 24 * 3600 * 1000 });
  res.json({ ok: true, user: { email: u.email, role: u.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: { email: req.user.email, role: req.user.role } });
});

// เฉพาะ admin เท่านั้นที่สร้างผู้ใช้ใหม่ได้
app.post('/api/auth/register', requireRole('admin'), (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) return res.status(400).json({ ok: false, error: 'email/password/role required' });
  if (!['admin', 'uploader', 'viewer'].includes(role)) return res.status(400).json({ ok: false, error: 'invalid role' });

  const users = readUsers();
  if (users.some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'Email exists' });
  }
  const id = 'u' + (users.length + 1);
  const passwordHash = bcrypt.hashSync(password, 10);
  users.push({ id, email, passwordHash, role });
  writeUsers(users);
  res.json({ ok: true });
});

// ---------- Folder & File APIs ----------
app.post('/api/folders', requireRole('admin', 'uploader'), (req, res) => {
  const { dir = '', name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  const safeName = sanitizeSegment(name);
  try {
    const base = safePathFromRoot(dir);
    const target = path.join(base, safeName);
    if (fs.existsSync(target)) return res.status(409).json({ ok: false, error: 'Folder exists' });
    fs.mkdirSync(target, { recursive: true });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.delete('/api/folders', requireRole('admin'), (req, res) => {
  const { dir = '' } = req.query || {};
  try {
    const full = safePathFromRoot(dir);
    if (full === UPLOAD_ROOT) return res.status(400).json({ ok: false, error: 'Cannot delete root' });
    if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.rmSync(full, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.get('/api/files', (req, res) => {
  const { dir = '' } = req.query || {};
  try {
    const base = safePathFromRoot(dir);
    if (!fs.existsSync(base)) return res.json({ ok: true, folders: [], files: [] });

    const entries = fs.readdirSync(base, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'));
    const folders = entries.filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: [dir, e.name].filter(Boolean).join('/') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const files = entries.filter(e => e.isFile())
      .map(e => {
        const relFilePath = [dir, e.name].filter(Boolean).join('/');
        const full = path.join(base, e.name);
        const st = fs.statSync(full);
        const type = mime.lookup(e.name) || 'application/octet-stream';
        return {
          name: e.name,
          path: relFilePath,
          size: st.size,
          mtime: st.mtime,
          type,
          previewUrl: `/api/file/preview?path=${encodeURIComponent(relFilePath)}`,
          downloadUrl: `/api/file/download?path=${encodeURIComponent(relFilePath)}`
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ ok: true, folders, files });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.post('/api/upload', requireRole('admin', 'uploader'), upload.array('files', 20), (req, res) => {
  const dir = (req.query.dir || req.body.dir || '').toString();
  const uploaded = (req.files || []).map(f => {
    const rel = [dir, f.filename].filter(Boolean).join('/');
    return {
      name: f.filename,
      path: rel,
      size: f.size,
      type: mime.lookup(f.filename) || 'application/octet-stream',
      previewUrl: `/api/file/preview?path=${encodeURIComponent(rel)}`,
      downloadUrl: `/api/file/download?path=${encodeURIComponent(rel)}`,
      uploadedAt: new Date().toISOString()
    };
  });
  res.json({ ok: true, files: uploaded });
});

app.delete('/api/files', requireRole('admin', 'uploader'), (req, res) => {
  const { path: rel } = req.query || {};
  if (!rel) return res.status(400).json({ ok: false, error: 'path required' });
  try {
    const { dir, name } = splitPathAndName(rel);
    const base = safePathFromRoot(dir);
    const full = path.join(base, sanitizeFilename(name));
    if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Not found' });
    fs.unlinkSync(full);
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid path' });
  }
});

app.get('/api/file/preview', (req, res) => {
  const rel = (req.query.path || '').toString();
  try {
    const { dir, name } = splitPathAndName(rel);
    const base = safePathFromRoot(dir);
    const full = path.join(base, sanitizeFilename(name));
    if (!fs.existsSync(full)) return res.status(404).send('Not found');
    const type = mime.lookup(name) || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    res.sendFile(full);
  } catch {
    res.status(400).send('Invalid request');
  }
});

app.get('/api/file/download', (req, res) => {
  const rel = (req.query.path || '').toString();
  try {
    const { dir, name } = splitPathAndName(rel);
    const base = safePathFromRoot(dir);
    const full = path.join(base, sanitizeFilename(name));
    if (!fs.existsSync(full)) return res.status(404).send('Not found');
    res.download(full, name);
  } catch {
    res.status(400).send('Invalid request');
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`File Vault v2 running at http://localhost:${PORT}`);
});
