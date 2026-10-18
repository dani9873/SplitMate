import { act, screen, userEvent, waitFor } from '@testing-library/react-native';

import { createTestGroup, createTestRepositories, type TestRepositories } from '@/db/test-utils';
import { changeLanguage } from '@/i18n';
import { createFakeSyncEngine, type FakeSyncEngine } from '@/features/sync/fake-engine';
import { renderWithDatabase } from '@/test/render';

import { createFakeInvitationService, type FakeInvitationService } from '../fake-invitations';
import { InvitationError, type InvitePreview } from '../invitation-service';
import { clearPendingInvite, peekPendingInvite, setPendingInvite } from '../pending-invite';
import { InviteScreen } from '../InviteScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
}));

const TOKEN = 'j'.repeat(43);
const GROUP = '01990000-0000-7000-8000-000000000001';
const XIME = '01990000-0000-7000-8000-0000000000a1';
const CARO = '01990000-0000-7000-8000-0000000000a2';

const preview = (over: Partial<InvitePreview> = {}): InvitePreview => ({
  group: { id: GROUP, name: 'Viaje', emoji: '🏝️', color: 'teal', currency: 'USD' },
  members: [
    { id: XIME, displayName: 'Xime' },
    { id: CARO, displayName: 'Caro' },
  ],
  accounts: 2,
  expiresAt: Date.UTC(2026, 9, 26, 12, 0, 0),
  alreadyMember: false,
  ...over,
});

beforeEach(async () => {
  mockReplace.mockClear();
  setPendingInvite(TOKEN);
  await act(() => changeLanguage('es'));
});

afterEach(async () => {
  await act(async () => clearPendingInvite());
  await act(() => changeLanguage('en'));
});

interface Options {
  invitations?: FakeInvitationService;
  engine?: FakeSyncEngine;
  ctx?: TestRepositories;
}

async function setup({ invitations, engine, ctx }: Options = {}) {
  const service =
    invitations ??
    createFakeInvitationService({
      preview: jest.fn().mockResolvedValue(preview()),
      accept: jest.fn().mockResolvedValue({ groupId: GROUP }),
    });
  const fakeEngine = engine ?? createFakeSyncEngine();
  const repos = ctx ?? (await createTestRepositories());
  repos.repos.profile.ensure('Ana');
  await renderWithDatabase(<InviteScreen />, repos, { invitations: service, engine: fakeEngine });
  return { service, engine: fakeEngine, ctx: repos };
}

describe('InviteScreen: la vista previa', () => {
  it('pide la vista previa con el token pendiente y muestra el grupo y quién queda libre', async () => {
    const { service } = await setup();
    expect(await screen.findByTestId('invite-ready')).toBeOnTheScreen();
    expect(service.preview).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('Unirte a «Viaje»')).toBeOnTheScreen();
    expect(screen.getByText('USD · 2 personas con cuenta')).toBeOnTheScreen();
    expect(screen.getByText(/El enlace vence el/)).toBeOnTheScreen();
    expect(screen.getByText('¿Quién eres?')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Xime' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Caro' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Soy alguien nuevo' })).toBeOnTheScreen();
  });

  it('el token no aparece en pantalla', async () => {
    await setup();
    await screen.findByTestId('invite-ready');
    expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();
  });

  it('mientras revisa muestra el aviso de carga', async () => {
    let resolve!: (value: InvitePreview) => void;
    const invitations = createFakeInvitationService({
      preview: jest.fn(() => new Promise<InvitePreview>((done) => (resolve = done))),
    });
    await setup({ invitations });
    expect(await screen.findByTestId('invite-checking')).toBeOnTheScreen();
    expect(screen.getByText('Revisando el enlace…')).toBeOnTheScreen();
    await act(async () => resolve(preview()));
    expect(await screen.findByTestId('invite-ready')).toBeOnTheScreen();
  });

  it('en inglés', async () => {
    await act(() => changeLanguage('en'));
    await setup();
    expect(await screen.findByText('Join "Viaje"')).toBeOnTheScreen();
    expect(screen.getByText('Who are you?')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: "I'm someone new" })).toBeOnTheScreen();
  });

  it('sin enlace pendiente: avisa que no es válido y no llama al servidor', async () => {
    await clearPendingInvite();
    const { service } = await setup();
    expect(await screen.findByTestId('invite-error')).toBeOnTheScreen();
    expect(
      screen.getByText('Este enlace no es válido. Pídele a quien te invitó uno nuevo.'),
    ).toBeOnTheScreen();
    expect(service.preview).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invite-retry')).toBeNull();
  });
});

