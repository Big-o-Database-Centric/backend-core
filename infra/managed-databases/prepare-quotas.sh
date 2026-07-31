#!/usr/bin/env bash
set -euo pipefail

instance_id="${1:?usage: prepare-quotas.sh <instance-id>}"
data_root="${MANAGED_DATABASE_DATA_ROOT:-/srv/big-o/instances}"
instance_path="${data_root}/${instance_id}"
quota_bytes=$((20 * 1024 * 1024))
mount_point="$(findmnt -no TARGET --target "$data_root")"
file_system="$(findmnt -no FSTYPE --target "$data_root")"
mount_options="$(findmnt -no OPTIONS --target "$data_root")"

if [[ "$file_system" != "xfs" ]] || [[ "$mount_options" != *"prjquota"* && "$mount_options" != *"pquota"* ]]; then
  echo "${data_root} must be on XFS with project quotas enabled" >&2
  exit 1
fi

mkdir -p "$instance_path"
project_id=$(( 100000 + 16#${instance_id:0:4} ))
printf 'big_o_%s:%s\n' "$project_id" "$instance_path" >> /etc/projects
printf 'big_o_%s:%s\n' "$project_id" "$project_id" >> /etc/projid
xfs_quota -x -c "project -s big_o_${project_id}" "$mount_point"
xfs_quota -x -c "limit -p bhard=${quota_bytes} big_o_${project_id}" "$mount_point"
echo "$instance_path"
