// No console window: Task Scheduler runs this every few minutes.
#![windows_subsystem = "windows"]
//! hzmm-report-pull — fetches HZMM problem reports from the report inbox
//! (report-inbox/worker) into a folder on this PC, then removes them from
//! the inbox.
//!
//!   hzmm-report-pull           pull every waiting report (the scheduled task runs this)
//!   hzmm-report-pull keygen    create the signing key; writes puller.pub
//!   hzmm-report-pull pubkey    write puller.pub again from the existing key
//!
//! Next to the exe: puller.json ({ "endpoint": "https://…", "reportsDir": "…" }),
//! puller.key (the Ed25519 signing key, never leaves this PC) and puller.pub
//! (its public half, the Worker's PULLER_PUBLIC_KEY). A run that saved
//! something or failed appends one line to pull.log in the reports folder.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use flate2::read::GzDecoder;
use serde::Deserialize;
use serde_json::Value;

/// A gzipped report as downloaded; the inbox refuses anything over 512 KiB.
const MAX_REPORT_BYTES: u64 = 1024 * 1024;
/// The report once unzipped.
const MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;

const SECTIONS: [(&str, &str); 8] = [
    ("context", "Error"),
    ("app", "HZMM and Windows"),
    ("hw", "Hardware"),
    ("disk", "Temp folder and HZMM location"),
    ("av", "Antivirus"),
    ("game", "Game and UE4SS"),
    ("mods", "Installed mods"),
    ("log", "HZMM log"),
];

type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    endpoint: String,
    reports_dir: PathBuf,
}

#[derive(Deserialize)]
struct Listing {
    reports: Vec<Listed>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Listed {
    key: String,
    #[serde(default)]
    received_at: Option<String>,
}

fn main() -> ExitCode {
    let dir = match std::env::current_exe() {
        Ok(exe) => exe.parent().map(Path::to_path_buf).unwrap_or_default(),
        Err(e) => {
            eprintln!("cannot find own path: {e}");
            return ExitCode::FAILURE;
        }
    };
    let command = std::env::args().nth(1);
    let result = match command.as_deref() {
        None | Some("pull") => pull(&dir),
        Some("keygen") => keygen(&dir),
        Some("pubkey") => load_key(&dir).and_then(|key| write_public_key(&dir, &key)),
        Some(other) => Err(format!("unknown command: {other} (use pull, keygen or pubkey)")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

// --- keys -----------------------------------------------------------------

fn keygen(dir: &Path) -> Result<()> {
    let path = dir.join("puller.key");
    if path.exists() {
        return Err(format!("{} already exists; not replacing it", path.display()));
    }
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).map_err(|e| format!("no randomness available: {e}"))?;
    fs::write(&path, B64.encode(seed)).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    write_public_key(dir, &SigningKey::from_bytes(&seed))
}

fn load_key(dir: &Path) -> Result<SigningKey> {
    let path = dir.join("puller.key");
    let raw = fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e} (run keygen first)", path.display()))?;
    let bytes = B64.decode(raw.trim()).map_err(|_| format!("{} is not base64", path.display()))?;
    let seed: [u8; 32] = bytes.try_into().map_err(|_| format!("{} does not hold a 32-byte key", path.display()))?;
    Ok(SigningKey::from_bytes(&seed))
}

fn write_public_key(dir: &Path, key: &SigningKey) -> Result<()> {
    let public = B64.encode(key.verifying_key().to_bytes());
    let path = dir.join("puller.pub");
    fs::write(&path, &public).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    println!("{public}");
    Ok(())
}

// --- pulling --------------------------------------------------------------

fn load_config(dir: &Path) -> Result<Config> {
    let path = dir.join("puller.json");
    let raw = fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|e| format!("{} is not valid: {e}", path.display()))
}

fn pull(dir: &Path) -> Result<()> {
    let config = load_config(dir)?;
    let log = config.reports_dir.join("pull.log");
    let outcome = pull_all(dir, &config);
    let line = match &outcome {
        Ok(saved) if saved.is_empty() => None,
        Ok(saved) => Some(format!("saved {}: {}", saved.len(), saved.join(", "))),
        Err(e) => Some(format!("error: {e}")),
    };
    if let Some(line) = line {
        append_log(&log, &line);
    }
    outcome.map(|_| ())
}

struct Inbox {
    agent: ureq::Agent,
    endpoint: String,
    key: SigningKey,
}

impl Inbox {
    /// Signed request: method, path and time, so a captured signature can't
    /// be replayed against another report or after a few minutes.
    fn call(&self, method: &str, path: &str) -> Result<ureq::Response> {
        let time = unix_now().to_string();
        let signature = self.key.sign(format!("{method}\n{path}\n{time}").as_bytes());
        let request = self
            .agent
            .request(method, &format!("{}{}", self.endpoint, path))
            .set("X-Puller-Time", &time)
            .set("X-Puller-Signature", &B64.encode(signature.to_bytes()));
        match request.call() {
            Ok(response) => Ok(response),
            Err(ureq::Error::Status(code, response)) => {
                let body: String = response.into_string().unwrap_or_default().chars().take(200).collect();
                Err(format!("{method} {path}: HTTP {code} {body}"))
            }
            Err(e) => Err(format!("{method} {path}: {e}")),
        }
    }
}

/// Saves every waiting report, then removes it from the inbox. A report that
/// fails is left there for the next run; the rest still go through.
fn pull_all(dir: &Path, config: &Config) -> Result<Vec<String>> {
    fs::create_dir_all(&config.reports_dir).map_err(|e| format!("cannot create {}: {e}", config.reports_dir.display()))?;
    let inbox = Inbox {
        agent: ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).build(),
        endpoint: config.endpoint.trim_end_matches('/').to_string(),
        key: load_key(dir)?,
    };
    let body = inbox.call("GET", "/v1/reports")?.into_string().map_err(|e| format!("reading the list: {e}"))?;
    let listing: Listing = serde_json::from_str(&body).map_err(|e| format!("the inbox sent an odd list: {e}"))?;

