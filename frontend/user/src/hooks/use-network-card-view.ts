import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
export type NetworkCardConfig={id?:number;network_display_mode?:string;network_default_view?:string;connectivity_disabled?:boolean;connectivity_local_only?:boolean};
export function networkCardMode(server?:NetworkCardConfig){
 const mode=server?.network_display_mode,conn=!server?.connectivity_disabled||server?.connectivity_local_only;
 if(mode==="hidden"||mode==="latency")return mode;
 if(mode==="connectivity")return conn?"connectivity":"hidden";
 if(mode==="both")return conn?"both":"latency";
 return conn?"both":"hidden";
}
export function useNetworkCardView(server?:NetworkCardConfig){
 const {t,i18n}=useTranslation();
 const mode=networkCardMode(server), defaultView=server?.network_default_view==="latency"?"latency":"connectivity";
 const [selected,setSelected]=useState(defaultView);
 useEffect(()=>setSelected(defaultView),[server?.id,defaultView]);
 const view=mode==="latency"?"latency":mode==="connectivity"?"connectivity":selected;
 const label=view==="latency"?t("tabSwitch.Latency",{defaultValue:i18n.language?.startsWith("zh")?"延迟":"Latency"}):t("tabSwitch.Connectivity");
 return {mode,view,visible:mode!=="hidden",label,toggle:()=>{if(mode==="both")setSelected(v=>v==="latency"?"connectivity":"latency")}};
}
