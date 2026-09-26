import {it,expect} from "vitest";
import {defaults,normalize,validate} from "@/appearance/config";
const row={id:"custom-example",name:"自定义",imageUrl:"https://example.test/role.png"};
it("accepts custom roles and upgrades old configs",()=>{
 const c=defaults();c.enabled=true;Object.assign(c.features.live2d,{provider:"sakana",customCharacters:[row],character:row.id});
 expect(validate(c)).toBe("");expect(normalize(c).features.live2d.character).toBe(row.id);
 delete c.features.live2d.customCharacters;c.features.live2d.character="chisato";
 expect(normalize(c).features.live2d.customCharacters).toEqual([]);
});
it.each([{...row,id:"chisato"},{...row,name:" "},{...row,imageUrl:"javascript:alert(1)"},{...row,imageUrl:"https://user:pass@example.test/x"},{...row,extra:1}])("rejects invalid role %j",bad=>{
 const c=defaults();c.features.live2d.customCharacters=[bad];expect(validate(c)).not.toBe("");
});
it("rejects duplicate IDs, unknown selections and excessive roles",()=>{
 const c=defaults();c.features.live2d.customCharacters=[row,row];expect(validate(c)).not.toBe("");
 c.features.live2d.customCharacters=[];c.features.live2d.character=row.id;expect(validate(c)).not.toBe("");
 c.features.live2d.character="chisato";c.features.live2d.customCharacters=Array.from({length:17},(_,i)=>({...row,id:"custom-"+i}));expect(validate(c)).not.toBe("");
});

it.each([25,100,150,200])("accepts custom image scale %s",scale=>{
 const c=defaults();c.features.live2d.customCharacters=[{...row,scale}];expect(validate(c)).toBe("");
 expect(normalize(c).features.live2d.customCharacters[0].scale).toBe(scale);
});
it.each([0,24,201,NaN,Infinity,"100",null])("rejects custom image scale %s",scale=>{
 const c=defaults();c.features.live2d.customCharacters=[{...row,scale}];expect(validate(c)).not.toBe("");
});
