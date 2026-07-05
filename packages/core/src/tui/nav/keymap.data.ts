// The keybinding table the Help popup renders and the footer hint bar draws its labels from, so on-screen help
// cannot drift from the real bindings. `ctrl+p` (preview) is handled in the Dashboard, not the pure dispatcher;
// it still belongs here because it is a user-facing key Help must list.

export type BindingGroup = "Navigate" | "Find & preview" | "Actions";

interface Binding {
	readonly keys: string;
	readonly label: string;
	readonly group: BindingGroup;
}

export const KEYMAP: readonly Binding[] = [
	{ keys: "w a s d", label: "move (also ↑↓←→, h j k l)", group: "Navigate" },
	{ keys: "tab", label: "sidebar / content", group: "Navigate" },
	{ keys: "1-8", label: "jump to a section", group: "Navigate" },
	{ keys: "↵", label: "open, select, toggle", group: "Navigate" },
	{ keys: "esc", label: "back, close, quit", group: "Navigate" },
	{ keys: "/", label: "find", group: "Find & preview" },
	{ keys: "?", label: "help", group: "Find & preview" },
	{ keys: "ctrl+p", label: "preview", group: "Find & preview" },
	{ keys: "ctrl+s", label: "save & install", group: "Actions" },
	{ keys: "q", label: "quit", group: "Actions" },
];
