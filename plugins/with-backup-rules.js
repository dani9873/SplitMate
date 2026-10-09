// Reglas de respaldo de Android para SplitMate.
//
// `android.allowBackup` está en `false`, así que hoy no se respalda nada. Estas reglas son
// defensa en profundidad: si algún día se activa el respaldo, la base local (con su WAL y su
// SHM) y la clave del almacén seguro siguen fuera. La clave no viaja con el respaldo, de modo
// que una base restaurada sería ilegible.
const fs = require('node:fs');
const path = require('node:path');

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const EXCLUSIONS = `    <exclude domain="file" path="SQLite/" />
    <exclude domain="sharedpref" path="SecureStore" />`;

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 o anterior. Generado por plugins/with-backup-rules.js -->
<full-backup-content>
${EXCLUSIONS.replace(/^ {4}/gm, '  ')}
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 o posterior. Generado por plugins/with-backup-rules.js -->
<data-extraction-rules>
  <cloud-backup>
${EXCLUSIONS}
  </cloud-backup>
  <device-transfer>
${EXCLUSIONS}
  </device-transfer>
</data-extraction-rules>
`;

function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const xmlDir = path.join(modConfig.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'splitmate_backup_rules.xml'), FULL_BACKUP_CONTENT);
      fs.writeFileSync(
        path.join(xmlDir, 'splitmate_data_extraction_rules.xml'),
        DATA_EXTRACTION_RULES,
      );
      return modConfig;
    },
  ]);
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/splitmate_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/splitmate_data_extraction_rules';
    return modConfig;
  });
}

module.exports = withBackupRules;
