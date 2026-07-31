#!/usr/bin/env bash
set -euo pipefail

operation="${1:?usage: prepare-quotas.sh <prepare|limit|cleanup> <instance-id>}"
instance_id="${2:?usage: prepare-quotas.sh <prepare|limit|cleanup> <instance-id>}"
data_root="${MANAGED_DATABASE_DATA_ROOT:-/srv/big-o/instances}"
instance_path="${data_root}/${instance_id}"
mount_point="$(findmnt -no TARGET --target "$data_root")"
file_system="$(findmnt -no FSTYPE --target "$data_root")"
mount_options="$(findmnt -no OPTIONS --target "$data_root")"

if [[ ! "$instance_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "instance id must be a UUID" >&2
  exit 1
fi

if [[ "$file_system" != "xfs" ]] || [[ "$mount_options" != *"prjquota"* && "$mount_options" != *"pquota"* ]]; then
  echo "${data_root} must be on XFS with project quotas enabled" >&2
  exit 1
fi

mkdir -p "$data_root"
exec 9>"${data_root}/.quota.lock"
flock -x 9

project_name="big_o_${instance_id//-/_}"
project_id="$(awk -F: -v name="$project_name" '$1 == name { print $2; exit }' /etc/projid)"

allocate_project_id() {
  local candidate=100000
  while awk -F: -v id="$candidate" '$2 == id { found = 1 } END { exit !found }' /etc/projid; do
    candidate=$((candidate + 1))
  done
  printf '%s' "$candidate"
}

ensure_mapping() {
  local file="$1"
  local expected="$2"
  local key="$3"
  local current
  current="$(grep -F -x "$expected" "$file" || true)"
  if [[ -z "$current" ]] && grep -F -q "${key}:" "$file"; then
    echo "project id is already assigned to a different mapping" >&2
    exit 1
  fi
  if [[ -z "$current" ]]; then
    printf '%s\n' "$expected" >> "$file"
  fi
}

prepare_project() {
  mkdir -p "$instance_path"
  if [[ -z "$project_id" ]]; then
    project_id="$(allocate_project_id)"
  fi
  ensure_mapping /etc/projects "${project_id}:${instance_path}" "$project_id"
  ensure_mapping /etc/projid "${project_name}:${project_id}" "$project_name"
  xfs_quota -x -c "project -s ${project_name}" "$mount_point"
}

cleanup_project() {
  if [[ -z "$project_id" ]]; then
    rm -rf -- "$instance_path"
    return
  fi

  if ! grep -F -x "${project_id}:${instance_path}" /etc/projects >/dev/null; then
    echo "project mapping does not match ${instance_id}; refusing cleanup" >&2
    exit 1
  fi

  xfs_quota -x -c "limit -p bhard=0 ${project_name}" "$mount_point" || true
  xfs_quota -x -c "project -C ${project_name}" "$mount_point" || true
  rm -rf -- "$instance_path"
  sed -i "\\|^${project_id}:${instance_path}$|d" /etc/projects
  sed -i "\\|^${project_name}:${project_id}$|d" /etc/projid
}

case "$operation" in
  prepare)
    prepare_project
    echo "$instance_path"
    ;;
  limit)
    prepare_project
    baseline_bytes=$(du -sB1 "$instance_path" | awk '{print $1}')
    quota_bytes=$((baseline_bytes + 20 * 1024 * 1024))
    xfs_quota -x -c "limit -p bhard=${quota_bytes} ${project_name}" "$mount_point"
    echo "$quota_bytes"
    ;;
  cleanup)
    cleanup_project
    ;;
  *)
    echo "operation must be prepare, limit, or cleanup" >&2
    exit 1
    ;;
esac
