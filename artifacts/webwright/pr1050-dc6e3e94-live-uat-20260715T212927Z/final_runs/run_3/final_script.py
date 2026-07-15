import os
import runpy
from pathlib import Path


run_dir = Path(__file__).parent
os.environ["WEBWRIGHT_RUN_DIR"] = str(run_dir)
runpy.run_path(str(run_dir.parent / "run_1" / "final_script.py"), run_name="__main__")
