package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestLogoGroupsKeepEntriesAndSnapshots(t *testing.T) {
	cleanup, _ := setupMCPTest(t)
	defer cleanup()
	require.NoError(t, singleton.DB.AutoMigrate(&model.LogoLibraryEntry{}, &model.LogoLibraryGroup{}))
	c := libraryContext("POST", "/logo/groups", `{"name":"常用厂商"}`)
	c.Params = nil
	value, err := saveLogoGroup(c)
	require.NoError(t, err)
	group := value.(model.LogoLibraryGroup)
	_, err = saveLogoGroup(c)
	require.Error(t, err)
	entry := model.LogoLibraryEntry{ID: "provider-group-test", Kind: "provider", Name: "测试厂商", GroupID: group.ID, Version: 1}
	require.NoError(t, validLogoGroup(singleton.DB, &entry))
	require.NoError(t, singleton.DB.Create(&entry).Error)
	server := model.Server{Common: model.Common{ID: 8}, PublicNote: `{"planDataMod":{"providerLogo":{"logoLibraryId":"provider-group-test","logoLayout":{"desktop":{"x":8},"mobile":{"scale":70}}}}}`}
	require.NoError(t, singleton.DB.Create(&server).Error)
	body, _ := json.Marshal(model.LogoLibraryGroup{Name: "香港常用", Version: 1})
	c = libraryContext("PUT", "/logo/groups", string(body))
	c.Params = gin.Params{{Key: "id", Value: group.ID}}
	_, err = saveLogoGroup(c)
	require.NoError(t, err)
	_, err = saveLogoGroup(c)
	require.Error(t, err)
	c = libraryContext("DELETE", "/logo/groups?version=2", "")
	c.Params = gin.Params{{Key: "id", Value: group.ID}}
	_, err = deleteLogoGroup(c)
	require.NoError(t, err)
	var got model.LogoLibraryEntry
	require.NoError(t, singleton.DB.First(&got, "id = ?", entry.ID).Error)
	require.Empty(t, got.GroupID)
	require.Equal(t, uint64(2), got.Version)
	var after model.Server
	require.NoError(t, singleton.DB.First(&after, 8).Error)
	require.Equal(t, server.PublicNote, after.PublicNote)
	require.Error(t, validLogoGroup(singleton.DB, &entry))
}
