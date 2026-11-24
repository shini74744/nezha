import { art } from "./assets";
import {useDoraFeature} from "./Appearance";
import {FriendsInteraction} from "./Friends";
import { useDoraMotion } from "./use-motion";
// In normal document flow, so the illustration never covers a card or toolbar.
export function DoraemonCompanion() {
    const enabled=useDoraFeature('friendsInteraction');
    return enabled?<FriendsInteraction/>:<ClassicCompanion/>;
}
function ClassicCompanion() {
	const motion = useDoraMotion<HTMLElement>();
	return (
		<section
			className="dora-companion"
			aria-label="哆啦 A 梦的铜锣烧休息站"
			{...motion}
		>
			<div className="dora-companion-figure" aria-hidden="true">
				<img src={art.doraemon} alt="" />
				<svg className="dora-dorayaki" viewBox="0 0 70 44" aria-hidden="true">
					<ellipse cx="35" cy="25" rx="32" ry="15" fill="#884926" />
					<ellipse cx="35" cy="24" rx="31" ry="10" fill="#673325" />
					<ellipse
						cx="35"
						cy="18"
						rx="32"
						ry="15"
						fill="#dfa65c"
						stroke="#b97831"
						strokeWidth="2"
					/>
					<ellipse cx="35" cy="15" rx="20" ry="7" fill="#f8ca7d" />
					<path
						d="M26 16q9-6 18 0"
						fill="none"
						stroke="#b97831"
						strokeWidth="2"
						strokeLinecap="round"
					/>
				</svg>
				<span className="dora-companion-spark">✦</span>
			</div>
			<span className="dora-companion-bubble">
				辛苦啦，来份铜锣烧！<small>让可靠的道具，陪你每一天。</small>
			</span>
		</section>
	);
}
