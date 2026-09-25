#!/bin/bash
# ClamAV for SecureAI's upload scanning, on the API's own instance and reachable only from 127.0.0.1.
#
# Elastic Beanstalk runs this as root before every application deployment (hooks/prebuild); the
# source bundle also carries it as confighooks/prebuild, so changing CLAMD_HOST alone applies it too.
# It is idempotent and never fails the deployment: if ClamAV can't be set up, the API still starts
# and, with CLAMD_HOST set, refuses uploads (503) until the scanner answers rather than storing
# files unscanned.
#
# Switched on by the CLAMD_HOST environment property set to 127.0.0.1 (leave CLAMD_PORT unset).
# Unset CLAMD_HOST to stop the scanner. Needs a 4 GB instance (t3.medium): clamd keeps its whole
# signature database in memory, and briefly holds two copies while it loads new signatures.
set -uo pipefail

readonly CONF_DIR=/etc/secureai-clamav
readonly DB_DIR=/var/lib/secureai-clamav
readonly AV_USER=secureai-av
readonly UNIT_DIR=/etc/systemd/system
readonly SWAP_FILE=/var/swapfile-secureai

log() { echo "[secureai-clamav] $*"; }

# Writes stdin to $1 if the content differs. Returns 0 when the file changed.
write_if_changed() {
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  if [ -f "$1" ] && cmp -s "$tmp" "$1"; then
    rm -f "$tmp"
    return 1
  fi
  install -m 0644 "$tmp" "$1"
  rm -f "$tmp"
  return 0
}

stop_scanner() {
  if [ -f "$UNIT_DIR/secureai-clamd.service" ]; then
    systemctl disable --now secureai-clamd.service secureai-freshclam.service >/dev/null 2>&1 || true
    log "scanner stopped"
  fi
}

# A safety net for the moment clamd loads new signatures next to the old ones.
ensure_swap() {
  if [ -n "$(swapon --show=NAME --noheadings)" ]; then
    return 0
  fi
  local free_kb
  free_kb="$(df --output=avail -k / | tail -1)"
  if [ "${free_kb:-0}" -lt 4000000 ]; then
    log "no swap added: less than 4 GB free on the root volume"
    return 0
  fi
  if [ ! -f "$SWAP_FILE" ]; then
    fallocate -l 2G "$SWAP_FILE" || return 0
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null || return 0
  fi
  swapon "$SWAP_FILE" && log "2 GB swap file enabled"
  grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap defaults 0 0" >> /etc/fstab
}

