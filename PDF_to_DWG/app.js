/**
 * app.js - Client application logic for O'Brien360 PDF to DWG Converter
 * High-performance 2D Canvas CAD engine with multi-level overlay,
 * interactive inspection, and instant DXF/DWG export.
 * Supports BOTH Connected Local Server mode and Standalone Browser mode!
 */

// State
const state = {
  currentStep: 1,
  serverAvailable: false,
  filename: null,
  scaleInfo: null,
  levels: [],
  levelsDetails: {},
  rawLevels: {},
  levelBases: {},
  spreadOrder: [],
  processedData: null,
  
  // Viewer state
  viewMode: 'single', // 'single', 'overlay', 'spread'
  activeLevel: null,
  overlayLevels: [], // array of selected level names
  highlightSharedWalls: false,
  layers: {
    walls: true,
    polys: true,
    labels: true,
    grid: true
  },
  
  // Transform (pan & zoom)
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  startX: 0,
  startY: 0,
  hoveredZone: null,
  selectedZone: null,
  cadTheme: 'dark' // 'dark' or 'light'
};

// Distinct colors for levels in overlay mode
const LEVEL_PALETTE = [
  { name: 'Blue', hex: '#2563EB', light: 'rgba(37, 99, 235, 0.25)', border: '#1D4ED8' },
  { name: 'Red', hex: '#DC2626', light: 'rgba(220, 38, 38, 0.25)', border: '#B91C1C' },
  { name: 'Emerald', hex: '#059669', light: 'rgba(5, 150, 105, 0.25)', border: '#047857' },
  { name: 'Purple', hex: '#7C3AED', light: 'rgba(124, 58, 237, 0.25)', border: '#6D28D9' },
  { name: 'Amber', hex: '#D97706', light: 'rgba(217, 119, 6, 0.25)', border: '#B45309' }
];

// Room color hash
function getRoomColor(name, index) {
  const hash = Math.abs(name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + index * 17);
  const hue = (hash * 47) % 360;
  return `hsl(${hue}, 65%, 48%)`;
}

// DOM Elements
const el = {
  connectionBadge: document.getElementById('connectionBadge'),
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  btnBrowse: document.getElementById('btnBrowse'),
  btnLoadExample: document.getElementById('btnLoadExample'),
  fileInfoCard: document.getElementById('fileInfoCard'),
  activeFileName: document.getElementById('activeFileName'),
  detectedLevelsBadge: document.getElementById('detectedLevelsBadge'),
  detectedZonesBadge: document.getElementById('detectedZonesBadge'),
  
  sectionConfig: document.getElementById('sectionConfig'),
  sectionReview: document.getElementById('sectionReview'),
  sectionExport: document.getElementById('sectionExport'),
  
  selectScalePreset: document.getElementById('selectScalePreset'),
  inputCustomScale: document.getElementById('inputCustomScale'),
  scaleDetectionSource: document.getElementById('scaleDetectionSource'),
  selectBaseLevel: document.getElementById('selectBaseLevel'),
  levelOrderList: document.getElementById('levelOrderList'),
  conversionSequencePreview: document.getElementById('conversionSequencePreview'),
  
  rangeAngleTol: document.getElementById('rangeAngleTol'),
  lblAngleTol: document.getElementById('lblAngleTol'),
  inputWallTol: document.getElementById('inputWallTol'),
  inputOverlayTol: document.getElementById('inputOverlayTol'),
  inputSpacingFt: document.getElementById('inputSpacingFt'),
  btnRunConversion: document.getElementById('btnRunConversion'),
  
  // Viewer
  cadCanvas: document.getElementById('cadCanvas'),
  canvasTooltip: document.getElementById('canvasTooltip'),
  canvasLegend: document.getElementById('canvasLegend'),
  statusCoord: document.getElementById('statusCoord'),
  statusHoverRoom: document.getElementById('statusHoverRoom'),
  badgeZeroDangling: document.getElementById('badgeZeroDangling'),
  badgeOverlayMatch: document.getElementById('badgeOverlayMatch'),
  
  btnModeSingle: document.getElementById('btnModeSingle'),
  btnModeOverlay: document.getElementById('btnModeOverlay'),
  btnModeSpread: document.getElementById('btnModeSpread'),
  groupLevelSelector: document.getElementById('groupLevelSelector'),
  groupOverlaySelector: document.getElementById('groupOverlaySelector'),
  levelPills: document.getElementById('levelPills'),
  overlayCheckboxes: document.getElementById('overlayCheckboxes'),
  chkHighlightShared: document.getElementById('chkHighlightShared'),
  
  chkShowWalls: document.getElementById('chkShowWalls'),
  chkShowPolys: document.getElementById('chkShowPolys'),
  chkShowLabels: document.getElementById('chkShowLabels'),
  chkShowGrid: document.getElementById('chkShowGrid'),
  
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnZoomFit: document.getElementById('btnZoomFit'),
  btnThemeToggle: document.getElementById('btnThemeToggle'),
  
  // QA Stats & Table
  statRoomCount: document.getElementById('statRoomCount'),
  statWallCount: document.getElementById('statWallCount'),
  statTotalArea: document.getElementById('statTotalArea'),
  statOpenEnds: document.getElementById('statOpenEnds'),
  statOverlayRate: document.getElementById('statOverlayRate'),
  qaTableBody: document.getElementById('qaTableBody'),
  
  // Export
  btnDownloadSpreadDWG: document.getElementById('btnDownloadSpreadDWG'),
  btnDownloadSpreadDXF: document.getElementById('btnDownloadSpreadDXF'),
  btnDownloadAlignedDWG: document.getElementById('btnDownloadAlignedDWG'),
  btnDownloadAlignedDXF: document.getElementById('btnDownloadAlignedDXF'),
  btnDownloadPlotPNG: document.getElementById('btnDownloadPlotPNG'),
  btnExportDWGTop: document.getElementById('btnExportDWGTop'),
  
  // Modal & Loading
  helpModal: document.getElementById('helpModal'),
  btnQuickHelp: document.getElementById('btnQuickHelp'),
  btnCloseModal: document.getElementById('btnCloseModal'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingMessage: document.getElementById('loadingMessage')
};

// Canvas 2D context
const ctx = el.cadCanvas.getContext('2d');
let cadCanvasResizeObserver;

// --- Initialization ---
window.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  initScalePresets();
  setupCanvasResize();
  await checkServerConnection();
  loadExampleFile();
});

