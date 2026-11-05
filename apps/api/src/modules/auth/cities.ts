// The cities a profile may name. Keys only: the labels in Arabic, English, and Hebrew live in
// apps/web/lib/cities.ts and must list the same keys. Jerusalem, the West Bank governorate
// centres and larger towns, the Gaza Strip, and the main Arab cities inside the 1948 lines.
export const PALESTINE_CITIES = [
  'jerusalem',
  'ramallah',
  'al_bireh',
  'birzeit',
  'nablus',
  'hebron',
  'yatta',
  'dura',
  'halhul',
  'bethlehem',
  'beit_jala',
  'beit_sahour',
  'jenin',
  'qabatiya',
  'tulkarm',
  'anabta',
  'qalqilya',
  'salfit',
  'tubas',
  'jericho',
  'abu_dis',
  'al_eizariya',
  'gaza',
  'jabalia',
  'beit_lahia',
  'beit_hanoun',
  'deir_al_balah',
  'nuseirat',
  'khan_younis',
  'rafah',
  'nazareth',
  'haifa',
  'jaffa',
  'acre',
  'umm_al_fahm',
  'shefa_amr',
  'sakhnin',
  'tayibe',
  'tira',
  'baqa_al_gharbiyye',
  'lod',
  'ramla',
  'beersheba',
  'rahat',
] as const;

export type PalestineCity = (typeof PALESTINE_CITIES)[number];

const CITY_SET: ReadonlySet<string> = new Set(PALESTINE_CITIES);

export function isPalestineCity(value: string): value is PalestineCity {
  return CITY_SET.has(value);
}
