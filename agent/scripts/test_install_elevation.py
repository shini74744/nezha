#!/usr/bin/env python3
"""Exercise privilege handoff only; sudo is a stub and no Agent is installed."""
import json,os,subprocess,tempfile,unittest
from pathlib import Path
SCRIPT=Path(__file__).resolve().with_name("install.sh")
class ElevationTests(unittest.TestCase):
 def check(self,uuid=None,sudo=True,action=None):
  with tempfile.TemporaryDirectory(prefix="agent-sudo-test-") as td:
   root=Path(td);out=root/"args.json"
   (root/"id").write_text("#!/bin/sh\necho 1000\n");(root/"id").chmod(0o755)
   if sudo:
    (root/"sudo").write_text("#!/usr/bin/python3\nimport os,sys,json\nopen(os.environ['TEST_OUT'],'w').write(json.dumps(sys.argv[1:]))\n")
    (root/"sudo").chmod(0o755)
   env={"PATH":td,"TEST_OUT":str(out),"NZ_SERVER":"panel.example:443","NZ_TLS":"true","NZ_CLIENT_SECRET":"test 'quote' $() space"}
   if uuid is not None:env["NZ_UUID"]=uuid
   result=subprocess.run(["/bin/sh",str(SCRIPT)]+([action] if action else []),env=env,capture_output=True,text=True)
   if not sudo:self.assertNotEqual(result.returncode,0);self.assertIn("sudo is required",result.stderr);return
   self.assertEqual(result.returncode,0,result.stderr)
   args=json.loads(out.read_text());self.assertEqual(args[0],"env")
   self.assertIn("NZ_CLIENT_SECRET="+env["NZ_CLIENT_SECRET"],args)
   self.assertIn("NZ_SERVER=panel.example:443",args);self.assertIn("NZ_TLS=true",args)
   suffix=["sh",str(SCRIPT)]+([action] if action else [])
   self.assertEqual(args[-len(suffix):],suffix)
   if uuid is None:self.assertFalse(any(a.startswith("NZ_UUID=") for a in args))
   else:self.assertIn("NZ_UUID="+uuid,args)
 def test_preserves_uuid(self):self.check("test-uuid")
 def test_leaves_uuid_unset(self):self.check()
 def test_missing_sudo(self):self.check(sudo=False)
 def test_uninstall_action_survives_sudo(self):self.check(action="uninstall")
 def test_uninstall_missing_sudo(self):self.check(sudo=False,action="uninstall")
if __name__=="__main__":unittest.main()
