/**
 * app.js - Building Energy Performance Rating Compliance Extractor & Dashboard
 */

// =============================================================================
// Constants & Unit Conversion Factors
// =============================================================================
const CONVERSIONS = {
  KWH_TO_KBTU: 3.412142,
  THERM_TO_KBTU: 100.0,
  THERM_TO_KWH: 29.3071,
  KWH_TO_THERM: 1.0 / 29.3071,
};

// O'Brien360 Official Brand Palette
const SCENARIO_COLORS = {
  ap:             '#8CBD3A', // Pantone 368 C  - Signature O'Brien Green (Proposed Design)
  'baseline avg': '#4D76AD', // Pantone 7685 C - Slate Blue (Baseline Average)
  ab_avg:         '#4D76AD',
  ab1:            '#507281', // Pantone 2222 C - Marine Slate (Baseline 1)
  ab2:            '#62B8A4', // Pantone 3258 C - Teal (Baseline 2)
  ab3:            '#793E6D', // Pantone 2613 C - Aubergine (Baseline 3)
  ab4:            '#007AC9', // Pantone 2144 C - Title & Hyperlink Blue (Baseline 4)
};

const CHART_COLORS = [
  '#8CBD3A', // Pantone 368 C - Green
  '#4D76AD', // Pantone 7685 C - Slate Blue
  '#62B8A4', // Pantone 3258 C - Teal
  '#793E6D', // Pantone 2613 C - Aubergine
  '#507281', // Pantone 2222 C - Marine Slate
  '#007AC9', // Pantone 2144 C - Title & Hyperlink Blue
  '#66A154', // Pantone 7489 C - Sage Green
  '#483662', // Pantone 2118 C - Deep Purple
  '#E67E22', // Warm Amber (Gas Accent)
  '#C0392B', // Warm Crimson
  '#27AE60', // Emerald
  '#8E44AD', // Purple
  '#16A085', // Sea Green
  '#D35400', // Rust Orange
];

// =============================================================================
// Fixed Category Definitions
// All rows that ever appear in EAp2-4/5 CBECC-Com tables.
// electricityOnly: true means Gas columns show dash
// gasOnly: true means Electricity columns show dash
// =============================================================================
// =============================================================================
// Dashboard Category Definitions (11 Compliance Categories)
// Mapped to raw categories extracted from CBECC HTM files.
// =============================================================================
const FIXED_CATEGORIES = [
  {
    raw: 'Space Heating',
    label: 'Space Heating',
    electricityOnly: false,
    gasOnly: false,
    elecHtmCategories: ['Heating -- General', 'Heating -- Boiler Parasitic'],
    gasHtmCategories: ['Heating -- General']
  },
  {
    raw: 'Space Cooling',
    label: 'Space Cooling',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Cooling -- General'],
    gasHtmCategories: []
  },
  {
    raw: 'Interior Lighting',
    label: 'Interior Lighting',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Interior Lighting -- ComplianceLtg'],
    gasHtmCategories: []
  },
  {
    raw: 'Exterior lighting',
    label: 'Exterior Lighting',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Exterior Lighting -- General', 'Exterior Lighting -- Not Subdivided'],
    gasHtmCategories: []
  },
  {
    raw: 'Receptacle Equipment',
    label: 'Receptacle Equipment',
    electricityOnly: false,
    gasOnly: false,
    elecHtmCategories: [
      'Interior Equipment -- Receptacle',
      'Interior Equipment -- Refrig',
      'Interior Equipment -- Process',
      'Exterior Equipment -- Not Subdivided'
    ],
    gasHtmCategories: [
      'Interior Equipment -- Receptacle',
      'Interior Equipment -- Process',
      'Exterior Equipment -- Not Subdivided'
    ]
  },
  {
    raw: 'Elevators and escalators',
    label: 'Elevators & Escalators',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Interior Equipment -- Internal Transport'],
    gasHtmCategories: []
  },
  {
    raw: 'Fans-Interior',
    label: 'Fans - Interior',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Fans -- General', 'Fans -- Interior Fans'],
    gasHtmCategories: []
  },
  {
    raw: 'Fans-Parking Garage',
    label: 'Fans - Parking Garage',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Fans -- ProcessMotors', 'Fans -- Parking Garage'],
    gasHtmCategories: []
  },
  {
    raw: 'Pumps',
    label: 'Pumps',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Pumps -- General'],
    gasHtmCategories: []
  },
  {
    raw: 'Heat Rejection',
    label: 'Heat Rejection',
    electricityOnly: true,
    gasOnly: false,
    elecHtmCategories: ['Heat Rejection -- Not Subdivided', 'Heat Rejection -- General'],
    gasHtmCategories: []
  },
  {
    raw: 'Service Water Heating',
    label: 'Service Water Heating',
    electricityOnly: false,
    gasOnly: false,
    elecHtmCategories: [
      'Water Systems -- General',
      'Water Systems -- Water Heater Parasitic',
      'Water Systems -- Other'
    ],
    gasHtmCategories: ['Water Systems -- General']
  }
];

/**
 * Aggregates a rawCategoryMap (keyed by HTM categories) into the 11 dashboard compliance categories.
 * Category values are summed (e.g. Fans-Interior = Fans -- General + Fans -- Interior Fans).
 */
function buildDashboardCategoryMap(rawCategoryMap) {
  const categoryMap = {};

  FIXED_CATEGORIES.forEach(fc => {
    let elecKwh = 0;
    let elecDemW = 0;
    let gasTherm = 0;
    let gasDemBtuh = 0;

    (fc.elecHtmCategories || []).forEach(cat => {
      const r = rawCategoryMap ? rawCategoryMap[cat] : null;
      if (r) {
        elecKwh += (r.elecKwh || 0);
        elecDemW += (r.elecDemW || 0);
      }
    });

    (fc.gasHtmCategories || []).forEach(cat => {
      const r = rawCategoryMap ? rawCategoryMap[cat] : null;
      if (r) {
        gasTherm += (r.gasTherm || 0);
        gasDemBtuh += (r.gasDemBtuh || 0);
      }
    });

    // If rawCategoryMap already has this dashboard category directly
    if (rawCategoryMap && rawCategoryMap[fc.raw] && !fc.elecHtmCategories.includes(fc.raw)) {
      const direct = rawCategoryMap[fc.raw];
      elecKwh += (direct.elecKwh || 0);
      elecDemW += (direct.elecDemW || 0);
      gasTherm += (direct.gasTherm || 0);
      gasDemBtuh += (direct.gasDemBtuh || 0);
    }

    const elecKbtu = elecKwh * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu  = gasTherm * CONVERSIONS.THERM_TO_KBTU;

    categoryMap[fc.raw] = {
      rawCategory: fc.raw,
      label: fc.label,
      isTotal: false,
      elecKwh,
      elecDemW,
      gasTherm,
      gasDemBtuh,
      elecKbtu,
      gasKbtu,
      totalKbtu: elecKbtu + gasKbtu
    };
  });

  return categoryMap;
}

// 26 electricity categories in exact sequence from user template
const CSV_ELECS = [
  'Heating -- General',
  'Heating -- Boiler Parasitic',
  'Cooling -- General',
  'Interior Lighting -- ComplianceLtg',
  'Exterior Lighting -- General',
  'Exterior Lighting -- Not Subdivided',
  'Interior Equipment -- Receptacle',
  'Interior Equipment -- Refrig',
  'Interior Equipment -- Process',
  'Interior Equipment -- Internal Transport',
  'Exterior Equipment -- Not Subdivided',
  'Fans -- General',
  'Fans -- ProcessMotors',
  'Fans -- Parking Garage',
  'Fans -- Interior Fans',
  'Pumps -- General',
  'Heat Rejection -- Not Subdivided',
  'Heat Rejection -- General',
  'Humidification -- Not Subdivided',
  'Heat Recovery -- General',
  'Heat Recovery -- Not Subdivided',
  'Water Systems -- General',
  'Water Systems -- Water Heater Parasitic',
  'Water Systems -- Other',
  'Refrigeration -- Not Subdivided',
  'Generators -- General',
];

// 6 natural gas categories in exact sequence from user template
const CSV_GASES = [
  'Heating -- General',
  'Interior Equipment -- Receptacle',
  'Interior Equipment -- Process',
  'Exterior Equipment -- Not Subdivided',
  'Water Systems -- General',
  'Generators -- General',
];

// Standard 68-column 3-header rows: Scenario, one selected area, then the energy columns.
// Row 1: Dashboard Categories
const CSV_HEADER_ROW_1 = [
  "", "", "", "Building Area",
  "Space Heating", "",
  "Space Heating", "",
  "Space Cooling", "",
  "Interior Lighting", "",
  "Exterior lighting", "",
  "Exterior lighting", "",
  "Receptacle Equipment", "",
  "Receptacle Equipment", "",
  "Receptacle Equipment", "",
  "Elevators and escalators", "",
  "Receptacle Equipment", "",
  "Fans-Interior", "",
  "Fans-Parking Garage", "",
  "Fans-Parking Garage", "",
  "Fans-Interior", "",
  "Pumps", "",
  "Heat Rejection", "",
  "Heat Rejection", "",
  "", "",
  "", "",
  "", "",
  "Service Water Heating", "",
  "Service Water Heating", "",
  "Service Water Heating", "",
  "", "",
  "", "",
  "Space Heating", "",
  "Receptacle Equipment", "",
  "Receptacle Equipment", "",
  "Receptacle Equipment", "",
  "Service Water Heating", "",
  "", ""
];

// Row 2: HTM Categories
const CSV_HEADER_ROW_2 = [
  "Run ID", "Rev #", "Scenario", "Building Area [ft2]",
  "Heating -- General", "",
  "Heating -- Boiler Parasitic", "",
  "Cooling -- General", "",
  "Interior Lighting -- ComplianceLtg", "",
  "Exterior Lighting -- General", "",
  "Exterior Lighting -- Not Subdivided", "",
  "Interior Equipment -- Receptacle", "",
  "Interior Equipment -- Refrig", "",
  "Interior Equipment -- Process", "",
  "Interior Equipment -- Internal Transport", "",
  "Exterior Equipment -- Not Subdivided", "",
  "Fans -- General", "",
  "Fans -- ProcessMotors", "",
  "Fans -- Parking Garage", "",
  "Fans -- Interior Fans", "",
  "Pumps -- General", "",
  "Heat Rejection -- Not Subdivided", "",
  "Heat Rejection -- General", "",
  "Humidification -- Not Subdivided", "",
  "Heat Recovery -- General", "",
  "Heat Recovery -- Not Subdivided", "",
  "Water Systems -- General", "",
  "Water Systems -- Water Heater Parasitic", "",
  "Water Systems -- Other", "",
  "Refrigeration -- Not Subdivided", "",
  "Generators -- General", "",
  "Heating -- General", "",
  "Interior Equipment -- Receptacle", "",
  "Interior Equipment -- Process", "",
  "Exterior Equipment -- Not Subdivided", "",
  "Water Systems -- General", "",
  "Generators -- General", ""
];

// Row 3: Units
const CSV_HEADER_ROW_3 = [
  "", "", "", "[ft2]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[kWh]", "[W]",
  "[therm]", "[Btu/h]",
  "[therm]", "[Btu/h]",
  "[therm]", "[Btu/h]",
  "[therm]", "[Btu/h]",
  "[therm]", "[Btu/h]",
  "[therm]", "[Btu/h]"
];

// Canonical scenario order (ap first, then Baseline Avg, then ab1-ab4)
const CANONICAL_ORDER = {
  'ap': 1,
  'baseline avg': 2,
  'ab_avg': 2,
  'ab1': 3,
  'ab2': 4,
  'ab3': 5,
  'ab4': 6
};

/**
 * Returns O'Brien360 brand color matching scenario suffix (ap, baseline avg, ab1-ab4)
 * regardless of whether scenario is named 'ap' or 'Run_01_r33_ap'.
 */
function getScenarioColor(name, index = 0) {
  if (!name) return CHART_COLORS[index % CHART_COLORS.length];
  const lower = name.toLowerCase().trim();
  if (SCENARIO_COLORS[lower]) return SCENARIO_COLORS[lower];
  if (lower.endsWith('_ap') || lower === 'ap') return SCENARIO_COLORS.ap;
  if (lower.includes('baseline avg') || lower.endsWith('_baseline avg') || lower.endsWith('_ab_avg')) return SCENARIO_COLORS['baseline avg'];
  if (lower.endsWith('_ab1') || lower === 'ab1') return SCENARIO_COLORS.ab1;
  if (lower.endsWith('_ab2') || lower === 'ab2') return SCENARIO_COLORS.ab2;
  if (lower.endsWith('_ab3') || lower === 'ab3') return SCENARIO_COLORS.ab3;
  if (lower.endsWith('_ab4') || lower === 'ab4') return SCENARIO_COLORS.ab4;
  return CHART_COLORS[index % CHART_COLORS.length];
}

function getScenarioSortWeight(name) {
  if (!name) return 99;
  const lower = name.toLowerCase().trim();
  if (lower.endsWith('_ap') || lower === 'ap') return 1;
  if (lower.includes('baseline avg') || lower.endsWith('_baseline avg')) return 2;
  if (lower.endsWith('_ab1') || lower === 'ab1') return 3;
  if (lower.endsWith('_ab2') || lower === 'ab2') return 4;
  if (lower.endsWith('_ab3') || lower === 'ab3') return 5;
  if (lower.endsWith('_ab4') || lower === 'ab4') return 6;
  return 10;
}

