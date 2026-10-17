import { act, screen, userEvent } from '@testing-library/react-native';

import { recordConflict } from '@/db/sync/conflicts';
import { createTestGroup, createTestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { UndoProvider } from '../../undo';

import { GroupDetailScreen } from '../GroupDetailScreen';

const mockParams: { groupId?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

const DRAFT = '01990000-0000-7000-8000-0000000000c1';

describe('detalle del grupo: cambios por revisar', () => {
  beforeEach(async () => {
    await act(() => changeLanguage('es'));
  });

  afterEach(async () => {
    await act(() => changeLanguage('en'));
  });

  it('sin borradores no hay banner', async () => {
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    mockParams.groupId = group.id;

    await renderWithDatabase(
      <UndoProvider>
        <GroupDetailScreen />
      </UndoProvider>,
      ctx,
    );

    expect(await screen.findByTestId('group-detail-screen')).toBeOnTheScreen();
    await screen.findByText('Viaje');
    expect(screen.queryByTestId('conflict-banner')).not.toBeOnTheScreen();
  });

  it('con un borrador muestra el banner y "Revisar" abre la lista', async () => {
    const user = userEvent.setup();
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    mockParams.groupId = group.id;
    recordConflict(ctx.db, {
      id: DRAFT,
      entity: 'group',
      entityId: group.id,
      groupId: group.id,
      reason: 'conflict',
      data: {
        name: 'Playa',
        currency: group.currency,
        emoji: group.emoji,
        color: group.color,
        archived: false,
        deleted: false,
      },
      serverDeleted: false,
      wasNew: false,
      wasDeletion: false,
      createdAt: 1,
    });

    await renderWithDatabase(
      <UndoProvider>
        <GroupDetailScreen />
      </UndoProvider>,
      ctx,
    );

    expect(await screen.findByText('1 cambio por revisar')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Revisar' }));
    expect(await screen.findByTestId(`conflict-item-${DRAFT}`)).toBeOnTheScreen();
  });
});
