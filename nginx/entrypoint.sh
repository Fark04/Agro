#!/bin/sh
set -e

# Render base HTTP config (substitute only DOMAIN_NAME)
envsubst '${DOMAIN_NAME}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Conditionally render SSL config when certs exist
CERT_DIR="/etc/letsencrypt/live/${DOMAIN_NAME}"
SSL_CONF="/etc/nginx/conf.d/ssl.conf"

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  envsubst '${DOMAIN_NAME}' < /etc/nginx/conf.d/ssl.conf.template > "$SSL_CONF"
else
  rm -f "$SSL_CONF" 2>/dev/null || true
fi

# Start watcher to enable SSL when certs appear
(
  while :; do
    if [ ! -f "$SSL_CONF" ] && [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
      echo "[entrypoint] Certificates found. Enabling SSL and reloading nginx..."
      envsubst '${DOMAIN_NAME}' < /etc/nginx/conf.d/ssl.conf.template > "$SSL_CONF"
      nginx -s reload || true
    fi
    sleep 60
  done
) &

# Start nginx in foreground
exec nginx -g "daemon off;"
