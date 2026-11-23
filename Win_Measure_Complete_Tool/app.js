/**
 * app.js - Client application logic for O'Brien360 PDF Window Measurement Completion Tool
 * Features interactive multi-page elevation sheet inspection, vector snapping controls,
 * real-time canvas viewport with pan & zoom, and takeoff schedule export.
 */

// Application State
const state = {
  serverAvailable: false,
  filename: null,
  pageCount: 0,
  currentPage: 0,
  summaryTypes: [],
  manualRecords: [],
  addedAnnotations: [],
  pageDimensions: [],

  // Viewer state
  previewImage: null,
  imageLoaded: false,
  pageAnnots: [],
  pageRect: [0, 0, 1000, 1000],

  // Transform (pan & zoom)
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  startX: 0,
  startY: 0,
  hoverItem: null,

  // Layer visibility
  showManual: true,
  showCompleted: true,
  showLabels: false,

  // Completion metrics
  hasCompleted: false,
  addedCount: 0,
  snappedCount: 0
};

// DOM Elements
const el = {
  // Upload
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  btnBrowse: document.getElementById('btnBrowse'),
  btnLoadExample: document.getElementById('btnLoadExample'),
  fileInfoCard: document.getElementById('fileInfoCard'),
  activeFileName: document.getElementById('activeFileName'),
  detectedPagesBadge: document.getElementById('detectedPagesBadge'),
  detectedManualBadge: document.getElementById('detectedManualBadge'),
  detectedTypesBadge: document.getElementById('detectedTypesBadge'),
  btnReloadFile: document.getElementById('btnReloadFile'),

  // Sections
  sectionUpload: document.getElementById('sectionUpload'),
  sectionRules: document.getElementById('sectionRules'),
  sectionViewer: document.getElementById('sectionViewer'),
  sectionExecute: document.getElementById('sectionExecute'),

  // Settings
  btnToggleSettings: document.getElementById('btnToggleSettings'),
  settingsPanel: document.getElementById('settingsPanel'),
  chkEnableSnap: document.getElementById('chkEnableSnap'),
  inputSearchRadius: document.getElementById('inputSearchRadius'),
  inputOverlapThreshold: document.getElementById('inputOverlapThreshold'),

  // Table
  tableWindowTypes: document.getElementById('tableWindowTypes'),
  tbodyWindowTypes: document.getElementById('tbodyWindowTypes'),
  chkSelectAllTypes: document.getElementById('chkSelectAllTypes'),

  // Viewer
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),
  selectPageDropdown: document.getElementById('selectPageDropdown'),
  lblTotalPages: document.getElementById('lblTotalPages'),
  canvasWrapper: document.getElementById('canvasWrapper'),
  elevationCanvas: document.getElementById('elevationCanvas'),
  canvasLoader: document.getElementById('canvasLoader'),
  canvasTooltip: document.getElementById('canvasTooltip'),
  lblMouseCoords: document.getElementById('lblMouseCoords'),
  lblHoverItem: document.getElementById('lblHoverItem'),
  btnZoomFit: document.getElementById('btnZoomFit'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),

  // Layer toggles
  chkShowManual: document.getElementById('chkShowManual'),
  chkShowCompleted: document.getElementById('chkShowCompleted'),
  pillShowManual: document.getElementById('pillShowManual'),
  pillShowCompleted: document.getElementById('pillShowCompleted'),

  // Execution & Export
  btnRunCompletion: document.getElementById('btnRunCompletion'),
  completionSuccessCard: document.getElementById('completionSuccessCard'),
  metricAddedCount: document.getElementById('metricAddedCount'),
  metricTotalWindows: document.getElementById('metricTotalWindows'),
  btnDownloadPDF: document.getElementById('btnDownloadPDF'),
  btnExportCSV: document.getElementById('btnExportCSV'),

  // Help Modal
  btnQuickHelp: document.getElementById('btnQuickHelp'),
  helpModal: document.getElementById('helpModal'),
  btnCloseHelp: document.getElementById('btnCloseHelp'),
  btnDismissHelp: document.getElementById('btnDismissHelp'),

  // Offline / Server Status
  serverStatusBadge: document.getElementById('serverStatusBadge'),
  serverOfflineBanner: document.getElementById('serverOfflineBanner'),
  btnCopyRunCmd: document.getElementById('btnCopyRunCmd'),
  copyFeedback: document.getElementById('copyFeedback'),
  serverRequiredModal: document.getElementById('serverRequiredModal'),
  serverModalFileName: document.getElementById('serverModalFileName'),
  btnCloseServerModal: document.getElementById('btnCloseServerModal'),
  btnDismissServerModal: document.getElementById('btnDismissServerModal'),
  btnCopyRunCmdModal: document.getElementById('btnCopyRunCmdModal')
};

