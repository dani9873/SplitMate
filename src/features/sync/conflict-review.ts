import type { ConflictDraft, Repositories, UpdateGroupInput } from '@/db/repositories';

/**
 * Qué se le ofrece al usuario por cada borrador por revisar y qué hace cada elección. Sin React:
 * la hoja solo dibuja esto y llama a `applyMine`, `deleteNow` o `repos.conflicts.discard`.
 *
 * Regla de fondo: el servidor ya se aplicó en este teléfono, así que "la del servidor" es lo que
 * se ve y descartar nunca toca los movimientos. Un borrador solo desaparece con una elección del
 * usuario: guardar el formulario, `applyMine`, `deleteNow` o descartar.
 */

export type DiffField = 'name' | 'emoji' | 'color' | 'currency' | 'archived';

export interface FieldDiff {
  readonly field: DiffField;
  /** Tu valor. `archived` va como `'true'` o `'false'`; un emoji ausente, como `''`. */
  readonly mine: string;
  readonly current: string;
}

export type ConflictKind =
  /** Un gasto, ingreso o transferencia: se revisa en el formulario. */
  | 'movement'
  /** Un borrado que no se aplicó. */
  | 'deletion'
  /** Un grupo, miembro o categoría: se comparan los campos. */
  | 'fields';

export interface ConflictItem {
  readonly draft: ConflictDraft;
  readonly kind: ConflictKind;
  /** Título del movimiento, nombre del grupo o del miembro. Puede estar vacío. */
  readonly label: string;
  /** Formulario con la versión del usuario (solo `movement`). */
  readonly route: string | null;
  /** Lo que sigue existiendo y se puede borrar (solo `deletion`). */
  readonly canDeleteNow: boolean;
  /** Los campos que difieren y se pueden aplicar sobre la versión actual (solo `fields`). */
  readonly canUseMine: boolean;
  readonly diffs: readonly FieldDiff[];
}

const APPLICABLE: ReadonlySet<DiffField> = new Set(['name', 'emoji', 'color']);

const text = (data: ConflictDraft['data'], key: string): string | null => {
  const value = data[key];
  return typeof value === 'string' ? value : null;
};

function diff(field: DiffField, mine: string | null, current: string): FieldDiff[] {
  return mine !== null && mine !== current ? [{ field, mine, current }] : [];
}

function transferLabel(repos: Repositories, draft: ConflictDraft): string {
  const names = new Map(repos.members.listAll(draft.groupId).map((m) => [m.id, m.displayName]));
  const from = text(draft.data, 'from_member_id');
  const to = text(draft.data, 'to_member_id');
  return `${(from && names.get(from)) ?? ''} → ${(to && names.get(to)) ?? ''}`;
}

function currentMember(repos: Repositories, draft: ConflictDraft) {
  return repos.members
    .listAll(draft.groupId)
    .find((m) => m.id === draft.entityId && m.deletedAt === null);
}

/** Lo que existe hoy de la entidad del borrador, si sigue activa. */
function exists(repos: Repositories, draft: ConflictDraft): boolean {
  switch (draft.entity) {
    case 'expense':
      return repos.expenses.get(draft.entityId) !== undefined;
    case 'transfer':
      return repos.transfers.get(draft.entityId) !== undefined;
    case 'group':
      return repos.groups.get(draft.entityId) !== undefined;
    case 'member':
      return currentMember(repos, draft) !== undefined;
    case 'category':
      return false;
  }
}

function fieldDiffs(repos: Repositories, draft: ConflictDraft): FieldDiff[] {
  if (draft.entity === 'group') {
    const group = repos.groups.get(draft.entityId);
    if (!group) {
      return [];
    }
    const emoji = draft.data.emoji;
    return [
      ...diff('name', text(draft.data, 'name'), group.name),
      ...diff('emoji', emoji === null ? '' : text(draft.data, 'emoji'), group.emoji ?? ''),
      ...diff('color', text(draft.data, 'color'), group.color),
      ...diff('currency', text(draft.data, 'currency'), group.currency),
      ...(typeof draft.data.archived === 'boolean' &&
      draft.data.archived !== (group.archivedAt !== null)
        ? [
            {
              field: 'archived' as const,
              mine: String(draft.data.archived),
              current: String(group.archivedAt !== null),
            },
          ]
        : []),
    ];
  }
  if (draft.entity === 'member') {
    const member = currentMember(repos, draft);
    return member ? diff('name', text(draft.data, 'display_name'), member.displayName) : [];
  }
  return [];
}

function labelOf(repos: Repositories, draft: ConflictDraft): string {
  switch (draft.entity) {
    case 'transfer':
      return transferLabel(repos, draft);
    case 'expense':
      return text(draft.data, 'title') ?? '';
    // El grupo y el miembro se nombran como los conoce el usuario hoy; si ya no existen, por su borrador.
    case 'member':
      return currentMember(repos, draft)?.displayName ?? text(draft.data, 'display_name') ?? '';
    case 'group':
      return repos.groups.get(draft.entityId)?.name ?? text(draft.data, 'name') ?? '';
    case 'category':
      return text(draft.data, 'name') ?? '';
  }
}

