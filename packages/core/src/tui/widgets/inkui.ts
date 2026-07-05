// The one import site for @inkjs/ui under tui/**. Re-export only the @inkjs/ui components the setup TUI uses so
// every UI consumer imports from here and the render-bundle guard has a single symbol to track. @inkjs/ui carries
// ink/react as peers, which the engine already ships; it must never reach the ccsidekick-render hot-path bundle.

export { Alert, ProgressBar, Spinner } from "@inkjs/ui";
