#!/bin/bash
# The certificate CloudFront checks when it connects to this instance over HTTPS (docs/04 R-SC-6):
# Let's Encrypt's, for the environment's own hostname, issued over HTTP-01 on port 80
# (nginx/conf.d/elasticbeanstalk/10_acme_challenge.conf) and renewed by a twice-daily systemd timer.
#
# Switched on by the ORIGIN_TLS_HOSTNAME environment property: the hostname CloudFront's origin
# names. Let's Encrypt must reach port 80 from the internet to issue or renew; port 443 stays open
# to CloudFront only, and ORIGIN_HTTP=off stops port 80 serving the app (docs/10 section 3a has the
# order of the steps). Elastic Beanstalk runs this as root after every deployment
# (hooks/postdeploy) and configuration change (confighooks/postdeploy), so setting either property
# alone applies it. It is idempotent and never fails the deployment: without a certificate the
# self-signed stand-in from hooks/prebuild/20_origin_tls_prepare.sh stays, which CloudFront refuses,
# so check this hook's lines in eb-hooks.log before CloudFront is switched to HTTPS.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
readonly HERE
readonly REQUIREMENTS="$HERE/../../origin-tls/certbot-requirements.txt"
readonly CERT_DIR=/etc/pki/tls/secureai-origin
readonly WEBROOT=/var/www/secureai-acme
readonly VENV=/opt/secureai-certbot
readonly NAME=secureai-origin
readonly LIVE=/etc/letsencrypt/live/$NAME
readonly LINK_HOOK=/etc/letsencrypt/renewal-hooks/deploy/secureai-origin.sh
readonly UNIT_DIR=/etc/systemd/system

log() { echo "[secureai-origin-tls] $*"; }
config() { /opt/elasticbeanstalk/bin/get-config environment -k "$1" 2>/dev/null || true; }

# Writes stdin to $1 (mode $2, default 0644) if the content differs. Returns 0 when it changed.
write_if_changed() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  if [ -f "$1" ] && cmp -s "$tmp" "$1"; then
    rm -f "$tmp"
    return 1
  fi
  install -m "${2:-0644}" "$tmp" "$1"
  rm -f "$tmp"
  return 0
}

# The port-80 switch the prebuild hook wrote takes effect even if Elastic Beanstalk did not reload
# nginx for a configuration change.
nginx -t -q 2>/dev/null && systemctl reload nginx

HOST="$(config ORIGIN_TLS_HOSTNAME)"
if [ -z "$HOST" ]; then
  log "ORIGIN_TLS_HOSTNAME is not set, so no certificate is requested"
  exit 0
fi

# certbot in its own virtualenv, every package pinned by hash; reinstalled only when the pins change.
# Amazon Linux 2023's own Python is 3.9, and certbot 5 needs 3.10 or later.
if [ ! -x "$VENV/bin/certbot" ] || ! cmp -s "$REQUIREMENTS" "$VENV/requirements.txt"; then
  if ! command -v python3.11 >/dev/null 2>&1 && ! dnf install -y -q python3.11 python3.11-pip >/dev/null 2>&1; then
    log "could not install python3.11, so no certificate"
    exit 0
  fi
  rm -rf "$VENV"
  if python3.11 -m venv "$VENV" &&
    "$VENV/bin/pip" install --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
      --require-hashes -r "$REQUIREMENTS"; then
    cp "$REQUIREMENTS" "$VENV/requirements.txt"
    log "$("$VENV/bin/certbot" --version 2>&1) installed"
  else
    rm -rf "$VENV"
    log "could not install certbot, so no certificate"
    exit 0
  fi
fi

# After every issue and renewal: point nginx at the new files and reload it. certbot runs this
# directory's hooks after each renewal; after the first issue this script runs it itself.
install -d -m 0755 "$(dirname "$LINK_HOOK")"
write_if_changed "$LINK_HOOK" 0755 <<EOF || true
#!/bin/sh
ln -sfn $LIVE/fullchain.pem $CERT_DIR/fullchain.pem
ln -sfn $LIVE/privkey.pem $CERT_DIR/privkey.pem
systemctl reload nginx
EOF

# A certificate for another hostname (a rebuilt environment) is replaced, not kept.
if [ -s "$LIVE/fullchain.pem" ] && ! openssl x509 -in "$LIVE/fullchain.pem" -noout -checkhost "$HOST" | grep -q "does match"; then
  "$VENV/bin/certbot" delete --cert-name "$NAME" --non-interactive >/dev/null 2>&1
  log "removed the certificate for a different hostname"
fi
if [ ! -s "$LIVE/fullchain.pem" ]; then
  install -d -m 0755 "$WEBROOT"
  # RSA rather than ECDSA: the key type CloudFront's origin connections support most widely.
  if "$VENV/bin/certbot" certonly --webroot -w "$WEBROOT" -d "$HOST" --cert-name "$NAME" \
    --key-type rsa --rsa-key-size 2048 --non-interactive --agree-tos \
    --register-unsafely-without-email --quiet; then
    log "Let's Encrypt issued a certificate for $HOST"
  else
    log "Let's Encrypt did not issue a certificate for $HOST: is port 80 open to the internet? (/var/log/letsencrypt/letsencrypt.log). The stand-in stays"
    exit 0
  fi
fi
if "$LINK_HOOK"; then
  log "nginx serves the certificate for $HOST, valid until $(openssl x509 -in "$LIVE/fullchain.pem" -noout -enddate | cut -d= -f2)"
else
  log "could not reload nginx with the certificate for $HOST"
fi

# Renewal: certbot renews when fewer than 30 days are left, with the settings saved at issue.
write_if_changed "$UNIT_DIR/secureai-origin-renew.service" <<EOF || true
[Unit]
Description=Renew SecureAI's origin certificate from Let's Encrypt when it is due
After=network-online.target

[Service]
Type=oneshot
ExecStart=$VENV/bin/certbot renew --quiet --cert-name $NAME
EOF
write_if_changed "$UNIT_DIR/secureai-origin-renew.timer" <<'EOF' || true
[Unit]
Description=Twice-daily renewal check for SecureAI's origin certificate

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now secureai-origin-renew.timer >/dev/null 2>&1 && log "renewal timer enabled"

# In the final arrangement (port 80 open only for this check), prove a renewal would work, against
# Let's Encrypt's staging service so it costs nothing.
if [ "$(config ORIGIN_HTTP)" = "off" ]; then
  if "$VENV/bin/certbot" renew --dry-run --cert-name "$NAME" --quiet >/dev/null 2>&1; then
    log "renewal dry run passed"
  else
    log "renewal dry run failed: Let's Encrypt must reach port 80 from the internet (/var/log/letsencrypt/letsencrypt.log)"
  fi
fi
exit 0
