pub trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

impl HideConsole for std::process::Command {
    #[cfg(windows)]
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(0x0800_0000)
    }

    #[cfg(not(windows))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

impl HideConsole for tokio::process::Command {
    #[cfg(windows)]
    fn hide_console(&mut self) -> &mut Self {
        self.creation_flags(0x0800_0000)
    }

    #[cfg(not(windows))]
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}
