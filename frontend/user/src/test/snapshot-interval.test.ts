import {describe,it,expect} from "vitest";
import {snapshotInterval} from "@/lib/snapshot-interval";
describe("snapshot report cadence",()=>{
 it("keeps the regular three-second agent cadence",()=>expect(snapshotInterval([0,3134,6270,9402,12536])).toBe(3134));
 it("does not let an outage dominate the cadence",()=>expect(snapshotInterval([0,3000,6000,36000,39000])).toBe(3000));
 it("handles a configurable slow agent",()=>expect(snapshotInterval([0,15000,30000,45000])).toBe(15000));
 it("handles empty and singleton data",()=>{expect(snapshotInterval([])).toBe(1000);expect(snapshotInterval([1])).toBe(1000)});
 it("ignores duplicate timestamps",()=>expect(snapshotInterval([0,0,3000,6000])).toBe(3000));
});
