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

WORKDIR /root/

COPY --from=builder /app/main .
COPY --from=builder /app/migrate .

EXPOSE 8080

CMD ["./main"]
