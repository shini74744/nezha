"""Installer safety tests. All downloads/services are stubbed in a temp directory."""
import hashlib, os, pathlib, shutil, subprocess, tempfile, unittest, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
class InstallerTest(unittest.TestCase):
    def run_case(self, existing=False, corrupt=False, fail_download=False, fail_install=False, args=(), pointer="v1.0.1", binary_version="1.0.1"):
        with tempfile.TemporaryDirectory(prefix="owned-installer-test-") as base:
            base = pathlib.Path(base)
            installed = base / "installed"
            installed.mkdir()
            log = base / "calls"
            old = '#!/bin/sh\necho "old $*" >> "$CALL_LOG"\n'
            if existing:
                (installed / ".DDnezha-owned").write_text("DDnezha\n")
                (installed / "DDnezha").write_text(old)
                (installed / "DDnezha").chmod(0o755)
                (installed / "config.yml").write_text("uuid: keep-this-uuid\nclient_secret: keep-secret\n")
            binary = base / "DDnezha"
            binary.write_text('#!/bin/sh\necho "new $*" >> "$CALL_LOG"\nif [ "$1" = -v ]; then echo "DDnezha version $FIXTURE_VERSION"; fi\nif [ "$1" = service ] && [ "$2" = install ] && [ "$FAIL_INSTALL" = 1 ]; then exit 1; fi\n')
            archive = base / "fixture.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.write(binary, "DDnezha")
            digest = "0"*64 if corrupt else hashlib.sha256(archive.read_bytes()).hexdigest()
            (base / "fixture.sha256").write_text(digest+"\n")
            mockbin = base / "bin"
            mockbin.mkdir()
            curl = mockbin / "curl"
            curl.write_text('#!/usr/bin/env python3\nimport os,sys,shutil\na=sys.argv; u=next(x for x in a if x.startswith("https:")); assert u=="https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt" or u.startswith("https://github.com/shini74744/nezha/releases/download/agent-v1.0.1/DDnezha_"); assert "nezhahq" not in u\nif os.environ["FAIL_DOWNLOAD"]=="1": sys.exit(22)\nif u.endswith("/agent-version.txt"): open(a[a.index("-o")+1],"w").write(os.environ["POINTER"]+"\\n"); sys.exit(0)\nshutil.copyfile(os.environ["FIXTURE"]+(".sha256" if u.endswith(".sha256") else ".zip"),a[a.index("-o")+1])\n')
            curl.chmod(0o755)
            script = base / "install.sh"
            source = (ROOT / "scripts/install.sh").read_text()
            self.assertEqual(source.count("dir=/opt/DDnezha"), 1)
            script.write_text(source.replace("dir=/opt/DDnezha", "dir="+str(installed)))
            env = dict(os.environ, PATH=str(mockbin)+":"+os.environ["PATH"], FIXTURE=str(base/"fixture"),
                       CALL_LOG=str(log), FAIL_INSTALL=str(int(fail_install)), FAIL_DOWNLOAD=str(int(fail_download)),
                       DDNZ_SERVER="fixture.invalid:443", DDNZ_CLIENT_SECRET="fixture-secret", POINTER=pointer, FIXTURE_VERSION=binary_version)
            result = subprocess.run(["sh", str(script), *args], env=env, capture_output=True, text=True)
            invalid_pointer = pointer != "v1.0.1"
            wrong_version = binary_version != "1.0.1"
            failed = corrupt or fail_download or fail_install or invalid_pointer or wrong_version
            self.assertEqual(result.returncode != 0, failed, result.stdout+result.stderr)
            self.assertNotIn("下载来源", result.stdout)
            if not failed:
                self.assertEqual("已有配置或旧程序备份：" in result.stdout, existing)
            if corrupt or fail_download or invalid_pointer or wrong_version:
                if not wrong_version: self.assertFalse(log.exists())
                elif log.exists(): self.assertNotIn("service", log.read_text())
                if existing: self.assertEqual((installed/"DDnezha").read_text(), old)
            elif fail_install and existing:
                self.assertEqual((installed/"DDnezha").read_text(), old)
                self.assertIn("old service start", log.read_text())
            else:
                self.assertIn("new service install", log.read_text())
                self.assertIn("new service start", log.read_text())
            if existing:
                self.assertEqual((installed/"config.yml").read_text(), "uuid: keep-this-uuid\nclient_secret: keep-secret\n")
    def test_invalid_pointer_never_runs_services(self):
        for value in ("", "agent-v1.0.1", "v1.0.1-rc.1", "../v1.0.1", "v01.0.1", "v1.0.1;false"):
            with self.subTest(pointer=value): self.run_case(existing=True, pointer=value)
    def test_binary_version_mismatch_preserves_existing(self): self.run_case(existing=True, binary_version="0.0.3")
    def test_new_install(self): self.run_case()
    def test_explicit_install(self): self.run_case(args=("install",))
    def test_existing_config_and_uuid_preserved(self): self.run_case(existing=True)
    def test_checksum_failure_does_not_touch_existing(self): self.run_case(existing=True, corrupt=True)
    def test_download_failure_does_not_touch_existing(self): self.run_case(existing=True, fail_download=True)
    def test_failed_service_restores_previous_binary(self): self.run_case(existing=True, fail_install=True)

if __name__ == "__main__": unittest.main()
