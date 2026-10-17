package singleton

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"path/filepath"
	"testing"
)

func TestReplacementIPNotificationEmptySelectionClearsCache(t *testing.T) {
	config := &ConfigClass{Config: &model.Config{}}
	config.IgnoredIPNotification = "7,8"
	config.updateIgnoredIPNotificationID()
	require.True(t, config.IgnoredIPNotificationServerIDs[7])
	config.IgnoredIPNotification = ""
	config.updateIgnoredIPNotificationID()
	require.Empty(t, config.IgnoredIPNotificationServerIDs)
}

func TestReplacementIPNotificationPersistsOnlyTargetRemoval(t *testing.T) {
	old := Conf
	t.Cleanup(func() { Conf = old })
	path := filepath.Join(t.TempDir(), "config.yaml")
	config := &model.Config{}
	require.NoError(t, config.Read(path, nil))
	Conf = &ConfigClass{Config: config}
	Conf.IgnoredIPNotification = "7,8"
	Conf.EnableIPChangeNotification = true
	Conf.IPChangeNotificationGroupID = 19
	require.NoError(t, Conf.Save())
	require.NoError(t, ResetReplacementIPNotification(7))
	require.False(t, Conf.IPNotificationSelected(7))
	require.True(t, Conf.IPNotificationSelected(8))
	require.True(t, Conf.EnableIPChangeNotification)
	require.EqualValues(t, 19, Conf.IPChangeNotificationGroupID)
	var saved model.Config
	require.NoError(t, saved.Read(path, nil))
	require.Equal(t, "8", saved.IgnoredIPNotification)
	require.NoError(t, ResetReplacementIPNotification(8))
	require.Empty(t, Conf.IgnoredIPNotificationServerIDs)
	var empty model.Config
	require.NoError(t, empty.Read(path, nil))
	require.Empty(t, empty.IgnoredIPNotification)
	require.True(t, empty.EnableIPChangeNotification)
	require.EqualValues(t, 19, empty.IPChangeNotificationGroupID)
}
