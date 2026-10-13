/**
 * test_browser_engine.js
 * Validates the pure JS engine against Shoebox MDL.cibd19
 */
const fs = require('fs');
const path = require('path');
const martinez = require('./assets/martinez.min.js');

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

      // Distance from p to line segment (prev -> nxt)
      const dx = nxt[0] - prev[0];
      const dy = nxt[1] - prev[1];
      const lenSq = dx * dx + dy * dy;
      let dist = 0;
      if (lenSq === 0) {
        dist = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      } else {
        const t = ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / lenSq;
        // Check if projected point is roughly on segment
        if (t >= -0.05 && t <= 1.05) {
          const px = prev[0] + t * dx;
          const py = prev[1] + t * dy;
          dist = Math.hypot(p[0] - px, p[1] - py);
        } else {
          dist = 1000;
        }
      }

      if (dist < tol) {
        changed = true; // remove collinear point
      } else {
        next.push(p);
      }
    }
    cur = next;
  }
  return cur;
}

function combineFloorsJS(floors, simplifyTol = 0.01) {
  if (!floors || floors.length === 0) {
    return { success: false, error: 'No child floors found', vertices: [], area: 0, z: 0 };
  }

  const validFloors = floors.filter(f => f.coords && f.coords.length >= 3);
  if (validFloors.length === 0) {
    return { success: false, error: 'Floors lack valid coords', vertices: [], area: 0, z: 0 };
  }

  let zSum = 0, zCount = 0;
  validFloors.forEach(f => f.coords.forEach(pt => { zSum += pt[2]; zCount++; }));
  const avgZ = Math.round((zSum / zCount) * 10000) / 10000;

  // Convert each floor to GeoJSON multi-polygon format: [[[ [x, y], ... ]]]
  const floorPolys = validFloors.map(f => {
    const pts = f.coords.map(p => [p[0], p[1]]);
    if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
      pts.push([...pts[0]]);
    }
    return [pts]; // Polygon with 1 ring
  });

  let unionGeom = floorPolys[0];
  for (let i = 1; i < floorPolys.length; i++) {
    try {
      unionGeom = martinez.union(unionGeom, floorPolys[i]);
    } catch (e) {
      console.warn('Martinez union error:', e);
    }
  }

  // Normalize geometry to extract exterior rings
  let rings = [];
  if (Array.isArray(unionGeom) && unionGeom.length > 0) {
    // If MultiPolygon: array of polygons where each polygon is [ ring, ... ]
    if (Array.isArray(unionGeom[0]) && Array.isArray(unionGeom[0][0]) && Array.isArray(unionGeom[0][0][0])) {
      for (const poly of unionGeom) {
        if (poly && poly.length > 0 && poly[0].length >= 3) {
          rings.push(poly[0]);
        }
      }
    } else if (Array.isArray(unionGeom[0]) && Array.isArray(unionGeom[0][0])) {
      // Single Polygon: [ ring, ... ]
      rings.push(unionGeom[0]);
    } else if (Array.isArray(unionGeom[0])) {
      // Single ring: [ [x, y], ... ]
      rings.push(unionGeom);
    }
  }

  if (rings.length === 0) {
    return { success: false, error: 'Union produced empty geometry', vertices: [], area: 0, z: avgZ };
  }

  // Find largest ring by area
  let bestRing = rings[0];
  let maxArea = shoelaceArea2D(bestRing);
  for (let r = 1; r < rings.length; r++) {
    const a = shoelaceArea2D(rings[r]);
    if (a > maxArea) {
      maxArea = a;
      bestRing = rings[r];
    }
  }

  // Strip closing point
  const rawCoords = (bestRing[0][0] === bestRing[bestRing.length - 1][0] &&
                     bestRing[0][1] === bestRing[bestRing.length - 1][1])
    ? bestRing.slice(0, -1)
    : bestRing;

  // Simplify collinear vertices
  const simplified = simplifyCollinear(rawCoords, simplifyTol);
  const finalVerts = simplified.map(p => [
    Math.round(p[0] * 10000) / 10000,
    Math.round(p[1] * 10000) / 10000,
    avgZ
  ]);

  const cleanArea = Math.round(shoelaceArea2D(finalVerts) * 100) / 100;

  return {
    success: true,
    is_multipolygon: rings.length > 1,
    num_parts: rings.length,
    vertices: finalVerts,
    vertex_count: finalVerts.length,
    area: cleanArea,
    total_area: Math.round(maxArea * 100) / 100,
    z: avgZ
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

  // Second pass: area mismatch & precomputed auto_union
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
const cibdPath = path.join(__dirname, 'Shoebox MDL.cibd19');
const content = fs.readFileSync(cibdPath, 'utf-8');
const model = parseCBECCModelJS(content, 'Shoebox MDL.cibd19');

console.log('--- JS CBECC ENGINE VERIFICATION ---');
console.log('Total spaces:  ', model.total_spaces, '(Expected: 83)');
console.log('Missing count: ', model.missing_count, '(Expected: 6)');
console.log('Valid count:   ', model.valid_count, '(Expected: 77)');
console.log('Max PolyLoop:  ', model.max_polyloop_id, '(Expected: 177)');
console.log('Max Cartesian: ', model.max_cartesian_id, '(Expected: 928)');

console.log('\nMissing & Mismatched spaces detected:');
model.missing_spaces.forEach(s => {
  console.log(` - ${s.name}: mismatch=${s.area_mismatch}, hasPoly=${s.has_polyloop}, floors=${s.floors.length}, autoUnion=${s.auto_union.success} (${s.auto_union.vertex_count} pts, ${s.auto_union.area} sq ft)`);
});

const l02_201 = model.missing_spaces.find(s => s.name === 'L02-201_OfceRaccPthpHrv3');
console.log('\nL02-201 result:');
console.log(' - Vertices count:', l02_201.auto_union.vertex_count, '(Expected: 4)');
console.log(' - Vertices:', JSON.stringify(l02_201.auto_union.vertices));
console.log(' - Area:', l02_201.auto_union.area, '(Expected: ~641.2)');

if (model.missing_count === 6 && l02_201.auto_union.vertex_count === 4) {
  console.log('\n>>> ALL JS ENGINE VERIFICATION CHECKS PASSED 100%! <<<');
} else {
  console.error('\n>>> VERIFICATION FAILED! <<<');
  process.exit(1);
}

// Now test injection
const fixes = {};
const meta = {};
for (const s of model.missing_spaces) {
  fixes[s.name] = s.auto_union.vertices;
  meta[s.name] = {
    can_reuse_poly_name: s.can_reuse_poly_name || s.area_mismatch,
    existing_poly_name: s.existing_poly_name
  };
}

const injResult = injectFixesJS(content, fixes, model.max_polyloop_id + 1, model.max_cartesian_id + 1, meta);
console.log('\n--- JS INJECTION TEST ---');
console.log('Fixed count:', injResult.summary.fixed_count, '(Expected: 6)');
const repModel = parseCBECCModelJS(injResult.repairedText, 'repaired.cibd');
console.log('Repaired missing count:', repModel.missing_count, '(Expected: 0)');
console.log('Repaired valid count:  ', repModel.valid_count, '(Expected: 83)');

if (repModel.missing_count === 0 && repModel.valid_count === 83) {
  console.log('>>> JS BATCH REPAIR & INJECTION VERIFICATION PASSED 100%! <<<\n');
} else {
  console.error('>>> JS INJECTION VERIFICATION FAILED! <<<');
  process.exit(1);
}
