/**
 * app.js
 * ======
 * Frontend application logic and CAD canvas renderer for CBECC PolyLoop Fixer.
 * Part of O'Brien360 Tools Suite.
 */

// Global State
const state = {
  serverAvailable: false,
  rawContent: '',
  model: null,
  activeFilter: 'missing', // 'missing' | 'fixed' | 'all'
  searchQuery: '',
  selectedSpaceName: null,
  activeSpaceData: null,
  activeVertices: [], // [[x, y, z], ...]
  fixedSpaces: {}, // space_name -> [[x, y, z], ...]
  includedFloorIndices: [],
  // Canvas Viewport Transform
  transform: {
    scale: 1.0,
    offsetX: 0,
    offsetY: 0
  },
  isPanning: false,
  panStart: { x: 0, y: 0 },
  hoveredVertexIndex: -1,
  selectedVertexIndex: -1
};

// Color palette for child floor surfaces
const FLOOR_COLORS = [
  { fill: 'rgba(98, 184, 164, 0.35)', stroke: '#62B8A4' }, // Teal
  { fill: 'rgba(245, 158, 11, 0.35)', stroke: '#F59E0B' }, // Amber
  { fill: 'rgba(77, 118, 173, 0.35)', stroke: '#4D76AD' }, // Blue
  { fill: 'rgba(121, 62, 109, 0.35)', stroke: '#793E6D' }, // Purple
  { fill: 'rgba(16, 185, 129, 0.35)', stroke: '#10B981' }  // Green
];

// DOM Elements
const el = {};

document.addEventListener('DOMContentLoaded', async () => {
  initDOMElements();
  initEventListeners();
  await checkServerConnection();
  await loadSampleFileList();
  setupCanvas();
});

function initDOMElements() {
  el.connectionBadge = document.getElementById('connectionBadge');
  el.connectionBadgeText = document.getElementById('connectionBadgeText');
  el.fileDropzone = document.getElementById('fileDropzone');
  el.fileInput = document.getElementById('fileInput');
  el.sampleSelect = document.getElementById('sampleSelect');
  el.btnLoadSample = document.getElementById('btnLoadSample');
  
  el.statFileName = document.getElementById('statFileName');
  el.statRuleset = document.getElementById('statRuleset');
  el.statTotalSpaces = document.getElementById('statTotalSpaces');
  el.statValidSpaces = document.getElementById('statValidSpaces');
  el.statMissingCount = document.getElementById('statMissingCount');
  el.statFixedCount = document.getElementById('statFixedCount');
  el.statMaxIDs = document.getElementById('statMaxIDs');

  el.tabMissing = document.getElementById('tabMissing');
  el.tabFixed = document.getElementById('tabFixed');
  el.tabAll = document.getElementById('tabAll');
  el.badgeMissingCount = document.getElementById('badgeMissingCount');
  el.badgeFixedCount = document.getElementById('badgeFixedCount');
  el.badgeAllCount = document.getElementById('badgeAllCount');
  el.spaceSearch = document.getElementById('spaceSearch');
  el.spacesList = document.getElementById('spacesList');

  el.inspSpaceStatus = document.getElementById('inspSpaceStatus');
  el.inspSpaceName = document.getElementById('inspSpaceName');
  el.inspThermalZone = document.getElementById('inspThermalZone');
  el.inspStory = document.getElementById('inspStory');
  el.inspElevation = document.getElementById('inspElevation');

  el.btnPrevSpace = document.getElementById('btnPrevSpace');
  el.btnNextSpace = document.getElementById('btnNextSpace');
  el.btnApplyFixSingle = document.getElementById('btnApplyFixSingle');
  el.btnAutoFixAll = document.getElementById('btnAutoFixAll');
  el.btnDownloadFixed = document.getElementById('btnDownloadFixed');

  el.canvas = document.getElementById('cadCanvas');
  el.canvasWrapper = document.getElementById('canvasWrapper');
  el.btnZoomIn = document.getElementById('btnZoomIn');
  el.btnZoomOut = document.getElementById('btnZoomOut');
  el.btnFitView = document.getElementById('btnFitView');
  el.btnResetView = document.getElementById('btnResetView');
  el.canvasLegend = document.getElementById('canvasLegend');
  el.legendItems = document.getElementById('legendItems');
  el.vertexTooltip = document.getElementById('vertexTooltip');

  el.sliderSimplify = document.getElementById('sliderSimplify');
  el.valSimplify = document.getElementById('valSimplify');
  el.sliderSnap = document.getElementById('sliderSnap');
  el.valSnap = document.getElementById('valSnap');
  el.btnReverseWinding = document.getElementById('btnReverseWinding');
  el.btnRevertAuto = document.getElementById('btnRevertAuto');

  el.floorsCheckboxes = document.getElementById('floorsCheckboxes');
  el.kpiVertexCount = document.getElementById('kpiVertexCount');
  el.kpiArea = document.getElementById('kpiArea');
  el.kpiMultiPartBadge = document.getElementById('kpiMultiPartBadge');

  el.btnToggleCoordTable = document.getElementById('btnToggleCoordTable');
  el.coordTableToggleText = document.getElementById('coordTableToggleText');
  el.coordTableWrap = document.getElementById('coordTableWrap');
  el.coordTableBody = document.getElementById('coordTableBody');
  el.btnAddVertex = document.getElementById('btnAddVertex');
  el.toast = document.getElementById('toast');
}

