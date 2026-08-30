/**
 * Normalize user-entered phone input to a 10-digit Indian national mobile number (no country prefix).
 * Do not strip a leading "91" when the string is exactly 10 digits — those can be valid local numbers (e.g. 912xxxxxxx).
 */
export function normalizeIndianMobileDigits(input: string | undefined | null): string | null {
  const d = String(input ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  if (d.length > 10) return d.slice(-10);
  return null;
}