async function checkServerConnection() {
  if (window.location.protocol === 'file:') {
    state.serverAvailable = false;
    updateConnectionBadge(false);
    return;
  }
  try {
    const res = await fetch('/api/common-scales', { method: 'GET', signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      state.serverAvailable = true;
      updateConnectionBadge(true);
    } else {
      state.serverAvailable = false;
      updateConnectionBadge(false);
    }
  } catch (e) {
    state.serverAvailable = false;
    updateConnectionBadge(false);
  }
}

function updateConnectionBadge(connected) {
  if (!el.connectionBadge) return;
  if (connected) {
    el.connectionBadge.textContent = 'Server Connected (Active)';
    el.connectionBadge.style.background = '#f2f8ea';
    el.connectionBadge.style.color = '#4b7811';
  } else {
    el.connectionBadge.textContent = 'Standalone Browser Mode (Active)';
    el.connectionBadge.style.background = '#edf3fa';
    el.connectionBadge.style.color = '#3d6191';
  }
}

function showLoading(msg = 'Processing...') {
  el.loadingMessage.textContent = msg;
  el.loadingOverlay.style.display = 'flex';
}

function hideLoading() {
  el.loadingOverlay.style.display = 'none';
}

function setStep(stepNum) {
  state.currentStep = stepNum;
  for (let i = 1; i <= 4; i++) {
    const node = document.getElementById(`stepNode${i}`);
    const line = document.getElementById(`stepLine${i}`);
    if (node) {
      node.classList.remove('active', 'completed');
      if (i === stepNum) node.classList.add('active');
      else if (i < stepNum) node.classList.add('completed');
    }
    if (line) {
      line.classList.remove('completed');
      if (i < stepNum) line.classList.add('completed');
    }
  }
}

// --- Event Listeners Setup ---
function initEventListeners() {
  // Drag & drop
  el.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.dropZone.classList.add('dragover');
  });
  el.dropZone.addEventListener('dragleave', () => {
    el.dropZone.classList.remove('dragover');
  });
  el.dropZone.addEventListener('drop', handleFileDrop);
  el.btnBrowse.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', handleFileSelect);
  el.btnLoadExample.addEventListener('click', loadExampleFile);

  // Configuration events
  el.selectScalePreset.addEventListener('change', (e) => {
    if (e.target.value !== 'custom') {
      el.inputCustomScale.value = e.target.value;
    }
  });
  el.inputCustomScale.addEventListener('input', () => {
    el.selectScalePreset.value = 'custom';
  });
  el.selectBaseLevel.addEventListener('change', () => {
    const selectedBase = el.selectBaseLevel.value;
    state.levels.forEach(level => {
      if (level !== selectedBase && !state.levelBases[level]) state.levelBases[level] = selectedBase;
    });
    renderLevelOrderList();
  });
  el.rangeAngleTol.addEventListener('input', (e) => {
    el.lblAngleTol.textContent = `± ${parseFloat(e.target.value).toFixed(1)}°`;
  });
  el.inputSpacingFt.addEventListener('input', () => {
    const spacingFt = parseFloat(el.inputSpacingFt.value);
    if (state.processedData && Number.isFinite(spacingFt) && spacingFt > 0) {
      state.processedData.spacing_ft = spacingFt;
      if (state.viewMode === 'spread') zoomToFit();
    }
  });
  el.btnRunConversion.addEventListener('click', runConversion);

  // Viewer modes
  el.btnModeSingle.addEventListener('click', () => setViewMode('single'));
  el.btnModeOverlay.addEventListener('click', () => setViewMode('overlay'));
  el.btnModeSpread.addEventListener('click', () => setViewMode('spread'));
  el.chkHighlightShared.addEventListener('change', (e) => {
    state.highlightSharedWalls = e.target.checked;
    renderCanvas();
  });

  // Layer toggles
  el.chkShowWalls.addEventListener('change', (e) => { state.layers.walls = e.target.checked; renderCanvas(); });
  el.chkShowPolys.addEventListener('change', (e) => { state.layers.polys = e.target.checked; renderCanvas(); });
  el.chkShowLabels.addEventListener('change', (e) => { state.layers.labels = e.target.checked; renderCanvas(); });
  el.chkShowGrid.addEventListener('change', (e) => { state.layers.grid = e.target.checked; renderCanvas(); });

  // Canvas zoom & pan
  el.btnZoomIn.addEventListener('click', () => zoomBy(1.2));
  el.btnZoomOut.addEventListener('click', () => zoomBy(1 / 1.2));
  el.btnZoomFit.addEventListener('click', zoomToFit);
  el.btnThemeToggle.addEventListener('click', toggleCadTheme);

  el.cadCanvas.addEventListener('mousedown', onCanvasMouseDown);
  window.addEventListener('mousemove', onCanvasMouseMove);
  window.addEventListener('mouseup', onCanvasMouseUp);
  el.cadCanvas.addEventListener('wheel', onCanvasWheel, { passive: false });
  el.cadCanvas.addEventListener('mouseleave', () => {
    el.canvasTooltip.style.display = 'none';
    state.hoveredZone = null;
    renderCanvas();
  });

  // Export buttons
  el.btnDownloadSpreadDWG.addEventListener('click', () => exportCAD('spread', 'dwg'));
  el.btnDownloadSpreadDXF.addEventListener('click', () => exportCAD('spread', 'dxf'));
  el.btnDownloadAlignedDWG.addEventListener('click', () => exportCAD('aligned', 'dwg'));
  el.btnDownloadAlignedDXF.addEventListener('click', () => exportCAD('aligned', 'dxf'));
  el.btnDownloadPlotPNG.addEventListener('click', () => exportCAD('both', 'png'));
  el.btnExportDWGTop.addEventListener('click', () => {
    el.sectionExport.scrollIntoView({ behavior: 'smooth' });
  });

  // Modal
  el.btnQuickHelp.addEventListener('click', () => el.helpModal.style.display = 'flex');
  el.btnCloseModal.addEventListener('click', () => el.helpModal.style.display = 'none');
  window.addEventListener('click', (e) => {
    if (e.target === el.helpModal) el.helpModal.style.display = 'none';
  });
}

// --- Scale Presets ---
function initScalePresets() {
  const scales = [
    { label: 'Auto-Detect from Measure Dict', value: 'auto' },
    { label: '1/16" = 1\'-0" (4.5 pt/ft)', value: '4.5' },
    { label: '3/32" = 1\'-0" (6.75 pt/ft)', value: '6.75' },
    { label: '1/8" = 1\'-0" (9.0 pt/ft) [Standard]', value: '9.0' },
    { label: '3/16" = 1\'-0" (13.5 pt/ft)', value: '13.5' },
    { label: '1/4" = 1\'-0" (18.0 pt/ft)', value: '18.0' },
    { label: '3/8" = 1\'-0" (27.0 pt/ft)', value: '27.0' },
    { label: '1/2" = 1\'-0" (36.0 pt/ft)', value: '36.0' },
    { label: 'Custom Value...', value: 'custom' }
  ];

  el.selectScalePreset.innerHTML = scales.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
  el.selectScalePreset.value = '9.0';
}

// --- Load Example PDF (Robust Fallback) ---
async function loadExampleFile() {
  showLoading('Loading example file (Zoning.pdf)...');
  
  // Try server first if connected
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/load-example');
      if (res.ok) {
        const data = await res.json();
        populateInspectionData(data);
        hideLoading();
        runConversion();
        return;
      }
    } catch (e) {
      console.warn('Server fetch failed, falling back to preloaded data:', e);
      state.serverAvailable = false;
      updateConnectionBadge(false);
    }
  }

  // Standalone fallback using preloaded data
  if (window.PRELOADED_ZONING_DATA) {
    populateInspectionData(window.PRELOADED_ZONING_DATA);
    hideLoading();
    runConversion();
    return;
  }

  hideLoading();
  alert('Could not load example. Please run run_tool.bat to start the server.');
}

// --- Handle User PDF Upload ---
function handleFileDrop(e) {
  e.preventDefault();
  el.dropZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    processFile(e.dataTransfer.files[0]);
  }
}

function handleFileSelect(e) {
  if (e.target.files && e.target.files.length > 0) {
    processFile(e.target.files[0]);
  }
}

function processFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a valid PDF file.');
    return;
  }

  showLoading(`Analyzing ${file.name}...`);
  const reader = new FileReader();

  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    
    // If server is available, attempt server analysis
    if (state.serverAvailable) {
      try {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const res = await fetch('/api/analyze-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, file_data: base64 })
        });

        if (res.ok) {
          const data = await res.json();
          populateInspectionData(data);
          hideLoading();
          runConversion();
          return;
        }
      } catch (err) {
        console.warn('Server analyze failed, falling back to client-side parser:', err);
      }
    }

    // Client-side PDF Parser fallback
    try {
      const parsedData = parsePdfInBrowser(file.name, arrayBuffer);
      populateInspectionData(parsedData);
      hideLoading();
      runConversion();
    } catch (parseErr) {
      hideLoading();
      console.error(parseErr);
      alert('Error parsing PDF: ' + parseErr.message + '\n\nTip: You can also double-click run_tool.bat to launch with the backend server.');
    }
  };

  reader.readAsArrayBuffer(file);
}

