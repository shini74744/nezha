import {createContext,useContext,useMemo,type ReactNode} from "react";
import {normalizeDoraemon,type DoraemonFeature} from "../../../../shared/doraemon-appearance";
const Context=createContext(normalizeDoraemon());
export function DoraemonAppearanceProvider({children,raw,ready}:{children:ReactNode;raw?:string;ready:boolean}){
 const config=useMemo(()=>ready?normalizeDoraemon(raw):{...normalizeDoraemon(),enabled:false},[raw,ready]);
 return <Context.Provider value={config}>{children}</Context.Provider>;
}
export function useDoraFeature(key:DoraemonFeature){
 const config=useContext(Context);
 return config.enabled&&config.features[key].enabled;
}
