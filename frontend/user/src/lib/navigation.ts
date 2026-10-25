import { safeSessionStorage } from "@/lib/storage";
export function saveMainPageScrollPosition() {
	const scrollPosition =
		window.scrollY ||
		document.documentElement.scrollTop ||
		document.body.scrollTop ||
		0;

	safeSessionStorage.setItem("fromMainPage", "true");
	safeSessionStorage.setItem("scrollPosition", String(scrollPosition));
}
