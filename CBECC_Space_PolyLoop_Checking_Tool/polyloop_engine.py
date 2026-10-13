"""
polyloop_engine.py
==================
Core geometry engine and CBECC parser for fixing missing Space PolyLoops.
Part of the O'Brien360 Tools Suite.

Capabilities:
- Robust CBECC input file parser (.cibd, .cibd10, .cibd16, .cibd19, .cibd22, .cibd25i)
- Detects spaces (Spc) and identifies those missing or with invalid (<3 coords) PolyLp
- Detects spaces whose existing PolyLp area differs >5% from the union of child floor areas
- Extracts child floor surfaces (IntFlr, ExtFlr, UndgrFlr) and their PolyLp coordinates
- Computes planar polygon union with micro-gap healing and collinear simplification
- Live vertex manipulation (edit, add, remove, reverse winding)
- Safe CBECC block injection: reuses existing PolyLoop name if <3 points, or uses next available ID
"""

import re
import math
from typing import List, Dict, Any, Tuple, Optional
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from shapely.ops import unary_union
import shapely


def parse_coord_line(line: str) -> Optional[Tuple[float, float, float]]:
    """Extract (x, y, z) from a CBECC 'Coord = ( x, y, z )' line."""
    m = re.search(
        r'\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\)',
        line
    )
    if m:
        return (float(m.group(1)), float(m.group(2)), float(m.group(3)))
    return None


def _shoelace_area_2d(coords: List[Tuple[float, float, float]]) -> float:
    """Return the absolute area of a 3D polygon projected onto XY using the shoelace formula."""
    n = len(coords)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += coords[i][0] * coords[j][1]
        area -= coords[j][0] * coords[i][1]
    return abs(area) / 2.0


def _check_area_mismatch(
    existing_area: float,
    floors: List[Dict[str, Any]],
    threshold: float = 0.05
) -> bool:
    """
    Return True if the existing PolyLp area differs by more than *threshold* (default 5%)
    from the Shapely-unioned area of all child floor surfaces.

    Returns False (no mismatch) when:
    - There are no child floors with valid geometry
    - The existing area is 0 (cannot compute a meaningful ratio)
    """
    if not floors or existing_area <= 0:
        return False

    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    polys = []
    for flr in floors:
        coords = flr.get("coords", [])
        if len(coords) < 3:
            continue
        coords_2d = [(p[0], p[1]) for p in coords]
        try:
            poly = Polygon(coords_2d)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_valid and not poly.is_empty:
                polys.append(poly)
        except Exception:
            continue

    if not polys:
        return False

    try:
        combined = unary_union(polys)
        combined_area = combined.area
    except Exception:
        return False

    if combined_area <= 0:
        return False

    diff_ratio = abs(existing_area - combined_area) / combined_area
    return diff_ratio > threshold


