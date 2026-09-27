import {useState} from "react";
import {safeLogoSource} from "../../../shared/other-routes";
import type {LogoValue} from "../../../shared/logo";
export default function ProviderLogo({value}:{value?:LogoValue}){
 const src=safeLogoSource(value?.logo),[failed,setFailed]=useState("");
 if(!src||failed===src)return null;
 return <span data-provider-logo-box style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:80,height:28,alignSelf:"center",marginBottom:4}}>
  <img data-provider-logo src={src} alt="服务器厂商 Logo" referrerPolicy="no-referrer" onError={()=>setFailed(src)} style={{width:"auto",height:"auto",maxWidth:"100%",maxHeight:28,objectFit:"scale-down",objectPosition:"center"}}/>
 </span>;
}
