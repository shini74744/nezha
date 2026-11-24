/** Static stationery decorations; none can cover a pointer target or take focus. */
export function PaperPencil() {
 return <svg className="paper-margin-pencil" viewBox="0 0 32 260" fill="none" aria-hidden="true" focusable="false">
  <path d="M8 18Q8 10 16 10T24 18V34H8Z" fill="var(--paper-eraser)" stroke="var(--paper-ink)" strokeWidth=".7"/>
  <path d="M8 32h16v14H8Z" fill="var(--paper-metal)"/><path d="M8 35h16M8 41h16" stroke="var(--paper-raised)" opacity=".65"/>
  <path d="M8 46h16v171l-8 32-8-32Z" fill="var(--paper-pencil)" stroke="var(--paper-ink)" strokeWidth=".7"/>
  <path d="M8 46h5v171H8Z" fill="#000" opacity=".09"/><path d="M19 46h5v171h-5Z" fill="#fff" opacity=".28"/>
  <path d="m8 217 5-4 6 4 5-4-8 36Z" fill="var(--paper-wood)"/><path d="m13 237 3 12 3-12-3-4Z" fill="var(--paper-ink)"/>
  <path d="M16 51v151" stroke="var(--paper-raised)" opacity=".32" strokeWidth="1.3"/>
 </svg>;
}
export function PaperRuler() {
 return <svg className="paper-short-ruler" viewBox="0 0 150 38" fill="none" aria-hidden="true" focusable="false">
  <path d="m2 3 145-1 1 32-145 1Z" fill="var(--paper-wood)" stroke="var(--paper-edge)"/>
  <path d="M3 31h144" stroke="var(--paper-ink)" opacity=".3"/>
  {Array.from({length:29},(_,i)=><path key={i} d={`M${6+i*5} 4v${i%5===0?13:i%5===2?9:6}`} stroke="var(--paper-ink)" strokeWidth=".7" opacity=".75"/>)}
  {[0,1,2,3,4,5].map(n=><text key={n} x={6+n*25} y="27" fontFamily="var(--paper-hand)" fontSize="8" fill="var(--paper-ink)">{n}</text>)}
 </svg>;
}
export function PaperClip() {
 const d="M16 9v30a7 7 0 0 0 14 0V12a11 11 0 0 0-22 0v31a4 4 0 0 0 8 0V16";
 return <svg className="paper-metal-clip" viewBox="0 0 38 58" fill="none" aria-hidden="true" focusable="false">
  <path d={d} stroke="var(--paper-ink)" strokeWidth="4.3" strokeLinecap="round" opacity=".28"/>
  <path d={d} stroke="var(--paper-metal)" strokeWidth="3" strokeLinecap="round"/>
  <path d={d} stroke="var(--paper-raised)" strokeWidth=".65" strokeLinecap="round" opacity=".75"/>
 </svg>;
}


/** Page-edge props are decorative, static and excluded from keyboard navigation. */
export function PaperDeskExtras() {
 return <div className="paper-desk-extras" aria-hidden="true">
  <svg className="paper-binder-clip" viewBox="0 0 76 74" fill="none" focusable="false">
   <path d="M23 39 19 14Q18 5 29 5h18q11 0 10 9l-4 25" stroke="var(--paper-ink)" strokeWidth="4.5" opacity=".3"/>
   <path d="M23 39 19 14Q18 5 29 5h18q11 0 10 9l-4 25" stroke="var(--paper-metal)" strokeWidth="3"/>
   <path d="m16 30 44 1 6 29-56 1Z" fill="var(--paper-binder)" stroke="var(--paper-ink)" strokeWidth=".8"/>
   <path d="m16 31 5 25 40 1M12 61h53" stroke="var(--paper-raised)" opacity=".18"/>
   <path d="M24 35 27 57q1 9 11 9t11-9l3-22" stroke="var(--paper-metal)" strokeWidth="3" strokeLinecap="round"/>
   <path d="m25 36 3 21q1 7 10 7t10-7l3-21" stroke="var(--paper-raised)" strokeWidth=".7" opacity=".7"/>
  </svg>
  <svg className="paper-margin-pen" viewBox="0 0 36 264" fill="none" focusable="false">
   <path d="M9 19q0-9 9-9t9 9v79H9Z" fill="var(--paper-pen)" stroke="var(--paper-ink)" strokeWidth=".8"/>
   <path d="M12 16v74" stroke="var(--paper-raised)" opacity=".26" strokeWidth="2"/>
   <path d="M24 19v49q0 7-4 7V20Z" fill="var(--paper-metal)" stroke="var(--paper-ink)" strokeWidth=".6"/>
   <path d="M9 91h18v9H9Z" fill="var(--paper-metal)"/>
   <path d="M10 100h16l-2 114H12Z" fill="var(--paper-pen)" stroke="var(--paper-ink)" strokeWidth=".7"/>
   <path d="m13 105 1 104" stroke="var(--paper-raised)" strokeWidth="1.3" opacity=".25"/>
   <path d="M12 214h12v9H12Z" fill="var(--paper-metal)"/>
   <path d="m12 223 6 31 6-31-6 5Z" fill="var(--paper-wood)" stroke="var(--paper-ink)" strokeWidth=".7"/>
   <path d="M18 231v23" stroke="var(--paper-ink)" strokeWidth=".8"/><circle cx="18" cy="232" r="1.4" fill="var(--paper-ink)"/>
  </svg>
  <svg className="paper-pencil-shavings" viewBox="0 0 60 74" fill="none" focusable="false">
   <path d="M8 15Q30-2 45 22L31 34Q27 15 16 28Z" fill="var(--paper-wood)" stroke="var(--paper-edge)" strokeWidth=".8"/>
   <path d="M8 15Q30-2 45 22" stroke="var(--paper-pencil)" strokeWidth="3"/>
   <path d="m15 15 7 10m1-12 4 11m5-9 0 11m7-7-3 10" stroke="var(--paper-edge)" strokeWidth=".7"/>
   <path d="M21 48q18-13 25 6L34 64q1-13-9-7Z" fill="var(--paper-wood)" stroke="var(--paper-edge)" strokeWidth=".8"/>
   <path d="M21 48q18-13 25 6" stroke="var(--paper-pencil)" strokeWidth="2.4"/>
   <path d="m8 41 3 2m4 23 2-1m34-27 2 1M9 56l2-2" stroke="var(--paper-ink)" opacity=".65" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
  <span className="paper-edge-index"><i/><i/><i/></span>
 </div>;
}
