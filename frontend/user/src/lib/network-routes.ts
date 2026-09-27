export const carrierRoutes = [
 {key:"telecom",label:"中国电信",className:"bg-blue-600 text-blue-200 dark:bg-blue-800 dark:text-blue-300"},
 {key:"mobile",label:"中国移动",className:"bg-green-600 text-green-200 dark:bg-green-800 dark:text-green-300"},
 {key:"unicom",label:"中国联通",className:"bg-red-600 text-red-200 dark:bg-red-800 dark:text-red-300"},
 {key:"other",label:"其他运营商",className:"bg-stone-600 text-stone-200 dark:bg-stone-800 dark:text-stone-300"},
] as const;
export type CarrierKey = typeof carrierRoutes[number]["key"];
export type NetworkRoutes = Partial<Record<CarrierKey,string>>;
// Keep legacy classification in sync with the admin public-note editor.
export function readNetworkRoutes(plan:{networkRoutes?: NetworkRoutes;networkRoute?: string}): Record<CarrierKey,string> {
 const result:Record<CarrierKey,string>={telecom:"",mobile:"",unicom:"",other:""};
 const saved=plan.networkRoutes;
 if(saved && typeof saved==="object" && !Array.isArray(saved)){
  for(const {key} of carrierRoutes)result[key]=typeof saved[key]==="string"?saved[key]!.trim():"";
  return result; // Explicit fields win, including cleared fields and custom names.
 }
 for(const part of String(plan.networkRoute||"").split(/[,，｜|;；\n]+/).map(s=>s.trim()).filter(Boolean)){
  const matches:CarrierKey[]=[];
  if(/电信|telecom|\b(?:163(?:pp)?|cn2|ctg|as?4134|as?4809)\b/i.test(part))matches.push("telecom");
  if(/移动|china\s*mobile|\b(?:cmi(?:n2)?|as?58453|as?9808)\b/i.test(part))matches.push("mobile");
  if(/联通|unicom|\b(?:10099|9929|4837|as10099|as9929|as4837)\b/i.test(part))matches.push("unicom");
  const key=matches.length===1?matches[0]:"other";
  result[key]+=(result[key]?"｜":"")+part;
 }
 return result;
}