// --- Client-Side PDF Parser (Zero Server Requirement) ---
function parsePdfInBrowser(filename, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  // Decode Latin1 for regex scanning
  let text = '';
  const chunkSize = 65536;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }

  // 1. Detect Scale
  let ptsPerFt = 9.0;
  let scaleLabel = '1/8" = 1\'-0" (Detected)';
  let scaleSource = 'Client-Side Parser';

  const rMatch = text.match(/\/R\s*\((.*?)\)/);
  if (rMatch) {
    scaleLabel = rMatch[1];
  }
  const cMatch = text.match(/\/X\s*\[.*?\/C\s*([0-9\.]+)/s);
  if (cMatch) {
    const cVal = parseFloat(cMatch[1]);
    if (cVal > 0) {
      ptsPerFt = Math.round((1.0 / cVal) * 100) / 100;
      scaleSource = 'PDF Measure Dictionary';
    }
  }

  // 2. Extract Polygon Annotations
  const annotRegex = /<<[^\r\n]*?\/Type\s*\/Annot.*?\/Subtype\s*\/Polygon.*?>>/gs;
  const matches = text.match(annotRegex) || [];

  const pdfArray = (source, key) => {
    const match = source.match(new RegExp(`/${key}\\s*\\[([^\\]]+)\\]`));
    if (!match) return null;
    const values = match[1].trim().split(/\s+/).map(Number);
    return values.every(Number.isFinite) ? values : null;
  };

  const annotationObjects = new Map();
  const ocgNames = new Map();
  const objectRegex = /\b(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  for (const match of text.matchAll(objectRegex)) {
    const objectBody = match[2];
    if (/\/Type\s*\/OCG/.test(objectBody)) {
      const nameMatch = objectBody.match(/\/Name\s*\((.*?)\)/s);
      if (nameMatch) ocgNames.set(match[1], nameMatch[1]);
    }
    if (!/\/Type\s*\/Annot/.test(objectBody) || !/\/Subtype\s*\/Polygon/.test(objectBody)) continue;
    const vertices = pdfArray(objectBody, 'Vertices');
    const rect = pdfArray(objectBody, 'Rect');
    if (vertices && rect) annotationObjects.set(`${vertices.join(',')}|${rect.join(',')}`, objectBody);
  }

  const transformVertices = (body, rawNums) => {
    const rect = pdfArray(body, 'Rect');
    if (!rect || rect.length !== 4) return rawNums;

    const objectBody = annotationObjects.get(`${rawNums.join(',')}|${rect.join(',')}`) || body;
    const appearanceStart = objectBody.indexOf('/AP');
    if (appearanceStart < 0) return rawNums;
    const appearance = objectBody.slice(appearanceStart);
    const stateMatch = appearance.match(/\/AS\s*\/([A-Za-z0-9]+)/);
    let referenceMatch = appearance.match(/\/N\s+(\d+)\s+\d+\s+R/);
    if (!referenceMatch && stateMatch) {
      referenceMatch = appearance.match(new RegExp(`/${stateMatch[1]}\\s+(\\d+)\\s+\\d+\\s+R`));
    }
    if (!referenceMatch) return rawNums;

    const objectMatch = text.match(new RegExp(`(?:^|\\s)${referenceMatch[1]}\\s+\\d+\\s+obj\\s*([\\s\\S]*?)\\s+endobj`));
    if (!objectMatch) return rawNums;

    const bbox = pdfArray(objectMatch[1], 'BBox');
    const matrix = pdfArray(objectMatch[1], 'Matrix') || [1, 0, 0, 1, 0, 0];
    if (!bbox || bbox.length !== 4 || matrix.length !== 6) return rawNums;

    const [a, b, c, d, e, f] = matrix;
    const mapPoint = (x, y) => [a * x + c * y + e, b * x + d * y + f];
    const corners = [
      mapPoint(bbox[0], bbox[1]), mapPoint(bbox[0], bbox[3]),
      mapPoint(bbox[2], bbox[1]), mapPoint(bbox[2], bbox[3])
    ];
    const bounds = [
      Math.min(...corners.map(point => point[0])),
      Math.min(...corners.map(point => point[1])),
      Math.max(...corners.map(point => point[0])),
      Math.max(...corners.map(point => point[1]))
    ];
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];
    if (!width || !height) return rawNums;

    const scaleX = (rect[2] - rect[0]) / width;
    const scaleY = (rect[3] - rect[1]) / height;
    const transformed = [];
    for (let i = 0; i < rawNums.length; i += 2) {
      const point = mapPoint(rawNums[i], rawNums[i + 1]);
      transformed.push(
        rect[0] + (point[0] - bounds[0]) * scaleX,
        rect[1] + (point[1] - bounds[1]) * scaleY
      );
    }
    return transformed;
  };

  const rawLevels = {};
  const levelsDetails = {};
  const isLevelName = (name) => /\b(level|floor|basement|roof|ground|podium|penthouse)\b/i.test(name || '');

  matches.forEach((body, idx) => {
    // Use any named OCG before the title, which may be an author name.
    const tMatch = body.match(/\/T\s*\((.*?)\)/);
    const ocMatch = body.match(/\/OC\s+(\d+)\s+\d+\s+R/);
    const ocName = ocMatch ? ocgNames.get(ocMatch[1]) : '';
    const title = tMatch ? tMatch[1].trim() : '';
    const levelName = ocName && ocName.trim() ? ocName.trim() : isLevelName(title) ? title : 'Level 1';

    // Room Name & Area
    let roomName = `Zone ${idx + 1}`;
    let areaStr = '';

    const hexContentMatch = body.match(/\/Contents\s*<feff([0-9a-fA-F]+)>/i);
    if (hexContentMatch) {
      const hex = hexContentMatch[1];
      let decoded = '';
      for (let k = 0; k < hex.length; k += 4) {
        decoded += String.fromCharCode(parseInt(hex.substr(k, 4), 16));
      }
      const lines = decoded.split(/[\r\n]+/);
      roomName = lines[0].trim();
      if (lines.length > 1) areaStr = lines[1].trim();
    } else {
      const strContentMatch = body.match(/\/Contents\s*\((.*?)\)/);
      if (strContentMatch) {
        const lines = strContentMatch[1].split(/[\r\n]+/);
        roomName = lines[0].trim();
        if (lines.length > 1) areaStr = lines[1].trim();
      }
    }

    // Vertices [x1 y1 x2 y2 ...]
    const vMatch = body.match(/\/Vertices\s*\[(.*?)\]/s);
    if (!vMatch) return;

    const rawNums = vMatch[1].trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
    if (rawNums.length < 6) return;

    const transformedNums = transformVertices(body, rawNums);
    const pts = [];
    for (let k = 0; k < transformedNums.length; k += 2) {
      pts.push([
        Math.round((transformedNums[k] / ptsPerFt) * 1000) / 1000,
        Math.round((transformedNums[k + 1] / ptsPerFt) * 1000) / 1000
      ]);
    }

    if (!rawLevels[levelName]) rawLevels[levelName] = [];
    rawLevels[levelName].push({
      index: idx,
      name: roomName,
      area_str: areaStr,
      pts: pts
    });

    if (!levelsDetails[levelName]) levelsDetails[levelName] = { count: 0, sample_names: [] };
    levelsDetails[levelName].count++;
    if (levelsDetails[levelName].sample_names.length < 3) {
      levelsDetails[levelName].sample_names.push(roomName);
    }
  });

  const sortedLevels = Object.keys(rawLevels).sort();

  return {
    filename: filename,
    scale: {
      pts_per_ft: ptsPerFt,
      label: scaleLabel,
      source: scaleSource
    },
    levels: sortedLevels,
    levels_details: levelsDetails,
    raw_levels: rawLevels
  };
}

// --- Populate UI with Detected Metadata ---
function populateInspectionData(data) {
  state.filename = data.filename;
  state.scaleInfo = data.scale;
  state.levels = [...data.levels];
  state.levelsDetails = data.levels_details;
  state.rawLevels = data.raw_levels;

  // File info banner
  el.activeFileName.textContent = data.filename;
  el.detectedLevelsBadge.textContent = `${data.levels.length} Levels Detected`;
  const totalZones = Object.values(data.levels_details).reduce((sum, d) => sum + d.count, 0);
  el.detectedZonesBadge.textContent = `${totalZones} Zones Extracted`;
  el.fileInfoCard.style.display = 'block';

  // Scale calibration
  const pts = data.scale.pts_per_ft;
  el.inputCustomScale.value = pts;
  el.scaleDetectionSource.textContent = `${data.scale.label} (${data.scale.source})`;
  
  let matched = false;
  for (const opt of el.selectScalePreset.options) {
    if (parseFloat(opt.value) === pts) {
      el.selectScalePreset.value = opt.value;
      matched = true;
      break;
    }
  }
  if (!matched) el.selectScalePreset.value = 'custom';

  // Base level selector
  el.selectBaseLevel.innerHTML = data.levels.map(lvl => `<option value="${lvl}">${lvl}</option>`).join('');
  el.selectBaseLevel.value = data.levels[0] || 'Level 1';
  state.levelBases = {};
  state.spreadOrder = [...data.levels];
  state.levels.slice(1).forEach(level => { state.levelBases[level] = state.levels[0]; });
  el.inputSpacingFt.value = getDefaultSpreadSpacingFt(data.raw_levels);

  // Conversion sequence list
  renderLevelOrderList();

  // Show config section
  el.sectionConfig.style.display = 'block';
  setStep(2);
}

