import { GitCompare } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLiveQuery } from '@/db/use-live-query';
import { Banner, Button } from '@/ui';

import { ConflictSheet } from './ConflictSheet';

/**
 * Aviso en el detalle del grupo: "N cambios por revisar". Solo aparece si hay borradores; "Revisar"
 * abre la hoja con la lista. Se actualiza solo cuando llega o se descarta un borrador.
 */
export function ConflictBanner({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const query = useLiveQuery(
    (repos) => repos.conflicts.list(groupId).length,
    { tables: ['sync_conflicts'], groupId },
    [groupId],
  );
  const count = query.status === 'ready' ? query.data : 0;

  // Al resolver el último, la hoja se cierra; si llega otro después, no vuelve a abrirse sola.
  const [seen, setSeen] = useState(count);
  if (count !== seen) {
    setSeen(count);
    if (count === 0) {
      setOpen(false);
    }
  }

  if (count === 0) {
    return null;
  }
  return (
    <>
      <Banner
        testID="conflict-banner"
        icon={GitCompare}
        tone="warning"
        message={t('sync.conflicts', { count })}
        className="mb-4"
        actions={
          <Button
            label={t('sync.review.open')}
            size="sm"
            variant="secondary"
            onPress={() => setOpen(true)}
          />
        }
      />
      <ConflictSheet visible={open} onClose={() => setOpen(false)} groupId={groupId} />
    </>
  );
}
