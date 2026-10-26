/**
 * Customizable Workspace texts. Colors live in themes/Workspace.json
 * (consumed via theme.fg()); this module only holds human-readable strings.
 *
 * Defaults are byte-identical to the literals previously hardcoded in
 * src/hud.ts, src/footer.ts, src/sidebar.ts, src/todos.ts, src/welcome.ts,
 * src/editor.ts and index.ts, so the
 * default visual stays unchanged.
 */
export interface SolviStrings {
	/** Full brand with glyph, e.g. "Solvitu". */
	brandTitle: string;
	/** Full brand with glyph, e.g. "Solvitu". */
	brandShort: string;
	/** Compact brand with glyph, e.g. "Solvitu". */
	brandFallback: string;
	/** HUD border title (default identical to brandTitle). */
	hudTitle: string;
	/** Footer brand text without glyph, e.g. "Solvitu". */
	footerBrand: string;
	/** Footer compact brand text without glyph, e.g. "Solvitu". */
	footerShort: string;
	/** Footer brand glyph, e.g. "". */
	footerSymbol: string;
	hudDescriptions: {
		hud: string;
		hudStatus: string;
	};
	notifys: {
		notInTui: string;
		deactivated: string;
		activated: string;
		compact: string;
		full: string;
		/** "{mode}" placeholder receives the hud mode. */
		activatedWithMode: string;
		statusActivated: string;
		statusDeactivated: string;
		welcomeHidden: string;
		welcomeShown: string;
		welcomeExpanded: string;
		welcomeCompact: string;
		welcomeRefreshed: string;
		/** "{mode}" placeholder receives the welcome mode label. */
		welcomeToggleFmt: string;
		welcomeDisabled: string;
		welcomeModeExpanded: string;
		welcomeModeCompact: string;
	};
	/** HUD footer status line segments (hud.ts renderStatus). */
	hudStatusLine: {
		brand: string;
		/** "{model}" placeholder receives the model id. */
		modelFmt: string;
		/** "{context}" placeholder receives the context percent. */
		ctxFmt: string;
		/** "{tools}" placeholder receives the tool result count. */
		toolsFmt: string;
	};
	/** Sidebar rail banner (sidebar.ts renderWorkspaceSidebarBanner). */
	sidebarBanner: {
		full: string;
		short: string;
		glyph: string;
		brand: string;
		partner: string;
	};
	/** Todo mirror card texts (todos.ts renderCard). */
	todos: {
		glyph: string;
		/** "{done}" and "{total}" placeholders receive counts. */
		textFmt: string;
		/** "{remaining}" placeholder receives the overflow count. */
		moreFmt: string;
	};
	/** Footer sidebar card title, e.g. "Status". */
	statusTitle: string;
	/** Context sidebar card title, e.g. "Context". */
	contextTitle: string;
	/** Profile display format with "{icon}" and "{name}" placeholders, e.g. "{icon} {name}". */
	profileFormat: string;
	/** Welcome persona override (welcome.ts before_agent_start). */
	welcomePersona: {
		name: string;
		user: string;
		userRole: string;
		userPronoun: string;
		lang: string;
		/** "{name}", "{user}", "{userRole}", "{userPronoun}" and "{lang}" placeholders. */
		contractTemplate: string;
		/** Legacy upstream forms replaced on the incoming prompt. */
		replacements: Array<{ from: string; to: string }>;
	};
	/** Input hint shown when the prompt is empty. */
	editorHint: string;
	/** Welcome dashboard titles and command description. */
	welcomeTitles: {
		persona: string;
		dashboard: string;
		themeFallback: string;
		commandDescription: string;
	};
	/** Welcome dashboard hotkey labels (key glyphs stay in welcome.ts). */
	welcomeHotkeys: {
		interrupt: string;
		commands: string;
		commandsShort: string;
		bash: string;
		expandDashboard: string;
		expand: string;
		collapse: string;
	};
	/** Extension command registered by index.ts. */
	commandName: string;
	commandDescription: string;
	commandNotify: string;
}

