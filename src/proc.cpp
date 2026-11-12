#include "proc.h"
#include <algorithm>
#include <mutex>
#include <vector>

namespace {

std::wstring quote_arg(const std::wstring& value) {
    if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    return L"\"" + value + L"\"";
}

std::string strip_ansi(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        if (text[i] == 0x1B && i + 1 < text.size() && text[i + 1] == '[') {
            i += 2;
            while (i < text.size() && !((text[i] >= 'A' && text[i] <= 'Z') ||
                                        (text[i] >= 'a' && text[i] <= 'z')))
                ++i;
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

struct PipePair {
    HANDLE read = nullptr;
    HANDLE write = nullptr;
    bool create() {
        SECURITY_ATTRIBUTES sa{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
        if (!CreatePipe(&read, &write, &sa, 0)) return false;
        SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0);
        return true;
    }
};

void close_handle(HANDLE& h) {
    if (h && h != INVALID_HANDLE_VALUE) CloseHandle(h);
    h = nullptr;
}

}  // namespace

bool run_process_capture(const std::wstring& exe, const std::wstring& args,
                         const std::wstring& cwd, ProcessCapture& result, int timeout_ms) {
    result = {};
    PipePair out_pipe, err_pipe;
    if (!out_pipe.create() || !err_pipe.create()) {
        close_handle(out_pipe.read);
        close_handle(out_pipe.write);
        close_handle(err_pipe.read);
        close_handle(err_pipe.write);
        return false;
    }
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = out_pipe.write;
    si.hStdError = err_pipe.write;
    si.hStdInput = nullptr;
    PROCESS_INFORMATION pi{};
    std::wstring cmdline = quote_arg(exe) + (args.empty() ? L"" : L" " + args);
    std::wstring workdir = cwd.empty() ? L"" : cwd;
    BOOL ok = CreateProcessW(nullptr, cmdline.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                             nullptr, workdir.empty() ? nullptr : workdir.c_str(), &si, &pi);
    close_handle(out_pipe.write);
    close_handle(err_pipe.write);
    if (!ok) {
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        return false;
    }
    result.started = true;
    std::mutex mtx;
    std::thread t1([&] {
        char buf[4096];
        DWORD read = 0;
        while (ReadFile(out_pipe.read, buf, sizeof(buf), &read, nullptr) && read > 0) {
            std::lock_guard<std::mutex> lock(mtx);
            result.out.append(buf, read);
        }
    });
    std::thread t2([&] {
        char buf[4096];
        DWORD read = 0;
        while (ReadFile(err_pipe.read, buf, sizeof(buf), &read, nullptr) && read > 0) {
            std::lock_guard<std::mutex> lock(mtx);
            result.err.append(buf, read);
        }
    });
    DWORD wait = WaitForSingleObject(pi.hProcess, timeout_ms > 0 ? (DWORD)timeout_ms : INFINITE);
    if (wait == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 5000);
    }
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    result.exit_code = (int)code;
    t1.join();
    t2.join();
    close_handle(out_pipe.read);
    close_handle(err_pipe.read);
    close_handle(pi.hThread);
    close_handle(pi.hProcess);
    return true;
}

ChildProcess::~ChildProcess() {
    if (running_.load()) {
        stop();
        wait();
    }
    close_handle(pi_.hThread);
    close_handle(pi_.hProcess);
}

bool ChildProcess::start(const std::wstring& exe, const std::wstring& args,
                         const std::wstring& cwd,
                         std::function<void(const std::string&)> on_line) {
    PipePair out_pipe, err_pipe;
    if (!out_pipe.create() || !err_pipe.create()) {
        close_handle(out_pipe.read);
        close_handle(out_pipe.write);
        close_handle(err_pipe.read);
        close_handle(err_pipe.write);
        return false;
    }
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = out_pipe.write;
    si.hStdError = err_pipe.write;
    si.hStdInput = nullptr;
    std::wstring cmdline = quote_arg(exe) + (args.empty() ? L"" : L" " + args);
    BOOL ok = CreateProcessW(nullptr, cmdline.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                             nullptr, cwd.empty() ? nullptr : cwd.c_str(), &si, &pi_);
    close_handle(out_pipe.write);
    close_handle(err_pipe.write);
    if (!ok) {
        close_handle(out_pipe.read);
        close_handle(err_pipe.read);
        return false;
    }
    pid_ = pi_.dwProcessId;
    running_.store(true);
    on_line_ = std::move(on_line);
    out_thread_ = std::thread(&ChildProcess::pump, this, out_pipe.read);
    err_thread_ = std::thread(&ChildProcess::pump, this, err_pipe.read);
    return true;
}

void ChildProcess::pump(HANDLE read_end) {
    std::string pending;
    char buf[8192];
    DWORD read = 0;
    while (ReadFile(read_end, buf, sizeof(buf), &read, nullptr) && read > 0) {
        pending.append(buf, read);
        size_t pos;
        while ((pos = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, pos);
            pending.erase(0, pos + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (on_line_) on_line_(strip_ansi(line));
        }
        if (pending.size() > 65536) {
            if (on_line_) on_line_(strip_ansi(pending));
            pending.clear();
        }
    }
    if (!pending.empty() && on_line_) on_line_(strip_ansi(pending));
    CloseHandle(read_end);
}

bool ChildProcess::running() const {
    if (!running_.load() || !pi_.hProcess) return false;
    return WaitForSingleObject(pi_.hProcess, 0) == WAIT_TIMEOUT;
}

int ChildProcess::wait() {
    int code = -1;
    if (pi_.hProcess) {
        WaitForSingleObject(pi_.hProcess, INFINITE);
        DWORD value = 0;
        GetExitCodeProcess(pi_.hProcess, &value);
        code = (int)value;
    }
    running_.store(false);
    if (out_thread_.joinable()) out_thread_.join();
    if (err_thread_.joinable()) err_thread_.join();
    return code;
}

void ChildProcess::stop() {
    if (!running()) return;
    wchar_t cmd[64];
    swprintf(cmd, 64, L"/pid %lu /T /F", pid_);
    ProcessCapture capture;
    run_process_capture(L"taskkill", cmd, L"", capture, 10000);
    if (running() && pi_.hProcess) TerminateProcess(pi_.hProcess, 1);
}
