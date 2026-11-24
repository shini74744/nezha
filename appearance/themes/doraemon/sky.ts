/** Resolve the automatic sky against Beijing wall time, not the visitor timezone. */
export const beijingSky = (now = new Date()): "light" | "dark" => {
	const hour = new Date(now.getTime() + 8 * 3600000).getUTCHours();
	return hour >= 7 && hour < 19 ? "light" : "dark";
};
