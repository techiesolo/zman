//! Drives the HTTP engine against a server on localhost.

use std::io::Write as _;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::Multipart;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Redirect};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use zman_core::http::{
    ErrorKind, FormPart, HttpEngine, ProxySetting, RequestOptions, RequestSpec, ResponseBody,
    ResponseData, SpecBody,
};

async fn echo(method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Json<Value> {
    let headers: Vec<(String, String)> = headers
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    Json(json!({
        "method": method.as_str(),
        "path": uri.path(),
        "query": uri.query(),
        "headers": headers,
        "body": String::from_utf8_lossy(&body),
        "bodyBytes": body.to_vec(),
    }))
}

async fn upload(mut multipart: Multipart) -> Json<Value> {
    let mut parts = Vec::new();
    while let Some(field) = multipart.next_field().await.unwrap() {
        let name = field.name().map(str::to_owned);
        let file_name = field.file_name().map(str::to_owned);
        let content_type = field.content_type().map(str::to_owned);
        let text = String::from_utf8_lossy(&field.bytes().await.unwrap()).into_owned();
        parts.push(
            json!({"name": name, "fileName": file_name, "contentType": content_type, "text": text}),
        );
    }
    Json(json!(parts))
}

async fn gzip() -> impl IntoResponse {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all("compressed ".repeat(100).as_bytes())
        .unwrap();
    (
        [
            (header::CONTENT_ENCODING, "gzip"),
            (header::CONTENT_TYPE, "text/plain"),
        ],
        encoder.finish().unwrap(),
    )
}

async fn slow() -> &'static str {
    tokio::time::sleep(Duration::from_secs(30)).await;
    "late"
}

fn app() -> Router {
    Router::new()
        .route("/echo", any(echo))
        .route("/upload", post(upload))
        .route("/gzip", get(gzip))
        .route("/slow", get(slow))
        .route(
            "/redirect",
            get(|| async { Redirect::to("/echo?from=redirect") }),
        )
        .route("/loop", get(|| async { Redirect::to("/loop") }))
        .route(
            "/missing",
            get(|| async { (StatusCode::NOT_FOUND, "nope") }),
        )
        .route(
            "/binary",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "application/octet-stream")],
                    (0..=255u8).collect::<Vec<u8>>(),
                )
            }),
        )
        .route(
            "/latin1",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/plain; charset=iso-8859-1")],
                    vec![b'c', b'a', b'f', 0xE9],
                )
            }),
        )
        .route(
            "/set-cookie",
            get(|| async { ([(header::SET_COOKIE, "session=abc; Path=/")], "ok") }),
        )
}

async fn serve() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app()).await.unwrap() });
    format!("http://{addr}")
}

fn spec(method: &str, url: String) -> RequestSpec {
    RequestSpec {
        method: method.to_owned(),
        url,
        headers: Vec::new(),
        body: SpecBody::None,
        options: RequestOptions {
            timeout_ms: 10_000,
            follow_redirects: true,
            verify_ssl: true,
            // Keeps a proxy configured on the test machine out of the way.
            proxy: ProxySetting::None,
        },
    }
}

fn text(response: &ResponseData) -> &str {
    match &response.body {
        ResponseBody::Text { text } => text,
        ResponseBody::Base64 { .. } => panic!("expected a text body"),
    }
}

fn echoed(response: &ResponseData) -> Value {
    serde_json::from_str(text(response)).unwrap()
}

