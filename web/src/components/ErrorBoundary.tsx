/**
 * Error boundary (DW-056). React unmounts the WHOLE tree when a render throws, so before
 * this a single bad value anywhere in Review — a malformed history row after a mid-season
 * server upgrade, an undefined in a module-gated branch — took the student to a blank white
 * page, mid-class, with a solo game that lives only in memory. There is no recovering a
 * white screen from the back of a lecture hall.
 *
 * Two placements, deliberately: one around each Review panel, so a broken panel is a broken
 * panel and the other tabs still work; one around the whole app as a backstop. The inner one
 * resets when `resetKey` changes (the tab id), so switching tabs clears the error without a
 * reload.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Changing this clears a caught error — pass the tab id so switching tabs recovers. */
  resetKey?: string | number;
  /** "panel" degrades gracefully inside the page; "app" is the full-screen backstop. */
  scope?: "panel" | "app";
  label?: string;
}
interface State { error: Error | null; key: string | number | undefined }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.error && props.resetKey !== state.key) return { error: null, key: props.resetKey };
    if (state.key !== props.resetKey) return { key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only recorder here — no telemetry ships from a student's browser.
    console.error("[drinkwars] render error", this.props.label ?? this.props.scope, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const app = this.props.scope === "app";
    return (
      <div className={app ? "mx-auto mt-10 max-w-[560px] px-4" : "px-4 py-6"}>
        <div className="rounded-lg border border-brick/40 bg-brick/10 px-4 py-3 text-sm text-ink">
          <div className="font-semibold text-brick">
            {app ? "Something broke." : `This panel hit an error${this.props.label ? ` (${this.props.label})` : ""}.`}
          </div>
          <p className="mt-1 text-inksoft">
            {app
              ? "Your round is safe on the server if you are playing with a team; a solo game lives only in this tab."
              : "The rest of the round is fine — switch tabs and carry on. Your decisions are untouched."}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-line2 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:text-copper"
            >
              Reload
            </button>
            <span className="text-xs text-inksoft">Tell your instructor what you were doing — the details are in the browser console.</span>
          </div>
        </div>
      </div>
    );
  }
}
