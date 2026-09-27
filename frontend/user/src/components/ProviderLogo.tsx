import {useState} from "react";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function ProviderLogo({value}:{value?:LogoValue}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState("");
 if(!src||failed===src)return null;
 return <img data-provider-logo src={src} alt="服务器厂商 Logo" referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:80,height:28,maxWidth:"100%",objectFit:"contain",objectPosition:"left center",marginBottom:4}}/>;
}