function initEventListeners() {
  // File Dropzone & Browse
  el.fileDropzone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', handleFileSelected);

  el.fileDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.fileDropzone.classList.add('drag-over');
  });
  el.fileDropzone.addEventListener('dragleave', () => {
    el.fileDropzone.classList.remove('drag-over');
  });
  el.fileDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.fileDropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadedFile(e.dataTransfer.files[0]);
    }
  });

  // Sample Load Button
  el.btnLoadSample.addEventListener('click', () => {
    const filename = el.sampleSelect.value;
    if (filename) loadSampleFile(filename);
  });

  // Filter Tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeFilter = tab.dataset.filter;
      renderSpacesList();
    });
  });

  // Search input
  el.spaceSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderSpacesList();
  });

  // Nav buttons
  el.btnPrevSpace.addEventListener('click', selectPrevSpace);
  el.btnNextSpace.addEventListener('click', selectNextSpace);

  // Sliders
  el.sliderSimplify.addEventListener('input', (e) => {
    el.valSimplify.textContent = `${parseFloat(e.target.value).toFixed(3)} ft`;
  });
  el.sliderSimplify.addEventListener('change', triggerRecalculate);

  el.sliderSnap.addEventListener('input', (e) => {
    el.valSnap.textContent = `${parseFloat(e.target.value).toFixed(2)} ft`;
  });
  el.sliderSnap.addEventListener('change', triggerRecalculate);

  // Winding & Revert
  el.btnReverseWinding.addEventListener('click', () => {
    if (state.activeVertices.length > 2) {
      state.activeVertices.reverse();
      renderCoordTable();
      renderCanvas();
      showToast('PolyLoop winding reversed.');
    }
  });

  el.btnRevertAuto.addEventListener('click', () => {
    if (state.activeSpaceData && state.activeSpaceData.auto_union) {
      const autoVerts = state.activeSpaceData.auto_union.vertices || [];
      state.activeVertices = JSON.parse(JSON.stringify(autoVerts));
      el.sliderSimplify.value = 0.01;
      el.valSimplify.textContent = '0.01 ft';
      el.sliderSnap.value = 0.05;
      el.valSnap.textContent = '0.05 ft';
      renderCoordTable();
      updateGeomKPIs();
      fitView();
      showToast('Reverted to automatic union.');
    }
  });

  // Coordinate Table Toggle
  el.btnToggleCoordTable.addEventListener('click', () => {
    const isHidden = el.coordTableWrap.style.display === 'none';
    el.coordTableWrap.style.display = isHidden ? 'block' : 'none';
    el.coordTableToggleText.textContent = isHidden ? 'Hide Coordinate Table' : 'Show Coordinate Table';
  });

  // Add Vertex
  el.btnAddVertex.addEventListener('click', () => {
    const last = state.activeVertices[state.activeVertices.length - 1] || [0, 0, 0];
    const newPt = [last[0] + 5, last[1] + 5, last[2]];
    state.activeVertices.push(newPt);
    renderCoordTable();
    updateGeomKPIs();
    renderCanvas();
    showToast('Vertex added to PolyLoop.');
  });

  // Apply Fix to Single Space
  el.btnApplyFixSingle.addEventListener('click', applyFixToCurrentSpace);

  // Auto-Fix All
  el.btnAutoFixAll.addEventListener('click', applyFixAllSpaces);

  // Download Fixed File
  el.btnDownloadFixed.addEventListener('click', downloadRepairedFile);

  // Viewport zoom buttons
  el.btnZoomIn.addEventListener('click', () => zoomView(1.2));
  el.btnZoomOut.addEventListener('click', () => zoomView(0.8));
  el.btnFitView.addEventListener('click', fitView);
  el.btnResetView.addEventListener('click', () => {
    state.transform.scale = 1.0;
    state.transform.offsetX = el.canvas.width / 2;
    state.transform.offsetY = el.canvas.height / 2;
    renderCanvas();
  });
}

// -------------------------------------------------------------
// Environment Detection (Connected Server vs Standalone Browser)
// -------------------------------------------------------------

async function checkServerConnection() {
  if (window.location.protocol === 'file:' ||
      window.location.hostname.includes('github.io') ||
      !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
    setServerMode(false);
    return;
  }
  try {
    const res = await fetch('/api/status', { method: 'GET', signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      setServerMode(true);
    } else {
      setServerMode(false);
    }
  } catch (e) {
    setServerMode(false);
  }
}

function setServerMode(isAvailable) {
  state.serverAvailable = isAvailable;
  if (!el.connectionBadge || !el.connectionBadgeText) return;
  if (isAvailable) {
    el.connectionBadge.className = 'status-chip online';
    el.connectionBadgeText.textContent = 'Server Connected (Active)';
  } else {
    el.connectionBadge.className = 'status-chip offline';
    el.connectionBadgeText.textContent = 'Browser Mode (Active)';
  }
}

// -------------------------------------------------------------
// Sample Loading & File Handling
// -------------------------------------------------------------

async function loadSampleFileList() {
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/samples');
      const data = await res.json();
      if (data.success && data.samples.length > 0) {
        el.sampleSelect.innerHTML = data.samples.map(s => `
          <option value="${s.name}" ${s.is_default ? 'selected' : ''}>
            ${s.name} (${(s.size_bytes / 1024).toFixed(0)} KB)
          </option>
        `).join('');

        const defaultFile = data.samples.find(s => s.is_default) || data.samples[0];
        if (defaultFile) {
          await loadSampleFile(defaultFile.name);
        }
        return;
      }
    } catch (err) {
      console.warn('Server sample list failed, falling back to browser mode:', err);
    }
  }

  // Standalone / GitHub Pages Mode: default sample file
  el.sampleSelect.innerHTML = `
    <option value="Shoebox MDL.cibd19" selected>Shoebox MDL.cibd19 (335 KB Demo)</option>
  `;
  await loadSampleFile('Shoebox MDL.cibd19');
}

async function loadSampleFile(filename) {
  showToast(`Loading ${filename}...`);
  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/load-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data.success) {
        state.rawContent = data.raw_content || '';
        loadModelIntoState(data);
        showToast(`Loaded ${filename} successfully!`);
        return;
      }
    } catch (err) {
      console.warn('Server load failed, falling back to static fetch:', err);
    }
  }

  // Browser Mode: direct static fetch of the sample file
  try {
    const res = await fetch(filename);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    state.rawContent = text;
    const modelData = parseCBECCModelJS(text, filename);
    loadModelIntoState(modelData);
    showToast(`Loaded ${filename} successfully!`);
  } catch (err) {
    alert(`Error loading sample file: ${err.message}`);
  }
}

function handleFileSelected(e) {
  if (e.target.files && e.target.files[0]) {
    handleUploadedFile(e.target.files[0]);
  }
}

