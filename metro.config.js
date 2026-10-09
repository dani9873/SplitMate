const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Migraciones de Drizzle en SQL.
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './src/ui/global.css' });