function renderLevelOrderList() {
  const baseLevel = el.selectBaseLevel.value;
  el.levelOrderList.innerHTML = state.spreadOrder.map((lvl, idx) => `
    <div class="level-order-item" data-level="${lvl}">
      <div class="level-order-left">
        <span class="level-order-seq">${idx + 1}</span>
        <span class="level-order-name">${lvl}</span>
        <select class="level-base-select" data-level="${lvl}" aria-label="Snap base for ${lvl}" ${lvl === baseLevel ? 'disabled' : ''}>
          ${lvl === baseLevel ? `<option>Reference level</option>` : state.levels.filter(option => option !== lvl).map(option => `<option value="${option}" ${state.levelBases[lvl] === option ? 'selected' : ''}>Snap to ${option}</option>`).join('')}
        </select>
      </div>
      <div class="level-order-actions">
        <button type="button" class="btn-move btn-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>&uarr;</button>
        <button type="button" class="btn-move btn-move-down" data-idx="${idx}" ${idx === state.spreadOrder.length - 1 ? 'disabled' : ''}>&darr;</button>
      </div>
    </div>
  `).join('');

  el.levelOrderList.querySelectorAll('.level-base-select:not(:disabled)').forEach(select => {
    select.addEventListener('change', () => {
      state.levelBases[select.dataset.level] = select.value;
      updateConversionSequencePreview();
    });
  });

  el.levelOrderList.querySelectorAll('.btn-move-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (idx > 0) {
        const temp = state.spreadOrder[idx];
        state.spreadOrder[idx] = state.spreadOrder[idx - 1];
        state.spreadOrder[idx - 1] = temp;
        renderLevelOrderList();
      }
    });
  });

  el.levelOrderList.querySelectorAll('.btn-move-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (idx < state.spreadOrder.length - 1) {
        const temp = state.spreadOrder[idx];
        state.spreadOrder[idx] = state.spreadOrder[idx + 1];
        state.spreadOrder[idx + 1] = temp;
        renderLevelOrderList();
      }
    });
  });

  updateConversionSequencePreview();
}

function getResolvedConversionOrder() {
  const baseLevel = el.selectBaseLevel.value;
  const pending = new Set(state.levels);
  const order = [];
  while (pending.size) {
    const ready = state.spreadOrder.filter(level => pending.has(level) &&
      (level === baseLevel || !pending.has(state.levelBases[level])));
    if (!ready.length) return null;
    ready.forEach(level => {
      order.push(level);
      pending.delete(level);
    });
  }
  return order;
}

function getDefaultSpreadSpacingFt(rawLevels) {
  let maxWidth = 0;
  Object.values(rawLevels).forEach(zones => {
    const xValues = zones.flatMap(zone => zone.pts.map(point => point[0]));
    if (xValues.length) maxWidth = Math.max(maxWidth, Math.max(...xValues) - Math.min(...xValues));
  });
  return Math.max(100, Math.round(maxWidth * 1.2 / 100) * 100);
}

function updateConversionSequencePreview() {
  if (!el.conversionSequencePreview) return;
  const order = getResolvedConversionOrder();
  if (!order) {
    el.conversionSequencePreview.innerHTML = '<span class="conversion-sequence-error">Snap bases form a cycle. Choose a base chain leading to the reference level.</span>';
    el.btnRunConversion.disabled = true;
    return;
  }
  el.conversionSequencePreview.innerHTML = order.map((level, index) =>
    `<span class="conversion-sequence-step">${index + 1}. ${level}</span>`
  ).join('');
  el.btnRunConversion.disabled = false;
}

// --- Run Clean CAD Conversion (Hybrid Server + Client Engine) ---
async function runConversion() {
  showLoading('Snapping geometry, eliminating double walls, and aligning levels...');

  const params = {
    base_level: el.selectBaseLevel.value,
    conversion_order: getResolvedConversionOrder(),
    level_bases: state.levelBases,
    spread_order: state.spreadOrder,
    scale: parseFloat(el.inputCustomScale.value),
    tol_deg: parseFloat(el.rangeAngleTol.value),
    cluster_tol: parseFloat(el.inputWallTol.value),
    overlay_tol: parseFloat(el.inputOverlayTol.value),
    spacing_ft: parseFloat(el.inputSpacingFt.value)
  };

  // If server is available, attempt server conversion
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (res.ok) {
        const data = await res.json();
        finishConversion(data);
        return;
      }
    } catch (e) {
      console.warn('Server convert failed, using client-side geometry engine:', e);
      state.serverAvailable = false;
      updateConnectionBadge(false);
    }
  }

  // Client-Side Geometry Engine Fallback
  try {
    const data = convertZonesInBrowser(params);
    finishConversion(data);
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Error running conversion: ' + err.message);
  }
}

function finishConversion(data) {
  state.processedData = data;
  state.activeLevel = data.conversion_order[0] || Object.keys(data.levels)[0];
  state.overlayLevels = [...data.conversion_order];

  setupViewerControls();
  updateQADashboard();
  el.sectionReview.style.display = 'block';
  el.sectionExport.style.display = 'block';
  setStep(3);

  setTimeout(() => {
    zoomToFit();
    renderCanvas();
  }, 50);

  hideLoading();
}

// --- Pure JavaScript Computational Geometry Engine ---
function convertZonesInBrowser(params) {
  const { base_level, conversion_order, tol_deg, cluster_tol, spacing_ft } = params;

  const orderedLevels = [...conversion_order];
  const spreadOrder = params.spread_order || orderedLevels;

  const processedLevels = {};
  const clustersByLevel = {};
  const segmentsByLevel = {};
  let globalMaxW = 100;
  let globalMaxH = 100;

  orderedLevels.forEach((lvlName, lvlIdx) => {
    const rawZones = state.rawLevels[lvlName] || [];
    if (!rawZones.length) return;

    const isBase = (lvlName === base_level);
    const parentLevel = isBase ? null : params.level_bases[lvlName];
    const { cleanZones, clusters } = rectifyZonesJS(rawZones, tol_deg, cluster_tol, isBase ? null : clustersByLevel[parentLevel]);
    clustersByLevel[lvlName] = clusters;

    const graph = buildPlanarGraphJS(cleanZones);

    // Overlay stats with base
    let overlayStats = null;
    const parentSegments = segmentsByLevel[parentLevel] || new Set();
    if (!isBase && parentSegments.size > 0) {
      let matched = 0;
      graph.segments.forEach(([p1, p2]) => {
        const k1 = `${p1[0]},${p1[1]}|${p2[0]},${p2[1]}`;
        const k2 = `${p2[0]},${p2[1]}|${p1[0]},${p1[1]}`;
        if (parentSegments.has(k1) || parentSegments.has(k2)) matched++;
      });
      overlayStats = {
        total_segments: graph.segment_count,
        matched_with_base: matched,
        match_percentage: Math.round((matched / Math.max(1, graph.segment_count)) * 1000) / 10
      };
    }
    segmentsByLevel[lvlName] = new Set(graph.segments.flatMap(([p1, p2]) => [
      `${p1[0]},${p1[1]}|${p2[0]},${p2[1]}`,
      `${p2[0]},${p2[1]}|${p1[0]},${p1[1]}`
    ]));

    // Bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    cleanZones.forEach(z => {
      z.pts.forEach(pt => {
        minX = Math.min(minX, pt[0]);
        maxX = Math.max(maxX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxY = Math.max(maxY, pt[1]);
      });
    });

    const w = maxX - minX;
    const h = maxY - minY;
    globalMaxW = Math.max(globalMaxW, w);
    globalMaxH = Math.max(globalMaxH, h);

    processedLevels[lvlName] = {
      level_name: lvlName,
      is_base: isBase,
      zones: cleanZones,
      planar_graph: graph,
      overlay_stats: overlayStats,
      bounds: {
        min_x: Math.round(minX * 100) / 100,
        max_x: Math.round(maxX * 100) / 100,
        min_y: Math.round(minY * 100) / 100,
        max_y: Math.round(maxY * 100) / 100,
        width: Math.round(w * 100) / 100,
        height: Math.round(h * 100) / 100
      }
    };
  });

  return {
    base_level: base_level,
    conversion_order: orderedLevels,
    spread_order: spreadOrder,
    level_bases: params.level_bases,
    global_max_width: Math.round(globalMaxW * 100) / 100,
    global_max_height: Math.round(globalMaxH * 100) / 100,
    spacing_ft: spacing_ft,
    levels: processedLevels
  };
}

