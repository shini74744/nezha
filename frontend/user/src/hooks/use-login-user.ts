import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchLoginUser } from "@/lib/nezha-api";

export const loginUserQueryOptions = () => queryOptions({
 queryKey: ["login-user"],
 queryFn: fetchLoginUser,
 staleTime: 30000,
 retry: 0,
 refetchOnWindowFocus: "always",
 refetchOnReconnect: "always",
 refetchInterval: 30000,
 refetchIntervalInBackground: false,
});
export function useLoginUser() {
 const query = useQuery(loginUserQueryOptions());
 const viewer = query.data?.data?.id || 0;
 return { ...query, viewer, isAdmin: viewer > 0 && query.data?.data?.role === 0, isLogin: viewer > 0, session: query.data === undefined ? "unknown" : viewer ? "authenticated" : "anonymous" };
}
