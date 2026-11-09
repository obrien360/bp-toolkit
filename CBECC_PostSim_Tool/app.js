/**
 * app.js - Building Energy Performance Rating Compliance Extractor & Dashboard
 */

// Global Shared Project State across Compliance, Model QC, and Reports tabs
window.CBECC_SHARED = window.CBECC_SHARED || {
  activeFolderPath: '',
  activeFolderName: '',
  activeWorkbookFile: null,
  sourceTab: '',
  filesList: null,
  setFolder: function (folderPath, folderName, sourceTab, files = null) {
    this.activeFolderPath = folderPath || '';
    this.activeFolderName = folderName || folderPath || '';
    this.sourceTab = sourceTab || '';
    if (files) this.filesList = files;
    if (window.ReportsModule && typeof window.ReportsModule.onSharedFolderUpdated === 'function') {
      window.ReportsModule.onSharedFolderUpdated(this.activeFolderPath, this.activeFolderName, this.sourceTab, this.filesList);
    }
    if (window.QCModule && typeof window.QCModule.onSharedFolderUpdated === 'function') {
      window.QCModule.onSharedFolderUpdated(this.activeFolderPath, this.activeFolderName, this.sourceTab, this.filesList);
    }
  },
  setWorkbook: function (file, sourceTab) {
    this.activeWorkbookFile = file;
    this.sourceTab = sourceTab || '';
    if (window.QCModule && typeof window.QCModule.handleWorkbookFile === 'function') {
      window.QCModule.handleWorkbookFile(file);
    }
  }
};

// =============================================================================
// Constants & Unit Conversion Factors
// =============================================================================
const CONVERSIONS = {
  KWH_TO_KBTU: 3.412142,
  THERM_TO_KBTU: 100.0,
  THERM_TO_KWH: 29.3071,
  KWH_TO_THERM: 1.0 / 29.3071,
};

// Standard Mapped Categories (Default Options in UI)
const STANDARD_MAPPED_CATEGORIES = [
  'Interior Lighting',
  'Exterior lighting',
  'Space Heating',
  'Space Cooling',
  'Pumps',
  'Heat Rejection',
  'Fans-Interior',
  'Fans-Parking Garage',
  'Service Water Heating',
  'Receptacle Equipment',
  'Elevators and escalators'
];

const COMPARABLE_PROJECT_FILTERS = [
  {
    key: 'projectType',
    label: 'Project Type',
    options: [
      'BuiltGreen - 09', 'BuiltGreen - 12', 'BuiltGreen - 15', 'SEC C407 - 15',
      'SEC C407 - 21', 'WSEC C407 - 18', 'WSEC C407 - 21', 'LEED-NC',
      'LEED-Midrise V3', 'LEED-Midrise V4', 'ASHRAE 90.1-2019', 'Post Occupany',
      'Operations and Maintainance', 'MIP', 'Renovation', 'Benchmark'
    ]
  },
  { key: 'residentialHeatingType', label: 'Residential Heating Type', options: ['Electric', '25% HP', '50% HP', '75% HP', '100% HP', 'WSHP', 'Gas', 'None'] },
  { key: 'residentialCoolingType', label: 'Residential Cooling Type', options: ['Window', '25% HP', '50% HP', '75% HP', '100% HP', 'WSHP', 'Gas', 'Portable', 'None'] },
  { key: 'residentialVentilationType', label: 'Residential Ventilation Type', options: ['In-Unit ERV/HRV', 'Central ERV/HRV', 'SZHP', 'DOAS', 'WHF'] },
  { key: 'corridorHeatingType', label: 'Corridor Heating Type', options: ['Electric', '25% HP', '50% HP', '75% HP', '100% HP', 'WSHP', 'Gas', 'None'] },
  { key: 'corridorVentilationType', label: 'Corridor Ventilation Type', options: ['In-Unit ERV/HRV', 'Central ERV/HRV', 'SZHP', 'DOAS', 'WHF'] },
  { key: 'waterHeatingType', label: 'Water Heating Type', options: ['Electric Resistance', 'Gas Condensing', 'Hybrid HPWH + Gas', 'Hybrid HPWH + ER', '100% HPWH'] }
];

const COMPARABLE_PROJECT_COLUMNS = [
  { key: 'projectCode', label: 'Project Code #', unit: '' },
  { key: 'simulationRun', label: 'Simulation Run', unit: '' },
  { key: 'totalConditionedFloorArea', label: 'Total Conditioned Floor Area', unit: 'ft²' },
  { key: 'averageUnitArea', label: 'Average Unit Area', unit: 'ft²' },
  { key: 'conditionedAreaToTotalAreaRatio', label: 'Conditioned Area to Total Area Ratio', unit: 'Fraction' },
  { key: 'verticalSkinToFloorRatio', label: 'Vertical Skin to Floor Ratio', unit: 'Fraction' },
  { key: 'windowsToFloorRatio', label: 'Windows to Floor Ratio', unit: 'Fraction' },
  { key: 'totalWindowsToWallRatio', label: 'Total Windows to Wall Ratio', unit: 'Fraction' },
  { key: 'residentialWindowsToWallRatio', label: 'Residential Windows to Wall Ratio', unit: 'Fraction' },
  { key: 'unitCount', label: '# of units', unit: 'units' },
  { key: 'peoplePer1000', label: 'Ppl per 1000ft²', unit: '' },
  { key: 'resOaStatic', label: 'Res OA (Static)', unit: 'CFM/ft²' },
  { key: 'corridorOa', label: 'Corridor OA', unit: 'CFM/ft²' },
  { key: 'totalEui', label: 'Total EUI', unit: 'kBtu/ft²-yr' }
];

const END_USE_CATEGORY_ORDER = new Map(
  STANDARD_MAPPED_CATEGORIES.map((category, index) => [category.toLowerCase(), index])
);

function compareEndUseCategories(a, b) {
  const indexA = END_USE_CATEGORY_ORDER.get(a.toLowerCase());
  const indexB = END_USE_CATEGORY_ORDER.get(b.toLowerCase());
  if (indexA !== undefined || indexB !== undefined) {
    if (indexA === undefined) return 1;
    if (indexB === undefined) return -1;
    if (indexA !== indexB) return indexA - indexB;
  }
  return a.localeCompare(b);
}

function sortEndUseCategories(categories) {
  return categories.sort(compareEndUseCategories);
}

