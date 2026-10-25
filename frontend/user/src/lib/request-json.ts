export class ApiError extends Error {
 constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

// HTTP failures, failed envelopes and malformed JSON are errors, never empty successes.
export async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
 const response = signal ? await fetch(url, { signal }) : await fetch(url);
 if (response.ok === false) throw new ApiError(`Request failed (${response.status})`, response.status);
 const data = await response.json();
 if (!data || typeof data !== "object" || data.success === false || data.error) {
  throw new ApiError(typeof data?.error === "string" ? data.error : "Invalid API response", response.status || 0);
 }
 return data as T;
}
