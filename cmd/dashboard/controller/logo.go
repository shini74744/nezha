package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/pkg/logofetch"
	"net/http"
)

var logoFetchSlots = make(chan struct{}, 3)

func fetchWebsiteLogo(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var form struct {
		URL  string `json:"url"`
		Mode string `json:"mode"`
	}
	if e := c.ShouldBindJSON(&form); e != nil {
		return nil, errors.New("请输入有效的网站或图片地址")
	}
	if form.Mode != "" && form.Mode != "website" && form.Mode != "image" {
		return nil, errors.New("无效的获取方式")
	}
	select {
	case logoFetchSlots <- struct{}{}:
		defer func() { <-logoFetchSlots }()
	default:
		return nil, errors.New("正在获取其他图标，请稍后再试")
	}
	return logofetch.Fetch(c.Request.Context(), form.URL, form.Mode == "image")
}
