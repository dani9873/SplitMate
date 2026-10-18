import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Alert, Share, type AlertButton } from 'react-native';

import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { renderWithDatabase } from '@/test/render';

import { createFakeInvitationService, type FakeInvitationService } from '../fake-invitations';
import { InvitationError, type InvitationInfo } from '../invitation-service';
import { InviteGroupScreen } from '../InviteGroupScreen';

const mockParams: { groupId?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

const TOKEN = 'm'.repeat(43);
const NEW_TOKEN = 'n'.repeat(43);
const ID_MINE = '01990000-0000-7000-8000-0000000000b1';
const ID_OTHER = '01990000-0000-7000-8000-0000000000b2';
const ID_REVOKED = '01990000-0000-7000-8000-0000000000b3';
const ID_NEW = '01990000-0000-7000-8000-0000000000b4';
const BETO_ACCOUNT = '01990000-0000-7000-8000-0000000000aa';
const OTHER_ACCOUNT = '01990000-0000-7000-8000-0000000000ab';
const NOW = Date.now();
const DAY = 86_400_000;

/** El texto contiene esto (toHaveTextContent con un texto compara el contenido entero). */
const contains = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

let shareSpy: jest.SpyInstance;
let alertSpy: jest.SpyInstance;

beforeEach(async () => {
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  shareSpy.mockRestore();
  alertSpy.mockRestore();
  await act(() => changeLanguage('en'));
});

const info = (over: Partial<InvitationInfo> = {}): InvitationInfo => ({
  id: ID_MINE,
  createdBy: 'me',
  createdAt: NOW - DAY,
  expiresAt: NOW + 6 * DAY,
  maxUses: 10,
  useCount: 2,
  revokedAt: null,
  status: 'active',
  ...over,
});

interface Options {
  role?: 'owner' | 'member';
  lost?: boolean;
  archived?: boolean;
  invitations?: FakeInvitationService;
  ctx?: TestRepositories;
  /** Prepara datos antes de montar la pantalla: (base, id del grupo, id de mi cuenta). */
  seed?: (ctx: TestRepositories, groupId: string, me: string) => void;
}

async function setup({
  role = 'owner',
  lost = false,
  archived = false,
  invitations,
  ctx,
  seed,
}: Options = {}) {
  const repos = ctx ?? (await createTestRepositories());
  const { group, ids } = createTestGroup(repos);
  const me = repos.repos.profile.get()!;
  // Beto tiene cuenta (sus enlaces se nombran por su miembro).
  repos.sqlite.run(
    `INSERT INTO users (id, created_at, updated_at, display_name, is_remote) VALUES ('${BETO_ACCOUNT}', 1, 1, '?', 1)`,
  );
  repos.sqlite.run(`UPDATE group_members SET user_id = '${BETO_ACCOUNT}' WHERE id = '${ids[1]}'`);
  const grant = (id: string, userId: string, accessRole: string) =>
    repos.sqlite.run(
      `INSERT INTO group_access (id, group_id, user_id, role, created_at, updated_at, version)
       VALUES ('${id}', '${group.id}', '${userId}', '${accessRole}', 1, 1, 1)`,
    );
  grant('a-me', me.id, role);
  grant('a-beto', BETO_ACCOUNT, role === 'owner' ? 'member' : 'owner');
  if (lost) {
    repos.sqlite.run(`UPDATE groups SET access_lost_at = 1 WHERE id = '${group.id}'`);
  }
  if (archived) {
    repos.sqlite.run(`UPDATE groups SET archived_at = 1 WHERE id = '${group.id}'`);
  }
  mockParams.groupId = group.id;
  seed?.(repos, group.id, me.id);
  const service = invitations ?? createFakeInvitationService();
  await renderWithDatabase(<InviteGroupScreen />, repos, { invitations: service });
  await screen.findByTestId('invite-group-screen');
  return { ctx: repos, group, me, service };
}

const confirm = async (label: string) => {
  const call = alertSpy.mock.calls.at(-1) as [string, string | undefined, AlertButton[]];
  const button = call[2].find((b) => b.text === label);
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
};

describe('Invitar: crear y compartir', () => {
  it('muestra el título con el nombre del grupo, las duraciones y la lista vacía', async () => {
    await setup();
    expect(await screen.findByText('Invitar a «Viaje»')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: '7 días' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: '1 día' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: '30 días' })).toBeOnTheScreen();
    expect(await screen.findByText('Todavía no hay enlaces.')).toBeOnTheScreen();
  });

  it('crea un enlace de 7 días por omisión, lo guarda en el teléfono y abre la hoja de compartir', async () => {
    const user = userEvent.setup();
    const created = { id: ID_NEW, token: NEW_TOKEN, expiresAt: NOW + 7 * DAY, maxUses: 10 };
    // Como el servidor de verdad: el enlace recién creado sale en la lista.
    const invitations = createFakeInvitationService({
      create: jest.fn().mockResolvedValue(created),
      list: jest.fn(async () => [info({ id: ID_NEW, useCount: 0 })]),
    });
    const { ctx, group } = await setup({ invitations });

    await user.press(await screen.findByTestId('create-invite-link'));

    await waitFor(() =>
      expect(invitations.create).toHaveBeenCalledWith({
        groupId: group.id,
        expiresHours: 168,
        maxUses: 10,
      }),
    );
    // El token queda en la base cifrada de este teléfono, para «Compartir de nuevo».
    expect(ctx.repos.invitationLinks.get(ID_NEW)).toMatchObject({
      token: NEW_TOKEN,
      groupId: group.id,
    });
    // La hoja de compartir lleva el enlace (con el esquema propio mientras no haya dominio).
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    const message = (shareSpy.mock.calls[0] as [{ message: string }])[0].message;
    expect(message).toContain('«Viaje»');
    expect(message).toContain(`#${NEW_TOKEN}`);
  });

  it.each([
    ['1 día', 24],
    ['30 días', 720],
  ])('con %s pide %i horas', async (label, hours) => {
    const user = userEvent.setup();
    const created = { id: ID_NEW, token: NEW_TOKEN, expiresAt: NOW + DAY, maxUses: 10 };
    const invitations = createFakeInvitationService({
      create: jest.fn().mockResolvedValue(created),
    });
    await setup({ invitations });
    await user.press(await screen.findByRole('tab', { name: label }));
    await user.press(screen.getByTestId('create-invite-link'));
    await waitFor(() =>
      expect(invitations.create).toHaveBeenCalledWith(
        expect.objectContaining({ expiresHours: hours }),
      ),
    );
  });

  it('el enlace nuevo aparece en la lista después de crearlo', async () => {
    const user = userEvent.setup();
    const created = { id: ID_NEW, token: NEW_TOKEN, expiresAt: NOW + 7 * DAY, maxUses: 10 };
    const list = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([info({ id: ID_NEW, useCount: 0 })]);
    const invitations = createFakeInvitationService({
      create: jest.fn().mockResolvedValue(created),
      list,
    });
    await setup({ invitations });
    await screen.findByText('Todavía no hay enlaces.');
    await user.press(screen.getByTestId('create-invite-link'));
    expect(await screen.findByTestId(`invite-link-${ID_NEW}`)).toBeOnTheScreen();
  });

  it('sin internet no crea nada y lo explica', async () => {
    const user = userEvent.setup();
    const invitations = createFakeInvitationService({
      create: jest.fn().mockRejectedValue(new InvitationError('OFFLINE')),
    });
    const { ctx } = await setup({ invitations });
    await user.press(await screen.findByTestId('create-invite-link'));
    expect(await screen.findByTestId('invite-create-error')).toHaveTextContent(
      contains('Hace falta conexión a internet para esto'),
    );
    expect(shareSpy).not.toHaveBeenCalled();
    expect(ctx.repos.invitationLinks.listByGroup(mockParams.groupId as string)).toEqual([]);
  });

  it('demasiados enlaces: lo explica', async () => {
    const user = userEvent.setup();
    const invitations = createFakeInvitationService({
      create: jest.fn().mockRejectedValue(new InvitationError('RATE_LIMITED')),
    });
    await setup({ invitations });
    await user.press(await screen.findByTestId('create-invite-link'));
    expect(await screen.findByTestId('invite-create-error')).toHaveTextContent(
      contains('Demasiados intentos'),
    );
  });

  it('si se cierra la hoja de compartir sin enviar, el enlace queda creado', async () => {
    const user = userEvent.setup();
    shareSpy.mockRejectedValue(new Error('cancelado'));
    const created = { id: ID_NEW, token: NEW_TOKEN, expiresAt: NOW + 7 * DAY, maxUses: 10 };
    const invitations = createFakeInvitationService({
      create: jest.fn().mockResolvedValue(created),
      list: jest.fn(async () => [info({ id: ID_NEW, useCount: 0 })]),
    });
    const { ctx } = await setup({ invitations });
    await user.press(await screen.findByTestId('create-invite-link'));
    await waitFor(() => expect(ctx.repos.invitationLinks.get(ID_NEW)).toBeDefined());
    expect(screen.queryByTestId('invite-create-error')).toBeNull();
  });

  it('un grupo sin acceso o archivado no ofrece crear enlaces', async () => {
    await setup({ lost: true });
    await screen.findByText('Invitar a «Viaje»');
    expect(screen.queryByTestId('create-invite-link')).toBeNull();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await setup();
    expect(await screen.findByText('Invite to "Viaje"')).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: '7 days' })).toBeOnTheScreen();
    expect(screen.getByText('Create link and share')).toBeOnTheScreen();
  });
});

