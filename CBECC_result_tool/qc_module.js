/**
 * qc_module.js - CBECC Model Quality Control (QC) Analysis & Validation Workspace
 * Handles extraction, cross-comparison, and interactive UI for:
 *   1. Time Setpoint Not Met (Unmet Hours)
 *   2. Energy & Water Comparisons vs CBECC Model Workbook (QC tab)
 *   3. Lighting & Receptacle Schedules Equivalent Full Load Hours
 *   4. Opaque and Fenestration constructions vs .ibd-Detail ConsAssm/FenCons
 *   5. Minimum Outdoor Air Mechanical Ventilation vs .ibd-Detail ThrmlZn
 */

(function (window) {
  'use strict';

  // State
  const state = {
    folderData: null,       // { ab1: {...}, ap: {...}, hasAb1: bool, hasAp: bool, folderName: str }
    workbookData: null,     // { categories: [ { category, baseline, proposed } ] }
    activeScenario: 'ap',   // 'ap' or 'ab1'
    unmetFilter: 'warn',    // 'warn' (> 150 hrs), 'zero' (> 0 hrs), 'all'
    unmetSort: 'orig',      // 'orig', 'heat_desc', 'cool_desc', 'name_asc'
    envelopeSubtab: 'opaque', // 'opaque', 'fenestration'
    ventSearch: '',
    ventSpaceType: 'all',
    ventSortCol: 'zoneName',
    ventSortDir: 'asc'
  };

  // Helper: safe float
  function safeFloat(val, fallback = 0.0) {
    if (val === null || val === undefined) return fallback;
    const s = String(val).replace(/,/g, '').trim();
    const num = parseFloat(s);
    return isNaN(num) ? fallback : num;
  }

  // Helper: format number
  function fmtNum(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    return Number(val).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  // Baseline factor parser: F073 -> F-Factor: 0.73, C1140 -> C-Factor: 1.14, U124 -> U-Factor: 0.124
  function extractBaselineFactor(name) {
    if (!name) return '';
    const m = name.match(/([FCU])(\d+)/i);
    if (!m) return '';
    const kind = m[1].toUpperCase();
    const val = safeFloat(m[2]);
    if (kind === 'F') {
      const f = (val / 100).toFixed(2).replace(/\.?0+$/, '');
      return `F-Factor: ${f}`;
    } else if (kind === 'C') {
      const c = (val / 1000).toFixed(3).replace(/\.?0+$/, '');
      return `C-Factor: ${c}`;
    } else if (kind === 'U') {
      const u = (val / 1000).toFixed(3).replace(/\.?0+$/, '');
      return `U-Factor: ${u}`;
    }
    return '';
  }

  // Helper to find ThrmlZn by name with robust prefix and normalization fallbacks
  function findThrmlZn(thrmlZnDict, rawZName) {
    if (!thrmlZnDict || !rawZName) return null;
    const lName = rawZName.trim().toLowerCase();
    if (thrmlZnDict[lName]) return thrmlZnDict[lName];

    // Try stripping or adding "thermal zone: " prefix
    const stripped = lName.replace(/^thermal zone:\s*/i, '').trim();
    if (thrmlZnDict[stripped]) return thrmlZnDict[stripped];

    const withPrefix = ('thermal zone: ' + stripped).trim();
    if (thrmlZnDict[withPrefix]) return thrmlZnDict[withPrefix];

    // Fallback: match by alphanumeric normalization
    const normKey = lName.replace(/[^a-z0-9]/g, '');
    for (const [k, obj] of Object.entries(thrmlZnDict)) {
      if (k.replace(/[^a-z0-9]/g, '') === normKey) {
        return obj;
      }
    }
    return null;
  }

  // Parse .ibd-Detail text in JavaScript
  function parseIbdDetailText(text) {
    const components = { ConsAssm: {}, FenCons: {}, ThrmlZn: {} };
    if (!text) return components;

    // Component block starts with CompType User: "Name" and terminates at .. line
    const compRegex = /^([A-Za-z0-9_]+)\s+User:\s*"([^"]+)"\s*\r?\n([\s\S]*?)(?=^\s*\.\.)/gm;
    let match;
    while ((match = compRegex.exec(text)) !== null) {
      const cType = match[1];
      const cName = match[2].trim();
      const body = match[3];

      if (!components[cType]) components[cType] = {};

      const props = {};
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith(';')) continue;
        const propMatch = line.match(/^([A-Za-z0-9_\[\]]+)\s*=\s*(?:[A-Za-z]+:\s*)?(.*)$/);
        if (propMatch) {
          const pKey = propMatch[1];
          const rawVal = propMatch[2].trim();
          let val = rawVal;
          const strM = rawVal.match(/^"([^"]*)"/);
          if (strM) {
            val = strM[1];
          } else {
            const numM = rawVal.match(/^([+-]?[0-9]+(?:\.[0-9]+)?)/);
            if (numM) val = numM[1];
          }
          props[pKey] = val;
          props[pKey.toLowerCase()] = val;
        }
      }

      components[cType][cName.toLowerCase()] = {
        name: cName,
        props: props
      };
    }
    return components;
  }

  // Helper to extract table by FullName comment or fallback title
  function extractTableByMarker(htmlDoc, markerText) {
    // 1. Look for HTML comment containing markerText
    const iterator = htmlDoc.createNodeIterator(htmlDoc, NodeFilter.SHOW_COMMENT, null);
    let commentNode;
    while ((commentNode = iterator.nextNode())) {
      if (commentNode.nodeValue && commentNode.nodeValue.includes(markerText)) {
        // Table is the next sibling table element
        let sib = commentNode.nextSibling;
        while (sib) {
          if (sib.nodeType === 1 && sib.tagName && sib.tagName.toLowerCase() === 'table') {
            return parseHtmlTable(sib);
          }
          sib = sib.nextSibling;
        }
      }
    }

    // 2. Fallback: Search <b> or <p> tags with title
    const boldTags = htmlDoc.querySelectorAll('b, h2, h3, h4, p');
    for (let i = 0; i < boldTags.length; i++) {
      const el = boldTags[i];
      if (el.textContent && el.textContent.trim().toLowerCase() === markerText.toLowerCase()) {
        let sib = el.nextElementSibling;
        while (sib) {
          if (sib.tagName && sib.tagName.toLowerCase() === 'table') {
            return parseHtmlTable(sib);
          }
          sib = sib.nextElementSibling;
        }
      }
    }
    return null;
  }

  function parseHtmlTable(tableEl) {
    const rows = [];
    const trs = tableEl.querySelectorAll('tr');
    trs.forEach(tr => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach(c => {
        cells.push(c.textContent ? c.textContent.trim() : '');
      });
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  }

  // Client-side parser for EnergyPlus HTML
  function parseQcHtm(htmlString, scenario, ibdComponents) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // 1. Time Setpoint Not Met
    const unmetRows = extractTableByMarker(doc, 'FullName:System Summary_Entire Facility_Time Setpoint Not Met')
      || extractTableByMarker(doc, 'Time Setpoint Not Met');

    const zonesUnmet = [];
    let facilityUnmet = { heating: 0, cooling: 0, exceeds150: false };
    let hasUnmetWarning = false;

    if (unmetRows && unmetRows.length > 1) {
      for (let i = 1; i < unmetRows.length; i++) {
        const r = unmetRows[i];
        if (!r || !r[0]) continue;
        const zName = r[0].trim();
        const heatHr = r.length > 3 ? safeFloat(r[3]) : 0;
        const coolHr = r.length > 4 ? safeFloat(r[4]) : 0;

        if (zName.toLowerCase() === 'facility') {
          facilityUnmet = {
            heating: heatHr,
            cooling: coolHr,
            exceeds150: (heatHr > 150 || coolHr > 150)
          };
          continue;
        }

        const exceeds150 = (heatHr > 150 || coolHr > 150);
        const exceeds0 = (heatHr > 0 || coolHr > 0);
        if (exceeds150) hasUnmetWarning = true;

        zonesUnmet.push({
          zone: zName,
          heatingHours: heatHr,
          coolingHours: coolHr,
          exceeds150: exceeds150,
          exceeds0: exceeds0
        });
      }
    }

    // 2. Compliance Energy
    const compRows = extractTableByMarker(doc, 'FullName:LEED Summary_Entire Facility_EAp2-4/5. Performance Rating Method Compliance')
      || extractTableByMarker(doc, 'Performance Rating Method Compliance');
    const complianceMap = {};
    if (compRows && compRows.length > 1) {
      for (let i = 1; i < compRows.length; i++) {
        const r = compRows[i];
        if (!r || !r[0]) continue;
        const cat = r[0].trim();
        const elec = r.length > 1 ? safeFloat(r[1]) : 0;
        const gas = r.length > 3 ? safeFloat(r[3]) : 0;
        complianceMap[cat] = {
          electricity_kWh: elec,
          naturalGas_therm: gas
        };
      }
    }

    // End Uses (Water Systems)
    const endUseRows = extractTableByMarker(doc, 'FullName:Annual Building Utility Performance Summary_Entire Facility_End Uses')
      || extractTableByMarker(doc, 'End Uses');
    const endUsesMap = {};
    if (endUseRows && endUseRows.length > 1) {
      for (let i = 1; i < endUseRows.length; i++) {
        const r = endUseRows[i];
        if (!r || !r[0]) continue;
        const cat = r[0].trim();
        const water = safeFloat(r[r.length - 1]);
        endUsesMap[cat] = { water_gal: water };
      }
    }

    // Schedules
    const schedRows = extractTableByMarker(doc, 'FullName:LEED Summary_Entire Facility_Schedules-Equivalent Full Load Hours')
      || extractTableByMarker(doc, 'Schedules-Equivalent Full Load Hours');
    const lightScheds = [];
    const recepScheds = [];
    if (schedRows && schedRows.length > 1) {
      for (let i = 1; i < schedRows.length; i++) {
        const r = schedRows[i];
        if (!r || !r[0]) continue;
        const sName = r[0].trim();
        const eflh = r.length > 1 ? safeFloat(r[1]) : 0;
        const item = { scheduleName: sName, eflh: eflh };
        if (sName.toUpperCase().includes('LIGHT')) lightScheds.push(item);
        if (sName.toUpperCase().includes('RECEPTACLE')) recepScheds.push(item);
      }
    }

    // 3. Envelope
    const consAssmDict = (ibdComponents && ibdComponents.ConsAssm) || {};
    const fenConsDict = (ibdComponents && ibdComponents.FenCons) || {};

    function getCbeccConsRef(rawConsName) {
      const key = rawConsName.toLowerCase();
      if (consAssmDict[key]) {
        const props = consAssmDict[key].props || {};
        const factors = [];
        if (props.UFactor && safeFloat(props.UFactor) > 0) factors.push(`U-Factor: ${safeFloat(props.UFactor).toFixed(4)}`);
        if (props.CFactor && safeFloat(props.CFactor) > 0) factors.push(`C-Factor: ${safeFloat(props.CFactor).toFixed(4)}`);
        if (props.FFactor && safeFloat(props.FFactor) > 0) factors.push(`F-Factor: ${safeFloat(props.FFactor).toFixed(4)}`);
        return factors.length > 0 ? factors.join(', ') : 'Found in CBECC';
      }
      return 'Not in CBECC';
    }

    // A. Opaque Exterior
    const extRows = extractTableByMarker(doc, 'FullName:Envelope Summary_Entire Facility_Opaque Exterior')
      || extractTableByMarker(doc, 'Opaque Exterior');
    const extMap = {};
    if (extRows && extRows.length > 1) {
      for (let i = 1; i < extRows.length; i++) {
        const r = extRows[i];
        if (!r || r.length < 9) continue;
        const surface = r[0].trim();
        let cleanCons = r[1].trim();
        if (cleanCons.toUpperCase().startsWith(surface.toUpperCase())) {
          cleanCons = cleanCons.substring(surface.length).trim();
        }
        const uFilm = safeFloat(r[5]);
        const uNoFilm = safeFloat(r[6]);
        const netArea = safeFloat(r[8]);
        const key = cleanCons.toUpperCase();

        if (!extMap[key]) {
          extMap[key] = {
            construction: cleanCons,
            uFactorWithFilm: uFilm,
            uFactorNoFilm: uNoFilm,
            netArea: 0,
            referenceFactor: ''
          };
        }
        extMap[key].netArea += netArea;
      }
    }

    Object.keys(extMap).forEach(k => {
      const item = extMap[k];
      if (scenario === 'ap') {
        const m = consAssmDict[item.construction.toLowerCase()];
        if (m) item.construction = m.name;
        item.referenceFactor = getCbeccConsRef(item.construction);
      } else {
        item.referenceFactor = extractBaselineFactor(item.construction);
      }
    });

    // B. Opaque Interior
    const intRows = extractTableByMarker(doc, 'FullName:Envelope Summary_Entire Facility_Opaque Interior')
      || extractTableByMarker(doc, 'Opaque Interior');
    const intMap = {};
    if (intRows && intRows.length > 1) {
      for (let i = 1; i < intRows.length; i++) {
        const r = intRows[i];
        if (!r || r.length < 9) continue;
        const surface = r[0].trim();
        let cleanCons = r[1].trim();
        if (cleanCons.toUpperCase().startsWith(surface.toUpperCase())) {
          cleanCons = cleanCons.substring(surface.length).trim();
        }
        // Merge REVERSED per user instruction
        if (cleanCons.toUpperCase().endsWith(' REVERSED')) {
          cleanCons = cleanCons.slice(0, -9).trim();
        }
        const uFilm = safeFloat(r[6]);
        const uNoFilm = safeFloat(r[7]);
        const netArea = r.length > 9 ? safeFloat(r[9]) : safeFloat(r[8]);
        const key = cleanCons.toUpperCase();

        if (!intMap[key]) {
          intMap[key] = {
            construction: cleanCons,
            uFactorWithFilm: uFilm,
            uFactorNoFilm: uNoFilm,
            netArea: 0,
            referenceFactor: ''
          };
        }
        intMap[key].netArea += netArea;
      }
    }

    Object.keys(intMap).forEach(k => {
      const item = intMap[k];
      if (scenario === 'ap') {
        const m = consAssmDict[item.construction.toLowerCase()];
        if (m) item.construction = m.name;
        item.referenceFactor = getCbeccConsRef(item.construction);
      } else {
        item.referenceFactor = extractBaselineFactor(item.construction);
      }
    });

    // C. Exterior Fenestration
    const fenRows = extractTableByMarker(doc, 'FullName:Envelope Summary_Entire Facility_Exterior Fenestration')
      || extractTableByMarker(doc, 'Exterior Fenestration');
    const fenMap = {};
    if (fenRows && fenRows.length > 1) {
      for (let i = 1; i < fenRows.length; i++) {
        const r = fenRows[i];
        if (!r || r.length < 13) continue;
        const rawCons = r[1].trim();
        if (!rawCons) continue;
        const area = safeFloat(r[8]);
        const glassU = safeFloat(r[10]);
        const glassSHGC = safeFloat(r[11]);
        const glassVT = safeFloat(r[12]);
        const key = rawCons.toUpperCase();

        if (!fenMap[key]) {
          fenMap[key] = {
            construction: rawCons,
            glassUFactor: glassU,
            glassSHGC: glassSHGC,
            glassVT: glassVT,
            totalArea: 0,
            referenceUFactor: '-',
            referenceSHGC: '-',
            referenceVT: '-'
          };
        }
        fenMap[key].totalArea += area;
      }
    }

    Object.keys(fenMap).forEach(k => {
      const item = fenMap[k];
      const m = fenConsDict[item.construction.toLowerCase()];
      if (m) {
        item.construction = m.name;
        const p = m.props || {};
        item.referenceUFactor = p.UFactor ? safeFloat(p.UFactor).toFixed(4) : '-';
        item.referenceSHGC = p.SHGC ? safeFloat(p.SHGC).toFixed(4) : '-';
        item.referenceVT = p.VT ? safeFloat(p.VT).toFixed(4) : '-';
      }
    });

    // 4. Zone Summary & Outdoor Air Mechanical Ventilation
    const zsRows = extractTableByMarker(doc, 'FullName:Input Verification and Results Summary_Entire Facility_Zone Summary')
      || extractTableByMarker(doc, 'Zone Summary');
    const zoneAreas = {};
    if (zsRows && zsRows.length > 1) {
      for (let i = 1; i < zsRows.length; i++) {
        const r = zsRows[i];
        if (!r || !r[0]) continue;
        zoneAreas[r[0].trim().toLowerCase()] = safeFloat(r[1]);
      }
    }

    const thrmlZnDict = (ibdComponents && ibdComponents.ThrmlZn) || {};
    const oaRows = extractTableByMarker(doc, 'FullName:Outdoor Air Summary_Entire Facility_Minimum Outdoor Air During Occupied Hours')
      || extractTableByMarker(doc, 'Minimum Outdoor Air During Occupied Hours');
    const ventList = [];

    if (oaRows && oaRows.length > 1) {
      for (let i = 1; i < oaRows.length; i++) {
        const r = oaRows[i];
        if (!r || !r[0]) continue;
        const rawZName = r[0].trim();
        const vol = r.length > 3 ? safeFloat(r[3]) : 0;
        const ach = r.length > 4 ? safeFloat(r[4]) : 0;

        let spaceType = '';
        if (rawZName.includes('_')) {
          spaceType = rawZName.split('_')[1].substring(0, 4).trim();
        }

        const cfm = (ach * vol) / 60.0;
        const area = zoneAreas[rawZName.toLowerCase()] || 0.0;
        const cfmPerFt2 = area > 0 ? (cfm / area) : 0.0;

        const cbeccZn = findThrmlZn(thrmlZnDict, rawZName);
        let displayName = rawZName;
        let cbeccPerArea = 0.0;
        let cbeccFlow = 0.0;
        if (cbeccZn && cbeccZn.props) {
          displayName = cbeccZn.name || rawZName;
          const p = cbeccZn.props;
          cbeccPerArea = safeFloat(
            p.ventperareasim !== undefined ? p.ventperareasim :
            p.dsgnventperarea !== undefined ? p.dsgnventperarea :
            p.codedsgnventperarea !== undefined ? p.codedsgnventperarea :
            p.ventperareaflowsim !== undefined ? p.ventperareaflowsim : 0.0
          );
          cbeccFlow = safeFloat(
            p.ventflow !== undefined ? p.ventflow :
            p.ventflowsim !== undefined ? p.ventflowsim :
            p.minventflow !== undefined ? p.minventflow : 0.0
          );
        }

        let diffPct = 0.0;
        if (cbeccPerArea > 0) {
          diffPct = ((cfmPerFt2 - cbeccPerArea) / cbeccPerArea) * 100.0;
        } else if (cfmPerFt2 > 0) {
          diffPct = 100.0;
        }

        ventList.push({
          zoneName: displayName,
          spaceType: spaceType,
          mechanicalVentCFM: cfm,
          areaSqFt: area,
          ventPerAreaSimCalculated: cfmPerFt2,
          ventPerAreaSimCBECC: cbeccPerArea,
          cbeccVentFlow: cbeccFlow,
          diffPercent: diffPct
        });
      }
    }

    return {
      scenario: scenario,
      unmetHours: {
        facility: facilityUnmet,
        hasWarning: hasUnmetWarning,
        zones: zonesUnmet
      },
      complianceEnergy: complianceMap,
      endUses: endUsesMap,
      schedules: {
        lighting: lightScheds,
        receptacle: recepScheds
      },
      envelope: {
        opaqueExterior: Object.values(extMap),
        opaqueInterior: Object.values(intMap),
        exteriorFenestration: Object.values(fenMap)
      },
      ventilation: ventList
    };
  }

  // Parse Excel workbook buffer/arrayBuffer with SheetJS
  function parseExcelQcBuffer(buffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) library is not loaded.');
    }
    const wb = XLSX.read(buffer, { type: 'array' });
    if (!wb.SheetNames.includes('QC')) {
      throw new Error("Worksheet 'QC' was not found in the selected workbook.");
    }
    const ws = wb.Sheets['QC'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!rows || rows.length < 3) {
      throw new Error("The 'QC' sheet does not have expected data rows.");
    }

    const categories = [];
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      const cat = String(row[0]).trim();
      categories.push({
        category: cat,
        baseline: {
          electricity_kWh: safeFloat(row[1]),
          naturalGas_therm: safeFloat(row[2]),
          water_gal: safeFloat(row[3])
        },
        proposed: {
          electricity_kWh: safeFloat(row[4]),
          naturalGas_therm: safeFloat(row[5]),
          water_gal: safeFloat(row[6])
        }
      });
    }

    return { categories: categories };
  }

  // =========================================================================
  // UI Rendering & Interactions
  // =========================================================================

  function renderQCWorkspace() {
    const container = document.getElementById('qc-workspace');
    if (!container) return;

    if (!state.folderData && !state.workbookData) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">📂</div>
          <h3>Select Model Run Folder &amp; CBECC Model Workbook to Begin QC</h3>
          <p>The QC tool compares your EnergyPlus simulation results (ab1 baseline and ap proposed) against CBECC definitions and your LEED compliance workbook.</p>
          <div class="empty-actions">
            <button type="button" class="btn btn-primary" id="qc-empty-load-sample">⚡ Load Example Project &amp; Workbook</button>
          </div>
        </div>
      `;
      const btn = document.getElementById('qc-empty-load-sample');
      if (btn) btn.addEventListener('click', loadSampleQCData);
      return;
    }

    const scenarioKey = state.activeScenario; // 'ap' or 'ab1'
    const scenarioLabel = scenarioKey === 'ap' ? 'Proposed (ap)' : 'Baseline (ab1)';
    const scenarioData = state.folderData ? state.folderData[scenarioKey] : null;

    // Check high level warnings
    const unmetWarning = scenarioData && scenarioData.unmetHours && scenarioData.unmetHours.hasWarning;
    const energyChecks = buildEnergyComparisons(scenarioData, state.workbookData, scenarioKey);
    const energyWarningsCount = energyChecks.filter(c => c.isWarning).length;

    container.innerHTML = `
      <!-- Scenario Selector & Quick Summary Stats -->
      <div class="qc-top-toolbar card">
        <div class="qc-scenario-selector">
          <span class="toolbar-label">Active Scenario:</span>
          <div class="segmented-control" id="qc-scenario-toggle">
            <button type="button" class="seg-btn ${state.activeScenario === 'ap' ? 'active' : ''}" data-scenario="ap">
              Proposed (ap)
            </button>
            <button type="button" class="seg-btn ${state.activeScenario === 'ab1' ? 'active' : ''}" data-scenario="ab1">
              Baseline (ab1)
            </button>
          </div>
          <span class="active-scenario-badge ${state.activeScenario === 'ap' ? 'badge-ap' : 'badge-ab1'}">
            Viewing ${scenarioLabel}
          </span>
        </div>

        <div class="qc-summary-strip">
          <div class="qc-stat-tile ${unmetWarning ? 'tile-warning' : 'tile-ok'}">
            <span class="tile-label">Unmet Hours</span>
            <span class="tile-val">${unmetWarning ? '⚠️ Exceeds 150h' : '✅ Compliant'}</span>
            <span class="tile-sub">Facility: H ${scenarioData ? fmtNum(scenarioData.unmetHours.facility.heating, 1) : '-'}h | C ${scenarioData ? fmtNum(scenarioData.unmetHours.facility.cooling, 1) : '-'}h</span>
          </div>

          <div class="qc-stat-tile ${energyWarningsCount > 0 ? 'tile-warning' : 'tile-ok'}">
            <span class="tile-label">Workbook Variance</span>
            <span class="tile-val">${energyWarningsCount > 0 ? `${energyWarningsCount} Warning${energyWarningsCount > 1 ? 's' : ''}` : '✅ Matches configured thresholds'}</span>
            <span class="tile-sub">${state.workbookData ? 'QC tab loaded' : 'Workbook not loaded'}</span>
          </div>

          <div class="qc-stat-tile tile-neutral">
            <span class="tile-label">Envelope Checks</span>
            <span class="tile-val">${scenarioData ? (scenarioData.envelope.opaqueExterior.length + scenarioData.envelope.opaqueInterior.length + scenarioData.envelope.exteriorFenestration.length) : 0} Types</span>
            <span class="tile-sub">Opaque &amp; Fenestration</span>
          </div>

          <div class="qc-stat-tile tile-neutral">
            <span class="tile-label">Ventilation</span>
            <span class="tile-val">${scenarioData ? scenarioData.ventilation.length : 0} Zones</span>
            <span class="tile-sub">Min Outdoor Air (ACH)</span>
          </div>
        </div>
      </div>

      <!-- Section 1: Time Setpoint Not Met -->
      <section class="card qc-card" id="qc-section-unmet">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-step-badge">1</span>
            <h3>Time Setpoint Not Met (Unmet Hours)</h3>
          </div>
          <div class="qc-unmet-facility-badge ${scenarioData && scenarioData.unmetHours.facility.exceeds150 ? 'badge-warn' : 'badge-success'}">
            <strong>Facility Total:</strong>
            Occupied Heating: <span>${scenarioData ? fmtNum(scenarioData.unmetHours.facility.heating, 1) : '-'} hr</span> &nbsp;|&nbsp;
            Occupied Cooling: <span>${scenarioData ? fmtNum(scenarioData.unmetHours.facility.cooling, 1) : '-'} hr</span>
          </div>
        </div>

        <div class="qc-card-body">
          ${unmetWarning ? `
            <div class="qc-alert qc-alert-warning">
              <strong>⚠️ Warning:</strong> One or more thermal zones exceed 150 hours of unmet setpoints during occupied hours. Review the flagged zones below.
            </div>
          ` : `
            <div class="qc-alert qc-alert-success">
              <strong>✅ All zones pass:</strong> No thermal zones exceed 150 unmet hours during occupied heating or cooling.
            </div>
          `}

          <div class="qc-filter-bar">
            <div class="filter-group">
              <span class="filter-label">Filter Zones:</span>
              <div class="segmented-control control-sm" id="qc-unmet-filter">
                <button type="button" class="seg-btn ${state.unmetFilter === 'warn' ? 'active' : ''}" data-filter="warn">Zones &gt; 150h</button>
                <button type="button" class="seg-btn ${state.unmetFilter === 'zero' ? 'active' : ''}" data-filter="zero">Zones &gt; 0h</button>
                <button type="button" class="seg-btn ${state.unmetFilter === 'all' ? 'active' : ''}" data-filter="all">All Zones</button>
              </div>
            </div>

            <div class="filter-group">
              <span class="filter-label">Sort By:</span>
              <select id="qc-unmet-sort" class="select-dropdown-sm">
                <option value="orig" ${state.unmetSort === 'orig' ? 'selected' : ''}>Original Report Order</option>
                <option value="heat_desc" ${state.unmetSort === 'heat_desc' ? 'selected' : ''}>Not Met Heating (High &rarr; Low)</option>
                <option value="cool_desc" ${state.unmetSort === 'cool_desc' ? 'selected' : ''}>Not Met Cooling (High &rarr; Low)</option>
                <option value="name_asc" ${state.unmetSort === 'name_asc' ? 'selected' : ''}>Thermal Zone Name (A &rarr; Z)</option>
              </select>
            </div>
          </div>

          <div class="table-container qc-table-wrapper">
            <table class="data-table qc-table" id="qc-unmet-table">
              <thead>
                <tr>
                  <th style="width: 50%;">Thermal Zone Name</th>
                  <th class="text-right" style="width: 25%;">During Occupied Heating [hr]</th>
                  <th class="text-right" style="width: 25%;">During Occupied Cooling [hr]</th>
                </tr>
              </thead>
              <tbody>
                ${renderUnmetTableRows(scenarioData)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Section 2: Energy & Water Comparison vs Excel QC Tab -->
      <section class="card qc-card" id="qc-section-energy">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-step-badge">2</span>
            <h3>Performance Rating &amp; Workbook QC Comparison</h3>
          </div>
          <span class="table-subtitle">Comparing ${scenarioLabel} simulation against CBECC Model Workbook "QC" Tab</span>
        </div>

        <div class="qc-card-body">
          ${!state.workbookData ? `
            <div class="qc-alert qc-alert-info">
              <span>📋 Please load a <strong>CBECC Model Workbook (.xlsm)</strong> above to compare modeled simulation values against Excel calculated targets.</span>
            </div>
          ` : ''}

          <div class="table-container qc-table-wrapper">
            <table class="data-table qc-table">
              <thead>
                <tr>
                  <th>Compliance Category</th>
                  <th>Metric / Resource</th>
                  <th class="text-right">Simulation Result (HTM)</th>
                  <th class="text-right">Workbook Value (QC Tab)</th>
                  <th class="text-right">Difference</th>
                  <th class="text-right">Difference %</th>
                  <th class="text-center">QC Status</th>
                </tr>
              </thead>
              <tbody>
                ${renderEnergyComparisonRows(energyChecks)}
              </tbody>
            </table>
          </div>

          <!-- Schedules Collapsible / Toggle Section -->
          <div class="qc-schedules-drawer card-nested">
            <div class="schedules-header">
              <h4>📅 Schedule Verification: Equivalent Full Load Hours (EFLH)</h4>
              <div class="schedules-toggles">
                <button type="button" class="btn btn-sm btn-outline" id="toggle-light-sched-btn">
                  💡 Toggle Lighting Schedules (${scenarioData ? scenarioData.schedules.lighting.length : 0})
                </button>
                <button type="button" class="btn btn-sm btn-outline" id="toggle-recep-sched-btn">
                  🔌 Toggle Receptacle Schedules (${scenarioData ? scenarioData.schedules.receptacle.length : 0})
                </button>
              </div>
            </div>

            <div id="light-sched-panel" class="schedule-panel hidden">
              <h5>Lighting Schedules (contains "LIGHT")</h5>
              <div class="table-container">
                <table class="data-table qc-table-sm">
                  <thead>
                    <tr>
                      <th>Schedule Name</th>
                      <th class="text-right">Equivalent Full Load Hours of Operation Per Year [hr]</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(scenarioData && scenarioData.schedules.lighting.length > 0) ? scenarioData.schedules.lighting.map(s => `
                      <tr>
                        <td><code>${s.scheduleName}</code></td>
                        <td class="text-right font-mono">${fmtNum(s.eflh, 1)} hr</td>
                      </tr>
                    `).join('') : '<tr><td colspan="2" class="text-muted">No lighting schedules found.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <div id="recep-sched-panel" class="schedule-panel hidden">
              <h5>Receptacle Schedules (contains "RECEPTACLE")</h5>
              <div class="table-container">
                <table class="data-table qc-table-sm">
                  <thead>
                    <tr>
                      <th>Schedule Name</th>
                      <th class="text-right">Equivalent Full Load Hours of Operation Per Year [hr]</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(scenarioData && scenarioData.schedules.receptacle.length > 0) ? scenarioData.schedules.receptacle.map(s => `
                      <tr>
                        <td><code>${s.scheduleName}</code></td>
                        <td class="text-right font-mono">${fmtNum(s.eflh, 1)} hr</td>
                      </tr>
                    `).join('') : '<tr><td colspan="2" class="text-muted">No receptacle schedules found.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3: Envelope Constructions -->
      <section class="card qc-card" id="qc-section-envelope">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-step-badge">3</span>
            <h3>Envelope Constructions Quality Control</h3>
          </div>
          <div class="segmented-control control-sm" id="qc-envelope-subtabs">
            <button type="button" class="seg-btn ${state.envelopeSubtab === 'opaque' ? 'active' : ''}" data-subtab="opaque">
              Opaque (${scenarioData ? scenarioData.envelope.opaqueExterior.length + scenarioData.envelope.opaqueInterior.length : 0})
            </button>
            <button type="button" class="seg-btn ${state.envelopeSubtab === 'fenestration' ? 'active' : ''}" data-subtab="fenestration">
              Fenestration (${scenarioData ? scenarioData.envelope.exteriorFenestration.length : 0})
            </button>
          </div>
        </div>

        <div class="qc-card-body">
          ${renderEnvelopeSubtab(scenarioData, state.envelopeSubtab, scenarioKey)}
        </div>
      </section>

      <!-- Section 4: Mechanical Ventilation QC -->
      <section class="card qc-card" id="qc-section-ventilation">
        <div class="card-header">
          <div class="card-title-group">
            <span class="card-step-badge">4</span>
            <h3>Mechanical Ventilation Rate QC</h3>
          </div>
          <span class="table-subtitle">Zone-by-zone outdoor air verification</span>
        </div>

        <div class="qc-card-body">
          <div class="qc-callout-note">
            <span class="callout-icon">ℹ️</span>
            <div><strong>Note:</strong> The calculated value is the <em>Minimum Outdoor Air During Occupied Hours</em>: Calculated CFM = (Mechanical Ventilation [ACH] &times; Zone Volume [ft3]) / 60; CFM/ft2 = Calculated CFM / Zone Area [ft2].</div>
          </div>

          <div class="qc-filter-bar">
            <div class="filter-group">
              <label for="qc-vent-search" class="filter-label">Search Zone:</label>
              <input type="text" id="qc-vent-search" class="text-input-sm" placeholder="Search by name..." value="${state.ventSearch}">
            </div>

            <div class="filter-group">
              <label for="qc-vent-spacetype" class="filter-label">Space Type:</label>
              <select id="qc-vent-spacetype" class="select-dropdown-sm">
                <option value="all" ${state.ventSpaceType === 'all' ? 'selected' : ''}>All Space Types</option>
                ${getUniqueSpaceTypes(scenarioData).map(st => `
                  <option value="${st}" ${state.ventSpaceType === st ? 'selected' : ''}>${st}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="table-container qc-table-wrapper">
            <table class="data-table qc-table" id="qc-vent-table">
              <thead>
                <tr>
                  <th class="sortable-th" data-col="zoneName">Zone Name <span class="sort-indicator"></span></th>
                  <th class="sortable-th" data-col="spaceType">Space Type <span class="sort-indicator"></span></th>
                  <th class="text-right sortable-th" data-col="mechanicalVentCFM">Mechanical Vent [CFM] <span class="sort-indicator"></span></th>
                  <th class="text-right sortable-th" data-col="areaSqFt">Area [ft2] <span class="sort-indicator"></span></th>
                  <th class="text-right sortable-th" data-col="ventPerAreaSimCalculated">Calc. Vent [CFM/ft2] <span class="sort-indicator"></span></th>
                  <th class="text-right sortable-th" data-col="ventPerAreaSimCBECC">CBECC File [CFM/ft2] <span class="sort-indicator"></span></th>
                  <th class="text-right sortable-th" data-col="diffPercent">Difference % <span class="sort-indicator"></span></th>
                </tr>
              </thead>
              <tbody>
                ${renderVentilationRows(scenarioData)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    bindQCEvents();
  }

  // Row renderers
  function renderUnmetTableRows(scenarioData) {
    if (!scenarioData || !scenarioData.unmetHours || !scenarioData.unmetHours.zones) {
      return '<tr><td colspan="3" class="text-muted">No data loaded.</td></tr>';
    }

    let zones = [...scenarioData.unmetHours.zones];

    // Filter
    if (state.unmetFilter === 'warn') {
      zones = zones.filter(z => z.exceeds150);
    } else if (state.unmetFilter === 'zero') {
      zones = zones.filter(z => z.exceeds0);
    }

    // Sort
    if (state.unmetSort === 'heat_desc') {
      zones.sort((a, b) => b.heatingHours - a.heatingHours);
    } else if (state.unmetSort === 'cool_desc') {
      zones.sort((a, b) => b.coolingHours - a.coolingHours);
    } else if (state.unmetSort === 'name_asc') {
      zones.sort((a, b) => a.zone.localeCompare(b.zone));
    }

    if (zones.length === 0) {
      return `<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">No thermal zones match the selected filter (${state.unmetFilter === 'warn' ? 'No zones exceed 150 hours' : 'No zones with unmet hours'}).</td></tr>`;
    }

    return zones.map(z => {
      const isWarn = z.exceeds150;
      return `
        <tr class="${isWarn ? 'row-warning' : ''}">
          <td>
            <strong>${z.zone}</strong>
            ${isWarn ? '<span class="badge badge-warn-sm">Exceeds 150h</span>' : ''}
          </td>
          <td class="text-right font-mono ${z.heatingHours > 150 ? 'text-danger font-bold' : ''}">${fmtNum(z.heatingHours, 1)}</td>
          <td class="text-right font-mono ${z.coolingHours > 150 ? 'text-danger font-bold' : ''}">${fmtNum(z.coolingHours, 1)}</td>
        </tr>
      `;
    }).join('');
  }

  function buildEnergyComparisons(scenarioData, workbookData, scenarioKey) {
    const checks = [
      {
        category: 'Interior Lighting',
        sourceCategories: ['Interior Lighting -- ComplianceLtg'],
        workbookCategories: ['Interior Lighting'],
        metric: 'Electricity Energy Use [kWh]',
        unit: 'kWh',
        source: 'compliance',
        key: 'elec',
        threshold: 1.0
      },
      {
        category: 'Receptacle Equipment',
        sourceCategories: [
          'Interior Equipment -- Receptacle',
          'Interior Equipment -- Refrig',
          'Interior Equipment -- Process'
        ],
        workbookCategories: ['Receptacle Equipment'],
        metric: 'Electricity Energy Use [kWh]',
        unit: 'kWh',
        source: 'compliance',
        key: 'elec',
        threshold: 1.0
      },
      {
        category: 'Elevators & Escalators',
        sourceCategories: ['Interior Equipment -- Internal Transport'],
        workbookCategories: ['Elevators and Escalators', 'Elevators & Escalators'],
        metric: 'Electricity Energy Use [kWh]',
        unit: 'kWh',
        source: 'compliance',
        key: 'elec',
        threshold: 1.0
      },
      {
        category: 'Fans - Parking Garage',
        sourceCategories: ['Fans -- Parking Garage'],
        workbookCategories: ['Fans-Parking Garage', 'Fans - Parking Garage'],
        metric: 'Electricity Energy Use [kWh]',
        unit: 'kWh',
        source: 'compliance',
        key: 'elec',
        threshold: 1.0
      },
      {
        category: 'Service Water Heating',
        sourceCategories: ['Water Systems'],
        workbookCategories: ['Service Water Heating'],
        metric: 'Water [gal]',
        unit: 'gal',
        source: 'endUses',
        key: 'water',
        threshold: 4.0
      },
      {
        category: 'Service Water Heating',
        sourceCategories: ['Water Systems -- General'],
        workbookCategories: ['Service Water Heating'],
        metric: 'Electricity [kWh] / Natural Gas [therm]',
        unit: 'dual',
        source: 'compliance',
        key: 'dual',
        threshold: 4.0
      }
    ];

    return checks.map(c => {
      let htmVal = 0.0;
      let wbVal = 0.0;
      let presentInModel = false;
      let displayUnit = c.unit;

      // Extract HTM value
      if (scenarioData) {
        if (c.source === 'compliance') {
          c.sourceCategories.forEach(category => {
            const compItem = scenarioData.complianceEnergy[category];
            if (!compItem) return;
            presentInModel = true;
            if (c.key === 'elec') {
              htmVal += compItem.electricity_kWh;
            } else if (c.key === 'dual') {
              htmVal += compItem.electricity_kWh;
              if (compItem.electricity_kWh <= 0) htmVal += compItem.naturalGas_therm;
            }
          });
          if (c.key === 'dual' && htmVal > 0) {
            const hasElectricity = c.sourceCategories.some(category => {
              const item = scenarioData.complianceEnergy[category];
              return item && item.electricity_kWh > 0;
            });
            displayUnit = hasElectricity ? 'kWh' : 'therm';
          }
        } else if (c.source === 'endUses') {
          const endItem = scenarioData.endUses[c.sourceCategories[0]];
          if (endItem) {
            presentInModel = true;
            htmVal = endItem.water_gal;
          }
        }
      }

      // Extract Workbook value
      if (workbookData && workbookData.categories) {
        const wbMatch = workbookData.categories.find(w =>
          c.workbookCategories.some(category => w.category.toLowerCase() === category.toLowerCase())
        );
        if (wbMatch) {
          const targetObj = scenarioKey === 'ap' ? wbMatch.proposed : wbMatch.baseline;
          if (c.key === 'elec') {
            wbVal = targetObj.electricity_kWh;
          } else if (c.key === 'water') {
            wbVal = targetObj.water_gal;
          } else if (c.key === 'dual') {
            if (targetObj.electricity_kWh > 0) {
              wbVal = targetObj.electricity_kWh;
              if (displayUnit === 'dual') displayUnit = 'kWh';
            } else if (targetObj.naturalGas_therm > 0) {
              wbVal = targetObj.naturalGas_therm;
              if (displayUnit === 'dual') displayUnit = 'therm';
            }
          }
        }
      }

      const diff = htmVal - wbVal;
      let diffPct = 0.0;
      if (wbVal > 0) {
        diffPct = Math.abs(diff / wbVal) * 100.0;
      } else if (htmVal > 0) {
        diffPct = 100.0;
      }

      const isWarning = (presentInModel || wbVal > 0) && (diffPct > c.threshold);

      return {
        category: c.category,
        metric: displayUnit === 'dual' ? c.metric : `${c.metric} (${displayUnit})`,
        unit: displayUnit,
        htmVal: htmVal,
        wbVal: wbVal,
        diff: diff,
        diffPct: diffPct,
        threshold: c.threshold,
        presentInModel: presentInModel,
        isWarning: isWarning
      };
    });
  }

  function renderEnergyComparisonRows(checks) {
    if (!checks || checks.length === 0) {
      return '<tr><td colspan="7" class="text-muted">No comparison data available.</td></tr>';
    }

    return checks.map(c => {
      let statusBadge = '';
      if (!c.presentInModel && c.wbVal === 0) {
        statusBadge = '<span class="badge badge-neutral-sm">Not in Model</span>';
      } else if (c.isWarning) {
        statusBadge = `<span class="badge badge-warn-sm">⚠️ Diff &gt; ${c.threshold}%</span>`;
      } else {
        statusBadge = '<span class="badge badge-success-sm">✅ Pass (&le; ' + c.threshold + '%)</span>';
      }

      return `
        <tr class="${c.isWarning ? 'row-warning' : ''}">
          <td><strong>${c.category}</strong></td>
          <td><span class="text-muted">${c.metric}</span></td>
          <td class="text-right font-mono">${fmtNum(c.htmVal, 2)}</td>
          <td class="text-right font-mono">${fmtNum(c.wbVal, 2)}</td>
          <td class="text-right font-mono ${c.diff > 0 ? 'text-danger' : ''}">${(c.diff > 0 ? '+' : '') + fmtNum(c.diff, 2)}</td>
          <td class="text-right font-mono font-bold ${c.isWarning ? 'text-danger' : 'text-success'}">${fmtNum(c.diffPct, 2)}%</td>
          <td class="text-center">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  function renderEnvelopeSubtab(scenarioData, subtab, scenarioKey) {
    if (!scenarioData || !scenarioData.envelope) {
      return '<p class="text-muted">No envelope data loaded.</p>';
    }

    if (subtab === 'opaque') {
      const items = [
        ...(scenarioData.envelope.opaqueExterior || []).map(item => ({ ...item, surfaceType: 'Exterior' })),
        ...(scenarioData.envelope.opaqueInterior || []).map(item => ({ ...item, surfaceType: 'Interior' }))
      ];
      return `
        <div class="table-container qc-table-wrapper">
          <table class="data-table qc-table">
            <thead>
              <tr>
                <th>Surface Type</th>
                <th style="width: 35%;">Construction</th>
                <th class="text-right">U-Factor with Film [Btu/h-ft2-F]</th>
                <th class="text-right">U-Factor no Film [Btu/h-ft2-F]</th>
                <th class="text-right">Net Area [ft2]</th>
                <th>Reference Factor (${scenarioKey === 'ap' ? 'CBECC .ibd ConsAssm' : 'Baseline Decoded'})</th>
              </tr>
            </thead>
            <tbody>
              ${items.length > 0 ? items.map(c => `
                <tr>
                  <td>${c.surfaceType}</td>
                  <td><strong>${c.construction}</strong></td>
                  <td class="text-right font-mono">${fmtNum(c.uFactorWithFilm, 4)}</td>
                  <td class="text-right font-mono">${fmtNum(c.uFactorNoFilm, 4)}</td>
                  <td class="text-right font-mono">${fmtNum(c.netArea, 2)}</td>
                  <td><code>${c.referenceFactor || '-'}</code></td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="text-muted">No opaque constructions.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } else {
      const items = scenarioData.envelope.exteriorFenestration || [];
      return `
        <div class="table-container qc-table-wrapper">
          <table class="data-table qc-table">
            <thead>
              <tr>
                <th style="width: 25%;">Construction</th>
                <th class="text-right">Glass U-Factor</th>
                <th class="text-right">Glass SHGC</th>
                <th class="text-right">Glass VT</th>
                <th class="text-right">Sum of Area [ft2]</th>
                <th>CBECC Reference (U / SHGC / VT)</th>
              </tr>
            </thead>
            <tbody>
              ${items.length > 0 ? items.map(c => `
                <tr>
                  <td><strong>${c.construction}</strong></td>
                  <td class="text-right font-mono">${fmtNum(c.glassUFactor, 4)}</td>
                  <td class="text-right font-mono">${fmtNum(c.glassSHGC, 4)}</td>
                  <td class="text-right font-mono">${fmtNum(c.glassVT, 4)}</td>
                  <td class="text-right font-mono">${fmtNum(c.totalArea, 2)}</td>
                  <td><code>U: ${c.referenceUFactor} | SHGC: ${c.referenceSHGC} | VT: ${c.referenceVT}</code></td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="text-muted">No exterior fenestration constructions.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  function getUniqueSpaceTypes(scenarioData) {
    if (!scenarioData || !scenarioData.ventilation) return [];
    const set = new Set();
    scenarioData.ventilation.forEach(v => {
      if (v.spaceType) set.add(v.spaceType);
    });
    return Array.from(set).sort();
  }

  function renderVentilationRows(scenarioData) {
    if (!scenarioData || !scenarioData.ventilation) {
      return '<tr><td colspan="7" class="text-muted">No ventilation data loaded.</td></tr>';
    }

    let items = [...scenarioData.ventilation];

    // Filter
    if (state.ventSearch) {
      const q = state.ventSearch.toLowerCase();
      items = items.filter(i => i.zoneName.toLowerCase().includes(q) || i.spaceType.toLowerCase().includes(q));
    }
    if (state.ventSpaceType !== 'all') {
      items = items.filter(i => i.spaceType === state.ventSpaceType);
    }

    // Sort
    const col = state.ventSortCol;
    const dir = state.ventSortDir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      let va = a[col];
      let vb = b[col];
      if (typeof va === 'string') {
        return dir * va.localeCompare(vb);
      }
      return dir * (safeFloat(va) - safeFloat(vb));
    });

    if (items.length === 0) {
      return '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No thermal zones match filter criteria.</td></tr>';
    }

    return items.map(v => {
      // Warning triggers if absolute difference > 10.0% and at least one ventilation rate is non-zero
      const diffWarn = Math.abs(v.diffPercent) > 10.0 && (v.mechanicalVentCFM > 0 || v.ventPerAreaSimCBECC > 0);
      return `
        <tr class="${diffWarn ? 'row-warning-light' : ''}">
          <td><strong>${v.zoneName}</strong></td>
          <td><span class="badge badge-neutral-sm">${v.spaceType || '-'}</span></td>
          <td class="text-right font-mono">${fmtNum(v.mechanicalVentCFM, 2)}</td>
          <td class="text-right font-mono">${fmtNum(v.areaSqFt, 2)}</td>
          <td class="text-right font-mono font-bold">${fmtNum(v.ventPerAreaSimCalculated, 4)}</td>
          <td class="text-right font-mono">${fmtNum(v.ventPerAreaSimCBECC, 4)}</td>
          <td class="text-right font-mono ${diffWarn ? 'text-danger font-bold' : ''}">
            ${v.diffPercent > 0 ? '+' : ''}${fmtNum(v.diffPercent, 2)}%
          </td>
        </tr>
      `;
    }).join('');
  }

  function bindQCEvents() {
    // Scenario toggle
    const scenToggle = document.getElementById('qc-scenario-toggle');
    if (scenToggle) {
      scenToggle.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sc = e.currentTarget.getAttribute('data-scenario');
          if (sc && sc !== state.activeScenario) {
            state.activeScenario = sc;
            renderQCWorkspace();
          }
        });
      });
    }

    // Unmet Filter
    const unmetFilterEl = document.getElementById('qc-unmet-filter');
    if (unmetFilterEl) {
      unmetFilterEl.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const f = e.currentTarget.getAttribute('data-filter');
          if (f) {
            state.unmetFilter = f;
            unmetFilterEl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const tbody = document.querySelector('#qc-unmet-table tbody');
            if (tbody && state.folderData) {
              tbody.innerHTML = renderUnmetTableRows(state.folderData[state.activeScenario]);
            }
          }
        });
      });
    }

    // Unmet Sort
    const unmetSortEl = document.getElementById('qc-unmet-sort');
    if (unmetSortEl) {
      unmetSortEl.addEventListener('change', (e) => {
        state.unmetSort = e.target.value;
        const tbody = document.querySelector('#qc-unmet-table tbody');
        if (tbody && state.folderData) {
          tbody.innerHTML = renderUnmetTableRows(state.folderData[state.activeScenario]);
        }
      });
    }

    // Schedule toggles
    const toggleLightBtn = document.getElementById('toggle-light-sched-btn');
    const lightPanel = document.getElementById('light-sched-panel');
    if (toggleLightBtn && lightPanel) {
      toggleLightBtn.addEventListener('click', () => {
        lightPanel.classList.toggle('hidden');
      });
    }

    const toggleRecepBtn = document.getElementById('toggle-recep-sched-btn');
    const recepPanel = document.getElementById('recep-sched-panel');
    if (toggleRecepBtn && recepPanel) {
      toggleRecepBtn.addEventListener('click', () => {
        recepPanel.classList.toggle('hidden');
      });
    }

    // Envelope subtabs
    const envSubtabs = document.getElementById('qc-envelope-subtabs');
    if (envSubtabs) {
      envSubtabs.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sub = e.currentTarget.getAttribute('data-subtab');
          if (sub) {
            state.envelopeSubtab = sub;
            renderQCWorkspace();
          }
        });
      });
    }

    // Ventilation filter & search
    const ventSearchInput = document.getElementById('qc-vent-search');
    if (ventSearchInput) {
      ventSearchInput.addEventListener('input', (e) => {
        state.ventSearch = e.target.value;
        const tbody = document.querySelector('#qc-vent-table tbody');
        if (tbody && state.folderData) {
          tbody.innerHTML = renderVentilationRows(state.folderData[state.activeScenario]);
        }
      });
    }

    const ventSpaceSelect = document.getElementById('qc-vent-spacetype');
    if (ventSpaceSelect) {
      ventSpaceSelect.addEventListener('change', (e) => {
        state.ventSpaceType = e.target.value;
        const tbody = document.querySelector('#qc-vent-table tbody');
        if (tbody && state.folderData) {
          tbody.innerHTML = renderVentilationRows(state.folderData[state.activeScenario]);
        }
      });
    }

    // Ventilation table header sort
    const ventTable = document.getElementById('qc-vent-table');
    if (ventTable) {
      ventTable.querySelectorAll('.sortable-th').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.getAttribute('data-col');
          if (state.ventSortCol === col) {
            state.ventSortDir = state.ventSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.ventSortCol = col;
            state.ventSortDir = 'asc';
          }
          const tbody = ventTable.querySelector('tbody');
          if (tbody && state.folderData) {
            tbody.innerHTML = renderVentilationRows(state.folderData[state.activeScenario]);
          }
        });
      });
    }
  }

  // =========================================================================
  // Ingestion Handlers (Server & Browser Mode)
  // =========================================================================

  async function loadSampleQCData() {
    showToast('Loading Sample Data', 'Reading example_project_folder2 and workbook...', 'info');

    // 1. Try server API
    try {
      const [resScan, resWb] = await Promise.all([
        fetch('/api/qc-scan?folder=example_project_folder2').then(r => r.json()),
        fetch('/api/qc-workbook?file=CBECC%20Model%20Workbook%20-%20example2.xlsm').then(r => r.json())
      ]);

      if (resScan && resScan.success) {
        state.folderData = resScan;
        updateFolderBadge('example_project_folder2 (Sample Loaded)');
      }
      if (resWb && resWb.success) {
        state.workbookData = resWb;
        updateWorkbookBadge('CBECC Model Workbook - example2.xlsm (Sample Loaded)');
      }

      if (resScan.success || resWb.success) {
        showToast('QC Data Loaded', 'Sample models and workbook loaded successfully!', 'success');
        renderQCWorkspace();
        return;
      }
    } catch (err) {
      console.warn('Server API not responding, falling back to static fetch...', err);
    }

    // 2. Pure static fetch fallback
    try {
      const [htmAb1Text, htmApText, ibdAb1Text, ibdApText, wbBuf] = await Promise.all([
        fetch('example_project_folder2/ab1/2527_Shoebox%20MDL%20-%20ab1.htm').then(r => r.text()),
        fetch('example_project_folder2/ap/2527_Shoebox%20MDL%20-%20ap.htm').then(r => r.text()),
        fetch('example_project_folder2/2527_Shoebox%20MDL%20-%20ab1.ibd-Detail').then(r => r.text()),
        fetch('example_project_folder2/2527_Shoebox%20MDL%20-%20ap.ibd-Detail').then(r => r.text()),
        fetch('CBECC%20Model%20Workbook%20-%20example2.xlsm').then(r => r.arrayBuffer())
      ]);

      const ibdAb1Comp = parseIbdDetailText(ibdAb1Text);
      const ibdApComp = parseIbdDetailText(ibdApText);

      const parsedAb1 = parseQcHtm(htmAb1Text, 'ab1', ibdAb1Comp);
      const parsedAp = parseQcHtm(htmApText, 'ap', ibdApComp);

      state.folderData = {
        success: true,
        folder: 'example_project_folder2',
        hasAb1: true,
        hasAp: true,
        ab1: parsedAb1,
        ap: parsedAp
      };
      updateFolderBadge('example_project_folder2 (Local Static)');

      const parsedWb = parseExcelQcBuffer(wbBuf);
      state.workbookData = parsedWb;
      updateWorkbookBadge('CBECC Model Workbook - example2.xlsm (Local Static)');

      showToast('Sample QC Ready', 'Sample files parsed in browser mode!', 'success');
      renderQCWorkspace();
    } catch (staticErr) {
      console.error('Error loading sample QC files:', staticErr);
      showToast('Load Error', 'Could not load sample files: ' + staticErr.message, 'error');
    }
  }

  function updateFolderBadge(text) {
    const el = document.getElementById('qc-folder-status');
    if (el) {
      el.textContent = text;
      el.classList.remove('hidden');
    }
  }

  function updateWorkbookBadge(text) {
    const el = document.getElementById('qc-wb-status');
    if (el) {
      el.textContent = text;
      el.classList.remove('hidden');
    }
  }

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
    }, 3500);
  }

  // Handle client-side folder upload via file list
  async function handleBrowserFolderUpload(fileList) {
    if (!fileList || fileList.length === 0) return;

    let htmAb1File = null;
    let htmApFile = null;
    let ibdAb1File = null;
    let ibdApFile = null;
    let genericIbd = null;
    let excelWbFile = null;

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const p = (f.webkitRelativePath || f.name).toLowerCase();
      const n = f.name.toLowerCase();

      // HTM matching: check folder path or filename
      if ((p.includes('/ab1/') || n.includes('ab1')) && (n.endsWith('.htm') || n.endsWith('.html')) && !n.includes('-zp') && !n.includes('-zb')) {
        htmAb1File = f;
      } else if ((p.includes('/ap/') || n.includes('ap')) && (n.endsWith('.htm') || n.endsWith('.html')) && !n.includes('-zp') && !n.includes('-zb')) {
        htmApFile = f;
      }

      // .ibd-Detail matching
      if (n.includes('.ibd-detail')) {
        if (!genericIbd && !n.includes('-b4eval') && !n.includes('-postsim') && !n.includes('rangereqd')) {
          genericIbd = f;
        }
        if (n.includes('ab1') || p.includes('/ab1/')) {
          if (!ibdAb1File || (!n.includes('-b4eval') && !n.includes('-postsim'))) {
            ibdAb1File = f;
          }
        }
        if (n.includes('ap') || p.includes('/ap/')) {
          if (!ibdApFile || (!n.includes('-b4eval') && !n.includes('-postsim'))) {
            ibdApFile = f;
          }
        }
      }

      // Optional Excel workbook in same folder
      if ((n.endsWith('.xlsm') || n.endsWith('.xlsx')) && (n.includes('workbook') || n.includes('qc') || n.includes('cbecc'))) {
        excelWbFile = f;
      }
    }

    if (!ibdAb1File && genericIbd) ibdAb1File = genericIbd;
    if (!ibdApFile && genericIbd) ibdApFile = genericIbd;

    if (!htmAb1File && !htmApFile) {
      showToast('Missing HTM Files', 'No .htm files in ab1 or ap subfolders were found in the selected folder.', 'error');
      return;
    }

    showToast('Parsing Folder', 'Reading EnergyPlus reports and CBECC .ibd-Detail files...', 'info');

    try {
      const readText = file => file ? new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsText(file);
      }) : Promise.resolve('');

      const [htmAb1Txt, htmApTxt, ibdAb1Txt, ibdApTxt] = await Promise.all([
        readText(htmAb1File),
        readText(htmApFile),
        readText(ibdAb1File),
        readText(ibdApFile)
      ]);

      const compAb1 = parseIbdDetailText(ibdAb1Txt);
      const compAp = parseIbdDetailText(ibdApTxt);

      const dataAb1 = htmAb1Txt ? parseQcHtm(htmAb1Txt, 'ab1', compAb1) : null;
      const dataAp = htmApTxt ? parseQcHtm(htmApTxt, 'ap', compAp) : null;

      state.folderData = {
        success: true,
        hasAb1: !!dataAb1,
        hasAp: !!dataAp,
        ab1: dataAb1,
        ap: dataAp
      };

      const folderName = fileList[0].webkitRelativePath ? fileList[0].webkitRelativePath.split('/')[0] : 'Selected Files';
      updateFolderBadge(`Folder: ${folderName} (${dataAb1 ? 'ab1 ' : ''}${dataAp ? 'ap' : ''} loaded)`);
      showToast('Folder Loaded', 'Successfully extracted model run data!', 'success');
      renderQCWorkspace();
    } catch (err) {
      console.error(err);
      showToast('Parse Error', 'Failed to parse folder files: ' + err.message, 'error');
    }
  }

  // Handle Excel upload
  async function handleExcelUpload(file) {
    if (!file) return;
    showToast('Reading Workbook', 'Parsing "QC" tab from Excel workbook...', 'info');
    try {
      const buf = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsArrayBuffer(file);
      });

      const parsed = parseExcelQcBuffer(buf);
      state.workbookData = parsed;
      updateWorkbookBadge(`Workbook: ${file.name} (${parsed.categories.length} categories)`);
      showToast('Workbook Loaded', `Extracted ${parsed.categories.length} categories from QC tab!`, 'success');
      renderQCWorkspace();
    } catch (err) {
      console.error(err);
      showToast('Workbook Error', err.message, 'error');
    }
  }

  // Global init
  function initQCModule() {
    // Ingestion controls in index.html
    const folderInput = document.getElementById('qc-folder-input');
    const folderBrowseBtn = document.getElementById('qc-browse-folder-btn');
    const folderDropZone = document.getElementById('qc-drop-folder');
    const loadSampleBtn = document.getElementById('qc-load-sample-btn');

    if (folderBrowseBtn && folderInput) {
      folderBrowseBtn.addEventListener('click', () => folderInput.click());
    }
    if (folderInput) {
      folderInput.addEventListener('change', (e) => handleBrowserFolderUpload(e.target.files));
    }
    if (folderDropZone) {
      folderDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        folderDropZone.classList.add('dragover');
      });
      folderDropZone.addEventListener('dragleave', () => folderDropZone.classList.remove('dragover'));
      folderDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        folderDropZone.classList.remove('dragover');
        if (e.dataTransfer.files) handleBrowserFolderUpload(e.dataTransfer.files);
      });
    }

    // Workbook inputs
    const wbInput = document.getElementById('qc-wb-input');
    const wbBrowseBtn = document.getElementById('qc-browse-wb-btn');
    const wbDropZone = document.getElementById('qc-drop-wb');

    if (wbBrowseBtn && wbInput) {
      wbBrowseBtn.addEventListener('click', () => wbInput.click());
    }
    if (wbInput) {
      wbInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) handleExcelUpload(e.target.files[0]);
      });
    }
    if (wbDropZone) {
      wbDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        wbDropZone.classList.add('dragover');
      });
      wbDropZone.addEventListener('dragleave', () => wbDropZone.classList.remove('dragover'));
      wbDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        wbDropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleExcelUpload(e.dataTransfer.files[0]);
        }
      });
    }

    if (loadSampleBtn) {
      loadSampleBtn.addEventListener('click', loadSampleQCData);
    }

    // Render empty state
    renderQCWorkspace();
  }

  // Export module to window
  window.QCModule = {
    init: initQCModule,
    loadSampleData: loadSampleQCData,
    handleBrowserFolderUpload: handleBrowserFolderUpload,
    render: renderQCWorkspace,
    state: state
  };

})(window);