class CBECCModel:
    """Represents a parsed CBECC input file."""

    def __init__(self, content: str, filename: str = "model.cibd"):
        self.filename = filename
        self.raw_content = content
        self.lines = content.splitlines(keepends=True)
        self.spaces: List[Dict[str, Any]] = []
        self.max_polyloop_id: int = 0
        self.max_cartesian_id: int = 0
        self.ruleset: str = ""
        self.software_version: str = ""
        self.bldg_version: Optional[int] = None
        
        self._parse()

    def _parse(self):
        """Parse spaces, floors, and existing IDs from the CBECC text."""
        # Find ruleset and software version
        for line in self.lines[:60]:
            r_m = re.match(r'^RulesetFilename\s+"([^"]*)"', line.strip())
            if r_m:
                self.ruleset = r_m.group(1)
            v_m = re.search(r'SoftwareVersion\s*=\s*"([^"]*)"', line)
            if v_m:
                self.software_version = v_m.group(1)
            b_m = re.search(r'BldgEngyModelVersion\s*=\s*(\d+)', line)
            if b_m:
                self.bldg_version = int(b_m.group(1))

        # Find max existing PolyLoop and CartesianPoint IDs across entire file
        poly_nums = [int(m) for m in re.findall(r'^PolyLp\s+"(?:PolyLoop\s+)?(\d+)"', self.raw_content, re.M)]
        if not poly_nums:
            poly_nums = [int(m) for name in re.findall(r'^PolyLp\s+"([^"]*)"', self.raw_content, re.M) for m in re.findall(r'\d+', name)]
        
        cart_nums = [int(m) for m in re.findall(r'^CartesianPt\s+"(?:CartesianPoint\s+)?(\d+)"', self.raw_content, re.M)]
        if not cart_nums:
            cart_nums = [int(m) for name in re.findall(r'^CartesianPt\s+"([^"]*)"', self.raw_content, re.M) for m in re.findall(r'\d+', name)]

        self.max_polyloop_id = max(poly_nums) if poly_nums else 0
        self.max_cartesian_id = max(cart_nums) if cart_nums else 0

        # Parse spaces and floor surfaces
        current_spc: Optional[Dict[str, Any]] = None
        current_flr: Optional[Dict[str, Any]] = None
        current_flr_pts: List[Tuple[float, float, float]] = []

        i = 0
        total_lines = len(self.lines)

        while i < total_lines:
            line_str = self.lines[i]
            trimmed = line_str.strip()

            m_obj = re.match(r'^([A-Za-z0-9_]+)\s+"([^"]*)"', trimmed)
            if m_obj:
                obj_type, obj_name = m_obj.group(1), m_obj.group(2)

                # Finalize any open floor if a non-point / non-polylp object begins
                if current_flr and obj_type not in ("PolyLp", "CartesianPt"):
                    if current_flr_pts:
                        current_flr["coords"] = list(current_flr_pts)
                        current_flr_pts = []
                    current_flr = None

                # Space / Story / ThermalZone boundary terminates the active space
                if obj_type in ("Spc", "Story", "ThrmlZn"):
                    if current_spc:
                        self.spaces.append(current_spc)
                        current_spc = None

                if obj_type == "Spc":
                    # Record line where Spc definition ends (the '..' line)
                    spc_start_line = i
                    j = i + 1
                    spc_props: Dict[str, str] = {}
                    while j < total_lines and self.lines[j].strip() != "..":
                        p_line = self.lines[j].strip()
                        if "=" in p_line:
                            k, v = p_line.split("=", 1)
                            spc_props[k.strip()] = v.strip().strip('"')
                        j += 1
                    spc_end_dot_line = j  # 0-indexed line containing '..'

                    # Check if next non-empty object is PolyLp
                    k = spc_end_dot_line + 1
                    while k < total_lines and not self.lines[k].strip():
                        k += 1

                    has_polylp_header = False
                    existing_poly_name = None
                    existing_poly_coords: List[Tuple[float, float, float]] = []

                    if k < total_lines and self.lines[k].strip().startswith("PolyLp "):
                        has_polylp_header = True
                        pm = re.match(r'^PolyLp\s+"([^"]*)"', self.lines[k].strip())
                        if pm:
                            existing_poly_name = pm.group(1)

                        # Advance past '..' of PolyLp
                        k_pt = k + 1
                        while k_pt < total_lines and self.lines[k_pt].strip() != "..":
                            k_pt += 1
                        k_pt += 1

                        # Extract coords of any CartesianPt blocks for this space PolyLp
                        while k_pt < total_lines:
                            while k_pt < total_lines and not self.lines[k_pt].strip():
                                k_pt += 1
                            if k_pt < total_lines and self.lines[k_pt].strip().startswith("CartesianPt "):
                                # Read coordinate in this CartesianPt
                                while k_pt < total_lines and self.lines[k_pt].strip() != "..":
                                    sub_line = self.lines[k_pt].strip()
                                    if sub_line.startswith("Coord ="):
                                        pt = parse_coord_line(sub_line)
                                        if pt:
                                            existing_poly_coords.append(pt)
                                    k_pt += 1
                                k_pt += 1
                            else:
                                break

                    # A space has a valid PolyLoop ONLY IF it has a PolyLp AND at least 3 vertices
                    has_valid_polyloop = has_polylp_header and len(existing_poly_coords) >= 3

                    # Compute 2D shoelace area of the existing PolyLp (if valid)
                    existing_poly_area: Optional[float] = None
                    if has_valid_polyloop and len(existing_poly_coords) >= 3:
                        existing_poly_area = _shoelace_area_2d(existing_poly_coords)

                    current_spc = {
                        "name": obj_name,
                        "line_start": spc_start_line + 1,
                        "line_end": spc_end_dot_line + 1,
                        "properties": spc_props,
                        "thermal_zone": spc_props.get("ThrmlZnRef", ""),
                        "story": spc_props.get("StoryRef", ""),
                        "area": float(spc_props.get("Area", 0)) if "Area" in spc_props else None,
                        "has_polyloop": has_valid_polyloop,
                        "has_polylp_header": has_polylp_header,
                        "can_reuse_poly_name": has_polylp_header and (len(existing_poly_coords) < 3),
                        "existing_poly_name": existing_poly_name,
                        "existing_coords": existing_poly_coords,
                        "existing_coords_count": len(existing_poly_coords),
                        "existing_poly_area": existing_poly_area,
                        "area_mismatch": False,  # filled in after floors are collected
                        "floors": []
                    }

                elif current_spc and obj_type in ("IntFlr", "ExtFlr", "UndgrFlr"):
                    current_flr = {
                        "type": obj_type,
                        "name": obj_name,
                        "line": i + 1,
                        "coords": []
                    }
                    current_spc["floors"].append(current_flr)

            elif current_flr and trimmed.startswith("Coord ="):
                pt = parse_coord_line(trimmed)
                if pt:
                    current_flr_pts.append(pt)

            i += 1

        # Finalize tail
        if current_flr and current_flr_pts:
            current_flr["coords"] = list(current_flr_pts)
        if current_spc:
            self.spaces.append(current_spc)

        # Second pass: compute area mismatch for spaces that have a valid PolyLp
        for spc in self.spaces:
            if spc["has_polyloop"] and spc.get("existing_poly_area") is not None:
                spc["area_mismatch"] = _check_area_mismatch(
                    existing_area=spc["existing_poly_area"],
                    floors=spc["floors"],
                    threshold=0.05
                )

    @property
    def missing_spaces(self) -> List[Dict[str, Any]]:
        """Return list of spaces missing a valid PolyLp (<3 coords or no PolyLp) OR
        whose PolyLp area deviates >5% from the combined child-floor area."""
        return [s for s in self.spaces if not s["has_polyloop"] or s.get("area_mismatch", False)]

    @property
    def valid_spaces(self) -> List[Dict[str, Any]]:
        """Return list of spaces with a valid PolyLp (>=3 coords) AND no area mismatch."""
        return [s for s in self.spaces if s["has_polyloop"] and not s.get("area_mismatch", False)]


