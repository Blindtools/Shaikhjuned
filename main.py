import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory
from flask_cors import CORS
from src.routes.ktm import ktm_bp

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'ktm-assistant-secret-key-2025'

# Enable CORS for all routes
CORS(app)

# Register KTM Assistant blueprint
app.register_blueprint(ktm_bp, url_prefix='/api')

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    """Serve static files and index.html for the browser interface"""
    static_folder_path = app.static_folder
    if static_folder_path is None:
            return "Static folder not configured", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, 'index.html')
        else:
            return "index.html not found", 404

@app.route('/api')
def api_info():
    """API information endpoint"""
    return {
        'name': 'KTM Assistant API',
        'version': 'R1.0',
        'developer': 'KTM Team',
        'founder': 'Sandeep Ghimeere',
        'launch_date': 'May 11, 2025',
        'base_url': 'http://localhost:5000',
        'endpoints': {
            'chat': '/api/ktm/chat (POST)',
            'info': '/api/ktm/info (GET)',
            'health': '/api/ktm/health (GET)'
        },
        'documentation': 'Visit the root URL for browser interface and testing'
    }

if __name__ == '__main__':
    print("=" * 50)
    print("KTM Assistant API R1.0")
    print("Developer: KTM Team")
    print("Founder: Sandeep Ghimeere")
    print("Launch Date: May 11, 2025")
    print("=" * 50)
    print("Server starting on http://localhost:5000")
    print("API Endpoint: http://localhost:5000/api/ktm/chat")
    print("Browser Interface: http://localhost:5000")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5000, debug=True)