function handleUploadedFile(file) {
  showToast(`Uploading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    state.rawContent = content;

    if (state.serverAvailable) {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            content: content
          })
        });
        const data = await res.json();
        if (data.success) {
          loadModelIntoState(data);
          showToast(`Uploaded ${file.name} successfully!`);
          return;
        }
      } catch (err) {
        console.warn('Server upload failed, falling back to local JS:', err);
      }
    }

    // Browser Mode: parse text locally in JS
    try {
      const modelData = parseCBECCModelJS(content, file.name);
      loadModelIntoState(modelData);
      showToast(`Uploaded ${file.name} successfully!`);
    } catch (err) {
      alert(`Parse error: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function loadModelIntoState(data) {
  state.model = data;
  state.fixedSpaces = {};
  state.selectedSpaceName = null;
  state.activeSpaceData = null;
  state.activeVertices = [];

  // Update KPI Bar
  el.statFileName.textContent = data.filename || 'Unknown';
  el.statFileName.title = data.filename || '';
  el.statRuleset.textContent = data.ruleset ? `Ruleset: ${data.ruleset}` : (data.software_version || '-');
  el.statTotalSpaces.textContent = data.total_spaces;
  el.statValidSpaces.textContent = `${data.valid_count} intact`;
  el.statMissingCount.textContent = data.missing_count;
  el.statFixedCount.textContent = `0 fixed`;
  el.statMaxIDs.textContent = `#${data.max_polyloop_id} / #${data.max_cartesian_id}`;

  el.badgeMissingCount.textContent = data.missing_count;
  el.badgeFixedCount.textContent = '0';
  el.badgeAllCount.textContent = data.total_spaces;

  el.btnAutoFixAll.disabled = data.missing_count === 0;
  el.btnDownloadFixed.disabled = false;

  renderSpacesList();

  // Automatically select the first missing space if available
  if (data.missing_spaces && data.missing_spaces.length > 0) {
    selectSpace(data.missing_spaces[0].name);
  } else if (data.valid_spaces && data.valid_spaces.length > 0) {
    selectSpace(data.valid_spaces[0].name);
  }
}

// -------------------------------------------------------------
// Spaces Explorer & Navigation
// -------------------------------------------------------------

function renderSpacesList() {
  if (!state.model) {
    el.spacesList.innerHTML = '<div class="empty-state"><p>No model loaded.</p></div>';
    return;
  }

  let spacesToDisplay = [];

  if (state.activeFilter === 'missing') {
    spacesToDisplay = state.model.missing_spaces.filter(s => !state.fixedSpaces[s.name]);
  } else if (state.activeFilter === 'fixed') {
    spacesToDisplay = state.model.missing_spaces.filter(s => !!state.fixedSpaces[s.name]);
  } else {
    // 'all'
    const missing = state.model.missing_spaces || [];
    const valid = state.model.valid_spaces || [];
    spacesToDisplay = [...missing, ...valid];
  }

  // Filter by search query
  if (state.searchQuery) {
    spacesToDisplay = spacesToDisplay.filter(s => {
      const name = s.name.toLowerCase();
      const zone = (s.thermal_zone || '').toLowerCase();
      return name.includes(state.searchQuery) || zone.includes(state.searchQuery);
    });
  }

  if (spacesToDisplay.length === 0) {
    el.spacesList.innerHTML = '<div class="empty-state"><p>No spaces matching this filter.</p></div>';
    return;
  }

  el.spacesList.innerHTML = spacesToDisplay.map(spc => {
    const isMissingOriginal = state.model.missing_spaces.some(m => m.name === spc.name);
    const isFixed = !!state.fixedSpaces[spc.name];
    const isSelected = spc.name === state.selectedSpaceName;
    const isAreaMismatch = !!(spc.area_mismatch);

    let statusClass = 'valid';
    let statusText = 'Valid';

    if (isFixed) {
      statusClass = 'fixed';
      statusText = 'Fixed';
    } else if (isAreaMismatch) {
      statusClass = 'mismatch';
      statusText = 'Area Mismatch';
    } else if (isMissingOriginal) {
      statusClass = 'missing';
      statusText = 'Missing';
    }

    const cardClass = `space-card ${isSelected ? 'selected' : ''} is-${statusClass}`;
    let floorInfo = spc.floors ? `${spc.floors.length} child floor(s)` : 'Intact PolyLoop';
    if (spc.can_reuse_poly_name && spc.existing_poly_name) {
      floorInfo += ` • Reusing ${spc.existing_poly_name}`;
    }
    if (isAreaMismatch && spc.existing_poly_area != null && spc.combined_floor_area != null) {
      floorInfo = `PolyLp: ${spc.existing_poly_area.toLocaleString()} vs Floors: ${spc.combined_floor_area.toLocaleString()} sq ft`;
    }

    return `
      <div class="${cardClass}" onclick="selectSpace('${escapeHtml(spc.name)}')">
        <div class="space-card-top">
          <span class="space-card-name" title="${escapeHtml(spc.name)}">${escapeHtml(spc.name)}</span>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="space-card-sub">
          <span>${floorInfo}</span>
          ${spc.thermal_zone ? `<span class="bullet">•</span><span class="text-ellipsis">${escapeHtml(spc.thermal_zone)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function selectSpace(spaceName) {
  state.selectedSpaceName = spaceName;
  state.selectedVertexIndex = -1;
  state.hoveredVertexIndex = -1;

  // Find in missing spaces or valid spaces
  let spc = state.model.missing_spaces.find(s => s.name === spaceName);
  const isInMissing = !!spc;

  if (!spc) {
    spc = state.model.valid_spaces.find(s => s.name === spaceName);
  }

  if (!spc) return;

  state.activeSpaceData = spc;
  const isAreaMismatch = !!(spc.area_mismatch);
  const isValidSpace = !isInMissing;

  // Update Inspector Header
  el.inspSpaceName.textContent = spc.name;
  el.inspThermalZone.textContent = spc.thermal_zone ? `Zone: ${spc.thermal_zone}` : 'Zone: None';
  el.inspStory.textContent = spc.story ? `Story: ${spc.story}` : 'Story: Standard';

  const isFixed = !!state.fixedSpaces[spaceName];

  if (isFixed) {
    el.inspSpaceStatus.textContent = 'Fixed (Ready for export)';
    el.inspSpaceStatus.style.color = 'var(--ob-green)';
    el.btnApplyFixSingle.textContent = 'Update Fix';
  } else if (isAreaMismatch) {
    const polyArea = spc.existing_poly_area != null ? spc.existing_poly_area.toLocaleString() : '?';
    const floorArea = spc.combined_floor_area != null ? spc.combined_floor_area.toLocaleString() : '?';
    const pct = (spc.existing_poly_area != null && spc.combined_floor_area != null && spc.combined_floor_area > 0)
      ? ((Math.abs(spc.existing_poly_area - spc.combined_floor_area) / spc.combined_floor_area) * 100).toFixed(1)
      : '?';
    el.inspSpaceStatus.textContent = `Area Mismatch: PolyLp ${polyArea} vs Floors ${floorArea} sq ft (${pct}% off)`;
    el.inspSpaceStatus.style.color = 'var(--ob-warn)';
    el.btnApplyFixSingle.textContent = 'Replace with Floor Union';
  } else if (!isValidSpace) {
    if (spc.can_reuse_poly_name && spc.existing_poly_name) {
      el.inspSpaceStatus.textContent = `Empty PolyLoop (${spc.existing_coords_count || 0} pts) • Reusing '${spc.existing_poly_name}'`;
      el.inspSpaceStatus.style.color = 'var(--ob-warn)';
      el.btnApplyFixSingle.textContent = `Fix & Reuse '${spc.existing_poly_name}'`;
    } else {
      el.inspSpaceStatus.textContent = 'Missing PolyLoop (Action Required)';
      el.inspSpaceStatus.style.color = 'var(--ob-alert)';
      el.btnApplyFixSingle.textContent = 'Apply Fix to Space';
    }
  } else {
    el.inspSpaceStatus.textContent = `Valid Space (${spc.existing_poly_name || 'PolyLoop'} intact)`;
    el.inspSpaceStatus.style.color = 'var(--ob-muted)';
    el.btnApplyFixSingle.textContent = 'PolyLoop Already Present';
  }

  // Disable fix button only for truly valid spaces (no mismatch, not missing)
  el.btnApplyFixSingle.disabled = isValidSpace && !isAreaMismatch;

  // Floor Inclusions Setup
  if (spc.floors && spc.floors.length > 0) {
    state.includedFloorIndices = spc.floors.map((_, i) => i);
    renderFloorCheckboxes(spc.floors);
  } else {
    state.includedFloorIndices = [];
    el.floorsCheckboxes.innerHTML = '<span style="color: var(--ob-muted); font-size: 11px;">No individual child floors defined.</span>';
  }

  // Set Active Vertices
  if (isFixed) {
    state.activeVertices = JSON.parse(JSON.stringify(state.fixedSpaces[spaceName]));
  } else if (isAreaMismatch && spc.auto_union && spc.auto_union.vertices) {
    // For area-mismatch: show the computed floor union as the proposed fix
    state.activeVertices = JSON.parse(JSON.stringify(spc.auto_union.vertices));
  } else if (!isValidSpace && spc.auto_union && spc.auto_union.vertices) {
    state.activeVertices = JSON.parse(JSON.stringify(spc.auto_union.vertices));
  } else if (isValidSpace && spc.coords) {
    state.activeVertices = JSON.parse(JSON.stringify(spc.coords));
  } else {
    state.activeVertices = [];
  }

  const avgZ = state.activeVertices.length > 0 ? state.activeVertices[0][2] : 0.0;
  el.inspElevation.textContent = `Z: ${avgZ} ft`;

  renderCoordTable();
  updateGeomKPIs();
  updateLegend();
  renderSpacesList();
  fitView();
}

function selectNextSpace() {
  if (!state.model) return;
  const missing = state.model.missing_spaces;
  if (!missing || missing.length === 0) return;

  const currentIdx = missing.findIndex(s => s.name === state.selectedSpaceName);
  const nextIdx = (currentIdx + 1) % missing.length;
  selectSpace(missing[nextIdx].name);
}

function selectPrevSpace() {
  if (!state.model) return;
  const missing = state.model.missing_spaces;
  if (!missing || missing.length === 0) return;

  const currentIdx = missing.findIndex(s => s.name === state.selectedSpaceName);
  const prevIdx = (currentIdx - 1 + missing.length) % missing.length;
  selectSpace(missing[prevIdx].name);
}

function renderFloorCheckboxes(floors) {
  el.floorsCheckboxes.innerHTML = floors.map((f, idx) => {
    const isChecked = state.includedFloorIndices.includes(idx);
    const color = FLOOR_COLORS[idx % FLOOR_COLORS.length].stroke;
    return `
      <label class="floor-check-item">
        <input type="checkbox" data-floor-idx="${idx}" ${isChecked ? 'checked' : ''} onchange="toggleFloorInclusion(${idx})">
        <span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:${color};"></span>
        <span>${escapeHtml(f.name || f.type)} (${f.coords_count} pts)</span>
      </label>
    `;
  }).join('');
}

function toggleFloorInclusion(idx) {
  if (state.includedFloorIndices.includes(idx)) {
    state.includedFloorIndices = state.includedFloorIndices.filter(i => i !== idx);
  } else {
    state.includedFloorIndices.push(idx);
  }
  triggerRecalculate();
}

async function triggerRecalculate() {
  if (!state.activeSpaceData || !state.activeSpaceData.floors) return;

  const simplifyTol = parseFloat(el.sliderSimplify.value);
  const snapTol = parseFloat(el.sliderSnap.value);

  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/recalculate-space', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_name: state.selectedSpaceName,
          simplify_tol: simplifyTol,
          snap_tol: snapTol,
          included_floors: state.includedFloorIndices
        })
      });
      const data = await res.json();
      if (data.success && data.result) {
        if (data.result.success) {
          state.activeVertices = JSON.parse(JSON.stringify(data.result.vertices));
          renderCoordTable();
          updateGeomKPIs(data.result);
          renderCanvas();
          showToast('Union geometry recalculated.');
        } else {
          showToast(`Calculation warning: ${data.result.error}`);
        }
        return;
      }
    } catch (err) {
      console.warn('Server recalculate failed, falling back to local JS:', err);
    }
  }

  // Pure JS recalculation (Browser Mode / GitHub Pages)
  const res = combineFloorsJS(state.activeSpaceData.floors, simplifyTol, state.includedFloorIndices);
  if (res.success) {
    state.activeVertices = JSON.parse(JSON.stringify(res.vertices));
    renderCoordTable();
    updateGeomKPIs(res);
    renderCanvas();
    showToast('Union geometry recalculated.');
  } else {
    showToast(`Calculation warning: ${res.error}`);
  }
}

