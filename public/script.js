// public/script.js (v2) — เพิ่ม auth/roles, โฟลเดอร์, ลบไฟล์/โฟลเดอร์, drag&drop

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

const authBox = document.getElementById('authBox');
const loginModal = document.getElementById('loginModal');
const btnCloseLogin = document.getElementById('btnCloseLogin');
const btnDoLogin = document.getElementById('btnDoLogin');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');

const breadcrumbs = document.getElementById('breadcrumbs');
const newFolderName = document.getElementById('newFolderName');
const btnCreateFolder = document.getElementById('btnCreateFolder');
const btnDeleteFolder = document.getElementById('btnDeleteFolder');

let filesCache = [];
let foldersCache = [];
let currentDir = ''; // relative path from root, '' = root
let me = null; // { email, role } | null

// ---------- Helpers ----------
function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
}
function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleString();
}
function iconFor(type) {
  if (type === 'folder') return '📂';
  if (type.startsWith('image/')) return '🖼️';
  if (type === 'application/pdf') return '📄';
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

// ---------- Auth UI ----------
async function refreshMe() {
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  me = data.user;
  renderAuth();
  toggleWriteControls();
}
function renderAuth() {
  authBox.innerHTML = '';
  if (!me) {
    const b = document.createElement('button');
    b.textContent = 'เข้าสู่ระบบ';
    b.className = 'rounded-xl bg-slate-900 text-white px-3 py-2 text-sm font-medium hover:bg-slate-700';
    b.addEventListener('click', () => openLogin(true));
    authBox.appendChild(b);
  } else {
    const span = document.createElement('span');
    span.className = 'text-sm text-slate-600';
    span.textContent = `${me.email} (${me.role})`;
    const out = document.createElement('button');
    out.textContent = 'ออกจากระบบ';
    out.className = 'rounded-xl bg-white border px-3 py-2 text-sm hover:bg-slate-50';
    out.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      me = null;
      renderAuth();
      toggleWriteControls();
    });
    authBox.append(span, out);
  }
}
function openLogin(open) {
  if (open) {
    loginModal.classList.remove('hidden');
    loginModal.classList.add('flex');
  } else {
    loginModal.classList.add('hidden');
    loginModal.classList.remove('flex');
  }
}
btnCloseLogin.addEventListener('click', () => openLogin(false));
btnDoLogin.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.ok) {
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
  rootLink.addEventListener('click', () => changeDir(''));
  frag.append(rootLink);

  let acc = '';
  parts.forEach((p, idx) => {
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    sep.className = 'text-slate-400';
    frag.append(sep);

    acc = joinPath(acc, p);
    const btn = document.createElement('button');
    btn.textContent = p;
    btn.className = 'text-slate-900 hover:underline';
    btn.addEventListener('click', () => changeDir(acc));
    frag.append(btn);
  });

  breadcrumbs.innerHTML = '';
  breadcrumbs.append(frag);
}

async function changeDir(newDir) {
  currentDir = newDir || '';
  renderBreadcrumbs();
  await fetchFiles();
  toggleWriteControls();
}

btnCreateFolder.addEventListener('click', async () => {
  const name = newFolderName.value.trim();
  if (!name) return;
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: currentDir, name })
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || 'สร้างโฟลเดอร์ไม่สำเร็จ');
    return;
  }
  newFolderName.value = '';
  await fetchFiles();
});

btnDeleteFolder.addEventListener('click', async () => {
  if (!confirm('ยืนยันการลบโฟลเดอร์นี้ทั้งหมด? (ย้อนกลับไม่ได้)')) return;
  const params = new URLSearchParams({ dir: currentDir });
  const res = await fetch('/api/folders?' + params.toString(), { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || 'ลบโฟลเดอร์ไม่สำเร็จ');
    return;
  }
  // กลับไประดับบน
  const parts = currentDir.split('/').filter(Boolean);
  parts.pop();
  await changeDir(parts.join('/'));
});

