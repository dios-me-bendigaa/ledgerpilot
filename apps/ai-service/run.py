"""PyInstaller entry point — bundles the FastAPI AI sidecar as a single binary."""
import sys
import os

# Ensure the parent dir of `app` is on the path when frozen
if getattr(sys, 'frozen', False):
    bundle_dir = os.path.dirname(sys.executable)
    sys.path.insert(0, bundle_dir)

import uvicorn
from app.main import app  # noqa: E402

if __name__ == '__main__':
    port = int(os.environ.get('LEDGER_AI_PORT', '8877'))
    uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')
