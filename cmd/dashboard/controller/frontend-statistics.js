/* Shared read-only statistics for independently bundled user themes.
 * Shadow DOM keeps theme CSS isolated. Server-provided labels are text, never HTML.
 */
(() => {
  "use strict";
  const script = document.currentScript;
  const theme = script?.dataset.theme || "other";
  if (document.getElementById("nezha-statistics") || location.pathname.startsWith("/dashboard")) return;
  const boot = () => {
    const host = document.createElement("div");
    host.id = "nezha-statistics";
    host.style.cssText = "position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:2147482000;pointer-events:none";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host{--panel:#fff;--ink:#1e293b;--muted:#64748b;--line:#dbe4ef;--soft:#f1f5f9;--accent:#2563eb;font:14px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:var(--ink)}
      :host([data-dark]){--panel:#12202e;--ink:#e2edf7;--muted:#a3b6c9;--line:#34495f;--soft:#1d3043;--accent:#71b7ff;color-scheme:dark}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation}
      button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      #trigger{pointer-events:auto;display:flex;align-items:center;gap:7px;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:22px;background:var(--panel);box-shadow:0 3px 14px #0002}
      svg{width:17px;height:17px;flex-shrink:0}
      #menu{pointer-events:auto;position:absolute;left:0;bottom:48px;width:max-content;min-width:96px;max-width:calc(100vw - 24px);padding:4px;border:1px solid var(--line);border-radius:12px;background:#fffffff2;color:#292524;box-shadow:0 10px 30px #0003;backdrop-filter:blur(20px)}
      :host([data-dark]) #menu{background:#1c1917f2;color:#f5f5f4;border-color:#ffffff26}
      .item{display:flex;align-items:center;gap:0;min-height:32px;width:100%;margin:2px 0;padding:4px 8px;text-align:left;border:0;border-radius:6px;background:transparent;font-weight:500;white-space:nowrap}
      .item:hover,.item:focus-visible,.item[aria-checked=true]{background:#eff6ff;color:#1d4ed8}.item .check{display:none}
      :host([data-dark]) .item:hover,:host([data-dark]) .item:focus-visible{background:#ffffff1a;color:#fff}
      :host([data-dark]) .item[aria-checked=true]{background:#60a5fa26;color:#bfdbfe}
      @media(pointer:coarse){.item{min-height:44px}}
      dialog{pointer-events:auto;padding:0;border:1px solid var(--line);border-radius:18px;color:var(--ink);background:var(--panel);width:min(1120px,calc(100vw - 24px));max-width:none;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);box-shadow:0 24px 100px #0005}
      dialog::backdrop{background:#02061788;backdrop-filter:blur(3px)}
      .frame{display:flex;flex-direction:column;max-height:calc(100vh - 34px);max-height:calc(100dvh - 34px)}
      .head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 10px}
      h2,h3,p{margin:0}h2{font-size:17px;font-weight:650}h3{font-size:14px;font-weight:600;overflow-wrap:anywhere;min-width:0}
      .close{width:40px;height:40px;flex-shrink:0;border:1px solid var(--line);border-radius:50%;background:var(--soft);font-size:22px}
      .tabs{display:flex;gap:6px;padding:0 20px 12px;border-bottom:1px solid var(--line)}
      .tabs button{min-height:40px;border:1px solid var(--line);border-radius:9px;background:var(--panel);padding:6px 14px}
      .tabs button[aria-pressed=true]{color:var(--accent);background:var(--soft);border-color:var(--accent);font-weight:600}
      .body{overflow:auto;overscroll-behavior:contain;padding:16px 20px 20px;min-height:130px}
      .hint{font-size:12px;color:var(--muted);margin-bottom:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.grid.uptime{grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))}
      .card{padding:16px;border:1px solid var(--line);border-radius:12px;min-width:0;background:var(--panel)}
      .row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 14px}.title-row{align-items:flex-start;flex-wrap:nowrap;margin-bottom:12px;gap:10px}
      .badge{background:var(--soft);color:var(--accent);font-size:11px;padding:3px 7px;border-radius:5px;max-width:40%;flex-shrink:0;overflow-wrap:anywhere}
      .value{font-variant-numeric:tabular-nums;font-weight:600}.muted{font-size:12px;color:var(--muted)}.meta{display:flex;gap:10px;white-space:nowrap;margin-left:auto;font-size:13px}
      .track{height:6px;border-radius:6px;background:var(--soft);margin:8px 0 12px;overflow:hidden}.fill{height:100%;background:#00b884;border-radius:6px}
      .dates{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:11px;color:var(--muted)}
      .days{display:flex;gap:3px;margin:14px 0 8px}.day{min-width:0;flex:1;height:27px;padding:0;border:0;border-radius:5px;background:#00b95b}.day.down{background:#ef334d}
      .good{color:#008859}.warn{color:#a86300}.bad{color:#cc2d49}
      :host([data-dark]) .good{color:#35dfa3}:host([data-dark]) .warn{color:#ffc257}:host([data-dark]) .bad{color:#ff6f8c}
      .detail{margin-top:10px;border-radius:7px;background:var(--soft);padding:8px;font-size:12px}
      .empty{padding:18px;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}.retry{margin-top:12px;min-height:40px;padding:8px 14px;border:1px solid var(--line);background:var(--soft);border-radius:8px}
      @media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.uptime{grid-template-columns:1fr}}
      @media(max-width:540px){dialog{border-radius:15px}.head{padding:12px 14px 8px}.tabs{padding:0 14px 10px}.body{padding:12px 14px 16px}.grid{grid-template-columns:1fr}.card{padding:13px}.meta{font-size:12px}.tabs button{flex:1}.days{gap:2px}}
      @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
    `;
    root.append(style);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    const button = (label, className, fn) => {
      const b = el("button", className, label); b.type = "button"; b.addEventListener("click", fn); return b;
    };
    const trigger = button("▥  统计  ⌄", "", () => menu.hidden ? openMenu() : closeMenu());
    trigger.id = "trigger"; trigger.setAttribute("aria-label", "选择统计视图"); trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
    const menu = el("div"); menu.id = "menu"; menu.hidden = true; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "选择统计视图");
    const dialog = el("dialog"); dialog.setAttribute("aria-label", "统计详情");
    const frame = el("div", "frame"), head = el("div", "head"), tabs = el("div", "tabs"), body = el("div", "body");
    head.append(el("h2", "", "统计详情"), button("×", "close", closePanel));
    head.lastChild.setAttribute("aria-label", "收起统计");
    frame.append(head, tabs, body); dialog.append(frame); root.append(trigger, menu, dialog); document.body.append(host);

    let view = "traffic", data = null, timer = 0, request = null;
    try { const saved = localStorage.getItem(theme + ":statisticsView"); if (saved === "traffic" || saved === "uptime") view = saved; } catch {}
    const menuItems = [];
    for (const [key,label] of [["traffic","流量统计"],["uptime","在线率"]]) {
      const item = button("", "item", () => selectView(key));
      item.dataset.view = key; item.setAttribute("role","menuitemradio"); item.setAttribute("aria-checked","false");
      item.append(el("span","check",""),el("span","",label)); menu.append(item); menuItems.push(item);
      const tab = button(label,"",()=>selectView(key)); tab.dataset.view=key; tabs.append(tab);
    }
    function syncSelection() {
      for(const item of menuItems) {
        const selected = dialog.open && item.dataset.view === view;
        item.setAttribute("aria-checked",String(selected)); item.firstChild.textContent = selected ? "✓" : "";
      }
      for(const tab of tabs.children) tab.setAttribute("aria-pressed",String(dialog.open && tab.dataset.view===view));
    }
    function openMenu() { syncSelection(); menu.hidden=false; trigger.setAttribute("aria-expanded","true"); menuItems[0].focus(); }
    function closeMenu(focus=false) { menu.hidden=true; trigger.setAttribute("aria-expanded","false"); if(focus)trigger.focus(); }
    function closePanel() {
      closeMenu(); clearTimeout(timer); request?.abort(); request=null;
      if(dialog.open)dialog.close(); trigger.focus(); syncSelection();
    }
    function selectView(next) {
      if (dialog.open && view === next) closePanel();
      else openPanel(next);
    }
    function openPanel(next) {
      view=next; try { localStorage.setItem(theme+":statisticsView",view); } catch {}
      closeMenu(); if(!dialog.open)dialog.showModal(); syncSelection();
      if(data)render(); else body.replaceChildren(el("p","empty","正在加载统计…"));
      void refresh();
    }
    dialog.addEventListener("cancel",event=>{event.preventDefault();closePanel()});
    dialog.addEventListener("click",event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel()}});
    document.addEventListener("pointerdown",event=>{if(!event.composedPath().includes(host))closeMenu()});
    root.addEventListener("keydown",event=>{
      if(menu.hidden)return;
      if(event.key==="Escape"){event.preventDefault();closeMenu(true)}
      if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){
        event.preventDefault(); let i=menuItems.indexOf(root.activeElement);
        const count=menuItems.length;
        i=event.key==="Home"?0:event.key==="End"?count-1:(i+(event.key==="ArrowDown"?1:count-1))%count;menuItems[i].focus();
      }
      if(event.key==="Tab")closeMenu();
    });
    document.addEventListener("visibilitychange",()=>{
      clearTimeout(timer);
      if(document.hidden){request?.abort();request=null}
      else if(dialog.open)void refresh();
    });
    async function refresh() {
      clearTimeout(timer); request?.abort();
      if(!dialog.open||document.hidden)return;
      const controller=new AbortController(); request=controller;
      const timeout=setTimeout(()=>controller.abort(),12000);
      try {
        const response=await fetch("/api/v1/service",{credentials:"same-origin",cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("unavailable");
        const payload=await response.json(); if(!payload.success||!payload.data)throw new Error("unavailable");
        if(request!==controller||!dialog.open)return;
        data=payload.data; render();
      } catch(error) {
        if(request!==controller||!dialog.open||document.hidden)return;
        body.replaceChildren(el("p","empty","统计数据加载失败，请重试。"),button("重新加载","retry",()=>void refresh()));
      } finally {
        clearTimeout(timeout);
        if(request===controller){request=null;if(dialog.open&&!document.hidden)timer=setTimeout(refresh,10000)}
      }
    }
    function date(value,time=false) {
      const d=new Date(value); return Number.isFinite(d.getTime()) ? (time?d.toLocaleString():d.toLocaleDateString()) : "—";
    }
    function bytes(value) {
      if(!Number.isFinite(value)||value<0)return "—";
      const units=["B","KiB","MiB","GiB","TiB","PiB"],i=value?Math.min(5,Math.floor(Math.log(value)/Math.log(1024))):0;
      return (value/1024**i).toFixed(i?2:0)+" "+units[i];
    }
    const num = value => Number.isFinite(Number(value)) ? Math.max(0,Number(value)) : 0;
    const perServer = (value,id) => value && typeof value === "object" ? value[id] : value;
    function render() {
      const hint=el("p","hint",view==="traffic"?"流量周期与用量 · 所有可见服务器":"服务监控 · 最近 30 天 · 点击色块查看当天数据");
      const grid=el("div","grid "+view); grid.dataset.statisticsView=view;
      if(view==="traffic") {
        for(const cycle of Object.values(data.cycle_transfer_stats||{}))for(const [id,name] of Object.entries(cycle.server_name||{})) {
          const max=num(perServer(cycle.max,id)),from=perServer(cycle.from,id),to=perServer(cycle.to,id);
          const used=num(cycle.transfer?.[id]),next=cycle.next_update?.[id];
          if(!max||!from||!to||(!used&&!next))continue;
          const ratio=used/max*100,card=el("article","card");card.dataset.statisticsCard="traffic";
          const title=el("div","row title-row");title.append(el("h3","",name),el("span","badge",cycle.name||"流量统计"));
          const totals=el("div","row");totals.append(el("span","value",bytes(used)+" / "+bytes(max)),el("span","muted",ratio.toFixed(1)+"%"));
          const track=el("div","track"),fill=el("div","fill");fill.style.width=Math.min(100,ratio)+"%";track.append(fill);
          track.setAttribute("role","progressbar");track.setAttribute("aria-label",name);track.setAttribute("aria-valuemin","0");track.setAttribute("aria-valuemax","100");track.setAttribute("aria-valuenow",String(Math.min(100,ratio)));track.setAttribute("aria-valuetext",ratio.toFixed(1)+"%");
          const footer=el("div","dates");footer.append(el("span","",date(from)+" - "+date(to)),el("span","","下次更新："+date(next,true)));
          card.append(title,totals,track,footer);grid.append(card);
        }
      } else {
        for(const service of Object.values(data.services||{})) {
          const up=Array.isArray(service.up)?service.up:[],down=Array.isArray(service.down)?service.down:[],delays=Array.isArray(service.delay)?service.delay:[];
          const sum=values=>values.reduce((a,b)=>a+num(b),0),checks=sum(up)+sum(down),uptime=checks?sum(up)/checks*100:0,delay=delays.length?sum(delays)/delays.length:0;
          const card=el("article","card");card.dataset.statisticsCard="uptime";
          const title=el("div","row"),meta=el("div","meta");
          meta.append(el("span",delay<100?"good":delay<300?"warn":"bad",delay.toFixed(0)+"ms"),el("span",uptime>=99?"good":uptime>=95?"warn":"bad",uptime.toFixed(1)+"% 在线率"));
          title.append(el("h3","",service.service_name),meta);
          const days=el("div","days"),detail=el("div","detail");detail.hidden=true;detail.setAttribute("role","status");
          up.forEach((value,i)=>{
            const checks=num(value)+num(down[i]),rate=checks?num(value)/checks*100:0,dayDate=date(Date.now()-(up.length-1-i)*86400000);
            const label=dayDate+" · 在线率 "+rate.toFixed(1)+"% · "+num(delays[i]).toFixed(0)+"ms";
            const bar=button("", "day"+(num(value)>num(down[i])?"":" down"),()=>{detail.hidden=false;detail.textContent=label});
            bar.title=label;bar.setAttribute("aria-label",label);days.append(bar);
          });
          const footer=el("div","dates");footer.append(el("span","","30 天前"),el("span","","今天"));
          card.append(title,days,footer,detail);grid.append(card);
        }
      }
      body.replaceChildren(hint,grid);
      if(!grid.childElementCount)grid.append(el("p","empty",view==="traffic"?"暂无流量统计，请先配置周期流量规则。":"暂无在线率数据，请先配置服务监控。"));
    }
    function syncTheme() {
      const html=document.documentElement,body=document.body;
      const classes=html.className+" "+body.className;
      const explicit=html.getAttribute("data-theme")||body.getAttribute("data-theme")||"";
      const color=getComputedStyle(body).backgroundColor.match(/[\d.]+/g);
      const dark=theme==="nezha-ascii-dist"||/dark|night/i.test(explicit)||/(^|[\s-])(dark|night)([\s-]|$)/i.test(classes)||
        (explicit!=="light"&&color&&Number(color[3]??1)>0&&Number(color[0])*.299+Number(color[1])*.587+Number(color[2])*.114<100);
      host.toggleAttribute("data-dark",!!dark);
    }
    const observer=new MutationObserver(syncTheme);
    for(const node of [document.documentElement,document.body])observer.observe(node,{attributes:true,attributeFilter:["class","data-theme","style"]});
    syncTheme(); window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",syncTheme);
    window.addEventListener("pagehide",()=>{clearTimeout(timer);request?.abort()});
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
