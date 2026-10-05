#!/usr/bin/env python3
"""Run the full POSIX installer in a temp tree; no real Agent/service/network is used."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("install.sh")
SHELLS = [("/bin/sh",), ("/bin/dash",), ("/bin/bash",), ("/bin/busybox", "sh")]


class UninstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agent-uninstall-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.installed = self.root / "Agent files"
        self.installed.mkdir()
        self.mockbin = self.root / "bin"
        self.mockbin.mkdir()
        self.log = self.root / "calls.jsonl"
        self.script = self.root / "agent.sh"
        source = SCRIPT.read_text()
        self.assertEqual(source.count("dir=/opt/nezha/agent"), 1)
        self.script.write_text(source.replace("dir=/opt/nezha/agent", "dir=" + shlex.quote(str(self.installed))))
        self.script.chmod(0o755)
        self.env = {
            "PATH": str(self.mockbin),
            "CALL_LOG": str(self.log),
            "FAIL_CONFIG": "",
            "FAIL_STOP": "0",
        }
        self.tool("id", "#!/bin/sh\necho 0\n")
        # Only removal of temporary fixture files is available through PATH.
        (self.mockbin / "rm").symlink_to(shutil.which("rm"))
        self.agent = self.installed / "nezha-agent"
        self.agent.write_text(
            "#!" + sys.executable + "\n"
            "import json, os, sys\n"
            "with open(os.environ['CALL_LOG'], 'a') as f: f.write(json.dumps(sys.argv[1:]) + '\\n')\n"
            "assert len(sys.argv) == 5 and sys.argv[1:3] == ['service', '-c'], sys.argv\n"
            "assert sys.argv[4] in ('stop', 'uninstall'), sys.argv\n"
            "if sys.argv[4] == 'stop' and os.environ['FAIL_STOP'] == '1': sys.exit(1)\n"
            "if sys.argv[4] == 'uninstall' and os.path.basename(sys.argv[3]) == os.environ['FAIL_CONFIG']: sys.exit(1)\n"
        )
        self.agent.chmod(0o755)

    def tool(self, name, content):
        path = self.mockbin / name
        path.write_text(content)
        path.chmod(0o755)
        return path

    def config(self, name="config.yml"):
        path = self.installed / name
        path.write_text("uuid: fixture-uuid\nclient_secret: fixture-only\n")
        return path

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def run_script(self, args=("uninstall",), shell=("/bin/sh",)):
        return subprocess.run([*shell, str(self.script), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_uninstall_stops_service_then_removes_config(self):
        config = self.config()
        original_binary = self.agent.read_bytes()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls(), [
            ["service", "-c", str(config), "stop"],
            ["service", "-c", str(config), "uninstall"],
        ])
        self.assertFalse(config.exists())
        self.assertEqual(self.agent.read_bytes(), original_binary)
        self.assertIn("卸载完成", result.stdout)
        self.assertNotIn("安装脚本", result.stdout)

    def test_multiple_instances_do_not_touch_backups_or_unrelated_files(self):
        configs = [self.config(name) for name in ("config.yml", "config-second.yml", "my config.yml")]
        backup = self.installed / "backup.fixture"
        backup.mkdir()
        (backup / "config.yml").write_text("saved config")
        unrelated = self.installed / "settings.yml"
        unrelated.write_text("keep me")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(all(not path.exists() for path in configs))
        self.assertEqual(len(self.calls()), 6)
        self.assertEqual((backup / "config.yml").read_text(), "saved config")
        self.assertEqual(unrelated.read_text(), "keep me")
        self.assertTrue(self.agent.exists())

    def test_repeated_uninstall_is_noop(self):
        self.config()
        self.assertEqual(self.run_script().returncode, 0)
        calls = self.calls()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("无需卸载", result.stdout)
        self.assertEqual(self.calls(), calls)

    def test_not_installed_is_noop(self):
        self.agent.unlink()
        self.installed.rmdir()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("未改动任何服务", result.stdout)
        self.assertEqual(self.calls(), [])

    def test_missing_or_non_executable_binary_preserves_config(self):
        config = self.config()
        self.agent.chmod(0o600)
        for missing in (False, True):
            with self.subTest(missing=missing):
                if missing:
                    self.agent.unlink()
                result = self.run_script()
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(config.exists())
                self.assertNotIn("卸载完成", result.stdout)
                self.assertEqual(self.calls(), [])

    def test_service_failure_preserves_failed_config_and_reports_partial_failure(self):
        failed = self.config("config-failed.yml")
        successful = self.config()
        self.env["FAIL_CONFIG"] = failed.name
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(failed.exists())
        self.assertFalse(successful.exists())
        self.assertIn("已保留配置", result.stderr)
        self.assertNotIn("卸载完成", result.stdout)

    def test_already_stopped_service_can_uninstall(self):
        config = self.config()
        self.env["FAIL_STOP"] = "1"
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(config.exists())

    def test_config_removal_failure_is_reported(self):
        (self.mockbin / "rm").unlink()
        self.tool("rm", "#!/bin/sh\nexit 1\n")
        config = self.config()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(config.exists())
        self.assertIn("配置删除失败", result.stderr)
        self.assertNotIn("卸载完成", result.stdout)

    def test_symlinked_config_is_rejected(self):
        external = self.root / "external.yml"
        external.write_text("do not touch")
        config = self.installed / "config.yml"
        config.symlink_to(external)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(external.read_text(), "do not touch")
        self.assertTrue(config.is_symlink())
        self.assertEqual(self.calls(), [])

    def test_symlinked_binary_is_rejected(self):
        config = self.config()
        target = self.root / "external-agent"
        self.agent.rename(target)
        self.agent.symlink_to(target)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(config.exists())
        self.assertEqual(self.calls(), [])

    def test_symlinked_directory_is_rejected(self):
        self.config()
        target = self.root / "external-directory"
        self.installed.rename(target)
        self.installed.symlink_to(target, target_is_directory=True)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((target / "config.yml").exists())
        self.assertEqual(self.calls(), [])

    def test_no_network_dependency_or_install_settings_required(self):
        # PATH has no uname/curl/unzip/hash utilities, and no NZ_* settings.
        self.config()
        self.assertEqual(self.run_script().returncode, 0)

    def test_unknown_or_extra_args_fail_before_privilege_or_installation(self):
        self.config()
        (self.mockbin / "id").unlink()
        for args in [("uninstal",), ("--unknown",), ("uninstall", "extra"), ("install", "extra")]:
            with self.subTest(args=args):
                result = self.run_script(args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Usage:", result.stderr)
                self.assertEqual(self.calls(), [])

    def test_help_does_not_require_root_or_installation(self):
        (self.mockbin / "id").unlink()
        for args in [("--help",), ("-h",)]:
            with self.subTest(args=args):
                result = self.run_script(args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("uninstall", result.stdout)
                self.assertEqual(self.calls(), [])

    def test_posix_shell_matrix(self):
        for shell in SHELLS:
            with self.subTest(shell=shell):
                self.assertTrue(Path(shell[0]).exists(), "required test shell missing")
                config = self.config()
                result = self.run_script(shell=shell)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(config.exists())


if __name__ == "__main__":
    unittest.main()
