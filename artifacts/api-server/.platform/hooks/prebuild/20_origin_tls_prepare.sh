#!/bin/bash
# Gets nginx's HTTPS listener for CloudFront ready before Elastic Beanstalk applies and checks the
# nginx configuration (docs/04 R-SC-6):
#
# - A certificate to start with. nginx refuses a configuration whose certificate file is missing,
#   and hooks/postdeploy/20_origin_tls.sh only gets the real one from Let's Encrypt after the check.
#   This stand-in is self-signed, so CloudFront refuses it; it never replaces a certificate that is
#   already there.
# - Whether port 80 still serves the app: until the ORIGIN_HTTP environment property is "off"
#   (conf.d/elasticbeanstalk/00_application.conf). Set here, before nginx loads its configuration,
#   so neither a deployment nor a rebuilt instance has a moment with the old answer.
#
# Elastic Beanstalk runs this as root before every deployment (hooks/prebuild) and configuration
# change (confighooks/prebuild). It is idempotent and never fails the deployment.
set -uo pipefail

readonly CERT_DIR=/etc/pki/tls/secureai-origin
readonly SWITCH_DIR=/etc/secureai-origin

log() { echo "[secureai-origin-tls] $*"; }

install -d -m 0700 "$CERT_DIR"
if [ ! -s "$CERT_DIR/fullchain.pem" ] || [ ! -s "$CERT_DIR/privkey.pem" ]; then
  # Dangling links (Let's Encrypt's files gone) are replaced, not written through.
  rm -f "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"
  if openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
    -subj "/CN=secureai-origin-standin" \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" >/dev/null 2>&1; then
    chmod 0600 "$CERT_DIR/privkey.pem"
    log "self-signed stand-in installed until Let's Encrypt issues the certificate"
  else
    log "could not create the stand-in certificate, so nginx will refuse its configuration"
  fi
fi

install -d -m 0755 "$SWITCH_DIR"
if [ "$(/opt/elasticbeanstalk/bin/get-config environment -k ORIGIN_HTTP 2>/dev/null)" = "off" ]; then
  echo 'port80 "off";' > "$SWITCH_DIR/http.map"
  log "port 80 answers only Let's Encrypt's check (ORIGIN_HTTP=off)"
else
  rm -f "$SWITCH_DIR/http.map"
  log "port 80 still serves the app (ORIGIN_HTTP is not off)"
fi
exit 0
