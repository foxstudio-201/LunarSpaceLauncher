use crate::models::Progress;
use anyhow::{anyhow, Result};
use futures_util::{StreamExt, stream::FuturesUnordered};
use once_cell::sync::Lazy;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

pub const USER_AGENT: &str = "XyoLauncher/2.0.0";

static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .pool_max_idle_per_host(24)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

pub fn client() -> &'static reqwest::Client {
    &CLIENT
}

#[derive(Clone, Debug)]
pub struct DownloadTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: u64,
    pub skip_hash: bool,
    pub name: String,
}

impl DownloadTask {
    pub fn new(url: impl Into<String>, dest: impl Into<PathBuf>) -> Self {
        Self {
            url: url.into(),
            dest: dest.into(),
            sha1: None,
            size: 0,
            skip_hash: false,
            name: String::new(),
        }
    }

    pub fn with_sha1(mut self, sha1: Option<String>) -> Self {
        self.sha1 = sha1;
        self
    }

    pub fn with_size(mut self, size: u64) -> Self {
        self.size = size;
        self
    }
}

pub type ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>;

pub struct DownloadReport {
    pub total: usize,
    pub skipped: usize,
    pub bytes: u64,
    pub errors: Vec<(PathBuf, String)>,
}

pub async fn fetch_json(url: &str) -> Result<Value> {
    fetch_json_retry(url, 3).await
}

pub async fn fetch_json_retry(url: &str, tries: u32) -> Result<Value> {
    let mut last = anyhow!("lỗi không xác định");
    for attempt in 0..tries {
        match CLIENT
            .get(url)
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(res) => {
                if !res.status().is_success() {
                    last = anyhow!("HTTP {} cho {}", res.status(), url);
                } else {
                    match res.json::<Value>().await {
                        Ok(value) => return Ok(value),
                        Err(err) => last = anyhow!("JSON lỗi: {err}"),
                    }
                }
            }
            Err(err) => last = anyhow!("{err}"),
        }
        if attempt + 1 < tries {
            tokio::time::sleep(Duration::from_millis(250 * 3u64.pow(attempt))).await;
        }
    }
    Err(last)
}

pub async fn fetch_text(url: &str) -> Result<String> {
    let res = CLIENT.get(url).send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("HTTP {} cho {}", res.status(), url));
    }
    Ok(res.text().await?)
}

pub async fn fetch_bytes(url: &str, max: usize) -> Result<Vec<u8>> {
    let res = CLIENT.get(url).send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("HTTP {} cho {}", res.status(), url));
    }
    let bytes = res.bytes().await?;
    if bytes.len() > max {
        return Err(anyhow!("Tệp quá lớn"));
    }
    Ok(bytes.to_vec())
}

pub async fn is_fresh(task: &DownloadTask) -> bool {
    let Ok(meta) = tokio::fs::metadata(&task.dest).await else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    if task.size > 0 && meta.len() != task.size {
        return false;
    }
    if task.skip_hash {
        return true;
    }
    let Some(expected) = task.sha1.as_deref().filter(|v| !v.is_empty()) else {
        return true;
    };
    crate::util::sha1_file(&task.dest)
        .await
        .map(|hash| hash.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

async fn stream_download(task: &DownloadTask, on_delta: Arc<dyn Fn(u64) + Send + Sync>) -> Result<u64> {
    if let Some(parent) = task.dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let temp = task.dest.with_extension(format!(
        "{}part",
        task.dest
            .extension()
            .map(|v| format!("{}.", v.to_string_lossy()))
            .unwrap_or_default()
    ));
    let res = CLIENT.get(&task.url).send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("HTTP {} cho {}", res.status(), task.url));
    }
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    let mut total = 0u64;
    let mut file = tokio::fs::File::create(&temp).await?;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        total += chunk.len() as u64;
        on_delta(chunk.len() as u64);
    }
    file.flush().await?;
    drop(file);
    if let Some(expected) = task.sha1.as_deref().filter(|v| !v.is_empty()) {
        let actual = crate::util::hex(&hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(anyhow!("Sai checksum {}", task.dest.display()));
        }
    }
    let _ = tokio::fs::remove_file(&task.dest).await;
    tokio::fs::rename(&temp, &task.dest).await?;
    Ok(total)
}

async fn download_with_retry(task: &DownloadTask, on_delta: Arc<dyn Fn(u64) + Send + Sync>) -> Result<u64> {
    let mut last = anyhow!("download failed");
    for attempt in 0..3u32 {
        match stream_download(task, on_delta.clone()).await {
            Ok(bytes) => return Ok(bytes),
            Err(err) => last = err,
        }
        tokio::time::sleep(Duration::from_millis(300 * 3u64.pow(attempt))).await;
    }
    Err(last)
}

