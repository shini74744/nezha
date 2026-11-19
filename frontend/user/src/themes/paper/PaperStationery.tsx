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