describe('InviteScreen: unirse', () => {
  it('"Unirme" espera a que se elija quién eres', async () => {
    await setup();
    await screen.findByTestId('invite-ready');
    expect(screen.getByTestId('invite-join')).toBeDisabled();
  });

  it('eligiendo un miembro: acepta, borra el enlace pendiente, descarga y abre el grupo', async () => {
    const user = userEvent.setup();
    const ctx = await createTestRepositories();
    // El grupo ya está en el teléfono cuando termina la descarga.
    const { group } = createTestGroup(ctx);
    const invitations = createFakeInvitationService({
      preview: jest
        .fn()
        .mockResolvedValue(preview({ group: { ...preview().group, id: group.id } })),
      accept: jest.fn().mockResolvedValue({ groupId: group.id }),
    });
    const engine = createFakeSyncEngine();
    await setup({ invitations, engine, ctx });
    await user.press(await screen.findByRole('radio', { name: 'Xime' }));
    await user.press(screen.getByTestId('invite-join'));

    await waitFor(() =>
      expect(invitations.accept).toHaveBeenCalledWith(TOKEN, { kind: 'member', memberId: XIME }),
    );
    await waitFor(() => expect(engine.syncNow).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/groups/${group.id}`));
    expect(peekPendingInvite()).toBeNull();
  });

  it('el cursor del grupo vuelve a 0 antes de la descarga', async () => {
    const user = userEvent.setup();
    const ctx = await createTestRepositories();
    ctx.sqlite.run(
      `INSERT INTO sync_cursors (group_id, cursor, updated_at) VALUES ('${GROUP}', 9, 1)`,
    );
    const { engine } = await setup({ ctx });
    await user.press(await screen.findByRole('radio', { name: 'Caro' }));
    await user.press(screen.getByTestId('invite-join'));
    await waitFor(() => expect(engine.syncNow).toHaveBeenCalled());
    expect(ctx.sqlite.exec('SELECT count(*) FROM sync_cursors')[0]?.values[0]?.[0]).toBe(0);
  });

  it('«Soy alguien nuevo»: pide el nombre (con el de la cuenta de entrada) y entra como nuevo', async () => {
    const user = userEvent.setup();
    const { service } = await setup();
    await user.press(await screen.findByRole('radio', { name: 'Soy alguien nuevo' }));
    const name = await screen.findByTestId('invite-new-name');
    expect(name.props.value).toBe('Ana');

    await user.clear(name);
    await user.type(name, '  Eli  ');
    await user.press(screen.getByTestId('invite-join'));

    await waitFor(() =>
      expect(service.accept).toHaveBeenCalledWith(TOKEN, { kind: 'new', displayName: '  Eli  ' }),
    );
  });

  it('«Soy alguien nuevo» con el nombre en blanco no sale', async () => {
    const user = userEvent.setup();
    const { service } = await setup();
    await user.press(await screen.findByRole('radio', { name: 'Soy alguien nuevo' }));
    await user.clear(await screen.findByTestId('invite-new-name'));
    await user.press(screen.getByTestId('invite-join'));
    expect(await screen.findByText('Escribe tu nombre.')).toBeOnTheScreen();
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('si todos los miembros ya tienen cuenta, solo queda entrar como nuevo y viene elegido', async () => {
    const invitations = createFakeInvitationService({
      preview: jest.fn().mockResolvedValue(preview({ members: [] })),
    });
    await setup({ invitations });
    expect(
      await screen.findByText(/Todas las personas del grupo ya tienen cuenta/),
    ).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Soy alguien nuevo' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );
    expect(await screen.findByTestId('invite-new-name')).toBeOnTheScreen();
  });

  it('si ya eres parte del grupo, lo dice y ofrece abrirlo sin preguntar quién eres', async () => {
    const user = userEvent.setup();
    const ctx = await createTestRepositories();
    const { group } = createTestGroup(ctx);
    const invitations = createFakeInvitationService({
      preview: jest
        .fn()
        .mockResolvedValue(
          preview({ alreadyMember: true, group: { ...preview().group, id: group.id } }),
        ),
    });
    await setup({ invitations, ctx });
    expect(await screen.findByText('Ya eres parte de este grupo.')).toBeOnTheScreen();
    expect(screen.queryByText('¿Quién eres?')).toBeNull();
    expect(screen.queryByTestId('invite-join')).toBeNull();

    await user.press(screen.getByTestId('invite-open-group'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/groups/${group.id}`));
    expect(invitations.accept).not.toHaveBeenCalled();
    expect(peekPendingInvite()).toBeNull();
  });
});

