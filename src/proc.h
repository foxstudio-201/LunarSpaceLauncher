#pragma once
#include <windows.h>
#include <atomic>
#include <functional>
#include <string>
#include <thread>

struct ProcessCapture {
    bool started = false;
    int exit_code = -1;
    std::string out;
    std::string err;
};

bool run_process_capture(const std::wstring& exe, const std::wstring& args,
                         const std::wstring& cwd, ProcessCapture& result,
                         int timeout_ms = 15000);

class ChildProcess {
public:
    ChildProcess() = default;
    ~ChildProcess();
    ChildProcess(const ChildProcess&) = delete;
    ChildProcess& operator=(const ChildProcess&) = delete;

    bool start(const std::wstring& exe, const std::wstring& args, const std::wstring& cwd,
               std::function<void(const std::string&)> on_line);
    bool running() const;
    int wait();
    void stop();
    unsigned long pid() const { return pid_; }

private:
    PROCESS_INFORMATION pi_{};
    std::thread out_thread_;
    std::thread err_thread_;
    std::atomic<bool> running_{false};
    std::function<void(const std::string&)> on_line_;
    unsigned long pid_ = 0;
    void pump(HANDLE read_end);
};
