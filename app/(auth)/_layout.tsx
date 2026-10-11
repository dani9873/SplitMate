import { Stack } from 'expo-router';

/** Pantallas sin sesión: bienvenida, registro, entrar y recuperar la contraseña. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
