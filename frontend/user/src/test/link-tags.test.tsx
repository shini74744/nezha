import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import ServerLinkTags from "@/components/ServerLinkTags";
import {safeLink} from "../../../shared/link-tags";
import {parsePublicNote} from "@/lib/utils";
describe("server link tags",()=>{
 it.each([
  ["baidu.com","https://baidu.com/"],
  [" example.com:8080/path?q=1#top ","https://example.com:8080/path?q=1#top"],
  ["http://example.com/path","http://example.com/path"],
  ["https://example.com/path","https://example.com/path"],
  ["192.0.2.1:8080","https://192.0.2.1:8080/"],
  ["localhost:3000","https://localhost:3000/"],
  ["[2001:db8::1]:8080","https://[2001:db8::1]:8080/"],
 ])("normalizes %s without requiring HTTPS",(input,expected)=>expect(safeLink(input)).toBe(expected));
 it.each(["javascript:alert(1)","data:text/html,x","ftp://example.com","/relative/path","//example.com","example.com@evil.com","https://user:pass@example.com","java\nscript:alert(1)","example.com\\@evil.com","not a domain","", "example.com:99999"])("rejects unsafe or invalid input %j",input=>expect(safeLink(input)).toBe(""));
 it("renders a bare domain as an absolute HTTPS link",()=>{
  render(<ServerLinkTags tags={[{name:"官网",url:"baidu.com"}]}/>);
  expect(screen.getByRole("link",{name:"官网"})).toHaveAttribute("href","https://baidu.com/");
 });
 it.each([undefined,{amount:"33刀",cycle:"Month"}])("preserves tags with billing %j",billingDataMod=>{
  const tags=[{name:"购买",url:"https://example.com/buy"}];
  expect(parsePublicNote(JSON.stringify({billingDataMod,planDataMod:{linkTags:tags}}))?.planDataMod?.linkTags).toEqual(tags);
 });
 it("opens links in new tabs without triggering parent card navigation",()=>{
  const click=vi.fn();render(<div onClick={click}><ServerLinkTags tags={[{name:"购买",url:"https://example.com/buy"}]}/></div>);
  const link=screen.getByRole("link",{name:"购买"});expect(link).toHaveAttribute("target","_blank");expect(link).toHaveAttribute("rel","noopener noreferrer");
  fireEvent.click(link);expect(click).not.toHaveBeenCalled();
 });
 it("ignores blank and unsafe links",()=>{
  const {container}=render(<ServerLinkTags tags={[null,{name:"",url:"https://example.com"},{name:"bad",url:"javascript:alert(1)"},{name:"bad",url:"data:text/html,x"}]}/>);
  expect(container).toBeEmptyDOMElement();expect(safeLink("https://user:pass@example.com")).toBe("");
 });
});
