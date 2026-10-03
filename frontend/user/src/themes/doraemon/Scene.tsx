import { art } from "./assets";
import { useDoraMotion } from "./use-motion";
export function DoraemonScene() {
	const motion = useDoraMotion<HTMLDivElement>();
	return (
		<div className="dora-scene" aria-hidden="true" {...motion}>
			<div className="dora-sun" />
			<div className="dora-stars" />
			<img className="dora-cloud dora-cloud-a" src={art.cloud} alt="" />
			<img className="dora-cloud dora-cloud-b" src={art.cloud} alt="" />
			<img className="dora-flying" src={art.flying} alt="" />
			<svg
				className="dora-town"
				viewBox="0 0 1440 170"
				preserveAspectRatio="xMidYMax slice"
			>
				<path
					fill="currentColor"
					opacity=".3"
					d="M0 170V90h75V55h95v65h80V35h110v70h45V65h120v65h100V40h85v75h95V60h120v50h60V30h115v75h70V65h120v30h140v75z"
				/>
				<g
					fill="var(--dora-town)"
					stroke="var(--dora-town-line)"
					strokeWidth="3"
				>
					<path d="M20 170V90h160v80M45 90V60h70v30M235 170V80h155v90M220 80l90-45 94 45M520 170V100h165v70M505 100l95-50 100 50M980 170V80h175v90M960 80l107-55 105 55M1220 170V100h170v70" />
					<path
						d="M120 170V25m-30 15h60M810 170V10m-34 26h70M1320 170V20m-32 24h65"
						fill="none"
					/>
					<path d="M120 40Q445 125 810 36Q1080 100 1320 44" fill="none" />
				</g>
				<g fill="var(--dora-window)">
					{[45, 100, 265, 325, 550, 610, 1015, 1080, 1245, 1310].map((x, i) => (
						<rect
							key={x}
							x={x}
							y={110 + (i % 2) * 8}
							width="28"
							height="22"
							rx="2"
						/>
					))}
				</g>
				<g fill="#7bb6ce" stroke="#c7e9f5" strokeWidth="5">
					<rect x="735" y="127" width="150" height="31" rx="15" />
					<rect x="767" y="99" width="94" height="31" rx="15" />
				</g>
				<path fill="var(--dora-town)" d="M0 160h1440v10H0z" />
			</svg>
		</div>
	);
}
export function DoraemonLoading() {
	return (
		<div className="dora-loading" role="status">
			<img src={art.flying} alt="" />
			<strong>竹蜻蜓正在连接道具监控站…</strong>
			<span>正在读取服务器实时状态</span>
		</div>
	);
}
