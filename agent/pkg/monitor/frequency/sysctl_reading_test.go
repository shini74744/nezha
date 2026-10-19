package frequency

import (
	"context"
	"errors"
	"testing"
)

func TestBSDReportedAndNominalFallback(t *testing.T) {
	data := map[string]uint32{"hw.ncpu": 3, "dev.cpu.0.freq": 1800, "dev.cpu.2.freq": 2200, "hw.clockrate": 3000}
	query := func(key string) (uint32, error) {
		v, ok := data[key]
		if !ok {
			return 0, errors.New("unsupported")
		}
		return v, nil
	}
	if r := readBSD(context.Background(), query); r.MHz != 2000 || r.Kind != "reported" {
		t.Fatal(r)
	}
	delete(data, "dev.cpu.0.freq")
	delete(data, "dev.cpu.2.freq")
	if r := readBSD(context.Background(), query); r.MHz != 3000 || r.Kind != "nominal" {
		t.Fatal(r)
	}
	delete(data, "hw.clockrate")
	if r := readBSD(context.Background(), query); r != (Reading{}) {
		t.Fatal(r)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r := readBSD(ctx, query); r != (Reading{}) {
		t.Fatal(r)
	}
}
