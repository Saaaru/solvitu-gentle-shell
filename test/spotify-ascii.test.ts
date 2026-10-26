import test from "node:test";
import assert from "node:assert/strict";
import { centerPad, equalizerRow, formatClock, renderProgressBar, truncatePlain, wrapText } from "../src/spotify/spotify-ascii.ts";

test("formatClock - m:ss under an hour, h:mm:ss above, safe on bad input", () => {
	assert.equal(formatClock(0), "0:00");
	assert.equal(formatClock(83_000), "1:23");
	assert.equal(formatClock(225_900), "3:45");
	assert.equal(formatClock(3_600_000), "1:00:00");
	assert.equal(formatClock(3_725_000), "1:02:05");
	assert.equal(formatClock(-5), "0:00");
	assert.equal(formatClock(Number.NaN), "0:00");
});

test("renderProgressBar - exact width, marker position and clamping", () => {
	for (const w of [0, 1, 2, 5, 20, 33]) {
		for (const r of [-1, 0, 0.3, 0.5, 1, 4, Number.NaN]) {
			assert.equal([...renderProgressBar(r, w)].length, w, `ratio ${r} width ${w}`);
		}
	}
	assert.equal(renderProgressBar(0, 5), "●────");
	assert.equal(renderProgressBar(1, 5), "━━━━●");
	assert.equal(renderProgressBar(0.5, 5), "━━●──");
});

test("equalizerRow - width-safe, deterministic, animated, flat when inactive, seed-dependent", () => {
	const bars = /^[▁▂▃▄▅▆▇█]*$/;
	for (const w of [0, 1, 10, 41]) {
		const row = equalizerRow(w, 1234, "abc", true);
		assert.equal([...row].length, w);
		assert.match(row, bars);
	}
	assert.equal(equalizerRow(20, 500, "abc", true), equalizerRow(20, 500, "abc", true));
	assert.notEqual(equalizerRow(20, 500, "abc", true), equalizerRow(20, 900, "abc", true));
	assert.notEqual(equalizerRow(20, 500, "abc", true), equalizerRow(20, 500, "xyz", true));
	assert.equal(equalizerRow(8, 500, "abc", false), "▁▁▁▁▁▁▁▁");
});

test("truncatePlain, centerPad and wrapText respect the width", () => {
	assert.equal(truncatePlain("hola", 10), "hola");
	assert.equal(truncatePlain("abcdefghij", 5), "abcd…");
	assert.equal(truncatePlain("abc", 0), "");
	assert.equal(truncatePlain("abc", 1), "…");
	assert.equal(centerPad("ab", 6), "  ab  ");
	assert.equal(centerPad("abcdefgh", 4), "abc…");
	const lines = wrapText("uno dos tres https://developer.spotify.com/dashboard fin", 12);
	assert.ok(lines.length > 3);
	for (const l of lines) assert.ok([...l].length <= 12, l);
	assert.deepEqual(wrapText("", 10), [""]);
});