// O'Brien360 Official Brand Palette
const SCENARIO_COLORS = {
  ap: '#8CBD3A', // Pantone 368 C  - Signature O'Brien Green (Proposed Design)
  'baseline avg': '#4D76AD', // Pantone 7685 C - Slate Blue (Baseline Average)
  ab_avg: '#4D76AD',
  ab1: '#507281', // Pantone 2222 C - Marine Slate (Baseline 1)
  ab2: '#62B8A4', // Pantone 3258 C - Teal (Baseline 2)
  ab3: '#793E6D', // Pantone 2613 C - Aubergine (Baseline 3)
  ab4: '#007AC9', // Pantone 2144 C - Title & Hyperlink Blue (Baseline 4)
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
// Fixed Category Definitions (Default Mappings)
// All rows that ever appear in EAp2-4/5 CBECC-Com tables.
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
 * Returns default mapped user category name for a raw category and fuel type.
 */
function getDefaultCategoryMapping(rawCategory, fuel = 'elec') {
  if (!rawCategory) return 'Other';
  for (const fc of FIXED_CATEGORIES) {
    if (fuel === 'elec' && fc.elecHtmCategories && fc.elecHtmCategories.includes(rawCategory)) {
      return fc.raw;
    }
    if (fuel === 'gas' && fc.gasHtmCategories && fc.gasHtmCategories.includes(rawCategory)) {
      return fc.raw;
    }
    if (fc.raw.toLowerCase() === rawCategory.toLowerCase()) {
      return fc.raw;
    }
  }

  // Fallback heuristics
  const lower = rawCategory.toLowerCase();
  if (lower.includes('heat') && !lower.includes('rejection')) return 'Space Heating';
  if (lower.includes('cool')) return 'Space Cooling';
  if (lower.includes('interior lighting') || lower.includes('complianceltg')) return 'Interior Lighting';
  if (lower.includes('exterior lighting')) return 'Exterior lighting';
  if (lower.includes('transport') || lower.includes('elevator')) return 'Elevators and escalators';
  if (lower.includes('garage') || lower.includes('processmotor')) return 'Fans-Parking Garage';
  if (lower.includes('fan')) return 'Fans-Interior';
  if (lower.includes('pump')) return 'Pumps';
  if (lower.includes('rejection')) return 'Heat Rejection';
  if (lower.includes('water')) return 'Service Water Heating';
  if (lower.includes('receptacle') || lower.includes('equipment') || lower.includes('refrig') || lower.includes('process')) {
    return 'Receptacle Equipment';
  }
  return clean_category_name(rawCategory);
}

/**
 * Cleans CBECC raw category name by removing redundant suffixes.
 */
function clean_category_name(rawName) {
  if (!rawName) return '';
  if (rawName.includes(' -- ')) {
    const parts = rawName.split(' -- ');
    const prefix = parts[0].trim();
    const suffix = parts[1].trim();
    if (suffix === 'General' || suffix === 'Not Subdivided') return prefix;
    return `${prefix} (${suffix})`;
  }
  return rawName.trim();
}

/**
 * Aggregates a rawCategoryMap into dashboard categories based on dynamic mapping rules
 * or fallback FIXED_CATEGORIES.
 */
function buildDashboardCategoryMap(rawCategoryMap, mappingRules = (state && state.categoryMapping)) {
  const categoryMap = {};

  const ruleKeys = mappingRules ? Object.keys(mappingRules) : [];
  if (ruleKeys.length > 0) {
    // 1. Initialize all mapped target categories so order/presence is established
    ruleKeys.forEach(k => {
      const rule = mappingRules[k];
      const targetCat = rule.userCategory || rule.rawCategory;
      if (!categoryMap[targetCat]) {
        categoryMap[targetCat] = {
          rawCategory: targetCat,
          label: targetCat,
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
    });

    // 2. Aggregate each raw category from rawCategoryMap
    if (rawCategoryMap) {
      Object.keys(rawCategoryMap).forEach(rawCat => {
        const rawObj = rawCategoryMap[rawCat];
        if (!rawObj || rawObj.isTotal) return;

        // Electricity mapping
        const elecKey = `${rawCat}___elec`;
        const elecRule = mappingRules[elecKey];
        const elecTarget = elecRule ? (elecRule.userCategory || rawCat) : getDefaultCategoryMapping(rawCat, 'elec');
        if (!categoryMap[elecTarget]) {
          categoryMap[elecTarget] = {
            rawCategory: elecTarget,
            label: elecTarget,
            isTotal: false,
            elecKwh: 0, elecDemW: 0, gasTherm: 0, gasDemBtuh: 0,
            elecKbtu: 0, gasKbtu: 0, totalKbtu: 0
          };
        }
        categoryMap[elecTarget].elecKwh += (rawObj.elecKwh || 0);
        categoryMap[elecTarget].elecDemW += (rawObj.elecDemW || 0);

        // Natural Gas mapping
        const gasKey = `${rawCat}___gas`;
        const gasRule = mappingRules[gasKey];
        const gasTarget = gasRule ? (gasRule.userCategory || rawCat) : getDefaultCategoryMapping(rawCat, 'gas');
        if (!categoryMap[gasTarget]) {
          categoryMap[gasTarget] = {
            rawCategory: gasTarget,
            label: gasTarget,
            isTotal: false,
            elecKwh: 0, elecDemW: 0, gasTherm: 0, gasDemBtuh: 0,
            elecKbtu: 0, gasKbtu: 0, totalKbtu: 0
          };
        }
        categoryMap[gasTarget].gasTherm += (rawObj.gasTherm || 0);
        categoryMap[gasTarget].gasDemBtuh += (rawObj.gasDemBtuh || 0);
      });
    }

    // 3. Compute energy conversions
    Object.values(categoryMap).forEach(cat => {
      cat.elecKbtu = cat.elecKwh * CONVERSIONS.KWH_TO_KBTU;
      cat.gasKbtu = cat.gasTherm * CONVERSIONS.THERM_TO_KBTU;
      cat.totalKbtu = cat.elecKbtu + cat.gasKbtu;
    });

    return categoryMap;
  }

  // Fallback to static FIXED_CATEGORIES
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

    if (rawCategoryMap && rawCategoryMap[fc.raw] && !fc.elecHtmCategories.includes(fc.raw)) {
      const direct = rawCategoryMap[fc.raw];
      elecKwh += (direct.elecKwh || 0);
      elecDemW += (direct.elecDemW || 0);
      gasTherm += (direct.gasTherm || 0);
      gasDemBtuh += (direct.gasDemBtuh || 0);
    }

    const elecKbtu = elecKwh * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu = gasTherm * CONVERSIONS.THERM_TO_KBTU;

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

  // Loaded inputs
  loadedCsv: null,           // { file, name, text, scenarios, rows, mappings, colDefs, isThreeHeader }
  loadedFolder: null,        // { files, name, rawScenarios }
  loadedWorkbook: null,      // { file, name }
  loadedEuiComparisonWorkbook: null,
  currentEuiInfo: null,
  historicalEuiProjects: [],
  comparableFilteredProjects: [],
  comparableColumnFilters: {},
  comparableColumnRanges: {},
  comparableFilterPopupColumn: null,

  categoryMapping: {},       // { [rawCat___fuel]: { userCategory, locked, rawCategory, fuel, source } }
  visibleCategories: new Set(), // Set of active mapped categories to display in chart
  knownCategoryFilters: new Set(),

  rawScenarios: [],          // Original parsed scenarios from folder
  scenarios: [],             // All display scenarios (including Baseline Avg if enabled)
  baselineAvgScenario: null, // Computed Baseline Avg scenario
  selectedScenarios: [],     // Array of active scenario names
  baselineScenario: null,    // Baseline scenario name for variance calculations
  proposedScenario: null,
  scenarioSelectionMode: 'pair',
  selectedFolderName: '',    // Current project folder name
  buildingAreaType: 'conditioned',
  buildingArea: 0,
  electricityCostRate: 0.1013,
  naturalGasCostRate: 1.283,
  exportScenarioNames: new Set(),
  knownExportScenarioNames: new Set(),
  appendScenarioNames: new Set(),
  knownAppendScenarioNames: new Set(),

  // Mode 1 & 3: CSV and Append State
  loadedCsvRows: [],         // Array of raw CSV rows (header 1, header 2, data rows)
  baseCsvFilename: '',       // Filename of loaded base CSV
  isAppendedData: false,     // True if currently displaying appended data

  viewMode: 'compare',       // 'compare' | 'stacked'
  energySource: 'combined',  // 'combined' | 'electricity' | 'natural-gas'
  energyUnit: 'eui',         // 'kBtu' | 'eui' | 'eui-elec' | 'eui-gas' | 'kWh' | 'therm'
  chartType: 'bar',          // 'bar' | 'stacked-bar' | 'doughnut' | 'horizontalBar' | 'radar'

  hideZeroes: true,          // Hide zero rows (chart only)

  chartInstance: null,
  isServerOnline: false,
  csvExportDirHandle: null,  // FileSystemDirectoryHandle from showDirectoryPicker()
};

// =============================================================================
// DOM Elements
// =============================================================================
const elements = {
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),

  // Selection 1: Results CSV
  slotCsv: document.getElementById('slot-csv'),
  dropZoneCsv: document.getElementById('drop-zone-csv'),
  browserCsvInput: document.getElementById('browser-csv-input'),
  browseCsvBtn: document.getElementById('browse-csv-btn'),
  loadSampleCsvBtn: document.getElementById('load-sample-csv-btn'),
  csvStatusLabel: document.getElementById('csv-status-label'),
  clearCsvBtn: document.getElementById('clear-csv-btn'),

  // Selection 2: Model Run Folder
  slotFolder: document.getElementById('slot-folder'),
  dropZoneFolder: document.getElementById('drop-zone-folder'),
  browserFolderInput: document.getElementById('browser-folder-input'),
  browseFolderBtn: document.getElementById('browse-folder-btn'),
  loadSampleFolderBtn: document.getElementById('load-sample-folder-btn'),
  folderStatusLabel: document.getElementById('folder-status-label'),
  clearFolderBtn: document.getElementById('clear-folder-btn'),

  // Selection 3: CBECC Model Workbook
  slotCbeccWb: document.getElementById('slot-cbecc-wb'),
  dropZoneWb: document.getElementById('drop-zone-wb'),
  browserWbInput: document.getElementById('browser-wb-input'),
  browseWbBtn: document.getElementById('browse-wb-btn'),
  loadSampleWbBtn: document.getElementById('load-sample-wb-btn'),
  wbStatusLabel: document.getElementById('wb-status-label'),
  clearWbBtn: document.getElementById('clear-wb-btn'),

  // Selection 4: EUI Comparison Workbook
  slotEuiComp: document.getElementById('slot-eui-comp'),
  dropZoneEuiComp: document.getElementById('drop-zone-eui-comp'),
  browserEuiCompInput: document.getElementById('browser-eui-comp-input'),
  browseEuiCompBtn: document.getElementById('browse-eui-comp-btn'),
  euiCompStatusLabel: document.getElementById('eui-comp-status-label'),
  clearEuiCompBtn: document.getElementById('clear-eui-comp-btn'),
  comparableProjectCount: document.getElementById('comparable-project-count'),
  comparableProjectFilters: document.getElementById('comparable-project-filters'),
  comparableFilterPopup: null,
  comparableProjectStatus: document.getElementById('comparable-project-status'),
  comparableProjectTableWrap: document.getElementById('comparable-project-table-wrap'),
  comparableProjectTableHead: document.getElementById('comparable-project-table-head'),
  comparableProjectTableBody: document.getElementById('comparable-project-table-body'),

  unmappedWarning: document.getElementById('unmapped-warning'),
  scenarioAreas: document.getElementById('scenario-areas'),
  electricityCostRate: document.getElementById('electricity-cost-rate'),
  naturalGasCostRate: document.getElementById('natural-gas-cost-rate'),
  categoryMappingContainer: document.getElementById('category-mapping-container'),
  mappingStatusHint: document.getElementById('mapping-status-hint'),

  scenariosContainer: document.getElementById('scenarios-container'),
  pairScenarioControls: document.getElementById('pair-scenario-controls'),
  baselineCaseSelect: document.getElementById('baseline-case-select'),
  proposedCaseSelect: document.getElementById('proposed-case-select'),
  compareMultipleBtn: document.getElementById('compare-multiple-btn'),
  multiScenarioControls: document.getElementById('multi-scenario-controls'),
  multiBaselineSelect: document.getElementById('multi-baseline-select'),
  multiCaseDetails: document.getElementById('multi-case-details'),
  multiCaseSummary: document.getElementById('multi-case-summary'),
  multiCaseOptions: document.getElementById('multi-case-options'),
  pairScenarioBtn: document.getElementById('pair-scenario-btn'),
  pairSavingsDetails: document.getElementById('pair-savings-details'),
  pairSavingsSummary: document.getElementById('pair-savings-summary'),
  pairSavingsBody: document.getElementById('pair-savings-body'),
  pairSavingsTable: document.getElementById('pair-savings-table'),

  dashboardArea: document.getElementById('dashboard-area'),

  viewModeSelect: document.getElementById('view-mode-select'),
  energySourceSelect: document.getElementById('energy-source-select'),
  energyUnitSelect: document.getElementById('energy-unit-select'),
  chartTypeSelect: document.getElementById('chart-type-select'),

  hideZeroesToggle: document.getElementById('hide-zeroes-toggle'),

  // Chart Category Filter Controls
  categoryFilterOptions: document.getElementById('category-filter-options'),
  categoryFilterSummary: document.getElementById('category-filter-summary'),

  // Metric elements (guarded for backward compatibility)
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

  // CSV Export panel (Mode 2: Folder Only)
  csvExportSection: document.getElementById('csv-export-section'),
  csvExportFilename: document.getElementById('csv-export-filename'),
  csvExportLocation: document.getElementById('csv-export-location'),
  csvFilenamePreview: document.getElementById('csv-filename-preview'),
  csvRunId: document.getElementById('csv-run-id'),
  csvRevision: document.getElementById('csv-revision'),
  csvExportOptions: document.getElementById('csv-export-options'),
  csvExportSummary: document.getElementById('csv-export-summary'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  csvBrowseFolderBtn: document.getElementById('csv-browse-folder-btn'),
  csvLocationStatus: document.getElementById('csv-location-status'),

  // CSV Append panel (Mode 3: Both CSV + Folder)
  csvAppendSection: document.getElementById('csv-append-section'),
  appendTargetCsvName: document.getElementById('append-target-csv-name'),
  appendScenarioOptions: document.getElementById('append-scenario-options'),
  appendScenarioSummary: document.getElementById('append-scenario-summary'),
  appendExportFilename: document.getElementById('append-export-filename'),
  appendExportLocation: document.getElementById('append-export-location'),
  appendDownloadCsvBtn: document.getElementById('append-download-csv-btn'),
  appendRunId: document.getElementById('append-run-id') || document.getElementById('csv-run-id'),
  appendRevision: document.getElementById('append-revision') || document.getElementById('csv-revision'),

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
  let gasEnergyIdx = -1;
  let gasDemandIdx = -1;

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
  if (gasEnergyIdx === -1) gasEnergyIdx = 3;
  if (gasDemandIdx === -1) gasDemandIdx = 4;

  // Build a lookup map: rawCategory -> data object
  // Build a lookup map: rawCategory -> data object from HTM table
  const rawCategoryMap = {};

  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.textContent.trim());
    if (cells.length === 0 || !cells[0]) continue;

    const catLabel = cells[0];
    const elecKwh = parseNumber(cells[elecEnergyIdx]);
    const elecDemW = parseNumber(cells[elecDemandIdx]);
    const gasTherm = parseNumber(cells[gasEnergyIdx]);
    const gasDemBtuh = parseNumber(cells[gasDemandIdx]);
    const isTotal = catLabel.toLowerCase().includes('total');

    const elecKbtu = elecKwh * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu = gasTherm * CONVERSIONS.THERM_TO_KBTU;

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
      totalElecKwh += r.elecKwh;
      totalGasTherm += r.gasTherm;
    }
  });

  const totalElecKbtu = totalElecKwh * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
  const grandTotalKbtu = totalElecKbtu + totalGasKbtu;

  return {
    sourceName,
    ...areas,
    categoryMap,
    rawCategoryMap,
    unmappedCategories,
    summary: {
      totalElectricity_kWh: totalElecKwh,
      totalNaturalGas_therm: totalGasTherm,
      totalElectricity_kBtu: totalElecKbtu,
      totalNaturalGas_kBtu: totalGasKbtu,
      grandTotal_kBtu: grandTotalKbtu,
      electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
      naturalGasSharePercent: grandTotalKbtu > 0 ? (totalGasKbtu / grandTotalKbtu) * 100 : 0,
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

const ENERGY_UNITS_BY_SOURCE = {
  combined: [
    { value: 'kBtu', label: 'kBtu' },
    { value: 'eui', label: 'kBtu/ft²' },
  ],
  electricity: [
    { value: 'kWh', label: 'kWh' },
    { value: 'eui-elec', label: 'kBtu/ft²' },
  ],
  'natural-gas': [
    { value: 'therm', label: 'therm' },
    { value: 'eui-gas', label: 'kBtu/ft²' },
  ],
};

function getDisplayUnitLabel() {
  if (state.energyUnit === 'eui') return 'kBtu/ft2 (Total Combined)';
  if (state.energyUnit === 'eui-elec') return 'kBtu/ft2 (Electricity)';
  if (state.energyUnit === 'eui-gas') return 'kBtu/ft2 (Natural Gas)';
  if (state.energyUnit === 'kWh') return 'kWh (Electricity)';
  if (state.energyUnit === 'therm') return 'therm (Natural Gas)';
  return 'kBtu (Total Combined)';
}

function getScenarioCategoryEnergyValue(sc, catData) {
  if (!catData) return 0;
  if (state.energyUnit === 'eui') {
    return sc.buildingArea > 0 ? (catData.totalKbtu || 0) / sc.buildingArea : 0;
  }
  if (state.energyUnit === 'eui-elec') {
    return sc.buildingArea > 0 ? (catData.elecKbtu || 0) / sc.buildingArea : 0;
  }
  if (state.energyUnit === 'eui-gas') {
    return sc.buildingArea > 0 ? (catData.gasKbtu || 0) / sc.buildingArea : 0;
  }
  if (state.energyUnit === 'kWh') return catData.elecKwh || 0;
  if (state.energyUnit === 'therm') return catData.gasTherm || 0;
  return catData.totalKbtu || 0;
}

function getScenarioEnergyValue(sc, unit = state.energyUnit) {
  if (unit === 'eui') return sc.buildingArea > 0 ? sc.summary.grandTotal_kBtu / sc.buildingArea : 0;
  if (unit === 'eui-elec') return sc.buildingArea > 0 ? sc.summary.totalElectricity_kBtu / sc.buildingArea : 0;
  if (unit === 'eui-gas') return sc.buildingArea > 0 ? sc.summary.totalNaturalGas_kBtu / sc.buildingArea : 0;
  if (unit === 'kWh') return sc.summary.totalElectricity_kWh;
  if (unit === 'therm') return sc.summary.totalNaturalGas_therm;
  return sc.summary.grandTotal_kBtu;
}

// =============================================================================
// Export Section Visibility
// - Only Results CSV: hide both export sections
// - Only Run Folder: show "Export to CSV Log"
// - Both CSV and Run Folder: show "Append Scenarios to CSV Log"
// =============================================================================

function getScenarioExportWeight(scenario) {
  const name = (scenario.rawScenarioName || scenario.scenarioName || '').toLowerCase().trim();
  if (name === 'ap' || name.endsWith('_ap')) return 1;
  if (name === 'ab1' || name.endsWith('_ab1')) return 2;
  if (name === 'ab2' || name.endsWith('_ab2')) return 3;
  if (name === 'ab3' || name.endsWith('_ab3')) return 4;
  if (name === 'ab4' || name.endsWith('_ab4')) return 5;
  if (name.includes('baseline avg') || name === 'ab_avg' || name.endsWith('_ab_avg')) return 6;
  return 10;
}

function sortScenariosForExport(scenarios) {
  return [...scenarios].sort((a, b) => {
    const runOrder = (a.runId || '').localeCompare(b.runId || '', undefined, { numeric: true });
    if (runOrder !== 0) return runOrder;
    const rankOrder = getScenarioExportWeight(a) - getScenarioExportWeight(b);
    return rankOrder || a.scenarioName.localeCompare(b.scenarioName);
  });
}

function renderScenarioCheckboxDropdown(container, summary, scenarios, selectedNames, knownNames, checkboxClass) {
  if (!container || !summary) return;
  const orderedScenarios = sortScenariosForExport(scenarios);
  const availableNames = new Set(orderedScenarios.map(scenario => scenario.scenarioName));

  knownNames.forEach(name => {
    if (!availableNames.has(name)) {
      knownNames.delete(name);
      selectedNames.delete(name);
    }
  });
  orderedScenarios.forEach(scenario => {
    if (!knownNames.has(scenario.scenarioName)) selectedNames.add(scenario.scenarioName);
    knownNames.add(scenario.scenarioName);
  });

  container.replaceChildren(...orderedScenarios.map((scenario, index) => {
    const label = document.createElement('label');
    label.className = 'multi-case-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = checkboxClass;
    checkbox.value = scenario.scenarioName;
    checkbox.checked = selectedNames.has(scenario.scenarioName);
    checkbox.dataset.index = String(index);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedNames.add(scenario.scenarioName);
      else selectedNames.delete(scenario.scenarioName);
      renderScenarioCheckboxSummary(summary, orderedScenarios, selectedNames);
    });
    label.append(checkbox, document.createTextNode(scenario.scenarioName));
    return label;
  }));
  renderScenarioCheckboxSummary(summary, orderedScenarios, selectedNames);
}

function renderScenarioCheckboxSummary(summary, scenarios, selectedNames) {
  const selected = sortScenariosForExport(scenarios.filter(scenario =>
    selectedNames.has(scenario.scenarioName)
  ));
  summary.textContent = !scenarios.length
    ? 'No scenarios available'
    : selected.length === scenarios.length
    ? 'All scenarios'
    : selected.length
      ? selected.map(scenario => scenario.scenarioName).join(', ')
      : 'No scenarios selected';
}

function getAppendScenarioList() {
  const folderScenarios = (state.loadedFolder && state.loadedFolder.rawScenarios) || [];
  if (!folderScenarios.length) return [];

  const folderScenarioSet = new Set(folderScenarios);
  const folderRunKeys = new Set(folderScenarios.map(scenario =>
    (scenario.runId && scenario.revision) ? `${scenario.runId}_${scenario.revision}` : (scenario.runId || 'default')
  ));
  const csvScenarioNames = new Set((state.loadedCsv && state.loadedCsv.scenarios || [])
    .map(scenario => scenario.scenarioName));
  const runScenarios = state.scenarios.filter(scenario =>
    folderScenarioSet.has(scenario) || (
      scenario.isCalculatedAverage &&
      !csvScenarioNames.has(scenario.scenarioName) &&
      folderRunKeys.has((scenario.runId && scenario.revision)
        ? `${scenario.runId}_${scenario.revision}`
        : (scenario.runId || 'default'))
    )
  );
  return sortScenariosForExport(runScenarios.length ? runScenarios : folderScenarios);
}

function renderCsvExportOptions() {
  renderScenarioCheckboxDropdown(
    elements.csvExportOptions,
    elements.csvExportSummary,
    state.scenarios,
    state.exportScenarioNames,
    state.knownExportScenarioNames,
    'csv-export-scenario-cb'
  );
}

function updateExportSectionsVisibility() {
  const hasCsv = !!state.loadedCsv;
  const hasFolder = !!(state.loadedFolder && state.rawScenarios && state.rawScenarios.length > 0);

  if (elements.csvExportSection) elements.csvExportSection.classList.add('hidden');
  if (elements.csvAppendSection) elements.csvAppendSection.classList.add('hidden');

  if (hasCsv && hasFolder) {
    state.activeIngestionMethod = 3;
    if (elements.csvAppendSection) {
      elements.csvAppendSection.classList.remove('hidden');
      if (elements.appendTargetCsvName) {
        elements.appendTargetCsvName.textContent = state.loadedCsv.name || 'Results.csv';
      }
      renderAppendChecklist();
    }
  } else if (hasFolder) {
    state.activeIngestionMethod = 2;
    if (elements.csvExportSection) {
      elements.csvExportSection.classList.remove('hidden');
    }
    renderCsvExportOptions();
  } else if (hasCsv) {
    state.activeIngestionMethod = 1;
  }
}

