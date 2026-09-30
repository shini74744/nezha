import {NativeName} from "@/appearance/widgets";
import {cn,type PublicNoteData} from "@/lib/utils";
import ServerFlag from "./ServerFlag";
import ProviderLogo from "./ProviderLogo";
import BillingInfo from "./billingInfo";
import ServerLinkTags from "./ServerLinkTags";
import {safeLogoSource} from "../../../shared/other-routes";
import "./server-identity.css";
export default function ServerIdentity({online,name,country,parsedData,fixed=false,inline=false}:{online:boolean;name:string;country:string;parsedData:PublicNoteData|null;fixed?:boolean;inline?:boolean}){
 const logo=parsedData?.planDataMod?.providerLogo,hasLogo=!!safeLogoSource(logo?.logo);
 return <section data-server-identity data-has-provider={hasLogo?"true":undefined} data-inline={inline?"true":undefined} className={cn("nz-server-identity grid items-center gap-x-2 gap-y-1",inline?"lg:w-36":!fixed?"lg:w-40":"")} style={{gridTemplateColumns:"auto auto minmax(0,1fr)"}}>
  <ProviderLogo value={logo} mobileSlot={!inline} offline={!online}/>
  <span data-server-status className={cn("h-2 w-2 shrink-0 rounded-full self-center",online?"bg-green-500":"bg-red-500")}/>
  <div data-server-flag className="flex min-w-[17px] items-center justify-center"><ServerFlag country_code={country}/></div>
  <p data-server-name className="relative break-normal text-xs font-bold tracking-tight leading-4 min-w-0"><NativeName online={online}>{name}</NativeName></p>
  <div data-server-billing className={cn("col-start-3 min-w-0",inline?"":"hidden lg:block",fixed?"lg:hidden":"")}>{parsedData?.billingDataMod&&<BillingInfo parsedData={parsedData}/>}<ServerLinkTags tags={parsedData?.planDataMod?.linkTags}/></div>
 </section>;
}
