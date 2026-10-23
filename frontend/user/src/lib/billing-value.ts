import { parseBillingTime } from "../../../shared/billing-time";
import { splitPlanValue } from "../../../shared/plan-value-units";
import { getNextCycleTime } from "./utils";

type Billing = { amount?: string; cycle?: string; startDate?: string; endDate?: string; autoRenewal?: string };
const day = 86400000, offset = 8 * 3600000;
const monthsByCycle: Record<string,number> = {
 month:1,monthly:1,m:1,mo:1,"月":1, quarter:3,quarterly:3,q:3,qr:3,"季":3,
 half:6,"semi-annually":6,h:6,"半":6,"半年":6, year:12,annual:12,yearly:12,y:12,yr:12,"年":12,
};
function shiftMonths(time:number, months:number) {
 const wall=new Date(time+offset),target=new Date(wall);
 target.setUTCDate(1);target.setUTCMonth(target.getUTCMonth()+months);
 const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 target.setUTCDate(Math.min(wall.getUTCDate(),last));
 return target.getTime()-offset;
}

/** Unused prepaid service estimate in the saved currency, not a refund or resale quote. */
export function estimateRemainingValue(billing:Billing, now=Date.now()): {value:number;unit:string}|null {
 const price=splitPlanValue("amount",billing.amount);
 const amount=Number(price?.amount);
 const originalEnd=parseBillingTime(billing.endDate)?.getTime();
 const start=parseBillingTime(billing.startDate)?.getTime();
 const cycle=typeof billing.cycle==="string"?billing.cycle.trim().toLowerCase():"";
 const months=monthsByCycle[cycle];
 const days=/^(day|daily|d|日|天)$/.test(cycle)?1:/^(week|weekly|w|周|週)$/.test(cycle)?7:0;
 if(!price||!Number.isFinite(amount)||amount<=0||!originalEnd||!Number.isFinite(now)||(!months&&!days))return null;
 if(start!==undefined&&start>=originalEnd)return null;
 let end=originalEnd;
 if(end<=now&&billing.autoRenewal==="1"){
  end=days?end+(Math.floor((now-end)/(days*day))+1)*days*day:getNextCycleTime(end,months,now);
 }
 if(end<=now)return {value:0,unit:price.unit||""};
 const at=Math.max(now,start??now);
 if(at>=end)return null;
 let periods:number;
 if(days)periods=(end-at)/(days*day);
 else {
  const endWall=new Date(end+offset),atWall=new Date(at+offset);
  const distance=(endWall.getUTCFullYear()-atWall.getUTCFullYear())*12+endWall.getUTCMonth()-atWall.getUTCMonth();
  let count=Math.max(1,Math.floor(distance/months));
  if(shiftMonths(end,-count*months)>at)count++;
  const lower=shiftMonths(end,-count*months),upper=shiftMonths(end,-(count-1)*months);
  periods=count-1+(upper-at)/(upper-lower);
 }
 const value=amount*periods;
 return Number.isFinite(value)&&value>=0?{value,unit:price.unit||""}:null;
}
