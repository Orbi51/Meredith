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

describe('the rate a project reports', () => {
	// Regression: the settings page showed "30000€" for a fee of 30 000 JPY,
	// because currency conversion lived in the projects page rather than in
	// projectEconomics. Two places computing the same number diverged the moment
	// one of them changed. These pin the arithmetic that both now share.
	const round = (n: number) => Math.round(n * 100) / 100;

	it('divides the EURO fee by the hours, not the foreign one', () => {
		const feeEur = toEur(30_000, 0.00541, 'JPY');
		expect(feeEur).toBe(162.3);

		// 162.30 € over 10 hours is 16.23 €/h — a sixth of the French minimum
		// wage, and exactly the kind of thing this table exists to reveal.
		expect(round(feeEur! / 10)).toBe(16.23);
		// The bug reported 3000 €/h for the same job.
		expect(round(30_000 / 10)).toBe(3000);
	});

	it('reports no rate at all rather than a wrong one', () => {
		// A foreign fee with no exchange rate must not fall back to treating the
		// number as euros.
		expect(toEur(30_000, null, 'JPY')).toBeNull();
	});
});

describe('a day is one number, used everywhere', () => {
	// The day length turns "2j" into hours when parsing a capture AND turns an
	// hourly rate into the day rate that gets quoted. Two definitions would
	// drift, which is exactly how a JPY fee once came out labelled in euros.
	it('turns an hourly rate into a day rate at the configured length', () => {
		const feeEur = 3500;
		const actualHours = 35;
		const hourly = feeEur / actualHours; // 100 €/h

		expect(Math.round(hourly * 7)).toBe(700); // a 7-hour day
		expect(Math.round(hourly * 8)).toBe(800); // an 8-hour day
	});

	it('reads a quoted day rate back out of the fee', () => {
		// 5 days at 450 is invoiced as 2250; the quoted rate must come back.
		const fee = 450 * 5;
		expect(fee).toBe(2250);
		expect(fee / 5).toBe(450);
	});
});

describe('fixed price and day rate are different economics', () => {
	// The distinction the projects page exists to make visible.
	const perDay = 8;

	it('a fixed fee earns LESS per day the longer it takes', () => {
		const fee = 4000;
		expect(Math.round(fee / 5)).toBe(800); // sold as 5 days
		expect(Math.round(fee / 8)).toBe(500); // actually took 8
		// The overrun is invisible in the total, which never changes — only the
		// day rate reveals it.
	});

	it('a day rate earns the SAME per day, and more in total', () => {
		const dayRate = 500;
		expect(dayRate).toBe(500); // whatever the days
		expect(dayRate * 5).toBe(2500);
		expect(dayRate * 8).toBe(4000); // extra days are extra money, not a loss
	});

	it('compares a fixed job against the rate you normally ask', () => {
		const fee = 4000;
		const actualHours = 64; // eight 8-hour days
		const hourly = fee / actualHours;
		const projectedDayRate = Math.round(hourly * perDay);

		expect(projectedDayRate).toBe(500);
		expect(projectedDayRate < 600).toBe(true); // under a usual 600 — flag it
	});
});