// -------------------------------------------------------------
// Coordinate Table & Geometry KPIs
// -------------------------------------------------------------

function updateGeomKPIs(geomData) {
  const vertCount = state.activeVertices.length;
  el.kpiVertexCount.textContent = vertCount;

  if (geomData && geomData.area !== undefined) {
    el.kpiArea.textContent = `${geomData.area.toLocaleString()} sq ft`;
    el.kpiMultiPartBadge.style.display = geomData.is_multipolygon ? 'inline-block' : 'none';
  } else {
    // Approximate area via Shoelace formula
    const area = calculateShoelaceArea(state.activeVertices);
    el.kpiArea.textContent = `${area.toLocaleString()} sq ft`;
    el.kpiMultiPartBadge.style.display = 'none';
  }
}

function calculateShoelaceArea(pts) {
  if (!pts || pts.length < 3) return 0.0;
  let area = 0.0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1];
    area -= pts[j][0] * pts[i][1];
  }
  return Math.abs(area / 2.0);
}

function renderCoordTable() {
  el.coordTableBody.innerHTML = state.activeVertices.map((pt, idx) => {
    const isSelected = idx === state.selectedVertexIndex;
    return `
      <tr class="${isSelected ? 'selected-row' : ''}">
        <td style="font-family: var(--font-mono); font-weight: 600; color: var(--ob-blue);">${idx + 1}</td>
        <td>
          <input type="number" step="0.01" value="${pt[0]}" onchange="handleCoordEdit(${idx}, 0, this.value)">
        </td>
        <td>
          <input type="number" step="0.01" value="${pt[1]}" onchange="handleCoordEdit(${idx}, 1, this.value)">
        </td>
        <td>
          <input type="number" step="0.01" value="${pt[2]}" onchange="handleCoordEdit(${idx}, 2, this.value)">
        </td>
        <td>
          <button class="btn-del-pt" onclick="deleteVertex(${idx})">Del</button>
        </td>
      </tr>
    `;
  }).join('');
}

function handleCoordEdit(vertexIdx, coordIdx, newVal) {
  const parsed = parseFloat(newVal);
  if (!isNaN(parsed) && state.activeVertices[vertexIdx]) {
    state.activeVertices[vertexIdx][coordIdx] = parsed;
    updateGeomKPIs();
    renderCanvas();
  }
}

function deleteVertex(idx) {
  if (state.activeVertices.length <= 3) {
    alert('A polyloop must contain at least 3 vertices.');
    return;
  }
  state.activeVertices.splice(idx, 1);
  renderCoordTable();
  updateGeomKPIs();
  renderCanvas();
  showToast(`Vertex #${idx + 1} deleted.`);
}

