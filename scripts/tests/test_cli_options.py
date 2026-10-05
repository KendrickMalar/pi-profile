import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "test-startup-profile-cli.py"

class CLIOptions(unittest.TestCase):
    def test_help_exposes_explicit_external_paths(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--omp-extension", result.stdout)
        self.assertIn("--compatibility-only", result.stdout)

    def test_compatibility_rejects_missing_external_paths_before_launch(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--compatibility-only", "--pi", sys.executable],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("both --plan-extension and --omp-extension", result.stderr)

if __name__ == "__main__":
    unittest.main()
