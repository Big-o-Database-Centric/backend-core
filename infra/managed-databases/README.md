# Managed database host prerequisites

The directory in MANAGED_DATABASE_DATA_ROOT must be an XFS mount with prjquota (or pquota) enabled. The provisioning service invokes prepare-quotas.sh before starting a database container; it creates a 20 MiB hard quota.

Run this preflight on the VPS before deploying:

```bash
findmnt -no FSTYPE,OPTIONS --target /srv/big-o/instances
sudo install -m 0750 infra/managed-databases/prepare-quotas.sh /usr/local/sbin/big-o-prepare-quota
```

The backend service account needs permission for that restricted script and Docker commands only. The backend and managed database containers must be on the private big-o-private network. Do not publish database ports.
