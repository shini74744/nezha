import { Activity, useState, type ReactNode } from "react";

// Keep only a visited list. Activity suspends its effects while detail is open,
// preserving card DOM, filters and layout without polling an invisible page.
export function RetainedServerList({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>;
}