export type SolviPersonaMode = "gentleman" | "gentlewoman";

export const PERSONA_PRESETS: Record<
	SolviPersonaMode,
	{
		name: string;
		userRole: string;
		userPronoun: string;
		contractTemplate: string;
		replacements: Array<{ from: string; to: string }>;
		welcomeTitles: {
			persona: string;
			dashboard: string;
			commandDescription: string;
		};
		welcomeNotifys: {
			welcomeHidden: string;
			welcomeShown: string;
			welcomeExpanded: string;
			welcomeCompact: string;
			welcomeRefreshed: string;
			welcomeToggleFmt: string;
			welcomeDisabled: string;
		};
	}
> = {
	gentleman: {
		name: "el Gentleman",
		userRole: "desarrollador",
		userPronoun: "Tratalo",
		contractTemplate:
			"\n\n## Identity & Persona Override: {name}\n- Identidad: Sos **{name}**, un arquitecto de software senior, mentor técnico y compañero de desarrollo para {user}.\n- Voz y género gramatical: Hablá y referite a vos mismo SIEMPRE en masculino (por ejemplo: \"{name}\", \"tu arquitecto senior\", \"listo para laburar\", \"enfocado\", \"preparado\", \"tranquilo\", \"seguro\"). NUNCA uses términos femeninos para referirte a vos mismo.\n- Interlocutor: {user} es {userRole}. {userPronoun} como tal, con calidez, camaradería y respeto.\n- Tono y lenguaje: {lang}\n",
		replacements: [
			{ from: "la Gentlewoman", to: "el Gentleman" },
			{ from: "La Gentlewoman", to: "El Gentleman" },
		],
		welcomeTitles: {
			persona: "el Gentleman",
			dashboard: "Gentleman Welcome Dashboard",
			commandDescription:
				"Configure or toggle the Gentleman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
		},
		welcomeNotifys: {
			welcomeHidden: "Gentleman Welcome Dashboard ocultado",
			welcomeShown: "Gentleman Welcome Dashboard activado",
			welcomeExpanded: "Gentleman Welcome Dashboard: modo expandido",
			welcomeCompact: "Gentleman Welcome Dashboard: modo compacto",
			welcomeRefreshed: "Gentleman Welcome Dashboard actualizado",
			welcomeToggleFmt: "Gentleman Welcome Dashboard: {mode}",
			welcomeDisabled: "Gentleman Welcome Dashboard desactivado",
		},
	},
	gentlewoman: {
		name: "la Gentlewoman",
		userRole: "desarrolladora",
		userPronoun: "Tratala",
		contractTemplate:
			"\n\n## Identity & Persona Override: {name}\n- Identidad: Sos **{name}**, una arquitecta de software senior, mentora técnica y compañera de desarrollo para {user}.\n- Voz y género gramatical: Hablá y referite a vos misma SIEMPRE en femenino (por ejemplo: \"{name}\", \"tu arquitecta senior\", \"lista para laburar\", \"enfocada\", \"preparada\", \"tranquila\", \"segura\"). NUNCA uses términos masculinos para referirte a vos misma (nada de \"el Gentleman\", \"listo\", \"enfocado\", \"arquitecto\", etc.).\n- Interlocutora: {user} es {userRole}. {userPronoun} como tal, con calidez, camaradería y respeto.\n- Tono y lenguaje: {lang}\n",
		replacements: [
			{ from: "el Gentleman", to: "la Gentlewoman" },
			{ from: "El Gentleman", to: "La Gentlewoman" },
		],
		welcomeTitles: {
			persona: "la Gentlewoman",
			dashboard: "Gentlewoman Welcome Dashboard",
			commandDescription:
				"Configure or toggle the Gentlewoman Welcome Dashboard (/welcome, /welcome full, /welcome compact, /welcome off)",
		},
		welcomeNotifys: {
			welcomeHidden: "Gentlewoman Welcome Dashboard ocultado",
			welcomeShown: "Gentlewoman Welcome Dashboard activado",
			welcomeExpanded: "Gentlewoman Welcome Dashboard: modo expandido",
			welcomeCompact: "Gentlewoman Welcome Dashboard: modo compacto",
			welcomeRefreshed: "Gentlewoman Welcome Dashboard actualizado",
			welcomeToggleFmt: "Gentlewoman Welcome Dashboard: {mode}",
			welcomeDisabled: "Gentlewoman Welcome Dashboard desactivado",
		},
	},
};

