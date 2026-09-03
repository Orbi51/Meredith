import { describe, expect, it } from 'vitest';
import { upcomingAdmin } from './freelance';
import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'Europe/Paris';
const on = (iso: string) => new Date(iso);
const civil = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd HH:mm');

describe('upcomingAdmin', () => {
	it('puts invoicing on the last day of each month', () => {
		const items = upcomingAdmin(on('2026-09-03T08:00:00Z'), TZ, 1);
		const invoice = items.find((i) => i.title.startsWith('Invoicing'));

		expect(invoice).toBeDefined();
		expect(civil(invoice!.deadline)).toBe('2026-09-30 18:00');
	});

	it('handles February, including leap years', () => {
		expect(
			civil(upcomingAdmin(on('2028-02-01T08:00:00Z'), TZ, 1)[0]!.deadline)
		).toBe('2028-02-29 18:00');
		expect(
			civil(upcomingAdmin(on('2027-02-01T08:00:00Z'), TZ, 1)[0]!.deadline)
		).toBe('2027-02-28 18:00');
	});

	it('schedules URSSAF in the month after each quarter', () => {
		// Quarters end in March, June, September and December, and the
		// declaration is due at the end of the following month.
		const october = upcomingAdmin(on('2026-10-01T08:00:00Z'), TZ, 1);
		const urssaf = october.find((i) => i.title.startsWith('URSSAF'));
		expect(urssaf).toBeDefined();
		expect(civil(urssaf!.deadline)).toBe('2026-10-31 18:00');
	});

	it('does not schedule URSSAF in a month that follows no quarter', () => {
		const september = upcomingAdmin(on('2026-09-03T08:00:00Z'), TZ, 1);
		expect(september.find((i) => i.title.startsWith('URSSAF'))).toBeUndefined();
	});

	it('never offers a deadline that has already passed', () => {
		// Run on the 30th, September's invoicing is still today — but October's
		// must not appear as if it were overdue.
		const items = upcomingAdmin(on('2026-09-30T08:00:00Z'), TZ, 3);
		for (const item of items) {
			expect(item.deadline.getTime()).toBeGreaterThan(on('2026-09-29T00:00:00Z').getTime());
		}
	});

	it('rolls into the next year in December', () => {
		const items = upcomingAdmin(on('2026-12-01T08:00:00Z'), TZ, 3);
		const titles = items.map((i) => i.title);
		expect(titles.some((t) => t.includes('December 2026'))).toBe(true);
		expect(titles.some((t) => t.includes('January 2027'))).toBe(true);
	});
});
