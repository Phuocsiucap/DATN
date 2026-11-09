import os
import sys
from pathlib import Path

STUDIO_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(STUDIO_DIR))

if __name__ == "__main__":
    from app import main
    main()
