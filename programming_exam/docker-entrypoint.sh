#!/bin/sh
set -e

CERT_DIR=/etc/ssl/local
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/cert.pem" ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -subj "/CN=yolo-camera/O=local"
fi

python src/web_app.py --host 0.0.0.0 --port 8765 &
exec nginx -g 'daemon off;'
