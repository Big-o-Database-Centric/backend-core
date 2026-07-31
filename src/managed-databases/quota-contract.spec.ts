import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('managed database quota helper', () => {
  it('applies a 20 MiB growth limit only after measuring initialized storage', () => {
    const script = readFileSync(
      resolve(__dirname, '../../infra/managed-databases/prepare-quotas.sh'),
      'utf8',
    );

    expect(script).toContain('case "$operation" in');
    expect(script).toContain('prepare)');
    expect(script).toContain('limit)');
    expect(script).toContain('baseline_bytes=$(du -sB1 "$instance_path"');
    expect(script).toContain('baseline_bytes + 20 * 1024 * 1024');
  });

  it('serializes project allocation and clears quota state on cleanup', () => {
    const script = readFileSync(
      resolve(__dirname, '../../infra/managed-databases/prepare-quotas.sh'),
      'utf8',
    );

    expect(script).toContain('flock -x 9');
    expect(script).toContain('allocate_project_id');
    expect(script).toContain('cleanup)');
    expect(script).toContain('project -C ${project_name}');
    expect(script).toContain('rm -rf -- "$instance_path"');
    expect(script).toContain('ensure_mapping /etc/projects "${project_id}:${instance_path}"');
    expect(script).toContain('project id is already assigned');
  });

  it('updates bind-mounted project mapping files without renaming their mount point', () => {
    const script = readFileSync(
      resolve(__dirname, '../../infra/managed-databases/prepare-quotas.sh'),
      'utf8',
    );

    expect(script).toContain('cat "$temp" > "$file"');
    expect(script).not.toContain('sed -i');
  });
});
