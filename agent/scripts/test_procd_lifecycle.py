"""Exercise the real Agent/procd service backend inside a private chroot.
rc.common/procd are fixtures: no host service, network or boot entry is changed.
"""
import os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

assert os.geteuid() == 0 and sys.platform == "linux", "root Linux chroot required"
binary = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="ddnezha-procd-test-") as td:
    root = Path(td)
    for folder in ("bin", "etc/init.d", "etc/rc.d", "proc/self", "opt/DDnezha", "dev", "var/run"):
        (root/folder).mkdir(parents=True, exist_ok=True)
    def copy_with_libraries(source, dest):
        target = root/str(dest).lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source,target); target.chmod(0o755)
        info = subprocess.run(["ldd",str(source)],text=True,capture_output=True)
        for lib in re.findall(r"(/[^\s()]+)",info.stdout):
            p = Path(lib)
            if p.is_file():
                out=root/str(p).lstrip("/");out.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(p,out)
    copy_with_libraries(binary,"/opt/DDnezha/DDnezha")
    copy_with_libraries(shutil.which("busybox"),"/bin/busybox")
    for app in ("sh","rm","ln","cat"):
        (root/"bin"/app).symlink_to("/bin/busybox")
    (root/"bin/procd").write_text("#!/bin/sh\nexit 0\n");(root/"bin/procd").chmod(0o755)
    (root/"proc/self/exe").symlink_to("/opt/DDnezha/DDnezha")
    (root/"dev/null").write_bytes(b"")
    own=root/"opt/DDnezha"
    (own/".DDnezha-owned").write_text("DDnezha\n")
    (root/"etc/rc.common").write_text("""#!/bin/sh
script="$1"
action="$2"
. "$script"
procd_open_instance() { :; }
procd_set_param() { printf '%s\\n' "$*" >> /var/run/fixture-commands; }
procd_close_instance() { :; }
case "$action" in
 start) start_service ;;
 stop) : ;;
 status) echo running ;;
 enabled) test -L "/etc/rc.d/S${START}$name" ;;
 disable) rm -f "/etc/rc.d/S${START}$name" "/etc/rc.d/K${STOP}$name" ;;
 *) exit 2 ;;
esac
""")
    env={**os.environ,"PATH":"/bin","DDNZ_SERVER":"127.0.0.1:1","DDNZ_CLIENT_SECRET":"fixture","DDNZ_UUID":"11111111-1111-4111-8111-111111111111"}
    def run(*args):
        result=subprocess.run([shutil.which("chroot"),str(root),*args],env=env,text=True,capture_output=True,timeout=15)
        assert result.returncode==0,result.stdout+result.stderr
        return result.stdout
    for name in ("S50nezha-agent","K02nezha-agent"):
        (root/"etc/rc.d"/name).symlink_to("/etc/init.d/nezha-agent")
    run("/opt/DDnezha/DDnezha","service","install")
    init=root/"etc/init.d/DDnezha"
    assert "START=50\n" in init.read_text() and "STOP=02\n" in init.read_text()
    run("/etc/init.d/DDnezha","enabled")
    assert "command /opt/DDnezha/DDnezha -c /opt/DDnezha/config.yml" in (root/"var/run/fixture-commands").read_text()
    identity=(own/"config.yml").read_bytes()
    run("/opt/DDnezha/DDnezha","service","-c","/opt/DDnezha/config.yml","uninstall")
    assert (own/"config.yml").read_bytes()==identity and not init.exists()
    assert not list((root/"etc/rc.d").glob("*DDnezha"))
    # Recreate the previous broken priority layout and verify exact-link cleanup.
    run("/opt/DDnezha/DDnezha","service","install")
    init.write_text(init.read_text().replace("START=50","START=21").replace("STOP=02","STOP=89"));init.chmod(0o755)
    run("/opt/DDnezha/DDnezha","service","uninstall")
    assert not list((root/"etc/rc.d").glob("*DDnezha"))
    for name in ("S50nezha-agent","K02nezha-agent"):
        assert os.readlink(root/"etc/rc.d"/name)=="/etc/init.d/nezha-agent"
    print("PROCD_INSTALL_ENABLED_DIRECT_UNINSTALL_LEGACY_LINK_CLEANUP_PASS")
