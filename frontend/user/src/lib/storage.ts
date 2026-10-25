// Storage is optional: browser privacy settings, quotas and WebViews may reject
// the property getter itself as well as individual operations.
function safeStorage(kind: "localStorage" | "sessionStorage") {
 return {
  getItem(key: string): string | null { try { return window[kind].getItem(key); } catch { return null; } },
  setItem(key: string, value: string): void { try { window[kind].setItem(key, value); } catch { /* Optional persistence. */ } },
  removeItem(key: string): void { try { window[kind].removeItem(key); } catch { /* Optional persistence. */ } },
 };
}
export const safeLocalStorage = safeStorage("localStorage");
export const safeSessionStorage = safeStorage("sessionStorage");
