# OB360 Tools

A collection of internal engineering, sustainability, and computational geometry tools developed for **O'Brien360**.

---

## Tools Directory

### 1. [CBECC Result Tool (`CBECC_result_tool/`)](CBECC_result_tool/)
**Energy Performance Rating Compliance Tool**
- Extracts and aggregates CBECC / LEED EAp2-4/5 Performance Rating Method compliance data from simulation output HTML reports (`ap`, `ab1`, `ab2`, `ab3`, `ab4`).
- Parses end-use breakdowns for Electricity and Natural Gas.
- Supports dynamic baseline averaging (ab1–ab4).
- Exports formatted reports matching the LEED standard template (CSV and multi-tab Excel).
- Interactive Chart.js visual summary.
- Runs with zero external Python dependencies.

---

### 2. [Bluebeam PDF to DWG Converter (`PDF_to_DWG/`)](PDF_to_DWG/)
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

## Quick Start for Team Members

### Hosted PDF to DWG Converter
- Open the [PDF to DWG Converter](https://obrien360.github.io/bp-toolkit/PDF_to_DWG/) in a browser; no local Python setup is required.

### Prerequisites
- [Python 3.8+](https://www.python.org/downloads/) (standard installation with "Add python.exe to PATH" checked).
- Core dependencies: `pip install pymupdf ezdxf shapely matplotlib`

### Launching Tool 1: CBECC Result Tool
- Navigate to `CBECC_result_tool/` and double-click **`run_tool.bat`**.
- Browser opens at `http://localhost:8080`.

### Launching Tool 2: Bluebeam PDF to DWG Converter
- Navigate to `PDF_to_DWG/` and double-click **`run_tool.bat`**.
- Browser opens at `http://localhost:8085`.

---

## Running Automated Tests

To test Tool 1:
```bash
cd CBECC_result_tool
python -m unittest test_app.py -v
```

To test Tool 2:
```bash
cd PDF_to_DWG
python -m unittest test_app.py -v
```