function sortScenarios(scenarios) {
  return [...scenarios].sort((a, b) => {
    const runA = a.runId || '';
    const runB = b.runId || '';
    if (runA !== runB) {
      return runA.localeCompare(runB, undefined, { numeric: true });
    }
    const ordA = getScenarioSortWeight(a.scenarioName);
    const ordB = getScenarioSortWeight(b.scenarioName);
    if (ordA !== ordB) return ordA - ordB;
    return a.scenarioName.localeCompare(b.scenarioName);
  });
}

// =============================================================================
// Application State
// =============================================================================
const state = {
  activeIngestionMethod: 1,  // 1: Results CSV, 2: Model Folder, 3: Append

  rawScenarios: [],        // Original parsed scenarios from folder
  scenarios: [],           // All display scenarios (including Baseline Avg if enabled)
  baselineAvgScenario: null, // Computed Baseline Avg scenario
  selectedScenarios: [],   // Array of active scenario names
  activeScenario: null,    // Single scenario name when in single view
  baselineScenario: null,  // Baseline scenario name for variance calculations
  averageBaselines: true,  // Calculate and display average of ab1-ab4 (default true)
  selectedFolderName: '',  // Current project folder name
  buildingAreaType: 'conditioned',
  buildingArea: 0,

  // Mode 1 & 3: CSV and Append State
  loadedCsvRows: [],                  // Array of raw CSV rows (header 1, header 2, data rows)
  baseCsvFilename: '',                // Filename of loaded base CSV
  isAppendedData: false,              // True if currently displaying appended data
  method3BaseCsvRows: null,           // Base CSV rows for Method 3
  method3BaseCsvText: '',             // Base CSV raw text for Method 3
  method3BaseFilename: '',            // Base CSV filename for Method 3
  method3NewScenarios: [],            // Extracted HTM scenarios pending append
  method3ExtractedRunScenarios: [],   // Scenarios of new run available in checklist for appending

  viewMode: 'compare',     // 'compare' | 'stacked'
  energyUnit: 'kBtu',       // 'kBtu' | 'kWh' | 'therm' | 'eui'
  chartType: 'bar',        // 'bar' | 'stacked-bar' | 'doughnut' | 'horizontalBar' | 'radar'

  cleanLabels: true,       // Strip redundant suffixes
  hideZeroes: true,        // Hide zero rows (chart only)

  chartInstance: null,
  isServerOnline: false,
  csvExportDirHandle: null,   // FileSystemDirectoryHandle from showDirectoryPicker()
  method3BaseFileHandle: null,// FileSystemFileHandle for the output CSV in Method 3
  method3BaseCsvFileHandle: null, // FileSystemFileHandle for the loaded base CSV (used as startIn for save dialog)
};

// =============================================================================
// DOM Elements
// =============================================================================
const elements = {
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),
  serverStatus: document.getElementById('server-status'),

  // Ingestion Mode Tabs
  tabBtn1: document.getElementById('tab-btn-1'),
  tabBtn2: document.getElementById('tab-btn-2'),
  tabBtn3: document.getElementById('tab-btn-3'),
  tabPane1: document.getElementById('tab-pane-1'),
  tabPane2: document.getElementById('tab-pane-2'),
  tabPane3: document.getElementById('tab-pane-3'),

  // Mode 1: Results CSV
  dropZoneCsv: document.getElementById('drop-zone-csv'),
  browserCsvInput: document.getElementById('browser-csv-input'),
  browseCsvBtn: document.getElementById('browse-csv-btn'),
  loadSampleCsvBtn: document.getElementById('load-sample-csv-btn'),
  csvStatusBadge: document.getElementById('csv-status-badge'),

  // Mode 2: Model Folder
  dropZoneFolder: document.getElementById('drop-zone-folder'),
  browserFolderInput: document.getElementById('browser-folder-input'),
  browserFilesInput: document.getElementById('browser-files-input'),
  browseFolderBtn: document.getElementById('browse-folder-btn'),
  browseFilesBtn: document.getElementById('browse-files-btn'),
  loadSampleFolderBtn: document.getElementById('load-sample-folder-btn'),
  folderStatusBadge: document.getElementById('folder-status-badge'),
  unmappedWarning: document.getElementById('unmapped-warning'),
  scenarioAreas: document.getElementById('scenario-areas'),

  // Mode 3: Append
  appendCsvInput: document.getElementById('append-csv-input'),
  appendDropCsv: document.getElementById('append-drop-csv'),
  appendCsvStatus: document.getElementById('append-csv-status'),
  appendBrowseCsvBtn: document.getElementById('append-browse-csv-btn'),
  appendSampleCsvBtn: document.getElementById('append-sample-csv-btn'),
  appendFolderInput: document.getElementById('append-folder-input'),
  appendFilesInput: document.getElementById('append-files-input'),
  appendDropFolder: document.getElementById('append-drop-folder'),
  appendFolderStatus: document.getElementById('append-folder-status'),
  appendBrowseFolderBtn: document.getElementById('append-browse-folder-btn'),
  appendBrowseFilesBtn: document.getElementById('append-browse-files-btn'),
  appendSampleFolderBtn: document.getElementById('append-sample-folder-btn'),
  appendRunId: document.getElementById('append-run-id'),
  appendRevision: document.getElementById('append-revision'),
  executeLoadDashboardBtn: document.getElementById('execute-load-dashboard-btn') || document.getElementById('execute-append-btn'),
  executeAppendBtn: document.getElementById('execute-load-dashboard-btn') || document.getElementById('execute-append-btn'),
  appendStatusBadge: document.getElementById('append-status-badge'),

  scenariosContainer: document.getElementById('scenarios-container'),
  scenariosCountBadge: document.getElementById('scenarios-count-badge'),
  scenariosPillList: document.getElementById('scenarios-pill-list'),
  averageBaselinesToggle: document.getElementById('average-baselines-toggle'),
  selectAllScenariosBtn: document.getElementById('select-all-scenarios-btn'),
  deselectAllScenariosBtn: document.getElementById('deselect-all-scenarios-btn'),

  dashboardArea: document.getElementById('dashboard-area'),

  viewModeControl: document.getElementById('view-mode-control'),
  unitControl: document.getElementById('unit-control'),
  chartTypeSelect: document.getElementById('chart-type-select'),

  singleScenarioGroup: document.getElementById('single-scenario-group'),
  singleScenarioSelect: document.getElementById('single-scenario-select'),
  baselineScenarioGroup: document.getElementById('baseline-scenario-group'),
  baselineScenarioSelect: document.getElementById('baseline-scenario-select'),

  cleanLabelsToggle: document.getElementById('clean-labels-toggle'),
  hideZeroesToggle: document.getElementById('hide-zeroes-toggle'),

  metricTotalEnergy: document.getElementById('metric-total-energy'),
  metricTotalSubtitle: document.getElementById('metric-total-subtitle'),
  metricElecVal: document.getElementById('metric-elec-val'),
  metricElecPercent: document.getElementById('metric-elec-percent'),
  metricGasVal: document.getElementById('metric-gas-val'),
  metricGasPercent: document.getElementById('metric-gas-percent'),
  metricPeakCategory: document.getElementById('metric-peak-category'),
  metricPeakVal: document.getElementById('metric-peak-val'),

  chartMainTitle: document.getElementById('chart-main-title'),
  chartUnitBadge: document.getElementById('chart-unit-badge'),
  energyChartCanvas: document.getElementById('energy-chart'),
  downloadChartBtn: document.getElementById('download-chart-btn'),

  tableTitle: document.getElementById('table-title'),
  complianceDataTable: document.getElementById('compliance-data-table'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  tableFoot: document.getElementById('table-foot'),
  copyExcelBtn: document.getElementById('copy-excel-btn'),
  exportExcelBtn: document.getElementById('export-excel-btn'),

  // CSV Export panel (Method 2)
  csvExportSection: document.getElementById('csv-export-section'),
  csvExportFilename: document.getElementById('csv-export-filename'),
  csvExportLocation: document.getElementById('csv-export-location'),
  csvFilenamePreview: document.getElementById('csv-filename-preview'),
  csvRunId: document.getElementById('csv-run-id'),
  csvRevision: document.getElementById('csv-revision'),
  csvExportScope: document.getElementById('csv-export-scope'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  csvBrowseFolderBtn: document.getElementById('csv-browse-folder-btn'),
  csvLocationStatus: document.getElementById('csv-location-status'),

  // CSV Append panel (Method 3)
  csvAppendSection: document.getElementById('csv-append-section'),
  appendTargetCsvName: document.getElementById('append-target-csv-name'),
  appendScenarioChecklist: document.getElementById('append-scenario-checklist'),
  appendSelectAllBtn: document.getElementById('append-select-all-btn'),
  appendDeselectAllBtn: document.getElementById('append-deselect-all-btn'),
  appendExportFilename: document.getElementById('append-export-filename'),
  appendExportLocation: document.getElementById('append-export-location'),
  appendDownloadCsvBtn: document.getElementById('append-download-csv-btn'),

  toast: document.getElementById('toast'),
  toastTitle: document.getElementById('toast-title'),
  toastMessage: document.getElementById('toast-message'),
};

// =============================================================================
// Helper Functions: Parsing & Conversion
// =============================================================================

function parseNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const cleaned = String(str).replace(/,/g, '').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function formatNum(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatNumRaw(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return Number(val).toFixed(decimals);
}

function extractBuildingAreas(doc) {
  const areas = { totalBuildingArea: 0, netConditionedBuildingArea: 0 };
  doc.querySelectorAll('tr').forEach(row => {
    const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.textContent.trim());
    if (cells.length < 2) return;
    const label = cells[0].replace(/\s+/g, ' ').trim().toLowerCase();
    if (label === 'total building area') areas.totalBuildingArea = parseNumber(cells[1]);
    if (label === 'net conditioned building area') areas.netConditionedBuildingArea = parseNumber(cells[1]);
  });
  return areas;
}

/**
 * Client-side HTML parser for CBECC EAp2-4/5 Performance Rating Method Compliance tables.
 * Extracts: Electricity Energy Use [kWh], Electricity Demand [W],
 *           Natural Gas Energy Use [therm], Natural Gas Demand [Btu/h]
 */
function extractComplianceFromHTML(htmlString, sourceName = '') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const areas = extractBuildingAreas(doc);

  const tables = doc.querySelectorAll('table');
  let targetTable = null;

  for (const table of tables) {
    const text = table.textContent || '';
    if (text.includes('Electricity Energy Use') && text.includes('Natural Gas Energy Use')) {
      targetTable = table;
      break;
    }
  }

  if (!targetTable) return null;

  const rows = Array.from(targetTable.querySelectorAll('tr'));
  if (rows.length < 2) return null;

  const headerRow = rows[0];
  const headerCells = Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent.trim());

  // Locate column indices
  let elecEnergyIdx = -1;
  let elecDemandIdx = -1;
  let gasEnergyIdx  = -1;
  let gasDemandIdx  = -1;

  headerCells.forEach((cell, idx) => {
    const lower = cell.toLowerCase();
    if (lower.includes('electricity energy use') || (lower.includes('electricity') && lower.includes('[kwh]') && !lower.includes('demand'))) elecEnergyIdx = idx;
    if (lower.includes('electricity demand') || (lower.includes('electricity') && lower.includes('[w]'))) elecDemandIdx = idx;
    if (lower.includes('natural gas energy use') || (lower.includes('natural gas') && lower.includes('[therm]') && !lower.includes('demand'))) gasEnergyIdx = idx;
    if (lower.includes('natural gas demand') || (lower.includes('natural gas') && lower.includes('[btu/h]'))) gasDemandIdx = idx;
  });

  // Fallback column guesses
  if (elecEnergyIdx === -1) elecEnergyIdx = 1;
  if (elecDemandIdx === -1) elecDemandIdx = 2;
  if (gasEnergyIdx  === -1) gasEnergyIdx  = 3;
  if (gasDemandIdx  === -1) gasDemandIdx  = 4;

  // Build a lookup map: rawCategory -> data object
  // Build a lookup map: rawCategory -> data object from HTM table
  const rawCategoryMap = {};

  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.textContent.trim());
    if (cells.length === 0 || !cells[0]) continue;

    const catLabel = cells[0];
    const elecKwh    = parseNumber(cells[elecEnergyIdx]);
    const elecDemW   = parseNumber(cells[elecDemandIdx]);
    const gasTherm   = parseNumber(cells[gasEnergyIdx]);
    const gasDemBtuh = parseNumber(cells[gasDemandIdx]);
    const isTotal    = catLabel.toLowerCase().includes('total');

    const elecKbtu = elecKwh  * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu  = gasTherm * CONVERSIONS.THERM_TO_KBTU;

    rawCategoryMap[catLabel] = {
      rawCategory: catLabel,
      isTotal,
      elecKwh,
      elecDemW,
      gasTherm,
      gasDemBtuh,
      elecKbtu,
      gasKbtu,
      totalKbtu: elecKbtu + gasKbtu,
    };
  }

  // Build the aggregated 11 dashboard compliance categories
  const categoryMap = buildDashboardCategoryMap(rawCategoryMap);
  const mappedRawCategories = new Set(FIXED_CATEGORIES.flatMap(fc => [
    ...(fc.elecHtmCategories || []), ...(fc.gasHtmCategories || []), fc.raw
  ]));
  const unmappedCategories = Object.keys(rawCategoryMap).filter(cat => {
    const row = rawCategoryMap[cat];
    return !row.isTotal && !mappedRawCategories.has(cat) &&
      (Math.abs(row.elecKwh) > 0 || Math.abs(row.gasTherm) > 0);
  });

  // Calculate totals from dashboard categories
  let totalElecKwh = 0;
  let totalGasTherm = 0;
  Object.values(categoryMap).forEach(r => {
    if (!r.isTotal) {
      totalElecKwh  += r.elecKwh;
      totalGasTherm += r.gasTherm;
    }
  });

  const totalElecKbtu = totalElecKwh  * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu  = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
  const grandTotalKbtu = totalElecKbtu + totalGasKbtu;

  return {
    sourceName,
    ...areas,
    categoryMap,
    rawCategoryMap,
    unmappedCategories,
    summary: {
      totalElectricity_kWh:  totalElecKwh,
      totalNaturalGas_therm: totalGasTherm,
      totalElectricity_kBtu: totalElecKbtu,
      totalNaturalGas_kBtu:  totalGasKbtu,
      grandTotal_kBtu:       grandTotalKbtu,
      electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
      naturalGasSharePercent:  grandTotalKbtu > 0 ? (totalGasKbtu  / grandTotalKbtu) * 100 : 0,
    },
  };
}

