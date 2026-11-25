# accdev292/paperclip: nuestra versión de Paperclip

La rama `accdev/main` es la versión oficial que tenemos instalada más nuestros cambios, cada uno en su commit. Es también la documentación de nuestra versión: el código, sus pruebas y la documentación del repositorio (`doc/`, `docs/`, `skills/paperclip/`) describen lo que corre, y este fichero dice qué cambia respecto a la oficial y dónde.

| | |
| --- | --- |
| Base | `v2026.1001.0` (`8f8a0ab7`) |
| Rama | `accdev/main`. `master` es una copia de la oficial y no lleva nada nuestro |

## Cómo se mantiene

1. **Un cambio del núcleo es un commit en `accdev/main`,** con su prueba y con la documentación que cambia, en ese mismo commit. Es la regla de Paperclip («Docs updated when behavior or commands change», `AGENTS.md`, §11):
   - **la documentación del repositorio** (licencia MIT, como el código): se corrige la página que describe ese comportamiento, en su idioma;
   - **la documentación oficial publicada** (`paperclipai/paperclip-docs`): su licencia, CC BY-NC-ND 4.0, permite leerla y compartirla tal cual, pero no publicar una copia modificada. Lo que nuestro cambio deja mal se apunta abajo, en «Fe de erratas», con la página y lo que vale en nuestra versión;
   - **una fila en «Cambios»,** abajo.
2. **Un arreglo que ya publicó Paperclip se trae con `git cherry-pick -x <commit>`, sin tocarlo.** Al pasar a una versión que ya lo lleva, `git rebase` lo reconoce y lo descarta solo.
3. **Cambiar de versión base:** `git rebase --onto <etiqueta nueva> <etiqueta anterior> accdev/main`. Después se repasan «Cambios» y «Fe de erratas»: lo que ya trae la versión nueva se quita, y lo demás se vuelve a comprobar contra su código.
4. **Este repositorio es público:** nada de una compañía, de la instalación ni de sus claves. Cómo se construye y se despliega nuestra imagen está en el repositorio de operación de la instalación, que es privado.

## Cómo llega a producción

La instalación ejecuta la imagen oficial de la versión base con estos cambios aplicados en una capa. La capa solo puede sustituir lo que la imagen ejecuta desde su TypeScript (`packages/adapter-utils/src/` y `packages/adapters/*/src/`): un cambio de `server/` o de la interfaz no llega a producción hasta que se compile la imagen desde esta rama. Por eso cada fila dice si está en producción.

## Cambios

| Commit | Qué cambia | Por qué | De dónde sale | En producción | Se quita |
| --- | --- | --- | --- | --- | --- |
| «Stop duplicating wake context in adapter environments (#13891)» | Los adaptadores dejan de copiar el paquete de despertar en `PAPERCLIP_WAKE_PAYLOAD_JSON`; el agente lo sigue recibiendo en el *prompt* | Esa variable lleva el historial de comentarios del issue. Linux no admite una cadena de entorno de 131.072 bytes o más, y con un issue de mucho historial el proceso moría al arrancar (`E2BIG`, «argument list too long») | Paperclip, `4b8ec588` (PR #13891), en v2026.1005.0 y posteriores; traído con `cherry-pick -x` | Sí, sus ficheros de `packages/` | Al pasar a v2026.1005.0 o posterior |
| «Sandbox bridge: let sandboxed agents reach plugin tools» | El puente del sandbox deja pasar `GET /api/plugins/tools` y `POST /api/plugins/tools/execute`; el resto de `/api/plugins` sigue fuera | Sin ellas, un agente en sandbox recibe 403 «Route not allowed» antes de llegar al servidor y no puede usar las herramientas de los plugins. El servidor sigue aplicando sus permisos de agente y de perfil de herramientas | Nuestro. Sigue faltando en v2026.1117.0 (comprobado en su código el 2026-11-25) | Sí | Cuando Paperclip abra esas rutas al puente |
| «Sandbox bridge: give the bridge a 60 s readiness window» | El anfitrión espera hasta 60 s a que el puente del sandbox avise de que está listo, en lugar de 200 sondeos de 50 ms (unos 10 s). Si el proceso muere, la espera sigue terminando al momento, y el error dice cuánto esperó y si el proceso seguía vivo | Arrancar `node` en un sandbox recién creado tarda de 3 a 5 s, pero se han medido arranques de casi 40 s cuando el proveedor va lento. Con 10 s, la ejecución moría con «Timed out waiting for bridge readiness» antes de empezar y, si la lentitud seguía en los dos reintentos, el issue se quedaba sin ejecución | Nuestro. v2026.1117.0 sigue con los 200 sondeos (comprobado en su código el 2026-11-25) | Sí | Cuando Paperclip deje un plazo así o configurable |

## Fe de erratas de la documentación oficial

De `paperclipai/paperclip-docs` en la etiqueta `docs/v2026.1001.0`, la que documenta la base. Cada fila es una página que nuestra versión deja mal o incompleta.

| Página | Qué dice | En nuestra versión |
| --- | --- | --- |
| `docs/reference/deploy/environment-variables.md`, «Agent Runtime», `PAPERCLIP_WAKE_PAYLOAD_JSON` | La ponen «some adapters» para ahorrarse las primeras lecturas del issue | Ningún adaptador la pone. El paquete de despertar llega solo en el *prompt*, y el agente lee el issue y sus comentarios por la API |
| `docs/reference/api/plugins.md`, «Registry and discovery», `GET /api/plugins/tools` y `POST /api/plugins/tools/execute` | Las rutas, sin decir desde dónde se llaman | También responden desde una ejecución en sandbox, por el puente |
| `docs/reference/adapters/sandbox-providers.md`, «Reliability tuning» | Los ajustes del puente, sin el plazo de arranque | El anfitrión espera hasta 60 s a que el puente avise de que está listo |

## Lo que no es código

- **Cliente de PostgreSQL en la imagen.** La imagen de la instalación añade `pg_dump` y `psql` del mismo número mayor que la base. Sin `pg_dump`, la copia automática de la base (`runDatabaseBackup`, `packages/db/src/backup-lib.ts`) cae sin avisar a su motor JavaScript, que escribe el volcado entero sin comprimir antes de comprimirlo; con él, comprime al vuelo. Ninguna página oficial dice qué motor se usa. Cuando la imagen se compile desde esta rama, va en su `Dockerfile`.
