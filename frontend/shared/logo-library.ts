import type {LogoValue} from "./logo";
export type LogoLibraryEntry=LogoValue&{id:string;groupId?:string;kind:"provider"|"carrier";name:string;regions:string[];aliases:string;background:string;source:string;builtin:boolean;version:number};
export function libraryLogo(e:LogoLibraryEntry):LogoValue{return {logoLibraryId:e.id,logoLibraryName:e.name,logo:e.logo||"",logoOriginal:e.logoOriginal||"",logoWebsite:e.logoWebsite||"",logoBackground:e.background||""}}