/**
 * Return the energy value for a category row given current fuel/unit selection.
 * Used only by the chart (not the fixed table).
 */
function getCategoryEnergyValue(catData, unit = state.energyUnit) {
  if (!catData) return 0;
  if (unit === 'kWh') return catData.elecKwh;
  if (unit === 'therm') return catData.gasTherm;
  return catData.totalKbtu;
}

function getScenarioCategoryEnergyValue(sc, catData) {
  const value = getCategoryEnergyValue(catData, state.energyUnit === 'eui' ? 'kBtu' : state.energyUnit);
  if (state.energyUnit === 'eui') return sc.buildingArea > 0 ? value / sc.buildingArea : 0;
  return value;
}

function getScenarioEnergyValue(sc, unit = state.energyUnit) {
  const value = unit === 'kWh' ? sc.summary.totalElectricity_kBtu
    : unit === 'therm' ? sc.summary.totalNaturalGas_kBtu : sc.summary.grandTotal_kBtu;
  if (unit === 'eui') return sc.buildingArea > 0 ? value / sc.buildingArea : 0;
  if (unit === 'kWh') return value / CONVERSIONS.KWH_TO_KBTU;
  if (unit === 'therm') return value / CONVERSIONS.THERM_TO_KBTU;
  return value;
}

function getDisplayUnitLabel() {
  return state.energyUnit === 'eui' ? 'kBtu/ft2 (Total Combined)' : state.energyUnit;
}

// =============================================================================
// Tab Switching & Export Section Visibility
// =============================================================================

function updateExportSectionsVisibility() {
  const hasScenarios = state.scenarios && state.scenarios.length > 0;

  if (!hasScenarios) {
    if (elements.csvExportSection) elements.csvExportSection.classList.add('hidden');
    if (elements.csvAppendSection) elements.csvAppendSection.classList.add('hidden');
    return;
  }

  if (state.activeIngestionMethod === 1) {
    // Method 1: No Export CSV section shown
    if (elements.csvExportSection) elements.csvExportSection.classList.add('hidden');
    if (elements.csvAppendSection) elements.csvAppendSection.classList.add('hidden');
  } else if (state.activeIngestionMethod === 2) {
    // Method 2: Show Export to CSV Log with editable filename & location
    if (elements.csvExportSection) elements.csvExportSection.classList.remove('hidden');
    if (elements.csvAppendSection) elements.csvAppendSection.classList.add('hidden');
  } else if (state.activeIngestionMethod === 3) {
    // Method 3: Show Append Scenarios to CSV Log (checklist + append download)
    if (elements.csvExportSection) elements.csvExportSection.classList.add('hidden');
    if (elements.csvAppendSection) elements.csvAppendSection.classList.remove('hidden');
  }
}

function setupTabs() {
  const tabs = [
    { id: 1, btn: elements.tabBtn1, pane: elements.tabPane1 },
    { id: 2, btn: elements.tabBtn2, pane: elements.tabPane2 },
    { id: 3, btn: elements.tabBtn3, pane: elements.tabPane3 },
  ];

  tabs.forEach(t => {
    if (!t.btn || !t.pane) return;
    t.btn.addEventListener('click', () => {
      tabs.forEach(other => {
        if (other.btn) other.btn.classList.remove('active');
        if (other.pane) other.pane.classList.add('hidden');
      });
      t.btn.classList.add('active');
      t.pane.classList.remove('hidden');
      state.activeIngestionMethod = t.id;
      updateExportSectionsVisibility();
    });
  });
}

// =============================================================================
// CSV Parsing: Standard 68-Column Results.csv (with legacy 67-column compatibility)
// =============================================================================

function parseCsvToRows(text) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (nextCh === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\r') {
        if (nextCh === '\n') i++;
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter(r => r.some(cell => cell.length > 0));
}

function parseComplianceCSV(csvText, filename = '', formatCompositeName = false) {
  const rows = parseCsvToRows(csvText);
  if (rows.length < 3) {
    return { success: false, error: 'CSV file must have header rows and at least 1 data row.' };
  }

  // Detect 2 vs 3 header rows
  // In 3-header format: row 0 has dashboard categories, row 1 has 'Run ID', row 2 has units '[kWh]', data starts row 3
  // In 2-header format: row 0 has 'Run ID', row 1 has units '[kWh]', data starts row 2
  const isThreeHeader = rows.length > 3 && (
    (rows[1] && rows[1][0] && rows[1][0].trim().toLowerCase() === 'run id') ||
    (rows[0] && rows[0][3] && rows[0][3].trim().length > 0 && !rows[0][0])
  );
  const dataStartIdx = isThreeHeader ? 3 : 2;
  const hasSingleAreaColumn = isThreeHeader && /scenario/i.test(rows[1][2] || '') && /building area/i.test(rows[1][3] || '') && !/net conditioned|total building/i.test(rows[1][3] || '');
  const hasLegacyAreaColumns = isThreeHeader && /scenario/i.test(rows[1][2] || '') && /total building area/i.test(rows[1][3] || '');
  const scenarioColumn = 2;
  const energyColumnStart = hasSingleAreaColumn ? 4 : hasLegacyAreaColumns ? 5 : 3;

  const scenarios = [];

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= scenarioColumn || !row[scenarioColumn]) continue;

    const runId = (row[0] || 'Run_01').trim();
    const rev = (row[1] || 'Rev.0').trim();
    const rawScenario = row[scenarioColumn].trim();
    const totalBuildingArea = hasSingleAreaColumn ? parseNumber(row[3]) : hasLegacyAreaColumns ? parseNumber(row[3]) : 0;
    const netConditionedBuildingArea = hasSingleAreaColumn ? 0 : hasLegacyAreaColumns ? parseNumber(row[4]) : 0;
    const scenarioName = formatCompositeName
      ? `${runId}_${rev}_${rawScenario}`
      : rawScenario;

    const rawCategoryMap = {};

    CSV_ELECS.forEach((catRaw, idx) => {
      const kwhCol = energyColumnStart + (idx * 2);
      const wCol   = energyColumnStart + 1 + (idx * 2);
      const kwh = kwhCol < row.length ? parseNumber(row[kwhCol]) : 0;
      const w   = wCol < row.length ? parseNumber(row[wCol]) : 0;
      rawCategoryMap[catRaw] = {
        rawCategory: catRaw,
        isTotal: false,
        elecKwh: kwh,
        elecDemW: w,
        gasTherm: 0,
        gasDemBtuh: 0,
        elecKbtu: kwh * CONVERSIONS.KWH_TO_KBTU,
        gasKbtu: 0,
        totalKbtu: kwh * CONVERSIONS.KWH_TO_KBTU
      };
    });

    CSV_GASES.forEach((catRaw, idx) => {
      const thermCol = energyColumnStart + 52 + (idx * 2);
      const btuhCol  = energyColumnStart + 53 + (idx * 2);
      const therm = thermCol < row.length ? parseNumber(row[thermCol]) : 0;
      const btuh  = btuhCol < row.length ? parseNumber(row[btuhCol]) : 0;
      if (!rawCategoryMap[catRaw]) {
        rawCategoryMap[catRaw] = {
          rawCategory: catRaw,
          isTotal: false,
          elecKwh: 0,
          elecDemW: 0,
          gasTherm: 0,
          gasDemBtuh: 0,
          elecKbtu: 0,
          gasKbtu: 0,
          totalKbtu: 0
        };
      }
      rawCategoryMap[catRaw].gasTherm = therm;
      rawCategoryMap[catRaw].gasDemBtuh = btuh;
      rawCategoryMap[catRaw].gasKbtu = therm * CONVERSIONS.THERM_TO_KBTU;
      rawCategoryMap[catRaw].totalKbtu = (rawCategoryMap[catRaw].elecKbtu || 0) + rawCategoryMap[catRaw].gasKbtu;
    });

    // Build the aggregated 11 dashboard categories from rawCategoryMap
    const categoryMap = buildDashboardCategoryMap(rawCategoryMap);

    let totalElecKwh = 0;
    let totalGasTherm = 0;
    Object.values(categoryMap).forEach(c => {
      totalElecKwh += c.elecKwh;
      totalGasTherm += c.gasTherm;
    });

    const totalElecKbtu = totalElecKwh * CONVERSIONS.KWH_TO_KBTU;
    const totalGasKbtu  = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
    const grandTotalKbtu = totalElecKbtu + totalGasKbtu;

    const isAvg = rawScenario.toLowerCase().includes('baseline avg') || scenarioName.toLowerCase().includes('baseline avg');

    const scObj = {
      scenarioName,
      rawScenarioName: rawScenario,
      sourceName: `${scenarioName} (${runId})`,
      runId,
      revision: rev,
      isCalculatedAverage: isAvg,
      fileBaseName: `${scenarioName}.csv`,
      totalBuildingArea,
      netConditionedBuildingArea,
      buildingArea: totalBuildingArea,
      categoryMap,
      rawCategoryMap,
      summary: {
        totalElectricity_kWh: totalElecKwh,
        totalNaturalGas_therm: totalGasTherm,
        totalElectricity_kBtu: totalElecKbtu,
        totalNaturalGas_kBtu: totalGasKbtu,
        grandTotal_kBtu: grandTotalKbtu,
        electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
        naturalGasSharePercent: grandTotalKbtu > 0 ? (totalGasKbtu / grandTotalKbtu) * 100 : 0,
      }
    };
    scenarios.push(scObj);
  }

  return { success: true, scenarios, rows };
}

// =============================================================================
// Helper: Format a Scenario as a 68-Column CSV Row
// =============================================================================

function formatScenarioCsvRow(sc, runId, revision, rawScenarioName = '') {
  const cmap = sc.rawCategoryMap || sc.categoryMap || {};
  const scName = rawScenarioName || sc.rawScenarioName || sc.scenarioName;
  const row = [runId, revision, scName, formatNumRaw(sc.buildingArea, 2)];

  // 26 electricity columns (kWh + W per category)
  CSV_ELECS.forEach(catRaw => {
    const r = cmap[catRaw];
    row.push(r ? formatNumRaw(r.elecKwh, 2) : '0.00');
    row.push(r ? formatNumRaw(r.elecDemW, 2) : '0.00');
  });

  // 6 natural gas columns (therm + Btu/h per category)
  CSV_GASES.forEach(catRaw => {
    const r = cmap[catRaw];
    row.push(r ? formatNumRaw(r.gasTherm, 2) : '0.00');
    row.push(r ? formatNumRaw(r.gasDemBtuh, 2) : '0.00');
  });

  return row;
}

// =============================================================================
// Method 1: Load Results CSV
// =============================================================================

async function handleCsvFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    loadCsvContent(text, file.name);
  } catch (err) {
    showToast('Error', 'Failed to read CSV file: ' + err.message, '❌');
  }
}

function loadCsvContent(text, filename) {
  state.activeIngestionMethod = 1;
  const result = parseComplianceCSV(text, filename, true); // formatCompositeName = true for Method 1
  if (!result.success || result.scenarios.length === 0) {
    showToast('CSV Parsing Failed', result.error || 'Could not parse scenarios from CSV.', '⚠️');
    return;
  }

  state.loadedCsvRows = result.rows;
  state.baseCsvFilename = filename;
  state.isAppendedData = false;
  state.selectedFolderName = filename.replace(/\s*-\s*Results\.csv$/i, '').replace(/\.csv$/i, '');
  updateCsvFilenamePreview();

  // Populate Run ID & Rev in CSV export panel from first row
  if (result.scenarios[0].runId && elements.csvRunId) {
    elements.csvRunId.value = result.scenarios[0].runId;
  }
  if (result.scenarios[0].revision && elements.csvRevision) {
    elements.csvRevision.value = result.scenarios[0].revision;
  }

  loadParsedScenarios(result.scenarios);

  if (elements.csvStatusBadge) {
    elements.csvStatusBadge.className = 'source-status-info';
    elements.csvStatusBadge.innerHTML = `<span>✅ <strong>${filename}</strong>: Loaded ${result.scenarios.length} scenarios (${result.scenarios.map(s => s.scenarioName).join(', ')}).</span>`;
    elements.csvStatusBadge.classList.remove('hidden');
  }

  updateExportSectionsVisibility();
  showToast('CSV Loaded', `Loaded ${result.scenarios.length} scenarios from ${filename}!`, '✅');
}

async function loadSampleCsv() {
  showToast('Loading Sample CSV...', 'Fetching 2394-LEED MDL- Results.csv...', '⏳');
  try {
    const res = await fetch('2394-LEED MDL- Results.csv');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    loadCsvContent(text, '2394-LEED MDL- Results.csv');
  } catch (err) {
    showToast('Notice', 'Could not load sample CSV: ' + err.message, '⚠️');
  }
}

// =============================================================================
// Method 2: Extract from Model Folder (HTM Files)
// =============================================================================

