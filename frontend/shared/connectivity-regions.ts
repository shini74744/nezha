import registry from "../../service/connectivity/regions.json";

export const connectivityRegions = registry;
export function connectivityRegionName(region: typeof registry[number], language: string) {
  if (/^zh(-TW|-HK|-Hant)/i.test(language)) return region.tw;
  if (/^zh/i.test(language)) return region.zh;
  return region.en;
}

// Node ISO country code, never the visitor's locale/IP. Keep configured order inside each group.
export function orderedConnectivityRegions(countryCode?: string) {
  const code = countryCode?.trim().toUpperCase();
  const local = registry.find(region => region.country && region.country === (code === "UK" ? "GB" : code));
  const ids = [...new Set([local?.id, "usa", "global", ...registry.map(region => region.id)])];
  return ids.flatMap(id => registry.filter(region => region.id === id));
}
