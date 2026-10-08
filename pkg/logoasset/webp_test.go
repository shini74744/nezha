package logoasset_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nezhahq/nezha/pkg/logoasset"
	"github.com/nezhahq/nezha/pkg/logofetch"
	"github.com/stretchr/testify/require"
)

func TestWebPLogoCompatibility(t *testing.T) {
	// Original 2x2 RGBA fixtures encoded with libwebp. Both include transparency.
	fixtures := map[string]string{
		"lossy-alpha":    "UklGRmAAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAA/4D/AABWUDggNAAAAPABAJ0BKgIAAgABQCYlAE6XQABhHvFAAAD+82Z078nm3lIoV8zrR7di7dVvxQCkcMwAAAA=",
		"lossless-alpha": "UklGRi4AAABXRUJQVlA4TCEAAAAvAUAAEB8w/wKCIv9HExAU+T+agKDouuUCeGfCOkT0PwIA",
	}
	for name, encoded := range fixtures {
		t.Run(name, func(t *testing.T) {
			raw, err := base64.StdEncoding.DecodeString(encoded)
			require.NoError(t, err)
			decoded, format, err := image.Decode(bytes.NewReader(raw))
			require.NoError(t, err)
			require.Equal(t, "webp", format)
			require.Equal(t, image.Rect(0, 0, 2, 2), decoded.Bounds())
			_, _, _, alpha := decoded.At(1, 1).RGBA()
			require.Zero(t, alpha)

			inspected := logofetch.InspectImage(raw, "fixture")
			require.Equal(t, 2, inspected.Width)
			require.Equal(t, 2, inspected.Height)
			require.Equal(t, "data:image/webp;base64,"+encoded, inspected.Image)

			dir := t.TempDir()
			asset, err := logoasset.Put(dir, inspected.Image)
			require.NoError(t, err)
			require.True(t, strings.HasSuffix(asset, ".webp"))
			again, err := logoasset.Put(dir, inspected.Image)
			require.NoError(t, err)
			require.Equal(t, asset, again)
			stored, err := os.ReadFile(filepath.Join(dir, logoasset.Name(asset)))
			require.NoError(t, err)
			require.Equal(t, raw, stored)
			entries, err := os.ReadDir(dir)
			require.NoError(t, err)
			require.Len(t, entries, 1)

			note := `{"planDataMod":{"providerLogo":{"logo":"` + inspected.Image + `"}},"keep":9007199254740993}`
			imported, count, err := logoasset.ImportNote(context.Background(), dir, note)
			require.NoError(t, err)
			require.Equal(t, 1, count)
			require.Contains(t, imported, asset)
			require.Contains(t, imported, "9007199254740993")
			require.NotContains(t, imported, "data:image")

			require.Empty(t, logofetch.InspectImage(raw[:12], "fixture").Image)
			_, err = logoasset.Put(dir, "data:image/webp;base64,"+base64.StdEncoding.EncodeToString(raw[:12]))
			require.Error(t, err)
		})
	}
}
