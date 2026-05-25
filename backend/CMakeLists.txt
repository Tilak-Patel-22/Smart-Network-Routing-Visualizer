cmake_minimum_required(VERSION 3.16)
project(network_routing_backend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)
FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG v0.15.3
)
FetchContent_MakeAvailable(json httplib)

add_executable(routing_server src/main.cpp)
target_include_directories(routing_server PRIVATE ${json_SOURCE_DIR}/include ${httplib_SOURCE_DIR})
if(MSVC)
  target_compile_definitions(routing_server PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()
if(WIN32)
  target_link_libraries(routing_server PRIVATE ws2_32)
endif()
