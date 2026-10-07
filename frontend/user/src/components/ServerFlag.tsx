import { hasFlag } from "country-flag-icons";
import getUnicodeFlagIcon from "country-flag-icons/unicode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const normalizeCountryCode = (countryCode: string) =>
	countryCode.trim().replace(/_/g, "-").toUpperCase();

// Canvas feature detection is identical for all flags in this document.
let emojiSupport: boolean | undefined;
function detectEmojiFlags() {
 if (emojiSupport !== undefined) return emojiSupport;
 const ctx = document.createElement("canvas").getContext("2d");
 if (!ctx) return false;
 try {
  ctx.fillStyle = "#000"; ctx.textBaseline = "top"; ctx.font = "32px Arial";
  ctx.fillText("🇺🇸", 0, 0);
  emojiSupport = ctx.getImageData(16, 16, 1, 1).data[3] !== 0;
 } catch { emojiSupport = false; }
 return emojiSupport;
}
export default function ServerFlag({
	country_code,
	className,
}: {
	country_code: string;
	className?: string;
}) {
	const [supportsEmojiFlags, setSupportsEmojiFlags] = useState(() => emojiSupport ?? false);

	// @ts-expect-error ForceUseSvgFlag is a global variable
	const forceUseSvgFlag = window.ForceUseSvgFlag as boolean;

// biome-ignore lint/correctness/useExhaustiveDependencies: The custom-code global may change between renders; recompute flag support when its value changes.
	useEffect(() => {
		if (forceUseSvgFlag) {
			// 如果环境变量要求直接使用 SVG，则无需检查 Emoji 支持
			setSupportsEmojiFlags(false);
			return;
		}

		setSupportsEmojiFlags(detectEmojiFlags());
	}, [forceUseSvgFlag]);

	const normalizedCountryCode = normalizeCountryCode(country_code || "");
	const canRenderSvgFlag = hasFlag(normalizedCountryCode);
	const canRenderEmojiFlag = /^[A-Z]{2}$/.test(normalizedCountryCode);

	if (!canRenderSvgFlag) return null;

	return (
		<span className={cn("text-[12px] text-muted-foreground", className)}>
			{forceUseSvgFlag || !supportsEmojiFlags || !canRenderEmojiFlag ? (
				<span className={`fi fi-${normalizedCountryCode.toLowerCase()}`} />
			) : (
				getUnicodeFlagIcon(normalizedCountryCode)
			)}
		</span>
	);
}
