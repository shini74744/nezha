import type {
	MetricType,
	NezhaServer,
	NezhaWebsocketResponse,
} from "@/types/nezha-api";
export function networkInterfaceMetric(
	name: string,
	direction: "in" | "out",
): MetricType {
	if (!name) return direction === "in" ? "net_in_speed" : "net_out_speed";
	const hex = Array.from(new TextEncoder().encode(name), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	return ("nic_" + hex + "_" + direction + "_speed") as MetricType;
}
export const HOME_NETWORK_SELECTION = "\u0001home";
export function networkRate(server: NezhaServer, name: string | string[]): {upload:number|null;download:number|null} {
 if (Array.isArray(name)) {
  const rows = [...new Set(name)].map(n => networkRate(server, n));
  return {upload: rows.every(r=>r.upload!==null) ? rows.reduce((s,r)=>s+(r.upload??0),0) : null, download: rows.every(r=>r.download!==null) ? rows.reduce((s,r)=>s+(r.download??0),0) : null};
 }
	if (!name)
		return {
			upload: server.state.net_out_speed,
			download: server.state.net_in_speed,
		};
	const row = server.state.network_interfaces?.find((n) => n.name === name);
	return row?.available
		? { upload: row.out_speed, download: row.in_speed }
		: { upload: null, download: null };
}
export type NetworkRatePoint = {
	timeStamp: string;
	upload: number | null;
	download: number | null;
};
export function networkRateHistory(
	history: NezhaWebsocketResponse[],
	server: NezhaServer,
	now: number,
	name: string | string[],
): NetworkRatePoint[] {
	const rows = new Map<number, NetworkRatePoint>();
	for (const message of [...history, { now, servers: [server] }]) {
		const item = message.servers.find((s) => s.id === server.id);
		if (!item || !Number.isFinite(message.now)) continue;
		const rate = networkRate(item, name);
		rows.set(message.now, {
			timeStamp: String(message.now),
			upload: rate.upload === null ? null : rate.upload / 1024 ** 2,
			download: rate.download === null ? null : rate.download / 1024 ** 2,
		});
	}
	return [...rows.entries()]
		.sort((a, b) => a[0] - b[0])
		.slice(-30)
		.map(([, point]) => point);
}
export function networkHistoricalPoints(
	series: { ts: number; value: number }[][] | undefined,
	interval = 30000,
): NetworkRatePoint[] {
 const rows = new Map<number, NetworkRatePoint>();
 const sources = series ?? [];
 const maps = sources.map(points => new Map(points.map(p => [p.ts,p.value])));
 const timestamps = [...new Set(sources.flatMap(points=>points.map(p=>p.ts)))].sort((a,b)=>a-b);
 for (const ts of timestamps) {
  const sum = (direction:number) => {
   const values = maps.filter((_,i)=>i%2===direction).map(m=>m.get(ts));
   return values.length && values.every(v=>typeof v==="number"&&Number.isFinite(v)) ? values.reduce<number>((s,v)=>s+(v??0),0)/1024**2 : null;
  };
  rows.set(ts,{timeStamp:String(ts),upload:sum(0),download:sum(1)});
 }
 const result:NetworkRatePoint[]=[];
 for(const [ts,point] of rows){
  const previous=result[result.length-1];
  if(previous&&ts-Number(previous.timeStamp)>interval*1.5)result.push({timeStamp:String(Number(previous.timeStamp)+interval),upload:null,download:null});
  result.push(point);
 }
 return result;
}
