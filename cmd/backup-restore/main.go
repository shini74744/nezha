package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"

	"github.com/nezhahq/nezha/pkg/backuprestore"
	"golang.org/x/term"
)

func main() {
	bundle := flag.String("bundle", "bundle.json", "恢复包中的 bundle.json 路径")
	output := flag.String("output", "", "新的恢复目录（必须不存在）")
	flag.Parse()
	if *output == "" {
		fmt.Fprintln(os.Stderr, "请指定 -output 新目录")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	err := backuprestore.Restore(ctx, *bundle, *output, func() (string, error) {
		fmt.Fprint(os.Stderr, "备份密码：")
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return "", fmt.Errorf("请在交互终端输入密码: %w", err)
		}
		return string(b), nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "恢复失败：", err)
		os.Exit(1)
	}
	fmt.Println("校验及恢复完成：", *output)
}
