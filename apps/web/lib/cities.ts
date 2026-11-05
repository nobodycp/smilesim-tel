// The cities a profile may name, with their labels. The keys must match PALESTINE_CITIES in
// apps/api/src/modules/auth/cities.ts; the API refuses any other key.
import type { Locale } from './copy';

export type City = { key: string; ar: string; en: string; he: string };

export const CITIES: readonly City[] = [
  { key: 'jerusalem', ar: 'القدس', en: 'Jerusalem', he: 'ירושלים' },
  { key: 'ramallah', ar: 'رام الله', en: 'Ramallah', he: 'רמאללה' },
  { key: 'al_bireh', ar: 'البيرة', en: 'Al-Bireh', he: 'אל-בירה' },
  { key: 'birzeit', ar: 'بيرزيت', en: 'Birzeit', he: 'ביר זית' },
  { key: 'nablus', ar: 'نابلس', en: 'Nablus', he: 'שכם' },
  { key: 'hebron', ar: 'الخليل', en: 'Hebron', he: 'חברון' },
  { key: 'yatta', ar: 'يطا', en: 'Yatta', he: 'יטא' },
  { key: 'dura', ar: 'دورا', en: 'Dura', he: 'דורא' },
  { key: 'halhul', ar: 'حلحول', en: 'Halhul', he: 'חלחול' },
  { key: 'bethlehem', ar: 'بيت لحم', en: 'Bethlehem', he: 'בית לחם' },
  { key: 'beit_jala', ar: 'بيت جالا', en: 'Beit Jala', he: "בית ג'אלא" },
  { key: 'beit_sahour', ar: 'بيت ساحور', en: 'Beit Sahour', he: 'בית סאחור' },
  { key: 'jenin', ar: 'جنين', en: 'Jenin', he: "ג'נין" },
  { key: 'qabatiya', ar: 'قباطية', en: 'Qabatiya', he: 'קבאטיה' },
  { key: 'tulkarm', ar: 'طولكرم', en: 'Tulkarm', he: 'טול כרם' },
  { key: 'anabta', ar: 'عنبتا', en: 'Anabta', he: 'ענבתא' },
  { key: 'qalqilya', ar: 'قلقيلية', en: 'Qalqilya', he: 'קלקיליה' },
  { key: 'salfit', ar: 'سلفيت', en: 'Salfit', he: 'סלפית' },
  { key: 'tubas', ar: 'طوباس', en: 'Tubas', he: 'טובאס' },
  { key: 'jericho', ar: 'أريحا', en: 'Jericho', he: 'יריחו' },
  { key: 'abu_dis', ar: 'أبو ديس', en: 'Abu Dis', he: 'אבו דיס' },
  { key: 'al_eizariya', ar: 'العيزرية', en: 'Al-Eizariya', he: 'אל-עיזריה' },
  { key: 'gaza', ar: 'غزة', en: 'Gaza', he: 'עזה' },
  { key: 'jabalia', ar: 'جباليا', en: 'Jabalia', he: "ג'באליה" },
  { key: 'beit_lahia', ar: 'بيت لاهيا', en: 'Beit Lahia', he: 'בית לאהיה' },
  { key: 'beit_hanoun', ar: 'بيت حانون', en: 'Beit Hanoun', he: 'בית חאנון' },
  { key: 'deir_al_balah', ar: 'دير البلح', en: 'Deir al-Balah', he: 'דיר אל-בלח' },
  { key: 'nuseirat', ar: 'النصيرات', en: 'Nuseirat', he: 'נוסיראת' },
  { key: 'khan_younis', ar: 'خان يونس', en: 'Khan Younis', he: 'חאן יונס' },
  { key: 'rafah', ar: 'رفح', en: 'Rafah', he: 'רפיח' },
  { key: 'nazareth', ar: 'الناصرة', en: 'Nazareth', he: 'נצרת' },
  { key: 'haifa', ar: 'حيفا', en: 'Haifa', he: 'חיפה' },
  { key: 'jaffa', ar: 'يافا', en: 'Jaffa', he: 'יפו' },
  { key: 'acre', ar: 'عكا', en: 'Acre', he: 'עכו' },
  { key: 'umm_al_fahm', ar: 'أم الفحم', en: 'Umm al-Fahm', he: 'אום אל-פחם' },
  { key: 'shefa_amr', ar: 'شفاعمرو', en: "Shefa-'Amr", he: 'שפרעם' },
  { key: 'sakhnin', ar: 'سخنين', en: 'Sakhnin', he: "סח'נין" },
  { key: 'tayibe', ar: 'الطيبة', en: 'Tayibe', he: 'טייבה' },
  { key: 'tira', ar: 'الطيرة', en: 'Tira', he: 'טירה' },
  { key: 'baqa_al_gharbiyye', ar: 'باقة الغربية', en: 'Baqa al-Gharbiyye', he: 'באקה אל-גרביה' },
  { key: 'lod', ar: 'اللد', en: 'Lod', he: 'לוד' },
  { key: 'ramla', ar: 'الرملة', en: 'Ramla', he: 'רמלה' },
  { key: 'beersheba', ar: 'بئر السبع', en: 'Beersheba', he: 'באר שבע' },
  { key: 'rahat', ar: 'رهط', en: 'Rahat', he: 'רהט' },
];

export function cityLabel(key: string, locale: Locale): string {
  const city = CITIES.find((row) => row.key === key);
  return city ? city[locale] : key;
}

/** The list sorted by the label of the current language. */
export function citiesFor(locale: Locale): City[] {
  return [...CITIES].sort((a, b) => a[locale].localeCompare(b[locale], locale));
}
