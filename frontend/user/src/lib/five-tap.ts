// Five deliberate activations; stale/slow clicks cannot accumulate indefinitely.
export function createFiveTapGate() {
 let count = 0, first = 0, last = 0;
 return (now: number): boolean => {
  if (!count || now-last>1500 || now-first>5000 || now<last) {count=0;first=now;}
  last=now;count+=1;
  if(count<5)return false;
  count=0;return true;
 };
}
