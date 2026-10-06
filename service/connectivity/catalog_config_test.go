package connectivity

import (
	"context"
	"encoding/json"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
	"time"
)

func TestCatalogDefaultsAndValidation(t *testing.T) {
	items := DefaultCatalog()
	require.Len(t, items, 72)
	require.NoError(t, ValidateCatalog(items))
	require.NoError(t, ValidateCatalog([]CatalogItem{}))
	bad := append([]CatalogItem{}, items...)
	bad = append(bad, bad[0])
	require.Error(t, ValidateCatalog(bad))
	bad = append([]CatalogItem{}, items...)
	bad[0].Icon = "remote"
	require.Error(t, ValidateCatalog(bad))
	bad = append([]CatalogItem{}, items...)
	bad[0].Group = "unknown"
	require.Error(t, ValidateCatalog(bad))
	require.Error(t, ValidateCatalog(make([]CatalogItem, MaxTargets+1)))
	require.Error(t, ValidateCatalog(nil))
	_, err := ParseCatalog("null")
	require.Error(t, err)
	items[0].Enabled = false
	items[1], items[2] = items[2], items[1]
	active := EnabledTargets(items)
	require.Len(t, active, 71)
	require.Equal(t, items[1].ID, active[0].ID)
	raw, _ := json.Marshal(active)
	require.NotContains(t, string(raw), "https://")
}

func TestConfiguredQueueFreezesTargetsAndRetainsCooldown(t *testing.T) {
	m := NewManager()
	m.workers = 1
	selected := []Target{
		{ID: "custom-a", Name: "A", Group: "global", URL: "https://example.com/a"},
		{ID: "custom-b", Name: "B", Group: "global", URL: "https://example.com/b"},
	}
	original := append([]Target{}, selected...)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var mu sync.Mutex
	calls := []string{}
	probe := func(ctx context.Context, target Target) Sample {
		once.Do(func() { close(started); <-release })
		mu.Lock()
		calls = append(calls, target.ID+" "+target.URL)
		mu.Unlock()
		return Sample{Status: "ok"}
	}
	_, err := m.Start("one", probe, selected)
	require.NoError(t, err)
	<-started
	selected[0].URL = "https://example.com/edited"
	current := []Target{selected[1], selected[0], {ID: "custom-c", Name: "C", Group: "global", URL: "https://example.com/c"}}
	running := m.Get("one", current)
	require.Equal(t, original[0], running.Results[0].Target)
	close(release)
	require.Eventually(t, func() bool { return m.Get("one", original).State == "complete" }, time.Second, time.Millisecond)
	mu.Lock()
	require.Len(t, calls, 6)
	require.Equal(t, "custom-a https://example.com/a", calls[0])
	require.Equal(t, "custom-b https://example.com/b", calls[1])
	mu.Unlock()
	next := m.Get("one", current)
	require.Equal(t, "idle", next.State)
	require.Equal(t, "custom-b", next.Results[0].ID)
	require.Len(t, next.Results[0].Samples, 3)
	require.Empty(t, next.Results[1].Samples)
	require.Empty(t, next.Results[2].Samples)
	require.Greater(t, next.RetryAt, time.Now().UnixMilli())
	_, err = m.Start("one", func(context.Context, Target) Sample { t.Error("cooldown bypass"); return Sample{} }, current)
	require.NoError(t, err)
	require.Empty(t, m.Get("one", []Target{}).Results)
	_, err = m.Start("empty", probe, []Target{})
	require.EqualError(t, err, "connectivity_no_targets")
}

func TestCatalogRejectsUnsafeURLs(t *testing.T) {
	for _, raw := range []string{
		"http://example.com/",
		"https://foo.local/",
		"https://localhost/",
		"https://example.com:22/",
		"https://user:pass@example.com/",
		"https://example.com/#x",
		"https://example.com./",
		"https://bad_host.com/",
		"https://foo.internal/",
	} {
		_, err := ValidateTargetURL(raw)
		require.Error(t, err, raw)
	}
}

func TestCatalogLiteralHostsAndExplicitGenericIcon(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "169.254.169.254", "1.1.1.1", "[::1]", "2130706433", "0x7f000001", "foo.test"} {
		_, err := ValidateTargetURL("https://" + host + "/")
		require.Error(t, err, host)
	}
	_, err := ValidateTargetURL("https://example.com:443/health?mode=small")
	require.NoError(t, err)
	items := DefaultCatalog()
	items[0].Icon = ""
	raw, err := json.Marshal(EnabledTargets(items)[0])
	require.NoError(t, err)
	require.Contains(t, string(raw), `"icon":""`)
	// An edited or repurposed built-in must not gain the fixed-IP exception.
	items[0].URL = "https://" + "1.1.1.1" + "/"
	require.Error(t, ValidateCatalog(items))
}
