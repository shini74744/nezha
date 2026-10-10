import datetime, importlib.util, pathlib, sqlite3, tempfile, unittest
spec=importlib.util.spec_from_file_location("repair",pathlib.Path(__file__).with_name("repair-plan-traffic-20261010.py"))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)

class RepairTest(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.executescript("""
        CREATE TABLE servers(id INTEGER PRIMARY KEY,uuid TEXT);
        CREATE TABLE transfers(id INTEGER PRIMARY KEY,server_id INTEGER,created_at TEXT,`in` INTEGER,`out` INTEGER);
        CREATE TABLE plan_traffic_checkpoints(uuid TEXT PRIMARY KEY,covered_from INTEGER,at INTEGER,`in` INTEGER,`out` INTEGER,uptime INTEGER);
        CREATE TABLE plan_traffic_days(uuid TEXT,day TEXT,`in` INTEGER,`out` INTEGER,estimated NUMERIC NOT NULL DEFAULT 0,PRIMARY KEY(uuid,day));
        INSERT INTO servers VALUES(1,'a');
        INSERT INTO transfers VALUES(1,1,'2026-10-10 01:00:00+08:00',100,200);
        INSERT INTO transfers VALUES(2,1,'2026-10-11 00:00:00+08:00',30,40);
        INSERT INTO plan_traffic_days VALUES('a','2026-09-26',10,20,1);
        INSERT INTO plan_traffic_days VALUES('a','2026-09-27',999999,888888,0);
        INSERT INTO plan_traffic_days VALUES('a','2026-10-10',999999,888888,0);
        """)
        start=int(datetime.datetime(2026,9,27,tzinfo=repair.ZONE).timestamp()*1000)
        self.db.execute("INSERT INTO plan_traffic_checkpoints VALUES('a',?,123,456,789,100)",(start,))
        self.db.commit()
        self.tmp=tempfile.TemporaryDirectory()
        self.output=pathlib.Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup);self.addCleanup(self.db.close)

    def test_repair_boundaries_preservation_and_restore(self):
        before=repair.load_rows(self.db)
        result=repair.apply(self.db,self.output)
        self.assertEqual(result["changed_rows"],2)
        rows={r["day"]:r for r in repair.load_rows(self.db)}
        self.assertEqual(rows["2026-09-26"]["in"],10)
        self.assertEqual(rows["2026-09-26"]["partial"],0)
        self.assertEqual(rows["2026-09-27"]["in"],999999)
        self.assertEqual(rows["2026-09-27"]["unreliable"],1)
        self.assertEqual(rows["2026-10-10"]["in"],130)
        self.assertEqual(rows["2026-10-10"]["out"],240)
        self.assertEqual(rows["2026-10-10"]["partial"],1)
        with self.assertRaises(AssertionError):
            repair.apply(self.db,self.output)
        repair.restore(self.db,self.output)
        for old,current in zip(before,repair.load_rows(self.db)):
            self.assertTrue(all(current[k]==v for k,v in old.items()))

    def test_failure_is_atomic_and_original_backup_survives(self):
        before=repair.load_rows(self.db)
        self.db.execute("CREATE TRIGGER deny_update BEFORE UPDATE ON plan_traffic_days BEGIN SELECT RAISE(ABORT,'fixture'); END")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            repair.apply(self.db,self.output)
        self.assertEqual(before,repair.load_rows(self.db))
        self.assertTrue((self.output/"ledger-before.json.gz").exists())
        self.assertFalse((self.output/"repair-committed.json").exists())
        self.db.execute("DROP TRIGGER deny_update");self.db.commit()
        repair.restore(self.db,self.output)
        self.assertEqual(before,repair.load_rows(self.db))

if __name__=="__main__": unittest.main()
