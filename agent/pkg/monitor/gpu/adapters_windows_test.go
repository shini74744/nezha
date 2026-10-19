//go:build windows

package gpu

import (
	"testing"
	"unsafe"
)

func TestCOMVTableUsesPointerSizedSlots(t *testing.T) {
	table := &[14]uintptr{2: 0x22, 10: 0xaa, 12: 0xcc}
	object := &comObject{vtable: table}
	if unsafe.Offsetof(object.vtable) != 0 || unsafe.Sizeof(*object) != unsafe.Sizeof(uintptr(0)) {
		t.Fatal("COM interface must begin with one pointer-sized vtable pointer")
	}
	for index, want := range map[int]uintptr{2: 0x22, 10: 0xaa, 12: 0xcc} {
		if got := comMethod(object, index); got != want {
			t.Fatalf("vtable slot %d = %x, want %x", index, got, want)
		}
	}
}

func TestDXGIEnumerationReleasesInterfaces(t *testing.T) {
	// Headless hosted runners may expose no physical GPU. Enumerating and
	// releasing the COM interfaces must still be safe and repeatable.
	for attempt := 0; attempt < 3; attempt++ {
		adapters, err := listWindowsAdapters()
		if err != nil {
			t.Fatalf("DXGI enumeration %d: %v", attempt, err)
		}
		for _, adapter := range adapters {
			if adapter.ID == "" || adapter.Name == "" {
				t.Fatalf("incomplete adapter identity: %+v", adapter)
			}
		}
	}
}
