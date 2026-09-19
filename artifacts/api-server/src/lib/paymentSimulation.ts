/**
 * The last-4 values below are Stripe's own publicly published test-card
 * numbers (https://docs.stripe.com/testing), reused deliberately rather
 * than invented, so this simulation matches what a real test-mode
 * processor integration would actually do. Card data never reaches this
 * server in full form — only last4 + brand (see cardValidation.ts).
 */

export type DeclineCode =
  | "generic_decline"
  | "insufficient_funds"
  | "lost_card"
  | "stolen_card"
  | "expired_card"
  | "incorrect_cvc"
  | "processing_error";

export interface ProcessorDecision {
  status: "completed" | "failed";
  declineCode: DeclineCode | null;
  declineMessage: string | null;
}

const DECLINE_MESSAGES: Record<DeclineCode, string> = {
  generic_decline: "Your card was declined.",
  insufficient_funds: "Your card has insufficient funds.",
  lost_card: "Your card was declined (reported lost).",
  stolen_card: "Your card was declined (reported stolen).",
  expired_card: "Your card has expired.",
  incorrect_cvc: "Your card's security code is incorrect.",
  processing_error: "An error occurred while processing your card. Try again.",
};

// Anything not in this map (including no card info at all) simulates a
// normal successful charge — succeeds unless told otherwise.
const DECLINE_BY_LAST4: Record<string, DeclineCode> = {
  "0002": "generic_decline",
  "9995": "insufficient_funds",
  "9987": "lost_card",
  "9979": "stolen_card",
  "0069": "expired_card",
  "0127": "incorrect_cvc",
  "0119": "processing_error",
};

/** Deterministic, not random — the same test card always produces the same
 *  result. `_amount` is accepted but unused, to keep the call site stable
 *  if amount-based decline logic is added later. */
export function simulateProcessorDecision(cardLast4: string | null | undefined, _amount: number): ProcessorDecision {
  const declineCode = cardLast4 ? DECLINE_BY_LAST4[cardLast4] : undefined;
  if (!declineCode) {
    return { status: "completed", declineCode: null, declineMessage: null };
  }
  return { status: "failed", declineCode, declineMessage: DECLINE_MESSAGES[declineCode] };
}