async function handleFileList(files) {
  const htmFiles = Array.from(files).filter(f => f.name.endsWith('.htm') || f.name.endsWith('.html'));
  if (htmFiles.length === 0) {
    showToast('No HTM Files', 'Please select a folder or files with .htm/.html extensions', '⚠️');
    return;
  }

  state.activeIngestionMethod = 2;

  // Derive folder name and parent folder hint
  let parentFolderName = '..\\';
  if (files.length > 0 && files[0].webkitRelativePath) {
    const parts = files[0].webkitRelativePath.split('/');
    state.selectedFolderName = parts[0];
  } else if (files.length > 0) {
    state.selectedFolderName = files[0].name.replace(/\.(htm|html)$/i, '');
  }

  updateCsvFilenamePreview();

  // Set default export filename and location for Method 2
  if (elements.csvExportFilename) {
    elements.csvExportFilename.value = getCleanCsvFilename(state.selectedFolderName);
  }
  if (elements.csvExportLocation) {
    elements.csvExportLocation.value = parentFolderName;
  }
  state.csvExportDirHandle = null;

  showToast('Parsing Files...', `Reading ${htmFiles.length} files in browser...`, '⏳');
  const parsedResults = [];

  for (const file of htmFiles) {
    try {
      const text = await file.text();
      let scenarioName = file.name.replace(/\.(htm|html)$/i, '');
      if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length > 2) {
          scenarioName = parts[parts.length - 2];
        }
      }

      // Filter out zb and zp scenarios
      const scLower = scenarioName.toLowerCase();
      if (scLower.startsWith('zb') || scLower.startsWith('zp') ||
          scLower.includes('- zb') || scLower.includes('- zp')) {
        continue;
      }

      const parsed = extractComplianceFromHTML(text, scenarioName);
      if (parsed) {
        parsed.fileBaseName   = file.name;
        parsed.scenarioName   = scenarioName;
        parsed.rawScenarioName = scenarioName;
        parsedResults.push(parsed);
      }
    } catch (e) {
      console.error('Error parsing file:', file.name, e);
    }
  }

  if (parsedResults.length > 0) {
    state.isAppendedData = false;
    loadParsedScenarios(parsedResults);
    if (elements.folderStatusBadge) {
      elements.folderStatusBadge.className = 'source-status-info';
      elements.folderStatusBadge.innerHTML = `<span>✅ Extracted ${parsedResults.length} scenarios (${parsedResults.map(s => s.scenarioName).join(', ')}) from HTM files.</span>`;
      elements.folderStatusBadge.classList.remove('hidden');
    }
    updateExportSectionsVisibility();
    showToast('Success', `Successfully parsed ${parsedResults.length} scenarios!`, '✅');
  } else {
    showToast('Extraction Failed', 'No EAp2-4/5 compliance tables found in selected files', '⚠️');
  }
}

async function loadExampleDataInBrowser() {
  showToast('Loading Demo...', 'Fetching sample CBECC simulation files...', '⏳');
  const demoFiles = [
    { scenario: 'ap',  path: 'example_project_folder/ap/1574_GLBH_S901G_CBECC2025 - ap.htm',   name: '1574_GLBH_S901G_CBECC2025 - ap.htm' },
    { scenario: 'ab1', path: 'example_project_folder/ab1/1574_GLBH_S901G_CBECC2025 - ab1.htm', name: '1574_GLBH_S901G_CBECC2025 - ab1.htm' },
    { scenario: 'ab2', path: 'example_project_folder/ab2/1574_GLBH_S901G_CBECC2025 - ab2.htm', name: '1574_GLBH_S901G_CBECC2025 - ab2.htm' },
    { scenario: 'ab3', path: 'example_project_folder/ab3/1574_GLBH_S901G_CBECC2025 - ab3.htm', name: '1574_GLBH_S901G_CBECC2025 - ab3.htm' },
    { scenario: 'ab4', path: 'example_project_folder/ab4/1574_GLBH_S901G_CBECC2025 - ab4.htm', name: '1574_GLBH_S901G_CBECC2025 - ab4.htm' },
  ];

  try {
    const parsedResults = [];
    for (const item of demoFiles) {
      const res = await fetch(item.path);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${item.path}`);
      const text = await res.text();
      const parsed = extractComplianceFromHTML(text, item.scenario);
      if (parsed) {
        parsed.fileBaseName = item.name;
        parsed.scenarioName = item.scenario;
        parsed.rawScenarioName = item.scenario;
        parsedResults.push(parsed);
      }
    }

    if (parsedResults.length > 0) {
      state.activeIngestionMethod = 2;
      state.isAppendedData = false;
      state.selectedFolderName = '1574_GLBH_S901G_CBECC2025';
      updateCsvFilenamePreview();

      if (elements.csvExportFilename) {
        elements.csvExportFilename.value = getCleanCsvFilename('1574_GLBH_S901G_CBECC2025');
      }
      if (elements.csvExportLocation) {
        elements.csvExportLocation.value = '..\\';
      }

      loadParsedScenarios(parsedResults);
      if (elements.folderStatusBadge) {
        elements.folderStatusBadge.className = 'source-status-info';
        elements.folderStatusBadge.innerHTML = `<span>✅ Loaded 5 sample scenarios (ap, ab1–ab4) from example folder.</span>`;
        elements.folderStatusBadge.classList.remove('hidden');
      }
      updateExportSectionsVisibility();
      showToast('Demo Loaded', 'Loaded 5 example scenarios (ap, ab1–ab4)', '✅');
    }
  } catch (err) {
    console.warn('Could not auto-fetch example files:', err);
    showToast('Browser Mode', 'Drag & drop or select your CBECC output files or folder to begin', 'ℹ️');
  }
}

// =============================================================================
// Method 3: Append Model Run to CSV
// =============================================================================

async function handleAppendBaseCsv(file) {
  if (!file) return;
  try {
    const text = await file.text();
    setMethod3BaseCsv(text, file.name);
  } catch (err) {
    showToast('Error', 'Failed to read Base CSV: ' + err.message, '❌');
  }
}

function setMethod3BaseCsv(text, filename) {
  const result = parseComplianceCSV(text, filename, true);
  if (!result.success || result.scenarios.length === 0) {
    showToast('CSV Error', result.error || 'Invalid CSV format.', '⚠️');
    return;
  }
  state.method3BaseCsvText = text;
  state.method3BaseCsvRows = result.rows;
  state.method3BaseFilename = filename;

  if (elements.appendDropCsv) elements.appendDropCsv.classList.add('has-file');
  if (elements.appendCsvStatus) {
    elements.appendCsvStatus.innerHTML = `<strong>${filename}</strong> (${result.scenarios.length} scenarios)`;
  }

  // Suggest next Run ID if possible (e.g. Run_01 -> Run_02)
  const lastRunId = result.scenarios[result.scenarios.length - 1].runId || 'Run_01';
  const match = lastRunId.match(/(\d+)$/);
  if (match && elements.appendRunId) {
    const nextNum = String(parseInt(match[1], 10) + 1).padStart(match[1].length, '0');
    elements.appendRunId.value = lastRunId.replace(/\d+$/, nextNum);
  }

  checkMethod3Ready();
  showToast('Base CSV Ready', `Loaded base CSV: ${filename}`, '📄');
}

async function loadAppendSampleCsv() {
  try {
    const res = await fetch('2394-LEED MDL- Results.csv');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    setMethod3BaseCsv(text, '2394-LEED MDL- Results.csv');
  } catch (err) {
    showToast('Notice', 'Could not load sample CSV: ' + err.message, '⚠️');
  }
}

async function handleAppendModelFolder(files) {
  const htmFiles = Array.from(files).filter(f => f.name.endsWith('.htm') || f.name.endsWith('.html'));
  if (htmFiles.length === 0) {
    showToast('No HTM Files', 'Please select a folder containing .htm/.html files.', '⚠️');
    return;
  }

  showToast('Extracting HTM...', `Reading ${htmFiles.length} files...`, '⏳');
  const parsedResults = [];

  for (const file of htmFiles) {
    try {
      const text = await file.text();
      let scenarioName = file.name.replace(/\.(htm|html)$/i, '');
      if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length > 2) scenarioName = parts[parts.length - 2];
      }
      const scLower = scenarioName.toLowerCase();
      if (scLower.startsWith('zb') || scLower.startsWith('zp') || scLower.includes('- zb') || scLower.includes('- zp')) continue;

      const parsed = extractComplianceFromHTML(text, scenarioName);
      if (parsed) {
        parsed.fileBaseName = file.name;
        parsed.scenarioName = scenarioName;
        parsed.rawScenarioName = scenarioName;
        parsedResults.push(parsed);
      }
    } catch (e) {
      console.error('Error parsing file:', file.name, e);
    }
  }

  if (parsedResults.length > 0) {
    state.method3NewScenarios = parsedResults;
    if (elements.appendDropFolder) elements.appendDropFolder.classList.add('has-file');
    if (elements.appendFolderStatus) {
      elements.appendFolderStatus.innerHTML = `<strong>${parsedResults.length} HTM Scenarios</strong> (${parsedResults.map(s => s.scenarioName).join(', ')})`;
    }
    checkMethod3Ready();
    showToast('Model Folder Ready', `Extracted ${parsedResults.length} scenarios from HTM files!`, '📁');
  } else {
    showToast('Extraction Failed', 'No EAp2-4/5 compliance tables found in files.', '⚠️');
  }
}

async function loadAppendSampleFolder() {
  showToast('Loading Demo Folder...', 'Fetching sample CBECC simulation files...', '⏳');
  const demoFiles = [
    { scenario: 'ap',  path: 'example_project_folder/ap/1574_GLBH_S901G_CBECC2025 - ap.htm',   name: '1574_GLBH_S901G_CBECC2025 - ap.htm' },
    { scenario: 'ab1', path: 'example_project_folder/ab1/1574_GLBH_S901G_CBECC2025 - ab1.htm', name: '1574_GLBH_S901G_CBECC2025 - ab1.htm' },
    { scenario: 'ab2', path: 'example_project_folder/ab2/1574_GLBH_S901G_CBECC2025 - ab2.htm', name: '1574_GLBH_S901G_CBECC2025 - ab2.htm' },
    { scenario: 'ab3', path: 'example_project_folder/ab3/1574_GLBH_S901G_CBECC2025 - ab3.htm', name: '1574_GLBH_S901G_CBECC2025 - ab3.htm' },
    { scenario: 'ab4', path: 'example_project_folder/ab4/1574_GLBH_S901G_CBECC2025 - ab4.htm', name: '1574_GLBH_S901G_CBECC2025 - ab4.htm' },
  ];

  try {
    const parsedResults = [];
    for (const item of demoFiles) {
      const res = await fetch(item.path);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${item.path}`);
      const text = await res.text();
      const parsed = extractComplianceFromHTML(text, item.scenario);
      if (parsed) {
        parsed.fileBaseName = item.name;
        parsed.scenarioName = item.scenario;
        parsed.rawScenarioName = item.scenario;
        parsedResults.push(parsed);
      }
    }
    if (parsedResults.length > 0) {
      state.method3NewScenarios = parsedResults;
      if (elements.appendDropFolder) elements.appendDropFolder.classList.add('has-file');
      if (elements.appendFolderStatus) {
        elements.appendFolderStatus.innerHTML = `<strong>5 Sample Scenarios</strong> (ap, ab1–ab4)`;
      }
      checkMethod3Ready();
      showToast('Sample Folder Ready', 'Loaded 5 sample scenarios for appending!', '📁');
    }
  } catch (err) {
    showToast('Error', 'Could not load sample folder: ' + err.message, '⚠️');
  }
}

function checkMethod3Ready() {
  const ready = Boolean(state.method3BaseCsvRows && state.method3BaseCsvRows.length >= 3 &&
                state.method3NewScenarios && state.method3NewScenarios.length > 0);
  if (elements.executeLoadDashboardBtn) {
    elements.executeLoadDashboardBtn.disabled = !ready;
  }
  if (elements.executeAppendBtn) {
    elements.executeAppendBtn.disabled = !ready;
  }
}

/**
 * Method 3: Load Dashboard (does not append immediately)
 * Computes baseline average for new run, tags scenarios as runID_rev_scenario,
 * loads into dashboard, and populates checklist to let user choose scenarios to append.
 */