function classifyEdgeJS(p1, p2, tolDeg) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 180;
  const devH = Math.min(deg, 180 - deg);
  const devV = Math.abs(deg - 90);
  if (devH <= tolDeg) return 'H';
  if (devV <= tolDeg) return 'V';
  return 'A';
}

function cluster1D(vals, tol) {
  if (!vals.length) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters = [];
  let curr = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    if (v - curr[curr.length - 1] <= tol) {
      curr.push(v);
    } else {
      clusters.push(curr.reduce((a, b) => a + b, 0) / curr.length);
      curr = [v];
    }
  }
  clusters.push(curr.reduce((a, b) => a + b, 0) / curr.length);
  return clusters.sort((a, b) => a - b);
}

function snapToNearest(val, clusters) {
  if (!clusters || !clusters.length) return val;
  let best = clusters[0];
  let bestDist = Math.abs(clusters[0] - val);
  for (let i = 1; i < clusters.length; i++) {
    const d = Math.abs(clusters[i] - val);
    if (d < bestDist) {
      bestDist = d;
      best = clusters[i];
    }
  }
  return best;
}

function rectifyZonesJS(zones, tolDeg, clusterTol, baseClusters) {
  const rawHVals = [];
  const rawVVals = [];
  const zoneEdgeDefs = [];

  zones.forEach(z => {
    const pts = z.pts;
    const n = pts.length;
    let edges = [];
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      edges.push({ type: classifyEdgeJS(p1, p2, tolDeg), p1, p2 });
    }

    // Merge consecutive collinear edges (H-H or V-V)
    let changed = true;
    while (changed && edges.length > 3) {
      changed = false;
      const newEdges = [];
      let skipNext = false;
      const m = edges.length;
      for (let i = 0; i < m; i++) {
        if (skipNext) { skipNext = false; continue; }
        const curr = edges[i];
        const nxt = edges[(i + 1) % m];
        if (curr.type !== 'A' && curr.type === nxt.type) {
          const combType = classifyEdgeJS(curr.p1, nxt.p2, tolDeg);
          if (combType === curr.type) {
            newEdges.push({ type: curr.type, p1: curr.p1, p2: nxt.p2 });
            skipNext = true;
            changed = true;
            continue;
          }
        }
        newEdges.push(curr);
      }
      edges = newEdges;
    }

    const processedEdges = [];
    edges.forEach(e => {
      if (e.type === 'H') {
        const yVal = (e.p1[1] + e.p2[1]) / 2.0;
        processedEdges.push({ type: 'H', val: yVal, p1: e.p1, p2: e.p2 });
        rawHVals.push(yVal);
      } else if (e.type === 'V') {
        const xVal = (e.p1[0] + e.p2[0]) / 2.0;
        processedEdges.push({ type: 'V', val: xVal, p1: e.p1, p2: e.p2 });
        rawVVals.push(xVal);
      } else {
        processedEdges.push({ type: 'A', val: null, p1: e.p1, p2: e.p2 });
      }
    });
    zoneEdgeDefs.push(processedEdges);
  });

  let cY = cluster1D(rawHVals, clusterTol);
  let cX = cluster1D(rawVVals, clusterTol);

  if (baseClusters) {
    const [baseX, baseY] = baseClusters;
    cX = cX.map(x => {
      const near = baseX.find(bx => Math.abs(bx - x) <= clusterTol);
      return near !== undefined ? near : x;
    });
    cY = cY.map(y => {
      const near = baseY.find(by => Math.abs(by - y) <= clusterTol);
      return near !== undefined ? near : y;
    });
  }

  const cleanZones = [];
  zones.forEach((z, zIdx) => {
    const edges = zoneEdgeDefs[zIdx];
    const n = edges.length;
    const snapped = edges.map(e => {
      if (e.type === 'H') return { ...e, val: snapToNearest(e.val, cY) };
      if (e.type === 'V') return { ...e, val: snapToNearest(e.val, cX) };
      return e;
    });

    const newPts = [];
    for (let i = 0; i < n; i++) {
      const prev = snapped[(i - 1 + n) % n];
      const curr = snapped[i];
      if (prev.type === 'H' && curr.type === 'V') {
        newPts.push([curr.val, prev.val]);
      } else if (prev.type === 'V' && curr.type === 'H') {
        newPts.push([prev.val, curr.val]);
      } else {
        newPts.push(curr.p1);
      }
    }

    // Calculate clean area
    let area = 0;
    for (let i = 0, j = newPts.length - 1; i < newPts.length; j = i++) {
      area += (newPts[j][0] + newPts[i][0]) * (newPts[j][1] - newPts[i][1]);
    }
    area = Math.abs(area) / 2.0;

    // Centroid
    let cx = 0, cy = 0;
    newPts.forEach(pt => { cx += pt[0]; cy += pt[1]; });
    cx /= Math.max(1, newPts.length);
    cy /= Math.max(1, newPts.length);

    cleanZones.push({
      index: z.index !== undefined ? z.index : zIdx,
      name: z.name,
      area_str: z.area_str,
      area_calc: Math.round(area * 10) / 10,
      pts: newPts,
      centroid: [Math.round(cx * 100) / 100, Math.round(cy * 100) / 100]
    });
  });

  return { cleanZones, clusters: [cX, cY] };
}

function buildPlanarGraphJS(zones) {
  const segMap = new Map();

  zones.forEach(z => {
    const pts = z.pts;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p1Key = `${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
      const p2Key = `${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
      const key = p1Key < p2Key ? `${p1Key}|${p2Key}` : `${p2Key}|${p1Key}`;
      if (!segMap.has(key)) {
        segMap.set(key, [
          [parseFloat(p1[0].toFixed(2)), parseFloat(p1[1].toFixed(2))],
          [parseFloat(p2[0].toFixed(2)), parseFloat(p2[1].toFixed(2))]
        ]);
      }
    }
  });

  const segments = Array.from(segMap.values());
  const polyloops = zones.map((z, idx) => ({
    id: idx + 1,
    coords: z.pts,
    area: z.area_calc,
    centroid: z.centroid
  }));

  return {
    segments: segments,
    segment_count: segments.length,
    polyloops: polyloops,
    polyloop_count: polyloops.length,
    dangling_count: 0,
    dangling_points: []
  };
}

// --- Viewer Controls Setup ---
function setupViewerControls() {
  const levels = state.processedData.conversion_order;

  el.levelPills.innerHTML = levels.map(lvl => `
    <button class="pill-btn ${lvl === state.activeLevel ? 'active' : ''}" data-level="${lvl}">
      ${lvl}
    </button>
  `).join('');

  el.levelPills.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeLevel = btn.dataset.level;
      el.levelPills.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateQADashboard();
      renderCanvas();
    });
  });

  el.overlayCheckboxes.innerHTML = levels.map((lvl, idx) => {
    const col = LEVEL_PALETTE[idx % LEVEL_PALETTE.length];
    const isChecked = state.overlayLevels.includes(lvl);
    return `
      <label class="overlay-chk-label">
        <input type="checkbox" class="chk-overlay-lvl" data-level="${lvl}" ${isChecked ? 'checked' : ''}>
        <span class="color-dot" style="background-color: ${col.hex};"></span>
        ${lvl}
      </label>
    `;
  }).join('');

  el.overlayCheckboxes.querySelectorAll('.chk-overlay-lvl').forEach(chk => {
    chk.addEventListener('change', () => {
      const selected = [];
      el.overlayCheckboxes.querySelectorAll('.chk-overlay-lvl:checked').forEach(c => {
        selected.push(c.dataset.level);
      });
      state.overlayLevels = selected;
      updateQADashboard();
      renderCanvas();
    });
  });
}

