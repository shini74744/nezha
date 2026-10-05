package controller

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

// Exercise the visual editor's payload against the real controller and test DB.
// No DDNS worker is started and no external DNS provider is contacted.
func TestDDNSVisualEditorPayloadCompatibility(t *testing.T) {
	defer setupTenancyTest(t)()
	for _, provider := range model.ProviderList {
		t.Run(provider, func(t *testing.T) {
			zero := uint64(0)
			form := model.DDNSForm{
				Name: "visual editor fixture", Provider: provider,
				EnableIPv4: true, EnableIPv6: true, MaxRetries: 10,
				Domains:  []string{"home.example.com", "例子.中国"},
				AccessID: "fixture-id", AccessSecret: "fixture-secret",
				WebhookURL:    "https://fixture.invalid/?ip=#ip#",
				WebhookMethod: 2, WebhookRequestType: 2,
				WebhookHeaders:      `{"Authorization":"Bearer #access_secret#"}`,
				WebhookRequestBody:  `{"ip":"#ip#","domain":"#domain#"}`,
				NotificationGroupID: &zero,
			}
			id, err := createDDNS(ctxAsMemberWithBody(10, form))
			require.NoError(t, err)
			var saved model.DDNSProfile
			require.NoError(t, singleton.DB.First(&saved, id).Error)
			require.Equal(t, []string{"home.example.com", "xn--fsqu00a.xn--fiqs8s"}, saved.Domains)
			require.True(t, *saved.EnableIPv4)
			require.True(t, *saved.EnableIPv6)
			require.Equal(t, uint8(2), saved.WebhookMethod)
			require.Equal(t, form.WebhookRequestBody, saved.WebhookRequestBody)
			form.Name = "renamed"
			form.AccessSecret = ""
			form.WebhookHeaders = ""
			c := ctxAsMemberWithBody(10, form)
			c.Params = gin.Params{{Key: "id", Value: itoa(id)}}
			_, err = updateDDNS(c)
			require.NoError(t, err)
			require.NoError(t, singleton.DB.First(&saved, id).Error)
			require.Equal(t, "fixture-secret", saved.AccessSecret)
			require.Equal(t, `{"Authorization":"Bearer #access_secret#"}`, saved.WebhookHeaders)
			require.Equal(t, "renamed", saved.Name)
		})
	}
}
