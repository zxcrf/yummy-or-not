// Expo Metro config, monorepo-aware so the bundler resolves the workspace
// `@yon/shared` package and the hoisted root node_modules.
// Tamagui v2 needs no special Metro setup for a runtime (non-extracted) build;
// the babel plugin handles config loading.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so changes in packages/shared trigger rebuilds.
config.watchFolders = [workspaceRoot]
// Resolve modules from the app first, then the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
