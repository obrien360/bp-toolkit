"""
server.py - Local Web Server and API for Building Energy Compliance Tool
Uses Python's standard library http.server for zero-dependency operation.
"""

import os
import sys
import json
import urllib.parse
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from parser_engine import scan_directory_for_htm_files, extract_compliance_data_from_html
from qc_engine import scan_model_folder_for_qc, parse_excel_qc_sheet
from reports_engine import scan_folder_for_leed_summary, parse_leed_summary_file

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class EnergyToolRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        if parsed_url.path == '/api/default-folder':
            default_path = os.path.join(BASE_DIR, 'example_project_folder')
            self._send_json_response({
                'path': default_path,
                'exists': os.path.exists(default_path)
            })
            return

        elif parsed_url.path == '/api/qc-default':
            default_folder = os.path.join(BASE_DIR, 'example_project_folder2')
            default_wb = os.path.join(BASE_DIR, 'CBECC Model Workbook - example2.xlsm')
            self._send_json_response({
                'folder': default_folder,
                'folderExists': os.path.exists(default_folder),
                'workbook': default_wb,
                'workbookExists': os.path.exists(default_wb)
            })
            return
            
        elif parsed_url.path == '/api/scan':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            folder_path = query_params.get('folder', [''])[0]
            
            if not folder_path:
                folder_path = os.path.join(BASE_DIR, 'example_project_folder')

            folder_path = os.path.normpath(folder_path)
            if not os.path.exists(folder_path):
                self._send_json_response({
                    'success': False,
                    'error': f"Directory does not exist: {folder_path}"
                }, status_code=404)
                return

            data = scan_directory_for_htm_files(folder_path)
            self._send_json_response({
                'success': True,
                'folder': folder_path,
                'fileCount': len(data),
                'files': data
            })
            return

        elif parsed_url.path == '/api/qc-scan':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            folder_path = query_params.get('folder', [''])[0]
            if not folder_path:
                folder_path = os.path.join(BASE_DIR, 'example_project_folder2')
            folder_path = os.path.normpath(folder_path)
            data = scan_model_folder_for_qc(folder_path)
            self._send_json_response(data)
            return

        elif parsed_url.path == '/api/qc-workbook':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            file_path = query_params.get('file', [''])[0]
            if not file_path:
                file_path = os.path.join(BASE_DIR, 'CBECC Model Workbook - example2.xlsm')
            file_path = os.path.normpath(file_path)
            data = parse_excel_qc_sheet(file_path)
            self._send_json_response(data)
            return

        elif parsed_url.path == '/api/reports-scan':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            folder_path = query_params.get('folder', [''])[0]
            if not folder_path:
                folder_path = os.path.join(BASE_DIR, 'example_project_folder2')
            folder_path = os.path.normpath(folder_path)
            data = scan_folder_for_leed_summary(folder_path)
            self._send_json_response(data)
            return

        # Serve static assets
        return super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            payload = {}

        if parsed_url.path == '/api/scan':
            try:
                folder_path = payload.get('folder', '').strip()
                if not folder_path:
                    folder_path = os.path.join(BASE_DIR, 'example_project_folder')
                
                folder_path = os.path.normpath(folder_path)
                if not os.path.exists(folder_path):
                    self._send_json_response({
                        'success': False,
                        'error': f"Directory not found: {folder_path}"
                    }, status_code=404)
                    return

                data = scan_directory_for_htm_files(folder_path)
                self._send_json_response({
                    'success': True,
                    'folder': folder_path,
                    'fileCount': len(data),
                    'files': data
                })
            except Exception as e:
                self._send_json_response({
                    'success': False,
                    'error': str(e)
                }, status_code=500)
            return

        elif parsed_url.path == '/api/qc-scan':
            try:
                folder_path = payload.get('folder', '').strip()
                if not folder_path:
                    folder_path = os.path.join(BASE_DIR, 'example_project_folder2')
                folder_path = os.path.normpath(folder_path)
                data = scan_model_folder_for_qc(folder_path)
                self._send_json_response(data)
            except Exception as e:
                self._send_json_response({'success': False, 'error': str(e)}, status_code=500)
            return

        elif parsed_url.path == '/api/qc-workbook':
            try:
                file_path = payload.get('file', '').strip()
                if not file_path:
                    file_path = os.path.join(BASE_DIR, 'CBECC Model Workbook - example2.xlsm')
                file_path = os.path.normpath(file_path)
                data = parse_excel_qc_sheet(file_path)
                self._send_json_response(data)
            except Exception as e:
                self._send_json_response({'success': False, 'error': str(e)}, status_code=500)
            return

        elif parsed_url.path == '/api/reports-scan':
            try:
                folder_path = payload.get('folder', '').strip()
                if not folder_path:
                    folder_path = os.path.join(BASE_DIR, 'example_project_folder2')
                folder_path = os.path.normpath(folder_path)
                data = scan_folder_for_leed_summary(folder_path)
                self._send_json_response(data)
            except Exception as e:
                self._send_json_response({'success': False, 'error': str(e)}, status_code=500)
            return

        self._send_json_response({'error': 'Not found'}, status_code=404)

    def _send_json_response(self, data: dict, status_code: int = 200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)


def run_server(port: int = PORT, open_browser: bool = False):
    server_address = ('127.0.0.1', port)
    try:
        httpd = HTTPServer(server_address, EnergyToolRequestHandler)
    except OSError:
        # Fallback to alternate port if busy
        port = port + 1
        server_address = ('127.0.0.1', port)
        httpd = HTTPServer(server_address, EnergyToolRequestHandler)

    url = f"http://localhost:{port}/"
    print(f"================================================================")
    print(f"  Building Energy Performance Rating Compliance Tool Server")
    print(f"  Running at: {url}")
    print(f"================================================================")
    
    if open_browser:
        webbrowser.open(url)
        
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()


if __name__ == '__main__':
    auto_open = '--no-open' not in sys.argv
    port_arg = PORT
    for idx, arg in enumerate(sys.argv):
        if arg in ('-p', '--port') and idx + 1 < len(sys.argv):
            port_arg = int(sys.argv[idx + 1])
    run_server(port_arg, open_browser=False)
