# Investigation Scripts

This folder contains standalone PDF inspection and geometry experiments retained for reference. None of these scripts is required by the web converter; the supported app and regression suite remain in the parent folder.

Run scripts from the `PDF_to_CAD_Tool` directory so relative PDF and output paths resolve as expected:

```powershell
python devtools/check_fitz.py
python devtools/extract_and_plot_cad.py
```

A few experiments import neighboring scripts, including `test_rectify_algo.py`, `cluster_coords.py`, and `test_rectify.py`, as well as `generate_cad.py`, `verify_level2.py`, and `assemble_clean_model.py`. Those files are kept together here.

Old test-labeled exports are preserved under `output_cad/test_artifacts/`. New converter exports continue to be written directly to `output_cad/`.
