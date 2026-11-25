// ClipSnap Vault - 純前端螢幕截圖與剪貼簿自動整理工作台

const DB_NAME = "ClipSnapVaultDB";
const DB_VERSION = 1;
const STORE_NAME = "clips";

const TYPE_LABELS = {
  image: "螢幕截圖",
  code: "程式碼",
  link: "網址書籤",
  text: "文字筆記",
};

const state = {
  items: [],
  activeCategory: "all",
  activeTag: null,
  searchQuery: "",
  sortBy: "newest",
  memoryFallback: false,
  editor: {
    itemId: null,
    tool: "select",
    color: "#ef4444",
    lineWidth: 4,
    isDrawing: false,
    startX: 0,
    startY: 0,
    baseImageData: null,
    snapshotBeforeStroke: null,
    history: [],
    penPoints: [],
  },
};

// ---------------- IndexedDB 工具 ----------------

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("瀏覽器不支援 IndexedDB"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  if (state.memoryFallback) return [...state.items];
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    state.memoryFallback = true;
    return [...state.items];
  }
}

async function dbPut(item) {
  if (state.memoryFallback) return;
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    state.memoryFallback = true;
  }
}

async function dbDelete(id) {
  if (state.memoryFallback) return;
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    state.memoryFallback = true;
  }
}

async function dbClear() {
  if (state.memoryFallback) return;
  try {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    state.memoryFallback = true;
  }
}

// ---------------- DOM 參考 ----------------

