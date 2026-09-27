import useSWR from "swr";
import {swrFetcher} from "@/api/api";
import type {LogoLibraryEntry} from "../../../shared/logo-library";
export default function useLogoLibrary(){return useSWR<LogoLibraryEntry[]>("/api/v1/logo/library",swrFetcher,{revalidateOnFocus:true,dedupingInterval:10000})}
