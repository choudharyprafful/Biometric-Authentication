/**
 * Client-side-only card field validation for realism in the payment UI.
 * These values are never sent anywhere — see the module comment in
 * pages/Payments.tsx for the full PCI-scope reasoning. This file exists
 * purely so the format/checksum logic is testable in isolation like
 * everything else in this codebase, not because the values it validates
 * ever leave the browser.
 */

export interface CardDetails {
  number: string;
  expiry: string;
  cvv: string;
}

export const EMPTY_CARD: CardDetails = { number: '', expiry: '', cvv: '' };

export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  return (digits.match(/.{1,4}/g) ?? []).join(' ');
}

export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Standard Luhn checksum — the same format check every real card number
 *  satisfies, used here purely for realistic client-side validation. */
export function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function isExpiryValid(expiry: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const lastDayOfExpiryMonth = new Date(year, month, 0, 23, 59, 59);
  return lastDayOfExpiryMonth >= new Date();
}

export function isCardFormValid(card: CardDetails): boolean {
  return luhnCheck(card.number) && isExpiryValid(card.expiry) && /^\d{3,4}$/.test(card.cvv);
}

export type CardBrand = 'Visa' | 'Mastercard' | 'Amex' | 'Discover' | 'Card';

/** Brand is derived from the leading digits only (a standard, publicly
 *  documented numbering scheme — not sensitive on its own, unlike the
 *  rest of the number). Used purely for a realistic "charged" receipt. */
export function getCardBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^(6011|65)/.test(digits)) return 'Discover';
  return 'Card';
}

/** Last 4 digits only — the one part of a card number that's routinely
 *  shown on real receipts precisely because it isn't sensitive by itself.
 *  Still purely a display value: never sent to or stored by the backend. */
export function getLast4(number: string): string {
  const digits = number.replace(/\D/g, '');
  return digits.slice(-4);
}
