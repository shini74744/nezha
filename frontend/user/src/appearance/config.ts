import {validateMascot} from "./mascot-config";
import {validateVisitorIP} from "./visitor-ip-config";
import {upgradeSpeed} from "./speed-config";
import manifestData from "./manifest.json";
import {validateGreetingClock} from "./greeting-clock";
import {upgradeBackground, validateBackground} from "./background-config";
export type Feature = { enabled: boolean; [key: string]: any };
export type AppearanceConfig = {
	version: 1;
	enabled: boolean;
	features: Record<string, Feature>;
};
export type FeatureDefinition = {
	key: string;
	title: string;
	description: string;
	defaults: Feature;
	labels: Record<string, string>;
	constraints: Record<string, number[]>;
};
export const definitions = manifestData as unknown as FeatureDefinition[];
export const defaults = (): AppearanceConfig => ({
	version: 1,
	enabled: false,
	features: Object.fromEntries(
		definitions.map((d) => [d.key, JSON.parse(JSON.stringify(d.defaults))]),
	),
});
export function normalize(raw?: string | AppearanceConfig): AppearanceConfig {
	const base = defaults();
	if (!raw) return base;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (
			parsed.version !== 1 ||
			typeof parsed.enabled !== "boolean" ||
			!parsed.features
		)
			return base;
		base.enabled = parsed.enabled;
		for (const d of definitions) {
			const value = parsed.features[d.key];
			if (
				value &&
				typeof value === "object" &&
				!Array.isArray(value) &&
				typeof value.enabled === "boolean"
			)
				base.features[d.key] = { ...base.features[d.key], ...value };
		}
		if(!parsed.features.peakCut)base.features.peakCut={...base.features.peakCut,enabled:!!base.features.background.enabled&&!!base.features.background.peakCutDesktop};
  base.features.speed=upgradeSpeed(base.features.speed,parsed.features.speed);
  base.features.background=upgradeBackground(base.features.background,parsed.features.background);
		return validate(base) ? defaults() : base;
	} catch {
		return defaults();
	}
}
const urlKey =
	/(url|logo|illustration|^link$|^src$|images$|^regionApi$|^cdnPath$)/i;
function check(key: string, value: any, sample: any): void {
	if (Array.isArray(sample)) {
		if (!Array.isArray(value) || value.length > 256)
			throw Error(key + " 必须为不超过 256 项的列表");
		if(key!=="customCharacters")for (const item of value) check(key, item, sample[0]);
		return;
	}
	if (sample && typeof sample === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw Error(key + " 必须为对象");
		for (const k of Object.keys(value))
			if (!(k in sample)) throw Error(key + "." + k + " 为未知参数");
		for (const k of Object.keys(sample)) check(k, value[k], sample[k]);
		return;
	}
	if (typeof value !== typeof sample) throw Error(key + " 类型错误");
	if (
		typeof value === "number" &&
		(!Number.isFinite(value) || Math.abs(value) > 31536000000)
	)
		throw Error(key + " 数字无效");
	if (typeof value === "string") {
		if (value.length > 8192 || value.includes("\0"))
			throw Error(key + " 文本无效");
		if (value && urlKey.test(key)) {
			const u = new URL(value);
			if (
				!["http:", "https:"].includes(u.protocol) ||
				!u.host ||
				u.username ||
				u.password
			)
				throw Error(key + " 只允许不含账号密码的 HTTP/HTTPS 地址");
		}
	}
}
export function validate(config: AppearanceConfig): string {
	try {
		for (const d of definitions) {
			const f = config.features[d.key];
			check(d.key, f, d.defaults);
			for (const [key, range] of Object.entries(d.constraints))
				if (f[key] < range[0] || f[key] > range[1])
					throw Error(
						d.title +
							"：" +
							(d.labels[key] || key) +
							" 超出范围 " +
							range.join("–"),
					);
			for (const key of [
				"count",
				"mobileCount",
				"selection",
				"nightStart",
				"nightEnd",
			])
				if (typeof f[key] === "number" && !Number.isInteger(f[key]))
					throw Error(key + " 必须是整数");
		}
		if (
			!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(config.features.runtime.startDate) ||
			Number.isNaN(Date.parse(config.features.runtime.startDate))
		)
			throw Error("网站运行起始时间须包含有效时区");
		if (!/^G-[A-Z0-9]+$/.test(config.features.analytics.measurementId))
			throw Error("Google Analytics ID 无效");
		if (
			!/^-?\d+(\.\d+)?(px|vh|rem|%)$/.test(config.features.sponsor.desktopTop)
		)
			throw Error("赞助条位置须带 px/vh/rem/% 单位");
		if (
			!/^\d{1,3},\d{1,3},\d{1,3}$/.test(config.features.network.color) ||
			config.features.network.color
				.split(",")
				.some((n: string) => Number(n) > 255)
		)
			throw Error("连线颜色须为 RGB 数值，例如 255,255,255");
		validateMascot(config.features.live2d);
  validateVisitorIP(config.features.visitorIP);
  validateBackground(config.features.background);
		validateGreetingClock(config.features);
		for (const tool of config.features.live2d.tools)
			if (
				![
					"hitokoto",
					"asteroids",
					"switch-model",
					"switch-texture",
					"photo",
					"info",
					"quit",
				].includes(tool)
			)
				throw Error("未知 Live2D 工具：" + tool);
		for (const key of ["videoSelector", "toggleSelector"]) {
			const selector = config.features.video[key];
			if (!selector.trim()) throw Error("视频选择器不能为空");
			document.querySelector(selector);
		}
		return "";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