const els = {
  cardsGrid: document.getElementById("cardsGrid"),
  emptyState: document.getElementById("emptyState"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  categoryTabs: document.getElementById("categoryTabs"),
  tagCloud: document.getElementById("tagCloud"),
  storageSummary: document.getElementById("storageSummary"),
  activeFilterLabel: document.getElementById("activeFilterLabel"),
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  toastContainer: document.getElementById("toastContainer"),
  // Buttons
  btnCaptureScreen: document.getElementById("btnCaptureScreen"),
  btnPasteClipboard: document.getElementById("btnPasteClipboard"),
  btnNewNote: document.getElementById("btnNewNote"),
  btnLoadDemo: document.getElementById("btnLoadDemo"),
  btnExportMarkdown: document.getElementById("btnExportMarkdown"),
  btnClearAll: document.getElementById("btnClearAll"),
  // Image Editor Modal
  imageModal: document.getElementById("imageModal"),
  canvas: document.getElementById("annotationCanvas"),
  editorColor: document.getElementById("editorColor"),
  editorSize: document.getElementById("editorSize"),
  btnUndoCanvas: document.getElementById("btnUndoCanvas"),
  btnResetCanvas: document.getElementById("btnResetCanvas"),
  btnSaveCanvas: document.getElementById("btnSaveCanvas"),
  exportFilename: document.getElementById("exportFilename"),
  exportFormat: document.getElementById("exportFormat"),
  exportAddBanner: document.getElementById("exportAddBanner"),
  bannerTextWrap: document.getElementById("bannerTextWrap"),
  exportBannerText: document.getElementById("exportBannerText"),
  btnDownloadImage: document.getElementById("btnDownloadImage"),
  btnCopyImage: document.getElementById("btnCopyImage"),
  editImageTitle: document.getElementById("editImageTitle"),
  editImageTags: document.getElementById("editImageTags"),
  btnUpdateImageMeta: document.getElementById("btnUpdateImageMeta"),
  // Note Modal
  noteModal: document.getElementById("noteModal"),
  noteForm: document.getElementById("noteForm"),
  noteId: document.getElementById("noteId"),
  noteTitle: document.getElementById("noteTitle"),
  noteType: document.getElementById("noteType"),
  noteContent: document.getElementById("noteContent"),
  noteTags: document.getElementById("noteTags"),
};

// ---------------- 輔助函式 ----------------

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = isError ? "toast error" : "toast";
  toast.textContent = message;
  els.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function createId() {
  return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseTags(raw) {
  return [...new Set(raw.split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
}

function detectTextType(text) {
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return "link";
  }
  const codePatterns = [
    /\b(function|const|let|var|import|export|class|return|async|await)\b/,
    /\b(def|elif|lambda|print\(|from\s+\w+\s+import)\b/,
    /<[a-zA-Z][^>]*>.*<\/[a-zA-Z]+>/s,
    /;\s*$/m,
    /=>/,
  ];
  const score = codePatterns.reduce((acc, rx) => acc + (rx.test(trimmed) ? 1 : 0), 0);
  if (score >= 2 || (trimmed.includes("\n") && score >= 1 && (trimmed.includes("{") || trimmed.includes(":")))) {
    return "code";
  }
  return "text";
}

function autoTitleFromText(text, type) {
  const firstLine = text.trim().split(/\r?\n/)[0].trim();
  if (type === "link") {
    try {
      const url = new URL(firstLine);
      return `連結：${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 48);
    } catch {
      return firstLine.slice(0, 48);
    }
  }
  return firstLine.slice(0, 42) || `${TYPE_LABELS[type]} ${formatDate(Date.now())}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

// ---------------- 新增資料項目 ----------------

async function addImageClip(blobOrDataUrl, customTitle = "", extraTags = []) {
  const dataUrl = typeof blobOrDataUrl === "string" ? blobOrDataUrl : await blobToDataUrl(blobOrDataUrl);
  const img = await loadImage(dataUrl);
  const now = Date.now();
  const item = {
    id: createId(),
    type: "image",
    title: customTitle || `截圖 ${formatDate(now)}`,
    content: "",
    imageDataUrl: dataUrl,
    originalDataUrl: dataUrl,
    width: img.width,
    height: img.height,
    tags: [...new Set(["截圖", ...extraTags])],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  state.items.unshift(item);
  await dbPut(item);
  renderAll();
  return item;
}

async function addTextClip(rawText, forcedType = "auto", customTitle = "", extraTags = []) {
  const clean = rawText.trim();
  if (!clean) return null;

  const detectedType = forcedType === "auto" ? detectTextType(clean) : forcedType;
  const now = Date.now();
  const defaultTag = TYPE_LABELS[detectedType];
  const item = {
    id: createId(),
    type: detectedType,
    title: customTitle.trim() || autoTitleFromText(clean, detectedType),
    content: clean,
    tags: [...new Set([defaultTag, ...extraTags])],
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  state.items.unshift(item);
  await dbPut(item);
  renderAll();
  return item;
}

// ---------------- 畫面渲染 ----------------

function getFilteredItems() {
  const query = state.searchQuery.trim().toLowerCase();
  const list = state.items.filter((item) => {
    if (state.activeCategory === "pinned" && !item.pinned) return false;
    if (
      state.activeCategory !== "all" &&
      state.activeCategory !== "pinned" &&
      item.type !== state.activeCategory
    ) {
      return false;
    }
    if (state.activeTag && !(item.tags || []).includes(state.activeTag)) {
      return false;
    }
    if (query) {
      const hay = `${item.title} ${item.content || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (state.sortBy === "oldest") return a.createdAt - b.createdAt;
    if (state.sortBy === "pinned") {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    }
    return b.createdAt - a.createdAt;
  });

  return list;
}

function updateCountsAndTags() {
  const counts = { all: state.items.length, image: 0, code: 0, link: 0, text: 0, pinned: 0 };
  const tagMap = new Map();

  for (const item of state.items) {
    if (counts[item.type] !== undefined) counts[item.type] += 1;
    if (item.pinned) counts.pinned += 1;
    for (const tag of item.tags || []) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }

  for (const [key, val] of Object.entries(counts)) {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = String(val);
  }

  els.storageSummary.textContent = `已收錄 ${state.items.length} 筆資料（圖片 ${counts.image} 張）`;

  els.tagCloud.innerHTML = "";
  if (tagMap.size === 0) {
    const span = document.createElement("span");
    span.className = "empty-tags";
    span.textContent = "尚無標籤";
    els.tagCloud.appendChild(span);
    return;
  }

  for (const [tag, count] of [...tagMap.entries()].sort((a, b) => b[1] - a[1])) {
    const btn = document.createElement("button");
    btn.className = `tag-chip${state.activeTag === tag ? " active" : ""}`;
    btn.textContent = `#${tag} (${count})`;
    btn.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      renderAll();
    });
    els.tagCloud.appendChild(btn);
  }
}

function buildCardElement(item) {
  const card = document.createElement("article");
  card.className = `clip-card${item.pinned ? " pinned" : ""}`;

  // Preview area
  const preview = document.createElement("div");
  preview.className = "card-preview";
  const pill = document.createElement("span");
  pill.className = "card-type-pill";
  pill.textContent = TYPE_LABELS[item.type] || item.type;
  preview.appendChild(pill);

  if (item.type === "image") {
    const img = document.createElement("img");
    img.src = item.imageDataUrl;
    img.alt = item.title;
    preview.appendChild(img);
    preview.addEventListener("click", () => openImageEditor(item.id));
  } else {
    const pre = document.createElement("div");
    pre.className = `card-text-preview${item.type === "code" ? " code" : ""}`;
    pre.textContent = item.content;
    preview.appendChild(pre);
    preview.addEventListener("click", () => openNoteModal(item.id));
  }

  // Body
  const body = document.createElement("div");
  body.className = "card-body";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = item.title;
  titleRow.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent =
    item.type === "image"
      ? `${formatDate(item.createdAt)} · ${item.width || "?"}×${item.height || "?"}`
      : formatDate(item.createdAt);

  const tagsRow = document.createElement("div");
  tagsRow.className = "card-tags";
  for (const t of item.tags || []) {
    const span = document.createElement("span");
    span.className = "mini-tag";
    span.textContent = `#${t}`;
    tagsRow.appendChild(span);
  }

  body.append(titleRow, meta, tagsRow);

  // Actions
  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (item.type === "image") {
    const btnEdit = document.createElement("button");
    btnEdit.className = "btn btn-sm btn-primary";
    btnEdit.textContent = "標註 / 匯出";
    btnEdit.addEventListener("click", () => openImageEditor(item.id));
    actions.appendChild(btnEdit);
  } else {
    const btnCopy = document.createElement("button");
    btnCopy.className = "btn btn-sm btn-secondary";
    btnCopy.textContent = "複製";
    btnCopy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.content);
      showToast("已複製內容到剪貼簿");
    });
    actions.appendChild(btnCopy);

    if (item.type === "link") {
      const btnOpen = document.createElement("button");
      btnOpen.className = "btn btn-sm btn-secondary";
      btnOpen.textContent = "開啟";
      btnOpen.addEventListener("click", () => window.open(item.content, "_blank", "noopener"));
      actions.appendChild(btnOpen);
    } else {
      const btnEditNote = document.createElement("button");
      btnEditNote.className = "btn btn-sm btn-secondary";
      btnEditNote.textContent = "編輯";
      btnEditNote.addEventListener("click", () => openNoteModal(item.id));
      actions.appendChild(btnEditNote);
    }
  }

  const btnPin = document.createElement("button");
  btnPin.className = "btn btn-sm btn-ghost";
  btnPin.textContent = item.pinned ? "取消釘選" : "釘選";
  btnPin.addEventListener("click", async () => {
    item.pinned = !item.pinned;
    item.updatedAt = Date.now();
    await dbPut(item);
    renderAll();
  });

  const btnDel = document.createElement("button");
  btnDel.className = "btn btn-sm btn-danger-ghost";
  btnDel.textContent = "刪除";
  btnDel.addEventListener("click", async () => {
    state.items = state.items.filter((x) => x.id !== item.id);
    await dbDelete(item.id);
    renderAll();
    showToast("已刪除項目");
  });

  actions.append(btnPin, btnDel);
  card.append(preview, body, actions);
  return card;
}

function renderAll() {
  updateCountsAndTags();
  const filtered = getFilteredItems();

  const catLabelMap = {
    all: "全部項目",
    image: "螢幕截圖 / 圖片",
    code: "程式碼片段",
    link: "網址書籤",
    text: "文字筆記",
    pinned: "已釘選重點",
  };
  let status = `顯示：${catLabelMap[state.activeCategory] || "全部"}`;
  if (state.activeTag) status += ` · 標籤 #${state.activeTag}`;
  if (state.searchQuery.trim()) status += ` · 搜尋「${state.searchQuery.trim()}」`;
  els.activeFilterLabel.textContent = `${status}（${filtered.length}）`;

  els.cardsGrid.innerHTML = "";
  if (filtered.length === 0) {
    els.emptyState.classList.remove("hidden");
  } else {
    els.emptyState.classList.add("hidden");
    const frag = document.createDocumentFragment();
    for (const item of filtered) {
      frag.appendChild(buildCardElement(item));
    }
    els.cardsGrid.appendChild(frag);
  }
}

// ---------------- 螢幕擷取與剪貼簿 ----------------

async function captureScreenFrame() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast("此瀏覽器不支援螢幕擷取 API，請改用 Ctrl+V 貼上截圖", true);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false,
    });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // 等候一幀確保畫面尺寸就緒
    await new Promise((r) => setTimeout(r, 150));

    const offscreen = document.createElement("canvas");
    offscreen.width = video.videoWidth || 1280;
    offscreen.height = video.videoHeight || 720;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);

    const dataUrl = offscreen.toDataURL("image/png");
    const created = await addImageClip(dataUrl, `螢幕擷圖 ${formatDate(Date.now())}`, ["螢幕擷取"]);
    showToast("螢幕擷取成功！已自動開啟標註工作台");
    openImageEditor(created.id);
  } catch (err) {
    if (err.name !== "AbortError" && err.name !== "NotAllowedError") {
      showToast(`擷取失敗：${err.message}`, true);
    }
  } finally {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}

async function readFromClipboardButton() {
  if (!navigator.clipboard) {
    showToast("請直接按下 Ctrl+V 貼上內容", true);
    return;
  }
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      let handled = false;
      for (const clipItem of items) {
        const imgType = clipItem.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await clipItem.getType(imgType);
          await addImageClip(blob);
          handled = true;
        } else if (clipItem.types.includes("text/plain")) {
          const blob = await clipItem.getType("text/plain");
          const text = await blob.text();
          if (text.trim()) {
            await addTextClip(text);
            handled = true;
          }
        }
      }
      showToast(handled ? "已從剪貼簿收錄內容！" : "剪貼簿中沒有可收錄的圖片或文字");
      return;
    }
    const text = await navigator.clipboard.readText();
    if (text.trim()) {
      await addTextClip(text);
      showToast("已從剪貼簿收錄文字！");
    } else {
      showToast("剪貼簿目前為空");
    }
  } catch {
    showToast("瀏覽器未授權按鈕讀取，請直接在頁面上按 Ctrl+V 貼上", true);
  }
}

