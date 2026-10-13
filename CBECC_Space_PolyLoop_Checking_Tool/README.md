# CBECC Space PolyLoop Checking Tool

**Space PolyLoop Validation & Geometry Repair Engine**  
Developed for **O'Brien360** building energy modeling workflows.

---

## Overview

When importing architectural BIM models into CBECC (via OpenStudio, gbXML, or SDDM translators), certain thermal spaces (`Spc`) occasionally lose their bounding polyloop (`PolyLp`), causing critical simulation errors and broken 3D geometry.

In CBECC input files (`.cibd`, `.cibd10`, `.cibd16`, `.cibd19`, `.cibd22`, `.cibd25i`):
- A space's child floor surfaces (`IntFlr`, `ExtFlr`, `UndgrFlr`) define the floor plane.
- Child objects are defined sequentially after `Spc` and before the next `Spc`, `Story`, or `ThrmlZn`.
- **CBECC Space PolyLoop Checking Tool** scans the model, identifies every space missing a `PolyLp` or whose existing `PolyLp` area deviates >5% from its child floors, automatically unions its child floors into a closed boundary loop, allows visual CAD inspection & coordinate adjustment, and cleanly injects the newly generated or corrected `PolyLp` and `CartesianPt` blocks into the file.

---

## Features

1. **Automatic Missing PolyLoop Detection**:
   - Parses CBECC files with zero corruption to original lines.
   - Detects all spaces missing `PolyLp` blocks immediately.
2. **Robust Shapely Floor Union**:
   - Computes planar polygon union across all child floors (`IntFlr`, `ExtFlr`, `UndgrFlr`).
   - Micro-gap healing eliminates CAD coordinate slivers ($0.05\text{ ft}$ snap tolerance).
   - Douglas-Peucker collinear simplification ($0.01\text{ ft}$) keeps vertex counts clean and minimal.
3. **Interactive 2D CAD Viewport**:
   - Real-time HTML5 vector canvas with pan, zoom, and fit-view.
   - Color-coded layers showing each child floor surface underneath the combined outer boundary.
   - Hover tooltips and numeric vertex badges ($1, 2, 3\dots$).
4. **Live In-Place Coordinate Editor**:
   - Edit any $(X, Y, Z)$ coordinate in real time.
   - Add, delete, and reverse winding order (CCW/CW).
   - Toggle individual child floors to include or exclude from union.
5. **Safe Entity ID Allocation & CBECC Injection**:
   - Finds highest existing `PolyLoop X` and `CartesianPoint Y` integers across the entire file.
   - Sequentially allocates collision-free unique IDs.
   - Formats and injects compliant CBECC blocks right after the target `Spc` block.
6. **One-Click Batch Repair & Export**:
   - "Auto-Fix All Missing" repairs all spaces in one step.
   - Direct download of `{filename}_fixed.cibd19`.

---

## Quick Start

### 1. Launching the Web Tool
Double-click **`run_tool.bat`** or run:
```bash
python server.py
```
Browser opens automatically at `http://localhost:8090`.

### 2. Running Automated Tests
```bash
python -m unittest test_app.py -v
```
