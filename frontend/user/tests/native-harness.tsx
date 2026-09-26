import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter,Link} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ThemeProvider} from "../src/components/ThemeProvider";
import {AppearanceProvider} from "../src/appearance/context";
import {NativeEffects} from "../src/appearance/effects";
import {NativeName,NativeSpeed,NativeDescription,NativeGreeting,NativeTraffic,NativeFooter} from "../src/appearance/widgets";
import {defaults} from "../src/appearance/config";
import "../src/index.css";
function Harness(){
 const [config,setConfig]=useState(defaults());
 Object.assign(window,{setNativeConfig:(keys:string[],overrides={})=>{const c=defaults();c.enabled=keys.length>0;for(const [key,f]of Object.entries(c.features)){f.enabled=keys.includes(key);Object.assign(f,overrides[key]||{})}setConfig(c)},nativeDefaults:defaults});
 return <AppearanceProvider raw={JSON.stringify(config)}><NativeEffects/><main style={{position:"relative",zIndex:20,minHeight:1800}}><h1>Native feature verification</h1><Link to="/">home</Link> <Link to="/server/11">detail</Link><p><NativeGreeting fallback="original greeting"/></p><p><NativeDescription fallback="original description"/></p><div className="flex items-center font-medium text-sm"><span data-issues-count-animation="true">12</span><span className="opacity-50">:</span><span data-issues-count-animation="true">34</span><span className="opacity-50">:</span><span data-issues-count-animation="true">56</span></div><div><NativeName online>Server A</NativeName><NativeSpeed bytes={15728640} direction="up"/><NativeTraffic serverId={11}/></div><NativeFooter/></main></AppearanceProvider>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={new QueryClient()}><BrowserRouter><ThemeProvider><Harness/></ThemeProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);