class GeometryEngine:
    """Computes planar polygon unions, heals micro-gaps, and simplifies collinear edges."""

    @staticmethod
    def clean_polygon(coords: List[Tuple[float, float]], buffer_dist: float = 0.0) -> Optional[Polygon]:
        """Creates a valid Shapely polygon from 2D coordinates."""
        if len(coords) < 3:
            return None
        poly = Polygon(coords)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if buffer_dist > 0:
            poly = poly.buffer(buffer_dist, join_style=2)
        return poly

    @staticmethod
    def combine_floors(
        floors: List[Dict[str, Any]],
        simplify_tol: float = 0.01,
        snap_tol: float = 0.05,
        included_floor_indices: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        """
        Unions selected child floors into a single outer polyloop.
        """
        if not floors:
            return {
                "success": False,
                "error": "No child floors found for this space.",
                "vertices": [],
                "area": 0.0,
                "z": 0.0
            }

        polys: List[Polygon] = []
        z_values: List[float] = []
        floor_details: List[Dict[str, Any]] = []

        for idx, flr in enumerate(floors):
            if included_floor_indices is not None and idx not in included_floor_indices:
                continue

            coords = flr.get("coords", [])
            if len(coords) < 3:
                continue

            coords_2d = [(p[0], p[1]) for p in coords]
            for p in coords:
                z_values.append(p[2])

            poly = GeometryEngine.clean_polygon(coords_2d)
            if poly and not poly.is_empty:
                polys.append(poly)
                floor_details.append({
                    "index": idx,
                    "type": flr.get("type", "Floor"),
                    "name": flr.get("name", f"Floor {idx+1}"),
                    "coords_count": len(coords),
                    "coords_2d": coords_2d,
                    "area": round(poly.area, 2)
                })

        if not polys:
            return {
                "success": False,
                "error": "Child floors do not contain valid coordinates.",
                "vertices": [],
                "area": 0.0,
                "z": 0.0
            }

        # Average Z elevation across all floor vertices
        avg_z = round(sum(z_values) / len(z_values), 4) if z_values else 0.0

        # Union operation
        try:
            # 1. Direct union
            union_geom = unary_union(polys)

            # 2. If disconnected or has slivers, attempt micro-gap healing if snap_tol > 0
            if (isinstance(union_geom, MultiPolygon) or not union_geom.is_valid) and snap_tol > 0:
                healed = unary_union([p.buffer(snap_tol, join_style=2) for p in polys])
                healed = healed.buffer(-snap_tol, join_style=2)
                if healed.is_valid and not healed.is_empty:
                    union_geom = healed

            # Handle MultiPolygon vs single Polygon
            is_multipolygon = False
            primary_poly: Polygon

            if isinstance(union_geom, Polygon):
                primary_poly = union_geom
            elif isinstance(union_geom, MultiPolygon):
                is_multipolygon = True
                primary_poly = max(union_geom.geoms, key=lambda g: g.area)
            elif isinstance(union_geom, GeometryCollection):
                poly_parts = [g for g in union_geom.geoms if isinstance(g, Polygon)]
                if poly_parts:
                    primary_poly = max(poly_parts, key=lambda g: g.area)
                else:
                    return {
                        "success": False,
                        "error": "Union resulted in empty geometry collection.",
                        "vertices": [],
                        "area": 0.0,
                        "z": avg_z
                    }
            else:
                return {
                    "success": False,
                    "error": f"Unexpected geometry type: {union_geom.geom_type}",
                    "vertices": [],
                    "area": 0.0,
                    "z": avg_z
                }

            # Simplification: removes collinear redundant vertices
            if simplify_tol > 0:
                simplified = primary_poly.simplify(simplify_tol, preserve_topology=True)
                if isinstance(simplified, Polygon) and not simplified.is_empty:
                    primary_poly = simplified

            # Extract outer boundary coordinates (excluding repeated closing point)
            raw_exterior = list(primary_poly.exterior.coords)[:-1]

            # Ensure precision formatting
            final_vertices = [(round(x, 4), round(y, 4), avg_z) for x, y in raw_exterior]
            bounds = primary_poly.bounds  # (minx, miny, maxx, maxy)

            return {
                "success": True,
                "is_multipolygon": is_multipolygon,
                "num_parts": len(union_geom.geoms) if isinstance(union_geom, MultiPolygon) else 1,
                "vertices": final_vertices,
                "vertex_count": len(final_vertices),
                "area": round(primary_poly.area, 2),
                "total_area": round(union_geom.area, 2),
                "z": avg_z,
                "bounds": [round(b, 2) for b in bounds],
                "floor_details": floor_details
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Geometry union error: {str(e)}",
                "vertices": [],
                "area": 0.0,
                "z": avg_z
            }


class PolyLoopInjector:
    """Injects newly created PolyLp and CartesianPt blocks into CBECC input file text."""

    @staticmethod
    def generate_polyloop_block(
        polyloop_name: str,
        cartesian_start_id: int,
        vertices: List[Tuple[float, float, float]]
    ) -> Tuple[str, int]:
        """
        Builds the exact CBECC formatted text block for a PolyLoop.
        
        Returns:
            (block_text, next_cartesian_id)
        """
        lines = []
        lines.append(f'PolyLp   "{polyloop_name}"  \n')
        lines.append('   ..\n\n')

        current_cart_id = cartesian_start_id
        for x, y, z in vertices:
            lines.append(f'CartesianPt   "CartesianPoint {current_cart_id}"  \n')
            sx = f"{x:g}"
            sy = f"{y:g}"
            sz = f"{z:g}"
            lines.append(f'   Coord = ( {sx}, {sy}, {sz} )\n')
            lines.append('   ..\n\n')
            current_cart_id += 1

        return "".join(lines), current_cart_id

    @staticmethod
    def inject_fixes(
        original_content: str,
        fixes: Dict[str, List[Tuple[float, float, float]]],
        start_poly_id: int,
        start_cart_id: int,
        space_meta_map: Optional[Dict[str, Dict[str, Any]]] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Injects PolyLoops for specified spaces.
        If a space had an empty/incomplete PolyLoop (<3 points), it reuses that PolyLoop name.
        
        Args:
            original_content: Original CBECC file text
            fixes: Dict mapping space_name -> list of (x, y, z) vertices
            start_poly_id: Next available unique PolyLoop ID integer
            start_cart_id: Next available unique CartesianPoint ID integer
            space_meta_map: Optional map with space metadata (can_reuse_poly_name, existing_poly_name)

        Returns:
            (repaired_content, summary_dict)
        """
        lines = original_content.splitlines(keepends=True)
        out_lines = []

        cur_poly_id = start_poly_id
        cur_cart_id = start_cart_id

        i = 0
        total_lines = len(lines)
        applied_fixes = {}

        while i < total_lines:
            line = lines[i]
            out_lines.append(line)

            m_spc = re.match(r'^Spc\s+"([^"]+)"', line.strip())
            if m_spc:
                spc_name = m_spc.group(1)

                # Copy Spc properties until '..'
                i += 1
                while i < total_lines:
                    out_lines.append(lines[i])
                    if lines[i].strip() == "..":
                        break
                    i += 1

                # If this space is scheduled for a fix:
                if spc_name in fixes:
                    vertices = fixes[spc_name]
                    
                    # Determine whether to reuse existing name or allocate new PolyLoop ID
                    meta = (space_meta_map or {}).get(spc_name, {})
                    can_reuse = meta.get("can_reuse_poly_name", False)
                    existing_name = meta.get("existing_poly_name")

                    # Check if next non-empty lines had the empty PolyLp and <3 CartesianPts
                    # Skip old empty PolyLp and its CartesianPts if present
                    j = i + 1
                    while j < total_lines and not lines[j].strip():
                        j += 1
                    
                    if j < total_lines and lines[j].strip().startswith("PolyLp "):
                        # Found existing PolyLp header! If not specified in meta, we can reuse this name
                        if not existing_name:
                            p_match = re.match(r'^PolyLp\s+"([^"]*)"', lines[j].strip())
                            if p_match:
                                existing_name = p_match.group(1)
                                can_reuse = True

                        # Advance past '..' of PolyLp
                        while j < total_lines and lines[j].strip() != "..":
                            j += 1
                        j += 1

                        # Skip any CartesianPt blocks belonging to this old PolyLp
                        while j < total_lines:
                            while j < total_lines and not lines[j].strip():
                                j += 1
                            if j < total_lines and lines[j].strip().startswith("CartesianPt "):
                                while j < total_lines and lines[j].strip() != "..":
                                    j += 1
                                j += 1
                            else:
                                break
                        # Update index i to skip the old empty/incomplete block
                        i = j - 1

                    if can_reuse and existing_name:
                        poly_name = existing_name
                    else:
                        poly_name = f"PolyLoop {cur_poly_id}"
                        cur_poly_id += 1

                    block_text, next_cart_id = PolyLoopInjector.generate_polyloop_block(
                        polyloop_name=poly_name,
                        cartesian_start_id=cur_cart_id,
                        vertices=vertices
                    )
                    out_lines.append("\n" + block_text)

                    applied_fixes[spc_name] = {
                        "polyloop_name": poly_name,
                        "reused_name": bool(can_reuse and existing_name),
                        "num_vertices": len(vertices),
                        "cartesian_range": [cur_cart_id, next_cart_id - 1]
                    }

                    cur_cart_id = next_cart_id

            i += 1

        repaired_text = "".join(out_lines)
        summary = {
            "fixed_count": len(applied_fixes),
            "applied_fixes": applied_fixes,
            "next_poly_id": cur_poly_id,
            "next_cart_id": cur_cart_id
        }

        return repaired_text, summary
