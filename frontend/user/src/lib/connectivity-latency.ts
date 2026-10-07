import type { ConnectivitySample } from "./connectivity-api";

// HTTP rejection still provides a measured response time; timeouts do not.
export function validSampleDelay(sample?: ConnectivitySample): number | undefined {
 const value = sample?.delay_ms;
 return sample && (sample.status === "ok" || sample.status === "http_error") &&
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function averageConnectivityDelay(samples: ConnectivitySample[]): number | undefined {
 const values = samples.flatMap(sample => {const value = validSampleDelay(sample);return value === undefined ? [] : [value];});
 if (!values.length) return;
 // Divide each term first to avoid overflow when summing large finite values.
 return values.reduce((sum, value) => sum + value / values.length, 0);
}
