package controller

import (
	"math"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/goccy/go-json"
	"github.com/gorilla/websocket"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func decodeLiveFrame(t *testing.T, frame serverStatFrame) model.StreamServerData {
	t.Helper()
	var data model.StreamServerData
	require.NoError(t, json.Unmarshal(frame.data, &data))
	return data
}

func TestLiveServerNotesUpdateClearDeleteAndReadd(t *testing.T) {
	servers := makeStreamTestServers()
	render := func(previous string) serverStatFrame {
		frame, err := marshalServerStat(filterServersForViewer(servers, 0, false, true, nil), previous)
		require.NoError(t, err)
		return frame
	}
	first := render("")
	require.True(t, decodeLiveFrame(t, first).PublicNoteComplete)
	unchanged := render(first.publicNoteVersion)
	require.False(t, decodeLiveFrame(t, unchanged).PublicNoteComplete)
	require.NotContains(t, string(unchanged.data), "public_note")
	require.Equal(t, "alice-public-note", servers[0].PublicNote)

	servers[0].Name = "renamed"
	servers[0].PublicNote = `{"billingDataMod":{"amount":"20USD"},"planDataMod":{"bandwidth":"2Gbps"}}`
	changed := render(unchanged.publicNoteVersion)
	data := decodeLiveFrame(t, changed)
	require.True(t, data.PublicNoteComplete)
	require.Equal(t, "renamed", data.Servers[0].Name)
	require.Equal(t, servers[0].PublicNote, data.Servers[0].PublicNote)

	servers[0].PublicNote = ""
	cleared := render(changed.publicNoteVersion)
	require.True(t, decodeLiveFrame(t, cleared).PublicNoteComplete)
	require.Empty(t, decodeLiveFrame(t, cleared).Servers[0].PublicNote)

	servers = servers[1:]
	deleted := render(cleared.publicNoteVersion)
	require.True(t, decodeLiveFrame(t, deleted).PublicNoteComplete)
	require.Nil(t, findStreamServer(decodeLiveFrame(t, deleted).Servers, 1))

	servers = nil
	empty := render(deleted.publicNoteVersion)
	require.True(t, decodeLiveFrame(t, empty).PublicNoteComplete)
	require.Empty(t, decodeLiveFrame(t, empty).Servers)

	servers = []*model.Server{{Common: model.Common{ID: 1}, Name: "replacement"}}
	readded := render(empty.publicNoteVersion)
	require.True(t, decodeLiveFrame(t, readded).PublicNoteComplete)
	require.Empty(t, decodeLiveFrame(t, readded).Servers[0].PublicNote)
}

func TestLiveServerNotesRespectVisibilityAndPATScopes(t *testing.T) {
	servers := makeStreamTestServers()
	guest, err := marshalServerStat(filterServersForViewer(servers, 0, false, true, nil), "")
	require.NoError(t, err)
	servers[1].PublicNote = "new-private-note"
	afterPrivateEdit, err := marshalServerStat(filterServersForViewer(servers, 0, false, true, nil), guest.publicNoteVersion)
	require.NoError(t, err)
	require.Equal(t, guest.publicNoteVersion, afterPrivateEdit.publicNoteVersion)
	require.NotContains(t, string(afterPrivateEdit.data), "new-private-note")
	require.False(t, decodeLiveFrame(t, afterPrivateEdit).PublicNoteComplete)

	for _, tc := range []struct {
		user  uint64
		admin bool
		pat   model.APITokenAccessor
		ids   []uint64
	}{
		{0, false, nil, []uint64{1, 3}},
		{100, false, nil, []uint64{1, 2, 3}},
		{999, true, patAllowList{2}, []uint64{2}},
		{999, true, patAllowList{3}, []uint64{3}},
	} {
		frame, err := marshalServerStat(filterServersForViewer(servers, tc.user, tc.admin, true, tc.pat), "")
		require.NoError(t, err)
		ids := []uint64{}
		for _, s := range decodeLiveFrame(t, frame).Servers {
			ids = append(ids, s.ID)
		}
		require.Equal(t, tc.ids, ids)
	}
	servers[0].HideForGuest = true
	hidden, err := marshalServerStat(filterServersForViewer(servers, 0, false, true, nil), guest.publicNoteVersion)
	require.NoError(t, err)
	require.True(t, decodeLiveFrame(t, hidden).PublicNoteComplete)
	require.Nil(t, findStreamServer(decodeLiveFrame(t, hidden).Servers, 1))
}

func TestLiveServerNotesMarshalError(t *testing.T) {
	_, err := marshalServerStat([]model.StreamServer{{ID: 1, State: &model.HostState{CPU: math.NaN()}}}, "")
	require.Error(t, err)
}

func TestLiveServerStreamUpdatesWithoutReconnect(t *testing.T) {
	setupServerGroupVisibilityFixture(t)
	previousUpgrader := upgrader
	upgrader = &websocket.Upgrader{}
	t.Cleanup(func() { upgrader = previousUpgrader })
	router := gin.New()
	done := make(chan struct{})
	router.GET("/stream", func(c *gin.Context) { defer close(done); _, _ = serverStream(c) })
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http")+"/stream", nil)
	require.NoError(t, err)
	defer conn.Close()
	read := func() model.StreamServerData {
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
		var data model.StreamServerData
		require.NoError(t, conn.ReadJSON(&data))
		return data
	}
	first := read()
	require.True(t, first.PublicNoteComplete)
	require.NotNil(t, findStreamServer(first.Servers, 1))
	require.False(t, read().PublicNoteComplete)
	replace := func(note string) {
		s := &model.Server{Common: model.Common{ID: 1, UserID: 100}, Name: "live-edited", PublicNote: note}
		model.InitServer(s)
		singleton.ServerShared.Update(s, "")
	}
	replace("updated-tag")
	updated := read()
	require.True(t, updated.PublicNoteComplete)
	require.Equal(t, "updated-tag", findStreamServer(updated.Servers, 1).PublicNote)
	replace("")
	require.True(t, read().PublicNoteComplete)
	singleton.ServerShared.Delete([]uint64{1})
	removed := read()
	require.True(t, removed.PublicNoteComplete)
	require.Nil(t, findStreamServer(removed.Servers, 1))
	require.NoError(t, conn.Close())
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("stream reader did not release a closed connection")
	}
}
