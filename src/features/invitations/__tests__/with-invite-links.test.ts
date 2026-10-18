const plugin = require('../../../../plugins/with-invite-links') as {
  (config: unknown): unknown;
  readInviteHost(env?: Record<string, string | undefined>): string | null;
  inviteIntentFilter(host: string): Record<string, unknown>;
  applyInviteFilter(manifest: Manifest, host: string): Manifest;
};

interface Filter {
  $?: Record<string, string>;
  action?: { $: Record<string, string> }[];
  category?: { $: Record<string, string> }[];
  data?: { $: Record<string, string> }[];
}
interface Manifest {
  manifest: {
    application: { activity: { $: Record<string, string>; 'intent-filter'?: Filter[] }[] }[];
  };
}

const HOST = 'splitmate.example.com';

/** Un manifiesto como el que genera Expo, con el filtro del esquema propio ya puesto. */
const manifest = (): Manifest => ({
  manifest: {
    application: [
      {
        activity: [
          {
            $: { 'android:name': '.MainActivity' },
            'intent-filter': [
              {
                action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
                data: [{ $: { 'android:scheme': 'splitmate' } }],
              },
            ],
          },
          { $: { 'android:name': '.OtraActividad' } },
        ],
      },
    ],
  },
});

describe('with-invite-links', () => {
  it('el filtro verifica https://<dominio>/i con la ruta exacta', () => {
    const filter = plugin.inviteIntentFilter(HOST) as Filter;
    expect(filter.$).toEqual({ 'android:autoVerify': 'true' });
    expect(filter.action?.[0]?.$['android:name']).toBe('android.intent.action.VIEW');
    expect(filter.category?.map((c) => c.$['android:name'])).toEqual([
      'android.intent.category.DEFAULT',
      'android.intent.category.BROWSABLE',
    ]);
    expect(filter.data).toEqual([
      { $: { 'android:scheme': 'https', 'android:host': HOST, 'android:path': '/i' } },
    ]);
  });

  it('se agrega a la actividad principal y deja el filtro del esquema propio', () => {
    const result = plugin.applyInviteFilter(manifest(), HOST);
    const [main, other] = result.manifest.application[0]!.activity;
    expect(main?.['intent-filter']).toHaveLength(2);
    expect(main?.['intent-filter']?.[0]?.data?.[0]?.$['android:scheme']).toBe('splitmate');
    expect(main?.['intent-filter']?.[1]?.data?.[0]?.$['android:host']).toBe(HOST);
    expect(other?.['intent-filter']).toBeUndefined();
  });

  it('repetirlo no duplica el filtro', () => {
    const once = plugin.applyInviteFilter(manifest(), HOST);
    const twice = plugin.applyInviteFilter(once, HOST);
    expect(twice.manifest.application[0]!.activity[0]!['intent-filter']).toHaveLength(2);
  });

  it('un dominio nuevo reemplaza al anterior', () => {
    const first = plugin.applyInviteFilter(manifest(), HOST);
    const second = plugin.applyInviteFilter(first, 'links.otra.app');
    const filters = second.manifest.application[0]!.activity[0]!['intent-filter']!;
    const hosts = filters.flatMap((f) => (f.data ?? []).map((d) => d.$['android:host']));
    expect(hosts).toEqual([undefined, 'links.otra.app']);
  });

  it('sin MainActivity, falla en vez de seguir en silencio', () => {
    expect(() =>
      plugin.applyInviteFilter({ manifest: { application: [{ activity: [] }] } }, HOST),
    ).toThrow(/MainActivity/);
  });

  it.each([
    ['un dominio', { EXPO_PUBLIC_INVITE_HOST: 'Splitmate.Example.com ' }, 'splitmate.example.com'],
    ['sin definir', {}, null],
    ['vacío', { EXPO_PUBLIC_INVITE_HOST: '' }, null],
    ['el marcador', { EXPO_PUBLIC_INVITE_HOST: '<dominio>' }, null],
    ['con esquema', { EXPO_PUBLIC_INVITE_HOST: 'https://splitmate.example.com' }, null],
    ['con ruta', { EXPO_PUBLIC_INVITE_HOST: 'splitmate.example.com/i' }, null],
  ])('readInviteHost: %s', (_name, env, expected) => {
    expect(plugin.readInviteHost(env)).toBe(expected);
  });

  it('sin dominio configurado, el plugin no toca la configuración y avisa', () => {
    const previous = process.env.EXPO_PUBLIC_INVITE_HOST;
    delete process.env.EXPO_PUBLIC_INVITE_HOST;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const config = { name: 'SplitMate' };
      expect(plugin(config)).toBe(config);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('EXPO_PUBLIC_INVITE_HOST'));
    } finally {
      warn.mockRestore();
      if (previous !== undefined) {
        process.env.EXPO_PUBLIC_INVITE_HOST = previous;
      }
    }
  });
});
