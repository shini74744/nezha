const paths = {
 map: "m3 5 6-2 6 2 6-2-.5 16-5.5 2-6-2-6 2Zm6-2-.3 16M15 5l.4 16M5 10l2-1m4 3 2 1m4-2 2-1",
 stats: "M4 3.5 3.5 20 21 20M7 16l3-5 4 2 6-8M18 5h2v2",
 cards: "m3 4 7-.3.2 7-7.2.2Zm11-.2 7 .2-.2 7-6.8-.2ZM3 15l7 .2-.2 6-6.8-.2Zm11 .2 7-.2v6l-7 .2Z",
 rows: "M4 4.5 20 4M4 9.5l16 .3M4 15l16-.2M4 21l16-.4",
 up: "m6 9 6-6 6 6M12 3l-.3 18",
 down: "m6 15 6 6 6-6M12 21l.3-18",
 sort: "m3 8 5-5 5 5M8 3l-.3 17m3-4 5 5 5-5M16 21l.3-17",
};
export function PaperControlGlyph({kind}:{kind:keyof typeof paths}) {
 return <svg className="paper-control-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[kind]} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
