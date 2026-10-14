const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Migraciones de Drizzle en SQL, cada una como módulo propio: su caché depende de su contenido.
config.resolver.sourceExts.push('sql');
config.transformer.babelTransformerPath = require.resolve('./scripts/metro-sql-transformer');

module.exports = withNativeWind(config, { input: './src/ui/global.css' });
