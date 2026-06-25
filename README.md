# Koru Desktop

App de escritorio **local-first** para sacar tus estadísticas personales de **EVE Online** hablando
directamente con la API oficial (ESI), con el **mapa de New Eden como centro**. Hecha con cariño para
la comunidad — gratis, sin ánimo de lucro y sin competir con nadie.

> El mapa es el corazón: tus datos (PvP, assets, minería, ubicación) y los datos públicos del cluster
> (seguridad, soberanía, guerra de facciones, incursiones, lugares notables) se superponen como capas
> sobre el New Eden real.

## Qué hace

- **Mapa de New Eden** con capas conmutables y sub-filtros: Ubicación, Lugares/POI, Seguridad,
  Soberanía, Guerra de facciones, Incursiones, Kills/Jumps de la última hora, y tus capas personales
  (PvP, assets, minería).
- **PvP**: killmails (ESI + zKillboard), eficacia ISK, naves/sistemas top, rivales y batallas.
- **Wallet, Skills, Assets/Industria** por personaje y en vista **global** multi-personaje.
- **Patrimonio**: valor de assets (precios públicos de mercado) + snapshots locales y gráfico de evolución.
- **Planificador de rutas** (stargates) y **de saltos** de capital.

## Privacidad

Todo es **local y privado**. La app habla solo con ESI y zKillboard usando **tus** propios tokens:

- Autenticación **OAuth2 PKCE** (sin client secret).
- Los *refresh tokens* se guardan en el **keychain del sistema operativo**, nunca en disco plano ni
  en el repositorio.
- No hay servidor propio ni telemetría: tus datos no salen de tu máquina salvo las llamadas a ESI/zKill.
- Solo se piden los **scopes** de cada sección, de forma granular.

Al ser **open source**, puedes verificar tú mismo todo lo anterior antes de iniciar sesión.

## Instalación

Descarga el instalador de la sección **[Releases](../../releases)** (`.msi` o `setup.exe`) y ejecútalo.

> **Nota sobre SmartScreen:** la app aún no está firmada con un certificado, así que Windows mostrará
> "Windows protegió tu PC". Pulsa **Más información → Ejecutar de todas formas**. Es normal en apps
> indie; el aviso se suaviza a medida que más gente la descarga.

## Compilar desde el código

Requisitos: [Node.js](https://nodejs.org/) y [Rust](https://www.rust-lang.org/tools/install) +
[prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # desarrollo
npm run tauri build   # genera el instalador en src-tauri/target/release/bundle/
```

Para usar tu propia app registrada en CCP, pon tu `client_id` en `src-tauri/src/config.rs`
(ver `docs/REGISTRO_APP.md`). En PKCE el `client_id` no es secreto.

## Apoyar el proyecto

Si te resulta útil y quieres invitar a un café, se agradece — pero **es del todo voluntario**: la app
es y será igual de completa para todo el mundo, dones o no.

☕ **[ko-fi.com/rogiz7](https://ko-fi.com/rogiz7)**

## Créditos y agradecimientos

- **CCP Games** por EVE Online, la API ESI y el Static Data Export.
- La **comunidad de desarrolladores de EVE**, de la que esta herramienta aprende y a la que quiere
  devolver algo. Inspiración (solo inspiración, sin copiar código) en herramientas de la comunidad.
- Construida con **Tauri**, **Rust** y **React**.

## Licencia

[MIT](LICENSE). Úsala, modifícala y compártela libremente.

---

EVE Online y el logo de EVE son marcas registradas de CCP hf. Esta es una herramienta de **terceros**,
**no afiliada ni respaldada por CCP**. Todo el material relacionado con EVE Online es propiedad de
CCP hf.
