import { act, render, screen, userEvent } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';

import { createIdGenerator } from '@/lib/ids';

import { DatabaseGate, useDatabase, useDatabaseSetup } from '../DatabaseProvider';
import { createRepositories, type AppDatabase, type Repositories } from '../repositories';
import { createTestDatabase, createTestGroup, type TestRepositories } from '../test-utils';
import { useLiveQuery, type LiveQueryScope } from '../use-live-query';

let time = 1_760_000_000_000;
const deps = {
  now: () => (time += 1),
  newId: createIdGenerator({ now: () => time, randomBytes: (n) => new Uint8Array(n).fill(3) }),
};

/** Repositorios de la app montada: comparten el bus de cambios con `useLiveQuery`. */
let appRepos: Repositories;

function Probe({ read, scope }: { read: (r: Repositories) => string; scope: LiveQueryScope }) {
  const query = useLiveQuery(read, scope);
  if (query.status === 'loading') {
    return <Text>cargando</Text>;
  }
  if (query.status === 'error') {
    return (
      <Pressable accessibilityRole="button" onPress={query.retry}>
        <Text>reintentar</Text>
      </Pressable>
    );
  }
  return <Text>{query.data}</Text>;
}

function CaptureRepos() {
  const { repos } = useDatabase();
  useEffect(() => {
    appRepos = repos;
  }, [repos]);
  return null;
}

function Harness(props: {
  db: AppDatabase;
  read: (r: Repositories) => string;
  scope: LiveQueryScope;
}) {
  // `open` estable: una función nueva en cada render volvería a abrir la base sin fin.
  const [open] = useState(() => async () => props.db);
  const database = useDatabaseSetup(open, deps);
  return (
    <DatabaseGate database={database}>
      <CaptureRepos />
      <Probe read={props.read} scope={props.scope} />
    </DatabaseGate>
  );
}

/** Crea datos antes de montar, con repositorios propios que no avisan a la app. */
const seedGroup = (db: AppDatabase) =>
  createTestGroup({ repos: createRepositories(db, deps) } as unknown as TestRepositories);

const appContext = () => ({ repos: appRepos }) as unknown as TestRepositories;

describe('useLiveQuery', () => {
  it('muestra la carga, lee y vuelve a leer cuando cambia una tabla de su alcance', async () => {
    const { db } = await createTestDatabase();
    await render(
      <Harness
        db={db}
        read={(r) => `grupos: ${r.groups.list().length}`}
        scope={{ tables: ['groups'] }}
      />,
    );
    expect(await screen.findByText('grupos: 0')).toBeOnTheScreen();

    await act(() => {
      createTestGroup(appContext());
    });
    expect(screen.getByText('grupos: 1')).toBeOnTheScreen();
  });

  it('no vuelve a leer por cambios de otro grupo ni de otras tablas', async () => {
    const { db } = await createTestDatabase();
    const { group } = seedGroup(db);
    const read = jest.fn(
      (r: Repositories) => `miembros: ${r.members.listByGroup(group.id).length}`,
    );
    await render(
      <Harness db={db} read={read} scope={{ tables: ['group_members'], groupId: group.id }} />,
    );
    await screen.findByText('miembros: 3');
    const reads = read.mock.calls.length;

    await act(() => {
      const other = createTestGroup(appContext());
      appRepos.members.add(other.group.id, 'Eva');
      appRepos.groups.update(group.id, 1, { ...group, name: 'Otro nombre' });
    });
    expect(read).toHaveBeenCalledTimes(reads);

    await act(() => {
      appRepos.members.add(group.id, 'Dani');
    });
    expect(read).toHaveBeenCalledTimes(reads + 1);
    expect(screen.getByText('miembros: 4')).toBeOnTheScreen();
  });

  it('muestra el error y reintenta', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { db } = await createTestDatabase();
    let fail = true;
    const read = () => {
      if (fail) {
        throw new Error('lectura rota');
      }
      return 'listo';
    };
    await render(<Harness db={db} read={read} scope={{ tables: ['groups'] }} />);

    const retry = await screen.findByRole('button', { name: 'reintentar' });
    fail = false;
    await user.press(retry);
    expect(await screen.findByText('listo')).toBeOnTheScreen();
    jest.restoreAllMocks();
  });
});
