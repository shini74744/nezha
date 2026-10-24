/// <reference types="node" />
import {generateCommand} from "@/components/install-commands"
import type {ModelProfile,ModelSetting} from "@/types"
import {createServer} from "node:http"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtemp,writeFile,readFile,access,rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {describe,it,expect} from "vitest"

describe.skipIf(process.platform==="win32")("real curl -fL against an isolated loopback fixture",()=>{
 for(const os of [1,2])for(const status of ["ok","redirect","404","500","partial"])it("OS "+os+" "+status,async()=>{
  const dir=await mkdtemp(join(tmpdir(),"DDnezha curl fixture "));
  const body='#!/bin/sh\nprintf "%s" "$DDNZ_CLIENT_SECRET" > installed\n';
  let requests=0;
  const server=createServer((req,res)=>{
   requests++;
   if(req.url==="/redirect"){res.writeHead(302,{Location:"/ok"});res.end();return}
   if(req.url==="/404"||req.url==="/500"){res.writeHead(Number(req.url.slice(1)));res.end(body);return}
   if(req.url==="/partial"){res.writeHead(200,{"Content-Length":Buffer.byteLength(body)+100});res.end(body);res.socket?.end();return}
   res.end(body);
  });
  try{
   await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
   const address=server.address() as {port:number};
   await writeFile(join(dir,"DDnezha-install.sh"),body);
   await writeFile(join(dir,"agent.sh"),"preserve unrelated installer");
   const command=generateCommand(os,{install_host:"fixture.invalid:443",tls:true} as ModelSetting,{agent_secret:"fixture-only"} as ModelProfile,"fixture-uuid")
    .replace("https://raw.githubusercontent.com/shini74744/nezha/main/agent/scripts/install.sh","http://127.0.0.1:"+address.port+"/"+status);
   expect(command).toMatch(/^curl -fL http/);
   let code=0;
   try{await promisify(execFile)("sh",["-c",command],{cwd:dir,timeout:10000})}
   catch(error){code=(error as {code:number}).code}
   if(status==="ok"||status==="redirect"){
    expect(code).toBe(0);
    expect(await readFile(join(dir,"installed"),"utf8")).toBe("fixture-only");
   }else{
    expect(code).toBe(status==="partial"?18:22);
    await expect(access(join(dir,"installed"))).rejects.toThrow();
   }
   expect(requests).toBe(status==="redirect"?2:1);
   expect(await readFile(join(dir,"agent.sh"),"utf8")).toBe("preserve unrelated installer");
  }finally{
   server.closeAllConnections();
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   await rm(dir,{recursive:true,force:true});
  }
 },15000);
});
