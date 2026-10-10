import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ChevronDown, SearchX, Tag, User, X } from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { ActivityItem } from '@/db/repositories';
import { useFormatters } from '@/i18n';
import { relativeDay, today } from '@/lib/calendar-date';
import { Chip, cn, EmptyState, SearchField, Sheet, Text, useAppTheme } from '@/ui';

import { CategoryIcon, useCategories } from '../categories';
import {
  filterActivity,
  groupByDay,
  hasFilters,
  NO_FILTERS,
  type ActivityFilters,
} from './activity-list';
import { ActivityRow } from './ActivityRow';

export interface FeedMember {
  readonly id: string;
  readonly label: string;
}

export interface ActivityFeedProps {
  items: readonly ActivityItem[];
  /** "Yo" en cada grupo, para mostrar tu parte. */
  meByGroup: ReadonlyMap<string, string>;
  /** Miembros para filtrar; sin ellos no hay filtro por miembro (pestaña global). */
  members?: readonly FeedMember[];
  showGroup: boolean;
  /** Estado vacío cuando no hay ningún movimiento todavía. */
  empty: ReactElement;
  /** Espacio al final para que el botón flotante no tape la última fila. */
  bottomInset?: number;
}

/** Historial con búsqueda, filtros y encabezados fijos por día. */
export function ActivityFeed({
  items,
  meByGroup,
  members,
  showGroup,
  empty,
  bottomInset = 24,
}: ActivityFeedProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { day } = useFormatters();
  const categories = useCategories();
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [picking, setPicking] = useState<'category' | 'member' | null>(null);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryLabel = useCallback(
    (id: string) => categoryById.get(id)?.label ?? '',
    [categoryById],
  );
  const now = today();

  const filtered = useMemo(
    () => filterActivity(items, filters, categoryLabel),
    [items, filters, categoryLabel],
  );
  const { rows, stickyHeaderIndices } = useMemo(() => groupByDay(filtered), [filtered]);
  const openItem = useCallback(
    (item: ActivityItem) => router.push(`/groups/${item.groupId}/entries/${item.id}`),
    [router],
  );

  if (items.length === 0) {
    return empty;
  }

  const selectedCategory = filters.categoryId ? categoryById.get(filters.categoryId) : undefined;
  const selectedMember = filters.memberId
    ? members?.find((m) => m.id === filters.memberId)
    : undefined;
  const dayLabel = (date: string) => {
    const relative = relativeDay(date, now);
    return relative === 'today'
      ? t('activity.today')
      : relative === 'yesterday'
        ? t('activity.yesterday')
        : day(date, 'weekday');
  };

  return (
    <View className="flex-1">
      <View className="gap-2 pb-2">
        <SearchField
          testID="activity-search"
          label={t('activity.search')}
          value={filters.query}
          onChangeText={(query) => setFilters((current) => ({ ...current, query }))}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          <Chip
            testID="filter-category"
            label={selectedCategory?.label ?? t('activity.filters.category')}
            accessibilityLabel={t('activity.filters.categoryA11y', {
              value: selectedCategory?.label ?? t('activity.filters.anyCategory'),
            })}
            icon={Tag}
            trailingIcon={ChevronDown}
            selected={selectedCategory !== undefined}
            onPress={() => setPicking('category')}
          />
          {members ? (
            <Chip
              testID="filter-member"
              label={selectedMember?.label ?? t('activity.filters.member')}
              accessibilityLabel={t('activity.filters.memberA11y', {
                value: selectedMember?.label ?? t('activity.filters.anyMember'),
              })}
              icon={User}
              trailingIcon={ChevronDown}
              selected={selectedMember !== undefined}
              onPress={() => setPicking('member')}
            />
          ) : null}
          {hasFilters(filters) ? (
            <Chip
              testID="clear-filters"
              label={t('activity.filters.clear')}
              icon={X}
              onPress={() => setFilters(NO_FILTERS)}
            />
          ) : null}
        </ScrollView>
      </View>

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('activity.noResults.title')}
          description={t('activity.noResults.description')}
          action={{ label: t('activity.noResults.action'), onPress: () => setFilters(NO_FILTERS) }}
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.type}
          stickyHeaderIndices={stickyHeaderIndices}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomInset }}
          renderItem={({ item: row }) =>
            row.type === 'day' ? (
              <View className="bg-background pb-1 pt-3">
                <Text
                  variant="caption"
                  tone="muted"
                  accessibilityRole="header"
                  className="uppercase"
                >
                  {dayLabel(row.date)}
                </Text>
              </View>
            ) : (
              <ActivityRow
                item={row.item}
                meId={meByGroup.get(row.item.groupId) ?? null}
                categoryIcon={
                  row.item.kind === 'transfer' || !row.item.categoryId
                    ? null
                    : (categoryById.get(row.item.categoryId)?.icon ?? null)
                }
                showGroup={showGroup}
                onOpen={openItem}
              />
            )
          }
        />
      )}

      <FilterSheet
        visible={picking === 'category'}
        title={t('activity.filters.category')}
        anyLabel={t('activity.filters.anyCategory')}
        options={categories.map((c) => ({ id: c.id, label: c.label, icon: c.icon }))}
        value={filters.categoryId}
        onChange={(categoryId) => setFilters((current) => ({ ...current, categoryId }))}
        onClose={() => setPicking(null)}
      />
      {members ? (
        <FilterSheet
          visible={picking === 'member'}
          title={t('activity.filters.member')}
          anyLabel={t('activity.filters.anyMember')}
          options={members.map((m) => ({ id: m.id, label: m.label, icon: null }))}
          value={filters.memberId}
          onChange={(memberId) => setFilters((current) => ({ ...current, memberId }))}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </View>
  );
}

interface FilterOption {
  readonly id: string;
  readonly label: string;
  readonly icon: string | null;
}

function FilterSheet({
  visible,
  title,
  anyLabel,
  options,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  anyLabel: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const all: (FilterOption | { id: null; label: string; icon: null })[] = [
    { id: null, label: anyLabel, icon: null },
    ...options,
  ];
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView accessibilityRole="radiogroup" contentContainerClassName="pb-2">
        {all.map((option) => {
          const checked = option.id === value;
          return (
            <Pressable
              key={option.id ?? 'any'}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked }}
              onPress={() => {
                onChange(option.id);
                onClose();
              }}
              className={cn(
                'min-h-[52px] flex-row items-center gap-3 px-5',
                checked ? 'bg-primary-soft' : 'active:bg-surface-muted',
              )}
            >
              {option.icon ? (
                <CategoryIcon name={option.icon} size={20} color={colors.fgMuted} />
              ) : null}
              <Text className="flex-1" tone={checked ? 'primary' : 'default'}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
