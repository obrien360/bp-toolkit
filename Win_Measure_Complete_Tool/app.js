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
  tagSummary: [],
  tagStatusOptions: [],
  selectedTagStatuses: null,
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

  // Layer visibility - Engine color coding: Manual (Blue), Good (Green), Problem (Orange)
  showManual: true,
  showGood: true,
  showProblem: true,

  // Completion metrics
  hasCompleted: false,
  addedCount: 0,
  snappedCount: 0,

  // Tool 1 (Step 1) state
  tool1File: null,
  tool1JobId: null,
  tool1PollTimer: null
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

  // Sections (Workflow: 1. Upload -> 2. Execute -> 3. Tag Summary -> 4. Viewer)
  sectionUpload: document.getElementById('sectionUpload'),
  sectionExecute: document.getElementById('sectionExecute'),
  sectionTagSummary: document.getElementById('sectionTagSummary'),
  sectionViewer: document.getElementById('sectionViewer'),

  // Settings
  btnToggleSettings: document.getElementById('btnToggleSettings'),
  settingsPanel: document.getElementById('settingsPanel'),
  chkEnableSnap: document.getElementById('chkEnableSnap'),
  inputSearchRadius: document.getElementById('inputSearchRadius'),
  inputOverlapThreshold: document.getElementById('inputOverlapThreshold'),

  // Tag Summary Table
  tableTagSummary: document.getElementById('tableTagSummary'),
  tbodyTagSummary: document.getElementById('tbodyTagSummary'),
  btnTagStatusFilter: document.getElementById('btnTagStatusFilter'),

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

  // Layer toggles with engine color coding
  chkShowManual: document.getElementById('chkShowManual'),
  chkShowGood: document.getElementById('chkShowGood'),
  chkShowProblem: document.getElementById('chkShowProblem'),
  pillShowManual: document.getElementById('pillShowManual'),
  pillShowGood: document.getElementById('pillShowGood'),
  pillShowProblem: document.getElementById('pillShowProblem'),

  // Execution & Export
  btnRunCompletion: document.getElementById('btnRunCompletion'),
  completionSuccessCard: document.getElementById('completionSuccessCard'),
  metricAddedCount: document.getElementById('metricAddedCount'),
  metricTotalWindows: document.getElementById('metricTotalWindows'),
  btnDownloadPDF: document.getElementById('btnDownloadPDF'),
  btnExportCSV: document.getElementById('btnExportCSV'),
  btnExportTagSummary: document.getElementById('btnExportTagSummary'),

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
  btnCopyRunCmdModal: document.getElementById('btnCopyRunCmdModal'),
  inputBackendUrl: document.getElementById('inputBackendUrl'),
  btnSaveBackendUrl: document.getElementById('btnSaveBackendUrl'),

  // Tool 1 (Step 1)
  tool1DropZone: document.getElementById('tool1DropZone'),
  tool1FileInput: document.getElementById('tool1FileInput'),
  btnTool1Browse: document.getElementById('btnTool1Browse'),
  tool1FileBar: document.getElementById('tool1FileBar'),
  tool1FileName: document.getElementById('tool1FileName'),
  tool1FileSize: document.getElementById('tool1FileSize'),
  tool1ScalePreview: document.getElementById('tool1ScalePreview'),
  btnTool1ChangeFile: document.getElementById('btnTool1ChangeFile'),
  btnRunTool1: document.getElementById('btnRunTool1'),
  btnToggleTool1Advanced: document.getElementById('btnToggleTool1Advanced'),
  tool1AdvancedPanel: document.getElementById('tool1AdvancedPanel'),
  inputTool1Scale: document.getElementById('inputTool1Scale'),
  inputTool1SkipPages: document.getElementById('inputTool1SkipPages'),
  inputTool1Types: document.getElementById('inputTool1Types'),
  inputTool1ExcludeTypes: document.getElementById('inputTool1ExcludeTypes'),
  chkTool1IgnoreExisting: document.getElementById('chkTool1IgnoreExisting'),
  tool1ProgressBox: document.getElementById('tool1ProgressBox'),
  tool1Spinner: document.getElementById('tool1Spinner'),
  tool1StatusText: document.getElementById('tool1StatusText'),
  tool1ProgressLog: document.getElementById('tool1ProgressLog'),
  tool1ErrorBox: document.getElementById('tool1ErrorBox'),
  tool1ErrorText: document.getElementById('tool1ErrorText'),
  tool1ResultBox: document.getElementById('tool1ResultBox'),
  tool1ProposedCount: document.getElementById('tool1ProposedCount'),
  tool1LowMedCount: document.getElementById('tool1LowMedCount'),
  btnDownloadTool1Examples: document.getElementById('btnDownloadTool1Examples'),
  btnDownloadTool1Report: document.getElementById('btnDownloadTool1Report'),
  btnUseTool1InStep2: document.getElementById('btnUseTool1InStep2'),
  tbodyTool1Report: document.getElementById('tbodyTool1Report')
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
  setupTagStatusFilter();

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
  if (el.chkShowGood) {
    el.chkShowGood.addEventListener('change', e => {
      state.showGood = e.target.checked;
      if (el.pillShowGood) el.pillShowGood.classList.toggle('active', state.showGood);
      renderCanvas();
    });
  }
  if (el.chkShowProblem) {
    el.chkShowProblem.addEventListener('change', e => {
      state.showProblem = e.target.checked;
      if (el.pillShowProblem) el.pillShowProblem.classList.toggle('active', state.showProblem);
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

  // Cloud backend URL configuration in settings
  if (el.btnSaveBackendUrl && el.inputBackendUrl) {
    el.btnSaveBackendUrl.addEventListener('click', () => {
      const url = el.inputBackendUrl.value.trim();
      if (url) {
        localStorage.setItem(CLOUD_BACKEND_CONFIG.storageKey, url);
      } else {
        localStorage.removeItem(CLOUD_BACKEND_CONFIG.storageKey);
      }
      checkServerStatus();
    });
    el.inputBackendUrl.value = localStorage.getItem(CLOUD_BACKEND_CONFIG.storageKey) || CLOUD_BACKEND_CONFIG.defaultUrl;
  }

  // Window resize
  window.addEventListener('resize', debounce(resizeCanvas, 150));

  // Tool 1 (Step 1) events
  if (el.btnTool1Browse) el.btnTool1Browse.addEventListener('click', () => el.tool1FileInput.click());
  if (el.btnTool1ChangeFile) el.btnTool1ChangeFile.addEventListener('click', () => el.tool1FileInput.click());
  if (el.tool1FileInput) {
    el.tool1FileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) selectTool1File(file);
    });
  }
  if (el.tool1DropZone) {
    ['dragenter', 'dragover'].forEach(ev => {
      el.tool1DropZone.addEventListener(ev, e => {
        e.preventDefault();
        el.tool1DropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      el.tool1DropZone.addEventListener(ev, e => {
        e.preventDefault();
        el.tool1DropZone.classList.remove('dragover');
      });
    });
    el.tool1DropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please drop a PDF file.');
        return;
      }
      selectTool1File(file);
    });
  }
  if (el.btnToggleTool1Advanced && el.tool1AdvancedPanel) {
    el.btnToggleTool1Advanced.addEventListener('click', () => {
      el.tool1AdvancedPanel.classList.toggle('hidden');
    });
  }
  if (el.inputTool1Scale && el.tool1ScalePreview) {
    el.inputTool1Scale.addEventListener('input', () => {
      const val = el.inputTool1Scale.value.trim();
      el.tool1ScalePreview.textContent = val ? `Scale: ${val}` : 'Scale: auto-detect';
    });
  }
  if (el.btnRunTool1) el.btnRunTool1.addEventListener('click', runTool1);
  if (el.btnUseTool1InStep2) el.btnUseTool1InStep2.addEventListener('click', sendTool1ToStep2);
}

