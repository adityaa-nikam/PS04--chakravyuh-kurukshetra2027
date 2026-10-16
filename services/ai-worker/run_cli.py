"""Convenience runner for Reel Studio AI Worker CLI from services/ai-worker directory."""

import sys
from pathlib import Path

cur_dir = Path(__file__).resolve().parent
if str(cur_dir) not in sys.path:
    sys.path.insert(0, str(cur_dir))

from app.cli import main

if __name__ == "__main__":
    main()
