# PDF Window Measurement Completion Tool (Win_Measure_Complete_Tool)

Part of the **O'Brien360 Tools Suite**.

Automatically completes window area measurements across architectural elevation PDF sheets using representative measurements created by the user in Bluebeam Revu.

---

## Key Capabilities

1. **Multi-Page Elevation PDF Ingestion**
   - Loads multi-page elevation PDFs (e.g. 6 sheets with dozens of elevations).
   - Extracts all pages, dimensions, and text blocks.

2. **Representative Window Ground-Truth Learning**
   - Automatically detects window type labels (e.g., `W01`, `W02`, `W03`, `W10`, `W15`).
   - Uses manual measurements placed by the user as the source of truth for each window type.
   - Learns representative width, height, area string (e.g. `40 sf`), scale calibration (`/Measure` dictionary), and spatial label-to-window offsets.

3. **Computer-Vision Drawing-Edge Snapping**
   - Rather than relying strictly on text coordinates, renders dark-line edge energy maps (suppressing light facade hatches).
   - Employs a coarse-to-fine sub-point grid search to snap measurement rectangles directly to the actual vector window linework.

4. **100% Bluebeam Revu Compatibility**
   - Generates native PDF `/PolygonDimension` annotations with `/Subj (Area Measurement)`.
   - Copies representative stroke color (`/C`), fill color (`/IC`), and exact **30% fill opacity** (`/FillOpacity .3`, `/ca .3`).
   - Retains the `/Measure` calibration dictionary and area units (`sf`).
   - Markups are fully editable and selectable in Bluebeam Revu.

5. **Overlap & Double-Counting Prevention**
   - Checks both Euclidean center distance and bounding box intersection over union (IoU).
   - Preserves all existing manual measurements and ensures no candidate window is measured twice.

6. **Interactive Elevation Sheet Viewer & Takeoff Export**
   - 2D Canvas viewport with smooth pan and zoom.
   - Interactive hover inspector with window type, dimensions, and snapping shift metrics.
   - One-click export of completed PDF and CSV window takeoff schedule.

---

## Quick Start

### 1. Launch the Tool
Double-click `run_tool.bat` or run:
```bash
python server.py 8088
```

Your default web browser will open automatically to `http://localhost:8088`.

### 2. Workflow
1. **Load Elevation PDF**: Click **"Load Example (Windows_Measure_Test.pdf)"** or drag and drop your elevation PDF.
2. **Review Learned Types**: Inspect Section 2 to see all detected window types, manual sample counts, learned dimensions, area, and 30% fill opacity.
3. **Inspect Elevation Sheets**: Use the Interactive Elevation Sheet Viewer to navigate pages, inspect manual markups in blue, and review layout.
4. **Complete Measurements**: Click **"Complete Window Measurements"**. Missing windows are snapped to vector edges, given 30% fill opacity, and added to the PDF.
5. **Download & Export**: Click **"Download Completed PDF"** or **"Export Window Takeoff CSV"**.

---

## Technical Details

- **Language / Runtime**: Python 3.8+ (Zero external web framework dependencies, uses standard library `http.server`).
- **PDF Engine**: `pymupdf` (MuPDF vector rendering & PDF dictionary manipulation).
- **Vision & Array Math**: `numpy` (dark line energy map & coarse-to-fine search).
- **Styling**: O'Brien360 Modern Engineering Theme matching `PDF_to_CAD_Tool`.
