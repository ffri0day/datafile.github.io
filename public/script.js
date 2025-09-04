// public/script.js (v2) — auth/roles, โฟลเดอร์, ลบไฟล์/โฟลเดอร์, drag&drop, ปุ่มเข้าสู่ระบบลอย

const fileRows = document.getElementById('fileRows');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('search');

const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const btnUpload = document.getElementById('btnUpload');
const statusEl = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

const modal = document.getElementById('modal');
const modalBody = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
const modalClose = document.getElementById('modalClose');

const breadcrumbs = document.getElementById('breadcrumbs');
const newFolderName = document.getElementById('newFolderName');
const btnCreateFolder = document.getElementById('btnCreateFolder');
const btnDeleteFolder = document.getElementById('btnDeleteFolder');

const btnOpenLogin = document.getElementById('btnOpenLogin');
const loginModal = document.getElementById('loginModal');
const btnCloseLogin = document.getElementById('btnCloseLogin');
const btnDoLogin = document.getElementById('btnDoLogin');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const authBox = document.getElementById('authBox');

let me = null;
let currentDir = '';

function humanSize(n) {
  if (!n && n !== 0) return '';
  const u = ['B','KB','MB','GB'];
  let i = 0, x = n;
  while (x >= 1024 && i < u.length-1) { x/=1024; i++; }
  return x.toFixed(x<10 && i>0 ? 1 : 0) + ' ' + u[i];
}
function iconFor(type) {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎞️';
  if (type.startsWith('audio/')) return '🎵';
  if (type === 'application/pdf') return '📄';
  if (type.includes('zip') || type.includes('compressed')) return '🗜️';
  if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) return '📝';
  return '📦';
}
function canWrite() {
  return me && (me.role === 'admin' || me.role === 'uploader');
}
function isAdmin() {
  return me && me.role === 'admin';
}
function joinPath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

// ---------- Login modal open/close ----------
function openLogin(open) {
  if (!loginModal) return;
  if (open) { loginModal.classList.remove('hidden'); loginModal.classList.add('flex'); }
  else { loginModal.classList.add('hidden'); loginModal.classList.remove('flex'); }
}
btnOpenLogin?.addEventListener('click', () => openLogin(true));
btnCloseLogin?.addEventListener('click', () => openLogin(false));

// ---------- Auth UI ----------
async function refreshMe() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  me = data.user;
  renderAuth();
}
function renderAuth() {
  authBox.innerHTML = '';
  if (!me) {
    const b = document.createElement('button');
    b.textContent = 'เข้าสู่ระบบ';
    b.className = 'btn btn-outline text-sm px-3 py-2';
    b.addEventListener('click', () => openLogin(true));
    authBox.appendChild(b);
    btnOpenLogin?.classList.remove('hidden');
  } else {
    const span = document.createElement('span');
    span.textContent = `${me.email} (${me.role})`;
    span.className = 'muted text-sm';
    authBox.appendChild(span);

    const out = document.createElement('button');
    out.textContent = 'ออกจากระบบ';
    out.className = 'btn btn-outline text-sm px-3 py-2';
    out.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      me = null;
      renderAuth();
      await refreshMe();
      await fetchFiles();
    });
    authBox.appendChild(out);
    btnOpenLogin?.classList.add('hidden');
  }
  updateControls();
}

// ---------- Do login ----------
btnDoLogin?.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) return alert('กรอกอีเมล/รหัสผ่าน');
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.ok) {
    loginEmail.value = ''; loginPassword.value = '';
    openLogin(false);
    await refreshMe();
  } else {
    alert(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
  }
});

