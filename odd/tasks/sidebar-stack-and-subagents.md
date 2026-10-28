# sidebar-stack-and-subagents
Objective: Add Engram, Tools, and Todos cards to 1:STACK, simplify Models card to names and provider only, and add a delegated subagents section inside 3:PROF.
Branch: feat/sidebar-stack-and-subagents | Delivery strategy: ask-on-risk (chain_strategy=stacked-to-main) | Test runner: `npm --prefix C:/Users/mfuen/solvitu-gentle-shell test`

## Specs

- **S1**: En la pestaña `1:STACK` (`id: "mem"`), mostrar las tarjetas `["ecosystem", "models", "engram", "tools", "todo"]` ("necesito la sección de engram y la sección de tools que va registrando cada tools utilizada en la sesión.", "1. ¿Qué tarjetas quieres mostrar dentro de la pestaña 1:STACK? — Stack + Models + Engram + Tools + Todos (Recomendado)"). En `src/sidebar-rail-builder.ts`, asegurar que las tarjetas de `1:STACK` se instancien perezosamente si no están montadas y que el cálculo de altura restante para `todo` contabilice las tarjetas previas.
- **S2**: Mostrar la tarjeta `todo` (`WorkspaceTodoMirror`) en `1:STACK` cuando el modelo utiliza la herramienta `todo` ("También, cuando se utiliza el "Todos" de las tareas pendientes del modelo, como esta C:\Users\mfuen\AppData\Local\Temp\gpSGAugD\pi-clipboard-1e9f6981-5870-424c-997d-f43e68eef8a4.png en main, mi main es 1:stack, ahí."), y dejar `2:GIT` (`SIDEBAR_TAB_CARD_MAP.git`) únicamente con `["gitGraph", "workingTree"]`.
- **S3**: En la tarjeta `Models` de `1:STACK` (`src/models/models-card.ts` y `src/models/models-client.ts`), eliminar todos los datos de `ctx`, tokens de uso, costos, barras de consumo y cuotas ("En stack, en la sección models, elimina todos los datos de ctx, uso, etc. Eso queda en la parte inferior donde ya lo tenemos. Solo deja nombres.", "3. En la sección Models de 1:STACK, ¿cómo prefieres que se muestre cada línea? — Nombre y proveedor (● claude-opus-4-8 · anthropic)"). Cada modelo renderiza una sola línea con `● <name> · <provider>` (activo) o `○ <name> · <provider>` (inactivo).
- **S4**: Actualizar y añadir pruebas unitarias en `test/models.test.ts`, `test/ecosystem-card.test.ts`, `test/engram.test.ts` y `test/sidebar.test.ts` verificando S1, S2 y S3 sin regresiones.
- **S5**: Mostrar las tareas delegadas a subagentes dentro de la pestaña `3:PROF` (`WorkspaceProfilesExtendedCard` en `src/profiles/profiles-card.ts` y `src/profiles/profiles-subagents.ts`) ("Además, actualmente cuando el modelo delega tareas a subagentes, me gustaría poder verlos.", "2. ¿Dónde y cómo quieres ver los subagentes cuando el modelo delega tareas? — Sección dentro de 3:PROF"), recolectando tareas en vivo y del historial de la sesión (`subagent_run`, `subagent_continue`, `subagent_cancel`, `subagent_status`, `subagent_result`, `custom_message`) y del directorio de tareas en disco (`gentle-agents/tasks` bajo `PI_CODING_AGENT_DIR`, `~/.gentle-shell/agent` y `~/.pi/agent` filtrado por `cwd`), mostrando rol coloreado `[<agent>]`, etiqueta, estado (`● RUNNING`, `✔ DONE`, `✖ FAIL`, `⊘ CANCEL`), ID, modo (`task`/`bg`) y duración.
- **S6**: Añadir pruebas unitarias en `test/profiles.test.ts` verificando la recolección de subagentes de sesión y disco y su renderizado dentro de `WorkspaceProfilesExtendedCard` respetando el ancho y el scroll interno.

## Tasks

- [x] T1 (S1, S2, S3, S4) — Update `1:STACK` and `2:GIT` card maps, rail builder lazy/height handling, and simplify `Models` card to name + provider only, with tests. Route: delegated (`gentle-ai-worker` `mvrdgd80-2-tmk0`, parallel unit + context backstop). Evidence: RED 4 failures -> GREEN 48/48 pass (`test/models.test.ts`, `test/ecosystem-card.test.ts`, `test/engram.test.ts`, `test/sidebar.test.ts`, `test/rail-cache.test.ts`). Commit: `39cdb48` (Slice 1).
- [x] T2 (S5, S6) — Add delegated subagent tasks tracking and rendering section inside `3:PROF` (`WorkspaceProfilesExtendedCard`), with tests. Route: delegated (`gentle-ai-worker` `mvrdgbdi-1-7v4f`, parallel unit + context backstop). Evidence: 20/20 pass (`test/profiles.test.ts`, `test/profile-sync.test.ts`); seam check 82/82 pass. Commit: `d266393` (Slice 2).

## Slice Boundaries (`chain_strategy=stacked-to-main`)
- **Slice 1** (`66ab098..39cdb48`): `39cdb48` — `feat(sidebar): add engram, tools, and todo cards to 1:STACK and simplify models card` (T1, S1–S4, 58 changed lines). Assessed: medium (`reviewDue: false`).
- **Slice 2** (`39cdb48..d266393`): `d266393` — `feat(profiles): display delegated subagent tasks in 3:PROF card` (T2, S5–S6, 533 changed lines). Assessed: medium (`reviewDue: false`).

## Log

- **L1**: `https://github.com/CinloDev/pi-cinlodev-cute Revisa este repo, necesito, para nuestra sidebar, lo siguiente:C:\Users\mfuen\AppData\Local\Temp\gpSGAugD\pi-clipboard-3cb81c14-6b56-4f53-93c9-4afeecf322aa.png C:\Users\mfuen\AppData\Local\Temp\gpSGAugD\pi-clipboard-b878490d-7a15-4e02-8652-52787c73bd38.png necesito la sección de engram y la sección de tools que va registrando cada tools utilizada en la sesión. Además, actualmente cuando el modelo delega tareas a subagentes, me gustaría poder verlos. También, cuando se utiliza el "Todos" de las tareas pendientes del modelo, como esta C:\Users\mfuen\AppData\Local\Temp\gpSGAugD\pi-clipboard-1e9f6981-5870-424c-997d-f43e68eef8a4.png en main, mi main es 1:stack, ahí. En stack, en la sección models, elimina todos los datos de ctx, uso, etc. Eso queda en la parte inferior donde ya lo tenemos. Solo deja nombres.`
- **L2 (2026-04-17)**: Decisiones del usuario vía `ask_user_question`:
  1. `1:STACK cards`: `Stack + Models + Engram + Tools + Todos (Recomendado)`
  2. `Subagentes`: `Sección dentro de 3:PROF`
  3. `Card Models`: `Nombre y proveedor (● claude-opus-4-8 · anthropic)`
- **L3 (2026-04-17)**: T1 (`mvrdgd80-2-tmk0`, commit `39cdb48`) y T2 (`mvrdgbdi-1-7v4f`, commit `d266393`) completados. Seam check: 82/82 tests en verde. Estrategia de entrega seleccionada por el usuario: `chain_strategy=stacked-to-main`.