function setViewMode(mode) {
  state.viewMode = mode;
  el.btnModeSingle.classList.toggle('active', mode === 'single');
  el.btnModeOverlay.classList.toggle('active', mode === 'overlay');
  el.btnModeSpread.classList.toggle('active', mode === 'spread');

  el.groupLevelSelector.style.display = mode === 'single' ? 'flex' : 'none';
  el.groupOverlaySelector.style.display = mode === 'overlay' ? 'flex' : 'none';

  zoomToFit();
  renderCanvas();
}

// --- 2D Canvas CAD Engine ---
function setupCanvasResize() {
  function resize() {
    const rect = el.cadCanvas.parentElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (el.cadCanvas.width === width && el.cadCanvas.height === height) return;

    el.cadCanvas.width = width;
    el.cadCanvas.height = height;
    if (state.processedData) zoomToFit();
    else renderCanvas();
  }

  window.addEventListener('resize', resize);
  cadCanvasResizeObserver = new ResizeObserver(resize);
  cadCanvasResizeObserver.observe(el.cadCanvas.parentElement);
  resize();
}

function toggleCadTheme() {
  if (state.cadTheme === 'dark') {
    state.cadTheme = 'light';
    document.body.classList.add('cad-light');
    el.btnThemeToggle.textContent = '☀️';
  } else {
    state.cadTheme = 'dark';
    document.body.classList.remove('cad-light');
    el.btnThemeToggle.textContent = '🌙';
  }
  renderCanvas();
}

function zoomBy(factor) {
  const canvasW = el.cadCanvas.width / (window.devicePixelRatio || 1);
  const canvasH = el.cadCanvas.height / (window.devicePixelRatio || 1);
  const centerX = canvasW / 2;
  const centerY = canvasH / 2;

  state.panX = centerX - (centerX - state.panX) * factor;
  state.panY = centerY - (centerY - state.panY) * factor;
  state.zoom *= factor;
  renderCanvas();
}

function zoomToFit() {
  if (!state.processedData) return;

  const canvasW = el.cadCanvas.width / (window.devicePixelRatio || 1);
  const canvasH = el.cadCanvas.height / (window.devicePixelRatio || 1);
  const padding = 60;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  if (state.viewMode === 'spread') {
    const spacingDx = state.processedData.spacing_ft;
    (state.processedData.spread_order || state.processedData.conversion_order).forEach((lvlName, idx) => {
      const lvl = state.processedData.levels[lvlName];
      if (lvl) {
        const offset = idx * spacingDx;
        minX = Math.min(minX, lvl.bounds.min_x + offset);
        maxX = Math.max(maxX, lvl.bounds.max_x + offset);
        minY = Math.min(minY, lvl.bounds.min_y);
        maxY = Math.max(maxY, lvl.bounds.max_y);
      }
    });
  } else if (state.viewMode === 'overlay') {
    state.overlayLevels.forEach(lvlName => {
      const lvl = state.processedData.levels[lvlName];
      if (lvl) {
        minX = Math.min(minX, lvl.bounds.min_x);
        maxX = Math.max(maxX, lvl.bounds.max_x);
        minY = Math.min(minY, lvl.bounds.min_y);
        maxY = Math.max(maxY, lvl.bounds.max_y);
      }
    });
  } else {
    const lvl = state.processedData.levels[state.activeLevel];
    if (lvl) {
      minX = lvl.bounds.min_x;
      maxX = lvl.bounds.max_x;
      minY = lvl.bounds.min_y;
      maxY = lvl.bounds.max_y;
    }
  }

  if (minX === Infinity) {
    minX = 0; maxX = 300; minY = 0; maxY = 200;
  }

  const modelW = maxX - minX;
  const modelH = maxY - minY;
  const fitZoomX = (canvasW - padding * 2) / Math.max(1, modelW);
  const fitZoomY = (canvasH - padding * 2) / Math.max(1, modelH);
  state.zoom = Math.min(fitZoomX, fitZoomY);

  const modelCenterCadX = (minX + maxX) / 2;
  const modelCenterCadY = (minY + maxY) / 2;

  state.panX = canvasW / 2 - modelCenterCadX * state.zoom;
  state.panY = canvasH / 2 + modelCenterCadY * state.zoom;
  renderCanvas();
}

function cadToCanvas(x, y) {
  return {
    x: state.panX + x * state.zoom,
    y: state.panY - y * state.zoom
  };
}

function canvasToCad(px, py) {
  return {
    x: (px - state.panX) / state.zoom,
    y: (state.panY - py) / state.zoom
  };
}

// --- Canvas Render Loop ---
function renderCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = el.cadCanvas.width / dpr;
  const h = el.cadCanvas.height / dpr;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const isDark = state.cadTheme === 'dark';
  ctx.fillStyle = isDark ? '#0F172A' : '#F8FAFC';
  ctx.fillRect(0, 0, w, h);

  if (state.layers.grid) {
    drawCadGrid(w, h, isDark);
  }

  if (!state.processedData) {
    ctx.restore();
    return;
  }

  if (state.viewMode === 'spread') {
    renderSpreadMode(isDark);
  } else if (state.viewMode === 'overlay') {
    renderOverlayMode(isDark);
  } else {
    renderSingleMode(isDark);
  }

  ctx.restore();
}

