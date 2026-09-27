import {useState} from "react";
import {carrierColorStyle,safeCarrierColor} from "../../../shared/carrier-colors";
import {findCarrier} from "../../../shared/carriers";
import {safeLogoSource,validOtherRoutes} from "../../../shared/other-routes";
function Logo({src,background}:{src:string;background?:string}) {
 const [failed,setFailed]=useState(false);
 return failed?null:<img src={src} alt="" aria-hidden="true" referrerPolicy="no-referrer"
  onError={()=>setFailed(true)} style={{backgroundColor:background,width:16,height:12,objectFit:"contain",flexShrink:0}}/>;
}
export default function OtherCarrierBadges({entries,color}:{entries:unknown;color?:string}){
 return <>{validOtherRoutes(entries).map((entry,index)=>{
  const selected=findCarrier(entry.carrier);
  const src=safeLogoSource(entry.logo)||selected?.icon;
  const title=selected?.label||(typeof entry.name==="string"&&entry.name)||"其他运营商";
  return <p key={index} title={title} data-other-carrier={entry.carrier||"none"} style={carrierColorStyle(safeCarrierColor(entry.color)||color)}
   className="inline-flex items-center gap-[3px] max-w-full text-[9px] bg-stone-600 text-stone-200 dark:bg-stone-800 dark:text-stone-300 w-fit rounded-[5px] px-[3px] py-[1.5px]">
   {src&&<Logo key={src} src={src} background={entry.logo?undefined:selected?.logoBackground}/>}<span className="min-w-0 break-words">{entry.text}</span>
  </p>;
 })}</>;
}
