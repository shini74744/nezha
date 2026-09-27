export type OtherRouteEntry = {carrier:string;text:string;country?:string;name?:string;logo?:string;logoOriginal?:string;logoWebsite?:string;color?:string;[key:string]:unknown};
export function safeLogoSource(value:unknown):string {
 if(typeof value!=="string")return "";
 if(/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value))return value;
 if(/^\/api\/v1\/logo\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif|ico|svg)$/.test(value))return value;
 return "";
}
export function validOtherRoutes(value:unknown):OtherRouteEntry[] {
 if(!Array.isArray(value))return [];
 return value.filter((e):e is OtherRouteEntry=>!!e&&typeof e==="object"&&typeof e.carrier==="string"&&typeof e.text==="string"&&!!e.text.trim());
}
