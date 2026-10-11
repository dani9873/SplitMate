import {
  Bed,
  Car,
  HeartPulse,
  PartyPopper,
  Plug,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * Íconos de las categorías por su nombre guardado. Un mapa fijo en lugar de importar todo
 * Lucide: solo entran al bundle estos íconos.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  car: Car,
  bed: Bed,
  'party-popper': PartyPopper,
  'shopping-bag': ShoppingBag,
  plug: Plug,
  'heart-pulse': HeartPulse,
  tag: Tag,
};

export function categoryIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Tag;
}
