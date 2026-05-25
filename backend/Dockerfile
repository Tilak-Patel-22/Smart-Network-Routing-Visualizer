FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y g++ cmake make git

WORKDIR /app

COPY . .

RUN cmake -B build
RUN cmake --build build

EXPOSE 8080

CMD ["./build/routing_server"]