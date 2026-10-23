// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Don't crawl or watch folders that aren't part of the app: the Cloud Functions project
// (its own node_modules changes during `npm install` and crashed Metro), the admin website,
// and native build output. Paths are anchored to this project so node_modules/firebase/functions
// etc. are NOT affected.
const escapeForRegex = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\|\//g, '[\\\\/]');
const ignoreDirs = ['functions', 'admin-web', path.join('android', 'app', 'build'), path.join('android', '.gradle')];
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList || []),
  ...ignoreDirs.map((d) => new RegExp('^' + escapeForRegex(path.resolve(__dirname, d)) + '([\\\\/].*)?$')),
];

// Override native-only modules for web platform
// And web-only modules for native platform
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Web stubs for native-only modules
  if (platform === 'web') {
    if (moduleName === 'react-native-image-viewing') {
      return {
        filePath: path.resolve(__dirname, 'web-stubs/index.web.tsx'),
        type: 'sourceFile',
      };
    }
    if (moduleName === 'react-native-pager-view') {
      return {
        filePath: path.resolve(__dirname, 'web-stubs/react-native-pager-view.web.tsx'),
        type: 'sourceFile',
      };
    }
    if (moduleName === 'react-native-maps') {
      return {
        filePath: path.resolve(__dirname, 'web-stubs/react-native-maps.web.tsx'),
        type: 'sourceFile',
      };
    }
  }
  
  // Native stubs for web-only modules (add back if needed)
  
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
