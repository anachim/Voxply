use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::RwLock;
use voxply_hub::db;
use voxply_hub::server;
use voxply_hub::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect("sqlite:hub.db?mode=rwc")
        .await?;

    db::migrations::run(&db).await?;

    let state = Arc::new(AppState {
        hub_name: "my-hub".to_string(),
        db,
        pending_challenges: RwLock::new(HashMap::new()),
    });

    let app = server::create_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("Hub server listening on http://localhost:3000");

    axum::serve(listener, app).await?;

    Ok(())
}