// ---------- List/Render ----------
function renderRows() {
  const q = (searchInput.value || '').toLowerCase().trim();
  fileRows.innerHTML = '';

  const folders = foldersCache.slice().filter(f => f.name.toLowerCase().includes(q));
  const files = filesCache.slice().filter(f => f.name.toLowerCase().includes(q));

  if (!folders.length && !files.length) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  // โฟลเดอร์ก่อน
  for (const d of folders) {
    const tr = document.createElement('tr');
    tr.className = 'border-b last:border-b-0';
    tr.innerHTML = `
      <td class="p-3">
        <div class="flex items-center gap-2">
          <span class="text-lg">${iconFor('folder')}</span>
          <button class="font-medium text-slate-900 hover:underline" data-action="enter-folder" data-path="${d.path}">${d.name}</button>
        </div>
      </td>
      <td class="p-3">โฟลเดอร์</td>
      <td class="p-3 text-right">—</td>
      <td class="p-3">—</td>
      <td class="p-3">
        <div class="flex items-center justify-center gap-2">
          ${isAdmin() ? `<button data-action="delete-folder" data-path="${d.path}" class="px-3 py-1.5 rounded-lg bg-white border text-sm hover:bg-slate-50">ลบ</button>` : ''}
        </div>
      </td>
    `;
    fileRows.appendChild(tr);
  }

  // ไฟล์
  for (const f of files) {
    const tr = document.createElement('tr');
    tr.className = 'border-b last:border-b-0';
    tr.innerHTML = `
      <td class="p-3">
        <div class="flex items-center gap-2">
          <span class="text-lg">${iconFor(f.type)}</span>
          <button class="font-medium text-slate-900 hover:underline" data-action="preview" data-path="${f.path}">${f.name}</button>
        </div>
      </td>
      <td class="p-3">${f.type}</td>
      <td class="p-3 text-right tabular-nums">${humanSize(f.size)}</td>
      <td class="p-3">${fmtDate(f.mtime)}</td>
      <td class="p-3">
        <div class="flex items-center justify-center gap-2">
          <a href="${f.downloadUrl}" class="px-3 py-1.5 rounded-lg bg-white border text-sm hover:bg-slate-50">ดาวน์โหลด</a>
          ${canWrite() ? `<button data-action="delete-file" data-path="${f.path}" class="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-700">ลบ</button>` : ''}
        </div>
      </td>
    `;
    fileRows.appendChild(tr);
  }
}

async function fetchFiles() {
  const params = new URLSearchParams();
  if (currentDir) params.set('dir', currentDir);
  const res = await fetch('/api/files?' + params.toString());
  const data = await res.json();
  foldersCache = data.folders || [];
  filesCache = data.files || [];
  renderRows();
}

searchInput.addEventListener('input', renderRows);

// โฟลเดอร์/ไฟล์ actions (enter/preview/delete)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'enter-folder') {
    const p = btn.dataset.path;
    await changeDir(p);
  }
  if (action === 'preview') {
    const p = btn.dataset.path;
    const file = filesCache.find(x => x.path === p);
    if (file) openPreview(file);
  }
  if (action === 'delete-file') {
    const p = btn.dataset.path;
    if (!confirm(`ลบไฟล์นี้?\n${p}`)) return;
    const qs = new URLSearchParams({ path: p }).toString();
    const res = await fetch('/api/files?' + qs, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) return alert(data.error || 'ลบไฟล์ไม่สำเร็จ');
    await fetchFiles();
  }
  if (action === 'delete-folder') {
    const p = btn.dataset.path;
    if (!confirm(`ลบโฟลเดอร์ทั้งก้อน?\n${p}`)) return;
    const qs = new URLSearchParams({ dir: p }).toString();
    const res = await fetch('/api/folders?' + qs, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) return alert(data.error || 'ลบโฟลเดอร์ไม่สำเร็จ');
    await fetchFiles();
  }
});

