// Agent reporting cadence is configurable. Infer it from recorded timestamps;
// a fixed one-second threshold incorrectly splits normal three-second reports.
export function snapshotInterval(timestamps:number[]):number {
 const gaps=timestamps.slice(1).map((ts,i)=>ts-timestamps[i]).filter(gap=>gap>0).sort((a,b)=>a-b);
 return gaps.length?Math.max(1000,gaps[Math.floor((gaps.length-1)/2)]):1000;
}
