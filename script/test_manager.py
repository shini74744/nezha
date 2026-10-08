#!/usr/bin/env python3
"""Offline regression tests: no real network, systemd or production files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name("nezha.sh")
VERSION = "custom-2026.10.08.test"
STUB = r'''#!/usr/bin/env python3
import json,os,sys,shutil
from pathlib import Path
root=Path(os.environ["FAKE_ROOT"])
p=root/"state.json"
s=json.loads(p.read_text())
cmd=Path(sys.argv[0]).name
args=sys.argv[1:]
s["commands"].append([cmd]+args)
result=0
if cmd=="id":
 print("0")
elif cmd=="sleep": pass
elif cmd=="systemctl":
 if "show" in args:
  prop=args[args.index("-p")+1]
  print({"ActiveState":s["active"],"InvocationID":"a"*32,"Result":s.get("result","success"),"ExecMainStatus":"0","MainPID":"0" if s["active"] in ("inactive","failed") else "123"}[prop])
 elif "stop" in args:
  s["active"]="deactivating" if "--no-block" in args else "inactive";s["journal_reads"]=0
 elif "start" in args:
  s["starts"]+=1
  s["active"]="failed" if s.get("fail_first_start") and s["starts"]==1 else "active"
elif cmd=="journalctl":
 s["journal_reads"]+=1
 phases=["REPORT_ADMISSION_CLOSED","FINALIZING_STORAGE","REPORTS_PERSISTED_STORAGE_CLOSED","END"]
 for phase in phases[:min(s["journal_reads"],4)]: print("NEZHA>> Graceful::"+phase)
 if s.get("incomplete"):print("NEZHA>> Graceful::INCOMPLETE: persistence failed")
 if s["journal_reads"]>=4:s["active"]="inactive"
elif cmd=="curl":
 url=next(a for a in args if a.startswith("http"))
 output=args[args.index("-o")+1]
 if url.startswith("http://127.0.0.1:"):
  result=0 if s["active"]=="active" else 7
 else:
  assert url.startswith("https://github.com/shini74744/nezha/releases/"),url
  asset=url.rsplit("/",1)[1]
  if s.get("download_failure"):result=22
  else:shutil.copyfile(root/"assets"/asset,output)
else: raise AssertionError(cmd)
p.write_text(json.dumps(s))
sys.exit(result)
'''

class ManagerTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix="nezha-manager-test-")
  self.root=Path(self.temp.name)
  self.base=self.root/"nezha";self.dash=self.base/"dashboard"
  (self.dash/"data").mkdir(parents=True)
  (self.dash/"data"/"config.yaml").write_text("listen_port: 8008\n")
  (self.dash/"data"/"sqlite.db").write_bytes(b"existing-user-data")
  (self.dash/"data"/"terminal-commands.key").write_bytes(b"test-only-encryption-key"*2)
  self.old=b"#!/bin/sh\necho old-version\n"
  (self.dash/"app").write_bytes(self.old);(self.dash/"app").chmod(0o755)
  self.assets=self.root/"assets";self.assets.mkdir()
  app=("#!/bin/sh\necho "+VERSION+"\n").encode()
  with zipfile.ZipFile(self.assets/"dashboard-linux-amd64.zip","w") as z:z.writestr("dashboard-linux-amd64",app)
  (self.assets/"version.txt").write_text(VERSION+"\n")
  (self.assets/"nezha.sh").write_bytes(SCRIPT.read_bytes())
  self.make_checksums()
  self.bin=self.root/"bin";self.bin.mkdir()
  for cmd in ("curl","systemctl","journalctl","id","sleep"):
   f=self.bin/cmd;f.write_text(STUB);f.chmod(0o755)
  self.state={"active":"active","starts":0,"commands":[]}
  self.save()
  self.env=dict(os.environ,FAKE_ROOT=str(self.root),NZ_BASE_PATH=str(self.base),PATH=str(self.bin)+os.pathsep+os.environ["PATH"])
 def tearDown(self):self.temp.cleanup()
 def save(self):(self.root/"state.json").write_text(json.dumps(self.state))
 def load(self):return json.loads((self.root/"state.json").read_text())
 def make_checksums(self):
  (self.assets/"SHA256SUMS").write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest()+"  "+p.name+"\n" for p in self.assets.iterdir() if p.name!="SHA256SUMS"))
 def run_manager(self,*args):
  return subprocess.run(["bash",str(SCRIPT),*args],env=self.env,text=True,capture_output=True,timeout=20)
 def test_restart_reports_real_phases_and_starts_after_stop(self):
  p=self.run_manager("restart")
  self.assertEqual(p.returncode,0,p.stdout+p.stderr)
  s=self.load();self.assertEqual(s["starts"],1)
  self.assertIn("停止 2/4",p.stdout);self.assertIn("停止 4/4",p.stdout);self.assertIn("重启完成",p.stdout)
  self.assertLess(p.stdout.index("面板已停止"),p.stdout.index("正在启动"))
  self.assertEqual((self.dash/"app").read_bytes(),self.old)
 def test_download_failure_never_stops_service(self):
  self.state["download_failure"]=True;self.save()
  p=self.run_manager("update");self.assertNotEqual(p.returncode,0)
  self.assertFalse(any("stop" in c for c in self.load()["commands"]))
  self.assertEqual((self.dash/"app").read_bytes(),self.old)
 def test_checksum_failure_never_stops_service(self):
  (self.assets/"dashboard-linux-amd64.zip").write_bytes(b"tampered")
  p=self.run_manager("restart_and_update");self.assertNotEqual(p.returncode,0)
  self.assertFalse(any("stop" in c for c in self.load()["commands"]))
  self.assertIn("校验失败",p.stdout+p.stderr)
 def test_successful_update_preserves_database_and_backup(self):
  p=self.run_manager("update");self.assertEqual(p.returncode,0,p.stdout+p.stderr)
  self.assertIn(VERSION,(self.dash/"app").read_text())
  self.assertEqual((self.dash/"data"/"sqlite.db").read_bytes(),b"existing-user-data")
  backups=list((self.base/"backups").glob("*/app.previous"))
  self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),self.old)
  self.assertEqual((backups[0].parent/"terminal-commands.key").read_bytes(),(self.dash/"data"/"terminal-commands.key").read_bytes())
 def test_failed_start_rolls_back_binary_without_replacing_data(self):
  self.state["fail_first_start"]=True;self.save()
  p=self.run_manager("update");self.assertNotEqual(p.returncode,0,p.stdout+p.stderr)
  self.assertEqual((self.dash/"app").read_bytes(),self.old)
  self.assertEqual((self.dash/"data"/"sqlite.db").read_bytes(),b"existing-user-data")
  self.assertEqual(self.load()["starts"],2)
  self.assertIn("已恢复旧程序",p.stdout+p.stderr)
 def test_bad_stop_does_not_restart(self):
  self.state["result"]="exit-code";self.save()
  p=self.run_manager("restart");self.assertNotEqual(p.returncode,0)
  self.assertEqual(self.load()["starts"],0)
 def test_incomplete_persistence_never_reports_restart_success(self):
  self.state["incomplete"]=True;self.save()
  p=self.run_manager("restart");self.assertNotEqual(p.returncode,0)
  self.assertEqual(self.load()["starts"],0)
  self.assertNotIn("重启完成",p.stdout)
 def test_unit_preserves_internal_restart_and_explicit_stop_behavior(self):
  unit=SCRIPT.with_name("nezha-dashboard.service").read_text()
  for setting in ("Restart=always","RestartSec=3s","StartLimitIntervalSec=0","TimeoutStopSec=90s","WantedBy=multi-user.target"):
   self.assertIn(setting,unit)
 def test_script_update_is_own_source_and_does_not_restart(self):
  p=self.run_manager("update_script");self.assertEqual(p.returncode,0,p.stdout+p.stderr)
  self.assertEqual((self.base/"nezha.sh").read_bytes(),SCRIPT.read_bytes())
  self.assertEqual(self.load()["starts"],0)
  self.assertFalse(any("stop" in c for c in self.load()["commands"]))
 def test_source_has_no_upstream_or_unverified_mirror(self):
  for name in ("nezha.sh","install.sh","install_en.sh"):
   source=SCRIPT.with_name(name).read_text()
   for forbidden in ("nezhahq/nezha","nezhahq/scripts","naibahq/","gitee.com","jsdelivr"):
    self.assertNotIn(forbidden,source)
 def test_install_refuses_existing_data(self):
  p=self.run_manager("install");self.assertNotEqual(p.returncode,0)
  self.assertEqual((self.dash/"data"/"sqlite.db").read_bytes(),b"existing-user-data")
  self.assertFalse(any(c[0]=="curl" for c in self.load()["commands"]))

if __name__=="__main__": unittest.main(verbosity=2)
