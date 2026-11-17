import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import GlobalMap, { InteractiveMap } from "@/components/GlobalMap";
import { TooltipProvider } from "@/context/tooltip-provider";
import { createServer } from "@/test/fixtures";

type InteractiveMapProps = Parameters<typeof InteractiveMap>[0];

const now = Date.parse("2025-01-01T00:00:20.000Z");

function LocationProbe() {
	const location = useLocation();
	return <p>{location.pathname}</p>;
}

function renderMap(ui: React.ReactElement) {
	return render(
		<MemoryRouter initialEntries={["/"]}>
			<TooltipProvider>
				{ui}
				<LocationProbe />
			</TooltipProvider>
		</MemoryRouter>,
	);
}

function mapFeature(code: string, name: string) {
	return {
		type: "Feature",
		properties: {
			iso_a2_eh: code,
			iso_a3_eh: `${code}A`,
			name,
		},
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[-100, 30],
					[-90, 30],
					[-90, 40],
					[-100, 40],
					[-100, 30],
				],
			],
		},
	};
}

describe("GlobalMap", () => {
	it("counts unique countries and ignores servers without country codes", () => {
		Object.assign(window, { CustomBackgroundImage: "/background.png" });

		const { container } = renderMap(
			<GlobalMap
				now={now}
				serverList={[
					createServer({ country_code: "us" }),
					createServer({ id: 2, country_code: "US" }),
					createServer({ id: 3, country_code: "sg" }),
					createServer({ id: 4, country_code: "" }),
				]}
			/>,
		);

		expect(container.querySelector(".global-map-heading p")).toHaveTextContent(
			"map.Distributions 2 map.Regions",
		);
		expect(container.querySelector("section")).toHaveClass("global-map-shell");
	});
	it("shows details only on map interaction and can close them", async () => {
		const user = userEvent.setup();
		const servers = [
			createServer({ id: 21, name: "Hong Kong primary", country_code: "HK" }),
			createServer({
				id: 22,
				name: "Hong Kong standby",
				country_code: "HK",
				last_active: "2020-01-01T00:00:00Z",
			}),
			createServer({ id: 23, name: "Singapore edge", country_code: "SG" }),
		];
		const view = (list: typeof servers) => (
			<MemoryRouter>
				<TooltipProvider>
					<GlobalMap now={now} serverList={list} />
					<LocationProbe />
				</TooltipProvider>
			</MemoryRouter>
		);
		const { container, rerender } = render(view(servers));
		expect(
			container.querySelector(".global-map-panel,.global-map-regions"),
		).toBeNull();
		expect(screen.queryByTestId("map-tooltip")).not.toBeInTheDocument();
		fireEvent.keyDown(
			container.querySelector('[data-region="HK"]') as SVGElement,
			{ key: "Enter" },
		);
		const tooltip = screen.getByTestId("map-tooltip");
		expect(tooltip).toHaveTextContent("map.Online 1 · map.Offline 1");
		fireEvent.mouseLeave(
			container.querySelector(".global-map-canvas") as HTMLElement,
		);
		expect(tooltip).toBeInTheDocument();
		const updated = servers.map((server) =>
			server.id === 22
				? {
						...server,
						name: "Hong Kong restored",
						last_active: "2025-01-01T00:00:20.000Z",
					}
				: server,
		);
		rerender(view(updated));
		expect(tooltip).toHaveTextContent("map.Online 2 · map.Offline 0");
		await user.click(
			within(tooltip).getByRole("button", { name: "map.Close" }),
		);
		rerender(view([...updated]));
		expect(screen.queryByTestId("map-tooltip")).not.toBeInTheDocument();
		fireEvent.click(
			container.querySelector('[data-region="SG"]') as SVGElement,
		);
		await user.click(
			within(screen.getByTestId("map-tooltip")).getByRole("button", {
				name: /Singapore edge/,
			}),
		);
		expect(await screen.findByText("/server/23")).toBeInTheDocument();
	});

	it("keeps tooltips current and resets a removed selection without losing other regions", () => {
		const servers = [
			createServer({ id: 1, name: "before", country_code: "SG" }),
			createServer({ id: 2, country_code: "US" }),
		];
		const view = (list: typeof servers) => (
			<MemoryRouter>
				<TooltipProvider>
					<GlobalMap now={now} serverList={list} />
				</TooltipProvider>
			</MemoryRouter>
		);
		const { container, rerender } = render(view(servers));
		fireEvent.mouseEnter(
			container.querySelector('[data-region="SG"]') as SVGElement,
		);
		expect(
			within(screen.getByTestId("map-tooltip")).getByText("before"),
		).toBeInTheDocument();
		rerender(view([{ ...servers[0], name: "after" }, servers[1]]));
		expect(
			within(screen.getByTestId("map-tooltip")).getByText("after"),
		).toBeInTheDocument();
		fireEvent.click(
			container.querySelector('[data-region="SG"]') as SVGElement,
		);
		rerender(view([servers[1]]));

		expect(screen.queryByTestId("map-tooltip")).not.toBeInTheDocument();
		expect(
			container.querySelector('[data-region="SG"]'),
		).not.toBeInTheDocument();
	});

	it("handles unknown regions without invalid map coordinates", () => {
		const { container } = renderMap(
			<GlobalMap
				now={now}
				serverList={[createServer({ country_code: "unknown" })]}
			/>,
		);
		expect(container.querySelector("svg")?.innerHTML).not.toMatch(
			/NaN|Infinity/,
		);
		expect(
			container.querySelector(".global-map-panel,.global-map-regions"),
		).toBeNull();
	});
});

