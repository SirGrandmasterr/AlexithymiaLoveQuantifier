# Build stage
FROM golang:1.24.1-alpine AS builder

WORKDIR /app

# Install git for fetch dependencies
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build the application, and the migrate command alongside it so the schema step can be
# run on its own (`make migrate` / `make migrate-check`) without a Go toolchain on the host.
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o migrate ./cmd/migrate

# Run stage
FROM alpine:latest

# Non-root from here down. The server binds :8080 — unprivileged — and writes nothing but
# ./uploads, so root bought nothing and cost the usual: a container escape or an RCE through
# the upload handler landed as uid 0. docker-compose.yml drops every capability on top of
# this, and mounts the root filesystem read-only.
RUN addgroup -S app && adduser -S -D -H -G app app

# /app rather than /root: /root is mode 700 and owned by root, so it is not a directory a
# non-root process can be given a writable subdirectory in without loosening it first.
WORKDIR /app

COPY --from=builder --chown=app:app /app/main /app/migrate ./

# Created in the image, not by the server at runtime, so the named volume Compose mounts
# here inherits app's ownership — Docker seeds a fresh volume from the image directory's
# contents *and* its owner and mode. Mounted over a path that does not exist, the volume
# would be created root-owned and the first upload would fail with EACCES under USER app.
RUN install -d -o app -g app /app/uploads

USER app

EXPOSE 8080

CMD ["./main"]
