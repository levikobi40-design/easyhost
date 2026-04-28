/** Hide legacy demo rows from property lists (Hotel Bazaar Jaffa pilot). */
export const DEMO_PROPERTY_NAME_RE =
  /john'?s\s+beach\s+house|sarah'?s\s+garden|mock\s+kobi/i;

export function isHiddenDemoProperty(p) {
  return DEMO_PROPERTY_NAME_RE.test(String(p?.name || '').trim());
}
