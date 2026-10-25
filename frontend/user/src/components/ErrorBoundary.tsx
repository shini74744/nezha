import React from "react";

import ErrorPage from "../pages/ErrorPage";

interface Props {
	children: React.ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

class ErrorBoundary extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError(error: Error): State {
		return {
			hasError: true,
			error,
		};
	}

	render() {
		if (this.state.hasError) {
			return (
				<><ErrorPage
					code={500}
					message={this.state.error?.message || "应用程序发生错误"}
				/>
                <div className="mt-4 flex justify-center gap-4 text-sm"><button type="button" className="underline" onClick={() => this.setState({hasError:false,error:undefined})}>重新加载</button><button type="button" className="underline" onClick={() => window.location.reload()}>刷新页面</button></div></>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
