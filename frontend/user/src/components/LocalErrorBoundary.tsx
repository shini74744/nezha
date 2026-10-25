import { Children, Component, Fragment, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey?: string | number; onRetry?: () => void };
type State = { error: Error | null; attempt: number; resetKey?: string | number };
export class LocalErrorBoundary extends Component<Props, State> {
 state: State = { error: null, attempt: 0, resetKey: this.props.resetKey };
 static getDerivedStateFromError(error: Error) { return { error }; }
 static getDerivedStateFromProps(props: Props, state: State) {
  return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
 }
 render() {
  const { error, attempt } = this.state;
  if (error) return <section role="alert" data-local-error className="rounded-xl border bg-card/70 p-5 text-sm text-muted-foreground">
   <p>此区域暂时无法加载，请重试。</p>
   <div className="mt-3 flex gap-4">
    <button type="button" className="underline" onClick={() => { this.props.onRetry?.(); this.setState({ error: null, attempt: attempt + 1 }); }}>重新加载</button>
    {/import|chunk|module script/i.test(error.message || "") && <button type="button" className="underline" onClick={() => window.location.reload()}>刷新页面</button>}
   </div>
  </section>;
  return <Fragment key={attempt}>{this.props.children}</Fragment>;
 }
}

// The grid keeps its existing DOM/layout; only a failed card is replaced.
export function IsolatedChildren({ children, resetKey }: Props) {
 return Children.map(children, child => child && <LocalErrorBoundary resetKey={resetKey}>{child}</LocalErrorBoundary>);
}
