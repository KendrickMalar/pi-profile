import os
import shlex
import shutil
import tempfile
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

    @unittest.skipUnless(shutil.which("pi") and shutil.which("node"), "requires installed Pi and Node")
    def test_cli_uses_node_from_callers_path(self):
        node=shutil.which("node"); pi=shutil.which("pi")
        with tempfile.TemporaryDirectory(prefix="profile-node-path-") as directory:
            root=Path(directory); marker=root/"node-used"; wrapper=root/"node"
            wrapper.write_text("#!/bin/sh\nprintf invoked >> "+shlex.quote(str(marker))+"\nexec "+shlex.quote(node)+" \"$@\"\n")
            wrapper.chmod(0o755)
            env={**os.environ,"PATH":str(root)+os.pathsep+os.environ.get("PATH","")}
            result=subprocess.run([sys.executable,str(SCRIPT),"--pi",pi,"--case","shutdown_during_selection"],
                                  env=env,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            self.assertTrue(marker.exists(),"fixture must reuse the caller's Node executable")
            self.assertIn("invoked",marker.read_text())

if __name__ == "__main__":
    unittest.main()