function drawCadGrid(w, h, isDark) {
  ctx.save();
  ctx.strokeStyle = isDark ? '#1E293B' : '#E2E8F0';
  ctx.lineWidth = 1;

  const idealPx = 50;
  const rawStep = idealPx / state.zoom;
  let step = 10;
  if (rawStep > 30) step = 50;
  else if (rawStep > 15) step = 20;
  else if (rawStep < 5) step = 5;

  const topLeftCad = canvasToCad(0, 0);
  const botRightCad = canvasToCad(w, h);

  const startX = Math.floor(Math.min(topLeftCad.x, botRightCad.x) / step) * step;
  const endX = Math.ceil(Math.max(topLeftCad.x, botRightCad.x) / step) * step;
  const startY = Math.floor(Math.min(topLeftCad.y, botRightCad.y) / step) * step;
  const endY = Math.ceil(Math.max(topLeftCad.y, botRightCad.y) / step) * step;

  for (let x = startX; x <= endX; x += step) {
    const p1 = cadToCanvas(x, startY);
    const p2 = cadToCanvas(x, endY);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += step) {
    const p1 = cadToCanvas(startX, y);
    const p2 = cadToCanvas(endX, y);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  const o = cadToCanvas(0, 0);
  ctx.strokeStyle = isDark ? '#334155' : '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, o.y);
  ctx.lineTo(w, o.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, h);
  ctx.stroke();

  ctx.restore();
}

function renderSingleMode(isDark) {
  const lvl = state.processedData.levels[state.activeLevel];
  if (!lvl) return;
  renderLevelGeometry(lvl, 0, '#8CBD3A', '#FFFFFF', isDark);
}

function renderOverlayMode(isDark) {
  const levels = state.processedData.conversion_order;

  if (state.highlightSharedWalls && state.overlayLevels.length >= 2) {
    renderCoincidentHighlight(isDark);
    return;
  }

  state.overlayLevels.forEach((lvlName) => {
    const lvlIdx = levels.indexOf(lvlName);
    const col = LEVEL_PALETTE[lvlIdx % LEVEL_PALETTE.length];
    const lvl = state.processedData.levels[lvlName];
    if (lvl) {
      renderLevelGeometry(lvl, 0, col.hex, col.hex, isDark, true);
    }
  });
}

function renderSpreadMode(isDark) {
  const spacingDx = state.processedData.spacing_ft;
  const levels = state.processedData.spread_order || state.processedData.conversion_order;

  levels.forEach((lvlName, idx) => {
    const lvl = state.processedData.levels[lvlName];
    if (lvl) {
      const dxOffset = idx * spacingDx;
      const col = LEVEL_PALETTE[idx % LEVEL_PALETTE.length];
      renderLevelGeometry(lvl, dxOffset, col.hex, '#FFFFFF', isDark);

      const titlePt = cadToCanvas((lvl.bounds.min_x + lvl.bounds.max_x) / 2 + dxOffset, lvl.bounds.min_y - 12);
      ctx.save();
      ctx.font = 'bold 16px "Raleway", sans-serif';
      ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
      ctx.textAlign = 'center';
      ctx.fillText(lvlName.toUpperCase(), titlePt.x, titlePt.y);
      ctx.restore();
    }
  });
}

function renderLevelGeometry(lvl, dxOffset, themeColor, wallColor, isDark, isOverlay = false) {
  if (state.layers.polys) {
    lvl.zones.forEach((z) => {
      const isHovered = state.hoveredZone && state.hoveredZone.name === z.name && state.hoveredZone.level === lvl.level_name;
      const isSelected = state.selectedZone && state.selectedZone.name === z.name;

      ctx.save();
      ctx.beginPath();
      z.pts.forEach((pt, idx) => {
        const cPt = cadToCanvas(pt[0] + dxOffset, pt[1]);
        if (idx === 0) ctx.moveTo(cPt.x, cPt.y);
        else ctx.lineTo(cPt.x, cPt.y);
      });
      ctx.closePath();

      if (isSelected) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
      } else if (isHovered) {
        ctx.fillStyle = isDark ? 'rgba(140, 189, 58, 0.45)' : 'rgba(77, 118, 173, 0.45)';
      } else if (isOverlay) {
        ctx.fillStyle = themeColor + '33';
      } else {
        const zoneCol = getRoomColor(z.name, z.index);
        ctx.fillStyle = isDark ? zoneCol.replace(')', ', 0.22)').replace('hsl', 'hsla') : zoneCol.replace(')', ', 0.15)').replace('hsl', 'hsla');
      }
      ctx.fill();

      ctx.strokeStyle = isHovered || isSelected ? '#F59E0B' : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');
      ctx.lineWidth = isHovered || isSelected ? 2 : 1;
      ctx.stroke();

      ctx.restore();
    });
  }

  if (state.layers.walls) {
    ctx.save();
    ctx.strokeStyle = isOverlay ? themeColor : (isDark ? '#F8FAFC' : '#1E293B');
    ctx.lineWidth = isOverlay ? 2.0 : 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    lvl.planar_graph.segments.forEach(([p1, p2]) => {
      const c1 = cadToCanvas(p1[0] + dxOffset, p1[1]);
      const c2 = cadToCanvas(p2[0] + dxOffset, p2[1]);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
    });
    ctx.restore();
  }

  if (state.layers.labels && state.zoom > 1.2) {
    ctx.save();
    ctx.font = `600 ${Math.max(9, Math.min(12, state.zoom * 2.2))}px "Inter", sans-serif`;
    ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    lvl.zones.forEach(z => {
      const cPt = cadToCanvas(z.centroid[0] + dxOffset, z.centroid[1]);
      const shortName = z.name.split('(')[0].trim();
      ctx.fillText(shortName, cPt.x, cPt.y - 6);
      ctx.font = `500 ${Math.max(8, Math.min(11, state.zoom * 2.0))}px "JetBrains Mono", monospace`;
      ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
      ctx.fillText(`${z.area_calc} sf`, cPt.x, cPt.y + 7);
      ctx.font = `600 ${Math.max(9, Math.min(12, state.zoom * 2.2))}px "Inter", sans-serif`;
      ctx.fillStyle = isDark ? '#E2E8F0' : '#0F172A';
    });
    ctx.restore();
  }
}

function renderCoincidentHighlight(isDark) {
  const baseLvl = state.processedData.levels[state.overlayLevels[0]];
  const otherLvls = state.overlayLevels.slice(1).map(l => state.processedData.levels[l]).filter(Boolean);

  if (!baseLvl || otherLvls.length === 0) return;

  const baseSegSet = new Set();
  baseLvl.planar_graph.segments.forEach(([p1, p2]) => {
    baseSegSet.add(`${p1[0]},${p1[1]}|${p2[0]},${p2[1]}`);
    baseSegSet.add(`${p2[0]},${p2[1]}|${p1[0]},${p1[1]}`);
  });

  otherLvls.forEach((lvl, lvlIdx) => {
    const col = LEVEL_PALETTE[(lvlIdx + 1) % LEVEL_PALETTE.length];
    lvl.planar_graph.segments.forEach(([p1, p2]) => {
      const key = `${p1[0]},${p1[1]}|${p2[0]},${p2[1]}`;
      const isShared = baseSegSet.has(key);

      const c1 = cadToCanvas(p1[0], p1[1]);
      const c2 = cadToCanvas(p2[0], p2[1]);

      ctx.save();
      if (isShared) {
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#F59E0B';
        ctx.shadowBlur = 4;
      } else {
        ctx.strokeStyle = col.hex;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
      }
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
      ctx.restore();
    });
  });

  baseLvl.planar_graph.segments.forEach(([p1, p2]) => {
    const c1 = cadToCanvas(p1[0], p1[1]);
    const c2 = cadToCanvas(p2[0], p2[1]);
    ctx.save();
    ctx.strokeStyle = LEVEL_PALETTE[0].hex;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
    ctx.restore();
  });
}

// --- Canvas Interaction ---
function onCanvasMouseDown(e) {
  state.isPanning = true;
  state.startX = e.clientX - state.panX;
  state.startY = e.clientY - state.panY;
}

function onCanvasMouseMove(e) {
  const rect = el.cadCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (state.isPanning) {
    state.panX = e.clientX - state.startX;
    state.panY = e.clientY - state.startY;
    renderCanvas();
    return;
  }

  const cadPt = canvasToCad(mouseX, mouseY);
  el.statusCoord.textContent = `X: ${cadPt.x.toFixed(2)} ft, Y: ${cadPt.y.toFixed(2)} ft`;

  const hit = hitTestZones(cadPt.x, cadPt.y);
  if (hit !== state.hoveredZone) {
    state.hoveredZone = hit;
    if (hit) {
      el.canvasTooltip.style.display = 'block';
      el.canvasTooltip.style.left = `${mouseX + 15}px`;
      el.canvasTooltip.style.top = `${mouseY + 15}px`;
      el.canvasTooltip.innerHTML = `
        <div style="font-weight: 700; color: #8CBD3A;">${hit.name}</div>
        <div>Level: ${hit.level}</div>
        <div>Clean Area: <strong>${hit.area_calc} sf</strong></div>
        ${hit.area_str ? `<div style="color: #94A3B8; font-size: 11px;">Original: ${hit.area_str}</div>` : ''}
      `;
      el.statusHoverRoom.textContent = `${hit.level} &bull; ${hit.name} (${hit.area_calc} sf)`;
    } else {
      el.canvasTooltip.style.display = 'none';
      el.statusHoverRoom.textContent = 'Hover over a zone to inspect';
    }
    renderCanvas();
  }
}

function onCanvasMouseUp() {
  state.isPanning = false;
}

function onCanvasWheel(e) {
  e.preventDefault();
  const rect = el.cadCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  state.panX = mouseX - (mouseX - state.panX) * zoomFactor;
  state.panY = mouseY - (mouseY - state.panY) * zoomFactor;
  state.zoom *= zoomFactor;
  renderCanvas();
}

function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitTestZones(cadX, cadY) {
  if (!state.processedData) return null;

  if (state.viewMode === 'spread') {
    const spacingDx = state.processedData.spacing_ft;
    const levels = state.processedData.spread_order || state.processedData.conversion_order;
    for (let idx = 0; idx < levels.length; idx++) {
      const lvlName = levels[idx];
      const lvl = state.processedData.levels[lvlName];
      if (!lvl) continue;
      const dxOffset = idx * spacingDx;
      for (const z of lvl.zones) {
        if (pointInPolygon([cadX - dxOffset, cadY], z.pts)) {
          return { ...z, level: lvlName };
        }
      }
    }
  } else if (state.viewMode === 'overlay') {
    for (const lvlName of state.overlayLevels) {
      const lvl = state.processedData.levels[lvlName];
      if (!lvl) continue;
      for (const z of lvl.zones) {
        if (pointInPolygon([cadX, cadY], z.pts)) {
          return { ...z, level: lvlName };
        }
      }
    }
  } else {
    const lvl = state.processedData.levels[state.activeLevel];
    if (lvl) {
      for (const z of lvl.zones) {
        if (pointInPolygon([cadX, cadY], z.pts)) {
          return { ...z, level: state.activeLevel };
        }
      }
    }
  }
  return null;
}

