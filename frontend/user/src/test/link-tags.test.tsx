import {render,screen,fireEvent} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import ServerLinkTags from "@/components/ServerLinkTags";
import {safeLink} from "../../../shared/link-tags";
import {parsePublicNote} from "@/lib/utils";
describe("server link tags",()=>{
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