describe("InteractiveMap", () => {
	it("shows country tooltips, navigates from servers, and clears tooltip state", async () => {
		const user = userEvent.setup();
		const filteredFeatures = [
			mapFeature("US", "United States"),
			mapFeature("DE", "Germany"),
		] as unknown as InteractiveMapProps["filteredFeatures"];

		const { container } = renderMap(
			<InteractiveMap
				countries={["US", "SG"]}
				serverCounts={{ US: 2, SG: 1 }}
				width={900}
				height={500}
				filteredFeatures={filteredFeatures}
				countryServers={{
					US: [
						{
							id: 11,
							name: "us-online",
							status: true,
						},
						{
							id: 12,
							name: "us-offline",
							status: false,
						},
					],
					SG: [
						{
							id: 13,
							name: "sg-edge",
							status: true,
						},
					],
				}}
			/>,
		);

		const highlightedCountry = container.querySelector(
			'path[data-country="US"]',
		);
		expect(highlightedCountry).toBeInTheDocument();

		fireEvent.mouseEnter(highlightedCountry as SVGPathElement);

		expect(await screen.findByText("United States")).toBeInTheDocument();
		expect(screen.getByText("2 map.Servers")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /us-offline/ }));

		expect(sessionStorage.getItem("fromMainPage")).toBe("true");
		expect(screen.getByText("/server/12")).toBeInTheDocument();

		const fallbackMarker = container.querySelector('g[data-region="SG"]');
		expect(fallbackMarker).toBeInTheDocument();

		fireEvent.mouseEnter(fallbackMarker as SVGCircleElement);

		expect(await screen.findByText("Singapore")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /sg-edge/ })).toBeInTheDocument();

		fireEvent.mouseLeave(container.querySelector(".relative") as HTMLElement);

		expect(screen.queryByText("Singapore")).not.toBeInTheDocument();
	});

	it("clears tooltip state for non-highlighted countries and empty map areas", () => {
		const filteredFeatures = [
			mapFeature("US", "United States"),
			mapFeature("DE", "Germany"),
		] as unknown as InteractiveMapProps["filteredFeatures"];

		const { container } = renderMap(
			<InteractiveMap
				countries={["US"]}
				serverCounts={{ US: 1 }}
				width={900}
				height={500}
				filteredFeatures={filteredFeatures}
				countryServers={{
					US: [
						{
							id: 11,
							name: "us-online",
							status: true,
						},
					],
				}}
			/>,
		);

		const [highlightedCountry, neutralCountry] = Array.from(
			container.querySelectorAll("path[data-country]"),
		);
		fireEvent.mouseEnter(highlightedCountry as SVGPathElement);
		expect(screen.getByText("United States")).toBeInTheDocument();

		fireEvent.mouseEnter(neutralCountry as SVGPathElement);
		expect(screen.queryByText("United States")).not.toBeInTheDocument();

		fireEvent.mouseEnter(container.querySelector("rect") as SVGRectElement);
		expect(screen.queryByText("United States")).not.toBeInTheDocument();
	});
});
