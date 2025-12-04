FROM nginx:alpine

# Ensure envsubst is available
RUN apk add --no-cache gettext

# Copy nginx configuration files
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/default.conf /etc/nginx/conf.d/default.conf.template
COPY conf.d/ssl.conf.template /etc/nginx/conf.d/ssl.conf.template

# Create certbot webroot directory
RUN mkdir -p /var/www/certbot

# Create entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
