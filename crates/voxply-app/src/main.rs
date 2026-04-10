mod app;
mod hub_client;
mod input;
mod protocol;
mod ui;

use std::io;

use anyhow::Result;
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use voxply_identity::Identity;

use app::App;
use hub_client::HubClient;

#[tokio::main]
async fn main() -> Result<()> {
    // Hub URL from command line or default
    let hub_url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "http://localhost:3000".to_string());

    // Load identity
    let path = Identity::default_path()?;
    let (identity, _) = Identity::load_or_create(&path)?;

    // Connect and authenticate
    let hub_client = HubClient::connect(&hub_url, &identity).await?;
    let channels = hub_client.list_channels().await?;

    // Setup terminal
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    crossterm::execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Run the TUI
    let mut app = App::new(hub_client, channels);
    let result = app.run(&mut terminal).await;

    // Restore terminal (always, even on error)
    terminal::disable_raw_mode()?;
    crossterm::execute!(terminal.backend_mut(), LeaveAlternateScreen)?;

    result
}
