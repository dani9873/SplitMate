import ExpoModulesCore
import Foundation

/// Excluye archivos o carpetas del respaldo de iOS (iCloud y copias del equipo).
///
/// SplitMate lo usa con la carpeta de la base local: la clave de SQLCipher no viaja con el
/// respaldo, así que una base restaurada sería ilegible.
public class SplitmateBackupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SplitmateBackup")

    Function("excludeFromBackup") { (path: String) throws -> Bool in
      var url = URL(fileURLWithPath: path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return true
    }
  }
}