async function handlePasteEvent(e) {
  const activeTag = document.activeElement?.tagName;
  const items = [...(e.clipboardData?.items || [])];
  const hasImage = items.some((it) => it.type.startsWith("image/"));

  if ((activeTag === "INPUT" || activeTag === "TEXTAREA") && !hasImage) {
    return;
  }

  let captured = false;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        await addImageClip(file);
        captured = true;
      }
    }
  }

  if (!captured) {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (text.trim()) {
      await addTextClip(text);
      captured = true;
    }
  }

  if (captured) {
    e.preventDefault();
    showToast("已透過 Ctrl+V 自動分類並儲存！");
  }
}

async function handleFiles(fileList) {
  let count = 0;
  for (const file of fileList) {
    if (file.type.startsWith("image/")) {
      await addImageClip(file, file.name.replace(/\.[^.]+$/, ""));
      count += 1;
    } else if (file.size < 2 * 1024 * 1024) {
      const text = await file.text();
      if (text.trim()) {
        await addTextClip(text, "auto", file.name);
        count += 1;
      }
    }
  }
  if (count > 0) {
    showToast(`已匯入 ${count} 個檔案`);
  }
}

// ---------------- 圖片標註與匯出編輯器 ----------------

function openModal(modalEl) {
  modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  modalEl.classList.add("hidden");
}