function executeLoadDashboard() {
  if (!state.method3BaseCsvRows || state.method3NewScenarios.length === 0) {
    showToast('Missing Inputs', 'Please select both a base CSV and a model run folder first.', '⚠️');
    return;
  }

  const runId = (elements.appendRunId ? elements.appendRunId.value.trim() : '') || 'Run_02';
  const revision = (elements.appendRevision ? elements.appendRevision.value.trim() : '') || 'r34';

  // 1. Prepare Base CSV scenarios (with composite names)
  const baseResult = parseComplianceCSV(state.method3BaseCsvText, state.method3BaseFilename, true);
  const baseScenarios = baseResult.success ? baseResult.scenarios : [];

  // 2. Prepare New Run scenarios from HTM files
  const order = { 'ap': 1, 'ab1': 2, 'ab2': 3, 'ab3': 4, 'ab4': 5 };
  const sortedNew = [...state.method3NewScenarios].sort((a, b) => {
    const ordA = order[a.scenarioName.toLowerCase()] || 99;
    const ordB = order[b.scenarioName.toLowerCase()] || 99;
    return ordA - ordB;
  });

  const newRunScenarios = sortedNew.map(sc => {
    const rawName = sc.rawScenarioName || sc.scenarioName;
    return {
      ...sc,
      rawScenarioName: rawName,
      runId: runId,
      revision: revision,
      scenarioName: `${runId}_${revision}_${rawName}`,
      sourceName: `${runId}_${revision}_${rawName} (${runId})`,
      fileBaseName: `${runId}_${revision}_${rawName}.htm`,
    };
  });

  // Calculate baseline average for new run
  const newRunBaselines = newRunScenarios.filter(s => /(?:^|_)ab\d+$/i.test(s.rawScenarioName || s.scenarioName));
  if (newRunBaselines.length > 0) {
    const newRunAvg = computeBaselineAverageForGroup(newRunBaselines, runId, revision);
    if (newRunAvg) {
      newRunScenarios.push(newRunAvg);
    }
  }

  // Combine both sets
  const allScenarios = [...baseScenarios, ...newRunScenarios];
  state.isAppendedData = true;
  state.activeIngestionMethod = 3;

  // Load into dashboard
  loadParsedScenarios(allScenarios);

  // Store the new run scenarios available for appending
  state.method3ExtractedRunScenarios = newRunScenarios;

  // Populate Append Checklist in Section
  renderAppendChecklist(newRunScenarios, runId, revision);

  // Set default export filename & location in append panel
  if (elements.appendExportFilename) {
    const baseClean = (state.method3BaseFilename || 'Results').replace(/\.csv$/i, '');
    elements.appendExportFilename.value = `${baseClean}_${runId}.csv`;
  }
  if (elements.appendExportLocation) {
    elements.appendExportLocation.value = '..\\';
  }
  if (elements.appendTargetCsvName) {
    elements.appendTargetCsvName.textContent = state.method3BaseFilename || 'Results.csv';
  }

  updateExportSectionsVisibility();

  if (elements.appendStatusBadge) {
    elements.appendStatusBadge.className = 'source-status-info';
    elements.appendStatusBadge.innerHTML = `<span>✅ <strong>Dashboard Loaded:</strong> Displaying ${allScenarios.length} scenarios across base run and new run <code>${runId}</code> (${revision}). Select which scenarios to append below.</span>`;
    elements.appendStatusBadge.classList.remove('hidden');
  }

  showToast('Dashboard Loaded', `Loaded base run and new run ${runId} (${revision}) with Baseline Avg!`, '✅');
}

function renderAppendChecklist(scenarios, runId, revision) {
  if (!elements.appendScenarioChecklist) return;
  elements.appendScenarioChecklist.innerHTML = '';

  scenarios.forEach((sc, idx) => {
    const raw = sc.rawScenarioName || sc.scenarioName;
    const isAvg = sc.isCalculatedAverage || raw.toLowerCase().includes('baseline avg');
    const labelText = isAvg ? `${sc.scenarioName} (Calculated Baseline Average)` :
                      raw === 'ap' ? `${sc.scenarioName} (Proposed Design)` :
                      `${sc.scenarioName} (${raw.toUpperCase()})`;

    const itemDiv = document.createElement('div');
    itemDiv.className = 'append-check-item';
    itemDiv.innerHTML = `
      <label class="custom-checkbox">
        <input type="checkbox" class="append-scenario-cb" data-index="${idx}" value="${sc.scenarioName}" checked />
        <span class="checkmark"></span>
        <span class="append-item-label">${labelText}</span>
      </label>
    `;
    elements.appendScenarioChecklist.appendChild(itemDiv);
  });
}

async function downloadAppendedCsv() {
  if (!state.method3BaseCsvRows || !state.method3ExtractedRunScenarios) {
    showToast('No Data', 'Please load dashboard with base CSV and new run first.', '⚠️');
    return;
  }

  const checkboxes = elements.appendScenarioChecklist.querySelectorAll('.append-scenario-cb:checked');
  if (checkboxes.length === 0) {
    showToast('Selection Empty', 'Please select at least one scenario to append.', '⚠️');
    return;
  }

  const selectedNames = Array.from(checkboxes).map(cb => cb.value);
  const scenariosToAppend = state.method3ExtractedRunScenarios.filter(sc => selectedNames.includes(sc.scenarioName));

  // Clone base CSV rows and append selected scenarios
  const combinedRows = state.method3BaseCsvRows.map(r => [...r]);
  scenariosToAppend.forEach(sc => {
    const rawName = sc.rawScenarioName || sc.scenarioName;
    const newRow = formatScenarioCsvRow(sc, sc.runId, sc.revision, rawName);
    combinedRows.push(newRow);
  });

  const csvContent = combinedRows.map(row =>
    row.map(cell => {
      const s = String(cell);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  ).join('\r\n');

  const filename = state.method3BaseFilename || 'Results.csv';

  // --- Path 1: Direct overwrite via pre-captured file handle (future use) ---
  if (state.method3BaseFileHandle) {
    try {
      const writable = await state.method3BaseFileHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      state.method3BaseCsvRows = combinedRows;
      showToast('CSV Overwritten', `Directly overwrote "${filename}" with ${scenariosToAppend.length} appended scenario(s).`, '💾');
    } catch (err) {
      showToast('Write Failed', `Could not overwrite file: ${err.message}`, '⚠️');
    }
    return;
  }

  // --- Path 2: showSaveFilePicker — lets user navigate to original file and overwrite it ---
  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
        // Default the dialog to the folder where the base CSV was loaded from
        ...(state.method3BaseCsvFileHandle ? { startIn: state.method3BaseCsvFileHandle } : {}),
      });
      const writable = await fileHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      // Cache handle for future saves in this session
      state.method3BaseFileHandle = fileHandle;
      state.method3BaseCsvRows = combinedRows;
      showToast('CSV Overwritten', `Saved "${fileHandle.name}" with ${scenariosToAppend.length} appended scenario(s).`, '💾');
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('Save Failed', `Could not save file: ${err.message}`, '⚠️');
      }
    }
    return;
  }

  // --- Path 3: Fallback — standard browser download (creates new file in Downloads) ---
  state.method3BaseCsvRows = combinedRows;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSV Downloaded', `Saved "${filename}" (${scenariosToAppend.length} scenario(s) appended). Check your Downloads folder.`, '💾');
}

// =============================================================================
// Helper: Folder Name & File Naming
// =============================================================================

/**
 * Derives CSV filename from selected folder name:
 * Ignores trailing " - run" or " - batch" (case-insensitive) and appends " - Results.csv".
 */
function getCleanCsvFilename(folderName) {
  let name = (folderName || '').trim();
  if (!name) name = 'Energy_Compliance';
  // Strip trailing slashes and backslashes
  name = name.replace(/[/\\]+$/, '');
  // Extract folder basename from path if full path is provided
  const base = name.split(/[/\\]/).filter(Boolean).pop() || name;
  // Ignore ending if it ends with " - run" or " - batch" (case-insensitive)
  const stripped = base.replace(/\s*-\s*(run|batch)$/i, '').trim();
  const finalBase = stripped || base;
  return `${finalBase} - Results.csv`;
}

function updateCsvFilenamePreview() {
  if (!elements.csvFilenamePreview) return;
  const rawFolder = state.selectedFolderName || (elements.folderPathInput ? elements.folderPathInput.value.trim() : '') || 'example_project_folder';
  elements.csvFilenamePreview.textContent = getCleanCsvFilename(rawFolder);
}

// =============================================================================
// Helper: Baseline Averaging Calculation
// =============================================================================

/**
 * Calculates the average of baseline scenarios (ab1, ab2, ab3, ab4) for a given run.
 * Creates a synthetic scenario object with identical structure to parsed scenarios.
 */
function computeBaselineAverageForGroup(baselines, runId = '', revision = '') {
  if (!baselines || baselines.length === 0) return null;

  const count = baselines.length;

  // 1. Average rawCategoryMap (HTM categories)
  const rawCategoryMap = {};
  const allRawKeys = new Set([...CSV_ELECS, ...CSV_GASES]);
  baselines.forEach(b => {
    Object.keys(b.rawCategoryMap || {}).forEach(k => allRawKeys.add(k));
  });

  allRawKeys.forEach(raw => {
    let sumElecKwh    = 0;
    let sumElecDemW   = 0;
    let sumGasTherm   = 0;
    let sumGasDemBtuh = 0;

    baselines.forEach(b => {
      const r = (b.rawCategoryMap && b.rawCategoryMap[raw]) || (b.categoryMap && b.categoryMap[raw]);
      if (r) {
        sumElecKwh    += (r.elecKwh || 0);
        sumElecDemW   += (r.elecDemW || 0);
        sumGasTherm   += (r.gasTherm || 0);
        sumGasDemBtuh += (r.gasDemBtuh || 0);
      }
    });

    const avgElecKwh    = sumElecKwh / count;
    const avgElecDemW   = sumElecDemW / count;
    const avgGasTherm   = sumGasTherm / count;
    const avgGasDemBtuh = sumGasDemBtuh / count;

    const elecKbtu  = avgElecKwh * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu   = avgGasTherm * CONVERSIONS.THERM_TO_KBTU;
    const totalKbtu = elecKbtu + gasKbtu;

    rawCategoryMap[raw] = {
      rawCategory: raw,
      isTotal: false,
      elecKwh:    avgElecKwh,
      elecDemW:   avgElecDemW,
      gasTherm:   avgGasTherm,
      gasDemBtuh: avgGasDemBtuh,
      elecKbtu,
      gasKbtu,
      totalKbtu,
    };
  });

  // 2. Build the aggregated 11 dashboard compliance categories
  const categoryMap = buildDashboardCategoryMap(rawCategoryMap);

  let totalElecKwh = 0;
  let totalGasTherm = 0;
  Object.values(categoryMap).forEach(c => {
    totalElecKwh  += c.elecKwh;
    totalGasTherm += c.gasTherm;
  });

  const totalElecKbtu  = totalElecKwh  * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu   = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
  const grandTotalKbtu = totalElecKbtu + totalGasKbtu;

  const compositeName = (runId && revision)
    ? `${runId}_${revision}_Baseline Avg`
    : (runId ? `${runId}_Baseline Avg` : 'Baseline Avg');

  return {
    scenarioName: compositeName,
    rawScenarioName: 'Baseline Avg',
    runId,
    revision,
    isCalculatedAverage: true,
    fileBaseName: `${compositeName}.csv`,
    totalBuildingArea: baselines.reduce((sum, sc) => sum + (sc.totalBuildingArea || 0), 0) / count,
    netConditionedBuildingArea: baselines.reduce((sum, sc) => sum + (sc.netConditionedBuildingArea || 0), 0) / count,
    categoryMap,
    rawCategoryMap,
    summary: {
      totalElectricity_kWh:  totalElecKwh,
      totalNaturalGas_therm: totalGasTherm,
      totalElectricity_kBtu: totalElecKbtu,
      totalNaturalGas_kBtu:  totalGasKbtu,
      grandTotal_kBtu:       grandTotalKbtu,
      electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
      naturalGasSharePercent:  grandTotalKbtu > 0 ? (totalGasKbtu  / grandTotalKbtu) * 100 : 0,
    }
  };
}

function renderScenarioAreas() {
  if (!elements.scenarioAreas) return;
  elements.scenarioAreas.innerHTML = `
    <div class="scenario-area-field"><label for="building-area-type">Area Basis</label><select id="building-area-type" class="select-dropdown"><option value="total" ${state.buildingAreaType === 'total' ? 'selected' : ''}>Total Building Area</option><option value="conditioned" ${state.buildingAreaType === 'conditioned' ? 'selected' : ''}>Net Conditioned Building Area</option></select></div>
    <div class="scenario-area-field"><label for="building-area-value">Building Area (ft2)</label><input id="building-area-value" type="number" min="0" step="0.01" data-area="buildingArea" value="${state.buildingArea || ''}"></div>`;
  elements.scenarioAreas.querySelectorAll('input[data-area]').forEach(input => {
    input.addEventListener('input', event => {
      const property = event.target.dataset.area;
      state[property] = parseNumber(event.target.value);
      state.scenarios.forEach(sc => { sc[property] = state[property]; });
      updateDashboard();
    });
  });
  const typeSelect = document.getElementById('building-area-type');
  typeSelect.addEventListener('change', event => {
    state.buildingAreaType = event.target.value;
    state.buildingArea = state.scenarios[0]
      ? (state.buildingAreaType === 'conditioned' ? state.scenarios[0].netConditionedBuildingArea : state.scenarios[0].totalBuildingArea)
      : 0;
    state.scenarios.forEach(sc => { sc.buildingArea = state.buildingArea; });
    renderScenarioAreas();
    updateDashboard();
  });
}

function renderUnmappedWarning() {
  if (!elements.unmappedWarning) return;
  const categories = [...new Set(state.scenarios.flatMap(sc => sc.unmappedCategories || []))];
  if (categories.length === 0) {
    elements.unmappedWarning.classList.add('hidden');
    return;
  }
  elements.unmappedWarning.textContent = `WARNING: The extracted table contains unmapped end-use categories. Review the mapping before relying on totals: ${categories.join(', ')}`;
  elements.unmappedWarning.classList.remove('hidden');
}