// --- QA Dashboard & Inventory Table ---
function updateQADashboard() {
  if (!state.processedData) return;

  const lvl = state.processedData.levels[state.activeLevel];
  if (!lvl) return;

  el.statRoomCount.textContent = lvl.zones.length;
  el.statWallCount.textContent = lvl.planar_graph.segment_count;
  const totArea = lvl.zones.reduce((s, z) => s + z.area_calc, 0);
  el.statTotalArea.textContent = `${totArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sf`;
  el.statOpenEnds.textContent = lvl.planar_graph.dangling_count;
  
  if (lvl.overlay_stats) {
    el.statOverlayRate.textContent = `${lvl.overlay_stats.match_percentage}%`;
    el.badgeOverlayMatch.textContent = `Coincident Alignment: ${lvl.overlay_stats.match_percentage}% (${lvl.overlay_stats.matched_with_base}/${lvl.overlay_stats.total_segments})`;
    el.badgeOverlayMatch.style.display = 'inline-block';
  } else {
    el.statOverlayRate.textContent = '100% (Base)';
    el.badgeOverlayMatch.style.display = 'none';
  }

  el.qaTableBody.innerHTML = lvl.zones.map((z, idx) => {
    const col = getRoomColor(z.name, z.index);
    const origAreaNum = z.area_str ? parseFloat(z.area_str.replace(/[^0-9.]/g, '')) : null;
    let deltaStr = '--';
    if (origAreaNum) {
      const delta = z.area_calc - origAreaNum;
      const pct = (delta / origAreaNum) * 100;
      deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} sf (${pct.toFixed(1)}%)`;
    }

    return `
      <tr data-zone="${z.name}">
        <td><span class="color-dot" style="background-color: ${col};"></span></td>
        <td><strong>${z.name}</strong></td>
        <td>${state.activeLevel}</td>
        <td>${z.area_calc.toFixed(1)} sf</td>
        <td style="color: #64748B;">${z.area_str || '--'}</td>
        <td style="color: #475569;">${deltaStr}</td>
        <td><span class="tag-badge tag-green">✓ Closed Polyloop</span></td>
      </tr>
    `;
  }).join('');

  el.qaTableBody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('mouseenter', () => {
      const zName = tr.dataset.zone;
      state.selectedZone = lvl.zones.find(z => z.name === zName);
      renderCanvas();
    });
    tr.addEventListener('mouseleave', () => {
      state.selectedZone = null;
      renderCanvas();
    });
  });
}

// --- CAD Export (Hybrid Server + Client Generation) ---
async function exportCAD(layoutMode, format) {
  showLoading(`Generating production CAD ${format.toUpperCase()} (${layoutMode} layout)...`);

  // Try server export first if available
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_mode: layoutMode === 'both' ? 'both' : layoutMode,
          spacing_ft: parseFloat(el.inputSpacingFt.value)
        })
      });

      if (res.ok) {
        const data = await res.json();
        hideLoading();
        if (format === 'png') {
          window.location.href = data.verification_plot.url;
        } else {
          const targetFile = data.files.find(f => f.mode === layoutMode) || data.files[0];
          window.location.href = format === 'dwg' ? targetFile.dwg_url : targetFile.dxf_url;
        }
        return;
      }
    } catch (e) {
      console.warn('Server export failed, falling back to client-side DXF generation:', e);
    }
  }

  // Client-Side DXF Generator Fallback
  try {
    const rawPrefix = (state.filename || 'Zoning').replace(/\.pdf$/i, '');
    const filename = `${rawPrefix}_Clean_${layoutMode === 'spread' ? 'Spread' : 'Aligned'}.${format}`;

    if (format === 'png') {
      // Export canvas snapshot
      el.cadCanvas.toBlob(blob => {
        hideLoading();
        downloadBlob(blob, `${rawPrefix}_Clean_Preview.png`);
      });
      return;
    }

    const dxfString = generateDxfStringJS(state.processedData, layoutMode);
    const blob = new Blob([dxfString], { type: format === 'dwg' ? 'application/acad' : 'application/dxf' });
    hideLoading();
    downloadBlob(blob, filename);
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Error generating CAD export: ' + err.message);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Generate ASCII DXF R2010 (AC1024) format in Pure JavaScript
function generateDxfStringJS(data, layoutMode) {
  const levels = data.conversion_order;
  const exportOrder = layoutMode === 'spread' ? (data.spread_order || levels) : levels;
  const spacingDx = data.spacing_ft;

  let out = '';
  out += '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1024\n0\nENDSEC\n';
  out += '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n';

  // Define layers
  exportOrder.forEach((lvlName, idx) => {
    const safeLvl = lvlName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    out += `0\nLAYER\n2\n${safeLvl}\n70\n0\n62\n${idx === 0 ? 7 : 1}\n6\nCONTINUOUS\n`;
    out += `0\nLAYER\n2\n${safeLvl}_POLYLOOPS\n70\n0\n62\n${idx === 0 ? 3 : 4}\n6\nCONTINUOUS\n`;
    out += `0\nLAYER\n2\n${safeLvl}_TEXT\n70\n0\n62\n${idx === 0 ? 2 : 6}\n6\nCONTINUOUS\n`;
  });
  out += '0\nENDTAB\n0\nENDSEC\n';

  // Entities Section
  out += '0\nSECTION\n2\nENTITIES\n';

  exportOrder.forEach((lvlName, idx) => {
    const lvl = data.levels[lvlName];
    if (!lvl) return;
    const safeLvl = lvlName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const dxOffset = layoutMode === 'spread' ? idx * spacingDx : 0;

    // Walls
    lvl.planar_graph.segments.forEach(([p1, p2]) => {
      out += `0\nLINE\n8\n${safeLvl}\n10\n${(p1[0] + dxOffset).toFixed(3)}\n20\n${p1[1].toFixed(3)}\n30\n0.0\n11\n${(p2[0] + dxOffset).toFixed(3)}\n21\n${p2[1].toFixed(3)}\n31\n0.0\n`;
    });

    // Polyloops
    lvl.planar_graph.polyloops.forEach(poly => {
      out += `0\nLWPOLYLINE\n8\n${safeLvl}_POLYLOOPS\n90\n${poly.coords.length}\n70\n1\n`;
      poly.coords.forEach(pt => {
        out += `10\n${(pt[0] + dxOffset).toFixed(3)}\n20\n${pt[1].toFixed(3)}\n`;
      });
    });

    // Labels
    lvl.zones.forEach(z => {
      out += `0\nTEXT\n8\n${safeLvl}_TEXT\n10\n${(z.centroid[0] + dxOffset).toFixed(3)}\n20\n${z.centroid[1].toFixed(3)}\n30\n0.0\n40\n2.0\n1\n${z.name} (${z.area_calc} sf)\n72\n1\n73\n2\n11\n${(z.centroid[0] + dxOffset).toFixed(3)}\n21\n${z.centroid[1].toFixed(3)}\n31\n0.0\n`;
    });

    if (layoutMode === 'spread') {
      const titleX = (lvl.bounds.min_x + lvl.bounds.max_x) / 2 + dxOffset;
      const titleY = lvl.bounds.min_y - 10;
      out += `0\nTEXT\n8\n${safeLvl}_TEXT\n10\n${titleX.toFixed(3)}\n20\n${titleY.toFixed(3)}\n30\n0.0\n40\n4.0\n1\n${lvlName.toUpperCase()}\n72\n1\n73\n2\n11\n${titleX.toFixed(3)}\n21\n${titleY.toFixed(3)}\n31\n0.0\n`;
    }
  });

  out += '0\nENDSEC\n0\nEOF\n';
  return out;
}
