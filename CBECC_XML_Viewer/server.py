"""
server.py - Local Web Server for CBECC XML Viewer
Uses Python standard library http.server for zero-dependency standalone operation.
"""

import os
import sys
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8083
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class ModelViewerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

def run_server(port=PORT):
    for p in range(port, port + 20):
        try:
            server_address = ('', p)
            httpd = HTTPServer(server_address, ModelViewerRequestHandler)
            url = f'http://localhost:{p}/index.html'
            print(f'Starting CBECC XML Viewer at {url}')
            if '--no-browser' not in sys.argv:
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            httpd.serve_forever()
            break
        except OSError:
            continue

if __name__ == '__main__':
    run_server()
