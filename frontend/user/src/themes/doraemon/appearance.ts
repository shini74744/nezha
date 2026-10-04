import {normalizeDoraemon} from "../../../../shared/doraemon-appearance";
export function doraemonAppearance(raw?:string){
 const config=normalizeDoraemon(raw),f=config.features.traffic;
 return {enabled:config.enabled&&f.enabled,interval:f.toggleInterval as number};
}
