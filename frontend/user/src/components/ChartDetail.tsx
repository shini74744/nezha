import NetworkInterfaceSelect, {type NetworkInterfaceSelection} from "./NetworkInterfaceSelect";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
	memo,
	useCallback,
	useId,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent,
} from "react";
import {
	ChevronLeft,
	ChevronRight,
	RotateCcw,
	LockKeyhole,
	MousePointer2,
} from "lucide-react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceArea,
	ReferenceLine,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";
import {
	detailDateInput,
	detailDateLabel,
	detailInterval,
	detailPlotPoints,
	detailWindow,
	nearestDetailIndex,
	normalizeDetailPoints,
	parseDetailDate,
	type DetailPeriod,
	type DetailPoint,
	type DetailSeries,
	type TimeWindow,
} from "@/lib/chart-detail";
import { loadDetailHistory, type DetailHistorySource } from "@/lib/chart-detail-history";
import "./ChartDetail.css";

export type ChartDetailProps = {
 selection?: NetworkInterfaceSelection;
	scopeKey: string;
	title: string;
	data: readonly Record<string, unknown>[];
	series: DetailSeries[];
	period: DetailPeriod;
	formatValue: (value: number) => string;
	timeWindow?: TimeWindow;
	history?: DetailHistorySource;
	timeKey?: string;
	disabled?: boolean;
};
type Snapshot = Omit<ChartDetailProps, "data"> & {
	points: DetailPoint[];
	capturedAt: number;
	revision: number;
};
const MemoChartDetailView = memo(ChartDetailView);
export default function ChartDetailButton(props: ChartDetailProps) {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const revision = useRef(0);
	const latestProps = useRef(props);
	useLayoutEffect(() => { latestProps.current = props; });
	useEffect(() => setSnapshot(null), [props.scopeKey]);
	const capture = useCallback(() => {
		const props = latestProps.current;
		const points = normalizeDetailPoints(
			props.data,
			props.series,
			props.timeKey,
		);
		setSnapshot({
			...props,
			points,
			capturedAt: Date.now(),
			revision: ++revision.current,
		});
	}, []);
	const disabled = props.disabled || !props.data.length;
	useEffect(() => {
		if (disabled && !props.selection) setSnapshot(null);
	}, [disabled,props.selection]);
 useEffect(()=>{
  if(snapshot && props.selection && (snapshot.selection?.value!==props.selection.value || snapshot.selection?.pending!==props.selection.pending)) capture();
 },[props.selection?.value,props.selection?.pending,snapshot?.selection?.value,snapshot?.selection?.pending,capture]);
	const open = snapshot !== null && snapshot.scopeKey === props.scopeKey;
	return (
		<div className="chart-detail-entry">
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!value) setSnapshot(null);
				}}
			>
				<DialogTrigger asChild>
					<button
						type="button"
						className="chart-detail-open"
						disabled={disabled}
						onClick={capture}
						aria-haspopup="dialog"
						aria-expanded={open}
						aria-label={props.title + "详细查看"}
					>
						<span className="chart-detail-open-label">详细</span>
					</button>
				</DialogTrigger>
				{open && snapshot && (
					<MemoChartDetailView
						key={snapshot.revision}
						snapshot={snapshot}
                        selection={props.selection}
						onRefresh={capture}
						refreshDisabled={disabled}
					/>
				)}
			</Dialog>
		</div>
	);
}
function ChartDetailView({
	snapshot,
 selection,
	onRefresh,
	refreshDisabled,
}: {
	snapshot: Snapshot;
 selection?: NetworkInterfaceSelection;
	onRefresh: () => void;
	refreshDisabled?: boolean;
}) {
	const [record, setRecord] = useState(snapshot);
 const desktop = useMediaQuery("(min-width: 641px)");
 const [showTimeControls, setShowTimeControls] = useState(false);
 const timeControlsId = useId();
 const [activePreset, setActivePreset] = useState<number | null>(null);
 const [pendingHours, setPendingHours] = useState<number | null>(null);
 const [retryHours, setRetryHours] = useState<number | null>(null);
 const request = useRef<AbortController | null>(null);
 useEffect(() => () => request.current?.abort(), []);
 const { points, series, period, formatValue, title } = record;
 const snapshotMode = snapshot.period === "realtime" || snapshot.period === "last";
 const loadedHistory = snapshotMode && record !== snapshot;
 const hoursAvailable = !snapshotMode || !!snapshot.history;
	const first = record.timeWindow?.[0] ?? points[0]?.ts ?? snapshot.capturedAt;
	const last = record.timeWindow?.[1] ?? points[points.length - 1]?.ts ?? first;
	const [window, setWindow] = useState<TimeWindow>([first, last]);
	const [selectedTs, setSelectedTs] = useState(last);
	const [locked, setLocked] = useState(false);
	// The dialog library retains its native key listener; read the committed lock state.
	const lockedRef = useRef(locked);
	useLayoutEffect(() => {
		lockedRef.current = locked;
	}, [locked]);
	const [zoom, setZoom] = useState(false);
	const [drag, setDrag] = useState<TimeWindow | null>(null);
	const [startInput, setStartInput] = useState(detailDateInput(first));
	const [endInput, setEndInput] = useState(detailDateInput(last));
	const [targetInput, setTargetInput] = useState(detailDateInput(last));
	const [targetTs, setTargetTs] = useState<number | null>(null);
	const [error, setError] = useState("");
	const gesture = useRef<{
		x: number;
		y: number;
		ts: number;
		kind: string;
		moved: boolean;
	} | null>(null);
	const interval = useMemo(
		() => detailInterval(period, points),
		[period, points],
	);
	const visible = useMemo(
		() => points.filter((p) => p.ts >= window[0] && p.ts <= window[1]),
		[points, window],
	);
	const selectable = useMemo(
		() => visible.filter((p) => series.some((s) => p[s.key] != null)),
		[visible, series],
	);
	const selectedIndex = nearestDetailIndex(selectable, selectedTs);
	const selected = selectable[selectedIndex];
	const plotPoints = useMemo(
		() => detailPlotPoints(visible, interval, series),
		[visible, interval, series],
	);
	const domain: TimeWindow =
		window[0] === window[1]
			? [window[0] - interval / 2, window[1] + interval / 2]
			: window;
	const sampling =
		period === "1d"
			? "30 秒"
			: period === "7d"
				? "30 分钟"
				: period === "30d"
					? "2 小时"
					: null;
	const applyWindow = (next: TimeWindow) => {
		const valid = detailWindow(points, next[0], next[1], record.timeWindow);
		if (!valid) {
			setError("这个范围没有记录，或超出了已加载数据。");
			return false;
		}
		request.current?.abort();request.current=null;setPendingHours(null);setRetryHours(null);
		setActivePreset(null);
		setZoom(false);
		setWindow(valid);
		setStartInput(detailDateInput(valid[0]));
		setEndInput(detailDateInput(valid[1]));
		setError("");
		setDrag(null);
		setLocked(false);
		setTargetTs(null);
		if (selectedTs < valid[0] || selectedTs > valid[1]) setSelectedTs(valid[1]);
		return true;
	};
 const resetView = (next: Snapshot, range: TimeWindow, hours: number | null) => {
  setRecord(next);setWindow(range);setStartInput(detailDateInput(range[0]));setEndInput(detailDateInput(range[1]));
  setTargetInput(detailDateInput(range[1]));setSelectedTs(range[1]);setTargetTs(null);
  setLocked(false);setZoom(false);setDrag(null);setError("");setRetryHours(null);setActivePreset(hours);
 };
 const loadHours = async (hours: number) => {
  if(!snapshot.history)return;
  request.current?.abort();
  const controller=new AbortController();request.current=controller;
  setPendingHours(hours);setError("");setRetryHours(null);
  const end=Date.now(),bounds:TimeWindow=[end-86400000,end];
  try {
   const rows=await loadDetailHistory(snapshot.history,controller.signal);
   if(controller.signal.aborted || request.current!==controller)return;
   const next:Snapshot={...snapshot,points:rows.filter(p=>p.ts>=bounds[0]&&p.ts<=bounds[1]),period:"1d",timeWindow:bounds,capturedAt:end};
   resetView(next,[end-hours*3600000,end],hours);
  } catch(error) {
   if(controller.signal.aborted || request.current!==controller)return;
   setError("历史记录读取失败，原有查看内容已保留。");setRetryHours(hours);
  } finally {
   if(request.current===controller){request.current=null;setPendingHours(null);}
  }
 };
 const preset = (hours: number) => {
  if(!hoursAvailable)return;
  if(snapshotMode && !loadedHistory){void loadHours(hours);return;}
  request.current?.abort();request.current=null;setPendingHours(null);setRetryHours(null);
  if(applyWindow([Math.max(first,last-hours*3600000),last]))setActivePreset(hours);
 };
 const restore = () => {
  request.current?.abort();request.current=null;setPendingHours(null);setRetryHours(null);
  applyWindow([first,last]);
 };
 const restoreDisabled = pendingHours===null && !error && !locked && !zoom && targetTs===null &&
  window[0]===first && window[1]===last && startInput===detailDateInput(first) && endInput===detailDateInput(last);
 const returnSnapshot = () => {
  request.current?.abort();request.current=null;setPendingHours(null);
  const start=snapshot.timeWindow?.[0]??snapshot.points[0]?.ts??snapshot.capturedAt;
  const end=snapshot.timeWindow?.[1]??snapshot.points[snapshot.points.length-1]?.ts??start;
  resetView(snapshot,[start,end],null);
 };
	const pick = (ts: number, pin = false) => {
		const index = nearestDetailIndex(selectable, ts);
		if (index < 0) return;
		setSelectedTs(selectable[index].ts);
		setTargetTs(null);
		if (pin) setLocked(true);
	};
	const step = (delta: number) => {
		const next = Math.max(
			0,
			Math.min(selectable.length - 1, selectedIndex + delta),
		);
		if (selectable[next]) {
			setSelectedTs(selectable[next].ts);
			setLocked(true);
			setTargetTs(null);
		}
	};
	const coordinate = (event: PointerEvent<HTMLDivElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		const ratio =
			box.width > 0
				? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
				: 0;
		return domain[0] + ratio * (domain[1] - domain[0]);
	};
	const release = (event: PointerEvent<HTMLDivElement>) => {
		const down = gesture.current;
		gesture.current = null;
		if (!down) return;
		const ts = coordinate(event);
		if (down.kind === "mouse" && zoom && Math.abs(event.clientX - down.x) > 6) {
			const start = Math.max(first, Math.min(down.ts, ts)),
				end = Math.min(last, Math.max(down.ts, ts));
			applyWindow([start, end]);
			setZoom(false);
		} else if (Math.abs(event.clientY - down.y) < 12 || down.moved)
			pick(ts, true);
		setDrag(null);
	};
	const jump = () => {
		const inputTs = parseDetailDate(targetInput);
		const ts =
			inputTs !== undefined && inputTs < first && first - inputTs < 1000
				? first
				: inputTs;
		if (ts === undefined || ts < first || ts > last) {
			setError("请选择已加载数据范围内的北京时间。");
			return;
		}
		const allSelectable = points.filter((p) =>
			series.some((s) => p[s.key] != null),
		);
		const point = allSelectable[nearestDetailIndex(allSelectable, ts)];
		if (!point) {
			setError("该时间范围没有可查看的数据。");
			return;
		}
		// A centered one-hour window never implies finer backend sampling.
		const span = Math.max(3_600_000, interval * 4);
		applyWindow([
			Math.max(first, point.ts - span / 2),
			Math.min(last, point.ts + span / 2),
		]);
		setSelectedTs(point.ts);
		setLocked(true);
		setTargetTs(ts);
		setError("");
	};
	const formRange = () => {
		const start = parseDetailDate(startInput),
			end = parseDetailDate(endInput);
		// datetime-local displays whole seconds, while raw live samples include milliseconds.
		const lower =
			start !== undefined && Math.abs(start - first) < 1000 ? first : start;
		const upper = end !== undefined && Math.abs(end - last) < 1000 ? last : end;
		if (lower === undefined || upper === undefined || lower > upper) {
			setError("开始时间不能晚于结束时间，请填写有效的北京时间。");
			return;
		}
		applyWindow([lower, upper]);
	};
	return (
		<DialogContent
			className="chart-detail-dialog"
			onEscapeKeyDown={(event) => {
				if (lockedRef.current) {
					event.preventDefault();
					setLocked(false);
				}
			}}
		>
			<header className="chart-detail-heading">
				<DialogTitle>{title} · 详细查看</DialogTitle>
				<DialogDescription>
					北京时间 ·{" "}
					{period === "realtime"
						? "打开时的实时快照"
						: period === "last"
							? "离线前的已保存记录"
							: "已加载的历史记录"}
					，查看时不自动滚动。
				</DialogDescription>
			</header>
 {selection&&<div className="flex items-center gap-2 text-sm"><span>网卡</span><NetworkInterfaceSelect selection={selection}/></div>}
 {selection?.pending&&<p role="status" className="text-sm text-muted-foreground">正在读取…</p>}
 {selection?.message&&<p role="alert" className="chart-detail-error">{selection.message}</p>}
			<div className="chart-detail-toolbar">
				<div className="chart-detail-presets" aria-label="查看范围">
					<button
						type="button"
						onClick={() => preset(1)}
                        aria-pressed={activePreset === 1}
                        aria-busy={pendingHours === 1}
                        disabled={!hoursAvailable}
					>
						近 1 小时
					</button>
					<button
						type="button"
						onClick={() => preset(6)}
                        aria-pressed={activePreset === 6}
                        aria-busy={pendingHours === 6}
                        disabled={!hoursAvailable}
					>
						近 6 小时
					</button>
					<button
						type="button"
						onClick={() => preset(24)}
                        aria-pressed={activePreset === 24}
                        aria-busy={pendingHours === 24}
                        disabled={!hoursAvailable}
					>
						近 24 小时
					</button>
					<button
						type="button"
						onClick={restore}
                        disabled={restoreDisabled}
					>
						<RotateCcw aria-hidden size={14} />
						恢复全部
					</button>
				</div>
<div className="chart-detail-presets">
     {loadedHistory && <button type="button" onClick={returnSnapshot}>{snapshot.period==="last"?"返回最后状态":"返回实时快照"}</button>}
     <button type="button" onClick={loadedHistory ? () => {void loadHours(activePreset??24);} : onRefresh} disabled={pendingHours!==null || (!loadedHistory && refreshDisabled)}>
      {loadedHistory ? "刷新历史记录" : "更新查看快照"}
     </button>
    </div>
			</div>
   {pendingHours!==null && <p role="status" className="chart-detail-caption">正在读取近 {pendingHours} 小时的历史记录…</p>}
   {!hoursAvailable && <p className="chart-detail-caption">该指标尚未保存小时级历史，只能查看当前快照。</p>}
   <button type="button" className="chart-detail-time-toggle" aria-expanded={desktop || showTimeControls} aria-controls={timeControlsId} onClick={() => setShowTimeControls(value => !value)}>
    {showTimeControls ? "收起时间选择" : "选择时间范围或定位"}
   </button>
   <div id={timeControlsId} className="chart-detail-time-options" hidden={!desktop && !showTimeControls}>
   <div className="chart-detail-forms">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						formRange();
					}}
					className="chart-detail-range"
				>
					<label>
						开始时间
						<input
							type="datetime-local"
							step="1"
							value={startInput}
							onChange={(e) => setStartInput(e.target.value)}
						/>
					</label>
					<label>
						结束时间
						<input
							type="datetime-local"
							step="1"
							value={endInput}
							onChange={(e) => setEndInput(e.target.value)}
						/>
					</label>
					<button type="submit" disabled={!points.length}>
						查看范围
					</button>
				</form>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						jump();
					}}
					className="chart-detail-jump"
				>
					<label>
						定位时间
						<input
							type="datetime-local"
							step="1"
							value={targetInput}
							onChange={(e) => setTargetInput(e.target.value)}
						/>
					</label>
					<button type="submit" disabled={!points.length}>
						定位
					</button>
				</form>
			</div>
			<p className="chart-detail-caption">
				可查看：{detailDateLabel(first)} — {detailDateLabel(last)}。
				{sampling
					? "当前每 " + sampling + " 一个聚合点，放大不改变采样精度。"
					: "仅显示当前已记录的数据。"}
			</p>
   </div>
			{error && (
				<p role="alert" className="chart-detail-error">
					{error}{retryHours!==null && <button type="button" className="underline ml-2" onClick={()=>{void loadHours(retryHours);}}>重试</button>}
				</p>
			)}
			<div className="chart-detail-plot-toolbar">
				<span>
					{detailDateLabel(window[0])} — {detailDateLabel(window[1])}
				</span>
				<button
					type="button"
					className="chart-detail-drag-toggle"
					aria-pressed={zoom}
					onClick={() => {
						setZoom((v) => !v);
						setDrag(null);
					}}
					disabled={selectable.length < 2}
				>
					<MousePointer2 aria-hidden size={14} />
					{zoom ? "退出拖选" : "拖选放大"}
				</button>
			</div>
			<div className="chart-detail-plot" data-detail-plot data-window-start={window[0]} data-window-end={window[1]} aria-busy={pendingHours!==null}>
				{visible.length ? (
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={plotPoints}
							margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
						>
							<CartesianGrid vertical={false} stroke="hsl(var(--border))" />
							<XAxis
								dataKey="ts"
								type="number"
								domain={domain}
								allowDataOverflow
								tickLine={false}
								axisLine={false}
								height={32}
								minTickGap={55}
								tickFormatter={(value) =>
									detailDateLabel(Number(value)).slice(
										window[1] - window[0] >= 86_400_000 ? 5 : 11,
										window[1] - window[0] < 300_000 ? 19 : 16,
									)
								}
								tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
							/>
							<YAxis
								width={64}
								tickLine={false}
								axisLine={false}
								domain={[0, "auto"]}
								tickFormatter={formatValue}
								tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
							/>
							{series.map((s) => (
								<Line
									key={s.key}
									dataKey={s.key}
									name={s.label}
									type="linear"
									stroke={s.color}
									strokeWidth={1.5}
									dot={visible.length === 1}
									activeDot={false}
									connectNulls={false}
									isAnimationActive={false}
								/>
							))}
							{selected && (
								<ReferenceLine
									x={selected.ts}
									stroke="hsl(var(--foreground))"
									strokeDasharray={locked ? undefined : "4 3"}
								/>
							)}
							{drag && (
								<ReferenceArea
									x1={Math.min(...drag)}
									x2={Math.max(...drag)}
									fill="hsl(var(--primary))"
									fillOpacity={0.15}
								/>
							)}
						</LineChart>
					</ResponsiveContainer>
				) : (
					<p className="chart-detail-empty">这个范围没有记录。</p>
				)}
				<div
					className={"chart-detail-hitarea" + (zoom ? " is-zoom" : "")}
					tabIndex={0}
					role="group"
					aria-label="图表选点，左右方向键逐点查看，Home 和 End 跳到首尾，Escape 解除锁定"
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							event.preventDefault();
							step(event.key === "ArrowLeft" ? -1 : 1);
						}
						if (event.key === "Home" || event.key === "End") {
							event.preventDefault();
							pick(event.key === "Home" ? window[0] : window[1], true);
						}
					}}
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						const ts = coordinate(event);
						gesture.current = {
							x: event.clientX,
							y: event.clientY,
							ts,
							kind: event.pointerType,
							moved: false,
						};
						if (event.pointerType === "mouse") {
							event.currentTarget.focus();
							event.currentTarget.setPointerCapture(event.pointerId);
							if (zoom) setDrag([ts, ts]);
						}
					}}
					onPointerMove={(event) => {
						const down = gesture.current,
							ts = coordinate(event);
						if (down && event.pointerType === "touch") {
							const dx = Math.abs(event.clientX - down.x),
								dy = Math.abs(event.clientY - down.y);
							if (dx > 8 && dx > dy) {
								down.moved = true;
								pick(ts, true);
							}
							return;
						}
						if (down && zoom) {
							setDrag([down.ts, ts]);
							return;
						}
						if (!locked) pick(ts);
					}}
					onPointerUp={release}
					onPointerCancel={() => {
						gesture.current = null;
						setDrag(null);
					}}
					onPointerLeave={() => {
						if (!gesture.current) setDrag(null);
					}}
				/>
			</div>
			<div
				className="chart-detail-readout"
				data-detail-readout
				aria-live={locked ? "polite" : "off"}
			>
				<div className="chart-detail-readout-heading">
					<strong>
						{selected ? detailDateLabel(selected.ts) : "暂无有效采样"}{" "}
						<span>北京时间</span>
					</strong>
					<span>
						{locked ? (
							<>
								<LockKeyhole aria-hidden size={13} />
								已锁定
							</>
						) : (
							"移动指针预览，点按锁定"
						)}
					</span>
				</div>
				{targetTs !== null && selected && targetTs !== selected.ts && (
					<p>
						定位到最近的实际采样点；输入时间为 {detailDateLabel(targetTs)}。
					</p>
				)}
				<dl>
					{series.map((s) => (
						<div key={s.key}>
							<dt>
								<i style={{ background: s.color }} aria-hidden />
								{s.label}
							</dt>
							<dd>
								{selected?.[s.key] == null
									? "无记录"
									: formatValue(selected[s.key] as number)}
							</dd>
						</div>
					))}
				</dl>
			</div>
			<div className="chart-detail-navigation">
				<button
					type="button"
					onClick={() => step(-1)}
					disabled={selectedIndex <= 0}
				>
					<ChevronLeft aria-hidden size={16} />
					上一点
				</button>
				<span>
					{selectable.length ? selectedIndex + 1 : 0} / {selectable.length}
				</span>
				<button
					type="button"
					onClick={() => step(1)}
					disabled={selectedIndex < 0 || selectedIndex >= selectable.length - 1}
				>
					下一点
					<ChevronRight aria-hidden size={16} />
				</button>
				<button
					type="button"
					onClick={() => setLocked(false)}
					disabled={!locked}
				>
					解除锁定
				</button>
			</div>
			<p className="chart-detail-caption">
				手机点按或横向滑动选点，纵向滑动页面。电脑可拖选放大，用方向键逐点查看。
			</p>
		</DialogContent>
	);
}
