# Pruebas E2E con Maestro

`flujo-grupo-liquidar.yaml` recorre la app como una persona:

1. Crea un grupo con tres personas.
2. Registra cuatro gastos, uno por cada forma de dividir: igual, montos, porcentajes y partes.
3. Revisa los saldos.
4. Marca como pagadas las transferencias sugeridas.
5. Comprueba que todos quedan al día.

Es el mismo recorrido que la prueba de Jest `src/features/__tests__/flujo-grupo.test.tsx`, pero sobre la app real.

El flujo busca los elementos por id de prueba (`testID`) y no por texto, así que funciona con el teléfono en español o en inglés.

> **Borra los datos de SplitMate.** El flujo empieza con `clearState`, que elimina la base local cifrada y su clave. Úsalo en el emulador o en un teléfono donde la app no tenga datos que quieras conservar.

## Requisitos

- Java 17 o superior: `java -version`.
- Maestro CLI:
  - En Windows: descarga `maestro.zip` de la [última versión](https://github.com/mobile-dev-inc/maestro/releases/latest), descomprímelo en `%USERPROFILE%\.maestro` (quedan las carpetas `bin` y `lib`) y agrega `%USERPROFILE%\.maestro\bin` al `PATH`.
  - En macOS o Linux: `curl -fsSL "https://get.maestro.mobile.dev" | bash`.
  - Comprueba la instalación con `maestro --version`.
- El development build de SplitMate (EAS) instalado en el dispositivo.
- Metro corriendo en la carpeta del proyecto: `npx expo start --dev-client`. Usa el puerto 8081.

## En el emulador

```bash
adb devices                                  # debe aparecer emulator-5554
adb -s emulator-5554 reverse tcp:8081 tcp:8081
maestro --device emulator-5554 test .maestro/flujo-grupo-liquidar.yaml
```

## En tu teléfono Android

1. Activa la depuración USB en Opciones de desarrollador y conecta el teléfono por cable.
2. Ejecuta:

```bash
adb devices                                  # copia el número de serie del teléfono
adb -s <serie> reverse tcp:8081 tcp:8081
maestro --device <serie> test .maestro/flujo-grupo-liquidar.yaml
```

Con `adb reverse`, el teléfono llega a Metro en `127.0.0.1:8081` por el cable: no hace falta que esté en la misma red Wi-Fi.

## Otro puerto de Metro

Si Metro corre en otro puerto, por ejemplo el 8083, haz el `reverse` de ese puerto y pásale la dirección al flujo, codificada para URL:

```bash
adb -s emulator-5554 reverse tcp:8083 tcp:8083
maestro --device emulator-5554 test -e METRO_URL=http%3A%2F%2F127.0.0.1%3A8083 .maestro/flujo-grupo-liquidar.yaml
```

## Qué esperar

- La salida termina sin errores y el comando devuelve 0. En un emulador sin aceleración por hardware tarda unos 5 minutos, casi todo en cargar el bundle.
- Si un paso falla, Maestro guarda la captura y la jerarquía de la pantalla en `~/.maestro/tests/<fecha>/`.
- El enlace que abre la app lleva `disableAutoLaunch=1` y `disableFab=1`. Así el menú del cliente de desarrollo no se abre solo ni tapa elementos de la app.