// ---------- Upload (select + drag & drop) ----------
function toggleWriteControls() {
  const writable = canWrite();
  fileInput.disabled = !writable;
  btnUpload.disabled = !writable;
  btnCreateFolder.disabled = !writable;
  btnDeleteFolder.disabled = !(isAdmin() && currentDir);
}

uploadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  doUpload(fileInput.files);
});

async function doUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    statusEl.textContent = 'กรุณาเลือกไฟล์';
    return;
  }
  const formData = new FormData();
  for (const f of files) formData.append('files', f);

  statusEl.textContent = 'กำลังอัปโหลด...';
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  const xhr = new XMLHttpRequest();
  const qs = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';
  xhr.open('POST', '/api/upload' + qs, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = pct + '%';
      progressText.textContent = pct + '%';
    }
  };

  xhr.onload = async () => {
    progressBar.style.width = '100%';
    progressText.textContent = '100%';
    if (xhr.status >= 200 && xhr.status < 300) {
      statusEl.textContent = 'อัปโหลดสำเร็จ ✅';
      fileInput.value = '';
      await fetchFiles();
    } else {
      try {
        const resp = JSON.parse(xhr.responseText);
        statusEl.textContent = (resp && resp.error) ? resp.error : 'อัปโหลดไม่สำเร็จ ❌';
      } catch {
        statusEl.textContent = 'อัปโหลดไม่สำเร็จ ❌';
      }
    }
    setTimeout(() => {
      progressWrap.classList.add('hidden');
      progressBar.style.width = '0%';
      progressText.textContent = '0%';
    }, 600);
  };

  xhr.onerror = () => {
    statusEl.textContent = 'เกิดข้อผิดพลาดในการอัปโหลด ❌';
    progressWrap.classList.add('hidden');
  };

  xhr.send(formData);
}

// Drag & Drop
;['dragenter','dragover'].forEach(evt =>
  dropZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('ring-2', 'ring-slate-300', 'bg-slate-50');
  })
);
;['dragleave','drop'].forEach(evt =>
  dropZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('ring-2', 'ring-slate-300', 'bg-slate-50');
  })
);
dropZone.addEventListener('drop', async (e) => {
  if (!canWrite()) return alert('กรุณาเข้าสู่ระบบเพื่ออัปโหลด');
  const dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return;
  await doUpload(dt.files);
});

// ---------- Preview ----------
function openPreview(file) {
  modalTitle.textContent = `พรีวิว: ${file.name}`;
  modalBody.innerHTML = '';

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = file.previewUrl;
    img.alt = file.name;
    img.className = 'max-h-[75vh] w-auto mx-auto';
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
    }).catch(() => {
      modalBody.innerHTML = `<div class="p-4 text-slate-600">ไม่สามารถโหลดข้อความได้</div>`;
    });
  } else {
    modalBody.innerHTML = `
      <div class="p-6 text-center">
        <p class="mb-4">ชนิดไฟล์นี้ไม่รองรับการพรีวิว</p>
        <a href="${file.downloadUrl}" class="inline-flex items-center justify-center rounded-xl bg-slate-900 text-white px-4 py-2 font-medium hover:bg-slate-700">ดาวน์โหลดไฟล์</a>
      </div>
    `;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}
modalClose.addEventListener('click', () => {
  modal.classList.add('hidden'); modal.classList.remove('flex');
});
modal.addEventListener('click', (e) => {
  if (e.target === modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
});

// ---------- Boot ----------
(async function init() {
  renderBreadcrumbs();
  await refreshMe();
  await fetchFiles();
})();
// เพิ่มหลังบรรทัด dropZone.addEventListener('dragenter' ... )
dropZone.classList.add('is-dragover');
// และใน 'dragleave' / 'drop'
dropZone.classList.remove('is-dragover');
const btnOpenLogin = document.getElementById('btnOpenLogin');
btnOpenLogin?.addEventListener('click', () => openLogin(true));
