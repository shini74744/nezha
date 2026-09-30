import {useState} from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {afterEach,describe,it,expect} from "vitest";
import LinkTagsEditor from "@/components/LinkTagsEditor";
import {type PublicNote,validatePublicNote} from "@/lib/public-note";
afterEach(cleanup);
function Editor(){
 const [note,setNote]=useState<PublicNote>({planDataMod:{linkTags:[{name:"",url:""}]}});
 return <><LinkTagsEditor note={note} onChange={setNote}/><output>{String(validatePublicNote(note).valid)}</output></>;
}
describe("link tag URL input",()=>{
 it.each(["baidu.com","http://example.com","https://example.com"])("accepts typing %s",url=>{
  render(<Editor/>);
  expect(screen.getByLabelText("标签名称 1").getAttribute("placeholder")).toBeNull();
  expect(screen.getByLabelText("标签网址 1").getAttribute("placeholder")).toBeNull();
  fireEvent.change(screen.getByLabelText("标签名称 1"),{target:{value:"官网"}});
  fireEvent.change(screen.getByLabelText("标签网址 1"),{target:{value:url}});
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("true");
 });
 it("still requires a name",()=>{
  render(<Editor/>);
  fireEvent.change(screen.getByLabelText("标签网址 1"),{target:{value:"baidu.com"}});
  expect(screen.queryByRole("alert")).not.toBeNull();
  expect(screen.getByRole("status").textContent).toBe("false");
 });
});
