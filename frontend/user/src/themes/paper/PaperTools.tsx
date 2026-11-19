import type {ReactNode} from "react";

const tools = {
 "correction-tape": <>
  <path d="M19 32Q6 43 12 62t31 18l32-19 16 3 3-10-18-7Q58 14 35 22Z" fill="var(--paper-tool-shell)" stroke="var(--paper-edge)" strokeWidth="1.4"/>
  <path d="m75 49 17 5-2 7-15-2" fill="var(--paper-metal)" stroke="var(--paper-muted)" strokeWidth="1"/>
  <path d="m25 34q-15 10-8 25t25 12l25-16q-8-25-25-26Z" fill="var(--paper-index-blue)" stroke="var(--paper-edge)" opacity=".7"/>
  <circle cx="31" cy="49" r="12" fill="var(--paper-raised)" stroke="var(--paper-muted)"/><circle cx="31" cy="49" r="4" fill="var(--paper-metal)"/>
  <circle cx="57" cy="48" r="7" fill="var(--paper-raised)" stroke="var(--paper-muted)"/><circle cx="57" cy="48" r="2" fill="var(--paper-metal)"/>
  <path d="m31 37 26 4 21 12-1 5-20-3-25 6" stroke="var(--paper-raised)" strokeWidth="2"/>
  <path d="m21 29 17-5q19-2 31 19" stroke="#fff" opacity=".5" strokeWidth="2"/>
 </>,
 "sharpener": <>
  <path d="m22 25 48-7 13 58-49 9-16-15Z" fill="var(--paper-index-blue)" stroke="var(--paper-muted)" strokeWidth="1.2"/>
  <path d="m22 25 12 60-16-15-12-48Z" fill="var(--paper-pen)" stroke="var(--paper-muted)"/>
  <path d="m29 30 32-5 10 44-32 6Z" fill="var(--paper-metal)" stroke="var(--paper-muted)"/>
  <path d="m37 33 3-1 8 36-3 1Z" fill="var(--paper-ink)" opacity=".7"/>
  <circle cx="51" cy="46" r="4" fill="var(--paper-raised)" stroke="var(--paper-muted)"/><path d="m48 47 6-2" stroke="var(--paper-muted)"/>
  <ellipse cx="17" cy="43" rx="5" ry="9" transform="rotate(-12 17 43)" fill="var(--paper-ink)" opacity=".7"/>
  <path d="m35 79 42-7M65 28l8 37" stroke="var(--paper-raised)" opacity=".5"/>
 </>,
 "scissors": <>
  <path d="m45 58-9-47q8-2 17 46l24 27-7 7Z" fill="var(--paper-metal)" stroke="var(--paper-muted)"/>
  <path d="m53 58 14-48q7 3-6 40L33 89l-8-6Z" fill="var(--paper-tool-shell)" stroke="var(--paper-muted)"/>
  <path d="m44 57-7-35m19 34 10-34" stroke="var(--paper-raised)" strokeWidth="1.5"/>
  <ellipse cx="29" cy="79" rx="11" ry="15" transform="rotate(30 29 79)" stroke="var(--paper-index-rose)" strokeWidth="7"/>
  <ellipse cx="75" cy="79" rx="11" ry="15" transform="rotate(-30 75 79)" stroke="var(--paper-index-rose)" strokeWidth="7"/>
  <circle cx="51" cy="59" r="4" fill="var(--paper-metal)" stroke="var(--paper-muted)"/><path d="m49 61 4-4" stroke="var(--paper-muted)"/>
 </>,
 "highlighter": <>
  <path d="M34 27h31l-2 51H36Z" fill="var(--paper-tool-yellow)" stroke="var(--paper-muted)"/>
  <path d="M34 10h31v19H34Z" fill="var(--paper-tool-lime)" stroke="var(--paper-muted)"/>
  <path d="M61 12h7v23h-4V17h-3" fill="var(--paper-tool-lime)" stroke="var(--paper-muted)"/>
  <path d="M38 78h22v7H38Z" fill="var(--paper-binder)"/><path d="m40 85 18 0-1 8-15-3Z" fill="var(--paper-tool-lime)" stroke="var(--paper-muted)"/>
  <path d="M39 34v36" stroke="var(--paper-raised)" strokeWidth="3" opacity=".7"/>
  <path d="M45 39h12m-12 5h12m-12 5h9" stroke="var(--paper-muted)" opacity=".5"/>
 </>,
 "mechanical-pencil": <>
  <path d="M46 8h10v10H46Z" fill="var(--paper-metal)" stroke="var(--paper-muted)"/>
  <path d="M44 18h14v47H44Z" fill="var(--paper-index-rose)" stroke="var(--paper-muted)"/>
  <path d="M56 20h5v25h-3V24h-2" fill="var(--paper-metal)" stroke="var(--paper-muted)" strokeWidth=".8"/>
  <path d="M44 65h14v16H44Z" fill="var(--paper-metal)" stroke="var(--paper-muted)"/>
  <path d="M46 68h10m-10 4h10m-10 4h10" stroke="var(--paper-ink)" opacity=".4"/>
  <path d="m45 81 6 12 6-12Z" fill="var(--paper-tool-shell)" stroke="var(--paper-muted)"/><path d="M51 92v5" stroke="var(--paper-ink)" strokeWidth="1.5"/>
  <path d="M47 22v39" stroke="var(--paper-raised)" strokeWidth="1.7" opacity=".7"/>
 </>,
 "glue-stick": <>
  <rect x="32" y="28" width="36" height="58" rx="5" fill="var(--paper-tool-shell)" stroke="var(--paper-muted)"/>
  <rect x="31" y="10" width="38" height="23" rx="5" fill="var(--paper-index-rose)" stroke="var(--paper-muted)"/>
  <path d="M32 81h36v10H32Z" fill="var(--paper-index-rose)" stroke="var(--paper-muted)"/>
  <path d="M37 15v13m6-13v13m6-13v13m6-13v13m6-13v13M37 83v6m6-6v6m6-6v6m6-6v6m6-6v6" stroke="var(--paper-muted)" opacity=".45"/>
  <path d="M33 43h34v28H33Z" fill="var(--paper-index-sage)"/>
  <path d="m43 48 8-4 8 4-8 5Zm0 6 8 5 8-5m-16 6 8 5 8-5" stroke="var(--paper-raised)" strokeWidth="1.5"/>
  <path d="M36 35v43" stroke="#fff" strokeWidth="2" opacity=".35"/>
 </>,
 "stapler": <>
  <path d="m14 70 64-10 13 9-7 11-68 9-8-7Z" fill="var(--paper-binder)" stroke="var(--paper-muted)"/>
  <path d="m18 64 62-12 1 9-63 12Z" fill="var(--paper-metal)" stroke="var(--paper-muted)"/>
  <path d="m13 38 58-12q10-1 14 12l3 17-70 16-7-19Z" fill="var(--paper-pen)" stroke="var(--paper-muted)"/>
  <path d="m17 40 52-11q8-2 12 9" stroke="var(--paper-raised)" opacity=".5" strokeWidth="2"/>
  <path d="m19 60 65-14" stroke="var(--paper-ink)" opacity=".25" strokeWidth="2"/>
  <circle cx="24" cy="64" r="3" fill="var(--paper-metal)"/><path d="m70 70 9-1" stroke="var(--paper-metal)" strokeWidth="4"/>
 </>,
 "tape-roll": <>
  <path d="M21 46c0-15 12-25 28-25s28 10 28 25v15c0 15-12 25-28 25S21 76 21 61Z" fill="var(--paper-tool-yellow)" stroke="var(--paper-edge)"/>
  <path d="M77 47v17l13 13-13 5-14-15" fill="var(--paper-tool-yellow)" stroke="var(--paper-edge)" opacity=".8"/>
  <ellipse cx="49" cy="45" rx="28" ry="24" fill="var(--paper-tape)" stroke="var(--paper-edge)"/>
  <ellipse cx="49" cy="45" rx="14" ry="12" fill="var(--paper-muted)"/><ellipse cx="49" cy="49" rx="12" ry="8" fill="var(--paper-raised)"/>
  <path d="M25 52q3 18 25 19m-26-25q0-20 24-22" stroke="var(--paper-raised)" strokeWidth="2" opacity=".6"/>
  <path d="m78 76 8-2m-10 4 3 2 3-2 3 1" stroke="var(--paper-edge)"/>
 </>,
 "set-square": <>
  <path d="M14 13v74h74Zm14 29 31 31H28Z" fill="var(--paper-index-blue)" fillRule="evenodd" stroke="var(--paper-muted)" strokeWidth="1.3" opacity=".8"/>
  <path d="M19 25h6m-6 8h4m-4 8h6m-6 8h4m-4 8h6m-6 8h4m-4 8h6M28 82v-5m8 5v-3m8 3v-5m8 5v-3m8 3v-5m8 5v-3m8 3v-5" stroke="var(--paper-muted)" strokeWidth="1"/>
  <path d="M17 21v63h62" stroke="var(--paper-raised)" strokeWidth="1.5" opacity=".7"/>
 </>,
 "bookmark": <>
  <path d="m30 16 40 2-3 73-18-13-21 11Z" fill="var(--paper-index-rose)" stroke="var(--paper-edge)"/>
  <path d="m34 21 31 1-2 60-14-10-15 8Z" fill="none" stroke="var(--paper-raised)" strokeDasharray="2 3"/>
  <circle cx="50" cy="26" r="3" fill="var(--paper-muted)"/>
  <path d="M50 26q-13-22 2-20t-2 20q-12-3-12-11" stroke="var(--paper-pencil)" strokeWidth="2"/>
  <path d="M49 38v26m-6-19 6 6 7-6m-13 9 6 6 7-6" stroke="var(--paper-raised)" strokeWidth="1.5"/>
 </>
} satisfies Record<string, ReactNode>;
type Tool = keyof typeof tools;
const kinds = Object.keys(tools) as Tool[];
const verticalBoxes:Partial<Record<Tool,string>> = {"mechanical-pencil":"38 0 30 100",highlighter:"28 0 44 100","glue-stick":"26 0 48 100",bookmark:"22 0 56 100"};

export function PaperTool({kind,className=""}:{kind:Tool;className?:string}) {
 return <svg className={"paper-tool "+className} data-stationery-kind={kind} viewBox={verticalBoxes[kind] || "0 0 100 100"} fill="none" aria-hidden="true" focusable="false" strokeLinejoin="round" strokeLinecap="round">{tools[kind]}</svg>;
}
/** Clipped to the page: short/empty pages never acquire a decorative scrollbar. */
export function PaperToolsMargins() {
 return <div className="paper-tools-margins" aria-hidden="true">
  {(["bookmark","sharpener","scissors","highlighter","mechanical-pencil","glue-stick"] as Tool[]).map(kind=><PaperTool key={kind} kind={kind}/>)}
 </div>;
}
export function PaperToolsTray() {
 return <div className="paper-tools-tray" aria-hidden="true">
  <span className="paper-tools-rule"/>
  <div className="paper-tools-row">{kinds.map(kind=><PaperTool key={kind} kind={kind}/>)}</div>
  <span className="paper-tools-rule"/>
 </div>;
}