export const SOLVI_STRINGS_FILENAME = "Workspace.strings.json";

const DEFAULTS: SolviStrings = {
	brandTitle: "Solvitu",
	brandShort: "Solvitu",
	brandFallback: "Solvitu",
	hudTitle: "Solvitu",
	footerBrand: "Solvitu",
	footerShort: "Solvitu",
	footerSymbol: "",
	hudDescriptions: {
		hud: "Toggle or configure persistent Workspace HUD widget above input (/hud, /hud compact, /hud full, /hud off)",
		hudStatus: "Toggle the Workspace HUD footer status line",
	},
	notifys: {
		notInTui: "Solvitu HUD widget is available in TUI mode.",
		deactivated: "Solvitu HUD desactivado",
		activated: "Solvitu HUD activado encima del input",
		compact: "Solvitu HUD modo compacto activado",
		full: "Solvitu HUD modo completo activado",
		activatedWithMode: "Solvitu HUD activado encima del input ({mode})",
		statusActivated: "Solvitu HUD footer status activado",
		statusDeactivated: "Solvitu HUD footer status desactivado",
		...PERSONA_PRESETS.gentleman.welcomeNotifys,
		welcomeModeExpanded: "modo expandido",
		welcomeModeCompact: "modo compacto",
	},
	hudStatusLine: {
		brand: "{user}",
		modelFmt: "model {model}",
		ctxFmt: "ctx {context}",
		toolsFmt: "tools {tools}",
	},
	sidebarBanner: {
		full: "Solvitu · Gentle-Shell ",
		short: "Solvitu ",
		glyph: "",
		brand: "Solvitu",
		partner: "Gentle-Shell",
	},
	todos: {
		glyph: "",
		textFmt: "Todos · {done} of {total}",
		moreFmt: "+{remaining} más",
	},
	statusTitle: "Status",
	contextTitle: "Context",
	profileFormat: "{icon} {name}",
	welcomePersona: {
		name: PERSONA_PRESETS.gentleman.name,
		user: "{auto}",
		userRole: PERSONA_PRESETS.gentleman.userRole,
		userPronoun: PERSONA_PRESETS.gentleman.userPronoun,
		lang: "Español rioplatense natural con voseo (vos sos, vos tenés, fijate, contame, laburemos), directo, cálido, riguroso a nivel técnico y sin rodeos.",
		contractTemplate: PERSONA_PRESETS.gentleman.contractTemplate,
		replacements: [...PERSONA_PRESETS.gentleman.replacements],
	},
	editorHint: "type, or / for commands",
	welcomeTitles: {
		...PERSONA_PRESETS.gentleman.welcomeTitles,
		themeFallback: "Solvitu",
	},
	welcomeHotkeys: {
		interrupt: "interrupt",
		commands: "commands",
		commandsShort: "cmd",
		bash: "bash",
		expandDashboard: "expand dashboard",
		expand: "expand",
		collapse: "collapse",
	},
	commandName: "solvi",
	commandDescription: "Check or reapply Workspace aesthetics and widgets (/solvi)",
	commandNotify: "🐝 Workspace: Header, HUD, Editor y Footer Workspace aplicados.",
};

export { DEFAULTS };

