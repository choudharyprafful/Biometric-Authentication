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
    let digit = Number(digits[i]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
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

export type CardBrand = 'Visa' | 'Mastercard' | 'Amex' | 'Discover' | 'JCB' | 'Diners Club' | 'Card';

/** Brand is derived from the leading digits only (a standard, publicly
 *  documented numbering scheme — not sensitive on its own, unlike the
 *  rest of the number). Used purely for a realistic "charged" receipt. */
export function getCardBrand(number: string): CardBrand {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'Discover';
  if (/^(2131|1800|35)/.test(digits)) return 'JCB';
  if (/^3(0[0-5]|[68])/.test(digits)) return 'Diners Club';
  return 'Card';
}

// Each real network fixes its own PAN length and CVV length — a
// Luhn-valid 16-digit number with an Amex prefix is not a real Amex
// number, and a 3-digit code on an Amex card is not where its real CVV
// (called CID) actually sits. Checking both, not just Luhn, is what makes
// this "further validation" rather than the same single generic check
// every brand was previously held to.
const PAN_LENGTHS_BY_BRAND: Record<CardBrand, number[]> = {
  Visa: [13, 16, 19],
  Mastercard: [16],
  Amex: [15],
  Discover: [16, 19],
  JCB: [16, 19],
  'Diners Club': [14, 16, 19],
  Card: [12, 13, 14, 15, 16, 17, 18, 19],
};

const CVV_LENGTH_BY_BRAND: Record<CardBrand, number> = {
  Visa: 3,
  Mastercard: 3,
  Amex: 4,
  Discover: 3,
  JCB: 3,
  'Diners Club': 3,
  Card: 3,
};

/** Whether the digit count matches what this specific brand's numbering
 *  scheme actually allows — a check the brand-agnostic Luhn pass alone
 *  can't make (a Luhn-valid number can still be the wrong length for the
 *  network its prefix claims to belong to). */
export function isPanLengthValidForBrand(number: string, brand: CardBrand): boolean {
  const digits = number.replace(/\D/g, '');
  return PAN_LENGTHS_BY_BRAND[brand].includes(digits.length);
}

/** The CVV length real processors actually expect for this brand — 4 for
 *  Amex (printed on the front, called CID), 3 for every other network
 *  (printed on the back). */
export function isCvvValidForBrand(cvv: string, brand: CardBrand): boolean {
  return new RegExp(String.raw`^\d{${CVV_LENGTH_BY_BRAND[brand]}}$`).test(cvv);
}

export function isCardFormValid(card: CardDetails): boolean {
  const brand = getCardBrand(card.number);
  return (
    luhnCheck(card.number) &&
    isPanLengthValidForBrand(card.number, brand) &&
    isExpiryValid(card.expiry) &&
    isCvvValidForBrand(card.cvv, brand)
  );
}

/** Last 4 digits only — the one part of a card number that's routinely
 *  shown on real receipts precisely because it isn't sensitive by itself.
 *  Still purely a display value: never sent to or stored by the backend. */
export function getLast4(number: string): string {
  const digits = number.replace(/\D/g, '');
  return digits.slice(-4);
}
