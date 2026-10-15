"""Destructive lifecycle test ONLY on disposable GitHub-hosted POSIX runners."""
import argparse, hashlib, json, os, platform, re, shutil, subprocess, tempfile, time, urllib.request, zipfile
from pathlib import Path

PIN = "a606b570f6da4181bc1f44348d4d1885e8caccdf"
DIGESTS = {
 "linux_amd64": "cb0ace70db050a8485d6314535922ae7614ad74c89689fdaab76ecfd5a81ba96",
 "darwin_arm64": "95cedc613c9e145070e3c3f3a1d2933dd2e0a6b8e170f8a758c7f12301f58154",
 "darwin_amd64": "ce550c82b78162e8fe81c86a0de9b04d37f257e3316cc5ae6619d8c5dcba7f4b",
}
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--binary",required=True); parser.add_argument("--old-binary",required=True)
 args=parser.parse_args()
 assert os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted"
 assert os.geteuid()==0, "Run only as root on a disposable runner"
 own=Path("/opt/DDnezha"); official=Path("/opt/nezha/agent")
 assert not own.exists() and not Path("/opt/nezha").exists(), "Existing installation: refuse test"
 os.umask(0o077)
 work=Path(tempfile.mkdtemp(prefix="ddnezha-native-")).resolve()
 target=("darwin" if platform.system()=="Darwin" else "linux")+"_"+("arm64" if platform.machine() in ("arm64","aarch64") else "amd64")
 data=urllib.request.urlopen("https://github.com/nezhahq/agent/releases/download/v2.3.5/nezha-agent_"+target+".zip",timeout=90).read()
 assert hashlib.sha256(data).hexdigest()==DIGESTS[target]
 (work/"official.zip").write_bytes(data)
 script=urllib.request.urlopen("https://raw.githubusercontent.com/nezhahq/scripts/"+PIN+"/agent/install.sh",timeout=60).read()
 (work/"official.sh").write_bytes(script)
 for version,binary in [("1.0.1",args.old_binary),("1.0.2",args.binary)]:
  with zipfile.ZipFile(work/(version+".zip"),"w",zipfile.ZIP_DEFLATED) as z: z.write(binary,"DDnezha")
  (work/(version+".sha256")).write_text(hashlib.sha256((work/(version+".zip")).read_bytes()).hexdigest()+"\n")
 mock=work/"bin"; mock.mkdir()
 downloader="""#!/usr/bin/env python3
import os,sys,shutil
from pathlib import Path
a=sys.argv[1:];u=next(x for x in a if x.startswith('https:'));w=Path(os.environ['COEXIST_WORK'])
if '/cdn-cgi/trace' in u: print('h='+u.split('/')[2]+'\\nloc=US');sys.exit(0)
out=a[a.index('-o')+1] if '-o' in a else a[a.index('-O')+1]
v=(w/'selected-version').read_text().strip()
if u=='https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt': Path(out).write_text('v'+v+'\\n')
elif u.startswith('https://github.com/shini74744/nezha/releases/download/agent-v'+v+'/DDnezha_'):
 shutil.copyfile(w/(v+'.sha256' if u.endswith('.sha256') else v+'.zip'),out)
elif u=='https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_'+os.environ['COEXIST_TARGET']+'.zip': shutil.copyfile(w/'official.zip',out)
else: raise RuntimeError('Unexpected installer download: '+u)
"""
 # Resolve Python absolutely: macOS root PATH may not contain the runner Python.
 downloader=downloader.replace("#!/usr/bin/env python3","#!"+shutil.which("python3"),1)
 for name in ("curl","wget"):
  (mock/name).write_text(downloader);(mock/name).chmod(0o755)
 env={**os.environ,"PATH":str(mock)+":"+os.environ["PATH"],"COEXIST_WORK":str(work),"COEXIST_TARGET":target}
 env.pop("CN",None);env.pop("isCN",None)
 for prefix,uuid in (("DDNZ","11111111-1111-4111-8111-111111111111"),("NZ","22222222-2222-4222-8222-222222222222")):
  env.update({prefix+"_SERVER":"127.0.0.1:1",prefix+"_CLIENT_SECRET":prefix+"-fixture-key",prefix+"_UUID":uuid,
   prefix+"_TLS":"false",prefix+"_DISABLE_AUTO_UPDATE":"true",prefix+"_DISABLE_FORCE_UPDATE":"true",prefix+"_DISABLE_COMMAND_EXECUTE":"true"})
 ownscript=Path(__file__).with_name("install.sh").resolve()
 log=(work/"commands.log").open("w")
 def run(cmd,check=True):
  return subprocess.run(list(map(str,cmd)),env=env,stdout=log,stderr=log,check=check,timeout=90)
 def service(binary,config=None,action="start",check=True):
  cmd=[binary,"service"]+([] if config is None else ["-c",config])+[action]
  return run(cmd,check)
 def name(binary,config=None):
  return binary.name+("-"+hashlib.md5(str(config).encode()).hexdigest()[:7] if config and config.name!="config.yml" else "")
 def pid(binary,config=None):
  unit=name(binary,config)
  if platform.system()=="Linux":
   p=subprocess.run(["systemctl","show",unit+".service","-p","MainPID","--value"],text=True,capture_output=True)
   return int(p.stdout.strip() or "0")
  p=subprocess.run(["launchctl","print","system/"+unit],text=True,capture_output=True)
  m=re.search(r"\bpid = (\d+)",p.stdout)
  return int(m.group(1)) if p.returncode==0 and m else 0
 def wait_running(binary,config=None):
  end=time.monotonic()+25
  while time.monotonic()<end:
   if pid(binary,config)>0:return
   time.sleep(.5)
  raise AssertionError("service not running: "+str(binary))
 def snap(folder):
  return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob("*") if p.is_file()}
 def unchanged(folder,before,binary,process,config=None):
  assert snap(folder)==before, "other installation files changed"
  assert pid(binary,config)==process and process>0, "other service restarted/stopped"
 new=own/"DDnezha"; old=official/"nezha-agent"
 try:
  (work/"selected-version").write_text("1.0.1")
  run(["sh",ownscript]);wait_running(new)
  own_start=snap(own);own_pid=pid(new)
  run(["sh",work/"official.sh"]);service(old);wait_running(old)
  unchanged(own,own_start,new,own_pid)
  # A second official configuration must also survive our lifecycle.
  second=official/"config-other.yml"
  second.write_text((official/"config.yml").read_text().replace("22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"))
  service(old,second,"install");service(old,second);wait_running(old,second)
  before=snap(official);p=pid(old);p2=pid(old,second);identity=(own/"config.yml").read_bytes()
  (work/"selected-version").write_text("1.0.2")
  run(["sh",ownscript]);wait_running(new)
  assert subprocess.check_output([str(new),"-v"],text=True).strip()=="DDnezha version 1.0.2"
  assert (own/"config.yml").read_bytes()==identity
  unchanged(official,before,old,p);assert pid(old,second)==p2
  print("OWN_UPGRADE_PRESERVES_OFFICIAL_MULTI_INSTANCE_PASS",flush=True)
  run(["sh",ownscript,"uninstall"])
  unchanged(official,before,old,p);assert pid(old,second)==p2
  assert not (own/"config.yml").exists() and pid(new)==0
  print("OWN_UNINSTALL_PRESERVES_OFFICIAL_PASS",flush=True)
  run(["sh",ownscript]);wait_running(new);before_own=snap(own);pown=pid(new)
  run(["sh",work/"official.sh","uninstall"])
  unchanged(own,before_own,new,pown);assert pid(old)==0 and pid(old,second)==0
  run(["sh",work/"official.sh"]);service(old);wait_running(old)
  unchanged(own,before_own,new,pown)
  # Official binary replacement/restart remains inside its own installation.
  service(old,action="stop")
  with zipfile.ZipFile(work/"official.zip") as z: payload=z.read("nezha-agent")
  replacement=official/"verified-replacement";replacement.write_bytes(payload);replacement.chmod(0o755);os.replace(replacement,old)
  service(old);wait_running(old);unchanged(own,before_own,new,pown)
  print("OFFICIAL_REINSTALL_REPLACEMENT_UNINSTALL_PRESERVES_OWN_PASS",flush=True)
  run(["sh",ownscript,"uninstall"]);run(["sh",ownscript,"uninstall"])
  print("NATIVE_POSIX_COEXISTENCE_PASS "+target,flush=True)
 except BaseException:
  log.flush();print((work/"commands.log").read_text()[-20000:],flush=True);raise
 finally:
  for binary,folder in ((new,own),(old,official)):
   if binary.exists():
    for config in folder.glob("*config*.yml"):
     service(binary,config,"stop",False);service(binary,config,"uninstall",False)
  log.close()
if __name__=="__main__":main()
