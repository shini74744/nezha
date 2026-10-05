"""Execute cleanup templates only against disposable fixtures and fake services."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name("uninstall.sh").read_text()
UUID = "12345678-1234-1234-1234-123456789abc"
OTHER = "22345678-1234-1234-1234-123456789abc"


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nezha-cleanup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.agent = self.root / "Agent files"
        self.agent.mkdir()
        self.work = self.root / "worker"
        self.work.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.env = dict(os.environ, PATH=str(self.bin) + ":" + os.environ["PATH"],
                        CALL_LOG=str(self.log), FAIL_ACTION="")
        self.binary = self.agent / "nezha-agent"
        self.binary.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n[ "$4" != "$FAIL_ACTION" ]\n')
        self.binary.chmod(0o755)
        self.tool("id", "echo 0")
        self.tool("sleep", ":")
        self.assertEqual(SOURCE.count("dir=/opt/nezha/agent"), 2)
        self.source = SOURCE.replace("dir=/opt/nezha/agent", "dir=" + shlex.quote(str(self.agent)))
        self.assertNotIn("/opt/nezha/agent", self.source)
        self.source = self.source.replace("__UUID__", UUID)

    def tool(self, name, body):
        tool = self.bin / name
        tool.write_text("#!/bin/sh\n" + body + "\n")
        tool.chmod(0o755)
        return tool

    def config(self, name="config.yml", uuid=UUID):
        path = self.agent / name
        path.write_text('uuid: "' + uuid + '"\nclient_secret: fixture-only\n')
        return path

    def run_worker(self, shell="sh"):
        body = self.source.split("<<'NZ_CLEANUP_WORKER'\n", 1)[1].split("\nNZ_CLEANUP_WORKER", 1)[0]
        script = self.work / "run.sh"
        script.write_text(body)
        return subprocess.run([shell, str(script), UUID, str(self.work), "fixture-job", "setsid"],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def test_cleanup_removes_own_files_and_keeps_unknown_data(self):
        config = self.config()
        backup = self.agent / "backup.fixture"
        backup.mkdir()
        (backup / "config.yml").write_text("uuid: " + UUID)
        (backup / "nezha-agent").write_text("old binary")
        unrelated = self.agent / "business.db"
        unrelated.write_text("must survive")
        installer = self.agent / "agent.sh"
        installer.write_text("# NZ_CLIENT_SECRET nezha-agent\n")
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(config.exists())
        self.assertFalse(self.binary.exists())
        self.assertFalse(installer.exists())
        self.assertFalse(backup.exists())
        self.assertEqual(unrelated.read_text(), "must survive")
        calls = self.log.read_text().splitlines()
        self.assertEqual(calls, ["service -c " + str(config) + " stop", "service -c " + str(config) + " uninstall"])

    def test_other_instance_keeps_shared_binary_and_installer(self):
        self.config()
        other = self.config("config-other.yml", OTHER)
        installer = self.agent / "agent.sh"
        installer.write_text("# NZ_CLIENT_SECRET nezha-agent")
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(other.exists())
        self.assertTrue(self.binary.exists())
        self.assertTrue(installer.exists())

    def test_wrong_uuid_has_no_destructive_effect(self):
        config = self.config(uuid=OTHER)
        result = self.run_worker()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(config.exists())
        self.assertTrue(self.binary.exists())
        self.assertFalse(self.log.exists())

    def test_stop_or_unregister_failure_keeps_data(self):
        config = self.config()
        for action in ("stop", "uninstall"):
            with self.subTest(action=action):
                self.env["FAIL_ACTION"] = action
                result = self.run_worker()
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(config.exists())
                self.assertTrue(self.binary.exists())

    def test_symlink_backup_and_foreign_backup_are_not_deleted(self):
        self.config()
        foreign = self.agent / "backup.foreign"
        foreign.mkdir()
        (foreign / "config.yml").write_text("uuid: " + OTHER)
        outside = self.root / "external"
        outside.mkdir()
        (outside / "config.yml").write_text("uuid: " + UUID)
        (self.agent / "backup.link").symlink_to(outside, target_is_directory=True)
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((foreign / "config.yml").exists())
        self.assertTrue((outside / "config.yml").exists())

    def test_symlink_config_is_not_followed(self):
        outside = self.root / "external-config"
        outside.write_text("uuid: " + UUID)
        (self.agent / "config.yml").symlink_to(outside)
        result = self.run_worker()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(outside.exists())
        self.assertFalse(self.log.exists())

    def test_worker_shell_matrix(self):
        for shell in ("sh", "dash", "bash"):
            with self.subTest(shell=shell):
                self.config()
                self.config("config-other.yml", OTHER)
                result = self.run_worker(shell)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.work.mkdir(exist_ok=True)

    def test_bootstrap_all_posix_launchers(self):
        self.config()
        # All launcher stubs only create ready; never execute cleanup.
        self.tool("mktemp", 'printf "%s\\n" "$FIXTURE_WORK"')
        self.env["FIXTURE_WORK"] = str(self.work)
        ready = 'touch "$FIXTURE_WORK/ready"'
        for name in ("systemd-run", "setsid", "launchctl", "daemon"):
            self.tool(name, ready)
        for osname, systemd in (("Linux", True), ("Linux", False), ("Darwin", False), ("FreeBSD", False)):
            with self.subTest(os=osname, systemd=systemd):
                self.tool("uname", "echo " + osname)
                (self.work / "ready").unlink(missing_ok=True)
                source = self.source.replace("[ -d /run/systemd/system ]", "true" if systemd else "false")
                result = subprocess.run(["sh", "-c", source], env=self.env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("NZ_UNINSTALL_STARTED", result.stdout)
                self.assertTrue(self.binary.exists())
                self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
