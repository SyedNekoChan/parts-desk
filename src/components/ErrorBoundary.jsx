import React from "react";

/* Last line of defense against a blank screen.

   The specific bug this project just hit — ListingEditor crashing on
   item.data being null — is fixed at its source in App.jsx's render
   guard. This boundary exists for every *other* render exception that
   guard doesn't and can't anticipate: a future component change, a
   malformed piece of persisted state from an old version, anything.
   Without something catching render errors, any uncaught exception
   during render unmounts the whole React tree, and the person sees an
   empty page with nothing to click and no way to know what happened.

   Deliberately minimal: no telemetry, no retry logic, just enough to
   turn "blank page" into "something broke, here's how to recover"
   without requiring a whole error-reporting architecture. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept to the browser console only — not sent anywhere, not
    // written to storage. A render crash is exactly the moment
    // storage might itself be in a state worth not touching further.
    console.error("Parts Desk crashed while rendering:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Something went wrong displaying this.
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {this.state.error.message || "An unexpected error occurred."}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your queue and settings are saved in this browser and were not affected.
        </p>
        <button
          type="button"
          className="pd-btn pd-btn-primary mt-5"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
