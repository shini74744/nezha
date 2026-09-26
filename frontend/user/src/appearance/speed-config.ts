// The original flat switches remain the single-server card settings.
// Only absent overview fields inherit the legacy shared values, once on read.
export function upgradeSpeed<T extends {enabled: boolean; [key: string]: any}>(value: T, raw: unknown): T {
 if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof (raw as any).enabled !== "boolean") return value;
 const result = {...value};
 const source = raw as Record<string, unknown>;
 for (const [next, previous] of [["overviewBits","bits"],["overviewColor","color"],["overviewAnimation","animation"]]) {
  if (!Object.prototype.hasOwnProperty.call(source,next) && typeof source[previous] === "boolean") {
   (result as Record<string, unknown>)[next] = source[previous];
  }
 }
 return result;
}
