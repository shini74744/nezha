#!/usr/bin/env python3
"""Offline, auditable repair of pre-fix daily ledger. Never alters raw transfers/checkpoints."""
import argparse, collections, datetime, gzip, hashlib, json, os, pathlib, sqlite3

ZONE = datetime.timezone(datetime.timedelta(hours=8))

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()

def digest_rows(db, table, order):
    h = hashlib.sha256()
    for row in db.execute('SELECT * FROM "' + table + '" ORDER BY ' + order):
        h.update(encoded(list(row))); h.update(b"\n")
    return h.hexdigest()

def load_rows(db):
    columns = [r[1] for r in db.execute("PRAGMA table_info(plan_traffic_days)")]
    return [dict(zip(columns, row)) for row in db.execute("SELECT * FROM plan_traffic_days ORDER BY uuid,day")]

def plan(db):
    original = load_rows(db)
    sources = {(u,day): (n,inp,out) for u,day,n,inp,out in db.execute("""
        SELECT s.uuid,date(t.created_at,'+8 hours','-1 second'),count(*),sum(t.`in`),sum(t.`out`)
        FROM transfers t JOIN servers s ON s.id=t.server_id WHERE s.uuid<>''
        GROUP BY s.uuid,date(t.created_at,'+8 hours','-1 second')""")}
    starts = {u:datetime.datetime.fromtimestamp(ms/1000,ZONE).date().isoformat()
              for u,ms in db.execute("SELECT uuid,covered_from FROM plan_traffic_checkpoints WHERE covered_from>0")}
    changes=[]
    for row in original:
        uuid,day=row["uuid"],row["day"]
        start=starts.get(uuid)
        if not start or day<start:
            continue  # Keep pre-ledger, legacy-seeded history unchanged.
        after=dict(row)
        after.update(partial=1,estimated=1)
        if (uuid,day) in sources:
            n,inp,out=sources[(uuid,day)]
            assert n>0 and inp>=0 and out>=0
            after.update({"in":inp,"out":out,"unreliable":0})
            reason="available_legacy_buckets"
        else:
            after["unreliable"]=1  # Retain disputed bytes, but exclude them from usage.
            reason="source_unavailable"
        changes.append({"before":row,"after":after,"reason":reason})
    return original,changes

def summary(changes):
    days=collections.defaultdict(lambda:{"recomputed":0,"unavailable":0,"old_bytes":0,"recorded_bytes":0})
    for change in changes:
        row,after=change["before"],change["after"]
        d=days[row["day"]]
        d["old_bytes"]+=row["in"]+row["out"]
        if change["reason"]=="source_unavailable":
            d["unavailable"]+=1
        else:
            d["recomputed"]+=1
            d["recorded_bytes"]+=after["in"]+after["out"]
    return {"changed_rows":len(changes),"days":dict(sorted(days.items()))}

def update_rows(db,changes):
    columns={r[1] for r in db.execute("PRAGMA table_info(plan_traffic_days)")}
    for col in ("partial","unreliable"):
        if col not in columns:
            db.execute("ALTER TABLE plan_traffic_days ADD COLUMN "+col+" numeric NOT NULL DEFAULT 0")
    for change in changes:
        r=change["after"]
        cursor=db.execute("UPDATE plan_traffic_days SET `in`=?,`out`=?,estimated=?,partial=?,unreliable=? WHERE uuid=? AND day=?",
                          (r["in"],r["out"],r["estimated"],r["partial"],r["unreliable"],r["uuid"],r["day"]))
        assert cursor.rowcount==1

def save_private(path,data):
    with path.open("xb") as out:
        out.write(data);out.flush();os.fsync(out.fileno())

def apply(db,output):
    backup=output/"ledger-before.json.gz"
    manifest=output/"repair-manifest.json.gz"
    marker=output/"repair-committed.json"
    assert not marker.exists() and not backup.exists(), "Repair already attempted; inspect its manifest, do not replay."
    db.execute("BEGIN IMMEDIATE")
    try:
        original,changes=plan(db)
        invariant={t:digest_rows(db,t,o) for t,o in (("transfers","id"),("plan_traffic_checkpoints","uuid"),("servers","id"))}
        save_private(backup,gzip.compress(encoded(original)))
        with gzip.open(backup,"rb") as f:
            assert json.load(f)==original
        save_private(manifest,gzip.compress(encoded(changes)))
        update_rows(db,changes)
        current={(r["uuid"],r["day"]):r for r in load_rows(db)}
        assert len(current)==len(original)
        for c in changes:
            assert current[(c["after"]["uuid"],c["after"]["day"])]==c["after"]
        changed={(c["before"]["uuid"],c["before"]["day"]) for c in changes}
        for r in original:
            if (r["uuid"],r["day"]) not in changed:
                assert all(current[(r["uuid"],r["day"])][k]==v for k,v in r.items())
        for t,o in (("transfers","id"),("plan_traffic_checkpoints","uuid"),("servers","id")):
            assert invariant[t]==digest_rows(db,t,o), t+" changed"
        assert db.execute("PRAGMA quick_check").fetchone()[0]=="ok"
        db.commit()
        result=summary(changes)
        result["preserved_tables_sha256"]=invariant
        result["ledger_backup_sha256"]=hashlib.sha256(backup.read_bytes()).hexdigest()
        save_private(marker,encoded(result))
        return result
    except BaseException:
        db.rollback()
        raise

def restore(db,output):
    with gzip.open(output/"ledger-before.json.gz","rb") as f:
        original=json.load(f)
    db.execute("BEGIN IMMEDIATE")
    try:
        current={(r["uuid"],r["day"]):r for r in load_rows(db)}
        assert len(current)==len(original), "Unexpected new ledger rows; inspect before rollback."
        available={r[1] for r in db.execute("PRAGMA table_info(plan_traffic_days)")}
        for r in original:
            cols=[k for k in ("in","out","estimated","partial","unreliable") if k in available]
            db.execute("UPDATE plan_traffic_days SET "+",".join("`"+k+"`=?" for k in cols)+" WHERE uuid=? AND day=?",
                       [r.get(k,0) for k in cols]+[r["uuid"],r["day"]])
        db.commit()
    except BaseException:
        db.rollback();raise
    return {"restored_rows":len(original)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--mode",choices=("dry-run","apply","restore"),default="dry-run")
    args=parser.parse_args()
    os.umask(0o077)
    output=pathlib.Path(args.output)
    output.mkdir(parents=True,exist_ok=True)
    dbpath=pathlib.Path(args.database).resolve()
    assert dbpath.is_file()
    uri=dbpath.as_uri()+("?mode=ro" if args.mode=="dry-run" else "?mode=rw")
    with sqlite3.connect(uri,uri=True,timeout=30) as db:
        if args.mode=="dry-run":
            db.execute("BEGIN")
            result=summary(plan(db)[1]);db.rollback()
        elif args.mode=="apply":
            result=apply(db,output)
        else:
            result=restore(db,output)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
