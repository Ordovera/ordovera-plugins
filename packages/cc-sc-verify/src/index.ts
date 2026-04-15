export { verifyPlugins } from "./verifier.js";
export { formatTerminal } from "./formatter.js";
export {
  readInstalledPlugins,
  readKnownMarketplaces,
  resolveRepo,
  parsePluginKey,
} from "./reader.js";
export { checkRepoStatus, getRemotePluginState } from "./github.js";
export {
  buildLocalPermissionSurface,
  detectEscalations,
} from "./permissions.js";
export { hashLocalFiles, hashRemoteFiles, compareHashes } from "./integrity.js";
export { scanPluginDeps } from "./deps.js";
export type {
  VerificationReport,
  PluginReport,
  RepoStatus,
  RemotePluginState,
  PermissionEscalationSummary,
  IntegritySummary,
  DepScanSummary,
  InstalledPluginsFile,
  KnownMarketplacesFile,
  PluginInstall,
} from "./types.js";
