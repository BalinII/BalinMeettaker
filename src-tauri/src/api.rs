use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioResponse {
    success: bool,
    transcription: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    success: bool,
    message: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Model {
    provider: String,
    name: String,
    id: String,
    model: String,
    description: String,
    modality: String,
    #[serde(rename = "isAvailable")]
    is_available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemPromptResponse {
    prompt_name: String,
    system_prompt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptLibraryItem {
    title: String,
    prompt: String,
    #[serde(rename = "modelId")]
    model_id: String,
    #[serde(rename = "modelName")]
    model_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PromptLibraryResponse {
    prompts: Vec<PromptLibraryItem>,
    total: i32,
    #[serde(rename = "last_updated")]
    last_updated: Option<String>,
}

fn remote_disabled_message() -> String {
    "MinuteSmith is configured as a local-first prototype. Remote hosted API calls are disabled; configure local custom providers in Dev Space instead.".to_string()
}

#[tauri::command]
pub async fn transcribe_audio(
    _app: AppHandle,
    _audio_base64: String,
) -> Result<AudioResponse, String> {
    Err(remote_disabled_message())
}

#[tauri::command]
pub async fn chat_stream_response(
    _app: AppHandle,
    _user_message: String,
    _system_prompt: Option<String>,
    _image_base64: Option<serde_json::Value>,
    _history: Option<String>,
) -> Result<String, String> {
    Err(remote_disabled_message())
}

#[tauri::command]
pub async fn fetch_models(_app: AppHandle) -> Result<Vec<Model>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn fetch_prompts() -> Result<PromptLibraryResponse, String> {
    Ok(PromptLibraryResponse {
        prompts: Vec::new(),
        total: 0,
        last_updated: None,
    })
}

#[tauri::command]
pub async fn create_system_prompt(
    _app: AppHandle,
    user_prompt: String,
) -> Result<SystemPromptResponse, String> {
    Ok(SystemPromptResponse {
        prompt_name: "Custom prompt".to_string(),
        system_prompt: user_prompt,
    })
}

#[tauri::command]
pub async fn check_license_status(_app: AppHandle) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn get_activity(_app: AppHandle) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "success": true,
        "data": [],
        "total_tokens_used": 0
    }))
}