async function openImageEditor(itemId) {
  const item = state.items.find((x) => x.id === itemId);
  if (!item) return;

  state.editor.itemId = item.id;
  state.editor.history = [];
  const img = await loadImage(item.imageDataUrl);
  els.canvas.width = img.width;
  els.canvas.height = img.height;
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);

  state.editor.baseImageData = ctx.getImageData(0, 0, img.width, img.height);
  els.editImageTitle.value = item.title;
  els.editImageTags.value = (item.tags || []).join(", ");
  els.exportFilename.value = item.title.replace(/[\\/:*?"<>|]/g, "_");

  openModal(els.imageModal);
}

function pushCanvasHistory() {
  const ctx = els.canvas.getContext("2d");
  const snap = ctx.getImageData(0, 0, els.canvas.width, els.canvas.height);
  state.editor.history.push(snap);
  if (state.editor.history.length > 20) {
    state.editor.history.shift();
  }
}

function getCanvasCoords(evt) {
  const rect = els.canvas.getBoundingClientRect();
  const scaleX = els.canvas.width / rect.width;
  const scaleY = els.canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  const headLen = Math.max(12, width * 3.2);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function applyMosaicRect(ctx, x1, y1, x2, y2, blockSize = 14) {
  const left = Math.max(0, Math.floor(Math.min(x1, x2)));
  const top = Math.max(0, Math.floor(Math.min(y1, y2)));
  const w = Math.min(els.canvas.width - left, Math.abs(Math.round(x2 - x1)));
  const h = Math.min(els.canvas.height - top, Math.abs(Math.round(y2 - y1)));
  if (w < 4 || h < 4) return;

  const imgData = ctx.getImageData(left, top, w, h);
  const data = imgData.data;
  for (let py = 0; py < h; py += blockSize) {
    for (let px = 0; px < w; px += blockSize) {
      const sampleX = Math.min(w - 1, px + Math.floor(blockSize / 2));
      const sampleY = Math.min(h - 1, py + Math.floor(blockSize / 2));
      const idx = (sampleY * w + sampleX) * 4;
      ctx.fillStyle = `rgb(${data[idx]}, ${data[idx + 1]}, ${data[idx + 2]})`;
      ctx.fillRect(left + px, top + py, Math.min(blockSize, w - px), Math.min(blockSize, h - py));
    }
  }
}

function bindCanvasEvents() {
  const ctx = els.canvas.getContext("2d");

  els.canvas.addEventListener("pointerdown", (e) => {
    if (state.editor.tool === "select") return;
    const pos = getCanvasCoords(e);

    if (state.editor.tool === "text") {
      const label = window.prompt("輸入要加在圖片上的標註文字：");
      if (label && label.trim()) {
        pushCanvasHistory();
        const fontSize = Math.max(18, Number(els.editorSize.value) * 4);
        ctx.save();
        ctx.font = `bold ${fontSize}px "Segoe UI", "Noto Sans TC", sans-serif`;
        const metrics = ctx.measureText(label.trim());
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.fillRect(pos.x - 6, pos.y - fontSize, metrics.width + 12, fontSize + 10);
        ctx.fillStyle = els.editorColor.value;
        ctx.fillText(label.trim(), pos.x, pos.y);
        ctx.restore();
      }
      return;
    }

    pushCanvasHistory();
    state.editor.isDrawing = true;
    state.editor.startX = pos.x;
    state.editor.startY = pos.y;
    state.editor.penPoints = [pos];
    state.editor.snapshotBeforeStroke = ctx.getImageData(0, 0, els.canvas.width, els.canvas.height);
    els.canvas.setPointerCapture(e.pointerId);
  });

  els.canvas.addEventListener("pointermove", (e) => {
    if (!state.editor.isDrawing) return;
    const pos = getCanvasCoords(e);
    const color = els.editorColor.value;
    const size = Number(els.editorSize.value);

    if (state.editor.tool === "pen") {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const prev = state.editor.penPoints[state.editor.penPoints.length - 1];
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
      state.editor.penPoints.push(pos);
      return;
    }

    ctx.putImageData(state.editor.snapshotBeforeStroke, 0, 0);

    if (state.editor.tool === "rect") {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.strokeRect(
        state.editor.startX,
        state.editor.startY,
        pos.x - state.editor.startX,
        pos.y - state.editor.startY
      );
      ctx.restore();
    } else if (state.editor.tool === "arrow") {
      drawArrow(ctx, state.editor.startX, state.editor.startY, pos.x, pos.y, color, size);
    } else if (state.editor.tool === "blur") {
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(
        state.editor.startX,
        state.editor.startY,
        pos.x - state.editor.startX,
        pos.y - state.editor.startY
      );
      ctx.restore();
    }
  });

  els.canvas.addEventListener("pointerup", (e) => {
    if (!state.editor.isDrawing) return;
    const pos = getCanvasCoords(e);
    if (state.editor.tool === "blur") {
      ctx.putImageData(state.editor.snapshotBeforeStroke, 0, 0);
      applyMosaicRect(ctx, state.editor.startX, state.editor.startY, pos.x, pos.y, 16);
    }
    state.editor.isDrawing = false;
    state.editor.snapshotBeforeStroke = null;
  });
}

function buildExportCanvas() {
  const addBanner = els.exportAddBanner.checked;
  const bannerHeight = addBanner ? 44 : 0;
  const out = document.createElement("canvas");
  out.width = els.canvas.width;
  out.height = els.canvas.height + bannerHeight;
  const ctx = out.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(els.canvas, 0, 0);

  if (addBanner) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, els.canvas.height, out.width, bannerHeight);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = '600 16px "Segoe UI", "Noto Sans TC", sans-serif';
    const info =
      els.exportBannerText.value.trim() ||
      `ClipSnap Vault · ${formatDate(Date.now())}`;
    ctx.fillText(info, 16, els.canvas.height + 28);
  }
  return out;
}