function updateLegend() {
  const items = [];

  // For area-mismatch spaces: show the existing (amber) PolyLp in the legend
  if (state.activeSpaceData && state.activeSpaceData.area_mismatch) {
    items.push(`
      <div class="legend-row">
        <div class="legend-swatch" style="background:#F59E0B; border: 2px dashed #B45309;"></div>
        <span>Existing PolyLp (mismatch)</span>
      </div>
    `);
  }

  // Space PolyLoop boundary (proposed fix / current)
  const polyLabel = (state.activeSpaceData && state.activeSpaceData.area_mismatch)
    ? `Floor Union Fix (${state.activeVertices.length} pts)`
    : `Space PolyLoop (${state.activeVertices.length} pts)`;
  items.push(`
    <div class="legend-row">
      <div class="legend-swatch polyloop-swatch"></div>
      <span>${polyLabel}</span>
    </div>
  `);


  // Child floors
  if (state.activeSpaceData && state.activeSpaceData.floors) {
    state.activeSpaceData.floors.forEach((flr, idx) => {
      const color = FLOOR_COLORS[idx % FLOOR_COLORS.length].stroke;
      items.push(`
        <div class="legend-row">
          <div class="legend-swatch" style="background:${color};"></div>
          <span class="text-ellipsis">${flr.type}: ${flr.name}</span>
        </div>
      `);
    });
  }

  el.legendItems.innerHTML = items.join('');
}

// -------------------------------------------------------------
// Fix Actions (Single Space & Batch)
// -------------------------------------------------------------

async function applyFixToCurrentSpace() {
  if (!state.selectedSpaceName || state.activeVertices.length < 3) {
    alert('Invalid space geometry to fix.');
    return;
  }

  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/apply-fix-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_name: state.selectedSpaceName,
          vertices: state.activeVertices
        })
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('Server single fix failed, continuing in browser mode');
      }
    } catch (err) {
      console.warn('Server single fix error:', err);
    }
  }

  // Update local state
  state.fixedSpaces[state.selectedSpaceName] = JSON.parse(JSON.stringify(state.activeVertices));

  // Update KPIs
  const fixedCount = Object.keys(state.fixedSpaces).length;
  el.statFixedCount.textContent = `${fixedCount} fixed`;
  el.badgeFixedCount.textContent = fixedCount;

  showToast(`Fixed PolyLoop applied for '${state.selectedSpaceName}'!`);
  renderSpacesList();

  // Auto-advance to next missing space
  selectNextSpace();
}

async function applyFixAllSpaces() {
  if (!state.model || state.model.missing_count === 0) return;

  const confirmMsg = `Auto-fix all ${state.model.missing_count} missing spaces by unioning their child floor polyloops?`;
  if (!confirm(confirmMsg)) return;

  showToast('Processing all missing spaces...');

  if (state.serverAvailable) {
    try {
      const res = await fetch('/api/apply-fix-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('Server batch fix failed, continuing in browser mode');
      }
    } catch (err) {
      console.warn('Server batch fix error:', err);
    }
  }

  // Pure JS batch repair (always sets all missing spaces)
  state.model.missing_spaces.forEach(s => {
    if (!state.fixedSpaces[s.name] && s.auto_union && s.auto_union.vertices) {
      state.fixedSpaces[s.name] = s.auto_union.vertices;
    }
  });

  const fixedCount = Object.keys(state.fixedSpaces).length;
  el.statFixedCount.textContent = `${fixedCount} fixed`;
  el.badgeFixedCount.textContent = fixedCount;

  renderSpacesList();
  selectSpace(state.selectedSpaceName);

  showToast(`All ${fixedCount} missing spaces successfully repaired!`);
  alert(`Successfully repaired all ${fixedCount} missing spaces!\nClick 'Download Repaired File' to save your updated CBECC file.`);
}

