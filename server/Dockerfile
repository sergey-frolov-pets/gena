# Сборка: статический бинарник без cgo.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gena-server .

FROM alpine:3.20
RUN adduser -D -H -u 10001 gena \
    && mkdir -p /data \
    && chown -R gena:gena /data
COPY --from=build /out/gena-server /gena-server
USER gena
EXPOSE 8787
VOLUME ["/data"]
# Токен обязателен: docker run -e GENA_TOKEN=... (или -v с файлом токена).
ENTRYPOINT ["/gena-server"]
CMD ["-addr", ":8787", "-data", "/data"]