// Canvas context
const ctx = el.elevationCanvas.getContext('2d');

// ----------------------------------------------------
// INITIALIZATION & EVENT LISTENERS
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkServerStatus();
});

function setupEventListeners() {
  // Upload & File triggers
  if (el.btnBrowse) el.btnBrowse.addEventListener('click', () => el.fileInput.click());
  if (el.fileInput) el.fileInput.addEventListener('change', handleFileSelected);
  if (el.btnLoadExample) el.btnLoadExample.addEventListener('click', loadSampleElevationFile);
  if (el.btnReloadFile) el.btnReloadFile.addEventListener('click', () => el.fileInput.click());

  // Drag & Drop
  if (el.dropZone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      el.dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        el.dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      el.dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        el.dropZone.classList.remove('dragover');
      });
    });
    el.dropZone.addEventListener('drop', handleFileDrop);
  }

  // Settings toggle
  if (el.btnToggleSettings) {
    el.btnToggleSettings.addEventListener('click', () => {
      el.settingsPanel.classList.toggle('hidden');
    });
  }

  // Select all types checkbox
  if (el.chkSelectAllTypes) {
    el.chkSelectAllTypes.addEventListener('change', e => {
      const checked = e.target.checked;
      document.querySelectorAll('.chk-type-item').forEach(chk => chk.checked = checked);
    });
  }

  // Viewer controls
  if (el.btnPrevPage) el.btnPrevPage.addEventListener('click', () => changePage(state.currentPage - 1));
  if (el.btnNextPage) el.btnNextPage.addEventListener('click', () => changePage(state.currentPage + 1));
  if (el.selectPageDropdown) el.selectPageDropdown.addEventListener('change', e => changePage(parseInt(e.target.value, 10)));

  // Zoom buttons
  if (el.btnZoomFit) el.btnZoomFit.addEventListener('click', fitCanvasView);
  if (el.btnZoomIn) el.btnZoomIn.addEventListener('click', () => zoomBy(1.25));
  if (el.btnZoomOut) el.btnZoomOut.addEventListener('click', () => zoomBy(0.8));

  // Layer toggles
  if (el.chkShowManual) {
    el.chkShowManual.addEventListener('change', e => {
      state.showManual = e.target.checked;
      if (el.pillShowManual) el.pillShowManual.classList.toggle('active', state.showManual);
      renderCanvas();
    });
  }
  if (el.chkShowCompleted) {
    el.chkShowCompleted.addEventListener('change', e => {
      state.showCompleted = e.target.checked;
      if (el.pillShowCompleted) el.pillShowCompleted.classList.toggle('active', state.showCompleted);
      renderCanvas();
    });
  }

  // Canvas Mouse interaction (Pan, Zoom, Hover)
  if (el.elevationCanvas) {
    el.elevationCanvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    el.elevationCanvas.addEventListener('wheel', handleWheel, { passive: false });
  }

  // Execution
  if (el.btnRunCompletion) {
    el.btnRunCompletion.addEventListener('click', runMeasurementCompletion);
  }

  // Help Modal
  if (el.btnQuickHelp) el.btnQuickHelp.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
  if (el.btnCloseHelp) el.btnCloseHelp.addEventListener('click', () => el.helpModal.classList.add('hidden'));
  if (el.btnDismissHelp) el.btnDismissHelp.addEventListener('click', () => el.helpModal.classList.add('hidden'));
  if (el.helpModal) {
    el.helpModal.addEventListener('click', e => {
      if (e.target === el.helpModal) el.helpModal.classList.add('hidden');
    });
  }

  // Server Required Modal & Copy actions
  if (el.btnCloseServerModal) el.btnCloseServerModal.addEventListener('click', () => el.serverRequiredModal.classList.add('hidden'));
  if (el.btnDismissServerModal) el.btnDismissServerModal.addEventListener('click', () => el.serverRequiredModal.classList.add('hidden'));
  if (el.serverRequiredModal) {
    el.serverRequiredModal.addEventListener('click', e => {
      if (e.target === el.serverRequiredModal) el.serverRequiredModal.classList.add('hidden');
    });
  }
  if (el.btnCopyRunCmd) el.btnCopyRunCmd.addEventListener('click', copyRunToolCmd);
  if (el.btnCopyRunCmdModal) el.btnCopyRunCmdModal.addEventListener('click', copyRunToolCmd);

  // Window resize
  window.addEventListener('resize', debounce(resizeCanvas, 150));
}

