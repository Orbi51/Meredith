import { describe, expect, it } from 'vitest';
import { formatMoney, isSupportedCurrency, toEur } from './fx';

describe('toEur', () => {
	it('passes euros through untouched, with or without a rate', () => {
		expect(toEur(1000, null, 'EUR')).toBe(1000);
		expect(toEur(1000, 1, 'EUR')).toBe(1000);
	});

	it('converts using the stored rate', () => {
		// 500,000 JPY at the ECB rate we actually fetched.
		expect(toEur(500_000, 0.00541, 'JPY')).toBe(2705);
	});

	it('returns null rather than guessing when there is no rate', () => {
		// A fee shown in the wrong currency is worse than a fee not shown.
		expect(toEur(500_000, null, 'JPY')).toBeNull();
	});

	it('has nothing to convert when there is no fee', () => {
		expect(toEur(null, 0.0054, 'JPY')).toBeNull();
	});
});

describe('formatMoney', () => {
	// French grouping uses a NARROW NO-BREAK SPACE (U+202F), not a plain one.
	// Normalise it here rather than pasting an invisible character into the
	// expectation, where the next reader would have no idea it was there.
	const plain = (value: string) => value.replace(/[  ]/g, ' ');

	it('writes yen without decimals', () => {
		// 500 000,00 JPY is not how anyone writes yen.
		expect(plain(formatMoney(500_000, 'JPY'))).toBe('500 000 JPY');
	});

	it('keeps decimals for euros', () => {
		expect(plain(formatMoney(2705.5, 'EUR'))).toBe('2 705,50 EUR');
	});
});

describe('isSupportedCurrency', () => {
	it('accepts the ones the ECB publishes', () => {
		expect(isSupportedCurrency('JPY')).toBe(true);
		expect(isSupportedCurrency('EUR')).toBe(true);
	});

	it('rejects anything else rather than fetching a rate that will not exist', () => {
		expect(isSupportedCurrency('XYZ')).toBe(false);
		expect(isSupportedCurrency('BTC')).toBe(false);
	});
});
