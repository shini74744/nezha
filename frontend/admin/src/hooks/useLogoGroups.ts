import useSWR from "swr";
import {swrFetcher} from "@/api/api";
export type LogoGroup={id:string;name:string;version:number};
export default function useLogoGroups(){return useSWR<LogoGroup[]>("/api/v1/logo/groups",swrFetcher,{revalidateOnFocus:true,dedupingInterval:10000})}
