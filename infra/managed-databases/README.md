# Managed database host prerequisites

The directory in `MANAGED_DATABASE_DATA_ROOT` must be an XFS mount with `prjquota` (or `pquota`) enabled. Before a database container is started, the quota helper creates a separate XFS project. After the engine and its user are initialized, it measures the real allocated baseline and applies a hard limit of baseline plus 20 MiB. If either action fails, provisioning fails; an unlimited database is never activated. A failed provisioning attempt clears its container, XFS project mapping, quota state, and instance directory before the reservation is marked failed.

Run this preflight on the VPS before deploying:

```bash
findmnt -no FSTYPE,OPTIONS --target /srv/big-o/instances
sudo mkdir -p /srv/big-o/instances
sudo touch /etc/projects /etc/projid
docker build -f infra/managed-databases/Dockerfile.quota-helper -t big-o-managed-quota-helper:latest .
```

Set `MANAGED_DATABASE_HOST` to the public DNS name or IP clients should use, and set `MANAGED_DATABASE_QUOTA_HELPER_IMAGE` to the image built above. The backend needs Docker-socket access to create only managed-database containers and to run the short-lived quota helper. The helper is privileged only while applying the XFS project limit; it mounts only the data root plus `/etc/projects` and `/etc/projid`.

Each managed database receives a Docker-assigned host port rather than a fixed port. Keep the database containers on `big-o-private`; configure the VPS firewall to allow only the published port range you intentionally support. Do not enable provisioning on a host until the preflight command reports XFS with project quotas.