// ---------------- 文字筆記 Modal ----------------

function openNoteModal(itemId = null) {
  if (itemId) {
    const item = state.items.find((x) => x.id === itemId);
    if (!item) return;
    els.noteId.value = item.id;
    els.noteTitle.value = item.title;
    els.noteType.value = item.type;
    els.noteContent.value = item.content;
    els.noteTags.value = (item.tags || []).join(", ");
  } else {
    els.noteId.value = "";
    els.noteTitle.value = "";
    els.noteType.value = "auto";
    els.noteContent.value = "";
    els.noteTags.value = "";
  }
  openModal(els.noteModal);
}

// ---------------- 範例資料與匯出 MD ----------------

async function loadDemoItems() {
  // 產生一張示範截圖卡片
  const demoCanvas = document.createElement("canvas");
  demoCanvas.width = 920;
  demoCanvas.height = 520;
  const ctx = demoCanvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 920, 520);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(1, "#1e3a8a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 920, 520);
  ctx.fillStyle = "#38bdf8";
  ctx.font = 'bold 34px "Segoe UI", "Noto Sans TC", sans-serif';
  ctx.fillText("ClipSnap Vault 示範截圖", 54, 110);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = '20px "Segoe UI", "Noto Sans TC", sans-serif';
  ctx.fillText("• 點擊此卡片即可使用框線、箭頭與馬賽克遮罩", 54, 180);
  ctx.fillText("• 支援一鍵匯出為 PNG 或 JPG（可自訂 學號_姓名 檔名）", 54, 225);
  ctx.fillText("• 任何頁面按下 Ctrl+V 可直接新增剪貼簿截圖或程式碼", 54, 270);

  await addImageClip(demoCanvas.toDataURL("image/png"), "工具功能示範截圖", ["範例", "作業"]);
  await addTextClip(
    `def export_report(student_id: str, name: str) -> str:\n    return f"{student_id}_{name}.png"`,
    "code",
    "作業檔名格式範例 (Python)",
    ["範例", "Python"]
  );
  await addTextClip("https://pages.github.com/", "link", "GitHub Pages 部署說明", ["範例", "GitHub"]);
  await addTextClip(
    "作業-07 提醒：\n1. 將工具推送至 GitHub 並取得網址\n2. 繳交 1 張 學號_姓名.png 或 .jpg 到 Google 雲端硬碟「平時作業」資料夾\n3. 勿放資料夾也勿壓縮",
    "text",
    "作業-07 繳交檢查清單",
    ["範例", "待辦"]
  );
  showToast("已載入 4 筆示範資料");
}

