import {useState} from "react";
import CarrierLogo from "./CarrierLogo";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function RouteLogo({value,carrier,color}:{value?:LogoValue;carrier:"telecom"|"mobile"|"unicom"|"other";color?:string}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState("");
 return src&&src!==failed?<img src={src} alt="" aria-hidden referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:16,height:12,objectFit:"contain",flexShrink:0}}/>:<CarrierLogo carrier={carrier} color={color}/>;
}
