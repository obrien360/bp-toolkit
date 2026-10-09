# Bluebeam PDF to DWG Converter — Zoning Plan & Geometry Tool

An automated computational geometry converter and web application for **O'Brien360** that converts Bluebeam polygon markup annotations on architectural PDFs into clean, orthogonal single-line DWG/DXF files with closed polyloops.

---

## Key Capabilities & Conversion Rules

1. **Automatic Scale & Level Detection**
   - **Scale**: Automatically detects page scale from Bluebeam `/Measure` or Viewport dictionaries (e.g. `0.125 in = 1 ft' in"` &rarr; `9.0 pt/ft`), with architectural presets (`1/16"`, `1/8"`, `1/4"`, etc.) and custom values editable by the user.
   - **Levels**: Uses any named Optional Content Group (OCG / PDF layer) as the annotation's level name, including custom names such as `Wing A`, while avoiding author titles when no layer is assigned.
   - **Base Reference & Snap Bases**: User selects a master reference level, then assigns the snap-base level for each other layer. The tool derives a valid conversion sequence from those dependencies.
   - **Spread-Out Layout Order**: User can set the left-to-right level order independently; it defaults to natural floor order (Basement, Level 1, Level 2, ..., Roof).

2. **Clean CAD Simplification Rules**
   - **Shared Wall Deduplication (Rule 2.a)**: Adjacent zones sharing a boundary wall are merged into a single line (`unary_union`, planar graph). No double walls.
   - **Orthogonal Snapping (Rule 2.b)**: Segments within $\pm 5.0^\circ$ (user-editable) of horizontal or vertical are straightened to true $0^\circ$ or $90^\circ$, eliminating drafting skew and ray-intersecting clean rectangular corners.
   - **Zero Open Ends (Rule 2.c)**: Planar graph polygonization guarantees $0$ dangling endpoints (`open ends = 0`), preventing "open polyloop" errors when generating building models in Revit, ArchiCAD, CBECC-Com, or EnergyPlus.
   - **AutoCAD Layer Separation (Rule 2.d)**: Distinct layers per level:
     - `LEVEL_1` / `LEVEL_2`: Single-line wall networks
     - `LEVEL_1_POLYLOOPS` / `LEVEL_2_POLYLOOPS`: Closed lwpolylines for each room/zone
     - `LEVEL_1_TEXT` / `LEVEL_2_TEXT`: Room name and calculated square footage labels
   - **Dependency-Based Overlay Snapping (Rule 2.e & 2.f)**: The base reference is converted first. Each other level snaps to the coordinate grid of its selected snap-base level; conversion order is resolved automatically from those dependencies.

3. **Interactive Review & Visualization (Rule 3)**
   - **Level by Level Viewer**: Inspect single floor plans with layer toggles (walls, polyloops, labels, grid), zoom/pan, room hover tooltips, and area tables.
   - **Multi-Level Overlay Viewer**: Overlay 2 or 3 levels simultaneously with distinct color coding, opacity controls, and an "Alignment Inspector" highlighting shared walls in gold.
   - **Spread-Out Preview (Rule 4)**: Interactive preview of all levels spaced horizontally side-by-side.

4. **Production Export Options (Rule 4)**
   - **Spread-Out DWG / DXF**: All levels spaced horizontally by a user-editable distance in feet. The default is the nearest 100 ft to approximately 120% of the widest detected level.
   - **Aligned DWG / DXF**: All levels stacked at origin $(0, 0)$ for direct 3D BIM / building energy modeling import.
   - **Verification Plot (PNG)**: Multi-panel high-resolution engineering verification graphic.

---

## Hosted Web App

Open the [PDF to DWG Converter](https://obrien360.github.io/bp-toolkit/PDF_to_DWG/) for browser-based use. It parses PDFs in the browser with PDF.js, so no Python installation is needed and uploaded files are not sent to a server. An internet connection is required to load the PDF.js library. The local Python server remains available for server-backed analysis and production exports.

## Quick Start (3 Ways)

### Option 1: Double-Click Launcher (Windows — Recommended)
1. Double-click **`run_tool.bat`** in this folder (`PDF_to_DWG/`).
2. Your default web browser will automatically open to `http://localhost:8085`.

### Option 2: Via Terminal
```bash
cd c:\Local\AntiGravityProjects\OB360_tools\PDF_to_DWG
python server.py
```
Open your browser at `http://localhost:8085`.

### Option 3: Python CLI / Batch Scripting
```python
import pymupdf
from cad_engine import process_cad_conversion, export_cad_files, generate_verification_plot

doc = pymupdf.open("Zoning.pdf")
result = process_cad_conversion(doc, base_level="Level 1", conversion_order=["Level 1", "Level 2"], scale=9.0)
files = export_cad_files(result, output_dir="output_cad", spacing_ft=400.0, layout_mode="both")
generate_verification_plot(result, "output_cad/Zoning_Clean_Verification.png")
```

---

## Running the Automated Test Suite

To run the complete automated test suite (verifying all rules, geometric rectification, zero open ends, multi-level overlay, export formats, and REST API):
```bash
cd c:\Local\AntiGravityProjects\OB360_tools\PDF_to_DWG
python -m unittest test_app.py -v
```

---

## Project Structure

```
PDF_to_DWG/
├── cad_engine.py             # Computational geometry, snapping, planar graph & DXF engine
├── server.py                 # REST API & static file web server (Python standard library)
├── index.html                # Modern O'Brien360 CAD web application interface
├── index.css                 # Styling & theme system with CAD canvas styling
├── app.js                    # Interactive 2D Canvas CAD engine (pan/zoom/multi-level overlay)
├── run_tool.bat              # Double-click Windows launcher
├── test_app.py               # Automated unit & integration tests
├── Zoning.pdf                # Reference sample architectural zoning plan with Bluebeam markup
├── ShoeboxZoning.pdf         # Multi-floor sample PDF
├── assets/                   # O'Brien360 brand assets
├── devtools/                 # Historical PDF and geometry investigation scripts
└── output_cad/               # CAD exports and test_artifacts/ for old test outputs
```

The standalone investigation scripts are documented in `devtools/README.md` and are not required by the converter.