function exportAllNotesToMarkdown() {
  const textItems = state.items.filter((x) => x.type !== "image");
  if (textItems.length === 0) {
    showToast("目前沒有文字、連結或程式碼可匯出", true);
    return;
  }
  const lines = [`# ClipSnap Vault 匯出筆記 (${formatDate(Date.now())})`, ""];
  for (const item of textItems) {
    lines.push(`## ${item.title}`);
    lines.push(`- 類型：${TYPE_LABELS[item.type]}`);
    lines.push(`- 標籤：${(item.tags || []).map((t) => `#${t}`).join(" ")}`);
    lines.push(`- 時間：${formatDate(item.createdAt)}`);
    lines.push("");
    if (item.type === "code") {
      lines.push("```");
      lines.push(item.content);
      lines.push("```");
    } else {
      lines.push(item.content);
    }
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clipsnap-notes-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("已匯出 Markdown 筆記檔");
}

// ---------------- 初始化與事件綁定 ----------------

function bindEvents() {
  document.addEventListener("paste", handlePasteEvent);

  els.btnCaptureScreen.addEventListener("click", captureScreenFrame);
  els.btnPasteClipboard.addEventListener("click", readFromClipboardButton);
  els.btnNewNote.addEventListener("click", () => openNoteModal(null));
  els.btnLoadDemo.addEventListener("click", loadDemoItems);
  els.btnExportMarkdown.addEventListener("click", exportAllNotesToMarkdown);

  els.btnClearAll.addEventListener("click", async () => {
    if (state.items.length === 0) return;
    if (!window.confirm("確定要清空所有本機儲存的截圖與筆記嗎？")) return;
    state.items = [];
    state.activeTag = null;
    await dbClear();
    renderAll();
    showToast("已清空全部資料");
  });

  els.fileInput.addEventListener("change", async (e) => {
    if (e.target.files?.length) {
      await handleFiles(e.target.files);
      e.target.value = "";
    }
  });

  // Drag and drop
  ["dragenter", "dragover"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "dragleave" && e.relatedTarget !== null) return;
      els.dropZone.classList.remove("drag-over");
    });
  });
  document.addEventListener("drop", async (e) => {
    if (e.dataTransfer?.files?.length) {
      await handleFiles(e.dataTransfer.files);
    }
  });

  // Category & search & sort
  els.categoryTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");
    if (!btn) return;
    els.categoryTabs.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
    state.activeCategory = btn.dataset.category;
    renderAll();
  });

  els.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderAll();
  });

  els.sortSelect.addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderAll();
  });

  // Modal close buttons
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = document.getElementById(el.dataset.closeModal);
      if (target) closeModal(target);
    });
  });

  // Editor tools
  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.editor.tool = btn.dataset.tool;
    });
  });

  els.btnUndoCanvas.addEventListener("click", () => {
    const snap = state.editor.history.pop();
    if (!snap) {
      showToast("沒有可復原的步驟");
      return;
    }
    els.canvas.getContext("2d").putImageData(snap, 0, 0);
  });

  els.btnResetCanvas.addEventListener("click", async () => {
    const item = state.items.find((x) => x.id === state.editor.itemId);
    if (!item) return;
    const img = await loadImage(item.originalDataUrl || item.imageDataUrl);
    els.canvas.width = img.width;
    els.canvas.height = img.height;
    els.canvas.getContext("2d").drawImage(img, 0, 0);
    state.editor.history = [];
    showToast("已還原為原始圖片");
  });

  els.btnSaveCanvas.addEventListener("click", async () => {
    const item = state.items.find((x) => x.id === state.editor.itemId);
    if (!item) return;
    item.imageDataUrl = els.canvas.toDataURL("image/png");
    item.updatedAt = Date.now();
    await dbPut(item);
    renderAll();
    showToast("已儲存圖片標註結果");
  });

  els.exportAddBanner.addEventListener("change", () => {
    els.bannerTextWrap.classList.toggle("hidden", !els.exportAddBanner.checked);
  });

  els.btnDownloadImage.addEventListener("click", () => {
    const format = els.exportFormat.value;
    const ext = format === "image/jpeg" ? "jpg" : "png";
    const rawName = els.exportFilename.value.trim() || "clipsnap_export";
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
    const exportCanvas = buildExportCanvas();
    const dataUrl = exportCanvas.toDataURL(format, 0.92);

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${safeName}.${ext}`;
    a.click();
    showToast(`已下載 ${safeName}.${ext}`);
  });

  els.btnCopyImage.addEventListener("click", async () => {
    try {
      const exportCanvas = buildExportCanvas();
      const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("已複製圖片到剪貼簿！");
    } catch {
      showToast("此瀏覽器不支援直接寫入圖片到剪貼簿，請改用下載圖片檔", true);
    }
  });

  els.btnUpdateImageMeta.addEventListener("click", async () => {
    const item = state.items.find((x) => x.id === state.editor.itemId);
    if (!item) return;
    item.title = els.editImageTitle.value.trim() || item.title;
    item.tags = parseTags(els.editImageTags.value);
    item.updatedAt = Date.now();
    await dbPut(item);
    renderAll();
    showToast("已更新圖片標題與標籤");
  });

  // Note form submit
  els.noteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = els.noteId.value;
    const content = els.noteContent.value;
    const title = els.noteTitle.value;
    const typeChoice = els.noteType.value;
    const tags = parseTags(els.noteTags.value);

    if (id) {
      const existing = state.items.find((x) => x.id === id);
      if (existing) {
        existing.type = typeChoice === "auto" ? detectTextType(content) : typeChoice;
        existing.title = title.trim() || autoTitleFromText(content, existing.type);
        existing.content = content.trim();
        existing.tags = tags;
        existing.updatedAt = Date.now();
        await dbPut(existing);
        renderAll();
        showToast("已更新筆記");
      }
    } else {
      await addTextClip(content, typeChoice, title, tags);
      showToast("已新增筆記");
    }
    closeModal(els.noteModal);
  });

  bindCanvasEvents();
}

async function init() {
  bindEvents();
  state.items = await dbGetAll();
  renderAll();
}

init();
