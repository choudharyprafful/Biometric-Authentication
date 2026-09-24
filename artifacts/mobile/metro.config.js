// Metro bundler configuration.
//
// This project installs with pnpm, which lays out node_modules as a tree of
// symlinks into a content-addressed store rather than a flat directory of
// real folders. Metro's default resolver does not follow that layout: it
// resolves a module's realpath and then cannot match it back to the project
// root, so a dependency that is physically present still fails to resolve.
// The failure looks like a missing package ("Unable to resolve module
// @babel/runtime/helpers/interopRequireDefault") even though the file is
// sitting on disk, which sends you looking for an install problem that
// isn't there.
//
// unstable_enableSymlinks lets the resolver traverse pnpm's symlinks rather
// than resolving through them and losing the project context.
//
// Deliberately NOT pinning resolver.nodeModulesPaths here. That was tried
// and made things worse: an absolute path derived from __dirname resolves to
// the directory's real location, while Metro's project root is whatever path
// the build was launched from. On Windows the Android NDK build overruns the
// 260-character MAX_PATH limit under a long repository path, so builds are
// launched through a short directory junction — at which point a pinned
// absolute nodeModulesPaths sits outside the project root and Metro rejects
// every module found through it. Leaving it unset lets Metro derive the
// search paths from the root it was actually given, which is correct under
// either path.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enableSymlinks = true;

// This package depends on @babel/runtime 8, which publishes every helper
// behind a 94-entry "exports" map rather than as directly-reachable files.
// Metro 0.81 ships with package-exports resolution DISABLED by default, so
// it cannot see through that map: the Babel transform emits
// require("@babel/runtime/helpers/interopRequireDefault"), the file is
// physically on disk, and resolution still fails. Most of the React Native
// ecosystem pins @babel/runtime 7, which exposes helpers directly and never
// hits this — which is why the mismatch went unnoticed until the first
// release bundle was produced.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