function loadParsedScenarios(scenarios) {
  // Filter out zb/zp
  const filtered = scenarios.filter(s => {
    const scLower = s.scenarioName.toLowerCase();
    return !scLower.startsWith('zb') && !scLower.startsWith('zp') &&
           !scLower.includes('- zb') && !scLower.includes('- zp');
  });

  state.rawScenarios = [...filtered];

  // Group scenarios by run (runId + revision) to ensure baseline averages are calculated per run
  const runGroups = new Map();
  filtered.forEach(s => {
    const runKey = (s.runId && s.revision) ? `${s.runId}_${s.revision}` : (s.runId || 'default');
    if (!runGroups.has(runKey)) runGroups.set(runKey, []);
    runGroups.get(runKey).push(s);
  });

  runGroups.forEach((groupScenarios, runKey) => {
    const hasExistingAvg = groupScenarios.some(s =>
      s.scenarioName.toLowerCase().includes('baseline avg') ||
      (s.rawScenarioName && s.rawScenarioName.toLowerCase().includes('baseline avg'))
    );

    if (hasExistingAvg) {
      groupScenarios.forEach(s => {
        if (s.scenarioName.toLowerCase().includes('baseline avg')) {
          s.isCalculatedAverage = true;
        }
      });
    } else {
      // Find baselines in this run group
      const baselines = groupScenarios.filter(s =>
        /(?:^|_)ab\d+$/i.test(s.rawScenarioName || s.scenarioName)
      );
      if (baselines.length > 0) {
        const first = baselines[0];
        const avgScenario = computeBaselineAverageForGroup(baselines, first.runId || '', first.revision || '');
        if (avgScenario) {
          filtered.push(avgScenario);
        }
      }
    }
  });

  // Sort canonical: grouped by run, ap first, then Baseline Avg, then ab1-ab4
  const sorted = sortScenarios(filtered);
  state.scenarios = sorted;
  const firstScenario = sorted[0] || filtered[0];
  state.buildingArea = firstScenario
    ? (state.buildingAreaType === 'conditioned' ? firstScenario.netConditionedBuildingArea : firstScenario.totalBuildingArea)
    : 0;
  state.scenarios.forEach(sc => {
    sc.buildingArea = state.buildingArea;
  });
  renderScenarioAreas();
  renderUnmappedWarning();

  // Option: average of the 4 baseline results, default to select it and not selecting ab1, ab2, ab3, ab4
  state.averageBaselines = elements.averageBaselinesToggle ? elements.averageBaselinesToggle.checked : true;

  if (state.averageBaselines) {
    // Select ap and Baseline Avg across all runs; exclude individual ab1..ab4
    state.selectedScenarios = sorted
      .map(s => s.scenarioName)
      .filter(name => !/(?:^|_)ab\d+$/i.test(name));

    const firstAvg = sorted.find(s => s.scenarioName.toLowerCase().includes('baseline avg'));
    state.baselineScenario = firstAvg ? firstAvg.scenarioName : sorted[0].scenarioName;

    const firstAp = sorted.find(s => /(?:^|_)ap$/i.test(s.scenarioName) || s.scenarioName.toLowerCase() === 'ap');
    state.activeScenario = firstAp ? firstAp.scenarioName : (firstAvg ? firstAvg.scenarioName : sorted[0].scenarioName);
  } else {
    // If averaging is disabled, select all real scenarios except Baseline Avg
    state.selectedScenarios = sorted
      .filter(s => !s.scenarioName.toLowerCase().includes('baseline avg'))
      .map(s => s.scenarioName);

    const firstAp = sorted.find(s => /(?:^|_)ap$/i.test(s.scenarioName) || s.scenarioName.toLowerCase() === 'ap');
    state.activeScenario = firstAp ? firstAp.scenarioName : sorted[0].scenarioName;

    const firstAb = sorted.find(s => /(?:^|_)ab1$/i.test(s.scenarioName) || s.scenarioName.toLowerCase() === 'ab1');
    state.baselineScenario = firstAb ? firstAb.scenarioName : sorted[0].scenarioName;
  }

  if (elements.averageBaselinesToggle) {
    elements.averageBaselinesToggle.checked = state.averageBaselines;
  }

  updateCsvFilenamePreview();
  renderScenariosPills();
  renderDropdownSelectors();
  updateExportSectionsVisibility();

  elements.scenariosContainer.classList.remove('hidden');
  elements.dashboardArea.classList.remove('hidden');

  updateDashboard();
}

// =============================================================================
// Rendering: Scenarios & Controls
// =============================================================================

function renderScenariosPills() {
  const activeCount = state.selectedScenarios.length;
  elements.scenariosCountBadge.textContent = `${activeCount} of ${state.scenarios.length} active`;
  elements.scenariosPillList.innerHTML = '';

  state.scenarios.forEach(sc => {
    const isSelected = state.selectedScenarios.includes(sc.scenarioName);
    const isAvg = sc.isCalculatedAverage || sc.scenarioName.toLowerCase().includes('baseline avg');
    const pill = document.createElement('div');
    pill.className = `scenario-pill ${isSelected ? 'active' : ''} ${isAvg ? 'pill-avg' : ''}`;
    pill.innerHTML = `
      <span class="pill-check">${isSelected ? '✓' : ''}</span>
      <span>${sc.scenarioName}</span>
      ${isAvg ? '<span class="pill-tag">AVG</span>' : ''}
    `;
    pill.addEventListener('click', () => { toggleScenarioSelection(sc.scenarioName); });
    elements.scenariosPillList.appendChild(pill);
  });
}

function toggleScenarioSelection(name) {
  if (state.selectedScenarios.includes(name)) {
    if (state.selectedScenarios.length > 1) {
      state.selectedScenarios = state.selectedScenarios.filter(n => n !== name);
    } else {
      showToast('Notice', 'At least one scenario must remain selected', 'ℹ️');
      return;
    }
  } else {
    state.selectedScenarios.push(name);
  }

  // If user changed scenario selection, sync averageBaselines checkbox
  const hasAvg = state.selectedScenarios.some(n => n.toLowerCase().includes('baseline avg'));
  if (elements.averageBaselinesToggle) {
    elements.averageBaselinesToggle.checked = hasAvg;
  }

  renderScenariosPills();
  updateDashboard();
}

function toggleAverageBaselines(enabled) {
  state.averageBaselines = enabled;
  if (enabled) {
    // Deselect individual ab1..ab4 across all runs
    state.selectedScenarios = state.selectedScenarios.filter(n => !/(?:^|_)ab\d+$/i.test(n));
    // Select all Baseline Avg scenarios
    state.scenarios.forEach(s => {
      if (s.scenarioName.toLowerCase().includes('baseline avg') && !state.selectedScenarios.includes(s.scenarioName)) {
        state.selectedScenarios.push(s.scenarioName);
      }
    });
    const firstAvg = state.scenarios.find(s => s.scenarioName.toLowerCase().includes('baseline avg'));
    if (firstAvg) state.baselineScenario = firstAvg.scenarioName;
  } else {
    // Deselect all Baseline Avg scenarios
    state.selectedScenarios = state.selectedScenarios.filter(n => !n.toLowerCase().includes('baseline avg'));
    // Select individual ab1..ab4 across all runs
    state.scenarios.forEach(s => {
      if (/(?:^|_)ab\d+$/i.test(s.rawScenarioName || s.scenarioName) && !state.selectedScenarios.includes(s.scenarioName)) {
        state.selectedScenarios.push(s.scenarioName);
      }
    });
    const firstAb = state.scenarios.find(s => /(?:^|_)ab1$/i.test(s.rawScenarioName || s.scenarioName));
    if (firstAb) state.baselineScenario = firstAb.scenarioName;
  }
  renderScenariosPills();
  renderDropdownSelectors();
  updateDashboard();
}

function renderDropdownSelectors() {
  if (elements.singleScenarioSelect) {
    elements.singleScenarioSelect.innerHTML = '';
    state.scenarios.forEach(sc => {
      const opt = document.createElement('option');
      opt.value = sc.scenarioName;
      opt.textContent = sc.scenarioName + (sc.isCalculatedAverage || sc.scenarioName.toLowerCase().includes('baseline avg') ? ' (Baseline Average)' : '');
      if (sc.scenarioName === state.activeScenario) opt.selected = true;
      elements.singleScenarioSelect.appendChild(opt);
    });
  }

  if (elements.baselineScenarioSelect) {
    elements.baselineScenarioSelect.innerHTML = '';
    state.scenarios.forEach(sc => {
      const opt = document.createElement('option');
      opt.value = sc.scenarioName;
      opt.textContent = `Baseline: ${sc.scenarioName}` + (sc.isCalculatedAverage || sc.scenarioName.toLowerCase().includes('baseline avg') ? ' (Average)' : '');
      if (sc.scenarioName === state.baselineScenario) opt.selected = true;
      elements.baselineScenarioSelect.appendChild(opt);
    });
  }
}

// =============================================================================
// Dashboard Updates (Metrics, Chart, Table)
// =============================================================================

function updateDashboard() {
  const activeScenariosList = state.scenarios.filter(s => {
    return state.selectedScenarios.includes(s.scenarioName);
  });

  if (activeScenariosList.length === 0) return;

  updateMetrics(activeScenariosList);
  updateChart(activeScenariosList);
  updateTable(activeScenariosList);
}

function updateMetrics(scenarios) {
  const displayUnit = getDisplayUnitLabel();
  document.querySelectorAll('.unit-label').forEach(el => el.textContent = displayUnit);

  let totalElecKwh  = 0;
  let totalGasTherm = 0;
  let totalKbtu     = 0;
  const categoryTotals = {};

  scenarios.forEach(sc => {
    totalElecKwh  += sc.summary.totalElectricity_kWh;
    totalGasTherm += sc.summary.totalNaturalGas_therm;
    totalKbtu     += sc.summary.grandTotal_kBtu;

    FIXED_CATEGORIES.forEach(fc => {
      const r = sc.categoryMap[fc.raw];
      if (r && !r.isTotal) {
        categoryTotals[fc.raw] = (categoryTotals[fc.raw] || 0) + getScenarioCategoryEnergyValue(sc, r);
      }
    });
  });

  const count       = scenarios.length;
  const avgKbtu     = totalKbtu    / count;
  const avgElecKwh  = totalElecKwh / count;
  const avgGasTherm = totalGasTherm / count;

  const totalElecKbtu = avgElecKwh  * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu  = avgGasTherm * CONVERSIONS.THERM_TO_KBTU;

  let displayTotal = avgKbtu;
  let displayElec  = avgElecKwh;
  let displayGas   = avgGasTherm;

  if (state.energyUnit === 'eui') {
    displayTotal = scenarios.reduce((sum, sc) => sum + getScenarioEnergyValue(sc), 0) / count;
    displayElec = displayTotal;
    displayGas = displayTotal;
  } else if (state.energyUnit === 'kWh') {
    displayTotal = avgElecKwh;
    displayElec  = avgElecKwh;
    displayGas   = avgGasTherm;
  } else if (state.energyUnit === 'therm') {
    displayTotal = avgGasTherm;
    displayElec  = avgElecKwh * CONVERSIONS.KWH_TO_THERM;
    displayGas   = avgGasTherm;
  } else {
    displayElec = totalElecKbtu;
    displayGas  = totalGasKbtu;
  }

  elements.metricTotalEnergy.textContent  = `${formatNum(displayTotal, 0)} ${displayUnit}`;
  elements.metricTotalSubtitle.textContent = count > 1 ? `Average across ${count} selected scenarios` : `${scenarios[0].scenarioName} total energy`;

  const elecPct = avgKbtu > 0 ? (totalElecKbtu / avgKbtu) * 100 : 0;
  const gasPct  = avgKbtu > 0 ? (totalGasKbtu  / avgKbtu) * 100 : 0;

  elements.metricElecVal.textContent     = `${formatNum(displayElec, 0)} ${displayUnit}`;
  elements.metricElecPercent.textContent = `${formatNum(elecPct, 1)}% of total energy`;
  elements.metricGasVal.textContent      = `${formatNum(displayGas, 0)} ${displayUnit}`;
  elements.metricGasPercent.textContent  = `${formatNum(gasPct, 1)}% of total energy`;

  let topCat = '-';
  let topVal  = 0;
  Object.entries(categoryTotals).forEach(([cat, val]) => {
    if (val > topVal) { topVal = val; topCat = cat; }
  });

  const peakDisplayVal = topVal / count;

  const fc = FIXED_CATEGORIES.find(c => c.raw === topCat);
  elements.metricPeakCategory.textContent = fc ? (state.cleanLabels ? fc.label : fc.raw) : topCat;
  elements.metricPeakVal.textContent      = `${formatNum(peakDisplayVal, 0)} ${displayUnit} avg`;
}

// =============================================================================
// Chart.js Visualization Engine (unchanged from previous)
// =============================================================================

function getChartCategories(scenarios) {
  return FIXED_CATEGORIES.filter(fc => {
    if (!state.hideZeroes) return true;
    return scenarios.some(sc => {
      const r = sc.categoryMap[fc.raw];
      return r && getScenarioCategoryEnergyValue(sc, r) !== 0;
    });
  });
}