// ---------- Folder navigation ----------
function renderBreadcrumbs() {
  const parts = currentDir.split('/').filter(Boolean);
  const frag = document.createDocumentFragment();

  const rootLink = document.createElement('button');
  rootLink.textContent = 'Root';
  rootLink.className = 'text-slate-900 hover:underline';
  rootLink.addEventListener('click', async () => { currentDir = ''; await fetchFiles(); });
  frag.appendChild(rootLink);

  let accum = '';
  for (const p of parts) {
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    frag.appendChild(sep);

    accum = joinPath(accum, p);
    const b = document.createElement('button');
    b.textContent = p;
    b.addEventListener('click', async () => { currentDir = accum; await fetchFiles(); });
    frag.appendChild(b);
  }

  breadcrumbs.innerHTML = '';
  breadcrumbs.appendChild(frag);
}

async function fetchFiles() {
  const qs = new URLSearchParams({ dir: currentDir }).toString();
  const res = await fetch('/api/files?' + qs);
  const data = await res.json();
  if (!data.ok) return alert(data.error || 'โหลดไฟล์ไม่สำเร็จ');

  const q = (searchInput.value || '').toLowerCase();
  const files = (data.files || []).filter(f => !q || f.name.toLowerCase().includes(q));
  renderFiles(data.folders || [], files);
  renderBreadcrumbs();
  updateControls();
}

function renderFiles(folders, files) {
  fileRows.innerHTML = '';
  const frag = document.createDocumentFragment();

  // folders
  for (const f of folders) {
    const tr = document.createElement('tr');

    const c0 = document.createElement('td'); c0.textContent = '📁'; tr.appendChild(c0);
    const c1 = document.createElement('td');
    const name = document.createElement('button');
    name.className = 'link';
    name.textContent = f.name;
    name.addEventListener('click', async () => { currentDir = f.path; await fetchFiles(); });
    c1.appendChild(name); tr.appendChild(c1);

    const c2 = document.createElement('td'); c2.textContent = '-'; tr.appendChild(c2);
    const c3 = document.createElement('td'); c3.textContent = 'folder'; tr.appendChild(c3);
    const c4 = document.createElement('td'); c4.textContent = '-'; tr.appendChild(c4);

    frag.appendChild(tr);
  }

  // files
  for (const f of files) {
    const tr = document.createElement('tr');

    const c0 = document.createElement('td'); c0.textContent = iconFor(f.type); tr.appendChild(c0);
    const c1 = document.createElement('td');
    const a = document.createElement('a');
    a.textContent = f.name;
    a.href = f.downloadUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    c1.appendChild(a); tr.appendChild(c1);

    const c2 = document.createElement('td'); c2.textContent = humanSize(f.size); tr.appendChild(c2);
    const c3 = document.createElement('td'); c3.textContent = f.type; tr.appendChild(c3);

    const c4 = document.createElement('td');
    const preview = document.createElement('button');
    preview.className = 'btn btn-outline';
    preview.textContent = 'ดู';
    preview.addEventListener('click', () => openPreview(f));
    c4.appendChild(preview);

    const del = document.createElement('button');
    del.className = 'btn btn-outline';
    del.textContent = 'ลบ';
    del.addEventListener('click', async () => {
      if (!confirm(`ลบไฟล์นี้?\n${f.path}`)) return;
      const qs = new URLSearchParams({ path: f.path }).toString();
      const res = await fetch('/api/files?' + qs, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) return alert(data.error || 'ลบไฟล์ไม่สำเร็จ');
      await fetchFiles();
    });
    c4.appendChild(del);

    tr.appendChild(c4);

    frag.appendChild(tr);
  }

  fileRows.appendChild(frag);
  emptyState.classList.toggle('hidden', folders.length + files.length > 0);
}

