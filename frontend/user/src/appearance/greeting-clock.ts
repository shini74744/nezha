export type GreetingRule = { name: string; start: string; end: string; messages: string[] };
export const clockColorKeys = ["hourStartColor", "hourEndColor", "minuteStartColor", "minuteEndColor", "secondStartColor", "secondEndColor"] as const;
export const validClockColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function validateGreetingClock(features: Record<string, any>) {
  const rules = features.greeting.rules;
  if (!Array.isArray(rules) || rules.length > 32) throw Error("问候时段最多 32 个");
  for (const rule of rules) {
    if (!validTime(rule.start) || !validTime(rule.end)) throw Error("问候时段须使用有效的 HH:mm 时间");
    if (rule.messages.length > 256) throw Error("每个时段最多 256 条问候语");
  }
  for (const key of clockColorKeys) if (!validClockColor(features.clock[key])) throw Error("时钟颜色须为 #RRGGBB，例如 #ff2828");
}
export function greetingMessages(rules: GreetingRule[], now: Date): string[] {
  const current = now.getHours() * 60 + now.getMinutes();
  const rule = rules.find(({ start, end }) => {
    const a = minutes(start), b = minutes(end);
    return a === b || (a < b ? current >= a && current < b : current >= a || current < b);
  });
  return rule?.messages.filter(message => message.trim()) ?? [];
}
export function chooseGreeting(messages: string[], last: string, random = Math.random): string {
  const alternatives = messages.filter(message => message !== last);
  const pool = alternatives.length ? alternatives : messages;
  return pool.length ? pool[Math.floor(random() * pool.length)] : "";
}
export function mixClockColor(start: string, end: string, ratio: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const from = rgb(start), to = rgb(end), t = Math.max(0, Math.min(1, ratio));
  return "rgb(" + from.map((value, index) => Math.round(value + (to[index] - value) * t)).join(", ") + ")";
}
