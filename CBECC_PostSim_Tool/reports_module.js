/**
 * reports_module.js - DOE Compliance Workbook Envelope Area Reports & Table Generator
 * Handles:
 * 1. Extraction of envelope surfaces from CBECC-Com ' - ap - LEEDSummary.csv'
 * 2. Big Combined Opaque Table (Roof, Exterior Wall, Exterior Floor, Underground Wall, Underground Floor, Interior Wall, Interior Floor)
 * 3. Big Combined Fenestration Table (Vertical Fenestration, Skylight)
 * 4. Table 1: Opaque Envelope - Baseline and Proposed Surface Areas and Properties (Aggregated)
 * 5. Table 2: Fenestration - Proposed Design Area, and Baseline and Proposed Properties (Aggregated)
 * 6. Flexible Construction/Fenestration selection & de-selection
 * 7. Excel-ready TSV Clipboard Copy & SheetJS XLSX export
 * 8. Shared folder sync across Compliance Results, Model QC, and Reports tabs.
 */

(function () {
  'use strict';

  // State Management
  const state = {
    folderName: '',
    folderPath: '',
    csvFileName: '',
    csvRawText: '',
    sourceTab: '',
    isLoading: false,

    // Parsed Data
    bigTable1: [], // All opaque surfaces (12 columns)
    bigTable2: [], // All fenestration surfaces (12 columns)
    table1Agg: [], // Aggregated Table 1
    table2Agg: [], // Aggregated Table 2

    // Selection Filters
    availableConstructions: [], // Unique assembly names
    selectedConstructions: new Set(), // Set of selected assembly names

    availableFenestrations: [], // Unique fenestration names
    selectedFenestrations: new Set(), // Set of selected fenestration names

    // Active sub-view in Reports tab ('compliance-tables' | 'big-tables')
    subView: 'compliance-tables',

    // Row-level exclusions in Table 1 & Table 2 (by row key)
    excludedTable1Keys: new Set(),
    excludedTable2Keys: new Set(),

    // Search query
    table1Search: '',
    table2Search: ''
  };

  // Helper: Normalize Orientation from Azimuth
  function getOrientation(surfaceType, azimuth) {
    const st = (surfaceType || '').trim().toLowerCase();
    if (st.includes('roof') || st.includes('floor') || st.includes('skylight')) {
      return 'Horizontal';
    }

    if (azimuth === null || azimuth === undefined || azimuth === '') {
      return 'North';
    }

    let deg = parseFloat(azimuth);
    if (isNaN(deg)) return 'North';

    deg = ((deg % 360) + 360) % 360;

    // 8 compass sectors: 45 deg each, centered at 0, 45, 90, 135, 180, 225, 270, 315
    if (deg >= 337.5 || deg < 22.5) return 'North';
    if (deg >= 22.5 && deg < 67.5) return 'Northeast';
    if (deg >= 67.5 && deg < 112.5) return 'East';
    if (deg >= 112.5 && deg < 157.5) return 'Southeast';
    if (deg >= 157.5 && deg < 202.5) return 'South';
    if (deg >= 202.5 && deg < 247.5) return 'Southwest';
    if (deg >= 247.5 && deg < 292.5) return 'West';
    return 'Northwest';
  }

  // Helper: Normalize Status
  function normalizeStatus(status) {
    if (!status) return 'New';
    const s = String(status).trim().toLowerCase();
    if (s.includes('exist')) return 'Ex. Remain';
    if (s.includes('alter') || s.includes('retrofit')) return 'Retrofitted';
    if (s === 'new') return 'New';
    return status;
  }

  // Client-side CSV Parser
  function parseCSVText(csvText) {
    const lines = [];
    let currentLine = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const c = csvText[i];
      const nextC = csvText[i + 1];

      if (c === '"') {
        if (inQuotes && nextC === '"') {
          currentCell += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        currentLine.push(currentCell);
        currentCell = '';
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && nextC === '\n') {
          i++;
        }
        currentLine.push(currentCell);
        lines.push(currentLine);
        currentLine = [];
        currentCell = '';
      } else {
        currentCell += c;
      }
    }

    if (currentCell.length > 0 || currentLine.length > 0) {
      currentLine.push(currentCell);
      lines.push(currentLine);
    }

    return lines;
  }

  // Parse LEEDSummary CSV into intermediate and aggregated tables
  function parseLeedSummary(csvText, fileName = '') {
    const rows = parseCSVText(csvText);

    const targetOpaqueTables = [
      'Roof',
      'Exterior Wall',
      'Exterior Floor',
      'Underground Wall',
      'Underground Floor',
      'Interior Wall',
      'Interior Floor'
    ];
    const targetFenestrationTables = [
      'Vertical Fenestration',
      'Skylight'
    ];
    const allTables = targetOpaqueTables.concat(targetFenestrationTables);

    const boundarySections = [
      'spaces loads summary', 'primary system', 'fluidsystems',
      'boiler', 'chiller', 'hvac system summary'
    ];

    let currentTable = null;
    let headers = [];

    const bigTable1 = [];
    const bigTable2 = [];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const nonNull = row.map(c => c.trim()).filter(c => c.length > 0);
      if (nonNull.length === 0) continue;

      const firstLow = nonNull[0].toLowerCase();

      // Check boundary
      if (boundarySections.some(b => firstLow.includes(b))) {
        currentTable = null;
        headers = [];
        continue;
      }

      // Check table title header
      let matched = null;
      for (let t = 0; t < allTables.length; t++) {
        if (nonNull[0].toLowerCase() === allTables[t].toLowerCase()) {
          matched = allTables[t];
          break;
        }
      }

      if (matched) {
        currentTable = matched;
        headers = [];
        continue;
      }

      if (currentTable) {
        // Check exact column header row
        const rowLow = nonNull.map(c => c.toLowerCase());
        if (rowLow.includes('surface') && (rowLow.includes('assembly') || rowLow.includes('fenestration'))) {
          headers = row.map(c => c.trim());
          continue;
        }

        // Skip unit hint row like (ft2), (Deg)
        if (headers.length > 0 && nonNull[0].startsWith('(')) {
          continue;
        }

        if (headers.length > 0) {
          const dict = {};
          for (let i = 0; i < row.length; i++) {
            if (i < headers.length && headers[i]) {
              dict[headers[i]] = row[i].trim();
            }
          }

          const surface = dict['Surface'] || '';
          const condType = dict['Conditioning Type'] || '';
          const resNonres = dict['Res/Non-res'] || '';
          const bdlgAreaType = dict['Bdlg Area Type'] || '';
          const status = normalizeStatus(dict['Status'] || 'New');
          const mult = parseFloat(dict['Multiplier']) || 1.0;
          const az = dict['Azimuth'] || '';
          const orient = getOrientation(currentTable, az);

          if (targetOpaqueTables.includes(currentTable)) {
            const assembly = dict['Assembly'] || '';
            if (!surface && !assembly) continue;

            let areaVal = 0.0;
            const areaKeys = ['Net Area', 'Area', 'Exposed Perimeter'];
            for (let k = 0; k < areaKeys.length; k++) {
              if (dict[areaKeys[k]] && !isNaN(parseFloat(dict[areaKeys[k]]))) {
                areaVal = parseFloat(dict[areaKeys[k]]);
                break;
              }
            }
            const totArea = Math.round(areaVal * mult * 100) / 100;

            bigTable1.push({
              surface,
              surfaceType: currentTable,
              assembly,
              conditioningType: condType,
              resNonres,
              bdlgAreaType,
              status,
              multiplier: mult,
              areaPerimeter: Math.round(areaVal * 100) / 100,
              totalAreaPerimeter: totArea,
              azimuth: az,
              orientation: orient
            });
          } else if (targetFenestrationTables.includes(currentTable)) {
            const fenestration = dict['Fenestration'] || '';
            if (!surface && !fenestration) continue;

            let areaVal = 0.0;
            if (dict['Area'] && !isNaN(parseFloat(dict['Area']))) {
              areaVal = parseFloat(dict['Area']);
            }
            const totArea = Math.round(areaVal * mult * 100) / 100;

            bigTable2.push({
              surface,
              surfaceType: currentTable,
              fenestration,
              conditioningType: condType,
              resNonres,
              bdlgAreaType,
              status,
              multiplier: mult,
              area: Math.round(areaVal * 100) / 100,
              totalArea: totArea,
              azimuth: az,
              orientation: orient
            });
          }
        }
      }
    }

    // Extract unique constructions and fenestrations
    const constrSet = new Set();
    bigTable1.forEach(r => {
      if (r.assembly) constrSet.add(r.assembly);
    });
    const uniqueConstructions = Array.from(constrSet).sort();

    const fenSet = new Set();
    bigTable2.forEach(r => {
      if (r.fenestration) fenSet.add(r.fenestration);
    });
    const uniqueFenestrations = Array.from(fenSet).sort();

    return {
      success: true,
      fileName,
      bigTable1,
      bigTable2,
      constructions: uniqueConstructions,
      fenestrations: uniqueFenestrations
    };
  }

  // Compute aggregated Table 1 and Table 2 based on active selections
  function computeAggregations() {
    // 1. Table 1 Aggregation (Filter by selectedConstructions)
    const t1Map = new Map();

    state.bigTable1.forEach(row => {
      // Must be selected in construction filter
      if (!state.selectedConstructions.has(row.assembly)) {
        return;
      }

      const key = [
        row.assembly,
        row.status,
        row.bdlgAreaType,
        row.orientation,
        row.resNonres
      ].join('|||');

      const current = t1Map.get(key) || {
        key,
        modeledConstructionName: row.assembly,
        status: row.status,
        bdlgAreaType: row.bdlgAreaType,
        orientation: row.orientation,
        conditioningCategory: row.resNonres,
        netArea: 0.0,
        surfaceCount: 0
      };

      current.netArea += row.totalAreaPerimeter;
      current.surfaceCount += 1;
      t1Map.set(key, current);
    });

    state.table1Agg = Array.from(t1Map.values()).map(item => ({
      ...item,
      netArea: Math.round(item.netArea * 10) / 10
    })).sort((a, b) => {
      if (a.modeledConstructionName !== b.modeledConstructionName) {
        return a.modeledConstructionName.localeCompare(b.modeledConstructionName);
      }
      if (a.orientation !== b.orientation) {
        return a.orientation.localeCompare(b.orientation);
      }
      return a.conditioningCategory.localeCompare(b.conditioningCategory);
    });

    // 2. Table 2 Aggregation (Filter by selectedFenestrations)
    const t2Map = new Map();

    state.bigTable2.forEach(row => {
      if (!state.selectedFenestrations.has(row.fenestration)) {
        return;
      }

      const key = [
        row.fenestration,
        row.status,
        row.bdlgAreaType,
        row.orientation,
        row.resNonres
      ].join('|||');

      const current = t2Map.get(key) || {
        key,
        modeledFenestrationName: row.fenestration,
        status: row.status,
        bdlgAreaType: row.bdlgAreaType,
        orientation: row.orientation,
        conditioningCategory: row.resNonres,
        netArea: 0.0,
        surfaceCount: 0
      };

      current.netArea += row.totalArea;
      current.surfaceCount += 1;
      t2Map.set(key, current);
    });

    state.table2Agg = Array.from(t2Map.values()).map(item => ({
      ...item,
      netArea: Math.round(item.netArea * 10) / 10
    })).sort((a, b) => {
      if (a.modeledFenestrationName !== b.modeledFenestrationName) {
        return a.modeledFenestrationName.localeCompare(b.modeledFenestrationName);
      }
      return a.orientation.localeCompare(b.orientation);
    });
  }

  // Toast notification
  function showToast(title, msg, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const titleEl = document.getElementById('toast-title');
    const msgEl = document.getElementById('toast-message');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }

  // Load from Server or Fallback
  async function loadReportsData(folderPath, folderName = '', sourceTab = '') {
    state.isLoading = true;
    renderReportsWorkspace();

    try {
      // 1. Try Server API
      const res = await fetch(`/api/reports-scan?folder=${encodeURIComponent(folderPath || 'example_project_folder2')}`).then(r => r.json());
      if (res && res.success) {
        state.folderName = folderName || res.folder || folderPath;
        state.folderPath = res.folder || folderPath;
        state.csvFileName = res.fileName || '';
        state.sourceTab = sourceTab;
        state.bigTable1 = res.bigTable1 || [];
        state.bigTable2 = res.bigTable2 || [];
        state.availableConstructions = res.constructions || [];
        state.availableFenestrations = res.fenestrations || [];

        // Select all constructions by default
        state.selectedConstructions = new Set(state.availableConstructions);
        state.selectedFenestrations = new Set(state.availableFenestrations);
        state.excludedTable1Keys = new Set();
        state.excludedTable2Keys = new Set();

        computeAggregations();
        showToast('LEED Summary Loaded', `Extracted ${state.bigTable1.length} opaque & ${state.bigTable2.length} fenestration surfaces from ${res.fileName}`, 'success');
        state.isLoading = false;
        renderReportsWorkspace();
        return;
      }
    } catch (e) {
      console.warn('Server /api/reports-scan failed, trying static fetch...', e);
    }

    // 2. Static fetch fallback (for example_project_folder2 or example_project_folder)
    try {
      let targetUrl = '';
      if (folderPath && folderPath.includes('example_project_folder2')) {
        targetUrl = 'example_project_folder2/2527_Shoebox%20MDL%20-%20ap%20-%20LEEDSummary.csv';
      } else if (folderPath && folderPath.includes('example_project_folder')) {
        targetUrl = 'example_project_folder/1574_GLBH_S901G_CBECC2025%20-%20ap%20-%20LEEDSummary.csv';
      } else {
        targetUrl = 'example_project_folder2/2527_Shoebox%20MDL%20-%20ap%20-%20LEEDSummary.csv';
      }

      const csvText = await fetch(targetUrl).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });

      const parsed = parseLeedSummary(csvText, targetUrl.split('/').pop());
      if (parsed.success) {
        state.folderName = folderName || folderPath || 'example_project_folder2';
        state.folderPath = folderPath || 'example_project_folder2';
        state.csvFileName = parsed.fileName;
        state.sourceTab = sourceTab;
        state.bigTable1 = parsed.bigTable1;
        state.bigTable2 = parsed.bigTable2;
        state.availableConstructions = parsed.constructions;
        state.availableFenestrations = parsed.fenestrations;

        state.selectedConstructions = new Set(state.availableConstructions);
        state.selectedFenestrations = new Set(state.availableFenestrations);
        state.excludedTable1Keys = new Set();
        state.excludedTable2Keys = new Set();

        computeAggregations();
        showToast('Reports Ready', `Parsed sample ${parsed.fileName} in browser mode!`, 'success');
        state.isLoading = false;
        renderReportsWorkspace();
        return;
      }
    } catch (err) {
      console.error('Error loading reports data:', err);
      showToast('Load Failed', 'Could not load LEEDSummary CSV: ' + err.message, 'error');
    }

    state.isLoading = false;
    renderReportsWorkspace();
  }

  // Handle uploaded file or folder in browser
  async function handleBrowserFiles(fileList, sourceTab = 'Reports Tab') {
    if (!fileList || fileList.length === 0) return;

    let targetFile = null;

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const nameLow = f.name.toLowerCase();
      if (nameLow.endsWith('.csv') && (nameLow.endsWith(' - ap - leedsummary.csv') || (nameLow.includes('ap') && nameLow.includes('leedsummary')))) {
        targetFile = f;
        break;
      }
    }

    if (!targetFile) {
      showToast('No LEEDSummary CSV Found', 'Looking for CSV file ending with " - ap - LEEDSummary.csv"', 'error');
      return;
    }

    state.isLoading = true;
    renderReportsWorkspace();

    try {
      const text = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsText(targetFile);
      });

      const folderName = fileList[0].webkitRelativePath ? fileList[0].webkitRelativePath.split('/')[0] : 'Uploaded Files';
      const parsed = parseLeedSummary(text, targetFile.name);

      if (parsed.success) {
        state.folderName = folderName;
        state.folderPath = folderName;
        state.csvFileName = targetFile.name;
        state.sourceTab = sourceTab;
        state.bigTable1 = parsed.bigTable1;
        state.bigTable2 = parsed.bigTable2;
        state.availableConstructions = parsed.constructions;
        state.availableFenestrations = parsed.fenestrations;

        state.selectedConstructions = new Set(state.availableConstructions);
        state.selectedFenestrations = new Set(state.availableFenestrations);
        state.excludedTable1Keys = new Set();
        state.excludedTable2Keys = new Set();

        computeAggregations();

        // Broadcast to shared state
        if (window.CBECC_SHARED) {
          window.CBECC_SHARED.activeFolderName = folderName;
          window.CBECC_SHARED.activeFolderPath = folderName;
          window.CBECC_SHARED.sourceTab = 'Reports Tab';
          window.CBECC_SHARED.leedSummaryFilename = targetFile.name;
        }

        showToast('CSV Extracted Successfully', `Loaded ${targetFile.name} with ${state.bigTable1.length} opaque & ${state.bigTable2.length} fenestration surfaces`, 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Parsing Failed', e.message, 'error');
    }

    state.isLoading = false;
    renderReportsWorkspace();
  }

  // Clipboard Copiers
  async function copyToClipboard(text, successTitle, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successTitle, successMsg, 'success');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast(successTitle, successMsg, 'success');
    }
  }

  // Copy Table 1 TSV
  function copyTable1(includeHeaders = true) {
    const rows = state.table1Agg;
    if (rows.length === 0) {
      showToast('No Data', 'No active rows in Table 1 to copy.', 'error');
      return;
    }

    const tsvLines = [];
    if (includeHeaders) {
      tsvLines.push([
        'Modeled Construction Name',
        'New, Existing to Remain, or Retrofitted.',
        'Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).',
        'Orientation',
        'Building Envelope Conditioning Category',
        'Net Area, ft2'
      ].join('\t'));
    }

    rows.forEach(r => {
      tsvLines.push([
        r.modeledConstructionName,
        r.status,
        r.bdlgAreaType,
        r.orientation,
        r.conditioningCategory,
        r.netArea.toFixed(1)
      ].join('\t'));
    });

    const label = includeHeaders ? 'Table 1 with Headers' : 'Table 1 Data Only';
    copyToClipboard(
      tsvLines.join('\r\n'),
      'Copied to Clipboard!',
      `Copied ${rows.length} rows (${label}) as Tab-Separated Values for DOE Compliance Workbook.`
    );
  }

  // Copy Table 2 TSV
  function copyTable2(includeHeaders = true) {
    const rows = state.table2Agg;
    if (rows.length === 0) {
      showToast('No Data', 'No active rows in Table 2 to copy.', 'error');
      return;
    }

    const tsvLines = [];
    if (includeHeaders) {
      tsvLines.push([
        'Modeled Fenestration Name',
        'New, Existing to Remain, or Retrofitted.',
        'Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).',
        'Orientation',
        'Building Envelope Conditioning Category',
        'Net Area, ft2'
      ].join('\t'));
    }

    rows.forEach(r => {
      tsvLines.push([
        r.modeledFenestrationName,
        r.status,
        r.bdlgAreaType,
        r.orientation,
        r.conditioningCategory,
        r.netArea.toFixed(1)
      ].join('\t'));
    });

    const label = includeHeaders ? 'Table 2 with Headers' : 'Table 2 Data Only';
    copyToClipboard(
      tsvLines.join('\r\n'),
      'Copied to Clipboard!',
      `Copied ${rows.length} rows (${label}) as Tab-Separated Values for DOE Compliance Workbook.`
    );
  }

  // Copy Big Table 1 TSV
  function copyBigTable1() {
    if (state.bigTable1.length === 0) {
      showToast('No Data', 'No opaque surfaces to copy.', 'error');
      return;
    }

    const tsvLines = [];
    tsvLines.push([
      'Surface',
      'Surface Type',
      'Assembly',
      'Conditioning Type',
      'Res/Non-res',
      'Bdlg Area Type',
      'Status',
      'Multiplier',
      'Area/Perimeter',
      'Total Area/Perimeter',
      'Azimuth',
      'Orientation'
    ].join('\t'));

    state.bigTable1.forEach(r => {
      tsvLines.push([
        r.surface,
        r.surfaceType,
        r.assembly,
        r.conditioningType,
        r.resNonres,
        r.bdlgAreaType,
        r.status,
        r.multiplier,
        r.areaPerimeter,
        r.totalAreaPerimeter,
        r.azimuth,
        r.orientation
      ].join('\t'));
    });

    copyToClipboard(
      tsvLines.join('\r\n'),
      'Big Table 1 Copied!',
      `Copied ${state.bigTable1.length} surface rows as Tab-Separated Values.`
    );
  }

  // Copy Big Table 2 TSV
  function copyBigTable2() {
    if (state.bigTable2.length === 0) {
      showToast('No Data', 'No fenestration surfaces to copy.', 'error');
      return;
    }

    const tsvLines = [];
    tsvLines.push([
      'Surface',
      'Surface Type',
      'Fenestration',
      'Conditioning Type',
      'Res/Non-res',
      'Bdlg Area Type',
      'Status',
      'Multiplier',
      'Area',
      'Total Area',
      'Azimuth',
      'Orientation'
    ].join('\t'));

    state.bigTable2.forEach(r => {
      tsvLines.push([
        r.surface,
        r.surfaceType,
        r.fenestration,
        r.conditioningType,
        r.resNonres,
        r.bdlgAreaType,
        r.status,
        r.multiplier,
        r.area,
        r.totalArea,
        r.azimuth,
        r.orientation
      ].join('\t'));
    });

    copyToClipboard(
      tsvLines.join('\r\n'),
      'Big Table 2 Copied!',
      `Copied ${state.bigTable2.length} fenestration rows as Tab-Separated Values.`
    );
  }

  // SheetJS Excel (.xlsx) Export
  function exportReportsExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('Export Error', 'SheetJS library is not available.', 'error');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Table 1 Sheet
    const t1Data = [
      ['Table 1: Opaque Envelope - Baseline and Proposed Surface Areas and Properties'],
      [`Project Folder: ${state.folderName}`, `Source File: ${state.csvFileName}`, `Exported: ${new Date().toLocaleString()}`],
      [],
      ['Modeled Construction Name', 'New, Existing to Remain, or Retrofitted.', 'Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).', 'Orientation', 'Building Envelope Conditioning Category', 'Net Area, ft2']
    ];
    state.table1Agg.forEach(r => {
      t1Data.push([r.modeledConstructionName, r.status, r.bdlgAreaType, r.orientation, r.conditioningCategory, r.netArea]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(t1Data);
    XLSX.utils.book_append_sheet(wb, ws1, 'Table 1 - Opaque');

    // Table 2 Sheet
    const t2Data = [
      ['Table 2: Fenestration - Proposed Design Area, and Baseline and Proposed Properties'],
      [`Project Folder: ${state.folderName}`, `Source File: ${state.csvFileName}`, `Exported: ${new Date().toLocaleString()}`],
      [],
      ['Modeled Fenestration Name', 'New, Existing to Remain, or Retrofitted.', 'Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).', 'Orientation', 'Building Envelope Conditioning Category', 'Net Area, ft2']
    ];
    state.table2Agg.forEach(r => {
      t2Data.push([r.modeledFenestrationName, r.status, r.bdlgAreaType, r.orientation, r.conditioningCategory, r.netArea]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(t2Data);
    XLSX.utils.book_append_sheet(wb, ws2, 'Table 2 - Fenestration');

    // Intermediate Big Table 1
    const big1Data = [
      ['Surface', 'Surface Type', 'Assembly', 'Conditioning Type', 'Res/Non-res', 'Bdlg Area Type', 'Status', 'Multiplier', 'Area/Perimeter', 'Total Area/Perimeter', 'Azimuth', 'Orientation']
    ];
    state.bigTable1.forEach(r => {
      big1Data.push([r.surface, r.surfaceType, r.assembly, r.conditioningType, r.resNonres, r.bdlgAreaType, r.status, r.multiplier, r.areaPerimeter, r.totalAreaPerimeter, r.azimuth, r.orientation]);
    });
    const wsBig1 = XLSX.utils.aoa_to_sheet(big1Data);
    XLSX.utils.book_append_sheet(wb, wsBig1, 'Big Table 1 - Opaque Surfaces');

    // Intermediate Big Table 2
    const big2Data = [
      ['Surface', 'Surface Type', 'Fenestration', 'Conditioning Type', 'Res/Non-res', 'Bdlg Area Type', 'Status', 'Multiplier', 'Area', 'Total Area', 'Azimuth', 'Orientation']
    ];
    state.bigTable2.forEach(r => {
      big2Data.push([r.surface, r.surfaceType, r.fenestration, r.conditioningType, r.resNonres, r.bdlgAreaType, r.status, r.multiplier, r.area, r.totalArea, r.azimuth, r.orientation]);
    });
    const wsBig2 = XLSX.utils.aoa_to_sheet(big2Data);
    XLSX.utils.book_append_sheet(wb, wsBig2, 'Big Table 2 - Fenestration Surfaces');

    const cleanName = (state.folderName || 'Envelope_Reports').replace(/[^a-zA-Z0-9_-]/g, '_');
    XLSX.writeFile(wb, `${cleanName}_Envelope_Area_Tables.xlsx`);
    showToast('Export Completed', `Saved ${cleanName}_Envelope_Area_Tables.xlsx`, 'success');
  }

  // RENDER WORKSPACE
  function renderReportsWorkspace() {
    const container = document.getElementById('reports-workspace');
    if (!container) return;

    if (state.isLoading) {
      container.innerHTML = `
        <div class="card loading-card">
          <div class="loading-spinner"></div>
          <p>Extracting envelope surfaces from LEEDSummary CSV...</p>
        </div>
      `;
      return;
    }

    const hasData = state.bigTable1.length > 0 || state.bigTable2.length > 0;

    let html = '';

    // Top Project Banner / Folder Selector
    html += `
      <section class="card reports-header-card">
        <div class="reports-header-content">
          <div class="reports-title-block">
            <div class="reports-badge-row">
              <span class="report-type-badge">DOE Compliance Workbook</span>
              <span class="report-spec-badge">Envelope Area Tab</span>
            </div>
            <h2>Envelope Area Tables 1 &amp; 2</h2>
            <p class="reports-subhead">
              Auto-extracted and aggregated from CBECC <code>* - ap - LEEDSummary.csv</code> for direct copy-paste into DOE Compliance Workbook.
            </p>
          </div>

          <div class="reports-folder-status-box">
            ${hasData ? `
              <div class="folder-linked-indicator">
                <span class="status-dot green"></span>
                <div class="folder-meta">
                  <strong>Active Folder: ${escapeHtml(state.folderName || 'Selected Project')}</strong>
                  <span class="file-path-hint">Found: <code>${escapeHtml(state.csvFileName || '...')}</code></span>
                  ${state.sourceTab ? `<span class="source-tab-tag">Linked from ${escapeHtml(state.sourceTab)}</span>` : ''}
                </div>
              </div>
              <div class="folder-switch-actions">
                <button type="button" id="rep-change-folder-btn" class="btn btn-outline btn-sm">Change Folder / File</button>
              </div>
            ` : `
              <div class="folder-empty-indicator">
                <span class="status-dot yellow"></span>
                <span>No Project Folder Selected Yet</span>
              </div>
            `}
          </div>
        </div>

        ${!hasData ? `
          <!-- Ingestion Drop Area when no folder loaded -->
          <div class="reports-drop-grid">
            <div class="source-box drop-box reports-drop-box" id="reports-drop-zone">
              <input type="file" id="reports-folder-input" webkitdirectory directory multiple class="hidden-file-input" />
              <input type="file" id="reports-file-input" accept=".csv" class="hidden-file-input" />
              <div class="drop-content">
                <div class="drop-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </div>
                <div class="drop-text">
                  <strong>Drop Project Run Folder or LEEDSummary CSV</strong>
                  <p>Auto-detects <code>* - ap - LEEDSummary.csv</code> in folder</p>
                </div>
                <div class="drop-actions">
                  <button type="button" id="reports-browse-folder-btn" class="btn btn-primary btn-sm">Choose Folder</button>
                  <button type="button" id="reports-browse-file-btn" class="btn btn-outline btn-sm">Choose CSV File</button>
                </div>
              </div>
            </div>

            <div class="reports-sample-shortcuts">
              <h4>Quick Load Example Projects</h4>
              <p>Test with included sample model runs:</p>
              <div class="sample-btn-group">
                <button type="button" id="rep-load-sample2-btn" class="btn btn-secondary">
                  ⚡ Load Example 2 (example_project_folder2)
                </button>
                <button type="button" id="rep-load-sample1-btn" class="btn btn-secondary">
                  ⚡ Load Example 1 (example_project_folder)
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </section>
    `;

    if (!hasData) {
      container.innerHTML = html;
      bindReportsEvents();
      return;
    }

    // Sub-view switcher tabs
    html += `
      <div class="reports-view-switcher">
        <div class="segmented-control" id="reports-subtab-control">
          <button type="button" class="seg-btn ${state.subView === 'compliance-tables' ? 'active' : ''}" data-sub="compliance-tables">
            📋 Compliance Tables (DOE Table 1 &amp; 2)
          </button>
          <button type="button" class="seg-btn ${state.subView === 'big-tables' ? 'active' : ''}" data-sub="big-tables">
            🔍 Intermediate Big Tables (${state.bigTable1.length + state.bigTable2.length} Surfaces)
          </button>
        </div>

        <div class="reports-global-actions">
          <button type="button" id="rep-export-excel-btn" class="btn btn-outline btn-sm" title="Export Table 1, Table 2 and Big Tables to formatted Excel file">
            📥 Download Excel (.xlsx)
          </button>
        </div>
      </div>
    `;

    if (state.subView === 'compliance-tables') {
      html += renderComplianceTablesView();
    } else {
      html += renderBigTablesView();
    }

    container.innerHTML = html;
    bindReportsEvents();
  }

  // Render Table 1 & Table 2
  // Render Table 1 & Table 2
  function renderComplianceTablesView() {
    const totalT1Area = state.table1Agg.reduce((sum, r) => sum + r.netArea, 0);
    const totalT2Area = state.table2Agg.reduce((sum, r) => sum + r.netArea, 0);

    return `
      <!-- TABLE 1 SECTION -->
      <section class="card report-table-card" id="table-1-section">
        <div class="card-header report-card-header">
          <div class="report-title-group">
            <div>
              <h3>Table 1: Opaque Envelope - Baseline and Proposed Surface Areas and Properties</h3>
              <p class="table-subtitle">Proposed surfaces extracted from LEEDSummary CSV. Ready to copy and paste into DOE Compliance Workbook Envelope Area Tab.</p>
            </div>
          </div>

          <div class="report-header-actions">
            <button type="button" id="rep-copy-t1-data-btn" class="btn btn-primary btn-sm" title="Copy data rows only without header row, perfect for pasting into existing workbook starting at cell A2">
              📋 Copy Data Only (No Headers)
            </button>
            <button type="button" id="rep-copy-t1-all-btn" class="btn btn-outline btn-sm" title="Copy table including header row">
              📋 Copy With Headers
            </button>
          </div>
        </div>

        <!-- Filter & De-selection Controls for Constructions -->
        <div class="construction-filter-toolbar">
          <div class="filter-headline">
            <strong>Modeled Constructions to Report:</strong>
            <span class="filter-count-badge">${state.selectedConstructions.size} of ${state.availableConstructions.length} selected</span>
          </div>

          <div class="filter-actions-bar">
            <div class="filter-quick-presets">
              <button type="button" id="rep-t1-select-all" class="btn-link">Select All</button>
              <span class="divider">|</span>
              <button type="button" id="rep-t1-deselect-all" class="btn-link">Deselect All</button>
              <span class="divider">|</span>
              <button type="button" id="rep-t1-exterior-only" class="btn-link text-accent" title="Deselect Interior Wall & Interior Floor since they are not part of the exterior opaque envelope">
                ⭐ Exterior Envelope Only (Exclude Interior)
              </button>
            </div>
          </div>

          <!-- Construction Checkbox Chips -->
          <div class="construction-chips-grid">
            ${state.availableConstructions.map(cName => {
              const isChecked = state.selectedConstructions.has(cName);
              const count = state.bigTable1.filter(r => r.assembly === cName).length;
              const isInterior = cName.toLowerCase().includes('interior');
              return `
                <label class="construction-chip ${isChecked ? 'active' : ''} ${isInterior ? 'chip-interior' : ''}">
                  <input type="checkbox" class="construction-toggle" data-construction="${escapeHtml(cName)}" ${isChecked ? 'checked' : ''} />
                  <span class="chip-label">${escapeHtml(cName)}</span>
                  <span class="chip-count">${count}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Table 1 Data View -->
        <div class="table-responsive reports-table-wrapper">
          <table class="data-table reports-table" id="compliance-table-1">
            <thead>
              <tr>
                <th style="width: 25%;">Modeled Construction Name</th>
                <th style="width: 15%;">New, Existing to Remain, or Retrofitted.</th>
                <th style="width: 27%;">Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).</th>
                <th style="width: 11%;">Orientation</th>
                <th style="width: 11%;">Building Envelope Conditioning Category</th>
                <th style="width: 11%;" class="text-right">Net Area, ft2</th>
              </tr>
            </thead>
            <tbody>
              ${state.table1Agg.length === 0 ? `
                <tr>
                  <td colspan="6" class="text-center empty-cell">No constructions selected. Check one or more constructions above.</td>
                </tr>
              ` : state.table1Agg.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.modeledConstructionName)}</strong></td>
                  <td><span class="status-pill status-${escapeHtml(row.status.toLowerCase().replace(/[^a-z]/g, ''))}">${escapeHtml(row.status)}</span></td>
                  <td>${escapeHtml(row.bdlgAreaType || 'NA')}</td>
                  <td><span class="orient-pill orient-${escapeHtml(row.orientation.toLowerCase())}">${escapeHtml(row.orientation)}</span></td>
                  <td>${escapeHtml(row.conditioningCategory || 'NA')}</td>
                  <td class="text-right font-mono font-bold">${formatNumber(row.netArea, 1)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="table-total-row">
                <td colspan="5" class="text-right"><strong>Total Opaque Net Area:</strong></td>
                <td class="text-right font-mono font-bold text-accent">${formatNumber(totalT1Area, 1)} ft²</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- TABLE 2 SECTION -->
      <section class="card report-table-card" id="table-2-section">
        <div class="card-header report-card-header">
          <div class="report-title-group">
            <div>
              <h3>Table 2: Fenestration - Proposed Design Area, and Baseline and Proposed Properties</h3>
              <p class="table-subtitle">Vertical fenestration and skylights extracted from LEEDSummary CSV. Ready to copy and paste into DOE Compliance Workbook Envelope Area Tab.</p>
            </div>
          </div>

          <div class="report-header-actions">
            <button type="button" id="rep-copy-t2-data-btn" class="btn btn-primary btn-sm" title="Copy data rows only without header row, perfect for pasting into existing workbook starting at cell A2">
              📋 Copy Data Only (No Headers)
            </button>
            <button type="button" id="rep-copy-t2-all-btn" class="btn btn-outline btn-sm" title="Copy table including header row">
              📋 Copy With Headers
            </button>
          </div>
        </div>

        <!-- Filter & De-selection Controls for Fenestrations -->
        <div class="construction-filter-toolbar">
          <div class="filter-headline">
            <strong>Modeled Fenestrations to Report:</strong>
            <span class="filter-count-badge">${state.selectedFenestrations.size} of ${state.availableFenestrations.length} selected</span>
          </div>

          <div class="filter-actions-bar">
            <div class="filter-quick-presets">
              <button type="button" id="rep-t2-select-all" class="btn-link">Select All</button>
              <span class="divider">|</span>
              <button type="button" id="rep-t2-deselect-all" class="btn-link">Deselect All</button>
            </div>
          </div>

          <!-- Fenestration Checkbox Chips -->
          <div class="construction-chips-grid">
            ${state.availableFenestrations.map(fName => {
              const isChecked = state.selectedFenestrations.has(fName);
              const count = state.bigTable2.filter(r => r.fenestration === fName).length;
              return `
                <label class="construction-chip ${isChecked ? 'active' : ''}">
                  <input type="checkbox" class="fenestration-toggle" data-fenestration="${escapeHtml(fName)}" ${isChecked ? 'checked' : ''} />
                  <span class="chip-label">${escapeHtml(fName)}</span>
                  <span class="chip-count">${count}</span>
                </label>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Table 2 Data View -->
        <div class="table-responsive reports-table-wrapper">
          <table class="data-table reports-table" id="compliance-table-2">
            <thead>
              <tr>
                <th style="width: 25%;">Modeled Fenestration Name</th>
                <th style="width: 15%;">New, Existing to Remain, or Retrofitted.</th>
                <th style="width: 27%;">Building Area Type (for Appendix G Projects Only, 90.1 Section G3.1.1-1).</th>
                <th style="width: 11%;">Orientation</th>
                <th style="width: 11%;">Building Envelope Conditioning Category</th>
                <th style="width: 11%;" class="text-right">Net Area, ft2</th>
              </tr>
            </thead>
            <tbody>
              ${state.table2Agg.length === 0 ? `
                <tr>
                  <td colspan="6" class="text-center empty-cell">No fenestrations selected. Check one or more fenestrations above.</td>
                </tr>
              ` : state.table2Agg.map((row) => `
                <tr>
                  <td><strong>${escapeHtml(row.modeledFenestrationName)}</strong></td>
                  <td><span class="status-pill status-${escapeHtml(row.status.toLowerCase().replace(/[^a-z]/g, ''))}">${escapeHtml(row.status)}</span></td>
                  <td>${escapeHtml(row.bdlgAreaType || 'NA')}</td>
                  <td><span class="orient-pill orient-${escapeHtml(row.orientation.toLowerCase())}">${escapeHtml(row.orientation)}</span></td>
                  <td>${escapeHtml(row.conditioningCategory || 'NA')}</td>
                  <td class="text-right font-mono font-bold">${formatNumber(row.netArea, 1)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="table-total-row">
                <td colspan="5" class="text-right"><strong>Total Fenestration Net Area:</strong></td>
                <td class="text-right font-mono font-bold text-accent">${formatNumber(totalT2Area, 1)} ft²</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    `;
  }

  // Render Intermediate Big Tables
  function renderBigTablesView() {
    return `
      <!-- BIG TABLE 1: OPAQUE -->
      <section class="card report-table-card">
        <div class="card-header report-card-header">
          <div>
            <h3>Combined Big Table 1: All Extracted Opaque Surfaces (${state.bigTable1.length} Surfaces)</h3>
            <p class="table-subtitle">Extracted from Roof, Exterior Wall, Exterior Floor, Underground Wall, Underground Floor, Interior Wall, and Interior Floor.</p>
          </div>
          <button type="button" id="rep-copy-big1-btn" class="btn btn-outline btn-sm">📋 Copy Big Table 1 (TSV)</button>
        </div>

        <div class="table-responsive reports-table-wrapper max-height-table">
          <table class="data-table raw-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Surface</th>
                <th>Surface Type</th>
                <th>Assembly</th>
                <th>Conditioning Type</th>
                <th>Res/Non-res</th>
                <th>Bdlg Area Type</th>
                <th>Status</th>
                <th class="text-right">Multiplier</th>
                <th class="text-right">Area/Perimeter</th>
                <th class="text-right">Total Area/Perimeter</th>
                <th>Azimuth</th>
                <th>Orientation</th>
              </tr>
            </thead>
            <tbody>
              ${state.bigTable1.map((r, i) => `
                <tr>
                  <td class="text-muted">${i + 1}</td>
                  <td><strong>${escapeHtml(r.surface)}</strong></td>
                  <td><span class="surface-type-badge">${escapeHtml(r.surfaceType)}</span></td>
                  <td>${escapeHtml(r.assembly)}</td>
                  <td>${escapeHtml(r.conditioningType)}</td>
                  <td>${escapeHtml(r.resNonres)}</td>
                  <td>${escapeHtml(r.bdlgAreaType)}</td>
                  <td>${escapeHtml(r.status)}</td>
                  <td class="text-right font-mono">${r.multiplier}</td>
                  <td class="text-right font-mono">${formatNumber(r.areaPerimeter, 1)}</td>
                  <td class="text-right font-mono font-bold">${formatNumber(r.totalAreaPerimeter, 1)}</td>
                  <td>${escapeHtml(r.azimuth)}</td>
                  <td>${escapeHtml(r.orientation)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <!-- BIG TABLE 2: FENESTRATION -->
      <section class="card report-table-card">
        <div class="card-header report-card-header">
          <div>
            <h3>Combined Big Table 2: All Extracted Fenestration Surfaces (${state.bigTable2.length} Surfaces)</h3>
            <p class="table-subtitle">Extracted from Vertical Fenestration and Skylight.</p>
          </div>
          <button type="button" id="rep-copy-big2-btn" class="btn btn-outline btn-sm">📋 Copy Big Table 2 (TSV)</button>
        </div>

        <div class="table-responsive reports-table-wrapper max-height-table">
          <table class="data-table raw-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Surface</th>
                <th>Surface Type</th>
                <th>Fenestration</th>
                <th>Conditioning Type</th>
                <th>Res/Non-res</th>
                <th>Bdlg Area Type</th>
                <th>Status</th>
                <th class="text-right">Multiplier</th>
                <th class="text-right">Area</th>
                <th class="text-right">Total Area</th>
                <th>Azimuth</th>
                <th>Orientation</th>
              </tr>
            </thead>
            <tbody>
              ${state.bigTable2.map((r, i) => `
                <tr>
                  <td class="text-muted">${i + 1}</td>
                  <td><strong>${escapeHtml(r.surface)}</strong></td>
                  <td><span class="surface-type-badge">${escapeHtml(r.surfaceType)}</span></td>
                  <td>${escapeHtml(r.fenestration)}</td>
                  <td>${escapeHtml(r.conditioningType)}</td>
                  <td>${escapeHtml(r.resNonres)}</td>
                  <td>${escapeHtml(r.bdlgAreaType)}</td>
                  <td>${escapeHtml(r.status)}</td>
                  <td class="text-right font-mono">${r.multiplier}</td>
                  <td class="text-right font-mono">${formatNumber(r.area, 1)}</td>
                  <td class="text-right font-mono font-bold">${formatNumber(r.totalArea, 1)}</td>
                  <td>${escapeHtml(r.azimuth)}</td>
                  <td>${escapeHtml(r.orientation)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // Event Listeners Binding
  function bindReportsEvents() {
    // Drop Zone & File Browsing
    const dropZone = document.getElementById('reports-drop-zone');
    const folderInput = document.getElementById('reports-folder-input');
    const fileInput = document.getElementById('reports-file-input');
    const browseFolderBtn = document.getElementById('reports-browse-folder-btn');
    const browseFileBtn = document.getElementById('reports-browse-file-btn');
    const changeFolderBtn = document.getElementById('rep-change-folder-btn');
    const loadSample2Btn = document.getElementById('rep-load-sample2-btn');
    const loadSample1Btn = document.getElementById('rep-load-sample1-btn');

    if (browseFolderBtn && folderInput) {
      browseFolderBtn.addEventListener('click', () => folderInput.click());
    }
    if (browseFileBtn && fileInput) {
      browseFileBtn.addEventListener('click', () => fileInput.click());
    }
    if (folderInput) {
      folderInput.addEventListener('change', e => handleBrowserFiles(e.target.files, 'Reports Tab Folder'));
    }
    if (fileInput) {
      fileInput.addEventListener('change', e => handleBrowserFiles(e.target.files, 'Reports Tab CSV'));
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleBrowserFiles(e.dataTransfer.files, 'Reports Tab Drag-and-Drop');
        }
      });
    }

    if (changeFolderBtn) {
      changeFolderBtn.addEventListener('click', () => {
        state.bigTable1 = [];
        state.bigTable2 = [];
        state.table1Agg = [];
        state.table2Agg = [];
        renderReportsWorkspace();
      });
    }

    if (loadSample2Btn) {
      loadSample2Btn.addEventListener('click', () => loadReportsData('example_project_folder2', 'example_project_folder2', 'Example 2 Button'));
    }
    if (loadSample1Btn) {
      loadSample1Btn.addEventListener('click', () => loadReportsData('example_project_folder', 'example_project_folder', 'Example 1 Button'));
    }

    // Sub-view switcher
    const subtabBtns = document.querySelectorAll('#reports-subtab-control .seg-btn');
    subtabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.subView = btn.getAttribute('data-sub');
        renderReportsWorkspace();
      });
    });

    // Excel Export
    const exportExcelBtn = document.getElementById('rep-export-excel-btn');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', exportReportsExcel);
    }

    // Table 1 Copy Buttons
    const copyT1DataBtn = document.getElementById('rep-copy-t1-data-btn');
    if (copyT1DataBtn) copyT1DataBtn.addEventListener('click', () => copyTable1(false));

    const copyT1AllBtn = document.getElementById('rep-copy-t1-all-btn');
    if (copyT1AllBtn) copyT1AllBtn.addEventListener('click', () => copyTable1(true));

    // Table 2 Copy Buttons
    const copyT2DataBtn = document.getElementById('rep-copy-t2-data-btn');
    if (copyT2DataBtn) copyT2DataBtn.addEventListener('click', () => copyTable2(false));

    const copyT2AllBtn = document.getElementById('rep-copy-t2-all-btn');
    if (copyT2AllBtn) copyT2AllBtn.addEventListener('click', () => copyTable2(true));

    // Big Tables Copy
    const copyBig1Btn = document.getElementById('rep-copy-big1-btn');
    if (copyBig1Btn) copyBig1Btn.addEventListener('click', copyBigTable1);

    const copyBig2Btn = document.getElementById('rep-copy-big2-btn');
    if (copyBig2Btn) copyBig2Btn.addEventListener('click', copyBigTable2);

    // Construction Filter Toggles
    const constrToggles = document.querySelectorAll('.construction-toggle');
    constrToggles.forEach(cb => {
      cb.addEventListener('change', () => {
        const cName = cb.getAttribute('data-construction');
        if (cb.checked) {
          state.selectedConstructions.add(cName);
        } else {
          state.selectedConstructions.delete(cName);
        }
        computeAggregations();
        renderReportsWorkspace();
      });
    });

    const t1SelectAll = document.getElementById('rep-t1-select-all');
    if (t1SelectAll) {
      t1SelectAll.addEventListener('click', () => {
        state.selectedConstructions = new Set(state.availableConstructions);
        computeAggregations();
        renderReportsWorkspace();
      });
    }

    const t1DeselectAll = document.getElementById('rep-t1-deselect-all');
    if (t1DeselectAll) {
      t1DeselectAll.addEventListener('click', () => {
        state.selectedConstructions.clear();
        computeAggregations();
        renderReportsWorkspace();
      });
    }

    const t1ExteriorOnly = document.getElementById('rep-t1-exterior-only');
    if (t1ExteriorOnly) {
      t1ExteriorOnly.addEventListener('click', () => {
        state.selectedConstructions = new Set(
          state.availableConstructions.filter(c => !c.toLowerCase().includes('interior'))
        );
        computeAggregations();
        showToast('Filter Applied', 'Interior walls & floors excluded from Table 1.', 'info');
        renderReportsWorkspace();
      });
    }

    // Fenestration Filter Toggles
    const fenToggles = document.querySelectorAll('.fenestration-toggle');
    fenToggles.forEach(cb => {
      cb.addEventListener('change', () => {
        const fName = cb.getAttribute('data-fenestration');
        if (cb.checked) {
          state.selectedFenestrations.add(fName);
        } else {
          state.selectedFenestrations.delete(fName);
        }
        computeAggregations();
        renderReportsWorkspace();
      });
    });

    const t2SelectAll = document.getElementById('rep-t2-select-all');
    if (t2SelectAll) {
      t2SelectAll.addEventListener('click', () => {
        state.selectedFenestrations = new Set(state.availableFenestrations);
        computeAggregations();
        renderReportsWorkspace();
      });
    }

    const t2DeselectAll = document.getElementById('rep-t2-deselect-all');
    if (t2DeselectAll) {
      t2DeselectAll.addEventListener('click', () => {
        state.selectedFenestrations.clear();
        computeAggregations();
        renderReportsWorkspace();
      });
    }
  }

  // Formatting utility
  function formatNumber(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return '0.0';
    return Number(val).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Public Module API
  window.ReportsModule = {
    init: function () {
      renderReportsWorkspace();

      // Check shared state if a folder was already selected in another tab
      if (window.CBECC_SHARED && (window.CBECC_SHARED.activeFolderPath || window.CBECC_SHARED.activeFolderName)) {
        this.onSharedFolderUpdated(
          window.CBECC_SHARED.activeFolderPath,
          window.CBECC_SHARED.activeFolderName,
          window.CBECC_SHARED.sourceTab,
          window.CBECC_SHARED.filesList
        );
      }
    },

    render: function () {
      // If we don't have data loaded yet, but shared state has a folder, load it!
      if (state.bigTable1.length === 0 && window.CBECC_SHARED && (window.CBECC_SHARED.activeFolderPath || window.CBECC_SHARED.activeFolderName)) {
        this.onSharedFolderUpdated(
          window.CBECC_SHARED.activeFolderPath,
          window.CBECC_SHARED.activeFolderName,
          window.CBECC_SHARED.sourceTab,
          window.CBECC_SHARED.filesList
        );
      } else {
        renderReportsWorkspace();
      }
    },

    onSharedFolderUpdated: function (folderPath, folderName, sourceTab, fileList = null) {
      if (fileList && fileList.length > 0) {
        handleBrowserFiles(fileList, sourceTab);
      } else if (folderPath || folderName) {
        loadReportsData(folderPath || folderName, folderName || folderPath, sourceTab);
      }
    },

    getState: function () {
      return state;
    }
  };

})();
