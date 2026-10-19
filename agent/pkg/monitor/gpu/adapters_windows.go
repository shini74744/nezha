//go:build windows

package gpu

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var createDXGIFactory1 = windows.NewLazySystemDLL("dxgi.dll").NewProc("CreateDXGIFactory1")
var iidDXGIFactory1 = windows.GUID{Data1: 0x770aae78, Data2: 0xf26f, Data3: 0x4dba, Data4: [8]byte{0xa8, 0x29, 0x25, 0x3c, 0x83, 0xd1, 0xb3, 0x87}}

type dxgiDesc1 struct {
	Description                                                     [128]uint16
	VendorID, DeviceID, SubSysID, Revision                          uint32
	DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory uintptr
	LuidLow                                                         uint32
	LuidHigh                                                        int32
	Flags                                                           uint32
}

// COM objects retain typed pointers until the syscall boundary. Keeping them as
// uintptr and converting back loses pointer provenance and fails checkptr/vet.
type comObject struct {
	vtable *[14]uintptr
}

func comMethod(object *comObject, index int) uintptr { return object.vtable[index] }
func releaseCOM(object *comObject) {
	syscall.SyscallN(comMethod(object, 2), uintptr(unsafe.Pointer(object)))
}
func listWindowsAdapters() ([]windowsAdapter, error) {
	if err := createDXGIFactory1.Find(); err != nil {
		return nil, err
	}
	var factory *comObject
	hr, _, _ := createDXGIFactory1.Call(uintptr(unsafe.Pointer(&iidDXGIFactory1)), uintptr(unsafe.Pointer(&factory)))
	if int32(hr) < 0 || factory == nil {
		return nil, fmt.Errorf("DXGI factory: 0x%x", hr)
	}
	defer releaseCOM(factory)
	var out []windowsAdapter
	for i := 0; i < 128; i++ {
		var adapter *comObject
		hr, _, _ = syscall.SyscallN(comMethod(factory, 12), uintptr(unsafe.Pointer(factory)), uintptr(i), uintptr(unsafe.Pointer(&adapter)))
		if uint32(hr) == 0x887a0002 {
			break
		}
		if int32(hr) < 0 || adapter == nil {
			return nil, fmt.Errorf("DXGI adapter: 0x%x", hr)
		}
		var desc dxgiDesc1
		hr, _, _ = syscall.SyscallN(comMethod(adapter, 10), uintptr(unsafe.Pointer(adapter)), uintptr(unsafe.Pointer(&desc)))
		releaseCOM(adapter)
		if int32(hr) < 0 {
			continue
		}
		// Software rasterizers and memory-less remote display adapters are not GPUs
		// whose hardware utilization/VRAM we can truthfully display.
		if desc.Flags&2 != 0 || desc.DedicatedVideoMemory == 0 && desc.SharedSystemMemory == 0 {
			continue
		}
		out = append(out, windowsAdapter{ID: fmt.Sprintf("%08X:%08X", uint32(desc.LuidHigh), desc.LuidLow), Name: windows.UTF16ToString(desc.Description[:]), Dedicated: uint64(desc.DedicatedVideoMemory), Shared: uint64(desc.SharedSystemMemory)})
	}
	slices.SortFunc(out, func(a, b windowsAdapter) int { return strings.Compare(a.ID, b.ID) })
	return out, nil
}

func readWindowsGPUCounters(ctx context.Context) (map[string][]windowsCounterSample, error) {
	query, err := createQuery()
	if err != nil {
		return nil, err
	}
	defer pdhCloseQuery.Call(uintptr(query))
	handles := map[string]windows.Handle{}
	paths := map[string]string{"util": `\GPU Engine(*)\Utilization Percentage`, "dedicated": `\GPU Adapter Memory(*)\Dedicated Usage`, "shared": `\GPU Adapter Memory(*)\Shared Usage`}
	for key, path := range paths {
		var counter windows.Handle
		r, _, _ := pdhAddEnglishCounterW.Call(uintptr(query), uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(path))), 0, uintptr(unsafe.Pointer(&counter)))
		if r == 0 {
			handles[key] = counter
		}
	}
	if len(handles) == 0 {
		return nil, errors.New("Windows GPU counters unavailable")
	}
	r, _, _ := pdhCollectQueryData.Call(uintptr(query))
	if r != 0 {
		return nil, fmt.Errorf("GPU first counter sample: 0x%x", r)
	}
	timer := time.NewTimer(50 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	r, _, _ = pdhCollectQueryData.Call(uintptr(query))
	if r != 0 {
		return nil, fmt.Errorf("GPU counter sample: 0x%x", r)
	}
	out := map[string][]windowsCounterSample{}
	for key, handle := range handles {
		samples, e := namedCounterValues(handle)
		if e == nil {
			out[key] = samples
		}
	}
	return out, nil
}
func namedCounterValues(counter windows.Handle) ([]windowsCounterSample, error) {
	for size := uint32(8192); size <= 4*1024*1024; size *= 2 {
		buf := make([]byte, size)
		needed, count := size, uint32(0)
		r, _, _ := pdhGetFormattedCounterArrayW.Call(uintptr(counter), PDH_FMT_DOUBLE, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buf[0])))
		if r == PDH_MORE_DATA {
			continue
		}
		if r != 0 {
			return nil, fmt.Errorf("GPU counter array: 0x%x", r)
		}
		// Windows ABI aligns PDH's double union to 8 bytes on both 32/64 bit.
		const stride = 24
		if uint64(count)*stride > uint64(len(buf)) {
			return nil, errors.New("invalid GPU counter count")
		}
		out := make([]windowsCounterSample, 0, count)
		for i := 0; i < int(count); i++ {
			row := buf[i*stride : (i+1)*stride]
			status := binary.LittleEndian.Uint32(row[8:12])
			name := *(**uint16)(unsafe.Pointer(&row[0]))
			if name != nil && (status == PDH_VAILD_DATA || status == PDH_NEW_DATA) {
				out = append(out, windowsCounterSample{Name: windows.UTF16PtrToString(name), Value: math.Float64frombits(binary.LittleEndian.Uint64(row[16:24]))})
			}
		}
		return out, nil
	}
	return nil, errors.New("GPU counter output exceeds limit")
}
