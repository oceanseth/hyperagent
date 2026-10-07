#!/usr/bin/env python3
"""Run the project's pinned Beads against a private, verified-TLS profile."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True, type=Path)
    parser.add_argument('--repo', type=Path, help='Checkout path (default: this project or current Git root)')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error('Supply a bd command, such as ready')
    # Central clients never replicate independently or change local schema.
    if args.command[0] in ('init', 'migrate', 'setup', 'dolt', 'backup'):
        parser.error('Server administration and replication belong to the city maintainer')
    profile_path = args.profile.expanduser().resolve()
    if profile_path.stat().st_mode & 0o077:
        parser.error('Connection profile must be private: chmod 600 PATH')
    profile = json.loads(profile_path.read_text())
    tls = profile['tls']
    if not all(tls.get(k) is True for k in ('required', 'verify_certificate', 'verify_hostname')):
        parser.error('Verified TLS is required')
    ca = Path(tls['ca_certificate']).expanduser()
    if not ca.is_absolute():
        ca = profile_path.parent / ca
    if not ca.is_file():
        parser.error('CA certificate file is missing')
    repo = args.repo.expanduser().resolve() if args.repo else Path(__file__).resolve().parent.parent
    if not (repo / '.beads/metadata.json').is_file():
        repo = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    original = json.loads((repo / '.beads/metadata.json').read_text())
    if profile['database'] != original['dolt_database']:
        parser.error('Connection database does not match this project')
    connector = None
    try:
        port = profile['port']
        if 'funnel' in profile:
            funnel = profile['funnel']
            command = [sys.executable, str(Path(__file__).with_name('funnel-client.py')),
                       '--host', funnel['host'], '--port', str(funnel['port']), '--local-port', '0']
            # Used only for a routing proof through the public relay's resolved IP.
            if os.environ.get('BEADS_FUNNEL_CONNECT_ADDRESS'):
                command += ['--connect-address', os.environ['BEADS_FUNNEL_CONNECT_ADDRESS']]
            connector = subprocess.Popen(command, stdout=subprocess.PIPE, text=True)
            line = connector.stdout.readline()
            if not line.startswith('Funnel connector listening at 127.0.0.1:'):
                raise RuntimeError('Funnel connector failed to start')
            port = int(line.rsplit(':', 1)[1])
        # Every invocation owns its metadata: parallel agents cannot race on a
        # cached local tunnel port. Durable work and claims live on the server.
        with tempfile.TemporaryDirectory(prefix='beads-public-') as temporary:
            state = Path(temporary) / '.beads'
            state.mkdir(mode=0o700)
            metadata = dict(original, dolt_mode='server', dolt_server_host=profile['host'],
                            dolt_server_port=port, dolt_server_user=profile['username'])
            (state / 'metadata.json').write_text(json.dumps(metadata) + '\n')
            (state / 'config.yaml').write_text('dolt.mode: server\ndolt.auto-start: false\nbackup.enabled: false\n')
            env = dict(os.environ, BEADS_DIR=str(state), BEADS_DOLT_SERVER_MODE='1',
                       BEADS_DOLT_SERVER_HOST=profile['host'], BEADS_DOLT_SERVER_PORT=str(port),
                       BEADS_DOLT_SERVER_USER=profile['username'], BEADS_DOLT_PASSWORD=profile['password'],
                       BEADS_DOLT_SERVER_TLS='1', SSL_CERT_FILE=str(ca.resolve()))
            return subprocess.call([str(repo / 'bin/bd'), *args.command], cwd=repo, env=env)
    finally:
        if connector is not None:
            connector.terminate()
            try:
                connector.wait(timeout=5)
            except subprocess.TimeoutExpired:
                connector.kill()
                connector.wait()
            connector.stdout.close()



if __name__ == '__main__':
    sys.exit(main())
