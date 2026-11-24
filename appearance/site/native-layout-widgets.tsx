import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFeature } from "./context";
import { fitCounter } from "./counter-layout";
import { mixClockColor } from "./greeting-clock";
import { isTouchDevice, useMedia, useScrollPosition } from "./native-hooks";

export function NativeClockPart({
	unit,
	value,
	children,
}: {
	unit: "hour" | "minute" | "second";
	value: number;
	children: ReactNode;
}) {
	const f = useFeature("clock");
	return (
		<span
			data-native-clock={unit}
			style={
				f.enabled
					? {
							color: mixClockColor(
								f[`${unit}StartColor`],
								f[`${unit}EndColor`],
								value / (unit === "hour" ? 23 : 59),
							),
						}
					: undefined
			}
		>
			{children}
		</span>
	);
}
export function NativeQuote() {
	const f = useFeature("quote"),
		desktop = useMedia("(min-width:641px)");
	const [text, setText] = useState(""),
		[color, setColor] = useState<string>();
	useEffect(() => {
		if (!f.enabled || !desktop || isTouchDevice()) return;
		const abort = new AbortController();
		let active = true;
		setText("");
		const urls = f.dayUrls as string[],
			url =
				new Date().getHours() >= 21
					? f.nightUrl
					: urls[Math.floor(Math.random() * urls.length)];
		const timeout = setTimeout(() => abort.abort(), 6000);
		if (url)
			fetch(url, { signal: abort.signal, credentials: "omit" })
				.then((r) => {
					if (!r.ok) throw Error("quote");
					return r.text();
				})
				.then((value) => {
					if (active) setText(value);
				})
				.catch(() => {
					if (active) setText("加载失败，请稍后再试");
				})
				.finally(() => clearTimeout(timeout));
		const colors = setInterval(
			() =>
				setColor(
					"#" +
						Math.floor(Math.random() * 16777215)
							.toString(16)
							.padStart(6, "0"),
				),
			2000,
		);
		return () => {
			active = false;
			abort.abort();
			clearTimeout(timeout);
			clearInterval(colors);
		};
	}, [f.enabled, f.dayUrls, f.nightUrl, desktop]);
	if (!f.enabled || !desktop || isTouchDevice()) return null;
	return (
		<div id="message" className="nz-native-quote" style={{ color }}>
			{text}
		</div>
	);
}
export function NativeCounter() {
 const f = useFeature("counter"), desktop = useMedia("(min-width:768px)"), scroll = useScrollPosition(f.enabled);
 const root = useRef<HTMLDivElement>(null);
 const [box,setBox] = useState({left:0,right:0,width:0,height:0});
 useLayoutEffect(()=>{
  if(!f.enabled || !root.current) return;
  const node=root.current,header=node.parentElement;
  let frame=0,active=true;
  const update=()=>{
   frame=0;
   const viewport=document.documentElement.clientWidth||innerWidth;
   const desired=desktop?f.desktopWidth*innerWidth/1366:f.mobileWidth;
   const ratio=desktop?f.desktopWidth/f.desktopHeight:f.mobileWidth/f.mobileHeight;
   const top=desktop?f.desktopTop:f.mobileTop;
   const preferred=desktop?viewport-f.desktopRight-desired:viewport/2+f.mobileOffset-desired/2;
   const obstacles=Array.from(header?.children||[]).filter(el=>el!==node).map(el=>el.getBoundingClientRect());
   const next=fitCounter(viewport,desired,ratio,top,preferred,obstacles,desktop);
   const value={...next,right:viewport-next.left-next.width};
   setBox(old=>Object.keys(value).every(k=>old[k as keyof typeof old]===value[k as keyof typeof value])?old:value);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)};
  const resize=new ResizeObserver(schedule);
  if(header){resize.observe(header);for(const child of header.children)if(child!==node)resize.observe(child);header.addEventListener("load",schedule,true);}
  window.addEventListener("resize",schedule);window.addEventListener("scroll",schedule,{passive:true});
  void document.fonts?.ready.then(()=>{if(active)schedule()});
  update();
  return()=>{active=false;cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener("resize",schedule);window.removeEventListener("scroll",schedule);header?.removeEventListener("load",schedule,true)};
 },[f,desktop]);
 if(!f.enabled)return null;
 const visible=scroll<=f.scrollThreshold,hasRoom=box.width>=24;
 return <div ref={root} className="nz-counter-slot" data-native-counter aria-hidden="true" style={{
  position:"fixed",top:desktop?f.desktopTop:f.mobileTop,left:desktop?undefined:box.left,right:desktop?box.right:undefined,
  width:box.width,height:box.height,zIndex:40,display:hasRoom&&(desktop||visible)?"flex":"none",
  opacity:desktop&&!visible?0:1,transform:desktop?(visible?"scale(1)":"scale(0)"):undefined,
  transformOrigin:desktop?"top right":"center",transition:desktop?"opacity .5s ease-in-out, transform .5s ease-in-out":"none",
 }}>
  <img className={`footer-background ${desktop?"is-desktop":"is-mobile"}`} alt="" src={f.imageUrl} referrerPolicy="no-referrer"
   style={{width:"100%",height:"100%",objectFit:"contain",objectPosition:desktop?"right top":"center"}}/>
 </div>;
}
export function NativeSideImage() {
	const f = useFeature("sideImage"),
		desktop = useMedia("(min-width:641px)");
	const [pos, setPos] = useState({ x: 50, y: 50 });
	const drag = useRef<{ x: number; y: number } | null>(null);
	useEffect(() => {
		const clamp = () =>
			setPos((p) => ({
				x: Math.max(0, Math.min(p.x, innerWidth - 100)),
				y: Math.max(0, Math.min(p.y, innerHeight - 100)),
			}));
		window.addEventListener("resize", clamp);
		clamp();
		return () => window.removeEventListener("resize", clamp);
	}, []);
	if (!f.enabled || !desktop || isTouchDevice()) return null;
	return (
		<button
			type="button"
			id="illustration"
			aria-label="拖动侧边图片"
			className="nz-native-side-image"
			style={{
				position: "absolute",
				left: pos.x,
				top: pos.y,
				width: 100,
				height: 100,
				zIndex: 40,
				background: "transparent",
				border: 0,
				padding: 0,
				cursor: drag.current ? "grabbing" : "grab",
				touchAction: "none",
			}}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				drag.current = { x: e.clientX - pos.x, y: e.clientY + window.scrollY - pos.y };
				e.currentTarget.setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (drag.current)
					setPos({
						x: Math.max(
							0,
							Math.min(innerWidth - 100, e.clientX - drag.current.x),
						),
						y: Math.max(
							0,
							Math.min(document.documentElement.scrollHeight - 100, e.clientY + window.scrollY - drag.current.y),
						),
					});
			}}
			onPointerUp={(e) => {
                drag.current = null;
                const rect=e.currentTarget.getBoundingClientRect();
                if(rect.left>=300&&rect.top>=500&&rect.right<=500&&rect.bottom<=700)setPos({x:350,y:550+window.scrollY});
            }}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={(e) => {
				const delta: Record<string, [number, number]> = {
					ArrowLeft: [-10, 0],
					ArrowRight: [10, 0],
					ArrowUp: [0, -10],
					ArrowDown: [0, 10],
				};
				if (delta[e.key]) {
					e.preventDefault();
					const [x, y] = delta[e.key];
					setPos((p) => ({
						x: Math.max(0, Math.min(innerWidth - 100, p.x + x)),
						y: Math.max(0, Math.min(innerHeight - 100, p.y + y)),
					}));
				}
			}}
		>
			<img
				alt=""
				src={f.imageUrl}
				draggable={false}
				referrerPolicy="no-referrer"
				style={{
					width: "100%",
					height: "100%",
					objectFit: "contain",
					pointerEvents: "none",
				}}
			/>
		</button>
	);
}