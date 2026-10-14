#!/usr/bin/env python3
"""Test real download/checksum blocks using local fixtures, never install an Agent."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("install.sh")
GREEN = "\033[0;32m"
RESET = "\033[0m"
MESSAGES = ["校验文件下载成功", "Agent 程序下载成功", "Agent 文件 SHA-256 校验成功"]

class ProgressTests(unittest.TestCase):
    def run_downloads(self, failure="", checksum=None, shell=("sh",), system="Linux", cpu="x86_64", hash_tool="sha256sum"):
        source = SCRIPT.read_text()
        platform = source[source.index('case "$(uname -s)" in'):source.index('for tool in curl unzip; do')]
        block = platform + source[source.index('asset='):source.index('unzip -p')]
        with tempfile.TemporaryDirectory(prefix="agent-progress-test-") as td:
            fixture = Path(td) / "fixture"
            fixture.write_bytes(b"local Agent archive fixture")
            digest = checksum if checksum is not None else hashlib.sha256(fixture.read_bytes()).hexdigest()
            prefix = '''set -eu
tmp="$TEST_TMP"
hash_tool="$TEST_HASH_TOOL"
uname() { case "$1" in -s) printf '%s' "$TEST_SYSTEM";; -m) printf '%s' "$TEST_CPU";; esac; }
# FreeBSD's sha256 is unavailable on this Linux runner: adapt its -q interface.
sha256() { [ "$1" = -q ]; sha256sum "$2" | awk '{print $1}'; }
curl() {
 case "$*" in
  *.sha256*) [ "$TEST_FAIL" != checksum ] || return 22
             printf '%s\\n' "$TEST_DIGEST" > "$tmp/checksum" ;;
  *) [ "$TEST_FAIL" != archive ] || return 22
     cp "$TEST_FIXTURE" "$tmp/agent.zip" ;;
 esac
}
'''
            return subprocess.run([*shell, "-c", prefix + block], capture_output=True, text=True,
                env={**os.environ, "TEST_TMP": td, "TEST_FIXTURE": str(fixture),
                     "TEST_DIGEST": digest, "TEST_FAIL": failure, "TEST_SYSTEM": system,
                     "TEST_CPU": cpu, "TEST_HASH_TOOL": hash_tool})

    def test_script_ready_is_green(self):
        source = SCRIPT.read_text().split('case "$(uname -s)" in')[0]
        result = subprocess.run(["sh", "-c", "id() { echo 0; };\n" + source],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, GREEN + "安装脚本 agent.sh 已就绪" + RESET + "\n")

    def test_success_messages_are_green_and_ordered(self):
        result = self.run_downloads()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "".join(GREEN + m + RESET + "\n" for m in MESSAGES))

    def test_failed_download_never_claims_success(self):
        for failure, count in [("checksum", 0), ("archive", 1)]:
            with self.subTest(failure=failure):
                result = self.run_downloads(failure=failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "".join(GREEN + m + RESET + "\n" for m in MESSAGES[:count]))

    def test_invalid_checksum_never_claims_verified(self):
        for digest in ["broken", "g" * 64, "0" * 64]:
            with self.subTest(digest=digest):
                result = self.run_downloads(checksum=digest)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "".join(GREEN + m + RESET + "\n" for m in MESSAGES[:2]))
                self.assertNotIn(MESSAGES[2], result.stdout)

    def test_cross_platform_shell_matrix(self):
        cases = [("Linux", "x86_64", "sha256sum"), ("Linux", "aarch64", "sha256sum"),
                 ("Darwin", "x86_64", "shasum"), ("Darwin", "arm64", "shasum"),
                 ("FreeBSD", "amd64", "sha256"), ("FreeBSD", "arm64", "sha256")]
        for shell in [("sh",), ("dash",), ("bash",), ("busybox", "sh")]:
            for system, cpu, hash_tool in cases:
                for failure, digest, expected_count in [("", None, 3), ("checksum", None, 0),
                                                       ("archive", None, 1), ("", "0" * 64, 2)]:
                    with self.subTest(shell=shell, system=system, cpu=cpu, failure=failure, digest=digest):
                        result = self.run_downloads(failure, digest, shell, system, cpu, hash_tool)
                        self.assertEqual(result.returncode == 0, expected_count == 3, result.stderr)
                        self.assertEqual(result.stdout, "".join(GREEN + m + RESET + "\n" for m in MESSAGES[:expected_count]))

if __name__ == "__main__":
    unittest.main()