    let mut saved = Vec::new();
    let mut errors = Vec::new();
    for item in listing.reports {
        if !valid_key(&item.key) {
            continue;
        }
        match pull_one(&inbox, config, &item) {
            Ok(true) => saved.push(report_id(&item.key).to_string()),
            Ok(false) => {}
            Err(e) => errors.push(e),
        }
    }
    if errors.is_empty() {
        Ok(saved)
    } else {
        Err(format!("{} (saved {} before that: {})", errors.join("; "), saved.len(), saved.join(", ")))
    }
}

/// Saves one report and removes it from the inbox. False when it was already
/// on this PC and only the delete was repeated.
fn pull_one(inbox: &Inbox, config: &Config, item: &Listed) -> Result<bool> {
    let path = format!("/v1/reports/{}", item.key);
    let folder = config.reports_dir.join(folder_name(&item.key));
    // Already saved by an earlier run whose delete didn't get through, or whose
    // delete the inbox's list hasn't caught up with yet (KV lists can lag ~60 s).
    let fresh = !folder.exists();
    if fresh {
        let mut gz = Vec::new();
        inbox
            .call("GET", &path)?
            .into_reader()
            .take(MAX_REPORT_BYTES)
            .read_to_end(&mut gz)
            .map_err(|e| format!("downloading {}: {e}", item.key))?;
        save_report(&folder, item, &gz)?;
    }
    inbox.call("DELETE", &path)?;
    Ok(fresh)
}

/// Writes into <folder>.partial first and renames it into place, so a folder
/// that exists always holds a whole report.
fn save_report(folder: &Path, item: &Listed, gz: &[u8]) -> Result<()> {
    let partial = folder.with_extension("partial");
    let _ = fs::remove_dir_all(&partial);
    fs::create_dir_all(&partial).map_err(|e| format!("cannot create {}: {e}", partial.display()))?;
    let write = |name: &str, bytes: &[u8]| {
        fs::write(partial.join(name), bytes).map_err(|e| format!("cannot write {name} for {}: {e}", item.key))
    };
    let mut json = Vec::new();
    let parsed = GzDecoder::new(gz)
        .take(MAX_JSON_BYTES)
        .read_to_end(&mut json)
        .ok()
        .and_then(|_| serde_json::from_slice::<Value>(&json).ok());
    match parsed {
        Some(report) => {
            write("report.json", serde_json::to_string_pretty(&report).unwrap_or_default().as_bytes())?;
            write("report.txt", render(item, &report).as_bytes())?;
        }
        // Keep what arrived, so nothing is lost; it is removed from the inbox all the same.
        None => write("unreadable.json.gz", gz)?,
    }
    fs::rename(&partial, folder).map_err(|e| format!("cannot finish {}: {e}", folder.display()))
}

