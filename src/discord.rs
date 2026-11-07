use discord_rich_presence::activity::{Activity, Assets, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use parking_lot::Mutex;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const CLIENT_ID: &str = "1556839052102209596";
pub const DEFAULT_INVITE: &str = "https://discord.gg/8UQZTKR5Qp";

#[derive(Clone, Debug, Default)]
pub struct PresenceState {
    pub connected: bool,
    pub details: String,
    pub state: String,
}

#[derive(Clone, Debug)]
pub struct PresenceActivity {
    pub details: String,
    pub state: String,
    pub small_image: String,
    pub small_text: String,
    pub started: i64,
}

enum Command {
    Set(PresenceActivity),
    Clear,
}

pub struct Discord {
    tx: Sender<Command>,
    state: Arc<Mutex<PresenceState>>,
}

impl Discord {
    pub fn start() -> Self {
        let (tx, rx) = channel::<Command>();
        let state = Arc::new(Mutex::new(PresenceState::default()));
        let shared = state.clone();
        std::thread::spawn(move || {
            let mut client: Option<DiscordIpcClient> = DiscordIpcClient::new(CLIENT_ID).ok();
            let mut connected = false;
            let mut last_attempt = Instant::now() - Duration::from_secs(30);
            let mut current: Option<PresenceActivity> = None;
            let mut last_key = String::new();
            loop {
                let mut pending: Option<Command> = None;
                match rx.recv_timeout(Duration::from_millis(1500)) {
                    Ok(cmd) => pending = Some(cmd),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
                if let Some(cmd) = pending {
                    match cmd {
                        Command::Set(activity) => current = Some(activity),
                        Command::Clear => current = None,
                    }
                }
                if !connected && last_attempt.elapsed() > Duration::from_secs(20) {
                    last_attempt = Instant::now();
                    if let Some(client_ref) = client.as_mut() {
                        if client_ref.connect().is_ok() {
                            connected = true;
                            last_key.clear();
                            shared.lock().connected = true;
                        }
                    }
                }
                if !connected {
                    continue;
                }
                let Some(client_ref) = client.as_mut() else {
                    connected = false;
                    continue;
                };
                match current.as_ref() {
                    Some(activity) => {
                        let key = format!(
                            "{}\n{}\n{}\n{}",
                            activity.details, activity.state, activity.small_image, activity.small_text
                        );
                        if key == last_key {
                            continue;
                        }
                        let mut assets = Assets::new()
                            .large_image("lunarspace")
                            .large_text("XyoLauncher");
                        if !activity.small_image.is_empty() {
                            assets = assets
                                .small_image(activity.small_image.as_str())
                                .small_text(activity.small_text.as_str());
                        }
                        let payload = Activity::new()
                            .details(activity.details.as_str())
                            .state(activity.state.as_str())
                            .timestamps(Timestamps::new().start(activity.started))
                            .assets(assets);
                        if client_ref.set_activity(payload).is_ok() {
                            last_key = key;
                            let mut status = shared.lock();
                            status.connected = true;
                            status.details = activity.details.clone();
                            status.state = activity.state.clone();
                        } else {
                            connected = false;
                            let mut status = shared.lock();
                            status.connected = false;
                            status.details.clear();
                            status.state.clear();
                        }
                    }
                    None => {
                        if last_key != "clear" {
                            let _ = client_ref.clear_activity();
                            last_key = "clear".into();
                        }
                        let mut status = shared.lock();
                        status.details.clear();
                        status.state.clear();
                    }
                }
            }
        });
        Self { tx, state }
    }

    pub fn status(&self) -> PresenceState {
        self.state.lock().clone()
    }

    pub fn set(&self, activity: PresenceActivity) {
        let _ = self.tx.send(Command::Set(activity));
    }

    pub fn clear(&self) {
        let _ = self.tx.send(Command::Clear);
    }
}