export function readConflictItem(repos: Repositories, draft: ConflictDraft): ConflictItem {
  const label = labelOf(repos, draft);
  const movement = draft.entity === 'expense' || draft.entity === 'transfer';
  const present = exists(repos, draft);

  if (draft.wasDeletion) {
    return {
      draft,
      kind: 'deletion',
      label,
      route: null,
      // Un miembro con cuenta y acceso no se borra: el servidor lo rechazó por eso.
      canDeleteNow: present && draft.reason !== 'member_linked',
      canUseMine: false,
      diffs: [],
    };
  }
  if (movement) {
    const base = `/groups/${draft.groupId}/entries`;
    return {
      draft,
      kind: 'movement',
      label,
      // Si sigue activo se guarda sobre la versión actual; si no, es un movimiento nuevo.
      route: present
        ? `${base}/${draft.entityId}/edit?fromConflict=${draft.id}`
        : `${base}/new?fromConflict=${draft.id}`,
      canDeleteNow: false,
      canUseMine: false,
      diffs: [],
    };
  }
  const diffs = fieldDiffs(repos, draft);
  const group = draft.entity === 'group' ? repos.groups.get(draft.entityId) : undefined;
  const archived = group !== undefined && group.archivedAt !== null;
  return {
    draft,
    kind: 'fields',
    label,
    route: null,
    canDeleteNow: false,
    canUseMine:
      present && !archived && diffs.length > 0 && diffs.every((d) => APPLICABLE.has(d.field)),
    diffs,
  };
}

/**
 * "Usar la mía" en un grupo o un miembro: pone tus valores sobre la versión actual y descarta el
 * borrador. Los campos que no difieren quedan como están. Si falla, el borrador sigue.
 */
export function applyMine(repos: Repositories, item: ConflictItem): void {
  const { draft } = item;
  const mine = (field: DiffField) => item.diffs.find((d) => d.field === field)?.mine;
  repos.changes.batch(() => {
    if (draft.entity === 'group') {
      const group = repos.groups.get(draft.entityId);
      if (!group) {
        return;
      }
      repos.groups.update(group.id, group.version, {
        name: mine('name') ?? group.name,
        currency: group.currency,
        emoji: (mine('emoji') ?? group.emoji ?? '') || null,
        color: (mine('color') ?? group.color) as UpdateGroupInput['color'],
      });
    } else if (draft.entity === 'member') {
      const member = currentMember(repos, draft);
      const name = mine('name');
      if (!member || name === undefined) {
        return;
      }
      repos.members.rename(member.id, member.version, name);
    } else {
      return;
    }
    repos.conflicts.discard(draft.id);
  });
}

/**
 * "Borrar ahora": el borrado que no se aplicó, sobre la versión actual. Si falla (por ejemplo, un
 * miembro con saldo), lanza y el borrador sigue.
 */
export function deleteNow(repos: Repositories, item: ConflictItem): void {
  const { draft } = item;
  if (!item.canDeleteNow) {
    return;
  }
  repos.changes.batch(() => {
    switch (draft.entity) {
      case 'expense': {
        const current = repos.expenses.get(draft.entityId);
        if (current) {
          repos.expenses.remove(current.id, current.version);
        }
        break;
      }
      case 'transfer': {
        const current = repos.transfers.get(draft.entityId);
        if (current) {
          repos.transfers.remove(current.id, current.version);
        }
        break;
      }
      case 'member': {
        const current = currentMember(repos, draft);
        if (current) {
          repos.members.remove(current.id, current.version);
        }
        break;
      }
      case 'group': {
        const current = repos.groups.get(draft.entityId);
        if (current) {
          repos.groups.remove(current.id, current.version);
        }
        break;
      }
      case 'category':
        return;
    }
    repos.conflicts.discard(draft.id);
  });
}

/** La clave de `sync.review.reason.*` que cuenta por qué quedó el borrador. */
export function reasonKey(
  draft: ConflictDraft,
):
  | 'conflict'
  | 'serverDeleted'
  | 'deletionRejected'
  | 'groupCurrencyChanged'
  | 'currencyLocked'
  | 'memberLinked'
  | 'quotaGroups'
  | 'quotaMembers'
  | 'quotaCategories'
  | 'quotaMovements' {
  if (draft.reason === 'member_linked') {
    return 'memberLinked';
  }
  if (draft.reason === 'quota') {
    const quota = draft.quota ?? 'movements';
    return `quota${quota.charAt(0).toUpperCase()}${quota.slice(1)}` as
      'quotaGroups' | 'quotaMembers' | 'quotaCategories' | 'quotaMovements';
  }
  if (draft.reason === 'currency_locked') {
    return 'currencyLocked';
  }
  if (draft.reason === 'group_currency_changed') {
    return 'groupCurrencyChanged';
  }
  if (draft.serverDeleted) {
    return 'serverDeleted';
  }
  return draft.wasDeletion ? 'deletionRejected' : 'conflict';
}
