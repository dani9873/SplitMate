import {
  ArrowLeftRight,
  Bed,
  Car,
  HeartPulse,
  PartyPopper,
  Plug,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Utensils,
} from 'lucide-react-native';

export interface CategoryIconProps {
  /** Nombre guardado del ícono; `transfer` para las transferencias. */
  name: string | null | undefined;
  size: number;
  color: string;
}

/** Ícono de una categoría, o de transferencia. Decorativo: el texto de al lado lo nombra. */
export function CategoryIcon({ name, size, color }: CategoryIconProps) {
  const props = { size, color, strokeWidth: 2 };
  switch (name) {
    case 'transfer':
      return <ArrowLeftRight {...props} />;
    case 'utensils':
      return <Utensils {...props} />;
    case 'shopping-cart':
      return <ShoppingCart {...props} />;
    case 'car':
      return <Car {...props} />;
    case 'bed':
      return <Bed {...props} />;
    case 'party-popper':
      return <PartyPopper {...props} />;
    case 'shopping-bag':
      return <ShoppingBag {...props} />;
    case 'plug':
      return <Plug {...props} />;
    case 'heart-pulse':
      return <HeartPulse {...props} />;
    default:
      return <Tag {...props} />;
  }
}
