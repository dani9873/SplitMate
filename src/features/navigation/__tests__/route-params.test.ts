import { parseRouteId } from '../route-params';

describe('parseRouteId', () => {
  it('acepta UUID y los normaliza en minúsculas', () => {
    expect(parseRouteId('0199C82C-C000-7000-8000-000000000001')).toBe(
      '0199c82c-c000-7000-8000-000000000001',
    );
  });

  it.each([
    undefined,
    '',
    'abc',
    ['0199c82c-c000-7000-8000-000000000001'],
    "x' OR 1=1 --",
    '0199c82c-c000-7000-8000-000000000001-extra',
  ])('rechaza %p', (value) => {
    expect(parseRouteId(value)).toBeNull();
  });
});