function updateChart(scenarios) {
  if (state.chartInstance) { state.chartInstance.destroy(); }

  const displayUnit = getDisplayUnitLabel();
  elements.chartUnitBadge.textContent  = `Units: ${displayUnit}`;
  elements.chartMainTitle.textContent = `${state.viewMode === 'stacked' ? 'Stacked' : 'Clustered'} End-Use Energy by Scenario (${displayUnit})`;

  const visibleCats = getChartCategories(scenarios);
  const labels = visibleCats.map(fc => state.cleanLabels ? fc.label : fc.raw);

  let chartConfig = {};

  // Donut
  if (state.chartType === 'doughnut') {
    const targetSc = scenarios[0];
    const isDark = document.body.classList.contains('dark-theme');
    const dataVals = visibleCats.map(fc => { const r = targetSc.categoryMap[fc.raw]; return r ? getScenarioCategoryEnergyValue(targetSc, r) : 0; });
    chartConfig = {
      type: 'doughnut',
      data: { labels, datasets: [{ data: dataVals, backgroundColor: CHART_COLORS.slice(0, visibleCats.length), borderWidth: 2, borderColor: isDark ? '#161D26' : '#FFFFFF' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: {
        legend: { position: 'right', labels: { color: isDark ? '#A0B0C0' : '#4F6173', font: { family: 'Yu Gothic, Raleway, Inter', weight: '600' }, boxWidth: 14 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatNum(ctx.raw)} ${state.energyUnit}` } }
      }}
    };
  }

  // Horizontal Bar
  else if (state.chartType === 'horizontalBar') {
    const datasets = scenarios.map((sc, idx) => {
      const color = getScenarioColor(sc.scenarioName, idx);
      return { label: sc.scenarioName, data: visibleCats.map(fc => { const r = sc.categoryMap[fc.raw]; return r ? getScenarioCategoryEnergyValue(sc, r) : 0; }), backgroundColor: color, borderColor: color, borderWidth: 1 };
    });
    chartConfig = { type: 'bar', data: { labels, datasets }, options: { ...getCommonChartOptions(false), indexAxis: 'y' } };
  }

  // Radar
  else if (state.chartType === 'radar') {
    const isDark = document.body.classList.contains('dark-theme');
    const datasets = scenarios.map((sc, idx) => {
      const color = getScenarioColor(sc.scenarioName, idx);
      return { label: sc.scenarioName, data: visibleCats.map(fc => { const r = sc.categoryMap[fc.raw]; return r ? getScenarioCategoryEnergyValue(sc, r) : 0; }), backgroundColor: `${color}33`, borderColor: color, borderWidth: 2, pointBackgroundColor: color };
    });
    chartConfig = {
      type: 'radar', data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { r: { ticks: { color: isDark ? '#A0B0C0' : '#4F6173', backdropColor: 'transparent' }, pointLabels: { color: isDark ? '#A0B0C0' : '#4F6173', font: { family: 'Yu Gothic, Raleway, Inter', size: 11, weight: '600' } } } }, plugins: { legend: { labels: { color: isDark ? '#A0B0C0' : '#4F6173', font: { family: 'Yu Gothic, Raleway, Inter', weight: '600' } } } } }
    };
  }

  // Standard Grouped or Stacked Bar
  else {
    if (state.viewMode === 'stacked') {
      const scenarioLabels = scenarios.map(sc => sc.scenarioName);
      const datasets = visibleCats.map((fc, categoryIndex) => ({
        label: state.cleanLabels ? fc.label : fc.raw,
        data: scenarios.map(sc => {
          const row = sc.categoryMap[fc.raw];
          return row ? getScenarioCategoryEnergyValue(sc, row) : 0;
        }),
        backgroundColor: CHART_COLORS[categoryIndex % CHART_COLORS.length],
        borderColor: CHART_COLORS[categoryIndex % CHART_COLORS.length],
        borderWidth: 1,
        stack: 'end-uses'
      }));
      chartConfig = { type: 'bar', data: { labels: scenarioLabels, datasets }, options: getCommonChartOptions(true) };
    } else {
      const datasets = scenarios.map((sc, idx) => {
        const color = getScenarioColor(sc.scenarioName, idx);
        return { label: sc.scenarioName, data: visibleCats.map(fc => { const r = sc.categoryMap[fc.raw]; return r ? getScenarioCategoryEnergyValue(sc, r) : 0; }), backgroundColor: color, borderColor: color, borderWidth: 1 };
      });
      chartConfig = { type: 'bar', data: { labels, datasets }, options: getCommonChartOptions(false) };
    }
  }

  state.chartInstance = new Chart(elements.energyChartCanvas, chartConfig);
}

function getCommonChartOptions(stacked = false) {
  const isDark    = document.body.classList.contains('dark-theme');
  const textColor = isDark ? '#A0B0C0' : '#4F6173';
  const gridColor = isDark ? '#2D3A4B' : '#E8EEF3';
  return {
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { stacked, grid: { color: isDark ? '#202A36' : '#F0F4F8' }, ticks: { color: textColor, font: { family: 'Yu Gothic, Raleway, Inter', size: 11, weight: '500' } } },
      y: { stacked, title: { display: true, text: `Energy Consumption (${getDisplayUnitLabel()})`, color: textColor, font: { family: 'Yu Gothic, Raleway, Inter', weight: '600' } }, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Yu Gothic, Raleway, Inter', size: 11 } } }
    },
    plugins: {
      legend: { labels: { color: textColor, font: { family: 'Yu Gothic, Raleway, Inter', weight: '600' }, boxWidth: 14 } },
      tooltip: { padding: 10, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatNum(ctx.raw)} ${state.energyUnit}` } }
    }
  };
}

// =============================================================================
// Fixed-Column Table Generation
// Layout: [Category] then for each scenario (ap first): [Elec kWh | Elec Dem W | Gas therm | Gas Dem Btu/h]
// Electricity-only rows: Gas cells show "-"
// =============================================================================

function updateTable(scenarios) {
  elements.tableHead.innerHTML = '';
  elements.tableBody.innerHTML = '';
  elements.tableFoot.innerHTML = '';

  elements.tableTitle.textContent = 'EAp2-4/5 Performance Rating Method Compliance';

  // ---- Header row 1: Scenario group spans ----
  let head1 = `<tr><th class="cat-col" rowspan="2">End-Use Category</th>`;
  scenarios.forEach((sc, sIdx) => {
    const color = getScenarioColor(sc.scenarioName, sIdx);
    head1 += `<th class="scenario-group-header" colspan="4" style="background:${color}22; border-bottom: 3px solid ${color};">${sc.scenarioName}</th>`;
  });
  head1 += `</tr>`;

  // ---- Header row 2: Sub-columns per scenario ----
  let head2 = `<tr>`;
  scenarios.forEach(() => {
    head2 += `<th class="num-col sub-col">Elec Use<br>[kWh]</th>`;
    head2 += `<th class="num-col sub-col">Elec Dem<br>[W]</th>`;
    head2 += `<th class="num-col sub-col">Gas Use<br>[therm]</th>`;
    head2 += `<th class="num-col sub-col">Gas Dem<br>[Btu/h]</th>`;
  });
  head2 += `</tr>`;

  elements.tableHead.innerHTML = head1 + head2;

  // ---- Column totals accumulators ----
  // Per scenario: [sumElecKwh, sumElecDemW, sumGasTherm, sumGasDemBtuh]
  const columnTotals = scenarios.map(() => [0, 0, 0, 0]);

  // ---- Data rows (fixed list) ----
  FIXED_CATEGORIES.forEach(fc => {
    const row = document.createElement('tr');
    let rowHtml = `<td class="cat-col">${state.cleanLabels ? fc.label : fc.raw}</td>`;

    scenarios.forEach((sc, sIdx) => {
      const r = sc.categoryMap[fc.raw];
      const elecKwh    = r ? r.elecKwh    : 0;
      const elecDemW   = r ? r.elecDemW   : 0;
      const gasTherm   = r ? r.gasTherm   : 0;
      const gasDemBtuh = r ? r.gasDemBtuh : 0;

      columnTotals[sIdx][0] += elecKwh;
      columnTotals[sIdx][1] += elecDemW;
      columnTotals[sIdx][2] += gasTherm;
      columnTotals[sIdx][3] += gasDemBtuh;

      const gasDisplay = fc.electricityOnly;

      rowHtml += `<td class="num-col">${formatNum(elecKwh)}</td>`;
      rowHtml += `<td class="num-col">${formatNum(elecDemW)}</td>`;
      rowHtml += `<td class="num-col gas-col${gasDisplay ? ' elec-only' : ''}">${gasDisplay ? '-' : formatNum(gasTherm)}</td>`;
      rowHtml += `<td class="num-col gas-col${gasDisplay ? ' elec-only' : ''}">${gasDisplay ? '-' : formatNum(gasDemBtuh)}</td>`;
    });

    row.innerHTML = rowHtml;
    elements.tableBody.appendChild(row);
  });

  // ---- Totals footer ----
  let footHtml = `<tr><td class="cat-col">TOTAL END USES</td>`;
  scenarios.forEach((sc, sIdx) => {
    const [sumElec, sumElecDem, sumGas, sumGasDem] = columnTotals[sIdx];
    footHtml += `<td class="num-col"><strong>${formatNum(sumElec)}</strong></td>`;
    footHtml += `<td class="num-col">${formatNum(sumElecDem)}</td>`;
    footHtml += `<td class="num-col gas-col"><strong>${formatNum(sumGas)}</strong></td>`;
    footHtml += `<td class="num-col gas-col">${formatNum(sumGasDem)}</td>`;
  });
  footHtml += `</tr>`;
  elements.tableFoot.innerHTML = footHtml;
}

// =============================================================================
// Excel TSV Copy (from fixed table)
// =============================================================================

function generateTSVForExcel() {
  const table = elements.complianceDataTable;
  const rows  = Array.from(table.querySelectorAll('tr'));
  return rows.map(row => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    return cells.map(cell => cell.textContent.trim()).join('\t');
  }).join('\r\n');
}

async function copyTableToExcel() {
  try {
    const tsv = generateTSVForExcel();
    await navigator.clipboard.writeText(tsv);
    const rowCount = elements.complianceDataTable.querySelectorAll('tbody tr').length + 2;
    showToast('Copied for Excel!', `Copied ${rowCount} rows as Tab-Separated Values. Paste with Ctrl+V into Excel.`, '📋');
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = generateTSVForExcel();
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Copied for Excel!', 'Table copied to clipboard. Ready to paste in Excel.', '📋');
  }
}

/**
 * Native formatted Excel (.xlsx) workbook export via SheetJS
 * Exports both Compliance Summary (with 4-subcolumn scenario structure) and Scenario Totals.
 */
function exportExcelWorkbook() {
  if (!state.scenarios || state.scenarios.length === 0) {
    showToast('No Data', 'Please load project scenarios first.', '⚠️');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showToast('Export Error', 'SheetJS library is not available.', '❌');
    return;
  }

  const activeScenariosList = state.scenarios.filter(s => {
    return state.selectedScenarios.includes(s.scenarioName);
  });

  if (activeScenariosList.length === 0) {
    showToast('No Scenarios Selected', 'Please select at least one scenario.', '⚠️');
    return;
  }

  const sheetData = [];

  // Title info
  const runId = (elements.csvRunId && elements.csvRunId.value.trim()) || 'RUN-001';
  const revision = (elements.csvRevision && elements.csvRevision.value.trim()) || 'Rev.0';
  sheetData.push(["O'Brien360 - EAp2-4/5 Performance Rating Method Compliance Report"]);
  sheetData.push([`Generated: ${new Date().toLocaleString()}`, `Run ID: ${runId}`, `Revision: ${revision}`]);
  sheetData.push([]); // blank separator

  // Header row 1: Scenario groups
  const headerGroupRow = ['End-Use Category'];
  activeScenariosList.forEach(sc => {
    headerGroupRow.push(sc.scenarioName, '', '', '');
  });
  sheetData.push(headerGroupRow);

  // Header row 2: Metric sub-headers
  const subHeaderRow = [''];
  activeScenariosList.forEach(() => {
    subHeaderRow.push('Elec Use [kWh]', 'Elec Dem [W]', 'Gas Use [therm]', 'Gas Dem [Btu/h]');
  });
  sheetData.push(subHeaderRow);

  // Column totals
  const columnTotals = activeScenariosList.map(() => [0, 0, 0, 0]);

  // Data rows
  FIXED_CATEGORIES.forEach(fc => {
    const row = [state.cleanLabels ? fc.label : fc.raw];
    activeScenariosList.forEach((sc, sIdx) => {
      const r = sc.categoryMap[fc.raw];
      const elecKwh    = r ? r.elecKwh    : 0;
      const elecDemW   = r ? r.elecDemW   : 0;
      const gasTherm   = r ? r.gasTherm   : 0;
      const gasDemBtuh = r ? r.gasDemBtuh : 0;

      columnTotals[sIdx][0] += elecKwh;
      columnTotals[sIdx][1] += elecDemW;
      columnTotals[sIdx][2] += gasTherm;
      columnTotals[sIdx][3] += gasDemBtuh;

      row.push(elecKwh, elecDemW);
      if (fc.electricityOnly) {
        row.push('-', '-');
      } else {
        row.push(gasTherm, gasDemBtuh);
      }
    });
    sheetData.push(row);
  });

  // Footer totals row
  const footerRow = ['TOTAL END USES'];
  activeScenariosList.forEach((sc, sIdx) => {
    const [sumElec, sumElecDem, sumGas, sumGasDem] = columnTotals[sIdx];
    footerRow.push(
      Number(sumElec.toFixed(2)),
      Number(sumElecDem.toFixed(2)),
      Number(sumGas.toFixed(2)),
      Number(sumGasDem.toFixed(2))
    );
  });
  sheetData.push(footerRow);

  // Create worksheet and apply merges
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: activeScenariosList.length * 4 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } }
  ];

  activeScenariosList.forEach((_, idx) => {
    const startCol = 1 + (idx * 4);
    ws['!merges'].push({ s: { r: 3, c: startCol }, e: { r: 3, c: startCol + 3 } });
  });

  const colWidths = [{ wch: 28 }];
  for (let i = 0; i < activeScenariosList.length * 4; i++) {
    colWidths.push({ wch: 16 });
  }
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compliance Summary');

  // Scenario Summary sheet
  const summaryData = [
    ["O'Brien360 Scenario Energy Summaries"],
    [],
    ['Scenario', 'Total Elec [kWh]', 'Total Gas [therm]', 'Elec [kBtu]', 'Gas [kBtu]', 'Grand Total [kBtu]', 'Elec Share (%)', 'Gas Share (%)']
  ];
  activeScenariosList.forEach(sc => {
    const s = sc.summary;
    summaryData.push([
      sc.scenarioName,
      s.totalElectricity_kWh,
      s.totalNaturalGas_therm,
      s.totalElectricity_kBtu,
      s.totalNaturalGas_kBtu,
      s.grandTotal_kBtu,
      s.electricitySharePercent,
      s.naturalGasSharePercent
    ]);
  });
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Scenario Totals');

  const fileName = `OB360_Compliance_${runId}_${revision}.xlsx`.replace(/[^a-z0-9_\-\.]/gi, '_');
  XLSX.writeFile(wb, fileName);
  showToast('Excel Exported!', `Downloaded: ${fileName}`, '📊');
}

