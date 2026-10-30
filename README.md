# OB360 Tools

A collection of internal engineering, sustainability, and computational geometry tools developed for **O'Brien360**.

---

## Tools Directory

### 1. [PDF to Clean CAD Tool (`PDF_to_CAD_Tool/`)](PDF_to_CAD_Tool/)
**Zoning Plan & Architectural Geometry Engine**
- Converts Bluebeam polygon markup annotations on architectural PDFs into clean, orthogonal single-line DWG/DXF files with closed polyloops.
- **Automatic Scale & Level Detection**: Reads `/Measure` dictionaries (e.g. `1/8" = 1'-0"` &rarr; `9.0 pt/ft`) and PDF layer OCGs (`Level 1`, `Level 2`, etc.).
- **Shared Wall Single-Line Deduplication**: Adjacent zones sharing a boundary wall are drawn as a single shared wall line instead of duplicate overlapping lines.
- **Strict Orthogonal Snapping**: Straightens segments within $\pm 5.0^\circ$ of horizontal or vertical, ray-intersecting clean rectangular corners.
- **Zero Open Ends Guarantee**: Planar graph polygonization ensures $0$ dangling endpoints (`open ends = 0`), preventing "open polyloop" errors in Revit, ArchiCAD, and energy models.
- **Master Base Overlay Snapping**: Base level is converted first; subsequent levels snap to base grid coordinates for $100\%$ coincident perimeter/core wall alignment.
- **Interactive CAD Review**: Single-level inspector, multi-level overlay (with shared wall gold highlight), and spread-out layout preview.
- **Production CAD Export**:
  - **Spread-Out DWG/DXF**: Levels spaced horizontally at equal distance (user-editable, default $120\%$ of max width) with floor labels.
  - **Origin-Aligned DWG/DXF**: All levels stacked at $(0, 0)$ for direct 3D BIM / building energy modeling import.
  - **Verification Plot (PNG)**: High-resolution multi-panel verification graphic.

---

### 2. [CBECC Space PolyLoop Checking Tool (`CBECC_Space_PolyLoop_Checking_Tool/`)](CBECC_Space_PolyLoop_Checking_Tool/)
**Building Energy Model Geometry Healing Engine**
- Detects spaces (`Spc`) missing `PolyLp` or having area mismatches (>5% deviation from child floors) in CBECC input files (`.cibd`, `.cibd10`, `.cibd19`, `.cibd22`, `.cibd25i`).
- Combines child floor polyloops (`IntFlr`, `ExtFlr`, `UndgrFlr`) using robust Shapely planar polygon union.
- **Sliver & Micro-gap Healing**: Automatic snap tolerance heals CAD boundaries and prevents detached multi-polygon errors.
- **Interactive 2D CAD Viewport**: Visualizes individual child floor surfaces overlaid with the combined space polyloop boundary.
- **Live In-Place Coordinate Editor**: Review and adjust $(X, Y, Z)$ coordinates, add/remove vertices, or reverse loop winding.
- **Safe CBECC Injection**: Automatically allocates collision-free sequential `PolyLoop` and `CartesianPoint` IDs and cleanly injects them after the space object.
- **One-Click Batch Repair & Export**: Repair all missing spaces in one click and download the fixed `.cibd` model file.

---

### 3. [CBECC Post-Sim Tool (`CBECC_PostSim_Tool/`)](CBECC_PostSim_Tool/)
**Energy Performance Rating Compliance & Model QC Tool**
- Extracts and aggregates CBECC / LEED EAp2-4/5 Performance Rating Method compliance data from simulation output HTML reports (`ap`, `ab1`, `ab2`, `ab3`, `ab4`).
- Parses end-use breakdowns for Electricity and Natural Gas.
- Supports dynamic baseline averaging (ab1–ab4).
- Exports formatted reports matching the LEED standard template (CSV and multi-tab Excel).
- Interactive Chart.js visual summary.
- **Model QC Workspace**:
  - **Unmet Hours Verification**: Extracts occupied heating/cooling unmet hours from *Time Setpoint Not Met*, displays high-level Facility totals, flags zones $> 150$ hrs, with interactive filtering and sorting.
  - **Workbook Discrepancy Checks**: Compares modeled energy and water metrics against the CBECC Model Workbook (`QC` sheet), flagging discrepancies exceeding $\pm 1\%$ (or $\pm 2\%$ for General Water Systems).
  - **Schedule Verification**: Inspects lighting and receptacle schedule Equivalent Full Load Hours (EFLH).
  - **Envelope Quality Control**: Aggregates unique opaque exterior, opaque interior (with reversed surfaces unified), and exterior fenestration constructions, cross-referencing against CBECC `.ibd-Detail` component definitions and decoded baseline factors.
  - **Mechanical Ventilation QC**: Calculates Minimum Outdoor Air Occupied CFM and CFM/ft², cross-checking against CBECC `VentPerAreaSim` by zone and space type.
  - Runs in both local Python server mode and zero-dependency client-side browser mode.

---

## Quick Start for Team Members

### Hosted Web Tools on GitHub Pages (Zero Local Installation)
- **PDF to Clean CAD Tool**: [Launch Hosted PDF to Clean CAD Tool](https://obrien360.github.io/bp-toolkit/PDF_to_CAD_Tool/)
- **CBECC Space PolyLoop Checking Tool**: [Launch Hosted Space PolyLoop Checking Tool](https://obrien360.github.io/bp-toolkit/CBECC_Space_PolyLoop_Checking_Tool/)
- **CBECC Post-Sim Tool**: [Launch Hosted CBECC Post-Sim Tool](https://obrien360.github.io/bp-toolkit/CBECC_PostSim_Tool/)

### Prerequisites
- [Python 3.8+](https://www.python.org/downloads/) (standard installation with "Add python.exe to PATH" checked).
- Core dependencies: `pip install pymupdf ezdxf shapely matplotlib`

### Launching Tool 1: PDF to Clean CAD Tool
- Navigate to `PDF_to_CAD_Tool/` and double-click **`run_tool.bat`**.
- Browser opens at `http://localhost:8085`.

### Launching Tool 2: CBECC Space PolyLoop Checking Tool
- Navigate to `CBECC_Space_PolyLoop_Checking_Tool/` and double-click **`run_tool.bat`**.
- Browser opens at `http://localhost:8090`.

### Launching Tool 3: CBECC Post-Sim Tool
- Navigate to `CBECC_PostSim_Tool/` and double-click **`run_tool.bat`**.
- Browser opens at `http://localhost:8080`.

---

## Running Automated Tests

To test Tool 1:
```bash
cd CBECC_PostSim_Tool
python -m unittest test_app.py -v
python -m unittest test_qc_engine.py -v
```

To test Tool 2:
```bash
cd PDF_to_CAD_Tool
python -m unittest test_app.py -v
```

To test Tool 3:
```bash
cd CBECC_Space_PolyLoop_Checking_Tool
python -m unittest test_app.py -v
```
