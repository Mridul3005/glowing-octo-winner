#!/usr/bin/env python3
import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import os
import time

PORT = 8000
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
CACHE_DURATION_SECS = 6 * 60 * 60  # 6 hours

# Valid Celestrak group names we allow
VALID_GROUPS = {
    "visual": "visual",       # 100 brightest
    "stations": "stations",   # Space Stations
    "starlink": "starlink",   # Starlink
    "weather": "weather",     # Weather
    "gps-ops": "gps-ops",     # GPS Operational
    "glo-ops": "glo-ops",     # GLONASS Operational
    "galileo": "galileo",     # Galileo Operational
    "amateur": "amateur",     # Radio Amateur
    "science": "science",     # Active Science
}

class SatelliteRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        # Handle API endpoint
        if parsed_url.path == '/api/satellites':
            self.handle_api(parsed_url)
        else:
            # Default to index.html if pointing to root
            if parsed_url.path == '/' or parsed_url.path == '':
                self.path = '/index.html'
            super().do_GET()

    def handle_api(self, parsed_url):
        query_params = urllib.parse.parse_qs(parsed_url.query)
        group = query_params.get('group', ['visual'])[0].lower()

        if group not in VALID_GROUPS:
            self.send_error_response(400, f"Invalid group. Must be one of: {', '.join(VALID_GROUPS.keys())}")
            return

        os.makedirs(CACHE_DIR, exist_ok=True)
        cache_path = os.path.join(CACHE_DIR, f"{group}.txt")
        
        # Check if cache is valid
        use_cache = False
        if os.path.exists(cache_path):
            file_age = time.time() - os.path.getmtime(cache_path)
            if file_age < CACHE_DURATION_SECS:
                use_cache = True

        if use_cache:
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    data = f.read()
                self.send_success_response(data)
                return
            except Exception as e:
                # If error reading cache, we will try fetching fresh
                pass

        # Fetch fresh data from Celestrak
        url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=tle"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                tle_data = response.read().decode('utf-8')
            
            # Save to cache
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write(tle_data)
                
            self.send_success_response(tle_data)
        except urllib.error.URLError as e:
            # Fallback to expired cache if available
            if os.path.exists(cache_path):
                try:
                    with open(cache_path, 'r', encoding='utf-8') as f:
                        data = f.read()
                    self.send_success_response(data)
                    return
                except Exception:
                    pass
            self.send_error_response(502, f"Failed to fetch satellite data: {str(e)}")
        except Exception as e:
            self.send_error_response(500, f"Internal server error: {str(e)}")

    def send_success_response(self, content):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(content.encode('utf-8'))

    def send_error_response(self, status_code, message):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        error_json = {"error": message}
        self.wfile.write(urllib.parse.json.dumps(error_json).encode('utf-8'))

def main():
    # Change working directory to this script's directory so it serves static assets properly
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    # Allow address reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), SatelliteRequestHandler) as httpd:
        print(f"==========================================================")
        print(f"📡 Satellite Tracker Server running at http://localhost:{PORT}")
        print(f"🚀 Press Ctrl+C to stop.")
        print(f"📁 Serving static assets from: {script_dir}")
        print(f"💾 Caching TLEs under: {CACHE_DIR}")
        print(f"==========================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    main()
