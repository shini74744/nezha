"""Full DDnezha installer and uninstall isolation in disposable trees, without real services."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).with_name("install.sh").read_text()

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="DDnezha-isolation-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.owned = self.root / "opt/DDnezha"
        self.official = self.root / "opt/nezha/agent"
        self.official.mkdir(parents=True)
        for name, content in {"nezha-agent":"official binary", "config.yml":"official config", "agent.sh":"official installer"}.items():
            (self.official/name).write_text(content)
        self.original = self.snapshot(self.official)
        self.log = self.root / "calls.jsonl"
        self.mock = self.root / "bin"
        self.mock.mkdir()
        binary = self.root / "DDnezha"
        binary.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
if sys.argv[1:]==['-v']:
 print('DDnezha version 1.0.2');sys.exit()
root=Path(sys.argv[0]).parent
with open(os.environ['CALL_LOG'],'a') as f:f.write(json.dumps(sys.argv)+'\\n')
cfg=Path(sys.argv[3]) if sys.argv[1:3]==['service','-c'] else root/'config.yml'
assert cfg.parent==root
action=sys.argv[-1]
if action=='install':
 if not cfg.exists():
  cfg.write_text(json.dumps({k:os.environ.get('DDNZ_'+k,'') for k in ['UUID','CLIENT_SECRET','SERVER']}))
elif action=='uninstall':
 assert cfg.exists()
""")
        with zipfile.ZipFile(self.root/"package.zip","w") as z:z.write(binary,"DDnezha")
        (self.root/"checksum").write_text(hashlib.sha256((self.root/"package.zip").read_bytes()).hexdigest()+"\n")
        curl=self.mock/"curl"
        curl.write_text("""#!/usr/bin/env python3
import os,sys,shutil
from pathlib import Path
a=sys.argv;url=next(x for x in a if x.startswith('https:'));out=a[a.index('-o')+1]
assert url.startswith('https://raw.githubusercontent.com/shini74744/nezha/') or url.startswith('https://github.com/shini74744/nezha/releases/download/agent-v1.0.2/DDnezha_'),url
if url.endswith('agent-version.txt'):Path(out).write_text('v1.0.2\\n')
else:shutil.copyfile(Path(os.environ['FIXTURE'])/('checksum' if url.endswith('.sha256') else 'package.zip'),out)
""")
        curl.chmod(0o755)
        self.script=self.root/"agent.sh"
        self.script.write_text(SOURCE.replace("dir=/opt/DDnezha","dir="+shlex.quote(str(self.owned))))
        self.env={**os.environ,"PATH":str(self.mock)+":"+os.environ["PATH"],"FIXTURE":str(self.root),"CALL_LOG":str(self.log),
                  "DDNZ_SERVER":"own.invalid:443","DDNZ_CLIENT_SECRET":"own-test-key","DDNZ_UUID":"11111111-1111-4111-8111-111111111111",
                  "NZ_SERVER":"official.invalid:443","NZ_CLIENT_SECRET":"official-key","NZ_UUID":"22222222-2222-4222-8222-222222222222"}
    def snapshot(self,path):
        return {str(p.relative_to(path)):p.read_bytes() for p in path.rglob("*") if p.is_file()}
    def run_script(self,action,success=True):
        result=subprocess.run(["sh",str(self.script),action],env=self.env,capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode==0,success,result.stdout+result.stderr)
        return result
    def test_install_repeat_and_uninstall_leave_official_untouched(self):
        self.run_script("install")
        cfg=(self.owned/"config.yml").read_bytes()
        self.assertEqual(json.loads(cfg)["CLIENT_SECRET"],"own-test-key")
        self.run_script("install")
        self.assertEqual((self.owned/"config.yml").read_bytes(),cfg)
        self.run_script("uninstall")
        self.assertFalse((self.owned/"config.yml").exists())
        self.assertEqual(self.snapshot(self.official),self.original)
        self.run_script("uninstall")
        for call in map(json.loads,self.log.read_text().splitlines()):
            self.assertEqual(Path(call[0]),self.owned/"DDnezha")
    def test_official_cleanup_scope_cannot_reach_owned_installation(self):
        self.run_script("install")
        owned_before=self.snapshot(self.owned)
        # Same recursive configuration scope as the current official POSIX script.
        for config in self.official.rglob("*config*.yml"):config.unlink()
        self.assertEqual(self.snapshot(self.owned),owned_before)
        self.run_script("uninstall")
    def test_unknown_existing_directory_is_not_adopted(self):
        self.owned.mkdir(parents=True)
        (self.owned/"config.yml").write_text("unknown owner")
        before=self.snapshot(self.owned)
        self.run_script("install",False)
        self.run_script("uninstall",False)
        self.assertEqual(self.snapshot(self.owned),before)
        self.assertFalse(self.log.exists())
    def test_directory_link_to_official_is_rejected(self):
        self.owned.symlink_to(self.official,target_is_directory=True)
        self.run_script("install",False)
        self.run_script("uninstall",False)
        self.assertEqual(self.snapshot(self.official),self.original)
        self.assertFalse(self.log.exists())
    def test_saved_installer_is_executable_repeatable_and_preserves_legacy_file(self):
        self.owned.mkdir(parents=True)
        legacy=self.owned/"DDnezha.sh"
        legacy.write_text("previous own script retained")
        self.run_script("install")
        saved=self.owned/"agent.sh"
        self.assertEqual(saved.read_bytes(),self.script.read_bytes())
        self.assertTrue(saved.stat().st_mode & 0o111)
        self.script=saved
        self.run_script("install")
        self.run_script("uninstall")
        self.assertEqual(legacy.read_text(),"previous own script retained")
        self.assertTrue(saved.exists())
        self.assertEqual(self.snapshot(self.official),self.original)
    def test_unknown_saved_installer_refused_before_service_changes(self):
        self.run_script("install")
        saved=self.owned/"agent.sh"
        saved.write_text("foreign installer")
        before=self.snapshot(self.owned)
        calls=self.log.read_bytes()
        self.run_script("install",False)
        self.assertEqual(self.snapshot(self.owned),before)
        self.assertEqual(self.log.read_bytes(),calls)
    def test_saved_installer_link_to_official_is_refused(self):
        self.owned.mkdir(parents=True)
        (self.owned/"agent.sh").symlink_to(self.official/"agent.sh")
        self.run_script("install",False)
        self.assertEqual(self.snapshot(self.official),self.original)
        self.assertFalse(self.log.exists())
    def test_saved_installer_dangling_link_is_refused(self):
        self.owned.mkdir(parents=True)
        (self.owned/"agent.sh").symlink_to(self.official/"missing.sh")
        self.run_script("install",False)
        self.assertFalse((self.official/"missing.sh").exists())
        self.assertFalse(self.log.exists())
    def test_missing_marker_never_calls_service(self):
        self.run_script("install")
        (self.owned/".DDnezha-owned").unlink()
        before=self.log.read_bytes()
        self.run_script("uninstall",False)
        self.assertEqual(self.log.read_bytes(),before)

if __name__=="__main__":unittest.main()
