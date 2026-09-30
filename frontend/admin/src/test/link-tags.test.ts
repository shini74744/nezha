import {describe,it,expect} from "vitest";
import {parseEditableNote,serializePublicNote,validatePublicNote} from "@/lib/public-note";
import {chineseNote} from "@/lib/public-note-compat";
describe("link tag editor notes",()=>{
 it.each(["baidu.com","example.com:8080/path?q=1#top","http://example.com","https://example.com"])("accepts and preserves %s",url=>{
  const note={planDataMod:{linkTags:[{name:"官网",url}]}};
  expect(validatePublicNote(note).valid).toBe(true);
  expect(JSON.parse(serializePublicNote(note)).planDataMod.linkTags[0].url).toBe(url);
 });
 it("round trips Chinese label names and URLs",()=>{
  const note={planDataMod:{linkTags:[{name:"购买",url:"https://example.com/buy"}]}};
  const restored=parseEditableNote(chineseNote(note));expect(restored.planDataMod?.linkTags).toEqual(note.planDataMod.linkTags);
  expect(JSON.parse(serializePublicNote(restored)).planDataMod.linkTags).toEqual(note.planDataMod.linkTags);
 });
 it("requires both fields and safe protocols, allowing unused blank rows",()=>{
  for(const link of [{name:"",url:"https://example.com"},{name:"X",url:"javascript:alert(1)"}])expect(validatePublicNote({planDataMod:{linkTags:[link]}}).valid).toBe(false);
  expect(validatePublicNote({planDataMod:{linkTags:[{name:"",url:""}]}}).valid).toBe(true);
 });
});
