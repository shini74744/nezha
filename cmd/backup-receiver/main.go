package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/nezhahq/nezha/pkg/backupreceiver"
	"golang.org/x/crypto/ssh"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
)

var version = "v0.1.1"

func main() {
	var config, key, user, directory, public string
	var port int
	var configure, showVersion bool
	flag.StringVar(&config, "config", "/etc/ddnezha-backup/receiver.json", "接收端配置")
	flag.StringVar(&key, "host-key", "/etc/ddnezha-backup/host-key", "接收端身份密钥")
	flag.StringVar(&user, "user", "", "备份账号")
	flag.StringVar(&directory, "directory", "", "备份目录")
	flag.StringVar(&public, "public-key", "", "面板公钥")
	flag.IntVar(&port, "port", 2022, "备份端口")
	flag.BoolVar(&configure, "configure", false, "配置备份目标")
	flag.BoolVar(&showVersion, "version", false, "显示版本")
	flag.Parse()
	if showVersion {
		fmt.Println(version)
		return
	}
	if configure {
		fp, err := backupreceiver.Configure(config, key, user, directory, public, port)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println("DDNEZHA_BACKUP_HOSTKEY=" + fp)
		fmt.Println("DDNEZHA_BACKUP_READY")
		return
	}
	current, err := backupreceiver.ReadConfig(config)
	if err != nil {
		log.Fatal(err)
	}
	data, err := os.ReadFile(key) // #nosec G304 -- administrator-supplied local host-key flag, never a client path.
	if err != nil {
		log.Fatal(err)
	}
	signer, err := ssh.ParsePrivateKey(data)
	if err != nil {
		log.Fatal("接收端身份密钥不可用")
	}
	listener, err := net.Listen("tcp", current.Listen)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	log.Printf("DDnezha backup receiver %s listening on %s", version, listener.Addr())
	if err = backupreceiver.Serve(ctx, listener, signer, func() (backupreceiver.Config, error) { return backupreceiver.ReadConfig(config) }); err != nil {
		log.Fatal(err)
	}
}
