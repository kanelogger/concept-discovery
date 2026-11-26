#!/usr/bin/env python3
"""Install one owner-pinned delivery into an offline host's private version store."""
import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile

HEX = r'[0-9a-f]{64}'
BASE_FILES = {'image.tar', 'compose.content.yaml', 'nginx.conf', 'readiness.conf',
              'content/manifest.json', 'content/knowledge.sqlite'}
CONTENT_FILE = re.compile(r'content/(assets/' + HEX + r'\.[a-z0-9]+|share-materials/(catalog\.json|covers/[a-z0-9]+(?:-[a-z0-9]+)*\.png))')
OCI = 'application/vnd.oci.image.'
CHUNK = 1024 * 1024


def check(condition, message):
    if not condition:
        raise ValueError(message)


def json_bytes(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stream_hash(source, target=None):
    digest = hashlib.sha256()
    count = 0
    while chunk := source.read(CHUNK):
        digest.update(chunk)
        count += len(chunk)
        if target is not None:
            target.write(chunk)
    return digest.hexdigest(), count


def add_bytes(archive, name, data):
    member = tarfile.TarInfo(name)
    member.size = len(data)
    archive.addfile(member, io.BytesIO(data))


def platform_tuple(config):
    return '/'.join(x for x in (config['os'], config['architecture'], config.get('variant')) if x)


def read_small(archive, name):
    member = archive.getmember(name)
    check(member.isfile() and member.size <= 16 * 1024 * 1024, 'Invalid image metadata member')
    with archive.extractfile(member) as stream:
        return stream.read()


def selected_image(raw, requested):
    candidates = []
    for item in json.loads(read_small(raw, 'manifest.json')):
        config_bytes = read_small(raw, item['Config'])
        platform = platform_tuple(json.loads(config_bytes))
        if (platform == requested or '/'.join(platform.split('/')[:2]) == requested
                or (requested == 'linux/arm64/v8' and platform == 'linux/arm64')):
            candidates.append((item, config_bytes, platform))
    check(len(candidates) == 1, 'Docker archive must contain exactly one image for the target platform')
    return candidates[0]


def prepare_image(source, output, requested):
    """Emit one platform image in OCI and Docker formats, excluding other tags, images and attestations."""
    with tarfile.open(source, 'r:') as raw:
        item, config_bytes, platform = selected_image(raw, requested)
        config_hash = sha(config_bytes)
        image_ref = 'concept-discovery-offline:' + config_hash
        config_path = 'blobs/sha256/' + config_hash
        layers = []
        paths = []
        written = {config_path}
        with tarfile.open(output, 'x:') as archive:
            add_bytes(archive, config_path, config_bytes)
            for original in item['Layers']:
                member = raw.getmember(original)
                check(member.isfile(), 'Image layer must be a regular member')
                with raw.extractfile(member) as stream:
                    prefix = stream.read(4)
                    stream.seek(0)
                    digest, size = stream_hash(stream)
                    path = 'blobs/sha256/' + digest
                    if path not in written:
                        stream.seek(0)
                        target = tarfile.TarInfo(path)
                        target.size = size
                        archive.addfile(target, stream)
                        written.add(path)
                compression = '+gzip' if prefix[:2] == b'\x1f\x8b' else '+zstd' if prefix == b'\x28\xb5\x2f\xfd' else ''
                layers.append({'mediaType': OCI+'layer.v1.tar'+compression, 'size': size, 'digest': 'sha256:'+digest})
                paths.append(path)
            descriptor = {'mediaType': OCI+'config.v1+json', 'size': len(config_bytes), 'digest': 'sha256:'+config_hash}
            manifest = json_bytes({'schemaVersion': 2, 'mediaType': OCI+'manifest.v1+json',
                                   'config': descriptor, 'layers': layers})
            manifest_hash = sha(manifest)
            add_bytes(archive, 'blobs/sha256/'+manifest_hash, manifest)
            tag = 'docker.io/library/'+image_ref
            root = {'mediaType': OCI+'manifest.v1+json', 'size': len(manifest), 'digest': 'sha256:'+manifest_hash,
                    'annotations': {'io.containerd.image.name': tag, 'org.opencontainers.image.ref.name': image_ref.split(':')[1]}}
            add_bytes(archive, 'index.json', json_bytes({'schemaVersion': 2, 'manifests': [root]}))
            add_bytes(archive, 'oci-layout', json_bytes({'imageLayoutVersion': '1.0.0'}))
            add_bytes(archive, 'manifest.json', json_bytes([{'Config': config_path, 'Layers': paths, 'RepoTags': [image_ref]}]))
    return {'configSha256': config_hash, 'manifestSha256': manifest_hash, 'imageRef': image_ref, 'platform': platform}


def validate_image(path, image):
    """Confirm both engine formats will load only the selected platform image under its dedicated tag."""
    config_hash, manifest_hash = image['configSha256'], image['manifestSha256']
    check(all(re.fullmatch(HEX, value) for value in (config_hash, manifest_hash)), 'Invalid image digest')
    image_ref = 'concept-discovery-offline:'+config_hash
    check(image['imageRef'] == image_ref, 'Unexpected image tag')
    with tarfile.open(path, 'r:') as archive:
        config_path, manifest_path = ['blobs/sha256/'+digest for digest in (config_hash, manifest_hash)]
        config = read_small(archive, config_path)
        manifest = read_small(archive, manifest_path)
        check(sha(config) == config_hash and platform_tuple(json.loads(config)) == image['platform']
              and sha(manifest) == manifest_hash, 'Image config, platform or manifest mismatch')
        data = json.loads(manifest)
        check(data['config'] == {'digest':'sha256:'+config_hash, 'mediaType':OCI+'config.v1+json', 'size':len(config)},
              'Image config descriptor mismatch')
        check(set(data) == {'schemaVersion','mediaType','config','layers'} and data['schemaVersion'] == 2
              and data['mediaType'] == OCI+'manifest.v1+json', 'Unexpected OCI image manifest')
        layers = []
        verified = set()
        for entry in data['layers']:
            check(re.fullmatch('sha256:'+HEX, entry['digest']) and set(entry) == {'digest','size','mediaType'},
                  'Invalid layer descriptor')
            name = 'blobs/sha256/'+entry['digest'][7:]
            check(archive.getmember(name).size == entry['size'], 'Missing layer bytes')
            check(entry['mediaType'] in (OCI+'layer.v1.tar',OCI+'layer.v1.tar+gzip',OCI+'layer.v1.tar+zstd'),
                  'Unexpected image layer type')
            if name not in verified:
                with archive.extractfile(name) as stream:
                    check(stream_hash(stream) == (entry['digest'][7:], entry['size']), 'Layer digest mismatch')
                verified.add(name)
            layers.append(name)
        expected = {'index.json','manifest.json','oci-layout',config_path,manifest_path,*layers}
        members = archive.getmembers()
        check(len(members) == len(expected) and {member.name for member in members} == expected
              and all(member.isfile() for member in members), 'Unexpected image archive members')
        legacy = json.loads(read_small(archive, 'manifest.json'))
        check(legacy == [{'Config':config_path, 'Layers':layers, 'RepoTags':[image_ref]}], 'Unexpected Docker archive tags or images')
        root = {'digest':'sha256:'+manifest_hash, 'size':len(manifest), 'mediaType':OCI+'manifest.v1+json',
                'annotations':{'io.containerd.image.name':'docker.io/library/'+image_ref,
                               'org.opencontainers.image.ref.name':config_hash}}
        check(json.loads(read_small(archive, 'index.json')) == {'schemaVersion':2,'manifests':[root]},
              'Unexpected OCI index images or tags')


def file_table(manifest):
    check(manifest['version'] == 1 and manifest['programVersion'] and manifest['inputVersion'], 'Invalid delivery version')
    table = {}
    for item in manifest['files']:
        name = item['path']
        check(name not in table and (name in BASE_FILES or CONTENT_FILE.fullmatch(name))
              and re.fullmatch(HEX, item['sha256']) and type(item['bytes']) is int and item['bytes'] >= 0,
              'Unexpected or duplicate delivery file')
        table[name] = item
    check(BASE_FILES.issubset(table), 'Delivery is missing required files')
    return table


def read_fd(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        info = os.fstat(fd)
        check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Expected an independent regular file')
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise


DIR_FLAGS = os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY


def verify_tree(root_fd, pinned, destination=None):
    with read_fd(root_fd, 'delivery.json') as stream:
        raw = stream.read(16 * 1024 * 1024 + 1)
    check(len(raw) <= 16 * 1024 * 1024 and sha(raw) == pinned, 'Delivery manifest does not match trusted digest')
    manifest = json.loads(raw)
    table = file_table(manifest)
    expected_files = set(table) | {'delivery.json'}
    directories = {'content','content/assets'}
    for file in table:
        directories.update(str(p) for p in Path(file).parents if str(p) != '.')
    allowed_dirs = directories | ({'content/share-materials/covers'} if 'content/share-materials/catalog.json' in table else set())
    seen_files, seen_dirs = set(), set()

    def visit(parent_fd, prefix):
        for entry in os.listdir(parent_fd):
            name = prefix+entry
            target = destination/name if destination else None
            if name in allowed_dirs:
                child = os.open(entry, DIR_FLAGS, dir_fd=parent_fd)
                try:
                    if target:
                        target.mkdir(mode=0o755)
                        target.chmod(0o755)
                    seen_dirs.add(name)
                    visit(child, name+'/')
                finally:
                    os.close(child)
            else:
                check(name in expected_files, 'Unexpected file in delivery')
                with read_fd(parent_fd, entry) as stream, contextlib.ExitStack() as stack:
                    sink = stack.enter_context(target.open('xb')) if target else None
                    digest, count = stream_hash(stream, sink)
                    if sink:
                        sink.flush()
                        os.fsync(sink.fileno())
                if name == 'delivery.json':
                    check(digest == pinned, 'Manifest changed while reading')
                else:
                    check((digest, count) == (table[name]['sha256'], table[name]['bytes']), 'Delivery file digest mismatch: '+name)
                if target:
                    target.chmod(0o644)
                seen_files.add(name)
        if destination:
            copied_fd = os.open(destination/prefix, DIR_FLAGS)
            try:
                os.fsync(copied_fd)
            finally:
                os.close(copied_fd)

    visit(root_fd, '')
    check(seen_files == expected_files and directories <= seen_dirs, 'Incomplete delivery')
    return manifest


def validate_content(root, manifest):
    record = manifest['content']
    table = file_table(manifest)
    content_manifest = json.loads((root/'content/manifest.json').read_bytes())
    check(record['manifestSha256'] == table['content/manifest.json']['sha256']
          and record['libraryId'] == content_manifest['libraryId']
          and record['inputs'] == content_manifest['inputs'], 'Content manifest identity mismatch')
    files = {name.removeprefix('content/'):item['sha256'] for name, item in table.items()
             if name == 'content/knowledge.sqlite' or name.startswith('content/assets/')}
    check(sorted((row['path'],row['sha256']) for row in content_manifest['files']) == sorted(files.items()),
          'Content file inventory differs from delivery')
    db_path = root/'content/knowledge.sqlite'
    with contextlib.closing(sqlite3.connect(db_path.as_uri()+'?mode=ro&immutable=1', uri=True)) as db:
        check(db.execute('PRAGMA user_version').fetchone() == (record['userVersion'],)
              and db.execute('SELECT inventory_digest FROM release_metadata').fetchall() == [(record['inventorySha256'],)]
              and db.execute('SELECT count(*) FROM documents WHERE parent IS NULL').fetchone() == (record['activeCount'],),
              'SQLite content format or inventory mismatch')
    material = 'content/share-materials/'
    names = []
    if material+'catalog.json' in table:
        catalog = json.loads((root/material/'catalog.json').read_bytes())
        expected = ['catalog.json'] + ['covers/'+raw_id+'.png' for raw_id in sorted(catalog)]
        check({material+name for name in expected} == {name for name in table if name.startswith(material)},
              'Unexpected or missing share material')
        names = [(name,table[material+name]['sha256']) for name in expected]
    check(sha(json_bytes(names)) == record['materialDigest'] and type(record['readerContract']) is int
          and record['readerContract'] > 0, 'Content material or reader contract mismatch')


def docker(*args):
    return subprocess.check_output(['docker', 'image', *args], text=True).strip()


def verify_daemon_platform(expected):
    info = subprocess.check_output(['docker','info','--format','{{.OSType}}/{{.Architecture}}'],text=True).strip()
    os_type, _, architecture = info.partition('/')
    aliases = {'x86_64':'amd64','aarch64':'arm64','armv7l':'arm/v7','armv6l':'arm/v6'}
    platform = os_type+'/'+aliases.get(architecture,architecture)
    if expected == 'linux/arm64/v8': expected = 'linux/arm64'
    check(platform == expected, 'Target Docker daemon platform differs from approved delivery')


def inspect_import(image, work):
    data, = json.loads(docker('inspect',image['imageRef']))
    actual = data['Id']
    # The classic store identifies a program by its config. The containerd store uses
    # the manifest. Here the signed single-platform manifest references exactly that config.
    check(re.fullmatch('sha256:'+HEX,actual), 'Invalid imported image ID')
    if actual not in ('sha256:'+image['configSha256'], 'sha256:'+image['manifestSha256']):
        # Some engine stores expose a wrapper index ID. Read back that immutable ID
        # from the daemon and verify its selected executable config, including diff_ids.
        readback = Path(work)/'readback.tar'
        docker('save','--output',str(readback),actual)
        with tarfile.open(readback,'r:') as saved:
            _, config, _ = selected_image(saved,image['platform'])
            check(sha(config) == image['configSha256'], 'Imported platform config digest differs')
    reported = '/'.join(x for x in (data['Os'],data['Architecture'],data.get('Variant')) if x)
    expected = image['platform']
    check(reported == expected or {reported,expected} <= {'linux/arm64','linux/arm64/v8'},
          'Imported image architecture differs')
    return actual


def install(delivery, store, pinned):
    check(re.fullmatch(HEX, pinned), 'An independently supplied SHA-256 digest is required')
    check(not delivery.is_symlink() and not store.is_symlink(), 'Expected physical delivery and version directories')
    store = store.resolve(strict=True)
    delivery = delivery.resolve(strict=True)
    check(store != delivery and delivery not in store.parents and store not in delivery.parents,
          'Keep the upload and version store separate')
    dest = store/pinned
    store_fd = os.open(store, DIR_FLAGS)
    try:
        fcntl.flock(store_fd, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(dir=store, prefix='.install-') as work:
            stage = Path(work)/'release'
            stage.mkdir(mode=0o700)
            fd = os.open(delivery, DIR_FLAGS)
            try:
                manifest = verify_tree(fd, pinned, stage)
            finally:
                os.close(fd)
            image = manifest['image']
            verify_daemon_platform(image['platform'])
            validate_content(stage, manifest)
            validate_image(stage/'image.tar', image)
            existing = os.path.lexists(dest)
            if existing:
                fd = os.open(dest, DIR_FLAGS)
                try:
                    verify_tree(fd, pinned)
                finally:
                    os.close(fd)
            if not docker('ls','--no-trunc','--quiet',image['imageRef']):
                docker('load','--input',str(stage/'image.tar'))
            actual = inspect_import(image, work)
            if not existing:
                stage.rename(dest)
                os.fsync(store_fd)
            return {'releaseDirectory':str(dest), 'contentDirectory':str(dest/'content'), 'manifestSha256':pinned,
                    'imageId':actual, 'imageRef':image['imageRef'], 'configSha256':image['configSha256'],
                    'platform':image['platform']}
    finally:
        os.close(store_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    if sys.argv[1:2] == ['prepare-image']:
        parser.add_argument('--source', required=True)
        parser.add_argument('--output', required=True)
        parser.add_argument('--platform', required=True)
        args = parser.parse_args(sys.argv[2:])
        result = prepare_image(args.source, args.output, args.platform)
    else:
        parser.add_argument('--delivery', type=Path, required=True)
        parser.add_argument('--manifest-sha256', required=True)
        parser.add_argument('--install-root', type=Path, required=True)
        args = parser.parse_args()
        result = install(args.delivery, args.install_root, args.manifest_sha256)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, sqlite3.Error, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
