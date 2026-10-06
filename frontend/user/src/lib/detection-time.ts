// Automatic records use their scheduled UTC+8 slot; manual records keep the real time.
const options: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "numeric",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
};
const scheduledFormatter = new Intl.DateTimeFormat("zh-CN", {
	...options,
	timeZone: "Asia/Shanghai",
});
export function formatDetectionTime(value?: number, scheduled = false) {
	if (!value) return "—";
	return scheduled
		? scheduledFormatter.format(value)
		: new Date(value).toLocaleString("zh-CN", { hourCycle: "h23" });
}