// ----------------------------------------------------
// BACKEND ROUTING & SERVER COMMUNICATION
// ----------------------------------------------------
const CLOUD_BACKEND_CONFIG = {
  defaultUrl: 'https://jireh360-ob360-win-measure.hf.space',
  storageKey: 'ob360_win_measure_backend_url'
};

function isLocalEnvironment() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) && window.location.protocol !== 'file:';
}

function getBackendUrl() {
  if (isLocalEnvironment()) {
    return ''; // Same-origin on local machine
  }
  const custom = localStorage.getItem(CLOUD_BACKEND_CONFIG.storageKey);
  return (custom || CLOUD_BACKEND_CONFIG.defaultUrl).trim().replace(/\/$/, '');
}

function apiUrl(endpoint) {
  const base = getBackendUrl();
  return base ? `${base}${endpoint}` : endpoint;
}

async function checkServerStatus() {
  const isLocal = isLocalEnvironment();
  const testUrl = apiUrl('/api/status');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(testUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      setServerStatus(true, isLocal ? 'Local Server Connected' : 'Cloud Backend Connected');
      if (data.loaded && data.has_analysis) {
        state.filename = data.filename;
        state.pageCount = data.page_count;
        rescanLabels();
      }
    } else {
      setServerStatus(false, isLocal ? 'Local Server Required' : 'Cloud Backend Offline');
    }
  } catch (err) {
    setServerStatus(false, isLocal ? 'Local Server Required' : 'Cloud Backend Offline');
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
      const res = await fetch(apiUrl('/api/load-sample'), { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          applyAnalysisData(data);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Backend load-sample failed, falling back to demo data:', err);
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
      const res = await fetch(apiUrl('/api/upload'), {
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
    const res = await fetch(apiUrl('/api/analyze'), {
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
  state.tagSummary = [];

  // Update File Info Card
  el.activeFileName.textContent = data.filename;
  el.detectedPagesBadge.textContent = `${data.page_count} Elevation Pages`;
  el.detectedManualBadge.textContent = `${data.manual_measurements_count} Manual Measurements`;
  el.detectedTypesBadge.textContent = `${data.learned_types_count} Window Types Learned`;

  el.fileInfoCard.classList.remove('hidden');

  // Workflow order: Show Section 2 (Execute Measurement Completion)
  if (el.sectionExecute) el.sectionExecute.classList.remove('hidden');

  // Hide Section 3 & 4 until user runs completion
  if (el.sectionTagSummary) el.sectionTagSummary.classList.add('hidden');
  if (el.sectionViewer) el.sectionViewer.classList.add('hidden');
  if (el.completionSuccessCard) el.completionSuccessCard.classList.add('hidden');

  // Populate Page Dropdown
  el.selectPageDropdown.innerHTML = '';
  for (let i = 0; i < data.page_count; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Sheet ${i + 1}`;
    el.selectPageDropdown.appendChild(opt);
  }
  el.lblTotalPages.textContent = data.page_count;

  // If sample data already includes engine tag summary, render it directly
  if (data.tag_summary && data.tag_summary.length > 0) {
    state.hasCompleted = true;
    state.tagSummary = data.tag_summary;
    state.addedAnnotations = data.completion_result?.added_annotations || [];
    renderTagSummaryTable(data.tag_summary, true);
    if (el.sectionTagSummary) el.sectionTagSummary.classList.remove('hidden');
    if (el.sectionViewer) el.sectionViewer.classList.remove('hidden');
    if (el.completionSuccessCard) {
      const added = data.completion_result?.added_count || state.addedAnnotations.length;
      el.metricAddedCount.textContent = added;
      el.metricTotalWindows.textContent = added + state.manualRecords.length;
      el.completionSuccessCard.classList.remove('hidden');
    }
    state.currentPage = 0;
    loadPagePreview(0);
  }

  // Smooth scroll to Section 2
  el.sectionExecute.scrollIntoView({ behavior: 'smooth' });
}

function renderTagSummaryTable(items, resetStatusFilter = false) {
  if (!el.tbodyTagSummary) return;
  el.tbodyTagSummary.innerHTML = '';

  if (!items || items.length === 0) {
    state.tagStatusOptions = [];
    if (resetStatusFilter) state.selectedTagStatuses = null;
    el.tbodyTagSummary.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--ob-text-muted);padding:24px;">No tag summary data returned</td></tr>`;
    return;
  }

  const statuses = Array.from(new Set(items.map(row => row.status).filter(Boolean))).sort();
  const optionsChanged = statuses.length !== state.tagStatusOptions.length ||
    statuses.some((status, index) => status !== state.tagStatusOptions[index]);
  if (resetStatusFilter || optionsChanged) {
    state.selectedTagStatuses = null;
  }
  state.tagStatusOptions = statuses;

  const visibleItems = items.filter(row =>
    !state.selectedTagStatuses || state.selectedTagStatuses.has(row.status)
  );
  if (visibleItems.length === 0) {
    el.tbodyTagSummary.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--ob-text-muted);padding:24px;">No rows match the selected statuses</td></tr>`;
    return;
  }

  visibleItems.forEach(row => {
    const tr = document.createElement('tr');

    // tag
    const tdTag = document.createElement('td');
    tdTag.innerHTML = `<span class="type-badge">${row.tag}</span>`;
    tr.appendChild(tdTag);

    // status with colored badge
    const tdStatus = document.createElement('td');
    let badgeClass = 'status-badge ';
    if (row.status === 'COMPLETE') badgeClass += 'complete';
    else if (row.status === 'COMPLETE WITH REVIEW') badgeClass += 'complete-with-review';
    else if (row.status === 'PARTIALLY COMPLETED') badgeClass += 'partially-completed';
    else badgeClass += 'no-manual-example';
    tdStatus.innerHTML = `<span class="${badgeClass}">${row.status}</span>`;
    tr.appendChild(tdStatus);

    // occurrences
    const tdOcc = document.createElement('td');
    tdOcc.innerHTML = `<strong>${row.occurrences}</strong>`;
    tr.appendChild(tdOcc);

    // manual
    const tdMan = document.createElement('td');
    tdMan.textContent = row.manual;
    tr.appendChild(tdMan);

    // good_added
    const tdGood = document.createElement('td');
    tdGood.innerHTML = row.good_added > 0 ? `<strong style="color:#009E73">+${row.good_added}</strong>` : '0';
    tr.appendChild(tdGood);

    // problem_added
    const tdProb = document.createElement('td');
    tdProb.innerHTML = row.problem_added > 0 ? `<strong style="color:#D55E00">${row.problem_added}</strong>` : '0';
    tr.appendChild(tdProb);

    // unmeasured
    const tdUnm = document.createElement('td');
    tdUnm.innerHTML = row.unmeasured > 0 ? `<span style="color:#C5221F;font-weight:600;">${row.unmeasured}</span>` : '0';
    tr.appendChild(tdUnm);

    // reason
    const tdReason = document.createElement('td');
    tdReason.style.color = row.reason ? 'var(--ob-text)' : 'var(--ob-text-muted)';
    tdReason.textContent = row.reason || '-';
    tr.appendChild(tdReason);

    el.tbodyTagSummary.appendChild(tr);
  });
}

function setupTagStatusFilter() {
  if (!el.btnTagStatusFilter) return;

  const popup = document.createElement('div');
  popup.className = 'tag-status-filter-popup hidden';
  popup.setAttribute('role', 'group');
  popup.setAttribute('aria-label', 'Filter tag summary by status');
  document.body.appendChild(popup);

  const closePopup = () => {
    popup.classList.add('hidden');
    el.btnTagStatusFilter.setAttribute('aria-expanded', 'false');
  };

  const renderOptions = () => {
    const selected = state.selectedTagStatuses || new Set(state.tagStatusOptions);
    const actions = document.createElement('div');
    actions.className = 'tag-status-filter-actions';

    const selectAllButton = document.createElement('button');
    selectAllButton.type = 'button';
    selectAllButton.textContent = 'Select all';
    selectAllButton.addEventListener('click', () => {
      state.selectedTagStatuses = null;
      renderTagSummaryTable(state.tagSummary);
      renderOptions();
    });

    const deselectAllButton = document.createElement('button');
    deselectAllButton.type = 'button';
    deselectAllButton.textContent = 'Deselect all';
    deselectAllButton.addEventListener('click', () => {
      state.selectedTagStatuses = new Set();
      renderTagSummaryTable(state.tagSummary);
      renderOptions();
    });
    actions.append(selectAllButton, deselectAllButton);

    const options = document.createElement('div');
    options.className = 'tag-status-filter-options';
    state.tagStatusOptions.forEach(status => {
      const label = document.createElement('label');
      label.className = 'tag-status-filter-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = status;
      checkbox.checked = selected.has(status);
      checkbox.addEventListener('change', () => {
        const nextSelected = new Set(state.selectedTagStatuses || state.tagStatusOptions);
        if (checkbox.checked) nextSelected.add(status);
        else nextSelected.delete(status);
        state.selectedTagStatuses = nextSelected.size === state.tagStatusOptions.length
          ? null
          : nextSelected;
        renderTagSummaryTable(state.tagSummary);
      });
      label.append(checkbox, document.createTextNode(status));
      options.appendChild(label);
    });

    popup.replaceChildren(actions, options);
  };

  const openPopup = () => {
    renderOptions();
    popup.classList.remove('hidden');
    el.btnTagStatusFilter.setAttribute('aria-expanded', 'true');
    const bounds = el.btnTagStatusFilter.getBoundingClientRect();
    const popupBounds = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - popupBounds.width - 8));
    const top = Math.min(bounds.bottom + 4, window.innerHeight - popupBounds.height - 8);
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(8, top)}px`;
  };

  el.btnTagStatusFilter.addEventListener('click', () => {
    if (popup.classList.contains('hidden')) openPopup();
    else closePopup();
  });
  popup.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', event => {
    if (!popup.contains(event.target) && event.target !== el.btnTagStatusFilter) closePopup();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePopup();
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
    const res = await fetch(apiUrl(`/api/page-preview?page=${pageIdx}&mode=${mode}&zoom=1.4`));
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

  // 1. Manual markups (Engine Blue: #0072B2)
  if (state.showManual) {
    const pageManuals = state.manualRecords.filter(m => m.page === state.currentPage);
    pageManuals.forEach(m => {
      const r = m.rect;
      const x = r[0] * rasterScale;
      const y = r[1] * rasterScale;
      const w = (r[2] - r[0]) * rasterScale;
      const h = (r[3] - r[1]) * rasterScale;

      ctx.strokeStyle = '#0072B2';
      ctx.lineWidth = 2.5 / state.zoom;
      ctx.strokeRect(x, y, w, h);
    });
  }

  // 2. Auto-Completed markups matching Engine color coding:
  // Good: #009E73 (Bluish Green)
  // Problem / Review: #D55E00 (Vermillion / Orange)
  if (state.hasCompleted) {
    const pageCompleted = state.addedAnnotations.filter(a => a.page === (state.currentPage + 1));
    pageCompleted.forEach(a => {
      const isProb = Boolean(a.problem);
      if (isProb && !state.showProblem) return;
      if (!isProb && !state.showGood) return;

      const strokeColor = isProb ? '#D55E00' : '#009E73';
      const r = a.rect;
      const x = r[0] * rasterScale;
      const y = r[1] * rasterScale;
      const w = (r[2] - r[0]) * rasterScale;
      const h = (r[3] - r[1]) * rasterScale;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5 / state.zoom;
      ctx.strokeRect(x, y, w, h);
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
  if (state.hasCompleted) {
    const pageCompleted = state.addedAnnotations.filter(a => a.page === (state.currentPage + 1));
    for (const a of pageCompleted) {
      const isProb = Boolean(a.problem);
      if (isProb && !state.showProblem) continue;
      if (!isProb && !state.showGood) continue;
      if (pdfX >= a.rect[0] && pdfX <= a.rect[2] && pdfY >= a.rect[1] && pdfY <= a.rect[3]) {
        found = { ...a, source: isProb ? 'Flagged for Review' : 'Auto-Completed (Good)' };
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

  const isProb = Boolean(item.problem);
  const color = item.source === 'Manual Ground Truth' ? '#0072B2' : (isProb ? '#D55E00' : '#009E73');

  let html = `<strong>${item.type || item.matched_label || 'Window'}</strong><br>`;
  html += `Area: <strong>${item.content || item.area_str || 'N/A'}</strong><br>`;
  if (item.width_pt && item.height_pt) {
    html += `Size: ${item.width_pt} × ${item.height_pt} pt<br>`;
  }
  html += `Status: <span style="color:${color};font-weight:600;">${item.source}</span>`;
  if (item.review) {
    html += `<br><span style="color:#D55E00">⚠️ ${item.review}</span>`;
  }
  if (item.snapped) {
    html += `<br><span style="color:#009E73">✓ Vector edge snapped</span>`;
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
    // If running offline demo, use precomputed data
    if (state.tagSummary && state.tagSummary.length > 0) {
      applyCompletedDemo();
      return;
    }
    showServerRequiredModal(state.filename);
    return;
  }

  const payload = {
    enable_snap: el.chkEnableSnap.checked,
    search_pt: parseFloat(el.inputSearchRadius.value) || 18.0,
    overlap_distance_threshold: parseFloat(el.inputOverlapThreshold.value) || 16.0,
    types: null // Complete all learned types
  };

  setLoading(true, 'Completing window area measurements with edge snapping and Bluebeam compatibility...');
  try {
    const res = await fetch(apiUrl('/api/process'), {
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
      state.tagSummary = data.tag_summary || [];

      // Update success card
      el.metricAddedCount.textContent = data.added_count;
      el.metricTotalWindows.textContent = data.added_count + state.manualRecords.length;
      if (el.completionSuccessCard) el.completionSuccessCard.classList.remove('hidden');

      // Update download links to point to backend endpoint
      if (el.btnDownloadPDF) el.btnDownloadPDF.href = apiUrl('/api/download');
      if (el.btnExportCSV) el.btnExportCSV.href = apiUrl('/api/export-csv');
      if (el.btnExportTagSummary) el.btnExportTagSummary.href = apiUrl('/api/export-tag-summary');

      // Render Tag Summary in Section 3
      renderTagSummaryTable(state.tagSummary, true);
      if (el.sectionTagSummary) el.sectionTagSummary.classList.remove('hidden');

      // Show Section 4 (Viewer) and refresh with engine markups
      if (el.sectionViewer) el.sectionViewer.classList.remove('hidden');
      loadPagePreview(state.currentPage);

      // Smooth scroll to Section 3 (Tag Summary)
      el.sectionTagSummary.scrollIntoView({ behavior: 'smooth' });
    } else {
      alert('Completion error: ' + (data.error || 'Failed to complete measurements'));
    }
  } catch (err) {
    alert('Execution failed: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function applyCompletedDemo() {
  state.hasCompleted = true;
  el.metricAddedCount.textContent = state.addedCount || state.addedAnnotations.length;
  el.metricTotalWindows.textContent = (state.addedCount || state.addedAnnotations.length) + state.manualRecords.length;
  if (el.completionSuccessCard) el.completionSuccessCard.classList.remove('hidden');

  renderTagSummaryTable(state.tagSummary, true);
  if (el.sectionTagSummary) el.sectionTagSummary.classList.remove('hidden');
  if (el.sectionViewer) el.sectionViewer.classList.remove('hidden');
  renderCanvas();
  el.sectionTagSummary.scrollIntoView({ behavior: 'smooth' });
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

// ----------------------------------------------------
// TOOL 1 (STEP 1: PROPOSE WINDOW EXAMPLES)
// ----------------------------------------------------
function selectTool1File(file) {
  if (!state.serverAvailable) {
    showServerRequiredModal(file.name);
    return;
  }
  state.tool1File = file;
  if (el.tool1FileName) el.tool1FileName.textContent = file.name;
  if (el.tool1FileSize) el.tool1FileSize.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  if (el.tool1DropZone) el.tool1DropZone.classList.add('hidden');
  if (el.tool1FileBar) el.tool1FileBar.classList.remove('hidden');
  if (el.tool1ErrorBox) el.tool1ErrorBox.classList.add('hidden');
  if (el.tool1ResultBox) el.tool1ResultBox.classList.add('hidden');
  if (el.tool1ProgressBox) el.tool1ProgressBox.classList.add('hidden');
}

async function runTool1() {
  if (!state.serverAvailable) {
    showServerRequiredModal(state.tool1File?.name);
    return;
  }
  if (!state.tool1File) {
    alert('Please select a PDF file for Step 1 first.');
    return;
  }

  if (state.tool1PollTimer) {
    clearInterval(state.tool1PollTimer);
    state.tool1PollTimer = null;
  }

  el.btnRunTool1.disabled = true;
  if (el.tool1ErrorBox) el.tool1ErrorBox.classList.add('hidden');
  if (el.tool1ResultBox) el.tool1ResultBox.classList.add('hidden');
  if (el.tool1ProgressBox) el.tool1ProgressBox.classList.remove('hidden');
  if (el.tool1Spinner) el.tool1Spinner.classList.remove('hidden');
  if (el.tool1StatusText) el.tool1StatusText.textContent = 'Uploading PDF and starting Tool 1...';
  if (el.tool1ProgressLog) el.tool1ProgressLog.textContent = '';

  try {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read selected PDF file'));
      reader.readAsDataURL(state.tool1File);
    });

    const payload = {
      filename: state.tool1File.name,
      file_base64: base64Data,
      scale: el.inputTool1Scale?.value.trim() || '',
      skip_pages: el.inputTool1SkipPages?.value.trim() || '',
      types: el.inputTool1Types?.value.trim() || '',
      exclude_types: el.inputTool1ExcludeTypes?.value.trim() || '',
      ignore_existing: Boolean(el.chkTool1IgnoreExisting?.checked)
    };

    const res = await fetch(apiUrl('/api/examples'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.job_id) {
      throw new Error(data.error || 'Failed to start Tool 1');
    }

    state.tool1JobId = data.job_id;
    if (el.tool1StatusText) el.tool1StatusText.textContent = 'Running Tool 1 (typically 1–3 minutes)...';
    pollTool1Status(data.job_id);
    state.tool1PollTimer = setInterval(() => pollTool1Status(data.job_id), 2500);
  } catch (err) {
    showTool1Error(err.message);
  }
}

async function pollTool1Status(jobId) {
  try {
    const res = await fetch(apiUrl(`/api/examples/${jobId}/status`));
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to check Tool 1 status');
    }

    if (el.tool1ProgressLog && Array.isArray(data.progress)) {
      el.tool1ProgressLog.textContent = data.progress.join('\n');
      el.tool1ProgressLog.scrollTop = el.tool1ProgressLog.scrollHeight;
    }
    if (el.tool1StatusText && data.last_line) {
      el.tool1StatusText.textContent = data.last_line;
    }

    if (data.status === 'done') {
      clearInterval(state.tool1PollTimer);
      state.tool1PollTimer = null;
      el.btnRunTool1.disabled = false;
      if (el.tool1Spinner) el.tool1Spinner.classList.add('hidden');
      if (el.tool1StatusText) el.tool1StatusText.textContent = 'Completed';
      renderTool1Results(jobId, data);
    } else if (data.status === 'error') {
      clearInterval(state.tool1PollTimer);
      state.tool1PollTimer = null;
      showTool1Error(data.error || 'Tool 1 failed');
    }
  } catch (err) {
    clearInterval(state.tool1PollTimer);
    state.tool1PollTimer = null;
    showTool1Error(err.message);
  }
}

function showTool1Error(msg) {
  el.btnRunTool1.disabled = false;
  if (el.tool1Spinner) el.tool1Spinner.classList.add('hidden');
  if (el.tool1StatusText) el.tool1StatusText.textContent = 'Failed';
  if (el.tool1ErrorText) el.tool1ErrorText.textContent = msg;
  if (el.tool1ErrorBox) el.tool1ErrorBox.classList.remove('hidden');
}

function renderTool1Results(jobId, data) {
  const rows = data.report_rows || [];
  const proposed = rows.filter(r => r.confidence !== 'not proposed');
  const lowMed = proposed.filter(r => r.confidence === 'Low' || r.confidence === 'Medium');

  if (el.tool1ProposedCount) el.tool1ProposedCount.textContent = proposed.length;
  if (el.tool1LowMedCount) el.tool1LowMedCount.textContent = lowMed.length;
  if (el.btnDownloadTool1Examples) el.btnDownloadTool1Examples.href = apiUrl(`/api/examples/${jobId}/download/examples`);
  if (el.btnDownloadTool1Report) el.btnDownloadTool1Report.href = apiUrl(`/api/examples/${jobId}/download/report`);

  if (el.tbodyTool1Report) {
    el.tbodyTool1Report.innerHTML = '';
    if (rows.length === 0) {
      el.tbodyTool1Report.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--ob-text-muted);padding:16px;">No report rows found</td></tr>';
    } else {
      rows.forEach(r => {
        const tr = document.createElement('tr');
        const conf = (r.confidence || '').toLowerCase();
        const badgeCls = conf === 'high' ? 'high' : (conf === 'medium' ? 'medium' : (conf === 'low' ? 'low' : 'skipped'));
        const agreeTxt = r.agree && r.checked ? `${r.agree}/${r.checked}` : '-';
        tr.innerHTML = `
          <td><span class="type-badge">${r.tag || ''}</span></td>
          <td><span class="conf-badge ${badgeCls}">${r.confidence || ''}</span></td>
          <td>${agreeTxt}</td>
          <td>${r.on_sheet || '-'}</td>
          <td>${r.width || '-'}</td>
          <td>${r.height || '-'}</td>
          <td>${r.area || '-'}</td>
          <td>${r.page || '-'}</td>
          <td>${r.note || '-'}</td>
        `;
        el.tbodyTool1Report.appendChild(tr);
      });
    }
  }

  if (el.tool1ResultBox) el.tool1ResultBox.classList.remove('hidden');
}

async function sendTool1ToStep2() {
  if (!state.tool1JobId) return;
  if (el.btnUseTool1InStep2) el.btnUseTool1InStep2.disabled = true;
  try {
    const res = await fetch(apiUrl(`/api/examples/${state.tool1JobId}/use-in-tool2`), { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.error || 'Failed to load examples PDF into Step 2');
    }
    applyAnalysisData(data);
  } catch (err) {
    alert('Could not load examples PDF into Step 2: ' + err.message);
  } finally {
    if (el.btnUseTool1InStep2) el.btnUseTool1InStep2.disabled = false;
  }
}
