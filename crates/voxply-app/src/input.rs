use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};

use crate::app::{App, Focus};

pub async fn handle_key(app: &mut App, key: KeyEvent) -> Result<()> {
    match app.focus {
        Focus::Channels => handle_channels(app, key),
        Focus::Messages => handle_messages(app, key),
        Focus::Input => handle_input(app, key).await?,
    }
    Ok(())
}

fn handle_channels(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Up => {
            if app.selected_channel > 0 {
                app.selected_channel -= 1;
            }
        }
        KeyCode::Down => {
            if app.selected_channel + 1 < app.channels.len() {
                app.selected_channel += 1;
            }
        }
        KeyCode::Enter => {
            app.focus = Focus::Input;
        }
        _ => {}
    }
}

fn handle_messages(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc => {
            app.focus = Focus::Channels;
        }
        _ => {}
    }
}

async fn handle_input(app: &mut App, key: KeyEvent) -> Result<()> {
    match key.code {
        KeyCode::Enter => {
            if !app.input_buffer.is_empty() {
                let content = app.input_buffer.drain(..).collect::<String>();

                // Handle /create command
                if let Some(name) = content.strip_prefix("/create ") {
                    let name = name.trim();
                    if !name.is_empty() {
                        let channel = app.hub_client.create_channel(name).await?;
                        app.channels.push(channel);
                        app.selected_channel = app.channels.len() - 1;
                        // Signal channel change so main loop loads messages + subscribes
                        app.channel_changed = true;
                    }
                }
                // Regular message
                else if let Some(channel_id) = app.current_channel_id().map(|s| s.to_string()) {
                    let msg = app.hub_client.send_message(&channel_id, &content).await?;
                    if !app.seen_message_ids.contains(&msg.id) {
                        app.seen_message_ids.insert(msg.id.clone());
                        app.messages.push(msg);
                    }
                }
            }
        }
        KeyCode::Char(c) => {
            app.input_buffer.push(c);
        }
        KeyCode::Backspace => {
            app.input_buffer.pop();
        }
        KeyCode::Esc => {
            app.focus = Focus::Channels;
        }
        _ => {}
    }
    Ok(())
}