// =============================================================================
// CSV Export: Append rows to a persistent CSV log
// CSV columns: Run ID, Revision, Scenario, [Category x4 columns per scenario]
// Each row = one scenario's full data for that run
// =============================================================================

/**
 * Builds the wide 68-column CSV rows matching the compliance log template.
 * Two header rows + one data row per scenario in scope.
 * Scope: 'all' (ap, ab1-ab4, Baseline Avg) or 'active' (selected scenarios only).
 */
function buildCsvRowsForExport() {
  const runId    = (elements.csvRunId && elements.csvRunId.value.trim()) || 'Run_01';
  const revision = (elements.csvRevision && elements.csvRevision.value.trim()) || 'r33';
  const scope    = elements.csvExportScope ? elements.csvExportScope.value : 'all';

  // Determine which scenarios to export
  let exportScenarios;
  if (scope === 'active') {
    exportScenarios = state.scenarios.filter(s => state.selectedScenarios.includes(s.scenarioName));
  } else {
    exportScenarios = sortScenarios(state.scenarios);
  }

  if (exportScenarios.length === 0) return [];

  const rows = [];

  // Header row 1: Dashboard category names (Row 1)
  rows.push(CSV_HEADER_ROW_1);

  // Header row 2: HTM category names (Row 2)
  rows.push(CSV_HEADER_ROW_2);

  // Header row 3: Units (Row 3)
  rows.push(CSV_HEADER_ROW_3);

  // One data row per scenario
  exportScenarios.forEach(sc => {
    const rawName = sc.rawScenarioName || sc.scenarioName;
    const rId = sc.runId || runId;
    const rev = sc.revision || revision;
    const row = formatScenarioCsvRow(sc, rId, rev, rawName);
    rows.push(row);
  });

  return rows;
}

async function browseFolderForExport() {
  if (!window.showDirectoryPicker) {
    showToast('Not Supported', 'Your browser does not support the folder picker. Try Chrome or Edge.', '⚠️');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({
      id: 'cbecc-result-tool-export-v2',
      mode: 'readwrite'
    });
    state.csvExportDirHandle = dirHandle;
    if (elements.csvExportLocation) {
      elements.csvExportLocation.value = dirHandle.name;
    }
    if (elements.csvLocationStatus) {
      elements.csvLocationStatus.textContent = '✅ Folder selected — file will be saved directly';
      elements.csvLocationStatus.className = 'csv-location-status status-ok';
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Folder Error', 'The folder picker could not open that location. Please choose the parent folder where the model folder is stored.', '⚠️');
    }
    // User cancelled — clear status if nothing was previously chosen
    if (!state.csvExportDirHandle && elements.csvLocationStatus) {
      elements.csvLocationStatus.textContent = '';
    }
  }
}

async function downloadCSVLog() {
  if (state.scenarios.length === 0 && (!state.loadedCsvRows || state.loadedCsvRows.length <= 2)) {
    showToast('No Data', 'Load scenarios before exporting CSV.', '⚠️');
    return;
  }

  const rows = buildCsvRowsForExport();

  if (!rows || rows.length === 0) {
    showToast('No Scenarios', 'No scenarios matched the selected export scope.', '⚠️');
    return;
  }

  const csvContent = rows.map(row =>
    row.map(cell => {
      const s = String(cell);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  ).join('\r\n');

  const filename = (elements.csvExportFilename && elements.csvExportFilename.value.trim())
    || getCleanCsvFilename(state.selectedFolderName || 'Energy_Compliance');
  const dataRowCount = rows.length - 3;

  // --- Path 1: write directly to the picked folder (File System Access API) ---
  if (state.csvExportDirHandle) {
    try {
      const fileHandle = await state.csvExportDirHandle.getFileHandle(filename, { create: true });
      const writable  = await fileHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      showToast('CSV Saved', `Saved to "${state.csvExportDirHandle.name}\\${filename}" — ${dataRowCount} scenario row(s).`, '💾');
      return;
    } catch (err) {
      // Permission revoked or write failed — fall through to standard download
      showToast('Write Failed', `Could not write to folder: ${err.message}. Falling back to browser download.`, '⚠️');
      state.csvExportDirHandle = null;
      if (elements.csvLocationStatus) {
        elements.csvLocationStatus.textContent = '⚠️ Permission lost — re-select folder or use browser download';
        elements.csvLocationStatus.className = 'csv-location-status status-warn';
      }
    }
  }

  // --- Path 2: standard browser download ---
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const location = (elements.csvExportLocation && elements.csvExportLocation.value.trim()) || '(browser download location)';
  showToast('CSV Downloaded', `${filename} — ${dataRowCount} scenario row(s). Browser downloads are controlled by the browser; choose the model folder's parent with Browse to save there directly.`, '💾');
}

function downloadChartImage() {
  if (!state.chartInstance) return;
  const a    = document.createElement('a');
  a.href     = state.chartInstance.toBase64Image();
  a.download = `energy_chart_${state.viewMode}_${state.energyUnit}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Chart Saved', 'Chart exported as PNG image', '🖼️');
}

function showToast(title, message, icon = '✅') {
  elements.toastTitle.textContent   = title;
  elements.toastMessage.textContent = message;
  elements.toast.querySelector('.toast-icon').textContent = icon;
  elements.toast.classList.remove('hidden');
  clearTimeout(elements.toast._timeout);
  elements.toast._timeout = setTimeout(() => { elements.toast.classList.add('hidden'); }, 4500);
}

// =============================================================================
// Event Listeners & Initialization
// =============================================================================

function setupEventListeners() {
  // Theme Toggle
  elements.themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    document.body.classList.toggle('light-theme');
    const isDark = document.body.classList.contains('dark-theme');
    elements.themeIcon.textContent = isDark ? '☀️' : '🌙';
    if (state.scenarios.length > 0) updateDashboard();
  });

  // Tab switching
  setupTabs();

  // Mode 1: Results CSV
  if (elements.browseCsvBtn && elements.browserCsvInput) {
    elements.browseCsvBtn.addEventListener('click', () => elements.browserCsvInput.click());
    elements.browserCsvInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleCsvFile(e.target.files[0]);
    });
  }
  if (elements.loadSampleCsvBtn) {
    elements.loadSampleCsvBtn.addEventListener('click', loadSampleCsv);
  }
  if (elements.dropZoneCsv) {
    elements.dropZoneCsv.addEventListener('dragover', e => { e.preventDefault(); elements.dropZoneCsv.classList.add('dragover'); });
    elements.dropZoneCsv.addEventListener('dragleave', () => elements.dropZoneCsv.classList.remove('dragover'));
    elements.dropZoneCsv.addEventListener('drop', e => {
      e.preventDefault();
      elements.dropZoneCsv.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleCsvFile(e.dataTransfer.files[0]);
    });
  }

  // Mode 2: Model Folder
  if (elements.browseFolderBtn && elements.browserFolderInput) {
    elements.browseFolderBtn.addEventListener('click', () => elements.browserFolderInput.click());
    elements.browserFolderInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFileList(e.target.files);
    });
  }
  if (elements.browseFilesBtn && elements.browserFilesInput) {
    elements.browseFilesBtn.addEventListener('click', () => elements.browserFilesInput.click());
    elements.browserFilesInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFileList(e.target.files);
    });
  }
  if (elements.loadSampleFolderBtn) {
    elements.loadSampleFolderBtn.addEventListener('click', loadExampleDataInBrowser);
  }
  if (elements.dropZoneFolder) {
    elements.dropZoneFolder.addEventListener('dragover', e => { e.preventDefault(); elements.dropZoneFolder.classList.add('dragover'); });
    elements.dropZoneFolder.addEventListener('dragleave', () => elements.dropZoneFolder.classList.remove('dragover'));
    elements.dropZoneFolder.addEventListener('drop', e => {
      e.preventDefault();
      elements.dropZoneFolder.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFileList(e.dataTransfer.files);
    });
  }

  // Mode 3: Append Model Run to CSV
  if (elements.appendBrowseCsvBtn && elements.appendCsvInput) {
    elements.appendBrowseCsvBtn.addEventListener('click', async () => {
      // Use showOpenFilePicker when available so we can capture the FileSystemFileHandle
      // (needed to default the save dialog to the same folder later)
      if (window.showOpenFilePicker) {
        try {
          const [fileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] } }],
            multiple: false,
          });
          state.method3BaseCsvFileHandle = fileHandle;
          state.method3BaseFileHandle = null; // reset output handle when a new base CSV is loaded
          const file = await fileHandle.getFile();
          handleAppendBaseCsv(file);
        } catch (err) {
          if (err.name !== 'AbortError') {
            showToast('Error', 'Could not open file: ' + err.message, '❌');
          }
        }
      } else {
        elements.appendCsvInput.click();
      }
    });
    elements.appendCsvInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleAppendBaseCsv(e.target.files[0]);
    });
  }
  if (elements.appendSampleCsvBtn) {
    elements.appendSampleCsvBtn.addEventListener('click', loadAppendSampleCsv);
  }
  if (elements.appendDropCsv) {
    elements.appendDropCsv.addEventListener('dragover', e => { e.preventDefault(); elements.appendDropCsv.classList.add('dragover'); });
    elements.appendDropCsv.addEventListener('dragleave', () => elements.appendDropCsv.classList.remove('dragover'));
    elements.appendDropCsv.addEventListener('drop', e => {
      e.preventDefault();
      elements.appendDropCsv.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleAppendBaseCsv(e.dataTransfer.files[0]);
    });
  }

  if (elements.appendBrowseFolderBtn && elements.appendFolderInput) {
    elements.appendBrowseFolderBtn.addEventListener('click', () => elements.appendFolderInput.click());
    elements.appendFolderInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleAppendModelFolder(e.target.files);
    });
  }
  if (elements.appendBrowseFilesBtn && elements.appendFilesInput) {
    elements.appendBrowseFilesBtn.addEventListener('click', () => elements.appendFilesInput.click());
    elements.appendFilesInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleAppendModelFolder(e.target.files);
    });
  }
  if (elements.appendSampleFolderBtn) {
    elements.appendSampleFolderBtn.addEventListener('click', loadAppendSampleFolder);
  }
  if (elements.appendDropFolder) {
    elements.appendDropFolder.addEventListener('dragover', e => { e.preventDefault(); elements.appendDropFolder.classList.add('dragover'); });
    elements.appendDropFolder.addEventListener('dragleave', () => elements.appendDropFolder.classList.remove('dragover'));
    elements.appendDropFolder.addEventListener('drop', e => {
      e.preventDefault();
      elements.appendDropFolder.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleAppendModelFolder(e.dataTransfer.files);
    });
  }

  if (elements.executeLoadDashboardBtn) {
    elements.executeLoadDashboardBtn.addEventListener('click', executeLoadDashboard);
  }

  // Method 3 Checklist Bulk Actions
  if (elements.appendSelectAllBtn) {
    elements.appendSelectAllBtn.addEventListener('click', () => {
      if (elements.appendScenarioChecklist) {
        elements.appendScenarioChecklist.querySelectorAll('.append-scenario-cb').forEach(cb => { cb.checked = true; });
      }
    });
  }
  if (elements.appendDeselectAllBtn) {
    elements.appendDeselectAllBtn.addEventListener('click', () => {
      if (elements.appendScenarioChecklist) {
        elements.appendScenarioChecklist.querySelectorAll('.append-scenario-cb').forEach(cb => { cb.checked = false; });
      }
    });
  }
  if (elements.appendDownloadCsvBtn) {
    elements.appendDownloadCsvBtn.addEventListener('click', downloadAppendedCsv);
  }

  // Average Baselines Toggle
  if (elements.averageBaselinesToggle) {
    elements.averageBaselinesToggle.addEventListener('change', e => {
      toggleAverageBaselines(e.target.checked);
    });
  }

  // Scenario Bulk Actions
  elements.selectAllScenariosBtn.addEventListener('click', () => {
    state.selectedScenarios = state.scenarios.map(s => s.scenarioName);
    renderScenariosPills(); updateDashboard();
  });
  elements.deselectAllScenariosBtn.addEventListener('click', () => {
    state.selectedScenarios = [state.scenarios[0].scenarioName];
    renderScenariosPills(); updateDashboard();
  });

  // View Mode
  elements.viewModeControl.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.viewModeControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewMode = btn.dataset.value;
      updateDashboard();
    });
  });

  // Unit
  elements.unitControl.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.unitControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.energyUnit = btn.dataset.unit;
      updateDashboard();
    });
  });

  // Chart Type
  elements.chartTypeSelect.addEventListener('change', e => { state.chartType = e.target.value; updateDashboard(); });

  // Scenario Selectors
  elements.singleScenarioSelect.addEventListener('change', e => { state.activeScenario = e.target.value; updateDashboard(); });
  elements.baselineScenarioSelect.addEventListener('change', e => { state.baselineScenario = e.target.value; updateDashboard(); });

  // Options
  elements.cleanLabelsToggle.addEventListener('change', e => { state.cleanLabels = e.target.checked; updateDashboard(); });
  elements.hideZeroesToggle.addEventListener('change', e => { state.hideZeroes = e.target.checked; updateDashboard(); });

  // Export Buttons
  elements.copyExcelBtn.addEventListener('click', copyTableToExcel);
  if (elements.exportExcelBtn) {
    elements.exportExcelBtn.addEventListener('click', exportExcelWorkbook);
  }
  if (elements.exportCsvBtn) {
    elements.exportCsvBtn.addEventListener('click', downloadCSVLog);
  }
  if (elements.csvBrowseFolderBtn) {
    elements.csvBrowseFolderBtn.addEventListener('click', browseFolderForExport);
  }
  elements.downloadChartBtn.addEventListener('click', downloadChartImage);
}

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // Auto-load sample CSV on startup for instant live interactive dashboard
  await loadSampleCsv();
});
