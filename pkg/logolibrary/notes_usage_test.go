package logolibrary

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReferencedIDsMatchesSupportedPaths(t *testing.T) {
	raw := `{"planDataMod":{"providerLogo":{"logoLibraryId":"a"},"networkRouteLogos":{"ct":{"logoLibraryId":"b"}},"networkRouteEntries":[{"logoLibraryId":"c"},{"logoLibraryId":"a"}]},"套餐信息":{"厂商图标":{"图标库ID":"d"},"运营商图标":{"移动":{"图标库ID":"e"}},"其他运营商线路":[{"图标库ID":"f"}]},"other":{"logoLibraryId":"not-a-reference"}}`
	require.ElementsMatch(t, []string{"a", "b", "c", "d", "e", "f"}, ReferencedIDs(raw))
	for _, value := range []string{"", "not-json", "null", raw + " {}", `{"planDataMod":[]}`, `{"planDataMod":{"providerLogo":{"logoLibraryId":4}}}`} {
		require.Empty(t, ReferencedIDs(value))
	}
}
