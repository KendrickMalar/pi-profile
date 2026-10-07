import unittest,subprocess,sys
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/"test-profile-launcher-cli.py"
class LauncherOptions(unittest.TestCase):
 def test_help_and_missing_launcher(self):
  help=subprocess.run([sys.executable,str(SCRIPT),"--help"],capture_output=True,text=True)
  self.assertEqual(help.returncode,0,help.stderr);self.assertIn("--launcher",help.stdout)
  bad=subprocess.run([sys.executable,str(SCRIPT),"--launcher","/definitely/missing"],capture_output=True,text=True)
  self.assertEqual(bad.returncode,2,bad.stderr)
if __name__=="__main__":unittest.main()