describe('Invitar: la lista de enlaces', () => {
  /** Los enlaces del servidor: uno mío, uno agotado de Beto y uno revocado de alguien sin miembro. */
  const serverRows = (me: string): InvitationInfo[] => [
    info({ createdBy: me }),
    info({ id: ID_OTHER, createdBy: BETO_ACCOUNT, useCount: 10, status: 'exhausted' }),
    info({ id: ID_REVOKED, status: 'revoked', revokedAt: NOW - 1000, createdBy: OTHER_ACCOUNT }),
  ];

  it('muestra el estado, los usos y quién lo creó', async () => {
    const list = jest.fn();
    await setup({
      invitations: createFakeInvitationService({ list }),
      seed: (_ctx, _group, me) => list.mockResolvedValue(serverRows(me)),
    });

    const mine = await screen.findByTestId(`invite-link-${ID_MINE}`);
    expect(mine).toHaveTextContent(contains('Vigente'));
    expect(mine).toHaveTextContent(contains('2 de 10 usos'));
    expect(mine).toHaveTextContent(contains('Creado por ti'));
    expect(screen.getByTestId(`invite-link-${ID_OTHER}`)).toHaveTextContent(contains('Agotado'));
    expect(screen.getByTestId(`invite-link-${ID_OTHER}`)).toHaveTextContent(
      contains('Creado por Beto'),
    );
    expect(screen.getByTestId(`invite-link-${ID_REVOKED}`)).toHaveTextContent(contains('Revocado'));
    expect(screen.getByTestId(`invite-link-${ID_REVOKED}`)).toHaveTextContent(
      contains('Creado por otra persona'),
    );
  });

  it('nunca muestra el token en la lista', async () => {
    const list = jest.fn();
    await setup({
      invitations: createFakeInvitationService({ list }),
      seed: (ctx, group, me) => {
        list.mockResolvedValue([info({ createdBy: me })]);
        ctx.repos.invitationLinks.save({
          id: ID_MINE,
          groupId: group,
          token: TOKEN,
          expiresAt: NOW + DAY,
          maxUses: 10,
        });
      },
    });
    await screen.findByTestId(`invite-link-${ID_MINE}`);
    expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
  });

  it('borra del teléfono el token de los enlaces que ya no sirven', async () => {
    const list = jest.fn();
    const { ctx, group } = await setup({
      invitations: createFakeInvitationService({ list }),
      seed: (repos, groupId, me) => {
        list.mockResolvedValue([
          info({ createdBy: me }),
          info({ id: ID_REVOKED, createdBy: me, status: 'revoked', revokedAt: 1 }),
          // ID_OTHER ya no sale en la lista del servidor (pasaron más de 7 días).
        ]);
        for (const [id, token] of [
          [ID_MINE, TOKEN],
          [ID_REVOKED, NEW_TOKEN],
          [ID_OTHER, 'o'.repeat(43)],
        ] as const) {
          repos.repos.invitationLinks.save({
            id,
            groupId,
            token,
            expiresAt: NOW + DAY,
            maxUses: 10,
          });
        }
      },
    });

    await screen.findByTestId(`invite-link-${ID_MINE}`);
    await waitFor(() =>
      expect(ctx.repos.invitationLinks.listByGroup(group.id).map((link) => link.id)).toEqual([
        ID_MINE,
      ]),
    );
  });

  it('"Compartir de nuevo" solo en los vigentes que creó este teléfono', async () => {
    const user = userEvent.setup();
    const list = jest.fn();
    await setup({
      invitations: createFakeInvitationService({ list }),
      seed: (ctx, group, me) => {
        list.mockResolvedValue([
          info({ createdBy: me }),
          info({ id: ID_OTHER, createdBy: me }),
          info({ id: ID_REVOKED, createdBy: me, status: 'revoked', revokedAt: 1 }),
        ]);
        // Este teléfono guarda el token del primero y del revocado, no del segundo.
        for (const [id, token] of [
          [ID_MINE, TOKEN],
          [ID_REVOKED, NEW_TOKEN],
        ] as const) {
          ctx.repos.invitationLinks.save({
            id,
            groupId: group,
            token,
            expiresAt: NOW + DAY,
            maxUses: 10,
          });
        }
      },
    });

    await screen.findByTestId(`invite-link-${ID_MINE}`);
    expect(screen.getByTestId(`share-again-${ID_MINE}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`share-again-${ID_OTHER}`)).toBeNull();
    expect(screen.queryByTestId(`share-again-${ID_REVOKED}`)).toBeNull();
    // El de otro teléfono dice por qué no se puede compartir.
    expect(screen.getByTestId(`invite-link-${ID_OTHER}`)).toHaveTextContent(
      contains('Creado en otro dispositivo: para compartirlo, crea uno nuevo.'),
    );

    await user.press(screen.getByTestId(`share-again-${ID_MINE}`));
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    const message = (shareSpy.mock.calls[0] as [{ message: string }])[0].message;
    expect(message).toContain(`#${TOKEN}`);
  });

  it('el dueño revoca cualquier enlace vigente', async () => {
    const list = jest.fn();
    await setup({
      role: 'owner',
      invitations: createFakeInvitationService({ list }),
      seed: (_ctx, _group, me) =>
        list.mockResolvedValue([
          info({ createdBy: me }),
          info({ id: ID_OTHER, createdBy: BETO_ACCOUNT }),
        ]),
    });
    await screen.findByTestId(`invite-link-${ID_MINE}`);
    expect(screen.getByTestId(`revoke-${ID_MINE}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`revoke-${ID_OTHER}`)).toBeOnTheScreen();
  });

  it('un miembro que no es dueño solo revoca los enlaces que creó', async () => {
    const list = jest.fn();
    await setup({
      role: 'member',
      invitations: createFakeInvitationService({ list }),
      seed: (_ctx, _group, me) =>
        list.mockResolvedValue([
          info({ createdBy: me }),
          info({ id: ID_OTHER, createdBy: BETO_ACCOUNT }),
        ]),
    });
    await screen.findByTestId(`invite-link-${ID_MINE}`);
    expect(screen.getByTestId(`revoke-${ID_MINE}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`revoke-${ID_OTHER}`)).toBeNull();
  });

  it('un enlace vencido, revocado o agotado no tiene acciones', async () => {
    const list = jest.fn();
    await setup({
      invitations: createFakeInvitationService({ list }),
      seed: (_ctx, _group, me) =>
        list.mockResolvedValue([
          info({ createdBy: me, status: 'expired' }),
          info({ id: ID_OTHER, createdBy: me, status: 'exhausted' }),
          info({ id: ID_REVOKED, createdBy: me, status: 'revoked', revokedAt: 1 }),
        ]),
    });
    await screen.findByTestId(`invite-link-${ID_MINE}`);
    for (const id of [ID_MINE, ID_OTHER, ID_REVOKED]) {
      expect(screen.queryByTestId(`revoke-${id}`)).toBeNull();
      expect(screen.queryByTestId(`share-again-${id}`)).toBeNull();
    }
  });

  it('revocar: pide confirmación, llama al servidor, borra el token local y recarga la lista', async () => {
    const user = userEvent.setup();
    const list = jest.fn();
    const invitations = createFakeInvitationService({ list });
    const { ctx } = await setup({
      invitations,
      seed: (seedCtx, group, me) => {
        list
          .mockResolvedValueOnce([info({ createdBy: me })])
          .mockResolvedValue([info({ createdBy: me, status: 'revoked', revokedAt: NOW })]);
        seedCtx.repos.invitationLinks.save({
          id: ID_MINE,
          groupId: group,
          token: TOKEN,
          expiresAt: NOW + DAY,
          maxUses: 10,
        });
      },
    });
    await user.press(await screen.findByTestId(`revoke-${ID_MINE}`));
    const dialog = alertSpy.mock.calls.at(-1) as [string, string, AlertButton[]];
    expect(dialog[0]).toBe('¿Revocar este enlace?');
    expect(invitations.revoke).not.toHaveBeenCalled();

    await confirm('Revocar');

    await waitFor(() => expect(invitations.revoke).toHaveBeenCalledWith(ID_MINE));
    expect(await screen.findByText('Revocado')).toBeOnTheScreen();
    expect(ctx.repos.invitationLinks.get(ID_MINE)).toBeUndefined();
    expect(screen.queryByTestId(`revoke-${ID_MINE}`)).toBeNull();
  });

  it('revocar sin internet: lo explica y el enlace sigue', async () => {
    const user = userEvent.setup();
    const list = jest.fn();
    const invitations = createFakeInvitationService({
      list,
      revoke: jest.fn().mockRejectedValue(new InvitationError('OFFLINE')),
    });
    await setup({
      invitations,
      seed: (_ctx, _group, me) => list.mockResolvedValue([info({ createdBy: me })]),
    });
    await user.press(await screen.findByTestId(`revoke-${ID_MINE}`));
    await confirm('Revocar');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(2));
    expect((alertSpy.mock.calls.at(-1) as [string, string])[1]).toMatch(/Hace falta conexión/);
    expect(screen.getByTestId(`revoke-${ID_MINE}`)).toBeOnTheScreen();
  });

  it('sin conexión muestra solo los enlaces de este teléfono y lo avisa', async () => {
    const invitations = createFakeInvitationService({
      list: jest.fn().mockRejectedValue(new InvitationError('OFFLINE')),
    });
    await setup({
      invitations,
      seed: (ctx, group) => {
        ctx.repos.invitationLinks.save({
          id: ID_MINE,
          groupId: group,
          token: TOKEN,
          expiresAt: NOW + DAY,
          maxUses: 10,
        });
      },
    });
    expect(await screen.findByTestId('invite-offline')).toBeOnTheScreen();
    expect(
      screen.getByText('Sin conexión: solo se ven los enlaces que creaste en este teléfono.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`invite-link-${ID_MINE}`)).toHaveTextContent(contains('Vigente'));
    expect(screen.getByTestId(`share-again-${ID_MINE}`)).toBeOnTheScreen();
  });

  it('si la lista falla por otra causa, lo dice y deja reintentar', async () => {
    const user = userEvent.setup();
    const list = jest
      .fn()
      .mockRejectedValueOnce(new InvitationError('SERVER'))
      .mockResolvedValue([]);
    await setup({ invitations: createFakeInvitationService({ list }) });
    expect(await screen.findByTestId('invite-list-error')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Todavía no hay enlaces.')).toBeOnTheScreen();
  });
});
