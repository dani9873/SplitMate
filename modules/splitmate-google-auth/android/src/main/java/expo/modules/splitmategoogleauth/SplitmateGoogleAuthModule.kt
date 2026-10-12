package expo.modules.splitmategoogleauth

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * "Continuar con Google" con Credential Manager (el flujo del botón, `GetSignInWithGoogleOption`).
 * Devuelve el ID token de Google; la app lo canjea en Supabase. Google recibe el hash del nonce y
 * Supabase el original: un ID token robado no sirve para otra sesión.
 *
 * Errores para la app: `CANCELED` (cerró la hoja), `NO_ACCOUNT` (sin cuentas de Google) y
 * `FAILED` (todo lo demás).
 */
class SplitmateGoogleAuthModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SplitmateGoogleAuth")

    AsyncFunction("signIn") Coroutine { webClientId: String, hashedNonce: String ->
      val activity = appContext.currentActivity
        ?: throw CodedException("FAILED", "No hay una pantalla activa", null)
      val option = GetSignInWithGoogleOption.Builder(webClientId)
        .setNonce(hashedNonce)
        .build()
      val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()

      val credential = try {
        CredentialManager.create(activity).getCredential(activity, request).credential
      } catch (e: GetCredentialCancellationException) {
        throw CodedException("CANCELED", "Se cerró la hoja de Google", e)
      } catch (e: NoCredentialException) {
        throw CodedException("NO_ACCOUNT", "No hay cuentas de Google en el teléfono", e)
      } catch (e: GetCredentialException) {
        throw CodedException("FAILED", e.type, e)
      }

      if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
      ) {
        throw CodedException("FAILED", "Google devolvió otro tipo de credencial", null)
      }
      val google = try {
        GoogleIdTokenCredential.createFrom(credential.data)
      } catch (e: GoogleIdTokenParsingException) {
        throw CodedException("FAILED", "No se pudo leer el token de Google", e)
      }
      mapOf("idToken" to google.idToken, "displayName" to google.displayName)
    }
  }
}
