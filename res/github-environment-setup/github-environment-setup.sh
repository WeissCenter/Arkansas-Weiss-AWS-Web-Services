#!/usr/bin/env bash
# =============================================================================
# github-environment-setup.sh
#
# Creates a GitHub Actions environment for a repository and populates it
# with secrets and environment variables using the GitHub CLI (gh).
#
# Usage:
#   ./github-environment-setup.sh -r OWNER/REPO -e ENV_NAME [-s secrets.env] [-v vars.env] [-f]
#   ./github-environment-setup.sh -r OWNER/REPO -e main -s example-secrets.env -v example-variables.env
#
# Options:
#   -r, --repo        OWNER/REPO (e.g. myorg/myrepo)    [required]
#   -e, --env         Environment name (e.g. production) [required]
#   -s, --secrets     Path to secrets file               [optional]
#   -v, --vars        Path to variables file             [optional]
#   -f, --force       Overwrite existing values without prompting [optional]
#   -h, --help        Show this help message
#
# File format (for both --secrets and --vars):
#   KEY=VALUE lines; lines beginning with # are comments; blank lines ignored.
#
#   Example secrets.env:   Example vars.env:
#   DB_PASSWORD=s3cr3t     APP_ENV=production
#   API_KEY=abc123         LOG_LEVEL=info
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

REPO=""; ENVIRONMENT=""; SECRETS_FILE=""; VARS_FILE=""; FORCE=false

usage() { grep '^#' "$0" | grep -v '#!/' | sed 's/^# \?//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case $1 in
    -r|--repo)    REPO="$2";         shift 2 ;;
    -e|--env)     ENVIRONMENT="$2";  shift 2 ;;
    -s|--secrets) SECRETS_FILE="$2"; shift 2 ;;
    -v|--vars)    VARS_FILE="$2";    shift 2 ;;
    -f|--force)   FORCE=true;        shift   ;;
    -h|--help)    usage ;;
    *) log_error "Unknown option: $1"; usage ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
[[ -z "$REPO" ]]        && { log_error "--repo is required";  exit 1; }
[[ -z "$ENVIRONMENT" ]] && { log_error "--env is required";   exit 1; }

if ! command -v gh &>/dev/null; then
  log_error "GitHub CLI (gh) not found. See https://cli.github.com"; exit 1
fi

if ! gh auth status &>/dev/null; then
  log_error "Not authenticated. Run: gh auth login"; exit 1
fi

[[ -n "$SECRETS_FILE" && ! -f "$SECRETS_FILE" ]] && { log_error "Secrets file not found: $SECRETS_FILE"; exit 1; }
[[ -n "$VARS_FILE"    && ! -f "$VARS_FILE"    ]] && { log_error "Variables file not found: $VARS_FILE";  exit 1; }

# ── Helper: emit KEY VALUE pairs from a .env-style file ──────────────────────
parse_env_file() {
  local file="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    echo "${line%%=*}" "${line#*=}"
  done < "$file"
}

# ── 1. Create / confirm the environment ──────────────────────────────────────
log_info "Creating environment '${ENVIRONMENT}' on ${REPO} ..."
if gh api --method PUT -H "Accept: application/vnd.github+json" \
    "/repos/${REPO}/environments/${ENVIRONMENT}" --silent; then
  log_success "Environment '${ENVIRONMENT}' ready."
else
  log_error "Failed to create environment."; exit 1
fi

# ── Helper: prompt user to confirm overwrite ──────────────────────────────────
# Returns 0 (yes/overwrite) or 1 (skip).
confirm_overwrite() {
  local kind="$1" key="$2"
  if [[ "$FORCE" == true ]]; then
    return 0
  fi
  log_warn "  ${kind} '${key}' already exists."
  printf "  Overwrite? [y/N] " >&2
  local answer
  read -r answer </dev/tty
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ── 2. Secrets ────────────────────────────────────────────────────────────────
secret_ok=0; secret_err=0; secret_skip=0
if [[ -n "$SECRETS_FILE" ]]; then
  log_info "Fetching existing secrets for '${ENVIRONMENT}' ..."
  existing_secrets=$(gh secret list --repo "$REPO" --env "$ENVIRONMENT" --json name --jq '.[].name' 2>/dev/null || true)

  log_info "Setting secrets from ${SECRETS_FILE} ..."
  while read -r key value; do
    if echo "$existing_secrets" | grep -qx "$key"; then
      if confirm_overwrite "secret" "$key"; then
        if gh secret set "$key" --repo "$REPO" --env "$ENVIRONMENT" --body "$value" 2>/dev/null; then
          log_success "  secret (overwritten): ${key}"; (( secret_ok++ ))
        else
          log_error   "  FAILED: ${key}"; (( secret_err++ ))
        fi
      else
        log_warn "  Skipped: ${key}"; (( secret_skip++ ))
      fi
    else
      if gh secret set "$key" --repo "$REPO" --env "$ENVIRONMENT" --body "$value" 2>/dev/null; then
        log_success "  secret: ${key}"; (( secret_ok++ ))
      else
        log_error   "  FAILED: ${key}"; (( secret_err++ ))
      fi
    fi
  done < <(parse_env_file "$SECRETS_FILE")
else
  log_warn "No --secrets file — skipping."
fi

# ── 3. Variables ──────────────────────────────────────────────────────────────
var_ok=0; var_err=0; var_skip=0
if [[ -n "$VARS_FILE" ]]; then
  log_info "Fetching existing variables for '${ENVIRONMENT}' ..."
  existing_vars_json=$(gh variable list --repo "$REPO" --env "$ENVIRONMENT" --json name,value 2>/dev/null || echo '[]')

  log_info "Setting variables from ${VARS_FILE} ..."
  while read -r key value; do
    var_exists=$(echo "$existing_vars_json" | jq -r --arg k "$key" 'map(select(.name == $k)) | length')
    if [[ "$var_exists" -gt 0 ]]; then
      current_value=$(echo "$existing_vars_json" | jq -r --arg k "$key" '.[] | select(.name == $k) | .value')
      if [[ "$current_value" == "$value" ]]; then
        log_info "  var (up to date): ${key}"; (( var_skip++ ))
      elif confirm_overwrite "variable" "$key"; then
        if gh variable set "$key" --repo "$REPO" --env "$ENVIRONMENT" --body "$value" 2>/dev/null; then
          log_success "  var (overwritten): ${key}=${value}"; (( var_ok++ ))
        else
          log_error   "  FAILED: ${key}"; (( var_err++ ))
        fi
      else
        log_warn "  Skipped: ${key}"; (( var_skip++ ))
      fi
    else
      if gh variable set "$key" --repo "$REPO" --env "$ENVIRONMENT" --body "$value" 2>/dev/null; then
        log_success "  var: ${key}=${value}"; (( var_ok++ ))
      else
        log_error   "  FAILED: ${key}"; (( var_err++ ))
      fi
    fi
  done < <(parse_env_file "$VARS_FILE")
else
  log_warn "No --vars file — skipping."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────"
log_info "Repo:        ${REPO}"
log_info "Environment: ${ENVIRONMENT}"
log_info "Secrets:     ${secret_ok} set, ${secret_skip} skipped, ${secret_err} failed"
log_info "Variables:   ${var_ok} set, ${var_skip} skipped, ${var_err} failed"
echo "──────────────────────────────────────"
(( secret_err + var_err > 0 )) && { log_warn "Done with errors."; exit 1; } || log_success "All done!"