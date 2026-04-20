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
use crate::permissions::{self, ADMIN};
use crate::state::AppState;

#[derive(Serialize, Deserialize, Clone)]
pub struct GameManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub version: String,
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
    perms.require(ADMIN)?;

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

    // Sanity checks — names must be non-empty, entry_url must be http(s) or a
    // data URL. We allow data URLs so small demo games can ship inline.
    if manifest.id.trim().is_empty() || manifest.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Manifest id and name are required".to_string()));
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
    .bind(&manifest.id)
    .bind(&manifest.name)
    .bind(&manifest.description)
    .bind(&manifest.version)
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

    tracing::info!("Installed game '{}' ({})", manifest.name, manifest.id);

    Ok((
        StatusCode::CREATED,
        Json(InstalledGame {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
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
    perms.require(ADMIN)?;

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
