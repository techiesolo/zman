//! Sends one fully resolved HTTP request and returns the whole response.
//!
//! The frontend substitutes variables, applies auth and picks the body, so
//! this module does no interpretation of its own: what is in [`RequestSpec`]
//! is what goes on the wire.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{multipart, redirect, Client, Method, Proxy, Url, Version};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// Responses larger than this are refused rather than held in memory.
pub const MAX_BODY_BYTES: usize = 100 * 1024 * 1024;

const MAX_REDIRECTS: usize = 10;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSpec {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: SpecBody,
    pub options: RequestOptions,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpecBody {
    None,
    Raw {
        text: String,
    },
    Urlencoded {
        fields: Vec<(String, String)>,
    },
    Formdata {
        parts: Vec<FormPart>,
    },
    /// The file at `path` is sent as the body.
    Binary {
        path: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FormPart {
    Text { name: String, value: String },
    File { name: String, path: String },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ProxySetting {
    /// Honour `HTTP_PROXY`, `HTTPS_PROXY` and the OS proxy settings.
    System,
    None,
    Custom {
        url: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptions {
    /// Limit for the whole exchange, body included. `0` means no limit.
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub verify_ssl: bool,
    pub proxy: ProxySetting,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    pub body: ResponseBody,
    /// Size of the body after decompression.
    pub size_bytes: u64,
    /// From sending the request to receiving the last byte of the body.
    pub time_ms: u64,
    /// Differs from the requested URL when redirects were followed.
    pub final_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResponseBody {
    Text {
        text: String,
    },
    /// Anything that is not text in a known encoding.
    Base64 {
        data: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Cancelled,
    Timeout,
    Connect,
    Tls,
    InvalidRequest,
    File,
    TooLarge,
    Other,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct HttpError {
    pub kind: ErrorKind,
    pub message: String,
}

impl HttpError {
    fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidRequest, message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ClientKey {
    follow_redirects: bool,
    verify_ssl: bool,
    proxy: ProxySetting,
}

/// Owns the connection pools, the session cookie jar and the set of requests
/// that can still be cancelled.
pub struct HttpEngine {
    jar: Mutex<Arc<Jar>>,
    /// Redirect, TLS and proxy behaviour are fixed per `reqwest::Client`, so
    /// one client is kept for each combination that has been used.
    clients: Mutex<HashMap<ClientKey, Client>>,
    in_flight: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Default for HttpEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Forgets the request when its future completes or is dropped.
struct InFlightGuard {
    map: Arc<Mutex<HashMap<String, CancellationToken>>>,
    id: String,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        self.map.lock().unwrap().remove(&self.id);
    }
}

impl HttpEngine {
    pub fn new() -> Self {
        Self {
            jar: Mutex::new(Arc::new(Jar::default())),
            clients: Mutex::new(HashMap::new()),
            in_flight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Sends the request. `id` is chosen by the caller and can be passed to
    /// [`HttpEngine::cancel`] while the request is running.
    pub async fn send(&self, id: &str, spec: RequestSpec) -> Result<ResponseData, HttpError> {
        let token = CancellationToken::new();
        self.in_flight
            .lock()
            .unwrap()
            .insert(id.to_owned(), token.clone());
        let _guard = InFlightGuard {
            map: self.in_flight.clone(),
            id: id.to_owned(),
        };

        tokio::select! {
            // Dropping the other branch closes the connection.
            _ = token.cancelled() => Err(HttpError::new(ErrorKind::Cancelled, "Request cancelled")),
            result = self.execute(spec) => result,
        }
    }

    /// Returns whether a running request with this id was found.
    pub fn cancel(&self, id: &str) -> bool {
        match self.in_flight.lock().unwrap().get(id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// Cookies live in memory only, for as long as the app runs or until
    /// this is called.
    pub fn clear_cookies(&self) {
        *self.jar.lock().unwrap() = Arc::new(Jar::default());
        // Existing clients still hold the old jar.
        self.clients.lock().unwrap().clear();
    }

    fn client_for(&self, options: &RequestOptions) -> Result<Client, HttpError> {
        let key = ClientKey {
            follow_redirects: options.follow_redirects,
            verify_ssl: options.verify_ssl,
            proxy: options.proxy.clone(),
        };
        let mut clients = self.clients.lock().unwrap();
        if let Some(client) = clients.get(&key) {
            return Ok(client.clone());
        }

        let mut builder = Client::builder()
            .cookie_provider(self.jar.lock().unwrap().clone())
            .redirect(if options.follow_redirects {
                redirect::Policy::limited(MAX_REDIRECTS)
            } else {
                redirect::Policy::none()
            })
            .danger_accept_invalid_certs(!options.verify_ssl)
            // Some servers wrongly treat header names as case-sensitive.
            .http1_title_case_headers();
        builder = match &options.proxy {
            ProxySetting::System => builder,
            ProxySetting::None => builder.no_proxy(),
            ProxySetting::Custom { url } => builder.proxy(
                Proxy::all(url.trim())
                    .map_err(|e| HttpError::invalid(format!("Invalid proxy URL: {e}")))?,
            ),
        };
        let client = builder.build().map_err(|e| {
            HttpError::new(
                ErrorKind::Other,
                format!("Could not set up the HTTP client: {}", describe(&e)),
            )
        })?;
        clients.insert(key, client.clone());
        Ok(client)
    }

    async fn execute(&self, spec: RequestSpec) -> Result<ResponseData, HttpError> {
        let method = Method::from_bytes(spec.method.trim().to_ascii_uppercase().as_bytes())
            .map_err(|_| HttpError::invalid(format!("Invalid HTTP method: {:?}", spec.method)))?;
        let url = Url::parse(spec.url.trim())
            .map_err(|e| HttpError::invalid(format!("Invalid URL: {e}")))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(HttpError::invalid(format!(
                "Unsupported URL scheme: {}",
                url.scheme()
            )));
        }

        let mut headers = HeaderMap::new();
        for (name, value) in &spec.headers {
            let header = HeaderName::from_bytes(name.trim().as_bytes())
                .map_err(|_| HttpError::invalid(format!("Invalid header name: {name:?}")))?;
            // `from_bytes` accepts UTF-8, which `from_str` would reject.
            let value = HeaderValue::from_bytes(value.trim().as_bytes())
                .map_err(|_| HttpError::invalid(format!("Invalid value for header {name:?}")))?;
            headers.append(header, value);
        }

        let client = self.client_for(&spec.options)?;
        let mut builder = client.request(method, url);
        match spec.body {
            SpecBody::None => builder = builder.headers(headers),
            SpecBody::Raw { text } => builder = builder.headers(headers).body(text),
            SpecBody::Urlencoded { fields } => {
                let mut encoder = url::form_urlencoded::Serializer::new(String::new());
                for (name, value) in &fields {
                    encoder.append_pair(name, value);
                }
                if !headers.contains_key(CONTENT_TYPE) {
                    headers.insert(
                        CONTENT_TYPE,
                        HeaderValue::from_static("application/x-www-form-urlencoded"),
                    );
                }
                builder = builder.headers(headers).body(encoder.finish());
            }
            SpecBody::Formdata { parts } => {
                let mut form = multipart::Form::new();
                for part in parts {
                    form = match part {
                        FormPart::Text { name, value } => form.text(name, value),
                        FormPart::File { name, path } => {
                            let bytes = read_file(&path).await?;
                            let file_name = Path::new(&path)
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_else(|| "file".to_owned());
                            let mime = mime_guess::from_path(&path).first_or_octet_stream();
                            let part = multipart::Part::bytes(bytes)
                                .file_name(file_name)
                                .mime_str(mime.as_ref())
                                .map_err(|e| HttpError::new(ErrorKind::Other, describe(&e)))?;
                            form.part(name, part)
                        }
                    };
                }
                // The boundary is generated here, so only the engine can
                // write a matching Content-Type.
                headers.remove(CONTENT_TYPE);
                builder = builder.headers(headers).multipart(form);
            }
            SpecBody::Binary { path } => {
                let bytes = read_file(&path).await?;
                builder = builder.headers(headers).body(bytes);
            }
        }
        if spec.options.timeout_ms > 0 {
            builder = builder.timeout(Duration::from_millis(spec.options.timeout_ms));
        }

        let started = Instant::now();
        let mut response = builder.send().await.map_err(classify)?;

        let status = response.status();
        let http_version = version_name(response.version()).to_owned();
        let final_url = response.url().to_string();
        let headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_owned(),
                    String::from_utf8_lossy(value.as_bytes()).into_owned(),
                )
            })
            .collect();
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);

        let mut bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(classify)? {
            if bytes.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(HttpError::new(
                    ErrorKind::TooLarge,
                    format!(
                        "The response is larger than {} MB and was not loaded.",
                        MAX_BODY_BYTES / (1024 * 1024)
                    ),
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let time_ms = started.elapsed().as_millis() as u64;

        Ok(ResponseData {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_owned(),
            http_version,
            headers,
            size_bytes: bytes.len() as u64,
            body: decode_body(bytes, content_type.as_deref()),
            time_ms,
            final_url,
        })
    }
}

async fn read_file(path: &str) -> Result<Vec<u8>, HttpError> {
    tokio::fs::read(path)
        .await
        .map_err(|e| HttpError::new(ErrorKind::File, format!("Could not read {path}: {e}")))
}

fn version_name(version: Version) -> &'static str {
    match version {
        Version::HTTP_09 => "HTTP/0.9",
        Version::HTTP_10 => "HTTP/1.0",
        Version::HTTP_11 => "HTTP/1.1",
        Version::HTTP_2 => "HTTP/2",
        Version::HTTP_3 => "HTTP/3",
        _ => "HTTP",
    }
}

/// The `charset` parameter of a Content-Type header, if any.
fn charset_of(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|param| {
        let (name, value) = param.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches('"'))
    })
}

/// Text comes back as a string, in whatever encoding the server declared;
/// everything else as base64 so it survives the trip to the webview intact.
pub fn decode_body(bytes: Vec<u8>, content_type: Option<&str>) -> ResponseBody {
    let declared = content_type
        .and_then(charset_of)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .filter(|encoding| *encoding != encoding_rs::UTF_8);
    if let Some(encoding) = declared {
        let (text, _, had_errors) = encoding.decode(&bytes);
        if !had_errors {
            return ResponseBody::Text {
                text: text.into_owned(),
            };
        }
    }
    match String::from_utf8(bytes) {
        Ok(text) => ResponseBody::Text { text },
        Err(not_utf8) => ResponseBody::Base64 {
            data: base64::engine::general_purpose::STANDARD.encode(not_utf8.as_bytes()),
        },
    }
}

/// Joins an error with its causes, skipping causes that only repeat what
/// was already said.
fn describe(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.is_empty() && !message.contains(&text) {
            message.push_str(": ");
            message.push_str(&text);
        }
        source = cause.source();
    }
    message
}

fn classify(error: reqwest::Error) -> HttpError {
    // The URL is already on screen, and without it the message is shorter.
    let error = error.without_url();
    let detail = describe(&error);
    let lower = detail.to_ascii_lowercase();
    let tls = ["certificate", "tls", "ssl", "handshake"]
        .iter()
        .any(|word| lower.contains(word));

    if error.is_timeout() {
        HttpError::new(ErrorKind::Timeout, "The request timed out.")
    } else if error.is_redirect() {
        HttpError::new(
            ErrorKind::Other,
            format!("Stopped after {MAX_REDIRECTS} redirects."),
        )
    } else if tls {
        HttpError::new(ErrorKind::Tls, format!("TLS error: {detail}"))
    } else if error.is_connect() {
        let cause = innermost(&error);
        HttpError::new(ErrorKind::Connect, format!("Could not connect: {cause}"))
    } else if error.is_builder() {
        HttpError::invalid(detail)
    } else {
        HttpError::new(ErrorKind::Other, detail)
    }
}

fn innermost(error: &reqwest::Error) -> String {
    let mut current: &(dyn std::error::Error + 'static) = error;
    while let Some(next) = current.source() {
        current = next;
    }
    current.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_as_text() {
        let body = decode_body(
            "xin chào".as_bytes().to_vec(),
            Some("text/plain; charset=utf-8"),
        );
        assert_eq!(
            body,
            ResponseBody::Text {
                text: "xin chào".into()
            }
        );
    }

    #[test]
    fn decodes_declared_legacy_charset() {
        // "café" in ISO-8859-1 is not valid UTF-8.
        let body = decode_body(
            vec![b'c', b'a', b'f', 0xE9],
            Some("text/html; charset=ISO-8859-1"),
        );
        assert_eq!(
            body,
            ResponseBody::Text {
                text: "café".into()
            }
        );
    }

    #[test]
    fn falls_back_to_base64_for_binary() {
        let png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(
            decode_body(png, Some("image/png")),
            ResponseBody::Base64 {
                data: "iVBORw0KGgo=".into()
            }
        );
    }

    #[test]
    fn reads_charset_parameter() {
        assert_eq!(
            charset_of("text/html; charset=\"Shift_JIS\""),
            Some("Shift_JIS")
        );
        assert_eq!(charset_of("application/json"), None);
    }

    #[test]
    fn spec_matches_the_frontend_wire_format() {
        let spec: RequestSpec = serde_json::from_str(
            r#"{
                "method": "POST",
                "url": "http://localhost/x",
                "headers": [["A", "1"]],
                "body": {"kind": "formdata", "parts": [
                    {"kind": "text", "name": "a", "value": "b"},
                    {"kind": "file", "name": "f", "path": "/tmp/x"}
                ]},
                "options": {"timeoutMs": 5, "followRedirects": true, "verifySsl": false, "proxy": {"mode": "custom", "url": "http://p:1"}}
            }"#,
        )
        .unwrap();
        assert_eq!(spec.options.timeout_ms, 5);
        assert_eq!(
            spec.options.proxy,
            ProxySetting::Custom {
                url: "http://p:1".into()
            }
        );
        assert!(matches!(spec.body, SpecBody::Formdata { ref parts } if parts.len() == 2));

        let error = serde_json::to_value(HttpError::invalid("x")).unwrap();
        assert_eq!(
            error,
            serde_json::json!({"kind": "invalidRequest", "message": "x"})
        );
    }
}