describe('InviteScreen: errores', () => {
  const failingPreview = (code: ConstructorParameters<typeof InvitationError>[0]) =>
    createFakeInvitationService({
      preview: jest.fn().mockRejectedValue(new InvitationError(code)),
    });

  it.each([
    ['INVALID_LINK', 'Este enlace no es válido. Pídele a quien te invitó uno nuevo.'],
    ['RATE_LIMITED', 'Demasiados intentos. Prueba de nuevo en una hora.'],
    ['GROUP_FULL', 'El grupo llegó al máximo de personas.'],
    ['TOO_MANY_GROUPS', 'Llegaste al máximo de grupos.'],
    ['OFFLINE', 'Hace falta conexión a internet para esto. Inténtalo de nuevo cuando vuelva.'],
    ['SERVER', 'No se pudo completar. Inténtalo de nuevo.'],
  ] as const)('en la vista previa, %s: «%s»', async (code, text) => {
    await setup({ invitations: failingPreview(code) });
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it.each([['INVALID_LINK'], ['RATE_LIMITED'], ['GROUP_FULL'], ['TOO_MANY_GROUPS']] as const)(
    '%s no se reintenta y borra el enlace pendiente',
    async (code) => {
      await setup({ invitations: failingPreview(code) });
      await screen.findByTestId('invite-error');
      expect(screen.queryByTestId('invite-retry')).toBeNull();
      await waitFor(() => expect(peekPendingInvite()).toBeNull());
    },
  );

  it('sin conexión se puede reintentar, y el enlace sigue pendiente', async () => {
    const user = userEvent.setup();
    const invitations = createFakeInvitationService({
      preview: jest
        .fn()
        .mockRejectedValueOnce(new InvitationError('OFFLINE'))
        .mockResolvedValue(preview()),
    });
    await setup({ invitations });
    expect(await screen.findByTestId('invite-retry')).toBeOnTheScreen();
    expect(peekPendingInvite()).toBe(TOKEN);

    await user.press(screen.getByTestId('invite-retry'));
    expect(await screen.findByTestId('invite-ready')).toBeOnTheScreen();
    expect(invitations.preview).toHaveBeenCalledTimes(2);
  });

  it('si al aceptar alguien ya eligió ese miembro, recarga la lista y lo explica', async () => {
    const user = userEvent.setup();
    const invitations = createFakeInvitationService({
      preview: jest
        .fn()
        .mockResolvedValueOnce(preview())
        .mockResolvedValueOnce(preview({ members: [{ id: CARO, displayName: 'Caro' }] })),
      accept: jest.fn().mockRejectedValue(new InvitationError('MEMBER_TAKEN')),
    });
    await setup({ invitations });
    await user.press(await screen.findByRole('radio', { name: 'Xime' }));
    await user.press(screen.getByTestId('invite-join'));

    expect(await screen.findByText('Alguien ya eligió a Xime. Elige de nuevo.')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Xime' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Caro' })).toBeOnTheScreen();
    // Vuelve a elegir y el botón espera la nueva elección.
    expect(screen.getByTestId('invite-join')).toBeDisabled();
    expect(invitations.preview).toHaveBeenCalledTimes(2);
    expect(peekPendingInvite()).toBe(TOKEN);
  });

  it('cupo de grupos al aceptar: lo dice y no deja el enlace pendiente', async () => {
    const user = userEvent.setup();
    const invitations = createFakeInvitationService({
      preview: jest.fn().mockResolvedValue(preview()),
      accept: jest.fn().mockRejectedValue(new InvitationError('TOO_MANY_GROUPS')),
    });
    await setup({ invitations });
    await user.press(await screen.findByRole('radio', { name: 'Xime' }));
    await user.press(screen.getByTestId('invite-join'));
    expect(await screen.findByText('Llegaste al máximo de grupos.')).toBeOnTheScreen();
    await waitFor(() => expect(peekPendingInvite()).toBeNull());
  });

  it('Cerrar borra el enlace pendiente y vuelve al inicio', async () => {
    const user = userEvent.setup();
    await setup({ invitations: failingPreview('INVALID_LINK') });
    await user.press(await screen.findByTestId('invite-close'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(peekPendingInvite()).toBeNull();
  });

  it('la X del encabezado también cierra y borra el enlace pendiente', async () => {
    const user = userEvent.setup();
    await setup();
    await screen.findByTestId('invite-ready');
    await user.press(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(peekPendingInvite()).toBeNull();
  });
});
