// Move within one region without disturbing interleaved entries from other regions.
export function reorderConnectivity<T extends {id:string;group:string}>(items:T[], active:string, over:string):T[] {
  const source=items.find(row=>row.id===active), target=items.find(row=>row.id===over);
  if (!source || !target || active===over || source.group!==target.group) return items;
  const peers=items.filter(row=>row.group===source.group);
  const from=peers.findIndex(row=>row.id===active), to=peers.findIndex(row=>row.id===over);
  peers.splice(to,0,...peers.splice(from,1));
  let index=0;
  return items.map(row=>row.group===source.group?peers[index++]:row);
}