// =============================================================================
// CSV Parsing: Dynamic Header & Multi-scenario Results.csv Reader
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

  // Detect 3-header vs 2-header format
  let headerRow0 = null;
  let headerRow1 = null;
  let headerRow2 = null;
  let dataStartIdx = 3;

  if (rows[1] && rows[1][0] && rows[1][0].trim().toLowerCase() === 'run id') {
    // 3-header format (Row 0: User Cats, Row 1: Raw Cats, Row 2: Units)
    headerRow0 = rows[0];
    headerRow1 = rows[1];
    headerRow2 = rows[2];
    dataStartIdx = 3;
  } else if (rows[0] && rows[0][0] && rows[0][0].trim().toLowerCase() === 'run id') {
    // 2-header format
    headerRow0 = [];
    headerRow1 = rows[0];
    headerRow2 = rows[1];
    dataStartIdx = 2;
  } else {
    const row2Text = (rows[2] || []).join(' ');
    if (row2Text.includes('[kWh]') || row2Text.includes('[W]') || row2Text.includes('[therm]')) {
      headerRow0 = rows[0];
      headerRow1 = rows[1];
      headerRow2 = rows[2];
      dataStartIdx = 3;
    } else {
      headerRow0 = [];
      headerRow1 = rows[0];
      headerRow2 = rows[1];
      dataStartIdx = 2;
    }
  }

  // Detect column locations
  let runIdCol = 0;
  let revCol = 1;
  let scenarioCol = 2;
  let areaCol = -1;

  for (let c = 0; c < Math.min(6, headerRow1.length); c++) {
    const text1 = (headerRow1[c] || '').toLowerCase();
    const text0 = (headerRow0 && headerRow0[c] ? headerRow0[c] : '').toLowerCase();
    if (text1.includes('scenario')) scenarioCol = c;
    if (text1.includes('building area') || text0.includes('building area')) areaCol = c;
  }

  const energyStartCol = areaCol >= 0 ? areaCol + 1 : (scenarioCol + 1);

  // Discover all energy column pairs from headerRow2
  const colDefs = [];
  const mappings = {};

  for (let c = energyStartCol; c < headerRow2.length; c++) {
    const unit = (headerRow2[c] || '').trim();
    if (unit === '[kWh]' || unit === '[therm]') {
      const isElec = unit === '[kWh]';
      const demandCol = (c + 1 < headerRow2.length) ? c + 1 : -1;
      const rawCat = (headerRow1[c] || '').trim() || (headerRow1[c - 1] || '').trim();
      const userCat = (headerRow0 && headerRow0[c] ? headerRow0[c].trim() : '') ||
        (headerRow0 && headerRow0[c - 1] ? headerRow0[c - 1].trim() : '') ||
        getDefaultCategoryMapping(rawCat, isElec ? 'elec' : 'gas');

      colDefs.push({
        energyCol: c,
        demandCol,
        isElec,
        fuel: isElec ? 'elec' : 'gas',
        rawCat,
        userCat
      });

      const key = `${rawCat}___${isElec ? 'elec' : 'gas'}`;
      mappings[key] = {
        rawCategory: rawCat,
        fuel: isElec ? 'elec' : 'gas',
        userCategory: userCat,
        locked: true,
        source: 'csv'
      };
    }
  }

  // Fallback to legacy fixed columns if no units recognised
  if (colDefs.length === 0) {
    CSV_ELECS.forEach((catRaw, idx) => {
      const kwhCol = energyStartCol + (idx * 2);
      const wCol = energyStartCol + 1 + (idx * 2);
      colDefs.push({ energyCol: kwhCol, demandCol: wCol, isElec: true, fuel: 'elec', rawCat: catRaw, userCat: getDefaultCategoryMapping(catRaw, 'elec') });
      mappings[`${catRaw}___elec`] = { rawCategory: catRaw, fuel: 'elec', userCategory: getDefaultCategoryMapping(catRaw, 'elec'), locked: true, source: 'csv' };
    });
    CSV_GASES.forEach((catRaw, idx) => {
      const thermCol = energyStartCol + 52 + (idx * 2);
      const btuhCol = energyStartCol + 53 + (idx * 2);
      colDefs.push({ energyCol: thermCol, demandCol: btuhCol, isElec: false, fuel: 'gas', rawCat: catRaw, userCat: getDefaultCategoryMapping(catRaw, 'gas') });
      mappings[`${catRaw}___gas`] = { rawCategory: catRaw, fuel: 'gas', userCategory: getDefaultCategoryMapping(catRaw, 'gas'), locked: true, source: 'csv' };
    });
  }

  const scenarios = [];

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= scenarioCol || !row[scenarioCol]) continue;

    const runId = (row[runIdCol] || 'Run_01').trim();
    const rev = (row[revCol] || 'Rev.0').trim();
    const rawScenario = row[scenarioCol].trim();
    const buildingArea = areaCol >= 0 && areaCol < row.length ? parseNumber(row[areaCol]) : 0;
    const scenarioName = formatCompositeName ? `${runId}_${rev}_${rawScenario}` : rawScenario;

    const rawCategoryMap = {};

    colDefs.forEach(def => {
      const energyVal = def.energyCol < row.length ? parseNumber(row[def.energyCol]) : 0;
      const demandVal = def.demandCol >= 0 && def.demandCol < row.length ? parseNumber(row[def.demandCol]) : 0;

      if (!rawCategoryMap[def.rawCat]) {
        rawCategoryMap[def.rawCat] = {
          rawCategory: def.rawCat,
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

      if (def.isElec) {
        rawCategoryMap[def.rawCat].elecKwh = energyVal;
        rawCategoryMap[def.rawCat].elecDemW = demandVal;
        rawCategoryMap[def.rawCat].elecKbtu = energyVal * CONVERSIONS.KWH_TO_KBTU;
      } else {
        rawCategoryMap[def.rawCat].gasTherm = energyVal;
        rawCategoryMap[def.rawCat].gasDemBtuh = demandVal;
        rawCategoryMap[def.rawCat].gasKbtu = energyVal * CONVERSIONS.THERM_TO_KBTU;
      }
      rawCategoryMap[def.rawCat].totalKbtu = (rawCategoryMap[def.rawCat].elecKbtu || 0) + (rawCategoryMap[def.rawCat].gasKbtu || 0);
    });

    const categoryMap = buildDashboardCategoryMap(rawCategoryMap, mappings);

    let totalElecKwh = 0;
    let totalGasTherm = 0;
    Object.values(categoryMap).forEach(c => {
      totalElecKwh += c.elecKwh;
      totalGasTherm += c.gasTherm;
    });

    const totalElecKbtu = totalElecKwh * CONVERSIONS.KWH_TO_KBTU;
    const totalGasKbtu = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
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
      totalBuildingArea: buildingArea,
      netConditionedBuildingArea: buildingArea,
      buildingArea,
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

  return { success: true, scenarios, rows, mappings, colDefs, isThreeHeader: dataStartIdx === 3 };
}

// =============================================================================
// Category Mapping Synchronization & UI
// =============================================================================

function syncCategoryMappings(scenarios, isCsvSource = false) {
  scenarios.forEach(sc => {
    const rawMap = sc.rawCategoryMap || {};
    Object.keys(rawMap).forEach(rawCat => {
      const r = rawMap[rawCat];
      if (!r || r.isTotal) return;

      if (r.elecKwh > 0 || r.elecDemW > 0) {
        const key = `${rawCat}___elec`;
        if (!state.categoryMapping[key]) {
          state.categoryMapping[key] = {
            rawCategory: rawCat,
            fuel: 'elec',
            userCategory: getDefaultCategoryMapping(rawCat, 'elec'),
            locked: isCsvSource,
            source: isCsvSource ? 'csv' : 'folder'
          };
        }
      }

      if (r.gasTherm > 0 || r.gasDemBtuh > 0) {
        const key = `${rawCat}___gas`;
        if (!state.categoryMapping[key]) {
          state.categoryMapping[key] = {
            rawCategory: rawCat,
            fuel: 'gas',
            userCategory: getDefaultCategoryMapping(rawCat, 'gas'),
            locked: isCsvSource,
            source: isCsvSource ? 'csv' : 'folder'
          };
        }
      }
    });
  });

  recomputeAllScenarioCategories();
  renderCategoryMappingUI();
  renderCategoryFilterOptions();
}

function recomputeAllScenarioCategories() {
  state.scenarios.forEach(sc => {
    sc.categoryMap = buildDashboardCategoryMap(sc.rawCategoryMap, state.categoryMapping);

    let totalElecKwh = 0;
    let totalGasTherm = 0;
    Object.values(sc.categoryMap).forEach(c => {
      totalElecKwh += c.elecKwh;
      totalGasTherm += c.gasTherm;
    });

    const totalElecKbtu = totalElecKwh * CONVERSIONS.KWH_TO_KBTU;
    const totalGasKbtu = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
    const grandTotalKbtu = totalElecKbtu + totalGasKbtu;

    sc.summary = {
      totalElectricity_kWh: totalElecKwh,
      totalNaturalGas_therm: totalGasTherm,
      totalElectricity_kBtu: totalElecKbtu,
      totalNaturalGas_kBtu: totalGasKbtu,
      grandTotal_kBtu: grandTotalKbtu,
      electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
      naturalGasSharePercent: grandTotalKbtu > 0 ? (totalGasKbtu / grandTotalKbtu) * 100 : 0,
    };
  });

  updateDashboard();
}

function renderCategoryMappingUI() {
  const container = document.getElementById('category-mapping-container');
  if (!container) return;

  const keys = Object.keys(state.categoryMapping);
  if (keys.length === 0) {
    container.innerHTML = '<div class="empty-hint" style="padding:16px;text-align:center;font-size:0.82rem;color:var(--text-secondary);">No non-zero categories detected yet. Load a Results CSV or Model Run Folder.</div>';
    return;
  }

  // Sort keys: electricity first, then natural gas, then by raw category.
  keys.sort((a, b) => {
    const ruleA = state.categoryMapping[a];
    const ruleB = state.categoryMapping[b];
    if (ruleA.fuel !== ruleB.fuel) return ruleA.fuel === 'elec' ? -1 : 1;
    return compareEndUseCategories(ruleA.userCategory, ruleB.userCategory) ||
      ruleA.rawCategory.localeCompare(ruleB.rawCategory);
  });

  let html = '';
  keys.forEach(k => {
    const rule = state.categoryMapping[k];
    const isElec = rule.fuel === 'elec';
    const fuelBadge = isElec
      ? '<span class="fuel-badge elec">⚡ Electricity</span>'
      : '<span class="fuel-badge gas">🔥 Natural Gas</span>';

    let targetControl = '';
    if (rule.locked) {
      targetControl = `<span class="mapping-locked-badge" title="Defined in Results CSV"><span class="lock-icon">🔒</span> ${rule.userCategory}</span>`;
    } else {
      const optionsHtml = STANDARD_MAPPED_CATEGORIES.map(cat => {
        const selected = cat.toLowerCase() === (rule.userCategory || '').toLowerCase() ? 'selected' : '';
        return `<option value="${cat}" ${selected}>${cat}</option>`;
      }).join('');

      const isCustom = !STANDARD_MAPPED_CATEGORIES.some(cat => cat.toLowerCase() === (rule.userCategory || '').toLowerCase());
      const customOption = isCustom ? `<option value="${rule.userCategory}" selected>${rule.userCategory} (Custom)</option>` : '';

      targetControl = `
        <select class="mapping-select" data-key="${k}">
          ${optionsHtml}
          ${customOption}
        </select>
      `;
    }

    html += `
      <div class="mapping-row" data-key="${k}">
        <div class="mapping-raw-group">
          ${fuelBadge}
          <span class="mapping-raw-name" title="${rule.rawCategory}">${rule.rawCategory}</span>
        </div>
        <div class="mapping-target-group">
          ${targetControl}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.mapping-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const key = e.target.getAttribute('data-key');
      const newCat = e.target.value;
      if (state.categoryMapping[key]) {
        state.categoryMapping[key].userCategory = newCat;
        recomputeAllScenarioCategories();
      }
    });
  });
}

function renderCategoryFilterOptions() {
  const container = elements.categoryFilterOptions;
  if (!container) return;

  const catSet = new Set();
  state.scenarios.forEach(sc => {
    if (sc.categoryMap) {
      Object.keys(sc.categoryMap).forEach(cat => catSet.add(cat));
    }
  });

  const allCats = sortEndUseCategories(Array.from(catSet));
  allCats.forEach(cat => {
    if (!state.knownCategoryFilters.has(cat)) {
      state.visibleCategories.add(cat);
      state.knownCategoryFilters.add(cat);
    }
  });

  if (allCats.length === 0) {
    container.replaceChildren();
    elements.categoryFilterSummary.textContent = 'No categories available';
    return;
  }

  container.replaceChildren(...allCats.map(cat => {
    const option = document.createElement('label');
    option.className = 'multi-case-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.visibleCategories.has(cat);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.visibleCategories.add(cat);
      else state.visibleCategories.delete(cat);
      renderCategoryFilterOptions();
      updateDashboard();
    });
    option.append(checkbox, document.createTextNode(cat));
    return option;
  }));

  const selectedCats = allCats.filter(cat => state.visibleCategories.has(cat));
  elements.categoryFilterSummary.textContent = selectedCats.length === allCats.length
    ? 'All categories'
    : selectedCats.length
      ? selectedCats.join(', ')
      : 'No categories selected';
}

function normalizeWorkbookHeader(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function workbookNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/%$/, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function buildWorkbookHeaderMap(headerRow) {
  const headers = new Map();
  headerRow.forEach((value, index) => {
    const key = normalizeWorkbookHeader(value);
    if (key && !headers.has(key)) headers.set(key, index);
  });
  return headers;
}

function requireWorkbookColumn(headerMap, header, aliases = []) {
  const index = [header, ...aliases]
    .map(candidate => headerMap.get(normalizeWorkbookHeader(candidate)))
    .find(candidate => candidate !== undefined);
  if (index === undefined) throw new Error(`Missing required column "${header}"`);
  return index;
}

async function readWorkbookRows(file, sheetName) {
  if (typeof XLSX === 'undefined') throw new Error('The Excel workbook parser is unavailable.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`Workbook does not contain a "${sheetName}" worksheet.`);
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });
}

async function parseCurrentProjectEuiInfo(file) {
  const rows = await readWorkbookRows(file, 'EUI Comp Info');
  if (rows.length < 5) throw new Error('The "EUI Comp Info" worksheet does not contain baseline and proposed rows.');
  const headerMap = buildWorkbookHeaderMap(rows[1] || []);
  const columns = {
    totalConditionedFloorArea: requireWorkbookColumn(headerMap, 'Conditioned  Floor Area'),
    unitCount: requireWorkbookColumn(headerMap, '# of units'),
    peoplePer1000: requireWorkbookColumn(headerMap, 'Ppl per 1000ft2'),
    resOaStatic: requireWorkbookColumn(headerMap, 'Res OA (Static)'),
    corridorOa: requireWorkbookColumn(headerMap, 'Corridor OA'),
    averageUnitArea: requireWorkbookColumn(headerMap, 'Average Unit Area'),
    conditionedAreaToTotalAreaRatio: requireWorkbookColumn(headerMap, 'Conditioned Area to Total Area Ratio'),
    verticalSkinToFloorRatio: requireWorkbookColumn(headerMap, 'Vertical Skin to Floor Ratio'),
    windowsToFloorRatio: requireWorkbookColumn(headerMap, 'Windows to Floor Ratio'),
    totalWindowsToWallRatio: requireWorkbookColumn(headerMap, 'Total Windows to Wall Ratio'),
    residentialWindowsToWallRatio: requireWorkbookColumn(headerMap, 'Residential Windows to Wall Ratio')
  };
  const projectRows = new Map();
  rows.slice(3, 5).forEach(row => {
    const role = normalizeWorkbookHeader(row[0]);
    if (role !== 'baseline' && role !== 'proposed') return;
    projectRows.set(role, Object.fromEntries(
      Object.entries(columns).map(([key, index]) => [key, workbookNumber(row[index])])
    ));
  });
  if (!projectRows.size) throw new Error('No Baseline or Proposed project rows were found.');
  return projectRows;
}

function parseHistoricalEuiProjects(rows) {
  if (rows.length < 7) throw new Error('The "Project Summary - New" worksheet does not contain project records.');
  const headerMap = buildWorkbookHeaderMap(rows[4] || []);
  const columns = {
    projectCode: requireWorkbookColumn(headerMap, 'Project Code #'),
    simulationRun: requireWorkbookColumn(headerMap, 'Simulation Run'),
    projectType: requireWorkbookColumn(headerMap, 'Project Type'),
    residentialHeatingType: requireWorkbookColumn(headerMap, 'Residential Heating Type'),
    residentialCoolingType: requireWorkbookColumn(headerMap, 'Residential Cooling Type'),
    residentialVentilationType: requireWorkbookColumn(headerMap, 'Residential Ventilation Type'),
    corridorHeatingType: requireWorkbookColumn(headerMap, 'Corridor Heating Type'),
    corridorVentilationType: requireWorkbookColumn(headerMap, 'Corridor Ventilation Type'),
    waterHeatingType: requireWorkbookColumn(headerMap, 'Water Heating Type'),
    totalConditionedFloorArea: requireWorkbookColumn(headerMap, 'Total Conditioned Floor Area', ['Conditioned Floor Area']),
    averageUnitArea: requireWorkbookColumn(headerMap, 'Average Unit Area'),
    conditionedAreaToTotalAreaRatio: requireWorkbookColumn(headerMap, 'Conditioned Area to Total Area Ratio'),
    verticalSkinToFloorRatio: requireWorkbookColumn(headerMap, 'Vertical Skin to Floor Ratio'),
    windowsToFloorRatio: requireWorkbookColumn(headerMap, 'Windows to Floor Ratio'),
    totalWindowsToWallRatio: requireWorkbookColumn(headerMap, 'Total Windows to Wall Ratio'),
    residentialWindowsToWallRatio: requireWorkbookColumn(headerMap, 'Residential Windows to Wall Ratio'),
    unitCount: requireWorkbookColumn(headerMap, '# of units'),
    peoplePer1000: requireWorkbookColumn(headerMap, 'Ppl per 1000ft2'),
    resOaStatic: requireWorkbookColumn(headerMap, 'Res OA (Static)'),
    corridorOa: requireWorkbookColumn(headerMap, 'Corridor OA')
  };
  const categoryHeaders = rows[4] || [];
  const energyColumns = [
    ...Array.from({ length: 12 }, (_, offset) => 48 + offset),
    ...Array.from({ length: 12 }, (_, offset) => 61 + offset)
  ].map(index => ({
    index,
    fuel: index <= 59 ? 'elec' : 'gas',
    category: String(categoryHeaders[index] || '').trim()
  })).filter(column => column.category &&
    !['total electric', 'total gas'].includes(normalizeWorkbookHeader(column.category)));

  if (energyColumns.length === 0) throw new Error('No end-use energy columns were found in AW:BU.');

  return rows.slice(6).flatMap(row => {
    const projectCode = row[columns.projectCode];
    const simulationRun = row[columns.simulationRun];
    if (projectCode === null || projectCode === undefined || simulationRun === null || simulationRun === undefined) return [];

    const project = {};
    Object.entries(columns).forEach(([key, index]) => {
      project[key] = ['projectCode', 'simulationRun', 'projectType', 'residentialHeatingType',
        'residentialCoolingType', 'residentialVentilationType', 'corridorHeatingType',
        'corridorVentilationType', 'waterHeatingType'].includes(key)
        ? String(row[index] ?? '').trim()
        : workbookNumber(row[index]);
    });

    const categoryMap = {};
    energyColumns.forEach(({ index, fuel, category }) => {
      const target = normalizeWorkbookHeader(category) === 'hp aux' ? 'Space Heating' : category;
      if (!categoryMap[target]) {
        categoryMap[target] = {
          rawCategory: target, label: target, isTotal: false,
          elecKwh: 0, gasTherm: 0, elecKbtu: 0, gasKbtu: 0, totalKbtu: 0
        };
      }
      const value = workbookNumber(row[index]) || 0;
      if (fuel === 'elec') categoryMap[target].elecKbtu += value;
      else categoryMap[target].gasKbtu += value;
    });
    Object.values(categoryMap).forEach(category => {
      category.totalKbtu = category.elecKbtu + category.gasKbtu;
      category.elecKwh = category.elecKbtu / CONVERSIONS.KWH_TO_KBTU;
      category.gasTherm = category.gasKbtu / CONVERSIONS.THERM_TO_KBTU;
    });

    const area = project.totalConditionedFloorArea;
    project.categoryMap = categoryMap;
    project.totalEui = area > 0
      ? Object.values(categoryMap).reduce((sum, category) => sum + category.totalKbtu, 0) / area
      : null;
    return [project];
  });
}

function createComparableFilterControls() {
  elements.comparableProjectFilters.replaceChildren(...COMPARABLE_PROJECT_FILTERS.map(filter => {
    const wrapper = document.createElement('label');
    wrapper.className = 'comparable-filter-field';
    wrapper.htmlFor = `comparable-filter-${filter.key}`;
    const label = document.createElement('span');
    label.textContent = `${filter.label}${filter.key === 'projectType' ? ' *' : ''}`;
    const select = document.createElement('select');
    select.id = `comparable-filter-${filter.key}`;
    select.dataset.filterKey = filter.key;
    select.className = 'select-dropdown';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = filter.key === 'projectType' ? 'Select Project Type' : 'Any';
    select.append(placeholder);
    filter.options.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    wrapper.append(label, select);
    return wrapper;
  }));
  elements.comparableFilterPopup = document.createElement('div');
  elements.comparableFilterPopup.className = 'comparable-filter-popup hidden';
  elements.comparableFilterPopup.setAttribute('role', 'group');
  elements.comparableFilterPopup.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-comparable-filter-value]');
    if (!checkbox || !state.comparableFilterPopupColumn) return;
    const columnKey = state.comparableFilterPopupColumn;
    const allOptionKeys = getComparableFilterOptions(columnKey).map(value =>
      getComparableFilterValueKey(value, columnKey)
    );
    const selected = new Set(
      state.comparableColumnFilters[columnKey] ||
      allOptionKeys
    );
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    if (allOptionKeys.every(key => selected.has(key)) && selected.size === allOptionKeys.length) {
      delete state.comparableColumnFilters[columnKey];
    } else {
      state.comparableColumnFilters[columnKey] = selected;
    }
    updateComparableProjectView();
  });
  elements.comparableFilterPopup.addEventListener('input', event => {
    if (event.target.matches('.comparable-filter-search')) {
      filterComparablePopupOptions(event.target.value);
    } else if (event.target.matches('[data-comparable-range-bound]') &&
        state.comparableFilterPopupColumn) {
      const columnKey = state.comparableFilterPopupColumn;
      state.comparableColumnRanges[columnKey] = {
        ...state.comparableColumnRanges[columnKey],
        [event.target.dataset.comparableRangeBound]: event.target.value
      };
      updateComparableProjectView();
    }
  });
  elements.comparableFilterPopup.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });
  document.body.append(elements.comparableFilterPopup);
}

function getComparableFilterValue(key) {
  return document.getElementById(`comparable-filter-${key}`)?.value || '';
}

function filterHistoricalProjects(projects, excludedColumnKey = null) {
  const projectType = getComparableFilterValue('projectType');
  return projects.filter(project => {
    if (project.projectType !== projectType) return false;
    if (COMPARABLE_PROJECT_FILTERS.some(filter =>
      filter.key !== 'projectType' && getComparableFilterValue(filter.key) &&
      project[filter.key] !== getComparableFilterValue(filter.key)
    )) return false;

    for (const column of COMPARABLE_PROJECT_COLUMNS) {
      if (column.key === excludedColumnKey) continue;
      const selected = state.comparableColumnFilters[column.key];
      if (selected && !selected.has(getComparableFilterValueKey(project[column.key], column.key))) {
        return false;
      }
      if (!isComparableTextFilterColumn(column.key)) {
        const range = state.comparableColumnRanges[column.key];
        const value = project[column.key];
        if (range?.min !== undefined && range.min !== '' &&
            (typeof value !== 'number' || value < Number(range.min))) return false;
        if (range?.max !== undefined && range.max !== '' &&
            (typeof value !== 'number' || value > Number(range.max))) return false;
      }
    }
    return true;
  });
}

function isComparableTextFilterColumn(columnKey) {
  return columnKey === 'projectCode' || columnKey === 'simulationRun';
}

function getComparableColumnDecimals(columnKey) {
  if (['totalConditionedFloorArea', 'averageUnitArea', 'unitCount'].includes(columnKey)) return 0;
  return columnKey === 'totalEui' ? 1 : 3;
}

function getComparableFilterValueKey(value, columnKey) {
  if (value === null || value === undefined || value === '') return '__blank__';
  if (typeof value === 'number') return `number:${formatNum(value, getComparableColumnDecimals(columnKey))}`;
  return `text:${String(value)}`;
}

function formatComparableFilterOption(value, columnKey) {
  if (value === null || value === undefined || value === '') return '(Blanks)';
  if (typeof value === 'number') return formatComparableValue(value, getComparableColumnDecimals(columnKey));
  return String(value);
}

function compareComparableFilterValues(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : -1;
  if (b === null || b === undefined || b === '') return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function getComparableFilterOptions(columnKey) {
  const projects = filterHistoricalProjects(state.historicalEuiProjects, columnKey);
  const values = new Map();
  projects.forEach(project => {
    const value = project[columnKey];
    values.set(getComparableFilterValueKey(value, columnKey), value);
  });
  (state.comparableColumnFilters[columnKey] || []).forEach(key => {
    if (values.has(key)) return;
    const selectedProject = state.historicalEuiProjects.find(project =>
      getComparableFilterValueKey(project[columnKey], columnKey) === key
    );
    if (selectedProject) values.set(key, selectedProject[columnKey]);
  });
  return Array.from(values.values()).sort(compareComparableFilterValues);
}

function filterComparablePopupOptions(query) {
  const normalizedQuery = query.trim().toLowerCase();
  elements.comparableFilterPopup.querySelectorAll('.comparable-filter-option').forEach(option => {
    option.classList.toggle('hidden', normalizedQuery && !option.dataset.searchText.includes(normalizedQuery));
  });
}

function positionComparableFilterPopup(button) {
  const popup = elements.comparableFilterPopup;
  const bounds = button.getBoundingClientRect();
  popup.classList.remove('hidden');
  const popupBounds = popup.getBoundingClientRect();
  const left = Math.max(8, Math.min(bounds.left, window.innerWidth - popupBounds.width - 8));
  const top = Math.min(bounds.bottom + 4, window.innerHeight - popupBounds.height - 8);
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(8, top)}px`;
}

function openComparableFilterPopup(column, button) {
  if (state.comparableFilterPopupColumn === column.key &&
      !elements.comparableFilterPopup.classList.contains('hidden')) {
    closeComparableFilterPopup();
    return;
  }
  state.comparableFilterPopupColumn = column.key;
  const selected = state.comparableColumnFilters[column.key] ||
    new Set(getComparableFilterOptions(column.key).map(value =>
      getComparableFilterValueKey(value, column.key)
    ));
  const controls = document.createElement('div');
  if (isComparableTextFilterColumn(column.key)) {
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'comparable-filter-search';
    search.placeholder = `Search ${column.label.toLowerCase()}`;
    search.setAttribute('aria-label', `Search ${column.label} filter options`);
    controls.append(search);
  } else {
    controls.className = 'comparable-filter-range';
    ['min', 'max'].forEach(bound => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.dataset.comparableRangeBound = bound;
      input.className = 'comparable-filter-range-input';
      input.placeholder = bound === 'min' ? 'Min' : 'Max';
      input.setAttribute('aria-label', `${bound === 'min' ? 'Minimum' : 'Maximum'} ${column.label}`);
      input.value = state.comparableColumnRanges[column.key]?.[bound] || '';
      controls.append(input);
    });
  }

  const actions = document.createElement('div');
  actions.className = 'comparable-filter-actions';
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'btn-link';
  clearButton.textContent = 'Clear filter';
  clearButton.addEventListener('click', () => {
    delete state.comparableColumnFilters[column.key];
    delete state.comparableColumnRanges[column.key];
    closeComparableFilterPopup();
    updateComparableProjectView();
  });
  const deselectButton = document.createElement('button');
  deselectButton.type = 'button';
  deselectButton.className = 'btn-link';
  deselectButton.textContent = 'Deselect all';
  deselectButton.addEventListener('click', () => {
    state.comparableColumnFilters[column.key] = new Set();
    elements.comparableFilterPopup.querySelectorAll('[data-comparable-filter-value]').forEach(checkbox => {
      checkbox.checked = false;
    });
    updateComparableProjectView();
  });
  actions.append(clearButton, deselectButton);

  const options = document.createElement('div');
  options.className = 'comparable-filter-options';
  getComparableFilterOptions(column.key).forEach(value => {
    const valueKey = getComparableFilterValueKey(value, column.key);
    const label = document.createElement('label');
    label.className = 'comparable-filter-option';
    label.dataset.searchText = formatComparableFilterOption(value, column.key).toLowerCase();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = valueKey;
    checkbox.dataset.comparableFilterValue = '';
    checkbox.checked = selected.has(valueKey);
    label.append(checkbox, document.createTextNode(formatComparableFilterOption(value, column.key)));
    options.append(label);
  });
  elements.comparableFilterPopup.replaceChildren(controls, actions, options);
  positionComparableFilterPopup(button);
  controls.querySelector('input')?.focus({ preventScroll: true });
}

function closeComparableFilterPopup() {
  if (!elements.comparableFilterPopup) return;
  elements.comparableFilterPopup.classList.add('hidden');
  state.comparableFilterPopupColumn = null;
}

function formatComparableValue(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatNum(value, decimals);
}

function getComparableProjectCellValue(project, column) {
  const value = project[column.key];
  if (column.key === 'projectCode' || column.key === 'simulationRun') return value || '';
  return formatComparableValue(value, getComparableColumnDecimals(column.key));
}

function createComparableTableRow(project, className = '') {
  const row = document.createElement('tr');
  if (className) row.className = className;
  COMPARABLE_PROJECT_COLUMNS.forEach(column => {
    const cell = document.createElement('td');
    cell.textContent = getComparableProjectCellValue(project, column);
    row.append(cell);
  });
  return row;
}

function getCurrentComparableReferences() {
  if (!state.currentEuiInfo) return [];
  const references = [];
  const referenceRoles = [
    { role: 'baseline', label: 'Current Baseline', scenarioName: state.baselineScenario, className: 'current-baseline-row' },
    { role: 'proposed', label: 'Current Proposed', scenarioName: state.proposedScenario, className: 'current-proposed-row' }
  ];
  referenceRoles.forEach(reference => {
    if (!reference.scenarioName || !state.selectedScenarios.includes(reference.scenarioName)) return;
    if (references.some(existing => existing.scenarioName === reference.scenarioName)) return;
    const info = state.currentEuiInfo.get(reference.role);
    if (!info) return;
    const scenario = state.scenarios.find(item => item.scenarioName === reference.scenarioName);
    references.push({
      ...info,
      projectCode: '',
      simulationRun: reference.label,
      totalEui: info.totalConditionedFloorArea > 0 && scenario
        ? scenario.summary.grandTotal_kBtu / info.totalConditionedFloorArea
        : null,
      className: reference.className,
      scenarioName: reference.scenarioName
    });
  });
  return references;
}

function renderComparableProjectTable() {
  const projectType = getComparableFilterValue('projectType');
  const shouldShow = Boolean(state.loadedEuiComparisonWorkbook && projectType);
  elements.comparableProjectTableWrap.classList.toggle('hidden', !shouldShow);
  elements.comparableProjectTableHead.replaceChildren();
  elements.comparableProjectTableBody.replaceChildren();
  if (!shouldShow) return;

  const labelsRow = document.createElement('tr');
  const unitsRow = document.createElement('tr');
  labelsRow.className = 'comparable-table-labels';
  unitsRow.className = 'comparable-table-units';
  COMPARABLE_PROJECT_COLUMNS.forEach(column => {
    const heading = document.createElement('th');
    heading.scope = 'col';
    const headingLabel = document.createElement('span');
    headingLabel.className = 'comparable-column-title';
    headingLabel.textContent = column.label;
    heading.append(headingLabel);
    labelsRow.append(heading);
    const unit = document.createElement('th');
    const filterButton = document.createElement('button');
    filterButton.type = 'button';
    filterButton.className = 'comparable-unit-filter';
    filterButton.dataset.comparableColumn = column.key;
    const activeFilter = state.comparableColumnFilters[column.key];
    const range = state.comparableColumnRanges[column.key];
    const hasRangeFilter = Boolean(range?.min || range?.max);
    const isFiltered = Boolean(activeFilter !== undefined || hasRangeFilter);
    filterButton.classList.toggle('is-filtered', isFiltered);
    filterButton.setAttribute('aria-pressed', String(isFiltered));
    filterButton.setAttribute('aria-label', `Filter ${column.label}`);
    filterButton.title = `Filter ${column.label}`;
    const filterLabel = hasRangeFilter
      ? 'Range'
      : activeFilter !== undefined
        ? `${activeFilter.size} selected`
        : (column.unit || 'All');
    filterButton.textContent = `${filterLabel} ▾`;
    unit.append(filterButton);
    unitsRow.append(unit);
  });
  elements.comparableProjectTableHead.append(labelsRow, unitsRow);

  const referenceRows = getCurrentComparableReferences();
  referenceRows.forEach(reference => {
    elements.comparableProjectTableBody.append(
      createComparableTableRow(reference, `current-reference-row ${reference.className}`)
    );
  });
  state.comparableFilteredProjects.forEach(project => {
    elements.comparableProjectTableBody.append(createComparableTableRow(project));
  });
}

function updateComparableProjectView() {
  const projectType = getComparableFilterValue('projectType');
  if (!state.loadedEuiComparisonWorkbook) {
    elements.comparableProjectCount.textContent = 'Workbook not loaded';
    elements.comparableProjectStatus.textContent = 'Load an EUI Comparison Workbook and select a Project Type to view comparable projects.';
    state.comparableFilteredProjects = [];
  } else if (!projectType) {
    elements.comparableProjectCount.textContent = `${state.historicalEuiProjects.length.toLocaleString()} simulation runs`;
    elements.comparableProjectStatus.textContent = 'Select a Project Type to display comparable projects.';
    state.comparableFilteredProjects = [];
  } else {
    state.comparableFilteredProjects = filterHistoricalProjects(state.historicalEuiProjects);
    elements.comparableProjectCount.textContent = `${state.comparableFilteredProjects.length.toLocaleString()} matching runs`;
    elements.comparableProjectStatus.textContent = state.currentEuiInfo
      ? `${state.comparableFilteredProjects.length.toLocaleString()} historical simulation runs match the selected filters.`
      : `${state.comparableFilteredProjects.length.toLocaleString()} historical simulation runs match. Load the CBECC Model Workbook to show current-project characteristics.`;
  }
  updateDashboard();
}

// =============================================================================
// File Selection Handlers (Section 1: 4 Selections in 1 Row)
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
  const result = parseComplianceCSV(text, filename, true);
  if (!result.success || result.scenarios.length === 0) {
    showToast('CSV Parsing Failed', result.error || 'Could not parse scenarios from CSV.', '⚠️');
    return;
  }

  state.loadedCsv = {
    file: null,
    name: filename,
    text,
    scenarios: result.scenarios,
    rows: result.rows,
    mappings: result.mappings,
    colDefs: result.colDefs,
    isThreeHeader: result.isThreeHeader
  };

  // Lock mappings defined in CSV
  Object.keys(result.mappings).forEach(k => {
    state.categoryMapping[k] = { ...result.mappings[k], locked: true };
  });

  state.loadedCsvRows = result.rows;
  state.baseCsvFilename = filename;
  state.selectedFolderName = filename.replace(/\s*-\s*Results\.csv$/i, '').replace(/\.csv$/i, '');

  if (elements.slotCsv) elements.slotCsv.classList.add('active-loaded');
  if (elements.csvStatusLabel) {
    elements.csvStatusLabel.innerHTML = `<strong>${filename}</strong> (${result.scenarios.length} sc)`;
  }
  if (elements.clearCsvBtn) elements.clearCsvBtn.classList.remove('hidden');

  if (result.scenarios[0].runId && elements.csvRunId) {
    elements.csvRunId.value = result.scenarios[0].runId;
  }
  if (result.scenarios[0].revision && elements.csvRevision) {
    elements.csvRevision.value = result.scenarios[0].revision;
  }

  if (state.loadedFolder && state.rawScenarios && state.rawScenarios.length > 0) {
    // Both loaded -> Mode 3 (Append)
    state.activeIngestionMethod = 3;
    loadParsedScenarios([...result.scenarios, ...state.rawScenarios]);
    syncCategoryMappings(state.scenarios, false);
  } else {
    // Only CSV -> Mode 1
    state.activeIngestionMethod = 1;
    loadParsedScenarios(result.scenarios);
    syncCategoryMappings(result.scenarios, true);
  }

  updateExportSectionsVisibility();
  showToast('CSV Loaded', `Loaded ${result.scenarios.length} scenarios from ${filename}!`, '✅');
}

function clearCsvSelection() {
  state.loadedCsv = null;
  state.loadedCsvRows = [];
  state.baseCsvFilename = '';

  if (elements.slotCsv) elements.slotCsv.classList.remove('active-loaded');
  if (elements.csvStatusLabel) elements.csvStatusLabel.textContent = 'Drop CSV or choose';
  if (elements.clearCsvBtn) elements.clearCsvBtn.classList.add('hidden');
  if (elements.browserCsvInput) elements.browserCsvInput.value = '';

  if (state.loadedFolder && state.loadedFolder.rawScenarios && state.loadedFolder.rawScenarios.length > 0) {
    state.activeIngestionMethod = 2;
    state.categoryMapping = {};
    loadParsedScenarios(state.loadedFolder.rawScenarios);
    syncCategoryMappings(state.scenarios, false);
  } else {
    state.scenarios = [];
    state.rawScenarios = [];
    state.categoryMapping = {};
    if (elements.scenariosContainer) elements.scenariosContainer.classList.add('hidden');
    if (elements.dashboardArea) elements.dashboardArea.classList.add('hidden');
  }

  updateExportSectionsVisibility();
  showToast('CSV Cleared', 'Removed loaded Results CSV', 'ℹ️');
}

async function loadSampleCsv() {
  showToast('Loading Sample CSV...', 'Fetching example_project_folder - Results.csv...', '⏳');
  try {
    let res = await fetch('example_project_folder - Results.csv');
    let filename = 'example_project_folder - Results.csv';
    if (!res.ok) {
      res = await fetch('2394-LEED MDL- Results.csv');
      filename = '2394-LEED MDL- Results.csv';
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    loadCsvContent(text, filename);
  } catch (err) {
    showToast('Notice', 'Could not load sample CSV: ' + err.message, '⚠️');
  }
}

async function handleWorkbookUpload(file) {
  if (!file) return;
  state.loadedWorkbook = { file, name: file.name };
  if (elements.slotCbeccWb) elements.slotCbeccWb.classList.add('active-loaded');
  if (elements.wbStatusLabel) {
    elements.wbStatusLabel.innerHTML = `<strong>${file.name}</strong>`;
  }
  if (elements.clearWbBtn) elements.clearWbBtn.classList.remove('hidden');

  let euiInfoMessage = '';
  try {
    state.currentEuiInfo = await parseCurrentProjectEuiInfo(file);
    euiInfoMessage = ' Current-project comparison information was extracted.';
  } catch (err) {
    state.currentEuiInfo = null;
    euiInfoMessage = ` Current-project comparison information could not be read: ${err.message}`;
  }

  if (window.QCModule && typeof window.QCModule.handleWorkbookFile === 'function') {
    window.QCModule.handleWorkbookFile(file);
  }
  if (window.CBECC_SHARED && typeof window.CBECC_SHARED.setWorkbook === 'function') {
    window.CBECC_SHARED.setWorkbook(file, 'compliance');
  }

  updateComparableProjectView();
  showToast('Workbook Loaded', `Loaded ${file.name} for QC.${euiInfoMessage}`, state.currentEuiInfo ? '📗' : '⚠️');
}

function clearWorkbookSelection() {
  state.loadedWorkbook = null;
  state.currentEuiInfo = null;
  if (elements.slotCbeccWb) elements.slotCbeccWb.classList.remove('active-loaded');
  if (elements.wbStatusLabel) elements.wbStatusLabel.textContent = 'CBECC Model Workbook (.xlsm)';
  if (elements.clearWbBtn) elements.clearWbBtn.classList.add('hidden');
  if (elements.browserWbInput) elements.browserWbInput.value = '';
  updateComparableProjectView();
  showToast('Workbook Cleared', 'Removed loaded CBECC Model Workbook', 'ℹ️');
}

async function handleEuiComparisonWorkbookUpload(file) {
  if (!file) return;
  try {
    const rows = await readWorkbookRows(file, 'Project Summary - New');
    const projects = parseHistoricalEuiProjects(rows);
    state.loadedEuiComparisonWorkbook = { file, name: file.name };
    state.historicalEuiProjects = projects;
    state.comparableColumnFilters = {};
    state.comparableColumnRanges = {};
    closeComparableFilterPopup();
    if (elements.slotEuiComp) elements.slotEuiComp.classList.add('active-loaded');
    if (elements.euiCompStatusLabel) elements.euiCompStatusLabel.textContent = file.name;
    if (elements.clearEuiCompBtn) elements.clearEuiCompBtn.classList.remove('hidden');
    updateComparableProjectView();
    showToast('Comparison Workbook Loaded', `Loaded ${projects.length.toLocaleString()} historical simulation runs.`, '📈');
  } catch (err) {
    showToast('Comparison Workbook Failed', `Could not read ${file.name}: ${err.message}`, '❌');
  }
}

function clearEuiComparisonWorkbook() {
  state.loadedEuiComparisonWorkbook = null;
  state.historicalEuiProjects = [];
  state.comparableFilteredProjects = [];
  state.comparableColumnFilters = {};
  state.comparableColumnRanges = {};
  closeComparableFilterPopup();
  if (elements.slotEuiComp) elements.slotEuiComp.classList.remove('active-loaded');
  if (elements.euiCompStatusLabel) elements.euiCompStatusLabel.textContent = 'Select comparison workbook';
  if (elements.clearEuiCompBtn) elements.clearEuiCompBtn.classList.add('hidden');
  if (elements.browserEuiCompInput) elements.browserEuiCompInput.value = '';
  updateComparableProjectView();
}

async function loadSampleWorkbook() {
  showToast('Loading Workbook...', 'Fetching CBECC Model Workbook - example2.xlsm...', '⏳');
  try {
    const res = await fetch('CBECC Model Workbook - example2.xlsm');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 'CBECC Model Workbook - example2.xlsm', { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
    handleWorkbookUpload(file);
  } catch (err) {
    showToast('Notice', 'Could not load sample workbook: ' + err.message, '⚠️');
  }
}

// =============================================================================
// Method 2: Extract from Model Folder (HTM Files)
// =============================================================================

async function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const handles = await Promise.all(items.map(item =>
    typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle() : null
  ));

  const files = [];
  function addFile(file, relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true });
    files.push(file);
  }

  async function collectHandle(handle, parentPath = '') {
    const relativePath = parentPath ? `${parentPath}/${handle.name}` : handle.name;

    if (handle.kind === 'file') {
      addFile(await handle.getFile(), relativePath);
      return;
    }

    for await (const [, child] of handle.entries()) {
      await collectHandle(child, relativePath);
    }
  }

  if (handles.some(Boolean)) {
    for (const handle of handles) {
      if (handle) await collectHandle(handle);
    }
    return files;
  }

  const entries = items
    .map(item => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (entries.length === 0) return Array.from(dataTransfer.files || []);

  async function collectEntry(entry, parentPath = '') {
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      addFile(file, relativePath);
      return;
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = [];
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        children.push(...batch);
      } while (batch.length > 0);

      for (const child of children) {
        await collectEntry(child, relativePath);
      }
    }
  }

  for (const entry of entries) {
    await collectEntry(entry);
  }
  return files;
}

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
    state.isAppendedData = false;
    state.loadedFolder = {
      files,
      name: state.selectedFolderName,
      rawScenarios: parsedResults
    };

    if (elements.slotFolder) elements.slotFolder.classList.add('active-loaded');
    if (elements.folderStatusLabel) {
      elements.folderStatusLabel.innerHTML = `<strong>${state.selectedFolderName}</strong> (${parsedResults.length} sc)`;
    }
    if (elements.clearFolderBtn) elements.clearFolderBtn.classList.remove('hidden');

    if (state.loadedCsv && state.loadedCsv.scenarios && state.loadedCsv.scenarios.length > 0) {
      state.activeIngestionMethod = 3;
      loadParsedScenarios([...state.loadedCsv.scenarios, ...parsedResults]);
      syncCategoryMappings(state.scenarios, false);
    } else {
      state.activeIngestionMethod = 2;
      loadParsedScenarios(parsedResults);
      syncCategoryMappings(parsedResults, false);
    }

    // Forward selected model folder to Model QC and Reports tabs
    if (window.CBECC_SHARED && typeof window.CBECC_SHARED.setFolder === 'function') {
      window.CBECC_SHARED.setFolder('', state.selectedFolderName, 'Compliance Tab', files);
    }

    updateExportSectionsVisibility();
    showToast('Success', `Successfully parsed ${parsedResults.length} scenarios!`, '✅');
  } else {
    showToast('Extraction Failed', 'No EAp2-4/5 compliance tables found in selected files', '⚠️');
  }
}

