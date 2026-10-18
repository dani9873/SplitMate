// Enlaces de invitación verificados (App Links) de Android para SplitMate.
//
// Agrega a la actividad principal un `intent-filter` con `autoVerify` para `https://<dominio>/i`,
// donde `<dominio>` sale de la variable de entorno pública `EXPO_PUBLIC_INVITE_HOST` al compilar
// (en EAS, de las variables del build). Sin dominio válido no agrega nada y avisa: la app compila y
// las invitaciones circulan con el esquema propio (`splitmate://i#<token>`).
//
// Para que Android verifique el dominio, `https://<dominio>/.well-known/assetlinks.json` debe traer el
// paquete y las huellas SHA-256 de la firma (web/links/.well-known/assetlinks.json).

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const VIEW = 'android.intent.action.VIEW';

/** El dominio configurado, en minúsculas, o `null` si falta o no es un dominio. */
function readInviteHost(env = process.env) {
  const host = (env.EXPO_PUBLIC_INVITE_HOST || '').trim().toLowerCase();
  return HOSTNAME.test(host) ? host : null;
}

/** El `intent-filter` de un enlace de invitación, en el formato del manifiesto de Expo. */
function inviteIntentFilter(host) {
  return {
    $: { 'android:autoVerify': 'true' },
    action: [{ $: { 'android:name': VIEW } }],
    category: [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ],
    // Ruta exacta `/i`: ni `/invitaciones` ni nada colgado de ella.
    data: [{ $: { 'android:scheme': 'https', 'android:host': host, 'android:path': '/i' } }],
  };
}

const isInviteFilter = (filter) =>
  (filter.data || []).some((data) => data.$ && data.$['android:path'] === '/i');

/**
 * Pone el filtro de invitación en la actividad principal del manifiesto. Repetirlo no lo duplica,
 * y un dominio nuevo reemplaza al anterior. Devuelve el mismo manifiesto.
 */
function applyInviteFilter(manifest, host) {
  const application = manifest.manifest.application && manifest.manifest.application[0];
  const activities = (application && application.activity) || [];
  const main = activities.find((activity) => /MainActivity$/.test(activity.$['android:name']));
  if (!main) {
    throw new Error('No se encontró MainActivity en el manifiesto de Android');
  }
  const others = (main['intent-filter'] || []).filter((filter) => !isInviteFilter(filter));
  main['intent-filter'] = [...others, inviteIntentFilter(host)];
  return manifest;
}

function withInviteLinks(config) {
  const host = readInviteHost();
  if (!host) {
    console.warn(
      '[with-invite-links] EXPO_PUBLIC_INVITE_HOST no está definido o no es un dominio: ' +
        'no se agrega el App Link de invitaciones.',
    );
    return config;
  }
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (modConfig) => {
    applyInviteFilter(modConfig.modResults, host);
    return modConfig;
  });
}

module.exports = withInviteLinks;
module.exports.readInviteHost = readInviteHost;
module.exports.inviteIntentFilter = inviteIntentFilter;
module.exports.applyInviteFilter = applyInviteFilter;
