#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: release/build.sh 2.3.6 OUTPUT_DIRECTORY}"
out="${2:?absolute output directory required}"
[[ "$out" = /* ]] || exit 1
mkdir -p "$out"
targets=(linux/amd64 linux/arm64 linux/386 linux/arm linux/mips linux/mipsle linux/riscv64 linux/s390x linux/loong64 darwin/amd64 darwin/arm64 windows/amd64 windows/386 windows/arm64 freebsd/amd64 freebsd/386 freebsd/arm freebsd/arm64)
build_target() {
 local target="$1" binary=nezha-agent
 export GOOS="${target%/*}" GOARCH="${target#*/}" CGO_ENABLED=0 GOMIPS=softfloat GOMAXPROCS=2
 [[ "$GOOS" != windows ]] || binary=nezha-agent.exe
 local work="$out/${GOOS}_${GOARCH}"
 mkdir -p "$work"
 echo "Building $target"
 go build -p 2 -mod=readonly -trimpath -ldflags "-s -w -X github.com/nezhahq/agent/pkg/monitor.Version=$version -X main.arch=$GOARCH" -o "$work/$binary" ./cmd/agent
 python3 -c 'import sys,zipfile,pathlib,hashlib; p=pathlib.Path(sys.argv[1]); a=pathlib.Path(sys.argv[2]); z=zipfile.ZipFile(a,"w",zipfile.ZIP_DEFLATED); z.write(p,p.name); z.close(); a.with_suffix(a.suffix+".sha256").write_text(hashlib.sha256(a.read_bytes()).hexdigest()+"\n")' "$work/$binary" "$out/nezha-agent_${GOOS}_${GOARCH}.zip"
 echo "Done $target"
}
export -f build_target
export version out
printf '%s\n' "${targets[@]}" | xargs -P 2 -I '{}' bash -c 'build_target "$1"' _ '{}'
(cd "$out" && sha256sum *.zip > checksums.txt)
