export function SessionError({retry}:{retry:()=>void}) {
 return <div role="alert" className="rounded-xl border bg-card/70 p-5 text-sm">
  暂时无法确认登录状态。<button type="button" className="ml-2 underline" onClick={retry}>重试</button>
 </div>;
}
