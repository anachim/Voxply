use std::collections::HashSet;
use std::io::Stdout;
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{EventStream, Event, KeyCode, KeyEventKind, KeyModifiers};
use futures_util::{SinkExt, StreamExt};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

use crate::hub_client::HubClient;
use crate::input;
use crate::protocol::{ChannelResponse, MessageResponse, WsServerMessage};
use crate::ui;

pub struct App {
    pub hub_client: HubClient,
    pub channels: Vec<ChannelResponse>,
    pub selected_channel: usize,
    pub messages: Vec<MessageResponse>,
    pub seen_message_ids: HashSet<String>,
    pub input_buffer: String,
    pub focus: Focus,
    pub should_quit: bool,
    pub channel_changed: bool,
}

#[derive(PartialEq)]
pub enum Focus {
    Channels,
    Messages,
    Input,
}

impl Focus {
    pub fn next(&self) -> Self {
        match self {
            Focus::Channels => Focus::Input,
            Focus::Input => Focus::Messages,
            Focus::Messages => Focus::Channels,
        }
    }
}

impl App {
    pub fn new(hub_client: HubClient, channels: Vec<ChannelResponse>) -> Self {
        Self {
            hub_client,
            channels,
            selected_channel: 0,
            messages: Vec::new(),
            seen_message_ids: HashSet::new(),
            input_buffer: String::new(),
            focus: Focus::Channels,
            should_quit: false,
            channel_changed: false,
        }
    }

    pub fn current_channel_id(&self) -> Option<&str> {
        self.channels.get(self.selected_channel).map(|c| c.id.as_str())
    }

    pub fn current_channel_name(&self) -> &str {
        self.channels
            .get(self.selected_channel)
            .map(|c| c.name.as_str())
            .unwrap_or("No channels")
    }

    pub async fn load_messages(&mut self) -> Result<()> {
        if let Some(channel_id) = self.current_channel_id().map(|s| s.to_string()) {
            self.messages = self.hub_client.get_messages(&channel_id).await?;
            self.seen_message_ids = self.messages.iter().map(|m| m.id.clone()).collect();
        }
        Ok(())
    }

    pub async fn run(
        &mut self,
        terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    ) -> Result<()> {
        // Load initial messages
        self.load_messages().await?;

        // Connect WebSocket
        let ws_stream = self.hub_client.connect_ws().await?;
        let (mut ws_tx, mut ws_rx) = ws_stream.split();

        // Subscribe to initial channel
        if let Some(channel_id) = self.current_channel_id().map(|s| s.to_string()) {
            ws_tx.send(HubClient::subscribe_msg(&channel_id)).await?;
        }

        let mut event_stream = EventStream::new();
        let mut tick = tokio::time::interval(Duration::from_millis(250));

        loop {
            terminal.draw(|f| ui::draw(f, self))?;

            tokio::select! {
                maybe_event = event_stream.next() => {
                    if let Some(Ok(Event::Key(key))) = maybe_event {
                        if key.kind != KeyEventKind::Press { continue; }
                        // Global: Ctrl+Q to quit
                        if key.code == KeyCode::Char('q') && key.modifiers.contains(KeyModifiers::CONTROL) {
                            self.should_quit = true;
                        }
                        // Global: Tab to cycle focus
                        else if key.code == KeyCode::Tab {
                            self.focus = self.focus.next();
                        }
                        // Focus-specific handling
                        else {
                            let old_channel = self.selected_channel;
                            input::handle_key(self, key).await?;

                            // Channel changed — reload messages and update WS subscription
                            if self.selected_channel != old_channel || self.channel_changed {
                                self.channel_changed = false;
                                if let Some(old_id) = self.channels.get(old_channel).map(|c| c.id.clone()) {
                                    ws_tx.send(HubClient::unsubscribe_msg(&old_id)).await?;
                                }
                                self.load_messages().await?;
                                if let Some(new_id) = self.current_channel_id().map(|s| s.to_string()) {
                                    ws_tx.send(HubClient::subscribe_msg(&new_id)).await?;
                                }
                            }
                        }
                    }
                }

                maybe_msg = ws_rx.next() => {
                    if let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) = maybe_msg {
                        if let Ok(server_msg) = serde_json::from_str::<WsServerMessage>(&text) {
                            // Only show messages for the current channel
                            if Some(server_msg.channel_id.as_str()) == self.current_channel_id() {
                                if !self.seen_message_ids.contains(&server_msg.message.id) {
                                    self.seen_message_ids.insert(server_msg.message.id.clone());
                                    self.messages.push(server_msg.message);
                                }
                            }
                        }
                    }
                }

                _ = tick.tick() => {}
            }

            if self.should_quit {
                break;
            }
        }

        Ok(())
    }
}
