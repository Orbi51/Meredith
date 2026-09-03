/**
 * Currency conversion to EUR.
 *
 * Rates come from the European Central Bank via Frankfurter — no key, no
 * account, and the ECB is the reference a French accountant will recognise.
 *
 * Two decisions worth stating, because they are about bookkeeping rather than
 * code:
 *
 * 1. **A rate is fetched once and stored, not recomputed.** A fee whose EUR
 *    value drifts every time the page loads is not a number you can plan
 *    against, and for accounts the rate that counts is the one on the invoice
 *    date. The stored rate carries the date it came from.
 *
 * 2. **These are reference rates, not what your bank gives you.** Expect a
 *    percent or two of difference after fees. Good enough to decide whether a
 *    job was worth taking; not a substitute for the figure on the statement.
 */

const ENDPOINT = 'https://api.frankfurter.dev/v1';

/** Currencies offered in the UI. ECB publishes all of these. */
export const CURRENCIES = [
	'EUR',
	'JPY',
	'USD',
	'GBP',
	'CHF',
	'CAD',
	'AUD',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'KRW',
	'CNY',
	'SGD',
	'HKD',
	'NZD',
	'BRL',
	'MXN',
	'ZAR',
	'INR'
] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Currencies conventionally written without decimals. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW']);

export function isSupportedCurrency(code: string): code is Currency {
	return (CURRENCIES as readonly string[]).includes(code);
}

export type FxRate = {
	/** EUR per one unit of the source currency. */
	rate: number;
	/** The date the ECB published it, "YYYY-MM-DD". */
	date: string;
};

/**
 * Fetch the rate to EUR, optionally as it stood on a given date.
 *
 * Returns null rather than throwing: a currency lookup failing is not a reason
 * to lose the fee the user just typed.
 */
export async function rateToEur(
	currency: string,
	onDate?: string | null
): Promise<FxRate | null> {
	if (currency === 'EUR') return { rate: 1, date: 'always' };
	if (!isSupportedCurrency(currency)) return null;

	// The ECB publishes on working days only; asking for a weekend returns the
	// preceding working day, which is what we want anyway.
	const path = onDate ? `/${onDate}` : '/latest';

	try {
		const response = await fetch(`${ENDPOINT}${path}?base=${currency}&symbols=EUR`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return null;

		const body = (await response.json()) as { date?: string; rates?: Record<string, number> };
		const rate = body.rates?.EUR;
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;

		return { rate, date: body.date ?? (onDate ?? 'unknown') };
	} catch {
		return null;
	}
}

/** Format an amount in its own currency, with the right number of decimals. */
export function formatMoney(amount: number, currency: string): string {
	const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
	return `${amount.toLocaleString('fr-FR', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	})} ${currency}`;
}

/** Convert to EUR using a stored rate. Null when we have no rate to use. */
export function toEur(amount: number | null, rate: number | null, currency: string): number | null {
	if (amount === null) return null;
	if (currency === 'EUR') return amount;
	if (rate === null) return null;
	return Math.round(amount * rate * 100) / 100;
}
