export const defaultCarrierColors={telecom:"#2563eb",mobile:"#16a34a",unicom:"#dc2626",other:"#78716c"} as const;
export function safeCarrierColor(value:unknown):string|undefined {
 return typeof value==="string"&&/^#[0-9a-f]{6}$/i.test(value)?value:undefined;
}
export function carrierColorStyle(value:unknown) {
 const backgroundColor=safeCarrierColor(value);
 if(!backgroundColor)return undefined;
 const channels=[1,3,5].map(i=>parseInt(backgroundColor.slice(i,i+2),16)/255)
  .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
 const luminance=0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
 return {backgroundColor,color:luminance>0.179?"#000000":"#ffffff"};
}