/// The report as readable text (UTF-8 with a BOM, for Notepad).
fn render(item: &Listed, report: &Value) -> String {
    let field = |k: &str| report.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mut out = String::from('\u{feff}');
    out += &format!("HZMM problem report {}\n", report_id(&item.key));
    out += &format!("Received: {}\n", item.received_at.as_deref().unwrap_or("unknown"));
    for (label, key) in [("Created", "createdAt"), ("Version", "version"), ("Source", "source"), ("Language", "language"), ("Nexus name", "nexusName")] {
        let value = field(key);
        if !value.is_empty() {
            out += &format!("{label}: {value}\n");
        }
    }
    let note = field("note");
    if !note.is_empty() {
        out += &format!("\n== Note ==\n{note}\n");
    }
    if let Some(sections) = report.get("sections").and_then(Value::as_object) {
        for (key, title) in SECTIONS {
            if let Some(text) = sections.get(key).and_then(Value::as_str) {
                out += &format!("\n== {title} ==\n{text}\n");
            }
        }
    }
    out
}

// --- small helpers ------------------------------------------------------------

/// Inbox keys look like 20261127T120405-AB12-CD34.
fn valid_key(key: &str) -> bool {
    let b = key.as_bytes();
    b.len() == 25
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[8] == b'T'
        && b[9..15].iter().all(u8::is_ascii_digit)
        && b[15] == b'-'
        && b[20] == b'-'
        && b[16..20].iter().chain(&b[21..]).all(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
}

fn report_id(key: &str) -> &str {
    &key[16..]
}

/// 20261127T120405-AB12-CD34 → 2026-11-27_120405_AB12-CD34 (received time is UTC).
fn folder_name(key: &str) -> String {
    format!("{}-{}-{}_{}_{}", &key[0..4], &key[4..6], &key[6..8], &key[9..15], &key[16..])
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn append_log(path: &Path, line: &str) {
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {line}", utc_timestamp(unix_now()));
    }
}

fn utc_timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_folders() {
        assert!(valid_key("20261127T120405-AB12-CD34"));
        assert!(!valid_key("20261127T120405-ab12-CD34"));
        assert!(!valid_key("../../etc/passwd-AB12-CD34"));
        assert!(!valid_key("20261127T120405-AB12-CD3"));
        assert_eq!(folder_name("20261127T120405-AB12-CD34"), "2026-11-27_120405_AB12-CD34");
        assert_eq!(report_id("20261127T120405-AB12-CD34"), "AB12-CD34");
    }

    #[test]
    fn timestamps() {
        assert_eq!(utc_timestamp(0), "1970-01-01 00:00:00Z");
        assert_eq!(utc_timestamp(1_795_852_800), "2026-11-28 08:00:00Z");
        assert_eq!(utc_timestamp(951_782_400), "2000-02-29 00:00:00Z");
    }

    #[test]
    fn renders_what_was_sent() {
        let item = Listed { key: "20261127T120405-AB12-CD34".into(), received_at: Some("2026-11-27T12:04:05.000Z".into()) };
        let report: Value = serde_json::from_str(
            r#"{"version":"1.8.0","source":"settings","note":"it broke","nexusName":"","sections":{"log":"L","context":"E"}}"#,
        )
        .unwrap();
        let text = render(&item, &report);
        assert!(text.starts_with("\u{feff}HZMM problem report AB12-CD34\n"));
        assert!(text.contains("Version: 1.8.0\n"));
        assert!(!text.contains("Nexus name"));
        assert!(text.contains("\n== Note ==\nit broke\n"));
        assert!(text.find("== Error ==").unwrap() < text.find("== HZMM log ==").unwrap());
    }
}
