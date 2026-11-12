cmake_minimum_required(VERSION 3.20)
project(XyoLauncherEngine LANGUAGES CXX)
enable_language(RC)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(XyoLauncherEngine WIN32
  src/main.cpp
  src/render.cpp
  src/ui.cpp
  src/net.cpp
  src/auth.cpp
  src/discord.cpp
  resource.rc
)

target_include_directories(XyoLauncherEngine PRIVATE src)
set_target_properties(XyoLauncherEngine PROPERTIES OUTPUT_NAME "XyoLauncher+")
target_compile_definitions(XyoLauncherEngine PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0A00)
target_compile_options(XyoLauncherEngine PRIVATE -O2 -fno-exceptions -fno-rtti -Wall -Wextra -Wno-unused-parameter)
target_link_libraries(XyoLauncherEngine PRIVATE
  d3d11 dxgi d2d1 dwrite windowscodecs ole32 uuid user32 gdi32 shell32
  winhttp bcrypt crypt32 ws2_32 advapi32
)
target_link_options(XyoLauncherEngine PRIVATE -municode -static-libgcc -static-libstdc++)

add_custom_target(sync_assets ALL
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/ui $<TARGET_FILE_DIR:XyoLauncherEngine>/ui
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/assets $<TARGET_FILE_DIR:XyoLauncherEngine>/assets)
add_dependencies(XyoLauncherEngine sync_assets)
