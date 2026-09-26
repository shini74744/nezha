import {useEffect,useState} from "react";
import {useAppearance} from "./context";
export const isMobileDevice=()=>/Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(navigator.userAgent)||innerWidth<768;
export function usePeakCutDefault(){
 const config=useAppearance(),[mobile,setMobile]=useState(isMobileDevice);
 useEffect(()=>{const update=()=>setMobile(isMobileDevice());window.addEventListener("resize",update);return()=>window.removeEventListener("resize",update)},[]);
 if(!config.enabled)return Boolean(window.ForcePeakCutEnabled);
 const f=config.features.peakCut;
 return !!f.enabled&&!!f[mobile?"mobile":"desktop"];
}
