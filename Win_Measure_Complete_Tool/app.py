"""
app.py - Hugging Face Spaces entrypoint
Runs the O'Brien360 Window Measurement Completion Tool REST server.
"""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import server

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    print(f"Starting O'Brien360 Window Tool server on port {port}...")
    server.run_server(port)