// ----------------------------------------------------
// SERVER COMMUNICATION & STATUS
// ----------------------------------------------------
async function checkServerStatus() {
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (!isLocal || window.location.protocol === 'file:') {
    setServerStatus(false);
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('/api/status', { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      setServerStatus(true);
      if (data.loaded && data.has_analysis) {
        state.filename = data.filename;
        state.pageCount = data.page_count;
        rescanLabels();
      }
    } else {
      setServerStatus(false);
    }
  } catch (err) {
    setServerStatus(false);
  }
}

function setServerStatus(connected) {
  state.serverAvailable = connected;
  if (el.serverStatusBadge) {
    el.serverStatusBadge.className = `server-status-pill ${connected ? 'connected' : 'offline'}`;
    const text = el.serverStatusBadge.querySelector('.status-text');
    if (text) text.textContent = connected ? 'Local Server Connected' : 'Local Server Required';
  }
  if (el.serverOfflineBanner) {
    if (connected) {
      el.serverOfflineBanner.classList.add('hidden');
    } else {
      el.serverOfflineBanner.classList.remove('hidden');
    }
  }
}

function showServerRequiredModal(filename) {
  if (el.serverModalFileName) {
    el.serverModalFileName.textContent = filename || 'your elevation PDF';
  }
  if (el.serverRequiredModal) {
    el.serverRequiredModal.classList.remove('hidden');
  }
}

function copyRunToolCmd() {
  const cmd = 'run_tool.bat';
  navigator.clipboard.writeText(cmd).then(() => {
    if (el.copyFeedback) {
      el.copyFeedback.classList.remove('hidden');
      setTimeout(() => el.copyFeedback.classList.add('hidden'), 2500);
    }
  }).catch(() => {
    alert('Command: run_tool.bat (execute in Win_Measure_Complete_Tool folder)');
  });
}

async function loadSampleElevationFile() {
  setLoading(true, 'Loading Windows_Measure_Test.pdf and learning representative markups...');
  
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/load-sample', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          applyAnalysisData(data);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Server load-sample failed, falling back to demo data:', err);
    }
  }

  // Offline / GitHub Pages fallback using demo_data.json
  try {
    const demoUrl = new URL('demo_data.json', window.location.href).href;
    const res = await fetch(demoUrl);
    if (res.ok) {
      const data = await res.json();
      applyAnalysisData(data);
      if (el.activeFileName) {
        el.activeFileName.textContent = `${data.filename} (Demo Preview Mode)`;
      }
    } else {
      showServerRequiredModal('Windows_Measure_Test.pdf');
    }
  } catch (err) {
    showServerRequiredModal('Windows_Measure_Test.pdf');
  } finally {
    setLoading(false);
  }
}

function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!state.serverAvailable) {
    showServerRequiredModal(file.name);
    e.target.value = ''; // Reset file input so user can try again after running server
    return;
  }
  uploadFile(file);
}

function handleFileDrop(e) {
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please upload an architectural PDF elevation file.');
    return;
  }
  if (!state.serverAvailable) {
    showServerRequiredModal(file.name);
    return;
  }
  uploadFile(file);
}

async function uploadFile(file) {
  setLoading(true, `Uploading and analyzing ${file.name}...`);
  try {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result;
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          file_base64: base64Data
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        applyAnalysisData(data);
      } else {
        alert('Upload error: ' + (data.error || 'Failed to analyze PDF'));
      }
      setLoading(false);
    };
    reader.readAsDataURL(file);
  } catch (err) {
    alert('Error uploading file: ' + err.message);
    setLoading(false);
  }
}

