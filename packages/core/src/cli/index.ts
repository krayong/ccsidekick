// classify.ts
export { runClassify } from "./classify";

// gc.ts
export { runGc } from "./gc";

// render.ts
export { runRender } from "./render";
export type { RenderOverrides } from "./render";

// settings.ts
export { installSettings, safeWriteJson, writeConfigToml } from "./settings";

// setup.ts
export {
	applySetup,
	defaultHomeDir,
	defaultReadConfig,
	listValues,
	parseSetup,
	runList,
	runSetup,
	setupHelp,
	themeNames,
	type Parsed,
	type SetupDeps,
} from "./setup";

// uninstall.ts
export { isOurStatusLine, runUninstall } from "./uninstall";
