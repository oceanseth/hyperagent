#!/usr/bin/env python3
"""Expose Funnel's verified outer TLS stream on a private local MySQL port."""
import argparse
import asyncio
import ssl
import socket
import sys


async def main(args):
    context = ssl.create_default_context()
    async def copy(reader, writer):
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    async def handle(reader, writer):
        remote = None
        pumps = []
        try:
            async def connect(address):
                return await asyncio.wait_for(
                    asyncio.open_connection(address, args.port, ssl=context,
                                            server_hostname=args.host), timeout=15)
            try:
                upstream, remote = await connect(args.connect_address or args.host)
            except socket.gaierror:
                # Temporary routing fallback for missing public Funnel DNS.
                # Every relay must still present a valid certificate for --host.
                if args.connect_address or not args.fallback_address:
                    raise
                for index, address in enumerate(args.fallback_address):
                    try:
                        upstream, remote = await connect(address)
                        break
                    except OSError:
                        if index == len(args.fallback_address) - 1:
                            raise

            pumps = [asyncio.create_task(copy(reader, remote)),
                     asyncio.create_task(copy(upstream, writer))]
            await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
        except (OSError, asyncio.TimeoutError) as exc:
            print('Funnel connection failed: ' + str(exc), file=sys.stderr, flush=True)
        finally:
            for task in pumps:
                task.cancel()
            if pumps:
                await asyncio.gather(*pumps, return_exceptions=True)
            for stream in (remote, writer):
                if stream is not None:
                    stream.close()
                    try:
                        await stream.wait_closed()
                    except OSError:
                        pass
    server = await asyncio.start_server(handle, '127.0.0.1', args.local_port, limit=65536)
    async with server:
        print(f'Funnel connector listening at 127.0.0.1:{server.sockets[0].getsockname()[1]}', flush=True)
        await server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='hermes-01.tail8c6c22.ts.net')
    parser.add_argument('--port', type=int, default=10000)
    parser.add_argument('--local-port', type=int, default=13344)
    parser.add_argument('--fallback-address', action='append', default=[], help='Verified Funnel relay IP to try only if hostname resolution fails')
    parser.add_argument('--connect-address', help='Optional resolved IP for routing checks; TLS still verifies --host')
    try:
        asyncio.run(main(parser.parse_args()))
    except KeyboardInterrupt:
        pass