function clearFolderSelection() {
  state.loadedFolder = null;
  state.rawScenarios = [];

  if (elements.slotFolder) elements.slotFolder.classList.remove('active-loaded');
  if (elements.folderStatusLabel) elements.folderStatusLabel.textContent = 'Drop model run folder';
  if (elements.clearFolderBtn) elements.clearFolderBtn.classList.add('hidden');
  if (elements.browserFolderInput) elements.browserFolderInput.value = '';

  if (state.loadedCsv && state.loadedCsv.scenarios && state.loadedCsv.scenarios.length > 0) {
    state.activeIngestionMethod = 1;
    loadParsedScenarios(state.loadedCsv.scenarios);
    syncCategoryMappings(state.loadedCsv.scenarios, true);
  } else {
    state.scenarios = [];
    state.categoryMapping = {};
    if (elements.scenariosContainer) elements.scenariosContainer.classList.add('hidden');
    if (elements.dashboardArea) elements.dashboardArea.classList.add('hidden');
  }

  updateExportSectionsVisibility();
  showToast('Folder Cleared', 'Removed loaded model run folder', 'ℹ️');
}

async function loadExampleDataInBrowser() {
  showToast('Loading Demo...', 'Fetching sample CBECC simulation files...', '⏳');
  const demoFiles = [
    { scenario: 'ap', path: 'example_project_folder/ap/S901G_CBECC2025 - ap.htm', name: 'S901G_CBECC2025 - ap.htm' },
    { scenario: 'ab1', path: 'example_project_folder/ab1/S901G_CBECC2025 - ab1.htm', name: 'S901G_CBECC2025 - ab1.htm' },
    { scenario: 'ab2', path: 'example_project_folder/ab2/S901G_CBECC2025 - ab2.htm', name: 'S901G_CBECC2025 - ab2.htm' },
    { scenario: 'ab3', path: 'example_project_folder/ab3/S901G_CBECC2025 - ab3.htm', name: 'S901G_CBECC2025 - ab3.htm' },
    { scenario: 'ab4', path: 'example_project_folder/ab4/S901G_CBECC2025 - ab4.htm', name: 'S901G_CBECC2025 - ab4.htm' },
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
      state.isAppendedData = false;
      state.selectedFolderName = 'S901G_CBECC2025';
      state.loadedFolder = {
        files: demoFiles,
        name: state.selectedFolderName,
        rawScenarios: parsedResults
      };

      if (elements.slotFolder) elements.slotFolder.classList.add('active-loaded');
      if (elements.folderStatusLabel) {
        elements.folderStatusLabel.innerHTML = `<strong>S901G_CBECC2025</strong> (5 sc)`;
      }
      if (elements.clearFolderBtn) elements.clearFolderBtn.classList.remove('hidden');

      updateCsvFilenamePreview();

      if (elements.csvExportFilename) {
        elements.csvExportFilename.value = getCleanCsvFilename('S901G_CBECC2025');
      }
      if (elements.csvExportLocation) {
        elements.csvExportLocation.value = '..\\';
      }

      if (state.loadedCsv && state.loadedCsv.scenarios && state.loadedCsv.scenarios.length > 0) {
        state.activeIngestionMethod = 3;
        loadParsedScenarios([...state.loadedCsv.scenarios, ...parsedResults]);
        syncCategoryMappings(state.scenarios, false);
      } else {
        state.activeIngestionMethod = 2;
        loadParsedScenarios(parsedResults);
        syncCategoryMappings(parsedResults, false);
      }

      updateExportSectionsVisibility();
      if (window.CBECC_SHARED && typeof window.CBECC_SHARED.setFolder === 'function') {
        window.CBECC_SHARED.setFolder('example_project_folder', 'S901G_CBECC2025', 'Compliance Tab');
      }
      showToast('Demo Loaded', 'Loaded 5 example scenarios (ap, ab1–ab4)', '✅');
    }
  } catch (err) {
    console.warn('Could not auto-fetch example files:', err);
    showToast('Select Files', 'Drag & drop or select your CBECC output files or folder to begin', 'ℹ️');
  }
}

