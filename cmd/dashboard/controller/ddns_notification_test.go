package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestDDNSNotificationGroupOwnershipAndLegacyUpdate(t *testing.T) {
	defer setupTenancyTest(t)()
	own := model.NotificationGroup{Common: model.Common{UserID: 10}, Name: "own"}
	foreign := model.NotificationGroup{Common: model.Common{UserID: 999}, Name: "foreign"}
	require.NoError(t, singleton.DB.Create(&own).Error)
	require.NoError(t, singleton.DB.Create(&foreign).Error)
	f := model.DDNSForm{Name: "fixture", Provider: model.ProviderDummy, MaxRetries: 1, Domains: []string{"example.com"}, NotificationGroupID: &own.ID}
	id, err := createDDNS(ctxAsMemberWithBody(10, f))
	require.NoError(t, err)
	read := func() model.DDNSProfile {
		var p model.DDNSProfile
		require.NoError(t, singleton.DB.First(&p, id).Error)
		return p
	}
	require.Equal(t, own.ID, read().NotificationGroupID)
	f.NotificationGroupID = nil
	c := ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateDDNS(c)
	require.NoError(t, err)
	require.Equal(t, own.ID, read().NotificationGroupID)
	f.NotificationGroupID = &foreign.ID
	c = ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateDDNS(c)
	require.Error(t, err)
	require.Equal(t, own.ID, read().NotificationGroupID)
	_, err = createDDNS(ctxAsMemberWithBody(10, f))
	require.Error(t, err)
	zero := uint64(0)
	f.NotificationGroupID = &zero
	c = ctxAsMemberWithBody(10, f)
	c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
	_, err = updateDDNS(c)
	require.NoError(t, err)
	require.Zero(t, read().NotificationGroupID)
}
