import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Category } from '@/db/repositories';
import { useLiveQuery } from '@/db/use-live-query';

export interface CategoryOption {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

const KEYS = [
  'food',
  'groceries',
  'transport',
  'lodging',
  'entertainment',
  'shopping',
  'utilities',
  'health',
  'other',
] as const;
type CategoryKey = (typeof KEYS)[number];

const isKnownKey = (key: string | null): key is CategoryKey =>
  key !== null && (KEYS as readonly string[]).includes(key);

/** Nombre visible de una categoría: la traducción de las predefinidas o el nombre propio. */
export function useCategoryLabel(): (category: Pick<Category, 'key' | 'name'>) => string {
  const { t } = useTranslation();
  return useCallback(
    (category) =>
      isKnownKey(category.key) ? t(`categories.${category.key}`) : (category.name ?? ''),
    [t],
  );
}

/** Categorías disponibles con su nombre en el idioma activo. */
export function useCategories(): readonly CategoryOption[] {
  const label = useCategoryLabel();
  const query = useLiveQuery((repos) => repos.categories.list(), { tables: ['categories'] });
  const data = query.status === 'ready' ? query.data : null;
  return useMemo(
    () => (data ?? []).map((c) => ({ id: c.id, label: label(c), icon: c.icon })),
    [data, label],
  );
}
