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
use crate::protocol::{ChannelResponse, MessageResponse, VoiceParticipantInfo, WsServerMessage};
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
    pub voice_channel: Option<String>,
    pub voice_participants: Vec<VoiceParticipantInfo>,
    pub voice_hub_port: Option<u16>,
    pub voice_pipeline: Option<voxply_voice::AudioPipeline>,
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
            voice_channel: None,
            voice_participants: Vec::new(),
            voice_hub_port: None,
            voice_pipeline: None,
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

    pub fn is_in_voice(&self) -> bool {
        self.voice_channel.is_some()
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
        self.load_messages().await?;

        let ws_stream = self.hub_client.connect_ws().await?;
        let (mut ws_tx, mut ws_rx) = ws_stream.split();

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
                        if key.code == KeyCode::Char('q') && key.modifiers.contains(KeyModifiers::CONTROL) {
                            self.should_quit = true;
                        }
                        else if key.code == KeyCode::Tab {
                            self.focus = self.focus.next();
                        }
                        else {
                            let old_channel = self.selected_channel;
                            input::handle_key(self, &mut ws_tx, key).await?;

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
                            match server_msg {
                                WsServerMessage::ChatMessage { channel_id, message } => {
                                    if Some(channel_id.as_str()) == self.current_channel_id() {
                                        if !self.seen_message_ids.contains(&message.id) {
                                            self.seen_message_ids.insert(message.id.clone());
                                            self.messages.push(message);
                                        }
                                    }
                                }
                                WsServerMessage::VoiceJoined { hub_udp_port, participants, .. } => {
                                    self.voice_hub_port = Some(hub_udp_port);
                                    self.voice_participants = participants;
                                }
                                WsServerMessage::VoiceParticipantJoined { participant, .. } => {
                                    self.voice_participants.push(participant);
                                }
                                WsServerMessage::VoiceParticipantLeft { public_key, .. } => {
                                    self.voice_participants.retain(|p| p.public_key != public_key);
                                }
                            }
                        }
                    }
                }

                _ = tick.tick() => {}
            }

            if self.should_quit {
                if let Some(pipeline) = self.voice_pipeline.take() {
                    pipeline.stop().await;
                }
                break;
            }
        }

        Ok(())
    }
}