function openPreview(file) {
  modalTitle.textContent = file.name;
  modalBody.innerHTML = '';

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = file.previewUrl;
    img.style.maxWidth = '100%';
    modalBody.appendChild(img);
  } else if (file.type === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = file.previewUrl;
    iframe.className = 'w-full h-[75vh]';
    modalBody.appendChild(iframe);
  } else if (file.type.startsWith('text/') || file.type.includes('json') || file.type.includes('xml')) {
    fetch(file.previewUrl).then(r => r.text()).then(text => {
      const pre = document.createElement('pre');
      pre.className = 'p-4 whitespace-pre-wrap text-sm';
      pre.textContent = text;
      modalBody.appendChild(pre);
    });
  } else {
    const p = document.createElement('p');
    p.className = 'p-4';
    p.textContent = 'ไฟล์นี้ดาวน์โหลดเพื่อดูได้';
    const a = document.createElement('a');
    a.href = file.downloadUrl; a.textContent = 'ดาวน์โหลด';
    a.className = 'btn btn-primary'; a.style.marginLeft = '8px';
    modalBody.appendChild(p); modalBody.appendChild(a);
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
modalClose?.addEventListener('click', () => {
  modal.classList.add('hidden'); modal.classList.remove('flex');
});

// ---------- Search ----------
searchInput?.addEventListener('input', () => fetchFiles());

// ---------- Upload ----------
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files?.length) {
    fileInput.files = e.dataTransfer.files;
  }
});

btnUpload?.addEventListener('click', async () => {
  if (!fileInput.files || fileInput.files.length === 0) return alert('เลือกไฟล์ก่อน');
  const fd = new FormData();
  [...fileInput.files].forEach(f => fd.append('files', f));
  fd.append('dir', currentDir);

  progressWrap.classList.remove('hidden'); progressBar.style.width = '0%'; progressText.textContent = '0%';
  statusEl.textContent = 'กำลังอัปโหลด...';

  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded * 100 / e.total);
      progressBar.style.width = pct + '%';
      progressText.textContent = pct + '%';
    }
  });
  xhr.onreadystatechange = async () => {
    if (xhr.readyState === 4) {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (data.ok) {
          statusEl.textContent = `อัปโหลดสำเร็จ ${data.uploaded?.length || 0} ไฟล์`;
          fileInput.value = '';
          await fetchFiles();
        } else {
          statusEl.textContent = data.error || 'อัปโหลดไม่สำเร็จ';
        }
      } catch {
        statusEl.textContent = 'อัปโหลดไม่สำเร็จ';
      } finally {
        setTimeout(() => { progressWrap.classList.add('hidden'); }, 300);
      }
    }
  };
  xhr.open('POST', '/api/upload');
  xhr.send(fd);
});

// ---------- Folder create/delete ----------
btnCreateFolder?.addEventListener('click', async () => {
  const name = newFolderName.value.trim();
  if (!name) return alert('กรอกชื่อโฟลเดอร์');
  const dir = joinPath(currentDir, name);
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ dir })
  });
  const data = await res.json();
  if (!data.ok) return alert(data.error || 'สร้างโฟลเดอร์ไม่สำเร็จ');
  newFolderName.value = '';
  await fetchFiles();
});

btnDeleteFolder?.addEventListener('click', async () => {
  const p = currentDir;
  if (!p) return alert('โฟลเดอร์ Root ลบไม่ได้');
  if (!isAdmin()) return alert('เฉพาะผู้ดูแลระบบเท่านั้น');
  if (!confirm(`ลบโฟลเดอร์ทั้งก้อน?\n${p}`)) return;
  const qs = new URLSearchParams({ dir: p }).toString();
  const res = await fetch('/api/folders?' + qs, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) return alert(data.error || 'ลบโฟลเดอร์ไม่สำเร็จ');
  currentDir = '';
  await fetchFiles();
});

// ---------- Controls state ----------
function updateControls() {
  const writable = canWrite();
  if (fileInput) fileInput.disabled = !writable;
  if (btnUpload) btnUpload.disabled = !writable;
  if (btnCreateFolder) btnCreateFolder.disabled = !writable;
  if (btnDeleteFolder) btnDeleteFolder.disabled = !(isAdmin() && currentDir);
}

// ---------- Init ----------
(async function init() {
  await refreshMe();
  await fetchFiles();
})();
