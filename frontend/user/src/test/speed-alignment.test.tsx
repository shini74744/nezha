import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { defaults } from "@/appearance/config";
import { AppearanceProvider } from "@/appearance/context";
import { NativeSpeed } from "@/appearance/widgets";

describe("overview speed alignment", () => {
  it.each([true, false])("shares icon/value layout with beautification %s", enabled => {
    const config = defaults();
    config.enabled = enabled;
    const view = render(<AppearanceProvider raw={JSON.stringify(config)}>
      {(["up", "down"] as const).map(direction => <NativeSpeed key={direction} overview direction={direction} bytes={1048576} icon={<svg />} />)}
    </AppearanceProvider>);
    const rates = view.container.querySelectorAll(".nz-network-speed");
    expect(rates).toHaveLength(2);
    for (const rate of rates) {
      expect(rate.querySelector("svg")).not.toBeNull();
      expect(rate.querySelector(".nz-rate-value")).toHaveTextContent(enabled ? "8.00Mbps" : "1.00 MiB/s");
    }
    expect(view.container.querySelectorAll("[data-native-speed]")).toHaveLength(enabled ? 2 : 0);
  });
});