pub async fn download_all(
    tasks: Vec<DownloadTask>,
    concurrency: usize,
    progress: Option<ProgressFn>,
    label: &str,
    force: bool,
) -> DownloadReport {
    let total = tasks.len();
    let total_bytes: u64 = tasks.iter().map(|t| t.size).sum();
    let done = Arc::new(AtomicUsize::new(0));
    let skipped = Arc::new(AtomicUsize::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let skipped_bytes = Arc::new(AtomicU64::new(0));
    let errors: Arc<parking_lot::Mutex<Vec<(PathBuf, String)>>> =
        Arc::new(parking_lot::Mutex::new(Vec::new()));
    let last_emit = Arc::new(parking_lot::Mutex::new(Instant::now() - Duration::from_secs(1)));
    let emit: Arc<dyn Fn(String, bool) + Send + Sync> = {
        let progress = progress.clone();
        let done = done.clone();
        let skipped = skipped.clone();
        let bytes = bytes.clone();
        let skipped_bytes = skipped_bytes.clone();
        let last_emit = last_emit.clone();
        let label = label.to_string();
        Arc::new(move |file: String, final_chunk: bool| {
            let Some(cb) = progress.as_ref() else { return };
            let now = Instant::now();
            {
                let mut last = last_emit.lock();
                if !final_chunk && now.duration_since(*last) < Duration::from_millis(90) {
                    return;
                }
                *last = now;
            }
            let done = done.load(Ordering::Relaxed) as u64;
            let skipped = skipped.load(Ordering::Relaxed) as u64;
            let bytes = bytes.load(Ordering::Relaxed);
            let skipped_bytes = skipped_bytes.load(Ordering::Relaxed);
            cb(Progress {
                label: label.clone(),
                done,
                total: total as u64,
                bytes,
                total_bytes,
                bytes_done: (bytes + skipped_bytes).min(if total_bytes == 0 { u64::MAX } else { total_bytes }),
                skipped,
                file,
                final_chunk,
            });
        })
    };
    let queue = Arc::new(parking_lot::Mutex::new(tasks.into_iter().enumerate()));
    let mut futs = FuturesUnordered::new();
    let workers = concurrency.max(1);
    for _ in 0..workers {
        let queue = queue.clone();
        let done = done.clone();
        let skipped = skipped.clone();
        let bytes = bytes.clone();
        let skipped_bytes = skipped_bytes.clone();
        let errors = errors.clone();
        let emit = emit.clone();
        futs.push(async move {
            loop {
                let next = { queue.lock().next() };
                let Some((_, task)) = next else { break };
                let display = if task.name.is_empty() {
                    task.dest
                        .file_name()
                        .map(|v| v.to_string_lossy().into_owned())
                        .unwrap_or_default()
                } else {
                    task.name.clone()
                };
                if !force && is_fresh(&task).await {
                    skipped.fetch_add(1, Ordering::Relaxed);
                    skipped_bytes.fetch_add(task.size, Ordering::Relaxed);
                } else {
                    let counter = bytes.clone();
                    let emit_delta = emit.clone();
                    let name = display.clone();
                    let delta_cb: Arc<dyn Fn(u64) + Send + Sync> = Arc::new(move |delta: u64| {
                        counter.fetch_add(delta, Ordering::Relaxed);
                        emit_delta(name.clone(), false);
                    });
                    if let Err(err) = download_with_retry(&task, delta_cb).await {
                        errors.lock().push((task.dest.clone(), err.to_string()));
                    }
                }
                done.fetch_add(1, Ordering::Relaxed);
                emit(display, false);
            }
        });
    }
    while futs.next().await.is_some() {}
    emit(String::new(), true);
    let errors = errors.lock().clone();
    DownloadReport {
        total,
        skipped: skipped.load(Ordering::Relaxed),
        bytes: bytes.load(Ordering::Relaxed),
        errors,
    }
}

pub async fn download_one(
    url: &str,
    dest: &Path,
    sha1: Option<&str>,
    on_delta: Arc<dyn Fn(u64) + Send + Sync>,
) -> Result<u64> {
    let task = DownloadTask {
        url: url.to_string(),
        dest: dest.to_path_buf(),
        sha1: sha1.map(str::to_string),
        size: 0,
        skip_hash: sha1.is_none(),
        name: String::new(),
    };
    download_with_retry(&task, on_delta).await
}

pub fn join_url(base: &str, rel: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        rel.trim_start_matches('/').replace('\\', "/")
    )
}
