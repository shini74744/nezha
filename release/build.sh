#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: release/build.sh 1.0.0 OUTPUT_DIRECTORY}"
out="${2:?absolute output directory required}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$out" = /* ]] || exit 1
source_commit="$(git rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
targets=(linux/amd64 linux/arm64 linux/386 linux/arm linux/mips linux/mipsle linux/riscv64 linux/s390x linux/loong64 darwin/amd64 darwin/arm64 windows/amd64 windows/386 windows/arm64 freebsd/amd64 freebsd/386 freebsd/arm freebsd/arm64)
if [[ -n "${AGENT_BUILD_TARGET:-}" ]]; then
 valid=false
 for target in "${targets[@]}"; do [[ "$target" != "$AGENT_BUILD_TARGET" ]] || valid=true; done
 "$valid" || { echo "Unsupported build target" >&2; exit 1; }
 targets=("$AGENT_BUILD_TARGET")
fi
mkdir -p "$out"
build_target() {
 local target="$1" binary=nezha-agent
 export GOOS="${target%/*}" GOARCH="${target#*/}" CGO_ENABLED=0 GOMIPS=softfloat GOMAXPROCS=2
 [[ "$GOOS" != windows ]] || binary=nezha-agent.exe
 local work="$out/${GOOS}_${GOARCH}"
 mkdir -p "$work"
 echo "Building $target"
 go build -p 2 -mod=readonly -trimpath -buildvcs=false -ldflags "-s -w -X github.com/nezhahq/agent/pkg/monitor.Version=$version -X main.arch=$GOARCH" -o "$work/$binary" ./cmd/agent
 python3 -c 'import sys,zipfile,pathlib,hashlib; p=pathlib.Path(sys.argv[1]); a=pathlib.Path(sys.argv[2]); z=zipfile.ZipFile(a,"w",zipfile.ZIP_DEFLATED); z.write(p,p.name); z.close(); a.with_suffix(a.suffix+".sha256").write_text(hashlib.sha256(a.read_bytes()).hexdigest()+"\n")' "$work/$binary" "$out/nezha-agent_${GOOS}_${GOARCH}.zip"
 echo "Done $target"
}
export -f build_target
export version out
printf '%s\n' "${targets[@]}" | xargs -P 2 -I '{}' bash -c 'build_target "$1"' _ '{}'
python3 - "$out" "$version" "$source_commit" <<'PY'
import hashlib,json,pathlib,sys
out=pathlib.Path(sys.argv[1])
(out/"agent-release.json").write_text(json.dumps(dict(schema=1,channel="shini74744-agent-v1",version=sys.argv[2],source_commit=sys.argv[3]),indent=2)+"\n")
files=sorted(out.glob("*.zip"))+[out/"agent-release.json"]
(out/"checksums.txt").write_text("".join(hashlib.sha256(p.read_bytes()).hexdigest()+"  "+p.name+"\n" for p in files))
PY
