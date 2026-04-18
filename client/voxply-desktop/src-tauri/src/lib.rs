// lib.rs — Tauri backend. This is the Rust code that runs natively.
// The React frontend calls these functions via "commands" (like JS interop in Blazor).

// A Tauri "command" — callable from the frontend via invoke("greet", { name: "Alice" })
// In Blazor terms: this is like a [JSInvokable] method that JS can call.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Voxply.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