function downloadRepairedFile() {
  if (state.serverAvailable) {
    window.location.href = '/api/download';
    return;
  }

  if (!state.rawContent) {
    alert('No active CBECC file content loaded to download.');
    return;
  }

  const metaMap = {};
  if (state.model && state.model.spaces) {
    state.model.spaces.forEach(s => {
      metaMap[s.name] = {
        can_reuse_poly_name: Boolean(s.can_reuse_poly_name || s.area_mismatch),
        existing_poly_name: s.existing_poly_name
      };
    });
  }

  const startPoly = (state.model ? state.model.max_polyloop_id : 0) + 1;
  const startCart = (state.model ? state.model.max_cartesian_id : 0) + 1;
  const inj = injectFixesJS(
    state.rawContent,
    state.fixedSpaces,
    startPoly,
    startCart,
    metaMap
  );

  const blob = new Blob([inj.repairedText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const originalFilename = (state.model && state.model.filename) ? state.model.filename : 'model.cibd19';
  const downloadName = originalFilename.replace(/(\.[^.]+)$/, '_fixed$1');

  a.href = url;
  a.download = downloadName.includes('_fixed') ? downloadName : `${downloadName}_fixed.cibd`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded repaired file: ${a.download}`);
}

// -------------------------------------------------------------
// Standalone Pure-JavaScript CBECC Geometry & Parser Engine
// (Enables complete execution on static hosts like GitHub Pages)
// -------------------------------------------------------------

function parseCoordLine(line) {
  const m = line.match(/\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\)/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }
  return null;
}

function shoelaceArea2D(coords) {
  const n = coords.length;
  if (n < 3) return 0.0;
  let area = 0.0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1];
    area -= coords[j][0] * coords[i][1];
  }
  return Math.abs(area) / 2.0;
}

function simplifyCollinear(pts, tol = 0.01) {
  if (pts.length <= 3) return pts;
  let changed = true;
  let cur = [...pts];
  while (changed && cur.length > 3) {
    changed = false;
    const next = [];
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      const prev = cur[(i - 1 + n) % n];
      const p = cur[i];
      const nxt = cur[(i + 1) % n];

      const dx = nxt[0] - prev[0];
      const dy = nxt[1] - prev[1];
      const lenSq = dx * dx + dy * dy;
      let dist = 0;
      if (lenSq === 0) {
        dist = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      } else {
        const t = ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / lenSq;
        if (t >= -0.05 && t <= 1.05) {
          const px = prev[0] + t * dx;
          const py = prev[1] + t * dy;
          dist = Math.hypot(p[0] - px, p[1] - py);
        } else {
          dist = 1000;
        }
      }

      if (dist < tol) {
        changed = true;
      } else {
        next.push(p);
      }
    }
    cur = next;
  }
  return cur;
}

function combineFloorsJS(floors, simplifyTol = 0.01, includedFloorIndices = null) {
  if (!floors || floors.length === 0) {
    return { success: false, error: 'No child floors found for this space.', vertices: [], area: 0, z: 0 };
  }

  const validFloors = floors.filter((f, idx) => {
    if (includedFloorIndices !== null && !includedFloorIndices.includes(idx)) return false;
    return f.coords && f.coords.length >= 3;
  });

  if (validFloors.length === 0) {
    return { success: false, error: 'Child floors do not contain valid coordinates.', vertices: [], area: 0, z: 0 };
  }

  let zSum = 0, zCount = 0;
  validFloors.forEach(f => f.coords.forEach(pt => { zSum += pt[2]; zCount++; }));
  const avgZ = Math.round((zSum / zCount) * 10000) / 10000;

  const floorDetails = validFloors.map((f, idx) => {
    const coords2d = f.coords.map(p => [p[0], p[1]]);
    return {
      index: idx,
      type: f.type || 'Floor',
      name: f.name || `Floor ${idx + 1}`,
      coords_count: f.coords.length,
      coords_2d: coords2d,
      area: Math.round(shoelaceArea2D(coords2d) * 100) / 100
    };
  });

  // Convert each floor to polygon ring: [[[x, y], ...]]
  const floorPolys = validFloors.map(f => {
    const pts = f.coords.map(p => [p[0], p[1]]);
    if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
      pts.push([...pts[0]]);
    }
    return [pts];
  });

  let unionGeom = floorPolys[0];
  const clippingEngine = (typeof window !== 'undefined' && window.martinez)
    ? window.martinez
    : (typeof martinez !== 'undefined' ? martinez : null);

  if (clippingEngine && clippingEngine.union) {
    for (let i = 1; i < floorPolys.length; i++) {
      try {
        unionGeom = clippingEngine.union(unionGeom, floorPolys[i]);
      } catch (e) {
        console.warn('Martinez union warning:', e);
      }
    }
  }

  // Normalize exterior rings from union output
  let rings = [];
  if (Array.isArray(unionGeom) && unionGeom.length > 0) {
    if (Array.isArray(unionGeom[0]) && Array.isArray(unionGeom[0][0]) && Array.isArray(unionGeom[0][0][0])) {
      for (const poly of unionGeom) {
        if (poly && poly.length > 0 && poly[0].length >= 3) {
          rings.push(poly[0]);
        }
      }
    } else if (Array.isArray(unionGeom[0]) && Array.isArray(unionGeom[0][0])) {
      rings.push(unionGeom[0]);
    } else if (Array.isArray(unionGeom[0])) {
      rings.push(unionGeom);
    }
  }

  if (rings.length === 0) {
    return { success: false, error: 'Union produced empty geometry.', vertices: [], area: 0, z: avgZ };
  }

  let bestRing = rings[0];
  let maxArea = shoelaceArea2D(bestRing);
  for (let r = 1; r < rings.length; r++) {
    const a = shoelaceArea2D(rings[r]);
    if (a > maxArea) {
      maxArea = a;
      bestRing = rings[r];
    }
  }

  const rawCoords = (bestRing[0][0] === bestRing[bestRing.length - 1][0] &&
                     bestRing[0][1] === bestRing[bestRing.length - 1][1])
    ? bestRing.slice(0, -1)
    : bestRing;

  const simplified = simplifyCollinear(rawCoords, simplifyTol);
  const finalVerts = simplified.map(p => [
    Math.round(p[0] * 10000) / 10000,
    Math.round(p[1] * 10000) / 10000,
    avgZ
  ]);

  const cleanArea = Math.round(shoelaceArea2D(finalVerts) * 100) / 100;

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  finalVerts.forEach(v => {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  });

  return {
    success: true,
    is_multipolygon: rings.length > 1,
    num_parts: rings.length,
    vertices: finalVerts,
    vertex_count: finalVerts.length,
    area: cleanArea,
    total_area: Math.round(maxArea * 100) / 100,
    z: avgZ,
    bounds: [minX, minY, maxX, maxY],
    floor_details: floorDetails
  };
}

function parseCBECCModelJS(content, filename = 'model.cibd') {
  const lines = content.split(/\r?\n/);
  let ruleset = '';
  let software_version = '';
  let bldg_version = null;

  for (let i = 0; i < Math.min(lines.length, 60); i++) {
    const line = lines[i].trim();
    const rMatch = line.match(/^RulesetFilename\s+"([^"]*)"/);
    if (rMatch) ruleset = rMatch[1];
    const vMatch = line.match(/SoftwareVersion\s*=\s*"([^"]*)"/);
    if (vMatch) software_version = vMatch[1];
    const bMatch = line.match(/BldgEngyModelVersion\s*=\s*(\d+)/);
    if (bMatch) bldg_version = parseInt(bMatch[1]);
  }

  const polyMatches = [...content.matchAll(/PolyLp\s+"(?:PolyLoop\s+)?(\d+)"/g)].map(m => parseInt(m[1]));
  const cartMatches = [...content.matchAll(/CartesianPt\s+"(?:CartesianPoint\s+)?(\d+)"/g)].map(m => parseInt(m[1]));

  const maxPolyId = polyMatches.length ? Math.max(...polyMatches) : 0;
  const maxCartId = cartMatches.length ? Math.max(...cartMatches) : 0;

  const spaces = [];
  let currentSpc = null;
  let currentFlr = null;
  let currentFlrPts = [];

  let i = 0;
  const totalLines = lines.length;

  while (i < totalLines) {
    const trimmed = lines[i].trim();
    const mObj = trimmed.match(/^([A-Za-z0-9_]+)\s+"([^"]*)"/);

    if (mObj) {
      const objType = mObj[1];
      const objName = mObj[2];

      if (currentFlr && !['PolyLp', 'CartesianPt'].includes(objType)) {
        if (currentFlrPts.length) {
          currentFlr.coords = [...currentFlrPts];
          currentFlrPts = [];
        }
        currentFlr = null;
      }

      if (['Spc', 'Story', 'ThrmlZn'].includes(objType)) {
        if (currentSpc) {
          spaces.push(currentSpc);
          currentSpc = null;
        }
      }

      if (objType === 'Spc') {
        const spcStartLine = i;
        let j = i + 1;
        const spcProps = {};
        while (j < totalLines && lines[j].trim() !== '..') {
          const pLine = lines[j].trim();
          if (pLine.includes('=')) {
            const [k, v] = pLine.split('=', 2);
            spcProps[k.trim()] = v.trim().replace(/^"|"$/g, '');
          }
          j++;
        }
        const spcEndLine = j;

        let k = spcEndLine + 1;
        while (k < totalLines && !lines[k].trim()) k++;

        let hasPolyLpHeader = false;
        let existingPolyName = null;
        const existingPolyCoords = [];

        if (k < totalLines && lines[k].trim().startsWith('PolyLp ')) {
          hasPolyLpHeader = true;
          const pm = lines[k].trim().match(/^PolyLp\s+"([^"]*)"/);
          if (pm) existingPolyName = pm[1];

          let kPt = k + 1;
          while (kPt < totalLines && lines[kPt].trim() !== '..') kPt++;
          kPt++;

          while (kPt < totalLines) {
            while (kPt < totalLines && !lines[kPt].trim()) kPt++;
            if (kPt < totalLines && lines[kPt].trim().startsWith('CartesianPt ')) {
              while (kPt < totalLines && lines[kPt].trim() !== '..') {
                const sub = lines[kPt].trim();
                if (sub.startsWith('Coord =')) {
                  const pt = parseCoordLine(sub);
                  if (pt) existingPolyCoords.push(pt);
                }
                kPt++;
              }
              kPt++;
            } else {
              break;
            }
          }
        }

        const hasValidPoly = hasPolyLpHeader && existingPolyCoords.length >= 3;
        const existingArea = hasValidPoly ? shoelaceArea2D(existingPolyCoords) : null;

        currentSpc = {
          name: objName,
          line_start: spcStartLine + 1,
          line_end: spcEndLine + 1,
          properties: spcProps,
          thermal_zone: spcProps.ThrmlZnRef || '',
          story: spcProps.StoryRef || '',
          declared_area: spcProps.Area ? parseFloat(spcProps.Area) : null,
          has_polyloop: hasValidPoly,
          has_polylp_header: hasPolyLpHeader,
          can_reuse_poly_name: hasPolyLpHeader && (existingPolyCoords.length < 3),
          existing_poly_name: existingPolyName,
          existing_coords: existingPolyCoords,
          existing_coords_count: existingPolyCoords.length,
          existing_poly_area: existingArea ? Math.round(existingArea * 100) / 100 : null,
          area_mismatch: false,
          floors: []
        };
      } else if (currentSpc && ['IntFlr', 'ExtFlr', 'UndgrFlr'].includes(objType)) {
        currentFlr = {
          type: objType,
          name: objName,
          line: i + 1,
          coords: []
        };
        currentSpc.floors.push(currentFlr);
      }
    } else if (currentFlr && trimmed.startsWith('Coord =')) {
      const pt = parseCoordLine(trimmed);
      if (pt) currentFlrPts.push(pt);
    }
    i++;
  }

  if (currentFlr && currentFlrPts.length) {
    currentFlr.coords = [...currentFlrPts];
  }
  if (currentSpc) {
    spaces.push(currentSpc);
  }

  // Second pass: compute area mismatches & precalculate auto unions
  for (const spc of spaces) {
    const unionRes = combineFloorsJS(spc.floors);
    spc.auto_union = unionRes;
    spc.combined_floor_area = unionRes.success ? unionRes.area : null;

    if (spc.has_polyloop && spc.existing_poly_area && unionRes.success && unionRes.area > 0) {
      const diffRatio = Math.abs(spc.existing_poly_area - unionRes.area) / unionRes.area;
      if (diffRatio > 0.05) {
        spc.area_mismatch = true;
      }
    }
  }

  const missingSpaces = spaces.filter(s => !s.has_polyloop || s.area_mismatch);
  const validSpaces = spaces.filter(s => s.has_polyloop && !s.area_mismatch);

  return {
    success: true,
    filename,
    ruleset,
    software_version,
    bldg_version,
    total_spaces: spaces.length,
    missing_count: missingSpaces.length,
    valid_count: validSpaces.length,
    max_polyloop_id: maxPolyId,
    max_cartesian_id: maxCartId,
    spaces,
    missing_spaces: missingSpaces,
    valid_spaces: validSpaces
  };
}

function generatePolyLoopBlockJS(polyloopName, cartesianStartId, vertices) {
  let lines = [];
  lines.push(`PolyLp   "${polyloopName}"  \n`);
  lines.push('   ..\n\n');

  let curCartId = cartesianStartId;
  for (const [x, y, z] of vertices) {
    lines.push(`CartesianPt   "CartesianPoint ${curCartId}"  \n`);
    lines.push(`   Coord = ( ${x}, ${y}, ${z} )\n`);
    lines.push('   ..\n\n');
    curCartId++;
  }
  return { blockText: lines.join(''), nextCartId: curCartId };
}

function injectFixesJS(originalContent, fixes, startPolyId, startCartId, spaceMetaMap = {}) {
  const lines = originalContent.split(/\r?\n/);
  const outLines = [];

  let curPolyId = startPolyId;
  let curCartId = startCartId;

  let i = 0;
  const totalLines = lines.length;
  const appliedFixes = {};

  while (i < totalLines) {
    const line = lines[i];
    outLines.push(line);

    const mSpc = line.trim().match(/^Spc\s+"([^"]+)"/);
    if (mSpc) {
      const spcName = mSpc[1];

      i++;
      while (i < totalLines) {
        outLines.push(lines[i]);
        if (lines[i].trim() === '..') break;
        i++;
      }

      if (fixes[spcName]) {
        const vertices = fixes[spcName];
        const meta = spaceMetaMap[spcName] || {};
        let canReuse = meta.can_reuse_poly_name;
        let existingName = meta.existing_poly_name;

        let j = i + 1;
        while (j < totalLines && !lines[j].trim()) j++;

        if (j < totalLines && lines[j].trim().startsWith('PolyLp ')) {
          if (!existingName) {
            const pm = lines[j].trim().match(/^PolyLp\s+"([^"]*)"/);
            if (pm) {
              existingName = pm[1];
              canReuse = true;
            }
          }

          while (j < totalLines && lines[j].trim() !== '..') j++;
          j++;

          while (j < totalLines) {
            while (j < totalLines && !lines[j].trim()) j++;
            if (j < totalLines && lines[j].trim().startsWith('CartesianPt ')) {
              while (j < totalLines && lines[j].trim() !== '..') j++;
              j++;
            } else {
              break;
            }
          }
          i = j - 1;
        }

        let polyName;
        if (canReuse && existingName) {
          polyName = existingName;
        } else {
          polyName = `PolyLoop ${curPolyId}`;
          curPolyId++;
        }

        const gen = generatePolyLoopBlockJS(polyName, curCartId, vertices);
        outLines.push('\n' + gen.blockText);

        appliedFixes[spcName] = {
          polyloop_name: polyName,
          reused_name: Boolean(canReuse && existingName),
          num_vertices: vertices.length,
          cartesian_range: [curCartId, gen.nextCartId - 1]
        };

        curCartId = gen.nextCartId;
      }
    }
    i++;
  }

  const repairedText = outLines.join('\n');
  return {
    repairedText,
    summary: {
      fixed_count: Object.keys(appliedFixes).length,
      applied_fixes: appliedFixes,
      next_poly_id: curPolyId,
      next_cart_id: curCartId
    }
  };
}

// -------------------------------------------------------------
// Interactive CAD Canvas Viewport Engine
// -------------------------------------------------------------

function setupCanvas() {
  const canvas = el.canvas;
  const ctx = canvas.getContext('2d');

  function resize() {
    const rect = el.canvasWrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    renderCanvas();
  }

  window.addEventListener('resize', resize);
  resize();

  // Mouse Interaction: Pan, Zoom, Hover
  el.canvasWrapper.addEventListener('mousedown', (e) => {
    state.isPanning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      const dx = e.clientX - state.panStart.x;
      const dy = e.clientY - state.panStart.y;
      state.transform.offsetX += dx;
      state.transform.offsetY += dy;
      state.panStart = { x: e.clientX, y: e.clientY };
      renderCanvas();
    } else {
      handleCanvasHover(e);
    }
  });

  window.addEventListener('mouseup', () => {
    state.isPanning = false;
  });

  el.canvasWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const rect = el.canvasWrapper.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom centered on cursor
    state.transform.offsetX = mouseX - (mouseX - state.transform.offsetX) * zoomFactor;
    state.transform.offsetY = mouseY - (mouseY - state.transform.offsetY) * zoomFactor;
    state.transform.scale *= zoomFactor;

    renderCanvas();
  });
}

function zoomView(factor) {
  const rect = el.canvasWrapper.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  state.transform.offsetX = cx - (cx - state.transform.offsetX) * factor;
  state.transform.offsetY = cy - (cy - state.transform.offsetY) * factor;
  state.transform.scale *= factor;
  renderCanvas();
}

function fitView() {
  const allPoints = [];

  // Collect vertices from active polyloop
  state.activeVertices.forEach(p => allPoints.push({ x: p[0], y: p[1] }));

  // For area-mismatch spaces: also include the existing (amber) PolyLp coords
  if (state.activeSpaceData && state.activeSpaceData.area_mismatch) {
    (state.activeSpaceData.existing_coords || []).forEach(p => allPoints.push({ x: p[0], y: p[1] }));
  }

  // Collect from child floors
  if (state.activeSpaceData && state.activeSpaceData.floors) {
    state.activeSpaceData.floors.forEach(f => {
      (f.coords || []).forEach(p => allPoints.push({ x: p[0], y: p[1] }));
    });
  }

  if (allPoints.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  allPoints.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });

  const rect = el.canvasWrapper.getBoundingClientRect();
  const pad = 60;
  const availW = rect.width - pad * 2;
  const availH = rect.height - pad * 2;

  const geomW = Math.max(maxX - minX, 1);
  const geomH = Math.max(maxY - minY, 1);

  const scale = Math.min(availW / geomW, availH / geomH);
  state.transform.scale = scale;

  // CBECC CAD coordinate system: +Y is UP, screen +Y is DOWN
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  state.transform.offsetX = rect.width / 2 - midX * scale;
  state.transform.offsetY = rect.height / 2 + midY * scale;

  renderCanvas();
}

function worldToScreen(x, y) {
  return {
    x: x * state.transform.scale + state.transform.offsetX,
    y: state.transform.offsetY - y * state.transform.scale // Invert Y for architectural CAD
  };
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - state.transform.offsetX) / state.transform.scale,
    y: (state.transform.offsetY - sy) / state.transform.scale
  };
}

function handleCanvasHover(e) {
  const rect = el.canvasWrapper.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  let hitIndex = -1;
  const hitRadius = 10;

  for (let i = 0; i < state.activeVertices.length; i++) {
    const pt = state.activeVertices[i];
    const s = worldToScreen(pt[0], pt[1]);
    const dist = Math.hypot(s.x - mouseX, s.y - mouseY);
    if (dist <= hitRadius) {
      hitIndex = i;
      break;
    }
  }

  if (hitIndex !== state.hoveredVertexIndex) {
    state.hoveredVertexIndex = hitIndex;
    renderCanvas();

    if (hitIndex !== -1) {
      const pt = state.activeVertices[hitIndex];
      el.vertexTooltip.style.display = 'block';
      el.vertexTooltip.style.left = `${mouseX + 14}px`;
      el.vertexTooltip.style.top = `${mouseY - 10}px`;
      el.vertexTooltip.innerHTML = `
        <strong>Vertex #${hitIndex + 1}</strong><br>
        X: ${pt[0].toFixed(3)} ft<br>
        Y: ${pt[1].toFixed(3)} ft<br>
        Z: ${pt[2].toFixed(3)} ft
      `;
    } else {
      el.vertexTooltip.style.display = 'none';
    }
  }
}

function renderCanvas() {
  const canvas = el.canvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  // Clear CAD Dark Background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, w, h);

  // Render Coordinate Grid
  drawGrid(ctx, w, h);

  // 1. Render Child Floors
  if (state.activeSpaceData && state.activeSpaceData.floors) {
    state.activeSpaceData.floors.forEach((flr, idx) => {
      if (!state.includedFloorIndices.includes(idx)) return;
      const pts = flr.coords || [];
      if (pts.length < 3) return;

      const palette = FLOOR_COLORS[idx % FLOOR_COLORS.length];
      ctx.beginPath();
      const s0 = worldToScreen(pts[0][0], pts[0][1]);
      ctx.moveTo(s0.x, s0.y);

      for (let i = 1; i < pts.length; i++) {
        const s = worldToScreen(pts[i][0], pts[i][1]);
        ctx.lineTo(s.x, s.y);
      }
      ctx.closePath();

      // Translucent fill
      ctx.fillStyle = palette.fill;
      ctx.fill();

      // Dashed border
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // 2. Render existing PolyLp (amber overlay) for area-mismatch spaces
  if (state.activeSpaceData && state.activeSpaceData.area_mismatch) {
    const existingCoords = state.activeSpaceData.existing_coords || [];
    if (existingCoords.length >= 3) {
      ctx.beginPath();
      const ep0 = worldToScreen(existingCoords[0][0], existingCoords[0][1]);
      ctx.moveTo(ep0.x, ep0.y);
      for (let i = 1; i < existingCoords.length; i++) {
        const ep = worldToScreen(existingCoords[i][0], existingCoords[i][1]);
        ctx.lineTo(ep.x, ep.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.fill();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Label: "Existing PolyLp" near centroid
      const cx = existingCoords.reduce((s, p) => s + p[0], 0) / existingCoords.length;
      const cy = existingCoords.reduce((s, p) => s + p[1], 0) / existingCoords.length;
      const cs = worldToScreen(cx, cy);
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.fillStyle = '#F59E0B';
      ctx.textAlign = 'center';
      ctx.fillText('Existing PolyLp', cs.x, cs.y);
      ctx.textAlign = 'left';
    }
  }

  // 3. Render Space PolyLoop Boundary (proposed fix in green)

  const verts = state.activeVertices;
  if (verts && verts.length >= 2) {
    ctx.beginPath();
    const p0 = worldToScreen(verts[0][0], verts[0][1]);
    ctx.moveTo(p0.x, p0.y);

    for (let i = 1; i < verts.length; i++) {
      const p = worldToScreen(verts[i][0], verts[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();

    // Solid outline with glowing green
    ctx.strokeStyle = '#8CBD3A';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(140, 189, 58, 0.7)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Vertex Markers with badges
    for (let i = 0; i < verts.length; i++) {
      const p = worldToScreen(verts[i][0], verts[i][1]);
      const isHovered = i === state.hoveredVertexIndex;
      const radius = isHovered ? 7 : 5;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#8CBD3A';
      ctx.fill();
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Numeric badge index
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(`${i + 1}`, p.x + 8, p.y - 6);
    }
  }
}

function drawGrid(ctx, w, h) {
  const origin = worldToScreen(0, 0);
  const scale = state.transform.scale;

  // Determine grid interval based on zoom scale (10ft, 20ft, 50ft, etc.)
  let gridFeet = 10;
  if (scale < 2) gridFeet = 50;
  if (scale < 0.5) gridFeet = 100;
  if (scale > 15) gridFeet = 2;
  if (scale > 30) gridFeet = 1;

  const gridPixels = gridFeet * scale;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;

  const startX = origin.x % gridPixels;
  for (let x = startX; x < w; x += gridPixels) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  const startY = origin.y % gridPixels;
  for (let y = startY; y < h; y += gridPixels) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw Origin Axes
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;
  // X-axis (Y = 0)
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.stroke();
  // Y-axis (X = 0)
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.stroke();
}

// -------------------------------------------------------------
// Utilities
// -------------------------------------------------------------

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.style.display = 'block';
  setTimeout(() => {
    el.toast.style.display = 'none';
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
