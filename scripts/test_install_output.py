#!/usr/bin/env python3
"""Test the actual final install block with a fake Agent; no service is changed."""
import os, subprocess, tempfile, unittest
from pathlib import Path
SCRIPT = Path(__file__).with_name("install.sh")
class OutputTests(unittest.TestCase):
 def run_output(self, fail="", backups=()):
  with tempfile.TemporaryDirectory(prefix="agent-output-test-") as td:
   backup = Path(td) / "backup"
   backup.mkdir()
   for name in backups:
    (backup / name).write_text("fixture")
   binary = Path(td) / "fake-agent"
   binary.write_text('#!/bin/sh\n[ "$2" != "$TEST_FAIL" ]\n')
   binary.chmod(0o755)
   source = SCRIPT.read_text()
   tail = source[source.rindex('if [ -f "$binary" ]; then'):]
   prefix = 'set -e\nbinary="$TEST_BINARY"\nbackup="$TEST_BACKUP"\ntmp=/test/tmp\ninstall() { :; }\nrollback() { echo "Installation failed" >&2; exit 1; }\n'
   return subprocess.run(["sh", "-c", prefix + tail], capture_output=True, text=True,
    env={**os.environ, "TEST_BINARY": str(binary), "TEST_BACKUP": str(backup), "TEST_FAIL": fail})
 def test_green_success(self):
  result = self.run_output()
  self.assertEqual(result.returncode, 0, result.stderr)
  self.assertIn("\033[0;32m", result.stdout)
  self.assertIn("安装成功，服务已启动", result.stdout)
  self.assertIn("\033[0m", result.stdout)
  self.assertIn("不代表认证或连接成功", result.stdout)
 def test_new_install_has_no_backup_or_source_hint(self):
  result = self.run_output()
  self.assertEqual(result.returncode, 0, result.stderr)
  self.assertNotIn("备份：", result.stdout)
  self.assertNotIn("下载来源", result.stdout)
  self.assertNotIn("shini74744/agent", result.stdout)
 def test_existing_files_show_backup(self):
  for backups in [("nezha-agent",), ("config.yml",), ("nezha-agent", "config.yml")]:
   with self.subTest(backups=backups):
    result = self.run_output(backups=backups)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertIn("已有配置或旧程序备份：", result.stdout)
    self.assertNotIn("下载来源", result.stdout)
 def test_no_success_on_failure(self):
  for action in ["install", "start"]:
   result = self.run_output(action)
   self.assertNotEqual(result.returncode, 0)
   self.assertNotIn("\033[0;32m", result.stdout)
if __name__ == "__main__": unittest.main()
