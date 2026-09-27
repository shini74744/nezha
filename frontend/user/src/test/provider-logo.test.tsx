import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import ProviderLogo from "@/components/ProviderLogo";
import RouteLogo from "@/components/RouteLogo";
import {parsePublicNote} from "@/lib/utils";
describe("provider and overridden logos",()=>{
 it.each([true,false])("preserves logo configuration, billing=%s",billing=>{const value={logo:"https://example.com/logo.png",logoOriginal:"https://example.com/old.png"};const result=parsePublicNote(JSON.stringify({...(billing?{billingDataMod:{}}:{}),planDataMod:{providerLogo:value,networkRouteLogos:{telecom:value}}}));expect(result?.planDataMod?.providerLogo).toEqual(value);expect(result?.planDataMod?.networkRouteLogos?.telecom).toEqual(value)});
 it("fits without distortion and hides a failed provider image",()=>{const {rerender}=render(<ProviderLogo value={{logo:"https://example.com/a.png"}}/>);const img=screen.getByAltText("服务器厂商 Logo");expect(img).toHaveStyle({width:"80px",height:"28px",objectFit:"contain"});fireEvent.error(img);expect(screen.queryByAltText("服务器厂商 Logo")).toBeNull();rerender(<ProviderLogo value={{logo:"https://example.com/b.png"}}/>);expect(screen.getByAltText("服务器厂商 Logo")).toBeInTheDocument()});
 it("restores built-in on invalid or failed override",()=>{const {container,rerender}=render(<RouteLogo carrier="telecom" value={{logo:"javascript:alert(1)"}}/>);expect(container.querySelector("svg")).not.toBeNull();rerender(<RouteLogo carrier="telecom" value={{logo:"https://example.com/fail.png"}}/>);fireEvent.error(container.querySelector("img")!);expect(container.querySelector("svg")).not.toBeNull()});
});