// =============================================================================
// Method 3 / Dynamic CSV Append: Append Scenarios to Loaded CSV
// =============================================================================

function renderAppendChecklist() {
  renderScenarioCheckboxDropdown(
    elements.appendScenarioOptions,
    elements.appendScenarioSummary,
    getAppendScenarioList(),
    state.appendScenarioNames,
    state.knownAppendScenarioNames,
    'append-scenario-cb'
  );
}

async function downloadAppendedCsv() {
  if (!state.loadedCsv || !state.loadedCsv.rows || state.loadedCsv.rows.length < 3) {
    showToast('No Base CSV', 'Please load a valid Results CSV first.', '⚠️');
    return;
  }
  if (!state.loadedFolder || !state.loadedFolder.rawScenarios || state.loadedFolder.rawScenarios.length === 0) {
    showToast('No Model Run', 'Please select a model run folder first.', '⚠️');
    return;
  }

  const checkboxes = elements.appendScenarioOptions
    ? elements.appendScenarioOptions.querySelectorAll('.append-scenario-cb:checked')
    : [];
  if (checkboxes.length === 0) {
    showToast('Selection Empty', 'Please select at least one scenario to append.', '⚠️');
    return;
  }

  const selectedNames = new Set(Array.from(checkboxes).map(cb => cb.value));
  const scenariosToAppend = sortScenariosForExport(getAppendScenarioList().filter(sc =>
    selectedNames.has(sc.scenarioName)
  ));

  if (scenariosToAppend.length === 0) {
    showToast('No Scenarios', 'No matching scenarios to append.', '⚠️');
    return;
  }

  // Work with a deep clone of the base CSV rows
  const combinedRows = state.loadedCsv.rows.map(r => [...r]);
  const row0 = combinedRows[0];
  const row1 = combinedRows[1];
  const row2 = combinedRows[2];

  // Current column definitions from CSV
  const currentCols = [...(state.loadedCsv.colDefs || [])];

  // Identify new non-zero categories in scenariosToAppend not in currentCols
  const newElecCats = [];
  const newGasCats = [];

  scenariosToAppend.forEach(sc => {
    const rawMap = sc.rawCategoryMap || {};
    Object.keys(rawMap).forEach(cat => {
      const r = rawMap[cat];
      if (!r || r.isTotal) return;
      if (Math.abs(r.elecKwh || 0) > 0 || Math.abs(r.elecDemW || 0) > 0) {
        if (!currentCols.some(cd => cd.isElec && cd.rawCat === cat) && !newElecCats.includes(cat)) {
          newElecCats.push(cat);
        }
      }
      if (Math.abs(r.gasTherm || 0) > 0 || Math.abs(r.gasDemBtuh || 0) > 0) {
        if (!currentCols.some(cd => !cd.isElec && cd.rawCat === cat) && !newGasCats.includes(cat)) {
          newGasCats.push(cat);
        }
      }
    });
  });

  // Append new electric column pairs
  newElecCats.forEach(rawCat => {
    const mapRule = state.categoryMapping[`${rawCat}___elec`];
    const userCat = mapRule ? mapRule.userCategory : getDefaultCategoryMapping(rawCat, 'elec');
    const energyCol = row2.length;
    const demandCol = energyCol + 1;

    row0.push(userCat, '');
    row1.push(rawCat, '');
    row2.push('[kWh]', '[W]');

    // Pad existing data rows with 0
    for (let r = 3; r < combinedRows.length; r++) {
      combinedRows[r].push('0.00', '0.00');
    }

    currentCols.push({ energyCol, demandCol, isElec: true, fuel: 'elec', rawCat, userCat });
  });

  // Append new gas column pairs
  newGasCats.forEach(rawCat => {
    const mapRule = state.categoryMapping[`${rawCat}___gas`];
    const userCat = mapRule ? mapRule.userCategory : getDefaultCategoryMapping(rawCat, 'gas');
    const energyCol = row2.length;
    const demandCol = energyCol + 1;

    row0.push(userCat, '');
    row1.push(rawCat, '');
    row2.push('[therm]', '[Btu/h]');

    // Pad existing data rows with 0
    for (let r = 3; r < combinedRows.length; r++) {
      combinedRows[r].push('0.00', '0.00');
    }

    currentCols.push({ energyCol, demandCol, isElec: false, fuel: 'gas', rawCat, userCat });
  });

  // Build rows for each scenario to append
  const runId = (elements.csvRunId && elements.csvRunId.value.trim()) || 'Run_02';
  const revision = (elements.csvRevision && elements.csvRevision.value.trim()) || 'r34';

  scenariosToAppend.forEach(sc => {
    const scRunId = sc.runId || runId;
    const scRev = sc.revision || revision;
    const rawName = sc.rawScenarioName || sc.scenarioName;
    const area = sc.buildingArea !== undefined ? formatNumRaw(sc.buildingArea, 2) : '0.00';

    const newRow = [scRunId, scRev, rawName, area];

    currentCols.forEach(cd => {
      const r = (sc.rawCategoryMap && sc.rawCategoryMap[cd.rawCat]) || null;
      if (cd.isElec) {
        newRow.push(formatNumRaw(r ? r.elecKwh : 0, 2));
        newRow.push(formatNumRaw(r ? r.elecDemW : 0, 2));
      } else {
        newRow.push(formatNumRaw(r ? r.gasTherm : 0, 2));
        newRow.push(formatNumRaw(r ? r.gasDemBtuh : 0, 2));
      }
    });

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

  const filename = state.loadedCsv.name || 'Results.csv';

  // Save via showSaveFilePicker if available
  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      showToast('CSV Overwritten', `Saved "${fileHandle.name}" with ${scenariosToAppend.length} appended scenario(s).`, '💾');
      loadCsvContent(csvContent, fileHandle.name);
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('Save Failed', `Could not save file: ${err.message}`, '⚠️');
      }
    }
  }

  // Fallback: standard browser download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  loadCsvContent(csvContent, filename);
  showToast('CSV Downloaded', `Saved "${filename}" (${scenariosToAppend.length} scenario(s) appended).`, '💾');
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
    let sumElecKwh = 0;
    let sumElecDemW = 0;
    let sumGasTherm = 0;
    let sumGasDemBtuh = 0;

    baselines.forEach(b => {
      const r = (b.rawCategoryMap && b.rawCategoryMap[raw]) || (b.categoryMap && b.categoryMap[raw]);
      if (r) {
        sumElecKwh += (r.elecKwh || 0);
        sumElecDemW += (r.elecDemW || 0);
        sumGasTherm += (r.gasTherm || 0);
        sumGasDemBtuh += (r.gasDemBtuh || 0);
      }
    });

    const avgElecKwh = sumElecKwh / count;
    const avgElecDemW = sumElecDemW / count;
    const avgGasTherm = sumGasTherm / count;
    const avgGasDemBtuh = sumGasDemBtuh / count;

    const elecKbtu = avgElecKwh * CONVERSIONS.KWH_TO_KBTU;
    const gasKbtu = avgGasTherm * CONVERSIONS.THERM_TO_KBTU;
    const totalKbtu = elecKbtu + gasKbtu;

    rawCategoryMap[raw] = {
      rawCategory: raw,
      isTotal: false,
      elecKwh: avgElecKwh,
      elecDemW: avgElecDemW,
      gasTherm: avgGasTherm,
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
    totalElecKwh += c.elecKwh;
    totalGasTherm += c.gasTherm;
  });

  const totalElecKbtu = totalElecKwh * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu = totalGasTherm * CONVERSIONS.THERM_TO_KBTU;
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
      totalElectricity_kWh: totalElecKwh,
      totalNaturalGas_therm: totalGasTherm,
      totalElectricity_kBtu: totalElecKbtu,
      totalNaturalGas_kBtu: totalGasKbtu,
      grandTotal_kBtu: grandTotalKbtu,
      electricitySharePercent: grandTotalKbtu > 0 ? (totalElecKbtu / grandTotalKbtu) * 100 : 0,
      naturalGasSharePercent: grandTotalKbtu > 0 ? (totalGasKbtu / grandTotalKbtu) * 100 : 0,
    }
  };
}

