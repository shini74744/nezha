import type { NezhaServer } from "@/types/nezha-api";
export function homeNetworkServer(server: NezhaServer): NezhaServer {
 const n = server.home_network;
 if (!n) return server;
 // NaN is display-only: formatters must show a dash, never substitute aggregate.
 return {...server, state: {...server.state,
  net_in_speed: n.rates_available ? n.in_speed : NaN,
  net_out_speed: n.rates_available ? n.out_speed : NaN,
  net_in_transfer: n.counters_available ? n.in_transfer : NaN,
  net_out_transfer: n.counters_available ? n.out_transfer : NaN,
 }};
}
