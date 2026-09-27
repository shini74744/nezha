package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	_ "github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/pkg/logoasset"
	"os"
	"strings"
	"time"
)

func main() {
	dbPath := flag.String("db", "", "SQLite database")
	dir := flag.String("dir", "", "Logo directory")
	apply := flag.Bool("apply", false, "Apply only when dashboard is stopped")
	upgradeID := flag.Uint64("provider-id", 0, "Optional server whose provider logo is being upgraded")
	upgradeSource := flag.String("provider-source", "", "Explicit replacement image for that server")
	flag.Parse()
	if (*upgradeID == 0) != (*upgradeSource == "") {
		panic("provider-id and provider-source must be set together")
	}
	if *dbPath == "" || *dir == "" {
		panic("db and dir required")
	}
	db, e := sql.Open("sqlite3", *dbPath)
	must(e)
	defer db.Close()
	rows, e := db.Query("SELECT id,public_note FROM servers ORDER BY id")
	must(e)
	type update struct {
		ID       uint64
		Old, New string
		Count    int
	}
	var source, updates []update
	for rows.Next() {
		var u update
		must(rows.Scan(&u.ID, &u.Old))
		source = append(source, u)
	}
	must(rows.Err())
	must(rows.Close())
	if *upgradeID != 0 {
		found := false
		for _, u := range source {
			if u.ID == *upgradeID {
				found = true
			}
		}
		if !found {
			panic("provider server not found")
		}
	}
	failures := []uint64{}
	for _, u := range source {
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		raw := u.Old
		if u.ID == *upgradeID && *upgradeID != 0 {
			var note map[string]any
			decoder := json.NewDecoder(strings.NewReader(raw))
			decoder.UseNumber()
			must(decoder.Decode(&note))
			plan, ok := note["planDataMod"].(map[string]any)
			if !ok {
				panic("missing planDataMod")
			}
			logo, ok := plan["providerLogo"].(map[string]any)
			if !ok {
				panic("missing providerLogo")
			}
			if logo["logoOriginal"] == nil || logo["logoOriginal"] == "" {
				logo["logoOriginal"] = logo["logo"]
			}
			logo["logo"] = *upgradeSource
			b, err := json.Marshal(note)
			must(err)
			raw = string(b)
		}
		n, count, e := logoasset.ImportNote(ctx, *dir, raw)
		cancel()
		if e != nil {
			failures = append(failures, u.ID)
			fmt.Printf("IMPORT_FAILED server_id=%d error=%s\n", u.ID, e)
			continue
		}
		if count > 0 || n != u.Old {
			u.New = n
			u.Count = count
			updates = append(updates, u)
		}
	}
	if len(failures) > 0 {
		fmt.Println("Migration not applied; unavailable logos must be resolved first")
		os.Exit(2)
	}
	if *apply {
		tx, e := db.Begin()
		must(e)
		defer tx.Rollback()
		for _, u := range updates {
			r, e := tx.Exec("UPDATE servers SET public_note=? WHERE id=? AND public_note=?", u.New, u.ID, u.Old)
			must(e)
			n, e := r.RowsAffected()
			must(e)
			if n != 1 {
				panic("public note changed concurrently")
			}
		}
		must(tx.Commit())
	}
	ids := []uint64{}
	count := 0
	for _, u := range updates {
		ids = append(ids, u.ID)
		count += u.Count
	}
	b, _ := json.Marshal(map[string]any{"applied": *apply, "servers": ids, "logo_fields": count, "failed": failures})
	fmt.Println(string(b))
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
