use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, ListState, Paragraph};

use crate::app::{App, Focus};

pub fn draw(f: &mut Frame, app: &App) {
    // Split: top area (channels + messages) and bottom (input)
    let main_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(5), Constraint::Length(3)])
        .split(f.area());

    // Split top: channels sidebar (20%) and messages (80%)
    let top_layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(20), Constraint::Percentage(80)])
        .split(main_layout[0]);

    // Channel list
    let channel_items: Vec<ListItem> = app
        .channels
        .iter()
        .map(|c| ListItem::new(format!("# {}", c.name)))
        .collect();

    let channel_block = Block::default()
        .title(" Channels ")
        .borders(Borders::ALL)
        .border_style(if app.focus == Focus::Channels {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let channel_list = List::new(channel_items)
        .block(channel_block)
        .highlight_style(Style::default().add_modifier(Modifier::BOLD).fg(Color::Cyan))
        .highlight_symbol("▸ ");

    let mut channel_state = ListState::default();
    channel_state.select(Some(app.selected_channel));
    f.render_stateful_widget(channel_list, top_layout[0], &mut channel_state);

    // Messages
    let message_lines: Vec<Line> = app
        .messages
        .iter()
        .map(|m| {
            let name = m
                .sender_name
                .as_deref()
                .unwrap_or_else(|| &m.sender[..16]);
            Line::from(vec![
                Span::styled(
                    format!("{name}: "),
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                ),
                Span::raw(&m.content),
            ])
        })
        .collect();

    let messages_block = Block::default()
        .title(format!(" #{} ", app.current_channel_name()))
        .borders(Borders::ALL)
        .border_style(if app.focus == Focus::Messages {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let messages_widget = Paragraph::new(message_lines)
        .block(messages_block)
        .scroll((
            app.messages
                .len()
                .saturating_sub(main_layout[0].height as usize - 2) as u16,
            0,
        ));

    f.render_widget(messages_widget, top_layout[1]);

    // Input
    let input_block = Block::default()
        .title(" Message ")
        .borders(Borders::ALL)
        .border_style(if app.focus == Focus::Input {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let input_text = if app.input_buffer.is_empty() && app.focus != Focus::Input {
        Paragraph::new("Tab to type | /create <name> to add channel").style(Style::default().fg(Color::DarkGray))
    } else {
        Paragraph::new(app.input_buffer.as_str())
    };

    f.render_widget(input_text.block(input_block), main_layout[1]);

    // Show cursor in input when focused
    if app.focus == Focus::Input {
        f.set_cursor_position((
            main_layout[1].x + app.input_buffer.len() as u16 + 1,
            main_layout[1].y + 1,
        ));
    }
}
