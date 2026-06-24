# Registrar la app en CCP y arrancar F1

## 1. Registrar la aplicación

1. Entra en https://developers.eveonline.com/applications y pulsa **Create New Application**.
2. Rellena:
   - **Name:** Koru Desktop (lo que quieras)
   - **Description:** App de escritorio de estadísticas personales.
   - **Connection Type:** **Authentication & API Access** (para poder pedir scopes).
   - **Permissions (scopes):** marca los del set v1 (de `docs/SCOPES.md`):
     ```
     esi-killmails.read_killmails.v1
     esi-wallet.read_character_wallet.v1
     esi-skills.read_skills.v1
     esi-skills.read_skillqueue.v1
     esi-assets.read_assets.v1
     esi-industry.read_character_jobs.v1
     esi-industry.read_character_mining.v1
     ```
     (Opcional, recomendado para no re-registrar luego: `esi-location.read_location.v1`,
     `esi-location.read_ship_type.v1`, `esi-location.read_online.v1`,
     `esi-markets.read_character_orders.v1`, `esi-clones.read_implants.v1`,
     `esi-clones.read_clones.v1`, `esi-characters.read_blueprints.v1`.)
   - **Callback URL:** exactamente
     ```
     http://localhost:8765/callback
     ```
3. Crea la app y copia el **Client ID**. (En PKCE el secret NO se usa; no hace falta copiarlo.)

## 2. Configurar el client_id

Abre `src-tauri/src/config.rs` y sustituye:

```rust
pub const CLIENT_ID: &str = "PON_AQUI_TU_CLIENT_ID";
```

por tu Client ID real. Si cambias el puerto del callback, actualiza `CALLBACK_PORT` y
`REDIRECT_URI` a la vez (y el callback registrado en CCP).

## 3. Compilar y probar

```powershell
cd "C:\Users\usserpc\Claude\Projects\Rekium EVE Online\koru-desktop"

# Tests del backend (incluye el vector RFC 7636 de PKCE)
cd src-tauri
cargo test
cd ..

# Arrancar la app
npm run tauri dev
```

> La primera compilación bajará bastantes crates (reqwest, rusqlite bundled, etc.) y tardará.

## 4. Qué deberías ver

1. La ventana "Koru Desktop" con un desplegable de features y un botón de login.
2. Elige **"Solo identidad (0 scopes)"** y pulsa **Iniciar sesión con EVE**.
3. Se abre el navegador en el SSO de CCP → logueas → eliges personaje → autorizas.
4. El navegador muestra "Autenticación completada, puedes cerrar esta pestaña".
5. La app lista el personaje. Pulsa **Verificar token** → debe hacer un refresh y mostrar el nombre
   (esto prueba: PKCE + intercambio + validación JWT + guardado en keyring + refresh, de punta a punta).
6. Repite eligiendo, p. ej., **PvP / killmails** para conceder ese scope de forma granular.

## 5. Verificaciones de seguridad ya implementadas

- **PKCE S256** (sin client secret incrustado).
- **state** anti-CSRF verificado en el callback.
- **refresh_token en el keychain del SO** (no en SQLite ni en disco plano).
- **Validación del JWT**: firma vía JWKS, emisor, audiencia (client_id + "EVE Online"), expiración.
- **Rotación de refresh token** con un mutex por personaje (evita la race condition de corptools).
- **X-Compatibility-Date** fijo en cada llamada ESI.

## 6. Problemas típicos

- **"address in use" al loguear:** el puerto 8765 está ocupado. Cambia `CALLBACK_PORT`/`REDIRECT_URI`
  en `config.rs` y el callback en CCP.
- **"token_endpoint respondió 400":** el `redirect_uri` o el `client_id` no coinciden con lo
  registrado, o el callback de CCP no es idéntico (incluido `http://` y la barra final).
- **El navegador no abre:** mira la consola; la URL de autorización se construye igual, puedes
  pegarla a mano para depurar.
