// Keep stored cycle codes intact: they are also used by renewal/date calculations.
export function formatBillingCycle(cycle:string|undefined,language:string):string{
 if(!cycle)return "";
 if(!/^zh(?:-|$)/i.test(language))return cycle;
 const labels:Record<string,string>={day:"日",week:"周",month:"月",year:"年"};
 return labels[cycle.toLowerCase()]??cycle;
}
