/**
 * O'Brien360 Tools Suite - CBECC XML Viewer
 * Proprietary, clean-room implementation of 2D vector & 3D WebGL inspection
 * for California Building Energy Code Compliance (CBECC) XML models.
 *
 * Copyright (c) O'Brien360. All rights reserved.
 */

(function () {
  'use strict';

  /* =============================================================================
     1. XML Helper Utilities
     ============================================================================= */

  class XmlUtils {
    static getChildren(element, tagName) {
      if (!element) return [];
      return Array.from(element.children).filter(child => child.tagName === tagName);
    }

    static getFirstChild(element, tagName) {
      if (!element) return null;
      for (let i = 0; i < element.children.length; i++) {
        if (element.children[i].tagName === tagName) {
          return element.children[i];
        }
      }
      return null;
    }

    static getText(element, tagName, fallback = '') {
      const child = XmlUtils.getFirstChild(element, tagName);
      if (child && child.textContent && child.textContent.trim() !== '') {
        return child.textContent.trim();
      }
      return fallback;
    }

    static getFloat(element, tagName, fallback = null) {
      const text = XmlUtils.getText(element, tagName, '');
      if (!text) return fallback;
      const val = parseFloat(text);
      return Number.isFinite(val) ? val : fallback;
    }

    static getDescendants(rootElement, tagName) {
      if (!rootElement) return [];
      return Array.from(rootElement.getElementsByTagName(tagName));
    }

    static escapeString(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    static formatArea(areaSqFt) {
      if (areaSqFt == null || !Number.isFinite(areaSqFt)) return '—';
      return Math.round(areaSqFt).toLocaleString('en-US') + ' sq ft';
    }

    static formatDecimal(val, digits = 1) {
      if (val == null || !Number.isFinite(val)) return '—';
      return val.toFixed(digits);
    }
  }

  /* =============================================================================
     2. Standard Geometric Algorithms (Public Domain / Classical Mathematics)
     ============================================================================= */

  class GeometryEngine {
    static dotProduct(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    static crossProduct(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
      ];
    }

    static vectorLength(v) {
      return Math.hypot(v[0], v[1], v[2]);
    }

    static normalizeVector(v) {
      const len = GeometryEngine.vectorLength(v);
      return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    }

    /**
     * Newell's method for calculating the normal vector of a 3D polygon.
     * The magnitude of Newell's normal vector equals twice the 3D polygon area.
     */
    static computeNewellNormal(vertices) {
      let nx = 0, ny = 0, nz = 0;
      const count = vertices.length;
      for (let i = 0; i < count; i++) {
        const [x1, y1, z1] = vertices[i];
        const [x2, y2, z2] = vertices[(i + 1) % count];
        nx += (y1 - y2) * (z1 + z2);
        ny += (z1 - z2) * (x1 + x2);
        nz += (x1 - x2) * (y1 + y2);
      }
      return [nx * 0.5, ny * 0.5, nz * 0.5];
    }

    static computePolygonArea3D(vertices) {
      const [nx, ny, nz] = GeometryEngine.computeNewellNormal(vertices);
      return Math.sqrt(nx * nx + ny * ny + nz * nz);
    }

    static computePolygonNormal(vertices) {
      const newellVec = GeometryEngine.computeNewellNormal(vertices);
      return GeometryEngine.normalizeVector(newellVec);
    }

    static computeCentroid3D(vertices) {
      const sum = vertices.reduce(
        (acc, pt) => [acc[0] + pt[0], acc[1] + pt[1], acc[2] + pt[2]],
        [0, 0, 0]
      );
      const n = vertices.length;
      return [sum[0] / n, sum[1] / n, sum[2] / n];
    }

    static computeShoelaceArea2D(vertices2D) {
      let accum = 0;
      const count = vertices2D.length;
      for (let i = 0; i < count; i++) {
        const p1 = vertices2D[i];
        const p2 = vertices2D[(i + 1) % count];
        accum += p1[0] * p2[1] - p2[0] * p1[1];
      }
      return Math.abs(accum) * 0.5;
    }

    static fitPlane(vertices) {
      if (!vertices || vertices.length < 3) return null;
      const origin = GeometryEngine.computeCentroid3D(vertices);
      const normal = GeometryEngine.computePolygonNormal(vertices);
      if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) return null;

      const arbitrary = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const rawU = GeometryEngine.crossProduct(arbitrary, normal);
      const u = GeometryEngine.normalizeVector(rawU);
      const v = GeometryEngine.crossProduct(normal, u);
      return { origin, normal, u, v };
    }

    static calculateOrientation(normal, buildingAzimuth = 0) {
      const clampedZ = Math.max(-1, Math.min(1, normal[2]));
      const tilt = Math.round(Math.acos(clampedZ) * (180 / Math.PI));
      const horizontalSpan = Math.hypot(normal[0], normal[1]);

      if (horizontalSpan < 1e-4) {
        return { modelAz: null, trueAz: null, tilt };
      }

      // North = +Y (0 deg), East = +X (90 deg)
      let modelAz = Math.atan2(normal[0], normal[1]) * (180 / Math.PI);
      modelAz = ((modelAz % 360) + 360) % 360;
      const trueAz = ((modelAz + buildingAzimuth) % 360 + 360) % 360;
      return { modelAz, trueAz, tilt };
    }

    static getCardinalDirection(trueAzimuth) {
      if (trueAzimuth == null) return '—';
      const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const index = Math.round(((trueAzimuth % 360) + 360) % 360 / 45) % 8;
      return directions[index];
    }

    static computeWallBaseSegment(vertices) {
      const minZ = Math.min(...vertices.map(pt => pt[2]));
      const basePoints = vertices.filter(pt => Math.abs(pt[2] - minZ) < 0.05);

      const searchSet = basePoints.length >= 2 ? basePoints : vertices;
      let bestPair = [searchSet[0], searchSet[1]];
      let maxDist = -1;

      for (let i = 0; i < searchSet.length; i++) {
        for (let j = i + 1; j < searchSet.length; j++) {
          const dist = Math.hypot(searchSet[i][0] - searchSet[j][0], searchSet[i][1] - searchSet[j][1]);
          if (dist > maxDist) {
            maxDist = dist;
            bestPair = [searchSet[i], searchSet[j]];
          }
        }
      }
      return bestPair;
    }

    static computePolygonInteriorPoint(vertices2D) {
      let areaSum = 0, centerX = 0, centerY = 0;
      const count = vertices2D.length;
      for (let i = 0; i < count; i++) {
        const p1 = vertices2D[i], p2 = vertices2D[(i + 1) % count];
        const factor = p1[0] * p2[1] - p2[0] * p1[1];
        areaSum += factor;
        centerX += (p1[0] + p2[0]) * factor;
        centerY += (p1[1] + p2[1]) * factor;
      }
      if (Math.abs(areaSum) < 1e-6) {
        const c = GeometryEngine.computeCentroid3D(vertices2D);
        return [c[0], c[1]];
      }
      return [centerX / (3 * areaSum), centerY / (3 * areaSum)];
    }
  }

  /* =============================================================================
     3. CBECC XML Model Parser
     ============================================================================= */

  const ENVELOPE_TAGS = ['ExtWall', 'IntWall', 'Roof', 'ExtFlr', 'IntFlr', 'UndgrFlr', 'UndgrWall', 'Ceiling', 'SlabFlr'];
  const EXTERIOR_ENVELOPE_TAGS = new Set(['ExtWall', 'Roof', 'ExtFlr', 'UndgrWall']);

  const SURFACE_DISPLAY_NAMES = {
    ExtWall: 'Exterior Wall',
    IntWall: 'Interior Wall',
    Roof: 'Roof',
    ExtFlr: 'Exterior Floor',
    IntFlr: 'Interior Floor',
    UndgrFlr: 'Underground Floor',
    UndgrWall: 'Underground Wall',
    Ceiling: 'Ceiling',
    SlabFlr: 'Slab Floor',
    Win: 'Window',
    Dr: 'Door',
    Skylt: 'Skylight',
    Shade: 'Exterior Shading Object',
    Space: 'Conditioned Space'
  };

  class CbeccXmlParser {
    static extractPolyLoopVertices(polyLoopElement) {
      if (!polyLoopElement) return [];

      // Check standard CBECC SDD XML format: <CartesianPt><Coord>x</Coord>...
      let pts = XmlUtils.getChildren(polyLoopElement, 'CartesianPt').map(ptElement => {
        const coords = XmlUtils.getChildren(ptElement, 'Coord').map(c => parseFloat(c.textContent));
        return [coords[0], coords[1], coords[2] === undefined ? 0 : coords[2]];
      }).filter(pt => pt.every(Number.isFinite));

      if (pts.length >= 3) return pts;

      // Check alternate CBECC variant: <CartPt>
      pts = XmlUtils.getChildren(polyLoopElement, 'CartPt').map(ptElement => {
        const coords = XmlUtils.getChildren(ptElement, 'Coord').map(c => parseFloat(c.textContent));
        return [coords[0], coords[1], coords[2] === undefined ? 0 : coords[2]];
      }).filter(pt => pt.every(Number.isFinite));

      return pts;
    }

    static findModelRoot(xmlDocument) {
      const models = XmlUtils.getDescendants(xmlDocument, 'Model');
      if (models.length > 0) {
        const userInputModel = models.find(m => m.getAttribute('Name') === 'User Input') || models[0];
        const building = XmlUtils.getDescendants(userInputModel, 'Bldg')[0];
        if (building) return { building, contextRoot: userInputModel };
      }
      const directBuilding = xmlDocument.getElementsByTagName('Bldg')[0] || null;
      return { building: directBuilding, contextRoot: xmlDocument };
    }

    static parse(xmlString) {
      const xmlDoc = new DOMParser().parseFromString(xmlString, 'application/xml');
      if (!xmlDoc || xmlDoc.getElementsByTagName('parsererror').length > 0) {
        throw new Error('Invalid XML document. Please verify the file is a well-formed CBECC XML model.');
      }

      const { building, contextRoot } = CbeccXmlParser.findModelRoot(xmlDoc);
      if (!building) {
        throw new Error('No <Bldg> building element found in the XML document.');
      }

      const warnings = [];
      const projElement = XmlUtils.getDescendants(contextRoot, 'Proj')[0] || null;
      const buildingAzimuth = XmlUtils.getFloat(building, 'BldgAz', 0) || 0;

      const project = {
        name: XmlUtils.getText(projElement, 'Name', '') || XmlUtils.getText(building, 'Name', 'CBECC Project'),
        bldgName: XmlUtils.getText(building, 'Name', 'Building 1'),
        bldgAz: buildingAzimuth,
        climateZone: XmlUtils.getText(projElement, 'CliZn', '') || XmlUtils.getText(projElement, 'PRMCliZn', 'CZ'),
        geometryInpType: XmlUtils.getText(projElement, 'GeometryInpType', 'Detailed')
      };

      /* Construction Assemblies Library */
      const constructions = {};

      XmlUtils.getDescendants(contextRoot, 'ConsAssm').forEach(assm => {
        const name = XmlUtils.getText(assm, 'Name', '');
        if (!name) return;
        const layers = XmlUtils.getChildren(assm, 'MatRef')
          .map(ref => ({ index: parseInt(ref.getAttribute('index') || '0', 10), name: ref.textContent.trim() }))
          .filter(ref => ref.name && ref.name !== '- none -')
          .sort((a, b) => a.index - b.index)
          .map(ref => ref.name);

        const extraSpecs = {};
        ['SlabType', 'SlabInsOrientation', 'SlabInsThrmlR', 'RoofDens', 'CRRCInitialRefl', 'CRRCAgedRefl', 'UFactor']
          .forEach(tag => {
            const val = XmlUtils.getText(assm, tag, '');
            if (val) extraSpecs[tag] = val;
          });

        constructions[name] = {
          name, kind: 'opaque', count: 0, area: 0, grossArea: 0,
          usedBy: new Set(), layers, uFactor: XmlUtils.getFloat(assm, 'UFactor'),
          surfType: XmlUtils.getText(assm, 'CompatibleSurfType', ''), extra: extraSpecs
        };
      });

      XmlUtils.getDescendants(contextRoot, 'FenCons').forEach(fen => {
        const name = XmlUtils.getText(fen, 'Name', '');
        if (!name) return;
        constructions[name] = {
          name, kind: 'fen', count: 0, area: 0, grossArea: 0,
          usedBy: new Set(), fenType: XmlUtils.getText(fen, 'FenType', ''),
          shgc: XmlUtils.getFloat(fen, 'SHGC'), uFactor: XmlUtils.getFloat(fen, 'UFactor'),
          vt: XmlUtils.getFloat(fen, 'VT'), certMthd: XmlUtils.getText(fen, 'CertificationMthd', '')
        };
      });

      XmlUtils.getDescendants(contextRoot, 'DrCons').forEach(door => {
        const name = XmlUtils.getText(door, 'Name', '');
        if (!name) return;
        constructions[name] = {
          name, kind: 'door', count: 0, area: 0, grossArea: 0,
          usedBy: new Set(), doorType: XmlUtils.getText(door, 'DrType', ''),
          uFactor: XmlUtils.getFloat(door, 'UFactor'), certMthd: XmlUtils.getText(door, 'CertificationMthd', '')
        };
      });

      function registerConstructionUsage(consName, surfaceType, netArea, grossArea) {
        if (!consName) return;
        let c = constructions[consName];
        if (!c) {
          c = { name: consName, kind: 'opaque', count: 0, area: 0, grossArea: 0, usedBy: new Set(), layers: [], missing: true };
          constructions[consName] = c;
        }
        c.count++;
        c.area += netArea;
        c.grossArea += (grossArea || netArea);
        c.usedBy.add(surfaceType);
      }

      /* Hierarchy: Stories, Spaces, Surfaces, Openings */
      const stories = [], spaces = [], surfaces = [], openings = [], elementMap = {};
      let elementIdCounter = 0;
      const generateElementId = prefix => `${prefix}-${elementIdCounter++}`;

      XmlUtils.getChildren(building, 'Story').forEach((storyEl, storyIdx) => {
        const storyName = XmlUtils.getText(storyEl, 'Name', `Story ${storyIdx + 1}`);
        const story = { name: storyName, index: storyIdx, z: null, spaces: [] };
        stories.push(story);

        XmlUtils.getChildren(storyEl, 'Spc').forEach(spaceEl => {
          const spaceName = XmlUtils.getText(spaceEl, 'Name', 'Space');
          const thermalZone = XmlUtils.getText(spaceEl, 'ThrmlZnRef', '') || '(Unassigned Zone)';
          const floorPolyLoop = XmlUtils.getFirstChild(spaceEl, 'PolyLp');
          const floorVertices = CbeccXmlParser.extractPolyLoopVertices(floorPolyLoop);

          const space = {
            id: generateElementId('Space'), kind: 'space', type: 'Space', name: spaceName,
            story: storyName, zone: thermalZone, func: XmlUtils.getText(spaceEl, 'SpcFunc', 'Unspecified'),
            floorPts: floorVertices,
            floorArea: floorVertices.length >= 3 ? GeometryEngine.computeShoelaceArea2D(floorVertices) : (XmlUtils.getFloat(spaceEl, 'Area', 0) || 0),
            surfaceIds: []
          };

          if (floorVertices.length >= 3) {
            const minZ = Math.min(...floorVertices.map(pt => pt[2]));
            story.z = story.z === null ? minZ : Math.min(story.z, minZ);
          }

          spaces.push(space);
          story.spaces.push(space);
          elementMap[space.id] = space;

          ENVELOPE_TAGS.forEach(envelopeTag => {
            XmlUtils.getChildren(spaceEl, envelopeTag).forEach(surfaceEl => {
              const surfaceName = XmlUtils.getText(surfaceEl, 'Name', envelopeTag);
              const polyLoopEl = XmlUtils.getFirstChild(surfaceEl, 'PolyLp');
              const vertices = CbeccXmlParser.extractPolyLoopVertices(polyLoopEl);

              if (vertices.length < 3) {
                warnings.push(`${envelopeTag} "${surfaceName}" in space "${spaceName}" has missing or degenerate polygon coordinates.`);
                return;
              }

              const normal = GeometryEngine.computePolygonNormal(vertices);
              const grossArea = GeometryEngine.computePolygonArea3D(vertices);
              const orientationInfo = GeometryEngine.calculateOrientation(normal, buildingAzimuth);

              const surface = {
                id: generateElementId(envelopeTag), kind: 'surface', type: envelopeTag, name: surfaceName,
                story: storyName, space: spaceName, spaceId: space.id, zone: thermalZone,
                construction: XmlUtils.getText(surfaceEl, 'ConsAssmRef', ''), pts: vertices, normal,
                grossArea, netArea: grossArea, ...orientationInfo, openingIds: [],
                exterior: EXTERIOR_ENVELOPE_TAGS.has(envelopeTag),
                adjacentSpace: XmlUtils.getText(surfaceEl, 'AdjacentSpcRef', '')
              };

              surfaces.push(surface);
              elementMap[surface.id] = surface;
              space.surfaceIds.push(surface.id);

              let totalOpeningsArea = 0;
              [
                ['Win', 'FenConsRef', 'fen'],
                ['Skylt', 'FenConsRef', 'fen'],
                ['Dr', 'DrConsRef', 'door']
              ].forEach(([openingTag, consRefTag, openingKind]) => {
                XmlUtils.getChildren(surfaceEl, openingTag).forEach(openingEl => {
                  const openingName = XmlUtils.getText(openingEl, 'Name', openingTag);
                  const openPolyEl = XmlUtils.getFirstChild(openingEl, 'PolyLp');
                  const openVertices = CbeccXmlParser.extractPolyLoopVertices(openPolyEl);

                  if (openVertices.length < 3) {
                    warnings.push(`${openingTag} "${openingName}" on surface "${surfaceName}" has invalid polygon vertices.`);
                    return;
                  }

                  const openNormal = GeometryEngine.computePolygonNormal(openVertices);
                  const openArea = GeometryEngine.computePolygonArea3D(openVertices);
                  const openOrientation = GeometryEngine.calculateOrientation(openNormal, buildingAzimuth);

                  const opening = {
                    id: generateElementId(openingTag), kind: 'opening', type: openingTag, openingKind,
                    name: openingName, story: storyName, space: spaceName, zone: thermalZone,
                    hostId: surface.id, pts: openVertices, normal: openNormal, area: openArea,
                    construction: XmlUtils.getText(openingEl, consRefTag, ''), ...openOrientation
                  };

                  openings.push(opening);
                  elementMap[opening.id] = opening;
                  surface.openingIds.push(opening.id);
                  totalOpeningsArea += openArea;
                  registerConstructionUsage(opening.construction, openingTag, openArea, openArea);
                });
              });

              surface.netArea = Math.max(0, grossArea - totalOpeningsArea);
              registerConstructionUsage(surface.construction, envelopeTag, surface.netArea, grossArea);
            });
          });
        });
      });

      // Calculate story heights and sort from foundation up
      stories.forEach(st => { if (st.z === null) st.z = 0; });
      const sortedStories = stories.slice().sort((a, b) => a.z - b.z);
      sortedStories.forEach((st, idx) => {
        st.zTop = idx < sortedStories.length - 1 ? sortedStories[idx + 1].z : st.z + 14;
      });

      /* Exterior Shading Objects */
      const shades = [];
      XmlUtils.getDescendants(building, 'ExtShdgObj').forEach(shadeEl => {
        const shadeName = XmlUtils.getText(shadeEl, 'Name', 'Shade');
        const polyEl = XmlUtils.getFirstChild(shadeEl, 'PolyLp');
        const vertices = CbeccXmlParser.extractPolyLoopVertices(polyEl);

        if (vertices.length < 3) {
          warnings.push(`Shading object "${shadeName}" has invalid polygon vertices.`);
          return;
        }

        const normal = GeometryEngine.computePolygonNormal(vertices);
        const centroid = GeometryEngine.computeCentroid3D(vertices);
        const storyMatch = sortedStories.find(st => centroid[2] >= st.z - 0.01 && centroid[2] < st.zTop - 0.01)
          || sortedStories[sortedStories.length - 1] || null;

        const shade = {
          id: generateElementId('Shade'), kind: 'shade', type: 'Shade', name: shadeName,
          pts: vertices, normal, area: GeometryEngine.computePolygonArea3D(vertices),
          ...GeometryEngine.calculateOrientation(normal, buildingAzimuth), centroid,
          story: storyMatch ? storyMatch.name : '',
          solRefl: XmlUtils.getFloat(shadeEl, 'SolRefl'),
          visRefl: XmlUtils.getFloat(shadeEl, 'VisRefl'),
          transOption: XmlUtils.getText(shadeEl, 'TransOption', '')
        };
        shades.push(shade);
        elementMap[shade.id] = shade;
      });

      const hasDetailedGeometry = spaces.some(s => s.floorPts.length >= 3) || surfaces.length > 0;
      if (!hasDetailedGeometry) {
        throw new Error('This CBECC XML model contains no detailed 3D polygon geometry (PolyLp coordinates).');
      }

      return {
        project,
        stories: sortedStories,
        spaces,
        surfaces,
        openings,
        shades,
        constructions,
        byId: elementMap,
        warnings
      };
    }
  }

  /* =============================================================================
     4. Color Mapping & Legend Builder
     ============================================================================= */

  const OB360_COLOR_PALETTE = [
    '#4D76AD', '#8CBD3A', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948',
    '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#86bcb6', '#d37295', '#8cd17d',
    '#b6992d', '#499894', '#f1ce63', '#a0cbe8', '#ffbe7d', '#d4a6c8'
  ];

  const SURFACE_TYPE_COLORS = {
    ExtWall: '#C59B6D',
    IntWall: '#B9B6AB',
    Roof: '#8F8A80',
    ExtFlr: '#A88F6E',
    IntFlr: '#CFCAC0',
    UndgrFlr: '#9D9D8F',
    UndgrWall: '#7D7A6E',
    Ceiling: '#D8D4CA',
    SlabFlr: '#9D9D8F',
    Win: '#6FA8DC',
    Skylt: '#9FC5E8',
    Dr: '#8D6E63'
  };

  const SHADING_SURFACE_FILL = 'rgba(55, 55, 50, 0.45)';
  const SHADING_STROKE_COLOR = '#2F2F2A';
  const SHADE_ISOLATE_KEY = '__shade';

  class ColorSchemeManager {
    static buildMaps(model) {
      const maps = {
        construction: {},
        zone: {},
        space: {},
        type: SURFACE_TYPE_COLORS
      };

      const kindSort = { opaque: 0, fen: 1, door: 2 };
      Object.values(model.constructions)
        .filter(c => c.count > 0)
        .sort((a, b) => kindSort[a.kind] - kindSort[b.kind] || a.name.localeCompare(b.name))
        .forEach((c, idx) => {
          maps.construction[c.name] = OB360_COLOR_PALETTE[idx % OB360_COLOR_PALETTE.length];
        });

      const uniqueZones = [...new Set(model.spaces.map(s => s.zone))].sort();
      uniqueZones.forEach((zone, idx) => {
        maps.zone[zone] = OB360_COLOR_PALETTE[idx % OB360_COLOR_PALETTE.length];
      });

      model.spaces.forEach((space, idx) => {
        maps.space[space.name] = OB360_COLOR_PALETTE[idx % OB360_COLOR_PALETTE.length];
      });

      return maps;
    }

    static getKeyForObject(obj, mode) {
      if (!obj) return '';
      if (obj.kind === 'shade') return SHADE_ISOLATE_KEY;
      if (mode === 'construction') return obj.construction || '';
      if (mode === 'zone') return obj.zone || '';
      if (mode === 'space') return obj.kind === 'space' ? obj.name : (obj.space || '');
      if (mode === 'type') return obj.type || '';
      return '';
    }

    static getColorForObject(obj, mode, colorMaps) {
      if (obj.kind === 'shade') return SHADING_SURFACE_FILL;
      if (mode === 'construction') return colorMaps.construction[obj.construction] || '#B0B0A8';
      if (mode === 'type') return colorMaps.type[obj.type] || '#B0B0A8';
      if (mode === 'zone') return colorMaps.zone[obj.zone] || '#D0CEC4';
      if (mode === 'space') return colorMaps.space[obj.kind === 'space' ? obj.name : obj.space] || '#D0CEC4';
      return '#CCCCCC';
    }

    static getHexColorNumber(obj, mode, colorMaps) {
      if (obj.kind === 'shade') return 0x373732;
      const colorString = ColorSchemeManager.getColorForObject(obj, mode, colorMaps);
      if (colorString && colorString.startsWith('#')) {
        return parseInt(colorString.slice(1), 16);
      }
      return 0xCBD5E1;
    }

    static buildLegendEntries(model, mode, colorMaps) {
      const entries = [];
      if (mode === 'construction') {
        const groups = [
          ['opaque', 'Opaque Envelope Assemblies (ConsAssm)'],
          ['fen', 'Fenestration Assemblies (FenCons)'],
          ['door', 'Door Assemblies (DrCons)']
        ];
        groups.forEach(([kind, groupTitle]) => {
          const list = Object.values(model.constructions).filter(c => c.kind === kind && c.count > 0).sort((a, b) => b.area - a.area);
          if (!list.length) return;
          entries.push({ header: groupTitle });
          list.forEach(c => entries.push({
            key: c.name, label: c.name, color: colorMaps.construction[c.name], area: c.area,
            drawn: [...c.usedBy].some(t => t !== 'IntFlr' && t !== 'Ceiling' && t !== 'UndgrFlr' && t !== 'SlabFlr')
          }));
        });
      } else if (mode === 'type') {
        const accumulator = {};
        model.surfaces.forEach(s => { accumulator[s.type] = (accumulator[s.type] || 0) + s.netArea; });
        model.openings.forEach(o => { accumulator[o.type] = (accumulator[o.type] || 0) + o.area; });
        Object.keys(accumulator).forEach(t => entries.push({
          key: t, label: SURFACE_DISPLAY_NAMES[t] || t, color: SURFACE_TYPE_COLORS[t], area: accumulator[t],
          drawn: !['IntFlr', 'Ceiling', 'UndgrFlr', 'SlabFlr'].includes(t)
        }));
      } else if (mode === 'zone') {
        const accumulator = {};
        model.spaces.forEach(s => { accumulator[s.zone] = (accumulator[s.zone] || 0) + s.floorArea; });
        Object.keys(accumulator).sort().forEach(zone => entries.push({
          key: zone, label: zone, color: colorMaps.zone[zone], area: accumulator[zone], areaLabel: 'floor', drawn: true
        }));
      } else if (mode === 'space') {
        model.stories.forEach(story => {
          entries.push({ header: story.name });
          story.spaces.forEach(s => entries.push({
            key: s.name, label: s.name, color: colorMaps.space[s.name], area: s.floorArea, areaLabel: 'floor', drawn: true
          }));
        });
      }
      if (model.shades.length) {
        entries.push({ header: 'Exterior Shading' });
        entries.push({
          key: SHADE_ISOLATE_KEY, label: `Shading Objects (${model.shades.length})`, color: SHADING_SURFACE_FILL,
          area: model.shades.reduce((sum, sh) => sum + sh.area, 0), drawn: true
        });
      }
      return entries;
    }
  }

  /* =============================================================================
     5. 2D Floor Plan & Elevation Vector Renderers
     ============================================================================= */

  class Vector2DRenderer {
    static createSvgElement(tag, attributes = {}, parent = null) {
      const elem = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([k, v]) => {
        if (v !== null && v !== undefined) elem.setAttribute(k, v);
      });
      if (parent) parent.appendChild(elem);
      return elem;
    }

    static formatSvgPoints(points) {
      return points.map(pt => `${pt[0].toFixed(2)},${pt[1].toFixed(2)}`).join(' ');
    }

    static drawScaleBar(container, x, y, extent, fontSize) {
      const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
      const target = extent / 6;
      const barLength = steps.find(s => s >= target) || 1000;

      Vector2DRenderer.createSvgElement('line', {
        x1: x, y1: y, x2: x + barLength, y2: y,
        stroke: '#1E293B', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke'
      }, container);

      [x, x + barLength].forEach(posX => {
        Vector2DRenderer.createSvgElement('line', {
          x1: posX, y1: y - fontSize * 0.4, x2: posX, y2: y + fontSize * 0.4,
          stroke: '#1E293B', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke'
        }, container);
      });

      const label = Vector2DRenderer.createSvgElement('text', {
        x: x + barLength / 2, y: y - fontSize * 0.7,
        'font-size': fontSize, 'text-anchor': 'middle', fill: '#475569'
      }, container);
      label.textContent = `${barLength} ft`;
    }

    static drawNorthArrow(container, x, y, size, fontSize, buildingAzimuth = 0) {
      const group = Vector2DRenderer.createSvgElement('g', {
        transform: `translate(${x},${y}) rotate(${-buildingAzimuth})`
      }, container);

      Vector2DRenderer.createSvgElement('polygon', {
        points: `0,${-size} ${size * 0.35},${size * 0.5} 0,${size * 0.2} ${-size * 0.35},${size * 0.5}`,
        fill: '#0F172A'
      }, group);

      const label = Vector2DRenderer.createSvgElement('text', {
        x: 0, y: -size - fontSize * 0.5, 'font-size': fontSize * 1.1,
        'text-anchor': 'middle', fill: '#0F172A'
      }, group);
      label.textContent = 'N';
    }

    static renderPlanView(model, storyName, options, svgRoot) {
      const { mode, maps, showShades, showLabels } = options;
      const planItems = { spaces: [], intWalls: [], extWalls: [], openings: [], roofs: [], skylights: [], shades: [] };

      if (storyName === '__roof') {
        model.surfaces.filter(s => s.type === 'Roof').forEach(roof => {
          planItems.roofs.push(roof);
          roof.openingIds.forEach(id => {
            const op = model.byId[id];
            if (op && op.type === 'Skylt') planItems.skylights.push(op);
          });
        });
        if (showShades) planItems.shades = model.shades.slice();
      } else {
        model.spaces.filter(s => s.story === storyName && s.floorPts.length >= 3).forEach(sp => planItems.spaces.push(sp));
        model.surfaces.filter(s => s.story === storyName).forEach(s => {
          if (s.type === 'IntWall' && Math.abs(s.normal[2]) < 0.2) planItems.intWalls.push(s);
          else if ((s.type === 'ExtWall' || s.type === 'UndgrWall') && Math.abs(s.normal[2]) < 0.2) {
            planItems.extWalls.push(s);
            s.openingIds.forEach(id => {
              const op = model.byId[id];
              if (op && op.type !== 'Skylt') planItems.openings.push(op);
            });
          }
        });
        if (showShades) planItems.shades = model.shades.filter(sh => sh.story === storyName);
      }

      const allCoordinates = [];
      planItems.spaces.forEach(s => allCoordinates.push(...s.floorPts));
      [...planItems.extWalls, ...planItems.intWalls, ...planItems.roofs, ...planItems.shades].forEach(s => allCoordinates.push(...s.pts));

      if (!allCoordinates.length) {
        return { empty: 'No geometry found for this story level.' };
      }

      const xs = allCoordinates.map(pt => pt[0]);
      const ys = allCoordinates.map(pt => -pt[1]); // Invert Y for SVG coordinates
      const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 10);
      const padding = extent * 0.06;
      const fontSize = extent / 75;

      const mainGroup = Vector2DRenderer.createSvgElement('g', {}, svgRoot);
      const toSvgPoint = pt => [pt[0], -pt[1]];

      function tagElement(elem, obj) {
        elem.setAttribute('data-sel', obj.id);
        elem.setAttribute('data-k', ColorSchemeManager.getKeyForObject(obj, mode));
        return elem;
      }

      if (storyName === '__roof') {
        planItems.roofs.slice().sort((a, b) => a.pts[0][2] - b.pts[0][2]).forEach(roof => {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(roof.pts.map(toSvgPoint)),
            fill: ColorSchemeManager.getColorForObject(roof, mode, maps), 'fill-opacity': 0.75,
            stroke: '#475569', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), roof);
        });

        planItems.skylights.forEach(sky => {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(sky.pts.map(toSvgPoint)),
            fill: ColorSchemeManager.getColorForObject(sky, mode, maps),
            stroke: '#1E40AF', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), sky);
        });
      } else {
        planItems.spaces.forEach(space => {
          const fillColor = (mode === 'zone' || mode === 'space') ? ColorSchemeManager.getColorForObject(space, mode, maps) : '#F1EFE8';
          const poly = Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(space.floorPts.map(toSvgPoint)),
            fill: fillColor, 'fill-opacity': (mode === 'zone' || mode === 'space') ? 0.55 : 0.95,
            stroke: '#CBD5E1', 'stroke-width': 0.6, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup);
          poly.setAttribute('data-sel', space.id);
          if (mode === 'zone' || mode === 'space') {
            poly.setAttribute('data-k', ColorSchemeManager.getKeyForObject(space, mode));
          }
        });

        planItems.intWalls.forEach(wall => {
          const seg = GeometryEngine.computeWallBaseSegment(wall.pts);
          if (!seg) return;
          tagElement(Vector2DRenderer.createSvgElement('line', {
            x1: seg[0][0], y1: -seg[0][1], x2: seg[1][0], y2: -seg[1][1],
            stroke: (mode === 'construction' || mode === 'type') ? ColorSchemeManager.getColorForObject(wall, mode, maps) : '#94A3B8',
            'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round'
          }, mainGroup), wall);
        });

        planItems.extWalls.forEach(wall => {
          const seg = GeometryEngine.computeWallBaseSegment(wall.pts);
          if (!seg) return;
          tagElement(Vector2DRenderer.createSvgElement('line', {
            x1: seg[0][0], y1: -seg[0][1], x2: seg[1][0], y2: -seg[1][1],
            stroke: ColorSchemeManager.getColorForObject(wall, mode, maps),
            'stroke-width': 5.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'butt',
            'stroke-dasharray': wall.type === 'UndgrWall' ? '4 2' : null
          }, mainGroup), wall);
        });

        planItems.openings.forEach(op => {
          const seg = GeometryEngine.computeWallBaseSegment(op.pts);
          if (!seg) return;
          tagElement(Vector2DRenderer.createSvgElement('line', {
            x1: seg[0][0], y1: -seg[0][1], x2: seg[1][0], y2: -seg[1][1],
            stroke: op.type === 'Dr' ? (ColorSchemeManager.getColorForObject(op, mode, maps) || '#8D6E63') : (ColorSchemeManager.getColorForObject(op, mode, maps) || '#38BDF8'),
            'stroke-width': op.type === 'Dr' ? 3.5 : 2.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'square'
          }, mainGroup), op);
        });
      }

      if (showShades && planItems.shades.length) {
        planItems.shades.forEach(shade => {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(shade.pts.map(toSvgPoint)),
            fill: SHADING_SURFACE_FILL, stroke: SHADING_STROKE_COLOR,
            'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), shade);
        });
      }

      if (showLabels && storyName !== '__roof') {
        planItems.spaces.forEach(space => {
          const [cx, cy] = GeometryEngine.computePolygonInteriorPoint(space.floorPts);
          const textElem = Vector2DRenderer.createSvgElement('text', {
            x: cx, y: -cy, 'font-size': fontSize * 0.9,
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
            fill: '#0F172A', 'font-weight': '600'
          }, mainGroup);
          textElem.textContent = space.name;
        });
      }

      Vector2DRenderer.drawScaleBar(mainGroup, bounds.minX, bounds.maxY + padding * 0.8, extent, fontSize);
      Vector2DRenderer.drawNorthArrow(mainGroup, bounds.maxX, bounds.minY - padding * 0.4, extent * 0.05, fontSize, model.project.bldgAz);

      const storyObj = model.stories.find(s => s.name === storyName);
      const elevationStr = storyObj ? ` · elev ${XmlUtils.formatDecimal(storyObj.z, 1)}′` : '';
      const summaryCaption = storyName === '__roof'
        ? `Roof Plan · ${planItems.roofs.length} roof plane${planItems.roofs.length === 1 ? '' : 's'}`
        : `${storyName}${elevationStr} · ${planItems.spaces.length} spaces, ${planItems.extWalls.length + planItems.intWalls.length} walls, ${planItems.openings.length} openings`;

      return {
        viewBox: [bounds.minX - padding, bounds.minY - padding * 1.6, (bounds.maxX - bounds.minX) + padding * 2, (bounds.maxY - bounds.minY) + padding * 2.8],
        caption: summaryCaption
      };
    }

    static renderElevationView(model, modelAzimuth, options, svgRoot) {
      const { mode, maps, showShades } = options;
      const angleRad = modelAzimuth * (Math.PI / 180);
      const viewerDir = [Math.sin(angleRad), Math.cos(angleRad), 0];
      const viewerRight = [-Math.cos(angleRad), Math.sin(angleRad), 0];

      const projectedItems = [];
      const pushProjected = (obj, depthBias) => {
        const pts2D = obj.pts.map(pt => [GeometryEngine.dotProduct(pt, viewerRight), pt[2]]);
        const depth = obj.pts.reduce((sum, pt) => sum + GeometryEngine.dotProduct(pt, viewerDir), 0) / obj.pts.length;
        projectedItems.push({ obj, pts2D, depth, depthBias });
      };

      const FACING_THRESHOLD = 0.05;
      model.surfaces.forEach(s => {
        if (!s.exterior) return;
        if (GeometryEngine.dotProduct(s.normal, viewerDir) <= FACING_THRESHOLD) return;
        pushProjected(s, 0);
        s.openingIds.forEach(oid => {
          const op = model.byId[oid];
          if (op && GeometryEngine.dotProduct(op.normal, viewerDir) > FACING_THRESHOLD) {
            pushProjected(op, 1);
          }
        });
      });

      if (showShades) {
        model.shades.forEach(sh => pushProjected(sh, 2));
      }

      if (!projectedItems.length) {
        return { empty: 'No exterior facade surfaces face this direction.' };
      }

      // Painter's algorithm sort: farthest from camera rendered first
      projectedItems.sort((a, b) => (a.depth + a.depthBias * 0.02) - (b.depth + b.depthBias * 0.02));

      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      projectedItems.forEach(item => item.pts2D.forEach(([x, z]) => {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }));

      const extent = Math.max(maxX - minX, maxZ - minZ, 10);
      const padding = extent * 0.06;
      const fontSize = extent / 75;
      const mainGroup = Vector2DRenderer.createSvgElement('g', {}, svgRoot);
      const toSvgElevation = pt => [pt[0], -pt[1]];

      function tagElement(elem, obj) {
        elem.setAttribute('data-sel', obj.id);
        elem.setAttribute('data-k', ColorSchemeManager.getKeyForObject(obj, mode));
        return elem;
      }

      // Story elevation reference lines
      model.stories.forEach(story => {
        Vector2DRenderer.createSvgElement('line', {
          x1: minX - padding * 0.5, y1: -story.z, x2: maxX + padding * 0.3, y2: -story.z,
          stroke: '#CBD5E1', 'stroke-width': 0.8, 'stroke-dasharray': '5 4', 'vector-effect': 'non-scaling-stroke'
        }, mainGroup);

        const textElem = Vector2DRenderer.createSvgElement('text', {
          x: minX - padding * 0.55, y: -story.z - fontSize * 0.4,
          'font-size': fontSize * 0.9, 'text-anchor': 'end', fill: '#64748B'
        }, mainGroup);
        textElem.textContent = `${story.name} ${XmlUtils.formatDecimal(story.z, 1)}′`;
      });

      projectedItems.forEach(item => {
        const obj = item.obj;
        if (obj.kind === 'shade') {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(item.pts2D.map(toSvgElevation)),
            fill: SHADING_SURFACE_FILL, stroke: SHADING_STROKE_COLOR,
            'stroke-width': 0.9, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), obj);
        } else if (obj.kind === 'opening') {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(item.pts2D.map(toSvgElevation)),
            fill: ColorSchemeManager.getColorForObject(obj, mode, maps),
            stroke: obj.type === 'Dr' ? '#4E342E' : '#1E40AF',
            'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), obj);
        } else {
          tagElement(Vector2DRenderer.createSvgElement('polygon', {
            points: Vector2DRenderer.formatSvgPoints(item.pts2D.map(toSvgElevation)),
            fill: ColorSchemeManager.getColorForObject(obj, mode, maps),
            'fill-opacity': obj.type === 'UndgrWall' ? 0.5 : 1,
            stroke: '#334155', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke'
          }, mainGroup), obj);
        }
      });

      // Ground reference line
      const groundZ = Math.min(0, minZ);
      Vector2DRenderer.createSvgElement('line', {
        x1: minX - padding * 0.5, y1: -groundZ, x2: maxX + padding * 0.5, y2: -groundZ,
        stroke: '#0F172A', 'stroke-width': 2.2, 'vector-effect': 'non-scaling-stroke'
      }, mainGroup);

      Vector2DRenderer.drawScaleBar(mainGroup, minX, -groundZ + padding * 0.8, extent, fontSize);

      const trueFacadeAzimuth = ((modelAzimuth + model.project.bldgAz) % 360 + 360) % 360;
      const cardinalLabel = GeometryEngine.getCardinalDirection(trueFacadeAzimuth);
      const labelOffset = Math.max(...model.stories.map(s => `${s.name} ${XmlUtils.formatDecimal(s.z, 1)}′`.length)) * fontSize * 0.9 * 0.62 + padding * 0.6;

      return {
        viewBox: [minX - labelOffset, -maxZ - padding, (maxX - minX) + labelOffset + padding * 0.8, (maxZ - groundZ) + padding * 2.4],
        caption: `${cardinalLabel} Elevation · Facade faces ${XmlUtils.formatDecimal(trueFacadeAzimuth, 0)}° true (model ${modelAzimuth}° + BldgAz ${XmlUtils.formatDecimal(model.project.bldgAz, 0)}°) · ${XmlUtils.formatDecimal(maxX - minX, 0)} ft wide`
      };
    }
  }

  /* =============================================================================
     6. Three.js 3D WebGL Manager
     ============================================================================= */

  class ThreeDViewer {
    constructor(containerElement, onSelectCallback) {
      this.container = containerElement;
      this.onSelect = onSelectCallback;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.controls = null;
      this.modelGroup = null;
      this.gridHelper = null;
      this.animationId = null;
      this.isWireframe = false;
      this.boundingSphere = null;
      this.init();
    }

    init() {
      if (typeof THREE === 'undefined') return;

      const width = this.container.clientWidth || 800;
      const height = this.container.clientHeight || 500;

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.container.innerHTML = '';
      this.container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xF8FAFC);

      // Z-Up architectural convention
      this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50000);
      this.camera.up.set(0, 0, 1);

      if (typeof THREE.OrbitControls !== 'undefined') {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.screenSpacePanning = true;
      }

      this.scene.add(new THREE.AmbientLight(0xFFFFFF, 0.7));

      const sun1 = new THREE.DirectionalLight(0xFFFFFF, 0.65);
      sun1.position.set(200, -300, 400);
      this.scene.add(sun1);

      const sun2 = new THREE.DirectionalLight(0xFFFFFF, 0.35);
      sun2.position.set(-200, 300, 200);
      this.scene.add(sun2);

      this.modelGroup = new THREE.Group();
      this.scene.add(this.modelGroup);

      // Setup click raycasting
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      let dragStart = { x: 0, y: 0 };
      let hasDragged = false;

      this.renderer.domElement.addEventListener('mousedown', e => {
        dragStart = { x: e.clientX, y: e.clientY };
        hasDragged = false;
      });

      this.renderer.domElement.addEventListener('mousemove', e => {
        if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 4) {
          hasDragged = true;
        }
      });

      this.renderer.domElement.addEventListener('click', e => {
        if (hasDragged || !this.camera || !this.modelGroup) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.camera);
        const meshes = [];
        this.modelGroup.traverse(child => {
          if (child.isMesh && child.visible) meshes.push(child);
        });

        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0 && hits[0].object.userData) {
          this.onSelect(hits[0].object.userData.id);
        } else {
          this.onSelect(null);
        }
      });

      window.addEventListener('resize', () => this.handleResize());

      const renderLoop = () => {
        this.animationId = requestAnimationFrame(renderLoop);
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
          this.renderer.render(this.scene, this.camera);
        }
      };
      renderLoop();
    }

    handleResize() {
      if (!this.container || !this.renderer || !this.camera) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    }

    buildMeshForPolygon(obj, mode, colorMaps, isOpening = false) {
      const plane = GeometryEngine.fitPlane(obj.pts);
      if (!plane) return null;

      const local2D = obj.pts.map(pt => {
        const delta = [pt[0] - plane.origin[0], pt[1] - plane.origin[1], pt[2] - plane.origin[2]];
        return new THREE.Vector2(
          delta[0] * plane.u[0] + delta[1] * plane.u[1] + delta[2] * plane.u[2],
          delta[0] * plane.v[0] + delta[1] * plane.v[1] + delta[2] * plane.v[2]
        );
      });

      const shape = new THREE.Shape(local2D);
      const geometry = new THREE.ShapeGeometry(shape);
      const hexColor = ColorSchemeManager.getHexColorNumber(obj, mode, colorMaps);

      const isGlass = obj.type === 'Win' || obj.type === 'Skylt';
      const isShade = obj.kind === 'shade';

      const material = new THREE.MeshStandardMaterial({
        color: hexColor,
        side: THREE.DoubleSide,
        transparent: isGlass || isShade,
        opacity: isGlass ? 0.72 : (isShade ? 0.55 : 1.0),
        roughness: isGlass ? 0.2 : 0.65,
        metalness: isGlass ? 0.25 : 0.08,
        emissive: isGlass ? hexColor : 0x000000,
        emissiveIntensity: isGlass ? 0.25 : 0.0,
        depthWrite: !(isGlass || isShade),
        wireframe: this.isWireframe
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = {
        id: obj.id,
        obj,
        kind: obj.kind,
        type: obj.type,
        isOpening: isOpening || isGlass,
        isShade,
        baseColor: hexColor,
        baseOpacity: material.opacity,
        baseTransparent: material.transparent,
        baseDepthWrite: material.depthWrite
      };

      const basisMatrix = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...plane.u),
        new THREE.Vector3(...plane.v),
        new THREE.Vector3(...plane.normal)
      );
      mesh.setRotationFromMatrix(basisMatrix);

      const normalOffset = isOpening ? 0.08 : 0;
      mesh.position.set(
        plane.origin[0] + plane.normal[0] * normalOffset,
        plane.origin[1] + plane.normal[1] * normalOffset,
        plane.origin[2] + plane.normal[2] * normalOffset
      );

      if (!isGlass) {
        const edgesGeom = new THREE.EdgesGeometry(geometry, 25);
        const edgeLine = new THREE.LineSegments(
          edgesGeom,
          new THREE.LineBasicMaterial({ color: 0x334155, opacity: isShade ? 0.5 : 0.3, transparent: true })
        );
        mesh.add(edgeLine);
      }

      return mesh;
    }

    loadModel(model, mode, colorMaps, showShades = true) {
      if (!this.scene) return;

      while (this.modelGroup.children.length > 0) {
        const child = this.modelGroup.children[0];
        this.modelGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      }

      if (this.gridHelper) {
        this.scene.remove(this.gridHelper);
        this.gridHelper = null;
      }

      model.surfaces.forEach(surface => {
        const mesh = this.buildMeshForPolygon(surface, mode, colorMaps, false);
        if (mesh) this.modelGroup.add(mesh);

        surface.openingIds.forEach(oid => {
          const op = model.byId[oid];
          if (op) {
            const opMesh = this.buildMeshForPolygon(op, mode, colorMaps, true);
            if (opMesh) this.modelGroup.add(opMesh);
          }
        });
      });

      if (showShades) {
        model.shades.forEach(shade => {
          const shMesh = this.buildMeshForPolygon(shade, mode, colorMaps, false);
          if (shMesh) this.modelGroup.add(shMesh);
        });
      }

      const box = new THREE.Box3().setFromObject(this.modelGroup);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 20);
        this.boundingSphere = { center, maxDim };

        const gridDim = Math.ceil(maxDim * 2.2 / 50) * 50;
        this.gridHelper = new THREE.GridHelper(gridDim, 20, 0x94A3B8, 0xE2E8F0);
        this.gridHelper.rotation.x = Math.PI / 2;
        this.gridHelper.position.set(center.x, center.y, box.min.z);
        this.scene.add(this.gridHelper);

        this.setCameraPreset('iso');
      }
    }

    setCameraPreset(preset) {
      if (!this.camera || !this.controls || !this.boundingSphere) return;
      const { center, maxDim } = this.boundingSphere;
      this.controls.target.copy(center);

      if (preset === 'top') {
        this.camera.position.set(center.x, center.y - 0.001, center.z + maxDim * 2.2);
      } else if (preset === 'south') {
        this.camera.position.set(center.x, center.y - maxDim * 2.2, center.z + maxDim * 0.3);
      } else if (preset === 'east') {
        this.camera.position.set(center.x + maxDim * 2.2, center.y, center.z + maxDim * 0.3);
      } else if (preset === 'north') {
        this.camera.position.set(center.x, center.y + maxDim * 2.2, center.z + maxDim * 0.3);
      } else {
        // Isometric framing
        this.camera.position.set(center.x + maxDim * 1.3, center.y - maxDim * 1.5, center.z + maxDim * 1.1);
      }
      this.camera.lookAt(center);
      this.controls.update();
    }

    toggleWireframe() {
      this.isWireframe = !this.isWireframe;
      if (this.modelGroup) {
        this.modelGroup.traverse(child => {
          if (child.isMesh && child.material) {
            child.material.wireframe = this.isWireframe;
          }
        });
      }
      return this.isWireframe;
    }

    updateColors(mode, colorMaps) {
      if (!this.modelGroup) return;
      this.modelGroup.traverse(child => {
        if (child.isMesh && child.userData && child.userData.obj) {
          const hex = ColorSchemeManager.getHexColorNumber(child.userData.obj, mode, colorMaps);
          child.userData.baseColor = hex;
          child.material.color.setHex(hex);
          if (child.userData.isOpening) {
            child.material.emissive.setHex(hex);
          }
        }
      });
    }

    applyIsolation(isolateKey, mode) {
      if (!this.modelGroup) return;
      this.modelGroup.traverse(child => {
        if (child.isMesh && child.userData && child.userData.obj) {
          const key = ColorSchemeManager.getKeyForObject(child.userData.obj, mode);
          const isMatch = !isolateKey || key === isolateKey;
          if (isMatch) {
            child.material.opacity = child.userData.baseOpacity;
            child.material.transparent = child.userData.baseTransparent;
            child.material.depthWrite = child.userData.baseDepthWrite;
          } else {
            child.material.opacity = 0.08;
            child.material.transparent = true;
            child.material.depthWrite = false;
          }
        }
      });
    }

    applySelection(selectedId) {
      if (!this.modelGroup) return;
      this.modelGroup.traverse(child => {
        if (child.isMesh && child.userData) {
          const isSelected = selectedId && (child.userData.id === selectedId || (child.userData.obj && child.userData.obj.spaceId === selectedId));
          if (isSelected) {
            child.material.emissive.setHex(0xD6336C);
            child.material.emissiveIntensity = 0.45;
            child.material.opacity = 1.0;
          } else {
            const hex = child.userData.baseColor;
            child.material.emissive.setHex(child.userData.isOpening ? hex : 0x000000);
            child.material.emissiveIntensity = child.userData.isOpening ? 0.25 : 0.0;
          }
        }
      });
    }
  }

  /* =============================================================================
     7. Main Application Controller
     ============================================================================= */

  class CbeccXmlApp {
    constructor() {
      this.state = {
        model: null,
        maps: null,
        view: 'plan',          // 'plan' | 'elev' | '3d'
        story: null,           // story name or '__roof'
        elevAz: null,          // azimuth: 0, 90, 180, 270
        mode: 'construction',  // 'construction' | 'type' | 'zone' | 'space'
        isolate: null,
        showShades: true,
        showLabels: true,
        selectedId: null,
        viewBoxes: {},
        baseViewBox: null
      };

      this.svgElement = document.getElementById('view-svg');
      this.threeContainer = document.getElementById('three-container');
      this.threeViewer = null;

      this.initEvents();
    }

    initEvents() {
      // 2D SVG Pan & Zoom
      let dragInfo = null;

      this.svgElement.addEventListener('wheel', e => {
        if (!this.state.model || this.state.view === '3d') return;
        e.preventDefault();
        const currentVb = (this.svgElement.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
        const rect = this.svgElement.getBoundingClientRect();
        const scale = Math.min(rect.width / currentVb[2], rect.height / currentVb[3]) || 1;
        const offsetX = (rect.width - currentVb[2] * scale) / 2;
        const offsetY = (rect.height - currentVb[3] * scale) / 2;
        const userX = currentVb[0] + (e.clientX - rect.left - offsetX) / scale;
        const userY = currentVb[1] + (e.clientY - rect.top - offsetY) / scale;

        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const nextVb = [userX - (userX - currentVb[0]) * factor, userY - (userY - currentVb[1]) * factor, currentVb[2] * factor, currentVb[3] * factor];
        this.setSvgViewBox(nextVb);
      }, { passive: false });

      this.svgElement.addEventListener('mousedown', e => {
        if (e.button !== 0 || this.state.view === '3d') return;
        const currentVb = (this.svgElement.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
        const rect = this.svgElement.getBoundingClientRect();
        const scale = Math.min(rect.width / currentVb[2], rect.height / currentVb[3]) || 1;
        dragInfo = { startX: e.clientX, startY: e.clientY, baseVb: currentVb, scale, moved: false };
      });

      window.addEventListener('mousemove', e => {
        if (!dragInfo || this.state.view === '3d') return;
        const deltaX = e.clientX - dragInfo.startX;
        const deltaY = e.clientY - dragInfo.startY;
        if (!dragInfo.moved && Math.hypot(deltaX, deltaY) < 4) return;
        dragInfo.moved = true;
        this.svgElement.classList.add('panning');
        const nextVb = [
          dragInfo.baseVb[0] - deltaX / dragInfo.scale,
          dragInfo.baseVb[1] - deltaY / dragInfo.scale,
          dragInfo.baseVb[2],
          dragInfo.baseVb[3]
        ];
        this.setSvgViewBox(nextVb);
      });

      window.addEventListener('mouseup', () => {
        if (dragInfo && dragInfo.moved) {
          this.svgElement.dataset.justPanned = '1';
        }
        dragInfo = null;
        this.svgElement.classList.remove('panning');
      });

      this.svgElement.addEventListener('click', e => {
        if (this.state.view === '3d') return;
        if (this.svgElement.dataset.justPanned) {
          delete this.svgElement.dataset.justPanned;
          return;
        }
        const target = e.target.closest('[data-sel]');
        if (target) {
          this.showElementInfo(target.getAttribute('data-sel'));
        }
      });

      // View Buttons
      document.getElementById('view-btn-plan').addEventListener('click', () => {
        this.state.view = 'plan';
        this.renderSubtabs();
        this.render();
      });

      document.getElementById('view-btn-elev').addEventListener('click', () => {
        this.state.view = 'elev';
        this.renderSubtabs();
        this.render();
      });

      document.getElementById('view-btn-3d').addEventListener('click', () => {
        this.state.view = '3d';
        this.renderSubtabs();
        this.render();
      });

      // Color Mode Buttons
      document.querySelectorAll('#color-modes [data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.mode = btn.dataset.mode;
          this.state.isolate = null;
          this.renderSubtabs();
          this.renderLegend();
          this.render();
        });
      });

      // Toggles
      document.getElementById('shade-toggle').addEventListener('change', e => {
        this.state.showShades = e.target.checked;
        if (this.state.view === '3d' && this.state.model && this.threeViewer) {
          this.threeViewer.loadModel(this.state.model, this.state.mode, this.state.maps, this.state.showShades);
        }
        this.render();
      });

      document.getElementById('label-toggle').addEventListener('change', e => {
        this.state.showLabels = e.target.checked;
        this.render();
      });

      // Fit / Zoom Buttons
      document.getElementById('fit-btn').addEventListener('click', () => {
        if (this.state.view === '3d' && this.threeViewer) {
          this.threeViewer.setCameraPreset('iso');
          return;
        }
        const key = this.getViewKey();
        delete this.state.viewBoxes[key];
        if (this.state.baseViewBox) {
          this.setSvgViewBox(this.state.baseViewBox);
        }
      });

      document.getElementById('zoom-in-btn').addEventListener('click', () => {
        if (this.state.view === '3d' && this.threeViewer && this.threeViewer.camera && this.threeViewer.controls) {
          this.threeViewer.camera.position.lerp(this.threeViewer.controls.target, 0.2);
          this.threeViewer.controls.update();
          return;
        }
        const currentVb = (this.svgElement.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
        const cx = currentVb[0] + currentVb[2] / 2;
        const cy = currentVb[1] + currentVb[3] / 2;
        const f = 0.8;
        this.setSvgViewBox([cx - (currentVb[2] * f) / 2, cy - (currentVb[3] * f) / 2, currentVb[2] * f, currentVb[3] * f]);
      });

      document.getElementById('zoom-out-btn').addEventListener('click', () => {
        if (this.state.view === '3d' && this.threeViewer && this.threeViewer.camera && this.threeViewer.controls) {
          const dir = new THREE.Vector3().subVectors(this.threeViewer.camera.position, this.threeViewer.controls.target).multiplyScalar(1.25);
          this.threeViewer.camera.position.addVectors(this.threeViewer.controls.target, dir);
          this.threeViewer.controls.update();
          return;
        }
        const currentVb = (this.svgElement.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
        const cx = currentVb[0] + currentVb[2] / 2;
        const cy = currentVb[1] + currentVb[3] / 2;
        const f = 1.25;
        this.setSvgViewBox([cx - (currentVb[2] * f) / 2, cy - (currentVb[3] * f) / 2, currentVb[2] * f, currentVb[3] * f]);
      });

      document.getElementById('clear-sel').addEventListener('click', () => {
        this.state.selectedId = null;
        this.state.isolate = null;
        this.applySelection();
        this.applyIsolation();
        this.showElementInfo(null);
      });

      // Data Tables Navigation
      document.querySelectorAll('.table-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.table-tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.table-tab-pane').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          const targetPane = document.getElementById(btn.dataset.target);
          if (targetPane) targetPane.classList.add('active');
        });
      });

      // Export Button (SVG or PNG)
      document.getElementById('export-svg-btn').addEventListener('click', () => {
        if (!this.state.model) return;
        const nameSlug = (this.state.model.project.name || 'model').replace(/\s+/g, '_');

        if (this.state.view === '3d' && this.threeViewer && this.threeViewer.renderer) {
          this.threeViewer.renderer.render(this.threeViewer.scene, this.threeViewer.camera);
          const dataUrl = this.threeViewer.renderer.domElement.toDataURL('image/png');
          const downloadAnchor = document.createElement('a');
          downloadAnchor.href = dataUrl;
          downloadAnchor.download = `${nameSlug}_3D_View.png`;
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          document.body.removeChild(downloadAnchor);
          return;
        }

        const clone = this.svgElement.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const serialized = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const viewSlug = this.state.view === 'plan' ? `plan_${this.state.story}` : `elevation_${this.state.elevAz}`;
        a.href = url;
        a.download = `${nameSlug}_${viewSlug}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });

      // Selection panel links navigation
      document.getElementById('info-body').addEventListener('click', e => {
        const gotoLink = e.target.closest('[data-goto]');
        if (gotoLink) {
          e.preventDefault();
          this.revealElement(gotoLink.dataset.goto);
          return;
        }
        const consLink = e.target.closest('[data-cons]');
        if (consLink) {
          e.preventDefault();
          const consName = consLink.dataset.cons;
          if (this.state.mode !== 'construction') {
            this.state.mode = 'construction';
            this.renderSubtabs();
            this.renderLegend();
          }
          this.state.isolate = this.state.isolate === consName ? null : consName;
          this.applyIsolation();
          this.showConstructionInfo(consName);
        }
      });

      // File Ingestion Wireup
      const dropzone = document.getElementById('dropzone');
      const fileInput = document.getElementById('file-input');

      dropzone.addEventListener('click', e => {
        if (e.target.closest('#load-example-btn')) return;
        fileInput.click();
      });

      document.getElementById('browse-btn').addEventListener('click', e => {
        e.stopPropagation();
        fileInput.click();
      });
      document.getElementById('hdr-browse-btn').addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) this.loadFile(fileInput.files[0]);
        fileInput.value = '';
      });

      const dropzoneSection = document.getElementById('dropzone-section');
      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzoneSection.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => dropzoneSection.classList.remove('drag-over'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzoneSection.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
      });

      document.getElementById('reload-btn').addEventListener('click', () => {
        document.getElementById('report').style.display = 'none';
        dropzoneSection.style.display = 'block';
      });

      // Example Model Loaders
      document.getElementById('load-example-btn').addEventListener('click', e => {
        e.stopPropagation();
        this.loadShoeboxExample();
      });
      document.getElementById('hdr-example-btn').addEventListener('click', () => this.loadShoeboxExample());
    }

    getViewKey() {
      return this.state.view === 'plan' ? `plan:${this.state.story}` : (this.state.view === 'elev' ? `elev:${this.state.elevAz}` : '3d');
    }

    setSvgViewBox(vb) {
      this.svgElement.setAttribute('viewBox', vb.map(v => v.toFixed(2)).join(' '));
      this.state.viewBoxes[this.getViewKey()] = vb;
    }

    loadFile(file) {
      const reader = new FileReader();
      reader.onload = () => this.processXmlString(reader.result);
      reader.onerror = () => this.showError('Could not read the uploaded XML file.');
      reader.readAsText(file);
    }

    loadShoeboxExample() {
      const examplePath = 'Shoebox%20MDL%20-%20post%20open.xml';
      fetch(examplePath)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then(text => this.processXmlString(text))
        .catch(() => {
          fetch('Shoebox MDL - post open.xml')
            .then(res => res.text())
            .then(text => this.processXmlString(text))
            .catch(() => {
              this.showError('Could not load "Shoebox MDL - post open.xml" automatically. Please click "Browse Local File" to load it.');
            });
        });
    }

    showError(message) {
      const errorBox = document.getElementById('parse-error');
      document.getElementById('parse-error-msg').textContent = message;
      errorBox.style.display = 'flex';
      document.getElementById('report').style.display = 'none';
      document.getElementById('dropzone-section').style.display = 'block';
    }

    processXmlString(xmlContent) {
      let model;
      try {
        model = CbeccXmlParser.parse(xmlContent);
      } catch (err) {
        this.showError(err.message);
        return null;
      }

      document.getElementById('parse-error').style.display = 'none';
      const maps = ColorSchemeManager.buildMaps(model);

      Object.assign(this.state, {
        model,
        maps,
        view: 'plan',
        story: model.stories[0] ? model.stories[0].name : '__roof',
        elevAz: 180, // Default South elevation
        mode: 'construction',
        isolate: null,
        selectedId: null,
        viewBoxes: {}
      });

      document.getElementById('dropzone-section').style.display = 'none';
      document.getElementById('report').style.display = 'block';

      this.renderSummary();
      this.renderSubtabs();
      this.renderLegend();
      this.renderScheduleTable();
      this.renderSpacesTable();
      this.render();
      this.showElementInfo(null);

      // Pre-initialize 3D viewer in background
      if (typeof THREE !== 'undefined') {
        if (!this.threeViewer) {
          this.threeViewer = new ThreeDViewer(this.threeContainer, id => this.showElementInfo(id));
        }
        this.threeViewer.loadModel(model, this.state.mode, maps, this.state.showShades);
      }

      return model;
    }

    render() {
      if (this.state.view === '3d') {
        this.svgElement.style.display = 'none';
        this.threeContainer.style.display = 'block';

        if (!this.threeViewer) {
          this.threeViewer = new ThreeDViewer(this.threeContainer, id => this.showElementInfo(id));
          this.threeViewer.loadModel(this.state.model, this.state.mode, this.state.maps, this.state.showShades);
        } else {
          this.threeViewer.updateColors(this.state.mode, this.state.maps);
          this.threeViewer.applyIsolation(this.state.isolate, this.state.mode);
          this.threeViewer.applySelection(this.state.selectedId);
          this.threeViewer.handleResize();
        }

        const m = this.state.model;
        if (m) {
          document.getElementById('caption-left').textContent =
            `3D Perspective View · ${m.stories.length} stories, ${m.spaces.length} spaces, ${m.surfaces.length} envelope surfaces, ${m.openings.length} fenestrations`;
        }
      } else {
        this.svgElement.style.display = 'block';
        this.threeContainer.style.display = 'none';

        while (this.svgElement.firstChild) {
          this.svgElement.removeChild(this.svgElement.firstChild);
        }

        const options = {
          mode: this.state.mode,
          maps: this.state.maps,
          showShades: this.state.showShades,
          showLabels: this.state.showLabels
        };

        const result = this.state.view === 'plan'
          ? Vector2DRenderer.renderPlanView(this.state.model, this.state.story, options, this.svgElement)
          : Vector2DRenderer.renderElevationView(this.state.model, this.state.elevAz, options, this.svgElement);

        if (result.empty) {
          const t = Vector2DRenderer.createSvgElement('text', {
            x: 50, y: 50, 'font-size': 4, 'text-anchor': 'middle', fill: '#64748B'
          }, this.svgElement);
          t.textContent = result.empty;
          this.svgElement.setAttribute('viewBox', '0 0 100 100');
          this.state.baseViewBox = [0, 0, 100, 100];
          document.getElementById('caption-left').textContent = '';
        } else {
          this.state.baseViewBox = result.viewBox;
          const currentVb = this.state.viewBoxes[this.getViewKey()] || result.viewBox;
          this.svgElement.setAttribute('viewBox', currentVb.map(v => v.toFixed(2)).join(' '));
          document.getElementById('caption-left').textContent = result.caption;
        }
      }

      this.applyIsolation();
      this.applySelection();
    }

    renderSubtabs() {
      const box = document.getElementById('subtabs');
      const labelEl = document.getElementById('subtab-label');
      box.innerHTML = '';
      const m = this.state.model;
      if (!m) return;

      const addBtn = (label, active, clickHandler) => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (active ? ' active' : '');
        btn.textContent = label;
        btn.addEventListener('click', clickHandler);
        box.appendChild(btn);
      };

      if (this.state.view === 'plan') {
        labelEl.textContent = 'STORY';
        m.stories.forEach(st => addBtn(st.name, this.state.story === st.name, () => {
          this.state.story = st.name;
          this.renderSubtabs();
          this.render();
        }));
        addBtn('Roof', this.state.story === '__roof', () => {
          this.state.story = '__roof';
          this.renderSubtabs();
          this.render();
        });
      } else if (this.state.view === 'elev') {
        labelEl.textContent = 'FACADE';
        [0, 90, 180, 270].forEach(deg => {
          const trueFacade = ((deg + m.project.bldgAz) % 360 + 360) % 360;
          const card = GeometryEngine.getCardinalDirection(trueFacade);
          addBtn(`${card} · ${Math.round(trueFacade)}°`, this.state.elevAz === deg, () => {
            this.state.elevAz = deg;
            this.renderSubtabs();
            this.render();
          });
        });
      } else if (this.state.view === '3d') {
        labelEl.textContent = 'CAMERA';
        addBtn('Isometric', false, () => this.threeViewer && this.threeViewer.setCameraPreset('iso'));
        addBtn('Top View', false, () => this.threeViewer && this.threeViewer.setCameraPreset('top'));
        addBtn('South (Front)', false, () => this.threeViewer && this.threeViewer.setCameraPreset('south'));
        addBtn('East (Side)', false, () => this.threeViewer && this.threeViewer.setCameraPreset('east'));
        const isWire = this.threeViewer ? this.threeViewer.isWireframe : false;
        addBtn(isWire ? 'Shaded View' : 'Wireframe', isWire, () => {
          if (this.threeViewer) {
            this.threeViewer.toggleWireframe();
            this.renderSubtabs();
          }
        });
      }

      document.querySelectorAll('[data-view]').forEach(b => {
        b.classList.toggle('active', b.dataset.view === this.state.view);
      });
      document.querySelectorAll('[data-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === this.state.mode);
      });
    }

    renderLegend() {
      const box = document.getElementById('legend');
      const titles = { construction: 'Constructions', type: 'Surface Types', zone: 'Thermal Zones', space: 'Spaces' };
      document.getElementById('legend-title').textContent = titles[this.state.mode] || 'Legend';
      box.innerHTML = '';

      const entries = ColorSchemeManager.buildLegendEntries(this.state.model, this.state.mode, this.state.maps);
      entries.forEach(e => {
        if (e.header) {
          const h = document.createElement('div');
          h.className = 'toolbar-label';
          h.style.cssText = 'padding:6px 4px 2px;font-size:10px;color:var(--ob-slate-muted);';
          h.textContent = e.header;
          box.appendChild(h);
          return;
        }

        const row = document.createElement('div');
        row.className = 'legend-item';
        row.dataset.key = e.key;
        row.title = e.drawn ? '' : 'Interior / below-grade horizontal surfaces are not drawn in 2D projection';
        row.innerHTML = `<span class="legend-sw" style="background:${e.color}"></span><span class="legend-label">${XmlUtils.escapeString(e.label)}${e.drawn ? '' : ' <span style="font-size:10px;color:#94a3b8;">(not drawn)</span>'}</span><span class="legend-meta">${XmlUtils.formatArea(e.area)}${e.areaLabel ? ' ' + e.areaLabel : ''}</span>`;

        row.addEventListener('click', () => {
          this.state.isolate = this.state.isolate === e.key ? null : e.key;
          if (this.state.isolate && this.state.mode === 'construction' && this.state.model.constructions[e.key]) {
            this.showConstructionInfo(e.key);
          }
          this.applyIsolation();
        });
        box.appendChild(row);
      });
    }

    applyIsolation() {
      if (this.state.view === '3d' && this.threeViewer) {
        this.threeViewer.applyIsolation(this.state.isolate, this.state.mode);
      } else {
        this.svgElement.querySelectorAll('[data-sel]').forEach(elem => {
          const k = elem.getAttribute('data-k');
          elem.classList.toggle('dim', Boolean(this.state.isolate && k !== this.state.isolate));
        });
      }

      document.querySelectorAll('#legend .legend-item').forEach(li => {
        li.classList.toggle('active', li.dataset.key === this.state.isolate);
        li.classList.toggle('faded', Boolean(this.state.isolate && li.dataset.key !== this.state.isolate));
      });

      document.querySelectorAll('#cons-table tbody tr').forEach(tr => {
        tr.classList.toggle('active', this.state.mode === 'construction' && tr.dataset.key === this.state.isolate);
      });
    }

    applySelection() {
      if (this.state.view === '3d' && this.threeViewer) {
        this.threeViewer.applySelection(this.state.selectedId);
      } else {
        this.svgElement.querySelectorAll('.sel').forEach(e => e.classList.remove('sel'));
        if (!this.state.selectedId) return;
        this.svgElement.querySelectorAll(`[data-sel="${this.state.selectedId}"]`).forEach(elem => {
          elem.classList.add('sel');
          elem.parentNode.appendChild(elem);
        });
      }
    }

    showElementInfo(id) {
      this.state.selectedId = id;
      this.applySelection();

      const box = document.getElementById('info-body');
      const m = this.state.model;
      const o = m ? m.byId[id] : null;

      if (!o) {
        box.innerHTML = `
          <div class="panel-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path>
              <path d="M12 6v6l4 2"></path>
            </svg>
            <p>Click any surface, window, shade, or space in the drawing to view properties.</p>
          </div>`;
        return;
      }

      const rows = [];
      const titleName = XmlUtils.escapeString(o.name);
      const typeBadge = XmlUtils.escapeString(SURFACE_DISPLAY_NAMES[o.type] || o.type);

      if (o.kind === 'surface') {
        const ops = o.openingIds.map(oid => m.byId[oid]);
        const fenArea = ops.filter(x => x.type !== 'Dr').reduce((acc, x) => acc + x.area, 0);
        const doorArea = ops.filter(x => x.type === 'Dr').reduce((acc, x) => acc + x.area, 0);

        rows.push(['Construction', this.renderConstructionLink(o.construction)]);
        rows.push(['Gross Area', XmlUtils.formatArea(o.grossArea), true]);
        rows.push(['Net Area', XmlUtils.formatArea(o.netArea), true]);
        if (ops.length) {
          const pct = o.grossArea ? (fenArea / o.grossArea * 100).toFixed(1) : '0';
          rows.push(['Fenestration', `${XmlUtils.formatArea(fenArea)} (${pct}%)`, true]);
        }
        if (doorArea) rows.push(['Doors', XmlUtils.formatArea(doorArea), true]);
        rows.push(['Azimuth', o.trueAz == null ? 'Horizontal' : `${Math.round(o.trueAz)}° true (${GeometryEngine.getCardinalDirection(o.trueAz)})`]);
        rows.push(['Tilt', `${o.tilt}°`, true]);
        rows.push(['Space', `<a href="#" data-goto="${o.spaceId}" style="color:var(--ob-blue);">${XmlUtils.escapeString(o.space)}</a>`]);
        rows.push(['Thermal Zone', XmlUtils.escapeString(o.zone)]);
        rows.push(['Story', XmlUtils.escapeString(o.story)]);
        if (o.adjacentSpace) rows.push(['Adjacent Space', XmlUtils.escapeString(o.adjacentSpace)]);
      } else if (o.kind === 'opening') {
        const host = m.byId[o.hostId];
        rows.push(['Construction', this.renderConstructionLink(o.construction)]);
        rows.push(['Area', XmlUtils.formatArea(o.area), true]);
        rows.push(['Azimuth', o.trueAz == null ? 'Horizontal' : `${Math.round(o.trueAz)}° true (${GeometryEngine.getCardinalDirection(o.trueAz)})`]);
        rows.push(['Tilt', `${o.tilt}°`, true]);
        if (host) rows.push(['Host Surface', `<a href="#" data-goto="${host.id}" style="color:var(--ob-blue);font-weight:600;">${XmlUtils.escapeString(host.name)}</a>`]);
        rows.push(['Space', XmlUtils.escapeString(o.space)]);
        rows.push(['Thermal Zone', XmlUtils.escapeString(o.zone)]);
      } else if (o.kind === 'shade') {
        const isHorizontal = Math.abs(o.normal[2]) > 0.8;
        rows.push(['Type', isHorizontal ? 'Horizontal Overhang' : 'Vertical / Fin']);
        rows.push(['Area', XmlUtils.formatArea(o.area), true]);
        rows.push(['Assigned Story', XmlUtils.escapeString(o.story || '—')]);
        if (o.solRefl != null) rows.push(['Solar Refl.', XmlUtils.formatDecimal(o.solRefl, 2), true]);
        if (o.visRefl != null) rows.push(['Visible Refl.', XmlUtils.formatDecimal(o.visRefl, 2), true]);
      } else if (o.kind === 'space') {
        rows.push(['Space Function', XmlUtils.escapeString(o.func || 'Unspecified')]);
        rows.push(['Floor Area', XmlUtils.formatArea(o.floorArea), true]);
        rows.push(['Thermal Zone', XmlUtils.escapeString(o.zone)]);
        rows.push(['Story', XmlUtils.escapeString(o.story)]);
        rows.push(['Enclosing Surfaces', String(o.surfaceIds.length), true]);
      }

      let contentHtml = `<div class="info-name">${titleName}</div><div class="info-type">${typeBadge}</div>`;
      contentHtml += '<div class="kv">' + rows.map(([k, v, num]) => `<div class="k">${k}</div><div class="v${num ? ' num' : ''}">${v}</div>`).join('') + '</div>';

      if (o.kind === 'surface' && o.openingIds && o.openingIds.length) {
        contentHtml += `<div class="sub-list"><div class="toolbar-label" style="margin-bottom:6px;">Child Openings (${o.openingIds.length})</div>` +
          o.openingIds.map(oid => {
            const op = m.byId[oid];
            return `<div class="row" data-goto="${op.id}"><span>${XmlUtils.escapeString(op.name)}</span><span class="a">${XmlUtils.formatArea(op.area)}</span></div>`;
          }).join('') + '</div>';
      }

      box.innerHTML = contentHtml;
    }

    renderConstructionLink(consName) {
      if (!consName) return '—';
      const c = this.state.model.constructions[consName];
      if (!c) return XmlUtils.escapeString(consName);
      const color = this.state.maps.construction[consName] || '#CCCCCC';
      const swatch = `<span class="legend-sw" style="display:inline-block;vertical-align:-2px;margin-right:5px;background:${color}"></span>`;
      return `${swatch}<a href="#" data-cons="${XmlUtils.escapeString(consName)}" style="color:var(--ob-blue);font-weight:600;text-decoration:none;">${XmlUtils.escapeString(consName)}</a>`;
    }

    showConstructionInfo(name) {
      const c = this.state.model.constructions[name];
      const box = document.getElementById('info-body');
      if (!c) return;

      this.state.selectedId = null;
      this.applySelection();

      const kindTitle = { opaque: 'Opaque Assembly (ConsAssm)', fen: 'Fenestration (FenCons)', door: 'Door Assembly (DrCons)' }[c.kind] || 'Assembly';
      let html = `<div class="info-name"><span class="legend-sw" style="display:inline-block;vertical-align:-2px;margin-right:6px;background:${this.state.maps.construction[name] || '#ccc'}"></span>${XmlUtils.escapeString(c.name)}</div><div class="info-type">${kindTitle}</div>`;

      const rows = [
        ['Applies To', [...c.usedBy].map(t => SURFACE_DISPLAY_NAMES[t] || t).join(', ')],
        ['Surface Count', String(c.count), true],
        ['Total Area', XmlUtils.formatArea(c.area) + (c.kind === 'opaque' ? ' net' : ''), true]
      ];

      if (c.kind === 'opaque') {
        if (c.surfType) rows.push(['Compatible Type', XmlUtils.escapeString(c.surfType)]);
        rows.push(['U-factor', c.uFactor != null ? XmlUtils.formatDecimal(c.uFactor, 3) : '<span style="color:#64748B;font-style:italic;">Calculated by CBECC</span>']);
      } else {
        rows.push(['U-factor', XmlUtils.formatDecimal(c.uFactor, 2), true]);
        if (c.kind === 'fen') {
          rows.push(['SHGC', XmlUtils.formatDecimal(c.shgc, 2), true]);
          rows.push(['VT', XmlUtils.formatDecimal(c.vt, 2), true]);
        }
      }

      html += '<div class="kv">' + rows.map(([k, v, num]) => `<div class="k">${k}</div><div class="v${num ? ' num' : ''}">${v}</div>`).join('') + '</div>';

      if (c.kind === 'opaque' && c.layers && c.layers.length) {
        html += `<div class="sub-list"><div class="toolbar-label" style="margin-bottom:6px;">Material Layers (Exterior → Interior)</div><ol style="margin-left:18px;font-size:12px;display:flex;flex-direction:column;gap:3px;">${c.layers.map(l => `<li>${XmlUtils.escapeString(l)}</li>`).join('')}</ol></div>`;
      }

      box.innerHTML = html;
    }

    revealElement(id) {
      const o = this.state.model.byId[id];
      if (!o) return;

      if (this.state.view === '3d') {
        this.showElementInfo(id);
        this.applySelection();
        return;
      }

      if (o.kind === 'space') {
        this.state.view = 'plan'; this.state.story = o.story;
      } else if (o.type === 'Roof' || o.type === 'Skylt') {
        this.state.view = 'plan'; this.state.story = '__roof';
      } else if (this.state.view === 'elev' && o.exterior && o.modelAz != null) {
        this.state.elevAz = [0, 90, 180, 270].reduce((best, deg) =>
          Math.abs(((o.modelAz - deg + 540) % 360) - 180) < Math.abs(((o.modelAz - best + 540) % 360) - 180) ? deg : best, 0);
      } else if (o.story) {
        this.state.view = 'plan'; this.state.story = o.story;
      }

      this.renderSubtabs();
      this.render();
      this.showElementInfo(id);
    }

    renderSummary() {
      const m = this.state.model, p = m.project;
      document.getElementById('doc-title').textContent = p.name;
      document.getElementById('doc-bldg-badge').textContent = p.bldgName || 'Building 1';

      const meta = [
        ['Project Name', p.name],
        ['Building', p.bldgName],
        ['Building Azimuth', `${Math.round(p.bldgAz)}°`],
        ['Climate Zone', p.climateZone],
        ['Stories', String(m.stories.length)],
        ['Input Geometry', p.geometryInpType]
      ];

      document.getElementById('meta-row').innerHTML = meta.filter(x => x[1]).map(([k, v]) => `
        <div class="meta-tag-item">
          <span class="meta-tag-label">${k}</span>
          <span class="meta-tag-val">${XmlUtils.escapeString(v)}</span>
        </div>`).join('');

      const extWalls = m.surfaces.filter(s => s.type === 'ExtWall');
      const wallGross = extWalls.reduce((sum, s) => sum + s.grossArea, 0);
      const winArea = m.openings.filter(o => o.type === 'Win').reduce((sum, o) => sum + o.area, 0);
      const skyArea = m.openings.filter(o => o.type === 'Skylt').reduce((sum, o) => sum + o.area, 0);
      const roofArea = m.surfaces.filter(s => s.type === 'Roof').reduce((sum, s) => sum + s.grossArea, 0);
      const floorArea = m.spaces.reduce((sum, sp) => sum + sp.floorArea, 0);

      const stats = [
        ['Gross Floor Area', XmlUtils.formatArea(floorArea), 'Conditioned floor area'],
        ['Spaces & Stories', `${m.spaces.length} / ${m.stories.length}`, 'Spaces / story levels'],
        ['Ext. Wall Area (Gross)', XmlUtils.formatArea(wallGross), 'Total vertical facade'],
        ['Window Area', XmlUtils.formatArea(winArea), wallGross ? `${(winArea / wallGross * 100).toFixed(1)}% WWR` : 'Fenestration'],
        ['Roof Area', XmlUtils.formatArea(roofArea), skyArea ? `${XmlUtils.formatArea(skyArea)} skylights` : 'Opaque horizontal roof'],
        ['Shading Objects', String(m.shades.length), 'Exterior fins/overhangs']
      ];

      document.getElementById('stat-row').innerHTML = stats.map(([k, v, sub]) => `
        <div class="kpi-cell">
          <span class="kpi-label">${k}</span>
          <span class="kpi-value">${v}</span>
          <span class="kpi-sub">${sub}</span>
        </div>`).join('');

      const warnBadge = document.getElementById('warnings-count-badge');
      warnBadge.textContent = m.warnings.length;
      const warnList = document.getElementById('warnings-list');
      const warnEmpty = document.getElementById('warnings-empty');
      if (m.warnings.length) {
        warnEmpty.style.display = 'none';
        warnList.style.display = 'flex';
        warnList.innerHTML = m.warnings.map(w => `<li class="warning-item">${XmlUtils.escapeString(w)}</li>`).join('');
      } else {
        warnEmpty.style.display = 'block';
        warnList.style.display = 'none';
      }
    }

    renderScheduleTable() {
      const m = this.state.model, table = document.getElementById('cons-table');
      const kindRank = { opaque: 0, fen: 1, door: 2 };
      const usedConstructions = Object.values(m.constructions)
        .filter(c => c.count > 0)
        .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.area - a.area);

      document.getElementById('cons-count-badge').textContent = usedConstructions.length;

      table.innerHTML = `
        <thead>
          <tr>
            <th style="width:24px;"></th>
            <th>Construction Assembly</th>
            <th>Category</th>
            <th>Applied To</th>
            <th>Layers / Specs</th>
            <th class="r">Count</th>
            <th class="r">Total Area</th>
          </tr>
        </thead>
        <tbody>` +
        usedConstructions.map(c => {
          const perf = c.kind === 'opaque'
            ? (c.layers.length ? `<ol style="margin-left:14px;font-size:11.5px;">${c.layers.map(l => `<li>${XmlUtils.escapeString(l)}</li>`).join('')}</ol>` : '<span style="color:#94a3b8;font-style:italic;">No layers listed</span>')
            : `U-${XmlUtils.formatDecimal(c.uFactor, 2)}${c.kind === 'fen' ? ` · SHGC ${XmlUtils.formatDecimal(c.shgc, 2)} · VT ${XmlUtils.formatDecimal(c.vt, 2)}` : ''}`;
          const kindTitle = { opaque: 'Opaque Assembly', fen: 'Fenestration', door: 'Door' }[c.kind] || 'Assembly';
          return `
            <tr data-key="${XmlUtils.escapeString(c.name)}">
              <td><span class="legend-sw" style="display:inline-block;background:${this.state.maps.construction[c.name]}"></span></td>
              <td><strong style="color:var(--ob-dark);">${XmlUtils.escapeString(c.name)}</strong></td>
              <td>${kindTitle}</td>
              <td>${[...c.usedBy].map(x => SURFACE_DISPLAY_NAMES[x] || x).join(', ')}</td>
              <td>${perf}</td>
              <td class="r">${c.count}</td>
              <td class="r">${XmlUtils.formatArea(c.area)}</td>
            </tr>`;
        }).join('') + '</tbody>';

      table.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const key = tr.dataset.key;
          if (this.state.mode !== 'construction') {
            this.state.mode = 'construction';
            this.renderSubtabs();
            this.renderLegend();
          }
          this.state.isolate = this.state.isolate === key ? null : key;
          if (this.state.isolate) this.showConstructionInfo(key);
          this.applyIsolation();
          document.getElementById('canvas-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      document.getElementById('cons-note').textContent =
        `Showing ${usedConstructions.length} active construction assemblies assigned to model polygons. Opaque surface areas are net of openings.`;
    }

    renderSpacesTable() {
      const m = this.state.model, table = document.getElementById('spaces-table');
      document.getElementById('spaces-count-badge').textContent = m.spaces.length;

      table.innerHTML = `
        <thead>
          <tr>
            <th>Space Name</th>
            <th>Story</th>
            <th>Thermal Zone</th>
            <th>Space Function</th>
            <th class="r">Enclosing Surfaces</th>
            <th class="r">Conditioned Floor Area</th>
          </tr>
        </thead>
        <tbody>` +
        m.spaces.map(s => `
          <tr data-space-id="${s.id}">
            <td><strong style="color:var(--ob-dark);">${XmlUtils.escapeString(s.name)}</strong></td>
            <td>${XmlUtils.escapeString(s.story)}</td>
            <td>${XmlUtils.escapeString(s.zone)}</td>
            <td>${XmlUtils.escapeString(s.func || 'Unspecified')}</td>
            <td class="r">${s.surfaceIds.length}</td>
            <td class="r">${XmlUtils.formatArea(s.floorArea)}</td>
          </tr>`).join('') + '</tbody>';

      table.querySelectorAll('tbody tr').forEach(tr => {
        tr.addEventListener('click', () => {
          const spcId = tr.dataset.spaceId;
          this.revealElement(spcId);
          document.getElementById('canvas-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }
  }

  // Initialize application on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    window.__cbecc_app__ = new CbeccXmlApp();
  });

})();
