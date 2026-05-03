//! Hub-installed games. Admins install games by pointing at a manifest URL;
//! the hub fetches it, validates, and stores the metadata. Every hub member
//! can then launch the game from their client.
//!
//! The game itself runs client-side in a sandboxed iframe (entry_url from the
//! manifest). The hub only tracks which games are installed — it doesn't
//! proxy game content or run game logic.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::middleware::AuthUser;
use crate::permissions::{self, MANAGE_GAMES};
use crate::state::AppState;

#[derive(Serialize, Deserialize, Clone)]
pub struct GameManifest {
    /// Optional. When omitted we derive a stable id from the entry_url so
    /// re-installing the same URL upserts (which is the natural "update
    /// this game" behavior). Authors who want to control their own id —
    /// e.g. to keep it stable across hosting moves — can still set it.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Optional. Defaults to "1.0.0" — version is purely informational
    /// today (shown in the games list, not used for any functional logic).
    #[serde(default)]
    pub version: Option<String>,
    pub entry_url: String,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default = "default_min_players")]
    pub min_players: i64,
    #[serde(default = "default_max_players")]
    pub max_players: i64,
}

fn default_min_players() -> i64 {
    1
}
fn default_max_players() -> i64 {
    1
}

/// Stable id derived from the entry_url. FNV-1a 64-bit — no crypto needed
/// since we just want "same URL re-installed = same id (= upsert)" with
/// negligible collision risk at our scale.
fn derive_id_from_entry_url(entry_url: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in entry_url.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("game-{h:016x}")
}

#[derive(Deserialize)]
pub struct InstallGameRequest {
    /// HTTP(S) URL that returns a GameManifest as JSON, or a `builtin:<name>`
    /// short-circuit for bundled demo games.
    pub manifest_url: String,
    /// Alternative: supply the manifest inline instead of fetching a URL.
    #[serde(default)]
    pub manifest: Option<GameManifest>,
}

#[derive(Serialize)]
pub struct InstalledGame {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub entry_url: String,
    pub thumbnail_url: Option<String>,
    pub author: Option<String>,
    pub min_players: i64,
    pub max_players: i64,
    pub installed_by: String,
    pub installed_at: i64,
    pub manifest_url: String,
}

pub async fn install_game(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(req): Json<InstallGameRequest>,
) -> Result<(StatusCode, Json<InstalledGame>), (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(MANAGE_GAMES)?;

    // Prefer an inline manifest if provided (useful for builtin demo games);
    // otherwise fetch the URL.
    let manifest: GameManifest = if let Some(inline) = req.manifest {
        inline
    } else {
        let client = reqwest::Client::new();
        let resp = client
            .get(&req.manifest_url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to fetch manifest: {e}"),
                )
            })?;
        if !resp.status().is_success() {
            return Err((
                StatusCode::BAD_GATEWAY,
                format!("Manifest URL returned {}", resp.status()),
            ));
        }
        resp.json().await.map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                format!("Invalid manifest JSON: {e}"),
            )
        })?
    };

    // Sanity checks — name must be non-empty; id/version get derived if
    // omitted so authors don't have to invent bookkeeping fields.
    if manifest.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Manifest name is required".to_string()));
    }
    let u = manifest.entry_url.as_str();
    // Accept absolute http(s):// URLs, data URLs (inline games), and paths
    // that start with `/` (for client-bundled assets served from the app's
    // static root, e.g. /demo-games/dice.html). Explicitly refuse javascript:,
    // file:, and other schemes that can escape the iframe sandbox.
    let ok = u.starts_with("http://")
        || u.starts_with("https://")
        || u.starts_with("data:")
        || u.starts_with('/');
    if !ok {
        return Err((
            StatusCode::BAD_REQUEST,
            "entry_url must be http(s)://, data:, or a /-prefixed path".to_string(),
        ));
    }

    let now = crate::auth::handlers::unix_timestamp();

    // Apply defaults for the optional fields. id ties to entry_url so the
    // same URL re-installed = upsert (= "update this game"). Version is
    // informational only.
    let id = manifest
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| derive_id_from_entry_url(&manifest.entry_url));
    let version = manifest
        .version
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "1.0.0".to_string());

    sqlx::query(
        "INSERT INTO hub_games
         (id, name, description, version, entry_url, thumbnail_url, author,
          min_players, max_players, installed_by, installed_at, manifest_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           version = excluded.version,
           entry_url = excluded.entry_url,
           thumbnail_url = excluded.thumbnail_url,
           author = excluded.author,
           min_players = excluded.min_players,
           max_players = excluded.max_players,
           manifest_url = excluded.manifest_url",
    )
    .bind(&id)
    .bind(&manifest.name)
    .bind(&manifest.description)
    .bind(&version)
    .bind(&manifest.entry_url)
    .bind(&manifest.thumbnail_url)
    .bind(&manifest.author)
    .bind(manifest.min_players)
    .bind(manifest.max_players)
    .bind(&user.public_key)
    .bind(now)
    .bind(&req.manifest_url)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    tracing::info!("Installed game '{}' ({})", manifest.name, id);

    Ok((
        StatusCode::CREATED,
        Json(InstalledGame {
            id,
            name: manifest.name,
            description: manifest.description,
            version,
            entry_url: manifest.entry_url,
            thumbnail_url: manifest.thumbnail_url,
            author: manifest.author,
            min_players: manifest.min_players,
            max_players: manifest.max_players,
            installed_by: user.public_key,
            installed_at: now,
            manifest_url: req.manifest_url,
        }),
    ))
}

pub async fn list_games(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> Result<Json<Vec<InstalledGame>>, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, GameRow>(
        "SELECT id, name, description, version, entry_url, thumbnail_url, author,
                min_players, max_players, installed_by, installed_at, manifest_url
         FROM hub_games ORDER BY name",
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(
        rows.into_iter()
            .map(|r| InstalledGame {
                id: r.id,
                name: r.name,
                description: r.description,
                version: r.version,
                entry_url: r.entry_url,
                thumbnail_url: r.thumbnail_url,
                author: r.author,
                min_players: r.min_players,
                max_players: r.max_players,
                installed_by: r.installed_by,
                installed_at: r.installed_at,
                manifest_url: r.manifest_url,
            })
            .collect(),
    ))
}

pub async fn uninstall_game(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(game_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let perms = permissions::user_permissions(&state.db, &user.public_key).await?;
    perms.require(MANAGE_GAMES)?;

    let result = sqlx::query("DELETE FROM hub_games WHERE id = ?")
        .bind(&game_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Game not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(sqlx::FromRow)]
struct GameRow {
    id: String,
    name: String,
    description: Option<String>,
    version: String,
    entry_url: String,
    thumbnail_url: Option<String>,
    author: Option<String>,
    min_players: i64,
    max_players: i64,
    installed_by: String,
    installed_at: i64,
    manifest_url: String,
}
