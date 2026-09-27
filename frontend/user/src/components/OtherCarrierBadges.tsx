import {useState} from "react";
import {findCarrier} from "../../../shared/carriers";
import {safeLogoSource,validOtherRoutes} from "../../../shared/other-routes";
function Logo({src}:{src:string}) {
 const [failed,setFailed]=useState(false);
 return failed?null:<img src={src} alt="" aria-hidden="true" referrerPolicy="no-referrer"
  onError={()=>setFailed(true)} style={{width:16,height:12,objectFit:"contain",flexShrink:0}}/>;
}
export default function OtherCarrierBadges({entries}:{entries:unknown}){
 return <>{validOtherRoutes(entries).map((entry,index)=>{
  const selected=findCarrier(entry.carrier);
  const src=selected?.icon||(entry.carrier==="custom"?safeLogoSource(entry.logo):"");
  const title=selected?.label||(typeof entry.name==="string"&&entry.name)||"其他运营商";
  return <p key={index} title={title} data-other-carrier={entry.carrier||"none"}
   className="inline-flex items-center gap-[3px] max-w-full text-[9px] bg-stone-600 text-stone-200 dark:bg-stone-800 dark:text-stone-300 w-fit rounded-[5px] px-[3px] py-[1.5px]">
   {src&&<Logo key={src} src={src}/>}<span className="min-w-0 break-words">{entry.text}</span>
  </p>;
 })}</>;
}