function renderScenarioAreas() {
  if (!elements.scenarioAreas) return;
  elements.scenarioAreas.innerHTML = `
    <div class="scenario-area-field"><label for="building-area-type">Area Basis</label><select id="building-area-type" class="select-dropdown"><option value="total" ${state.buildingAreaType === 'total' ? 'selected' : ''}>Total Building Area</option><option value="conditioned" ${state.buildingAreaType === 'conditioned' ? 'selected' : ''}>Net Conditioned Building Area</option></select></div>
    <div class="scenario-area-field building-area-value-field"><label for="building-area-value">Building Area (ft2)</label><input id="building-area-value" type="text" inputmode="numeric" data-area="buildingArea" value="${state.buildingArea ? formatNum(state.buildingArea, 0) : ''}"></div>`;
  elements.scenarioAreas.querySelectorAll('input[data-area]').forEach(input => {
    input.addEventListener('input', event => {
      const property = event.target.dataset.area;
      state[property] = parseNumber(event.target.value);
      state.scenarios.forEach(sc => { sc[property] = state[property]; });
      updateDashboard();
    });
    input.addEventListener('blur', event => {
      const value = parseNumber(event.target.value);
      event.target.value = value ? formatNum(value, 0) : '';
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

  const firstBaseline = sorted.find(s => s.scenarioName.toLowerCase().includes('baseline avg')) ||
    sorted.find(s => /(?:^|_)ab1$/i.test(s.rawScenarioName || s.scenarioName)) ||
    sorted[0];
  const firstProposed = sorted.find(s => /(?:^|_)ap$/i.test(s.rawScenarioName || s.scenarioName)) ||
    sorted.find(s => s !== firstBaseline) ||
    firstBaseline;

  state.baselineScenario = firstBaseline ? firstBaseline.scenarioName : null;
  state.proposedScenario = firstProposed ? firstProposed.scenarioName : null;
  state.scenarioSelectionMode = 'pair';
  state.selectedScenarios = [...new Set([state.baselineScenario, state.proposedScenario].filter(Boolean))];

  updateCsvFilenamePreview();
  renderScenarioSelection();
  renderCategoryMappingUI();
  renderCategoryFilterOptions();
  updateExportSectionsVisibility();

  elements.scenariosContainer.classList.remove('hidden');
  elements.dashboardArea.classList.remove('hidden');

  updateDashboard();
}

// =============================================================================
// Rendering: Scenarios & Controls
// =============================================================================

function renderScenarioSelection() {
  const populateSelect = (select, selectedName) => {
    select.replaceChildren(...state.scenarios.map(sc => {
      const option = document.createElement('option');
      option.value = sc.scenarioName;
      option.textContent = sc.scenarioName;
      option.selected = sc.scenarioName === selectedName;
      return option;
    }));
    select.value = selectedName || '';
  };

  populateSelect(elements.baselineCaseSelect, state.baselineScenario);
  populateSelect(elements.proposedCaseSelect, state.proposedScenario);
  populateSelect(elements.multiBaselineSelect, state.baselineScenario);

  elements.multiCaseOptions.replaceChildren(...state.scenarios.map(sc => {
    const label = document.createElement('label');
    label.className = 'multi-case-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = sc.scenarioName;
    checkbox.checked = state.selectedScenarios.includes(sc.scenarioName);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedScenarios = [...state.selectedScenarios, sc.scenarioName];
      } else {
        if (state.selectedScenarios.length === 1) {
          checkbox.checked = true;
          showToast('Notice', 'At least one scenario must remain selected', 'ℹ️');
          return;
        }
        state.selectedScenarios = state.selectedScenarios.filter(name => name !== sc.scenarioName);
        if (state.baselineScenario === sc.scenarioName) {
          state.baselineScenario = state.selectedScenarios[0];
          elements.multiBaselineSelect.value = state.baselineScenario;
        }
      }
      renderScenarioSelection();
      updateDashboard();
    });
    label.append(checkbox, document.createTextNode(sc.scenarioName));
    return label;
  }));

  const selectedNames = state.scenarios
    .filter(sc => state.selectedScenarios.includes(sc.scenarioName))
    .map(sc => sc.scenarioName);
  elements.multiCaseSummary.textContent = selectedNames.length
    ? selectedNames.join(', ')
    : 'Select cases';

  const isPairMode = state.scenarioSelectionMode === 'pair';
  elements.pairScenarioControls.classList.toggle('hidden', !isPairMode);
  elements.multiScenarioControls.classList.toggle('hidden', isPairMode);
  elements.pairSavingsDetails.classList.toggle('hidden', !isPairMode);
}

function setPairSelection() {
  state.selectedScenarios = [...new Set([state.baselineScenario, state.proposedScenario].filter(Boolean))];
  renderScenarioSelection();
  updateDashboard();
}

function setScenarioSelectionMode(mode) {
  state.scenarioSelectionMode = mode;
  if (mode === 'multi' && !state.selectedScenarios.length && state.baselineScenario) {
    state.selectedScenarios = [state.baselineScenario];
  }
  renderScenarioSelection();
  updateDashboard();
}

// =============================================================================
// Dashboard Updates (Metrics, Chart, Table)
// =============================================================================

function getCurrentResultScenarios() {
  const scenarios = state.scenarios.filter(scenario =>
    state.selectedScenarios.includes(scenario.scenarioName)
  );
  const baselineIndex = scenarios.findIndex(scenario =>
    scenario.scenarioName === state.baselineScenario
  );
  if (baselineIndex > 0) scenarios.unshift(scenarios.splice(baselineIndex, 1)[0]);
  return scenarios;
}

function getPercentReduction(baselineValue, proposedValue) {
  if (baselineValue === 0) return proposedValue === 0 ? 0 : null;
  return ((baselineValue - proposedValue) / baselineValue) * 100;
}

function formatPercentReduction(value) {
  return value === null ? '—' : `${formatNum(value, 1)}%`;
}

function formatSavingsAmount(value, decimals = 0, currency = false) {
  if (!value) return '—';
  const amount = currency ? `$${formatNum(Math.abs(value), decimals)}` : formatNum(Math.abs(value), decimals);
  return value < 0 ? `-${amount}` : amount;
}

function getScenarioCostSummary(scenario) {
  const summary = scenario.summary || {};
  const electricityCost = (summary.totalElectricity_kWh || 0) * state.electricityCostRate;
  const naturalGasCost = (summary.totalNaturalGas_therm || 0) * state.naturalGasCostRate;
  return {
    electricityKwh: summary.totalElectricity_kWh || 0,
    naturalGasTherms: summary.totalNaturalGas_therm || 0,
    totalKbtu: summary.grandTotal_kBtu || 0,
    electricityCost,
    naturalGasCost,
    totalCost: electricityCost + naturalGasCost,
    buildingArea: scenario.buildingArea || state.buildingArea || 0
  };
}

function updatePairSavingsOverview() {
  const baseline = state.scenarios.find(scenario =>
    scenario.scenarioName === state.baselineScenario
  );
  const proposed = state.scenarios.find(scenario =>
    scenario.scenarioName === state.proposedScenario
  );
  if (!baseline || !proposed) {
    elements.pairSavingsSummary.textContent = 'Energy reduction — · Cost reduction —';
    elements.pairSavingsBody.replaceChildren();
    return;
  }

  const base = getScenarioCostSummary(baseline);
  const next = getScenarioCostSummary(proposed);
  const totalEnergyReduction = getPercentReduction(base.totalKbtu, next.totalKbtu);
  const totalCostReduction = getPercentReduction(base.totalCost, next.totalCost);
  elements.pairSavingsSummary.textContent =
    `Energy reduction ${formatPercentReduction(totalEnergyReduction)} · Cost reduction ${formatPercentReduction(totalCostReduction)}`;

  const hasGas = base.naturalGasTherms > 0 || next.naturalGasTherms > 0;
  const area = state.buildingArea;
  const rows = [
    { label: 'Electricity (kWh)', base: base.electricityKwh, proposed: next.electricityKwh, decimals: 0 },
    ...(hasGas ? [{
      label: 'Natural Gas (therms)',
      base: base.naturalGasTherms,
      proposed: next.naturalGasTherms,
      decimals: 0
    }] : []),
    { label: 'Total Energy (MBtu)', base: base.totalKbtu / 1000, proposed: next.totalKbtu / 1000, decimals: 0 },
    { label: 'EUI (kBtu/ft²)', base: area > 0 ? base.totalKbtu / area : null, proposed: area > 0 ? next.totalKbtu / area : null, decimals: 1 },
    { label: 'Electricity Cost ($/yr)', base: base.electricityCost, proposed: next.electricityCost, decimals: 0, currency: true },
    ...(hasGas ? [{
      label: 'Natural Gas Cost ($/yr)',
      base: base.naturalGasCost,
      proposed: next.naturalGasCost,
      decimals: 0,
      currency: true
    }] : []),
    { label: 'Total Energy Cost ($/yr)', base: base.totalCost, proposed: next.totalCost, decimals: 0, currency: true, total: true },
    { label: 'Cost EUI ($/yr-ft²)', base: area > 0 ? base.totalCost / area : null, proposed: area > 0 ? next.totalCost / area : null, decimals: 2, currency: true, total: true }
  ];

  elements.pairSavingsBody.replaceChildren(...rows.map(row => {
    const tableRow = document.createElement('tr');
    if (row.total) tableRow.classList.add('savings-total-row');
    if (row.label === 'Cost EUI ($/yr-ft²)') tableRow.classList.add('savings-overall-row');
    const savings = row.base === null || row.proposed === null ? null : row.base - row.proposed;
    const reduction = row.base === null || row.proposed === null
      ? null
      : getPercentReduction(row.base, row.proposed);
    const values = [
      row.label,
      row.base === null ? '—' : formatSavingsAmount(row.base, row.decimals, row.currency),
      row.proposed === null ? '—' : formatSavingsAmount(row.proposed, row.decimals, row.currency),
      savings === null ? '—' : formatSavingsAmount(savings, row.decimals, row.currency),
      formatPercentReduction(reduction)
    ];
    tableRow.replaceChildren(...values.map((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      cell.textContent = value;
      return cell;
    }));
    return tableRow;
  }));
}

function updateDashboard() {
  const activeScenariosList = getCurrentResultScenarios();
  updatePairSavingsOverview();
  renderComparableProjectTable();

  if (activeScenariosList.length === 0) return;

  updateMetrics(activeScenariosList);
  updateChart(activeScenariosList);
  updateTable(activeScenariosList);
}

function updateMetrics(scenarios) {
  const displayUnit = getDisplayUnitLabel();
  document.querySelectorAll('.unit-label').forEach(el => el.textContent = displayUnit);

  if (!elements.metricTotalEnergy) return;

  let totalElecKwh = 0;
  let totalGasTherm = 0;
  let totalKbtu = 0;
  const categoryTotals = {};

  scenarios.forEach(sc => {
    totalElecKwh += sc.summary.totalElectricity_kWh;
    totalGasTherm += sc.summary.totalNaturalGas_therm;
    totalKbtu += sc.summary.grandTotal_kBtu;

    FIXED_CATEGORIES.forEach(fc => {
      const r = sc.categoryMap ? sc.categoryMap[fc.raw] : null;
      if (r && !r.isTotal) {
        categoryTotals[fc.raw] = (categoryTotals[fc.raw] || 0) + getScenarioCategoryEnergyValue(sc, r);
      }
    });
  });

  const count = scenarios.length;
  const avgKbtu = totalKbtu / count;
  const avgElecKwh = totalElecKwh / count;
  const avgGasTherm = totalGasTherm / count;

  const totalElecKbtu = avgElecKwh * CONVERSIONS.KWH_TO_KBTU;
  const totalGasKbtu = avgGasTherm * CONVERSIONS.THERM_TO_KBTU;

  let displayTotal = avgKbtu;
  let displayElec = avgElecKwh;
  let displayGas = avgGasTherm;

  if (state.energyUnit === 'eui' || state.energyUnit === 'eui-elec' || state.energyUnit === 'eui-gas') {
    displayTotal = scenarios.reduce((sum, sc) => sum + getScenarioEnergyValue(sc), 0) / count;
    displayElec = displayTotal;
    displayGas = displayTotal;
  } else if (state.energyUnit === 'kWh') {
    displayTotal = avgElecKwh;
    displayElec = avgElecKwh;
    displayGas = avgGasTherm;
  } else if (state.energyUnit === 'therm') {
    displayTotal = avgGasTherm;
    displayElec = avgElecKwh * CONVERSIONS.KWH_TO_THERM;
    displayGas = avgGasTherm;
  } else {
    displayElec = totalElecKbtu;
    displayGas = totalGasKbtu;
  }

  elements.metricTotalEnergy.textContent = `${formatNum(displayTotal, 0)} ${displayUnit}`;
  if (elements.metricTotalSubtitle) {
    elements.metricTotalSubtitle.textContent = count > 1 ? `Average across ${count} selected scenarios` : `${scenarios[0].scenarioName} total energy`;
  }

  const elecPct = avgKbtu > 0 ? (totalElecKbtu / avgKbtu) * 100 : 0;
  const gasPct = avgKbtu > 0 ? (totalGasKbtu / avgKbtu) * 100 : 0;

  if (elements.metricElecVal) elements.metricElecVal.textContent = `${formatNum(displayElec, 0)} ${displayUnit}`;
  if (elements.metricElecPercent) elements.metricElecPercent.textContent = `${formatNum(elecPct, 1)}% of total energy`;
  if (elements.metricGasVal) elements.metricGasVal.textContent = `${formatNum(displayGas, 0)} ${displayUnit}`;
  if (elements.metricGasPercent) elements.metricGasPercent.textContent = `${formatNum(gasPct, 1)}% of total energy`;

  let topCat = '-';
  let topVal = 0;
  Object.entries(categoryTotals).forEach(([cat, val]) => {
    if (val > topVal) { topVal = val; topCat = cat; }
  });

  const peakDisplayVal = topVal / count;
  const fc = FIXED_CATEGORIES.find(c => c.raw === topCat);
  if (elements.metricPeakCategory) elements.metricPeakCategory.textContent = fc ? fc.label : topCat;
  if (elements.metricPeakVal) elements.metricPeakVal.textContent = `${formatNum(peakDisplayVal, 0)} ${displayUnit} avg`;
}

// =============================================================================
// Chart.js Visualization Engine
// =============================================================================

function getChartCategories(scenarios) {
  const catSet = new Set();
  scenarios.forEach(sc => {
    if (sc.categoryMap) {
      Object.keys(sc.categoryMap).forEach(c => catSet.add(c));
    }
  });

  const allCats = sortEndUseCategories(Array.from(catSet));
  const filtered = allCats.filter(cat => {
    // 1. Filter by user selection in filter chips
    const isMiscLoad = cat === 'Misc Load' &&
      (state.visibleCategories.has('Receptacle Equipment') || state.visibleCategories.has('Elevators and escalators'));
    if (!state.visibleCategories.has(cat) && !isMiscLoad) {
      return false;
    }
    // 2. Hide zero rows if enabled
    if (state.hideZeroes) {
      const hasNonZero = scenarios.some(sc => {
        const r = sc.categoryMap ? sc.categoryMap[cat] : null;
        return r && getScenarioCategoryEnergyValue(sc, r) !== 0;
      });
      if (!hasNonZero) return false;
    }
    return true;
  });

  return filtered.map(cat => ({
    raw: cat,
    label: cat
  }));
}

function getComparableChartScenarios(scenarios) {
  const projectType = getComparableFilterValue('projectType');
  if (!state.loadedEuiComparisonWorkbook || !projectType) return scenarios;

  const currentArea = state.currentEuiInfo?.get('baseline')?.totalConditionedFloorArea ||
    state.currentEuiInfo?.get('proposed')?.totalConditionedFloorArea;
  const currentScenarios = scenarios.map(scenario => {
    const categoryMap = { ...(scenario.categoryMap || {}) };
    const receptacle = categoryMap['Receptacle Equipment'];
    const elevators = categoryMap['Elevators and escalators'];
    if (receptacle || elevators) {
      categoryMap['Misc Load'] = {
        rawCategory: 'Misc Load',
        label: 'Misc Load',
        isTotal: false,
        elecKwh: (receptacle?.elecKwh || 0) + (elevators?.elecKwh || 0),
        gasTherm: (receptacle?.gasTherm || 0) + (elevators?.gasTherm || 0),
        elecKbtu: (receptacle?.elecKbtu || 0) + (elevators?.elecKbtu || 0),
        gasKbtu: (receptacle?.gasKbtu || 0) + (elevators?.gasKbtu || 0),
        totalKbtu: (receptacle?.totalKbtu || 0) + (elevators?.totalKbtu || 0)
      };
      delete categoryMap['Receptacle Equipment'];
      delete categoryMap['Elevators and escalators'];
    }
    return {
      ...scenario,
      categoryMap,
      buildingArea: currentArea > 0 ? currentArea : scenario.buildingArea
    };
  });

  const historicalScenarios = state.comparableFilteredProjects.map(project => ({
    scenarioName: `${project.projectCode} · ${project.simulationRun}`,
    buildingArea: project.totalConditionedFloorArea || 0,
    categoryMap: project.categoryMap
  }));
  return [...currentScenarios, ...historicalScenarios];
}

function updateChart(scenarios) {
  if (state.chartInstance) { state.chartInstance.destroy(); }
  scenarios = getComparableChartScenarios(scenarios);

  const displayUnit = getDisplayUnitLabel();
  elements.chartUnitBadge.textContent = `Units: ${displayUnit}`;
  elements.chartMainTitle.textContent = `${state.viewMode === 'stacked' ? 'Stacked' : 'Clustered'} End-Use Energy by Scenario (${displayUnit})`;

  const visibleCats = getChartCategories(scenarios);
  const labels = visibleCats.map(fc => fc.label);

  let chartConfig = {};

  // Donut
  if (state.chartType === 'doughnut') {
    const targetSc = scenarios[0];
    const isDark = document.body.classList.contains('dark-theme');
    const dataVals = visibleCats.map(fc => { const r = targetSc.categoryMap[fc.raw]; return r ? getScenarioCategoryEnergyValue(targetSc, r) : 0; });
    chartConfig = {
      type: 'doughnut',
      data: { labels, datasets: [{ data: dataVals, backgroundColor: CHART_COLORS.slice(0, visibleCats.length), borderWidth: 2, borderColor: isDark ? '#161D26' : '#FFFFFF' }] },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: {
          legend: { position: 'right', labels: { color: isDark ? '#A0B0C0' : '#4F6173', font: { family: 'Yu Gothic, Raleway, Inter', weight: '600' }, boxWidth: 14 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatNum(ctx.raw)} ${state.energyUnit}` } }
        }
      }
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
        label: fc.label,
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
  const isDark = document.body.classList.contains('dark-theme');
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
// Active Table Generation (Dynamic Categories)
// =============================================================================

function getActiveTableCategories(scenarios) {
  const catSet = new Set();
  scenarios.forEach(sc => {
    if (sc.categoryMap) {
      Object.keys(sc.categoryMap).forEach(k => catSet.add(k));
    }
  });
  if (catSet.size === 0) {
    return [...FIXED_CATEGORIES]
      .sort((a, b) => compareEndUseCategories(a.raw, b.raw))
      .map(fc => ({ raw: fc.raw, label: fc.label, electricityOnly: fc.electricityOnly }));
  }
  return sortEndUseCategories(Array.from(catSet)).map(cat => ({
    raw: cat,
    label: cat,
    electricityOnly: false
  }));
}

function updateTable(scenarios) {
  elements.tableTitle.textContent = 'Result Table';
  const baseline = scenarios.find(scenario =>
    scenario.scenarioName === state.baselineScenario
  ) || scenarios[0];
  const hasGas = scenarios.some(scenario =>
    (scenario.summary && scenario.summary.totalNaturalGas_therm > 0) ||
    Object.values(scenario.categoryMap || {}).some(category => category.gasTherm > 0)
  );
  const categories = getActiveTableCategories(scenarios).filter(category =>
    scenarios.some(scenario => {
      const values = scenario.categoryMap && scenario.categoryMap[category.raw];
      return values && (Math.abs(values.elecKwh || 0) > 1e-9 || Math.abs(values.gasTherm || 0) > 1e-9);
    })
  );
  const measures = [
    { key: 'electricity', label: 'Elec.', unit: 'kWh', className: 'result-elec-col' },
    ...(hasGas ? [{ key: 'naturalGas', label: 'Natural Gas', unit: 'therms', className: 'result-gas-col' }] : []),
    { key: 'total', label: 'Total', unit: 'MBtu', className: 'result-total-col' },
    { key: 'eui', label: 'EUI', unit: 'kBtu/ft²-yr', className: 'result-eui-col' }
  ];
  const makeCell = (tag, text, className = '') => {
    const cell = document.createElement(tag);
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  };

  const headerRows = [document.createElement('tr'), document.createElement('tr'), document.createElement('tr')];
  const categoryHeader = makeCell('th', 'End-Use Category', 'cat-col result-category-header');
  categoryHeader.rowSpan = 3;
  headerRows[0].appendChild(categoryHeader);

  scenarios.forEach((scenario, index) => {
    const isBaseline = scenario.scenarioName === baseline.scenarioName;
    const title = isBaseline
      ? `Baseline - ${scenario.scenarioName}`
      : scenarios.length === 2
        ? `Proposed - ${scenario.scenarioName}`
        : scenario.scenarioName;
    const header = makeCell(
      'th',
      title,
      'scenario-group-header'
    );
    header.colSpan = measures.length + (isBaseline ? 0 : 1);
    header.style.backgroundColor = `${getScenarioColor(scenario.scenarioName, index)}22`;
    header.style.borderBottom = `3px solid ${getScenarioColor(scenario.scenarioName, index)}`;
    headerRows[0].appendChild(header);

    measures.forEach(measure => {
      headerRows[1].appendChild(makeCell('th', measure.label, `num-col sub-col result-sub-col ${measure.className}`));
      headerRows[2].appendChild(makeCell('th', measure.unit, `num-col result-unit-col ${measure.className}`));
    });
    if (!isBaseline) {
      headerRows[1].appendChild(makeCell('th', 'Reduction', 'num-col sub-col result-sub-col result-savings-col'));
      headerRows[2].appendChild(makeCell('th', '%', 'num-col result-unit-col result-savings-col'));
    }
  });
  elements.tableHead.replaceChildren(...headerRows);

  const getCategoryValues = (scenario, category) => {
    const values = scenario.categoryMap && scenario.categoryMap[category.raw];
    const electricityKwh = values ? values.elecKwh || 0 : 0;
    const naturalGasTherms = values ? values.gasTherm || 0 : 0;
    const electricityKbtu = electricityKwh * CONVERSIONS.KWH_TO_KBTU;
    const naturalGasKbtu = naturalGasTherms * CONVERSIONS.THERM_TO_KBTU;
    return {
      electricityKwh,
      naturalGasTherms,
      totalKbtu: electricityKbtu + naturalGasKbtu
    };
  };
  const makeResultCells = (scenario, values, baselineValues, isBaseline) => {
    const area = scenario.buildingArea || state.buildingArea;
    const cells = [
      makeCell('td', formatSavingsAmount(values.electricityKwh, 0), 'num-col result-elec-col'),
      ...(hasGas ? [makeCell('td', formatSavingsAmount(values.naturalGasTherms, 0), 'num-col result-gas-col')] : []),
      makeCell('td', formatSavingsAmount(values.totalKbtu / 1000, 0), 'num-col result-total-col'),
      makeCell('td', area > 0 ? formatSavingsAmount(values.totalKbtu / area, 1) : '—', 'num-col result-eui-col')
    ];
    if (!isBaseline) {
      cells.push(makeCell(
        'td',
        formatPercentReduction(getPercentReduction(baselineValues.totalKbtu, values.totalKbtu)),
        'num-col result-savings-col'
      ));
    }
    return cells;
  };

  const baselineRowValues = new Map(categories.map(category => [
    category.raw,
    getCategoryValues(baseline, category)
  ]));
  const bodyRows = categories.map(category => {
    const row = document.createElement('tr');
    row.appendChild(makeCell('td', category.label, 'cat-col'));
    scenarios.forEach(scenario => {
      const values = getCategoryValues(scenario, category);
      const baselineValues = baselineRowValues.get(category.raw);
      row.append(...makeResultCells(
        scenario,
        values,
        baselineValues,
        scenario.scenarioName === baseline.scenarioName
      ));
    });
    return row;
  });
  elements.tableBody.replaceChildren(...bodyRows);

  const footer = document.createElement('tr');
  footer.className = 'result-total-row';
  footer.appendChild(makeCell('td', 'Total', 'cat-col'));
  const baselineSummary = getScenarioCostSummary(baseline);
  scenarios.forEach(scenario => {
    const summary = getScenarioCostSummary(scenario);
    const values = {
      electricityKwh: summary.electricityKwh,
      naturalGasTherms: summary.naturalGasTherms,
      totalKbtu: summary.totalKbtu
    };
    footer.append(...makeResultCells(
      scenario,
      values,
      baselineSummary,
      scenario.scenarioName === baseline.scenarioName
    ));
  });
  elements.tableFoot.replaceChildren(footer);
}

// =============================================================================
// Excel TSV Copy (from fixed table)
// =============================================================================

function generateTSVForExcel() {
  const table = elements.complianceDataTable;
  const rows = Array.from(table.querySelectorAll('tr'));
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
 * Export the visible result comparison and selected scenario totals.
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

  const activeScenariosList = getCurrentResultScenarios();

  if (activeScenariosList.length === 0) {
    showToast('No Scenarios Selected', 'Please select at least one scenario.', '⚠️');
    return;
  }

  const runId = (elements.csvRunId && elements.csvRunId.value.trim()) || 'RUN-001';
  const revision = (elements.csvRevision && elements.csvRevision.value.trim()) || 'Rev.0';
  const wb = XLSX.utils.book_new();
  const resultSheet = XLSX.utils.table_to_sheet(elements.complianceDataTable);
  const resultColumnCount = elements.tableHead.rows[1]
    ? elements.tableHead.rows[1].cells.length + 1
    : 1;
  resultSheet['!cols'] = [
    { wch: 28 },
    ...Array.from({ length: Math.max(0, resultColumnCount - 1) }, () => ({ wch: 14 }))
  ];
  XLSX.utils.book_append_sheet(wb, resultSheet, 'Result Table');
  if (state.scenarioSelectionMode === 'pair' && elements.pairSavingsTable) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.table_to_sheet(elements.pairSavingsTable),
      'Energy and Cost Savings'
    );
  }

  const summaryData = [
    ['Scenario', 'Role', 'Electricity [kWh]', 'Natural Gas [therms]', 'Total Energy [MBtu]', 'EUI [kBtu/ft²]', 'Electricity Cost [$ / yr]', 'Natural Gas Cost [$ / yr]', 'Total Cost [$ / yr]']
  ];
  activeScenariosList.forEach(sc => {
    const summary = getScenarioCostSummary(sc);
    summaryData.push([
      sc.scenarioName,
      sc.scenarioName === state.baselineScenario
        ? 'Baseline'
        : state.scenarioSelectionMode === 'pair'
          ? 'Proposed'
          : '',
      summary.electricityKwh,
      summary.naturalGasTherms,
      summary.totalKbtu / 1000,
      summary.buildingArea > 0 ? summary.totalKbtu / summary.buildingArea : '',
      summary.electricityCost,
      summary.naturalGasCost,
      summary.totalCost
    ]);
  });
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 12 }, ...Array.from({ length: 7 }, () => ({ wch: 20 }))];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Scenario Summary');

  const fileName = `OB360_Result_${runId}_${revision}.xlsx`.replace(/[^a-z0-9_\-\.]/gi, '_');
  XLSX.writeFile(wb, fileName);
  showToast('Excel Exported!', `Downloaded: ${fileName}`, '📊');
}

// =============================================================================
// CSV Export: Dynamic Non-Zero Category 3-Header CSV Log
// Matches example_project_folder - Results.csv format
// =============================================================================

function buildCsvRowsForExport() {
  const runId = (elements.csvRunId && elements.csvRunId.value.trim()) || 'Run_01';
  const revision = (elements.csvRevision && elements.csvRevision.value.trim()) || 'r33';
  const exportScenarios = sortScenariosForExport(state.scenarios.filter(scenario =>
    state.exportScenarioNames.has(scenario.scenarioName)
  ));

  if (exportScenarios.length === 0) return [];

  // 1. Collect all non-zero categories across exportScenarios
  const elecCatSet = new Set();
  const gasCatSet = new Set();

  exportScenarios.forEach(sc => {
    const rawMap = sc.rawCategoryMap || {};
    Object.keys(rawMap).forEach(cat => {
      const r = rawMap[cat];
      if (!r || r.isTotal) return;
      if (Math.abs(r.elecKwh || 0) > 0 || Math.abs(r.elecDemW || 0) > 0) {
        elecCatSet.add(cat);
      }
      if (Math.abs(r.gasTherm || 0) > 0 || Math.abs(r.gasDemBtuh || 0) > 0) {
        gasCatSet.add(cat);
      }
    });
  });

  // Sort canonical or alphabetical
  const sortedElec = Array.from(elecCatSet).sort((a, b) => {
    const idxA = CSV_ELECS.indexOf(a);
    const idxB = CSV_ELECS.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const sortedGas = Array.from(gasCatSet).sort((a, b) => {
    const idxA = CSV_GASES.indexOf(a);
    const idxB = CSV_GASES.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  // 2. Build 3 Header Rows
  const row0 = ['', '', '', 'Building Area'];
  const row1 = ['Run ID', 'Rev #', 'Scenario', 'Building Area [ft2]'];
  const row2 = ['', '', '', '[ft2]'];

  sortedElec.forEach(rawCat => {
    const mapRule = state.categoryMapping[`${rawCat}___elec`];
    const userCat = mapRule ? mapRule.userCategory : getDefaultCategoryMapping(rawCat, 'elec');
    row0.push(userCat, '');
    row1.push(rawCat, '');
    row2.push('[kWh]', '[W]');
  });

  sortedGas.forEach(rawCat => {
    const mapRule = state.categoryMapping[`${rawCat}___gas`];
    const userCat = mapRule ? mapRule.userCategory : getDefaultCategoryMapping(rawCat, 'gas');
    row0.push(userCat, '');
    row1.push(rawCat, '');
    row2.push('[therm]', '[Btu/h]');
  });

  const rows = [row0, row1, row2];

  // 3. Build data rows for each scenario
  exportScenarios.forEach(sc => {
    const rId = sc.runId || runId;
    const rev = sc.revision || revision;
    const rawName = sc.rawScenarioName || sc.scenarioName;
    const area = sc.buildingArea !== undefined ? formatNumRaw(sc.buildingArea, 2) : '0.00';

    const dataRow = [rId, rev, rawName, area];

    sortedElec.forEach(rawCat => {
      const r = (sc.rawCategoryMap && sc.rawCategoryMap[rawCat]) || null;
      dataRow.push(formatNumRaw(r ? r.elecKwh : 0, 2));
      dataRow.push(formatNumRaw(r ? r.elecDemW : 0, 2));
    });

    sortedGas.forEach(rawCat => {
      const r = (sc.rawCategoryMap && sc.rawCategoryMap[rawCat]) || null;
      dataRow.push(formatNumRaw(r ? r.gasTherm : 0, 2));
      dataRow.push(formatNumRaw(r ? r.gasDemBtuh : 0, 2));
    });

    rows.push(dataRow);
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
    showToast('No Scenarios', 'Select at least one scenario to export.', '⚠️');
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
      const writable = await fileHandle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      showToast('CSV Saved', `Saved to "${state.csvExportDirHandle.name}\\${filename}" — ${dataRowCount} scenario row(s).`, '💾');
      return;
    } catch (err) {
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSV Downloaded', `${filename} — ${dataRowCount} scenario row(s).`, '💾');
}

function downloadChartImage() {
  if (!state.chartInstance) return;
  const a = document.createElement('a');
  a.href = state.chartInstance.toBase64Image();
  a.download = `energy_chart_${state.viewMode}_${state.energyUnit}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Chart Saved', 'Chart exported as PNG image', '🖼️');
}

function showToast(title, message, icon = '✅') {
  elements.toastTitle.textContent = title;
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
  createComparableFilterControls();
  elements.comparableProjectFilters.addEventListener('change', updateComparableProjectView);
  elements.comparableProjectTableHead.addEventListener('click', event => {
    const button = event.target.closest('[data-comparable-column]');
    if (!button) return;
    const column = COMPARABLE_PROJECT_COLUMNS.find(item => item.key === button.dataset.comparableColumn);
    if (column) openComparableFilterPopup(column, button);
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.comparable-filter-popup, [data-comparable-column]')) {
      closeComparableFilterPopup();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeComparableFilterPopup();
  });
  document.addEventListener('scroll', event => {
    if (!elements.comparableFilterPopup.contains(event.target)) closeComparableFilterPopup();
  }, true);

  // Theme Toggle
  elements.themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    document.body.classList.toggle('light-theme');
    const isDark = document.body.classList.contains('dark-theme');
    elements.themeIcon.textContent = isDark ? '☀️' : '🌙';
    if (state.scenarios.length > 0) updateDashboard();
  });

  // Slot 1: Results CSV
  if (elements.browseCsvBtn && elements.browserCsvInput) {
    elements.browseCsvBtn.addEventListener('click', () => elements.browserCsvInput.click());
    elements.browserCsvInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleCsvFile(e.target.files[0]);
    });
  }
  if (elements.clearCsvBtn) {
    elements.clearCsvBtn.addEventListener('click', clearCsvSelection);
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

  // Slot 2: Model Folder
  if (elements.browseFolderBtn && elements.browserFolderInput) {
    elements.browseFolderBtn.addEventListener('click', () => elements.browserFolderInput.click());
    elements.browserFolderInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleFileList(e.target.files);
    });
  }
  if (elements.clearFolderBtn) {
    elements.clearFolderBtn.addEventListener('click', clearFolderSelection);
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
      collectDroppedFiles(e.dataTransfer)
        .then(files => {
          if (files.length > 0) {
            handleFileList(files);
          } else {
            showToast('No Files Found', 'Could not read files from the dropped folder. Try Browse Folder instead.', '⚠️');
          }
        })
        .catch(err => {
          console.error('Error reading dropped model run folder:', err);
          showToast('Folder Drop Failed', `Could not read the dropped folder: ${err.message}`, '❌');
        });
    });
  }

  // Slot 3: CBECC Model Workbook
  if (elements.browseWbBtn && elements.browserWbInput) {
    elements.browseWbBtn.addEventListener('click', () => elements.browserWbInput.click());
    elements.browserWbInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleWorkbookUpload(e.target.files[0]);
    });
  }
  if (elements.clearWbBtn) {
    elements.clearWbBtn.addEventListener('click', clearWorkbookSelection);
  }
  if (elements.loadSampleWbBtn) {
    elements.loadSampleWbBtn.addEventListener('click', loadSampleWorkbook);
  }
  if (elements.dropZoneWb) {
    elements.dropZoneWb.addEventListener('dragover', e => { e.preventDefault(); elements.dropZoneWb.classList.add('dragover'); });
    elements.dropZoneWb.addEventListener('dragleave', () => elements.dropZoneWb.classList.remove('dragover'));
    elements.dropZoneWb.addEventListener('drop', e => {
      e.preventDefault();
      elements.dropZoneWb.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleWorkbookUpload(e.dataTransfer.files[0]);
    });
  }

  // Slot 4: EUI Comparison Workbook
  if (elements.browseEuiCompBtn && elements.browserEuiCompInput) {
    elements.browseEuiCompBtn.addEventListener('click', () => elements.browserEuiCompInput.click());
    elements.browserEuiCompInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleEuiComparisonWorkbookUpload(e.target.files[0]);
    });
  }
  if (elements.clearEuiCompBtn) {
    elements.clearEuiCompBtn.addEventListener('click', clearEuiComparisonWorkbook);
  }
  if (elements.dropZoneEuiComp) {
    elements.dropZoneEuiComp.addEventListener('dragover', e => {
      e.preventDefault();
      elements.dropZoneEuiComp.classList.add('dragover');
    });
    elements.dropZoneEuiComp.addEventListener('dragleave', () => elements.dropZoneEuiComp.classList.remove('dragover'));
    elements.dropZoneEuiComp.addEventListener('drop', e => {
      e.preventDefault();
      elements.dropZoneEuiComp.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleEuiComparisonWorkbookUpload(e.dataTransfer.files[0]);
    });
  }

  // Method 3 / Append Section Actions
  if (elements.appendDownloadCsvBtn) {
    elements.appendDownloadCsvBtn.addEventListener('click', downloadAppendedCsv);
  }

  // View Mode
  if (elements.viewModeSelect) {
    elements.viewModeSelect.addEventListener('change', () => {
      state.viewMode = elements.viewModeSelect.value;
      updateDashboard();
    });
  }

  // Energy Source and Unit
  if (elements.energySourceSelect && elements.energyUnitSelect) {
    elements.energySourceSelect.addEventListener('change', () => {
      const keepPerArea = state.energyUnit.startsWith('eui');
      state.energySource = elements.energySourceSelect.value;
      const options = ENERGY_UNITS_BY_SOURCE[state.energySource];
      elements.energyUnitSelect.replaceChildren(...options.map(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      }));
      state.energyUnit = options[keepPerArea ? 1 : 0].value;
      elements.energyUnitSelect.value = state.energyUnit;
      updateDashboard();
    });

    elements.energyUnitSelect.addEventListener('change', () => {
      state.energyUnit = elements.energyUnitSelect.value;
      updateDashboard();
    });
  }

  // Chart Type
  if (elements.chartTypeSelect) {
    elements.chartTypeSelect.addEventListener('change', e => { state.chartType = e.target.value; updateDashboard(); });
  }

  // Scenario selection
  elements.baselineCaseSelect.addEventListener('change', () => {
    state.baselineScenario = elements.baselineCaseSelect.value;
    if (state.baselineScenario === state.proposedScenario && state.scenarios.length > 1) {
      state.proposedScenario = state.scenarios.find(sc => sc.scenarioName !== state.baselineScenario).scenarioName;
    }
    setPairSelection();
  });
  elements.proposedCaseSelect.addEventListener('change', () => {
    state.proposedScenario = elements.proposedCaseSelect.value;
    if (state.proposedScenario === state.baselineScenario && state.scenarios.length > 1) {
      state.baselineScenario = state.scenarios.find(sc => sc.scenarioName !== state.proposedScenario).scenarioName;
    }
    setPairSelection();
  });
  elements.multiBaselineSelect.addEventListener('change', () => {
    state.baselineScenario = elements.multiBaselineSelect.value;
    if (!state.selectedScenarios.includes(state.baselineScenario)) {
      state.selectedScenarios.push(state.baselineScenario);
    }
    renderScenarioSelection();
    updateDashboard();
  });
  elements.compareMultipleBtn.addEventListener('click', () => setScenarioSelectionMode('multi'));
  elements.pairScenarioBtn.addEventListener('click', () => setScenarioSelectionMode('pair'));

  // Options
  if (elements.hideZeroesToggle) {
    elements.hideZeroesToggle.addEventListener('change', e => { state.hideZeroes = e.target.checked; updateDashboard(); });
  }
  [
    { input: elements.electricityCostRate, key: 'electricityCostRate' },
    { input: elements.naturalGasCostRate, key: 'naturalGasCostRate' }
  ].forEach(({ input, key }) => {
    input.addEventListener('change', () => {
      const rate = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(rate) || rate < 0) {
        showToast('Invalid Utility Cost', 'Enter a zero or positive utility cost.', '⚠️');
        input.value = state[key].toString();
        return;
      }
      state[key] = rate;
      updateDashboard();
    });
  });

  // Export Buttons
  if (elements.copyExcelBtn) {
    elements.copyExcelBtn.addEventListener('click', copyTableToExcel);
  }
  if (elements.exportExcelBtn) {
    elements.exportExcelBtn.addEventListener('click', exportExcelWorkbook);
  }
  if (elements.exportCsvBtn) {
    elements.exportCsvBtn.addEventListener('click', downloadCSVLog);
  }
  if (elements.csvBrowseFolderBtn) {
    elements.csvBrowseFolderBtn.addEventListener('click', browseFolderForExport);
  }
  if (elements.downloadChartBtn) {
    elements.downloadChartBtn.addEventListener('click', downloadChartImage);
  }

  // Top-Level Navigation Tabs (Compliance Results vs Model QC)
  setupTopLevelNavigation();
}

function setupTopLevelNavigation() {
  const navTabs = document.querySelectorAll('.nav-tab-btn');
  const complianceView = document.getElementById('compliance-view');
  const qcView = document.getElementById('qc-view');
  const reportsView = document.getElementById('reports-view');

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetView = tab.getAttribute('data-view');
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (complianceView) complianceView.classList.add('hidden');
      if (qcView) qcView.classList.add('hidden');
      if (reportsView) reportsView.classList.add('hidden');

      if (targetView === 'qc-view') {
        if (qcView) {
          qcView.classList.remove('hidden');
          if (window.QCModule && typeof window.QCModule.render === 'function') {
            window.QCModule.render();
          }
        }
      } else if (targetView === 'reports-view') {
        if (reportsView) {
          reportsView.classList.remove('hidden');
          if (window.ReportsModule && typeof window.ReportsModule.render === 'function') {
            window.ReportsModule.render();
          }
        }
      } else {
        if (complianceView) complianceView.classList.remove('hidden');
      }
    });
  });
}

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  if (window.QCModule && typeof window.QCModule.init === 'function') {
    window.QCModule.init();
  }
  if (window.ReportsModule && typeof window.ReportsModule.init === 'function') {
    window.ReportsModule.init();
  }
});