setup() {
  local changed=0

  if ! rpm -q clamd1.4 clamav1.4 clamav1.4-freshclam clamav1.4-data >/dev/null 2>&1; then
    log "installing ClamAV 1.4 LTS from the Amazon Linux 2023 repository"
    dnf install -y -q clamd1.4 clamav1.4 clamav1.4-freshclam clamav1.4-data || return 1
    dnf clean packages -q || true
  fi

  if ! id -u "$AV_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$DB_DIR" --no-create-home --shell /sbin/nologin "$AV_USER" || return 1
  fi
  install -d -o "$AV_USER" -g "$AV_USER" -m 0755 "$DB_DIR"
  install -d -m 0755 "$CONF_DIR"

  write_if_changed "$CONF_DIR/clamd.conf" <<'CONF' && changed=1
# Written by SecureAI's deploy hook (.platform/hooks/prebuild/10_clamav.sh); edits are overwritten.
Foreground yes
LogTime yes
LogClean no
DatabaseDirectory /var/lib/secureai-clamav
TemporaryDirectory /tmp
TCPSocket 3310
TCPAddr 127.0.0.1
MaxThreads 4
MaxQueue 40
# Uploads are capped at 15 MB by the API.
StreamMaxLength 20M
MaxFileSize 20M
MaxScanSize 100M
ConcurrentDatabaseReload yes
SelfCheck 600
ExitOnOOM yes
CONF

  write_if_changed "$CONF_DIR/freshclam.conf" <<'CONF' && changed=1
# Written by SecureAI's deploy hook (.platform/hooks/prebuild/10_clamav.sh); edits are overwritten.
DatabaseDirectory /var/lib/secureai-clamav
DatabaseOwner secureai-av
DatabaseMirror database.clamav.net
Foreground yes
LogTime yes
Checks 12
ConnectTimeout 30
NotifyClamd /etc/secureai-clamav/clamd.conf
CONF

  write_if_changed "$UNIT_DIR/secureai-clamd.service" <<'UNIT' && changed=1
[Unit]
Description=ClamAV scanner for SecureAI uploads (127.0.0.1:3310 only)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=secureai-av
Group=secureai-av
ExecStart=/usr/sbin/clamd --config-file=/etc/secureai-clamav/clamd.conf
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
# Under memory pressure the kernel should end the scanner, not the API.
OOMScoreAdjust=500
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
UNIT

  write_if_changed "$UNIT_DIR/secureai-freshclam.service" <<'UNIT' && changed=1
[Unit]
Description=ClamAV signature updates for SecureAI (freshclam)
After=network-online.target secureai-clamd.service
Wants=network-online.target

[Service]
Type=simple
User=secureai-av
Group=secureai-av
ExecStart=/usr/bin/freshclam --daemon --config-file=/etc/secureai-clamav/freshclam.conf
Restart=on-failure
RestartSec=60
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/secureai-clamav

[Install]
WantedBy=multi-user.target
UNIT

  if [ "$changed" = 1 ]; then
    systemctl daemon-reload
  fi

  ensure_swap

  # Start from the packaged signatures so clamd can load even if the ClamAV mirror is unreachable,
  # then bring them up to date. Once the update service runs, it keeps them current.
  if ! ls "$DB_DIR"/main.c[lv]d >/dev/null 2>&1 && ls /var/lib/clamav/main.c[lv]d >/dev/null 2>&1; then
    cp /var/lib/clamav/*.c[lv]d "$DB_DIR"/ && chown "$AV_USER:$AV_USER" "$DB_DIR"/*.c[lv]d
  fi
  if ! systemctl is-active --quiet secureai-freshclam.service; then
    timeout 300 runuser -u "$AV_USER" -- freshclam --config-file="$CONF_DIR/freshclam.conf" --stdout \
      || log "signature update failed; using the signatures already on disk"
  fi
  if ! ls "$DB_DIR"/main.c[lv]d "$DB_DIR"/daily.c[lv]d >/dev/null 2>&1; then
    log "no signature database in $DB_DIR"
    return 1
  fi

  systemctl enable --quiet secureai-clamd.service secureai-freshclam.service
  if [ "$changed" = 1 ] || ! systemctl is-active --quiet secureai-clamd.service; then
    systemctl restart secureai-clamd.service
  fi
  if [ "$changed" = 1 ] || ! systemctl is-active --quiet secureai-freshclam.service; then
    systemctl restart secureai-freshclam.service
  fi

  # clamd takes a minute or so to load its signatures.
  if ! clamdscan --config-file="$CONF_DIR/clamd.conf" --ping=60:3 >/dev/null 2>&1; then
    log "clamd did not answer within 3 minutes"
    return 1
  fi

  # End-to-end check through the same INSTREAM path the API uses. The EICAR test string is split
  # so that this file doesn't itself look like the test virus to a scanner on a developer's machine.
  # shellcheck disable=SC2016 # the $ signs are part of the test string, not expansions
  local a='X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR' b='-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' result
  result="$(printf '%s%s' "$a" "$b" | clamdscan --config-file="$CONF_DIR/clamd.conf" --no-summary - 2>&1)"
  case "$result" in
    *FOUND*) log "ready: $(clamdscan --config-file="$CONF_DIR/clamd.conf" --version 2>&1); self-test: $result" ;;
    *)
      log "EICAR self-test failed: $result"
      return 1
      ;;
  esac
}

target="$(/opt/elasticbeanstalk/bin/get-config environment -k CLAMD_HOST 2>/dev/null | tr -d '"[:space:]')"
case "$target" in
  "")
    log "CLAMD_HOST not set: uploads get the built-in signature checks only"
    stop_scanner
    exit 0
    ;;
  127.0.0.1 | localhost) ;;
  *)
    log "CLAMD_HOST is $target, not this instance: nothing to install here"
    stop_scanner
    exit 0
    ;;
esac

mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
if [ "${mem_kb:-0}" -lt 3000000 ]; then
  log "this instance has $((${mem_kb:-0} / 1024)) MiB of RAM and ClamAV needs a 4 GB instance (t3.medium); not installed, so uploads are refused until the instance is resized"
  exit 0
fi

if ! setup; then
  log "ClamAV setup did not finish; the API refuses uploads until the scanner answers"
fi
exit 0