async function rescanLabels() {
  setLoading(true, 'Analyzing elevation sheets and learning window tags from measurement centers...');
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.status === 'success') {
      state.summaryTypes = data.summary_types;
      state.manualRecords = data.manual_records;
      renderWindowTypesTable(data.summary_types);
      loadPagePreview(state.currentPage);
    } else {
      alert('Error scanning labels: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Error connecting to server: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ----------------------------------------------------
// UI RENDERING & DATA BINDING
// ----------------------------------------------------
function applyAnalysisData(data) {
  state.filename = data.filename;
  state.pageCount = data.page_count;
  state.pageDimensions = data.page_dimensions || [];
  state.summaryTypes = data.summary_types || [];
  state.manualRecords = data.manual_records || [];
  state.hasCompleted = false;
  state.addedAnnotations = [];

  // Update File Info Card
  el.activeFileName.textContent = data.filename;
  el.detectedPagesBadge.textContent = `${data.page_count} Elevation Pages`;
  el.detectedManualBadge.textContent = `${data.manual_measurements_count} Manual Measurements`;
  el.detectedTypesBadge.textContent = `${data.learned_types_count} Window Types Learned`;

  el.fileInfoCard.classList.remove('hidden');
  el.sectionRules.classList.remove('hidden');
  el.sectionViewer.classList.remove('hidden');
  el.sectionExecute.classList.remove('hidden');

  // Populate Page Dropdown
  el.selectPageDropdown.innerHTML = '';
  for (let i = 0; i < data.page_count; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Sheet ${i + 1}`;
    el.selectPageDropdown.appendChild(opt);
  }
  el.lblTotalPages.textContent = data.page_count;

  // Render Window Types Table
  renderWindowTypesTable(data.summary_types);

  // Load first page preview
  state.currentPage = 0;
  loadPagePreview(0);
}

function renderWindowTypesTable(types) {
  el.tbodyWindowTypes.innerHTML = '';

  types.forEach(t => {
    const tr = document.createElement('tr');

    // Checkbox
    const tdChk = document.createElement('td');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'chk-type-item';
    chk.dataset.type = t.type;
    chk.checked = t.has_rule; // Default check if representative rule was learned
    tdChk.appendChild(chk);
    tr.appendChild(tdChk);

    // Window Type
    const tdType = document.createElement('td');
    tdType.innerHTML = `<span class="type-badge">${t.type}</span>`;
    tr.appendChild(tdType);

    // Manual Samples
    const tdManual = document.createElement('td');
    tdManual.innerHTML = t.manual_count > 0
      ? `<span class="badge-count badge-manual">${t.manual_count} sample${t.manual_count > 1 ? 's' : ''}</span>`
      : `<span style="color:var(--ob-text-muted)">None</span>`;
    tr.appendChild(tdManual);

    // Total Detected
    const tdTotal = document.createElement('td');
    tdTotal.innerHTML = `<strong>${t.total_count}</strong>`;
    tr.appendChild(tdTotal);

    // Missing to Add
    const tdMissing = document.createElement('td');
    tdMissing.innerHTML = t.missing_count > 0
      ? `<span class="badge-count badge-missing">+${t.missing_count} missing</span>`
      : `<span style="color:var(--ob-text-muted)">Completed</span>`;
    tr.appendChild(tdMissing);

    // Unit Area
    const tdArea = document.createElement('td');
    tdArea.innerHTML = t.area_str ? `<strong>${t.area_str}</strong>` : `<span style="color:var(--ob-text-muted)">-</span>`;
    tr.appendChild(tdArea);

    // Dimensions
    const tdDim = document.createElement('td');
    tdDim.textContent = (t.width_pt && t.height_pt) ? `${t.width_pt} pt × ${t.height_pt} pt` : '-';
    tr.appendChild(tdDim);

    // Scale
    const tdScale = document.createElement('td');
    tdScale.textContent = t.scale_str || 'Inherit';
    tr.appendChild(tdScale);

    // Sheets
    const tdSheets = document.createElement('td');
    tdSheets.textContent = t.pages ? t.pages.join(', ') : '-';
    tr.appendChild(tdSheets);

    el.tbodyWindowTypes.appendChild(tr);
  });
}

// ----------------------------------------------------
// ELEVATION SHEET CANVAS VIEWPORT
// ----------------------------------------------------
async function loadPagePreview(pageIdx) {
  if (!state.serverAvailable) {
    setCanvasLoader(false);
    renderOfflineCanvasPlaceholder(pageIdx);
    return;
  }

  setCanvasLoader(true);
  try {
    const mode = state.hasCompleted ? 'completed' : 'original';
    const res = await fetch(`/api/page-preview?page=${pageIdx}&mode=${mode}&zoom=1.4`);
    const data = await res.json();

    if (data.data_uri) {
      const img = new Image();
      img.onload = () => {
        state.previewImage = img;
        state.imageLoaded = true;
        state.pageAnnots = data.annots || [];
        state.pageRect = data.page_rect || [0, 0, img.width, img.height];

        fitCanvasView();
        setCanvasLoader(false);
      };
      img.src = data.data_uri;
    }
  } catch (err) {
    console.error('Failed to load page preview:', err);
    setCanvasLoader(false);
  }
}

function changePage(newIdx) {
  if (newIdx < 0 || newIdx >= state.pageCount) return;
  state.currentPage = newIdx;
  el.selectPageDropdown.value = newIdx;
  loadPagePreview(newIdx);
}

function resizeCanvas() {
  const rect = el.canvasWrapper.getBoundingClientRect();
  el.elevationCanvas.width = rect.width;
  el.elevationCanvas.height = rect.height;
  renderCanvas();
}

function renderOfflineCanvasPlaceholder(pageIdx) {
  const cw = el.elevationCanvas.width;
  const ch = el.elevationCanvas.height;
  if (!cw || !ch) return;

  ctx.save();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, cw, ch);

  // Subtle architectural grid
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1;
  const gridSize = 32;
  for (let x = 0; x < cw; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let y = 0; y < ch; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }

  // Centered Blueprint Card
  const cardW = Math.min(cw - 40, 520);
  const cardH = 170;
  const cardX = (cw - cardW) / 2;
  const cardY = (ch - cardH) / 2;

  ctx.fillStyle = '#1E293B';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeRect(cardX, cardY, cardW, cardH);
  }

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 16px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Elevation Sheet ${pageIdx + 1} Preview`, cw / 2, cardY + 42);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '13px Inter, sans-serif';
  ctx.fillText('Live vector linework rendering requires the local Python backend.', cw / 2, cardY + 74);
  ctx.fillText('Double-click run_tool.bat to interactively inspect and snap markups.', cw / 2, cardY + 98);

  ctx.fillStyle = '#8CBD3A';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('Command: run_tool.bat (http://localhost:8088)', cw / 2, cardY + 134);

  ctx.restore();
}

function fitCanvasView() {
  resizeCanvas();
  if (!state.previewImage) return;

  const cw = el.elevationCanvas.width;
  const ch = el.elevationCanvas.height;
  const iw = state.previewImage.width;
  const ih = state.previewImage.height;

  const scale = Math.min((cw - 40) / iw, (ch - 40) / ih);
  state.zoom = scale;
  state.panX = (cw - iw * scale) / 2;
  state.panY = (ch - ih * scale) / 2;

  renderCanvas();
}

function zoomBy(factor) {
  const cw = el.elevationCanvas.width / 2;
  const ch = el.elevationCanvas.height / 2;
  zoomAt(cw, ch, factor);
}

function zoomAt(cx, cy, factor) {
  const newZoom = Math.max(0.1, Math.min(state.zoom * factor, 8.0));
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  renderCanvas();
}

function renderCanvas() {
  const cw = el.elevationCanvas.width;
  const ch = el.elevationCanvas.height;
  ctx.clearRect(0, 0, cw, ch);

  if (!state.imageLoaded || !state.previewImage) return;

  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  // Draw background elevation raster
  ctx.drawImage(state.previewImage, 0, 0);

  // Drawing annotations overlay
  const rasterScale = state.previewImage.width / state.pageRect[2];

  // 1. Manual markups (Blue)
  if (state.showManual) {
    const pageManuals = state.manualRecords.filter(m => m.page === state.currentPage);
    const isFill = false; // Always outline only
    pageManuals.forEach(m => {
      const r = m.rect;
      const x = r[0] * rasterScale;
      const y = r[1] * rasterScale;
      const w = (r[2] - r[0]) * rasterScale;
      const h = (r[3] - r[1]) * rasterScale;

      if (isFill) {
        ctx.fillStyle = 'rgba(37, 99, 235, 0.20)';
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2.5 / state.zoom;
      ctx.strokeRect(x, y, w, h);

      // Label text inside window with white halo for legibility
      const txt = m.content || m.matched_label || 'Manual';
      ctx.font = `bold ${Math.max(10, 13 * rasterScale)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 / state.zoom;
      ctx.strokeStyle = '#FFFFFF';
      ctx.strokeText(txt, x + w / 2, y + h / 2);
      ctx.fillStyle = '#1D4ED8';
      ctx.fillText(txt, x + w / 2, y + h / 2);
    });
  }

  // 2. Auto-Completed markups (Clean Red Outline - No Solid Blockout!)
  if (state.showCompleted && state.hasCompleted) {
    const pageCompleted = state.addedAnnotations.filter(a => a.page === (state.currentPage + 1));
    const isFill = false; // Always outline only
    pageCompleted.forEach(a => {
      const r = a.rect;
      const x = r[0] * rasterScale;
      const y = r[1] * rasterScale;
      const w = (r[2] - r[0]) * rasterScale;
      const h = (r[3] - r[1]) * rasterScale;

      if (isFill) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.25)';
        ctx.fillRect(x, y, w, h);
      }
      // Crisp outline
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 2.5 / state.zoom;
      ctx.strokeRect(x, y, w, h);

      // Centered area string e.g. "40 sf" with white halo
      const txt = a.area_str || a.type;
      ctx.font = `bold ${Math.max(10, 13 * rasterScale)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 / state.zoom;
      ctx.strokeStyle = '#FFFFFF';
      ctx.strokeText(txt, x + w / 2, y + h / 2);
      ctx.fillStyle = '#DC2626';
      ctx.fillText(txt, x + w / 2, y + h / 2);
    });
  }

  // 3. Highlight hovered item
  if (state.hoverItem) {
    const item = state.hoverItem;
    const r = item.rect;
    const x = r[0] * rasterScale;
    const y = r[1] * rasterScale;
    const w = (r[2] - r[0]) * rasterScale;
    const h = (r[3] - r[1]) * rasterScale;

    ctx.strokeStyle = '#38BDF8'; // Bright cyan glow
    ctx.lineWidth = 3 / state.zoom;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }

  ctx.restore();
}

// ----------------------------------------------------
// MOUSE & INTERACTION HANDLERS
// ----------------------------------------------------
function handleMouseDown(e) {
  if (e.button === 0) { // Left click
    state.isPanning = true;
    state.startX = e.clientX - state.panX;
    state.startY = e.clientY - state.panY;
    el.canvasWrapper.style.cursor = 'grabbing';
  }
}

function handleMouseMove(e) {
  const rect = el.canvasWrapper.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (state.isPanning) {
    state.panX = e.clientX - state.startX;
    state.panY = e.clientY - state.startY;
    renderCanvas();
    return;
  }

  // Convert canvas pixel coord to PDF coordinate
  if (!state.previewImage) return;
  const rasterScale = state.previewImage.width / state.pageRect[2];
  const pdfX = (mouseX - state.panX) / (state.zoom * rasterScale);
  const pdfY = (mouseY - state.panY) / (state.zoom * rasterScale);

  el.lblMouseCoords.textContent = `X: ${Math.round(pdfX)} pt | Y: ${Math.round(pdfY)} pt`;

  // Hit-test annotations on current page
  let found = null;
  // Check completed first
  if (state.showCompleted && state.hasCompleted) {
    const pageCompleted = state.addedAnnotations.filter(a => a.page === (state.currentPage + 1));
    for (const a of pageCompleted) {
      if (pdfX >= a.rect[0] && pdfX <= a.rect[2] && pdfY >= a.rect[1] && pdfY <= a.rect[3]) {
        found = { ...a, source: 'Auto-Completed' };
        break;
      }
    }
  }
  // Check manual next
  if (!found && state.showManual) {
    const pageManuals = state.manualRecords.filter(m => m.page === state.currentPage);
    for (const m of pageManuals) {
      if (pdfX >= m.rect[0] && pdfX <= m.rect[2] && pdfY >= m.rect[1] && pdfY <= m.rect[3]) {
        found = { ...m, source: 'Manual Ground Truth' };
        break;
      }
    }
  }

  state.hoverItem = found;
  if (found) {
    el.canvasWrapper.style.cursor = 'pointer';
    el.lblHoverItem.textContent = `${found.type || found.matched_label || 'Window'}: ${found.content || found.area_str || ''} (${found.source})`;
    showTooltip(e.clientX, e.clientY, found);
  } else {
    el.canvasWrapper.style.cursor = 'grab';
    el.lblHoverItem.textContent = 'Hover over a window to inspect';
    el.canvasTooltip.classList.add('hidden');
  }

  renderCanvas();
}

function handleMouseUp() {
  state.isPanning = false;
  el.canvasWrapper.style.cursor = 'grab';
}

function handleWheel(e) {
  e.preventDefault();
  const rect = el.canvasWrapper.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  zoomAt(mouseX, mouseY, factor);
}

function showTooltip(clientX, clientY, item) {
  const tt = el.canvasTooltip;
  const rect = el.canvasWrapper.getBoundingClientRect();

  const relX = clientX - rect.left + 15;
  const relY = clientY - rect.top + 15;

  let html = `<strong>${item.type || item.matched_label || 'Window'}</strong><br>`;
  html += `Area: <strong>${item.content || item.area_str || 'N/A'}</strong><br>`;
  if (item.width_pt && item.height_pt) {
    html += `Size: ${item.width_pt} × ${item.height_pt} pt<br>`;
  }
  html += `Status: <span style="color:${item.source === 'Auto-Completed' ? '#F87171' : '#60A5FA'}">${item.source}</span>`;
  if (item.snapped) {
    html += `<br><span style="color:#34D399">✓ Vector edge snapped</span>`;
    html += `<br>Shift: (${item.shift[0]}, ${item.shift[1]}) pt`;
  }

  tt.innerHTML = html;
  tt.style.left = `${relX}px`;
  tt.style.top = `${relY}px`;
  tt.classList.remove('hidden');
}

// ----------------------------------------------------
// MEASUREMENT COMPLETION EXECUTION
// ----------------------------------------------------
async function runMeasurementCompletion() {
  if (!state.serverAvailable) {
    showServerRequiredModal(state.filename);
    return;
  }

  // Gather selected types
  const selectedTypes = [];
  document.querySelectorAll('.chk-type-item:checked').forEach(chk => {
    selectedTypes.push(chk.dataset.type);
  });

  if (selectedTypes.length === 0) {
    alert('Please select at least one window type in Section 2 to complete.');
    return;
  }

  const payload = {
    enable_snap: el.chkEnableSnap.checked,
    search_pt: parseFloat(el.inputSearchRadius.value) || 18.0,
    overlap_distance_threshold: parseFloat(el.inputOverlapThreshold.value) || 16.0,
    types: selectedTypes,
  };

  setLoading(true, 'Completing window area measurements with edge snapping and Bluebeam compatibility...');
  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === 'success') {
      state.hasCompleted = true;
      state.addedCount = data.added_count;
      state.snappedCount = data.snapped_count;
      state.addedAnnotations = data.added_annotations || [];

      // Update success card
      el.metricAddedCount.textContent = data.added_count;
      el.metricTotalWindows.textContent = data.added_count + state.manualRecords.length;
      if (el.completionSuccessCard) el.completionSuccessCard.classList.remove('hidden');

      // Refresh current page viewer to show newly added markups
      loadPagePreview(state.currentPage);
      el.sectionViewer.scrollIntoView({ behavior: 'smooth' });
    } else {
      alert('Completion error: ' + (data.error || 'Failed to complete measurements'));
    }
  } catch (err) {
    alert('Execution failed: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
function setLoading(show, text = 'Processing...') {
  // Toggle main button spinner or state
  if (show) {
    el.btnRunCompletion.disabled = true;
    el.btnRunCompletion.innerHTML = `<div class="spinner" style="width:20px;height:20px"></div> <span>${text}</span>`;
  } else {
    el.btnRunCompletion.disabled = false;
    el.btnRunCompletion.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>Complete Window Measurements</span>`;
  }
}

function setCanvasLoader(show) {
  if (show) el.canvasLoader.classList.remove('hidden');
  else el.canvasLoader.classList.add('hidden');
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
