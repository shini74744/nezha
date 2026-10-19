package nvidiasnapshot

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

const row = "00000000:01:00.0, NVIDIA Test, 0, 0, 4096, 45\n"

func TestParse(t *testing.T) {
	s, e := Parse([]byte(row + "00000000:02:00.0, Intel Fake, N/A, N/A, N/A, N/A\n"))
	if e != nil || len(s) != 2 || !s[0].UtilizationOK || s[0].MemoryTotal != 4096 || s[0].MemoryUsed != 0 || s[0].CoreTemperature != 45 || s[1].UtilizationOK || s[1].TemperatureOK {
		t.Fatalf("%+v %v", s, e)
	}
	for _, bad := range []string{"", row + row, "bad,card,1,2,3,4", "0000:01:00.0, card,1,2", strings.Repeat("x", MaxOutput+1)} {
		if _, e := Parse([]byte(bad)); e == nil {
			t.Fatalf("accepted invalid %q", bad[:min(60, len(bad))])
		}
	}
	for _, num := range []string{"N/A", "NaN", "+Inf", "-1", "151"} {
		s, e := Parse([]byte("0000:01:00.0, card, " + num + ", " + num + ", 4096, " + num))
		if e != nil || s[0].UtilizationOK || s[0].TemperatureOK {
			t.Fatalf("%s: %+v %v", num, s, e)
		}
	}
	s, e = Parse([]byte("0000:01:00.0, \"NVIDIA, Model\", 100, 4097, 4096, 50"))
	if e != nil || s[0].MemoryTotal != 0 || s[0].Name != "NVIDIA, Model" {
		t.Fatal(s, e)
	}
}
func TestCacheFailureRecoveryAndIsolation(t *testing.T) {
	now := time.Unix(1, 0)
	calls := 0
	fail := false
	c := New(func(context.Context) ([]byte, error) {
		calls++
		if fail {
			return nil, errors.New("driver unavailable")
		}
		return []byte(row), nil
	})
	c.now = func() time.Time { return now }
	s, e := c.Get(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	s[0].Name = "mutated"
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			s, e := c.Get(context.Background())
			if e != nil || s[0].Name == "mutated" {
				t.Error(s, e)
			}
		})
	}
	wg.Wait()
	if calls != 1 {
		t.Fatal(calls)
	}
	now = now.Add(4 * time.Second)
	fail = true
	if s, e = c.Get(context.Background()); e == nil || len(s) > 0 {
		t.Fatal("stale success", s, e)
	}
	now = now.Add(6 * time.Second)
	fail = false
	if s, e = c.Get(context.Background()); e != nil || len(s) != 1 {
		t.Fatal(s, e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = c.Get(ctx); e == nil {
		t.Fatal("cancel")
	}
}