fn echoed_header(echo: &Value, name: &str) -> Option<String> {
    echo["headers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pair| pair[0].as_str().unwrap().eq_ignore_ascii_case(name))
        .map(|pair| pair[1].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn get_returns_status_headers_and_body() {
    let base = serve().await;
    let engine = HttpEngine::new();
    let mut request = spec("get", format!("{base}/echo?a=1&b=two"));
    request.headers = vec![
        ("X-Custom".into(), "xin chào".into()),
        ("Accept".into(), "*/*".into()),
    ];

    let response = engine.send("1", request).await.unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.status_text, "OK");
    assert_eq!(response.http_version, "HTTP/1.1");
    assert_eq!(response.final_url, format!("{base}/echo?a=1&b=two"));
    assert_eq!(response.size_bytes as usize, text(&response).len());
    assert!(response
        .headers
        .iter()
        .any(|(k, v)| k == "content-type" && v == "application/json"));

    let echo = echoed(&response);
    assert_eq!(echo["method"], "GET");
    assert_eq!(echo["query"], "a=1&b=two");
    assert_eq!(
        echoed_header(&echo, "x-custom").as_deref(),
        Some("xin chào")
    );
    // Nothing is sent that the spec did not ask for.
    assert_eq!(echoed_header(&echo, "user-agent"), None);
}

#[tokio::test]
async fn error_statuses_are_responses_not_errors() {
    let base = serve().await;
    let response = HttpEngine::new()
        .send("1", spec("GET", format!("{base}/missing")))
        .await
        .unwrap();
    assert_eq!(response.status, 404);
    assert_eq!(response.status_text, "Not Found");
    assert_eq!(text(&response), "nope");
}

#[tokio::test]
async fn sends_raw_body_with_given_content_type() {
    let base = serve().await;
    let mut request = spec("POST", format!("{base}/echo"));
    request.headers = vec![("Content-Type".into(), "application/json".into())];
    request.body = SpecBody::Raw {
        text: "{\"name\":\"Lan\"}".into(),
    };

    let echo = echoed(&HttpEngine::new().send("1", request).await.unwrap());
    assert_eq!(echo["method"], "POST");
    assert_eq!(echo["body"], "{\"name\":\"Lan\"}");
    assert_eq!(
        echoed_header(&echo, "content-type").as_deref(),
        Some("application/json")
    );
}

#[tokio::test]
async fn encodes_urlencoded_fields() {
    let base = serve().await;
    let mut request = spec("PUT", format!("{base}/echo"));
    request.body = SpecBody::Urlencoded {
        fields: vec![
            ("name".into(), "Ann Lee".into()),
            ("q".into(), "a&b=c".into()),
            ("name".into(), "é".into()),
        ],
    };

    let echo = echoed(&HttpEngine::new().send("1", request).await.unwrap());
    assert_eq!(echo["body"], "name=Ann+Lee&q=a%26b%3Dc&name=%C3%A9");
    assert_eq!(
        echoed_header(&echo, "content-type").as_deref(),
        Some("application/x-www-form-urlencoded")
    );
}

#[tokio::test]
async fn sends_multipart_text_and_file_parts() {
    let base = serve().await;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("notes.txt");
    std::fs::write(&file, "file contents").unwrap();

    let mut request = spec("POST", format!("{base}/upload"));
    // A stale hand-written Content-Type must not override the generated one.
    request.headers = vec![(
        "Content-Type".into(),
        "multipart/form-data; boundary=wrong".into(),
    )];
    request.body = SpecBody::Formdata {
        parts: vec![
            FormPart::Text {
                name: "title".into(),
                value: "Báo cáo".into(),
            },
            FormPart::File {
                name: "attachment".into(),
                path: file.to_string_lossy().into_owned(),
            },
        ],
    };

    let response = HttpEngine::new().send("1", request).await.unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(
        echoed(&response),
        json!([
            {"name": "title", "fileName": null, "contentType": null, "text": "Báo cáo"},
            {"name": "attachment", "fileName": "notes.txt", "contentType": "text/plain", "text": "file contents"},
        ])
    );
}

#[tokio::test]
async fn sends_file_as_binary_body() {
    let base = serve().await;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("data.bin");
    std::fs::write(&file, [0u8, 159, 146, 150, 255]).unwrap();

    let mut request = spec("POST", format!("{base}/echo"));
    request.body = SpecBody::Binary {
        path: file.to_string_lossy().into_owned(),
    };

    let echo = echoed(&HttpEngine::new().send("1", request).await.unwrap());
    assert_eq!(echo["bodyBytes"], json!([0, 159, 146, 150, 255]));
}

#[tokio::test]
async fn missing_file_is_reported_before_anything_is_sent() {
    let base = serve().await;
    let mut request = spec("POST", format!("{base}/echo"));
    request.body = SpecBody::Binary {
        path: "/definitely/not/here.bin".into(),
    };

    let error = HttpEngine::new().send("1", request).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::File);
    assert!(
        error.message.contains("/definitely/not/here.bin"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn follows_redirects_only_when_asked() {
    let base = serve().await;
    let engine = HttpEngine::new();

    let followed = engine
        .send("1", spec("GET", format!("{base}/redirect")))
        .await
        .unwrap();
    assert_eq!(followed.status, 200);
    assert_eq!(followed.final_url, format!("{base}/echo?from=redirect"));

    let mut request = spec("GET", format!("{base}/redirect"));
    request.options.follow_redirects = false;
    let stopped = engine.send("2", request).await.unwrap();
    assert_eq!(stopped.status, 303);
    assert!(stopped
        .headers
        .iter()
        .any(|(k, v)| k == "location" && v == "/echo?from=redirect"));
}

#[tokio::test]
async fn gives_up_on_redirect_loops() {
    let base = serve().await;
    let error = HttpEngine::new()
        .send("1", spec("GET", format!("{base}/loop")))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Other);
    assert!(error.message.contains("redirects"), "{}", error.message);
}

#[tokio::test]
async fn decompresses_gzip() {
    let base = serve().await;
    let response = HttpEngine::new()
        .send("1", spec("GET", format!("{base}/gzip")))
        .await
        .unwrap();
    let expected = "compressed ".repeat(100);
    assert_eq!(text(&response), expected);
    assert_eq!(response.size_bytes as usize, expected.len());
}

#[tokio::test]
async fn returns_binary_as_base64_and_legacy_text_as_text() {
    let base = serve().await;
    let engine = HttpEngine::new();

    let binary = engine
        .send("1", spec("GET", format!("{base}/binary")))
        .await
        .unwrap();
    assert_eq!(binary.size_bytes, 256);
    let ResponseBody::Base64 { data } = &binary.body else {
        panic!("expected base64")
    };
    assert!(data.starts_with("AAECAwQFBgc"), "{data}");

    let latin1 = engine
        .send("2", spec("GET", format!("{base}/latin1")))
        .await
        .unwrap();
    assert_eq!(text(&latin1), "café");
    assert_eq!(latin1.size_bytes, 4);
}

#[tokio::test]
async fn times_out() {
    let base = serve().await;
    let mut request = spec("GET", format!("{base}/slow"));
    request.options.timeout_ms = 200;

    let error = HttpEngine::new().send("1", request).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Timeout);
}

#[tokio::test]
async fn cancels_a_running_request() {
    let base = serve().await;
    let engine = Arc::new(HttpEngine::new());
    assert!(!engine.cancel("slow"));

    let running = tokio::spawn({
        let engine = engine.clone();
        let mut request = spec("GET", format!("{base}/slow"));
        request.options.timeout_ms = 0;
        async move { engine.send("slow", request).await }
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(engine.cancel("slow"));

    let error = tokio::time::timeout(Duration::from_secs(5), running)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Cancelled);
    // A finished request can no longer be cancelled.
    assert!(!engine.cancel("slow"));
}

#[tokio::test]
async fn reports_refused_connections() {
    // Bind and release a port so that nothing is listening on it.
    let port = {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        listener.local_addr().unwrap().port()
    };
    let error = HttpEngine::new()
        .send("1", spec("GET", format!("http://127.0.0.1:{port}/")))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Connect);
    assert!(
        error.message.starts_with("Could not connect"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn rejects_requests_that_cannot_be_sent() {
    let base = serve().await;
    let engine = HttpEngine::new();

    let error = engine
        .send("1", spec("BAD METHOD", format!("{base}/echo")))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidRequest);

    let error = engine
        .send("2", spec("GET", "ftp://example.test/file".into()))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidRequest);

    let error = engine
        .send("3", spec("GET", "not a url".into()))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidRequest);

    let mut request = spec("GET", format!("{base}/echo"));
    request.headers = vec![("Bad Name".into(), "x".into())];
    assert_eq!(
        engine.send("4", request).await.unwrap_err().kind,
        ErrorKind::InvalidRequest
    );

    let mut request = spec("GET", format!("{base}/echo"));
    request.options.proxy = ProxySetting::Custom {
        url: "http://[not-an-address".into(),
    };
    assert_eq!(
        engine.send("5", request).await.unwrap_err().kind,
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn keeps_cookies_for_the_session_until_cleared() {
    let base = serve().await;
    let engine = HttpEngine::new();
    engine
        .send("1", spec("GET", format!("{base}/set-cookie")))
        .await
        .unwrap();

    let echo = echoed(
        &engine
            .send("2", spec("GET", format!("{base}/echo")))
            .await
            .unwrap(),
    );
    assert_eq!(
        echoed_header(&echo, "cookie").as_deref(),
        Some("session=abc")
    );

    // A different redirect setting uses another client but the same jar.
    let mut request = spec("GET", format!("{base}/echo"));
    request.options.follow_redirects = false;
    let echo = echoed(&engine.send("3", request).await.unwrap());
    assert_eq!(
        echoed_header(&echo, "cookie").as_deref(),
        Some("session=abc")
    );

    engine.clear_cookies();
    let echo = echoed(
        &engine
            .send("4", spec("GET", format!("{base}/echo")))
            .await
            .unwrap(),
    );
    assert_eq!(echoed_header(&echo, "cookie"), None);
}
