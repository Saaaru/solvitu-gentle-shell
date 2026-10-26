import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkspaceSolviTabCard, YOUTUBE_PLAYER_SYMBOL, computeCoverColumns } from "../src/solvi-tab.ts";

// The YouTube Music player UI is parked for now (pending a decision on what this tab
// becomes); WorkspaceSolviTabCard always renders a "Solvi" placeholder regardless of
// connection state.

test("WorkspaceSolviTabCard - renders the Solvi placeholder cleanly with correct borders and visible width", () => {
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
	let rendersRequested = 0;
	const mockTui: any = {
		requestRender: () => {
			rendersRequested++;
		},
	};
	const card = new WorkspaceSolviTabCard(mockTui);

	const width = 45;
	const lines = card.render(width, 20);
	assert.ok(lines.length >= 4, "El placeholder debe devolver al menos 4 líneas");
	assert.ok(lines[0].includes("Solvi"), "Debe titular la tarjeta como Solvi");
	assert.ok(lines.some((l) => l.includes("Por definir todavía")), "Debe mostrar el aviso de placeholder");

	for (const line of lines) {
		assert.equal(visibleWidth(line), width, `Cada línea debe medir exactamente ${width} de ancho visible`);
	}
	card.dispose();
});

test("WorkspaceSolviTabCard - renders the same Solvi placeholder even when a player is connected", () => {
	(globalThis as any)[YOUTUBE_PLAYER_SYMBOL] = {
		getState: () => ({
			status: "playing",
			connectedClients: 1,
			title: "Bohemian Rhapsody",
			artist: "Queen",
		}),
		on: () => () => {},
	};

	const mockTui: any = { requestRender: () => {} };
	const card = new WorkspaceSolviTabCard(mockTui);
	const width = 50;
	const lines = card.render(width, 30);

	assert.ok(lines[0].includes("Solvi"));
	assert.ok(!lines.some((l) => l.includes("Bohemian Rhapsody")), "El reproductor no debe renderizarse mientras está parqueado");
	for (const line of lines) {
		assert.equal(visibleWidth(line), width, `Cada línea debe medir exactamente ${width} de ancho visible`);
	}

	card.dispose();
	delete (globalThis as any)[YOUTUBE_PLAYER_SYMBOL];
});

test("WorkspaceSolviTabCard - clearCover and dispose emit deleteKittyImage to terminal", () => {
	let writes: string[] = [];
	const mockTerminal: any = {
		write: (data: string) => writes.push(data),
	};
	const mockTui: any = {
		terminal: mockTerminal,
		requestRender: () => {},
	};

	const card = new WorkspaceSolviTabCard(mockTui);
	(card as any).activeCoverImageId = 4242;

	card.clearCover();
	assert.ok(writes.some((w) => w.includes("i=4242")), "clearCover debe emitir deleteKittyImage con el ID activo");
	assert.equal((card as any).activeCoverImageId, undefined);

	// dispose también debe ser idempotente
	writes = [];
	(card as any).activeCoverImageId = 9999;
	card.dispose();
	assert.ok(writes.some((w) => w.includes("i=9999")), "dispose debe emitir deleteKittyImage");
});

test("computeCoverColumns - adapts dynamically for 1:1, widescreen 16:9 and invalid dimensions", () => {
	// 1:1 portada cuadrada tradicional de álbum
	assert.equal(computeCoverColumns({ widthPx: 500, heightPx: 500 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 128, heightPx: 128 }), 7);

	// 16:9 widescreen miniatura de video musical en YouTube
	const cols169 = computeCoverColumns({ widthPx: 1280, heightPx: 720 });
	assert.equal(cols169, 12, "Debe calcular 12 columnas para aspect ratio 16:9");

	// 4:3 formato estándar intermedio
	const cols43 = computeCoverColumns({ widthPx: 640, heightPx: 480 });
	assert.equal(cols43, 9, "Debe calcular 9 columnas para aspect ratio 4:3");

	// Fallback para dimensiones ausentes o anómalas
	assert.equal(computeCoverColumns(undefined), 7);
	assert.equal(computeCoverColumns({ widthPx: 0, heightPx: 100 }), 7);
	assert.equal(computeCoverColumns({ widthPx: 100, heightPx: 0 }), 7);
});
