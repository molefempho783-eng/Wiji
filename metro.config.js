// Learn more https://docs.expo.io/guides/customizing-metro
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Override native-only modules for web platform
// And web-only modules for native platform
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Metro + package "exports" can fail on relative requires like `./utils.js` inside
  // `@noble/hashes/hmac.js` when nested under `node_modules/@noble/curves/`.
  if (
    (moduleName === './utils.js' || moduleName === './utils') &&
    context.originModulePath
  ) {
    const origin = context.originModulePath.replace(/\\/g, '/');
    if (origin.includes('@noble/hashes/') && origin.endsWith('hmac.js')) {
      const dir = path.dirname(context.originModulePath);
      const candidate = path.join(dir, 'utils.js');
      if (fs.existsSync(candidate)) {
        return { type: 'sourceFile', filePath: candidate };
      }
    }
  }

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
