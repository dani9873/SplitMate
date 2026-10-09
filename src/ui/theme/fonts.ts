import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

import { fontFamily } from './tokens';

/** Archivos que se cargan antes de ocultar el splash. Las claves son los nombres de familia. */
export const fontAssets = {
  [fontFamily.regular]: Manrope_400Regular,
  [fontFamily.medium]: Manrope_500Medium,
  [fontFamily.semibold]: Manrope_600SemiBold,
  [fontFamily.bold]: Manrope_700Bold,
  [fontFamily.extrabold]: Manrope_800ExtraBold,
};
