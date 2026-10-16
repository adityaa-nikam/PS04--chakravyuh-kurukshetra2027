"""Root-level convenience wrapper for Reel Studio AI Worker CLI.

Allows executing CLI commands directly from the repository root without manually
changing directories or setting PYTHONPATH.
"""

import sys
from pathlib import Path

# Ensure services/ai-worker is in Python module search path
worker_dir = Path(__file__).resolve().parent / "services" / "ai-worker"
if str(worker_dir) not in sys.path:
    sys.path.insert(0, str(worker_dir))

from app.cli import main

if __name__ == "__main__":
    main()
