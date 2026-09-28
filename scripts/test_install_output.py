#!/usr/bin/env python3
"""Test the actual final install block with a fake Agent; no service is changed."""
import os, subprocess, tempfile, unittest
from pathlib import Path
SCRIPT = Path(__file__).with_name("install.sh")
class OutputTests(unittest.TestCase):
 def run_output(self, fail=""):
  with tempfile.TemporaryDirectory(prefix="agent-output-test-") as td:
   binary = Path(td) / "fake-agent"
   binary.write_text('#!/bin/sh\n[ "$2" != "$TEST_FAIL" ]\n')
   binary.chmod(0o755)
   source = SCRIPT.read_text()
   tail = source[source.rindex('if [ -f "$binary" ]; then'):]
   prefix = 'set -e\nbinary="$TEST_BINARY"\nbackup=/test/backup\ntmp=/test/tmp\ninstall() { :; }\nrollback() { echo "Installation failed" >&2; exit 1; }\n'
   return subprocess.run(["sh", "-c", prefix + tail], capture_output=True, text=True,
    env={**os.environ, "TEST_BINARY": str(binary), "TEST_FAIL": fail})
 def test_green_success(self):
  result = self.run_output()
  self.assertEqual(result.returncode, 0, result.stderr)
  self.assertIn("\033[0;32m", result.stdout)
  self.assertIn("安装成功，服务已启动", result.stdout)
  self.assertIn("\033[0m", result.stdout)
  self.assertIn("不代表认证或连接成功", result.stdout)
 def test_no_success_on_failure(self):
  for action in ["install", "start"]:
   result = self.run_output(action)
   self.assertNotEqual(result.returncode, 0)
   self.assertNotIn("\033[0;32m", result.stdout)
if __name__ == "__main__": unittest.main()
